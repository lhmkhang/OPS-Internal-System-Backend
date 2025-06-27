const mongoose = require('mongoose');
const { schema: projectThresholdSchema, collectionName: projectThresholdCollectionName } = require('../../models/reporting/ProjectThresholdModel');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const message = require('../../utils/message');
const { getConnection } = require('../../helpers/connectDB');
const logger = require('../../helpers/logger');
const loggerInfo = logger.getLogger("infoLogger");

/**
 * Get project threshold configuration
 * @param {Object} req - Express request object
 * @param {Function} next - Express next function
 * @returns {Promise<Object>} - Project threshold configuration
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
    getProjectThreshold,
    createOrUpdateProjectThreshold,
    deleteThresholdItem,
    deleteProjectThreshold
}; 