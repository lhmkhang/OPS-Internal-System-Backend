const jwt = require("jsonwebtoken");

const verifyRoles = (...allowedRoles) => {
  return async (req, res, next) => {
    if (!req.cookies?.jwt) return res.sendStatus(401);

    const decodeToken = jwt.decode(req.cookies.jwt.accessToken, process.env.SECRET_KEY);
    const rolesArray = [...allowedRoles];
    const requestUserRole = decodeToken.UserInfo.roles.map((role) => rolesArray.includes(role)).find((val) => val === true);

    // console.log("requestUserRole: ", requestUserRole);
    if (!requestUserRole) return res.sendStatus(401);
    next();
  };
};

module.exports = verifyRoles;
