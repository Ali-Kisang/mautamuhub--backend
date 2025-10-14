import cron from 'node-cron';


import mongoose from 'mongoose';
import ProfileSchema from '../../models/ProfileSchema.js';
import User from '../../models/User.js';
import Transaction from '../../models/Transaction.js';

// Existing: Trial Expiry Cron
export const scheduleTrialExpiry = () => {
  cron.schedule('0 0 * * *', async () => {
    console.log('🕐 Running daily expiry check for all profiles (trials & paid)...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    try {
      const expiredProfiles = await ProfileSchema.find({
        active: true,
        expiryDate: { $lte: today },
      }).populate('user', 'username email');
      if (expiredProfiles.length === 0) {
        console.log('✅ No expiries today.');
        return;
      }
      const profileIds = expiredProfiles.map(p => p._id);
      await Profile.updateMany(
        { _id: { $in: profileIds } },
        { $set: { active: false } }
      );
      console.log(`⏰ Expired ${expiredProfiles.length} profiles:`, 
        expiredProfiles.map(p => {
          const type = p.accountType?.type || 'Unknown';
          const trial = p.isTrial ? ' (Trial)' : '';
          return `${p.user?.username || 'Unknown'} (${type}${trial}): expires ${p.expiryDate.toISOString().split('T')[0]} – ID: ${p._id}`;
        })
      );
      for (const profile of expiredProfiles) {
        if (profile.isTrial) {
          await sendExpiryNotification(profile);
        }
      }
    } catch (error) {
      console.error('❌ Expiry cron error:', error);
    }
  }, { timezone: 'Africa/Nairobi' });
  console.log('🔄 Unified expiry cron with notifications scheduled (daily at midnight).');
};

// Existing: sendExpiryNotification
const sendExpiryNotification = async (profile) => {
  const { default: nodemailer } = await import('nodemailer');  
  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  const { user, accountType, isTrial } = profile;
  const type = accountType?.type || 'account';
  const trialText = isTrial ? 'trial' : 'subscription';
  const upgradeLink = `https://yourapp.com/upgrade?userId=${user._id}`;
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: `Your ${type} ${trialText} has expired – Upgrade today!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #ec4899;">Hi ${user.username || 'User'},</h2>
        <p>Your 7-day free ${type} trial has ended. You've been unlisted, but you can reactivate with a quick upgrade!</p>
        <ul style="color: #666;">
          <li>Enjoy priority visibility and more features.</li>
          <li>${type} plan: Ksh ${accountType?.amount || 0} for ${accountType?.duration || 7} days.</li>
        </ul>
        <a href="${upgradeLink}" style="background: #ec4899; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Upgrade Now</a>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">Need help? Reply to this email or visit <a href="https://yourapp.com/support">support</a>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 11px; color: #ccc;">This is an automated message from YourApp. © 2025</p>
      </div>
    `,
  };
  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Expiry email sent to ${user.email} for ${type} ${trialText}`);
  } catch (error) {
    console.error(`❌ Failed to send email to ${user.email}:`, error.message);
  }
};

// New: sendUpgradePromptEmail
const sendUpgradePromptEmail = async (user, upgradeDetails) => {
  const { default: nodemailer } = await import('nodemailer');  
  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  const { email, username } = user;
  const { oldType, newType, remainingDays, proratedAmount, neededAmount } = upgradeDetails;
  const paymentLink = `https://yourapp.com/payments/prorate-upgrade?userId=${user._id}&amount=${neededAmount}&newType=${newType}`;
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: `Complete Your ${newType} Upgrade – Pay ${neededAmount} Ksh Proration`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #ec4899;">Hi ${username},</h2>
        <p>Congratulations on upgrading from ${oldType} to ${newType}! We've detected ${remainingDays} days left on your current plan.</p>
        <p>To activate your new plan immediately, pay the prorated difference: <strong>${proratedAmount} Ksh</strong>.</p>
        <p>Your current balance: <strong>${user.balance || 0} Ksh</strong><br>
        Amount needed: <strong>${neededAmount} Ksh</strong></p>
        <a href="${paymentLink}" style="background: #ec4899; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Pay Proration Now</a>
        <p style="font-size: 12px; color: #999; margin-top: 20px;">This will extend your subscription seamlessly. Need help? Reply to this email or visit <a href="https://yourapp.com/support">support</a>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 11px; color: #ccc;">This is an automated message from YourApp. © 2025</p>
      </div>
    `,
  };
  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Proration prompt email sent to ${email} for ${newType} (needed: ${neededAmount} Ksh)`);
  } catch (error) {
    console.error(`❌ Failed to send proration email to ${email}:`, error.message);
  }
};

// New: Upgrade Proration Cron
export const scheduleUpgradeProration = () => {
  cron.schedule('*/15 * * * *', async () => {
    console.log('🕐 Running upgrade proration check...');
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    try {
      const recentUpgrades = await Transaction.find({
        status: 'SUCCESS',
        createdAt: { $gte: fifteenMinsAgo },
        amount: { $gt: 0 },
        accountType: { $in: ['VIP', 'VVIP', 'Spa'] },
        processed: { $ne: true },
      }).populate({
        path: 'user',
        select: 'username email balance phone',
      });
      if (recentUpgrades.length === 0) {
        console.log('✅ No recent upgrades to process.');
        return;
      }
      for (const txn of recentUpgrades) {
        const { user, accountType: newType, duration: newDuration, amount: paidAmount } = txn;
        const userId = user._id;
        const oldProfile = await Profile.findOne({ user: userId }).lean();
        if (!oldProfile || oldProfile.accountType.type === newType || !oldProfile.active) {
          console.log(`⏭️ Skipping ${user.username}: No valid old profile or no type change.`);
          await Transaction.findByIdAndUpdate(txn._id, { $set: { processed: true } });
          continue;
        }
        const oldType = oldProfile.accountType.type;
        const now = new Date();
        const oldExpiry = oldProfile.expiryDate;
        let remainingDays = 0;
        if (oldExpiry && oldExpiry > now) {
          remainingDays = Math.ceil((oldExpiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        }
        const oldDailyRate = oldProfile.accountType.amount / oldProfile.accountType.duration;
        const newDailyRate = (paidAmount / newDuration);
        const dailyDiff = newDailyRate - oldDailyRate;
        const proratedAdditional = remainingDays * dailyDiff;
        let neededAmount = proratedAdditional;
        let status = 'prompt';
        if (user.balance >= proratedAdditional) {
          await User.findByIdAndUpdate(userId, { 
            $inc: { balance: -proratedAdditional + paidAmount } 
          });
          const newExpiry = oldExpiry && remainingDays > 0 
            ? new Date(oldExpiry.getTime() + (newDuration * 24 * 60 * 60 * 1000))
            : new Date(now.getTime() + (newDuration * 24 * 60 * 60 * 1000));
          await Profile.findOneAndUpdate(
            { user: userId },
            {
              $set: {
                'accountType.type': newType,
                'accountType.amount': paidAmount,
                'accountType.duration': newDuration,
                active: true,
                isTrial: false,
                expiryDate: newExpiry,
              },
            }
          );
          console.log(`✅ Proration processed for ${user.username}: Used ${proratedAdditional} Ksh from balance. New expiry: ${newExpiry.toISOString().split('T')[0]}`);
          status = 'processed';
          neededAmount = 0;
        } else {
          neededAmount = Math.max(0, proratedAdditional - (user.balance || 0));
          await sendUpgradePromptEmail(user, {
            oldType,
            newType,
            remainingDays,
            proratedAmount,
            neededAmount,
          });
          console.log(`⚠️ Proration prompt sent to ${user.username}: Need ${neededAmount} Ksh (balance: ${user.balance || 0})`);
        }
        await Transaction.findByIdAndUpdate(txn._id, { 
          $set: { 
            processed: true,
            prorationStatus: status,
            prorationAmount: proratedAdditional,
            remainingDays,
          } 
        });
      }
    } catch (error) {
      console.error('❌ Upgrade proration cron error:', error);
    }
  }, { timezone: 'Africa/Nairobi' });
  console.log('🔄 Upgrade proration cron scheduled (every 15 mins).');
};