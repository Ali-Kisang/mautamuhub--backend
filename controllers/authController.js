import User from "../models/User.js";
import bcrypt from "bcryptjs"; // Updated: Use bcryptjs for consistency (or keep bcrypt; both fine)
import jwt from "jsonwebtoken";
import { uploadEscortPhotos } from "../utils/cloudinary.js";
import fs from "fs";
import dotenv from 'dotenv';
dotenv.config();
// POST /api/auth/register (handles multipart/form-data with optional avatar)
export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    console.log('📧 Register attempt - Raw email:', `"${email}"`);
    console.log('📧 Register attempt - Lower/trimmed email:', email.toLowerCase().trim());

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
    const queryEmail = email.toLowerCase().trim();
    const queryUsername = username.trim();
    console.log('🔍 Querying DB for email:', queryEmail, 'or username:', queryUsername);

    const existingUser = await User.findOne({ 
      $or: [{ email: queryEmail }, { username: queryUsername }] 
    });
    console.log('🔍 DB result - Existing user found?', !!existingUser, existingUser?._id);

    if (existingUser) {
      const conflictField = existingUser.email === queryEmail ? 'email' : 'username';
      console.log(`🚫 Duplicate on ${conflictField} - User: ${existingUser._id}`);
      return res.status(400).json({ 
        error: `A user with this ${conflictField} already exists.`, 
        field: conflictField 
      });
    }

    
    let avatar = "/default-avatar.png";
   

    // Upload avatar to Cloudinary if provided
    if (req.file) {
      try {
        console.log('🖼️ Uploading file:', req.file.path);
        avatar = await uploadEscortPhotos(req.file.path);
    
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Error deleting temp file:", err);
        });
      
      } catch (uploadErr) {
       
        return res.status(500).json({ error: "Failed to upload avatar." });
      }
    } else {
      console.log('🖼️ No file provided - Using default');
    }

    const user = new User({
      username: queryUsername,
      email: queryEmail,
      password, 
      avatar, 
    });
    console.log('💾 Saving new user with ID:', user._id, 'Avatar:', avatar);

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