// run-auto-comanda-timer.js -- prueba MANUAL (no entra en npm test) del temporizador de la comanda
// automatica en Modo Mesas con UNA instancia real contra el demo (mesa M3, que deja limpia). No
// imprime nada de verdad (se sustituye printComandaWithContext por un contador). Restaura los ajustes
// de comanda automatica del perfil de pruebas al terminar.
// Escenario (caso de Sergi, 2026-10-19): espera de 8 s sin saberlo -> añade un producto (arranca la
// cuenta atras) -> la pausa -> quita el producto -> cambia la espera a 60 s en Opciones -> añade otro
// producto. La cuenta atras debe usar los 60 s nuevos y no enviarse sola a los pocos segundos.
// Uso: node tools/tests/run-auto-comanda-timer.js   (despues: node tools/tests/two-tpv-clean-m3.js)
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const M3 = "tut-room-1::m3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let kill = () => {};

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 200000);
  const out = {};
  let win = null, app = null;
  try {
    const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), "tpvrecipok-2tpv-real-1"), TPV_TEST_LABEL: "A" };
    delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
    app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
    const pid = app.process().pid;
    kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 60000) {
      for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
      if (!win) await sleep(300);
    }
    for (let i = 0; i < 120; i++) { if (await win.evaluate(() => typeof TPV_LOADING !== "undefined" && TPV_LOADING === false).catch(() => false)) break; await sleep(500); }
    await sleep(3000);
    await win.evaluate((M3) => {
      window.__saved = { on: localStorage.getItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY), delay: localStorage.getItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY) };
      localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, "1");
      localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "8");
      window.__prints = [];
      printComandaWithContext = async (o) => { __prints.push(Math.round((Date.now() - __t0) / 1000) + "s " + (o.lines || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).join(",")); return { ok: true }; };
      getConfiguredComandaPrinterForPrint = () => "FAKE";
      window.__t0 = Date.now();
      window.__prods = products.filter((x) => Number(x.price) > 0);
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: M3 }); syncTpvCartWithSelectedMesa(); };
      window.__timer = () => {
        const ids = Array.from(__autoComandaPending.keys());
        return ids.map((k) => { const e = __autoComandaPending.get(k); return { paused: !!e.paused, quedan: e.paused ? Math.round((e.remainingMs || 0) / 1000) : Math.round((e.dueAt - Date.now()) / 1000) }; });
      };
      window.__bar = () => (document.getElementById("sendComandaBar")?.innerText || "").replace(/\s+/g, " ").trim();
    }, M3);
    const snap = async (label) => { out[label] = { timer: await win.evaluate(() => __timer()), barra: await win.evaluate(() => __bar()), enviados: await win.evaluate(() => __prints.slice()), delayGuardado: await win.evaluate(() => localStorage.getItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY)) }; };

    await win.evaluate(() => { __sel(); });
    await sleep(800);
    await win.evaluate(async () => { await addToCart(__prods[0]); });
    await sleep(3000);
    for (let i = 0; i < 20 && !(await win.evaluate(() => __timer().length)); i++) await sleep(500);
    await snap("1_producto_añadido");
    // pausar con el boton de la barra (o la funcion si no esta visible)
    await win.evaluate(() => { const t = parkedTickets.find((x) => !x.paid && x.mesaUid === "tut-room-1::m3"); const b = document.getElementById("sendComandaPauseBtn"); if (b && !b.classList.contains("hidden")) b.click(); else if (t) pauseAutoComandaForTicket(t.id); });
    await sleep(500);
    await snap("2_pausado");
    // quitar el producto (como el cajero con la X)
    await win.evaluate(() => { const l = cart[0]; updateCartItemQuantity(l._lineId, 0, { deleteLine: true }); });
    await sleep(3500);
    await snap("3_producto_quitado");
    // Opciones: espera a 60 s
    await win.evaluate(() => { localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "60"); const i = document.getElementById("autoComandaDelayInput"); if (i) { i.value = "60"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); } });
    await sleep(500);
    await win.evaluate(async () => { await addToCart(__prods[2]); });
    await sleep(3500);
    await snap("4_otro_producto_con_60s");
    await sleep(14000);
    await snap("5_14s_despues");
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (win) {
        out.limpieza = await win.evaluate(async (M3) => {
          if (window.__saved) {
            if (window.__saved.on === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, window.__saved.on);
            if (window.__saved.delay === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, window.__saved.delay);
          }
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
          let n = 0;
          for (const t of parkedTickets.filter((x) => !x.paid && x.mesaUid === M3)) { try { cancelAutoComandaForTicket(t.id); markParkedTicketAsDeleted(t); await apiDeleteParkedReservation(t); n++; } catch (e) {} }
          parkedTickets = parkedTickets.filter((x) => !(x.mesaUid === M3 && !x.paid));
          saveParkedTicketsCache(parkedTickets);
          const st = loadMesasTablesStateForInline();
          if (st?.tableTicketMap) delete st.tableTicketMap[M3];
          if (st?.draftCartByTable) delete st.draftCartByTable[M3];
          saveMesasTablesStateForInline(st);
          persistRuntimeCartSnapshot({ force: true });
          return "borrados " + n;
        }, M3);
        await sleep(3000);
        await Promise.race([app.evaluate(({ session }) => session.defaultSession.flushStorageData()).catch(() => {}), sleep(4000)]);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kill();
    process.exit(0);
  }
})();
