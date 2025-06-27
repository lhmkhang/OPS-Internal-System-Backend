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

// Export schema và collectionName thay vì model
module.exports = {
    schema: userFloorSchema,
    collectionName: 'user_floor'
};