const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spotlight", {
  submit: (text) => ipcRenderer.send("spotlight:submit", String(text ?? "").slice(0, 4000)),
  stop: () => ipcRenderer.send("spotlight:stop"),
  openChat: () => ipcRenderer.send("spotlight:open-chat"),
  dismiss: () => ipcRenderer.send("spotlight:dismiss"),
  resize: (height) => ipcRenderer.send("spotlight:resize", Number(height)),
});
