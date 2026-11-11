// run-app-writes-vs-tpv-ops.js -- prueba (entra en la bateria, nivel full): como se porta el TPV (con el
// guardado por operaciones activo) cuando la APP DE CAMAREROS escribe el mismo pedido de Modo Mesas
// con el guardado ENTERO de siempre (create-parked-reservation con expectedUpdatedAt). Una sola
// instancia real contra el demo (mesa M3); la "app" se simula con una peticion cruda con otro
// terminal/sin sessionId. Sesion ya iniciada (nunca PIN). Requiere parked_ops_pilot_slugs_mesas=['demo'].
// Escenarios:
//   S1 la app añade una linea nueva SIN _lineId conservando los _lineId de las demas
//   S2 la app reescribe el pedido SIN ningun _lineId (modelo que no conoce el campo) y añade otra linea
//      con solo pvpunitario (sin price/grossPrice/taxRate): el TPV no debe ponerle precio 0
//   S3 la app sube la cantidad de una linea mientras el TPV sube otra (a la vez)
//   S4 la app manda la version vieja (expectedUpdatedAt caducado) -> 412 y no pisa nada
// Uso: node tools/tests/run-app-writes-vs-tpv-ops.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const TABLE = "tut-room-1::m3";
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
  const good = (st) => st === 200 || st === 201;
  const conv = (o, esperado) => o && same(o.servidor, esperado) && same(o.cart, esperado);
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  ok("El TPV está en Modo Mesas con el guardado por partes activo (la app sigue usando el guardado entero)", out.modo?.mesas === true && out.modo?.ops === true, out.modo);
  ok("Base: el pedido de la mesa tiene 2 + 1 unidades y el servidor y el carrito coinciden", conv(out.base, norm([0, 2], [2, 1])), out.base);
  ok("S1: la app añade una línea nueva (conservando los id de las demás): el TPV la recibe sin perder nada", good(out.S1_status) && conv(out.S1, norm([0, 2], [2, 1], [3, 1])), { status: out.S1_status, S1: out.S1 });
  ok("S1: el TPV sube una unidad después y se suma sobre lo de la app (nada perdido)", conv(out.S1_tras_A_sube, norm([0, 3], [2, 1], [3, 1])), out.S1_tras_A_sube);
  ok("S2: la app reescribe el pedido SIN ningún _lineId y añade una línea: el pedido no se vacía ni se duplica", good(out.S2_status) && conv(out.S2, norm([0, 3], [2, 1], [3, 1], [4, 1])), { status: out.S2_status, S2: out.S2 });
  const l = out.S2_linea_de_la_app || {};
  const lc = out.S2_linea_en_carrito || {};
  ok("S2: la línea de la app con solo «pvpunitario» conserva su precio (0,85) en el servidor y en el carrito del TPV: NO se queda a 0 €", Number(l.pvpunitario) === 0.85 && Number(l.grossPrice) === 0.85 && Number(lc.price) === 0.85 && Number(lc.grossPrice) === 0.85, { servidor: l, carrito: lc });
  ok("S2: el TPV sella un identificador estable en esa línea", l.lineId === "si", l);
  ok("S2: el TPV sube una unidad después y todo sigue cuadrando", conv(out.S2_tras_A_sube, norm([0, 4], [2, 1], [3, 1], [4, 1])), out.S2_tras_A_sube);
  ok("S3: la app sube una cantidad y el TPV otra A LA VEZ: se conservan las dos subidas", good(out.S3_status) && conv(out.S3, norm([0, 5], [2, 1], [3, 1], [4, 2])), { status: out.S3_status, S3: out.S3 });
  ok("S4: la app manda una versión caducada: el servidor la rechaza (412) y no pisa nada", out.S4_status === 412 && out.S4_servidor_igual === true, { status: out.S4_status, igual: out.S4_servidor_igual });
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 330000);
  const out = {};
  let A;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    await sleep(8000);
    out.modo = await A.win.evaluate(async (TABLE) => {
      await setMesasInlineModeEnabled(true, { persist: false }); setMesasInlineView("transacciones", { persist: false });
      { const seen = new Set(); window.__prods = []; for (const p of products.filter((x) => Number(x.price) > 0 && !x.variants && !isOfferPackProductById(getProductBaseId(x)) && !(getProductAddonsForProduct(x) || []).length && !productHasDerivedStockMarker(x))) { const k = String(p.name).slice(0, 7); if (!seen.has(k)) { seen.add(k); __prods.push(p); } if (__prods.length >= 6) break; } }
      window.__of = window.fetch.bind(window);
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); };
      window.__cart = () => cart.map((c) => String(c.name).slice(0, 7) + ":" + c.qty).sort().join(",");
      window.__ticket = () => parkedTickets.find((t) => !t.paid && t.mesaUid === TABLE);
      window.__srvRaw = async () => {
        const slug = getCurrentSlugForReservations();
        const r = await __of(`${TPV_SYNC_API_URL}?action=list-parked-reservations&slug=${encodeURIComponent(slug)}&codalmacen=${encodeURIComponent(getCurrentWarehouseCode())}`, { headers: { "X-TPV-API-KEY": getTpvSyncApiKey() }, cache: "no-store" });
        const j = await r.json();
        return (Array.isArray(j?.data) ? j.data : []).find((x) => String(x.ticketId ?? x.id) === String(__ticket()?.id));
      };
      window.__srv = async () => { const s = await __srvRaw(); return s ? (s.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",") : "(no esta)"; };
      // "la app": guardado entero crudo, sin sessionId, con expectedUpdatedAt de la version que leyo
      window.__appSave = async (mutate, opts = {}) => {
        const s = await __srvRaw();
        const t = __ticket();
        const slug = getCurrentSlugForReservations();
        const cajaId = String(t.cajaId || getCajaIdSafe?.() || currentTerminal?.id || "");
        const payload = buildParkedSavePayload(t, slug, cajaId);
        const items = mutate(JSON.parse(JSON.stringify(s.items || [])));
        payload.items = items;
        payload.total = items.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
        payload.terminalId = "camareros-test"; payload.terminalName = "App camareros (prueba)"; delete payload.sessionId;
        payload.expectedUpdatedAt = opts.staleUpdatedAt || s._serverUpdatedAtIso || s.updatedAt;
        const r = await __of(`${TPV_SYNC_API_URL}?action=create-parked-reservation`, { method: "POST", headers: { "Content-Type": "application/json", "X-TPV-API-KEY": getTpvSyncApiKey() }, body: JSON.stringify(payload) });
        return r.status;
      };
      return { mesas: MESAS_INLINE_ACTIVE, ops: parkedOpsIsEnabled(getCurrentSlugForReservations(), "mesas") };
    }, TABLE);

    for (let k = 0; k < 20 && !out.modo.ops; k++) {
      await A.win.evaluate(async () => { try { await refreshRemoteParkedReservationsOnly(); } catch (e) {} });
      await sleep(2000);
      out.modo.ops = await A.win.evaluate(() => parkedOpsIsEnabled(getCurrentSlugForReservations(), "mesas"));
    }
    out.nombres = await A.win.evaluate(() => __prods.map((p) => String(p.name).slice(0, 7)));

    const state = async (label) => {
      await A.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
      await sleep(1500);
      out[label] = { cart: await A.win.evaluate(() => __cart()), servidor: await A.win.evaluate(() => __srv()) };
    };

    // Base: dos lineas (P0 x2, P2 x1)
    await A.win.evaluate(() => { __sel(); });
    await sleep(800);
    await A.win.evaluate(async () => { addToCart(__prods[0]); });
    await sleep(3500);
    await A.win.evaluate(() => { updateCartItemQuantity(cart[0]._lineId, 2); cart.push(buildCartLine(__prods[2], 1)); renderCart(); });
    await sleep(5000);
    await state("base");

    // S1: la app añade una linea nueva sin _lineId (las demas conservan el suyo)
    out.S1_status = await A.win.evaluate((i) => __appSave((items) => { const p = __prods[i]; items.push({ id: p.id, baseProductId: p.baseProductId || p.id, name: p.name, descripcion: p.name, qty: 1, cantidad: 1, price: p.price, grossPrice: p.grossPrice || p.price, taxRate: p.taxRate || 0, codimpuesto: p.codimpuesto || "" }); return items; }), 3);
    await sleep(3000);
    await state("S1");

    // A sube P0 (+1) tras lo de la app: debe sumar sobre lo de la app, sin perder nada
    await A.win.evaluate(() => { const l = cart.find((c) => c.qty >= 2) || cart[0]; updateCartItemQuantity(l._lineId, (Number(l.qty) || 1) + 1); });
    await sleep(6000);
    await state("S1_tras_A_sube");

    // S2: la app reescribe el pedido SIN ningun _lineId y añade otra linea
    out.S2_status = await A.win.evaluate((i) => __appSave((items) => { items.forEach((l) => { delete l._lineId; }); const p = __prods[i]; items.push({ idproducto: p.baseProductId || p.id, name: p.name, referencia: p.name, qty: 1, cantidad: 1, pvpunitario: 0.85 }); return items; }), 4);
    out.S2_servidor_nada_mas_guardar = await A.win.evaluate(() => __srv());
    out.S2_items_crudos = await A.win.evaluate(async () => JSON.stringify(((await __srvRaw()).items || []).map((l) => [String(l.name).slice(0, 6), l.qty, l._lineId ? 'id' : 'sinid'])));
    await sleep(3000);
    await state("S2");
    out.S2_linea_de_la_app = await A.win.evaluate(async () => { const l = ((await __srvRaw()).items || []).find((x) => x.pvpunitario != null || x.name === __prods[4].name); return l ? { pvpunitario: l.pvpunitario, price: l.price, grossPrice: l.grossPrice, lineId: l._lineId ? 'si' : 'no' } : '(no esta)'; });
    out.S2_linea_en_carrito = await A.win.evaluate(() => { const l = cart.find((x) => x.name === __prods[4].name); return l ? { price: Number(l.price), grossPrice: Number(l.grossPrice), qty: l.qty } : "(no esta)"; });
    await A.win.evaluate(() => { const l = cart[0]; updateCartItemQuantity(l._lineId, (Number(l.qty) || 1) + 1); });
    await sleep(6000);
    await state("S2_tras_A_sube");

    // S3: a la vez, la app sube una cantidad (guardado entero con la version que leyo) y el TPV sube otra
    const first = await A.win.evaluate(() => cart[0].name);
    const [st3] = await Promise.all([
      A.win.evaluate((nm) => __appSave((items) => { const l = items.find((x) => x.name === nm); if (l) { l.qty = (Number(l.qty) || 1) + 1; l.cantidad = l.qty; } return items; }), first),
      (async () => { await sleep(150); await A.win.evaluate(() => { const l = cart[cart.length - 1]; updateCartItemQuantity(l._lineId, (Number(l.qty) || 1) + 1); }); })(),
    ]);
    out.S3_status = st3;
    await sleep(7000);
    await state("S3");

    // S4: la app manda una version caducada -> 412 y el pedido no cambia
    const before = await A.win.evaluate(() => __srv());
    out.S4_status = await A.win.evaluate((i) => __appSave((items) => { items.splice(0, items.length); return items; }, { staleUpdatedAt: "2020-01-01T00:00:00Z" }), 0);
    await sleep(1500);
    out.S4_servidor_igual = (await A.win.evaluate(() => __srv())) === before;
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A) {
        out.limpieza = await A.win.evaluate(async (TABLE) => {
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
          let n = 0;
          for (const t of parkedTickets.filter((x) => !x.paid && x.mesaUid === TABLE)) { try { markParkedTicketAsDeleted(t); await apiDeleteParkedReservation(t); n++; } catch (e) {} }
          parkedTickets = parkedTickets.filter((x) => !(x.mesaUid === TABLE && !x.paid));
          saveParkedTicketsCache(parkedTickets);
          const st = loadMesasTablesStateForInline();
          if (st?.tableTicketMap) delete st.tableTicketMap[TABLE];
          if (st?.draftCartByTable) delete st.draftCartByTable[TABLE];
          saveMesasTablesStateForInline(st);
          persistRuntimeCartSnapshot({ force: true });
          return "borrados " + n;
        }, TABLE);
        await sleep(3000);
        await Promise.race([A.app.evaluate(({ session }) => session.defaultSession.flushStorageData()).catch(() => {}), sleep(4000)]);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kill();
    process.exit(verdict.fails ? 1 : 0);
  }
})();
