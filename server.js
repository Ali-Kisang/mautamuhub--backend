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
import { scheduleTrialExpiry, scheduleUpgradeProration } from "./crons/jobs/trialExpiry.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;

dotenv.config();  
const app = express();

// ✅ Middlewares
app.use(
  cors({
    origin: ["https://mautamuhub.com", "https://www.mautamuhub.com", "http://localhost:5173"],
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, "static")));
app.use("/uploads", express.static("uploads"));

app.use("/api/auth", authRoutes); 
app.use("/api/users", userRoutes); 
app.use("/api/chat", chatRoutes);
app.use("/api/accounts", sortAccountTypeRoutes);
app.use("/api/counties", countiesRoutes);
app.use("/api/search", searchRoutes);



mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected");
    scheduleTrialExpiry();
    scheduleUpgradeProration();
  })
  .catch((err) => console.error("❌ Mongo Error:", err));

// ✅ Server & Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ["https://www.mautamuhub.com", "https://mautamuhub.com", "http://localhost:5173"], methods: ["GET", "POST"] },
});

// Catch-all route to serve the index.html for all other routes (Express 5 compatible)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, "static/index.html"));
});

app.set('io', io);

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
    console.log(`📡 Received userOnline emit for user: ${userData.userId}, username: ${userData.username}`); // ✅ Debug: Confirm emit received
    try {
      // Fetch the user details from DB
      const dbUser = await User.findById(userData.userId).lean();
      if (!dbUser) {
        console.warn("⚠️ User not found in DB for socket userOnline");
        return;
      }

      // ✅ Update lastSeen in DB on online event
      const updateResult = await User.findByIdAndUpdate(userData.userId, { lastSeen: new Date() });
      if (updateResult) {
        console.log(`🔄 Updated lastSeen for user ${userData.userId} to ${new Date().toISOString()}`); // ✅ Confirm update
      } else {
        console.warn(`⚠️ Failed to update lastSeen for user ${userData.userId}`); // ✅ Catch update failure
      }

      const newUser = {
        userId: dbUser._id.toString(),
        username: dbUser.personal?.username || dbUser.username || "Unnamed", // Note: personal not in User schema, falls back to username
        avatar: dbUser.avatar || "/default-avatar.png",
        socketId: socket.id,
      };

      // Avoid duplicates
      const exists = onlineUsers.find((u) => u.userId === newUser.userId);
      if (!exists) {
        onlineUsers.push(newUser);
        console.log(`➕ Added new online user: ${newUser.username} (${newUser.userId})`); // ✅ Debug add
      } else {
        // Update socketId if user reconnects
        onlineUsers = onlineUsers.map((u) =>
          u.userId === newUser.userId ? newUser : u
        );
        console.log(`🔄 Updated existing online user: ${newUser.username} (${newUser.userId})`); // ✅ Debug update
      }

      // Broadcast updated list
      io.emit("onlineUsersUpdate", onlineUsers);
      console.log(`📢 Broadcasted onlineUsersUpdate to ${onlineUsers.length} users`); // ✅ Debug broadcast
    } catch (err) {
      console.error("❌ Error in userOnline handler:", err);
    }
  });

  // ✅ Handle disconnect
  socket.on("disconnect", () => {
    const removedUser = onlineUsers.find((u) => u.socketId === socket.id);
    onlineUsers = onlineUsers.filter((u) => u.socketId !== socket.id);
    if (removedUser) {
      console.log(`👋 Removed disconnected user: ${removedUser.username} (${removedUser.userId})`); // ✅ Debug remove
    }
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

// ✅ Start server (Fixed: Bind to '0.0.0.0' for IPv4/IPv6 dual-stack)
server.listen(PORT, '0.0.0.0', () => {
  console.log(` Backend running on port ${PORT}`);
  const addr = server.address();
  if (addr) {
    console.log(`🔍 Bound to: ${addr.family} ${addr.address}:${addr.port}`);
  } else {
    console.error("❌ No bind address!");
  }
});

// Add error handler (catches bind fails)
server.on('error', (err) => {
  console.error("❌ Bind error:", err.code, err.message);
  if (err.code === 'EADDRINUSE') {
    console.log("🔄 Port 5000 in use—run sudo lsof -i :5000 to kill");
  }
  process.exit(1);
});