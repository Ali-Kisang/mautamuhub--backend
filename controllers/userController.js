import User from "../models/User.js";
import Profile from "../models/ProfileSchema.js";
import mongoose from "mongoose";

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    // Ensure user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Parse nested FormData fields (e.g., personal[phone])
    const personal = {};
    const location = {};
    const additional = {};
    const services = { selected: [], custom: "" };
    const accountType = {};

    // Helper to parse nested fields
    const parseNested = (prefix, target) => {
      Object.keys(req.body).forEach((key) => {
        if (key.startsWith(`${prefix}[`)) {
          const subKey = key.slice(prefix.length + 1, -1); // Extract inner key
          if (prefix === "services" && key.startsWith(`${prefix}[selected][`)) {
            const index = key.match(/\[(\d+)\]/)?.[1];
            if (index !== undefined) {
              services.selected[parseInt(index)] = req.body[key];
            }
          } else {
            target[subKey] = req.body[key];
          }
        }
      });
    };

    parseNested("personal", personal);
    parseNested("location", location);
    parseNested("additional", additional);
    parseNested("accountType", accountType);

    // Handle services custom
    if (req.body["services[custom]"]) {
      services.custom = req.body["services[custom]"];
    }

    // Validate accountType type enum
    if (accountType.type && !["Regular", "VIP", "VVIP", "Spa"].includes(accountType.type)) {
      return res.status(400).json({ error: "Invalid account type" });
    }

    // Handle photos: Merge new uploads with existing
    let photos = [];
    if (req.files && req.files.length > 0) {
      const newPhotos = req.files.map((file) => `/uploads/${file.filename}`);
      // Fetch existing profile to merge photos
      const existingProfile = await Profile.findOne({ user: userId });
      photos = existingProfile ? [...(existingProfile.photos || []), ...newPhotos] : newPhotos;
    }

    // Upsert profile (create if none, update if exists)
    const profile = await Profile.findOneAndUpdate(
      { user: userId },
      {
        user: userId,
        personal,
        location,
        additional,
        services,
        accountType,
        photos: photos || undefined, // Only set if new photos provided
      },
      { upsert: true, new: true, runValidators: true }
    ).populate("user", "-password");

    res.json(profile);
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getUsers = async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user.id } });
  res.json(users);
};

// Get another user's profile by ID


// userController.js
export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params; 

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const profile = await Profile.findOne({ user: id }).populate("user", "-password -pushSubscription");

    let userData;

    if (!profile) {
      const user = await User.findById(id).select("-password -pushSubscription");
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      userData = user;
    } else {
      userData = profile.user;
    }

    res.json({ user: userData });
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

// Check if user has a profile and if active (GET /api/users/check-profile)
export const checkUserProfile = async (req, res) => {
  try {
    const userId = mongoose.Types.ObjectId.isValid(req.user.id) 
      ? new mongoose.Types.ObjectId(req.user.id) 
      : req.user.id;

    // Ensure user exists (with avatar)
    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if profile exists for this user
    let profile = await Profile.findOne({ user: userId }).populate("user", "-password");

    // ✅ NEW: If profile exists but expired (expiryDate passed), deactivate it
    if (profile && profile.active && profile.expiryDate && new Date() > new Date(profile.expiryDate)) {
      await Profile.findByIdAndUpdate(profile._id, { active: false });
      profile = await Profile.findById(profile._id).populate("user", "-password");  // Refetch updated
      console.log(`⏰ Auto-deactivated expired profile for user: ${userId} (was ${profile.accountType?.type} ${profile.isTrial ? 'trial' : 'paid'})`);
    }

    if (!profile || !profile.active) { 
      return res.status(200).json({ 
        hasProfile: false, 
        avatar: user.avatar || null,   
        message: profile && !profile.active 
          ? `${profile.isTrial ? 'Trial' : 'Subscription'} expired. Please upgrade to reactivate.` 
          : "Profile not found. Please create one." 
      });
    }

    // Return full profile + avatar (includes isTrial, expiryDate for frontend)
    res.status(200).json({ 
      hasProfile: true, 
      profile, 
      balance: profile.user?.balance || user.balance || 0,
      avatar: user.avatar || null     
    });
  } catch (error) {
    console.error("Check profile error:", error);
    res.status(500).json({ message: "Server error" });
  }
};






