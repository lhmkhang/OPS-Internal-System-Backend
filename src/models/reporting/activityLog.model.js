const mongoose = require('mongoose');

// Sub-schema cho từng action trong history
const actionHistorySchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    user_name: { type: String, required: true }, // Required để đảm bảo luôn có thông tin user
    action: { type: String, required: true }, // 'QC_ASSIGN', 'PM_APPROVE', 'PM_REJECT', ...
    old_value: { type: mongoose.Schema.Types.Mixed },
    new_value: { type: mongoose.Schema.Types.Mixed },
    reason: { type: String, default: '' },
    user_comment: { type: String, default: '' }, // Comment của action này
    action_date: { type: Date, default: Date.now }
}, { _id: true, versionKey: false });

const activityLogSchema = new mongoose.Schema({
    doc_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    error_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    history: { type: [actionHistorySchema], default: [] }, // Array lưu toàn bộ history
    last_action: { type: String }, // Action cuối cùng để query nhanh
    last_user: { type: String }, // User cuối cùng để query nhanh
    last_updated: { type: Date, default: Date.now }
}, { versionKey: false, timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' } });

// Index unique cho doc_id + error_id
activityLogSchema.index({ doc_id: 1, error_id: 1 }, { unique: true });
// Index cho query nhanh
activityLogSchema.index({ last_action: 1, last_updated: -1 });
// TTL index
activityLogSchema.index({ createdDate: 1 }, { expireAfterSeconds: 45 * 24 * 60 * 60 }); // TTL 45 ngày

const collectionName = 'activity_log';

module.exports = {
    schema: activityLogSchema,
    collectionName
};
