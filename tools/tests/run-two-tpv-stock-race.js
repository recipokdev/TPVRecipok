// run-two-tpv-stock-race.js -- prueba MANUAL (no entra en npm test) de la carrera de stock entre DOS TPV
// reales contra el demo (Asador el Gallo, 8-nov-2026: pollo 8 en el sistema y 2 fisicos).
//
// La carrera: al cobrar un aparcado, el TPV A lee el stock de FacturaScripts y escribe "leido + reserva"
// (valor absoluto). Si justo entre la lectura y la escritura el TPV B crea su factura (FacturaScripts resta el
// stock dentro de esa peticion), la escritura de A pisa esa resta y el stock se queda de mas.
// Para reproducirlo sin depender de la suerte se RETRASA 2 s la escritura de stock de A (como pasa en un
// cliente con el plugin de la web) y B cobra justo mientras tanto.
//   modo "control": sin el candado de venta (comportamiento anterior) -> debe quedar stock de MAS.
//   modo "fix":     con el candado de venta                           -> el stock debe cuadrar.
// Cada ticket aparcado resta 1 (reserva), la factura resta 1 y la liberacion devuelve 1: neto -1 por ticket,
// asi que con 2 tickets el stock final esperado es stock_inicial - 2.
//
// COBRA DE VERDAD en el demo (2 facturas de prueba) y AL FINAL devuelve el stock del producto al valor inicial
// (se imprime). Perfiles persistentes de run-two-tpv.js con sesion ya iniciada (nunca se escribe PIN).
// Uso: node tools/tests/run-two-tpv-stock-race.js [control|fix]
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const MODE = process.argv[2] === "control" ? "control" : "fix";
const DELAY_MS = 2000;
const kills = [];
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

// Comprobaciones (veredicto) para la bateria de pruebas: ver tools/tests/battery/. El modo "control" es el CONTROL NEGATIVO
// (sin el candado de venta debe quedar stock de mas: demuestra que la prueba detecta el fallo); "fix" es la prueba de verdad.
function buildChecks(out) {
  const c = [];
  c.push(["La prueba terminó sin errores", !out.ERROR, out.ERROR || ""]);
  if (MODE === "fix") {
    c.push(["Con dos TPV cobrando a la vez el mismo producto, el stock cuadra (sin stock de más)", out.DESCUADRE === 0, `descuadre ${out.DESCUADRE}`]);
  } else {
    c.push(["Control negativo: sin el candado de venta SÍ sobra stock (la prueba detecta el fallo)", out.DESCUADRE === 1, `descuadre ${out.DESCUADRE}`]);
  }
  return c;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 280000);
  const out = { modo: MODE };
  let A, B; const created = [];
  const NAME_A = "ZZ race A " + Date.now(), NAME_B = "ZZ race B " + Date.now();
  let prodId = 0, s0 = null;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);

    const prep = (X, control) => X.win.evaluate(async (control) => {
      await setMesasInlineModeEnabled(false, { persist: false });
      window.__t0 = Date.now();
      window.__log = [];
      const L = (m) => window.__log.push(`${((Date.now() - window.__t0) / 1000).toFixed(2)} ${m}`);
      const wrap = (name, tag) => { const o = window[name]; window[name] = async (...a) => { L(`${tag} >`); try { const r = await o(...a); L(`${tag} <${r && r.acquired !== undefined ? (r.acquired ? " ok" : " NO") : ""}`); return r; } catch (e) { L(`${tag} ! ${e.message}`); throw e; } }; };
      wrap("apiAcquireStockLock", "lock.acquire");
      wrap("apiReleaseStockLock", "lock.release");
      wrap("createTicketInFacturaScripts", "FACTURA");
      if (control) window.withSaleStockLocks = async (items, fn) => fn();
      window.__dismiss = () => { const ov = document.getElementById("msgOverlay"); if (ov && !ov.classList.contains("hidden")) { Array.from(ov.querySelectorAll("button")).pop()?.click(); } };
      window.__idx = (n) => parkedTickets.findIndex((t) => !t.paid && String(t.name || "") === n);
      return { login: hasActiveLoginSession(), cajaAbierta: !!cashSession?.open, ops: typeof withSaleStockLocks };
    }, control);
    out.estado = [await prep(A, MODE === "control"), await prep(B, MODE === "control")];
    if (!out.estado.every((e) => e.login && e.cajaAbierta)) throw new Error("Falta sesion iniciada o caja abierta en algun perfil (no se escribe PIN): " + JSON.stringify(out.estado));

    // Producto con stock gestionado y de sobra
    const pick = await A.win.evaluate(async () => {
      const cand = products.filter((p) => {
        const id = getProductBaseId(p);
        const st = parseManagedStockValue(p.stockfis);
        return id && st !== null && st >= 8 && Number(p.price) > 0 && !p.variants && !isOfferPackProductById(id) && !productHasDerivedStockMarker(p);
      });
      const p = cand[cand.length - 1];
      if (!p) return null;
      const id = getProductBaseId(p);
      const rows = await fetchStockRowsByProductReference(findProductByBaseId(id) || p);
      const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
      return { id, name: String(p.name).slice(0, 30), stock: Number(row?.cantidad) };
    });
    if (!pick) throw new Error("No hay producto con stock gestionado >= 8 en el demo");
    prodId = pick.id; s0 = pick.stock; out.producto = pick;

    const readStock = (X) => X.win.evaluate(async (id) => {
      const rows = await fetchStockRowsByProductReference(findProductByBaseId(id));
      const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
      return Number(row?.cantidad);
    }, prodId);

    // A y B aparcan 1 unidad cada uno y cada uno abre el suyo en el carrito
    for (const [X, NAME] of [[A, NAME_A], [B, NAME_B]]) {
      await X.win.evaluate(async ([NAME, id]) => {
        const p = findProductByBaseId(id);
        cart = [buildCartLine(p, 1)]; renderCart();
        await parkCurrentCart(NAME, "", { openListAfterSave: false, skipAutoPrint: true, skipStockConfirm: true, parkingMode: PARKED_MODE_TPV });
      }, [NAME, prodId]);
      created.push(NAME);
      await sleep(2500);
    }
    for (const [X, NAME] of [[A, NAME_A], [B, NAME_B]]) {
      for (let k = 0; k < 6; k++) {
        const n = await X.win.evaluate(async (NAME) => { await refreshRemoteParkedReservationsOnly(); const i = __idx(NAME); if (i >= 0) restoreParkedCartByIndex(i); return cart.length; }, NAME);
        if (n > 0) break;
        await sleep(1500);
      }
    }
    await sleep(1500);
    out.stock_tras_aparcar = await readStock(A); // esperado s0 - 2

    // Retrasa la escritura de stock de A y marca cuando A esta "entre la lectura y la escritura"
    await A.win.evaluate((DELAY) => {
      window.__held = false;
      const o = apiWrite;
      apiWrite = async (res, method, ...rest) => {
        if (/^stocks\//.test(String(res)) && String(method).toUpperCase() === "PATCH" && !window.__held) {
          window.__held = true;
          window.__log.push(`${((Date.now() - window.__t0) / 1000).toFixed(2)} STOCK PATCH retenido ${DELAY} ms (A entre lectura y escritura)`);
          await new Promise((r) => setTimeout(r, DELAY));
        }
        return o(res, method, ...rest);
      };
    }, DELAY_MS);

    const payA = drivePay(A);
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      if (await A.win.evaluate(() => window.__held === true)) break;
      await sleep(100);
    }
    out.A_llego_a_retener = await A.win.evaluate(() => window.__held === true);
    const payB = drivePay(B); // B cobra mientras A esta entre la lectura y la escritura
    out.cobro = { A: await payA, B: await payB };
    await sleep(14000);
    out.stock_final = await readStock(A);
    out.stock_esperado = s0 - 2;
    out.DESCUADRE = Number((out.stock_final - out.stock_esperado).toFixed(3));
    out.log_A = await A.win.evaluate(() => window.__log);
    out.log_B = await B.win.evaluate(() => window.__log);
    for (const X of [A, B]) await X.win.evaluate(() => __dismiss());
  } catch (e) {
    out.ERROR = String((e && e.message) || e).slice(0, 400);
  } finally {
    try {
      if (A) {
        out.limpieza = await A.win.evaluate(async ([names, id, s0]) => {
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          for (const n of names) {
            const t = parkedTickets.find((x) => String(x.name || "") === n);
            try { if (t) await apiDeleteParkedReservation(t); } catch (e) {}
          }
          // Deja el stock del producto de prueba como estaba antes de la prueba (solo demo).
          if (id && s0 !== null && Number.isFinite(s0)) {
            const rows = await fetchStockRowsByProductReference(findProductByBaseId(id));
            const row = pickStockRowByWarehouse(rows, getCurrentWarehouseCode(), { strict: false });
            if (row) await updateStockRowCantidad(row, s0);
          }
          return "ok";
        }, [created, prodId, s0]);
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
