const mongoose = require('mongoose');

const reasonHistorySchema = new mongoose.Schema({
    action: { type: String, enum: ['REJECTED', 'APPROVED', 'QC_EDIT'], required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    user_name: { type: String },
    content: { type: String, default: '' },
    createdDate: { type: Date, default: Date.now }
}, { _id: false });

const mistakeDetailSchema = new mongoose.Schema({
    task_keyer_name: { type: String },
    task_final_name: { type: String },
    section: { type: String },
    record_idx: { type: String },
    line_idx: { type: String },
    field_name: { type: String },
    user_name_keyer: { type: String },
    user_name_final: { type: String },
    value_keyer: { type: String },
    value_final: { type: String },
    captured_keyer_at: { type: Date },
    captured_final_at: { type: Date },
    layout_name: { type: String },
    error_type: { type: String, default: null },
    error_found_at: { type: String, default: '' },
    status: { type: String, enum: ['WAIT_QC', 'WAIT_PM', 'REJECTED_BY_PM', 'APPROVED_BY_PM', 'DONE'], default: 'WAIT_QC' },
    reason: { type: [reasonHistorySchema], default: [] }
}, { _id: true });

const mistakeDetailsSchema = new mongoose.Schema({
    project_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    batch_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    doc_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    batch_name: { type: String },
    imported_date: { type: Date },
    s2_url: { type: String },
    doc_uri: { type: String },
    mistake_details: { type: [mistakeDetailSchema], default: [] },
    // Version tracking để biết document được process với version config nào
    field_configuration_version: { type: Number, default: null },
    project_threshold_version: { type: Number, default: null },
    // Metadata cho version tracking
    processing_version_info: {
        field_config_updated_at: { type: Date, default: null },
        project_threshold_updated_at: { type: Date, default: null },
        processed_at: { type: Date, default: Date.now }
    }
}, {
    versionKey: false,
    timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' }
});

// Thêm TTL index cho createdDate (90 ngày)
mistakeDetailsSchema.index({ createdDate: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Index cho performance
mistakeDetailsSchema.index({ project_id: 1, imported_date: -1 });
mistakeDetailsSchema.index({ doc_id: 1 });
mistakeDetailsSchema.index({ batch_id: 1 });
mistakeDetailsSchema.index({ 'mistake_details.status': 1 });
mistakeDetailsSchema.index({ 'mistake_details._id': 1 });
// Index cho version tracking
mistakeDetailsSchema.index({ project_id: 1, field_configuration_version: 1 });
mistakeDetailsSchema.index({ project_id: 1, project_threshold_version: 1 });
mistakeDetailsSchema.index({ 'processing_version_info.processed_at': -1 });

// Tên collection chung cũ (deprecated, sẽ xóa sau khi migrate)
const collectionName = 'mistake_reports';

/**
 * Tạo tên collection động theo projectId
 * @param {string} projectId - ObjectId của project dạng string
 * @returns {string} - Tên collection theo format: {projectId}_mistake_details
 */
function getCollectionName(projectId) {
    if (!projectId) {
        throw new Error('ProjectId is required to generate collection name');
    }
    return `${projectId}_mistake_details`;
}

/**
 * Tạo model cho collection động theo projectId
 * @param {mongoose.Connection} connection - Database connection
 * @param {string} projectId - ObjectId của project dạng string
 * @returns {mongoose.Model} - Model cho collection specific của project
 */
function createModel(connection, projectId) {
    const collectionName = getCollectionName(projectId);
    return connection.models[collectionName] || connection.model(collectionName, mistakeDetailsSchema, collectionName);
}

module.exports = {
    schema: mistakeDetailsSchema,
    collectionName, // Tên collection cũ (deprecated)
    getCollectionName,
    createModel
};