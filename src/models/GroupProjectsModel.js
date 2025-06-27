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

// Export schema và collectionName thay vì model
module.exports = {
    schema: groupProjectsSchema,
    collectionName: 'group_project'
};