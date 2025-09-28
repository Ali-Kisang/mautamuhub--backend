import cloudinary from "cloudinary";
import path from "path";

cloudinary.v2.config({
  cloud_name:  "dcxggvejn",
  api_key: "426815442226845",
  api_secret: "AdCa8xnZLNWihnOfNJKaW7DM4ww",
});

// ✅ Upload Escort photos
export const uploadEscortPhotos = async (filePath) => {
  try {
    // Convert to absolute path
    const absolutePath = path.resolve(filePath);

    // Upload to a folder in Cloudinary
    const result = await cloudinary.v2.uploader.upload(absolutePath, {
      folder: "Escorts", // optional folder name
      resource_type: "image",
    });

    // Instead of returning secure_url, return public_id
    return result.public_id; // 👉 e.g. "Escorts/lmmzfrfnz2gteoduppew"
  } catch (err) {
    console.error("❌ Cloudinary upload error:", err);
    throw err;
  }
};

// ✅ Delete Escort photo by public_id
export const deleteEscortPhoto = async (publicId) => {
  try {
    // publicId should include the folder, e.g., "Escorts/lmmzfrfnz2gteoduppew"
    const result = await cloudinary.v2.uploader.destroy(publicId, {
      resource_type: "image",
    });

    if (result.result === "ok") {
      console.log("✅ Photo deleted successfully");
      return true;
    } else {
      throw new Error(`Delete failed: ${result.result}`);
    }
  } catch (err) {
    console.error("❌ Cloudinary delete error:", err);
    throw err;
  }
};