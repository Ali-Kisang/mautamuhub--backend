import webPush from "web-push";
import dotenv from "dotenv";

dotenv.config();


const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  throw new Error("❌ Missing VAPID keys in .env");
}

// ✅ Setup VAPID
webPush.setVapidDetails(
  "mailto:kisangalex4@gmail.com", 
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

export const sendPushNotification = async (subscription, title, body, icon, senderId) => {  
  try {
    const payload = JSON.stringify({
      title,
      body,
      icon,
      senderId,  
    });

    await webPush.sendNotification(subscription, payload);
    console.log("🔔 Push notification sent!");
  } catch (err) {
    console.error("❌ Error sending push notification:", err);
  }
};
