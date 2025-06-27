// Export all functions from separated reporting controller modules
const mistakeManagementController = require('./mistakeManagementController');
const mistakeApprovalController = require('./mistakeApprovalController');
const qualityStatsController = require('./qualityStatsController');
const fieldConfigurationController = require('./fieldConfigurationController');
const projectThresholdController = require('./projectThresholdController');

module.exports = {
    // Mistake management (QC operations)
    ...mistakeManagementController,

    // Mistake approval (PM operations)
    ...mistakeApprovalController,

    // Quality statistics
    ...qualityStatsController,

    // Field configuration
    ...fieldConfigurationController,

    // Project threshold
    ...projectThresholdController
}; 