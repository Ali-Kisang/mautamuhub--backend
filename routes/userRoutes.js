import express from "express";
import {  getUsers, getUserProfile, checkUserProfile, getProfileById, forgotPassword, resetPassword } from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";
import { upload } from "../utils/upload.js";
import { createOrUpdateProfile, getMyProfile, deleteProfilePhoto } from "../controllers/userProfileDataController.js";
import User from "../models/User.js";
import { getMyTransactions, handleCallback, handleValidation, initiatePayment, initiateProratePayment } from "../controllers/transactionController.js";

const router = express.Router();

// 👉 Move DELETE to TOP for priority matching (before any other routes)
router.delete("/profile/photos/:publicId", protect, deleteProfilePhoto);

router.put("/profile", protect, upload.array("photos", 10), createOrUpdateProfile);

router.get("/profile", protect, getMyProfile);
router.post('/payments/initiate', protect, initiatePayment); 
router.post('/payments/callback', handleCallback);  
router.post('/payments/validation', handleValidation);  
router.get('/payments/my-transactions', protect, getMyTransactions);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/payments/prorate-upgrade', protect, initiateProratePayment);  
// Other routes (after specific ones)
router.get("/all", protect, getUsers);
router.get("/profile/:id", getUserProfile);
router.get("/check-profile", protect, checkUserProfile);
router.get("/profile-by-id/:id", getProfileById);
// Add this as first route in userRoutes.js
router.get("/test", (req, res) => {
  res.json({ message: "User routes mounted OK", user: req.user ? req.user._id : "No user" });
});
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