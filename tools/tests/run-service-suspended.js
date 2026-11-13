// run-service-suspended.js -- prueba (entra en la bateria, nivel full): "servicio desactivado" cuando la clave de API de
// FacturaScripts deja de valer (2026-11-13). Una instancia real del TPV (perfil de pruebas, sesion ya iniciada, nunca PIN).
// NO usa el FacturaScripts real: FS bloquea la IP (429) tras unos pocos intentos con una clave mala y eso rompia las demas
// pruebas de la demo. Se levanta un servidor local que imita sus respuestas («401 Clave de API no válida», y tras el primer
// intento malo «429 bloqueado temporalmente el acceso desde su IP») y, solo en memoria del TPV de prueba, se apunta la
// API y clients.json a el. Al terminar se restauran la direccion y la clave reales (tambien las guardadas).
//   S1 la clave de la empresa cambio en clients.json -> el TPV la adopta solo y NO se bloquea.
//   S2 la clave esta desactivada de verdad (clients.json trae la misma, y el servidor ya responde 429) -> el TPV se bloquea
//      con un aviso, deja de llamar a los servidores, no encola ventas y no guarda la clave mala.
//   S3 la clave vuelve a valer -> al pulsar "Reintentar" se reanuda solo.
// Uso: node tools/tests/run-service-suspended.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os"), https = require("https"), fs = require("fs");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let kill = () => {};

const GOOD = "K-BUENA";
const mock = { hits: 0, bad: 0, banAfter: 1000 };
// https (la pagina solo permite conectar a https) con un certificado de pruebas; Electron se lanza con --ignore-certificate-errors.
const FIX = path.join(__dirname, "fixtures");
const server = https.createServer({ key: fs.readFileSync(path.join(FIX, "mock-api-test.key")), cert: fs.readFileSync(path.join(FIX, "mock-api-test.crt")) }, (req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Token, Accept, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  mock.hits += 1;
  const key = String(req.headers["token"] || "");
  const send = (code, body) => { res.writeHead(code, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (key === GOOD) return send(200, []);
  mock.bad += 1;
  if (mock.bad > mock.banAfter) return send(429, { status: "error", message: "Por motivos de seguridad se ha bloqueado temporalmente el acceso desde su IP." });
  return send(401, { status: "error", message: "Clave de API no válida" });
});

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); try { server.close(); } catch {} process.exit(1); }, 240000);
  const out = {};
  let win = null, app = null;
  try {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const mockBase = `https://127.0.0.1:${server.address().port}/demo/api/3`;
    const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: path.join(os.tmpdir(), "tpvrecipok-2tpv-real-1"), TPV_TEST_LABEL: "A" };
    delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
    app = await electron.launch({ args: [ROOT, "--ignore-certificate-errors"], cwd: ROOT, env });
    const pid = app.process().pid;
    kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 60000) {
      for (const w of app.windows()) { try { if (!w.url().includes("index.html")) continue; if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
      if (!win) await sleep(200);
    }
    for (let i = 0; i < 150; i++) { if (await win.evaluate(() => typeof TPV_LOADING !== "undefined" && TPV_LOADING === false && !!window.RECIPOK_API?.apiKey).catch(() => false)) break; await sleep(200); }
    await sleep(2000);

    // Guardar lo real, apuntar la API al servidor simulado y simular clients.json (todo en memoria de la pagina).
    out.inicio = await win.evaluate((mockBase) => {
      window.__orig = { email: String(localStorage.getItem("tpv_companyEmail") || ""), baseUrl: String(window.RECIPOK_API.baseUrl), apiKey: String(window.RECIPOK_API.apiKey) };
      window.__realFetchClients = fetchClientsJson;
      window.__realLoadData = loadDataFromApi;
      window.__setClients = (apiKey) => { fetchClientsJson = async () => ({ clients: [{ email: window.__orig.email, slug: "demo", apiKey, active: true }] }); };
      loadDataFromApi = async () => {}; // al reanudar no se recarga el catalogo contra el servidor simulado
      window.__offlineBefore = localStorage.getItem("tpv_offlineTickets_v1");
      const suspendido0 = __serviceSuspended, aviso0 = !document.getElementById("serviceSuspendedOverlay")?.classList.contains("hidden");
      window.RECIPOK_API.baseUrl = mockBase;
      return { tieneClave: !!window.__orig.apiKey, email: !!window.__orig.email, suspendido: suspendido0, aviso: aviso0 };
    }, mockBase);
    const apiReadFails = () => win.evaluate(async () => { try { await apiRead("productos?limit=1"); return "ok"; } catch (e) { return String(e?.code || e?.message || e).slice(0, 80); } });
    const state = () => win.evaluate(async () => ({
      suspendido: __serviceSuspended,
      aviso: !document.getElementById("serviceSuspendedOverlay")?.classList.contains("hidden"),
      titulo: (document.querySelector("#serviceSuspendedOverlay h2")?.textContent || "").trim(),
      clave: window.RECIPOK_API.apiKey,
      claveGuardadaLS: localStorage.getItem("tpv_apiKey"),
      claveGuardadaCfg: (await window.TPV_CFG?.get?.("company.apiKey")) || "",
    }));

    // ---- S1: la clave cambio en clients.json y la nueva funciona -> se adopta, no se bloquea
    mock.bad = 0; mock.banAfter = 1000;
    await win.evaluate((g) => { window.__setClients(g); window.RECIPOK_API.apiKey = "K-MALA-1"; __serviceLastCheckAt = 0; api429BlockedUntil = 0; }, GOOD);
    out.S1_llamada = await apiReadFails();
    for (let i = 0; i < 30; i++) { const s = await state(); if (s.clave === GOOD) break; await sleep(500); }
    await sleep(1000);
    out.S1 = await state();
    out.S1_despues = await apiReadFails();

    // ---- S2: clave desactivada de verdad: clients.json trae la misma y, tras el primer intento, el servidor responde 429
    mock.bad = 0; mock.banAfter = 1;
    await win.evaluate(() => { window.__setClients("K-MALA-2"); window.RECIPOK_API.apiKey = "K-MALA-2"; __serviceLastCheckAt = 0; api429BlockedUntil = 0; });
    out.S2_llamada = await apiReadFails();
    for (let i = 0; i < 40; i++) { const s = await state(); if (s.suspendido) break; await sleep(500); }
    await sleep(800);
    out.S2 = await state();
    const hitsAntes = mock.hits;
    await win.evaluate(() => { api429BlockedUntil = 0; }); // que no salte antes el contador propio de "demasiadas peticiones"
    out.S2_llamadaBloqueada = await apiReadFails();
    out.S2_llamadaSync = await win.evaluate(async () => { try { await fetch(`${TPV_SYNC_API_URL}?action=ping`); return "ok"; } catch (e) { return String(e?.code || e?.message || e).slice(0, 60); } });
    await sleep(1500);
    out.S2_peticionesNuevasAlServidor = mock.hits - hitsAntes;
    out.S2_colaOffline = await win.evaluate(() => ({ igual: localStorage.getItem("tpv_offlineTickets_v1") === window.__offlineBefore }));
    // dos pulsaciones seguidas de Reintentar: la segunda no insiste
    out.S2_reintento1 = await win.evaluate(async () => { await reprobeService(true); return (document.getElementById("serviceSuspendedStatus")?.textContent || "").trim(); });
    out.S2_reintento2 = await win.evaluate(async () => { await reprobeService(true); return (document.getElementById("serviceSuspendedStatus")?.textContent || "").trim(); });

    // ---- S3: la clave vuelve a valer -> Reintentar y se reanuda
    mock.banAfter = 1000;
    await win.evaluate((g) => { window.RECIPOK_API.apiKey = g; window.__setClients(g); __serviceLastManualRetryAt = 0; api429BlockedUntil = 0; }, GOOD);
    await win.evaluate(() => document.getElementById("serviceSuspendedRetryBtn")?.click());
    for (let i = 0; i < 30; i++) { const s = await state(); if (!s.suspendido) break; await sleep(500); }
    await sleep(800);
    out.S3 = await state();
    out.S3_llamada = await apiReadFails();
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    // dejar el perfil exactamente como estaba (direccion y clave reales, tambien las guardadas)
    try {
      out.restaurado = await win.evaluate(async () => {
        if (window.__realFetchClients) fetchClientsJson = window.__realFetchClients;
        if (window.__realLoadData) loadDataFromApi = window.__realLoadData;
        __serviceSuspended = false;
        document.getElementById("serviceSuspendedOverlay")?.classList.add("hidden");
        if (window.__orig) await saveResolvedCompany(window.__orig);
        return {
          memoria: window.__orig && window.RECIPOK_API.baseUrl === window.__orig.baseUrl && window.RECIPOK_API.apiKey === window.__orig.apiKey,
          ls: window.__orig && localStorage.getItem("tpv_baseUrl") === window.__orig.baseUrl && localStorage.getItem("tpv_apiKey") === window.__orig.apiKey,
          cfg: window.__orig && (await window.TPV_CFG?.get?.("company.baseUrl")) === window.__orig.baseUrl && (await window.TPV_CFG?.get?.("company.apiKey")) === window.__orig.apiKey,
        };
      });
    } catch {}
    try { await app.evaluate(({ session }) => session.defaultSession.flushStorageData()); } catch {}
    console.log(JSON.stringify(out, null, 1));
    const i = out.inicio || {}, s1 = out.S1 || {}, s2 = out.S2 || {}, s3 = out.S3 || {}, rs = out.restaurado || {};
    const verdict = require("./battery/verdict.js").emitVerdict([
      ["La prueba terminó sin errores", !out.ERROR, out.ERROR || ""],
      ["Al empezar el TPV tiene clave, empresa y no está bloqueado", i.tieneClave && i.email && i.suspendido === false && i.aviso === false, i],
      ["S1: con una clave falsa, la llamada a FacturaScripts falla (401 «Clave de API no válida»)", /Clave de API no v/i.test(out.S1_llamada || ""), out.S1_llamada],
      ["S1: la clave nueva de clients.json funciona: el TPV la adopta solo y NO se bloquea", s1.clave === GOOD && s1.suspendido === false && s1.aviso === false, s1],
      ["S1: después las llamadas a FacturaScripts vuelven a funcionar", out.S1_despues === "ok", out.S1_despues],
      ["S2: con la clave desactivada de verdad, la llamada falla (401)", /Clave de API no v/i.test(out.S2_llamada || ""), out.S2_llamada],
      ["S2: aunque el servidor ya responda 429 (bloqueo de IP), el TPV se bloquea con el aviso «Servicio desactivado»", s2.suspendido === true && s2.aviso === true && /Servicio desactivado/i.test(s2.titulo), s2],
      ["S2: bloqueado, las llamadas a FacturaScripts ni salen a la red (error propio y 0 peticiones nuevas)", out.S2_llamadaBloqueada === "TPV_SERVICE_SUSPENDED" && out.S2_peticionesNuevasAlServidor === 0, { error: out.S2_llamadaBloqueada, nuevas: out.S2_peticionesNuevasAlServidor }],
      ["S2: bloqueado, tampoco llama al servidor de sincronización del TPV", out.S2_llamadaSync === "TPV_SERVICE_SUSPENDED", out.S2_llamadaSync],
      ["S2: no se acumula ninguna venta en la cola local", (out.S2_colaOffline || {}).igual === true, out.S2_colaOffline],
      ["S2: la clave mala nunca se guarda (ni en localStorage ni en la configuración)", s2.claveGuardadaLS !== "K-MALA-2" && s2.claveGuardadaCfg !== "K-MALA-2" && s2.claveGuardadaLS !== "K-MALA-1" && s2.claveGuardadaCfg !== "K-MALA-1", { ls: s2.claveGuardadaLS === GOOD ? "(buena)" : "otra", cfg: s2.claveGuardadaCfg === GOOD ? "(buena)" : "otra" }],
      ["S2: «Reintentar» dos veces seguidas: la segunda no insiste (espera unos segundos)", /Espera unos segundos/i.test(out.S2_reintento2 || "") && !/Espera unos segundos/i.test(out.S2_reintento1 || ""), { primera: out.S2_reintento1, segunda: out.S2_reintento2 }],
      ["S3: al volver a valer la clave y pulsar Reintentar, se reanuda solo y el aviso desaparece", s3.suspendido === false && s3.aviso === false && s3.clave === GOOD, s3],
      ["S3: las llamadas a FacturaScripts funcionan otra vez", out.S3_llamada === "ok", out.S3_llamada],
      ["Al terminar se restauran la dirección y la clave reales (en memoria y guardadas)", rs.memoria === true && rs.ls === true && rs.cfg === true, rs],
    ]);
    clearTimeout(hard);
    kill();
    try { server.close(); } catch {}
    process.exit(verdict.fails ? 1 : 0);
  }
})();
