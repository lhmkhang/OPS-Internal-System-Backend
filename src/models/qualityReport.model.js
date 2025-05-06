const mongoose = require('mongoose');

const qualityReportSchema = new mongoose.Schema({
    doc_id: { type: String, required: true },
    s2_url: { type: String },
    doc_uri: { type: String },
    batch_name: { type: String, required: true },
    line_idx: { type: Number },
    record_idx: { type: Number },
    field_name: { type: String },
    keyer_final: { type: String },
    task_final: { type: String },
    section_final: { type: String },
    data_final: { type: String },
    capture_date_final: { type: String },
    keyer: { type: String },
    task_keyer: { type: String },
    section_keyer: { type: String },
    data_keyer: { type: String },
    capture_date_keyer: { type: String },
    created_time: { type: Date },
}, { versionKey: false });

module.exports = qualityReportSchema; 