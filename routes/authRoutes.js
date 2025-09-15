import express from "express";
import { register, login } from "../controllers/authController.js";
import { upload } from "../utils/upload.js";
const router = express.Router();
router.post("/register", upload.single("avatar"), register);
router.post("/login", login);
export default router;
