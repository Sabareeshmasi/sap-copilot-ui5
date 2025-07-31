// Main server entry point for SAP Copilot application
// This file serves as the entry point referenced in package.json

const cds = require('@sap/cds');
const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// Load environment variables
require('dotenv').config();

// Enhanced startup logging
console.log("🚀 Starting SAP Copilot server...");

// Check for required environment variables
if (!process.env.GEMINI_API_KEY) {
  console.warn("⚠️  GEMINI_API_KEY not found in environment. Gemini service will not work properly.");
}

// Set default environment if not specified
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

// Global variables for WebSocket
let io;

// Configure express middleware before starting CDS
cds.on('bootstrap', (app) => {
  // Create HTTP server for Socket.IO
  const server = http.createServer(app);
  io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Setup WebSocket for real-time notifications
  io.on('connection', (socket) => {
    console.log('📱 Client connected for real-time notifications');

    socket.on('disconnect', () => {
      console.log('📱 Client disconnected');
    });
  });

  // Serve static report files
  const reportsPath = path.join(__dirname, 'srv', 'reports');
  app.use('/reports', express.static(reportsPath));

  // Add direct download endpoint
  app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(reportsPath, filename);

    // Check if file exists
    if (!require('fs').existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set appropriate headers for download
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (ext === '.xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.download(filePath, filename);
  });

  // Add notifications endpoint
  app.get('/api/notifications', (req, res) => {
    // This will be handled by the alert manager
    res.json({ message: 'Notifications endpoint ready' });
  });

  console.log(`📊 Reports will be served from: /reports`);
  console.log(`⬇️ Direct downloads available at: /download/[filename]`);
  console.log(`🔔 Real-time notifications enabled via WebSocket`);

  // Make io available globally for alert notifications
  global.notificationIO = io;
});

// Start the server
cds.serve('all').catch(console.error);
