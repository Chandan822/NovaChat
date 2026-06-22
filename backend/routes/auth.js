const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

// Register a new user
router.post('/register', authController.register);

// Login user
router.post('/login', authController.login);

// Verify token (optional - for protected routes)
router.get('/verify', authController.verify);

// Groq API Key routes
router.post('/groq-key', authMiddleware, authController.saveGroqKey);
router.delete('/groq-key', authMiddleware, authController.deleteGroqKey);

module.exports = router;
