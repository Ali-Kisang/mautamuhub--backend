import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { sendMessage, editMessage, deleteMessage,  markConversationRead,  getMessages, markDelivered, markSeen, getUnreadCount, getUnreadByUser } from "../controllers/chatController.js";
import { upload } from "../utils/uploadMiddleware.js";
const router = express.Router();
router.post("/", protect, upload.single("file"),  sendMessage);
router.put("/edit", protect, editMessage);
router.delete("/:messageId", protect, deleteMessage);
router.get("/:receiverId", protect, getMessages);
router.put("/seen/:messageId", protect, markSeen);
router.put("/delivered/:messageId", protect, markDelivered);
router.get("/unread/count", protect, getUnreadCount);
 router.put("/mark-read/:receiverId", protect, markConversationRead);
 router.get("/unread/by-user", protect, getUnreadByUser);


export default router;
