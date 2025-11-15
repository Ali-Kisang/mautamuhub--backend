import User from "../models/User.js";
import Profile from "../models/ProfileSchema.js";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    // Ensure user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Parse nested FormData fields (e.g., personal[phone])
    const personal = {};
    const location = {};
    const additional = {};
    const services = { selected: [], custom: "" };
    const accountType = {};

    // Helper to parse nested fields
    const parseNested = (prefix, target) => {
      Object.keys(req.body).forEach((key) => {
        if (key.startsWith(`${prefix}[`)) {
          const subKey = key.slice(prefix.length + 1, -1); // Extract inner key
          if (prefix === "services" && key.startsWith(`${prefix}[selected][`)) {
            const index = key.match(/\[(\d+)\]/)?.[1];
            if (index !== undefined) {
              services.selected[parseInt(index)] = req.body[key];
            }
          } else {
            target[subKey] = req.body[key];
          }
        }
      });
    };

    parseNested("personal", personal);
    parseNested("location", location);
    parseNested("additional", additional);
    parseNested("accountType", accountType);

    // Handle services custom
    if (req.body["services[custom]"]) {
      services.custom = req.body["services[custom]"];
    }

    // Validate accountType type enum
    if (accountType.type && !["Regular", "VIP", "VVIP", "Spa"].includes(accountType.type)) {
      return res.status(400).json({ error: "Invalid account type" });
    }

    // Handle photos: Merge new uploads with existing
    let photos = [];
    if (req.files && req.files.length > 0) {
      const newPhotos = req.files.map((file) => `/uploads/${file.filename}`);
      // Fetch existing profile to merge photos
      const existingProfile = await Profile.findOne({ user: userId });
      photos = existingProfile ? [...(existingProfile.photos || []), ...newPhotos] : newPhotos;
    }

    // Upsert profile (create if none, update if exists)
    const profile = await Profile.findOneAndUpdate(
      { user: userId },
      {
        user: userId,
        personal,
        location,
        additional,
        services,
        accountType,
        photos: photos || undefined, // Only set if new photos provided
      },
      { upsert: true, new: true, runValidators: true }
    ).populate("user", "-password");

    res.json(profile);
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getUsers = async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user.id } });
  res.json(users);
};

// Get another user's profile by ID (updated to include statusBadge for trials)
export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params; 

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const profile = await Profile.findOne({ user: id }).populate("user", "-password -pushSubscription");

    let userData;

    if (!profile) {
      const user = await User.findById(id).select("-password -pushSubscription");
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      userData = user;
    } else {
      // Enrich profile with statusBadge (handles trials)
      const enrichedProfile = {
        ...profile.toObject(),
        statusBadge: profile.isTrial ? 'Trial' : `${profile.accountType?.type || 'Regular'} Active`
      };
      userData = enrichedProfile.user;
      res.json({ user: userData, profile: enrichedProfile });  // Include full enriched profile
      return;  // Early return since we have profile
    }

    res.json({ user: userData });
  } catch (error) {
    console.error("Fetch profile error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// GET /api/users/profile-by-id/:id
export const getProfileById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid profile ID" });
    }

    const profile = await Profile.findById(id).populate("user", "-password");

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.json(profile);
  } catch (error) {
    console.error("Error fetching profile by ID:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// NEW: Get all active profiles for directory (includes paid + trials)
export const getAllProfiles = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;  // Optional pagination & search
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Query: Active paid OR active trials
    const query = {
      active: true,
      $or: [
        { 'accountType.type': { $in: ['VIP', 'VVIP', 'Spa'] } },  // Paid types (adjust enum if needed)
        { isTrial: true }  // Trials
      ]
    };

    // Optional search (e.g., by username)
    if (search) {
      query['user.username'] = { $regex: search, $options: 'i' };
    }

    const profiles = await Profile.find(query)
      .populate('user', 'username email phone bio avatar')  // Populate user fields
      .sort({ expiryDate: -1 })  // Fresh trials first
      .skip(skip)
      .limit(parseInt(limit));

    // Enrich with badges
    const enrichedProfiles = profiles.map(profile => ({
      ...profile.toObject(),
      statusBadge: profile.isTrial ? 'Trial' : `${profile.accountType.type || 'Regular'} Active`
    }));

    // Total count for pagination
    const total = await Profile.countDocuments(query);

    res.json({
      profiles: enrichedProfiles,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Get all profiles error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Check if user has a profile (GET /api/users/check-profile)
export const checkUserProfile = async (req, res) => {
  try {
    const userId = mongoose.Types.ObjectId.isValid(req.user.id) 
      ? new mongoose.Types.ObjectId(req.user.id) 
      : req.user.id;

    // Ensure user exists (with balance & avatar) – use inclusion projection
    const user = await User.findById(userId).select("email username avatar balance");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Fetch profile without 'active' filter – returns expired too
    const profile = await Profile.findOne({ user: userId })
      .populate("user", "email username avatar balance")  // ✅ Inclusion projection (no password)
      .lean();  // Faster read-only

    const hasProfile = !!profile;  // true if doc exists (active or not)
    const balance = profile?.user?.balance || user.balance || 0;  // Prioritize populated

    if (!profile) {
      
      return res.status(200).json({ 
        hasProfile: false, 
        profile: null, 
        balance,
        avatar: user.avatar || null,
        message: "Profile not found. Please create one." 
      });
    }

    // ✅ Log expiry status (no auto-deactivate here – cron handles)
    const isExpired = !profile.active;
    
    res.status(200).json({ 
      hasProfile: true, 
      profile,  // Full doc (active or expired)
      balance,
      avatar: user.avatar || null 
    });
  } catch (error) {
  
    res.status(500).json({ message: "Server error" });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ message: 'Valid email is required.' });
    }


    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'Email does not exist. Please Register.' });
    }

    // Generate reset token (expires in 1 hour)
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save token to user
    user.resetPasswordToken = token;
    user.resetPasswordExpires = expires;
    await user.save();

    // Setup Nodemailer transporter with Hostinger SMTP (tweaked for port 587)
    const transporter = nodemailer.createTransport({  // Fixed: createTransport, not createTransporter
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: false, // For port 587 with STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Removed tls block to let Nodemailer handle STARTTLS naturally
    });

    // Verify SMTP connection
    console.log('Attempting SMTP verify...');
    try {
      await new Promise((resolve, reject) => {
        transporter.verify((error, success) => {
          if (error) {
            console.error('SMTP Verify Error:', error.message);
            reject(error);
          } else {
            console.log('SMTP Server is ready to take our messages');
            resolve(success);
          }
        });
      });
    } catch (verifyErr) {
      console.error('SMTP Verify Failed:', verifyErr);
      return res.status(500).json({ message: 'SMTP connection failed. Please try again later.' });
    }

    // Email options
    const resetUrl = `${process.env.BASE_URL}/reset-password?token=${token}`;
    const mailOptions = {
      from: `"Password Reset" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center;">
          <h2 style="color: #333; font-size: 28px; margin-bottom: 20px; font-weight: bold;">Password Reset</h2>
          <p style="color: #555; line-height: 1.6; margin-bottom: 15px;">Hello,</p>
          <p style="color: #555; line-height: 1.6; margin-bottom: 25px;">You requested a password reset. Click the link below to set a new password:</p>
          <a href="${resetUrl}" style="background: linear-gradient(135deg, #FFC0CB, #FF99CC); color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px auto; font-weight: bold; box-shadow: 0 4px 8px rgba(255, 192, 203, 0.3); transition: transform 0.2s ease;">Reset Password</a>
          <p style="color: #555; line-height: 1.6; margin-bottom: 15px;">This link expires in 1 hour.</p>
          <p style="color: #777; line-height: 1.6; margin-bottom: 30px; font-style: italic;">If you didn't request this, ignore this email.</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
          <p style="color: #666; line-height: 1.6; margin: 0;">Best,<br><strong>Mautahub Team</strong></p>
        </div>
      `,
    };

    // Send email
    console.log('Sending email to:', email);
    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully!');

    res.status(200).json({ message: 'Password reset email sent successfully.' });
  } catch (error) {
    console.error('Forgot Password Error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};

export const resetPassword = async (req, res) => {
  try {
    

    const { token, newPassword } = req.body;
    if (!token || !newPassword) {

      return res.status(400).json({ message: 'Token and new password are required.' });
    }

    if (newPassword.length < 6) {
      
      return res.status(400).json({ message: 'Password too short.' });
    }

    // Verify token (with secret check)
    let decoded;
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET not set in .env');
      }
      decoded = jwt.verify(token, process.env.JWT_SECRET);
     
    } catch (jwtErr) {
      
      return res.status(400).json({ message: 'Invalid token.' });
    }

    // Validate userId is ObjectId
    if (!mongoose.Types.ObjectId.isValid(decoded.userId)) {
      console.log('400: Invalid userId from token'); // Debug
      return res.status(400).json({ message: 'Invalid token.' });
    }

    const user = await User.findById(decoded.userId).select('resetPasswordToken resetPasswordExpires');
    

    if (!user || user.resetPasswordExpires < new Date()) {
     
      return res.status(400).json({ message: 'Invalid or expired token.' });
    }

    // Hash new password
    let hashedPassword;
    try {
      hashedPassword = await bcrypt.hash(newPassword, 12);
     
    } catch (hashErr) {
      
      return res.status(500).json({ message: 'Password hashing failed.' });
    }

    // Atomic update (bypass hooks)
    const updatedUser = await User.findByIdAndUpdate(
      decoded.userId,
      {
        password: hashedPassword,
        resetPasswordToken: undefined,
        resetPasswordExpires: undefined,
      },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
     
      return res.status(500).json({ message: 'Failed to update password.' });
    }

   

    res.status(200).json({ message: 'Password reset successful. Please log in.' });
  } catch (error) {
    
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};