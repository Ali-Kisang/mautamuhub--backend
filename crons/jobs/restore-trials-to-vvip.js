import mongoose from "mongoose";
import dotenv from "dotenv";
import Profile from "../../models/ProfileSchema.js";
import User from "../../models/User.js";   // <-- REQUIRED IMPORT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });

const restoreToVVIP = async () => {
  console.log("🔄 Restoring all trial accounts to VVIP...");

  try {
    const trialProfiles = await Profile.find({
      active: true,
      isTrial: true
    }).populate("user", "username");

    if (trialProfiles.length === 0) {
      console.log("ℹ️ No trial profiles found.");
      return;
    }

    console.log(`📊 Restoring ${trialProfiles.length} trial users to VVIP...`);

    let success = 0;
    let failed = 0;

    for (const profile of trialProfiles) {
      try {
        await Profile.findByIdAndUpdate(profile._id, {
          $set: {
            "accountType.type": "VVIP",
            "accountType.amount": 0,
            "accountType.duration": 30,
            isTrial: true,
            active: true
          }
        });

        console.log(`✅ Restored ${profile.user?.username || "Unknown"} → VVIP`);
        success++;
      } catch (err) {
        console.log(`❌ Error restoring ${profile.user?.username}: ${err.message}`);
        failed++;
      }
    }

    console.log("🎉 Restore completed!");
    console.log(`✔ Success: ${success}`);
    console.log(`❌ Failed: ${failed}`);
  } catch (err) {
    console.error("❌ Script error:", err);
  }
};

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB");
    restoreToVVIP().finally(() => {
      mongoose.connection.close();
      console.log("🔌 MongoDB connection closed.");
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });
