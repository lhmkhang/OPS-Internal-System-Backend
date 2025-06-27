const dotenv = require("dotenv").config();
const logger = require("../../helpers/logger");
const loggerInfo = logger.getLogger("infoLogger");
const { schema: UserGroupSchema, collectionName: UserGroupCollectionName } = require('../../models/UserGroupModel')
const { schema: UsersSchema, collectionName: UsersCollectionName } = require("../../models/usersModel");
const { schema: UserAvailabilitySchema, collectionName: UserAvailabilityCollectionName } = require("../../models/userAvailabilityModel");
const { schema: GroupProjectsSchema, collectionName: GroupProjectsCollectionName } = require("../../models/GroupProjectsModel");
const { schema: UserSchema, collectionName: UserCollectionName } = require("../../models/userModel");
const { schema: UserRoleSchema, collectionName: UserRoleCollectionName } = require('../../models/UserRoleModel');
const { schema: CustomersPlanSchema, collectionName: CustomersPlanCollectionName } = require('../../models/CustomersPlanModel');
const { schema: UserWorkingShiftSchema, collectionName: UserWorkingShiftCollectionName } = require('../../models/UserWorkingShiftModel');
const { schema: UserLocationSchema, collectionName: UserLocationCollectionName } = require('../../models/UserLocationModel');
const { schema: UserFloorSchema, collectionName: UserFloorCollectionName } = require('../../models/UserFloorModel');
const ProjectsPlanSchema = require('../../models/ProjectsPlanModel');
const { schema: ProjectUsersAssignmentSchema, collectionName: ProjectUsersAssignmentCollectionName } = require('../../models/ProjectUsersAssignmentModel');
const { StatusCodes } = require("http-status-codes");
const handleMessage = require("../../utils/HandleMessage");
const MESSAGE = require("../../utils/message");
const mongoose = require('mongoose');
const { getConnection } = require('../../helpers/connectDB');

// Lấy connection default
const connection = getConnection('default');

// Tạo model từ schema
const UserGroupModel = connection.model(UserGroupCollectionName, UserGroupSchema);
const UserModel = connection.model(UserCollectionName, UserSchema);
const UsersModel = connection.model(UsersCollectionName, UsersSchema);
const UserAvailabilityModel = connection.model(UserAvailabilityCollectionName, UserAvailabilitySchema);
const GroupProjectsModel = connection.model(GroupProjectsCollectionName, GroupProjectsSchema);
const UserRoleModel = connection.model(UserRoleCollectionName, UserRoleSchema);
const CustomersPlanModel = connection.model(CustomersPlanCollectionName, CustomersPlanSchema);
const UserWorkingShiftModel = connection.model(UserWorkingShiftCollectionName, UserWorkingShiftSchema);
const UserLocationModel = connection.model(UserLocationCollectionName, UserLocationSchema);
const UserFloorModel = connection.model(UserFloorCollectionName, UserFloorSchema);
const ProjectsPlan = connection.model(ProjectsPlanSchema.collectionName, ProjectsPlanSchema.schema);
const ProjectUsersAssignmentModel = connection.model(ProjectUsersAssignmentCollectionName, ProjectUsersAssignmentSchema);

// Tạo user mới cho dự án
const createProjectUser = async (username, fullName, group, groupProjectId, workingShift, location, floor, res, next) => {
    try {
        // Kiểm tra dữ liệu đầu vào
        if (!username || !fullName) {
            return next(
                new handleMessage('Username and fullName are required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!group) {
            return next(
                new handleMessage('Group name is required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!groupProjectId) {
            return next(
                new handleMessage('Group project is required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!workingShift) {
            return next(
                new handleMessage('Working shift is required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!location) {
            return next(
                new handleMessage('Location is required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!floor) {
            return next(
                new handleMessage('Floor is required', StatusCodes.BAD_REQUEST)
            );
        }

        // Kiểm tra groupProjectId có hợp lệ và tồn tại trong GroupProjectsModel
        if (!mongoose.Types.ObjectId.isValid(groupProjectId)) {
            return next(
                new handleMessage('Invalid group project ID', StatusCodes.BAD_REQUEST)
            );
        }
        const groupProject = await GroupProjectsModel.findById(groupProjectId);
        if (!groupProject) {
            return next(
                new handleMessage('Group project not found', StatusCodes.NOT_FOUND)
            );
        }

        // Kiểm tra user đã tồn tại trong project_users
        const existingUser = await UsersModel.findOne({ username });
        if (existingUser) {
            return next(
                new handleMessage('Username already exists', StatusCodes.CONFLICT)
            );
        }

        let groupId = null;
        let teamLeaderId = null;

        // Kiểm tra group trong project_user_groups
        let existingGroup = await UserGroupModel.findOne({ groupName: group });
        if (existingGroup) {
            // Trường hợp 1: Group có sẵn
            groupId = existingGroup._id;
            teamLeaderId = existingGroup.teamLeader;
        } else {
            // Trường hợp 2: Group mới (custom)
            const teamLeaderUser = await UserModel.findOne({ fullName: group });
            if (!teamLeaderUser) {
                return next(
                    new handleMessage(
                        `No user found with fullName '${group}' to set as team leader`,
                        StatusCodes.BAD_REQUEST
                    )
                );
            }
            teamLeaderId = teamLeaderUser._id;

            // Tạo group mới
            const newGroup = await UserGroupModel.create({
                groupName: group,
                teamLeader: teamLeaderId,
            });
            groupId = newGroup._id;
        }

        // Tạo user mới trong project_users với tất cả các field
        const newUser = await UsersModel.create({
            username,
            fullName,
            group,
            groupId,
            groupProjectId,
            workingShift,
            location,
            floor,
        });

        loggerInfo.info(`Project user ${username} created successfully`);

        return res.send({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Project user created successfully',
            data: {
                userId: newUser._id,
                username: newUser.username,
                fullName: newUser.fullName,
                group: newUser.group,
                groupId: newUser.groupId,
                groupProjectId: newUser.groupProjectId,
                workingShift: newUser.workingShift,
                location: newUser.location,
                floor: newUser.floor,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Cập nhật thông tin user trong project_users dựa trên userId
const updateProjectUser = async (userId, username, fullName, group, groupProjectId, workingShift, location, floor, res, next) => {
    try {
        // Kiểm tra dữ liệu đầu vào
        if (!userId) {
            return next(
                new handleMessage('User ID is required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!fullName) {
            return next(
                new handleMessage('fullName is required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!group) {
            return next(
                new handleMessage('Group name is required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!groupProjectId) {
            return next(
                new handleMessage('Group project is required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!workingShift) {
            return next(
                new handleMessage('Working shift is required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!location) {
            return next(
                new handleMessage('Location is required', StatusCodes.BAD_REQUEST)
            );
        }
        if (!floor) {
            return next(
                new handleMessage('Floor is required', StatusCodes.BAD_REQUEST)
            );
        }

        // Kiểm tra userId có hợp lệ không
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return next(
                new handleMessage('Invalid user ID', StatusCodes.BAD_REQUEST)
            );
        }

        // Kiểm tra user tồn tại trong project_users
        const existingUser = await UsersModel.findById(userId);
        if (!existingUser) {
            return next(
                new handleMessage('User not found', StatusCodes.NOT_FOUND)
            );
        }

        // Kiểm tra groupProjectId có hợp lệ và tồn tại trong GroupProjectsModel
        if (!mongoose.Types.ObjectId.isValid(groupProjectId)) {
            return next(
                new handleMessage('Invalid group project ID', StatusCodes.BAD_REQUEST)
            );
        }
        const groupProject = await GroupProjectsModel.findById(groupProjectId);
        if (!groupProject) {
            return next(
                new handleMessage('Group project not found', StatusCodes.NOT_FOUND)
            );
        }

        // Kiểm tra username mới có bị trùng với user khác không
        const duplicateUser = await UsersModel.findOne({ username, _id: { $ne: userId } });
        if (duplicateUser) {
            return next(
                new handleMessage('Username already exists', StatusCodes.CONFLICT)
            );
        }

        let groupId = null;
        let teamLeaderId = null;

        // Kiểm tra group trong project_user_groups
        let existingGroup = await UserGroupModel.findOne({ groupName: group });
        if (existingGroup) {
            // Trường hợp 1: Group có sẵn
            groupId = existingGroup._id;
            teamLeaderId = existingGroup.teamLeader;
        } else {
            // Trường hợp 2: Group mới (custom)
            const teamLeaderUser = await UserModel.findOne({ fullName: group });
            if (!teamLeaderUser) {
                return next(
                    new handleMessage(
                        `No user found with fullName '${group}' to set as team leader`,
                        StatusCodes.BAD_REQUEST
                    )
                );
            }
            teamLeaderId = teamLeaderUser._id;

            // Tạo group mới
            const newGroup = await UserGroupModel.create({
                groupName: group,
                teamLeader: teamLeaderId,
            });
            groupId = newGroup._id;
        }

        // Cập nhật user trong project_users với tất cả các field
        const updatedUser = await UsersModel.findByIdAndUpdate(
            userId,
            {
                username,
                fullName,
                group,
                groupId,
                groupProjectId,
                workingShift,
                location,
                floor,
            },
            { new: true } // Trả về document đã cập nhật
        );

        loggerInfo.info(`Project user ${username} updated successfully`);
        return res.send({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Project user updated successfully',
            data: {
                userId: updatedUser._id,
                username: updatedUser.username,
                fullName: updatedUser.fullName,
                group: updatedUser.group,
                groupId: updatedUser.groupId,
                groupProjectId: updatedUser.groupProjectId,
                workingShift: updatedUser.workingShift,
                location: updatedUser.location,
                floor: updatedUser.floor,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Cập nhật FTE của user theo ngày
const updateUserAvailability = async (userId, fte, workingDate, res, next) => {
    try {
        // Kiểm tra dữ liệu đầu vào
        if (!userId || !fte || !workingDate) {
            return next(
                new handleMessage('userId, fte, and workingDate are required', StatusCodes.BAD_REQUEST)
            );
        }

        // Kiểm tra userId có hợp lệ không
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return next(
                new handleMessage('Invalid user ID', StatusCodes.BAD_REQUEST)
            );
        }

        // Kiểm tra user tồn tại trong project_users
        const existingUser = await UsersModel.findById(userId);
        if (!existingUser) {
            return next(
                new handleMessage('User not found', StatusCodes.NOT_FOUND)
            );
        }

        // Kiểm tra FTE trong khoảng hợp lệ (0 đến 1)
        if (fte < 0 || fte > 1) {
            return next(
                new handleMessage('FTE must be between 0 and 1', StatusCodes.BAD_REQUEST)
            );
        }

        // Kiểm tra workingDate có đúng định dạng không (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(workingDate)) {
            return next(
                new handleMessage('workingDate must be in YYYY-MM-DD format', StatusCodes.BAD_REQUEST)
            );
        }

        // Cập nhật hoặc tạo mới user availability
        const filter = { userId: new mongoose.Types.ObjectId(userId), workingDate };
        const update = { fte };
        const options = { upsert: true, new: true };

        const result = await UserAvailabilityModel.findOneAndUpdate(filter, update, options);

        loggerInfo.info(`User availability updated: userId=${userId}, workingDate=${workingDate}, fte=${fte}`);

        return res.send({
            status: 'success',
            code: StatusCodes.OK,
            message: 'User availability updated successfully',
            data: {
                userId: result.userId,
                workingDate: result.workingDate,
                fte: result.fte,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Lấy toàn bộ user trong project_users
const getAllUsers = async (res, next) => {
    try {
        const users = await UsersModel.find({}).select('-__v');

        return res.send({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Users retrieved successfully',
            data: users,
        });
    } catch (error) {
        next(error);
    }
};

// Xóa user trong project_users
const deleteProjectUser = async (userId, res, next) => {
    try {
        // Kiểm tra dữ liệu đầu vào
        if (!userId) {
            return next(
                new handleMessage('User ID is required', StatusCodes.BAD_REQUEST)
            );
        }

        // Kiểm tra userId có hợp lệ không
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return next(
                new handleMessage('Invalid user ID', StatusCodes.BAD_REQUEST)
            );
        }

        // Kiểm tra user tồn tại trong project_users
        const existingUser = await UsersModel.findById(userId);
        if (!existingUser) {
            return next(
                new handleMessage('User not found', StatusCodes.NOT_FOUND)
            );
        }

        // Xóa user khỏi project_users
        await UsersModel.findByIdAndDelete(userId);

        // Xóa luôn user availability records
        await UserAvailabilityModel.deleteMany({ userId });

        loggerInfo.info(`Project user ${existingUser.username} deleted successfully`);

        return res.send({
            status: 'success',
            code: StatusCodes.OK,
            message: 'Project user deleted successfully',
            data: {
                userId: existingUser._id,
                username: existingUser.username,
            },
        });
    } catch (error) {
        next(error);
    }
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

// Hàm lấy danh sách user theo role và 1 số dữ liệu khởi tạo ban đầu
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

// Hàm lưu thông tin assign user vào step của các dự án
const assignUserToProjectSteps = async (data) => {
    const { userId, projectId, steps } = data;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(projectId)) {
        throw new handleMessage('Invalid user ID or project ID', StatusCodes.BAD_REQUEST);
    }

    const project = await ProjectsPlan.findById(projectId);
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

    return assignments.map(assignment => {
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

module.exports = {
    createProjectUser,
    updateProjectUser,
    updateUserAvailability,
    getAllUsers,
    deleteProjectUser,
    getAllSubordinateIds,
    getUsersByRole,
    getResourceAvailability,
    assignUserToProjectSteps,
    getProjectUserAssignments,
    deleteProjectUserAssignment
}; 