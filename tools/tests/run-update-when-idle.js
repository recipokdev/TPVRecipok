// Actualizar tras un rato sin usar el TPV (autoUpdateWhenIdleTick). TPV real en perfil aislado y SIN red (no toca la demo ni
// ningun servidor): actualizador falso (con descarga "lista"), y el reloj se adelanta con opts.now en vez de esperar minutos.
const path = require("path");
const os = require("os");
const fs = require("fs");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let okN = 0, failN = 0;
function check(label, cond, extra) {
  if (cond) { okN++; console.log(`[OK] ${label}`); }
  else { failN++; console.log(`[FAIL] ${label}${extra ? " -- " + extra : ""}`); }
}

(async () => {
  const userData = path.join(os.tmpdir(), `tpvrecipok-idleupd-${Date.now()}`);
  const env = {
    ...process.env, TPV_E2E: "1", TPV_MODE: "demo", TPV_E2E_BACKGROUND: "1", TPV_E2E_REQUIRE_ONLINE: "0",
    TPV_E2E_ALLOW_WRITES: "0", TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3", TPV_E2E_API_KEY: "", TPV_E2E_USER_DATA: userData,
  };
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  const kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 150000);
  try {
    let win = null;
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 40000) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => typeof autoUpdateWhenIdleTick === "function")) { win = w; break; } } catch {} }
      if (!win) await sleep(250);
    }
    if (!win) throw new Error("no se encontro la ventana del TPV");
    await win.waitForFunction(() => typeof backgroundUpdateSettings !== "undefined" && typeof cashSession !== "undefined", null, { timeout: 30000 });
    await sleep(1500);

    await win.evaluate(() => {
      window.__calls = { relaunch: 0 };
      window.__upd = { ready: true };
      window.__TPV_UPDATER_TEST_OVERRIDE = {
        getBackgroundPrefetchStatus: async () => ({ ready: window.__upd.ready, readyVersion: "9.9.9", percent: 100, running: false }),
        relaunchForUpdate: async () => { window.__calls.relaunch++; return { ok: true }; },
      };
      backgroundUpdateSettings = { ...backgroundUpdateSettings, enabled: true, offerOnCashClose: true };
      TPV_STATE.offline = false; TPV_STATE.locked = false;
      cart = []; renderCart();
      document.querySelectorAll(".simple-overlay:not(.hidden)").forEach((o) => { if (o.id !== "loginOverlay") o.classList.add("hidden"); });
      cashSession.open = false;
    });
    const MIN = 60 * 1000;
    // idleMin = minutos "sin tocar la pantalla" que se simulan adelantando el reloj
    const run = (idleMin) => win.evaluate((ms) => autoUpdateWhenIdleTick({ now: Date.now() + ms }), idleMin * MIN);
    const relaunches = () => win.evaluate(() => window.__calls.relaunch);
    const reset = () => win.evaluate(() => { window.__calls.relaunch = 0; localStorage.removeItem("tpv_idle_update_declined_at"); localStorage.removeItem("tpv_idle_update_tried_at"); });

    let r = await run(2);
    check("Con la pantalla recien usada (2 min) no hace nada", r === "not-idle", r);

    r = await run(9);
    check("Caja cerrada: a los 9 min todavia no", r === "not-idle", r);

    // caja abierta: umbral de 30 min
    await win.evaluate(() => { cashSession.open = true; });
    r = await run(11);
    check("Caja ABIERTA: a los 11 min no actualiza (necesita 30)", r === "not-idle" && (await relaunches()) === 0, r);
    await win.evaluate(() => { cashSession.open = false; });

    // descarga no lista
    await win.evaluate(() => { window.__upd.ready = false; });
    r = await run(15);
    check("Sin la descarga lista no hace nada (no fuerza una descarga en primer plano)", r === "not-ready" && (await relaunches()) === 0, r);
    await win.evaluate(() => { window.__upd.ready = true; });

    // trabajo en marcha
    await win.evaluate(() => { cart = [{ id: 1, name: "X", qty: 1, price: 1 }]; });
    r = await run(15);
    check("Con productos en el carrito no actualiza aunque lleve rato sin tocarse", r === "work-in-progress" && (await relaunches()) === 0, r);
    await win.evaluate(() => { cart = []; renderCart(); });

    await win.evaluate(() => { document.getElementById("payOverlay").classList.remove("hidden"); });
    r = await run(15);
    check("Con la ventana de cobro abierta no actualiza", r === "work-in-progress" || r === "overlay-open", r);
    await win.evaluate(() => { document.getElementById("payOverlay").classList.add("hidden"); });

    await win.evaluate(() => { TPV_STATE.offline = true; });
    r = await run(15);
    check("En modo offline no actualiza", r === "busy-app", r);
    await win.evaluate(() => { TPV_STATE.offline = false; });

    await win.evaluate(() => { backgroundUpdateSettings = { ...backgroundUpdateSettings, offerOnCashClose: false }; });
    r = await run(15);
    check("Si esta desactivado en Opciones no actua", r === "disabled", r);
    await win.evaluate(() => { backgroundUpdateSettings = { ...backgroundUpdateSettings, offerOnCashClose: true }; });

    // todo despejado: caja cerrada, 11 min, descarga lista -> cuenta atras -> ACEPTAR
    await reset();
    let p = win.evaluate((ms) => autoUpdateWhenIdleTick({ now: Date.now() + ms }), 11 * MIN);
    await win.waitForFunction(() => !document.getElementById("msgOverlay").classList.contains("hidden"), null, { timeout: 20000 });
    const txt = await win.evaluate(() => document.getElementById("msgText").innerText.replace(/\s+/g, " "));
    check("Se muestra la cuenta atras: «lleva un rato sin usarse» y la version nueva", /rato sin usarse/i.test(txt) && /9\.9\.9/.test(txt), txt.slice(0, 160));
    await win.click("#msgOkBtn");
    r = await p;
    check("Aceptar (o dejar que acabe la cuenta atras): pide reiniciar para actualizar una vez", r === "relaunching" && (await relaunches()) === 1, r);
    r = await run(60);
    check("Justo despues no lo reintenta (espera 2 h entre intentos, por si la instalacion falla)", r === "tried-recently" && (await relaunches()) === 1, r);

    // caja abierta con 31 min sin usar -> tambien
    await reset();
    await win.evaluate(() => { cashSession.open = true; });
    p = win.evaluate((ms) => autoUpdateWhenIdleTick({ now: Date.now() + ms }), 31 * MIN);
    await win.waitForFunction(() => !document.getElementById("msgOverlay").classList.contains("hidden"), null, { timeout: 20000 });
    await win.click("#msgOkBtn");
    r = await p;
    check("Caja abierta y 31 min sin usarse: tambien actualiza", r === "relaunching" && (await relaunches()) === 1, r);
    await win.evaluate(() => { cashSession.open = false; });

    // POSPONER
    await reset();
    p = win.evaluate((ms) => autoUpdateWhenIdleTick({ now: Date.now() + ms }), 11 * MIN);
    await win.waitForFunction(() => !document.getElementById("msgOverlay").classList.contains("hidden"), null, { timeout: 20000 });
    await win.click("#msgCancelBtn");
    r = await p;
    check("Posponer: no reinicia", r === "declined" && (await relaunches()) === 0, r);
    r = await run(30);
    check("Tras posponer no vuelve a molestar en las horas siguientes", r === "declined-recently", r);
  } catch (e) {
    failN++; console.log("[FAIL] error: " + (e && e.stack || e));
  } finally {
    clearTimeout(hard);
    kill();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nRESULTADO: ${okN} OK, ${failN} FAIL`);
  process.exit(failN ? 1 : 0);
})();
