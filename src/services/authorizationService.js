const dotenv = require("dotenv").config();
const logger = require("../helpers/logger");
const loggerInfo = logger.getLogger("infoLogger");
const JWTService = require("./JWTServices");
const { StatusCodes } = require("http-status-codes");
const handleMessage = require("../utils/HandleMessage");
const MESSAGE = require("../utils/message");
const { schema: UserSchema, collectionName: UserCollectionName } = require("../models/userModel");
const { getConnection } = require('../helpers/connectDB');

// Lấy connection default
const connection = getConnection('default');

// Tạo model từ schema
const UserModel = connection.model(UserCollectionName, UserSchema);

const getPermission = async (req, res, next) => {
    try {
        const username = req.params.username;

        const roleData = await UserModel.aggregate([
            { $match: { username } },

            {
                $lookup: {
                    from: "user_roles",
                    localField: "roleId",
                    foreignField: "_id",
                    as: "roleInfo"
                }
            },
            { $unwind: "$roleInfo" },

            {
                $lookup: {
                    from: "apps",
                    let: { userRoleId: "$roleId" },
                    pipeline: [
                        { $match: { $expr: { $in: ["$$userRoleId", "$roleId"] } } }
                    ],
                    as: "apps"
                }
            },

            {
                $lookup: {
                    from: "project_stores",
                    let: { userId: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $in: ["$$userId", "$userId"] } } }
                    ],
                    as: "projects"
                }
            },
            { $unwind: "$projects" },

            {
                $lookup: {
                    from: "project_tasks",
                    let: { projectId: "$projects._id", userId: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$$projectId", "$project_id"] } } },
                        { $match: { $expr: { $in: ["$$userId", "$userId"] } } }
                    ],
                    as: "projects.tasks"
                }
            },

            {
                $group: {
                    _id: "$_id",
                    username: { $first: "$username" },
                    apps: { $first: "$apps.name" },
                    projects: {
                        $push: {
                            name: "$projects.name",
                            tasks: "$projects.tasks.name"
                        }
                    }
                }
            },

            {
                $project: {
                    username: 1,
                    apps: 1,
                    projects: {
                        $arrayToObject: {
                            $map: {
                                input: "$projects",
                                as: "project",
                                in: { k: "$$project.name", v: "$$project.tasks" }
                            }
                        }
                    }
                }
            }
        ]);

        res.json({ data: roleData })

    } catch (error) {
        next(error);
    }
};

module.exports = {
    getPermission
};
