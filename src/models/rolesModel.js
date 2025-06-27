const mongoose = require("mongoose");

const RoleSchema = new mongoose.Schema(
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
  },
  {
    versionKey: false,
    timestamps: {
      createdAt: "createdDate",
      updatedAt: "modifiedDate",
    },
  }
);

// Export schema và collectionName thay vì model
module.exports = {
  schema: RoleSchema,
  collectionName: 'Role'
};
