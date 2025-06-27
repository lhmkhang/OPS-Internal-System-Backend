// Modular routes exports for clean import
module.exports = {
    // Authentication module
    initAuthApiRoutes: require('./auth/authRoutes'),

    // Operation Planning module (3 main modules)
    initUserManagementApiRoutes: require('./operation-planning/userManagementRoutes'),    // User CRUD + User-Project assignments + Resource availability
    initProjectManagementApiRoutes: require('./operation-planning/projectManagementRoutes'), // Project CRUD + Project configurations
    initInputPlanApiRoutes: require('./operation-planning/inputPlanRoutes'),              // Daily planning + Plan init data

    // Legacy routes (to be refactored gradually)
    initUserApiRouters: require('./userApiRouters'),
    initProjectApiRoutes: require('./projectRoutes'),
    initReportingRoutes: require('./reporting'),
    initAppApiRoutes: require('./appApiRouters'),
    initWebRouters: require('./webRouters'),
    initAuthorizationRoutes: require('./authorization')
}; 