const mongoose = require('mongoose');
const { createModel: createMistakeDetailsModel } = require('../models/reporting/mistakeDetails.model');
const { schema: fieldConfigurationSchema, collectionName: fieldConfigurationCollectionName } = require('../models/reporting/fieldDefinitionCollection.model');
const { schema: projectThresholdSchema, collectionName: projectThresholdCollectionName } = require('../models/reporting/ProjectThresholdModel');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../utils/HandleMessage');
const message = require('../utils/message');
const { getConnection } = require('../helpers/connectDB');
const logger = require('../helpers/logger');
const loggerInfo = logger.getLogger("infoLogger");
const { getQcPatterns } = require('../helpers/qcPatternHelper');
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
            const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../models/reporting/fieldDefinitionCollection.model');
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
        const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../models/reporting/fieldDefinitionCollection.model');
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
 * Process group data theo report level với version-specific configs
 * @param {string} reportLevel - Report level (document, field, etc.)
 * @param {Array} keyingDocs - Keying amount documents
 * @param {Array} mistakeDocs - Mistake details documents
 * @param {object} fieldConfig - Field configuration for this version
 * @param {object} thresholdConfig - Project threshold for this version
 * @param {RegExp} AQC_PATTERN - QC pattern regex
 * @param {string} projectId - Project ID
 * @param {object} connection - Database connection
 * @returns {Promise<Array>} - Processed results
 */
async function processGroupByReportLevel(reportLevel, keyingDocs, mistakeDocs, fieldConfig, thresholdConfig, AQC_PATTERN, projectId, connection, dateKey) {
    const results = [];

    if (reportLevel.toLowerCase() === 'document') {
        let total_error = 0;
        let total_keying = 0;
        let total_sample = 0;

        // 1. total_error: count document có lỗi
        for (const doc of mistakeDocs) {
            const hasError = (doc.mistake_details || []).some(mistake =>
                mistake.error_found_at === 'qc' &&
                mistake.error_type !== 'not_error' &&
                mistake.error_type !== 'suggestion'
            );
            if (hasError) {
                total_error++;
            }
        }

        // 2. total_keying: tổng số document từ keying_amount
        total_keying = keyingDocs.length;

        // 3. total_sample: tổng số document có bất kỳ task nào là QC
        for (const doc of keyingDocs) {
            const isQcDoc = (doc.keying_details || []).some(detail => detail.is_qc === true);
            if (isQcDoc) {
                total_sample++;
            }
        }

        // Xử lý multiple threshold types cho document level như field level
        if (thresholdConfig && thresholdConfig.thresholds) {
            // Lấy tất cả threshold types cho Document scope từ version-specific config
            const documentThresholds = thresholdConfig.thresholds.filter(t =>
                t.thresholdScope === 'Document'
            );

            // DEBUG LOG: Log threshold config để debug
            loggerInfo.info(`[processGroupByReportLevel] Document level - dateKey: ${dateKey}, thresholdConfig version: ${thresholdConfig.version}, documentThresholds count: ${documentThresholds.length}`);
            loggerInfo.info(`[processGroupByReportLevel] Document thresholds:`, documentThresholds);

            if (documentThresholds.length > 0) {
                // Tạo result cho từng threshold type
                for (const thresholdItem of documentThresholds) {
                    const thresholdType = thresholdItem.thresholdType || 'Critical';
                    const threshold = thresholdItem.thresholdPercentage;

                    // Convert threshold type cho API response format
                    let apiThresholdType = 'Critical'; // default
                    switch (thresholdType) {
                        case 'Critical':
                            apiThresholdType = 'Critical';
                            break;
                        case 'Non Critical':
                            apiThresholdType = 'Non Critical';
                            break;
                        default:
                            apiThresholdType = thresholdType;
                    }

                    loggerInfo.info(`[processGroupByReportLevel] Creating document result - dateKey: ${dateKey}, thresholdType: ${thresholdType}, threshold: ${threshold}, version: ${thresholdConfig.version}`);

                    results.push({
                        project_id: projectId,
                        report_level: 'document',
                        category: apiThresholdType,
                        category_name: 'Document',
                        imported_date: dateKey,
                        total_error,
                        total_keying,
                        total_sample,
                        threshold_type: apiThresholdType,
                        threshold
                    });
                }
            } else {
                // Fallback: Nếu không có threshold cho Document scope, tạo result mặc định
                results.push({
                    project_id: projectId,
                    report_level: 'document',
                    category: 'overall',
                    category_name: 'Document',
                    imported_date: dateKey,
                    total_error,
                    total_keying,
                    total_sample,
                    threshold_type: 'Critical',
                    threshold: "N/A"
                });
            }
        } else {
            // Fallback: Nếu không có thresholdConfig, tạo result mặc định
            results.push({
                project_id: projectId,
                report_level: 'document',
                category: 'overall',
                category_name: 'Document',
                imported_date: dateKey,
                total_error,
                total_keying,
                total_sample,
                threshold_type: 'Critical',
                threshold: "N/A"
            });
        }

    } else if (reportLevel.toLowerCase() === 'field') {
        // Field level: group theo threshold_type từ version-specific field config

        let fieldConfigs = [];
        if (fieldConfig && fieldConfig.fields) {
            // Lọc fields có is_report_count !== false
            fieldConfigs = fieldConfig.fields.filter(field => field.is_report_count !== false);
        }

        if (fieldConfigs && fieldConfigs.length > 0) {
            // Group fields theo threshold type (critical_field values)
            const fieldsByThreshold = {};
            fieldConfigs.forEach(field => {
                const thresholdType = field.critical_field || 'Critical';
                if (!fieldsByThreshold[thresholdType]) {
                    fieldsByThreshold[thresholdType] = [];
                }
                fieldsByThreshold[thresholdType].push(field.field_name);
            });

            for (const [thresholdType, fieldNames] of Object.entries(fieldsByThreshold)) {
                if (fieldNames && fieldNames.length > 0) {
                    // Tính toán stats cho nhóm fields này
                    const thresholdStats = await calculateFieldLevelStats(
                        mistakeDocs,
                        keyingDocs,
                        fieldNames,
                        fieldConfigs,
                        AQC_PATTERN
                    );

                    // Lấy threshold percentage theo version với thresholdType này
                    const threshold = getThresholdPercentageByVersion(thresholdConfig, 'field', thresholdType);

                    // Convert threshold type cho API response format
                    let apiThresholdType = 'Critical'; // default
                    switch (thresholdType) {
                        case 'Critical':
                            apiThresholdType = 'Critical';
                            break;
                        case 'Non Critical':
                            apiThresholdType = 'Non Critical';
                            break;
                        default:
                            apiThresholdType = thresholdType;
                    }

                    results.push({
                        project_id: projectId,
                        report_level: 'field',
                        category: apiThresholdType,
                        category_name: 'Field',
                        imported_date: dateKey,
                        total_error: thresholdStats.total_error,
                        total_keying: thresholdStats.total_keying,
                        total_sample: thresholdStats.total_sample,
                        threshold_type: apiThresholdType,
                        threshold
                    });
                }
            }
        }

    } else if (reportLevel.toLowerCase() === 'record') {
        let total_error = 0;
        let total_keying = 0;
        let total_sample = 0;

        // 1. total_error: count records có lỗi (không trùng record_idx trong cùng doc)
        const uniqueErrorRecords = new Set();

        for (const doc of mistakeDocs) {
            for (const mistake of (doc.mistake_details || [])) {
                if (
                    AQC_PATTERN.test(mistake.task_final_name) &&
                    mistake.error_type !== 'not_error' &&
                    mistake.error_found_at === 'qc' &&
                    mistake.error_type !== 'suggestion'
                ) {
                    const errorKey = `${doc.doc_id}_${mistake.record_idx}`;
                    if (!uniqueErrorRecords.has(errorKey)) {
                        uniqueErrorRecords.add(errorKey);
                        total_error++;
                    }
                }
            }
        }

        // 2. total_keying: tổng total_record_document của tất cả doc (mặc định 1 nếu = 0)
        for (const doc of keyingDocs) {
            const recordCount = doc.total_record_document || 0;
            total_keying += recordCount === 0 ? 1 : recordCount;
        }

        // 3. total_sample: tổng (total_record_document của doc) cho các doc có isQc = true (mặc định 1 nếu = 0)
        for (const doc of keyingDocs) {
            const hasQcTask = (doc.keying_details || []).some(detail => detail.is_qc === true);
            if (hasQcTask) {
                const recordCount = doc.total_record_document || 0;
                total_sample += recordCount === 0 ? 1 : recordCount;
            }
        }

        // Xử lý multiple threshold types cho record level
        if (thresholdConfig && thresholdConfig.thresholds) {
            // Lấy tất cả threshold types cho Record scope từ version-specific config
            const recordThresholds = thresholdConfig.thresholds.filter(t =>
                t.thresholdScope === 'Record'
            );

            if (recordThresholds.length > 0) {
                // Tạo result cho từng threshold type
                for (const thresholdItem of recordThresholds) {
                    const thresholdType = thresholdItem.thresholdType || 'Critical';
                    const threshold = thresholdItem.thresholdPercentage;

                    // Convert threshold type cho API response format
                    let apiThresholdType = 'Critical'; // default
                    switch (thresholdType) {
                        case 'Critical':
                            apiThresholdType = 'Critical';
                            break;
                        case 'Non Critical':
                            apiThresholdType = 'Non Critical';
                            break;
                        default:
                            apiThresholdType = thresholdType;
                    }

                    results.push({
                        project_id: projectId,
                        report_level: 'record',
                        category: apiThresholdType,
                        category_name: 'Record',
                        imported_date: dateKey,
                        total_error,
                        total_keying,
                        total_sample,
                        threshold_type: apiThresholdType,
                        threshold
                    });
                }
            } else {
                // Fallback: Nếu không có threshold cho Record scope, tạo result mặc định
                results.push({
                    project_id: projectId,
                    report_level: 'record',
                    category: 'overall',
                    category_name: 'Record',
                    imported_date: dateKey,
                    total_error,
                    total_keying,
                    total_sample,
                    threshold_type: 'Critical',
                    threshold: "N/A"
                });
            }
        } else {
            // Fallback: Nếu không có thresholdConfig, tạo result mặc định
            results.push({
                project_id: projectId,
                report_level: 'record',
                category: 'overall',
                category_name: 'Record',
                imported_date: dateKey,
                total_error,
                total_keying,
                total_sample,
                threshold_type: 'Critical',
                threshold: "N/A"
            });
        }

    } else if (reportLevel.toLowerCase() === 'line_item') {
        let total_error = 0;
        let total_keying = 0;
        let total_sample = 0;

        // 1. total_error: count line items có lỗi (không trùng line_idx trong cùng doc)
        const uniqueErrorLineItems = new Set();

        for (const doc of mistakeDocs) {
            for (const mistake of (doc.mistake_details || [])) {
                if (
                    AQC_PATTERN.test(mistake.task_final_name) &&
                    mistake.error_type !== 'not_error' &&
                    mistake.error_found_at === 'qc' &&
                    mistake.error_type !== 'suggestion'
                ) {
                    const errorKey = `${doc.doc_id}_${mistake.line_idx}`;
                    if (!uniqueErrorLineItems.has(errorKey)) {
                        uniqueErrorLineItems.add(errorKey);
                        total_error++;
                    }
                }
            }
        }

        // 2. total_keying: tổng total_line_document của tất cả doc (mặc định 1 nếu = 0)
        for (const doc of keyingDocs) {
            const lineCount = doc.total_line_document || 0;
            total_keying += lineCount === 0 ? 1 : lineCount;
        }

        // 3. total_sample: tổng (total_line_document của doc) cho các doc có isQc = true (mặc định 1 nếu = 0)
        for (const doc of keyingDocs) {
            const hasQcTask = (doc.keying_details || []).some(detail => detail.is_qc === true);
            if (hasQcTask) {
                const lineCount = doc.total_line_document || 0;
                total_sample += lineCount === 0 ? 1 : lineCount;
            }
        }

        // Xử lý multiple threshold types cho line_item level
        if (thresholdConfig && thresholdConfig.thresholds) {
            // Lấy tất cả threshold types cho Line Item scope từ version-specific config
            const lineItemThresholds = thresholdConfig.thresholds.filter(t =>
                t.thresholdScope === 'Line Item'
            );

            if (lineItemThresholds.length > 0) {
                // Tạo result cho từng threshold type
                for (const thresholdItem of lineItemThresholds) {
                    const thresholdType = thresholdItem.thresholdType || 'Critical';
                    const threshold = thresholdItem.thresholdPercentage;

                    // Convert threshold type cho API response format
                    let apiThresholdType = 'Critical'; // default
                    switch (thresholdType) {
                        case 'Critical':
                            apiThresholdType = 'Critical';
                            break;
                        case 'Non Critical':
                            apiThresholdType = 'Non Critical';
                            break;
                        default:
                            apiThresholdType = thresholdType;
                    }

                    results.push({
                        project_id: projectId,
                        report_level: 'line_item',
                        category: apiThresholdType,
                        category_name: 'Line Item',
                        imported_date: dateKey,
                        total_error,
                        total_keying,
                        total_sample,
                        threshold_type: apiThresholdType,
                        threshold
                    });
                }
            } else {
                // Fallback: Nếu không có threshold cho Line Item scope, tạo result mặc định
                results.push({
                    project_id: projectId,
                    report_level: 'line_item',
                    category: 'overall',
                    category_name: 'Line Item',
                    imported_date: dateKey,
                    total_error,
                    total_keying,
                    total_sample,
                    threshold_type: 'Critical',
                    threshold: "N/A"
                });
            }
        } else {
            // Fallback: Nếu không có thresholdConfig, tạo result mặc định
            results.push({
                project_id: projectId,
                report_level: 'line_item',
                category: 'overall',
                category_name: 'Line Item',
                imported_date: dateKey,
                total_error,
                total_keying,
                total_sample,
                threshold_type: 'Critical',
                threshold: "N/A"
            });
        }
    } else if (reportLevel.toLowerCase() === 'character') {
        // Tính toán stats cho character level
        const characterStats = await calculateCharacterLevelStats(
            mistakeDocs,
            keyingDocs,
            AQC_PATTERN
        );

        // Xử lý multiple threshold types cho character level
        if (thresholdConfig && thresholdConfig.thresholds) {
            // Lấy tất cả threshold types cho Character scope từ version-specific config
            const characterThresholds = thresholdConfig.thresholds.filter(t =>
                t.thresholdScope === 'Character'
            );

            if (characterThresholds.length > 0) {
                // Tạo result cho từng threshold type
                for (const thresholdItem of characterThresholds) {
                    const thresholdType = thresholdItem.thresholdType || 'Critical';
                    const threshold = thresholdItem.thresholdPercentage;

                    // Convert threshold type cho API response format
                    let apiThresholdType = 'Critical'; // default
                    switch (thresholdType) {
                        case 'Critical':
                            apiThresholdType = 'Critical';
                            break;
                        case 'Non Critical':
                            apiThresholdType = 'Non Critical';
                            break;
                        default:
                            apiThresholdType = thresholdType;
                    }

                    results.push({
                        project_id: projectId,
                        report_level: 'character',
                        category: apiThresholdType,
                        category_name: 'Character',
                        imported_date: dateKey,
                        total_error: characterStats.total_error,
                        total_keying: characterStats.total_keying,
                        total_sample: characterStats.total_sample,
                        threshold_type: apiThresholdType,
                        threshold
                    });
                }
            } else {
                // Fallback: Nếu không có threshold cho Character scope, tạo result mặc định
                results.push({
                    project_id: projectId,
                    report_level: 'character',
                    category: 'overall',
                    category_name: 'Character',
                    imported_date: dateKey,
                    total_error: characterStats.total_error,
                    total_keying: characterStats.total_keying,
                    total_sample: characterStats.total_sample,
                    threshold_type: 'Critical',
                    threshold: "N/A"
                });
            }
        } else {
            // Fallback: Nếu không có thresholdConfig, tạo result mặc định
            results.push({
                project_id: projectId,
                report_level: 'character',
                category: 'overall',
                category_name: 'Character',
                imported_date: dateKey,
                total_error: characterStats.total_error,
                total_keying: characterStats.total_keying,
                total_sample: characterStats.total_sample,
                threshold_type: 'Critical',
                threshold: "N/A"
            });
        }
    }

    return results;
}

/**
 * Helper function để tính toán thống kê field level cho danh sách field cụ thể
 * @param {Array} mistakeDetailsDocs - Documents chứa mistake details
 * @param {Array} keyingAmountDocs - Documents chứa keying amount
 * @param {Array} targetFields - Danh sách field name cần tính toán
 * @param {Array} allFieldConfigs - Tất cả field configs để tính tỷ lệ
 * @param {RegExp} AQC_PATTERN - Pattern để match task final name
 * @param {RegExp} QC_PATTERN - Pattern để match task keyer name
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
 * API lấy danh sách lỗi chi tiết cho QC - defect-classification UI
 * Mặc định: chỉ lấy các lỗi có status WAIT_QC hoặc REJECTED_BY_PM với error_found_at=qc
 * Với include_all_statuses=true: lấy tất cả mistakes không filter theo status/error_found_at
 * @param {object} req - Express request object (đã có req.userId, req.user từ verifyJWTToken)
 * @param {string} req.query.project_id - Project ID (required)
 * @param {string} req.query.date - Ngày cụ thể (yyyy-mm-dd) (optional)
 * @param {string} req.query.date_from - Ngày bắt đầu (yyyy-mm-dd) (optional)
 * @param {string} req.query.date_to - Ngày kết thúc (yyyy-mm-dd) (optional)
 * @param {string|boolean} req.query.include_all_statuses - true để load tất cả mistakes (optional)
 * @returns {Promise<{items: Array, total: number}>}
 */
async function getMistakeReport(req, next) {
    try {
        const { project_id, date, date_from, date_to, include_all_statuses } = req.query;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id) {
            throw new handleMessage(message.REPORTING.MISSING_PARAMS, StatusCodes.BAD_REQUEST);
        }

        // Lấy connection default và tạo model động theo projectId
        const connection = getConnection('default');
        const MistakeReport = createMistakeDetailsModel(connection, project_id);

        // Build filter
        const filter = { project_id: new mongoose.Types.ObjectId(project_id) };

        // Xử lý filter ngày (imported_date)
        if (date_from || date_to) {
            // Range
            filter.imported_date = {};
            if (date_from) filter.imported_date.$gte = parseDateToUTC(date_from);
            if (date_to) filter.imported_date.$lte = parseDateToUTC(date_to, true);
        } else if (date) {
            // 1 ngày
            filter.imported_date = {
                $gte: parseDateToUTC(date),
                $lte: parseDateToUTC(date, true)
            };
        } else {
            // Default: ngày hiện tại GMT+7
            const now = new Date();
            const gmt7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);
            const yyyy = gmt7.getUTCFullYear();
            const mm = String(gmt7.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(gmt7.getUTCDate()).padStart(2, '0');
            filter.imported_date = {
                $gte: parseDateToUTC(`${yyyy}-${mm}-${dd}`),
                $lte: parseDateToUTC(`${yyyy}-${mm}-${dd}`, true)
            };
        }

        // Query để lấy tất cả doc thỏa filter ngày/project
        const docs = await MistakeReport.find(filter).lean();

        // Convert include_all_statuses thành boolean (kiểm tra string 'true' hoặc boolean true)
        const shouldIncludeAllStatuses = include_all_statuses === 'true' || include_all_statuses === true;

        // Log để debug
        if (shouldIncludeAllStatuses) {
            loggerInfo.info(`[getMistakeReport] Loading ALL mistakes for project ${project_id} without status filter`);
        }

        // Lọc các lỗi tùy theo tham số include_all_statuses
        let items = [];
        for (const doc of docs) {
            let mistakes;

            if (shouldIncludeAllStatuses) {
                // Load tất cả mistakes không filter theo status/error_found_at
                mistakes = doc.mistake_details || [];
            } else {
                // Logic cũ: chỉ lấy các lỗi có status WAIT_QC hoặc REJECTED_BY_PM (cho UI defect-classification)
                mistakes = (doc.mistake_details || []).filter(m =>
                    (m.status === 'WAIT_QC' || m.status === 'REJECTED_BY_PM') && m.error_found_at === 'qc'
                );
            }

            if (mistakes.length > 0) {
                items.push({ ...doc, mistake_details: mistakes });
            }
        }

        const total = items.length;
        return { items, total };
    } catch (error) {
        next(error);
    }
}

/**
 * API update error_type cho QC trong UI defect-classification
 * Optimistic lock và logic kết thúc quy trình khi gán not_error cho lỗi đã reject
 * @param {object} req - Express request object
 * @returns {Promise<object>} - document sau update
 */
async function updateErrorType(req, next) {
    let session;
    try {
        const { project_id, doc_id, error_id, error_type, reason } = req.body;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id || !doc_id || !error_id || !error_type) {
            throw new handleMessage(message.REPORTING.MISSING_PARAMS, StatusCodes.BAD_REQUEST);
        }

        const connection = getConnection('default');
        const MistakeReport = createMistakeDetailsModel(connection, project_id);

        // Bắt đầu transaction
        session = await connection.startSession();
        session.startTransaction();

        // Optimistic lock: Lấy doc trước để kiểm tra status hiện tại
        const doc = await MistakeReport.findOne({
            project_id: new mongoose.Types.ObjectId(project_id),
            doc_id: new mongoose.Types.ObjectId(doc_id),
            'mistake_details._id': new mongoose.Types.ObjectId(error_id)
        }).session(session);

        if (!doc) {
            throw new handleMessage(message.REPORTING.NOT_FOUND, StatusCodes.NOT_FOUND);
        }

        const mistake = (doc.mistake_details || []).find(m => m._id.toString() === error_id);
        if (!mistake) {
            throw new handleMessage(message.REPORTING.NOT_FOUND, StatusCodes.NOT_FOUND);
        }

        // Optimistic lock: Chỉ cho phép update nếu status = WAIT_QC hoặc REJECTED_BY_PM
        if (!['WAIT_QC', 'REJECTED_BY_PM'].includes(mistake.status)) {
            throw new handleMessage(message.REPORTING.INVALID_STATUS_FOR_OPERATION, StatusCodes.CONFLICT);
        }

        // Xác định status mới dựa trên logic nghiệp vụ
        let newStatus;
        let updateOps = {
            'mistake_details.$.error_type': error_type
        };

        // Xử lý reason array từ frontend
        if (reason && Array.isArray(reason) && reason.length > 0) {
            const reasonHistory = reason.map(r => ({
                action: r.action || 'QC_EDIT', // Sử dụng action từ frontend hoặc default
                user_id: r.user_id ? new mongoose.Types.ObjectId(r.user_id) : new mongoose.Types.ObjectId(userId), // Sử dụng user_id từ frontend hoặc fallback
                user_name: r.user_name || user.fullName || user.username, // FIX: Ưu tiên user_name từ frontend
                content: r.content || r.comment || '', // FIX: Nhận 'content' từ frontend, fallback 'comment'
                createdDate: r.createdDate ? new Date(r.createdDate) : new Date() // Sử dụng createdDate từ frontend hoặc current
            }));
            updateOps['mistake_details.$.reason'] = [...(mistake.reason || []), ...reasonHistory];
        }

        if (mistake.status === 'REJECTED_BY_PM' && error_type === 'not_error') {
            // Trường hợp đặc biệt: PM đã reject, QC gán lại là not_error => kết thúc quy trình
            newStatus = 'DONE';
            // updateOps['mistake_details.$.error_found_at'] = '';
        } else {
            // Trường hợp thông thường: chuyển sang WAIT_PM để PM xem xét
            newStatus = 'WAIT_PM';
        }

        updateOps['mistake_details.$.status'] = newStatus;

        // Update với optimistic lock
        const updateResult = await MistakeReport.updateOne(
            {
                project_id: new mongoose.Types.ObjectId(project_id),
                doc_id: new mongoose.Types.ObjectId(doc_id),
                'mistake_details._id': new mongoose.Types.ObjectId(error_id),
                'mistake_details.status': { $in: ['WAIT_QC', 'REJECTED_BY_PM'] } // Optimistic lock condition
            },
            { $set: updateOps },
            { session }
        );

        // Kiểm tra kết quả update (optimistic lock check)
        if (updateResult.matchedCount === 0) {
            throw new handleMessage(message.REPORTING.RECORD_MODIFIED_BY_ANOTHER_USER, StatusCodes.CONFLICT);
        }

        // Lấy comment từ reason input được truyền từ frontend
        const currentActionComment = getCommentFromReasonInput(reason);

        // Ghi activity_log với thông tin đầy đủ
        await logActivity({
            user_id: userId,
            user_name: user || `User_${userId}`, // Fallback với userId nếu không có tên
            action: newStatus === 'DONE' ? 'QC_FINALIZE' : 'QC_ASSIGN',
            doc_id,
            error_id,
            old_value: {
                error_type: mistake.error_type,
                status: mistake.status
            },
            new_value: {
                error_type,
                status: newStatus
            },
            reason: newStatus === 'DONE' ? 'Marked as not_error after PM rejection - case closed' : 'Error type assigned by QC',
            user_comment: currentActionComment, // Comment từ action hiện tại
            session
        });

        await session.commitTransaction();

        // Trả lại doc mới nhất
        const result = await MistakeReport.findOne({
            project_id: new mongoose.Types.ObjectId(project_id),
            doc_id: new mongoose.Types.ObjectId(doc_id)
        }).lean();

        return result;
    } catch (err) {
        if (session) {
            try {
                await session.abortTransaction();
            } catch (abortError) {
                // Log abort error nhưng không throw để tránh che lấp lỗi gốc
                loggerInfo.error('[updateErrorType] Error aborting transaction:', abortError);
            }
        }
        throw err; // Throw lỗi gốc thay vì gọi next
    } finally {
        // Đảm bảo session được đóng trong mọi trường hợp
        if (session) {
            try {
                session.endSession();
            } catch (endError) {
                loggerInfo.error('[updateErrorType] Error ending session:', endError);
            }
        }
    }
}

/**
 * API lấy danh sách lỗi cho PM - defect-approval UI
 * Chỉ lấy các lỗi có status: WAIT_PM
 * @param {object} req - Express request object
 * @returns {Promise<{items: Array, total: number}>}
 */
async function getMistakeForPM(req, next) {
    try {
        const { project_id, date, date_from, date_to } = req.query;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id) {
            throw new handleMessage(message.REPORTING.MISSING_PARAMS, StatusCodes.BAD_REQUEST);
        }

        const connection = getConnection('default');
        const MistakeReport = createMistakeDetailsModel(connection, project_id);

        // Build filter
        const filter = { project_id: new mongoose.Types.ObjectId(project_id) };

        if (date_from || date_to) {
            filter.imported_date = {};
            if (date_from) filter.imported_date.$gte = parseDateToUTC(date_from);
            if (date_to) filter.imported_date.$lte = parseDateToUTC(date_to, true);
        } else if (date) {
            filter.imported_date = {
                $gte: parseDateToUTC(date),
                $lte: parseDateToUTC(date, true)
            };
        } else {
            const now = new Date();
            const gmt7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);
            const yyyy = gmt7.getUTCFullYear();
            const mm = String(gmt7.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(gmt7.getUTCDate()).padStart(2, '0');
            filter.imported_date = {
                $gte: parseDateToUTC(`${yyyy}-${mm}-${dd}`),
                $lte: parseDateToUTC(`${yyyy}-${mm}-${dd}`, true)
            };
        }

        const docs = await MistakeReport.find(filter).lean();

        // Lọc các lỗi có status WAIT_PM (cho UI defect-approval)
        let items = [];
        for (const doc of docs) {
            const mistakes = (doc.mistake_details || []).filter(m => m.status === 'WAIT_PM');
            if (mistakes.length > 0) {
                items.push({ ...doc, mistake_details: mistakes });
            }
        }

        const total = items.length;
        return { items, total };
    } catch (error) {
        next(error);
    }
}

/**
 * Ghi activity log với history - append vào history array thay vì override
 * @param {object} params - Thông tin activity log  
 * @param {mongoose.ClientSession} session - Database session cho transaction
 */
async function logActivity({ user_id, user_name, action, doc_id, error_id, old_value, new_value, reason, user_comment = '', session = null }) {
    try {
        const { schema: activityLogSchema, collectionName: activityLogCollectionName } = require('../models/reporting/activityLog.model');
        const connection = getConnection('default');
        const ActivityLog = connection.model(activityLogCollectionName, activityLogSchema, activityLogCollectionName);

        // Validate và ensure user_name không rỗng
        const isValidUserName = user_name && typeof user_name === 'string' && user_name.trim() !== '';
        const validatedUserName = isValidUserName ? user_name.trim() : 'Unknown User';

        if (!isValidUserName) {
            loggerInfo.warn(`[Activity Log] Missing or invalid user_name for user_id: ${user_id}, using fallback: ${validatedUserName}`);
        }

        // Tạo action history entry mới
        const newHistoryEntry = {
            user_id: new mongoose.Types.ObjectId(user_id),
            user_name: validatedUserName,
            action,
            old_value,
            new_value,
            reason: reason || '',
            user_comment: user_comment || '',
            action_date: new Date()
        };

        // Filter để tìm document
        const filter = {
            doc_id: new mongoose.Types.ObjectId(doc_id),
            error_id: new mongoose.Types.ObjectId(error_id)
        };

        // Update để append vào history array và cập nhật last_* fields
        const updateOps = {
            $push: {
                history: newHistoryEntry
            },
            $set: {
                last_action: action,
                last_user: validatedUserName, // Sử dụng validatedUserName để đảm bảo consistency
                last_updated: new Date()
            },
            $setOnInsert: {
                doc_id: new mongoose.Types.ObjectId(doc_id),
                error_id: new mongoose.Types.ObjectId(error_id)
            }
        };

        const options = {
            upsert: true,
            new: true,
            runValidators: true
        };

        if (session) {
            options.session = session;
        }

        await ActivityLog.findOneAndUpdate(filter, updateOps, options);

        // Log thành công
        loggerInfo.info(`[Activity Log] Successfully logged action: ${action} for doc_id: ${doc_id}, error_id: ${error_id}`);
    } catch (error) {
        // Log lỗi nhưng không throw để không ảnh hưởng transaction chính
        loggerInfo.error('[Activity Log] Error writing activity log:', error);
    }
}

/**
 * PM approve lỗi với optimistic lock và transaction
 * @param {object} req - Express request object
 * @returns {Promise<object>} - Kết quả approve
 */
async function approveMistake(req, next) {
    let session;
    try {
        const { project_id, doc_id, error_id, reason } = req.body;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id || !doc_id || !error_id) {
            throw new handleMessage(message.REPORTING.MISSING_PARAMS, StatusCodes.BAD_REQUEST);
        }

        const connection = getConnection('default');
        session = await connection.startSession();
        session.startTransaction();

        const MistakeReport = createMistakeDetailsModel(connection, project_id);
        const { schema: mistakeApprovalSchema, collectionName: mistakeApprovalCollectionName } = require('../models/reporting/mistakeApproval.model');
        const MistakeApproval = connection.model(mistakeApprovalCollectionName, mistakeApprovalSchema, mistakeApprovalCollectionName);

        // Optimistic lock: Lấy doc và kiểm tra status
        const toId = v => mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : v;
        const doc = await MistakeReport.findOne({
            project_id: toId(project_id),
            doc_id: toId(doc_id),
            mistake_details: { $elemMatch: { _id: toId(error_id), status: 'WAIT_PM' } } // Optimistic lock condition
        }).session(session);

        if (!doc) {
            throw new handleMessage(message.REPORTING.NOT_FOUND, StatusCodes.CONFLICT);
        }

        const mistake = (doc.mistake_details || []).find(m => m._id.toString() === error_id);
        if (!mistake || mistake.status !== 'WAIT_PM') {
            throw new handleMessage(message.REPORTING.INVALID_STATUS_FOR_OPERATION, StatusCodes.CONFLICT);
        }

        // Xác định status cuối cùng
        let finalStatus = 'APPROVED_BY_PM';
        let updateOps = {
            'mistake_details.$.status': finalStatus,
        };

        // Nếu error_type = not_error thì set error_found_at = rỗng và chuyển thành DONE
        if (mistake.error_type === 'not_error') {
            // updateOps['mistake_details.$.error_found_at'] = '';
            finalStatus = 'DONE';
            updateOps['mistake_details.$.status'] = finalStatus;
        }

        // Update với optimistic lock
        const updateResult = await MistakeReport.updateOne(
            {
                project_id: toId(project_id),
                doc_id: toId(doc_id),
                'mistake_details._id': toId(error_id),
                'mistake_details.status': 'WAIT_PM' // Optimistic lock condition
            },
            {
                $set: updateOps,
                $push: {
                    'mistake_details.$.reason': {
                        action: 'APPROVED',
                        user_id: userId,
                        user_name: user.fullName || user.username,
                        content: reason || '',
                        createdDate: new Date()
                    }
                }
            },
            { session }
        );

        // Kiểm tra optimistic lock
        if (updateResult.matchedCount === 0) {
            throw new handleMessage(message.REPORTING.OPTIMISTIC_LOCK_FAILED, StatusCodes.CONFLICT);
        }

        // Copy sang mistake_approval chỉ khi APPROVED_BY_PM
        if (finalStatus === 'APPROVED_BY_PM') {
            await MistakeApproval.create([{
                mistake_report_id: doc._id,
                doc_id: doc.doc_id,
                project_id: doc.project_id,
                batch_id: doc.batch_id,
                error_id: mistake._id,
                error_step: mistake.task_keyer_name,
                error_type: mistake.error_type,
                approved_by: userId,
                approved_by_name: user.fullName || user.username
            }], { session });
        }

        // Ghi activity_log với thông tin đầy đủ - reason parameter chính là comment hiện tại
        await logActivity({
            user_id: userId,
            user_name: user.fullName || user.username || `User_${userId}`, // Fallback với userId nếu không có tên
            action: finalStatus === 'DONE' ? 'PM_APPROVE_CLOSE' : 'PM_APPROVE',
            doc_id,
            error_id,
            old_value: { status: mistake.status },
            new_value: { status: finalStatus },
            reason: reason || '',
            user_comment: reason || '', // Comment từ action hiện tại (PM comment)
            session
        });

        await session.commitTransaction();
        session.endSession();

        return { success: true, final_status: finalStatus };
    } catch (err) {
        if (session) {
            await session.abortTransaction();
            session.endSession();
        }
        next(err);
    }
}

/**
 * PM reject lỗi với optimistic lock và transaction
 * @param {object} req - Express request object  
 * @returns {Promise<object>} - Kết quả reject
 */
async function rejectMistake(req, next) {
    let session;
    try {
        const { project_id, doc_id, error_id, reason } = req.body;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id || !doc_id || !error_id || !reason) {
            throw new handleMessage(message.REPORTING.MISSING_PARAMS, StatusCodes.BAD_REQUEST);
        }

        const connection = getConnection('default');
        session = await connection.startSession();
        session.startTransaction();

        const MistakeReport = createMistakeDetailsModel(connection, project_id);

        // Optimistic lock: Lấy doc và kiểm tra status
        const doc = await MistakeReport.findOne({
            project_id: new mongoose.Types.ObjectId(project_id),
            doc_id: new mongoose.Types.ObjectId(doc_id),
            'mistake_details._id': new mongoose.Types.ObjectId(error_id),
            'mistake_details.status': 'WAIT_PM' // Optimistic lock condition
        }).session(session);

        if (!doc) {
            throw new handleMessage(message.REPORTING.NOT_FOUND, StatusCodes.CONFLICT);
        }

        const mistake = (doc.mistake_details || []).find(m => m._id.toString() === error_id);
        if (!mistake || mistake.status !== 'WAIT_PM') {
            throw new handleMessage(message.REPORTING.INVALID_STATUS_FOR_OPERATION, StatusCodes.CONFLICT);
        }

        // Update với optimistic lock
        const updateResult = await MistakeReport.updateOne(
            {
                project_id: new mongoose.Types.ObjectId(project_id),
                doc_id: new mongoose.Types.ObjectId(doc_id),
                'mistake_details._id': new mongoose.Types.ObjectId(error_id),
                'mistake_details.status': 'WAIT_PM' // Optimistic lock condition
            },
            {
                $set: { 'mistake_details.$.status': 'REJECTED_BY_PM' },
                $push: {
                    'mistake_details.$.reason': {
                        action: 'REJECTED',
                        user_id: userId,
                        user_name: user.fullName || user.username,
                        content: reason,
                        createdDate: new Date()
                    }
                }
            },
            { session }
        );

        // Kiểm tra optimistic lock
        if (updateResult.matchedCount === 0) {
            throw new handleMessage(message.REPORTING.OPTIMISTIC_LOCK_FAILED, StatusCodes.CONFLICT);
        }

        // Ghi activity_log với thông tin đầy đủ - reason parameter chính là comment hiện tại
        await logActivity({
            user_id: userId,
            user_name: user || `User_${userId}`, // Fallback với userId nếu không có tên
            action: 'PM_REJECT',
            doc_id,
            error_id,
            old_value: { status: mistake.status },
            new_value: { status: 'REJECTED_BY_PM' },
            reason,
            user_comment: reason || '', // Comment từ action hiện tại (PM comment)
            session
        });

        await session.commitTransaction();
        session.endSession();

        return { success: true };
    } catch (error) {
        if (session) {
            await session.abortTransaction();
            session.endSession();
        }
        next(error);
    }
}

/**
 * API lấy thông tin chất lượng dự án theo document hoặc field level - VERSION AWARE
 * @param {object} req - Express request object
 * @returns {Promise<Array>} - Array of quality stats grouped by imported_date, versions and threshold_type/scope
 */
async function getProjectQualityStats(req, next) {
    try {
        const { project_id, date_from, date_to, report_level, version_aware = 'true' } = req.query;
        const userId = req.userId;
        const user = req.user;

        // Validate input
        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id || !date_from || !date_to || !report_level) {
            throw new handleMessage(message.REPORTING.MISSING_PARAMS, StatusCodes.BAD_REQUEST);
        }
        if (!['document', 'field', 'record', 'line_item', 'character'].includes(report_level.toLowerCase())) {
            throw new handleMessage('Invalid report_level. Must be "document", "field", "record", "line_item", or "character"', StatusCodes.BAD_REQUEST);
        }

        // Convert date params to UTC
        const dateFromUTC = parseDateToUTC(date_from);
        const dateToUTC = parseDateToUTC(date_to, true);

        // Kiểm tra thời gian hợp lệ
        if (!dateFromUTC || !dateToUTC || dateFromUTC > dateToUTC) {
            throw new handleMessage('Invalid date range', StatusCodes.BAD_REQUEST);
        }

        // Quyết định sử dụng logic version-aware hay legacy
        const useVersionAware = version_aware === 'true' || version_aware === true;

        if (useVersionAware) {
            loggerInfo.info(`[getProjectQualityStats] Using VERSION-BASED mode for project ${project_id}`);
            return await getVersionAwareQualityStats(project_id, dateFromUTC, dateToUTC, report_level, userId, user);
        } else {
            loggerInfo.info(`[getProjectQualityStats] Using LEGACY mode (ignores document versions) for project ${project_id}`);
            return await getLegacyQualityStats(project_id, dateFromUTC, dateToUTC, report_level, userId, user);
        }
    } catch (error) {
        next(error);
        return null;
    }
}

/**
 * Version-based quality stats implementation
 * Uses document version info to determine exact configs used during processing
 */
async function getVersionAwareQualityStats(project_id, dateFromUTC, dateToUTC, report_level, userId, user) {
    // Lấy connection và tạo model động theo projectId
    const connection = getConnection('default');
    const MistakeDetails = createMistakeDetailsModel(connection, project_id);
    const { createModel: createKeyingAmountModel } = require('../models/reporting/keyingAmount.model');
    const KeyingAmount = createKeyingAmountModel(connection, project_id);

    // Lấy pattern từ DB thông qua helper
    let { AQC_PATTERN } = await getQcPatterns();

    // Lấy tất cả document từ keying_amount trong khoảng ngày đã chọn
    const keyingAmountDocs = await KeyingAmount.find({
        imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
    }).lean();

    // Trả về kết quả rỗng nếu không có dữ liệu
    if (!keyingAmountDocs || keyingAmountDocs.length === 0) {
        return [];
    }

    // Lấy danh sách doc_id để tìm trong mistake_details
    const docIds = keyingAmountDocs.map(doc => doc.doc_id);

    // Lấy dữ liệu từ mistake_details cho các doc_id
    const mistakeDetailsDocs = await MistakeDetails.find({
        doc_id: { $in: docIds },
        imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
    }).lean();

    loggerInfo.info(`[Version-Based] Project ${project_id}: Found ${keyingAmountDocs.length} keying documents and ${mistakeDetailsDocs.length} documents with mistakes`);

    // Group documents theo date + config versions
    const groupedData = groupDocumentsByVersions(keyingAmountDocs, mistakeDetailsDocs);

    // Process từng group version combination
    const results = [];

    for (const [groupKey, groupData] of Object.entries(groupedData)) {
        const { dateKey, fieldConfigVersion, projectThresholdVersion, keyingDocs, mistakeDocs, versionInfo } = groupData;

        loggerInfo.info(`[Version-Based] Processing group: ${groupKey} with ${keyingDocs.length} keying docs, ${mistakeDocs.length} mistake docs`);

        // Lấy config theo version từ group
        const fieldConfig = await getFieldConfigByVersion(project_id, fieldConfigVersion, connection);
        const thresholdConfig = await getProjectThresholdByVersion(project_id, projectThresholdVersion, connection);

        // DEBUG LOG: Log threshold config được load
        loggerInfo.info(`[getVersionAwareQualityStats] Processing group: ${groupKey}`);
        loggerInfo.info(`[getVersionAwareQualityStats] ThresholdConfig loaded - version: ${thresholdConfig?.version}, thresholds count: ${thresholdConfig?.thresholds?.length || 0}`);
        if (thresholdConfig?.thresholds) {
            thresholdConfig.thresholds.forEach((t, idx) => {
                loggerInfo.info(`[getVersionAwareQualityStats] Threshold ${idx}: scope=${t.thresholdScope}, type=${t.thresholdType}, percentage=${t.thresholdPercentage}`);
            });
        }

        // Process theo report level với version-specific configs
        const groupResults = await processGroupByReportLevel(
            report_level,
            keyingDocs,
            mistakeDocs,
            fieldConfig,
            thresholdConfig,
            AQC_PATTERN,
            project_id,
            connection,
            dateKey
        );

        // Thêm version info vào mỗi result
        groupResults.forEach(result => {
            result.field_configuration_version = fieldConfigVersion;
            result.project_threshold_version = projectThresholdVersion;
            result.config_metadata = {
                field_config_updated_at: versionInfo.field_config_updated_at,
                project_threshold_updated_at: versionInfo.project_threshold_updated_at,
                processed_at_range: versionInfo.processed_at_range
            };
        });

        results.push(...groupResults);
    }

    // Post-processing: Merge results có cùng report_level, threshold_type, threshold và imported_date
    const mergedResults = mergeResultsBySameThreshold(results);

    loggerInfo.info(`[Version-Based] Project ${project_id}: Generated ${results.length} results across ${Object.keys(groupedData).length} version groups, merged to ${mergedResults.length} final results`);
    return mergedResults;
}

/**
 * Legacy quality stats implementation (unchanged)
 */
async function getLegacyQualityStats(project_id, dateFromUTC, dateToUTC, report_level, userId, user) {
    // Lấy connection và tạo model động theo projectId
    const connection = getConnection('default');
    const MistakeDetails = createMistakeDetailsModel(connection, project_id);

    // Tạo model KeyingAmount
    const { createModel: createKeyingAmountModel } = require('../models/reporting/keyingAmount.model');
    const KeyingAmount = createKeyingAmountModel(connection, project_id);

    // Lấy project threshold configuration (latest active version)
    const ProjectThreshold = connection.model(projectThresholdCollectionName, projectThresholdSchema, projectThresholdCollectionName);
    const thresholdConfig = await ProjectThreshold.findOne({
        projectId: new mongoose.Types.ObjectId(project_id),
        isActive: true
    }).lean();

    // Lấy pattern từ DB thông qua helper
    let { AQC_PATTERN } = await getQcPatterns();

    // Lấy tất cả document từ keying_amount trong khoảng ngày đã chọn
    // Vì số lượng document nhập liệu luôn >= số lượng document có lỗi
    const keyingAmountDocs = await KeyingAmount.find({
        imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
    }).lean();

    // Trả về kết quả rỗng nếu không có dữ liệu
    if (!keyingAmountDocs || keyingAmountDocs.length === 0) {
        return [];
    }

    // Lấy danh sách doc_id để tìm trong mistake_details
    const docIds = keyingAmountDocs.map(doc => doc.doc_id);

    // Lấy dữ liệu từ mistake_details cho các doc_id
    const mistakeDetailsDocs = await MistakeDetails.find({
        doc_id: { $in: docIds },
        imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
    }).lean();

    // Không bắt buộc số lượng phải khớp, vì có thể có document nhập liệu nhưng không có lỗi
    loggerInfo.info(`[Legacy] Project ${project_id}: Found ${keyingAmountDocs.length} keying documents and ${mistakeDetailsDocs.length} documents with mistakes`);

    // Group documents theo imported_date (legacy way)
    const keyingDocsByDate = {};
    const mistakeDocsByDate = {};

    // Group keying documents theo ngày GMT+7
    keyingAmountDocs.forEach(doc => {
        const dateKey = convertUTCToGMT7DateString(doc.imported_date); // Convert UTC to GMT+7 date
        if (!keyingDocsByDate[dateKey]) {
            keyingDocsByDate[dateKey] = [];
        }
        keyingDocsByDate[dateKey].push(doc);
    });

    // Group mistake documents theo ngày GMT+7
    mistakeDetailsDocs.forEach(doc => {
        const dateKey = convertUTCToGMT7DateString(doc.imported_date); // Convert UTC to GMT+7 date
        if (!mistakeDocsByDate[dateKey]) {
            mistakeDocsByDate[dateKey] = [];
        }
        mistakeDocsByDate[dateKey].push(doc);
    });

    // Helper function để lấy threshold percentage theo loại (legacy)
    const getThresholdPercentage = (reportLevel, thresholdType = null) => {
        return getThresholdPercentageByVersion(thresholdConfig, reportLevel, thresholdType);
    };

    // Chuẩn bị kết quả trả về dựa trên report_level
    const results = [];

    if (report_level.toLowerCase() === 'document') {
        // Tính toán thống kê cho document level - group theo imported_date

        // Lấy tất cả ngày có dữ liệu
        const allDates = new Set([
            ...Object.keys(keyingDocsByDate),
            ...Object.keys(mistakeDocsByDate)
        ]);

        for (const dateKey of allDates) {
            const keyingDocsForDate = keyingDocsByDate[dateKey] || [];
            const mistakeDocsForDate = mistakeDocsByDate[dateKey] || [];

            let total_error = 0;
            let total_keying = 0;
            let total_sample = 0;

            // 1. total_error: count document có lỗi cho ngày này
            for (const doc of mistakeDocsForDate) {
                const hasError = (doc.mistake_details || []).some(mistake =>
                    mistake.error_found_at === 'qc' &&
                    mistake.error_type !== 'not_error' &&
                    mistake.error_type !== 'suggestion'
                );
                if (hasError) {
                    total_error++;
                }
            }

            // 2. total_keying: tổng số document từ keying_amount cho ngày này
            total_keying = keyingDocsForDate.length;

            // 3. total_sample: tổng số document có bất kỳ task nào là QC cho ngày này
            for (const doc of keyingDocsForDate) {
                const isQcDoc = (doc.keying_details || []).some(detail => detail.is_qc === true);
                if (isQcDoc) {
                    total_sample++;
                }
            }

            // Lấy threshold percentage cho document level
            const threshold = getThresholdPercentage('document');

            results.push({
                report_level: 'document',
                category: 'overall',
                category_name: 'Document',
                imported_date: dateKey,
                total_error,
                total_keying,
                total_sample,
                threshold_type: 'Critical',
                threshold
            });
        }

    } else if (report_level.toLowerCase() === 'field') {
        // Field level: group theo cả imported_date và threshold_type

        // Lấy field configs để xác định các threshold types
        const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../models/reporting/fieldDefinitionCollection.model');
        const ProjectFieldConfiguration = connection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

        // Lấy project field configuration (version mới nhất active)
        const projectFieldConfig = await ProjectFieldConfiguration.findOne(
            {
                project_id: new mongoose.Types.ObjectId(project_id),
                isActive: true
            },
            { fields: 1 }
        ).sort({ version: -1 }).lean();

        let fieldConfigs = [];
        if (projectFieldConfig && projectFieldConfig.fields) {
            // Lọc fields có is_report_count !== false
            fieldConfigs = projectFieldConfig.fields.filter(field => field.is_report_count !== false);
        }

        if (fieldConfigs && fieldConfigs.length > 0) {
            // Lấy tất cả ngày có dữ liệu
            const allDates = new Set([
                ...Object.keys(keyingDocsByDate),
                ...Object.keys(mistakeDocsByDate)
            ]);

            // Group fields theo threshold type (critical_field values)
            const fieldsByThreshold = {};
            fieldConfigs.forEach(field => {
                const thresholdType = field.critical_field || 'Critical';
                if (!fieldsByThreshold[thresholdType]) {
                    fieldsByThreshold[thresholdType] = [];
                }
                fieldsByThreshold[thresholdType].push(field.field_name);
            });

            // Tạo results cho từng combination của date và threshold type
            for (const dateKey of allDates) {
                const keyingDocsForDate = keyingDocsByDate[dateKey] || [];
                const mistakeDocsForDate = mistakeDocsByDate[dateKey] || [];

                for (const [thresholdType, fieldNames] of Object.entries(fieldsByThreshold)) {
                    if (fieldNames && fieldNames.length > 0) {
                        // Tính toán stats cho nhóm fields này trong ngày này
                        const thresholdStats = await calculateFieldLevelStats(
                            mistakeDocsForDate,
                            keyingDocsForDate,
                            fieldNames,
                            fieldConfigs,
                            AQC_PATTERN
                        );

                        // Lấy threshold percentage cho field level với thresholdType này
                        const threshold = getThresholdPercentage('field', thresholdType);

                        // Convert threshold type cho API response format
                        let apiThresholdType = 'Critical'; // default
                        switch (thresholdType) {
                            case 'Critical':
                                apiThresholdType = 'Critical';
                                break;
                            case 'Non Critical':
                                apiThresholdType = 'Non Critical';
                                break;
                            default:
                                apiThresholdType = thresholdType;
                        }

                        results.push({
                            report_level: 'field',
                            category: apiThresholdType,
                            category_name: 'Field',
                            imported_date: dateKey,
                            total_error: thresholdStats.total_error,
                            total_keying: thresholdStats.total_keying,
                            total_sample: thresholdStats.total_sample,
                            threshold_type: apiThresholdType,
                            threshold
                        });
                    }
                }
            }

            // Nếu không có threshold type nào được tìm thấy, tạo result mặc định cho mỗi ngày
            if (Object.keys(fieldsByThreshold).length === 0) {
                const allDates = new Set([
                    ...Object.keys(keyingDocsByDate),
                    ...Object.keys(mistakeDocsByDate)
                ]);

                for (const dateKey of allDates) {
                    const threshold = getThresholdPercentage('field', 'Critical');

                    results.push({
                        report_level: 'field',
                        category: 'overall',
                        category_name: 'Field',
                        imported_date: dateKey,
                        total_error: 0,
                        total_keying: 0,
                        total_sample: 0,
                        threshold_type: 'Critical',
                        threshold
                    });
                }
            }
        } else {
            // Không có field config, tạo result mặc định cho mỗi ngày
            const allDates = new Set([
                ...Object.keys(keyingDocsByDate),
                ...Object.keys(mistakeDocsByDate)
            ]);

            for (const dateKey of allDates) {
                const threshold = getThresholdPercentage('field', 'Critical');

                results.push({
                    report_level: 'field',
                    category: 'overall',
                    category_name: 'Field',
                    imported_date: dateKey,
                    total_error: 0,
                    total_keying: 0,
                    total_sample: 0,
                    threshold_type: 'Critical',
                    threshold
                });
            }
        }
    } else if (report_level.toLowerCase() === 'record') {
        // Tính toán thống kê cho record level - group theo imported_date

        // Lấy tất cả ngày có dữ liệu
        const allDates = new Set([
            ...Object.keys(keyingDocsByDate),
            ...Object.keys(mistakeDocsByDate)
        ]);

        for (const dateKey of allDates) {
            const keyingDocsForDate = keyingDocsByDate[dateKey] || [];
            const mistakeDocsForDate = mistakeDocsByDate[dateKey] || [];

            let total_error = 0;
            let total_keying = 0;
            let total_sample = 0;

            // 1. total_error: count records có lỗi cho ngày này (không trùng record_idx trong cùng doc)
            const uniqueErrorRecords = new Set();

            for (const doc of mistakeDocsForDate) {
                for (const mistake of (doc.mistake_details || [])) {
                    if (
                        AQC_PATTERN.test(mistake.task_final_name) &&
                        mistake.error_type !== 'not_error' &&
                        mistake.error_found_at === 'qc' &&
                        mistake.error_type !== 'suggestion'
                    ) {
                        // Tạo key duy nhất cho record error: doc_id + record_idx
                        const errorKey = `${doc.doc_id}_${mistake.record_idx}`;

                        // Chỉ count 1 lần per record_idx trong mỗi document
                        if (!uniqueErrorRecords.has(errorKey)) {
                            uniqueErrorRecords.add(errorKey);
                            total_error++;
                        }
                    }
                }
            }

            // 2. total_keying: tổng total_record_document của tất cả doc trong ngày này (mặc định 1 nếu = 0)
            for (const doc of keyingDocsForDate) {
                const recordCount = doc.total_record_document || 0;
                total_keying += recordCount === 0 ? 1 : recordCount;
            }

            // 3. total_sample: tổng (total_record_document của doc) cho các doc có isQc = true trong ngày này (mặc định 1 nếu = 0)
            for (const doc of keyingDocsForDate) {
                const hasQcTask = (doc.keying_details || []).some(detail => detail.is_qc === true);
                if (hasQcTask) {
                    const recordCount = doc.total_record_document || 0;
                    total_sample += recordCount === 0 ? 1 : recordCount;
                }
            }

            // Lấy threshold percentage cho record level
            const threshold = getThresholdPercentage('record');

            results.push({
                report_level: 'record',
                category: 'overall',
                category_name: 'Record',
                imported_date: dateKey,
                total_error,
                total_keying,
                total_sample,
                threshold_type: 'Critical',
                threshold
            });
        }
    } else if (report_level.toLowerCase() === 'line_item') {
        // Tính toán thống kê cho line_item level - group theo imported_date

        // Lấy tất cả ngày có dữ liệu
        const allDates = new Set([
            ...Object.keys(keyingDocsByDate),
            ...Object.keys(mistakeDocsByDate)
        ]);

        for (const dateKey of allDates) {
            const keyingDocsForDate = keyingDocsByDate[dateKey] || [];
            const mistakeDocsForDate = mistakeDocsByDate[dateKey] || [];

            let total_error = 0;
            let total_keying = 0;
            let total_sample = 0;

            // 1. total_error: count line items có lỗi cho ngày này (không trùng line_idx trong cùng doc)
            const uniqueErrorLineItems = new Set();

            for (const doc of mistakeDocsForDate) {
                for (const mistake of (doc.mistake_details || [])) {
                    if (
                        AQC_PATTERN.test(mistake.task_final_name) &&
                        mistake.error_type !== 'not_error' &&
                        mistake.error_found_at === 'qc' &&
                        mistake.error_type !== 'suggestion'
                    ) {
                        const errorKey = `${doc.doc_id}_${mistake.line_idx}`;
                        if (!uniqueErrorLineItems.has(errorKey)) {
                            uniqueErrorLineItems.add(errorKey);
                            total_error++;
                        }
                    }
                }
            }

            // 2. total_keying: tổng total_line_document của tất cả doc (mặc định 1 nếu = 0)
            for (const doc of keyingDocsForDate) {
                const lineCount = doc.total_line_document || 0;
                total_keying += lineCount === 0 ? 1 : lineCount;
            }

            // 3. total_sample: tổng (total_line_document của doc) cho các doc có isQc = true (mặc định 1 nếu = 0)
            for (const doc of keyingDocsForDate) {
                const hasQcTask = (doc.keying_details || []).some(detail => detail.is_qc === true);
                if (hasQcTask) {
                    const lineCount = doc.total_line_document || 0;
                    total_sample += lineCount === 0 ? 1 : lineCount;
                }
            }

            // Xử lý multiple threshold types cho line_item level
            if (thresholdConfig && thresholdConfig.thresholds) {
                // Lấy tất cả threshold types cho Line Item scope từ version-specific config
                const lineItemThresholds = thresholdConfig.thresholds.filter(t =>
                    t.thresholdScope === 'Line Item'
                );

                if (lineItemThresholds.length > 0) {
                    // Tạo result cho từng threshold type
                    for (const thresholdItem of lineItemThresholds) {
                        const thresholdType = thresholdItem.thresholdType || 'Critical';
                        const threshold = thresholdItem.thresholdPercentage;

                        // Convert threshold type cho API response format
                        let apiThresholdType = 'Critical'; // default
                        switch (thresholdType) {
                            case 'Critical':
                                apiThresholdType = 'Critical';
                                break;
                            case 'Non Critical':
                                apiThresholdType = 'Non Critical';
                                break;
                            default:
                                apiThresholdType = thresholdType;
                        }

                        results.push({
                            report_level: 'line_item',
                            category: apiThresholdType,
                            category_name: 'Line Item',
                            imported_date: dateKey,
                            total_error,
                            total_keying,
                            total_sample,
                            threshold_type: apiThresholdType,
                            threshold
                        });
                    }
                } else {
                    // Fallback: Nếu không có threshold cho Line Item scope, tạo result mặc định
                    results.push({
                        report_level: 'line_item',
                        category: 'overall',
                        category_name: 'Line Item',
                        imported_date: dateKey,
                        total_error,
                        total_keying,
                        total_sample,
                        threshold_type: 'Critical',
                        threshold: "N/A"
                    });
                }
            } else {
                // Fallback: Nếu không có thresholdConfig, tạo result mặc định
                results.push({
                    report_level: 'line_item',
                    category: 'overall',
                    category_name: 'Line Item',
                    imported_date: dateKey,
                    total_error,
                    total_keying,
                    total_sample,
                    threshold_type: 'Critical',
                    threshold: "N/A"
                });
            }
        }

    } else if (report_level.toLowerCase() === 'character') {
        // Tính toán stats cho character level - group theo imported_date

        // Lấy tất cả ngày có dữ liệu
        const allDates = new Set([
            ...Object.keys(keyingDocsByDate),
            ...Object.keys(mistakeDocsByDate)
        ]);

        for (const dateKey of allDates) {
            const keyingDocsForDate = keyingDocsByDate[dateKey] || [];
            const mistakeDocsForDate = mistakeDocsByDate[dateKey] || [];

            // Tính toán stats cho character level trong ngày này
            const characterStats = await calculateCharacterLevelStats(
                mistakeDocsForDate,
                keyingDocsForDate,
                AQC_PATTERN
            );

            // Lấy threshold percentage cho character level
            const threshold = getThresholdPercentage('character');

            results.push({
                report_level: 'character',
                category: 'overall',
                category_name: 'Character',
                imported_date: dateKey,
                total_error: characterStats.total_error,
                total_keying: characterStats.total_keying,
                total_sample: characterStats.total_sample,
                threshold_type: 'Critical',
                threshold
            });
        }
    }

    return results;
}

/**
 * API lấy thông tin chất lượng tất cả dự án và tất cả report levels chỉ filter theo date range
 * Uses version-based logic to match document versions with correct configs
 * @param {object} req - Express request object
 * @returns {Promise<Array>} - Array of quality stats for all projects and all report levels grouped by imported_date and threshold_type/scope
 */
async function getAllProjectsQualityStats(req, next) {
    try {
        const { date_from, date_to, version_aware = 'true' } = req.query;
        const userId = req.userId;
        const user = req.user;

        // Validate input
        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!date_from || !date_to) {
            throw new handleMessage('date_from and date_to are required', StatusCodes.BAD_REQUEST);
        }

        // Convert date params to UTC
        const dateFromUTC = parseDateToUTC(date_from);
        const dateToUTC = parseDateToUTC(date_to, true);

        // Kiểm tra thời gian hợp lệ
        if (!dateFromUTC || !dateToUTC || dateFromUTC > dateToUTC) {
            throw new handleMessage('Invalid date range', StatusCodes.BAD_REQUEST);
        }


        // Lấy connection
        const connection = getConnection('default');

        // Lấy tất cả project từ ProjectsPlanModel
        const { schema: ProjectsPlanSchema, collectionName: ProjectPlanCollectionName } = require('../models/ProjectsPlanModel');
        const ProjectsPlan = connection.model(ProjectPlanCollectionName, ProjectsPlanSchema, ProjectPlanCollectionName);
        const allProjects = await ProjectsPlan.find({}, { _id: 1, projectName: 1 }).lean();

        if (!allProjects || allProjects.length === 0) {
            return [];
        }

        // Lấy pattern từ DB thông qua helper
        let { AQC_PATTERN } = await getQcPatterns();

        // Tổng hợp kết quả từ tất cả project
        const allResults = [];

        // Xử lý từng project
        for (const project of allProjects) {
            const project_id = project._id.toString();
            const projectName = project.projectName;

            try {
                // Collect results for this project
                const projectResults = [];

                // Tạo model động theo projectId
                const MistakeDetails = createMistakeDetailsModel(connection, project_id);
                const { createModel: createKeyingAmountModel } = require('../models/reporting/keyingAmount.model');
                const KeyingAmount = createKeyingAmountModel(connection, project_id);

                // Lấy dữ liệu từ keying_amount trong khoảng ngày đã chọn
                const keyingAmountDocs = await KeyingAmount.find({
                    imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
                }).lean();

                // Nếu project này không có dữ liệu trong khoảng thời gian, skip
                if (!keyingAmountDocs || keyingAmountDocs.length === 0) {
                    continue;
                }

                // Lấy danh sách doc_id để tìm trong mistake_details
                const docIds = keyingAmountDocs.map(doc => doc.doc_id);

                // Lấy dữ liệu từ mistake_details cho các doc_id
                const mistakeDetailsDocs = await MistakeDetails.find({
                    doc_id: { $in: docIds },
                    imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
                }).lean();

                // Version-based logic: Group documents theo version SAU KHI đã fetch data
                const groupedData = groupDocumentsByVersions(keyingAmountDocs, mistakeDetailsDocs);
                loggerInfo.info(`[getAllProjectsQualityStats] Project ${projectName}: Found ${Object.keys(groupedData).length} version groups`);

                // Log để debug
                loggerInfo.info(`[getAllProjectsQualityStats] Project ${projectName}: Total keying docs: ${keyingAmountDocs.length}, mistake docs: ${mistakeDetailsDocs.length}`);

                // Process từng version group riêng biệt
                for (const [groupKey, groupData] of Object.entries(groupedData)) {
                    const { dateKey, fieldConfigVersion, projectThresholdVersion, keyingDocs, mistakeDocs } = groupData;

                    if (keyingDocs.length === 0) continue; // Skip nếu không có dữ liệu

                    // Lấy version-specific configs
                    const fieldConfig = await getFieldConfigByVersion(project_id, fieldConfigVersion, connection);
                    const thresholdConfig = await getProjectThresholdByVersion(project_id, projectThresholdVersion, connection);

                    loggerInfo.info(`[getAllProjectsQualityStats] Processing project ${projectName}, group: ${groupKey}, field config v${fieldConfigVersion}, threshold v${projectThresholdVersion}`);

                    // Process tất cả report levels cho group này
                    const reportLevels = ['document', 'field', 'record', 'line_item', 'character'];

                    for (const report_level of reportLevels) {
                        const groupResults = await processGroupByReportLevel(
                            report_level,
                            keyingDocs,
                            mistakeDocs,
                            fieldConfig,
                            thresholdConfig,
                            AQC_PATTERN,
                            project_id,
                            connection,
                            dateKey
                        );

                        // Thêm project name vào results
                        groupResults.forEach(result => {
                            result.project_name = projectName;
                        });

                        projectResults.push(...groupResults);
                    }
                } // End of version group processing

                // Post-processing: Merge results trong project này có cùng threshold
                loggerInfo.info(`[getAllProjectsQualityStats] Project ${projectName}: Before merge - ${projectResults.length} results`);
                const mergedProjectResults = mergeResultsBySameThreshold(projectResults);
                loggerInfo.info(`[getAllProjectsQualityStats] Project ${projectName}: After merge - ${mergedProjectResults.length} results`);
                allResults.push(...mergedProjectResults);

            } catch (projectError) {
                // Log lỗi cho project cụ thể nhưng không dừng xử lý
                loggerInfo.error(`[getAllProjectsQualityStats] Error processing project ${project_id}:`, projectError);
                continue;
            }
        }

        return allResults;
    } catch (error) {
        next(error);
        return null;
    }
}

/**
 * Batch update error types cho nhiều mistakes cùng lúc
 * @param {object} req - Express request object
 * @param {function} next - Express next function
 * @returns {Promise<object>} - Kết quả batch update
 */
async function batchUpdateErrorType(req, next) {
    let session;
    try {
        const { updates } = req.body; // Array of { error_id, project_id, doc_id, error_type, reason }
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!updates || !Array.isArray(updates) || updates.length === 0) {
            throw new handleMessage(message.REPORTING.MISSING_PARAMS, StatusCodes.BAD_REQUEST);
        }

        const connection = getConnection('default');
        session = await connection.startSession();
        session.startTransaction();

        let successful = 0;
        let failed = 0;
        const errors = [];

        // Group updates by project_id để tối ưu
        const updatesByProject = {};
        updates.forEach(update => {
            if (!updatesByProject[update.project_id]) {
                updatesByProject[update.project_id] = [];
            }
            updatesByProject[update.project_id].push(update);
        });

        // Xử lý từng project
        for (const [projectId, projectUpdates] of Object.entries(updatesByProject)) {
            const MistakeReport = createMistakeDetailsModel(connection, projectId);

            // Xử lý từng update trong project
            for (const update of projectUpdates) {
                try {
                    const { error_id, doc_id, error_type, reason } = update;

                    if (!error_id || !doc_id || !error_type) {
                        failed++;
                        errors.push(`Missing required fields for error_id: ${error_id}`);
                        continue;
                    }

                    // Lấy document để kiểm tra status
                    const doc = await MistakeReport.findOne({
                        project_id: new mongoose.Types.ObjectId(projectId),
                        doc_id: new mongoose.Types.ObjectId(doc_id),
                        'mistake_details._id': new mongoose.Types.ObjectId(error_id)
                    }).session(session);

                    if (!doc) {
                        failed++;
                        errors.push(`Document not found for error_id: ${error_id}`);
                        continue;
                    }

                    const mistake = (doc.mistake_details || []).find(m => m._id.toString() === error_id);
                    if (!mistake) {
                        failed++;
                        errors.push(`Mistake not found for error_id: ${error_id}`);
                        continue;
                    }

                    // Kiểm tra status có thể update không
                    if (!['WAIT_QC', 'REJECTED_BY_PM'].includes(mistake.status)) {
                        failed++;
                        errors.push(`Invalid status for error_id: ${error_id}, current status: ${mistake.status}`);
                        continue;
                    }

                    // Xác định status mới
                    let newStatus;
                    let updateOps = {
                        'mistake_details.$.error_type': error_type
                    };

                    // Xử lý reason array từ frontend
                    if (reason && Array.isArray(reason) && reason.length > 0) {
                        const reasonHistory = reason.map(r => ({
                            action: r.action || 'QC_EDIT', // Sử dụng action từ frontend hoặc default
                            user_id: r.user_id ? new mongoose.Types.ObjectId(r.user_id) : new mongoose.Types.ObjectId(userId), // Sử dụng user_id từ frontend hoặc fallback
                            user_name: r.user_name || user.fullName || user.username, // FIX: Ưu tiên user_name từ frontend
                            content: r.content || r.comment || '', // FIX: Nhận 'content' từ frontend, fallback 'comment'
                            createdDate: r.createdDate ? new Date(r.createdDate) : new Date() // Sử dụng createdDate từ frontend hoặc current
                        }));
                        updateOps['mistake_details.$.reason'] = [...(mistake.reason || []), ...reasonHistory];
                    }

                    if (mistake.status === 'REJECTED_BY_PM' && error_type === 'not_error') {
                        newStatus = 'DONE';
                        // updateOps['mistake_details.$.error_found_at'] = '';
                    } else {
                        newStatus = 'WAIT_PM';
                    }

                    updateOps['mistake_details.$.status'] = newStatus;

                    // Update với optimistic lock
                    const updateResult = await MistakeReport.updateOne(
                        {
                            project_id: new mongoose.Types.ObjectId(projectId),
                            doc_id: new mongoose.Types.ObjectId(doc_id),
                            'mistake_details._id': new mongoose.Types.ObjectId(error_id),
                            'mistake_details.status': { $in: ['WAIT_QC', 'REJECTED_BY_PM'] }
                        },
                        { $set: updateOps },
                        { session }
                    );

                    loggerInfo.info(`[batchUpdateErrorType] Update result for error_id ${error_id}:`, {
                        matchedCount: updateResult.matchedCount,
                        modifiedCount: updateResult.modifiedCount
                    });

                    if (updateResult.matchedCount === 0) {
                        failed++;
                        errors.push(`Record not found or status changed for error_id: ${error_id}`);
                        continue;
                    }

                    // Lấy comment từ reason input được truyền từ frontend cho update này
                    const currentActionComment = getCommentFromReasonInput(reason);

                    // Ghi activity log
                    await logActivity({
                        user_id: userId,
                        user_name: user || `User_${userId}`, // Fallback với userId nếu không có tên
                        action: newStatus === 'DONE' ? 'QC_FINALIZE' : 'QC_ASSIGN',
                        doc_id,
                        error_id,
                        old_value: {
                            error_type: mistake.error_type,
                            status: mistake.status
                        },
                        new_value: {
                            error_type,
                            status: newStatus // FIX: Sử dụng newStatus thay vì finalStatus
                        },
                        reason: newStatus === 'DONE' ? 'Marked as not_error after PM rejection - case closed' : 'Error type assigned by QC',
                        user_comment: currentActionComment, // Comment từ action hiện tại
                        session
                    });

                    successful++;
                } catch (updateError) {
                    failed++;
                    errors.push(`Error updating error_id ${update.error_id}: ${updateError.message}`);
                }
            }
        }

        await session.commitTransaction();

        return {
            total: updates.length,
            successful,
            failed,
            errors: errors.length > 0 ? errors : undefined
        };
    } catch (err) {
        if (session) {
            try {
                await session.abortTransaction();
            } catch (abortError) {
                loggerInfo.error('[batchUpdateErrorType] Error aborting transaction:', abortError);
            }
        }
        throw err;
    } finally {
        if (session) {
            try {
                session.endSession();
            } catch (endError) {
                loggerInfo.error('[batchUpdateErrorType] Error ending session:', endError);
            }
        }
    }
}

async function batchApproveRejectMistakes(req, next) {
    let session = null;
    try {
        const { updates } = req.body; // Array of { error_id, project_id, doc_id, status, comment }
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!updates || !Array.isArray(updates) || updates.length === 0) {
            throw new handleMessage(message.REPORTING.MISSING_PARAMS, StatusCodes.BAD_REQUEST);
        }

        loggerInfo.info(`[batchApproveRejectMistakes] Starting batch operation with ${updates.length} updates:`, {
            userId,
            userName: user, // user là string username từ JWT
            updates: updates.map(u => ({ error_id: u.error_id, status: u.status, project_id: u.project_id }))
        });

        const connection = getConnection('default');
        session = await connection.startSession();
        session.startTransaction();

        let successful = 0;
        let failed = 0;
        const errors = [];

        // Group updates by project_id để tối ưu
        const updatesByProject = {};
        updates.forEach(update => {
            if (!updatesByProject[update.project_id]) {
                updatesByProject[update.project_id] = [];
            }
            updatesByProject[update.project_id].push(update);
        });

        // Xử lý từng project
        for (const [projectId, projectUpdates] of Object.entries(updatesByProject)) {
            const MistakeReport = createMistakeDetailsModel(connection, projectId);

            // Xử lý từng update trong project
            for (const update of projectUpdates) {
                try {
                    const { error_id, doc_id, status, comment, reason } = update;

                    if (!error_id || !doc_id || !status) {
                        failed++;
                        errors.push(`Missing required fields for error_id: ${error_id}`);
                        continue;
                    }

                    // Validate status
                    if (!['APPROVED_BY_PM', 'REJECTED_BY_PM'].includes(status)) {
                        failed++;
                        errors.push(`Invalid status for error_id: ${error_id}, status: ${status}`);
                        continue;
                    }

                    // Convert status cho đúng business logic
                    const finalStatus = status === 'APPROVED_BY_PM' ? 'DONE' : status; // APPROVED_BY_PM -> DONE

                    // Lấy document để kiểm tra status hiện tại
                    const doc = await MistakeReport.findOne({
                        project_id: new mongoose.Types.ObjectId(projectId),
                        doc_id: new mongoose.Types.ObjectId(doc_id),
                        'mistake_details._id': new mongoose.Types.ObjectId(error_id)
                    }).session(session);

                    if (!doc) {
                        failed++;
                        errors.push(`Document not found for error_id: ${error_id}`);
                        continue;
                    }

                    const mistake = (doc.mistake_details || []).find(m => m._id.toString() === error_id);
                    if (!mistake) {
                        failed++;
                        errors.push(`Mistake not found for error_id: ${error_id}`);
                        continue;
                    }

                    // Log để debug
                    loggerInfo.info(`[batchApproveRejectMistakes] Processing error_id: ${error_id}, current status: ${mistake.status}, frontend status: ${status}, final status: ${finalStatus}`);

                    // Kiểm tra status có thể approve/reject không
                    if (!['WAIT_PM', 'WAIT_QC'].includes(mistake.status)) {
                        failed++;
                        errors.push(`Invalid current status for error_id: ${error_id}, current status: ${mistake.status}`);
                        continue;
                    }

                    // Chuẩn bị update operations
                    let updateOps = {
                        $set: {
                            'mistake_details.$.status': finalStatus
                        }
                    };

                    // Xử lý reason array từ frontend
                    if (reason && Array.isArray(reason) && reason.length > 0) {
                        const reasonHistory = reason.map(r => {
                            // Xử lý user_id: nếu là string username thì dùng userId từ JWT, nếu là ObjectId hợp lệ thì convert
                            let processedUserId;
                            const userIdFromReason = r.user_id || userId;

                            try {
                                // Thử convert thành ObjectId, nếu thành công thì dùng
                                processedUserId = new mongoose.Types.ObjectId(userIdFromReason);
                                loggerInfo.info(`[batchApproveRejectMistakes] Successfully converted user_id: ${userIdFromReason} to ObjectId`);
                            } catch (error) {
                                // Nếu không convert được (là username), dùng userId từ JWT
                                processedUserId = new mongoose.Types.ObjectId(userId);
                                loggerInfo.info(`[batchApproveRejectMistakes] Failed to convert user_id: ${userIdFromReason}, using JWT userId: ${userId}`);
                            }

                            return {
                                action: r.action || (status === 'APPROVED_BY_PM' ? 'APPROVED' : 'REJECTED'), // Sửa action cho đúng enum
                                user_id: processedUserId,
                                user_name: r.user_name || user, // user là string username
                                content: r.content || r.comment || '',
                                createdDate: r.createdDate ? new Date(r.createdDate) : new Date()
                            };
                        });

                        // Thêm $push operation
                        updateOps.$push = {
                            'mistake_details.$.reason': { $each: reasonHistory }
                        };
                    } else if (comment) {
                        // Fallback: Nếu có comment nhưng không có reason array
                        const newReasonEntry = {
                            action: status === 'APPROVED_BY_PM' ? 'APPROVED' : 'REJECTED', // Sửa action cho đúng enum
                            user_id: new mongoose.Types.ObjectId(userId),
                            user_name: user, // user là string username
                            content: comment,
                            createdDate: new Date()
                        };

                        updateOps.$push = {
                            'mistake_details.$.reason': newReasonEntry
                        };
                    }

                    // Update với optimistic lock
                    const updateResult = await MistakeReport.updateOne(
                        {
                            project_id: new mongoose.Types.ObjectId(projectId),
                            doc_id: new mongoose.Types.ObjectId(doc_id),
                            'mistake_details._id': new mongoose.Types.ObjectId(error_id),
                            'mistake_details.status': { $in: ['WAIT_PM', 'WAIT_QC'] }
                        },
                        updateOps, // Sử dụng updateOps trực tiếp (đã có $set và $push)
                        { session }
                    );

                    loggerInfo.info(`[batchApproveRejectMistakes] Update result for error_id ${error_id}:`, {
                        matchedCount: updateResult.matchedCount,
                        modifiedCount: updateResult.modifiedCount
                    });

                    if (updateResult.matchedCount === 0) {
                        failed++;
                        errors.push(`Record not found or status changed for error_id: ${error_id}`);
                        continue;
                    }

                    // Lấy comment từ reason input hoặc comment field được truyền từ frontend
                    let currentActionComment = '';
                    if (reason && Array.isArray(reason)) {
                        currentActionComment = getCommentFromReasonInput(reason);
                    } else if (comment) {
                        currentActionComment = comment;
                    }

                    // Ghi activity log
                    await logActivity({
                        user_id: userId,
                        user_name: user || `User_${userId}`, // user là string username, fallback với userId nếu không có
                        action: status === 'APPROVED_BY_PM' ? 'PM_APPROVE' : 'PM_REJECT',
                        doc_id,
                        error_id,
                        old_value: {
                            status: mistake.status
                        },
                        new_value: {
                            status: finalStatus // Ghi status cuối cùng vào log
                        },
                        reason: finalStatus === 'DONE' ? 'Approved by PM' : 'Rejected by PM',
                        user_comment: currentActionComment, // Comment từ action hiện tại
                        session
                    });

                    successful++;
                } catch (updateError) {
                    failed++;
                    errors.push(`Error updating error_id ${update.error_id}: ${updateError.message}`);
                }
            }
        }

        await session.commitTransaction();

        loggerInfo.info(`[batchApproveRejectMistakes] Batch operation completed:`, {
            total: updates.length,
            successful,
            failed,
            errors: errors.length > 0 ? errors : undefined
        });

        return {
            total: updates.length,
            successful,
            failed,
            errors: errors.length > 0 ? errors : undefined
        };
    } catch (err) {
        if (session) {
            try {
                await session.abortTransaction();
            } catch (abortError) {
                loggerInfo.error('[batchApproveRejectMistakes] Error aborting transaction:', abortError);
            }
        }
        throw err;
    } finally {
        if (session) {
            try {
                session.endSession();
            } catch (endError) {
                loggerInfo.error('[batchApproveRejectMistakes] Error ending session:', endError);
            }
        }
    }
}

/**
 * API lấy danh sách field configuration theo project_id - VERSION MỚI (Project-Centric với Version Control)
 * @param {object} req - Express request object (đã có req.userId, req.user từ verifyJWTToken)
 * @returns {Promise<Object>} - Project field configuration với danh sách fields (version mới nhất active)
 */
async function getFieldConfiguration(req, next) {
    try {
        const { project_id } = req.query;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id) {
            throw new handleMessage(message.REPORTING.MISSING_PROJECT_ID, StatusCodes.BAD_REQUEST);
        }

        // Lấy connection default và tạo model
        const connection = getConnection('default');
        const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../models/reporting/fieldDefinitionCollection.model');
        const ProjectFieldConfiguration = connection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

        // Lấy project field configuration version mới nhất active
        const projectConfig = await ProjectFieldConfiguration.findOne(
            {
                project_id: new mongoose.Types.ObjectId(project_id),
                isActive: true
            },
            {
                project_id: 1,
                project_name: 1,
                version: 1,
                isActive: 1,
                fields: 1,
                last_synced_at: 1,
                created_at: 1,
                updated_at: 1
            }
        ).sort({ version: -1 }).lean(); // Sort by version desc để lấy version mới nhất

        if (!projectConfig) {
            // Nếu chưa có config cho project này, trả về structure mặc định
            return {
                project_id: project_id,
                project_name: '',
                version: 0,
                isActive: false,
                fields: [],
                last_synced_at: null,
                created_at: null,
                updated_at: null
            };
        }

        return projectConfig;
    } catch (error) {
        next(error);
    }
}

/**
 * API update is_report_count và critical_field cho một hoặc nhiều field - VERSION MỚI (Version Control)
 * Tạo document mới với version tăng lên, mark document cũ isActive = false
 * @param {object} req - Express request object
 * @returns {Promise<object>} - Kết quả update với version mới
 */
async function updateFieldConfiguration(req, next) {
    let session;
    try {
        const { project_id, fields, increment_version = true } = req.body;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id) {
            throw new handleMessage(message.REPORTING.MISSING_PROJECT_ID, StatusCodes.BAD_REQUEST);
        }
        if (!fields || !Array.isArray(fields) || fields.length === 0) {
            throw new handleMessage(message.REPORTING.MISSING_FIELD_UPDATE_DATA, StatusCodes.BAD_REQUEST);
        }

        // Validate fields data
        for (const field of fields) {
            if (!field.field_id) {
                throw new handleMessage('field_id is required for each field', StatusCodes.BAD_REQUEST);
            }
            if (field.is_report_count === undefined && field.critical_field === undefined) {
                throw new handleMessage('At least one of is_report_count or critical_field must be provided', StatusCodes.BAD_REQUEST);
            }

            // Validate critical_field if provided - chấp nhận bất kỳ string nào hoặc null
            if (field.critical_field !== undefined && field.critical_field !== null) {
                if (typeof field.critical_field !== 'string') {
                    throw new handleMessage('critical_field must be a string or null', StatusCodes.BAD_REQUEST);
                }
            }
        }

        const connection = getConnection('default');
        const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../models/reporting/fieldDefinitionCollection.model');
        const ProjectFieldConfiguration = connection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

        // Bắt đầu transaction
        session = await connection.startSession();
        session.startTransaction();

        // Lấy project config hiện tại (version mới nhất active)
        const currentConfig = await ProjectFieldConfiguration.findOne(
            {
                project_id: new mongoose.Types.ObjectId(project_id),
                isActive: true
            }
        ).sort({ version: -1 }).session(session).lean();

        if (!currentConfig) {
            throw new handleMessage('Project field configuration not found', StatusCodes.NOT_FOUND);
        }

        // Clean deep copy để loại bỏ mọi session reference
        const cleanCurrentConfig = JSON.parse(JSON.stringify(currentConfig));

        // Tạo một bản copy của fields array để update
        const updatedFields = [...cleanCurrentConfig.fields];
        const updateResults = [];

        // Update từng field trong array
        for (const fieldUpdate of fields) {
            const fieldIndex = updatedFields.findIndex(f => f.field_id.toString() === fieldUpdate.field_id);

            if (fieldIndex === -1) {
                updateResults.push({
                    field_id: fieldUpdate.field_id,
                    matched: 0,
                    modified: 0,
                    critical_field: fieldUpdate.critical_field || null,
                    error: 'Field not found in project'
                });
                continue;
            }

            let modified = false;
            const updatedField = { ...updatedFields[fieldIndex] };

            if (fieldUpdate.is_report_count !== undefined) {
                if (updatedField.is_report_count !== fieldUpdate.is_report_count) {
                    updatedField.is_report_count = fieldUpdate.is_report_count;
                    modified = true;
                }
            }
            if (fieldUpdate.critical_field !== undefined) {
                if (updatedField.critical_field !== fieldUpdate.critical_field) {
                    updatedField.critical_field = fieldUpdate.critical_field;
                    modified = true;
                }
            }

            if (modified) {
                updatedFields[fieldIndex] = updatedField;
            }

            const resultEntry = {
                field_id: fieldUpdate.field_id,
                matched: 1,
                modified: modified ? 1 : 0,
                critical_field: fieldUpdate.critical_field || null
            };

            updateResults.push(resultEntry);
        }

        const hasChanges = updateResults.some(r => r.modified > 0);

        if (hasChanges && increment_version) {
            // VERSION CONTROL: Tạo document mới với version tăng lên
            const newVersion = cleanCurrentConfig.version + 1;
            const newConfigData = {
                project_id: cleanCurrentConfig.project_id,
                project_name: cleanCurrentConfig.project_name,
                version: newVersion,
                isActive: true,
                fields: updatedFields,
                last_synced_at: cleanCurrentConfig.last_synced_at,
                created_at: cleanCurrentConfig.created_at,
                updated_at: new Date()
            };

            // 1. Tạo document mới với version tăng lên
            await ProjectFieldConfiguration.create([newConfigData], { session });

            // 2. Mark document hiện tại (version cũ) thành inactive
            await ProjectFieldConfiguration.updateOne(
                { _id: currentConfig._id },
                { $set: { isActive: false } }
            ).session(session);

            // Commit transaction
            await session.commitTransaction();

            // Chuẩn bị return data
            const returnData = {
                total_fields: fields.length,
                results: updateResults,
                success_count: updateResults.filter(r => r.modified > 0).length,
                previous_version: cleanCurrentConfig.version,
                new_version: newVersion,
                version_incremented: true,
                new_document_created: true
            };

            return returnData;
        } else {
            // Không có thay đổi hoặc không increment version
            await session.commitTransaction();

            // Chuẩn bị return data cho no-change case
            const returnData = {
                total_fields: fields.length,
                results: updateResults,
                success_count: updateResults.filter(r => r.modified > 0).length,
                previous_version: cleanCurrentConfig.version,
                new_version: cleanCurrentConfig.version,
                version_incremented: false,
                new_document_created: false
            };

            return returnData;
        }
    } catch (error) {
        if (session) {
            try {
                await session.abortTransaction();
            } catch (abortError) {
                loggerInfo.error('[updateFieldConfiguration] Error aborting transaction:', abortError);
            }
        }

        throw error;
    } finally {
        if (session) {
            try {
                await session.endSession();
            } catch (endError) {
                loggerInfo.error('[updateFieldConfiguration] Error ending session:', endError);
            }
        }
    }
}

/**
 * Get project threshold configuration by projectId - VERSION CONTROL
 * @param {Object} req - Express request object
 * @param {Function} next - Express next function
 * @returns {Promise<Object>} - Project threshold configuration (version mới nhất active)
 */
async function getProjectThreshold(req, next) {
    try {
        const { project_id } = req.query;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id) {
            throw new handleMessage(message.PROJECT_THRESHOLD.MISSING_PROJECT_ID, StatusCodes.BAD_REQUEST);
        }

        const connection = getConnection('default');
        const ProjectThreshold = connection.model(projectThresholdCollectionName, projectThresholdSchema, projectThresholdCollectionName);

        // Tìm threshold configuration cho project (version mới nhất active)
        const thresholdConfig = await ProjectThreshold.findOne({
            projectId: new mongoose.Types.ObjectId(project_id),
            isActive: true
        }).sort({ version: -1 }).lean(); // Lấy version mới nhất

        if (!thresholdConfig) {
            // Nếu chưa có config, trả về structure mặc định
            return {
                projectId: project_id,
                version: 0,
                thresholds: [],
                isActive: false
            };
        }

        return thresholdConfig;
    } catch (error) {
        throw error;
    }
}

/**
 * Create or update project threshold configuration - VERSION CONTROL
 * Tạo document mới với version tăng lên, mark document cũ isActive = false
 * @param {Object} req - Express request object  
 * @param {Function} next - Express next function
 * @returns {Promise<Object>} - Updated project threshold configuration
 */
async function createOrUpdateProjectThreshold(req, next) {
    let session;
    try {
        const { project_id, thresholds } = req.body;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id) {
            throw new handleMessage(message.PROJECT_THRESHOLD.MISSING_PROJECT_ID, StatusCodes.BAD_REQUEST);
        }
        if (!thresholds || !Array.isArray(thresholds)) {
            throw new handleMessage(message.PROJECT_THRESHOLD.MISSING_THRESHOLD_DATA, StatusCodes.BAD_REQUEST);
        }

        // Validate threshold data
        const validScopes = ['Field', 'Line Item', 'Record', 'Document', 'Character'];
        const singleValueScopes = ['Line Item', 'Record', 'Document', 'Character'];

        for (const threshold of thresholds) {
            // Validate thresholdScope
            const scope = threshold.thresholdScope || 'Field';
            if (!validScopes.includes(scope)) {
                throw new handleMessage('Invalid threshold scope. Must be one of: Field, Line Item, Record, Document, Character', StatusCodes.BAD_REQUEST);
            }

            // Validate thresholdType: required cho Field, auto-set cho others
            if (scope === 'Field') {
                if (!threshold.thresholdType || threshold.thresholdType.trim() === '') {
                    throw new handleMessage('Threshold type is required for Field scope', StatusCodes.BAD_REQUEST);
                }
            } else {
                // Auto-set thresholdType cho non-field scopes nếu chưa có
                if (!threshold.thresholdType) {
                    threshold.thresholdType = 'Critical';
                }
            }

            // Validate thresholdPercentage
            if (typeof threshold.thresholdPercentage !== 'number' || threshold.thresholdPercentage < 0 || threshold.thresholdPercentage > 100) {
                throw new handleMessage(message.PROJECT_THRESHOLD.INVALID_THRESHOLD_PERCENTAGE, StatusCodes.BAD_REQUEST);
            }
        }

        // Check for duplicates
        const fieldThresholds = thresholds.filter(t => (t.thresholdScope || 'Field') === 'Field');
        const nonFieldThresholds = thresholds.filter(t => singleValueScopes.includes(t.thresholdScope));

        // Field scope: check duplicate types
        if (fieldThresholds.length > 0) {
            const fieldTypes = fieldThresholds.map(t => t.thresholdType.trim().toLowerCase());
            const uniqueFieldTypes = new Set(fieldTypes);
            if (fieldTypes.length !== uniqueFieldTypes.size) {
                throw new handleMessage('Duplicate threshold types in Field scope', StatusCodes.BAD_REQUEST);
            }
        }

        // Non-field scopes: chỉ cho phép 1 threshold per scope
        for (const scope of singleValueScopes) {
            const scopeThresholds = nonFieldThresholds.filter(t => t.thresholdScope === scope);
            if (scopeThresholds.length > 1) {
                throw new handleMessage(`Only one threshold is allowed for ${scope} scope`, StatusCodes.BAD_REQUEST);
            }
        }

        const connection = getConnection('default');
        const ProjectThreshold = connection.model(projectThresholdCollectionName, projectThresholdSchema, projectThresholdCollectionName);

        // Bắt đầu transaction
        session = await connection.startSession();
        session.startTransaction();

        // Lấy config hiện tại (nếu có)
        const currentConfig = await ProjectThreshold.findOne({
            projectId: new mongoose.Types.ObjectId(project_id),
            isActive: true
        }).sort({ version: -1 }).session(session).lean();

        // Chuẩn bị normalized thresholds data để so sánh
        const normalizedNewThresholds = thresholds.map(t => ({
            thresholdType: t.thresholdType ? t.thresholdType.trim() : 'Critical',
            thresholdPercentage: t.thresholdPercentage,
            thresholdScope: t.thresholdScope || 'Field'
        }));

        // Kiểm tra xem có thay đổi gì không
        let hasChanges = false;

        if (!currentConfig) {
            // Nếu chưa có config thì luôn có thay đổi
            hasChanges = true;
        } else {
            // So sánh thresholds array
            const currentThresholds = currentConfig.thresholds || [];

            // Kiểm tra số lượng thresholds
            if (currentThresholds.length !== normalizedNewThresholds.length) {
                hasChanges = true;
            } else {
                // So sánh từng threshold
                for (let i = 0; i < normalizedNewThresholds.length; i++) {
                    const newThreshold = normalizedNewThresholds[i];

                    // Tìm threshold hiện tại matching theo scope và type
                    const currentThreshold = currentThresholds.find(ct =>
                        ct.thresholdScope === newThreshold.thresholdScope &&
                        ct.thresholdType === newThreshold.thresholdType
                    );

                    if (!currentThreshold ||
                        currentThreshold.thresholdPercentage !== newThreshold.thresholdPercentage) {
                        hasChanges = true;
                        break;
                    }
                }

                // Kiểm tra ngược lại - có threshold nào bị xóa không
                if (!hasChanges) {
                    for (const currentThreshold of currentThresholds) {
                        const newThreshold = normalizedNewThresholds.find(nt =>
                            nt.thresholdScope === currentThreshold.thresholdScope &&
                            nt.thresholdType === currentThreshold.thresholdType
                        );

                        if (!newThreshold) {
                            hasChanges = true;
                            break;
                        }
                    }
                }
            }
        }

        if (hasChanges) {
            // VERSION CONTROL: Tạo document mới với version tăng lên
            const newThresholdData = {
                projectId: new mongoose.Types.ObjectId(project_id),
                version: currentConfig ? currentConfig.version + 1 : 1, // Increment version hoặc bắt đầu từ 1
                thresholds: normalizedNewThresholds,
                isActive: true
            };

            // Tạo document mới
            const newConfig = await ProjectThreshold.create([newThresholdData], { session });

            // Nếu có config cũ, mark nó thành inactive
            if (currentConfig) {
                await ProjectThreshold.updateOne(
                    { _id: currentConfig._id },
                    { $set: { isActive: false } }
                ).session(session);
            }

            // Commit transaction
            await session.commitTransaction();

            // Clean serialization để tránh session reference
            const cleanConfig = JSON.parse(JSON.stringify(newConfig[0]));

            const returnData = {
                ...cleanConfig,
                previous_version: currentConfig ? currentConfig.version : 0,
                version_incremented: true,
                new_document_created: true
            };

            return returnData;
        } else {
            // Không có thay đổi - không tạo version mới
            await session.commitTransaction();

            // Trả về current config với flag báo không có thay đổi
            const cleanCurrentConfig = JSON.parse(JSON.stringify(currentConfig));

            const returnData = {
                ...cleanCurrentConfig,
                previous_version: cleanCurrentConfig.version,
                version_incremented: false,
                new_document_created: false
            };

            return returnData;
        }
    } catch (error) {
        if (session) {
            try {
                await session.abortTransaction();
            } catch (abortError) {
                loggerInfo.error('[createOrUpdateProjectThreshold] Error aborting transaction:', abortError);
            }
        }

        throw error;
    } finally {
        if (session) {
            try {
                await session.endSession();
            } catch (endError) {
                loggerInfo.error('[createOrUpdateProjectThreshold] Error ending session:', endError);
            }
        }
    }
}

/**
 * Delete a specific threshold item from project threshold configuration
 * @param {Object} req - Express request object
 * @param {Function} next - Express next function
 * @returns {Promise<Object>} - Updated project threshold configuration
 */
async function deleteThresholdItem(req, next) {
    try {
        const { project_id, threshold_id } = req.body;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id || !threshold_id) {
            throw new handleMessage(message.PROJECT_THRESHOLD.MISSING_PROJECT_ID, StatusCodes.BAD_REQUEST);
        }

        const connection = getConnection('default');
        const ProjectThreshold = connection.model(projectThresholdCollectionName, projectThresholdSchema, projectThresholdCollectionName);

        // Remove threshold item by _id
        const result = await ProjectThreshold.findOneAndUpdate(
            {
                projectId: new mongoose.Types.ObjectId(project_id),
                isActive: true
            },
            {
                $pull: {
                    thresholds: { _id: new mongoose.Types.ObjectId(threshold_id) }
                }
            },
            {
                new: true,
                runValidators: true
            }
        ).lean();

        if (!result) {
            throw new handleMessage(message.PROJECT_THRESHOLD.PROJECT_THRESHOLD_NOT_FOUND, StatusCodes.NOT_FOUND);
        }

        return result;
    } catch (error) {
        throw error;
    }
}

/**
 * Delete project field configuration - VERSION CONTROL
 * Mark current version inactive và activate previous version (nếu có)
 * @param {Object} req - Express request object
 * @param {Function} next - Express next function
 * @returns {Promise<Object>} - Deletion result
 */
async function deleteFieldConfiguration(req, next) {
    let session;
    try {
        const { project_id } = req.body;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id) {
            throw new handleMessage(message.REPORTING.MISSING_PROJECT_ID, StatusCodes.BAD_REQUEST);
        }

        const connection = getConnection('default');
        const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../models/reporting/fieldDefinitionCollection.model');
        const ProjectFieldConfiguration = connection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

        // Bắt đầu transaction
        session = await connection.startSession();
        session.startTransaction();

        // Lấy config hiện tại (version mới nhất active)
        const currentConfig = await ProjectFieldConfiguration.findOne({
            project_id: new mongoose.Types.ObjectId(project_id),
            isActive: true
        }).sort({ version: -1 }).session(session).lean();

        if (!currentConfig) {
            throw new handleMessage('Project field configuration not found', StatusCodes.NOT_FOUND);
        }

        // Mark current version thành inactive
        await ProjectFieldConfiguration.updateOne(
            { _id: currentConfig._id },
            { $set: { isActive: false } },
            { session }
        );

        // Tìm version trước đó để activate (nếu có)
        const previousConfig = await ProjectFieldConfiguration.findOne({
            project_id: new mongoose.Types.ObjectId(project_id),
            version: { $lt: currentConfig.version },
            isActive: false // Tìm version inactive trước đó
        }).sort({ version: -1 }).session(session).lean(); // Version cao nhất trong các version thấp hơn current

        let activatedPrevious = null;
        if (previousConfig) {
            // Activate previous version
            await ProjectFieldConfiguration.updateOne(
                { _id: previousConfig._id },
                { $set: { isActive: true } },
                { session }
            );

            activatedPrevious = await ProjectFieldConfiguration.findById(previousConfig._id).session(session).lean();
        }

        // Commit transaction
        await session.commitTransaction();

        return {
            success: true,
            deletedConfig: {
                ...currentConfig, // currentConfig đã là lean object, không cần .toObject()
                isActive: false // Reflect the updated state
            },
            activatedPrevious: activatedPrevious,
            rollback_to_version: activatedPrevious ? activatedPrevious.version : null
        };
    } catch (error) {
        if (session) {
            await session.abortTransaction();
        }
        throw error;
    } finally {
        if (session) {
            await session.endSession();
        }
    }
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

/**
 * Delete project threshold configuration - VERSION CONTROL
 * Mark current version inactive và activate previous version (nếu có)
 * @param {Object} req - Express request object
 * @param {Function} next - Express next function
 * @returns {Promise<Object>} - Deletion result
 */
async function deleteProjectThreshold(req, next) {
    let session;
    try {
        const { project_id } = req.body;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id) {
            throw new handleMessage(message.PROJECT_THRESHOLD.MISSING_PROJECT_ID, StatusCodes.BAD_REQUEST);
        }

        const connection = getConnection('default');
        const ProjectThreshold = connection.model(projectThresholdCollectionName, projectThresholdSchema, projectThresholdCollectionName);

        // Bắt đầu transaction
        session = await connection.startSession();
        session.startTransaction();

        // Lấy config hiện tại (version mới nhất active)
        const currentConfig = await ProjectThreshold.findOne({
            projectId: new mongoose.Types.ObjectId(project_id),
            isActive: true
        }).sort({ version: -1 }).session(session).lean();

        if (!currentConfig) {
            throw new handleMessage(message.PROJECT_THRESHOLD.PROJECT_THRESHOLD_NOT_FOUND, StatusCodes.NOT_FOUND);
        }

        // Mark current version thành inactive
        await ProjectThreshold.updateOne(
            { _id: currentConfig._id },
            { $set: { isActive: false } },
            { session }
        );

        // Tìm version trước đó để activate (nếu có)
        const previousConfig = await ProjectThreshold.findOne({
            projectId: new mongoose.Types.ObjectId(project_id),
            version: { $lt: currentConfig.version },
            isActive: false // Tìm version inactive trước đó
        }).sort({ version: -1 }).session(session).lean(); // Version cao nhất trong các version thấp hơn current

        let activatedPrevious = null;
        if (previousConfig) {
            // Activate previous version
            await ProjectThreshold.updateOne(
                { _id: previousConfig._id },
                { $set: { isActive: true } },
                { session }
            );

            activatedPrevious = await ProjectThreshold.findById(previousConfig._id).session(session).lean();
        }

        // Commit transaction
        await session.commitTransaction();

        return {
            success: true,
            deletedConfig: {
                ...currentConfig, // currentConfig đã là lean object, không cần .toObject()
                isActive: false // Reflect the updated state
            },
            activatedPrevious: activatedPrevious,
            rollback_to_version: activatedPrevious ? activatedPrevious.version : null
        };
    } catch (error) {
        if (session) {
            await session.abortTransaction();
        }
        throw error;
    } finally {
        if (session) {
            await session.endSession();
        }
    }
}



module.exports = {
    getMistakeReport,
    updateErrorType,
    getMistakeForPM,
    approveMistake,
    rejectMistake,
    getProjectQualityStats,
    getAllProjectsQualityStats,
    batchUpdateErrorType,
    batchApproveRejectMistakes,
    getFieldConfiguration,
    updateFieldConfiguration,
    deleteFieldConfiguration,
    getProjectThreshold,
    createOrUpdateProjectThreshold,
    deleteThresholdItem,
    deleteProjectThreshold
};
