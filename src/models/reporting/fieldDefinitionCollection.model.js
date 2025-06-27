const mongoose = require('mongoose');

// Schema cho từng field trong project
const fieldDefinitionSchema = new mongoose.Schema({
    field_id: { type: mongoose.Schema.Types.ObjectId, required: true }, // _id từ field_value_definitions
    field_name: { type: String, required: true },
    field_display: { type: String, default: '' },
    layout_id: { type: mongoose.Schema.Types.ObjectId },
    layout_name: { type: String, default: '' },
    layout_type: { type: String, default: '' },
    section_id: { type: mongoose.Schema.Types.ObjectId },
    section_name: { type: String, default: '' },
    // Các trường có thể chỉnh sửa
    critical_field: { type: String, default: null },
    is_report_count: { type: Boolean, default: true }
}, { _id: false }); // Không tạo _id riêng cho subdocument

// Schema chính cho project field configuration - mỗi project là một document
const projectFieldConfigurationSchema = new mongoose.Schema({
    project_id: { type: mongoose.Schema.Types.ObjectId, required: true }, // Bỏ unique để cho phép nhiều version
    project_name: { type: String, default: '' },
    version: { type: Number, default: 1 }, // Version để track thay đổi
    isActive: { type: Boolean, default: true }, // Chỉ version mới nhất có isActive = true
    fields: [fieldDefinitionSchema], // Array chứa tất cả fields của project
    // Metadata
    last_synced_at: { type: Date, default: Date.now }, // Lần cuối sync từ primary DB
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, {
    collection: 'project_field_configuration',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false
});

// Indexes để tối ưu truy vấn version control
projectFieldConfigurationSchema.index({ project_id: 1, version: 1 }); // Query theo project và version
projectFieldConfigurationSchema.index({ project_id: 1, isActive: 1, version: -1 }); // Lấy version mới nhất active
projectFieldConfigurationSchema.index({ project_name: 1 });
projectFieldConfigurationSchema.index({ last_synced_at: 1 });
projectFieldConfigurationSchema.index({ 'fields.field_id': 1 }); // Index cho nested field
projectFieldConfigurationSchema.index({ 'fields.field_name': 1 });
projectFieldConfigurationSchema.index({ 'fields.critical_field': 1 });
projectFieldConfigurationSchema.index({ 'fields.is_report_count': 1 });

// Schema cho checkpoint theo project
const projectFieldCollectionCheckpointSchema = new mongoose.Schema({
    project_id: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    last_processed_version: { type: Number, default: 0 }, // Version cuối cùng đã process
    last_field_count: { type: Number, default: 0 }, // Số lượng field trong lần process cuối
    last_run_at: { type: Date, default: Date.now }
}, {
    collection: 'project_field_collection_checkpoint',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false
});

// Export schemas mới
const schema = projectFieldConfigurationSchema;
const collectionName = 'project_field_configuration';
const checkpointSchema = projectFieldCollectionCheckpointSchema;
const checkpointCollectionName = 'project_field_collection_checkpoint';

module.exports = {
    schema,
    collectionName,
    checkpointSchema,
    checkpointCollectionName,
    fieldDefinitionSchema
}; 