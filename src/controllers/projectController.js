const { createProjectPlan,
    assignUserToProjectSteps,
    getPlanInitData, getUsersByRole,
    getResourceAvailability,
    getProjectAssigned,
    getProjectUserAssignments,
    updateProjectPlan,
    upsertProjectPlanDaily,
    getProjectPlanDaily,
    deleteProjectUserAssignment } = require('../services/projectService.js');

const { StatusCodes } = require('http-status-codes');

const handleCreateProjectPlan = async (req, res, next) => {
    try {
        const project = await createProjectPlan(req);
        return res.status(StatusCodes.CREATED).json({
            status: 'success',
            code: StatusCodes.CREATED,
            message: 'Project created successfully',
            data: project,
        });
    } catch (error) {
        next(error);
    }
};

const handleUpdateProjectPlan = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        const updatedProject = await updateProjectPlan(projectId, req);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Project updated successfully',
            data: updatedProject,
        });
    } catch (error) {
        next(error);
    }
};

const handleAssignUserToProjectSteps = async (req, res, next) => {
    try {
        const assignment = await assignUserToProjectSteps(req.body);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: 'User assigned to project steps successfully',
            data: assignment,
        });
    } catch (error) {
        next(error);
    }
};

const handleGetPlanInit = async (req, res, next) => {
    try {
        const data = await getPlanInitData(req);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Initial plan data retrieved successfully',
            data,
        });
    } catch (error) {
        next(error);
    }
};

const handleGetUsersByRole = async (req, res, next) => {
    try {
        const data = await getUsersByRole(req);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Users retrieved successfully',
            data,
        });
    } catch (error) {
        next(error);
    }
};

const handleGetResourceAvailability = async (req, res, next) => {
    try {
        const data = await getResourceAvailability(req);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Resource availability retrieved successfully',
            data,
        });
    } catch (error) {
        next(error);
    }
};

const handleGetProjectAssigned = async (req, res, next) => {
    try {
        const data = await getProjectAssigned(req);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Project assignments retrieved successfully',
            data,
        });
    } catch (error) {
        next(error);
    }
};

const handleGetProjectUserAssignments = async (req, res, next) => {
    try {
        const data = await getProjectUserAssignments(req);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Project user assignments retrieved successfully',
            data,
        });
    } catch (error) {
        next(error);
    }
};

const handleUpsertProjectPlanDaily = async (req, res, next) => {
    try {
        const result = await upsertProjectPlanDaily(req.body, req.userId);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            message: 'Plan saved',
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

const handleGetProjectPlanDaily = async (req, res, next) => {
    try {
        const { workingDate } = req.query;
        const result = await getProjectPlanDaily(workingDate);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

const handleDeleteProjectUserAssignment = async (req, res, next) => {
    try {
        const assignment = await deleteProjectUserAssignment(req.body);
        return res.status(StatusCodes.OK).json({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Assignment deleted or updated successfully',
            data: assignment,
        });
    } catch (error) {
        next(error);
    }
};


module.exports = {
    handleCreateProjectPlan,
    handleUpdateProjectPlan, // Thêm handler mới
    handleAssignUserToProjectSteps,
    handleGetPlanInit,
    handleGetUsersByRole,
    handleGetResourceAvailability,
    handleGetProjectAssigned,
    handleGetProjectUserAssignments,
    handleUpsertProjectPlanDaily,
    handleGetProjectPlanDaily,
    handleDeleteProjectUserAssignment
};