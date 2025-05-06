const dotenv = require("dotenv").config();
const logger = require("../helpers/logger");
const loggerInfo = logger.getLogger("infoLogger");
const JWTService = require("./JWTServices");
const bcryptServices = require("./bcryptServices");
const { UserGroupModel } = require('../models/UserGroupModel')
const { UserModel } = require("../models/userModel");
const { UsersModel } = require("../models/usersModel");
const { UserRoleModel } = require("../models/UserRoleModel");
const { UserAvailabilityModel } = require("../models/userAvailabilityModel");
const { GroupProjectsModel } = require("../models/GroupProjectsModel");
const { StatusCodes } = require("http-status-codes");
const handleMessage = require("../utils/HandleMessage");
const MESSAGE = require("../utils/message");
const mongoose = require('mongoose');

const createNewUser = async (username, password, fullName, res, next) => {
  try {
    const existingUser = await UserModel.findOne({ username: username });

    // Username or password is empty
    if (!username || !password || !fullName)
      return next(
        new handleMessage(
          MESSAGE.AUTH.CREATE_USER.EMPTY_CREDENTIALS,
          StatusCodes.BAD_REQUEST
        )
      );

    // User already exists
    if (existingUser)
      return next(
        new handleMessage(
          MESSAGE.AUTH.CREATE_USER.USER_CONFLICT,
          StatusCodes.CONFLICT
        )
      );

    //Store username and hash password in the database
    const hashUserPassword = bcryptServices.hashPassword(password);
    const newUser = await UserModel.create({ username, password: hashUserPassword, fullName });

    //Push default user role is VIEWER
    const userId = newUser._id;
    await UserRoleModel.findOneAndUpdate({ role: "VIEWER" }, { $push: { userId } });

    return res.send({
      status: "success",
      code: StatusCodes.OK,
      message: MESSAGE.AUTH.CREATE_USER.CREATE_USER_SUCCESS,
    });
  } catch (error) {
    next(error);
  }
};

const userLogin = async (username, password, req, res, next) => {
  try {
    // Kiểm tra đầu vào
    if (!username || !password)
      return next(
        new handleMessage(
          MESSAGE.AUTH.LOGIN.EMPTY_CREDENTIALS,
          StatusCodes.BAD_REQUEST
        )
      );

    // Tìm user
    const foundUser = await UserModel.findOne({ username });
    if (!foundUser)
      return next(
        new handleMessage(
          MESSAGE.AUTH.LOGIN.USER_NOT_FOUND,
          StatusCodes.UNAUTHORIZED
        )
      );

    // Kiểm tra password
    const match = bcryptServices.comparePassword(password, foundUser.password);
    if (!match)
      return next(
        new handleMessage(
          MESSAGE.AUTH.LOGIN.INVALID_CREDENTIALS,
          StatusCodes.UNAUTHORIZED
        )
      );

    loggerInfo.info("Login successful");

    const userId = foundUser._id.toString();

    // Lấy tất cả role của user từ user_roles

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

    /* const userRoles = await UserRoleModel.find({ userId }).sort({ priority: 1 }); // Priority thấp = ưu tiên cao

    if (!userRoles.length)
      return next(
        new handleMessage(
          "User has no roles assigned",
          StatusCodes.FORBIDDEN
        )
      ); */

    // Chuẩn bị dữ liệu roles cho token
    /*  const roles = userRoles.map(role => ({
       _id: role._id,
       role: role.role,
       priority: role.priority,
     })); */

    // Tạo accessToken và refreshToken
    const accessToken = JWTService.createToken({
      UserInfo: {
        userId,
        username,
        roles: [primaryRole],
        fullName: foundUser.fullName
      },
    });

    const refreshToken = JWTService.createRefreshToken({
      UserInfo: {
        userId,
        username,
        roles: [primaryRole],
        fullName: foundUser.fullName
      },
    });

    // Cập nhật refreshToken vào DB
    await UserModel.findByIdAndUpdate(userId, { refreshToken });

    return res.json({
      accessToken,
      refreshToken,
      roles: [primaryRole], // Trả mảng roles để UI biết
    });
  } catch (err) {
    next(err);
  }
};

const userLogout = async (req, res, next) => {
  try {
    // Lấy userId từ req (được gắn bởi middleware verifyJWTToken)
    const userId = req.userId;
    if (!userId) {
      return next(
        new handleMessage(
          MESSAGE.AUTH.LOG_OUT.LOG_OUT_ERROR,
          StatusCodes.UNAUTHORIZED
        )
      );
    }

    // Tìm user và xóa refreshToken
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { refreshToken: '' },
      { new: true }
    );

    if (!user) {
      return next(
        new handleMessage(
          MESSAGE.AUTH.LOG_OUT.LOG_OUT_ERROR,
          StatusCodes.NOT_FOUND
        )
      );
    }

    // Trả về phản hồi thành công
    return res.status(StatusCodes.OK).json({
      status: 'success',
      code: StatusCodes.OK,
      message: MESSAGE.AUTH.LOG_OUT.LOG_OUT_SUCCESS,
    });
  } catch (error) {
    next(error);
  }
};

const changePassword = async (username, password, req, res, next) => {
  try {
    // const userInToken = req.user;
    // const userInRequestBody = req.body.username;

    // if (userInToken !== userInRequestBody)
    //   return next(
    //     new handleMessage(
    //       MESSAGE.AUTH.CHANGE_PASSWORD.UNAUTHORIZED,
    //       StatusCodes.UNAUTHORIZED
    //     )
    //   );
    // Username or password is empty
    if (!username || !password)
      return next(
        new handleMessage(
          MESSAGE.AUTH.CHANGE_PASSWORD.EMPTY_CREDENTIALS,
          StatusCodes.BAD_REQUEST
        )
      );

    const existingUser = await UserModel.findOne({ username: username });

    // User does not exist in database
    if (!existingUser)
      return next(
        new handleMessage(
          MESSAGE.AUTH.CHANGE_PASSWORD.USER_NOT_FOUND,
          StatusCodes.BAD_REQUEST
        )
      );

    //Hash user's password
    const hashUserPassword = bcryptServices.hashPassword(password);

    await UserModel.findOneAndUpdate(
      { username: username },
      { password: hashUserPassword }
    );
    return next(new handleMessage("Change password successful!", 200));
  } catch (error) {
    next(error);
  }
};

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

// Cập nhật hoặc tạo user availability
const updateUserAvailability = async (userId, fte, workingDate, res, next) => {
  try {
    // Kiểm tra dữ liệu đầu vào
    if (!userId || fte === undefined || !workingDate) {
      return next(
        new handleMessage(
          'Missing required fields (userId, fte, workingDate)',
          StatusCodes.BAD_REQUEST
        )
      );
    }

    // Kiểm tra user có tồn tại không
    const user = await UsersModel.findById(userId);
    if (!user) {
      return next(
        new handleMessage(
          'User not found',
          StatusCodes.NOT_FOUND
        )
      );
    }

    // Tìm bản ghi availability hiện có
    const existingAvailability = await UserAvailabilityModel.findOne({
      userId,
      workingDate,
    });

    // Nếu bản ghi đã tồn tại, kiểm tra xem fte có thay đổi không
    if (existingAvailability) {
      if (existingAvailability.fte === fte) {
        return res.send({
          status: 'success',
          code: StatusCodes.OK,
          message: 'No changes detected in user availability',
          data: {
            ...existingAvailability.toObject(),
            username: user.username,
            fullName: user.fullName,
            groupName: user.group,
            groupProjectId: user.groupProjectId,
            workingShift: user.workingShift,
            location: user.location,
            floor: user.floor,
          },
        });
      }
    }

    // Nếu không tồn tại hoặc fte thay đổi, cập nhật/tạo mới
    const availability = await UserAvailabilityModel.findOneAndUpdate(
      { userId, workingDate },
      {
        userId,
        fte,
        workingDate,
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    loggerInfo.info(`Availability updated for user ${userId} on ${workingDate}`);
    return res.send({
      status: 'success',
      code: StatusCodes.OK,
      message: 'User availability updated successfully',
      data: {
        ...availability.toObject(),
        username: user.username,
        fullName: user.fullName,
        groupName: user.group,
        groupProjectId: user.groupProjectId,
        workingShift: user.workingShift,
        location: user.location,
        floor: user.floor,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getAllUsers = async (res, next) => {
  try {
    const users = await UsersModel.find()
    return res.send({
      status: 'success',
      code: StatusCodes.OK,
      message: 'Users retrieved successfully',
      data: users.map(user => ({
        userId: user._id,
        username: user.username,
        fullName: user.fullName,
        group: user.group,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// Xóa user từ project_users dựa trên userId
const deleteProjectUser = async (userId, res, next) => {
  try {
    // Kiểm tra dữ liệu đầu vào
    console.log(userId);

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

    console.log(userId);

    // Tìm và xóa user trong project_users
    const user = await UsersModel.findByIdAndDelete(userId);
    if (!user) {
      return next(
        new handleMessage('User not found', StatusCodes.NOT_FOUND)
      );
    }

    loggerInfo.info(`Project user ${user.username} deleted successfully`);
    return res.send({
      status: 'success',
      code: StatusCodes.OK,
      message: 'Project user deleted successfully',
      data: {
        userId: user._id,
        username: user.username,
      },
    });
  } catch (error) {
    next(error);
  }
};


module.exports = {
  createNewUser,
  changePassword,
  userLogin,
  userLogout,
  createProjectUser,
  updateUserAvailability,
  getAllUsers,
  deleteProjectUser,
  updateProjectUser
};