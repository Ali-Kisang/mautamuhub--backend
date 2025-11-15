import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import path from 'node:path';
import Profile from '../../models/ProfileSchema.js';
import User from '../../models/User.js';  // ✅ ADD: Import User model to register schema for populate
import dotenv from 'dotenv';

// Define __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the server root (from jobs/ → ../../.env)
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Manual Reactivation Script: Reactivate all deactivated profiles with new 30-day trial
const reactivateAllDeactivatedProfiles = async () => {
  try {
    console.log('🔄 Starting manual reactivation of all deactivated profiles...');
    
    // Find all deactivated profiles (active: false)
    const deactivatedProfiles = await Profile.find({ active: false })
      .populate('user', 'username email');
    
    if (deactivatedProfiles.length === 0) {
      console.log('ℹ️ No deactivated profiles found.');
      return;
    }
    
    console.log(`📊 Found ${deactivatedProfiles.length} deactivated profiles.`);
    
    // Calculate new expiry: 30 days from now
    const now = new Date();
    const newExpiry = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
    
    // Update all in batch
    const result = await Profile.updateMany(
      { active: false },
      {
        $set: {
          active: true,
          isTrial: true,
          expiryDate: newExpiry,
          // Reset accountType to trial defaults if needed (assuming trial has no type/amount)
          'accountType.type': null,
          'accountType.amount': 0,
          'accountType.duration': 30,
        }
      }
    );
    
    console.log(`✅ Successfully reactivated ${result.modifiedCount} profiles with new 30-day trials.`);
    console.log(`📅 New expiry date for all: ${newExpiry.toISOString().split('T')[0]}`);
    
    // Optional: Log the reactivated users
    const reactivatedUsers = deactivatedProfiles.map(p => ({
      username: p.user?.username || 'Unknown',
      email: p.user?.email || 'Unknown',
      oldExpiry: p.expiryDate?.toISOString().split('T')[0] || 'N/A'
    }));
    console.table(reactivatedUsers);
    
    // Optional: Send notification emails to inform users of reactivation
    for (const profile of deactivatedProfiles) {
      await sendReactivationNotification(profile, newExpiry);
    }
    
    console.log('🎉 Reactivation complete! Profiles are now active with fresh trials.');
    
  } catch (error) {
    console.error('❌ Error during reactivation:', error);
  }
};

// Notification for reactivation
const sendReactivationNotification = async (profile, newExpiry) => {
  const { default: nodemailer } = await import('nodemailer');
  const transporter = nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
  
  const { user } = profile;
  const reactivationLink = `https://mautamuhub.com/dashboard?userId=${user._id}`;
  
  const mailOptions = {
    from: `"Mautamuhub Alerts" <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: `🎉 Great News: Your Profile Has Been Reactivated with a New 30-Day Trial!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center;">
        <h2 style="color: #10b981; font-size: 28px; margin-bottom: 20px; font-weight: bold;">Profile Reactivated!</h2>
        <p style="color: #555; line-height: 1.6; margin-bottom: 15px;">Hello ${user.username || 'User'},</p>
        <p style="color: #555; line-height: 1.6; margin-bottom: 25px;">We've manually reactivated your profile and started a fresh 30-day trial period for you. Enjoy full access and visibility!</p>
        <ul style="color: #666; text-align: left; max-width: 400px; margin: 0 auto 25px;">
          <li>Active until: ${newExpiry.toISOString().split('T')[0]}</li>
          <li>Priority listing and enhanced features unlocked.</li>
          <li>No payment required – this is on us!</li>
        </ul>
        <a href="${reactivationLink}" style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px auto; font-weight: bold; box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3); transition: transform 0.2s ease;">View Dashboard</a>
        <p style="color: #777; line-height: 1.6; margin-bottom: 30px; font-style: italic;">If you have questions, reply to this email.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; line-height: 1.6; margin: 0;">Best regards,<br><strong>Mautamuhub Team</strong></p>
      </div>
    `,
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Sent reactivation email to ${user.email}`);
  } catch (error) {
    console.error(`❌ Failed to send reactivation email to ${user.email}:`, error.message);
  }
};

// Connect to MongoDB and run the script only after connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mautamuhub')
  .then(() => {
    console.log('✅ Connected to MongoDB');
    console.log(`📊 Using DB URI: ${process.env.MONGO_URI ? 'Loaded from .env' : 'Fallback to localhost'}`);
    reactivateAllDeactivatedProfiles().finally(() => {
      mongoose.connection.close();
      console.log('🔌 MongoDB connection closed.');
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });