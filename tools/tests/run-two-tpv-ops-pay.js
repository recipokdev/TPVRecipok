// run-two-tpv-ops-pay.js -- prueba MANUAL (no entra en npm test) del COBRO con DOS TPV reales a la
// vez contra el demo, en TPV normal, con el guardado por operaciones y el candado de cobro activos.
// COBRA DE VERDAD en el demo (crea facturas de prueba en FacturaScripts demo, como
// run-e2e-real-demo.js). Perfiles persistentes de run-two-tpv.js, sesion ya iniciada (nunca PIN).
// Escenarios:
//   S1  los dos pulsan Cobrar sobre el MISMO pedido a la vez -> solo UNO cobra (el otro recibe
//       "se esta cobrando en otro TPV" / "ya cobrado").
//   S2  A cobra mientras B añade una linea al mismo pedido -> la linea de B NO se pierde en silencio
//       dentro del ticket cobrado (se rechaza o se descarta al ver el cobro) y no hay factura doble.
// Requiere parked_ops_pilot_slugs_tpv = ['demo'].
// Uso: node tools/tests/run-two-tpv-ops-pay.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const kills = [];
const NAME1 = "ZZ pay S1 " + Date.now();
const NAME2 = "ZZ pay S2 " + Date.now();

async function launch(dirName, label) {
  const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), dirName), TPV_TEST_LABEL: label };
  delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  kills.push(() => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} });
  let win = null; const t0 = Date.now();
  while (!win && Date.now() - t0 < 60000) {
    for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
    if (!win) await new Promise((r) => setTimeout(r, 500));
  }
  return { app, pid, win, label };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 295000);
  const out = {};
  let A, B; const created = [];
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);
    const prep = (X) => X.win.evaluate(async () => {
      await setMesasInlineModeEnabled(false, { persist: false });
      window.__prods = products.filter((x) => Number(x.price) > 0);
      window.__dismiss = () => { const ov = document.getElementById("msgOverlay"); if (ov && !ov.classList.contains("hidden")) { Array.from(ov.querySelectorAll("button")).pop()?.click(); } };
      window.__idx = (n) => parkedTickets.findIndex((t) => !t.paid && String(t.name || "") === n);
      return { opsTpv: parkedOpsIsEnabled(getCurrentSlugForReservations(), "tpv"), mesas: MESAS_INLINE_ACTIVE };
    });
    out.modo = [await prep(A), await prep(B)];
    await sleep(1000);

    const makeAndOpenBoth = async (NAME) => {
      await A.win.evaluate(async (NAME) => {
        cart = [buildCartLine(__prods[0], 1)]; renderCart();
        await parkCurrentCart(NAME, "", { openListAfterSave: false, skipAutoPrint: true, skipStockConfirm: true, parkingMode: PARKED_MODE_TPV });
      }, NAME);
      await sleep(2500);
      for (const X of [A, B]) {
        for (let k = 0; k < 6; k++) {
          const n = await X.win.evaluate(async (NAME) => { await refreshRemoteParkedReservationsOnly(); const i = __idx(NAME); if (i >= 0) restoreParkedCartByIndex(i); return cart.length; }, NAME);
          if (n > 0) break;
          await sleep(1500);
        }
      }
      await sleep(1200);
      created.push(NAME);
    };

    // ---------- S1: los dos cobran el mismo pedido a la vez ----------
    await makeAndOpenBoth(NAME1);
    const [rA, rB] = await Promise.all([drivePay(A), (async () => { await sleep(250); return drivePay(B); })()]);
    out.S1 = { A: rA, B: rB };
    await sleep(8000);
    for (const X of [A, B]) await X.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(1500);
    out.S1_estado = await Promise.all([A, B].map((X) => X.win.evaluate((NAME) => {
      const t = parkedTickets.find((x) => String(x.name || "") === NAME);
      return t ? { paid: !!t.paid, code: t.paidTicketCode || null, pid: t.paidTicketId || null } : "(no esta)";
    }, NAME1)));
    for (const X of [A, B]) await X.win.evaluate(() => __dismiss());

    // ---------- S2: A cobra mientras B añade una linea ----------
    await makeAndOpenBoth(NAME2);
    const payA = drivePay(A);
    await sleep(700);
    await B.win.evaluate(() => { cart.push(buildCartLine(__prods[2], 1)); renderCart(); });
    out.S2_A = await payA;
    await sleep(9000);
    await B.win.evaluate(async () => { await refreshRemoteParkedReservationsOnly(); });
    await sleep(2000);
    out.S2_B = await B.win.evaluate((NAME) => {
      const t = parkedTickets.find((x) => String(x.name || "") === NAME);
      return { ticket: t ? { paid: !!t.paid, lineas: (t.items || []).map((l) => String(l.name).slice(0, 8) + ":" + l.qty), code: t.paidTicketCode || null } : "(no esta)", carrito: cart.map((c) => String(c.name).slice(0, 8) + ":" + c.qty) };
    }, NAME2);
    out.S2_A_estado = await A.win.evaluate((NAME) => { const t = parkedTickets.find((x) => String(x.name || "") === NAME); return t ? { paid: !!t.paid, lineas: (t.items || []).map((l) => String(l.name).slice(0, 8) + ":" + l.qty) } : "(no esta)"; }, NAME2);
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try {
      if (A) {
        out.limpieza = await A.win.evaluate(async (names) => {
          cart = []; setCurrentParkedTicketIndex(null); renderCart();
          for (const n of names) {
            const t = parkedTickets.find((x) => String(x.name || "") === n);
            try { if (t) await apiDeleteParkedReservation(t); } catch (e) {}
          }
          return "ok";
        }, created);
        await sleep(2000);
      }
    } catch (e) { out.limpiezaERR = String(e.message).slice(0, 120); }
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(0);
  }
})();
