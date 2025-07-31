require("dotenv").config();

const cds = require("@sap/cds");

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

// Standard CAP server startup
module.exports = cds.server;
