const { spawnSync } = require("child_process");
const path = require("path");

function runStep(label, args) {
  console.log(`\n[PREPUSH] ${label}`);
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  if (result.error) {
    console.error(`[PREPUSH][ERROR] ${label}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\n[PREPUSH][FAIL] ${label}`);
    process.exit(result.status || 1);
  }

  console.log(`[PREPUSH][OK] ${label}`);
}

runStep("Quick tests", [path.join("tools", "tests", "run-quick-tests.js")]);
runStep("Smoke tests", [path.join("tools", "tests", "run-smoke-tests.js")]);

if (String(process.env.TPV_PREPUSH_E2E || "1") !== "0") {
  runStep("E2E Mesas slug-demo checks", [
    path.join("tools", "tests", "run-e2e-mesas-mode.js"),
  ]);

  if (String(process.env.TPV_PREPUSH_FULL_E2E || "0") === "1") {
    runStep("E2E full smoke (optional)", [
      path.join("tools", "tests", "run-e2e-smoke.js"),
    ]);
  }
} else {
  console.log("\n[PREPUSH] E2E smoke tests skipped (TPV_PREPUSH_E2E=0)");
}

console.log("\n[PREPUSH] All checks passed.");
