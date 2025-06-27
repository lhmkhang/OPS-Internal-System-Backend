const mongoose = require("mongoose");

const ReportGroupSchema = new mongoose.Schema(
    {
        groupName: {
            type: String,
            required: true
        },
        userCreated: {
            type: String,
            required: true
        },
        description: {
            type: String,
            required: true
        },
    },
    {
        versionKey: false,
        timestamps: {
            createdAt: "createdDate",
            updatedAt: "modifiedDate",
        },
    }
);

// Export schema và collectionName thay vì model
module.exports = {
    schema: ReportGroupSchema,
    collectionName: 'Role'  // Giữ nguyên tên collection
};
