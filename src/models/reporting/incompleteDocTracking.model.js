const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    project_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    batch_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: Number, required: true }, // Trạng thái của batch
    // completed_steps: [String], // Danh sách các step đã được report
    last_processed_at: { type: Date, default: Date.now },
    imported_date: { type: Date }
}, { collection: 'qc_incomplete_batch_tracking', versionKey: false, timestamps: { createdAt: "createdDate", updatedAt: "modifiedDate" } });

// Thay đổi tên collection vì schema đã thay đổi
const collectionName = 'qc_incomplete_batch_tracking';

module.exports = { schema, collectionName };