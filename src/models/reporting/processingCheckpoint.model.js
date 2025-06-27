const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    project_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    last_batch_id: { type: mongoose.Schema.Types.ObjectId }, // ID batch cuối cùng đã xử lý
    last_run_at: { type: Date, default: Date.now }
}, { collection: 'qc_processing_checkpoint', versionKey: false, timestamps: { createdAt: "createdDate", updatedAt: "modifiedDate" } });

const collectionName = 'qc_processing_checkpoint';

module.exports = { schema, collectionName };