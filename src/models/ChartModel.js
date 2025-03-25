const mongoose = require("mongoose");

const ChartSchema = new mongoose.Schema(
    {
        reportId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        chartType: {
            type: String,
            required: true
        },
        title: {
            type: String,
            required: true
        },
        dataString: {
            type: String,
            required: true
        },
        fileName: {
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

const ChartModel = mongoose.model("Role", ChartSchema);
module.exports = { ChartModel };
