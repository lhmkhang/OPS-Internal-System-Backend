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
const { UserWorkingShiftModel } = require('../models/UserWorkingShiftModel');
const { UserLocationModel } = require('../models/UserLocationModel');
const { UserFloorModel } = require('../models/UserFloorModel');

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

// Hàm lấy toàn bộ user dưới quyền
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

// Hàm cung cấp thông tin cơ bản khi login
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

// Hàm lấy danh sách user theo role và 1 số dữ liệu khởi tạo ban đầu => backup
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
            .then(ids => ids.map(id => id.toString()));

        const pmUsers = await UserModel.find({ _id: { $in: allProjects } }).select('_id fullName');
        projectManagers = pmUsers.map(u => ({ id: u._id.toString(), name: u.fullName }));
    } else if (primaryRole.role === 'TEAM_LEADER') {
        const groups = await UserGroupModel.find({ teamLeader: userId }).select('_id');
        const groupIds = groups.map(g => g._id);

        usersQuery = { groupId: groupIds[0] };
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

        // Sửa lại groupNamesQuery để bao gồm cả userId của LINE_MANAGER
        groupNamesQuery = { teamLeader: { $in: [userId, ...subordinateIds] } };
        const projects = await ProjectsPlan.find({ projectManagers: { $in: subordinateIds } }).select('_id');
        const projectNames = projects.map(p => p.projectName);
        const assignments = await ProjectUsersAssignmentModel.find({ projectName: { $in: projectNames } }).select('userId');

        allUserIds = new Set(assignments.map(a => a.userId.toString()));

        const groups = await UserGroupModel.find({
            $or: [
                { teamLeader: { $in: subordinateIds } },
                { teamLeader: userId }
            ]
        }).select('_id');

        const groupIds = groups.map(g => g._id);
        const groupUsers = await UsersModel.find({ groupId: { $in: groupIds } }).select('_id');
        groupUsers.forEach(u => allUserIds.add(u._id.toString()));

        usersQuery = { _id: { $in: [...allUserIds] } };
    } else if (primaryRole.role === 'VIEWER') {
        usersQuery = { _id: userId };
        groupNamesQuery = { _id: null };
        projectManagers = [];
    }

    // Lấy danh sách users với các trường đã có và thêm 3 trường mới
    const users = await UsersModel.find(usersQuery).select('username fullName groupId group groupProjectId workingShift location floor');

    // Bổ sung usernameLeader cho các group
    const groupNames = await UserGroupModel.find(groupNamesQuery)
        .select('_id groupName teamLeader')
        .lean();

    // Lấy username từ teamLeader (bổ sung mới)
    const teamLeaderIds = groupNames.map(group => group.teamLeader).filter(Boolean);
    const teamLeaders = await UserModel.find({ _id: { $in: teamLeaderIds } })
        .select('_id username')
        .lean();

    // Map teamLeader ObjectId với username
    const teamLeaderMap = new Map(teamLeaders.map(leader => [leader._id.toString(), leader.username]));

    // Thêm usernameLeader vào groupNames
    const groupNamesWithUsername = groupNames.map(group => ({
        id: group._id,
        name: group.groupName,
        usernameLeader: group.teamLeader ? teamLeaderMap.get(group.teamLeader.toString()) || '' : ''
    }));

    const groupProjects = await GroupProjectsModel.find({})
        .select('_id name')
        .lean()
        .then(groups => groups.map(g => ({ id: g._id, name: g.name })));

    const customers = await CustomersPlanModel.find({})
        .select('_id customerName')
        .lean()
        .then(customers => customers.map(c => ({ id: c._id, name: c.customerName })));

    const locations = await UserLocationModel.find({})
        .select('_id location')
        .lean()
        .then(locations => locations.map(c => ({ id: c._id, location: c.location })));

    const floors = await UserFloorModel.find({})
        .select('_id floor')
        .lean()
        .then(floors => floors.map(c => ({ id: c._id, floor: c.floor })));

    const workingShifts = await UserWorkingShiftModel.find({})
        .select('_id workingShift totalWorkingHours')
        .lean()
        .then(workingShifts => workingShifts.map(c => ({ id: c._id, workingShift: c.workingShift, totalWorkingHours: c.totalWorkingHours })));

    // Trả về kết quả với 3 trường mới trong users
    return {
        users: users.map(user => ({
            userId: user._id,
            username: user.username,
            fullName: user.fullName,
            group: user.group,
            groupId: user.groupId,
            groupProjectId: user.groupProjectId,
            workingShift: user.workingShift, // Trường mới
            location: user.location,         // Trường mới
            floor: user.floor                // Trường mới
        })),
        groupNames: groupNamesWithUsername,  // Đã thêm usernameLeader
        groupProjects,
        customers,
        projectManagers,
        locations,
        floors,
        workingShifts
    };
};

// Hàm lấy FTE của users theo role
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
        const projects = await ProjectsPlan.find({ projectManagers: userId }).select('_id');
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
        // Thêm cả userId vào danh sách projectManagers
        const managerIds = [userId.toString(), ...subordinateIds];
        const projects = await ProjectsPlan.find({ projectManagers: { $in: managerIds } }).select('_id');
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
            fte: availability ? availability.fte : 0, // Mặc định 0 nếu không có dữ liệu
            ...(availability ? { workingDate: availability.workingDate } : { workingDate }) // Gán workingDate từ query nếu không có dữ liệu
        };
    });

    return { users: usersWithFte };
};

// Hàm lấy danh sách dự án đã được assign theo role
const getProjectAssigned = async (req) => {
    // const username = req.user;
    const userId = req.userId;
    const roles = await UserRoleModel.find({ userId: { $in: [userId] } }).sort({ priority: 1 });

    if (!roles.length) {
        throw new handleMessage('User has no roles assigned', StatusCodes.FORBIDDEN);
    }

    // if (!username) {
    //     throw new handleMessage('Username not provided', StatusCodes.UNAUTHORIZED);
    // }

    const currentUser = await UserModel.findOne({ _id: userId }).select('_id username');

    if (!currentUser) {
        throw new handleMessage('User not found', StatusCodes.NOT_FOUND);
    }
    // const userId = currentUser._id;

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

// Hàm lưu thông tin assign user vào step của các dự án
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

// Hàm lấy assignments và toàn bộ user dưới quyền theo role
const getProjectUserAssignments = async (req) => {
    const userId = req.userId;
    const roles = await UserRoleModel.find({ userId: { $in: [userId] } }).sort({ priority: 1 });

    const currentUser = await UserModel.findOne({ _id: userId }).select('_id username');

    if (!currentUser) {
        throw new handleMessage('User not found', StatusCodes.NOT_FOUND);
    }

    const primaryRole = roles.reduce((prev, curr) =>
        prev.priority < curr.priority ? prev : curr,
        roles[0] || { role: 'VIEWER', priority: Infinity }
    );

    let projectsQuery = {};
    let allUserIds = new Set();
    let projectListQuery;

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
        // Thêm cả userId vào danh sách projectManagers
        const managerIds = [userId.toString(), ...subordinateIds];
        projectsQuery = { projectManagers: { $in: managerIds } };
        const projects = await ProjectsPlan.find(projectsQuery).select('_id');
        const projectIds = projects.map(p => p._id);
        const assignments = await ProjectUsersAssignmentModel.find({ projectId: { $in: projectIds } }).select('userId');
        assignments.forEach(a => allUserIds.add(a.userId.toString()));

        const groups = await UserGroupModel.find({ teamLeader: { $in: subordinateIds } }).select('_id');
        const groupIds = groups.map(g => g._id);
        const groupUsers = await UsersModel.find({ groupId: { $in: groupIds } }).select('_id');
        groupUsers.forEach(u => allUserIds.add(u._id.toString()));
    } else if (primaryRole.role === 'TEAM_LEADER') {
        const groups = await UserGroupModel.find({ teamLeader: userId }).select('_id');
        const users = await UsersModel.find({ groupId: groups[0]._id }).select('_id')
        let projectIds = await ProjectUsersAssignmentModel.find({ userId: { $in: users } }).select('projectId')
        const usersId = users.map(u => u._id.toString());
        projectIds = projectIds.map(p => p.projectId.toString());
        projectsQuery = { userId: { $in: usersId } };
        projectListQuery = { _id: { $in: projectIds } };
    } else {
        projectsQuery = { projectManagers: null };
        projectListQuery = { _id: null }
    }


    let projects;
    if (primaryRole.role === 'TEAM_LEADER') {
        projects = await ProjectsPlan.find(projectListQuery).select('_id projectName');

    } else {
        projects = await ProjectsPlan.find(projectsQuery).select('_id projectName');
    }

    const projectIds = projects.map(p => p._id);
    const projectMap = new Map(projects.map(p => [p._id.toString(), p.projectName]));

    let assignments;

    if (primaryRole.role === 'TEAM_LEADER' || primaryRole.role === 'VIEWER') {
        assignments = await ProjectUsersAssignmentModel.find(projectsQuery).select('userId projectId steps').lean();
    } else {
        assignments = await ProjectUsersAssignmentModel.find({ projectId: { $in: projectIds } }).select('userId projectId steps').lean();
    }

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

// Tính tổng FTE cho mỗi user từ tất cả dự án trừ dự án hiện tại
const getTotalFteByUserExcludingProject = async (projectId, workingDate, session) => {
    // Sử dụng locking để đọc dữ liệu mới nhất từ DB, tránh race condition
    const plans = await ProjectPlanDailyModel.find(
        { workingDate, projectId: { $ne: projectId } },
        null,
        { session, readPreference: 'primary' }
    );

    const totalFteByUser = {};

    plans.forEach(plan => {
        plan.assignments.forEach(assignment => {
            const userIdStr = assignment.userId.toString();
            if (!totalFteByUser[userIdStr]) totalFteByUser[userIdStr] = 0;
            totalFteByUser[userIdStr] += assignment.fte || 0;
        });
    });

    return totalFteByUser;
};

// Tính tổng FTE mới cho mỗi user từ assignments trong request
const getNewFteByUserForProject = (assignments) => {
    const newFteByUser = {};

    assignments.forEach(({ userId, fte }) => {
        const userIdStr = userId.toString();
        if (!newFteByUser[userIdStr]) newFteByUser[userIdStr] = 0;
        newFteByUser[userIdStr] += fte || 0;
    });

    return newFteByUser;
};

const mergeAssignmentsWithChanges = (oldAssignments, newAssignments) => {
    const merged = [...oldAssignments];
    newAssignments.forEach(newAssign => {
        const existingIndex = merged.findIndex(
            old => old.userId.toString() === newAssign.userId.toString() && old.stepName === newAssign.stepName
        );
        if (existingIndex !== -1) {
            // Cập nhật FTE nếu bước đã tồn tại
            merged[existingIndex].fte = newAssign.fte;
        } else {
            // Thêm mới nếu bước chưa tồn tại
            merged.push(newAssign);
        }
    });
    return merged.filter(a => a.fte > 0); // Loại bỏ các bước có FTE = 0
};

const upsertProjectPlanDaily = async (data, userId) => {
    const { projectId, workingDate, steps, assignments, groupPlans } = data;

    // Kiểm tra đầu vào
    if (!projectId || !workingDate || !Array.isArray(assignments)) {
        throw new handleMessage('Missing required fields (projectId, workingDate, assignments)', StatusCodes.BAD_REQUEST);
    }
    if (typeof projectId !== 'string') {
        throw new handleMessage('projectId must be a string', StatusCodes.BAD_REQUEST);
    }

    // Sử dụng session với readConcern "snapshot" để đảm bảo consistent read
    const session = await mongoose.startSession();

    try {
        // Bắt đầu transaction với readConcern "snapshot" để đảm bảo consistent read
        session.startTransaction({
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' }
        });

        // 1. Lấy bản ghi hiện tại
        const existingPlan = await ProjectPlanDailyModel.findOne(
            { projectId, workingDate },
            null,
            { session }
        );
        const oldAssignments = existingPlan ? existingPlan.assignments : [];
        const oldGroupPlans = existingPlan ? existingPlan.groupPlans : [];

        // 2. Tính tổng FTE cho mỗi user từ tất cả các dự án khác - đảm bảo đọc dữ liệu mới nhất
        const fteByUserFromOtherProjects = await getTotalFteByUserExcludingProject(projectId, workingDate, session);

        // 3. Tính tổng FTE cho mỗi user từ request này
        // Chỉ tính các assignment có fte > 0 để validate
        const validAssignments = assignments.filter(assignment => (assignment.fte || 0) > 0);
        const fteByUserFromRequest = getNewFteByUserForProject(validAssignments);

        // 4. Validate tổng FTE cho mỗi user
        const errors = [];
        for (const [userIdStr, fteFromRequest] of Object.entries(fteByUserFromRequest)) {
            const fteFromOtherProjects = fteByUserFromOtherProjects[userIdStr] || 0;
            const totalFTE = fteFromOtherProjects + fteFromRequest;

            // Log để debug
            console.log(`User ${userIdStr}: FTE from other projects = ${fteFromOtherProjects}, FTE from request = ${fteFromRequest}, Total = ${totalFTE}`);

            if (totalFTE > 1) {
                errors.push({
                    userId: userIdStr,
                    fteFromOtherProjects: fteFromOtherProjects.toFixed(2),
                    fteFromRequest: fteFromRequest.toFixed(2),
                    totalFTE: totalFTE.toFixed(2),
                });
            }
        }

        if (errors.length > 0) {
            const errorMessage = errors
                .map(e => `User ${e.userId}: Other projects ${e.fteFromOtherProjects}, This project ${e.fteFromRequest}, Total ${e.totalFTE} exceeds 1`)
                .join('; ');
            throw new handleMessage(`FTE validation failed: ${errorMessage}`, StatusCodes.BAD_REQUEST);
        }

        // 5. Xử lý assignment để loại bỏ các assignment có fte = 0
        const updatedAssignments = [];

        // 5.1 Xử lý các assignment đã có trong database
        assignments.forEach(newAssignment => {
            // Chỉ thêm các assignment có fte > 0
            if ((newAssignment.fte || 0) > 0) {
                updatedAssignments.push({
                    userId: newAssignment.userId,
                    stepName: newAssignment.stepName,
                    layout: newAssignment.layout || '',
                    section: newAssignment.section || '',
                    fte: newAssignment.fte
                });
            } else {
                // Log việc xóa assignment nếu fte = 0
                console.log(`Removing assignment for user ${newAssignment.userId}, step ${newAssignment.stepName} with fte = 0`);
            }
        });

        // 6. Xử lý groupPlans
        let finalGroupPlans = [];

        // Nếu client gửi groupPlans, cập nhật/xóa theo yêu cầu client
        if (Array.isArray(groupPlans)) {
            // Trường hợp client gửi từ resource-allocation (không có groupPlans) hoặc volume-forecast (có groupPlans)
            if (groupPlans.length > 0) {
                // 6.1. Lọc ra các steps được gửi trong request hiện tại
                const stepNamesInRequest = new Set(groupPlans.map(plan => plan.stepName));

                // 6.2. Giữ lại các group plans của các steps không được gửi trong request hiện tại
                const unchangedGroupPlans = oldGroupPlans.filter(plan => !stepNamesInRequest.has(plan.stepName));

                // 6.3. Xử lý các group plans mới cho các steps trong request
                const updatedGroupPlans = [];
                groupPlans.forEach(plan => {
                    // Chỉ thêm vào nếu có allocatedVolume > 0
                    if (plan && Number(plan.allocatedVolume) > 0) {
                        updatedGroupPlans.push({
                            groupId: plan.groupId,
                            stepName: plan.stepName,
                            allocatedVolume: Number(plan.allocatedVolume) || 0,
                            realVolume: Number(plan.realVolume) || 0,
                            totalWorkingTime: Number(plan.totalWorkingTime) || 0,
                            overtime: plan.overtime || false,
                            realSpeed: plan.realSpeed || '',
                            layout: plan.layout || '',
                            section: plan.section || '',
                            unit: plan.unit || '',
                            timePerDoc: Number(plan.timePerDoc) || 0,
                            productiveHours: Number(plan.productiveHours) || 0
                        });
                    } else if (plan) {
                        // Log việc xóa groupPlan nếu allocatedVolume = 0
                        console.log(`Removing group plan for group ${plan.groupId}, step ${plan.stepName} with allocatedVolume = 0`);
                    }
                });

                // 6.4. Hợp nhất danh sách: giữ nguyên các steps không thay đổi và cập nhật/xóa các steps được gửi
                finalGroupPlans = [...unchangedGroupPlans, ...updatedGroupPlans];
            } else {
                // Client không gửi groupPlans - giữ nguyên groupPlans cũ
                finalGroupPlans = oldGroupPlans;
            }
        } else {
            // Nếu client không gửi groupPlans array (undefined/null), giữ nguyên groupPlans cũ
            finalGroupPlans = oldGroupPlans;
        }

        // 7. Lưu dữ liệu với version check để đảm bảo không có race condition
        const updated = await ProjectPlanDailyModel.findOneAndUpdate(
            { projectId, workingDate },
            {
                steps,
                assignments: updatedAssignments,
                groupPlans: finalGroupPlans,
                modifiedBy: userId,
                modifiedDate: new Date(),
            },
            { upsert: true, new: true, runValidators: true, session }
        );

        // Double-check sau khi lưu để đảm bảo không có race condition
        const finalFteCheck = await verifyTotalFteNotExceeded(workingDate, session);
        if (!finalFteCheck.valid) {
            throw new handleMessage(`FTE validation failed after save: ${finalFteCheck.errorMessage}`, StatusCodes.CONFLICT);
        }

        // 8. Commit transaction
        await session.commitTransaction();
        return updated;
    } catch (error) {
        // 9. Rollback nếu có lỗi
        await session.abortTransaction();
        throw error;
    } finally {
        // 10. Đóng session
        session.endSession();
    }
};

// Hàm mới để kiểm tra xem có user nào bị assign quá 1 FTE trong một ngày không
const verifyTotalFteNotExceeded = async (workingDate, session) => {
    // Lấy tất cả plan của ngày đó để kiểm tra
    const allPlansForDay = await ProjectPlanDailyModel.find(
        { workingDate },
        null,
        { session, readPreference: 'primary' }
    );

    // Tính tổng FTE cho mỗi user từ tất cả project
    const totalFteByUser = {};
    allPlansForDay.forEach(plan => {
        plan.assignments.forEach(assignment => {
            const userIdStr = assignment.userId.toString();
            if (!totalFteByUser[userIdStr]) totalFteByUser[userIdStr] = 0;
            totalFteByUser[userIdStr] += assignment.fte || 0;
        });
    });

    // Kiểm tra xem có user nào vượt quá 1 FTE không
    const errors = [];
    for (const [userIdStr, totalFte] of Object.entries(totalFteByUser)) {
        if (totalFte > 1) {
            errors.push({
                userId: userIdStr,
                totalFTE: totalFte.toFixed(2)
            });
        }
    }

    if (errors.length > 0) {
        const errorMessage = errors
            .map(e => `User ${e.userId}: Total FTE across all projects ${e.totalFTE} exceeds 1`)
            .join('; ');
        return { valid: false, errorMessage };
    }

    return { valid: true };
};

const getProjectPlanDaily = async (workingDate) => {
    if (!workingDate) {
        throw new handleMessage('Missing workingDate', StatusCodes.BAD_REQUEST);
    }
    const record = await ProjectPlanDailyModel.find({ workingDate });
    // Đảm bảo trả về cả groupPlans nếu có
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