const express = require('express');
const { getProjectQualityStatsController, getAllProjectsQualityStatsController } = require('../../controllers/reporting');
const verifyJWTToken = require("../../middlewaves/verifyJWTToken.js");

const router = express.Router();

// GET /api/v1/reporting/project-quality-stats
router.get('/reporting/project-quality-stats', verifyJWTToken, getProjectQualityStatsController);

// GET /api/v1/reporting/all-projects-quality-stats - Lấy thông tin chất lượng tất cả dự án và tất cả report levels theo date range
router.get('/reporting/all-projects-quality-stats', verifyJWTToken, getAllProjectsQualityStatsController);

function initQualityStatsRoutes(app) {
    return app.use('/api/v1', router);
}

module.exports = initQualityStatsRoutes; 