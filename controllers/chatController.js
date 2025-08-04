import Chat from "../models/Chat.js";
import path from "path";
import fs from "fs";

// Send a new message (with optional attachment)
export const sendMessage = async (req, res) => {
  try {
    const { receiverId, message } = req.body;
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : ""; // from Multer
//delete the file after upload
   
    const chat = await Chat.create({
      senderId: req.user.id,
      receiverId,
      message,
      fileUrl,
      status: "sent",
    });


    res.json(chat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error sending message" });
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
  });
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
