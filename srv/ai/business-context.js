const cds = require("@sap/cds");

/**
 * Business Context Understanding System
 * Resolves business-friendly references to actual data
 */

class BusinessContextResolver {
  
  /**
   * Resolve business-friendly references in user input
   */
  static async resolveContext(userInput, analysis) {
    const resolvedContext = {
      originalInput: userInput,
      resolvedEntities: [],
      suggestions: [],
      ambiguities: []
    };
    
    // Resolve product references
    if (analysis.entities.some(e => e.type === "PRODUCTS")) {
      const productRefs = await this.resolveProductReferences(userInput);
      resolvedContext.resolvedEntities.push(...productRefs);
    }
    
    // Resolve customer references
    if (analysis.entities.some(e => e.type === "CUSTOMERS")) {
      const customerRefs = await this.resolveCustomerReferences(userInput);
      resolvedContext.resolvedEntities.push(...customerRefs);
    }
    
    // Resolve supplier references
    if (analysis.entities.some(e => e.type === "SUPPLIERS")) {
      const supplierRefs = await this.resolveSupplierReferences(userInput);
      resolvedContext.resolvedEntities.push(...supplierRefs);
    }
    
    return resolvedContext;
  }
  
  /**
   * Resolve product references by name, description, or category
   */
  static async resolveProductReferences(input) {
    const db = await cds.connect.to('db');
    const { Products, Categories } = db.entities;
    const resolved = [];
    
    try {
      // Extract potential product names from input
      const productKeywords = this.extractProductKeywords(input);
      
      for (const keyword of productKeywords) {
        // Search by product name (fuzzy matching)
        const productsByName = await db.run(
          SELECT.from(Products).where`ProductName like ${`%${keyword}%`}`
        );
        
        if (productsByName.length > 0) {
          resolved.push({
            type: "PRODUCT_BY_NAME",
            keyword: keyword,
            matches: productsByName,
            confidence: 0.9
          });
        }
        
        // Search by description
        const productsByDesc = await db.run(
          SELECT.from(Products).where`Description like ${`%${keyword}%`}`
        );
        
        if (productsByDesc.length > 0) {
          resolved.push({
            type: "PRODUCT_BY_DESCRIPTION", 
            keyword: keyword,
            matches: productsByDesc,
            confidence: 0.7
          });
        }
      }
      
      // Category-based resolution
      const categoryKeywords = this.extractCategoryKeywords(input);
      for (const categoryKeyword of categoryKeywords) {
        const category = await db.run(
          SELECT.from(Categories).where`CategoryName like ${`%${categoryKeyword}%`}`
        );
        
        if (category.length > 0) {
          const productsInCategory = await db.run(
            SELECT.from(Products).where`CategoryID = ${category[0].ID}`
          );
          
          resolved.push({
            type: "PRODUCTS_BY_CATEGORY",
            keyword: categoryKeyword,
            category: category[0],
            matches: productsInCategory,
            confidence: 0.8
          });
        }
      }
      
    } catch (error) {
      console.error("Error resolving product references:", error);
    }
    
    return resolved;
  }
  
  /**
   * Resolve customer references by company name or contact name
   */
  static async resolveCustomerReferences(input) {
    const db = await cds.connect.to('db');
    const { Customers } = db.entities;
    const resolved = [];
    
    try {
      const customerKeywords = this.extractCustomerKeywords(input);
      
      for (const keyword of customerKeywords) {
        // Search by company name
        const customersByCompany = await db.run(
          SELECT.from(Customers).where`CompanyName like ${`%${keyword}%`}`
        );
        
        if (customersByCompany.length > 0) {
          resolved.push({
            type: "CUSTOMER_BY_COMPANY",
            keyword: keyword,
            matches: customersByCompany,
            confidence: 0.9
          });
        }
        
        // Search by contact name
        const customersByContact = await db.run(
          SELECT.from(Customers).where`ContactName like ${`%${keyword}%`}`
        );
        
        if (customersByContact.length > 0) {
          resolved.push({
            type: "CUSTOMER_BY_CONTACT",
            keyword: keyword,
            matches: customersByContact,
            confidence: 0.8
          });
        }
        
        // Search by country
        const customersByCountry = await db.run(
          SELECT.from(Customers).where`Country like ${`%${keyword}%`}`
        );
        
        if (customersByCountry.length > 0) {
          resolved.push({
            type: "CUSTOMERS_BY_COUNTRY",
            keyword: keyword,
            matches: customersByCountry,
            confidence: 0.7
          });
        }
      }
      
    } catch (error) {
      console.error("Error resolving customer references:", error);
    }
    
    return resolved;
  }
  
  /**
   * Resolve supplier references
   */
  static async resolveSupplierReferences(input) {
    const db = await cds.connect.to('db');
    const { Suppliers } = db.entities;
    const resolved = [];
    
    try {
      const supplierKeywords = this.extractSupplierKeywords(input);
      
      for (const keyword of supplierKeywords) {
        const suppliersByName = await db.run(
          SELECT.from(Suppliers).where`CompanyName like ${`%${keyword}%`}`
        );
        
        if (suppliersByName.length > 0) {
          resolved.push({
            type: "SUPPLIER_BY_NAME",
            keyword: keyword,
            matches: suppliersByName,
            confidence: 0.9
          });
        }
      }
      
    } catch (error) {
      console.error("Error resolving supplier references:", error);
    }
    
    return resolved;
  }
  
  /**
   * Extract potential product keywords from input
   */
  static extractProductKeywords(input) {
    const keywords = [];
    const words = input.toLowerCase().split(/\s+/);
    
    // Common product-related terms
    const productTerms = [
      "chai", "chang", "syrup", "seasoning", "gumbo", "spread", "pears", "sauce",
      "beef", "niku", "ikura", "cheese", "queso", "konbu", "tofu", "soy", "pavlova",
      "mutton", "tigers", "biscuits", "marmalade", "tea", "coffee", "beer", "wine"
    ];
    
    // Look for product terms
    for (const term of productTerms) {
      if (input.toLowerCase().includes(term)) {
        keywords.push(term);
      }
    }
    
    // Look for capitalized words (potential product names)
    const capitalizedWords = input.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (capitalizedWords) {
      keywords.push(...capitalizedWords);
    }
    
    return [...new Set(keywords)]; // Remove duplicates
  }
  
  /**
   * Extract category keywords
   */
  static extractCategoryKeywords(input) {
    const categoryTerms = [
      "beverage", "beverages", "drink", "drinks",
      "condiment", "condiments", "sauce", "sauces", "seasoning",
      "confection", "confections", "dessert", "desserts", "candy", "sweet",
      "dairy", "cheese", "milk",
      "grain", "grains", "cereal", "bread", "pasta",
      "meat", "poultry", "beef", "chicken",
      "produce", "fruit", "vegetable",
      "seafood", "fish", "seaweed"
    ];
    
    return categoryTerms.filter(term => input.toLowerCase().includes(term));
  }
  
  /**
   * Extract customer keywords
   */
  static extractCustomerKeywords(input) {
    const keywords = [];
    
    // Look for company-like names (multiple capitalized words)
    const companyPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
    const companyMatches = input.match(companyPattern);
    if (companyMatches) {
      keywords.push(...companyMatches);
    }
    
    // Look for country names
    const countries = ["germany", "mexico", "uk", "sweden", "france", "spain", "canada"];
    keywords.push(...countries.filter(country => input.toLowerCase().includes(country)));
    
    return keywords;
  }
  
  /**
   * Extract supplier keywords
   */
  static extractSupplierKeywords(input) {
    // Similar to customer keywords but focused on supplier context
    return this.extractCustomerKeywords(input);
  }
  
  /**
   * Generate suggestions based on partial matches
   */
  static generateSuggestions(resolvedContext) {
    const suggestions = [];
    
    for (const entity of resolvedContext.resolvedEntities) {
      if (entity.matches.length > 1) {
        suggestions.push({
          type: "DISAMBIGUATION",
          message: `Did you mean one of these ${entity.type.toLowerCase()}s?`,
          options: entity.matches.slice(0, 5).map(match => ({
            id: match.ID,
            name: match.ProductName || match.CompanyName || match.CategoryName,
            description: match.Description || match.ContactName || ""
          }))
        });
      } else if (entity.matches.length === 0) {
        suggestions.push({
          type: "NO_MATCH",
          message: `No ${entity.type.toLowerCase()} found for "${entity.keyword}". Try a different search term.`,
          alternatives: []
        });
      }
    }
    
    return suggestions;
  }
  
  /**
   * Create enhanced prompt for Gemini with business context
   */
  static createEnhancedPrompt(originalPrompt, resolvedContext, odataQuery) {
    let enhancedPrompt = `Business Query: ${originalPrompt}\n\n`;
    
    enhancedPrompt += "Context Information:\n";
    
    // Add resolved entities
    if (resolvedContext.resolvedEntities.length > 0) {
      enhancedPrompt += "Found References:\n";
      for (const entity of resolvedContext.resolvedEntities) {
        enhancedPrompt += `- ${entity.type}: ${entity.keyword} (${entity.matches.length} matches)\n`;
        if (entity.matches.length > 0 && entity.matches.length <= 3) {
          entity.matches.forEach(match => {
            enhancedPrompt += `  * ${match.ProductName || match.CompanyName || match.CategoryName} (ID: ${match.ID})\n`;
          });
        }
      }
      enhancedPrompt += "\n";
    }
    
    // Add OData query information
    if (odataQuery) {
      enhancedPrompt += `Generated OData Query:\n`;
      enhancedPrompt += `Entity: ${odataQuery.entity}\n`;
      if (odataQuery.filter) enhancedPrompt += `Filter: ${odataQuery.filter}\n`;
      if (odataQuery.orderby) enhancedPrompt += `Order: ${odataQuery.orderby}\n`;
      if (odataQuery.top) enhancedPrompt += `Limit: ${odataQuery.top}\n`;
      enhancedPrompt += "\n";
    }
    
    enhancedPrompt += "Please provide a helpful response based on this business context and execute the appropriate data operations if needed.";
    
    return enhancedPrompt;
  }
}

module.exports = BusinessContextResolver;
