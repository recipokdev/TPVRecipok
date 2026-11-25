// Red de seguridad de las instalaciones (install_watchdog.js): vigilante PowerShell + copia del instalador de reparacion.
// Caso real: Ben_Trempat (2026-11-18) se quedo sin TPV tras una instalacion silenciosa que no se completo; la app, al no existir ya,
// no podia avisar. Sin Electron y sin red: el "servidor" es un HTTP local que apunta los avisos, el "instalador" es un .cmd, y los
// tiempos del vigilante se acortan a segundos. Solo Windows (usa PowerShell).
//   S1 instalacion correcta                  -> sin avisos, sale 0
//   S2 sin exe, el reinstalador funciona     -> failed + retry + recovered
//   S3 sin exe, el reinstalador siempre falla-> failed + 2 retry + gave-up y abre el instalador con ventanas
//   S4 exe presente pero no se abrio         -> failed + relaunched (abre el programa)
//   S5 programa abierto pero sin mostrarse   -> solo app-running, NO toca nada
//   S6 instalador lento que acaba bien       -> slow, sin failed
//   S7 sin instalador guardado               -> failed + gave-up (sin-instalador)
//   S8 dos vigilantes a la vez               -> el segundo sale sin hacer nada
// Uso: node tools/tests/run-install-watchdog.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const wd = require("../../install_watchdog");

let okN = 0, failN = 0;
function check(label, cond, extra) {
  if (cond) { okN++; console.log(`[OK] ${label}`); }
  else { failN++; console.log(`[FAIL] ${label}${extra ? " -- " + extra : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "tpv-wd-"));
const PING = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "ping.exe");

function mkCase(name) {
  const d = path.join(ROOT, name);
  fs.mkdirSync(path.join(d, "app"), { recursive: true });
  fs.mkdirSync(path.join(d, "pending"), { recursive: true });
  fs.mkdirSync(path.join(d, "desktop"), { recursive: true });
  return {
    d, cache: path.join(d, "cache"), exe: path.join(d, "app", "TPV-Recipok.cmd"), marker: path.join(d, "ready.flag"),
    log: path.join(d, "updater.log"), installer: path.join(d, "pending", "TPV-Recipok-Setup-9.9.9.cmd"),
  };
}
function readLog(c) { try { return fs.readFileSync(c.log, "utf8"); } catch { return ""; } }

// "Servidor": apunta lo que el vigilante cuenta
const posts = [];
const server = http.createServer((req, res) => {
  let b = "";
  req.on("data", (x) => (b += x));
  req.on("end", () => {
    try { posts.push({ url: req.url, key: req.headers["x-tpv-api-key"], body: JSON.parse(b) }); } catch { posts.push({ url: req.url, bad: b }); }
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true}');
  });
});

function runWatchdog(c, extra = {}) {
  const before = posts.length;
  const r = wd.startInstallWatchdog({
    cacheDir: c.cache, exePath: c.exe, installerPath: fs.existsSync(c.installer) ? c.installer : "", markerFile: c.marker, logFile: c.log,
    fromVersion: "9.9.8", targetVersion: "9.9.9", url: `http://127.0.0.1:${server.address().port}/index.php`, apiKey: "clave-de-prueba", slug: "prueba",
    pollSec: 1, waitSec: 4, slowExtraSec: 8, retryWaitSec: 4, relaunchWaitSec: 4, maxRetries: 2, earlyMinSec: 1, settleSec: 3, settleSeenSec: 3, retryPauseSec: 0,
    desktopDir: path.join(c.d, "desktop"), noDialog: true, directSpawn: true, mutexName: "Local\\TPVRecipokWatchdogTest-" + path.basename(c.d), ...extra,
  });
  if (!r.ok) throw new Error("no arranca el vigilante: " + r.error);
  const done = new Promise((res) => { r.child.on("exit", (code) => res(code)); });
  return { done, events: () => posts.slice(before).map((p) => p.body.event), bodies: () => posts.slice(before).map((p) => p.body), raw: () => posts.slice(before), child: r.child };
}
const TIMEOUT = (p, ms) => Promise.race([p, sleep(ms).then(() => "TIMEOUT")]);

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    // ---- piezas sueltas ----
    {
      const c = mkCase("piezas");
      const oldLocal = process.env.LOCALAPPDATA;
      process.env.LOCALAPPDATA = path.join(c.d, "local");
      const res = path.join(c.d, "resources");
      fs.mkdirSync(res, { recursive: true });
      fs.writeFileSync(path.join(res, "app-update.yml"), "provider: github\nupdaterCacheDirName: mi-cache-test\n");
      const cache = wd.getUpdaterCacheDir(res);
      check("La carpeta de descargas sale de updaterCacheDirName de app-update.yml", cache === path.join(c.d, "local", "mi-cache-test"), cache);
      check("Sin app-update.yml se usa el nombre por defecto", wd.getUpdaterCacheDir(path.join(c.d, "no-existe")).endsWith("tpvrecipok-updater"));
      fs.mkdirSync(path.join(cache, "pending"), { recursive: true });
      fs.writeFileSync(path.join(cache, "pending", "TPV-Recipok-Setup-1.0.0.exe"), "viejo");
      await sleep(30);
      fs.writeFileSync(path.join(cache, "pending", "TPV-Recipok-Setup-1.0.1.exe"), "nuevo-contenido");
      fs.writeFileSync(path.join(cache, "pending", "update-info.json"), "{}");
      const pend = wd.findPendingInstaller(cache);
      check("Encuentra el instalador descargado mas reciente (ignora lo que no es .exe)", path.basename(pend) === "TPV-Recipok-Setup-1.0.1.exe", pend);
      check("Sin carpeta pending devuelve vacio, sin lanzar", wd.findPendingInstaller(path.join(c.d, "nada")) === "");
      check("Saca la version del nombre del instalador", wd.versionFromInstallerName(pend) === "1.0.1" && wd.versionFromInstallerName("x.exe") === "");
      const keep = wd.keepRepairInstaller(cache, pend);
      check("Guarda una copia de reparacion (enlace o copia) fuera de pending", keep.ok && fs.existsSync(keep.path) && fs.readFileSync(keep.path, "utf8") === "nuevo-contenido", JSON.stringify(keep));
      fs.rmSync(path.join(cache, "pending"), { recursive: true, force: true }); // electron-updater vacia pending al bajar otra version
      check("... y sobrevive a que se vacie la carpeta pending", fs.existsSync(keep.path) && fs.readFileSync(keep.path, "utf8") === "nuevo-contenido");
      check("Sin instalador no falla: devuelve ok=false", wd.keepRepairInstaller(cache, path.join(c.d, "no-hay.exe")).ok === false);
      wd.removeRepairInstaller(cache);
      check("removeRepairInstaller borra la copia", !fs.existsSync(keep.path));
      process.env.LOCALAPPDATA = oldLocal;
      const tmpPs = path.join(c.d, "w.ps1");
      fs.writeFileSync(tmpPs, "\ufeff" + wd.watchdogScript(), "utf8");
      const q = spawnSync("powershell.exe", ["-NoProfile", "-Command", `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${tmpPs}',[ref]$t,[ref]$e);$e.Count`], { encoding: "utf8" });
      check("El script del vigilante no tiene errores de sintaxis de PowerShell", String(q.stdout).trim() === "0", String(q.stdout) + String(q.stderr));
      check("El script solo tiene caracteres ASCII (PowerShell 5.1 lee mal el UTF-8 sin BOM)", /^[\x00-\x7f]*$/.test(wd.watchdogScript()));
      const av = await wd.queryAntivirus();
      check("queryAntivirus devuelve una lista (sin lanzar)", Array.isArray(av), JSON.stringify(av));
    }

    // ---- S1 correcta ----
    {
      const c = mkCase("s1");
      fs.writeFileSync(c.exe, "@echo off\r\n");
      const w = runWatchdog(c);
      await sleep(1500);
      fs.writeFileSync(c.marker, "x");
      const code = await TIMEOUT(w.done, 30000);
      check("S1: instalacion correcta -> el vigilante sale con 0", code === 0, String(code));
      check("S1: ... sin contar nada al servidor", w.events().length === 0, JSON.stringify(w.events()));
      check("S1: ... y lo anota en el registro local", /instalacion correcta/.test(readLog(c)), readLog(c));
      check("S1: borra el fichero de parametros (lleva la clave de API)", !fs.existsSync(path.join(c.cache, "install-watchdog.json")));
    }

    // ---- S2 sin exe, reinstalador funciona ----
    {
      const c = mkCase("s2");
      fs.writeFileSync(c.installer, `@echo off\r\necho x> "${c.exe}"\r\necho x> "${c.marker}"\r\nexit /b 0\r\n`);
      const w = runWatchdog(c);
      const code = await TIMEOUT(w.done, 60000);
      check("S2: sin programa y con reinstalador que funciona -> sale con 0", code === 0, String(code));
      check("S2: avisa failed, retry y recovered (en ese orden)", JSON.stringify(w.events()) === JSON.stringify(["install-watchdog-failed", "install-watchdog-retry", "install-watchdog-recovered"]), JSON.stringify(w.events()));
      const b = w.bodies();
      check("S2: el aviso failed cuenta que NO existe el exe y trae el diagnostico", b[0] && b[0].exeExists === false && b[0].appRunning === false && "desktopShortcut" in b[0] && Array.isArray(b[0].defender) && b[0].source === "install-watchdog", JSON.stringify(b[0]));
      check("S2: el retry dice que funciono y el exe ya existe", b[1] && b[1].ok === true && b[1].exeExists === true && b[1].attempt === 1, JSON.stringify(b[1]));
      check("S2: sin acceso directo en el escritorio no hay nada que reapuntar", b[0] && b[0].desktopShortcut === false && b[0].desktopShortcutBroken === false);
      check("S2: lo arregla EN SILENCIO: no deja ningun icono REPARAR a la vista", !fs.existsSync(path.join(c.d, "desktop", "REPARAR TPV Recipok.lnk")));
      check("S2: detecta el fallo por el programa borrado (sin esperar al limite de tiempo)", b[0] && b[0].detectedBy === "programa-borrado", JSON.stringify(b[0]));
      check("S2: lleva slug y clave de API como los demas avisos de actualizacion", w.raw()[0].url.includes("action=log-update-event") && w.raw()[0].key === "clave-de-prueba" && b[0].slug === "prueba");
    }

    // ---- S3 reinstalador siempre falla ----
    {
      const c = mkCase("s3");
      const visible = path.join(c.d, "visible.flag");
      fs.writeFileSync(c.installer, `@echo off\r\nif "%~1"=="" echo x> "${visible}"\r\nexit /b 1\r\n`);
      // el acceso directo que deja el desinstalador huerfano: apunta a un programa que ya no existe (se ve como un cuadrado en blanco)
      const lnk = path.join(c.d, "desktop", "TPV Recipok.lnk");
      spawnSync("powershell.exe", ["-NoProfile", "-Command", `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk}');$s.TargetPath='${c.exe}';$s.Save()`]);
      const w = runWatchdog(c);
      const code = await TIMEOUT(w.done, 90000);
      await sleep(800);
      check("S3: si no se consigue instalar, sale con 1", code === 1, String(code));
      check("S3: avisa failed, 2 retry fallidos, reapunta el icono y gave-up (el icono solo cuando todo lo demas fallo)", JSON.stringify(w.events()) === JSON.stringify(["install-watchdog-failed", "install-watchdog-retry", "install-watchdog-retry", "install-watchdog-shortcut-retargeted", "install-watchdog-gave-up"]), JSON.stringify(w.events()));
      const b = w.bodies();
      check("S3: failed detecta que el acceso directo del escritorio esta ROTO (apunta a un programa que ya no existe)", b[0] && b[0].desktopShortcut === true && b[0].desktopShortcutBroken === true, JSON.stringify(b[0]));
      const tgt = spawnSync("powershell.exe", ["-NoProfile", "-Command", `(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk}').TargetPath`], { encoding: "utf8" }).stdout.trim();
      check("S3: el icono roto del escritorio pasa a apuntar al instalador (pulsarlo reinstala)", tgt.toLowerCase() === c.installer.toLowerCase(), tgt);
      check("S3: los retry guardan el codigo de salida del instalador (1)", b[1] && String(b[1].exitCode) === "1" && b[1].ok === false, JSON.stringify(b[1]));
      check("S3: el ultimo recurso abre el instalador CON ventanas (sin /S)", fs.existsSync(visible));
      check("S3: gave-up indica el motivo y que se dejo el icono REPARAR", b[4] && b[4].reason === "reinstalacion-fallida" && b[4].attempts === 2 && b[4].repairIcon === true, JSON.stringify(b[4]));
      const repairLnk = path.join(c.d, "desktop", "REPARAR TPV Recipok.lnk");
      check("S3: solo ahora aparece el icono REPARAR en el escritorio, apuntando al instalador", fs.existsSync(repairLnk) && spawnSync("powershell.exe", ["-NoProfile", "-Command", `(New-Object -ComObject WScript.Shell).CreateShortcut('${repairLnk}').TargetPath`], { encoding: "utf8" }).stdout.trim().toLowerCase() === c.installer.toLowerCase());
    }

    // ---- S4 exe presente pero no se abrio ----
    {
      const c = mkCase("s4");
      fs.writeFileSync(c.exe, `@echo off\r\necho x> "${c.marker}"\r\n`);
      const w = runWatchdog(c, { settleSeenSec: 14 });
      const code = await TIMEOUT(w.done, 60000);
      check("S4: el programa esta pero no se abrio -> lo abre y sale con 0", code === 0, String(code));
      check("S4: avisa failed y relaunched(ok)", JSON.stringify(w.events()) === JSON.stringify(["install-watchdog-failed", "install-watchdog-relaunched"]) && w.bodies()[1].ok === true, JSON.stringify(w.events()));
      check("S4: no llega a reinstalar", !w.events().includes("install-watchdog-retry"));
      check("S4: detecta el fallo porque no hay ningun TPV abierto tras terminar el instalador", w.bodies()[0] && w.bodies()[0].detectedBy === "sin-tpv-abierto", JSON.stringify(w.bodies()[0]));
    }

    // ---- S4b: el instalador nunca se vio (lo bloqueo Windows): se actua rapido, sin esperar el margen largo ----
    {
      const c = mkCase("s4b");
      fs.writeFileSync(c.exe, `@echo off\r\necho x> "${c.marker}"\r\n`);
      const w = runWatchdog(c, { settleSeenSec: 14 });
      await TIMEOUT(w.done, 60000);
      const b0 = w.bodies()[0] || {};
      check("S4b: instalador nunca visto -> detecta pronto (no espera el margen largo de 14 s)", b0.detectedBy === "sin-tpv-abierto" && b0.secondsWaited < 14, JSON.stringify(b0));
    }

    // ---- S12: el instalador SI se vio trabajando y desaparecio: se espera el margen largo antes de dar el fallo ----
    {
      const c = mkCase("s12");
      fs.writeFileSync(c.exe, `@echo off\r\necho x> "${c.marker}"\r\n`);
      const instReal = path.join(c.d, "pending", "TPV-Recipok-Setup-9.9.9.exe");
      fs.copyFileSync(PING, instReal);
      const inst = spawn(instReal, ["-n", "5", "127.0.0.1"], { stdio: "ignore", windowsHide: true });
      await sleep(400);
      const w = runWatchdog(c, { installerPath: instReal, settleSeenSec: 14, waitSec: 90 });
      await TIMEOUT(w.done, 90000);
      try { inst.kill(); } catch {}
      const b0 = w.bodies()[0] || {};
      check("S12: instalador visto y desaparecido -> espera el margen largo (>= 14 s) antes de avisar", b0.detectedBy === "sin-tpv-abierto" && b0.secondsWaited >= 14, JSON.stringify(b0));
      check("S12: ... y despues abre el TPV de siempre", JSON.stringify(w.events()) === JSON.stringify(["install-watchdog-failed", "install-watchdog-relaunched"]), JSON.stringify(w.events()));
    }

    // ---- S5 programa abierto pero sin mostrarse ----
    {
      const c = mkCase("s5");
      const exeReal = path.join(c.d, "app", "TPV-Recipok.exe");
      fs.copyFileSync(PING, exeReal);
      const app = spawn(exeReal, ["-n", "25", "127.0.0.1"], { stdio: "ignore", windowsHide: true });
      await sleep(600);
      fs.writeFileSync(c.installer, `@echo off\r\necho x> "${path.join(c.d, "no-debe-ejecutarse.flag")}"\r\n`);
      const w = runWatchdog(c, { exePath: exeReal });
      const code = await TIMEOUT(w.done, 40000);
      try { app.kill(); } catch {}
      check("S5: con el programa abierto pero sin mostrarse, sale con 0", code === 0, String(code));
      check("S5: solo avisa app-running (no failed, no reinstala)", JSON.stringify(w.events()) === JSON.stringify(["install-watchdog-app-running"]), JSON.stringify(w.events()));
      check("S5: NO toca nada (el instalador no se ejecuta)", !fs.existsSync(path.join(c.d, "no-debe-ejecutarse.flag")));
    }

    // ---- S6 instalador lento que acaba bien ----
    {
      const c = mkCase("s6");
      const instReal = path.join(c.d, "pending", "TPV-Recipok-Setup-9.9.9.exe");
      fs.copyFileSync(PING, instReal);
      const inst = spawn(instReal, ["-n", "14", "127.0.0.1"], { stdio: "ignore", windowsHide: true });
      await sleep(500);
      const w = runWatchdog(c, { installerPath: instReal, waitSec: 3, slowExtraSec: 12 });
      await sleep(7000);
      fs.writeFileSync(c.marker, "x"); // la version nueva avisa tarde, con el instalador aun en marcha
      const code = await TIMEOUT(w.done, 40000);
      try { inst.kill(); } catch {}
      check("S6: instalador lento que acaba bien -> sale con 0", code === 0, String(code));
      check("S6: avisa slow y NO failed", JSON.stringify(w.events()) === JSON.stringify(["install-watchdog-slow"]), JSON.stringify(w.events()));
    }

    // ---- S7 sin instalador guardado ----
    {
      const c = mkCase("s7");
      const w = runWatchdog(c);
      const code = await TIMEOUT(w.done, 40000);
      check("S7: sin programa y sin instalador -> sale con 1", code === 1, String(code));
      check("S7: avisa failed y gave-up (sin-instalador)", JSON.stringify(w.events()) === JSON.stringify(["install-watchdog-failed", "install-watchdog-gave-up"]) && w.bodies()[1].reason === "sin-instalador", JSON.stringify(w.events()));
    }

    // ---- S8 dos vigilantes a la vez ----
    {
      const c = mkCase("s8");
      const mutexName = "Local\\TPVRecipokWatchdogTest-s8-mutex";
      const a = runWatchdog(c, { mutexName, waitSec: 6, ctxSuffix: ".a" });
      await sleep(1500);
      const c2 = mkCase("s8b");
      const b = runWatchdog(c2, { mutexName, ctxSuffix: ".b" });
      const codeB = await TIMEOUT(b.done, 20000);
      check("S8: el segundo vigilante sale sin hacer nada (ya hay uno)", codeB === 0 && /ya hay otro vigilante/.test(readLog(c2)) && b.events().length === 0, `${codeB} ${readLog(c2)}`);
      fs.writeFileSync(c.marker, "x");
      await TIMEOUT(a.done, 30000);
    }
    // ---- S10 detecta el fallo en segundos, no en minutos ----
    {
      const c = mkCase("s10");
      fs.writeFileSync(c.installer, `@echo off
echo x> "${c.exe}"
echo x> "${c.marker}"
exit /b 0
`);
      const t0 = Date.now();
      const w = runWatchdog(c, { waitSec: 120, slowExtraSec: 120 }); // limite de tiempo largo: si no detectara antes, tardaria 2 minutos
      const code = await TIMEOUT(w.done, 90000);
      const secs = (Date.now() - t0) / 1000;
      check("S10: con el programa borrado se recupera en pocos segundos (no espera al limite de 2 minutos)", code === 0 && secs < 25, `${secs}s code=${code}`);
    }

    // ---- S11 recuperacion al segundo intento (primer intento: el antivirus lo bloquea; segundo: ya funciona) ----
    {
      const c = mkCase("s11");
      const counter = path.join(c.d, "intentos.txt");
      fs.writeFileSync(c.installer, `@echo off
if exist "${counter}" goto ok
echo 1> "${counter}"
exit /b 5
:ok
echo x> "${c.exe}"
echo x> "${c.marker}"
exit /b 0
`);
      const w = runWatchdog(c, { maxRetries: 3 });
      const code = await TIMEOUT(w.done, 90000);
      const ev = w.events(), b = w.bodies();
      check("S11: si el primer intento falla y el segundo funciona, se recupera solo (sale con 0)", code === 0, String(code));
      check("S11: avisa failed, retry(falla), retry(funciona) y recovered en el intento 2", JSON.stringify(ev) === JSON.stringify(["install-watchdog-failed", "install-watchdog-retry", "install-watchdog-retry", "install-watchdog-recovered"]) && b[1].ok === false && String(b[1].exitCode) === "5" && b[2].ok === true && b[3].attempt === 2, JSON.stringify(ev));
      check("S11: no aparece ningun icono REPARAR (la persona no se entera de nada)", !fs.existsSync(path.join(c.d, "desktop", "REPARAR TPV Recipok.lnk")));
    }

    // ---- S9 el vigilante sobrevive a que se cierre el programa que lo lanzo (como el TPV al instalar) ----
    {
      const c = mkCase("s9 con espacios");
      c.cache = path.join(c.d, "carpeta con espacios", "cache");
      const helper = path.join(c.d, "lanza-y-sale.js");
      fs.writeFileSync(helper, `const wd = require(${JSON.stringify(path.resolve(__dirname, "..", "..", "install_watchdog"))});
const r = wd.startInstallWatchdog({ cacheDir: ${JSON.stringify(c.cache)}, exePath: ${JSON.stringify(c.exe)}, installerPath: "", markerFile: ${JSON.stringify(c.marker)}, logFile: ${JSON.stringify(c.log)}, fromVersion: "9.9.8", targetVersion: "9.9.9", pollSec: 1, waitSec: 20, noDialog: true, mutexName: "Local\\\\TPVRecipokWatchdogTest-s9" });
// el TPV real tarda >=300 ms en cerrarse tras lanzarlo (espera a que se vea la ventanita de instalando): cmd necesita ese instante para soltar al vigilante
setTimeout(() => process.exit(r.ok ? 0 : 3), 800);`);
      const p = spawnSync(process.execPath, [helper], { encoding: "utf8" });
      check("S9: el programa que lanza el vigilante puede cerrarse al instante", p.status === 0, String(p.status) + p.stderr);
      await sleep(3500);
      fs.writeFileSync(c.marker, "x");
      let seen = false;
      for (let i = 0; i < 15 && !seen; i++) { await sleep(1000); seen = /instalacion correcta/.test(readLog(c)); }
      check("S9: ... y el vigilante sigue vivo y confirma la instalacion despues", seen, readLog(c));
    }
  } catch (e) {
    failN++; console.log("[FAIL] error: " + (e && e.stack || e));
  } finally {
    server.close();
    try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nRESULTADO: ${okN} OK, ${failN} FAIL`);
  process.exit(failN ? 1 : 0);
})();
