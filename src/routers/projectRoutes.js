const express = require("express");
const path = require("path");
const verifyJWTToken = require("../middlewaves/verifyJWTToken.js");
const projectController = require("../controllers/projectController.js")
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const router = express.Router();

/**
 * @deprecated Legacy routes - Use new modular routes instead:
 * 
 * User Management routes (/api/v1/operation-planning/user-management/):
 * - POST /project-users-assignment -> POST /project-users-assignment
 * - GET /users-creation -> GET /users-creation  
 * - GET /resource-availability -> GET /resource-availability
 * - GET /project-user-assignment -> GET /project-users-assignment
 * - DELETE /project-user-assignment -> DELETE /project-users-assignment
 * 
 * Project Management routes (/api/v1/operation-planning/project-management/):
 * - POST /projects-plan -> POST /projects-plan
 * - PUT /projects-plan/:projectId -> PUT /projects-plan/:projectId
 * - GET /list-project-assigned -> GET /list-project-assigned
 * 
 * Input Plan routes (/api/v1/operation-planning/input-plan/):
 * - GET /plan-init -> GET /plan-init
 * - POST /project-plan-daily -> POST /project-plan-daily
 * - GET /project-plan-daily -> GET /project-plan-daily
 */
let initProjectApiRoutes = (app) => {
    router
        .post('/projects-plan', verifyJWTToken, projectController.handleCreateProjectPlan)
        .put('/projects-plan/:projectId', verifyJWTToken, projectController.handleUpdateProjectPlan)
        .post('/project-users-assignment', projectController.handleAssignUserToProjectSteps)
        .get('/plan-init', verifyJWTToken, projectController.handleGetPlanInit)
        .get('/users-creation', verifyJWTToken, projectController.handleGetUsersByRole)
        .get('/resource-availability', verifyJWTToken, projectController.handleGetResourceAvailability)
        .get('/list-project-assigned', verifyJWTToken, projectController.handleGetProjectAssigned)
        .get('/project-user-assignment', verifyJWTToken, projectController.handleGetProjectUserAssignments)
        .post('/project-plan-daily', verifyJWTToken, projectController.handleUpsertProjectPlanDaily)
        .get('/project-plan-daily', verifyJWTToken, projectController.handleGetProjectPlanDaily)
        .delete('/project-user-assignment', verifyJWTToken, projectController.handleDeleteProjectUserAssignment);
    return app.use("/api/v1", router);
};

module.exports = initProjectApiRoutes;