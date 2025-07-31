const cds = require("@sap/cds");

/**
 * Intent Recognition System for SAP Copilot ChatShell
 * Classifies user intents and extracts business entities from natural language
 */

// Intent definitions with keywords and patterns
const INTENTS = {
  DATA_QUERY: {
    keywords: ["show", "list", "find", "get", "display", "view", "search", "what", "which", "how many"],
    patterns: [
      /show\s+(me\s+)?(all\s+)?(\w+)/i,
      /list\s+(all\s+)?(\w+)/i,
      /find\s+(\w+)/i,
      /what\s+(are\s+)?(\w+)/i,
      /how\s+many\s+(\w+)/i
    ],
    confidence: 0.8
  },
  
  CREATE_OPERATION: {
    keywords: ["create", "add", "new", "insert", "make", "place", "order"],
    patterns: [
      /create\s+(a\s+)?(\w+)/i,
      /add\s+(a\s+)?(\w+)/i,
      /new\s+(\w+)/i,
      /place\s+(an?\s+)?order/i,
      /make\s+(a\s+)?(\w+)/i
    ],
    confidence: 0.9
  },
  
  UPDATE_OPERATION: {
    keywords: ["update", "modify", "change", "edit", "set", "adjust"],
    patterns: [
      /update\s+(\w+)/i,
      /modify\s+(\w+)/i,
      /change\s+(\w+)/i,
      /set\s+(\w+)/i
    ],
    confidence: 0.85
  },
  
  DELETE_OPERATION: {
    keywords: ["delete", "remove", "cancel", "drop"],
    patterns: [
      /delete\s+(\w+)/i,
      /remove\s+(\w+)/i,
      /cancel\s+(\w+)/i
    ],
    confidence: 0.9
  },
  
  REPORT_GENERATION: {
    keywords: ["export", "report", "generate", "download", "print", "save"],
    patterns: [
      /export\s+(\w+)/i,
      /generate\s+(a\s+)?report/i,
      /download\s+(\w+)/i,
      /(create|make)\s+(a\s+)?report/i
    ],
    confidence: 0.85
  },

  ALERT_REQUEST: {
    keywords: ["notify", "alert", "warn", "notification", "monitor", "watch", "threshold"],
    patterns: [
      /notify\s+(me\s+)?when/i,
      /alert\s+(me\s+)?if/i,
      /warn\s+(me\s+)?when/i,
      /monitor\s+(\w+)/i,
      /watch\s+for/i,
      /set\s+(up\s+)?alert/i,
      /create\s+(a\s+)?notification/i,
      /threshold\s+for/i
    ],
    confidence: 0.9
  },
  
  HELP_REQUEST: {
    keywords: ["help", "how", "what can", "assist", "support"],
    patterns: [
      /help/i,
      /what\s+can\s+you\s+do/i,
      /how\s+do\s+i/i
    ],
    confidence: 0.9
  }
};

// Business entities and their synonyms
const ENTITIES = {
  PRODUCTS: {
    synonyms: ["product", "products", "item", "items", "goods", "merchandise"],
    table: "Products",
    fields: ["ProductName", "ID", "CategoryID"]
  },
  
  CUSTOMERS: {
    synonyms: ["customer", "customers", "client", "clients", "company", "companies"],
    table: "Customers", 
    fields: ["CompanyName", "ID", "ContactName"]
  },
  
  ORDERS: {
    synonyms: ["order", "orders", "purchase", "purchases", "sale", "sales"],
    table: "Orders",
    fields: ["ID", "OrderDate", "CustomerID"]
  },
  
  CATEGORIES: {
    synonyms: ["category", "categories", "type", "types", "group", "groups"],
    table: "Categories",
    fields: ["CategoryName", "ID"]
  },
  
  SUPPLIERS: {
    synonyms: ["supplier", "suppliers", "vendor", "vendors", "provider", "providers"],
    table: "Suppliers",
    fields: ["CompanyName", "ID", "ContactName"]
  }
};

// Date/time patterns
const DATE_PATTERNS = {
  RELATIVE: {
    "today": () => new Date(),
    "yesterday": () => new Date(Date.now() - 24 * 60 * 60 * 1000),
    "tomorrow": () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    "last week": () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    "last month": () => new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
    "this month": () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    "this year": () => new Date(new Date().getFullYear(), 0, 1),
    "last year": () => new Date(new Date().getFullYear() - 1, 0, 1)
  },
  
  PATTERNS: [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,  // MM/DD/YYYY
    /(\d{4})-(\d{1,2})-(\d{1,2})/,   // YYYY-MM-DD
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i
  ]
};

class IntentRecognizer {
  
  /**
   * Analyze user input and extract intent, entities, and parameters
   */
  static analyzeInput(userInput) {
    const normalizedInput = userInput.toLowerCase().trim();
    
    const result = {
      originalInput: userInput,
      intent: this.classifyIntent(normalizedInput),
      entities: this.extractEntities(normalizedInput),
      parameters: this.extractParameters(normalizedInput),
      confidence: 0,
      timestamp: new Date().toISOString()
    };
    
    // Calculate overall confidence
    result.confidence = this.calculateConfidence(result);
    
    return result;
  }
  
  /**
   * Classify the primary intent of the user input
   */
  static classifyIntent(input) {
    let bestMatch = { intent: "UNKNOWN", confidence: 0 };
    
    for (const [intentName, intentConfig] of Object.entries(INTENTS)) {
      let score = 0;
      let matches = 0;
      
      // Check keyword matches
      for (const keyword of intentConfig.keywords) {
        if (input.includes(keyword)) {
          score += 1;
          matches++;
        }
      }
      
      // Check pattern matches
      for (const pattern of intentConfig.patterns) {
        if (pattern.test(input)) {
          score += 2;
          matches++;
        }
      }
      
      // Calculate confidence
      const confidence = matches > 0 ? (score / (intentConfig.keywords.length + intentConfig.patterns.length)) * intentConfig.confidence : 0;
      
      if (confidence > bestMatch.confidence) {
        bestMatch = { intent: intentName, confidence };
      }
    }
    
    return bestMatch;
  }
  
  /**
   * Extract business entities from the input
   */
  static extractEntities(input) {
    const entities = [];
    
    for (const [entityType, entityConfig] of Object.entries(ENTITIES)) {
      for (const synonym of entityConfig.synonyms) {
        if (input.includes(synonym)) {
          entities.push({
            type: entityType,
            value: synonym,
            table: entityConfig.table,
            fields: entityConfig.fields
          });
        }
      }
    }
    
    return entities;
  }
  
  /**
   * Extract parameters like numbers, dates, names, etc.
   */
  static extractParameters(input) {
    const parameters = {
      numbers: this.extractNumbers(input),
      dates: this.extractDates(input),
      countries: this.extractCountries(input),
      quantities: this.extractQuantities(input),
      names: this.extractNames(input)
    };
    
    return parameters;
  }
  
  /**
   * Extract numeric values
   */
  static extractNumbers(input) {
    const numberPattern = /\b\d+\b/g;
    const matches = input.match(numberPattern);
    return matches ? matches.map(num => parseInt(num)) : [];
  }
  
  /**
   * Extract and parse dates
   */
  static extractDates(input) {
    const dates = [];
    
    // Check relative dates
    for (const [phrase, dateFunc] of Object.entries(DATE_PATTERNS.RELATIVE)) {
      if (input.includes(phrase)) {
        dates.push({
          type: "relative",
          phrase: phrase,
          date: dateFunc(),
          isoString: dateFunc().toISOString()
        });
      }
    }
    
    // Check absolute date patterns
    for (const pattern of DATE_PATTERNS.PATTERNS) {
      const match = input.match(pattern);
      if (match) {
        dates.push({
          type: "absolute",
          match: match[0],
          date: new Date(match[0])
        });
      }
    }
    
    return dates;
  }
  
  /**
   * Extract country names
   */
  static extractCountries(input) {
    const countries = ["germany", "usa", "france", "uk", "spain", "italy", "canada", "mexico", "japan", "australia"];
    return countries.filter(country => input.includes(country));
  }
  
  /**
   * Extract quantities and units
   */
  static extractQuantities(input) {
    const quantityPattern = /(\d+)\s*(units?|pieces?|items?|boxes?|kg|pounds?|liters?)/gi;
    const matches = input.match(quantityPattern);
    return matches || [];
  }
  
  /**
   * Extract potential names (capitalized words)
   */
  static extractNames(input) {
    const namePattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
    const matches = input.match(namePattern);
    return matches || [];
  }
  
  /**
   * Calculate overall confidence score
   */
  static calculateConfidence(result) {
    let confidence = result.intent.confidence;
    
    // Boost confidence if entities are found
    if (result.entities.length > 0) {
      confidence += 0.1 * result.entities.length;
    }
    
    // Boost confidence if parameters are found
    const paramCount = Object.values(result.parameters).flat().length;
    if (paramCount > 0) {
      confidence += 0.05 * paramCount;
    }
    
    return Math.min(confidence, 1.0);
  }
  
  /**
   * Generate a human-readable summary of the analysis
   */
  static generateSummary(analysis) {
    const { intent, entities, parameters } = analysis;
    
    let summary = `Intent: ${intent.intent} (${Math.round(intent.confidence * 100)}% confidence)`;
    
    if (entities.length > 0) {
      summary += `\nEntities: ${entities.map(e => e.type).join(", ")}`;
    }
    
    if (parameters.numbers.length > 0) {
      summary += `\nNumbers: ${parameters.numbers.join(", ")}`;
    }
    
    if (parameters.dates.length > 0) {
      summary += `\nDates: ${parameters.dates.map(d => d.phrase || d.match).join(", ")}`;
    }
    
    return summary;
  }
}

module.exports = IntentRecognizer;
