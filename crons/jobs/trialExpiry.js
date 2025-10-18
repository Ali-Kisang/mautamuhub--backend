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
};

// Existing: sendExpiryNotification
// Updated: sendExpiryNotification (using Hostinger SMTP and enhanced alert-style template)
const sendExpiryNotification = async (profile) => {
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
  const { user, accountType, isTrial } = profile;
  const type = accountType?.type || 'account';
  const trialText = isTrial ? 'trial' : 'subscription';
  const upgradeLink = `https://mautamuhub.com/upgrade?userId=${user._id}`;
  const mailOptions = {
    from: `"Mautamuhub Alerts" <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: `🚨 Alert: Your ${type} ${trialText} has expired – Reactivate now!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center;">
        <h2 style="color: #ec4899; font-size: 28px; margin-bottom: 20px; font-weight: bold;">Subscription Expired Alert</h2>
        <p style="color: #555; line-height: 1.6; margin-bottom: 15px;">Hello ${user.username || 'User'},</p>
        <p style="color: #555; line-height: 1.6; margin-bottom: 25px;">Your ${type} ${trialText} has expired. You've been unlisted from the directory. Reactivate to regain visibility and features!</p>
        <ul style="color: #666; text-align: left; max-width: 400px; margin: 0 auto 25px;">
          <li>Priority listing and enhanced visibility.</li>
          <li>${type} plan: Ksh ${accountType?.amount || 0} for ${accountType?.duration || 7} days.</li>
          <li>Quick reactivation in under 2 minutes.</li>
        </ul>
        <a href="${upgradeLink}" style="background: linear-gradient(135deg, #FFC0CB, #FF99CC); color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px auto; font-weight: bold; box-shadow: 0 4px 8px rgba(255, 192, 203, 0.3); transition: transform 0.2s ease;">Reactivate Now</a>
        <p style="color: #777; line-height: 1.6; margin-bottom: 30px; font-style: italic;">Act within 24 hours for a special reactivation discount!</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; line-height: 1.6; margin: 0;">Best regards,<br><strong>Mautamuhub Team</strong></p>
      </div>
    `,
  };
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(`❌ Failed to send expiry alert email to ${user.email}:`, error.message);
  }
};

// Updated: sendUpgradePromptEmail (using Hostinger SMTP and enhanced alert-style template)
const sendUpgradePromptEmail = async (user, upgradeDetails) => {
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
  const { email, username } = user;
  const { oldType, newType, remainingDays, proratedAmount, neededAmount } = upgradeDetails;
  const paymentLink = `https://mautamuhub.com/payments/prorate-upgrade?userId=${user._id}&amount=${neededAmount}&newType=${newType}`;
  const mailOptions = {
    from: `"Mautamuhub Alerts" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `🚨 Alert: Complete Your ${newType} Upgrade – Pay ${neededAmount} Ksh Proration Now`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center;">
        <h2 style="color: #ec4899; font-size: 28px; margin-bottom: 20px; font-weight: bold;">Upgrade Proration Alert</h2>
        <p style="color: #555; line-height: 1.6; margin-bottom: 15px;">Hi ${username},</p>
        <p style="color: #555; line-height: 1.6; margin-bottom: 15px;">Congratulations on selecting the ${newType} upgrade from ${oldType}! We detected ${remainingDays} days remaining on your current plan.</p>
        <p style="color: #555; line-height: 1.6; margin-bottom: 25px;">To activate immediately and avoid downtime, complete the prorated payment: <strong>${proratedAmount} Ksh</strong>.</p>
        <ul style="color: #666; text-align: left; max-width: 400px; margin: 0 auto 25px;">
          <li>Your balance: <strong>${user.balance || 0} Ksh</strong></li>
          <li>Amount needed: <strong>${neededAmount} Ksh</strong></li>
          <li>Seamless extension – no interruptions!</li>
        </ul>
        <a href="${paymentLink}" style="background: linear-gradient(135deg, #FFC0CB, #FF99CC); color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px auto; font-weight: bold; box-shadow: 0 4px 8px rgba(255, 192, 203, 0.3); transition: transform 0.2s ease;">Pay Proration & Activate</a>
        <p style="color: #777; line-height: 1.6; margin-bottom: 30px; font-style: italic;">Complete within 30 minutes to lock in your upgrade. Questions? Reply to this email.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; line-height: 1.6; margin: 0;">Best regards,<br><strong>Mautamuhub Team</strong></p>
      </div>
    `,
  };
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(`❌ Failed to send upgrade alert email to ${email}:`, error.message);
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
        return;
      }
      for (const txn of recentUpgrades) {
        const { user, accountType: newType, duration: newDuration, amount: paidAmount } = txn;
        const userId = user._id;
        const oldProfile = await Profile.findOne({ user: userId }).lean();
        if (!oldProfile || oldProfile.accountType.type === newType || !oldProfile.active) {
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