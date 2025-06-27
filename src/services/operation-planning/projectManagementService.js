const ProjectsPlanSchema = require('../../models/ProjectsPlanModel');
const { schema: UserSchema, collectionName: UserCollectionName } = require('../../models/userModel');
const { schema: UsersSchema, collectionName: UsersCollectionName } = require('../../models/usersModel');
const { schema: UserGroupSchema, collectionName: UserGroupCollectionName } = require('../../models/UserGroupModel');
const { schema: ProjectUsersAssignmentSchema, collectionName: ProjectUsersAssignmentCollectionName } = require('../../models/ProjectUsersAssignmentModel');
const { schema: UserRoleSchema, collectionName: UserRoleCollectionName } = require('../../models/UserRoleModel');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../../utils/HandleMessage');
const mongoose = require('mongoose');
const { getConnection } = require('../../helpers/connectDB');

// Lấy connection default
const connection = getConnection('default');

// Tạo model từ schema
const ProjectsPlan = connection.model(ProjectsPlanSchema.collectionName, ProjectsPlanSchema.schema);
const UserModel = connection.model(UserCollectionName, UserSchema);
const UsersModel = connection.model(UsersCollectionName, UsersSchema);
const UserGroupModel = connection.model(UserGroupCollectionName, UserGroupSchema);
const ProjectUsersAssignmentModel = connection.model(ProjectUsersAssignmentCollectionName, ProjectUsersAssignmentSchema);
const UserRoleModel = connection.model(UserRoleCollectionName, UserRoleSchema);

// Import helper function từ userManagementService
const { getAllSubordinateIds } = require('./userManagementService');

// Hàm tạo 1 dự án mới
const createProjectPlan = async (req) => {
    const { projectName, steps, slaTarget, projectManagers, customerName } = req.body;
    const userId = req.userId;

    // Kiểm tra role
    const userRoles = await UserRoleModel.find({ userId: userId }).sort({ priority: 1 });
    if (!userRoles.length) {
        throw new handleMessage('User has no roles assigned', StatusCodes.FORBIDDEN);
    }
    const primaryRole = userRoles.reduce((prev, curr) => prev.priority < curr.priority ? prev : curr, userRoles[0]);
    if (!['ADMIN', 'PROJECT_MANAGER', 'LINE_MANAGER'].includes(primaryRole.role)) {
        throw new handleMessage('Only Admin, Project Manager, or Line Manager can create projects', StatusCodes.FORBIDDEN);
    }

    // Validate
    if (!projectName || !customerName || !projectManagers || !Array.isArray(projectManagers) || projectManagers.length === 0 || !steps || Object.keys(steps).length === 0) {
        throw new handleMessage('Missing or invalid required fields', StatusCodes.BAD_REQUEST);
    }

    // Kiểm tra tất cả PM tồn tại
    const pmChecks = await Promise.all(
        projectManagers.map(async (pmId) => {
            const pmExists = await UserModel.findById(pmId);
            return pmExists ? true : false;
        })
    );
    if (pmChecks.includes(false)) {
        throw new handleMessage('One or more Project Managers are invalid', StatusCodes.BAD_REQUEST);
    }

    // Kiểm tra projectName đã tồn tại
    const existingProject = await ProjectsPlan.findOne({ projectName });
    if (existingProject) {
        throw new handleMessage('Project name already exists', StatusCodes.CONFLICT);
    }

    // Kiểm tra steps
    const stepEntries = Object.entries(steps);
    const seen = new Set();
    for (const [stepName, stepData] of stepEntries) {
        if (!stepData.layout || !stepData.section || !stepName || !stepData.unit || stepData.timePerDoc <= 0 || stepData.productiveHours <= 0) {
            throw new handleMessage(`Invalid step data for '${stepName}'`, StatusCodes.BAD_REQUEST);
        }
        const key = `${stepData.layout}-${stepData.section}-${stepName}`;
        if (seen.has(key)) {
            throw new handleMessage(`Duplicate step detected: '${stepName}'`, StatusCodes.BAD_REQUEST);
        }
        seen.add(key);
    }

    // Tạo project mới với projectManagers là mảng từ req.body
    const project = new ProjectsPlan({
        projectName,
        customerName,
        steps,
        slaTarget,
        projectManagers, // Sử dụng mảng trực tiếp từ req.body
    });
    await project.save();

    return {
        projectId: project._id,
        projectName,
        customerName,
        steps,
        slaTarget,
        projectManagers,
    };
};

// Hàm cập nhật thông tin dự án
const updateProjectPlan = async (projectId, req) => {
    const { projectName, customerName, steps, slaTarget, projectManagers } = req.body;
    const userId = req.userId;

    // Kiểm tra role
    const userRoles = await UserRoleModel.find({ userId: userId }).sort({ priority: 1 });
    if (!userRoles.length) {
        throw new handleMessage('User has no roles assigned', StatusCodes.FORBIDDEN);
    }
    const primaryRole = userRoles.reduce((prev, curr) => prev.priority < curr.priority ? prev : curr, userRoles[0]);
    if (!['ADMIN', 'PROJECT_MANAGER', 'LINE_MANAGER'].includes(primaryRole.role)) {
        throw new handleMessage('Only Admin, Project Manager, or Line Manager can update projects', StatusCodes.FORBIDDEN);
    }

    // Kiểm tra projectId hợp lệ
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
        throw new handleMessage('Invalid project ID', StatusCodes.BAD_REQUEST);
    }

    // Kiểm tra tên trùng lặp nếu projectName thay đổi
    if (projectName) {
        const duplicateProject = await ProjectsPlan.findOne({ projectName, _id: { $ne: projectId } });
        if (duplicateProject) {
            throw new handleMessage('Project name already exists', StatusCodes.CONFLICT);
        }
    }

    // Kiểm tra steps (nếu có)
    if (steps) {
        const stepEntries = Object.entries(steps);
        const seen = new Set();
        for (const [stepName, stepData] of stepEntries) {
            if (!stepData.layout || !stepData.section || !stepName || !stepData.unit || stepData.timePerDoc <= 0 || stepData.productiveHours <= 0) {
                throw new handleMessage(`Invalid step data for '${stepName}'`, StatusCodes.BAD_REQUEST);
            }
            const key = `${stepData.layout}-${stepData.section}-${stepName}`;
            if (seen.has(key)) {
                throw new handleMessage(`Duplicate step detected: '${stepName}'`, StatusCodes.BAD_REQUEST);
            }
            seen.add(key);
        }
    }

    // Kiểm tra projectManagers (nếu có)
    if (projectManagers) {
        if (!Array.isArray(projectManagers) || projectManagers.length === 0) {
            throw new handleMessage('Project managers must be a non-empty array', StatusCodes.BAD_REQUEST);
        }

        // Kiểm tra tất cả PM tồn tại
        const pmChecks = await Promise.all(
            projectManagers.map(async (pmId) => {
                const pmExists = await UserModel.findById(pmId);
                return pmExists ? true : false;
            })
        );
        if (pmChecks.includes(false)) {
            throw new handleMessage('One or more Project Managers are invalid', StatusCodes.BAD_REQUEST);
        }
    }

    // Kiểm tra project tồn tại
    const existingProject = await ProjectsPlan.findById(projectId);
    if (!existingProject) {
        throw new handleMessage('Project not found', StatusCodes.NOT_FOUND);
    }

    // Cập nhật project
    const updateData = {};
    if (projectName) updateData.projectName = projectName;
    if (customerName) updateData.customerName = customerName;
    if (steps) updateData.steps = steps;
    if (slaTarget !== undefined) updateData.slaTarget = slaTarget;
    if (projectManagers) updateData.projectManagers = projectManagers; // Replace toàn bộ mảng projectManagers
    updateData.modifiedDate = new Date();

    const updatedProject = await ProjectsPlan.findByIdAndUpdate(
        projectId,
        updateData,
        { new: true, runValidators: true }
    );

    if (!updatedProject) {
        throw new handleMessage('Project not found', StatusCodes.NOT_FOUND);
    }

    return {
        projectId: updatedProject._id,
        projectName: updatedProject.projectName,
        customerName: updatedProject.customerName,
        steps: updatedProject.steps,
        slaTarget: updatedProject.slaTarget,
        projectManagers: updatedProject.projectManagers,
    };
};

// Hàm lấy danh sách dự án đã được assign theo role
const getProjectAssigned = async (req) => {
    const userId = req.userId;
    const roles = await UserRoleModel.find({ userId: { $in: [userId] } }).sort({ priority: 1 });

    if (!roles.length) {
        throw new handleMessage('User has no roles assigned', StatusCodes.FORBIDDEN);
    }

    const currentUser = await UserModel.findOne({ _id: userId }).select('_id username');

    if (!currentUser) {
        throw new handleMessage('User not found', StatusCodes.NOT_FOUND);
    }

    const primaryRole = roles.reduce((prev, curr) =>
        prev.priority < curr.priority ? prev : curr,
        roles[0] || { role: 'VIEWER', priority: Infinity }
    );

    let projectsQuery = {};
    if (primaryRole.role === 'ADMIN' || primaryRole.role === 'QUALITY_ASSURANCE') {
        projectsQuery = {};
    } else if (primaryRole.role === 'LINE_MANAGER') {
        let subordinateIds = await getAllSubordinateIds(userId);
        subordinateIds = [...subordinateIds, userId.toString()]
        projectsQuery = { projectManagers: { $in: subordinateIds } };
    } else if (primaryRole.role === 'PROJECT_MANAGER') {
        projectsQuery = { projectManagers: userId };
    } else if (primaryRole.role === 'TEAM_LEADER') {
        const groups = await UserGroupModel.find({ teamLeader: userId }).select('_id');
        const users = await UsersModel.find({ groupId: groups[0]._id }).select('_id')
        const usersId = users.map(u => u._id.toString())
        const projectIds = await ProjectUsersAssignmentModel.find({ userId: { $in: usersId } }).select('projectId').distinct('projectId').lean();

        projectsQuery = { _id: { $in: projectIds } };
    } else {
        projectsQuery = { projectManagers: null };
    }

    const projects = await ProjectsPlan.find(projectsQuery);

    return {
        projects: projects.map(project => ({
            projectId: project._id,
            projectName: project.projectName,
            customerName: project.customerName,
            steps: project.steps,
            slaTarget: project.slaTarget,
            projectManagers: project.projectManagers,
            createdDate: project.createdDate,
            modifiedDate: project.modifiedDate
        }))
    };
};

module.exports = {
    createProjectPlan,
    updateProjectPlan,
    getProjectAssigned
}; 