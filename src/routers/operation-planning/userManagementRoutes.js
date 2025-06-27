const express = require("express");
const path = require("path");
const userManagementController = require("../../controllers/operation-planning/userManagementController");
const verifyJWTToken = require("../../middlewaves/verifyJWTToken.js");
const verifyRoles = require("../../middlewaves/verifyRoles.js");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const router = express.Router();

let initUserManagementApiRoutes = (app) => {
    router
        .post("/create-user", userManagementController.handleCreateProjectUser) // Tạo user cho dự án
        .post("/user-availability", userManagementController.handleUpdateUserAvailability) // Cập nhật availability
        .get("/users", userManagementController.handleGetAllUsers) // Lấy toàn bộ user trong project users
        .delete("/delete-user", verifyJWTToken, userManagementController.handleDeleteProjectUser) // Route để xóa user
        .put("/update-user", verifyJWTToken, userManagementController.handleUpdateProjectUser) // Route để cập nhật user
        .get("/users-creation", verifyJWTToken, userManagementController.handleGetUsersByRole) // Lấy user theo role
        .get("/resource-availability", verifyJWTToken, userManagementController.handleGetResourceAvailability) // Lấy FTE availability
        .post("/project-users-assignment", verifyJWTToken, userManagementController.handleAssignUserToProjectSteps) // Assign user vào project steps
        .get("/project-users-assignment", verifyJWTToken, userManagementController.handleGetProjectUserAssignments) // Lấy assignment
        .delete("/project-users-assignment", verifyJWTToken, userManagementController.handleDeleteProjectUserAssignment); // Xóa assignment

    return app.use("/api/v1/operation-planning/user-management", router);
};

module.exports = initUserManagementApiRoutes; 