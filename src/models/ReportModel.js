const mongoose = require("mongoose");

const ReportSchema = new mongoose.Schema(
    {
        reportName: {
            type: String,
            required: true
        },
        description: {
            type: String,
            required: true
        },
        groupId: {
            type: mongoose.Schema.Types.ObjectId,
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

const ReportModel = mongoose.model("Role", ReportSchema);
module.exports = { ReportModel };
