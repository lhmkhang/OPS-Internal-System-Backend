const { approveMistake, rejectMistake, batchUpdateErrorType, batchApproveRejectMistakes } = require('../../services/reporting');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const message = require('../../utils/message');

// PATCH /api/v1/reporting/mistake-report/approve
async function approveMistakeController(req, res, next) {
    try {
        const result = await approveMistake(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.REPORTING.APPROVE_MISTAKE_SUCCESS,
            data: result,
        });
    } catch (error) {
        console.log(error);

        return next(new handleMessage(error.message || message.REPORTING.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

// PATCH /api/v1/reporting/mistake-report/reject
async function rejectMistakeController(req, res, next) {
    try {
        const result = await rejectMistake(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.REPORTING.REJECT_MISTAKE_SUCCESS,
            data: result,
        });
    } catch (error) {
        return next(new handleMessage(error.message || message.REPORTING.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

/**
 * PATCH /api/v1/reporting/mistake-report/batch-error-type
 * Body: { updates: [{ error_id, project_id, doc_id, error_type, reason }] }
 */
async function batchUpdateErrorTypeController(req, res, next) {
    try {
        const result = await batchUpdateErrorType(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.REPORTING.BATCH_UPDATE_ERROR_TYPE_SUCCESS || 'Batch update error types successfully',
            data: result,
        });
    } catch (error) {
        console.log(error);
        return next(new handleMessage(error.message || message.REPORTING.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

/**
 * PATCH /api/v1/reporting/mistake-report/batch-approve-reject
 * Body: { updates: [{ error_id, project_id, doc_id, status, comment, reason }] }
 */
async function batchApproveRejectMistakesController(req, res, next) {
    try {
        const result = await batchApproveRejectMistakes(req, next);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: message.REPORTING.BATCH_APPROVE_REJECT_SUCCESS || 'Batch approve/reject mistakes successfully',
            data: result,
        });
    } catch (error) {
        console.log(error);
        return next(new handleMessage(error.message || message.REPORTING.INTERNAL_SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
    }
}

module.exports = {
    approveMistakeController,
    rejectMistakeController,
    batchUpdateErrorTypeController,
    batchApproveRejectMistakesController
}; 