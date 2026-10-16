// run-two-tpv-move-merge.js -- prueba MANUAL (no entra en npm test) de CAMBIAR DE MESA y FUSIONAR
// MESAS con DOS TPV reales a la vez contra el demo (mesas M1 y M3, que deja limpias). Perfiles
// persistentes de run-two-tpv.js, sesion ya iniciada (nunca PIN). Requiere
// parked_ops_pilot_slugs_mesas = ['demo'].
// Escenario:
//   1) A crea un pedido en M3 y B abre M3.
//   2) A CAMBIA el pedido de M3 a M1 (moveMesaPendingTicket): en el servidor el pedido debe quedar en
//      M1 (no en M3); B ve M3 libre y NO resucita el pedido; B abre un pedido nuevo en M3.
//   3) A FUSIONA M3 (pedido de B) en M1: un solo pedido en M1 con todo, ninguno en M3; B queda con M3
//      libre (no resucita lo fusionado).
// Uso: node tools/tests/run-two-tpv-move-merge.js   (despues: node tools/tests/two-tpv-clean-m3.js)
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const kills = [];
const M3 = "tut-room-1::m3";
const M1 = "tut-room-1::m1";
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

// Deja M1 y M3 limpias: servidor (A borra), copia local de A y B, plano compartido y copia de seguridad del carrito
async function cleanTables(A, B) {
  const tables = [M1, M3];
  const del = await A.win.evaluate(async (tables) => {
    cart = []; setCurrentParkedTicketIndex(null); renderCart();
    try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
    let n = 0;
    for (const t of parkedTickets.filter((x) => !x.paid && tables.includes(x.mesaUid))) { try { markParkedTicketAsDeleted(t); await apiDeleteParkedReservation(t); n++; } catch (e) {} }
    parkedTickets = parkedTickets.filter((x) => !(tables.includes(x.mesaUid) && !x.paid));
    saveParkedTicketsCache(parkedTickets);
    const st = loadMesasTablesStateForInline();
    tables.forEach((T) => { if (st?.tableTicketMap) delete st.tableTicketMap[T]; if (st?.draftCartByTable) delete st.draftCartByTable[T]; });
    saveMesasTablesStateForInline(st);
    return n;
  }, tables);
  await sleep(3000);
  await B.win.evaluate(async (tables) => {
    cart = []; setCurrentParkedTicketIndex(null);
    parkedTickets = parkedTickets.filter((x) => !(tables.includes(x.mesaUid) && !x.paid));
    try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
    saveParkedTicketsCache(parkedTickets);
    renderCart();
    try { await refreshMesasLayoutFromRemote(); } catch (e) {}
    const st = loadMesasTablesStateForInline();
    let dirty = false;
    tables.forEach((T) => { if (st?.tableTicketMap?.[T] !== undefined || st?.draftCartByTable?.[T] !== undefined) { dirty = true; delete st.tableTicketMap?.[T]; delete st.draftCartByTable?.[T]; } });
    if (dirty) saveMesasTablesStateForInline(st);
  }, tables);
  await sleep(2500);
  await A.win.evaluate(async () => { try { await refreshMesasLayoutFromRemote(); } catch (e) {} });
  await sleep(2500);
  for (const X of [A, B]) {
    await X.win.evaluate(() => { cart = []; setCurrentParkedTicketIndex(null); renderCart(); persistRuntimeCartSnapshot({ force: true }); }).catch(() => {});
  }
  await sleep(3000);
  for (const X of [A, B]) {
    await Promise.race([X.app.evaluate(({ session }) => session.defaultSession.flushStorageData()).catch(() => {}), sleep(4000)]);
  }
  return del;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 290000);
  const out = {};
  let A, B;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);
    const prep = (X) => X.win.evaluate(([M1, M3]) => {
      window.__prods = products.filter((x) => Number(x.price) > 0);
      window.__of = window.fetch.bind(window);
      window.__sel = (u) => { updateMesasSelectionFromContext({ tableUid: u }); syncTpvCartWithSelectedMesa(); };
      window.__cart = () => cart.map((c) => String(c.name).slice(0, 7) + ":" + c.qty).sort().join(",");
      // pedidos NO cobrados de M1/M3 segun el SERVIDOR (lectura directa)
      window.__srv = async () => {
        const r = await __of(`${TPV_SYNC_API_URL}?action=list-parked-reservations&slug=${encodeURIComponent(getCurrentSlugForReservations())}&codalmacen=${encodeURIComponent(getCurrentWarehouseCode())}`, { headers: { "X-TPV-API-KEY": getTpvSyncApiKey() }, cache: "no-store" });
        const j = await r.json();
        return (Array.isArray(j?.data) ? j.data : []).filter((x) => !x.paid && [M1, M3].includes(String(x.mesaUid || ""))).map((x) => ({ mesa: String(x.mesaUid).slice(-2), tabla: x.mesaTableName, items: (x.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",") })).sort((a, b) => a.mesa.localeCompare(b.mesa));
      };
      // pedidos de M1/M3 segun la copia LOCAL de este TPV
      window.__loc = () => parkedTickets.filter((t) => !t.paid && [M1, M3].includes(t.mesaUid)).map((t) => ({ mesa: String(t.mesaUid).slice(-2), items: (t.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",") })).sort((a, b) => a.mesa.localeCompare(b.mesa));
      return { mesas: MESAS_INLINE_ACTIVE, ops: parkedOpsIsEnabled(getCurrentSlugForReservations(), "mesas") };
    }, [M1, M3]);
    out.modo = [await prep(A), await prep(B)];
    out.limpiezaInicial = await cleanTables(A, B);

    // 1) A crea el pedido en M3; B abre M3
    await A.win.evaluate((M3) => { __sel(M3); }, M3);
    await B.win.evaluate((M3) => { __sel(M3); }, M3);
    await sleep(800);
    await A.win.evaluate(async () => { await addToCart(__prods[0]); });
    await sleep(3500);
    await A.win.evaluate(() => { cart.push(buildCartLine(__prods[2], 1)); renderCart(); });
    await sleep(4500);
    await B.win.evaluate(async (M3) => { await refreshRemoteParkedReservationsOnly(); __sel(M3); }, M3);
    await sleep(1500);
    out.paso1 = { A_cart: await A.win.evaluate(() => __cart()), B_cart: await B.win.evaluate(() => __cart()), servidor: await A.win.evaluate(() => __srv()) };

    // 2) A cambia el pedido de M3 a M1
    out.paso2_resultado = await A.win.evaluate(([M1, M3]) => moveMesaPendingTicket(M3, M1), [M1, M3]);
    await sleep(7000);
    for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(2500);
    out.paso2 = {
      servidor: await A.win.evaluate(() => __srv()),
      A_local: await A.win.evaluate(() => __loc()), B_local: await B.win.evaluate(() => __loc()),
      B_cart_en_M3: await B.win.evaluate(() => __cart()),
    };

    // B (en M3, ya libre) abre un pedido nuevo con otro producto
    await B.win.evaluate(async () => { await addToCart(__prods[3]); });
    await sleep(5000);
    out.paso2b = { servidor: await A.win.evaluate(() => __srv()), B_cart: await B.win.evaluate(() => __cart()) };

    // 3) A fusiona M3 (pedido de B) en M1
    for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(1500);
    out.paso3_resultado = await A.win.evaluate(async ([M1, M3]) => { __sel(M3); return await mergeMesaPendingTickets(M3, M1); }, [M1, M3]);
    await sleep(8000);
    for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(3000);
    out.paso3 = {
      servidor: await A.win.evaluate(() => __srv()),
      A_local: await A.win.evaluate(() => __loc()), B_local: await B.win.evaluate(() => __loc()),
      B_cart: await B.win.evaluate(() => __cart()),
    };
    await sleep(12000); // por si B resucita algo con su autoguardado
    out.paso3_despues = { servidor: await A.win.evaluate(() => __srv()), B_cart: await B.win.evaluate(() => __cart()) };
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try { if (A && B) out.limpiezaFinal = await cleanTables(A, B); } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(0);
  }
})();
