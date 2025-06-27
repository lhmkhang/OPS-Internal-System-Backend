const cron = require('node-cron');
const path = require('path');
const mongoose = require('mongoose');
const logger = require('../helpers/logger');
const { getMistake, getQCAmountByStep } = require('../helpers/qualityControlServices');
const { getConnection } = require('../helpers/connectDB');
const { schema: ProjectsPlanSchema, collectionName: ProjectPlanCollectionName } = require('../models/ProjectsPlanModel');
const { schema: mistakeReportSchema, collectionName: mistakeReportCollectionName } = require('../models/reporting/mistakeReport.model');
const { schema: qcEffortSchema, collectionName: qcEffortCollectionName } = require('../models/reporting/qcEffort.model');
const { schema: IncompleteDocTrackingSchema, collectionName: IncompleteDocTrackingCollectionName } = require('../models/reporting/incompleteDocTracking.model');
const { schema: ProcessingCheckpointSchema, collectionName: ProcessingCheckpointCollectionName } = require('../models/reporting/processingCheckpoint.model');
const { getMistake: getMistakeLegacy, getQCAmount: getQCAmountLegacy } = require('../helpers/qualityControlServices-bk');

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
                node => node.source === 'queue_transform' &&
                    (node.hasOwnProperty('reason') &&
                        (node.reason === null || node.reason.comment === null || node.reason.comment === '')) &&
                    (node.keyer !== 'tkthang' && node.keyer !== 'auto service')
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

    // console.log('useLegacy: ', useLegacy);


    let allMistakes = [];
    let allQCEfforts = [];
    if (!useLegacy) {
        allMistakes = getMistake(fieldNotCount, doc, dataFiltered, projectId, doc.batch_id?.toString(), documentHistory, sectionMultiRow);
        allQCEfforts = getQCAmountByStep(doc, dataFiltered, projectId, doc.batch_id?.toString(), documentHistory, sectionMultiRow, fieldNotCount);
    } else {
        allMistakes = getMistakeLegacy(fieldNotCount, doc, dataFiltered, projectId, doc.batch_id?.toString()) || [];
        allMistakes = allMistakes.map(m => ({
            project_id: m.project_id || projectId,
            batch_id: m.batch_id || doc.batch_id,
            batch_name: m.batch_name || doc.batch_name || '',
            doc_id: m.doc_id || doc._id,
            doc_uri: m.doc_uri || (doc.doc_uri ? doc.doc_uri.join('|') : ''),
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
            // compared_at: m.compared_at || new Date(),
            imported_date: m.imported_date || doc.created_date || '',
            // exported_date: m.exported_date || doc.exported_date || '',
            // uploaded_date: m.uploaded_date || doc.delivery_date || ''
        }));

        allQCEfforts = getQCAmountLegacy(filterControl, fieldNotCount, doc, dataFiltered, projectId, doc.batch_id?.toString()) || [];
        allQCEfforts = allQCEfforts.map(e => ({
            project_id: e.project_id || projectId,
            batch_id: e.batch_id || doc.batch_id,
            batch_name: e.batch_name || doc.batch_name || '',
            doc_id: e.doc_id || doc._id,
            user_name_keyer: e.user_name_keyer || '',
            task_keyer_name: e.task_keyer_name || '',
            layout_name: e.layout_name || doc.layout_name || '',
            total_field: e.total_field || 0,
            total_character: e.total_character || 0,
            total_records: e.total_records || 0,
            total_lines: e.total_lines || 0,
            is_qc: typeof e.is_qc === 'boolean' ? e.is_qc : false,
            captured_keyer_at: e.captured_keyer_at || '',
            // compared_at: e.compared_at || new Date(),
            imported_date: e.imported_date || doc.created_date || '',
            // exported_date: e.exported_date || doc.exported_date || '',
            // uploaded_date: e.uploaded_date || doc.delivery_date || ''
        }));
    }
    // Mapping allMistakes thành array mistake_details (field-level)
    const mistake_details = (allMistakes || []).map(m => ({
        task_keyer_name: m.task_keyer_name || '',
        task_final_name: m.task_final_name || '',
        section: m.section_keyer || m.section_final || m.section || '',
        record_idx: m.record_idx || '',
        line_idx: m.line_idx || '',
        field_name: m.field_name || '',
        user_name_keyer: m.user_name_keyer || '',
        user_name_final: m.user_name_final || '',
        value_keyer: m.value_keyer || '',
        value_final: m.value_final || '',
        captured_keyer_at: m.captured_keyer_at || '',
        captured_final_at: m.captured_final_at || '',
        layout_name: m.layout_name || doc.layout_name || '',
        error_type: m.error_type || null
    }));
    // Upsert 1 document/report cho mỗi doc_id
    const bulkOpsMistake = [];
    if (mistake_details.length > 0) {
        bulkOpsMistake.push({
            updateOne: {
                filter: { doc_id: doc._id },
                update: {
                    $set: {
                        project_id: projectId,
                        batch_id: doc.batch_id,
                        doc_id: doc._id,
                        batch_name: doc.batch_name || '',
                        imported_date: doc.created_date || null,
                        exported_date: doc.exported_date || null,
                        uploaded_date: doc.delivery_date || null,
                        s2_url: doc.s2_url ? doc.s2_url.join('|') : '',
                        doc_uri: doc.doc_uri ? doc.doc_uri.join('|') : ''
                    },
                    $addToSet: { mistake_details: { $each: mistake_details } }
                },
                upsert: true
            }
        });
    }
    // QCEffort giữ nguyên logic cũ
    const newQCEfforts = allQCEfforts.filter(effort => !completedSteps.includes(effort.task_keyer_name));
    let newCompletedSteps = [...completedSteps];
    const bulkOpsEffort = [];
    if (newQCEfforts.length > 0) {
        newQCEfforts.forEach(effort => {
            bulkOpsEffort.push({
                insertOne: {
                    document: effort
                }
            });
        });
        newCompletedSteps = [...new Set([...newCompletedSteps, ...newQCEfforts.map(e => e.task_keyer_name)])];
    }
    return {
        bulkOpsMistake,
        bulkOpsEffort,
        insertedMistake: mistake_details.length,
        insertedEffort: newQCEfforts.length,
        newCompletedSteps,
        processed: mistake_details.length > 0 || newQCEfforts.length > 0
    };
}

/**
 * Chuẩn bị thao tác bulkWrite cho document đã hoàn thành
 */
async function handleDocumentComplete(args) {
    const { doc, projectId, fieldNotCount, filterControl, sectionMultiRow, DocumentHistoryModel } = args;
    const bulkOpsIncomplete = [];
    bulkOpsIncomplete.push({
        deleteOne: { filter: { project_id: projectId, doc_id: doc._id } }
    });
    const { bulkOpsMistake, bulkOpsEffort, insertedMistake, insertedEffort, newCompletedSteps, processed } = await prepareDocumentSteps({
        doc, projectId, fieldNotCount, filterControl, sectionMultiRow, DocumentHistoryModel
    });
    return { bulkOpsIncomplete, bulkOpsMistake, bulkOpsEffort, insertedMistake, insertedEffort, newCompletedSteps, processed };
}

/**
 * Chuẩn bị thao tác bulkWrite cho document chưa hoàn thành
 */
async function handleDocumentIncomplete(args) {
    const { doc, projectId } = args;
    const bulkOpsIncomplete = [];

    // Document chưa hoàn thành (status < 450) thì chỉ cập nhật tracking, không tạo mistake/QC effort
    bulkOpsIncomplete.push({
        updateOne: {
            filter: { project_id: projectId, doc_id: doc._id },
            update: {
                $set: {
                    project_id: projectId,
                    doc_id: doc._id,
                    batch_id: doc.batch_id,
                    status: doc.status,
                    last_processed_at: new Date(),
                    imported_date: doc.created_date
                }
            },
            upsert: true
        }
    });

    // Trả về với 0 mistake và QC effort vì document chưa hoàn thành
    return {
        bulkOpsIncomplete,
        bulkOpsMistake: [],
        bulkOpsEffort: [],
        insertedMistake: 0,
        insertedEffort: 0,
        newCompletedSteps: [],
        processed: false
    };
}

/**
 * Hàm chính để xử lý QC data
 */
async function processQCData() {
    const processStartTime = new Date();
    loggerInfo.info(`[QC Cron Job] Bắt đầu xử lý QC data lúc ${processStartTime.toISOString()}...`);

    let defaultConnection = null;
    let primaryConnection = null;

    try {
        // Kiểm tra kết nối trước khi bắt đầu
        defaultConnection = getConnection('default');
        primaryConnection = getConnection('primary');

        if (!defaultConnection || defaultConnection.readyState !== 1) {
            throw new Error('Kết nối default database không khả dụng');
        }
        if (!primaryConnection || primaryConnection.readyState !== 1) {
            throw new Error('Kết nối primary database không khả dụng');
        }

        loggerInfo.info('[QC Cron Job] Xác nhận kết nối database thành công');

        // Models
        const MistakeReportModel = mongoose.models[mistakeReportCollectionName] || defaultConnection.model(mistakeReportCollectionName, mistakeReportSchema);
        const QCEffortModel = mongoose.models[qcEffortCollectionName] || defaultConnection.model(qcEffortCollectionName, qcEffortSchema);
        const ProjectPlanModel = mongoose.models[ProjectPlanCollectionName] || defaultConnection.model(ProjectPlanCollectionName, ProjectsPlanSchema);
        const IncompleteTrackingModel = mongoose.models[IncompleteDocTrackingCollectionName] || defaultConnection.model(IncompleteDocTrackingCollectionName, IncompleteDocTrackingSchema);
        const CheckpointModel = mongoose.models[ProcessingCheckpointCollectionName] || defaultConnection.model(ProcessingCheckpointCollectionName, ProcessingCheckpointSchema);
        const DocumentHistorySchema = new mongoose.Schema({}, { strict: false, collection: 'document_history' });
        let DocumentHistoryModel = primaryConnection.models['document_history'] || primaryConnection.model('document_history', DocumentHistorySchema);

        // Lấy danh sách dự án
        const projects = await ProjectPlanModel.find({}, { _id: 1, projectName: 1 }).lean();
        loggerInfo.info(`[QC Cron Job] Tìm thấy ${projects.length} dự án để xử lý QC data`);

        let totalProcessedDocs = 0, totalMistakes = 0, totalQCEfforts = 0;
        const filterControl = 'both';
        const BATCH_SIZE = 1000; // Kích thước batch để xử lý document

        for (const project of projects) {
            // const batchModelName = `${project._id.toString()}_batch`;
            const documentModelName = `${project._id.toString()}_document`;
            const fieldValueDefModelName = 'field_value_definitions';
            const sectionDefModelName = 'section_definitions';

            // const BatchSchema = new mongoose.Schema({}, { strict: false, collection: batchModelName });
            const DocumentSchema = new mongoose.Schema({}, { strict: false, collection: documentModelName });
            const FieldValueDefSchema = new mongoose.Schema({}, { strict: false, collection: fieldValueDefModelName });
            const SectionDefSchema = new mongoose.Schema({}, { strict: false, collection: sectionDefModelName });

            // let BatchModel = primaryConnection.models[batchModelName] || primaryConnection.model(batchModelName, BatchSchema);
            let DocumentModel = primaryConnection.models[documentModelName] || primaryConnection.model(documentModelName, DocumentSchema);
            let FieldValueDefModel = primaryConnection.models[fieldValueDefModelName] || primaryConnection.model(fieldValueDefModelName, FieldValueDefSchema);
            let SectionDefModel = primaryConnection.models[sectionDefModelName] || primaryConnection.model(sectionDefModelName, SectionDefSchema);

            const fieldsNotCounted = await FieldValueDefModel.find(
                { counted_character: false, project_id: project._id },
                { name: 1, _id: 0 }
            ).lean();
            const fieldNotCount = fieldsNotCounted.map(field => field.name);

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
            if (checkpoint.last_doc_id) {
                projectBulkOps.push({
                    deleteMany: {
                        filter: { project_id: project._id, doc_id: { $gt: checkpoint.last_doc_id } }
                    }
                });
                await MistakeReportModel.bulkWrite(projectBulkOps);
                await QCEffortModel.bulkWrite(projectBulkOps);
                loggerInfo.info(`[QC Cron Job] Đã xóa các report có doc_id > checkpoint (${checkpoint.last_doc_id})`);
            }

            const query = {};
            if (checkpoint.last_doc_id) query._id = { $gt: checkpoint.last_doc_id };

            loggerInfo.info(`[QC Cron Job] Đang xử lý dự án: ${project.projectName || 'Không có tên'} (${project._id})`);
            loggerInfo.info(`[QC Cron Job] Sử dụng điều kiện query: ${JSON.stringify(query)}`);

            // Lấy documents mới
            // const documents = await DocumentModel.find(query).sort({ _id: 1 }).lean();
            // const documents = await DocumentModel.find({ _id: new mongoose.Types.ObjectId("680b7b3945d331001bbdaf79") }).sort({ _id: 1 }).lean();
            // loggerInfo.info(`[QC Cron Job] Tìm thấy ${documents.length} document mới cho dự án ${project.projectName}`);

            // Document chưa hoàn thành từ lần trước
            const incompleteDocs = await IncompleteTrackingModel.find({ project_id: project._id }).lean();
            // const incompleteDocsMap = new Map(incompleteDocs.map(doc => [doc.doc_id.toString(), doc.completed_steps || []]));
            loggerInfo.info(`[QC Cron Job] Tìm thấy ${incompleteDocs.length} document chưa hoàn thành từ lần chạy trước`);

            let lastDocId = null;
            let batchDocs = [];
            let batchBulkOpsIncomplete = [];
            let batchBulkOpsMistake = [];
            let batchBulkOpsEffort = [];

            const cursor = DocumentModel.find(query).sort({ _id: 1 }).lean().cursor();
            // const cursor = DocumentModel.find({ _id: new mongoose.Types.ObjectId("682c7f0dd7210c001f8c83aa") }).sort({ _id: 1 }).lean().cursor();
            for await (const doc of cursor) {
                lastDocId = doc._id;
                // const completedSteps = incompleteDocsMap.get(doc._id.toString()) || [];

                let result;
                if (doc.status >= 450) {
                    result = await handleDocumentComplete({ doc, projectId: project._id, fieldNotCount, filterControl, sectionMultiRow, DocumentHistoryModel });
                    loggerInfo.info(`[QC Cron Job] Document ${doc._id} (đã hoàn thành): Thêm ${result.insertedMistake} mistake, ${result.insertedEffort} QC effort`);
                } else {
                    result = await handleDocumentIncomplete({ doc, projectId: project._id });
                    loggerInfo.info(`[QC Cron Job] Document ${doc._id} (chưa hoàn thành): Thêm ${result.insertedMistake} mistake, ${result.insertedEffort} QC effort`);
                }
                batchBulkOpsIncomplete.push(...result.bulkOpsIncomplete);
                batchBulkOpsMistake.push(...result.bulkOpsMistake);
                batchBulkOpsEffort.push(...result.bulkOpsEffort);

                if (result.processed) totalProcessedDocs++;
                totalMistakes += result.insertedMistake;
                totalQCEfforts += result.insertedEffort;

                batchDocs.push(doc);
                if (batchDocs.length === BATCH_SIZE) {
                    if (batchBulkOpsMistake.length > 0) {
                        await MistakeReportModel.bulkWrite(batchBulkOpsMistake, { ordered: false });
                    }
                    if (batchBulkOpsEffort.length > 0) {
                        await QCEffortModel.bulkWrite(batchBulkOpsEffort, { ordered: false });
                    }
                    if (batchBulkOpsIncomplete.length > 0) {
                        await IncompleteTrackingModel.bulkWrite(batchBulkOpsIncomplete, { ordered: false });
                    }
                    // Reset batch
                    batchDocs = [];
                    batchBulkOpsIncomplete = [];
                    batchBulkOpsMistake = [];
                    batchBulkOpsEffort = [];
                }
            }

            // Xử lý batch cuối nếu còn lại
            if (batchDocs.length > 0) {
                if (batchBulkOpsIncomplete.length > 0) {
                    await IncompleteTrackingModel.bulkWrite(batchBulkOpsIncomplete, { ordered: false });
                }
                if (batchBulkOpsMistake.length > 0) {
                    await MistakeReportModel.bulkWrite(batchBulkOpsMistake, { ordered: false });
                }
                if (batchBulkOpsEffort.length > 0) {
                    await QCEffortModel.bulkWrite(batchBulkOpsEffort, { ordered: false });
                }
            }

            loggerInfo.info(`[QC Cron Job] Đã xử lý xong các document mới. Bắt đầu kiểm tra lại các document chưa hoàn thành từ lần chạy trước...`);

            // Xử lý lại incomplete theo batch
            for (let i = 0; i < incompleteDocs.length; i += BATCH_SIZE) {
                const batchIncompleteDocs = incompleteDocs.slice(i, i + BATCH_SIZE);
                const batchBulkOpsIncomplete = [];
                const batchBulkOpsMistake = [];
                const batchBulkOpsEffort = [];

                for (const incompleteDoc of batchIncompleteDocs) {
                    if (!lastDocId || incompleteDoc.doc_id.toString() !== lastDocId.toString()) {
                        try {
                            const currentDoc = await DocumentModel.findOne({ _id: incompleteDoc.doc_id }).lean();
                            if (!currentDoc) {
                                batchBulkOpsIncomplete.push({
                                    deleteOne: {
                                        filter: { _id: incompleteDoc._id }
                                    }
                                });
                                loggerInfo.info(`[QC Cron Job] Document ${incompleteDoc.doc_id} không còn tồn tại, đã xóa khỏi tracking`);
                                continue;
                            }
                            // const completedSteps = incompleteDoc.completed_steps || [];
                            let result;
                            if (currentDoc.status >= 450) {
                                result = await handleDocumentComplete({ doc: currentDoc, projectId: project._id, fieldNotCount, filterControl, sectionMultiRow, DocumentHistoryModel });
                                loggerInfo.info(`[QC Cron Job] Document ${currentDoc._id} (đã chuyển sang hoàn thành): Thêm ${result.insertedMistake} mistake, ${result.insertedEffort} QC effort`);
                            } else {
                                result = await handleDocumentIncomplete({ doc: currentDoc, projectId: project._id });
                                loggerInfo.info(`[QC Cron Job] Document ${currentDoc._id} (vẫn chưa hoàn thành): Thêm ${result.insertedMistake} mistake, ${result.insertedEffort} QC effort`);
                            }
                            batchBulkOpsIncomplete.push(...result.bulkOpsIncomplete);
                            batchBulkOpsMistake.push(...result.bulkOpsMistake);
                            batchBulkOpsEffort.push(...result.bulkOpsEffort);
                            if (result.processed) totalProcessedDocs++;
                            totalMistakes += result.insertedMistake;
                            totalQCEfforts += result.insertedEffort;
                        } catch (incompleteDocError) {
                            loggerError.error(`[QC Cron Job] Lỗi khi xử lý lại document chưa hoàn thành ${incompleteDoc.doc_id}:`, incompleteDocError);
                        }
                    }
                }

                // Thực hiện bulkWrite cho batch
                if (batchBulkOpsIncomplete.length > 0) {
                    await IncompleteTrackingModel.bulkWrite(batchBulkOpsIncomplete, { ordered: false });
                }
                if (batchBulkOpsMistake.length > 0) {
                    await MistakeReportModel.bulkWrite(batchBulkOpsMistake, { ordered: false });
                }
                if (batchBulkOpsEffort.length > 0) {
                    await QCEffortModel.bulkWrite(batchBulkOpsEffort, { ordered: false });
                }
            }

            // Cập nhật checkpoint
            if (lastDocId) {
                projectBulkOps.push({
                    updateOne: {
                        filter: { project_id: project._id },
                        update: {
                            $set: {
                                last_doc_id: lastDocId,
                                last_run_at: new Date()
                            }
                        }
                    }
                });
                await CheckpointModel.bulkWrite(projectBulkOps, { ordered: false });
                loggerInfo.info(`[QC Cron Job] Đã cập nhật checkpoint cho dự án ${project.projectName} với last_doc_id: ${lastDocId}`);
            }
        }

        const processEndTime = new Date();
        const totalDuration = processEndTime - processStartTime;
        loggerInfo.info(`[QC Cron Job] Hoàn thành xử lý QC data: ${totalProcessedDocs} documents, ${totalMistakes} mistakes, ${totalQCEfforts} QC efforts trong ${Math.round(totalDuration / 1000)}s`);
    } catch (error) {
        const processEndTime = new Date();
        const totalDuration = processEndTime - processStartTime;
        loggerError.error(`[QC Cron Job] Lỗi khi xử lý QC data sau ${Math.round(totalDuration / 1000)}s:`, {
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

        loggerInfo.info('[QC Cron Job] Kết thúc processQCData function');
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
                loggerInfo.warn('[QC Cron Job] Job đang chạy, bỏ qua lần trigger này');
                return;
            }

            isJobRunning = true;
            const startTime = new Date();
            loggerInfo.info(`[QC Cron Job] Bắt đầu cron job xử lý QC data lúc ${startTime.toISOString()}`);

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
                    loggerInfo.info(`[QC Cron Job] Cron job xử lý QC data hoàn thành sau ${Math.round(duration / 1000)}s`);
                })
                .catch((error) => {
                    const endTime = new Date();
                    const duration = endTime - startTime;
                    loggerError.error(`[QC Cron Job] Cron job xử lý QC data thất bại sau ${Math.round(duration / 1000)}s:`, error);

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
                            loggerInfo.info('[QC Cron Job] Garbage collection đã chạy');
                        } catch (gcError) {
                            loggerError.error('[QC Cron Job] Lỗi khi chạy garbage collection:', gcError);
                        }
                    }
                });
        }, {
            scheduled: true
        });

        loggerInfo.info('[QC Cron Job] Đã khởi tạo cron job xử lý QC data mỗi 1 giờ với timezone Asia/Ho_Chi_Minh');

        // Chạy ngay một lần khi khởi động server với cùng logic
        loggerInfo.info('[QC Cron Job] Chạy job đầu tiên khi khởi động server');
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
                loggerInfo.info(`[QC Cron Job] Initial cron job hoàn thành sau ${Math.round(duration / 1000)}s`);
            })
            .catch((error) => {
                const endTime = new Date();
                const duration = endTime - startTime;
                loggerError.error(`[QC Cron Job] Initial cron job thất bại sau ${Math.round(duration / 1000)}s:`, error);
            })
            .finally(() => {
                isJobRunning = false;
                if (global.gc) {
                    try {
                        global.gc();
                        loggerInfo.info('[QC Cron Job] Initial garbage collection đã chạy');
                    } catch (gcError) {
                        loggerError.error('[QC Cron Job] Lỗi initial garbage collection:', gcError);
                    }
                }
            });
    } catch (error) {
        loggerError.error('[QC Cron Job] Lỗi khi khởi tạo cron job:', error);
        // Reset flag nếu có lỗi khởi tạo
        isJobRunning = false;
        throw error; // Re-throw để caller biết có lỗi
    }
}

module.exports = {
    initQCCronJob,
    processQCData
};