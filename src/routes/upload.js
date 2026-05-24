const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');
const { authenticateToken } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rate-limit');
const { logUploadAudit } = require('../services/uploadAuditService');

const router = express.Router();
const uploadStorageDriver = String(process.env.UPLOAD_STORAGE_DRIVER || 'local').trim().toLowerCase();
const MAX_UPLOAD_FILE_SIZE_BYTES = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES || 10 * 1024 * 1024);
const uploadRateLimiter = createRateLimiter({
  keyPrefix: 'upload:file',
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.UPLOAD_RATE_LIMIT_PER_MINUTE || 60),
  message: 'Too many upload requests. Please try again later.',
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (uploadStorageDriver !== 'local') {
  console.warn(
    `UPLOAD_STORAGE_DRIVER=${uploadStorageDriver} is not implemented yet. Falling back to local storage.`,
  );
}

// Configure multer storage
const extensionByMime = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
};

const detectFileSignature = (buffer) => {
  if (!buffer || buffer.length < 4) return null;

  // PNG
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: '.png', isImage: true };
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg', isImage: true };
  }

  // GIF
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return { mime: 'image/gif', ext: '.gif', isImage: true };
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: '.webp', isImage: true };
  }

  // PDF
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return { mime: 'application/pdf', ext: '.pdf', isImage: false };
  }

  return null;
};

const detectSvgText = (buffer) => {
  const sample = buffer.slice(0, 2048).toString('utf8').toLowerCase();
  return sample.includes('<svg');
};

const normalizeUploadedFile = async (file, { imagesOnly = false } = {}) => {
  const filePath = file.path;
  const fileBuffer = await fs.promises.readFile(filePath);

  let detected = detectFileSignature(fileBuffer);
  if (!detected && detectSvgText(fileBuffer)) {
    detected = { mime: 'image/svg+xml', ext: '.svg', isImage: true };
  }

  const fallbackMime = file.mimetype || 'application/octet-stream';
  const fallbackExt =
    extensionByMime[fallbackMime] ||
    path.extname(file.filename).toLowerCase() ||
    '.bin';

  const resolvedMime = (detected && detected.mime) || fallbackMime;
  const resolvedExt = (detected && detected.ext) || fallbackExt;
  const isImage = detected ? detected.isImage : resolvedMime.startsWith('image/');

  if (imagesOnly && !isImage) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw new Error('Invalid image content. Only PNG, JPG, JPEG, SVG, GIF, and WebP are allowed.');
  }

  const currentExt = path.extname(file.filename).toLowerCase();
  let finalFilename = file.filename;
  let finalPath = filePath;

  if (currentExt !== resolvedExt) {
    const baseName = currentExt
      ? file.filename.slice(0, -currentExt.length)
      : file.filename;
    finalFilename = `${baseName}${resolvedExt}`;
    finalPath = path.join(uploadsDir, finalFilename);
    await fs.promises.rename(filePath, finalPath);
  }

  return {
    ...file,
    filename: finalFilename,
    path: finalPath,
    mimetype: resolvedMime,
    detectedMimeType: resolvedMime,
    detectedFileExt: resolvedExt,
  };
};

const sanitizeFileNameBase = (rawName) => {
  const trimmed = String(rawName || '').trim();
  if (!trimmed) return 'file';

  return trimmed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'file';
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Store files in uploads directory
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate safe ASCII filename to avoid URL/encoding issues.
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extFromOriginal = path.extname(String(file.originalname || '')).toLowerCase();
    const extFromMime = extensionByMime[file.mimetype] || '';
    const ext = extFromMime || extFromOriginal || '.bin';
    const originalBase = path.basename(String(file.originalname || ''), extFromOriginal);
    const safeBase = sanitizeFileNameBase(originalBase);
    cb(null, `${safeBase}-${uniqueSuffix}${ext}`);
  }
});

// File filter - accept images and PDFs
const fileFilter = (req, file, cb) => {
  // Strict in production: allow common images and PDFs (and text/plain for sample files)
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
    'text/plain'
  ];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images (JPEG, PNG, GIF, WebP) and PDF files are allowed.'), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
  }
});

const imageOnlyFilter = (req, file, cb) => {
  const allowedImageMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ];

  if (allowedImageMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid image type. Only PNG, JPG, JPEG, SVG, GIF, and WebP are allowed.'), false);
  }
};

const uploadImageOnly = multer({
  storage,
  fileFilter: imageOnlyFilter,
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
  },
});

const resolveUploadOwnership = async (req) => {
  const ownerType = String(req.body?.ownerType || req.body?.owner_type || 'user').trim().toLowerCase();
  const ownerId = String(req.body?.ownerId || req.body?.owner_id || req.user?.id || '').trim();

  if (!ownerId) {
    return { valid: false, message: 'ownerId is required for upload ownership validation' };
  }

  if (ownerType === 'user') {
    if (ownerId !== req.user.id) {
      return { valid: false, message: 'ownerId must match the authenticated user for user-owned uploads' };
    }
    return { valid: true, ownerType, ownerId };
  }

  if (ownerType === 'bakery') {
    const bakery = await prisma.bakery.findFirst({
      where: {
        id: ownerId,
        ownerId: req.user.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!bakery && req.user.role !== 'admin') {
      return { valid: false, message: 'You do not own this bakery upload context' };
    }
    return { valid: true, ownerType, ownerId };
  }

  if (ownerType === 'restaurant') {
    const restaurant = await prisma.restaurant.findFirst({
      where: {
        id: ownerId,
        ownerId: req.user.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!restaurant && req.user.role !== 'admin') {
      return { valid: false, message: 'You do not own this restaurant upload context' };
    }
    return { valid: true, ownerType, ownerId };
  }

  if (req.user.role !== 'admin') {
    return { valid: false, message: 'Unsupported ownerType for upload ownership validation' };
  }

  return { valid: true, ownerType, ownerId };
};

// Upload single file
router.post('/document', authenticateToken, uploadRateLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'fail',
        message: 'No file uploaded'
      });
    }

    const ownership = await resolveUploadOwnership(req);
    if (!ownership.valid) {
      return res.status(403).json({
        status: 'fail',
        message: ownership.message,
      });
    }

    const normalizedFile = await normalizeUploadedFile(req.file, {
      imagesOnly: false,
    });
    const fileUrl = `/uploads/${normalizedFile.filename}`;
    
    // In production, you would upload to S3/Cloud Storage and return the CDN URL
    // const fileUrl = await uploadToS3(req.file);

    await logUploadAudit({
      prisma,
      req,
      userId: req.user.id,
      ownerType: ownership.ownerType,
      ownerId: ownership.ownerId,
      fileName: req.file.originalname,
      fileUrl,
      mimeType: normalizedFile.mimetype,
      fileSize: normalizedFile.size,
      sourceRoute: req.path,
    });

    return res.status(200).json({
      status: 'success',
      data: {
        fileName: req.file.originalname,
        fileUrl: fileUrl,
        fileSize: normalizedFile.size,
        mimeType: normalizedFile.mimetype
      },
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('File upload error:', error);
    
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          status: 'fail',
          message: `File size exceeds the maximum limit of ${Math.round(MAX_UPLOAD_FILE_SIZE_BYTES / (1024 * 1024))}MB`,
        });
      }
    }
    return res.status(500).json({
      status: 'error',
      message: error.message || 'An error occurred while uploading file'
    });
  }
});

// Upload single image only (for UI image selectors such as bread type thumbnails)
router.post('/image', authenticateToken, uploadRateLimiter, uploadImageOnly.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'fail',
        message: 'No image uploaded',
      });
    }

    const ownership = await resolveUploadOwnership(req);
    if (!ownership.valid) {
      return res.status(403).json({
        status: 'fail',
        message: ownership.message,
      });
    }

    const normalizedFile = await normalizeUploadedFile(req.file, {
      imagesOnly: true,
    });
    const fileUrl = `/uploads/${normalizedFile.filename}`;

    await logUploadAudit({
      prisma,
      req,
      userId: req.user.id,
      ownerType: ownership.ownerType,
      ownerId: ownership.ownerId,
      fileName: req.file.originalname,
      fileUrl,
      mimeType: normalizedFile.mimetype,
      fileSize: normalizedFile.size,
      sourceRoute: req.path,
    });

    return res.status(200).json({
      status: 'success',
      data: {
        fileName: req.file.originalname,
        fileUrl,
        fileSize: normalizedFile.size,
        mimeType: normalizedFile.mimetype,
      },
      message: 'Image uploaded successfully',
    });
  } catch (error) {
    console.error('Image upload error:', error);

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        status: 'fail',
        message: `Image size exceeds the maximum limit of ${Math.round(MAX_UPLOAD_FILE_SIZE_BYTES / (1024 * 1024))}MB`,
      });
    }

    return res.status(500).json({
      status: 'error',
      message: error.message || 'An error occurred while uploading image',
    });
  }
});

// Upload multiple files
router.post('/documents', authenticateToken, uploadRateLimiter, upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'No files uploaded'
      });
    }

    const ownership = await resolveUploadOwnership(req);
    if (!ownership.valid) {
      return res.status(403).json({
        status: 'fail',
        message: ownership.message,
      });
    }

    const normalizedFiles = await Promise.all(
      req.files.map((file) => normalizeUploadedFile(file, { imagesOnly: false })),
    );

    const uploadedFiles = [];
    for (const file of normalizedFiles) {
      const fileUrl = `/uploads/${file.filename}`;
      uploadedFiles.push({
        fileName: file.originalname,
        fileUrl,
        fileSize: file.size,
        mimeType: file.mimetype,
      });

      await logUploadAudit({
        prisma,
        req,
        userId: req.user.id,
        ownerType: ownership.ownerType,
        ownerId: ownership.ownerId,
        fileName: file.originalname,
        fileUrl,
        mimeType: file.mimetype,
        fileSize: file.size,
        sourceRoute: req.path,
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        files: uploadedFiles
      },
      message: 'Files uploaded successfully'
    });
  } catch (error) {
    console.error('Files upload error:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'An error occurred while uploading files'
    });
  }
});

// Serve uploaded files (in production, use a CDN or proper static file server)
router.get('/uploads/:filename', (req, res) => {
  const rawFilename = String(req.params.filename || '');
  const normalizedFilename = path.basename(rawFilename);
  if (!normalizedFilename || normalizedFilename !== rawFilename) {
    return res.status(400).json({
      status: 'fail',
      message: 'Invalid file name',
    });
  }

  const filePath = path.resolve(uploadsDir, normalizedFilename);
  if (!filePath.startsWith(path.resolve(uploadsDir) + path.sep)) {
    return res.status(400).json({
      status: 'fail',
      message: 'Invalid file path',
    });
  }
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      status: 'fail',
      message: 'File not found'
    });
  }
  
  res.sendFile(filePath);
});

module.exports = router;
