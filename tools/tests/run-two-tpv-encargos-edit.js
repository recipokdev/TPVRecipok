// run-two-tpv-encargos-edit.js -- prueba MANUAL (no entra en npm test) de EDITAR ENCARGOS con DOS TPV reales contra la demo.
// Perfiles persistentes de run-two-tpv.js (sesion ya iniciada, nunca PIN). Crea encargos y pedidos REALES en demo:
// los encargos se llaman "TEST2TPV editar ..." para poder limpiarlos (cleanup_encargos.php + borrar sus pedidos de FS).
// Comprueba: (E1) otro terminal cambia el encargo mientras editas -> 412, nada se guarda y el pedido nuevo se cancela;
// (E2) un terminal guarda una edicion y el otro (con el detalle abierto) la ve sola; (E3) otro terminal esta recogiendo
// (candado) -> 423 al guardar, y al soltar se puede guardar; (E4) los dos editan a la vez: guarda uno y el otro recibe 412.
// Uso: node tools/tests/run-two-tpv-encargos-edit.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kills = [];
const log = (...a) => console.log(new Date().toISOString().slice(14, 23), ...a);
const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "[OK]  " : "[FAIL]"} ${name}${extra ? " -> " + extra : ""}`); };

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
  if (!win) throw new Error("sin ventana " + label);
  await win.waitForFunction(() => typeof currentTerminal !== "undefined" && !!currentTerminal && !!window.TPV_ENCARGOS, null, { timeout: 60000 }).catch(() => {});
  return { app, win, label };
}


(async () => {
  const hard = setTimeout(() => { console.error("HARD TIMEOUT"); kills.forEach((k) => k()); process.exit(1); }, 900000);
  let A, B;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "TPV 1");
    B = await launch("tpvrecipok-2tpv-real-2", "TPV 2");
    const a = A.win, b = B.win;
    const setup = (w) => w.evaluate(async () => {
      window.ensurePrinterSelectedForPrint = async () => ""; window.openDrawerNow = async () => true;
      const real = window.buildFsLinesFromCart;
      window.buildFsLinesFromCart = (c) => real(c).map((l) => ({ ...l, descripcion: String(l.descripcion || "") + " [PRUEBA ENCARGOS]" }));
      await window.TPV_CFG.set("ui.encargosEnabled", true); await window.TPV_CFG.set("ui.encargosNoveltySeen", true);
      await window.TPV_CFG.set("ui.encargosTodayPromptKey", "x"); await window.TPV_CFG.set("ui.encargosEditing", "");
      await window.TPV_ENCARGOS.loadEnabled();
      // una ejecucion anterior cortada puede haber dejado una edicion a medias (se recupera sola al arrancar)
      if (window.TPV_ENCARGOS.isEditing()) {
        document.getElementById("encEditDiscardBtn").click(); await new Promise((r) => setTimeout(r, 800));
        document.getElementById("msgOkBtn").click(); await new Promise((r) => setTimeout(r, 800));
      }
      // los encargos se editan en el TPV normal: el perfil de pruebas puede haber quedado en Modo Mesas
      if (typeof MESAS_INLINE_ACTIVE !== "undefined" && MESAS_INLINE_ACTIVE) { await setMesasInlineModeEnabled(false); await new Promise((r) => setTimeout(r, 1500)); }
      cart = []; setCurrentParkedTicketIndex(null); renderCart();
      document.querySelectorAll(".simple-overlay:not(.hidden)").forEach((o) => o.classList.add("hidden")); document.body.classList.remove("modal-locked");
      return { slug: getCurrentSlugForReservations(), terminal: currentTerminal?.id, caja: getCajaIdSafe(), cajaOpen: !!cashSession?.open };
    });
    await sleep(8000); // el arranque recupera solo el carrito guardado de la ejecucion anterior: se espera a que lo haga antes de vaciarlo
    log("A:", JSON.stringify(await setup(a)), "| B:", JSON.stringify(await setup(b)));
    await sleep(2500);

    const create = async (w, name) => {
      await w.evaluate(async () => { cart = []; renderCart(); for (const id of [489, 543]) await addToCart(products.find((x) => x.id === id), 2); renderCart(); });
      await w.evaluate(() => document.getElementById("passToEncargoBtn").click()); await sleep(800);
      await w.evaluate((n) => { document.getElementById("encName").value = n; document.querySelector('#encDayChips [data-day="tomorrow"]').click(); }, name);
      await w.evaluate(() => document.getElementById("encSaveNoAdvBtn").click());
      await w.waitForFunction(() => !document.getElementById("encargoResultOverlay").classList.contains("hidden"), null, { timeout: 60000 });
      await w.evaluate(() => document.getElementById("encResCloseBtn").click());
    };
    const openList = async (w) => { await w.evaluate(() => document.getElementById("encargosListBtn").click()); await sleep(1500); };
    const openDetail = async (w, name) => { await w.evaluate((n) => [...document.querySelectorAll("#encListBody .enc-item")].find((r) => r.textContent.includes(n)).click(), name); await sleep(1200); };
    const closeAll = async (w) => w.evaluate(() => { document.getElementById("encDetCloseBtn2")?.click(); document.getElementById("encListCloseBtn")?.click(); });
    // estado real: servidor + pedidos de FS que cuelgan de ese encargo
    const state = (w, name) => w.evaluate(async (name) => {
      const l = await window.TPV_ENCARGOS.call("list-customer-orders", { query: { q: name, status: "pendiente,recogido,cancelado" } });
      const o = (l.json.data || [])[0]; if (!o) return null;
      const d = (await window.TPV_ENCARGOS.call("get-customer-order", { query: { orderId: String(o.id) } })).json.data;
      const cfg = window.RECIPOK_API; const base = cfg.baseUrl.replace(/\/+$/, ""); const H = { Token: cfg.apiKey, Accept: "application/json" };
      const r = await fetch(`${base}/pedidoclientes?limit=200&sort[idpedido]=DESC`, { headers: H }); const j = await r.json();
      const peds = (Array.isArray(j) ? j : j.data || []).filter((p) => String(p.numero2 || "").startsWith(d.orderCode)).map((p) => ({ id: String(p.idpedido), n2: p.numero2, estado: Number(p.idestado), total: Number(p.total) }));
      return { id: d.id, code: d.orderCode, status: d.status, version: d.version, total: d.total, collected: d.collected, lines: d.lines.length, fsIdpedido: d.fsIdpedido, peds };
    }, name);
    const startEdit = async (w, name) => { await openList(w); await openDetail(w, name); // el demo compartido puede dejar un aparcado abierto que se recarga solo en el carrito: se suelta justo antes de pulsar
      await w.evaluate(() => { cart = []; setCurrentParkedTicketIndex(null); renderCart(); document.getElementById("encDetEditBtn").click(); }); await sleep(2500); };
    const addOne = (w) => w.evaluate(async () => { await addToCart(products.find((x) => x.id === 489), 1); renderCart(); return cart.length; });
    const waitOutcome = async (w) => {
      try {
      await w.waitForFunction(() => !document.getElementById("encargoResultOverlay").classList.contains("hidden") || !!document.querySelector("#encWizError:not(.hidden)"), null, { timeout: 60000 });
      } catch {
        const diag = await w.evaluate(() => ({ wiz: !document.getElementById("encargoWizardOverlay").classList.contains("hidden"), title: document.getElementById("encWizTitle").textContent, saving: document.getElementById("encSaveNoAdvBtn").disabled, msg: document.querySelector("#msgOverlay:not(.hidden)") ? document.getElementById("msgText").innerText.slice(0, 160) : "-", toasts: [...document.querySelectorAll("#toastContainer .toast")].map((t) => t.innerText.replace(/\s+/g, " ")), editing: window.TPV_ENCARGOS.isEditing(), lines: cart.length }));
        log("   TIMEOUT esperando el resultado:", JSON.stringify(diag));
        return { ok: false, title: "", err: "TIMEOUT" };
      }
      return w.evaluate(() => ({ ok: !document.getElementById("encargoResultOverlay").classList.contains("hidden"), title: document.getElementById("encResTitle").textContent, err: document.getElementById("encWizError").textContent }));
    };
    const saveEdit = async (w) => {
      await w.evaluate(() => document.getElementById("encEditSaveBtn").click()); await sleep(1200);
      await w.evaluate(() => document.getElementById("encSaveNoAdvBtn").click());
      return waitOutcome(w);
    };
    const retrySave = async (w) => { await w.evaluate(() => document.getElementById("encSaveNoAdvBtn").click()); return waitOutcome(w); };
    const discardEdit = async (w) => {
      // cierra el asistente (si sigue abierto) y descarta la edicion
      await w.evaluate(() => { const x = document.getElementById("encargoWizardOverlay"); if (x && !x.classList.contains("hidden")) document.getElementById("encBackBtn")?.click(); });
      await sleep(500);
      await w.evaluate(() => document.getElementById("encEditDiscardBtn").click()); await sleep(700);
      await w.evaluate(() => document.getElementById("msgOkBtn").click()); await sleep(1500);
    };
    const editing = (w) => w.evaluate(() => ({ editing: window.TPV_ENCARGOS.isEditing(), lines: cart.length }));
    const orphanNewPedidos = (st) => st.peds.filter((p) => p.id !== st.fsIdpedido && /\.E/.test(p.n2));

    // ======================= E1: otro terminal cambia el encargo mientras editas (412) =======================
    log("== E1 otro terminal cambia el encargo mientras editas");
    const N1 = "TEST2TPV editar conflicto";
    await create(a, N1);
    await sleep(2500);
    const s0 = await state(a, N1);
    await startEdit(a, N1);
    const ed0 = await editing(a);
    check("E1 A entra en edicion con el carrito cargado", ed0.editing && ed0.lines === 2, JSON.stringify(ed0));
    await addOne(a);
    // B cobra un anticipo de 1 EUR (sube la version del encargo)
    await openList(b); await openDetail(b, N1);
    await b.evaluate(() => document.getElementById("encDetAdvanceBtn").click()); await sleep(900);
    await b.evaluate(() => document.querySelector('#encKeypad [data-key="1"]').click());
    await b.evaluate(() => { [...document.querySelectorAll("#encMethods button")].find((x) => /contado/i.test(x.textContent)).click(); });
    await b.evaluate(() => document.getElementById("encSaveBtn").click());
    try {
      await b.waitForFunction(() => !document.getElementById("encargoResultOverlay").classList.contains("hidden") || !!document.querySelector("#encWizError:not(.hidden)"), null, { timeout: 60000 });
    } catch {}
    log("   B anticipo:", JSON.stringify(await b.evaluate(() => ({ wiz: !document.getElementById("encargoWizardOverlay").classList.contains("hidden"), title: document.getElementById("encWizTitle").textContent, err: document.getElementById("encWizError").textContent, amount: document.getElementById("encAmountDisplay")?.textContent, res: !document.getElementById("encargoResultOverlay").classList.contains("hidden"), btn: document.getElementById("encSaveBtn").textContent, dis: document.getElementById("encSaveBtn").disabled }))));
    await b.evaluate(() => document.getElementById("encResCloseBtn").click());
    await closeAll(b);
    const sAdv = await state(a, N1);
    check("E1 B cobro el anticipo (la version sube)", sAdv && sAdv.version > s0.version && sAdv.collected === 1, JSON.stringify({ v0: s0.version, v1: sAdv && sAdv.version, col: sAdv && sAdv.collected }));
    const r1 = await saveEdit(a);
    check("E1 A: al guardar recibe el aviso de que otro terminal modifico el encargo", !r1.ok && /otro terminal modific/i.test(r1.err), r1.err.slice(0, 140));
    await sleep(3000);
    const sAfter = await state(a, N1);
    check("E1 no se guardo nada (mismo total, lineas y pedido)", sAfter.total === sAdv.total && sAfter.lines === sAdv.lines && sAfter.fsIdpedido === sAdv.fsIdpedido, JSON.stringify({ total: sAfter.total, lines: sAfter.lines }));
    const orph1 = orphanNewPedidos(sAfter);
    check("E1 el pedido nuevo que se creo quedo CANCELADO (no reserva stock) y el original sigue vivo", orph1.length >= 1 && orph1.every((p) => p.estado === 6) && sAfter.peds.find((p) => p.id === sAfter.fsIdpedido).estado !== 6, JSON.stringify(sAfter.peds));
    await discardEdit(a);
    const ed1 = await editing(a);
    check("E1 A descarta la edicion y el carrito queda vacio", !ed1.editing && ed1.lines === 0, JSON.stringify(ed1));
    await closeAll(a);

    // ======================= E2: A guarda y B lo ve solo =======================
    log("== E2 A guarda una edicion y B la ve sola");
    await openList(b); await openDetail(b, N1);
    const bBefore = await b.evaluate(() => document.getElementById("encDetTotals").innerText.replace(/\s+/g, " "));
    await startEdit(a, N1); await addOne(a);
    const r2 = await saveEdit(a);
    check("E2 A guarda la edicion", r2.ok && /modificado/i.test(r2.title), r2.title + " " + r2.err);
    await a.evaluate(() => document.getElementById("encResCloseBtn").click());
    await sleep(6000);
    const sE2 = await state(a, N1);
    check("E2 el servidor tiene el total nuevo, la version +1 y un pedido nuevo", sE2.total > sAdv.total && sE2.version === sAdv.version + 1 && sE2.fsIdpedido !== sAdv.fsIdpedido, JSON.stringify({ total: sE2.total, v: sE2.version, ped: sE2.fsIdpedido }));
    const oldPed = sE2.peds.find((p) => p.id === sAdv.fsIdpedido);
    check("E2 el pedido anterior de FacturaScripts quedo cancelado", oldPed && oldPed.estado === 6, JSON.stringify(sE2.peds));
    let bSees = false, bNow = "";
    for (let i = 0; i < 12 && !bSees; i++) { await sleep(1000); bNow = await b.evaluate(() => document.getElementById("encDetTotals").innerText.replace(/\s+/g, " ")); bSees = bNow !== bBefore; }
    check("E2 B (con el detalle abierto) ve el total nuevo sin recargar", bSees, `${bBefore} -> ${bNow}`);
    await closeAll(b); await closeAll(a);

    // ======================= E3: otro terminal esta recogiendo (423) =======================
    log("== E3 B esta recogiendo mientras A guarda una edicion");
    await startEdit(a, N1); await addOne(a);
    await openList(b); await openDetail(b, N1);
    await b.evaluate(() => { window.__pick = window.TPV_ENCARGOS.pickupFlow(); });
    await b.waitForFunction(() => !document.getElementById("payOverlay").classList.contains("hidden"), null, { timeout: 30000 });
    const r3 = await saveEdit(a);
    check("E3 A: con B recogiendo, guardar da el aviso de otro dispositivo", !r3.ok && /otro dispositivo/i.test(r3.err), r3.err.slice(0, 140));
    await sleep(2500);
    const s3 = await state(a, N1);
    check("E3 no se guardo nada y ningun pedido nuevo quedo vivo", s3.version === sE2.version && orphanNewPedidos(s3).every((p) => p.estado === 6), JSON.stringify(s3.peds));
    await b.evaluate(() => document.getElementById("payCancelBtn").click()); await sleep(3500);
    const r3b = await retrySave(a);
    check("E3 al soltar B el candado, A puede guardar la edicion", r3b.ok, r3b.title + " " + r3b.err);
    await a.evaluate(() => document.getElementById("encResCloseBtn")?.click());
    await closeAll(b); await closeAll(a);

    // ======================= E4: los dos editan a la vez =======================
    log("== E4 los dos editan a la vez");
    const sBefore4 = await state(a, N1);
    const parkedBefore = await b.evaluate(() => parkedTickets.filter((t) => !t.paid).map((t) => t.id).join(","));
    for (const w of [a, b]) await w.evaluate(() => { cart = []; setCurrentParkedTicketIndex(null); renderCart(); });
    log("   E4 carritos antes de empezar -> A:", JSON.stringify(await a.evaluate(() => cart.map((l) => l.name))), "| B:", JSON.stringify(await b.evaluate(() => cart.map((l) => l.name))), "| B editing:", JSON.stringify(await editing(b)));
    await startEdit(a, N1);
    await b.evaluate(() => { document.getElementById("toastContainer").innerHTML = ""; });
    await startEdit(b, N1);
    log("   E4 toasts de B:", JSON.stringify(await b.evaluate(() => [...document.querySelectorAll("#toastContainer .toast")].map((t) => t.innerText.replace(/\s+/g, " ")))), "| detalle B abierto:", await b.evaluate(() => !document.getElementById("encargoDetailOverlay").classList.contains("hidden")), "| parked idx:", await b.evaluate(() => String(currentParkedTicketIndex)));
    await addOne(a); await addOne(b);
    await sleep(2500); // el autoguardado de Mesas (700 ms) no debe convertir el carrito de edicion en un aparcado
    const parkedAfter = await b.evaluate(() => parkedTickets.filter((t) => !t.paid).map((t) => t.id).join(","));
    check("E4 el carrito de edicion NO se guarda como aparcado", parkedAfter === parkedBefore, `antes=[${parkedBefore}] despues=[${parkedAfter}]`);
    log("   E4 edicion A:", JSON.stringify(await editing(a)), "| B:", JSON.stringify(await editing(b)), "| mensaje B:", await b.evaluate(() => (document.querySelector("#msgOverlay:not(.hidden)") ? document.getElementById("msgText").innerText.replace(/\s+/g, " ").slice(0, 120) : "-")));
    const r4a = await saveEdit(a);
    const r4b = await saveEdit(b);
    check("E4 el primero que guarda lo consigue", r4a.ok, r4a.title + " " + r4a.err);
    check("E4 el segundo recibe el aviso de conflicto y no pisa al primero", !r4b.ok && /otro terminal modific/i.test(r4b.err), r4b.err.slice(0, 140));
    await sleep(2500);
    const s4 = await state(a, N1);
    check("E4 el servidor refleja solo UNA edicion (version +1 y un producto mas)", s4.version === sBefore4.version + 1 && s4.lines === sBefore4.lines + 1, JSON.stringify({ v: s4.version, lines: s4.lines, antes: sBefore4.lines }));
    check("E4 el pedido nuevo del segundo quedo cancelado", orphanNewPedidos(s4).every((p) => p.estado === 6), JSON.stringify(s4.peds));
    await a.evaluate(() => document.getElementById("encResCloseBtn")?.click());
    await discardEdit(b);
    await closeAll(a); await closeAll(b);

    // ======================= E5: en Modo Mesas no se puede editar =======================
    log("== E5 Editar encargo con el Modo Mesas abierto");
    await a.evaluate(() => { document.getElementById("encResCloseBtn")?.click(); });
    await b.evaluate(async () => { await setMesasInlineModeEnabled(true); });
    await sleep(2500);
    await openList(b); await openDetail(b, N1);
    await b.evaluate(() => { document.getElementById("encDetEditBtn").click(); });
    const m5 = await b.evaluate(() => (document.querySelector("#msgOverlay:not(.hidden)") ? document.getElementById("msgText").innerText.replace(/\s+/g, " ") : ""));
    const ed5 = await editing(b);
    check("E5 en Modo Mesas «Editar encargo» no empieza y explica que hay que salir del Modo Mesas", !ed5.editing && /Modo Mesas/i.test(m5), m5.slice(0, 120));
    await b.evaluate(() => { document.getElementById("msgOkBtn")?.click(); });
    await closeAll(b);
    await b.evaluate(async () => { await setMesasInlineModeEnabled(false); });

    for (const w of [a, b]) await w.evaluate(async () => { window.buildFsLinesFromCart = undefined; await window.TPV_CFG.set("ui.encargosEnabled", false); await window.TPV_ENCARGOS.loadEnabled(); cart = []; renderCart(); }).catch(() => {});
  } catch (e) {
    console.error("ERROR:", e?.message || e);
    results.push(["error de ejecucion", false]);
  }
  const bad = results.filter((r) => !r[1]).length;
  console.log(`\nRESULTADO: ${results.length - bad} OK, ${bad} FAIL`);
  clearTimeout(hard);
  kills.forEach((k) => k());
  process.exit(bad ? 1 : 0);
})();
