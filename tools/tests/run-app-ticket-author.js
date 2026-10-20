// run-app-ticket-author.js -- prueba MANUAL (no entra en npm test): un pedido de la APP DE CAMAREROS
// (creado por la API a nombre de "Cintia") no debe quedar a nombre del agente del TPV: el TPV conserva
// userName en sus guardados, las lineas enviadas llevan sentBy "Cintia" y la comanda de cocina se
// imprime con agentLabel "Cintia". Dos TPV reales contra el demo (mesa M3, que deja limpia).
// Impresion simulada. Uso: node tools/tests/run-app-ticket-author.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const kills = [];
const TABLE = "tut-room-1::m3";
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

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 290000);
  const out = {};
  let A, B;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);
    const prep = (X) => X.win.evaluate((TABLE) => {
      window.__saved = { on: localStorage.getItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY), delay: localStorage.getItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY) };
      localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, "1");
      localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "8");
      window.__prints = []; window.__net = []; const __of = window.fetch.bind(window); window.fetch = (u, o) => { const m = String(u && u.url || u).match(/action=([a-z-]+)/); if (m && /parked|mesas-layout/.test(m[1]) && String((o && o.method) || 'GET') !== 'GET') __net.push(Date.now() % 100000 + ' ' + m[1]); return __of(u, o); };
      window.__prints2 = []; printComandaWithContext = async (o) => { __prints2.push({ agentLabel: o.agentLabel || "", dev: !!o.isReturn, lines: (o.lines || []).map((l) => String(l.name).slice(0, 8) + ":" + l.qty) }); __prints.push((o.isReturn ? "DEV " : "") + (o.lines || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",")); return { ok: true }; };
      getConfiguredComandaPrinterForPrint = () => "FAKE";
      window.__prods = products.filter((x) => Number(x.price) > 0);
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); };
      window.__tickets = () => parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).map((t) => ({ items: (t.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(","), impreso: JSON.stringify(t.comandaState?.printedQtyByLineKey ? Object.values(t.comandaState.printedQtyByLineKey) : []) }));
      return { mesas: MESAS_INLINE_ACTIVE, reglas: __mesasComandaRulesLoaded, activa: isAutoComandaOnSaveEnabled() };
    }, TABLE);
    out.modo = [await prep(A), await prep(B)];

    out.limpiezaInicial = await cleanTable(A, B);
    // Un pedido "de la app de camareros" (creado por la API, como hace la app) a nombre de Cintia
    const cfgSrc = require("fs").readFileSync(path.join(ROOT, "config.js"), "utf8");
    const apiKey = (cfgSrc.match(/tpvApiKey:\s*"([^"]+)"/) || [])[1];
    const API = (cfgSrc.match(/https:\/\/plus\.recipok\.com\/tpv\/api\/index\.php/) || [])[0];
    const prods = await A.win.evaluate(() => { const f = (n) => products.find((p) => String(p.name || "").startsWith(n)); const m = (p) => ({ idproducto: p.id, referencia: p.ref || p.referencia || p.name, descripcion: p.name, name: p.name, price: Number(p.price), codimpuesto: p.codimpuesto || null }); const a = products.filter((x) => Number(x.price) > 0); return [m(a[0]), m(a[1])]; });
    const TICKET = "camarero-ZZauthor-" + Date.now();
    const mk = (p, q) => ({ ...p, cantidad: q, qty: q, pvpunitario: p.price, grossPrice: p.price, taxRate: 21, _lineId: "L" + Math.random().toString(36).slice(2, 12), sentBatchAt: new Date().toISOString() });
    const items = [mk(prods[0], 1), mk(prods[1], 2)];
    const total = items.reduce((s, l) => s + l.price * l.qty, 0);
    const body = { slug: "demo", cajaId: "camarero-app-demo", ticketId: TICKET, ticketName: "Sala 1 · M3", obs: "", clientName: "Cliente", codcliente: "1", total, items,
      terminalId: "camarero-app-demo", terminalName: "App camareros", userName: "Cintia", agentName: "Cintia", agentCode: "6", sessionId: "app-zzauthor-1",
      parkingMode: "mesas", modoMesas: 1, modeMesas: 1, mesaUid: TABLE, mesaRoomId: "tut-room-1", mesaRoomName: "Sala 1", mesaTableId: "m3", mesaTableName: "M3",
      codalmacen: "ALG", paid: false, docType: "ticket", pedidoStatus: "pendiente" };
    const post = await fetch(API + "?action=create-parked-reservation", { method: "POST", headers: { "Content-Type": "application/json", "X-TPV-API-KEY": apiKey }, body: JSON.stringify(body) });
    out.app_create_status = post.status;
    out.app_ticket = TICKET;
    await sleep(30000);
    for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(2500);
    const lst = await (await fetch(API + "?action=list-parked-reservations&slug=demo&codalmacen=ALG", { headers: { "X-TPV-API-KEY": apiKey } })).json();
    const srv = (lst.data || []).find((t) => String(t.ticketId || t.id) === TICKET);
    out.servidor = srv ? { userName: srv.userName, total: srv.total, lineas: (srv.items || []).map((l) => ({ n: String(l.name).slice(0, 8), q: l.qty, sentBy: l.sentBy || null, sentPart: l.sentPart || null })) } : "(no esta)";
    // Captura opcional de la mesa abierta en A (TPV_SHOT_DIR=carpeta) para ver como queda en pantalla
    if (process.env.TPV_SHOT_DIR) {
      await A.win.evaluate(() => { __sel(); });
      await sleep(2500);
      await A.win.screenshot({ path: path.join(process.env.TPV_SHOT_DIR, "mesa-pedido-app.png") });
    }
    out.prints_A = await A.win.evaluate(() => __prints2.slice());
    out.prints_B = await B.win.evaluate(() => __prints2.slice());
    out.local_A = await A.win.evaluate((T) => { const t = parkedTickets.find((x) => String(x.id) === T); return t ? { userName: t.userName, agentName: t.agentName, agentCode: t.agentCode } : "(no esta)"; }, TICKET);
    out.OK = !!srv && srv.userName === "Cintia" && (srv.items || []).every((l) => !l.sentBy || l.sentBy === "Cintia") && [...out.prints_A, ...out.prints_B].length >= 1 && [...out.prints_A, ...out.prints_B].every((p) => p.agentLabel === "Cintia");
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A && B) {
        for (const X of [A, B]) {
          await X.win.evaluate(() => {
            if (!window.__saved) return;
            if (window.__saved.on === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, window.__saved.on);
            if (window.__saved.delay === null) localStorage.removeItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY); else localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, window.__saved.delay);
          }).catch(() => {});
        }
        out.limpiezaFinal = await cleanTable(A, B);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(0);
  }
})();
