const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userLocationSchema = new Schema({
    location: { type: String, required: true },
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
    schema: userLocationSchema,
    collectionName: 'user_location'
};