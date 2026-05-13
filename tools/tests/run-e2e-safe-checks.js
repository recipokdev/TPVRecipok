const path = require("path");
const os = require("os");
const fs = require("fs");
const { _electron: electron } = require("playwright");

function ok(msg) {
  console.log(`[E2E-SAFE][OK] ${msg}`);
}

function fail(msg) {
  console.error(`[E2E-SAFE][FAIL] ${msg}`);
  process.exit(1);
}

function makeUserDataPath() {
  return path.join(
    os.tmpdir(),
    `tpvrecipok-e2e-safe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

function buildSafeEnv(extra = {}) {
  return {
    ...process.env,
    TPV_E2E: "1",
    TPV_MODE: "demo",
    TPV_E2E_BACKGROUND: process.env.TPV_E2E_BACKGROUND || "1",
    TPV_E2E_REQUIRE_ONLINE: "0",
    TPV_E2E_ALLOW_WRITES: "0",
    TPV_E2E_BASE_URL:
      process.env.TPV_E2E_BASE_URL || "https://127.0.0.1:9/demo/api/3",
    TPV_E2E_API_KEY: process.env.TPV_E2E_API_KEY || "",
    ...extra,
  };
}

async function findMainWindow(app) {
  const timeoutMs = 30000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const wins = app.windows();
    for (const w of wins) {
      try {
        await w.waitForLoadState("domcontentloaded", { timeout: 5000 });
        const hasRoot = await w.evaluate(
          () => !!document.getElementById("cashHeaderBtn"),
        );
        if (hasRoot) return w;
      } catch {
        // Keep scanning windows until timeout.
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  return null;
}

async function isHidden(win, id) {
  return await win.evaluate((targetId) => {
    const el = document.getElementById(targetId);
    if (!el) return null;
    return el.classList.contains("hidden");
  }, id);
}

async function ensureVisible(win, selector, label) {
  const el = await win.waitForSelector(selector, { timeout: 12000 });
  if (!el) fail(`${label} missing (${selector})`);
  ok(`${label} visible`);
}

async function attachDiagnostics(win) {
  const diagnostics = {
    consoleErrors: [],
    pageErrors: [],
  };

  win.on("console", (msg) => {
    const type = String(msg.type() || "");
    if (type === "error")
      diagnostics.consoleErrors.push(String(msg.text() || ""));
  });

  win.on("pageerror", (err) => {
    diagnostics.pageErrors.push(
      String(err && err.message ? err.message : err || ""),
    );
  });

  await win.evaluate(() => {
    window.__E2E_TOASTS__ = window.__E2E_TOASTS__ || [];
    if (window.__E2E_TOAST_HOOK_INSTALLED__) return;

    const originalToast = window.toast;
    if (typeof originalToast !== "function") return;

    window.toast = function patchedToast(message, type = "info", title = "") {
      try {
        window.__E2E_TOASTS__.push({
          at: Date.now(),
          message: String(message || ""),
          type: String(type || ""),
          title: String(title || ""),
        });
      } catch {}
      return originalToast.apply(this, arguments);
    };

    window.__E2E_TOAST_HOOK_INSTALLED__ = true;
  });

  return diagnostics;
}

function isIgnorableConsoleError(msg) {
  const text = String(msg || "");
  return (
    text.includes("Failed to load resource") ||
    text.includes("ERR_CONNECTION_REFUSED") ||
    text.includes("ERR_FAILED") ||
    text.includes("status of 401") ||
    text.includes("status of 404")
  );
}

async function assertNoCriticalDiagnostics(win, diagnostics) {
  const toasts = await win.evaluate(() =>
    Array.isArray(window.__E2E_TOASTS__) ? window.__E2E_TOASTS__ : [],
  );

  const hardErrorToasts = (Array.isArray(toasts) ? toasts : []).filter((t) => {
    const type = String(t && t.type ? t.type : "").toLowerCase();
    if (type === "err" || type === "error") return true;
    return false;
  });

  if (hardErrorToasts.length) {
    const sample = hardErrorToasts
      .slice(0, 3)
      .map((t) => `${t.title ? `${t.title}: ` : ""}${t.message}`)
      .join(" | ");
    fail(`error toasts detected: ${sample}`);
  }

  if (Array.isArray(diagnostics.pageErrors) && diagnostics.pageErrors.length) {
    fail(
      `page errors detected: ${diagnostics.pageErrors.slice(0, 2).join(" | ")}`,
    );
  }

  const criticalConsole = (
    Array.isArray(diagnostics.consoleErrors) ? diagnostics.consoleErrors : []
  ).filter((msg) => !isIgnorableConsoleError(msg));

  if (criticalConsole.length) {
    fail(`console errors detected: ${criticalConsole.slice(0, 2).join(" | ")}`);
  }

  ok("no critical diagnostics detected");
}

async function run() {
  const root = path.resolve(__dirname, "..", "..");
  const userDataPath = makeUserDataPath();

  const app = await electron.launch({
    args: [path.join(root, ".")],
    cwd: root,
    env: buildSafeEnv({ TPV_E2E_USER_DATA: userDataPath }),
  });

  try {
    const win = await findMainWindow(app);
    if (!win) fail("main window not found");

    const diagnostics = await attachDiagnostics(win);

    await win.waitForFunction(
      () => {
        const src = String(window.__TPV_E2E_BOOT_SOURCE__ || "");
        const err = String(window.__TPV_E2E_BOOT_ERROR__ || "");
        return src !== "booting" || !!err;
      },
      { timeout: 30000 },
    );

    const bootState = await win.evaluate(() => ({
      e2e: !!window.TPV_ENV && !!window.TPV_ENV.e2e,
      mode: String((window.TPV_ENV && window.TPV_ENV.mode) || ""),
      bodyFlag: String(
        (document.body &&
          document.body.dataset &&
          document.body.dataset.e2eMode) ||
          "",
      ),
      source: String(window.__TPV_E2E_BOOT_SOURCE__ || ""),
      bootError: String(window.__TPV_E2E_BOOT_ERROR__ || ""),
      allowWrites: !!window.TPV_ENV && !!window.TPV_ENV.e2eAllowWrites,
    }));

    if (!bootState.e2e) fail("TPV_ENV.e2e disabled");
    if (bootState.mode !== "demo") fail(`unexpected mode '${bootState.mode}'`);
    if (bootState.bodyFlag !== "1") fail("data-e2e-mode marker missing");
    if (bootState.allowWrites) fail("safe checks require writes disabled");
    if (bootState.bootError) fail(`boot error: ${bootState.bootError}`);

    ok(`booted in safe mode (source: ${bootState.source || "unknown"})`);

    await ensureVisible(win, "#optionsBtn", "options button");
    await ensureVisible(win, "#payBtn", "pay button");
    await ensureVisible(win, "#parkBtn", "park button");
    await ensureVisible(win, "#parkedListBtn", "parked list button");
    await ensureVisible(win, "#parkedSplitBtn", "split button");
    await ensureVisible(win, "#parkedComandaBtn", "comanda button");

    await win.click("#optionsBtn");
    await win.waitForSelector("#optionsOverlay:not(.hidden)", {
      timeout: 10000,
    });
    ok("options overlay opens");

    await ensureVisible(
      win,
      "#optionsChangeComandaPrinterBtn",
      "change comanda printer button",
    );
    await ensureVisible(
      win,
      "#optionsTestComandaPrinterBtn",
      "test comanda printer button",
    );
    await ensureVisible(win, "#autoComandaOnSaveToggle", "auto comanda toggle");
    await ensureVisible(
      win,
      "#mesasComandaFamilySelect",
      "comanda family select",
    );
    await ensureVisible(
      win,
      "#mesasComandaFamilyAddBtn",
      "comanda family add button",
    );

    const optionsHiddenBeforeClose = await isHidden(win, "optionsOverlay");
    if (optionsHiddenBeforeClose !== false)
      fail("options overlay should be open");

    await win.click("#optionsCloseBtn");
    await win.waitForSelector("#optionsOverlay.hidden", { timeout: 10000 });
    ok("options overlay closes");

    const mesasToggleCount = await win
      .locator("#mainAgentBar .agent-tables-btn")
      .count();
    if (mesasToggleCount > 0) {
      await win.click("#mainAgentBar .agent-tables-btn");
      await win.waitForTimeout(300);

      const mesasOpen = await win.evaluate(() => {
        const row = document.getElementById("mesasInlineTabsRow");
        return !!row && !row.classList.contains("hidden");
      });

      if (!mesasOpen) fail("mesas inline row did not open");
      ok("mesas mode opens");

      await win.click("#mainAgentBar .agent-tables-btn");
      await win.waitForTimeout(250);
      ok("mesas mode closes");
    } else {
      ok("mesas toggle not present in this build, checks skipped");
    }

    await assertNoCriticalDiagnostics(win, diagnostics);
    ok("safe E2E checklist passed");
  } finally {
    await app.close();
    try {
      fs.rmSync(userDataPath, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup errors.
    }
  }
}

run().catch((err) => {
  const msg = String(
    (err && err.stack) || (err && err.message) || err || "unknown error",
  );
  fail(msg);
});
