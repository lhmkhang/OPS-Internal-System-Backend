const ProjectsPlan = require('../models/ProjectsPlanModel');
const { UserModel } = require('../models/userModel');
const { UsersModel } = require('../models/usersModel');
const { UserGroupModel } = require('../models/UserGroupModel');
const { UserAvailabilityModel } = require("../models/userAvailabilityModel");
const { ProjectUsersAssignmentModel } = require("../models/ProjectUsersAssignmentModel");
const { UserRoleModel } = require("../models/UserRoleModel");
const { GroupProjectsModel } = require("../models/GroupProjectsModel");
const { CustomersPlanModel } = require('../models/CustomersPlanModel');
const ProjectPlanDailyModel = require('../models/ProjectPlanDailyModel');
const { StatusCodes } = require('http-status-codes');
const handleMessage = require('../utils/HandleMessage');
const mongoose = require('mongoose');
const logger = require('../helpers/logger');

// Hàm không thay đổi
const createProjectPlan = async (req) => {
    const { projectName, steps, slaTarget, projectManager, customerName } = req.body;
    const userId = req.userId

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
    if (!projectName || !customerName || !projectManager || !steps || Object.keys(steps).length === 0) {
        throw new handleMessage('Missing required fields', StatusCodes.BAD_REQUEST);
    }

    // Kiểm tra PM tồn tại
    const pmExists = await UserModel.findById(projectManager);
    if (!pmExists) {
        throw new handleMessage('Invalid Project Manager', StatusCodes.BAD_REQUEST);
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

    // Tạo project mới với projectManagers là mảng chứa một PM
    const project = new ProjectsPlan({
        projectName,
        customerName,
        steps,
        slaTarget,
        projectManagers: [projectManager], // Push một PM vào mảng
    });
    await project.save();

    return {
        projectId: project._id,
        projectName,
        customerName,
        steps,
        slaTarget,
        projectManagers: [projectManager],
    };
};

// Hàm không thay đổi
const updateProjectPlan = async (projectId, data) => {
    const { projectName, steps, slaTarget } = data;

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
        throw new handleMessage('Invalid project ID', StatusCodes.BAD_REQUEST);
    }

    // Kiểm tra tên trùng lặp trước nếu tên thay đổi
    if (projectName) {
        const duplicateProject = await ProjectsPlan.findOne({ projectName, _id: { $ne: projectId } });
        if (duplicateProject) {
            throw new handleMessage('Project name already exists', StatusCodes.CONFLICT);
        }
    }

    const stepEntries = Object.entries(steps || {});
    const seen = new Set();
    for (const [stepName, stepData] of stepEntries) {
        const key = `${stepData.layout}-${stepData.section}-${stepName}`;
        if (seen.has(key)) {
            throw new handleMessage(
                `Duplicate step detected: Step '${stepName}' with layout '${stepData.layout}' and section '${stepData.section}' already exists in project '${projectName}'`,
                StatusCodes.BAD_REQUEST
            );
        }
        seen.add(key);
    }

    const updatedProject = await ProjectsPlan.findByIdAndUpdate(
        projectId,
        { projectName, steps, slaTarget, modifiedDate: new Date() },
        { new: true, runValidators: true }
    );

    if (!updatedProject) {
        throw new handleMessage('Project not found', StatusCodes.NOT_FOUND);
    }

    return updatedProject;
};

// Hàm không thay đổi => backup
/* 
const assignUserToProjectSteps = async (data) => {
    const { userId, projectId, steps } = data;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(projectId)) {
        throw new handleMessage('Invalid user ID or project ID', StatusCodes.BAD_REQUEST);
    }

    const project = await mongoose.model('projects_plan').findById(projectId);
    if (!project) {
        throw new handleMessage('Project not found', StatusCodes.NOT_FOUND);
    }

    const validSteps = Array.from(project.steps.keys());
    if (steps.length > 0 && !steps.every(s => validSteps.includes(s.stepName))) {
        throw new handleMessage('Invalid steps provided', StatusCodes.BAD_REQUEST);
    }

    const assignment = await ProjectUsersAssignmentModel.findOneAndUpdate(
        { userId, projectId },
        { steps, modifiedDate: new Date() },
        { upsert: true, new: true, runValidators: true }
    );

    return assignment;
};
 */

const assignUserToProjectSteps = async (data) => {
    const { userId, projectId, steps } = data;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(projectId)) {
        throw new handleMessage('Invalid user ID or project ID', StatusCodes.BAD_REQUEST);
    }

    const project = await mongoose.model('projects_plan').findById(projectId);
    if (!project) {
        throw new handleMessage('Project not found', StatusCodes.NOT_FOUND);
    }

    const validSteps = Array.from(project.steps.keys());
    if (steps.length > 0 && !steps.every(s => validSteps.includes(s.stepName))) {
        throw new handleMessage('Invalid steps provided', StatusCodes.BAD_REQUEST);
    }

    const assignment = await ProjectUsersAssignmentModel.findOneAndUpdate(
        { userId, projectId, },
        { steps },
        { upsert: true, new: true, runValidators: true }
    );
    return {
        userId: assignment.userId,
        projectId: assignment.projectId,
        projectName: project.projectName,
        steps: assignment.steps
    };
};

// Hàm không thay đổi
const getAllSubordinateIds = async (userId) => {
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return [];

    const subordinates = new Set();
    const directSubs = await UserModel.find({ lineManager: userId }).select('_id');
    directSubs.forEach(sub => subordinates.add(sub._id.toString()));

    for (const subId of [...subordinates]) {
        const deeperSubs = await UserModel.find({ lineManager: subId }).select('_id');
        deeperSubs.forEach(sub => subordinates.add(sub._id.toString()));
    }

    return [...subordinates];
};

// Hàm không thay đổi
const getPlanInitData = async (req) => {
    const username = req.user;

    if (!username) {
        throw new handleMessage('Username not provided', StatusCodes.UNAUTHORIZED);
    }

    const currentUser = await UserModel.findOne({ username }).select('_id username');
    if (!currentUser) {
        throw new handleMessage('User not found', StatusCodes.NOT_FOUND);
    }
    const userId = currentUser._id;

    const userRoles = await UserRoleModel.find({ userId: { $in: [userId] } }).select('role priority -_id').lean();

    if (!userRoles || userRoles.length === 0) {
        return {
            currentUser: {
                userId,
                username: currentUser.username,
                roles: [{ role: 'VIEWER', priority: Infinity }],
            }
        };
    }

    const primaryRole = userRoles.reduce((prev, curr) =>
        prev.priority < curr.priority ? prev : curr,
        userRoles[0]
    );

    return {
        currentUser: {
            userId,
            username: currentUser.username,
            roles: [primaryRole],
        }
    };
};

// Hàm cập nhật: Lấy danh sách user theo role và 1 số dữ liệu khởi tạo ban đầu
const getUsersByRole = async (req) => {
    const username = req.user;
    const userId = req.userId;

    if (!username || !userId) {
        throw new handleMessage('Username or userId not provided', StatusCodes.UNAUTHORIZED);
    }

    const userRoles = await UserRoleModel.find({ userId: { $in: [userId] } }).sort({ priority: 1 });
    if (!userRoles.length) {
        throw new handleMessage('User has no roles assigned', StatusCodes.FORBIDDEN);
    }

    const currentUser = await UserModel.findOne({ _id: userId }).select('_id username');
    if (!currentUser) {
        throw new handleMessage('User not found', StatusCodes.NOT_FOUND);
    }

    const primaryRole = userRoles.reduce((prev, curr) =>
        prev.priority < curr.priority ? prev : curr,
        userRoles[0]
    );

    let projectManagers = [];
    let usersQuery = {};
    let groupNamesQuery = {};
    let allUserIds = new Set();

    if (primaryRole.role === 'ADMIN') {
        usersQuery = {};
        groupNamesQuery = {};
        const allProjects = await ProjectsPlan.find({})
            .distinct('projectManagers')
            .then(ids => ids.map(id => id.toString())); // Chuyển ObjectId thành chuỗi

        const pmUsers = await UserModel.find({ _id: { $in: allProjects } }).select('_id fullName');
        projectManagers = pmUsers.map(u => ({ id: u._id.toString(), name: u.fullName }));
    } else if (primaryRole.role === 'TEAM_LEADER') {
        const groups = await UserGroupModel.find({ teamLeader: userId }).select('_id');
        const groupIds = groups.map(g => g._id);
        usersQuery = { groupId: { $in: groupIds } };
        groupNamesQuery = { teamLeader: userId };
        projectManagers = [];
    } else if (primaryRole.role === 'PROJECT_MANAGER') {
        const currentUser = await UserModel.findOne({ _id: userId }).select('_id fullName');
        projectManagers = [{ id: currentUser._id.toString(), name: currentUser.fullName }];
        const projects = await ProjectsPlan.find({ projectManagers: userId }).select('_id');
        const projectNames = projects.map(p => p._id);
        const assignments = await ProjectUsersAssignmentModel.find({ projectId: { $in: projectNames } }).select('userId');
        allUserIds = new Set(assignments.map(a => a.userId.toString()));

        const groups = await UserGroupModel.find({ teamLeader: userId }).select('_id');
        const groupIds = groups.map(g => g._id);
        const groupUsers = await UsersModel.find({ groupId: { $in: groupIds } }).select('_id');
        groupUsers.forEach(u => allUserIds.add(u._id.toString()));

        const subordinateIds = await getAllSubordinateIds(userId);

        groupNamesQuery = { teamLeader: { $in: [userId, ...subordinateIds] } };

        if (subordinateIds.length > 0) {
            const subGroups = await UserGroupModel.find({ teamLeader: { $in: subordinateIds } }).select('_id');
            const subGroupIds = subGroups.map(g => g._id);

            const subGroupUsers = await UsersModel.find({ groupId: { $in: subGroupIds } }).select('_id');
            subGroupUsers.forEach(u => allUserIds.add(u._id.toString()));
        }

        usersQuery = { _id: { $in: [...allUserIds] } };
    } else if (primaryRole.role === 'LINE_MANAGER') {
        const subordinateIds = await getAllSubordinateIds(userId);


        const pmRoles = await UserRoleModel.find({
            userId: { $elemMatch: { $in: subordinateIds } }, // Sử dụng $elemMatch
            role: 'PROJECT_MANAGER'
        }).select('userId');

        const pmIds = pmRoles.map(r => r.userId).flat();
        const pmUsers = await UserModel.find({ _id: { $in: pmIds } }).select('_id fullName');
        projectManagers = pmUsers.map(u => ({ id: u._id.toString(), name: u.fullName }));
        groupNamesQuery = { teamLeader: { $in: subordinateIds } };
        const projects = await ProjectsPlan.find({ projectManagers: { $in: subordinateIds } }).select('projectName');
        const projectNames = projects.map(p => p.projectName);
        const assignments = await ProjectUsersAssignmentModel.find({ projectName: { $in: projectNames } }).select('userId');
        allUserIds = new Set(assignments.map(a => a.userId.toString()));

        const groups = await UserGroupModel.find({ teamLeader: { $in: subordinateIds } }).select('_id');
        const groupIds = groups.map(g => g._id);
        const groupUsers = await UsersModel.find({ groupId: { $in: groupIds } }).select('_id');
        groupUsers.forEach(u => allUserIds.add(u._id.toString()));

        usersQuery = { _id: { $in: [...allUserIds] } };
    } else if (primaryRole.role === 'VIEWER') {
        usersQuery = { _id: userId };
        groupNamesQuery = { _id: null };
        projectManagers = [];
    }

    const users = await UsersModel.find(usersQuery).select('username fullName groupId group groupProjectId');
    const groupNames = await UserGroupModel.find(groupNamesQuery)
        .select('_id groupName')
        .lean()
        .then(groups => groups.map(g => ({ id: g._id, name: g.groupName })));

    const groupProjects = await GroupProjectsModel.find({})
        .select('_id name')
        .lean()
        .then(groups => groups.map(g => ({ id: g._id, name: g.name })));

    const customers = await CustomersPlanModel.find({})
        .select('_id customerName')
        .lean()
        .then(customers => customers.map(c => ({ id: c._id, name: c.customerName })));

    return {
        users: users.map(user => ({
            userId: user._id,
            username: user.username,
            fullName: user.fullName,
            group: user.group,
            groupId: user.groupId,
            groupProjectId: user.groupProjectId,
        })),
        groupNames,
        groupProjects,
        customers,
        projectManagers,
    };
};

// Hàm cập nhật: Lấy FTE của users theo role
const getResourceAvailability = async (req) => {
    const username = req.user;
    const userId = req.userId;
    const workingDate = req.query.workingDate || new Date().toISOString().split('T')[0]; // Mặc định là ngày hiện tại nếu không truyền

    if (!username) {
        throw new handleMessage('Username not provided', StatusCodes.UNAUTHORIZED);
    }

    const currentUser = await UserModel.findOne({ username }).select('_id username');
    if (!currentUser) {
        throw new handleMessage('User not found', StatusCodes.NOT_FOUND);
    }

    const userRoles = await UserRoleModel.find({ userId: { $in: [userId] } }).sort({ priority: 1 });
    if (!userRoles.length) {
        throw new handleMessage('User has no roles assigned', StatusCodes.FORBIDDEN);
    }

    const primaryRole = userRoles.reduce((prev, curr) =>
        prev.priority < curr.priority ? prev : curr,
        userRoles[0]
    );

    let usersQuery = {};
    let allUserIds = new Set();

    if (primaryRole.role === 'ADMIN') {
        usersQuery = {};
    } else if (primaryRole.role === 'TEAM_LEADER') {
        const groups = await UserGroupModel.find({ teamLeader: userId }).select('_id');
        const groupIds = groups.map(g => g._id);
        usersQuery = { groupId: { $in: groupIds } };
    } else if (primaryRole.role === 'PROJECT_MANAGER') {
        const projects = await ProjectsPlan.find({ projectManagers: userId }).select('projectName');
        const projectNames = projects.map(p => p.projectName);
        const assignments = await ProjectUsersAssignmentModel.find({ projectName: { $in: projectNames } }).select('userId');
        allUserIds = new Set(assignments.map(a => a.userId.toString()));

        const groups = await UserGroupModel.find({ teamLeader: userId }).select('_id');
        const groupIds = groups.map(g => g._id);
        const groupUsers = await UsersModel.find({ groupId: { $in: groupIds } }).select('_id');
        groupUsers.forEach(u => allUserIds.add(u._id.toString()));

        const subordinateIds = await getAllSubordinateIds(userId);
        if (subordinateIds.length > 0) {
            const subGroups = await UserGroupModel.find({ teamLeader: { $in: subordinateIds } }).select('_id');
            const subGroupIds = subGroups.map(g => g._id);
            const subGroupUsers = await UsersModel.find({ groupId: { $in: subGroupIds } }).select('_id');
            subGroupUsers.forEach(u => allUserIds.add(u._id.toString()));
        }

        usersQuery = { _id: { $in: [...allUserIds] } };
    } else if (primaryRole.role === 'LINE_MANAGER') {
        const subordinateIds = await getAllSubordinateIds(userId);
        const projects = await ProjectsPlan.find({ projectManagers: { $in: subordinateIds } }).select('projectName');
        const projectNames = projects.map(p => p.projectName);
        const assignments = await ProjectUsersAssignmentModel.find({ projectName: { $in: projectNames } }).select('userId');
        allUserIds = new Set(assignments.map(a => a.userId.toString()));

        const groups = await UserGroupModel.find({ teamLeader: { $in: subordinateIds } }).select('_id');
        const groupIds = groups.map(g => g._id);
        const groupUsers = await UsersModel.find({ groupId: { $in: groupIds } }).select('_id');
        groupUsers.forEach(u => allUserIds.add(u._id.toString()));

        usersQuery = { _id: { $in: [...allUserIds] } };
    } else if (primaryRole.role === 'VIEWER') {
        usersQuery = { _id: userId };
    }

    const users = await UsersModel.find(usersQuery).select('_id username fullName groupId');
    const userIds = users.map(user => user._id);

    // Lấy dữ liệu availability
    const availabilityQuery = { userId: { $in: userIds }, workingDate };
    const availabilities = await UserAvailabilityModel.find(availabilityQuery)
        .select('userId fte workingDate');

    const groupIds = users.map(user => user.groupId);
    const groups = await UserGroupModel.find({ _id: { $in: groupIds } }).select('_id groupName');
    const groupMap = new Map(groups.map(g => [g._id.toString(), g.groupName]));

    // So sánh workingDate với ngày hiện tại
    const today = new Date().toISOString().split('T')[0];
    const isPastDate = workingDate < today;

    // Nếu là ngày trong quá khứ và không có dữ liệu, trả về mảng rỗng
    if (isPastDate && !availabilities.length) {
        return { users: [] };
    }

    // Trả về tất cả user dưới quyền, với FTE từ DB nếu có
    const usersWithFte = users.map(user => {
        const availability = availabilities.find(a => a.userId.toString() === user._id.toString());
        return {
            userId: user._id,
            username: user.username,
            fullName: user.fullName,
            groupName: groupMap.get(user.groupId.toString()) || 'Unknown',
            fte: availability ? availability.fte : 0, // Mặc định 0 nếu không có dữ liệu
            ...(availability ? { workingDate: availability.workingDate } : { workingDate }) // Gán workingDate từ query nếu không có dữ liệu
        };
    });

    return { users: usersWithFte };
};

// Hàm cập nhật: Lấy danh sách dự án theo role
const getProjectAssigned = async (req) => {
    const username = req.user;
    const roles = req.roles || [];

    if (!username) {
        throw new handleMessage('Username not provided', StatusCodes.UNAUTHORIZED);
    }

    const currentUser = await UserModel.findOne({ username }).select('_id username');
    if (!currentUser) {
        throw new handleMessage('User not found', StatusCodes.NOT_FOUND);
    }
    const userId = currentUser._id;

    const primaryRole = roles.reduce((prev, curr) =>
        prev.priority < curr.priority ? prev : curr,
        roles[0] || { role: 'VIEWER', priority: Infinity }
    );

    let projectsQuery = {};
    if (primaryRole.role === 'ADMIN') {
        projectsQuery = {};
    } else if (primaryRole.role === 'LINE_MANAGER') {
        let subordinateIds = await getAllSubordinateIds(userId);
        subordinateIds = [...subordinateIds, userId.toString()]
        projectsQuery = { projectManagers: { $in: subordinateIds } };
    } else if (primaryRole.role === 'PROJECT_MANAGER') {
        projectsQuery = { projectManagers: userId };
    } else if (primaryRole.role === 'TEAM_LEADER' || primaryRole.role === 'VIEWER') {
        // TEAM_LEADER và VIEWER không thấy dự án, trả rỗng
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

// Hàm cập nhật: Lấy assignments và toàn bộ user dưới quyền theo role => backup
/* 
const getProjectUserAssignments = async (req) => {
    const username = req.user;
    const roles = req.roles || [];

    if (!username) {
        throw new handleMessage('Username not provided', StatusCodes.UNAUTHORIZED);
    }

    const currentUser = await UserModel.findOne({ username }).select('_id username');
    if (!currentUser) {
        throw new handleMessage('User not found', StatusCodes.NOT_FOUND);
    }
    const userId = currentUser._id;

    const primaryRole = roles.reduce((prev, curr) =>
        prev.priority < curr.priority ? prev : curr,
        roles[0] || { role: 'VIEWER', priority: Infinity }
    );

    let projectsQuery = {};
    let allUserIds = new Set();

    if (primaryRole.role === 'ADMIN') {
        projectsQuery = {};
        const allUsers = await UsersModel.find({}).select('_id');
        allUsers.forEach(u => allUserIds.add(u._id.toString()));
    } else if (primaryRole.role === 'PROJECT_MANAGER') {
        projectsQuery = { projectManagers: userId };
        const projects = await ProjectsPlan.find(projectsQuery).select('_id');
        const projectIds = projects.map(p => p._id);
        const assignments = await ProjectUsersAssignmentModel.find({ projectId: { $in: projectIds } }).select('userId');
        assignments.forEach(a => allUserIds.add(a.userId.toString()));

        const groups = await UserGroupModel.find({ teamLeader: userId }).select('_id');
        const groupIds = groups.map(g => g._id);
        const groupUsers = await UsersModel.find({ groupId: { $in: groupIds } }).select('_id');
        groupUsers.forEach(u => allUserIds.add(u._id.toString()));

        const subordinateIds = await getAllSubordinateIds(userId);
        if (subordinateIds.length > 0) {
            const subGroups = await UserGroupModel.find({ teamLeader: { $in: subordinateIds } }).select('_id');
            const subGroupIds = subGroups.map(g => g._id);
            const subGroupUsers = await UsersModel.find({ groupId: { $in: subGroupIds } }).select('_id');
            subGroupUsers.forEach(u => allUserIds.add(u._id.toString()));
        }
    } else if (primaryRole.role === 'LINE_MANAGER') {
        const subordinateIds = await getAllSubordinateIds(userId);
        projectsQuery = { projectManagers: { $in: subordinateIds } };
        const projects = await ProjectsPlan.find(projectsQuery).select('_id');
        const projectIds = projects.map(p => p._id);
        const assignments = await ProjectUsersAssignmentModel.find({ projectId: { $in: projectIds } }).select('userId');
        assignments.forEach(a => allUserIds.add(a.userId.toString()));

        const groups = await UserGroupModel.find({ teamLeader: { $in: subordinateIds } }).select('_id');
        const groupIds = groups.map(g => g._id);
        const groupUsers = await UsersModel.find({ groupId: { $in: groupIds } }).select('_id');
        groupUsers.forEach(u => allUserIds.add(u._id.toString()));
    } else if (primaryRole.role === 'TEAM_LEADER' || primaryRole.role === 'VIEWER') {
        projectsQuery = { projectManagers: null };
    }

    const projects = await ProjectsPlan.find(projectsQuery).select('_id projectName');
    const projectIds = projects.map(p => p._id);
    const projectMap = new Map(projects.map(p => [p._id.toString(), p.projectName]));

    const assignments = await ProjectUsersAssignmentModel.find({ projectId: { $in: projectIds } })
        .select('userId projectId steps createdDate modifiedDate')
        .lean(); // Dùng lean() để tránh vấn đề serialize

    const users = await UsersModel.find({ _id: { $in: [...allUserIds] } }).select('username fullName groupId');
    const userMap = new Map(users.map(u => [u._id.toString(), { fullName: u.fullName, groupId: u.groupId }]));

    const groupIds = users.map(u => u.groupId);
    const groups = await UserGroupModel.find({ _id: { $in: groupIds } }).select('_id groupName');
    const groupMap = new Map(groups.map(g => [g._id.toString(), g.groupName]));

    const assignmentsWithDetails = assignments.map(assignment => {
        const user = userMap.get(assignment.userId.toString());
        return {
            userId: assignment.userId,
            projectId: assignment.projectId,
            projectName: projectMap.get(assignment.projectId.toString()) || 'Unknown',
            steps: assignment.steps, // Đảm bảo steps giữ nguyên định dạng { stepName, layout, section }
            fullName: user ? user.fullName : 'Unknown',
            groupName: user ? (groupMap.get(user.groupId.toString()) || 'Unknown') : 'Unknown',
            createdDate: assignment.createdDate,
            modifiedDate: assignment.modifiedDate
        };
    });

    console.log('get assignment: ', {
        projects: projects.map(p => p.projectName),
        assignments: assignmentsWithDetails
    });


    return {
        projects: projects.map(p => p.projectName),
        assignments: assignmentsWithDetails
    };
};
 */

const getProjectUserAssignments = async (req) => {
    const username = req.user;
    const roles = req.roles || [];

    if (!username) {
        throw new handleMessage('Username not provided', StatusCodes.UNAUTHORIZED);
    }

    const currentUser = await UserModel.findOne({ username }).select('_id username');
    if (!currentUser) {
        throw new handleMessage('User not found', StatusCodes.NOT_FOUND);
    }
    const userId = currentUser._id;

    const primaryRole = roles.reduce((prev, curr) =>
        prev.priority < curr.priority ? prev : curr,
        roles[0] || { role: 'VIEWER', priority: Infinity }
    );

    let projectsQuery = {};
    let allUserIds = new Set();

    if (primaryRole.role === 'ADMIN') {
        projectsQuery = {};
        const allUsers = await UsersModel.find({}).select('_id');
        allUsers.forEach(u => allUserIds.add(u._id.toString()));
    } else if (primaryRole.role === 'PROJECT_MANAGER') {
        projectsQuery = { projectManagers: userId };
        const projects = await ProjectsPlan.find(projectsQuery).select('_id');
        const projectIds = projects.map(p => p._id);
        const assignments = await ProjectUsersAssignmentModel.find({ projectId: { $in: projectIds } }).select('userId');
        assignments.forEach(a => allUserIds.add(a.userId.toString()));

        const groups = await UserGroupModel.find({ teamLeader: userId }).select('_id');
        const groupIds = groups.map(g => g._id);
        const groupUsers = await UsersModel.find({ groupId: { $in: groupIds } }).select('_id');
        groupUsers.forEach(u => allUserIds.add(u._id.toString()));

        const subordinateIds = await getAllSubordinateIds(userId);
        if (subordinateIds.length > 0) {
            const subGroups = await UserGroupModel.find({ teamLeader: { $in: subordinateIds } }).select('_id');
            const subGroupIds = subGroups.map(g => g._id);
            const subGroupUsers = await UsersModel.find({ groupId: { $in: subGroupIds } }).select('_id');
            subGroupUsers.forEach(u => allUserIds.add(u._id.toString()));
        }
    } else if (primaryRole.role === 'LINE_MANAGER') {
        const subordinateIds = await getAllSubordinateIds(userId);
        projectsQuery = { projectManagers: { $in: subordinateIds } };
        const projects = await ProjectsPlan.find(projectsQuery).select('_id');
        const projectIds = projects.map(p => p._id);
        const assignments = await ProjectUsersAssignmentModel.find({ projectId: { $in: projectIds } }).select('userId');
        assignments.forEach(a => allUserIds.add(a.userId.toString()));

        const groups = await UserGroupModel.find({ teamLeader: { $in: subordinateIds } }).select('_id');
        const groupIds = groups.map(g => g._id);
        const groupUsers = await UsersModel.find({ groupId: { $in: groupIds } }).select('_id');
        groupUsers.forEach(u => allUserIds.add(u._id.toString()));
    } else if (primaryRole.role === 'TEAM_LEADER' || primaryRole.role === 'VIEWER') {
        projectsQuery = { projectManagers: null };
    }

    const projects = await ProjectsPlan.find(projectsQuery).select('_id projectName');
    const projectIds = projects.map(p => p._id);
    const projectMap = new Map(projects.map(p => [p._id.toString(), p.projectName]));

    const assignments = await ProjectUsersAssignmentModel.find({ projectId: { $in: projectIds } }).select('userId projectId steps createdDate modifiedDate').lean();

    return assignmentsWithDetails = assignments.map(assignment => {
        return {
            userId: assignment.userId,
            projectId: assignment.projectId,
            projectName: projectMap.get(assignment.projectId.toString()) || 'Unknown',
            steps: assignment.steps, // Đảm bảo steps giữ nguyên định dạng { stepName, layout, section }
        };
    });
};

const deleteProjectUserAssignment = async (data) => {
    const { userId, projectId, steps } = data;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(projectId)) {
        throw new handleMessage('Invalid user ID or project ID', StatusCodes.BAD_REQUEST);
    }

    const project = await ProjectsPlan.findById(projectId);
    if (!project) {
        throw new handleMessage('Project not found', StatusCodes.NOT_FOUND);
    }

    const assignment = await ProjectUsersAssignmentModel.findOne({ userId, projectId });
    if (!assignment) {
        throw new handleMessage('Assignment not found', StatusCodes.NOT_FOUND);
    }

    if (!Array.isArray(steps)) {
        throw new handleMessage('Steps must be an array', StatusCodes.BAD_REQUEST);
    }

    if (steps.length === 0) {
        await ProjectUsersAssignmentModel.deleteOne({ userId, projectId });
        return { userId, projectId, projectName: project.projectName, steps: [] };
    }

    const validSteps = Array.from(project.steps.keys());
    if (!steps.every(s => validSteps.includes(s.stepName))) {
        throw new handleMessage('Invalid steps provided', StatusCodes.BAD_REQUEST);
    }

    const updatedAssignment = await ProjectUsersAssignmentModel.findOneAndUpdate(
        { userId, projectId },
        { steps, modifiedDate: new Date() },
        { new: true, runValidators: true }
    );

    return {
        userId: updatedAssignment.userId,
        projectId: updatedAssignment.projectId,
        projectName: project.projectName,
        steps: updatedAssignment.steps,
    };
};

const upsertProjectPlanDaily = async (data, userId) => {
    const { projectId, workingDate, steps, assignments } = data;

    if (!projectId || !workingDate || !Array.isArray(steps) || !Array.isArray(assignments)) {
        throw new handleMessage('Missing required fields (projectId, workingDate, steps, assignments)', StatusCodes.BAD_REQUEST);
    }

    const updated = await ProjectPlanDailyModel.findOneAndUpdate(
        { projectId, workingDate },
        {
            steps,
            assignments,
            modifiedBy: userId,
            modifiedDate: new Date(),
        },
        { upsert: true, new: true, runValidators: true }
    );

    return updated;
};

const getProjectPlanDaily = async (workingDate) => {

    if (!workingDate) {
        throw new handleMessage('Missing workingDate', StatusCodes.BAD_REQUEST);
    }

    const record = await ProjectPlanDailyModel.find({ workingDate });
    return record || null;
};

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