// preload.js
const { contextBridge, ipcRenderer } = require("electron");
const { initTPVBootstrap } = require("./js/tpv/bootstrap.js");

contextBridge.exposeInMainWorld("TPV_PRINT", {
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  printTicket: ({ html, deviceName }) =>
    ipcRenderer.invoke("ticket:print", { html, deviceName }),
  printRaw: ({ bytes, deviceName }) =>
    ipcRenderer.invoke("ticket:printRaw", { bytes, deviceName }),
  openCashDrawer: async (deviceName) => {
    return await ipcRenderer.invoke("tpv:openCashDrawer", { deviceName });
  },
});

contextBridge.exposeInMainWorld("TPV_APP", {
  getGuards: () => ipcRenderer.invoke("tpv:getGuards"),
  attemptQuit: () => ipcRenderer.invoke("tpv:attemptQuit"),
  setKioskMode: (enabled) => ipcRenderer.invoke("ui:setKioskMode", !!enabled),
  setCurrentUser: (payload) =>
    ipcRenderer.invoke("auth:setCurrentUser", payload),
});

contextBridge.exposeInMainWorld("TPV_UI", {
  onGuard: (cb) => ipcRenderer.on("tpv:guard", (_e, payload) => cb(payload)),
});

contextBridge.exposeInMainWorld("TPV_UI_MODE", {
  setKioskMode: (enabled) => ipcRenderer.invoke("ui:setKioskMode", enabled),
});

contextBridge.exposeInMainWorld("TPV_QUEUE", {
  enqueue: (item) => ipcRenderer.invoke("queue:enqueue", item),
  count: () => ipcRenderer.invoke("queue:count"),
  next: () => ipcRenderer.invoke("queue:next"),
  done: (id, remote) => ipcRenderer.invoke("queue:done", { id, remote }),
  error: (id, error) => ipcRenderer.invoke("queue:error", { id, error }),
  list: () => ipcRenderer.invoke("queue:list"), // ✅ NUEVO
});

contextBridge.exposeInMainWorld("TPV_SYS", {
  quit: () => ipcRenderer.invoke("app:quit"),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
});

contextBridge.exposeInMainWorld("TPV_SETUP", {
  setupPosPrinter: (printerName) =>
    ipcRenderer.invoke("setup:posPrinter", { printerName }),
  testPosPrinter: (queueName) =>
    ipcRenderer.invoke("setup:testPosPrinter", { queueName }),
});

contextBridge.exposeInMainWorld("TPV_ENV", {
  platform: process.platform, // "linux" / "win32"
});

contextBridge.exposeInMainWorld("TPV_CFG", {
  get: (key) => ipcRenderer.invoke("cfg:get", key),
  set: (key, value) => ipcRenderer.invoke("cfg:set", key, value),
});

contextBridge.exposeInMainWorld("TPV_AUTH", {
  setCurrentUser: (user, isAdmin) =>
    ipcRenderer.invoke("auth:setCurrentUser", { user, isAdmin }),
});

contextBridge.exposeInMainWorld("TPV_BOOTSTRAP", {
  init: (payload) => {
    try {
      console.log("[BOOT payload]", {
        nick: payload?.nick,
        apiKeyLen: String(payload?.apiKey || "").length,
        baseUrl: payload?.baseUrl,
        idtpv: payload?.idtpv,
      });
    } catch {}
    return initTPVBootstrap(payload);
  },
});

contextBridge.exposeInMainWorld("TPV_AUTOSTART", {
  get: () => ipcRenderer.invoke("cfg:getAutostart"),
  set: (val) => ipcRenderer.invoke("cfg:setAutostart", !!val),
});

contextBridge.exposeInMainWorld("TPV_CUSTOMER", {
  setState: (state) => ipcRenderer.send("customer:setState", state),
});

contextBridge.exposeInMainWorld("TPV_CUSTOMER_CTRL", {
  getEnabled: () => ipcRenderer.invoke("customer:getEnabled"),
  setEnabled: (val) => ipcRenderer.invoke("customer:setEnabled", !!val),
});