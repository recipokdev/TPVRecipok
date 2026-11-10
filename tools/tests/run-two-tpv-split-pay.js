// run-two-tpv-split-pay.js -- prueba MANUAL (no entra en npm test): DIVIDIR y COBRAR una cuenta con DOS TPV reales a la vez en
// Modo Mesas contra el demo (mesa M3, que deja limpia). Perfiles persistentes de run-two-tpv.js con sesion ya iniciada (nunca PIN).
//   1) A crea el pedido de M3 (2 productos con stock gestionado, 2 unidades de cada uno) y B lo abre tambien;
//   2) A divide la cuenta en 2 partes (1 unidad de cada producto por parte);
//   3) B (que tenia abierto el pedido original) refresca y ve las dos partes;
//   4) A cobra la parte 1 y, A LA VEZ, B abre la parte 2 y la cobra;
//   5) se comprueba: las 2 partes quedan pagadas, no hay pedidos duplicados ni pendientes en la mesa (en A, en B y en el servidor
//     ; el servidor se revisa aparte), y el stock de cada producto = inicial - 2.
// COBRA DE VERDAD en el demo (2 facturas de prueba) y deja el stock de los dos productos como estaba.
// Opciones: --no-ops (apaga en los dos clientes el piloto de operaciones, como los clientes reales).
// Con --seq: en vez de cobrar A y B a la vez, A cobra la parte 1 y, cuando termina, B abre y cobra la parte 2 (caso mas realista).
// Uso: node tools/tests/run-two-tpv-split-pay.js [--no-ops] [--seq]
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = process.env.TPV_ROOT ? path.resolve(process.env.TPV_ROOT) : path.resolve(__dirname, "..", "..");
const NO_OPS = process.argv.includes("--no-ops");
const SEQ = process.argv.includes("--seq");
const TABLE = "tut-room-1::m3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kills = [];

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

async function drivePay(X) {
  await X.win.evaluate(() => { document.querySelector("#payBtn")?.click(); });
  await X.win.waitForSelector("#payModal:not(.hidden), .pay-modal:not(.hidden)", { timeout: 8000 }).catch(() => {});
  await sleep(300);
  const codpago = await X.win.evaluate(() => document.querySelector("input.pay-amount")?.getAttribute("data-codpago") || null);
  if (codpago) {
    await X.win.evaluate((c) => { document.querySelector(`input.pay-amount[data-codpago="${c}"]`)?.parentElement?.querySelector("button.pay-max")?.click(); }, codpago);
    await sleep(200);
    await X.win.evaluate(() => { document.getElementById("paySaveBtn")?.click(); });
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const st = await X.win.evaluate(() => {
      const ov = document.getElementById("msgOverlay");
      const msg = ov && !ov.classList.contains("hidden") ? (document.getElementById("msgText")?.textContent || "").slice(0, 200) : "";
      return { vacio: Array.isArray(cart) && cart.length === 0, msg };
    });
    if (st.vacio || st.msg) return st;
    await sleep(400);
  }
  return { timeout: true, diag: await X.win.evaluate(() => ({
    modalCobro: !!document.querySelector("#payModal:not(.hidden), .pay-modal:not(.hidden)"),
    cart: cart.length,
    cargado: (() => { const t = getCurrentLoadedParkedTicket(); return t ? { name: t.name, paid: !!t.paid, closing: !!t.closingInProgress } : null; })(),
    avisos: (window.__toasts || []).slice(-12),
  })) };
}

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

const tableTickets = (X, BASE) => X.win.evaluate(([TABLE, BASE]) => parkedTickets
  .filter((t) => (t.mesaUid === TABLE || String(t.name || "").startsWith(BASE)) && (!t.paid || String(t.name || "").startsWith(BASE)))
  .map((t) => ({ id: String(t.id).slice(-5), name: t.name, paid: !!t.paid, closing: !!t.closingInProgress, items: (t.items || []).map((l) => l.qty).join("+") })), [TABLE, BASE]);

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 330000);
  const out = { noOps: NO_OPS };
  let A, B; const prods = [];
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    await sleep(8000);
    const prep = (X) => X.win.evaluate(async ([NO_OPS]) => {
      await setMesasInlineModeEnabled(true, { persist: false });
      setMesasInlineView("transacciones", { persist: false });
      if (NO_OPS) parkedOpsIsEnabled = () => false;
      window.__toasts = [];
      const origToast = toast;
      toast = function (...a) { try { window.__toasts.push(String(a[0]).slice(0, 140)); } catch (e) {} return origToast.apply(this, a); };
      const origBegin = beginParkedCheckoutLock;
      beginParkedCheckoutLock = function (i) { const r = origBegin.apply(this, [i]); window.__toasts.push("[lock] beginParkedCheckoutLock(" + i + ") -> " + (r ? "ok" : "NULL")); return r; };
      window.__dismiss = () => { const ov = document.getElementById("msgOverlay"); if (ov && !ov.classList.contains("hidden")) { Array.from(ov.querySelectorAll("button")).pop()?.click(); } };
      return { login: hasActiveLoginSession(), cajaAbierta: !!cashSession?.open, mesas: !!MESAS_INLINE_ACTIVE, ops: parkedOpsIsEnabled(getCurrentSlugForReservations(), "mesas") };
    }, [NO_OPS]);
    out.estado = [await prep(A)];
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
    if (pick.length < 2) throw new Error("No hay 2 productos con stock gestionado >= 8 en el demo");
    prods.push(...pick); out.productos = pick;
    const readStock = (X, id) => X.win.evaluate(async (id) => {
      const rows = await fetchStockRowsByProductReference(findProductByBaseId(id));
      const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
      return Number(row?.cantidad);
    }, id);

    out.limpieza_previa = [await cleanTable(A)];
    await sleep(1500);
    // Solo A selecciona la mesa al principio; B la abre DESPUES de que A tenga el pedido guardado (si no, B interfiere con lo que añade A).
    await A.win.evaluate((TABLE) => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); }, TABLE);
    await sleep(800);

    // 1) A crea el pedido (2 unidades de cada producto en 4 lineas) y espera a que quede guardado. Montar un pedido de
    // Mesas anadiendo productos seguidos pierde a veces lineas (fallo conocido "Mesas pierde lineas", ver notas): se
    // reintenta hasta 3 veces y se anota cuantos intentos hicieron falta; la prueba va del DIVIDIR y COBRAR, no de eso.
    out.setup_intentos = 0;
    for (let intento = 1; intento <= 3; intento++) {
      out.setup_intentos = intento;
      if (intento > 1) {
        await cleanTable(A);
        await sleep(1500);
        await A.win.evaluate((TABLE) => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); }, TABLE);
        await sleep(800);
      }
      await A.win.evaluate(async (ids) => {
        for (const id of ids) for (let k = 0; k < 2; k++) { await addToCart(findProductByBaseId(id)); await new Promise((r) => setTimeout(r, 1500)); }
      }, prods.map((p) => p.id));
      const tS = Date.now();
      while (Date.now() - tS < 25000) {
        const ok = await A.win.evaluate(() => {
          const t = getCurrentLoadedParkedTicket();
          const sum = (arr) => arr.reduce((a, l) => a + Number(l.qty || 0), 0);
          return !!t && t.items?.length === cart.length && sum(t.items) === sum(cart) && sum(cart) === 4;
        });
        if (ok) break;
        await sleep(500);
      }
      await sleep(2500);
      out.A_pedido = await A.win.evaluate(() => { const t = getCurrentLoadedParkedTicket(); return t ? { id: t.id, name: t.name, lineas: t.items.length, unidades: t.items.reduce((a, l) => a + Number(l.qty || 0), 0) } : null; });
      if (out.A_pedido && out.A_pedido.unidades === 4) break;
    }
    if (!out.A_pedido || out.A_pedido.unidades !== 4) throw new Error("No se pudo montar el pedido de preparacion con 4 unidades en 3 intentos: " + JSON.stringify(out.A_pedido));
    const BASE = out.A_pedido?.name || "@@";

    // Ahora arranca B (con el pedido ya guardado en el servidor) y abre la misma mesa: ve el pedido original
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);
    out.estado.push(await prep(B));
    if (!out.estado[1].login || !out.estado[1].cajaAbierta) throw new Error("B sin sesion o sin caja abierta: " + JSON.stringify(out.estado[1]));
    // B puede traer en su cache local pedidos viejos de pruebas anteriores: se quitan (menos el de A) antes de abrir la mesa
    out.limpieza_previa_B = await B.win.evaluate(async ([TABLE, KEEP]) => {
      await refreshRemoteParkedReservationsOnly().catch(() => {});
      let quitados = 0;
      for (let i = parkedTickets.length - 1; i >= 0; i--) {
        const t = parkedTickets[i];
        if (!t.paid && t.mesaUid === TABLE && String(t.id) !== String(KEEP)) { parkedTickets.splice(i, 1); quitados++; }
      }
      saveParkedTicketsCache();
      return { quitados, quedan: parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).length };
    }, [TABLE, out.A_pedido.id]);
    await B.win.evaluate(async (TABLE) => { await refreshRemoteParkedReservationsOnly(); updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); }, TABLE);
    await sleep(2500);
    out.B_ve_original = await B.win.evaluate(() => ({ cargado: getCurrentLoadedParkedTicket()?.name || null, lineas: cart.length }));

    // 2) A divide por articulos (lineas pares a la parte 1, impares a la 2)
    await A.win.evaluate(async () => {
      document.getElementById("parkedSplitBtn").click();
      await new Promise((r) => setTimeout(r, 500));
      const sel = document.getElementById("splitTicketModeSelect");
      sel.value = "items"; sel.dispatchEvent(new Event("change"));
      splitTicketPartsCount = 2;
      if (splitTicketPartsInput) splitTicketPartsInput.value = "2";
      splitTicketMode = "items";
      initSplitItemsMatrixFromCurrentCart();
      splitTicketItemsMatrix = cart.map((l, i) => (i % 2 === 0 ? [Number(l.qty), 0] : [0, Number(l.qty)]));
      await confirmSplitTicket();
    });
    await sleep(2500);
    out.A_tras_dividir = await tableTickets(A, BASE);

    // 3) B refresca y ve las dos partes
    for (let i = 0; i < 8; i++) {
      await B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
      const n = await B.win.evaluate(() => parkedTickets.filter((t) => !t.paid && getTicketSplitMeta(t)).length);
      if (n >= 2) break;
      await sleep(1500);
    }
    out.B_ve_partes = await tableTickets(B, BASE);

    // 4) A cobra la parte 1 y B cobra la parte 2 (a la vez, o una detras de otra con --seq)
    const openPart2InB = () => B.win.evaluate(async () => {
      await refreshRemoteParkedReservationsOnly().catch(() => {});
      const i = parkedTickets.findIndex((t) => !t.paid && getTicketSplitMeta(t)?.part === 2);
      if (i < 0) return false;
      restoreParkedCartByIndex(i);
      return { cargado: getCurrentLoadedParkedTicket()?.name, lineas: cart.length };
    });
    if (SEQ) {
      out.A_carga_antes = await A.win.evaluate(() => getCurrentLoadedParkedTicket()?.name || null);
      out.cobro = { A: await drivePay(A) };
      const tR = Date.now();
      while (Date.now() - tR < 20000) {
        if (await A.win.evaluate(() => getTicketSplitMeta(getCurrentLoadedParkedTicket())?.part === 2)) break;
        await sleep(500);
      }
      out.A_tras_cobrar_parte1 = await A.win.evaluate(() => ({ cargado: getCurrentLoadedParkedTicket()?.name || null, cart: cart.length }));
      await A.win.evaluate(() => window.__dismiss());
      out.B_abre_parte2 = await openPart2InB();
      await sleep(800);
      out.cobro.B = await drivePay(B);
    } else {
      out.B_abre_parte2 = await openPart2InB();
      await sleep(800);
      const payA = drivePay(A);
      await sleep(300);
      const payB = drivePay(B);
      out.cobro = { A: await payA, B: await payB };
    }

    // 5) esperar a que todo se asiente y comprobar
    const tW = Date.now();
    while (Date.now() - tW < 60000) {
      for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly().catch(() => {}); window.__dismiss(); });
      const pend = await A.win.evaluate((TABLE) => parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).length, TABLE);
      const pendB = await B.win.evaluate((TABLE) => parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).length, TABLE);
      if (pend === 0 && pendB === 0) break;
      await sleep(3000);
    }
    out.espera_asentar_s = Math.round((Date.now() - tW) / 100) / 10;
    out.A_final = await tableTickets(A, BASE);
    out.B_final = await tableTickets(B, BASE);
    out.pendientes_en_mesa = { A: out.A_final.filter((t) => !t.paid).length, B: out.B_final.filter((t) => !t.paid).length };

    out.stock = [];
    for (const p of prods) {
      let prev = null, same = 0;
      for (let i = 0; i < 20 && same < 2; i++) { const v = await readStock(A, p.id); same = v === prev ? same + 1 : 0; prev = v; if (same < 2) await sleep(3000); }
      const fin = await readStock(A, p.id);
      out.stock.push({ id: p.id, nombre: p.name, inicial: p.stock, final: fin, esperado: p.stock - 2, DESCUADRE: Number((fin - (p.stock - 2)).toFixed(3)) });
    }
  } catch (e) {
    out.ERROR = String((e && e.message) || e).slice(0, 500);
  } finally {
    try {
      if (A) {
        out.limpieza = await cleanTable(A);
        if (B) await cleanTable(B);
        await A.win.evaluate(async (prods) => {
          for (const p of prods) {
            const rows = await fetchStockRowsByProductReference(findProductByBaseId(p.id));
            const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
            if (row && Number.isFinite(p.stock)) await updateStockRowCantidad(row, p.stock);
          }
        }, prods);
        await sleep(2000);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 160); }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(0);
  }
})();
