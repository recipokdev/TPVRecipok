// run-two-tpv-ops.js -- prueba (entra en la bateria, nivel full) del guardado por operaciones con DOS instancias reales del TPV a la vez
// contra el demo (perfiles persistentes de tools/tests/run-two-tpv.js: tpvrecipok-2tpv-real-1/2 en la carpeta temporal, con la sesion ya
// iniciada -- nunca teclea ningun PIN). Por defecto en Modo Mesas (mesa M3 del demo, que deja limpia); con --normal en TPV normal
// (pedido aparcado de prueba, que borra). Requiere que el servidor tenga parked_ops_pilot_slugs_mesas / _tpv = ['demo'].
// Escenarios: (3) cambios a la vez en lineas distintas, (4) +1 simultaneo a la misma linea, (5) uno quita una linea mientras el otro
// la edita. En todos los pasos los dos TPV y el servidor deben acabar con LO MISMO y sin duplicar el pedido.
// Uso: node tools/tests/run-two-tpv-ops.js [--normal]
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const kills = [];
const NORMAL = process.argv.includes("--normal");
const TABLE = "tut-room-1::m3";
const NAME = "ZZ ops normal " + Date.now();
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

// Deja la mesa M3 limpia en servidor (A borra) y en la copia local de CADA instancia (sin guardar nada)
async function cleanTable(A, B) {
  const del = await A.win.evaluate(async (TABLE) => {
    cart = []; setCurrentParkedTicketIndex(null); renderCart();
    let n = 0;
    try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
    for (const t of parkedTickets.filter((x) => !x.paid && x.mesaUid === TABLE)) { try { markParkedTicketAsDeleted(t); await apiDeleteParkedReservation(t); n++; } catch (e) {} }
    parkedTickets = parkedTickets.filter((x) => !(x.mesaUid === TABLE && !x.paid));
    saveParkedTicketsCache(parkedTickets);
    const st = loadMesasTablesStateForInline();
    if (st?.tableTicketMap) delete st.tableTicketMap[TABLE];
    if (st?.draftCartByTable) delete st.draftCartByTable[TABLE];
    saveMesasTablesStateForInline(st);
    return n;
  }, TABLE);
  await sleep(3000);
  // B olvida su copia local del pedido (si no, lo volveria a subir al servidor)
  await B.win.evaluate((TABLE) => {
    cart = []; setCurrentParkedTicketIndex(null);
    parkedTickets = parkedTickets.filter((x) => !(x.mesaUid === TABLE && !x.paid));
    try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
    saveParkedTicketsCache(parkedTickets);
    renderCart();
  }, TABLE);
  // B recibe el plano YA limpio de A y, por si acaso, quita tambien su vinculo/borrador de la mesa
  // (un borrador con contenido en la copia de B volvia a crear el pedido fantasma).
  await B.win.evaluate(async (TABLE) => {
    try { await refreshMesasLayoutFromRemote(); } catch (e) {}
    const st = loadMesasTablesStateForInline();
    if (st?.tableTicketMap?.[TABLE] !== undefined || st?.draftCartByTable?.[TABLE] !== undefined) {
      if (st.tableTicketMap) delete st.tableTicketMap[TABLE];
      if (st.draftCartByTable) delete st.draftCartByTable[TABLE];
      saveMesasTablesStateForInline(st);
    }
  }, TABLE);
  await sleep(2500);
  await A.win.evaluate(async () => { try { await refreshMesasLayoutFromRemote(); } catch (e) {} });
  await sleep(2500);
  // La copia de seguridad del carrito (recuperacion tras cierre inesperado) tambien debe quedar vacia:
  // si no, al volver a abrir la instancia recrea el pedido fantasma de la mesa.
  for (const X of [A, B]) {
    await X.win.evaluate(() => { cart = []; setCurrentParkedTicketIndex(null); renderCart(); persistRuntimeCartSnapshot({ force: true }); }).catch(() => {});
  }
  await sleep(3000);
  // Las instancias se cierran a la fuerza: se pide a Electron que vuelque el almacenamiento a disco
  // para que lo limpio no se pierda.
  for (const X of [A, B]) {
    await Promise.race([X.app.evaluate(({ session }) => session.defaultSession.flushStorageData()).catch(() => {}), sleep(4000)]);
  }
  return del;
}

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  const n = out.nombres || [];
  const norm = (...pairs) => pairs.map(([i, q]) => n[i] + ":" + q).sort().join(",");
  // todos los estados (carrito de A y B + servidor) iguales al esperado y un solo pedido
  const todoIgual = (k, esperado) => {
    const A = out[k + "_A"] || {}, B = out[k + "_B"] || {};
    return A.cart === esperado && B.cart === esperado && A.srv === esperado && B.srv === esperado && A.pedidos === 1 && B.pedidos === 1;
  };
  const resumen = (k) => ({ A: out[k + "_A"], B: out[k + "_B"] });
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  const m = out.modo || [];
  ok(NORMAL ? "Los dos TPV están en TPV normal con el guardado por partes activo (piloto)" : "Los dos TPV están en Modo Mesas con el guardado por partes activo (piloto)",
    m.length === 2 && m.every((x) => x.mesas === !NORMAL && x.ops === true), m);
  ok("Paso 1: A crea el pedido con 1 producto y queda guardado en el servidor", (NORMAL || out.paso1_A?.cart === norm([0, 1])) && out.paso1_A?.srv === norm([0, 1]) && out.paso1_A?.pedidos === 1, out.paso1_A);
  ok("Paso 2: B abre el pedido y ve el mismo producto", out.paso2_B?.cart === norm([0, 1]), out.paso2_B);
  const e3 = norm([0, 2], [2, 1], [3, 1]);
  ok("Paso 3 (a la vez: A añade una línea nueva, B sube la primera y añade otra): se conserva todo en A, en B y en el servidor, sin duplicar el pedido", todoIgual("paso3", e3), { esperado: e3, ...resumen("paso3") });
  const e4 = norm([0, 4], [2, 1], [3, 1]);
  ok("Paso 4 (los dos suman +1 a la MISMA línea a la vez): se suman las dos subidas (2 + 1 + 1 = 4), igual en todos", todoIgual("paso4", e4), { esperado: e4, ...resumen("paso4") });
  // paso 5: la linea que A quita desaparece (aunque B la editara a la vez) y lo demas queda igual
  const victim = out.victim;
  const quedan = [[0, 4], [2, 1], [3, 1]].filter(([i]) => n[i] !== victim);
  const e5 = norm(...quedan);
  ok("Paso 5 (A quita una línea mientras B la edita): la línea quitada sigue quitada en todos y no se pierde ninguna otra", quedan.length === 2 && todoIgual("paso5", e5), { quitada: victim, esperado: e5, ...resumen("paso5") });
  const llamadas = [].concat(out.llamadasA || [], out.llamadasB || []);
  ok("Se usó de verdad el guardado por partes (peticiones save-parked-reservation-ops)", llamadas.some((x) => /^save-parked-reservation-ops/.test(x)), { n: llamadas.length, ops: llamadas.filter((x) => /ops/.test(x)).length });
  ok("La limpieza dejó el pedido/mesa sin restos", out.limpieza === "ok", out.limpieza);
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 330000);
  const out = {};
  let A, B, tid = null;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);

    // utilidades dentro de cada pagina
    const prep = (X) => X.win.evaluate(async (P) => {
      await setMesasInlineModeEnabled(!P.NORMAL, { persist: false });
      if (!P.NORMAL) setMesasInlineView("transacciones", { persist: false });
      // productos sin ventanas propias (variantes/packs/añadidos/stock derivado) y con nombres distintos en los 7 primeros caracteres
      const seen = new Set(); window.__prods = [];
      for (const p of products.filter((x) => Number(x.price) > 0 && !x.variants && !isOfferPackProductById(getProductBaseId(x)) && !(getProductAddonsForProduct(x) || []).length && !productHasDerivedStockMarker(x))) { const k = String(p.name).slice(0, 7); if (!seen.has(k)) { seen.add(k); __prods.push(p); } if (__prods.length >= 4) break; }
      // la comanda automatica del perfil (a veces a 8 s) imprimiria/marcaria como enviadas las lineas: se apaga y se simula la impresora
      window.__saved = { on: localStorage.getItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY) };
      localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, "0");
      printComandaWithContext = async () => ({ ok: true });
      window.__calls = [];
      const of = window.fetch.bind(window);
      window.fetch = (u, o) => {
        const m = String(u && u.url || u).match(/action=([a-z-]+)/);
        if (m && /parked-reservation/.test(m[1]) && String((o && o.method) || "GET") !== "GET") window.__calls.push(m[1]);
        return of(u, o);
      };
      const mine = (t) => !t.paid && (P.NORMAL ? String(t.name || "") === P.NAME : t.mesaUid === P.TABLE);
      window.__find = () => parkedTickets.findIndex(mine);
      window.__open = () => { const i = window.__find(); if (i >= 0) restoreParkedCartByIndex(i); return i; };
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: P.TABLE }); syncTpvCartWithSelectedMesa(); };
      const agg = (arr) => { const mm = {}; for (const l of arr || []) { const k = String(l.name).slice(0, 7); mm[k] = (mm[k] || 0) + (Number(l.qty) || 0); } return Object.entries(mm).map(([k, v]) => k + ":" + v).sort().join(","); };
      window.__state = () => { const t = parkedTickets[__find()]; return { idx: currentParkedTicketIndex, cart: agg(cart), srv: t ? agg(t.items) : "(no hay pedido)", pedidos: parkedTickets.filter(mine).length, id: t ? String(t.id) : null }; };
      return true;
    }, { NORMAL, TABLE, NAME });
    await prep(A); await prep(B);
    // el guardado por partes se aprende del servidor al arrancar: esperar y leerlo
    await sleep(6000);
    const flags = (X) => X.win.evaluate((P) => ({ mesas: MESAS_INLINE_ACTIVE, ops: parkedOpsIsEnabled(getCurrentSlugForReservations(), P.NORMAL ? "tpv" : "mesas") }), { NORMAL });
    out.modo = [await flags(A), await flags(B)];
    out.nombres = await A.win.evaluate(() => __prods.map((p) => String(p.name).slice(0, 7)));
    if (!NORMAL) {
      // La prueba anterior (otra suite sobre la misma mesa) puede dejar un guardado tardio que "resucita" el pedido justo
      // despues de su limpieza: se limpia y se vuelve a mirar hasta que la mesa y los dos carritos estan vacios.
      out.limpiezaInicial = 0;
      for (let pasada = 0; pasada < 4; pasada++) {
        out.limpiezaInicial += await cleanTable(A, B);
        await sleep(6000);
        const resto = await Promise.all([A, B].map((X) => X.win.evaluate((T) => ({ cart: cart.length, pedidos: parkedTickets.filter((t) => !t.paid && t.mesaUid === T).length }), TABLE).catch(() => ({ cart: -1, pedidos: -1 }))));
        out.restoInicial = resto;
        if (resto.every((r) => r.cart === 0 && r.pedidos === 0)) break;
      }
    }
    if (out.nombres.length < 4) throw new Error("No hay 4 productos sencillos en el demo");
    const both = (fn, ...a) => Promise.all([A.win.evaluate(fn, ...a), B.win.evaluate(fn, ...a)]);
    const refresh = async () => { await both(async () => { await refreshRemoteParkedReservationsOnly(); }); };
    const stateOf = async (k) => { out[k + "_A"] = await A.win.evaluate(() => __state()); out[k + "_B"] = await B.win.evaluate(() => __state()); };

    // 1) A crea el pedido (guardado entero la 1a vez)
    if (NORMAL) {
      await A.win.evaluate(async (NAME) => {
        cart = [buildCartLine(__prods[0], 1)]; renderCart();
        await parkCurrentCart(NAME, "", { openListAfterSave: false, skipAutoPrint: true, skipStockConfirm: true, parkingMode: PARKED_MODE_TPV });
      }, NAME);
      await sleep(3000);
    } else {
      await A.win.evaluate(() => { __sel(); });
      await sleep(500);
      await A.win.evaluate(() => { addToCart(__prods[0]); });
      await sleep(5000);
    }
    out.paso1_A = await A.win.evaluate(() => __state());
    tid = out.paso1_A.id;

    // 2) B ve el pedido y lo abre
    if (NORMAL) {
      await A.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); __open(); });
      await B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); __open(); });
    } else {
      await B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); __sel(); });
    }
    await sleep(1500);
    out.paso2_B = await B.win.evaluate(() => __state());

    // 3) cambios a la vez en lineas distintas: A añade una linea nueva; B sube la cantidad de la primera y añade otra
    await Promise.all([
      A.win.evaluate(() => { cart.push(buildCartLine(__prods[3], 1)); renderCart(); }),
      B.win.evaluate(() => { const l = cart[0]; updateCartItemQuantity(l._lineId, (Number(l.qty) || 1) + 1); cart.push(buildCartLine(__prods[2], 1)); renderCart(); }),
    ]);
    await sleep(9000); await refresh(); await sleep(2500);
    await stateOf("paso3");

    // 4) los dos suman +1 a la MISMA linea a la vez
    const first = await A.win.evaluate(() => cart[0]._lineId);
    await Promise.all([
      A.win.evaluate((id) => { const l = cart.find((c) => c._lineId === id); if (l) updateCartItemQuantity(id, (Number(l.qty) || 1) + 1); }, first),
      B.win.evaluate((id) => { const l = cart.find((c) => c._lineId === id); if (l) updateCartItemQuantity(id, (Number(l.qty) || 1) + 1); }, first),
    ]);
    await sleep(9000); await refresh(); await sleep(2500);
    await stateOf("paso4");

    // 5) A quita una linea mientras B edita esa misma linea
    const v = await A.win.evaluate(() => { const l = cart[cart.length - 1]; return { id: l._lineId, nombre: String(l.name).slice(0, 7) }; });
    out.victim = v.nombre;
    await Promise.all([
      A.win.evaluate((id) => { updateCartItemQuantity(id, 0, { deleteLine: true }); }, v.id),
      B.win.evaluate((id) => { const l = cart.find((c) => c._lineId === id); if (l) updateCartItemQuantity(id, (Number(l.qty) || 1) + 1); }, v.id),
    ]);
    await sleep(9000); await refresh(); await sleep(2500);
    await stateOf("paso5");
    out.llamadasA = await A.win.evaluate(() => window.__calls.slice());
    out.llamadasB = await B.win.evaluate(() => window.__calls.slice());
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    // limpieza: borrar el pedido de prueba (y desvincular la mesa M3, igual que "Borrar mesa")
    try {
      if (A && B) for (const X of [A, B]) await X.win.evaluate(() => { if (!window.__saved) return; if (window.__saved.on === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, window.__saved.on); }).catch(() => {});
      if (A) {
        out.limpieza = await A.win.evaluate(async (P) => {
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          const mine = parkedTickets.filter((t) => !t.paid && (P.NORMAL ? String(t.name || "") === P.NAME : t.mesaUid === P.TABLE));
          for (const t of mine) { try { await apiDeleteParkedReservation(t); } catch (e) {} }
          if (!P.NORMAL) {
            const st = loadMesasTablesStateForInline();
            if (st?.tableTicketMap) delete st.tableTicketMap[P.TABLE];
            if (st?.draftCartByTable) delete st.draftCartByTable[P.TABLE];
            saveMesasTablesStateForInline(st);
          }
          return "ok";
        }, { NORMAL, TABLE, NAME });
        if (!NORMAL) await cleanTable(A, B);
        else await sleep(3000);
        for (const X of [A, B]) await Promise.race([X.app.evaluate(({ session }) => session.defaultSession.flushStorageData()).catch(() => {}), sleep(4000)]);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(verdict.fails ? 1 : 0);
  }
})();
