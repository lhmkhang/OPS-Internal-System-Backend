const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userAvailabilitySchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'project_users', required: true }, // Liên kết với project_users
    fte: { type: Number, required: true, min: 0, max: 1 },               // FTE từ 0-1
    workingDate: { type: String, required: true }                         // Ngày làm việc cụ thể
}, {
    versionKey: false,
    timestamps: {
        createdAt: "createdDate",
        updatedAt: "modifiedDate",
    }
});

// Export schema và collectionName thay vì model
module.exports = {
    schema: userAvailabilitySchema,
    collectionName: 'project_users_availability'
};
