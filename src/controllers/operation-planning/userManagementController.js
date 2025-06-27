const userManagementService = require("../../services/operation-planning/userManagementService");

const handleCreateProjectUser = async (req, res, next) => {
    const { username, fullName, group, groupProjectId, workingShift, location, floor } = req.body;
    userManagementService.createProjectUser(username, fullName, group, groupProjectId, workingShift, location, floor, res, next);
};

const handleUpdateProjectUser = async (req, res, next) => {
    const { userId, username, fullName, group, groupProjectId, workingShift, location, floor } = req.body;
    userManagementService.updateProjectUser(userId, username, fullName, group, groupProjectId, workingShift, location, floor, res, next);
};

const handleUpdateUserAvailability = async (req, res, next) => {
    const { userId, fte, workingDate } = req.body;
    userManagementService.updateUserAvailability(userId, fte, workingDate, res, next);
};

const handleGetAllUsers = async (req, res, next) => {
    userManagementService.getAllUsers(res, next);
};

const handleDeleteProjectUser = async (req, res, next) => {
    const { userId } = req.body;
    userManagementService.deleteProjectUser(userId, res, next);
};

const handleGetUsersByRole = async (req, res, next) => {
    try {
        const data = await userManagementService.getUsersByRole(req);
        return res.status(200).json({
            status: 'success',
            code: 200,
            message: 'Users retrieved successfully',
            data,
        });
    } catch (error) {
        next(error);
    }
};

const handleGetResourceAvailability = async (req, res, next) => {
    try {
        const data = await userManagementService.getResourceAvailability(req);
        return res.status(200).json({
            status: 'success',
            code: 200,
            message: 'Resource availability retrieved successfully',
            data,
        });
    } catch (error) {
        next(error);
    }
};

const handleAssignUserToProjectSteps = async (req, res, next) => {
    try {
        const assignment = await userManagementService.assignUserToProjectSteps(req.body);
        return res.status(200).json({
            status: 'success',
            code: 200,
            message: 'User assigned to project steps successfully',
            data: assignment,
        });
    } catch (error) {
        next(error);
    }
};

const handleGetProjectUserAssignments = async (req, res, next) => {
    try {
        const data = await userManagementService.getProjectUserAssignments(req);
        return res.status(200).json({
            status: 'success',
            code: 200,
            message: 'Project user assignments retrieved successfully',
            data,
        });
    } catch (error) {
        next(error);
    }
};

const handleDeleteProjectUserAssignment = async (req, res, next) => {
    try {
        const assignment = await userManagementService.deleteProjectUserAssignment(req.body);
        return res.status(200).json({
            status: 'success',
            code: 200,
            message: 'Assignment deleted or updated successfully',
            data: assignment,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    handleCreateProjectUser,
    handleUpdateProjectUser,
    handleUpdateUserAvailability,
    handleGetAllUsers,
    handleDeleteProjectUser,
    handleGetUsersByRole,
    handleGetResourceAvailability,
    handleAssignUserToProjectSteps,
    handleGetProjectUserAssignments,
    handleDeleteProjectUserAssignment
}; 