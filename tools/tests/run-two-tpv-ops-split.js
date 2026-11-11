// run-two-tpv-ops-split.js -- prueba (entra en la bateria, nivel full) de DIVIDIR CUENTA con DOS TPV
// reales a la vez en Modo Mesas contra el demo (mesa M3, que deja limpia). Perfiles persistentes de
// run-two-tpv.js, sesion ya iniciada (nunca PIN). Requiere parked_ops_pilot_slugs_mesas = ['demo'].
// Escenario: A divide la cuenta en 2 partes mientras B (con el pedido original aun abierto) sube la
// cantidad de una linea. Se comprueba que no se duplica ni se pierde nada y que las partes cuadran.
// Uso: node tools/tests/run-two-tpv-ops-split.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const kills = [];
const TABLE = "tut-room-1::m3";

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

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  const n = out.nombres || [];
  const m = out.modo || [];
  // unidades totales de un producto en una lista de pedidos [{items:"nombre:cant,..."}]
  const total = (list, nombre) => (list || []).reduce((t, x) => t + String(x.items || "").split(",").filter((p) => p.startsWith(nombre + ":")).reduce((a, p) => a + Number(p.split(":")[1] || 0), 0), 0);
  const firma = (list) => JSON.stringify((list || []).map((x) => x.split + "|" + x.items).sort());
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  ok("Los dos TPV están en Modo Mesas con el guardado por partes activo (piloto)", m.length === 2 && m.every((x) => x.mesas && x.ops), m);
  ok("Paso 1: A crea el pedido de la mesa con 2 + 1 unidades en un solo pedido", (out.paso1 || []).length === 1 && total(out.paso1, n[0]) === 2 && total(out.paso1, n[2]) === 1, out.paso1);
  ok("Paso 2: B abre la mesa y ve las mismas líneas", JSON.stringify(out.paso2_B?.cart || []) === JSON.stringify([n[0] + ":2", n[2] + ":1"]) || (out.paso2_B?.cart || []).slice().sort().join() === [n[0] + ":2", n[2] + ":1"].sort().join(), out.paso2_B);
  ok("Paso 3: la división se completa sin mensaje de error", out.paso3_A === "ok", out.paso3_A);
  const A = out.paso4_A || [], B = out.paso4_B || [];
  ok("Tras dividir (con B subiendo una cantidad a la vez) quedan exactamente 2 partes (1/2 y 2/2) y ningún pedido original suelto", A.length === 2 && A.map((x) => x.split).sort().join() === "1/2,2/2", A);
  ok("Los dos TPV ven exactamente las mismas partes", firma(A) === firma(B), { A, B });
  ok("El producto de la línea que nadie tocó a la vez (1 unidad) no se duplica ni se pierde", total(A, n[2]) === 1, A);
  ok("La unidad que B sumó mientras A dividía no se pierde ni se duplica (3 unidades en total entre las partes)", total(A, n[0]) === 3, { totalP0: total(A, n[0]), A });
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 330000);
  const out = {};
  let A, B;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);
    const prep = (X) => X.win.evaluate(async (TABLE) => {
      await setMesasInlineModeEnabled(true, { persist: false }); setMesasInlineView("transacciones", { persist: false });
      window.__saved = { on: localStorage.getItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY) };
      localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, "0");
      printComandaWithContext = async () => ({ ok: true });
      const seen = new Set(); window.__prods = [];
      for (const p of products.filter((x) => Number(x.price) > 0 && !x.variants && !isOfferPackProductById(getProductBaseId(x)) && !(getProductAddonsForProduct(x) || []).length && !productHasDerivedStockMarker(x))) { const k = String(p.name).slice(0, 7); if (!seen.has(k)) { seen.add(k); __prods.push(p); } if (__prods.length >= 3) break; }
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); };
      window.__tickets = () => parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).map((t) => ({ id: String(t.id).slice(-5), name: String(t.name || ""), split: t.splitGroupId ? `${t.splitPart}/${t.splitTotal}` : "-", items: (t.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",") }));
      return { mesas: MESAS_INLINE_ACTIVE, ops: parkedOpsIsEnabled(getCurrentSlugForReservations(), "mesas") };
    }, TABLE);
    await prep(A); await prep(B);
    await sleep(6000); // el guardado por partes se aprende del servidor al arrancar
    const flags = (X) => X.win.evaluate(() => ({ mesas: MESAS_INLINE_ACTIVE, ops: parkedOpsIsEnabled(getCurrentSlugForReservations(), "mesas") }));
    out.modo = [await flags(A), await flags(B)];
    out.nombres = await A.win.evaluate(() => __prods.map((p) => String(p.name).slice(0, 7)));

    // 1) A crea el pedido en M3 con dos lineas (2 x P0 y 1 x P2)
    await A.win.evaluate(() => { __sel(); });
    await sleep(500);
    await A.win.evaluate(() => { addToCart(__prods[0]); });
    await sleep(3500);
    await A.win.evaluate(() => { cart[0].qty = 2; cart.push(buildCartLine(__prods[2], 1)); renderCart(); });
    await sleep(5000);
    out.paso1 = await A.win.evaluate(() => __tickets());

    // 2) B abre la mesa
    await B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); __sel(); });
    await sleep(1500);
    out.paso2_B = await B.win.evaluate(() => ({ cart: cart.map((c) => String(c.name).slice(0, 7) + ":" + c.qty) }));

    // 3) A divide en 2 partes (P0: 1+1, P2: parte 2) y a la vez B sube P0 a +1
    const splitA = A.win.evaluate(async () => {
      openSplitTicketModal();
      splitTicketPartsCount = 2;
      if (splitTicketPartsInput) splitTicketPartsInput.value = "2";
      splitTicketMode = "items";
      initSplitItemsMatrixFromCurrentCart();
      splitTicketItemsMatrix = [[1, 1], [0, 1]];
      await confirmSplitTicket();
      return (splitTicketError && splitTicketError.textContent) || "ok";
    });
    await sleep(300);
    await B.win.evaluate(() => { const l = cart[0]; updateCartItemQuantity(l._lineId, (Number(l.qty) || 1) + 1); });
    out.paso3_A = await splitA;
    await sleep(9000);
    for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(2500);
    out.paso4_A = await A.win.evaluate(() => __tickets());
    out.paso4_B = await B.win.evaluate(() => __tickets());
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A && B) for (const X of [A, B]) await X.win.evaluate(() => { if (!window.__saved) return; if (window.__saved.on === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, window.__saved.on); }).catch(() => {});
      if (A) {
        out.limpieza = await A.win.evaluate(async (TABLE) => {
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          const mine = parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE);
          for (const t of mine) { try { await apiDeleteParkedReservation(t); } catch (e) {} }
          const st = loadMesasTablesStateForInline();
          if (st?.tableTicketMap) delete st.tableTicketMap[TABLE];
          if (st?.draftCartByTable) delete st.draftCartByTable[TABLE];
          saveMesasTablesStateForInline(st);
          return "borrados " + mine.length;
        }, TABLE);
        await sleep(3000);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(verdict.fails ? 1 : 0);
  }
})();
