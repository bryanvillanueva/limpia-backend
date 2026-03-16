/**
 * Cloudinary configuration for image upload and delivery.
 * Uses CLOUDINARY_URL (e.g. cloudinary://api_key:api_secret@cloud_name)
 * or separate env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 * @see https://cloudinary.com/documentation/node_integration
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const cloudinary = require('cloudinary').v2;

if (process.env.CLOUDINARY_URL) {
  cloudinary.config();
} else if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

module.exports = cloudinary;
