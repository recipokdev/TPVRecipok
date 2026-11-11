// run-comanda-auto.js -- prueba (entra en la bateria, nivel full) de la COMANDA AUTOMATICA en Modo Mesas con UN TPV real
// contra la demo (mesa M3, que deja limpia). NO imprime nada de verdad: printComandaWithContext se sustituye por un contador.
// Perfil persistente de run-two-tpv.js con sesion ya iniciada (nunca PIN). Restaura los ajustes de comanda del perfil al terminar.
// Sustituye a run-auto-comanda-timer.js y run-comanda-modal-controls.js (que solo imprimian datos).
//
// A) Envio solo: con espera de 8 s, un producto arma la cuenta atras y sale UNA sola comanda con ese producto; no se repite.
// B) Caso de Sergi (2026-10-19): se arma, se PAUSA (no sale aunque pase la espera), se QUITA el producto (la cuenta atras se
//    cancela y no sale nada), se cambia la espera a 60 s en Opciones y se añade otro producto: usa los 60 s nuevos.
// C) Ventana «Comanda cocina»: pausar / reanudar, espera propia de la mesa (Opciones no la cambia), volver a la de Opciones,
//    «No enviar solo» (no sale aunque pase el tiempo) y que al cambiar el pedido se vuelve a armar y sale.
// Uso: node tools/tests/run-comanda-auto.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = process.env.TPV_ROOT ? path.resolve(process.env.TPV_ROOT) : path.resolve(__dirname, "..", "..");
const M3 = "tut-room-1::m3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const step = (m) => process.stderr.write(`[${Math.round((Date.now() - T0) / 1000)}s] ${m}
`);
let kill = () => {};

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  const a = out.A || {};
  ok("A: al añadir un producto se arma la cuenta atras (≈ 8 s)", a.armado?.n === 1 && a.armado.quedan >= 5 && a.armado.quedan <= 8, a.armado);
  ok("A: pasada la espera sale UNA sola comanda con ese producto", a.enviados?.length === 1 && a.enviados[0].includes(`${a.prod}:1`), a.enviados);
  ok("A: la comanda no se repite pasado más tiempo", a.enviadosTarde?.length === 1, a.enviadosTarde);
  ok("A: tras enviar no queda ninguna cuenta atras", a.pendientesTras === 0, `pendientes ${a.pendientesTras}`);
  const b = out.B || {};
  ok("B: al pausar, la cuenta atras queda congelada con tiempo por delante", b.pausado?.paused === true && b.pausado.quedan > 0, b.pausado);
  ok("B: en pausa no sale nada aunque pase la espera de Opciones", b.enviadosEnPausa?.length === 0, b.enviadosEnPausa);
  ok("B: al quitar el producto se cancela la cuenta atras", b.tras_quitar?.n === 0, b.tras_quitar);
  ok("B: quitar el producto no envía ninguna comanda", b.enviadosTrasQuitar?.length === 0, b.enviadosTrasQuitar);
  ok("B: con 60 s en Opciones, el siguiente producto arma una cuenta atras de ≈ 60 s (no de 8)", b.con60?.n === 1 && b.con60.quedan > 45 && b.con60.quedan <= 60, b.con60);
  ok("B: pasados unos segundos con 60 s, no se envía sola enseguida", b.enviados60?.length === 0 && b.tras14?.n === 1, { enviados: b.enviados60, pendientes: b.tras14 });
  const m = out.C || {};
  ok("C: la ventana «Comanda cocina» muestra el envío automático en marcha", m.abierta?.seccion === true && /Se env[ií]a solo/.test(m.abierta.estado || ""), m.abierta);
  ok("C: Pausar deja «En pausa» y el botón pasa a «Reanudar»", /En pausa/.test(m.pausa?.estado || "") && m.pausa?.pausa === "Reanudar", m.pausa);
  ok("C: Reanudar vuelve a «Se envía solo»", /Se env[ií]a solo/.test(m.reanudar?.estado || "") && m.reanudar?.pausa === "Pausar", m.reanudar);
  ok("C: espera propia de la mesa (90 s): se ve y aparece «volver a Opciones»", m.propia?.espera === "90" && m.propia?.volver === true && m.propia?.quedan > 60, m.propia);
  ok("C: cambiar la espera en Opciones NO afecta a una mesa con espera propia", m.opciones20?.espera === "90" && m.opciones20?.volver === true, m.opciones20);
  ok("C: «volver a Opciones» adopta la espera de Opciones (20 s)", m.volver?.espera === "20" && m.volver?.volver === false, m.volver);
  ok("C: «No enviar solo» desactiva el envío para la mesa", /Desactivado/.test(m.sinEnvio?.estado || "") && m.sinEnvio?.off === "Activar de nuevo", m.sinEnvio);
  ok("C: con «No enviar solo», pasada la espera no sale ninguna comanda", m.pasan6?.enviados?.length === 0, m.pasan6?.enviados);
  ok("C: al cambiar el pedido se vuelve a armar y sale UNA comanda sola con todo lo pendiente (el producto que no se envió y el nuevo)", m.rearma?.enviados?.length === 1 && String(m.rearma.enviados[0]).split(",").length === 2, m.rearma?.enviados);
  const d = out.D || {};
  const devs = (d.enviados || []).filter((p) => String(p).startsWith("DEV "));
  ok("D: quitar un producto ya enviado manda solo un aviso de DEVOLUCIÓN a cocina con ese producto", devs.length === 1 && devs[0].includes(`${d.prod}:1`), d.enviados);
  ok("D: el aviso de devolución no se repite", (d.enviadosTarde || []).length === (d.enviados || []).length, d.enviadosTarde);
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 330000);
  const out = {};
  let win = null, app = null;
  try {
    const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), "tpvrecipok-2tpv-real-1"), TPV_TEST_LABEL: "A" };
    delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
    app = process.env.TPV_EXE
      ? await electron.launch({ executablePath: process.env.TPV_EXE, args: [], env })
      : await electron.launch({ args: [ROOT], cwd: ROOT, env });
    const pid = app.process().pid;
    kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 60000) {
      for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
      if (!win) await sleep(300);
    }
    for (let i = 0; i < 120; i++) { if (await win.evaluate(() => typeof TPV_LOADING !== "undefined" && TPV_LOADING === false).catch(() => false)) break; await sleep(500); }
    await sleep(3000);
    const est = await win.evaluate(async (M3) => {
      await setMesasInlineModeEnabled(true, { persist: false });
      setMesasInlineView("transacciones", { persist: false });
      window.__saved = { on: localStorage.getItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY), delay: localStorage.getItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY) };
      localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, "1");
      localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "8");
      window.__prints = [];
      printComandaWithContext = async (o) => { __prints.push((o.isReturn ? "DEV " : "") + (o.lines || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).join(",")); return { ok: true }; };
      getConfiguredComandaPrinterForPrint = () => "FAKE";
      // 3 productos con nombres que no se confundan en los 7 primeros caracteres
      const seen = new Set(); window.__prods = [];
      for (const p of products.filter((x) => Number(x.price) > 0 && !x.variants && !isOfferPackProductById(getProductBaseId(x)) && !(getProductAddonsForProduct(x) || []).length && !productHasDerivedStockMarker(x))) { const k = String(p.name).slice(0, 7); if (!seen.has(k)) { seen.add(k); __prods.push(p); } if (__prods.length >= 4) break; }
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: M3 }); syncTpvCartWithSelectedMesa(); };
      window.__timer = () => ({ n: __autoComandaPending.size, quedan: Array.from(__autoComandaPending.values()).map((e) => e.paused ? Math.round((e.remainingMs || 0) / 1000) : Math.round((e.dueAt - Date.now()) / 1000))[0], paused: Array.from(__autoComandaPending.values()).some((e) => e.paused) });
      window.__ui = () => {
        const q = (id) => document.getElementById(id);
        const vis = (id) => !!q(id) && !q(id).classList.contains("hidden");
        return { seccion: vis("comandaAutoSection"), estado: (q("comandaAutoStatus")?.textContent || ""), pausa: vis("comandaAutoPauseBtn") ? q("comandaAutoPauseBtn").textContent : null, off: vis("comandaAutoOffBtn") ? q("comandaAutoOffBtn").textContent : null, espera: q("comandaAutoDelayInput")?.value, volver: vis("comandaAutoDelayResetBtn"), quedan: __timer().quedan };
      };
      window.__clean = async () => {
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
        __autoComandaPending.forEach((e, k) => cancelAutoComandaForTicket(k));
        __autoComandaDelaySecByTicket.clear(); __autoComandaOffSigByTicket.clear();
        return n;
      };
      return { login: hasActiveLoginSession(), caja: !!cashSession?.open, mesas: !!MESAS_INLINE_ACTIVE, prods: __prods.length };
    }, M3);
    out.estado = est;
    await sleep(6000); // deja pasar la sincronizacion de arranque
    if (!est.login || !est.caja || est.prods < 3) throw new Error("Falta sesion/caja abierta o productos: " + JSON.stringify(est));
    const ev = (f, ...a) => win.evaluate(f, ...a);
    const waitPending = async (n, ms = 12000) => { for (let i = 0; i < ms / 500 && (await ev(() => __autoComandaPending.size)) !== n; i++) await sleep(500); };
    // Solo cuentan las comandas de los productos de ESTA prueba: al abrir el Modo Mesas el TPV tambien imprime lo pendiente
    // de otras mesas con lineas sin enviar (restos de la prueba anterior), y eso no es lo que aqui se comprueba.
    const prints = () => ev(() => __prints.filter((p) => __prods.slice(0, 3).some((pr) => String(p).includes(String(pr.name).slice(0, 7) + ":"))));
    const click = (id) => ev((id) => document.getElementById(id).click(), id);
    const nameOf = (i) => ev((i) => String(__prods[i].name).slice(0, 7), i);

    step("limpieza inicial");
    await ev(async () => { await __clean(); }); await sleep(1500);
    await ev(() => { __sel(); }); await sleep(800);

    step("A)");
    // ---------------- A) envio solo
    out.A = { prod: await nameOf(0) };
    await ev(() => { addToCart(__prods[0]); });
    await waitPending(1);
    out.A.armado = await ev(() => __timer());
    await sleep(11000);
    out.A.enviados = await prints();
    await sleep(10000);
    out.A.enviadosTarde = await prints();
    out.A.pendientesTras = await ev(() => __autoComandaPending.size);
    await ev(async () => { await __clean(); __prints.length = 0; }); await sleep(2000);
    await ev(() => { __sel(); }); await sleep(800);

    step("B)");
    // ---------------- B) pausa, quitar producto, Opciones a 60 s
    out.B = {};
    await ev(() => { addToCart(__prods[1]); });
    await waitPending(1);
    await ev(() => { const t = parkedTickets.find((x) => !x.paid && x.mesaUid === "tut-room-1::m3"); const b = document.getElementById("sendComandaPauseBtn"); if (b && !b.classList.contains("hidden")) b.click(); else if (t) pauseAutoComandaForTicket(t.id); });
    await sleep(500);
    out.B.pausado = await ev(() => __timer());
    await sleep(11000); // mas que los 8 s
    out.B.enviadosEnPausa = await prints();
    await ev(() => { const l = cart[0]; updateCartItemQuantity(l._lineId, 0, { deleteLine: true }); });
    await sleep(3500);
    out.B.tras_quitar = await ev(() => __timer());
    out.B.enviadosTrasQuitar = await prints();
    await ev(() => { localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "60"); const i = document.getElementById("autoComandaDelayInput"); if (i) { i.value = "60"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); } applyAutoComandaDelayChange(); });
    await sleep(500);
    await ev(() => { addToCart(__prods[2]); });
    await waitPending(1);
    await sleep(2000);
    out.B.con60 = await ev(() => __timer());
    await sleep(12000);
    out.B.tras14 = await ev(() => __timer());
    out.B.enviados60 = await prints();
    await ev(async () => { await __clean(); __prints.length = 0; localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "40"); }); await sleep(2000);
    await ev(() => { __sel(); }); await sleep(800);

    step("C)");
    // ---------------- C) controles de la ventana Comanda cocina
    out.C = {};
    const ui = async (k) => { out.C[k] = { ...(await ev(() => __ui())), enviados: await prints() }; };
    await ev(() => { addToCart(__prods[0]); });
    await waitPending(1, 15000);
    await ev(() => { document.getElementById("sendComandaEditBtn").click(); });
    await sleep(800);
    await ui("abierta");
    await click("comandaAutoPauseBtn"); await sleep(500); await ui("pausa");
    await click("comandaAutoPauseBtn"); await sleep(500); await ui("reanudar");
    await ev(() => setAutoComandaDelayForLoadedTicket(90)); await sleep(500); await ui("propia");
    await ev(() => { localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "20"); applyAutoComandaDelayChange(); }); await sleep(500); await ui("opciones20");
    await click("comandaAutoDelayResetBtn"); await sleep(600); await ui("volver");
    await click("comandaAutoOffBtn"); await sleep(500); await ui("sinEnvio");
    await ev(() => { localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "3"); });
    await sleep(6000); await ui("pasan6");
    await ev(() => { document.getElementById("comandaCancelBtn").click(); addToCart(__prods[2]); });
    await sleep(9500); await ui("rearma");
    // D) quitar un producto YA enviado a cocina: sale un aviso de devolucion (DEV) solo, y solo una vez
    step("D");
    out.D = { prod: await nameOf(2) };
    await ev(() => { const l = cart.find((x) => String(x.name).startsWith(String(__prods[2].name).slice(0, 7))); if (l) updateCartItemQuantity(l._lineId, 0, { deleteLine: true }); });
    await sleep(9500);
    out.D.enviados = await prints();
    await sleep(5000);
    out.D.enviadosTarde = await prints();
  } catch (e) {
    out.ERROR = String((e && e.message) || e).slice(0, 300);
  } finally {
    try {
      if (win) {
        out.limpieza = await win.evaluate(async () => {
          document.getElementById("comandaCancelBtn")?.click();
          if (window.__saved) {
            if (window.__saved.on === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, window.__saved.on);
            if (window.__saved.delay === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, window.__saved.delay);
          }
          return "borrados " + (await window.__clean());
        });
        await sleep(3000);
        await Promise.race([app.evaluate(({ session }) => session.defaultSession.flushStorageData()).catch(() => {}), sleep(4000)]);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    try { out.comandas_ajenas = await win.evaluate(() => __prints.filter((p) => !__prods.slice(0, 3).some((pr) => String(p).includes(String(pr.name).slice(0, 7) + ":")))); } catch {}
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kill();
    process.exit(verdict.fails ? 1 : 0);
  }
})();
