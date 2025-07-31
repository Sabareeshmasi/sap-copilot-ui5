// Main server entry point for SAP Copilot application
// This file serves as the entry point referenced in package.json

const cds = require('@sap/cds');

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

// Start the server
cds.serve('all').catch(console.error);
