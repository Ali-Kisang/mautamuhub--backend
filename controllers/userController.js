import User from "../models/User.js";
import Profile from "../models/ProfileSchema.js";
import mongoose from "mongoose";
export const updateProfile = async (req, res) => {
  try {
    const { location, gender, username } = req.body;
    const photos = req.files?.map(file => `/uploads/${file.filename}`);
    const user = await User.findByIdAndUpdate(req.user.id, {
      location, gender, username,
      ...(photos && { photos })
    }, { new: true });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getUsers = async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user.id } });
  res.json(users);
};

// Get another user's profile by ID


export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params; 

    const profile = await Profile.findOne({ user: id }).populate("user", "-password");
    if (!profile) {
      // Even if profile not found, return avatar from User
      const user = await User.findById(id).select("avatar username email");
      return res.status(404).json({ 
        message: "Profile not found. Please update", 
        avatar: user?.avatar || null 
      });
    }

    res.json({
      ...profile.toObject(),
      avatar: profile.user?.avatar || null  
    });
  } catch (error) {
    console.error("Fetch profile error:", error);
    res.status(500).json({ message: "Server error" });
  }
};



// GET /api/users/profile-by-id/:id
export const getProfileById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid profile ID" });
    }

    const profile = await Profile.findById(id).populate("user", "-password");

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.json(profile);
  } catch (error) {
    console.error("Error fetching profile by ID:", error);
    res.status(500).json({ message: "Server error" });
  }
};


// ✅ Check if user has profile
export const checkUserProfile = async (req, res) => {
  try {
    const userId = req.user.id; 

    // Ensure user exists (with avatar)
    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if profile exists for this user
    const profile = await Profile.findOne({ user: userId }).populate("user", "-password");

    if (!profile) {
      return res.status(200).json({ 
        hasProfile: false, 
        avatar: user.avatar || null,   
        message: "Profile not found. Please create one." 
      });
    }

    // Return profile + avatar
    res.status(200).json({ 
      hasProfile: true, 
      profile,
      avatar: user.avatar || null     // ✅ ensure avatar always included
    });
  } catch (error) {
    console.error("Check profile error:", error);
    res.status(500).json({ message: "Server error" });
  }
};






