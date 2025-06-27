const mongoose = require('mongoose');

const thresholdItemSchema = new mongoose.Schema({
    thresholdType: {
        type: String,
        required: false, // Optional, sẽ được auto-set trong service
        trim: true,
        default: 'Critical'
    },
    thresholdPercentage: {
        type: Number,
        required: true,
        min: 0,
        max: 100
    },
    // Thêm scope để phân biệt cấp độ threshold
    thresholdScope: {
        type: String,
        required: true,
        enum: ['Field', 'Line Item', 'Record', 'Document', 'Character'],
        default: 'Field'
    }
}, { _id: true }); // Cho phép _id để có thể xóa item cụ thể

const projectThresholdSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'projects_plan',
        index: true
    },
    version: {
        type: Number,
        required: true,
        default: 1,
        min: 1
    },
    thresholds: {
        type: [thresholdItemSchema],
        default: []
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    versionKey: false,
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "modifiedDate",
    },
});

// Index cho version control và query nhanh
projectThresholdSchema.index({ projectId: 1, version: 1 });
projectThresholdSchema.index({ projectId: 1, isActive: 1, version: -1 }); // Lấy version mới nhất active
projectThresholdSchema.index({ projectId: 1, 'thresholds.thresholdScope': 1 });

// Export schema và collection name theo pattern hiện có
module.exports = {
    schema: projectThresholdSchema,
    collectionName: 'project_thresholds'
}; 