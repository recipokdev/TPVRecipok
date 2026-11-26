// run-lumi-fixes.js -- prueba (bateria, nivel full) de los fallos que dio Lumi en la reunion del 25-nov-2026 (Modo Mesas, dividir cuenta):
//   1) con una division SIN ACABAR, ir a una mesa libre recargaba la parte antigua una y otra vez («Reanudado cobro dividido») y no se podia salir;
//   2) mover una mesa con la cuenta dividida llevaba solo UNA parte (la otra se quedaba en la mesa de origen);
//   3) fusionar mesas ocupadas esperaba a tres operaciones de red seguidas (tardaba segundos) y no fusionaba las partes de una cuenta dividida;
//   4) los clientes no traian direccion/CP/ciudad (en FacturaScripts reciente viven en `contactos`, no en `clientes`);
//   5) el nombre del producto en el carrito salia en vertical (letra por letra) cuando la fila llevaba mucho importe/cantidad;
//   6) la direccion del cliente en facturas/tickets salia «(sin informar)» (hay que leerla del contacto de facturacion);
//   7) un ticket ya dividido no se podia volver a dividir («usa Partes = 1 para unificar primero»): ahora se subdivide esa parte;
//   8) mover / fusionar mesas DESDE EL PLANO (antes solo desde el carrito): elegir origen y destino en el plano, sin cambiar la mesa seleccionada.
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

    // ---------- 8) plano de mesas: «Mover / fusionar» (elegir origen y luego destino en el propio plano)
    out.t8 = {};
    try {
      out.t8.prep = await win.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        await window.__clean();
        __sel("tut-room-1::m1"); await sleep(800); addToCart(__prods[0]); addToCart(__prods[1]); await sleep(6000);
        __sel("tut-room-1::m2"); await sleep(800); addToCart(__prods[2]); addToCart(__prods[3]); await sleep(6000);
        window.__confirmReal = confirmModal; window.__confirmCalls = [];
        confirmModal = async (t, x) => { window.__confirmCalls.push(String(t) + ": " + String(x)); return true; };
        const suma = (k) => Math.round(window.__loc().reduce((a, t) => a + t[k], 0) * 1000) / 1000;
        const r = { antes: window.__loc(), u: suma("u"), total: suma("total"), sel: loadMesasTablesStateForInline().selectedTableId };
        setMesasInlineView("mapa", { persist: false }); await sleep(3500);
        return r;
      });
      let frame = null;
      for (let i = 0; i < 60 && !frame; i++) {
        frame = win.frames().find((f) => f.url().includes("mesas.html")) || null;
        if (frame && !(await frame.evaluate(() => typeof startMapMove === "function" && !!document.querySelector(".gestion-obj.table")).catch(() => false))) frame = null;
        if (!frame) await sleep(500);
      }
      if (!frame) throw new Error("No se encontro el plano de mesas (iframe)");
      const refrescarPlano = async () => { await frame.evaluate(() => { window.postMessage({ type: "tpv:mesas-state-changed" }, "*"); }); await sleep(900); };
      await refrescarPlano();
      // por el boton «⋯» visible de la mesa (sin mantener pulsado): ficha -> «Mover / fusionar» -> aviso de mover
      out.t8.viaBoton = await frame.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const nodos = document.querySelectorAll(".gestion-obj.table");
        const conBoton = document.querySelectorAll(".gestion-obj.table .gestion-opt-btn").length;
        const btn = document.querySelector('.gestion-obj.table[data-table-uid="tut-room-1::m1"] .gestion-opt-btn');
        const r = { mesas: nodos.length, conBoton, ancho: btn ? Math.round(btn.getBoundingClientRect().width) : 0 };
        if (!btn) return r;
        btn.click(); await sleep(300);
        r.fichaAbierta = !!document.querySelector(".gestion-tooltip");
        const mover = document.querySelector('.gestion-tooltip [data-table-act="move"]');
        r.hayMover = !!mover;
        if (mover) { mover.click(); await sleep(300); }
        const b = document.getElementById("mapMoveBanner");
        r.avisoMover = !!b && !b.classList.contains("hidden");
        r.sinBotonesEnMover = document.querySelectorAll(".gestion-obj.table .gestion-opt-btn").length === 0;
        cancelMapMove(); await sleep(300);
        r.botonesVuelven = document.querySelectorAll(".gestion-obj.table .gestion-opt-btn").length === conBoton;
        return r;
      });
      out.t8.eligiendo = await frame.evaluate(() => {
        startMapMove("tut-room-1::m1");
        const b = document.getElementById("mapMoveBanner");
        return { banner: !!b && !b.classList.contains("hidden"), texto: String(document.getElementById("mapMoveBannerText")?.textContent || ""), origen: document.querySelectorAll(".gestion-obj.table.is-move-source").length, destinos: document.querySelectorAll(".gestion-obj.table.is-move-target").length };
      });
      out.t8.cancelado = await frame.evaluate(() => {
        cancelMapMove();
        const b = document.getElementById("mapMoveBanner");
        return { banner: !!b && !b.classList.contains("hidden"), origen: document.querySelectorAll(".gestion-obj.table.is-move-source").length };
      });
      out.t8.sinCambios = await win.evaluate(() => window.__loc().map((t) => t.mesa).sort());
      // mover m1 -> m3 (libre)
      out.t8.avisosAntesDeMover = await win.evaluate(() => { const a = window.__toasts.slice(); window.__toasts.length = 0; return a; });
      await frame.evaluate(() => { startMapMove("tut-room-1::m1"); handleMapMoveTargetClick("tut-room-1::m3"); });
      await sleep(3500);
      out.t8.tras_mover = await win.evaluate(() => ({ loc: window.__loc(), sel: loadMesasTablesStateForInline().selectedTableId, avisos: window.__toasts.slice() }));
      await refrescarPlano();
      // fusionar m3 -> m2 (ocupada), con confirmacion
      await frame.evaluate(() => { startMapMove("tut-room-1::m3"); handleMapMoveTargetClick("tut-room-1::m2"); });
      await sleep(4500);
      out.t8.tras_fusion = await win.evaluate(() => ({ loc: window.__loc(), sel: loadMesasTablesStateForInline().selectedTableId, confirmaciones: window.__confirmCalls.slice(), cart: window.__cart() }));
    } catch (e) { out.t8.error = String(e && e.message || e).slice(0, 300); }
    finally {
      await win.evaluate(async () => { try { if (window.__confirmReal) confirmModal = window.__confirmReal; setMesasInlineView("transacciones", { persist: false }); } catch (e) {} });
    }

    // ---------- 9) plano: tras mover una cuenta DIVIDIDA no queda ningun instante la mesa de origen ocupada, ni dos mesas con el mismo importe; y con la ficha abierta no se pierden actualizaciones
    out.t9 = {};
    try {
      out.t9.prep = await win.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        await window.__clean();
        __sel("tut-room-1::m3"); await sleep(800);
        addToCart(__prods[0]); addToCart(__prods[1]); addToCart(__prods[0]); addToCart(__prods[2]); await sleep(6000);
        document.getElementById("parkedSplitBtn").click();
        for (let i = 0; i < 40 && document.getElementById("splitTicketOverlay").classList.contains("hidden"); i++) await sleep(300);
        const sel = document.getElementById("splitTicketModeSelect"); sel.value = "items"; sel.dispatchEvent(new Event("change"));
        splitTicketPartsCount = 2; if (splitTicketPartsInput) splitTicketPartsInput.value = "2"; splitTicketMode = "items";
        initSplitItemsMatrixFromCurrentCart();
        splitTicketItemsMatrix = cart.map((l, i) => (i % 2 === 0 ? [Number(l.qty), 0] : [0, Number(l.qty)]));
        await confirmSplitTicket(); await sleep(2500);
        setMesasInlineView("mapa", { persist: false }); await sleep(3500);
        return window.__loc();
      });
      let frame9 = null;
      for (let i = 0; i < 60 && !frame9; i++) {
        frame9 = win.frames().find((f) => f.url().includes("mesas.html")) || null;
        if (frame9 && !(await frame9.evaluate(() => typeof startMapMove === "function" && !!document.querySelector(".gestion-obj.table")).catch(() => false))) frame9 = null;
        if (!frame9) await sleep(500);
      }
      if (!frame9) throw new Error("No se encontro el plano de mesas (iframe)");
      await frame9.evaluate(() => { window.postMessage({ type: "tpv:mesas-state-changed" }, "*"); }); await sleep(1200);
      await frame9.evaluate(() => {
        window.__rec = []; window.__recT0 = performance.now(); let last = "";
        const f = () => { const g = (u) => { const n = document.querySelector('.gestion-obj.table[data-table-uid="tut-room-1::' + u + '"]'); return n ? (n.className.match(/state-\w+/) || [""])[0] : "-"; }; const cur = "m3=" + g("m3") + " m2=" + g("m2"); if (cur !== last) { window.__rec.push([Math.round(performance.now() - window.__recT0), cur]); last = cur; } window.__recRaf = requestAnimationFrame(f); };
        f();
      });
      out.t9.etiqueta = await frame9.evaluate(() => { const n = document.querySelector('.gestion-obj.table[data-table-uid="tut-room-1::m3"]'); return { total: (n && n.querySelector(".gestion-total") || {}).textContent || "", partes: (n && n.querySelector(".gestion-parts") || {}).textContent || "" }; });
      await win.evaluate(() => { window.__hrec = []; let last = ""; const f = () => { const cur = window.__mine().map((t) => String(t.name).slice(-5) + "@" + String(t.mesaUid).slice(-2)).join(" "); if (cur !== last) { window.__hrec.push(cur); last = cur; } window.__hRaf = requestAnimationFrame(f); }; f(); });
      await win.evaluate(() => { window.__moved = moveMesaPendingTicket("tut-room-1::m3", "tut-room-1::m2"); });
      await sleep(7000);
      out.t9.mapa = await frame9.evaluate(() => { cancelAnimationFrame(window.__recRaf); return window.__rec; });
      out.t9.host = await win.evaluate(() => { cancelAnimationFrame(window.__hRaf); return window.__hrec; });
      // con la ficha de la mesa M2 abierta, la cuenta se mueve a M3 desde el TPV: al cerrar la ficha el plano debe ponerse al dia
      await frame9.evaluate(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); document.querySelector('.gestion-obj.table[data-table-uid="tut-room-1::m2"] .gestion-opt-btn').click(); await sleep(300); });
      await win.evaluate(() => { window.__moved2 = moveMesaPendingTicket("tut-room-1::m2", "tut-room-1::m3"); });
      await sleep(1200);
      out.t9.conFichaAbierta = await frame9.evaluate(() => ({ ficha: !!document.querySelector(".gestion-tooltip"), m3: (document.querySelector('.gestion-obj.table[data-table-uid="tut-room-1::m3"]').className.match(/state-\w+/) || [""])[0] }));
      await frame9.evaluate(async () => { closeMapTooltip(); await new Promise((r) => setTimeout(r, 900)); });
      out.t9.alCerrarFicha = await frame9.evaluate(() => ({ m3: (document.querySelector('.gestion-obj.table[data-table-uid="tut-room-1::m3"]').className.match(/state-\w+/) || [""])[0], m2: (document.querySelector('.gestion-obj.table[data-table-uid="tut-room-1::m2"]').className.match(/state-\w+/) || [""])[0] }));
    } catch (e) { out.t9.error = String(e && e.message || e).slice(0, 300); }
    finally {
      await win.evaluate(async () => { try { setMesasInlineView("transacciones", { persist: false }); } catch (e) {} });
    }

    // ---------- 10) mover una cuenta SIN dividir justo despues de tocarla: el cambio de mesa no se deshace solo (antes, 2 de cada 6 veces el guardado chocaba con otro y se revertia)
    out.t10 = { vueltas: [] };
    try {
      await win.evaluate(async () => { await window.__clean(); });
      const prep10 = await win.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        __sel("tut-room-1::m3"); await sleep(800);
        addToCart(__prods[0]); addToCart(__prods[1]); await sleep(6000);
        setMesasInlineView("mapa", { persist: false }); await sleep(3000);
        return window.__loc();
      });
      out.t10.prep = prep10;
      for (let i = 0; i < 6; i++) {
        const desde = i % 2 === 0 ? "m3" : "m2", hasta = i % 2 === 0 ? "m2" : "m3";
        const r = await win.evaluate(async ([d, h]) => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const ok = moveMesaPendingTicket("tut-room-1::" + d, "tut-room-1::" + h, { keepSelection: true });
          await sleep(3000);
          return { ok, loc: window.__loc().map((t) => t.mesa) };
        }, [desde, hasta]);
        out.t10.vueltas.push({ desde, hasta, ...r });
      }
    } catch (e) { out.t10.error = String(e && e.message || e).slice(0, 300); }
    finally { await win.evaluate(async () => { try { setMesasInlineView("transacciones", { persist: false }); } catch (e) {} }); }

    // ---------- 11) avisos: los de «exito» redundantes no salen; los demas si; un aviso repetido no se apila y nunca hay mas de 3 a la vez
    out.t11 = await win.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const c = document.getElementById("toastContainer");
      const limpiar = async () => { c.innerHTML = ""; __toastLive.clear(); await sleep(50); };
      const n = () => c.children.length;
      const r = {};
      await limpiar();
      toast("Ticket dividido en 2 partes.", "ok", "Dividir"); toast("Mesas fusionadas en M2 (Sala 1).", "ok", "Mesas"); toast("Pedido de mesa eliminado.", "ok", "Pedidos"); toast("Pedido actualizado ✅", "ok", "Aparcados");
      toast("Alérgeno añadido.", "ok", "Alérgenos"); toast("Tamaño de letra restablecido.", "ok", "Productos"); toast("Familia añadida a reglas de comanda.", "ok", "Comandas");
      toast("Auto-impresión activada ✅", "info", "Opciones"); toast("Siguiente parte lista: 2/2.", "info", "Dividir"); toast("Reanudado cobro dividido: parte 1/2.", "info", "Dividir");
      r.silenciados = n();
      await limpiar();
      toast("Venta cobrada ✅ (Efectivo - A-1)", "ok", "Cobrar"); r.cobro = n();
      await limpiar(); toast("Sync completada.", "ok", "Aparcados"); r.sync = n();
      await limpiar(); toast("Stock actualizado correctamente.", "ok", "Stock"); r.stock = n();
      await limpiar(); toast("Precio base actualizado correctamente ✅", "ok", "Productos"); r.precio = n();
      await limpiar(); toast("Opciones importadas (3) ✅", "ok", "Opciones"); r.importadas = n();
      await limpiar(); toast("No se pudo guardar.", "err", "Pedidos"); r.error = n();
      await limpiar(); toast("Esta mesa se actualizó desde otro terminal mientras estaba abierta.", "info", "Mesas"); r.otroTerminal = n();
      await limpiar();
      for (let i = 0; i < 4; i++) toast("Esta mesa se actualizó desde otro terminal mientras estaba abierta.", "info", "Mesas");
      r.repetido = n();
      await limpiar();
      for (let i = 0; i < 6; i++) toast("Aviso distinto " + i, "warn", "Prueba");
      r.tope = n();
      await limpiar();
      toast("A", "err", "Prueba"); toast("B", "warn", "Prueba"); toast("C", "warn", "Prueba"); toast("D", "warn", "Prueba");
      r.conErrorTope = { n: n(), hayError: !!c.querySelector(".toast.err") };
      await limpiar();
      return r;
    });

    // ---------- 12) mover SOLO UNA PARTE de una cuenta dividida a otra mesa (la cuenta queda repartida entre dos mesas)
    out.t12 = {};
    try {
      const dividirM3 = async () => win.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        await window.__clean();
        __sel("tut-room-1::m3"); await sleep(800);
        addToCart(__prods[0]); addToCart(__prods[1]); addToCart(__prods[0]); addToCart(__prods[2]); await sleep(6000);
        document.getElementById("parkedSplitBtn").click();
        for (let i = 0; i < 40 && document.getElementById("splitTicketOverlay").classList.contains("hidden"); i++) await sleep(300);
        const sel = document.getElementById("splitTicketModeSelect"); sel.value = "items"; sel.dispatchEvent(new Event("change"));
        splitTicketPartsCount = 2; if (splitTicketPartsInput) splitTicketPartsInput.value = "2"; splitTicketMode = "items";
        initSplitItemsMatrixFromCurrentCart();
        splitTicketItemsMatrix = cart.map((l, i) => (i % 2 === 0 ? [Number(l.qty), 0] : [0, Number(l.qty)]));
        await confirmSplitTicket(); await sleep(2500);
        const partes = window.__mine().map((t) => ({ id: String(t.id), name: String(t.name), mesa: String(t.mesaUid).slice(-2), part: t.splitPart, total: Number(t.total) }));
        return { partes };
      });
      const s1 = await dividirM3();
      out.t12.s1_antes = s1;
      const part2 = s1.partes.find((p) => p.part === 2);
      out.t12.s1_pregunta = await win.evaluate(async (id2) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const real = confirmModal; let n = 0;
        confirmModal = (t, x, o) => { n++; if (n === 1) return Promise.resolve("part"); return real(t, x, o); };
        const p = askMoveScopeForSplitMesa("tut-room-1::m3");
        await sleep(500);
        const hay = document.querySelectorAll("#pickPartList [data-pick-part]").length;
        const botones = Array.from(document.querySelectorAll("#pickPartList [data-pick-part]")).map((b) => b.textContent.trim());
        const b2 = document.querySelector('#pickPartList [data-pick-part="1"]'); if (b2) b2.click();
        const r = await p; confirmModal = real;
        return { r, hay, botones, esperado: id2 };
      }, part2.id);
      out.t12.s1_mover = await win.evaluate(async (id2) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const ok = moveMesaPendingTicket("tut-room-1::m3", "tut-room-1::m2", { keepSelection: true, onlyTicketId: id2 });
        await sleep(3000);
        const st = loadMesasTablesStateForInline();
        const p1 = window.__mine().find((t) => t.splitPart === 1), p2 = window.__mine().find((t) => t.splitPart === 2);
        const nav1 = getCurrentSplitNavigationState(p1), nav2 = getCurrentSplitNavigationState(p2);
        return {
          ok, loc: window.__loc().map((t) => t.mesa + ":" + String(t.nombre).slice(-5)).sort(),
          enlaceM3: String((st.tableTicketMap || {})["tut-room-1::m3"] || ""), enlaceM2: String((st.tableTicketMap || {})["tut-room-1::m2"] || ""),
          idP1: String(p1.id), idP2: String(p2.id), estadoM3: (st.tableStates || {})["tut-room-1::m3"],
          navP1: { prev: nav1.prevIndex, next: nav1.nextIndex }, navP2: { prev: nav2.prevIndex, next: nav2.nextIndex },
          grupoEntero: getSplitGroupTicketsOrdered(p1.splitGroupId).length, soloM3: getSplitGroupTicketsOrdered(p1.splitGroupId, "tut-room-1::m3").length,
        };
      }, part2.id);
      out.t12.s1_revertir = await win.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        __sel("tut-room-1::m3"); await sleep(1500);
        document.getElementById("parkedSplitBtn").click();
        for (let i = 0; i < 40 && document.getElementById("splitTicketOverlay").classList.contains("hidden"); i++) await sleep(300);
        splitTicketPartsCount = 1; if (splitTicketPartsInput) splitTicketPartsInput.value = "1";
        await confirmSplitTicket(); await sleep(2500);
        return { error: splitTicketError ? splitTicketError.textContent : "", loc: window.__loc().map((t) => t.mesa + ":" + String(t.nombre).slice(-6)).sort() };
      });
      const s2 = await dividirM3();
      const p2b = s2.partes.find((p) => p.part === 2);
      out.t12.s2 = await win.evaluate(async (id2) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        __sel("tut-room-1::m1"); await sleep(800); addToCart(__prods[3]); addToCart(__prods[4]); await sleep(6000);
        const suma = (k, d) => Math.round(window.__loc().reduce((a, t) => a + t[k], 0) * d) / d;
        const antes = { u: suma("u", 1000), total: suma("total", 100) };
        const ok = await mergeMesaPendingTickets("tut-room-1::m3", "tut-room-1::m1", { keepSelection: true, onlyTicketId: id2 });
        await sleep(3500);
        const st = loadMesasTablesStateForInline();
        const despues = { u: suma("u", 1000), total: suma("total", 100) };
        return { ok, antes, despues, loc: window.__loc().map((t) => t.mesa + ":" + t.n).sort(), estadoM3: (st.tableStates || {})["tut-room-1::m3"], enM3: (getMesasPendingTicketByUid(st, "tut-room-1::m3") || {}).name || null };
      }, p2b.id);
    } catch (e) { out.t12.error = String(e && e.message || e).slice(0, 300); }

    // ---------- 13) «Preparar cuentas separadas»: una mesa LIBRE se divide en N cuentas vacias antes de que se sienten
    out.t13 = {};
    try {
      out.t13.prep = await win.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        await window.__clean();
        const realPad = openNumPad; let preguntado = null;
        openNumPad = (v, cb, titulo) => { preguntado = { v, titulo }; cb("3", { phase: "confirm" }); };
        setMesasInlineView("mapa", { persist: false }); await sleep(2500);
        window.postMessage({ type: "tpv:mesas-prepare-split", uid: "tut-room-1::m4" }, "*");
        await sleep(2500);
        openNumPad = realPad;
        const st = loadMesasTablesStateForInline();
        return { preguntado, tickets: window.__mine().map((t) => ({ id: String(t.id), name: String(t.name), mesa: String(t.mesaUid).slice(-2), n: (t.items || []).length, part: t.splitPart, tot: t.splitTotal, grupo: String(t.splitGroupId || "").slice(0, 6) })), enlace: String((st.tableTicketMap || {})["tut-room-1::m4"] || ""), estado: (st.tableStates || {})["tut-room-1::m4"] };
      });
      let frame13 = null;
      for (let i = 0; i < 60 && !frame13; i++) {
        frame13 = win.frames().find((f) => f.url().includes("mesas.html")) || null;
        if (frame13 && !(await frame13.evaluate(() => typeof startMapMove === "function" && !!document.querySelector(".gestion-obj.table")).catch(() => false))) frame13 = null;
        if (!frame13) await sleep(500);
      }
      if (!frame13) throw new Error("No se encontro el plano de mesas (iframe)");
      await frame13.evaluate(() => { window.postMessage({ type: "tpv:mesas-state-changed" }, "*"); }); await sleep(1500);
      out.t13.plano = await frame13.evaluate(() => { const n = document.querySelector('.gestion-obj.table[data-table-uid="tut-room-1::m4"]'); return { clase: n ? (n.className.match(/state-\w+/) || [""])[0] : "-", partes: (n && n.querySelector(".gestion-parts") || {}).textContent || "" }; });
      // el boton de la ficha de una mesa libre
      out.t13.boton = await frame13.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const b = document.querySelector('.gestion-obj.table[data-table-uid="tut-room-1::m3"] .gestion-opt-btn'); if (!b) return { b: false };
        b.click(); await sleep(300);
        const act = document.querySelector('.gestion-tooltip [data-table-act="prepare-split"]');
        const r = { b: true, hayPreparar: !!act };
        closeMapTooltip(); return r;
      });
      // sobreviven a un refresco desde el servidor y estan en el servidor
      out.t13.servidor = await win.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        await refreshRemoteParkedReservationsOnly(); await sleep(2500);
        const locales = window.__mine().filter((t) => String(t.mesaUid).endsWith("m4")).length;
        const resp = await fetch(`${TPV_SYNC_API_URL}?action=list-parked-reservations&slug=${encodeURIComponent(getCurrentSlugForReservations())}&codalmacen=${encodeURIComponent(getCurrentWarehouseCode())}`, { headers: { "X-TPV-API-KEY": getTpvSyncApiKey() }, cache: "no-store" });
        const j = await resp.json();
        const rem = (Array.isArray(j?.data) ? j.data : []).filter((x) => !x.paid && String(x.mesaUid || "").endsWith("m4")).map((x) => ({ name: String(x.name || ""), n: (x.items || []).length }));
        return { locales, remotas: rem };
      });
      // se abre la mesa: carga la cuenta 1, se le añade un producto y las flechas llevan a la 2
      out.t13.abrir = await win.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        setMesasInlineView("transacciones", { persist: false }); await sleep(800);
        __sel("tut-room-1::m4"); await sleep(1500);
        const cargada = String(getCurrentLoadedParkedTicket()?.name || "");
        addToCart(__prods[0]); await sleep(3000);
        const t1 = getCurrentLoadedParkedTicket();
        const nav = getCurrentSplitNavigationState(t1);
        const lineas = window.__mine().filter((t) => String(t.mesaUid).endsWith("m4")).map((t) => String(t.name).slice(-5) + ":" + (t.items || []).length).sort();
        return { cargada, nav: { prev: nav.prevIndex, next: nav.nextIndex }, lineas };
      });
    } catch (e) { out.t13.error = String(e && e.message || e).slice(0, 300); }
    finally { await win.evaluate(async () => { try { setMesasInlineView("transacciones", { persist: false }); } catch (e) {} }); }

    // ---------- 14) comprobacion de conexion: pide una tabla pequeña (series) cada ~10 s si todo va bien, no la de facturas cada 5 s; y un corte se sigue detectando
    out.t14 = await win.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const r = {};
      const urls = [];
      const real = window.fetch;
      window.fetch = function (u, o) { urls.push([Date.now(), String(u)]); return real.apply(this, arguments); };
      await sleep(36000);
      const pings = urls.filter((x) => /\/series\?limit=1/.test(x[1])).map((x) => x[0]);
      r.pings = pings.length;
      r.facturas = urls.filter((x) => /\/facturaclientes\?limit=1/.test(x[1])).length;
      const gaps = pings.slice(1).map((t, i) => Math.round((t - pings[i]) / 100) / 10);
      r.huecos = gaps;
      // corte: la consulta de conexion falla
      window.fetch = function (u, o) { urls.push([Date.now(), String(u)]); if (/\/series\?limit=1/.test(String(u))) return Promise.reject(new TypeError("Failed to fetch")); return real.apply(this, arguments); };
      const t0 = Date.now(); r.offlineTras = null;
      for (let i = 0; i < 60 && r.offlineTras === null; i++) { await sleep(500); if (TPV_STATE.offline === true) r.offlineTras = Math.round((Date.now() - t0) / 1000); }
      window.fetch = real;
      const t1 = Date.now(); r.onlineTras = null;
      for (let i = 0; i < 80 && r.onlineTras === null; i++) { await sleep(500); if (TPV_STATE.offline === false) r.onlineTras = Math.round((Date.now() - t1) / 1000); }
      // permisos: si la clave no puede leer las series (403), vuelve a la consulta de siempre y NO se da por desconectado
      r.fallback = await (async () => {
        __fsPingUseFacturas = false;
        const seen = [];
        window.fetch = function (u, o) { const url = String(u); seen.push(url); if (/\/series\?limit=1/.test(url)) return Promise.resolve(new Response("{}", { status: 403 })); return real.apply(this, arguments); };
        for (let i = 0; i < 40 && !seen.some((x) => /facturaclientes\?limit=1/.test(x)); i++) await sleep(500);
        await sleep(1500);
        const res = { facturasUsadas: seen.some((x) => /facturaclientes\?limit=1/.test(x)), desconectado: TPV_STATE.offline === true, usaFacturas: __fsPingUseFacturas === true };
        window.fetch = real; __fsPingUseFacturas = false;
        return res;
      })();
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
    const t1 = out.t1 || {}, t2 = out.t2 || {}, t3 = out.t3 || {}, t4 = out.t4 || {}, t5 = out.t5 || {}, t6 = out.t6 || {}, t7 = out.t7 || {}, t8 = out.t8 || {}, t9 = out.t9 || {}, t10 = out.t10 || {}, t11 = out.t11 || {}, t12 = out.t12 || {}, t13 = out.t13 || {}, t14 = out.t14 || {};
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
      ok("8) Plano: «Mover / fusionar» pone el aviso arriba, marca la mesa de origen y deja el resto como posible destino; «Cancelar» lo quita y no cambia nada", !t8.error && (t8.eligiendo || {}).banner === true && /Moviendo la mesa/.test((t8.eligiendo || {}).texto || "") && (t8.eligiendo || {}).origen === 1 && (t8.eligiendo || {}).destinos >= 1 && (t8.cancelado || {}).banner === false && (t8.cancelado || {}).origen === 0 && JSON.stringify(t8.sinCambios) === JSON.stringify(["m1", "m2"]), { eligiendo: t8.eligiendo, cancelado: t8.cancelado, sinCambios: t8.sinCambios, error: t8.error }),
      ok("8) Plano: cada mesa lleva un botón «⋯» visible (≥ 36 px) que abre su ficha sin mantener pulsado; desde ahí se llega a «Mover / fusionar», el aviso aparece sin botones y al cancelar vuelven", !t8.error && (t8.viaBoton || {}).conBoton === (t8.viaBoton || {}).mesas && (t8.viaBoton || {}).mesas >= 3 && (t8.viaBoton || {}).ancho >= 36 && (t8.viaBoton || {}).fichaAbierta === true && (t8.viaBoton || {}).hayMover === true && (t8.viaBoton || {}).avisoMover === true && (t8.viaBoton || {}).sinBotonesEnMover === true && (t8.viaBoton || {}).botonesVuelven === true, t8.viaBoton),
      ok("8) Plano: mover a una mesa LIBRE lleva el pedido a la nueva mesa, deja la de origen libre y NO cambia la mesa seleccionada en el TPV", !t8.error && ((t8.tras_mover || {}).loc || []).map((t) => t.mesa).sort().join() === "m2,m3" && ((t8.tras_mover || {}).sel || "") === ((t8.prep || {}).sel || "x"), { prep: t8.prep && { sel: t8.prep.sel, u: t8.prep.u }, tras_mover: t8.tras_mover }),
      ok("8) Plano: fusionar con una mesa OCUPADA pide confirmación con los totales y deja UNA sola mesa con las mismas unidades y el mismo total", !t8.error && ((t8.tras_fusion || {}).loc || []).length === 1 && (((t8.tras_fusion || {}).loc || [])[0] || {}).mesa === "m2" && (((t8.tras_fusion || {}).loc || [])[0] || {}).u === (t8.prep || {}).u && Math.abs((((t8.tras_fusion || {}).loc || [])[0] || {}).total - (t8.prep || {}).total) < 0.02 && ((t8.tras_fusion || {}).confirmaciones || []).some((c) => /^Fusionar mesas: Se juntará la mesa .* con la mesa /.test(c)), t8.tras_fusion),
      ok("9) Plano: tras mover una cuenta dividida la mesa de origen se ve libre y la de destino ocupada, y NUNCA vuelve a verse la de origen ocupada (antes quedaban dos mesas con el mismo importe)", !t9.error && (t9.mapa || []).length >= 2 && (t9.mapa || []).slice(-1)[0][1] === "m3=state-libre m2=state-ocupada" && !(t9.mapa || []).slice(1).some((r) => /m3=state-ocupada/.test(r[1])), t9.mapa),
      ok("9) Plano: una mesa con la cuenta dividida enseña la SUMA de las partes y la etiqueta «2 partes» (antes solo el importe de una parte)", !t9.error && (t9.etiqueta || {}).partes === "2 partes" && Math.abs(Number(String((t9.etiqueta || {}).total || "").replace(/[^0-9,]/g, "").replace(",", ".")) - ((t9.prep || []).reduce((a, t) => a + t.total, 0))) < 0.02, { etiqueta: t9.etiqueta, partes: (t9.prep || []).map((t) => t.total) }),
      ok("9) En el TPV ninguna parte de la cuenta dividida vuelve un instante a la mesa de origen al refrescar desde el servidor", !t9.error && (t9.host || []).length >= 2 && !(t9.host || []).slice(1).some((r) => /@m3/.test(r)), t9.host),
      ok("9) Con la ficha de una mesa abierta, un cambio hecho mientras tanto se aplica al cerrarla (antes el plano se quedaba desfasado)", !t9.error && (t9.conFichaAbierta || {}).ficha === true && (t9.alCerrarFicha || {}).m3 === "state-ocupada" && (t9.alCerrarFicha || {}).m2 === "state-libre", { conFichaAbierta: t9.conFichaAbierta, alCerrarFicha: t9.alCerrarFicha }),
      ok("10) Mover una cuenta sin dividir 6 veces seguidas (ida y vuelta) deja SIEMPRE el pedido en la mesa de destino (antes se deshacia solo cuando el guardado chocaba con otro)", !t10.error && (t10.vueltas || []).length === 6 && (t10.vueltas || []).every((v) => v.ok === true && v.loc.length === 1 && v.loc[0] === v.hasta), t10),
      ok("11) Avisos: los de éxito redundantes (dividir, mover/fusionar, guardar/borrar pedido, interruptores de Opciones) no salen", (t11.silenciados) === 0, t11),
      ok("11) Avisos: los de cobro, sincronización manual, importación de opciones, errores y cambios hechos desde otro terminal SÍ salen", t11.cobro === 1 && t11.sync === 1 && t11.stock === 1 && t11.precio === 1 && t11.importadas === 1 && t11.error === 1 && t11.otroTerminal === 1, t11),
      ok("11) Avisos: uno idéntico repetido 4 veces sale UNA vez, nunca hay más de 3 a la vez y un error no se retira por el tope si hay otros", t11.repetido === 1 && t11.tope === 3 && (t11.conErrorTope || {}).n === 3 && (t11.conErrorTope || {}).hayError === true, t11),
      ok("12) Cuenta dividida: el cuadro pregunta «toda la cuenta o una parte» y, con «una parte», deja elegir cual (devuelve el pedido de esa parte)", !t12.error && (t12.s1_pregunta || {}).hay === 2 && !!(t12.s1_pregunta || {}).r && (t12.s1_pregunta || {}).r.onlyTicketId === (t12.s1_pregunta || {}).esperado, t12.s1_pregunta),
      ok("12) Mover SOLO una parte: la 1/2 se queda en M3 y la 2/2 pasa a M2; cada mesa enlaza con su parte y M3 sigue ocupada", !t12.error && JSON.stringify((t12.s1_mover || {}).loc) === JSON.stringify(["m2:(2/2)", "m3:(1/2)"]) && (t12.s1_mover || {}).enlaceM3 === (t12.s1_mover || {}).idP1 && (t12.s1_mover || {}).enlaceM2 === (t12.s1_mover || {}).idP2 && (t12.s1_mover || {}).estadoM3 === "ocupada", t12.s1_mover),
      ok("12) Con la cuenta repartida entre dos mesas, las flechas del carrito no saltan a la parte de la OTRA mesa (el grupo tiene 2 partes pero cada mesa solo ve la suya)", !t12.error && (t12.s1_mover || {}).grupoEntero === 2 && (t12.s1_mover || {}).soloM3 === 1 && ((t12.s1_mover || {}).navP1 || {}).prev < 0 && ((t12.s1_mover || {}).navP1 || {}).next < 0 && ((t12.s1_mover || {}).navP2 || {}).prev < 0 && ((t12.s1_mover || {}).navP2 || {}).next < 0, t12.s1_mover),
      ok("12) Revertir la división desde M3 solo une lo de M3: la parte de M2 no se toca", !t12.error && (t12.s1_revertir || {}).error === "" && ((t12.s1_revertir || {}).loc || []).some((l) => /^m2:.*\(2\/2\)$/.test(l)) && ((t12.s1_revertir || {}).loc || []).some((l) => /^m3:/.test(l)), t12.s1_revertir),
      ok("12) Fusionar SOLO una parte con otra mesa ocupada: la mesa de origen sigue ocupada con la parte que se queda y no se pierden unidades ni importe", !t12.error && (t12.s2 || {}).ok === true && (t12.s2 || {}).estadoM3 === "ocupada" && /\(1\/2\)$/.test(String((t12.s2 || {}).enM3 || "")) && ((t12.s2 || {}).despues || {}).u === ((t12.s2 || {}).antes || {}).u && Math.abs(((t12.s2 || {}).despues || {}).total - ((t12.s2 || {}).antes || {}).total) < 0.02, t12.s2),
      ok("13) Preparar cuentas separadas: pregunta cuantas y crea 3 cuentas vacías (1/3, 2/3 y 3/3) del mismo grupo en la mesa libre, que pasa a ocupada y enlaza con la 1/3", !t13.error && (t13.prep || {}).preguntado && (t13.prep.tickets || []).length === 3 && JSON.stringify(t13.prep.tickets.map((x) => x.name.slice(-5)).sort()) === JSON.stringify(["(1/3)", "(2/3)", "(3/3)"]) && t13.prep.tickets.every((x) => x.mesa === "m4" && x.n === 0 && x.tot === 3 && x.grupo === t13.prep.tickets[0].grupo) && t13.prep.estado === "ocupada" && t13.prep.enlace === (t13.prep.tickets.find((x) => x.part === 1) || {}).id, t13.prep),
      ok("13) Preparar cuentas separadas: el plano enseña la mesa ocupada con la etiqueta «3 partes» y la ficha de una mesa LIBRE trae el botón «Preparar cuentas separadas»", !t13.error && (t13.plano || {}).clase === "state-ocupada" && (t13.plano || {}).partes === "3 partes" && (t13.boton || {}).hayPreparar === true, { plano: t13.plano, boton: t13.boton }),
      ok("13) Las cuentas preparadas (vacías) no se pierden: sobreviven a un refresco desde el servidor y están guardadas en el servidor", !t13.error && (t13.servidor || {}).locales === 3 && ((t13.servidor || {}).remotas || []).length === 3, t13.servidor),
      ok("13) Al abrir la mesa se carga la cuenta 1/3, se le añade un producto sin tocar las demás, y las flechas llevan a las otras cuentas de la misma mesa", !t13.error && /\(1\/3\)$/.test((t13.abrir || {}).cargada || "") && JSON.stringify(((t13.abrir || {}).lineas || [])) === JSON.stringify(["(1/3):1", "(2/3):0", "(3/3):0"]) && ((t13.abrir || {}).nav || {}).next >= 0, t13.abrir),
      ok("14) Conexión: el TPV comprueba FacturaScripts con una tabla pequeña (series) y ya NO pide una factura cada 5 s", (t14.pings || 0) >= 2 && t14.facturas === 0, t14),
      ok("14) Conexión: con todo bien comprueba cada ~10 s (no cada 5 s)", (t14.huecos || []).length >= 1 && (t14.huecos || []).every((g) => g >= 8 && g <= 14), t14.huecos),
      ok("14) Conexión: si falla la comprobación, el TPV detecta el corte en menos de 25 s y recupera la conexión en menos de 20 s al volver", t14.offlineTras !== null && t14.offlineTras <= 25 && t14.onlineTras !== null && t14.onlineTras <= 20, { offlineTras: t14.offlineTras, onlineTras: t14.onlineTras }),
      ok("14) Conexión: si la clave de un cliente no puede leer las series (403), el TPV vuelve a la consulta de siempre y no se da por desconectado", ((t14.fallback || {}).facturasUsadas === true) && ((t14.fallback || {}).desconectado === false) && ((t14.fallback || {}).usaFacturas === true), t14.fallback),
      ok("Al terminar las mesas de prueba quedan limpias", Array.isArray(out.limpio) && out.limpio.length === 0, out.limpio),
    ]);
    clearTimeout(hard); kill();
    process.exit(verdict.fails ? 1 : 0);
  }
})();
