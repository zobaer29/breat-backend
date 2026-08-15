const mongoose = require('mongoose');

let isConnected = false;

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Resetting connection state...');
  isConnected = false;
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err.message);
  isConnected = false;
});

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    isConnected = true;
    return;
  }

  if (!process.env.MONGO_URI) {
    console.warn("MONGO_URI environment variable not set.");
    return;
  }

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 15000,
      maxPoolSize: 10,
    });
    isConnected = true;
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    isConnected = false;
    console.error(`Error connecting to MongoDB: ${error.message}`);
  }
};

module.exports = connectDB;
