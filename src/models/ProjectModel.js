const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
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
    schema: projectSchema,
    collectionName: 'project_store'
};
