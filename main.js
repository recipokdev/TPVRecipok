// main.js
const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { globalShortcut } = require("electron");
const https = require("https");
const dns = require("dns");
const { ScaleManager } = require("./js/tpv/scale/scale-manager");

let isRecreatingWindow = false;
let mainWin = null;
let splashWin = null;
let currentUser = { name: null, isAdmin: false };
let customerWin = null;
let customerCreating = false;
let lastCustomerState = null;
let allowCustomerClose = false;
let lastSecondInstanceUpdateCheckAt = 0;
let forceRelaunchForUpdate = false;
const scaleManager = new ScaleManager();
let scaleReconnectMonitorTimer = null;
let scaleReconnectInFlight = false;
let lastScaleReconnectAttemptAt = 0;
const IS_E2E = String(process.env.TPV_E2E || "") === "1";
const IS_E2E_BACKGROUND =
  IS_E2E && String(process.env.TPV_E2E_BACKGROUND || "") === "1";
// Modo multi-instancia REAL (no E2E): permite abrir 2 instancias del TPV normal
// en el mismo PC (userData aislado) para probar a mano la sincronizacion entre
// TPV "espejo" contra demo, cobrando de verdad. NO activa E2E, asi que funciona
// como el programa normal (login, abrir caja, cobrar, imprimir...).
const IS_MULTI_INSTANCE =
  String(process.env.TPV_MULTI_INSTANCE || "") === "1";
// Etiqueta opcional para distinguir instancias en pruebas multi-TPV (2 ventanas).
const E2E_TEST_LABEL = String(process.env.TPV_TEST_LABEL || "").trim();

// Modo especial: proceso ligero e independiente que se lanza justo antes de
// autoUpdater.quitAndInstall() (ver spawnPostUpdateSplash) para tapar el
// hueco del instalador NSIS silencioso -- ahi Windows no da ningun progreso
// real (icono del escritorio en blanco un instante) porque el proceso normal
// de la app ya se ha cerrado para poder sobrescribir el .exe. Este proceso no
// hace NADA del arranque normal: solo muestra una ventana y espera a que la
// app real avise de que ya se ve (ver notifyPostUpdateSplashReady), asi que
// debe cortar aqui mismo, antes del bloqueo de instancia unica y de todo lo
// demas (top-level return: main.js es CommonJS, es valido).
const IS_POST_UPDATE_SPLASH = process.argv.includes("--post-update-splash");
if (IS_POST_UPDATE_SPLASH) {
  runPostUpdateSplashProcess();
  return;
}

const DEFAULT_UPDATE_POLICY_URLS = {
  stable:
    "https://raw.githubusercontent.com/recipokdev/TPVRecipok/main/build/update-policy.stable.json",
  beta: "https://raw.githubusercontent.com/recipokdev/TPVRecipok/main/build/update-policy.beta.json",
};

const GITHUB_UPDATE_REPOS = {
  stable: "recipokdev/TPVRecipok",
  beta: "recipokdev/TPVRecipok-Beta",
};

async function triggerUpdateCheckIfSafe(reason = "manual") {
  // 1 check/min para evitar martillazos
  if (Date.now() - lastSecondInstanceUpdateCheckAt < 60_000) return;
  lastSecondInstanceUpdateCheckAt = Date.now();

  try {
    // intenta un check “pre-caja” (respeta caja abierta)
    await runUpdateCheckOncePreCash();
    // y arranca reintentos si procede
    startPreCashUpdateRetries();
  } catch {}
}

function readChannel() {
  try {
    const p = resolveChannelConfigPath();
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data.channel === "beta" ? "beta" : "stable";
  } catch {
    return "stable";
  }
}

function readChannelConfig() {
  try {
    const p = resolveChannelConfigPath();
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const channel = data.channel === "beta" ? "beta" : "stable";
    const updatePolicyUrl = String(data.updatePolicyUrl || "").trim();
    return { channel, updatePolicyUrl };
  } catch {
    return { channel: "stable", updatePolicyUrl: "" };
  }
}

function resolveChannelConfigPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "channel.json");
  }

  const forced = String(process.env.TPV_CHANNEL || "")
    .trim()
    .toLowerCase();
  if (forced === "beta" || forced === "stable") {
    return path.join(__dirname, "build", `channel-${forced}.json`);
  }

  let version = "";
  try {
    version = String(app.getVersion() || "")
      .trim()
      .toLowerCase();
  } catch {}

  const inferred = version.includes("-beta") ? "beta" : "stable";
  return path.join(__dirname, "build", `channel-${inferred}.json`);
}

function getChannelSafe() {
  try {
    return readChannel();
  } catch {
    return "stable";
  }
}

(function isolateUserDataPerChannel() {
  const isE2E = String(process.env.TPV_E2E || "") === "1";
  if (isE2E) {
    const forcedPath = String(process.env.TPV_E2E_USER_DATA || "").trim();
    if (forcedPath) {
      app.setPath("userData", forcedPath);
      return;
    }

    const oldPath = app.getPath("userData");
    app.setPath("userData", oldPath + "-e2e");
    return;
  }

  // Multi-instancia real: cada instancia usa su propio userData (aislado), para
  // poder abrir 2 TPV normales a la vez en el mismo PC sin pisarse.
  if (IS_MULTI_INSTANCE) {
    const forcedPath = String(process.env.TPV_USER_DATA || "").trim();
    if (forcedPath) {
      app.setPath("userData", forcedPath);
      return;
    }
    const oldPath = app.getPath("userData");
    app.setPath("userData", oldPath + "-multi");
    return;
  }

  const ch = getChannelSafe();
  if (ch !== "beta") return;
  const oldPath = app.getPath("userData");
  app.setPath("userData", oldPath + "-beta");
})();

// En E2E y en multi-instancia real permitimos varias instancias (pruebas
// multi-TPV: 2 ventanas en el mismo PC). En produccion normal se mantiene el
// bloqueo de instancia unica.
const gotTheLock =
  IS_E2E || IS_MULTI_INSTANCE ? true : app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", async () => {
    if (appIsInstallingUpdate) return;

    if (mainWin && !mainWin.isDestroyed()) {
      if (!IS_E2E_BACKGROUND) {
        if (mainWin.isMinimized()) mainWin.restore();
        mainWin.show();
        mainWin.focus();
      }
    } else {
      createWindow();
    }
    // ✅ CLAVE: aunque ya exista instancia, chequear updates
    triggerUpdateCheckIfSafe("second-instance");
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
  const base = ch === "beta" ? "TPV Recipok (BETA)" : "TPV Recipok";
  // En pruebas multi-TPV (2 ventanas), sufijo para distinguir A/B.
  return E2E_TEST_LABEL ? `${base} — ${E2E_TEST_LABEL}` : base;
}

// --- Auto-reparacion de accesos directos (Windows, app instalada) ---
// El nombre del .exe cambio entre versiones (0.1.44 anadio executableName), asi
// que accesos directos antiguos pueden apuntar a un .exe inexistente ("no se
// encuentra el programa"). Al arrancar (y por tanto TRAS CADA ACTUALIZACION, que
// relanza la app) verificamos/reparamos el acceso directo del escritorio y del
// menu Inicio para que apunten al .exe ACTUAL.
function shortcutBaseName() {
  try {
    return readChannel() === "beta" ? "TPV Recipok (Beta)" : "TPV Recipok";
  } catch {
    return "TPV Recipok";
  }
}

function ensureOneShortcut(shortcutPath, exePath, { createIfMissing }) {
  try {
    const exists = fs.existsSync(shortcutPath);
    if (!exists && !createIfMissing) return;

    let ok = false;
    if (exists) {
      try {
        const d = shell.readShortcutLink(shortcutPath);
        const tgt = String(d?.target || "");
        ok =
          !!tgt &&
          path.normalize(tgt).toLowerCase() ===
            path.normalize(exePath).toLowerCase() &&
          fs.existsSync(tgt);
      } catch {
        ok = false;
      }
    }
    if (ok) return; // ya apunta al exe actual y valido

    shell.writeShortcutLink(shortcutPath, exists ? "replace" : "create", {
      target: exePath,
      cwd: path.dirname(exePath),
      description: "TPV Recipok",
      icon: exePath,
      iconIndex: 0,
    });
    console.log(
      `[shortcut] ${exists ? "reparado" : "creado"}: ${shortcutPath} -> ${exePath}`,
    );
  } catch (e) {
    console.warn("[shortcut] no se pudo verificar/reparar:", e?.message || e);
  }
}

function ensureAppShortcuts() {
  if (process.platform !== "win32") return;
  if (!app.isPackaged) return;
  try {
    const exePath = app.getPath("exe");
    if (!exePath || !fs.existsSync(exePath)) return; // sin exe no hay nada que hacer

    const name = shortcutBaseName();

    const desktop = app.getPath("desktop");
    if (desktop) {
      ensureOneShortcut(path.join(desktop, `${name}.lnk`), exePath, {
        createIfMissing: true,
      });
    }

    // Menu Inicio: salvavidas si el del escritorio muere.
    const startMenu = path.join(
      app.getPath("appData"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      `${name}.lnk`,
    );
    ensureOneShortcut(startMenu, exePath, { createIfMissing: true });
  } catch (e) {
    console.warn("[shortcut] ensureAppShortcuts fallo:", e?.message || e);
  }
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
  // E2E (incluidas las pruebas manuales multi-TPV) nunca en kiosco, para poder
  // ver y colocar las ventanas lado a lado.
  if (IS_E2E) return false;
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
  if (appIsInstallingUpdate) return;
  const isDev = !app.isPackaged;
  const e2eBackground = IS_E2E_BACKGROUND;
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
      devTools: isDev && !e2eBackground,
      // No frenar timers cuando la ventana no esta enfocada/visible: un TPV en
      // segundo plano debe seguir sincronizando aparcados (cada 10s) y su
      // contador de "ultimo sync" no debe congelarse. Importante en multi-TPV.
      backgroundThrottling: false,
    },
  });

  if (e2eBackground) {
    try {
      mainWin.setSkipTaskbar(false);
    } catch (_) {}
  }

  mainWin.setTitle(getWindowTitle());

  // ✅ Bloquear cierre con la X si hay caja abierta o tickets aparcados
  let allowMainClose = false;

  mainWin.on("close", async (e) => {
    // Si el cierre viene “permitido” (ej: app.quit controlado), dejamos pasar
    if (allowMainClose) return;

    // Cierre especial para actualización manual/programática.
    if (appIsInstallingUpdate || forceRelaunchForUpdate) {
      allowMainClose = true;
      return;
    }

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

    if ((guards.parkedCount || 0) > 0 && !guards.allowCloseWithParked) {
      mainWin.webContents.send("tpv:guard", {
        title: "Tickets aparcados",
        text: "No puedes cerrar el programa hasta recuperar o eliminar los tickets aparcados.",
      });
      return;
    }

    // ✅ permitir cierre real
    allowMainClose = true;
    mainWin.close();
    destroyCustomerWindow();
  });

  // aplica el modo inicial
  applyKioskMode(mainWin, kioskMode);

  // carga UI
  loadUI(mainWin);

  if (!app.isPackaged) {
    if (e2eBackground) {
      mainWin.webContents.openDevTools({ mode: "detach", activate: false });
    } else {
      mainWin.webContents.openDevTools({ mode: "right" }); // o "detach"
    }
  }

  mainWin.once("ready-to-show", () => {
    if (appIsInstallingUpdate) return;
    if (!mainWin || mainWin.isDestroyed()) return;

    if (e2eBackground) {
      try {
        if (typeof mainWin.showInactive === "function") {
          mainWin.showInactive();
        } else {
          mainWin.show();
        }
      } catch (_) {}

      try {
        mainWin.minimize();
      } catch (_) {}

      return;
    }

    mainWin.show();
    notifyPostUpdateSplashReady();
    // si NO es kiosk, maximiza al arrancar
    if (!kioskMode) {
      try {
        mainWin.maximize();
      } catch (_) {}
    }
  });
}

let preCashUpdateTimer = null;
let preCashUpdateRunning = false;
let manualUpdateCheckRunning = false;

async function isCashOpenSafe() {
  if (!mainWin || mainWin.isDestroyed()) return false;
  try {
    const guards = await mainWin.webContents.executeJavaScript(
      "window.__TPV_GUARDS__ && window.__TPV_GUARDS__()",
      true,
    );
    return !!guards?.cashOpen;
  } catch {
    return false;
  }
}

async function runUpdateCheckOncePreCash() {
  // evita solapes
  if (preCashUpdateRunning) return { ok: false, reason: "busy" };
  preCashUpdateRunning = true;

  try {
    // si ya hay caja, no tocar
    if (await isCashOpenSafe()) return { ok: false, reason: "cashOpen" };

    // listeners locales SOLO para este intento
    autoUpdater.removeAllListeners();

    const channel = readChannel();
    const policy = await loadUpdatePolicy(channel);
    const currentVersion = app.getVersion();

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = channel === "beta";
    autoUpdater.allowDowngrade = shouldAllowDowngrade(policy, currentVersion);

    return await new Promise((resolve) => {
      let finished = false;
      const done = (r) => {
        if (finished) return;
        finished = true;
        try {
          autoUpdater.removeAllListeners();
        } catch {}
        resolve(r);
      };

      autoUpdater.once("error", (err) => {
        done({
          ok: false,
          reason: "error",
          error: err?.message || String(err),
        });
      });

      autoUpdater.once("update-not-available", () => {
        done({ ok: true, updated: false });
      });

      autoUpdater.once("update-available", (info) => {
        const targetVersion = String(info?.version || "").trim();
        if (isTargetVersionBlocked(policy, targetVersion)) {
          logUpdater(
            `[POLICY] blocked update pre-cash: ${currentVersion} -> ${targetVersion}`,
          );
          return done({
            ok: true,
            updated: false,
            blockedByPolicy: true,
            targetVersion,
          });
        }

        try {
          autoUpdater.downloadUpdate();
        } catch (err) {
          done({
            ok: false,
            reason: "download-throw",
            error: err?.message || String(err),
          });
        }
      });

      autoUpdater.once("update-downloaded", async () => {
        // última comprobación: si alguien abrió caja justo ahora, NO instalar
        const cashOpen = await isCashOpenSafe();
        if (cashOpen)
          return done({ ok: false, reason: "cashOpenedDuringDownload" });

        // instalar (tu comportamiento actual)
        try {
          spawnPostUpdateSplash();
          setTimeout(() => autoUpdater.quitAndInstall(true, true), 400);
        } catch {}
        done({ ok: true, updated: true, installing: true });
      });

      try {
        autoUpdater.checkForUpdates();
      } catch (e) {
        done({ ok: false, reason: "throw", error: e?.message || String(e) });
      }
    });
  } finally {
    preCashUpdateRunning = false;
  }
}

async function runManualUpdateAvailabilityCheck() {
  if (!app.isPackaged) {
    const channel = readChannel();
    const policy = await loadUpdatePolicy(channel);
    const currentVersion = app.getVersion();
    const probe = await fetchLatestGithubReleaseVersion(channel);

    if (!probe.ok) {
      return {
        ok: false,
        devMode: true,
        updateAvailable: false,
        reason: "dev-probe-failed",
        message: `No se pudo consultar GitHub (${probe.error || "error desconocido"}).`,
      };
    }

    const targetVersion = String(probe.version || "").trim();
    const isNewer =
      compareVersionsSemverLoose(targetVersion, currentVersion) > 0;
    const blockedByPolicy = isTargetVersionBlocked(policy, targetVersion);
    const wouldDownload = isNewer && !blockedByPolicy;

    const message = blockedByPolicy
      ? `Simulación npm start: GitHub tiene ${targetVersion}, pero está bloqueada por policy.`
      : wouldDownload
        ? `Simulación npm start: Detectada ${targetVersion}. En app instalada se descargaría e instalaría al reiniciar.`
        : `Simulación npm start: Estás al día (${currentVersion}).`;

    return {
      ok: true,
      devMode: true,
      updateAvailable: wouldDownload,
      blockedByPolicy,
      currentVersion,
      targetVersion,
      wouldDownload,
      githubRepo: probe.repo,
      githubTag: probe.tag,
      message,
    };
  }

  if (manualUpdateCheckRunning || preCashUpdateRunning) {
    return { ok: false, reason: "busy", message: "Comprobación en curso." };
  }

  manualUpdateCheckRunning = true;
  try {
    autoUpdater.removeAllListeners();

    const channel = readChannel();
    const policy = await loadUpdatePolicy(channel);
    const currentVersion = app.getVersion();

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = channel === "beta";
    autoUpdater.allowDowngrade = shouldAllowDowngrade(policy, currentVersion);

    return await new Promise((resolve) => {
      let finished = false;
      const done = (payload) => {
        if (finished) return;
        finished = true;
        try {
          autoUpdater.removeAllListeners();
        } catch {}
        resolve(payload);
      };

      autoUpdater.once("error", (err) => {
        done({
          ok: false,
          reason: "error",
          message: err?.message || String(err),
        });
      });

      autoUpdater.once("update-not-available", () => {
        done({
          ok: true,
          updateAvailable: false,
          currentVersion,
          message: "Estás en la versión más reciente.",
        });
      });

      autoUpdater.once("update-available", (info) => {
        const targetVersion = String(info?.version || "").trim();
        if (isTargetVersionBlocked(policy, targetVersion)) {
          return done({
            ok: true,
            updateAvailable: false,
            blockedByPolicy: true,
            targetVersion,
            message: `La versión ${targetVersion || "nueva"} está bloqueada por política.`,
          });
        }

        done({
          ok: true,
          updateAvailable: true,
          currentVersion,
          targetVersion,
          message: "Nueva versión encontrada.",
        });
      });

      try {
        autoUpdater.checkForUpdates();
      } catch (err) {
        done({
          ok: false,
          reason: "throw",
          message: err?.message || String(err),
        });
      }

      setTimeout(() => {
        done({
          ok: false,
          reason: "timeout",
          message: "No se pudo comprobar actualización a tiempo.",
        });
      }, 25000);
    });
  } finally {
    manualUpdateCheckRunning = false;
  }
}

function startPreCashUpdateRetries() {
  // seguridad
  stopPreCashUpdateRetries();

  const maxMinutes = 12; // límite total de reintentos
  const everyMs = 45 * 1000; // cada 45s
  const startedAt = Date.now();

  preCashUpdateTimer = setInterval(async () => {
    // corta por tiempo
    if (Date.now() - startedAt > maxMinutes * 60 * 1000) {
      stopPreCashUpdateRetries();
      return;
    }

    // si ya hay caja abierta, parar
    const cashOpen = await isCashOpenSafe();
    if (cashOpen) {
      stopPreCashUpdateRetries();
      return;
    }

    // intenta check
    await runUpdateCheckOncePreCash();
  }, everyMs);
}

function stopPreCashUpdateRetries() {
  if (preCashUpdateTimer) clearInterval(preCashUpdateTimer);
  preCashUpdateTimer = null;
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

// ===== Splash de "instalando" (hueco del instalador NSIS silencioso) =====
// Ver nota junto a IS_POST_UPDATE_SPLASH mas arriba. Solo tiene sentido en
// Windows: es el unico caso donde quitAndInstall cierra la app, lanza un
// instalador SILENCIOSO (sin ninguna ventana propia) y vuelve a abrir la app
// sola, dejando un hueco sin ningun indicador visual.
function postUpdateSplashMarkerPath() {
  return path.join(app.getPath("temp"), "tpv-recipok-post-update-ready.flag");
}

// Llamar justo antes de quitAndInstall(): lanza un proceso independiente
// (mismo ejecutable, con un flag especial) que sobrevive a que esta app se
// cierre, y que se queda mostrando "Instalando..." hasta que la nueva version
// avise de que ya se ve (o hasta un tope de seguridad).
function spawnPostUpdateSplash() {
  if (process.platform !== "win32") return;
  try {
    try {
      fs.unlinkSync(postUpdateSplashMarkerPath());
    } catch (_) {}

    const args = app.isPackaged
      ? ["--post-update-splash"]
      : [app.getAppPath(), "--post-update-splash"];

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (e) {
    logUpdater(
      `No se pudo lanzar la ventana de "instalando": ${e?.message || e}`,
    );
  }
}

// Llamar en cuanto la ventana principal de una nueva version ya se muestra
// (ver mainWin.show() en createWindow): si hay un splash de instalacion
// esperando, esto es su señal para cerrarse.
function notifyPostUpdateSplashReady() {
  try {
    fs.writeFileSync(postUpdateSplashMarkerPath(), String(Date.now()));
  } catch (_) {}
}

// Cuerpo completo del proceso "--post-update-splash": no hace nada del
// arranque normal (sin instancia unica, sin login, sin auto-update...), solo
// una ventanita que espera a que aparezca el marcador de "ya se ve la app
// real" (o un tope de 30s por si algo falla) y luego se cierra sola.
function runPostUpdateSplashProcess() {
  // Perfil de Chromium propio y separado del de la app real: este proceso
  // nunca pide el bloqueo de instancia unica (requestSingleInstanceLock), y
  // ademas al usar su propia carpeta de userData no puede llegar a compartir
  // ningun candado/fichero de sesion con el perfil real -- la nueva version
  // real, cuando arranque, no debe encontrarse NADA que le haga pensar que ya
  // hay una instancia corriendo.
  try {
    app.setPath(
      "userData",
      path.join(app.getPath("temp"), "tpv-recipok-post-update-splash"),
    );
  } catch (_) {}

  app.whenReady().then(() => {
    const win = new BrowserWindow({
      width: 420,
      height: 220,
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      closable: false,
      // Sin skipTaskbar: si el usuario pone otra ventana delante (no es
      // alwaysOnTop, ver mas abajo), necesita algun sitio desde donde
      // recuperarla -- sin icono en la barra de tareas se quedaria sin forma
      // de volver a verla salvo minimizando todo.
      show: false,
      // Sin alwaysOnTop: aparece delante al crearse (como cualquier ventana
      // nueva), pero no se impone sobre lo que el usuario haga despues en
      // otras ventanas mientras dura la instalacion.
      center: true,
      backgroundColor: "#111827",
      icon: path.join(__dirname, "assets", "icon.png"),
      webPreferences: {
        contextIsolation: true,
        sandbox: false,
      },
    });

    win.removeMenu();

    const html = `
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
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
        .box{ width: 84%; text-align:center; }
        .title{ font-size: 17px; font-weight: 700; margin-bottom: 14px; }
        .bar{
          width:100%;
          height:10px;
          background:#1f2937;
          border-radius:999px;
          overflow:hidden;
          border:1px solid rgba(255,255,255,0.08);
          position:relative;
        }
        .bar .fill{
          position:absolute;
          top:0; left:-40%;
          height:100%;
          width:40%;
          background:#22c55e;
          border-radius:999px;
          animation: slide 1.1s ease-in-out infinite;
        }
        @keyframes slide{
          0% { left: -40%; }
          100% { left: 100%; }
        }
        .hint{ margin-top: 16px; font-size: 12px; opacity: 0.65; }
      </style>
    </head>
    <body>
      <div class="box">
        <div class="title">Instalando TPV Recipok...</div>
        <div class="bar"><div class="fill"></div></div>
        <div class="hint">No apagues el ordenador. Esto tarda solo unos segundos.</div>
      </div>
    </body>
    </html>
    `;

    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    win.once("ready-to-show", () => win.show());

    const markerPath = postUpdateSplashMarkerPath();
    const POLL_MS = 300;
    const MAX_WAIT_MS = 30000;
    const startedAt = Date.now();

    const timer = setInterval(() => {
      let ready = false;
      try {
        ready = fs.existsSync(markerPath);
      } catch (_) {}

      if (!ready && Date.now() - startedAt < MAX_WAIT_MS) return;

      clearInterval(timer);
      try {
        fs.unlinkSync(markerPath);
      } catch (_) {}
      try {
        win.destroy();
      } catch (_) {}
      app.quit();
    }, POLL_MS);
  });
}

// (opcional) log a fichero para depurar en clientes
function logUpdater(...args) {
  try {
    const p = path.join(app.getPath("userData"), "updater.log");
    fs.appendFileSync(p, args.map((a) => String(a)).join(" ") + "\n");
  } catch {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dnsOk(hostname) {
  try {
    await dns.promises.lookup(hostname);
    return true;
  } catch {
    return false;
  }
}

function httpsGetOk(url, { headers = {}, timeoutMs = 7000 } = {}) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);

      const req = https.request(
        {
          method: "GET",
          hostname: u.hostname,
          path: u.pathname + (u.search || ""),
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          const ok = res.statusCode >= 200 && res.statusCode < 400;
          res.resume();
          resolve({ ok, status: res.statusCode || 0 });
        },
      );

      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, status: 0, error: "timeout" });
      });
      req.on("error", (e) =>
        resolve({ ok: false, status: 0, error: e?.message || String(e) }),
      );
      req.end();
    } catch (e) {
      resolve({ ok: false, status: 0, error: e?.message || String(e) });
    }
  });
}

function httpsGetJson(url, { headers = {}, timeoutMs = 7000 } = {}) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);

      const req = https.request(
        {
          method: "GET",
          hostname: u.hostname,
          path: u.pathname + (u.search || ""),
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode || 0;
            if (status < 200 || status >= 300) {
              return resolve({ ok: false, status, error: "http-status" });
            }
            try {
              const json = JSON.parse(body || "{}");
              resolve({ ok: true, status, json });
            } catch {
              resolve({ ok: false, status, error: "invalid-json" });
            }
          });
        },
      );

      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, status: 0, error: "timeout" });
      });
      req.on("error", (e) =>
        resolve({ ok: false, status: 0, error: e?.message || String(e) }),
      );
      req.end();
    } catch (e) {
      resolve({ ok: false, status: 0, error: e?.message || String(e) });
    }
  });
}

function normalizeUpdatePolicy(raw, channel) {
  const src = raw && typeof raw === "object" ? raw : {};
  const blocked = Array.isArray(src.blockUpdateToVersions)
    ? src.blockUpdateToVersions
    : [];
  const downgradeFrom = Array.isArray(src.allowDowngradeFromVersions)
    ? src.allowDowngradeFromVersions
    : [];

  const normalizeVersionList = (list) => [
    ...new Set(list.map((v) => String(v || "").trim()).filter(Boolean)),
  ];

  return {
    channel,
    blockUpdateToVersions: normalizeVersionList(blocked),
    allowDowngrade: src.allowDowngrade === true,
    allowDowngradeFromVersions: normalizeVersionList(downgradeFrom),
  };
}

async function loadUpdatePolicy(channel) {
  const channelCfg = readChannelConfig();
  const policyUrl =
    String(channelCfg.updatePolicyUrl || "").trim() ||
    DEFAULT_UPDATE_POLICY_URLS[channel] ||
    "";

  if (!policyUrl) {
    return normalizeUpdatePolicy({}, channel);
  }

  const headers = {
    Accept: "application/json",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const res = await httpsGetJson(policyUrl, { headers, timeoutMs: 7000 });
  if (!res.ok) {
    logUpdater(
      `[POLICY] fallback local defaults: channel=${channel} url=${policyUrl} error=${res.error || res.status}`,
    );
    return normalizeUpdatePolicy({}, channel);
  }

  return normalizeUpdatePolicy(res.json, channel);
}

function shouldAllowDowngrade(policy, currentVersion) {
  if (!policy) return false;
  if (policy.allowDowngrade) return true;
  const current = String(currentVersion || "").trim();
  if (!current) return false;
  return policy.allowDowngradeFromVersions.includes(current);
}

function isTargetVersionBlocked(policy, targetVersion) {
  if (!policy) return false;
  const target = String(targetVersion || "").trim();
  if (!target) return false;
  return policy.blockUpdateToVersions.includes(target);
}

function cleanVersionTag(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
}

function parseComparableVersion(value) {
  const src = cleanVersionTag(value);
  if (!src) return null;

  const [mainPart, prePart] = src.split("-");
  const nums = String(mainPart || "")
    .split(".")
    .map((x) => Number(x));

  if (!nums.length || nums.some((n) => !Number.isFinite(n) || n < 0)) {
    return null;
  }

  while (nums.length < 3) nums.push(0);

  const pre = String(prePart || "")
    .split(".")
    .map((x) => x.trim())
    .filter(Boolean);

  return { nums, pre };
}

function compareVersionsSemverLoose(a, b) {
  const va = parseComparableVersion(a);
  const vb = parseComparableVersion(b);
  if (!va || !vb) return 0;

  for (let i = 0; i < 3; i++) {
    const da = Number(va.nums[i] || 0);
    const db = Number(vb.nums[i] || 0);
    if (da > db) return 1;
    if (da < db) return -1;
  }

  const aPre = va.pre;
  const bPre = vb.pre;

  if (!aPre.length && !bPre.length) return 0;
  if (!aPre.length) return 1;
  if (!bPre.length) return -1;

  const len = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < len; i++) {
    const pa = aPre[i];
    const pb = bPre[i];
    if (pa == null) return -1;
    if (pb == null) return 1;

    const na = Number(pa);
    const nb = Number(pb);
    const aNum = Number.isFinite(na) && String(na) === pa;
    const bNum = Number.isFinite(nb) && String(nb) === pb;

    if (aNum && bNum) {
      if (na > nb) return 1;
      if (na < nb) return -1;
      continue;
    }
    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;

    const cmp = String(pa).localeCompare(String(pb), "en", {
      sensitivity: "base",
      numeric: true,
    });
    if (cmp > 0) return 1;
    if (cmp < 0) return -1;
  }

  return 0;
}

async function fetchLatestGithubReleaseVersion(channel) {
  const ch = channel === "beta" ? "beta" : "stable";
  const repo = GITHUB_UPDATE_REPOS[ch] || GITHUB_UPDATE_REPOS.stable;
  const url = `https://api.github.com/repos/${repo}/releases?per_page=20`;

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "TPVRecipok-Updater",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const res = await httpsGetJson(url, { headers, timeoutMs: 8000 });
  if (!res.ok || !Array.isArray(res.json)) {
    return {
      ok: false,
      error: res.error || `http-${res.status || 0}`,
      repo,
    };
  }

  const releases = res.json.filter((r) => r && r.draft !== true);
  if (!releases.length) {
    return { ok: false, error: "no-releases", repo };
  }

  let pick = null;
  if (ch === "beta") {
    pick = releases.find((r) => r.prerelease === true) || releases[0];
  } else {
    pick = releases.find((r) => r.prerelease !== true) || releases[0];
  }

  const tag = String(pick?.tag_name || pick?.name || "").trim();
  const version = cleanVersionTag(tag);
  if (!version) {
    return { ok: false, error: "invalid-tag", repo };
  }

  return {
    ok: true,
    repo,
    tag,
    version,
    prerelease: !!pick?.prerelease,
    publishedAt: pick?.published_at || "",
  };
}

function getCompanyFromCfgForMain() {
  const cfg = readCfg();
  const baseUrl = String(cfg["company.baseUrl"] || "").trim();
  const apiKey = String(cfg["company.apiKey"] || "").trim();
  const email = String(cfg["company.email"] || "").trim();
  return { baseUrl, apiKey, email };
}

// A partir de este tiempo esperando en un mismo reintento, se añade una
// pista visible en pantalla (sigue reintentando igual, solo que ahora se
// entiende por que: evita que parezca que el programa se ha colgado).
const SLOW_RETRY_HINT_MS = 20_000;

// Sin salida real a internet (ni Google, ni Cloudflare, ni GitHub responden)
// tras esperar un rato razonable, se deja abrir con la version actual en vez
// de reintentar para siempre. Sin internet el TPV no puede hablar con NINGUN
// servidor real de todos modos, asi que el riesgo que esta comprobacion
// evita (un cliente desactualizado hablando con el servidor real) no existe
// mientras dure el corte. Si SI hay internet pero falla la API del cliente o
// la busqueda de actualizacion en GitHub, esto no aplica: ahi se sigue
// reintentando para siempre (es justo el caso que la comprobacion protege).
const NO_INTERNET_BYPASS_MS = 50_000;

function elapsedRetryHint(startedAt) {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs < SLOW_RETRY_HINT_MS) return "";
  const elapsedSec = Math.floor(elapsedMs / 1000);
  return ` (llevas ${elapsedSec}s esperando; comprueba tu conexión a internet)`;
}

async function waitForInternetAndApiGate() {
  // 1) Internet real (evita "wifi con portal cautivo" o sin salida)
  let attempt = 0;
  const internetCheckStartedAt = Date.now();

  // Probes: si alguno responde, consideramos "hay salida"
  // (usa varios por si GitHub está bloqueado en alguna red)
  const internetProbes = [
    // Google 204: si devuelve 204/3xx suele indicar salida real
    { url: "https://www.google.com/generate_204", label: "Google" },
    // Cloudflare: muy disponible
    { url: "https://1.1.1.1", label: "Cloudflare" },
    // GitHub: útil para tu updater (pero no depender SOLO de él)
    { url: "https://github.com", label: "GitHub" },
  ];

  while (true) {
    attempt++;

    if (Date.now() - internetCheckStartedAt >= NO_INTERNET_BYPASS_MS) {
      logUpdater(
        "[GATE] Sin internet tras espera razonable, se abre con la version actual.",
      );
      splashSet(
        "Sin conexión: abriendo con la versión actual...",
        20,
      );
      await sleep(600);
      return { ok: true, noInternet: true };
    }

    splashSet(
      `Comprobando internet... (intento ${attempt})${elapsedRetryHint(internetCheckStartedAt)}`,
      10,
    );

    // DNS rápido (con 2-3 hosts distintos)
    const dnsAny =
      (await dnsOk("google.com")) ||
      (await dnsOk("cloudflare.com")) ||
      (await dnsOk("github.com"));

    if (!dnsAny) {
      splashSet(
        `Sin internet (DNS). Esperando conexión...${elapsedRetryHint(internetCheckStartedAt)}`,
        10,
      );
      await sleep(2500);
      continue;
    }

    splashSet("Internet detectado. Verificando salida...", 25);

    // HTTPS real: basta con que UNO funcione
    let okOut = false;
    for (const p of internetProbes) {
      const r = await httpsGetOk(p.url, { timeoutMs: 7000 });
      if (r.ok || (r.status >= 200 && r.status < 500)) {
        // Nota: algunos probes pueden devolver 403/404 pero eso confirma salida.
        // Con tu httpsGetOk actual, ok = 200..399, pero aquí aceptamos 4xx como "hay internet".
        okOut = true;
        break;
      }
    }

    if (!okOut) {
      splashSet(
        `Conectado a red, pero sin salida a internet. Reintentando...${elapsedRetryHint(internetCheckStartedAt)}`,
        25,
      );
      await sleep(2500);
      continue;
    }

    break; // ✅ Internet OK
  }

  // 2) API OK (solo si ya hay empresa configurada en cfg)
  // A partir de aqui SI hay internet real: si esta parte falla (servidor del
  // cliente caido, etc.) se sigue reintentando para siempre a proposito, sin
  // ningun bypass.
  const { baseUrl, apiKey, email } = getCompanyFromCfgForMain();

  // Si todavía no hay empresa resuelta, no bloqueamos por API:
  // la UI necesitará internet igual para activarse (y pedirá email).
  if (!baseUrl || !apiKey) {
    splashSet("Internet OK. Preparando...", 55);
    return { ok: true };
  }

  let apiAttempt = 0;
  const apiCheckStartedAt = Date.now();
  while (true) {
    apiAttempt++;
    splashSet(
      `Conectando con servidor... (${email || "empresa"}) (intento ${apiAttempt})${elapsedRetryHint(apiCheckStartedAt)}`,
      55,
    );

    const url = `${baseUrl.replace(/\/+$/, "")}/productos?limit=1`;
    const rr = await httpsGetOk(url, {
      timeoutMs: 7000,
      headers: { Accept: "application/json", Token: apiKey },
    });

    if (rr.ok) {
      splashSet("Servidor OK. Buscando actualizaciones...", 70);
      return { ok: true };
    }

    // Si el token/baseUrl están mal, no nos quedamos en bucle infinito:
    // dejamos que la UI gestione re-activación / re-login.
    if ([401, 403, 404].includes(rr.status)) {
      splashSet(
        "Servidor responde pero credenciales no válidas. Abriendo...",
        70,
      );
      await sleep(400);
      return { ok: true };
    }

    splashSet(
      `Servidor no disponible todavía. Esperando...${elapsedRetryHint(apiCheckStartedAt)}`,
      55,
    );
    await sleep(2500);
  }
}

let appIsInstallingUpdate = false;
// Se puso true en este arranque porque no habia internet de verdad (ver
// NO_INTERNET_BYPASS_MS): la app se abrio con la version actual sin poder
// comprobar actualizaciones. La UI lo consulta una vez al arrancar para
// mostrar un aviso fijo.
let startupNoInternetFlag = false;

async function runAutoUpdateGate() {
  if (IS_E2E_BACKGROUND) {
    return { updatedOrReady: true };
  }

  if (process.platform === "linux" && !process.env.APPIMAGE) {
    return { updatedOrReady: true };
  }
  if (!app.isPackaged) return { updatedOrReady: true };

  createSplashWindow();
  splashSet("Comprobando conexión…", 5);

  // Bloquea hasta internet + API si hay cfg
  const netGate = await waitForInternetAndApiGate();

  // De verdad no hay internet (ver NO_INTERNET_BYPASS_MS): se abre con la
  // version actual sin buscar actualizacion, avisando en la propia app.
  if (netGate?.noInternet) {
    return { updatedOrReady: true, noInternet: true };
  }

  splashSet("Buscando actualizaciones...", 20);

  autoUpdater.removeAllListeners();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const channel = readChannel();
  autoUpdater.allowPrerelease = channel === "beta";

  try {
    delete autoUpdater.channel;
  } catch {}

  // ✅ REINTENTO: si el updater se queda pillado o tarda demasiado, reintenta
  const CHECK_TIMEOUT_MS = 60_000; // 60s para cada intento
  const RETRY_WAIT_MS = 5_000; // espera entre intentos
  let attempt = 0;
  const updateCheckStartedAt = Date.now();

  while (true) {
    attempt++;
    splashSet(
      `Buscando actualizaciones... (intento ${attempt})${elapsedRetryHint(updateCheckStartedAt)}`,
      25,
    );

    const policy = await loadUpdatePolicy(channel);
    const currentVersion = app.getVersion();
    autoUpdater.allowDowngrade = shouldAllowDowngrade(policy, currentVersion);

    const result = await new Promise((resolve) => {
      let finished = false;
      const done = (r) => {
        if (finished) return;
        finished = true;
        try {
          autoUpdater.removeAllListeners();
        } catch {}
        resolve(r);
      };

      const onProgress = (p) => {
        const pct = typeof p?.percent === "number" ? p.percent : 0;
        splashSet("Descargando actualización…", pct);
      };

      autoUpdater.once("error", () => {
        done({ ok: false, reason: "error" });
      });

      autoUpdater.once("update-not-available", () => {
        done({ ok: true, updatedOrReady: true, updated: false });
      });

      autoUpdater.once("update-available", (info) => {
        const targetVersion = String(info?.version || "").trim();
        if (isTargetVersionBlocked(policy, targetVersion)) {
          splashSet(
            `Version ${targetVersion} bloqueada por seguridad. Abriendo TPV...`,
            30,
          );
          logUpdater(
            `[POLICY] blocked update startup: ${currentVersion} -> ${targetVersion}`,
          );
          return done({
            ok: true,
            updatedOrReady: true,
            updated: false,
            blockedByPolicy: true,
            targetVersion,
          });
        }

        splashSet("Actualización encontrada. Descargando…", 30);
        try {
          autoUpdater.downloadUpdate();
        } catch {
          done({ ok: false, reason: "download-throw" });
        }
      });

      autoUpdater.on("download-progress", onProgress);

      autoUpdater.once("update-downloaded", () => {
        appIsInstallingUpdate = true;
        splashSet("Instalando actualización…", 100);
        spawnPostUpdateSplash();
        setTimeout(() => autoUpdater.quitAndInstall(true, true), 600);
        setTimeout(() => {
          try {
            app.exit(0);
          } catch {}
        }, 20000);
        done({ ok: true, updatedOrReady: false, installing: true });
      });

      try {
        autoUpdater.checkForUpdates();
      } catch {
        done({ ok: false, reason: "throw" });
      }

      // ✅ timeout de este intento: NO ABRIR, solo resolver para reintentar
      setTimeout(() => {
        done({ ok: false, reason: "timeout" });
      }, CHECK_TIMEOUT_MS);
    });

    // Si todo ok y no hay update -> salimos y abrimos TPV
    if (result?.ok && result.updatedOrReady) return { updatedOrReady: true };

    // Si está instalando -> no seguimos
    if (result?.installing) return result;

    // Si falló/timeout -> esperar y reintentar
    splashSet(
      `Conexión lenta / servidor ocupado. Reintentando…${elapsedRetryHint(updateCheckStartedAt)}`,
      25,
    );
    await sleep(RETRY_WAIT_MS);

    // Muy importante: limpiar listeners antes del siguiente intento
    try {
      autoUpdater.removeAllListeners();
    } catch {}
  }
}

// Feedback de cliente: el primer ticket/comanda de cada sesion tarda
// "muchisimo" en imprimir, y los siguientes van rapido. createHiddenPrintWindow
// crea una BrowserWindow nueva por cada impresion; el coste que se nota es el
// arranque en frio del primer proceso de renderizado de Chromium en toda la
// vida de la app (tipico de Electron), no algo especifico de comandas/Mesas
// -- afecta igual al primer ticket normal. Se "paga" ese coste solo, en
// segundo plano, justo al arrancar el TPV, antes de que haya una venta real
// esperando. printToPDF() (no print()) para no imprimir nada fisico ni
// depender de que impresora este configurada -- ejercita el mismo motor de
// maquetacion/impresion de Chromium que usa cualquier impresion real
// (Windows via print(), Linux via printToPDF en renderTicketPdf).
async function warmUpPrintPipeline() {
  let win = null;
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, sandbox: false },
    });
    await win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent("<!doctype html><meta charset=\"utf-8\">"),
    );
    await win.webContents.printToPDF({});
  } catch (e) {
    console.warn("[print-warmup] fallo (no critico):", e?.message || e);
  } finally {
    if (win) {
      try {
        win.close();
      } catch (_) {}
    }
  }
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

  // Espera a que las imagenes (p.ej. el logo de la empresa) terminen de
  // cargar antes de imprimir. Si no, con "size: 80mm auto" Chromium a veces
  // calcula la altura de la pagina con el logo aun sin cargar, y el
  // contenido que viene despues (resumen de caja, etc.) se corta al
  // imprimir. Timeout de seguridad por si una imagen no llega a cargar.
  try {
    await win.webContents.executeJavaScript(`
      Promise.race([
        Promise.all(
          Array.from(document.images).map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise((resolve) => {
                  img.addEventListener("load", resolve, { once: true });
                  img.addEventListener("error", resolve, { once: true });
                })
          )
        ),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ])
    `);
  } catch (_) {}

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
// Impresion real de un ticket HTML (Windows: silencioso; Linux: PDF + lp).
// Extraido a funcion para reutilizarlo desde el handler normal y desde el boton
// "Imprimir" de la ventana de previsualizacion (modo pruebas).
async function printTicketHtml(html, deviceName) {
  if (!html) return { ok: false, error: "Falta html" };
  if (!deviceName) return { ok: false, error: "Falta deviceName" };

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

  if (process.platform === "linux") {
    try {
      const pdfPath = await renderTicketPdf(html);
      const r = await lpPdf(deviceName, pdfPath);
      try {
        fs.unlinkSync(pdfPath);
      } catch (_) {}
      return r;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  return { ok: false, error: `Sistema no soportado: ${process.platform}` };
}

// Previsualizacion de ticket SOLO en desarrollo (npm start) Y con el toggle de
// Opciones activado. Doble candado: nunca se activa en la app instalada
// (app.isPackaged) aunque existiera la cfg. Ver toggle en Opciones (renderer).
function isDevTicketPreviewActive() {
  try {
    return !app.isPackaged && readCfg().devTicketPreview === true;
  } catch {
    return false;
  }
}

function escapeForSrcdoc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function buildTicketPreviewWrapper(html, rawText) {
  const inner =
    typeof html === "string" && html.trim()
      ? html
      : "<!doctype html><meta charset=\"utf-8\">" +
        "<body style=\"font-family:monospace;white-space:pre-wrap;padding:12px;\">" +
        String(rawText || "(ticket vacio)")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;") +
        "</body>";
  const srcdoc = escapeForSrcdoc(inner);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Previsualizacion de ticket (pruebas)</title>
<style>
  html,body{margin:0;height:100%;background:#525659;font-family:system-ui,Arial,sans-serif;}
  .bar{position:sticky;top:0;z-index:2;display:flex;gap:10px;align-items:center;padding:8px 10px;background:#2b2f31;color:#fff;font-size:13px;}
  .bar button{cursor:pointer;border:0;border-radius:6px;padding:7px 14px;font-weight:600;background:#2563eb;color:#fff;font-size:13px;}
  .bar button:active{transform:translateY(1px);}
  .bar .msg{opacity:.85;}
  .paper{background:#fff;margin:14px auto;width:302px;box-shadow:0 2px 14px rgba(0,0,0,.45);}
  iframe{border:0;width:302px;display:block;min-height:120px;}
</style></head>
<body>
  <div class="bar">
    <button id="btnPrint" type="button">🖨 Imprimir</button>
    <span class="msg" id="msg">Previsualizacion (solo pruebas) — no se ha impreso nada</span>
  </div>
  <div class="paper"><iframe id="tk" srcdoc="${srcdoc}"></iframe></div>
  <script>
    var msg=document.getElementById('msg');
    var tk=document.getElementById('tk');
    tk.addEventListener('load',function(){try{tk.style.height=(tk.contentDocument.body.scrollHeight+24)+'px';}catch(e){}});
    document.getElementById('btnPrint').addEventListener('click',async function(){
      msg.textContent='Imprimiendo...';
      try{
        var r=(window.PREVIEW&&window.PREVIEW.print)?await window.PREVIEW.print():{ok:false,error:'sin puente'};
        msg.textContent=(r&&r.ok)?'Enviado a la impresora.':('Error: '+((r&&r.error)||'desconocido'));
      }catch(e){msg.textContent='Error: '+((e&&e.message)||e);}
    });
  </script>
</body></html>`;
}

let ticketPreviewWin = null;
let lastPreviewJob = null; // { html, deviceName }

async function openTicketPreview({ html, deviceName, rawText } = {}) {
  lastPreviewJob = { html: html || "", deviceName: deviceName || "" };
  const wrapper = buildTicketPreviewWrapper(html, rawText);
  try {
    if (!ticketPreviewWin || ticketPreviewWin.isDestroyed()) {
      ticketPreviewWin = new BrowserWindow({
        width: 380,
        height: 820,
        title: "Previsualizacion de ticket (solo pruebas)",
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, "preview_preload.js"),
          contextIsolation: true,
          sandbox: false,
        },
      });
      ticketPreviewWin.on("closed", () => {
        ticketPreviewWin = null;
      });
    }
    const dataUrl =
      "data:text/html;charset=utf-8," + encodeURIComponent(wrapper);
    await ticketPreviewWin.loadURL(dataUrl);
    ticketPreviewWin.show();
    ticketPreviewWin.focus();
    return { ok: true, preview: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

ipcMain.handle("ticket:print", async (_event, { html, deviceName }) => {
  if (isDevTicketPreviewActive()) {
    return openTicketPreview({ html, deviceName });
  }
  return printTicketHtml(html, deviceName);
});

// Imprimir de verdad el ticket que se esta previsualizando (boton de la ventana).
ipcMain.handle("ticket:previewPrint", async () => {
  if (!lastPreviewJob || !lastPreviewJob.html) {
    return { ok: false, error: "No hay ticket para imprimir" };
  }
  return printTicketHtml(lastPreviewJob.html, lastPreviewJob.deviceName);
});

ipcMain.handle("ticket:printRaw", async (_event, { bytes, deviceName }) => {
  if (isDevTicketPreviewActive()) {
    let rawText = "";
    try {
      rawText = Buffer.from(bytes || []).toString("utf8");
    } catch {
      /* bytes no convertibles a texto */
    }
    return openTicketPreview({ rawText });
  }
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

if (IS_E2E) {
  // Los runners de E2E (sandboxed, sin GPU real) hacen que el proceso de
  // GPU (y a veces el de red) de Electron se caiga a media prueba ("Target
  // crashed"). Nunca pasa en un PC real (esto solo se activa con
  // TPV_E2E=1, que el instalador normal jamas pone), asi que desactivar
  // aceleracion por hardware y el sandbox de Chromium aqui es seguro y no
  // cambia nada del comportamiento en produccion.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-setuid-sandbox");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
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
    console.log("[AUTOSTART] Estado detectado al arrancar:", cur);

    if (!cur?.openAtLogin) return;

    const exe = String(cur?.executable || "");
    const isSquirrelUpdateExe =
      process.platform === "win32" &&
      exe &&
      exe.toLowerCase().endsWith("\\update.exe");

    const isExactExe = exe === process.execPath;

    if (!isExactExe && !isSquirrelUpdateExe) {
      console.log(
        "[AUTOSTART] Entrada antigua o extraña detectada. Se desactiva.",
      );
      app.setLoginItemSettings({ openAtLogin: false });
    }
  } catch (e) {
    console.log(
      "[AUTOSTART] Error limpiando autostart antiguo:",
      e?.message || e,
    );
  }
}

function configureAutoStart() {
  if (!app.isPackaged) {
    return { ok: false, reason: "not-packaged" };
  }

  const cfg = readCfg();
  const want = cfg.autostart !== false; // default ON

  try {
    if (!want) {
      app.setLoginItemSettings({
        openAtLogin: false,
      });

      return { ok: true, enabled: false };
    }

    const autostartArgs = ["--autostart"];

    if (process.platform === "win32") {
      try {
        const exePath = process.execPath;
        const exeName = path.basename(exePath);
        const appFolder = path.dirname(exePath);
        const updateExe = path.resolve(appFolder, "..", "Update.exe");

        if (fs.existsSync(updateExe)) {
          app.setLoginItemSettings({
            openAtLogin: true,
            openAsHidden: false,
            path: updateExe,
            args: [
              "--processStart",
              exeName,
              "--process-start-args",
              autostartArgs.join(" "),
            ],
          });

          return { ok: true, mode: "squirrel" };
        }
      } catch {}
    }

    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
      path: process.execPath,
      args: autostartArgs,
    });

    return { ok: true, mode: "direct" };
  } catch (e) {
    console.log("[AUTOSTART] error:", e);
    return { ok: false, error: e?.message };
  }
}

function bootstrapCurrentUserFromCfg() {
  try {
    const cfg = readCfg();
    currentUser = {
      name: String(
        cfg["auth.username"] || cfg["tpv.lastUser"] || "",
      ).toLowerCase(),
      isAdmin: !!cfg["auth.isAdmin"],
    };
  } catch {}
}

function readStoredScaleConfigFromCfg() {
  const cfg = readCfg();

  return {
    enabled: !!cfg["scale.enabled"],
    portPath: String(cfg["scale.portPath"] || "").trim(),
    baudRate: Number(cfg["scale.baudRate"] || 9600),
    dataBits: Number(cfg["scale.dataBits"] || 8) === 7 ? 7 : 8,
    parity: ["none", "even", "odd", "mark", "space"].includes(
      String(cfg["scale.parity"] || "none").toLowerCase(),
    )
      ? String(cfg["scale.parity"] || "none").toLowerCase()
      : "none",
    stopBits: Number(cfg["scale.stopBits"] || 1) === 2 ? 2 : 1,
    chargeUnit: cfg["scale.chargeUnit"] === "kg" ? "kg" : "g",
    decimalPlaces: Number.isFinite(Number(cfg["scale.decimalPlaces"]))
      ? Number(cfg["scale.decimalPlaces"])
      : 4,
    consumeMode:
      cfg["scale.consumeMode"] === "single" ? "single" : "continuous",
    parserMode:
      cfg["scale.parserMode"] === "delimiter" ? "delimiter" : "timeout",
    delimiter: ["\\r\\n", "\\r", "\\n"].includes(
      String(cfg["scale.delimiter"] || ""),
    )
      ? String(cfg["scale.delimiter"])
      : "\\r\\n",
    interByteMs: Number.isFinite(Number(cfg["scale.interByteMs"]))
      ? Math.max(5, Number(cfg["scale.interByteMs"]))
      : 20,
    sourceUnit: cfg["scale.sourceUnit"] === "kg" ? "kg" : "g",
    reverseReading: !!cfg["scale.reverseReading"],
    conversionFactor: 1,
  };
}

async function tryReconnectScaleFromMain(reason = "timer") {
  if (scaleReconnectInFlight) return;

  const now = Date.now();
  if (now - lastScaleReconnectAttemptAt < 5000) return;
  lastScaleReconnectAttemptAt = now;

  const cfg = readStoredScaleConfigFromCfg();
  if (!cfg.enabled || !cfg.portPath) return;

  const state = scaleManager.getState();
  if (state?.enabled && state?.connected) return;

  scaleReconnectInFlight = true;
  try {
    await scaleManager.setEnabled(true, cfg);
    console.log("[SCALE] Reconexion OK desde main (", reason, ")");
  } catch (e) {
    console.log(
      "[SCALE] Reconexion pendiente desde main (",
      reason,
      "):",
      e?.message || String(e),
    );
  } finally {
    scaleReconnectInFlight = false;
  }
}

function startScaleReconnectMonitor() {
  if (scaleReconnectMonitorTimer) return;

  setTimeout(() => {
    tryReconnectScaleFromMain("startup-delay").catch(() => {});
  }, 2500);

  scaleReconnectMonitorTimer = setInterval(() => {
    tryReconnectScaleFromMain("interval").catch(() => {});
  }, 20000);
}

function stopScaleReconnectMonitor() {
  if (!scaleReconnectMonitorTimer) return;
  clearInterval(scaleReconnectMonitorTimer);
  scaleReconnectMonitorTimer = null;
}

scaleManager.setOnStateChange((payload) => {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win || win.isDestroyed()) continue;
      win.webContents.send("scale:state", payload);
    } catch (_) {}
  }
});

app.whenReady().then(async () => {
  if (!gotTheLock) {
    app.quit();
    return;
  }

  bootstrapCurrentUserFromCfg();
  cleanOldAutoStartIfWrong();
  configureAutoStart();

  const updateGate = await runAutoUpdateGate();

  // Si hay instalación en curso, NO abrir el TPV.
  if (updateGate?.installing) {
    console.log(
      "[UPDATER] Instalando actualización. No se abre la ventana principal.",
    );
    return;
  }

  startupNoInternetFlag = !!updateGate?.noInternet;

  createWindow();
  ensureAppShortcuts(); // verifica/repara acceso directo escritorio + Inicio
  startScaleReconnectMonitor();
  startPreCashUpdateRetries();

  if (isCustomerDisplayEnabled()) ensureCustomerWindow();
  registerShortcuts();
  closeSplash();

  // De fondo, sin bloquear el arranque ni el login: ver warmUpPrintPipeline.
  if (!IS_E2E) {
    warmUpPrintPipeline().catch(() => {});
  }
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

    if ((guards.parkedCount || 0) > 0 && !guards.allowCloseWithParked) {
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
  // Modo pruebas (npm start + toggle): no abrir el cajon fisico en la oficina.
  if (isDevTicketPreviewActive()) {
    return { ok: true, mocked: true, devPreview: true, deviceName };
  }

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

  if ((guards.parkedCount || 0) > 0 && !guards.allowCloseWithParked) {
    mainWin.webContents.send("tpv:guard", {
      title: "Tickets aparcados",
      text: "No puedes cerrar el programa hasta recuperar o eliminar los tickets aparcados.",
    });
    return { ok: false, reason: "parked" };
  }

  app.quit();
  return { ok: true };
});

ipcMain.handle("updater:getStartupNoInternetFlag", async () => {
  return { noInternet: startupNoInternetFlag };
});

ipcMain.handle("updater:checkManual", async () => {
  try {
    return await runManualUpdateAvailabilityCheck();
  } catch (e) {
    return {
      ok: false,
      reason: "exception",
      message: e?.message || String(e),
    };
  }
});

ipcMain.handle("updater:relaunchForUpdate", async () => {
  try {
    forceRelaunchForUpdate = true;
    appIsInstallingUpdate = true;

    // Evitar que queden timers/reintentos vivos durante el reinicio.
    stopPreCashUpdateRetries();

    // Cerrar explícitamente la pantalla de cliente para no dejarla colgada.
    destroyCustomerWindow();

    // Forzar cierre de la principal (su guard ya permite cerrar en modo update).
    if (mainWin && !mainWin.isDestroyed()) {
      try {
        mainWin.close();
      } catch {}
    }

    app.relaunch();

    setTimeout(() => {
      try {
        app.exit(0);
      } catch {}
    }, 20000);

    app.quit();
    return { ok: true };
  } catch (e) {
    forceRelaunchForUpdate = false;
    appIsInstallingUpdate = false;
    return {
      ok: false,
      reason: "relaunch-failed",
      message: e?.message || String(e),
    };
  }
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

  if ((guards.parkedCount || 0) > 0 && !guards.allowCloseWithParked) {
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
  stopScaleReconnectMonitor();

  // Red de seguridad: al cerrar la app, nunca dejar viva la ventana cliente.
  try {
    destroyCustomerWindow();
  } catch {}
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
// La pantalla de Opciones dispara ~30 llamadas "cfg:get" seguidas al abrirse,
// y cada una releia y parseaba el JSON entero desde disco. Con el fichero
// aun frio en cache del SO, esa primera tanda de lecturas podia notarse como
// varios segundos de espera. Se cachea en memoria y se invalida al escribir.
let __cfgCache = null;
function readCfg() {
  if (__cfgCache) return __cfgCache;
  try {
    __cfgCache = JSON.parse(fs.readFileSync(cfgPath(), "utf8"));
  } catch {
    __cfgCache = {};
  }
  return __cfgCache;
}
function writeCfg(patch) {
  const cur = readCfg();
  const next = { ...cur, ...patch };
  fs.writeFileSync(cfgPath(), JSON.stringify(next, null, 2), "utf8");
  __cfgCache = next;
  return next;
}

function isCustomerDisplayEnabled() {
  const cfg = readCfg();
  return cfg.customerDisplay === true; // default OFF
}

function getCustomerDisplayThemeMode() {
  const cfg = readCfg();
  return cfg.customerDisplayTheme === "light" ? "light" : "dark";
}

ipcMain.handle("cfg:get", (_e, key) => readCfg()[key]);
ipcMain.handle("cfg:set", (_e, key, value) => writeCfg({ [key]: value }));

ipcMain.handle("scale:listPorts", async () => {
  try {
    const ports = await scaleManager.listPorts();
    return { ok: true, ports };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), ports: [] };
  }
});

ipcMain.handle("scale:getState", async () => {
  try {
    return { ok: true, state: scaleManager.getState() };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), state: null };
  }
});

ipcMain.handle("scale:connect", async (_e, config) => {
  try {
    const state = await scaleManager.connect(config || {});
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle("scale:disconnect", async () => {
  try {
    await scaleManager.disconnect();
    return { ok: true, state: scaleManager.getState() };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle("scale:setEnabled", async (_e, enabled, config) => {
  try {
    const state = await scaleManager.setEnabled(!!enabled, config || null);
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle("scale:consumeWeight", async () => {
  try {
    return scaleManager.consumeWeight();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

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

const APP_MODE_CFG_KEY = "app.mode";

function getConfiguredAppMode() {
  const cfg = readCfg();
  const raw = String(cfg?.[APP_MODE_CFG_KEY] || "")
    .trim()
    .toLowerCase();
  return raw === "mesas" ? "mesas" : "tpv";
}

function getUiEntryPath() {
  const candidates = [
    path.join(__dirname, "index.html"),
    path.join(app.getAppPath(), "index.html"),
    path.join(__dirname, "mesas", "mesas.html"),
    path.join(app.getAppPath(), "mesas", "mesas.html"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return candidates[0];
}

function loadUI(win) {
  const entryPath = getUiEntryPath();
  const url = pathToFileURL(entryPath).toString();

  console.log("Loading UI:", entryPath);
  console.log("Loading URL:", url);

  return win.loadFile(entryPath).catch(console.log);
}

ipcMain.handle("auth:setCurrentUser", async (_e, { user, isAdmin } = {}) => {
  currentUser = {
    name: String(user || "").toLowerCase(),
    isAdmin: !!isAdmin,
  };
  return { ok: true };
});

function isAdmin() {
  return !!currentUser?.isAdmin;
}

ipcMain.handle("cfg:getAutostart", () => {
  const cfg = readCfg();

  return {
    ok: true,
    autostart: cfg.autostart !== false, // default ON
    packaged: app.isPackaged,
  };
});

ipcMain.handle("cfg:setAutostart", (_e, val) => {
  const want = !!val;

  writeCfg({ autostart: want });

  if (!app.isPackaged) {
    console.log("[AUTOSTART] Guardado pero ignorado (dev mode)");
    return {
      ok: true,
      autostart: want,
      packaged: false,
    };
  }

  const result = configureAutoStart();

  return {
    ok: !!result?.ok,
    autostart: want,
    packaged: true,
    result,
  };
});

ipcMain.handle("app:getVersion", () => {
  return {
    ok: true,
    version: app.getVersion(),
    packaged: !!app.isPackaged,
  };
});

function pickCustomerDisplay() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();

  // intenta usar otra distinta a la principal
  const other = displays.find((d) => d.id !== primary.id);

  return other || primary;
}

async function ensureCustomerWindow() {
  if (IS_E2E_BACKGROUND) return null;
  if (!isCustomerDisplayEnabled()) return null;
  if (customerWin && !customerWin.isDestroyed()) return customerWin;
  if (customerCreating) return null;

  customerCreating = true;

  try {
    const isDev = !app.isPackaged;
    const target = pickCustomerDisplay();
    const b = target.bounds;

    customerWin = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      show: false,
      backgroundColor: "#0b1220",
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, "customer_preload.js"),
        sandbox: false,
        devTools: isDev,
      },
    });

    customerWin.on("close", (e) => {
      if (!allowCustomerClose && isCustomerDisplayEnabled()) {
        e.preventDefault();
      }
    });

    customerWin.on("closed", () => {
      customerWin = null;
    });

    customerWin.setMenuBarVisibility(false);
    customerWin.setAutoHideMenuBar(true);
    customerWin.setBounds(b);

    customerWin.once("ready-to-show", () => {
      if (!customerWin || customerWin.isDestroyed()) return;
      customerWin.show();
      try {
        customerWin.setFullScreen(true);
      } catch {}
    });

    customerWin.webContents.on("did-finish-load", () => {
      const themeMode = getCustomerDisplayThemeMode();
      try {
        customerWin?.webContents?.send("customer:theme", themeMode);
      } catch {}

      if (lastCustomerState && customerWin && !customerWin.isDestroyed()) {
        customerWin.webContents.send("customer:state", lastCustomerState);
      }
    });

    await customerWin.loadFile(path.join(__dirname, "customer.html"));

    // red de seguridad
    if (customerWin && !customerWin.isDestroyed()) {
      customerWin.show();
      try {
        customerWin.setFullScreen(true);
      } catch {}
    }

    return customerWin;
  } catch (e) {
    try {
      if (customerWin && !customerWin.isDestroyed()) {
        allowCustomerClose = true;
        customerWin.destroy();
      }
    } catch {}
    customerWin = null;
    return null;
  } finally {
    customerCreating = false;
    allowCustomerClose = false;
  }
}

// Recibe estado desde TPV (renderer) y lo manda a la pantalla cliente
ipcMain.on("customer:setState", async (_e, state) => {
  lastCustomerState = state || null;

  if (!isCustomerDisplayEnabled()) return; // ✅ NO crear si está OFF

  const win = await ensureCustomerWindow();
  if (!win || win.isDestroyed()) return;

  try {
    if (win.webContents.isLoading()) return;
  } catch {}

  win.webContents.send("customer:state", lastCustomerState);
});

function destroyCustomerWindow() {
  if (!customerWin || customerWin.isDestroyed()) {
    customerWin = null;
    allowCustomerClose = false;
    return;
  }

  try {
    allowCustomerClose = true;

    customerWin.removeAllListeners("close");
    customerWin.close();

    if (customerWin && !customerWin.isDestroyed()) {
      customerWin.destroy();
    }
  } catch (e) {
    console.log("[CUSTOMER] error al destruir:", e?.message || e);
  } finally {
    customerWin = null;
    allowCustomerClose = false;
  }
}

ipcMain.handle("customer:getEnabled", async () => {
  return { ok: true, enabled: isCustomerDisplayEnabled() };
});

ipcMain.handle("customer:setEnabled", async (_e, enabled) => {
  if (!isAdmin()) return { ok: false, error: "FORBIDDEN" };

  const val = !!enabled;

  writeCfg({ customerDisplay: val });

  if (val) {
    const win = await ensureCustomerWindow();
    if (lastCustomerState && win && !win.isDestroyed()) {
      try {
        win.webContents.send("customer:state", lastCustomerState);
      } catch {}
    }
  } else {
    destroyCustomerWindow();
  }

  return { ok: true, enabled: val };
});

ipcMain.handle("customer:getTheme", async () => {
  return { ok: true, mode: getCustomerDisplayThemeMode() };
});

ipcMain.handle("customer:setTheme", async (_e, mode) => {
  const val = mode === "light" ? "light" : "dark";
  writeCfg({ customerDisplayTheme: val });

  if (customerWin && !customerWin.isDestroyed()) {
    try {
      customerWin.webContents.send("customer:theme", val);
    } catch {}
  }

  return { ok: true, mode: val };
});
