// run-comanda-modal-controls.js -- prueba MANUAL (no entra en npm test) de los controles del envio
// automatico dentro de la ventana "Comanda cocina" (Modo Mesas), con UNA instancia real contra el demo
// (mesa M3, que deja limpia). No imprime nada de verdad (printComandaWithContext sustituido por un
// contador). Restaura los ajustes de comanda automatica del perfil de pruebas al terminar.
// Recorre: abrir la ventana con una cuenta atras en marcha, pausar/reanudar, espera propia de la mesa,
// "No enviar solo" (no se envia aunque pase el tiempo; vuelve a armarse si cambia el pedido) y volver a
// la espera de Opciones.
// Uso: node tools/tests/run-comanda-modal-controls.js   (despues: node tools/tests/two-tpv-clean-m3.js)
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const M3 = "tut-room-1::m3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let kill = () => {};

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 240000);
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
      localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "40");
      window.__t0 = Date.now();
      window.__prints = [];
      printComandaWithContext = async (o) => { __prints.push(Math.round((Date.now() - __t0) / 1000) + "s " + (o.lines || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).join(",")); return { ok: true }; };
      getConfiguredComandaPrinterForPrint = () => "FAKE";
      window.__prods = products.filter((x) => Number(x.price) > 0);
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: M3 }); syncTpvCartWithSelectedMesa(); };
      window.__ui = () => {
        const q = (id) => document.getElementById(id);
        const vis = (id) => !!q(id) && !q(id).classList.contains("hidden");
        return { seccion: vis("comandaAutoSection"), estado: (q("comandaAutoStatus")?.textContent || ""), pausa: vis("comandaAutoPauseBtn") ? q("comandaAutoPauseBtn").textContent : null, off: vis("comandaAutoOffBtn") ? q("comandaAutoOffBtn").textContent : null, espera: q("comandaAutoDelayInput")?.value, volver: vis("comandaAutoDelayResetBtn") };
      };
    }, M3);
    const ui = async (label) => { out[label] = { ui: await win.evaluate(() => __ui()), enviados: await win.evaluate(() => __prints.slice()) }; };
    const click = (id) => win.evaluate((id) => document.getElementById(id).click(), id);

    await win.evaluate(() => { __sel(); });
    await sleep(800);
    await win.evaluate(async () => { await addToCart(__prods[0]); });
    for (let i = 0; i < 24 && !(await win.evaluate(() => __autoComandaPending.size)); i++) await sleep(500);
    await win.evaluate(() => { document.getElementById("sendComandaEditBtn").click(); });
    await sleep(800);
    await ui("1_ventana_abierta");

    await click("comandaAutoPauseBtn"); await sleep(500); await ui("2_pausar");
    await click("comandaAutoPauseBtn"); await sleep(500); await ui("3_reanudar");

    // espera propia de la mesa: 90 s (se hace por la misma funcion que usa el teclado numerico)
    await win.evaluate(() => setAutoComandaDelayForLoadedTicket(90)); await sleep(500); await ui("4_espera_propia_90");
    // Opciones cambia a 20 s: esta mesa NO debe cambiar (tiene su propia espera)
    await win.evaluate(() => { localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "20"); applyAutoComandaDelayChange(); }); await sleep(500); await ui("5_opciones_20_no_afecta");
    await click("comandaAutoDelayResetBtn"); await sleep(600); await ui("6_volver_a_opciones_20");

    // No enviar solo: pasa de sobra el tiempo y no se envia
    await click("comandaAutoOffBtn"); await sleep(500); await ui("7_no_enviar_solo");
    await win.evaluate(() => { localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "3"); });
    await sleep(6000);
    await ui("8_pasan_6s_con_espera_de_Opciones_3s");
    // Cambia el pedido: vuelve a armarse (esta vez con 3 s) y se envia solo
    await win.evaluate(async () => { document.getElementById("comandaCancelBtn").click(); await addToCart(__prods[2]); });
    await sleep(9000);
    await ui("9_cambia_el_pedido_se_rearma_y_envia");
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
