const cds = require("@sap/cds");
const axios = require("axios");
const IntentRecognizer = require("./ai/intent-recognition");
const ODataParser = require("./ai/odata-parser");
const BusinessContextResolver = require("./ai/business-context");

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

  // Log service initialization
  console.log("🤖 Cohere AI Service initialized");
  if (!COHERE_KEY) {
    console.warn("⚠️  COHERE_API_KEY not configured - AI service will use intelligent fallbacks");
  } else {
    console.log("✅ COHERE_API_KEY found:", COHERE_KEY.substring(0, 10) + "...");
    console.log("🔗 Cohere URL:", COHERE_URL);
  }



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
      } catch (intentError) {
        console.error("❌ Error in intent recognition:", intentError);
        // Fall back to simple Gemini AI response
        return await this.handleGeneralQuery(rawPrompt, null, startTime);
      }

      // Handle ALL queries with AI - provide relevant data as context
      try {
        console.log(`🤖 Processing ALL queries with AI: "${rawPrompt}"`);
        return await this.handleUniversalAIQuery(rawPrompt, analysis, startTime);
      } catch (handlerError) {
        console.error("❌ Error in intent handler:", handlerError);
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
   * Handle ALL queries with AI - Universal AI handler with smart data context
   */
  this.handleUniversalAIQuery = async function(prompt, analysis, startTime) {
    try {
      console.log(`🌟 Universal AI processing: "${prompt}"`);

      // Get relevant business data based on the query
      const contextData = await this.getRelevantBusinessData(prompt);

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
          timeout: 30000,
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
    const productKeywords = ['product', 'products', 'item', 'items', 'show', 'list', 'display'];
    return productKeywords.some(keyword => prompt.toLowerCase().includes(keyword));
  };

  /**
   * Check if query is about customers
   */
  this.isCustomerQuery = function(prompt) {
    const customerKeywords = ['customer', 'customers', 'client', 'clients'];
    return customerKeywords.some(keyword => prompt.toLowerCase().includes(keyword));
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
   * Handle general product queries
   */
  this.handleProductQuery = async function(prompt, startTime) {
    try {
      const db = await cds.connect.to('db');
      const { Products } = db.entities;

      // Check for specific product ID
      const productIds = this.extractProductIds(prompt);
      let query;

      if (productIds.length > 0) {
        console.log(`🔍 Looking for specific products: ${productIds.join(', ')}`);
        query = SELECT.from(Products).where({ ID: { in: productIds } });
      } else {
        query = SELECT.from(Products).limit(10); // Show first 10 products
      }

      const products = await db.run(query);

      if (products.length === 0) {
        return {
          reply: "No products found. Please check your query and try again.",
          success: false,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        };
      }

      let responseText = `Found ${products.length} product(s):\n\n`;
      products.forEach((product, index) => {
        responseText += `**${index + 1}. ${product.ProductName}** (ID: ${product.ID})\n`;
        responseText += `   💰 Price: $${product.UnitPrice}\n`;
        responseText += `   📦 Stock: ${product.UnitsInStock} units\n`;
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
        data: products,
        type: "product_list"
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

});
