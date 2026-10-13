// src/config/db.js
// Database connection setup using Mongoose
const mongoose = require('mongoose');

async function connectToMongo(uri) {
  try {
    return await mongoose.connect(uri);
  } catch (err) {
    if (uri.startsWith('mongodb+srv://') && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEOUT')) {
      console.log('Local DNS SRV/TXT resolution blocked; connecting to Atlas replica set nodes directly...');
      const match = uri.match(/^mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\/([^?]+)(\?.*)?$/);
      if (match) {
        const [, user, pass, host, db] = match;
        if (host === 'cluster0.mm9wbej.mongodb.net') {
          const directUri = `mongodb://${user}:${pass}@ac-owteqah-shard-00-00.mm9wbej.mongodb.net:27017,ac-owteqah-shard-00-01.mm9wbej.mongodb.net:27017,ac-owteqah-shard-00-02.mm9wbej.mongodb.net:27017/${db}?ssl=true&authSource=admin&retryWrites=true&w=majority`;
          return await mongoose.connect(directUri);
        }
      }
    }
    throw err;
  }
}

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/baari';
    await connectToMongo(uri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1); // Exit process if DB connection fails
  }
};

module.exports = connectDB;
module.exports.connectToMongo = connectToMongo;
