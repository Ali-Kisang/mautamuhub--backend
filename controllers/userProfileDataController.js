import Profile from "../models/ProfileSchema.js";
 // Assuming you have a utility function
import fs from "fs";
import { uploadEscortPhotos } from "../utils/cloudinary.js";


export const createOrUpdateProfile = async (req, res) => {
  
  try {
    const userId = req.user.id;

    // ✅ parse structured fields from frontend
    const parsedData = {
      personal: req.body.personal,
      location: req.body.location,
      additional: req.body.additional,
      services: req.body.services,
      accountType: req.body.accountType,
    };

    // ✅ validations
    if (!parsedData.personal?.username)
      return res.status(400).json({ message: "Username is required" });
    if (!parsedData.personal?.phone)
      return res.status(400).json({ message: "Phone is required" });
    if (!parsedData.personal?.gender)
      return res.status(400).json({ message: "Gender is required" });
    if (!parsedData.personal?.age)
      return res.status(400).json({ message: "Age is required" });
    if (!parsedData.accountType?.type)
      return res.status(400).json({ message: "Account type is required" });

    // ✅ handle photo uploads and collect public_ids
    const photoPublicIds = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        // `uploadEscortPhotos` will now return public_id
        const publicId = await uploadEscortPhotos(file.path);
        photoPublicIds.push(publicId);

        // remove temp file
        fs.unlinkSync(file.path);
      }
    }

    // ✅ prepare data for DB
    const profileData = {
      user: userId,
      personal: parsedData.personal,
      location: parsedData.location,
      additional: parsedData.additional,
      services: parsedData.services,
      accountType: parsedData.accountType,
    };

    // Only set photos if new ones were uploaded
    if (photoPublicIds.length > 0) {
      profileData.photos = photoPublicIds;
    }

    // ✅ create or update
    const profile = await Profile.findOneAndUpdate(
      { user: userId },
      profileData,
      { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Profile saved successfully",
      profile,
    });
  } catch (error) {
    console.error("❌ Error in createOrUpdateProfile:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Get current user's profile
 */
export const getMyProfile = async (req, res) => {
  try {
    const profile = await Profile.findOne({ user: req.user.id }).populate("user", "email username");
    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }
    res.status(200).json(profile);
  } catch (error) {
    console.error("Error in getMyProfile:", error);
    res.status(500).json({ message: error.message });
  }
};
