// run-lumi-fixes.js -- prueba (bateria, nivel full) de los fallos que dio Lumi en la reunion del 25-nov-2026 (Modo Mesas, dividir cuenta):
//   1) con una division SIN ACABAR, ir a una mesa libre recargaba la parte antigua una y otra vez («Reanudado cobro dividido») y no se podia salir;
//   2) mover una mesa con la cuenta dividida llevaba solo UNA parte (la otra se quedaba en la mesa de origen);
//   3) fusionar mesas ocupadas esperaba a tres operaciones de red seguidas (tardaba segundos) y no fusionaba las partes de una cuenta dividida;
//   4) los clientes no traian direccion/CP/ciudad (en FacturaScripts reciente viven en `contactos`, no en `clientes`);
//   5) el nombre del producto en el carrito salia en vertical (letra por letra) cuando la fila llevaba mucho importe/cantidad;
//   6) la direccion del cliente en facturas/tickets salia «(sin informar)» (hay que leerla del contacto de facturacion);
//   7) un ticket ya dividido no se podia volver a dividir («usa Partes = 1 para unificar primero»): ahora se subdivide esa parte.
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
      const medir = () => { const el = document.querySelector(".cart-line .cart-line-name"); const line = document.querySelector(".cart-line"); return { nombre: el ? Math.round(el.getBoundingClientRect().width) : -1, fila: line ? Math.round(line.getBoundingClientRect().width) : -1, alto: el ? Math.round(el.getBoundingClientRect().height) : -1, controlesDebajo: (() => { const q = document.querySelector(".cart-line .qty-controls"); return !!(el && q && q.getBoundingClientRect().top >= el.getBoundingClientRect().bottom - 1); })(), carrito: Math.round((document.querySelector(".cart-card")?.getBoundingClientRect().width) || 0) }; };
      const r = { conArreglo: medir() };
      const st = document.createElement("style"); st.id = "__viejo"; st.textContent = ".cart-line-name{flex:1 1 0%!important;min-width:0!important}.cart-line{flex-wrap:nowrap!important}.cart-line-controls{display:contents!important}"; document.head.appendChild(st);
      await sleep(300); r.reglasAntiguas = medir(); st.remove();
      await sleep(300); r.otraVez = medir();
      document.getElementById("__ancho")?.remove();
      return r;
    });

    // ---------- 6) factura/ticket: la direccion del cliente sale del contacto (en `clientes` de FS no esta) y no se pierde si falla la peticion
    out.t6 = await win.evaluate(async () => {
      const COD = "ZZTEST6";
      const realFetch = fetchApiResourceWithParams;
      const llamadas = [];
      const r = {};
      try {
        let contactosCaido = false;
        fetchApiResourceWithParams = async (recurso, params) => {
          llamadas.push(recurso);
          if (recurso === "contactos") { if (contactosCaido) throw new Error("caido"); return [{ idcontacto: 3, codcliente: COD, direccion: "Otra calle 9", codpostal: "00000", ciudad: "Nada" }, { idcontacto: 7, codcliente: COD, direccion: "Calle Mayor 3", codpostal: "08001", ciudad: "Barcelona", provincia: "Barcelona" }]; }
          return [{ codcliente: COD, nombre: "Cliente Seis", razonsocial: "Cliente Seis SL", cifnif: "B6666", idcontactofact: 7 }];
        };
        delete customerPrintCache[COD];
        r.refresco = await refreshCustomerPrintCacheByCod(COD);
        r.cache = { ...(getCustomerPrintCacheByCod(COD) || {}) };
        r.facturaDatos = await getInvoiceCustomerBillingInfo({ codcliente: COD, clientName: "x" });
        r.ficha = await fetchClienteByCodcliente(COD);
        // la peticion del contacto falla: se sigue y la cache conserva la direccion buena
        contactosCaido = true;
        r.refrescoCaido = await refreshCustomerPrintCacheByCod(COD);
        r.cacheTrasCaida = { ...(getCustomerPrintCacheByCod(COD) || {}) };
        r.facturaTrasCaida = await getInvoiceCustomerBillingInfo({ codcliente: COD, clientName: "x" });
        // un cliente que YA trae direccion no pide contactos
        const antes = llamadas.length;
        const propio = await completeClienteAddressFromContactos({ codcliente: COD, direccion: "Propia 1", codpostal: "1", ciudad: "C" });
        r.propio = { direccion: propio.direccion, pidioContactos: llamadas.length > antes };
      } catch (e) { r.error = String(e && e.message || e); }
      finally { fetchApiResourceWithParams = realFetch; delete customerPrintCache[COD]; saveCustomerPrintCache(); }
      return r;
    });

    // ---------- 7) redividir: dividir en 2 y luego dividir la parte 1 en 2 -> 3 partes (1/3, 2/3, 3/3) en la misma mesa, mismas unidades y mismo total
    out.t7 = await win.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const r = {};
      try {
        await window.__clean();
        __sel("tut-room-1::m4"); await sleep(800);
        addToCart(__prods[0]); addToCart(__prods[1]); addToCart(__prods[0]); addToCart(__prods[2]); await sleep(6000);
        const suma = (k) => Math.round(window.__loc().reduce((a, t) => a + t[k], 0) * 1000) / 1000;
        r.antes = { n: window.__loc().length, u: suma("u"), total: suma("total") };
        const dividir = async (matriz, partes) => {
          document.getElementById("parkedSplitBtn").click();
          for (let i = 0; i < 40 && document.getElementById("splitTicketOverlay").classList.contains("hidden"); i++) await sleep(300);
          const sel = document.getElementById("splitTicketModeSelect"); sel.value = "items"; sel.dispatchEvent(new Event("change"));
          splitTicketPartsCount = partes; if (splitTicketPartsInput) splitTicketPartsInput.value = String(partes); splitTicketMode = "items";
          initSplitItemsMatrixFromCurrentCart();
          splitTicketItemsMatrix = matriz(cart);
          const errAntes = splitTicketError ? splitTicketError.textContent : "";
          await confirmSplitTicket(); await sleep(2500);
          return { error: splitTicketError ? splitTicketError.textContent : "", errAntes };
        };
        r.d1 = await dividir((c) => c.map((l, i) => (i % 2 === 0 ? [Number(l.qty), 0] : [0, Number(l.qty)])), 2);
        r.tras1 = window.__loc();
        r.cargado1 = getCurrentLoadedParkedTicket()?.name || null;
        // ahora el cargado es la parte 1/2 (2 lineas): se divide ESA parte en 2, una linea a cada nueva parte
        r.lineasParte1 = cart.map((l) => String(l.name).slice(0, 8) + ":" + l.qty);
        r.d2 = await dividir((c) => c.map((l, i) => (i === 0 ? [Number(l.qty), 0] : [0, Number(l.qty)])), 2);
        r.tras2 = window.__loc();
        r.cargado2 = getCurrentLoadedParkedTicket()?.name || null;
        r.totalesAlmacenados = window.__mine().map((t) => ({ name: String(t.name), part: t.splitPart, total: t.splitTotal, grupo: String(t.splitGroupId || "").slice(0, 6) }));
        try { r.sesion = JSON.parse(localStorage.getItem(SPLIT_SESSION_STATE_KEY) || "null"); } catch {}
        r.despues = { n: window.__loc().length, u: suma("u"), total: suma("total") };
        // «Revertir division» sigue funcionando con las 3 partes
        document.getElementById("parkedSplitBtn").click();
        for (let i = 0; i < 40 && document.getElementById("splitTicketOverlay").classList.contains("hidden"); i++) await sleep(300);
        splitTicketPartsCount = 1; if (splitTicketPartsInput) splitTicketPartsInput.value = "1";
        await confirmSplitTicket(); await sleep(2500);
        r.unificado = { n: window.__loc().length, u: suma("u"), total: suma("total"), nombre: window.__loc()[0] && window.__loc()[0].nombre };
      } catch (e) { r.error = String(e && e.message || e); }
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
    const t1 = out.t1 || {}, t2 = out.t2 || {}, t3 = out.t3 || {}, t4 = out.t4 || {}, t5 = out.t5 || {}, t6 = out.t6 || {}, t7 = out.t7 || {};
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
      ok("5) Texto del carrito: con importe largo y cantidad decimal, el nombre ocupa su propia línea a todo el ancho (≥ 80 px) y el contador y el precio quedan debajo", t5.conArreglo && t5.conArreglo.nombre >= 80 && t5.conArreglo.controlesDebajo === true, t5.conArreglo),
      ok("5) Control: con las reglas ANTIGUAS el nombre se encoge (< 60 px); si no se reproduce, esta prueba no demostraría nada", t5.reglasAntiguas && t5.reglasAntiguas.nombre < 60, t5.reglasAntiguas),
      ok("5) Al quitar las reglas antiguas vuelve a quedar bien", t5.otraVez && t5.otraVez.nombre >= 80, t5.otraVez),
      ok("6) Factura/ticket: la dirección, CP y ciudad del cliente salen del contacto de facturación (antes «(sin informar)») y el NIF se mantiene", !t6.error && (t6.refresco || {}).direccion === "Calle Mayor 3" && (t6.cache || {}).direccion === "Calle Mayor 3" && (t6.cache || {}).codpostal === "08001" && (t6.cache || {}).cifnif === "B6666" && (t6.facturaDatos || {}).clientAddress === "Calle Mayor 3 08001 Barcelona" && (t6.facturaDatos || {}).clientFiscalId === "B6666" && (t6.ficha || {}).direccion === "Calle Mayor 3", t6),
      ok("6) Si falla la petición del contacto no se rompe la impresión ni se pierde la dirección que ya estaba guardada; y un cliente con dirección propia no pide contactos", !t6.error && (t6.cacheTrasCaida || {}).direccion === "Calle Mayor 3" && (t6.facturaTrasCaida || {}).clientAddress === "Calle Mayor 3 08001 Barcelona" && (t6.propio || {}).direccion === "Propia 1" && (t6.propio || {}).pidioContactos === false, { cacheTrasCaida: t6.cacheTrasCaida, facturaTrasCaida: t6.facturaTrasCaida, propio: t6.propio }),
      ok("7) Redividir: dividir la parte 1/2 en 2 deja 3 partes en la misma mesa, numeradas 1/3, 2/3 y 3/3 (antes: «Este ticket ya está dividido»)", !t7.error && (t7.tras1 || []).length === 2 && (t7.tras2 || []).length === 3 && JSON.stringify((t7.tras2 || []).map((t) => (/\((\d)\/(\d)\)\s*$/.exec(t.nombre) || [])[0]).sort()) === JSON.stringify(["(1/3)", "(2/3)", "(3/3)"]) && !/dividido/i.test((t7.d2 || {}).error || ""), { d2: t7.d2, tras2: t7.tras2, error: t7.error }),
      ok("7) Redividir no pierde ni inventa nada: mismas unidades y mismo total que antes de dividir, y las 3 partes siguen en la mesa", !t7.error && (t7.despues || {}).u === (t7.antes || {}).u && Math.abs((t7.despues || {}).total - (t7.antes || {}).total) < 0.02 && (t7.tras2 || []).every((t) => t.mesa === "m4"), { antes: t7.antes, despues: t7.despues }),
      ok("7) Las partes que ya existían conservan su número y solo cambian el total (2/2 pasa a 2/3); todas del mismo grupo; se queda cargada la 1/3 y la división en curso lleva total 3", !t7.error && (t7.totalesAlmacenados || []).length === 3 && (t7.totalesAlmacenados || []).every((t) => t.total === 3 && t.grupo === (t7.totalesAlmacenados || [])[0].grupo) && /\(1\/3\)\s*$/.test(String(t7.cargado2 || "")) && (t7.sesion || {}).totalParts === 3, { cargado2: t7.cargado2, totalesAlmacenados: t7.totalesAlmacenados, sesion: t7.sesion }),
      ok("7) «Revertir división» sigue funcionando con las 3 partes: queda un solo pedido con las mismas unidades y el mismo total", !t7.error && (t7.unificado || {}).n === 1 && (t7.unificado || {}).u === (t7.antes || {}).u && Math.abs((t7.unificado || {}).total - (t7.antes || {}).total) < 0.02 && !/\(\d+\/\d+\)/.test(String((t7.unificado || {}).nombre || "")), t7.unificado),
      ok("Al terminar las mesas de prueba quedan limpias", Array.isArray(out.limpio) && out.limpio.length === 0, out.limpio),
    ]);
    clearTimeout(hard); kill();
    process.exit(verdict.fails ? 1 : 0);
  }
})();
