const mongoose = require('mongoose');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const message = require('../../utils/message');
const { getConnection } = require('../../helpers/connectDB');
const logger = require('../../helpers/logger');
const loggerInfo = logger.getLogger("infoLogger");

/**
 * API lấy danh sách field configuration theo project_id - VERSION MỚI (Project-Centric với Version Control)
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

        const connection = getConnection('default');
        const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../../models/reporting/fieldDefinitionCollection.model');
        const ProjectFieldConfiguration = connection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

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
        ).sort({ version: -1 }).lean();

        if (!projectConfig) {
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

        for (const field of fields) {
            if (!field.field_id) {
                throw new handleMessage('field_id is required for each field', StatusCodes.BAD_REQUEST);
            }
            if (field.is_report_count === undefined && field.critical_field === undefined) {
                throw new handleMessage('At least one of is_report_count or critical_field must be provided', StatusCodes.BAD_REQUEST);
            }

            if (field.critical_field !== undefined && field.critical_field !== null) {
                if (typeof field.critical_field !== 'string') {
                    throw new handleMessage('critical_field must be a string or null', StatusCodes.BAD_REQUEST);
                }
            }
        }

        const connection = getConnection('default');
        const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../../models/reporting/fieldDefinitionCollection.model');
        const ProjectFieldConfiguration = connection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

        session = await connection.startSession();
        session.startTransaction();

        const currentConfig = await ProjectFieldConfiguration.findOne(
            {
                project_id: new mongoose.Types.ObjectId(project_id),
                isActive: true
            }
        ).sort({ version: -1 }).session(session).lean();

        if (!currentConfig) {
            throw new handleMessage('Project field configuration not found', StatusCodes.NOT_FOUND);
        }

        const cleanCurrentConfig = JSON.parse(JSON.stringify(currentConfig));

        const updatedFields = [...cleanCurrentConfig.fields];
        const updateResults = [];

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

            await ProjectFieldConfiguration.create([newConfigData], { session });

            await ProjectFieldConfiguration.updateOne(
                { _id: currentConfig._id },
                { $set: { isActive: false } }
            ).session(session);

            await session.commitTransaction();

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
            await session.commitTransaction();

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
 * Delete project field configuration - VERSION CONTROL
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
        const { schema: projectFieldConfigurationSchema, collectionName: projectFieldConfigurationCollectionName } = require('../../models/reporting/fieldDefinitionCollection.model');
        const ProjectFieldConfiguration = connection.model(projectFieldConfigurationCollectionName, projectFieldConfigurationSchema);

        session = await connection.startSession();
        session.startTransaction();

        const currentConfig = await ProjectFieldConfiguration.findOne({
            project_id: new mongoose.Types.ObjectId(project_id),
            isActive: true
        }).sort({ version: -1 }).session(session).lean();

        if (!currentConfig) {
            throw new handleMessage('Project field configuration not found', StatusCodes.NOT_FOUND);
        }

        await ProjectFieldConfiguration.updateOne(
            { _id: currentConfig._id },
            { $set: { isActive: false } },
            { session }
        );

        const previousConfig = await ProjectFieldConfiguration.findOne({
            project_id: new mongoose.Types.ObjectId(project_id),
            version: { $lt: currentConfig.version },
            isActive: false
        }).sort({ version: -1 }).session(session).lean();

        let activatedPrevious = null;
        if (previousConfig) {
            await ProjectFieldConfiguration.updateOne(
                { _id: previousConfig._id },
                { $set: { isActive: true } },
                { session }
            );

            activatedPrevious = await ProjectFieldConfiguration.findById(previousConfig._id).session(session).lean();
        }

        await session.commitTransaction();

        return {
            success: true,
            deletedConfig: {
                ...currentConfig,
                isActive: false
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
    getFieldConfiguration,
    updateFieldConfiguration,
    deleteFieldConfiguration
}; 