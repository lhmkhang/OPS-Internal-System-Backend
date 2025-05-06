const express = require('express');
const { getMistakeReportController } = require('../controllers/reportingController');
const verifyJWTToken = require("../middlewaves/verifyJWTToken.js");

const router = express.Router();

// GET /api/v1/reporting/mistake-report
router.get('/reporting/mistake-report', verifyJWTToken, getMistakeReportController);

function initReportingApiRoutes(app) {
    return app.use('/api/v1', router);
}

module.exports = initReportingApiRoutes; 