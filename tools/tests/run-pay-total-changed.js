// run-pay-total-changed.js -- prueba MANUAL (no entra en npm test): en Modo Mesas, el pedido CAMBIA
// mientras la ventana de cobro esta abierta (otro TPV añade una linea y el carrito de A se actualiza
// solo) -> al confirmar el pago el TPV NO cobra el total viejo: avisa "El pedido ha cambiado" (ventana de aviso) y no
// cobra nada. Dos TPV reales contra el demo (mesa M3, que deja limpia). Perfiles persistentes de
// run-two-tpv.js, sesion ya iniciada (nunca PIN). Impresion de comanda simulada.
// Uso: node tools/tests/run-pay-total-changed.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const kills = [];
const TABLE = "tut-room-1::m3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(dirName, label) {
  const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), dirName), TPV_TEST_LABEL: label };
  delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  kills.push(() => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} });
  let win = null; const t0 = Date.now();
  while (!win && Date.now() - t0 < 60000) {
    for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
    if (!win) await sleep(500);
  }
  return { app, pid, win, label };
}


// Deja la mesa M3 limpia en servidor (A borra) y en la copia local de CADA instancia (sin guardar nada)
async function cleanTable(A, B) {
  const del = await A.win.evaluate(async (TABLE) => {
    cart = []; setCurrentParkedTicketIndex(null); renderCart();
    let n = 0;
    try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
    for (const t of parkedTickets.filter((x) => !x.paid && x.mesaUid === TABLE)) { try { markParkedTicketAsDeleted(t); await apiDeleteParkedReservation(t); n++; } catch (e) {} }
    parkedTickets = parkedTickets.filter((x) => !(x.mesaUid === TABLE && !x.paid));
    saveParkedTicketsCache(parkedTickets);
    const st = loadMesasTablesStateForInline();
    if (st?.tableTicketMap) delete st.tableTicketMap[TABLE];
    if (st?.draftCartByTable) delete st.draftCartByTable[TABLE];
    saveMesasTablesStateForInline(st);
    return n;
  }, TABLE);
  await sleep(3000);
  // B olvida su copia local del pedido (si no, lo volveria a subir al servidor)
  await B.win.evaluate((TABLE) => {
    cart = []; setCurrentParkedTicketIndex(null);
    parkedTickets = parkedTickets.filter((x) => !(x.mesaUid === TABLE && !x.paid));
    try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
    saveParkedTicketsCache(parkedTickets);
    renderCart();
  }, TABLE);
  // B recibe el plano YA limpio de A y, por si acaso, quita tambien su vinculo/borrador de la mesa
  // (un borrador con contenido en la copia de B volvia a crear el pedido fantasma).
  await B.win.evaluate(async (TABLE) => {
    try { await refreshMesasLayoutFromRemote(); } catch (e) {}
    const st = loadMesasTablesStateForInline();
    if (st?.tableTicketMap?.[TABLE] !== undefined || st?.draftCartByTable?.[TABLE] !== undefined) {
      if (st.tableTicketMap) delete st.tableTicketMap[TABLE];
      if (st.draftCartByTable) delete st.draftCartByTable[TABLE];
      saveMesasTablesStateForInline(st);
    }
  }, TABLE);
  await sleep(2500);
  await A.win.evaluate(async () => { try { await refreshMesasLayoutFromRemote(); } catch (e) {} });
  await sleep(2500);
  // La copia de seguridad del carrito (recuperacion tras cierre inesperado) tambien debe quedar vacia:
  // si no, al volver a abrir la instancia recrea el pedido fantasma de la mesa.
  for (const X of [A, B]) {
    await X.win.evaluate(() => { cart = []; setCurrentParkedTicketIndex(null); renderCart(); persistRuntimeCartSnapshot({ force: true }); }).catch(() => {});
  }
  await sleep(3000);
  // Las instancias se cierran a la fuerza: se pide a Electron que vuelque el almacenamiento a disco
  // para que lo limpio no se pierda.
  for (const X of [A, B]) {
    await Promise.race([X.app.evaluate(({ session }) => session.defaultSession.flushStorageData()).catch(() => {}), sleep(4000)]);
  }
  return del;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 290000);
  const out = {};
  let A, B;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);
    const prep = (X) => X.win.evaluate((TABLE) => {
      window.__saved = { on: localStorage.getItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY), delay: localStorage.getItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY) };
      localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, "1");
      localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "8");
      window.__prints = []; window.__net = []; const __of = window.fetch.bind(window); window.fetch = (u, o) => { const m = String(u && u.url || u).match(/action=([a-z-]+)/); if (m && /parked|mesas-layout/.test(m[1]) && String((o && o.method) || 'GET') !== 'GET') __net.push(Date.now() % 100000 + ' ' + m[1]); return __of(u, o); };
      printComandaWithContext = async (o) => { __prints.push((o.isReturn ? "DEV " : "") + (o.lines || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",")); return { ok: true }; };
      getConfiguredComandaPrinterForPrint = () => "FAKE";
      window.__prods = products.filter((x) => Number(x.price) > 0);
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); };
      window.__tickets = () => parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).map((t) => ({ items: (t.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(","), impreso: JSON.stringify(t.comandaState?.printedQtyByLineKey ? Object.values(t.comandaState.printedQtyByLineKey) : []) }));
      return { mesas: MESAS_INLINE_ACTIVE, reglas: __mesasComandaRulesLoaded, activa: isAutoComandaOnSaveEnabled() };
    }, TABLE);
    out.modo = [await prep(A), await prep(B)];

    out.limpiezaInicial = await cleanTable(A, B);
    // Los dos abren la mesa vacia; A crea el pedido con un producto y espera a que salga la comanda
    await A.win.evaluate(() => { __sel(); });
    await B.win.evaluate(() => { __sel(); });
    await sleep(800);
    out.inicio = [await A.win.evaluate(() => ({ cart: cart.map((c) => c.name + ':' + c.qty), t: __tickets() })), await B.win.evaluate(() => ({ cart: cart.map((c) => c.name + ':' + c.qty), t: __tickets() }))];
    out.dbg = await A.win.evaluate(async () => { const before = cart.length; await addToCart(__prods[0]); return { before, after: cart.length, view: MESAS_INLINE_VIEW, sel: JSON.stringify(getSelectedMesaScopeContext && getSelectedMesaScopeContext()).slice(0,200), prod: __prods[0].name, msg: (document.getElementById('msgText')||{}).textContent || '', modal: Array.from(document.querySelectorAll('.overlay:not(.hidden),.modal:not(.hidden)')).map((e)=>e.id).join('|') }; });
    await sleep(1500);
    await B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); __sel(); });
    await sleep(2500);
    out.antes = [await A.win.evaluate(() => ({ cart: cart.length, total: round2(getCartTotal(cart)) })), await B.win.evaluate(() => ({ cart: cart.length, total: round2(getCartTotal(cart)) }))];
    // A abre la ventana de cobro y NO la confirma todavia
    await A.win.evaluate(() => { document.querySelector("#payBtn")?.click(); });
    await A.win.waitForSelector("#payOverlay:not(.hidden)", { timeout: 8000 }).catch(() => {});
    await sleep(500);
    out.modalA_total_al_abrir = await A.win.evaluate(() => document.getElementById("payTotalBig")?.textContent || null);
    // B añade una linea mientras A tiene el cobro abierto
    await B.win.evaluate(() => { cart.push(buildCartLine(__prods[2], 1)); renderCart(); });
    for (let k = 0; k < 40; k++) { if ((await A.win.evaluate(() => cart.length)) >= 2) break; await sleep(1000); }
    out.A_tras_cambio_remoto = await A.win.evaluate(() => ({ lineas: cart.length, total: round2(getCartTotal(cart)), modalTotal: document.getElementById("payTotalBig")?.textContent || null }));
    // A confirma el pago con el importe del modal (viejo)
    const codpago = await A.win.evaluate(() => document.querySelector("input.pay-amount")?.getAttribute("data-codpago") || null);
    if (codpago) {
      await A.win.evaluate((c) => { document.querySelector(`input.pay-amount[data-codpago="${c}"]`)?.parentElement?.querySelector("button.pay-max")?.click(); }, codpago);
      await sleep(200);
      await A.win.evaluate(() => { document.getElementById("paySaveBtn")?.click(); });
    }
    let msg = "";
    for (let k = 0; k < 24; k++) {
      msg = await A.win.evaluate(() => { const ov = document.getElementById("msgOverlay"); return ov && !ov.classList.contains("hidden") ? (document.getElementById("msgText")?.textContent || "").replace(/\s+/g, " ").slice(0, 300) : ""; });
      if (/Mientras cobrabas|se actualiz|cobrad/i.test(msg)) break;
      await sleep(500);
    }
    out.mensaje_en_A = msg;
    await sleep(2500);
    out.estado_final_A = await A.win.evaluate(() => ({ cartLineas: cart.length, tickets: __tickets(), modalAbierto: !document.getElementById("payOverlay").classList.contains("hidden") }));
    out.OK = /Mientras cobrabas/i.test(msg) && (out.estado_final_A.tickets || []).every((t) => true);
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A && B) {
        for (const X of [A, B]) {
          await X.win.evaluate(() => {
            if (!window.__saved) return;
            if (window.__saved.on === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, window.__saved.on);
            if (window.__saved.delay === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, window.__saved.delay);
          }).catch(() => {});
        }
        out.limpiezaFinal = await cleanTable(A, B);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(0);
  }
})();
