import Chat from "../models/Chat.js";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";
// Send a new message (with optional attachment)
export const sendMessage = async (req, res) => {
  try {
    const { receiverId, message } = req.body; 
    if (!receiverId || !message) { 
      return res.status(400).json({ error: "Missing receiverId or message" });
    }

    const fileUrl = req.file ? `/uploads/${req.file.filename}` : "";
    
    const chat = await Chat.create({
      senderId: req.user.id,
      receiverId,
      message, 
      fileUrl,
      status: "sent",
    });
    

    // ✅ Emit real-time to receiver
    const io = req.app.get('io');
    io.to(receiverId).emit("receiveMessage", chat);

    res.json(chat);
  } catch (err) {
    console.error("🚨 SendMessage ERROR:", err);
    res.status(500).json({ error: "Error sending message: " + err.message });
  }
};

export const editMessage = async (req, res) => {
  const { messageId, newText } = req.body;
  const chat = await Chat.findByIdAndUpdate(messageId, { message: newText, edited: true }, { new: true });
  res.json(chat);
};

export const deleteMessage = async (req, res) => {
  const { messageId } = req.params;
  const chat = await Chat.findByIdAndUpdate(messageId, { deleted: true }, { new: true });
  res.json(chat);
};


export const getMessages = async (req, res) => {
 const { receiverId } = req.params;
  const chats = await Chat.find({
    $or: [
      { senderId: req.user.id, receiverId },
      { senderId: receiverId, receiverId: req.user.id }
    ]
  }).sort({ createdAt: 1 }); 
  res.json(chats);
};

export const markSeen = async (req, res) => {
  try {
    const { messageId } = req.params;
    const chat = await Chat.findByIdAndUpdate(
      messageId,
      { status: "seen" },
      { new: true }
    );
    res.json(chat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error marking seen" });
  }
};

export const markDelivered = async (req, res) => {
  try {
    const { messageId } = req.params;
    const chat = await Chat.findByIdAndUpdate(
      messageId,
      { status: "delivered" },
      { new: true }
    );
    res.json(chat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error marking delivered" });
  }
};
// ✅ Get unread count for logged-in user
export const getUnreadCount = async (req, res) => {
  try {
    const count = await Chat.countDocuments({
      receiverId: req.user.id,
      status: { $ne: "seen" }, 
      deleted: false
    });
    res.json({ count });
  } catch (err) {
    console.error("❌ Error fetching unread count:", err);
    res.status(500).json({ error: "Error fetching unread count" });
  }
};

// ✅ Mark all messages in a conversation as seen
export const markConversationRead = async (req, res) => {
  try {
    const { receiverId } = req.params;

    // Update all messages sent to the logged-in user from this receiver
    await Chat.updateMany(
      {
        senderId: receiverId,
        receiverId: req.user.id,
        status: { $ne: "seen" },
      },
      { $set: { status: "seen" } }
    );

    // Get fresh unread count
    const count = await Chat.countDocuments({
      receiverId: req.user.id,
      status: { $ne: "seen" },
      deleted: false,
    });

    // 🔥 Notify the sender via socket that their messages were read
    const io = req.app.get('io'); // ✅ Now available
    if (io) {
      io.to(receiverId).emit("messagesRead", { // Renamed for clarity (optional)
        readerId: req.user.id,
        conversationWith: receiverId,
      });
    }

    res.json({ success: true, unreadCount: count });
  } catch (err) {
    console.error("❌ Error marking conversation read:", err);
    res.status(500).json({ error: "Error marking conversation read" });
  }
};

// ✅ In chatController.js
export const getUnreadByUser = async (req, res) => {
  try {
    const unread = await Chat.aggregate([
      {
        $match: {
          receiverId: new mongoose.Types.ObjectId(req.user.id),
          status: { $ne: "seen" },
          deleted: false,
        },
      },
      {
        $group: {
          _id: "$senderId",
          count: { $sum: 1 },
        },
      },
    ]);

    res.json(unread); 
  } catch (err) {
    console.error("❌ Error fetching per-user unread:", err);
    res.status(500).json({ error: "Error fetching per-user unread" });
  }
};