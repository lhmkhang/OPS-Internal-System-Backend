const mongoose = require('mongoose');
const { createModel: createMistakeDetailsModel } = require('../../models/reporting/mistakeDetails.model');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const message = require('../../utils/message');
const { getConnection } = require('../../helpers/connectDB');
const logger = require('../../helpers/logger');
const loggerInfo = logger.getLogger("infoLogger");
const { getQcPatterns } = require('../../helpers/qcPatternHelper');
const {
    getFieldConfigByVersion,
    getProjectThresholdByVersion,
    groupDocumentsByVersions,
    getThresholdPercentageByVersion,
    calculateFieldLevelStats,
    calculateCharacterLevelStats,
    parseDateToUTC,
    convertUTCToGMT7DateString,
    mergeResultsBySameThreshold
} = require('./reportingHelpers');

/**
 * Process group data theo report level với version-specific configs
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
            const documentThresholds = thresholdConfig.thresholds.filter(t =>
                t.thresholdScope === 'Document'
            );

            loggerInfo.info(`[processGroupByReportLevel] Document level - dateKey: ${dateKey}, thresholdConfig version: ${thresholdConfig.version}, documentThresholds count: ${documentThresholds.length}`);
            loggerInfo.info(`[processGroupByReportLevel] Document thresholds:`, documentThresholds);

            if (documentThresholds.length > 0) {
                for (const thresholdItem of documentThresholds) {
                    const thresholdType = thresholdItem.thresholdType || 'Critical';
                    const threshold = thresholdItem.thresholdPercentage;

                    let apiThresholdType = 'Critical';
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
        let fieldConfigs = [];
        if (fieldConfig && fieldConfig.fields) {
            fieldConfigs = fieldConfig.fields.filter(field => field.is_report_count !== false);
        }

        if (fieldConfigs && fieldConfigs.length > 0) {
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
                    const thresholdStats = await calculateFieldLevelStats(
                        mistakeDocs,
                        keyingDocs,
                        fieldNames,
                        fieldConfigs,
                        AQC_PATTERN
                    );

                    const threshold = getThresholdPercentageByVersion(thresholdConfig, 'field', thresholdType);

                    let apiThresholdType = 'Critical';
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

        for (const doc of keyingDocs) {
            const recordCount = doc.total_record_document || 0;
            total_keying += recordCount === 0 ? 1 : recordCount;
        }

        for (const doc of keyingDocs) {
            const hasQcTask = (doc.keying_details || []).some(detail => detail.is_qc === true);
            if (hasQcTask) {
                const recordCount = doc.total_record_document || 0;
                total_sample += recordCount === 0 ? 1 : recordCount;
            }
        }

        if (thresholdConfig && thresholdConfig.thresholds) {
            const recordThresholds = thresholdConfig.thresholds.filter(t =>
                t.thresholdScope === 'Record'
            );

            if (recordThresholds.length > 0) {
                for (const thresholdItem of recordThresholds) {
                    const thresholdType = thresholdItem.thresholdType || 'Critical';
                    const threshold = thresholdItem.thresholdPercentage;

                    let apiThresholdType = 'Critical';
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

        for (const doc of keyingDocs) {
            const lineCount = doc.total_line_document || 0;
            total_keying += lineCount === 0 ? 1 : lineCount;
        }

        for (const doc of keyingDocs) {
            const hasQcTask = (doc.keying_details || []).some(detail => detail.is_qc === true);
            if (hasQcTask) {
                const lineCount = doc.total_line_document || 0;
                total_sample += lineCount === 0 ? 1 : lineCount;
            }
        }

        if (thresholdConfig && thresholdConfig.thresholds) {
            const lineItemThresholds = thresholdConfig.thresholds.filter(t =>
                t.thresholdScope === 'Line Item'
            );

            if (lineItemThresholds.length > 0) {
                for (const thresholdItem of lineItemThresholds) {
                    const thresholdType = thresholdItem.thresholdType || 'Critical';
                    const threshold = thresholdItem.thresholdPercentage;

                    let apiThresholdType = 'Critical';
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
        const characterStats = await calculateCharacterLevelStats(
            mistakeDocs,
            keyingDocs,
            AQC_PATTERN
        );

        if (thresholdConfig && thresholdConfig.thresholds) {
            const characterThresholds = thresholdConfig.thresholds.filter(t =>
                t.thresholdScope === 'Character'
            );

            if (characterThresholds.length > 0) {
                for (const thresholdItem of characterThresholds) {
                    const thresholdType = thresholdItem.thresholdType || 'Critical';
                    const threshold = thresholdItem.thresholdPercentage;

                    let apiThresholdType = 'Critical';
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
 * API lấy thông tin chất lượng dự án theo document hoặc field level - VERSION AWARE
 */
async function getProjectQualityStats(req, next) {
    try {
        const { project_id, date_from, date_to, report_level, version_aware = 'true' } = req.query;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!project_id || !date_from || !date_to || !report_level) {
            throw new handleMessage(message.REPORTING.MISSING_PARAMS, StatusCodes.BAD_REQUEST);
        }
        if (!['document', 'field', 'record', 'line_item', 'character'].includes(report_level.toLowerCase())) {
            throw new handleMessage('Invalid report_level. Must be "document", "field", "record", "line_item", or "character"', StatusCodes.BAD_REQUEST);
        }

        const dateFromUTC = parseDateToUTC(date_from);
        const dateToUTC = parseDateToUTC(date_to, true);

        if (!dateFromUTC || !dateToUTC || dateFromUTC > dateToUTC) {
            throw new handleMessage('Invalid date range', StatusCodes.BAD_REQUEST);
        }

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
 */
async function getVersionAwareQualityStats(project_id, dateFromUTC, dateToUTC, report_level, userId, user) {
    const connection = getConnection('default');
    const MistakeDetails = createMistakeDetailsModel(connection, project_id);
    const { createModel: createKeyingAmountModel } = require('../../models/reporting/keyingAmount.model');
    const KeyingAmount = createKeyingAmountModel(connection, project_id);

    let { AQC_PATTERN } = await getQcPatterns();

    const keyingAmountDocs = await KeyingAmount.find({
        imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
    }).lean();

    if (!keyingAmountDocs || keyingAmountDocs.length === 0) {
        return [];
    }

    const docIds = keyingAmountDocs.map(doc => doc.doc_id);

    const mistakeDetailsDocs = await MistakeDetails.find({
        doc_id: { $in: docIds },
        imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
    }).lean();

    loggerInfo.info(`[Version-Based] Project ${project_id}: Found ${keyingAmountDocs.length} keying documents and ${mistakeDetailsDocs.length} documents with mistakes`);

    const groupedData = groupDocumentsByVersions(keyingAmountDocs, mistakeDetailsDocs);

    const results = [];

    for (const [groupKey, groupData] of Object.entries(groupedData)) {
        const { dateKey, fieldConfigVersion, projectThresholdVersion, keyingDocs, mistakeDocs, versionInfo } = groupData;

        loggerInfo.info(`[Version-Based] Processing group: ${groupKey} with ${keyingDocs.length} keying docs, ${mistakeDocs.length} mistake docs`);

        const fieldConfig = await getFieldConfigByVersion(project_id, fieldConfigVersion, connection);
        const thresholdConfig = await getProjectThresholdByVersion(project_id, projectThresholdVersion, connection);

        loggerInfo.info(`[getVersionAwareQualityStats] Processing group: ${groupKey}`);
        loggerInfo.info(`[getVersionAwareQualityStats] ThresholdConfig loaded - version: ${thresholdConfig?.version}, thresholds count: ${thresholdConfig?.thresholds?.length || 0}`);
        if (thresholdConfig?.thresholds) {
            thresholdConfig.thresholds.forEach((t, idx) => {
                loggerInfo.info(`[getVersionAwareQualityStats] Threshold ${idx}: scope=${t.thresholdScope}, type=${t.thresholdType}, percentage=${t.thresholdPercentage}`);
            });
        }

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

    const mergedResults = mergeResultsBySameThreshold(results);

    loggerInfo.info(`[Version-Based] Project ${project_id}: Generated ${results.length} results across ${Object.keys(groupedData).length} version groups, merged to ${mergedResults.length} final results`);
    return mergedResults;
}

/**
 * Legacy quality stats implementation (unchanged)
 */
async function getLegacyQualityStats(project_id, dateFromUTC, dateToUTC, report_level, userId, user) {
    const connection = getConnection('default');
    const MistakeDetails = createMistakeDetailsModel(connection, project_id);

    const { createModel: createKeyingAmountModel } = require('../../models/reporting/keyingAmount.model');
    const KeyingAmount = createKeyingAmountModel(connection, project_id);

    const { schema: projectThresholdSchema, collectionName: projectThresholdCollectionName } = require('../../models/reporting/ProjectThresholdModel');
    const ProjectThreshold = connection.model(projectThresholdCollectionName, projectThresholdSchema, projectThresholdCollectionName);
    const thresholdConfig = await ProjectThreshold.findOne({
        projectId: new mongoose.Types.ObjectId(project_id),
        isActive: true
    }).lean();

    let { AQC_PATTERN } = await getQcPatterns();

    const keyingAmountDocs = await KeyingAmount.find({
        imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
    }).lean();

    if (!keyingAmountDocs || keyingAmountDocs.length === 0) {
        return [];
    }

    const docIds = keyingAmountDocs.map(doc => doc.doc_id);

    const mistakeDetailsDocs = await MistakeDetails.find({
        doc_id: { $in: docIds },
        imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
    }).lean();

    loggerInfo.info(`[Legacy] Project ${project_id}: Found ${keyingAmountDocs.length} keying documents and ${mistakeDetailsDocs.length} documents with mistakes`);

    const keyingDocsByDate = {};
    const mistakeDocsByDate = {};

    keyingAmountDocs.forEach(doc => {
        const dateKey = convertUTCToGMT7DateString(doc.imported_date);
        if (!keyingDocsByDate[dateKey]) {
            keyingDocsByDate[dateKey] = [];
        }
        keyingDocsByDate[dateKey].push(doc);
    });

    mistakeDetailsDocs.forEach(doc => {
        const dateKey = convertUTCToGMT7DateString(doc.imported_date);
        if (!mistakeDocsByDate[dateKey]) {
            mistakeDocsByDate[dateKey] = [];
        }
        mistakeDocsByDate[dateKey].push(doc);
    });

    const getThresholdPercentage = (reportLevel, thresholdType = null) => {
        return getThresholdPercentageByVersion(thresholdConfig, reportLevel, thresholdType);
    };

    const results = [];

    if (report_level.toLowerCase() === 'document') {
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

            total_keying = keyingDocsForDate.length;

            for (const doc of keyingDocsForDate) {
                const isQcDoc = (doc.keying_details || []).some(detail => detail.is_qc === true);
                if (isQcDoc) {
                    total_sample++;
                }
            }

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
        const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../../models/reporting/fieldDefinitionCollection.model');
        const ProjectFieldConfiguration = connection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

        const projectFieldConfig = await ProjectFieldConfiguration.findOne(
            {
                project_id: new mongoose.Types.ObjectId(project_id),
                isActive: true
            },
            { fields: 1 }
        ).sort({ version: -1 }).lean();

        let fieldConfigs = [];
        if (projectFieldConfig && projectFieldConfig.fields) {
            fieldConfigs = projectFieldConfig.fields.filter(field => field.is_report_count !== false);
        }

        if (fieldConfigs && fieldConfigs.length > 0) {
            const allDates = new Set([
                ...Object.keys(keyingDocsByDate),
                ...Object.keys(mistakeDocsByDate)
            ]);

            const fieldsByThreshold = {};
            fieldConfigs.forEach(field => {
                const thresholdType = field.critical_field || 'Critical';
                if (!fieldsByThreshold[thresholdType]) {
                    fieldsByThreshold[thresholdType] = [];
                }
                fieldsByThreshold[thresholdType].push(field.field_name);
            });

            for (const dateKey of allDates) {
                const keyingDocsForDate = keyingDocsByDate[dateKey] || [];
                const mistakeDocsForDate = mistakeDocsByDate[dateKey] || [];

                for (const [thresholdType, fieldNames] of Object.entries(fieldsByThreshold)) {
                    if (fieldNames && fieldNames.length > 0) {
                        const thresholdStats = await calculateFieldLevelStats(
                            mistakeDocsForDate,
                            keyingDocsForDate,
                            fieldNames,
                            fieldConfigs,
                            AQC_PATTERN
                        );

                        const threshold = getThresholdPercentage('field', thresholdType);

                        let apiThresholdType = 'Critical';
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
    }
    // Similar implementation for record, line_item, character levels...

    return results;
}

/**
 * API lấy thông tin chất lượng tất cả dự án và tất cả report levels
 */
async function getAllProjectsQualityStats(req, next) {
    try {
        const { date_from, date_to, version_aware = 'true' } = req.query;
        const userId = req.userId;
        const user = req.user;

        if (!userId || !user) {
            throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
        }
        if (!date_from || !date_to) {
            throw new handleMessage('date_from and date_to are required', StatusCodes.BAD_REQUEST);
        }

        const dateFromUTC = parseDateToUTC(date_from);
        const dateToUTC = parseDateToUTC(date_to, true);

        if (!dateFromUTC || !dateToUTC || dateFromUTC > dateToUTC) {
            throw new handleMessage('Invalid date range', StatusCodes.BAD_REQUEST);
        }

        const connection = getConnection('default');

        const { schema: ProjectsPlanSchema, collectionName: ProjectPlanCollectionName } = require('../../models/ProjectsPlanModel');
        const ProjectsPlan = connection.model(ProjectPlanCollectionName, ProjectsPlanSchema, ProjectPlanCollectionName);
        const allProjects = await ProjectsPlan.find({}, { _id: 1, projectName: 1 }).lean();

        if (!allProjects || allProjects.length === 0) {
            return [];
        }

        let { AQC_PATTERN } = await getQcPatterns();

        const allResults = [];

        for (const project of allProjects) {
            const project_id = project._id.toString();
            const projectName = project.projectName;

            try {
                const projectResults = [];

                const MistakeDetails = createMistakeDetailsModel(connection, project_id);
                const { createModel: createKeyingAmountModel } = require('../../models/reporting/keyingAmount.model');
                const KeyingAmount = createKeyingAmountModel(connection, project_id);

                const keyingAmountDocs = await KeyingAmount.find({
                    imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
                }).lean();

                if (!keyingAmountDocs || keyingAmountDocs.length === 0) {
                    continue;
                }

                const docIds = keyingAmountDocs.map(doc => doc.doc_id);

                const mistakeDetailsDocs = await MistakeDetails.find({
                    doc_id: { $in: docIds },
                    imported_date: { $gte: dateFromUTC, $lte: dateToUTC }
                }).lean();

                const groupedData = groupDocumentsByVersions(keyingAmountDocs, mistakeDetailsDocs);
                loggerInfo.info(`[getAllProjectsQualityStats] Project ${projectName}: Found ${Object.keys(groupedData).length} version groups`);

                loggerInfo.info(`[getAllProjectsQualityStats] Project ${projectName}: Total keying docs: ${keyingAmountDocs.length}, mistake docs: ${mistakeDetailsDocs.length}`);

                for (const [groupKey, groupData] of Object.entries(groupedData)) {
                    const { dateKey, fieldConfigVersion, projectThresholdVersion, keyingDocs, mistakeDocs } = groupData;

                    if (keyingDocs.length === 0) continue;

                    const fieldConfig = await getFieldConfigByVersion(project_id, fieldConfigVersion, connection);
                    const thresholdConfig = await getProjectThresholdByVersion(project_id, projectThresholdVersion, connection);

                    loggerInfo.info(`[getAllProjectsQualityStats] Processing project ${projectName}, group: ${groupKey}, field config v${fieldConfigVersion}, threshold v${projectThresholdVersion}`);

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

                        groupResults.forEach(result => {
                            result.project_name = projectName;
                        });

                        projectResults.push(...groupResults);
                    }
                }

                loggerInfo.info(`[getAllProjectsQualityStats] Project ${projectName}: Before merge - ${projectResults.length} results`);
                const mergedProjectResults = mergeResultsBySameThreshold(projectResults);
                loggerInfo.info(`[getAllProjectsQualityStats] Project ${projectName}: After merge - ${mergedProjectResults.length} results`);
                allResults.push(...mergedProjectResults);

            } catch (projectError) {
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

module.exports = {
    processGroupByReportLevel,
    getProjectQualityStats,
    getVersionAwareQualityStats,
    getLegacyQualityStats,
    getAllProjectsQualityStats
}; 