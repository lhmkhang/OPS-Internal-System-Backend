const express = require("express");
const path = require("path");
const userManagementController = require("../controllers/operation-planning/userManagementController");
const verifyJWTToken = require("../middlewaves/verifyJWTToken.js");
const verifyRoles = require("../middlewaves/verifyRoles.js");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const router = express.Router();

let initUserApiRoutes = (app) => {
  // Authentication routes moved to routers/auth/authRoutes.js
  // User management routes - using new modular controllers
  router
    .post("/project-users", userManagementController.handleCreateProjectUser) // Tạo user cho dự án
    .post("/user-availability", userManagementController.handleUpdateUserAvailability) // Cập nhật availability
    .get("/get-all-users", userManagementController.handleGetAllUsers) // Lấy toàn bộ user trong project users
    .put("/delete-project-user", verifyJWTToken, userManagementController.handleDeleteProjectUser) // Route mới để xóa user
    .put("/update-project-user", verifyJWTToken, userManagementController.handleUpdateProjectUser); // Route mới để cập nhật user

  return app.use("/api/v1", router);
};

module.exports = initUserApiRoutes;