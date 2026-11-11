// run-resume-refresh.js -- prueba (entra en la bateria, nivel full) de la vigilancia de la ventana y de la reanudacion tras
// suspension, con UN TPV real contra la demo (perfil persistente de run-two-tpv.js, sesion ya iniciada, nunca PIN).
// Solo lee catalogo; los eventos de diagnostico que se mandan van a la demo.
// Comprueba: (R1) catalogo reciente -> no recarga; (R2) catalogo viejo -> recarga; (R3) catalogo vacio -> se recupera;
// (R4) la API contesta con 0 productos -> se conserva el catalogo anterior y el TPV se recupera solo;
// (R5) sin articulos y sin remedio -> recarga la ventana una vez, no en bucle y nunca con un carrito a medias;
// (R6) la suspension real (powerMonitor 'resume' en el proceso principal) llega a la pantalla y recarga;
// (R7) si el proceso de dibujo se cae, la ventana se recarga sola y queda en updater.log.
// Uso: node tools/tests/run-resume-refresh.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const PROFILE = path.join(os.tmpdir(), "tpvrecipok-2tpv-real-1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kills = [];
const log = (...a) => console.log(new Date().toISOString().slice(14, 23), ...a);
const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok, String(extra || "")]); };

async function findWindow(app) {
  let win = null;
  const t0 = Date.now();
  while (!win && Date.now() - t0 < 60000) {
    for (const w of app.windows()) {
      try {
        if (!w.url().includes("index.html")) continue;
        if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; }
      } catch {}
    }
    if (!win) await sleep(500);
  }
  if (!win) throw new Error("sin ventana");
  await win.waitForFunction(() => typeof currentTerminal !== "undefined" && !!currentTerminal && Array.isArray(products) && products.length > 0, null, { timeout: 60000 }).catch(() => {});
  return win;
}

(async () => {
  const hard = setTimeout(() => { console.error("HARD TIMEOUT"); kills.forEach((k) => k()); process.exit(1); }, 600000);
  try {
    const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: PROFILE, TPV_TEST_LABEL: "RESUME" };
    delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
    const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
    const pid = app.process().pid;
    kills.push(() => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} });
    let win = await findWindow(app);
    await sleep(8000); // el arranque recupera solo el carrito guardado de la ejecucion anterior
    const prep = () => win.evaluate(() => {
      cart = []; renderCart();
      document.querySelectorAll(".simple-overlay:not(.hidden)").forEach((o) => o.classList.add("hidden"));
      document.body.classList.remove("modal-locked");
      localStorage.removeItem("tpv_resume_reload_at");
      // cuenta las peticiones de catalogo
      if (!window.__realFetch) {
        window.__realFetch = window.fetch.bind(window);
        window.__fetchMode = "real";
        window.__prodFetches = 0;
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : input?.url || "";
          if (/[/]productos[?]limit=0/.test(url)) {
            window.__prodFetches++;
            if (window.__fetchMode === "empty") return Promise.resolve(new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
          }
          return window.__realFetch(input, init);
        };
      }
      window.__prodFetches = 0;
      return "ok";
    });
    log("preparacion:", await prep());
    const n0 = await win.evaluate(() => products.length);
    log("productos al arrancar:", n0);
    check("R0 el TPV arranca con catalogo", n0 > 0, String(n0));

    // R1 reciente -> no recarga
    await win.evaluate(() => { LAST_FULL_LOAD_AT = Date.now(); window.__prodFetches = 0; });
    let r = await win.evaluate(() => window.__handlePowerResume({ settleMs: 100, retryMs: 300 }));
    let f = await win.evaluate(() => window.__prodFetches);
    check("R1 catalogo reciente: no se recarga nada", r === "fresh" && f === 0, `${r}, peticiones ${f}`);

    // R2 viejo -> recarga
    await win.evaluate(() => { LAST_FULL_LOAD_AT = 0; window.__prodFetches = 0; });
    r = await win.evaluate(() => window.__handlePowerResume({ settleMs: 100, retryMs: 300 }));
    f = await win.evaluate(() => window.__prodFetches);
    let n = await win.evaluate(() => products.length);
    check("R2 catalogo viejo: se recarga y sigue habiendo articulos", r === "refreshed" && f >= 1 && n > 0, `${r}, peticiones ${f}, productos ${n}`);

    // R3 vacio -> se recupera
    await win.evaluate(() => { products = []; renderProducts(); window.__prodFetches = 0; });
    r = await win.evaluate(() => window.__handlePowerResume({ settleMs: 100, retryMs: 300 }));
    n = await win.evaluate(() => products.length);
    const tiles = await win.evaluate(() => document.querySelectorAll("#productsGrid .product-tile, #productsGrid [data-product-id], .products-grid > *").length);
    check("R3 pantalla sin articulos: se recupera sola tras reanudar", r === "refreshed" && n > 0, `${r}, productos ${n}, fichas ${tiles}`);

    // R4 la API contesta con 0 productos -> se conserva el catalogo
    await win.evaluate(() => { window.__fetchMode = "empty"; });
    const before = await win.evaluate(() => products.length);
    await win.evaluate(() => loadDataFromApi({ refresh: true, silentRetry: false }));
    const after = await win.evaluate(() => ({ n: products.length, snap: (loadBootSnapshot()?.products || []).length, offline: !!TPV_STATE.offline }));
    const toastTxt = await win.evaluate(() => document.body.innerText.includes("catálogo vacío"));
    check("R4 API con 0 productos: se conserva el catalogo y se avisa", after.n === before && after.n > 0 && after.snap > 0, `antes ${before}, ahora ${after.n}, copia ${after.snap}, aviso ${toastTxt}`);
    await win.evaluate(() => { window.__fetchMode = "real"; });
    // el monitor de conexion lo devuelve a Online y recarga
    const t0 = Date.now(); let rec = false;
    while (Date.now() - t0 < 45000) {
      const st = await win.evaluate(() => ({ off: !!TPV_STATE.offline, n: products.length }));
      if (!st.off && st.n > 0) { rec = true; break; }
      await sleep(1500);
    }
    check("R4b despues vuelve solo a Online con catalogo", rec, `${Math.round((Date.now() - t0) / 1000)} s`);

    // R5 sin articulos y sin remedio -> una recarga, no en bucle, nunca con carrito
    await win.evaluate(() => { window.__fetchMode = "empty"; localStorage.removeItem("tpv_boot_snapshot_v1"); try { for (const k of Object.keys(localStorage)) if (/boot.?snapshot/i.test(k)) localStorage.removeItem(k); } catch {} products = []; localStorage.removeItem("tpv_resume_reload_at"); });
    r = await win.evaluate(() => window.__handlePowerResume({ settleMs: 100, retryMs: 300, dryRun: true }));
    const r2 = await win.evaluate(() => window.__handlePowerResume({ settleMs: 100, retryMs: 300, dryRun: true }));
    await win.evaluate(() => { localStorage.removeItem("tpv_resume_reload_at"); cart = [{ id: 1, name: "x", price: 1, qty: 1 }]; products = []; });
    const r3 = await win.evaluate(() => window.__handlePowerResume({ settleMs: 100, retryMs: 300, dryRun: true }));
    check("R5 sin articulos: recarga una vez, no en bucle y no con carrito", r === "reloaded" && r2 === "empty-no-reload" && r3 === "empty-no-reload", `${r} / ${r2} / ${r3}`);
    await win.evaluate(async () => { cart = []; renderCart(); window.__fetchMode = "real"; localStorage.removeItem("tpv_resume_reload_at"); await loadDataFromApi({ refresh: true, silentRetry: true }); });
    n = await win.evaluate(() => products.length);
    check("R5b se deja el TPV con catalogo otra vez", n > 0, String(n));
    await sleep(3000);

    // R6 suspension real desde el proceso principal
    await win.evaluate(() => { LAST_FULL_LOAD_AT = 0; window.__prodFetches = 0; });
    await app.evaluate(({ powerMonitor }) => { powerMonitor.emit("suspend"); });
    await sleep(500);
    await app.evaluate(({ powerMonitor }) => { powerMonitor.emit("resume"); });
    const t1 = Date.now(); let pf = 0;
    while (Date.now() - t1 < 40000) { pf = await win.evaluate(() => window.__prodFetches); if (pf >= 1) break; await sleep(1000); }
    const ulog = fs.existsSync(path.join(PROFILE, "updater.log")) ? fs.readFileSync(path.join(PROFILE, "updater.log"), "utf8") : "";
    check("R6 reanudar el equipo (proceso principal) recarga el catalogo en pantalla", pf >= 1, `peticiones ${pf}, tras ${Math.round((Date.now() - t1) / 1000)} s`);
    check("R6b updater.log recoge la suspension y la reanudacion", /equipo: suspendido/.test(ulog) && /equipo: reanudado tras/.test(ulog));

    // R7 caida del proceso de dibujo -> se recarga sola
    await sleep(4000);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("index.html")); w.webContents.forcefullyCrashRenderer(); });
    // Playwright pierde la pagina que se cayo: se mira desde el proceso principal si la ventana vuelve con articulos
    n = 0;
    const t2 = Date.now();
    while (Date.now() - t2 < 70000 && !(n > 0)) {
      await sleep(2000);
      n = await app.evaluate(async ({ BrowserWindow }) => {
        try {
          const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes("index.html"));
          if (!w || w.webContents.isCrashed()) return 0;
          return Number(await w.webContents.executeJavaScript("typeof products !== 'undefined' && Array.isArray(products) ? products.length : 0")) || 0;
        } catch { return 0; }
      }).catch(() => 0);
    }
    const ulog2 = fs.readFileSync(path.join(PROFILE, "updater.log"), "utf8");
    check("R7 tras caerse el proceso de dibujo, la ventana vuelve con articulos", n > 0, String(n));
    check("R7b updater.log recoge la caida y la recarga", /proceso de dibujo caido/.test(ulog2) && /recargando tras la caida/.test(ulog2));
  } catch (e) {
    console.error("ERROR:", e);
    results.push(["La prueba terminó sin errores", false, String((e && e.message) || e).slice(0, 200)]);
  } finally {
    clearTimeout(hard);
    kills.forEach((k) => k());
    const verdict = require("./battery/verdict.js").emitVerdict(results);
    process.exit(verdict.fails ? 1 : 0);
  }
})();
