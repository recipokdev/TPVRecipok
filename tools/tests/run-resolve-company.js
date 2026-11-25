// run-resolve-company.js -- prueba (bateria, nivel standard, sin demo ni red real) de la FASE 1 de privacidad en el TPV:
// el TPV ya NO descarga clients.json entero; pregunta por UN email al servicio resolve_company.php (status active / inactive / unknown).
// Arranca el TPV en modo E2E "seguro" (perfil aislado) y lo apunta, solo en memoria de la pagina, a un servidor falso local (https con
// certificado de pruebas) que imita al servicio nuevo y al clients.json de siempre. Comprueba:
//   - la peticion (POST, cabecera X-TPV-API-KEY, email normalizado en el CUERPO y no en la URL) y las 3 respuestas;
//   - 429: respeta Retry-After (de la cabecera o del cuerpo) y NO vuelve a llamar mientras dura; se cuenta como fallo de conexion;
//   - 404 (servidor sin el servicio): respaldo al clients.json de siempre; 401, 500, JSON roto y red caida;
//   - el ARRANQUE (bootstrapCompany) con empresa guardada hace UNA sola peticion, refresca la clave, bloquea una cuenta de baja,
//     conserva lo guardado si el email ya no existe o no hay conexion, y no pregunta el email por error;
//   - la primera activacion (email desconocido -> aviso y se vuelve a preguntar) y la autocuracion de claves.
// Uso: node tools/tests/run-resolve-company.js
process.env.TPV_RUN_BACKGROUND = "1";
const path = require("path"), os = require("os"), https = require("https"), fs = require("fs");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let kill = () => {};

const mock = { mode: "ok", resolve: 0, legacy: 0, health: 0, last: null };
const FIX = path.join(__dirname, "fixtures");
const server = https.createServer({ key: fs.readFileSync(path.join(FIX, "mock-api-test.key")), cert: fs.readFileSync(path.join(FIX, "mock-api-test.crt")) }, (req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Accept, Content-Type, X-TPV-API-KEY", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Expose-Headers": "Retry-After" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const send = (code, body, extra = {}) => { res.writeHead(code, { ...cors, "Content-Type": typeof body === "string" ? "text/html" : "application/json", ...extra }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
  if (req.url.startsWith("/clients.json")) { mock.legacy += 1; return send(200, { clients: [{ email: "activo@x.es", slug: "cli_a", apiKey: "KEY-LEGACY", active: true }, { email: "baja@x.es", slug: "cli_b", apiKey: "K", active: false }] }); }
  if (req.url.startsWith("/health")) { mock.health += 1; return send(200, { ok: true }); }
  if (req.url.startsWith("/api/resolve_company.php")) {
    mock.resolve += 1;
    let b = ""; req.on("data", (x) => (b += x));
    return req.on("end", () => {
      let email = ""; try { email = JSON.parse(b).email; } catch {}
      mock.last = { method: req.method, url: req.url, key: req.headers["x-tpv-api-key"], ctype: req.headers["content-type"], email };
      if (mock.mode === "rate") return send(429, { ok: false, error: "x", retryAfterSec: 30 }, { "Retry-After": "30" });
      if (mock.mode === "rate-body") return send(429, { ok: false, error: "x", retryAfterSec: 20 });
      if (mock.mode === "notfound") return send(404, "<html>404</html>");
      if (mock.mode === "unauthorized") return send(401, { ok: false, error: "No autorizado." });
      if (mock.mode === "err500") return send(500, { ok: false, error: "Servicio no disponible." });
      if (mock.mode === "badjson") return send(200, "<html>no es json</html>");
      if (email === "activo@x.es") return send(200, { ok: true, status: "active", slug: "cli_a", apiKey: "KEY-NEW" });
      if (email === "baja@x.es") return send(200, { ok: true, status: "inactive" });
      return send(200, { ok: true, status: "unknown" });
    });
  }
  send(404, "no");
});

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); try { server.close(); } catch {} process.exit(1); }, 200000);
  const out = {};
  let app = null;
  try {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const BASE = `https://127.0.0.1:${server.address().port}`;
    const env = {
      ...process.env, TPV_E2E: "1", TPV_MODE: "demo", TPV_E2E_BACKGROUND: "1", TPV_E2E_REQUIRE_ONLINE: "0", TPV_E2E_ALLOW_WRITES: "0",
      TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3", TPV_E2E_API_KEY: "", TPV_E2E_USER_DATA: path.join(os.tmpdir(), `tpvrecipok-resolve-company-${Date.now()}`),
    };
    app = await electron.launch({ args: [ROOT, "--ignore-certificate-errors"], cwd: ROOT, env });
    const pid = app.process().pid;
    kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
    let win = null; const t0 = Date.now();
    while (!win && Date.now() - t0 < 45000) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => !!document.getElementById("cashHeaderBtn"))) { win = w; break; } } catch {} }
      if (!win) await sleep(300);
    }
    if (!win) throw new Error("No se encontro la ventana principal");
    await sleep(2000);

    // Apuntar las direcciones a la maquina de pruebas (solo en memoria de la pagina) y preparar los dobles para probar el arranque.
    await win.evaluate((BASE) => {
      window.TPV_CONFIG.tpvResolveCompanyApiUrl = `${BASE}/api/resolve_company.php`;
      window.TPV_CONFIG.resolverUrl = `${BASE}/clients.json`;
      window.TPV_CONFIG.tpvCompanyProbeUrl = `${BASE}/health`;
      window.TPV_CONFIG.tpvApiKey = "CLAVE-COMPARTIDA-PRUEBA";
      window.__st = { prompts: 0, emails: [], alerts: [], modals: [], reconnect: 0, persisted: null, savedCfg: {} };
      askEmailWithModal = async () => { window.__st.prompts += 1; return window.__st.emails.shift() || ""; };
      window.alert = (m) => window.__st.alerts.push(String(m));
      showMessageModal = (t, m) => window.__st.modals.push([String(t), String(m)]);
      showReconnectIfAvailable = () => { window.__st.reconnect += 1; };
      hideReconnectIfAvailable = () => {};
      validateBaseUrlOrThrow = async () => true;
      setConnectionStateOnline = () => {};
      persistCompanyCfg = async (r) => { window.__st.persisted = r; };
      getPersistedCompanyCfg = async () => window.__st.savedCfg;
      hydrateLegacyCompanyFromCfg = async () => {};
      repairCompanyPersistenceIfNeeded = async () => {};
      persistLegacyLocal = () => {};
      logCompanyCfg = () => {};
      warnIfDemoBaseUrl = () => {};
      updateCashButtonLabel = () => {};
      window.__reset = () => { for (const k of ["tpv_companyEmail", "tpv_baseUrl", "tpv_apiKey"]) { try { localStorage.removeItem(k); } catch {} } TPV_STATE.offline = false; TPV_STATE.apiRecovering = false; TPV_STATE.locked = false; window.__st.prompts = 0; window.__st.emails = []; window.__st.alerts = []; window.__st.modals = []; window.__st.reconnect = 0; window.__st.persisted = null; __resolveCompanyBlockedUntil = 0; window.RECIPOK_API.baseUrl = ""; window.RECIPOK_API.apiKey = ""; };
    }, BASE);

    const hits = () => ({ resolve: mock.resolve, legacy: mock.legacy, health: mock.health });
    const diff = (a, b) => ({ resolve: b.resolve - a.resolve, legacy: b.legacy - a.legacy, health: b.health - a.health });
    const fn = (code, arg) => win.evaluate(async ([code, arg]) => { TPV_STATE.offline = false; TPV_STATE.apiRecovering = false; try { return { ok: true, v: await eval(code)(arg) }; } catch (e) { return { ok: false, msg: String(e?.message || e), rate: !!e?.rateLimited, conn: isConnectivityLikeError(e) }; } }, [code, arg]);
    const setup = (cfg) => win.evaluate((cfg) => { window.__reset(); window.__st.savedCfg = cfg; }, cfg);
    const boot = () => win.evaluate(async () => { const r = await bootstrapCompany(); return { r, st: window.__st, locked: TPV_STATE.locked, apiKey: window.RECIPOK_API.apiKey, baseUrl: window.RECIPOK_API.baseUrl }; });
    const SAVED = (email) => ({ "company.email": email, "company.baseUrl": "https://plus.recipok.com/cli_viejo/api/3", "company.apiKey": "KEY-OLD" });

    // ---------- Funciones sueltas ----------
    mock.mode = "ok"; let h = hits();
    out.F1 = await fn("(e) => resolveCompanyRemote(e)", "  ACTIVO@x.es ");
    out.F1_last = mock.last; out.F1_hits = diff(h, hits());
    out.F2 = await fn("(e) => resolveCompanyRemote(e)", "baja@x.es");
    out.F3 = await fn("(e) => resolveCompanyRemote(e)", "otro@x.es");
    out.F2b = await fn("(e) => resolveCompanyByEmail(e)", "baja@x.es");
    out.F3b = await fn("(e) => resolveCompanyByEmail(e)", "otro@x.es");
    out.F1b = await fn("(e) => resolveCompanyByEmail(e)", "activo@x.es");
    // 429 con cabecera
    mock.mode = "rate"; await win.evaluate(() => { __resolveCompanyBlockedUntil = 0; }); h = hits();
    out.R1 = await fn("(e) => resolveCompanyRemote(e)", "activo@x.es"); const hR1 = hits();
    out.R1_otra = await fn("(e) => resolveCompanyRemote(e)", "activo@x.es"); out.R1_hits = { primera: diff(h, hR1), segunda: diff(hR1, hits()) };
    out.R1_espera = await win.evaluate(() => Math.round((__resolveCompanyBlockedUntil - Date.now()) / 1000));
    await win.evaluate(() => { __resolveCompanyBlockedUntil = 0; }); mock.mode = "ok";
    out.R1_despues = await fn("(e) => resolveCompanyRemote(e)", "activo@x.es");
    // 429 sin cabecera Retry-After (solo en el cuerpo)
    mock.mode = "rate-body"; await win.evaluate(() => { __resolveCompanyBlockedUntil = 0; });
    out.R2 = await fn("(e) => resolveCompanyRemote(e)", "activo@x.es");
    out.R2_espera = await win.evaluate(() => Math.round((__resolveCompanyBlockedUntil - Date.now()) / 1000));
    await win.evaluate(() => { __resolveCompanyBlockedUntil = 0; });
    // 404 -> respaldo
    mock.mode = "notfound"; h = hits();
    out.L1 = await fn("(e) => resolveCompanyRemote(e)", "activo@x.es"); out.L1_hits = diff(h, hits());
    out.L2 = await fn("(e) => resolveCompanyRemote(e)", "baja@x.es");
    out.L3 = await fn("(e) => resolveCompanyRemote(e)", "otro@x.es");
    // otros fallos
    mock.mode = "unauthorized"; out.E401 = await fn("(e) => resolveCompanyRemote(e)", "activo@x.es"); out.E401_hits = null;
    mock.mode = "err500"; out.E500 = await fn("(e) => resolveCompanyRemote(e)", "activo@x.es");
    mock.mode = "badjson"; out.EJSON = await fn("(e) => resolveCompanyRemote(e)", "activo@x.es");
    await win.evaluate((BASE) => { window.__goodUrl = window.TPV_CONFIG.tpvResolveCompanyApiUrl; window.TPV_CONFIG.tpvResolveCompanyApiUrl = "https://127.0.0.1:9/api/resolve_company.php"; }, BASE);
    out.ERED = await fn("(e) => resolveCompanyRemote(e)", "activo@x.es");
    await win.evaluate(() => { window.TPV_CONFIG.tpvResolveCompanyApiUrl = window.__goodUrl; });
    out.EVACIO = await fn("(e) => resolveCompanyRemote(e)", "   ");

    // ---------- Arranque (bootstrapCompany) ----------
    mock.mode = "ok";
    await setup(SAVED("activo@x.es")); h = hits(); out.B1 = await boot(); out.B1_hits = diff(h, hits());
    await setup(SAVED("baja@x.es")); h = hits(); out.B2 = await boot(); out.B2_hits = diff(h, hits());
    await setup(SAVED("otro@x.es")); h = hits(); out.B3 = await boot(); out.B3_hits = diff(h, hits());
    mock.mode = "err500"; await setup(SAVED("activo@x.es")); h = hits(); out.B4 = await boot(); out.B4_hits = diff(h, hits());
    mock.mode = "rate"; await setup(SAVED("activo@x.es")); h = hits(); out.B5 = await boot(); const hB5 = hits();
    out.B5b = await win.evaluate(async () => { const r = await bootstrapCompany(); return { r, prompts: window.__st.prompts }; }); out.B5_hits = { primero: diff(h, hB5), segundo: diff(hB5, hits()) };
    mock.mode = "ok"; await setup({ "company.email": "activo@x.es" }); h = hits(); out.B6 = await boot(); out.B6_hits = diff(h, hits());
    await setup({}); await win.evaluate(() => { window.__st.emails = ["activo@x.es"]; }); h = hits(); out.B7 = await boot(); out.B7_hits = diff(h, hits());
    await setup({}); await win.evaluate(() => { window.__st.emails = ["nadie@x.es", "activo@x.es"]; }); h = hits(); out.B8 = await boot(); out.B8_hits = diff(h, hits());
    await setup({}); await win.evaluate(() => { window.__st.emails = ["activo@x.es"]; window.__goodProbe = window.TPV_CONFIG.tpvCompanyProbeUrl; window.TPV_CONFIG.tpvCompanyProbeUrl = "https://127.0.0.1:9/health"; }); h = hits(); out.B9 = await boot(); out.B9_hits = diff(h, hits());
    await win.evaluate(() => { window.TPV_CONFIG.tpvCompanyProbeUrl = window.__goodProbe; });
    mock.mode = "notfound"; await setup(SAVED("activo@x.es")); h = hits(); out.B10 = await boot(); out.B10_hits = diff(h, hits());
    mock.mode = "ok"; await setup({}); await win.evaluate(() => { window.__st.emails = ["baja@x.es"]; }); out.B11 = await boot();

    // ---------- Autocuracion de claves ----------
    const adopt = (email, lookupMode) => win.evaluate(async ([email]) => {
      window.__reset(); localStorage.setItem("tpv_companyEmail", email); window.RECIPOK_API.apiKey = "KEY-OLD"; window.RECIPOK_API.baseUrl = "https://plus.recipok.com/cli_a/api/3";
      probeServiceKey = async () => "ok";
      const r = await tryAdoptNewServiceKey();
      return { r, key: window.RECIPOK_API.apiKey };
    }, [email]);
    out.A1 = await adopt("activo@x.es"); out.A2 = await adopt("baja@x.es"); out.A3 = await adopt("otro@x.es");
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    console.log(JSON.stringify(out, null, 1));
    const ok = (name, cond, extra) => [name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)];
    const c = [];
    c.push(ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || ""));
    const l = out.F1_last || {};
    c.push(ok("F1: pregunta por UN email: POST con la clave compartida y el email normalizado en el CUERPO (no en la URL)", out.F1?.ok && l.method === "POST" && l.key === "CLAVE-COMPARTIDA-PRUEBA" && /json/.test(l.ctype || "") && l.email === "activo@x.es" && !/activo/.test(l.url || ""), { l, F1: out.F1 }));
    c.push(ok("F1: contesta active con slug y clave, con UNA petición y sin tocar clients.json", out.F1?.v?.status === "active" && out.F1.v.slug === "cli_a" && out.F1.v.apiKey === "KEY-NEW" && out.F1_hits?.resolve === 1 && out.F1_hits?.legacy === 0, { F1: out.F1, h: out.F1_hits }));
    c.push(ok("F2/F3: de baja -> inactive; desconocido -> unknown (sin clave)", out.F2?.v?.status === "inactive" && !out.F2.v.apiKey && out.F3?.v?.status === "unknown" && !out.F3.v.apiKey, { F2: out.F2, F3: out.F3 }));
    c.push(ok("F1b/F2b/F3b: resolveCompanyByEmail mantiene los mensajes de siempre (OK / «desactivada» / «no encontrada»)", out.F1b?.v?.apiKey === "KEY-NEW" && /plus\.recipok\.com\/cli_a\/api\/3$/.test(out.F1b.v.baseUrl || "") && /desactivada/i.test(out.F2b?.msg || "") && /no encontrada/i.test(out.F3b?.msg || ""), { F1b: out.F1b, F2b: out.F2b, F3b: out.F3b }));
    c.push(ok("R1: un 429 con Retry-After: 30 se anota (≈30 s), se cuenta como fallo de conexión y NO se vuelve a llamar mientras dura", out.R1?.rate && out.R1.conn && out.R1_otra?.rate && out.R1_hits?.primera?.resolve === 1 && out.R1_hits?.segunda?.resolve === 0 && out.R1_espera >= 25 && out.R1_espera <= 31, { R1: out.R1, hits: out.R1_hits, espera: out.R1_espera }));
    c.push(ok("R1: pasado el plazo vuelve a funcionar", out.R1_despues?.v?.status === "active"));
    c.push(ok("R2: un 429 sin cabecera usa el retryAfterSec del cuerpo (≈20 s)", out.R2?.rate && out.R2_espera >= 15 && out.R2_espera <= 21, { R2: out.R2, espera: out.R2_espera }));
    c.push(ok("L1: si el servidor no tiene el servicio (404) cae al clients.json de siempre", out.L1?.v?.status === "active" && out.L1.v.apiKey === "KEY-LEGACY" && out.L1_hits?.resolve === 1 && out.L1_hits?.legacy === 1, { L1: out.L1, h: out.L1_hits }));
    c.push(ok("L2/L3: el respaldo también distingue de baja y desconocido", out.L2?.v?.status === "inactive" && out.L3?.v?.status === "unknown", { L2: out.L2, L3: out.L3 }));
    c.push(ok("E401: un 401 es un error real (no «sin conexión») y no cae al fichero", !out.E401?.ok && /no autorizado/i.test(out.E401?.msg || "") && out.E401.conn === false, out.E401));
    c.push(ok("E500 / JSON roto / red caída: se tratan como fallo de conexión", !out.E500?.ok && out.E500.conn && !out.EJSON?.ok && out.EJSON.conn && !out.ERED?.ok && out.ERED.conn, { E500: out.E500, EJSON: out.EJSON, ERED: out.ERED }));
    c.push(ok("Un email vacío no llega a preguntar al servidor", !out.EVACIO?.ok && /vac/i.test(out.EVACIO?.msg || ""), out.EVACIO));
    const b1 = out.B1 || {};
    c.push(ok("B1 arranque con empresa guardada y email activo: UNA sola petición (antes dos descargas), sin clients.json", b1.r === true && out.B1_hits?.resolve === 1 && out.B1_hits?.legacy === 0 && out.B1_hits?.health === 0, { r: b1.r, h: out.B1_hits }));
    c.push(ok("B1: refresca la clave (la rotación llega sola), la guarda y la aplica; no pregunta el email", b1.st?.persisted?.apiKey === "KEY-NEW" && b1.apiKey === "KEY-NEW" && /\/cli_a\/api\/3$/.test(b1.baseUrl || "") && b1.st?.prompts === 0, { persisted: b1.st?.persisted, apiKey: b1.apiKey }));
    const b2 = out.B2 || {};
    c.push(ok("B2 cuenta de baja: bloquea con «Acceso bloqueado», no sigue y no pregunta el email", b2.r === false && b2.locked === true && (b2.st?.modals || []).some((m) => /Acceso bloqueado/.test(m[0])) && b2.st?.prompts === 0 && out.B2_hits?.resolve === 1, { r: b2.r, locked: b2.locked, modals: b2.st?.modals }));
    const b3 = out.B3 || {};
    c.push(ok("B3 email guardado que ya no existe: se mantiene la configuración guardada (clave vieja) y no se pregunta el email", b3.r === true && b3.apiKey === "KEY-OLD" && b3.st?.prompts === 0 && b3.locked === false, { r: b3.r, apiKey: b3.apiKey }));
    const b4 = out.B4 || {};
    c.push(ok("B4 servidor caído (500): sigue con lo guardado, avisa de reconexión y no pregunta el email", b4.r === true && b4.apiKey === "KEY-OLD" && b4.st?.reconnect >= 1 && b4.st?.prompts === 0, { r: b4.r, reconnect: b4.st?.reconnect }));
    const b5 = out.B5 || {};
    c.push(ok("B5 429 en el arranque: sigue con lo guardado y, si se reintenta enseguida, NO vuelve a llamar (respeta Retry-After)", b5.r === true && b5.apiKey === "KEY-OLD" && b5.st?.prompts === 0 && out.B5b?.r === true && out.B5_hits?.primero?.resolve === 1 && out.B5_hits?.segundo?.resolve === 0, { hits: out.B5_hits }));
    const b6 = out.B6 || {};
    c.push(ok("B6 solo hay email guardado (sin clave): la completa con UNA petición", b6.r === true && b6.st?.persisted?.apiKey === "KEY-NEW" && out.B6_hits?.resolve === 1 && b6.st?.prompts === 0, { r: b6.r, h: out.B6_hits }));
    const b7 = out.B7 || {};
    c.push(ok("B7 primera activación: comprueba que hay conexión (1 health), pregunta el email UNA vez y resuelve con UNA petición", b7.r === true && b7.st?.prompts === 1 && out.B7_hits?.health === 1 && out.B7_hits?.resolve === 1 && out.B7_hits?.legacy === 0 && b7.st?.persisted?.apiKey === "KEY-NEW", { r: b7.r, prompts: b7.st?.prompts, h: out.B7_hits }));
    const b8 = out.B8 || {};
    c.push(ok("B8 activación con email desconocido: avisa «Email no encontrado.» y vuelve a preguntar; con el bueno entra", b8.r === true && b8.st?.prompts === 2 && (b8.st?.alerts || []).includes("Email no encontrado.") && b8.st?.persisted?.apiKey === "KEY-NEW", { prompts: b8.st?.prompts, alerts: b8.st?.alerts }));
    const b9 = out.B9 || {};
    c.push(ok("B9 sin conexión y sin nada guardado: avisa de reconexión y NO pregunta el email", b9.r === false && b9.st?.prompts === 0 && b9.st?.reconnect >= 1 && out.B9_hits?.resolve === 0, { r: b9.r, h: out.B9_hits }));
    const b10 = out.B10 || {};
    c.push(ok("B10 servidor sin el servicio nuevo (404): el arranque funciona con el clients.json de siempre", b10.r === true && b10.apiKey === "KEY-LEGACY" && out.B10_hits?.legacy >= 1, { r: b10.r, apiKey: b10.apiKey, h: out.B10_hits }));
    const b11 = out.B11 || {};
    c.push(ok("B11 activar con un email de baja: «Acceso bloqueado» y no entra", b11.r === false && b11.locked === true && (b11.st?.modals || []).some((m) => /Acceso bloqueado/.test(m[0])), { r: b11.r, modals: b11.st?.modals }));
    c.push(ok("A1 autocuración: con una clave nueva que funciona se adopta; de baja -> «inactive»; email desconocido -> «same»", out.A1?.r === "adopted" && out.A1.key === "KEY-NEW" && out.A2?.r === "inactive" && out.A3?.r === "same", { A1: out.A1, A2: out.A2, A3: out.A3 }));
    const verdict = require("./battery/verdict.js").emitVerdict(c);
    clearTimeout(hard); kill(); try { server.close(); } catch {}
    process.exit(verdict.fails ? 1 : 0);
  }
})();
