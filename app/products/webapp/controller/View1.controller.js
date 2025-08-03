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
          isVisible: false,
          currentFilter: 'all', // all, pending, read, unread
          selectedPriority: 'all', // all, high, medium, low
          showDetails: false,
          selectedNotification: null
        });
        this.getView().setModel(oNotificationModel, "notifications");
        this._bNotificationsVisible = false;

        // Store reference to controller for global functions
        window.sapCopilotController = this;

        // Initialize conversation with welcome message
        this._addSystemMessage("Hello! I'm your SAP Copilot assistant with enhanced Business Intelligence capabilities. I can help you with:\n\n📊 **Business Intelligence**: 'What's our average product price?', 'How many products are low stock?'\n📈 **Analytics**: 'Show me price trends', 'Analyze stock efficiency'\n🔍 **Product Queries**: 'Show me products under $20', 'List low stock items'\n💰 **Financial Analysis**: 'What's our total inventory value?', 'Show revenue potential'\n\nTry asking me anything about your business data!");

        // Initialize WebSocket for real-time notifications
        this._initializeNotificationSocket();

        // Add some test notifications for demonstration
        this._addTestNotifications();

        // Add enhanced test notification after a delay
        setTimeout(() => {
          this._testEnhancedNotifications();
        }, 2000);
      },
  
      onSearch: function (oEvent) {
        const sQuery = oEvent.getParameter("query");
        const oTable = this.byId("productTable");
        const oBinding = oTable.getBinding("items");

        console.log(`🔍 Search triggered with query: "${sQuery}"`);
        console.log(`🔍 Table binding:`, oBinding);

        if (sQuery && sQuery.trim()) {
          // Create multiple filters for case-insensitive search
          // We'll use multiple variations to catch different cases
          const sLowerQuery = sQuery.toLowerCase();
          const sUpperQuery = sQuery.toUpperCase();
          const sCapitalQuery = sQuery.charAt(0).toUpperCase() + sQuery.slice(1).toLowerCase();

          const aFilters = [
            // Original case
            new Filter("ProductName", FilterOperator.Contains, sQuery),
            new Filter("Description", FilterOperator.Contains, sQuery),
            // Lowercase
            new Filter("ProductName", FilterOperator.Contains, sLowerQuery),
            new Filter("Description", FilterOperator.Contains, sLowerQuery),
            // Uppercase
            new Filter("ProductName", FilterOperator.Contains, sUpperQuery),
            new Filter("Description", FilterOperator.Contains, sUpperQuery),
            // Capitalized
            new Filter("ProductName", FilterOperator.Contains, sCapitalQuery),
            new Filter("Description", FilterOperator.Contains, sCapitalQuery)
          ];

          // Combine all filters with OR logic
          const oCombinedFilter = new Filter({
            filters: aFilters,
            and: false // OR logic - any match will show the item
          });

          console.log(`🔍 Applying filters for: "${sQuery}", "${sLowerQuery}", "${sUpperQuery}", "${sCapitalQuery}"`);
          oBinding.filter([oCombinedFilter]);
        } else {
          console.log("🔍 Clearing search filters");
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
                <button onclick="window.sapCopilotController.onCloseChat(event)" class="close-btn" title="Minimize to notification">−</button>
              </div>
              <div class="chat-box" id="chatMessages">
                <div class="chat-message system-message">
                  <span class="sender">Copilot:</span>
                  Hello! I'm your SAP Copilot assistant with enhanced Business Intelligence capabilities. I can help you with:
                  <br><br>
                  📊 <strong>Business Intelligence</strong>: "What's our average product price?", "How many products are low stock?"
                  <br>
                  📈 <strong>Analytics</strong>: "Show me price trends", "Analyze stock efficiency"
                  <br>
                  🔍 <strong>Product Queries</strong>: "Show me products under $20", "List low stock items"
                  <br>
                  💰 <strong>Financial Analysis</strong>: "What's our total inventory value?", "Show revenue potential"
                  <br><br>
                  Try asking me anything about your business data!
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
       * Minimize chat panel (notification-style minimize)
       */
      onCloseChat: function(event) {
        console.log("🔧 onCloseChat called");

        // Prevent event bubbling to avoid immediate restore
        if (event) {
          event.stopPropagation();
          event.preventDefault();
        }

        const chatShell = document.getElementById("copilotShell");
        console.log("🔧 chatShell element:", chatShell);

        if (chatShell) {
          if (chatShell.classList.contains("minimized")) {
            // If already minimized, restore it
            chatShell.classList.remove("minimized");
            this._removeHeaderClickHandler();
            console.log("💬 Chat panel restored");
          } else {
            // Minimize with animation
            chatShell.classList.add("minimized");
            console.log("💬 Chat panel minimized - class added");

            // Add click handler to header for restore (with delay to avoid immediate trigger)
            setTimeout(() => {
              this._addHeaderClickHandler();
            }, 100);
          }
        } else {
          console.error("❌ Could not find copilotShell element");
        }
      },

      /**
       * Add click handler to header for restoring minimized chat
       */
      _addHeaderClickHandler: function() {
        const chatShell = document.getElementById("copilotShell");
        const header = chatShell?.querySelector(".chat-header");

        if (header && !header._hasClickHandler) {
          header._clickHandler = (event) => {
            event.stopPropagation();
            chatShell.classList.remove("minimized");
            this._removeHeaderClickHandler();
            console.log("💬 Chat panel restored by clicking header");
          };

          header.addEventListener("click", header._clickHandler);
          header._hasClickHandler = true;
          console.log("🔧 Header click handler added");
        }
      },

      /**
       * Remove click handler from header
       */
      _removeHeaderClickHandler: function() {
        const chatShell = document.getElementById("copilotShell");
        const header = chatShell?.querySelector(".chat-header");

        if (header && header._clickHandler) {
          header.removeEventListener("click", header._clickHandler);
          header._hasClickHandler = false;
          header._clickHandler = null;
          console.log("🔧 Header click handler removed");
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
          priority: alert.priority || 'high',
          read: false,
          acknowledged: false,
          dismissed: false,
          status: 'pending', // pending, acknowledged, dismissed
          details: alert.details || alert.message,
          actionRequired: true,
          category: 'system_alert'
        };

        this._addNotification(notification);
      },

      /**
       * Show notification panel
       */
      _showNotificationPanel: function() {
        const oNotificationModel = this.getView().getModel("notifications");
        const oContainer = this.byId("notificationPanelContainer");

        try {
          // Create notification panel HTML
          const notificationHTML = this._createNotificationPanelHTML();
          oContainer.setContent(notificationHTML);

          oNotificationModel.setProperty("/isVisible", true);
          this._bNotificationsVisible = true;

          console.log("🔔 Enhanced notification panel opened");

          // Don't automatically mark as read - let user control this
          // this._markAllNotificationsAsRead();
        } catch (error) {
          console.error("❌ Error creating enhanced notification panel:", error);
          // Fallback to simple notification panel
          this._showSimpleNotificationPanel();
        }
      },

      /**
       * Show simple notification panel (fallback)
       */
      _showSimpleNotificationPanel: function() {
        const oNotificationModel = this.getView().getModel("notifications");
        const oContainer = this.byId("notificationPanelContainer");
        const aNotifications = oNotificationModel.getProperty("/notifications") || [];

        const simpleHTML = `
          <div class="notification-panel">
            <div class="notification-header">
              <h3>🔔 Notifications (${aNotifications.length})</h3>
              <button class="close-btn" onclick="window.sapCopilotController._hideNotificationPanel()">×</button>
            </div>
            <div class="notification-list">
              ${aNotifications.length === 0 ?
                '<div class="no-notifications"><p>📭 No notifications</p></div>' :
                aNotifications.map(n => `
                  <div class="notification-item ${n.priority || 'medium'} ${n.read ? 'read' : 'unread'}">
                    <div class="notification-content">
                      <div class="notification-title">${n.title}</div>
                      <div class="notification-message">${n.message}</div>
                      <div class="notification-time">${this._getTimeAgo(n.timestamp)}</div>
                    </div>
                  </div>
                `).join('')
              }
            </div>
          </div>
        `;

        oContainer.setContent(simpleHTML);
        oNotificationModel.setProperty("/isVisible", true);
        this._bNotificationsVisible = true;
        console.log("🔔 Simple notification panel opened (fallback)");
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
        const currentFilter = oNotificationModel.getProperty("/currentFilter") || 'all';
        const selectedPriority = oNotificationModel.getProperty("/selectedPriority") || 'all';

        // Filter notifications based on current filter and priority
        const filteredNotifications = this._filterNotifications(aNotifications, currentFilter, selectedPriority);

        // Count different types
        const counts = {
          all: aNotifications.length,
          pending: aNotifications.filter(n => n.status === 'pending').length,
          unread: aNotifications.filter(n => !n.read).length,
          acknowledged: aNotifications.filter(n => n.acknowledged).length
        };

        let html = `
          <div class="notification-panel enhanced">
            <div class="notification-header">
              <h3>🔔 Notifications (${filteredNotifications.length})</h3>
              <button class="close-btn" onclick="window.sapCopilotController._hideNotificationPanel()">×</button>
            </div>

            <!-- Filter Controls -->
            <div class="notification-filters">
              <div class="filter-tabs">
                <button class="filter-tab ${currentFilter === 'all' ? 'active' : ''}"
                        onclick="window.sapCopilotController._setNotificationFilter('all')">
                  All (${counts.all})
                </button>
                <button class="filter-tab ${currentFilter === 'pending' ? 'active' : ''}"
                        onclick="window.sapCopilotController._setNotificationFilter('pending')">
                  Pending (${counts.pending})
                </button>
                <button class="filter-tab ${currentFilter === 'unread' ? 'active' : ''}"
                        onclick="window.sapCopilotController._setNotificationFilter('unread')">
                  Unread (${counts.unread})
                </button>
              </div>

              <div class="priority-filter">
                <select onchange="window.sapCopilotController._setPriorityFilter(this.value)" class="priority-select">
                  <option value="all" ${selectedPriority === 'all' ? 'selected' : ''}>All Priorities</option>
                  <option value="high" ${selectedPriority === 'high' ? 'selected' : ''}>🔴 High</option>
                  <option value="medium" ${selectedPriority === 'medium' ? 'selected' : ''}>🟡 Medium</option>
                  <option value="low" ${selectedPriority === 'low' ? 'selected' : ''}>🟢 Low</option>
                </select>
              </div>
            </div>

            <!-- Bulk Actions -->
            <div class="bulk-actions">
              <button onclick="window.sapCopilotController._markAllAsRead()" class="bulk-btn">
                ✓ Mark All Read
              </button>
              <button onclick="window.sapCopilotController._acknowledgeAll()" class="bulk-btn">
                👍 Acknowledge All
              </button>
              <button onclick="window.sapCopilotController._clearDismissed()" class="bulk-btn">
                🗑️ Clear Dismissed
              </button>
            </div>

            <div class="notification-list">
        `;

        if (filteredNotifications.length === 0) {
          html += `
            <div class="no-notifications">
              <p>📭 No notifications match your filter</p>
              <p>Try changing the filter or priority settings</p>
            </div>
          `;
        } else {
          filteredNotifications.forEach(notification => {
            const timeAgo = this._getTimeAgo(notification.timestamp);
            const priorityClass = notification.priority || 'medium';
            const statusClass = notification.status || 'pending';
            const readClass = notification.read ? 'read' : 'unread';

            // Priority icon
            const priorityIcon = {
              'high': '🔴',
              'medium': '🟡',
              'low': '🟢'
            }[notification.priority] || '🟡';

            // Status icon
            const statusIcon = {
              'pending': '⏳',
              'acknowledged': '✅',
              'dismissed': '❌'
            }[notification.status] || '⏳';

            html += `
              <div class="notification-item ${priorityClass} ${statusClass} ${readClass}" data-id="${notification.id}">
                <div class="notification-indicators">
                  <span class="priority-indicator">${priorityIcon}</span>
                  <span class="status-indicator">${statusIcon}</span>
                  ${!notification.read ? '<span class="unread-dot">●</span>' : ''}
                </div>

                <div class="notification-content">
                  <div class="notification-title">${notification.title}</div>
                  <div class="notification-message">${notification.message}</div>
                  <div class="notification-meta">
                    <span class="notification-time">${timeAgo}</span>
                    <span class="notification-category">${notification.category || 'general'}</span>
                  </div>
                </div>

                <div class="notification-actions">
                  ${!notification.read ?
                    `<button onclick="window.sapCopilotController._markAsRead('${notification.id}')" class="action-btn read-btn" title="Mark as Read">👁️</button>` :
                    `<button onclick="window.sapCopilotController._markAsUnread('${notification.id}')" class="action-btn unread-btn" title="Mark as Unread">👁️‍🗨️</button>`
                  }

                  ${notification.status === 'pending' && notification.actionRequired ?
                    `<button onclick="window.sapCopilotController._acknowledgeNotification('${notification.id}')" class="action-btn ack-btn" title="Acknowledge">✅</button>` : ''
                  }

                  <button onclick="window.sapCopilotController._showNotificationDetails('${notification.id}')" class="action-btn details-btn" title="View Details">📋</button>

                  <button onclick="window.sapCopilotController._dismissNotification('${notification.id}')" class="action-btn dismiss-btn" title="Dismiss">🗑️</button>
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
       * Filter notifications based on criteria
       */
      _filterNotifications: function(notifications, filter, priority) {
        let filtered = notifications;

        // Apply status filter
        switch(filter) {
          case 'pending':
            filtered = filtered.filter(n => n.status === 'pending');
            break;
          case 'unread':
            filtered = filtered.filter(n => !n.read);
            break;
          case 'acknowledged':
            filtered = filtered.filter(n => n.acknowledged);
            break;
          case 'dismissed':
            filtered = filtered.filter(n => n.dismissed);
            break;
          // 'all' shows everything
        }

        // Apply priority filter
        if (priority !== 'all') {
          filtered = filtered.filter(n => n.priority === priority);
        }

        return filtered;
      },

      /**
       * Set notification filter
       */
      _setNotificationFilter: function(filter) {
        try {
          console.log(`🔍 Setting notification filter to: ${filter}`);
          const oNotificationModel = this.getView().getModel("notifications");
          oNotificationModel.setProperty("/currentFilter", filter);

          // Refresh the panel
          if (this._bNotificationsVisible) {
            this._showNotificationPanel();
          }
        } catch (error) {
          console.error("❌ Error setting notification filter:", error);
        }
      },

      /**
       * Set priority filter
       */
      _setPriorityFilter: function(priority) {
        try {
          console.log(`🎯 Setting priority filter to: ${priority}`);
          const oNotificationModel = this.getView().getModel("notifications");
          oNotificationModel.setProperty("/selectedPriority", priority);

          // Refresh the panel
          if (this._bNotificationsVisible) {
            this._showNotificationPanel();
          }
        } catch (error) {
          console.error("❌ Error setting priority filter:", error);
        }
      },

      /**
       * Mark specific notification as read
       */
      _markAsRead: function(notificationId) {
        try {
          console.log(`👁️ Marking notification as read: ${notificationId}`);
          const oNotificationModel = this.getView().getModel("notifications");
          const aNotifications = oNotificationModel.getProperty("/notifications") || [];

          const notification = aNotifications.find(n => n.id === notificationId);
          if (notification) {
            notification.read = true;
            oNotificationModel.setProperty("/notifications", aNotifications);
            this._updateUnreadCount();
            this._showNotificationPanel(); // Refresh
            console.log(`✅ Notification marked as read: ${notification.title}`);
          } else {
            console.warn(`⚠️ Notification not found: ${notificationId}`);
          }
        } catch (error) {
          console.error("❌ Error marking notification as read:", error);
        }
      },

      /**
       * Mark specific notification as unread
       */
      _markAsUnread: function(notificationId) {
        try {
          console.log(`👁️‍🗨️ Marking notification as unread: ${notificationId}`);
          const oNotificationModel = this.getView().getModel("notifications");
          const aNotifications = oNotificationModel.getProperty("/notifications") || [];

          const notification = aNotifications.find(n => n.id === notificationId);
          if (notification) {
            notification.read = false;
            oNotificationModel.setProperty("/notifications", aNotifications);
            this._updateUnreadCount();
            this._showNotificationPanel(); // Refresh
            console.log(`✅ Notification marked as unread: ${notification.title}`);
          } else {
            console.warn(`⚠️ Notification not found: ${notificationId}`);
          }
        } catch (error) {
          console.error("❌ Error marking notification as unread:", error);
        }
      },

      /**
       * Acknowledge notification
       */
      _acknowledgeNotification: function(notificationId) {
        try {
          console.log(`✅ Acknowledging notification: ${notificationId}`);
          const oNotificationModel = this.getView().getModel("notifications");
          const aNotifications = oNotificationModel.getProperty("/notifications") || [];

          const notification = aNotifications.find(n => n.id === notificationId);
          if (notification) {
            notification.acknowledged = true;
            notification.status = 'acknowledged';
            notification.read = true;
            oNotificationModel.setProperty("/notifications", aNotifications);
            this._updateUnreadCount();
            this._showNotificationPanel(); // Refresh

            MessageToast.show(`✅ Notification acknowledged: ${notification.title}`);
            console.log(`✅ Notification acknowledged: ${notification.title}`);
          } else {
            console.warn(`⚠️ Notification not found: ${notificationId}`);
          }
        } catch (error) {
          console.error("❌ Error acknowledging notification:", error);
        }
      },

      /**
       * Dismiss notification
       */
      _dismissNotification: function(notificationId) {
        try {
          console.log(`🗑️ Dismissing notification: ${notificationId}`);
          const oNotificationModel = this.getView().getModel("notifications");
          const aNotifications = oNotificationModel.getProperty("/notifications") || [];

          const notification = aNotifications.find(n => n.id === notificationId);
          if (notification) {
            notification.dismissed = true;
            notification.status = 'dismissed';
            notification.read = true;
            oNotificationModel.setProperty("/notifications", aNotifications);
            this._updateUnreadCount();
            this._showNotificationPanel(); // Refresh

            MessageToast.show(`🗑️ Notification dismissed: ${notification.title}`);
            console.log(`🗑️ Notification dismissed: ${notification.title}`);
          } else {
            console.warn(`⚠️ Notification not found: ${notificationId}`);
          }
        } catch (error) {
          console.error("❌ Error dismissing notification:", error);
        }
      },

      /**
       * Show notification details
       */
      _showNotificationDetails: function(notificationId) {
        const oNotificationModel = this.getView().getModel("notifications");
        const aNotifications = oNotificationModel.getProperty("/notifications") || [];

        const notification = aNotifications.find(n => n.id === notificationId);
        if (notification) {
          oNotificationModel.setProperty("/selectedNotification", notification);
          oNotificationModel.setProperty("/showDetails", true);

          // Create details modal
          this._createNotificationDetailsModal(notification);
        }
      },

      /**
       * Mark all notifications as read
       */
      _markAllAsRead: function() {
        try {
          console.log(`👁️ Marking all notifications as read`);
          const oNotificationModel = this.getView().getModel("notifications");
          const aNotifications = oNotificationModel.getProperty("/notifications") || [];

          let markedCount = 0;
          aNotifications.forEach(notification => {
            if (!notification.read) {
              notification.read = true;
              markedCount++;
            }
          });

          oNotificationModel.setProperty("/notifications", aNotifications);
          this._updateUnreadCount();
          this._showNotificationPanel(); // Refresh

          MessageToast.show(`✅ ${markedCount} notifications marked as read`);
          console.log(`✅ ${markedCount} notifications marked as read`);
        } catch (error) {
          console.error("❌ Error marking all notifications as read:", error);
        }
      },

      /**
       * Acknowledge all pending notifications
       */
      _acknowledgeAll: function() {
        const oNotificationModel = this.getView().getModel("notifications");
        const aNotifications = oNotificationModel.getProperty("/notifications") || [];

        let acknowledgedCount = 0;
        aNotifications.forEach(notification => {
          if (notification.status === 'pending' && notification.actionRequired) {
            notification.acknowledged = true;
            notification.status = 'acknowledged';
            notification.read = true;
            acknowledgedCount++;
          }
        });

        oNotificationModel.setProperty("/notifications", aNotifications);
        this._updateUnreadCount();
        this._showNotificationPanel(); // Refresh

        MessageToast.show(`✅ ${acknowledgedCount} notifications acknowledged`);
      },

      /**
       * Clear dismissed notifications
       */
      _clearDismissed: function() {
        const oNotificationModel = this.getView().getModel("notifications");
        const aNotifications = oNotificationModel.getProperty("/notifications") || [];

        const remainingNotifications = aNotifications.filter(n => !n.dismissed);
        const clearedCount = aNotifications.length - remainingNotifications.length;

        oNotificationModel.setProperty("/notifications", remainingNotifications);
        this._updateUnreadCount();
        this._showNotificationPanel(); // Refresh

        MessageToast.show(`🗑️ ${clearedCount} dismissed notifications cleared`);
      },

      /**
       * Update unread count
       */
      _updateUnreadCount: function() {
        const oNotificationModel = this.getView().getModel("notifications");
        const aNotifications = oNotificationModel.getProperty("/notifications") || [];
        const unreadCount = aNotifications.filter(n => !n.read).length;
        oNotificationModel.setProperty("/unreadCount", unreadCount);
      },

      /**
       * Mark all notifications as read (legacy function)
       */
      _markAllNotificationsAsRead: function() {
        this._markAllAsRead();
      },

      /**
       * Create notification details modal
       */
      _createNotificationDetailsModal: function(notification) {
        const timeAgo = this._getTimeAgo(notification.timestamp);
        const fullDate = new Date(notification.timestamp).toLocaleString();

        const priorityIcon = {
          'high': '🔴',
          'medium': '🟡',
          'low': '🟢'
        }[notification.priority] || '🟡';

        const statusIcon = {
          'pending': '⏳',
          'acknowledged': '✅',
          'dismissed': '❌'
        }[notification.status] || '⏳';

        const modalHtml = `
          <div class="notification-modal-overlay" onclick="window.sapCopilotController._closeNotificationDetails()">
            <div class="notification-modal" onclick="event.stopPropagation()">
              <div class="modal-header">
                <h3>📋 Notification Details</h3>
                <button class="close-btn" onclick="window.sapCopilotController._closeNotificationDetails()">×</button>
              </div>

              <div class="modal-content">
                <div class="notification-detail-item">
                  <label>Title:</label>
                  <div class="detail-value">${notification.title}</div>
                </div>

                <div class="notification-detail-item">
                  <label>Message:</label>
                  <div class="detail-value">${notification.message}</div>
                </div>

                <div class="notification-detail-item">
                  <label>Details:</label>
                  <div class="detail-value">${notification.details || notification.message}</div>
                </div>

                <div class="notification-detail-row">
                  <div class="notification-detail-item">
                    <label>Priority:</label>
                    <div class="detail-value">${priorityIcon} ${notification.priority || 'medium'}</div>
                  </div>

                  <div class="notification-detail-item">
                    <label>Status:</label>
                    <div class="detail-value">${statusIcon} ${notification.status || 'pending'}</div>
                  </div>
                </div>

                <div class="notification-detail-row">
                  <div class="notification-detail-item">
                    <label>Category:</label>
                    <div class="detail-value">${notification.category || 'general'}</div>
                  </div>

                  <div class="notification-detail-item">
                    <label>Type:</label>
                    <div class="detail-value">${notification.type || 'info'}</div>
                  </div>
                </div>

                <div class="notification-detail-item">
                  <label>Timestamp:</label>
                  <div class="detail-value">${fullDate} (${timeAgo})</div>
                </div>

                <div class="notification-detail-item">
                  <label>ID:</label>
                  <div class="detail-value">${notification.id}</div>
                </div>
              </div>

              <div class="modal-actions">
                ${!notification.read ?
                  `<button onclick="window.sapCopilotController._markAsRead('${notification.id}'); window.sapCopilotController._closeNotificationDetails();" class="modal-btn primary">👁️ Mark as Read</button>` :
                  `<button onclick="window.sapCopilotController._markAsUnread('${notification.id}'); window.sapCopilotController._closeNotificationDetails();" class="modal-btn">👁️‍🗨️ Mark as Unread</button>`
                }

                ${notification.status === 'pending' && notification.actionRequired ?
                  `<button onclick="window.sapCopilotController._acknowledgeNotification('${notification.id}'); window.sapCopilotController._closeNotificationDetails();" class="modal-btn success">✅ Acknowledge</button>` : ''
                }

                <button onclick="window.sapCopilotController._dismissNotification('${notification.id}'); window.sapCopilotController._closeNotificationDetails();" class="modal-btn danger">🗑️ Dismiss</button>

                <button onclick="window.sapCopilotController._closeNotificationDetails()" class="modal-btn">Cancel</button>
              </div>
            </div>
          </div>
        `;

        // Add modal to body
        const modalContainer = document.createElement('div');
        modalContainer.id = 'notificationDetailsModal';
        modalContainer.innerHTML = modalHtml;
        document.body.appendChild(modalContainer);
      },

      /**
       * Close notification details modal
       */
      _closeNotificationDetails: function() {
        const modal = document.getElementById('notificationDetailsModal');
        if (modal) {
          modal.remove();
        }

        const oNotificationModel = this.getView().getModel("notifications");
        oNotificationModel.setProperty("/showDetails", false);
        oNotificationModel.setProperty("/selectedNotification", null);
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
       * Test enhanced notification system
       */
      _testEnhancedNotifications: function() {
        console.log("🧪 Testing enhanced notification system...");

        // Add a test notification to verify the system works
        this._addNotification({
          id: 'test_enhanced_' + Date.now(),
          type: 'info',
          title: '🧪 Enhanced Notification Test',
          message: 'Testing the enhanced notification system with filters and actions',
          details: 'This is a test notification to verify that the enhanced notification system is working properly. You should be able to filter, mark as read/unread, acknowledge, and dismiss this notification.',
          timestamp: new Date().toISOString(),
          priority: 'medium',
          read: false,
          acknowledged: false,
          dismissed: false,
          status: 'pending',
          actionRequired: true,
          category: 'system_test'
        });

        console.log("✅ Test notification added");
      },

      /**
       * Add test notifications for demonstration
       */
      _addTestNotifications: function() {
        // Add some sample notifications to show the enhanced system
        setTimeout(() => {
          this._addNotification({
            id: 'test_1',
            type: 'alert',
            title: '🚨 Critical Alert: Out of Stock',
            message: '3 products are completely out of stock and need immediate attention',
            details: 'Products affected: Wireless Headphones, Smart Watch Pro, Gaming Mouse. These items have zero inventory and should be restocked immediately to avoid lost sales.',
            timestamp: new Date().toISOString(),
            priority: 'high',
            read: false,
            acknowledged: false,
            dismissed: false,
            status: 'pending',
            actionRequired: true,
            category: 'inventory_alert'
          });
        }, 2000);

        setTimeout(() => {
          this._addNotification({
            id: 'test_2',
            type: 'alert',
            title: '⚠️ Alert: Low Stock Warning',
            message: '7 products have stock below 20 units - consider reordering',
            details: 'Products with low stock: Chang (17 units), Aniseed Syrup (13 units), Chef Anton\'s Cajun Seasoning (53 units), and 4 others. Review reorder points and supplier lead times.',
            timestamp: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
            priority: 'medium',
            read: false,
            acknowledged: false,
            dismissed: false,
            status: 'pending',
            actionRequired: true,
            category: 'inventory_warning'
          });
        }, 3000);

        setTimeout(() => {
          this._addNotification({
            id: 'test_3',
            type: 'info',
            title: '📊 System Update',
            message: 'Alert monitoring system is active and checking every 5 minutes',
            details: 'The automated alert system is running normally. Next check scheduled for ' + new Date(Date.now() + 300000).toLocaleTimeString() + '. All monitoring rules are active.',
            timestamp: new Date(Date.now() - 600000).toISOString(), // 10 minutes ago
            priority: 'low',
            read: false,
            acknowledged: false,
            dismissed: false,
            status: 'pending',
            actionRequired: false,
            category: 'system_info'
          });
        }, 4000);

        setTimeout(() => {
          this._addNotification({
            id: 'test_4',
            type: 'success',
            title: '✅ Inventory Update Complete',
            message: 'Successfully updated inventory levels for 15 products',
            details: 'Batch inventory update completed at ' + new Date().toLocaleTimeString() + '. Updated products include beverages, dairy products, and condiments. All stock levels have been verified.',
            timestamp: new Date(Date.now() - 900000).toISOString(), // 15 minutes ago
            priority: 'low',
            read: true,
            acknowledged: true,
            dismissed: false,
            status: 'acknowledged',
            actionRequired: false,
            category: 'system_update'
          });
        }, 5000);
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

        // Clear the search field
        oSearchField.setValue("");

        // Clear all filters
        oBinding.filter([]);
        console.log("🔍 Search cleared - removed all filters");
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
  