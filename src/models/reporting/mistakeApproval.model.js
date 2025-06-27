const mongoose = require('mongoose');

const mistakeApprovalSchema = new mongoose.Schema({
    mistake_report_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    doc_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    project_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    batch_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    error_step: { type: String, required: true },
    error_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    error_type: { type: String, required: true },
    approved_by: { type: mongoose.Schema.Types.ObjectId, required: true },
    approved_by_name: { type: String },
    // Có thể bổ sung thêm các trường metadata cần thiết
}, { versionKey: false, timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' } });

const collectionName = 'mistake_approval';

module.exports = {
    schema: mistakeApprovalSchema,
    collectionName
};
