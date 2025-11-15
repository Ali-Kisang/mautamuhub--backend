import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import path from 'node:path';
import Transaction from '../../models/Transaction.js';  // Adjust path to your models
import Profile from '../../models/ProfileSchema.js';
import User from '../../models/User.js';
import dotenv from 'dotenv';

// Define __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the server root (adjust relative path if needed)
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Manual Script: Create dummy transactions for active trials to sync with display logic
const createDummyTransactionsForTrials = async () => {
  try {
    console.log('🔄 Starting dummy transaction creation for active trials...');
    
    // Find all active trials (from reactivation script)
    const activeTrials = await Profile.find({ 
      active: true, 
      isTrial: true 
    }).populate('user', 'username email phone balance');

    if (activeTrials.length === 0) {
      console.log('ℹ️ No active trials found.');
      return;
    }
    
    console.log(`📊 Found ${activeTrials.length} active trials to process.`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const profile of activeTrials) {
      const { user, _id: profileId } = profile;
      const userId = user._id;
      
      // Check if dummy tx already exists (avoid duplicates)
      const existingTx = await Transaction.findOne({ 
        user: userId, 
        accountType: 'Trial', 
        status: 'SUCCESS',
        amount: 0  // Dummy free
      });
      
      if (existingTx) {
        console.log(`⏭️ Skipping ${user.username}: Dummy tx already exists (${existingTx._id}).`);
        successCount++;
        continue;
      }
      
      try {
        // Create dummy successful transaction for trial
        const dummyTx = await Transaction.create({
          user: userId,
          amount: 0,  // Free trial
          phone: user.phone || '254700000000',  // Fallback if no phone
          accountReference: `Trial-Dummy-${Date.now()}-${userId.toString().slice(-4)}`,
          transactionDesc: 'Manual 30-Day Trial Reactivation',
          accountType: 'Trial',  // Custom type for trials
          duration: 30,
          status: 'SUCCESS',
          resultCode: 0,
          resultDesc: 'Manual reactivation - no payment required',
          mpesaReceiptNumber: 'TRIAL-' + userId.toString().slice(-6),  // Dummy receipt
          checkoutRequestID: 'TRIAL-' + Date.now(),  // Dummy ID
          createdAt: new Date(Date.now() - 3600000),  // 1 hour ago to simulate past
          queuedProfileData: undefined  // No queued data needed
        });
        
        // Update user balance (no change, but log)
        await User.findByIdAndUpdate(userId, { 
          $inc: { balance: 0 }  // Placeholder
        });
        
        // Ensure profile expiry is set (redundant but safe)
        const now = new Date();
        const expiryDate = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));  // 30 days from now
        await Profile.findByIdAndUpdate(profileId, {
          $set: { 
            active: true,
            isTrial: true,
            expiryDate: expiryDate,
            'accountType.type': 'Trial',  // Set type to 'Trial' for grouping
            'accountType.amount': 0,
            'accountType.duration': 30
          }
        });
        
        console.log(`✅ Created dummy tx for ${user.username}: ${dummyTx._id} (Expiry: ${expiryDate.toISOString().split('T')[0]})`);
        successCount++;
        
      } catch (txError) {
        console.error(`❌ Error creating tx for ${user.username}:`, txError.message);
        errorCount++;
      }
    }
    
    console.log(`🎉 Complete! Success: ${successCount}, Errors: ${errorCount}`);
    console.log('💡 Now restart server & refresh site—trials should appear in grouped displays (e.g., /counties/grouped will include "Trial" type).');
    
  } catch (error) {
    console.error('❌ Script error:', error);
  }
};

// Connect and run
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mautamuhub')
  .then(() => {
    console.log('✅ Connected to MongoDB');
    createDummyTransactionsForTrials().finally(() => {
      mongoose.connection.close();
      console.log('🔌 MongoDB connection closed.');
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });