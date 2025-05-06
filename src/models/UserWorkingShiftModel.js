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

const UserWorkingShiftModel = mongoose.model('user_working_shift', userWorkingShiftSchema);
module.exports = { UserWorkingShiftModel };