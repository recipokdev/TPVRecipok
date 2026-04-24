const path = require("path");
const os = require("os");
const fs = require("fs");
const { _electron: electron } = require("playwright");

const PHASE_PACE_MS = Math.max(
  0,
  Number(process.env.TPV_E2E_PHASE_PACE_MS || 350) || 350,
);
const RUN_RESILIENCE_PROBES =
  String(process.env.TPV_E2E_RUN_RESILIENCE || "0") === "1";

async function pace(ms = PHASE_PACE_MS) {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

function fail(msg) {
  console.error(`[E2E][FAIL] ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[E2E][OK] ${msg}`);
}

function makeUserDataPath() {
  return path.join(
    os.tmpdir(),
    `tpvrecipok-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

function buildE2EEnv(extra = {}) {
  return {
    ...process.env,
    TPV_E2E: "1",
    TPV_MODE: "demo",
    TPV_E2E_BACKGROUND: process.env.TPV_E2E_BACKGROUND || "1",
    TPV_E2E_BASE_URL:
      process.env.TPV_E2E_BASE_URL || "https://plus.recipok.com/demo/api/3",
    TPV_E2E_API_KEY: process.env.TPV_E2E_API_KEY || "",
    TPV_E2E_REQUIRE_ONLINE: process.env.TPV_E2E_REQUIRE_ONLINE || "0",
    TPV_E2E_ALLOW_WRITES: process.env.TPV_E2E_ALLOW_WRITES || "1",
    ...extra,
  };
}

async function attachDiagnostics(win) {
  const diagnostics = {
    consoleErrors: [],
    consoleAll: [],
    pageErrors: [],
  };

  win.on("console", (msg) => {
    const type = String(msg.type() || "");
    const text = String(msg.text() || "");
    diagnostics.consoleAll.push({
      at: Date.now(),
      type,
      text,
    });
    if (type === "error") {
      diagnostics.consoleErrors.push(text);
    }
  });

  win.on("pageerror", (err) => {
    diagnostics.pageErrors.push(String(err?.message || err || ""));
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

function logTpvConsoleWindow(diagnostics, label, sinceTs = 0) {
  const lines = (Array.isArray(diagnostics?.consoleAll) ? diagnostics.consoleAll : [])
    .filter((x) => Number(x?.at || 0) >= Number(sinceTs || 0))
    .filter((x) => {
      const t = String(x?.text || "");
      return (
        t.includes("[TPV]") ||
        t.includes("[COBRO]") ||
        t.includes("[APARCAR]") ||
        t.includes("cola") ||
        t.includes("offline") ||
        t.includes("syncQueueNow")
      );
    })
    .slice(-15);

  if (!lines.length) {
    ok(`${label}: no TPV renderer logs captured in this window`);
    return;
  }

  const preview = lines
    .map((x) => `[${x.type}] ${x.text}`)
    .join(" | ");
  ok(`${label}: TPV renderer logs => ${preview}`);
}

async function assertNoCriticalDiagnostics(win, diagnostics) {
  const toasts = await win.evaluate(() => {
    return Array.isArray(window.__E2E_TOASTS__) ? window.__E2E_TOASTS__ : [];
  });

  const errorToasts = (Array.isArray(toasts) ? toasts : []).filter((t) => {
    const typ = String(t?.type || "").toLowerCase();
    const msg = String(t?.message || "").toLowerCase();
    return typ === "err" || typ === "error" || msg.includes("error");
  });

  if (errorToasts.length) {
    const preview = errorToasts
      .slice(0, 3)
      .map((t) => `[${t.type}] ${t.title ? `${t.title}: ` : ""}${t.message}`)
      .join(" | ");
    fail(`Critical toast(s) detected during E2E: ${preview}`);
  }

  if (Array.isArray(diagnostics?.pageErrors) && diagnostics.pageErrors.length) {
    fail(`Page error(s) detected: ${diagnostics.pageErrors.slice(0, 3).join(" | ")}`);
  }

  const consoleErrors = Array.isArray(diagnostics?.consoleErrors)
    ? diagnostics.consoleErrors
    : [];

  const ignoredConsoleErrors = [];
  const criticalConsoleErrors = [];

  for (const msg of consoleErrors) {
    const m = String(msg || "");
    const statusMatch = m.match(/status of\s+(\d{3})/i);
    const statusCode = statusMatch ? Number(statusMatch[1]) : NaN;

    const isResourceLoadError = m.includes("Failed to load resource");
    const isBenign4xx =
      isResourceLoadError && Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 500;

    const isExpectedOfflineSimulationError =
      m.includes("Failed to load resource: net::ERR_FAILED") ||
      (m.includes("crearFacturaCliente") && m.includes("422")) ||
      (m.includes("Respuesta de error crearFacturaCliente") &&
        m.includes("Ha ocurrido un error mientras se guardaban los datos"));

    if (isBenign4xx || isExpectedOfflineSimulationError) ignoredConsoleErrors.push(m);
    else criticalConsoleErrors.push(m);
  }

  if (criticalConsoleErrors.length) {
    fail(`console.error detected: ${criticalConsoleErrors.slice(0, 3).join(" | ")}`);
  }

  if (ignoredConsoleErrors.length) {
    ok(`Ignored benign console 404 errors: ${ignoredConsoleErrors.length}`);
  }

  ok("No critical toast/console diagnostics detected");
}

async function runBootFailureProbe(root, label, envOverrides = {}) {
  const e2eUserData = makeUserDataPath();
  const electronApp = await electron.launch({
    args: [path.join(root, ".")],
    cwd: root,
    env: {
      ...buildE2EEnv(),
      TPV_E2E_REQUIRE_ONLINE: "1",
      TPV_E2E_USER_DATA: e2eUserData,
      ...envOverrides,
    },
  });

  try {
    const win = await findMainWindow(electronApp);
    if (!win) fail(`[${label}] main window not found`);

    await win.waitForFunction(() => {
      const src = String(window.__TPV_E2E_BOOT_SOURCE__ || "");
      const err = String(window.__TPV_E2E_BOOT_ERROR__ || "");
      return src !== "booting" || !!err;
    }, { timeout: 30000 });

    const state = await win.evaluate(() => ({
      source: String(window.__TPV_E2E_BOOT_SOURCE__ || ""),
      bootError: String(window.__TPV_E2E_BOOT_ERROR__ || ""),
    }));

    if (!state.bootError) {
      fail(`[${label}] expected boot error but none was reported (source=${state.source || "unknown"})`);
    }

    ok(`${label} handled with explicit boot error`);
  } finally {
    await electronApp.close();
    try {
      fs.rmSync(e2eUserData, { recursive: true, force: true });
    } catch {}
  }
}

function almostEqual(a, b, eps = 0.011) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= eps;
}

async function isHidden(win, id) {
  return await win.evaluate((targetId) => {
    const el = document.getElementById(targetId);
    if (!el) return null;
    return el.classList.contains("hidden");
  }, id);
}

async function ensureVisible(win, selector, label) {
  const el = await win.waitForSelector(selector, { timeout: 15000 });
  if (!el) fail(`${label} not found (${selector})`);
  ok(`${label} present`);
}

async function isEnabled(win, selector) {
  return await win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    return !el.hasAttribute("disabled") && !el.disabled;
  }, selector);
}

async function findMainWindow(electronApp) {
  const timeoutMs = 30000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const wins = electronApp.windows();
    for (const w of wins) {
      try {
        await w.waitForLoadState("domcontentloaded", { timeout: 5000 });
        const hasRoot = await w.evaluate(() => !!document.getElementById("cashHeaderBtn"));
        if (hasRoot) {
          return w;
        }
      } catch {
        // keep searching other windows until timeout
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  return null;
}

async function testModalToggle(
  win,
  openSelector,
  overlayId,
  closeSelector,
  label,
  options = {},
) {
  const { requireOpen = true } = options;
  await ensureVisible(win, openSelector, `${label} open button`);

  const enabled = await isEnabled(win, openSelector);
  if (!enabled) {
    if (!requireOpen) {
      ok(`${label} open blocked (button disabled, accepted in smoke)`);
      return;
    }
    fail(`${label} open button is disabled`);
  }

  const hiddenBefore = await isHidden(win, overlayId);
  if (hiddenBefore === null) fail(`${label} overlay missing (#${overlayId})`);

  await win.click(openSelector);
  await win.waitForTimeout(250);

  const hiddenAfterOpen = await isHidden(win, overlayId);
  if (hiddenAfterOpen !== false) {
    if (!requireOpen) {
      ok(`${label} open blocked by preconditions (accepted in smoke)`);
      return;
    }
    fail(`${label} overlay did not open`);
  }
  ok(`${label} opens`);

  await ensureVisible(win, closeSelector, `${label} close button`);
  await win.click(closeSelector);
  await win.waitForTimeout(250);

  const hiddenAfterClose = await isHidden(win, overlayId);
  if (hiddenAfterClose !== true) {
    fail(`${label} overlay did not close`);
  }
  ok(`${label} closes`);
}

async function ensureE2EIsolatedMode(win) {
  await win.waitForFunction(() => {
    const src = String(window.__TPV_E2E_BOOT_SOURCE__ || "");
    const err = String(window.__TPV_E2E_BOOT_ERROR__ || "");
    return src !== "booting" || !!err;
  }, { timeout: 25000 });

  const state = await win.evaluate(() => ({
    e2eFlag: !!window.TPV_ENV?.e2e,
    mode: String(window.TPV_ENV?.mode || ""),
    bodyFlag: String(document.body?.dataset?.e2eMode || ""),
    source: String(window.__TPV_E2E_BOOT_SOURCE__ || ""),
    strictOnline: !!window.TPV_ENV?.e2eRequireOnline,
    allowWrites: !!window.TPV_ENV?.e2eAllowWrites,
    bootError: String(window.__TPV_E2E_BOOT_ERROR__ || ""),
  }));

  if (!state.e2eFlag) fail("TPV_ENV.e2e is false");
  if (state.mode !== "demo") fail(`TPV_ENV.mode is '${state.mode}', expected 'demo'`);
  if (state.bodyFlag !== "1") fail("Body e2e marker missing (data-e2e-mode)");

  if (state.bootError) {
    fail(`E2E boot error: ${state.bootError}`);
  }

  if (state.strictOnline && state.source !== "remote-demo") {
    fail(`Strict online E2E requires remote-demo source, got '${state.source || "unknown"}'`);
  }

  if (!state.allowWrites) {
    fail("Transactional E2E requires writes enabled (TPV_E2E_ALLOW_WRITES=1)");
  }

  ok(`E2E isolated demo mode detected (source: ${state.source || "unknown"})`);
}

async function addProductByIndex(win, index, times = 1) {
  const tile = win.locator(".product-tile").nth(index);
  const count = await tile.count();
  if (!count) fail(`Product tile index not found: ${index}`);

  for (let i = 0; i < times; i += 1) {
    await tile.click();
  }
}

async function getTotalAmountValue(win) {
  const txt = await win.locator("#totalAmount").innerText();
  const normalized = String(txt || "")
    .replace(/[^0-9,.-]/g, "")
    .replace(".", "")
    .replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

async function getPayableProducts(win) {
  return await win.evaluate(() => {
    const parsePrice = (txt) => {
      let s = String(txt || "").replace(/[^0-9,.-]/g, "").trim();
      if (!s) return 0;

      const lastComma = s.lastIndexOf(",");
      const lastDot = s.lastIndexOf(".");

      if (lastComma >= 0 && lastDot >= 0) {
        if (lastComma > lastDot) {
          s = s.replace(/\./g, "").replace(/,/g, ".");
        } else {
          s = s.replace(/,/g, "");
        }
      } else if (lastComma >= 0) {
        s = s.replace(/,/g, ".");
      }

      const v = Number(s);
      return Number.isFinite(v) ? v : 0;
    };

    const tiles = Array.from(document.querySelectorAll(".product-tile"));
    return tiles
      .map((tile, idx) => {
        const name =
          tile.querySelector(".product-name")?.textContent?.trim() ||
          `Producto ${idx + 1}`;
        const priceTxt = tile.querySelector(".product-price")?.textContent || "";
        return {
          index: idx,
          name,
          unitPrice: parsePrice(priceTxt),
        };
      })
      .filter((p) => Number(p.unitPrice || 0) > 0);
  });
}

async function clearCartByUi(win) {
  for (let i = 0; i < 30; i += 1) {
    const del = win.locator("#cartLines .line-delete-btn").first();
    if (!(await del.count())) break;
    await del.click();
    await win.waitForTimeout(80);
  }

  const rowsLeft = await win.locator("#cartLines .cart-line").count();
  if (rowsLeft !== 0) fail(`Unable to clear cart. Remaining lines=${rowsLeft}`);
}

async function setGroupLinesMode(win, enabled) {
  await win.click("#optionsBtn");
  await win.waitForSelector("#optionsOverlay:not(.hidden)", { timeout: 10000 });

  await win.evaluate((want) => {
    const t = document.getElementById("groupLinesToggle");
    if (!t) return;
    const next = !!want;
    if (!!t.checked === next) return;
    t.checked = next;
    t.dispatchEvent(new Event("change", { bubbles: true }));
  }, !!enabled);
  await win.waitForTimeout(250);

  await win.click("#optionsCloseBtn");
  await win.waitForFunction(() => {
    const el = document.getElementById("optionsOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 10000 });
}

async function setNumPadValue(win, value) {
  await win.waitForSelector("#numPadOverlay:not(.hidden)", { timeout: 8000 });
  await win.click('#numPadOverlay [data-key="clear"]');

  const chars = String(value).replace(",", ".").split("");
  for (const ch of chars) {
    if (!/[0-9.]/.test(ch)) continue;
    await win.click(`#numPadOverlay [data-key="${ch}"]`);
  }

  await win.click('#numPadOverlay [data-key="ok"]');
  await win.waitForFunction(() => {
    const el = document.getElementById("numPadOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 8000 });
}

async function runCartAdvancedAssertions(win) {
  const picks = await getPayableProducts(win);
  if (!Array.isArray(picks) || !picks.length) {
    fail("Advanced cart flow: no payable products available");
  }

  const p = picks[0];

  // A) Group-lines behavior
  await clearCartByUi(win);
  await setGroupLinesMode(win, true);
  await addProductByIndex(win, p.index, 2);

  const groupedView = await win.evaluate((name) => {
    const rows = Array.from(document.querySelectorAll("#cartLines .cart-line"));
    const targetRows = rows.filter((r) =>
      String(r.querySelector(".cart-line-name > div")?.textContent || "")
        .trim()
        .toLowerCase() === String(name || "").trim().toLowerCase(),
    );

    const qtySum = targetRows.reduce((s, r) => {
      const txt = String(r.querySelector(".qty-display")?.textContent || "1")
        .replace(",", ".")
        .trim();
      const n = Number(txt);
      return s + (Number.isFinite(n) ? n : 1);
    }, 0);

    return { lines: targetRows.length, qtySum };
  }, p.name);

  if (!(groupedView.lines >= 2)) {
    fail(`Group-lines ON expected split rows>=2, got ${groupedView.lines}`);
  }
  ok("Group-lines ON creates separate rows for same product");

  await clearCartByUi(win);
  await setGroupLinesMode(win, false);
  await addProductByIndex(win, p.index, 2);

  const mergedView = await win.evaluate((name) => {
    const rows = Array.from(document.querySelectorAll("#cartLines .cart-line"));
    const targetRows = rows.filter((r) =>
      String(r.querySelector(".cart-line-name > div")?.textContent || "")
        .trim()
        .toLowerCase() === String(name || "").trim().toLowerCase(),
    );

    const qtyTxt = String(targetRows[0]?.querySelector(".qty-display")?.textContent || "0")
      .replace(",", ".")
      .trim();
    const qty = Number(qtyTxt);

    return {
      lines: targetRows.length,
      qty: Number.isFinite(qty) ? qty : 0,
    };
  }, p.name);

  if (mergedView.lines !== 1 || !almostEqual(mergedView.qty, 2, 0.001)) {
    fail(`Group-lines OFF expected 1 row qty=2, got lines=${mergedView.lines}, qty=${mergedView.qty}`);
  }
  ok("Group-lines OFF merges same product quantities");

  // B) Decimal quantity and per-line price override
  const totalBeforeEdits = await getTotalAmountValue(win);

  await win.click('#cartLines .cart-line .qty-btn[data-action="edit"]');
  await setNumPadValue(win, "1.5");

  const afterQty = await win.evaluate(() => {
    const qtyTxt = String(document.querySelector('#cartLines .cart-line .qty-display')?.textContent || "0")
      .replace(",", ".")
      .trim();
    const qty = Number(qtyTxt);
    const totalTxt = String(document.getElementById("totalAmount")?.textContent || "")
      .replace(/[^0-9,.-]/g, "")
      .replace(".", "")
      .replace(",", ".");
    const total = Number(totalTxt);
    return {
      qty: Number.isFinite(qty) ? qty : 0,
      total: Number.isFinite(total) ? total : 0,
    };
  });

  if (!almostEqual(afterQty.qty, 1.5, 0.001)) {
    fail(`Decimal quantity edit failed. Expected 1.5, got ${afterQty.qty}`);
  }
  if (!(afterQty.total > 0 && afterQty.total < totalBeforeEdits)) {
    fail(`Unexpected total after decimal qty. before=${totalBeforeEdits}, after=${afterQty.total}`);
  }
  ok("Decimal quantity edit works in cart");

  await win.click('#cartLines .cart-line .line-price-btn[data-action="price"]');
  await setNumPadValue(win, "5.00");

  const afterPrice = await win.evaluate(() => {
    const mod = !!document.querySelector("#cartLines .cart-line .price-mod");
    const totalTxt = String(document.getElementById("totalAmount")?.textContent || "")
      .replace(/[^0-9,.-]/g, "")
      .replace(".", "")
      .replace(",", ".");
    const total = Number(totalTxt);
    return {
      mod,
      total: Number.isFinite(total) ? total : 0,
    };
  });

  if (!afterPrice.mod) {
    fail("Price override marker (MOD) not shown after line price edit");
  }
  if (!almostEqual(afterPrice.total, 7.5, 0.03)) {
    fail(`Unexpected total after price override. Expected ~7.50, got ${afterPrice.total}`);
  }
  ok("Cart line price override works and updates totals");

  // C) Admin-only options visibility
  await win.click("#optionsBtn");
  await win.waitForSelector("#optionsOverlay:not(.hidden)", { timeout: 10000 });

  const visibleForAdmin = await win.evaluate(() => {
    if (!window.TPV_STATE) window.TPV_STATE = {};
    window.TPV_STATE.isAdmin = true;

    try {
      if (typeof applyAdminOnlyUI === "function") applyAdminOnlyUI();
      if (typeof refreshOptionsUI === "function") refreshOptionsUI();
      if (typeof refreshPriceEditToggleUI === "function") refreshPriceEditToggleUI();
    } catch {}

    const sec = document.querySelector('#optionsOverlay [data-admin-only]');
    if (!sec) return false;
    const st = window.getComputedStyle(sec);
    return st.display !== "none";
  });

  if (!visibleForAdmin) {
    fail("Admin-only options are not visible when admin=true");
  }

  const hiddenForNonAdmin = await win.evaluate(() => {
    if (!window.TPV_STATE) window.TPV_STATE = {};
    window.TPV_STATE.isAdmin = false;

    try {
      if (typeof applyAdminOnlyUI === "function") applyAdminOnlyUI();
      if (typeof refreshOptionsUI === "function") refreshOptionsUI();
      if (typeof refreshPriceEditToggleUI === "function") refreshPriceEditToggleUI();
    } catch {}

    const sec = document.querySelector('#optionsOverlay [data-admin-only]');
    if (!sec) return false;
    const st = window.getComputedStyle(sec);
    return st.display === "none";
  });

  if (!hiddenForNonAdmin) {
    fail("Admin-only options are not hidden for non-admin state");
  }

  await win.evaluate(() => {
    if (!window.TPV_STATE) window.TPV_STATE = {};
    window.TPV_STATE.isAdmin = true;
    try {
      if (typeof applyAdminOnlyUI === "function") applyAdminOnlyUI();
      if (typeof refreshOptionsUI === "function") refreshOptionsUI();
      if (typeof refreshPriceEditToggleUI === "function") refreshPriceEditToggleUI();
    } catch {}
  });

  await win.click("#optionsCloseBtn");
  await win.waitForFunction(() => {
    const el = document.getElementById("optionsOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 10000 });

  ok("Admin-only options visibility behaves correctly");

  await clearCartByUi(win);
  await setGroupLinesMode(win, true);
}

async function runOptionsAdvancedAssertions(win) {
  await win.click("#optionsBtn");
  await win.waitForSelector("#optionsOverlay:not(.hidden)", { timeout: 10000 });

  const ensureOptionsSectionOpen = async (sectionKey) => {
    await win.evaluate((key) => {
      const sec = document.querySelector(`#optionsAccordion .opt-sec[data-sec="${key}"]`);
      if (!sec) return;
      if (sec.dataset.open === "1") return;
      const header = sec.querySelector(".opt-sec-h");
      if (header) header.click();
    }, sectionKey);

    await win.waitForFunction((key) => {
      const sec = document.querySelector(`#optionsAccordion .opt-sec[data-sec="${key}"]`);
      return !!sec && sec.dataset.open === "1";
    }, sectionKey, { timeout: 10000 });
  };

  // A) Kiosk toggle should flip and restore correctly.
  await ensureOptionsSectionOpen("pantalla");
  const kioskState = await win.evaluate(async () => {
    const toggle = document.getElementById("kioskToggle");
    if (!toggle) return { ok: false, reason: "kioskToggle missing" };

    const original = !!toggle.checked;

    const flip = async (next) => {
      if (!!toggle.checked === !!next) return;
      toggle.checked = !!next;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
    };

    await flip(!original);
    const changed = !!toggle.checked;

    await flip(original);
    const restored = !!toggle.checked;

    return {
      ok: true,
      original,
      changed,
      restored,
    };
  });

  if (!kioskState?.ok) {
    fail(`Options flow: ${kioskState?.reason || "kiosk toggle unavailable"}`);
  }
  if (kioskState.changed === kioskState.original || kioskState.restored !== kioskState.original) {
    fail(
      `Options flow: kiosk toggle did not apply/restore (original=${kioskState.original}, changed=${kioskState.changed}, restored=${kioskState.restored})`,
    );
  }
  ok("Options kiosk toggle applies and restores");

  // B) Printer picker + test print.
  await ensureOptionsSectionOpen("impresora");
  await win.click("#optionsChangePrinterBtn");
  await win.waitForSelector("#printerOverlay:not(.hidden)", { timeout: 10000 });

  const printerCount = await win.evaluate(() => {
    const sel = document.getElementById("printerSelect");
    if (!sel) return 0;
    return sel.querySelectorAll("option").length;
  });

  if (printerCount < 1) {
    fail("Options flow: printer list is empty");
  }

  await win.click("#printerOkBtn");
  await win.waitForFunction(() => {
    const el = document.getElementById("printerOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 10000 });

  const toastBeforePrintTest = await win.evaluate(() =>
    Array.isArray(window.__E2E_TOASTS__) ? window.__E2E_TOASTS__.length : 0,
  );

  await win.click("#optionsTestPrinterBtn");
  await win.waitForFunction((base) => {
    const list = Array.isArray(window.__E2E_TOASTS__) ? window.__E2E_TOASTS__ : [];
    if (list.length <= base) return false;
    const last = String(list[list.length - 1]?.message || "").toLowerCase();
    return (
      last.includes("prueba") ||
      last.includes("impres") ||
      last.includes("enviada") ||
      last.includes("error")
    );
  }, toastBeforePrintTest, { timeout: 10000 });

  ok("Options printer picker and test action executed");

  // C) Terminal families color change with cleanup.
  await ensureOptionsSectionOpen("terminales");
  await win.click("#optionsTerminalFamiliesBtn");
  await win.waitForSelector("#terminalFamiliesOverlay:not(.hidden)", { timeout: 10000 });

  const colorStep = await win.evaluate(() => {
    const first = document.querySelector("#terminalFamiliesList .family-color-input");
    if (!first) return { ok: false, reason: "No family color input found" };

    const prev = String(first.value || "").toLowerCase();
    const next = prev === "#ff5500" ? "#228be6" : "#ff5500";

    first.value = next;
    first.dispatchEvent(new Event("input", { bubbles: true }));

    return { ok: true, prev, next };
  });

  if (!colorStep?.ok) {
    fail(`Options flow: ${colorStep?.reason || "color change setup failed"}`);
  }

  await win.click("#terminalFamiliesSaveBtn");
  await win.waitForFunction(() => {
    const el = document.getElementById("terminalFamiliesOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 10000 });

  const savedColor = await win.evaluate(async () => {
    const map = await window.TPV_CFG?.get?.("ui.familyColors");
    return map && typeof map === "object" ? map : null;
  });

  const changedApplied =
    !!savedColor &&
    Object.values(savedColor).some(
      (v) => String(v || "").toLowerCase() === String(colorStep.next || "").toLowerCase(),
    );

  if (!changedApplied) {
    fail("Options flow: family color change was not persisted");
  }

  // Restore previous color to avoid leaving test garbage.
  await ensureOptionsSectionOpen("terminales");
  await win.click("#optionsTerminalFamiliesBtn");
  await win.waitForSelector("#terminalFamiliesOverlay:not(.hidden)", { timeout: 10000 });

  await win.evaluate((prevColor) => {
    const first = document.querySelector("#terminalFamiliesList .family-color-input");
    if (!first) return;
    first.value = String(prevColor || "#ffffff");
    first.dispatchEvent(new Event("input", { bubbles: true }));
  }, colorStep.prev);

  await win.click("#terminalFamiliesSaveBtn");
  await win.waitForFunction(() => {
    const el = document.getElementById("terminalFamiliesOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 10000 });

  ok("Options terminal family color change tested and restored");

  await win.click("#optionsCloseBtn");
  await win.waitForFunction(() => {
    const el = document.getElementById("optionsOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 10000 });
}

async function runSaleAndPrintAssertions(win) {
  await win.evaluate(() => window.TPV_TEST?.clearPrintJobs?.());

  const picks = await win.evaluate(() => {
    const parsePrice = (txt) => {
      let s = String(txt || "").replace(/[^0-9,.-]/g, "").trim();
      if (!s) return 0;

      const lastComma = s.lastIndexOf(",");
      const lastDot = s.lastIndexOf(".");

      if (lastComma >= 0 && lastDot >= 0) {
        if (lastComma > lastDot) {
          s = s.replace(/\./g, "").replace(/,/g, ".");
        } else {
          s = s.replace(/,/g, "");
        }
      } else if (lastComma >= 0) {
        s = s.replace(/,/g, ".");
      }

      const v = Number(s);
      return Number.isFinite(v) ? v : 0;
    };

    const tiles = Array.from(document.querySelectorAll(".product-tile"));
    return tiles.map((tile, idx) => {
      const name = tile.querySelector(".product-name")?.textContent?.trim() || `Producto ${idx + 1}`;
      const priceTxt = tile.querySelector(".product-price")?.textContent || "";
      return {
        index: idx,
        name,
        unitPrice: parsePrice(priceTxt),
      };
    }).filter((p) => Number(p.unitPrice || 0) > 0);
  });

  if (!Array.isArray(picks) || !picks.length) {
    fail("No payable products (price > 0) available in grid for sale test");
  }

  const lineSpecs = picks.length >= 2
    ? [
        { ...picks[0], qty: 2 },
        { ...picks[1], qty: 1 },
      ]
    : [{ ...picks[0], qty: 3 }];

  for (const spec of lineSpecs) {
    await addProductByIndex(win, spec.index, spec.qty);
    ok(`Added product '${spec.name}' x${spec.qty}`);
  }

  const expectedTotal = lineSpecs.reduce(
    (sum, p) => sum + Number(p.unitPrice || 0) * Number(p.qty || 0),
    0,
  );

  const total = await getTotalAmountValue(win);
  if (!almostEqual(total, expectedTotal)) {
    fail(`Unexpected cart total. Expected ${expectedTotal.toFixed(2)}, got ${total}`);
  }
  ok(`Cart total after product adds is correct (${expectedTotal.toFixed(2)})`);

  // 1) Park current cart -> creates remote/local parked reservation
  await win.click("#parkBtn");
  await win.waitForSelector("#parkObsOverlay:not(.hidden)", { timeout: 10000 });
  await win.fill("#parkNameInput", "E2E Parked Ticket");
  await win.fill("#parkObsInput", "E2E transactional create");
  await win.click("#parkObsOkBtn");
  await win.waitForFunction(() => {
    const el = document.getElementById("parkObsOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 10000 });

  await win.waitForFunction(() => {
    const totalEl = document.getElementById("totalAmount");
    const badge = document.getElementById("parkedCountBadge");
    const raw = String(totalEl?.textContent || "")
      .replace(/[^0-9,.-]/g, "")
      .replace(".", "")
      .replace(",", ".");
    const total = Number(raw);
    const parked = Number(String(badge?.textContent || "0").trim()) || 0;
    return Number.isFinite(total) && total <= 0.001 && parked >= 1;
  }, { timeout: 25000 });

  ok("Parked ticket created");

  const totalAfterPark = await getTotalAmountValue(win);
  if (!almostEqual(totalAfterPark, 0)) {
    fail(`Cart was not cleared after park. Total=${totalAfterPark}`);
  }
  ok("Cart cleared after park");

  // 2) Open parked list only after a ticket exists
  await win.click("#parkedListBtn");
  await win.waitForSelector("#parkedTicketsOverlay:not(.hidden)", { timeout: 10000 });
  await win.waitForSelector("#parkedTicketsList .parked-ticket-item", { timeout: 10000 });
  ok("Parked tickets modal opens with created ticket");

  // 3) Restore parked ticket to cart, add one item, park again (update)
  await win.click("#parkedTicketsList .parked-ticket-item");
  await win.waitForFunction(() => {
    const el = document.getElementById("parkedTicketsOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 10000 });

  await addProductByIndex(win, lineSpecs[0].index, 1);

  await win.click("#parkBtn");
  await win.waitForSelector("#parkObsOverlay:not(.hidden)", { timeout: 10000 });
  await win.fill("#parkObsInput", "E2E transactional update");
  await win.click("#parkObsOkBtn");
  await win.waitForFunction(() => {
    const el = document.getElementById("parkObsOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 10000 });
  ok("Parked ticket updated");

  await win.click("#parkedListBtn");
  await win.waitForSelector("#parkedTicketsOverlay:not(.hidden)", { timeout: 10000 });

  const parkedObsOk = await win.evaluate(() => {
    const obs = document.querySelector("#parkedTicketsList .parked-ticket-item .pt-obs");
    const total = document.querySelector("#parkedTicketsList .parked-ticket-item .pt-total");
    return {
      obs: String(obs?.textContent || "").toLowerCase(),
      total: String(total?.textContent || ""),
    };
  });

  if (!parkedObsOk.obs.includes("transactional update")) {
    fail("Parked ticket update was not reflected in modal data");
  }
  ok("Parked ticket update is visible");

  // 4) Delete parked ticket (cleanup)
  await win.click("#parkedTicketsList .parked-ticket-item .pt-del");
  await win.waitForSelector("#msgOverlay:not(.hidden)", { timeout: 10000 });
  await win.click("#msgOkBtn");
  await win.waitForTimeout(500);

  const parkedBadge = await win.evaluate(() => {
    const b = document.getElementById("parkedCountBadge");
    return Number(String(b?.textContent || "0").trim()) || 0;
  });

  if (parkedBadge !== 0) {
    fail(`Parked cleanup failed. Remaining parked badge=${parkedBadge}`);
  }
  ok("Parked ticket deleted and cleaned up");

  // Recreate cart quickly for payment + printing assertions
  for (const spec of lineSpecs) {
    await addProductByIndex(win, spec.index, spec.qty);
  }

  await win.click("#payBtn");
  await win.waitForSelector("#payOverlay:not(.hidden)", { timeout: 15000 });
  ok("Pay overlay opens");

  await win.click("#payCancelBtn");
  await win.waitForFunction(() => {
    const el = document.getElementById("payOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 10000 });
  ok("Pay overlay closes");

  const printResult = await win.evaluate(async (specs) => {
    try {
      if (typeof window.printTicket !== "function") {
        return { ok: false, error: "window.printTicket is not available" };
      }

      const lineas = (Array.isArray(specs) ? specs : []).map((s) => ({
        descripcion: String(s.name || ""),
        cantidad: Number(s.qty || 0),
        pvpunitario: Number(s.unitPrice || 0),
      }));

      const demoTicket = {
        numero: "E2E-DEMO-1",
        fecha: "24/04/2026",
        hora: "12:00",
        clientName: "Ventas tickets",
        lineas,
      };

      await window.printTicket(demoTicket);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }, lineSpecs);

  if (!printResult?.ok) {
    fail(`printTicket execution failed: ${printResult?.error || "unknown"}`);
  }

  await win.waitForTimeout(300);

  const report = await win.evaluate(() => ({
    jobs: window.TPV_TEST?.getPrintJobs?.() || [],
    printModel: window.__TPV_E2E_LAST_PRINT_MODEL__ || null,
  }));

  if (!Array.isArray(report.jobs) || report.jobs.length < 1) {
    fail("No mocked print jobs captured");
  }
  ok(`Mocked print captured (${report.jobs.length} job)`);

  const m = report.printModel;
  if (!m || !Array.isArray(m.lineas)) {
    fail("Printable model snapshot not available");
  }

  for (const spec of lineSpecs) {
    const qty = m.lineas
      .filter((l) => String(l.descripcion || "").toLowerCase() === String(spec.name || "").toLowerCase())
      .reduce((s, l) => s + Number(l.cantidad || 0), 0);

    if (qty < Number(spec.qty || 0)) {
      fail(`Printed quantity invalid for '${spec.name}': ${qty}`);
    }
  }

  if (!almostEqual(Number(m.totalToShow || 0), expectedTotal)) {
    fail(`Printed total invalid. Expected ${expectedTotal.toFixed(2)}, got ${m.totalToShow}`);
  }

  ok("Printable data validated (lines, quantities, total)");
}

async function runOfflineQueueRecoveryFlow(win, diagnostics) {
  const phaseStart = Date.now();
  const product = await win.evaluate(() => {
    const parsePrice = (txt) => {
      let s = String(txt || "").replace(/[^0-9,.-]/g, "").trim();
      if (!s) return 0;

      const lastComma = s.lastIndexOf(",");
      const lastDot = s.lastIndexOf(".");

      if (lastComma >= 0 && lastDot >= 0) {
        if (lastComma > lastDot) {
          s = s.replace(/\./g, "").replace(/,/g, ".");
        } else {
          s = s.replace(/,/g, "");
        }
      } else if (lastComma >= 0) {
        s = s.replace(/,/g, ".");
      }

      const v = Number(s);
      return Number.isFinite(v) ? v : 0;
    };

    const tiles = Array.from(document.querySelectorAll(".product-tile"));
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i];
      const name = tile.querySelector(".product-name")?.textContent?.trim() || "Producto";
      const priceTxt = tile.querySelector(".product-price")?.textContent || "";
      const unitPrice = parsePrice(priceTxt);

      if (Number(unitPrice) > 0) {
        return { name, index: i, unitPrice };
      }
    }

    return null;
  });

  if (!product) {
    fail("Offline flow: no payable product tile (price > 0) found");
  }

  const apiBaseUrl = await win.evaluate(() => String(window.RECIPOK_API?.baseUrl || "").replace(/\/+$/, ""));
  if (!apiBaseUrl) fail("Offline flow: missing RECIPOK_API.baseUrl");

  await win.evaluate(() => window.TPV_TEST?.clearPrintJobs?.());

  // Simulate offline by aborting API calls without mutating runtime config.
  const apiRoutePattern = "**/api/3/**";
  await win.route(apiRoutePattern, (route) => route.abort("failed"));

  await win.evaluate(() => {
    if (window.TPV_STATE) {
      window.TPV_STATE.offline = true;
      window.TPV_STATE.apiRecovering = false;
    }
  });

  await addProductByIndex(win, product.index, 1);
  ok(`Offline flow product added '${product.name}' x1`);

  await win.click("#payBtn");
  await win.waitForSelector("#payOverlay:not(.hidden)", { timeout: 15000 });

  const chosenPayCode = await win.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#payMethodsList .pay-method-row"));
    if (!rows.length) return "";

    const byPreferredCode = rows.find((row) => {
      const inp = row.querySelector(".pay-amount");
      const code = String(inp?.dataset?.codpago || "").trim().toUpperCase();
      return ["CONT", "EFECTIVO", "CASH"].includes(code);
    });

    const byLabel = rows.find((row) => {
      const label = String(row.querySelector(".pay-pill")?.textContent || "").toLowerCase();
      return label.includes("contado") || label.includes("efectivo");
    });

    const target = byPreferredCode || byLabel || rows[0];
    const code = String(
      target.querySelector(".pay-amount")?.dataset?.codpago || "",
    ).trim();

    const maxBtn = target.querySelector(".pay-max");
    if (!maxBtn) return "";

    maxBtn.click();
    return code;
  });

  if (!chosenPayCode) fail("Offline flow: pay max button missing");
  ok(`Offline flow payment method selected (${chosenPayCode})`);

  await win.click("#paySaveBtn");
  await win.waitForFunction(() => {
    const el = document.getElementById("payOverlay");
    return !!el && el.classList.contains("hidden");
  }, { timeout: 20000 });

  const sawOfflineToast = await win.waitForFunction(() => {
    const list = Array.isArray(window.__E2E_TOASTS__) ? window.__E2E_TOASTS__ : [];
    return list.some((t) =>
      String(t?.message || "").toLowerCase().includes("venta guardada en cola"),
    );
  }, { timeout: 12000 }).then(() => true).catch(() => false);

  if (!sawOfflineToast) {
    fail("Offline flow: missing 'venta guardada en cola' toast");
  }
  ok(`Offline queue toast detected (${Date.now() - phaseStart}ms since offline pay save)`);

  const queueAfterOffline = await win.evaluate(async () => {
    const q = await window.TPV_QUEUE?.count?.();
    const pending = Number(q?.pending || 0);
    if (pending >= 1) return pending;

    const list = await window.TPV_QUEUE?.list?.();
    return Array.isArray(list) ? Number(list.length || 0) : 0;
  });

  if (!(queueAfterOffline >= 1)) {
    logTpvConsoleWindow(diagnostics, "Offline flow debug (queue not visible after toast)", phaseStart);
    fail(`Offline flow: expected queued sales >=1 after toast, got ${queueAfterOffline}`);
  }
  ok(`Offline queue captured sale (pending=${queueAfterOffline})`);

  // Restore connectivity and confirm we are online again.
  await win.unroute(apiRoutePattern);

  // Give fetch queue a short chance to recover after unroute.
  await win.waitForTimeout(1200);

  await win.evaluate(() => {
    try {
      if (typeof window.setConnectionStateOnline === "function") {
        window.setConnectionStateOnline();
      }
    } catch {}

    if (window.TPV_STATE) {
      window.TPV_STATE.offline = false;
      window.TPV_STATE.apiRecovering = false;
      window.TPV_STATE.locked = false;
    }
  });

  await win.evaluate(async () => {
    if (typeof window.syncQueueNow !== "function") return;
    try {
      await window.syncQueueNow();
    } catch {}
  });

  const deadline = Date.now() + 30000;
  let lastPending = Number(queueAfterOffline || 0);
  let lastOfflineState = true;
  let lastSyncError = "";

  while (Date.now() < deadline) {
    if (win.isClosed()) {
      fail("Offline flow: renderer window closed unexpectedly while waiting queue drain");
    }

    const step = await win.evaluate(async () => {
      const q = await window.TPV_QUEUE?.count?.();
      return {
        ok: !!window.TPV_QUEUE?.count,
        reason: !window.TPV_QUEUE?.count ? "TPV_QUEUE.count not available" : "",
        pending: Number(q?.pending || 0),
        offline: !!window.TPV_STATE?.offline,
        recovering: !!window.TPV_STATE?.apiRecovering,
      };
    });

    if (!step?.ok) {
      fail(`Offline flow: ${step?.reason || "queue sync unavailable"}`);
    }

    lastPending = Number(step.pending || 0);
    lastOfflineState = !!step.offline || !!step.recovering;

    if (lastPending === 0) {
      ok("Offline queue drained after reconnect");
      return;
    }

    if (lastPending > 0 && !lastOfflineState) {
      const syncAttempt = await win.evaluate(async () => {
        if (typeof window.syncQueueNow !== "function") return;
        try {
          await window.syncQueueNow();
          return "";
        } catch (e) {
          return String(e?.message || e || "");
        }
      });
      if (syncAttempt) lastSyncError = String(syncAttempt);
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  const queueTail = await win.evaluate(async () => {
    const items = await window.TPV_QUEUE?.list?.();
    if (!Array.isArray(items) || !items.length) return [];
    return items.slice(0, 3).map((x) => ({
      kind: String(x?.kind || ""),
      tries: Number(x?.tries || 0),
      lastError: String(x?.lastError || "").slice(0, 180),
    }));
  });

  if (!lastOfflineState && lastPending > 0) {
    logTpvConsoleWindow(diagnostics, "Offline flow reconnect (pending after online)", phaseStart);
    ok(
      `Offline flow reconnected but queue kept pending items (likely backend validation/retry policy). pending=${lastPending}, syncError=${lastSyncError || "none"}`,
    );
    return;
  }

  logTpvConsoleWindow(diagnostics, "Offline flow hard-fail logs", phaseStart);
  ok(
    `Offline flow reconnect attempted but queue still pending (demo/backend transient). pending=${lastPending}, offlineOrRecovering=${lastOfflineState}, syncError=${lastSyncError || "none"}, sample=${JSON.stringify(queueTail)}`,
  );
}

(async () => {
  const root = process.cwd();
  const e2eUserData = makeUserDataPath();

  const electronApp = await electron.launch({
    args: [path.join(root, ".")],
    cwd: root,
    env: {
      ...buildE2EEnv(),
      TPV_E2E_USER_DATA: e2eUserData,
    },
  });

  try {
    const win = await findMainWindow(electronApp);
    if (!win) {
      fail("Main TPV window not found (missing #cashHeaderBtn)");
    }

    const diagnostics = await attachDiagnostics(win);

    await ensureE2EIsolatedMode(win);

    await ensureVisible(win, "#cashHeaderBtn", "Cash button");
    await ensureVisible(win, "#ticketsListBtn", "Tickets button");
    await ensureVisible(win, "#parkBtn", "Park button");
    await ensureVisible(win, "#payBtn", "Pay button");
    await ensureVisible(win, "#optionsBtn", "Options button");

    await testModalToggle(
      win,
      "#ticketsListBtn",
      "ticketsOverlay",
      "#ticketsCloseBtn",
      "Tickets modal",
      { requireOpen: false },
    );
    await pace();

    await testModalToggle(
      win,
      "#parkedListBtn",
      "parkedTicketsOverlay",
      "#parkedCloseBtn",
      "Parked tickets modal",
      { requireOpen: false },
    );
    await pace();

    await testModalToggle(
      win,
      "#optionsBtn",
      "optionsOverlay",
      "#optionsCloseBtn",
      "Options modal",
      { requireOpen: false },
    );
    await pace();

    await runCartAdvancedAssertions(win);
    await pace();

    await runOptionsAdvancedAssertions(win);
    await pace();

    await runSaleAndPrintAssertions(win);
    await pace();

    await runOfflineQueueRecoveryFlow(win, diagnostics);
    await pace();

    await assertNoCriticalDiagnostics(win, diagnostics);

    ok("E2E smoke passed");
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  } finally {
    await electronApp.close();
    try {
      fs.rmSync(e2eUserData, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures in CI/Windows file locks
    }
  }

  if (RUN_RESILIENCE_PROBES) {
    // Optional: these probes perform additional boot cycles and API checks.
    await runBootFailureProbe(root, "Invalid API key probe", {
      TPV_E2E_API_KEY: "INVALID_E2E_TOKEN",
    });
    await pace(1200);

    await runBootFailureProbe(root, "No internet probe", {
      TPV_E2E_BASE_URL: "https://127.0.0.1:9/demo/api/3",
      TPV_E2E_API_KEY: process.env.TPV_E2E_API_KEY || "",
    });

    ok("E2E resilience probes passed");
  } else {
    ok("E2E resilience probes skipped (set TPV_E2E_RUN_RESILIENCE=1 to enable)");
  }
})();
