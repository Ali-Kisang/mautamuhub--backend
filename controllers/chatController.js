import Chat from "../models/Chat.js";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";
import { sendPushNotification } from "../utils/notifications.js";
import User from "../models/User.js";

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

    // ✅ Send push notification if receiver is subscribed
    const receiver = await User.findById(receiverId).select('pushSubscription');
    if (receiver && receiver.pushSubscription) {
      const senderName = req.user.username || 'Someone';
      await sendPushNotification(
  receiver.pushSubscription,
  'New Message on Mautamu',
  `${senderName}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
  req.user.avatar ? `https://res.cloudinary.com/dcxggvejn/image/upload/${req.user.avatar}` : '/default-avatar.png',
  req.user.id  
);
      console.log('🔔 Push notification sent!');
    }

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



export const getRecentConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    // ✅ Aggregate recent convos (with guards for empty DB)
    const conversations = await Chat.aggregate([
      // Match messages involving user (sent/received, non-deleted)
      {
        $match: {
          $or: [
            { senderId: new mongoose.Types.ObjectId(userId), deleted: false },
            { receiverId: new mongoose.Types.ObjectId(userId), deleted: false }
          ]
        }
      },
      // Group by other user, get last msg + unread sum
      {
        $group: {
          _id: {
            otherUser: { 
              $cond: [ 
                { $eq: ["$senderId", new mongoose.Types.ObjectId(userId)] }, 
                "$receiverId", 
                "$senderId" 
              ] 
            }
          },
          lastMessage: { $last: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                { 
                  $and: [ 
                    { $eq: ["$receiverId", new mongoose.Types.ObjectId(userId)] }, 
                    { $ne: ["$status", "seen"] } 
                  ] 
                },
                1,
                0
              ]
            }
          }
        }
      },
      // Sort by last msg desc
      { $sort: { "lastMessage.createdAt": -1 } },
      { $limit: 50 },
      // Lookup other user (with lastSeen)
      {
        $lookup: {
          from: "users",
          localField: "_id.otherUser",
          foreignField: "_id",
          as: "otherUser",
          pipeline: [
            { $project: { username: 1, avatar: 1, lastSeen: 1 } }
          ]
        }
      },
      { $unwind: { path: "$otherUser", preserveNullAndEmptyArrays: true } }, // Handle no user (rare)
      // Project clean output
      {
        $project: {
          userId: "$_id.otherUser",
          username: { $ifNull: ["$otherUser.username", "Unknown"] },
          avatar: { $ifNull: ["$otherUser.avatar", "/default-avatar.png"] },
          lastSeen: "$otherUser.lastSeen",
          lastMessage: {
            _id: "$lastMessage._id",
            message: "$lastMessage.message",
            createdAt: "$lastMessage.createdAt",
            senderId: "$lastMessage.senderId",
            isMine: { $eq: ["$lastMessage.senderId", new mongoose.Types.ObjectId(userId)] }
          },
          unreadCount: { $max: ["$unreadCount", 0] }
        }
      }
    ]);

    console.log(`Recent convos for ${userId}: ${conversations.length}`); // Debug: Check count
    res.json(conversations);
  } catch (err) {
    console.error("❌ Recent convos error:", err); // Log full err
    res.status(500).json({ error: "Failed to fetch recent conversations" });
  }
};