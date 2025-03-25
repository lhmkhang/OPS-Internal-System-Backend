const express = require("express");
const path = require("path");
const verifyJWTToken = require("../middlewaves/verifyJWTToken.js");
const projectController = require("../controllers/projectController.js")
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const router = express.Router();

let initProjectApiRoutes = (app) => {
    router
        .post('/projects-plan', verifyJWTToken, projectController.handleCreateProjectPlan)
        .put('/projects-plan/:projectId', verifyJWTToken, projectController.handleUpdateProjectPlan) // Thêm route mới
        .post('/project-users-assignment', projectController.handleAssignUserToProjectSteps)
        .get('/plan-init', verifyJWTToken, projectController.handleGetPlanInit)
        .get('/users-creation', verifyJWTToken, projectController.handleGetUsersByRole)
        .get('/resource-availability', verifyJWTToken, projectController.handleGetResourceAvailability)
        .get('/list-project-assigned', verifyJWTToken, projectController.handleGetProjectAssigned)
        .get('/project-user-assignment', verifyJWTToken, projectController.handleGetProjectUserAssignments) // Thêm route mới
        .post('/project-plan-daily', verifyJWTToken, projectController.handleUpsertProjectPlanDaily)
        .get('/project-plan-daily', verifyJWTToken, projectController.handleGetProjectPlanDaily)
        .delete('/project-user-assignment', verifyJWTToken, projectController.handleDeleteProjectUserAssignment);
    return app.use("/api/v1", router);
};

module.exports = initProjectApiRoutes;