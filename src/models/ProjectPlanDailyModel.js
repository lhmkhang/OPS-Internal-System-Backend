const mongoose = require('mongoose');

const projectPlanDailySchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'projects_plan',
    },
    workingDate: {
        type: String, // ISO date string: 'YYYY-MM-DD'
        required: true,
    },
    assignments: [
        {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'project_users' },
            layout: { type: String, required: true },
            section: { type: String, require: true },
            stepName: { type: String, required: true },
            fte: { type: Number, default: 0 },
        }
    ],
    groupPlans: [
        {
            groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'user_groups', required: true },
            stepName: { type: String, required: true },
            layout: { type: String, default: '' },
            section: { type: String, default: '' },
            unit: { type: String, default: '' },
            allocatedVolume: { type: Number, default: 0 },
            realVolume: { type: Number, default: 0 },
            totalWorkingTime: { type: Number, default: 0 },
            overtime: { type: Boolean, default: false },
            realSpeed: { type: Number, default: 0 },
            timePerDoc: { type: Number, default: 0 },
            productiveHours: { type: Number, default: 0 }
        }
    ]
}, {
    versionKey: false,
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "modifiedDate",
    },
});

projectPlanDailySchema.index({ projectId: 1, workingDate: 1 }, { unique: true });

// Export schema và collectionName thay vì model
module.exports = {
    schema: projectPlanDailySchema,
    collectionName: 'project_plan_daily'
};
