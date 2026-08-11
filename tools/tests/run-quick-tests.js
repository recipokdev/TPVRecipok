const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = process.cwd();

const filesToCheck = [
  "main.js",
  "preload.js",
  "renderer.js",
  "customer.js",
  "customer_preload.js",
  "js/tpv/bootstrap.js",
  "js/tpv/cajas.js",
  "js/tpv/config.js",
  "js/tpv/fsApi.js",
  "js/tpv/lockClient.js",
  "js/tpv/quit-shortcut.js",
  "js/tpv/scale/scale-cart.js",
  "js/tpv/scale/scale-manager.js",
  "js/tpv/scale/scale-parser.js",
  "js/tpv/scale/scale-ui.js",
  "js/tpv/ui/selector.js",
  "js/tpv/ui/customer_selector/customer_selector.js",
  "mesas/mesas.js",
];

const missing = filesToCheck.filter(
  (rel) => !fs.existsSync(path.join(root, rel)),
);
if (missing.length) {
  console.error("Missing files in quick tests:");
  missing.forEach((f) => console.error(` - ${f}`));
  process.exit(1);
}

let hasErrors = false;

for (const rel of filesToCheck) {
  const filePath = path.join(root, rel);
  const result = spawnSync(process.execPath, ["--check", filePath], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    hasErrors = true;
    console.error(`\n[FAIL] Syntax check: ${rel}`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } else {
    console.log(`[OK] ${rel}`);
  }
}

if (hasErrors) {
  console.error("\nQuick tests failed.");
  process.exit(1);
}

console.log("\nQuick tests passed.");
