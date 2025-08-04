import mongoose from "mongoose";

const profileSchema = new mongoose.Schema(
  {
    // Reference to the User who owns this profile
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // each user has one profile
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
    photos: 
      {
        type: [String], required: true,  
      },
    
  },
  { timestamps: true }
);

export default mongoose.model("Profile", profileSchema);
