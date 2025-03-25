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
    steps: [
        {
            stepName: { type: String, required: true },
            layout: { type: String, default: '' },
            section: { type: String, default: '' },
            unit: { type: String, default: '' },
            docsPerDay: { type: Number, default: 0 },
            realVolume: { type: Number, default: 0 },
            realSpeed: { type: Number, default: 0 },
            totalWorkingTime: { type: Number, default: 0 },
            overtime: { type: Boolean, default: false },
            timePerDoc: { type: Number, default: 0 },
            productiveHours: { type: Number, default: 0 }
        }
    ],
    assignments: [
        {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'project_users' },
            stepName: { type: String },
            fte: { type: Number, default: 0 },
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

module.exports = mongoose.model('project_plan_daily', projectPlanDailySchema);
