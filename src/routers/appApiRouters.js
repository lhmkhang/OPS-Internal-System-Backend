const express = require('express');
const verifyJWTToken = require('../middlewaves/verifyJWTToken');
const appController = require('../controllers/appController');

function initAppApiRoutes(app) {
    const router = express.Router();

    // Get all apps routes configuration
    router.get('/apps/routes-config', verifyJWTToken, appController.getRoutesConfig);

    app.use('/api/v1', router);
}

module.exports = initAppApiRoutes; 