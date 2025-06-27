/**
 * @deprecated 
 * This file is deprecated. Please use the new modular services:
 * - For project management: './operation-planning/projectManagementService'
 * - For user management: './operation-planning/userManagementService'  
 * - For project-user assignments: './operation-planning/projectUserAssignmentService'
 * - For input planning: './operation-planning/inputPlanService'
 * - For core/init data: './operation-planning/planningCoreService'
 * 
 * These exports are kept for backward compatibility only.
 */

// Re-export from new modular services for backward compatibility
const { createProjectPlan, updateProjectPlan, getProjectAssigned } = require('./operation-planning/projectManagementService');
const { getUsersByRole, getResourceAvailability, assignUserToProjectSteps, getProjectUserAssignments, deleteProjectUserAssignment } = require('./operation-planning/userManagementService');
const { upsertProjectPlanDaily, getProjectPlanDaily, getPlanInitData } = require('./operation-planning/inputPlanService');

module.exports = {
    createProjectPlan,
    updateProjectPlan,
    assignUserToProjectSteps,
    getPlanInitData,
    getUsersByRole,
    getResourceAvailability,
    getProjectAssigned,
    getProjectUserAssignments,
    upsertProjectPlanDaily,
    getProjectPlanDaily,
    deleteProjectUserAssignment
}; 