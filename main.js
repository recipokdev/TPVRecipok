// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { globalShortcut } = require("electron");

let isRecreatingWindow = false;
let mainWin = null;
let splashWin = null;
let currentUser = "admin"; // por defecto si quieres

function readChannel() {
  try {
    const p = app.isPackaged
      ? path.join(process.resourcesPath, "channel.json")
      : path.join(__dirname, "build", "channel-stable.json"); // en dev, stable
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data.channel === "beta" ? "beta" : "stable";
  } catch {
    return "stable";
  }
}

function getChannelSafe() {
  try {
    return readChannel();
  } catch {
    return "stable";
  }
}

(function isolateUserDataPerChannel() {
  const ch = getChannelSafe();
  if (ch !== "beta") return;
  const oldPath = app.getPath("userData");
  app.setPath("userData", oldPath + "-beta");
})();

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
    }
  });
}

function queueFilePath() {
  return path.join(app.getPath("userData"), "sync-queue.json");
}

function readQueue() {
  try {
    const p = queueFilePath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf8")) || [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  const p = queueFilePath();
  fs.writeFileSync(p, JSON.stringify(items, null, 2), "utf8");
}

function getWindowTitle() {
  const ch = readChannel(); // "beta" | "stable"
  return ch === "beta" ? "TPV Recipok (BETA)" : "TPV Recipok";
}

function lpPdf(deviceName, pdfPath) {
  return new Promise((resolve) => {
    if (!deviceName) return resolve({ ok: false, error: "Falta deviceName" });

    const p = spawn("lp", ["-d", deviceName, pdfPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else
        resolve({ ok: false, error: (stderr || `lp exited ${code}`).trim() });
    });
  });
}

async function renderTicketPdf(html) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: false },
  });

  const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  await win.loadURL(dataUrl);

  // Importantísimo: respetar @page size del CSS
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
  });

  const tmpDir = app.getPath("temp");
  const pdfPath = path.join(tmpDir, `tpv-ticket-${Date.now()}.pdf`);
  fs.writeFileSync(pdfPath, pdf);

  try {
    win.close();
  } catch (_) {}
  return pdfPath;
}

function isKioskMode() {
  try {
    const cfg = readCfg();
    return cfg.kioskMode !== false; // default true
  } catch {
    return true;
  }
}

function applyKioskMode(win, enabled) {
  if (!win || win.isDestroyed()) return;

  const isWin = process.platform === "win32";

  if (enabled) {
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(true);
    win.setAlwaysOnTop(true);

    // ✅ Windows: NO usar setKiosk (da problemas al salir)
    if (!isWin) win.setKiosk(true);

    // fullscreen “real”
    win.setFullScreen(true);

    win.setResizable(false);
    win.setMinimizable(false);
    win.setMaximizable(false);

    // opcional (evita Alt+F4 fácil, pero no siempre conviene)
    // win.setClosable(false);
  } else {
    // salir: primero quitar kiosk (solo linux/mac), luego fullscreen
    if (!isWin) win.setKiosk(false);

    win.setFullScreen(false);

    win.setAlwaysOnTop(false);
    // ✅ Mantener el menú oculto SIEMPRE
    win.setAutoHideMenuBar(true);
    win.setMenuBarVisibility(false);

    win.setResizable(true);
    win.setMinimizable(true);
    win.setMaximizable(true);

    // win.setClosable(true);

    // ✅ que no quede pequeña
    try {
      win.maximize();
    } catch (_) {}
    try {
      win.focus();
    } catch (_) {}
  }
}

function createWindow() {
  const isDev = !app.isPackaged;
  const kioskMode = isKioskMode();

  mainWin = new BrowserWindow({
    title: getWindowTitle(),
    frame: true,
    show: false,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      devTools: isDev,
    },
  });

  mainWin.setTitle(getWindowTitle());

  // ✅ Bloquear cierre con la X si hay caja abierta o tickets aparcados
  let allowMainClose = false;

  mainWin.on("close", async (e) => {
    // Si el cierre viene “permitido” (ej: app.quit controlado), dejamos pasar
    if (allowMainClose) return;

    // Si estás en pleno cambio de modo o recreando (por si vuelves a hacerlo)
    if (isRecreatingWindow) return;

    e.preventDefault();

    let guards = { cashOpen: false, parkedCount: 0 };
    try {
      guards = await mainWin.webContents.executeJavaScript(
        "window.__TPV_GUARDS__ && window.__TPV_GUARDS__()",
      );
      guards = guards || { cashOpen: false, parkedCount: 0 };
    } catch (_) {}

    if (guards.cashOpen) {
      mainWin.webContents.send("tpv:guard", {
        title: "Terminal abierta",
        text: "No puedes cerrar el programa hasta que cierres la caja.",
      });
      return;
    }

    if ((guards.parkedCount || 0) > 0) {
      mainWin.webContents.send("tpv:guard", {
        title: "Tickets aparcados",
        text: "No puedes cerrar el programa hasta recuperar o eliminar los tickets aparcados.",
      });
      return;
    }

    // ✅ permitir cierre real
    allowMainClose = true;
    mainWin.close();
  });

  // aplica el modo inicial
  applyKioskMode(mainWin, kioskMode);

  // carga UI
  loadUI(mainWin);

  if (!app.isPackaged) {
    mainWin.webContents.openDevTools({ mode: "right" }); // o "detach"
  }

  mainWin.once("ready-to-show", () => {
    mainWin.show();
    // si NO es kiosk, maximiza al arrancar
    if (!kioskMode) {
      try {
        mainWin.maximize();
      } catch (_) {}
    }
  });
}

function createSplashWindow() {
  splashWin = new BrowserWindow({
    width: 520,
    height: 260,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: true, // ✅ que el código pueda cerrarlo
    skipTaskbar: true, // ✅ no aparece en la barra
    show: false,
    alwaysOnTop: true,
    center: true,
    backgroundColor: "#111827",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  splashWin.removeMenu();
  let allowSplashClose = false;

  splashWin.on("close", (e) => {
    if (!allowSplashClose) e.preventDefault();
  });

  // guarda el flag a nivel global
  splashWin.__allowClose = () => {
    allowSplashClose = true;
  };

  // HTML inline sencillo con barra de progreso
  const html = `
  <!doctype html>
  <html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TPV Recipok</title>
    <style>
      body{
        margin:0;
        font-family: Arial, Helvetica, sans-serif;
        background:#111827;
        color:#e5e7eb;
        display:flex;
        align-items:center;
        justify-content:center;
        height:100vh;
      }
      .box{
        width: 86%;
      }
      .title{
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 10px;
      }
      .status{
        font-size: 14px;
        opacity: 0.9;
        margin-bottom: 16px;
        min-height: 18px;
      }
      .bar{
        width:100%;
        height:14px;
        background:#1f2937;
        border-radius:999px;
        overflow:hidden;
        border:1px solid rgba(255,255,255,0.08);
      }
      .fill{
        height:100%;
        width:0%;
        background:#22c55e;
        border-radius:999px;
        transition: width .2s ease;
      }
      .pct{
        margin-top: 10px;
        font-size: 13px;
        opacity: 0.85;
      }
      .hint{
        margin-top: 14px;
        font-size: 12px;
        opacity: 0.6;
      }
    </style>
  </head>
  <body>
    <div class="box">
      <div class="title">TPV Recipok</div>
      <div class="status" id="status">Buscando actualizaciones...</div>
      <div class="bar"><div class="fill" id="fill"></div></div>
      <div class="pct" id="pct">0%</div>
      <div class="hint">No cierres esta ventana.</div>

      <script>
        const set = (text, percent) => {
          const s = document.getElementById("status");
          const f = document.getElementById("fill");
          const p = document.getElementById("pct");
          if (typeof text === "string") s.textContent = text;
          if (typeof percent === "number") {
            const clamped = Math.max(0, Math.min(100, percent));
            f.style.width = clamped + "%";
            p.textContent = clamped.toFixed(0) + "%";
          }
        };

        // Recibimos mensajes desde el proceso principal
        window.addEventListener("message", (ev) => {
          if (!ev || !ev.data) return;
          const { text, percent } = ev.data;
          set(text, percent);
        });
      </script>
    </div>
  </body>
  </html>
  `;

  const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  splashWin.loadURL(dataUrl);

  splashWin.once("ready-to-show", () => {
    splashWin.show();
  });

  return splashWin;
}

function splashSet(text, percent) {
  if (!splashWin || splashWin.isDestroyed()) return;
  splashWin.webContents
    .executeJavaScript(
      `window.postMessage(${JSON.stringify({ text, percent })}, "*");`,
    )
    .catch(() => {});
}

function closeSplash() {
  if (splashWin && !splashWin.isDestroyed()) {
    try {
      // permite cerrar desde código
      if (typeof splashWin.__allowClose === "function")
        splashWin.__allowClose();
      splashWin.destroy(); // 👈 cierre forzado (no se queda pegado)
    } catch (_) {}
  }
  splashWin = null;
}

// (opcional) log a fichero para depurar en clientes
function logUpdater(...args) {
  try {
    const p = path.join(app.getPath("userData"), "updater.log");
    fs.appendFileSync(p, args.map((a) => String(a)).join(" ") + "\n");
  } catch {}
}

async function runAutoUpdateGate() {
  // Linux: solo auto-update si es AppImage
  if (process.platform === "linux" && !process.env.APPIMAGE) {
    return { updatedOrReady: true };
  }
  if (!app.isPackaged) return { updatedOrReady: true };

  createSplashWindow();
  splashSet("Buscando actualizaciones...", 20);

  // Limpieza total ANTES de registrar eventos
  autoUpdater.removeAllListeners();

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  // ✅ Canal (viene de channel.json dentro de resources)
  const channel = readChannel(); // "beta" | "stable"

  // ✅ Separación por comportamiento (ya que separaste por repos)
  autoUpdater.allowPrerelease = channel === "beta";
  autoUpdater.allowDowngrade = false;

  // ✅ Importantísimo: no fuerces channel (evita buscar beta.yml / latest-latest.yml)
  try {
    delete autoUpdater.channel;
  } catch {}

  logUpdater(
    "UPDATER start channel=",
    channel,
    "APPIMAGE=",
    !!process.env.APPIMAGE,
  );

  return await new Promise((resolve) => {
    let finished = false;
    const done = (r) => {
      if (finished) return;
      finished = true;
      resolve(r);
    };

    const onProgress = (p) => {
      const pct = typeof p?.percent === "number" ? p.percent : 0;
      splashSet("Descargando actualización…", pct);
    };

    const watchdog = setTimeout(() => {
      splashSet("Conexión lenta. Abriendo…", 40);
      setTimeout(() => done({ updatedOrReady: true }), 200);
    }, 15000);

    const finishOk = (msg, percent = 60, delay = 200) => {
      clearTimeout(watchdog);
      splashSet(msg, percent);
      setTimeout(() => done({ updatedOrReady: true }), delay);
    };

    autoUpdater.once("error", (err) => {
      logUpdater("UPDATER error:", err?.message || err);
      finishOk("No se pudo comprobar. Abriendo…", 40, 300);
    });

    autoUpdater.once("update-not-available", () => {
      logUpdater("UPDATER: update-not-available");
      finishOk("Todo al día. Abriendo…", 60, 200);
    });

    autoUpdater.once("update-available", () => {
      logUpdater("UPDATER: update-available");
      clearTimeout(watchdog);
      splashSet("Actualización encontrada. Descargando…", 25);
    });

    autoUpdater.on("download-progress", onProgress);

    autoUpdater.once("update-downloaded", () => {
      logUpdater("UPDATER: update-downloaded");
      splashSet("Instalando actualización…", 100);

      // Windows: silent = true => NO abre instalador
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 600);

      setTimeout(() => {
        try {
          app.exit(0);
        } catch {}
      }, 20000);
    });

    autoUpdater.checkForUpdates();
  });
}

async function createHiddenPrintWindow(html) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  await win.loadURL(dataUrl);
  return win;
}

// --- IPC: obtener estado de guardias ---
ipcMain.handle("tpv:getGuards", async (event) => {
  try {
    // pide al renderer el estado
    const wc = event.sender;
    const guards = await wc.executeJavaScript(
      "window.__TPV_GUARDS__ && window.__TPV_GUARDS__()",
    );
    return guards || { cashOpen: false, parkedCount: 0 };
  } catch (e) {
    // si falla, por seguridad NO bloqueamos (o si quieres, sí bloqueas)
    return { cashOpen: false, parkedCount: 0 };
  }
});

// --- IPC: listado de impresoras ---
ipcMain.handle("printers:list", async () => {
  const w = BrowserWindow.getFocusedWindow() || mainWin;
  if (!w) return [];
  const printers = await w.webContents.getPrintersAsync();
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: !!p.isDefault,
    status: p.status || 0,
  }));
});

// --- IPC: imprimir silencioso en una impresora concreta ---
ipcMain.handle("ticket:print", async (_event, { html, deviceName }) => {
  if (!html) return { ok: false, error: "Falta html" };
  if (!deviceName) return { ok: false, error: "Falta deviceName" };

  // Windows: puedes mantener tu print silencioso actual
  if (process.platform === "win32") {
    let win = null;
    try {
      win = await createHiddenPrintWindow(html);
      const result = await new Promise((resolve) => {
        win.webContents.print(
          { silent: true, deviceName, printBackground: true },
          (success, failureReason) => {
            if (!success)
              resolve({
                ok: false,
                error: failureReason || "No se pudo imprimir",
              });
            else resolve({ ok: true });
          },
        );
      });
      return result;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    } finally {
      if (win) {
        try {
          win.close();
        } catch (_) {}
      }
    }
  }

  // Linux: PDF con tamaño ticket + lp
  if (process.platform === "linux") {
    try {
      const pdfPath = await renderTicketPdf(html);
      const r = await lpPdf(deviceName, pdfPath);
      // limpieza best-effort
      try {
        fs.unlinkSync(pdfPath);
      } catch (_) {}
      return r;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  return { ok: false, error: `Sistema no soportado: ${process.platform}` };
});

ipcMain.handle("ticket:printRaw", async (_event, { bytes, deviceName }) => {
  if (!bytes || !Array.isArray(bytes) || bytes.length === 0) {
    return { ok: false, error: "Faltan bytes" };
  }
  if (!deviceName) return { ok: false, error: "Falta deviceName" };

  if (process.platform !== "linux") {
    return { ok: false, error: "printRaw solo se usa en Linux" };
  }

  try {
    const { spawn } = require("child_process");
    const buf = Buffer.from(bytes);

    const r = await new Promise((resolve) => {
      const p = spawn("lp", ["-d", deviceName, "-o", "raw"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let err = "";
      p.stderr.on("data", (d) => (err += d.toString()));
      p.on("close", (code) => {
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: err.trim() || `lp exit ${code}` });
      });

      p.stdin.write(buf);
      p.stdin.end();
    });

    return r;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

if (process.platform === "linux") {
  // Evita el error del chrome-sandbox en AppImage en algunos Ubuntus
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-setuid-sandbox");
}

if (process.platform === "win32") {
  const ch = readChannel();
  app.setAppUserModelId(
    ch === "beta" ? "com.recipok.tpvrecipok.beta" : "com.recipok.tpvrecipok",
  );
}

function cleanOldAutoStartIfWrong() {
  if (!app.isPackaged) return;
  try {
    const cur = app.getLoginItemSettings();
    const exe = String(cur?.executable || "");
    if (cur.openAtLogin && exe && exe !== process.execPath) {
      app.setLoginItemSettings({ openAtLogin: false });
    }
  } catch {}
}

function configureAutoStart() {
  if (!app.isPackaged) return;

  const cfg = readCfg();

  if (cfg.autostart === false) {
    app.setLoginItemSettings({ openAtLogin: false });
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: false,
    path: process.execPath,
  });
}

app.whenReady().then(async () => {
  cleanOldAutoStartIfWrong();
  configureAutoStart();
  await runAutoUpdateGate();
  createWindow();
  registerShortcuts();
  closeSplash();
});

app.on("window-all-closed", () => {
  // ✅ Si estamos recreando la ventana (toggle kiosk), NO quitamos la app
  if (isRecreatingWindow) return;

  if (process.platform !== "darwin") app.quit();
});

function escposOpenDrawerBuffer(pin = 0, t1 = 25, t2 = 250) {
  const m = pin === 1 ? 1 : 0;
  const a = Math.max(0, Math.min(255, Number(t1) || 25));
  const b = Math.max(0, Math.min(255, Number(t2) || 250));
  return Buffer.from([0x1b, 0x70, m, a, b]);
}

function registerShortcuts() {
  // Evita doble registro si reinicias ventana, etc.
  globalShortcut.unregisterAll();

  const ok = globalShortcut.register("Control+Alt+Q", async () => {
    if (!mainWin || mainWin.isDestroyed()) return;

    let guards = { cashOpen: false, parkedCount: 0 };
    try {
      guards = await mainWin.webContents.executeJavaScript(
        "window.__TPV_GUARDS__ && window.__TPV_GUARDS__()",
      );
      guards = guards || { cashOpen: false, parkedCount: 0 };
    } catch (_) {}

    if (guards.cashOpen) {
      mainWin.webContents.send("tpv:guard", {
        title: "Terminal abierta",
        text: "No puedes cerrar el programa hasta que cierres la caja.",
      });
      return;
    }

    if ((guards.parkedCount || 0) > 0) {
      mainWin.webContents.send("tpv:guard", {
        title: "Tickets aparcados",
        text: "No puedes cerrar el programa hasta recuperar o eliminar los tickets aparcados.",
      });
      return;
    }

    app.quit();
  });

  if (!ok) console.log("No se pudo registrar Control+Alt+Q");
}

ipcMain.handle("tpv:openCashDrawer", async (_event, { deviceName }) => {
  // Windows: deviceName = nombre impresora
  // Linux: deviceName opcional (si viene vacío, autodetecta)

  if (process.platform === "win32") {
    if (!deviceName) return { ok: false, error: "Falta deviceName" };

    const exePath = app.isPackaged
      ? path.join(process.resourcesPath, "assets", "open-drawer.exe")
      : path.join(__dirname, "assets", "open-drawer.exe");

    if (!fs.existsSync(exePath)) {
      return { ok: false, error: `No existe open-drawer.exe en: ${exePath}` };
    }

    const runPin = (pin) =>
      new Promise((resolve) => {
        execFile(
          exePath,
          [deviceName, String(pin)],
          { windowsHide: true },
          (err, stdout, stderr) => {
            if (err) {
              resolve({
                ok: false,
                pin,
                error: (stderr || err.message || String(err)).trim(),
              });
            } else {
              resolve({ ok: true, pin, out: (stdout || "").trim() });
            }
          },
        );
      });

    let r = await runPin(0);
    if (!r.ok) r = await runPin(1);
    return r;
  }

  if (process.platform === "linux") {
    // En Linux abrimos cajón vía CUPS RAW usando el nombre de impresora (deviceName)
    if (!deviceName) {
      return { ok: false, error: "Falta deviceName (nombre de impresora)" };
    }

    // ESC p m t1 t2
    const buf0 = escposOpenDrawerBuffer(0, 25, 250);
    const buf1 = escposOpenDrawerBuffer(1, 25, 250);

    const trySend = (buf) =>
      new Promise((resolve) => {
        const { spawn } = require("child_process");
        const p = spawn("lp", ["-d", deviceName, "-o", "raw"], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let err = "";
        p.stderr.on("data", (d) => (err += d.toString()));
        p.on("close", (code) => {
          if (code === 0) resolve({ ok: true });
          else resolve({ ok: false, error: err.trim() || `lp exit ${code}` });
        });

        p.stdin.write(buf);
        p.stdin.end();
      });

    // probamos pin 0 y luego pin 1
    let r = await trySend(buf0);
    if (!r.ok) r = await trySend(buf1);

    if (!r.ok) {
      return {
        ok: false,
        error:
          "No se pudo enviar comando al cajón por CUPS. " +
          "Revisa que la impresora exista en Ubuntu con ese nombre.",
      };
    }

    return { ok: true };
  }

  return { ok: false, error: `Sistema no soportado: ${process.platform}` };
});

/* Cola de sincronización */
ipcMain.handle("queue:enqueue", async (_e, item) => {
  const q = readQueue();
  q.push({
    id: crypto.randomUUID?.() || String(Date.now()) + "_" + Math.random(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
    ...item,
  });
  writeQueue(q);
  return { ok: true, pending: q.filter((x) => x.status === "pending").length };
});

/* ver contador de items en cola */
ipcMain.handle("queue:count", async () => {
  const q = readQueue();
  const pending = q.filter((x) => x.status === "pending").length;
  const error = q.filter((x) => x.status === "error").length;
  return { pending, error, total: q.length };
});

/* listar items de cola (sin consumir) */
ipcMain.handle("queue:list", async () => {
  const q = readQueue();

  const pending = q
    .filter((x) => x.status === "pending" || x.status === "processing")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const done = q
    .filter((x) => x.status === "done")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const error = q
    .filter((x) => x.status === "error")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  return { pending, done, error, total: q.length };
});

/* obtener siguiente item pendiente y marcar resuelto*/
ipcMain.handle("queue:next", async () => {
  const q = readQueue();
  const now = Date.now();

  // 1) Si quedó algo en processing (crash / cierre), lo devolvemos a pending
  for (const it of q) {
    if (it.status === "processing") {
      it.status = "pending";
    }
  }

  // 2) Elegir el primer "pending" cuyo nextRetryAt ya haya pasado (o no exista)
  const idx = q.findIndex((x) => {
    if (x.status !== "pending") return false;
    if (!x.nextRetryAt) return true;
    return new Date(x.nextRetryAt).getTime() <= now;
  });

  if (idx === -1) {
    writeQueue(q);
    return { ok: true, item: null };
  }

  q[idx].status = "processing";
  q[idx].attempts = (q[idx].attempts || 0) + 1;
  q[idx].lastAttemptAt = new Date().toISOString();
  writeQueue(q);

  return { ok: true, item: q[idx] };
});

ipcMain.handle("queue:done", async (_e, { id, remote }) => {
  const q = readQueue();
  const idx = q.findIndex((x) => x.id === id);
  if (idx === -1) return { ok: false, error: "No existe item" };
  q[idx].status = "done";
  q[idx].remote = remote || null;
  writeQueue(q);
  return { ok: true };
});

ipcMain.handle("queue:error", async (_e, { id, error }) => {
  const q = readQueue();
  const idx = q.findIndex((x) => x.id === id);
  if (idx === -1) return { ok: false, error: "No existe item" };

  // reintentos: 1, 2, 5, 10 min
  const att = q[idx].attempts || 1;
  const delayMin = att <= 1 ? 1 : att === 2 ? 2 : att === 3 ? 5 : 10;

  q[idx].status = "pending"; // vuelve a pending para reintentar
  q[idx].lastError = String(error || "Error");
  q[idx].nextRetryAt = new Date(Date.now() + delayMin * 60000).toISOString();

  writeQueue(q);
  return { ok: true, nextRetryAt: q[idx].nextRetryAt };
});

ipcMain.handle("app:quit", async () => {
  if (!isAdmin()) return { ok: false, error: "FORBIDDEN" };
  if (!mainWin || mainWin.isDestroyed()) return { ok: false };

  let guards = { cashOpen: false, parkedCount: 0 };
  try {
    guards = await mainWin.webContents.executeJavaScript(
      "window.__TPV_GUARDS__ && window.__TPV_GUARDS__()",
    );
    guards = guards || { cashOpen: false, parkedCount: 0 };
  } catch (_) {}

  if (guards.cashOpen) {
    mainWin.webContents.send("tpv:guard", {
      title: "Terminal abierta",
      text: "No puedes cerrar el programa hasta que cierres la caja.",
    });
    return { ok: false, reason: "cashOpen" };
  }

  if ((guards.parkedCount || 0) > 0) {
    mainWin.webContents.send("tpv:guard", {
      title: "Tickets aparcados",
      text: "No puedes cerrar el programa hasta recuperar o eliminar los tickets aparcados.",
    });
    return { ok: false, reason: "parked" };
  }

  app.quit();
  return { ok: true };
});

ipcMain.handle("tpv:attemptQuit", async () => {
  if (!mainWin || mainWin.isDestroyed()) return { ok: true };

  let guards = { cashOpen: false, parkedCount: 0 };
  try {
    guards = await mainWin.webContents.executeJavaScript(
      "window.__TPV_GUARDS__ && window.__TPV_GUARDS__()",
    );
    guards = guards || { cashOpen: false, parkedCount: 0 };
  } catch (_) {}

  if (guards.cashOpen) {
    mainWin.webContents.send("tpv:guard", {
      title: "Terminal abierta",
      text: "No puedes cerrar el programa hasta que cierres la caja.",
    });
    return { ok: false, blocked: "cashOpen" };
  }

  if ((guards.parkedCount || 0) > 0) {
    mainWin.webContents.send("tpv:guard", {
      title: "Tickets aparcados",
      text: "No puedes cerrar el programa hasta recuperar o eliminar los tickets aparcados.",
    });
    return { ok: false, blocked: "parked" };
  }

  app.quit();
  return { ok: true };
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle("setup:testPosPrinter", async (_evt, { queueName } = {}) => {
  const target = queueName || "RECIPOK_POS";

  // ✅ WINDOWS: test por webContents.print (sin bash, sin exe externo)
  if (process.platform === "win32") {
    let win = null;
    try {
      const html = `
        <html><body style="font-family: Arial; font-size: 12px;">
          <div><b>PRUEBA RECIPOK</b></div>
          <div>------------------------</div>
          <div>OK</div>
          <div style="margin-top:10px;">${new Date().toLocaleString()}</div>
        </body></html>
      `;
      win = await createHiddenPrintWindow(html);

      const r = await new Promise((resolve) => {
        win.webContents.print(
          { silent: true, deviceName: target, printBackground: true },
          (success, failureReason) => {
            if (!success)
              resolve({
                ok: false,
                error: failureReason || "No se pudo imprimir",
              });
            else resolve({ ok: true });
          },
        );
      });

      return r;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    } finally {
      if (win) {
        try {
          win.close();
        } catch (_) {}
      }
    }
  }

  // ✅ LINUX: script (sin pkexec)
  if (process.platform === "linux") {
    const bundled = app.isPackaged
      ? path.join(
          process.resourcesPath,
          "linux-tools",
          "recipok-pos-printer-test.sh",
        )
      : path.join(
          __dirname,
          "assets",
          "linux-tools",
          "recipok-pos-printer-test.sh",
        );

    const localScript = ensureExecutableCopy(
      bundled,
      "recipok-pos-printer-test.sh",
    );

    return await new Promise((resolve) => {
      const p = spawn("bash", [localScript, target], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let out = "",
        err = "";
      p.stdout.on("data", (d) => (out += d.toString()));
      p.stderr.on("data", (d) => (err += d.toString()));

      p.on("close", (code) => {
        if (code === 0) resolve({ ok: true, out: out.trim() });
        else resolve({ ok: false, error: (err || `exit ${code}`).trim() });
      });

      p.on("error", (e) =>
        resolve({ ok: false, error: e?.message || String(e) }),
      );
    });
  }

  return { ok: false, error: `Sistema no soportado: ${process.platform}` };
});

ipcMain.handle("ui:setKioskMode", async (_e, enabled) => {
  if (!isAdmin()) return { ok: false, error: "FORBIDDEN" };

  writeCfg({ kioskMode: !!enabled });
  applyKioskMode(mainWin, !!enabled);
  return { ok: true };
});

function cfgPath() {
  return path.join(app.getPath("userData"), "tpv-config.json");
}
function readCfg() {
  try {
    return JSON.parse(fs.readFileSync(cfgPath(), "utf8"));
  } catch {
    return {};
  }
}
function writeCfg(patch) {
  const cur = readCfg();
  const next = { ...cur, ...patch };
  fs.writeFileSync(cfgPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

ipcMain.handle("cfg:get", (_e, key) => readCfg()[key]);
ipcMain.handle("cfg:set", (_e, key, value) => writeCfg({ [key]: value }));

function ensureExecutableCopy(srcPath, dstName) {
  const dstDir = path.join(app.getPath("userData"), "linux-tools");
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

  const dstPath = path.join(dstDir, dstName);

  // Copia si no existe o si cambió tamaño/mtime (simple)
  let needCopy = true;
  if (fs.existsSync(dstPath)) {
    try {
      const a = fs.statSync(srcPath);
      const b = fs.statSync(dstPath);
      needCopy = a.size !== b.size;
    } catch (_) {}
  }
  if (needCopy) fs.copyFileSync(srcPath, dstPath);

  try {
    fs.chmodSync(dstPath, 0o755);
  } catch (_) {}
  return dstPath;
}

function lpRawUser(deviceName, buffer) {
  return new Promise((resolve) => {
    if (!deviceName) return resolve({ ok: false, error: "Falta deviceName" });

    const p = spawn("lp", ["-d", deviceName, "-o", "raw"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: (stderr || `lp exit ${code}`).trim() });
    });

    p.stdin.write(buffer);
    p.stdin.end();
  });
}

function getIndexHtmlPath() {
  const candidates = [
    path.join(__dirname, "index.html"),
    path.join(__dirname, "src", "index.html"),
    path.join(app.getAppPath(), "index.html"),
    path.join(app.getAppPath(), "src", "index.html"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Log útil
  console.log("No encontré index.html. Probé:", candidates);
  return candidates[0]; // devuelve algo para que el error sea explícito
}

const { pathToFileURL } = require("url");

function loadUI(win) {
  const indexPath = path.join(__dirname, "index.html");
  const url = pathToFileURL(indexPath).toString();

  console.log("Loading UI:", indexPath);
  console.log("Loading URL:", url);

  return win.loadFile(indexPath).catch(console.log);
}

ipcMain.handle("auth:setCurrentUser", async (_e, { user } = {}) => {
  currentUser = String(user || "").toLowerCase();
  return { ok: true };
});

function isAdmin() {
  return String(currentUser || "").toLowerCase() === "admin";
}

ipcMain.handle("cfg:setAutostart", (_e, val) => {
  writeCfg({ autostart: !!val });
  configureAutoStart();
  return { ok: true, autostart: !!val };
});

ipcMain.handle("cfg:getAutostart", () => {
  const cfg = readCfg();
  return { ok: true, autostart: cfg.autostart !== false };
});
