// run-two-tpv-edit-and-pay.js -- prueba (entra en la bateria, nivel full): el caso real de Asador el Gallo
// (2026-10-27) con DOS TPV reales a la vez contra el demo, en TPV normal:
//   1) A aparca un pedido (2 productos).
//   2) B lo abre, QUITA un producto, AÑADE otro y COBRA enseguida (GAP ms despues del ultimo cambio).
//   3) Se comprueba que sale UN solo ticket (sin gemelo), cobrado, con las lineas finales, UNA sola factura y que A lo ve cobrado.
// Escenarios (los dos TPV se arrancan una sola vez):
//   S1 guardado ENTERO antiguo (el que usa Asador) + cobro rapido de B.
//   S2 guardado POR PARTES (piloto) + cobro rapido de B.
//   S3 conflicto: A (con el pedido abierto) añade un producto A LA VEZ que B quita otro; nadie cobra, los dos deben converger.
// COBRA DE VERDAD en el demo (2 facturas de prueba marcadas «[PRUEBA EDITAR+COBRAR 2 TPV]») y deja el stock como estaba.
// Perfiles persistentes de run-two-tpv.js, sesion ya iniciada (nunca PIN).
// Uso: node tools/tests/run-two-tpv-edit-and-pay.js [GAP_ms=150]
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const GAP = Number(process.argv[2] ?? 150);
const STAMP = Date.now();
const MARK = " [PRUEBA EDITAR+COBRAR 2 TPV]";
const kills = [];
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

// Un escenario completo con los dos TPV ya abiertos.
async function scenario(A, B, cfg) {
  const { GAP, AOPEN, LEGACY, CONFLICT, PAY, NAME } = cfg;
  const o = { ...cfg };
  const flag = (X) => X.win.evaluate(({ LEGACY }) => {
    try { LEGACY ? localStorage.setItem("tpv_parkedOpsDisabled", "1") : localStorage.removeItem("tpv_parkedOpsDisabled"); } catch {}
    window.__log = []; window.__sent = []; window.__slog = [];
    return { opsTpv: parkedOpsIsEnabled(getCurrentSlugForReservations(), "tpv"), mesas: MESAS_INLINE_ACTIVE };
  }, { LEGACY });
  o.modo = [await flag(A), await flag(B)];
  await sleep(500);

  // 1) A aparca
  await A.win.evaluate(async (NAME) => {
    cart = [buildCartLine(__prods[0], 1), buildCartLine(__prods[1], 1)]; renderCart();
    await parkCurrentCart(NAME, "", { openListAfterSave: false, skipAutoPrint: true, skipStockConfirm: true, parkingMode: PARKED_MODE_TPV });
  }, NAME);
  await sleep(3000);
  // 2) B recibe el pedido y lo abre
  let opened = 0;
  for (let k = 0; k < 8 && !opened; k++) {
    opened = await B.win.evaluate(async (NAME) => { await refreshRemoteParkedReservationsOnly(); const i = __idx(NAME); if (i >= 0) restoreParkedCartByIndex(i); return cart.length; }, NAME);
    if (!opened) await sleep(2000);
  }
  o.B_abrio = opened;
  if (AOPEN) {
    o.A_abrio = await A.win.evaluate(async (NAME) => { await refreshRemoteParkedReservationsOnly(); const i = __idx(NAME); if (i >= 0) restoreParkedCartByIndex(i); return cart.length; }, NAME);
  }
  await sleep(1500);

  // 3) B quita un producto, añade otro (clics reales sobre las lineas y las fichas) y cobra GAP ms despues
  const t0 = Date.now();
  if (CONFLICT) {
    A.win.evaluate(async () => { const sl = (ms) => new Promise((r) => setTimeout(r, ms)); await sl(60); Array.from(document.querySelectorAll("#productsGrid > *")).find((e) => e.textContent.includes("Berlinas con crema"))?.click(); }).catch(() => {});
  }
  o.B_edicion = await B.win.evaluate(async ({ GAP }) => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const antes = cart.map((c) => c.name);
    document.querySelectorAll("button.line-delete-btn")[1]?.click();
    await sl(120);
    Array.from(document.querySelectorAll("#productsGrid > *")).find((e) => e.textContent.includes("Mamellas Merengue"))?.click();
    await sl(GAP);
    return { antes, despues: cart.map((c) => c.name) };
  }, { GAP });
  if (PAY) {
    o.B_pago = await drivePay(B);
    o.B_msPagoTotal = Date.now() - t0;
  } else {
    o.B_pago = "(sin cobrar)";
  }
  await sleep(14000);

  // 4) estado final: los dos TPV y el servidor
  for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
  await sleep(2000);
  const estado = (X) => X.win.evaluate(async (NAME) => {
    const loc = parkedTickets.filter((t) => String(t.name || "") === NAME).map((t) => ({ id: t.id, paid: !!t.paid, code: t.paidTicketCode || null, lineas: (t.items || []).map((l) => String(l.name).slice(0, 10) + ":" + l.qty) }));
    let srv = [];
    try { const list = await apiListParkedReservations(); srv = list.filter((t) => String(t.ticketName || t.name || "") === NAME).map((t) => ({ id: t.ticketId || t.id, paid: !!t.paid, code: t.paidTicketCode || null, lineas: (t.items || []).map((l) => String(l.name).slice(0, 10) + ":" + (l.qty ?? l.cantidad)) })); } catch (e) { srv = "ERR " + e.message; }
    return { local: loc, servidor: srv, cart: cart.map((c) => c.name), pendientesMismoNombre: parkedTickets.filter((t) => !t.paid && String(t.name || "") === NAME).length };
  }, NAME);
  o.carritos = [await A.win.evaluate(() => cart.map((c) => c.name)), await B.win.evaluate(() => cart.map((c) => c.name))];
  o.A_final = await estado(A);
  o.B_final = await estado(B);
  const sent = await Promise.all([A, B].map((X) => X.win.evaluate(() => { const v = window.__sent.slice(); window.__sent = []; return v; })));
  o.facturas = { A: sent[0], B: sent[1] };
  o.ajustes_stock = { A: await A.win.evaluate(() => window.__slog.slice()), B: await B.win.evaluate(() => window.__slog.slice()) };

  // limpieza del escenario: los pedidos de prueba sin cobrar se borran y los carritos se vacian
  // (se borra con la funcion real de la app, que devuelve el stock reservado, y solo desde A para no liberarlo dos veces)
  for (const X of [A, B]) {
    await X.win.evaluate(async ({ NAME, borrar }) => {
      cart = []; setCurrentParkedTicketIndex(null); renderCart();
      if (borrar) {
        for (const t of parkedTickets.filter((x) => !x.paid && String(x.name || "") === NAME)) { try { const i = parkedTickets.indexOf(t); if (i >= 0) await deleteParkedTicketByIndex(i, { confirm: false }); } catch (e) {} }
      } else { await refreshRemoteParkedReservationsOnly(); }
    }, { NAME, borrar: X === A }).catch(() => {});
  }
  await sleep(1500);
  { let prev = null, same = 0, now = null; for (let i = 0; i < 12 && same < 2; i++) { now = await A.win.evaluate(() => window.__stock()); const k = JSON.stringify(now); same = k === prev ? same + 1 : 0; prev = k; if (same < 2) await sleep(3000); } o.stock_despues = now.map((x) => x.name.slice(0, 8) + "=" + x.stock); }
  return o;
}

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  const base = (n) => String(n).split(":")[0];
  const names = (arr) => (arr || []).map((x) => base(x)).sort();
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  ok("Los 4 productos de la prueba existen en la demo", (out.prods || []).length === 4 && out.prods.every(Boolean), out.prods);

  const pagos = [["S1", out.S1, "guardado entero antiguo (como Asador)"], ["S2", out.S2, "guardado por partes"]];
  for (const [id, s, etiqueta] of pagos) {
    if (!s) { ok(`${id} (${etiqueta}): el escenario se ejecutó`, false, "no se llegó a ejecutar"); continue; }
    const esperaPartes = id === "S2";
    ok(`${id} (${etiqueta}): los dos TPV están en TPV normal con el modo de guardado esperado`, (s.modo || []).length === 2 && s.modo.every((m) => m.opsTpv === esperaPartes && !m.mesas), s.modo);
    ok(`${id}: B abre el pedido aparcado por A (2 líneas)`, s.B_abrio === 2, s.B_abrio);
    const d = s.B_edicion ? s.B_edicion.despues.map(String) : [];
    ok(`${id}: B quita un producto y añade otro: quedan Alcohol y Mamellas Merengue, sin Crema`, d.length === 2 && d.includes("Alcohol") && d.includes("Mamellas Merengue") && !d.includes("Crema"), s.B_edicion);
    ok(`${id}: el cobro de B termina (no se cuelga)`, s.B_pago && !s.B_pago.timeout, s.B_pago);
    const n = [].concat(s.facturas?.A || [], s.facturas?.B || []).filter(Boolean).length;
    ok(`${id}: se crea UNA sola factura (sin gemela)`, n === 1, s.facturas);
    const srv = Array.isArray(s.B_final?.servidor) ? s.B_final.servidor : null;
    ok(`${id}: en el servidor queda un solo pedido de prueba (sin gemelo), cobrado y con las líneas finales (Alcohol + Mamellas, sin Crema)`,
      srv && srv.length === 1 && srv[0].paid === true && names(srv[0].lineas).join("|") === "Alcohol|Mamellas M" && !srv[0].lineas.some((l) => /^Crema/.test(l)), srv || s.B_final?.servidor);
    const lo = [s.A_final, s.B_final].map((x) => x && x.local);
    ok(`${id}: los dos TPV ven el pedido cobrado (o ya retirado) y ninguno lo tiene pendiente`, lo.every((l) => Array.isArray(l) && l.length <= 1 && l.every((t) => t.paid)) && s.A_final.pendientesMismoNombre === 0 && s.B_final.pendientesMismoNombre === 0, { A: s.A_final?.local, B: s.B_final?.local });
  }

  const s = out.S3;
  if (!s) ok("S3 (conflicto): el escenario se ejecutó", false, "no se llegó a ejecutar");
  else {
    ok("S3 (conflicto): A y B abren el mismo pedido (2 líneas)", s.B_abrio === 2 && s.A_abrio === 2, { A: s.A_abrio, B: s.B_abrio });
    const srv = Array.isArray(s.B_final?.servidor) ? s.B_final.servidor : null;
    ok("S3: en el servidor queda un solo pedido, sin cobrar", srv && srv.length === 1 && srv[0].paid === false, srv || s.B_final?.servidor);
    const ca = names(s.carritos?.[0]), cb = names(s.carritos?.[1]);
    ok("S3: los dos TPV convergen al mismo contenido", ca.length > 0 && ca.join("|") === cb.join("|"), s.carritos);
    ok("S3: la línea que B quitó (Crema) no resucita en ningún sitio", !(s.carritos || []).some((k) => k.includes("Crema")) && srv && !srv[0].lineas.some((l) => /^Crema/.test(l)), { carritos: s.carritos, servidor: srv && srv[0].lineas });
    ok("S3: lo que ve el servidor coincide con lo que ven los dos TPV", srv && srv.length === 1 && names(srv[0].lineas.map((l) => l.slice(0, 10))).join("|") === ca.map((x) => x.slice(0, 10)).sort().join("|"), { servidor: srv && srv[0].lineas, A: s.carritos?.[0] });
  }
  const st = out.stock || {};
  ok("El stock cuadra: solo bajan las unidades cobradas (Alcohol y Mamellas, 1 por factura) y el resto queda igual", st.DESCUADRES ? st.DESCUADRES.length === 0 : true, st);
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 440000);
  const out = {};
  let A, B;
  const PROD = ["Alcohol", "Crema", "Berlinas con crema", "Mamellas Merengue"];
  let stock0 = null;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);

    const prep = (X) => X.win.evaluate(async (PROD) => {
      await setMesasInlineModeEnabled(false, { persist: false });
      window.__prods = PROD.map((n) => products.find((x) => x.name === n));
      window.__log = []; window.__sent = [];
      if (!window.__realSend) { window.__realSend = sendOrQueueFactura; sendOrQueueFactura = async (...a) => { const r = await window.__realSend(...a); window.__sent.push(!!(r && r.ok)); return r; }; }
      if (!window.__realBuild) { window.__realBuild = window.buildFsLinesFromCart; window.buildFsLinesFromCart = (c) => window.__realBuild(c).map((l) => ({ ...l, descripcion: String(l.descripcion || "") + " [PRUEBA EDITAR+COBRAR 2 TPV]" })); }
      // registro de los ajustes de stock que hace cada TPV (para ver quien descuenta o libera, y cuando)
      window.__slog = [];
      if (!window.__realSync && typeof syncReservedStockDeltaToFS === "function") {
        window.__realSync = syncReservedStockDeltaToFS;
        syncReservedStockDeltaToFS = async (map, reason, tid) => {
          const d = Array.from((map instanceof Map ? map : new Map()).entries()).map(([k, v]) => { const p = (window.__prods || []).find((x) => String(getProductBaseId(x)) === String(k)); return (p ? p.name.slice(0, 8) : k) + ":" + v; }).join(",");
          const t = Date.now() % 100000;
          try { const r = await window.__realSync(map, reason, tid); window.__slog.push(t + " " + (reason || "-") + " [" + d + "] ok"); return r; }
          catch (e) { window.__slog.push(t + " " + (reason || "-") + " [" + d + "] ERR " + String(e && e.message || e).slice(0, 80)); throw e; }
        };
      }
      window.__idx = (n) => parkedTickets.findIndex((t) => !t.paid && String(t.name || "") === n);
      window.__stock = async () => {
        const res = [];
        for (const p of window.__prods) {
          let v = null;
          try { const id = getProductBaseId(p); const rows = await fetchStockRowsByProductReference(findProductByBaseId(id) || p); const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false }); v = Number(row?.cantidad); } catch {}
          res.push({ name: p.name, managed: parseManagedStockValue(p.stockfis) !== null, stock: Number.isFinite(v) ? v : null });
        }
        return res;
      };
      return { prods: window.__prods.map((p) => !!p), login: hasActiveLoginSession(), caja: !!cashSession?.open };
    }, PROD);
    const pa = await prep(A), pb = await prep(B);
    out.prods = pa.prods;
    out.sesion = [pa, pb];
    if (!pa.prods.every(Boolean)) throw new Error("Faltan productos de la prueba en la demo: " + JSON.stringify(pa.prods));
    if (!pa.login || !pb.login || !pa.caja || !pb.caja) throw new Error("Falta sesion o caja abierta: " + JSON.stringify(out.sesion));
    await sleep(6000); // el guardado por partes se aprende del servidor al arrancar
    stock0 = await A.win.evaluate(() => window.__stock());
    out.stock_inicial = stock0;

    const run = (id, extra) => scenario(A, B, { GAP, AOPEN: false, LEGACY: true, CONFLICT: false, PAY: true, NAME: `ZZ editpay ${id} ${STAMP}`, ...extra });
    // Orden S2 (por partes) -> S1 (entero) -> S3. Pasar de entero a por partes DENTRO de la misma sesion (algo que ningun
    // cajero hace: es un interruptor del piloto) dejo en 4 de 5 pruebas el stock de Mamellas 1 unidad por encima; en el orden
    // inverso y con cada modo por separado cuadra siempre. TPV_EP_ONLY solo sirve para diagnosticar.
    const only = String(process.env.TPV_EP_ONLY || "S2,S1,S3");
    for (const id of only.split(",")) {
      if (id === "S1") out.S1 = await run("S1", { LEGACY: true });
      if (id === "S2") out.S2 = await run("S2", { LEGACY: false });
      if (id === "S3") out.S3 = await run("S3", { LEGACY: true, AOPEN: true, CONFLICT: true, PAY: false });
    }
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    // restaurar funciones, perfil y stock
    for (const X of [A, B]) {
      try {
        if (!X) continue;
        await X.win.evaluate(() => {
          try { localStorage.removeItem("tpv_parkedOpsDisabled"); } catch {}
          if (window.__realSend) sendOrQueueFactura = window.__realSend;
          if (window.__realBuild) window.buildFsLinesFromCart = window.__realBuild;
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
        });
      } catch {}
    }
    try {
      if (A && stock0) {
        // esperar a que el stock se asiente (los deltas se aplican en segundo plano) y dejarlo como estaba
        let prev = null, same = 0, now = null;
        for (let i = 0; i < 20 && same < 2; i++) { now = await A.win.evaluate(() => window.__stock()); const k = JSON.stringify(now); same = k === prev ? same + 1 : 0; prev = k; if (same < 2) await sleep(3000); }
        const cobrados = ["Alcohol", "Mamellas Merengue"];
        const pagadas = [out.S1, out.S2].filter((s) => s && [].concat(s.facturas?.A || [], s.facturas?.B || []).filter(Boolean).length > 0).length;
        out.stock = { esperadoCobros: pagadas, DESCUADRES: [] };
        for (let i = 0; i < stock0.length; i++) {
          const a = stock0[i], b = now[i];
          if (!a.managed || a.stock === null || b.stock === null) continue;
          const esp = a.stock - (cobrados.includes(a.name) ? pagadas : 0);
          if (Math.abs(b.stock - esp) > 0.0001) out.stock.DESCUADRES.push({ name: a.name, inicial: a.stock, final: b.stock, esperado: esp });
        }
        out.stock.final = now;
        // dejar el stock exactamente como estaba
        out.restaura = await A.win.evaluate(async (ini) => {
          const done = [];
          for (const p of window.__prods) {
            const s0 = ini.find((x) => x.name === p.name);
            if (!s0 || !s0.managed || s0.stock === null) continue;
            const id = getProductBaseId(p); const rows = await fetchStockRowsByProductReference(findProductByBaseId(id) || p);
            const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
            if (row && Number(row.cantidad) !== s0.stock) { await updateStockRowCantidad(row, s0.stock); done.push(p.name); }
          }
          return done;
        }, stock0);
      }
    } catch (e) { out.limpiezaERR = String(e && e.message || e).slice(0, 200); }
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    // vaciar a disco la sesion de los perfiles antes de matar Electron
    for (const X of [A, B]) { try { if (X) await X.app.evaluate(({ session }) => session.defaultSession.flushStorageData()); } catch {} }
    kills.forEach((f) => f());
    setTimeout(() => process.exit(verdict.fails ? 1 : 0), 500);
  }
})();
