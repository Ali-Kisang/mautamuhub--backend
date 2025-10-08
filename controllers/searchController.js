// controllers/searchController.js
import Profile from "../models/ProfileSchema.js";

export const searchProfiles = async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;

    // Always send a consistent shape, even if no query
    if (!q || q.trim() === "") {
      return res.status(200).json({
        profiles: [],
        total: 0,
        page: Number(page),
        totalPages: 0,
        message: "Search query is required"
      });
    }

    const searchRegex = new RegExp(q, "i");
    const now = new Date();  // ✅ Current time for expiry check

    const query = {
      active: true,  // ✅ Only active profiles
      expiryDate: { $gt: now },  // ✅ Not expired
      $or: [
        { "location.county": searchRegex },
        { "location.constituency": searchRegex },
        { "location.ward": searchRegex },
        { "location.localArea": searchRegex },
        { "location.roadStreet": searchRegex },
        { "personal.username": searchRegex },
        { "additional.description": searchRegex },
        { "services.selected": searchRegex },
      ],
    };

    const total = await Profile.countDocuments(query);
    const profiles = await Profile.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      profiles,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Error in searchProfiles:", err);
    res.status(500).json({
      profiles: [],
      total: 0,
      page: 1,
      totalPages: 0,
      message: "Server error",
      error: err.message
    });
  }
};