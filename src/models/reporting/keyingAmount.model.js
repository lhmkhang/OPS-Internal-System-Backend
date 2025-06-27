const mongoose = require('mongoose');

// Schema cho chi tiết từng step
const keyingDetailSchema = new mongoose.Schema({
    task_keyer_name: { type: String },
    user_name_keyer: { type: String },
    total_field: { type: Number },
    total_character: { type: Number },
    total_records: { type: Number },
    total_lines: { type: Number },
    is_qc: { type: Boolean, default: false },
    captured_keyer_at: { type: Date }
}, { _id: false });

const keyingAmountSchema = new mongoose.Schema({
    project_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    batch_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    batch_name: { type: String, required: true },
    doc_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    layout_name: { type: String },
    // Thông tin tổng hợp cấp document
    total_field_document: { type: Number, default: 0 },
    total_character_document: { type: Number, default: 0 },
    total_line_document: { type: Number, default: 0 },
    total_record_document: { type: Number, default: 0 },
    // Chi tiết từng step
    keying_details: { type: [keyingDetailSchema], default: [] },
    // Metadata
    imported_date: { type: Date },
    // exported_date: { type: Date },
    // uploaded_date: { type: Date }
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
    timestamps: { createdAt: "createdDate", updatedAt: "modifiedDate" }
});

// Thêm TTL index cho createdDate (90 ngày)
keyingAmountSchema.index({ createdDate: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Index cho performance
keyingAmountSchema.index({ project_id: 1, imported_date: -1 });
keyingAmountSchema.index({ doc_id: 1 });
keyingAmountSchema.index({ batch_id: 1 });
keyingAmountSchema.index({ 'keying_details.user_name_keyer': 1, 'keying_details.task_keyer_name': 1 });
keyingAmountSchema.index({ 'keying_details.is_qc': 1 });
// Index cho version tracking
keyingAmountSchema.index({ project_id: 1, field_configuration_version: 1 });
keyingAmountSchema.index({ project_id: 1, project_threshold_version: 1 });
keyingAmountSchema.index({ 'processing_version_info.processed_at': -1 });

// Tên collection chung cũ (deprecated, sẽ xóa sau khi migrate)
const collectionName = 'qc_effort';

/**
 * Tạo tên collection động theo projectId
 * @param {string} projectId - ObjectId của project dạng string
 * @returns {string} - Tên collection theo format: {projectId}_keying_amount
 */
function getCollectionName(projectId) {
    if (!projectId) {
        throw new Error('ProjectId is required to generate collection name');
    }
    return `${projectId}_keying_amount`;
}

/**
 * Tạo model cho collection động theo projectId
 * @param {mongoose.Connection} connection - Database connection
 * @param {string} projectId - ObjectId của project dạng string
 * @returns {mongoose.Model} - Model cho collection specific của project
 */
function createModel(connection, projectId) {
    const collectionName = getCollectionName(projectId);
    return connection.models[collectionName] || connection.model(collectionName, keyingAmountSchema, collectionName);
}

module.exports = {
    schema: keyingAmountSchema,
    collectionName, // Tên collection cũ (deprecated)
    getCollectionName,
    createModel
};