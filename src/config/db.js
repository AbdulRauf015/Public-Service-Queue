// src/config/db.js
// Database connection setup using Mongoose
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/baari';
    
    // Connect to MongoDB
    await mongoose.connect(uri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1); // Exit process if DB connection fails
  }
};

module.exports = connectDB;
