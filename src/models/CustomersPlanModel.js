const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CustomerPlanModelSchema = new Schema({
    customerName: { type: String, required: true, unique: true }
}, {
    versionKey: false,
    timestamps: { createdAt: "createdDate", updatedAt: "modifiedDate" }
});

// Export schema và collectionName thay vì model
module.exports = {
    schema: CustomerPlanModelSchema,
    collectionName: 'customers_plan'
};