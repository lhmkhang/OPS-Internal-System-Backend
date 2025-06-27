const mongoose = require('mongoose');
const { createModel: createMistakeDetailsModel } = require('../../models/reporting/mistakeDetails.model');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const message = require('../../utils/message');
const { getConnection } = require('../../helpers/connectDB');
const logger = require('../../helpers/logger');
const loggerInfo = logger.getLogger("infoLogger");
const { parseDateToUTC, convertUTCToGMT7DateString, getCommentFromReasonInput } = require('./reportingHelpers');

/**
 * API lấy danh sách lỗi chi tiết cho QC - defect-classification UI
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

        const connection = getConnection('default');
        const MistakeReport = createMistakeDetailsModel(connection, project_id);

        // Build filter
        const filter = { project_id: new mongoose.Types.ObjectId(project_id) };

        // Xử lý filter ngày
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

        const shouldIncludeAllStatuses = include_all_statuses === 'true' || include_all_statuses === true;

        if (shouldIncludeAllStatuses) {
            loggerInfo.info(`[getMistakeReport] Loading ALL mistakes for project ${project_id} without status filter`);
        }

        let items = [];
        for (const doc of docs) {
            let mistakes;

            if (shouldIncludeAllStatuses) {
                mistakes = doc.mistake_details || [];
            } else {
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

        session = await connection.startSession();
        session.startTransaction();

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

        if (!['WAIT_QC', 'REJECTED_BY_PM'].includes(mistake.status)) {
            throw new handleMessage(message.REPORTING.INVALID_STATUS_FOR_OPERATION, StatusCodes.CONFLICT);
        }

        let newStatus;
        let updateOps = {
            'mistake_details.$.error_type': error_type
        };

        if (reason && Array.isArray(reason) && reason.length > 0) {
            const reasonHistory = reason.map(r => ({
                action: r.action || 'QC_EDIT',
                user_id: r.user_id ? new mongoose.Types.ObjectId(r.user_id) : new mongoose.Types.ObjectId(userId),
                user_name: r.user_name || user.fullName || user.username,
                content: r.content || r.comment || '',
                createdDate: r.createdDate ? new Date(r.createdDate) : new Date()
            }));
            updateOps['mistake_details.$.reason'] = [...(mistake.reason || []), ...reasonHistory];
        }

        if (mistake.status === 'REJECTED_BY_PM' && error_type === 'not_error') {
            newStatus = 'DONE';
        } else {
            newStatus = 'WAIT_PM';
        }

        updateOps['mistake_details.$.status'] = newStatus;

        const updateResult = await MistakeReport.updateOne(
            {
                project_id: new mongoose.Types.ObjectId(project_id),
                doc_id: new mongoose.Types.ObjectId(doc_id),
                'mistake_details._id': new mongoose.Types.ObjectId(error_id),
                'mistake_details.status': { $in: ['WAIT_QC', 'REJECTED_BY_PM'] }
            },
            { $set: updateOps },
            { session }
        );

        if (updateResult.matchedCount === 0) {
            throw new handleMessage(message.REPORTING.RECORD_MODIFIED_BY_ANOTHER_USER, StatusCodes.CONFLICT);
        }

        const currentActionComment = getCommentFromReasonInput(reason);

        await logActivity({
            user_id: userId,
            user_name: user || `User_${userId}`,
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
            user_comment: currentActionComment,
            session
        });

        await session.commitTransaction();

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
                loggerInfo.error('[updateErrorType] Error aborting transaction:', abortError);
            }
        }
        throw err;
    } finally {
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
 * Ghi activity log với history
 */
async function logActivity({ user_id, user_name, action, doc_id, error_id, old_value, new_value, reason, user_comment = '', session = null }) {
    try {
        const { schema: activityLogSchema, collectionName: activityLogCollectionName } = require('../../models/reporting/activityLog.model');
        const connection = getConnection('default');
        const ActivityLog = connection.model(activityLogCollectionName, activityLogSchema, activityLogCollectionName);

        const isValidUserName = user_name && typeof user_name === 'string' && user_name.trim() !== '';
        const validatedUserName = isValidUserName ? user_name.trim() : 'Unknown User';

        if (!isValidUserName) {
            loggerInfo.warn(`[Activity Log] Missing or invalid user_name for user_id: ${user_id}, using fallback: ${validatedUserName}`);
        }

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

        const filter = {
            doc_id: new mongoose.Types.ObjectId(doc_id),
            error_id: new mongoose.Types.ObjectId(error_id)
        };

        const updateOps = {
            $push: {
                history: newHistoryEntry
            },
            $set: {
                last_action: action,
                last_user: validatedUserName,
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

        loggerInfo.info(`[Activity Log] Successfully logged action: ${action} for doc_id: ${doc_id}, error_id: ${error_id}`);
    } catch (error) {
        loggerInfo.error('[Activity Log] Error writing activity log:', error);
    }
}

module.exports = {
    getMistakeReport,
    updateErrorType,
    getMistakeForPM,
    logActivity
}; 