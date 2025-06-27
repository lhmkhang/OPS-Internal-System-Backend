const { StatusCodes } = require('http-status-codes');
const { upsertProjectPlanDaily, getProjectPlanDaily, getPlanInitData } = require('../../services/operation-planning/inputPlanService');

// Lưu daily planning data
const saveProjectPlanDaily = async (req, res) => {
    try {
        const result = await upsertProjectPlanDaily(req.body, req.userId);
        res.status(StatusCodes.OK).json({
            status: 'success',
            message: 'Project plan daily saved successfully',
            data: result
        });
    } catch (error) {
        res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json({
            status: 'error',
            message: error.message || 'Failed to save project plan daily'
        });
    }
};

// Lấy daily planning data
const getProjectDaily = async (req, res) => {
    try {
        const { workingDate } = req.query;
        const result = await getProjectPlanDaily(workingDate);
        res.status(StatusCodes.OK).json({
            status: 'success',
            message: 'Project plan daily retrieved successfully',
            data: result
        });
    } catch (error) {
        res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json({
            status: 'error',
            message: error.message || 'Failed to get project plan daily'
        });
    }
};

// Lấy thông tin khởi tạo khi login
const getPlanInit = async (req, res) => {
    try {
        const result = await getPlanInitData(req);
        res.status(StatusCodes.OK).json({
            status: 'success',
            message: 'Plan init data retrieved successfully',
            data: result
        });
    } catch (error) {
        res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json({
            status: 'error',
            message: error.message || 'Failed to get plan init data'
        });
    }
};

module.exports = {
    saveProjectPlanDaily,
    getProjectDaily,
    getPlanInit
}; 