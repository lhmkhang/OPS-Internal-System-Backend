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

const UserLocationModel = mongoose.model('user_location', userLocationSchema);
module.exports = { UserLocationModel };