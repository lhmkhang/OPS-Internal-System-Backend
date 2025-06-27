// Export all functions from separated reporting service modules
const reportingHelpers = require('./reportingHelpers');
const mistakeManagement = require('./mistakeManagement');
const mistakeApproval = require('./mistakeApproval');
const qualityStats = require('./qualityStats');
const fieldConfiguration = require('./fieldConfiguration');
const projectThreshold = require('./projectThreshold');

module.exports = {
    // Helper functions
    ...reportingHelpers,

    // Mistake management (QC operations)
    ...mistakeManagement,

    // Mistake approval (PM operations)
    ...mistakeApproval,

    // Quality statistics
    ...qualityStats,

    // Field configuration
    ...fieldConfiguration,

    // Project threshold
    ...projectThreshold
}; 