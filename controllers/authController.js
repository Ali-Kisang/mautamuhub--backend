import User from "../models/User.js";
import bcrypt from "bcryptjs"; // Updated: Use bcryptjs for consistency (or keep bcrypt; both fine)
import jwt from "jsonwebtoken";
import { uploadEscortPhotos } from "../utils/cloudinary.js";
import fs from "fs";

// POST /api/auth/register (handles multipart/form-data with optional avatar)
export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validate inputs
    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields (username, email, password) are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: "Please provide a valid email address." });
    }

    // Check for existing user (by email or username)
    const existingUser = await User.findOne({ 
      $or: [{ email: email.toLowerCase().trim() }, { username: username.trim() }] 
    });
    if (existingUser) {
      return res.status(400).json({ error: "A user with this email or username already exists." });
    }

    // Upload avatar to Cloudinary if provided
    let avatar = "/default-avatar.png"; // default
    if (req.file) {
      try {
        avatar = await uploadEscortPhotos(req.file.path);
        // ✅ Remove local file after uploading to Cloudinary
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Error deleting temp file:", err);
        });
      } catch (uploadErr) {
        console.error("Avatar upload error:", uploadErr);
        return res.status(500).json({ error: "Failed to upload avatar." });
      }
    }

    // Hash password (updated to 12 rounds for better security)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create new new user
    const user = new User({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      avatar,
    });
    await user.save();

    // Generate JWT token (expires in 7 days)
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    // Fetch safe user data (exclude password)
    const safeUser = await User.findById(user._id).select("-password");

    res.status(201).json({
      user: safeUser,
      token,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Server error. Please try again later." });
  }
};

// POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");
    

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
   

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    // Generate token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    // Update lastSeen (optional)
    user.lastSeen = new Date();
    await user.save();

    // Safe user response (exclude password)
    const safeUser = await User.findById(user._id).select("-password");

    res.json({
      user: safeUser,
      token,
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: "Server error. Please try again later." });
  }
};