import express from "express";
import { updateProfile, getUsers, getUserProfile, checkUserProfile, getProfileById } from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";
import { upload } from "../utils/upload.js";
import { createOrUpdateProfile, getMyProfile, deleteProfilePhoto } from "../controllers/userProfileDataController.js";
import User from "../models/User.js";

const router = express.Router();

// 👉 Move DELETE to TOP for priority matching (before any other routes)
router.delete("/profile/photos/:publicId", protect, (req, res, next) => {
  console.log('🛡️ DELETE handler reached after auth, publicId:', req.params.publicId);
  next();
}, deleteProfilePhoto);

// ✅ Remove the global use log now that we know matching works; add specific log instead
// (Comment out or remove the router.use for clean logs)

// ✅ PUT /api/users/profile - Create/Update profile with photos
router.put("/profile", protect, upload.array("photos", 10), createOrUpdateProfile);

// ✅ GET /api/users/profile - Get current user's profile
router.get("/profile", protect, getMyProfile);

// Other routes (after specific ones)
router.get("/all", protect, getUsers);
router.get("/profile/:id", getUserProfile);
router.get("/check-profile", protect, checkUserProfile);
router.get("/profile-by-id/:id", getProfileById);

router.post("/update-push-sub", protect, async (req, res) => {
  try {
    const { subscription } = req.body;

    if (!subscription) {
      return res.status(400).json({ error: "Subscription is required" });
    }
    let parsedSub;
    try {
      parsedSub = JSON.parse(subscription);
    } catch (err) {
      return res.status(400).json({ error: "Invalid subscription format" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { pushSubscription: parsedSub },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ msg: "Push subscription updated successfully" });
  } catch (err) {
    console.error("Update push sub error:", err);
    res.status(500).json({ error: "Server error updating subscription" });
  }
});

export default router;