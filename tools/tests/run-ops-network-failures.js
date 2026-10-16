// run-ops-network-failures.js -- prueba MANUAL (no entra en npm test) del guardado por operaciones
// ante FALLOS DE RED, con UNA instancia real contra el demo (TPV normal). Perfil persistente de
// run-two-tpv.js, sesion ya iniciada (nunca PIN). Simula en la propia pagina (envolviendo fetch):
//   S1  la peticion NO llega al servidor (error de red) y luego se sigue editando -> nada se pierde ni se duplica
//   S2  el servidor APLICA la operacion pero la respuesta se pierde (error de red) y luego se sigue editando
//       -> la operacion no se aplica dos veces (el caso peligroso: un +1 que acabaria siendo +2)
//   S3  respuesta 500 sin aplicar -> se reintenta y converge
// Requiere parked_ops_pilot_slugs_tpv = ['demo']. Parkea un pedido ZZ y lo borra al terminar.
// Uso: node tools/tests/run-ops-network-failures.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const NAME = "ZZ ops red " + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let kill = () => {};

async function launch(dirName, label) {
  const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), dirName), TPV_TEST_LABEL: label };
  delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
  let win = null; const t0 = Date.now();
  while (!win && Date.now() - t0 < 60000) {
    for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
    if (!win) await sleep(500);
  }
  return { app, pid, win };
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 295000);
  const out = {};
  let A, tid = null;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    await sleep(8000);
    out.modo = await A.win.evaluate(async (NAME) => {
      await setMesasInlineModeEnabled(false, { persist: false });
      window.__prods = products.filter((x) => Number(x.price) > 0);
      window.__fail = null; // null | "drop" | "lost" | "500"
      window.__calls = [];
      const of = window.fetch.bind(window);
      window.fetch = async (u, o) => {
        const url = String(u && u.url || u);
        if (/action=save-parked-reservation-ops/.test(url) && window.__fail) {
          const mode = window.__fail; window.__calls.push("ops:" + mode);
          if (mode === "drop") throw new TypeError("Failed to fetch");
          if (mode === "lost") { await of(u, o); throw new TypeError("Failed to fetch"); }
          if (mode === "500") return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        if (/action=save-parked-reservation/.test(url) && !/-ops/.test(url) && String((o && o.method) || "GET") !== "GET") window.__calls.push("full");
        else if (/action=save-parked-reservation-ops/.test(url)) window.__calls.push("ops:ok");
        return of(u, o);
      };
      window.__find = () => parkedTickets.findIndex((t) => !t.paid && String(t.name || "") === NAME);
      // lo que dice de verdad el SERVIDOR (lectura directa, sin pasar por la integracion local)
      window.__server = async () => {
        const slug = getCurrentSlugForReservations();
        const r = await of(`${TPV_SYNC_API_URL}?action=list-parked-reservations&slug=${encodeURIComponent(slug)}&codalmacen=${encodeURIComponent(getCurrentWarehouseCode())}`, { headers: { "X-TPV-API-KEY": getTpvSyncApiKey(), Accept: "application/json" }, cache: "no-store" });
        const j = await r.json();
        const t = (Array.isArray(j?.data) ? j.data : []).find((x) => String(x.ticketName || x.name || "") === NAME);
        return t ? (t.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",") : "(no esta)";
      };
      return { mesas: MESAS_INLINE_ACTIVE, opsTpv: parkedOpsIsEnabled(getCurrentSlugForReservations(), "tpv") };
    }, NAME);
    await sleep(1000);

    // Pedido base: 1 x P0 (guardado entero) y abierto en el carrito
    await A.win.evaluate(async (NAME) => {
      cart = [buildCartLine(__prods[0], 1)]; renderCart();
      await parkCurrentCart(NAME, "", { openListAfterSave: false, skipAutoPrint: true, skipStockConfirm: true, parkingMode: PARKED_MODE_TPV });
    }, NAME);
    await sleep(3000);
    tid = await A.win.evaluate(() => { const i = __find(); const t = parkedTickets[i]; restoreParkedCartByIndex(i); return t && String(t.id); });
    await sleep(2500);
    out.inicio = await A.win.evaluate(() => __server());

    const step = async (label, fail, edit) => {
      await A.win.evaluate((f) => { __fail = f; __calls.length = 0; }, fail);
      await A.win.evaluate(edit);
      await sleep(9000);
      out[label + "_llamadas"] = await A.win.evaluate(() => __calls.slice());
    };
    const settle = async (label) => {
      await A.win.evaluate(() => { __fail = null; });
      await sleep(25000); // cola de reintentos / siguiente autoguardado
      out[label + "_servidor"] = await A.win.evaluate(() => __server());
      out[label + "_carrito"] = await A.win.evaluate(() => cart.map((c) => String(c.name).slice(0, 7) + ":" + c.qty).sort().join(","));
    };

    // S1: la peticion no llega; despues se añade otra linea
    await step("S1", "drop", () => { const l = cart[0]; updateCartItemQuantity(l._lineId, (Number(l.qty) || 1) + 1); });
    await A.win.evaluate(() => { __calls.length = 0; });
    await step("S1b", "drop", () => { cart.push(buildCartLine(__prods[2], 1)); renderCart(); });
    await settle("S1");

    // S2: el servidor aplica pero la respuesta se pierde; despues se añade otra linea
    await step("S2", "lost", () => { const l = cart[0]; updateCartItemQuantity(l._lineId, (Number(l.qty) || 1) + 1); });
    await step("S2b", "lost", () => { cart.push(buildCartLine(__prods[3], 1)); renderCart(); });
    await settle("S2");

    // S3: error 500 sin aplicar
    await step("S3", "500", () => { const l = cart[0]; updateCartItemQuantity(l._lineId, (Number(l.qty) || 1) + 1); });
    await settle("S3");
    out.esperado = "P0 = 1 +1(S1) +1(S2) +1(S3) = 4; P2 x1; P3 x1";
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A && tid) {
        out.limpieza = await A.win.evaluate(async (tid) => {
          __fail = null;
          const t = parkedTickets.find((x) => String(x.id) === String(tid));
          try { if (t) await apiDeleteParkedReservation(t); } catch (e) {}
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
          return "ok";
        }, tid);
        await sleep(2500);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kill();
    process.exit(0);
  }
})();
