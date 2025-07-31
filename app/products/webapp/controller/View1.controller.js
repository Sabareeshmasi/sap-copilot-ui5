sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
  ], function (Controller, Filter, FilterOperator, JSONModel, MessageToast) {
    "use strict";

    return Controller.extend("sap.copilot.products.controller.View1", {

      onInit: function () {
        // Initialize chat model with conversation memory
        const oChatModel = new JSONModel({
          messages: [],
          isLoading: false,
          isVisible: false,
          conversationContext: {
            lastQuery: null,
            lastResults: null,
            sessionId: this._generateSessionId(),
            userPreferences: {}
          }
        });
        this.getView().setModel(oChatModel, "chat");
        this._bChatVisible = false;

        // Store reference to controller for global functions
        window.sapCopilotController = this;

        // Initialize conversation with welcome message
        this._addSystemMessage("Hello! I'm your SAP Copilot assistant. I can help you with product queries, customer information, and business data analysis. Try asking me something like 'Show me all products under $20' or 'List customers from Germany'.");
      },
  
      onSearch: function (oEvent) {
        const sQuery = oEvent.getParameter("query");
        const oTable = this.byId("productTable");
        const oBinding = oTable.getBinding("items");
  
        if (sQuery) {
          const oFilter = new Filter("ProductName", FilterOperator.Contains, sQuery);
          oBinding.filter([oFilter]);
        } else {
          oBinding.filter([]);
        }
      },
  
      onToggleChat: function () {
        const oHTMLContainer = this.byId("chatShellContainer");
        const oChatModel = this.getView().getModel("chat");

        if (!this._bChatVisible) {
          const html = `
            <div class="chat-shell" id="copilotShell">
              <div class="chat-header">
                <h3>SAP Copilot</h3>
                <button onclick="window.sapCopilotController.onToggleChat()" class="close-btn">×</button>
              </div>
              <div class="chat-box" id="chatMessages">
                <div class="chat-message system-message">
                  <span class="sender">Copilot:</span>
                  Hello! I'm your SAP Copilot assistant. I can help you with product information, data analysis, and answer questions about your business data. How can I assist you today?
                </div>
              </div>
              <div class="chat-input">
                <input type="text" id="chatInputField" placeholder="Ask me about products, customers, or anything else..."
                       style="flex:1; padding:8px; border:1px solid #ccc; border-radius:4px;"
                       onkeypress="if(event.key==='Enter') window.sapCopilotController.submitChat()" />
                <button onclick="window.sapCopilotController.submitChat()"
                        style="padding:8px 12px; margin-left:8px; background:#0070f2; color:white; border:none; border-radius:4px; cursor:pointer;">
                  Send
                </button>
              </div>
              <div id="loadingIndicator" class="loading-indicator" style="display:none;">
                <span>🤖 Thinking...</span>
              </div>
            </div>
          `;
          oHTMLContainer.setContent(html);
          this._bChatVisible = true;
          oChatModel.setProperty("/isVisible", true);

          // Focus on input field
          setTimeout(() => {
            const input = document.getElementById("chatInputField");
            if (input) input.focus();
          }, 100);
        } else {
          oHTMLContainer.setContent("");
          this._bChatVisible = false;
          oChatModel.setProperty("/isVisible", false);
        }
      },

      submitChat: async function() {
        const input = document.getElementById("chatInputField");
        const msgBox = document.getElementById("chatMessages");
        const loadingIndicator = document.getElementById("loadingIndicator");

        if (!input || !msgBox) return;

        const text = input.value.trim();
        if (!text) return;

        const oChatModel = this.getView().getModel("chat");

        try {
          // Add user message
          msgBox.innerHTML += `
            <div class="chat-message user-message">
              <span class="sender">You:</span> ${this._escapeHtml(text)}
            </div>
          `;

          // Clear input and show loading
          input.value = "";
          input.disabled = true;
          loadingIndicator.style.display = "block";
          msgBox.scrollTop = msgBox.scrollHeight;

          oChatModel.setProperty("/isLoading", true);

          // Enhance prompt with conversation context
          const enhancedPrompt = this._enhancePromptWithContext(text);

          // Call enhanced Gemini service
          const response = await this._callGeminiService(enhancedPrompt);

          // Process enhanced response
          const messageClass = response.success ? "assistant-message" : "error-message";
          let responseHtml = `
            <div class="chat-message ${messageClass}">
              <span class="sender">Copilot:</span> ${this._escapeHtml(response.reply)}
          `;

          // Add data visualization if available
          if (response.data && response.data.length > 0) {
            responseHtml += this._renderDataTable(response.data, response.query);
          }

          // Add query information for debugging (in development)
          if (response.query && window.location.hostname === 'localhost') {
            responseHtml += `
              <div class="debug-info" style="margin-top: 8px; padding: 4px; background: #f0f0f0; font-size: 11px; border-radius: 3px;">
                <strong>Query:</strong> ${response.query.entity}${response.query.filter ? ` | Filter: ${response.query.filter}` : ''}
              </div>
            `;
          }

          responseHtml += `</div>`;
          msgBox.innerHTML += responseHtml;

          // Update conversation context
          const context = oChatModel.getProperty("/conversationContext");
          context.lastQuery = text;
          context.lastResults = response.data;
          oChatModel.setProperty("/conversationContext", context);

          // Store in model
          const messages = oChatModel.getProperty("/messages") || [];
          messages.push(
            { sender: "user", text: text, timestamp: new Date().toISOString() },
            {
              sender: "assistant",
              text: response.reply,
              timestamp: response.timestamp,
              success: response.success,
              data: response.data,
              query: response.query,
              intent: response.intent
            }
          );
          oChatModel.setProperty("/messages", messages);

        } catch (error) {
          console.error("Chat error:", error);
          msgBox.innerHTML += `
            <div class="chat-message error-message">
              <span class="sender">Copilot:</span> I'm sorry, I encountered an error. Please try again.
            </div>
          `;
          MessageToast.show("Failed to send message. Please try again.");
        } finally {
          // Reset UI state
          input.disabled = false;
          loadingIndicator.style.display = "none";
          oChatModel.setProperty("/isLoading", false);
          msgBox.scrollTop = msgBox.scrollHeight;
          input.focus();
        }
      },

      _callGeminiService: async function(prompt) {
        try {
          const response = await fetch("/gemini-service/prompt", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({ prompt: prompt })
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();
          return data.value || data; // Handle both CAP service response formats
        } catch (error) {
          console.error("Service call error:", error);
          // Return a fallback response
          return {
            reply: "I'm currently experiencing technical difficulties. The service is being set up. Please try again in a moment.",
            success: false,
            timestamp: new Date().toISOString()
          };
        }
      },

      _escapeHtml: function(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      },

      _generateSessionId: function() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      },

      _addSystemMessage: function(message) {
        const oChatModel = this.getView().getModel("chat");
        const messages = oChatModel.getProperty("/messages") || [];
        messages.push({
          sender: "system",
          text: message,
          timestamp: new Date().toISOString(),
          success: true
        });
        oChatModel.setProperty("/messages", messages);
      },

      _renderDataTable: function(data, query) {
        if (!data || data.length === 0) return "";

        const maxRows = 5; // Limit display to 5 rows
        const displayData = data.slice(0, maxRows);

        let tableHtml = `
          <div class="data-table-container" style="margin-top: 10px; max-width: 100%; overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px; background: white; border: 1px solid #ddd;">
              <thead>
                <tr style="background: #f5f5f5;">
        `;

        // Generate headers based on entity type
        if (query && query.entity === "Products") {
          tableHtml += `
            <th style="padding: 6px; border: 1px solid #ddd; text-align: left;">Product</th>
            <th style="padding: 6px; border: 1px solid #ddd; text-align: right;">Price</th>
            <th style="padding: 6px; border: 1px solid #ddd; text-align: right;">Stock</th>
          `;
        } else if (query && query.entity === "Customers") {
          tableHtml += `
            <th style="padding: 6px; border: 1px solid #ddd; text-align: left;">Company</th>
            <th style="padding: 6px; border: 1px solid #ddd; text-align: left;">Contact</th>
            <th style="padding: 6px; border: 1px solid #ddd; text-align: left;">Country</th>
          `;
        } else if (query && query.entity === "Orders") {
          tableHtml += `
            <th style="padding: 6px; border: 1px solid #ddd; text-align: left;">Order ID</th>
            <th style="padding: 6px; border: 1px solid #ddd; text-align: left;">Date</th>
            <th style="padding: 6px; border: 1px solid #ddd; text-align: left;">Status</th>
          `;
        } else {
          // Generic headers
          const keys = Object.keys(displayData[0] || {}).slice(0, 3);
          keys.forEach(key => {
            tableHtml += `<th style="padding: 6px; border: 1px solid #ddd; text-align: left;">${key}</th>`;
          });
        }

        tableHtml += `
                </tr>
              </thead>
              <tbody>
        `;

        // Generate rows
        displayData.forEach(item => {
          tableHtml += `<tr>`;

          if (query && query.entity === "Products") {
            tableHtml += `
              <td style="padding: 6px; border: 1px solid #ddd;">${this._escapeHtml(item.ProductName || 'N/A')}</td>
              <td style="padding: 6px; border: 1px solid #ddd; text-align: right;">$${(item.UnitPrice || 0).toFixed(2)}</td>
              <td style="padding: 6px; border: 1px solid #ddd; text-align: right;">${item.UnitsInStock || 0}</td>
            `;
          } else if (query && query.entity === "Customers") {
            tableHtml += `
              <td style="padding: 6px; border: 1px solid #ddd;">${this._escapeHtml(item.CompanyName || 'N/A')}</td>
              <td style="padding: 6px; border: 1px solid #ddd;">${this._escapeHtml(item.ContactName || 'N/A')}</td>
              <td style="padding: 6px; border: 1px solid #ddd;">${this._escapeHtml(item.Country || 'N/A')}</td>
            `;
          } else if (query && query.entity === "Orders") {
            tableHtml += `
              <td style="padding: 6px; border: 1px solid #ddd;">${item.ID || 'N/A'}</td>
              <td style="padding: 6px; border: 1px solid #ddd;">${item.OrderDate ? new Date(item.OrderDate).toLocaleDateString() : 'N/A'}</td>
              <td style="padding: 6px; border: 1px solid #ddd;">${this._escapeHtml(item.Status || 'N/A')}</td>
            `;
          } else {
            // Generic display
            const keys = Object.keys(item).slice(0, 3);
            keys.forEach(key => {
              const value = item[key];
              const displayValue = typeof value === 'string' ? value : JSON.stringify(value);
              tableHtml += `<td style="padding: 6px; border: 1px solid #ddd;">${this._escapeHtml(displayValue || 'N/A')}</td>`;
            });
          }

          tableHtml += `</tr>`;
        });

        tableHtml += `
              </tbody>
            </table>
        `;

        if (data.length > maxRows) {
          tableHtml += `
            <div style="padding: 6px; font-size: 11px; color: #666; text-align: center; background: #f9f9f9; border: 1px solid #ddd; border-top: none;">
              ... and ${data.length - maxRows} more results
            </div>
          `;
        }

        tableHtml += `</div>`;

        return tableHtml;
      },

      _enhancePromptWithContext: function(prompt) {
        const oChatModel = this.getView().getModel("chat");
        const context = oChatModel.getProperty("/conversationContext");

        // Add context for follow-up queries
        if (context.lastQuery && this._isFollowUpQuery(prompt)) {
          return `Previous query: "${context.lastQuery}"\nCurrent query: "${prompt}"\n\nPlease consider the context of the previous query when responding.`;
        }

        return prompt;
      },

      _isFollowUpQuery: function(prompt) {
        const followUpIndicators = [
          "same", "those", "them", "these", "that", "this",
          "also", "too", "as well", "similar", "like that",
          "more", "other", "another", "again"
        ];

        const lowerPrompt = prompt.toLowerCase();
        return followUpIndicators.some(indicator => lowerPrompt.includes(indicator));
      },

      onClearSearch: function() {
        const oSearchField = this.byId("productSearch");
        const oTable = this.byId("productTable");
        const oBinding = oTable.getBinding("items");

        oSearchField.setValue("");
        oBinding.filter([]);
      },

      onRefresh: function() {
        const oTable = this.byId("productTable");
        const oBinding = oTable.getBinding("items");

        oBinding.refresh();
        MessageToast.show("Data refreshed");
      },

      onProductSelect: function(oEvent) {
        const oSelectedItem = oEvent.getSource();
        const oContext = oSelectedItem.getBindingContext();
        const oProduct = oContext.getObject();

        MessageToast.show(`Selected: ${oProduct.ProductName}`);

        // You could open a detail dialog here
        // this._openProductDialog(oProduct);
      }
    });
  });
  