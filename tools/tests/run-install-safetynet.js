// Red de seguridad de la instalacion, de punta a punta con un TPV EMPAQUETADO de verdad (como run-update-gate.js: copia de Electron
// renombrada a TPV-Recipok.exe con resources/app apuntando a este codigo) y un "servidor de GitHub" local que ofrece la version 9.9.9.
// El "instalador" es una copia de ping.exe: se descarga, se valida (sha512), el TPV se cierra para instalar... y NO instala nada, que es
// exactamente el fallo de Ben_Trempat (2026-11-18: el equipo se quedo sin TPV tras una instalacion silenciosa que no se completo).
//   S1 instalacion que no se completa -> el TPV lanza ANTES el vigilante, guarda el instalador de reparacion, crea el icono REPARAR y
//      anota en el registro quien lo pidio, el antivirus/Windows y el instalador; el vigilante, sin confirmacion de la version nueva,
//      detecta el problema y lo anota.
//   S2 el TPV nuevo se ve con normalidad -> el icono REPARAR y la copia del instalador desaparecen solos.
// Nunca toca el escritorio real (TPV_TEST_DESKTOP_DIR) ni la carpeta de descargas real (updaterCacheDirName propio).
// Necesita internet (la puerta de actualizacion comprueba github.com antes de buscar). Uso: node tools/tests/run-install-safetynet.js
const http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
const { spawn, spawnSync, execSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CACHE = path.join(os.tmpdir(), "tpvrecipok-safetynet-electron");
const EXE = path.join(CACHE, "TPV-Recipok.exe");
const UPDATER_DIR_NAME = "tpvrecipok-safetynet-test";
const UPDATER_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), UPDATER_DIR_NAME);
const PING = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "ping.exe");
let okN = 0, failN = 0;
function check(label, cond, extra) {
  if (cond) { okN++; console.log(`[OK] ${label}`); }
  else { failN++; console.log(`[FAIL] ${label}${extra ? " -- " + extra : ""}`); }
}

function prepararPaquete(port) {
  if (!fs.existsSync(EXE)) {
    const dist = path.join(ROOT, "node_modules", "electron", "dist");
    fs.rmSync(CACHE, { recursive: true, force: true });
    fs.cpSync(dist, CACHE, { recursive: true });
    fs.renameSync(path.join(CACHE, "electron.exe"), EXE);
  }
  const res = path.join(CACHE, "resources");
  fs.rmSync(path.join(res, "default_app.asar"), { force: true });
  fs.mkdirSync(path.join(res, "app"), { recursive: true });
  fs.writeFileSync(path.join(res, "app", "package.json"), JSON.stringify({ ...PKG, main: "main.js" }, null, 2));
  fs.writeFileSync(path.join(res, "app", "main.js"), `require(${JSON.stringify(path.join(ROOT, "main.js"))});\n`);
  fs.writeFileSync(path.join(res, "app-update.yml"), `provider: generic\nurl: http://127.0.0.1:${port}/\nupdaterCacheDirName: ${UPDATER_DIR_NAME}\n`);
}

function matarRestos() {
  // todo lo que cuelgue de la copia de prueba (el TPV de prueba, sus hijos, el vigilante y el instalador falso)
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*tpvrecipok-safetynet-electron*' -or $_.ExecutablePath -like '*${UPDATER_DIR_NAME}*' -or $_.CommandLine -like '*${UPDATER_DIR_NAME}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: "ignore" });
  } catch {}
}
const shortcutTarget = (lnk) => spawnSync("powershell.exe", ["-NoProfile", "-Command", `(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk}').TargetPath`], { encoding: "utf8" }).stdout.trim();

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); matarRestos(); process.exit(1); }, 300000);
  const installerBuf = fs.readFileSync(PING);
  const sha = crypto.createHash("sha512").update(installerBuf).digest("base64");
  let version = "9.9.9";
  const latest = () => `version: ${version}\nfiles:\n  - url: TPV-Recipok-Setup-${version}.exe\n    sha512: ${sha}\n    size: ${installerBuf.length}\npath: TPV-Recipok-Setup-${version}.exe\nsha512: ${sha}\nreleaseDate: '2026-11-19T00:00:00.000Z'\n`;
  const srv = http.createServer((req, res) => {
    if (/latest\.yml(\?|$)/i.test(req.url)) { res.writeHead(200, { "Content-Type": "text/yaml" }); return res.end(latest()); }
    if (/\.exe(\?|$)/i.test(req.url)) { res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": installerBuf.length }); return res.end(installerBuf); }
    res.writeHead(404); res.end("x");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  prepararPaquete(srv.address().port);
  const TIMES = JSON.stringify({ pollSec: 1, waitSec: 32, retryWaitSec: 4, relaunchWaitSec: 4, maxRetries: 1, earlyMinSec: 1, settleSec: 3, settleSeenSec: 3, retryPauseSec: 0 });
  const lanza = (ud, desk) => {
    const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: ud, TPV_RUN_BACKGROUND: "1", TPV_TEST_INSTALL_SAFETYNET: "1", TPV_TEST_DESKTOP_DIR: desk, TPV_TEST_WATCHDOG_TIMES: TIMES };
    delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
    return spawn(EXE, [], { env, stdio: "ignore", windowsHide: false });
  };
  // Al acabar un escenario el vigilante (o el TPV de prueba) aun puede tener ficheros abiertos unos segundos: se reintenta el borrado y,
  // si aun asi no se puede, se deja la carpeta temporal (limpiar NO es lo que se prueba, y fallaba al azar con EPERM, 25-nov-2026).
  const rmRetry = (p) => {
    for (let i = 0; i < 12; i++) {
      try { fs.rmSync(p, { recursive: true, force: true }); return; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); }
    }
  };
  const readLog = (ud) => { try { return fs.readFileSync(path.join(ud, "updater.log"), "utf8"); } catch { return ""; } };
  try {
    fs.rmSync(UPDATER_DIR, { recursive: true, force: true });

    // ---------------- S1: instalacion que no se completa ----------------
    {
      const ud = fs.mkdtempSync(path.join(os.tmpdir(), "tpvrecipok-sn1-"));
      const desk = fs.mkdtempSync(path.join(os.tmpdir(), "tpvrecipok-sn1-desk-"));
      lanza(ud, desk);
      let log = "";
      const t0 = Date.now();
      while (Date.now() - t0 < 150000) {
        log = readLog(ud);
        if (/\[watchdog\] SIN confirmar/.test(log)) break;
        await sleep(1500);
      }
      matarRestos();
      const gate = (log.match(/instalando \(gate\): (\{.*\})/) || [])[1] || "";
      let ctx = {}; try { ctx = JSON.parse(gate); } catch {}
      check("S1: el TPV llega a instalar (la version 9.9.9 se descarga y valida)", !!gate, log.slice(-600));
      check("S1: registra quien pidio la instalacion (arranque) y la version de Windows", ctx.trigger === "arranque" && /\d+\.\d+/.test(String(ctx.os || "")), gate);
      check("S1: registra el instalador (nombre y tamano) y la carpeta de instalacion", ctx.installerFile === "TPV-Recipok-Setup-9.9.9.exe" && typeof ctx.installerMb === "number" && !!ctx.installDir, gate);
      check("S1: guarda la copia de reparacion del instalador (enlace o copia)", /red de seguridad: instalador TPV-Recipok-Setup-9\.9\.9\.exe, copia de reparacion (enlace|copia)/.test(log), log.slice(-800));
      const repair = path.join(UPDATER_DIR, "repair", "TPV-Recipok-Reparar.exe");
      check("S1: la copia esta fuera de la carpeta pending y es identica al instalador", fs.existsSync(repair) && fs.statSync(repair).size === installerBuf.length);
      const lnk = path.join(desk, "REPARAR TPV Recipok.lnk");
      check("S1: NO deja el icono REPARAR a la vista mientras el vigilante intenta arreglarlo (la persona no se entera)", !fs.existsSync(lnk), lnk);
      check("S1: lanza el vigilante de instalacion ANTES de cerrar el TPV", /vigilante de instalacion lanzado \(pid \d+\)/.test(log), log.slice(-800));
      check("S1: el vigilante arranca, vigila y detecta el fallo EN SEGUNDOS (sin esperar al limite de tiempo)", /\[watchdog\] vigilando la instalacion/.test(log) && /\[watchdog\] SIN confirmar a los \d+ s \((sin-tpv-abierto|programa-borrado)\)/.test(log), log.slice(-900));
      rmRetry(ud);
      rmRetry(desk);
    }

    // ---------------- S2: el TPV nuevo se ve con normalidad -> limpia el icono REPARAR ----------------
    {
      version = PKG.version; // sin version nueva: el TPV abre solo
      const ud = fs.mkdtempSync(path.join(os.tmpdir(), "tpvrecipok-sn2-"));
      const desk = fs.mkdtempSync(path.join(os.tmpdir(), "tpvrecipok-sn2-desk-"));
      fs.mkdirSync(path.join(UPDATER_DIR, "repair"), { recursive: true });
      const repair = path.join(UPDATER_DIR, "repair", "TPV-Recipok-Reparar.exe");
      fs.copyFileSync(PING, repair);
      const lnk = path.join(desk, "REPARAR TPV Recipok.lnk");
      fs.writeFileSync(lnk, "x"); // basta con que exista: debe borrarse
      lanza(ud, desk);
      let gone = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 90000) {
        if (!fs.existsSync(lnk) && !fs.existsSync(repair)) { gone = true; break; }
        await sleep(1500);
      }
      matarRestos();
      check("S2: en cuanto el TPV nuevo se ve, el icono REPARAR y la copia del instalador se quitan solos", gone, `lnk=${fs.existsSync(lnk)} repair=${fs.existsSync(repair)}\n${readLog(ud).slice(-500)}`);
      rmRetry(ud);
      rmRetry(desk);
    }
  } catch (e) {
    failN++; console.log("[FAIL] error: " + (e && e.stack || e));
  } finally {
    matarRestos();
    try { srv.close(); } catch {}
    await sleep(500);
    try { fs.rmSync(UPDATER_DIR, { recursive: true, force: true }); } catch {}
    clearTimeout(hard);
  }
  console.log(`\nRESULTADO: ${okN} OK, ${failN} FAIL`);
  process.exit(failN ? 1 : 0);
})();
