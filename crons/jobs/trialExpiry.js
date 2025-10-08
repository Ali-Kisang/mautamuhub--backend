import cron from 'node-cron';
import Profile from '../../models/ProfileSchema.js';


export const scheduleTrialExpiry = () => {
  cron.schedule('0 0 * * *', async () => {  // Daily at midnight
    console.log('🕐 Running daily expiry check for all profiles (trials & paid)...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);  // Start of today

    try {
      const expiredProfiles = await Profile.find({
        active: true,
        expiryDate: { $lte: today },
      }).populate('user', 'username email');

      if (expiredProfiles.length === 0) {
        console.log('✅ No expiries today.');
        return;
      }

      // Bulk deactivate
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

      // Send notifications (trials only)
      for (const profile of expiredProfiles) {
        if (profile.isTrial) {
          await sendExpiryNotification(profile);
        }
      }
    } catch (error) {
      console.error('❌ Expiry cron error:', error);
    }
  }, { 
    timezone: 'Africa/Nairobi'
  });

  console.log('🔄 Unified expiry cron with notifications scheduled (daily at midnight).');
};

// ✅ NEW: Lazy-load Nodemailer dynamically (ESM workaround)
const sendExpiryNotification = async (profile) => {
  const { default: nodemailer } = await import('nodemailer');  

  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,  // e.g., yourapp@gmail.com
      pass: process.env.EMAIL_PASS,  // App password
    },
  });

  const { user, accountType, isTrial } = profile;
  const type = accountType?.type || 'account';
  const trialText = isTrial ? 'trial' : 'subscription';
  const upgradeLink = `https://yourapp.com/upgrade?userId=${user._id}`;  // Adjust to your URL

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
    // Optional: Fallback to logging or queue for retry
  }
};