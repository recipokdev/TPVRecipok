// run-encargos-variants-stores.js -- prueba MANUAL (no entra en npm test) de ENCARGOS con VARIANTES, AÑADIDOS DE PAGO y VARIAS TIENDAS.
// Un TPV real contra la demo (perfil persistente de run-two-tpv.js con sesion ya iniciada; nunca PIN). Crea un encargo y una factura
// REALES en demo (lineas marcadas "[PRUEBA ENCARGOS]", encargo "TEST2TPV variantes"; limpiar con cleanup_encargos.php).
// Comprueba:
//  V1 un encargo con una VARIANTE (producto 367 "3x1 Fartones", ref 211) y un producto con AÑADIDO de pago (599 + azucar 0,10 x2):
//     el pedido de FacturaScripts lleva la variante con SU referencia, el producto y la linea "Añadido: azucar"; los totales cuadran;
//  V2 la reserva virtual de stock es la del PRODUCTO (el TPV muestra el stock del producto entero en todas sus variantes): resta lo
//     reservado, una sola vez, y por igual en las variantes hermanas;
//  V3 al recoger y cobrar la factura lleva las mismas lineas y el mismo total, y el stock REAL baja solo en la variante vendida;
//  S1 TIENDAS: el encargo creado en ALG no se ve (ni reserva stock) desde otra tienda (TDA2) y vuelve a verse en ALG.
// Uso: node tools/tests/run-encargos-variants-stores.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path");
const os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = process.env.TPV_ROOT ? path.resolve(process.env.TPV_ROOT) : path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kills = [];
const log = (...a) => console.log(new Date().toISOString().slice(14, 23), ...a);
const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "[OK]  " : "[FAIL]"} ${name}${extra ? " -> " + extra : ""}`); };
const BASE_VARIANT = 367, ADDON_PRODUCT = 599, NAME = "TEST2TPV variantes";

async function launch(dirName, label) {
  const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), dirName), TPV_TEST_LABEL: label };
  delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
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
  if (!win) throw new Error("sin ventana " + label);
  await win.waitForFunction(() => typeof currentTerminal !== "undefined" && !!currentTerminal && !!window.TPV_ENCARGOS, null, { timeout: 60000 }).catch(() => {});
  return { app, win, label };
}

(async () => {
  const hard = setTimeout(() => { console.error("HARD TIMEOUT"); kills.forEach((k) => k()); process.exit(1); }, 420000);
  let A;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "TPV 1");
    const a = A.win;
    log("setup:", JSON.stringify(await a.evaluate(async () => {
      await setMesasInlineModeEnabled(false, { persist: false });
      window.ensurePrinterSelectedForPrint = async () => ""; window.openDrawerNow = async () => true;
      const real = window.buildFsLinesFromCart;
      window.buildFsLinesFromCart = (c) => real(c).map((l) => ({ ...l, descripcion: String(l.descripcion || "") + " [PRUEBA ENCARGOS]" }));
      await window.TPV_CFG.set("ui.encargosEnabled", true); await window.TPV_CFG.set("ui.encargosNoveltySeen", true);
      await window.TPV_ENCARGOS.loadEnabled();
      cart = []; setCurrentParkedTicketIndex(null); renderCart();
      document.querySelectorAll(".simple-overlay:not(.hidden)").forEach((o) => o.classList.add("hidden")); document.body.classList.remove("modal-locked");
      return { slug: getCurrentSlugForReservations(), terminal: currentTerminal?.id, almacen: getCurrentWarehouseCode(), caja: getCajaIdSafe() };
    })));
    await sleep(2500);

    // ---------- productos de la prueba ----------
    const prep = await a.evaluate(async ([BASE, ADDONP]) => {
      const tiles = products.filter((p) => getProductBaseId(p) === BASE).map((p) => ({ id: p.id, ref: p.referencia, name: p.name, stock: p.stockfis, primary: !!p.isPrimaryVariant }));
      const ap = products.find((p) => getProductBaseId(p) === ADDONP);
      const addons = ap ? getProductAddonsForProduct(ap).filter((x) => /azucar/i.test(x.nombre)) : [];
      return { tiles, addon: addons[0] || null, addonProduct: ap ? { id: ap.id, name: ap.name, price: ap.price } : null };
    }, [BASE_VARIANT, ADDON_PRODUCT]);
    log("tiles", JSON.stringify(prep));
    const vTiles = prep.tiles;
    if (vTiles.length < 2 || !prep.addon) throw new Error("La demo no tiene los productos esperados (variantes del 367 y añadido azucar del 599)");
    const sold = vTiles.find((t) => String(t.ref) === "211") || vTiles[1];
    const sibling = vTiles.find((t) => t !== sold);
    log(`variante vendida: ${sold.name} (ref ${sold.ref}) | hermana: ${sibling.name} (ref ${sibling.ref})`);

    // stock REAL de FacturaScripts antes (por referencia)
    const fsStock = (ref) => a.evaluate(async (ref) => {
      const cfg = window.RECIPOK_API; const base = cfg.baseUrl.replace(/\/+$/, "");
      const r = await fetch(`${base}/stocks?filter[referencia]=${encodeURIComponent(ref)}&limit=20`, { headers: { Token: cfg.apiKey, Accept: "application/json" } });
      const j = await r.json(); const rows = Array.isArray(j) ? j : j.data || [];
      const alm = getCurrentWarehouseCode();
      const row = rows.find((x) => x.codalmacen === alm) || rows[0];
      return row ? Number(row.cantidad) : null;
    }, ref);
    const stockBefore = { sold: await fsStock(sold.ref), sibling: await fsStock(sibling.ref) };
    log("stock real FS antes:", JSON.stringify(stockBefore));

    // ---------- V1: crear el encargo ----------
    const cartInfo = await a.evaluate(async ([soldId, ADDONP, addon]) => {
      cart = [];
      await addToCart(products.find((p) => p.id === soldId), 1);
      await addToCart(products.find((p) => getProductBaseId(p) === ADDONP), 2);
      const line = cart.find((l) => getProductBaseId(l) === ADDONP);
      if (line) line.addons = [{ id: addon.id, nombre: addon.nombre, precio: Number(addon.precio) }];
      renderCart();
      return { lineas: cart.map((l) => ({ name: l.name, ref: l.referencia, qty: l.qty, addons: (l.addons || []).map((x) => x.nombre + ":" + x.precio) })), total: round2(getCartTotal(cart)) };
    }, [sold.id, ADDON_PRODUCT, prep.addon]);
    log("carrito:", JSON.stringify(cartInfo));
    await a.evaluate(() => document.getElementById("passToEncargoBtn").click()); await sleep(900);
    await a.evaluate((n) => { document.getElementById("encName").value = n; document.querySelector('#encDayChips [data-day="today"]').click(); }, NAME);
    await a.evaluate(() => document.getElementById("encNextBtn").click());
    for (const k of "1") await a.evaluate((k) => document.querySelector(`#encKeypad [data-key="${k}"]`).click(), k);
    await a.evaluate(() => { [...document.querySelectorAll("#encMethods button")].find((x) => /contado/i.test(x.textContent)).click(); });
    await a.evaluate(() => document.getElementById("encSaveBtn").click());
    await a.waitForFunction(() => !document.getElementById("encargoResultOverlay").classList.contains("hidden"), null, { timeout: 90000 });
    await a.evaluate(() => document.getElementById("encResCloseBtn").click());
    await sleep(1500);

    // pedido de FacturaScripts + encargo del servidor
    const order = await a.evaluate(async (NAME) => {
      const r = await window.TPV_ENCARGOS.call("list-customer-orders", { query: { status: "pendiente", limit: "50" } });
      const o = (r.json?.data || []).find((x) => String(x.customerName).includes(NAME));
      if (!o) return null;
      const cfg = window.RECIPOK_API; const base = cfg.baseUrl.replace(/\/+$/, ""); const H = { Token: cfg.apiKey, Accept: "application/json" };
      const lr = await fetch(`${base}/lineapedidoclientes?filter[idpedido]=${o.fsIdpedido}&limit=50`, { headers: H }); const lj = await lr.json();
      const lines = (Array.isArray(lj) ? lj : lj.data || []).map((l) => ({ ref: l.referencia, desc: String(l.descripcion || "").slice(0, 50), cant: Number(l.cantidad), pvp: Number(l.pvpunitario), total: Number(l.pvptotal) }));
      const pr = await fetch(`${base}/pedidoclientes/${o.fsIdpedido}`, { headers: H }); const pj = await pr.json();
      return { code: o.orderCode, total: Number(o.total), codalmacen: o.codalmacen, idpedido: o.fsIdpedido, fsTotal: Number(pj.total), fsAlmacen: pj.codalmacen, lines };
    }, NAME);
    log("encargo:", JSON.stringify(order));
    check("V1 el encargo se crea y el servidor lo guarda con el total del carrito", order && Math.abs(order.total - cartInfo.total) < 0.011, `servidor ${order && order.total} vs carrito ${cartInfo.total}`);
    check("V1 el pedido de FacturaScripts lleva la VARIANTE con su referencia", order && order.lines.some((l) => String(l.ref) === String(sold.ref) && l.cant === 1), JSON.stringify(order && order.lines.filter((l) => String(l.ref) === String(sold.ref))));
    check("V1 el pedido lleva el producto con añadido y la linea «Añadido: azucar»", order && order.lines.some((l) => /Añadido: azucar/i.test(l.desc)) && order.lines.some((l) => l.cant === 2 && !/Añadido/i.test(l.desc)), JSON.stringify(order && order.lines.map((l) => l.desc + " x" + l.cant)));
    check("V1 el total del pedido de FacturaScripts = el del encargo", order && Math.abs(order.fsTotal - order.total) < 0.02, `FS ${order && order.fsTotal} vs encargo ${order && order.total}`);
    check("V1 el pedido se crea en el almacén del terminal", order && order.fsAlmacen === order.codalmacen && !!order.codalmacen, `${order && order.fsAlmacen}/${order && order.codalmacen}`);

    // ---------- V2: reserva virtual por variante ----------
    await a.evaluate(() => window.TPV_ENCARGOS.refreshCount()); await sleep(1500);
    const rv = await a.evaluate(([soldId, sibId, BASE]) => {
      const ps = products.find((p) => p.id === soldId), pb = products.find((p) => p.id === sibId);
      return {
        reservadoBase: window.TPV_ENCARGOS.getReservedQty(BASE),
        vendida: { real: ps.stockfis, visible: getVisibleStockForProduct(ps) },
        hermana: { real: pb.stockfis, visible: getVisibleStockForProduct(pb) },
      };
    }, [sold.id, sibling.id, BASE_VARIANT]);
    log("reservas:", JSON.stringify(rv));
    check("V2 la reserva descuenta 1 unidad (la del encargo) del stock visible de la variante vendida", rv.vendida.real === null || rv.vendida.visible === rv.vendida.real - 1, JSON.stringify(rv.vendida));
    check("V2 la variante hermana muestra el mismo stock del producto (también descuenta la reserva, una sola vez)", rv.hermana.real === null || rv.hermana.visible === rv.hermana.real - 1, JSON.stringify(rv.hermana));

    // ---------- S1: otra tienda no ve el encargo ni su reserva ----------
    const scope = await a.evaluate(async (NAME) => {
      const out = {};
      const orig = currentTerminal.codalmacen;
      out.origen = orig;
      const list = async () => {
        const r = await window.TPV_ENCARGOS.call("list-customer-orders", { query: { status: "pendiente", limit: "50" } });
        return (r.json?.data || []).filter((x) => String(x.customerName).includes(NAME)).length;
      };
      out.enOrigen = await list();
      currentTerminal.codalmacen = "TDA2";
      try {
        out.enOtraTienda = await list();
        await window.TPV_ENCARGOS.refreshCount();
        out.reservaOtraTienda = window.TPV_ENCARGOS.getReservedQty(367);
      } finally { currentTerminal.codalmacen = orig; }
      await window.TPV_ENCARGOS.refreshCount();
      out.enOrigenDespues = await list();
      out.reservaOrigen = window.TPV_ENCARGOS.getReservedQty(367);
      return out;
    }, NAME);
    log("tiendas:", JSON.stringify(scope));
    check("S1 el encargo se ve en su tienda (ALG)", scope.enOrigen === 1, JSON.stringify(scope));
    check("S1 desde OTRA tienda (TDA2) no se ve el encargo", scope.enOtraTienda === 0, `ve ${scope.enOtraTienda}`);
    check("S1 desde OTRA tienda no hay reserva de stock de ese encargo", scope.reservaOtraTienda === 0, `reserva ${scope.reservaOtraTienda}`);
    check("S1 de vuelta en su tienda vuelve a verse y a reservar", scope.enOrigenDespues === 1 && scope.reservaOrigen >= 1, `ve ${scope.enOrigenDespues}, reserva ${scope.reservaOrigen}`);

    // ---------- V3: recoger y cobrar ----------
    await a.evaluate(() => document.getElementById("encargosListBtn").click()); await sleep(1500);
    await a.evaluate((n) => [...document.querySelectorAll("#encListBody .enc-item")].find((r) => r.textContent.includes(n)).click(), NAME); await sleep(1200);
    await a.evaluate(() => document.getElementById("encDetPickupBtn").click());
    await a.waitForFunction(() => !document.getElementById("payOverlay").classList.contains("hidden"), null, { timeout: 45000 });
    await sleep(500);
    await a.evaluate(() => { const row = document.querySelector('#payOverlay input.pay-amount[data-codpago="CONT"]'); row?.parentElement?.querySelector("button.pay-max")?.click(); });
    await sleep(300);
    await a.evaluate(() => document.getElementById("paySaveBtn").click());
    await a.waitForFunction(() => document.getElementById("encDetChip").textContent === "RECOGIDO", null, { timeout: 90000 }).catch(() => {});
    const chip = await a.evaluate(() => document.getElementById("encDetChip").textContent);
    check("V3 el encargo queda RECOGIDO", chip === "RECOGIDO", chip);
    await sleep(4000);
    const inv = await a.evaluate(async (NAME) => {
      const r = await window.TPV_ENCARGOS.call("list-customer-orders", { query: { status: "recogido", limit: "20" } });
      const o = (r.json?.data || []).find((x) => String(x.customerName).includes(NAME));
      if (!o) return null;
      const cfg = window.RECIPOK_API; const base = cfg.baseUrl.replace(/\/+$/, ""); const H = { Token: cfg.apiKey, Accept: "application/json" };
      const fr = await fetch(`${base}/facturaclientes/${o.fsIdfactura}`, { headers: H }); const fj = await fr.json();
      const lr = await fetch(`${base}/lineafacturaclientes?filter[idfactura]=${o.fsIdfactura}&limit=50`, { headers: H }); const lj = await lr.json();
      const lines = (Array.isArray(lj) ? lj : lj.data || []).map((l) => ({ ref: l.referencia, desc: String(l.descripcion || "").slice(0, 50), cant: Number(l.cantidad), total: Number(l.pvptotal), ast: l.actualizastock }));
      return { codigo: fj.codigo, total: Number(fj.total), pagada: fj.pagada, almacen: fj.codalmacen, encTotal: Number(o.total), lines };
    }, NAME);
    log("factura:", JSON.stringify(inv));
    check("V3 la factura tiene el mismo total que el encargo y esta pagada", inv && Math.abs(inv.total - inv.encTotal) < 0.02 && (inv.pagada === true || inv.pagada === 1), `${inv && inv.total} vs ${inv && inv.encTotal}, pagada=${inv && inv.pagada}`);
    check("V3 la factura lleva la variante con su referencia, el producto y el añadido", inv && inv.lines.some((l) => String(l.ref) === String(sold.ref) && l.cant === 1) && inv.lines.some((l) => /Añadido: azucar/i.test(l.desc)), JSON.stringify(inv && inv.lines.map((l) => l.ref + "/" + l.desc + " x" + l.cant)));
    check("V3 la factura sale del almacén del terminal", inv && inv.almacen === scope.origen, `${inv && inv.almacen}`);
    await a.evaluate(() => { document.getElementById("postPayCloseX")?.click(); document.getElementById("encDetCloseBtn2")?.click(); document.getElementById("encListCloseBtn")?.click(); });
    await sleep(4000);
    const stockAfter = { sold: await fsStock(sold.ref), sibling: await fsStock(sibling.ref) };
    log("stock real FS despues:", JSON.stringify(stockAfter));
    check("V3 el stock REAL baja 1 solo en la variante vendida", stockBefore.sold === null || stockAfter.sold === stockBefore.sold - 1, `${stockBefore.sold} -> ${stockAfter.sold}`);
    check("V3 el stock REAL de la variante hermana no cambia", stockBefore.sibling === null || stockAfter.sibling === stockBefore.sibling, `${stockBefore.sibling} -> ${stockAfter.sibling}`);
  } catch (e) {
    check("EXCEPCION en la prueba", false, String((e && e.message) || e).slice(0, 300));
  } finally {
    const fails = results.filter((r) => !r[1]).length;
    console.log(`\nRESULTADO: ${results.length - fails} OK, ${fails} FAIL`);
    clearTimeout(hard);
    kills.forEach((k) => k());
    process.exit(0);
  }
})();
