// run-ops-network-failures.js -- prueba (entra en la bateria, nivel full) del guardado ante FALLOS DE RED, con UNA
// instancia real contra el demo (TPV normal). Por defecto con el guardado por operaciones (piloto); con --noops con el
// guardado entero, que es el que usan hoy los clientes. Perfil persistente de
// run-two-tpv.js, sesion ya iniciada (nunca PIN). Simula en la propia pagina (envolviendo fetch):
//   S1  la peticion NO llega al servidor (error de red) y luego se sigue editando -> nada se pierde ni se duplica
//   S2  el servidor APLICA la operacion pero la respuesta se pierde (error de red) y luego se sigue editando
//       -> la operacion no se aplica dos veces (el caso peligroso: un +1 que acabaria siendo +2)
//   S3  respuesta 500 sin aplicar -> se reintenta y converge
// Requiere parked_ops_pilot_slugs_tpv = ['demo'] (sin --noops). Parkea un pedido ZZ y lo borra al terminar.
// (Hallo un fallo real, 2026-11-11: tras la caida la cantidad subia sola por la fusion en 3 vias; arreglado.)
// Uso: node tools/tests/run-ops-network-failures.js [--noops]
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = process.env.TPV_ROOT ? path.resolve(process.env.TPV_ROOT) : path.resolve(__dirname, "..", "..");
const NOOPS = process.argv.includes("--noops");
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

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  const n = out.nombres || [];
  const norm = (...pairs) => pairs.map(([i, q]) => n[i] + ":" + q).sort().join(",");
  const same = (a, b) => String(a) === String(b);
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  ok(NOOPS ? "Modo guardado entero (como los clientes)" : "Modo guardado por partes activo (piloto)", out.modo?.mesas === false && out.modo?.opsTpv === !NOOPS, out.modo);
  ok("Pedido base guardado en el servidor: 1 unidad del producto 1", same(out.inicio, norm([0, 1])), out.inicio);
  const hizoFallos = (k) => (out[k] || []).filter((x) => /^inyectado/.test(x)).length > 0;
  ok("S1 (la petición no llega): el fallo se produjo de verdad y se reintentó", hizoFallos("S1_llamadas") && hizoFallos("S1b_llamadas"), { S1: out.S1_llamadas, S1b: out.S1b_llamadas });
  ok("S1: restablecida la red, el servidor tiene todo (2 uds. + la línea nueva): nada perdido ni duplicado", same(out.S1_servidor, norm([0, 2], [2, 1])), out.S1_servidor);
  ok("S1: el carrito del cajero coincide con el servidor (la cantidad no sube sola)", same(out.S1_carrito, out.S1_servidor), { carrito: out.S1_carrito, servidor: out.S1_servidor });
  ok("S2 (el servidor aplica pero la respuesta se pierde): el fallo se produjo de verdad", hizoFallos("S2_llamadas") && hizoFallos("S2b_llamadas"), { S2: out.S2_llamadas, S2b: out.S2b_llamadas });
  ok("S2: la operación NO se aplica dos veces (3 uds., no 4 ni más) y llegan las líneas nuevas", same(out.S2_servidor, norm([0, 3], [2, 1], [3, 1])), out.S2_servidor);
  ok("S2: el carrito coincide con el servidor", same(out.S2_carrito, out.S2_servidor), { carrito: out.S2_carrito, servidor: out.S2_servidor });
  ok("S3 (el servidor responde 500 sin aplicar): se reintenta y converge (4 uds.)", hizoFallos("S3_llamadas") && same(out.S3_servidor, norm([0, 4], [2, 1], [3, 1])), { llamadas: out.S3_llamadas, servidor: out.S3_servidor });
  ok("S3: el carrito coincide con el servidor al final", same(out.S3_carrito, out.S3_servidor), { carrito: out.S3_carrito, servidor: out.S3_servidor });
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 330000);
  const out = {};
  let A, tid = null;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    await sleep(8000);
    if (NOOPS) await A.win.evaluate(() => { localStorage.setItem("tpv_parkedOpsDisabled", "1"); });
    out.modo = await A.win.evaluate(async (NAME) => {
      await setMesasInlineModeEnabled(false, { persist: false });
      { const seen = new Set(); window.__prods = []; for (const p of products.filter((x) => Number(x.price) > 0 && !x.variants && !isOfferPackProductById(getProductBaseId(x)) && !(getProductAddonsForProduct(x) || []).length && !productHasDerivedStockMarker(x))) { const k = String(p.name).slice(0, 7); if (!seen.has(k)) { seen.add(k); __prods.push(p); } if (__prods.length >= 4) break; } }
      window.__fail = null; // null | "drop" | "lost" | "500"
      window.__calls = [];
      const of = window.fetch.bind(window);
      window.fetch = async (u, o) => {
        const url = String(u && u.url || u);
        if (/action=(save-parked-reservation-ops|create-parked-reservation|update-parked-reservation)(&|$)/.test(url) && window.__fail) {
          const mode = window.__fail; window.__calls.push("inyectado:" + mode);
          if (mode === "drop") throw new TypeError("Failed to fetch");
          if (mode === "lost") { await of(u, o); throw new TypeError("Failed to fetch"); }
          if (mode === "500") return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        if (/action=(create|update)-parked-reservation(&|$)/.test(url)) window.__calls.push("full:ok");
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
    out.nombres = await A.win.evaluate(() => __prods.map((p) => String(p.name).slice(0, 7)));
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
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A && tid) {
        out.limpieza = await A.win.evaluate(async (tid) => {
          __fail = null; try { localStorage.removeItem("tpv_parkedOpsDisabled"); } catch {}
          const t = parkedTickets.find((x) => String(x.id) === String(tid));
          try { if (t) await apiDeleteParkedReservation(t); } catch (e) {}
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
          return "ok";
        }, tid);
        await sleep(2500);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    // Pase lo que pase, el interruptor de "sin guardado por partes" no puede quedarse puesto en el perfil (si no, las pruebas
    // siguientes correrian sin guardado por partes sin avisar): se quita y se vuelca a disco antes de cerrar a la fuerza.
    try { if (A) { await A.win.evaluate(() => { try { localStorage.removeItem("tpv_parkedOpsDisabled"); } catch {} }); await Promise.race([A.app.evaluate(({ session }) => session.defaultSession.flushStorageData()).catch(() => {}), sleep(4000)]); await sleep(1000); } } catch (e) {}
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kill();
    process.exit(verdict.fails ? 1 : 0);
  }
})();
