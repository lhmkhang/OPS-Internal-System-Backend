const mongoose = require('mongoose');
const qualityReportSchema = require('../models/qualityReport.model');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../utils/HandleMessage');
const message = require('../utils/message');

/**
 * Truy vấn report mistake theo projectId và ngày (capture_date_keyer)
 * @param {object} req - Express request object (đã có req.userId, req.user từ verifyJWTToken)
 * @param {object} params - { projectId, date }
 * @returns {Promise<{items: Array, total: number}>}
 */
async function getMistakeReport(req) {
    const { projectId, date } = req.query;

    const userId = req.userId;
    const user = req.user;

    console.log(userId, user);
    console.log(projectId, date);


    if (!userId || !user) {
        throw new handleMessage('User not authorized', StatusCodes.UNAUTHORIZED);
    }
    if (!projectId || !date) {
        throw new handleMessage(message.REPORTING.MISSING_PARAMS, StatusCodes.BAD_REQUEST);
    }
    const collectionName = `${projectId}_quality_report`;
    // Đăng ký model động theo collection
    let QualityReport;
    try {
        QualityReport = mongoose.model(collectionName);
    } catch (e) {
        QualityReport = mongoose.model(collectionName, qualityReportSchema, collectionName);
    }
    // Truy vấn theo capture_date_keyer
    const filter = { capture_date_keyer: date };
    const items = await QualityReport.find(filter).lean();
    const total = await QualityReport.countDocuments(filter);
    return { items, total };
}

module.exports = {
    getMistakeReport,
}; 