// run-battery.js -- BATERIA DE PRUEBAS del TPV Recipok.
//
// Lanza en orden las pruebas de tools/tests/battery/suites.js, recoge cada "[OK]/[FAIL]" y genera un informe
// (HTML + Markdown + JSON) pensado para que lo lea una persona que no es programadora.
//
// Uso:
//   npm run battery:quick      solo codigo (~2 min)
//   npm run battery            = standard: + TPV real en perfil aislado (~10 min)
//   npm run battery:full       + TPV reales contra la demo, con 2 TPV (~40 min; escribe datos de prueba en la demo)
//   node tools/tests/battery/run-battery.js --only=encargos-2tpv,smoke     (solo esas)
//   node tools/tests/battery/run-battery.js --list                          (ver la lista)
//
// Las pruebas "demo" abren TPV reales con los perfiles tpvrecipok-2tpv-real-1/2 (sesion ya iniciada; NUNCA escribe PIN) y
// dejan el stock de sus productos como estaba. Salida: tools/tests/reports/battery-<fecha>/report.html (y latest.html).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { SUITES, AREAS } = require("./suites.js");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const LEVELS = ["quick", "standard", "full"];
const argv = process.argv.slice(2);
const arg = (name, def = "") => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
const level = arg("level", "standard");
const only = arg("only", "").split(",").map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
const tailOf = (buf) => stripAnsi(buf).split(String.fromCharCode(10)).map((l) => l.split(String.fromCharCode(13)).join("")).filter((l) => l.trim()).slice(-25).join(String.fromCharCode(10));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDur = (ms) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`; };

if (argv.includes("--list")) {
  SUITES.forEach((s) => console.log(`${s.level.padEnd(9)} ${s.id.padEnd(28)} ${s.demo ? "[demo] " : "       "}${s.title}`));
  process.exit(0);
}
if (!LEVELS.includes(level)) { console.error(`Nivel desconocido: ${level} (quick|standard|full)`); process.exit(2); }

const selected = SUITES.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.area) : LEVELS.indexOf(s.level) <= LEVELS.indexOf(level)));
if (!selected.length) { console.error("No hay ninguna prueba que coincida."); process.exit(2); }

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const outDir = path.resolve(arg("out", path.join(ROOT, "tools", "tests", "reports", `battery-${stamp}`)));
const logDir = path.join(outDir, "logs");
fs.mkdirSync(logDir, { recursive: true });

function git(cmd) { try { return execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return ""; } }
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const meta = {
  version: pkg.version,
  commit: git("rev-parse --short HEAD"),
  branch: git("rev-parse --abbrev-ref HEAD"),
  dirty: git("status --porcelain").length > 0,
  level, only,
  startedAt: new Date().toISOString(),
  machine: `${os.hostname()} · ${os.platform()} ${os.release()} · Node ${process.version}`,
};

// ---- requisitos de las pruebas con la demo (si faltan, se omiten y se dice en el informe) ----
async function demoPrereqs() {
  const problems = [];
  for (const p of ["tpvrecipok-2tpv-real-1", "tpvrecipok-2tpv-real-2"]) {
    if (!fs.existsSync(path.join(os.tmpdir(), p))) problems.push(`falta el perfil de pruebas ${p} (hay que abrir el TPV una vez con sesión iniciada: npm run test:2tpv)`);
  }
  try {
    const r = await fetch("https://plus.recipok.com/", { method: "HEAD", signal: AbortSignal.timeout(8000) });
    if (!r.ok && r.status >= 500) problems.push(`el servidor responde ${r.status}`);
  } catch (e) { problems.push(`no hay conexión con el servidor (${e.message})`); }
  return problems;
}

// Limpia en la demo los datos de prueba de las pruebas anteriores (si no, el cierre de caja de la siguiente suma encargos de la vez
// anterior). Necesita acceso ssh al servidor (ssh recipok-plesk). Devuelve un texto para el informe.
function cleanupDemo(when) {
  const NL = String.fromCharCode(10);
  try {
    const php = fs.readFileSync(path.join(__dirname, "cleanup-demo.php"));
    const out = execSync("ssh -o BatchMode=yes -o ConnectTimeout=10 recipok-plesk /opt/plesk/php/8.3/bin/php", { input: php, encoding: "utf8", timeout: 120000 });
    return "limpieza de la demo " + when + ": " + out.trim().split(NL).join("; ");
  } catch (e) {
    return "limpieza de la demo " + when + ": NO se pudo (" + String(e.message).split(NL)[0].slice(0, 100) + "); si una prueba de Encargos falla, borra a mano los encargos «TEST2TPV…» de la demo";
  }
}

function killTree(pid) { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} }

function parseChecks(text) {
  const checks = [];
  for (const raw of stripAnsi(text).split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:\[[A-Za-z0-9 _-]+\]\s*)*\[(OK|FAIL)\]\s*(.*)$/);
    if (!m) continue;
    // lineas de resumen de otros ejecutores ("[PREPUSH][OK] ...") se cuentan igual; las de RESULTADO no llevan etiqueta
    checks.push({ ok: m[1] === "OK", name: m[2].trim() });
  }
  return checks;
}

function runSuite(suite) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const logFile = path.join(logDir, `${suite.id}.log`);
    const logStream = fs.createWriteStream(logFile);
    let buf = "";
    const child = spawn(process.execPath, suite.args, {
      cwd: ROOT, windowsHide: true,
      env: { ...process.env, TPV_RUN_BACKGROUND: "1", TPV_BATTERY: "1" },
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, suite.timeoutMs || 600000);
    const onData = (d) => { buf += d.toString("utf8"); logStream.write(d); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      clearTimeout(timer);
      logStream.end();
      const checks = parseChecks(buf);
      const fails = checks.filter((c) => !c.ok).length;
      let status = "ok", reason = "";
      if (suite.expectFail) {
        // Control negativo: debe haber comprobaciones correctas Y fallidas y un codigo de salida distinto de 0.
        const detected = !timedOut && code !== 0 && fails > 0 && checks.length > fails;
        resolve({ id: suite.id, area: suite.area, title: suite.title, what: suite.what, demo: false, noCheckList: false,
          status: detected ? "ok" : "fallo", reason: detected ? "" : "la batería NO detectó el fallo provocado (algo va mal con la propia batería)",
          exitCode: code, checks: checks.map((c) => ({ ok: true, name: (c.ok ? "" : "(fallo provocado, detectado) ") + c.name })), ok: checks.length, fail: detected ? 0 : fails,
          ms: Date.now() - t0, tail: tailOf(buf) });
        return;
      }
      if (timedOut) { status = "fallo"; reason = `tiempo agotado (${fmtDur(suite.timeoutMs)})`; }
      else if (code !== 0) { status = "fallo"; reason = `terminó con código ${code}`; }
      else if (!checks.length) { status = "fallo"; reason = "no emitió ninguna comprobación"; }
      else if (fails) { status = "fallo"; reason = `${fails} comprobación(es) fallida(s)`; }
      const tail = stripAnsi(buf).split(/\r?\n/).filter((l) => l.trim()).slice(-25).join("\n");
      resolve({ id: suite.id, area: suite.area, title: suite.title, what: suite.what, demo: !!suite.demo, noCheckList: !!suite.noCheckList,
        status, reason, exitCode: code, checks, ok: checks.length - fails, fail: fails, ms: Date.now() - t0, tail });
    });
  });
}

// ---------------------------------------------------------------- informe
const NOT_COVERED = [
  "Impresoras reales: se comprueba el contenido de los tickets, no el papel (solo se probó a mano la POS-80C).",
  "Cierre de caja real en un cliente real (la prueba cierra solo cajas de pruebas de la demo).",
  "Uso real en tienda con clientes, horas punta y redes lentas.",
  "Sin conexión a internet a lo largo de una jornada completa.",
  "Pruebas que solo imprimen datos para interpretarlos a mano (comanda, mover y fusionar mesas, cobro fallido…): aún no tienen veredicto automático y no entran en esta batería.",
];

function buildMarkdown(results, summary) {
  const L = [];
  L.push(`# Batería de pruebas del TPV Recipok`);
  L.push(`**Resultado: ${summary.verdict}** · versión ${meta.version} · commit ${meta.commit}${meta.dirty ? " (con cambios sin confirmar)" : ""} · rama ${meta.branch}`);
  L.push(`Fecha: ${new Date(meta.startedAt).toLocaleString("es-ES")} · duración ${fmtDur(summary.ms)} · nivel «${level}»`);
  L.push(`Comprobaciones: ${summary.ok} correctas, ${summary.fail} fallidas · pruebas: ${summary.suitesOk} correctas, ${summary.suitesFail} con fallos, ${summary.suitesSkipped} omitidas\n`);
  for (const area of AREAS) {
    const rs = results.filter((r) => r.area === area);
    if (!rs.length) continue;
    L.push(`## ${area}`);
    rs.forEach((r) => L.push(`- ${r.status === "ok" ? "✅" : r.status === "omitida" ? "⏭️" : "❌"} **${r.title}** — ${r.status === "omitida" ? "omitida: " + r.reason : `${r.ok}/${r.checks.length} comprobaciones, ${fmtDur(r.ms)}${r.reason ? " — " + r.reason : ""}`}`));
    L.push("");
  }
  if ((meta.cleanup || []).length) { L.push("## Limpieza de la demo"); meta.cleanup.forEach((t) => L.push(`- ${t}`)); L.push(""); }
  L.push("## Qué NO cubre esta batería");
  NOT_COVERED.forEach((t) => L.push(`- ${t}`));
  return L.join("\n");
}

function buildHtml(results, summary) {
  const verdictClass = summary.suitesFail ? "bad" : summary.suitesSkipped ? "warn" : "good";
  const areaBlocks = AREAS.map((area) => {
    const rs = results.filter((r) => r.area === area);
    if (!rs.length) return "";
    const aOk = rs.every((r) => r.status === "ok");
    const aSkip = rs.some((r) => r.status === "omitida");
    const cards = rs.map((r) => {
      const icon = r.status === "ok" ? "✓" : r.status === "omitida" ? "–" : "✗";
      const cls = r.status === "ok" ? "good" : r.status === "omitida" ? "warn" : "bad";
      const counts = r.status === "omitida" ? `Omitida: ${esc(r.reason)}` : `${r.ok} de ${r.checks.length} comprobaciones · ${fmtDur(r.ms)}${r.demo ? " · usa la demo" : ""}`;
      let detail = "";
      if (r.status !== "omitida") {
        const list = r.noCheckList ? r.checks.filter((c) => !c.ok) : r.checks;
        const items = list.map((c) => `<li class="${c.ok ? "ok" : "ko"}"><span>${c.ok ? "✓" : "✗"}</span> ${esc(c.name)}</li>`).join("");
        const note = r.noCheckList ? `<p class="muted">${r.ok} comprobaciones correctas${r.fail ? "; se listan las fallidas" : " (no se listan una a una)"}.</p>` : "";
        const fail = r.status === "fallo" ? `<p class="reason">${esc(r.reason)}</p><pre>${esc(r.tail)}</pre>` : "";
        detail = `<details${r.status === "fallo" ? " open" : ""}><summary>Ver detalle</summary>${note}<ul class="checks">${items}</ul>${fail}</details>`;
      }
      return `<div class="card ${cls}"><div class="card-h"><span class="badge ${cls}">${icon}</span><div><h3>${esc(r.title)}</h3><p class="what">${esc(r.what)}</p><p class="counts">${counts}</p></div></div>${detail}</div>`;
    }).join("");
    return `<section><h2><span class="badge ${aOk ? "good" : aSkip && !rs.some((r) => r.status === "fallo") ? "warn" : "bad"}">${aOk ? "✓" : aSkip && !rs.some((r) => r.status === "fallo") ? "–" : "✗"}</span>${esc(area)}</h2>${cards}</section>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Batería de pruebas del TPV Recipok</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1c2430;--muted:#667085;--line:#e3e7ee;--good:#1a7f4b;--goodbg:#e7f6ee;--bad:#c0362c;--badbg:#fdeceb;--warn:#a96a00;--warnbg:#fff4de}
@media (prefers-color-scheme:dark){:root{--bg:#12161c;--card:#1a2029;--ink:#e8edf4;--muted:#9aa6b6;--line:#2a3340;--good:#4cc38a;--goodbg:#15271f;--bad:#ff7b72;--badbg:#2c1a19;--warn:#f2b441;--warnbg:#2b2312}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:28px 16px 60px}
h1{font-size:26px;margin:0 0 6px}h2{font-size:19px;margin:34px 0 12px;display:flex;align-items:center;gap:10px}h3{font-size:16px;margin:0 0 2px}
.hero{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin:16px 0 8px}
.verdict{font-size:30px;font-weight:700;margin:4px 0}.verdict.good{color:var(--good)}.verdict.bad{color:var(--bad)}.verdict.warn{color:var(--warn)}
.meta{color:var(--muted);font-size:13px}.stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}
.stat{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 14px}.stat b{display:block;font-size:20px}
.card{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--line);border-radius:10px;padding:14px 16px;margin:10px 0}
.card.good{border-left-color:var(--good)}.card.bad{border-left-color:var(--bad)}.card.warn{border-left-color:var(--warn)}
.card-h{display:flex;gap:12px;align-items:flex-start}.what{margin:2px 0;color:var(--muted)}.counts{margin:2px 0;font-size:13px;font-weight:600}
.badge{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;font-weight:700;font-size:14px;flex:none}
.badge.good{background:var(--goodbg);color:var(--good)}.badge.bad{background:var(--badbg);color:var(--bad)}.badge.warn{background:var(--warnbg);color:var(--warn)}
details{margin-top:8px}summary{cursor:pointer;color:var(--muted);font-size:13px}
ul.checks{list-style:none;padding:0;margin:8px 0 0}ul.checks li{padding:3px 0;font-size:13.5px;display:flex;gap:8px}li.ok span{color:var(--good)}li.ko span{color:var(--bad)}li.ko{color:var(--bad)}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;font-size:12px;max-height:260px}
.reason{color:var(--bad);font-weight:600}.muted{color:var(--muted);font-size:13px}
.notcov{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px 20px}.notcov li{margin:6px 0}
footer{margin-top:30px;color:var(--muted);font-size:12.5px}
</style></head><body><main>
<h1>Batería de pruebas del TPV Recipok</h1>
<div class="hero">
  <div class="verdict ${verdictClass}">${esc(summary.verdict)}</div>
  <div class="meta">Versión <b>${esc(meta.version)}</b> · commit <b>${esc(meta.commit)}</b>${meta.dirty ? " (con cambios sin confirmar)" : ""} · rama ${esc(meta.branch)} · ${esc(new Date(meta.startedAt).toLocaleString("es-ES"))} · duración ${esc(fmtDur(summary.ms))} · nivel «${esc(level)}»</div>
  <div class="stats">
    <div class="stat"><b>${summary.ok}</b>comprobaciones correctas</div>
    <div class="stat"><b>${summary.fail}</b>comprobaciones fallidas</div>
    <div class="stat"><b>${summary.suitesOk}/${results.length}</b>pruebas superadas</div>
    <div class="stat"><b>${summary.suitesSkipped}</b>omitidas</div>
  </div>
</div>
${areaBlocks}
${(meta.cleanup || []).length ? `<h2>Limpieza de la demo</h2><ul class="notcov">${meta.cleanup.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
<h2>Qué NO cubre esta batería</h2>
<ul class="notcov">${NOT_COVERED.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
<footer>Generado por tools/tests/battery/run-battery.js · ${esc(meta.machine)}. Las pruebas con la demo abren TPV reales y dejan datos de prueba (facturas «[PRUEBA…]») que no afectan a ningún cliente.</footer>
</main></body></html>`;
}

// ---------------------------------------------------------------- ejecucion
(async () => {
  const t0 = Date.now();
  console.log(`\n=== BATERÍA DE PRUEBAS · nivel ${level} · ${selected.length} pruebas · versión ${meta.version} (${meta.commit}${meta.dirty ? ", con cambios" : ""}) ===\n`);
  const needsDemo = selected.some((s) => s.demo);
  const demoProblems = needsDemo ? await demoPrereqs() : [];
  if (demoProblems.length) console.log("Aviso: las pruebas con la demo se omitirán:\n  - " + demoProblems.join("\n  - ") + "\n");

  const results = [];
  const cleanupNotes = [];
  if (needsDemo && !demoProblems.length) { cleanupNotes.push(cleanupDemo("antes")); console.log(cleanupNotes[0] + String.fromCharCode(10)); }
  for (const [i, suite] of selected.entries()) {
    process.stdout.write(`[${i + 1}/${selected.length}] ${suite.title} ... `);
    if (suite.demo && demoProblems.length) {
      results.push({ id: suite.id, area: suite.area, title: suite.title, what: suite.what, demo: true, status: "omitida", reason: demoProblems.join("; "), checks: [], ok: 0, fail: 0, ms: 0, tail: "" });
      console.log("OMITIDA");
      continue;
    }
    const r = await runSuite(suite);
    results.push(r);
    console.log(`${r.status === "ok" ? "OK" : "FALLO"} (${r.ok}/${r.checks.length}, ${fmtDur(r.ms)})${r.reason ? " — " + r.reason : ""}`);
    if (suite.demo) await sleep(3000);
  }

  if (needsDemo && !demoProblems.length) { cleanupNotes.push(cleanupDemo("después")); console.log(String.fromCharCode(10) + cleanupNotes[1]); }
  meta.cleanup = cleanupNotes;
  const summary = {
    ms: Date.now() - t0,
    ok: results.reduce((a, r) => a + r.ok, 0),
    fail: results.reduce((a, r) => a + r.fail, 0),
    suitesOk: results.filter((r) => r.status === "ok").length,
    suitesFail: results.filter((r) => r.status === "fallo").length,
    suitesSkipped: results.filter((r) => r.status === "omitida").length,
  };
  summary.verdict = summary.suitesFail ? `CON FALLOS (${summary.suitesFail} prueba${summary.suitesFail > 1 ? "s" : ""})` : summary.suitesSkipped ? "APROBADA — con pruebas omitidas" : "APROBADA";

  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ meta, summary, results: results.map(({ tail, ...r }) => r) }, null, 2));
  fs.writeFileSync(path.join(outDir, "report.md"), buildMarkdown(results, summary));
  const html = buildHtml(results, summary);
  fs.writeFileSync(path.join(outDir, "report.html"), html);
  try { fs.writeFileSync(path.join(path.dirname(outDir), "latest.html"), html); } catch {}

  console.log(`\n=== ${summary.verdict} · ${summary.ok} comprobaciones correctas, ${summary.fail} fallidas · ${fmtDur(summary.ms)} ===`);
  console.log(`Informe: ${path.join(outDir, "report.html")}\n`);
  process.exit(summary.suitesFail ? 1 : 0);
})();
