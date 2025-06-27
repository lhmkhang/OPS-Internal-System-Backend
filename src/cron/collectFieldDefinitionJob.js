const cron = require('node-cron');
const path = require('path');
const mongoose = require('mongoose');
const logger = require('../helpers/logger');
const { getConnection } = require('../helpers/connectDB');
const { schema: ProjectsPlanSchema, collectionName: ProjectPlanCollectionName } = require('../models/ProjectsPlanModel');
const {
    schema: projectFieldConfigurationSchema,
    collectionName: projectFieldConfigurationCollectionName,
    checkpointSchema: CheckpointSchema,
    checkpointCollectionName: CheckpointCollectionName
} = require('../models/reporting/fieldDefinitionCollection.model');

const loggerInfo = logger.getLogger("infoLogger");
const loggerError = logger.getLogger("errorLogger");

// Đường dẫn đến file .env
require('dotenv').config({ path: path.resolve(__dirname, "../..", ".env") });

/**
 * Lấy checkpoint - version cuối cùng đã xử lý cho từng project
 */
async function getCheckpointsByProject(defaultConnection, projectIds) {
    try {
        const CheckpointModel = defaultConnection.models[CheckpointCollectionName] ||
            defaultConnection.model(CheckpointCollectionName, CheckpointSchema);

        // Kiểm tra xem project_field_configuration collection có dữ liệu không
        const ProjectFieldConfigurationModel = defaultConnection.models[projectFieldConfigurationCollectionName] ||
            defaultConnection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

        const configCount = await ProjectFieldConfigurationModel.countDocuments();

        if (configCount === 0) {
            // Nếu collection rỗng, xóa tất cả checkpoint và bắt đầu từ đầu
            await CheckpointModel.deleteMany({});
            loggerInfo.info('[Collect Field Definition] Project field configuration collection is empty, reset all checkpoints');
            return new Map(); // Trả về Map rỗng
        }

        // Lấy checkpoint cho tất cả project
        const checkpoints = await CheckpointModel.find({
            project_id: { $in: projectIds }
        }).lean();

        // Convert thành Map để dễ lookup
        const checkpointMap = new Map();
        checkpoints.forEach(cp => {
            checkpointMap.set(cp.project_id.toString(), {
                lastProcessedVersion: cp.last_processed_version || 0,
                lastFieldCount: cp.last_field_count || 0
            });
        });

        loggerInfo.info(`[Collect Field Definition] Found checkpoints for ${checkpoints.length}/${projectIds.length} projects`);
        return checkpointMap;
    } catch (error) {
        loggerError.error('[Collect Field Definition] Error getting checkpoints:', error);
        return new Map();
    }
}

/**
 * Cập nhật checkpoint theo project với version cuối cùng đã xử lý
 */
async function updateCheckpointsByProject(defaultConnection, projectCheckpoints) {
    try {
        const CheckpointModel = defaultConnection.models[CheckpointCollectionName] ||
            defaultConnection.model(CheckpointCollectionName, CheckpointSchema);

        if (projectCheckpoints.size === 0) {
            loggerInfo.info('[Collect Field Definition] No checkpoints to update');
            return;
        }

        // Tạo bulk operations để update checkpoint cho từng project
        const bulkOps = [];
        for (const [projectId, checkpointData] of projectCheckpoints) {
            bulkOps.push({
                updateOne: {
                    filter: { project_id: new mongoose.Types.ObjectId(projectId) },
                    update: {
                        $set: {
                            project_id: new mongoose.Types.ObjectId(projectId),
                            last_processed_version: checkpointData.version,
                            last_field_count: checkpointData.fieldCount,
                            last_run_at: new Date()
                        }
                    },
                    upsert: true
                }
            });
        }

        if (bulkOps.length > 0) {
            await CheckpointModel.bulkWrite(bulkOps, { ordered: false });
            loggerInfo.info(`[Collect Field Definition] Updated checkpoints for ${bulkOps.length} projects`);
        }
    } catch (error) {
        loggerError.error('[Collect Field Definition] Error updating checkpoints:', error);
        throw error;
    }
}

/**
 * Lấy tất cả field của project từ field_value_definitions và tìm context
 */
async function getProjectFieldsWithContext(primaryConnection, defaultConnection, projectId) {
    try {
        const FieldValueDefinitionSchema = new mongoose.Schema({}, { strict: false, collection: 'field_value_definitions' });
        const FieldModel = primaryConnection.models['field_value_definitions'] ||
            primaryConnection.model('field_value_definitions', FieldValueDefinitionSchema);

        const SectionDefinitionSchema = new mongoose.Schema({}, { strict: false, collection: 'section_definitions' });
        const LayoutDefinitionSchema = new mongoose.Schema({}, { strict: false, collection: 'layout_definitions' });

        const SectionModel = primaryConnection.models['section_definitions'] ||
            primaryConnection.model('section_definitions', SectionDefinitionSchema);
        const LayoutModel = primaryConnection.models['layout_definitions'] ||
            primaryConnection.model('layout_definitions', LayoutDefinitionSchema);

        // Lấy tất cả field của project từ field_value_definitions
        const projectFields = await FieldModel.find(
            { project_id: projectId },
            { _id: 1, name: 1, field_display: 1, project_id: 1 }
        ).lean();

        if (projectFields.length === 0) {
            return [];
        }

        loggerInfo.info(`[Collect Field Definition] Project ${projectId}: Found ${projectFields.length} fields in field_value_definitions`);

        // Tìm context cho tất cả fields
        const fieldsWithContext = [];

        for (const field of projectFields) {
            try {
                // Tìm section chứa field_id này
                const section = await SectionModel.findOne({
                    'fields.field_id': new mongoose.Types.ObjectId(field._id)
                }, { _id: 1, name: 1, layout_id: 1, project_id: 1 }).lean();

                if (!section) {
                    continue; // Field không được sử dụng trong section nào
                }

                // Tìm layout từ section
                const layout = await LayoutModel.findOne({
                    _id: section.layout_id,
                    type: { $ne: 'non_capture' } // Chỉ lấy layout không phải non_capture
                }, { _id: 1, name: 1, type: 1 }).lean();

                if (!layout) {
                    continue; // Layout là non_capture hoặc không tồn tại
                }

                // Thêm field với context vào kết quả
                fieldsWithContext.push({
                    field_id: field._id,
                    field_name: field.name || '',
                    field_display: field.field_display || '',
                    layout_id: layout._id,
                    layout_name: layout.name || '',
                    layout_type: layout.type || '',
                    section_id: section._id,
                    section_name: section.name || '',
                    critical_field: "Critical", // Default value
                    is_report_count: true // Default value
                });

            } catch (fieldError) {
                loggerError.error(`[Collect Field Definition] Error processing field ${field._id}:`, fieldError);
                continue;
            }
        }

        loggerInfo.info(`[Collect Field Definition] Project ${projectId}: Found ${fieldsWithContext.length} fields with valid context`);
        return fieldsWithContext;
    } catch (error) {
        loggerError.error(`[Collect Field Definition] Error getting fields for project ${projectId}:`, error);
        throw error;
    }
}

/**
 * Lấy project name từ project_id
 */
async function getProjectName(defaultConnection, projectId) {
    try {
        const ProjectPlanModel = defaultConnection.models[ProjectPlanCollectionName] ||
            defaultConnection.model(ProjectPlanCollectionName, ProjectsPlanSchema);

        const project = await ProjectPlanModel.findById(projectId, { projectName: 1 }).lean();
        return project ? project.projectName || '' : '';
    } catch (error) {
        loggerError.error(`[Collect Field Definition] Error getting project name for ${projectId}:`, error);
        return '';
    }
}

/**
 * Đảm bảo schema và indexes đúng
 */
async function ensureSchemaAndIndexes(defaultConnection) {
    try {
        const ProjectFieldConfigurationModel = defaultConnection.models[projectFieldConfigurationCollectionName] ||
            defaultConnection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

        // Đảm bảo indexes được tạo
        await ProjectFieldConfigurationModel.ensureIndexes();
        loggerInfo.info('[Collect Field Definition] Schema and indexes ensured for project-centric configuration');

        return ProjectFieldConfigurationModel;
    } catch (error) {
        loggerError.error('[Collect Field Definition] Error ensuring schema and indexes:', error);
        throw error;
    }
}

/**
 * Xử lý và cập nhật field configuration cho project với VERSION CONTROL PATTERN
 */
async function processProjectFields(defaultConnection, primaryConnection, projectId, checkpointData) {
    let session;
    try {
        // Đảm bảo schema và indexes đúng
        const ProjectFieldConfigurationModel = await ensureSchemaAndIndexes(defaultConnection);

        // Lấy tất cả fields của project với context
        const fieldsWithContext = await getProjectFieldsWithContext(primaryConnection, defaultConnection, projectId);

        if (fieldsWithContext.length === 0) {
            loggerInfo.info(`[Collect Field Definition] Project ${projectId}: No fields with valid context found, skipping`);
            return { processed: 0, fieldsCount: 0, isUpdated: false };
        }

        // Lấy project name
        const projectName = await getProjectName(defaultConnection, projectId);

        // Bắt đầu session/transaction để đảm bảo consistency
        session = await defaultConnection.startSession();
        session.startTransaction();

        // Kiểm tra xem có thay đổi gì không - Query với isActive filter
        const existingConfig = await ProjectFieldConfigurationModel.findOne(
            {
                project_id: projectId,
                isActive: true  // Chỉ lấy version active
            },
            { version: 1, fields: 1 }
        ).session(session).lean();

        let needsUpdate = false;
        let newVersion = 1;

        if (existingConfig) {
            newVersion = existingConfig.version + 1;

            // So sánh số lượng fields
            if (existingConfig.fields.length !== fieldsWithContext.length) {
                needsUpdate = true;
                loggerInfo.info(`[Collect Field Definition] Project ${projectId}: Field count changed from ${existingConfig.fields.length} to ${fieldsWithContext.length}`);
            } else {
                // So sánh field_id để xem có field mới/bị xóa không
                const existingFieldIds = new Set(existingConfig.fields.map(f => f.field_id.toString()));
                const newFieldIds = new Set(fieldsWithContext.map(f => f.field_id.toString()));

                const addedFields = [...newFieldIds].filter(id => !existingFieldIds.has(id));
                const removedFields = [...existingFieldIds].filter(id => !newFieldIds.has(id));

                if (addedFields.length > 0 || removedFields.length > 0) {
                    needsUpdate = true;
                    loggerInfo.info(`[Collect Field Definition] Project ${projectId}: Field changes detected - added: ${addedFields.length}, removed: ${removedFields.length}`);
                }
            }
        } else {
            needsUpdate = true;
            loggerInfo.info(`[Collect Field Definition] Project ${projectId}: New project configuration`);
        }

        if (!needsUpdate) {
            // Không có thay đổi - commit session và return
            await session.commitTransaction();
            loggerInfo.info(`[Collect Field Definition] Project ${projectId}: No changes detected, skipping update`);
            return { processed: 1, fieldsCount: fieldsWithContext.length, isUpdated: false };
        }

        // Nếu có config cũ, preserve các thay đổi manual của user (critical_field, is_report_count)
        if (existingConfig && existingConfig.fields) {
            const existingFieldsMap = new Map();
            existingConfig.fields.forEach(field => {
                existingFieldsMap.set(field.field_id.toString(), {
                    critical_field: field.critical_field,
                    is_report_count: field.is_report_count
                });
            });

            // Merge với data mới, preserve manual changes
            fieldsWithContext.forEach(newField => {
                const existingField = existingFieldsMap.get(newField.field_id.toString());
                if (existingField) {
                    newField.critical_field = existingField.critical_field;
                    newField.is_report_count = existingField.is_report_count;
                }
            });
        }

        // VERSION CONTROL: Tạo document mới với version tăng lên
        const newConfigData = {
            project_id: projectId,
            project_name: projectName,
            version: newVersion,
            isActive: true,  // Document mới luôn active
            fields: fieldsWithContext,
            last_synced_at: new Date(),
            created_at: new Date(),
            updated_at: new Date()
        };

        // 1. Tạo document mới với version tăng lên
        await ProjectFieldConfigurationModel.create([newConfigData], { session });
        loggerInfo.info(`[Collect Field Definition] Project ${projectId}: Created new version ${newVersion}`);

        // 2. Mark document hiện tại (version cũ) thành inactive
        if (existingConfig) {
            await ProjectFieldConfigurationModel.updateOne(
                { _id: existingConfig._id },
                { $set: { isActive: false } }
            ).session(session);
            loggerInfo.info(`[Collect Field Definition] Project ${projectId}: Marked version ${existingConfig.version} as inactive`);
        }

        // Commit transaction
        await session.commitTransaction();
        loggerInfo.info(`[Collect Field Definition] Project ${projectId}: Successfully updated with ${fieldsWithContext.length} fields, new version ${newVersion}`);

        return {
            processed: 1,
            fieldsCount: fieldsWithContext.length,
            isUpdated: true,
            version: newVersion
        };

    } catch (error) {
        if (session) {
            try {
                await session.abortTransaction();
                loggerInfo.info(`[Collect Field Definition] Project ${projectId}: Transaction aborted due to error`);
            } catch (abortError) {
                loggerError.error(`[Collect Field Definition] Project ${projectId}: Error aborting transaction:`, abortError);
            }
        }
        loggerError.error(`[Collect Field Definition] Error processing project ${projectId}:`, error);
        throw error;
    } finally {
        if (session) {
            try {
                await session.endSession();
            } catch (endError) {
                loggerError.error(`[Collect Field Definition] Project ${projectId}: Error ending session:`, endError);
            }
        }
    }
}

/**
 * Hàm chính để collect field definitions theo project-centric approach
 */
async function collectFieldDefinitions() {
    const processStartTime = new Date();
    loggerInfo.info(`[Collect Field Definition] Starting PROJECT-CENTRIC field definition collection at ${processStartTime.toISOString()}...`);

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

        loggerInfo.info('[Collect Field Definition] Database connections successfully confirmed');

        // Đảm bảo schema và indexes đúng trước khi xử lý
        await ensureSchemaAndIndexes(defaultConnection);

        // Lấy danh sách project
        const ProjectPlanModel = defaultConnection.models[ProjectPlanCollectionName] ||
            defaultConnection.model(ProjectPlanCollectionName, ProjectsPlanSchema);
        const projects = await ProjectPlanModel.find({}, { _id: 1 }).lean();
        const projectIds = projects.map(p => p._id);

        if (projectIds.length === 0) {
            loggerInfo.info('[Collect Field Definition] No projects found to process');
            return;
        }

        // Lấy checkpoint theo project
        const checkpointMap = await getCheckpointsByProject(defaultConnection, projectIds);

        loggerInfo.info(`[Collect Field Definition] Starting processing for ${projects.length} projects`);

        let totalProcessed = 0;
        let totalFieldsCount = 0;
        let totalUpdated = 0;
        const projectCheckpoints = new Map();

        // Xử lý từng project
        for (const project of projects) {
            const projectId = project._id;
            const projectIdStr = projectId.toString();
            const checkpointData = checkpointMap.get(projectIdStr) || { lastProcessedVersion: 0, lastFieldCount: 0 };

            try {
                loggerInfo.info(`[Collect Field Definition] Processing project ${projectIdStr} (last version: ${checkpointData.lastProcessedVersion}, last count: ${checkpointData.lastFieldCount})`);

                const result = await processProjectFields(defaultConnection, primaryConnection, projectId, checkpointData);

                totalProcessed += result.processed;
                totalFieldsCount += result.fieldsCount;
                if (result.isUpdated) {
                    totalUpdated++;
                }

                // Cập nhật checkpoint
                if (result.processed > 0) {
                    projectCheckpoints.set(projectIdStr, {
                        version: result.version || checkpointData.lastProcessedVersion,
                        fieldCount: result.fieldsCount
                    });
                }

            } catch (projectError) {
                loggerError.error(`[Collect Field Definition] Error processing project ${projectIdStr}:`, projectError);
                continue; // Continue với project tiếp theo
            }
        }

        // Cập nhật checkpoints
        if (projectCheckpoints.size > 0) {
            await updateCheckpointsByProject(defaultConnection, projectCheckpoints);
        }

        const processEndTime = new Date();
        const totalDuration = processEndTime - processStartTime;
        loggerInfo.info(`[Collect Field Definition] Completed PROJECT-CENTRIC field definition collection: processed=${totalProcessed}, updated=${totalUpdated}, total_fields=${totalFieldsCount} in ${Math.round(totalDuration / 1000)}s`);

    } catch (error) {
        const processEndTime = new Date();
        const totalDuration = processEndTime - processStartTime;
        loggerError.error(`[Collect Field Definition] Error in PROJECT-CENTRIC collection after ${Math.round(totalDuration / 1000)}s:`, {
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
            loggerInfo.info('[Collect Field Definition] Memory usage:', {
                heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
                external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
                rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`
            });
        }

        loggerInfo.info('[Collect Field Definition] Finished PROJECT-CENTRIC collectFieldDefinitions function');
    }
}

/**
 * Khởi tạo cron job
 */
function initCollectFieldDefinitionJob() {
    let isJobRunning = false; // Flag để tránh chồng chéo job

    try {
        // Chạy mỗi 4 giờ vào phút thứ 15 (0:15, 4:15, 8:15, 12:15, 16:15, 20:15)
        cron.schedule('15 */4 * * *', () => {
            // Kiểm tra job đang chạy để tránh overlap
            if (isJobRunning) {
                loggerInfo.warn('[Collect Field Definition] Job is already running, skipping this trigger');
                return;
            }

            isJobRunning = true;
            const startTime = new Date();
            loggerInfo.info(`[Collect Field Definition] Starting PROJECT-CENTRIC field definition collection cron job at ${startTime.toISOString()}`);

            // Tạo timeout promise để tránh job chạy quá lâu
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('PROJECT-CENTRIC field definition collection job timeout after 3.5 hours'));
                }, 3.5 * 60 * 60 * 1000); // 3.5 giờ timeout (nhỏ hơn interval 4 giờ)
            });

            // Race giữa collectFieldDefinitions và timeout
            Promise.race([collectFieldDefinitions(), timeoutPromise])
                .then(() => {
                    const endTime = new Date();
                    const duration = endTime - startTime;
                    loggerInfo.info(`[Collect Field Definition] PROJECT-CENTRIC field definition collection cron job completed in ${Math.round(duration / 1000)}s`);
                })
                .catch((error) => {
                    const endTime = new Date();
                    const duration = endTime - startTime;
                    loggerError.error(`[Collect Field Definition] PROJECT-CENTRIC field definition collection cron job failed after ${Math.round(duration / 1000)}s:`, error);

                    // Log thêm thông tin để debug
                    loggerError.error(`[Collect Field Definition] Error details:`, {
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
                            loggerInfo.info('[Collect Field Definition] Garbage collection executed');
                        } catch (gcError) {
                            loggerError.error('[Collect Field Definition] Error during garbage collection execution:', gcError);
                        }
                    }
                });
        }, {
            scheduled: true
        });

        loggerInfo.info('[Collect Field Definition] Initialized PROJECT-CENTRIC field definition collection cron job to run every 4 hours with timezone Asia/Ho_Chi_Minh');

        // Chạy ngay một lần khi khởi động server
        loggerInfo.info('[Collect Field Definition] Running first PROJECT-CENTRIC job on server startup');
        isJobRunning = true;
        const startTime = new Date();

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Initial PROJECT-CENTRIC field definition collection job timeout after 3.5 hours'));
            }, 3.5 * 60 * 60 * 1000);
        });

        Promise.race([collectFieldDefinitions(), timeoutPromise])
            .then(() => {
                const endTime = new Date();
                const duration = endTime - startTime;
                loggerInfo.info(`[Collect Field Definition] Initial PROJECT-CENTRIC field definition collection job completed in ${Math.round(duration / 1000)}s`);
            })
            .catch((error) => {
                const endTime = new Date();
                const duration = endTime - startTime;
                loggerError.error(`[Collect Field Definition] Initial PROJECT-CENTRIC field definition collection job failed after ${Math.round(duration / 1000)}s:`, error);
            })
            .finally(() => {
                isJobRunning = false;
                if (global.gc) {
                    try {
                        global.gc();
                        loggerInfo.info('[Collect Field Definition] Initial garbage collection executed');
                    } catch (gcError) {
                        loggerError.error('[Collect Field Definition] Error during initial garbage collection:', gcError);
                    }
                }
            });
    } catch (error) {
        loggerError.error('[Collect Field Definition] Error initializing cron job:', error);
        // Reset flag nếu có lỗi khởi tạo
        isJobRunning = false;
        throw error; // Re-throw để caller biết có lỗi
    }
}

module.exports = {
    initCollectFieldDefinitionJob,
    collectFieldDefinitions
}; 