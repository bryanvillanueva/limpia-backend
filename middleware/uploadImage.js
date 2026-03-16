const multer = require('multer');

const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]);

/**
 * Multer file filter for image uploads (supplies, etc.).
 * Accepts JPEG, PNG, GIF, WebP.
 */
function fileFilter(req, file, cb) {
  if (!file || !file.mimetype) {
    return cb(new Error('Archivo no válido'));
  }
  if (!allowedMimeTypes.has(file.mimetype)) {
    return cb(new Error('Solo se permiten imágenes (JPEG, PNG, GIF, WebP)'));
  }
  cb(null, true);
}

const uploadImage = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB
  }
});

module.exports = uploadImage;
