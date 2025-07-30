sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel"
  ], function (Controller, Filter, FilterOperator, JSONModel) {
    "use strict";
  
    return Controller.extend("sap.copilot.products.controller.View1", {
  
      onInit: function () {
        // Initialize chat model
        const oChatModel = new JSONModel({ messages: [] });
        this.getView().setModel(oChatModel, "chat");
        this._bChatVisible = false;
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
  
        if (!this._bChatVisible) {
          const html = `
            <div class="chat-shell" id="copilotShell">
              <div class="chat-box" id="chatMessages"></div>
              <div class="chat-input">
                <input type="text" id="chatInputField" placeholder="Ask Gemini..." style="flex:1; padding:5px;" />
                <button onclick="submitChat()" style="padding:5px;">Send</button>
              </div>
            </div>
            <script>
              function submitChat() {
                const input = document.getElementById("chatInputField");
                const text = input.value.trim();
                if (text) {
                  const msgBox = document.getElementById("chatMessages");
                  msgBox.innerHTML += '<div class="chat-message"><span class="sender">You:</span> ' + text + '</div>';
                  msgBox.innerHTML += '<div class="chat-message"><span class="sender">Gemini:</span> Thinking...</div>';
                  input.value = "";
                  msgBox.scrollTop = msgBox.scrollHeight;
                }
              }
            </script>
          `;
          oHTMLContainer.setContent(html);
          this._bChatVisible = true;
        } else {
          oHTMLContainer.setContent("");
          this._bChatVisible = false;
        }
      }
    });
  });
  