const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const usersSchema = new Schema({
  username: { type: String, required: true, unique: true }, // Tên user, duy nhất
  fullName: { type: String, required: true },              // Họ tên đầy đủ
  group: { type: String },                                 // Nhóm của user
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'project_user_groups', default: null },
  groupProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'group_projects', default: null },
  workingShift: { type: String, required: true },          // Ca làm việc
  location: { type: String, required: true },              // Địa điểm
  floor: { type: String, required: true },                 // Tầng
},
  {
    versionKey: false,
    timestamps: {
      createdAt: "createdDate",
      updatedAt: "modifiedDate",
    }
  },
);

// Export schema và collectionName thay vì model
module.exports = {
  schema: usersSchema,
  collectionName: 'project_user'
};