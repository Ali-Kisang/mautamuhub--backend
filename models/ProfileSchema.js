import mongoose from "mongoose";

const profileSchema = new mongoose.Schema(
  {
    // Reference to the User who owns this profile
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, 
    },

    // Personal Info
    personal: {
      username: { type: String, required: true },
      phone: { type: String, required: true },
      gender: { type: String, required: true },
      age: { type: Number, required: true },
      complexity: { type: String },
      ethnicity: { type: String },
      orientation: {
        type: String,
        enum: ["Straight", "Gay", "Lesbian", "Bisexual", "Other"],
      },
      orientationOther: { type: String },
    },

    // Location
    location: {
      county: String,
      constituency: String,
      ward: String,
      localArea: String,
      roadStreet: String,
      city: String,
    },

    // Additional Info
    additional: {
      incallRate: String,
      outcallRate: String,
      description: String,
    },

    // Services
    services: {
      selected: [{ type: String }],
      custom: String,
    },

    // Account Type
    accountType: {
      type: {
        type: String,
        enum: ["Regular", "VIP", "VVIP", "Spa"],
        required: true,
      },
      amount: Number,
      duration: Number,
    },

    // Photos
    photos: {
      type: [String], 
      required: true,  
    },

    // ✅ Active status for expiry (default true)
    active: {
      type: Boolean,
      default: true,
    },

    // ✅ New: Trial flag (true if in 7-day free trial for this account type)
    isTrial: {
      type: Boolean,
      default: false,
    },

    // ✅ New: Expiry date for trial or paid period
    expiryDate: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Profile", profileSchema);