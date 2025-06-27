const express = require('express');
const router = express.Router();
const { createProject, updateProject, getAssignedProjects } = require('../../controllers/operation-planning/projectManagementController');
const verifyJWTToken = require('../../middlewaves/verifyJWTToken');

let initProjectManagementApiRoutes = (app) => {
    // Routes cho project management
    router
        .post('/projects-plan', verifyJWTToken, createProject)                    // POST /api/v1/operation-planning/project-management/projects-plan
        .put('/projects-plan/:projectId', verifyJWTToken, updateProject)          // PUT /api/v1/operation-planning/project-management/projects-plan/:projectId
        .get('/list-project-assigned', verifyJWTToken, getAssignedProjects);      // GET /api/v1/operation-planning/project-management/list-project-assigned

    return app.use('/api/v1/operation-planning/project-management', router);
};

module.exports = initProjectManagementApiRoutes; 