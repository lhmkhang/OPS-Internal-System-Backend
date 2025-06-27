const express = require('express');
const router = express.Router();
const { saveProjectPlanDaily, getProjectDaily, getPlanInit } = require('../../controllers/operation-planning/inputPlanController');
const verifyJWTToken = require('../../middlewaves/verifyJWTToken');

let initInputPlanApiRoutes = (app) => {
    // Routes cho input planning
    router
        .post('/project-plan-daily', verifyJWTToken, saveProjectPlanDaily)         // POST /api/v1/operation-planning/input-plan/project-plan-daily
        .get('/project-plan-daily', verifyJWTToken, getProjectDaily)               // GET /api/v1/operation-planning/input-plan/project-plan-daily
        .get('/plan-init', verifyJWTToken, getPlanInit);                          // GET /api/v1/operation-planning/input-plan/plan-init

    return app.use('/api/v1/operation-planning/input-plan', router);
};

module.exports = initInputPlanApiRoutes;
