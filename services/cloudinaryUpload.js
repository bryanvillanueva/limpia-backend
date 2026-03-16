const cloudinary = require('../config/cloudinary');

/**
 * Uploads an image buffer to Cloudinary and returns the secure URL.
 * @param {Buffer} buffer - Image file buffer (e.g. from multer req.file.buffer).
 * @param {Object} options - Optional upload options (folder, public_id, etc.).
 * @returns {Promise<{ secure_url: string, public_id: string }>} Upload result with secure_url for storage in DB.
 * @see https://cloudinary.com/documentation/node_image_and_video_upload#the_code_upload_stream_code_method
 */
function uploadImageBuffer(buffer, options = {}) {
  const opts = { folder: 'limpia/supplies', ...options };
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      opts,
      (error, result) => {
        if (error) return reject(error);
        return resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    uploadStream.end(buffer);
  });
}

module.exports = { uploadImageBuffer };
