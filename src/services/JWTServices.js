const jwt = require("jsonwebtoken");
const path = require("path");
require("dotenv").config({path: path.resolve(__dirname, "../..", ".env")});

const createToken = (payload) => {
  console.log(path.resolve(__dirname, "../..", ".env"));
  const token = jwt.sign(payload , process.env.ACCESS_TOKEN_SECRET_KEY, { expiresIn: process.env.ACCESS_TOKEN_EXPIRE_TIME });
  return token;
};

const handleRefreshToken = (req, res) => {
  const cookies = req.cookies;
  if (!cookies?.jwt) return res.sendStatus(401);
  const refreshToken = cookies.jwt;

  const foundUser = usersDB.users.find(
    (person) => person.refreshToken === refreshToken
  );
  if (!foundUser) return res.sendStatus(403); //Forbidden
  // evaluate jwt
  jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET_KEY, (err, decoded) => {
    if (err || foundUser.username !== decoded.username)
      return res.sendStatus(403);

    const roles = Object.values(foundUser.roles);
    const accessToken = createToken({ UserInfo: { username: decoded.username, roles: roles} })
    /* const accessToken = jwt.sign(
      {
        UserInfo: {
          username: decoded.username,
          roles: roles,
        },
      },
      process.env.ACCESS_TOKEN_SECRET_KEY,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRE_TIME }
    ); */
    res.json({ accessToken });
  });
};

module.exports = { handleRefreshToken, createToken };
