// run-app-writes-vs-tpv-ops.js -- prueba MANUAL (no entra en npm test): como se porta el TPV (con el
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
// Uso: node tools/tests/run-app-writes-vs-tpv-ops.js   (despues: node tools/tests/two-tpv-clean-m3.js)
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

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 280000);
  const out = {};
  let A;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    await sleep(8000);
    out.modo = await A.win.evaluate((TABLE) => {
      window.__prods = products.filter((x) => Number(x.price) > 0);
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

    const state = async (label) => {
      await A.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
      await sleep(1500);
      out[label] = { cart: await A.win.evaluate(() => __cart()), servidor: await A.win.evaluate(() => __srv()) };
    };

    // Base: dos lineas (P0 x2, P2 x1)
    await A.win.evaluate(() => { __sel(); });
    await sleep(800);
    await A.win.evaluate(async () => { await addToCart(__prods[0]); });
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
    clearTimeout(hard);
    kill();
    process.exit(0);
  }
})();
