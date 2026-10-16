// run-mesas-button-during-load.js -- prueba MANUAL (no entra en npm test): pulsar el boton de Mesas
// MIENTRAS el TPV aun carga debe recordarse y entrar en Modo Mesas al terminar la carga (antes no
// hacia nada y sin aviso). Una instancia real contra el demo, sesion ya iniciada (nunca PIN). Fuerza
// salir de Mesas en el perfil de prueba (sin guardar ese modo) para que la entrada sea observable.
// Uso: node tools/tests/run-mesas-button-during-load.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let kill = () => {};

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 150000);
  const out = {};
  try {
    const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), "tpvrecipok-2tpv-real-1"), TPV_TEST_LABEL: "A" };
    delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
    const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
    const pid = app.process().pid;
    kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
    let win = null; const t0 = Date.now();
    while (!win && Date.now() - t0 < 60000) {
      for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
      if (!win) await sleep(200);
    }
    for (let i = 0; i < 150; i++) { if (await win.evaluate(() => typeof TPV_LOADING !== "undefined" && typeof switchToMesasMode === "function").catch(() => false)) break; await sleep(200); }
    out.al_aparecer = await win.evaluate(() => ({ loading: TPV_LOADING, mesasActivo: MESAS_INLINE_ACTIVE }));
    // Pulsar durante la carga (si ya esta en Mesas por el perfil, se vuelve a TPV antes si se puede)
    out.pulsar = await win.evaluate(async () => {
      if (!TPV_LOADING) return { saltado: "ya habia terminado la carga" };
      await switchToMesasMode();
      return { pendiente: __pendingMesasEntry, toast: (document.getElementById("toastContainer")?.innerText || "").replace(/\s+/g, " ").slice(0, 120) };
    });
    for (let i = 0; i < 40 && (await win.evaluate(() => TPV_LOADING)); i++) await sleep(1000);
    await sleep(2500);
    out.tras_la_carga = await win.evaluate(() => ({ loading: TPV_LOADING, pendiente: __pendingMesasEntry, mesasActivo: MESAS_INLINE_ACTIVE, vista: MESAS_INLINE_VIEW }));
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kill();
    process.exit(0);
  }
})();
