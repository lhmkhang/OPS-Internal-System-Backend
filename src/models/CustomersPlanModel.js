const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CustomerPlanModelSchema = new Schema({
    customerName: { type: String, required: true, unique: true }
}, {
    versionKey: false,
    timestamps: { createdAt: "createdDate", updatedAt: "modifiedDate" }
});

const CustomersPlanModel = mongoose.model('customers_plan', CustomerPlanModelSchema);
module.exports = { CustomersPlanModel };