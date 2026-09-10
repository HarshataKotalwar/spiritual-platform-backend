import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const uploadDir = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

export const upload = multer({ storage });

export const getFileUrl = (filename) => {
  return `${process.env.BACKEND_URL}/uploads/${filename}`;
};

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export const createImageUpload = (subdir) => {
  const destination = path.join(uploadDir, subdir);

  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true });
  }

  const imageStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, destination);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = IMAGE_EXTENSIONS.has(ext) ? ext : '.png';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
    },
  });

  return multer({
    storage: imageStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const mimeOk = IMAGE_MIME_TYPES.has(file.mimetype);
      const extOk = IMAGE_EXTENSIONS.has(ext);

      if (!mimeOk || !extOk) {
        cb(new Error('Only PNG, JPG, JPEG, and WebP images are allowed.'));
        return;
      }

      cb(null, true);
    },
  });
};

export const getStoredImageUrl = (subdir, filename) => {
  return `${process.env.BACKEND_URL}/uploads/${subdir}/${filename}`;
};

export const handleUploadError = (err, _req, res, next) => {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image must be 5MB or smaller.' });
    }

    return res.status(400).json({ error: 'Unable to upload this image.' });
  }

  if (err.message) {
    return res.status(400).json({ error: err.message });
  }

  return res.status(400).json({ error: 'Unable to upload this image.' });
};
