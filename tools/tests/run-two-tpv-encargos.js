// run-two-tpv-encargos.js -- prueba MANUAL (no entra en npm test) de ENCARGOS con DOS TPV reales contra la demo.
// Perfiles persistentes de run-two-tpv.js (sesion ya iniciada, nunca PIN). Crea encargos y facturas REALES en demo:
// las lineas de las facturas quedan marcadas "[PRUEBA ENCARGOS]". Los encargos se llaman "TEST2TPV ..." para poder
// limpiarlos (clean: borrar de customer_orders los que empiecen por TEST y cancelar/borrar sus pedidos de FS).
// Comprueba: aviso en tiempo real entre terminales, candado de recogida (recoger / otro anticipo / cancelar bloqueados
// mientras otro terminal recoge, y liberado al soltarlo), recogida completa vista por el otro terminal, cancelar con
// el detalle desactualizado (usa los datos reales) y recoger a la vez (solo uno pasa), y el cierre de caja de los dos.
// Requiere la opcion Encargos disponible en el servidor para el slug demo (customer_orders_pilot_slugs).
// Uso: node tools/tests/run-two-tpv-encargos.js
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
      await window.TPV_ENCARGOS.loadEnabled();
      cart = []; setCurrentParkedTicketIndex(null); renderCart();
      document.querySelectorAll(".simple-overlay:not(.hidden)").forEach((o) => o.classList.add("hidden")); document.body.classList.remove("modal-locked");
      return { slug: getCurrentSlugForReservations(), terminal: currentTerminal?.id, caja: getCajaIdSafe(), admin: !!window.TPV_STATE.isAdmin, rt: !!window.__realtimeSocket };
    });
    log("A:", JSON.stringify(await setup(a)), "| B:", JSON.stringify(await setup(b)));
    await sleep(2500);

    const dismissMsg = (w) => w.evaluate(() => { const o = document.querySelector("#msgOverlay:not(.hidden)"); if (!o) return ""; const t = document.getElementById("msgText").innerText.replace(/\s+/g, " "); document.getElementById("msgOkBtn").click(); return t; });
    const msgText = async (w, ms = 15000) => { try { await w.waitForFunction(() => !!document.querySelector("#msgOverlay:not(.hidden)"), null, { timeout: ms }); } catch { return ""; } return w.evaluate(() => document.getElementById("msgText").innerText.replace(/\s+/g, " ")); };
    const badge = (w) => w.evaluate(() => document.getElementById("encargosCountBadge").textContent);
    const create = async (w, name, adv, method) => {
      await w.evaluate(async () => { cart = []; renderCart(); for (const id of [489, 543]) await addToCart(products.find((x) => x.id === id), 2); renderCart(); });
      await w.evaluate(() => document.getElementById("passToEncargoBtn").click()); await sleep(800);
      await w.evaluate((n) => { document.getElementById("encName").value = n; document.querySelector('#encDayChips [data-day="tomorrow"]').click(); }, name);
      if (adv) {
        await w.evaluate(() => document.getElementById("encNextBtn").click());
        for (const k of adv.split("")) await w.evaluate((k) => document.querySelector(`#encKeypad [data-key="${k}"]`).click(), k);
        await w.evaluate((m) => { [...document.querySelectorAll("#encMethods button")].find((x) => new RegExp(m, "i").test(x.textContent)).click(); }, method);
        await w.evaluate(() => document.getElementById("encSaveBtn").click());
      } else await w.evaluate(() => document.getElementById("encSaveNoAdvBtn").click());
      await w.waitForFunction(() => !document.getElementById("encargoResultOverlay").classList.contains("hidden"), null, { timeout: 60000 });
      await w.evaluate(() => document.getElementById("encResCloseBtn").click());
    };
    const openList = async (w) => { await w.evaluate(() => document.getElementById("encargosListBtn").click()); await sleep(1500); };
    const openDetail = async (w, name) => { await w.evaluate((n) => [...document.querySelectorAll("#encListBody .enc-item")].find((r) => r.textContent.includes(n)).click(), name); await sleep(1200); };
    const detailChip = (w) => w.evaluate(() => document.getElementById("encDetChip").textContent);
    const rowsOf = (w) => w.evaluate(() => [...document.querySelectorAll("#encListBody .enc-item")].map((r) => r.querySelector(".enc-item-main strong").textContent + "|" + r.querySelector(".enc-item-chip").textContent));

    // ---------------- S1: tiempo real ----------------
    log("== S1 tiempo real");
    const b0 = await badge(b);
    await openList(b);                                                    // B tiene la lista abierta
    await create(a, "TEST2TPV recoger", "5", "contado");                  // A crea E1 (anticipo 5 efectivo)
    let seen = false;
    for (let i = 0; i < 12 && !seen; i++) { await sleep(1000); seen = (await rowsOf(b)).some((r) => r.includes("TEST2TPV recoger")); }
    check("S1 B ve el encargo creado por A sin tocar nada (lista abierta, aviso en tiempo real)", seen, `contador B antes=${b0} ahora=${await badge(b)}`);
    await b.evaluate(() => document.getElementById("encListCloseBtn").click());
    // ---------------- ambos abren el detalle de E1 ----------------
    await openList(a); await openDetail(a, "TEST2TPV recoger");
    await openList(b); await openDetail(b, "TEST2TPV recoger");

    // ---------------- S2: candado ----------------
    log("== S2 candado de recogida");
    await a.evaluate(() => { window.__pickupA = window.TPV_ENCARGOS.pickupFlow(); });
    await a.waitForFunction(() => !document.getElementById("payOverlay").classList.contains("hidden"), null, { timeout: 30000 });
    check("S2 A abre la ventana de cobro del resto (tiene el candado)", true);
    await b.evaluate(() => document.getElementById("encDetPickupBtn").click());
    const m1 = await msgText(b);
    check("S2 B no puede recoger mientras A lo tiene", /otro dispositivo|otro terminal/i.test(m1), m1.slice(0, 120));
    await dismissMsg(b);
    await b.evaluate(() => document.getElementById("encDetAdvanceBtn").click()); await sleep(900);
    await b.evaluate(() => document.querySelector('#encKeypad [data-key="1"]').click());
    await b.evaluate(() => document.getElementById("encSaveBtn").click()); await sleep(5000);
    const e2 = await b.evaluate(() => document.getElementById("encWizError").textContent);
    log("   estado del cuadro de anticipo en B:", JSON.stringify(await b.evaluate(() => ({ visible: !document.getElementById("encargoWizardOverlay").classList.contains("hidden"), titulo: document.getElementById("encWizTitle").textContent, boton: document.getElementById("encSaveBtn").textContent, error: document.getElementById("encWizError").textContent, importe: document.getElementById("encAmountDisplay").textContent }))));
    check("S2 B no puede cobrar otro anticipo mientras A lo tiene", /otro dispositivo|otro terminal/i.test(e2), e2.slice(0, 160));
    await b.evaluate(() => document.getElementById("encBackBtn").click()); await sleep(500);
    await b.evaluate(() => document.getElementById("encDetCancelBtn").click());
    const mc = await msgText(b); log("   B cancelar ->", mc.slice(0, 90));
    await b.evaluate(() => document.getElementById("msgOkBtn").click());
    const m3 = await msgText(b, 20000);
    check("S2 B no puede cancelar mientras A lo tiene", /otro dispositivo|No se pudo cancelar/i.test(m3), m3.slice(0, 120));
    await dismissMsg(b);
    // A suelta el candado (cancela la ventana de cobro)
    await a.evaluate(() => document.getElementById("payCancelBtn").click()); await sleep(3500);
    await b.evaluate(() => document.getElementById("encDetPickupBtn").click());
    let bGotPay = true;
    try { await b.waitForFunction(() => !document.getElementById("payOverlay").classList.contains("hidden"), null, { timeout: 20000 }); } catch { bGotPay = false; }
    check("S2 al soltar A el candado, B ya puede recoger", bGotPay);
    if (bGotPay) { await b.evaluate(() => document.getElementById("payCancelBtn").click()); await sleep(3000); }

    // ---------------- S3: A completa, B ve el cambio ----------------
    log("== S3 recogida completa en A, B lo ve");
    await a.evaluate(() => document.getElementById("encDetPickupBtn").click());
    await a.waitForFunction(() => !document.getElementById("payOverlay").classList.contains("hidden"), null, { timeout: 30000 });
    await a.evaluate(() => { const inp = document.querySelector('#payOverlay .pay-amount[data-codpago="CONT"]'); inp.value = "6,70"; inp.dispatchEvent(new Event("input", { bubbles: true })); });
    await a.evaluate(() => document.getElementById("paySaveBtn").click());
    await a.waitForFunction(() => document.getElementById("encDetChip").textContent === "RECOGIDO", null, { timeout: 60000 }).catch(() => {});
    check("S3 A: el encargo queda RECOGIDO", (await detailChip(a)) === "RECOGIDO");
    let bSees = false;
    for (let i = 0; i < 12 && !bSees; i++) { await sleep(1000); bSees = (await detailChip(b)) === "RECOGIDO"; }
    check("S3 B (con el detalle abierto) pasa a RECOGIDO solo, sin recargar", bSees, await detailChip(b));
    await a.evaluate(() => document.getElementById("postPayCloseX")?.click());
    await a.evaluate(() => document.getElementById("encDetCloseBtn2").click());
    await b.evaluate(() => document.getElementById("encDetCloseBtn2").click());
    await a.evaluate(() => document.getElementById("encListCloseBtn").click());
    await b.evaluate(() => document.getElementById("encListCloseBtn").click());

    // ---------------- S4: cancelar con datos viejos ----------------
    log("== S4 cancelar con el detalle desactualizado");
    await create(a, "TEST2TPV stale", "3", "Tarjeta");                    // E2: anticipo 3 tarjeta
    await sleep(2500);
    await openList(b); await openDetail(b, "TEST2TPV stale");              // B ve 3 €
    const stale3 = await b.evaluate(() => document.getElementById("encDetTotals").innerText.replace(/\s+/g, " "));
    await openList(a); await openDetail(a, "TEST2TPV stale");
    await a.evaluate(() => document.getElementById("encDetAdvanceBtn").click()); await sleep(900);
    await a.evaluate(() => document.querySelector('#encKeypad [data-key="2"]').click());
    await a.evaluate(() => { [...document.querySelectorAll("#encMethods button")].find((x) => /contado/i.test(x.textContent)).click(); });
    await a.evaluate(() => document.getElementById("encSaveBtn").click()); await sleep(5000);
    // B: su detalle se refresca solo por el tiempo real; aun asi pulsa Cancelar
    const bTotals = await b.evaluate(() => document.getElementById("encDetTotals").innerText.replace(/\s+/g, " "));
    log("   B antes:", stale3, "| B ahora:", bTotals);
    await b.evaluate(() => document.getElementById("encDetCancelBtn").click());
    const mcancel = await msgText(b);
    check("S4 B cancela viendo la suma REAL a devolver (3 tarjeta + 2 efectivo = 5)", /5,00 €/.test(mcancel) && /Tarjeta/i.test(mcancel) && /contado/i.test(mcancel), mcancel.slice(60, 260));
    await b.evaluate(() => document.getElementById("msgOkBtn").click()); await sleep(4500);
    check("S4 B: encargo cancelado con las dos devoluciones", (await detailChip(b)) === "CANCELADO", await b.evaluate(() => document.getElementById("encDetMoves").innerText.replace(/\s+/g, " ")));
    let aSees = false;
    for (let i = 0; i < 12 && !aSees; i++) { await sleep(1000); aSees = (await detailChip(a)) === "CANCELADO"; }
    check("S4 A ve el CANCELADO sin recargar", aSees, await detailChip(a));
    await a.evaluate(() => document.getElementById("encDetCloseBtn2").click()); await b.evaluate(() => document.getElementById("encDetCloseBtn2").click());
    await a.evaluate(() => document.getElementById("encListCloseBtn").click()); await b.evaluate(() => document.getElementById("encListCloseBtn").click());

    // ---------------- S5: los dos pulsan Recoger a la vez ----------------
    log("== S5 recoger a la vez");
    await create(a, "TEST2TPV carrera", "", "");
    await sleep(2500);
    await openList(a); await openDetail(a, "TEST2TPV carrera");
    await openList(b); await openDetail(b, "TEST2TPV carrera");
    await Promise.all([
      a.evaluate(() => { document.getElementById("encDetPickupBtn").click(); }),
      b.evaluate(() => { document.getElementById("encDetPickupBtn").click(); }),
    ]);
    await sleep(8000);
    const st = async (w) => w.evaluate(() => ({ pay: !document.getElementById("payOverlay").classList.contains("hidden"), msg: (document.querySelector("#msgOverlay:not(.hidden)") ? document.getElementById("msgText").innerText.replace(/\s+/g, " ").slice(0, 100) : "") }));
    const sa = await st(a), sb = await st(b);
    log("   A:", JSON.stringify(sa), "| B:", JSON.stringify(sb));
    check("S5 exactamente uno obtiene la ventana de cobro y el otro recibe el aviso de candado", (sa.pay !== sb.pay) && (sa.pay ? /otro dispositivo|otro terminal/i.test(sb.msg) : /otro dispositivo|otro terminal/i.test(sa.msg)));
    for (const w of [a, b]) { await w.evaluate(() => { document.getElementById("payCancelBtn")?.click(); const ok = document.getElementById("msgOkBtn"); if (document.querySelector("#msgOverlay:not(.hidden)")) ok.click(); }); }
    await sleep(3000);

    // ---------------- S6: cierre de caja ----------------
    log("== S6 cierre de caja en los dos");
    const closeInfo = async (w) => { await w.evaluate(() => openCashOpenDialog("close")); await w.waitForFunction(() => !document.getElementById("cashOpenOverlay").classList.contains("hidden"), null, { timeout: 20000 }); await w.waitForFunction(() => { const x = document.getElementById("cashOpenOkBtn"); return x && !/Cargando/i.test(x.textContent); }, null, { timeout: 150000 }); await sleep(800); const r = await w.evaluate(() => ({ caja: getCajaIdSafe(), expected: document.getElementById("sumExpectedCash").textContent, encCash: document.getElementById("sumEncargosItem").style.display !== "none" ? document.getElementById("sumEncargosCash").textContent : "(oculto)", sales: document.getElementById("cashCloseGrandTotalVal").textContent, enc: cashSession.encargos ? { cashNet: cashSession.encargos.cashNet, totalNet: cashSession.encargos.totalNet } : null })); await w.evaluate(() => document.getElementById("cashOpenCancelBtn").click()); await sleep(500); return r; };
    const ca = await closeInfo(a), cb = await closeInfo(b);
    log("   A:", JSON.stringify(ca)); log("   B:", JSON.stringify(cb));
    check("S6 las dos terminales (misma caja) ven el mismo dinero de encargos y el mismo esperado", ca.caja === cb.caja && JSON.stringify(ca.enc) === JSON.stringify(cb.enc) && ca.expected === cb.expected);
    // lo esperado: anticipos 5 (E1 efectivo) + resto 6,70 efectivo + (E2: +3 tarjeta +2 efectivo -3 tarjeta -2 efectivo = 0) -> efectivo neto 11,70
    check("S6 el efectivo neto de encargos es 11,70 (5 + 6,70; lo de E2 se compensa con su devolucion)", ca.enc && Math.abs(ca.enc.cashNet - 11.7) < 0.005, JSON.stringify(ca.enc));

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
