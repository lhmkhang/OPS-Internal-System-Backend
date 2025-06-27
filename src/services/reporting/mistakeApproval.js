const mongoose = require('mongoose');
const { createModel: createMistakeDetailsModel } = require('../../models/reporting/mistakeDetails.model');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const message = require('../../utils/message');
const { getConnection } = require('../../helpers/connectDB');
const logger = require('../../helpers/logger');
const loggerInfo = logger.getLogger("infoLogger");
const { getCommentFromReasonInput } = require('./reportingHelpers');
const { logActivity } = require('./mistakeManagement');

/**
 * PM approve lỗi với optimistic lock và transaction
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
        const { schema: mistakeApprovalSchema, collectionName: mistakeApprovalCollectionName } = require('../../models/reporting/mistakeApproval.model');
        const MistakeApproval = connection.model(mistakeApprovalCollectionName, mistakeApprovalSchema, mistakeApprovalCollectionName);

        const toId = v => mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : v;
        const doc = await MistakeReport.findOne({
            project_id: toId(project_id),
            doc_id: toId(doc_id),
            mistake_details: { $elemMatch: { _id: toId(error_id), status: 'WAIT_PM' } }
        }).session(session);

        if (!doc) {
            throw new handleMessage(message.REPORTING.NOT_FOUND, StatusCodes.CONFLICT);
        }

        const mistake = (doc.mistake_details || []).find(m => m._id.toString() === error_id);
        if (!mistake || mistake.status !== 'WAIT_PM') {
            throw new handleMessage(message.REPORTING.INVALID_STATUS_FOR_OPERATION, StatusCodes.CONFLICT);
        }

        let finalStatus = 'APPROVED_BY_PM';
        let updateOps = {
            'mistake_details.$.status': finalStatus,
        };

        if (mistake.error_type === 'not_error') {
            finalStatus = 'DONE';
            updateOps['mistake_details.$.status'] = finalStatus;
        }

        const updateResult = await MistakeReport.updateOne(
            {
                project_id: toId(project_id),
                doc_id: toId(doc_id),
                'mistake_details._id': toId(error_id),
                'mistake_details.status': 'WAIT_PM'
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

        if (updateResult.matchedCount === 0) {
            throw new handleMessage(message.REPORTING.OPTIMISTIC_LOCK_FAILED, StatusCodes.CONFLICT);
        }

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

        await logActivity({
            user_id: userId,
            user_name: user.fullName || user.username || `User_${userId}`,
            action: finalStatus === 'DONE' ? 'PM_APPROVE_CLOSE' : 'PM_APPROVE',
            doc_id,
            error_id,
            old_value: { status: mistake.status },
            new_value: { status: finalStatus },
            reason: reason || '',
            user_comment: reason || '',
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

        const doc = await MistakeReport.findOne({
            project_id: new mongoose.Types.ObjectId(project_id),
            doc_id: new mongoose.Types.ObjectId(doc_id),
            'mistake_details._id': new mongoose.Types.ObjectId(error_id),
            'mistake_details.status': 'WAIT_PM'
        }).session(session);

        if (!doc) {
            throw new handleMessage(message.REPORTING.NOT_FOUND, StatusCodes.CONFLICT);
        }

        const mistake = (doc.mistake_details || []).find(m => m._id.toString() === error_id);
        if (!mistake || mistake.status !== 'WAIT_PM') {
            throw new handleMessage(message.REPORTING.INVALID_STATUS_FOR_OPERATION, StatusCodes.CONFLICT);
        }

        const updateResult = await MistakeReport.updateOne(
            {
                project_id: new mongoose.Types.ObjectId(project_id),
                doc_id: new mongoose.Types.ObjectId(doc_id),
                'mistake_details._id': new mongoose.Types.ObjectId(error_id),
                'mistake_details.status': 'WAIT_PM'
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

        if (updateResult.matchedCount === 0) {
            throw new handleMessage(message.REPORTING.OPTIMISTIC_LOCK_FAILED, StatusCodes.CONFLICT);
        }

        await logActivity({
            user_id: userId,
            user_name: user || `User_${userId}`,
            action: 'PM_REJECT',
            doc_id,
            error_id,
            old_value: { status: mistake.status },
            new_value: { status: 'REJECTED_BY_PM' },
            reason,
            user_comment: reason || '',
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
 * Batch update error types cho nhiều mistakes cùng lúc
 */
async function batchUpdateErrorType(req, next) {
    let session;
    try {
        const { updates } = req.body;
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

        const updatesByProject = {};
        updates.forEach(update => {
            if (!updatesByProject[update.project_id]) {
                updatesByProject[update.project_id] = [];
            }
            updatesByProject[update.project_id].push(update);
        });

        for (const [projectId, projectUpdates] of Object.entries(updatesByProject)) {
            const MistakeReport = createMistakeDetailsModel(connection, projectId);

            for (const update of projectUpdates) {
                try {
                    const { error_id, doc_id, error_type, reason } = update;

                    if (!error_id || !doc_id || !error_type) {
                        failed++;
                        errors.push(`Missing required fields for error_id: ${error_id}`);
                        continue;
                    }

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

                    if (!['WAIT_QC', 'REJECTED_BY_PM'].includes(mistake.status)) {
                        failed++;
                        errors.push(`Invalid status for error_id: ${error_id}, current status: ${mistake.status}`);
                        continue;
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

/**
 * Batch approve/reject mistakes
 */
async function batchApproveRejectMistakes(req, next) {
    let session = null;
    try {
        const { updates } = req.body;
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
            userName: user,
            updates: updates.map(u => ({ error_id: u.error_id, status: u.status, project_id: u.project_id }))
        });

        const connection = getConnection('default');
        session = await connection.startSession();
        session.startTransaction();

        let successful = 0;
        let failed = 0;
        const errors = [];

        const updatesByProject = {};
        updates.forEach(update => {
            if (!updatesByProject[update.project_id]) {
                updatesByProject[update.project_id] = [];
            }
            updatesByProject[update.project_id].push(update);
        });

        for (const [projectId, projectUpdates] of Object.entries(updatesByProject)) {
            const MistakeReport = createMistakeDetailsModel(connection, projectId);

            for (const update of projectUpdates) {
                try {
                    const { error_id, doc_id, status, comment, reason } = update;

                    if (!error_id || !doc_id || !status) {
                        failed++;
                        errors.push(`Missing required fields for error_id: ${error_id}`);
                        continue;
                    }

                    if (!['APPROVED_BY_PM', 'REJECTED_BY_PM'].includes(status)) {
                        failed++;
                        errors.push(`Invalid status for error_id: ${error_id}, status: ${status}`);
                        continue;
                    }

                    const finalStatus = status === 'APPROVED_BY_PM' ? 'DONE' : status;

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

                    loggerInfo.info(`[batchApproveRejectMistakes] Processing error_id: ${error_id}, current status: ${mistake.status}, frontend status: ${status}, final status: ${finalStatus}`);

                    if (!['WAIT_PM', 'WAIT_QC'].includes(mistake.status)) {
                        failed++;
                        errors.push(`Invalid current status for error_id: ${error_id}, current status: ${mistake.status}`);
                        continue;
                    }

                    let updateOps = {
                        $set: {
                            'mistake_details.$.status': finalStatus
                        }
                    };

                    if (reason && Array.isArray(reason) && reason.length > 0) {
                        const reasonHistory = reason.map(r => {
                            let processedUserId;
                            const userIdFromReason = r.user_id || userId;

                            try {
                                processedUserId = new mongoose.Types.ObjectId(userIdFromReason);
                                loggerInfo.info(`[batchApproveRejectMistakes] Successfully converted user_id: ${userIdFromReason} to ObjectId`);
                            } catch (error) {
                                processedUserId = new mongoose.Types.ObjectId(userId);
                                loggerInfo.info(`[batchApproveRejectMistakes] Failed to convert user_id: ${userIdFromReason}, using JWT userId: ${userId}`);
                            }

                            return {
                                action: r.action || (status === 'APPROVED_BY_PM' ? 'APPROVED' : 'REJECTED'),
                                user_id: processedUserId,
                                user_name: r.user_name || user,
                                content: r.content || r.comment || '',
                                createdDate: r.createdDate ? new Date(r.createdDate) : new Date()
                            };
                        });

                        updateOps.$push = {
                            'mistake_details.$.reason': { $each: reasonHistory }
                        };
                    } else if (comment) {
                        const newReasonEntry = {
                            action: status === 'APPROVED_BY_PM' ? 'APPROVED' : 'REJECTED',
                            user_id: new mongoose.Types.ObjectId(userId),
                            user_name: user,
                            content: comment,
                            createdDate: new Date()
                        };

                        updateOps.$push = {
                            'mistake_details.$.reason': newReasonEntry
                        };
                    }

                    const updateResult = await MistakeReport.updateOne(
                        {
                            project_id: new mongoose.Types.ObjectId(projectId),
                            doc_id: new mongoose.Types.ObjectId(doc_id),
                            'mistake_details._id': new mongoose.Types.ObjectId(error_id),
                            'mistake_details.status': { $in: ['WAIT_PM', 'WAIT_QC'] }
                        },
                        updateOps,
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

                    let currentActionComment = '';
                    if (reason && Array.isArray(reason)) {
                        currentActionComment = getCommentFromReasonInput(reason);
                    } else if (comment) {
                        currentActionComment = comment;
                    }

                    await logActivity({
                        user_id: userId,
                        user_name: user || `User_${userId}`,
                        action: status === 'APPROVED_BY_PM' ? 'PM_APPROVE' : 'PM_REJECT',
                        doc_id,
                        error_id,
                        old_value: {
                            status: mistake.status
                        },
                        new_value: {
                            status: finalStatus
                        },
                        reason: finalStatus === 'DONE' ? 'Approved by PM' : 'Rejected by PM',
                        user_comment: currentActionComment,
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

module.exports = {
    approveMistake,
    rejectMistake,
    batchUpdateErrorType,
    batchApproveRejectMistakes
}; 