// run-two-tpv-ops.js -- prueba MANUAL (no entra en npm test) del guardado por operaciones con
// DOS instancias reales del TPV a la vez contra el demo (perfiles persistentes de
// tools/tests/run-two-tpv.js: tpvrecipok-2tpv-real-1/2 en la carpeta temporal, con la sesion ya
// iniciada -- nunca teclea ningun PIN). Usa la mesa M3 del demo y la deja limpia al terminar.
// Escenarios: (3) cambios a la vez en lineas distintas, (4) +1 simultaneo a la misma linea,
// (5) uno quita una linea mientras el otro la edita. Requiere que el servidor tenga
// parked_ops_pilot_slugs_mesas = ['demo'].
// Uso: node tools/tests/run-two-tpv-ops.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
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
    if (!win) await new Promise((r) => setTimeout(r, 500));
  }
  const logs = [];
  win.on("console", (m) => { const t = m.text(); if (/\[OPS\]|CARRITO/.test(t)) logs.push(t.slice(0, 220)); });
  return { app, pid, win, label, logs };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TABLE = "tut-room-1::m3";

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 280000);
  const out = {};
  let A, B, tid = null;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);

    // utilidades dentro de cada pagina
    const prep = (X) => X.win.evaluate((TABLE) => {
      window.__prods = products.filter((x) => Number(x.price) > 0);
      window.__calls = [];
      const of = window.fetch.bind(window);
      window.fetch = (u, o) => {
        const url = String(u && u.url || u); const m = url.match(/action=([a-z-]+)/);
        if (m && /parked-reservation/.test(m[1]) && String((o && o.method) || "GET") !== "GET") {
          let b = ""; try { if (m[1] === "save-parked-reservation-ops") b = ":" + JSON.parse(o.body).ops.map((x) => x.type + (x.lineId ? "[" + String(x.lineId).slice(-4) + "]" : "") + (x.line ? "[" + String(x.line._lineId).slice(-4) + "]" : "") + (x.delta !== undefined ? "(" + x.delta + ")" : "") + (x.fields ? "{" + Object.entries(x.fields).map(([k,v])=>k+"="+JSON.stringify(v)).join("|").slice(0,140) + "}" : "")).join("+"); } catch {}
          window.__calls.push(m[1] + b);
        }
        return of(u, o);
      };
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); };
      window.__state = () => ({
        idx: currentParkedTicketIndex,
        cart: cart.map((c) => String(c.name).slice(0, 8) + ":" + c.qty + "#" + String(c._lineId).slice(-4)),
        calls: window.__calls.slice(),
      });
      return true;
    }, TABLE);
    await prep(A); await prep(B);

    // 1) A elige la mesa M3 y añade un producto: se crea el pedido (guardado entero)
    await A.win.evaluate(() => { __sel(); });
    await sleep(500);
    await A.win.evaluate(async () => { await addToCart(__prods[0]); });
    await sleep(5000);
    const a1 = await A.win.evaluate(() => { const t = parkedTickets.find((x) => x.mesaUid === "tut-room-1::m3" && !x.paid); return { id: t && String(t.id), ...__state() }; });
    tid = a1.id; out.paso1_A = a1;

    // 2) B ve el pedido y abre la mesa
    await B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); __sel(); });
    await sleep(1500);
    out.paso2_B = await B.win.evaluate(() => __state());

    // 3) cambios a la vez en lineas distintas: A añade una linea nueva; B sube la cantidad de la primera y añade otra
    await Promise.all([
      A.win.evaluate(() => { cart.push(buildCartLine(__prods[3], 1)); renderCart(); }),
      B.win.evaluate(() => { const l = cart[0]; updateCartItemQuantity(l._lineId, (Number(l.qty) || 1) + 1); cart.push(buildCartLine(__prods[2], 1)); renderCart(); }),
    ]);
    await sleep(9000);
    await Promise.all([A.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); }), B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); })]);
    await sleep(2500);
    out.paso3_A = await A.win.evaluate(() => __state());
    out.paso3_B = await B.win.evaluate(() => __state());

    // 4) los dos suman +1 a la MISMA linea a la vez
    const first = await A.win.evaluate(() => cart[0]._lineId);
    await Promise.all([
      A.win.evaluate((id) => { const l = cart.find((c) => c._lineId === id); updateCartItemQuantity(id, (Number(l.qty) || 1) + 1); }, first),
      B.win.evaluate((id) => { const l = cart.find((c) => c._lineId === id); if (l) updateCartItemQuantity(id, (Number(l.qty) || 1) + 1); }, first),
    ]);
    await sleep(9000);
    await Promise.all([A.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); }), B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); })]);
    await sleep(2500);
    out.paso4_A = await A.win.evaluate(() => __state());
    out.paso4_B = await B.win.evaluate(() => __state());

    // 5) A quita una linea mientras B edita esa misma linea
    const victim = await A.win.evaluate(() => cart[cart.length - 1]._lineId);
    await Promise.all([
      A.win.evaluate((id) => { updateCartItemQuantity(id, 0, { deleteLine: true }); }, victim),
      B.win.evaluate((id) => { const l = cart.find((c) => c._lineId === id); if (l) updateCartItemQuantity(id, (Number(l.qty) || 1) + 1); }, victim),
    ]);
    await sleep(9000);
    await Promise.all([A.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); }), B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); })]);
    await sleep(2500);
    out.paso5_A = await A.win.evaluate(() => __state());
    out.paso5_B = await B.win.evaluate(() => __state());

    out.logsA = A.logs.slice(0, 12);
    out.logsB = B.logs.slice(0, 12);
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    // limpieza: borrar el pedido de prueba y desvincular la mesa M3 (igual que "Borrar mesa")
    try {
      if (A && tid) {
        out.limpieza = await A.win.evaluate(async (tid) => {
          const t = parkedTickets.find((x) => String(x.id) === String(tid));
          try { if (t) await apiDeleteParkedReservation(t); } catch (e) {}
          const st = loadMesasTablesStateForInline();
          if (st?.tableTicketMap) { delete st.tableTicketMap["tut-room-1::m3"]; }
          if (st?.draftCartByTable) { delete st.draftCartByTable["tut-room-1::m3"]; }
          saveMesasTablesStateForInline(st);
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          return "ok";
        }, tid);
        await sleep(3000);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(0);
  }
})();
