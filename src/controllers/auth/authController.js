const authServices = require("../../services/auth/authService");

const handleCreateNewUser = async (req, res, next) => {
    const username = req.body.username;
    const password = req.body.password;
    const fullName = req.body.fullName;
    authServices.createNewUser(username, password, fullName, res, next);
};

const handleChangePassword = async (req, res, next) => {
    const username = req.body.username;
    const rePassword = req.body.password;
    authServices.changePassword(username, rePassword, req, res, next);
};

const handleLogin = async (req, res, next) => {
    const username = req.body.username;
    const password = req.body.password;
    authServices.userLogin(username, password, req, res, next);
};

const handleLogout = async (req, res, next) => {
    authServices.userLogout(req, res, next);
};

module.exports = {
    handleLogin,
    handleCreateNewUser,
    handleChangePassword,
    handleLogout
}; 