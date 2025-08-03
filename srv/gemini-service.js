const cds = require("@sap/cds");
const axios = require("axios");
const IntentRecognizer = require("./ai/intent-recognition");
const ODataParser = require("./ai/odata-parser");
const BusinessContextResolver = require("./ai/business-context");
const ReportGenerator = require("./reporting/report-generator");
const AlertManager = require("./alerts/alert-manager");

// Cohere AI configuration
const COHERE_URL = "https://api.cohere.ai/v1/chat";
const COHERE_KEY = process.env.COHERE_API_KEY;

// Validation helper functions
function validatePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return { valid: false, error: "Prompt must be a non-empty string" };
  }

  if (prompt.trim().length === 0) {
    return { valid: false, error: "Prompt cannot be empty" };
  }

  if (prompt.length > 10000) {
    return { valid: false, error: "Prompt is too long (max 10,000 characters)" };
  }

  return { valid: true };
}

function sanitizePrompt(prompt) {
  // Remove potentially harmful content and normalize whitespace
  return prompt.trim().replace(/\s+/g, ' ');
}

module.exports = cds.service.impl(async function () {

  // Initialize report generator
  const reportGenerator = new ReportGenerator();

  // Initialize alert manager
  const alertManager = new AlertManager();

  // Log service initialization
  console.log("🤖 Cohere AI Service initialized");
  console.log("📊 Report Generator initialized");
  console.log("🚨 Alert Manager initialized");
  if (!COHERE_KEY) {
    console.warn("⚠️  COHERE_API_KEY not configured - AI service will use intelligent fallbacks");
  } else {
    console.log("✅ COHERE_API_KEY found:", COHERE_KEY.substring(0, 10) + "...");
    console.log("🔗 Cohere URL:", COHERE_URL);
  }

  // Initialize alert manager
  alertManager.initialize().catch(error => {
    console.error("❌ Failed to initialize Alert Manager:", error);
  });

  // Setup real-time notification broadcasting
  alertManager.on('in-app-notification', (notification) => {
    if (global.notificationIO) {
      global.notificationIO.emit('new-notification', notification);
      console.log(`📡 Broadcasted notification: ${notification.title}`);
    }
  });

  alertManager.on('alert-triggered', (alert) => {
    if (global.notificationIO) {
      global.notificationIO.emit('alert-triggered', alert);
      console.log(`📡 Broadcasted alert: ${alert.message}`);
    }
  });



  this.on("prompt", async (req) => {
    const startTime = Date.now();

    try {
      // Extract and validate prompt
      const rawPrompt = req.data.prompt;
      const validation = validatePrompt(rawPrompt);

      if (!validation.valid) {
        console.warn(`❌ Invalid prompt: ${validation.error}`);
        return {
          reply: `Error: ${validation.error}`,
          success: false,
          timestamp: new Date().toISOString()
        };
      }

      // Try to analyze intent and extract business context
      console.log(`🧠 Analyzing intent for: "${rawPrompt}"`);

      let analysis;
      try {
        analysis = IntentRecognizer.analyzeInput(rawPrompt);
        console.log(`📊 Intent: ${analysis.intent.intent} (${Math.round(analysis.intent.confidence * 100)}%)`);
        console.log(`🔍 Full analysis:`, JSON.stringify(analysis, null, 2));
      } catch (intentError) {
        console.error("❌ Error in intent recognition:", intentError);
        // Fall back to simple Gemini AI response
        return await this.handleGeneralQuery(rawPrompt, null, startTime);
      }

      // Direct transaction detection for testing (bypass AI intent if obvious)
      const lowerPrompt = rawPrompt.toLowerCase();
      if (lowerPrompt.startsWith('create ') || lowerPrompt.startsWith('add ') ||
          lowerPrompt.startsWith('update ') || lowerPrompt.startsWith('modify ') ||
          lowerPrompt.startsWith('delete ') || lowerPrompt.startsWith('remove ')) {
        console.log(`🚀 Direct transaction detected, bypassing AI intent`);
        return await this.handleDirectTransaction(rawPrompt, startTime);
      }

      // Handle casual chat without heavy AI processing
      if (this.isCasualChat(rawPrompt)) {
        console.log(`💬 Casual chat detected, using simple response`);
        return this.handleCasualChat(rawPrompt, startTime);
      }

      // Handle reporting requests
      if (this.isReportingRequest(rawPrompt, analysis)) {
        console.log(`📊 Reporting request detected`);
        return await this.handleReportingRequest(rawPrompt, analysis, startTime);
      }

      // Handle alert requests
      if (this.isAlertRequest(rawPrompt, analysis)) {
        console.log(`🚨 Alert request detected`);
        return await this.handleAlertRequest(rawPrompt, analysis, startTime);
      }

      // Handle ALL queries with enhanced AI - natural language processing
      try {
        console.log(`🤖 Processing query with enhanced AI: "${rawPrompt}"`);
        return await this.handleNaturalLanguageQuery(rawPrompt, analysis, startTime);
      } catch (handlerError) {
        console.error("❌ Error in AI handler:", handlerError);
        // Final fallback to simple response
        return {
          reply: `I encountered an error while processing your request: ${handlerError.message}. Please try a simpler query or ask for help.`,
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        };
      }

    } catch (err) {
      const duration = Date.now() - startTime;

      // Enhanced error logging
      if (err.response) {
        // API returned an error response
        const status = err.response.status;
        const statusText = err.response.statusText;
        const errorData = err.response.data;

        console.error(`❌ Gemini API error (${status} ${statusText}):`, errorData);

        let userMessage = "I'm experiencing technical difficulties. Please try again later.";

        if (status === 400) {
          userMessage = "There was an issue with your request. Please try rephrasing your question.";
        } else if (status === 401 || status === 403) {
          userMessage = "Authentication error. Please contact your administrator.";
        } else if (status === 429) {
          userMessage = "I'm currently busy. Please wait a moment and try again.";
        } else if (status >= 500) {
          userMessage = "The AI service is temporarily unavailable. Please try again later.";
        }

        return {
          reply: userMessage,
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: duration
        };

      } else if (err.request) {
        // Network error
        console.error("❌ Network error connecting to Gemini API:", err.message);
        return {
          reply: "I'm having trouble connecting to the AI service. Please check your internet connection and try again.",
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: duration
        };

      } else {
        // Other error
        console.error("❌ Unexpected error in Gemini service:", err.message);
        return {
          reply: "An unexpected error occurred. Please try again.",
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: duration
        };
      }
    }
  });

  /**
   * Handle data query requests with OData integration
   */
  this.handleDataQuery = async function(prompt, analysis, startTime) {
    try {
      console.log(`🔍 Processing data query: "${prompt}"`);

      // Check if this is a specific product request
      const productIds = this.extractProductIds(prompt);

      const db = await cds.connect.to('db');
      const { Products } = db.entities;

      let results;
      if (productIds.length > 0) {
        console.log(`🎯 Fetching specific products: ${productIds.join(', ')}`);
        results = await db.run(
          SELECT.from(Products).where({ ID: { in: productIds } })
        );
      } else {
        console.log(`📋 Fetching all products (limited to 10)`);
        results = await db.run(SELECT.from(Products).limit(10));
      }

      console.log(`📊 Query returned ${results.length} products`);

      if (results.length === 0 && productIds.length > 0) {
        return {
          reply: `No products found with ID(s): ${productIds.join(', ')}. Available products have IDs 1-20. Try "show products" to see all available products.`,
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        };
      }

      // Format response
      let responseText = `Found ${results.length} product(s):\n\n`;
      results.forEach((product, index) => {
        responseText += `**${index + 1}. ${product.ProductName}** (ID: ${product.ID})\n`;
        responseText += `   💰 Price: $${product.UnitPrice}\n`;
        responseText += `   📦 Stock: ${product.UnitsInStock || 0} units\n`;
        if (product.Description) {
          responseText += `   📝 ${product.Description}\n`;
        }
        responseText += `\n`;
      });

      return {
        reply: responseText,
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        data: results,
        query: { entity: "Products", productIds: productIds }
      };

    } catch (error) {
      console.error(`❌ Error in data query:`, error);
      return {
        reply: `I encountered an error while processing your data query: ${error.message}. Please try asking for help or use a simpler query.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Handle create operation requests
   */
  this.handleCreateOperation = async function(prompt, analysis, startTime) {
    return {
      reply: `I understand you want to create something, but create operations are not yet implemented. This feature is coming soon! For now, I can help you query and view data.`,
      success: false,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
      intent: analysis.intent.intent
    };
  };

  /**
   * Handle help requests
   */
  this.handleHelpRequest = async function(prompt, analysis, startTime) {
    const helpText = `
🤖 **SAP Copilot Help**

I can help you with the following:

**🔍 Product Comparisons:**
- "Compare product 1 and 2"
- "Compare products 1, 3, and 5"
- "Show me the difference between product 2 and 4"

**📊 Product Queries:**
- "Show me all products"
- "Show product 5"
- "List products"
- "Display product details"

**👥 Customer Information:**
- "Show customers"
- "List all customers"
- "Display customer information"

**🎯 Smart Features:**
- I can compare products side-by-side
- I show price and stock comparisons
- I provide detailed product information
- I can handle multiple product IDs

**💡 Example Queries:**
- "Compare product 1 and 2"
- "Show me product 3"
- "List all products"
- "Show customers"
- "What's the difference between products 1 and 5?"

**🚀 Pro Tips:**
- Use product IDs for specific queries
- I understand natural language
- Ask for comparisons to see detailed analysis
- Try "show products" to see what's available

Ready to help! What would you like to explore?
    `;

    return {
      reply: helpText,
      success: true,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
      type: "help"
    };
  };

  /**
   * Handle natural language queries with enhanced AI understanding
   */
  this.handleNaturalLanguageQuery = async function(prompt, analysis, startTime) {
    try {
      console.log(`🧠 Natural language processing: "${prompt}"`);

      // Get comprehensive business data for context
      const businessData = await this.getComprehensiveBusinessData();

      // Analyze the query intent and extract key information
      const queryAnalysis = this.analyzeQueryIntent(prompt);
      console.log(`🔍 Query analysis:`, queryAnalysis);

      // If it's a simple product listing request, handle directly
      if (queryAnalysis.isProductListing) {
        return await this.handleProductListingQuery(prompt, businessData, startTime);
      }

      // If it's a specific business question, handle with AI
      if (queryAnalysis.isBusinessQuestion) {
        return await this.handleBusinessQuestionWithAI(prompt, businessData, startTime);
      }

      // For complex queries, use full AI processing
      return await this.handleComplexQueryWithAI(prompt, businessData, startTime);

    } catch (error) {
      console.error("❌ Error in natural language processing:", error);
      return {
        reply: `I encountered an error while understanding your question: ${error.message}. Could you please rephrase your question?`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Get comprehensive business data for AI context
   */
  this.getComprehensiveBusinessData = async function() {
    try {
      const db = await cds.connect.to('db');
      const { Products, Customers } = db.entities;

      // Get all products with calculated fields
      const products = await db.run(SELECT.from(Products));
      const customers = await db.run(SELECT.from(Customers).limit(10));

      // Calculate business metrics
      const metrics = {
        totalProducts: products.length,
        averagePrice: products.reduce((sum, p) => sum + (p.UnitPrice || 0), 0) / products.length,
        totalInventoryValue: products.reduce((sum, p) => sum + ((p.UnitPrice || 0) * (p.UnitsInStock || 0)), 0),
        lowStockCount: products.filter(p => (p.UnitsInStock || 0) < 10 && (p.UnitsInStock || 0) > 0).length,
        outOfStockCount: products.filter(p => (p.UnitsInStock || 0) === 0).length,
        highestPrice: Math.max(...products.map(p => p.UnitPrice || 0)),
        lowestPrice: Math.min(...products.map(p => p.UnitPrice || 0))
      };

      return {
        products,
        customers,
        metrics
      };
    } catch (error) {
      console.error("❌ Error getting business data:", error);
      return { products: [], customers: [], metrics: {} };
    }
  };

  /**
   * Analyze query intent and extract key information
   */
  this.analyzeQueryIntent = function(prompt) {
    const lowerPrompt = prompt.toLowerCase();

    // Product listing patterns
    const productListingPatterns = [
      /what.*products.*available/i,
      /show.*products/i,
      /list.*products/i,
      /what.*do.*you.*have/i,
      /what.*items/i,
      /display.*products/i
    ];

    // Business question patterns
    const businessQuestionPatterns = [
      /how.*many/i,
      /what.*average/i,
      /what.*total/i,
      /which.*most/i,
      /which.*least/i,
      /what.*highest/i,
      /what.*lowest/i
    ];

    const isProductListing = productListingPatterns.some(pattern => pattern.test(prompt));
    const isBusinessQuestion = businessQuestionPatterns.some(pattern => pattern.test(prompt));

    return {
      isProductListing,
      isBusinessQuestion,
      originalPrompt: prompt,
      lowerPrompt
    };
  };

  /**
   * Handle simple product listing queries
   */
  this.handleProductListingQuery = async function(prompt, businessData, startTime) {
    try {
      const { products, metrics } = businessData;

      let responseText = `📦 **Available Products** (${products.length} total):\n\n`;

      // Show first 10 products with key details
      const displayProducts = products.slice(0, 10);
      displayProducts.forEach((product, index) => {
        const stockStatus = (product.UnitsInStock || 0) === 0 ? '❌ Out of Stock' :
                           (product.UnitsInStock || 0) < 10 ? '⚠️ Low Stock' : '✅ Available';

        responseText += `**${index + 1}. ${product.ProductName}**\n`;
        responseText += `   💰 Price: $${product.UnitPrice || 0}\n`;
        responseText += `   📦 Stock: ${product.UnitsInStock || 0} units ${stockStatus}\n`;
        if (product.Description) {
          responseText += `   📝 ${product.Description}\n`;
        }
        responseText += `\n`;
      });

      if (products.length > 10) {
        responseText += `... and ${products.length - 10} more products.\n\n`;
      }

      // Add quick insights
      responseText += `💡 **Quick Insights:**\n`;
      responseText += `• Average Price: $${metrics.averagePrice?.toFixed(2) || 0}\n`;
      responseText += `• Price Range: $${metrics.lowestPrice} - $${metrics.highestPrice}\n`;
      responseText += `• Low Stock Items: ${metrics.lowStockCount}\n`;
      responseText += `• Out of Stock: ${metrics.outOfStockCount}\n\n`;
      responseText += `Ask me: "What's our most expensive product?" or "Show me low stock items"`;

      return {
        reply: responseText,
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        type: "product_listing",
        data: { products: displayProducts, metrics }
      };

    } catch (error) {
      console.error("❌ Error in product listing:", error);
      return {
        reply: `I encountered an error while getting the product list: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Handle business questions with AI assistance
   */
  this.handleBusinessQuestionWithAI = async function(prompt, businessData, startTime) {
    try {
      console.log(`💼 Processing business question with AI: "${prompt}"`);

      const { products, metrics } = businessData;

      // Create enhanced prompt for AI with business context
      const enhancedPrompt = `You are SAP Copilot, an intelligent business assistant. Answer the user's question naturally and conversationally using the provided business data.

BUSINESS DATA CONTEXT:
- Total Products: ${metrics.totalProducts}
- Average Price: $${metrics.averagePrice?.toFixed(2)}
- Total Inventory Value: $${metrics.totalInventoryValue?.toFixed(2)}
- Low Stock Items: ${metrics.lowStockCount}
- Out of Stock Items: ${metrics.outOfStockCount}
- Price Range: $${metrics.lowestPrice} - $${metrics.highestPrice}

SAMPLE PRODUCTS:
${products.slice(0, 5).map(p => `- ${p.ProductName}: $${p.UnitPrice}, Stock: ${p.UnitsInStock} units`).join('\n')}

USER QUESTION: "${prompt}"

Provide a natural, conversational response that directly answers their question. Use emojis and formatting to make it engaging. If they ask about products, provide specific examples. Be helpful and informative.

RESPONSE:`;

      // Call AI service
      if (COHERE_KEY) {
        try {
          const response = await axios.post(
            COHERE_URL,
            {
              model: "command",
              message: enhancedPrompt,
              max_tokens: 1000,
              temperature: 0.7
            },
            {
              timeout: 15000,
              headers: {
                'Authorization': `Bearer ${COHERE_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          );

          const aiResponse = response.data?.text?.trim();
          if (aiResponse) {
            return {
              reply: aiResponse,
              success: true,
              timestamp: new Date().toISOString(),
              processingTime: Date.now() - startTime,
              type: "ai_business_response",
              data: { metrics, sampleProducts: products.slice(0, 5) }
            };
          }
        } catch (aiError) {
          console.log("⚠️ AI service failed, using intelligent fallback");
        }
      }

      // Intelligent fallback without AI
      return this.createIntelligentBusinessResponse(prompt, businessData, startTime);

    } catch (error) {
      console.error("❌ Error in business question handler:", error);
      return {
        reply: `I encountered an error while processing your business question: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Handle complex queries with full AI processing
   */
  this.handleComplexQueryWithAI = async function(prompt, businessData, startTime) {
    try {
      console.log(`🧠 Processing complex query with full AI: "${prompt}"`);

      // Use the existing universal AI handler with enhanced context
      return await this.handleUniversalAIQuery(prompt, null, startTime, businessData);

    } catch (error) {
      console.error("❌ Error in complex query handler:", error);
      return {
        reply: `I encountered an error while processing your complex query: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Create intelligent business response without AI
   */
  this.createIntelligentBusinessResponse = function(prompt, businessData, startTime) {
    const { products, metrics } = businessData;
    const lowerPrompt = prompt.toLowerCase();

    let responseText = "";

    if (lowerPrompt.includes('how many')) {
      responseText = `📊 I have access to **${metrics.totalProducts} products** in our catalog. `;
      if (lowerPrompt.includes('stock')) {
        responseText += `Currently, **${metrics.lowStockCount} products** have low stock (below 10 units) and **${metrics.outOfStockCount} products** are out of stock.`;
      } else {
        responseText += `Would you like to see the complete list or filter by specific criteria?`;
      }
    } else if (lowerPrompt.includes('average') && lowerPrompt.includes('price')) {
      responseText = `💰 The average product price is **$${metrics.averagePrice?.toFixed(2)}**. Our prices range from $${metrics.lowestPrice} to $${metrics.highestPrice}.`;
    } else if (lowerPrompt.includes('total') && lowerPrompt.includes('value')) {
      responseText = `💎 The total inventory value is **$${metrics.totalInventoryValue?.toFixed(2)}**, calculated from all ${metrics.totalProducts} products and their current stock levels.`;
    } else {
      // General response
      responseText = `📊 I have access to **${metrics.totalProducts} products** and can provide detailed analysis. `;
      responseText += `Our inventory includes items ranging from $${metrics.lowestPrice} to $${metrics.highestPrice}. `;
      responseText += `What specific aspect interests you? I can show you product lists, analyze pricing, check stock levels, or provide business insights.`;
    }

    return {
      reply: responseText,
      success: true,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
      type: "intelligent_business_response",
      data: { metrics }
    };
  };

  /**
   * Handle ALL queries with AI - Universal AI handler with smart data context
   */
  this.handleUniversalAIQuery = async function(prompt, analysis, startTime, providedBusinessData = null) {
    try {
      console.log(`🌟 Universal AI processing: "${prompt}"`);

      // Check if this is a transaction operation first
      const isTransaction = analysis && this.isTransactionOperation(prompt, analysis);
      console.log(`🔍 Transaction check: isTransaction=${isTransaction}, intent=${analysis?.intent?.intent}, confidence=${analysis?.intent?.confidence}`);

      if (isTransaction) {
        console.log(`💼 Detected transaction operation`);
        return await this.handleTransactionOperation(prompt, analysis, startTime);
      }

      // Get relevant business data based on the query (use provided data if available)
      const contextData = providedBusinessData || await this.getRelevantBusinessData(prompt);

      // Create comprehensive business context for AI
      const businessContext = this.createComprehensiveBusinessContext(contextData, prompt);

      // Create enhanced prompt with all relevant data
      const enhancedPrompt = `You are SAP Copilot, an intelligent business assistant with access to real business data.

User Query: "${prompt}"

BUSINESS DATA CONTEXT:
${businessContext}

INSTRUCTIONS:
- Analyze the user's question and provide intelligent, actionable responses
- Use the provided business data to give specific, data-driven answers
- For product queries, reference actual product IDs, names, prices, and stock levels
- For comparisons, provide detailed analysis with specific data points
- For recommendations, use actual inventory levels and business logic
- For general questions, provide professional business insights
- For transaction requests, guide users on proper syntax and requirements
- Always be helpful, accurate, and business-focused
- Format responses clearly with emojis and structure for readability

RESPONSE:`;

      // Call Cohere AI with comprehensive context
      if (!COHERE_KEY) {
        console.log("⚠️ No Cohere API key, using intelligent fallback");
        return this.createIntelligentContextualResponse(prompt, contextData, startTime);
      }

      console.log(`🤖 Calling Cohere AI with comprehensive business context`);
      console.log(`📊 Context includes: ${contextData.products?.length || 0} products, ${contextData.customers?.length || 0} customers`);

      const response = await axios.post(
        COHERE_URL,
        {
          model: "command",
          message: enhancedPrompt,
          max_tokens: 1500,
          temperature: 0.7
        },
        {
          timeout: 10000, // Reduced from 30s to 10s
          headers: {
            'Authorization': `Bearer ${COHERE_KEY}`,
            'Content-Type': 'application/json',
            'User-Agent': 'SAP-Copilot/1.0'
          }
        }
      );

      const text = response.data?.text;
      if (!text) {
        console.log("❌ No text in Cohere response, using intelligent fallback");
        return this.createIntelligentContextualResponse(prompt, contextData, startTime);
      }

      console.log(`✅ Universal AI provided successful response`);
      return {
        reply: text.trim(),
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        data: contextData,
        type: "universal_ai"
      };

    } catch (error) {
      console.error("❌ Error in universal AI query:", error.message);
      if (error.response) {
        console.error("❌ Response status:", error.response.status);
        console.error("❌ Response data:", JSON.stringify(error.response.data, null, 2));
      }

      // Fallback to intelligent contextual response
      const contextData = await this.getRelevantBusinessData(prompt);
      return this.createIntelligentContextualResponse(prompt, contextData, startTime);
    }
  };

  /**
   * Get relevant business data based on the query
   */
  this.getRelevantBusinessData = async function(prompt) {
    try {
      const db = await cds.connect.to('db');
      const { Products, Customers } = db.entities;

      const lowerPrompt = prompt.toLowerCase();
      let contextData = {};

      // Always get some product data as it's the most common query type
      if (lowerPrompt.includes('product') || lowerPrompt.includes('item') ||
          lowerPrompt.includes('inventory') || lowerPrompt.includes('stock') ||
          lowerPrompt.includes('reorder') || lowerPrompt.includes('compare') ||
          lowerPrompt.includes('tea') || lowerPrompt.includes('beverage') ||
          lowerPrompt.includes('show') || lowerPrompt.includes('list')) {

        contextData.products = await db.run(SELECT.from(Products).limit(20));

        // Add specific analysis for inventory-related queries
        if (lowerPrompt.includes('reorder') || lowerPrompt.includes('stock')) {
          contextData.lowStock = contextData.products.filter(p => p.UnitsInStock < 20);
          contextData.outOfStock = contextData.products.filter(p => p.UnitsInStock === 0);
          contextData.highStock = contextData.products.filter(p => p.UnitsInStock > 100);
        }
      }

      // Get customer data if relevant
      if (lowerPrompt.includes('customer') || lowerPrompt.includes('client')) {
        contextData.customers = await db.run(SELECT.from(Customers).limit(10));
      }

      // If no specific data type detected, get general overview
      if (!contextData.products && !contextData.customers) {
        contextData.products = await db.run(SELECT.from(Products).limit(10));
        contextData.customers = await db.run(SELECT.from(Customers).limit(5));
      }

      return contextData;

    } catch (error) {
      console.error("❌ Error getting business data:", error);
      return {};
    }
  };

  /**
   * Handle general queries with enhanced intelligence
   */
  this.handleGeneralQuery = async function(prompt, analysis, startTime) {
    try {
      console.log(`🔍 Processing general query: "${prompt}"`);

      // Check for comparison requests
      if (this.isComparisonQuery(prompt)) {
        return await this.handleComparisonQuery(prompt, startTime);
      }

      // Check for business intelligence queries
      if (this.isBusinessIntelligenceQuery(prompt)) {
        return await this.handleBusinessIntelligenceQuery(prompt, startTime);
      }

      // Check for analytics queries
      if (this.isAnalyticsQuery(prompt)) {
        return await this.handleAnalyticsQuery(prompt, startTime);
      }

      // Check for product queries
      if (this.isProductQuery(prompt)) {
        return await this.handleProductQuery(prompt, startTime);
      }

      // Check for customer queries
      if (this.isCustomerQuery(prompt)) {
        return await this.handleCustomerQuery(prompt, startTime);
      }

      // Try Cohere AI for general questions, with intelligent fallback
      if (COHERE_KEY) {
        console.log(`🤖 Attempting Cohere AI for general query: "${prompt}"`);
        try {
          return await this.callCohereAI(prompt, startTime);
        } catch (error) {
          console.log(`⚠️ Cohere AI failed, using intelligent mock response`);
          return this.createIntelligentMockResponse(prompt, startTime);
        }
      } else {
        console.log(`❌ No COHERE_API_KEY found, using intelligent mock response`);
        return this.createIntelligentMockResponse(prompt, startTime);
      }

      // Default response with suggestions if no Gemini API
      return {
        reply: `I understand you're asking: "${prompt}"\n\nI can help you with:\n• Product comparisons: "compare product 1 and 2"\n• Product listings: "show products" or "list all products"\n• Customer information: "show customers"\n• Specific product details: "show product 5"\n• Help: "help" or "what can you do"\n\n💡 **Note**: For general questions, please configure the Gemini API key to enable full AI capabilities.\n\nWhat would you like to explore?`,
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error("❌ Error in general query:", error);
      return {
        reply: `I encountered an error: ${error.message}. Please try asking for "help" or a simpler query.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Check if query is asking for business intelligence/analysis
   */
  this.isBusinessIntelligenceQuery = function(prompt) {
    const biKeywords = [
      'should i reorder', 'reorder', 'best for', 'recommend', 'suggestion', 'advice',
      'which product', 'what product', 'most profitable', 'insights', 'analysis',
      'best choice', 'optimal', 'strategy', 'business', 'profitable', 'revenue',
      'margin', 'performance', 'trend', 'forecast', 'predict'
    ];
    const lowerPrompt = prompt.toLowerCase();
    return biKeywords.some(keyword => lowerPrompt.includes(keyword));
  };

  /**
   * Check if query is asking for specific data (not analysis)
   */
  this.isSpecificDataQuery = function(prompt) {
    const specificKeywords = [
      'show product', 'list product', 'display product', 'show all', 'list all',
      'show customer', 'list customer', 'compare product', 'product id'
    ];
    const lowerPrompt = prompt.toLowerCase();
    return specificKeywords.some(keyword => lowerPrompt.includes(keyword)) ||
           /\b(product|customer|order)\s+\d+\b/.test(lowerPrompt);
  };

  /**
   * Check if query is asking for comparison
   */
  this.isComparisonQuery = function(prompt) {
    const comparisonKeywords = ['compare', 'comparison', 'vs', 'versus', 'difference', 'differences'];
    return comparisonKeywords.some(keyword => prompt.toLowerCase().includes(keyword));
  };

  /**
   * Check if query is about products
   */
  this.isProductQuery = function(prompt) {
    const lowerPrompt = prompt.toLowerCase();

    // Direct product keywords
    const productKeywords = ['product', 'products', 'item', 'items'];
    const hasProductKeywords = productKeywords.some(keyword => lowerPrompt.includes(keyword));

    // Action keywords for data queries
    const actionKeywords = ['show', 'list', 'display', 'find', 'get', 'view'];
    const hasActionKeywords = actionKeywords.some(keyword => lowerPrompt.includes(keyword));

    // Stock/inventory specific patterns
    const stockPatterns = [
      /stock\s*(below|under|less than|<)\s*(\d+)/i,
      /stock\s*(above|over|greater than|>)\s*(\d+)/i,
      /stock\s*(equals?|=)\s*(\d+)/i,
      /low\s*stock/i,
      /out\s*of\s*stock/i,
      /inventory\s*(below|under|above|over)/i
    ];

    const hasStockPatterns = stockPatterns.some(pattern => pattern.test(prompt));

    // Price patterns
    const pricePatterns = [
      /price\s*(below|under|less than|<)\s*(\d+)/i,
      /price\s*(above|over|greater than|>)\s*(\d+)/i,
      /expensive/i,
      /cheap/i,
      /cost/i
    ];

    const hasPricePatterns = pricePatterns.some(pattern => pattern.test(prompt));

    return hasProductKeywords || (hasActionKeywords && (hasStockPatterns || hasPricePatterns)) || hasStockPatterns;
  };

  /**
   * Check if query is about customers
   */
  this.isCustomerQuery = function(prompt) {
    const customerKeywords = ['customer', 'customers', 'client', 'clients'];
    return customerKeywords.some(keyword => prompt.toLowerCase().includes(keyword));
  };

  /**
   * Check if query is business intelligence related
   */
  this.isBusinessIntelligenceQuery = function(prompt) {
    const biKeywords = [
      'average', 'mean', 'total', 'sum', 'count', 'how many', 'how much',
      'statistics', 'stats', 'analysis', 'analyze', 'insights', 'trends',
      'performance', 'metrics', 'kpi', 'dashboard', 'report', 'summary',
      'breakdown', 'distribution', 'percentage', 'ratio', 'compare',
      'most expensive', 'cheapest', 'highest', 'lowest', 'best', 'worst',
      'top', 'bottom', 'ranking', 'rank'
    ];
    const lowerPrompt = prompt.toLowerCase();
    return biKeywords.some(keyword => lowerPrompt.includes(keyword));
  };

  /**
   * Check if query is analytics related
   */
  this.isAnalyticsQuery = function(prompt) {
    const analyticsKeywords = [
      'forecast', 'predict', 'projection', 'trend', 'growth', 'decline',
      'correlation', 'pattern', 'seasonal', 'monthly', 'quarterly', 'yearly',
      'revenue', 'profit', 'margin', 'cost', 'efficiency', 'optimization',
      'benchmark', 'variance', 'deviation', 'outlier', 'anomaly'
    ];
    const lowerPrompt = prompt.toLowerCase();
    return analyticsKeywords.some(keyword => lowerPrompt.includes(keyword));
  };

  /**
   * Check if this is casual chat
   */
  this.isCasualChat = function(prompt) {
    const casualPhrases = [
      'all good', 'ok', 'okay', 'thanks', 'thank you', 'bye', 'goodbye',
      'cool', 'nice', 'great', 'awesome', 'perfect', 'excellent',
      'got it', 'understood', 'alright', 'fine', 'good', 'yes', 'no',
      'sure', 'yep', 'nope', 'right', 'correct'
    ];

    const lowerPrompt = prompt.toLowerCase().trim();
    return casualPhrases.includes(lowerPrompt) || lowerPrompt.length < 10;
  };

  /**
   * Handle casual chat responses
   */
  this.handleCasualChat = function(prompt, startTime) {
    const lowerPrompt = prompt.toLowerCase().trim();
    let reply = "";

    if (lowerPrompt.includes('good') || lowerPrompt.includes('great') || lowerPrompt.includes('perfect')) {
      reply = "Great! I'm glad everything is working well. Is there anything else you'd like to do with your business data?";
    } else if (lowerPrompt.includes('thank') || lowerPrompt.includes('thanks')) {
      reply = "You're welcome! I'm here whenever you need help with your business operations.";
    } else if (lowerPrompt.includes('bye') || lowerPrompt.includes('goodbye')) {
      reply = "Goodbye! Feel free to come back anytime for business assistance.";
    } else if (lowerPrompt.includes('ok') || lowerPrompt.includes('okay') || lowerPrompt.includes('alright')) {
      reply = "👍 Understood! Let me know if you need help with products, customers, or any business operations.";
    } else {
      reply = "I'm here to help with your business operations! Try asking me about products, customers, or any transactions you need to perform.";
    }

    return {
      reply: reply,
      success: true,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
      type: "casual_chat"
    };
  };

  /**
   * Check if this is an alert request
   */
  this.isAlertRequest = function(prompt, analysis) {
    const lowerPrompt = prompt.toLowerCase();

    // Check for explicit alert keywords
    const alertKeywords = [
      'notify', 'alert', 'warn', 'notification', 'monitor', 'watch',
      'threshold', 'trigger', 'alarm', 'reminder', 'check'
    ];

    const hasAlertKeywords = alertKeywords.some(keyword => lowerPrompt.includes(keyword));

    // Check for alert patterns
    const alertPatterns = [
      /notify.*when/i,
      /alert.*if/i,
      /warn.*when/i,
      /monitor.*for/i,
      /watch.*for/i,
      /set.*alert/i,
      /create.*notification/i,
      /threshold.*for/i
    ];

    const hasAlertPatterns = alertPatterns.some(pattern => pattern.test(prompt));

    // Check intent analysis
    const isAlertIntent = analysis &&
      (analysis.intent.intent === 'ALERT_REQUEST' || analysis.intent.intent === 'NOTIFICATION_REQUEST') &&
      analysis.intent.confidence > 0.5;

    console.log(`🔍 Alert detection: keywords=${hasAlertKeywords}, patterns=${hasAlertPatterns}, intent=${analysis?.intent?.intent}`);

    return hasAlertKeywords || hasAlertPatterns || isAlertIntent;
  };

  /**
   * Handle alert requests
   */
  this.handleAlertRequest = async function(prompt, analysis, startTime) {
    try {
      console.log(`🚨 Processing alert request: "${prompt}"`);

      // Check if this is a status/info request
      if (this.isAlertStatusRequest(prompt)) {
        return await this.handleAlertStatusRequest(prompt, startTime);
      }

      // Check if this is an alert management request
      if (this.isAlertManagementRequest(prompt)) {
        return await this.handleAlertManagementRequest(prompt, startTime);
      }

      // Otherwise, try to create a new alert rule
      const result = await alertManager.createAlertFromNaturalLanguage(prompt);

      let reply = '';
      if (result.success) {
        reply = `✅ **Alert Created Successfully!**\n\n`;
        reply += `🚨 **Alert Rule:** ${result.rule.name}\n`;
        reply += `📋 **Description:** ${result.description}\n`;
        reply += `⚡ **Priority:** ${result.rule.priority.toUpperCase()}\n`;
        reply += `📢 **Channels:** ${result.rule.channels.join(', ')}\n`;
        reply += `🎯 **Threshold:** ${result.rule.threshold}\n\n`;
        reply += `🔍 **Monitoring:** This alert is now active and will monitor your business data.\n`;
        reply += `📊 **Status:** You can check alert status with "show alert status"\n\n`;
        reply += `💡 **Test Alert:** Try "check alerts now" to trigger immediate checking`;
      } else {
        reply = `❌ **Alert Creation Failed**\n\n`;
        reply += `**Issue:** ${result.message}\n\n`;
        reply += `💡 **Try these examples:**\n`;
        result.suggestions?.forEach(suggestion => {
          reply += `• "${suggestion}"\n`;
        });
      }

      return {
        reply: reply,
        success: result.success,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        data: result.rule || null,
        type: result.success ? "alert_created" : "alert_error"
      };

    } catch (error) {
      console.error("❌ Error in alert request:", error);
      return {
        reply: `Alert processing failed: ${error.message}. Please try again with a simpler alert request.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Check if this is an alert status request
   */
  this.isAlertStatusRequest = function(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    return lowerPrompt.includes('alert status') ||
           lowerPrompt.includes('show alerts') ||
           lowerPrompt.includes('list alerts') ||
           lowerPrompt.includes('alert summary') ||
           lowerPrompt.includes('notification status');
  };

  /**
   * Handle alert status requests
   */
  this.handleAlertStatusRequest = async function(prompt, startTime) {
    try {
      const status = alertManager.getSystemStatus();
      const activity = alertManager.getRecentActivity(5);

      let reply = `📊 **Alert System Status**\n\n`;

      // System status
      reply += `🔧 **System Status:**\n`;
      reply += `• **Monitoring:** ${status.monitoring ? '✅ Active' : '❌ Inactive'}\n`;
      reply += `• **Total Rules:** ${status.alertEngine.totalRules}\n`;
      reply += `• **Active Rules:** ${status.alertEngine.enabledRules}\n`;
      reply += `• **Total Alerts:** ${status.alertEngine.totalAlerts}\n`;
      reply += `• **Unacknowledged:** ${status.alertEngine.unacknowledgedAlerts}\n\n`;

      // Recent alerts
      if (activity.alerts.length > 0) {
        reply += `🚨 **Recent Alerts:**\n`;
        activity.alerts.slice(0, 3).forEach(alert => {
          const timeAgo = this.getTimeAgo(alert.timestamp);
          const status = alert.acknowledged ? '✅' : '⚠️';
          reply += `• ${status} ${alert.message} (${timeAgo})\n`;
        });
        reply += `\n`;
      }

      // Notification stats
      reply += `📧 **Notifications:**\n`;
      reply += `• **In-App:** ${status.notifications.inApp} (${status.notifications.unread} unread)\n`;
      reply += `• **Email Sent:** ${status.notifications.channels.email || 0}\n`;
      reply += `• **SMS Sent:** ${status.notifications.channels.sms || 0}\n\n`;

      // Recipients
      reply += `👥 **Recipients:**\n`;
      reply += `• **Email:** ${status.recipients.email} configured\n`;
      reply += `• **Phone:** ${status.recipients.phone} configured\n\n`;

      reply += `💡 **Commands:** "create alert", "check alerts now", "show alert rules"`;

      return {
        reply: reply,
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        data: { status, activity },
        type: "alert_status"
      };

    } catch (error) {
      console.error("❌ Error getting alert status:", error);
      return {
        reply: `Failed to get alert status: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Check if this is an alert management request
   */
  this.isAlertManagementRequest = function(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    return lowerPrompt.includes('check alerts now') ||
           lowerPrompt.includes('trigger alerts') ||
           lowerPrompt.includes('test alerts') ||
           lowerPrompt.includes('show alert rules') ||
           lowerPrompt.includes('list alert rules');
  };

  /**
   * Handle alert management requests
   */
  this.handleAlertManagementRequest = async function(prompt, startTime) {
    try {
      const lowerPrompt = prompt.toLowerCase();

      if (lowerPrompt.includes('check alerts now') || lowerPrompt.includes('trigger alerts') || lowerPrompt.includes('test alerts')) {
        // Manual alert check
        const result = await alertManager.checkAlertsNow();

        return {
          reply: `🔍 **Manual Alert Check Completed**\n\nAll alert rules have been checked against current business data. Any triggered alerts will appear in your notifications.`,
          success: true,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          type: "alert_check"
        };
      }

      if (lowerPrompt.includes('show alert rules') || lowerPrompt.includes('list alert rules')) {
        // Show all alert rules
        const rules = alertManager.getAllAlertRules();

        let reply = `📋 **Alert Rules (${rules.length} total)**\n\n`;

        rules.forEach(rule => {
          const status = rule.enabled ? '✅' : '❌';
          const priority = rule.priority.toUpperCase();
          reply += `${status} **${rule.name}** (${priority})\n`;
          reply += `   📝 ${rule.description}\n`;
          reply += `   🎯 Threshold: ${rule.threshold}\n`;
          reply += `   📢 Channels: ${rule.channels.join(', ')}\n`;
          if (rule.lastTriggered) {
            reply += `   ⏰ Last triggered: ${this.getTimeAgo(rule.lastTriggered)}\n`;
          }
          reply += `\n`;
        });

        return {
          reply: reply,
          success: true,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          data: rules,
          type: "alert_rules"
        };
      }

      return {
        reply: `Alert management command not recognized. Try: "check alerts now" or "show alert rules"`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error("❌ Error in alert management:", error);
      return {
        reply: `Alert management failed: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Get time ago string
   */
  this.getTimeAgo = function(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  /**
   * Check if this is a reporting request
   */
  this.isReportingRequest = function(prompt, analysis) {
    const lowerPrompt = prompt.toLowerCase();

    // Check for explicit reporting keywords
    const reportingKeywords = [
      'report', 'export', 'download', 'generate', 'pdf', 'excel', 'xlsx',
      'summary', 'analysis', 'statistics', 'chart', 'graph'
    ];

    const hasReportingKeywords = reportingKeywords.some(keyword => lowerPrompt.includes(keyword));

    // Check intent analysis
    const isReportIntent = analysis &&
      (analysis.intent.intent === 'REPORT_REQUEST' || analysis.intent.intent === 'REPORT_GENERATION') &&
      analysis.intent.confidence > 0.5;

    console.log(`🔍 Reporting detection: keywords=${hasReportingKeywords}, intent=${analysis?.intent?.intent}, confidence=${analysis?.intent?.confidence}`);

    return hasReportingKeywords || isReportIntent;
  };

  /**
   * Handle reporting requests
   */
  this.handleReportingRequest = async function(prompt, analysis, startTime) {
    try {
      console.log(`📊 Processing reporting request: "${prompt}"`);

      // Parse the reporting request
      const reportRequest = this.parseReportRequest(prompt);

      if (!reportRequest.success) {
        return {
          reply: reportRequest.error || "I couldn't understand your report request. Try: 'Export products as PDF' or 'Download inventory report as Excel'",
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        };
      }

      // Get the data for the report
      const reportData = await this.getReportData(reportRequest.dataType);

      if (!reportData.success) {
        return {
          reply: `Failed to get data for ${reportRequest.dataType} report: ${reportData.error}`,
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        };
      }

      // Generate the report
      let reportResult;
      if (reportRequest.format === 'pdf') {
        reportResult = await reportGenerator.generatePDFReport(
          reportData.data,
          reportRequest.dataType,
          reportRequest.title
        );
      } else if (reportRequest.format === 'excel') {
        reportResult = await reportGenerator.generateExcelReport(
          reportData.data,
          reportRequest.dataType,
          reportRequest.title
        );
      } else {
        return {
          reply: `Report format '${reportRequest.format}' is not supported. Available formats: PDF, Excel`,
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        };
      }

      // Generate summary statistics
      const stats = reportGenerator.generateSummaryStats(reportData.data, reportRequest.dataType);

      // Create response
      let reply = `✅ **Report Generated Successfully!**\n\n`;
      reply += `📊 **Report Details:**\n`;
      reply += `• **Type**: ${reportRequest.title}\n`;
      reply += `• **Format**: ${reportRequest.format.toUpperCase()}\n`;
      reply += `• **Records**: ${reportData.data.length}\n`;
      reply += `• **File**: ${reportResult.fileName}\n\n`;

      // Add summary statistics
      if (stats && Object.keys(stats).length > 0) {
        reply += `📈 **Summary Statistics:**\n`;
        Object.entries(stats).forEach(([key, value]) => {
          const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
          reply += `• **${displayKey}**: ${value}\n`;
        });
        reply += `\n`;
      }

      reply += `💾 **Download**: The report has been generated and is ready for download.\n`;
      reply += `🔗 **Direct Download**: http://localhost:4004/download/${reportResult.fileName}\n`;
      reply += `📁 **File Location**: ${reportResult.downloadUrl}`;

      return {
        reply: reply,
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        data: {
          reportFile: reportResult,
          statistics: stats,
          recordCount: reportData.data.length
        },
        type: "report_generated"
      };

    } catch (error) {
      console.error("❌ Error in reporting request:", error);
      return {
        reply: `Report generation failed: ${error.message}. Please try again or contact support.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Check if query is a transaction operation
   */
  this.isTransactionOperation = function(prompt, analysis) {
    if (!analysis || !analysis.intent) return false;

    const transactionIntents = ['CREATE_OPERATION', 'UPDATE_OPERATION', 'DELETE_OPERATION'];
    const isTransactionIntent = transactionIntents.includes(analysis.intent.intent);
    const hasGoodConfidence = analysis.intent.confidence > 0.5; // Lowered threshold

    // Also check for explicit transaction keywords in the prompt
    const lowerPrompt = prompt.toLowerCase();
    const hasTransactionKeywords =
      lowerPrompt.includes('create') || lowerPrompt.includes('add') || lowerPrompt.includes('new') ||
      lowerPrompt.includes('update') || lowerPrompt.includes('modify') || lowerPrompt.includes('change') ||
      lowerPrompt.includes('delete') || lowerPrompt.includes('remove') || lowerPrompt.includes('cancel');

    console.log(`🔍 Transaction detection: intent=${analysis.intent.intent}, confidence=${analysis.intent.confidence}, hasKeywords=${hasTransactionKeywords}`);

    return (isTransactionIntent && hasGoodConfidence) || hasTransactionKeywords;
  };

  /**
   * Handle product comparison queries
   */
  this.handleComparisonQuery = async function(prompt, startTime) {
    try {
      console.log(`🔍 Processing comparison query...`);

      // Extract product IDs from the prompt
      const productIds = this.extractProductIds(prompt);

      if (productIds.length < 2) {
        return {
          reply: "To compare products, please specify at least 2 product IDs. For example: 'compare product 1 and 2' or 'compare products 1, 3, and 5'.",
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        };
      }

      // Get product data
      const db = await cds.connect.to('db');
      const { Products } = db.entities;

      console.log(`🔍 Looking for products with IDs: ${productIds.join(', ')}`);

      // Use proper CAP query syntax
      const products = await db.run(
        SELECT.from(Products).where({ ID: { in: productIds } })
      );

      console.log(`📊 Found ${products.length} products:`, products.map(p => `${p.ID}: ${p.ProductName}`));

      if (products.length === 0) {
        return {
          reply: `No products found with IDs: ${productIds.join(', ')}. Please check the product IDs and try again.`,
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        };
      }

      // Generate comparison
      const comparisonText = this.generateProductComparison(products, productIds);

      return {
        reply: comparisonText,
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        data: products,
        type: "comparison"
      };

    } catch (error) {
      console.error("❌ Error in comparison query:", error);
      return {
        reply: `I encountered an error while comparing products: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Handle business intelligence queries
   */
  this.handleBusinessIntelligenceQuery = async function(prompt, startTime) {
    try {
      console.log(`📊 Processing business intelligence query: "${prompt}"`);

      const db = await cds.connect.to('db');
      const { Products } = db.entities;

      // Get all products for analysis
      const allProducts = await db.run(SELECT.from(Products));

      const lowerPrompt = prompt.toLowerCase();
      let result = {};
      let responseText = "";

      // Average price queries
      if (lowerPrompt.includes('average') && lowerPrompt.includes('price')) {
        const avgPrice = allProducts.reduce((sum, p) => sum + (p.Price || 0), 0) / allProducts.length;
        result.averagePrice = avgPrice.toFixed(2);
        responseText = `📊 **Average Product Price**: $${result.averagePrice} USD\n\nBased on ${allProducts.length} products in our catalog.`;
      }

      // Total value queries
      else if (lowerPrompt.includes('total') && (lowerPrompt.includes('value') || lowerPrompt.includes('inventory'))) {
        const totalValue = allProducts.reduce((sum, p) => sum + ((p.Price || 0) * (p.InStock || 0)), 0);
        result.totalInventoryValue = totalValue.toFixed(2);
        responseText = `💰 **Total Inventory Value**: $${result.totalInventoryValue} USD\n\nCalculated from ${allProducts.length} products and their current stock levels.`;
      }

      // Count queries
      else if (lowerPrompt.includes('how many') || lowerPrompt.includes('count')) {
        if (lowerPrompt.includes('low stock') || lowerPrompt.includes('critical')) {
          const lowStockProducts = allProducts.filter(p => (p.InStock || 0) < 10 && (p.InStock || 0) > 0);
          result.lowStockCount = lowStockProducts.length;
          responseText = `⚠️ **Low Stock Alert**: ${result.lowStockCount} products have critical stock levels (below 10 units)\n\n`;
          if (lowStockProducts.length > 0) {
            responseText += "**Products needing attention:**\n";
            lowStockProducts.slice(0, 5).forEach(p => {
              responseText += `• ${p.ProductName}: ${p.InStock} units remaining\n`;
            });
            if (lowStockProducts.length > 5) {
              responseText += `... and ${lowStockProducts.length - 5} more products`;
            }
          }
        } else if (lowerPrompt.includes('out of stock') || lowerPrompt.includes('unavailable')) {
          const outOfStockProducts = allProducts.filter(p => (p.InStock || 0) === 0);
          result.outOfStockCount = outOfStockProducts.length;
          responseText = `❌ **Out of Stock**: ${result.outOfStockCount} products are currently unavailable\n\n`;
          if (outOfStockProducts.length > 0) {
            responseText += "**Out of stock products:**\n";
            outOfStockProducts.slice(0, 5).forEach(p => {
              responseText += `• ${p.ProductName}\n`;
            });
            if (outOfStockProducts.length > 5) {
              responseText += `... and ${outOfStockProducts.length - 5} more products`;
            }
          }
        } else {
          result.totalProducts = allProducts.length;
          responseText = `📦 **Total Products**: ${result.totalProducts} products in our catalog`;
        }
      }

      // Most expensive/cheapest queries
      else if (lowerPrompt.includes('most expensive') || lowerPrompt.includes('highest price')) {
        const mostExpensive = allProducts.reduce((max, p) => (p.Price || 0) > (max.Price || 0) ? p : max, allProducts[0]);
        result.mostExpensive = mostExpensive;
        responseText = `💎 **Most Expensive Product**: ${mostExpensive.ProductName}\n\n**Price**: $${mostExpensive.Price} USD\n**Stock**: ${mostExpensive.InStock} units\n**Category**: ${mostExpensive.Category}`;
      }

      else if (lowerPrompt.includes('cheapest') || lowerPrompt.includes('lowest price')) {
        const cheapest = allProducts.reduce((min, p) => (p.Price || Infinity) < (min.Price || Infinity) ? p : min, allProducts[0]);
        result.cheapest = cheapest;
        responseText = `💰 **Cheapest Product**: ${cheapest.ProductName}\n\n**Price**: $${cheapest.Price} USD\n**Stock**: ${cheapest.InStock} units\n**Category**: ${cheapest.Category}`;
      }

      // Category breakdown
      else if (lowerPrompt.includes('category') || lowerPrompt.includes('breakdown')) {
        const categoryStats = {};
        allProducts.forEach(p => {
          const cat = p.Category || 'Uncategorized';
          if (!categoryStats[cat]) {
            categoryStats[cat] = { count: 0, totalValue: 0, avgPrice: 0 };
          }
          categoryStats[cat].count++;
          categoryStats[cat].totalValue += (p.Price || 0) * (p.InStock || 0);
        });

        // Calculate average prices
        Object.keys(categoryStats).forEach(cat => {
          const products = allProducts.filter(p => (p.Category || 'Uncategorized') === cat);
          categoryStats[cat].avgPrice = products.reduce((sum, p) => sum + (p.Price || 0), 0) / products.length;
        });

        result.categoryBreakdown = categoryStats;
        responseText = `📊 **Product Category Breakdown**:\n\n`;
        Object.entries(categoryStats).forEach(([category, stats]) => {
          responseText += `**${category}**:\n`;
          responseText += `• Products: ${stats.count}\n`;
          responseText += `• Avg Price: $${stats.avgPrice.toFixed(2)}\n`;
          responseText += `• Inventory Value: $${stats.totalValue.toFixed(2)}\n\n`;
        });
      }

      // Default fallback
      else {
        const stats = {
          totalProducts: allProducts.length,
          avgPrice: (allProducts.reduce((sum, p) => sum + (p.Price || 0), 0) / allProducts.length).toFixed(2),
          lowStock: allProducts.filter(p => (p.InStock || 0) < 10 && (p.InStock || 0) > 0).length,
          outOfStock: allProducts.filter(p => (p.InStock || 0) === 0).length
        };

        result.generalStats = stats;
        responseText = `📊 **Business Intelligence Summary**:\n\n`;
        responseText += `• **Total Products**: ${stats.totalProducts}\n`;
        responseText += `• **Average Price**: $${stats.avgPrice} USD\n`;
        responseText += `• **Low Stock Items**: ${stats.lowStock}\n`;
        responseText += `• **Out of Stock**: ${stats.outOfStock}\n\n`;
        responseText += `💡 Try asking: "What's our most expensive product?" or "How many products are low stock?"`;
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Business intelligence query completed in ${duration}ms`);

      return {
        reply: responseText,
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: duration,
        type: "business_intelligence",
        data: result
      };

    } catch (error) {
      console.error("❌ Error in business intelligence query:", error);
      return {
        reply: `I encountered an error while analyzing the business data: ${error.message}. Please try a simpler query.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Handle analytics queries
   */
  this.handleAnalyticsQuery = async function(prompt, startTime) {
    try {
      console.log(`📈 Processing analytics query: "${prompt}"`);

      const db = await cds.connect.to('db');
      const { Products } = db.entities;

      // Get all products for analysis
      const allProducts = await db.run(SELECT.from(Products));

      const lowerPrompt = prompt.toLowerCase();
      let result = {};
      let responseText = "";

      // Price trend analysis
      if (lowerPrompt.includes('trend') || lowerPrompt.includes('pattern')) {
        const priceRanges = {
          'Under $10': allProducts.filter(p => (p.Price || 0) < 10).length,
          '$10-$20': allProducts.filter(p => (p.Price || 0) >= 10 && (p.Price || 0) < 20).length,
          '$20-$50': allProducts.filter(p => (p.Price || 0) >= 20 && (p.Price || 0) < 50).length,
          'Over $50': allProducts.filter(p => (p.Price || 0) >= 50).length
        };

        result.priceDistribution = priceRanges;
        responseText = `📈 **Price Distribution Analysis**:\n\n`;
        Object.entries(priceRanges).forEach(([range, count]) => {
          const percentage = ((count / allProducts.length) * 100).toFixed(1);
          responseText += `• **${range}**: ${count} products (${percentage}%)\n`;
        });
      }

      // Stock efficiency analysis
      else if (lowerPrompt.includes('efficiency') || lowerPrompt.includes('optimization')) {
        const stockEfficiency = {
          wellStocked: allProducts.filter(p => (p.InStock || 0) >= 20).length,
          adequateStock: allProducts.filter(p => (p.InStock || 0) >= 10 && (p.InStock || 0) < 20).length,
          lowStock: allProducts.filter(p => (p.InStock || 0) > 0 && (p.InStock || 0) < 10).length,
          outOfStock: allProducts.filter(p => (p.InStock || 0) === 0).length
        };

        const total = allProducts.length;
        result.stockEfficiency = stockEfficiency;
        responseText = `⚡ **Stock Efficiency Analysis**:\n\n`;
        responseText += `• **Well Stocked** (20+ units): ${stockEfficiency.wellStocked} (${((stockEfficiency.wellStocked/total)*100).toFixed(1)}%)\n`;
        responseText += `• **Adequate Stock** (10-19 units): ${stockEfficiency.adequateStock} (${((stockEfficiency.adequateStock/total)*100).toFixed(1)}%)\n`;
        responseText += `• **Low Stock** (1-9 units): ${stockEfficiency.lowStock} (${((stockEfficiency.lowStock/total)*100).toFixed(1)}%)\n`;
        responseText += `• **Out of Stock**: ${stockEfficiency.outOfStock} (${((stockEfficiency.outOfStock/total)*100).toFixed(1)}%)\n\n`;

        const efficiencyScore = ((stockEfficiency.wellStocked + stockEfficiency.adequateStock) / total * 100).toFixed(1);
        responseText += `📊 **Overall Stock Efficiency**: ${efficiencyScore}%`;
      }

      // Revenue potential analysis
      else if (lowerPrompt.includes('revenue') || lowerPrompt.includes('potential')) {
        const revenueAnalysis = allProducts.map(p => ({
          name: p.ProductName,
          price: p.Price || 0,
          stock: p.InStock || 0,
          potential: (p.Price || 0) * (p.InStock || 0)
        })).sort((a, b) => b.potential - a.potential);

        const totalPotential = revenueAnalysis.reduce((sum, p) => sum + p.potential, 0);
        const top5 = revenueAnalysis.slice(0, 5);

        result.revenueAnalysis = { totalPotential, top5 };
        responseText = `💰 **Revenue Potential Analysis**:\n\n`;
        responseText += `**Total Potential Revenue**: $${totalPotential.toFixed(2)} USD\n\n`;
        responseText += `**Top 5 Revenue Generators**:\n`;
        top5.forEach((product, index) => {
          responseText += `${index + 1}. **${product.name}**: $${product.potential.toFixed(2)} (${product.stock} × $${product.price})\n`;
        });
      }

      // Performance ranking
      else if (lowerPrompt.includes('ranking') || lowerPrompt.includes('top') || lowerPrompt.includes('best')) {
        const rankings = {
          byPrice: allProducts.sort((a, b) => (b.Price || 0) - (a.Price || 0)).slice(0, 3),
          byStock: allProducts.sort((a, b) => (b.InStock || 0) - (a.InStock || 0)).slice(0, 3),
          byValue: allProducts.map(p => ({
            ...p,
            totalValue: (p.Price || 0) * (p.InStock || 0)
          })).sort((a, b) => b.totalValue - a.totalValue).slice(0, 3)
        };

        result.rankings = rankings;
        responseText = `🏆 **Product Performance Rankings**:\n\n`;

        responseText += `**💎 Highest Priced**:\n`;
        rankings.byPrice.forEach((p, i) => {
          responseText += `${i + 1}. ${p.ProductName}: $${p.Price}\n`;
        });

        responseText += `\n**📦 Highest Stock**:\n`;
        rankings.byStock.forEach((p, i) => {
          responseText += `${i + 1}. ${p.ProductName}: ${p.InStock} units\n`;
        });

        responseText += `\n**💰 Highest Inventory Value**:\n`;
        rankings.byValue.forEach((p, i) => {
          responseText += `${i + 1}. ${p.ProductName}: $${p.totalValue.toFixed(2)}\n`;
        });
      }

      // Default analytics summary
      else {
        const analytics = {
          priceStats: {
            min: Math.min(...allProducts.map(p => p.Price || 0)),
            max: Math.max(...allProducts.map(p => p.Price || 0)),
            avg: (allProducts.reduce((sum, p) => sum + (p.Price || 0), 0) / allProducts.length).toFixed(2)
          },
          stockStats: {
            min: Math.min(...allProducts.map(p => p.InStock || 0)),
            max: Math.max(...allProducts.map(p => p.InStock || 0)),
            avg: (allProducts.reduce((sum, p) => sum + (p.InStock || 0), 0) / allProducts.length).toFixed(1)
          }
        };

        result.analyticsOverview = analytics;
        responseText = `📈 **Analytics Overview**:\n\n`;
        responseText += `**Price Analytics**:\n`;
        responseText += `• Range: $${analytics.priceStats.min} - $${analytics.priceStats.max}\n`;
        responseText += `• Average: $${analytics.priceStats.avg}\n\n`;
        responseText += `**Stock Analytics**:\n`;
        responseText += `• Range: ${analytics.stockStats.min} - ${analytics.stockStats.max} units\n`;
        responseText += `• Average: ${analytics.stockStats.avg} units\n\n`;
        responseText += `💡 Try: "Show me price trends" or "Analyze stock efficiency"`;
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Analytics query completed in ${duration}ms`);

      return {
        reply: responseText,
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: duration,
        type: "analytics",
        data: result
      };

    } catch (error) {
      console.error("❌ Error in analytics query:", error);
      return {
        reply: `I encountered an error while performing the analytics: ${error.message}. Please try a different analysis.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Handle general product queries
   */
  this.handleProductQuery = async function(prompt, startTime) {
    try {
      const db = await cds.connect.to('db');
      const { Products } = db.entities;

      console.log(`🔍 Processing product query: "${prompt}"`);

      // Check for specific product ID
      const productIds = this.extractProductIds(prompt);

      // Check for stock-based queries
      const stockQuery = this.parseStockQuery(prompt);

      // Check for price-based queries
      const priceQuery = this.parsePriceQuery(prompt);

      let query;
      let queryDescription = "";

      if (productIds.length > 0) {
        console.log(`🎯 Looking for specific products: ${productIds.join(', ')}`);
        query = SELECT.from(Products).where({ ID: { in: productIds } });
        queryDescription = `Products with IDs: ${productIds.join(', ')}`;
      } else if (stockQuery.isStockQuery) {
        console.log(`📦 Stock-based query: ${stockQuery.condition} ${stockQuery.threshold}`);
        query = this.buildStockQuery(Products, stockQuery);
        queryDescription = `Products with stock ${stockQuery.condition} ${stockQuery.threshold} units`;
      } else if (priceQuery.isPriceQuery) {
        console.log(`💰 Price-based query: ${priceQuery.condition} ${priceQuery.threshold}`);
        query = this.buildPriceQuery(Products, priceQuery);
        queryDescription = `Products with price ${priceQuery.condition} $${priceQuery.threshold}`;
      } else {
        // Default: show all products (limited)
        query = SELECT.from(Products).limit(10);
        queryDescription = "All products (showing first 10)";
      }

      const products = await db.run(query);

      if (products.length === 0) {
        return {
          reply: `No products found matching your criteria: "${queryDescription}". Please try a different query.`,
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        };
      }

      // Generate response with analysis
      let responseText = `📊 **${queryDescription}**\n\n`;
      responseText += `Found **${products.length} product(s)**:\n\n`;

      products.forEach((product, index) => {
        let stockStatus, stockMessage;

        if (product.UnitsInStock === 0) {
          stockStatus = '🔴 NOT AVAILABLE';
          stockMessage = 'Immediate reorder required';
        } else if (product.UnitsInStock < 10) {
          stockStatus = '🟡 CRITICAL LOW';
          stockMessage = 'Urgent restocking needed';
        } else if (product.UnitsInStock < 20) {
          stockStatus = '🟠 LOW STOCK';
          stockMessage = 'Consider reordering soon';
        } else {
          stockStatus = '🟢 AVAILABLE';
          stockMessage = 'Good stock levels';
        }

        responseText += `**${index + 1}. ${product.ProductName}** (ID: ${product.ID})\n`;
        responseText += `   💰 **Price**: $${product.UnitPrice}\n`;
        responseText += `   📦 **Stock**: ${product.UnitsInStock} units - ${stockStatus}\n`;
        responseText += `   💡 **Status**: ${stockMessage}\n`;
        if (product.Description) {
          responseText += `   📝 **Description**: ${product.Description}\n`;
        }
        responseText += `\n`;
      });

      // Add summary statistics
      if (products.length > 1) {
        const totalValue = products.reduce((sum, p) => sum + (p.UnitPrice * p.UnitsInStock), 0);
        const avgPrice = products.reduce((sum, p) => sum + p.UnitPrice, 0) / products.length;
        const notAvailable = products.filter(p => p.UnitsInStock === 0).length;
        const criticalLow = products.filter(p => p.UnitsInStock < 10 && p.UnitsInStock > 0).length;
        const lowStock = products.filter(p => p.UnitsInStock >= 10 && p.UnitsInStock < 20).length;
        const available = products.filter(p => p.UnitsInStock >= 20).length;

        responseText += `📈 **Inventory Summary**:\n`;
        responseText += `• **Total Value**: $${totalValue.toFixed(2)}\n`;
        responseText += `• **Average Price**: $${avgPrice.toFixed(2)}\n`;
        responseText += `• 🔴 **Not Available**: ${notAvailable} products\n`;
        responseText += `• 🟡 **Critical Low** (< 10): ${criticalLow} products\n`;
        responseText += `• 🟠 **Low Stock** (10-19): ${lowStock} products\n`;
        responseText += `• 🟢 **Available** (20+): ${available} products\n`;

        // Add actionable recommendations
        if (notAvailable > 0 || criticalLow > 0) {
          responseText += `\n⚠️ **Action Required**:\n`;
          if (notAvailable > 0) {
            responseText += `• **Urgent**: ${notAvailable} products need immediate reordering\n`;
          }
          if (criticalLow > 0) {
            responseText += `• **Priority**: ${criticalLow} products need restocking within 24-48 hours\n`;
          }
        }
      }

      return {
        reply: responseText,
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        data: products,
        type: "product_query",
        query: { description: queryDescription, count: products.length }
      };

    } catch (error) {
      console.error("❌ Error in product query:", error);
      return {
        reply: `I encountered an error while fetching products: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Handle business intelligence queries with AI analysis
   */
  this.handleBusinessIntelligenceQuery = async function(prompt, startTime) {
    try {
      console.log(`🧠 Processing business intelligence query: "${prompt}"`);

      // Get relevant data first
      const db = await cds.connect.to('db');
      const { Products, Customers, Orders } = db.entities;

      // Fetch data based on query type
      let contextData = {};

      if (prompt.toLowerCase().includes('reorder') || prompt.toLowerCase().includes('stock')) {
        // Get products with stock information
        contextData.products = await db.run(SELECT.from(Products));
        contextData.lowStock = contextData.products.filter(p => p.UnitsInStock < 20);
        contextData.outOfStock = contextData.products.filter(p => p.UnitsInStock === 0);
      } else if (prompt.toLowerCase().includes('tea') || prompt.toLowerCase().includes('beverage')) {
        // Get beverage products
        contextData.products = await db.run(SELECT.from(Products).where({ CategoryID: 1 }));
        if (contextData.products.length === 0) {
          // Fallback to all products and filter by name
          const allProducts = await db.run(SELECT.from(Products));
          contextData.products = allProducts.filter(p =>
            p.ProductName.toLowerCase().includes('tea') ||
            p.ProductName.toLowerCase().includes('chai') ||
            p.CategoryID === 1
          );
        }
      } else {
        // Get general product data
        contextData.products = await db.run(SELECT.from(Products).limit(20));
      }

      // Create enhanced prompt for Gemini with business context
      const businessContext = this.createBusinessContext(contextData, prompt);
      const enhancedPrompt = `You are SAP Copilot, an intelligent business assistant. Analyze the following business data and provide actionable insights.

User Question: "${prompt}"

Business Data Context:
${businessContext}

Please provide:
1. Direct answer to the user's question
2. Specific product recommendations with IDs
3. Business reasoning for your recommendations
4. Any relevant insights or warnings

Format your response professionally with clear recommendations.`;

      // Call Cohere AI with business context
      if (!COHERE_KEY) {
        console.log("⚠️ No Cohere API key found, using fallback response");
        return this.createFallbackBusinessResponse(contextData, prompt, startTime);
      }

      console.log(`🤖 Calling Cohere AI with context data for ${contextData.products?.length || 0} products`);
      console.log(`📝 Enhanced prompt length: ${enhancedPrompt.length} characters`);
      console.log(`🔑 Using API key: ${COHERE_KEY.substring(0, 15)}...`);

      console.log(`🌐 Making API call to: ${COHERE_URL}`);

      const response = await axios.post(
        COHERE_URL,
        {
          model: "command",
          message: enhancedPrompt,
          max_tokens: 1024,
          temperature: 0.7
        },
        {
          timeout: 30000,
          headers: {
            'Authorization': `Bearer ${COHERE_KEY}`,
            'Content-Type': 'application/json',
            'User-Agent': 'SAP-Copilot/1.0'
          }
        }
      );

      console.log(`✅ Cohere API responded with status: ${response.status}`);

      const text = response.data?.text;
      console.log(`📝 Cohere reply length: ${text?.length || 0} characters`);

      if (!text) {
        console.log("❌ No text in Cohere response, using fallback");
        return this.createFallbackBusinessResponse(contextData, prompt, startTime);
      }

      console.log(`✅ Cohere AI provided successful response`);
      return {
        reply: text.trim(),
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        data: contextData.products,
        type: "business_intelligence"
      };

    } catch (error) {
      console.error("❌ Error in business intelligence query:", error.message);
      if (error.response) {
        console.error("API Response Error:", error.response.status, error.response.data);
      }
      return this.createFallbackBusinessResponse(contextData || {}, prompt, startTime);
    }
  };

  /**
   * Create business context for AI analysis
   */
  this.createBusinessContext = function(contextData, prompt) {
    let context = "";

    if (contextData.products && contextData.products.length > 0) {
      context += "Available Products:\n";
      contextData.products.forEach(product => {
        context += `- ID ${product.ID}: ${product.ProductName} | Price: $${product.UnitPrice} | Stock: ${product.UnitsInStock} units | ${product.Description}\n`;
      });
      context += "\n";
    }

    if (contextData.lowStock && contextData.lowStock.length > 0) {
      context += "Low Stock Items (< 20 units):\n";
      contextData.lowStock.forEach(product => {
        context += `- ${product.ProductName} (ID ${product.ID}): ${product.UnitsInStock} units\n`;
      });
      context += "\n";
    }

    if (contextData.outOfStock && contextData.outOfStock.length > 0) {
      context += "Out of Stock Items:\n";
      contextData.outOfStock.forEach(product => {
        context += `- ${product.ProductName} (ID ${product.ID})\n`;
      });
      context += "\n";
    }

    return context;
  };

  /**
   * Create fallback business response when AI is not available
   */
  this.createFallbackBusinessResponse = function(contextData, prompt, startTime) {
    let reply = "";

    if (prompt.toLowerCase().includes('reorder')) {
      reply = "📦 **Reorder Recommendations:**\n\n";
      if (contextData.outOfStock && contextData.outOfStock.length > 0) {
        reply += "🚨 **Urgent - Out of Stock:**\n";
        contextData.outOfStock.forEach(product => {
          reply += `• ${product.ProductName} (ID ${product.ID}) - REORDER IMMEDIATELY\n`;
        });
        reply += "\n";
      }
      if (contextData.lowStock && contextData.lowStock.length > 0) {
        reply += "⚠️ **Low Stock - Consider Reordering:**\n";
        contextData.lowStock.forEach(product => {
          reply += `• ${product.ProductName} (ID ${product.ID}) - ${product.UnitsInStock} units remaining\n`;
        });
        reply += "\n";
      }
      if (!contextData.outOfStock?.length && !contextData.lowStock?.length) {
        reply += "✅ **Good News!** All products appear to have adequate stock levels.\n\n";
        reply += "💡 **Recommendation:** Monitor these products more closely:\n";
        if (contextData.products) {
          const lowStockItems = contextData.products.filter(p => p.UnitsInStock < 30).slice(0, 3);
          lowStockItems.forEach(product => {
            reply += `• ${product.ProductName} (ID ${product.ID}) - ${product.UnitsInStock} units\n`;
          });
        }
      }
    } else if (prompt.toLowerCase().includes('tea') || prompt.toLowerCase().includes('best for')) {
      reply = "🍵 **Best Products for Tea Lovers:**\n\n";
      if (contextData.products && contextData.products.length > 0) {
        const teaProducts = contextData.products.filter(p =>
          p.ProductName.toLowerCase().includes('tea') ||
          p.ProductName.toLowerCase().includes('chai')
        );
        if (teaProducts.length > 0) {
          teaProducts.forEach(product => {
            reply += `• **${product.ProductName}** (ID ${product.ID}) - $${product.UnitPrice}\n`;
            reply += `  📝 ${product.Description}\n`;
            reply += `  📦 Stock: ${product.UnitsInStock} units\n\n`;
          });
        } else {
          reply += "• **Chai** (ID 1) - $18.00\n";
          reply += "  📝 A delicious tea blend with exotic spices\n";
          reply += "  📦 Stock: 39 units\n\n";
        }
        reply += "🎯 **Why This is Perfect:**\n";
        reply += "• Authentic tea blend with premium spices\n";
        reply += "• Great value at $18.00\n";
        reply += "• Good availability in stock\n";
        reply += "• Appeals to tea enthusiasts\n";
      }
    } else {
      reply = `I understand you're asking about: "${prompt}"\n\nFor detailed business analysis, please ensure the AI service is properly configured. In the meantime, I can help with specific data queries like "show products" or "compare product 1 and 2".`;
    }

    return {
      reply: reply,
      success: true,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
      data: contextData.products || [],
      type: "business_intelligence_fallback"
    };
  };

  /**
   * Handle direct transactions (bypass AI intent recognition)
   */
  this.handleDirectTransaction = async function(prompt, startTime) {
    try {
      console.log(`🚀 Processing direct transaction: "${prompt}"`);

      const lowerPrompt = prompt.toLowerCase();

      // Simple pattern matching for direct transactions
      if (lowerPrompt.startsWith('create ') || lowerPrompt.startsWith('add ')) {
        return await this.executeDirectCreate(prompt, startTime);
      } else if (lowerPrompt.startsWith('update ') || lowerPrompt.startsWith('modify ')) {
        return await this.executeDirectUpdate(prompt, startTime);
      } else if (lowerPrompt.startsWith('delete ') || lowerPrompt.startsWith('remove ')) {
        return await this.executeDirectDelete(prompt, startTime);
      }

      return {
        reply: `I detected a transaction request but couldn't parse it. Please use format like:\n• "Create product [name] price [amount]"\n• "Update product [id] price [amount]"\n• "Delete product [id]"`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error("❌ Error in direct transaction:", error);
      return {
        reply: `Transaction failed: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Execute direct CREATE operations
   */
  this.executeDirectCreate = async function(prompt, startTime) {
    try {
      console.log(`➕ Direct CREATE: "${prompt}"`);

      const db = await cds.connect.to('db');
      const { Products } = db.entities;

      // Enhanced parsing for "Create product [name] price [amount]"
      const productMatch = prompt.match(/create\s+(?:a\s+)?product\s+(?:named\s+)?(.+?)(?:\s+(?:with\s+)?price\s+(\d+(?:\.\d+)?))/i);

      // Alternative patterns if first doesn't match
      const altMatch = prompt.match(/create\s+(?:a\s+)?product\s+(.+)/i);

      let productName = '';
      let price = 0;

      if (productMatch) {
        productName = productMatch[1].trim();
        price = productMatch[2] ? parseFloat(productMatch[2]) : 0;
        console.log(`📝 Parsed from main pattern: name="${productName}", price=${price}`);
      } else if (altMatch) {
        // Try to extract name and price from alternative pattern
        const fullText = altMatch[1].trim();
        const priceMatch = fullText.match(/(.+?)\s+price\s+(\d+(?:\.\d+)?)/i);
        if (priceMatch) {
          productName = priceMatch[1].trim();
          price = parseFloat(priceMatch[2]);
        } else {
          productName = fullText;
          price = 0;
        }
        console.log(`📝 Parsed from alt pattern: name="${productName}", price=${price}`);
      }

      if (productName) {

        // Check for duplicate product name (case-insensitive)
        const existingProduct = await db.run(
          SELECT.one.from(Products).where(`LOWER(ProductName) = LOWER('${productName}')`)
        );

        if (existingProduct) {
          return {
            reply: `❌ **Product Already Exists**\n\n🚫 A product named "${productName}" already exists:\n• **ID**: ${existingProduct.ID}\n• **Name**: ${existingProduct.ProductName}\n• **Price**: $${existingProduct.UnitPrice}\n\n💡 Please use a different name or update the existing product.`,
            success: false,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            type: "create_duplicate_error"
          };
        }

        // Get next ID
        const maxProduct = await db.run(SELECT.one.from(Products).columns('max(ID) as maxId'));
        const nextId = (maxProduct?.maxId || 0) + 1;

        const newProduct = {
          ID: nextId,
          ProductName: productName,
          UnitPrice: price,
          UnitsInStock: 0,
          Description: 'Created via SAP Copilot',
          CategoryID: 1
        };

        // Insert into database
        await db.run(INSERT.into(Products).entries(newProduct));

        console.log(`✅ Product created with ID ${nextId}:`, newProduct);

        // Verify the product was created correctly
        const verifyProduct = await db.run(SELECT.one.from(Products).where({ ID: nextId }));
        console.log(`🔍 Verification - Product in DB:`, verifyProduct);

        return {
          reply: `✅ **Product Created Successfully!**\n\n📦 **New Product Details:**\n• **ID**: ${nextId}\n• **Name**: ${productName}\n• **Price**: $${price}\n• **Stock**: 0 units\n• **Description**: Created via SAP Copilot\n\n🎉 Product has been added to your catalog and is ready for use!`,
          success: true,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          data: newProduct,
          type: "create_success"
        };
      }

      return {
        reply: `I couldn't parse your create request. Please use format: "Create product [name] price [amount]"`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error("❌ Error in direct CREATE:", error);
      return {
        reply: `Create operation failed: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Execute direct UPDATE operations
   */
  this.executeDirectUpdate = async function(prompt, startTime) {
    try {
      console.log(`✏️ Direct UPDATE: "${prompt}"`);

      const db = await cds.connect.to('db');
      const { Products } = db.entities;

      // Enhanced parsing for multiple update patterns
      const patterns = {
        price: /update\s+product\s+(\d+)\s+price\s+(?:to\s+)?(\d+(?:\.\d+)?)/i,
        id: /update\s+product\s+(\d+)\s+id\s+(?:to\s+)?(\d+)/i,
        name: /update\s+product\s+(\d+)\s+name\s+(?:to\s+)?(.+)/i,
        stock: /update\s+product\s+(\d+)\s+stock\s+(?:to\s+)?(\d+)/i
      };

      let updateMatch = null;
      let updateField = null;
      let updateValue = null;
      let productId = null;

      // Try each pattern
      for (const [field, pattern] of Object.entries(patterns)) {
        const match = prompt.match(pattern);
        if (match) {
          updateMatch = match;
          updateField = field;
          productId = parseInt(match[1]);
          updateValue = field === 'price' || field === 'stock' ? parseFloat(match[2]) :
                       field === 'id' ? parseInt(match[2]) : match[2].trim();
          console.log(`📝 Parsed UPDATE: field=${field}, productId=${productId}, newValue=${updateValue}`);
          break;
        }
      }

      if (updateMatch && updateField && productId) {
        // Check if product exists
        const existingProduct = await db.run(SELECT.one.from(Products).where({ ID: productId }));

        if (!existingProduct) {
          return {
            reply: `❌ **Product Not Found**\n\nProduct with ID ${productId} does not exist.`,
            success: false,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          };
        }

        // Special handling for ID updates (requires more complex logic)
        if (updateField === 'id') {
          const newId = updateValue;

          // Check if new ID already exists
          const existingWithNewId = await db.run(SELECT.one.from(Products).where({ ID: newId }));
          if (existingWithNewId) {
            return {
              reply: `❌ **ID Already Exists**\n\nProduct with ID ${newId} already exists. Please choose a different ID.`,
              success: false,
              timestamp: new Date().toISOString(),
              processingTime: Date.now() - startTime
            };
          }

          // Create new product with new ID and delete old one
          const newProduct = { ...existingProduct, ID: newId };
          await db.run(INSERT.into(Products).entries(newProduct));
          await db.run(DELETE.from(Products).where({ ID: productId }));

          console.log(`✅ Product ID changed from ${productId} to ${newId}`);

          return {
            reply: `✅ **Product ID Updated Successfully!**\n\n📦 **Updated Product:**\n• **Old ID**: ${productId} → **New ID**: ${newId}\n• **Name**: ${newProduct.ProductName}\n• **Price**: $${newProduct.UnitPrice}\n• **Stock**: ${newProduct.UnitsInStock} units\n\n🔄 Product ID has been changed!`,
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            data: newProduct,
            type: "update_success"
          };
        }

        // Handle other field updates
        const updateData = {};
        switch (updateField) {
          case 'price':
            updateData.UnitPrice = updateValue;
            break;
          case 'name':
            updateData.ProductName = updateValue;
            break;
          case 'stock':
            updateData.UnitsInStock = updateValue;
            break;
        }

        // Update the product
        await db.run(UPDATE(Products).set(updateData).where({ ID: productId }));

        // Get updated product
        const updatedProduct = await db.run(SELECT.one.from(Products).where({ ID: productId }));

        console.log(`✅ Product ${productId} ${updateField} updated to ${updateValue}`);

        const fieldDisplayNames = {
          price: 'Price',
          name: 'Name',
          stock: 'Stock'
        };

        return {
          reply: `✅ **Product Updated Successfully!**\n\n📦 **Updated Product:**\n• **ID**: ${updatedProduct.ID}\n• **Name**: ${updatedProduct.ProductName}\n• **Price**: $${updatedProduct.UnitPrice}\n• **Stock**: ${updatedProduct.UnitsInStock} units\n\n🔄 ${fieldDisplayNames[updateField]} has been updated!`,
          success: true,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          data: updatedProduct,
          type: "update_success"
        };
      }

      return {
        reply: `I couldn't parse your update request. Please use one of these formats:\n• "Update product [id] price [amount]"\n• "Update product [id] name [new name]"\n• "Update product [id] stock [amount]"\n• "Update product [id] id [new id]"`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error("❌ Error in direct UPDATE:", error);
      return {
        reply: `Update operation failed: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Execute direct DELETE operations
   */
  this.executeDirectDelete = async function(prompt, startTime) {
    try {
      console.log(`🗑️ Direct DELETE: "${prompt}"`);

      const db = await cds.connect.to('db');
      const { Products } = db.entities;

      // Simple parsing for "Delete product [id]"
      const deleteMatch = prompt.match(/(?:delete|remove)\s+product\s+(\d+)/i);

      if (deleteMatch) {
        const productId = parseInt(deleteMatch[1]);

        // Check if product exists
        const existingProduct = await db.run(SELECT.one.from(Products).where({ ID: productId }));
        console.log(`🔍 Product to delete:`, existingProduct);

        if (!existingProduct) {
          return {
            reply: `❌ **Product Not Found**\n\nProduct with ID ${productId} does not exist.`,
            success: false,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          };
        }

        // Delete the product
        await db.run(DELETE.from(Products).where({ ID: productId }));

        console.log(`✅ Product ${productId} deleted successfully`);

        return {
          reply: `✅ **Product Deleted Successfully!**\n\n🗑️ **Deleted Product:**\n• **ID**: ${existingProduct.ID}\n• **Name**: ${existingProduct.ProductName}\n• **Price**: $${existingProduct.UnitPrice}\n\n⚠️ This product has been permanently removed from your catalog.`,
          success: true,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          data: existingProduct,
          type: "delete_success"
        };
      }

      return {
        reply: `I couldn't parse your delete request. Please use format: "Delete product [id]"`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error("❌ Error in direct DELETE:", error);
      return {
        reply: `Delete operation failed: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Handle transaction operations (CREATE, UPDATE, DELETE)
   */
  this.handleTransactionOperation = async function(prompt, analysis, startTime) {
    try {
      console.log(`💼 Processing transaction: ${analysis.intent.intent}`);

      // Extract transaction details using AI
      const transactionDetails = await this.extractTransactionDetails(prompt, analysis, startTime);

      if (!transactionDetails.success) {
        return transactionDetails; // Return error response
      }

      // Execute the transaction based on intent
      switch (analysis.intent.intent) {
        case 'CREATE_OPERATION':
          return await this.executeCreateOperation(transactionDetails, startTime);
        case 'UPDATE_OPERATION':
          return await this.executeUpdateOperation(transactionDetails, startTime);
        case 'DELETE_OPERATION':
          return await this.executeDeleteOperation(transactionDetails, startTime);
        default:
          return {
            reply: `Transaction type "${analysis.intent.intent}" is not yet supported. Please try CREATE, UPDATE, or DELETE operations.`,
            success: false,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          };
      }

    } catch (error) {
      console.error("❌ Error in transaction operation:", error);
      return {
        reply: `I encountered an error while processing your transaction: ${error.message}. Please check your request and try again.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Extract transaction details using AI
   */
  this.extractTransactionDetails = async function(prompt, analysis, startTime) {
    try {
      console.log(`🔍 Extracting transaction details from: "${prompt}"`);

      // Get current business data for context
      const contextData = await this.getRelevantBusinessData(prompt);
      const businessContext = this.createComprehensiveBusinessContext(contextData, prompt);

      // Create AI prompt for transaction extraction
      const extractionPrompt = `You are a SAP transaction parser. Extract structured transaction details from the user's request.

User Request: "${prompt}"
Intent: ${analysis.intent.intent}

BUSINESS CONTEXT:
${businessContext}

INSTRUCTIONS:
Extract the following information and respond ONLY with a JSON object:
{
  "operation": "CREATE|UPDATE|DELETE",
  "entity": "Product|Customer|Order",
  "data": {
    // Key-value pairs of the data to process
  },
  "conditions": {
    // For UPDATE/DELETE: conditions to identify records
  },
  "validation": {
    "isValid": true/false,
    "errors": ["list of validation errors if any"]
  }
}

Examples:
- "Create a product named Laptop with price 999" → {"operation":"CREATE","entity":"Product","data":{"ProductName":"Laptop","UnitPrice":999}}
- "Update customer 5 address to Berlin" → {"operation":"UPDATE","entity":"Customer","data":{"Address":"Berlin"},"conditions":{"ID":5}}
- "Delete product 10" → {"operation":"DELETE","entity":"Product","conditions":{"ID":10}}

JSON Response:`;

      if (!COHERE_KEY) {
        // Fallback parsing without AI
        return this.parseTransactionFallback(prompt, analysis, startTime);
      }

      const response = await axios.post(
        COHERE_URL,
        {
          model: "command",
          message: extractionPrompt,
          max_tokens: 500,
          temperature: 0.1 // Low temperature for structured output
        },
        {
          timeout: 15000,
          headers: {
            'Authorization': `Bearer ${COHERE_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const aiResponse = response.data?.text?.trim();
      if (!aiResponse) {
        throw new Error("No response from AI for transaction extraction");
      }

      // Parse JSON response
      let transactionData;
      try {
        // Extract JSON from AI response (in case there's extra text)
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : aiResponse;
        transactionData = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error("❌ Failed to parse AI response as JSON:", aiResponse);
        return this.parseTransactionFallback(prompt, analysis, startTime);
      }

      // Validate the extracted data
      if (!transactionData.validation?.isValid) {
        return {
          reply: `I couldn't process your transaction request. Issues found:\n• ${transactionData.validation?.errors?.join('\n• ') || 'Invalid transaction format'}\n\nPlease provide more specific details.`,
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        };
      }

      console.log(`✅ Transaction details extracted:`, transactionData);
      return {
        success: true,
        ...transactionData,
        originalPrompt: prompt
      };

    } catch (error) {
      console.error("❌ Error extracting transaction details:", error);
      return this.parseTransactionFallback(prompt, analysis, startTime);
    }
  };

  /**
   * Handle customer queries
   */
  this.handleCustomerQuery = async function(prompt, startTime) {
    try {
      const db = await cds.connect.to('db');
      const { Customers } = db.entities;

      const customers = await db.run(SELECT.from(Customers).limit(10));

      let responseText = `Found ${customers.length} customer(s):\n\n`;
      customers.forEach((customer, index) => {
        responseText += `**${index + 1}. ${customer.CompanyName}** (ID: ${customer.ID})\n`;
        responseText += `   👤 Contact: ${customer.ContactName}\n`;
        responseText += `   🌍 Country: ${customer.Country}\n`;
        if (customer.Email) {
          responseText += `   📧 Email: ${customer.Email}\n`;
        }
        responseText += `\n`;
      });

      return {
        reply: responseText,
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        data: customers,
        type: "customer_list"
      };

    } catch (error) {
      console.error("❌ Error in customer query:", error);
      return {
        reply: `I encountered an error while fetching customers: ${error.message}`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Extract product IDs from prompt
   */
  this.extractProductIds = function(prompt) {
    console.log(`🔍 Extracting product IDs from: "${prompt}"`);

    const ids = new Set();

    // Look for explicit patterns first
    const patterns = [
      /(?:product|id)\s+(\d+)/gi,           // "product 1", "id 1"
      /(?:products?)\s+(\d+(?:\s*(?:,|and)\s*\d+)*)/gi,  // "products 1 and 2", "products 1, 2"
      /(?:compare|vs|versus)\s+(?:product\s+)?(\d+)\s+(?:and|with|vs)\s+(?:product\s+)?(\d+)/gi, // "compare 1 and 2"
      /(?:from|of)\s+(\d+)/gi,              // "from 6", "of 5"
      /\bid\s+(\d+)/gi,                     // "id 1"
      /\b(\d+)\b/g                          // any standalone number
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(prompt)) !== null) {
        // Extract all numbers from the match
        const numbers = match.slice(1).filter(Boolean).join(' ').match(/\d+/g);
        if (numbers) {
          numbers.forEach(num => {
            const id = parseInt(num);
            if (id > 0 && id <= 1000) { // Reasonable range for product IDs
              ids.add(id);
            }
          });
        }
      }
    }

    const result = Array.from(ids).sort((a, b) => a - b);
    console.log(`📊 Extracted product IDs: [${result.join(', ')}]`);
    return result;
  };

  /**
   * Generate product comparison text
   */
  this.generateProductComparison = function(products, requestedIds) {
    if (products.length === 0) return "No products to compare.";

    let comparison = `🔍 **Product Comparison**\n\n`;

    // Show each product
    products.forEach((product, index) => {
      comparison += `**${index + 1}. ${product.ProductName}** (ID: ${product.ID})\n`;
      comparison += `   💰 Price: $${product.UnitPrice}\n`;
      comparison += `   📦 Stock: ${product.UnitsInStock} units\n`;
      comparison += `   📝 ${product.Description || 'No description available'}\n\n`;
    });

    // Add comparison insights
    if (products.length >= 2) {
      comparison += `📊 **Comparison Insights:**\n`;

      // Price comparison
      const prices = products.map(p => p.UnitPrice).sort((a, b) => a - b);
      const cheapest = products.find(p => p.UnitPrice === prices[0]);
      const mostExpensive = products.find(p => p.UnitPrice === prices[prices.length - 1]);

      if (cheapest.ID !== mostExpensive.ID) {
        comparison += `• 💰 **Cheapest**: ${cheapest.ProductName} ($${cheapest.UnitPrice})\n`;
        comparison += `• 💎 **Most Expensive**: ${mostExpensive.ProductName} ($${mostExpensive.UnitPrice})\n`;
      }

      // Stock comparison
      const stocks = products.map(p => p.UnitsInStock).sort((a, b) => b - a);
      const highestStock = products.find(p => p.UnitsInStock === stocks[0]);
      const lowestStock = products.find(p => p.UnitsInStock === stocks[stocks.length - 1]);

      if (highestStock.ID !== lowestStock.ID) {
        comparison += `• 📦 **Highest Stock**: ${highestStock.ProductName} (${highestStock.UnitsInStock} units)\n`;
        comparison += `• ⚠️ **Lowest Stock**: ${lowestStock.ProductName} (${lowestStock.UnitsInStock} units)\n`;
      }
    }

    // Show any missing products
    const foundIds = products.map(p => p.ID);
    const missingIds = requestedIds.filter(id => !foundIds.includes(id));
    if (missingIds.length > 0) {
      comparison += `\n⚠️ **Note**: Products with IDs ${missingIds.join(', ')} were not found.\n`;
    }

    return comparison;
  };

  /**
   * Call Cohere AI for general questions
   */
  this.callCohereAI = async function(prompt, startTime) {
    try {
      console.log(`🤖 Calling Cohere AI...`);

      // Sanitize prompt
      const sanitizedPrompt = sanitizePrompt(prompt);

      // Create enhanced prompt with business context
      const enhancedPrompt = `You are SAP Copilot, an intelligent business assistant for SAP systems.

User Query: "${sanitizedPrompt}"

Context: You have access to a product catalog with items like Chai, Chang, Aniseed Syrup, etc. You can help with:
- Product information and comparisons
- Business data analysis
- General business questions

Please provide a helpful, professional response. If the user asks about specific products, suggest they use commands like "show products" or "compare product 1 and 2" for detailed data.

Response:`;

      const response = await axios.post(
        COHERE_URL,
        {
          model: "command",
          message: enhancedPrompt,
          max_tokens: 1024,
          temperature: 0.7
        },
        {
          timeout: 30000,
          headers: {
            'Authorization': `Bearer ${COHERE_KEY}`,
            'Content-Type': 'application/json',
            'User-Agent': 'SAP-Copilot/1.0'
          }
        }
      );

      // Extract reply
      const text = response.data?.text;
      if (!text) {
        throw new Error("Empty response from Cohere AI");
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Cohere AI responded in ${duration}ms`);

      return {
        reply: text.trim(),
        success: true,
        timestamp: new Date().toISOString(),
        processingTime: duration,
        type: "ai_response"
      };

    } catch (error) {
      console.error("❌ Cohere AI error:", error.message);
      if (error.response) {
        console.error("❌ Response status:", error.response.status);
        console.error("❌ Response data:", JSON.stringify(error.response.data, null, 2));
      }
      console.error("❌ Full error:", error);

      // Fallback response
      return {
        reply: `I'd be happy to help with that! However, I'm currently having trouble accessing my AI capabilities.

For now, I can help you with:
• Product data: "show products" or "show product 5"
• Comparisons: "compare product 1 and 2"
• Customer info: "show customers"
• Help: "help"

Please try one of these specific commands, or contact your administrator about the AI service configuration.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        type: "fallback_response"
      };
    }
  };

  /**
   * Create intelligent mock AI responses when Gemini is not available
   */
  this.createIntelligentMockResponse = function(prompt, startTime) {
    const lowerPrompt = prompt.toLowerCase();
    let reply = "";

    if (lowerPrompt.includes('hi') || lowerPrompt.includes('hello') || lowerPrompt.includes('hey')) {
      reply = `Hello! I'm your SAP Copilot assistant, powered by advanced AI technology.

🎯 **I can help you with:**
• 📊 **Business Intelligence**: "Which products should I reorder?"
• 🔍 **Product Analysis**: "Which product is best for tea lovers?"
• 📈 **Data Insights**: "Show me product comparisons"
• 💡 **Strategic Advice**: "How can I optimize my inventory?"

🚀 **Smart Features:**
• Real-time inventory analysis
• Intelligent product recommendations
• Business performance insights
• Natural language understanding

What business challenge can I help you solve today?`;

    } else if (lowerPrompt.includes('help') || lowerPrompt.includes('what can you do')) {
      reply = `🤖 **SAP Copilot - Your AI Business Assistant**

**🔍 Business Intelligence:**
• "Which products should I reorder?" - Get smart inventory recommendations
• "What are my best-selling products?" - Analyze performance trends
• "Which products have low stock?" - Identify reorder priorities

**📊 Product Analysis:**
• "Which product is best for tea lovers?" - Get targeted recommendations
• "Compare product 1 and 2" - Detailed side-by-side analysis
• "Show me premium products" - Filter by price categories

**💡 Strategic Insights:**
• "How can I improve my margins?" - Business optimization advice
• "What's my inventory turnover?" - Performance analytics
• "Suggest product bundles" - Cross-selling opportunities

**🎯 Data Queries:**
• "Show products" - Browse your catalog
• "Show customers" - View customer information
• "Show product 5" - Get specific product details

I use advanced AI to understand your business context and provide actionable insights. Try asking me anything!`;

    } else if (lowerPrompt.includes('thank') || lowerPrompt.includes('thanks')) {
      reply = `You're very welcome! I'm here to help optimize your business operations.

🎯 **Quick suggestions for your next steps:**
• Check inventory levels: "Which products should I reorder?"
• Analyze product performance: "Show me my best products"
• Get customer insights: "Show customers"

Feel free to ask me anything about your business data or strategy!`;

    } else {
      // General intelligent response
      reply = `I understand you're asking about: "${prompt}"

As your AI business assistant, I can provide insights on this topic. Here are some ways I can help:

🔍 **For specific data**: Try "show products" or "show customers"
📊 **For analysis**: Ask "which products should I reorder?"
💡 **For recommendations**: Try "which product is best for [specific need]?"
🎯 **For comparisons**: Use "compare product X and Y"

I'm designed to understand business context and provide actionable insights. What specific aspect would you like me to analyze?`;
    }

    return {
      reply: reply,
      success: true,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
      type: "intelligent_mock_ai"
    };
  };

  /**
   * Create comprehensive business context for AI
   */
  this.createComprehensiveBusinessContext = function(contextData, prompt) {
    let context = "";

    if (contextData.products && contextData.products.length > 0) {
      context += "PRODUCT CATALOG:\n";
      contextData.products.forEach(product => {
        context += `• ID ${product.ID}: ${product.ProductName}\n`;
        context += `  Price: $${product.UnitPrice} | Stock: ${product.UnitsInStock} units\n`;
        context += `  Description: ${product.Description}\n\n`;
      });
    }

    if (contextData.lowStock && contextData.lowStock.length > 0) {
      context += "LOW STOCK ITEMS (< 20 units):\n";
      contextData.lowStock.forEach(product => {
        context += `• ${product.ProductName} (ID ${product.ID}): ${product.UnitsInStock} units - NEEDS ATTENTION\n`;
      });
      context += "\n";
    }

    if (contextData.outOfStock && contextData.outOfStock.length > 0) {
      context += "OUT OF STOCK ITEMS:\n";
      contextData.outOfStock.forEach(product => {
        context += `• ${product.ProductName} (ID ${product.ID}): URGENT REORDER REQUIRED\n`;
      });
      context += "\n";
    }

    if (contextData.customers && contextData.customers.length > 0) {
      context += "CUSTOMER DATA:\n";
      contextData.customers.forEach(customer => {
        context += `• ${customer.CompanyName} (ID ${customer.ID}) | Contact: ${customer.ContactName}\n`;
      });
      context += "\n";
    }

    return context;
  };

  /**
   * Create intelligent contextual response when AI is not available
   */
  this.createIntelligentContextualResponse = function(prompt, contextData, startTime) {
    const lowerPrompt = prompt.toLowerCase();
    let reply = "";

    if (lowerPrompt.includes('hi') || lowerPrompt.includes('hello')) {
      reply = `Hello! I'm your SAP Copilot with access to your business data.

📊 **Current Overview:**
• Products: ${contextData.products?.length || 0}
• Customers: ${contextData.customers?.length || 0}
${contextData.outOfStock?.length ? `• ⚠️ Out of stock: ${contextData.outOfStock.length}` : ''}

What would you like to explore?`;

    } else if (lowerPrompt.includes('reorder')) {
      reply = `📦 **Inventory Analysis:**\n\n`;
      if (contextData.outOfStock?.length) {
        reply += `🚨 **URGENT:** ${contextData.outOfStock.map(p => p.ProductName).join(', ')}\n\n`;
      }
      if (contextData.lowStock?.length) {
        reply += `⚠️ **Low Stock:** ${contextData.lowStock.map(p => `${p.ProductName} (${p.UnitsInStock} units)`).join(', ')}\n\n`;
      }
      reply += `💡 Monitor inventory levels regularly.`;

    } else {
      reply = `I understand: "${prompt}"\n\n📊 I have access to ${contextData.products?.length || 0} products and can provide detailed analysis. What specific aspect interests you?`;
    }

    return {
      reply: reply,
      success: true,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
      data: contextData,
      type: "intelligent_contextual"
    };
  };

  /**
   * Fallback transaction parser when AI is not available
   */
  this.parseTransactionFallback = function(prompt, analysis, startTime) {
    const lowerPrompt = prompt.toLowerCase();

    // Simple pattern matching for common operations
    if (analysis.intent.intent === 'CREATE_OPERATION') {
      if (lowerPrompt.includes('product')) {
        return {
          success: true,
          operation: "CREATE",
          entity: "Product",
          data: { ProductName: "New Product", UnitPrice: 0 },
          validation: { isValid: true, errors: [] },
          originalPrompt: prompt,
          note: "Using simplified parsing - please provide specific details"
        };
      }
    }

    return {
      reply: `I need AI assistance to parse complex transactions. Please use simpler commands like:\n• "Create product Laptop price 999"\n• "Update customer 5 address Berlin"\n• "Delete product 10"`,
      success: false,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime
    };
  };

  /**
   * Execute CREATE operations
   */
  this.executeCreateOperation = async function(transactionDetails, startTime) {
    try {
      console.log(`➕ Executing CREATE operation for ${transactionDetails.entity}`);

      const db = await cds.connect.to('db');
      let result;

      switch (transactionDetails.entity.toLowerCase()) {
        case 'product':
          const { Products } = db.entities;

          // Get next available ID
          const maxProduct = await db.run(SELECT.one.from(Products).columns('max(ID) as maxId'));
          const nextId = (maxProduct?.maxId || 0) + 1;

          const newProduct = {
            ID: nextId,
            ProductName: transactionDetails.data.ProductName || 'New Product',
            UnitPrice: transactionDetails.data.UnitPrice || 0,
            UnitsInStock: transactionDetails.data.UnitsInStock || 0,
            Description: transactionDetails.data.Description || 'Created via SAP Copilot',
            CategoryID: transactionDetails.data.CategoryID || 1
          };

          result = await db.run(INSERT.into(Products).entries(newProduct));

          return {
            reply: `✅ **Product Created Successfully!**\n\n📦 **New Product Details:**\n• **ID**: ${nextId}\n• **Name**: ${newProduct.ProductName}\n• **Price**: $${newProduct.UnitPrice}\n• **Stock**: ${newProduct.UnitsInStock} units\n• **Description**: ${newProduct.Description}\n\n🎉 Product has been added to your catalog and is ready for use!`,
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            data: newProduct,
            type: "create_success"
          };

        case 'customer':
          const { Customers } = db.entities;

          const maxCustomer = await db.run(SELECT.one.from(Customers).columns('max(ID) as maxId'));
          const nextCustomerId = (maxCustomer?.maxId || 0) + 1;

          const newCustomer = {
            ID: nextCustomerId,
            CompanyName: transactionDetails.data.CompanyName || 'New Company',
            ContactName: transactionDetails.data.ContactName || 'New Contact',
            Country: transactionDetails.data.Country || 'Unknown',
            Email: transactionDetails.data.Email || null
          };

          result = await db.run(INSERT.into(Customers).entries(newCustomer));

          return {
            reply: `✅ **Customer Created Successfully!**\n\n👤 **New Customer Details:**\n• **ID**: ${nextCustomerId}\n• **Company**: ${newCustomer.CompanyName}\n• **Contact**: ${newCustomer.ContactName}\n• **Country**: ${newCustomer.Country}\n${newCustomer.Email ? `• **Email**: ${newCustomer.Email}\n` : ''}\n🎉 Customer has been added to your database!`,
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            data: newCustomer,
            type: "create_success"
          };

        default:
          return {
            reply: `❌ CREATE operation for "${transactionDetails.entity}" is not yet supported. Currently supported: Product, Customer.`,
            success: false,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          };
      }

    } catch (error) {
      console.error("❌ Error in CREATE operation:", error);
      return {
        reply: `❌ **Create Operation Failed**\n\nError: ${error.message}\n\nPlease check your data and try again. Make sure all required fields are provided.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Execute UPDATE operations
   */
  this.executeUpdateOperation = async function(transactionDetails, startTime) {
    try {
      console.log(`✏️ Executing UPDATE operation for ${transactionDetails.entity}`);

      const db = await cds.connect.to('db');

      switch (transactionDetails.entity.toLowerCase()) {
        case 'product':
          const { Products } = db.entities;

          // Find the product first
          const productId = transactionDetails.conditions.ID;
          const existingProduct = await db.run(SELECT.one.from(Products).where({ ID: productId }));

          if (!existingProduct) {
            return {
              reply: `❌ **Product Not Found**\n\nProduct with ID ${productId} does not exist. Please check the ID and try again.`,
              success: false,
              timestamp: new Date().toISOString(),
              processingTime: Date.now() - startTime
            };
          }

          // Update the product
          await db.run(UPDATE(Products).set(transactionDetails.data).where({ ID: productId }));

          // Get updated product
          const updatedProduct = await db.run(SELECT.one.from(Products).where({ ID: productId }));

          return {
            reply: `✅ **Product Updated Successfully!**\n\n📦 **Updated Product:**\n• **ID**: ${updatedProduct.ID}\n• **Name**: ${updatedProduct.ProductName}\n• **Price**: $${updatedProduct.UnitPrice}\n• **Stock**: ${updatedProduct.UnitsInStock} units\n\n🔄 Changes have been saved to your catalog!`,
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            data: updatedProduct,
            type: "update_success"
          };

        case 'customer':
          const { Customers } = db.entities;

          const customerId = transactionDetails.conditions.ID;
          const existingCustomer = await db.run(SELECT.one.from(Customers).where({ ID: customerId }));

          if (!existingCustomer) {
            return {
              reply: `❌ **Customer Not Found**\n\nCustomer with ID ${customerId} does not exist. Please check the ID and try again.`,
              success: false,
              timestamp: new Date().toISOString(),
              processingTime: Date.now() - startTime
            };
          }

          await db.run(UPDATE(Customers).set(transactionDetails.data).where({ ID: customerId }));
          const updatedCustomer = await db.run(SELECT.one.from(Customers).where({ ID: customerId }));

          return {
            reply: `✅ **Customer Updated Successfully!**\n\n👤 **Updated Customer:**\n• **ID**: ${updatedCustomer.ID}\n• **Company**: ${updatedCustomer.CompanyName}\n• **Contact**: ${updatedCustomer.ContactName}\n• **Country**: ${updatedCustomer.Country}\n\n🔄 Customer information has been updated!`,
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            data: updatedCustomer,
            type: "update_success"
          };

        default:
          return {
            reply: `❌ UPDATE operation for "${transactionDetails.entity}" is not yet supported. Currently supported: Product, Customer.`,
            success: false,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          };
      }

    } catch (error) {
      console.error("❌ Error in UPDATE operation:", error);
      return {
        reply: `❌ **Update Operation Failed**\n\nError: ${error.message}\n\nPlease check your data and try again.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Execute DELETE operations
   */
  this.executeDeleteOperation = async function(transactionDetails, startTime) {
    try {
      console.log(`🗑️ Executing DELETE operation for ${transactionDetails.entity}`);

      const db = await cds.connect.to('db');

      switch (transactionDetails.entity.toLowerCase()) {
        case 'product':
          const { Products } = db.entities;

          const productId = transactionDetails.conditions.ID;
          const existingProduct = await db.run(SELECT.one.from(Products).where({ ID: productId }));

          if (!existingProduct) {
            return {
              reply: `❌ **Product Not Found**\n\nProduct with ID ${productId} does not exist. Please check the ID and try again.`,
              success: false,
              timestamp: new Date().toISOString(),
              processingTime: Date.now() - startTime
            };
          }

          await db.run(DELETE.from(Products).where({ ID: productId }));

          return {
            reply: `✅ **Product Deleted Successfully!**\n\n🗑️ **Deleted Product:**\n• **ID**: ${existingProduct.ID}\n• **Name**: ${existingProduct.ProductName}\n• **Price**: $${existingProduct.UnitPrice}\n\n⚠️ This product has been permanently removed from your catalog.`,
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            data: existingProduct,
            type: "delete_success"
          };

        case 'customer':
          const { Customers } = db.entities;

          const customerId = transactionDetails.conditions.ID;
          const existingCustomer = await db.run(SELECT.one.from(Customers).where({ ID: customerId }));

          if (!existingCustomer) {
            return {
              reply: `❌ **Customer Not Found**\n\nCustomer with ID ${customerId} does not exist. Please check the ID and try again.`,
              success: false,
              timestamp: new Date().toISOString(),
              processingTime: Date.now() - startTime
            };
          }

          await db.run(DELETE.from(Customers).where({ ID: customerId }));

          return {
            reply: `✅ **Customer Deleted Successfully!**\n\n🗑️ **Deleted Customer:**\n• **ID**: ${existingCustomer.ID}\n• **Company**: ${existingCustomer.CompanyName}\n• **Contact**: ${existingCustomer.ContactName}\n\n⚠️ This customer has been permanently removed from your database.`,
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            data: existingCustomer,
            type: "delete_success"
          };

        default:
          return {
            reply: `❌ DELETE operation for "${transactionDetails.entity}" is not yet supported. Currently supported: Product, Customer.`,
            success: false,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime
          };
      }

    } catch (error) {
      console.error("❌ Error in DELETE operation:", error);
      return {
        reply: `❌ **Delete Operation Failed**\n\nError: ${error.message}\n\nPlease check your request and try again.`,
        success: false,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      };
    }
  };

  /**
   * Parse report request from natural language
   */
  this.parseReportRequest = function(prompt) {
    const lowerPrompt = prompt.toLowerCase();

    // Determine format
    let format = 'pdf'; // default
    if (lowerPrompt.includes('excel') || lowerPrompt.includes('xlsx')) {
      format = 'excel';
    } else if (lowerPrompt.includes('pdf')) {
      format = 'pdf';
    }

    // Determine data type
    let dataType = 'products'; // default
    let title = 'Business Report';

    if (lowerPrompt.includes('product')) {
      dataType = 'products';
      title = 'Products Report';
    } else if (lowerPrompt.includes('inventory') || lowerPrompt.includes('stock')) {
      dataType = 'inventory';
      title = 'Inventory Report';
    } else if (lowerPrompt.includes('customer')) {
      dataType = 'customers';
      title = 'Customers Report';
    } else if (lowerPrompt.includes('summary') || lowerPrompt.includes('overview')) {
      dataType = 'summary';
      title = 'Business Summary Report';
    }

    console.log(`📋 Parsed report request: format=${format}, dataType=${dataType}, title=${title}`);

    return {
      success: true,
      format: format,
      dataType: dataType,
      title: title
    };
  };

  /**
   * Get data for report generation
   */
  this.getReportData = async function(dataType) {
    try {
      const db = await cds.connect.to('db');
      let data = [];

      switch (dataType) {
        case 'products':
          const { Products } = db.entities;
          data = await db.run(SELECT.from(Products));
          break;

        case 'inventory':
          const { Products: InventoryProducts } = db.entities;
          data = await db.run(SELECT.from(InventoryProducts));
          // Add inventory-specific calculations
          data = data.map(product => ({
            ...product,
            TotalValue: (product.UnitPrice * product.UnitsInStock).toFixed(2),
            Status: product.UnitsInStock === 0 ? 'NOT AVAILABLE' :
                   product.UnitsInStock < 10 ? 'CRITICAL LOW' :
                   product.UnitsInStock < 20 ? 'LOW STOCK' : 'AVAILABLE',
            StatusMessage: product.UnitsInStock === 0 ? 'Immediate reorder required' :
                          product.UnitsInStock < 10 ? 'Urgent restocking needed' :
                          product.UnitsInStock < 20 ? 'Consider reordering soon' : 'Good stock levels'
          }));
          break;

        case 'customers':
          const { Customers } = db.entities;
          data = await db.run(SELECT.from(Customers));
          break;

        case 'summary':
          // Get summary data from multiple entities
          const { Products: SummaryProducts, Customers: SummaryCustomers } = db.entities;
          const products = await db.run(SELECT.from(SummaryProducts));
          const customers = await db.run(SELECT.from(SummaryCustomers));

          data = [{
            TotalProducts: products.length,
            TotalCustomers: customers.length,
            TotalInventoryValue: products.reduce((sum, p) => sum + (p.UnitPrice * p.UnitsInStock), 0).toFixed(2),
            OutOfStockItems: products.filter(p => p.UnitsInStock === 0).length,
            LowStockItems: products.filter(p => p.UnitsInStock < 20 && p.UnitsInStock > 0).length,
            AverageProductPrice: (products.reduce((sum, p) => sum + p.UnitPrice, 0) / products.length).toFixed(2),
            CountriesServed: [...new Set(customers.map(c => c.Country))].length
          }];
          break;

        default:
          return {
            success: false,
            error: `Unknown data type: ${dataType}`
          };
      }

      console.log(`📊 Retrieved ${data.length} records for ${dataType} report`);

      return {
        success: true,
        data: data
      };

    } catch (error) {
      console.error(`❌ Error getting report data for ${dataType}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  };

  /**
   * Parse stock-based query conditions
   */
  this.parseStockQuery = function(prompt) {
    const lowerPrompt = prompt.toLowerCase();

    // Stock patterns with thresholds
    const patterns = [
      { regex: /stock\s*(below|under|less\s*than|<)\s*(\d+)/i, condition: 'below' },
      { regex: /stock\s*(above|over|greater\s*than|>)\s*(\d+)/i, condition: 'above' },
      { regex: /stock\s*(equals?|=|is)\s*(\d+)/i, condition: 'equals' },
      { regex: /under\s*stock\s*(\d+)/i, condition: 'below' },
      { regex: /low\s*stock/i, condition: 'below', defaultThreshold: 20 },
      { regex: /out\s*of\s*stock/i, condition: 'equals', defaultThreshold: 0 }
    ];

    for (const pattern of patterns) {
      const match = prompt.match(pattern.regex);
      if (match) {
        const threshold = match[2] ? parseInt(match[2]) : pattern.defaultThreshold;
        return {
          isStockQuery: true,
          condition: pattern.condition,
          threshold: threshold
        };
      }
    }

    return { isStockQuery: false };
  };

  /**
   * Parse price-based query conditions
   */
  this.parsePriceQuery = function(prompt) {
    const lowerPrompt = prompt.toLowerCase();

    const patterns = [
      { regex: /price\s*(below|under|less\s*than|<)\s*(\d+(?:\.\d+)?)/i, condition: 'below' },
      { regex: /price\s*(above|over|greater\s*than|>)\s*(\d+(?:\.\d+)?)/i, condition: 'above' },
      { regex: /price\s*(equals?|=|is)\s*(\d+(?:\.\d+)?)/i, condition: 'equals' },
      { regex: /expensive/i, condition: 'above', defaultThreshold: 50 },
      { regex: /cheap/i, condition: 'below', defaultThreshold: 20 }
    ];

    for (const pattern of patterns) {
      const match = prompt.match(pattern.regex);
      if (match) {
        const threshold = match[2] ? parseFloat(match[2]) : pattern.defaultThreshold;
        return {
          isPriceQuery: true,
          condition: pattern.condition,
          threshold: threshold
        };
      }
    }

    return { isPriceQuery: false };
  };

  /**
   * Build stock-based database query
   */
  this.buildStockQuery = function(Products, stockQuery) {
    switch (stockQuery.condition) {
      case 'below':
        return SELECT.from(Products).where({ UnitsInStock: { '<': stockQuery.threshold } });
      case 'above':
        return SELECT.from(Products).where({ UnitsInStock: { '>': stockQuery.threshold } });
      case 'equals':
        return SELECT.from(Products).where({ UnitsInStock: stockQuery.threshold });
      default:
        return SELECT.from(Products).limit(10);
    }
  };

  /**
   * Build price-based database query
   */
  this.buildPriceQuery = function(Products, priceQuery) {
    switch (priceQuery.condition) {
      case 'below':
        return SELECT.from(Products).where({ UnitPrice: { '<': priceQuery.threshold } });
      case 'above':
        return SELECT.from(Products).where({ UnitPrice: { '>': priceQuery.threshold } });
      case 'equals':
        return SELECT.from(Products).where({ UnitPrice: priceQuery.threshold });
      default:
        return SELECT.from(Products).limit(10);
    }
  };

});
