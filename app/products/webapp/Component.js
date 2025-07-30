sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "sap/copilot/products/model/models"
  ], function (UIComponent, Device, models) {
    "use strict";
  
    return UIComponent.extend("sap.copilot.products.Component", {
  
      metadata: {
        manifest: "json"
      },
  
      init: function () {
        UIComponent.prototype.init.apply(this, arguments);
  
        this.setModel(models.createDeviceModel(), "device");
  
        // Initialize the router
        this.getRouter().initialize();
      }
    });
  });
  