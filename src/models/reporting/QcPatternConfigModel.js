const mongoose = require("mongoose");

const qcPatternConfigSchema = new mongoose.Schema(
    {
        pattern_regex: {
            QC_PATTERN: {
                type: String,
                required: true,
            },
            AQC_PATTERN: {
                type: String,
                required: true,
            }
        },
        description: {
            type: String,
            required: true,
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
    schema: qcPatternConfigSchema,
    collectionName: 'qc_pattern_configs'
}; 