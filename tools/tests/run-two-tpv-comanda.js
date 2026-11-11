// run-two-tpv-comanda.js -- prueba (entra en la bateria, nivel full) de la AUTO-COMANDA con DOS TPV
// reales a la vez en Modo Mesas contra el demo (mesa M3, que deja limpia). Perfiles persistentes de
// run-two-tpv.js, sesion ya iniciada (nunca PIN). NO imprime nada de verdad: se sustituye
// printComandaWithContext por un contador en cada instancia. Activa la auto-comanda (espera 8 s) en
// los dos perfiles y restaura sus ajustes al terminar.
// Comprueba que cada producto sale a cocina UNA sola vez en total (no una por TPV): S1 uno añade y el otro mira; S2 los dos
// añaden productos distintos casi a la vez.
// Uso: node tools/tests/run-two-tpv-comanda.js
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
  function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  const cnt = (arrs, name) => arrs.flat().join(",").split(",").filter((t) => t.startsWith(name + ":")).length;
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  ok("Los dos TPV están en Modo Mesas con la auto-comanda activa y caja abierta", (out.modo || []).length === 2 && out.modo.every((m) => m.mesas && m.activa && m.login && m.caja && m.prods >= 4), out.modo);
  const n = out.nombres || [];
  const s1 = [out.S1_A || [], out.S1_B || []];
  ok("S1: el producto que añade A sale a cocina UNA sola vez en total (no una por TPV)", cnt(s1, n[0]) === 1, s1);
  ok("S1: B ve el mismo pedido que A, sin duplicados", JSON.stringify(out.S1_estado?.[0]?.t) === JSON.stringify(out.S1_estado?.[1]?.t) && (out.S1_estado?.[0]?.t || []).length === 1, out.S1_estado);
  const s2 = [out.S2_A || [], out.S2_B || []];
  ok("S2: el producto que añade A a la vez sale UNA sola vez en total", cnt(s2, n[2]) === 1, s2);
  ok("S2: el producto que añade B a la vez sale UNA sola vez en total", cnt(s2, n[3]) === 1, s2);
  ok("S2: los dos TPV acaban con el mismo pedido de la mesa (sin duplicados)", JSON.stringify(out.estadoA) === JSON.stringify(out.estadoB) && (out.estadoA || []).length === 1, { A: out.estadoA, B: out.estadoB });
  return c;
}

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
      localStorage.setItem(OPTIONS_AUTO_COMANDA_DELAY_SEC_KEY, "8");
      window.__prints = []; window.__net = []; const __of = window.fetch.bind(window); window.fetch = (u, o) => { const m = String(u && u.url || u).match(/action=([a-z-]+)/); if (m && /parked|mesas-layout/.test(m[1]) && String((o && o.method) || 'GET') !== 'GET') __net.push(Date.now() % 100000 + ' ' + m[1]); return __of(u, o); };
      printComandaWithContext = async (o) => { __prints.push((o.isReturn ? "DEV " : "") + (o.lines || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",")); return { ok: true }; };
      getConfiguredComandaPrinterForPrint = () => "FAKE";
      { const seen = new Set(); window.__prods = []; for (const p of products.filter((x) => Number(x.price) > 0 && !x.variants && !isOfferPackProductById(getProductBaseId(x)) && !(getProductAddonsForProduct(x) || []).length && !productHasDerivedStockMarker(x))) { const k = String(p.name).slice(0, 7); if (!seen.has(k)) { seen.add(k); __prods.push(p); } if (__prods.length >= 4) break; } }
      window.__sel = () => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); };
      window.__tickets = () => parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).map((t) => ({ items: (t.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(","), impreso: JSON.stringify(t.comandaState?.printedQtyByLineKey ? Object.values(t.comandaState.printedQtyByLineKey) : []) }));
      return { mesas: MESAS_INLINE_ACTIVE, reglas: __mesasComandaRulesLoaded, activa: isAutoComandaOnSaveEnabled(), login: hasActiveLoginSession(), caja: !!cashSession?.open, prods: __prods.length };
    }, TABLE);
    out.modo = [await prep(A), await prep(B)];

    out.limpiezaInicial = await cleanTable(A, B);
    // Los dos abren la mesa vacia; A crea el pedido con un producto y espera a que salga la comanda
    await A.win.evaluate(() => { __sel(); });
    await B.win.evaluate(() => { __sel(); });
    await sleep(800);
    out.inicio = [await A.win.evaluate(() => ({ cart: cart.map((c) => c.name + ':' + c.qty), t: __tickets() })), await B.win.evaluate(() => ({ cart: cart.map((c) => c.name + ':' + c.qty), t: __tickets() }))];
    A.win.evaluate(() => { addToCart(__prods[0]); }); // sin esperar: si abriese una ventana, la prueba no se cuelga
    await sleep(3000);
    out.nombres = await A.win.evaluate(() => __prods.map((p) => String(p.name).slice(0, 7)));
    await B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); __sel(); });
    await sleep(500);
    out.S1_prints_antes = [await A.win.evaluate(() => __prints.slice()), await B.win.evaluate(() => __prints.slice())];
    await sleep(24000);
    out.S1_A = await A.win.evaluate(() => __prints.slice());
    out.S1_B = await B.win.evaluate(() => __prints.slice());

    out.S1_estado = [await A.win.evaluate(() => ({ cart: cart.map((c) => c.name.slice(0,7) + ':' + c.qty), t: __tickets() })), await B.win.evaluate(() => ({ cart: cart.map((c) => c.name.slice(0,7) + ':' + c.qty), t: __tickets() }))];
    // S2: A y B añaden productos DISTINTOS casi a la vez
    await A.win.evaluate(() => { __prints.length = 0; });
    await B.win.evaluate(() => { __prints.length = 0; });
    await Promise.all([
      A.win.evaluate(() => { cart.push(buildCartLine(__prods[2], 1)); renderCart(); }),
      (async () => { await sleep(700); await B.win.evaluate(() => { cart.push(buildCartLine(__prods[3], 1)); renderCart(); }); })(),
    ]);
    await sleep(34000);
    for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(2500);
    out.S2_A = await A.win.evaluate(() => __prints.slice());
    out.S2_B = await B.win.evaluate(() => __prints.slice());
    out.estadoA = await A.win.evaluate(() => __tickets());
    out.estadoB = await B.win.evaluate(() => __tickets());
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
