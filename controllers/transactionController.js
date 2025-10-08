import Transaction from '../models/Transaction.js';
import { initiateSTKPush } from '../utils/safaricom.js';
import Profile from '../models/ProfileSchema.js';  
import mongoose from 'mongoose';  // Add for ObjectId conversion

// Initiate payment for account type (called from profile update)
export const initiatePayment = async (req, res) => {
  try {
    const { amount, phone, accountType, duration, profileData } = req.body;  
    const userId = req.user._id;  

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    // Normalize phone
    const normalizedPhone = phone.startsWith('254') ? phone : `254${phone.slice(1)}`;

    // Build unique reference and description
    const accountRef = `Account-${accountType}-${String(userId).slice(-6)}`;
    const transactionDesc = `Payment for ${accountType} (${duration} days)`;

    // Initiate STK Push first (ensures CheckoutRequestID before DB write)
    console.log('🔑 Initiating STK Push with phone:', normalizedPhone, 'amount:', amount);
    const stkResponse = await initiateSTKPush(
      normalizedPhone,
      amount,
      accountRef,
      transactionDesc
    );

    // Now create transaction with queued profile data (no profile save yet)
    const transaction = await Transaction.create({
      user: userId,
      checkoutRequestID: stkResponse.CheckoutRequestID,
      amount,
      phone: normalizedPhone,
      accountReference: accountRef,
      transactionDesc,
      accountType,
      duration,
      queuedProfileData: profileData,  // Queue full profile payload (use schema's Mixed field)
    });

    console.log(`💳 STK initiated: ${stkResponse.CheckoutRequestID} for user ${userId} (profile queued)`);
    res.json({
      success: true,
      message: 'STK Push initiated. Check your phone.',
      checkoutRequestID: stkResponse.CheckoutRequestID,
      transactionId: transaction._id,
    });
  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({ error: error.message });
  }
};


// Handle M-Pesa Callback (POST /api/payments/callback)
export const handleCallback = async (req, res) => {
  try {
    console.log('📨 M-Pesa Callback received:', JSON.stringify(req.body, null, 2));
    const { Body } = req.body;  // M-Pesa callback format: { Body: { stkCallback: { ... } } }
    const callback = Body.stkCallback || {};
    const { CheckoutRequestID, ResultCode, ResultDesc } = callback;

    if (!CheckoutRequestID) {
      console.warn('⚠️ Invalid callback: No CheckoutRequestID');
      return res.status(200).json({ ResultCode: 1, ResultDesc: 'Invalid callback' });
    }

    // Find transaction
    const transaction = await Transaction.findOne({ checkoutRequestID: CheckoutRequestID });
    if (!transaction) {
      console.warn('⚠️ Transaction not found for CheckoutRequestID:', CheckoutRequestID);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });  // Ack anyway
    }

    // Update transaction
    transaction.status = ResultCode === 0 ? 'SUCCESS' : 'FAILED';
    transaction.resultCode = ResultCode;
    transaction.resultDesc = ResultDesc;

    if (ResultCode === 0) {
      // Extract receipt from metadata if success
      if (callback.CallbackMetadata?.Item) {
        const receiptItem = callback.CallbackMetadata.Item.find(item => item.Name === 'MpesaReceiptNumber');
        if (receiptItem) transaction.mpesaReceiptNumber = receiptItem.Value;
      }

      // Success: Finalize profile update (only now!)
      const queuedProfile = transaction.queuedProfileData;
      if (queuedProfile) {
        const userId = new mongoose.Types.ObjectId(transaction.user);
        const profileData = {
          ...queuedProfile,
          user: userId,  // Add user back for upsert
          active: true,  // ✅ Ensure active on upgrade (reactivates expired profiles)
          // ✅ Trial flip & expiry already queued; ensure set (for paid upgrade)
          isTrial: false,
          expiryDate: new Date(Date.now() + transaction.duration * 24 * 60 * 60 * 1000),
        };

        const profile = await Profile.findOneAndUpdate(
          { user: userId },
          { $set: profileData },
          { new: true, upsert: true, runValidators: true }
        ).populate('user', 'email username avatar');

        console.log('✅ Profile finalized after payment:', profile._id, 
          'active:', profile.active, 
          'isTrial:', profile.isTrial, 
          'expires:', profile.expiryDate,
          'with photos:', profile.photos?.length || 0
        );
        // Clear queued data
        transaction.queuedProfileData = undefined;
      }
    } else {
      console.log('❌ Payment failed:', ResultDesc);
    }

    await transaction.save();

    // Always respond 200 OK to M-Pesa to acknowledge (prevents retries)
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('Callback error:', error);
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });  // Ack even on error
  }
};


// Optional: Validate transaction (if using validation URL)
export const handleValidation = async (req, res) => {
  console.log('🔍 M-Pesa Validation received:', JSON.stringify(req.body, null, 2));
  // For STK Push, validation is often skipped; just ack
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
};

// Get user transactions (GET /api/payments/my-transactions)
export const getMyTransactions = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);  // Ensure ObjectId
    const transactions = await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate('user', 'username');
    res.json({ transactions });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: error.message });
  }
};