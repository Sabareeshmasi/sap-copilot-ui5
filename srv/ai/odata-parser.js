const IntentRecognizer = require('./intent-recognition');

/**
 * Natural Language to OData Query Parser
 * Converts business queries to OData filter syntax
 */

class ODataParser {
  
  /**
   * Convert natural language query to OData query parameters
   */
  static parseToOData(userInput, analysis = null) {
    if (!analysis) {
      analysis = IntentRecognizer.analyzeInput(userInput);
    }
    
    const query = {
      entity: this.determineEntity(analysis),
      select: this.buildSelect(analysis),
      filter: this.buildFilter(analysis),
      orderby: this.buildOrderBy(analysis),
      top: this.buildTop(analysis),
      skip: this.buildSkip(analysis),
      expand: this.buildExpand(analysis),
      count: this.shouldIncludeCount(analysis)
    };
    
    // Clean up empty values
    Object.keys(query).forEach(key => {
      if (!query[key] || (Array.isArray(query[key]) && query[key].length === 0)) {
        delete query[key];
      }
    });
    
    return query;
  }
  
  /**
   * Determine the primary entity to query
   */
  static determineEntity(analysis) {
    const { entities } = analysis;
    
    if (entities.length === 0) {
      return "Products"; // Default entity
    }
    
    // Return the first entity's table
    return entities[0].table;
  }
  
  /**
   * Build $select clause
   */
  static buildSelect(analysis) {
    const { intent, entities, parameters } = analysis;
    const input = analysis.originalInput.toLowerCase();
    
    // If specific fields are mentioned
    if (input.includes("name") || input.includes("title")) {
      if (entities.length > 0) {
        const entity = entities[0];
        return entity.fields.filter(field => 
          field.toLowerCase().includes("name") || 
          field.toLowerCase().includes("title")
        );
      }
    }
    
    // For summary queries
    if (input.includes("summary") || input.includes("overview")) {
      if (entities[0]?.table === "Products") {
        return ["ID", "ProductName", "UnitPrice", "UnitsInStock"];
      } else if (entities[0]?.table === "Orders") {
        return ["ID", "OrderDate", "CustomerID", "Status"];
      } else if (entities[0]?.table === "Customers") {
        return ["ID", "CompanyName", "ContactName", "Country"];
      }
    }
    
    // Default: return all fields
    return null;
  }
  
  /**
   * Build $filter clause
   */
  static buildFilter(analysis) {
    const filters = [];
    const { parameters, entities } = analysis;
    const input = analysis.originalInput.toLowerCase();
    
    // Country filters
    if (parameters.countries.length > 0) {
      const countryFilters = parameters.countries.map(country => 
        `Country eq '${this.capitalizeFirst(country)}'`
      );
      filters.push(`(${countryFilters.join(' or ')})`);
    }
    
    // Date filters
    if (parameters.dates.length > 0) {
      const dateFilters = parameters.dates.map(dateInfo => {
        const date = dateInfo.date;
        const isoDate = date.toISOString().split('T')[0];
        
        if (dateInfo.phrase) {
          if (dateInfo.phrase.includes("last month")) {
            const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0];
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().split('T')[0];
            return `OrderDate ge ${startOfMonth} and OrderDate le ${endOfMonth}`;
          } else if (dateInfo.phrase.includes("today")) {
            return `OrderDate eq ${isoDate}`;
          } else if (dateInfo.phrase.includes("last week")) {
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            return `OrderDate ge ${weekAgo}`;
          }
        }
        
        return `OrderDate eq ${isoDate}`;
      });
      
      if (dateFilters.length > 0) {
        filters.push(`(${dateFilters.join(' or ')})`);
      }
    }
    
    // Numeric filters
    if (parameters.numbers.length > 0) {
      // Check context for what the numbers refer to
      if (input.includes("price") || input.includes("cost")) {
        const priceConditions = this.extractPriceConditions(input, parameters.numbers);
        if (priceConditions.length > 0) {
          filters.push(...priceConditions);
        }
      } else if (input.includes("stock") || input.includes("inventory")) {
        const stockConditions = this.extractStockConditions(input, parameters.numbers);
        if (stockConditions.length > 0) {
          filters.push(...stockConditions);
        }
      } else if (input.includes("id") || input.includes("number")) {
        // ID filters
        const ids = parameters.numbers.map(num => `ID eq ${num}`);
        filters.push(`(${ids.join(' or ')})`);
      }
    }
    
    // Status filters
    if (input.includes("available") || input.includes("in stock")) {
      filters.push("UnitsInStock gt 0");
    } else if (input.includes("out of stock") || input.includes("unavailable")) {
      filters.push("UnitsInStock eq 0");
    } else if (input.includes("discontinued")) {
      filters.push("Discontinued eq true");
    }
    
    // Category filters
    if (input.includes("beverage") || input.includes("drink")) {
      filters.push("CategoryID eq 1");
    } else if (input.includes("condiment") || input.includes("sauce")) {
      filters.push("CategoryID eq 2");
    } else if (input.includes("dairy") || input.includes("cheese")) {
      filters.push("CategoryID eq 4");
    } else if (input.includes("seafood") || input.includes("fish")) {
      filters.push("CategoryID eq 8");
    }
    
    return filters.length > 0 ? filters.join(' and ') : null;
  }
  
  /**
   * Extract price conditions from input
   */
  static extractPriceConditions(input, numbers) {
    const conditions = [];
    
    if (input.includes("under") || input.includes("less than") || input.includes("below")) {
      if (numbers.length > 0) {
        conditions.push(`UnitPrice lt ${numbers[0]}`);
      }
    } else if (input.includes("over") || input.includes("more than") || input.includes("above")) {
      if (numbers.length > 0) {
        conditions.push(`UnitPrice gt ${numbers[0]}`);
      }
    } else if (input.includes("between")) {
      if (numbers.length >= 2) {
        conditions.push(`UnitPrice ge ${Math.min(...numbers)} and UnitPrice le ${Math.max(...numbers)}`);
      }
    }
    
    return conditions;
  }
  
  /**
   * Extract stock conditions from input
   */
  static extractStockConditions(input, numbers) {
    const conditions = [];
    
    if (input.includes("under") || input.includes("less than") || input.includes("below")) {
      if (numbers.length > 0) {
        conditions.push(`UnitsInStock lt ${numbers[0]}`);
      }
    } else if (input.includes("over") || input.includes("more than") || input.includes("above")) {
      if (numbers.length > 0) {
        conditions.push(`UnitsInStock gt ${numbers[0]}`);
      }
    }
    
    return conditions;
  }
  
  /**
   * Build $orderby clause
   */
  static buildOrderBy(analysis) {
    const input = analysis.originalInput.toLowerCase();
    
    if (input.includes("expensive") || input.includes("highest price")) {
      return "UnitPrice desc";
    } else if (input.includes("cheapest") || input.includes("lowest price")) {
      return "UnitPrice asc";
    } else if (input.includes("newest") || input.includes("recent")) {
      return "CreatedAt desc";
    } else if (input.includes("oldest")) {
      return "CreatedAt asc";
    } else if (input.includes("alphabetical") || input.includes("name")) {
      return "ProductName asc";
    }
    
    return null;
  }
  
  /**
   * Build $top clause
   */
  static buildTop(analysis) {
    const input = analysis.originalInput.toLowerCase();
    const { parameters } = analysis;
    
    // Look for explicit numbers
    if (input.includes("top") && parameters.numbers.length > 0) {
      return parameters.numbers[0];
    } else if (input.includes("first") && parameters.numbers.length > 0) {
      return parameters.numbers[0];
    } else if (input.includes("few")) {
      return 5;
    } else if (input.includes("some")) {
      return 10;
    }
    
    // Default limits for different queries
    if (input.includes("all")) {
      return null; // No limit
    }
    
    return 20; // Default limit
  }
  
  /**
   * Build $skip clause
   */
  static buildSkip(analysis) {
    // For pagination - could be enhanced later
    return null;
  }
  
  /**
   * Build $expand clause
   */
  static buildExpand(analysis) {
    const { entities } = analysis;
    const input = analysis.originalInput.toLowerCase();
    
    // If asking for related data
    if (input.includes("with customer") || input.includes("customer details")) {
      return "Customer";
    } else if (input.includes("with category") || input.includes("category details")) {
      return "Category";
    } else if (input.includes("with supplier") || input.includes("supplier details")) {
      return "Supplier";
    }
    
    return null;
  }
  
  /**
   * Determine if count should be included
   */
  static shouldIncludeCount(analysis) {
    const input = analysis.originalInput.toLowerCase();
    return input.includes("how many") || input.includes("count") || input.includes("total");
  }
  
  /**
   * Generate OData URL from query object
   */
  static buildODataUrl(baseUrl, entity, queryParams) {
    let url = `${baseUrl}/${entity}`;
    const params = [];
    
    if (queryParams.select) {
      params.push(`$select=${Array.isArray(queryParams.select) ? queryParams.select.join(',') : queryParams.select}`);
    }
    
    if (queryParams.filter) {
      params.push(`$filter=${encodeURIComponent(queryParams.filter)}`);
    }
    
    if (queryParams.orderby) {
      params.push(`$orderby=${queryParams.orderby}`);
    }
    
    if (queryParams.top) {
      params.push(`$top=${queryParams.top}`);
    }
    
    if (queryParams.skip) {
      params.push(`$skip=${queryParams.skip}`);
    }
    
    if (queryParams.expand) {
      params.push(`$expand=${queryParams.expand}`);
    }
    
    if (queryParams.count) {
      params.push(`$count=true`);
    }
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }
    
    return url;
  }
  
  /**
   * Utility function to capitalize first letter
   */
  static capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

module.exports = ODataParser;
