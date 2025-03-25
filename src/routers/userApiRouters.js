const express = require("express");
const path = require("path");
const userControllers = require("../controllers/userControllers");
const JWTControllers = require("../controllers/JWTControllers.js");
const verifyJWTToken = require("../middlewaves/verifyJWTToken.js");
const verifyRoles = require("../middlewaves/verifyRoles.js");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const router = express.Router();

let initUserApiRoutes = (app) => {
  router
    .post("/signup", userControllers.handleCreateNewUser)
    .post("/change-password", verifyJWTToken, userControllers.handleChangePassword)
    .post("/signin", userControllers.handleLogin)
    .post("/signout", verifyJWTToken, userControllers.handleLogout)
    .post("/refresh-token", JWTControllers.handleRenewToken)
    .post("/project-users", userControllers.handleCreateProjectUser) // Tạo user cho dự án
    .post("/user-availability", userControllers.handleUpdateUserAvailability) // Cập nhật availability
    .get("/get-all-users", userControllers.handleGetAllUsers) // Lấy toàn bộ user trong project users
    .put("/delete-project-user", verifyJWTToken, userControllers.handleDeleteProjectUser) // Route mới để xóa user
    .put("/update-project-user", verifyJWTToken, userControllers.handleUpdateProjectUser); // Route mới để cập nhật user

  return app.use("/api/v1", router);
};

module.exports = initUserApiRoutes;