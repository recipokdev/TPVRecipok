// run-caja-open-close.js -- prueba (bateria, nivel full) de CERRAR y ABRIR la caja de verdad contra la demo.
//
// OJO: CIERRA la caja compartida de la demo y abre una nueva (queda una caja cerrada mas en FacturaScripts demo, que no se
// puede borrar). Por eso va la ULTIMA de la bateria y no debe lanzarse mientras alguien mas prueba en la demo. Si algo falla
// a medias, el bloque final vuelve a abrir la caja con 100 EUR para dejar la demo como la encontraron (abierta).
// Perfiles persistentes de run-two-tpv.js, sesion ya iniciada (nunca se escribe PIN). La impresora nunca se usa: la impresion
// del cierre se captura (se sustituye printCashCloseReport) y asi se comprueba lo que saldria en el papel.
//
// Recorrido:
//   0) se comprueba que hay sesion, caja abierta y ningun pedido aparcado (con aparcados el TPV no deja cerrar: no se toca nada);
//   1) foto de los totales reales de la caja (ventas, efectivo, movimientos, esperado, tickets);
//   2) CERRAR por la pantalla real: contar 70 EUR (50+20), pulsar «Cerrar caja» y confirmar;
//   3) lo que saldria impreso coincide con la foto (totales, esperado, contado 70, diferencia = contado - esperado);
//   4) en FacturaScripts la caja queda cerrada, con fecha de fin y con el dinero contado; el TPV queda sin caja, sin carrito;
//   5) ABRIR por la pantalla real con 100 EUR (2 x 50): caja nueva (otro id), abierta, con 100 de apertura y todo a cero;
//   6) un segundo TPV (perfil 2) arranca y se engancha a la caja nueva (caja compartida).
// Uso: node tools/tests/run-caja-open-close.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kills = [];
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.006;

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

// Cuenta billetes en el cuadro de caja abierto: { "50": 1, "20": 1 }
const contar = (X, mapa) => X.win.evaluate((m) => {
  document.querySelectorAll("#cashOpenOverlay .cash-hidden-input").forEach((i) => { i.value = "0"; });
  for (const [d, q] of Object.entries(m)) {
    const i = document.querySelector(`#cashOpenOverlay input[data-denom="${d}"]`);
    if (i) { i.value = String(q); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); }
  }
  updateCashOpenTotal();
  return { total: Number(cashSession.closingTotal ?? 0), apertura: Number(cashSession.openingTotal ?? 0), modo: cashDialogMode };
}, mapa);

async function abrirDialogo(X, modo) {
  await X.win.evaluate((m) => openCashOpenDialog(m), modo);
  await X.win.waitForFunction(() => !document.getElementById("cashOpenOverlay").classList.contains("hidden"), null, { timeout: 20000 });
  await X.win.waitForFunction(() => { const x = document.getElementById("cashOpenOkBtn"); return x && !/Cargando/i.test(x.textContent); }, null, { timeout: 150000 });
  await sleep(600);
}

async function cerrarCaja(X, out) {
  await abrirDialogo(X, "close");
  out.dialogoCierre = await X.win.evaluate(() => ({ titulo: document.getElementById("cashDialogTitle")?.textContent, boton: document.getElementById("cashOpenOkBtn")?.textContent, esperado: document.getElementById("sumExpectedCash")?.textContent }));
  out.contado = await contar(X, { 50: 1, 20: 1 });
  await sleep(300);
  out.dialogoCierre.contado = await X.win.evaluate(() => document.getElementById("cashOpenTotal")?.textContent);
  await X.win.evaluate(() => document.getElementById("cashOpenOkBtn").click());
  // confirmacion «¿Seguro que quieres cerrar la caja?»
  await X.win.waitForFunction(() => !document.getElementById("cashCloseConfirmOverlay").classList.contains("hidden") || document.querySelector("#msgOverlay:not(.hidden), .confirm-overlay:not(.hidden)"), null, { timeout: 20000 });
  out.confirmacion = await X.win.evaluate(() => ({ cierre: !document.getElementById("cashCloseConfirmOverlay").classList.contains("hidden"), texto: (document.getElementById("cashCloseConfirmText")?.textContent || "").slice(0, 120), otro: (document.querySelector("#msgOverlay:not(.hidden) #msgText")?.textContent || "").slice(0, 160) }));
  if (!out.confirmacion.cierre) throw new Error("El TPV no dejo cerrar la caja: " + out.confirmacion.otro);
  await X.win.evaluate(() => document.getElementById("cashCloseConfirmOkBtn").click());
  await X.win.waitForFunction(() => cashSession.open === false, null, { timeout: 90000 });
  await sleep(1500);
}

async function abrirCaja(X, out, clave) {
  await abrirDialogo(X, "open");
  const c = await contar(X, { 50: 2 });
  out[clave] = { contadoApertura: c };
  await X.win.evaluate(() => document.getElementById("cashOpenOkBtn").click());
  await X.win.waitForFunction(() => cashSession.open === true && !!getCajaIdSafe(), null, { timeout: 90000 });
  await sleep(2500);
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 600000);
  const out = {};
  let A = null, B = null, cerrada = false, reabierta = false;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    await sleep(8000);
    out.antes = await A.win.evaluate(async () => ({ open: !!cashSession?.open, caja: getCajaIdSafe(), login: hasActiveLoginSession(), aparcados: getPendingParkedTicketsGlobal(parkedTickets).length, agente: currentAgent?.name || null }));
    if (!out.antes.open || !out.antes.login) throw new Error("Hace falta sesion y caja abierta en el perfil 1: " + JSON.stringify(out.antes));
    if (out.antes.aparcados > 0) throw new Error(`Hay ${out.antes.aparcados} pedido(s) aparcado(s): el TPV no deja cerrar la caja asi; no se ha tocado nada`);

    // la impresion del cierre se captura (no se imprime nada)
    await A.win.evaluate(() => { window.__informes = []; window.__realPrintClose = printCashCloseReport; printCashCloseReport = async (rep) => { window.__informes.push(JSON.parse(JSON.stringify(rep))); }; });
    // 1) foto de los totales reales
    out.foto = await A.win.evaluate(async () => {
      const e = await runCashCloseSummaryComputation({ applyToUI: false });
      const s = e?.session || {};
      const c = await apiReadCajaById(getCajaIdSafe());
      // esperado = apertura (la de FacturaScripts: este calculo sin pantalla no carga la apertura tras un reinicio) + efectivo + movimientos + encargos
      const apertura = Number(c?.dineroini ?? 0);
      const esperado = Math.round((apertura + Number(s.cashSalesTotal || 0) + Number(s.cashMovementsTotal || 0) + Number(getEncargosCashNet() || 0)) * 100) / 100;
      return { idcaja: getCajaIdSafe(), ventas: Number(s.totalSales || 0), efectivo: Number(s.cashSalesTotal || 0), movimientos: Number(s.cashMovementsTotal || 0), esperado, tickets: Number(s.numtickets || 0), apertura, remotaAbierta: isCajaOpen(c) };
    });

    // 2) cerrar por la pantalla real
    await cerrarCaja(A, out);
    cerrada = true;
    out.informe = await A.win.evaluate(() => (window.__informes || [])[0] || null);

    // 4) estado tras cerrar: FacturaScripts y TPV
    out.tras_cierre = await A.win.evaluate(async (id) => {
      const c = await apiReadCajaById(id);
      return { fs: c ? { abierta: isCajaOpen(c), fechafin: c.fechafin || null, dinerofin: Number(c.dinerofin ?? NaN), diferencia: Number(c.diferencia ?? NaN), numtickets: Number(c.numtickets ?? NaN) } : null, tpv: { abierta: !!cashSession.open, remoto: localStorage.getItem("tpv_remoteCajaId"), carrito: cart.length, boton: (document.getElementById("cashHeaderBtn")?.textContent || "").trim().slice(0, 40), agente: currentAgent?.name || null, cajaId: getCajaIdSafe() } };
    }, out.foto.idcaja);

    // 5) abrir por la pantalla real
    await abrirCaja(A, out, "apertura");
    reabierta = true;
    out.tras_apertura = await A.win.evaluate(async () => {
      const id = getCajaIdSafe();
      const c = await apiReadCajaById(id);
      return { idcaja: id, tpv: { abierta: !!cashSession.open, apertura: Number(cashSession.openingTotal || 0), ventas: Number(cashSession.totalSales || 0), tickets: Number(cashSession.numtickets || 0), agente: currentAgent?.name || null, productos: document.querySelectorAll("#productsGrid > *").length }, fs: c ? { abierta: isCajaOpen(c), dineroini: Number(c.dineroini ?? NaN), numtickets: Number(c.numtickets ?? NaN), fechafin: c.fechafin || null } : null };
    });

    // 6) un segundo TPV se engancha a la caja nueva
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(9000);
    out.segundo_tpv = await B.win.evaluate(() => ({ abierta: !!cashSession?.open, caja: getCajaIdSafe(), login: hasActiveLoginSession() }));
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 400);
  } finally {
    // red de seguridad: la demo debe quedar con la caja abierta
    try {
      if (A && cerrada && !reabierta) {
        const abierta = await A.win.evaluate(() => !!cashSession?.open);
        if (!abierta) { await abrirCaja(A, out, "apertura_de_rescate"); out.rescate = true; }
      }
    } catch (e) { out.rescateERR = String(e && e.message || e).slice(0, 200); }
    for (const X of [A, B]) { try { if (X) await X.win.evaluate(() => { if (window.__realPrintClose) printCashCloseReport = window.__realPrintClose; }); } catch {} }
    for (const X of [A, B]) { try { if (X) await X.app.evaluate(({ session }) => session.defaultSession.flushStorageData()); } catch {} }
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kills.forEach((f) => f());
    setTimeout(() => process.exit(verdict.fails ? 1 : 0), 500);
  }
})();

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  ok("La demo se queda con la caja ABIERTA al terminar (si se cerró, se reabrió)", !!(out.tras_apertura && out.tras_apertura.tpv && out.tras_apertura.tpv.abierta) && !out.rescateERR, { apertura: out.tras_apertura && out.tras_apertura.tpv, rescate: out.rescate, err: out.rescateERR });
  const f = out.foto, inf = out.informe, tc = out.tras_cierre;
  if (!f) return c;
  ok("Cerrar: el cuadro de cierre se abre como «Cierre de caja» con el botón «Cerrar caja»", out.dialogoCierre && /Cierre de caja/i.test(out.dialogoCierre.titulo || "") && /Cerrar caja/i.test(out.dialogoCierre.boton || ""), out.dialogoCierre);
  ok("Cerrar: contar 50 + 20 da 70,00 € de dinero contado", out.contado && near(out.contado.total, 70) && out.contado.modo === "close", out.contado);
  ok("Cerrar: pide confirmación («¿Seguro que quieres cerrar la caja?») y al aceptar el TPV queda sin caja abierta", out.confirmacion && out.confirmacion.cierre && /cerrar la caja/i.test(out.confirmacion.texto || "") && tc && tc.tpv && tc.tpv.abierta === false, { confirmacion: out.confirmacion, tpv: tc && tc.tpv });
  ok("Cerrar: se manda a imprimir UN informe de cierre de la caja que se cerraba", !!inf && String(inf.cajaId) === String(f.idcaja), { cajaId: inf && inf.cajaId, esperada: f.idcaja });
  ok("Informe de cierre: total vendido, tickets, movimientos y efectivo esperado coinciden con los totales reales de antes de cerrar",
    !!inf && near(inf.totalVendido, f.ventas) && Number(inf.numTickets) === f.tickets && near(inf.movements ?? 0, f.movimientos) && near(inf.expectedCash, f.esperado),
    inf && { vendido: [inf.totalVendido, f.ventas], tickets: [inf.numTickets, f.tickets], movimientos: [inf.movements, f.movimientos], esperado: [inf.expectedCash, f.esperado] });
  ok("Informe de cierre: efectivo contado 70,00 y diferencia = contado - esperado", !!inf && near(inf.countedCash, 70) && near(inf.difference, 70 - f.esperado), inf && { contado: inf.countedCash, diferencia: inf.difference, esperado: f.esperado });
  ok("FacturaScripts: la caja cerrada queda cerrada, con fecha de fin y con el dinero contado (70,00)", !!(tc && tc.fs) && tc.fs.abierta === false && !!tc.fs.fechafin && near(tc.fs.dinerofin, 70), tc && tc.fs);
  ok("Tras cerrar: el TPV olvida la caja (sin id remoto), vacía el carrito y el botón vuelve a «Abrir caja»", !!tc && !tc.tpv.remoto && tc.tpv.carrito === 0 && /abrir/i.test(tc.tpv.boton || ""), tc && tc.tpv);
  const ta = out.tras_apertura;
  ok("Abrir: contar 2 x 50 da 100,00 € de apertura", out.apertura && out.apertura.contadoApertura && near(out.apertura.contadoApertura.total ?? out.apertura.contadoApertura.apertura, 100) || (ta && ta.tpv && near(ta.tpv.apertura, 100)), out.apertura);
  ok("Abrir: sale una caja NUEVA (otro id), abierta en el TPV y en FacturaScripts, con 100,00 € de apertura y todo a cero", !!ta && ta.idcaja && String(ta.idcaja) !== String(f.idcaja) && ta.tpv.abierta && !!ta.fs && ta.fs.abierta === true && near(ta.fs.dineroini, 100) && ta.tpv.tickets === 0 && near(ta.tpv.ventas, 0), ta);
  ok("Abrir: el TPV vuelve a mostrar los productos y una caja nueva sin fecha de fin", !!ta && ta.tpv.productos > 0 && !ta.fs.fechafin, ta && { productos: ta.tpv.productos, fechafin: ta.fs && ta.fs.fechafin });
  ok("Caja compartida: un segundo TPV que arranca después se engancha a la caja nueva (abierta y mismo id)", !!out.segundo_tpv && out.segundo_tpv.abierta === true && !!ta && String(out.segundo_tpv.caja) === String(ta.idcaja), out.segundo_tpv);
  return c;
}
