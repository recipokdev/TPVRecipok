// run-cobro-fallido.js -- prueba (entra en la bateria, nivel full) de un COBRO QUE FALLA en Modo Mesas.
// Dos TPV reales contra el demo (mesa M3, que deja limpia; B solo mira). Impresion simulada. Perfiles persistentes de
// run-two-tpv.js con sesion ya iniciada (nunca PIN).
// El fallo se fuerza de forma estable (no depende del stock de la demo): sendOrQueueFactura devuelve el error de stock que
// daria FacturaScripts, asi que NO se crea ninguna factura. Comprueba que el pedido de la mesa sigue abierto UNA sola vez
// (sin pedido duplicado "Cobro fallido"), que el aviso lo dice, que el otro TPV ve lo mismo y que, quitado el fallo, el
// pedido se puede volver a cobrar (COBRA DE VERDAD en la demo, 1 factura marcada "[PRUEBA COBRO FALLIDO]") y la mesa queda
// libre con el stock cuadrado.
// Uso: node tools/tests/run-cobro-fallido.js
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
function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  const n = (arr, re) => (arr || []).filter((t) => re.test(t)).length;
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  ok("Los dos TPV están en Modo Mesas", (out.modo || []).length === 2 && out.modo.every((m) => m.mesas), out.modo);
  ok("Antes de cobrar hay un único pedido en la mesa con las 2 unidades", n(out.antes?.tickets, /^mesa/) === 1 && (out.antes?.carrito || []).length >= 1, out.antes);
  const f = out.fallo || {};
  ok("Al fallar el cobro sale el aviso «Cobro fallido» explicando que no se ha cobrado nada", /Cobro fallido/i.test(f.msg || "") && /no se ha cobrado nada|sigue abierto/i.test(f.msg || ""), f.msg);
  ok("Tras el fallo el pedido de la mesa sigue abierto UNA sola vez (sin pedido duplicado «Cobro fallido»)", n(f.A?.tickets, /^mesa/) === 1 && n(f.A?.tickets, /^FALLIDO/) === 0, f.A);
  ok("El otro TPV ve lo mismo: un solo pedido abierto en la mesa y ninguno «Cobro fallido»", n(f.B?.tickets, /^mesa/) === 1 && n(f.B?.tickets, /^FALLIDO/) === 0, f.B);
  ok("Pasado un tiempo no aparece ningún pedido duplicado", n(f.tarde?.tickets, /^mesa/) === 1 && n(f.tarde?.tickets, /^FALLIDO/) === 0, f.tarde);
  const r = out.reintento || {};
  ok("Quitado el fallo, el mismo pedido se vuelve a cobrar", r.cobrado === true, r);
  ok("Tras el cobro no queda ningún pedido abierto en la mesa y la mesa queda libre", n(r.A?.tickets, /^mesa/) === 0 && n(r.A?.tickets, /^FALLIDO/) === 0 && r.A?.estado === "libre", r.A);
  const st = out.stock || {};
  ok("El stock cuadra: se descuentan solo las 2 unidades del cobro bueno (el fallido no descontó nada)", st.DESCUADRE === 0, st);
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 420000);
  const out = {};
  let A, B, prod = null;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);
    const prep = (X) => X.win.evaluate(async (TABLE) => {
      await setMesasInlineModeEnabled(true, { persist: false }); setMesasInlineView("transacciones", { persist: false });
      window.__saved = { on: localStorage.getItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY), delay: localStorage.getItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY) };
      localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, "0"); // sin comandas: aqui solo se prueba el cobro
      printComandaWithContext = async () => ({ ok: true }); getConfiguredComandaPrinterForPrint = () => "FAKE";
      window.ensurePrinterSelectedForPrint = async () => ""; window.openDrawerNow = async () => true;
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); };
      window.__avisos = []; { const rt = window.toast || toast; const rm = showMessageModal; showMessageModal = (...a) => { __avisos.push("MODAL " + String(a[0]) + " | " + String(a[1]).split(String.fromCharCode(10)).join(" ").slice(0, 200)); return rm(...a); }; toast = (...a) => { __avisos.push("TOAST " + String(a[0]).slice(0, 160)); return rt(...a); }; }
      window.__dismiss = () => { const ov = document.getElementById("msgOverlay"); if (ov && !ov.classList.contains("hidden")) { Array.from(ov.querySelectorAll("button")).pop()?.click(); } };
      return { mesas: MESAS_INLINE_ACTIVE, login: hasActiveLoginSession(), caja: !!cashSession?.open };
    }, TABLE);
    out.modo = [await prep(A), await prep(B)];
    if (!out.modo.every((m) => m.login && m.caja)) throw new Error("Falta sesion o caja abierta: " + JSON.stringify(out.modo));

    // Producto con stock gestionado (se restaura al final)
    prod = await A.win.evaluate(async () => {
      const cand = products.filter((p) => { const id = getProductBaseId(p); const st = parseManagedStockValue(p.stockfis); return id && st !== null && st >= 8 && Number(p.price) > 0 && !p.variants && !isOfferPackProductById(id) && !productHasDerivedStockMarker(p) && !(getProductAddonsForProduct(p) || []).length; });
      const p = cand[cand.length - 1]; const id = getProductBaseId(p);
      const r = await fetchStockRowsByProductReference(findProductByBaseId(id) || p);
      const row = pickStockRowByWarehouse(r, getCurrentWarehouseCode(), { strict: false });
      return { id, name: String(p.name).slice(0, 30), stock: Number(row?.cantidad) };
    });
    if (!prod || !Number.isFinite(prod.stock)) throw new Error("No hay producto con stock gestionado >= 8");
    out.producto = prod;
    const readStock = () => A.win.evaluate(async (id) => { const rows = await fetchStockRowsByProductReference(findProductByBaseId(id)); const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false }); return Number(row?.cantidad); }, prod.id);

    out.limpiezaInicial = await cleanTable(A, B);
    await A.win.evaluate(() => { const real = window.buildFsLinesFromCart; window.__realBuild = real; window.buildFsLinesFromCart = (c) => real(c).map((l) => ({ ...l, descripcion: String(l.descripcion || "") + " [PRUEBA COBRO FALLIDO]" })); });
    await A.win.evaluate(() => { __sel(); });
    await sleep(1500);
    await A.win.evaluate((id) => { addToCart(findProductByBaseId(id)); }, prod.id);
    await sleep(2500);
    await A.win.evaluate((id) => { addToCart(findProductByBaseId(id)); }, prod.id);
    await sleep(9000); // el autoguardado crea el pedido de la mesa
    const snap = (X) => X.win.evaluate((T) => { const st = loadMesasTablesStateForInline(); const tk = parkedTickets.filter((t) => !t.paid && (t.mesaUid === T || /^Cobro fallido/.test(String(t.name || "")))).map((t) => (t.mesaUid === T ? "mesa" : "FALLIDO") + ":" + String(t.id).slice(-6) + ":" + (t.items || []).length + (t.closingInProgress ? ":cerrando" : "")); return { estado: (st.tableStates || {})[T] || null, tickets: tk, carrito: cart.map((c) => String(c.name).slice(0, 8) + ":" + c.qty) }; }, TABLE);
    out.antes = await snap(A);

    const pay = async () => {
      await A.win.evaluate(() => { document.querySelector("#payBtn")?.click(); });
      await A.win.waitForSelector("#payOverlay:not(.hidden)", { timeout: 8000 }).catch(() => {});
      await sleep(500);
      const cod = await A.win.evaluate(() => Array.from(document.querySelectorAll("input.pay-amount")).map((i) => i.getAttribute("data-codpago")).find((c) => c && isCashCodpago(c)) || document.querySelector("input.pay-amount")?.getAttribute("data-codpago") || null);
      await A.win.evaluate((c) => { document.querySelector('input.pay-amount[data-codpago="' + c + '"]')?.parentElement?.querySelector("button.pay-max")?.click(); }, cod);
      await sleep(300);
      await A.win.evaluate(() => { document.getElementById("paySaveBtn")?.click(); });
    };
    const modalMsg = () => A.win.evaluate(() => { const ov = document.getElementById("msgOverlay"); return ov && !ov.classList.contains("hidden") ? ((document.getElementById("msgTitle")?.textContent || "") + " | " + (document.getElementById("msgText")?.textContent || "")).replace(/\s+/g, " ").slice(0, 300) : ""; });

    // 1) cobro que FALLA (error de stock del servidor, sin crear factura)
    await A.win.evaluate(() => { window.__realSend = sendOrQueueFactura; sendOrQueueFactura = async () => ({ ok: false, error: "error-calculating-totals: stock insuficiente (prueba)" }); });
    await pay();
    out.fallo = {};
    for (let k = 0; k < 60; k++) { const m = await modalMsg(); if (/Cobro fallido/i.test(m)) { out.fallo.msg = m; break; } await sleep(500); }
    await sleep(3000);
    out.fallo.avisos = await A.win.evaluate(() => __avisos.slice());
    out.fallo.A = await snap(A);
    await B.win.evaluate(async () => { try { await refreshMesasLayoutFromRemote(); await refreshRemoteParkedReservationsOnly(); } catch (e) {} });
    await sleep(2500);
    out.fallo.B = await snap(B);
    await sleep(15000);
    out.fallo.tarde = await snap(A);
    await A.win.evaluate(() => window.__dismiss());
    await sleep(800);

    // 2) quitado el fallo, se vuelve a cobrar el mismo pedido
    await A.win.evaluate(() => { sendOrQueueFactura = window.__realSend; });
    out.reintento = {};
    if (!(await A.win.evaluate(() => cart.length))) await A.win.evaluate(() => { __sel(); });
    await sleep(1500);
    await pay();
    for (let k = 0; k < 80; k++) { const v = await A.win.evaluate(() => cart.length === 0); if (v) { out.reintento.cobrado = true; break; } await sleep(500); }
    await sleep(12000);
    await A.win.evaluate(() => window.__dismiss());
    out.reintento.A = await snap(A);
    let prev = null, same = 0;
    for (let i = 0; i < 20 && same < 2; i++) { const v = await readStock(); same = v === prev ? same + 1 : 0; prev = v; if (same < 2) await sleep(3000); }
    const fin = await readStock();
    out.stock = { inicial: prod.stock, final: fin, esperado: prod.stock - 2, DESCUADRE: Number((fin - (prod.stock - 2)).toFixed(3)) };
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A && B) {
        for (const X of [A, B]) {
          await X.win.evaluate(() => {
            if (window.__realSend) sendOrQueueFactura = window.__realSend;
            if (window.__realBuild) window.buildFsLinesFromCart = window.__realBuild;
            if (!window.__saved) return;
            if (window.__saved.on === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, window.__saved.on);
            if (window.__saved.delay === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, window.__saved.delay);
          }).catch(() => {});
        }
        out.limpiezaFinal = await cleanTable(A, B);
        if (prod && Number.isFinite(prod.stock)) {
          out.restaura = await A.win.evaluate(async (p) => { const rows = await fetchStockRowsByProductReference(findProductByBaseId(p.id)); const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false }); if (row) await updateStockRowCantidad(row, p.stock); return "ok"; }, prod);
        }
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(verdict.fails ? 1 : 0);
  }
})();
