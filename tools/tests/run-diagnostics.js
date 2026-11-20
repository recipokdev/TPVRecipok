// Diagnostico remoto (2026-11-19): foto del equipo, boton «Enviar diagnostico a soporte», detalle del cajon y errores del proceso principal.
// Caso real (Los Argentinos): el cajon dejo de abrir y, sin entrar en el equipo, no habia forma de saber el porque.
// Parte 1 (Node): diagnostics.js (privacidad, limites del servidor, frecuencia). Parte 2 (Node): detalle por programa auxiliar del cajon.
// Parte 3 (TPV real en perfil aislado y SIN red; nunca manda nada a un servidor): foto, boton, anillo de avisos, tope diario del cajon y
// errores del proceso principal.
const path = require("path");
const os = require("os");
const fs = require("fs");
const { _electron: electron } = require("playwright");
const dg = require("../../diagnostics");
const { defaultHelpers, openDrawerViaHelpers, summarizeAttempts } = require("../../drawer_helpers");

const ROOT = path.resolve(__dirname, "..", "..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let okN = 0, failN = 0;
function check(label, cond, extra) {
  if (cond) { okN++; console.log(`[OK] ${label}`); }
  else { failN++; console.log(`[FAIL] ${label}${extra ? " -- " + extra : ""}`); }
}
// Lo que hace el servidor con lo que le llega (lib/audit_log.php auditSanitizeValue): textos a 240 y 25 claves por nivel
function serverLimitsOk(obj) {
  let ok = true;
  const walk = (v) => {
    if (typeof v === "string") { if (v.trim().length > 240) ok = false; return; }
    if (Array.isArray(v)) { if (v.length > 25) ok = false; v.forEach(walk); return; }
    if (v && typeof v === "object") { const k = Object.keys(v); if (k.length > 25) ok = false; k.forEach((x) => walk(v[x])); }
  };
  walk(obj);
  return ok;
}

(async () => {
  // ---------------- Parte 1: diagnostics.js ----------------
  const sw = dg.sanitizeText("error en C:\\Users\\Rocio Perez\\AppData\\Local\\x");
  check("Quita el nombre de usuario de Windows de las rutas, tambien si tiene espacios (nombre y apellido)", sw === "error en C:\\Users\\<usuario>\\AppData\\Local\\x", sw);
  check("... y de rutas tipo /home/ o /Users/", dg.sanitizeText("/home/juan/app/log") === "/home/<usuario>/app/log" && dg.sanitizeText("/Users/ana/x") === "/Users/<usuario>/x");
  check("Un texto sin rutas queda igual", dg.sanitizeText("Found version 0.2.68") === "Found version 0.2.68");
  check("Estado de la impresora: 0 = ok, 128 = sin-conexion, ocupada = ok, varios a la vez, desconocido = ?", dg.decodePrinterStatus(0) === "ok" && dg.decodePrinterStatus(0x80) === "sin-conexion" && dg.decodePrinterStatus(0x200) === "ok" && dg.decodePrinterStatus(0x2 | 0x10) === "error+sin-papel" && dg.decodePrinterStatus(null) === "?");

  const big = "x".repeat(900);
  const snap = dg.buildSnapshot({
    reason: "arranque", appVersion: "0.2.69", electron: "39.2.5", packaged: true, os: "10.0.19045 x64", uptimeSec: 7200, totalMem: 8 * 1073741824, freeMem: 3.2 * 1073741824,
    diskFree: 40 * 1073741824, tempFree: 38 * 1073741824, displays: [{ w: 1920, h: 1080, scale: 1 }, { w: 1920, h: 1080, scale: 1 }], kiosk: true,
    av: ["Windows Defender"], printers: Array.from({ length: 12 }, (_, k) => ({ name: `Impresora ${k} ${big}`, state: "ok" })),
    helpers: [{ name: "open-drawer-lite.exe", exists: true, size: 5632, day: "2026-11-19" }, { name: "open-drawer.exe", exists: false }],
    installDir: "C:\\Users\\Maria Lopez\\AppData\\Local\\Programs\\tpvrecipok", locale: "es", tz: "Europe/Madrid", drawer: big,
  });
  check("La foto cumple los limites del servidor (textos <= 240 y <= 25 claves) aunque los datos sean enormes", serverLimitsOk(snap) && Object.keys(snap).length <= 18, `${Object.keys(snap).length} claves`);
  const reportShape = { ...snap, log: Array.from({ length: 18 }, () => "l".repeat(230)), events: Array.from({ length: 10 }, () => "e".repeat(230)), slug: "x", currentVersion: "0.2.69", requestIp: "1.2.3.4" };
  check("El informe del boton (foto + registro + avisos + campos del servidor) tambien cabe: <= 25 claves y textos <= 240", serverLimitsOk(reportShape) && Object.keys(reportShape).length <= 25, `${Object.keys(reportShape).length} claves`);
  check("La foto pesa poco (menos de 3 KB)", JSON.stringify(snap).length < 3000, String(JSON.stringify(snap).length));
  check("La foto no lleva el nombre de usuario de Windows (la ruta de instalacion va saneada)", !/Maria|Lopez/.test(JSON.stringify(snap)) && /<usuario>/.test(snap.installDir), snap.installDir);
  check("Resume impresoras (maximo 8), programas auxiliares (FALTA si no estan), pantallas y memoria", /open-drawer-lite\.exe 5632B 2026-11-19/.test(snap.helpers) && /open-drawer\.exe FALTA/.test(snap.helpers) && snap.displays === "1920x1080@1 | 1920x1080@1" && snap.ramGb === 8 && snap.diskFreeGb === 40, JSON.stringify(snap).slice(0, 400));
  const snapEmpty = dg.buildSnapshot({});
  check("Con datos que faltan no falla ni inventa nada (sin impresoras: (ninguna); sin antivirus consultado: ?)", snapEmpty.printers === "(ninguna)" && snapEmpty.av === "?" && snapEmpty.appVersion === "", JSON.stringify(snapEmpty).slice(0, 300));

  const t0 = 1_000_000_000_000;
  check("Foto automatica: la primera vez se manda", dg.shouldSendSnapshot(null, t0, "1.0.0") === true);
  check("... no se repite antes de 7 dias con la misma version", dg.shouldSendSnapshot({ at: t0, version: "1.0.0" }, t0 + 6 * 24 * 3600 * 1000, "1.0.0") === false);
  check("... se repite pasados 7 dias", dg.shouldSendSnapshot({ at: t0, version: "1.0.0" }, t0 + 7 * 24 * 3600 * 1000 + 1000, "1.0.0") === true);
  check("... y al cambiar de version, aunque sea al dia siguiente", dg.shouldSendSnapshot({ at: t0, version: "1.0.0" }, t0 + 3600 * 1000, "1.0.1") === true);

  const th = dg.makeThrottle(3, 1000);
  const r1 = [th(0), th(1), th(2), th(3)];
  check("Limitador de avisos: deja pasar 3 y bloquea el cuarto dentro de la ventana", JSON.stringify(r1) === "[true,true,true,false]", JSON.stringify(r1));
  check("... y vuelve a dejar pasar al terminar la ventana", th(1500) === true);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tpv-diag-"));
  const logFile = path.join(tmpDir, "updater.log");
  fs.writeFileSync(logFile, Array.from({ length: 60 }, (_, k) => `2026-11-19T10:00:${String(k).padStart(2, "0")}Z linea ${k} en C:\\Users\\Pepe\\AppData\\x`).join("\n"));
  const tail = dg.tailLines(logFile, 5);
  check("Ultimas lineas del registro: las 5 ultimas, sin el nombre de usuario", tail.length === 5 && /linea 59/.test(tail[4]) && !/Pepe/.test(tail.join("")) && /<usuario>/.test(tail[0]), JSON.stringify(tail));
  check("Un registro que no existe devuelve una lista vacia, sin lanzar", JSON.stringify(dg.tailLines(path.join(tmpDir, "no-existe.log"), 5)) === "[]");
  fs.writeFileSync(path.join(tmpDir, "a.exe"), "12345");
  const hf = dg.describeHelperFiles(tmpDir, ["a.exe", "b.exe"]);
  check("Ficheros auxiliares: existentes con tamano y dia, y los que faltan marcados", hf[0].exists && hf[0].size === 5 && /^\d{4}-\d\d-\d\d$/.test(hf[0].day) && hf[1].exists === false, JSON.stringify(hf));
  const err = new Error("fallo en C:\\Users\\Luis\\AppData\\x");
  const se = dg.summarizeError(err, "uncaughtException");
  check("Resumen de un error: mensaje y pila saneados (sin nombre de usuario) y recortados", /<usuario>/.test(se.message) && !/Luis/.test(JSON.stringify(se)) && se.stack.length <= 3 && serverLimitsOk(se), JSON.stringify(se).slice(0, 300));
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // ---------------- Parte 2: detalle del cajon por programa auxiliar ----------------
  const dh = defaultHelpers(path.join(ROOT, "assets"));
  const res = await openDrawerViaHelpers("Impresora-que-no-existe-xyz", dh);
  const a0 = (res.attempts || [])[0] || {};
  check("Cajon: el resultado trae el detalle de cada programa auxiliar probado (existe, tamano, resultado de cada pin y tiempo)", res.attempts && res.attempts.length === 1 && a0.helper === "lite" && a0.exists === true && a0.size > 0 && a0.pins.length === 2 && typeof a0.pins[0].ms === "number" && /OpenPrinter failed/.test(a0.pins[0].error), JSON.stringify(res.attempts));
  check("... mas un resumen corto de menos de 400 caracteres con lo que dijo cada uno y el tiempo total", typeof res.summary === "string" && /lite\[\d+B\]: 0 ERR \d+ms OpenPrinter failed/.test(res.summary) && res.summary.length <= 400 && typeof res.ms === "number", res.summary);
  const missing = await openDrawerViaHelpers("x", [{ name: "lite", file: path.join(os.tmpdir(), "no-existe-lite.exe") }, { name: "net8", file: path.join(os.tmpdir(), "no-existe-net8.exe") }]);
  check("Si no existe ninguno, el resumen lo dice: «lite: FALTA | net8: FALTA»", missing.ok === false && summarizeAttempts(missing.attempts) === "lite: FALTA | net8: FALTA", summarizeAttempts(missing.attempts));

  // ---------------- Parte 3: TPV real, aislado y sin red ----------------
  const userData = path.join(os.tmpdir(), `tpvrecipok-diag-${Date.now()}`);
  const env = {
    ...process.env, TPV_E2E: "1", TPV_MODE: "demo", TPV_E2E_BACKGROUND: "1", TPV_E2E_REQUIRE_ONLINE: "0",
    TPV_E2E_ALLOW_WRITES: "0", TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3", TPV_E2E_API_KEY: "", TPV_E2E_USER_DATA: userData,
  };
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  const kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 100000);
  try {
    let win = null;
    const t1 = Date.now();
    while (!win && Date.now() - t1 < 40000) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => typeof sendDiagnosticToSupport === "function" && !!window.TPV_DIAG)) { win = w; break; } } catch {} }
      if (!win) await sleep(250);
    }
    if (!win) throw new Error("no se encontro la ventana del TPV (o falta TPV_DIAG)");
    await sleep(1500);

    const col = await win.evaluate(async () => await window.TPV_DIAG.collect());
    const sn = col.snapshot || {};
    check("La foto del equipo se recoge en el TPV real (version, Windows, memoria, disco, pantallas...)", col.ok === true && sn.appVersion === PKG.version && /\d+\.\d+/.test(sn.os) && sn.ramGb > 0 && sn.diskFreeGb > 0 && /\d+x\d+@/.test(sn.displays), JSON.stringify(sn).slice(0, 400));
    check("... con las impresoras y su estado para Windows (nombre[estado])", /\[[^\]]+\]/.test(sn.printers) || sn.printers === "(ninguna)", sn.printers);
    check("... y los programas auxiliares del cajon con su tamano (lite y el de siempre)", /open-drawer-lite\.exe \d+B/.test(sn.helpers) && /open-drawer\.exe \d+B/.test(sn.helpers), sn.helpers);
    check("... sin aperturas de cajon todavia al arrancar", /sin aperturas/.test(sn.drawer), sn.drawer);
    check("... y cumple los limites del servidor y no lleva datos personales (nombre de equipo o usuario de Windows)", serverLimitsOk(sn) && !new RegExp(os.hostname().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(JSON.stringify(sn)) && !JSON.stringify(sn).includes(os.userInfo().username), JSON.stringify(sn).slice(0, 200));

    const sent = await win.evaluate(async () => await window.TPV_DIAG.send({ events: ["10:00 print/prueba: hola"] }));
    check("Enviar el diagnostico sin servidor configurado no falla: devuelve «sin-servidor» (y no sale a la red)", sent && sent.ok === false && sent.reason === "sin-servidor", JSON.stringify(sent));

    const ui = await win.evaluate(async () => {
      const row = optDefIndex().has("optionsSendDiagBtn");
      const btn = document.getElementById("optionsSendDiagBtn");
      bindSendDiagnosticOnce();
      const label = btn.textContent.trim();
      btn.click();
      await new Promise((r) => setTimeout(r, 1500));
      return { row, existe: !!btn, label, despuesDisabled: btn.disabled, despuesTexto: btn.textContent.trim() };
    });
    check("Opciones tiene el boton «Enviar diagnostico» (esta en el catalogo de Opciones: sale en su resumen y se puede poner de favorito)", ui.existe && ui.row === true, JSON.stringify(ui));
    check("Al pulsarlo sin conexion al servidor avisa y el boton vuelve a quedar utilizable con su texto de siempre", ui.despuesDisabled === false && ui.despuesTexto === ui.label, JSON.stringify(ui));

    const ring = await win.evaluate(() => {
      for (let i = 0; i < 40; i++) reportClientEvent("print", `prueba-${i}`, `mensaje ${i}`, {}, "warn");
      reportClientEvent("print", "drawer-open-failed", "No se pudo abrir el cajón.", {}, "warn");
      const last = recentClientEventsForDiag();
      return { n: last.length, ultimo: last[last.length - 1], hayLargo: last.every((l) => l.length <= 160) };
    });
    check("El TPV recuerda sus ultimos avisos en memoria (maximo 10 para enviar, incluso sin conexion al servidor)", ring.n === 10 && /print\/drawer-open-failed: No se pudo abrir el cajón\./.test(ring.ultimo) && ring.hayLargo, JSON.stringify(ring));

    const cap = await win.evaluate(() => {
      localStorage.removeItem("tpv_drawer_fail_reports");
      const r = [];
      for (let i = 0; i < 10; i++) r.push(drawerFailReportAllowed());
      localStorage.setItem("tpv_drawer_fail_reports", JSON.stringify({ day: "2000-01-01", n: 99 }));
      const nextDay = drawerFailReportAllowed();
      return { primeros8: r.slice(0, 8).every(Boolean), noveno: r[8], decimo: r[9], nextDay };
    });
    check("Aviso de fallo de cajon al servidor: maximo 8 al dia por terminal (el cajero ve el aviso siempre) y se reinicia al dia siguiente", cap.primeros8 && cap.noveno === false && cap.decimo === false && cap.nextDay === true, JSON.stringify(cap));
    // Lo que llega al servidor es el detalle DESPUES de sanitizeClientEventDetail (cada texto a 120 caracteres, 8 claves): se prueba esa salida.
    const resumenReal = "lite[5632B]: 0 ERR 41ms OpenPrinter failed (1801) / 1 ERR 38ms OpenPrinter failed (1801) | net8[67524164B]: 0 ERR 2210ms Acceso denegado / 1 ERR 2190ms Acceso denegado";
    const det = await win.evaluate((resumen) => {
      const d = drawerDiagDetail({ error: "x".repeat(900), summary: resumen, via: "lite", ms: 123, printerStatus: "sin-conexion" }, "POS-80C", "MAIN");
      return { crudo: d, enviado: sanitizeClientEventDetail(d) };
    }, resumenReal);
    const unido = ["sum1", "sum2", "sum3"].map((k) => det.enviado[k] || "").join("");
    check("El detalle del fallo del cajon llega ENTERO al servidor tras el recorte de 120 caracteres: el resumen de los dos programas auxiliares (incluido el plan B), la via, el tiempo y el estado de la impresora", unido === resumenReal.slice(0, 360) && /net8\[67524164B\]/.test(unido) && /via lite/.test(det.enviado.info) && /impresora sin-conexion/.test(det.enviado.info) && det.enviado.ms === 123, JSON.stringify(det.enviado));
    check("... y respeta los limites: como mucho 8 claves, ningun texto de mas de 120 caracteres y menos de 800 en total", Object.keys(det.crudo).length <= 8 && Object.values(det.crudo).every((v) => typeof v !== "string" || v.length <= 120) && JSON.stringify(det.enviado).length <= 800, String(JSON.stringify(det.enviado).length));

    // error del proceso principal: se observa y se anota (en pruebas no sale a la red)
    await app.evaluate(() => { process.emit("uncaughtExceptionMonitor", new Error("boom de prueba en C:\\Users\\Marta\\AppData\\x"), "uncaughtException"); return true; });
    await sleep(800);
    let logTxt = "";
    try { logTxt = fs.readFileSync(path.join(userData, "updater.log"), "utf8"); } catch {}
    check("Un error del proceso principal queda en el registro del actualizador (con la ruta saneada)", /ERROR proceso principal \(uncaughtException\): Error: boom de prueba en C:\\Users\\<usuario>/.test(logTxt), logTxt.slice(-300));
  } catch (e) {
    failN++; console.log("[FAIL] error: " + (e && e.stack || e));
  } finally {
    clearTimeout(hard);
    kill();
    await sleep(800);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nRESULTADO: ${okN} OK, ${failN} FAIL`);
  process.exit(failN ? 1 : 0);
})();
