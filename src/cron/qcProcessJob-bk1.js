const cron = require('node-cron');
const path = require('path');
const mongoose = require('mongoose');
const logger = require('../helpers/logger');
const { getMistake, getQCAmountByStep } = require('../helpers/qualityControlServices');
const { getConnection } = require('../helpers/connectDB');
const { schema: ProjectsPlanSchema, collectionName: ProjectPlanCollectionName } = require('../models/ProjectsPlanModel');
const { createModel: createMistakeDetailsModel } = require('../models/reporting/mistakeDetails.model');
const { createModel: createKeyingAmountModel } = require('../models/reporting/keyingAmount.model');
const { schema: IncompleteDocTrackingSchema, collectionName: IncompleteDocTrackingCollectionName } = require('../models/reporting/incompleteDocTracking.model');
const { schema: ProcessingCheckpointSchema, collectionName: ProcessingCheckpointCollectionName } = require('../models/reporting/processingCheckpoint.model');
const { schema: FieldConfigurationSchema, collectionName: FieldConfigurationCollectionName } = require('../models/reporting/fieldDefinitionCollection.model');
const { getMistake: getMistakeLegacy, getQCAmount: getQCAmountLegacy } = require('../helpers/qualityControlServices-bk');
const { getQcPatterns } = require('../helpers/qcPatternHelper');

const loggerInfo = logger.getLogger("infoLogger");
const loggerError = logger.getLogger("errorLogger");

// Đường dẫn đến file .env
require('dotenv').config({ path: path.resolve(__dirname, "../..", ".env") });

/**
 * Chuẩn hóa records để lấy dataFiltered
 */
function prepareDataFiltered(doc) {
    return Array.isArray(doc.records) ? doc.records.map(record => ({
        ...record,
        keyed_data: Array.isArray(record.keyed_data)
            ? record.keyed_data.filter(
                node => node.source === 'queue_transform' && !node.section.toLowerCase().includes('system') &&
                    (node.hasOwnProperty('reason') &&
                        (node.reason === null || node.reason.comment === null || node.reason.comment === '')) &&
                    (node.keyer !== 'tkthang' && node.keyer !== 'auto service') && node.section !== "System"
            ) : []
    })) : [];
}

/**
 * Chuẩn bị Mistake/QCEffort cho 1 document (trả về thao tác bulkWrite)
 */
async function prepareDocumentSteps({
    doc,
    projectId,
    fieldNotCount,
    filterControl,
    completedSteps = [],
    sectionMultiRow = ["Line"],
    DocumentHistoryModel
}) {
    const dataFiltered = prepareDataFiltered(doc);
    let documentHistory = [];
    let useLegacy = false;
    if (DocumentHistoryModel) {
        documentHistory = await DocumentHistoryModel.find({ doc_id: doc._id.toString() }).lean();
        if (!documentHistory || documentHistory.length === 0 || !documentHistory[0].keyed_data) {
            useLegacy = true;
        }
    } else {
        useLegacy = true;
    }

    // Lấy pattern từ DB để truyền vào các hàm
    const { QC_PATTERN, AQC_PATTERN, COMBINED_PATTERN } = await getQcPatterns();

    let allMistakes = [];
    let allQCEfforts = [];
    if (!useLegacy) {
        allMistakes = getMistake(fieldNotCount, doc, dataFiltered, documentHistory, sectionMultiRow);
        allQCEfforts = [getQCAmountByStep(doc, dataFiltered, projectId, doc.batch_id?.toString(), documentHistory, sectionMultiRow, fieldNotCount, COMBINED_PATTERN)];
    } else {
        allMistakes = getMistakeLegacy(fieldNotCount, doc, dataFiltered, projectId, doc.batch_id?.toString()) || [];
        allMistakes = allMistakes.map(m => ({
            project_id: m.project_id || projectId,
            batch_id: m.batch_id || doc.batch_id,
            batch_name: m.batch_name || doc.batch_name || '',
            doc_id: m.doc_id || doc._id,
            // doc_uri: m.doc_uri || (doc.doc_uri ? doc.doc_uri.join('|') : ''),
            s2_url: m.s2_url || (doc.s2_url ? doc.s2_url.join('|') : ''),
            line_idx: m.line_idx || '',
            record_idx: m.record_idx || '',
            field_name: m.field_name || '',
            layout_name: m.layout_name || doc.layout_name || '',
            user_name_keyer: m.user_name_keyer || '',
            user_name_final: m.user_name_final || '',
            task_keyer_name: m.task_keyer_name || '',
            task_final_name: m.task_final_name || '',
            section_keyer: m.section_keyer || '',
            section_final: m.section_final || '',
            value_keyer: m.value_keyer || '',
            value_final: m.value_final || '',
            captured_keyer_at: m.captured_keyer_at || '',
            captured_final_at: m.captured_final_at || '',
            imported_date: m.imported_date || doc.created_date || ''
        }));

        const legacyEfforts = getQCAmountLegacy(filterControl, fieldNotCount, doc, dataFiltered, projectId, doc.batch_id?.toString(), COMBINED_PATTERN) || [];

        // Convert legacy format sang format mới với keying_details
        if (legacyEfforts.length > 0) {
            const keying_details = legacyEfforts.map(e => ({
                task_keyer_name: e.task_keyer_name || '',
                user_name_keyer: e.user_name_keyer || '',
                total_field: e.total_field || 0,
                total_character: e.total_character || 0,
                total_records: e.total_records || 0,
                total_lines: e.total_lines || 0,
                is_qc: typeof e.is_qc === 'boolean' ? e.is_qc : false,
                captured_keyer_at: e.captured_keyer_at || ''
            }));

            // Tính tổng cho document level (legacy không có final_data nên dùng tổng từ các step)
            const total_field_document = keying_details.reduce((sum, detail) => sum + detail.total_field, 0);
            const total_character_document = keying_details.reduce((sum, detail) => sum + detail.total_character, 0);
            const total_line_document = keying_details.reduce((sum, detail) => sum + detail.total_lines, 0);
            const total_record_document = keying_details.reduce((sum, detail) => sum + detail.total_records, 0);

            allQCEfforts = [{
                project_id: projectId,
                batch_id: doc.batch_id,
                batch_name: doc.batch_name || '',
                doc_id: doc._id,
                layout_name: doc.layout_name || '',
                total_field_document,
                total_character_document,
                total_line_document,
                total_record_document,
                keying_details,
                imported_date: doc.created_date || '',
                exported_date: doc.exported_date || null,
                uploaded_date: doc.delivery_date || null
            }];
        } else {
            allQCEfforts = [];
        }
    }
    // Helper function để parse Date
    const parseDate = (dateStr) => {
        if (!dateStr || dateStr === '') return null;
        const date = new Date(dateStr);
        return isNaN(date.getTime()) ? null : date;
    };

    // Mapping allMistakes thành array mistake_details (field-level)
    const mistake_details = (allMistakes || []).map(m => {
        // Check nếu task_final_name match pattern QC thì set error_found_at = 'qc', còn lại là 'verify'
        const errorFoundAt = AQC_PATTERN.test(m.task_final_name || '') ? 'qc' : 'verify';

        return {
            task_keyer_name: m.task_keyer_name || '',
            task_final_name: m.task_final_name || '',
            section: m.section_keyer || m.section_final || m.section || '',
            record_idx: m.record_idx.toString(),
            line_idx: m.line_idx.toString(),
            field_name: m.field_name || '',
            user_name_keyer: m.user_name_keyer || '',
            user_name_final: m.user_name_final || '',
            value_keyer: m.value_keyer || '',
            value_final: m.value_final || '',
            captured_keyer_at: parseDate(m.captured_keyer_at),
            captured_final_at: parseDate(m.captured_final_at),
            layout_name: m.layout_name || doc.layout_name || '',
            error_type: m.error_type || null,
            error_found_at: errorFoundAt
        };
    });

    // Upsert 1 document/report cho mỗi doc_id
    const bulkOpsMistake = [];
    if (mistake_details.length > 0) {
        // Kiểm tra batch_id vì schema yêu cầu bắt buộc
        if (!doc.batch_id) {
            loggerInfo.warn(`[QC Debug] Document ${doc._id} has no batch_id, skipping mistake report creation`);
        } else {
            try {
                const batchIdObj = new mongoose.Types.ObjectId(doc.batch_id);
                const projectIdObj = new mongoose.Types.ObjectId(projectId);
                const docIdObj = new mongoose.Types.ObjectId(doc._id);

                bulkOpsMistake.push({
                    updateOne: {
                        filter: { doc_id: docIdObj },
                        update: {
                            $set: {
                                project_id: projectIdObj,
                                batch_id: batchIdObj,
                                doc_id: docIdObj,
                                batch_name: doc.batch_name || '',
                                imported_date: doc.created_date ? new Date(doc.created_date) : null,
                                s2_url: doc.s2_url ? doc.s2_url.join('|') : '',
                                // doc_uri: doc.doc_uri ? doc.doc_uri.join('|') : ''
                            },
                            $addToSet: { mistake_details: { $each: mistake_details } }
                        },
                        upsert: true
                    }
                });
            } catch (error) {
                loggerError.error(`[QC Debug] Lỗi convert ObjectId for doc ${doc._id}:`, error.message);
            }
        }
    }
    // QCEffort với cấu trúc mới - 1 document cho mỗi doc_id
    const bulkOpsEffort = [];
    let newCompletedSteps = [...completedSteps];

    if (allQCEfforts.length > 0) {
        const keyingDoc = allQCEfforts[0]; // Chỉ có 1 document cho mỗi doc

        // Convert ObjectId và đảm bảo cấu trúc đúng
        const effortDoc = {
            project_id: new mongoose.Types.ObjectId(keyingDoc.project_id || projectId),
            batch_id: keyingDoc.batch_id ? new mongoose.Types.ObjectId(keyingDoc.batch_id) : null,
            batch_name: keyingDoc.batch_name || doc.batch_name || '',
            doc_id: new mongoose.Types.ObjectId(keyingDoc.doc_id || doc._id),
            layout_name: keyingDoc.layout_name || doc.layout_name || '',
            // Document level totals
            total_field_document: keyingDoc.total_field_document || 0,
            total_character_document: keyingDoc.total_character_document || 0,
            total_line_document: keyingDoc.total_line_document || 0,
            total_record_document: keyingDoc.total_record_document || 0,
            // Step details
            keying_details: keyingDoc.keying_details || [],
            // Metadata
            imported_date: keyingDoc.imported_date || doc.created_date || null,
            exported_date: keyingDoc.exported_date || null,
            uploaded_date: keyingDoc.uploaded_date || null
        };

        bulkOpsEffort.push({
            updateOne: {
                filter: { doc_id: new mongoose.Types.ObjectId(doc._id) },
                update: { $set: effortDoc },
                upsert: true
            }
        });

        // Track completed steps từ keying_details
        if (keyingDoc.keying_details && Array.isArray(keyingDoc.keying_details)) {
            const stepNames = keyingDoc.keying_details.map(detail => detail.task_keyer_name);
            newCompletedSteps = [...new Set([...newCompletedSteps, ...stepNames])];
        }
    }
    return {
        bulkOpsMistake,
        bulkOpsEffort,
        insertedMistake: mistake_details.length,
        insertedEffort: allQCEfforts.length,
        newCompletedSteps,
        processed: mistake_details.length > 0 || allQCEfforts.length > 0
    };
}

/**
 * Chuẩn bị thao tác bulkWrite cho document đã hoàn thành
 */
async function handleDocumentComplete(args) {
    const { doc, projectId, fieldNotCount, filterControl, sectionMultiRow, DocumentHistoryModel } = args;

    // Không còn cần xóa doc tracking vì giờ theo dõi theo batch
    const bulkOpsIncomplete = [];

    const { bulkOpsMistake, bulkOpsEffort, insertedMistake, insertedEffort, newCompletedSteps, processed } = await prepareDocumentSteps({
        doc, projectId, fieldNotCount, filterControl, sectionMultiRow, DocumentHistoryModel
    });
    return { bulkOpsIncomplete, bulkOpsMistake, bulkOpsEffort, insertedMistake, insertedEffort, newCompletedSteps, processed };
}

/**
 * Hàm chính để xử lý QC data
 */
async function processQCData() {
    const processStartTime = new Date();
    loggerInfo.info(`[QC Cron Job] Starting QC data processing at ${processStartTime.toISOString()}...`);

    let defaultConnection = null;
    let primaryConnection = null;

    try {
        // Kiểm tra kết nối trước khi bắt đầu
        defaultConnection = getConnection('default');
        primaryConnection = getConnection('primary');

        if (!defaultConnection || defaultConnection.readyState !== 1) {
            throw new Error('Default database connection is not available');
        }
        if (!primaryConnection || primaryConnection.readyState !== 1) {
            throw new Error('Primary database connection is not available');
        }

        loggerInfo.info('[QC Cron Job] Database connection successfully confirmed');

        // Legacy models sẽ không còn sử dụng, chuyển sang dynamic models trong loop project
        const ProjectPlanModel = mongoose.models[ProjectPlanCollectionName] || defaultConnection.model(ProjectPlanCollectionName, ProjectsPlanSchema);
        const IncompleteTrackingModel = mongoose.models[IncompleteDocTrackingCollectionName] || defaultConnection.model(IncompleteDocTrackingCollectionName, IncompleteDocTrackingSchema);
        const CheckpointModel = mongoose.models[ProcessingCheckpointCollectionName] || defaultConnection.model(ProcessingCheckpointCollectionName, ProcessingCheckpointSchema);
        const FieldConfigurationModel = mongoose.models[FieldConfigurationCollectionName] || defaultConnection.model(FieldConfigurationCollectionName, FieldConfigurationSchema);

        // Lấy danh sách dự án
        const projects = await ProjectPlanModel.find({}, { _id: 1, projectName: 1 }).lean();
        loggerInfo.info(`[QC Cron Job] Found ${projects.length} projects for QC data processing`);

        let totalProcessedDocs = 0, totalMistakes = 0, totalQCEfforts = 0;
        const filterControl = 'both';
        const BATCH_SIZE = 1000; // Kích thước batch để xử lý document

        for (const project of projects) {
            const projectId = project._id.toString();
            // Dynamic models cho project hiện tại
            const MistakeDetailsModel = createMistakeDetailsModel(defaultConnection, projectId);
            const KeyingAmountModel = createKeyingAmountModel(defaultConnection, projectId);

            loggerInfo.info(`[QC Cron Job] Using dynamic collections: ${MistakeDetailsModel.collection.name}, ${KeyingAmountModel.collection.name}`);

            // Thay đổi: Sử dụng batch thay vì document
            const batchModelName = `${projectId}_batch`;
            const documentModelName = `${projectId}_document`;
            const sectionDefModelName = 'section_definitions';
            const DocumentHistoryModelName = `${projectId}_document_history`;

            const BatchSchema = new mongoose.Schema({}, { strict: false, collection: batchModelName });
            const DocumentSchema = new mongoose.Schema({}, { strict: false, collection: documentModelName });
            const SectionDefSchema = new mongoose.Schema({}, { strict: false, collection: sectionDefModelName });
            const DocumentHistorySchema = new mongoose.Schema({}, { strict: false, collection: DocumentHistoryModelName });

            let BatchModel = primaryConnection.models[batchModelName] || primaryConnection.model(batchModelName, BatchSchema);
            let DocumentModel = primaryConnection.models[documentModelName] || primaryConnection.model(documentModelName, DocumentSchema);
            let SectionDefModel = primaryConnection.models[sectionDefModelName] || primaryConnection.model(sectionDefModelName, SectionDefSchema);
            let DocumentHistoryModel = primaryConnection.models[DocumentHistoryModelName] || primaryConnection.model(DocumentHistoryModelName, DocumentHistorySchema);

            const fieldsNotCounted = await FieldConfigurationModel.find(
                { is_report_count: false, project_id: project._id },
                { field_name: 1, _id: 0 }
            ).lean();
            const fieldNotCount = fieldsNotCounted.map(field => field.field_name);

            // Lấy sectionMultiRow từ DB với project_id và settings.is_multiple = true
            const sectionDefs = await SectionDefModel.find({ project_id: project._id, 'settings.is_multiple': true }, { name: 1, _id: 0 }).lean();
            const sectionMultiRow = [...new Set(sectionDefs.map(section => section.name))];

            let checkpoint = await CheckpointModel.findOne({ project_id: project._id });
            if (!checkpoint) {
                checkpoint = new CheckpointModel({ project_id: project._id });
                await checkpoint.save();
            }

            // Gộp deleteMany và updateOne checkpoint vào bulkWrite
            const projectBulkOps = [];
            if (checkpoint.last_batch_id) {
                projectBulkOps.push({
                    deleteMany: {
                        filter: { project_id: project._id, batch_id: { $gt: checkpoint.last_batch_id } }
                    }
                });
                await MistakeDetailsModel.bulkWrite(projectBulkOps);
                await KeyingAmountModel.bulkWrite(projectBulkOps);
                loggerInfo.info(`[QC Cron Job] Deleted reports with batch_id > checkpoint (${checkpoint.last_batch_id}) from collections ${MistakeDetailsModel.collection.name} and ${KeyingAmountModel.collection.name}`);
            }

            // Thay đổi: Sử dụng batch query thay vì document query
            const batchQuery = {};
            if (checkpoint.last_batch_id) batchQuery._id = { $gt: checkpoint.last_batch_id };

            loggerInfo.info(`[QC Cron Job] Processing project: ${project.projectName || 'No name'} (${project._id})`);
            loggerInfo.info(`[QC Cron Job] Using batch query condition: ${JSON.stringify(batchQuery)}`);

            // Lấy danh sách batch mới
            const batches = await BatchModel.find(batchQuery).sort({ _id: 1 }).lean();
            loggerInfo.info(`[QC Cron Job] Found ${batches.length} new batches for project ${project.projectName}`);

            // Batch chưa hoàn thành từ lần trước
            const incompleteBatches = await IncompleteTrackingModel.find({ project_id: project._id }).lean();
            const incompleteBatchesMap = new Map(incompleteBatches.map(batch => [batch.batch_id.toString(), batch.status || 0]));
            loggerInfo.info(`[QC Cron Job] Found ${incompleteBatches.length} incomplete batches from previous run`);

            let lastBatchId = null;
            let lastDocId = null;
            let batchDocs = [];
            let batchBulkOpsIncomplete = [];
            let batchBulkOpsMistake = [];
            let batchBulkOpsEffort = [];

            // Xử lý từng batch
            for (const batch of batches) {
                lastBatchId = batch._id;

                // Kiểm tra xem batch đã được xử lý chưa
                if (batch.status >= 100) {
                    // Batch đã hoàn thành -> xử lý tất cả document
                    loggerInfo.info(`[QC Cron Job] Batch ${batch._id} is completed, retrieving all documents...`);

                    // Lấy tất cả document của batch này
                    const docCursor = DocumentModel.find({ batch_id: batch._id, layout_name: { $not: { $regex: "_none_|^other$|^others$|^bad$", $options: "i" } } }).lean().cursor();

                    for await (const doc of docCursor) {
                        lastDocId = doc._id;
                        let result;

                        if (doc.status >= 450) {
                            // Document đã hoàn thành
                            result = await handleDocumentComplete({
                                doc,
                                projectId: project._id,
                                fieldNotCount,
                                filterControl,
                                sectionMultiRow,
                                DocumentHistoryModel
                            });
                            loggerInfo.info(`[QC Cron Job] Document ${doc._id} (completed): Added ${result.insertedMistake} mistakes, ${result.insertedEffort} QC efforts`);
                        } else {
                            // Document chưa hoàn thành nhưng batch đã hoàn thành -> vẫn xử lý document
                            result = await handleDocumentComplete({
                                doc,
                                projectId: project._id,
                                fieldNotCount,
                                filterControl,
                                sectionMultiRow,
                                DocumentHistoryModel
                            });
                            loggerInfo.info(`[QC Cron Job] Document ${doc._id} (incomplete but batch is completed): Added ${result.insertedMistake} mistakes, ${result.insertedEffort} QC efforts`);
                        }

                        batchBulkOpsMistake.push(...result.bulkOpsMistake);
                        batchBulkOpsEffort.push(...result.bulkOpsEffort);

                        if (result.processed) totalProcessedDocs++;
                        totalMistakes += result.insertedMistake;
                        totalQCEfforts += result.insertedEffort;

                        batchDocs.push(doc);
                        if (batchDocs.length === BATCH_SIZE) {
                            // Xử lý bulkWrite cho batch document
                            await processBulkWrites(MistakeDetailsModel, KeyingAmountModel, IncompleteTrackingModel, batchBulkOpsMistake, batchBulkOpsEffort, batchBulkOpsIncomplete);

                            // Reset batch
                            batchDocs = [];
                            batchBulkOpsIncomplete = [];
                            batchBulkOpsMistake = [];
                            batchBulkOpsEffort = [];
                        }
                    }

                    // Đánh dấu batch đã hoàn thành và đã xử lý
                    if (incompleteBatchesMap.has(batch._id.toString())) {
                        batchBulkOpsIncomplete.push({
                            deleteOne: {
                                filter: {
                                    project_id: new mongoose.Types.ObjectId(project._id),
                                    batch_id: new mongoose.Types.ObjectId(batch._id)
                                }
                            }
                        });
                    }
                } else {
                    // Batch chưa hoàn thành -> chỉ track batch, không xử lý document
                    loggerInfo.info(`[QC Cron Job] Batch ${batch._id} is incomplete (status=${batch.status}), only tracking batch`);

                    // Update hoặc insert batch chưa hoàn thành
                    batchBulkOpsIncomplete.push({
                        updateOne: {
                            filter: {
                                project_id: new mongoose.Types.ObjectId(project._id),
                                batch_id: new mongoose.Types.ObjectId(batch._id)
                            },
                            update: {
                                $set: {
                                    project_id: new mongoose.Types.ObjectId(project._id),
                                    batch_id: new mongoose.Types.ObjectId(batch._id),
                                    status: batch.status || 0,
                                    last_processed_at: new Date(),
                                    imported_date: batch.created_date || null
                                }
                            },
                            upsert: true
                        }
                    });
                }

                // Xử lý bulkWrite sau mỗi batch nếu có dữ liệu
                if (batchDocs.length > 0 || batchBulkOpsIncomplete.length > 0) {
                    await processBulkWrites(MistakeDetailsModel, KeyingAmountModel, IncompleteTrackingModel, batchBulkOpsMistake, batchBulkOpsEffort, batchBulkOpsIncomplete);

                    // Reset batch
                    batchDocs = [];
                    batchBulkOpsIncomplete = [];
                    batchBulkOpsMistake = [];
                    batchBulkOpsEffort = [];
                }
            }

            loggerInfo.info(`[QC Cron Job] Completed processing new batches. Starting to check incomplete batches from previous run...`);

            // Xử lý lại batch chưa hoàn thành từ lần trước
            for (const incompleteBatch of incompleteBatches) {
                // Bỏ qua batch đã xử lý ở trên
                if (lastBatchId && incompleteBatch.batch_id.toString() === lastBatchId.toString()) {
                    continue;
                }

                try {
                    // Kiểm tra xem batch đã có sự thay đổi chưa
                    const currentBatch = await BatchModel.findOne({ _id: incompleteBatch.batch_id }).lean();
                    if (!currentBatch) {
                        // Batch không còn tồn tại -> xóa khỏi tracking
                        batchBulkOpsIncomplete.push({
                            deleteOne: {
                                filter: { _id: incompleteBatch._id }
                            }
                        });
                        loggerInfo.info(`[QC Cron Job] Batch ${incompleteBatch.batch_id} no longer exists, removed from tracking`);
                        continue;
                    }

                    if (currentBatch.status >= 100) {
                        // Batch đã hoàn thành -> xử lý tất cả document
                        loggerInfo.info(`[QC Cron Job] Batch ${currentBatch._id} has changed to completed status, retrieving all documents...`);

                        // Xóa batch khỏi incomplete tracking
                        batchBulkOpsIncomplete.push({
                            deleteOne: {
                                filter: {
                                    project_id: new mongoose.Types.ObjectId(project._id),
                                    batch_id: new mongoose.Types.ObjectId(currentBatch._id)
                                }
                            }
                        });

                        // Lấy tất cả document của batch này
                        const docs = await DocumentModel.find({ batch_id: currentBatch._id, layout_name: { $not: { $regex: "_none_|^other$|^others$|^bad$", $options: "i" } } }).lean();
                        loggerInfo.info(`[QC Cron Job] Found ${docs.length} documents for batch ${currentBatch._id}`);

                        for (const doc of docs) {
                            let result = await handleDocumentComplete({
                                doc,
                                projectId: project._id,
                                fieldNotCount,
                                filterControl,
                                sectionMultiRow,
                                DocumentHistoryModel
                            });

                            batchBulkOpsMistake.push(...result.bulkOpsMistake);
                            batchBulkOpsEffort.push(...result.bulkOpsEffort);

                            if (result.processed) totalProcessedDocs++;
                            totalMistakes += result.insertedMistake;
                            totalQCEfforts += result.insertedEffort;
                        }
                    } else {
                        // Batch vẫn chưa hoàn thành -> cập nhật trạng thái
                        batchBulkOpsIncomplete.push({
                            updateOne: {
                                filter: {
                                    project_id: new mongoose.Types.ObjectId(project._id),
                                    batch_id: new mongoose.Types.ObjectId(currentBatch._id)
                                },
                                update: {
                                    $set: {
                                        status: currentBatch.status || 0,
                                        last_processed_at: new Date()
                                    }
                                }
                            }
                        });
                        loggerInfo.info(`[QC Cron Job] Batch ${currentBatch._id} is still incomplete (status=${currentBatch.status}), tracking updated`);
                    }
                } catch (error) {
                    loggerError.error(`[QC Cron Job] Error processing incomplete batch ${incompleteBatch.batch_id}:`, error);
                }

                // Xử lý bulkWrite sau mỗi incompleteBatch nếu có dữ liệu
                if (batchBulkOpsIncomplete.length > 0 || batchBulkOpsMistake.length > 0 || batchBulkOpsEffort.length > 0) {
                    await processBulkWrites(MistakeDetailsModel, KeyingAmountModel, IncompleteTrackingModel, batchBulkOpsMistake, batchBulkOpsEffort, batchBulkOpsIncomplete);

                    // Reset batch
                    batchBulkOpsIncomplete = [];
                    batchBulkOpsMistake = [];
                    batchBulkOpsEffort = [];
                }
            }

            // Cập nhật checkpoint
            if (lastBatchId) {
                projectBulkOps.push({
                    updateOne: {
                        filter: { project_id: project._id },
                        update: {
                            $set: {
                                last_batch_id: lastBatchId,
                                last_run_at: new Date()
                            }
                        }
                    }
                });
                await CheckpointModel.bulkWrite(projectBulkOps, { ordered: false });
                loggerInfo.info(`[QC Cron Job] Updated checkpoint for project ${project.projectName} with last_batch_id: ${lastBatchId}`);
            }
        }

        const processEndTime = new Date();
        const totalDuration = processEndTime - processStartTime;
        loggerInfo.info(`[QC Cron Job] Completed processing QC data: ${totalProcessedDocs} documents, ${totalMistakes} mistakes, ${totalQCEfforts} QC efforts in ${Math.round(totalDuration / 1000)}s`);
    } catch (error) {
        const processEndTime = new Date();
        const totalDuration = processEndTime - processStartTime;
        loggerError.error(`[QC Cron Job] Error processing QC data after ${Math.round(totalDuration / 1000)}s:`, {
            message: error.message,
            stack: error.stack,
            connections: {
                default: defaultConnection ? defaultConnection.readyState : 'null',
                primary: primaryConnection ? primaryConnection.readyState : 'null'
            }
        });

        // Re-throw error để caller xử lý
        throw error;
    } finally {
        // Log memory usage sau khi xử lý
        if (process.memoryUsage) {
            const memUsage = process.memoryUsage();
            loggerInfo.info('[QC Cron Job] Memory usage:', {
                heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
                external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
                rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`
            });
        }

        loggerInfo.info('[QC Cron Job] Finished processQCData function');
    }
}

/**
 * Xử lý bulkWrite cho các operations
 */
async function processBulkWrites(MistakeDetailsModel, KeyingAmountModel, IncompleteTrackingModel, bulkOpsMistake, bulkOpsEffort, bulkOpsIncomplete) {
    if (bulkOpsMistake.length > 0) {
        try {
            await MistakeDetailsModel.bulkWrite(bulkOpsMistake, { ordered: false });
            loggerInfo.info(`[QC Debug] MistakeDetailsModel.bulkWrite successful: ${bulkOpsMistake.length} operations`);
        } catch (error) {
            loggerError.error('[QC Debug] Error in MistakeDetailsModel.bulkWrite:', {
                message: error.message,
                validationErrors: error.mongoose?.validationErrors
            });
            throw error;
        }
    }
    if (bulkOpsEffort.length > 0) {
        try {
            await KeyingAmountModel.bulkWrite(bulkOpsEffort, { ordered: false });
            loggerInfo.info(`[QC Debug] KeyingAmountModel.bulkWrite successful: ${bulkOpsEffort.length} operations`);
        } catch (error) {
            loggerError.error('[QC Debug] Error in KeyingAmountModel.bulkWrite:', error.message);
            throw error;
        }
    }
    if (bulkOpsIncomplete.length > 0) {
        try {
            await IncompleteTrackingModel.bulkWrite(bulkOpsIncomplete, { ordered: false });
            loggerInfo.info(`[QC Debug] IncompleteTrackingModel.bulkWrite successful: ${bulkOpsIncomplete.length} operations`);
        } catch (error) {
            loggerError.error('[QC Debug] Error in IncompleteTrackingModel.bulkWrite:', error.message);
            throw error;
        }
    }
}

/**
 * Khởi tạo cron job
 */
function initQCCronJob() {
    let isJobRunning = false; // Flag để tránh chồng chéo job

    try {
        cron.schedule('5 * * * *', () => {
            // Kiểm tra job đang chạy để tránh overlap
            if (isJobRunning) {
                loggerInfo.warn('[QC Cron Job] Job is already running, skipping this trigger');
                return;
            }

            isJobRunning = true;
            const startTime = new Date();
            loggerInfo.info(`[QC Cron Job] Starting QC data processing cron job at ${startTime.toISOString()}`);

            // Tạo timeout promise để tránh job chạy quá lâu
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Cron job timeout after 55 minutes'));
                }, 55 * 60 * 1000); // 55 phút timeout (nhỏ hơn interval 60 phút)
            });

            // Race giữa processQCData và timeout
            Promise.race([processQCData(), timeoutPromise])
                .then(() => {
                    const endTime = new Date();
                    const duration = endTime - startTime;
                    loggerInfo.info(`[QC Cron Job] QC data processing cron job completed in ${Math.round(duration / 1000)}s`);
                })
                .catch((error) => {
                    const endTime = new Date();
                    const duration = endTime - startTime;
                    loggerError.error(`[QC Cron Job] QC data processing cron job failed after ${Math.round(duration / 1000)}s:`, error);

                    // Log thêm thông tin để debug
                    loggerError.error(`[QC Cron Job] Error details:`, {
                        message: error.message,
                        stack: error.stack,
                        timestamp: endTime.toISOString(),
                        duration: duration
                    });
                })
                .finally(() => {
                    // Đảm bảo flag được reset dù có lỗi hay không
                    isJobRunning = false;

                    // Force garbage collection nếu có
                    if (global.gc) {
                        try {
                            global.gc();
                            loggerInfo.info('[QC Cron Job] Garbage collection executed');
                        } catch (gcError) {
                            loggerError.error('[QC Cron Job] Error during garbage collection execution:', gcError);
                        }
                    }
                });
        }, {
            scheduled: true
        });

        loggerInfo.info('[QC Cron Job] Initialized QC data processing cron job to run hourly with timezone Asia/Ho_Chi_Minh');

        // Chạy ngay một lần khi khởi động server với cùng logic
        loggerInfo.info('[QC Cron Job] Running first job on server startup');
        isJobRunning = true;
        const startTime = new Date();

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Initial cron job timeout after 55 minutes'));
            }, 55 * 60 * 1000);
        });

        Promise.race([processQCData(), timeoutPromise])
            .then(() => {
                const endTime = new Date();
                const duration = endTime - startTime;
                loggerInfo.info(`[QC Cron Job] Initial cron job completed in ${Math.round(duration / 1000)}s`);
            })
            .catch((error) => {
                const endTime = new Date();
                const duration = endTime - startTime;
                loggerError.error(`[QC Cron Job] Initial cron job failed after ${Math.round(duration / 1000)}s:`, error);
            })
            .finally(() => {
                isJobRunning = false;
                if (global.gc) {
                    try {
                        global.gc();
                        loggerInfo.info('[QC Cron Job] Initial garbage collection executed');
                    } catch (gcError) {
                        loggerError.error('[QC Cron Job] Error during initial garbage collection:', gcError);
                    }
                }
            });
    } catch (error) {
        loggerError.error('[QC Cron Job] Error initializing cron job:', error);
        // Reset flag nếu có lỗi khởi tạo
        isJobRunning = false;
        throw error; // Re-throw để caller biết có lỗi
    }
}

module.exports = {
    initQCCronJob,
    processQCData
};