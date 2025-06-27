const { getConnection } = require('./connectDB');
const { schema: QcPatternConfigSchema, collectionName: QcPatternConfigCollectionName } = require('../models/reporting/QcPatternConfigModel');
const logger = require('./logger');
const loggerInfo = logger.getLogger("infoLogger");
const loggerError = logger.getLogger("errorLogger");

// Cache cho pattern để tránh query DB nhiều lần
let cachedPatterns = null;
let lastPatternFetch = null;
const PATTERN_CACHE_TTL = 15 * 60 * 1000; // 15 phút

/**
 * Lấy QC patterns từ DB với cache 15 phút
 * @returns {Promise<{QC_PATTERN: RegExp, AQC_PATTERN: RegExp, COMBINED_PATTERN: RegExp}>}
 */
async function getQcPatterns() {
    // Kiểm tra cache còn hợp lệ không
    const now = Date.now();
    if (cachedPatterns && lastPatternFetch && (now - lastPatternFetch) < PATTERN_CACHE_TTL) {
        return cachedPatterns;
    }

    try {
        const connection = getConnection('default');
        const QcPatternConfigModel = connection.model(QcPatternConfigCollectionName, QcPatternConfigSchema, QcPatternConfigCollectionName);

        // Lấy pattern từ DB
        const patternConfig = await QcPatternConfigModel.findOne({}).lean();

        if (patternConfig && patternConfig.pattern_regex) {
            // Convert string pattern thành RegExp object
            const qcPatternStr = patternConfig.pattern_regex.QC_PATTERN;
            const aqcPatternStr = patternConfig.pattern_regex.AQC_PATTERN;

            // Parse regex string để lấy pattern và flags
            const parseRegexString = (regexStr) => {
                if (!regexStr || typeof regexStr !== 'string') return null;

                // Regex để parse format: /pattern/flags
                const match = regexStr.match(/^\/(.+)\/([gimuy]*)$/);
                if (match) {
                    const [, pattern, flags] = match;
                    // Đảm bảo luôn có flag 'i' nếu không có flags hoặc không có 'i'
                    const finalFlags = flags.includes('i') ? flags : flags + 'i';
                    return new RegExp(pattern, finalFlags);
                }

                // Nếu không có format /pattern/flags, coi như pattern thường với flag 'i'
                return new RegExp(regexStr, 'i');
            };

            const QC_PATTERN = parseRegexString(qcPatternStr);
            const AQC_PATTERN = parseRegexString(aqcPatternStr);

            if (QC_PATTERN && AQC_PATTERN) {
                // Tạo combined pattern từ 2 pattern string gốc
                const combinedPatternStr = `${qcPatternStr.replace(/^\/|\/[gimuy]*$/g, '')}|${aqcPatternStr.replace(/^\/|\/[gimuy]*$/g, '')}`;
                const COMBINED_PATTERN = new RegExp(combinedPatternStr, 'i');

                // Cache patterns
                cachedPatterns = { QC_PATTERN, AQC_PATTERN, COMBINED_PATTERN };
                lastPatternFetch = now;

                return cachedPatterns;
            }
        }

        // Fallback nếu không tìm thấy trong DB
        loggerInfo.warn('[QC Pattern Helper] No patterns found in DB, using fallback patterns');
        cachedPatterns = {
            QC_PATTERN: /qc|_qc_|_qc|qc_|quality_check/i,
            AQC_PATTERN: /_qca_|_aqc_|approve_mistake|_confirm|confirm_/i,
            COMBINED_PATTERN: /qc|_qc_|_qc|qc_|quality_check|_qca_|_aqc_|approve_mistake|_confirm|confirm_/i
        };
        lastPatternFetch = now;

        return cachedPatterns;
    } catch (error) {
        loggerError.error('[QC Pattern Helper] Error loading patterns from DB:', error.message);

        // Fallback patterns nếu có lỗi
        cachedPatterns = {
            QC_PATTERN: /qc|_qc_|_qc|qc_|quality_check/i,
            AQC_PATTERN: /_qca_|_aqc_|approve_mistake|_confirm|confirm_/i,
            COMBINED_PATTERN: /qc|_qc_|_qc|qc_|quality_check|_qca_|_aqc_|approve_mistake|_confirm|confirm_/i
        };
        lastPatternFetch = now;

        return cachedPatterns;
    }
}

/**
 * Clear cache để force reload patterns từ DB
 */
function clearPatternCache() {
    cachedPatterns = null;
    lastPatternFetch = null;
    loggerInfo.info('[QC Pattern Helper] Pattern cache cleared');
}

module.exports = {
    getQcPatterns,
    clearPatternCache
}; 