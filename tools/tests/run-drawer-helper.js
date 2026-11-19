// Apertura del cajon: programa auxiliar diminuto (open-drawer-lite.exe) + el de siempre como plan B + avisos. Windows.
// Caso real (Los Argentinos, 2026-11-19): tras una actualizacion el cajon dejo de abrir con el aviso generico «No se pudo abrir el cajon»;
// el codigo no habia cambiado, asi que lo mas probable es que el sistema (antivirus) impidiera ejecutar el programa auxiliar de 64 MB sin firmar.
// Parte 1 (sin abrir el TPV): el programa diminuto pesa unos KB y se comporta igual que el de siempre (mismos mensajes y codigos de salida).
// Parte 2 (sin abrir el TPV; nunca toca una impresora real): la cadena de intentos de drawer_helpers.js.
// Parte 3 (TPV real aislado y sin red): los avisos que ve el cajero y el aviso al servidor.
//   - impresora que no existe -> responde el diminuto (no se prueba el otro: diria lo mismo)
//   - el diminuto falta o esta roto -> se prueba el de siempre
//   - los dos faltan o estan rotos -> error que dice que no se pueden ejecutar, con el detalle de cada uno
//   - con una impresora de pruebas (puerto a fichero, solo si Windows deja crearla) -> abre por el diminuto
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const LITE = path.join(ROOT, "assets", "open-drawer-lite.exe");
const NET8 = path.join(ROOT, "assets", "open-drawer.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let okN = 0, failN = 0;
function check(label, cond, extra) {
  if (cond) { okN++; console.log(`[OK] ${label}`); }
  else { failN++; console.log(`[FAIL] ${label}${extra ? " -- " + extra : ""}`); }
}
const run = (exe, args) => spawnSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 40000 });
const ps = (cmd) => spawnSync("powershell.exe", ["-NoProfile", "-Command", cmd], { encoding: "utf8" });

(async () => {
  if (process.platform !== "win32") { console.log("Solo Windows."); process.exit(0); }

  // ---------------- Parte 1: el programa diminuto ----------------
  check("open-drawer-lite.exe existe y es diminuto (menos de 100 KB; el de .NET 8 pesa 64 MB)", fs.existsSync(LITE) && fs.statSync(LITE).size < 100 * 1024, fs.existsSync(LITE) ? String(fs.statSync(LITE).size) : "no existe");
  let r = run(LITE, ["Impresora-que-no-existe-xyz", "0"]);
  check("Impresora inexistente: sale con 3 y dice «OpenPrinter failed (1801)» (el mensaje que el TPV sabe interpretar)", r.status === 3 && /OpenPrinter failed \(1801\) for 'Impresora-que-no-existe-xyz'/.test(r.stderr), `${r.status} ${r.stderr}`);
  const rb = fs.existsSync(NET8) ? run(NET8, ["Impresora-que-no-existe-xyz", "0"]) : null;
  check("... y es IDENTICO al programa de siempre (mismo codigo de salida y mismo texto)", rb && rb.status === r.status && rb.stderr.trim() === r.stderr.trim(), rb ? `${rb.status} ${rb.stderr}` : "no hay open-drawer.exe");
  r = run(LITE, []);
  check("Sin argumentos: sale con 2 y muestra el uso", r.status === 2 && /Usage/.test(r.stderr), `${r.status} ${r.stderr}`);

  // impresora de pruebas con puerto a fichero (no toca ninguna impresora real); si Windows no deja crearla, esa comprobacion se omite
  const OUTFILE = path.join(os.tmpdir(), "tpv-drawer-test-out.bin");
  const TESTPRINTER = "TPV-TEST-DRAWER-" + process.pid;
  let testPrinterOk = false;
  try {
    ps(`Add-PrinterPort -Name '${OUTFILE}' -ErrorAction SilentlyContinue; Add-Printer -Name '${TESTPRINTER}' -DriverName 'Microsoft Print To PDF' -PortName '${OUTFILE}' -ErrorAction Stop`);
    testPrinterOk = /TPV-TEST-DRAWER/.test(ps(`(Get-Printer -Name '${TESTPRINTER}' -ErrorAction SilentlyContinue).Name`).stdout);
  } catch {}
  if (testPrinterOk) {
    r = run(LITE, [TESTPRINTER, "0"]);
    const rb2 = run(NET8, [TESTPRINTER, "1"]);
    check("Con una impresora de pruebas instalada abre sin error: «OK» y salida 0 (igual que el de siempre)", r.status === 0 && /OK/.test(r.stdout) && rb2.status === 0 && /OK/.test(rb2.stdout), `${r.status} ${r.stdout} ${r.stderr} / ${rb2.status}`);
  } else console.log("[--] No se pudo crear la impresora de pruebas: se omite la comprobacion de apertura con exito");

  // ---------------- Parte 2: cadena de intentos (drawer_helpers.js, la que usa el proceso principal) ----------------
  const { defaultHelpers, openDrawerViaHelpers } = require("../../drawer_helpers");
  const junk = path.join(os.tmpdir(), `tpv-drawer-junk-${process.pid}.exe`);
  fs.writeFileSync(junk, "esto no es un ejecutable");
  const noLite = path.join(os.tmpdir(), "no-existe-lite.exe"), noNet8 = path.join(os.tmpdir(), "no-existe-net8.exe");
  const NOPRINTER = "Impresora-que-no-existe-xyz";
  const dh = defaultHelpers(path.join(ROOT, "assets"));
  check("La cadena por defecto es: primero el diminuto (lite) y despues el de siempre (net8)", dh.length === 2 && /open-drawer-lite\.exe$/.test(dh[0].file) && /open-drawer\.exe$/.test(dh[1].file));
  const n = await openDrawerViaHelpers(NOPRINTER, dh);
  check("Impresora inexistente -> responde el diminuto (via lite) con «OpenPrinter failed», sin probar el otro", n.ok === false && n.via === "lite" && /OpenPrinter failed/.test(n.error || ""), JSON.stringify(n));
  if (testPrinterOk) {
    const c1 = await openDrawerViaHelpers(TESTPRINTER, dh);
    check("Con la impresora de pruebas abre por el diminuto (ok, via lite)", c1.ok === true && c1.via === "lite", JSON.stringify(c1));
  }
  const sl = await openDrawerViaHelpers(NOPRINTER, [{ ...dh[0], file: noLite }, dh[1]]);
  check("Si el diminuto FALTA se prueba el de siempre (via net8) y su respuesta es la buena", sl.ok === false && sl.via === "net8" && /OpenPrinter failed/.test(sl.error || ""), JSON.stringify(sl));
  const lr = await openDrawerViaHelpers(NOPRINTER, [{ ...dh[0], file: junk, timeout: 8000 }, dh[1]]);
  check("Si el diminuto esta ROTO (no arranca) se prueba el de siempre (via net8)", lr.ok === false && lr.via === "net8" && /OpenPrinter failed/.test(lr.error || ""), JSON.stringify(lr));
  const ar = await openDrawerViaHelpers(NOPRINTER, [{ ...dh[0], file: junk, timeout: 8000 }, { ...dh[1], file: noNet8 }]);
  check("Si NO se puede ejecutar ninguno, el error trae el detalle de los dos (lite: … | net8: …) y no tiene via", ar.ok === false && /lite:/.test(ar.error || "") && /net8:/.test(ar.error || "") && !ar.via, JSON.stringify(ar));
  const none = await openDrawerViaHelpers(NOPRINTER, []);
  check("Sin ningun programa auxiliar el resultado es un error claro, no una excepcion", none.ok === false && /sin programa auxiliar/.test(none.error || ""), JSON.stringify(none));

  // ---------------- Parte 3: avisos al cajero (TPV real en perfil aislado y SIN red) ----------------
  const userData = path.join(os.tmpdir(), `tpvrecipok-drawer-${Date.now()}`);
  const env = {
    ...process.env, TPV_E2E: "1", TPV_MODE: "demo", TPV_E2E_BACKGROUND: "1", TPV_E2E_REQUIRE_ONLINE: "0",
    TPV_E2E_ALLOW_WRITES: "0", TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3", TPV_E2E_API_KEY: "", TPV_E2E_USER_DATA: userData,
  };
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  const kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 90000);
  try {
    let win = null;
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 40000) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => typeof friendlyDrawerErrorMessage === "function")) { win = w; break; } } catch {} }
      if (!win) await sleep(250);
    }
    if (!win) throw new Error("no se encontro la ventana del TPV");
    await sleep(800);
    const friendly = (raw) => win.evaluate((x) => friendlyDrawerErrorMessage(x), raw);
    const mPrinter = await friendly("OpenPrinter failed (1801) for 'x'");
    const mBlocked = await friendly(ar.error);
    const mGeneric = await friendly("otra cosa rara");
    const mNoFile = await friendly("lite: No existe open-drawer-lite.exe en: C:/x | net8: No existe open-drawer.exe en: C:/x");
    const mSpawn = await friendly("Error: spawn UNKNOWN");
    check("Aviso al cajero: impresora que no responde -> «no responde. Comprueba que esté conectado y encendido»", /no responde/.test(mPrinter), mPrinter);
    check("Aviso al cajero: programa auxiliar que no se puede ejecutar -> lo dice y menciona el antivirus y al soporte", /no se puede ejecutar/.test(mBlocked) && /antivirus/.test(mBlocked) && /soporte/.test(mBlocked), mBlocked);
    check("Aviso al cajero: programa auxiliar que falta o «spawn UNKNOWN» -> el mismo aviso", /no se puede ejecutar/.test(mNoFile) && /no se puede ejecutar/.test(mSpawn), `${mNoFile} / ${mSpawn}`);
    check("Aviso al cajero: cualquier otro error sigue siendo el generico", mGeneric === "No se pudo abrir el cajón.", mGeneric);
    const reports = await win.evaluate(() => {
      const src = String(openDrawerNow);
      return /reportClientEvent\("print", "drawer-open-failed"/.test(src);
    });
    check("Cuando el cajon falla se avisa a nuestro servidor con el error tecnico (categoria print, drawer-open-failed)", reports === true);
  } catch (e) {
    failN++; console.log("[FAIL] error: " + (e && e.stack || e));
  } finally {
    clearTimeout(hard);
    kill();
    await sleep(800);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  }

  // limpieza
  try { fs.rmSync(junk, { force: true }); } catch {}
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  if (testPrinterOk) {
    ps(`Remove-Printer -Name '${TESTPRINTER}' -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; Remove-PrinterPort -Name '${OUTFILE}' -ErrorAction SilentlyContinue`);
    try { fs.rmSync(OUTFILE, { force: true }); } catch {}
  }
  console.log(`\nRESULTADO: ${okN} OK, ${failN} FAIL`);
  process.exit(failN ? 1 : 0);
})();
