const mongoose = require('mongoose');

const stepAssignmentSchema = new mongoose.Schema({
    stepName: { type: String, required: true },
    layout: { type: String, required: true },
    section: { type: String, required: true },
}, { _id: false });

const projectUsersAssignmentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'project_users',
        required: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'projects_plan',
        required: true
    },
    steps: [stepAssignmentSchema]
}, {
    versionKey: false,
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "modifiedDate",
    },
});

projectUsersAssignmentSchema.index({ userId: 1, projectId: 1 });

const ProjectUsersAssignmentModel = mongoose.model('project_users_assignment', projectUsersAssignmentSchema);
module.exports = { ProjectUsersAssignmentModel };