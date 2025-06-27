// Initialize all reporting routes
const initMistakeManagementRoutes = require('./mistakeManagementRoutes');
const initMistakeApprovalRoutes = require('./mistakeApprovalRoutes');
const initQualityStatsRoutes = require('./qualityStatsRoutes');
const initFieldConfigurationRoutes = require('./fieldConfigurationRoutes');
const initProjectThresholdRoutes = require('./projectThresholdRoutes');

function initReportingRoutes(app) {
    // Initialize all reporting route modules
    initMistakeManagementRoutes(app);
    initMistakeApprovalRoutes(app);
    initQualityStatsRoutes(app);
    initFieldConfigurationRoutes(app);
    initProjectThresholdRoutes(app);
}

module.exports = initReportingRoutes; 