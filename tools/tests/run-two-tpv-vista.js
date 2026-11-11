// run-two-tpv-vista.js -- prueba (entra en la bateria, nivel full): dos TPV reales en la MISMA mesa del
// demo (M3) -- compara lo que muestra cada uno (flecha deshacer, barra "Enviar comanda" y contador)
// al añadir/subir productos en A, y comprueba que los dos ven lo mismo. Con TPV_SHOT_DIR hace capturas. Comanda automatica a 15 min
// (no sale nada a cocina) e impresion simulada. Deja la mesa limpia.
// Uso: TPV_SHOT_DIR=carpeta node tools/tests/run-two-tpv-vista.js
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

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  const n = out.nombre;
  const q = (v) => n + ":" + v;
  const P = (k) => out["paso_" + k] || { A: {}, B: {} };
  const oculto = (t) => t === "(oculto)" || t === undefined;
  const mismoPedido = (p) => (p.A.tickets || []).length === 1 && (p.B.tickets || []).length === 1 && p.A.tickets[0] === p.B.tickets[0];
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  ok("Los dos TPV están en Modo Mesas con la comanda automática activa", (out.modo || []).length === 2 && out.modo.every((m) => m.mesas && m.activa), out.modo);
  const p0 = P("0-mesa-vacia");
  ok("Mesa vacía: ningún TPV muestra productos, ni barra «Enviar comanda», ni flechas de deshacer/rehacer", ["A", "B"].every((x) => (p0[x].carrito || []).length === 0 && oculto(p0[x].barra) && oculto(p0[x].deshacer) && oculto(p0[x].rehacer) && (p0[x].tickets || []).length === 0), p0);
  const p1 = P("1-A-anade-1");
  ok("A añade 1 producto: A lo ve en su carrito y la barra «Enviar comanda» aparece con 1 línea", (p1.A.carrito || []).join() === q(1) && /Enviar comanda/.test(p1.A.barra || "") && /\b1\b/.test(p1.A.barra || ""), p1.A);
  ok("A añade 1 producto: se guarda un único pedido de la mesa con 1 línea", (p1.A.tickets || []).length === 1 && /:1$/.test((p1.A.tickets || [""])[0]), p1.A.tickets);
  const p1b = P("1b-9s-despues");
  ok("9 s después B ve el mismo carrito (1 unidad) sin hacer nada", (p1b.B.carrito || []).join() === q(1), p1b.B);
  ok("B muestra también la barra «Enviar comanda» con 1 línea (aviso de lo pendiente)", /Enviar comanda/.test(p1b.B.barra || "") && /\b1\b/.test(p1b.B.barra || ""), p1b.B.barra);
  ok("A y B comparten UN solo pedido de la mesa (no se crea uno por TPV)", mismoPedido(p1b), { A: p1b.A.tickets, B: p1b.B.tickets });
  // Cada «añadir» crea una linea nueva (comportamiento por defecto): se compara por UNIDADES y la barra por LINEAS
  const unidades = (arr) => (arr || []).reduce((t, x) => t + Number(String(x).split(":")[1] || 0), 0);
  const lineasBarra = (t) => { const m2 = String(t || "").match(/Enviar comanda (\d+)/); return m2 ? Number(m2[1]) : null; };
  const p2 = P("2-A-sube-cantidad");
  ok("A añade otra unidad: A ve 2 unidades y la barra «Enviar comanda» cuenta LÍNEAS (tantas como líneas hay en el carrito, no unidades sueltas)", unidades(p2.A.carrito) === 2 && lineasBarra(p2.A.barra) === (p2.A.carrito || []).length, p2.A);
  ok("Tras añadir, A puede deshacer (flecha visible)", !oculto(p2.A.deshacer), p2.A.deshacer);
  const p2b = P("2b-9s-despues");
  ok("9 s después B ve 2 unidades y la misma barra que A", unidades(p2b.B.carrito) === 2 && unidades(p2b.A.carrito) === 2 && lineasBarra(p2b.B.barra) === lineasBarra(p2b.A.barra), { A: p2b.A, B: p2b.B });
  ok("Siguen siendo un solo pedido en los dos TPV", mismoPedido(p2b), { A: p2b.A.tickets, B: p2b.B.tickets });
  const p3 = P("3-B-reabre-mesa");
  ok("B reabre la mesa y sigue viendo 2 unidades, con un solo pedido", unidades(p3.B.carrito) === 2 && (p3.B.tickets || []).length === 1, p3.B);
  const prints = ["0-mesa-vacia", "1-A-anade-1", "1b-9s-despues", "2-A-sube-cantidad", "2b-9s-despues", "3-B-reabre-mesa"].map((k) => [P(k).A.prints, P(k).B.prints]).flat();
  ok("Con la comanda automática a 15 min no sale nada a cocina en ningún TPV durante la prueba", prints.every((x) => x === 0), prints);
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
      window.__saved = { on: localStorage.getItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY), delay: localStorage.getItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY) };
      localStorage.setItem(OPTIONS_AUTO_COMANDA_ON_SAVE_KEY, "1");
      localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "900");
      window.__prints = []; window.__net = []; const __of = window.fetch.bind(window); window.fetch = (u, o) => { const m = String(u && u.url || u).match(/action=([a-z-]+)/); if (m && /parked|mesas-layout/.test(m[1]) && String((o && o.method) || 'GET') !== 'GET') __net.push(Date.now() % 100000 + ' ' + m[1]); return __of(u, o); };
      printComandaWithContext = async (o) => { __prints.push((o.isReturn ? "DEV " : "") + (o.lines || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",")); return { ok: true }; };
      getConfiguredComandaPrinterForPrint = () => "FAKE";
      window.__prods = products.filter((x) => Number(x.price) > 0 && !x.variants && !isOfferPackProductById(getProductBaseId(x)) && !(getProductAddonsForProduct(x) || []).length && !productHasDerivedStockMarker(x)).slice(0, 1);
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); };
      window.__tickets = () => parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).map((t) => ({ items: (t.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(","), impreso: JSON.stringify(t.comandaState?.printedQtyByLineKey ? Object.values(t.comandaState.printedQtyByLineKey) : []) }));
      return { mesas: MESAS_INLINE_ACTIVE, reglas: __mesasComandaRulesLoaded, activa: isAutoComandaOnSaveEnabled() };
    }, TABLE);
    out.modo = [await prep(A), await prep(B)];

    out.nombre = await A.win.evaluate(() => String(__prods[0].name).slice(0, 8));
    out.limpiezaInicial = await cleanTable(A, B);
    const DIR = process.env.TPV_SHOT_DIR || os.tmpdir();
    const fs = require('fs');
    const info = (X) => X.win.evaluate((T) => {
      const vis = (id) => { const e = document.getElementById(id); return e && !e.classList.contains('hidden') ? (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70) : '(oculto)'; };
      const lines = Array.from(document.querySelectorAll('#cartList .cart-line, #cartList > div')).length;
      return { carrito: cart.map((c) => String(c.name).slice(0, 8) + ':' + c.qty), deshacer: vis('parkedUndoBtn'), rehacer: vis('parkedRedoBtn'), barra: vis('sendComandaBar'), tickets: parkedTickets.filter((t) => t.mesaUid === T && !t.paid).map((t) => String(t.id).slice(-6) + ':' + (t.items || []).length), idx: currentParkedTicketIndex, prints: __prints.length };
    }, TABLE);
    const shot = async (tag) => {
      if (process.env.TPV_SHOT_DIR) for (const [n, X] of [['A', A], ['B', B]]) {
        await X.win.screenshot({ path: path.join(DIR, `paso-${tag}-${n}.png`), clip: { x: 1140, y: 0, width: 780, height: 1000 } }).catch(() => {});
      }
      out['paso_' + tag] = { A: await info(A), B: await info(B) };
    };
    // Temporizador de comanda automatica a 15 min en los dos (no sale nada a cocina durante la prueba)
    for (const X of [A, B]) await X.win.evaluate(() => { localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, '900'); });
    await A.win.evaluate(() => { __sel(); });
    await B.win.evaluate(() => { __sel(); });
    await sleep(2500);
    await shot('0-mesa-vacia');
    await A.win.evaluate(async () => { await addToCart(__prods[0]); });
    await sleep(3500);
    await shot('1-A-anade-1');
    await sleep(9000);
    await shot('1b-9s-despues');
    await A.win.evaluate(async () => { await addToCart(__prods[0]); });
    await sleep(3500);
    await shot('2-A-sube-cantidad');
    await sleep(9000);
    await shot('2b-9s-despues');
    await B.win.evaluate(() => { __sel(); });
    await sleep(2000);
    await shot('3-B-reabre-mesa');
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
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(verdict.fails ? 1 : 0);
  }
})();
