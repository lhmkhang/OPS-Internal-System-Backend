const jwt = require("jsonwebtoken");
const path = require("path");
const { schema: UserSchema, collectionName: UserCollectionName } = require("../models/userModel");
const { getConnection } = require('../helpers/connectDB');
require("dotenv").config({ path: path.resolve(__dirname, "../..", ".env") });

// Lấy connection default
const connection = getConnection('default');

// Tạo model từ schema
const UserModel = connection.model(UserCollectionName, UserSchema);

const createToken = (payload) => {
  const token = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET_KEY, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRE_TIME,
  });
  return token;
};

const createRefreshToken = (payload) => {
  const token = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET_KEY, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRE_TIME,
  });
  return token;
};

const handleRefreshToken = async (req, res) => {
  const { refreshToken, username } = req.body;

  if (!refreshToken || !username) return res.sendStatus(401);

  const foundUser = await UserModel.findOne({ username });
  if (!foundUser) return res.sendStatus(403); //Forbidden

  if (foundUser.refreshToken !== refreshToken) return res.sendStatus(403);

  // evaluate jwt

  try {
    jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET_KEY,
      (err, decoded) => {
        if (err) return res.sendStatus(403);

        const newAccessToken = createToken({
          UserInfo: {
            userId: decoded.UserInfo.userId,
            username: decoded.UserInfo.username,
            roles: decoded.UserInfo.roles,
          },
        });
        res.json({ newAccessToken });
      }
    );
  } catch (error) {
    console.log(error);
  }
};

module.exports = { handleRefreshToken, createToken, createRefreshToken };
