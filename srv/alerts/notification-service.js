const nodemailer = require('nodemailer');
const EventEmitter = require('events');

/**
 * Notification Service for SAP Copilot
 * Handles multi-channel notifications (email, SMS, in-app)
 */
class NotificationService extends EventEmitter {
  constructor() {
    super();
    this.emailTransporter = null;
    this.smsClient = null;
    this.inAppNotifications = [];
    this.notificationHistory = [];
    
    this.initializeEmailService();
    this.initializeSMSService();
    
    console.log('📧 Notification Service initialized');
  }

  /**
   * Initialize email service
   */
  initializeEmailService() {
    try {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
        console.log('⚠️ Email service disabled (credentials not configured)');
        this.emailTransporter = null;
        return;
      }

      // Configure email transporter (using Gmail as example)
      this.emailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD
        }
      });

      console.log('✅ Email service configured for:', process.env.EMAIL_USER);
      console.log('💡 Note: For Gmail, use App Password instead of regular password');
    } catch (error) {
      console.error('❌ Error initializing email service:', error.message);
      this.emailTransporter = null;
    }
  }

  /**
   * Initialize SMS service
   */
  initializeSMSService() {
    try {
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        const twilio = require('twilio');
        this.smsClient = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
        console.log('✅ SMS service configured');
      } else {
        console.log('⚠️ SMS service not configured (Twilio credentials not set)');
      }
    } catch (error) {
      console.error('❌ Error initializing SMS service:', error.message);
    }
  }

  /**
   * Send notification through multiple channels
   */
  async sendNotification(alert, recipients = {}) {
    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      alertId: alert.id,
      alert: alert,
      recipients: recipients,
      channels: alert.channels || ['in-app'],
      sentAt: new Date().toISOString(),
      status: {},
      attempts: 0
    };

    console.log(`📤 Sending notification for alert: ${alert.message}`);

    // Send through each configured channel
    for (const channel of notification.channels) {
      try {
        switch (channel) {
          case 'in-app':
            await this.sendInAppNotification(alert, notification);
            break;
          case 'email':
            await this.sendEmailNotification(alert, recipients.email, notification);
            break;
          case 'sms':
            await this.sendSMSNotification(alert, recipients.phone, notification);
            break;
          default:
            console.warn(`⚠️ Unknown notification channel: ${channel}`);
        }
      } catch (error) {
        console.error(`❌ Error sending ${channel} notification:`, error.message);
        notification.status[channel] = { success: false, error: error.message };
      }
    }

    // Store notification history
    this.notificationHistory.unshift(notification);
    if (this.notificationHistory.length > 200) {
      this.notificationHistory = this.notificationHistory.slice(0, 200);
    }

    this.emit('notification-sent', notification);
    return notification;
  }

  /**
   * Send in-app notification
   */
  async sendInAppNotification(alert, notification) {
    const inAppNotif = {
      id: notification.id,
      type: 'alert',
      priority: alert.priority,
      title: this.getNotificationTitle(alert),
      message: alert.message,
      data: alert.data,
      timestamp: new Date().toISOString(),
      read: false,
      dismissed: false
    };

    this.inAppNotifications.unshift(inAppNotif);
    
    // Keep only last 50 in-app notifications
    if (this.inAppNotifications.length > 50) {
      this.inAppNotifications = this.inAppNotifications.slice(0, 50);
    }

    notification.status['in-app'] = { success: true, id: inAppNotif.id };
    
    // Emit real-time notification event
    this.emit('in-app-notification', inAppNotif);
    
    console.log(`📱 In-app notification sent: ${inAppNotif.title}`);
  }

  /**
   * Send email notification
   */
  async sendEmailNotification(alert, emailRecipients, notification) {
    if (!this.emailTransporter) {
      console.log('📧 Email service not available - skipping email notification');
      notification.status['email'] = {
        success: false,
        error: 'Email service not configured'
      };
      return;
    }

    if (!emailRecipients) {
      console.log('📧 No email recipients configured - skipping email notification');
      notification.status['email'] = {
        success: false,
        error: 'No recipients configured'
      };
      return;
    }

    try {
      const recipients = Array.isArray(emailRecipients) ? emailRecipients : [emailRecipients];

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: recipients.join(', '),
        subject: `SAP Copilot Alert: ${this.getNotificationTitle(alert)}`,
        html: this.generateEmailHTML(alert)
      };

      const result = await this.emailTransporter.sendMail(mailOptions);

      notification.status['email'] = {
        success: true,
        messageId: result.messageId,
        recipients: recipients
      };

      console.log(`📧 Email notification sent to: ${recipients.join(', ')}`);
    } catch (error) {
      console.log(`📧 Email notification failed (continuing with other channels): ${error.message}`);
      notification.status['email'] = {
        success: false,
        error: error.message
      };

      // If authentication fails, disable email service
      if (error.message.includes('Invalid login') || error.message.includes('BadCredentials')) {
        console.log('🔒 Gmail authentication failed - disabling email service');
        console.log('💡 To fix: Use Gmail App Password instead of regular password');
        this.emailTransporter = null;
      }
    }
  }

  /**
   * Send SMS notification
   */
  async sendSMSNotification(alert, phoneRecipients, notification) {
    if (!this.smsClient || !phoneRecipients) {
      throw new Error('SMS service not configured or no recipients');
    }

    const recipients = Array.isArray(phoneRecipients) ? phoneRecipients : [phoneRecipients];
    const message = `SAP Copilot Alert: ${alert.message}`;
    
    const results = [];
    for (const phone of recipients) {
      const result = await this.smsClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone
      });
      results.push({ phone, sid: result.sid });
    }

    notification.status['sms'] = { 
      success: true, 
      results: results 
    };
    
    console.log(`📱 SMS notification sent to: ${recipients.join(', ')}`);
  }

  /**
   * Generate notification title based on alert
   */
  getNotificationTitle(alert) {
    switch (alert.priority) {
      case 'high':
        return `🚨 Critical Alert: ${alert.ruleName}`;
      case 'medium':
        return `⚠️ Alert: ${alert.ruleName}`;
      case 'low':
        return `ℹ️ Notice: ${alert.ruleName}`;
      default:
        return `📢 ${alert.ruleName}`;
    }
  }

  /**
   * Generate HTML email content
   */
  generateEmailHTML(alert) {
    const priorityColors = {
      high: '#dc3545',
      medium: '#fd7e14',
      low: '#17a2b8'
    };

    const priorityIcons = {
      high: '🚨',
      medium: '⚠️',
      low: 'ℹ️'
    };

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { background: ${priorityColors[alert.priority] || '#007bff'}; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px; }
          .alert-info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .footer { background: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #666; }
          .priority-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
          .data-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          .data-table th, .data-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          .data-table th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${priorityIcons[alert.priority]} SAP Copilot Alert</h1>
            <p style="margin: 0; opacity: 0.9;">${alert.ruleName}</p>
          </div>
          
          <div class="content">
            <div class="alert-info">
              <h3>Alert Details</h3>
              <p><strong>Message:</strong> ${alert.message}</p>
              <p><strong>Priority:</strong> 
                <span class="priority-badge" style="background: ${priorityColors[alert.priority]}; color: white;">
                  ${alert.priority.toUpperCase()}
                </span>
              </p>
              <p><strong>Triggered:</strong> ${new Date(alert.timestamp).toLocaleString()}</p>
              <p><strong>Rule:</strong> ${alert.ruleName}</p>
            </div>

            ${this.generateAlertDataHTML(alert)}

            <div style="margin-top: 30px; padding: 15px; background: #e3f2fd; border-radius: 5px;">
              <h4 style="margin-top: 0;">📋 Recommended Actions</h4>
              ${this.generateRecommendations(alert)}
            </div>
          </div>
          
          <div class="footer">
            <p>This alert was generated by SAP Copilot Alert System</p>
            <p>Timestamp: ${new Date().toLocaleString()}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate HTML for alert data
   */
  generateAlertDataHTML(alert) {
    if (!alert.data) return '';

    let html = '<div class="alert-info"><h4>📊 Alert Data</h4>';

    if (alert.data.products && alert.data.products.length > 0) {
      html += `
        <table class="data-table">
          <thead>
            <tr>
              <th>Product ID</th>
              <th>Product Name</th>
              <th>Current Stock</th>
              <th>Unit Price</th>
            </tr>
          </thead>
          <tbody>
      `;
      
      alert.data.products.slice(0, 10).forEach(product => {
        html += `
          <tr>
            <td>${product.ID}</td>
            <td>${product.ProductName}</td>
            <td>${product.UnitsInStock}</td>
            <td>$${product.UnitPrice}</td>
          </tr>
        `;
      });
      
      html += '</tbody></table>';
      
      if (alert.data.products.length > 10) {
        html += `<p><em>... and ${alert.data.products.length - 10} more products</em></p>`;
      }
    }

    if (alert.data.currentValue !== undefined) {
      html += `
        <p><strong>Current Value:</strong> $${alert.data.currentValue.toFixed(2)}</p>
        <p><strong>Threshold:</strong> $${alert.data.threshold}</p>
        <p><strong>Difference:</strong> $${alert.data.difference.toFixed(2)}</p>
      `;
    }

    html += '</div>';
    return html;
  }

  /**
   * Generate recommendations based on alert type
   */
  generateRecommendations(alert) {
    switch (alert.ruleId) {
      case 'low-stock':
        return `
          <ul>
            <li>Review supplier lead times and reorder points</li>
            <li>Consider increasing safety stock levels</li>
            <li>Contact suppliers to expedite orders if needed</li>
            <li>Analyze sales trends to adjust forecasting</li>
          </ul>
        `;
      case 'out-of-stock':
        return `
          <ul>
            <li><strong>Immediate action required:</strong> Contact suppliers urgently</li>
            <li>Check for alternative suppliers or substitute products</li>
            <li>Notify sales team to manage customer expectations</li>
            <li>Review demand forecasting accuracy</li>
          </ul>
        `;
      case 'low-inventory-value':
        return `
          <ul>
            <li>Review inventory turnover rates</li>
            <li>Consider promotional activities to move slow-moving stock</li>
            <li>Analyze market demand and adjust purchasing strategy</li>
            <li>Evaluate supplier terms and pricing</li>
          </ul>
        `;
      default:
        return `
          <ul>
            <li>Review the alert details and take appropriate action</li>
            <li>Monitor related metrics for trends</li>
            <li>Update alert thresholds if necessary</li>
          </ul>
        `;
    }
  }

  /**
   * Get in-app notifications
   */
  getInAppNotifications(limit = 20, unreadOnly = false) {
    let notifications = this.inAppNotifications;
    
    if (unreadOnly) {
      notifications = notifications.filter(n => !n.read);
    }
    
    return notifications.slice(0, limit);
  }

  /**
   * Mark notification as read
   */
  markAsRead(notificationId) {
    const notification = this.inAppNotifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      notification.readAt = new Date().toISOString();
      this.emit('notification-read', notification);
      return notification;
    }
    return null;
  }

  /**
   * Dismiss notification
   */
  dismissNotification(notificationId) {
    const notification = this.inAppNotifications.find(n => n.id === notificationId);
    if (notification) {
      notification.dismissed = true;
      notification.dismissedAt = new Date().toISOString();
      this.emit('notification-dismissed', notification);
      return notification;
    }
    return null;
  }

  /**
   * Get notification statistics
   */
  getStats() {
    const total = this.notificationHistory.length;
    const inApp = this.inAppNotifications.length;
    const unread = this.inAppNotifications.filter(n => !n.read).length;
    
    return {
      total: total,
      inApp: inApp,
      unread: unread,
      channels: {
        'in-app': this.notificationHistory.filter(n => n.status['in-app']?.success).length,
        'email': this.notificationHistory.filter(n => n.status['email']?.success).length,
        'sms': this.notificationHistory.filter(n => n.status['sms']?.success).length
      }
    };
  }
}

module.exports = NotificationService;
