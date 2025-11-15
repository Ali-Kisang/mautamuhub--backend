import Transaction from '../models/Transaction.js';
import { initiateSTKPush } from '../utils/safaricom.js';
import Profile from '../models/ProfileSchema.js';  
import User from '../models/User.js'; 
import mongoose from 'mongoose';  
import { mpesaErrorMessages } from '../utils/mpesaCodes.js';

export const initiatePayment = async (req, res) => {
  try {
    const { amount, phone, accountType, duration, profileData } = req.body;
    const userId = req.user._id;

    if (amount <= 0) {
      return res.status(400).json({ code: 'INVALID_AMOUNT', error: 'Amount must be greater than 0' });
    }

    // ✅ TWEAK: Robust phone normalization (like prorate: strip non-digits, handle local/international)
    let normalizedPhone;
    if (phone) {
      const phoneStr = phone.toString().replace(/\D/g, '');
      if (phoneStr.startsWith('254')) {
        normalizedPhone = phoneStr;
      } else if (phoneStr.startsWith('07') && phoneStr.length === 10) {
        normalizedPhone = '254' + phoneStr.substring(1);
      } else {
        return res.status(400).json({ code: 'INVALID_PHONE', error: 'Invalid phone. Use 07xxxxxxxx or 2547xxxxxxxx.' });
      }
    } else {
      return res.status(400).json({ code: 'MISSING_PHONE', error: 'No phone provided.' });
    }

    // ✅ TWEAK: Validate M-Pesa format
    if (!normalizedPhone.startsWith('2547')) {
      return res.status(400).json({ code: 'INVALID_PHONE', error: 'Phone must be a valid Kenyan M-Pesa number starting with 2547.' });
    }

    console.log(`📞 Normalized phone for payment: ${normalizedPhone}`); // ✅ DEBUG

    const accountRef = `Account-${accountType}-${Date.now()}`;
    const transactionDesc = `Payment for ${accountType} (${duration} days)`;

    // Step 1: Create pending transaction
    const transaction = await Transaction.create({
      user: userId,
      amount,
      phone: normalizedPhone,
      accountReference: accountRef,
      transactionDesc,
      accountType,
      duration,
      status: 'PENDING',
      queuedProfileData: profileData,
    });

    console.log(`🔑 Created pending tx ${transaction._id} for user ${userId}`);

    // Step 2: Trigger STK Push
    const stkResponse = await initiateSTKPush(
      normalizedPhone,
      amount,
      accountRef,
      transactionDesc
    );

    // ✅ TWEAK: Check STK response for errors
    if (stkResponse.error || !stkResponse.CheckoutRequestID) {
      console.error('❌ STK failed:', stkResponse.error || 'No CheckoutRequestID'); // ✅ DEBUG
      // Optionally mark tx as FAILED
      transaction.status = 'FAILED';
      transaction.resultDesc = stkResponse.error || 'STK initiation failed';
      await transaction.save();
      return res.status(500).json({ code: 'STK_PUSH_FAILED', error: stkResponse.error || 'Failed to send STK Push. Please try again.' });
    }

    transaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    await transaction.save();

    console.log(`💳 STK initiated: ${stkResponse.CheckoutRequestID} for tx ${transaction._id}`);

    res.json({
      success: true,
      message: 'STK Push initiated. Check your phone.',
      checkoutRequestID: stkResponse.CheckoutRequestID,
      transactionId: transaction._id,
    });
  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Payment initiation failed. Please try again later.' });
  }
};


// Handle M-Pesa Callback (with auto-retry support)
export const handleCallback = async (req, res) => {
  try {
    console.log('📨 M-Pesa Callback received:', JSON.stringify(req.body, null, 2));
    const { Body } = req.body;
    const callback = Body.stkCallback || {};
    const { CheckoutRequestID, ResultCode, ResultDesc } = callback;

    if (!CheckoutRequestID) {
      console.warn('⚠️ Invalid callback: No CheckoutRequestID');
      return res.status(200).json({ ResultCode: 1, ResultDesc: 'Invalid callback' });
    }

    const transaction = await Transaction.findOne({ checkoutRequestID: CheckoutRequestID });
    if (!transaction) {
      console.warn(`⚠️ Transaction not found for CheckoutRequestID: ${CheckoutRequestID}`);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    // Skip if already completed
    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(transaction.status)) {
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Already processed' });
    }

    // --- ✅ Handle Success ---
    if (ResultCode === 0) {
      transaction.status = 'SUCCESS';
      transaction.resultCode = ResultCode;
      transaction.resultDesc = ResultDesc;

      // Capture MpesaReceiptNumber
      if (callback.CallbackMetadata?.Item) {
        const receiptItem = callback.CallbackMetadata.Item.find(i => i.Name === 'MpesaReceiptNumber');
        if (receiptItem) transaction.mpesaReceiptNumber = receiptItem.Value;
      }

      // ✅ Update user balance & profile
      const user = await User.findById(transaction.user);
      if (user) {
        user.balance = (user.balance || 0) + transaction.amount;
        await user.save();
        console.log(`💰 Balance updated for ${user.username || user._id}`);
      }

      if (transaction.queuedProfileData) {
        const userId = new mongoose.Types.ObjectId(transaction.user);
        const profileData = {
          ...transaction.queuedProfileData,
          user: userId,
          active: true,
          isTrial: false,
          expiryDate: new Date(Date.now() + transaction.duration * 24 * 60 * 60 * 1000),
        };

        const profile = await Profile.findOneAndUpdate(
          { user: userId },
          { $set: profileData },
          { new: true, upsert: true, runValidators: true }
        );

        console.log(`✅ Profile finalized for ${user.username || user._id}`, profile._id);
        transaction.queuedProfileData = undefined;
      }

      await transaction.save();
      console.log(`💾 Tx ${CheckoutRequestID} marked SUCCESS`);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    // --- ⚠️ Handle temporary failure (ResultCode 2029) ---
    if (ResultCode === 2029) {
      const MAX_RETRIES = 2;
      const RETRY_DELAY_MS = 15000; // 15 seconds

      transaction.resultCode = ResultCode;
      transaction.resultDesc = ResultDesc;
      transaction.retryCount = (transaction.retryCount || 0) + 1;
      transaction.lastRetryAt = new Date();

      if (transaction.retryCount <= MAX_RETRIES) {
        transaction.status = 'RETRYING';
        await transaction.save();

        console.log(`🔁 Temporary failure (2029). Retrying in ${RETRY_DELAY_MS / 1000}s (Attempt ${transaction.retryCount}/${MAX_RETRIES})`);

        setTimeout(async () => {
          try {
            const retryResponse = await initiateSTKPush(
              transaction.phone,
              transaction.amount,
              transaction.accountReference,
              transaction.transactionDesc
            );

            if (retryResponse.error || !retryResponse.CheckoutRequestID) {
              console.error('Retry STK failed:', retryResponse.error || 'No CheckoutRequestID');
              transaction.status = 'FAILED';
              transaction.resultDesc = retryResponse.error || 'Retry failed';
              await transaction.save();
              return;
            }

            transaction.checkoutRequestID = retryResponse.CheckoutRequestID;
            transaction.status = 'PENDING';
            await transaction.save();

            console.log(`💳 Retried STK initiated: ${retryResponse.CheckoutRequestID} for tx ${transaction._id}`);
          } catch (retryError) {
            console.error('Retry STK Push failed:', retryError.message);
            transaction.status = 'FAILED';
            transaction.resultDesc = retryError.message;
            await transaction.save();
          }
        }, RETRY_DELAY_MS);
      } else {
        transaction.status = 'FAILED';
        transaction.resultDesc = ResultDesc;
        await transaction.save();
        console.log(`❌ Max retries reached for tx ${transaction._id}. Marked FAILED.`);
      }

      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    // --- ❌ Permanent failure ---
    transaction.status = 'FAILED';
    transaction.resultCode = ResultCode;
    transaction.resultDesc = mpesaErrorMessages[ResultCode] || ResultDesc;
    await transaction.save();

    console.log(`❌ Payment failed (${ResultCode}): ${ResultDesc}`);
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('Callback error:', error);
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
};


// handleValidation
export const handleValidation = async (req, res) => {
  console.log('🔍 M-Pesa Validation received:', JSON.stringify(req.body, null, 2));
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
};

// getMyTransactions
export const getMyTransactions = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);
    const transactions = await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate('user', 'username');
    
    console.log('📊 Returning transactions for user', userId, 
      transactions.map(t => ({ 
        checkoutRequestID: t.checkoutRequestID, 
        status: t.status, 
        resultCode: t.resultCode, 
        resultDesc: t.resultDesc?.substring(0, 50) + '...' 
      }))
    );
    
    res.json({ transactions });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ✅ UPDATED: getTransactionStatus - Now uses transactionId instead of checkoutRequestID for polling
export const getTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.query;
    if (!transactionId) {
      return res.status(400).json({ error: 'Missing transactionId' });
    }

    const tx = await Transaction.findById(transactionId).lean();
    if (!tx) {
      console.log('🔍 No tx found for polling:', transactionId);
      return res.status(404).json({ transaction: null });
    }

    console.log('🔍 Single tx query for polling:', { transactionId, status: tx.status, resultCode: tx.resultCode, resultDesc: tx.resultDesc?.substring(0, 50) + '...' });

    res.json({ transaction: tx });
  } catch (error) {
    console.error('Get tx status error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ✅ UPDATED: initiateProratePayment - Now POST with req.body, enhanced phone handling (use provided or profile), validation, error codes, and success: true
export const initiateProratePayment = async (req, res) => {
  try {
    const { userId, phone, amount, newType } = req.body; // ✅ TWEAK: Use req.body for POST
    if (!userId || !amount || !newType) {
      return res.status(400).json({ code: 'MISSING_FIELDS', error: 'Missing userId, amount, or newType' });
    }

    const parsedAmount = parseInt(amount);
    if (parsedAmount <= 0) {
      return res.status(400).json({ code: 'INVALID_AMOUNT', error: 'Invalid amount' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ code: 'USER_NOT_FOUND', error: 'User not found' });
    }

    const profile = await Profile.findOne({ user: userId }).lean();
    if (!profile || profile.accountType.type === newType || profile.active === false) {
      return res.status(400).json({ code: 'INVALID_UPGRADE', error: 'Invalid upgrade: No active profile or already upgraded' });
    }

    // ✅ TWEAK: Robust phone normalization (use provided or profile, to 2547xxxxxxxx)
    let normalizedPhone;
    if (phone) {
      const phoneStr = phone.toString().replace(/\D/g, '');
      if (phoneStr.startsWith('254')) {
        normalizedPhone = phoneStr;
      } else if (phoneStr.startsWith('07') && phoneStr.length === 10) {
        normalizedPhone = '254' + phoneStr.substring(1);
      } else {
        return res.status(400).json({ code: 'INVALID_PHONE', error: 'Invalid provided phone. Use 07xxxxxxxx or 2547xxxxxxxx.' });
      }
    } else {
      // Fallback to profile phone
      const profilePhoneStr = profile.personal.phone.toString().replace(/\D/g, '');
      if (profilePhoneStr.startsWith('07') && profilePhoneStr.length === 10) {
        normalizedPhone = '254' + profilePhoneStr.substring(1);
      } else {
        return res.status(400).json({ code: 'MISSING_PHONE', error: 'No valid phone in profile. Please provide one.' });
      }
    }

    // ✅ TWEAK: Validate M-Pesa format
    if (!normalizedPhone.startsWith('2547')) {
      return res.status(400).json({ code: 'INVALID_PHONE', error: 'Phone must be a valid Kenyan M-Pesa number starting with 2547.' });
    }

    console.log(`📞 Normalized phone for prorate: ${normalizedPhone}`); // ✅ DEBUG

    const ref = `Prorate-${newType}-${String(userId).slice(-6)}`;
    const desc = `Proration for ${newType} upgrade (${parsedAmount} Ksh)`;

    // ✅ TWEAK: Check STK response for errors
    const stkResponse = await initiateSTKPush(normalizedPhone, parsedAmount, ref, desc);

    if (stkResponse.error || !stkResponse.CheckoutRequestID) {
      console.error('❌ Prorate STK failed:', stkResponse.error || 'No CheckoutRequestID'); // ✅ DEBUG
      return res.status(500).json({ code: 'STK_PUSH_FAILED', error: stkResponse.error || 'Failed to send STK Push. Please try again.' });
    }

    const transaction = await Transaction.create({
      user: userId,
      checkoutRequestID: stkResponse.CheckoutRequestID,
      amount: parsedAmount,
      phone: normalizedPhone,
      accountReference: ref,
      transactionDesc: desc,
      accountType: newType,
      duration: profile.accountType.duration,
      status: 'PENDING',
    });

    console.log(`💳 Prorate STK initiated: ${stkResponse.CheckoutRequestID} for ${newType} (user ${userId}, amount ${parsedAmount})`);
    res.json({
      success: true,
      message: 'Proration payment initiated. Check your phone for M-Pesa PIN prompt.',
      checkoutRequestID: stkResponse.CheckoutRequestID,
      transactionId: transaction._id,
      amount: parsedAmount,
    });
  } catch (error) {
    console.error('Prorate initiation error:', error); // ✅ DEBUG
    res.status(500).json({ code: 'INTERNAL_ERROR', error: error.message });
  }
};