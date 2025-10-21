import Transaction from '../models/Transaction.js';
import { initiateSTKPush } from '../utils/safaricom.js';
import Profile from '../models/ProfileSchema.js';  
import User from '../models/User.js'; 
import mongoose from 'mongoose';  

export const initiatePayment = async (req, res) => {
  try {
    const { amount, phone, accountType, duration, profileData } = req.body;  
    const userId = req.user._id;  

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const normalizedPhone = phone.startsWith('254') ? phone : `254${phone.slice(1)}`;

    const accountRef = `Account-${accountType}-${Date.now()}`;
    const transactionDesc = `Payment for ${accountType} (${duration} days)`;

    // ✅ FIX: Create tx FIRST (pending, no CheckoutID yet)
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

    // Now STK (update tx after)
    const stkResponse = await initiateSTKPush(
      normalizedPhone,
      amount,
      accountRef,
      transactionDesc
    );

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
    res.status(500).json({ error: error.message });
  }
};

// Handle M-Pesa Callback
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

    console.log(`🔍 Searching tx for CheckoutRequestID: ${CheckoutRequestID}`);

    const transaction = await Transaction.findOne({ checkoutRequestID: CheckoutRequestID });
    if (!transaction) {
      console.warn(`⚠️ Transaction not found for CheckoutRequestID: ${CheckoutRequestID}`);
      // ✅ FIX: Log recent tx for debug
      const recentTx = await Transaction.find({}).sort({ createdAt: -1 }).limit(5).select('checkoutRequestID status createdAt');
      console.log('Recent tx IDs:', recentTx.map(t => ({ id: t.checkoutRequestID, status: t.status, created: t.createdAt })));
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    if (transaction.status !== 'PENDING') {
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    transaction.status = ResultCode === 0 ? 'SUCCESS' : 'FAILED';
    transaction.resultCode = ResultCode;
    transaction.resultDesc = ResultDesc;

    if (ResultCode === 0) {
      if (callback.CallbackMetadata?.Item) {
        const receiptItem = callback.CallbackMetadata.Item.find(item => item.Name === 'MpesaReceiptNumber');
        if (receiptItem) transaction.mpesaReceiptNumber = receiptItem.Value;
      }

      const user = await User.findById(transaction.user);
      if (user) {
        user.balance += transaction.amount;
        await user.save();
        console.log(`💰 Added ${transaction.amount} Ksh to balance for user ${user.username || user._id} (new balance: ${user.balance})`);
      }

      const queuedProfile = transaction.queuedProfileData;
      if (queuedProfile) {
        const userId = new mongoose.Types.ObjectId(transaction.user);
        const profileData = {
          ...queuedProfile,
          user: userId,
          active: true,
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
        transaction.queuedProfileData = undefined;
      }
    } else {
      console.log('❌ Payment failed:', ResultDesc);
    }

    await transaction.save();
    console.log(`💾 Saved tx ${CheckoutRequestID} with final status: ${transaction.status}`);

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

// getTransactionStatus
export const getTransactionStatus = async (req, res) => {
  try {
    const { checkoutRequestID } = req.query;
    if (!checkoutRequestID) {
      return res.status(400).json({ error: 'Missing checkoutRequestID' });
    }

    const tx = await Transaction.findOne({ checkoutRequestID }).lean();
    if (!tx) {
      console.log('🔍 No tx found for polling:', checkoutRequestID);
      return res.status(404).json({ transaction: null });
    }

    console.log('🔍 Single tx query for polling:', { checkoutRequestID, status: tx.status, resultCode: tx.resultCode, resultDesc: tx.resultDesc?.substring(0, 50) + '...' });

    res.json({ transaction: tx });
  } catch (error) {
    console.error('Get tx status error:', error);
    res.status(500).json({ error: error.message });
  }
};

// initiateProratePayment
export const initiateProratePayment = async (req, res) => {
  try {
    const { userId, amount, newType } = req.query;
    if (!userId || !amount || !newType) {
      return res.status(400).json({ error: 'Missing userId, amount, or newType' });
    }

    const parsedAmount = parseInt(amount);
    if (parsedAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const profile = await Profile.findOne({ user: userId }).lean();
    if (!profile || profile.accountType.type === newType || profile.active === false) {
      return res.status(400).json({ error: 'Invalid upgrade: No active profile or already upgraded' });
    }

    const phone = profile.personal.phone.startsWith('254') ? profile.personal.phone : `254${profile.personal.phone.slice(1)}`;

    const ref = `Prorate-${newType}-${String(userId).slice(-6)}`;
    const desc = `Proration for ${newType} upgrade (${parsedAmount} Ksh)`;

    const stkResponse = await initiateSTKPush(phone, parsedAmount, ref, desc);

    const transaction = await Transaction.create({
      user: userId,
      checkoutRequestID: stkResponse.CheckoutRequestID,
      amount: parsedAmount,
      phone,
      accountReference: ref,
      transactionDesc: desc,
      accountType: newType,
      duration: profile.accountType.duration,
      status: 'PENDING',
    });

    console.log(`💳 Prorate STK initiated: ${stkResponse.CheckoutRequestID} for ${newType} (user ${userId}, amount ${parsedAmount})`);
    res.json({
      requiresPayment: true,
      message: 'Proration payment initiated. Check your phone for M-Pesa PIN prompt.',
      checkoutRequestID: stkResponse.CheckoutRequestID,
      transactionId: transaction._id,
      amount: parsedAmount,
    });
  } catch (error) {
    console.error('Prorate initiation error:', error);
    res.status(500).json({ error: error.message });
  }
};