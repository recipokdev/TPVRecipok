// run-two-tpv-ops-normal.js -- prueba MANUAL (no entra en npm test) del guardado por operaciones
// en TPV NORMAL (aparcados) con DOS instancias reales a la vez contra el demo. Misma idea que
// run-two-tpv-ops.js (Modo Mesas). Los perfiles son los persistentes de run-two-tpv.js, con la
// sesion ya iniciada (nunca teclea PIN). Cambia las dos instancias a TPV normal SIN guardar ese
// modo en su perfil, aparca un pedido de prueba y lo borra al terminar.
// Requiere parked_ops_pilot_slugs_tpv = ['demo'] en el servidor.
// Uso: node tools/tests/run-two-tpv-ops-normal.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const kills = [];
const NAME = "ZZ ops normal " + Date.now();

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

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 290000);
  const out = {};
  let A, B, tid = null;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);

    const prep = (X) => X.win.evaluate(async (NAME) => {
      await setMesasInlineModeEnabled(false, { persist: false });
      window.__prods = products.filter((x) => Number(x.price) > 0);
      window.__calls = [];
      const of = window.fetch.bind(window);
      window.fetch = (u, o) => {
        const url = String(u && u.url || u); const m = url.match(/action=([a-z-]+)/);
        if (m && /parked-reservation/.test(m[1]) && String((o && o.method) || "GET") !== "GET") {
          let b = ""; try { if (m[1] === "save-parked-reservation-ops") b = ":" + JSON.parse(o.body).ops.map((x) => x.type + (x.lineId ? "[" + String(x.lineId).slice(-4) + "]" : "") + (x.line ? "[" + String(x.line._lineId).slice(-4) + "]" : "") + (x.delta !== undefined ? "(" + x.delta + ")" : "")).join("+"); } catch {}
          window.__calls.push(m[1] + b);
        }
        return of(u, o);
      };
      window.__find = () => parkedTickets.findIndex((t) => !t.paid && String(t.name || "") === NAME);
      window.__open = () => { const i = window.__find(); if (i >= 0) restoreParkedCartByIndex(i); return i; };
      window.__state = () => ({
        mesas: MESAS_INLINE_ACTIVE,
        idx: currentParkedTicketIndex,
        cart: cart.map((c) => String(c.name).slice(0, 8) + ":" + c.qty + "#" + String(c._lineId).slice(-4)),
        calls: window.__calls.slice(),
      });
      return { mesas: MESAS_INLINE_ACTIVE, opsTpv: parkedOpsIsEnabled(getCurrentSlugForReservations(), "tpv") };
    }, NAME);
    out.modoA = await prep(A); out.modoB = await prep(B);
    await sleep(1500);

    // 1) A aparca un pedido de prueba (guardado entero)
    await A.win.evaluate(async (NAME) => {
      cart = [buildCartLine(__prods[0], 1)]; renderCart();
      await parkCurrentCart(NAME, "", { openListAfterSave: false, skipAutoPrint: true, skipStockConfirm: true, parkingMode: PARKED_MODE_TPV });
    }, NAME);
    await sleep(3000);
    out.paso1_A = await A.win.evaluate(() => { const t = parkedTickets[window.__find()]; return { id: t && String(t.id), ...window.__state() }; });
    tid = out.paso1_A.id;

    // 2) los dos abren el pedido desde la lista de aparcados
    await A.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); window.__open(); });
    await B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); window.__open(); });
    await sleep(1500);
    out.paso2_A = await A.win.evaluate(() => window.__state());
    out.paso2_B = await B.win.evaluate(() => window.__state());

    // 3) cambios a la vez en lineas distintas
    await Promise.all([
      A.win.evaluate(() => { cart.push(buildCartLine(__prods[3], 1)); renderCart(); }),
      B.win.evaluate(() => { const l = cart[0]; updateCartItemQuantity(l._lineId, (Number(l.qty) || 1) + 1); cart.push(buildCartLine(__prods[2], 1)); renderCart(); }),
    ]);
    await sleep(9000);
    await Promise.all([A.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); }), B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); })]);
    await sleep(2500);
    out.paso3_A = await A.win.evaluate(() => window.__state());
    out.paso3_B = await B.win.evaluate(() => window.__state());

    // 4) +1 simultaneo a la misma linea
    const first = await A.win.evaluate(() => cart[0]._lineId);
    await Promise.all([
      A.win.evaluate((id) => { const l = cart.find((c) => c._lineId === id); updateCartItemQuantity(id, (Number(l.qty) || 1) + 1); }, first),
      B.win.evaluate((id) => { const l = cart.find((c) => c._lineId === id); if (l) updateCartItemQuantity(id, (Number(l.qty) || 1) + 1); }, first),
    ]);
    await sleep(9000);
    await Promise.all([A.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); }), B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); })]);
    await sleep(2500);
    out.paso4_A = await A.win.evaluate(() => window.__state());
    out.paso4_B = await B.win.evaluate(() => window.__state());

    // 5) A quita una linea mientras B la edita
    const victim = await A.win.evaluate(() => cart[cart.length - 1]._lineId);
    await Promise.all([
      A.win.evaluate((id) => { updateCartItemQuantity(id, 0, { deleteLine: true }); }, victim),
      B.win.evaluate((id) => { const l = cart.find((c) => c._lineId === id); if (l) updateCartItemQuantity(id, (Number(l.qty) || 1) + 1); }, victim),
    ]);
    await sleep(9000);
    await Promise.all([A.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); }), B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); })]);
    await sleep(2500);
    out.paso5_A = await A.win.evaluate(() => window.__state());
    out.paso5_B = await B.win.evaluate(() => window.__state());
    out.logsB = B.logs.slice(0, 8);
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A && tid) {
        out.limpieza = await A.win.evaluate(async (tid) => {
          const t = parkedTickets.find((x) => String(x.id) === String(tid));
          try { if (t) await apiDeleteParkedReservation(t); } catch (e) {}
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          return "ok";
        }, tid);
        await sleep(2500);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(0);
  }
})();
