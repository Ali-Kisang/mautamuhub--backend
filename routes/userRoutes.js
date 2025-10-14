import express from "express";
import { updateProfile, getUsers, getUserProfile, checkUserProfile, getProfileById } from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";
import { upload } from "../utils/upload.js";
import { createOrUpdateProfile, getMyProfile, deleteProfilePhoto } from "../controllers/userProfileDataController.js";
import User from "../models/User.js";
import { getMyTransactions, handleCallback, handleValidation, initiatePayment, initiateProratePayment } from "../controllers/transactionController.js";

const router = express.Router();

// 👉 Move DELETE to TOP for priority matching (before any other routes)
router.delete("/profile/photos/:publicId", protect, (req, res, next) => {
 
  next();
}, deleteProfilePhoto);

router.put("/profile", protect, upload.array("photos", 10), createOrUpdateProfile);

router.get("/profile", protect, getMyProfile);
router.post('/payments/initiate', protect, initiatePayment); 
router.post('/payments/callback', handleCallback);  
router.post('/payments/validation', handleValidation);  
router.get('/payments/my-transactions', protect, getMyTransactions);

router.get('/payments/prorate-upgrade', protect, initiateProratePayment);  
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