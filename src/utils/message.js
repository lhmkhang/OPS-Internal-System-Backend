module.exports = {
  AUTH: {
    LOGIN: {
      EMPTY_CREDENTIALS: "Username or password is empty!",
      USER_NOT_FOUND: "User does not exist!",
      INVALID_CREDENTIALS: "Username or password is incorrect!",
    },
    CREATE_USER: {
      EMPTY_CREDENTIALS: "Username or password is empty!",
      USER_CONFLICT: "User already exist!",
      CREATE_USER_SUCCESS: "Create user successful!",
    },
    VERIFY_TOKEN: {
      EMPTY_TOKEN: "Token is empty or invalid!",
      TOKEN_EXPIRED: "Token is expired!",
    },
    CHANGE_PASSWORD: {
      EMPTY_CREDENTIALS: "Username or new password is empty!",
      USER_NOT_FOUND: "User does not exist!",
      UNAUTHORIZED: "you are not authorized to change password for this user",
    },
    LOG_OUT: {
      LOG_OUT_SUCCESS: "User logout successful!",
      LOG_OUT_ERROR: "Session does not exist!",
    },
  },
  REPORTING: {
    MISSING_PARAMS: 'ProjectId and date are required',
    GET_MISTAKE_REPORT_SUCCESS: 'Get mistake report success',
    INTERNAL_SERVER_ERROR: 'Internal server error',
  },
};