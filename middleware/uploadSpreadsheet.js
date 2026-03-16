const multer = require('multer');

const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
]);

/**
 * Accepts spreadsheet uploads in memory for import endpoints.
 * @param {import('express').Request} req - Express request.
 * @param {Express.Multer.File} file - Uploaded file descriptor.
 * @param {(error: Error | null, acceptFile?: boolean) => void} cb - Multer callback.
 * @returns {void}
 * Edge cases: browsers may send generic mime types, so extension is also checked.
 */
function fileFilter(req, file, cb) {
  const originalName = (file.originalname || '').toLowerCase();
  const hasValidExtension = originalName.endsWith('.csv') || originalName.endsWith('.xlsx');
  const hasValidMime = allowedMimeTypes.has(file.mimetype);

  if (!hasValidExtension && !hasValidMime) {
    return cb(new Error('Archivo inválido. Solo se aceptan .csv o .xlsx'));
  }

  cb(null, true);
}

const uploadSpreadsheet = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

module.exports = uploadSpreadsheet;
