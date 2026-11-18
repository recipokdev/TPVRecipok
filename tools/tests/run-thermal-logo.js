// Logo en blanco y negro puro para termicas (thermalizeLogoFromUrl / getCompanyLogoForThermal). TPV real en perfil aislado y SIN
// red: las imagenes se generan en la propia prueba (caligrafia marron como la de Los Argentinos, una foto, un PNG transparente).
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
  const userData = path.join(os.tmpdir(), `tpvrecipok-thermallogo-${Date.now()}`);
  const env = {
    ...process.env, TPV_E2E: "1", TPV_MODE: "demo", TPV_E2E_BACKGROUND: "1", TPV_E2E_REQUIRE_ONLINE: "0",
    TPV_E2E_ALLOW_WRITES: "0", TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3", TPV_E2E_API_KEY: "", TPV_E2E_USER_DATA: userData,
  };
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  const kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 120000);
  try {
    let win = null;
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 40000) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => typeof thermalizeLogoFromUrl === "function")) { win = w; break; } } catch {} }
      if (!win) await sleep(250);
    }
    if (!win) throw new Error("no se encontro la ventana del TPV");
    await sleep(1500);

    // utilidades en la pagina: crear imagenes de prueba y analizar un PNG de salida
    const injectHelpers = () => win.evaluate(() => {
      if (window.__mk) return;
      window.__mk = {
        script: () => { const c = document.createElement("canvas"); c.width = 480; c.height = 300; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 480, 300); g.fillStyle = "#7a4a2b"; g.font = "italic bold 86px cursive, serif"; g.textAlign = "center"; g.fillText("Los", 240, 120); g.fillText("Argentinos", 240, 220); g.fillStyle = "#f2b01e"; g.beginPath(); g.arc(130, 262, 6, 0, 7); g.fill(); return c.toDataURL("image/jpeg", 0.9); },
        photo: () => { const c = document.createElement("canvas"); c.width = 400; c.height = 300; const g = c.getContext("2d"); const gr = g.createLinearGradient(0, 0, 400, 300); gr.addColorStop(0, "#222"); gr.addColorStop(0.5, "#999"); gr.addColorStop(1, "#ddd"); g.fillStyle = gr; g.fillRect(0, 0, 400, 300); for (let i = 0; i < 6000; i++) { g.fillStyle = `rgb(${(Math.random() * 255) | 0},${(Math.random() * 255) | 0},${(Math.random() * 255) | 0})`; g.fillRect(Math.random() * 400, Math.random() * 300, 3, 3); } return c.toDataURL("image/png"); },
        transparent: () => { const c = document.createElement("canvas"); c.width = 300; c.height = 300; const g = c.getContext("2d"); g.fillStyle = "#333"; g.beginPath(); g.arc(150, 150, 110, 0, 7); g.fill(); return c.toDataURL("image/png"); },
      };
      window.__analyze = (url) => new Promise((res) => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext("2d"); g.drawImage(i, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let black = 0, white = 0, other = 0; for (let p = 0; p < d.length; p += 4) { const v = d[p]; if (d[p] === d[p + 1] && d[p] === d[p + 2]) { if (v === 0) black++; else if (v === 255) white++; else other++; } else other++; } res({ w: c.width, h: c.height, black, white, other, corner: d[0] }); }; i.onerror = () => res({ w: 0, h: 0, black: 0, white: 0, other: 1, corner: -1 }); i.src = url; });
    });
    await injectHelpers();
    // La pagina del TPV puede recargarse sola sin red: se reinyectan las utilidades y se reintenta.
    const ev = async (fn, arg) => {
      for (let i = 0; i < 4; i++) {
        try {
          await injectHelpers();
          return await win.evaluate(fn, arg);
        } catch (e) {
          if (!/context was destroyed|navigation|Target closed/i.test(String(e && e.message))) throw e;
          await sleep(2500);
        }
      }
      throw new Error("la pagina se recargo demasiadas veces");
    };

    // 1) caligrafia marron (como el logo de Los Argentinos)
    let r = await ev(async () => { const u = window.__mk.script(); const r = await thermalizeLogoFromUrl(u, 384, 240); return { reason: r.reason, thr: r.threshold, url: r.dataUrl }; });
    check("Caligrafia marron sobre blanco: se convierte (no se toma por foto)", r.reason === "ok" && r.url.startsWith("data:image/png"), r.reason);
    let a = await ev((u) => window.__analyze(u), r.url);
    check("La salida mide exactamente el tamano de impresion pedido (384x240)", a.w === 384 && a.h === 240, `${a.w}x${a.h}`);
    check("La salida es SOLO negro y blanco puros (ni un gris)", a.other === 0 && a.black > 0 && a.white > 0, JSON.stringify(a));
    check("Hay tinta suficiente (trazos visibles) y no se ha puesto todo negro", a.black > 1500 && a.black < a.w * a.h * 0.6, `negros=${a.black}`);

    // 2) foto -> se deja tal cual
    r = await ev(async () => { const r = await thermalizeLogoFromUrl(window.__mk.photo(), 300, 225); return { reason: r.reason, url: r.dataUrl }; });
    check("Una foto/degradado NO se convierte (se imprime el original)", r.reason === "parece-foto" && r.url === "", r.reason);

    // 3) PNG transparente oscuro: la transparencia cuenta como blanco
    r = await ev(async () => { const r = await thermalizeLogoFromUrl(window.__mk.transparent(), 240, 240); return { reason: r.reason, url: r.dataUrl }; });
    a = await ev((u) => window.__analyze(u), r.url);
    check("PNG transparente: lo transparente sale BLANCO (no negro) y el dibujo negro", r.reason === "ok" && a.corner === 255 && a.black > 20000 && a.other === 0, JSON.stringify(a));

    // 4) getCompanyLogoForThermal: tamano segun el hueco de la plantilla y respeto del interruptor
    const url = await ev(() => window.__mk.script());
    const g1 = await ev(async (u) => { companyLogoUrl = u; companyLogoAspectRatio = null; __thermalLogoCache = { key: "", out: "" }; await window.TPV_CFG.set("ui.thermalLogoBw", true); return await getCompanyLogoForThermal(30); }, url);
    a = await ev((u) => window.__analyze(u), g1);
    check("Con el interruptor activado devuelve el logo en blanco y negro, de 48 mm a 8 puntos/mm (384x240)", g1.startsWith("data:image/png") && a.w === 384 && a.h === 240 && a.other === 0, `${a.w}x${a.h}`);
    const g2 = await ev(async (u) => { await window.TPV_CFG.set("ui.thermalLogoBw", false); return (await getCompanyLogoForThermal(30)) === u; }, url);
    check("Con el interruptor DESACTIVADO devuelve el logo original sin tocar", g2 === true);
    const g3 = await ev(async () => { await window.TPV_CFG.set("ui.thermalLogoBw", true); companyLogoUrl = "data:image/png;base64,AAAA"; companyLogoAspectRatio = null; __thermalLogoCache = { key: "", out: "" }; return (await getCompanyLogoForThermal(30)) === "data:image/png;base64,AAAA"; });
    check("Si la imagen no se puede leer, no falla: usa el original", g3 === true);
    const tog = await ev(() => { const el = document.getElementById("thermalLogoToggle"); return el ? el.checked : null; });
    check("En Opciones -> Impresora existe el interruptor «Logo en blanco y negro nítido»", tog !== null);
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
