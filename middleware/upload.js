/**
 * Upload Middleware (Multer)
 * ─────────────────────────
 * Handles multipart/form-data file uploads for dispute evidence.
 *
 * Validates:
 *   - MIME type: JPEG, PNG, PDF only
 *   - File size: 10MB max (Razorpay limit; Cashfree is 5MB — checked per-gateway before submit)
 *   - Single file per request
 *
 * Files are stored in /uploads/dispute-evidence/:companySlug/:disputeId/
 * after gateway upload the local file can be cleaned up or kept for PayU (no gateway API)
 */

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const UPLOAD_BASE = path.join(process.cwd(), 'uploads', 'dispute-evidence');

const ALLOWED_MIMES = {
  'image/jpeg': '.jpg',
  'image/jpg':  '.jpg',
  'image/png':  '.png',
  'application/pdf': '.pdf',
};

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const disputeId  = req.params.id || 'unknown';
    const company    = req.company?.slug || 'unknown';
    const uploadPath = path.join(UPLOAD_BASE, company, disputeId);

    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext       = ALLOWED_MIMES[file.mimetype] || path.extname(file.originalname);
    const safeName  = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = Date.now();
    cb(null, `${timestamp}_${safeName}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIMES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only JPEG, PNG, and PDF are allowed.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_BYTES },
});

// Multer error handler middleware
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

module.exports = { upload, handleUploadError, ALLOWED_MIMES, MAX_SIZE_BYTES };