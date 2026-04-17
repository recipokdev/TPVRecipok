const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("TPV_CUSTOMER_IPC", {
  onState: (cb) => ipcRenderer.on("customer:state", (_e, state) => cb(state)),
  onTheme: (cb) => ipcRenderer.on("customer:theme", (_e, mode) => cb(mode)),
});
