const express = require('express');
const { getMistakeReportController, updateErrorTypeController, getMistakeForPMController } = require('../../controllers/reporting');
const verifyJWTToken = require("../../middlewaves/verifyJWTToken.js");

const router = express.Router();

// GET /api/v1/reporting/mistake-report
router.get('/reporting/mistake-report', verifyJWTToken, getMistakeReportController);

// PATCH /api/v1/reporting/mistake-report/error-type
router.patch('/reporting/mistake-report/error-type', verifyJWTToken, updateErrorTypeController);

// GET /api/v1/reporting/mistake-report/pm
router.get('/reporting/mistake-report/pm', verifyJWTToken, getMistakeForPMController);

function initMistakeManagementRoutes(app) {
    return app.use('/api/v1', router);
}

module.exports = initMistakeManagementRoutes; 