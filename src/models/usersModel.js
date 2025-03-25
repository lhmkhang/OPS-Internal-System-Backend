const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const usersSchema = new Schema({
  username: { type: String, required: true, unique: true }, // Tên user, duy nhất
  fullName: { type: String, required: true },              // Họ tên đầy đủ
  group: { type: String },                                 // Nhóm của user
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'project_user_groups', default: null },
  groupProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'group_projects', default: null },
},
  {
    versionKey: false,
    timestamps: {
      createdAt: "createdDate",
      updatedAt: "modifiedDate",
    }
  },

);

const UsersModel = mongoose.model('project_user', usersSchema);
module.exports = { UsersModel };