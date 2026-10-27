// run-two-tpv-edit-and-pay.js -- prueba MANUAL (no entra en npm test): el caso real de Asador el Gallo
// (2026-10-27) con DOS TPV reales a la vez contra el demo, en TPV normal:
//   1) A aparca un pedido (2 productos).
//   2) B lo abre, QUITA un producto, AÑADE otro y COBRA enseguida (GAP ms despues del ultimo cambio).
//   3) Se comprueba que sale UN solo ticket (sin gemelo), cobrado, con las lineas finales y que A lo ve cobrado.
// COBRA DE VERDAD en el demo (crea una factura de prueba). Perfiles persistentes de run-two-tpv.js,
// sesion ya iniciada (nunca PIN). Fuerza el guardado entero antiguo (el que usa Asador, sin el
// "guardado por operaciones" del piloto) con tpv_parkedOpsDisabled=1 en los dos perfiles y lo quita al acabar.
// Uso: node tools/tests/run-two-tpv-edit-and-pay.js [GAP_ms=150] [AOPEN=0|1] [LEGACY=1|0] [CONFLICT=0|1] [PAY=1|0]
//   PAY=0: nadie cobra; se comprueba que los dos TPV convergen al mismo pedido sin resucitar lineas quitadas.
//   CONFLICT=1 (requiere AOPEN=1): A, que tiene el pedido abierto, añade un producto A LA VEZ que B quita otro
//   (dos cajeros tocando el mismo pedido) antes de que B cobre.
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const GAP = Number(process.argv[2] ?? 150);
const AOPEN = String(process.argv[3] ?? "0") === "1";
const LEGACY = String(process.argv[4] ?? "1") !== "0";
const CONFLICT = String(process.argv[5] ?? "0") === "1";
const PAY = String(process.argv[6] ?? "1") !== "0";
const NAME = "ZZ editpay " + Date.now();
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

// Pulsa Cobrar -> forma de pago maxima -> Guardar; devuelve cuando el carrito se vacia o sale un mensaje.
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
  while (Date.now() - t0 < 25000) {
    const st = await X.win.evaluate(() => {
      const ov = document.getElementById("msgOverlay");
      const msg = ov && !ov.classList.contains("hidden") ? (document.getElementById("msgText")?.textContent || "").slice(0, 160) : "";
      const toast = (document.getElementById("toastContainer")?.innerText || "").replace(/\s+/g, " ").slice(0, 200);
      return { vacio: Array.isArray(cart) && cart.length === 0, msg, toast };
    });
    if (st.vacio || st.msg || /cobr/i.test(st.toast || "")) return st;
    await sleep(400);
  }
  return { timeout: true };
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 290000);
  const out = { GAP, AOPEN, LEGACY, CONFLICT, PAY, NAME };
  let A, B;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);

    const prep = (X) => X.win.evaluate(async ({ LEGACY }) => {
      await setMesasInlineModeEnabled(false, { persist: false });
      try { LEGACY ? localStorage.setItem("tpv_parkedOpsDisabled", "1") : localStorage.removeItem("tpv_parkedOpsDisabled"); } catch {}
      window.__prods = ["Alcohol", "Crema", "Berlinas con crema", "Mamellas Merengue"].map((n) => products.find((x) => x.name === n));
      window.__log = [];
      const of = window.fetch.bind(window);
      window.fetch = (u, o) => {
        const url = String(u && u.url || u); const m = url.match(/action=([a-z-]+)/);
        const method = String((o && o.method) || "GET");
        if (m && /parked|stock|invoice|factura/.test(m[1]) && method !== "GET") window.__log.push(Date.now() % 1000000 + " " + m[1]);
        return of(u, o);
      };
      window.__idx = (n) => parkedTickets.findIndex((t) => !t.paid && String(t.name || "") === n);
      return { opsTpv: parkedOpsIsEnabled(getCurrentSlugForReservations(), "tpv"), mesas: MESAS_INLINE_ACTIVE, prods: window.__prods.map((p) => !!p) };
    }, { LEGACY });
    out.modo = [await prep(A), await prep(B)];
    await sleep(1000);

    // 1) A aparca
    await A.win.evaluate(async (NAME) => {
      cart = [buildCartLine(__prods[0], 1), buildCartLine(__prods[1], 1)]; renderCart();
      await parkCurrentCart(NAME, "", { openListAfterSave: false, skipAutoPrint: true, skipStockConfirm: true, parkingMode: PARKED_MODE_TPV });
    }, NAME);
    await sleep(3000);
    // A se queda "en otra cosa" (carrito vacio) o con el pedido abierto, segun AOPEN
    // 2) B recibe el pedido y lo abre
    let opened = 0;
    for (let k = 0; k < 8 && !opened; k++) {
      opened = await B.win.evaluate(async (NAME) => { await refreshRemoteParkedReservationsOnly(); const i = __idx(NAME); if (i >= 0) restoreParkedCartByIndex(i); return cart.length; }, NAME);
      if (!opened) await sleep(2000);
    }
    out.B_abrio = opened;
    if (AOPEN) {
      out.A_abrio = await A.win.evaluate(async (NAME) => { await refreshRemoteParkedReservationsOnly(); const i = __idx(NAME); if (i >= 0) restoreParkedCartByIndex(i); return cart.length; }, NAME);
    }
    await sleep(1500);

    // 3) B quita un producto, añade otro (clics reales sobre las lineas y las fichas) y cobra GAP ms despues
    const t0 = Date.now();
    if (CONFLICT) {
      A.win.evaluate(() => { window.__trace = []; const t0 = Date.now(); window.__traceTimer = setInterval(() => { window.__trace.push(((Date.now() - t0) / 1000).toFixed(1) + "s " + cart.map((c) => String(c.name).slice(0, 6)).join(",") + " | " + (document.getElementById("toastContainer")?.innerText || "").replace(/\s+/g, " ").slice(0, 90)); }, 400); });
    }
    if (CONFLICT) {
      // A (con el pedido abierto) añade un producto justo cuando B va a quitar otro
      A.win.evaluate(async () => { const sl = (ms) => new Promise((r) => setTimeout(r, ms)); await sl(60); Array.from(document.querySelectorAll("#productsGrid > *")).find((e) => e.textContent.includes("Berlinas con crema"))?.click(); }).catch(() => {});
    }
    out.B_edicion = await B.win.evaluate(async ({ GAP }) => {
      const sl = (ms) => new Promise((r) => setTimeout(r, ms));
      const antes = cart.map((c) => c.name);
      document.querySelectorAll("button.line-delete-btn")[1]?.click();
      await sl(120);
      Array.from(document.querySelectorAll("#productsGrid > *")).find((e) => e.textContent.includes("Mamellas Merengue"))?.click();
      await sl(GAP);
      return { antes, despues: cart.map((c) => c.name) };
    }, { GAP });
    if (PAY) {
      out.B_pago = await drivePay(B);
      out.B_msPagoTotal = Date.now() - t0;
    } else {
      out.B_pago = "(sin cobrar)";
    }
    await sleep(14000);

    // 4) estado final: los dos TPV y el servidor
    for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(2000);
    const estado = (X) => X.win.evaluate(async (NAME) => {
      const loc = parkedTickets.filter((t) => String(t.name || "") === NAME).map((t) => ({ id: t.id, paid: !!t.paid, code: t.paidTicketCode || null, lineas: (t.items || []).map((l) => String(l.name).slice(0, 10) + ":" + l.qty) }));
      let srv = [];
      try { const list = await apiListParkedReservations(); srv = list.filter((t) => String(t.ticketName || t.name || "") === NAME).map((t) => ({ id: t.ticketId || t.id, paid: !!t.paid, code: t.paidTicketCode || null, lineas: (t.items || []).map((l) => String(l.name).slice(0, 10) + ":" + (l.qty ?? l.cantidad)) })); } catch (e) { srv = "ERR " + e.message; }
      return { local: loc, servidor: srv, cart: cart.map((c) => c.name), pendientesMismoNombre: parkedTickets.filter((t) => !t.paid && String(t.name || "") === NAME).length, conflictos: (typeof loadParkedSyncConflicts === "function" ? loadParkedSyncConflicts().length : null), cola: (typeof loadParkedSyncQueue === "function" ? loadParkedSyncQueue().length : null), log: (window.__log || []).slice(-14) };
    }, NAME);
    if (CONFLICT) out.A_trace = await A.win.evaluate(() => { clearInterval(window.__traceTimer); return window.__trace.filter((x, i, arr) => i === 0 || x !== arr[i - 1]).slice(0, 40); });
    if (!PAY) {
      out.carritos = [await A.win.evaluate(() => cart.map((c) => c.name)), await B.win.evaluate(() => cart.map((c) => c.name))];
    }
    out.A_final = await estado(A);
    out.B_final = await estado(B);
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    for (const X of [A, B]) {
      try {
        if (!X) continue;
        await X.win.evaluate(async (NAME) => {
          try { localStorage.removeItem("tpv_parkedOpsDisabled"); } catch {}
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          for (const t of parkedTickets.filter((x) => !x.paid && String(x.name || "") === NAME)) { try { markParkedTicketAsDeleted(t); await apiDeleteParkedReservation(t); } catch (e) {} }
        }, NAME);
      } catch {}
    }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kills.forEach((f) => f());
    setTimeout(() => process.exit(0), 500);
  }
})();
