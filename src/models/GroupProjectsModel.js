const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const groupProjectsSchema = new Schema({
    name: { type: String, required: true, unique: true }, // Tên group project
}, {
    versionKey: false,
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "modifiedDate",
    }
});

const GroupProjectsModel = mongoose.model('group_project', groupProjectsSchema);
module.exports = { GroupProjectsModel };