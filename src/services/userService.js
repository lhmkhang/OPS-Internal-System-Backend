const dotenv = require("dotenv").config();
const logger = require("../helpers/logger");
const loggerInfo = logger.getLogger("infoLogger");
const JWTService = require("./JWTServices");
const bcryptServices = require("./bcryptServices");
const { schema: UserGroupSchema, collectionName: UserGroupCollectionName } = require('../models/UserGroupModel')
const { schema: UserSchema, collectionName: UserCollectionName } = require("../models/userModel");
const { schema: UsersSchema, collectionName: UsersCollectionName } = require("../models/usersModel");
const { schema: UserRoleSchema, collectionName: UserRoleCollectionName } = require("../models/UserRoleModel");
const { schema: UserAvailabilitySchema, collectionName: UserAvailabilityCollectionName } = require("../models/userAvailabilityModel");
const { schema: GroupProjectsSchema, collectionName: GroupProjectsCollectionName } = require("../models/GroupProjectsModel");
const { StatusCodes } = require("http-status-codes");
const handleMessage = require("../utils/HandleMessage");
const MESSAGE = require("../utils/message");
const mongoose = require('mongoose');
const { getConnection } = require('../helpers/connectDB');

// Lấy connection default
const connection = getConnection('default');

// Tạo model từ schema
const UserGroupModel = connection.model(UserGroupCollectionName, UserGroupSchema);
const UserModel = connection.model(UserCollectionName, UserSchema);
const UsersModel = connection.model(UsersCollectionName, UsersSchema);
const UserRoleModel = connection.model(UserRoleCollectionName, UserRoleSchema);
const UserAvailabilityModel = connection.model(UserAvailabilityCollectionName, UserAvailabilitySchema);
const GroupProjectsModel = connection.model(GroupProjectsCollectionName, GroupProjectsSchema);

// Authentication functions moved to services/auth/authService.js

// userLogin moved to services/auth/authService.js

// userLogout moved to services/auth/authService.js

// All authentication functions moved to services/auth/authService.js
// All operation-planning user management functions moved to services/operation-planning/userManagementService.js


// Note: All functions moved to dedicated modules:
// - Authentication functions -> services/auth/authService.js
// - User management functions -> services/operation-planning/userManagementService.js

// Keep some basic structure for backward compatibility until full migration
module.exports = {
  // Empty service - all functions moved to dedicated modules
  // This file will be removed in future refactoring phases
};