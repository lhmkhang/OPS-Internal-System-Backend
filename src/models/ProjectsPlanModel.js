const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
    layout: { type: String, required: true },
    section: { type: String, required: true },
    unit: { type: String, required: true },
    timePerDoc: { type: Number, required: true },
    productiveHours: { type: Number, required: true },
    docsPerDay: { type: Number, default: 0 },
    extraDocs: { type: Number, default: 0 },
}, { _id: false });

const projectPlanSchema = new mongoose.Schema({
    projectName: { type: String, required: true, unique: true },
    customerName: { type: String, required: true }, // Thêm field customerName
    steps: {
        type: Map,
        of: stepSchema,
    },
    slaTarget: { type: Number, default: null },
    projectManagers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users', // Tham chiếu tới collection 'users'
    }],
}, {
    versionKey: false,
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "modifiedDate",
    },
});

// Thêm index cho projectManagers để query nhanh
projectPlanSchema.index({ projectManagers: 1 });

module.exports = mongoose.model('projects_plan', projectPlanSchema);