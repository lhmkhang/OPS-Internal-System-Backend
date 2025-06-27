const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const usersSchema = new Schema({
  groupName: { type: String, required: true },              // Họ tên đầy đủ
  teamLeader: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, default: null },
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
  collectionName: 'project_user_groups'
};