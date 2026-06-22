const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const { encrypt } = require('../utils/crypto');

const ensureJwtSecret = (res) => {
  if (!process.env.JWT_SECRET) {
    res.status(500).json({ message: 'Server configuration error: JWT secret is missing' });
    return false;
  }
  return true;
};

// Register a new user
exports.register = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Service unavailable: database not connected' });
    }

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    if (!ensureJwtSecret(res)) {
      return;
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create new user
    const user = new User({
      name,
      email,
      password,
    });

    await user.save();

    // Create JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        hasGroqKey: !!user.groqApiKey,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      message: process.env.NODE_ENV === 'production'
        ? 'Server error during registration'
        : `Server error during registration: ${error.message}`,
    });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Service unavailable: database not connected' });
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!ensureJwtSecret(res)) {
      return;
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        hasGroqKey: !!user.groqApiKey,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      message: process.env.NODE_ENV === 'production'
        ? 'Server error during login'
        : `Server error during login: ${error.message}`,
    });
  }
};

// Verify token (optional - for protected routes)
exports.verify = async (req, res) => {
  try {
    if (!ensureJwtSecret(res)) {
      return;
    }

    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        hasGroqKey: !!user.groqApiKey,
      }
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Save or update user's Groq API Key
exports.saveGroqKey = async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ message: 'API key is required' });
    }

    if (!apiKey.startsWith('gsk_')) {
      return res.status(400).json({ message: 'Invalid Groq API key format. Key should start with "gsk_".' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { iv, encryptedData } = encrypt(apiKey);
    user.groqApiKey = encryptedData;
    user.groqApiKeyIv = iv;

    await user.save();

    res.json({
      message: 'Groq API key saved successfully',
      hasGroqKey: true,
    });
  } catch (error) {
    console.error('Error saving Groq key:', error);
    res.status(500).json({ message: 'Server error saving API key' });
  }
};

// Delete user's Groq API Key
exports.deleteGroqKey = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.groqApiKey = null;
    user.groqApiKeyIv = null;

    await user.save();

    res.json({
      message: 'Groq API key removed successfully',
      hasGroqKey: false,
    });
  } catch (error) {
    console.error('Error deleting Groq key:', error);
    res.status(500).json({ message: 'Server error removing API key' });
  }
};
