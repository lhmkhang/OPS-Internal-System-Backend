const { StatusCodes } = require('http-status-codes');
const { createProjectPlan, updateProjectPlan, getProjectAssigned } = require('../../services/operation-planning/projectManagementService');

// Tạo project mới
const createProject = async (req, res) => {
    try {
        const result = await createProjectPlan(req);
        res.status(StatusCodes.CREATED).json({
            status: 'success',
            message: 'Project created successfully',
            data: result
        });
    } catch (error) {
        res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json({
            status: 'error',
            message: error.message || 'Failed to create project'
        });
    }
};

// Cập nhật project
const updateProject = async (req, res) => {
    try {
        const { projectId } = req.params;
        const result = await updateProjectPlan(projectId, req);
        res.status(StatusCodes.OK).json({
            status: 'success',
            message: 'Project updated successfully',
            data: result
        });
    } catch (error) {
        res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json({
            status: 'error',
            message: error.message || 'Failed to update project'
        });
    }
};

// Lấy danh sách project được assign
const getAssignedProjects = async (req, res) => {
    try {
        const result = await getProjectAssigned(req);
        res.status(StatusCodes.OK).json({
            status: 'success',
            message: 'Projects retrieved successfully',
            data: result
        });
    } catch (error) {
        res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json({
            status: 'error',
            message: error.message || 'Failed to get assigned projects'
        });
    }
};

module.exports = {
    createProject,
    updateProject,
    getAssignedProjects
}; 