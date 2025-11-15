import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import path from 'node:path';
import Profile from '../../models/ProfileSchema.js';
import User from '../../models/User.js';
import dotenv from 'dotenv';

// Define __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the server root
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Manual Script: Extend all active trial profiles to 30 days from today (Nov 15, 2025 → Dec 15, 2025)
const extendTrialsTo30Days = async () => {
  try {
    console.log('🔄 Starting trial extension to 30 days from today...');
    
    // Find all active trial profiles
    const activeTrials = await Profile.find({ 
      active: true, 
      isTrial: true 
    }).populate('user', 'username email phone balance');

    if (activeTrials.length === 0) {
      console.log('ℹ️ No active trials found.');
      return;
    }
    
    console.log(`📊 Found ${activeTrials.length} active trials to extend.`);
    
    const now = new Date('2025-11-15T00:00:00.000Z');  // Current date: Nov 15, 2025
    const newExpiry = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));  // Dec 15, 2025
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const profile of activeTrials) {
      const { user, _id: profileId } = profile;
      const userId = user._id;
      
      try {
        // Update profile: Extend expiry, set as Regular (valid enum) for display grouping
        await Profile.findByIdAndUpdate(profileId, {
          $set: { 
            active: true,
            isTrial: true,
            expiryDate: newExpiry,
            'accountType.type': 'Regular',  // Use 'Regular' (valid enum: ['Regular', 'VIP', 'VVIP', 'Spa'])
            'accountType.amount': 0,  // Free
            'accountType.duration': 30
          }
        });
        
        // Optional: Log to user (no balance change for free trial)
        console.log(`✅ Extended ${user.username}: Expiry now ${newExpiry.toISOString().split('T')[0]} (30 days)`);
        successCount++;
        
      } catch (updateError) {
        console.error(`❌ Error extending ${user.username}:`, updateError.message);
        errorCount++;
      }
    }
    
    console.log(`🎉 Extension complete! Success: ${successCount}, Errors: ${errorCount}`);
    console.log(`📅 All trials now expire on: ${newExpiry.toISOString().split('T')[0]}`);
    console.log('💡 Cron will deactivate after Dec 15, 2025. Refresh site—trials should appear in "Regular" groupings (e.g., /counties/grouped).');
    
  } catch (error) {
    console.error('❌ Script error:', error);
  }
};

// Connect and run
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mautamuhub')
  .then(() => {
    console.log('✅ Connected to MongoDB');
    extendTrialsTo30Days().finally(() => {
      mongoose.connection.close();
      console.log('🔌 MongoDB connection closed.');
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });