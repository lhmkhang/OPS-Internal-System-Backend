const mongoose = require("mongoose");

const UserRoleSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      default: "",
    },
    userId: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }],
    functional: {
      type: Object,
      default: {},
      required: true
    },
    priority: { type: Number, required: true }, // Thêm trường priority
  },
  {
    versionKey: false,
    timestamps: {
      createdAt: "createdDate",
      updatedAt: "modifiedDate",
    },
    minimize: false
  }
);
UserRoleSchema.index({ userId: 1 });

// Export schema và collectionName thay vì model
module.exports = {
  schema: UserRoleSchema,
  collectionName: 'User_Role'
};
