// run-caja-devoluciones.js -- prueba (entra en la bateria, nivel full) de CAJA y DEVOLUCIONES con UN TPV real contra la demo.
//
// Perfil persistente de run-two-tpv.js con la sesion ya iniciada (nunca se escribe PIN) y la caja de la demo abierta.
// COBRA DE VERDAD en la demo: 2 ventas y 2 devoluciones (lineas marcadas "[PRUEBA CAJA]"; FacturaScripts no deja borrar facturas)
// y 2 movimientos de caja que se compensan (+10 / -10) para dejar la caja como estaba.
//
// Recorrido:
//   0) cierre de caja "como si": se leen los totales reales de FacturaScripts (runCashCloseSummaryComputation) -> base;
//   1) movimientos: una cantidad 0 se rechaza; +10 sube el esperado en 10; -10 lo devuelve a la base;
//   2) venta A en EFECTIVO (2 uds. del producto 1): sube efectivo, ventas y esperado; los acumulados en vivo = los reales;
//   3) venta B con TARJETA (2 uds. del producto 2): sube ventas pero NO el efectivo ni el esperado;
//   4) devolucion PARCIAL de A (1 ud.) por la pantalla de Tickets: baja efectivo/ventas; el ticket sale «PARCIAL»,
//      la rectificativa es serie R, ligada a la original, con el efectivo devuelto correcto;
//   5) devolucion TOTAL de B: no baja el efectivo (era tarjeta); el ticket sale «DEVUELTO» y ya no ofrece devolver;
//   6) la devolucion parcial deja pendiente solo la unidad que falta (no se puede devolver mas de lo vendido);
//   7) el cuadro de «Cerrar caja» muestra el mismo esperado que el calculo real;
//   8) stock: producto 1 = inicial - 1 (vendio 2, devolvio 1); producto 2 = inicial (vendio 2, devolvio 2).
// Uso: node tools/tests/run-caja-devoluciones.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = process.env.TPV_ROOT ? path.resolve(process.env.TPV_ROOT) : path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kills = [];
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.006;

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

// Cobra el carrito actual con UNA forma de pago ("cash" = efectivo, "card" = cualquier otra) y espera a que el carrito quede vacio.
async function drivePay(X, kind) {
  await X.win.evaluate(() => { document.querySelector("#payBtn")?.click(); });
  await X.win.waitForSelector("#payModal:not(.hidden), .pay-modal:not(.hidden)", { timeout: 8000 }).catch(() => {});
  await sleep(300);
  const codpago = await X.win.evaluate((kind) => {
    const codes = Array.from(document.querySelectorAll("input.pay-amount")).map((i) => i.getAttribute("data-codpago")).filter(Boolean);
    const cash = codes.find((c) => isCashCodpago(c));
    return kind === "cash" ? cash || null : codes.find((c) => !isCashCodpago(c)) || null;
  }, kind);
  if (!codpago) return { sinMetodo: true };
  await X.win.evaluate((c) => { document.querySelector(`input.pay-amount[data-codpago="${c}"]`)?.parentElement?.querySelector("button.pay-max")?.click(); }, codpago);
  await sleep(200);
  await X.win.evaluate(() => { document.getElementById("paySaveBtn")?.click(); });
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const st = await X.win.evaluate(() => {
      const ov = document.getElementById("msgOverlay");
      const msg = ov && !ov.classList.contains("hidden") ? (document.getElementById("msgText")?.textContent || "").slice(0, 160) : "";
      return { vacio: Array.isArray(cart) && cart.length === 0, msg };
    });
    if (st.vacio || st.msg) return { ...st, codpago };
    await sleep(400);
  }
  return { timeout: true, codpago };
}

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : String(extra)]);
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  const m = out.mov || {};
  ok("Un movimiento de caja de 0 € se rechaza con aviso", m.avisoCero === true, m.avisoCeroTxt);
  ok("Una entrada de 10 € sube el total esperado en 10", near(m.deltaEntrada?.esperado, 10) && near(m.deltaEntrada?.movimientos, 10), JSON.stringify(m.deltaEntrada));
  ok("Una salida de 10 € devuelve el esperado a su valor inicial", near(m.deltaSalida?.esperado, 0) && near(m.deltaSalida?.movimientos, 0), JSON.stringify(m.deltaSalida));
  const a = out.ventaA || {}, b = out.ventaB || {};
  ok("La venta en efectivo se cobra y se crea su factura", a.cobrada === true && a.total > 0, JSON.stringify({ total: a.total, pago: a.codpago }));
  ok("Venta en efectivo: «Cobros Efectivo» sube lo vendido", near(a.delta?.efectivo, a.total), JSON.stringify(a.delta));
  ok("Venta en efectivo: «Total Ventas» sube lo vendido", near(a.delta?.ventas, a.total), JSON.stringify(a.delta));
  ok("Venta en efectivo: el total esperado de caja sube lo vendido", near(a.delta?.esperado, a.total), JSON.stringify(a.delta));
  ok("Venta en efectivo: los acumulados en vivo del TPV coinciden con los reales de FacturaScripts", a.vivoIgualReal === true, JSON.stringify(a.vivo));
  ok("La venta con tarjeta se cobra y se crea su factura", b.cobrada === true && b.total > 0, JSON.stringify({ total: b.total, pago: b.codpago }));
  ok("Venta con tarjeta: «Total Ventas» sube lo vendido", near(b.delta?.ventas, b.total), JSON.stringify(b.delta));
  ok("Venta con tarjeta: NO sube el efectivo ni el esperado de caja", near(b.delta?.efectivo, 0) && near(b.delta?.esperado, 0), JSON.stringify(b.delta));
  ok("Venta con tarjeta: los acumulados en vivo coinciden con los reales", b.vivoIgualReal === true, JSON.stringify(b.vivo));
  const ra = out.devA || {}, rb = out.devB || {};
  ok("La devolución parcial se crea (rectificativa de serie R ligada a la factura original)", ra.creada === true && ra.serie === "R" && Number(ra.idfacturarect) === Number(a.idfactura), JSON.stringify({ serie: ra.serie, rect: ra.idfacturarect, orig: a.idfactura }));
  ok("Devolución parcial: devuelve la mitad de lo vendido (1 de 2 unidades)", near(Math.abs(ra.total), a.total / 2), JSON.stringify({ dev: ra.total, vendido: a.total }));
  ok("Devolución parcial en efectivo: el efectivo devuelto queda anotado en la rectificativa", near(ra.tpv_efectivo, -Math.abs(ra.total)), `tpv_efectivo ${ra.tpv_efectivo}`);
  ok("Devolución parcial: «Cobros Efectivo» baja lo devuelto", near(ra.delta?.efectivo, -Math.abs(ra.total)), JSON.stringify(ra.delta));
  ok("Devolución parcial: «Total Ventas» baja lo devuelto", near(ra.delta?.ventas, -Math.abs(ra.total)), JSON.stringify(ra.delta));
  ok("Devolución parcial: el total esperado de caja baja lo devuelto", near(ra.delta?.esperado, -Math.abs(ra.total)), JSON.stringify(ra.delta));
  ok("Devolución parcial: los acumulados en vivo coinciden con los reales", ra.vivoIgualReal === true, JSON.stringify(ra.vivo));
  ok("El ticket devuelto en parte aparece como «PARCIAL» en Tickets", /PARCIAL/i.test(String(ra.badge || "")), ra.badge);
  ok("Tras devolver 1 de 2, solo queda 1 unidad por devolver", ra.pendiente === 1, `pendiente ${ra.pendiente}`);
  ok("La devolución total se crea (rectificativa de serie R ligada a su original)", rb.creada === true && rb.serie === "R" && Number(rb.idfacturarect) === Number(b.idfactura), JSON.stringify({ serie: rb.serie, rect: rb.idfacturarect, orig: b.idfactura }));
  ok("Devolución total con tarjeta: devuelve todo lo vendido", near(Math.abs(rb.total), b.total), JSON.stringify({ dev: rb.total, vendido: b.total }));
  ok("Devolución con tarjeta: no se anota efectivo devuelto", near(rb.tpv_efectivo, 0), `tpv_efectivo ${rb.tpv_efectivo}`);
  ok("Devolución con tarjeta: «Total Ventas» baja lo devuelto", near(rb.delta?.ventas, -Math.abs(rb.total)), JSON.stringify(rb.delta));
  ok("Devolución con tarjeta: NO baja el efectivo ni el esperado de caja", near(rb.delta?.efectivo, 0) && near(rb.delta?.esperado, 0), JSON.stringify(rb.delta));
  ok("Devolución con tarjeta: los acumulados en vivo coinciden con los reales", rb.vivoIgualReal === true, JSON.stringify(rb.vivo));
  ok("El ticket devuelto entero aparece como «DEVUELTO» y ya no ofrece devolver", /DEVUELTO/i.test(String(rb.badge || "")) && rb.botonDevolver === false, JSON.stringify({ badge: rb.badge, boton: rb.botonDevolver }));
  ok("Cada devolución cuenta como un ticket más (4 tickets en total: 2 ventas + 2 devoluciones)", out.tickets?.delta === 4, JSON.stringify(out.tickets));
  const f = out.final || {};
  ok("Al final, efectivo y esperado = base + venta efectivo - devolución efectivo", near(f.efectivoNeto, (a.total || 0) - Math.abs(ra.total || 0)) && near(f.esperadoNeto, (a.total || 0) - Math.abs(ra.total || 0)), JSON.stringify(f));
  ok("El cuadro de «Cerrar caja» muestra el mismo total esperado que el cálculo real", f.dialogoIgualCalculo === true, JSON.stringify(f.dialogo));
  const st = Array.isArray(out.stock) ? out.stock : [];
  st.forEach((s) => ok(`El stock de «${s.nombre}» cuadra (vendido ${s.vendido}, devuelto ${s.devuelto})`, s.DESCUADRE === 0, `descuadre ${s.DESCUADRE}`));
  if (!st.length) ok("Se pudo leer el stock final", false);
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 420000);
  const out = {};
  let A; const prods = [];
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    await sleep(8000);
    out.estado = await A.win.evaluate(async () => {
      await setMesasInlineModeEnabled(false, { persist: false });
      window.ensurePrinterSelectedForPrint = async () => ""; window.openDrawerNow = async () => true;
      const real = window.buildFsLinesFromCart;
      window.buildFsLinesFromCart = (c) => real(c).map((l) => ({ ...l, descripcion: String(l.descripcion || "") + " [PRUEBA CAJA]" }));
      window.__dismiss = () => { const ov = document.getElementById("msgOverlay"); if (ov && !ov.classList.contains("hidden")) { Array.from(ov.querySelectorAll("button")).pop()?.click(); } };
      cart = []; setCurrentParkedTicketIndex(null); renderCart();
      document.querySelectorAll(".simple-overlay:not(.hidden)").forEach((o) => o.classList.add("hidden")); document.body.classList.remove("modal-locked");
      return { login: hasActiveLoginSession(), cajaAbierta: !!cashSession?.open, caja: getCajaIdSafe() };
    });
    if (!out.estado.login || !out.estado.cajaAbierta) throw new Error("Falta sesion iniciada o caja abierta (no se escribe PIN): " + JSON.stringify(out.estado));

    // Productos con stock gestionado (como en la prueba de dividir)
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
    prods.push(...pick);
    const readStock = (id) => A.win.evaluate(async (id) => {
      const rows = await fetchStockRowsByProductReference(findProductByBaseId(id));
      const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
      return Number(row?.cantidad);
    }, id);

    // Foto de los totales REALES de la caja (los que usa el cierre) y de los acumulados en vivo del TPV
    const snap = () => A.win.evaluate(async () => {
      const vivo = { efectivo: Number(cashSession.cashSalesTotal || 0), ventas: Number(cashSession.totalSales || 0), movimientos: Number(cashSession.cashMovementsTotal || 0), tickets: Number(cashSession.numtickets || 0) };
      const e = await runCashCloseSummaryComputation({ applyToUI: false });
      const s = e?.session || {};
      return { vivo, real: { efectivo: Number(s.cashSalesTotal || 0), ventas: Number(s.totalSales || 0), movimientos: Number(s.cashMovementsTotal || 0), esperado: Number(s.expectedCashFS || 0), tickets: Number(s.numtickets || 0) } };
    });
    const delta = (x, y) => ({ efectivo: +(y.real.efectivo - x.real.efectivo).toFixed(2), ventas: +(y.real.ventas - x.real.ventas).toFixed(2), movimientos: +(y.real.movimientos - x.real.movimientos).toFixed(2), esperado: +(y.real.esperado - x.real.esperado).toFixed(2) });
    const vivoIgualReal = (s) => near(s.vivo.efectivo, s.real.efectivo) && near(s.vivo.ventas, s.real.ventas);
    const idsCaja = () => A.win.evaluate(async () => {
      const f = await fetchApiResourceWithParams("facturaclientes", { "filter[idcaja]": getCajaIdSafe(), limit: 0 });
      return (Array.isArray(f) ? f : []).map((x) => Number(x.idfactura));
    });

    const base = await snap();
    out.base = base;

    // ---- 1) movimientos de caja por la pantalla real
    out.mov = {};
    const moveDialog = async (amount, type) => {
      await A.win.evaluate(() => { document.getElementById("cashMoveBtn")?.click(); });
      await A.win.waitForFunction(() => !document.getElementById("cashMoveOverlay").classList.contains("hidden"), null, { timeout: 8000 });
      await A.win.evaluate(([amount, type]) => {
        document.getElementById("cashMoveAmount").value = String(amount);
        document.getElementById("cashMoveReason").value = "[PRUEBA CAJA]";
        document.querySelector(`input[name="cashMoveType"][value="${type}"]`).checked = true;
        document.getElementById("cashMoveSaveBtn").click();
      }, [amount, type]);
    };
    await moveDialog(0, "in");
    await sleep(500);
    out.mov.avisoCeroTxt = await A.win.evaluate(() => document.getElementById("cashMoveError").textContent);
    out.mov.avisoCero = /mayor que 0/i.test(out.mov.avisoCeroTxt) && !(await A.win.evaluate(() => document.getElementById("cashMoveOverlay").classList.contains("hidden")));
    await A.win.evaluate(() => document.getElementById("cashMoveCancelBtn").click());
    await sleep(500);
    await moveDialog(10, "in");
    await A.win.waitForFunction(() => document.getElementById("cashMoveOverlay").classList.contains("hidden"), null, { timeout: 30000 });
    await sleep(1500);
    const s1 = await snap();
    out.mov.deltaEntrada = delta(base, s1);
    await moveDialog(10, "out");
    await A.win.waitForFunction(() => document.getElementById("cashMoveOverlay").classList.contains("hidden"), null, { timeout: 30000 });
    await sleep(1500);
    const s2 = await snap();
    out.mov.deltaSalida = delta(base, s2);

    // ---- 2) venta A en efectivo
    const cartOf = (id) => A.win.evaluate(async (id) => { cart = [buildCartLine(findProductByBaseId(id), 2)]; renderCart(); }, id);
    const findNewInvoice = async (before) => {
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        const ids = await idsCaja();
        const nuevos = ids.filter((i) => !before.includes(i));
        if (nuevos.length) return nuevos.sort((x, y) => y - x)[0];
        await sleep(1500);
      }
      return null;
    };
    const factura = (id) => A.win.evaluate(async (id) => {
      const f = await fetchApiResourceWithParams("facturaclientes", { "filter[idfactura]": id, limit: 1 });
      const r = Array.isArray(f) ? f[0] : null;
      return r ? { idfactura: Number(r.idfactura), total: Number(r.total), codpago: r.codpago, codserie: r.codserie, idfacturarect: Number(r.idfacturarect || 0), tpv_efectivo: Number(r.tpv_efectivo || 0), numero2: r.numero2 } : null;
    }, id);

    let before = await idsCaja();
    await cartOf(prods[0].id);
    out.ventaA = { };
    const payA = await drivePay(A, "cash");
    out.ventaA.codpago = payA.codpago;
    const idA = await findNewInvoice(before);
    await A.win.evaluate(() => window.__dismiss());
    const fa = idA ? await factura(idA) : null;
    out.ventaA.cobrada = !!fa;
    out.ventaA.idfactura = idA; out.ventaA.total = fa?.total;
    await sleep(2500);
    const s3 = await snap();
    out.ventaA.delta = delta(s2, s3); out.ventaA.vivo = s3.vivo; out.ventaA.vivoIgualReal = vivoIgualReal({ vivo: s3.vivo, real: s3.real });
    // el "vivo" se compara ANTES de que snap() recalcule (snap lee vivo primero); si el vivo estaba mal, se vera aqui

    // ---- 3) venta B con tarjeta
    before = await idsCaja();
    await cartOf(prods[1].id);
    out.ventaB = {};
    const payB = await drivePay(A, "card");
    out.ventaB.codpago = payB.codpago;
    const idB = await findNewInvoice(before);
    await A.win.evaluate(() => window.__dismiss());
    const fb = idB ? await factura(idB) : null;
    out.ventaB.cobrada = !!fb;
    out.ventaB.idfactura = idB; out.ventaB.total = fb?.total;
    await sleep(2500);
    const s4 = await snap();
    out.ventaB.delta = delta(s3, s4); out.ventaB.vivo = s4.vivo; out.ventaB.vivoIgualReal = vivoIgualReal({ vivo: s4.vivo, real: s4.real });
    if (!out.ventaA.cobrada || !out.ventaB.cobrada) throw new Error("Las ventas de prueba no se cobraron: " + JSON.stringify({ payA, payB }));

    // ---- 4/5) devoluciones por la pantalla de Tickets
    const openTickets = async () => {
      await A.win.evaluate(() => openTicketsModal());
      await A.win.waitForFunction(() => document.querySelectorAll("#ticketsList .ticket-row").length > 0, null, { timeout: 60000 });
      await sleep(800);
    };
    const rowInfo = (idf) => A.win.evaluate((idf) => {
      const row = Array.from(document.querySelectorAll("#ticketsList .ticket-row")).find((r) => new RegExp(`ID ${idf}\\b`).test(r.textContent));
      if (!row) return null;
      return { badge: row.querySelector(".ticket-badge")?.textContent || "", botonDevolver: !!row.querySelector(".ticket-refund") };
    }, idf);
    const closeTickets = () => A.win.evaluate(() => { closeTicketsModal(); document.querySelector("#refundOverlay")?.classList.add("hidden"); });
    const doRefund = async (idf, qtyPerLine) => {
      await A.win.evaluate((idf) => {
        const row = Array.from(document.querySelectorAll("#ticketsList .ticket-row")).find((r) => new RegExp(`ID ${idf}\\b`).test(r.textContent));
        row.querySelector(".ticket-refund").click();
      }, idf);
      await A.win.waitForFunction(() => { const o = document.getElementById("msgOverlay"); return o && !o.classList.contains("hidden"); }, null, { timeout: 8000 });
      await A.win.evaluate(() => document.getElementById("msgOkBtn").click()); // "Al confirmar la devolucion se comunicara a gerencia"
      await A.win.waitForFunction(() => !document.getElementById("refundOverlay").classList.contains("hidden") && document.querySelectorAll("#refundLines button[data-a]").length > 0, null, { timeout: 30000 });
      const pendiente = await A.win.evaluate(() => refundState.lineas.map((l) => Number(l.__pendingQty != null ? l.__pendingQty : l.cantidad)).reduce((a, b) => a + b, 0));
      for (let k = 0; k < qtyPerLine; k++) await A.win.evaluate(() => document.querySelector('#refundLines button[data-a="plus"]').click());
      await sleep(300);
      await A.win.evaluate(() => document.getElementById("refundConfirmBtn").click());
      await A.win.waitForFunction(() => document.getElementById("refundOverlay").classList.contains("hidden"), null, { timeout: 90000 });
      return pendiente;
    };
    const rectOf = async (idOrig) => {
      const t0 = Date.now();
      while (Date.now() - t0 < 45000) {
        const r = await A.win.evaluate(async (idOrig) => {
          const f = await fetchApiResourceWithParams("facturaclientes", { "filter[idfacturarect]": idOrig, limit: 0 });
          const l = (Array.isArray(f) ? f : []).sort((a, b) => Number(b.idfactura) - Number(a.idfactura));
          const x = l[0];
          return x ? { idfactura: Number(x.idfactura), total: Number(x.total), codserie: x.codserie, idfacturarect: Number(x.idfacturarect || 0), tpv_efectivo: Number(x.tpv_efectivo || 0), numero2: x.numero2 } : null;
        }, idOrig);
        if (r && r.codserie === "R" && r.tpv_efectivo !== undefined && r.total !== 0) return r;
        await sleep(1500);
      }
      return null;
    };

    out.devA = {};
    await openTickets();
    const pendA0 = await doRefund(idA, 1);
    out.devA.pendienteAntes = pendA0;
    await sleep(3000);
    const ra = await rectOf(idA);
    out.devA.creada = !!ra;
    if (ra) { out.devA.total = ra.total; out.devA.serie = ra.codserie; out.devA.idfacturarect = ra.idfacturarect; out.devA.tpv_efectivo = ra.tpv_efectivo; out.devA.numero2 = ra.numero2; }
    await sleep(2000);
    const s5 = await snap();
    out.devA.delta = delta(s4, s5); out.devA.vivo = s5.vivo; out.devA.vivoIgualReal = vivoIgualReal({ vivo: s5.vivo, real: s5.real });
    await A.win.evaluate(() => loadAndRenderTickets()); await sleep(2500);
    out.devA.badge = (await rowInfo(idA))?.badge;
    // 6) la devolucion parcial deja pendiente solo la unidad que falta
    await A.win.evaluate((idf) => {
      const row = Array.from(document.querySelectorAll("#ticketsList .ticket-row")).find((r) => new RegExp(`ID ${idf}\\b`).test(r.textContent));
      row?.querySelector(".ticket-refund")?.click();
    }, idA);
    await A.win.waitForFunction(() => { const o = document.getElementById("msgOverlay"); return o && !o.classList.contains("hidden"); }, null, { timeout: 8000 }).catch(() => {});
    await A.win.evaluate(() => document.getElementById("msgOkBtn")?.click());
    await A.win.waitForFunction(() => !document.getElementById("refundOverlay").classList.contains("hidden") && document.querySelectorAll("#refundLines button[data-a]").length > 0, null, { timeout: 30000 }).catch(() => {});
    out.devA.pendiente = await A.win.evaluate(() => refundState.lineas.map((l) => Number(l.__pendingQty != null ? l.__pendingQty : l.cantidad)).reduce((a, b) => a + b, 0));
    await A.win.evaluate(() => document.getElementById("refundCancelBtn")?.click());
    await sleep(500);

    out.devB = {};
    await doRefund(idB, 2);
    await sleep(3000);
    const rb = await rectOf(idB);
    out.devB.creada = !!rb;
    if (rb) { out.devB.total = rb.total; out.devB.serie = rb.codserie; out.devB.idfacturarect = rb.idfacturarect; out.devB.tpv_efectivo = rb.tpv_efectivo; }
    await sleep(2000);
    const s6 = await snap();
    out.devB.delta = delta(s5, s6); out.devB.vivo = s6.vivo; out.devB.vivoIgualReal = vivoIgualReal({ vivo: s6.vivo, real: s6.real });
    await A.win.evaluate(() => loadAndRenderTickets()); await sleep(2500);
    const infoB = await rowInfo(idB);
    out.devB.badge = infoB?.badge; out.devB.botonDevolver = infoB?.botonDevolver;
    await closeTickets();

    out.tickets = { delta: s6.real.tickets - base.real.tickets, base: base.real.tickets, final: s6.real.tickets };

    // ---- 7) el cuadro de «Cerrar caja» (se abre y se cancela, sin cerrar nada)
    out.final = { efectivoNeto: +(s6.real.efectivo - base.real.efectivo).toFixed(2), esperadoNeto: +(s6.real.esperado - base.real.esperado).toFixed(2) };
    await A.win.evaluate(() => openCashOpenDialog("close"));
    await A.win.waitForFunction(() => !document.getElementById("cashOpenOverlay").classList.contains("hidden"), null, { timeout: 20000 });
    await A.win.waitForFunction(() => { const x = document.getElementById("cashOpenOkBtn"); return x && !/Cargando/i.test(x.textContent); }, null, { timeout: 150000 });
    await sleep(800);
    out.final.dialogo = await A.win.evaluate(() => ({ texto: document.getElementById("sumExpectedCash").textContent, esperado: eurES(Number(cashSession.expectedCashFS || 0)) }));
    out.final.dialogoIgualCalculo = out.final.dialogo.texto.replace(/\s/g, "") === out.final.dialogo.esperado.replace(/\s/g, "");
    await A.win.evaluate(() => document.getElementById("cashOpenCancelBtn").click());
    await sleep(500);

    // ---- 8) stock: P1 vendio 2 devolvio 1; P2 vendio 2 devolvio 2
    out.stock = [];
    for (const p of prods) {
      let prev = null, same = 0;
      for (let i = 0; i < 20 && same < 2; i++) {
        const v = await readStock(p.id);
        same = v === prev ? same + 1 : 0; prev = v;
        if (same < 2) await sleep(3000);
      }
    }
    const neto = [1, 0]; // unidades netas vendidas de cada producto
    for (let i = 0; i < prods.length; i++) {
      const fin = await readStock(prods[i].id);
      out.stock.push({ id: prods[i].id, nombre: prods[i].name, inicial: prods[i].stock, final: fin, vendido: 2, devuelto: i === 0 ? 1 : 2, esperado: prods[i].stock - neto[i], DESCUADRE: Number((fin - (prods[i].stock - neto[i])).toFixed(3)) });
    }
  } catch (e) {
    out.ERROR = String((e && e.message) || e).slice(0, 500);
  } finally {
    try {
      if (A) {
        out.limpieza = await A.win.evaluate(async (prods) => {
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          window.buildFsLinesFromCart = undefined;
          document.querySelectorAll(".simple-overlay:not(.hidden)").forEach((o) => o.classList.add("hidden")); document.body.classList.remove("modal-locked");
          for (const p of prods) {
            const rows = await fetchStockRowsByProductReference(findProductByBaseId(p.id));
            const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
            if (row && Number.isFinite(p.stock)) await updateStockRowCantidad(row, p.stock);
          }
          return "ok";
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

