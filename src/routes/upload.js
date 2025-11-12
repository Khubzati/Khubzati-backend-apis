const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Store files in uploads directory
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// File filter - accept images and PDFs
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf'
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
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  }
});

// Upload single file
router.post('/document', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'fail',
        message: 'No file uploaded'
      });
    }

    // Generate file URL (in production, this would be a CDN URL)
    // For now, return a relative path that can be served statically
    const fileUrl = `/uploads/${req.file.filename}`;
    
    // In production, you would upload to S3/Cloud Storage and return the CDN URL
    // const fileUrl = await uploadToS3(req.file);

    return res.status(200).json({
      status: 'success',
      data: {
        fileName: req.file.originalname,
        fileUrl: fileUrl,
        fileSize: req.file.size,
        mimeType: req.file.mimetype
      },
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('File upload error:', error);
    
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          status: 'fail',
          message: 'File size exceeds the maximum limit of 10MB'
        });
      }
    }
    
    return res.status(500).json({
      status: 'error',
      message: error.message || 'An error occurred while uploading file'
    });
  }
});

// Upload multiple files
router.post('/documents', authenticateToken, upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'No files uploaded'
      });
    }

    const uploadedFiles = req.files.map(file => ({
      fileName: file.originalname,
      fileUrl: `/uploads/${file.filename}`,
      fileSize: file.size,
      mimeType: file.mimetype
    }));

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
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      status: 'fail',
      message: 'File not found'
    });
  }
  
  res.sendFile(filePath);
});

module.exports = router;

