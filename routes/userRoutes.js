import express from "express";
import { updateProfile, getUsers, getUserProfile, checkUserProfile,  getProfileById } from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";
import {upload} from "../utils/upload.js";
import { createOrUpdateProfile, getMyProfile } from "../controllers/userProfileDataController.js";


const router = express.Router();
router.put("/profile", protect, upload.array("photos", 10), createOrUpdateProfile);
router.get("/get-profile", protect, getMyProfile);
router.get("/all", protect, getUsers);
router.get("/profile/:id",  getUserProfile);
router.get("/check-profile", protect, checkUserProfile);
router.get("/profile-by-id/:id", getProfileById);

export default router;
