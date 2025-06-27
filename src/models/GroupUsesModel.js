const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const groupSchema = new Schema({
    groupName: { type: String, required: true, unique: true }, // Tên nhóm (VD: "TeamA")
    teamLeader: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true }, // ID của team leader từ users
}, {
    versionKey: false,
    timestamps: { createdAt: "createdDate", updatedAt: "modifiedDate" }
});

// Export schema và collectionName thay vì model
module.exports = {
    schema: groupSchema,
    collectionName: 'groups'
};