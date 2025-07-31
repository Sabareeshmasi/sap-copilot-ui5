const AlertEngine = require('./alert-engine');
const NotificationService = require('./notification-service');
const EventEmitter = require('events');

/**
 * Alert Manager - Orchestrates alerts and notifications
 * Integrates AlertEngine and NotificationService
 */
class AlertManager extends EventEmitter {
  constructor() {
    super();
    
    this.alertEngine = new AlertEngine();
    this.notificationService = new NotificationService();
    this.isInitialized = false;
    
    // Default notification recipients
    this.defaultRecipients = {
      email: process.env.ALERT_EMAIL_RECIPIENTS ? 
        process.env.ALERT_EMAIL_RECIPIENTS.split(',') : [],
      phone: process.env.ALERT_PHONE_RECIPIENTS ? 
        process.env.ALERT_PHONE_RECIPIENTS.split(',') : []
    };
    
    this.setupEventHandlers();
    console.log('🎛️ Alert Manager initialized');
  }

  /**
   * Setup event handlers between components
   */
  setupEventHandlers() {
    // Handle alerts from engine
    this.alertEngine.on('alert-triggered', async (alert) => {
      await this.handleTriggeredAlert(alert);
    });

    // Handle monitoring events
    this.alertEngine.on('monitoring-started', (data) => {
      console.log(`🔍 Alert monitoring started (${data.intervalMinutes} min intervals)`);
      this.emit('monitoring-started', data);
    });

    this.alertEngine.on('monitoring-stopped', () => {
      console.log('🛑 Alert monitoring stopped');
      this.emit('monitoring-stopped');
    });

    // Handle notification events
    this.notificationService.on('notification-sent', (notification) => {
      this.emit('notification-sent', notification);
    });

    this.notificationService.on('in-app-notification', (notification) => {
      this.emit('in-app-notification', notification);
    });
  }

  /**
   * Initialize the alert system
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('⚠️ Alert Manager already initialized');
      return;
    }

    try {
      // Start monitoring with default interval (5 minutes)
      this.alertEngine.startMonitoring(5);
      
      this.isInitialized = true;
      console.log('✅ Alert Manager fully initialized and monitoring started');
      
      this.emit('initialized');
    } catch (error) {
      console.error('❌ Error initializing Alert Manager:', error);
      throw error;
    }
  }

  /**
   * Handle triggered alert
   */
  async handleTriggeredAlert(alert) {
    try {
      console.log(`🚨 Processing triggered alert: ${alert.message}`);
      
      // Determine recipients based on alert priority and type
      const recipients = this.getRecipientsForAlert(alert);
      
      // Send notifications
      await this.notificationService.sendNotification(alert, recipients);
      
      // Emit event for real-time updates
      this.emit('alert-processed', alert);
      
    } catch (error) {
      console.error('❌ Error handling triggered alert:', error);
    }
  }

  /**
   * Get appropriate recipients for an alert
   */
  getRecipientsForAlert(alert) {
    const recipients = { ...this.defaultRecipients };
    
    // Customize recipients based on alert priority
    switch (alert.priority) {
      case 'high':
        // High priority alerts go to all channels
        break;
      case 'medium':
        // Medium priority alerts skip SMS unless critical
        if (alert.type !== 'inventory' || !alert.data.products?.some(p => p.UnitsInStock === 0)) {
          recipients.phone = [];
        }
        break;
      case 'low':
        // Low priority alerts only go to in-app and email
        recipients.phone = [];
        break;
    }
    
    return recipients;
  }

  /**
   * Create custom alert rule via natural language
   */
  async createAlertFromNaturalLanguage(prompt) {
    try {
      console.log(`🧠 Creating alert rule from: "${prompt}"`);
      
      // Parse natural language to extract alert parameters
      const alertRule = this.parseAlertPrompt(prompt);
      
      if (!alertRule.success) {
        return {
          success: false,
          message: alertRule.error || "Could not understand the alert request",
          suggestions: [
            "Notify when product stock below 10",
            "Alert if inventory value exceeds 50000",
            "Notify manager if product 5 stock less than 20"
          ]
        };
      }
      
      // Add the rule to the engine
      const rule = this.alertEngine.addAlertRule(alertRule.rule);
      
      return {
        success: true,
        message: `✅ Alert rule created: "${rule.name}"`,
        rule: rule,
        description: `Will monitor ${alertRule.description}`
      };
      
    } catch (error) {
      console.error('❌ Error creating alert from natural language:', error);
      return {
        success: false,
        message: `Error creating alert: ${error.message}`
      };
    }
  }

  /**
   * Parse natural language alert prompt
   */
  parseAlertPrompt(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    
    // Pattern: "notify when/if [entity] [condition] [threshold]"
    // Examples:
    // - "notify when product stock below 10"
    // - "alert if inventory value exceeds 50000"
    // - "notify manager if product 5 stock less than 20"
    
    try {
      // Extract threshold number
      const numberMatch = prompt.match(/(\d+(?:\.\d+)?)/);
      if (!numberMatch) {
        return { success: false, error: "No threshold number found" };
      }
      const threshold = parseFloat(numberMatch[1]);
      
      // Extract product ID if specified
      const productIdMatch = prompt.match(/product\s+(\d+)/i);
      const productId = productIdMatch ? parseInt(productIdMatch[1]) : null;
      
      // Determine condition type
      let condition = 'stock_below'; // default
      let type = 'inventory';
      let name = 'Custom Alert';
      let description = '';
      
      if (lowerPrompt.includes('below') || lowerPrompt.includes('less than') || lowerPrompt.includes('under')) {
        if (lowerPrompt.includes('stock')) {
          condition = 'stock_below';
          name = productId ? `Product ${productId} Low Stock Alert` : 'Low Stock Alert';
          description = `stock levels below ${threshold} units`;
        } else if (lowerPrompt.includes('value') || lowerPrompt.includes('inventory')) {
          condition = 'inventory_value_below';
          type = 'business';
          name = 'Low Inventory Value Alert';
          description = `inventory value below $${threshold}`;
        }
      } else if (lowerPrompt.includes('above') || lowerPrompt.includes('exceeds') || lowerPrompt.includes('over')) {
        if (lowerPrompt.includes('value') || lowerPrompt.includes('inventory')) {
          condition = 'inventory_value_above';
          type = 'business';
          name = 'High Inventory Value Alert';
          description = `inventory value above $${threshold}`;
        }
      } else if (lowerPrompt.includes('equals') || lowerPrompt.includes('is 0') || lowerPrompt.includes('out of stock')) {
        condition = 'stock_equals';
        name = 'Out of Stock Alert';
        description = 'products that are out of stock';
      }
      
      // Determine priority
      let priority = 'medium';
      if (lowerPrompt.includes('critical') || lowerPrompt.includes('urgent') || threshold <= 5) {
        priority = 'high';
      } else if (lowerPrompt.includes('low priority') || threshold >= 100) {
        priority = 'low';
      }
      
      // Determine channels
      let channels = ['in-app'];
      if (lowerPrompt.includes('email') || lowerPrompt.includes('notify manager')) {
        channels.push('email');
      }
      if (lowerPrompt.includes('sms') || lowerPrompt.includes('text') || priority === 'high') {
        channels.push('sms');
      }
      
      const rule = {
        id: `custom_${Date.now()}`,
        name: name,
        description: `Custom alert: ${description}`,
        type: type,
        condition: condition,
        threshold: threshold,
        enabled: true,
        priority: priority,
        channels: channels,
        productId: productId // For product-specific alerts
      };
      
      return {
        success: true,
        rule: rule,
        description: description
      };
      
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse alert request: ${error.message}`
      };
    }
  }

  /**
   * Get system status and statistics
   */
  getSystemStatus() {
    const alertEngineStatus = this.alertEngine.getStatus();
    const notificationStats = this.notificationService.getStats();
    
    return {
      initialized: this.isInitialized,
      monitoring: alertEngineStatus.isMonitoring,
      alertEngine: alertEngineStatus,
      notifications: notificationStats,
      recipients: {
        email: this.defaultRecipients.email.length,
        phone: this.defaultRecipients.phone.length
      }
    };
  }

  /**
   * Get recent alerts and notifications
   */
  getRecentActivity(limit = 10) {
    const alerts = this.alertEngine.getAlertHistory(limit);
    const notifications = this.notificationService.getInAppNotifications(limit);
    
    return {
      alerts: alerts,
      notifications: notifications,
      summary: {
        totalAlerts: alerts.length,
        unacknowledgedAlerts: alerts.filter(a => !a.acknowledged).length,
        unreadNotifications: notifications.filter(n => !n.read).length
      }
    };
  }

  /**
   * Manual alert check (for testing or immediate checking)
   */
  async checkAlertsNow() {
    console.log('🔍 Manual alert check triggered');
    await this.alertEngine.checkAllAlerts();
    return { success: true, message: 'Alert check completed' };
  }

  /**
   * Get all alert rules
   */
  getAllAlertRules() {
    return this.alertEngine.getAllAlertRules();
  }

  /**
   * Toggle alert rule
   */
  toggleAlertRule(ruleId, enabled) {
    return this.alertEngine.toggleAlertRule(ruleId, enabled);
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId) {
    return this.alertEngine.removeAlertRule(ruleId);
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId) {
    return this.alertEngine.acknowledgeAlert(alertId);
  }

  /**
   * Mark notification as read
   */
  markNotificationAsRead(notificationId) {
    return this.notificationService.markAsRead(notificationId);
  }

  /**
   * Dismiss notification
   */
  dismissNotification(notificationId) {
    return this.notificationService.dismissNotification(notificationId);
  }

  /**
   * Stop monitoring (for shutdown)
   */
  shutdown() {
    console.log('🛑 Shutting down Alert Manager');
    this.alertEngine.stopMonitoring();
    this.isInitialized = false;
  }
}

module.exports = AlertManager;
