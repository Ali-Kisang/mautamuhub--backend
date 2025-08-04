import express from "express";
const router = express.Router();

import { getUsersByCounties } from "../controllers/getUsersByCounties.js";

// ✅ Route to get users by counties
router.get("/grouped", getUsersByCounties);


export default router;