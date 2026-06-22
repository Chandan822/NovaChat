const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Message = require('../models/Message');

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');
    const msg = await Message.findOne({ role: 'assistant', content: { $regex: 'Generated Image' } }).sort({ timestamp: -1 });
    if (msg) {
      console.log('Found message:', msg._id);
      console.log('Content length:', msg.content.length);
      console.log('Content preview:', msg.content.substring(0, 200));
    } else {
      console.log('No image message found');
    }
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.connection.close();
  }
};

run();
