const userServices = require("../services/userService");

const handleCreateNewUser = async (req, res, next) => {
  const username = req.body.username;
  const password = req.body.password;
  const fullName = req.body.fullName;
  userServices.createNewUser(username, password, fullName, res, next);
};

const handleChangePassword = async (req, res, next) => {
  const username = req.body.username;
  const rePassword = req.body.password;
  userServices.changePassword(username, rePassword, req, res, next);
};

const handleLogin = async (req, res, next) => {
  const username = req.body.username;
  const password = req.body.password;
  userServices.userLogin(username, password, req, res, next);
};

const handleLogout = async (req, res, next) => {
  userServices.userLogout(req, res, next);
};

const handleCreateProjectUser = async (req, res, next) => {
  const { username, fullName, group, groupProjectId, workingShift, location, floor } = req.body;
  userServices.createProjectUser(username, fullName, group, groupProjectId, workingShift, location, floor, res, next);
};

const handleUpdateUserAvailability = async (req, res, next) => {
  const { userId, fte, workingDate } = req.body;
  userServices.updateUserAvailability(userId, fte, workingDate, res, next);
};

const handleGetAllUsers = async (req, res, next) => {
  userServices.getAllUsers(res, next);
};

const handleDeleteProjectUser = async (req, res, next) => {
  const { userId } = req.body; // Lấy userId từ body
  userServices.deleteProjectUser(userId, res, next);
};

const handleUpdateProjectUser = async (req, res, next) => {
  const { userId, username, fullName, group, groupProjectId, workingShift, location, floor } = req.body;
  userServices.updateProjectUser(userId, username, fullName, group, groupProjectId, workingShift, location, floor, res, next);
};

module.exports = { handleLogin, handleCreateNewUser, handleChangePassword, handleLogout, handleCreateProjectUser, handleUpdateUserAvailability, handleGetAllUsers, handleDeleteProjectUser, handleUpdateProjectUser };