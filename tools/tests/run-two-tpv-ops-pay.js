// run-two-tpv-ops-pay.js -- prueba (entra en la bateria, nivel full) del COBRO con DOS TPV reales a la
// vez contra el demo, en TPV normal, con el guardado por operaciones y el candado de cobro activos.
// COBRA DE VERDAD en el demo (crea 2 facturas de prueba marcadas «[PRUEBA PAGO 2 TPV]» en FacturaScripts demo, como
// run-e2e-real-demo.js) y deja el stock del producto como estaba. Perfiles persistentes de run-two-tpv.js, sesion ya iniciada (nunca PIN).
// Escenarios:
//   S1  los dos pulsan Cobrar sobre el MISMO pedido a la vez -> solo UNO cobra (el otro recibe
//       "se esta cobrando en otro TPV" / "ya cobrado").
//   S2  A cobra mientras B añade una linea al mismo pedido -> la linea de B NO se pierde en silencio
//       dentro del ticket cobrado (se rechaza o se descarta al ver el cobro) y no hay factura doble.
// Requiere parked_ops_pilot_slugs_tpv = ['demo'].
// Uso: node tools/tests/run-two-tpv-ops-pay.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const kills = [];
const NAME1 = "ZZ pay S1 " + Date.now();
const NAME2 = "ZZ pay S2 " + Date.now();

async function launch(dirName, label) {
  const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), dirName), TPV_TEST_LABEL: label };
  delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  kills.push(() => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} });
  let win = null; const t0 = Date.now();
  while (!win && Date.now() - t0 < 60000) {
    for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
    if (!win) await new Promise((r) => setTimeout(r, 500));
  }
  return { app, pid, win, label };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pulsa Cobrar -> forma de pago maxima -> Guardar; devuelve cuando el carrito se vacia o sale un mensaje.
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
  while (Date.now() - t0 < 25000) {
    const st = await X.win.evaluate(() => {
      const ov = document.getElementById("msgOverlay");
      const msg = ov && !ov.classList.contains("hidden") ? (document.getElementById("msgText")?.textContent || "").slice(0, 160) : "";
      const toast = (document.getElementById("toastContainer")?.innerText || "").replace(/\s+/g, " ").slice(0, 200);
      return { vacio: Array.isArray(cart) && cart.length === 0, msg, toast };
    });
    if (st.vacio || st.msg || /cobr/i.test(st.toast || "")) return st;
    await sleep(400);
  }
  return { timeout: true };
}

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  const creadas = (o) => o ? [].concat(o.A || [], o.B || []).filter(Boolean).length : -1;
  const m = out.modo || [];
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  ok("Los dos TPV están en TPV normal con el guardado por partes activo (piloto), con sesión y caja abierta", m.length === 2 && m.every((x) => x.opsTpv && !x.mesas && x.login && x.caja), m);
  ok("S1 (los dos pulsan Cobrar a la vez sobre el MISMO pedido): se crea UNA sola factura, nunca dos", creadas(out.S1_facturas) === 1, out.S1_facturas);
  const e1 = out.S1_estado || [];
  ok("S1: los dos TPV acaban viendo el pedido cobrado (o ya retirado) y con el mismo código de cobro", e1.length === 2 && e1.every((x) => x === "(no esta)" || x.paid === true) && (e1[0] === "(no esta)" || e1[1] === "(no esta)" || e1[0].code === e1[1].code), e1);
  ok("S1: el TPV que no cobró recibe un aviso (se está cobrando en otro TPV / ya cobrado) o su carrito se vacía, sin colgarse", !out.S1?.A?.timeout && !out.S1?.B?.timeout, out.S1);
  ok("S2 (A cobra mientras B añade una línea): solo se crea la factura de A (una)", creadas(out.S2_facturas) === 1, out.S2_facturas);
  const t = out.S2_B?.ticket;
  ok("S2: el ticket cobrado no lleva la línea que B añadió a destiempo (no se factura ni se cuela sin cobrar)", t && t !== "(no esta)" ? (t.paid === true && (t.lineas || []).length === 1) : true, out.S2_B);
  ok("S2: B no pierde su línea en silencio: sigue en su carrito o consta como rechazada (no desaparece sin más)", (out.S2_B?.carrito || []).length >= 1 || out.S2_B?.ticket === "(no esta)" || (out.S2_B?.ticket?.lineas || []).length >= 1, out.S2_B);
  const st = out.stock || {};
  ok("El stock cuadra: se descuentan solo las 2 unidades cobradas (una por factura)", st.DESCUADRE === 0, st);
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 330000);
  const out = {};
  let A, B, prod = null; const created = [];
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);
    const prep = (X) => X.win.evaluate(async () => {
      await setMesasInlineModeEnabled(false, { persist: false });
      const simple = (x) => { const id = getProductBaseId(x); return id && Number(x.price) > 0 && !x.variants && !isOfferPackProductById(id) && !productHasDerivedStockMarker(x) && !(getProductAddonsForProduct(x) || []).length; };
      const managed = products.filter((p) => simple(p) && parseManagedStockValue(p.stockfis) !== null && parseManagedStockValue(p.stockfis) >= 8);
      const p0 = managed[managed.length - 1];
      const p1 = products.find((p) => simple(p) && getProductBaseId(p) !== getProductBaseId(p0) && String(p.name).slice(0, 7) !== String(p0.name).slice(0, 7));
      window.__prods = [p0, p1];
      window.__sent = [];
      if (!window.__realSend) { window.__realSend = sendOrQueueFactura; sendOrQueueFactura = async (...a) => { const r = await window.__realSend(...a); window.__sent.push(!!(r && r.ok)); return r; }; }
      if (!window.__realBuild) { window.__realBuild = window.buildFsLinesFromCart; window.buildFsLinesFromCart = (c) => window.__realBuild(c).map((l) => ({ ...l, descripcion: String(l.descripcion || "") + " [PRUEBA PAGO 2 TPV]" })); }
      window.__dismiss = () => { const ov = document.getElementById("msgOverlay"); if (ov && !ov.classList.contains("hidden")) { Array.from(ov.querySelectorAll("button")).pop()?.click(); } };
      window.__idx = (n) => parkedTickets.findIndex((t) => !t.paid && String(t.name || "") === n);
      return { opsTpv: parkedOpsIsEnabled(getCurrentSlugForReservations(), "tpv"), mesas: MESAS_INLINE_ACTIVE, caja: !!cashSession?.open, login: hasActiveLoginSession() };
    });
    await prep(A); await prep(B);
    await sleep(6000); // el guardado por partes se aprende del servidor al arrancar
    out.modo = [A, B].map(() => null);
    for (let i = 0; i < 2; i++) out.modo[i] = await [A, B][i].win.evaluate(() => ({ opsTpv: parkedOpsIsEnabled(getCurrentSlugForReservations(), "tpv"), mesas: MESAS_INLINE_ACTIVE, caja: !!cashSession?.open, login: hasActiveLoginSession() }));
    if (!out.modo.every((m) => m.login && m.caja)) throw new Error("Falta sesion o caja abierta: " + JSON.stringify(out.modo));
    prod = await A.win.evaluate(async () => { const p = __prods[0]; const id = getProductBaseId(p); const r = await fetchStockRowsByProductReference(findProductByBaseId(id) || p); const row = pickStockRowByWarehouse(r, getCurrentWarehouseCode(), { strict: false }); return { id, name: String(p.name).slice(0, 30), stock: Number(row?.cantidad) }; });
    if (!prod || !Number.isFinite(prod.stock)) throw new Error("No hay producto con stock gestionado >= 8 en el demo");
    out.producto = prod;
    const readStock = () => A.win.evaluate(async (id) => { const rows = await fetchStockRowsByProductReference(findProductByBaseId(id)); const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false }); return Number(row?.cantidad); }, prod.id);
    const sentOf = async () => { const r = await Promise.all([A, B].map((X) => X.win.evaluate(() => { const v = window.__sent.slice(); window.__sent = []; return v; }))); return { A: r[0], B: r[1] }; };

    const makeAndOpenBoth = async (NAME) => {
      await A.win.evaluate(async (NAME) => {
        cart = [buildCartLine(__prods[0], 1)]; renderCart();
        await parkCurrentCart(NAME, "", { openListAfterSave: false, skipAutoPrint: true, skipStockConfirm: true, parkingMode: PARKED_MODE_TPV });
      }, NAME);
      await sleep(2500);
      for (const X of [A, B]) {
        for (let k = 0; k < 6; k++) {
          const n = await X.win.evaluate(async (NAME) => { await refreshRemoteParkedReservationsOnly(); const i = __idx(NAME); if (i >= 0) restoreParkedCartByIndex(i); return cart.length; }, NAME);
          if (n > 0) break;
          await sleep(1500);
        }
      }
      await sleep(1200);
      created.push(NAME);
    };

    // ---------- S1: los dos cobran el mismo pedido a la vez ----------
    await makeAndOpenBoth(NAME1);
    const [rA, rB] = await Promise.all([drivePay(A), (async () => { await sleep(250); return drivePay(B); })()]);
    out.S1 = { A: rA, B: rB };
    await sleep(8000);
    out.S1_facturas = await sentOf();
    for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(1500);
    out.S1_estado = await Promise.all([A, B].map((X) => X.win.evaluate((NAME) => {
      const t = parkedTickets.find((x) => String(x.name || "") === NAME);
      return t ? { paid: !!t.paid, code: t.paidTicketCode || null, pid: t.paidTicketId || null } : "(no esta)";
    }, NAME1)));
    for (const X of [A, B]) await X.win.evaluate(() => __dismiss());

    // ---------- S2: A cobra mientras B añade una linea ----------
    await makeAndOpenBoth(NAME2);
    const payA = drivePay(A);
    await sleep(700);
    await B.win.evaluate(() => { cart.push(buildCartLine(__prods[1], 1)); renderCart(); });
    out.S2_A = await payA;
    await sleep(9000);
    out.S2_facturas = await sentOf();
    await B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(2000);
    out.S2_B = await B.win.evaluate((NAME) => {
      const t = parkedTickets.find((x) => String(x.name || "") === NAME);
      return { ticket: t ? { paid: !!t.paid, lineas: (t.items || []).map((l) => String(l.name).slice(0, 8) + ":" + l.qty), code: t.paidTicketCode || null } : "(no esta)", carrito: cart.map((c) => String(c.name).slice(0, 8) + ":" + c.qty) };
    }, NAME2);
    { let prev = null, same = 0; for (let i = 0; i < 20 && same < 2; i++) { const v = await readStock(); same = v === prev ? same + 1 : 0; prev = v; if (same < 2) await sleep(3000); }
      const fin = await readStock(); out.stock = { inicial: prod.stock, final: fin, esperado: prod.stock - 2, DESCUADRE: Number((fin - (prod.stock - 2)).toFixed(3)) }; }
    out.S2_A_estado = await A.win.evaluate((NAME) => { const t = parkedTickets.find((x) => String(x.name || "") === NAME); return t ? { paid: !!t.paid, lineas: (t.items || []).map((l) => String(l.name).slice(0, 8) + ":" + l.qty) } : "(no esta)"; }, NAME2);
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A) {
        out.limpieza = await A.win.evaluate(async (names) => {
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          for (const n of names) {
            const t = parkedTickets.find((x) => String(x.name || "") === n);
            try { if (t) await apiDeleteParkedReservation(t); } catch (e) {}
          }
          return "ok";
        }, created);
        await sleep(2000);
        for (const X of [A, B]) await X.win.evaluate(() => { if (window.__realSend) sendOrQueueFactura = window.__realSend; if (window.__realBuild) window.buildFsLinesFromCart = window.__realBuild; }).catch(() => {});
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
