const dotenv = require("dotenv").config();
const logger = require("../../helpers/logger");
const loggerInfo = logger.getLogger("infoLogger");
const JWTService = require("../JWTServices");
const bcryptServices = require("../bcryptServices");
const { schema: UserSchema, collectionName: UserCollectionName } = require("../../models/userModel");
const { schema: UserRoleSchema, collectionName: UserRoleCollectionName } = require("../../models/UserRoleModel");
const { StatusCodes } = require("http-status-codes");
const handleMessage = require("../../utils/HandleMessage");
const MESSAGE = require("../../utils/message");
const mongoose = require('mongoose');
const { getConnection } = require('../../helpers/connectDB');

// Lấy connection default
const connection = getConnection('default');

// Tạo model từ schema
const UserModel = connection.model(UserCollectionName, UserSchema);
const UserRoleModel = connection.model(UserRoleCollectionName, UserRoleSchema);

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

        const userId = foundUser._id.toString();
        const userRoles = await UserRoleModel.find({ userId: { $in: [userId] } }).select('role priority -_id').lean();

        if (!userRoles || userRoles.length === 0) {
            return {
                currentUser: {
                    userId,
                    username: foundUser.username,
                    roles: [{ role: 'VIEWER', priority: Infinity }],
                }
            };
        }

        const primaryRole = userRoles.reduce((prev, curr) =>
            prev.priority < curr.priority ? prev : curr,
            userRoles[0]
        );

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

module.exports = {
    createNewUser,
    userLogin,
    userLogout,
    changePassword
}; 