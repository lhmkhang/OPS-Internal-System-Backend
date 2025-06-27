const express = require('express');
const { getProjectThresholdController, createOrUpdateProjectThresholdController, deleteThresholdItemController, deleteProjectThresholdController } = require('../../controllers/reporting');
const verifyJWTToken = require("../../middlewaves/verifyJWTToken.js");

const router = express.Router();

// GET /api/v1/reporting/project-threshold - Lấy project threshold configuration theo project_id
router.get('/reporting/project-threshold', verifyJWTToken, getProjectThresholdController);

// POST /api/v1/reporting/project-threshold - Tạo hoặc cập nhật project threshold configuration
router.post('/reporting/project-threshold', verifyJWTToken, createOrUpdateProjectThresholdController);

// DELETE /api/v1/reporting/project-threshold/item - Xóa một threshold item cụ thể 
router.delete('/reporting/project-threshold/item', verifyJWTToken, deleteThresholdItemController);

// DELETE /api/v1/reporting/project-threshold - Xóa toàn bộ project threshold configuration (soft delete)
router.delete('/reporting/project-threshold', verifyJWTToken, deleteProjectThresholdController);

function initProjectThresholdRoutes(app) {
    return app.use('/api/v1', router);
}

module.exports = initProjectThresholdRoutes; 