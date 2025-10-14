import mongoose from "mongoose";  

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    avatar: { type: String, default: "/default-avatar.png" },
    pushSubscription: { type: Object }, 
    lastSeen: { type: Date, default: Date.now }, 
    balance: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
  },
  { 
    timestamps: true,
    indexes: [
      { lastSeen: -1 }, 
      { email: 1 }, 
      { username: 1 } 
    ]
  }
);

const User = mongoose.model("User", userSchema);
export default User;