const express = require("express");
const path = require("path");
const authController = require("../../controllers/auth/authController");
const JWTControllers = require("../../controllers/JWTControllers.js");
const verifyJWTToken = require("../../middlewaves/verifyJWTToken.js");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const router = express.Router();

let initAuthApiRoutes = (app) => {
    router
        .post("/signup", authController.handleCreateNewUser)
        .post("/change-password", verifyJWTToken, authController.handleChangePassword)
        .post("/signin", authController.handleLogin)
        .post("/signout", verifyJWTToken, authController.handleLogout)
        .post("/refresh-token", JWTControllers.handleRenewToken);

    return app.use("/api/v1/auth", router);
};

module.exports = initAuthApiRoutes; 