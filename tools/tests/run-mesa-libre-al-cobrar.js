// run-mesa-libre-al-cobrar.js -- prueba MANUAL (no entra en npm test): en Modo Mesas, al marcar el pedido como COBRADO (se llama a markParkedTicketAsPaidByIndex, sin crear factura) la mesa
// queda LIBRE (sin etapa "Cuenta cobrada"), sin pedido duplicado, sin segunda comanda y sin
// "Enviar devolucion". NO crea factura (el cobro real se prueba con run-two-tpv-ops-pay.js). Dos TPV reales, mesa M3.
// Impresion simulada. Uso: node tools/tests/run-mesa-libre-al-cobrar.js
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
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 520000);
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
      printComandaWithContext = async (o) => { __prints.push((o.isReturn ? "DEV " : "") + (o.lines || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",")); return { ok: true }; };
      getConfiguredComandaPrinterForPrint = () => "FAKE";
      window.__prods = products.filter((x) => ['Varios 10'].includes(String(x.name)) && Number(x.price) > 0);
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); };
      window.__tickets = () => parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).map((t) => ({ items: (t.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(","), impreso: JSON.stringify(t.comandaState?.printedQtyByLineKey ? Object.values(t.comandaState.printedQtyByLineKey) : []) }));
      return { mesas: MESAS_INLINE_ACTIVE, reglas: __mesasComandaRulesLoaded, activa: isAutoComandaOnSaveEnabled() };
    }, TABLE);
    out.modo = [await prep(A), await prep(B)];

    out.limpiezaInicial = await cleanTable(A, B);
    // A abre la mesa y añade dos productos; sale la comanda; luego COBRA (cobra de verdad en el demo)
    console.log('STEP seleccionar mesa');
    await A.win.evaluate(() => { __sel(); });
    // B NO abre la mesa: asi se prueba el cobro con un solo TPV (el caso normal)
    await sleep(1000);
    console.log('STEP anadir productos');
    await A.win.evaluate(async () => { await addToCart(__prods[0]); await addToCart(__prods[0]); });
    console.log('STEP productos anadidos');
    await sleep(16000);
    const snap = (X) => X.win.evaluate((T) => { const st = loadMesasTablesStateForInline(); return { estado: (st.tableStates || {})[T] || null, etapa: ((st.tableMeta || {})[T] || {}).serviceStage || null, vinculo: (st.tableTicketMap || {})[T] || null, carrito: cart.map((c) => String(c.name).slice(0, 8) + ':' + c.qty), tickets: parkedTickets.filter((t) => t.mesaUid === T).map((t) => String(t.id).slice(-6) + (t.paid ? 'P' : 'u') + (t.items || []).length), barra: (() => { const el = document.getElementById('sendComandaBar'); return el && !el.classList.contains('hidden') ? el.innerText.replace(/\s+/g, ' ').slice(0, 50) : '(oculta)'; })(), prints: __prints.length, msg: (() => { const ov = document.getElementById('msgOverlay'); return ov && !ov.classList.contains('hidden') ? (document.getElementById('msgText')?.textContent || '').replace(/\s+/g, ' ').slice(0, 160) : ''; })(), toast: (document.getElementById('toastContainer')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160), pagoAbierto: !document.getElementById('payOverlay').classList.contains('hidden') }; }, TABLE);
    out.antes_de_cobrar = { A: await snap(A) };
    console.log('STEP marcar el pedido como cobrado (simula un cobro correcto, sin crear factura)');
    await A.win.evaluate(async (T) => {
      const idx = parkedTickets.findIndex((t) => t.mesaUid === T && !t.paid && (t.items || []).length);
      window.__idxPagado = idx;
      await markParkedTicketAsPaidByIndex(idx, { codigo: 'ZZTEST', idfactura: 0 });
    }, TABLE);
    console.log('STEP cobro confirmado, observando');
    out.linea_tiempo = [];
    for (let k = 0; k < 4; k++) { await sleep(k === 0 ? 1500 : 6000); out.linea_tiempo.push({ t: (k === 0 ? 1.5 : 1.5 + k * 6), A: await snap(A) }); }
    await B.win.evaluate(async () => { try { await refreshMesasLayoutFromRemote(); await refreshRemoteParkedReservationsOnly(); } catch (e) {} });
    await sleep(2500);
    out.B_despues = await snap(B);
    out.prints_A = await A.win.evaluate(() => __prints.slice());
    out.prints_B = await B.win.evaluate(() => __prints.slice());
    const last = out.linea_tiempo[out.linea_tiempo.length - 1].A;
    out.OK = last.estado === 'libre' && !last.etapa && !last.vinculo && (last.tickets || []).every((t) => /P/.test(t)) && out.prints_A.length === 1 && String(last.barra) === '(oculta)';
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
