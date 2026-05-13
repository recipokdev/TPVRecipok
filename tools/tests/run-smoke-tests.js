const fs = require("fs");
const path = require("path");

const root = process.cwd();

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`[OK] ${msg}`);
}

function mustContain(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    fail(`${label} (missing: ${needle})`);
    return;
  }
  ok(label);
}

function ensureFileExists(relPath) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    fail(`Missing file: ${relPath}`);
    return null;
  }
  ok(`File exists: ${relPath}`);
  return abs;
}

const rendererPath = ensureFileExists("renderer.js");
const indexPath = ensureFileExists("index.html");
const stylesPath = ensureFileExists("styles.css");
const checklistPath = ensureFileExists("tools/tests/cash-smoke-checklist.md");

if (!rendererPath || !indexPath || !stylesPath || !checklistPath) {
  process.exit(1);
}

const renderer = fs.readFileSync(rendererPath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");

console.log("\n[SMOKE] Checking key flows in renderer.js\n");

mustContain(
  renderer,
  "function hasCompanyResolved()",
  "Company guard function present",
);
mustContain(
  renderer,
  "async function openLoginModal()",
  "Login modal flow present",
);
mustContain(
  renderer,
  "async function forceReconnectFlow()",
  "Company/email reconnect flow present",
);
mustContain(
  renderer,
  "async function refreshAllData()",
  "Refresh-all flow present",
);
mustContain(
  renderer,
  "async function handleCashHeaderAction",
  "Cash header action flow present",
);
mustContain(
  renderer,
  "async function confirmCashOpening()",
  "Cash opening flow present",
);
mustContain(
  renderer,
  "async function confirmCashClosing()",
  "Cash closing flow present",
);
mustContain(
  renderer,
  "let __cashHeaderActionInFlight = false;",
  "Cash action race guard present",
);
mustContain(
  renderer,
  "async function warmupPacksData(opts = {})",
  "Packs warmup flow present",
);
mustContain(
  renderer,
  "async function getApiResourcesSet(opts = {})",
  "API resources discovery present",
);
mustContain(
  renderer,
  "async function canCallApiResource(resourceName, opts = {})",
  "Generic API resource precheck present",
);
mustContain(
  renderer,
  "const createTablesBtn = () =>",
  "Mesas mode button wiring present",
);
mustContain(
  renderer,
  "function getMesaQuickStatusMeta(state, uid)",
  "Mesas quick-switch status helper present",
);
mustContain(
  renderer,
  "mesasContextQuickSwitch",
  "Mesas quick-switch renderer wiring present",
);

console.log("\n[SMOKE] Checking Mesas quick-switch UI presence\n");

mustContain(
  index,
  'id="mesasContextQuickSwitch"',
  "Mesas quick-switch container in index.html",
);
mustContain(
  styles,
  ".mesas-context-quick-switch",
  "Mesas quick-switch styles present",
);
mustContain(
  styles,
  ".mesas-quick-btn.is-parked .mq-dot",
  "Mesas quick-switch parked status color present",
);

console.log("\n[SMOKE] Checking manual checklist presence\n");

const checklist = fs.readFileSync(checklistPath, "utf8");
mustContain(checklist, "Cash Smoke Checklist", "Cash checklist title present");
mustContain(checklist, "Open cash", "Cash open steps documented");
mustContain(checklist, "Close cash", "Cash close steps documented");
mustContain(checklist, "Refresh", "Refresh behavior steps documented");
mustContain(
  checklist,
  "Cart and Payment Actions",
  "Payment flow checklist documented",
);
mustContain(checklist, "Tickets Modal", "Tickets modal checklist documented");
mustContain(checklist, "Parked Tickets", "Parked flow checklist documented");

if (process.exitCode) {
  console.error("\nSmoke tests failed.");
  process.exit(1);
}

console.log("\nSmoke tests passed.");
