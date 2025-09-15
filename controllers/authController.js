import User from "../models/User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { uploadEscortPhotos } from "../utils/cloudinary.js";
import fs from "fs";
export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Upload avatar to Cloudinary if provided
    let avatarPublicId = "/default-avatar.png"; // default

    if (req.file) {
      avatarPublicId = await uploadEscortPhotos(req.file.path);

      // ✅ Remove local file after uploading to Cloudinary
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Error deleting temp file:", err);
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email,
      password: hash,
      avatar: avatarPublicId, // store Cloudinary public_id
    });

    res.json(user);
    console.log(user);
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: "User not found please register" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
