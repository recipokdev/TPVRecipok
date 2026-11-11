// run-split-tpv-normal.js -- prueba MANUAL (no entra en npm test) de "Dividir cuenta" en el TPV normal (fuera de Modo Mesas).
//
// Con UN TPV real contra el demo (perfil persistente de run-two-tpv.js con sesion ya iniciada; nunca se escribe PIN):
//   1) carrito nuevo de TPV normal con 2 productos con stock gestionado (2 unidades de cada uno);
//   2) pulsa "Dividir" (junto al total): se aparca el pedido y se abre el asistente;
//   3) division igualitaria en 2 partes;
//   4) cobra la parte 1 -> debe cargarse SOLA la parte 2 -> cobra la parte 2;
//   5) comprueba que el stock final de cada producto = inicial - 2 (el neto de ventas) y deja los dos productos
//      con su stock inicial (solo demo). Imprime los ids de ticket para revisar el registro de reservas en el servidor.
// COBRA DE VERDAD en el demo (2 facturas de prueba).
// Con --mesas: mismo recorrido en Modo Mesas (mesa M3 del demo, que deja limpia) para comprobar que Mesas no se rompe.
// Con --no-ops: apaga en el cliente el piloto de operaciones por partes (hoy solo activo en el demo) para imitar a un cliente real.
// Con --trace: registra cada llamada a parkCurrentCart / autoguardado (con su pila) para investigar duplicados.
// Con --merge: tras dividir, deshace la division (Partes = 1) y cobra el pedido unificado de una sola vez.
// Uso: node tools/tests/run-split-tpv-normal.js [ruta-capturas] [--merge] [--mesas]
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os"), fs = require("fs");
const { _electron: electron } = require("playwright");
// TPV_ROOT: ejecutar el arnes contra otra copia del codigo (p. ej. una copia de main para comparar).
const ROOT = process.env.TPV_ROOT ? path.resolve(process.env.TPV_ROOT) : path.resolve(__dirname, "..", "..");
const MERGE = process.argv.includes("--merge");
const MESAS = process.argv.includes("--mesas");
const NO_OPS = process.argv.includes("--no-ops");
const TRACE = process.argv.includes("--trace");
const TABLE = "tut-room-1::m3";
const SHOTS = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kills = [];

async function launch(dirName, label) {
  const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), dirName), TPV_TEST_LABEL: label };
  delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
  // TPV_EXE: lanzar la version EMPAQUETADA (p. ej. C:/tmp/tpv-split-build/win-unpacked/TPV-Recipok.exe) en vez del codigo fuente.
  const app = process.env.TPV_EXE
    ? await electron.launch({ executablePath: process.env.TPV_EXE, args: [], env })
    : await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  kills.push(() => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} });
  let win = null; const t0 = Date.now();
  while (!win && Date.now() - t0 < 60000) {
    for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
    if (!win) await sleep(500);
  }
  return { app, pid, win, label };
}

async function drivePay(X) {
  await X.win.evaluate(() => { document.querySelector("#payBtn")?.click(); });
  await X.win.waitForSelector("#payModal:not(.hidden), .pay-modal:not(.hidden)", { timeout: 8000 }).catch(() => {});
  await sleep(300);
  const codpago = await X.win.evaluate(() => document.querySelector("input.pay-amount")?.getAttribute("data-codpago") || null);
  if (codpago) {
    await X.win.evaluate((c) => { document.querySelector(`input.pay-amount[data-codpago="${c}"]`)?.parentElement?.querySelector("button.pay-max")?.click(); }, codpago);
    await sleep(200);
    await X.win.evaluate(() => { document.getElementById("paySaveBtn")?.click(); });
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const st = await X.win.evaluate(() => {
      const ov = document.getElementById("msgOverlay");
      const msg = ov && !ov.classList.contains("hidden") ? (document.getElementById("msgText")?.textContent || "").slice(0, 160) : "";
      return { vacio: Array.isArray(cart) && cart.length === 0, msg };
    });
    if (st.vacio || st.msg) return st;
    await sleep(400);
  }
  return { timeout: true };
}

// Comprobaciones (veredicto) para la bateria de pruebas: ver tools/tests/battery/.
function buildChecks(out) {
  const c = [];
  const st = Array.isArray(out.stock) ? out.stock : [];
  c.push(["La prueba terminó sin errores", !out.ERROR, out.ERROR || ""]);
  if (!MESAS) c.push(["El botón «Dividir» aparece junto al total del carrito", out.boton_dividir_visible === true]);
  c.push(["Se abre el asistente de división", out.asistente_abierto === true]);
  c.push(["El pedido se divide en 2 partes", (out.tras_dividir?.partes || []).length === 2, JSON.stringify((out.tras_dividir?.partes || []).map((p) => p.name))]);
  if (MERGE) {
    c.push(["Deshacer la división deja un solo pedido (sin partes)", out.tras_unificar?.partes === 0 && !/\(\d+\/\d+\)/.test(String(out.tras_unificar?.cargado || "")), String(out.tras_unificar?.cargado)]);
  } else {
    c.push(["Al cobrar la parte 1 se abre sola la parte 2", /2\/2/.test(String(out.tras_cobro1?.cargado || "")), String(out.tras_cobro1?.cargado)]);
  }
  c.push(["No queda ninguna parte pendiente tras cobrar todo", out.tras_cobro2?.pendientes === 0, `pendientes ${out.tras_cobro2?.pendientes}`]);
  st.forEach((s) => c.push([`El stock de «${s.nombre}» cuadra tras vender y cobrar`, s.DESCUADRE === 0, `descuadre ${s.DESCUADRE}`]));
  if (!st.length) c.push(["Se pudo leer el stock final", false]);
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 280000);
  const out = {};
  let A; const prods = [];
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    await sleep(8000);
    out.estado = await A.win.evaluate(async ([MESAS, NO_OPS]) => {
      await setMesasInlineModeEnabled(!!MESAS, { persist: false });
      if (MESAS) { setMesasInlineView("transacciones", { persist: false }); }
      if (NO_OPS) { parkedOpsIsEnabled = () => false; } // como los clientes reales: guardado entero, sin el piloto de operaciones
      if (typeof splitTpvEnabled !== "undefined") { // (en una version sin la funcion, el arnes tambien sirve)
        splitTpvEnabled = true; // solo en memoria: no toca la configuracion guardada del perfil
        refreshSplitFromCartButtonUI();
      }
      window.__dismiss = () => { const ov = document.getElementById("msgOverlay"); if (ov && !ov.classList.contains("hidden")) { Array.from(ov.querySelectorAll("button")).pop()?.click(); } };
      return { login: hasActiveLoginSession(), cajaAbierta: !!cashSession?.open, mesas: !!MESAS_INLINE_ACTIVE };
    }, [MESAS, NO_OPS]);
    if (TRACE) {
      await A.win.evaluate(() => {
        window.__ptrace = [];
        const T0 = Date.now();
        const stack = () => String(new Error().stack || "").split(String.fromCharCode(10)).slice(3, 9).map((l) => l.trim().replace(/^at /, "")).join(" < ");
        const wrap = (name, describe) => {
          const orig = window[name] || eval(name);
          const w = function (...a) {
            try { window.__ptrace.push({ t: ((Date.now() - T0) / 1000).toFixed(2), fn: name, ...describe(a), stack: stack() }); } catch (e) { window.__ptrace.push({ fn: name, err: String(e) }); }
            return orig.apply(this, a);
          };
          try { eval(`${name} = w`); } catch (e) { window.__ptrace.push({ fn: name, installErr: String(e) }); }
        };
        const loadedInfo = () => { const t = getCurrentLoadedParkedTicket(); return { loaded: t ? String(t.id).slice(-5) : null, closing: !!t?.closingInProgress, paid: !!t?.paid, cartLen: cart.length }; };
        wrap("parkCurrentCart", (a) => ({ silent: a[2]?.silentAutoSave === true, ...loadedInfo() }));
        wrap("scheduleMesasAutoSave", () => ({ ...loadedInfo() }));
        wrap("beginParkedCheckoutLock", (a) => ({ idx: a[0] }));
        wrap("markParkedTicketAsPaidByIndex", (a) => ({ idx: a[0] }));
      });
    }
    if (!out.estado.login || !out.estado.cajaAbierta) throw new Error("Falta sesion iniciada o caja abierta (no se escribe PIN): " + JSON.stringify(out.estado));

    const pick = await A.win.evaluate(async () => {
      const cand = products.filter((p) => {
        const id = getProductBaseId(p);
        const st = parseManagedStockValue(p.stockfis);
        return id && st !== null && st >= 8 && Number(p.price) > 0 && !p.variants && !isOfferPackProductById(id) && !productHasDerivedStockMarker(p);
      });
      const chosen = cand.slice(-2);
      const rows = [];
      for (const p of chosen) {
        const id = getProductBaseId(p);
        const r = await fetchStockRowsByProductReference(findProductByBaseId(id) || p);
        const row = pickStockRowByWarehouse(r, getCurrentWarehouseCode(), { strict: false });
        rows.push({ id, name: String(p.name).slice(0, 30), stock: Number(row?.cantidad) });
      }
      return rows;
    });
    if (pick.length < 2) throw new Error("No hay 2 productos con stock gestionado >= 8 en el demo");
    prods.push(...pick);
    out.productos = pick;

    const readStock = (id) => A.win.evaluate(async (id) => {
      const rows = await fetchStockRowsByProductReference(findProductByBaseId(id));
      const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
      return Number(row?.cantidad);
    }, id);

    // 1) carrito nuevo con 2 unidades de cada producto
    if (MESAS) {
      // Mesa limpia: borra cualquier pedido sin cobrar de M3 (de pruebas anteriores) y su borrador antes de empezar.
      out.limpieza_previa = await A.win.evaluate(async (TABLE) => {
        cart = []; setCurrentParkedTicketIndex(null); renderCart();
        let borrados = 0;
        for (let round = 0; round < 3; round++) {
          const mine = parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE);
          if (!mine.length) break;
          for (const t of mine) { try { await apiDeleteParkedReservation(t); borrados++; } catch (e) {} }
          // fuera tambien de la lista local (si no, vuelve a salir como pedido abierto de la mesa)
          for (let i = parkedTickets.length - 1; i >= 0; i--) {
            if (!parkedTickets[i].paid && parkedTickets[i].mesaUid === TABLE) parkedTickets.splice(i, 1);
          }
          saveParkedTicketsCache();
          await new Promise((r) => setTimeout(r, 1500));
          await refreshRemoteParkedReservationsOnly().catch(() => {});
        }
        const st = loadMesasTablesStateForInline();
        if (st?.tableTicketMap) delete st.tableTicketMap[TABLE];
        if (st?.draftCartByTable) delete st.draftCartByTable[TABLE];
        saveMesasTablesStateForInline(st);
        return { borrados, quedan: parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE).length };
      }, TABLE);
      await sleep(1500);
      await A.win.evaluate((TABLE) => { updateMesasSelectionFromContext({ tableUid: TABLE }); syncTpvCartWithSelectedMesa(); }, TABLE);
      await sleep(800);
    }
    if (MESAS) {
      // En Mesas los productos se añaden como lo haria un camarero (addToCart, 1 vez cada uno) y luego se sube la cantidad
      // a 2 con la propia funcion del carrito; despues se espera a que el pedido de la mesa quede GUARDADO con eso.
      await A.win.evaluate(async (ids) => {
        for (const id of ids) {
          for (let k = 0; k < 2; k++) { await addToCart(findProductByBaseId(id)); await new Promise((r) => setTimeout(r, 1500)); }
        }
      }, prods.map((p) => p.id));
      const tS = Date.now();
      while (Date.now() - tS < 30000) {
        const okSaved = await A.win.evaluate(() => {
          const t = getCurrentLoadedParkedTicket();
          const sum = (arr) => arr.reduce((a, l) => a + Number(l.qty || 0), 0);
          return !!t && cart.length >= 2 && t.items?.length === cart.length && sum(t.items) === sum(cart) && sum(cart) === 4;
        });
        if (okSaved) break;
        await sleep(500);
      }
      await sleep(2500);
    } else {
      await A.win.evaluate(async ([ids, RENAME]) => {
        cart = ids.map((id) => buildCartLine(findProductByBaseId(id), 2));
        // Solo para sacar capturas del manual: nombres de muestra en pantalla (el catalogo de la demo copia el de un cliente real).
        if (RENAME) cart.forEach((l, i) => { l.name = ["Café con leche", "Croissant"][i] || l.name; l.descripcion = l.name; l.secondaryName = ""; l.descripcion2 = ""; });
        renderCart();
      }, [prods.map((p) => p.id), !!process.env.TPV_SHOT_RENAME]);
    }
    await sleep(MESAS ? 6000 : 600); // en Mesas el autoguardado crea el pedido de la mesa
    out.boton_dividir_visible = await A.win.evaluate(() => !!document.getElementById("splitFromCartBtn") && !document.getElementById("splitFromCartBtn").classList.contains("hidden"));
    if (SHOTS) await A.win.screenshot({ path: path.join(SHOTS, "split_1_carrito.png") });

    // 2) pulsar Dividir (en Mesas: el boton Dividir del pedido abierto)
    await A.win.evaluate((MESAS) => document.getElementById(MESAS ? "parkedSplitBtn" : "splitFromCartBtn").click(), MESAS);
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      if (await A.win.evaluate(() => !document.getElementById("splitTicketOverlay").classList.contains("hidden"))) break;
      await sleep(300);
    }
    out.asistente_abierto = await A.win.evaluate(() => !document.getElementById("splitTicketOverlay").classList.contains("hidden"));
    out.ticket_origen = await A.win.evaluate(() => { const t = getCurrentLoadedParkedTicket(); return t ? { id: t.id, name: t.name, modo: inferTicketParkingMode(t), lineas: (t.items || []).length } : null; });
    if (SHOTS) await A.win.screenshot({ path: path.join(SHOTS, "split_2_asistente.png") });

    // 3) igualitario, 2 partes
    await A.win.evaluate(async (MESAS) => {
      const sel = document.getElementById("splitTicketModeSelect");
      if (MESAS) {
        // por articulos: 1 unidad de cada linea a cada parte (asignacion exacta, sin fracciones)
        sel.value = "items"; sel.dispatchEvent(new Event("change"));
        splitTicketPartsCount = 2;
        if (splitTicketPartsInput) splitTicketPartsInput.value = "2";
        splitTicketMode = "items";
        initSplitItemsMatrixFromCurrentCart();
        // cada linea (qty 1) va entera a la parte (indice par -> 1, impar -> 2)
        splitTicketItemsMatrix = cart.map((l, i) => (i % 2 === 0 ? [Number(l.qty), 0] : [0, Number(l.qty)]));
      } else {
        sel.value = "equal"; sel.dispatchEvent(new Event("change"));
      }
      await new Promise((r) => setTimeout(r, 300));
      await confirmSplitTicket();
    }, MESAS);
    await sleep(2500);
    out.tras_dividir = await A.win.evaluate(() => ({
      partes: parkedTickets.filter((t) => !t.paid && getTicketSplitMeta(t)).map((t) => ({ id: t.id, name: t.name, parte: getTicketSplitMeta(t)?.part, total: t.total, modo: inferTicketParkingMode(t) })),
      cargado: getCurrentLoadedParkedTicket()?.name || null,
      cart: cart.map((l) => ({ n: String(l.name).slice(0, 14), q: l.qty })),
    }));
    if (SHOTS && process.env.TPV_SHOT_RENAME) {
      // nombres de muestra tambien tras recargar el pedido (al recargarlo vuelve el nombre del catalogo) y sin avisos en pantalla
      await A.win.evaluate(() => { cart.forEach((l, i) => { l.name = ["Café con leche", "Croissant"][i] || l.name; l.descripcion = l.name; l.secondaryName = ""; l.descripcion2 = ""; }); renderCart(); document.querySelectorAll(".toast, .toast-item, #toastHost > *").forEach((e) => e.remove()); });
      await sleep(500);
    }
    if (SHOTS) await A.win.screenshot({ path: path.join(SHOTS, "split_3_parte1.png") });
    out.ids = out.tras_dividir.partes.map((p) => p.id);

    if (MERGE) {
      await A.win.evaluate(async () => {
        openSplitTicketModal();
        await new Promise((r) => setTimeout(r, 400));
        const inp = document.getElementById("splitTicketPartsInput");
        inp.value = "1"; inp.dispatchEvent(new Event("input")); inp.dispatchEvent(new Event("change"));
        await new Promise((r) => setTimeout(r, 400));
        await confirmSplitTicket();
      });
      await sleep(2500);
      out.tras_unificar = await A.win.evaluate(() => ({
        partes: parkedTickets.filter((t) => !t.paid && getTicketSplitMeta(t)).length,
        cargado: getCurrentLoadedParkedTicket()?.name || null,
        cart: cart.map((l) => ({ n: String(l.name).slice(0, 14), q: l.qty })),
      }));
      out.cobro_unico = await drivePay(A);
      await sleep(14000);
      await A.win.evaluate(() => window.__dismiss());
    } else {
    // 4) cobrar parte 1 -> debe cargarse sola la parte 2 -> cobrar parte 2
    out.cobro1 = await drivePay(A);
    // espera (hasta 30 s) a que termine de verdad el cobro de fondo y se cargue sola la parte 2
    const tW = Date.now();
    while (Date.now() - tW < 30000) {
      const p2 = await A.win.evaluate(() => getTicketSplitMeta(getCurrentLoadedParkedTicket())?.part === 2);
      if (p2) break;
      await sleep(500);
    }
    out.espera_parte2_s = Math.round((Date.now() - tW) / 100) / 10;
    const dump = () => A.win.evaluate((BASE) => ({
      cargado: getCurrentLoadedParkedTicket()?.name || null,
      cart: cart.map((l) => ({ n: String(l.name).slice(0, 14), q: l.qty })),
      tickets: parkedTickets.filter((t) => String(t.name || "").startsWith(BASE) || (!t.paid && t.mesaUid === "tut-room-1::m3")).map((t) => ({ id: String(t.id).slice(-5), name: t.name, paid: !!t.paid, closing: !!t.closingInProgress, items: (t.items || []).map((l) => l.qty).join("+") })),
    }), String(out.ticket_origen?.name || "@@"));
    out.tras_cobro1 = await dump();
    if (TRACE) out.park_trace = await A.win.evaluate(() => window.__ptrace);
    if (SHOTS) await A.win.screenshot({ path: path.join(SHOTS, "split_4_parte2_auto.png") });
    await A.win.evaluate(() => window.__dismiss());
    out.cobro2 = await drivePay(A);
    await sleep(14000);
    await A.win.evaluate(() => window.__dismiss());
    }
    out.tras_cobro2 = await A.win.evaluate(() => ({ cargado: getCurrentLoadedParkedTicket()?.name || null, cart: cart.length, pendientes: parkedTickets.filter((t) => !t.paid && getTicketSplitMeta(t)).length }));

    // 5) stock: inicial - 2 (neto de ventas) en cada producto
    out.stock = [];
    // espera a que el stock se estabilice (2 lecturas seguidas iguales, hasta 60 s): el cobro de fondo puede tardar
    for (const p of prods) {
      let prev = null, same = 0;
      for (let i = 0; i < 20 && same < 2; i++) {
        const v = await readStock(p.id);
        same = v === prev ? same + 1 : 0;
        prev = v;
        if (same < 2) await sleep(3000);
      }
    }
    for (const p of prods) {
      const fin = await readStock(p.id);
      out.stock.push({ id: p.id, nombre: p.name, inicial: p.stock, final: fin, esperado: p.stock - 2, DESCUADRE: Number((fin - (p.stock - 2)).toFixed(3)) });
    }
  } catch (e) {
    out.ERROR = String((e && e.message) || e).slice(0, 500);
  } finally {
    try {
      if (A) {
        out.limpieza = await A.win.evaluate(async ([prods, ids, MESAS, TABLE]) => {
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          for (const id of ids) {
            const t = parkedTickets.find((x) => String(x.id) === String(id) && !x.paid);
            try { if (t) await apiDeleteParkedReservation(t); } catch (e) {}
          }
          if (MESAS) {
            const mine = parkedTickets.filter((t) => !t.paid && t.mesaUid === TABLE);
            for (const t of mine) { try { await apiDeleteParkedReservation(t); } catch (e) {} }
            const st = loadMesasTablesStateForInline();
            if (st?.tableTicketMap) delete st.tableTicketMap[TABLE];
            if (st?.draftCartByTable) delete st.draftCartByTable[TABLE];
            saveMesasTablesStateForInline(st);
          }
          for (const p of prods) {
            const rows = await fetchStockRowsByProductReference(findProductByBaseId(p.id));
            const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
            if (row && Number.isFinite(p.stock)) await updateStockRowCantidad(row, p.stock);
          }
          return "ok";
        }, [prods, out.ids || [], MESAS, TABLE]);
        await sleep(2000);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 160); }
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(verdict.fails ? 1 : 0);
  }
})();
