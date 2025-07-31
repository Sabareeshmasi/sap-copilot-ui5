const cds = require('@sap/cds');
const EventEmitter = require('events');

/**
 * Alert Engine for SAP Copilot
 * Monitors business data and triggers alerts based on defined rules
 */
class AlertEngine extends EventEmitter {
  constructor() {
    super();
    this.alertRules = new Map();
    this.alertHistory = [];
    this.isMonitoring = false;
    this.monitoringInterval = null;
    
    // Default alert rules
    this.initializeDefaultRules();
    
    console.log('🚨 Alert Engine initialized');
  }

  /**
   * Initialize default business alert rules
   */
  initializeDefaultRules() {
    // Low stock alert
    this.addAlertRule({
      id: 'low-stock',
      name: 'Low Stock Alert',
      description: 'Alert when product stock falls below threshold',
      type: 'inventory',
      condition: 'stock_below',
      threshold: 20,
      enabled: true,
      priority: 'medium',
      channels: ['in-app']
    });

    // Out of stock alert
    this.addAlertRule({
      id: 'out-of-stock',
      name: 'Out of Stock Alert',
      description: 'Alert when product is completely out of stock',
      type: 'inventory',
      condition: 'stock_equals',
      threshold: 0,
      enabled: true,
      priority: 'high',
      channels: ['in-app']
    });

    // High value inventory alert
    this.addAlertRule({
      id: 'high-value-inventory',
      name: 'High Value Inventory Alert',
      description: 'Alert when total inventory value exceeds threshold',
      type: 'business',
      condition: 'inventory_value_above',
      threshold: 50000,
      enabled: true,
      priority: 'low',
      channels: ['in-app']
    });

    // Low inventory value alert
    this.addAlertRule({
      id: 'low-inventory-value',
      name: 'Low Inventory Value Alert',
      description: 'Alert when total inventory value drops below threshold',
      type: 'business',
      condition: 'inventory_value_below',
      threshold: 10000,
      enabled: true,
      priority: 'medium',
      channels: ['in-app']
    });

    console.log(`✅ Initialized ${this.alertRules.size} default alert rules`);
  }

  /**
   * Add a new alert rule
   */
  addAlertRule(rule) {
    const alertRule = {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      type: rule.type,
      condition: rule.condition,
      threshold: rule.threshold,
      enabled: rule.enabled !== false,
      priority: rule.priority || 'medium',
      channels: rule.channels || ['in-app'],
      createdAt: new Date().toISOString(),
      lastTriggered: null,
      triggerCount: 0
    };

    this.alertRules.set(rule.id, alertRule);
    console.log(`📋 Added alert rule: ${rule.name}`);
    return alertRule;
  }

  /**
   * Remove an alert rule
   */
  removeAlertRule(ruleId) {
    if (this.alertRules.has(ruleId)) {
      const rule = this.alertRules.get(ruleId);
      this.alertRules.delete(ruleId);
      console.log(`🗑️ Removed alert rule: ${rule.name}`);
      return true;
    }
    return false;
  }

  /**
   * Enable/disable an alert rule
   */
  toggleAlertRule(ruleId, enabled) {
    if (this.alertRules.has(ruleId)) {
      const rule = this.alertRules.get(ruleId);
      rule.enabled = enabled;
      console.log(`${enabled ? '✅' : '❌'} ${enabled ? 'Enabled' : 'Disabled'} alert rule: ${rule.name}`);
      return rule;
    }
    return null;
  }

  /**
   * Get all alert rules
   */
  getAllAlertRules() {
    return Array.from(this.alertRules.values());
  }

  /**
   * Start monitoring business data
   */
  startMonitoring(intervalMinutes = 5) {
    if (this.isMonitoring) {
      console.log('⚠️ Alert monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    const intervalMs = intervalMinutes * 60 * 1000;

    console.log(`🔍 Starting alert monitoring (checking every ${intervalMinutes} minutes)`);

    // Run initial check
    this.checkAllAlerts();

    // Set up periodic monitoring
    this.monitoringInterval = setInterval(() => {
      this.checkAllAlerts();
    }, intervalMs);

    this.emit('monitoring-started', { intervalMinutes });
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      console.log('⚠️ Alert monitoring is not running');
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    console.log('🛑 Alert monitoring stopped');
    this.emit('monitoring-stopped');
  }

  /**
   * Check all enabled alert rules
   */
  async checkAllAlerts() {
    try {
      console.log('🔍 Checking all alert rules...');
      
      const enabledRules = Array.from(this.alertRules.values()).filter(rule => rule.enabled);
      
      for (const rule of enabledRules) {
        await this.checkAlertRule(rule);
      }
      
      console.log(`✅ Completed checking ${enabledRules.length} alert rules`);
    } catch (error) {
      console.error('❌ Error checking alerts:', error);
    }
  }

  /**
   * Check a specific alert rule
   */
  async checkAlertRule(rule) {
    try {
      const db = await cds.connect.to('db');
      let shouldTrigger = false;
      let alertData = {};

      switch (rule.condition) {
        case 'stock_below':
          const lowStockProducts = await this.checkLowStock(db, rule.threshold);
          if (lowStockProducts.length > 0) {
            shouldTrigger = true;
            alertData = {
              products: lowStockProducts,
              count: lowStockProducts.length,
              threshold: rule.threshold
            };
          }
          break;

        case 'stock_equals':
          const outOfStockProducts = await this.checkOutOfStock(db);
          if (outOfStockProducts.length > 0) {
            shouldTrigger = true;
            alertData = {
              products: outOfStockProducts,
              count: outOfStockProducts.length
            };
          }
          break;

        case 'inventory_value_above':
        case 'inventory_value_below':
          const inventoryValue = await this.calculateInventoryValue(db);
          const isAbove = rule.condition === 'inventory_value_above';
          shouldTrigger = isAbove ? 
            inventoryValue > rule.threshold : 
            inventoryValue < rule.threshold;
          
          if (shouldTrigger) {
            alertData = {
              currentValue: inventoryValue,
              threshold: rule.threshold,
              difference: Math.abs(inventoryValue - rule.threshold)
            };
          }
          break;
      }

      if (shouldTrigger) {
        this.triggerAlert(rule, alertData);
      }

    } catch (error) {
      console.error(`❌ Error checking rule ${rule.id}:`, error);
    }
  }

  /**
   * Check for low stock products
   */
  async checkLowStock(db, threshold) {
    const { Products } = db.entities;
    const products = await db.run(
      SELECT.from(Products).where({ UnitsInStock: { '<': threshold, '>': 0 } })
    );
    return products;
  }

  /**
   * Check for out of stock products
   */
  async checkOutOfStock(db) {
    const { Products } = db.entities;
    const products = await db.run(
      SELECT.from(Products).where({ UnitsInStock: 0 })
    );
    return products;
  }

  /**
   * Calculate total inventory value
   */
  async calculateInventoryValue(db) {
    const { Products } = db.entities;
    const products = await db.run(SELECT.from(Products));
    return products.reduce((total, product) => {
      return total + (product.UnitPrice * product.UnitsInStock);
    }, 0);
  }

  /**
   * Trigger an alert
   */
  triggerAlert(rule, data) {
    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      type: rule.type,
      priority: rule.priority,
      message: this.generateAlertMessage(rule, data),
      data: data,
      channels: rule.channels,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      resolvedAt: null
    };

    // Update rule statistics
    rule.lastTriggered = alert.timestamp;
    rule.triggerCount++;

    // Store in history
    this.alertHistory.unshift(alert);
    
    // Keep only last 100 alerts
    if (this.alertHistory.length > 100) {
      this.alertHistory = this.alertHistory.slice(0, 100);
    }

    console.log(`🚨 ALERT TRIGGERED: ${alert.message}`);

    // Emit alert event
    this.emit('alert-triggered', alert);

    return alert;
  }

  /**
   * Generate human-readable alert message
   */
  generateAlertMessage(rule, data) {
    switch (rule.condition) {
      case 'stock_below':
        return `${data.count} product(s) have stock below ${data.threshold} units`;
      
      case 'stock_equals':
        return `${data.count} product(s) are out of stock`;
      
      case 'inventory_value_above':
        return `Inventory value ($${data.currentValue.toFixed(2)}) exceeds threshold ($${data.threshold})`;
      
      case 'inventory_value_below':
        return `Inventory value ($${data.currentValue.toFixed(2)}) below threshold ($${data.threshold})`;
      
      default:
        return `Alert triggered for rule: ${rule.name}`;
    }
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit = 50) {
    return this.alertHistory.slice(0, limit);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId) {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
      console.log(`✅ Alert acknowledged: ${alert.message}`);
      this.emit('alert-acknowledged', alert);
      return alert;
    }
    return null;
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      totalRules: this.alertRules.size,
      enabledRules: Array.from(this.alertRules.values()).filter(r => r.enabled).length,
      totalAlerts: this.alertHistory.length,
      unacknowledgedAlerts: this.alertHistory.filter(a => !a.acknowledged).length,
      lastCheck: this.lastCheckTime || null
    };
  }
}

module.exports = AlertEngine;
