// Actualizar al reanudar el equipo de la suspension (offerUpdateAfterResume). TPV real en perfil aislado y SIN red (no toca la
// demo ni ningun servidor): se sustituyen el actualizador, la consulta de caja al servidor y la comprobacion de conexion,
// y se llama a la funcion como lo hace el evento de reanudar.
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
  const userData = path.join(os.tmpdir(), `tpvrecipok-resumeupd-${Date.now()}`);
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
      for (const w of app.windows()) { try { if (await w.evaluate(() => typeof offerUpdateAfterResume === "function")) { win = w; break; } } catch {} }
      if (!win) await sleep(250);
    }
    if (!win) throw new Error("no se encontro la ventana del TPV");
    await win.waitForFunction(() => typeof backgroundUpdateSettings !== "undefined" && typeof checkFSOnline === "function", null, { timeout: 30000 });
    await sleep(1500);

    // Estado base: actualizador falso, conexion ok, sin caja abierta en el servidor, sin trabajo en marcha.
    await win.evaluate(() => {
      window.__calls = { check: 0, relaunch: 0 };
      window.__upd = { available: true };
      window.__TPV_UPDATER_TEST_OVERRIDE = {
        checkNow: async () => { window.__calls.check++; return { ok: true, updateAvailable: window.__upd.available, targetVersion: "9.9.9" }; },
        relaunchForUpdate: async () => { window.__calls.relaunch++; return { ok: true }; },
      };
      window.checkFSOnline = async () => true;
      window.__remote = { mode: "closed" };
      window.apiReadLastOpenCajaForTpv = async () => {
        if (window.__remote.mode === "error") throw new Error("sin red");
        if (window.__remote.mode === "open") return [{ idcaja: 1, idtpv: 1, fechafin: null }];
        return [{ idcaja: 1, idtpv: 1, fechafin: "17-11-2026 20:04:00" }];
      };
      window.apiReadLastOpenCajaGlobal = window.apiReadLastOpenCajaForTpv;
      backgroundUpdateSettings = { ...backgroundUpdateSettings, enabled: true, offerOnCashClose: true };
      TPV_STATE.offline = false; TPV_STATE.locked = false;
      cart = []; renderCart();
      document.querySelectorAll(".simple-overlay:not(.hidden)").forEach((o) => { if (o.id !== "loginOverlay") o.classList.add("hidden"); });
      localStorage.removeItem("tpv_resume_update_declined_at");
    });
    const run = () => win.evaluate(() => offerUpdateAfterResume({ settleMs: 0, retryMs: 1 }));
    const calls = () => win.evaluate(() => ({ ...window.__calls }));
    const reset = () => win.evaluate(() => { window.__calls = { check: 0, relaunch: 0 }; localStorage.removeItem("tpv_resume_update_declined_at"); });

    // 1) caja abierta segun el servidor -> no se toca nada
    await win.evaluate(() => { window.__remote.mode = "open"; });
    let r = await run();
    check("Caja abierta (segun el servidor): no ofrece actualizar", r === "caja-open" && (await calls()).check === 0, r);

    // 2) no se puede saber la caja (error de red) -> no se actualiza
    await win.evaluate(() => { window.__remote.mode = "error"; });
    r = await run();
    check("Si no se puede consultar la caja al servidor, no actualiza", r === "caja-unknown" && (await calls()).relaunch === 0, r);

    // 3) caja cerrada pero no hay version nueva
    await win.evaluate(() => { window.__remote.mode = "closed"; window.__upd.available = false; });
    r = await run();
    check("Caja cerrada y sin version nueva: no hace nada", r === "no-update" && (await calls()).relaunch === 0, r);
    await win.evaluate(() => { window.__upd.available = true; });

    // 4) trabajo en marcha: carrito con lineas
    await reset();
    await win.evaluate(() => { cart = [{ id: 1, name: "X", qty: 1, price: 1 }]; });
    r = await run();
    check("Con productos en el carrito no ofrece actualizar", r === "work-in-progress" && (await calls()).check === 0, r);
    await win.evaluate(() => { cart = []; renderCart(); });

    // 5) otra ventana abierta (no la de acceso)
    await win.evaluate(() => { document.getElementById("payOverlay").classList.remove("hidden"); });
    r = await run();
    check("Con una ventana abierta (cobro) no ofrece actualizar", r === "work-in-progress" || r === "overlay-open", r);
    await win.evaluate(() => { document.getElementById("payOverlay").classList.add("hidden"); });

    // 6) offline
    await reset();
    await win.evaluate(() => { TPV_STATE.offline = true; });
    r = await run();
    check("Sin conexion (modo offline) no ofrece actualizar", r === "busy-app" && (await calls()).check === 0, r);
    await win.evaluate(() => { TPV_STATE.offline = false; });

    // 7) desactivado en Opciones
    await win.evaluate(() => { backgroundUpdateSettings = { ...backgroundUpdateSettings, offerOnCashClose: false }; });
    r = await run();
    check("Si la oferta esta desactivada en Opciones, no actua", r === "disabled", r);
    await win.evaluate(() => { backgroundUpdateSettings = { ...backgroundUpdateSettings, offerOnCashClose: true }; });

    // 8) todo despejado + version nueva + ACEPTAR (con la pantalla de acceso a la vista, que no cuenta como trabajo)
    await reset();
    await win.evaluate(() => { document.getElementById("loginOverlay")?.classList.remove("hidden"); });
    let p = win.evaluate(() => offerUpdateAfterResume({ settleMs: 0, retryMs: 1 }));
    await win.waitForFunction(() => !document.getElementById("msgOverlay").classList.contains("hidden"), null, { timeout: 20000 });
    const txt = await win.evaluate(() => document.getElementById("msgText").innerText.replace(/\s+/g, " "));
    check("Se muestra la cuenta atras con el aviso de que el equipo acaba de despertar y la caja esta cerrada", /despert/i.test(txt) && /9\.9\.9/.test(txt), txt.slice(0, 160));
    await win.click("#msgOkBtn");
    r = await p;
    check("Aceptar: pide reiniciar para actualizar (una vez)", r === "relaunching" && (await calls()).relaunch === 1, r + " " + JSON.stringify(await calls()));
    await win.evaluate(() => { document.getElementById("loginOverlay")?.classList.add("hidden"); });

    // 9) POSPONER: no reinicia y no vuelve a molestar en 6 h
    await reset();
    p = win.evaluate(() => offerUpdateAfterResume({ settleMs: 0, retryMs: 1 }));
    await win.waitForFunction(() => !document.getElementById("msgOverlay").classList.contains("hidden"), null, { timeout: 20000 });
    await win.click("#msgCancelBtn");
    r = await p;
    check("Posponer: no reinicia", r === "declined" && (await calls()).relaunch === 0, r);
    r = await run();
    check("Tras posponer, la siguiente reanudacion (en menos de 6 h) no vuelve a ofrecerlo", r === "declined-recently", r);
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
