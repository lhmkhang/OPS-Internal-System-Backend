const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userFloorSchema = new Schema({
    floor: { type: String, required: true },
},
    {
        versionKey: false,
        timestamps: {
            createdAt: "createdDate",
            updatedAt: "modifiedDate",
        }
    },

);

const UserFloorModel = mongoose.model('user_floor', userFloorSchema);
module.exports = { UserFloorModel };