import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    message: { type: String, default: "" },
    fileUrl: { type: String, default: "" }, 
    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent",
    },
    deleted: { type: Boolean, default: false },
    edited: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Chat", chatSchema);
