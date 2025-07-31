const cds = require("@sap/cds");

// Basic security middleware for the application
module.exports = {
  
  // Rate limiting configuration
  rateLimiting: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again later."
  },

  // Input validation for Gemini service
  validateGeminiInput: function(req, res, next) {
    const { prompt } = req.data || {};
    
    // Check if prompt exists
    if (!prompt) {
      return req.error(400, "Prompt is required");
    }
    
    // Check prompt length
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      return req.error(400, "Prompt must be a non-empty string");
    }
    
    if (prompt.length > 10000) {
      return req.error(400, "Prompt is too long (maximum 10,000 characters)");
    }
    
    // Basic content filtering
    const forbiddenPatterns = [
      /\b(password|secret|key|token)\b/i,
      /\b(hack|exploit|vulnerability)\b/i,
      /\b(sql\s+injection|xss|csrf)\b/i
    ];
    
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(prompt)) {
        console.warn(`🚨 Potentially harmful prompt detected: ${prompt.substring(0, 100)}...`);
        return req.error(400, "Prompt contains potentially harmful content");
      }
    }
    
    // Sanitize prompt
    req.data.prompt = prompt.trim().replace(/\s+/g, ' ');
    
    next();
  },

  // Environment validation
  validateEnvironment: function() {
    const requiredEnvVars = ['NODE_ENV'];
    const missingVars = [];
    
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        missingVars.push(envVar);
      }
    }
    
    if (missingVars.length > 0) {
      console.warn(`⚠️  Missing environment variables: ${missingVars.join(', ')}`);
    }
    
    // Check for development vs production settings
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.GEMINI_API_KEY) {
        console.error("❌ GEMINI_API_KEY is required in production");
        throw new Error("Missing required environment variables for production");
      }
    }
    
    return true;
  },

  // CORS configuration
  corsOptions: {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      const allowedOrigins = [
        'http://localhost:4004',
        'http://localhost:3000',
        'https://localhost:4004'
      ];
      
      // Add production origins from environment
      if (process.env.ALLOWED_ORIGINS) {
        allowedOrigins.push(...process.env.ALLOWED_ORIGINS.split(','));
      }
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.warn(`🚨 CORS blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200
  },

  // Request logging
  logRequest: function(req, res, next) {
    const timestamp = new Date().toISOString();
    const method = req.method;
    const url = req.url;
    const userAgent = req.get('User-Agent') || 'Unknown';
    const ip = req.ip || req.connection.remoteAddress;
    
    console.log(`📝 ${timestamp} - ${method} ${url} - IP: ${ip} - UA: ${userAgent.substring(0, 100)}`);
    
    next();
  },

  // Error handling
  errorHandler: function(err, req, res, next) {
    console.error('🚨 Application Error:', err);
    
    // Don't leak error details in production
    if (process.env.NODE_ENV === 'production') {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred'
      });
    } else {
      res.status(500).json({
        error: err.name || 'Error',
        message: err.message,
        stack: err.stack
      });
    }
  }
};
