// Genera el PDF de la guia rapida «Si el TPV no arranca o da error» (para darsela a los clientes).
//   node tools/manual/build-guia-arranque.js
// Origen: docs/guias/si-el-tpv-no-arranca.html  ->  docs/guias/pdf/Guia-TPV-si-no-arranca.pdf (la carpeta pdf/ no se versiona)
const fs = require("fs");
const path = require("path");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "docs", "guias", "si-el-tpv-no-arranca.html");
const OUT = path.join(ROOT, "docs", "guias", "pdf");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, "pdf-main.js")] });
  try {
    const b64 = await app.evaluate(async ({ BrowserWindow }, { src }) => {
      const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
      await win.loadFile(src);
      await new Promise((r) => setTimeout(r, 600));
      const buf = await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
      win.destroy();
      return buf.toString("base64");
    }, { src: SRC });
    let name = "Guia-TPV-si-no-arranca.pdf";
    try {
      fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, "base64"));
    } catch (e) {
      if (e.code !== "EBUSY") throw e;
      name = "Guia-TPV-si-no-arranca-nuevo.pdf"; // el PDF esta abierto en un visor
      fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, "base64"));
    }
    console.log("OK", name);
  } finally {
    try {
      require("child_process").execSync(`taskkill /PID ${app.process().pid} /T /F`, { stdio: "ignore" });
    } catch {}
  }
  process.exit(0);
})().catch((e) => {
  console.error("ERROR", e);
  process.exit(1);
});
