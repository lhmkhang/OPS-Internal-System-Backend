const express = require('express');
const { getFieldConfigurationController, updateFieldConfigurationController } = require('../../controllers/reporting');
const verifyJWTToken = require("../../middlewaves/verifyJWTToken.js");

const router = express.Router();

// GET /api/v1/reporting/field-configuration - Lấy danh sách field configuration theo project_id
router.get('/reporting/field-configuration', verifyJWTToken, getFieldConfigurationController);

// PATCH /api/v1/reporting/field-configuration - Update is_report_count và critical_field cho một hoặc nhiều field
router.patch('/reporting/field-configuration', verifyJWTToken, updateFieldConfigurationController);

function initFieldConfigurationRoutes(app) {
    return app.use('/api/v1', router);
}

module.exports = initFieldConfigurationRoutes; 