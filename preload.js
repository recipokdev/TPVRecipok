// preload.js
const { contextBridge, ipcRenderer, clipboard } = require("electron");
const { initTPVBootstrap } = require("./js/tpv/bootstrap.js");

const TPV_E2E_MODE = String(process.env.TPV_E2E || "") === "1";
const TPV_MODE = String(process.env.TPV_MODE || "")
  .trim()
  .toLowerCase();
const tpvE2EPrintJobs = [];

function pushE2EPrintJob(job) {
  tpvE2EPrintJobs.push({
    at: Date.now(),
    ...job,
  });
}

function safeRawPreview(bytes) {
  try {
    if (Array.isArray(bytes)) return Buffer.from(bytes).toString("utf8");
    if (Buffer.isBuffer(bytes)) return bytes.toString("utf8");
    return String(bytes || "");
  } catch {
    return "";
  }
}

contextBridge.exposeInMainWorld("TPV_PRINT", {
  listPrinters: () => {
    if (TPV_E2E_MODE) {
      return [{ name: "E2E Mock Printer", isDefault: true }];
    }
    return ipcRenderer.invoke("printers:list");
  },
  printTicket: ({ html, deviceName }) => {
    if (TPV_E2E_MODE) {
      pushE2EPrintJob({
        type: "ticket",
        deviceName: deviceName || "E2E Mock Printer",
        payload: { html: String(html || "") },
      });
      return Promise.resolve({ ok: true, mocked: true, e2e: true });
    }
    return ipcRenderer.invoke("ticket:print", { html, deviceName });
  },
  printRaw: ({ bytes, deviceName }) => {
    if (TPV_E2E_MODE) {
      pushE2EPrintJob({
        type: "raw",
        deviceName: deviceName || "E2E Mock Printer",
        payload: {
          bytesLength: Array.isArray(bytes)
            ? bytes.length
            : Buffer.isBuffer(bytes)
              ? bytes.length
              : 0,
          previewText: safeRawPreview(bytes),
        },
      });
      return Promise.resolve({ ok: true, mocked: true, e2e: true });
    }
    return ipcRenderer.invoke("ticket:printRaw", { bytes, deviceName });
  },
  openCashDrawer: async (deviceName) => {
    if (TPV_E2E_MODE) {
      return { ok: true, mocked: true, e2e: true, deviceName };
    }
    return await ipcRenderer.invoke("tpv:openCashDrawer", { deviceName });
  },
});

contextBridge.exposeInMainWorld("TPV_APP", {
  getGuards: () => ipcRenderer.invoke("tpv:getGuards"),
  attemptQuit: () => ipcRenderer.invoke("tpv:attemptQuit"),
  emergencyRestart: () => ipcRenderer.invoke("tpv:emergencyRestart"),
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

contextBridge.exposeInMainWorld("TPV_UPDATER", {
  checkNow: () => ipcRenderer.invoke("updater:checkManual"),
  relaunchForUpdate: () => ipcRenderer.invoke("updater:relaunchForUpdate"),
  getStartupNoInternetFlag: () =>
    ipcRenderer.invoke("updater:getStartupNoInternetFlag"),
});

contextBridge.exposeInMainWorld("TPV_SETUP", {
  setupPosPrinter: (printerName) =>
    ipcRenderer.invoke("setup:posPrinter", { printerName }),
  testPosPrinter: (queueName) =>
    ipcRenderer.invoke("setup:testPosPrinter", { queueName }),
});

contextBridge.exposeInMainWorld("TPV_ENV", {
  platform: process.platform, // "linux" / "win32"
  defaultApp: !!process.defaultApp,
  e2e: TPV_E2E_MODE,
  mode: TPV_MODE,
  e2eApiBaseUrl: String(process.env.TPV_E2E_BASE_URL || "").trim(),
  e2eApiKey: String(process.env.TPV_E2E_API_KEY || "").trim(),
  e2eRequireOnline: String(process.env.TPV_E2E_REQUIRE_ONLINE || "") === "1",
  e2eAllowWrites: String(process.env.TPV_E2E_ALLOW_WRITES || "") === "1",
});

contextBridge.exposeInMainWorld("TPV_TEST", {
  isE2E: TPV_E2E_MODE,
  getPrintJobs: () => tpvE2EPrintJobs.slice(),
  clearPrintJobs: () => {
    tpvE2EPrintJobs.length = 0;
    return { ok: true };
  },
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
  getTheme: () => ipcRenderer.invoke("customer:getTheme"),
  setTheme: (mode) => ipcRenderer.invoke("customer:setTheme", mode),
});

contextBridge.exposeInMainWorld("TPV_CLIPBOARD", {
  readText: () => {
    try {
      return clipboard.readText() || "";
    } catch {
      return "";
    }
  },
});

contextBridge.exposeInMainWorld("TPV_SCALE", {
  listPorts: () => ipcRenderer.invoke("scale:listPorts"),
  getState: () => ipcRenderer.invoke("scale:getState"),
  connect: (config) => ipcRenderer.invoke("scale:connect", config),
  disconnect: () => ipcRenderer.invoke("scale:disconnect"),
  setEnabled: (enabled, config) =>
    ipcRenderer.invoke("scale:setEnabled", !!enabled, config || null),
  consumeWeight: () => ipcRenderer.invoke("scale:consumeWeight"),
  onState: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("scale:state", handler);
    return () => ipcRenderer.removeListener("scale:state", handler);
  },
});
