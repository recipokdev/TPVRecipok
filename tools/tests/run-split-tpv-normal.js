// run-split-tpv-normal.js -- prueba MANUAL (no entra en npm test) de "Dividir cuenta" en el TPV normal (fuera de Modo Mesas).
//
// Con UN TPV real contra el demo (perfil persistente de run-two-tpv.js con sesion ya iniciada; nunca se escribe PIN):
//   1) carrito nuevo de TPV normal con 2 productos con stock gestionado (2 unidades de cada uno);
//   2) pulsa "Dividir" (junto al total): se aparca el pedido y se abre el asistente;
//   3) division igualitaria en 2 partes;
//   4) cobra la parte 1 -> debe cargarse SOLA la parte 2 -> cobra la parte 2;
//   5) comprueba que el stock final de cada producto = inicial - 2 (el neto de ventas) y deja los dos productos
//      con su stock inicial (solo demo). Imprime los ids de ticket para revisar el registro de reservas en el servidor.
// COBRA DE VERDAD en el demo (2 facturas de prueba).
// Con --mesas: mismo recorrido en Modo Mesas (mesa M3 del demo, que deja limpia) para comprobar que Mesas no se rompe.
// Con --merge: tras dividir, deshace la division (Partes = 1) y cobra el pedido unificado de una sola vez.
// Uso: node tools/tests/run-split-tpv-normal.js [ruta-capturas] [--merge] [--mesas]
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os"), fs = require("fs");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const MERGE = process.argv.includes("--merge");
const MESAS = process.argv.includes("--mesas");
const TABLE = "tut-room-1::m3";
const SHOTS = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || "";
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
      const msg = ov && !ov.classList.contains("hidden") ? (document.getElementById("msgText")?.textContent || "").slice(0, 160) : "";
      return { vacio: Array.isArray(cart) && cart.length === 0, msg };
    });
    if (st.vacio || st.msg) return st;
    await sleep(400);
  }
  return { timeout: true };
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 280000);
  const out = {};
  let A; const prods = [];
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    await sleep(8000);
    out.estado = await A.win.evaluate(async (MESAS) => {
      await setMesasInlineModeEnabled(!!MESAS, { persist: false });
      if (MESAS) { setMesasInlineView("transacciones", { persist: false }); }
      if (typeof splitTpvEnabled !== "undefined") { // (en una version sin la funcion, el arnes tambien sirve)
        splitTpvEnabled = true; // solo en memoria: no toca la configuracion guardada del perfil
        refreshSplitFromCartButtonUI();
      }
      window.__dismiss = () => { const ov = document.getElementById("msgOverlay"); if (ov && !ov.classList.contains("hidden")) { Array.from(ov.querySelectorAll("button")).pop()?.click(); } };
      return { login: hasActiveLoginSession(), cajaAbierta: !!cashSession?.open, mesas: !!MESAS_INLINE_ACTIVE };
    }, MESAS);
    if (!out.estado.login || !out.estado.cajaAbierta) throw new Error("Falta sesion iniciada o caja abierta (no se escribe PIN): " + JSON.stringify(out.estado));

    const pick = await A.win.evaluate(async () => {
      const cand = products.filter((p) => {
        const id = getProductBaseId(p);
        const st = parseManagedStockValue(p.stockfis);
        return id && st !== null && st >= 8 && Number(p.price) > 0 && !p.variants && !isOfferPackProductById(id) && !productHasDerivedStockMarker(p);
      });
      const chosen = cand.slice(-2);
      const rows = [];
      for (const p of chosen) {
        const id = getProductBaseId(p);
        const r = await fetchStockRowsByProductReference(findProductByBaseId(id) || p);
        const row = pickStockRowByWarehouse(r, getCurrentWarehouseCode(), { strict: false });
        rows.push({ id, name: String(p.name).slice(0, 30), stock: Number(row?.cantidad) });
      }
      return rows;
    });
    if (pick.length < 2) throw new Error("No hay 2 productos con stock gestionado >= 8 en el demo");
    prods.push(...pick);
    out.productos = pick;

    const readStock = (id) => A.win.evaluate(async (id) => {
      const rows = await fetchStockRowsByProductReference(findProductByBaseId(id));
      const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
      return Number(row?.cantidad);
    }, id);

    // 1) carrito nuevo con 2 unidades de cada producto
    if (MESAS) {
      await A.win.evaluate((TABLE) => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); }, TABLE);
      await sleep(800);
    }
    await A.win.evaluate(async (ids) => {
      cart = ids.map((id) => buildCartLine(findProductByBaseId(id), 2));
      renderCart();
    }, prods.map((p) => p.id));
    await sleep(MESAS ? 6000 : 600); // en Mesas el autoguardado crea el pedido de la mesa
    out.boton_dividir_visible = await A.win.evaluate(() => !!document.getElementById("splitFromCartBtn") && !document.getElementById("splitFromCartBtn").classList.contains("hidden"));
    if (SHOTS) await A.win.screenshot({ path: path.join(SHOTS, "split_1_carrito.png") });

    // 2) pulsar Dividir (en Mesas: el boton Dividir del pedido abierto)
    await A.win.evaluate((MESAS) => document.getElementById(MESAS ? "parkedSplitBtn" : "splitFromCartBtn").click(), MESAS);
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      if (await A.win.evaluate(() => !document.getElementById("splitTicketOverlay").classList.contains("hidden"))) break;
      await sleep(300);
    }
    out.asistente_abierto = await A.win.evaluate(() => !document.getElementById("splitTicketOverlay").classList.contains("hidden"));
    out.ticket_origen = await A.win.evaluate(() => { const t = getCurrentLoadedParkedTicket(); return t ? { id: t.id, name: t.name, modo: inferTicketParkingMode(t), lineas: (t.items || []).length } : null; });
    if (SHOTS) await A.win.screenshot({ path: path.join(SHOTS, "split_2_asistente.png") });

    // 3) igualitario, 2 partes
    await A.win.evaluate(async () => {
      const sel = document.getElementById("splitTicketModeSelect");
      sel.value = "equal"; sel.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 300));
      await confirmSplitTicket();
    });
    await sleep(2500);
    out.tras_dividir = await A.win.evaluate(() => ({
      partes: parkedTickets.filter((t) => !t.paid && getTicketSplitMeta(t)).map((t) => ({ id: t.id, name: t.name, parte: getTicketSplitMeta(t)?.part, total: t.total, modo: inferTicketParkingMode(t) })),
      cargado: getCurrentLoadedParkedTicket()?.name || null,
      cart: cart.map((l) => ({ n: String(l.name).slice(0, 14), q: l.qty })),
    }));
    if (SHOTS) await A.win.screenshot({ path: path.join(SHOTS, "split_3_parte1.png") });
    out.ids = out.tras_dividir.partes.map((p) => p.id);

    if (MERGE) {
      await A.win.evaluate(async () => {
        openSplitTicketModal();
        await new Promise((r) => setTimeout(r, 400));
        const inp = document.getElementById("splitTicketPartsInput");
        inp.value = "1"; inp.dispatchEvent(new Event("input")); inp.dispatchEvent(new Event("change"));
        await new Promise((r) => setTimeout(r, 400));
        await confirmSplitTicket();
      });
      await sleep(2500);
      out.tras_unificar = await A.win.evaluate(() => ({
        partes: parkedTickets.filter((t) => !t.paid && getTicketSplitMeta(t)).length,
        cargado: getCurrentLoadedParkedTicket()?.name || null,
        cart: cart.map((l) => ({ n: String(l.name).slice(0, 14), q: l.qty })),
      }));
      out.cobro_unico = await drivePay(A);
      await sleep(14000);
      await A.win.evaluate(() => window.__dismiss());
    } else {
    // 4) cobrar parte 1 -> debe cargarse sola la parte 2 -> cobrar parte 2
    out.cobro1 = await drivePay(A);
    await sleep(3500);
    out.tras_cobro1 = await A.win.evaluate(() => ({ cargado: getCurrentLoadedParkedTicket()?.name || null, cart: cart.map((l) => ({ n: String(l.name).slice(0, 14), q: l.qty })) }));
    if (SHOTS) await A.win.screenshot({ path: path.join(SHOTS, "split_4_parte2_auto.png") });
    await A.win.evaluate(() => window.__dismiss());
    out.cobro2 = await drivePay(A);
    await sleep(14000);
    await A.win.evaluate(() => window.__dismiss());
    }
    out.tras_cobro2 = await A.win.evaluate(() => ({ cargado: getCurrentLoadedParkedTicket()?.name || null, cart: cart.length, pendientes: parkedTickets.filter((t) => !t.paid && getTicketSplitMeta(t)).length }));

    // 5) stock: inicial - 2 (neto de ventas) en cada producto
    out.stock = [];
    for (const p of prods) {
      const fin = await readStock(p.id);
      out.stock.push({ id: p.id, nombre: p.name, inicial: p.stock, final: fin, esperado: p.stock - 2, DESCUADRE: Number((fin - (p.stock - 2)).toFixed(3)) });
    }
  } catch (e) {
    out.ERROR = String((e && e.message) || e).slice(0, 500);
  } finally {
    try {
      if (A) {
        out.limpieza = await A.win.evaluate(async ([prods, ids, MESAS, TABLE]) => {
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          for (const id of ids) {
            const t = parkedTickets.find((x) => String(x.id) === String(id) && !x.paid);
            try { if (t) await apiDeleteParkedReservation(t); } catch (e) {}
          }
          if (MESAS) {
            const mine = parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE);
            for (const t of mine) { try { await apiDeleteParkedReservation(t); } catch (e) {} }
            const st = loadMesasTablesStateForInline();
            if (st?.tableTicketMap) delete st.tableTicketMap[TABLE];
            if (st?.draftCartByTable) delete st.draftCartByTable[TABLE];
            saveMesasTablesStateForInline(st);
          }
          for (const p of prods) {
            const rows = await fetchStockRowsByProductReference(findProductByBaseId(p.id));
            const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
            if (row && Number.isFinite(p.stock)) await updateStockRowCantidad(row, p.stock);
          }
          return "ok";
        }, [prods, out.ids || [], MESAS, TABLE]);
        await sleep(2000);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 160); }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(0);
  }
})();
