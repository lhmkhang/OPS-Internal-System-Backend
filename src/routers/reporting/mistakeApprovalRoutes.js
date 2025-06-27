const express = require('express');
const { approveMistakeController, rejectMistakeController, batchUpdateErrorTypeController, batchApproveRejectMistakesController } = require('../../controllers/reporting');
const verifyJWTToken = require("../../middlewaves/verifyJWTToken.js");

const router = express.Router();

// PATCH /api/v1/reporting/mistake-report/approve
router.patch('/reporting/mistake-report/approve', verifyJWTToken, approveMistakeController);

// PATCH /api/v1/reporting/mistake-report/reject
router.patch('/reporting/mistake-report/reject', verifyJWTToken, rejectMistakeController);

// PATCH /api/v1/reporting/mistake-report/batch-error-type
router.patch('/reporting/mistake-report/batch-error-type', verifyJWTToken, batchUpdateErrorTypeController);

// PATCH /api/v1/reporting/mistake-report/batch-approve-reject - Batch approve/reject mistakes
router.patch('/reporting/mistake-report/batch-approve-reject', verifyJWTToken, batchApproveRejectMistakesController);

function initMistakeApprovalRoutes(app) {
    return app.use('/api/v1', router);
}

module.exports = initMistakeApprovalRoutes; 