import Profile from "../models/ProfileSchema.js";
import User from "../models/User.js"; // Import User model if needed for validation
import fs from "fs";
import { uploadEscortPhotos, deleteEscortPhoto } from "../utils/cloudinary.js";
import mongoose from "mongoose";
import qs from "qs";

/**
 * Create or Update Profile (PUT /api/users/profile)
 */
export const createOrUpdateProfile = async (req, res) => {
  try {
    // ✅ Convert user ID to ObjectId (fixes create if schema expects ObjectId)
    const userId = mongoose.Types.ObjectId.isValid(req.user._id) 
      ? new mongoose.Types.ObjectId(req.user._id) 
      : req.user._id;

    // Parse nested FormData (handles personal[username], etc.)
    const parsed = qs.parse(req.body, { comma: true });  // comma: true for arrays like services[selected]

    const personal = parsed.personal || {};
    const location = parsed.location || {};
    const additional = parsed.additional || {};

    // ✅ Flatten potential arrays for string fields (e.g., username from multiple appends)
    const flattenString = (obj) => {
      const flattened = { ...obj };
      Object.keys(flattened).forEach(key => {
        if (Array.isArray(flattened[key])) {
          // Take the last non-empty string (or first non-empty)
          flattened[key] = flattened[key].filter(v => v && v.trim()).pop() || flattened[key][0] || '';
        }
      });
      return flattened;
    };
    const personalFlat = flattenString(personal);
    const locationFlat = flattenString(location);
    const additionalFlat = flattenString(additional);

    // ✅ Fix services parsing: qs turns indexed like [0],[1] into object {0: val, 1: val} – convert to array
    let selectedServices = parsed.services?.selected;
    if (selectedServices && typeof selectedServices === 'object' && !Array.isArray(selectedServices)) {
      selectedServices = Object.values(selectedServices).filter(Boolean); // Convert {0: 'val'} to ['val'], filter empties
    }
    const services = {
      selected: Array.isArray(selectedServices) ? selectedServices : (selectedServices ? [selectedServices] : []),
      custom: parsed.services?.custom || "",
    };

    const accountType = parsed.accountType || {};

    // ✅ Validate required fields (add more if needed for create)
    if (!personalFlat.username) {
      return res.status(400).json({ message: "Username is required" });
    }
    if (!personalFlat.phone) {
      return res.status(400).json({ message: "Phone is required" });
    }
    if (!accountType.type) {
      return res.status(400).json({ message: "Account type is required" });
    }
    if (services.selected.length === 0 && !services.custom) {
      return res.status(400).json({ message: "At least one service is required" });
    }

    // Find existing profile to preserve data (especially photos)
    const existingProfile = await Profile.findOne({ user: userId });
    let photos = existingProfile?.photos || [];

    // Handle existing photos from frontend (if sent; append new ones) – optional, if frontend sends them
    if (parsed.existingPhotos) {
      const existing = Array.isArray(parsed.existingPhotos) ? parsed.existingPhotos : [parsed.existingPhotos];
      photos = [...new Set([...photos, ...existing])];  // Merge and dedupe
    }

    // Handle new photo uploads (multer attaches them; only Files from frontend)
    if (req.files && req.files.length > 0) {
      const newPublicIds = [];
      for (const file of req.files) {
        try {
          const publicId = await uploadEscortPhotos(file.path); // Upload to Cloudinary
          newPublicIds.push(publicId);
          fs.unlinkSync(file.path); // Remove temp file
          console.log('📤 New publicId uploaded:', publicId);  // 👉 Log new uploads
        } catch (uploadErr) {
          console.error("Upload failed for", file.originalname, ":", uploadErr);
          // Continue with other files; or return error if strict
        }
      }
      photos = [...photos, ...newPublicIds];
    }

    // ✅ Photo limit validation (based on accountType)
    const photoLimit = (() => {
      switch (accountType.type) {
        case "Spa": return 10;
        case "VVIP": return 8;
        case "VIP": return 6;
        case "Regular": return 4;
        default: return 0;
      }
    })();
    if (photos.length > photoLimit) {
      return res.status(400).json({ message: `Too many photos. Limit for ${accountType.type}: ${photoLimit}` });
    }
    if (photos.length === 0) {
      return res.status(400).json({ message: "At least one photo is required" });
    }

    // ✅ Upsert profile in DB (use userId as ObjectId)
    const profileData = {
      user: userId,
      personal: personalFlat,
      location: locationFlat,
      additional: additionalFlat,
      services,
      accountType,
      photos,
    };

    const profile = await Profile.findOneAndUpdate(
      { user: userId },
      { $set: profileData },
      { new: true, upsert: true, runValidators: true }
    ).populate("user", "email username avatar");

    console.log('💾 Profile saved with photos:', photos.length, 'for user:', userId);  // 👉 Log saved photos
    res.json({ message: "Profile saved successfully", profile });
  } catch (err) {
    console.error("❌ Profile update error:", err);
    res.status(500).json({ message: err.message || "Failed to save profile" });
  }
};

/**
 * Delete a specific photo from profile (DELETE /api/users/profile/photos/:publicId)
 */
export const deleteProfilePhoto = async (req, res) => {
  try {
    const { publicId } = req.params;

    // 👉 Enhanced debug logs
    console.log('🗑️ Delete route hit for publicId:', publicId);
    console.log('👤 User ID from auth:', req.user._id, 'Type:', typeof req.user._id);
    console.log('🔑 Auth user full:', req.user);

    // Ensure _id is ObjectId
    const userId = mongoose.Types.ObjectId.isValid(req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : req.user._id;

    // Find profile (use userId as ObjectId if possible)
    const profile = await Profile.findOne({ user: userId });
    console.log('📁 Profile found:', !!profile, 'Profile user:', profile?.user);
    if (profile) {
      console.log('📸 Current photos in profile:', profile.photos);
      console.log('🔍 Looking for exact match in photos for:', publicId);
      profile.photos.forEach((p, i) => {
        console.log(`  Photo ${i}: "${p}" (type: ${typeof p})`);
        if (p === publicId) console.log('  ✅ MATCH FOUND at index', i);
        else console.log('  ❌ No match (differs by:', p !== publicId ? 'content' : 'type');
      });
    }

    if (!profile) {
      console.log('❌ No profile found for user');
      return res.status(404).json({ message: "Profile not found" });
    }

    // Check if publicId exists (exact string match)
    const photoIndex = profile.photos.indexOf(publicId);
    console.log('🔍 Photo index for', publicId, ':', photoIndex);
    if (photoIndex === -1) {
      console.log('❌ Photo not found in profile photos - possible mismatch (trimmed/encoded?)');
      return res.status(404).json({ message: "Photo not found" });
    }

    // Delete from Cloudinary
    await deleteEscortPhoto(publicId);
    console.log('☁️ Cloudinary delete successful for', publicId);

    // Remove from array
    profile.photos.splice(photoIndex, 1);
    await profile.save();
    console.log('💾 DB updated, remaining photos:', profile.photos.length);

    res.json({ 
      message: "Photo deleted successfully", 
      remainingPhotos: profile.photos.length 
    });
  } catch (err) {
    console.error("❌ Delete photo error:", err);
    res.status(500).json({ message: err.message || "Failed to delete photo" });
  }
};

/**
 * Get current user's profile (GET /api/users/profile)
 */
export const getMyProfile = async (req, res) => {
  try {
    const userId = mongoose.Types.ObjectId.isValid(req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : req.user._id;
    const profile = await Profile.findOne({ user: userId }).populate("user", "email username avatar");
    if (!profile) {
      // 👉 For new users, return empty profile instead of 404 to avoid frontend errors
      console.log('📭 No profile yet for user:', userId);
      return res.status(200).json({ profile: null });  // Changed to 200 with null
    }
    console.log('📥 Profile fetched for user:', userId, 'with photos:', profile.photos);
    res.status(200).json({ profile });
  } catch (error) {
    console.error("Error in getMyProfile:", error);
    res.status(500).json({ message: error.message });
  }
};