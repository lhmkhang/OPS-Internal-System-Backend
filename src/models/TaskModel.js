const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    name: String,
    route: String,
    project_id: mongoose.Schema.Types.ObjectId,
    userId: mongoose.Schema.Types.ObjectId
}, {
    versionKey: false,
    timestamps: {
        createdAt: 'createdDate',
        updatedAt: 'modifiedDate'
    }
});

// Export schema và collectionName thay vì model
module.exports = {
    schema: taskSchema,
    collectionName: 'project_task'
};
