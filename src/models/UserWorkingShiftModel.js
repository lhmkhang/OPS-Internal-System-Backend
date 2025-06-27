const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userWorkingShiftSchema = new Schema({
    workingShift: { type: String, required: true },
    totalWorkingHours: { type: Number, required: true },
},
    {
        versionKey: false,
        timestamps: {
            createdAt: "createdDate",
            updatedAt: "modifiedDate",
        }
    },

);

// Export schema và collectionName thay vì model
module.exports = {
    schema: userWorkingShiftSchema,
    collectionName: 'user_working_shift'
};