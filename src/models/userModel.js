const mongoose = require("mongoose");
const TurnWheelModel = require("./TurnWheelModel");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, require: true, unique: true },
    password: { type: String, require: true },
    fullName: { type: String, require: true },
    refreshToken: { type: String, default: "" },
    lineManager: { type: mongoose.Schema.Types.ObjectId, ref: 'Users', default: null }
  },
  {
    versionKey: false,
    timestamps: {
      createdAt: 'createdDate',
      updatedAt: 'modifiedDate'
    }
  }
);

userSchema.post('save', async function (doc, next) {
  try {
    const result = await TurnWheelModel.create({ username: doc.username, quantity: 1 });
  } catch (err) {
    console.log(err);
  }
});

const UserModel = mongoose.model("User", userSchema);

module.exports = { UserModel };
