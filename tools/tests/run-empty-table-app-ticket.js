// Vaciar una mesa cuyo pedido creo la app de camareros (id NO numerico: "camarero-1795...-xxxx"). TPV real en perfil aislado y SIN red.
// Real (prueba conjunta con la app de camareros, 2026-11-18): el arreglo de «quitar todas las lineas lo guarda vacio» (c8c8582) comparaba
// el id con Number(): 0 para esos ids, asi que el guardado del pedido vaciado nunca se activaba y el servidor conservaba las lineas
// quitadas (y a cocina podia salir un plato que ya no estaba).
const path = require("path");
const os = require("os");
const fs = require("fs");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let okN = 0, failN = 0;
function check(label, cond, extra) {
  if (cond) { okN++; console.log(`[OK] ${label}`); }
  else { failN++; console.log(`[FAIL] ${label}${extra ? " -- " + extra : ""}`); }
}

(async () => {
  const userData = path.join(os.tmpdir(), `tpvrecipok-emptyapp-${Date.now()}`);
  const env = {
    ...process.env, TPV_E2E: "1", TPV_MODE: "demo", TPV_E2E_BACKGROUND: "1", TPV_E2E_REQUIRE_ONLINE: "0",
    TPV_E2E_ALLOW_WRITES: "0", TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3", TPV_E2E_API_KEY: "", TPV_E2E_USER_DATA: userData,
  };
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  const kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 90000);
  try {
    let win = null;
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 40000) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => typeof getMesasAutoSaveIntent === "function" && typeof parkedLinkIdOf === "function")) { win = w; break; } } catch {} }
      if (!win) await sleep(250);
    }
    if (!win) throw new Error("no se encontro la ventana del TPV (o falta parkedLinkIdOf)");
    await sleep(2500);

    const setup = `
      const prods = (products || []).filter((p) => !p.variants && Number(p.price) > 0).slice(0, 3);
      if (prods.length < 2) return { error: "sin productos de prueba" };
      const mkT = (id) => ({ id, slug: "demo", mesaUid: "tut-room-1::m9", name: "Prueba", paid: false, closingInProgress: false,
        items: prods.slice(0, 2).map((p, i) => ({ ...buildCartLine(p, 1), _lineId: "Lp" + i })), total: 2 });
      const entrar = (t) => { MESAS_INLINE_ACTIVE = true; MESAS_INLINE_VIEW = "transacciones"; parkedTickets = [t];
        cart = t.items.map((l) => ({ ...l })); setCurrentParkedTicketIndex(0); };
    `;
    const run = (body) => win.evaluate(async ({ setup, body }) => {
      const f = new Function("return (async () => {" + setup + body + "})()");
      return await f();
    }, { setup, body });

    // 1) pedido de la app (id con texto): el cajero quita todas las lineas -> se guarda vacio
    let r = await run(`
      const t = mkT("camarero-1795005632544-kgi33q"); entrar(t);
      cart = []; armKeepParkedLinkIfCartEmptied();
      const it = getMesasAutoSaveIntent();
      return { activo: ACTIVE_PARKED_TICKET_ID_STR, marca: PARKED_LINK_KEPT_EMPTY_ID, emptied: !!(it && it.emptied), tipoMarca: typeof PARKED_LINK_KEPT_EMPTY_ID };`);
    check("Pedido de la app (id con texto): al vaciar la mesa se activa la marca de «vaciado por el cajero»", r.marca === "camarero-1795005632544-kgi33q" && r.tipoMarca === "string", JSON.stringify(r));
    check("... y el autoguardado decide GUARDAR el pedido vacio (antes no guardaba nada)", r.emptied === true, JSON.stringify(r));

    // 2) pedido numerico (TPV normal/Mesas del TPV): sigue igual
    r = await run(`
      const t = mkT(1795000000123); entrar(t);
      cart = []; armKeepParkedLinkIfCartEmptied();
      const it = getMesasAutoSaveIntent();
      return { marca: PARKED_LINK_KEPT_EMPTY_ID, emptied: !!(it && it.emptied) };`);
    check("Pedido con id numerico: sigue guardandose vacio (sin cambios)", r.emptied === true && r.marca === "1795000000123", JSON.stringify(r));

    // 3) carrito vacio por otra causa (sin que el cajero quite lineas): NO se guarda vacio
    r = await run(`
      const t = mkT("camarero-1795005632544-kgi33q"); entrar(t);
      cart = [];   // sin armKeepParkedLinkIfCartEmptied: p. ej. cambio de mesa o recarga
      const it = getMesasAutoSaveIntent();
      return { intent: it };`);
    check("Carrito vacio por otra causa (sin marca del cajero): no se guarda vacio", r.intent === null, JSON.stringify(r));

    // 4) volver a añadir una linea retira la marca
    r = await run(`
      const t = mkT("camarero-1795005632544-kgi33q"); entrar(t);
      cart = []; armKeepParkedLinkIfCartEmptied();
      const antes = PARKED_LINK_KEPT_EMPTY_ID;
      cart = [{ ...t.items[0] }]; renderCart();
      return { antes, despues: PARKED_LINK_KEPT_EMPTY_ID };`);
    check("Al volver a añadir una linea, la marca se retira", r.antes !== "" && r.despues === "", JSON.stringify(r));

    // 5) cambiar a otro pedido retira la marca
    r = await run(`
      const t = mkT("camarero-1795005632544-kgi33q"); entrar(t);
      cart = []; armKeepParkedLinkIfCartEmptied();
      const otro = mkT("camarero-9999999999999-otro"); otro.mesaUid = "tut-room-1::m8";
      parkedTickets = [t, otro]; setCurrentParkedTicketIndex(1);
      return { marca: PARKED_LINK_KEPT_EMPTY_ID };`);
    check("Cambiar a otro pedido retira la marca (no se vacia el otro por error)", r.marca === "", JSON.stringify(r));
  } catch (e) {
    failN++; console.log("[FAIL] error: " + (e && e.stack || e));
  } finally {
    clearTimeout(hard);
    kill();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nRESULTADO: ${okN} OK, ${failN} FAIL`);
  process.exit(failN ? 1 : 0);
})();
