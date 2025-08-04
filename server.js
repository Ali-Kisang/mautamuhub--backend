import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import User from "./models/User.js"; 

// ✅ Routes
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import sortAccountTypeRoutes from "./routes/sortAccountTypeRoutes.js";
import countiesRoutes from "./routes/countiesRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";

dotenv.config();
const app = express();

// ✅ Middlewares
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// ✅ API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/accounts", sortAccountTypeRoutes);
app.use("/api/counties", countiesRoutes);
app.use("/api/search", searchRoutes);

// ✅ MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ Mongo Error:", err));

// ✅ Server & Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] },
});

// ✅ Online Users List
let onlineUsers = [];

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  // Join private room for this user
  socket.on("joinRoom", (userId) => {
    socket.join(userId);
  });

  // ✅ Handle user going online
  socket.on("userOnline", async (userData) => {
    try {
      // Fetch the user details from DB
      const dbUser = await User.findById(userData.userId).lean();
      if (!dbUser) {
        console.warn("⚠️ User not found in DB for socket userOnline");
        return;
      }

      const newUser = {
        userId: dbUser._id.toString(),
        username: dbUser.personal?.username || dbUser.username || "Unnamed",
        avatar: dbUser.avatar || "/default-avatar.png",
        socketId: socket.id,
      };

      // Avoid duplicates
      const exists = onlineUsers.find((u) => u.userId === newUser.userId);
      if (!exists) {
        onlineUsers.push(newUser);
      } else {
        // Update socketId if user reconnects
        onlineUsers = onlineUsers.map((u) =>
          u.userId === newUser.userId ? newUser : u
        );
      }

      // Broadcast updated list
      io.emit("onlineUsersUpdate", onlineUsers);
    } catch (err) {
      console.error("❌ Error in userOnline handler:", err);
    }
  });

  // ✅ Handle disconnect
  socket.on("disconnect", () => {
    onlineUsers = onlineUsers.filter((u) => u.socketId !== socket.id);
    io.emit("onlineUsersUpdate", onlineUsers);
  });

  // ✅ Chat features
  socket.on("sendMessage", (data) => {
    io.to(data.receiverId).emit("receiveMessage", data);
  });

  socket.on("editMessage", (data) => {
    io.to(data.receiverId).emit("messageEdited", data);
  });

  socket.on("deleteMessage", (msgId) => {
    io.emit("messageDeleted", msgId);
  });

  socket.on("typing", ({ senderId, receiverId }) => {
    io.to(receiverId).emit("typing", senderId);
  });

  socket.on("stopTyping", ({ senderId, receiverId }) => {
    io.to(receiverId).emit("stopTyping", senderId);
  });

  socket.on("markSeen", (data) => {
    io.to(data.receiverId).emit("messageSeen", data.messageId);
  });

  socket.on("markDelivered", (data) => {
    io.to(data.receiverId).emit("messageDelivered", data.messageId);
  });
});

// ✅ Start server
server.listen(5000, () => console.log("🚀 Backend running on port 5000"));
