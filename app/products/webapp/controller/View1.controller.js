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

        // Initialize notifications model
        const oNotificationModel = new JSONModel({
          notifications: [],
          unreadCount: 0,
          isVisible: false
        });
        this.getView().setModel(oNotificationModel, "notifications");
        this._bNotificationsVisible = false;

        // Store reference to controller for global functions
        window.sapCopilotController = this;

        // Initialize conversation with welcome message
        this._addSystemMessage("Hello! I'm your SAP Copilot assistant. I can help you with product queries, customer information, and business data analysis. Try asking me something like 'Show me all products under $20' or 'List customers from Germany'.");

        // Initialize WebSocket for real-time notifications
        this._initializeNotificationSocket();

        // Add some test notifications for demonstration
        this._addTestNotifications();
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
                <button onclick="window.sapCopilotController.onCloseChat()" class="close-btn">×</button>
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

      /**
       * Close chat panel (dedicated close function)
       */
      onCloseChat: function() {
        const oHTMLContainer = this.byId("chatShellContainer");
        const oChatModel = this.getView().getModel("chat");

        // Always close the chat
        oHTMLContainer.setContent("");
        this._bChatVisible = false;
        oChatModel.setProperty("/isVisible", false);

        console.log("💬 Chat panel closed");
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

          // Add download button for reports
          if (response.type === "report_generated" && response.data && response.data.reportFile) {
            responseHtml += `
              <div class="report-download-section" style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid #0070f3;">
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                  <span style="font-size: 14px; color: #333;">📄 Report Ready:</span>
                  <button onclick="window.open('/download/${response.data.reportFile.fileName}', '_blank')"
                          style="background: #0070f3; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;">
                    📥 Download ${response.data.reportFile.fileName}
                  </button>
                </div>
              </div>
            `;
          }

          // Add data visualization if available
          if (response.data && Array.isArray(response.data) && response.data.length > 0) {
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

          // Check if this is a report generation response and trigger download
          if (response.type === "report_generated" && response.data && response.data.reportFile) {
            this._triggerReportDownload(response.data.reportFile);
          }

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

      /**
       * Format stock status text based on stock level
       */
      formatStockStatus: function(unitsInStock) {
        if (unitsInStock === 0) {
          return "Not Available";
        } else if (unitsInStock < 10) {
          return "Critical Low";
        } else if (unitsInStock < 20) {
          return "Low Stock";
        } else {
          return "Available";
        }
      },

      /**
       * Format stock status state (color) based on stock level
       */
      formatStockState: function(unitsInStock) {
        if (unitsInStock === 0) {
          return "Error";        // Red
        } else if (unitsInStock < 10) {
          return "Warning";      // Orange/Yellow
        } else if (unitsInStock < 20) {
          return "Information";  // Blue
        } else {
          return "Success";      // Green
        }
      },

      /**
       * Toggle notification panel visibility
       */
      onToggleNotifications: function() {
        const oNotificationModel = this.getView().getModel("notifications");
        const bCurrentlyVisible = oNotificationModel.getProperty("/isVisible");

        if (bCurrentlyVisible) {
          this._hideNotificationPanel();
        } else {
          this._showNotificationPanel();
        }
      },

      /**
       * Initialize WebSocket for real-time notifications
       */
      _initializeNotificationSocket: function() {
        try {
          // Check if Socket.IO is available
          if (typeof io === 'undefined') {
            console.warn('⚠️ Socket.IO not available - notifications will work in demo mode');
            return;
          }

          // Connect to WebSocket for real-time notifications
          this._notificationSocket = io();

          this._notificationSocket.on('connect', () => {
            console.log('📡 Connected to notification WebSocket');
          });

          this._notificationSocket.on('disconnect', () => {
            console.log('📡 Disconnected from notification WebSocket');
          });

          this._notificationSocket.on('new-notification', (notification) => {
            console.log('🔔 Received notification:', notification);
            this._addNotification(notification);
          });

          this._notificationSocket.on('alert-triggered', (alert) => {
            console.log('🚨 Received alert:', alert);
            this._addAlertNotification(alert);
          });

        } catch (error) {
          console.warn('⚠️ WebSocket initialization failed:', error.message);
        }
      },

      /**
       * Add notification to the panel
       */
      _addNotification: function(notification) {
        const oNotificationModel = this.getView().getModel("notifications");
        const aNotifications = oNotificationModel.getProperty("/notifications") || [];

        // Add new notification at the beginning
        aNotifications.unshift(notification);

        // Keep only last 20 notifications
        if (aNotifications.length > 20) {
          aNotifications.splice(20);
        }

        // Update unread count
        const unreadCount = aNotifications.filter(n => !n.read).length;

        oNotificationModel.setProperty("/notifications", aNotifications);
        oNotificationModel.setProperty("/unreadCount", unreadCount);

        // Show toast notification
        MessageToast.show(`🔔 ${notification.title}`);
      },

      /**
       * Add alert notification
       */
      _addAlertNotification: function(alert) {
        const notification = {
          id: `alert_${Date.now()}`,
          type: 'alert',
          title: `🚨 ${alert.ruleName}`,
          message: alert.message,
          timestamp: alert.timestamp,
          priority: alert.priority,
          read: false
        };

        this._addNotification(notification);
      },

      /**
       * Show notification panel
       */
      _showNotificationPanel: function() {
        const oNotificationModel = this.getView().getModel("notifications");
        const oContainer = this.byId("notificationPanelContainer");

        // Create notification panel HTML
        const notificationHTML = this._createNotificationPanelHTML();
        oContainer.setContent(notificationHTML);

        oNotificationModel.setProperty("/isVisible", true);
        this._bNotificationsVisible = true;

        // Mark all notifications as read when panel is opened
        this._markAllNotificationsAsRead();
      },

      /**
       * Hide notification panel
       */
      _hideNotificationPanel: function() {
        const oNotificationModel = this.getView().getModel("notifications");
        const oContainer = this.byId("notificationPanelContainer");

        oContainer.setContent("");
        oNotificationModel.setProperty("/isVisible", false);
        this._bNotificationsVisible = false;
      },

      /**
       * Create notification panel HTML
       */
      _createNotificationPanelHTML: function() {
        const oNotificationModel = this.getView().getModel("notifications");
        const aNotifications = oNotificationModel.getProperty("/notifications") || [];

        let html = `
          <div class="notification-panel">
            <div class="notification-header">
              <h3>🔔 Notifications</h3>
              <button class="close-btn" onclick="window.sapCopilotController._hideNotificationPanel()">×</button>
            </div>
            <div class="notification-list">
        `;

        if (aNotifications.length === 0) {
          html += `
            <div class="no-notifications">
              <p>📭 No notifications yet</p>
              <p>Alerts and updates will appear here</p>
            </div>
          `;
        } else {
          aNotifications.forEach(notification => {
            const timeAgo = this._getTimeAgo(notification.timestamp);
            const priorityClass = notification.priority || 'medium';

            html += `
              <div class="notification-item ${priorityClass}">
                <div class="notification-content">
                  <div class="notification-title">${notification.title}</div>
                  <div class="notification-message">${notification.message}</div>
                  <div class="notification-time">${timeAgo}</div>
                </div>
              </div>
            `;
          });
        }

        html += `
            </div>
          </div>
        `;

        return html;
      },

      /**
       * Mark all notifications as read
       */
      _markAllNotificationsAsRead: function() {
        const oNotificationModel = this.getView().getModel("notifications");
        const aNotifications = oNotificationModel.getProperty("/notifications") || [];

        aNotifications.forEach(notification => {
          notification.read = true;
        });

        oNotificationModel.setProperty("/notifications", aNotifications);
        oNotificationModel.setProperty("/unreadCount", 0);
      },

      /**
       * Get time ago string
       */
      _getTimeAgo: function(timestamp) {
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
      },

      /**
       * Add test notifications for demonstration
       */
      _addTestNotifications: function() {
        // Add some sample notifications to show the system is working
        setTimeout(() => {
          this._addNotification({
            id: 'test_1',
            type: 'alert',
            title: '🚨 Critical Alert: Out of Stock',
            message: '3 products are completely out of stock and need immediate attention',
            timestamp: new Date().toISOString(),
            priority: 'high',
            read: false
          });
        }, 2000);

        setTimeout(() => {
          this._addNotification({
            id: 'test_2',
            type: 'alert',
            title: '⚠️ Alert: Low Stock Warning',
            message: '7 products have stock below 20 units - consider reordering',
            timestamp: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
            priority: 'medium',
            read: false
          });
        }, 3000);

        setTimeout(() => {
          this._addNotification({
            id: 'test_3',
            type: 'info',
            title: '📊 System Update',
            message: 'Alert monitoring system is active and checking every 5 minutes',
            timestamp: new Date(Date.now() - 600000).toISOString(), // 10 minutes ago
            priority: 'low',
            read: false
          });
        }, 4000);
      },

      _triggerReportDownload: function(reportFile) {
        try {
          console.log("🔽 Triggering automatic download for:", reportFile.fileName);

          // Create download link
          const downloadUrl = `/download/${reportFile.fileName}`;

          // Create temporary link element and trigger download
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = reportFile.fileName;
          link.style.display = 'none';

          // Add to DOM, click, and remove
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          // Show success message
          MessageToast.show(`📥 Downloading ${reportFile.fileName}...`);

          console.log("✅ Download triggered successfully");
        } catch (error) {
          console.error("❌ Error triggering download:", error);
          MessageToast.show("Download failed. Please use the provided link.");
        }
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
  