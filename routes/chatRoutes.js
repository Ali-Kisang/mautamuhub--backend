import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { sendMessage, editMessage, deleteMessage, markConversationRead, getMessages, markDelivered, markSeen, getUnreadCount, getUnreadByUser, getRecentConversations, removeReaction, addReaction } from "../controllers/chatController.js";
import { upload } from "../utils/uploadMiddleware.js";

const router = express.Router();

// ✅ Param-less routes FIRST to avoid conflicts with :receiverId
router.get("/recent", protect, getRecentConversations);
router.get("/unread/count", protect, getUnreadCount);
router.get("/unread/by-user", protect, getUnreadByUser);

// ✅ Param-based routes AFTER
router.post("/", protect, upload.single("file"), sendMessage);
router.put("/edit", protect, editMessage);
router.delete("/:messageId", protect, deleteMessage);
router.get("/:receiverId", protect, getMessages);
router.put("/seen/:messageId", protect, markSeen);
router.put("/delivered/:messageId", protect, markDelivered);
router.put("/mark-read/:receiverId", protect, markConversationRead);
router.post("/react", protect, addReaction);
router.delete("/react", protect, removeReaction);

export default router;