// server.js - Baari main application entry point
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

const connectDB = require('./src/config/db');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO on the HTTP server with CORS support
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE']
  }
});

// Attach io instance to express app so routes/controllers can access it via req.app.get('io')
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// API routes
const publicRoutes = require('./src/routes/public');
const authRoutes = require('./src/routes/auth');
const staffRoutes = require('./src/routes/staff');
const { setupSockets } = require('./src/sockets');

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Baari server is running smoothly',
    timestamp: new Date().toISOString()
  });
});

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api', publicRoutes);
app.use('/api', staffRoutes);

// Initialize Socket.IO handlers
setupSockets(io);

// Start the server after connecting to MongoDB
const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Baari server listening on http://localhost:${PORT}`);
  });
});

module.exports = { app, server, io };
