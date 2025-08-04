// SAP Copilot Presentation Script
// This can be used to generate slides programmatically

const presentationData = {
  title: "SAP Copilot Product Management",
  subtitle: "AI-Powered Enterprise Solution",
  slides: [
    {
      id: 1,
      title: "SAP Copilot Product Management",
      subtitle: "AI-Powered Enterprise Solution",
      content: {
        features: [
          "🤖 AI-Powered Copilot with Natural Language Processing",
          "📊 Real-time Business Intelligence & Analytics",
          "🔔 Enhanced Notification System with Smart Filtering", 
          "📦 Product Catalog Management with Advanced Search",
          "📈 Point-by-Point AI Responses for Better Clarity"
        ],
        techStack: "SAP UI5, Node.js, CDS, Cohere AI, WebSocket, SQLite",
        highlights: [
          "Modern enterprise architecture",
          "AI-driven business insights", 
          "Real-time data processing",
          "Professional user experience"
        ]
      }
    },
    {
      id: 2,
      title: "System Architecture & Core Features",
      content: {
        architecture: [
          "👤 User Interface (SAP UI5)",
          "🔗 API Layer (REST, WebSocket, OData)",
          "🧠 Business Logic (AI Engine, Services)",
          "💾 Data Access Layer (CDS Models)",
          "🗄️ Database Layer (Products, Notifications)"
        ],
        aiEngine: {
          title: "🤖 SAP Copilot AI Engine",
          features: [
            "Natural Language Processing: Understands business queries",
            "Intent Recognition: Classifies requests automatically",
            "Business Intelligence: Real-time data analysis",
            "Point-by-Point Responses: Structured formatting",
            "Fallback System: 100% response reliability"
          ]
        },
        notifications: {
          title: "🔔 Enhanced Notification System",
          features: [
            "Smart Filtering: All, Pending, Unread, Priority",
            "Interactive Actions: Read/unread, acknowledge, dismiss",
            "Real-time Alerts: WebSocket-powered notifications",
            "Detailed Views: Complete notification information",
            "Bulk Operations: Manage multiple notifications"
          ]
        }
      }
    },
    {
      id: 3,
      title: "Business Value & Live Demonstration",
      content: {
        businessImpact: {
          performance: [
            "⚡ 80% Faster data access via natural language",
            "📈 Real-time Insights for better decisions",
            "🔄 Automated Alerts for proactive management",
            "👥 60% Reduction in training time"
          ],
          costs: [
            "Reduced Training: Intuitive interface",
            "Faster Decisions: Instant insights",
            "Proactive Management: Early alerts",
            "Improved Efficiency: Automated analysis"
          ]
        },
        useCases: [
          {
            type: "Business Intelligence",
            example: "What's our average product price?",
            format: "📊 Analysis + bullet points + 💡 Insights"
          },
          {
            type: "Inventory Management", 
            example: "Show me low stock items",
            format: "📦 Products + status + ⚠️ Alerts"
          },
          {
            type: "Analytics",
            example: "Analyze stock efficiency", 
            format: "📈 Metrics + trends + 💡 Recommendations"
          }
        ],
        demoHighlights: [
          "Natural Language Queries: 'How many products are low stock?'",
          "Interactive Notifications: Filter, acknowledge, dismiss alerts",
          "Real-time Updates: Automatic refresh and notifications",
          "Business Intelligence: Structured insights and recommendations"
        ],
        roadmap: {
          phase1: ["CRUD Operations", "Advanced Search", "User Management"],
          phase2: ["Predictive Analytics", "Executive Dashboard", "Mobile Applications"],
          phase3: ["SAP ERP Integration", "API Gateway", "Advanced Security"]
        },
        differentiators: [
          "AI-powered natural language interface",
          "Real-time business intelligence",
          "Professional point-by-point responses",
          "Enhanced notification management",
          "Scalable enterprise architecture"
        ]
      }
    }
  ]
};

// Function to generate presentation content
function generatePresentation() {
  console.log("SAP Copilot Product Management Presentation");
  console.log("==========================================");
  
  presentationData.slides.forEach(slide => {
    console.log(`\nSlide ${slide.id}: ${slide.title}`);
    console.log("-".repeat(50));
    
    if (slide.content.features) {
      console.log("\nKey Features:");
      slide.content.features.forEach(feature => console.log(`  ${feature}`));
    }
    
    if (slide.content.architecture) {
      console.log("\nArchitecture:");
      slide.content.architecture.forEach(layer => console.log(`  ${layer}`));
    }
    
    if (slide.content.businessImpact) {
      console.log("\nBusiness Impact:");
      slide.content.businessImpact.performance.forEach(item => console.log(`  ${item}`));
    }
  });
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { presentationData, generatePresentation };
}

// Browser usage
if (typeof window !== 'undefined') {
  window.SAPCopilotPresentation = { presentationData, generatePresentation };
}
