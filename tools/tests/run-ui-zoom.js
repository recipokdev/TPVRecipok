// Escala de la interfaz: el ajuste manual llega hasta 150% (antes el tope era 100%) y Opciones muestra la pantalla detectada.
// TPV real en perfil aislado y SIN red (no toca la demo ni ningun servidor).
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
  const userData = path.join(os.tmpdir(), `tpvrecipok-uizoom-${Date.now()}`);
  const env = {
    ...process.env, TPV_E2E: "1", TPV_MODE: "demo", TPV_E2E_BACKGROUND: "1", TPV_E2E_REQUIRE_ONLINE: "0",
    TPV_E2E_ALLOW_WRITES: "0", TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3", TPV_E2E_API_KEY: "", TPV_E2E_USER_DATA: userData,
  };
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const pid = app.process().pid;
  const kill = () => { try { require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };
  const hard = setTimeout(() => { console.log("HARD TIMEOUT"); kill(); process.exit(1); }, 120000);
  const zoomNow = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes("index.html"));
    return w ? w.webContents.getZoomFactor() : -1;
  });
  try {
    let win = null;
    const t0 = Date.now();
    while (!win && Date.now() - t0 < 40000) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => !!document.getElementById("uiZoomSelect"))) { win = w; break; } } catch {} }
      if (!win) await sleep(250);
    }
    if (!win) throw new Error("no se encontro la ventana del TPV");
    await win.waitForFunction(() => !!window.TPV_UI_MODE && !!window.TPV_CFG, null, { timeout: 30000 });
    await sleep(1500);

    const opts = await win.evaluate(() => [...document.querySelectorAll("#uiZoomSelect option")].map((o) => o.value));
    check("El selector ofrece 150%, 125% y 110% ademas de 100% y menos", ["auto", "1.5", "1.25", "1.1", "1", "0.9", "0.8", "0.7"].every((v) => opts.includes(v)), JSON.stringify(opts));

    const info = await win.evaluate(() => window.TPV_UI_MODE.getZoomInfo());
    check("getZoomInfo devuelve la resolucion detectada y las escalas", info && info.width > 0 && info.height > 0 && typeof info.effectiveZoom === "number", JSON.stringify(info));
    check("Sin ajuste manual, el automatico nunca pasa del 100%", info.effectiveZoom <= 1 && info.autoZoom <= 1, JSON.stringify(info));
    const txt = await win.evaluate(() => document.getElementById("uiZoomInfo").textContent);
    check("Opciones muestra la pantalla detectada y la escala aplicada", /Pantalla detectada: \d+x\d+ · escala aplicada: \d+%/.test(txt), txt);

    for (const z of [1.25, 1.5, 1.1]) {
      await win.evaluate((v) => window.TPV_CFG.set("uiZoomOverride", v), z);
      const i2 = await win.evaluate(() => window.TPV_UI_MODE.getZoomInfo());
      check(`Ajuste manual ${Math.round(z * 100)}% se respeta (no se recorta al 100%)`, Math.abs(i2.effectiveZoom - z) < 0.001, JSON.stringify(i2));
    }
    await win.evaluate((v) => window.TPV_CFG.set("uiZoomOverride", v), 3);
    const i3 = await win.evaluate(() => window.TPV_UI_MODE.getZoomInfo());
    check("Un valor absurdo (300%) se recorta al tope de 150%", Math.abs(i3.effectiveZoom - 1.5) < 0.001, JSON.stringify(i3));

    // al recargar, la ventana arranca con el zoom guardado
    const ZR = Number(process.env.UIZOOM_Z || 1.25);
    await win.evaluate((v) => window.TPV_CFG.set("uiZoomOverride", v), ZR);
    await win.evaluate(() => location.reload());
    await sleep(4000);
    const z = await zoomNow();
    check(`Tras recargar, la ventana aplica el zoom manual de ${Math.round(ZR * 100)}%`, Math.abs(z - ZR) < 0.001, String(z));

    if (process.env.UIZOOM_SHOT) {
      // captura real de la ventana (con el zoom aplicado), no la de Playwright, que no refleja el zoom de Electron
      const b64 = await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes("index.html"));
        const img = await w.webContents.capturePage();
        return img.toPNG().toString("base64");
      });
      fs.writeFileSync(process.env.UIZOOM_SHOT, Buffer.from(b64, "base64"));
    }
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
