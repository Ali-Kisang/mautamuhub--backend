import express from "express";
import { searchProfiles } from "../controllers/searchController.js";

const router = express.Router();

// GET /api/search?q=Nairobi
router.get("/", searchProfiles);

export default router;
