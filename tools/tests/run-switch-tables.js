// run-switch-tables.js -- prueba (entra en la bateria, nivel full): cambiar entre dos mesas OCUPADAS (M1 y
// M3 del demo) con una instancia real; cada pedido debe conservar SUS lineas (ninguno pisa al otro),
// tanto en la copia local como en el servidor. Perfil persistente de run-two-tpv.js, sesion ya
// iniciada (nunca PIN). Deja M1 y M3 limpias. Con --noops apaga el guardado por partes (como los clientes reales).
// Uso: node tools/tests/run-switch-tables.js [--noops]
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const M3 = "tut-room-1::m3";
const M1 = "tut-room-1::m1";
const NOOPS = process.argv.includes("--noops");
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

async function cleanTables(A) {
  const r = await A.win.evaluate(async ([M1, M3]) => {        cart = []; setCurrentParkedTicketIndex(null); renderCart();
        try { localStorage.removeItem(getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY)); } catch {}
        let n = 0;
        for (const t of parkedTickets.filter((x) => !x.paid && [M1, M3].includes(x.mesaUid))) { try { markParkedTicketAsDeleted(t); await apiDeleteParkedReservation(t); n++; } catch (e) {} }
        parkedTickets = parkedTickets.filter((x) => !([M1, M3].includes(x.mesaUid) && !x.paid));
        saveParkedTicketsCache(parkedTickets);
        const st = loadMesasTablesStateForInline();
        [M1, M3].forEach((T) => { if (st?.tableTicketMap) delete st.tableTicketMap[T]; if (st?.draftCartByTable) delete st.draftCartByTable[T]; });
        saveMesasTablesStateForInline(st);
        persistRuntimeCartSnapshot({ force: true });
        return "borrados " + n;
      }, [M1, M3]);
  await sleep(3000);
  return r;
}

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  const n = out.nombres || [];
  const exp = [`m1=${n[3]}:1`, `m3=${n[0]}:1`];
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  ok("Modo Mesas activo" + (NOOPS ? " con guardado entero" : ""), out.modo?.mesas === true && out.modo.ops === !NOOPS, out.modo);
  ok("Se crean dos pedidos, uno en cada mesa, en la copia local y en el servidor", same(out.creados?.local, exp) && same(out.creados?.servidor, exp), out.creados);
  const saltos = [["salto1_m3", n[0]], ["salto2_m1", n[3]], ["salto3_m3", n[0]], ["salto4_m1", n[3]]];
  saltos.forEach(([k, prod]) => ok(`Al pasar a la mesa ${k.slice(-2).toUpperCase()} (${k.slice(5, 6)}º salto) el carrito es el SUYO y ningún pedido se pisa`, out[k]?.cart === `${prod}:1` && same(out[k]?.local, exp), out[k]));
  ok("Tras ir y volver varias veces, cada mesa conserva SUS líneas en la copia local y en el servidor", same(out.final?.local, exp) && same(out.final?.servidor, exp), out.final);
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 200000);
  const out = {};
  let A;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    await sleep(8000);
    A.win.evaluate(() => { cart = []; setCurrentParkedTicketIndex(null); renderCart(); }).catch(() => {});
    out.modo = await A.win.evaluate(async ([M1, M3, NOOPS]) => {
      await setMesasInlineModeEnabled(true, { persist: false }); setMesasInlineView("transacciones", { persist: false });
      { const seen = new Set(); window.__prods = []; for (const p of products.filter((x) => Number(x.price) > 0 && !x.variants && !isOfferPackProductById(getProductBaseId(x)) && !(getProductAddonsForProduct(x) || []).length && !productHasDerivedStockMarker(x))) { const k = String(p.name).slice(0, 7); if (!seen.has(k)) { seen.add(k); __prods.push(p); } if (__prods.length >= 4) break; } }
      if (NOOPS) localStorage.setItem('tpv_parkedOpsDisabled', '1');
      window.__of = window.fetch.bind(window);
      window.__sel = (u) => { updateMesasSelectionFromContext({ tableUid: u }); syncTpvCartWithSelectedMesa(); };
      window.__cart = () => cart.map((c) => String(c.name).slice(0, 7) + ":" + c.qty).sort().join(",");
      window.__loc = () => parkedTickets.filter((t) => !t.paid && [M1, M3].includes(t.mesaUid)).map((t) => String(t.mesaUid).slice(-2) + "=" + (t.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",")).sort();
      window.__srv = async () => {
        const r = await __of(`${TPV_SYNC_API_URL}?action=list-parked-reservations&slug=${encodeURIComponent(getCurrentSlugForReservations())}&codalmacen=${encodeURIComponent(getCurrentWarehouseCode())}`, { headers: { "X-TPV-API-KEY": getTpvSyncApiKey() }, cache: "no-store" });
        const j = await r.json();
        return (Array.isArray(j?.data) ? j.data : []).filter((x) => !x.paid && [M1, M3].includes(String(x.mesaUid || ""))).map((x) => String(x.mesaUid).slice(-2) + "=" + (x.items || []).map((l) => String(l.name).slice(0, 7) + ":" + l.qty).sort().join(",")).sort();
      };
      return { mesas: MESAS_INLINE_ACTIVE, ops: parkedOpsIsEnabled(getCurrentSlugForReservations(), "mesas") };
    }, [M1, M3, process.argv.includes("--noops")]);

    out.limpiezaInicial = await cleanTables(A);
    out.nombres = await A.win.evaluate(() => __prods.map((p) => String(p.name).slice(0, 7)));
    // Pedido en M3 (P0) y pedido en M1 (P3)
    await A.win.evaluate((M3) => { __sel(M3); }, M3);
    await sleep(800);
    await A.win.evaluate(() => { addToCart(__prods[0]); });
    await sleep(4500);
    await A.win.evaluate((M1) => { __sel(M1); }, M1);
    await sleep(1500);
    await A.win.evaluate(() => { addToCart(__prods[3]); });
    await sleep(4500);
    out.creados = { local: await A.win.evaluate(() => __loc()), servidor: await A.win.evaluate(() => __srv()), cart: await A.win.evaluate(() => __cart()) };

    // Ir y volver entre las dos (como el cajero tocando mesas)
    for (const [i, u] of [[1, M3], [2, M1], [3, M3], [4, M1]]) {
      await A.win.evaluate((u) => { __sel(u); }, u);
      await sleep(2500);
      out["salto" + i + "_" + u.slice(-2)] = { cart: await A.win.evaluate(() => __cart()), local: await A.win.evaluate(() => __loc()) };
    }
    await sleep(6000);
    out.final = { local: await A.win.evaluate(() => __loc()), servidor: await A.win.evaluate(() => __srv()) };
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A) {
        await A.win.evaluate(() => { try { localStorage.removeItem('tpv_parkedOpsDisabled'); } catch {} });
        out.limpieza = await cleanTables(A);
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
