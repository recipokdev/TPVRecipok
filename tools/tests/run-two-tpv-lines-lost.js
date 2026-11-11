// run-two-tpv-lines-lost.js -- INVESTIGACION MANUAL (no entra en npm test) del fallo "Mesas pierde lineas".
//
// Dos TPV reales a la vez contra el demo (perfiles persistentes de run-two-tpv.js con sesion ya iniciada; nunca PIN), los dos en
// Modo Mesas (vista transacciones) y con la misma mesa M3. A añade 4 productos seguidos (1,5 s entre uno y otro) y se
// registra, en A y en B, una linea de tiempo con: longitud del carrito, pedido cargado, guardados (parkCurrentCart, API),
// recargas del carrito (syncTpvCartWithSelectedMesa, restoreParkedCartByIndex, mergeMissing...) y, cuando el carrito
// ENCOGE, la pila de llamadas que lo provoca. Al final compara: unidades añadidas vs carrito de A vs pedido guardado.
//
// SEGURIDAD (ver notas del bucle del 2026-10-14): tope duro -- si el carrito de A/B o algun pedido de la mesa pasa de 12
// lineas, se aborta al instante y se limpia la mesa. Solo toca la mesa M3 del demo y devuelve el stock de los productos.
// --stale-draft: variante "reinicio con borrador viejo": con el pedido ya guardado, se deja en el plano un borrador de 1 linea,
//   se vacia el carrito sin pedido cargado (como tras reiniciar con la mesa seleccionada) y se añade 1 producto; se mira si el pedido
//   guardado conserva sus lineas (esperado: las que tenia + 1).
// Uso: node tools/tests/run-two-tpv-lines-lost.js [--no-ops] [--adds=4] [--solo-a] [--stale-draft]
//   --solo-a: arranca solo A (para comparar con "dos TPV").
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = process.env.TPV_ROOT ? path.resolve(process.env.TPV_ROOT) : path.resolve(__dirname, "..", "..");
const NO_OPS = process.argv.includes("--no-ops");
const SOLO_A = process.argv.includes("--solo-a");
const STALE = process.argv.includes("--stale-draft");
const ADDS = Number((process.argv.find((a) => a.startsWith("--adds=")) || "--adds=4").split("=")[1]) || 4;
const TABLE = "tut-room-1::m3";
const MAX_LINES = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kills = [];

async function launch(dirName, label) {
  const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), dirName), TPV_TEST_LABEL: label };
  delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
  const app = process.env.TPV_EXE
    ? await electron.launch({ executablePath: process.env.TPV_EXE, args: [], env })
    : await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  kills.push(() => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} });
  let win = null; const t0 = Date.now();
  while (!win && Date.now() - t0 < 60000) {
    for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
    if (!win) await sleep(500);
  }
  return { app, pid, win, label };
}

const prep = (X) => X.win.evaluate(async ([NO_OPS, MAX_LINES, TABLE]) => {
  await setMesasInlineModeEnabled(true, { persist: false });
  setMesasInlineView("transacciones", { persist: false });
  if (NO_OPS) parkedOpsIsEnabled = () => false;

  // ---- linea de tiempo ----
  window.__tl = [];
  const T0 = Date.now();
  window.__T0 = T0;
  const push = (o) => window.__tl.push({ t: Number(((Date.now() - T0) / 1000).toFixed(2)), ...o });
  const stk = () => String(new Error().stack || "").split(String.fromCharCode(10)).slice(3, 9)
    .map((l) => l.trim().replace(/^at /, "").replace(/file:\/\/\/[^)]*\//g, "")).join(" < ");
  const info = () => { const t = getCurrentLoadedParkedTicket(); return { cart: cart.length, loaded: t ? String(t.id).slice(-5) : null, litems: t ? (t.items || []).length : null }; };
  const wrap = (name, desc, withStack) => {
    let orig; try { orig = eval(name); } catch (e) { push({ fn: name, installErr: String(e) }); return; }
    const w = function (...a) {
      let d = {};
      try { d = desc ? desc(a) : {}; } catch (e) {}
      push({ fn: name, ...info(), ...d, stack: withStack ? stk() : undefined });
      return orig.apply(this, a);
    };
    try { eval(`${name} = w`); } catch (e) { push({ fn: name, installErr: String(e) }); }
  };
  wrap("syncTpvCartWithSelectedMesa", () => ({}), true);
  wrap("restoreParkedCartByIndex", (a) => ({ idx: a[0] }), true);
  wrap("parkCurrentCart", (a) => ({ silent: a[2]?.silentAutoSave === true }), true);
  wrap("mergeMissingRemoteLinesIntoCart", () => ({}), true);
  wrap("mergeRemoteChangesIntoLoadedParkedTicketIfAny", () => ({}), true);
  wrap("apiSaveParkedReservation", (a) => ({ saveItems: (a[0]?.items || []).length, saveId: String(a[0]?.id).slice(-5) }), false);
  wrap("saveMesasTablesStateForInline", (a) => { const st = a[0] || {}; return { draftLines: (st.draftCartByTable?.[TABLE] || []).length, map: String(st.tableTicketMap?.[TABLE] || "").slice(-5) }; }, false);
  // renderCart: solo se anota si el carrito CAMBIA de longitud (y con pila si ENCOGE)
  let lastLen = -1;
  const origRender = renderCart;
  renderCart = function (...a) {
    const r = origRender.apply(this, a);
    if (cart.length !== lastLen) { push({ fn: "renderCart", ...info(), de: lastLen, stack: cart.length < lastLen ? stk() : undefined }); lastLen = cart.length; }
    return r;
  };
  // tope duro de seguridad
  window.__overflow = () => {
    const big = parkedTickets.filter((t) => t.mesaUid === TABLE && (t.items || []).length > MAX_LINES).length;
    return cart.length > MAX_LINES || big > 0;
  };
  window.__dismiss = () => { const ov = document.getElementById("msgOverlay"); if (ov && !ov.classList.contains("hidden")) { Array.from(ov.querySelectorAll("button")).pop()?.click(); } };
  return { login: hasActiveLoginSession(), cajaAbierta: !!cashSession?.open, mesas: !!MESAS_INLINE_ACTIVE, ops: parkedOpsIsEnabled(getCurrentSlugForReservations(), "mesas") };
}, [NO_OPS, MAX_LINES, TABLE]);

const cleanTable = (X) => X.win.evaluate(async (TABLE) => {
  cart = []; setCurrentParkedTicketIndex(null); renderCart();
  let borrados = 0;
  for (let round = 0; round < 3; round++) {
    const mine = parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE);
    if (!mine.length) break;
    for (const t of mine) { try { await apiDeleteParkedReservation(t); borrados++; } catch (e) {} }
    for (let i = parkedTickets.length - 1; i >= 0; i--) if (!parkedTickets[i].paid && parkedTickets[i].mesaUid === TABLE) parkedTickets.splice(i, 1);
    saveParkedTicketsCache();
    await new Promise((r) => setTimeout(r, 1500));
    await refreshRemoteParkedReservationsOnly().catch(() => {});
  }
  const st = loadMesasTablesStateForInline();
  if (st?.tableTicketMap) delete st.tableTicketMap[TABLE];
  if (st?.draftCartByTable) delete st.draftCartByTable[TABLE];
  saveMesasTablesStateForInline(st);
  return { borrados, quedan: parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).length };
}, TABLE);

// Comprobaciones (veredicto) para la bateria de pruebas: ver tools/tests/battery/.
function buildChecks(out) {
  const c = [];
  c.push(["La prueba terminó sin errores ni abortos de seguridad", !out.ERROR && !out.ABORTADO, out.ERROR || out.ABORTADO || ""]);
  if (STALE) {
    c.push(["Con un borrador viejo en el plano, el pedido conserva sus líneas y suma el producto nuevo", out.stale?.pedidoUnidadesDespues === out.stale?.esperado, `${out.stale?.pedidoUnidadesAntes} -> ${out.stale?.pedidoUnidadesDespues} (esperado ${out.stale?.esperado})`]);
  } else {
    c.push([`Los ${out.adds} productos añadidos seguidos se guardan todos (no se pierde ninguno)`, out.PERDIDAS === 0, `perdidas ${out.PERDIDAS}`]);
    if (out.final?.B) c.push(["El otro TPV ve el pedido completo", (out.final.B.pedidosMesa || []).length === 1 && out.final.B.pedidosMesa[0].unidades === out.adds, JSON.stringify(out.final.B.pedidosMesa)]);
  }
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 300000);
  const out = { noOps: NO_OPS, soloA: SOLO_A, adds: ADDS };
  let A, B; const prods = [];
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    if (!SOLO_A) B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);
    out.estado = [await prep(A)];
    if (B) out.estado.push(await prep(B));
    if (!out.estado.every((e) => e.login && e.cajaAbierta)) throw new Error("Falta sesion iniciada o caja abierta (no se escribe PIN): " + JSON.stringify(out.estado));

    const pick = await A.win.evaluate(async () => {
      const cand = products.filter((p) => {
        const id = getProductBaseId(p);
        const st = parseManagedStockValue(p.stockfis);
        return id && st !== null && st >= 8 && Number(p.price) > 0 && !p.variants && !isOfferPackProductById(id) && !productHasDerivedStockMarker(p);
      });
      const rows = [];
      for (const p of cand.slice(-2)) {
        const id = getProductBaseId(p);
        const r = await fetchStockRowsByProductReference(findProductByBaseId(id) || p);
        const row = pickStockRowByWarehouse(r, getCurrentWarehouseCode(), { strict: false });
        rows.push({ id, name: String(p.name).slice(0, 30), stock: Number(row?.cantidad) });
      }
      return rows;
    });
    prods.push(...pick); out.productos = pick;

    out.limpieza_previa = [await cleanTable(A)];
    if (B) out.limpieza_previa.push(await cleanTable(B));
    await sleep(1500);
    await A.win.evaluate((TABLE) => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); }, TABLE);
    await sleep(1000);

    // ---- A añade ADDS productos seguidos; en cada paso se mira el carrito justo despues y 1,3 s despues ----
    out.pasos = [];
    for (let i = 0; i < ADDS; i++) {
      const pid = prods[i % prods.length].id;
      const antes = await A.win.evaluate(() => cart.reduce((a, l) => a + Number(l.qty || 0), 0));
      await A.win.evaluate(async (pid) => { await addToCart(findProductByBaseId(pid)); }, pid);
      const justo = await A.win.evaluate(() => ({ lineas: cart.length, unidades: cart.reduce((a, l) => a + Number(l.qty || 0), 0) }));
      await sleep(1300);
      const despues = await A.win.evaluate(() => { const t = getCurrentLoadedParkedTicket(); return { lineas: cart.length, unidades: cart.reduce((a, l) => a + Number(l.qty || 0), 0), pedidoUnidades: t ? t.items.reduce((a, l) => a + Number(l.qty || 0), 0) : null }; });
      out.pasos.push({ n: i + 1, antes, justo, despues1300ms: despues });
      for (const X of [A, B].filter(Boolean)) {
        if (await X.win.evaluate(() => window.__overflow())) { out.ABORTADO = `tope de ${MAX_LINES} lineas superado en ${X.label} tras el paso ${i + 1}`; throw new Error(out.ABORTADO); }
      }
    }
    await sleep(6000);
    if (STALE) {
      const antes = await A.win.evaluate(() => { const t = getCurrentLoadedParkedTicket(); return t ? t.items.reduce((a, l) => a + Number(l.qty || 0), 0) : null; });
      out.stale = { pedidoUnidadesAntes: antes };
      await A.win.evaluate((TABLE) => {
        const st = loadMesasTablesStateForInline();
        st.draftCartByTable = st.draftCartByTable || {};
        st.draftCartByTable[TABLE] = cart.slice(0, 1).map((l) => ({ ...l })); // borrador VIEJO/parcial: 1 linea
        saveMesasTablesStateForInline(st);
        cart = []; setCurrentParkedTicketIndex(null); // como tras reiniciar con la mesa seleccionada
        syncTpvCartWithSelectedMesa();
      }, TABLE);
      await sleep(1500);
      out.stale.carritoTrasSync = await A.win.evaluate(() => ({ lineas: cart.length, unidades: cart.reduce((a, l) => a + Number(l.qty || 0), 0), cargado: !!getCurrentLoadedParkedTicket() }));
      await A.win.evaluate(async (pid) => { await addToCart(findProductByBaseId(pid)); }, prods[0].id);
      await sleep(5000);
      out.stale.pedidoUnidadesDespues = await A.win.evaluate(() => { const t = getCurrentLoadedParkedTicket(); return t ? t.items.reduce((a, l) => a + Number(l.qty || 0), 0) : null; });
      out.stale.esperado = antes + 1;
      out.stale.PERDIDAS = out.stale.esperado - (out.stale.pedidoUnidadesDespues || 0);
      if (await A.win.evaluate(() => window.__overflow())) out.ABORTADO = "tope de lineas superado en la variante stale-draft";
    }
    out.final = {
      A: await A.win.evaluate(() => { const t = getCurrentLoadedParkedTicket(); return { carritoUnidades: cart.reduce((a, l) => a + Number(l.qty || 0), 0), pedido: t ? { id: String(t.id).slice(-5), lineas: t.items.length, unidades: t.items.reduce((a, l) => a + Number(l.qty || 0), 0) } : null }; }),
    };
    if (B) out.final.B = await B.win.evaluate((TABLE) => ({ carritoUnidades: cart.reduce((a, l) => a + Number(l.qty || 0), 0), pedidosMesa: parkedTickets.filter((t) => t.mesaUid === TABLE && !t.paid).map((t) => ({ id: String(t.id).slice(-5), lineas: t.items.length, unidades: t.items.reduce((a, l) => a + Number(l.qty || 0), 0) })) }), TABLE);
    out.esperado_unidades = ADDS;
    out.PERDIDAS = ADDS - (out.final.A.pedido ? out.final.A.pedido.unidades : 0);
    out.linea_tiempo_A = await A.win.evaluate(() => window.__tl);
    if (B) out.linea_tiempo_B = await B.win.evaluate(() => window.__tl);
  } catch (e) {
    out.ERROR = String((e && e.message) || e).slice(0, 400);
  } finally {
    try {
      if (A) {
        out.limpieza = [await cleanTable(A)];
        if (B) out.limpieza.push(await cleanTable(B));
        await A.win.evaluate(async (prods) => {
          for (const p of prods) {
            const rows = await fetchStockRowsByProductReference(findProductByBaseId(p.id));
            // SOLO la fila del almacen actual (los productos del demo tienen una 2a fila en otro almacen)
            const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: true }) || pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
            if (row && Number.isFinite(p.stock)) await updateStockRowCantidad(row, p.stock);
          }
        }, prods);
        await sleep(2000);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 160); }
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(verdict.fails ? 1 : 0);
  }
})();
