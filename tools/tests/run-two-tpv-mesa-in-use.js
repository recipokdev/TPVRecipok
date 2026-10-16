// run-two-tpv-mesa-in-use.js -- prueba MANUAL (no entra en npm test) del aviso suave "mesa en uso"
// con DOS TPV reales contra el demo (mesa M3 / M1). No guarda ningun pedido ni imprime nada.
// Perfiles persistentes de run-two-tpv.js, sesion ya iniciada (nunca PIN). Requiere
// parked_ops_pilot_slugs_mesas = ['demo'].
// Comprueba: A sola -> sin aviso; B abre la misma mesa -> los dos ven al otro; B cambia de mesa ->
// A deja de ver el aviso; B vuelve y sale (deselecciona) -> idem.
// Uso: node tools/tests/run-two-tpv-mesa-in-use.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const kills = [];
const M3 = "tut-room-1::m3";
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

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((f) => f()); process.exit(1); }, 200000);
  const out = {};
  let A, B;
  try {
    A = await launch("tpvrecipok-2tpv-real-1", "A");
    B = await launch("tpvrecipok-2tpv-real-2", "B");
    await sleep(8000);
    const notice = (X) => X.win.evaluate(() => { const el = document.getElementById("mesaInUseNotice"); return el && !el.classList.contains("hidden") ? el.textContent : ""; });
    const sel = (X, uid) => X.win.evaluate((u) => { updateMesasSelectionFromContext({ tableUid: u }); syncTpvCartWithSelectedMesa(); }, uid);
    out.modo = await Promise.all([A, B].map((X) => X.win.evaluate(() => ({ mesas: MESAS_INLINE_ACTIVE, ops: parkedOpsIsEnabled(getCurrentSlugForReservations(), "mesas"), agente: String(currentAgent?.name || currentAgent?.nick || ""), term: String(currentTerminal?.name || "") }))));

    await sel(A, M3);
    await sleep(4500);
    out.A_sola = await notice(A);

    await sel(B, M3);
    await sleep(4500);
    out.B_ve_a_A = await notice(B);
    await sleep(14000); // siguiente latido de A: ya ve a B
    out.A_ve_a_B = await notice(A);

    // B cambia de mesa
    await sel(B, "tut-room-1::m1");
    await sleep(17000);
    out.A_tras_cambiar_B = await notice(A);
    out.B_en_otra_mesa = await notice(B);

    // B vuelve y luego sale de las transacciones (ya no hay mesa seleccionada)
    await sel(B, M3);
    await sleep(4500);
    out.B_vuelve = await notice(B);
    await B.win.evaluate(() => { MESAS_INLINE_VIEW = "mesas"; });
    await sleep(4500);
    out.B_sale_aviso_oculto = await notice(B);
    await sleep(14000);
    out.A_tras_salir_B = await notice(A);
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    console.log(JSON.stringify(out, null, 1));
    clearTimeout(hard);
    kills.forEach((f) => f());
    process.exit(0);
  }
})();
