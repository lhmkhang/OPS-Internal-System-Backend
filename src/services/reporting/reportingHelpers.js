const mongoose = require('mongoose');
const logger = require('../../helpers/logger');
const loggerInfo = logger.getLogger("infoLogger");
const { distance } = require('fastest-levenshtein');

// Cache cho config versions để tối ưu performance
const configCache = new Map();

/**
 * Helper function để lấy field configuration theo version cụ thể với cache
 * @param {string} projectId - Project ID
 * @param {number} version - Version number
 * @param {object} connection - Database connection
 * @returns {Promise<object|null>} - Field configuration hoặc null nếu không tìm thấy
 */
async function getFieldConfigByVersion(projectId, version, connection) {
    // Fallback về latest active config khi version = 0 (legacy data) hoặc null
    if (version === null || version === 0) {
        const cacheKey = `field_config_${projectId}_latest_active`;
        if (configCache.has(cacheKey)) {
            return configCache.get(cacheKey);
        }

        try {
            const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../../models/reporting/fieldDefinitionCollection.model');
            const ProjectFieldConfiguration = connection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

            const config = await ProjectFieldConfiguration.findOne({
                project_id: new mongoose.Types.ObjectId(projectId),
                isActive: true
            }, { fields: 1, version: 1, updated_at: 1 }).sort({ version: -1 }).lean();

            // Cache config (có thể là null)
            configCache.set(cacheKey, config);
            return config;
        } catch (error) {
            loggerInfo.error(`[getFieldConfigByVersion] Error loading latest active field config for project ${projectId}:`, error);
            return null;
        }
    }

    // Version cụ thể != 0
    const cacheKey = `field_config_${projectId}_${version}`;
    if (configCache.has(cacheKey)) {
        return configCache.get(cacheKey);
    }

    try {
        const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../../models/reporting/fieldDefinitionCollection.model');
        const ProjectFieldConfiguration = connection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

        const config = await ProjectFieldConfiguration.findOne({
            project_id: new mongoose.Types.ObjectId(projectId),
            version: version
        }, { fields: 1, version: 1, updated_at: 1 }).lean();

        // Cache config (có thể là null)
        configCache.set(cacheKey, config);
        return config;
    } catch (error) {
        loggerInfo.error(`[getFieldConfigByVersion] Error loading field config version ${version} for project ${projectId}:`, error);
        return null;
    }
}

/**
 * Helper function để lấy project threshold theo version cụ thể với cache
 * @param {string} projectId - Project ID
 * @param {number} version - Version number
 * @param {object} connection - Database connection
 * @returns {Promise<object|null>} - Project threshold hoặc null nếu không tìm thấy
 */
async function getProjectThresholdByVersion(projectId, version, connection) {
    const { schema: projectThresholdSchema, collectionName: projectThresholdCollectionName } = require('../../models/reporting/ProjectThresholdModel');

    // Fallback về latest active config khi version = 0 (legacy data) hoặc null
    if (version === null || version === 0) {
        const cacheKey = `project_threshold_${projectId}_latest_active`;
        if (configCache.has(cacheKey)) {
            return configCache.get(cacheKey);
        }

        try {
            const ProjectThreshold = connection.model(projectThresholdCollectionName, projectThresholdSchema, projectThresholdCollectionName);

            const config = await ProjectThreshold.findOne({
                projectId: new mongoose.Types.ObjectId(projectId),
                isActive: true
            }, { thresholds: 1, version: 1, modifiedDate: 1 }).sort({ version: -1 }).lean();

            // Cache config (có thể là null)
            configCache.set(cacheKey, config);
            return config;
        } catch (error) {
            loggerInfo.error(`[getProjectThresholdByVersion] Error loading latest active project threshold for project ${projectId}:`, error);
            return null;
        }
    }

    // Version cụ thể != 0
    const cacheKey = `project_threshold_${projectId}_${version}`;
    if (configCache.has(cacheKey)) {
        return configCache.get(cacheKey);
    }

    try {
        const ProjectThreshold = connection.model(projectThresholdCollectionName, projectThresholdSchema, projectThresholdCollectionName);

        const config = await ProjectThreshold.findOne({
            projectId: new mongoose.Types.ObjectId(projectId),
            version: version
        }, { thresholds: 1, version: 1, modifiedDate: 1 }).lean();

        // Cache config (có thể là null)
        configCache.set(cacheKey, config);
        return config;
    } catch (error) {
        loggerInfo.error(`[getProjectThresholdByVersion] Error loading project threshold version ${version} for project ${projectId}:`, error);
        return null;
    }
}

/**
 * Helper function để group documents theo date + config versions
 * @param {Array} keyingAmountDocs - Keying amount documents
 * @param {Array} mistakeDetailsDocs - Mistake details documents
 * @returns {object} - Grouped documents theo version combinations
 */
function groupDocumentsByVersions(keyingAmountDocs, mistakeDetailsDocs) {
    const groupedData = {};

    // DEBUG LOG: Log số lượng documents
    loggerInfo.info(`[groupDocumentsByVersions] Starting with ${keyingAmountDocs.length} keying docs and ${mistakeDetailsDocs.length} mistake docs`);

    // Group keying documents
    keyingAmountDocs.forEach(doc => {
        const dateKey = convertUTCToGMT7DateString(doc.imported_date);
        const fieldConfigVersion = doc.field_configuration_version || 0;
        const projectThresholdVersion = doc.project_threshold_version || 0;

        // Tạo group key kết hợp date + versions
        const groupKey = `${dateKey}_${fieldConfigVersion}_${projectThresholdVersion}`;

        // DEBUG LOG: Log từng document và version
        loggerInfo.info(`[groupDocumentsByVersions] Keying doc: ${doc.doc_id}, dateKey: ${dateKey}, fieldConfigV: ${fieldConfigVersion}, thresholdV: ${projectThresholdVersion}, groupKey: ${groupKey}`);

        if (!groupedData[groupKey]) {
            groupedData[groupKey] = {
                dateKey,
                fieldConfigVersion,
                projectThresholdVersion,
                keyingDocs: [],
                mistakeDocs: [],
                versionInfo: {
                    field_config_updated_at: doc.processing_version_info?.field_config_updated_at || null,
                    project_threshold_updated_at: doc.processing_version_info?.project_threshold_updated_at || null,
                    processed_at_range: {
                        min: doc.processing_version_info?.processed_at || null,
                        max: doc.processing_version_info?.processed_at || null
                    }
                }
            };
            loggerInfo.info(`[groupDocumentsByVersions] Created new group: ${groupKey}`);
        }

        groupedData[groupKey].keyingDocs.push(doc);

        // Update processed_at range
        if (doc.processing_version_info?.processed_at) {
            const processedAt = new Date(doc.processing_version_info.processed_at);
            if (!groupedData[groupKey].versionInfo.processed_at_range.min ||
                processedAt < new Date(groupedData[groupKey].versionInfo.processed_at_range.min)) {
                groupedData[groupKey].versionInfo.processed_at_range.min = doc.processing_version_info.processed_at;
            }
            if (!groupedData[groupKey].versionInfo.processed_at_range.max ||
                processedAt > new Date(groupedData[groupKey].versionInfo.processed_at_range.max)) {
                groupedData[groupKey].versionInfo.processed_at_range.max = doc.processing_version_info.processed_at;
            }
        }
    });

    // Group mistake documents
    mistakeDetailsDocs.forEach(doc => {
        const dateKey = convertUTCToGMT7DateString(doc.imported_date);
        const fieldConfigVersion = doc.field_configuration_version || 0;
        const projectThresholdVersion = doc.project_threshold_version || 0;

        const groupKey = `${dateKey}_${fieldConfigVersion}_${projectThresholdVersion}`;

        if (!groupedData[groupKey]) {
            groupedData[groupKey] = {
                dateKey,
                fieldConfigVersion,
                projectThresholdVersion,
                keyingDocs: [],
                mistakeDocs: [],
                versionInfo: {
                    field_config_updated_at: doc.processing_version_info?.field_config_updated_at || null,
                    project_threshold_updated_at: doc.processing_version_info?.project_threshold_updated_at || null,
                    processed_at_range: {
                        min: doc.processing_version_info?.processed_at || null,
                        max: doc.processing_version_info?.processed_at || null
                    }
                }
            };
        }

        groupedData[groupKey].mistakeDocs.push(doc);

        // Update processed_at range nếu chưa có từ keying docs
        if (doc.processing_version_info?.processed_at && !groupedData[groupKey].versionInfo.processed_at_range.min) {
            const processedAt = new Date(doc.processing_version_info.processed_at);
            if (!groupedData[groupKey].versionInfo.processed_at_range.min ||
                processedAt < new Date(groupedData[groupKey].versionInfo.processed_at_range.min)) {
                groupedData[groupKey].versionInfo.processed_at_range.min = doc.processing_version_info.processed_at;
            }
            if (!groupedData[groupKey].versionInfo.processed_at_range.max ||
                processedAt > new Date(groupedData[groupKey].versionInfo.processed_at_range.max)) {
                groupedData[groupKey].versionInfo.processed_at_range.max = doc.processing_version_info.processed_at;
            }
        }
    });

    // DEBUG LOG: Summary các groups đã tạo
    loggerInfo.info(`[groupDocumentsByVersions] Summary - Total groups created: ${Object.keys(groupedData).length}`);
    Object.entries(groupedData).forEach(([groupKey, groupData]) => {
        loggerInfo.info(`[groupDocumentsByVersions] Group ${groupKey}: ${groupData.keyingDocs.length} keying docs, ${groupData.mistakeDocs.length} mistake docs, fieldConfigV: ${groupData.fieldConfigVersion}, thresholdV: ${groupData.projectThresholdVersion}`);
    });

    return groupedData;
}

/**
 * Helper function để lấy threshold percentage theo version cụ thể
 * @param {object} thresholdConfig - Threshold configuration object
 * @param {string} reportLevel - Report level (document, field, etc.)
 * @param {string} thresholdType - Threshold type (cho field level)
 * @returns {number|null} - Threshold percentage hoặc null
 */
function getThresholdPercentageByVersion(thresholdConfig, reportLevel, thresholdType = null) {
    if (!thresholdConfig || !thresholdConfig.thresholds) {
        return "N/A";
    }

    let scopeMapping = {
        'document': 'Document',
        'record': 'Record',
        'line_item': 'Line Item',
        'field': 'Field',
        'character': 'Character'
    };

    const targetScope = scopeMapping[reportLevel.toLowerCase()];

    if (reportLevel.toLowerCase() === 'field' && thresholdType) {
        // Đối với field level, tìm theo thresholdType
        const threshold = thresholdConfig.thresholds.find(t =>
            t.thresholdScope === targetScope &&
            t.thresholdType === thresholdType
        );
        return threshold ? threshold.thresholdPercentage : "N/A";
    } else {
        // Đối với các level khác, tìm theo scope
        const threshold = thresholdConfig.thresholds.find(t =>
            t.thresholdScope === targetScope
        );
        return threshold ? threshold.thresholdPercentage : "N/A";
    }
}

/**
 * Helper function để tính toán thống kê field level cho danh sách field cụ thể
 * @param {Array} mistakeDetailsDocs - Documents chứa mistake details
 * @param {Array} keyingAmountDocs - Documents chứa keying amount
 * @param {Array} targetFields - Danh sách field name cần tính toán
 * @param {Array} allFieldConfigs - Tất cả field configs để tính tỷ lệ
 * @param {RegExp} AQC_PATTERN - Pattern để match task final name
 * @returns {Object} - {total_error, total_keying, total_sample}
 */
async function calculateFieldLevelStats(mistakeDetailsDocs, keyingAmountDocs, targetFields, allFieldConfigs, AQC_PATTERN) {
    let total_error = 0;
    let total_keying = 0;
    let total_sample = 0;

    if (!targetFields || targetFields.length === 0) {
        return { total_error, total_keying, total_sample };
    }

    // 1. total_error: count fields có lỗi (chỉ tính các field trong targetFields)
    const uniqueErrorFields = new Set();

    for (const doc of mistakeDetailsDocs) {
        for (const mistake of (doc.mistake_details || [])) {
            if (
                AQC_PATTERN.test(mistake.task_final_name) &&
                mistake.error_type !== 'not_error' &&
                mistake.error_found_at === 'qc' &&
                mistake.error_type !== 'suggestion' &&
                targetFields.includes(mistake.field_name) // Chỉ tính field trong target list
            ) {
                // Tạo key duy nhất cho field error
                const errorKey = `${doc.doc_id}_${mistake.field_name}_${mistake.record_idx}_${mistake.line_idx}`;

                if (!uniqueErrorFields.has(errorKey)) {
                    uniqueErrorFields.add(errorKey);
                    total_error++;
                }
            }
        }
    }

    // 2. total_keying: tính theo tỷ lệ field target/total field của document
    const totalFields = allFieldConfigs?.length || 1; // Tránh chia cho 0
    const fieldRatio = targetFields.length / totalFields;

    for (const doc of keyingAmountDocs) {
        const totalFieldDoc = doc.total_field_document || 0;
        if (totalFieldDoc > 0) {
            total_keying += Math.round(totalFieldDoc * fieldRatio);
        }
    }

    // 3. total_sample: tương tự total_keying nhưng chỉ cho doc có QC
    for (const doc of keyingAmountDocs) {
        const hasQcTask = (doc.keying_details || []).some(detail => detail.is_qc === true);
        if (hasQcTask) {
            const totalFieldDoc = doc.total_field_document || 0;
            if (totalFieldDoc > 0) {
                total_sample += Math.round(totalFieldDoc * fieldRatio);
            }
        }
    }

    return { total_error, total_keying, total_sample };
}

/**
 * Helper function để tính toán thống kê character level
 * @param {Array} mistakeDetailsDocs - Documents chứa mistake details
 * @param {Array} keyingAmountDocs - Documents chứa keying amount
 * @param {RegExp} AQC_PATTERN - Pattern để match task final name
 * @returns {Object} - {total_error, total_keying, total_sample}
 */
async function calculateCharacterLevelStats(mistakeDetailsDocs, keyingAmountDocs, AQC_PATTERN) {
    let total_error = 0;
    let total_keying = 0;
    let total_sample = 0;

    // 1. total_keying: tổng total_character_document của tất cả doc trong keying_amount
    for (const doc of keyingAmountDocs) {
        const charCount = doc.total_character_document || 0;
        total_keying += charCount;
    }

    // 2. total_sample: tổng total_character_document của các doc có QC task
    for (const doc of keyingAmountDocs) {
        const hasQcTask = (doc.keying_details || []).some(detail => detail.is_qc === true);
        if (hasQcTask) {
            const charCount = doc.total_character_document || 0;
            total_sample += charCount;
        }
    }

    // 3. total_error: tính theo Levenshtein distance cho lỗi cuối cùng
    // Lưu mistakes theo doc_id + field + record + line để tìm lỗi cuối cùng
    const mistakesByLocation = {};

    for (const doc of mistakeDetailsDocs) {
        for (const mistake of (doc.mistake_details || [])) {
            if (
                AQC_PATTERN.test(mistake.task_final_name) &&
                mistake.error_type !== 'not_error' &&
                mistake.error_found_at === 'qc' &&
                mistake.error_type !== 'suggestion'
            ) {
                // Tạo key duy nhất cho location error
                const locationKey = `${doc.doc_id}_${mistake.field_name}_${mistake.record_idx}_${mistake.line_idx}`;

                // Lưu lại mistake, nếu đã có thì replace (để lấy mistake cuối cùng theo thời gian)
                if (!mistakesByLocation[locationKey] ||
                    new Date(mistake.captured_final_at) > new Date(mistakesByLocation[locationKey].captured_final_at)) {
                    mistakesByLocation[locationKey] = {
                        value_keyer: mistake.value_keyer || '',
                        value_final: mistake.value_final || '',
                        captured_final_at: mistake.captured_final_at
                    };
                }
            }
        }
    }

    // Tính Levenshtein distance cho từng location có lỗi
    for (const [locationKey, mistake] of Object.entries(mistakesByLocation)) {
        const keyerValue = mistake.value_keyer || '';
        const finalValue = mistake.value_final || '';

        // Tính distance giữa keyer và final value
        const charDistance = distance(keyerValue, finalValue);

        // Cộng dồn số ký tự khác nhau
        total_error += charDistance;
    }

    return { total_error, total_keying, total_sample };
}

function parseDateToUTC(dateStr, isEnd = false) {
    // dateStr: yyyy-mm-dd, convert từ GMT+7 sang UTC để filter database
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) return null;

    if (isEnd) {
        // Cuối ngày GMT+7: yyyy-mm-ddT23:59:59.999+07:00 → UTC: yyyy-mm-ddT16:59:59.999Z
        return new Date(Date.UTC(year, month - 1, day, 16, 59, 59, 999));
    } else {
        // Đầu ngày GMT+7: yyyy-mm-ddT00:00:00.000+07:00 → UTC: yyyy-mm-(dd-1)T17:00:00.000Z
        return new Date(Date.UTC(year, month - 1, day - 1, 17, 0, 0, 0));
    }
}

/**
 * Helper function để convert UTC timestamp sang GMT+7 date string (YYYY-MM-DD)
 * @param {Date} utcDate - UTC date object
 * @returns {string} - Date string theo GMT+7 format YYYY-MM-DD
 */
function convertUTCToGMT7DateString(utcDate) {
    if (!utcDate) return '';
    // Convert UTC sang GMT+7 bằng cách cộng 7 giờ
    const gmt7Date = new Date(utcDate.getTime() + 7 * 60 * 60 * 1000);
    return gmt7Date.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Helper function để lấy comment từ reason input được truyền từ frontend
 * @param {Array} reasonInput - Mảng reason được truyền từ frontend request
 * @returns {string} - Comment từ reason input hoặc chuỗi rỗng
 */
function getCommentFromReasonInput(reasonInput) {
    if (!reasonInput || !Array.isArray(reasonInput) || reasonInput.length === 0) {
        return '';
    }

    // Lấy comment từ reason đầu tiên (thường chỉ có 1 element từ frontend)
    const firstReason = reasonInput[0];
    return firstReason?.content || firstReason?.comment || '';
}

/**
 * Helper function để merge results có cùng report_level, threshold_type, threshold và imported_date
 * @param {Array} results - Array of results from different version groups
 * @returns {Array} - Merged results with summed metrics
 */
function mergeResultsBySameThreshold(results) {
    if (!results || results.length === 0) {
        return [];
    }

    // Group results theo composite key
    const groupedResults = {};

    results.forEach(result => {
        // Tạo key duy nhất cho group
        const groupKey = `${result.report_level}_${result.threshold_type}_${result.threshold}_${result.imported_date}`;

        if (!groupedResults[groupKey]) {
            // Tạo group mới - copy toàn bộ result đầu tiên
            groupedResults[groupKey] = {
                ...result,
                // Khởi tạo arrays để track versions
                merged_field_configuration_versions: [result.field_configuration_version],
                merged_project_threshold_versions: [result.project_threshold_version],
                merged_config_metadata: [result.config_metadata]
            };
        } else {
            // Merge metrics vào group hiện tại
            const existingResult = groupedResults[groupKey];

            existingResult.total_error += result.total_error || 0;
            existingResult.total_keying += result.total_keying || 0;
            existingResult.total_sample += result.total_sample || 0;

            // Track additional versions
            if (result.field_configuration_version &&
                !existingResult.merged_field_configuration_versions.includes(result.field_configuration_version)) {
                existingResult.merged_field_configuration_versions.push(result.field_configuration_version);
            }

            if (result.project_threshold_version &&
                !existingResult.merged_project_threshold_versions.includes(result.project_threshold_version)) {
                existingResult.merged_project_threshold_versions.push(result.project_threshold_version);
            }

            if (result.config_metadata) {
                existingResult.merged_config_metadata.push(result.config_metadata);
            }
        }
    });

    // Convert grouped results back to array và clean up version info
    const mergedResults = Object.values(groupedResults).map(result => {
        // Nếu chỉ có 1 version, giữ nguyên format cũ
        if (result.merged_field_configuration_versions.length === 1) {
            delete result.merged_field_configuration_versions;
            delete result.merged_project_threshold_versions;
            delete result.merged_config_metadata;
        } else {
            // Nếu có nhiều versions, thay thế single version bằng arrays
            result.field_configuration_versions = result.merged_field_configuration_versions;
            result.project_threshold_versions = result.merged_project_threshold_versions;
            result.config_metadata_array = result.merged_config_metadata;

            // Remove single version fields
            delete result.field_configuration_version;
            delete result.project_threshold_version;
            delete result.config_metadata;
            delete result.merged_field_configuration_versions;
            delete result.merged_project_threshold_versions;
            delete result.merged_config_metadata;
        }

        return result;
    });

    loggerInfo.info(`[mergeResultsBySameThreshold] Merged ${results.length} results into ${mergedResults.length} unique threshold groups`);

    return mergedResults;
}

module.exports = {
    getFieldConfigByVersion,
    getProjectThresholdByVersion,
    groupDocumentsByVersions,
    getThresholdPercentageByVersion,
    calculateFieldLevelStats,
    calculateCharacterLevelStats,
    parseDateToUTC,
    convertUTCToGMT7DateString,
    getCommentFromReasonInput,
    mergeResultsBySameThreshold
}; 