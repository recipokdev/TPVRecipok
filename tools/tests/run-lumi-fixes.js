// run-lumi-fixes.js -- prueba (bateria, nivel full) de los fallos que dio Lumi en la reunion del 25-nov-2026 (Modo Mesas, dividir cuenta):
//   1) con una division SIN ACABAR, ir a una mesa libre recargaba la parte antigua una y otra vez («Reanudado cobro dividido») y no se podia salir;
//   2) mover una mesa con la cuenta dividida llevaba solo UNA parte (la otra se quedaba en la mesa de origen);
//   3) fusionar mesas ocupadas esperaba a tres operaciones de red seguidas (tardaba segundos) y no fusionaba las partes de una cuenta dividida;
//   4) los clientes no traian direccion/CP/ciudad (en FacturaScripts reciente viven en `contactos`, no en `clientes`);
//   5) el nombre del producto en el carrito salia en vertical (letra por letra) cuando la fila llevaba mucho importe/cantidad.
// Un solo TPV real contra la tienda de pruebas (perfil persistente con sesion ya iniciada; nunca se escribe PIN). Deja las mesas M1-M4 limpias.
// Uso: node tools/tests/run-lumi-fixes.js [--store=zz_bateria_tpv]
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const M1 = "tut-room-1::m1", M2 = "tut-room-1::m2", M3 = "tut-room-1::m3";
let kill = () => {};

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 420000);
  const out = {};
  let app = null, win = null;
  try {
    const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), require("./test-store").P1), TPV_TEST_LABEL: "A" };
    delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
    app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
    const pid = app.process().pid;
    kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 60000) {
      for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
      if (!win) await sleep(400);
    }
    if (!win) throw new Error("No se encontro la ventana principal");
    for (let i = 0; i < 150; i++) { if (await win.evaluate(() => typeof TPV_LOADING !== "undefined" && TPV_LOADING === false && !!window.RECIPOK_API?.apiKey).catch(() => false)) break; await sleep(200); }
    await sleep(3000);

    // ---------- preparacion: Modo Mesas, productos de prueba, limpieza de las mesas M1-M4
    out.prep = await win.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      await setMesasInlineModeEnabled(true, { persist: false }); setMesasInlineView("transacciones", { persist: false });
      const seen = new Set(); window.__prods = [];
      for (const p of products.filter((x) => Number(x.price) > 0 && !x.variants && !isOfferPackProductById(getProductBaseId(x)) && !(getProductAddonsForProduct(x) || []).length && !productHasDerivedStockMarker(x))) {
        const k = String(p.name).slice(0, 7); if (seen.has(k)) continue; seen.add(k); window.__prods.push(p); if (window.__prods.length >= 6) break;
      }
      window.__sel = (u) => { updateMesasSelectionFromContext({ tableUid: u }); syncTpvCartWithSelectedMesa(); };
      window.__cart = () => cart.map((c) => String(c.name).slice(0, 8) + ":" + c.qty).sort().join(",");
      window.__mine = () => parkedTickets.filter((t) => !t.paid && ["tut-room-1::m1", "tut-room-1::m2", "tut-room-1::m3", "tut-room-1::m4"].includes(String(t.mesaUid || "")));
      window.__loc = () => window.__mine().map((t) => ({ mesa: String(t.mesaUid).slice(-2), nombre: String(t.name || ""), n: (t.items || []).length, u: Math.round((t.items || []).reduce((a, l) => a + (Number(l.qty) || 0), 0) * 1000) / 1000, total: Number(t.total) }));
      window.__clean = async () => {
        for (let n = 0; n < 10; n++) { const i = parkedTickets.findIndex((t) => !t.paid && ["tut-room-1::m1", "tut-room-1::m2", "tut-room-1::m3", "tut-room-1::m4"].includes(String(t.mesaUid || ""))); if (i < 0) break; try { await deleteParkedTicketByIndex(i, { confirm: false }); } catch (e) {} await sleep(500); }
        localStorage.removeItem(SPLIT_SESSION_STATE_KEY); cart = []; setCurrentParkedTicketIndex(null); renderCart(); await sleep(1200);
      };
      window.__toasts = []; const ot = window.toast; window.toast = function (...a) { window.__toasts.push(String(a[0])); return ot.apply(this, a); };
      await window.__clean();
      return { prods: window.__prods.length, mesas: MESAS_INLINE_ACTIVE };
    });

    // ---------- 1) mesa M3 con 4 lineas, dividir en 2 partes; despues ir a la mesa LIBRE M2
    out.t1 = await win.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const r = {};
      __sel("tut-room-1::m3"); await sleep(800);
      addToCart(__prods[0]); addToCart(__prods[1]); addToCart(__prods[0]); addToCart(__prods[2]); await sleep(6000);
      document.getElementById("parkedSplitBtn").click();
      for (let i = 0; i < 40 && document.getElementById("splitTicketOverlay").classList.contains("hidden"); i++) await sleep(300);
      const sel = document.getElementById("splitTicketModeSelect"); sel.value = "items"; sel.dispatchEvent(new Event("change"));
      splitTicketPartsCount = 2; if (splitTicketPartsInput) splitTicketPartsInput.value = "2"; splitTicketMode = "items";
      initSplitItemsMatrixFromCurrentCart();
      splitTicketItemsMatrix = cart.map((l, i) => (i % 2 === 0 ? [Number(l.qty), 0] : [0, Number(l.qty)]));
      await confirmSplitTicket(); await sleep(2500);
      r.partes = __loc();
      window.__toasts.length = 0;
      __sel("tut-room-1::m2"); await sleep(5000);
      r.enMesaLibre = { cart: __cart(), cargado: getCurrentLoadedParkedTicket()?.name || null, toasts: window.__toasts.slice() };
      r.partesSiguen = __loc().filter((t) => t.mesa === "m3").length;
      __sel("tut-room-1::m3"); await sleep(1500);
      r.alVolver = { cargado: getCurrentLoadedParkedTicket()?.name || null, cart: __cart() };
      return r;
    });

    // ---------- 2) mover M3 (con las 2 partes) a la mesa libre M2
    out.t2 = await win.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const ok = await moveMesaPendingTicket("tut-room-1::m3", "tut-room-1::m2"); await sleep(3000);
      const loc = __loc();
      let st = null; try { st = JSON.parse(localStorage.getItem(SPLIT_SESSION_STATE_KEY) || "null"); } catch {}
      return { ok, enM2: loc.filter((t) => t.mesa === "m2").length, enM3: loc.filter((t) => t.mesa === "m3").length, sesionMesa: st && st.mesaUid };
    });

    // ---------- 3) fusionar M2 (con las 2 partes) en M1 ocupada, con el stock de FS LENTO (3 s por operacion): la pantalla no debe esperar
    out.t3 = await win.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const r = {};
      __sel("tut-room-1::m1"); await sleep(800);
      addToCart(__prods[3]); addToCart(__prods[4]); await sleep(6000);
      r.antes = __loc();
      const sumaAntes = r.antes.reduce((a, t) => a + t.total, 0);
      const lineasAntes = r.antes.reduce((a, t) => a + t.n, 0);
      r.unidadesAntes = Math.round(r.antes.reduce((a, t) => a + t.u, 0) * 1000) / 1000;
      const realSync = syncReservedStockDeltaToFS;
      syncReservedStockDeltaToFS = async (...a) => { await sleep(3000); return realSync(...a); };
      const t0 = Date.now();
      r.ok = await mergeMesaPendingTickets("tut-room-1::m2", "tut-room-1::m1");
      r.fusionMs = Date.now() - t0;
      r.alMomento = __loc();
      r.sumaAntes = Math.round(sumaAntes * 100) / 100; r.lineasAntes = lineasAntes;
      await sleep(11000); // da tiempo a las operaciones lentas en segundo plano
      syncReservedStockDeltaToFS = realSync;
      r.local = __loc();
      const resp = await fetch(`${TPV_SYNC_API_URL}?action=list-parked-reservations&slug=${encodeURIComponent(getCurrentSlugForReservations())}&codalmacen=${encodeURIComponent(getCurrentWarehouseCode())}`, { headers: { "X-TPV-API-KEY": getTpvSyncApiKey() }, cache: "no-store" });
      const j = await resp.json();
      r.servidor = (Array.isArray(j?.data) ? j.data : []).filter((x) => !x.paid && ["tut-room-1::m1", "tut-room-1::m2", "tut-room-1::m3"].includes(String(x.mesaUid || ""))).map((x) => ({ mesa: String(x.mesaUid).slice(-2), n: (x.items || []).length, u: Math.round((x.items || []).reduce((a, l) => a + (Number(l.qty) || 0), 0) * 1000) / 1000, total: Number(x.total) }));
      return r;
    });

    // ---------- 4) clientes: direccion/CP/ciudad desde `contactos` (la lista de clientes de FS no los trae)
    out.t4 = await win.evaluate(async () => {
      const cs = window.CUSTOMER_SELECTOR; if (!cs) return { sinSelector: true };
      const oldCfg = cs._cfg, oldFetch = cs._fetchJson;
      cs._cfg = { baseUrl: "https://prueba.local/x/api/3" };
      cs._fetchJson = async (url) => {
        if (String(url).includes("/contactos")) return [{ idcontacto: 7, codcliente: "5", direccion: "Calle Mayor 3", codpostal: "08001", ciudad: "Barcelona", provincia: "Barcelona", email: "contacto@x.es" }, { idcontacto: 8, codcliente: "9", direccion: "Otra 1", codpostal: "28001", ciudad: "Madrid" }];
        return [{ codcliente: "5", nombre: "Cliente Cinco", razonsocial: "Cliente Cinco SL", cifnif: "B123", email: "", idcontactofact: 7 }, { codcliente: "9", nombre: "Cliente Nueve", cifnif: "A1", email: "propio@x.es", idcontactofact: 99 }, { codcliente: "11", nombre: "Sin contacto", cifnif: "C1", idcontactofact: 0 }];
      };
      let lista = [];
      try { lista = await cs._loadCustomers(); } finally { cs._cfg = oldCfg; cs._fetchJson = oldFetch; }
      const por = (c) => (lista.find((x) => x.codcliente === c) || {})._raw || {};
      // si falla la peticion de contactos se sigue sin ellos (como hasta ahora)
      cs._cfg = { baseUrl: "https://prueba.local/x/api/3" };
      cs._fetchJson = async (url) => { if (String(url).includes("/contactos")) throw new Error("caido"); return [{ codcliente: "5", nombre: "Cliente Cinco", cifnif: "B123" }]; };
      let sinContactos = []; try { sinContactos = await cs._loadCustomers(); } finally { cs._cfg = oldCfg; cs._fetchJson = oldFetch; }
      return { c5: por("5"), c9: por("9"), c11: por("11"), total: lista.length, sinContactos: sinContactos.length };
    });

    // ---------- 5) texto vertical del carrito: ancho minimo del nombre (con control: con las reglas ANTIGUAS se reproduce el colapso)
    out.t5 = await win.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.__clean();
      __sel("tut-room-1::m4"); await sleep(800);
      addToCart(__prods[1]); await sleep(1200);
      // El carrito de Lumi mide ~300 px (clamp(300px,29vw,356px) en pantallas de ~1000 px): se fija ese ancho para que no dependa de la ventana.
      const ancho = document.createElement("style"); ancho.id = "__ancho"; ancho.textContent = ".cart-card{width:300px!important;min-width:300px!important;max-width:300px!important;flex:0 0 300px!important}"; document.head.appendChild(ancho);
      cart[0].name = "Hamburguesa especial de la casa con queso"; cart[0].qty = 12.375; cart[0].price = 1234.5; cart[0].grossPrice = 1358.0; renderCart(); await sleep(500);
      const medir = () => { const el = document.querySelector(".cart-line .cart-line-name"); const line = document.querySelector(".cart-line"); return { nombre: el ? Math.round(el.getBoundingClientRect().width) : -1, fila: line ? Math.round(line.getBoundingClientRect().width) : -1, alto: el ? Math.round(el.getBoundingClientRect().height) : -1, carrito: Math.round((document.querySelector(".cart-card")?.getBoundingClientRect().width) || 0) }; };
      const r = { conArreglo: medir() };
      const st = document.createElement("style"); st.id = "__viejo"; st.textContent = ".cart-line-name{min-width:0!important}.cart-line{flex-wrap:nowrap!important}"; document.head.appendChild(st);
      await sleep(300); r.reglasAntiguas = medir(); st.remove();
      await sleep(300); r.otraVez = medir();
      document.getElementById("__ancho")?.remove();
      return r;
    });

    // ---------- limpieza
    await win.evaluate(async () => { await window.__clean(); });
    out.limpio = await win.evaluate(() => __loc());
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try { await win.evaluate(async () => { await window.__clean(); }); } catch {}
    try { await Promise.race([app.evaluate(({ session }) => session.defaultSession.flushStorageData()), sleep(4000)]); } catch {}
    console.log(JSON.stringify(out, null, 1));
    const ok = (name, cond, extra) => [name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)];
    const t1 = out.t1 || {}, t2 = out.t2 || {}, t3 = out.t3 || {}, t4 = out.t4 || {}, t5 = out.t5 || {};
    const c5 = t4.c5 || {}, c9 = t4.c9 || {}, c11 = t4.c11 || {};
    const verdict = require("./battery/verdict.js").emitVerdict([
      ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || ""),
      ok("Preparación: Modo Mesas activo y productos de prueba", out.prep && out.prep.mesas === true && out.prep.prods >= 5, out.prep),
      ok("1) Dividir en 2 partes deja las dos partes en la mesa M3", (t1.partes || []).filter((t) => t.mesa === "m3").length === 2 && /\(1\/2\)/.test(JSON.stringify(t1.partes || [])), t1.partes),
      ok("1) Con la división sin acabar, ir a una mesa LIBRE deja el carrito vacío y no carga ningún pedido (antes recargaba la parte de M3 sin parar)", t1.enMesaLibre && t1.enMesaLibre.cart === "" && t1.enMesaLibre.cargado === null, t1.enMesaLibre),
      ok("1) ... y sin el aviso «Reanudado cobro dividido»", t1.enMesaLibre && !(t1.enMesaLibre.toasts || []).some((m) => /Reanudado cobro dividido/.test(m)), t1.enMesaLibre && t1.enMesaLibre.toasts),
      ok("1) Las dos partes siguen guardadas en su mesa, y al volver a ella se reanuda la parte 1/2", t1.partesSiguen === 2 && /\(1\/2\)/.test(String((t1.alVolver || {}).cargado || "")), { siguen: t1.partesSiguen, alVolver: t1.alVolver }),
      ok("2) Mover la mesa con la cuenta dividida lleva LAS DOS partes (antes una se quedaba en el origen)", t2.ok === true && t2.enM2 === 2 && t2.enM3 === 0, t2),
      ok("2) La división guardada pasa a la mesa nueva (para poder reanudarla allí)", t2.sesionMesa === "tut-room-1::m2", t2.sesionMesa),
      ok("3) Fusionar con el stock de FS LENTO (3 s por operación) responde al momento (< 1 s), sin esperar a la red", t3.ok === true && t3.fusionMs < 1000, { ms: t3.fusionMs }),
      ok("3) Al momento: la mesa de origen queda libre y el destino lleva TODAS las unidades (partes incluidas) y el total suma lo de las dos", (t3.alMomento || []).length === 1 && (t3.alMomento || [])[0].mesa === "m1" && (t3.alMomento || [])[0].u === t3.unidadesAntes && Math.abs((t3.alMomento || [])[0].total - t3.sumaAntes) < 0.02, { antes: t3.antes, alMomento: t3.alMomento, sumaAntes: t3.sumaAntes }),
      ok("3) Tras terminar la red en segundo plano, la copia local y el SERVIDOR coinciden: solo queda la mesa de destino fusionada, con las mismas unidades y el mismo total", (t3.local || []).length === 1 && (t3.servidor || []).length === 1 && (t3.servidor || [])[0].mesa === "m1" && (t3.servidor || [])[0].u === t3.unidadesAntes && Math.abs((t3.servidor || [])[0].total - t3.sumaAntes) < 0.02 && (t3.local || [])[0].u === t3.unidadesAntes, { unidadesAntes: t3.unidadesAntes, sumaAntes: t3.sumaAntes, local: t3.local, servidor: t3.servidor }),
      ok("4) Clientes: dirección, código postal, ciudad y email se completan desde el contacto de facturación (idcontactofact)", c5.direccion === "Calle Mayor 3" && c5.codpostal === "08001" && c5.ciudad === "Barcelona" && c5.email === "contacto@x.es", c5),
      ok("4) Sin contacto de facturación se usa el primer contacto del cliente; y lo que el cliente ya tenía propio no se pisa", c9.direccion === "Otra 1" && c9.codpostal === "28001" && c9.email === "propio@x.es", c9),
      ok("4) Un cliente sin contactos queda como estaba y si falla la petición de contactos se sigue sin ellos (no rompe la lista)", !c11.direccion && t4.total === 3 && t4.sinContactos === 1, { c11, total: t4.total, sinContactos: t4.sinContactos }),
      ok("5) Texto del carrito: con importe largo y cantidad decimal, el nombre conserva un ancho mínimo (≥ 80 px) o ocupa su propia línea", t5.conArreglo && t5.conArreglo.nombre >= 80, t5.conArreglo),
      ok("5) Control: con las reglas ANTIGUAS el nombre se encoge (< 60 px); si no se reproduce, esta prueba no demostraría nada", t5.reglasAntiguas && t5.reglasAntiguas.nombre < 60, t5.reglasAntiguas),
      ok("5) Al quitar las reglas antiguas vuelve a quedar bien", t5.otraVez && t5.otraVez.nombre >= 80, t5.otraVez),
      ok("Al terminar las mesas de prueba quedan limpias", Array.isArray(out.limpio) && out.limpio.length === 0, out.limpio),
    ]);
    clearTimeout(hard); kill();
    process.exit(verdict.fails ? 1 : 0);
  }
})();
