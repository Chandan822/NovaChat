const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024;
const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const allowedTextTypes = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/javascript',
  'text/javascript',
]);
const allowedTextExtensions = new Set(['.txt', '.md', '.csv', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.html']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 7,
  },
  fileFilter(req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase();
    const isAllowedTextFile = allowedTextTypes.has(file.mimetype) || (
      file.mimetype === 'application/octet-stream' && allowedTextExtensions.has(extension)
    );

    if (allowedImageTypes.has(file.mimetype) || isAllowedTextFile) {
      return cb(null, true);
    }

    return cb(new Error('Only PNG, JPG, WEBP images and small text files are allowed.'));
  },
});

const handleUpload = (req, res, next) => {
  upload.array('attachments', 7)(req, res, (error) => {
    if (!error) {
      return next();
    }

    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Each uploaded file must be 2MB or smaller.'
      : error.message;

    return res.status(400).json({ message });
  });
};

// Anonymous chat route (Public)
router.post('/anonymous', chatController.sendAnonymousMessage);

// Protect all other chat routes
router.use(authMiddleware);

// Chat CRUD
router.post('/new', chatController.createChat);
router.get('/', chatController.getUserChats);
router.delete('/:chatId', chatController.deleteChat);

// Message processing
router.get('/:chatId/messages', chatController.getChatMessages);
router.post('/:chatId/message', handleUpload, chatController.sendMessage);

module.exports = router;
