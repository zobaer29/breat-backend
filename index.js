const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const connectDB = require('./config/db');

const app = express();

// Serverless DB connection middleware
app.use(async (req, res, next) => {
  await connectDB();
  next();
});

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(morgan('dev'));

// Routes
app.use('/api', require('./routes'));

// Healthcheck Route
app.get('/', (req, res) => {
  res.json({ message: 'BREAT Backend API is running successfully on Vercel!' });
});

// Port Configuration for local development
const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
