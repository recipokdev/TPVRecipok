// run-update-gate.js -- prueba (bateria, nivel full, sin demo) de la PUERTA DE ACTUALIZACION del arranque
// (runAutoUpdateGate en main.js), la que dejo a Asador/Sabor/Los Argentinos esperando minutos con GitHub devolviendo 504.
// La puerta solo actua con el programa "empaquetado", asi que se monta un TPV empaquetado SIN compilar: copia de Electron
// (cacheada en %TEMP%) renombrada a TPV-Recipok.exe con resources/app apuntando al codigo de este repositorio y un
// resources/app-update.yml que apunta a un servidor de pruebas local que hace de "GitHub" (504, o "no hay version nueva").
// Escenarios (cada uno arranca el programa de verdad):
//   S1 GitHub devuelve 504: a los 10 s sale el contador y el boton «Entrar ahora»; sin pulsar NO se abre; al pulsarlo abre ya.
//   S2 GitHub se cae y vuelve: sin pulsar nada, al volver se abre solo y el boton desaparece.
//   S3 todo bien y sin version nueva: abre solo, sin boton.
//   S4 el servidor de la empresa no responde: contador y boton igualmente, sin abrir solo; al pulsarlo abre.
// Necesita internet (la puerta comprueba github.com antes de buscar). Nunca toca la demo ni los perfiles de prueba.
// Uso: node tools/tests/run-update-gate.js
const http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const { execSync } = require("child_process");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..", "..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CACHE = path.join(os.tmpdir(), "tpvrecipok-gate-electron");
const EXE = path.join(CACHE, "TPV-Recipok.exe");
const kills = [];

function prepararPaquete(port) {
  if (!fs.existsSync(EXE)) {
    const dist = path.join(ROOT, "node_modules", "electron", "dist");
    fs.rmSync(CACHE, { recursive: true, force: true });
    fs.cpSync(dist, CACHE, { recursive: true });
    fs.renameSync(path.join(CACHE, "electron.exe"), EXE);
  }
  const res = path.join(CACHE, "resources");
  fs.rmSync(path.join(res, "default_app.asar"), { force: true });
  fs.mkdirSync(path.join(res, "app"), { recursive: true });
  // Electron une "main" a la carpeta de la app (no admite rutas absolutas): un main.js minimo carga el del repositorio.
  fs.writeFileSync(path.join(res, "app", "package.json"), JSON.stringify({ ...PKG, main: "main.js" }, null, 2));
  fs.writeFileSync(path.join(res, "app", "main.js"), `require(${JSON.stringify(path.join(ROOT, "main.js"))});\n`);
  fs.writeFileSync(path.join(res, "app-update.yml"), `provider: generic\nurl: http://127.0.0.1:${port}/\nupdaterCacheDirName: tpvrecipok-gate-test\n`);
}

const LATEST = `version: ${PKG.version}\nfiles:\n  - url: TPV-Recipok-Setup-${PKG.version}.exe\n    sha512: AAAA\n    size: 1\npath: TPV-Recipok-Setup-${PKG.version}.exe\nsha512: AAAA\nreleaseDate: '2026-11-12T00:00:00.000Z'\n`;

async function escenario(nombre, { feed, apiCaida = false, accion }) {
  const ud = path.join(os.tmpdir(), `tpvrecipok-gate-${nombre}-${Date.now()}`);
  fs.mkdirSync(ud, { recursive: true });
  if (apiCaida) fs.writeFileSync(path.join(ud, "tpv-config.json"), JSON.stringify({ "company.baseUrl": "https://127.0.0.1:8598/api/3", "company.apiKey": "x", "company.email": "prueba@test.local" }));
  const env = { ...process.env, TPV_MULTI_INSTANCE: "1", TPV_USER_DATA: ud, TPV_RUN_BACKGROUND: "1" };
  delete env.TPV_E2E; delete env.TPV_E2E_USER_DATA; delete env.TPV_MODE;
  const t0 = Date.now();
  const T = () => (Date.now() - t0) / 1000;
  const app = await electron.launch({ executablePath: EXE, args: [], env });
  const pid = app.process().pid;
  const kill = () => { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
  kills.push(kill);
  const o = { nombre };
  const titulos = async () => { const r = []; for (const w of app.windows()) { try { r.push(await w.title()); } catch {} } return r; };
  const principalAbierta = async () => (await titulos()).some((x) => /Local Recipok/i.test(x));
  let splash = null;
  for (let i = 0; i < 80 && !splash; i++) {
    for (const w of app.windows()) { try { if (await w.evaluate(() => !!document.getElementById("enter"))) splash = w; } catch {} }
    if (!splash && !(await principalAbierta())) await sleep(400); else if (!splash) break;
  }
  const snap = async () => {
    if (!splash) return { sinSplash: true };
    return splash.evaluate(() => ({ boton: getComputedStyle(document.getElementById("enter")).display, texto: (document.getElementById("status")?.textContent || "").slice(0, 160) })).catch(() => ({ splashCerrada: true }));
  };
  const esperarHasta = async (s) => { while (T() < s) await sleep(300); };
  const abreDespues = async (maxS) => { const ini = T(); while (T() - ini < maxS) { if (await principalAbierta()) return +(T() - ini).toFixed(1); await sleep(300); } return null; };
  try {
    await accion({ o, T, snap, esperarHasta, abreDespues, principalAbierta, splash: () => splash, t0: () => t0 });
  } finally {
    try { o.log = fs.readFileSync(path.join(ud, "updater.log"), "utf8").split(/\r?\n/).filter((x) => /GATE/.test(x)).slice(-2); } catch {}
    kill();
    await sleep(800);
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
  }
  return o;
}

(async () => {
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kills.forEach((k) => k()); process.exit(1); }, 420000);
  const out = {};
  let modoFeed = "504";
  let feedDesde = 0;
  const srv = http.createServer((req, res) => {
    out.peticiones = (out.peticiones || 0) + 1;
    const sirve = modoFeed === "ok" || (modoFeed === "vuelve" && Date.now() >= feedDesde);
    if (sirve && /latest\.yml(\?|$)/i.test(req.url)) { res.writeHead(200, { "Content-Type": "text/yaml" }); return res.end(LATEST); }
    res.writeHead(sirve ? 404 : 504); res.end("x");
  });
  try {
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    prepararPaquete(srv.address().port);

    // S1: GitHub devuelve 504
    modoFeed = "504";
    out.S1 = await escenario("s1", { accion: async ({ o, snap, esperarHasta, abreDespues, principalAbierta, splash }) => {
      await esperarHasta(5); o.t5 = await snap();
      await esperarHasta(14); o.t14 = await snap();
      await esperarHasta(28); o.t28 = await snap(); o.t28_abierta = await principalAbierta();
      if (splash()) { await splash().click("#enter").catch(() => {}); o.segundos_tras_click = await abreDespues(20); }
    } });

    // S2: GitHub se cae y vuelve a los ~16 s
    modoFeed = "vuelve"; feedDesde = Date.now() + 16000;
    out.S2 = await escenario("s2", { accion: async ({ o, snap, esperarHasta, abreDespues, principalAbierta }) => {
      await esperarHasta(13); o.t13 = await snap(); o.t13_abierta = await principalAbierta();
      o.segundos_hasta_abrir_solo = await abreDespues(40);
    } });

    // S3: todo bien, sin version nueva
    modoFeed = "ok";
    out.S3 = await escenario("s3", { accion: async ({ o, snap, esperarHasta, abreDespues, T }) => {
      await esperarHasta(3); o.t3 = await snap();
      o.segundos_hasta_abrir_solo = await abreDespues(40);
    } });

    // S4: el servidor de la empresa no contesta (el feed va bien)
    modoFeed = "ok";
    out.S4 = await escenario("s4", { apiCaida: true, accion: async ({ o, snap, esperarHasta, abreDespues, principalAbierta, splash }) => {
      await esperarHasta(5); o.t5 = await snap();
      await esperarHasta(14); o.t14 = await snap();
      await esperarHasta(24); o.t24_abierta = await principalAbierta();
      if (splash()) { await splash().click("#enter").catch(() => {}); o.segundos_tras_click = await abreDespues(20); }
    } });
  } catch (e) {
    out.ERROR = String(e && e.message || e).slice(0, 300);
  } finally {
    try { srv.close(); } catch {}
    console.log(JSON.stringify(out, null, 1));
    const verdict = require("./battery/verdict.js").emitVerdict(buildChecks(out));
    clearTimeout(hard);
    kills.forEach((k) => k());
    process.exit(verdict.fails ? 1 : 0);
  }
})();

function buildChecks(out) {
  const c = [];
  const ok = (name, cond, extra) => c.push([name, !!cond, extra === undefined ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)]);
  const visible = (s) => s && s.boton && s.boton !== "none";
  ok("La prueba terminó sin errores", !out.ERROR, out.ERROR || "");
  const s1 = out.S1 || {};
  ok("S1 (GitHub devuelve 504): al principio busca actualizaciones y no ofrece todavía «Entrar ahora»", s1.t5 && !visible(s1.t5) && /Buscando|Comprobando|Reintentando/i.test(s1.t5.texto || ""), s1.t5);
  ok("S1: a los 10 s sale el aviso «No se puede comprobar si hay actualizaciones (llevamos m:ss)» con el contador y el botón «Entrar ahora»", s1.t14 && visible(s1.t14) && /No se puede comprobar.*llevamos \d+:\d{2}/.test(s1.t14.texto || ""), s1.t14);
  ok("S1: sin pulsar nada NO se abre solo con la versión vieja (sin tope de espera) y el contador sigue subiendo", s1.t28_abierta === false && visible(s1.t28) && s1.t28.texto !== (s1.t14 || {}).texto, { abierta: s1.t28_abierta, t28: s1.t28 });
  ok("S1: al pulsar «Entrar ahora» se abre el TPV en pocos segundos", typeof s1.segundos_tras_click === "number" && s1.segundos_tras_click <= 15, s1.segundos_tras_click);
  const s2 = out.S2 || {};
  ok("S2 (GitHub se cae y vuelve): mientras está caído muestra el botón y no se abre", s2.t13 && visible(s2.t13) && s2.t13_abierta === false, { t13: s2.t13, abierta: s2.t13_abierta });
  ok("S2: en cuanto vuelve GitHub el TPV se abre solo, sin pulsar nada", typeof s2.segundos_hasta_abrir_solo === "number" && s2.segundos_hasta_abrir_solo <= 30, s2.segundos_hasta_abrir_solo);
  const s3 = out.S3 || {};
  ok("S3 (todo bien, sin versión nueva): no hay botón de «Entrar ahora» y el TPV se abre solo enseguida", s3.t3 && !visible(s3.t3) && typeof s3.segundos_hasta_abrir_solo === "number" && s3.segundos_hasta_abrir_solo <= 25, { t3: s3.t3, abre: s3.segundos_hasta_abrir_solo });
  const s4 = out.S4 || {};
  ok("S4 (el servidor de la empresa no responde): al principio sin botón y a los 10 s aparece «Entrar ahora» con contador", s4.t5 && !visible(s4.t5) && s4.t14 && visible(s4.t14) && /\d+:\d{2}/.test(s4.t14.texto || ""), { t5: s4.t5, t14: s4.t14 });
  ok("S4: sin pulsar NO se abre solo, y al pulsar «Entrar ahora» se abre el TPV", s4.t24_abierta === false && typeof s4.segundos_tras_click === "number" && s4.segundos_tras_click <= 15, { abierta: s4.t24_abierta, click: s4.segundos_tras_click });
  return c;
}
