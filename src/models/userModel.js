const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, require: true, unique: true },
    password: { type: String, require: true },
    fullName: { type: String, require: true },
    refreshToken: { type: String, default: "" },
    lineManager: { type: mongoose.Schema.Types.ObjectId, ref: 'Users', default: null }
  },
  {
    versionKey: false,
    timestamps: {
      createdAt: 'createdDate',
      updatedAt: 'modifiedDate'
    }
  }
);

// Export schema và collectionName thay vì model
module.exports = {
  schema: userSchema,
  collectionName: 'User'
};
