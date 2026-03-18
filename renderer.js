// ===== Datos de ejemplo (fallback offline) =====
const demoCategories = [
  { id: "bebidas", name: "Bebidas", color: "#007bff" },
  { id: "bolleria", name: "Bollería", color: "#e67e22" },
  { id: "salados", name: "Salados", color: "#e74c3c" },
  { id: "varios", name: "Varios", color: "#16a085" },
];

const demoProducts = [
  { id: 1, name: "Coca Cola", price: 1.5, category: "bebidas" },
  { id: 2, name: "Agua", price: 1.0, category: "bebidas" },
  { id: 3, name: "Croissant", price: 1.2, category: "bolleria" },
  { id: 4, name: "Napolitana", price: 1.4, category: "bolleria" },
  { id: 5, name: "Empanadilla", price: 1.8, category: "salados" },
  { id: 6, name: "Bocadillo jamón", price: 3.0, category: "salados" },
  { id: 7, name: "Varios 1", price: 2.0, category: "varios" },
  { id: 8, name: "Varios 2", price: 2.5, category: "varios" },
];
// ===== Bootstrap de config global (evita modo demo por undefined) =====
window.RECIPOK_API = window.RECIPOK_API || {
  baseUrl: "", // ej: https://plus.recipok.com/SLUG/api/3
  apiKey: "", // token
  defaultCodClienteTPV: "1",
};

window.TPV_CONFIG = window.TPV_CONFIG || {
  // OBLIGATORIO: URL absoluta a tu clients.json (o al endpoint que lo devuelva)
  resolverUrl: "", // ej: https://tu-dominio.com/clients.json
};

// Estas son las que usará la app realmente (las podremos sobrescribir con la API)
let categories = []; // familias (incluye raíz + hijas)
let products = [];

// Mapa codimpuesto -> porcentaje real de IVA
let taxRatesByCode = {};

// Para saber si ya hemos pintado la UI principal
let mainUiRendered = false;

// Filtro actual
let selectedCategory = null; // id de familia simple
let activeFamilyParentId = null; // id de familia padre (para subfamilias)
let activeSubfamilyId = null; // id de subfamilia activa (hija)
let cart = [];
let searchTerm = "";

let lastTicket = null; // guardará el último ticket/factura creada para poder imprimirla

let parkedTickets = []; // cada item: { id, createdAt, items, total }
let parkedCounter = 0;
// Índice del ticket aparcado actualmente cargado en el carrito
let currentParkedTicketIndex = null;

// ===== TPVs, agentes y caja =====
let terminals = [];
let currentTerminal = null; // { id, name }

let agents = []; // todos los agentes únicos
let agentsByTerminal = {}; // { idTPV: [agentesDeEseTPV] }
let currentAgent = null; // { id, codagente, name }
let agentNameByCode = {}; // GLOBAL: codagente -> nombre

// intentar recuperar nombres de agentes desde cache al arrancar
loadAgentNameMapFromCache();

let cashSession = {
  open: false,
  openedAt: null,

  // Apertura
  openingTotal: 0,
  openingBreakdown: [],

  // Cierre
  closingTotal: 0,
  closingBreakdown: [],

  // Estado actual de la caja
  currentCashBreakdown: [],

  // Totales de la sesión
  cashSalesTotal: 0,
  cashMovementsTotal: 0,
  totalSales: 0,

  // Resumen por forma de pago
  paymentsByMethod: {},

  // ✅ NUEVO: ledger persistente de pagos reales por caja
  paymentLedger: [],
};

let cashDialogMode = "open"; // "open" (apertura) o "close" (cierre)
let terminalOverlayMode = "session"; // "session" (elegir tpv/agent para abrir caja) o "agentSwitch"

let apiBaseUrl = ""; // base de la API para montar URLs de imágenes
let filesBaseUrl = ""; // base sin /api/3 para los ficheros (MyFiles, etc.)

let qwertyMode = "text"; // "text" | "email"

let TPV_STATE = {
  locked: false, // cuenta desactivada (clients.json active:false)
  offline: false, // sin conexión / sin config / ping falló
  isAdmin: false, // cuenta para ver mas opciones adicionales en el modal opciones
};

let customerMode = "CART";
let customerThanksUntil = 0;
let customerLastSale = null;

// ✅ lo que se verá mientras el carrito real esté vacío tras el cobro
let customerDisplayOverride = null;

// Estado para bloquear cierres
window.__TPV_GUARDS__ = () => {
  const cashOpen = !!(cashSession && cashSession.open);
  const parkedCount = Array.isArray(parkedTickets) ? parkedTickets.length : 0;

  return {
    cashOpen,
    parkedCount,
  };
};

// ===== Referencias básicas =====
const searchInput = document.getElementById("searchInput");
const searchClearBtn = document.getElementById("searchClearBtn");
const searchKeyboardBtn = document.getElementById("searchKeyboardBtn");

// Terminal / caja
const terminalNameEl = document.getElementById("terminalName");
const agentNameEl = document.getElementById("agentName");
const userNameEl = document.getElementById("userName");

// Overlay selección de terminal / agente
const terminalOverlay = document.getElementById("terminalOverlay");
const terminalSelect = document.getElementById("terminalSelect");
const terminalOkBtn = document.getElementById("terminalOkBtn");
const terminalExitBtn = document.getElementById("terminalExitBtn");
const terminalErrorEl = document.getElementById("terminalError");
const terminalSelectWrapper = document.getElementById("terminalSelectWrapper");
const agentSelectWrapper = document.getElementById("agentSelectWrapper");
const agentButtonsOverlay = document.getElementById("agentButtonsOverlay");

// Barra de agentes en la pantalla principal
const mainAgentBar = document.getElementById("mainAgentBar");

// Apertura / cierre de caja
const cashOpenOverlay = document.getElementById("cashOpenOverlay");
const cashOpenTerminalName = document.getElementById("cashOpenTerminalName");
const cashOpenTotalEl = document.getElementById("cashOpenTotal");
const cashHeaderBtn = document.getElementById("cashHeaderBtn");
const cashHeaderLabel = document.getElementById("cashHeaderLabel");

const cashDirectTotalWrap = document.getElementById("cashDirectTotalWrap");
const cashDirectTotalEl = document.getElementById("cashDirectTotal");
const cashDirectTotalKeyboardBtn = document.getElementById(
  "cashDirectTotalKeyboardBtn",
);

// ===== Movimientos de caja =====
const cashMoveOverlay = document.getElementById("cashMoveOverlay");
const cashMoveBtn = document.getElementById("cashMoveBtn");
const cashMoveAmountEl = document.getElementById("cashMoveAmount");
const cashMoveReasonEl = document.getElementById("cashMoveReason");
const cashMoveErrorEl = document.getElementById("cashMoveError");
const cashMoveCancelBtn = document.getElementById("cashMoveCancelBtn");
const cashMoveSaveBtn = document.getElementById("cashMoveSaveBtn");
const cashMoveCloseX = document.getElementById("cashMoveCloseX");

// Resumen de caja (label principal + resumen extendido de cierre)
const cashCloseSummary = document.getElementById("cashCloseSummary");
const sumOpeningEl = document.getElementById("sumOpening");
const sumCashIncomeEl = document.getElementById("sumCashIncome");
const sumMovementsEl = document.getElementById("sumMovements");
const sumExpectedCashEl = document.getElementById("sumExpectedCash");
const sumCountedCashEl = document.getElementById("sumCountedCash");
const sumDifferenceEl = document.getElementById("sumDifference");
const sumTotalSalesEl = document.getElementById("sumTotalSales");

// Cliente actual (input del carrito)
const cartClientInput = document.querySelector(".cart-client-input");

// ===== Funciones auxiliares =====

// ===============================
// Input directo al abrir o cerrar caja
// ===============================

function parseCashDirectAmount(value) {
  const raw = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function formatCashDirectAmount(value) {
  return Number(value || 0)
    .toFixed(2)
    .replace(".", ",");
}

function clearCashBreakdownInputsSilently() {
  if (!cashOpenOverlay) return;

  const inputs = cashOpenOverlay.querySelectorAll(".cash-hidden-input");
  inputs.forEach((inp) => {
    inp.value = "0";
  });

  cashOpenOverlay.querySelectorAll(".cash-qty").forEach((s) => {
    s.textContent = "0";
  });
}

function applyCashDirectTotal(rawValue) {
  let total = null;

  if (typeof rawValue === "number") {
    total = Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : null;
  } else {
    total = parseCashDirectAmount(rawValue);
  }

  if (total == null) {
    toast("Introduce un importe válido.", "warn", "Caja");
    return;
  }

  total = Math.round((Number(total) + Number.EPSILON) * 100) / 100;

  // 1) Limpiar conteo por denominaciones
  clearCashBreakdownInputsSilently();

  // 2) Vaciar breakdowns porque ahora el total es manual/directo
  if (cashDialogMode === "open") {
    cashSession.openingTotal = total;
    cashSession.openingBreakdown = [];
    cashSession.currentCashBreakdown = [];
  } else {
    cashSession.closingTotal = total;
    cashSession.closingBreakdown = [];
  }

  // 3) Refrescar input directo
  if (cashDirectTotalEl) {
    cashDirectTotalEl.value = formatCashDirectAmount(total);
  }

  // 4) Refrescar total principal
  if (cashOpenTotalEl) {
    cashOpenTotalEl.textContent = total.toFixed(2).replace(".", ",") + " €";
  }

  // 5) Si estamos cerrando caja, recalcular resumen
  if (cashDialogMode !== "open") {
    updateCloseSummary(total);
  }
}

function bindCashDirectTotalInput() {
  if (cashDirectTotalKeyboardBtn && !cashDirectTotalKeyboardBtn.dataset.bound) {
    cashDirectTotalKeyboardBtn.dataset.bound = "1";

    cashDirectTotalKeyboardBtn.onclick = () => {
      openNumPad(
        cashDirectTotalEl?.value || "0",
        (value) => {
          const safeValue =
            Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
          applyCashDirectTotal(safeValue);
        },
        "Importe directo",
        "cash",
      );
    };
  }

  if (cashDirectTotalEl && !cashDirectTotalEl.dataset.bound) {
    cashDirectTotalEl.dataset.bound = "1";

    cashDirectTotalEl.onclick = () => {
      openNumPad(
        cashDirectTotalEl?.value || "0",
        (value) => {
          const safeValue =
            Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
          applyCashDirectTotal(safeValue);
        },
        "Importe directo",
        "cash",
      );
    };
  }
}

// ===============================
// ledger storage (guardar metodos de pago en local)
// ===============================

function getCashLedgerStorageKey(cajaId) {
  const id = Number(cajaId || 0) || 0;
  return `tpv_cash_payment_ledger_${id}`;
}

function loadCashLedger(cajaId) {
  const id = Number(cajaId || 0) || 0;
  if (!id) return [];

  try {
    const raw = localStorage.getItem(getCashLedgerStorageKey(id));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveCashLedger(cajaId, entries) {
  const id = Number(cajaId || 0) || 0;
  if (!id) return;

  const safe = Array.isArray(entries) ? entries : [];
  try {
    localStorage.setItem(
      getCashLedgerStorageKey(id),
      JSON.stringify(safe.slice(-5000)),
    );
  } catch (e) {
    console.warn("No se pudo guardar cash ledger:", e);
  }
}

function clearCashLedger(cajaId) {
  const id = Number(cajaId || 0) || 0;
  if (!id) return;

  try {
    localStorage.removeItem(getCashLedgerStorageKey(id));
  } catch {}
}

function loadCashLedgerIntoSession(cajaId) {
  const ledger = loadCashLedger(cajaId);
  cashSession.paymentLedger = ledger;
  return ledger;
}

function appendPaymentsToCashLedger({
  cajaId,
  pagos,
  kind = "sale", // sale | refund
  ticketRef = "",
  source = "runtime", // runtime | offline
  ts = null,
  agentCode = "",
  agentName = "",
}) {
  const id = Number(cajaId || 0) || 0;
  if (!id) return;

  const pagosArr = Array.isArray(pagos) ? pagos : [];
  if (!pagosArr.length) return;

  const ledger = loadCashLedger(id);
  const now = ts || new Date().toISOString();

  const safeAgentCode =
    String(agentCode || currentAgent?.codagente || "").trim() || "—";
  const safeAgentName =
    String(
      agentName || currentAgent?.name || currentAgent?.nick || "",
    ).trim() ||
    getAgentLabel?.(safeAgentCode) ||
    safeAgentCode ||
    "—";

  const entries = pagosArr
    .map((p) => {
      const code = String(p?.codpago || "")
        .trim()
        .toUpperCase();
      if (!code) return null;

      const rawAmount = Number(p?.importe || 0);
      const absAmount =
        Math.round((Math.abs(rawAmount) + Number.EPSILON) * 100) / 100;
      if (!(absAmount > 0)) return null;

      const signedAmount = kind === "refund" ? -absAmount : absAmount;

      return {
        cajaId: id,
        ts: now,
        kind,
        method: code,
        label: String(p?.descripcion || p?.codpago || code).trim(),
        amount: signedAmount,
        ticketRef: String(ticketRef || "").trim(),
        source,

        // ✅ NUEVO
        agentCode: safeAgentCode,
        agentName: safeAgentName,
      };
    })
    .filter(Boolean);

  if (!entries.length) return;

  const next = ledger.concat(entries);
  saveCashLedger(id, next);
  cashSession.paymentLedger = next;
}

function buildPaymentsByMethodFromLedger(cajaId) {
  const id = Number(cajaId || 0) || 0;
  const ledger = loadCashLedger(id);
  const map = {};

  for (const row of ledger) {
    const code =
      String(row?.method || "")
        .trim()
        .toUpperCase() || "—";

    const amount = Number(row?.amount || 0);
    const isRefund = amount < 0;

    if (!map[code]) {
      map[code] = {
        code,
        label: String(row?.label || code).trim() || code,

        total: 0,
        count: 0,

        salesTotal: 0,
        refundTotal: 0,
        salesCount: 0,
        refundCount: 0,
        editCount: 0,
      };
    }

    const m = map[code];

    if (row?.label && String(row.label).trim()) {
      m.label = String(row.label).trim();
    }

    m.total += amount;

    if (isRefund) {
      m.refundTotal += Math.abs(amount);
      m.refundCount += 1;
    } else {
      m.salesTotal += amount;
      m.salesCount += 1;
    }

    m.count = m.salesCount + m.refundCount + m.editCount;
  }

  return map;
}

// ===============================
// Opciones de Color a las familias(grupos)
// ===============================

const FAMILY_COLORS_CFG_KEY = "ui.familyColors";

let familyColorsCache = {};

async function getFamilyColorsMap() {
  try {
    const raw = await window.TPV_CFG?.get?.(FAMILY_COLORS_CFG_KEY);
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveFamilyColorsMap(map) {
  try {
    await window.TPV_CFG?.set?.(FAMILY_COLORS_CFG_KEY, map);
    return true;
  } catch (e) {
    console.warn("No se pudo guardar ui.familyColors:", e);
    return false;
  }
}

async function reloadFamilyColorsCache() {
  familyColorsCache = await getFamilyColorsMap();
}

function getFamilyColorSync(familyId) {
  return familyColorsCache?.[String(familyId)] || "";
}

function getContrastTextColor(hex) {
  if (!hex) return "#111827";

  const c = hex.replace("#", "");
  const full =
    c.length === 3
      ? c
          .split("")
          .map((x) => x + x)
          .join("")
      : c;

  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111827" : "#ffffff";
}

function normalizeHexColor(hex) {
  const value = String(hex || "").trim();
  if (!value) return "#ffffff";

  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;

  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return (
      "#" +
      value[1] +
      value[1] +
      value[2] +
      value[2] +
      value[3] +
      value[3]
    ).toLowerCase();
  }

  return "#ffffff";
}

// ===============================
// Opciones de pantalla del cliente en opciones
// ===============================
async function loadCustomerDisplayToggle() {
  const el = document.getElementById("customerDisplayToggle");
  if (!el || !window.TPV_CUSTOMER_CTRL?.getEnabled) return;

  try {
    const r = await window.TPV_CUSTOMER_CTRL.getEnabled();
    if (r?.ok) {
      el.checked = !!r.enabled;
    }
  } catch (e) {
    console.error("[OPTIONS] load customer display failed:", e);
  }
}

let customerDisplayToggleBound = false;

function bindCustomerDisplayToggleOnce() {
  if (customerDisplayToggleBound) return;
  customerDisplayToggleBound = true;

  const el = document.getElementById("customerDisplayToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    const wanted = !!el.checked;

    try {
      const r = await window.TPV_CUSTOMER_CTRL?.setEnabled?.(wanted);

      if (!r?.ok) {
        el.checked = !wanted;
        console.error("[OPTIONS] set customer display failed:", r?.error);
        return;
      }

      el.checked = !!r.enabled;
    } catch (e) {
      el.checked = !wanted;
      console.error("[OPTIONS] set customer display error:", e);
    }
  });
}

// ===============================
// Opciones de Terminal, elegir grupos ocultos para cada terminal
// ===============================

const TERMINAL_FAMILY_HIDDEN_CFG_KEY = "ui.terminalFamilyHidden";

let terminalFamiliesDraftHiddenMap = {};
let terminalFamiliesCurrentTerminalId = null;
let terminalFamilyHiddenCache = {};

async function getTerminalFamilyHiddenMap() {
  try {
    const raw = await window.TPV_CFG?.get?.(TERMINAL_FAMILY_HIDDEN_CFG_KEY);
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveTerminalFamilyHiddenMap(map) {
  try {
    await window.TPV_CFG?.set?.(TERMINAL_FAMILY_HIDDEN_CFG_KEY, map);
    return true;
  } catch (e) {
    console.warn("No se pudo guardar ui.terminalFamilyHidden:", e);
    return false;
  }
}

async function reloadTerminalFamilyHiddenCache() {
  terminalFamilyHiddenCache = await getTerminalFamilyHiddenMap();
}

function getHiddenCategoryIdsForTerminalSync(terminalId) {
  const key = String(terminalId || "");
  const arr = Array.isArray(terminalFamilyHiddenCache[key])
    ? terminalFamilyHiddenCache[key]
    : [];
  return new Set(arr.map(String));
}

function getAllCategoriesSorted() {
  return [...(categories || [])].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "es"),
  );
}

async function openTerminalFamiliesDialog() {
  const overlay = document.getElementById("terminalFamiliesOverlay");
  const select = document.getElementById("terminalFamiliesSelect");
  if (!overlay || !select) return;

  terminalFamiliesDraftHiddenMap = await getTerminalFamilyHiddenMap();
  terminalFamiliesDraftModeMap = await getTerminalFamilyModeMap();

  select.innerHTML = "";
  (terminals || []).forEach((t) => {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = t.name || `TPV ${t.id}`;
    select.appendChild(opt);
  });

  terminalFamiliesCurrentTerminalId = String(
    currentTerminal?.id || terminals?.[0]?.id || "",
  );

  if (terminalFamiliesCurrentTerminalId) {
    select.value = terminalFamiliesCurrentTerminalId;
  }

  renderTerminalFamiliesModeUi();
  renderTerminalFamiliesList();
  overlay.classList.remove("hidden");
}

function closeTerminalFamiliesDialog() {
  const overlay = document.getElementById("terminalFamiliesOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
}

function renderTerminalFamiliesList() {
  const listEl = document.getElementById("terminalFamiliesList");
  const select = document.getElementById("terminalFamiliesSelect");
  if (!listEl || !select) return;

  const terminalId = String(select.value || "");
  terminalFamiliesCurrentTerminalId = terminalId;

  listEl.innerHTML = "";

  const allCats = getAllCategoriesSorted();
  const rootCats = allCats.filter((c) => !c.parentId);

  const hiddenIds = Array.isArray(terminalFamiliesDraftHiddenMap[terminalId])
    ? terminalFamiliesDraftHiddenMap[terminalId].map(String)
    : [];

  const hiddenSet = new Set(hiddenIds);

  const getChildren = (parentId) =>
    allCats.filter((c) => String(c.parentId || "") === String(parentId));

  const buildSwitch = (checked, onChange) => {
    const label = document.createElement("label");
    label.className = "switch";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", onChange);

    const slider = document.createElement("span");
    slider.className = "slider";

    label.appendChild(input);
    label.appendChild(slider);
    return label;
  };

  const updateHiddenForTerminal = (catId, visible) => {
    const currentHidden = new Set(
      Array.isArray(terminalFamiliesDraftHiddenMap[terminalId])
        ? terminalFamiliesDraftHiddenMap[terminalId].map(String)
        : [],
    );

    if (visible) currentHidden.delete(String(catId));
    else currentHidden.add(String(catId));

    const arr = Array.from(currentHidden);

    if (!arr.length) delete terminalFamiliesDraftHiddenMap[terminalId];
    else terminalFamiliesDraftHiddenMap[terminalId] = arr;
  };

  const buildColorPicker = (catId) => {
    const wrap = document.createElement("div");
    wrap.className = "family-color-wrap";

    const colorBtn = document.createElement("button");
    colorBtn.type = "button";
    colorBtn.className = "family-color-btn";

    const currentColor = getFamilyColorSync(catId) || "#ffffff";
    colorBtn.style.background = currentColor;
    colorBtn.title = "Cambiar color de la familia";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "family-color-input";
    colorInput.value = normalizeHexColor(currentColor);

    colorBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      colorInput.click();
    });

    colorInput.addEventListener("input", (e) => {
      const nextColor = String(e.target.value || "").trim();
      colorBtn.style.background = nextColor;
      familyColorsCache[String(catId)] = nextColor;
    });

    wrap.appendChild(colorBtn);
    wrap.appendChild(colorInput);

    return wrap;
  };

  rootCats.forEach((root) => {
    const card = document.createElement("div");
    card.className = "terminal-family-card";

    const rootRow = document.createElement("div");
    rootRow.className = "terminal-family-item terminal-family-item-root";

    const rootText = document.createElement("div");
    rootText.className = "terminal-family-item-text";

    const rootTitle = document.createElement("div");
    rootTitle.className = "terminal-family-item-title";
    rootTitle.textContent = root.name;

    rootText.appendChild(rootTitle);

    const rootVisible = !hiddenSet.has(String(root.id));

    const rootActions = document.createElement("div");
    rootActions.className = "terminal-family-actions";

    const rootColor = buildColorPicker(root.id);

    const rootSwitch = buildSwitch(rootVisible, (e) => {
      const nextVisible = e.target.checked;

      const children = getChildren(root.id);
      const currentHidden = new Set(
        Array.isArray(terminalFamiliesDraftHiddenMap[terminalId])
          ? terminalFamiliesDraftHiddenMap[terminalId].map(String)
          : [],
      );

      if (nextVisible) {
        currentHidden.delete(String(root.id));
        children.forEach((child) => currentHidden.delete(String(child.id)));
      } else {
        currentHidden.add(String(root.id));
        children.forEach((child) => currentHidden.add(String(child.id)));
      }

      const arr = Array.from(currentHidden);

      if (!arr.length) delete terminalFamiliesDraftHiddenMap[terminalId];
      else terminalFamiliesDraftHiddenMap[terminalId] = arr;

      renderTerminalFamiliesList();
    });

    rootActions.appendChild(rootColor);
    rootActions.appendChild(rootSwitch);

    rootRow.appendChild(rootText);
    rootRow.appendChild(rootActions);
    card.appendChild(rootRow);

    if (rootVisible) {
      const children = getChildren(root.id);

      if (children.length) {
        const childrenWrap = document.createElement("div");
        childrenWrap.className = "terminal-family-children";

        children.forEach((child) => {
          const childRow = document.createElement("div");
          childRow.className = "terminal-family-item terminal-family-item-sub";

          const childText = document.createElement("div");
          childText.className = "terminal-family-item-text";

          const childTitle = document.createElement("div");
          childTitle.className = "terminal-family-item-title";
          childTitle.textContent = child.name;

          childText.appendChild(childTitle);

          const childVisible = !hiddenSet.has(String(child.id));

          const childActions = document.createElement("div");
          childActions.className = "terminal-family-actions";

          const childColor = buildColorPicker(child.id);

          const childSwitch = buildSwitch(childVisible, (e) => {
            updateHiddenForTerminal(child.id, e.target.checked);
            renderTerminalFamiliesList();
          });

          childActions.appendChild(childColor);
          childActions.appendChild(childSwitch);

          childRow.appendChild(childText);
          childRow.appendChild(childActions);
          childrenWrap.appendChild(childRow);
        });

        card.appendChild(childrenWrap);
      }
    }

    listEl.appendChild(card);
  });
}

async function saveTerminalFamiliesDialog() {
  const okHidden = await saveTerminalFamilyHiddenMap(
    terminalFamiliesDraftHiddenMap,
  );
  const okMode = await saveTerminalFamilyModeMap(terminalFamiliesDraftModeMap);
  const okColors = await saveFamilyColorsMap(familyColorsCache);

  if (!okHidden || !okMode || !okColors) {
    toast?.("No se pudo guardar la configuración.", "err", "Familias");
    return;
  }

  terminalFamilyHiddenCache = { ...terminalFamiliesDraftHiddenMap };
  terminalFamilyModeCache = { ...terminalFamiliesDraftModeMap };

  closeTerminalFamiliesDialog();

  if (typeof renderMainUI === "function") renderMainUI(true);
  if (typeof renderCategories === "function") renderCategories();
  if (typeof renderProducts === "function") renderProducts();

  toast?.("Configuración guardada.", "ok", "Familias");
}

function setupTerminalFamiliesUi() {
  const openBtn = document.getElementById("optionsTerminalFamiliesBtn");
  const closeX = document.getElementById("terminalFamiliesCloseX");
  const cancelBtn = document.getElementById("terminalFamiliesCancelBtn");
  const saveBtn = document.getElementById("terminalFamiliesSaveBtn");
  const select = document.getElementById("terminalFamiliesSelect");
  const modeToggle = document.getElementById("terminalFamiliesShowAllToggle");
  const checkAllBtn = document.getElementById("terminalFamiliesCheckAllBtn");
  const uncheckAllBtn = document.getElementById(
    "terminalFamiliesUncheckAllBtn",
  );

  if (openBtn && openBtn.dataset.bound !== "1") {
    openBtn.dataset.bound = "1";
    openBtn.addEventListener("click", openTerminalFamiliesDialog);
  }

  if (closeX && closeX.dataset.bound !== "1") {
    closeX.dataset.bound = "1";
    closeX.addEventListener("click", closeTerminalFamiliesDialog);
  }

  if (cancelBtn && cancelBtn.dataset.bound !== "1") {
    cancelBtn.dataset.bound = "1";
    cancelBtn.addEventListener("click", closeTerminalFamiliesDialog);
  }

  if (saveBtn && saveBtn.dataset.bound !== "1") {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", saveTerminalFamiliesDialog);
  }

  if (select && select.dataset.bound !== "1") {
    select.dataset.bound = "1";
    select.addEventListener("change", () => {
      renderTerminalFamiliesModeUi();
      renderTerminalFamiliesList();
    });
  }
  if (modeToggle && modeToggle.dataset.bound !== "1") {
    modeToggle.dataset.bound = "1";
    modeToggle.addEventListener("change", () => {
      const terminalId = String(
        document.getElementById("terminalFamiliesSelect")?.value || "",
      );
      if (!terminalId) return;

      terminalFamiliesDraftModeMap[terminalId] = modeToggle.checked
        ? "all"
        : "filtered";
    });
  }

  if (checkAllBtn && checkAllBtn.dataset.bound !== "1") {
    checkAllBtn.dataset.bound = "1";
    checkAllBtn.addEventListener("click", () => {
      const terminalId = String(
        document.getElementById("terminalFamiliesSelect")?.value || "",
      );
      if (!terminalId) return;

      delete terminalFamiliesDraftHiddenMap[terminalId];
      renderTerminalFamiliesList();
    });
  }

  if (uncheckAllBtn && uncheckAllBtn.dataset.bound !== "1") {
    uncheckAllBtn.dataset.bound = "1";
    uncheckAllBtn.addEventListener("click", () => {
      const terminalId = String(
        document.getElementById("terminalFamiliesSelect")?.value || "",
      );
      if (!terminalId) return;

      terminalFamiliesDraftHiddenMap[terminalId] = (categories || []).map((c) =>
        String(c.id),
      );

      renderTerminalFamiliesList();
    });
  }
}

// OJO:
// Los grupos visibles del TPV siempre obedecen a los grupos ocultos.
// El modo "all" solo afecta a los PRODUCTOS, no a los botones de categorías.
function getVisibleCategoriesForCurrentTerminal() {
  const terminalId = currentTerminal?.id;
  const hiddenSet = getHiddenCategoryIdsForTerminalSync(terminalId);

  if (!hiddenSet.size) return categories || [];

  return (categories || []).filter((cat) => {
    return !hiddenSet.has(String(cat.id));
  });
}

const TERMINAL_FAMILY_MODE_CFG_KEY = "ui.terminalFamilyMode";

let terminalFamiliesDraftModeMap = {};
let terminalFamilyModeCache = {};

async function getTerminalFamilyModeMap() {
  try {
    const raw = await window.TPV_CFG?.get?.(TERMINAL_FAMILY_MODE_CFG_KEY);
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveTerminalFamilyModeMap(map) {
  try {
    await window.TPV_CFG?.set?.(TERMINAL_FAMILY_MODE_CFG_KEY, map);
    return true;
  } catch (e) {
    console.warn("No se pudo guardar ui.terminalFamilyMode:", e);
    return false;
  }
}

async function reloadTerminalFamilyModeCache() {
  terminalFamilyModeCache = await getTerminalFamilyModeMap();
}

function getTerminalModeSync(terminalId) {
  const key = String(terminalId || "");
  return terminalFamilyModeCache[key] === "all" ? "all" : "filtered";
}

function renderTerminalFamiliesModeUi() {
  const select = document.getElementById("terminalFamiliesSelect");
  const toggle = document.getElementById("terminalFamiliesShowAllToggle");
  if (!select || !toggle) return;

  const terminalId = String(select.value || "");
  const mode =
    terminalFamiliesDraftModeMap[terminalId] === "all" ? "all" : "filtered";

  toggle.checked = mode === "all";
}

// ===============================
// Failsafe, agente tiene que estar siempre asignado.
// ===============================
function hasAssignedAgent() {
  return !!(currentAgent && String(currentAgent.codagente || "").trim());
}

async function requireAssignedAgentOrBlock({ showModal = true } = {}) {
  if (hasAssignedAgent()) return true;

  // aviso constante (si quieres) + bloqueo acción
  if (showModal) {
    await confirmModal(
      "Falta Agente",
      "No hay un agente asignado a este terminal.\n\nSelecciona un agente para poder cobrar.",
    );
  }

  // abre selector directamente (si te interesa)
  try {
    await refreshTerminalsAndAgents?.();
  } catch {}
  try {
    showTerminalOverlay?.("agentSwitch");
  } catch {}

  // ✅ refresca UI tras intentar abrir overlay
  refreshAgentGuardUI?.();

  return false;
}

function updatePayButtonEnabledState() {
  const btn = document.getElementById("payBtn");
  if (!btn) return;

  const hasCart = !!(cart && cart.length);
  const hasCaja = !!cashSession?.open;
  const hasTpv = !!currentTerminal?.id;
  const hasAgent = hasAssignedAgent();

  const disabled = !hasCaja || !hasTpv || !hasCart || !hasAgent;
  btn.disabled = disabled;

  if (!hasCaja) btn.title = "Abre la caja para poder cobrar";
  else if (!hasTpv) btn.title = "Selecciona un terminal";
  else if (!hasAgent) btn.title = "Falta agente asignado";
  else if (!hasCart) btn.title = "Añade productos antes de cobrar";
  else btn.title = "";
}

function renderAgentMissingBadge() {
  const b = document.getElementById("agentMissingBadge");
  if (!b) return;
  b.style.display = hasAssignedAgent() ? "none" : "inline";
}

function refreshAgentGuardUI() {
  renderAgentMissingBadge?.();
  updatePayButtonEnabledState?.();
}

// ===============================
// Click en nombre del terminal (cambio rápido SOLO terminal)
// ===============================
function setTerminalNameClickable(isClickable) {
  if (!terminalNameEl) return;

  if (isClickable) {
    terminalNameEl.style.cursor = "pointer";
    terminalNameEl.style.textDecoration = "underline";
    terminalNameEl.title = "Cambiar terminal";
  } else {
    terminalNameEl.style.cursor = "";
    terminalNameEl.style.textDecoration = "";
    terminalNameEl.title = "";
  }
}

// Estado inicial (por si terminals ya está cargado)
setTerminalNameClickable(Array.isArray(terminals) && terminals.length > 1);

if (terminalNameEl) {
  terminalNameEl.addEventListener("click", async () => {
    // Refrescar datos antes de decidir
    await refreshTerminalsAndAgents();

    const canSwitch = Array.isArray(terminals) && terminals.length > 1;
    setTerminalNameClickable(canSwitch);

    // Si hay 0/1 terminal: no hacemos nada (y ni siquiera parece botón)
    if (!canSwitch) return;

    // Abrimos overlay en modo "solo cambiar terminal"
    showTerminalOverlay("terminalSwitch");
  });
}

/*----------------------*/
/* Inicio pagos con ofertas variables */
/*----------------------*/

async function apiUpdateLineaFacturaCliente(idlinea, payload) {
  const id = Number(idlinea || 0);
  if (!id) throw new Error("idlinea inválido");
  try {
    return await apiWrite(`lineafacturaclientes/${id}`, "PATCH", payload);
  } catch {
    return await apiWrite(`lineafacturaclientes/${id}`, "PUT", payload);
  }
}

async function apiDeleteLineaFacturaCliente(idlinea) {
  const id = Number(idlinea || 0);
  if (!id) throw new Error("idlinea inválido");
  return await apiWrite(`lineafacturaclientes/${id}`, "DELETE", {});
}

function buildDesiredPackQtyByIdProducto(cartSnapshot) {
  const out = {}; // { [idproducto]: qty }
  const arr = Array.isArray(cartSnapshot) ? cartSnapshot : [];

  for (const it of arr) {
    if (!it?.meta?.includedInPack) continue;

    const idp = Number(it.baseProductId || it.id || 0);
    if (!idp) continue;

    const q = Number(it.qty || 0);
    out[idp] = (out[idp] ?? 0) + q;
  }

  return out;
}

async function patchPackChildrenLinesInFacturaByDesired({
  idfactura,
  desiredByPid,
}) {
  const desiredRaw =
    desiredByPid && typeof desiredByPid === "object" ? desiredByPid : {};

  if (!idfactura) return;

  const isZero = (n) => Math.abs(Number(n || 0)) < 0.00001;

  // normaliza desired => Map(pid -> want)
  const desired = new Map();
  for (const [k, v] of Object.entries(desiredRaw)) {
    const pid = Number(k);
    if (!pid) continue;
    const want = Number(v ?? 0);
    desired.set(pid, want);
  }

  const raw = await fetchLineasFacturaCliente(idfactura);
  const lines = Array.isArray(raw) ? raw : [];

  // Hijos gratis (0€) que NO sean el pack parent
  const free = lines.filter((l) => {
    const unit = Number(l?.pvpunitario ?? 0);
    if (!isZero(unit)) return false;

    const pid = Number(l?.idproducto || 0);
    if (
      pid &&
      typeof isOfferPackProductById === "function" &&
      isOfferPackProductById(pid)
    ) {
      return false;
    }
    return true;
  });

  // Agrupar por idproducto
  const byPid = new Map();
  for (const l of free) {
    const pid = Number(l?.idproducto || 0);
    if (!pid) continue;
    if (!byPid.has(pid)) byPid.set(pid, []);
    byPid.get(pid).push(l);
  }

  // 1) borrar hijos gratis que ya no deben existir
  for (const [pid, group] of byPid.entries()) {
    if (!desired.has(pid)) {
      for (const ln of group) {
        await apiDeleteLineaFacturaCliente(ln.idlinea).catch(() => {});
      }
    }
  }

  // 2) aplicar cantidades deseadas
  for (const [pid, wantRaw] of desired.entries()) {
    const want = Number(wantRaw ?? 0);
    const group = byPid.get(pid) || [];

    if (!group.length) continue;

    if (want === 0) {
      for (const ln of group) {
        await apiDeleteLineaFacturaCliente(ln.idlinea).catch(() => {});
      }
      continue;
    }

    const main = group[0];

    const currentQty = Number(main?.cantidad || 0);
    const currentPvp = Number(main?.pvpunitario || 0);
    const currentRecargo = Number(main?.recargo || 0);
    const currentPvpSinDto = Number(main?.pvpsindto || 0);
    const currentPvpTotal = Number(main?.pvptotal || 0);

    const needsUpdate =
      currentQty !== want ||
      !isZero(currentPvp) ||
      !isZero(currentRecargo) ||
      !isZero(currentPvpSinDto) ||
      !isZero(currentPvpTotal);

    if (needsUpdate) {
      // intento fuerte: dejar todo monetario a cero
      await apiUpdateLineaFacturaCliente(main.idlinea, {
        cantidad: want,
        pvpunitario: 0,
        pvpsindto: 0,
        pvptotal: 0,
        recargo: 0,
        dtopor: 0,
        dtopor2: 0,
      }).catch(async () => {
        // fallback 1
        await apiUpdateLineaFacturaCliente(main.idlinea, {
          cantidad: want,
          pvpunitario: 0,
          recargo: 0,
        }).catch(async () => {
          // fallback 2 mínimo
          await apiUpdateLineaFacturaCliente(main.idlinea, {
            cantidad: want,
            pvpunitario: 0,
          }).catch(() => {});
        });
      });
    }

    // borrar duplicadas
    for (let i = 1; i < group.length; i++) {
      await apiDeleteLineaFacturaCliente(group[i].idlinea).catch(() => {});
    }
  }
}

/* =============================================================
   Normaliza líneas de FacturaScripts -> formato “línea TPV”
   (para que tu diseño de ticket no se rompa)
   ============================================================= */
function mapFsLineToTpvPrintLine(l) {
  const qty = Number(l?.cantidad ?? l?.qty ?? 0);

  // Tu ticket suele usar getUnitGross(item). Para históricos no lo tienes,
  // así que guardamos un campo unitGross “directo” si tu print lo soporta.
  // Si tu print usa otra cosa, mantenemos pvpunitario y ya.
  const unitNet = Number(l?.pvpunitario ?? 0);

  return {
    // campos típicos TPV
    qty: qty,
    name: String(l?.descripcion || "").trim() || "Producto",
    referencia: String(l?.referencia || "").trim() || "-",

    // para impresión / totales
    pvpunitario: unitNet, // normalmente neto en FS (según tu API)
    codimpuesto: l?.codimpuesto || "",

    // opcional: idproducto si lo usas en el render
    id: Number(l?.idproducto || 0) || undefined,
    idproducto: Number(l?.idproducto || 0) || undefined,

    // marca para depurar
    _fromFS: true,
  };
}

/*----------------------*/
/* Inicio Cambiar Clientes */
/*----------------------*/

function renderSelectedCustomerInCartHeader(c) {
  const input = document.getElementById("cartCustomerInput");
  const btnClear = document.getElementById("cartCustomerClear");

  const nom = String(c?.nombre || "Ventas tickets");

  if (input) input.value = nom;

  const isDefault = !!c?.isDefault;
  if (btnClear) btnClear.style.display = isDefault ? "none" : "";
}

function bindCartCustomerUiEvents() {
  const input = document.getElementById("cartCustomerInput");
  const btnOpen = document.getElementById("cartCustomerOpen");
  const btnClear = document.getElementById("cartCustomerClear");

  const open = () => window.CUSTOMER_SELECTOR?.open?.();

  if (input) input.addEventListener("click", open);
  if (btnOpen) btnOpen.addEventListener("click", open);

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      window.CUSTOMER_SELECTOR?.resetToDefault?.();
    });
  }
}

let __customerSelectorInited = false;

async function initCustomerSelectorOnce() {
  if (__customerSelectorInited) return;
  __customerSelectorInited = true;

  const cfg = window.RECIPOK_API || {};
  const baseUrl = String(cfg.baseUrl || "").replace(/\/+$/, "");
  const apiKey = String(cfg.apiKey || "").trim();

  if (!window.CUSTOMER_SELECTOR?.mount) {
    console.error(
      "CUSTOMER_SELECTOR no está cargado (falta script en index.html).",
    );
    return;
  }

  // demo/offline: deja default 1
  if (!baseUrl || !apiKey) {
    renderSelectedCustomerInCartHeader({
      codcliente: "1",
      nombre: "Ventas tickets",
      isDefault: true,
    });
    return;
  }

  await window.CUSTOMER_SELECTOR.mount({
    baseUrl,
    apiKey,
    defaultCodcliente: "1",
    onChange: (c) => renderSelectedCustomerInCartHeader(c),
    debug: false,
  });

  // ✅ bind del botón guardar (una vez)
  bindTerminalDefaultCustomerSave();

  // ✅ si ya hay terminal seleccionado, aplicar default YA
  if (currentTerminal?.id) {
    await applyTerminalDefaultCustomer();
  }
}

async function loadClientesForTerminalSelect() {
  // 1) Intento online
  try {
    const data = await fetchApiResource("clientes");
    if (Array.isArray(data)) {
      const list = data
        .filter((c) => !c?.debaja)
        .map((c) => ({
          codcliente: String(c.codcliente || "").trim(),
          nombre: String(c.nombre || "").trim(),
        }))
        .filter((c) => c.codcliente);

      list.sort((a, b) => Number(a.codcliente) - Number(b.codcliente));
      return list;
    }
  } catch (e) {
    // seguimos abajo
  }

  // 2) Fallback offline: memoria del selector
  const mem = window.CUSTOMER_SELECTOR?.listCustomers?.();
  if (Array.isArray(mem) && mem.length) {
    return mem.map((c) => ({
      codcliente: String(c.codcliente || "").trim(),
      nombre: String(c.nombre || "").trim(),
    }));
  }

  // 3) Último fallback: solo el default
  return [{ codcliente: "1", nombre: "Ventas tickets" }];
}

async function renderTerminalDefaultCustomerSelect() {
  const sel = document.getElementById("terminalDefaultCustomerSelect");
  if (!sel) return;

  if (!currentTerminal?.id) {
    sel.innerHTML = `<option value="">(sin terminal)</option>`;
    sel.disabled = true;
    return;
  }

  sel.disabled = false;
  sel.innerHTML = `<option value="">Cargando...</option>`;

  let clientes = [];
  try {
    clientes = await loadClientesForTerminalSelect();
  } catch {}

  const curCod = String(currentTerminal?.codcliente || "1");

  try {
    if (!clientes.length) {
      sel.innerHTML = `<option value="${escapeHtml(curCod)}">${escapeHtml(curCod)} | (sin lista offline)</option>`;
      sel.disabled = false; // permite guardar a cola
      return;
    }

    sel.innerHTML = clientes
      .map((c) => {
        const label = `${c.codcliente} | ${c.nombre || "—"}`;
        const selected = String(c.codcliente) === curCod ? "selected" : "";
        return `<option value="${escapeHtml(c.codcliente)}" ${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
  } catch (e) {
    // último fallback ultra seguro
    sel.innerHTML = `<option value="${curCod}">${curCod}</option>`;
    sel.disabled = false;
  }
}

function isNetworkError(e) {
  const msg = String(e?.message || e || "");
  return (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("network") ||
    msg.includes("timeout")
  );
}

async function fetchTpvTerminalByIdtpv(idtpv) {
  const data = await fetchApiResourceWithParams("tpvterminales", {
    "filter[idtpv]": String(idtpv),
    limit: 1,
  });
  return Array.isArray(data) ? data[0] : null;
}

function toFormUrlEncoded(obj) {
  const sp = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    sp.append(k, String(v));
  });
  return sp.toString();
}

async function updateTpvTerminalForm(idtpv, patch) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Sin config API");

  const base = String(cfg.baseUrl).replace(/\/+$/, "");
  const url = `${base}/tpvterminales/${encodeURIComponent(String(idtpv))}`;

  const body = toFormUrlEncoded(patch || {});
  if (!body) throw new Error("Patch vacío");

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Token: cfg.apiKey,
    },
    body,
  });

  if (res.status === 429) throw new Error("API 429 (demasiadas peticiones)");

  // A veces FS devuelve JSON, a veces vacío. Lo manejamos.
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      (typeof data === "string" ? data : "") ||
      `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  if (data && data.status === "error") {
    throw new Error(data.message || "Error API");
  }

  return data;
}

let __terminalDefaultCustomerBound = false;

function bindTerminalDefaultCustomerSave() {
  if (__terminalDefaultCustomerBound) return;
  __terminalDefaultCustomerBound = true;

  const btn = document.getElementById("terminalDefaultCustomerSaveBtn");
  const sel = document.getElementById("terminalDefaultCustomerSelect");
  if (!btn || !sel) return;

  btn.addEventListener("click", async () => {
    if (!currentTerminal?.id) {
      toast("No hay terminal seleccionado.", "warn", "Cliente terminal");
      return;
    }

    const cod = String(sel.value || "").trim();
    if (!cod) {
      toast("Selecciona un cliente válido.", "warn", "Cliente terminal");
      return;
    }

    btn.disabled = true;

    try {
      // ✅ PUT form-urlencoded SOLO con codcliente
      await updateTpvTerminalForm(currentTerminal.id, { codcliente: cod });

      // runtime + aplicar al selector del carrito
      currentTerminal.codcliente = cod;
      await applyTerminalDefaultCustomer();

      toast("Cliente por defecto actualizado ✅", "ok", "Cliente terminal");
    } catch (e) {
      if (isNetworkError(e)) {
        // solo aquí cola
        try {
          await window.TPV_QUEUE?.enqueue?.({
            type: "tpvterminal.setCodcliente",
            idtpv: String(currentTerminal.id),
            codcliente: cod,
            createdAt: new Date().toISOString(),
          });
        } catch {}

        toast(
          "Sin conexión: cambio guardado en cola ✅ (se aplicará al volver internet)",
          "warn",
          "Cliente terminal",
        );
      } else {
        toast(
          "No se pudo guardar: " + (e?.message || e),
          "err",
          "Cliente terminal",
        );
      }
    } finally {
      btn.disabled = false;
    }
  });
}

/**
 * Aplica el codcliente por defecto del terminal al selector de clientes del carrito.
 * opts:
 *  - forceReset: si true, vuelve al default aunque el usuario haya elegido manualmente otro.
 *  - reason: string para log
 */
async function applyTerminalDefaultCustomer(opts = {}) {
  const { forceReset = false, reason = "unknown" } = opts;
  const selected =
    typeof window.CUSTOMER_SELECTOR.getSelectedCustomer === "function"
      ? window.CUSTOMER_SELECTOR.getSelectedCustomer()
      : null;

  const isDefaultNow = !!selected?.isDefault;

  if (!currentTerminal?.id) return;

  // Si no hay selector, no hay nada que aplicar
  if (!window.CUSTOMER_SELECTOR) return;

  try {
    // Si offline, no intentes API
    if (TPV_STATE?.offline) throw new Error("offline");

    const term = await fetchTpvTerminalByIdtpv(currentTerminal.id);
    const cod = String(term?.codcliente || "").trim() || "1";

    // runtime
    currentTerminal.codcliente = cod;

    // set default cod en selector (esto NO cambia selección manual por sí solo)
    window.CUSTOMER_SELECTOR.setDefaultCodcliente?.(cod);

    // si quieres forzar reset o si está actualmente en default, resetea
    const selected = window.CUSTOMER_SELECTOR.getSelectedCustomer?.();
    const isDefaultNow = !!selected?.isDefault;

    if (forceReset || isDefaultNow) {
      window.CUSTOMER_SELECTOR.resetToDefault?.();
    }

    // repinta el select de opciones (usa tu función que ya hace fallback a CUSTOMER_SELECTOR si offline)
    await renderTerminalDefaultCustomerSelect?.();
  } catch (e) {
    // fallback sin romper
    const cod = String(currentTerminal.codcliente || "1").trim() || "1";
    window.CUSTOMER_SELECTOR.setDefaultCodcliente?.(cod);

    // en fallback NO fuerces reset salvo que te lo pidan
    const selected = window.CUSTOMER_SELECTOR.getSelectedCustomer?.();
    const isDefaultNow = !!selected?.isDefault;
    if (forceReset || isDefaultNow) {
      window.CUSTOMER_SELECTOR.resetToDefault?.();
    }

    await renderTerminalDefaultCustomerSelect?.().catch(() => {});
    // Log suave (evita ruido)
    // console.warn("[applyTerminalDefaultCustomer]", reason, e?.message || e);
  }
}

const __TDC__ = {
  inFlight: false,
  lastAt: 0,
  timer: null,
};

/**
 * Refresca codcliente por defecto del terminal desde FS y lo aplica al selector.
 * - No spamea API (throttle)
 * - No pisa selección manual (si forceReset=false)
 */
async function maybeRefreshTerminalDefaultCustomer(
  reason = "unknown",
  opts = {},
) {
  const {
    force = false,
    minIntervalMs = 4000,
    forceReset = false, // si true: reset a default sí o sí
  } = opts;

  if (!currentTerminal?.id)
    return { ok: false, skipped: true, why: "no-terminal" };

  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey)
    return { ok: false, skipped: true, why: "no-api-config" };

  // si estás marcado offline y no forces, no pegues a FS
  if (TPV_STATE?.offline && !force)
    return { ok: false, skipped: true, why: "offline" };

  const now = Date.now();

  // throttle con "debounce" de cola
  if (!force && now - __TDC__.lastAt < minIntervalMs) {
    clearTimeout(__TDC__.timer);
    __TDC__.timer = setTimeout(() => {
      // re-chequea offline antes de llamar
      if (TPV_STATE?.offline) return;
      maybeRefreshTerminalDefaultCustomer("debounced:" + reason, {
        force: true,
        forceReset,
      }).catch(() => {});
    }, minIntervalMs);
    return { ok: false, skipped: true, why: "throttled" };
  }

  if (__TDC__.inFlight) return { ok: false, skipped: true, why: "in-flight" };

  __TDC__.inFlight = true;
  __TDC__.lastAt = now;

  try {
    await applyTerminalDefaultCustomer({ forceReset, reason });
    return { ok: true };
  } catch (e) {
    console.warn("[TDC] refresh failed:", reason, e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  } finally {
    __TDC__.inFlight = false;
  }
}

/*----------------------*/
/* Fin Cambiar Clientes */
/*----------------------*/

function _normTxt(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isPackChildForPrint(l) {
  // 1) si viene meta desde carrito
  if (l?.meta?.includedInPack) return true;

  // 2) si lo marcaste en buildFsLinesFromCart (recomendado)
  if (l?.__isPackChild) return true;

  // 3) fallback por texto (por si viene de FS reconstruido)
  const d = String(l?.descripcion || l?.desc || "").trim();
  return d.startsWith("↳") || d.startsWith("└") || d.startsWith("↓");
}

function isPackParentForPrint(l) {
  if (l?.meta?.isPackOffer) return true;
  if (l?.__isPackParent) return true;

  // fallback por texto (si en algún momento lo marcas)
  const d = String(l?.descripcion || "").toLowerCase();
  return d.includes("pack") && d.includes("oferta");
}

function customerSetMode(mode, opts = {}) {
  customerMode = String(mode || "CART").toUpperCase();

  if (customerMode === "THANKS") {
    const ttlMs = Number(opts.ttlMs ?? 12000);
    customerThanksUntil = Date.now() + Math.max(1000, ttlMs);

    // ✅ si opts.items viene ya en formato "customer items", ok.
    // Si viene del carrito, mejor regenerar desde cart para asegurar ocultar hijos.
    const safeItems =
      Array.isArray(opts.items) && opts.items.length
        ? opts.items
        : buildCustomerItemsFromCart(cart);

    customerLastSale = {
      total: Number(opts.total ?? 0),
      ticket: opts.ticket ? String(opts.ticket) : "",
      paymentMethod: opts.paymentMethod ? String(opts.paymentMethod) : "",
      agent: opts.agent ? String(opts.agent) : "",
      ts: Date.now(),
      items: safeItems,
    };

    customerDisplayOverride = {
      items: customerLastSale.items,
      total: customerLastSale.total,
    };
  }

  pushCustomerState();
}

function customerTickThanksExpiry() {
  if (customerMode === "THANKS" && Date.now() > (customerThanksUntil || 0)) {
    customerMode = "CART"; // ✅ ocultar notice
    customerThanksUntil = 0;
    pushCustomerState();
  }
}

function pushCustomerState() {
  try {
    const cashOpen = !!cashSession?.open || !!cashSession?.remoteCajaId;

    // Si se quedó en CLOSED y ahora hay caja, vuelve a CART
    if (cashOpen && (customerMode === "CLOSED" || !customerMode)) {
      customerMode = "CART";
      customerThanksUntil = 0;
    }

    if (!cashOpen) {
      customerMode = "CLOSED";
      window.TPV_CUSTOMER?.setState?.({
        cashOpen: false,
        mode: "CLOSED",
        items: [],
        total: 0,
        subLine: currentTerminal?.name
          ? `Terminal: ${currentTerminal.name}`
          : "",
        lastSale: customerLastSale || null,
        ts: Date.now(),
      });
      return;
    }

    // Items "internos" (para total y lógica) = carrito tal cual
    const cartItemsInternal = (Array.isArray(cart) ? cart : []).map((item) => {
      const unitPrice = Number(getUnitGross(item) || 0);
      const qty = Number(item.qty || 0);
      const lineTotal = unitPrice * qty;

      return {
        lineId: item._lineId,
        name: item.name || "",
        secondaryName: item.secondaryName || "",
        qty,
        unitPrice,
        lineTotal,
        imageUrl: item.imageUrl || item.imgUrl || null,
        modified: !!isPriceModified?.(item),
      };
    });

    const cartTotal = cartItemsInternal.reduce(
      (a, it) => a + Number(it.lineTotal || 0),
      0,
    );

    // ✅ Items VISIBLES para pantalla cliente (oculta hijos + “Incluye”)
    const cartItemsVisible = buildCustomerItemsFromCart(cart);

    // ✅ LÓGICA CLAVE (igual que la tuya):
    let itemsToShow = cartItemsVisible;
    let totalToShow = cartTotal;

    // Si carrito vacío pero existe override, mostramos override (pero filtrado)
    if (
      cartItemsInternal.length === 0 &&
      customerDisplayOverride?.items?.length
    ) {
      // Por si el override venía sin filtrar (ej. versiones viejas)
      itemsToShow = Array.isArray(customerDisplayOverride.items)
        ? customerDisplayOverride.items
        : [];
      totalToShow = Number(customerDisplayOverride.total || 0);
    }

    const subLine = [
      currentTerminal?.name ? `Terminal: ${currentTerminal.name}` : "",
      cashSession?.remoteCajaId ? `Caja: ${cashSession.remoteCajaId}` : "",
      currentAgent?.nick ? `Agente: ${currentAgent.nick}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    window.TPV_CUSTOMER?.setState?.({
      cashOpen: true,
      mode: customerMode || "CART",
      items: itemsToShow,
      total: totalToShow,
      subLine,
      lastSale: customerLastSale || null,
      ts: Date.now(),
    });
  } catch (_) {}
}

(function startCustomerTicker() {
  setInterval(() => {
    try {
      customerTickThanksExpiry();
    } catch {}
  }, 500);
})();

/* =========================
   ESTADO GLOBAL TPV
========================= */

window.TPV_STATE = window.TPV_STATE || {};

function setAdminFlag(isAdmin, source = "unknown") {
  window.TPV_STATE = window.TPV_STATE || {};
  window.TPV_STATE.isAdmin = !!isAdmin;

  try {
    localStorage.setItem(
      "tpv_login_isAdmin",
      window.TPV_STATE.isAdmin ? "1" : "0",
    );
  } catch {}

  // UI de permisos (botones admin, etc.)
  applyAdminOnlyUI?.();
  refreshOptionsUI?.();

  // ✅ SOLO si hay caja abierta: repintar productos (lápiz / modo edición)
  if (cashSession?.open) {
    renderProducts?.();
  } else {
    // ✅ si la caja está cerrada, aseguramos que no haya “restos” visibles
    // (renderMainUI ya vacía todo si open=false)
    renderMainUI?.();
  }
}

function renderCashIdChip() {
  const el = document.getElementById("cashInfo");
  if (!el) return;

  const id = Number(cashSession?.remoteCajaId || 0) || 0;
  const open = !!cashSession?.open;

  if (open && id) {
    el.style.display = "";
    el.textContent = ` | Caja: ${id}`;
  } else {
    el.style.display = "none";
    el.textContent = "";
  }
}

let BOOT_IN_FLIGHT = false;

function applyAdminOnlyUI() {
  const isAdmin = !!window.TPV_STATE?.isAdmin;
  const els = document.querySelectorAll("[data-admin-only]");

  console.log("[ADMIN] applyAdminOnlyUI", {
    isAdmin,
    adminOnlyCount: els.length,
  });

  els.forEach((el) => {
    el.style.display = isAdmin ? "" : "none";
  });
}

async function runBootFlow() {
  if (BOOT_IN_FLIGHT) return false;
  BOOT_IN_FLIGHT = true;

  try {
    // 0) Hidratar y reparar persistencia ANTES de decidir si hay empresa
    await hydrateLegacyCompanyFromCfg();
    await repairCompanyPersistenceIfNeeded();
    await renderAppVersion();

    // 1) Empresa (email). Si no hay, SOLO esto puede abrir modal.
    const resolved = await bootstrapCompany();
    if (!resolved) return false; // cancelado o bloqueado

    // 2) Login
    const okLogin = await ensureLoginAutoOrPrompt();
    if (!okLogin) return false;

    // ✅ aplica SIEMPRE tras login
    applyAdminOnlyUI?.();
    refreshOptionsUI?.();

    // 3) Datos
    await loadDataFromApi();

    // ✅ y otra vez después de cargar UI/datos
    applyAdminOnlyUI?.();
    refreshOptionsUI?.();

    // 4) Terminal+Agente por defecto (NO overlay)
    await ensureTerminalAgentDefaults();

    // 5) Caja (recupera o abre modal)
    maybeOpenCashOrRecover();

    return true;
  } finally {
    BOOT_IN_FLIGHT = false;
  }
}

async function renderAppVersion() {
  const el = document.getElementById("appVersion");
  if (!el) return;

  try {
    const r = await window.TPV_SYS?.getVersion?.();
    if (r?.ok && r.version) el.textContent = `v${r.version}`;
  } catch {}
}

function getFsApi() {
  const api = window.fsApi;
  if (!api)
    throw new Error(
      "fsApi no inicializada (window.fsApi vacío). ¿se ejecutó bootstrap?",
    );
  return api;
}

function isFalseFlag(v) {
  return v === false || v === 0 || v === "0" || v === "false";
}

function buildAgentNameMap(agentesMaestros) {
  const map = {};
  (Array.isArray(agentesMaestros) ? agentesMaestros : []).forEach((a) => {
    const code = String(a.codagente || "").trim();
    if (!code) return;
    map[code] = String(a.nombre || a.name || `Agente ${code}`).trim();
  });

  agentNameByCode = map;

  // cache opcional (recomendado)
  try {
    localStorage.setItem("tpv_agentNameByCode", JSON.stringify(map));
  } catch {}
}

function loadAgentNameMapFromCache() {
  try {
    const cached = localStorage.getItem("tpv_agentNameByCode");
    if (cached) agentNameByCode = JSON.parse(cached) || {};
  } catch {}
}

function getAgentLabel(codagente) {
  const c = String(codagente || "").trim() || "—";
  return agentNameByCode[c] || `Agente ${c}`;
}

// Extrae el % de IVA desde el código de impuesto.
// Primero mira la tabla de impuestos que hemos cargado de FacturaScripts.
// Si no lo encuentra, intenta deducirlo de los dígitos del código (fallback).
function extractTaxRateFromCode(codimpuesto) {
  if (!codimpuesto) return 0;

  const code = String(codimpuesto).trim();

  // 1) Mirar en el mapa cargado desde /impuestos
  if (Object.prototype.hasOwnProperty.call(taxRatesByCode, code)) {
    return taxRatesByCode[code];
  }

  // 2) Fallback: intentar sacar un número de dentro del código (ej. IVA21 -> 21)
  const m = code.match(/(\d+)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return isNaN(n) ? 0 : n;
}

// Devuelve el % de IVA de un producto o línea,
// usando primero product.taxRate y, si no, codimpuesto.
function getTaxRateForProduct(product) {
  if (!product) return 0;
  if (typeof product.taxRate === "number") return product.taxRate;
  if (product.codimpuesto) return extractTaxRateFromCode(product.codimpuesto);
  return 0;
}

function refreshLoggedUserUI() {
  if (!userNameEl) return;

  // Fuente única: sesión runtime → localStorage → vacío
  const u =
    String(getLoginUser?.() || "").trim() ||
    String(localStorage.getItem("tpv_login_user") || "").trim();

  userNameEl.textContent = u ? u : "---";
}

function updateCashButtonLabel() {
  if (!cashHeaderLabel) return;

  if (TPV_STATE.locked) {
    cashHeaderLabel.textContent = "Bloqueado";
    return;
  }

  if (TPV_STATE.offline) {
    cashHeaderLabel.textContent = "Conectar";
    return;
  }

  cashHeaderLabel.textContent = cashSession.open ? "Cerrar caja" : "Abrir caja";
}

// ===== Categorías (familias) =====
function renderCategories() {
  console.trace("[TRACE] renderCategories()");

  const container = document.getElementById("categories");
  if (!container) return;

  const visibleCategories = getVisibleCategoriesForCurrentTerminal();

  if (
    activeFamilyParentId &&
    !visibleCategories.some(
      (c) => String(c.id) === String(activeFamilyParentId),
    )
  ) {
    activeFamilyParentId = null;
  }

  if (
    activeSubfamilyId &&
    !visibleCategories.some((c) => String(c.id) === String(activeSubfamilyId))
  ) {
    activeSubfamilyId = null;
  }

  if (
    selectedCategory &&
    !visibleCategories.some((c) => String(c.id) === String(selectedCategory))
  ) {
    selectedCategory = null;
  }

  const sub = document.getElementById("subcategories");
  if (sub) {
    sub.innerHTML = "";
    sub.style.display = "none";
  }

  container.innerHTML = "";

  const applyFamilyButtonColor = (btn, cat, isActive = false) => {
    const familyColor = getFamilyColorSync(cat.id);
    if (!familyColor) return;

    const textColor = getContrastTextColor(familyColor);

    if (isActive) {
      btn.style.background = familyColor;
      btn.style.borderColor = familyColor;
      btn.style.color = textColor;
      return;
    }

    btn.style.background = familyColor;
    btn.style.borderColor = familyColor;
    btn.style.color = textColor;
  };

  const inDrillDown = !!activeFamilyParentId;

  if (!inDrillDown) {
    const rootFamilies = visibleCategories.filter((c) => !c.parentId);

    rootFamilies.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-btn";
      btn.dataset.cat = cat.id;
      btn.textContent = cat.name;

      const hasChildren = visibleCategories.some((c) => c.parentId === cat.id);
      const isActive = !hasChildren && selectedCategory === cat.id;

      if (isActive) {
        btn.classList.add("active");
      }

      applyFamilyButtonColor(btn, cat, isActive);

      btn.onclick = () => {
        const children = visibleCategories.filter((c) => c.parentId === cat.id);

        if (children.length) {
          activeFamilyParentId = cat.id;
          activeSubfamilyId = null;
          selectedCategory = null;

          renderCategories();
          renderProducts();
          return;
        }

        selectedCategory = selectedCategory === cat.id ? null : cat.id;
        activeFamilyParentId = null;
        activeSubfamilyId = null;

        renderCategories();
        renderProducts();
      };

      container.appendChild(btn);
    });

    return;
  }

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "category-btn category-btn-back";
  backBtn.textContent = "Volver";
  backBtn.onclick = () => {
    activeFamilyParentId = null;
    activeSubfamilyId = null;
    selectedCategory = null;

    renderCategories();
    renderProducts();
  };
  container.appendChild(backBtn);

  const children = visibleCategories.filter(
    (c) => c.parentId === activeFamilyParentId,
  );

  children.forEach((child) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "category-btn subcategory-btn";
    b.dataset.cat = child.id;
    b.textContent = child.name;

    const isActive = activeSubfamilyId === child.id;
    if (isActive) {
      b.classList.add("active");
    }

    applyFamilyButtonColor(b, child, isActive);

    b.onclick = () => {
      activeSubfamilyId = activeSubfamilyId === child.id ? null : child.id;
      renderCategories();
      renderProducts();
    };

    container.appendChild(b);
  });
}

// ===== Productos =====
function renderProducts() {
  console.trace("[TRACE] renderProducts()");

  const grid = document.getElementById("productsGrid");
  if (!grid) return;

  grid.innerHTML = "";

  const term = (searchTerm || "").trim().toLowerCase();

  const terminalId = currentTerminal?.id;
  const mode = getTerminalModeSync(terminalId);

  const visibleCategories = getVisibleCategoriesForCurrentTerminal();
  const visibleCategoryIds = new Set(
    (visibleCategories || []).map((c) => String(c.id)),
  );

  let filtered = Array.isArray(products) ? [...products] : [];

  // ✅ Solo en modo filtered filtramos productos por categorías visibles
  if (mode === "filtered") {
    filtered = filtered.filter((p) =>
      visibleCategoryIds.has(String(p.category)),
    );
  }

  // Filtro por familia / subfamilia
  if (activeFamilyParentId) {
    if (activeSubfamilyId) {
      filtered = filtered.filter(
        (p) => String(p.category) === String(activeSubfamilyId),
      );
    } else {
      const allowedIds = new Set();
      allowedIds.add(String(activeFamilyParentId));

      // aquí usamos TODAS las categorías reales, no solo visibles,
      // para que el drill-down funcione bien incluso en modo all
      (categories || []).forEach((c) => {
        if (String(c.parentId || "") === String(activeFamilyParentId)) {
          allowedIds.add(String(c.id));
        }
      });

      filtered = filtered.filter((p) => allowedIds.has(String(p.category)));
    }
  } else if (selectedCategory) {
    filtered = filtered.filter(
      (p) => String(p.category) === String(selectedCategory),
    );
  }

  // Filtro por buscador
  if (term) {
    filtered = filtered.filter((p) => {
      const n1 = String(p.name || "").toLowerCase();
      const n2 = String(p.secondaryName || "").toLowerCase();
      return n1.includes(term) || n2.includes(term);
    });
  }

  filtered.forEach((p) => {
    const tile = document.createElement("div");

    tile.className = "product-tile" + (p.imageUrl ? "" : " no-img");

    const prodId = Number(p.baseProductId || p.id || 0);
    if (isOfferPackProductById(prodId)) tile.classList.add("is-offer");

    const taxRate = getTaxRateForProduct(p);
    const priceGross =
      (Number(p.price || 0) || 0) * (1 + (Number(taxRate) || 0) / 100);

    tile.innerHTML = `
      <div class="product-img-wrapper">
        ${p.imageUrl ? `<img src="${p.imageUrl}" class="product-img">` : ""}
      </div>

      <div class="product-overlay-top">
        <div class="product-name">${p.name || ""}</div>
        ${p.secondaryName ? `<div class="product-secondary">${p.secondaryName}</div>` : ""}
      </div>

      <div class="product-footer">
        <div class="product-price">${priceGross.toFixed(2)} €</div>
      </div>
    `;

    const canEditPrices = isAdminUser() && isPriceEditModeEnabled();

    tile.onclick = async () => {
      try {
        await addToCart(p);
      } catch (e) {
        console.warn("addToCart error:", e);
        toast("No se pudo añadir al carrito.", "error");
      }
    };

    if (canEditPrices) {
      tile.style.position = "relative";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "price-edit-badge";
      editBtn.textContent = "✎";
      editBtn.title = "Editar precio (IVA incl.)";

      editBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPriceEditForProduct(p);
      };

      tile.appendChild(editBtn);
    }

    grid.appendChild(tile);
  });
}

function renderMainUI(force = false) {
  console.log("[TRACE] renderMainUI cashSession.open=", cashSession?.open);

  if (!cashSession?.open) {
    const grid = document.getElementById("productsGrid");
    const catContainer = document.getElementById("categories");
    const subCatContainer = document.getElementById("subcategories");
    if (grid) grid.innerHTML = "";
    if (catContainer) catContainer.innerHTML = "";
    if (subCatContainer) subCatContainer.innerHTML = "";
    renderCart?.();
    return;
  }

  if (mainUiRendered && !force) return;

  renderCategories();
  renderProducts();
  mainUiRendered = true;

  initCustomerSelectorOnce().catch((e) =>
    console.warn("initCustomerSelectorOnce falló:", e?.message || e),
  );
  bindCartCustomerUiEvents();
}

function eur2(n) {
  return (
    Number(n || 0)
      .toFixed(2)
      .replace(".", ",") + "€"
  );
}

// ===== Buscador =====
if (searchInput) {
  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value || "";
    renderProducts();
  });
}

if (searchClearBtn) {
  searchClearBtn.onclick = () => {
    searchInput.value = "";
    searchTerm = "";
    renderProducts();
  };
}

// ===== Carrito =====
function makeLineId() {
  return "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function buildCartLine(product, quantity) {
  const taxRate = getTaxRateForProduct(product);
  const priceNet = product.price || 0;
  const priceGross = priceNet * (1 + taxRate / 100);

  return {
    _lineId: makeLineId(),

    id: product.id,
    baseProductId: product.baseProductId || product.id,

    // ✅ NUEVO: referencia/descripcion separadas (como FS)
    referencia:
      product.referencia || product.ref || product.codigo || product.name || "",
    descripcion: product.name || "",
    descripcion2: product.secondaryName || "",

    name: product.name,
    secondaryName: product.secondaryName || "",

    imageUrl: product.imageUrl || null,

    price: priceNet,
    taxRate,
    grossPrice: priceGross,
    codimpuesto: product.codimpuesto || null,
    qty: quantity,

    originalNetPrice: priceNet,
    originalGrossPrice: priceGross,
    grossPriceOverride: null,
  };
}

async function createChildrenFromSelection({
  parentLine,
  product,
  selection,
  parentQty,
}) {
  for (const sel of selection) {
    const ref = String(sel.reference || "").trim();
    const baseQty = Number(sel.qty || 0);

    const prodFs = await fetchProductoByReferencia(ref);

    const fakeProduct = {
      id: prodFs ? Number(prodFs.idproducto) : null,
      baseProductId: prodFs ? Number(prodFs.idproducto) : null,
      referencia: ref,
      name: prodFs?.descripcion || ref || "Producto pack",
      secondaryName: "",
      imageUrl: null,
      price: 0,
      codimpuesto: prodFs?.codimpuesto || product.codimpuesto || null,
    };

    const child = buildCartLine(fakeProduct, baseQty * parentQty);

    child.price = 0;
    child.grossPrice = 0;
    child.originalGrossPrice = 0;
    child.grossPriceOverride = 0;

    child.meta = {
      includedInPack: true,
      parentPackLineId: parentLine._lineId,
      packRef: ref,
    };

    cart.push(child);
  }
}

async function addToCart(product, quantity = 1) {
  const prodId = Number(product.baseProductId || product.id || 0);

  if (isOfferPackProductById(prodId)) {
    const pack = PACKS_STATE.packsByOfferProductId.get(prodId);
    if (!pack) {
      cart.push(buildCartLine(product, quantity));
      renderCart();
      return;
    }

    // Construimos líneas para modal (con nombres)
    const rawPackLines = PACKS_STATE.linesByPackId.get(pack.id) || [];
    const refs = rawPackLines.map((ln) => String(ln.reference || "").trim());

    const prods = await Promise.all(
      refs.map((ref) => fetchProductoByReferencia(ref)),
    );
    const packLinesForUI = rawPackLines.map((ln, idx) => {
      const ref = String(ln.reference || "").trim();
      const baseQty = Number(ln.quantity || 1) || 1;
      const prodFs = prods[idx];
      return {
        reference: ref,
        baseQty,
        productName: prodFs?.descripcion || ref,
      };
    });

    // Abrimos modal con valores por defecto del pack
    const selection = await openPackConfigModal({
      offerName: product.name || pack.name || "Oferta",
      offerSecondary: product.secondaryName || "",
      packLines: packLinesForUI,
    });

    // Cancelado
    if (!selection) return;

    const selectionKey = selectionKeyFromArr(selection);

    // Si no groupLines, intentamos sumar SOLO si coincide pack + precio + misma selección
    if (!isGroupLinesEnabled()) {
      const taxRate = getTaxRateForProduct(product);
      const productGross = round2(
        (Number(product.price || 0) || 0) * (1 + (Number(taxRate) || 0) / 100),
      );

      const existingParent = cart.find((c) => {
        if (!isPackParentLine(c)) return false;
        if (Number(c.baseProductId || c.id) !== prodId) return false;
        if (Number(c.meta?.packId) !== Number(pack.id)) return false;
        if (round2(getUnitGross(c)) !== productGross) return false;

        const k =
          c.meta?.packSelectionKey ||
          selectionKeyFromArr(c.meta?.packSelection);
        return k === selectionKey;
      });

      if (existingParent) {
        existingParent.qty = round2(
          (Number(existingParent.qty) || 0) + Number(quantity || 0),
        );

        // Recalcular hijos con la selección guardada
        syncSelectedPackChildrenQty(existingParent);
        renderCart();
        return;
      }
    }

    // Crear grupo nuevo
    const parentLine = buildCartLine(product, quantity);
    parentLine.meta = {
      isPackOffer: true,
      packId: pack.id,
      packSelection: selection,
      packSelectionKey: selectionKey, // para comparar rápido
    };

    cart.push(parentLine);

    await createChildrenFromSelection({
      parentLine,
      product,
      selection,
      parentQty: Number(quantity || 0),
    });

    renderCart();
    return;
  }

  // NORMAL (tu comportamiento)
  if (isGroupLinesEnabled()) {
    cart.push(buildCartLine(product, quantity));
    renderCart();
    return;
  }

  const existing = cart.find((c) => c.id === product.id);
  if (existing) existing.qty += quantity;
  else cart.push(buildCartLine(product, quantity));

  renderCart();
}

function updateCartItemQuantity(lineId, newQty) {
  const item = cart.find((c) => c._lineId === lineId);
  if (!item) return;

  // ❌ No permitir tocar hijos desde aquí (por seguridad)
  if (isPackChildLine(item)) {
    toast("Producto incluido en oferta. Modifica la oferta.", "warn");
    return;
  }

  let q = Number(newQty);
  if (!isFinite(q)) q = 0;

  q = Math.round(q * 1000) / 1000;

  // ✅ Si es parent pack: cascada / sync
  if (isPackParentLine(item)) {
    if (q <= 0) {
      removePackCascade(item._lineId);
      renderCart();
      return;
    }

    item.qty = q;
    syncSelectedPackChildrenQty(item);
    renderCart();
    return;
  }

  // ✅ Normal
  if (q <= 0) {
    cart = cart.filter((c) => c._lineId !== lineId);
  } else {
    item.qty = q;
  }

  renderCart();
}

function getOriginalUnitGross(item) {
  // Usa el mismo criterio que ya estabas usando en el click del botón precio
  return (
    Number(item.originalGrossPrice ?? item.grossPrice ?? item.price ?? 0) || 0
  );
}

function isPriceModified(item) {
  const ov = item?.grossPriceOverride;
  if (ov === null || ov === undefined) return false;

  const original = round2(getOriginalUnitGross(item));
  const override = round2(ov);

  // ✅ solo es "mod" si difiere del original (a 2 decimales)
  return override !== original;
}

/**
 * ✅ Setter inteligente:
 * - Si el nuevo precio es igual al original => elimina override (quita MOD/*)
 * - Si es distinto => guarda override
 */
function setUnitGrossOverrideSmart(item, newUnitGross) {
  const v = round2(newUnitGross);
  const original = round2(getOriginalUnitGross(item));

  if (v === original) {
    // quitar override
    item.grossPriceOverride = null;
    // opcional: delete item.grossPriceOverride;
    return;
  }

  item.grossPriceOverride = v;
}

function eur(n) {
  return (Number(n) || 0).toFixed(2).replace(".", ",") + " €";
}

function getUnitGross(item) {
  const v = item?.grossPriceOverride;
  if (typeof v === "number" && isFinite(v) && v >= 0) return v;
  if (typeof item?.grossPrice === "number" && isFinite(item.grossPrice))
    return item.grossPrice;
  return Number(item?.price || 0);
}

function fmtQty(q) {
  const n = Number(q);
  if (!isFinite(n)) return "0";
  // hasta 3 decimales, sin ceros sobrantes
  return n.toLocaleString("es-ES", { maximumFractionDigits: 3 });
}

function buildPackIncludesTextFromChildren(cartArr, parentLineId) {
  const children = (Array.isArray(cartArr) ? cartArr : []).filter(
    (x) =>
      x?.meta?.includedInPack && x?.meta?.parentPackLineId === parentLineId,
  );

  if (!children.length) return "";

  const parts = children.map((ch) => {
    const name = String(
      ch?.name || ch?.descripcion || ch?.meta?.packRef || "Producto",
    ).trim();
    const q = fmtQty(ch?.qty ?? 0);
    return `${name} x${q}`;
  });

  return parts.join(" · ");
}

function buildPackIncludesText(parentLine) {
  try {
    if (!isPackParentLine(parentLine)) return "";

    const children = getPackChildren(parentLine._lineId);
    if (!children.length) return "";

    // Texto compacto: "Incluye: Prod x1 · Prod2 x2"
    const parts = children.map((ch) => {
      const name = String(ch?.name || ch?.meta?.packRef || "Producto").trim();
      const q = fmtQty(ch?.qty ?? 0);
      return `${name} x${q}`;
    });

    return "Incluye: " + parts.join(" · ");
  } catch {
    return "";
  }
}

function renderCart() {
  const container = document.getElementById("cartLines");
  if (!container) return;
  container.innerHTML = "";

  let total = 0;

  // ✅ UI: solo pintamos líneas NO-hijas
  const uiLines = (Array.isArray(cart) ? cart : []).filter((line) => {
    return !isPackChildLine(line);
  });

  uiLines.forEach((item) => {
    const unitPrice = getUnitGross(item);
    const lineTotal = unitPrice * item.qty;
    total += lineTotal;

    const row = document.createElement("div");
    row.className = "cart-line";
    row.dataset.lineid = item._lineId;

    const modifiedMark = isPriceModified(item)
      ? " <span class='price-mod'>MOD</span>"
      : "";

    const unitTxt = eur(unitPrice) + modifiedMark;
    const lineTxt = eur(lineTotal);

    // ✅ Si es pack, añadimos "Incluye: ..."
    const includesText = isPackParentLine(item)
      ? buildPackIncludesText(item)
      : "";

    row.innerHTML = `
      <div class="cart-line-name">
        <div>${item.name}</div>

        ${
          item.secondaryName
            ? `<div class="cart-line-secondary">${item.secondaryName}</div>`
            : ""
        }

        ${
          includesText
            ? `<div class="cart-line-packincludes">${includesText}</div>`
            : ""
        }

        <div class="cart-line-unit">${fmtQty(item.qty)} x ${unitTxt}</div>
      </div>

      <div class="qty-controls">
        <button class="qty-btn" data-action="minus" data-lineid="${item._lineId}">-</button>
        <button type="button" class="qty-display qty-display-btn qty-btn" data-action="edit" data-lineid="${item._lineId}">
          ${fmtQty(item.qty)}
        </button>
        <button class="qty-btn" data-action="plus" data-lineid="${item._lineId}">+</button>
      </div>

      <div class="cart-line-total">
        <button type="button" class="line-price-btn" data-action="price" data-lineid="${item._lineId}">
          ${lineTxt}
        </button>
        <button class="line-delete-btn" data-lineid="${item._lineId}">✕</button>
      </div>
    `;

    container.appendChild(row);
  });

  const totalEl = document.getElementById("totalAmount");
  if (totalEl) totalEl.textContent = eur(total);

  // ✅ Completar imageUrl para customer display (solo si no viene)
  cart.forEach((item) => {
    if (!item.imageUrl && item.id != null) {
      const p = (products || []).find((x) => String(x.id) === String(item.id));
      if (p?.imageUrl) item.imageUrl = p.imageUrl;
    }
  });

  // ✅ si empieza un nuevo carrito, dejamos de mostrar el último cobrado
  if ((cart?.length || 0) > 0 && customerDisplayOverride) {
    customerDisplayOverride = null;
  }

  pushCustomerState();
  refreshAgentGuardUI?.();
}

const LOGIN_TOKEN_KEY = "tpv_login_token";
const LOGIN_USER_KEY = "tpv_login_user";

let LOGIN_ACTIVE = false;

function lockAppUI() {
  document.body.classList.add("modal-locked");
}
function unlockAppUI() {
  document.body.classList.remove("modal-locked");
}

function getLoginToken() {
  return localStorage.getItem(LOGIN_TOKEN_KEY) || "";
}

function getLoginUser() {
  return localStorage.getItem(LOGIN_USER_KEY) || "";
}

function getLoginWarehouse() {
  return localStorage.getItem("tpv_login_codalmacen") || "";
}

function setLoginSession({ token, user, codagente, codalmacen }) {
  localStorage.setItem("tpv_login_token", token || "");
  localStorage.setItem("tpv_login_user", user || "");
  localStorage.setItem("tpv_login_codagente", codagente || "");
  localStorage.setItem("tpv_login_codalmacen", codalmacen || "");
}
function clearLoginSession() {
  localStorage.removeItem("tpv_login_token");
  localStorage.removeItem("tpv_login_user");
  localStorage.removeItem("tpv_login_codagente");
  localStorage.removeItem("tpv_login_codalmacen");
}

function hasCompanyResolved() {
  const email = (localStorage.getItem("tpv_companyEmail") || "").trim();
  const baseUrl = (localStorage.getItem("tpv_baseUrl") || "").trim();
  const apiKey = (localStorage.getItem("tpv_apiKey") || "").trim();
  return !!(email && baseUrl && apiKey);
}

async function openLoginModal() {
  // ✅ No mostrar login si no hay empresa
  if (typeof hasCompanyResolved !== "function" || !hasCompanyResolved()) {
    console.warn(
      "[LOGIN] Bloqueado: no hay empresa resuelta (falta email/baseUrl/apiKey).",
    );
    return false;
  }

  console.log("🚀 [LOGIN] Iniciando con endpoint /users...");

  const overlay = document.getElementById("loginOverlay");
  const usersBar = document.getElementById("loginUsersBar");
  const passInp = document.getElementById("loginPass");
  const errEl = document.getElementById("loginError");
  const okBtn = document.getElementById("loginOkBtn");
  const exitBtn = document.getElementById("loginExitBtn");
  const pinPad = document.getElementById("loginPinPad");
  const pinSection = document.querySelector(".login-pin-wrap");
  const pinTitle = passInp.previousElementSibling;

  if (!overlay || !usersBar || !passInp || !okBtn || !exitBtn) return false;

  let selectedUser = "";
  let isAdminSelected = false;

  // --- 1) REPARACIÓN DE BOTONES NUMÉRICOS (PINPAD) ---
  if (pinPad && !pinPad.dataset.bound) {
    pinPad.dataset.bound = "1";
    pinPad.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-k]");
      if (!btn) return;
      const k = btn.getAttribute("data-k");

      if (k === "clear") {
        passInp.value = "";
      } else if (k === "back") {
        passInp.value = passInp.value.slice(0, -1);
      } else if (/^\d$/.test(k) && passInp.value.length < 4) {
        passInp.value += k;
      }
      passInp.focus();
    });
  }

  // --- 2) OBTENER USUARIOS ---
  const fetchFsUsers = async () => {
    // 1) conseguir companyEmail (igual que haces en doLogin)
    let companyEmail = "";
    try {
      companyEmail = (localStorage.getItem("tpv_companyEmail") || "").trim();
    } catch {}
    if (!companyEmail && window.TPV_CFG) {
      try {
        companyEmail = String(
          (await window.TPV_CFG.get("company.email")) || "",
        ).trim();
      } catch {}
    }
    if (!companyEmail) return [];

    // 2) construir URL a tpv_users.php
    const base = window.TPV_CONFIG?.resolverUrl || "";
    const url =
      base.replace(/\/clients\.json(\?.*)?$/i, "/tpv_users.php") +
      `?email=${encodeURIComponent(companyEmail)}`;

    try {
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true || !Array.isArray(data.users))
        return [];

      return data.users
        .filter((u) => u && u.nick) // ya viene filtrado desde PHP
        .sort((a, b) => String(a.nick).localeCompare(String(b.nick), "es"));
    } catch (e) {
      console.error("❌ Error fetch tpv_users.php:", e);
      return [];
    }
  };

  // --- 3) PINTAR BOTONES POR GRUPOS ---
  function renderUserButtons(userList) {
    usersBar.innerHTML = "";

    const admins = userList.filter((u) => u.admin === true);
    const staff = userList.filter((u) => u.admin !== true);

    const createGroup = (title, list) => {
      if (list.length === 0) return;
      const t = document.createElement("div");
      t.style =
        "width:100%; font-size:11px; color:#888; text-transform:uppercase; margin-top:8px; border-bottom:1px solid #eee";
      t.textContent = title;
      usersBar.appendChild(t);

      list.forEach((u) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "agent-btn";
        btn.textContent = u.nick;

        // Estilo Admin: Borde azul sutil
        if (u.admin) btn.style.boxShadow = "inset 0 0 0 2px #007bff";

        btn.onclick = async () => {
          selectedUser = u.nick;
          isAdminSelected = u.admin;
          // 👇 guarda estado admin en runtime
          TPV_STATE.isAdmin = !!u.admin;

          // opcional: persistir para recordar UI si recargas
          try {
            localStorage.setItem("tpv_isAdmin", TPV_STATE.isAdmin ? "1" : "0");
          } catch {}

          [...usersBar.querySelectorAll("button")].forEach((b) =>
            b.classList.remove("selected"),
          );
          btn.classList.add("selected");
          errEl.textContent = "";

          if (u.admin) {
            // Admin: Mostrar PIN
            pinSection.style.display = "block";
            pinTitle.style.display = "block";
            passInp.style.display = "block";
            passInp.value = "";
            passInp.focus();
          } else {
            // Empleado: Login directo con PIN 0000
            pinSection.style.display = "none";
            pinTitle.style.display = "none";
            passInp.style.display = "none";
            passInp.value = "0000";
            await doLogin();
          }
        };
        usersBar.appendChild(btn);
      });
    };

    createGroup("Administradores", admins);
    createGroup("Personal TPV", staff);
  }
  // --- 4) LÓGICA DE LOGIN ---
  const doLogin = async () => {
    const u = (selectedUser || "").trim();
    const p = (passInp.value || "").trim();

    if (!u) {
      errEl.textContent = "Selecciona un usuario.";
      return false;
    }
    if (isAdminSelected && !p) {
      errEl.textContent = "Introduce el PIN.";
      return false;
    }

    const base = window.TPV_CONFIG?.resolverUrl || "";
    const url = base.replace(/\/clients\.json(\?.*)?$/i, "/tpv_login.php");

    // companyEmail: compat LS + TPV_CFG
    let companyEmail = "";
    try {
      companyEmail = (localStorage.getItem("tpv_companyEmail") || "").trim();
    } catch {}
    if (!companyEmail && window.TPV_CFG) {
      try {
        companyEmail = (await window.TPV_CFG.get("company.email")) || "";
        companyEmail = String(companyEmail).trim();
      } catch {}
    }

    if (!companyEmail) {
      errEl.textContent = "Falta activar la empresa (companyEmail).";
      return false;
    }

    const body = new URLSearchParams();
    body.append("companyEmail", companyEmail);
    body.append("user", u);
    body.append("pass", isAdminSelected ? p : "0000");

    errEl.textContent = "";

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const data = await res.json().catch(() => null);

      if (!data || !data.ok) {
        errEl.textContent = data?.message || "PIN incorrecto";
        return false;
      }

      const loggedUser = (data.user || u || "").trim();
      const token = (data.token || "").trim();

      if (!loggedUser || !token) {
        errEl.textContent = "Respuesta inválida del servidor (sin token).";
        return false;
      }

      try {
        localStorage.setItem("tpv_login_user", loggedUser);
        localStorage.setItem("tpv_login_token", token);
      } catch {}

      // ✅ 1) Sesión runtime
      setLoginSession({
        token,
        user: loggedUser,
        codagente: data.codagente || "",
        codalmacen: data.codalmacen || "",
      });

      // Persistir usuario activo TPV (para recuperación tras corte)
      try {
        localStorage.setItem("tpv_last_user", loggedUser);
      } catch {}

      try {
        if (window.TPV_CFG)
          await window.TPV_CFG.set("tpv.lastUser", loggedUser);
      } catch {}

      // ✅ 2) Estado admin runtime + UI
      setAdminFlag(!!isAdminSelected, "login");
      await loadPriceEditModeFromCfg?.();

      // ✅ 3) Persistencia “no pedir nunca más”
      if (window.TPV_CFG) {
        await window.TPV_CFG.set("auth.username", loggedUser);
        await window.TPV_CFG.set("auth.token", token);
        await window.TPV_CFG.set("auth.isAdmin", !!isAdminSelected);

        if (data.codagente) {
          await window.TPV_CFG.set("auth.codagente", String(data.codagente));
        }
        if (data.codalmacen) {
          await window.TPV_CFG.set("auth.codalmacen", String(data.codalmacen));
        }
      }

      // ✅ 4) Gating admin en main
      try {
        await window.TPV_AUTH?.setCurrentUser?.(loggedUser, !!isAdminSelected);
      } catch {}

      // ✅ cambio de usuario “en caliente”

      try {
        const idcaja = getCajaIdSafe?.();
        if (idcaja) {
          await apiWrite(`tpvcajas/${idcaja}`, "PATCH", {
            idcaja: String(idcaja),
            nick: String(loggedUser || "").trim(),
          });
        }
      } catch (e) {
        console.warn(
          "[LOGIN] No pude actualizar nick en caja:",
          e?.message || e,
        );
      }

      // ✅ 5) UI final
      overlay.classList.add("hidden");
      unlockAppUI();
      refreshLoggedUserUI?.();

      LOGIN_ACTIVE = false;

      // ✅ No tocar cashOpenDialogShown aquí

      // Siempre refrescar cabecera/terminal/agente
      await ensureTerminalAgentDefaults();
      renderCashIdChip();

      // ✅ Si hay caja abierta, no hace falta forzar loadDataFromApi aquí
      // (solo si realmente necesitas refrescar catálogo por cambio de empresa, etc.)
      if (cashSession?.open) {
        // opcional: si de verdad lo necesitas:
        // await loadDataFromApi({ refresh: true });
        renderMainUI?.(); // esto pintará porque cashSession.open = true
      } else {
        renderMainUI?.(); // vaciará por tu gating (open=false)
      }

      return true;
    } catch (e) {
      errEl.textContent = "Error de conexión";
      return false;
    }
  };

  // --- ESTADO INICIAL ---
  errEl.textContent = "";
  passInp.value = "";
  overlay.classList.remove("hidden");
  lockAppUI();
  LOGIN_ACTIVE = true;

  try {
    const users = await fetchFsUsers();
    renderUserButtons(users);
  } catch (e) {
    renderUserButtons([{ nick: "admin", admin: true }]);
  }

  return await new Promise((resolve) => {
    okBtn.onclick = async () => {
      if (await doLogin()) resolve(true);
    };
    exitBtn.onclick = () => {
      overlay.classList.add("hidden");
      unlockAppUI();
      LOGIN_ACTIVE = false;
      resolve(false);
    };
  });
}

async function readIsAdminFromPersistence() {
  const TPV_CFG = window.TPV_CFG;

  // 1) cfg
  try {
    const v = TPV_CFG ? await TPV_CFG.get("auth.isAdmin") : null;
    if (v != null) return !!v;
  } catch {}

  // 2) fallback LS
  try {
    const ls = localStorage.getItem("tpv_login_isAdmin");
    if (ls != null) return ls === "1" || ls === "true";
  } catch {}

  return false;
}

async function ensureLoginAutoOrPrompt() {
  if (typeof hasCompanyResolved !== "function" || !hasCompanyResolved()) {
    console.log("[LOGIN] Saltando login: empresa no resuelta");
    return false;
  }

  // 1) sesión ya en memoria/localStorage
  const memUser = getLoginUser?.() || localStorage.getItem("tpv_login_user");
  const memTok = getLoginToken?.() || localStorage.getItem("tpv_login_token");

  if (memUser && memTok) {
    const isAdmin = await readIsAdminFromPersistence(); // lee TPV_CFG + fallback LS
    setAdminFlag(isAdmin, "autologin(mem)");

    // 🔥 importante: cargar el modo edición desde cfg en autologin
    await loadPriceEditModeFromCfg?.();

    renderProducts?.();
    refreshLoggedUserUI?.();
    return true;
  }

  // 2) TPV_CFG
  const TPV_CFG = window.TPV_CFG;
  const savedUser = TPV_CFG ? await TPV_CFG.get("auth.username") : "";
  const savedTok = TPV_CFG ? await TPV_CFG.get("auth.token") : "";
  const savedIsAdmin = TPV_CFG ? await TPV_CFG.get("auth.isAdmin") : false;

  if (savedUser && savedTok) {
    setLoginSession({
      user: savedUser,
      token: savedTok,
      codagente: (TPV_CFG ? await TPV_CFG.get("auth.codagente") : "") || "",
      codalmacen: (TPV_CFG ? await TPV_CFG.get("auth.codalmacen") : "") || "",
    });

    setAdminFlag(!!savedIsAdmin, "autologin(cfg)");
    await loadPriceEditModeFromCfg?.();
    refreshLoggedUserUI?.();
    return true;
  }

  // 3) pedir login
  const ok = await openLoginModal();
  return !!ok;
}

// ===== Modal genérico de confirmación (usa msgOverlay) =====
function confirmModal(title, text) {
  const overlay = document.getElementById("msgOverlay");
  const titleEl = document.getElementById("msgTitle");
  const textEl = document.getElementById("msgText");
  const okBtn = document.getElementById("msgOkBtn");
  const cancelBtn = document.getElementById("msgCancelBtn");

  if (!overlay || !titleEl || !textEl || !okBtn || !cancelBtn) {
    // fallback seguro si falta algo
    return Promise.resolve(window.confirm(text));
  }

  titleEl.textContent = title || "Confirmar";
  textEl.textContent = text || "";

  overlay.classList.remove("hidden");
  lockAppUI();

  return new Promise((resolve) => {
    const cleanup = () => {
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      window.removeEventListener("keydown", onKey);
      overlay.classList.add("hidden");
      unlockAppUI();
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        cleanup();
        resolve(false);
      }
      if (e.key === "Enter") {
        cleanup();
        resolve(true);
      }
    };

    window.addEventListener("keydown", onKey);

    cancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };

    okBtn.onclick = () => {
      cleanup();
      resolve(true);
    };
  });
}

window.TPV_UI?.onGuard?.(async ({ title, text }) => {
  await confirmModal(title || "Aviso", text || "");
});

// ===== Toasts (notificaciones breves) =====

function toast(message, type = "info", title = "") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const el = document.createElement("div");
  el.className = `toast ${type}`;

  el.innerHTML = `
    ${title ? `<div class="title">${title}</div>` : ""}
    <div>${message}</div>
  `;

  container.appendChild(el);

  requestAnimationFrame(() => el.classList.add("show"));

  const ttl = type === "err" ? 4500 : 2800;
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
  }, ttl);
}

// ===== Teclado numérico =====
const numPadOverlay = document.getElementById("numPadOverlay");
const numPadDisplay = document.getElementById("numPadDisplay");
const numPadProductName = document.getElementById("numPadProductName");
let numPadCurrentValue = "";
let numPadOnConfirm = null;
let numPadVisible = false;
let numPadOverwriteNextDigit = true;
let numPadMode = "qty"; // "qty" | "price"
let numPadOriginalUnitGross = null;
let numPadTargetItemId = null;
let numPadDefaultValue = "0";

// Función común para cerrar overlays de teclados al hacer clic fuera
function handleOverlayOutsideClick(e, padSelector, closeFn) {
  const pad = e.target.closest(padSelector);
  if (!pad) {
    closeFn();
    return true;
  }
  return false;
}

function formatPrice2(v) {
  const n = Number(String(v).replace(",", "."));
  if (!isFinite(n)) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

function updateNumPadDisplay() {
  if (!numPadDisplay) return;

  if (numPadMode === "price") {
    // Si el usuario está escribiendo una expresión (contiene operadores),
    // mostramos tal cual para no romper la edición
    const s = String(numPadCurrentValue ?? "").trim();
    const hasOps = /[+\-*/()]/.test(s);
    if (!s) {
      numPadDisplay.textContent = "0.00";
    } else if (hasOps) {
      numPadDisplay.textContent = s;
    } else {
      numPadDisplay.textContent = formatPrice2(s);
    }
    return;
  }

  // qty/cash (como lo tenías)
  numPadDisplay.textContent =
    numPadCurrentValue === "" ? "0" : String(numPadCurrentValue);
}

function openNumPad(
  initialValue,
  onConfirm,
  productName,
  mode = "qty",
  originalValue = null,
  targetId = null,
) {
  numPadMode = mode;
  numPadOriginalUnitGross = originalValue;
  numPadTargetItemId = targetId;

  numPadCurrentValue = initialValue != null ? String(initialValue) : "";
  numPadDefaultValue = numPadCurrentValue === "" ? "0" : numPadCurrentValue; // ✅
  numPadOverwriteNextDigit = true;
  numPadOnConfirm = onConfirm;

  if (numPadProductName) {
    numPadProductName.textContent = productName ? ` - ${productName}` : "";
  }

  // ✅ si es precio, muestra botón “Restaurar”
  const resetBtn = document.querySelector('[data-key="resetPrice"]');
  if (resetBtn) resetBtn.style.display = mode === "price" ? "" : "none";

  updateNumPadDisplay();
  if (numPadOverlay) numPadOverlay.classList.remove("hidden");
  numPadVisible = true;
}

function closeNumPad() {
  if (numPadOverlay) {
    numPadOverlay.classList.add("hidden");
  }
  if (numPadProductName) {
    numPadProductName.textContent = "";
  }
  numPadVisible = false;
  numPadOnConfirm = null;
}

function numPadAddDigit(digit) {
  if (numPadOverwriteNextDigit) {
    numPadCurrentValue = digit; // 👈 sustituye
    numPadOverwriteNextDigit = false;
    updateNumPadDisplay();
    return;
  }

  if (numPadCurrentValue.length < 12) {
    numPadCurrentValue += digit;
    updateNumPadDisplay();
  }
}

function numPadAddOperator(op) {
  // Si está en modo overwrite (recién abierto) y el usuario toca un operador:
  // ✅ NO sustituimos, queremos operar con el valor actual (5 -> 5*2)
  numPadOverwriteNextDigit = false;

  let s = String(numPadCurrentValue || "");

  // Si está vacío, arrancamos desde 0 salvo "-" (permitir negativos si quieres)
  if (!s) s = "0";

  // Evitar dos operadores seguidos: reemplaza el último
  if (/[+\-*/]$/.test(s)) {
    s = s.slice(0, -1) + op;
  } else {
    s += op;
  }

  numPadCurrentValue = s;
  updateNumPadDisplay();
}

function numPadAppend(token) {
  // límite más alto porque ahora puede haber operadores
  if (numPadCurrentValue.length >= 20) return;

  // normalizar tokens especiales
  if (token === "mul") token = "*";
  if (token === "div") token = "/";
  if (token === "dot") token = ".";

  numPadCurrentValue += token;
  updateNumPadDisplay();
}

function numPadAddDot() {
  numPadOverwriteNextDigit = false;
  let s = String(numPadCurrentValue || "0");

  // no permitir ".."
  if (s.endsWith(".")) return;

  // si el último char es operador, añade "0."
  if (/[+\-*/]$/.test(s)) s += "0.";
  // si NO hay punto en el último número, añadirlo
  else {
    const parts = s.split(/[+\-*/]/);
    const last = parts[parts.length - 1];
    if (last.includes(".")) return;
    s += ".";
  }

  numPadCurrentValue = s;
  updateNumPadDisplay();
}

function numPadBackspace() {
  if (numPadCurrentValue.length > 0) {
    numPadCurrentValue = numPadCurrentValue.slice(0, -1);
    updateNumPadDisplay();
    if (numPadCurrentValue.length === 0) numPadOverwriteNextDigit = true;
  }
}

function numPadClearAll() {
  numPadCurrentValue = "0";
  numPadOverwriteNextDigit = true;
  updateNumPadDisplay();
}

function numPadRestoreDefault() {
  if (numPadMode === "price") {
    const value = Number(numPadOriginalUnitGross) || 0;
    numPadCurrentValue = formatPrice2(value); // ✅ 2 decimales
  } else {
    numPadCurrentValue = String(numPadDefaultValue || "0");
  }

  numPadOverwriteNextDigit = true;
  updateNumPadDisplay();
}

function numPadConfirm() {
  const raw = String(numPadCurrentValue || "").trim();

  // Si no toca nada y le da OK -> mantener lo que había
  if (!raw) {
    if (typeof numPadOnConfirm === "function") {
      // en qty: 1; en price: usar original/actual
      if (numPadMode === "price") {
        const item = cart.find((c) => c._lineId === numPadTargetItemId);
        const current = item
          ? getUnitGross(item)
          : numPadOriginalUnitGross || 0;
        numPadOnConfirm(current);
      } else {
        numPadOnConfirm(1);
      }
    }
    closeNumPad();
    return;
  }

  // Eval simple de expresiones (si ya lo tienes, reutiliza tu versión)
  const cleaned = raw.replace(/\s+/g, "");
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) {
    toast("Expresión no válida", "warn", "Teclado");
    return;
  }

  let value;
  try {
    // eslint-disable-next-line no-new-func
    value = Function(`"use strict"; return (${cleaned});`)();
  } catch (e) {
    toast("Expresión no válida", "warn", "Teclado");
    return;
  }

  if (numPadMode === "price") {
    value = Number(value);
    if (!isFinite(value) || value <= 0) value = 0;
    if (typeof numPadOnConfirm === "function") numPadOnConfirm(value);
    closeNumPad();
    return;
  }

  // ✅ permitir decimales en movimientos de caja
  if (numPadMode === "cash") {
    value = Number(value);
    if (!isFinite(value) || value < 0) value = 0;

    // redondeamos a 2 decimales máximo (0.015 -> 0.02)
    value = Math.round(value * 100) / 100;

    if (typeof numPadOnConfirm === "function") {
      numPadOnConfirm(value);
    }
    closeNumPad();
    return;
  }

  // qty (✅ permitir decimales)
  value = Number(value);
  if (!isFinite(value) || value <= 0) value = 0;

  // límite y redondeo razonable para evitar basura (ajusta si quieres)
  // Ej: 0.435 -> 0.435 (3 decimales)
  value = Math.round(value * 1000) / 1000;
  if (value > 0 && value < 0.001) value = 0.001;

  if (typeof numPadOnConfirm === "function") numPadOnConfirm(value);
  closeNumPad();
  return;
}

if (numPadOverlay) {
  numPadOverlay.addEventListener("click", (e) => {
    if (handleOverlayOutsideClick(e, ".num-pad", closeNumPad)) return;

    const btn = e.target.closest("[data-key]");
    if (!btn) return;

    const key = btn.getAttribute("data-key");

    // ✅ números u operadores
    if (key >= "0" && key <= "9") {
      numPadAddDigit(key);
    } else if (key === ".") {
      numPadAddDot();
    } else if (key === "+" || key === "-" || key === "*" || key === "/") {
      numPadAddOperator(key);
    } else if (key === "back") {
      numPadBackspace();
    } else if (key === "clear") {
      numPadClearAll();
    } else if (key === "cancel") {
      closeNumPad();
    } else if (key === "ok") {
      numPadConfirm();
    } else if (key === "resetPrice") {
      // 1) restaurar el valor en el TECLADO (sin cerrar)
      numPadRestoreDefault();

      // 2) (opcional) si quieres que además aplique inmediatamente al carrito SIN esperar OK:
      // const item = cart.find((c) => c.id === numPadTargetItemId);
      // if (item) {
      //   restoreUnitGross(item);
      //   renderCart();
      // }
      // (Yo recomiendo NO aplicar hasta OK, para que sea coherente con el teclado)

      return;
    }
  });
}

window.addEventListener("keydown", (e) => {
  if (numPadVisible) {
    if (/^[0-9+\-*/().]$/.test(e.key)) {
      e.preventDefault();
      numPadAppend(e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      numPadBackspace();
    } else if (e.key === "Enter") {
      e.preventDefault();
      numPadConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeNumPad();
    }
    return;
  }

  // Teclado QWERTY se gestiona más abajo
});

// ===== Teclado QWERTY =====
const qwertyOverlay = document.getElementById("qwertyOverlay");
const qwertyDisplay = document.getElementById("qwertyDisplay");
let qwertyCurrentValue = "";
let qwertyVisible = false;

function updateQwertyDisplay() {
  if (!qwertyDisplay) return;
  qwertyDisplay.textContent = qwertyCurrentValue || "";
}

let qwertyTargetInput = null;

// default: text
function openQwertyForInput(inputEl, mode = "text") {
  qwertyMode = mode;

  const emailRow = document.getElementById("qwertyEmailRow");
  if (emailRow) {
    emailRow.classList.toggle("hidden", qwertyMode !== "email");
  }

  qwertyTargetInput = inputEl || null;
  qwertyCurrentValue = inputEl?.value ? inputEl.value : "";
  updateQwertyDisplay();

  const qwertyOverlay = document.getElementById("qwertyOverlay");
  if (qwertyOverlay) qwertyOverlay.classList.remove("hidden");
  qwertyVisible = true;
}

function closeQwerty() {
  const emailRow = document.getElementById("qwertyEmailRow");
  if (emailRow) emailRow.classList.add("hidden");

  const qwertyOverlay = document.getElementById("qwertyOverlay");
  if (qwertyOverlay) qwertyOverlay.classList.add("hidden");

  qwertyVisible = false;
  qwertyMode = "text";
}

function qwertyAddChar(ch) {
  qwertyCurrentValue += ch;
  updateQwertyDisplay();
}

function qwertyBackspace() {
  if (qwertyCurrentValue.length > 0) {
    qwertyCurrentValue = qwertyCurrentValue.slice(0, -1);
    updateQwertyDisplay();
  }
}

function qwertyClearAll() {
  qwertyCurrentValue = "";
  updateQwertyDisplay();
}

function qwertyConfirm() {
  if (qwertyTargetInput) {
    qwertyTargetInput.value = qwertyCurrentValue;
    // si es el buscador, actualizamos la búsqueda
    if (qwertyTargetInput === searchInput) {
      searchTerm = qwertyCurrentValue;
      renderProducts();
    }
    qwertyTargetInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
  closeQwerty();
}

if (searchKeyboardBtn) {
  searchKeyboardBtn.onclick = () => {
    openQwertyForInput(searchInput);
  };
}

if (qwertyOverlay) {
  qwertyOverlay.addEventListener("click", (e) => {
    if (handleOverlayOutsideClick(e, ".qwerty-pad", closeQwerty)) {
      return;
    }

    const keyBtn = e.target.closest("[data-key]");
    if (!keyBtn) return;

    const key = keyBtn.getAttribute("data-key");
    if (key === ".com") {
      qwertyAddChar(".com");
    } else if (key === "gmail.com") {
      qwertyAddChar("gmail.com");
    } else if (key === "@") {
      qwertyAddChar("@");
    } else if (key === ".") {
      qwertyAddChar(".");
    } else if (key === "_") {
      qwertyAddChar("_");
    } else if (key === "-") {
      qwertyAddChar("-");
    } else if (key.length === 1) {
      qwertyAddChar(key);
    } else if (key === "space") {
      qwertyAddChar(" ");
    } else if (key === "back") {
      qwertyBackspace();
    } else if (key === "clear") {
      qwertyClearAll();
    } else if (key === "cancel") {
      closeQwerty();
    } else if (key === "ok") {
      qwertyConfirm();
    }
  });
}

window.addEventListener("keydown", (e) => {
  if (!qwertyVisible) return;

  if (e.key.length === 1) {
    e.preventDefault();
    qwertyAddChar(e.key);
  } else if (e.key === "Backspace") {
    e.preventDefault();
    qwertyBackspace();
  } else if (e.key === "Enter") {
    e.preventDefault();
    qwertyConfirm();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeQwerty();
  }
});

// ===== Wiring QWERTY para inputs del TPV =====
function wireQwertyInputs() {
  // Cobrar -> Observaciones
  if (payObs) {
    const open = () => openQwertyForInput(payObs, "text");
    payObs.addEventListener("focus", open);
    payObs.addEventListener("click", open);
  }

  // Cobrar -> Número (si también quieres teclado ahí)
  if (payNumber) {
    const open = () => openQwertyForInput(payNumber, "text");
    payNumber.addEventListener("focus", open);
    payNumber.addEventListener("click", open);
  }

  // Tickets -> botón teclado
  if (ticketsKeyboardBtn && ticketsSearch) {
    ticketsKeyboardBtn.onclick = () =>
      openQwertyForInput(ticketsSearch, "text");
  }
}

// Importante: ejecutar cuando el DOM ya existe
document.addEventListener("DOMContentLoaded", async () => {
  wireQwertyInputs();
  cashWrapInputsWithSteppers();

  await reloadTerminalFamilyHiddenCache().catch(() => {});
  await reloadTerminalFamilyModeCache().catch(() => {});
  await reloadFamilyColorsCache().catch(() => {});

  setupTerminalFamiliesUi();
});

// ===== Eventos del carrito =====
const cartLinesContainer = document.getElementById("cartLines");

if (cartLinesContainer) {
  cartLinesContainer.addEventListener("click", (e) => {
    const lineId = e.target?.closest(".cart-line")?.dataset?.lineid;
    const item = lineId ? cart.find((c) => c._lineId === lineId) : null;

    // ✅ Bloquear TOTAL para hijos de pack
    if (item && isPackChildLine(item)) {
      toast("Producto incluido en oferta. Modifica la oferta.", "warn");
      return;
    }

    // ===== QTY (+/-/edit) =====
    const qtyBtn = e.target.closest(".qty-btn");
    if (qtyBtn) {
      const action = qtyBtn.getAttribute("data-action");
      if (!item) return;

      const roundQty = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

      if (action === "plus") {
        if (isPackParentLine(item)) {
          item.qty = roundQty(item.qty + 1);
          syncSelectedPackChildrenQty(item);
          renderCart();
          return;
        }
        updateCartItemQuantity(lineId, roundQty(item.qty + 1));
        return;
      }

      if (action === "minus") {
        if (isPackParentLine(item)) {
          const nextQty = roundQty(item.qty - 1);
          if (nextQty <= 0) {
            removePackCascade(item._lineId);
            renderCart();
            return;
          }
          item.qty = nextQty;
          syncSelectedPackChildrenQty(item);
          renderCart();
          return;
        }
        updateCartItemQuantity(lineId, roundQty(item.qty - 1));
        return;
      }

      if (action === "edit") {
        openNumPad(
          String(item.qty ?? 1),
          (newQty) => {
            const q = Number(String(newQty).replace(",", "."));
            if (!isFinite(q)) return;

            const qq = roundQty(q);

            if (isPackParentLine(item)) {
              if (qq <= 0) removePackCascade(item._lineId);
              else {
                item.qty = qq;
                syncSelectedPackChildrenQty(item);
              }
              renderCart();
              return;
            }

            updateCartItemQuantity(lineId, qq);
          },
          item.name,
          "qty",
          null,
          lineId,
        );
        return;
      }

      return;
    }

    // ===== PRICE EDIT =====
    const priceBtn = e.target.closest('[data-action="price"]');
    if (priceBtn) {
      if (!item) return;

      const currentUnit = getUnitGross(item);
      const originalUnit =
        item.originalGrossPrice ?? item.grossPrice ?? item.price ?? 0;

      openNumPad(
        currentUnit.toFixed(2),
        (newUnitGross) => {
          const v = Number(String(newUnitGross).replace(",", "."));
          if (!isFinite(v) || v < 0) return;

          const rounded = Math.round(v * 100) / 100;
          setUnitGrossOverrideSmart(item, rounded);
          renderCart();
        },
        item.name,
        "price",
        originalUnit,
        lineId,
      );

      return;
    }

    // ===== DELETE =====
    const deleteBtn = e.target.closest(".line-delete-btn");
    if (deleteBtn) {
      if (!item) return;

      if (isPackParentLine(item)) {
        removePackCascade(item._lineId);
        renderCart();
        return;
      }

      // (tu log igual)
      const name = String(item?.name || "Producto").trim();
      const qty = Number(item?.qty || 1) || 1;

      try {
        const ctx = getLogCtx();
        if (ctx.idcaja) {
          const extra = `Producto:${name} | Cantidad:${qty}`;
          appendCajaAutoLogLineForId(
            ctx.idcaja,
            buildCajaLogLineWith(ctx, "QUITÓ PRODUCTO", extra),
          ).catch(() => {});
        }
      } catch {}

      updateCartItemQuantity(lineId, 0);
      return;
    }
  });
}

// ===== Estado (texto + punto de estado abajo) =====
function setStatusText(text) {
  const statusBar = document.getElementById("statusBar");
  if (!statusBar) return;

  const strong = statusBar.querySelector("strong");
  const dot = document.getElementById("statusDot");

  if (strong) strong.textContent = text;

  if (!dot) return;

  const t = (text || "").toLowerCase();

  // 🔴 OFFLINE / ERROR
  if (
    t.includes("offline") ||
    t.includes("sin conexión") ||
    t.includes("error")
  ) {
    dot.style.background = "#ef4444"; // rojo
    return;
  }

  // 🟡 CONECTANDO / PROCESANDO
  if (
    t.includes("conectando") ||
    t.includes("cobrando") ||
    t.includes("procesando")
  ) {
    dot.style.background = "#facc15"; // amarillo
    return;
  }

  // 🟢 ONLINE / OK
  dot.style.background = "#22c55e"; // verde
}

function updateOnlineBadge(ok) {
  const dot = document.getElementById("statusDot");
  const statusBar = document.getElementById("statusBar");
  if (!statusBar) return;

  const strong = statusBar.querySelector("strong");
  if (dot) dot.style.background = ok ? "#22c55e" : "#ef4444"; // verde / rojo
  if (strong)
    strong.textContent = ok ? "Online Recipok" : "Sin internet (modo offline)";
}

function updateParkedCountBadge() {
  const badge = document.getElementById("parkedCountBadge");
  if (!badge) return;
  const n = parkedTickets.length;
  badge.textContent = n;
}

function isPriceOverridden(item) {
  // Si guardas el override en grossPriceOverride, con esto basta
  const ov = item?.grossPriceOverride;

  // true si existe (incluye 0), false si no existe
  return ov !== null && ov !== undefined;
}

function getCartTotal(items) {
  return (items || []).reduce((sum, item) => {
    const unit = getUnitGross(item);

    return sum + unit * (item.qty || 1);
  }, 0);
}

function registerPaymentUsage(code, amount, label) {
  if (!code) return;

  const key = String(code).trim().toUpperCase() || "DESCONOCIDO";

  if (!cashSession.paymentsByMethod) cashSession.paymentsByMethod = {};

  const entry = cashSession.paymentsByMethod[key] || {
    code: key,
    label: label ? String(label).trim() : key,
    total: 0,
    count: 0,
  };

  // si llega un label mejor, lo guardamos
  if (label && String(label).trim()) entry.label = String(label).trim();

  entry.total += Number(amount) || 0;
  entry.count += 1; // ✅ CLAVE: incrementa “veces usado”

  cashSession.paymentsByMethod[key] = entry;
}

// Registra todos los pagos de una venta (array payResult.pagos)
function registerPaymentsForCurrentSession(pagos) {
  if (!Array.isArray(pagos)) return;
  pagos.forEach((p) => {
    registerPaymentUsage(p.codpago, p.importe, p.descripcion || p.codpago);
  });
}

async function parkCurrentCart(obs = "") {
  if (!cart || cart.length === 0) {
    toast("No hay productos para aparcar.", "warn", "Aparcar");
    return;
  }

  parkedCounter += 1;

  const snapshot = cart.map((item) => ({ ...item }));
  const total = getCartTotal(snapshot);

  const clientName = cartClientInput
    ? cartClientInput.value || "Cliente"
    : "Cliente";

  const observation = String(obs || "").trim();

  const localTicket = {
    id: parkedCounter,
    createdAt: new Date(),
    items: snapshot,
    total,
    clientName,
    obs: observation,
    fs: null,
  };

  // 👉 Aquí llamamos al endpoint de presupuestos
  const remote = await apiCreatePresupuestoFromCart(observation);
  if (remote && (remote.doc || remote.data)) {
    const doc = remote.doc || remote.data;
    localTicket.fs = {
      idpresupuesto: doc.idpresupuesto ?? doc.id ?? null,
      codigo: doc.codigo ?? null,
    };
  }

  parkedTickets.push(localTicket);

  cart = [];
  renderCart();
  updateParkedCountBadge();

  setStatusText("Ticket aparcado.");
}

function apiDeletePresupuesto(idpresupuesto) {
  if (!idpresupuesto || TPV_STATE.offline || TPV_STATE.locked) return;

  // usamos apiWrite con DELETE
  apiWrite(`presupuestoclientes/${idpresupuesto}`, "DELETE", {}).catch((e) => {
    console.warn("No se pudo borrar presupuesto en FS:", e);
  });
}

// ===== Modal de tickets aparcados =====
const parkedTicketsOverlay = document.getElementById("parkedTicketsOverlay");
const parkedTicketsList = document.getElementById("parkedTicketsList");
const parkedCloseBtn = document.getElementById("parkedCloseBtn");

function openParkedModal() {
  if (!parkedTicketsOverlay) return;

  if (!parkedTickets || parkedTickets.length === 0) {
    toast("No hay tickets aparcados.", "info", "Aparcados");
    return;
  }

  renderParkedTicketsModal();
  parkedTicketsOverlay.classList.remove("hidden");
}

function closeParkedModal() {
  if (!parkedTicketsOverlay) return;
  parkedTicketsOverlay.classList.add("hidden");
}

function renderParkedTicketsModal() {
  if (!parkedTicketsList) return;

  parkedTicketsList.innerHTML = "";

  if (!parkedTickets || parkedTickets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "parked-ticket-empty";
    empty.textContent = "No hay tickets aparcados.";
    parkedTicketsList.appendChild(empty);
    return;
  }

  const getItemName = (it) =>
    (it.name || it.nombre || it.descripcion || it.productName || "Producto")
      .toString()
      .trim();

  const getItemQty = (it) => Number(it.qty ?? it.cantidad ?? 1) || 1;

  parkedTickets.forEach((t, index) => {
    const div = document.createElement("div");
    div.className = "parked-ticket-item parked-ticket-compact";
    div.dataset.index = index;

    const fecha = t.createdAt ? new Date(t.createdAt) : new Date();

    const hora = fecha.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const totalTexto = t.total != null ? t.total.toFixed(2) + " €" : "—";

    // ✅ “tipos” = productos distintos (por nombre/id)
    const items = Array.isArray(t.items) ? t.items : [];
    const keyOf = (it) =>
      String(it.idproducto || it.id || getItemName(it)).toLowerCase();
    const uniqueMap = new Map();
    items.forEach((it) => {
      const k = keyOf(it);
      if (!uniqueMap.has(k)) uniqueMap.set(k, it);
    });
    const tipos = uniqueMap.size;

    // ✅ resumen de productos (3 máx)
    const preview = Array.from(uniqueMap.values())
      .slice(0, 3)
      .map((it) => `${getItemQty(it)}× ${getItemName(it)}`)
      .join(" · ");

    const extra = tipos > 3 ? ` · +${tipos - 3}` : "";

    const obs = (t.obs || "").trim();

    div.innerHTML = `
      <div class="pt-left">
        <div class="pt-title">Ticket #${t.id}</div>
        <div class="pt-sub">${hora} · ${escapeHtml(
          t.clientName || "Cliente",
        )}</div>
      </div>

      <div class="pt-mid">
        ${
          obs
            ? `<div class="pt-obs">${escapeHtml(obs)}</div>`
            : `<div class="pt-obs pt-obs-muted">Sin observación</div>`
        }
        <div class="pt-items">${escapeHtml(preview + extra)}</div>
      </div>

      <div class="pt-right">
  <div class="pt-right-top">
    <div class="pt-total">${totalTexto}</div>
    <button type="button" class="pt-del" title="Eliminar ticket aparcado" aria-label="Eliminar">🗑</button>
  </div>

  
</div>



    `;

    const delBtn = div.querySelector(".pt-del");
    if (delBtn) {
      delBtn.onclick = async (e) => {
        e.stopPropagation();

        const ok = await confirmModal(
          "Eliminar ticket aparcado",
          `¿Seguro que quieres eliminar el Ticket #${t.id}?`,
        );
        if (!ok) return;

        parkedTickets.splice(index, 1);
        // Si borro el ticket que estaba cargado, lo “desvinculo”
        if (currentParkedTicketIndex === index) {
          currentParkedTicketIndex = null;
        } else if (
          currentParkedTicketIndex !== null &&
          currentParkedTicketIndex > index
        ) {
          // Reajustar índice si se borra uno anterior
          currentParkedTicketIndex -= 1;
        }
        updateParkedCountBadge();

        // Si ya no quedan, cerramos modal
        if (!parkedTickets.length) {
          closeParkedModal();
          toast("No quedan tickets aparcados.", "info", "Aparcados");
          return;
        }

        renderParkedTicketsModal();
        toast("Ticket aparcado eliminado.", "ok", "Aparcados");
      };
    }

    div.onclick = () => {
      restoreParkedCartByIndex(index);
      closeParkedModal();
    };

    parkedTicketsList.appendChild(div);
  });
}

function clearPaidParkedTicket() {
  if (
    currentParkedTicketIndex === null ||
    !Array.isArray(parkedTickets) ||
    parkedTickets.length === 0
  ) {
    return;
  }

  const idx = currentParkedTicketIndex;
  if (idx < 0 || idx >= parkedTickets.length) {
    currentParkedTicketIndex = null;
    return;
  }

  const ticket = parkedTickets[idx];
  const fsInfo = ticket.fs || {};
  const idpresupuesto = fsInfo.idpresupuesto || null;

  // Quitamos de la lista local
  parkedTickets.splice(idx, 1);
  currentParkedTicketIndex = null;
  updateParkedCountBadge();

  // Y, si existe en FacturaScripts, lo borramos allí
  if (idpresupuesto) {
    apiDeletePresupuesto(idpresupuesto);
  }
}

// Cerrar modal al pulsar la X
if (parkedCloseBtn) {
  parkedCloseBtn.onclick = () => {
    closeParkedModal();
  };
}

// Cerrar al hacer clic fuera de la tarjeta
if (parkedTicketsOverlay) {
  parkedTicketsOverlay.addEventListener("click", (e) => {
    const modal = e.target.closest(".parked-modal");
    if (!modal) {
      closeParkedModal();
    }
  });
}

// Recuperar ticket por índice (lo usa el modal)
function restoreParkedCartByIndex(index) {
  if (!parkedTickets || parkedTickets.length === 0) {
    return;
  }

  if (index < 0 || index >= parkedTickets.length) {
    toast("Ticket aparcado no válido.", "err", "Aparcados");
    return;
  }

  const ticket = parkedTickets[index];

  // Clonamos líneas al carrito
  cart = (ticket.items || []).map((i) => ({ ...i }));
  renderCart();

  // Guardamos qué ticket aparcado está cargado
  currentParkedTicketIndex = index;

  // 👇 IMPORTANTE: no tocamos parkedTickets ni el contador
  // parkedTickets.splice(index, 1);
  // updateParkedCountBadge();

  setStatusText("Ticket aparcado cargado en el carrito.");
}

// ===== Gestión de terminales / agentes / caja =====
function fillTerminalSelect() {
  if (!terminalSelect) return;

  terminalSelect.innerHTML = "";
  terminals.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    terminalSelect.appendChild(opt);
  });
}

async function persistTerminalToCfg(terminalId) {
  try {
    await window.TPV_CFG?.set?.("tpv.idtpv", String(terminalId));
  } catch {}
}

function setCurrentTerminal(terminal) {
  const next = terminal || null;

  // ✅ si no cambia, no hagas nada
  if (String(currentTerminal?.id || "") === String(next?.id || "")) return;

  currentTerminal = next;

  // ✅ persistir el NUEVO
  if (currentTerminal?.id) persistTerminalToCfg(currentTerminal.id);

  // fallback opcional
  try {
    if (currentTerminal?.id)
      localStorage.setItem("tpv_terminal", String(currentTerminal.id));
  } catch {}

  renderMainAgentBar?.();
  applyTerminalDefaultCustomer?.();
  refreshAgentGuardUI?.();
}

function getAgentsForTerminalId(terminalId) {
  if (!terminalId) return [];
  const key = String(terminalId);
  return agentsByTerminal[key] || [];
}

function renderAgentButtonsOverlay(terminalId) {
  if (!agentButtonsOverlay || !agentSelectWrapper) return;

  const list = getAgentsForTerminalId(terminalId);
  agentButtonsOverlay.innerHTML = "";

  if (list.length === 0) {
    agentSelectWrapper.style.display = "none";
    currentAgent = null;
    return;
  }

  agentSelectWrapper.style.display = "";

  list.forEach((agent) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "agent-btn" +
      (currentAgent && currentAgent.codagente === agent.codagente
        ? " selected"
        : "");
    btn.textContent = agent.name;
    btn.onclick = () => {
      currentAgent = agent;
      try {
        window.TPV_CFG?.set?.("auth.codagente", String(agent.codagente));
      } catch {}
      // marcar seleccionado
      agentButtonsOverlay
        .querySelectorAll(".agent-btn")
        .forEach((b) => b.classList.toggle("selected", b === btn));

      // ✅ actualizar failsafe UI
      refreshAgentGuardUI?.();
    };
    agentButtonsOverlay.appendChild(btn);
  });

  // Si solo hay uno y aún no hay seleccionado, lo auto-seleccionamos
  if (!currentAgent && list.length === 1) {
    currentAgent = list[0];
    try {
      window.TPV_CFG?.set?.("auth.codagente", String(currentAgent.codagente));
    } catch {}
    const firstBtn = agentButtonsOverlay.querySelector(".agent-btn");
    if (firstBtn) firstBtn.classList.add("selected");
    // ✅
    refreshAgentGuardUI?.();
  }
}

function renderMainAgentBar() {
  if (!mainAgentBar) return;

  mainAgentBar.innerHTML = "";

  // Estructura principal:
  // [ agentListWrap -> agentList ] [ agentActions ]
  const agentListWrap = document.createElement("div");
  agentListWrap.className = "agent-list-wrap";

  const agentList = document.createElement("div");
  agentList.className = "agent-list";

  const agentActions = document.createElement("div");
  agentActions.className = "agent-actions";

  agentListWrap.appendChild(agentList);
  mainAgentBar.appendChild(agentListWrap);
  mainAgentBar.appendChild(agentActions);

  const createRefreshBtn = () => {
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "agent-btn agent-refresh-btn";
    refreshBtn.textContent = "🔄";
    refreshBtn.title = "Actualizar datos";
    refreshBtn.onclick = () => {
      refreshAllData().catch(() => {
        toast("No se pudo actualizar.", "err", "Actualizar");
      });
    };
    return refreshBtn;
  };

  const createDrawerBtn = () => {
    const drawerBtn = document.createElement("button");
    drawerBtn.type = "button";
    drawerBtn.className = "agent-btn agent-drawer-btn";
    drawerBtn.textContent = "📤";
    drawerBtn.title = "Abrir cajón";
    drawerBtn.onclick = () => {
      openDrawerNow({ source: "MAIN" }).catch(() =>
        toast("No se pudo abrir el cajón.", "err", "Cajón"),
      );
    };
    return drawerBtn;
  };

  // Si no hay terminal, mostrar solo acciones
  if (!currentTerminal) {
    agentActions.appendChild(createRefreshBtn());
    agentActions.appendChild(createDrawerBtn());

    if (agentNameEl) agentNameEl.textContent = "---";
    return;
  }

  const list = getAgentsForTerminalId(currentTerminal.id) || [];

  if (list.length) {
    list.forEach((agent) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "agent-btn" +
        (currentAgent && currentAgent.codagente === agent.codagente
          ? " selected"
          : "");

      btn.textContent = agent.name;

      btn.onclick = async () => {
        const clickedCode = agent.codagente;

        await refreshTerminalsAndAgents();

        const currentList = currentTerminal
          ? getAgentsForTerminalId(currentTerminal.id)
          : [];

        currentAgent =
          currentList.find((a) => a.codagente === clickedCode) ||
          currentList[0] ||
          null;

        try {
          window.TPV_CFG?.set?.(
            "auth.codagente",
            String(currentAgent?.codagente || ""),
          );
        } catch {}

        if (agentNameEl) {
          agentNameEl.textContent = currentAgent ? currentAgent.name : "---";
        }

        renderMainAgentBar();
        refreshAgentGuardUI?.();
      };

      agentList.appendChild(btn);
    });
  } else {
    currentAgent = null;
    if (agentNameEl) agentNameEl.textContent = "---";
    refreshAgentGuardUI?.();
  }

  // Botones fijos a la derecha
  agentActions.appendChild(createRefreshBtn());
  agentActions.appendChild(createDrawerBtn());

  if (agentNameEl) {
    agentNameEl.textContent = currentAgent ? currentAgent.name : "---";
  }
}

// Overlay para elegir TPV / agente
function showTerminalOverlay(mode = "session") {
  if (LOGIN_ACTIVE) return;
  if (!terminalOverlay) return;

  terminalOverlayMode = mode;
  terminalErrorEl.textContent = "";

  // Rellenamos select de TPVs
  fillTerminalSelect();
  const multipleTpvs = terminals.length > 1;

  // helper: copy según UI visible
  function updateTerminalOverlayCopy({ showTerminal, showAgent }) {
    const titleEl = document.getElementById("terminalOverlayTitle");
    const descEl = document.getElementById("terminalOverlayDesc");
    if (!titleEl || !descEl) return;

    if (showTerminal && showAgent) {
      titleEl.textContent = "Seleccionar Terminal y Agente";
      descEl.textContent =
        "Elige el TPV y el Agente/Cajero que va a usar este equipo.";
      return;
    }

    if (showTerminal && !showAgent) {
      titleEl.textContent = "Seleccionar Terminal";
      descEl.textContent = "Elige el TPV que va a usar este equipo.";
      return;
    }

    if (!showTerminal && showAgent) {
      titleEl.textContent = "Seleccionar Agente";
      descEl.textContent = "Elige el Agente/Cajero que va a usar este equipo.";
      return;
    }

    titleEl.textContent = "Configuración";
    descEl.textContent = "No hay opciones que seleccionar.";
  }

  // ----- MODO CAMBIO RÁPIDO SOLO TERMINAL -----
  if (mode === "terminalSwitch") {
    if (!multipleTpvs) return;

    if (terminalSelectWrapper) terminalSelectWrapper.style.display = "block";
    if (agentSelectWrapper) agentSelectWrapper.style.display = "none";

    updateTerminalOverlayCopy({ showTerminal: true, showAgent: false });

    if (currentTerminal && terminalSelect) {
      terminalSelect.value = String(currentTerminal.id);
    }

    terminalOverlay.classList.remove("hidden");
    return;
  }

  // ----- MODO CAMBIO RÁPIDO DE AGENTE (y si hay múltiples TPVs, también terminal) -----
  if (mode === "agentSwitch") {
    // si no hay currentTerminal, intentamos fijar uno
    if (!currentTerminal && terminals[0]) {
      setCurrentTerminal(terminals[0]);
    }
    if (!currentTerminal) return;

    // Mostrar selector de terminal solo si hay múltiples
    if (terminalSelectWrapper) {
      terminalSelectWrapper.style.display = multipleTpvs ? "block" : "none";
      if (multipleTpvs && terminalSelect) {
        terminalSelect.value = String(currentTerminal.id);
      }
    }

    const applyTerminalToAgentUI = (terminalId) => {
      terminalErrorEl.textContent = "";

      // ✅ al cambiar TPV, limpiamos agente
      currentAgent = null;
      if (agentNameEl) agentNameEl.textContent = "---";

      const list = getAgentsForTerminalId(terminalId);

      if (!list || list.length === 0) {
        if (agentSelectWrapper) agentSelectWrapper.style.display = "none";
        if (agentButtonsOverlay) agentButtonsOverlay.innerHTML = "";
        terminalErrorEl.textContent =
          "Este terminal no tiene agentes asignados.";
        return;
      }

      if (agentSelectWrapper) agentSelectWrapper.style.display = "block";
      renderAgentButtonsOverlay(terminalId);
    };

    // Si cambia TPV, refrescamos agentes
    if (multipleTpvs && terminalSelect) {
      terminalSelect.onchange = async () => {
        const tid = String(terminalSelect.value || "").trim();
        const t = (terminals || []).find((x) => String(x.id) === tid);

        if (t) {
          setCurrentTerminal(t); // ✅ persiste tpv.idtpv en TPV_CFG
          await applyTerminalDefaultCustomer?.();
        }

        // ✅ al cambiar TPV, limpiamos agente + persistimos vacío
        currentAgent = null;
        if (agentNameEl) agentNameEl.textContent = "---";
        try {
          await window.TPV_CFG?.set?.("auth.codagente", "");
        } catch {}

        applyTerminalToAgentUI(tid);
      };
    } else if (terminalSelect) {
      // por seguridad: en modo agentSwitch con 1 TPV, no necesitamos onchange
      terminalSelect.onchange = null;
    }

    // UI inicial con TPV actual
    applyTerminalToAgentUI(String(currentTerminal.id));

    // Copy según UI visible
    updateTerminalOverlayCopy({
      showTerminal: multipleTpvs,
      showAgent:
        agentSelectWrapper &&
        getComputedStyle(agentSelectWrapper).display !== "none",
    });

    terminalOverlay.classList.remove("hidden");
    return;
  }

  // ==========================
  // ----- MODO SESIÓN (abrir caja): tu lógica original completa -----
  // ==========================

  // TPV
  if (terminalSelectWrapper) {
    if (multipleTpvs) {
      terminalSelectWrapper.style.display = "block";
      if (currentTerminal && terminalSelect) {
        terminalSelect.value = String(currentTerminal.id);
      }
    } else {
      terminalSelectWrapper.style.display = "none";
      if (terminals.length === 1) {
        setCurrentTerminal(terminals[0]);
      }
    }
  }

  // Agentes de ese TPV
  let selectedTerminalId;
  if (multipleTpvs && terminalSelect) {
    selectedTerminalId =
      terminalSelect.value || (terminals[0] && terminals[0].id);
  } else if (currentTerminal) {
    selectedTerminalId = currentTerminal.id;
  } else if (terminals[0]) {
    selectedTerminalId = terminals[0].id;
    setCurrentTerminal(terminals[0]);
  }

  renderAgentButtonsOverlay(selectedTerminalId);

  const list = getAgentsForTerminalId(selectedTerminalId);
  const multipleAgents = list.length > 1;

  // Si no hay nada que elegir (<=1 TPV y sin/1 agente), abrimos directamente
  if (!multipleTpvs && !multipleAgents) {
    terminalOverlay.classList.add("hidden");

    if (!currentTerminal) {
      if (terminals.length === 1) {
        setCurrentTerminal(terminals[0]);
      } else if (terminals.length === 0) {
        setCurrentTerminal({ id: "demo", name: "TPV demo" });
      }
    }

    if (!currentAgent && list.length === 1) {
      currentAgent = list[0];
    }

    dispatchSessionReady();
    return;
  }

  // Mostrar/ocultar wrapper de agentes según si hay múltiples (si hay 0/1, lo ocultamos)
  if (agentSelectWrapper) {
    agentSelectWrapper.style.display = multipleAgents ? "block" : "none";
  }

  updateTerminalOverlayCopy({
    showTerminal:
      !!terminalSelectWrapper &&
      getComputedStyle(terminalSelectWrapper).display !== "none",
    showAgent: multipleAgents,
  });

  terminalOverlay.classList.remove("hidden");
}

if (terminalSelect) {
  terminalSelect.addEventListener("change", async () => {
    const tid = String(terminalSelect.value || "").trim();
    const t = (terminals || []).find((x) => String(x.id) === tid);

    if (t) {
      setCurrentTerminal(t); // ✅ aquí persistimos tpv.idtpv SIEMPRE
    }

    // ✅ al cambiar TPV, resetea agente (porque puede no pertenecer)
    currentAgent = null;
    try {
      await window.TPV_CFG?.set?.("auth.codagente", "");
    } catch {}

    renderAgentButtonsOverlay(tid);
    renderMainAgentBar?.();
  });
}

function hideTerminalOverlay() {
  if (!terminalOverlay) return;
  terminalOverlay.classList.add("hidden");
}

function updateCloseSummary(countedTotal) {
  if (!cashCloseSummary) return;

  const opening = Number(cashSession.openingTotal || 0);
  const cashIncome = Number(cashSession.cashSalesTotal || 0);
  const movements = Number(cashSession.cashMovementsTotal || 0);

  const expectedCash =
    cashSession.expectedCashFS != null
      ? Number(cashSession.expectedCashFS)
      : opening + cashIncome + movements;

  const totalSales = Number(cashSession.totalSales || 0);
  const diff = (Number(countedTotal) || 0) - (Number(expectedCash) || 0);

  if (sumOpeningEl) sumOpeningEl.textContent = eur(opening);
  if (sumCashIncomeEl) sumCashIncomeEl.textContent = eur(cashIncome);
  if (sumExpectedCashEl) sumExpectedCashEl.textContent = eur(expectedCash);
  if (sumCountedCashEl)
    sumCountedCashEl.textContent = eur(Number(countedTotal) || 0);

  if (sumDifferenceEl) {
    const sign = diff < 0 ? "-" : "";
    sumDifferenceEl.textContent =
      sign + eur(Math.abs(diff)).replace("€", "").trim() + " €";
  }

  // Línea 3: Total ventas grande
  const l3 = document.getElementById("cashCloseLine3");
  const l3v = document.getElementById("cashCloseGrandTotalVal");
  if (l3 && l3v) {
    l3.style.display = cashDialogMode === "close" ? "block" : "none";
    l3v.textContent = eur(totalSales);
  }
}

// Rellena cashSession y los textos inferiores de cierre con datos reales de FS
function applyRemoteCajaToSession(remoteCaja) {
  if (!remoteCaja) return;

  const opening = Number(remoteCaja.dineroini || 0);
  const cashIncome = Number(remoteCaja.ingresos || 0);
  const movements = Number(remoteCaja.totalmovi || 0);
  const expectedCash = Number(
    remoteCaja.totalcaja != null
      ? remoteCaja.totalcaja
      : opening + cashIncome + movements,
  );
  const totalSales = Number(remoteCaja.totaltickets || 0);

  // Guardamos en sesión para que updateCloseSummary use estos valores
  cashSession.openingTotal = opening;
  cashSession.cashSalesTotal = cashIncome;
  cashSession.cashMovementsTotal = movements;
  cashSession.totalSales = totalSales;
  cashSession.expectedCashFS = expectedCash; // 👈 nuevo campo

  // Actualizamos las etiquetas inferiores (sin contar todavía el conteo de caja)
  if (sumOpeningEl)
    sumOpeningEl.textContent = opening.toFixed(2).replace(".", ",") + " €";
  if (sumCashIncomeEl)
    sumCashIncomeEl.textContent =
      cashIncome.toFixed(2).replace(".", ",") + " €";
  if (sumMovementsEl)
    sumMovementsEl.textContent = movements.toFixed(2).replace(".", ",") + " €";
  if (sumExpectedCashEl)
    sumExpectedCashEl.textContent =
      expectedCash.toFixed(2).replace(".", ",") + " €";
  if (sumTotalSalesEl)
    sumTotalSalesEl.textContent =
      totalSales.toFixed(2).replace(".", ",") + " €";
}

// ===============================
// Observaciones + log (robusto)
// ===============================
const CASH_OBS_SEPARATOR = "----- REGISTRO TPV (AUTOMÁTICO) -----";

// Cola por caja para serializar updates y evitar deadlocks/concurrencia
const __OBS_QUEUE__ = new Map();

// ✅ Helper para acceder a cashSession sin romper si no existe aún
function getCashSession() {
  if (window.cashSession) return window.cashSession;
  if (typeof cashSession !== "undefined") return cashSession;
  // fallback para no explotar en early-boot
  window.cashSession = window.cashSession || {
    open: false,
    remoteCajaId: null,
  };
  return window.cashSession;
}

function getCajaIdSafe() {
  // No dependas de getCashSession si no está disponible
  const cs =
    typeof getCashSession === "function"
      ? getCashSession()
      : window.cashSession || cashSession || null;

  const id =
    Number(cs?.remoteCajaId) ||
    Number(localStorage.getItem("tpv_remoteCajaId") || 0) ||
    0;

  return id > 0 ? id : null;
}

function getLogCtx() {
  const agentName =
    (currentAgent?.name || currentAgent?.nick || getLoginUser?.() || "—")
      .toString()
      .trim() || "—";
  const tpvName = (currentTerminal?.name || "—").toString().trim() || "—";

  return {
    idcaja: getCajaIdSafe(),
    agentName,
    tpvName,
  };
}

function formatDateTimeES(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

function splitCajaObservaciones(rawObs) {
  const s = String(rawObs || "").replace(/\r\n/g, "\n");
  const idx = s.indexOf(CASH_OBS_SEPARATOR);
  if (idx < 0) return { userText: s.trim(), autoLines: [] };

  const userText = s.slice(0, idx).trim();
  const autoPart = s.slice(idx + CASH_OBS_SEPARATOR.length).trim();
  const autoLines = autoPart
    ? autoPart
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  return { userText, autoLines };
}

function buildCajaObservaciones(userText, autoLines) {
  const u = String(userText || "").trim();
  const lines = Array.isArray(autoLines) ? autoLines.filter(Boolean) : [];

  if (!u && !lines.length) return "";
  if (!lines.length) return u;

  return [u, u ? "" : "", CASH_OBS_SEPARATOR, ...lines]
    .filter((x) => x !== "")
    .join("\n")
    .trim();
}

function buildCajaLogLineWith(ctx, eventName, extra) {
  const agent = (ctx?.agentName || "—").toString().trim();
  const tpv = (ctx?.tpvName || "—").toString().trim();
  const base = `[${formatDateTimeES()}] ${eventName} | Agente: ${agent} | TPV: ${tpv}`;
  return extra ? `${base} | ${extra}` : base;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isDeadlockError(e) {
  const msg = String(e?.message || e || "").toLowerCase();
  return msg.includes("deadlock");
}

// Leer caja por id (sin depender de cashSession)
async function apiReadCajaById(idcaja) {
  if (!idcaja) return null;
  const resp = await apiRead(`tpvcajas/${idcaja}`);
  return resp?.doc || resp?.data || resp || null;
}

// ✅ IMPORTANTÍSIMO: En FS a veces PATCH/PUT requiere mandar idcaja en body.
// (No siempre, pero no molesta y suele arreglar 400.)
async function updateTpvcajaObservaciones(idcaja, observaciones) {
  if (!idcaja) throw new Error("updateTpvcajaObservaciones: idcaja vacío");

  const body = {
    idcaja: String(idcaja),
    observaciones: String(observaciones ?? ""),
  };
  const attempts = 5;

  for (let i = 1; i <= attempts; i++) {
    try {
      try {
        return await apiWrite(`tpvcajas/${idcaja}`, "PATCH", body);
      } catch {
        return await apiWrite(`tpvcajas/${idcaja}`, "PUT", body);
      }
    } catch (e) {
      if (!isDeadlockError(e) || i === attempts) throw e;
      await sleep(150 * i); // backoff
    }
  }
}

// Serializa escrituras por caja
function enqueueCajaObsWrite(idcaja, fn) {
  const prev = __OBS_QUEUE__.get(idcaja) || Promise.resolve();
  const next = prev
    .catch(() => {}) // no rompas la cola si falló antes
    .then(fn)
    .finally(() => {
      // Limpia si este era el último
      if (__OBS_QUEUE__.get(idcaja) === next) __OBS_QUEUE__.delete(idcaja);
    });

  __OBS_QUEUE__.set(idcaja, next);
  return next;
}

// Añade una línea automática (por id)
async function appendCajaAutoLogLineForId(idcaja, line) {
  if (!idcaja) return;

  return enqueueCajaObsWrite(idcaja, async () => {
    const remoteCaja = await apiReadCajaById(idcaja);
    const rawObs = remoteCaja?.observaciones ?? "";
    const { userText, autoLines } = splitCajaObservaciones(rawObs);

    autoLines.push(String(line || "").trim());
    const merged = buildCajaObservaciones(userText, autoLines);

    await updateTpvcajaObservaciones(idcaja, merged);
  });
}

// Guarda el texto del usuario (por id) respetando el bloque automático
async function saveUserObsToCajaForId(idcaja) {
  if (!idcaja) return;

  return enqueueCajaObsWrite(idcaja, async () => {
    const ta = document.getElementById("cashObs");
    const userText = String(ta?.value || "").trim();

    const remoteCaja = await apiReadCajaById(idcaja);
    const rawObs = remoteCaja?.observaciones ?? "";
    const { autoLines } = splitCajaObservaciones(rawObs);

    const merged = buildCajaObservaciones(userText, autoLines);
    await updateTpvcajaObservaciones(idcaja, merged);
  });
}

function fillCashObsTextareaFromRemote(remoteCaja) {
  const ta = document.getElementById("cashObs");
  if (!ta) return;

  const { userText } = splitCajaObservaciones(remoteCaja?.observaciones || "");
  ta.value = userText || "";
}

function isCashCodpago(codpago) {
  const c = String(codpago || "")
    .trim()
    .toUpperCase();
  if (CASH_CODPAGOS && CASH_CODPAGOS instanceof Set && CASH_CODPAGOS.size) {
    return CASH_CODPAGOS.has(c);
  }
  return c === "CONT" || c === "EFEC" || c === "CASH";
}

function renderCashCloseHeaderCard(remoteCaja) {
  const box = document.getElementById("cashCloseCard");
  if (!box) return;

  const idcaja = remoteCaja?.idcaja ?? cashSession.remoteCajaId ?? "—";
  const idtpv = remoteCaja?.idtpv ?? currentTerminal?.id ?? "—";
  const fechaini = remoteCaja?.fechaini ? String(remoteCaja.fechaini) : "—";

  const totalVendido = Number(
    remoteCaja?.totaltickets ?? cashSession.totalSales ?? 0,
  );
  const numTickets = Number(
    cashSession.numtickets ?? remoteCaja?.numtickets ?? 0,
  );

  box.innerHTML = `
    <div class="cash-close-top">Caja ${escapeHtml(String(idcaja))} (TPV ${escapeHtml(String(idtpv))})</div>
    <div class="cash-close-sub">Inicio: ${escapeHtml(fechaini)}</div>

    <div class="cash-close-kpis">
      <div class="cash-close-kpi">
        <div class="lbl">Total vendido</div>
        <div class="val">${escapeHtml(eur(totalVendido))}</div>
      </div>
      <div class="cash-close-kpi">
        <div class="lbl">Tickets</div>
        <div class="val">${escapeHtml(String(numTickets))}</div>
      </div>
    </div>
  `;
}

function renderCashCloseTotalMeta() {
  const box = document.getElementById("cashCloseTotalMeta");
  if (!box) return;

  const totalTickets = Number(cashSession.numtickets || 0);

  const totalPayments = Object.values(
    cashSession.paymentsByMethod || {},
  ).reduce((sum, m) => sum + Number(m.count || 0), 0);

  box.innerHTML = `
    <span class="cash-total-agent cash-total-chip">
      Tickets: ${totalTickets}
    </span>
    <span class="cash-total-agent cash-total-chip">
      Pagos: ${totalPayments}
    </span>
  `;

  box.style.display = "flex";
}

async function ensurePayMethodLabelsLoaded() {
  if (window.__PAYMETHOD_LABELS__) return;
  const fps = await fetchApiResourceWithParams("formapagos", { limit: 0 });
  window.__PAYMETHOD_LABELS__ = buildPayMethodLabelMap(fps);
}

async function getPayEditsCountForCaja(idcaja) {
  const cid = Number(idcaja || 0);
  if (!cid) return 0;

  const facturas = await fetchApiResourceWithParams("facturaclientes", {
    "filter[idcaja]": cid,
    limit: 0,
  });

  return countPayChangesInFacturas(facturas);
}

/*----------------------*/
/*cambiar metodo de pago*/
/*----------------------*/
function getPayChangeInfoFromNumero2(numero2) {
  const s = String(numero2 || "").trim();
  const m = s.match(/^(PAYCHGREF|PAYCHG)\|/i);
  if (!m) return null;
  return { type: m[1].toUpperCase() };
}

function countPayChangesInFacturas(facturas) {
  const arr = Array.isArray(facturas) ? facturas : [];
  let n = 0;

  for (const f of arr) {
    const numero2 = f?.numero2 ?? f?._raw?.numero2 ?? "";
    const info = getPayChangeInfoFromNumero2(numero2);
    if (info?.type === "PAYCHG") n += 1; // 1 cambio
  }
  return n;
}

function getCurrentCodAgenteSafe() {
  return currentAgent?.codagente || window.currentAgent?.codagente || null;
}

async function ensurePayMethodsLoaded() {
  await ensurePayMethodLabelsLoaded();
  if (window.__PAYMETHOD_LIST__) return;

  const fps = await fetchApiResourceWithParams("formapagos", { limit: 0 });
  window.__PAYMETHOD_LIST__ = (Array.isArray(fps) ? fps : [])
    .map((x) => ({
      codpago: String(x.codpago || x.codigo || "")
        .trim()
        .toUpperCase(),
      descripcion: String(x.descripcion || x.name || "").trim(),
    }))
    .filter((x) => x.codpago);
}

function payLabelFromMap(code) {
  const c = String(code || "")
    .trim()
    .toUpperCase();
  const map = window.__PAYMETHOD_LABELS__ || {};
  return map[c] || c || "—";
}

const payEditState = { factura: null };

async function openPayEditForFactura(facturaRow) {
  const ok = await confirmModal(
    "Atención",
    "Al cambiar el método de pago se comunicará a gerencia.\n\n¿Deseas continuar?",
  );
  if (!ok) return;

  const overlay = document.getElementById("payEditOverlay");
  const errEl = document.getElementById("payEditError");
  if (!overlay) return toast("Falta #payEditOverlay.", "err", "Pago");
  if (errEl) errEl.textContent = "";

  // cabecera
  document.getElementById("payEditTicketNum").textContent =
    facturaRow.codigo || `#${facturaRow.idfactura}`;
  document.getElementById("payEditClient").textContent =
    facturaRow.nombrecliente || "Cliente";
  document.getElementById("payEditTicketTotal").textContent = eurES(
    facturaRow.total || 0,
  );

  // cerrar
  const close = () => overlay.classList.add("hidden");
  const x = document.getElementById("payEditCloseX");
  const cancel = document.getElementById("payEditCancelBtn");
  if (x) x.onclick = close;
  if (cancel) cancel.onclick = close;

  payEditState.factura = facturaRow;
  overlay.classList.remove("hidden");

  try {
    await ensurePayMethodsLoaded();
    renderPayEditForTicket();
  } catch (e) {
    console.error(e);
    if (errEl) errEl.textContent = "No se pudieron cargar las formas de pago.";
  }
}

function renderPayEditForTicket() {
  const wrap = document.getElementById("payEditRecibos");
  const errEl = document.getElementById("payEditError");
  if (!wrap) return;

  wrap.innerHTML = "";

  const factura = payEditState.factura;
  if (!factura) {
    wrap.innerHTML = `<div style="color:#666">No hay ticket cargado.</div>`;
    return;
  }

  const oldCod = String(factura.codpago || "")
    .trim()
    .toUpperCase();
  const methods = Array.isArray(window.__PAYMETHOD_LIST__)
    ? window.__PAYMETHOD_LIST__
    : [];

  const row = document.createElement("div");
  row.style = `
    display:flex; justify-content:space-between; gap:10px; align-items:center;
    border:1px solid #eee; padding:10px; border-radius:10px; margin-bottom:10px;
  `;

  const left = document.createElement("div");
  left.innerHTML = `
    <div style="color:#666; font-size:12px">
      Actual: <strong>${escapeHtml(payLabelFromMap(oldCod))}</strong> (${escapeHtml(oldCod || "—")})
    </div>
    <div style="color:#999; font-size:12px">
      Este cambio creará 2 tickets (rectificativa + nuevo).
    </div>
  `;

  const right = document.createElement("div");
  right.style = "display:flex; gap:8px; align-items:center;";

  const sel = document.createElement("select");
  sel.className = "cart-btn";
  sel.style = "padding:8px 10px;";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Cambiar a…";
  sel.appendChild(opt0);

  methods
    .filter((m) => String(m.codpago).toUpperCase() !== oldCod)
    .forEach((m) => {
      const o = document.createElement("option");
      o.value = m.codpago;
      o.textContent = `${m.descripcion || m.codpago} (${m.codpago})`;
      sel.appendChild(o);
    });

  sel.onchange = async () => {
    const newCod = String(sel.value || "")
      .trim()
      .toUpperCase();
    if (!newCod) return;

    sel.disabled = true;
    if (errEl) errEl.textContent = "";

    try {
      const ok = await confirmModal(
        "Confirmar cambio",
        `Vas a cambiar "${payLabelFromMap(oldCod)}" → "${payLabelFromMap(newCod)}".\n\nEsto creará una rectificativa y un ticket nuevo.\n\n¿Deseas continuar?`,
      );
      if (!ok) return;

      await changeTicketPaymentMethodByReissue({
        facturaRow: factura,
        newCodpago: newCod,
      });

      toast("Método de pago actualizado ✅", "ok", "Pago");

      // refrescar tickets
      await loadAndRenderTickets?.();

      // cerrar
      document.getElementById("payEditOverlay")?.classList.add("hidden");
    } catch (e) {
      console.error(e);
      if (errEl) errEl.textContent = e?.message || "Error al reemitir ticket.";
      toast("No se pudo cambiar el método de pago.", "err", "Pago");
    } finally {
      sel.value = "";
      sel.disabled = false;
    }
  };

  right.appendChild(sel);
  row.appendChild(left);
  row.appendChild(right);
  wrap.appendChild(row);
}

/* ========= REEMISIÓN (rectificativa + nuevo ticket) ========= */

async function fetchLineasFacturaCliente(idfactura) {
  if (!idfactura) return [];
  const list = await fetchApiResourceWithParams("lineafacturaclientes", {
    limit: 0,
    "filter[idfactura]": idfactura,
    "sort[idlinea]": "ASC",
  });
  return Array.isArray(list) ? list : [];
}

function buildReissueLine(l, sign) {
  const baseDesc = String(l.descripcion || "Producto")
    .replace(/^DEV\s*-\s*/i, "")
    .replace(/^AJUSTE PAGO\s*-\s*/i, "")
    .trim();

  const ref = String(l.referencia || l.ref || l.codigo || baseDesc).trim();

  return {
    referencia: ref || "-", // 🔥 CLAVE
    descripcion: sign < 0 ? `AJUSTE PAGO - ${baseDesc}` : baseDesc,

    idproducto: Number(l.idproducto || 0) || undefined, // 🔥 CLAVE

    cantidad: (Number(l.cantidad || 0) || 0) * sign,
    pvpunitario: Number(l.pvpunitario || 0),
    codimpuesto: l.codimpuesto || undefined,
  };
}

function sortFacturaLinesForPackReissue(lines) {
  const arr = Array.isArray(lines) ? [...lines] : [];
  const isZero = (n) => Math.abs(Number(n || 0)) < 0.00001;

  return arr.sort((a, b) => {
    const aPid = Number(a?.idproducto || 0);
    const bPid = Number(b?.idproducto || 0);

    const aIsParent =
      aPid &&
      typeof isOfferPackProductById === "function" &&
      isOfferPackProductById(aPid);

    const bIsParent =
      bPid &&
      typeof isOfferPackProductById === "function" &&
      isOfferPackProductById(bPid);

    const aIsChild = !aIsParent && isZero(a?.pvpunitario);
    const bIsChild = !bIsParent && isZero(b?.pvpunitario);

    const rank = (isParent, isChild) => {
      if (isParent) return 0; // oferta primero
      if (isChild) return 1; // hijos gratis después
      return 2; // resto al final
    };

    const ra = rank(aIsParent, aIsChild);
    const rb = rank(bIsParent, bIsChild);

    if (ra !== rb) return ra - rb;

    // orden estable
    return Number(a?.idlinea || 0) - Number(b?.idlinea || 0);
  });
}

async function changeTicketPaymentMethodByReissue({ facturaRow, newCodpago }) {
  const originalId = Number(facturaRow?.idfactura || 0);
  if (!originalId) throw new Error("Ticket original sin idfactura.");

  const oldCod = String(facturaRow?.codpago || "")
    .trim()
    .toUpperCase();
  const newCod = String(newCodpago || "")
    .trim()
    .toUpperCase();
  if (!newCod || newCod === oldCod) return;

  const n2New = `PAYCHG|ORIG=${originalId}|FROM=${oldCod}|TO=${newCod}`;
  const n2Rect = `PAYCHGREF|ORIG=${originalId}|FROM=${oldCod}|TO=${newCod}`;

  if (TPV_STATE?.offline) {
    throw new Error("Sin internet: no se puede cambiar el método de pago.");
  }

  const idtpv = Number(currentTerminal?.id || 0) || null;
  const idcaja = getCajaIdSafe();
  const nick = (getLoginUser?.() || currentAgent?.nick || "admin").toString();

  if (!idtpv || !idcaja) {
    throw new Error("No hay caja abierta (idtpv/idcaja).");
  }

  const codcliente =
    facturaRow?._raw?.codcliente ||
    facturaRow?.codcliente ||
    window.RECIPOK_API?.defaultCodClienteTPV ||
    "1";

  // 1) Leer líneas reales actuales
  const lineasFacturaRaw = await fetchLineasFacturaCliente(originalId);
  if (!Array.isArray(lineasFacturaRaw) || !lineasFacturaRaw.length) {
    throw new Error("No pude cargar líneas del ticket.");
  }

  // 2) Desired real de hijos 0€ desde el ticket original
  const desiredBaseByPid = buildDesiredByPidFromFacturaLines(lineasFacturaRaw);

  // 3) Filtrado mínimo + ORDEN CORRECTO para reemisión
  const lineasFactura = sortFacturaLinesForPackReissue(
    lineasFacturaRaw.filter((l) => {
      const qty = Number(l?.cantidad || 0);
      if (!isFinite(qty) || qty === 0) return false;

      const desc = String(l?.descripcion || "").trim();
      const ref = String(l?.referencia || "").trim();

      if (!desc && !ref) return false;
      return true;
    }),
  );

  if (!lineasFactura.length) {
    throw new Error("No hay líneas válidas en el ticket.");
  }

  // 4) Rectificativa
  const payloadRect = {
    codcliente,
    lineas: lineasFactura.map((l) => buildReissueLine(l, -1)),
    pagada: 1,
    codpago: oldCod || null,
    serie: "R",
    idtpv,
    idcaja,
    nick,
    numero2: n2Rect,
  };

  const respRect = await createTicketInFacturaScripts(payloadRect);
  const docRect =
    respRect?.doc || respRect?.factura || respRect?.data || respRect || null;
  const rectId = Number(docRect?.idfactura || docRect?.id || 0);

  if (!rectId) {
    throw new Error("No pude crear rectificativa.");
  }

  // Parche packs rectificativa
  try {
    const desiredRect = negateDesiredByPid(desiredBaseByPid);
    await patchPackChildrenLinesInFacturaByDesired({
      idfactura: rectId,
      desiredByPid: desiredRect,
    });
  } catch (e) {
    console.warn(
      "[PAYCHG] No pude parchear packs en rectificativa:",
      e?.message || e,
    );
  }

  const totalRectFS = Number(docRect?.total ?? 0);
  const rectCash = isCashCodpago(oldCod) ? totalRectFS : 0;
  const codagente = getCurrentCodAgenteSafe();

  await updateFacturaCliente(rectId, {
    idtpv: String(idtpv),
    idcaja: Number(idcaja),
    nick,
    codalmacen: currentTerminal?.codalmacen || "",

    tpv_venta: 1,
    tpv_efectivo: Number(Number(rectCash).toFixed(2)),
    tpv_cambio: 0,

    idestado: 11,
    pagada: 1,
    codpago: oldCod || "",

    codserie: "R",
    idfacturarect: originalId,
    codigorect: facturaRow?.codigo || facturaRow?._raw?.codigo || "",
    codagente: codagente || undefined,
    numero2: n2Rect,
  });

  // 5) Ticket nuevo
  const payloadNew = {
    codcliente,
    lineas: lineasFactura.map((l) => buildReissueLine(l, +1)),
    pagada: 1,
    codpago: newCod,
    serie: facturaRow?.codserie || "S",
    idtpv,
    idcaja,
    nick,
    numero2: n2New,
  };

  const respNew = await createTicketInFacturaScripts(payloadNew);
  const docNew =
    respNew?.doc || respNew?.factura || respNew?.data || respNew || null;
  const newId = Number(docNew?.idfactura || docNew?.id || 0);

  if (!newId) {
    throw new Error("No pude crear el ticket nuevo.");
  }

  // Parche packs ticket nuevo
  try {
    await patchPackChildrenLinesInFacturaByDesired({
      idfactura: newId,
      desiredByPid: desiredBaseByPid,
    });
  } catch (e) {
    console.warn(
      "[PAYCHG] No pude parchear packs en ticket nuevo:",
      e?.message || e,
    );
  }

  const totalNewFS = Number(docNew?.total ?? 0);
  const newCash = isCashCodpago(newCod) ? totalNewFS : 0;

  await updateFacturaCliente(newId, {
    idtpv: String(idtpv),
    idcaja: Number(idcaja),
    nick,
    codalmacen: currentTerminal?.codalmacen || "",

    tpv_venta: 1,
    tpv_efectivo: Number(Number(newCash).toFixed(2)),
    tpv_cambio: 0,

    idestado: 11,
    pagada: 1,
    codpago: newCod,
    codagente: codagente || undefined,
    numero2: n2New,
  });

  // Log
  try {
    const ctx = getLogCtx();
    const origCode =
      String(facturaRow?.codigo || facturaRow?._raw?.codigo || "").trim() ||
      `#${originalId}`;
    const rectCode = String(docRect?.codigo || "").trim() || `#${rectId}`;
    const newCode = String(docNew?.codigo || "").trim() || `#${newId}`;

    const line = buildCajaLogLineWith(
      ctx,
      "Cambio método de pago (reemisión)",
      `Orig:${origCode} | Rect:${rectCode} | Nuevo:${newCode} | ${oldCod} → ${newCod} | Importe:${eurES(Math.abs(totalNewFS))}`,
    );
    await appendCajaAutoLogLineForId(idcaja, line);
  } catch (e) {
    console.warn("[PAYEDIT] No pude escribir log:", e?.message || e);
  }

  return { rectId, newId };
}

/*----------------------*/
/*fin cambiar metodo de pago*/
/*----------------------*/

function renderAgentSalesSummary() {
  const box = document.getElementById("agentSalesSummary");
  if (!box) return;

  const list = Array.isArray(cashSession.agentSalesSummary)
    ? cashSession.agentSalesSummary
    : [];

  if (!list.length) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.style.display = "block";

  box.innerHTML = `
    <div class="cash-agent-title">Ventas por agente</div>
    ${list
      .map((ag) => {
        const methods = Object.values(ag.byMethod || {}).sort(
          (a, b) => Number(b.total || 0) - Number(a.total || 0),
        );

        return `
          <div class="cash-agent-card">
            <div class="cash-agent-head">
              <div>
                <div class="cash-agent-name">${escapeHtml(ag.agentName || ag.agentCode || "—")}</div>
                <div style="font-size:12px; opacity:.9; margin-top:4px; font-weight:700;">
                  Tickets: ${Number(ag.count || 0)} · Pagos: ${Number(ag.paymentUses || 0)}
                </div>
              </div>
              <div class="cash-agent-total">${eur(ag.total || 0)}</div>
            </div>

            <div class="cash-agent-methods">
              ${methods
                .map(
                  (m) => `
                    <div class="cash-agent-method">
                      <div class="cash-agent-method-label">${escapeHtml(m.label || m.code || "—")} · Pagos: ${Number(m.count || 0)}</div>
                      <div class="cash-agent-method-amount">${eur(m.total || 0)}</div>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>
        `;
      })
      .join("")}
  `;
}

function renderPayMethodsSummary() {
  const box = document.getElementById("payMethodsSummary");
  if (!box) return;

  const map = cashSession.paymentsByMethod || {};
  const entries = Object.values(map);

  box.innerHTML = "";
  if (!entries.length) {
    box.style.display = "none";
    return;
  }

  box.style.display = "flex";

  const labelMap = window.__PAYMETHOD_LABELS__ || {};

  entries.sort((a, b) => {
    const la = String(a.label || labelMap[a.code] || a.code || "");
    const lb = String(b.label || labelMap[b.code] || b.code || "");
    return la.localeCompare(lb, "es", { sensitivity: "base" });
  });

  entries.forEach((pm) => {
    const baseLabel = pm.label || labelMap[pm.code] || pm.code || "—";
    const total = Number(pm.total) || 0;
    const payCount = Number(pm.count || 0);

    const card = document.createElement("div");
    card.className = "cash-pay-card";
    card.innerHTML = `
      <div class="cash-pay-card-amount">${eur(total)}</div>
      <div class="cash-pay-card-label">
        ${escapeHtml(baseLabel)} · Pagos: ${payCount}
      </div>
    `;
    box.appendChild(card);
  });
}

function cashResetUIForOpening() {
  // Inputs a 0
  document
    .querySelectorAll("#cashOpenOverlay .cash-grid-page input[data-denom]")
    .forEach((inp) => {
      inp.value = "0";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    });

  // input directo
  if (cashDirectTotalEl) cashDirectTotalEl.value = "0,00";

  // Observaciones
  const obs = document.querySelector("#cashOpenOverlay #cashObs");
  if (obs) obs.value = "";

  // Totales
  const idsToZero = [
    "sumOpening",
    "sumCashIncome",
    "sumMovements",
    "sumExpectedCash",
    "sumCountedCash",
    "sumTotalSales",
    "cashOpenTotal",
  ];

  idsToZero.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "0,00 €";
  });

  cashSession.paymentsByMethod = {};
}

function isCajaOpen(remoteCaja) {
  const ff = remoteCaja?.fechafin;
  return ff == null || String(ff).trim() === "";
}

async function apiReadLastOpenCajaForTpv(idtpv) {
  // usa tu fetchApiResourceWithParams o apiRead con querystring
  // (esto está alineado con tu endpoint y filtros)
  const list = await fetchApiResourceWithParams("tpvcajas", {
    "sort[idcaja]": "DESC",
    "filter[fechafin_null]": 1,
    "filter[idtpv]": idtpv,
    limit: 1,
  });
  return Array.isArray(list) && list[0] ? list[0] : null;
}

async function maybeOpenCashOrRecover() {
  if (cashRecoverInFlight) return;
  cashRecoverInFlight = true;

  try {
    const storedIdRaw = localStorage.getItem("tpv_remoteCajaId");
    const storedId = Number(storedIdRaw || 0) || 0;

    console.log("[TPV] maybeOpenCashOrRecover()", {
      open: cashSession.open,
      storedId,
      sessionId: cashSession?.remoteCajaId || null,
      idtpv: currentTerminal?.id || null,
    });

    // Si no hay terminal, no podemos consultar abiertas por TPV
    const idtpv = Number(currentTerminal?.id || 0) || 0;

    // 1) Si hay ID guardado, VALIDAR en FS si sigue abierta
    if (storedId) {
      try {
        const remoteCaja = await apiReadCajaById(storedId);

        if (remoteCaja && isCajaOpen(remoteCaja)) {
          // ✅ recuperable
          cashSession.remoteCajaId = Number(remoteCaja.idcaja || storedId);
          cashSession.open = true;
          loadCashLedgerIntoSession(cashSession.remoteCajaId);

          await ensureTerminalAgentDefaults();
          renderMainUI();
          renderMainAgentBar?.();
          refreshAgentGuardUI?.();
          updateCashButtonLabel();
          renderCashIdChip();
          return;
        }

        // ❌ estaba cerrada (o no existe)
        console.warn(
          "[TPV] Caja guardada no está abierta. Limpiando:",
          storedId,
        );
      } catch (e) {
        console.warn(
          "[TPV] No se pudo validar caja guardada. Limpiando:",
          storedId,
          e,
        );
      }

      // limpiar SIEMPRE si no validó como abierta
      cashSession.remoteCajaId = null;
      cashSession.open = false;
      pushCustomerState();
      localStorage.removeItem("tpv_remoteCajaId");
    }

    // 2) Si NO hay caja guardada válida, buscar ABIERTAS en FS para este TPV
    if (idtpv) {
      try {
        const resp = await apiReadLastOpenCajaForTpv(idtpv);

        // ✅ soporta: objeto o array
        const list = Array.isArray(resp) ? resp : resp ? [resp] : [];

        const openOnes = list.filter((c) => c && isCajaOpen(c));

        if (openOnes.length > 0) {
          // elegir la más reciente por fecha (ajusta el campo según tu modelo)
          const pick = openOnes.sort((a, b) => {
            const da =
              new Date(
                a?.fecha || a?.createdAt || a?.fcreacion || 0,
              ).getTime() || 0;
            const db =
              new Date(
                b?.fecha || b?.createdAt || b?.fcreacion || 0,
              ).getTime() || 0;
            return db - da;
          })[0];

          cashSession.remoteCajaId = Number(pick.idcaja);
          cashSession.open = true;
          localStorage.setItem("tpv_remoteCajaId", String(pick.idcaja));
          loadCashLedgerIntoSession(cashSession.remoteCajaId);

          await ensureTerminalAgentDefaults();

          renderMainUI();
          renderMainAgentBar?.();
          refreshAgentGuardUI?.();
          updateCashButtonLabel();
          renderCashIdChip();

          // opcional: avisar si hay más de una abierta (caso raro)
          if (openOnes.length > 1) {
            toast(
              "Hay más de una caja abierta. Se recuperó la más reciente.",
              "warn",
            );
          }
          return;
        }
      } catch (e) {
        console.warn("[TPV] No se pudo buscar caja abierta por TPV:", e);
      }
    }

    // 3) No hay nada abierto → pedir apertura (solo una vez)
    cashSession.remoteCajaId = null;
    cashSession.open = false;
    pushCustomerState();
    renderCashIdChip();

    if (!cashOpenDialogShown) {
      cashOpenDialogShown = true;
      console.log("[TPV] No hay caja abierta → mostrar modal apertura");
      await ensureTerminalAgentDefaults();
      refreshAgentGuardUI?.();
      openCashOpenDialog("open");
    }
  } finally {
    cashRecoverInFlight = false;
  }
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function fetchRecibosByFacturasMulti(idfacturas) {
  const cfg = window.RECIPOK_API || {};
  const base = (cfg.baseUrl || "").replace(/\/+$/, "");
  if (!base || !cfg.apiKey) return [];

  const ids = (idfacturas || []).map((x) => String(x)).filter(Boolean);
  if (!ids.length) return [];

  const all = [];
  for (const batch of chunk(ids, 30)) {
    // 30 es un tamaño prudente
    const url = new URL(`${base}/reciboclientes`);
    url.searchParams.set("limit", "0");
    batch.forEach((id) => url.searchParams.append("filter[idfactura]", id));

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", Token: cfg.apiKey },
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (res.ok && Array.isArray(data)) all.push(...data);
  }
  return all;
}

function normalizePayCode(code) {
  return (
    String(code || "")
      .trim()
      .toUpperCase() || "—"
  );
}

function roundMoney2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function sumImportes(list) {
  return roundMoney2(
    (Array.isArray(list) ? list : []).reduce(
      (s, x) => s + Number(x?.importe || 0),
      0,
    ),
  );
}

function groupRecibosByCodpago(recibos) {
  const map = {};

  for (const r of Array.isArray(recibos) ? recibos : []) {
    const codpago = normalizePayCode(r?.codpago);
    const importe = roundMoney2(r?.importe || 0);

    if (!map[codpago]) {
      map[codpago] = {
        codpago,
        importe: 0,
        count: 0,
      };
    }

    map[codpago].importe = roundMoney2(map[codpago].importe + importe);
    map[codpago].count += 1;
  }

  return Object.values(map);
}

/**
 * Devuelve el desglose de pagos de una factura.
 *
 * Regla:
 * - Si hay recibos válidos, usamos recibos.
 * - Si no hay recibos, fallback a factura.codpago + factura.total.
 *
 * Resultado:
 * {
 *   ticketTotal,
 *   ticketCount: 1,
 *   paymentUses,
 *   lines: [{ codpago, importe, count }]
 * }
 */
async function getFacturaPaymentBreakdown(factura) {
  const idfactura = Number(factura?.idfactura || 0);
  const facturaTotal = roundMoney2(factura?.total || 0);
  const facturaCodpago = normalizePayCode(factura?.codpago);

  if (!idfactura) {
    return {
      ticketTotal: facturaTotal,
      ticketCount: 1,
      paymentUses: 1,
      lines: [
        {
          codpago: facturaCodpago,
          importe: facturaTotal,
          count: 1,
        },
      ],
    };
  }

  let recibos = [];
  try {
    recibos = await fetchRecibosByFactura(idfactura);
  } catch (e) {
    console.warn("No pude leer recibos de factura", idfactura, e?.message || e);
    recibos = [];
  }

  // Solo recibos con importe real
  const recibosValidos = (Array.isArray(recibos) ? recibos : []).filter(
    (r) => roundMoney2(r?.importe || 0) !== 0,
  );

  if (recibosValidos.length) {
    const grouped = groupRecibosByCodpago(recibosValidos);
    const totalRecibos = roundMoney2(
      grouped.reduce((s, g) => s + Number(g.importe || 0), 0),
    );

    // Si cuadra razonablemente, usamos recibos como fuente de verdad
    if (Math.abs(totalRecibos - facturaTotal) <= 0.05) {
      return {
        ticketTotal: facturaTotal,
        ticketCount: 1,
        paymentUses: grouped.reduce((s, g) => s + Number(g.count || 0), 0),
        lines: grouped,
      };
    }
  }

  // Fallback
  return {
    ticketTotal: facturaTotal,
    ticketCount: 1,
    paymentUses: 1,
    lines: [
      {
        codpago: facturaCodpago,
        importe: facturaTotal,
        count: 1,
      },
    ],
  };
}

/**
 * Construye el reparto de una devolución a partir de los recibos del ticket original.
 *
 * Ejemplo:
 * original: 10 CONT + 40 TARJETA
 * refundTotalAbs: 50
 * => -10 CONT + -40 TARJETA
 *
 * Si la devolución es parcial, reparte proporcionalmente.
 */
async function buildRefundBreakdownFromOriginalRecibos(
  originalIdfactura,
  refundTotalAbs,
  fallbackCodpago = "CONT",
) {
  const totalAbs = roundMoney2(Math.abs(refundTotalAbs || 0));

  if (!(totalAbs > 0)) {
    return [];
  }

  let originalRecibos = [];
  try {
    originalRecibos = await fetchRecibosByFactura(originalIdfactura);
  } catch (e) {
    console.warn(
      "No pude leer recibos originales para devolución:",
      e?.message || e,
    );
    originalRecibos = [];
  }

  // Nos quedamos con recibos positivos del original
  const originalesValidos = (
    Array.isArray(originalRecibos) ? originalRecibos : []
  ).filter((r) => roundMoney2(r?.importe || 0) > 0);

  const grouped = groupRecibosByCodpago(originalesValidos).filter(
    (x) => roundMoney2(x.importe) > 0,
  );

  const originalTotal = roundMoney2(
    grouped.reduce((s, g) => s + Number(g.importe || 0), 0),
  );

  // Fallback si no hay recibos utilizables
  if (!grouped.length || !(originalTotal > 0)) {
    return [
      {
        codpago: normalizePayCode(fallbackCodpago),
        importe: -totalAbs,
        count: 1,
      },
    ];
  }

  const out = [];
  let pendiente = totalAbs;

  grouped.forEach((g, idx) => {
    const isLast = idx === grouped.length - 1;

    let parte = 0;
    if (isLast) {
      parte = pendiente;
    } else {
      parte = roundMoney2((totalAbs * Number(g.importe || 0)) / originalTotal);
      pendiente = roundMoney2(pendiente - parte);
    }

    out.push({
      codpago: normalizePayCode(g.codpago),
      importe: -roundMoney2(parte),
      count: 1,
    });
  });

  return out;
}

/**
 * Reescribe los recibos de una rectificativa para que respeten
 * el reparto del ticket original cuando la venta era mixta.
 */
async function rewriteRefundRecibosFromOriginalMix({
  originalIdfactura,
  refundIdfactura,
  refundTotalAbs,
  codcliente,
  idempresa,
  coddivisa,
  codigofactura,
  fecha,
  fallbackCodpago,
}) {
  if (!refundIdfactura || !originalIdfactura) return;

  const refundBreakdown = await buildRefundBreakdownFromOriginalRecibos(
    originalIdfactura,
    refundTotalAbs,
    fallbackCodpago,
  );

  if (!refundBreakdown.length) return;

  // Crear los recibos correctos
  for (const p of refundBreakdown) {
    const importe = roundMoney2(p.importe || 0);
    if (!importe) continue;

    await createReciboCliente({
      idfactura: refundIdfactura,
      codcliente,
      codpago: p.codpago,
      importe, // NEGATIVO
      fechapago: fecha,
      fecha,
      idempresa,
      codigofactura,
      coddivisa,
    });
  }

  // Limpiar extras / recibo erróneo autogenerado
  try {
    await cleanupRecibosFactura(
      refundIdfactura,
      refundBreakdown.map((x) => ({
        codpago: x.codpago,
        importe: x.importe,
      })),
    );
  } catch (e) {
    console.warn("No pude limpiar recibos de rectificativa:", e?.message || e);
  }

  try {
    await validateRecibosAgainstFactura?.(refundIdfactura);
  } catch {}
}

async function fetchRecibosByFactura(idfactura) {
  const arr = await fetchRecibosByFacturasMulti([idfactura]);
  const list = Array.isArray(arr) ? arr : [];
  return list.filter((r) => String(r.idfactura) === String(idfactura));
}

async function buildRefundBreakdownFromOriginalFactura(
  originalId,
  refundTotalAbs,
  fallbackCodpago = "",
) {
  const totalAbs =
    Math.round((Number(refundTotalAbs || 0) + Number.EPSILON) * 100) / 100;
  if (!(totalAbs > 0)) return [];

  let recibos = [];
  try {
    recibos = await fetchRecibosByFactura(originalId);
  } catch (e) {
    console.warn("No pude leer recibos originales:", e?.message || e);
    recibos = [];
  }

  // Nos quedamos solo con importes positivos reales
  const valid = (Array.isArray(recibos) ? recibos : []).filter((r) => {
    const imp = Number(r?.importe || 0);
    const code = String(r?.codpago || "")
      .trim()
      .toUpperCase();
    return imp > 0 && code;
  });

  // Agrupar por método de pago
  const byMethod = {};
  for (const r of valid) {
    const code = String(r.codpago || "")
      .trim()
      .toUpperCase();
    byMethod[code] = (byMethod[code] || 0) + Number(r.importe || 0);
  }

  const methods = Object.entries(byMethod).map(([codpago, importe]) => ({
    codpago,
    importe: Math.round((Number(importe || 0) + Number.EPSILON) * 100) / 100,
  }));

  // Si no hay recibos, fallback al codpago de la factura
  if (!methods.length) {
    const code =
      String(fallbackCodpago || "")
        .trim()
        .toUpperCase() || "CONT";
    return [
      {
        codpago: code,
        importe: -totalAbs,
      },
    ];
  }

  const originalSum = methods.reduce((s, x) => s + Number(x.importe || 0), 0);
  if (!(originalSum > 0)) {
    const code =
      String(fallbackCodpago || "")
        .trim()
        .toUpperCase() || "CONT";
    return [
      {
        codpago: code,
        importe: -totalAbs,
      },
    ];
  }

  // Reparto proporcional exacto en céntimos
  const totalCents = Math.round(totalAbs * 100);
  let usedCents = 0;

  const out = methods.map((m, idx) => {
    let cents = 0;

    if (idx < methods.length - 1) {
      cents = Math.round((Number(m.importe || 0) / originalSum) * totalCents);
      usedCents += cents;
    } else {
      cents = totalCents - usedCents;
    }

    return {
      codpago: String(m.codpago || "")
        .trim()
        .toUpperCase(),
      importe: -(cents / 100),
    };
  });

  return out.filter((x) => Math.abs(Number(x.importe || 0)) > 0.00001);
}

async function replaceFacturaRecibosWithBreakdown(idfactura, breakdown) {
  const rectId = Number(idfactura || 0);
  if (!rectId) throw new Error("Factura rectificativa inválida.");

  const parts = Array.isArray(breakdown) ? breakdown : [];
  if (!parts.length) return;

  // 1) Leer factura rectificativa real
  const fc = await fetchFacturaClienteById(rectId);
  if (!fc) throw new Error("No pude leer la factura rectificativa.");

  // 2) Borrar recibos existentes de la rectificativa
  try {
    const oldRecibos = await fetchRecibosByFactura(rectId);
    for (const r of oldRecibos) {
      const idrecibo = Number(r?.idrecibo || 0);
      if (!idrecibo) continue;

      try {
        await apiWrite(`reciboclientes/${idrecibo}`, "DELETE");
      } catch (e) {
        console.warn(
          "No pude borrar recibo anterior de rectificativa:",
          idrecibo,
          e?.message || e,
        );
      }
    }
  } catch (e) {
    console.warn(
      "No pude limpiar recibos anteriores de la rectificativa:",
      e?.message || e,
    );
  }

  // 3) Crear recibos nuevos repartidos por método
  const todayIso = new Date().toISOString().slice(0, 10);

  for (const part of parts) {
    const codpago = String(part?.codpago || "")
      .trim()
      .toUpperCase();
    const importe =
      Math.round((Number(part?.importe || 0) + Number.EPSILON) * 100) / 100;

    if (!codpago) continue;
    if (Math.abs(importe) < 0.009) continue;

    await createReciboCliente({
      idfactura: rectId,
      codcliente: fc.codcliente,
      codpago,
      importe, // 👈 negativo en devoluciones
      fechapago: todayIso,
      fecha: todayIso,
      idempresa: fc.idempresa,
      codigofactura: fc.codigo || fc.codigofactura || "",
      coddivisa: fc.coddivisa,
    });
  }
}

function resetCashRuntimeForNewCaja() {
  cashSession.paymentsByMethod = {};
  cashSession.paymentLedger = [];
  cashSession.agentSalesSummary = [];
  cashSession.totalSales = 0;

  cashSession.cashSalesTotal = 0;
  cashSession.cashMovementsTotal = 0;

  cashSession.expectedCashFS = null;
  cashSession.closingTotal = 0;
}

function buildPayMethodLabelMap(formapagos) {
  const m = {};
  (Array.isArray(formapagos) ? formapagos : []).forEach((fp) => {
    const code = String(fp.codpago || "").trim();
    const desc = String(fp.descripcion || fp.codpago || "").trim();
    if (code) m[code] = desc || code;
  });
  return m;
}

async function hydratePaymentsByMethodForClose(idcaja) {
  const facturas = await fetchApiResourceWithParams("facturaclientes", {
    "filter[idcaja]": idcaja,
    limit: 0,
  });

  const map = {};
  let totalPaymentUses = 0;

  for (const f of Array.isArray(facturas) ? facturas : []) {
    if (f.tpv_venta !== true) continue;

    const breakdown = await getFacturaPaymentBreakdown(f);
    totalPaymentUses += Number(breakdown.paymentUses || 0);

    for (const line of breakdown.lines || []) {
      const code = normalizePayCode(line.codpago);
      const amount = roundMoney2(line.importe || 0);
      const uses = Number(line.count || 0);
      const isRefund = amount < 0;

      if (!map[code]) {
        map[code] = {
          code,
          label: code,

          // neto por método
          total: 0,
          count: 0, // aquí count = nº de pagos/recibos

          // separados
          salesTotal: 0,
          refundTotal: 0,
          salesCount: 0,
          refundCount: 0,
        };
      }

      const m = map[code];

      m.total = roundMoney2(m.total + amount);
      m.count += uses;

      if (isRefund) {
        m.refundTotal = roundMoney2(m.refundTotal + Math.abs(amount));
        m.refundCount += uses;
      } else {
        m.salesTotal = roundMoney2(m.salesTotal + amount);
        m.salesCount += uses;
      }
    }
  }

  cashSession.paymentsByMethod = map;
  cashSession.totalPaymentUses = totalPaymentUses;
}

async function hydrateCloseTicketStatsForCaja(idcaja) {
  const cajaId = Number(idcaja || 0) || 0;
  if (!cajaId) {
    cashSession.numtickets = 0;
    cashSession.ticketCountByAgent = {};
    return { totalTickets: 0, byAgent: {} };
  }

  const facturas = await fetchApiResourceWithParams("facturaclientes", {
    "filter[idcaja]": cajaId,
    limit: 0,
  });

  const validFacturas = (Array.isArray(facturas) ? facturas : []).filter(
    (f) => f.tpv_venta === true,
  );

  const seenTickets = new Set();
  const byAgent = {};

  for (const f of validFacturas) {
    const ticketKey = String(f.idfactura || f.codigo || "").trim();
    if (!ticketKey) continue;

    if (!seenTickets.has(ticketKey)) {
      seenTickets.add(ticketKey);
    }

    const agentCode = String(f.codagente || "").trim() || "—";
    if (!byAgent[agentCode]) byAgent[agentCode] = new Set();
    byAgent[agentCode].add(ticketKey);
  }

  const totalTickets = seenTickets.size;
  const byAgentCounts = {};

  Object.entries(byAgent).forEach(([agentCode, set]) => {
    byAgentCounts[agentCode] = set.size;
  });

  cashSession.numtickets = totalTickets;
  cashSession.ticketCountByAgent = byAgentCounts;

  return {
    totalTickets,
    byAgent: byAgentCounts,
  };
}

async function buildAgentSalesSummaryForCaja(idcaja) {
  const facturas = await fetchApiResourceWithParams("facturaclientes", {
    "filter[idcaja]": idcaja,
    limit: 0,
  });

  const map = {};
  const labelMap = window.__PAYMETHOD_LABELS__ || {};

  for (const f of Array.isArray(facturas) ? facturas : []) {
    if (f.tpv_venta !== true) continue;

    const agentCode = String(f.codagente || "").trim() || "—";
    const ticketTotal = roundMoney2(f.total || 0);

    if (!map[agentCode]) {
      map[agentCode] = {
        agentCode,
        agentName: getAgentLabel(agentCode),
        total: 0,
        count: 0, // nº tickets
        paymentUses: 0, // nº pagos/recibos
        byMethod: {}, // codpago -> { code, label, total, count }
      };
    }

    const ag = map[agentCode];
    ag.total = roundMoney2(ag.total + ticketTotal);
    ag.count += 1;

    const breakdown = await getFacturaPaymentBreakdown(f);
    ag.paymentUses += Number(breakdown.paymentUses || 0);

    for (const line of breakdown.lines || []) {
      const payCode = normalizePayCode(line.codpago);
      const amount = roundMoney2(line.importe || 0);
      const uses = Number(line.count || 0);

      if (!ag.byMethod[payCode]) {
        ag.byMethod[payCode] = {
          code: payCode,
          label: labelMap[payCode] || payCode,
          total: 0,
          count: 0,
        };
      }

      ag.byMethod[payCode].total = roundMoney2(
        ag.byMethod[payCode].total + amount,
      );
      ag.byMethod[payCode].count += uses;
    }
  }

  return Object.values(map).sort((a, b) => (b.total || 0) - (a.total || 0));
}

// ---- Apertura / cierre de caja ----

function closeCashOpenDialog() {
  if (!cashOpenOverlay) return;

  cashOpenOverlay.classList.add("hidden");
  unlockAppUI?.();
}

const cashOpenCloseX = document.getElementById("cashOpenCloseX");
const cashOpenCancelBtn = document.getElementById("cashOpenCancelBtn");

cashOpenCloseX?.addEventListener("click", closeCashOpenDialog);
cashOpenCancelBtn?.addEventListener("click", closeCashOpenDialog);

// ✅ QWERTY robusto para #cashObs (solo abre en tap real, no en scroll)
function setupCashObsQwertyDelegated() {
  if (!cashOpenOverlay) return;

  // evita duplicar listeners
  if (cashOpenOverlay.dataset._cashObsQwerty === "1") return;
  cashOpenOverlay.dataset._cashObsQwerty = "1";

  const MOVE_TOLERANCE = 12; // px táctiles tolerados
  const TAP_MAX_TIME = 500; // ms máximo para considerarlo tap

  let touchState = null;

  const openFor = (ta) => {
    if (!ta) return;

    if (typeof window.openQwertyForInput === "function") {
      window.openQwertyForInput(ta, "text");
      return;
    }

    if (typeof window.openTextKeyboard === "function") {
      window.openTextKeyboard(ta);
      return;
    }

    ta.readOnly = false;
    try {
      ta.focus();
    } catch {}
    toast?.("No hay teclado QWERTY disponible en este TPV.", "warn", "Teclado");
  };

  cashOpenOverlay.addEventListener(
    "pointerdown",
    (e) => {
      const ta =
        e.target && e.target.closest ? e.target.closest("#cashObs") : null;
      if (!ta) return;

      touchState = {
        ta,
        startX: e.clientX,
        startY: e.clientY,
        startTime: Date.now(),
        moved: false,
        pointerId: e.pointerId,
      };
    },
    true,
  );

  cashOpenOverlay.addEventListener(
    "pointermove",
    (e) => {
      if (!touchState) return;
      if (e.pointerId !== touchState.pointerId) return;

      const dx = Math.abs(e.clientX - touchState.startX);
      const dy = Math.abs(e.clientY - touchState.startY);

      if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
        touchState.moved = true;
      }
    },
    true,
  );

  cashOpenOverlay.addEventListener(
    "pointerup",
    (e) => {
      if (!touchState) return;
      if (e.pointerId !== touchState.pointerId) return;

      const ta = touchState.ta;
      const elapsed = Date.now() - touchState.startTime;
      const wasTap = !touchState.moved && elapsed <= TAP_MAX_TIME;

      const state = touchState;
      touchState = null;

      if (!ta || !wasTap) return;

      e.preventDefault();
      e.stopPropagation();

      ta.readOnly = true;
      openFor(ta);
    },
    true,
  );

  cashOpenOverlay.addEventListener(
    "pointercancel",
    () => {
      touchState = null;
    },
    true,
  );
}

function openCashOpenDialog(mode = "open") {
  setCashDialogMode(mode);

  // ✅ BLOQUEO SOLO SI REALMENTE TENEMOS CAJA ABIERTA EN SESIÓN
  if (mode === "open") {
    const remoteId = Number(localStorage.getItem("tpv_remoteCajaId") || 0) || 0;
    if (cashSession?.open && remoteId) {
      console.log(
        "[TPV] Apertura bloqueada: ya hay caja abierta en sesión",
        remoteId,
      );
      return;
    }
  }

  if (LOGIN_ACTIVE) return;
  if (!cashOpenOverlay) return;
  if (!currentTerminal) {
    toast("Selecciona un terminal primero.", "warn", "Caja");
    return;
  }

  cashDialogMode = mode;

  const titleEl = document.getElementById("cashDialogTitle");
  if (titleEl) {
    titleEl.textContent =
      mode === "open" ? "Apertura de caja" : "Cierre de caja";
  }
  if (cashOpenOkBtn) {
    cashOpenOkBtn.textContent = mode === "open" ? "Abrir caja" : "Cerrar caja";
  }

  if (cashCloseSummary) {
    cashCloseSummary.style.display = mode === "close" ? "block" : "none";
  }

  if (cashOpenTerminalName) {
    cashOpenTerminalName.textContent = currentTerminal.name;
  }

  const inputs = cashOpenOverlay.querySelectorAll(
    ".cash-grid-page input[data-denom]",
  );
  inputs.forEach((inp) => (inp.value = "0"));
  cashOpenOverlay.querySelectorAll(".cash-qty").forEach((s) => {
    s.textContent = "0";
  });

  // 👉 AQUÍ LA DIFERENCIA:
  if (mode === "open") {
    const l1 = document.getElementById("cashCloseLine1");
    const l2 = document.getElementById("cashCloseLine2");
    const l3 = document.getElementById("cashCloseLine3");
    if (l1) l1.style.display = "none";
    if (l2) l2.style.display = "none";
    if (l3) l3.style.display = "none";

    if (cashDirectTotalWrap) cashDirectTotalWrap.style.display = "block";

    cashResetUIForOpening();
    cashWrapInputsWithSteppers();
    updateCashOpenTotal(); // solo afecta a apertura
  } else {
    if (cashDirectTotalWrap) cashDirectTotalWrap.style.display = "none";

    // MODO CIERRE: cargamos datos reales desde FacturaScripts
    const l1 = document.getElementById("cashCloseLine1");
    const l2 = document.getElementById("cashCloseLine2");
    const l3 = document.getElementById("cashCloseLine3");
    if (l1) l1.style.display = "grid";
    if (l2) l2.style.display = "none"; // se mostrará cuando haya datos
    if (l3) l3.style.display = "none"; // se mostrará en updateCloseSummary
    (async () => {
      try {
        const remoteCaja = await apiReadCurrentCaja();
        if (!remoteCaja) {
          updateCloseSummary(Number(cashSession.closingTotal || 0));
          return;
        }

        // 1) aplicar caja remota
        applyRemoteCajaToSession(remoteCaja);
        fillCashObsTextareaFromRemote(remoteCaja);
        renderCashCloseHeaderCard(remoteCaja);

        // 2) labels
        await ensurePayMethodLabelsLoaded();

        // 3) construir resúmenes (IMPORTANTE: sin duplicar)
        const cajaId = cashSession.remoteCajaId || remoteCaja.idcaja;

        // ✅ tickets reales de la caja
        await hydrateCloseTicketStatsForCaja(cajaId);

        // Métodos (TOTAL)
        await hydratePaymentsByMethodForClose(cajaId);

        // Agentes + métodos por agente
        cashSession.agentSalesSummary =
          await buildAgentSalesSummaryForCaja(cajaId);

        // 4) pintar UI en el orden correcto
        renderCashCloseTotalMeta(); // ✅ TOTAL + (Agente si solo 1)
        renderPayMethodsSummary(); // ✅ TOTAL por métodos
        renderAgentSalesSummary(); // ✅ por agente (solo si >1)

        // 5) resumen superior (cifra esperada, etc.)
        updateCloseSummary(Number(cashSession.closingTotal || 0));
        if (cashDirectTotalEl) {
          cashDirectTotalEl.value = formatCashDirectAmount(
            Number(cashSession.closingTotal || 0),
          );
        }
      } catch (e) {
        console.warn("No se pudo leer la caja remota:", e);
        updateCloseSummary(Number(cashSession.closingTotal || 0));
        if (cashDirectTotalEl) {
          cashDirectTotalEl.value = formatCashDirectAmount(
            Number(cashSession.closingTotal || 0),
          );
        }
      }
    })();
  }

  bindCashDirectTotalInput();

  if (cashDirectTotalEl) {
    const currentTotal =
      cashDialogMode === "open"
        ? Number(cashSession.openingTotal || 0)
        : Number(cashSession.closingTotal || 0);

    cashDirectTotalEl.value = formatCashDirectAmount(currentTotal);
  }

  cashOpenOverlay.classList.remove("hidden");
  lockAppUI?.();
  setTimeout(setupCashObsQwertyDelegated, 0);
}

function buildCashClosePrintData(remoteCaja) {
  const now = new Date();
  const fecha = now.toLocaleDateString("es-ES");
  const hora = now.toTimeString().slice(0, 8);

  const cajaId = remoteCaja?.idcaja ?? cashSession.remoteCajaId ?? "";

  const terminal =
    (
      currentTerminal?.name ||
      (remoteCaja?.idtpv != null ? `TPV ${remoteCaja.idtpv}` : "")
    ).trim() || "—";

  const fechaini = remoteCaja?.fechaini ? String(remoteCaja.fechaini) : "—";

  const totalVendido = Number(
    remoteCaja?.totaltickets ?? cashSession.totalSales ?? 0,
  );
  const numTickets = Number(
    remoteCaja?.numtickets ?? cashSession.numtickets ?? 0,
  );

  const openingTotal = Number(
    cashSession.openingTotal || remoteCaja?.dineroini || 0,
  );
  const cashIncome = Number(
    cashSession.cashSalesTotal || remoteCaja?.ingresos || 0,
  );
  const movements = Number(
    cashSession.cashMovementsTotal || remoteCaja?.totalmovi || 0,
  );

  const expectedCash =
    cashSession.expectedCashFS != null
      ? Number(cashSession.expectedCashFS)
      : Number(
          remoteCaja?.totalcaja != null
            ? remoteCaja.totalcaja
            : openingTotal + cashIncome + movements,
        );

  const countedCash = Number(cashSession.closingTotal || 0);
  const difference = countedCash - expectedCash;

  const labelMap = window.__PAYMETHOD_LABELS__ || {};
  const methods = Object.values(cashSession.paymentsByMethod || {}).map((m) => {
    const code = normalizePayCode(m.code || m.codpago);
    return {
      code,
      label: labelMap[code] || m.label || code,
      total: Number(m.total || 0),
      count: Number(m.count || 0), // nº pagos/recibos
    };
  });

  methods.sort((a, b) =>
    (a.label || a.code).localeCompare(b.label || b.code, "es", {
      sensitivity: "base",
    }),
  );

  const totalPaymentUses =
    Number(cashSession.totalPaymentUses || 0) ||
    methods.reduce((s, m) => s + Number(m.count || 0), 0);

  const obs = String(document.getElementById("cashObs")?.value || "").trim();
  const rawCajaObs = String(remoteCaja?.observaciones || "");
  const { autoLines } = splitCajaObservaciones(rawCajaObs);
  const autoLogText = Array.isArray(autoLines) ? autoLines.join("\n\n") : "";

  return {
    fecha,
    hora,
    companyShortName: companyInfo?.nombrecorto || "",
    companyLegalName: companyInfo?.nombre || "",
    cajaId,
    terminal,
    fechaini,
    totalVendido,
    numTickets,
    totalPaymentUses,
    openingTotal,
    cashIncome,
    movements,
    expectedCash,
    countedCash,
    difference,
    methods,
    agentSales: Array.isArray(cashSession.agentSalesSummary)
      ? cashSession.agentSalesSummary
      : [],
    userObs: obs,
    autoLogText,
  };
}

function openCashMoveDialog() {
  if (!cashSession.open) {
    toast("Primero debes abrir la caja.", "warn", "Caja");
    return;
  }
  if (!cashMoveOverlay) return;

  // ✅ LOG: abrió modal movimientos
  try {
    const idcaja = getCajaIdSafe();
    const ctx = {
      agentName: currentAgent?.name || currentAgent?.nick || "—",
      tpvName: currentTerminal?.name || "—",
    };
    if (idcaja) {
      appendCajaAutoLogLineForId(
        idcaja,
        buildCajaLogLineWith(ctx, "ABRIÓ VENTANA MOVIMIENTOS"),
      ).catch(() => {});
    }
  } catch {}

  // Reset campos
  if (cashMoveAmountEl) cashMoveAmountEl.value = "";
  if (cashMoveReasonEl) cashMoveReasonEl.value = "";
  if (cashMoveErrorEl) cashMoveErrorEl.textContent = "";

  const radios = cashMoveOverlay.querySelectorAll('input[name="cashMoveType"]');
  if (radios && radios[0]) radios[0].checked = true;

  cashMoveOverlay.classList.remove("hidden");
  lockAppUI();
}

function closeCashMoveDialog() {
  if (!cashMoveOverlay) return;
  cashMoveOverlay.classList.add("hidden");
  unlockAppUI();
}

if (cashMoveBtn) {
  cashMoveBtn.onclick = async () => {
    openCashMoveDialog();
  };
}

if (cashMoveCancelBtn) {
  cashMoveCancelBtn.onclick = () => {
    closeCashMoveDialog();
  };
}

if (cashMoveCloseX) {
  cashMoveCloseX.onclick = () => {
    closeCashMoveDialog();
  };
}

// Cerrar clicando fuera del recuadro
if (cashMoveOverlay) {
  cashMoveOverlay.addEventListener("click", (e) => {
    const box = e.target.closest(".simple-dialog");
    if (!box) {
      closeCashMoveDialog();
    }
  });
}

function getCashHiddenInput(denom) {
  return cashOpenOverlay?.querySelector(
    `.cash-hidden-input[data-denom="${denom}"]`,
  );
}

function syncCashQtyLabel(denom, qty) {
  const label = cashOpenOverlay?.querySelector(
    `.cash-qty[data-denom="${denom}"]`,
  );
  if (label) label.textContent = String(qty);
}

function setCashQtyByDenom(denom, qty) {
  const inp = getCashHiddenInput(denom);
  if (!inp) return;

  const n = Math.max(0, Math.floor(Number(qty) || 0));
  inp.value = String(n);
  syncCashQtyLabel(denom, n);
  updateCashOpenTotal();
}

function getCashQtyByDenom(denom) {
  const inp = getCashHiddenInput(denom);
  return Math.max(0, parseInt(inp?.value || "0", 10) || 0);
}

// Delegación de click para + / − / editar
if (cashOpenOverlay && !cashOpenOverlay.dataset.cashBound) {
  cashOpenOverlay.dataset.cashBound = "1";

  cashOpenOverlay.addEventListener("click", (e) => {
    const minusBtn = e.target.closest('.cash-step-btn[data-action="minus"]');
    const plusBtn = e.target.closest('.cash-step-btn[data-action="plus"]');
    const editBtn = e.target.closest('.cash-qty-btn[data-action="edit"]');

    // Averigua denom desde el botón o desde la celda
    const cell = e.target.closest(".cash-cell-page");
    if (!cell) return;

    const denom =
      editBtn?.dataset?.denom ||
      cell.querySelector(".cash-qty")?.dataset?.denom ||
      cell.querySelector(".cash-hidden-input")?.dataset?.denom;

    if (!denom) return;

    const current = getCashQtyByDenom(denom);

    if (minusBtn) {
      setCashQtyByDenom(denom, current - 1);
      return;
    }

    if (plusBtn) {
      setCashQtyByDenom(denom, current + 1);
      return;
    }

    if (editBtn) {
      // Abre tu numpad existente
      openNumPad(
        String(current),
        (newQty) =>
          setCashQtyByDenom(denom, Math.max(0, parseInt(newQty, 10) || 0)),
        `Cantidad de ${denom} €`,
        "cash", // o un modo nuevo "int"
      );
      return;
    }
  });
}

function hideCashOpenDialog() {
  if (!cashOpenOverlay) return;
  cashOpenOverlay.classList.add("hidden");
  unlockAppUI?.();
}

function updateCashOpenTotal() {
  if (!cashOpenOverlay || !cashOpenTotalEl) return;

  let total = 0;
  const inputs = cashOpenOverlay.querySelectorAll(".cash-hidden-input");
  const breakdown = [];

  inputs.forEach((inp) => {
    const denom = parseFloat(inp.dataset.denom || "0");
    const qty = parseInt(inp.value || "0", 10);

    if (isNaN(denom) || isNaN(qty)) return;

    const lineTotal = denom * qty;
    total += lineTotal;

    if (qty > 0) {
      breakdown.push({
        denom,
        qty,
        total: lineTotal,
      });
    }
  });

  total = Math.round((total + Number.EPSILON) * 100) / 100;

  if (cashDialogMode === "open") {
    // Guardamos apertura
    cashSession.openingTotal = total;
    cashSession.openingBreakdown = breakdown.map((b) => ({ ...b }));
    cashSession.currentCashBreakdown = breakdown.map((b) => ({ ...b }));
  } else {
    // Guardamos cierre
    cashSession.closingTotal = total;
    cashSession.closingBreakdown = breakdown.map((b) => ({ ...b }));
    updateCloseSummary(total);
  }

  // Total mostrado en el diálogo
  cashOpenTotalEl.textContent = total.toFixed(2).replace(".", ",") + " €";

  // ✅ sincroniza el input directo
  if (cashDirectTotalEl) {
    cashDirectTotalEl.value = formatCashDirectAmount(total);
  }
}

function ensureCashSessionCounters() {
  if (!cashSession) cashSession = {};
  if (!cashSession.payMethodCounts) cashSession.payMethodCounts = {}; // { CONT: 2, BIZU: 1, ... }
}

function registerPayMethodUsageForTicket(pagos) {
  if (!Array.isArray(pagos) || !pagos.length) return;

  if (!cashSession.paymentsByMethod) cashSession.paymentsByMethod = {};

  // 1 uso por método por ticket (aunque el ticket tenga 2 líneas raras del mismo método)
  const unique = new Set(
    pagos
      .map((p) =>
        String(p?.codpago || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  );

  unique.forEach((key) => {
    const entry = cashSession.paymentsByMethod[key] || {
      code: key,
      label: key,
      total: 0,
      count: 0,
    };

    entry.count = Number(entry.count) || 0;

    cashSession.paymentsByMethod[key] = entry;
  });
}

async function confirmCashOpening() {
  ensureCashSessionCounters();
  resetCashRuntimeForNewCaja();

  cashSession.open = true;
  cashSession.openedAt = new Date().toISOString();

  try {
    await apiOpenCashInFS();

    const idcaja = getCajaIdSafe();
    if (idcaja) {
      clearCashLedger(idcaja);
      loadCashLedgerIntoSession(idcaja);
    }
  } catch (e) {
    console.warn("No se pudo abrir caja en FacturaScripts:", e?.message || e);
    toast(
      "Caja abierta, pero no se pudo registrar en FacturaScripts.",
      "warn",
      "Caja",
    );
  }

  hideCashOpenDialog();

  if (terminalNameEl && currentTerminal)
    terminalNameEl.textContent = currentTerminal.name || "---";
  setTerminalNameClickable(Array.isArray(terminals) && terminals.length > 1);
  if (agentNameEl)
    agentNameEl.textContent = currentAgent ? currentAgent.name : "---";

  renderMainUI();
  renderMainAgentBar();
  updateCashButtonLabel();
  renderCashIdChip();
}

async function confirmCashClosing() {
  try {
    if (cashOpenOkBtn) cashOpenOkBtn.disabled = true;
  } catch {}

  const idcaja = getCajaIdSafe();

  let remoteCaja = null;
  try {
    remoteCaja = idcaja
      ? await apiReadCajaById(idcaja)
      : await apiReadCurrentCaja();
  } catch (e) {
    console.warn("No pude leer caja para imprimir:", e?.message || e);
  }

  try {
    const report = buildCashClosePrintData(remoteCaja || {});
    report.payEditsCount = await getPayEditsCountForCaja(idcaja);
    await printCashCloseReport(report);
  } catch (e) {
    console.warn("No se pudo imprimir el cierre:", e?.message || e);
  }

  let closedOk = false;
  try {
    await apiCloseCashInFS();

    // ✅ verificar (si podemos) que ya NO está abierta
    const check = idcaja ? await apiReadCajaById(idcaja) : null;
    closedOk = !!check && !isCajaOpen(check);

    // si no pudimos verificar por cualquier cosa, asumimos OK
    if (!check) closedOk = true;
  } catch (e) {
    console.warn("No se pudo cerrar caja en FacturaScripts:", e?.message || e);
    toast("No se pudo registrar el cierre en FacturaScripts.", "warn", "Caja");
  }

  if (!closedOk) {
    toast("No se pudo cerrar la caja. Reintenta.", "warn", "Caja");
    try {
      if (cashOpenOkBtn) cashOpenOkBtn.disabled = false;
    } catch {}
    return;
  }

  cashSession.open = false;
  pushCustomerState();
  cashSession.remoteCajaId = null;
  try {
    localStorage.removeItem("tpv_remoteCajaId");
  } catch {}

  hideCashOpenDialog();
  updateCashButtonLabel();
  renderCashIdChip();
  cashOpenDialogShown = false;

  // ✅ al cerrar caja: mantenemos terminal (para evitar limbos)
  // y vaciamos agente (o ponemos el default luego)
  currentAgent = null;

  if (terminalNameEl)
    terminalNameEl.textContent = currentTerminal?.name || "---";
  if (agentNameEl) agentNameEl.textContent = "---";
  refreshLoggedUserUI();

  if (mainAgentBar) mainAgentBar.innerHTML = "";

  selectedCategory = null;
  activeFamilyParentId = null;
  activeSubfamilyId = null;
  cart = [];
  renderCart();

  const grid = document.getElementById("productsGrid");
  const catContainer = document.getElementById("categories");
  const subCatContainer = document.getElementById("subcategories");
  if (grid) grid.innerHTML = "";
  if (catContainer) catContainer.innerHTML = "";
  if (subCatContainer) subCatContainer.innerHTML = "";

  mainUiRendered = false;

  const printBtn = document.getElementById("printTicketBtn");
  if (printBtn) printBtn.disabled = true;

  lastTicket = null;

  renderCashIdChip(); // redundante pero evita “reaparición” por renders tardíos

  try {
    if (cashOpenOkBtn) cashOpenOkBtn.disabled = false;
  } catch {}
}

// ===== Llamadas a API Recipok / FacturaScripts =====
async function fetchApiResource(resource) {
  const cfg = window.RECIPOK_API;
  if (!cfg || !cfg.baseUrl || !cfg.apiKey) {
    throw new Error("Config API no definida");
  }

  const url = `${cfg.baseUrl}/${resource}?limit=0`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
    },
  });

  // Si el servidor devuelve 429, paramos aquí con un mensaje claro
  if (res.status === 429) {
    throw new Error(
      "La API ha devuelto 429 (demasiadas peticiones). " +
        "Es un bloqueo temporal por seguridad. Espera unos minutos antes de seguir usando el TPV.",
    );
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    console.error(`Respuesta no es JSON para ${resource}:`, e);
    throw new Error(`Respuesta no válida en ${resource}`);
  }

  if (data && data.status === "error") {
    throw new Error(data.message || `Error API en ${resource}`);
  }

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} en ${resource}: ${res.statusText || ""}`,
    );
  }

  if (!Array.isArray(data)) {
    console.warn(`Formato inesperado para ${resource}:`, data);
  }

  return data;
}

async function fetchFormasPagoActivas(opts = {}) {
  const { forceOnlineIfPossible = false } = opts;

  // Si estamos offline y no forzamos online, devolvemos cache
  if (!forceOnlineIfPossible && TPV_STATE?.offline) {
    const cached = loadPayMethodsCache();
    return Array.isArray(cached) ? cached : [];
  }

  try {
    // Online: pedir al endpoint
    const data = await fetchApiResourceWithParams("formapagos", {
      limit: 200,
      order: "asc",
      "filter[activa]": 1, // FacturaScripts suele aceptar 1/0
    });

    const list = (Array.isArray(data) ? data : [])
      .filter((f) => f && f.activa === true) // por si el filtro no se aplica en server
      // opcional: solo imprimibles
      // .filter((f) => f.imprimir !== false)
      .map((f) => ({
        activa: !!f.activa,
        codpago: String(f.codpago || "").trim(),
        descripcion: String(f.descripcion || f.codpago || "").trim(),
        domiciliado: !!f.domiciliado,
        imprimir: f.imprimir !== false,
        pagado: !!f.pagado,
        plazovencimiento: Number(f.plazovencimiento || 0),
        tipovencimiento: String(f.tipovencimiento || "days"),
        idempresa: f.idempresa ?? null,
        codcuentabanco: f.codcuentabanco ?? null,
      }))
      .filter((x) => x.codpago);

    // ✅ Detectar cuáles son "efectivo/contado" desde la API (sin hardcodear códigos)
    try {
      window.__CASH_CODPAGOS__ = list
        .filter((f) => {
          const desc = String(f.descripcion || "").toLowerCase();
          return (
            desc.includes("contado") ||
            desc.includes("efectivo") ||
            desc.includes("cash")
          );
        })
        .map((f) =>
          String(f.codpago || "")
            .trim()
            .toUpperCase(),
        );
    } catch (e) {
      window.__CASH_CODPAGOS__ = [];
    }

    // Guardar caché SIEMPRE que haya algo válido
    if (list.length) savePayMethodsCache(list);

    // ✅ construir lista de codpago que son EFECTIVO, basado en /formapagos
    CASH_CODPAGOS = buildCashCodpagosFromFormapagos(list);

    return list;
  } catch (e) {
    // Fallback: si falla online, usamos caché
    const cached = loadPayMethodsCache();
    if (Array.isArray(cached) && cached.length) {
      CASH_CODPAGOS = buildCashCodpagosFromFormapagos(cached);
      return cached;
    }

    const fallback = [
      { codpago: "CONT", descripcion: "Al contado", imprimir: true },
    ];
    CASH_CODPAGOS = buildCashCodpagosFromFormapagos(fallback);
    return fallback;
  }
}

// Eventos overlay terminal (modo selección para abrir caja o cambio rápido)
if (terminalOkBtn) {
  terminalOkBtn.onclick = async () => {
    // ✅ CAMBIO RÁPIDO SOLO TERMINAL
    if (terminalOverlayMode === "terminalSwitch") {
      if (
        !terminalSelect ||
        !Array.isArray(terminals) ||
        terminals.length <= 1
      ) {
        hideTerminalOverlay();
        return;
      }

      const selectedId = terminalSelect.value;
      const selectedTerminal = terminals.find(
        (t) => String(t.id) === String(selectedId),
      );

      if (!selectedTerminal) {
        terminalErrorEl.textContent = "Selecciona un terminal válido.";
        return;
      }

      setCurrentTerminal(selectedTerminal);
      await applyTerminalDefaultCustomer?.();

      // UI
      if (terminalNameEl)
        terminalNameEl.textContent = selectedTerminal.name || "---";

      // Si el agente actual no pertenece al nuevo terminal, lo anulamos
      const newAgents = getAgentsForTerminalId(selectedTerminal.id) || [];
      if (
        currentAgent &&
        !newAgents.some((a) => a.codagente === currentAgent.codagente)
      ) {
        currentAgent = null;
        if (agentNameEl) agentNameEl.textContent = "---";
      }

      renderMainAgentBar();
      hideTerminalOverlay();
      return;
    }
    // CAMBIO RÁPIDO DE AGENTE
    if (terminalOverlayMode === "agentSwitch") {
      // 1) Si hay selector de terminal visible, actualizamos terminal
      if (terminals.length > 1 && terminalSelectWrapper && terminalSelect) {
        const selectedId = terminalSelect.value;
        const t = terminals.find((x) => String(x.id) === String(selectedId));
        if (t) setCurrentTerminal(t);
      }

      const terminalId = currentTerminal?.id || null;
      const list = terminalId ? getAgentsForTerminalId(terminalId) : [];

      // 2) Si ese terminal no tiene agentes, no permitimos continuar
      if (!list || list.length === 0) {
        terminalErrorEl.textContent =
          "Este terminal no tiene agentes asignados.";
        return;
      }

      // 3) Si hay agentes y no hay currentAgent, obligamos a seleccionar
      if (!currentAgent) {
        terminalErrorEl.textContent = "Selecciona un agente válido.";
        return;
      }

      if (agentNameEl && currentAgent) {
        agentNameEl.textContent = currentAgent.name;
      }

      renderMainAgentBar();

      refreshAgentGuardUI?.();

      document.dispatchEvent(
        new CustomEvent("tpv:sessionReady", {
          detail: {
            idtpv: currentTerminal?.id || null,
            codagente: currentAgent?.codagente || null,
            user: getLoginUser(),
          },
        }),
      );

      hideTerminalOverlay();
      return;
    }

    // MODO SESIÓN (abrir caja)
    let selectedTerminal = currentTerminal;

    if (terminals.length > 1 && terminalSelectWrapper && terminalSelect) {
      const selectedId = terminalSelect.value;

      selectedTerminal = terminals.find(
        (t) => String(t.id) === String(selectedId),
      );

      if (!selectedTerminal) {
        terminalErrorEl.textContent = "Selecciona un terminal válido.";
        return;
      }

      setCurrentTerminal(selectedTerminal);
      await applyTerminalDefaultCustomer();
    }

    const list = selectedTerminal
      ? getAgentsForTerminalId(selectedTerminal.id)
      : [];

    if (list.length > 1 && !currentAgent) {
      terminalErrorEl.textContent = "Selecciona un agente válido.";
      return;
    }

    if (!currentAgent && list.length === 1) {
      currentAgent = list[0];
    }

    refreshAgentGuardUI?.();

    // ✅ solo dispara sessionReady
    document.dispatchEvent(
      new CustomEvent("tpv:sessionReady", {
        detail: {
          idtpv: selectedTerminal?.id || currentTerminal?.id || null,
          codagente: currentAgent?.codagente || null,
          user: getLoginUser(),
        },
      }),
    );

    hideTerminalOverlay();
    return;
  };
}

if (terminalExitBtn) {
  terminalExitBtn.onclick = () => {
    hideTerminalOverlay();
  };
}

// Eventos apertura de caja
if (cashOpenOverlay) {
  const inputs = cashOpenOverlay.querySelectorAll(".cash-hidden-input");
  inputs.forEach((inp) => {
    inp.addEventListener("input", updateCashOpenTotal);
  });
}

const cashOpenOkBtn = document.getElementById("cashOpenOkBtn");

if (cashOpenCancelBtn) {
  cashOpenCancelBtn.onclick = () => {
    // ✅ Si cancela apertura, permitir que vuelva a mostrarse luego
    if (cashDialogMode === "open") {
      cashOpenDialogShown = false; // <-- CLAVE anti-limbo
      cashSession.open = false;
      pushCustomerState();
      cashSession.remoteCajaId = null;
      try {
        localStorage.removeItem("tpv_remoteCajaId");
      } catch {}
      renderCashIdChip();
      updateCashButtonLabel?.();
    }

    hideCashOpenDialog();

    // Si estábamos abriendo caja y aún no hay caja abierta,
    // dejamos TPV y agente visualmente como "---"
    if (cashDialogMode === "open" && !cashSession.open) {
      currentTerminal = null;
      currentAgent = null;
      if (terminalNameEl) terminalNameEl.textContent = "---";
      if (agentNameEl) agentNameEl.textContent = "---";
    }
  };
}

if (cashOpenOkBtn) {
  cashOpenOkBtn.onclick = async () => {
    // anti doble click
    cashOpenOkBtn.disabled = true;

    const ctx = getLogCtx();

    try {
      if (cashDialogMode === "open") {
        await confirmCashOpening();
        return;
      }

      const parkedCount = Array.isArray(parkedTickets)
        ? parkedTickets.length
        : 0;
      if (parkedCount > 0) {
        await confirmModal(
          "No puedes cerrar la caja",
          `Tienes ${parkedCount} ticket(s) aparcado(s).\n\nRecupéralos (o elimínalos) antes de cerrar la caja.`,
        );
        openParkedModal();
        return;
      }

      const ok = await confirmCashCloseModal(
        "¿Seguro que quieres cerrar la caja?\n\nEsta acción registrará el cierre y no se puede deshacer.",
      );
      if (!ok) return;

      // LOG: abrió ventana cerrar caja
      try {
        if (ctx.idcaja) {
          await appendCajaAutoLogLineForId(
            ctx.idcaja,
            buildCajaLogLineWith(ctx, 'ABRIÓ VENTANA "Cerrar caja"'),
          );
        }
      } catch (e) {
        console.warn("No pude registrar pulsó cerrar caja:", e?.message || e);
      }

      // Guardar observaciones del usuario (textarea)
      try {
        if (ctx.idcaja) await saveUserObsToCajaForId(ctx.idcaja);
      } catch (e) {
        console.warn("No pude guardar observaciones usuario:", e?.message || e);
      }

      // ✅ Cierre completo (imprime + cierra FS + limpia)
      await confirmCashClosing();
    } finally {
      cashOpenOkBtn.disabled = false;
    }
  };
}

// ===== Caja (logs) en FacturaScripts =====

// 1) Request genérico (form-urlencoded) para POST/PUT/DELETE
async function apiWrite(resource, method = "POST", fields = {}) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Config API no definida");

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/${String(resource).replace(/^\/+/, "")}`;

  const body = new URLSearchParams();
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    body.append(k, String(v));
  });

  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const text = await res.text(); // <- leemos el texto bruto
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    // no es JSON, no pasa nada
  }

  if (!res.ok || (data && data.status === "error")) {
    console.error(
      "⚠️ Error API en",
      resource,
      "HTTP",
      res.status,
      "Respuesta:",
      text,
    );
    throw new Error(data?.message || `HTTP ${res.status} en ${resource}`);
  }

  return data;
}

async function apiCreatePresupuestoFromCart(obs = "") {
  if (TPV_STATE.offline || TPV_STATE.locked) return null;

  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) {
    console.warn("Sin config de API para crear presupuesto.");
    return null;
  }

  const payload = buildPresupuestoPayloadFromCart(obs);

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/crearPresupuestoCliente`;

  const body = new URLSearchParams();

  body.append("codcliente", payload.codcliente);

  if (payload.codalmacen) body.append("codalmacen", payload.codalmacen);
  if (payload.codpago) body.append("codpago", payload.codpago);
  if (payload.codserie) body.append("codserie", payload.codserie);
  if (payload.fecha) body.append("fecha", payload.fecha);
  if (payload.observaciones)
    body.append("observaciones", payload.observaciones);

  body.append("aparcado", payload.aparcado ? "1" : "0");

  if (payload.idtpv) body.append("idtpv", String(payload.idtpv));
  if (payload.idcaja) body.append("idcaja", String(payload.idcaja));

  // Igual que en crearFacturaCliente: líneas como JSON
  body.append("lineas", JSON.stringify(payload.lineas));

  // 🔍 Log de depuración parecido al de la factura
  console.log(">>> Enviando a crearPresupuestoCliente:", body.toString());

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Token: cfg.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || (data && data.status === "error")) {
      throw new Error(data?.message || "Error creando presupuesto");
    }

    console.log("Respuesta OK crearPresupuestoCliente:", data);
    return data;
  } catch (e) {
    console.warn("No se pudo crear presupuesto en FacturaScripts:", e);
    toast(
      "Ticket aparcado solo en local (no se registró en FacturaScripts).",
      "warn",
      "Aparcar",
    );
    return null;
  }
}

// 2) Fecha/hora estilo FacturaScripts: "YYYY-MM-DD HH:mm:ss"
function nowFs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 3) Abrir/cerrar caja remota (tpvcajas)
// NOTA: si en tu FS el recurso no es "tpvcajas", lo cambiamos al real.
async function apiOpenCashInFS() {
  if (TPV_STATE.offline || TPV_STATE.locked) return null;
  if (!currentTerminal?.id) throw new Error("No hay terminal seleccionado");

  // ✅ Si ya hay id remoto, NO abras otra caja por accidente
  const existing =
    Number(cashSession?.remoteCajaId || 0) ||
    Number(localStorage.getItem("tpv_remoteCajaId") || 0);

  if (existing) {
    cashSession.remoteCajaId = existing;
    return { ok: true, reused: true, idcaja: existing };
  }

  const payload = {
    idtpv: Number(currentTerminal.id),
    fechaini: nowFs(),
    dineroini: Number(cashSession.openingTotal || 0),
    nick: getLoginUser(),
    observaciones: "",
  };

  const resp = await apiWrite("tpvcajas", "POST", payload);

  // ✅ FacturaScripts puede devolver el id en distintos formatos
  const doc = resp?.doc || resp?.data || resp;

  const remoteIdRaw =
    doc?.idcaja ??
    doc?.idCaja ??
    doc?.idtpvcaja ??
    doc?.idtpvCaja ??
    doc?.id ??
    resp?.idcaja ??
    resp?.id ??
    null;

  const remoteId = Number(remoteIdRaw || 0) || null;

  if (!remoteId) {
    console.warn("⚠️ No pude detectar el id de caja en la respuesta:", resp);
    // Importante: NO guardes "" porque luego te rompe los flujos
    try {
      localStorage.removeItem("tpv_remoteCajaId");
    } catch {}
    cashSession.remoteCajaId = null;
    return resp;
  }

  cashSession.remoteCajaId = remoteId;

  // ✅ persiste para poder cerrar aunque se recargue la app
  try {
    localStorage.setItem("tpv_remoteCajaId", String(remoteId));
  } catch {}

  return resp;
}

try {
  const saved = localStorage.getItem("tpv_remoteCajaId");
  if (saved && !cashSession.remoteCajaId) cashSession.remoteCajaId = saved;
} catch (e) {}

async function apiCloseCashInFS() {
  if (TPV_STATE.offline || TPV_STATE.locked) return null;

  let remoteId = getCajaIdSafe();
  if (!remoteId) {
    console.warn("No pude encontrar idcaja para cerrar.");
    return null;
  }

  // 🔒 Leer caja para conservar observaciones actuales
  let remoteCaja = null;
  try {
    remoteCaja = await apiReadCajaById(remoteId);
  } catch {}

  const opening = Number(cashSession.openingTotal || 0);
  const cashIncome = Number(cashSession.cashSalesTotal || 0);
  const movements = Number(cashSession.cashMovementsTotal || 0);
  const expectedCash = opening + cashIncome + movements;
  const counted = Number(cashSession.closingTotal || 0);
  const diff = counted - expectedCash;

  const payload = {
    idcaja: String(remoteId),
    fechafin: nowFs(),
    dinerofin: counted,
    ingresos: cashIncome,
    nick: String(getLoginUser() || "").trim(),
    totalmovi: movements,
    totalcaja: expectedCash,
    diferencia: diff,
    numtickets: Number(cashSession.numtickets || 0),
    totaltickets: Number(cashSession.totalSales || 0),
  };

  payload.nick =
    String(
      getLoginUser?.() || localStorage.getItem("tpv_login_user") || "",
    ).trim() || "—";

  // ✅ Mantener observaciones (usuario + automático)
  if (remoteCaja) {
    payload.observaciones = String(remoteCaja.observaciones || "");
  }

  const resp = await apiWrite(`tpvcajas/${remoteId}`, "PUT", payload);

  // ✅ Si FS responde vacío pero fue OK, apiWrite devuelve null.
  // Normalizamos a {ok:true} para que el caller pueda decidir bien.
  return resp ?? { ok: true };
}

async function ensureTerminalAgentDefaults({ refresh = false } = {}) {
  if (refresh) {
    try {
      await refreshTerminalsAndAgents();
    } catch {}
  }

  // 1) terminal: CFG -> LS -> primero
  if (!currentTerminal) {
    let savedIdtpv = "";
    try {
      savedIdtpv = String(
        (await window.TPV_CFG?.get?.("tpv.idtpv")) || "",
      ).trim();
    } catch {}

    let savedLs = "";
    try {
      savedLs = (localStorage.getItem("tpv_terminal") || "").trim();
    } catch {}

    const pickTerminal =
      (savedIdtpv &&
        terminals?.find((t) => String(t.id) === String(savedIdtpv))) ||
      (savedLs && terminals?.find((t) => String(t.id) === String(savedLs))) ||
      terminals?.[0] ||
      null;

    if (pickTerminal) setCurrentTerminal(pickTerminal);
    else setCurrentTerminal({ id: "demo", name: "TPV demo" });
  }

  // 2) agente: CFG -> LS -> primero del terminal
  if (currentTerminal && !currentAgent) {
    const list = getAgentsForTerminalId(currentTerminal.id) || [];

    let savedCodAg = "";
    try {
      savedCodAg = String(
        (await window.TPV_CFG?.get?.("auth.codagente")) || "",
      ).trim();
    } catch {}

    let savedLs = "";
    try {
      savedLs = (localStorage.getItem("tpv_agent") || "").trim();
    } catch {}

    const pickAgent =
      (savedCodAg &&
        list.find((a) => String(a.codagente) === String(savedCodAg))) ||
      (savedLs && list.find((a) => String(a.codagente) === String(savedLs))) ||
      list[0] ||
      null;

    if (pickAgent) {
      currentAgent = pickAgent;
      try {
        await window.TPV_CFG?.set?.(
          "auth.codagente",
          String(pickAgent.codagente),
        );
      } catch {}
    }
  }

  if (terminalNameEl)
    terminalNameEl.textContent = currentTerminal?.name || "---";
  if (agentNameEl) agentNameEl.textContent = currentAgent?.name || "---";

  renderMainAgentBar?.();
  refreshLoggedUserUI?.();
}

// Botón abrir/cerrar caja (header "Caja")
if (cashHeaderBtn) {
  cashHeaderBtn.onclick = async () => {
    // 0) Bloqueado
    if (TPV_STATE.locked) {
      showMessageModal(
        "Acceso bloqueado",
        "Tu cuenta de TPV está desactivada. Contacta con soporte.",
      );
      return;
    }

    // 1) Si NO hay empresa resuelta, el click debe pedir email (no login)
    if (!hasCompanyResolved()) {
      await forceReconnectFlow(); // pide email + valida + carga datos
      if (!hasCompanyResolved()) return; // cancelado o falló
    }

    // 1.5) Si hay empresa pero seguimos OFFLINE, intentamos reconectar sin pedir email
    if (TPV_STATE.offline) {
      try {
        await loadDataFromApi(); // pone offline=false si conecta
      } catch {}
      if (TPV_STATE.offline) {
        toast(
          "Sin conexión. Reintenta cuando tengas internet.",
          "warn",
          "Caja",
        );
        return;
      }
    }

    // 2) Asegurar datos base (categorías/productos, etc.)
    await ensureDataLoaded();

    // 3) Login: si no hay sesión, intenta auto-login; si falla, abre modal
    if (!getLoginUser?.() && !localStorage.getItem("tpv_login_user")) {
      const ok = await ensureLoginAutoOrPrompt();
      if (!ok) return;
    }

    // 4) Si caja abierta => cerrar (con control tickets aparcados)
    if (cashSession.open) {
      const parkedCount = Array.isArray(parkedTickets)
        ? parkedTickets.length
        : 0;

      if (parkedCount > 0) {
        await confirmModal(
          "Tickets aparcados",
          `Tienes ${parkedCount} ticket${parkedCount === 1 ? "" : "s"} aparcado${
            parkedCount === 1 ? "" : "s"
          }.\n\nAntes de cerrar la caja, recupera o elimina los tickets aparcados.`,
        );
        openParkedModal();
        return;
      }

      openCashOpenDialog("close");
      return;
    }

    // 5) Caja cerrada => refrescar terminales/agentes y auto-seleccionar defaults
    await refreshTerminalsAndAgents();

    // Si no hay terminales (demo)
    if (!Array.isArray(terminals) || terminals.length === 0) {
      if (!currentTerminal)
        setCurrentTerminal({ id: "demo", name: "TPV demo" });

      // reset UI apertura (por si vienes de un estado raro)
      cashResetUIForOpening();
      cashWrapInputsWithSteppers();

      cashOpenDialogShown = false;
      await maybeOpenCashOrRecover(); // abrirá modal de apertura si no hay caja abierta
      return;
    }

    // Auto-asignar terminal/agente (sin overlays)
    await ensureTerminalAgentDefaults(); // NO refresh aquí, ya hicimos refresh arriba

    // Si aún no hay terminal (caso raro) => overlay
    if (!currentTerminal) {
      showTerminalOverlay("session");
      return;
    }

    // Si no hay agente pero sí hay lista => tomar primero
    const list = getAgentsForTerminalId(currentTerminal.id) || [];
    if (!currentAgent && list.length > 0) {
      currentAgent = list[0];
      try {
        localStorage.setItem(
          "tpv_agent",
          String(
            currentAgent.codagente ||
              currentAgent.id ||
              currentAgent.nick ||
              "",
          ),
        );
      } catch {}
      if (agentNameEl)
        agentNameEl.textContent =
          currentAgent.name || currentAgent.nick || "---";
      renderMainAgentBar?.();
    }

    // 6) Decidir recovery o apertura
    cashOpenDialogShown = false;
    await maybeOpenCashOrRecover(); // si no hay caja abierta, mostrará modal "open"
  };
}

// Click en nombre de agente: cambio rápido (agente y, si hay >1, también terminal)
if (agentNameEl) {
  agentNameEl.addEventListener("click", async () => {
    await refreshTerminalsAndAgents();

    const tpvs = Array.isArray(terminals) ? terminals : [];
    if (tpvs.length === 0) return;

    // si hay múltiples TPVs, abrimos siempre (para poder elegir un TPV con agentes)
    if (tpvs.length > 1) {
      showTerminalOverlay("agentSwitch");
      return;
    }

    // si solo hay 1 TPV, solo abrimos si hay agentes
    const terminalId = currentTerminal?.id || tpvs[0]?.id;
    const list = getAgentsForTerminalId(terminalId);

    if (!list || list.length === 0) return;

    showTerminalOverlay("agentSwitch");
  });
}

if (userNameEl) {
  userNameEl.addEventListener("click", async () => {
    await doLogoutFlow();
  });
}

async function autoSelectTerminalAndAgentIfPossible() {
  // Terminal preferido (si lo guardas)
  const savedIdtpv = await window.TPV_CFG.get("tpv.idtpv");
  const savedCodAg = await window.TPV_CFG.get("auth.codagente");

  // 1) Terminal
  if (!currentTerminal) {
    const pick =
      (savedIdtpv &&
        terminals.find((t) => String(t.id) === String(savedIdtpv))) ||
      (terminals.length ? terminals[0] : null);

    if (pick) setCurrentTerminal(pick);
  }

  // 2) Agente
  if (currentTerminal) {
    const list = getAgentsForTerminalId(currentTerminal.id) || [];
    if (!currentAgent) {
      currentAgent =
        (savedCodAg &&
          list.find((a) => String(a.codagente) === String(savedCodAg))) ||
        list[0] ||
        null;
    }
  }

  // Persistimos para el próximo arranque
  if (currentTerminal?.id)
    await window.TPV_CFG.set("tpv.idtpv", String(currentTerminal.id));
  if (currentAgent?.codagente)
    await window.TPV_CFG.set("auth.codagente", String(currentAgent.codagente));
}

function fireSessionReady() {
  document.dispatchEvent(
    new CustomEvent("tpv:sessionReady", {
      detail: {
        idtpv: currentTerminal?.id || null,
        codagente: currentAgent?.codagente || null,
        user:
          getLoginUser?.() || localStorage.getItem("tpv_login_user") || null,
      },
    }),
  );
}

// ===== Carga de datos desde la API de Recipok =====
async function loadDataFromApi(opts = {}) {
  console.log("loadDataFromApi() ejecutándose con:", window.RECIPOK_API);
  try {
    const cfg = window.RECIPOK_API || {};

    // Si no hay config, usamos modo demo
    if (!cfg.baseUrl || !cfg.apiKey) {
      console.warn("Config API Recipok no definida. Usando datos de demo.");

      categories = demoCategories.map((c) => ({ ...c, parentId: null }));
      products = [...demoProducts];

      setStatusText("Offline (demo)");
      renderMainUI();
      TPV_STATE.offline = true;
      TPV_STATE.locked = false;
      updateCashButtonLabel();
      toast("Modo demo (sin conexión). Pulsa “Conectar” en Caja.", "info");
      return;
    }

    // base de la API, tal cual (normalmente acaba en /api/3)
    apiBaseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");

    // base para ficheros: quitamos el sufijo /api/loquesea
    filesBaseUrl = apiBaseUrl.replace(/\/api\/[^/]+$/i, "");

    setStatusText("Conectando API...");

    // ✅ IMPORTANTE: para que warmupPacksData no se “salte”
    TPV_STATE.offline = false;
    TPV_STATE.locked = false;

    // 1) Cargamos lo principal EN PARALELO (sin impuestos todavía)
    const [
      familiasRaw,
      productosData,
      tpvTerminales,
      variantesData,
      empresasData,
      productImagesMap,
    ] = await Promise.all([
      fetchApiResource("familias"),
      fetchApiResource("productos"),
      fetchApiResource("tpvterminales"),
      fetchApiResource("variantes"),
      fetchApiResource("empresas"),
      // mapa de imágenes (si falla, devolvemos objeto vacío para no romper nada)
      buildProductImagesMap().catch((e) => {
        console.warn(
          "No se pudieron cargar imágenes de productos:",
          e.message || e,
        );
        return {};
      }),
    ]);

    companyInfo =
      Array.isArray(empresasData) && empresasData[0] ? empresasData[0] : null;
    await loadCompanyLogoUrl();

    // Mapa de imágenes devuelto (aunque buildProductImagesMap ya lo asigna)
    if (productImagesMap && typeof productImagesMap === "object") {
      PRODUCT_IMAGES_MAP = productImagesMap;
    }

    // 2) INTENTAMOS cargar impuestos en una llamada aparte.
    //    Si falla (429, etc.), seguimos funcionando con el fallback de extractTaxRateFromCode.
    taxRatesByCode = {};
    try {
      const impuestosData = await fetchApiResource("impuestos");
      if (Array.isArray(impuestosData)) {
        impuestosData.forEach((imp) => {
          const code = String(
            imp.codimpuesto || imp.codigo || imp.id || "",
          ).trim();
          if (!code) return;

          // Diferentes instalaciones pueden usar campos distintos.
          let rate =
            imp.iva ?? imp.porcentaje ?? imp.porcentajeiva ?? imp.impuesto ?? 0;

          rate = Number(rate);
          if (isNaN(rate)) rate = 0;

          taxRatesByCode[code] = rate;
        });
      }
    } catch (e) {
      console.warn(
        "No se pudieron cargar los impuestos. Usaremos el % deducido del código (IVA10 → 10, IVA21 → 21, etc.):",
        e.message || e,
      );
      taxRatesByCode = {}; // forzamos a que se use extractTaxRateFromCode
    }

    // 3) TPV-agentes (los envolvemos en su propio try/catch para que no rompa todo)
    let tpvAgentesData = [];
    let agentesMaestros = [];
    try {
      [tpvAgentesData, agentesMaestros] = await Promise.all([
        fetchApiResource("tpvagentes"),
        fetchApiResource("agentes"),
      ]);
    } catch (e) {
      console.warn("No se pudieron cargar tpvagentes/agentes:", e.message || e);
    }

    // ===== Familias -> categories (incluye padre/hijos) =====
    if (Array.isArray(familiasRaw) && familiasRaw.length) {
      const visibles = familiasRaw.filter((f) => {
        const flag = f.tpv_show ?? f.tpv ?? f.mostrarentpv ?? f.mostrar_en_tpv;
        return !isFalseFlag(flag);
      });

      visibles.sort((a, b) => {
        const sa = Number(a.tpv_sort ?? a.tpvsort ?? a.orden ?? 0);
        const sb = Number(b.tpv_sort ?? b.tpvsort ?? b.orden ?? 0);
        if (sa !== sb) return sa - sb;
        const na = String(a.descripcion ?? a.nombre ?? a.codfamilia ?? "");
        const nb = String(b.descripcion ?? b.nombre ?? b.codfamilia ?? "");
        return na.localeCompare(nb, "es");
      });

      categories = visibles.map((f, idx) => ({
        id: String(f.codfamilia ?? f.id ?? idx),
        name: String(f.descripcion ?? f.nombre ?? f.codfamilia ?? ""),
        parentId: f.madre ? String(f.madre) : null,
        color: "#007bff",
      }));
    } else {
      if (!categories.length) {
        categories = demoCategories.map((c) => ({ ...c, parentId: null }));
      }
    }

    // ===== Productos + variantes -> products =====
    if (Array.isArray(productosData) && productosData.length) {
      const productoById = new Map();
      productosData.forEach((p, idx) => {
        const idProd = Number(p.idproducto ?? p.id ?? idx);
        if (!idProd) return;
        productoById.set(idProd, p);
      });

      // Agrupamos variantes por producto
      const variantsByProduct = {};
      if (Array.isArray(variantesData) && variantesData.length) {
        variantesData.forEach((v, idx) => {
          const baseId = Number(v.idproducto);
          if (!baseId) return;
          if (!variantsByProduct[baseId]) variantsByProduct[baseId] = [];
          variantsByProduct[baseId].push({ v, idx });
        });
      }

      const combined = [];

      // ---- PRODUCTOS CON VARIANTES ----
      Object.entries(variantsByProduct).forEach(([baseIdStr, list]) => {
        const baseId = Number(baseIdStr);
        const base = productoById.get(baseId);
        if (!base) return;

        if (base.bloqueado || isFalseFlag(base.sevende)) return;

        const baseName = String(
          base.descripcion ?? base.referencia ?? "",
        ).trim();
        const category = String(base.codfamilia ?? "");

        // IVA del producto base
        const codImpuestoBase = base.codimpuesto || null;
        const taxRateBase = extractTaxRateFromCode(codImpuestoBase);

        const baseSort = Number(base.tpv_sort ?? base.tpvsort ?? 0) || 0;
        const baseSortKey = baseSort * 1000;

        // 👇 imagen del producto base
        const imgInfoBase = PRODUCT_IMAGES_MAP[baseId] || null;

        const sortedVariants = list.slice().sort((a, b) => a.idx - b.idx);

        sortedVariants.forEach(({ v, idx }, pos) => {
          let mainName = String(v.referencia ?? "").trim();
          if (!mainName) {
            mainName = baseName;
          }
          if (!mainName || mainName === "-") return;

          const price = Number(v.precio ?? base.precio ?? 0);
          const idVar = Number(v.idvariante ?? v.id ?? baseId * 1000 + pos);

          const secondaryName =
            baseName && mainName !== baseName ? baseName : "";

          combined.push({
            id: idVar,
            name: mainName,
            secondaryName,
            price,
            category,
            sortKey: baseSortKey + pos,
            baseProductId: baseId,
            isVariant: true,
            variantOrder: pos,
            isPrimaryVariant: pos === 0,
            codimpuesto: codImpuestoBase,
            taxRate: taxRateBase,
            // 👇 misma imagen que el producto base
            imageUrl: imgInfoBase ? imgInfoBase.url : null,
          });
        });
      });

      // ---- PRODUCTOS SIN VARIANTES ----
      productosData.forEach((p, idx) => {
        const idProd = Number(p.idproducto ?? p.id ?? idx);
        if (!idProd) return;

        if (variantsByProduct[idProd]) return;

        if (p.bloqueado || isFalseFlag(p.sevende)) return;

        const name = String(p.descripcion ?? p.referencia ?? "").trim();
        if (!name || name === "-") return;

        const price = Number(p.precio ?? 0);
        const category = String(p.codfamilia ?? "");

        const codimpuesto = p.codimpuesto || null;
        const taxRate = extractTaxRateFromCode(codimpuesto);

        const baseSort = Number(p.tpv_sort ?? p.tpvsort ?? 0) || 0;

        // 👇 imagen directa del producto (si tiene)
        const imgInfo = PRODUCT_IMAGES_MAP[idProd] || null;

        combined.push({
          id: idProd,
          name,
          secondaryName: "",
          price,
          category,
          sortKey: baseSort * 1000,
          baseProductId: idProd,
          isVariant: false,
          variantOrder: 0,
          isPrimaryVariant: true,
          codimpuesto,
          taxRate,
          imageUrl: imgInfo ? imgInfo.url : null,
        });
      });

      // ---- ORDEN FINAL ----
      combined.sort((a, b) => {
        const sa = a.sortKey || 0;
        const sb = b.sortKey || 0;
        if (sa !== sb) return sa - sb;

        if (a.baseProductId === b.baseProductId) {
          return (a.variantOrder ?? 0) - (b.variantOrder ?? 0);
        }

        return a.name.localeCompare(b.name, "es");
      });

      products = combined;
    } else {
      if (!products.length) products = [...demoProducts];
    }

    await warmupPacksData().catch(() => {});

    // ===== Terminales -> terminals =====
    if (Array.isArray(tpvTerminales) && tpvTerminales.length) {
      terminals = tpvTerminales.map((t, idx) => {
        const id = String(t.idtpv ?? t.id ?? idx);
        return {
          id,
          name: t.name || t.descripcion || `TPV ${id}`,
          codalmacen: t.codalmacen || null,
          productlimit: t.productlimit || null,
          // ✅ cliente por defecto asignado en FacturaScripts
          codcliente: String(t.codcliente || "1"),
        };
      });
    } else {
      terminals = [];
    }

    // ===== Agentes (mapa global codagente -> nombre) =====
    if (Array.isArray(agentesMaestros) && agentesMaestros.length) {
      buildAgentNameMap(agentesMaestros);
    } else if (!Object.keys(agentNameByCode).length) {
      // fallback cache si no vino nada de la API
      loadAgentNameMapFromCache();
    }

    agentsByTerminal = {};
    const allAgentsMap = {};

    if (Array.isArray(tpvAgentesData)) {
      tpvAgentesData.forEach((rel) => {
        const tpvIdRaw = rel.idtpv ?? rel.codtpv ?? rel.idtpvterminal ?? rel.id;
        const codag = rel.codagente ?? rel.idagente ?? rel.idagente2;
        if (!tpvIdRaw || !codag) return;

        const tpvKey = String(tpvIdRaw);
        const code = String(codag);
        const name =
          agentNameByCode[code] || rel.nombre || rel.name || `Agente ${code}`;

        const agentObj = {
          id: code,
          codagente: code,
          name,
        };

        if (!agentsByTerminal[tpvKey]) agentsByTerminal[tpvKey] = [];
        if (
          !agentsByTerminal[tpvKey].some(
            (a) => a.codagente === agentObj.codagente,
          )
        ) {
          agentsByTerminal[tpvKey].push(agentObj);
        }

        allAgentsMap[code] = agentObj;
      });
    }

    agents = Object.values(allAgentsMap);

    // ===== Estado online + lógica de selección de TPV / agente =====
    setStatusText("Online Recipok");

    TPV_STATE.offline = false;
    TPV_STATE.locked = false;
    updateCashButtonLabel();

    const numTerminals = terminals.length;
    const onlyTerminal = numTerminals === 1 ? terminals[0] : null;
    const listForOnlyTerminal = onlyTerminal
      ? getAgentsForTerminalId(onlyTerminal.id)
      : [];

    // =========================
    // MODO REFRESH (NO abrir overlays)
    // =========================
    if (opts.refresh === true) {
      // Mantener terminal si sigue existiendo
      if (currentTerminal) {
        const stillExists = terminals.some(
          (t) => String(t.id) === String(currentTerminal.id),
        );
        if (!stillExists) currentTerminal = null;
      }

      // Si no hay terminal elegido, elegir uno (sin abrir modal)
      if (!currentTerminal) {
        if (onlyTerminal) {
          setCurrentTerminal(onlyTerminal);
          await renderTerminalDefaultCustomerSelect();
        } else if (terminals.length) {
          setCurrentTerminal(terminals[0]);
        }
      }

      // Mantener agente si sigue existiendo dentro del terminal actual
      if (currentTerminal) {
        const listNow = getAgentsForTerminalId(currentTerminal.id);
        if (currentAgent) {
          const ok = listNow.some(
            (a) => String(a.codagente) === String(currentAgent.codagente),
          );
          if (!ok) currentAgent = null;
        }
        if (!currentAgent) currentAgent = listNow[0] || null;
      }

      // Repintar sin tocar caja ni overlays
      renderMainUI(true);
      return;
    }

    // =========================
    // MODO ARRANQUE (AUTO: sin login ni overlay)
    // =========================

    // 1) Terminal + agente por defecto (primero) o los guardados
    await autoSelectTerminalAndAgentIfPossible();

    // 2) Si no hay terminal/agente (casos raros), cae a overlay
    if (!currentTerminal) {
      if (numTerminals > 0 || agents.length > 0) showTerminalOverlay("session");
      else renderMainUI();
      return;
    }

    // Si no hay agentes asignados, igualmente dejamos entrar (tu UI debe tolerarlo)
    if (!currentAgent) {
      // si quieres forzar overlay cuando no hay agente:
      // showTerminalOverlay("session"); return;
    }

    // 3) Dispara sessionReady -> tu listener ya llama maybeOpenCashOrRecover()
    fireSessionReady();
  } catch (err) {
    console.error("Error llamando a la API de Recipok:", err);
    setStatusText("Offline (demo)");

    TPV_STATE.offline = true;
    TPV_STATE.locked = false;
    updateCashButtonLabel();
    toast("Sin conexión. Modo demo.", "warn");

    if (!categories.length) {
      categories = demoCategories.map((c) => ({ ...c, parentId: null }));
    }
    if (!products.length) products = [...demoProducts];

    renderMainUI();
  }
}

let __refreshingAll = false;

async function refreshAllData() {
  if (__refreshingAll) return;

  // no refrescar en medio de cobro
  if (typeof isPayingNow !== "undefined" && isPayingNow) {
    toast("Termina el cobro antes de actualizar.", "warn", "Actualizar");
    return;
  }
  if (
    typeof payOverlay !== "undefined" &&
    payOverlay &&
    !payOverlay.classList.contains("hidden")
  ) {
    toast("Cierra el cobro antes de actualizar.", "warn", "Actualizar");
    return;
  }

  if (TPV_STATE?.offline) {
    toast("Sin internet: no se puede actualizar ahora.", "warn", "Actualizar");
    return;
  }

  __refreshingAll = true;

  // feedback en el botón
  const btn = document.querySelector(".agent-refresh-btn");
  const oldTxt = btn ? btn.textContent : "🔄";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳";
  }

  try {
    setStatusText("Actualizando...");
    await loadDataFromApi({ refresh: true });

    if (typeof renderMainAgentBar === "function") renderMainAgentBar();
    if (typeof renderCart === "function") renderCart();

    setStatusText("Online Recipok");
    toast("Datos actualizados ✅", "ok", "Actualizar");
  } catch (e) {
    console.warn("refreshAllData error:", e);
    toast("No se pudo actualizar: " + (e?.message || e), "err", "Actualizar");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldTxt;
    }
    __refreshingAll = false;
  }
}

refreshLoggedUserUI();

// ====================================================
// TPV Bootstrap bridge (recuperar caja ya abierta)
// ====================================================
window.cargarPantallaTPV = async function (idcaja, idtpv, caja) {
  console.log(
    "[TPV] Caja asignada desde bootstrap:",
    idcaja,
    "TPV:",
    idtpv,
    "Caja:",
    caja,
  );

  try {
    if (!idcaja) throw new Error("idcaja inválido");

    cashSession.remoteCajaId = Number(idcaja) || null;
    cashSession.open = true;

    try {
      localStorage.setItem(
        "tpv_remoteCajaId",
        String(cashSession.remoteCajaId),
      );
    } catch {}

    loadCashLedgerIntoSession(cashSession.remoteCajaId);

    try {
      hideCashOpenDialog();
    } catch {}
    try {
      hideTerminalOverlay();
    } catch {}

    if (!categories.length || !products.length) {
      await loadDataFromApi();
    }

    if (idtpv && Array.isArray(terminals) && terminals.length) {
      const t = terminals.find((x) => String(x.id) === String(idtpv));
      if (t) setCurrentTerminal(t);
    }

    await ensureTerminalAgentDefaults();

    if (terminalNameEl && currentTerminal) {
      terminalNameEl.textContent = currentTerminal.name || "---";
      setTerminalNameClickable(
        Array.isArray(terminals) && terminals.length > 1,
      );
    }
    if (agentNameEl) {
      agentNameEl.textContent = currentAgent ? currentAgent.name : "---";
    }

    renderMainUI();
    renderMainAgentBar?.();
    updateCashButtonLabel();
    renderCashIdChip();

    setStatusText("Caja activa (recuperada)");
  } catch (e) {
    console.error("Error activando TPV:", e);
    toast("No se pudo activar la caja.", "err", "TPV");
  }
};

let companyInfo = null; // ya lo tienes
let companyLogoUrl = ""; // ✅ GLOBAL

async function loadCompanyLogoUrl() {
  try {
    if (!companyInfo || !companyInfo.idlogo) return "";

    const files = await fetchApiResource("attachedfiles");
    if (!Array.isArray(files)) return "";

    const f = files.find(
      (x) => Number(x.idfile) === Number(companyInfo.idlogo),
    );
    if (!f) return "";

    const rel = f["download-permanent"] || f.download || "";
    if (!rel) return "";

    // filesBaseUrl = https://plus.recipok.com/slug (sin /api/3)
    const base = (filesBaseUrl || "").replace(/\/+$/, "");
    const path = String(rel).replace(/^\/+/, "");

    companyLogoUrl = `${base}/${path}`;
    return companyLogoUrl;
  } catch (e) {
    console.warn("No se pudo cargar logo:", e);
    companyLogoUrl = "";
    return "";
  }
}

async function restoreTerminalAgentFromCfg() {
  const cfg = window.TPV_CFG;
  if (!cfg) return;

  // 1) terminal guardado
  let savedTpvId = "";
  try {
    savedTpvId = String((await cfg.get("tpv.idtpv")) || "").trim();
  } catch {}

  if (savedTpvId && Array.isArray(terminals) && terminals.length) {
    const t = terminals.find((x) => String(x.id) === String(savedTpvId));
    if (t) setCurrentTerminal(t);
  }

  // fallback si no hay currentTerminal aún
  if (!currentTerminal && Array.isArray(terminals) && terminals.length === 1) {
    setCurrentTerminal(terminals[0]);
  }

  // 2) agente guardado (solo si aplica al terminal actual)
  if (!currentTerminal) return;

  let savedCodagente = "";
  try {
    savedCodagente = String((await cfg.get("auth.codagente")) || "").trim();
  } catch {}

  const list = getAgentsForTerminalId(currentTerminal.id) || [];

  if (savedCodagente) {
    const a = list.find((x) => String(x.codagente) === String(savedCodagente));
    if (a) currentAgent = a;
    else currentAgent = null; // agente guardado no pertenece a este TPV
  } else {
    // opcional: si solo hay 1 agente, autoseleccionar
    if (!currentAgent && list.length === 1) currentAgent = list[0];
  }

  // UI
  if (terminalNameEl)
    terminalNameEl.textContent = currentTerminal?.name || "---";
  if (agentNameEl)
    agentNameEl.textContent = currentAgent ? currentAgent.name : "---";
  renderMainAgentBar?.();
  refreshAgentGuardUI?.();
}

async function refreshTerminalsAndAgents() {
  const cfg = window.RECIPOK_API;
  if (!cfg || !cfg.baseUrl || !cfg.apiKey) return;

  try {
    const [tpvTerminales, tpvAgentesData, agentesMaestros] = await Promise.all([
      fetchApiResource("tpvterminales"),
      fetchApiResource("tpvagentes"),
      fetchApiResource("agentes"),
    ]);

    // ✅ MAPA GLOBAL codagente -> nombre (+ cache)
    if (Array.isArray(agentesMaestros) && agentesMaestros.length) {
      buildAgentNameMap(agentesMaestros);
    } else {
      loadAgentNameMapFromCache();
    }

    // ---- Terminales ----
    if (Array.isArray(tpvTerminales) && tpvTerminales.length) {
      terminals = tpvTerminales.map((t, idx) => {
        const id = String(t.idtpv ?? t.id ?? idx);
        return {
          id,
          name: t.name || t.descripcion || `TPV ${id}`,
          codalmacen: t.codalmacen || null,
          productlimit: t.productlimit || null,
        };
      });
    } else {
      terminals = [];
    }

    // ---- TPV-agente -> agentsByTerminal + lista agents ----
    agentsByTerminal = {};
    const allAgentsMap = {};

    if (Array.isArray(tpvAgentesData)) {
      tpvAgentesData.forEach((rel) => {
        const tpvIdRaw = rel.idtpv ?? rel.codtpv ?? rel.idtpvterminal ?? rel.id;
        const codag = rel.codagente ?? rel.idagente ?? rel.idagente2;
        if (!tpvIdRaw || !codag) return;

        const tpvKey = String(tpvIdRaw);
        const code = String(codag);

        const name =
          agentNameByCode[code] || rel.nombre || rel.name || `Agente ${code}`;

        const agentObj = { id: code, codagente: code, name };

        if (!agentsByTerminal[tpvKey]) agentsByTerminal[tpvKey] = [];
        if (!agentsByTerminal[tpvKey].some((a) => a.codagente === code)) {
          agentsByTerminal[tpvKey].push(agentObj);
        }

        allAgentsMap[code] = agentObj;
      });
    }

    agents = Object.values(allAgentsMap);

    // Reajustar currentTerminal / currentAgent si ya había algo seleccionado
    if (currentTerminal) {
      const updated = terminals.find(
        (t) => String(t.id) === String(currentTerminal.id),
      );
      if (!updated) {
        currentTerminal = null;
        currentAgent = null;
      } else {
        currentTerminal = updated;
        const list = getAgentsForTerminalId(currentTerminal.id);
        if (
          !currentAgent ||
          !list.some((a) => a.codagente === currentAgent.codagente)
        ) {
          currentAgent = null;
        }
      }
    }

    // Si la caja está abierta, refrescamos barra principal
    if (cashSession.open) {
      renderMainAgentBar();
      if (agentNameEl)
        agentNameEl.textContent = currentAgent ? currentAgent.name : "---";
      if (terminalNameEl)
        terminalNameEl.textContent = currentTerminal
          ? currentTerminal.name
          : "---";
      // ✅
      refreshAgentGuardUI?.();
    }

    // ✅ NUEVO: restaurar selección guardada
    await restoreTerminalAgentFromCfg();
    // ✅
    refreshAgentGuardUI?.();
  } catch (e) {
    console.warn("No se pudieron refrescar TPVs/agentes:", e);
  }
}

// ===== Cobro / creación de ticket en FacturaScripts =====
function buildTicketPayloadFromCart() {
  if (!cart || cart.length === 0) {
    throw new Error("El carrito está vacío.");
  }

  const codcliente =
    window.CUSTOMER_SELECTOR?.getSelectedCustomerCodcliente?.() ||
    String(currentTerminal?.codcliente || "1");

  const lineas = buildFsLinesFromCart(cart);

  return {
    codcliente,
    lineas,
    pagada: 1,
  };
}

function buildPresupuestoPayloadFromCart(obs = "") {
  if (!cart || cart.length === 0) {
    throw new Error("El carrito está vacío.");
  }

  const codcliente =
    window.CUSTOMER_SELECTOR?.getSelectedCustomerCodcliente?.() ||
    String(currentTerminal?.codcliente || "1");
  const codalmacen = currentTerminal?.codalmacen || getLoginWarehouse() || "";
  const codpago = "CONT";
  const codserie = "S";

  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fecha = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const lineas = buildFsLinesFromCart(cart);

  return {
    codcliente,
    codalmacen,
    codpago,
    codserie,
    fecha,
    observaciones: String(obs || "").trim(),
    aparcado: true,
    idtpv: currentTerminal ? currentTerminal.id : null,
    idcaja: cashSession?.remoteCajaId ?? null,
    lineas,
  };
}

async function updateFacturaCliente(idfactura, fields) {
  const cfg = window.RECIPOK_API || {};
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/facturaclientes/${idfactura}`;

  const body = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined || v === null) return;

    // booleans -> 1/0 (FS lo suele esperar así)
    if (typeof v === "boolean") v = v ? 1 : 0;

    // números: evita NaN/Infinity
    const MONEY_FIELDS = new Set(["tpv_efectivo", "tpv_cambio"]);

    if (typeof v === "number") {
      if (!isFinite(v)) return;
      if (MONEY_FIELDS.has(k)) v = Number(v.toFixed(2));
      else v = Math.trunc(v); // ids/estados
    }

    // no mandar strings vacíos (salvo que tengas un campo donde quieras vaciarlo)
    const ALLOW_EMPTY = new Set(["numero2", "observaciones"]); // añade los que quieras permitir vaciar

    if (typeof v === "string" && v.trim() === "" && !ALLOW_EMPTY.has(k)) return;

    body.append(k, String(v));
  });

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  // ✅ leer texto aunque no sea JSON (para ver el motivo real del 400)
  const txt = await res.text().catch(() => "");
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = null;
  }

  if (!res.ok || (data && data.status === "error")) {
    console.error("[updateFacturaCliente] FAIL", {
      idfactura,
      status: res.status,
      responseText: txt,
      fields,
      url: url, // ✅ fijo (antes: url -> ReferenceError)
    });

    throw new Error(
      (data && (data.message || data.error)) ||
        `Error actualizando factura ${idfactura}: HTTP ${res.status} ${txt}`,
    );
  }

  return data;
}

// ===== Modal confirmación cierre de caja =====
const cashCloseConfirmOverlay = document.getElementById(
  "cashCloseConfirmOverlay",
);
const cashCloseConfirmCloseX = document.getElementById(
  "cashCloseConfirmCloseX",
);
const cashCloseConfirmText = document.getElementById("cashCloseConfirmText");
const cashCloseConfirmCancelBtn = document.getElementById(
  "cashCloseConfirmCancelBtn",
);
const cashCloseConfirmOkBtn = document.getElementById("cashCloseConfirmOkBtn");

async function confirmCashCloseModal(message) {
  if (!cashCloseConfirmOverlay) return true; // fallback: si falta el modal, no bloquea

  if (cashCloseConfirmText) {
    cashCloseConfirmText.textContent =
      message || "¿Seguro que quieres cerrar la caja?";
  }

  cashCloseConfirmOverlay.classList.remove("hidden");

  return await new Promise((resolve) => {
    const cleanup = () => {
      if (cashCloseConfirmCloseX) cashCloseConfirmCloseX.onclick = null;
      if (cashCloseConfirmCancelBtn) cashCloseConfirmCancelBtn.onclick = null;
      if (cashCloseConfirmOkBtn) cashCloseConfirmOkBtn.onclick = null;
      cashCloseConfirmOverlay.onclick = null;
    };

    const close = (val) => {
      cleanup();
      cashCloseConfirmOverlay.classList.add("hidden");
      resolve(val);
    };

    cashCloseConfirmCloseX &&
      (cashCloseConfirmCloseX.onclick = () => close(false));
    cashCloseConfirmCancelBtn &&
      (cashCloseConfirmCancelBtn.onclick = () => close(false));
    cashCloseConfirmOkBtn &&
      (cashCloseConfirmOkBtn.onclick = () => close(true));

    cashCloseConfirmOverlay.onclick = (e) => {
      if (e.target === cashCloseConfirmOverlay) close(false);
    };
  });
}

// ===== Modal Post-cobro =====
const postPayOverlay = document.getElementById("postPayOverlay");
const postPayCloseX = document.getElementById("postPayCloseX");
const postPayDocEl = document.getElementById("postPayDoc");
const postPayTotalEl = document.getElementById("postPayTotal");
const postPayChangeEl = document.getElementById("postPayChange");
const postPayPrintBtn = document.getElementById("postPayPrintBtn");
const postPayOpenDrawerBtn = document.getElementById("postPayOpenDrawerBtn");
const postPayAutoCloseText = document.getElementById("postPayAutoCloseText");

let __postPayTimer = null;
let __postPayCountdownTimer = null;

function euro2esUI(n) {
  const v = Number(n) || 0;
  return v.toFixed(2).replace(".", ",") + " €";
}

// Por ahora fijo a 20s. Luego lo hacemos configurable (0 = no cerrar).
function getPostPayAutoCloseSeconds() {
  return 20;
}

function closePostPayModal() {
  if (__postPayTimer) clearTimeout(__postPayTimer);
  if (__postPayCountdownTimer) clearInterval(__postPayCountdownTimer);
  __postPayTimer = null;
  __postPayCountdownTimer = null;

  if (postPayOverlay) postPayOverlay.classList.add("hidden");
  if (postPayAutoCloseText) postPayAutoCloseText.textContent = "";
}

function updatePostPayModal({ docCode, total, cambio, enablePrint }) {
  if (postPayDocEl) postPayDocEl.textContent = docCode || "—";
  if (postPayTotalEl) postPayTotalEl.textContent = euro2esUI(total);
  if (postPayChangeEl) postPayChangeEl.textContent = euro2esUI(cambio);

  if (enablePrint !== undefined) setPostPayPrintEnabled(!!enablePrint);
}

function setPostPayPrintEnabled(enabled) {
  if (!postPayPrintBtn) return;

  postPayPrintBtn.disabled = !enabled;

  // gris visual (si tu .pay-btn no lo hace por defecto)
  postPayPrintBtn.style.opacity = enabled ? "1" : "0.45";
  postPayPrintBtn.style.pointerEvents = enabled ? "auto" : "none";
}

function isPostPayOpen() {
  return postPayOverlay && !postPayOverlay.classList.contains("hidden");
}

function openPostPayModal({ docCode, total, cambio }) {
  if (!postPayOverlay) return;

  const alreadyOpen = isPostPayOpen();

  // Siempre actualizamos contenido
  updatePostPayModal({ docCode, total, cambio });

  // Si ya estaba abierto, NO tocar timers ni countdown
  if (alreadyOpen) return;

  postPayOverlay.classList.remove("hidden");

  // botones (solo hace falta setearlos una vez, pero ok si lo dejas aquí)
  if (postPayPrintBtn) {
    setPostPayPrintEnabled(!!(window.lastTicket || lastTicket));
    postPayPrintBtn.onclick = async () => {
      const t = window.lastTicket || lastTicket;
      if (!t) return;
      await printTicket(t);
    };
  }

  if (postPayOpenDrawerBtn) {
    postPayOpenDrawerBtn.onclick = () =>
      handleOpenDrawerClick(postPayOpenDrawerBtn, "POSTPAY");
  }

  if (postPayCloseX) postPayCloseX.onclick = closePostPayModal;
  postPayOverlay.onclick = (e) => {
    if (e.target === postPayOverlay) closePostPayModal();
  };

  // autocierre SOLO al abrir por primera vez
  const secs = Number(getPostPayAutoCloseSeconds() || 0);
  if (!(secs > 0)) {
    if (postPayAutoCloseText) postPayAutoCloseText.textContent = "";
    return;
  }

  let left = secs;
  if (postPayAutoCloseText)
    postPayAutoCloseText.textContent = `Se cerrará en ${left}s`;

  if (__postPayCountdownTimer) clearInterval(__postPayCountdownTimer);
  if (__postPayTimer) clearTimeout(__postPayTimer);

  __postPayCountdownTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) return;
    if (postPayAutoCloseText)
      postPayAutoCloseText.textContent = `Se cerrará en ${left}s`;
  }, 1000);

  __postPayTimer = setTimeout(() => closePostPayModal(), secs * 1000);
}

// ===== Opciones (⚙️) =====
const OPTIONS_AUTOPRINT_KEY = "tpv_autoPrint";
const OPTIONS_GROUPLINES_KEY = "tpv_groupLines";

const optionsBtn = document.getElementById("optionsBtn");
const optionsOverlay = document.getElementById("optionsOverlay");
const optionsCloseX = document.getElementById("optionsCloseX");
const optionsCloseBtn = document.getElementById("optionsCloseBtn");
const optionsOpenDrawerBtn = document.getElementById("optionsOpenDrawerBtn");
const payOpenDrawerBtn = document.getElementById("payOpenDrawerBtn");

const optionsChangePrinterBtn = document.getElementById(
  "optionsChangePrinterBtn",
);
const currentPrinterNameEl = document.getElementById("currentPrinterName");
const autoPrintToggle = document.getElementById("autoPrintToggle");
const groupLinesToggle = document.getElementById("groupLinesToggle");
// ===== Abrir cajón siempre (toggle) =====
const OPEN_DRAWER_ALWAYS_KEY = "tpv_openDrawerAlways";
const openDrawerAlwaysToggle = document.getElementById(
  "openDrawerAlwaysToggle",
);

function isOpenDrawerAlwaysEnabled() {
  return localStorage.getItem(OPEN_DRAWER_ALWAYS_KEY) === "1";
}
function setOpenDrawerAlwaysEnabled(v) {
  localStorage.setItem(OPEN_DRAWER_ALWAYS_KEY, v ? "1" : "0");
}

// ===== Impresora (Opciones) =====
const PRINTER_REAL_KEY = "tpv_printerRealName"; // POS-80 (lo que ve el usuario)
const PRINTER_QUEUE_KEY = "tpv_printerQueueName"; // RECIPOK_POS (Linux)

function isLinux() {
  return window.TPV_ENV?.platform === "linux";
}

function getSavedPrinterReal() {
  return localStorage.getItem(PRINTER_REAL_KEY) || "";
}
function savePrinterReal(name) {
  localStorage.setItem(PRINTER_REAL_KEY, name || "");
}

function getSavedPrinterQueue() {
  return localStorage.getItem(PRINTER_QUEUE_KEY) || "";
}
function savePrinterQueue(name) {
  localStorage.setItem(PRINTER_QUEUE_KEY, name || "");
}

function getSavedPrinterNameForUI() {
  // en UI siempre mostramos la real
  return getSavedPrinterReal();
}

async function ensurePrinterSelectedForPrint() {
  if (!isLinux()) {
    // Windows imprime a la real
    let real = getSavedPrinterReal();
    if (real) return real;

    const chosen = await openPrinterPicker();
    if (!chosen) return "";
    savePrinterReal(chosen);
    return chosen;
  }

  // Linux imprime siempre a la cola RAW
  const QUEUE = "RECIPOK_POS";

  let real = getSavedPrinterReal();
  if (!real) {
    const chosen = await openPrinterPicker();
    if (!chosen) return "";
    real = chosen;
    savePrinterReal(real);
  }

  // Asegura la cola RAW apuntando a la impresora elegida
  const r = await window.TPV_SETUP?.setupPosPrinter(real);
  if (!r || !r.ok) {
    throw new Error(r?.error || "No se pudo configurar la impresora en Linux.");
  }

  savePrinterQueue(QUEUE);
  return QUEUE;
}

function refreshPrinterButtonsUI() {
  const testBtn = document.getElementById("optionsTestPrinterBtn");
  if (!testBtn) return;
  testBtn.style.display = getSavedPrinterNameForUI() ? "inline-block" : "none";
}

function refreshOptionsUI() {
  autoPrintToggle && (autoPrintToggle.checked = isAutoPrintEnabled());
  groupLinesToggle && (groupLinesToggle.checked = isGroupLinesEnabled());
  openDrawerAlwaysToggle &&
    (openDrawerAlwaysToggle.checked = isOpenDrawerAlwaysEnabled());

  const t = document.getElementById("priceEditModeToggle");
  if (t) {
    t.disabled = !isAdminUser();
    t.checked = isAdminUser() ? isPriceEditModeEnabled() : false;
  }

  if (currentPrinterNameEl) {
    const p = getSavedPrinterNameForUI?.();
    currentPrinterNameEl.textContent = p ? p : "—";
  }
  refreshPrinterButtonsUI?.();
}

const OPTS_ACC_KEY = "ui.optionsAccordion"; // TPV_CFG
let optionsAccordionBound = false;

async function loadOptionsAccordionState() {
  // default: caja abierto
  let state = { caja: true };

  try {
    if (window.TPV_CFG) {
      const v = await window.TPV_CFG.get(OPTS_ACC_KEY);
      if (v && typeof v === "object") state = { ...state, ...v };
    }
  } catch {}

  // fallback localStorage
  try {
    const ls = localStorage.getItem("tpv_opts_acc");
    if (ls) state = { ...state, ...JSON.parse(ls) };
  } catch {}

  return state;
}

async function saveOptionsAccordionState(state) {
  try {
    if (window.TPV_CFG) await window.TPV_CFG.set(OPTS_ACC_KEY, state);
  } catch {}

  try {
    localStorage.setItem("tpv_opts_acc", JSON.stringify(state));
  } catch {}
}

async function applyOptionsAccordionState(state) {
  const secs = document.querySelectorAll("#optionsAccordion .opt-sec");
  const isAdmin = !!window.TPV_STATE?.isAdmin;

  secs.forEach((sec) => {
    const key = sec.getAttribute("data-sec");
    if (!key) return;

    // si no es admin, forzar cerrado y oculto (tu applyAdminOnlyUI lo oculta, pero por si acaso)
    if (sec.hasAttribute("data-admin-only") && !isAdmin) {
      sec.dataset.open = "0";
      return;
    }

    sec.dataset.open = state[key] ? "1" : "0";
  });
}

function bindOptionsAccordionOnce() {
  if (optionsAccordionBound) return;
  optionsAccordionBound = true;

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("#optionsAccordion .opt-sec-h");
    if (!btn) return;

    const sec = btn.closest(".opt-sec");
    if (!sec) return;

    // si es admin-only y no admin, ignorar
    if (sec.hasAttribute("data-admin-only") && !window.TPV_STATE?.isAdmin)
      return;

    const key = sec.getAttribute("data-sec");
    if (!key) return;

    const isOpen = sec.dataset.open === "1";
    sec.dataset.open = isOpen ? "0" : "1";

    // persistir
    const state = await loadOptionsAccordionState();
    state[key] = !isOpen;
    await saveOptionsAccordionState(state);
  });
}

let autostartToggleBound = false;

async function loadAutostartToggle() {
  const el = document.getElementById("autostartToggle");
  if (!el) return;

  try {
    const r = await window.TPV_AUTOSTART.get();

    if (!r?.ok) return;

    el.checked = !!r.autostart;

    if (!r.packaged) {
      el.title = "El autoinicio solo se aplica en la versión instalada del TPV";
    }
  } catch (e) {
    console.error("[OPTIONS] autostart load error:", e);
  }
}

function bindAutostartToggleOnce() {
  if (autostartToggleBound) return;
  autostartToggleBound = true;

  const el = document.getElementById("autostartToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    const wanted = !!el.checked;

    try {
      const r = await window.TPV_AUTOSTART.set(wanted);

      console.log("[OPTIONS] autostart set result:", r);

      if (!r?.ok) {
        el.checked = !wanted;
        return;
      }

      el.checked = !!r.autostart;
    } catch (e) {
      el.checked = !wanted;
      console.error("[OPTIONS] autostart set error:", e);
    }
  });
}

async function openOptions() {
  try {
    await ensureLoginAutoOrPrompt?.();
  } catch {}

  await loadPriceEditModeFromCfg?.();

  applyAdminOnlyUI?.();
  refreshOptionsUI?.();
  refreshPriceEditToggleUI?.();
  bindPriceEditToggleOnce?.();

  bindCustomerDisplayToggleOnce();
  await loadCustomerDisplayToggle();

  bindAutostartToggleOnce();
  await loadAutostartToggle();

  bindOptionsAccordionOnce();
  const st = await loadOptionsAccordionState();
  await applyOptionsAccordionState(st);

  optionsOverlay?.classList.remove("hidden");

  bindTerminalDefaultCustomerSave();

  await maybeRefreshTerminalDefaultCustomer("open-options", {
    minIntervalMs: 2000,
  }).catch(() => {});

  await renderTerminalDefaultCustomerSelect();
}

function closeOptions() {
  optionsOverlay?.classList.add("hidden");
}

optionsBtn?.addEventListener("click", () => openOptions());
optionsCloseX?.addEventListener("click", closeOptions);
optionsCloseBtn?.addEventListener("click", closeOptions);

optionsOverlay?.addEventListener("click", (e) => {
  if (e.target === optionsOverlay) closeOptions();
});

// ===== Cambiar impresora =====
optionsChangePrinterBtn?.addEventListener("click", async () => {
  try {
    closeOptions?.();

    const chosen = await openPrinterPicker();
    if (!chosen) {
      openOptions?.();
      return;
    }

    savePrinterReal(chosen);

    if (isLinux()) {
      toast?.("Configurando impresora...", "info", "Impresión");

      const r = await window.TPV_SETUP?.setupPosPrinter(chosen);
      if (!r || !r.ok) {
        toast?.(
          "Error configurando impresora: " + (r?.error || "desconocido"),
          "err",
          "Impresión",
        );
        openOptions?.();
        return;
      }

      savePrinterQueue("RECIPOK_POS");
      toast?.("Impresora lista ✅", "ok", "Impresión");
    }

    openOptions?.();
  } catch (e) {
    console.warn(e);
    toast?.("No se pudo cambiar impresora", "err", "Impresión");
    openOptions?.();
  }
});

// ===== Probar impresora =====
document
  .getElementById("optionsTestPrinterBtn")
  ?.addEventListener("click", async () => {
    try {
      closeOptions?.();

      if (isLinux()) {
        // asegura configuración + obtiene cola
        const queueName = await ensurePrinterSelectedForPrint();

        toast?.("Enviando prueba...", "info", "Impresión");
        const r = await window.TPV_SETUP?.testPosPrinter(queueName); // ver nota IPC abajo

        if (!r || !r.ok) {
          toast?.(
            "Error en prueba: " + (r?.error || "desconocido"),
            "err",
            "Impresión",
          );
          openOptions?.();
          return;
        }

        toast?.("Prueba enviada ✅", "ok", "Impresión");
        openOptions?.();
        return;
      }

      // Windows: HTML test
      const printerName = await ensurePrinterSelectedForPrint();
      if (!printerName) {
        toast?.("Selecciona una impresora primero.", "warn", "Impresión");
        openOptions?.();
        return;
      }

      toast?.("Enviando prueba...", "info", "Impresión");

      const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <style>body{font-family:Arial;font-size:12px;margin:0}.t{width:72mm;padding:8px}.c{text-align:center}.hr{border-top:1px dashed #000;margin:8px 0}</style>
    </head><body><div class="t">
      <div class="c"><b>PRUEBA RECIPOK</b></div>
      <div class="c">${new Date().toLocaleString("es-ES")}</div>
      <div class="hr"></div>
      <div>Si ves esto, la impresora funciona ✅</div>
      <div class="hr"></div>
      <div class="c">Fin de prueba</div>
    </div></body></html>`;

      const rr = await window.TPV_PRINT.printTicket({
        html,
        deviceName: printerName,
      });
      if (!rr || !rr.ok) {
        toast?.(
          "No se pudo imprimir la prueba: " + (rr?.error || "desconocido"),
          "err",
          "Impresión",
        );
        openOptions?.();
        return;
      }

      toast?.("Prueba enviada ✅", "ok", "Impresión");
      openOptions?.();
    } catch (e) {
      console.warn(e);
      toast?.("Error en prueba: " + (e?.message || e), "err", "Impresión");
      openOptions?.();
    }
  });

function isAutoPrintEnabled() {
  return localStorage.getItem(OPTIONS_AUTOPRINT_KEY) === "1";
}
function setAutoPrintEnabled(v) {
  localStorage.setItem(OPTIONS_AUTOPRINT_KEY, v ? "1" : "0");
}

function isGroupLinesEnabled() {
  const v = localStorage.getItem(OPTIONS_GROUPLINES_KEY);
  return v === null ? true : v === "1"; // por defecto true
}

function setGroupLinesEnabled(v) {
  localStorage.setItem(OPTIONS_GROUPLINES_KEY, v ? "1" : "0");
}

async function syncGroupLinesFromFS() {
  try {
    if (!currentTerminal?.id) return;

    // Lee el terminal actual desde FS
    const resp = await apiRead(`tpvterminales/${currentTerminal.id}`);
    const doc = resp?.doc || resp?.data || resp || null;
    if (!doc) return;

    const gl = !!doc.grouplines;
    setGroupLinesEnabled(gl);

    // si el toggle existe en el modal, refrescarlo
    if (typeof refreshOptionsUI === "function") refreshOptionsUI();

    console.log("✅ syncGroupLinesFromFS ->", gl);
  } catch (e) {
    console.warn("⚠️ No se pudo sync grouplines desde FS:", e?.message || e);
  }
}

async function pushGroupLinesToFS(enabled) {
  try {
    if (!currentTerminal?.id) return;

    // En FacturaScripts normalmente vale true/false (o 1/0). Enviamos 1/0 para asegurar.
    await apiWrite(`tpvterminales/${currentTerminal.id}`, "PUT", {
      grouplines: enabled ? 1 : 0,
    });

    console.log("✅ pushGroupLinesToFS ->", enabled);
  } catch (e) {
    console.warn("⚠️ No se pudo guardar grouplines en FS:", e?.message || e);
    toast?.("No se pudo guardar en FacturaScripts", "warn", "Opciones");
  }
}

const optionsTestPrinterBtn = document.getElementById("optionsTestPrinterBtn");

// Toggle auto-print
autoPrintToggle?.addEventListener("change", () => {
  setAutoPrintEnabled(!!autoPrintToggle.checked);
  if (typeof toast === "function") {
    toast(
      autoPrintToggle.checked
        ? "Auto-impresión activada ✅"
        : "Auto-impresión desactivada",
      "info",
      "Opciones",
    );
  }
});

// Toggle abrir cajón siempre
openDrawerAlwaysToggle?.addEventListener("change", () => {
  const v = !!openDrawerAlwaysToggle.checked;
  setOpenDrawerAlwaysEnabled(v);

  toast?.(
    v
      ? "El cajón se abrirá con cualquier método de pago ✅"
      : "El cajón solo se abrirá con pagos al contado ✅",
    "info",
    "Opciones",
  );
});

// Toggle agrupar líneas
groupLinesToggle?.addEventListener("change", async () => {
  const v = !!groupLinesToggle.checked;
  setGroupLinesEnabled(v);

  toast?.(
    v ? "Agrupar líneas activado ✅" : "Agrupar líneas desactivado ✅",
    "info",
    "Opciones",
  );

  // Guardar en FacturaScripts para que quede sincronizado
  await pushGroupLinesToFS(v);
});

async function handleOpenDrawerClick(btn, source = "MANUAL") {
  if (btn) {
    btn.disabled = true;
    btn.dataset._oldText = btn.textContent;
    btn.textContent = "Abriendo...";
  }

  try {
    await openDrawerNow({ source });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset._oldText || "🧾 Abrir cajón";
      delete btn.dataset._oldText;
    }
  }
}

const optionsQuitBtn = document.getElementById("optionsQuitBtn");

optionsQuitBtn?.addEventListener("click", async () => {
  try {
    await window.TPV_APP.attemptQuit();
  } catch (e) {
    console.warn(e);
  }
});

// Opciones
optionsOpenDrawerBtn?.addEventListener("click", () =>
  handleOpenDrawerClick(optionsOpenDrawerBtn, "OPTIONS"),
);

// Cobrar
payOpenDrawerBtn?.addEventListener("click", () =>
  handleOpenDrawerClick(payOpenDrawerBtn),
);

async function createTicketInFacturaScripts(ticketPayload) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new Error(
      "Config API de FacturaScripts no definida (baseUrl/apiKey).",
    );
  }

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/crearFacturaCliente`;

  const bodyParams = new URLSearchParams();
  bodyParams.append("codcliente", ticketPayload.codcliente);
  bodyParams.append("lineas", JSON.stringify(ticketPayload.lineas));

  // Vincular a TPV y caja (si el endpoint lo soporta)
  if (ticketPayload.idtpv)
    bodyParams.append("idtpv", String(ticketPayload.idtpv));
  if (ticketPayload.idcaja)
    bodyParams.append("idcaja", String(ticketPayload.idcaja));

  // Algunos setups usan estos flags
  bodyParams.append("tpv_venta", "1");

  // Intento de registrar forma de pago principal en FacturaScripts
  if (ticketPayload.codpago) {
    bodyParams.append("codpago", String(ticketPayload.codpago));
  }

  // Desglose de pagos
  if (Array.isArray(ticketPayload.pagos) && ticketPayload.pagos.length) {
    bodyParams.append("pagos", JSON.stringify(ticketPayload.pagos));
  }

  // Solo enviamos 'pagada' como extra
  if (ticketPayload.pagada !== undefined) {
    bodyParams.append("pagada", String(ticketPayload.pagada));
  }

  // Numero2
  if (ticketPayload.numero2) {
    bodyParams.append("numero2", String(ticketPayload.numero2));
  }

  // Serie
  if (ticketPayload.serie) {
    bodyParams.append("codserie", String(ticketPayload.serie));
  }

  // ✅ NUEVO: nick (para que no se pierda)
  if (ticketPayload.nick) {
    bodyParams.append("nick", String(ticketPayload.nick));
  }

  console.log(">>> Enviando a crearFacturaCliente:", bodyParams.toString());

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: bodyParams.toString(),
  });

  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    console.error("Error 429 crearFacturaCliente:", text);
    throw new Error(
      "La API ha devuelto 429 (demasiadas peticiones). " +
        "Es un bloqueo temporal por seguridad; espera unos minutos antes de seguir usando el TPV.",
    );
  }

  if (!res.ok) {
    let msg = `Error HTTP ${res.status}`;
    try {
      const errData = await res.json();
      console.error("Respuesta de error crearFacturaCliente:", errData);
      if (errData.message) msg += `: ${errData.message}`;
      if (errData.errors)
        msg += " | Detalles: " + JSON.stringify(errData.errors);
    } catch (e) {
      const text = await res.text().catch(() => "");
      if (text) msg += `: ${text}`;
    }
    throw new Error(msg);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    console.error("No se pudo parsear JSON de crearFacturaCliente:", e);
    throw new Error(
      "Respuesta no válida de FacturaScripts al crear la factura.",
    );
  }

  if (data.error || data.errors) {
    console.error("Errores en crearFacturaCliente:", data);
    throw new Error(data.error || JSON.stringify(data.errors));
  }

  console.log("Respuesta OK crearFacturaCliente:", data);
  return data;
}

function buildTicketPrintData(apiResponse, ticketPayload, cartSnapshot) {
  const factura =
    apiResponse.doc || apiResponse.factura || apiResponse.data || apiResponse;

  const paymentMethod =
    factura.formapago ||
    factura.metodopago ||
    factura.codpago ||
    factura.codpago_desc ||
    ticketPayload.paymentMethod ||
    "Efectivo";

  const codigo = factura.codigo || factura.codigoFactura || null;

  // fallback por si alguna instalación no devuelve codigo en esa respuesta
  const numeroFallback =
    factura.numfactura ||
    factura.numero ||
    factura.idfactura ||
    factura.id ||
    null;

  const numero = codigo || numeroFallback;

  const totalFromFactura =
    typeof factura.total !== "undefined" ? Number(factura.total) : null;

  const totalFromCart = cartSnapshot.reduce((sum, item) => {
    const unitPrice = getUnitGross(item);
    return sum + unitPrice * (item.qty || 1);
  }, 0);

  // ✅ FIX: sacar el nombre del cliente del input
  const clientName =
    (cartClientInput && (cartClientInput.value || "").trim()) || "Cliente";

  return {
    numero,
    paymentMethod,
    fecha: factura.fecha || ticketPayload.fecha,
    hora: factura.hora || ticketPayload.hora,
    total: totalFromFactura !== null ? totalFromFactura : totalFromCart,

    // ✅ mejor guardar el estado real en el ticket (por si luego cierras caja)
    terminalName: currentTerminal ? currentTerminal.name || "" : "",
    agentName: currentAgent ? currentAgent.name || "" : "",

    clientName,
    company: companyInfo ? { ...companyInfo } : null,
    lineas: cartSnapshot,
  };
}

async function openPrinterPicker() {
  const overlay = document.getElementById("printerOverlay");
  const select = document.getElementById("printerSelect");
  const okBtn = document.getElementById("printerOkBtn");
  const cancelBtn = document.getElementById("printerCancelBtn");
  const errEl = document.getElementById("printerError");

  if (!overlay || !select || !okBtn || !cancelBtn) {
    throw new Error("Falta el modal de impresoras en index.html");
  }

  if (!window.TPV_PRINT) {
    throw new Error("TPV_PRINT no está disponible (preload.js/IPC).");
  }

  // Cargamos impresoras del sistema
  const printers = await window.TPV_PRINT.listPrinters();
  if (!printers || printers.length === 0) {
    throw new Error("No se encontraron impresoras instaladas en este equipo.");
  }

  select.innerHTML = "";
  printers.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.isDefault
      ? `${p.displayName} (predeterminada)`
      : p.displayName;
    select.appendChild(opt);
  });

  // Preseleccionar la guardada o la predeterminada
  const saved = getSavedPrinterReal();
  if (saved && printers.some((p) => p.name === saved)) {
    select.value = saved;
  } else {
    const def = printers.find((p) => p.isDefault);
    if (def) select.value = def.name;
  }

  if (errEl) errEl.textContent = "";
  overlay.classList.remove("hidden");

  return await new Promise((resolve) => {
    const cleanup = () => {
      okBtn.onclick = null;
      cancelBtn.onclick = null;
    };

    cancelBtn.onclick = () => {
      cleanup();
      overlay.classList.add("hidden");
      resolve(""); // cancelado
    };

    okBtn.onclick = () => {
      const chosen = select.value || "";
      if (!chosen) {
        if (errEl) errEl.textContent = "Selecciona una impresora.";
        return;
      }
      cleanup();
      overlay.classList.add("hidden");
      resolve(chosen);
    };
  });
}

function normalizeRefundDesc(desc) {
  return String(desc || "")
    .trim()
    .replace(/^DEV\s*-\s*/i, "")
    .replace(/\s+/g, " ");
}

function keyForRefundMatch(desc, pvpunitario, codimpuesto) {
  const d = normalizeRefundDesc(desc);
  const p = Math.round(Math.abs(Number(pvpunitario || 0)) * 100) / 100;
  const c = String(codimpuesto || "").trim();
  return `${d}|${p}|${c}`;
}

// Cache simple de formas de pago (codpago -> descripcion)
let __formasPagoMapCache = null;
async function getFormasPagoMap() {
  if (__formasPagoMapCache) return __formasPagoMapCache;

  try {
    const rows = await fetchApiResourceWithParams("formapagos", {
      limit: 2000,
    });
    const map = {};
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      const k = String(r.codpago || "").trim();
      if (k) map[k] = String(r.descripcion || k);
    });
    __formasPagoMapCache = map;
    return map;
  } catch (e) {
    console.warn("[printTicket] No pude cargar formapagos:", e?.message || e);
    __formasPagoMapCache = {};
    return __formasPagoMapCache;
  }
}

function getTaxRateForLine(l) {
  const direct = Number(l?.taxRate);
  if (isFinite(direct) && direct > 0) return direct;

  const fromCode = Number(extractTaxRateFromCode(l?.codimpuesto));
  if (isFinite(fromCode) && fromCode > 0) return fromCode;

  return 0;
}

function getUnitGrossForPrint(l) {
  if (l && typeof l.__forceUnitGross === "number")
    return Number(l.__forceUnitGross) || 0;
  if (l && l.grossPriceOverride != null)
    return Number(l.grossPriceOverride) || 0;
  if (typeof l.grossPrice === "number" && !isNaN(l.grossPrice))
    return Number(l.grossPrice);

  if (typeof l.price === "number" && !isNaN(l.price)) {
    const tax = getTaxRateForLine(l);
    return Number(l.price) * (1 + tax / 100);
  }

  if (typeof l.pvpunitario !== "undefined") {
    const tax = getTaxRateForLine(l);
    return (Number(l.pvpunitario) || 0) * (1 + tax / 100);
  }

  return 0;
}

function isPriceModifiedForPrint(l) {
  // Solo consideramos MOD cuando el carrito trae override
  if (!l || l.grossPriceOverride == null) return false;

  const ov = Number(l.grossPriceOverride);
  if (!isFinite(ov)) return false;

  const og = Number(
    l.originalGrossPrice ?? l.grossPrice ?? l.price ?? l.__forceUnitGross,
  );

  // Si no hay original, igual marcamos MOD (pero idealmente siempre lo hay en carrito)
  if (!isFinite(og)) return true;

  return Math.abs(ov - og) > 0.0001;
}

function getOriginalUnitGrossForPrint(l) {
  const og = Number(l?.originalGrossPrice ?? l?.grossPrice ?? l?.price);
  return isFinite(og) ? og : 0;
}

function calcTotalsAndTaxMap(lineas, totalsOnlyPositive) {
  let totalToShow = 0;
  const taxMap = {}; // { rate: { base, iva } }

  for (const l of lineas || []) {
    const qty = Number(l.qty ?? l.cantidad ?? 1) || 1;

    const includeInTotals = totalsOnlyPositive ? qty > 0 : true;
    if (!includeInTotals) continue;

    const unitGross = getUnitGrossForPrint(l);
    const lineGross = round2(unitGross * qty);

    totalToShow = round2(totalToShow + lineGross);

    const rate = getTaxRateForLine(l);
    const divisor = 1 + rate / 100;

    const lineBase =
      divisor > 0 ? round2(lineGross / divisor) : round2(lineGross);
    const lineIva = round2(lineGross - lineBase);

    if (!taxMap[rate]) taxMap[rate] = { base: 0, iva: 0 };
    taxMap[rate].base = round2(taxMap[rate].base + lineBase);
    taxMap[rate].iva = round2(taxMap[rate].iva + lineIva);
  }

  return { totalToShow, taxMap };
}

function renderItemsHtml(doc, lineas) {
  const box = doc.getElementById("items");
  if (!box) return;

  const safe = (s) => escapeHtml(String(s ?? ""));

  const cleanSpecialPrefix = (s) =>
    String(s || "")
      .replace(/^AJUSTE PAGO\s*-\s*/i, "")
      .replace(/^DEV\s*-\s*/i, "")
      .trim();

  const pickMainAndDesc = (l) => {
    const main = cleanSpecialPrefix(
      l.ref ??
        l.referencia ??
        l.codigo ??
        l.codarticulo ??
        l.sku ??
        l.name ??
        l.nombre ??
        "",
    );

    let desc = cleanSpecialPrefix(
      l.secondaryName ?? l.descripcion2 ?? l.detalle ?? "",
    );

    // ✅ fallback: si no hay secundaria, intentar usar descripcion
    const fallbackDesc = cleanSpecialPrefix(l.descripcion ?? "");

    if (
      !desc &&
      fallbackDesc &&
      fallbackDesc.toLowerCase() !== main.toLowerCase()
    ) {
      desc = fallbackDesc;
    }

    if (!main && desc) return { main: desc, desc: "" };
    if (main && desc && main.toLowerCase() === desc.toLowerCase()) desc = "";

    return { main, desc };
  };

  const getQtyForPrint = (l) => {
    const q = l.qty ?? l.cantidad ?? l.quantity ?? l.cant ?? 0;
    const n = Number(q);
    return isNaN(n) ? 0 : n;
  };

  const arr = Array.isArray(lineas) ? lineas : [];

  box.innerHTML = arr
    .map((l) => {
      const isChild = isPackChildForPrint(l);
      const qty = getQtyForPrint(l);

      const unitGross =
        l.__unitGrossOverride != null
          ? Number(l.__unitGrossOverride || 0)
          : l.__forceUnitGross != null
            ? Number(l.__forceUnitGross || 0)
            : Number(getUnitGrossForPrint(l) || 0);

      const lineTotal =
        l.__lineTotalOverride != null
          ? Number(l.__lineTotalOverride || 0)
          : isChild
            ? 0
            : qty * unitGross;

      const { main, desc } = pickMainAndDesc(l);

      const leftQtyHtml = isChild ? "" : safe(qty);

      // ✅ hijos: xN o x-N
      const qtyInline =
        qty < 0 ? `x-${safe(Math.abs(qty))}` : `x${safe(Math.abs(qty))}`;

      const nameHtml = isChild
        ? `↳ ${safe(main)} <span class="muted">${qtyInline}</span>`
        : safe(main);

      const totalHtml = isChild ? "" : eurTicket(lineTotal);

      return `
        <div class="item ${isChild ? "pack-child" : ""}">
          <div class="item-top">
            <div class="qty">${leftQtyHtml}</div>
            <div class="desc">${nameHtml}</div>
            <div class="ltotal">${totalHtml}</div>
          </div>
          ${desc ? `<div class="item-sub small muted">${safe(desc)}</div>` : ""}
        </div>
      `;
    })
    .join("");
}

function renderTaxSummaryHtml(doc, taxMap) {
  const taxSummaryEl = doc.getElementById("taxSummary");
  if (!taxSummaryEl) return;

  taxSummaryEl.innerHTML = "";

  const nearlyZero = (n) => Math.abs(Number(n || 0)) < 0.005;

  const ratesSorted = Object.keys(taxMap)
    .map((r) => Number(r))
    .filter((r) => !isNaN(r) && r !== 0)
    .sort((a, b) => a - b);

  for (const r of ratesSorted) {
    const base = Number(taxMap[r]?.base || 0);
    const iva = Number(taxMap[r]?.iva || 0);

    // 👇 si ambos son 0, no lo muestres
    if (nearlyZero(base) && nearlyZero(iva)) continue;

    appendRow(taxSummaryEl, `Base Imponible ${r}%`, eurTicket(base));
    appendRow(taxSummaryEl, `IVA ${r}%`, eurTicket(iva));
  }
}

function stripIncluyeFromDesc(desc) {
  const s = String(desc || "").trim();
  if (!s) return "";

  // Corta desde "· Incluye:" o "Incluye:"
  return s
    .replace(/\s*·\s*Incluye\s*:\s*.*$/i, "")
    .replace(/\s*Incluye\s*:\s*.*$/i, "")
    .trim();
}

function buildFsLinesFromCart(cartArr) {
  if (!Array.isArray(cartArr) || cartArr.length === 0) return [];

  return (
    cartArr
      // ✅ NO mandar hijos a FS (el plugin los añade/gestiona)
      .filter((item) => !item?.meta?.includedInPack)
      .map((item) => {
        const qty = Number(item.qty || 1) || 1;

        // Precio unitario BRUTO (IVA incl.)
        const unitGross = Number(getUnitGross(item) || 0);

        // Convertimos a NETO para FS
        const tax = Number(item.taxRate || 0);
        const divisor = 1 + tax / 100;
        const unitNetRaw = divisor > 0 ? unitGross / divisor : unitGross;

        // precisión alta para evitar errores de redondeo
        const unitNet = Math.round((unitNetRaw + Number.EPSILON) * 1e8) / 1e8;

        // referencia separada (FS)
        const ref = String(item.referencia || item.name || "").trim() || "-";

        // ✅ Descripción: SIEMPRE la original, sin "Incluye"
        const baseDesc =
          item.descripcion2 ||
          item.secondaryName ||
          item.descripcion ||
          item.name ||
          "-";

        const descClean = stripIncluyeFromDesc(baseDesc) || "-";

        const linea = {
          referencia: ref,
          descripcion: descClean,
          cantidad: qty,
          pvpunitario: unitNet,
          idproducto: Number(item.baseProductId || item.id || 0) || undefined,
        };

        if (item.codimpuesto) linea.codimpuesto = item.codimpuesto;

        return linea;
      })
  );
}

function round2(n) {
  const v = Number(n) || 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function eurTicket(n) {
  const v = Number(n) || 0;
  return v.toFixed(2).replace(".", ",");
}

// Render de pagos: Total + filas por método
async function renderPayments(doc, ticket, totalToShow) {
  const map = await getFormasPagoMap();
  const pagos = Array.isArray(ticket.pagos) ? ticket.pagos : [];

  // Agrupar por descripción final (por si vienen repetidos)
  const grouped = {};
  for (const p of pagos) {
    const code = String(p.codpago || "—").trim() || "—";
    const desc = map[code] || code;
    const imp = Number(p.importe ?? 0) || 0;
    grouped[desc] = (grouped[desc] || 0) + imp;
  }

  const wrap = doc.getElementById("payments");
  const cashRow = doc.getElementById("cashRow");
  const cashGiven = doc.getElementById("cashGiven");
  const changeRow = doc.getElementById("changeRow");
  const changeCash = doc.getElementById("changeCash");

  const cashMeta = ticket?.cashMeta || null;

  if (!wrap) {
    const paymentMethodEl = doc.getElementById("paymentMethod");
    if (paymentMethodEl) {
      paymentMethodEl.textContent = Object.entries(grouped)
        .map(([d, imp]) => `${d}: ${eurTicket(imp)}`)
        .join(" + ");
    }

    const paidAmountEl = doc.getElementById("paidAmount");
    if (paidAmountEl) paidAmountEl.textContent = eurTicket(totalToShow);

    return;
  }

  wrap.innerHTML = "";

  // Total
  const rowTotal = doc.createElement("div");
  rowTotal.className = "row";
  rowTotal.innerHTML = `
    <div class="bold">Total</div>
    <div class="bold right">${eurTicket(totalToShow)}</div>
  `;
  wrap.appendChild(rowTotal);

  // Métodos
  Object.entries(grouped).forEach(([desc, imp]) => {
    const row = doc.createElement("div");
    row.className = "row small muted";
    row.innerHTML = `
      <div>${escapeHtml(desc)}</div>
      <div class="right">${eurTicket(imp)}</div>
    `;
    wrap.appendChild(row);
  });

  // Entregado / Cambio (solo si hubo efectivo real)
  if (cashMeta && cashMeta.hasCash && Number(cashMeta.cashTendered || 0) > 0) {
    if (cashRow && cashGiven) {
      cashRow.style.display = "flex";
      cashGiven.textContent = eurTicket(cashMeta.cashTendered);
    }

    if (changeRow && changeCash) {
      if (Number(cashMeta.change || 0) > 0) {
        changeRow.style.display = "flex";
        changeCash.textContent = eurTicket(cashMeta.change);
      } else {
        changeRow.style.display = "none";
      }
    }
  } else {
    if (cashRow) cashRow.style.display = "none";
    if (changeRow) changeRow.style.display = "none";
  }
}

function buildEscposTicketBytes(ticket, lineas, totalToShow) {
  const ESC = 0x1b;
  const GS = 0x1d;

  const out = [];
  const enc = new TextEncoder();

  const push = (s) => out.push(...enc.encode(String(s)));
  const hr = () => push("--------------------------------\n");

  const pickMainAndDesc = (l) => {
    const main = (
      l.ref ??
      l.referencia ??
      l.codigo ??
      l.codarticulo ??
      l.sku ??
      l.name ??
      l.nombre ??
      ""
    )
      .toString()
      .trim();

    let desc = (
      l.secondaryName ??
      l.descripcion2 ??
      l.detalle ??
      l.descripcion ??
      ""
    )
      .toString()
      .trim();

    if (!main && desc) return { main: desc, desc: "" };
    if (main && desc && main.toLowerCase() === desc.toLowerCase()) desc = "";
    return { main, desc };
  };

  const getQtyForPrint = (l) => {
    const q = l.qty ?? l.cantidad ?? l.quantity ?? l.cant ?? 0;
    const n = Number(q);
    return isNaN(n) ? 0 : n;
  };

  out.push(ESC, 0x40); // init

  const emp = ticket.company || companyInfo || {};
  const term = (currentTerminal?.name || ticket.terminalName || "").trim();
  const ag = (currentAgent?.name || ticket.agentName || "").trim();

  push((emp.nombrecorto || "RECIPOK") + "\n");
  if (emp.cifnif) push(String(emp.cifnif) + "\n");
  hr();

  push(`Ticket: ${ticket.numero ?? "—"}\n`);
  const fecha = (ticket.fecha || "").trim();
  const hora = (ticket.hora || "").trim();
  if (fecha || hora) push(`Fecha: ${fecha} ${hora}\n`);
  if ((ticket.clientName || "").trim()) push(`Cliente: ${ticket.clientName}\n`);
  if (term) push(`Terminal: ${term}\n`);
  if (ag) push(`Agente: ${ag}\n`);
  push("\n");

  for (const l of lineas || []) {
    const qty = getQtyForPrint(l);
    const isChild = isPackChildForPrint(l);

    const unitGross = getUnitGrossForPrint(l);
    const lineGross = unitGross * qty;

    const { main, desc } = pickMainAndDesc(l);

    if (isChild) {
      // hijo: sin qty izquierda, qty a la derecha, sin total
      push(`   ↳ ${main} x${qty}\n`);
      if (desc) push(`      ${desc}\n`);
    } else {
      // normal/parent
      push(`${qty}  ${main}\n`);
      if (desc) push(`    ${desc}\n`);
      push(`    ${eurTicket(lineGross)}\n`);
    }
  }

  push("\n");
  hr();
  push(`TOTAL: ${eurTicket(totalToShow)}\n`);
  push("\n\n");

  out.push(GS, 0x56, 0x42, 0x60); // cut+feed
  return out;
}

async function getFacturaLinesForPrint(ticket) {
  const idfactura = Number(ticket?.idfactura || ticket?._raw?.idfactura || 0);
  if (!idfactura) {
    return Array.isArray(ticket?.lineas) ? ticket.lineas : [];
  }

  const fsLines = await fetchLineasFacturaCliente(idfactura);
  return Array.isArray(fsLines) ? fsLines : [];
}

async function getPrintableTicketMeta(ticket) {
  const raw = ticket?._raw || {};

  const idfactura = Number(ticket?.idfactura || raw?.idfactura || 0);

  const numero2 = String(ticket?.numero2 || raw?.numero2 || "")
    .trim()
    .toUpperCase();

  const codserie = String(ticket?.codserie || raw?.codserie || "")
    .trim()
    .toUpperCase();

  // -----------------------------
  // Cambio de método de pago
  // -----------------------------
  if (numero2.startsWith("PAYCHGREF|")) {
    return {
      kind: "PAYCHG_RECT",
      label: "Factura Rectificativa",
      badge: "ANULACIÓN POR CAMBIO DE PAGO",
      isRect: true,
    };
  }

  if (numero2.startsWith("PAYCHG|")) {
    return {
      kind: "PAYCHG_NEW",
      label: "Factura Simplificada",
      badge: "",
      isRect: false,
    };
  }

  // -----------------------------
  // Devoluciones reales (ticket negativo)
  // -----------------------------
  if (numero2.startsWith("REFUND|")) {
    return {
      kind: "REFUND",
      label: "Factura Rectificativa",
      badge: "DEVOLUCIÓN",
      isRect: true,
    };
  }

  // -----------------------------
  // Rectificativa normal
  // -----------------------------
  if (codserie === "R") {
    return {
      kind: "RECT",
      label: "Factura Rectificativa",
      badge: "",
      isRect: true,
    };
  }

  // -----------------------------
  // Ticket simplificado normal:
  // comprobar SOLO devoluciones reales
  // -----------------------------
  if (idfactura) {
    try {
      // ✅ si este ticket fue origen de un cambio de pago,
      // no debe salir como devuelto/parcial
      const facturasRelacionadas = await fetchApiResourceWithParams(
        "facturaclientes",
        {
          limit: 0,
          "filter[numero2_like]": `ORIG=${idfactura}`,
        },
      );

      const rel = Array.isArray(facturasRelacionadas)
        ? facturasRelacionadas
        : [];

      const hasPayChangeRelation = rel.some((f) => {
        const n2 = String(f?.numero2 || "")
          .trim()
          .toUpperCase();
        return n2.startsWith("PAYCHG|") || n2.startsWith("PAYCHGREF|");
      });

      if (hasPayChangeRelation) {
        return {
          kind: "NORMAL",
          label: "Factura Simplificada",
          badge: "",
          isRect: false,
        };
      }

      // ✅ solo aquí evaluamos devoluciones reales
      const origLines = await fetchLineasFacturaCliente(idfactura);
      const refundedMap = await buildRefundedQtyMapForOriginal(idfactura);

      let soldTotal = 0;
      let refundedTotal = 0;

      for (const l of Array.isArray(origLines) ? origLines : []) {
        const sold = Math.max(0, Number(l?.cantidad || 0));
        if (!(sold > 0)) continue;

        const key = lineKeyForMatch(
          normalizeRefundDesc(l.descripcion),
          l.pvpunitario,
          l.codimpuesto,
        );

        const refunded = Math.max(0, Number(refundedMap?.[key] || 0));

        soldTotal += sold;
        refundedTotal += Math.min(refunded, sold);
      }

      if (soldTotal > 0) {
        if (refundedTotal >= soldTotal) {
          return {
            kind: "REFUNDED",
            label: "Factura Simplificada",
            badge: "DEVUELTO",
            isRect: false,
          };
        }

        if (refundedTotal > 0) {
          return {
            kind: "PARTIAL_REFUND",
            label: "Factura Simplificada",
            badge: "DEVOLUCIÓN PARCIAL",
            isRect: false,
          };
        }
      }
    } catch (e) {
      console.warn(
        "[getPrintableTicketMeta] no pude calcular devoluciones:",
        e?.message || e,
      );
    }
  }

  // -----------------------------
  // Ticket normal
  // -----------------------------
  return {
    kind: "NORMAL",
    label: "Factura Simplificada",
    badge: "",
    isRect: false,
  };
}

async function printTicket(ticket) {
  try {
    if (!ticket) {
      toast("No hay ticket para imprimir.", "warn", "Impresión");
      return;
    }

    const isLinux = window.TPV_ENV?.platform === "linux";

    const printerName = await ensurePrinterSelectedForPrint();
    if (!printerName) {
      toast("Impresión cancelada (sin impresora).", "warn", "Impresión");
      return;
    }

    // 1) Fecha/hora base
    const now = new Date();
    const fecha = ticket.fecha || now.toLocaleDateString("es-ES");
    const hora =
      ticket.hora ||
      now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

    // 2) Tipo de ticket
    const metaPrint = await getPrintableTicketMeta(ticket);

    let isRect = !!metaPrint.isRect;

    let lineas = Array.isArray(ticket.lineas) ? ticket.lineas : [];
    let totalsOnlyPositive = false;

    try {
      // ✅ SIEMPRE intentar imprimir las líneas REALES del ticket actual
      if (ticket.idfactura || ticket?._raw?.idfactura) {
        const fsLines = await getFacturaLinesForPrint(ticket);

        if (Array.isArray(fsLines) && fsLines.length) {
          lineas = fsLines.map((l) => {
            const tax = Number(extractTaxRateFromCode(l.codimpuesto) || 0);
            const unitGross = (Number(l.pvpunitario) || 0) * (1 + tax / 100);

            return {
              idlinea: l.idlinea,
              orden: l.orden,
              idproducto: l.idproducto,
              referencia: l.referencia || "",
              descripcion: l.descripcion,
              cantidad: Number(l.cantidad || 0),
              pvpunitario: Number(l.pvpunitario || 0),
              codimpuesto: l.codimpuesto,
              taxRate: tax,
              __forceUnitGross: unitGross,
              recargo: Number(l.recargo || 0),
              pvpsindto: Number(l.pvpsindto || 0),
              pvptotal: Number(l.pvptotal || 0),
            };
          });
        }
      }
    } catch (e) {
      console.warn(
        "[printTicket] no pude cargar líneas reales para imprimir:",
        e?.message || e,
      );
    }

    // ✅ Asegurar packs cargados antes de normalizar
    try {
      if (!PACKS_STATE?.ready && typeof warmupPacksData === "function") {
        await warmupPacksData();
      }
    } catch (e) {
      console.warn("[printTicket] warmupPacksData falló:", e?.message || e);
    }

    // ✅ Normalizar para imprimir packs
    try {
      if (typeof preparePrintableTicket === "function") {
        const tNorm = preparePrintableTicket({ ...ticket, lineas });
        lineas = Array.isArray(tNorm?.lineas) ? tNorm.lineas : lineas;
      }
    } catch (e) {
      console.warn(
        "[printTicket] preparePrintableTicket falló:",
        e?.message || e,
      );
    }

    // 3) Totales + IVA/Base
    const { totalToShow, taxMap } = calcTotalsAndTaxMap(
      lineas,
      totalsOnlyPositive,
    );

    // 4) Linux: RAW ESC/POS
    if (isLinux) {
      if (!window.TPV_PRINT?.printRaw) {
        toast("Falta printRaw en TPV_PRINT (preload/IPC).", "err", "Impresión");
        return;
      }

      const ticketForRaw = { ...ticket, fecha, hora };

      const bytes = buildEscposTicketBytes(ticketForRaw, lineas, totalToShow);

      const r = await window.TPV_PRINT.printRaw({
        bytes,
        deviceName: printerName,
      });

      if (!r || !r.ok) {
        toast(
          "No se pudo imprimir (Linux RAW): " + (r?.error || "error"),
          "err",
          "Impresión",
        );
        return;
      }

      toast("Ticket impreso ✅", "ok", "Impresión");
      return;
    }

    // 5) Windows: HTML
    let templateHtml = "";
    try {
      const res = await fetch("ticket_print.html", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      templateHtml = await res.text();
    } catch (e) {
      toast(
        "No puedo cargar ticket_print.html: " + (e?.message || e),
        "err",
        "Impresión",
      );
      return;
    }

    const doc = new DOMParser().parseFromString(templateHtml, "text/html");

    setText(
      doc,
      "invoiceLabel",
      metaPrint.label ||
        (isRect ? "Factura Rectificativa" : "Factura Simplificada"),
    );
    const badgeEl = doc.getElementById("ticketTypeBadge");
    if (badgeEl) {
      const badgeTxt = String(metaPrint.badge || "").trim();
      if (badgeTxt) {
        badgeEl.textContent = badgeTxt;
        badgeEl.style.display = "block";
      } else {
        badgeEl.style.display = "none";
      }
    }
    setText(doc, "invoiceNumber", ticket.numero != null ? ticket.numero : "—");
    setText(doc, "ticketDate", `${fecha} ${hora}`);
    setText(doc, "clientName", (ticket.clientName || "").trim() || "Cliente");

    const emp = ticket.company || companyInfo || null;
    const logoEl = doc.getElementById("companyLogo");
    const logoUrl = companyLogoUrl || "";
    if (logoEl && logoUrl) {
      logoEl.setAttribute("src", logoUrl);
      logoEl.style.display = "inline-block";
    }
    setText(doc, "companyShortName", emp?.nombrecorto || "—");
    setText(doc, "companyLegalName", emp?.nombre || "");
    setText(doc, "companyAddress", emp?.direccion || "");
    setText(doc, "companyZip", emp?.codpostal ? emp.codpostal + ", " : "");
    setText(doc, "companyCity", emp?.ciudad || "");
    setText(doc, "companyCif", emp?.cifnif || "—");
    setText(doc, "companyPhone", emp?.telefono1 || "");

    const terminalTexto =
      (currentTerminal?.name || ticket.terminalName || "").trim() || "—";
    const agenteTexto =
      (currentAgent?.name || ticket.agentName || "").trim() || "—";
    setText(doc, "terminalName", terminalTexto);
    setText(doc, "agentName", agenteTexto);

    renderItemsHtml(doc, lineas);
    renderTaxSummaryHtml(doc, taxMap);

    setText(doc, "grandTotal", eurTicket(totalToShow));
    await renderPayments(doc, ticket, totalToShow);

    const finalHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;

    const r2 = await window.TPV_PRINT.printTicket({
      html: finalHtml,
      deviceName: printerName,
    });

    if (!r2 || !r2.ok) {
      toast(
        "No se pudo imprimir: " + (r2?.error || "error desconocido"),
        "err",
        "Impresión",
      );
      return;
    }

    toast("Ticket impreso ✅", "ok", "Impresión");
  } catch (e) {
    console.error("[printTicket] error:", e);
    toast("Error al imprimir: " + (e?.message || e), "err", "Impresión");
  }
}

async function printCashCloseReport(report) {
  try {
    const isLinux = window.TPV_ENV?.platform === "linux";

    const printerName = await ensurePrinterSelectedForPrint();
    if (!printerName) {
      toast("Impresión cancelada (sin impresora).", "warn", "Impresión");
      return;
    }

    const decodeEntities = (s) =>
      String(s || "")
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

    // -------- Linux: RAW simple (texto) --------
    if (isLinux) {
      if (!window.TPV_PRINT?.printRaw) {
        toast("Falta printRaw en TPV_PRINT (preload/IPC).", "err", "Impresión");
        return;
      }

      const lines = [];
      lines.push("CIERRE DE CAJA");
      lines.push(`${report.fecha} ${report.hora}`);
      lines.push("--------------------------------");
      lines.push(`Caja: ${report.cajaId || "-"}`);
      lines.push(`TPV: ${report.terminal || "-"}`);
      lines.push(`Inicio: ${report.fechaini || "-"}`);
      lines.push("--------------------------------");
      lines.push(
        `Total vendido: ${Number(report.totalVendido || 0).toFixed(2)} EUR`,
      );
      lines.push(`Tickets: ${Number(report.numTickets || 0)}`);
      lines.push(`Métodos usados: ${Number(report.totalPaymentUses || 0)}`);
      lines.push("--------------------------------");
      lines.push("Metodos de pago:");
      let totalMethods = 0;

      (report.methods || []).forEach((m) => {
        const name = (m.label || m.code || "-").toString();
        const totalNum = Number(m.total || 0);
        const total = totalNum.toFixed(2);
        const cnt = Number(m.count || 0);
        totalMethods += totalNum;
        lines.push(`${name} (${cnt})  ${total}`);
      });

      lines.push(`TOTAL PAGOS: ${totalMethods.toFixed(2)}`);

      if (Number(report.payEditsCount || 0) > 0) {
        const edits = Number(report.payEditsCount || 0);
        if (edits > 0) lines.push(`Nº cambios pago: ${edits}`);
      }

      const agents = Array.isArray(report.agentSales) ? report.agentSales : [];
      if (agents.length > 0) {
        lines.push("--------------------------------");
        lines.push("Ventas por agente:");

        let totalAgents = 0;

        agents.forEach((a) => {
          const n = (a.agentName || a.name || a.agentCode || "-").toString();
          const tNum = Number(a.total || 0);
          const t = tNum.toFixed(2);
          const c = Number(a.count || 0);
          totalAgents += tNum;
          lines.push(`${n} (${c})  ${t}`);
        });

        lines.push(`TOTAL AGENTES: ${totalAgents.toFixed(2)}`);
      }

      if (report.userObs && String(report.userObs).trim()) {
        lines.push("--------------------------------");
        lines.push("Observaciones:");
        lines.push(String(report.userObs));
      }

      const rawAutoLog = report.autoLogText ?? report.autoLog ?? "";
      const cleanAutoLog = decodeEntities(rawAutoLog);

      if (cleanAutoLog && String(cleanAutoLog).trim()) {
        lines.push("--------------------------------");
        lines.push("Registro TPV:");
        lines.push(String(cleanAutoLog));
      }

      lines.push("\n\n");

      const txt = lines.join("\n");
      const bytes = Array.from(new TextEncoder().encode(txt));

      const r = await window.TPV_PRINT.printRaw({
        bytes,
        deviceName: printerName,
      });

      if (!r || !r.ok) {
        toast(
          "No se pudo imprimir cierre: " + (r?.error || "error"),
          "err",
          "Impresión",
        );
        return;
      }

      toast("Cierre impreso ✅", "ok", "Impresión");
      return;
    }

    // -------- Windows: HTML --------
    let templateHtml = "";
    try {
      const res = await fetch("cash_close_print.html", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      templateHtml = await res.text();
    } catch (e) {
      toast(
        "No puedo cargar cash_close_print.html: " + (e?.message || e),
        "err",
        "Impresión",
      );
      return;
    }

    const doc = new DOMParser().parseFromString(templateHtml, "text/html");

    const eur2 = (n) =>
      Number(n || 0)
        .toFixed(2)
        .replace(".", ",") + " €";

    const _setText = (id, v) => {
      const el = doc.getElementById(id);
      if (el) el.textContent = v == null ? "" : String(v);
    };

    const logoEl = doc.getElementById("companyLogo");
    if (logoEl && companyLogoUrl) {
      logoEl.setAttribute("src", companyLogoUrl);
      logoEl.style.display = "inline-block";
    }

    _setText("companyShortName", report.companyShortName || "");
    _setText("companyLegalName", report.companyLegalName || "");

    _setText("ccDate", `${report.fecha} ${report.hora}`);
    _setText("ccCajaId", report.cajaId || "—");
    _setText("ccTerminal", report.terminal || "—");
    _setText("ccOpeningAt", report.fechaini || "—");

    _setText("ccTotalSales", eur2(report.totalVendido || 0));
    _setText("ccNumTickets", String(report.numTickets ?? "0"));
    _setText("ccOpeningCash", eur2(report.openingTotal || 0));
    _setText("ccCashIncome", eur2(report.cashIncome || 0));
    _setText("ccMovements", eur2(report.movements || 0));
    _setText("ccExpectedCash", eur2(report.expectedCash || 0));
    _setText("ccCountedCash", eur2(report.countedCash || 0));
    _setText("ccDifference", eur2(report.difference || 0));

    // métodos
    const methodsBox = doc.getElementById("ccMethods");
    const methodsTotalWrap = doc.getElementById("ccMethodsTotalWrap");
    const methodsTotalEl = doc.getElementById("ccMethodsTotal");

    if (methodsBox) {
      const ms = Array.isArray(report.methods) ? [...report.methods] : [];

      ms.sort((a, b) =>
        String(a.label || a.code || "").localeCompare(
          String(b.label || b.code || ""),
          "es",
          { sensitivity: "base" },
        ),
      );

      methodsBox.innerHTML = ms
        .map((m) => {
          const label = escapeHtml(String(m.label || m.code || "—"));
          const cnt = Number(m.count || 0);
          const total = eur2(m.total || 0);
          return `
        <div class="row">
          <div class="col-left">${label} (${cnt})</div>
          <div class="col-right">${total}</div>
        </div>
      `;
        })
        .join("");

      const totalMethodsAmount = ms.reduce(
        (sum, m) => sum + Number(m.total || 0),
        0,
      );

      if (methodsTotalWrap) {
        methodsTotalWrap.style.display = ms.length ? "block" : "none";
      }
      if (methodsTotalEl) {
        methodsTotalEl.textContent = eur2(totalMethodsAmount);
      }
    }

    // total de métodos usados
    const payUsesWrap = doc.getElementById("ccPayUsesWrap");
    const payUsesVal = doc.getElementById("ccPayUses");
    if (payUsesWrap) {
      const uses = Number(report.totalPaymentUses || 0);
      if (uses > 0) {
        payUsesWrap.style.display = "block";
        if (payUsesVal) payUsesVal.textContent = String(uses);
      } else {
        payUsesWrap.style.display = "none";
      }
    }

    // cambios de pago
    const edits = Number(report.payEditsCount || 0);
    const payWrap = doc.getElementById("ccPayChangesWrap");
    const payVal = doc.getElementById("ccPayChanges");
    if (payWrap) {
      if (edits > 0) {
        payWrap.style.display = "block";
        if (payVal) payVal.textContent = String(edits);
      } else {
        payWrap.style.display = "none";
      }
    }

    // agentes
    const agentsBox = doc.getElementById("ccAgents");
    const agentsWrap = doc.getElementById("ccAgentsWrap");
    const agentsTotalWrap = doc.getElementById("ccAgentsTotalWrap");
    const agentsTotalEl = doc.getElementById("ccAgentsTotal");

    if (agentsBox && agentsWrap) {
      const agents = Array.isArray(report.agentSales)
        ? [...report.agentSales]
        : [];

      if (agents.length > 0) {
        agentsWrap.style.display = "block";

        agents.sort((a, b) => Number(b.total || 0) - Number(a.total || 0));
        agentsBox.style.display = "block";
        agentsBox.innerHTML = agents
          .map((a) => {
            const name = escapeHtml(
              String(a.agentName || a.name || a.agentCode || "—"),
            );
            const cnt = Number(a.count || 0);
            const total = eur2(a.total || 0);
            return `
          <div class="row">
            <div class="col-left">${name} (${cnt})</div>
            <div class="col-right">${total}</div>
          </div>
        `;
          })
          .join("");

        const totalAgentsAmount = agents.reduce(
          (sum, a) => sum + Number(a.total || 0),
          0,
        );

        if (agentsTotalWrap) {
          agentsTotalWrap.style.display = "block";
        }
        if (agentsTotalEl) {
          agentsTotalEl.textContent = eur2(totalAgentsAmount);
        }
      } else {
        agentsWrap.style.display = "none";
        agentsBox.style.display = "none";
        agentsBox.innerHTML = "";
        if (agentsTotalWrap) agentsTotalWrap.style.display = "none";
      }
    }

    // observaciones
    const obsWrap = doc.getElementById("ccObsWrap");
    if (obsWrap) {
      if (report.userObs && String(report.userObs).trim()) {
        obsWrap.style.display = "block";
        _setText("ccObs", report.userObs);
      } else {
        obsWrap.style.display = "none";
      }
    }

    // log
    const autoWrap = doc.getElementById("ccAutoLogWrap");
    if (autoWrap) {
      const raw = report.autoLogText ?? report.autoLog ?? "";
      const clean = decodeEntities(raw);

      if (clean && String(clean).trim()) {
        autoWrap.style.display = "block";
        _setText("ccAutoLog", clean);
      } else {
        autoWrap.style.display = "none";
      }
    }

    const finalHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;

    const r2 = await window.TPV_PRINT.printTicket({
      html: finalHtml,
      deviceName: printerName,
    });

    if (!r2 || !r2.ok) {
      toast(
        "No se pudo imprimir cierre: " + (r2?.error || "error desconocido"),
        "err",
        "Impresión",
      );
      return;
    }

    toast("Cierre impreso ✅", "ok", "Impresión");
  } catch (e) {
    console.error("[printCashCloseReport] error:", e);
    toast("Error imprimiendo cierre: " + (e?.message || e), "err", "Impresión");
  }
}

function decodeHtmlEntities(s) {
  const raw = String(s ?? "");
  if (!raw.includes("&")) return raw;
  const txt = document.createElement("textarea");
  txt.innerHTML = raw;
  return txt.value;
}

// ✅ reemplaza tu setText por este
function setText(doc, id, value) {
  const el = doc.getElementById(id);
  if (!el) return;
  const raw = value == null ? "" : String(value);
  el.textContent = raw.includes("&") ? decodeHtmlEntities(raw) : raw;
}

function appendRow(container, left, right) {
  if (!container) return;
  const div = container.ownerDocument.createElement("div");
  div.className = "row small";
  div.innerHTML = `<div class="col-left">${escapeHtml(
    left,
  )}</div><div class="col-right">${escapeHtml(right)}</div>`;
  container.appendChild(div);
}

function isProbablyNetworkError(err) {
  const msg = String(err?.message || err || "");
  return (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONN") ||
    msg.includes("ENOTFOUND")
  );
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function validateRecibosAgainstFactura(idfactura) {
  if (!idfactura) return true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fc = await fetchFacturaClienteById(idfactura);
    const totalFactura = round2(fc?.total);

    const recibos = await fetchRecibosByFactura(idfactura);
    const list = Array.isArray(recibos) ? recibos : [];

    const sumRecibos = round2(
      list.reduce((s, r) => s + (Number(r.importe) || 0), 0),
    );

    const diff = round2(totalFactura - sumRecibos);

    const distinctCodpagos = new Set(
      list
        .map((r) =>
          String(r?.codpago || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    );

    const isMixed = distinctCodpagos.size >= 2;

    // ✅ Si es mixto, no lo tratamos como error del TPV
    if (isMixed) {
      console.info(
        `[TPV] Ticket mixto detectado en validación de recibos. idfactura=${idfactura} totalFactura=${totalFactura} sumRecibos=${sumRecibos} diff=${diff}`,
      );
      return true;
    }

    // ✅ Si cuadra, perfecto
    if (Math.abs(diff) <= 0.01) return true;

    // Reintento corto por si pilla un estado intermedio
    if (attempt < 2) {
      await sleep(150);
      continue;
    }

    // ⚠️ Aquí ya no decimos “error”, solo aviso suave
    console.warn(
      `[TPV] Recibos no cuadran con factura. totalFactura=${totalFactura} sumRecibos=${sumRecibos} diff=${diff}`,
    );

    toast(
      "Aviso: el ticket requiere revisión manual de recibos.",
      "warn",
      "Recibos",
    );

    return false;
  }

  return true;
}

let isPayingNow = false;

function buildCashTicketMeta({ pagos, total, cambio }) {
  const pagosArr = Array.isArray(pagos) ? pagos : [];

  const cashLines = pagosArr.filter((p) =>
    isCashPago({
      codpago: p?.codpago,
      descripcion: p?.descripcion,
    }),
  );

  const cashPaid = cashLines.reduce(
    (s, p) => s + (Number(p?.importe || 0) || 0),
    0,
  );

  const cashTendered = cashLines.reduce(
    (s, p) => s + (Number(p?.entregado ?? p?.importe ?? 0) || 0),
    0,
  );

  const safeTotal = Number(total || 0) || 0;
  const safeChange = Number(cambio || 0) || 0;

  return {
    hasCash: cashLines.length > 0,
    total: Math.round((safeTotal + Number.EPSILON) * 100) / 100,
    cashPaid: Math.round((cashPaid + Number.EPSILON) * 100) / 100,
    cashTendered: Math.round((cashTendered + Number.EPSILON) * 100) / 100,
    change: Math.round((safeChange + Number.EPSILON) * 100) / 100,
  };
}

async function onPayButtonClick() {
  try {
    if (isPayingNow) return;
    isPayingNow = true;

    if (!cashSession || !cashSession.open) {
      toast("Abre la caja para poder cobrar.", "warn", "Cobrar");
      return;
    }

    if (!cart || cart.length === 0) {
      toast("Añade productos antes de cobrar.", "warn", "Cobrar");
      return;
    }

    if (!currentTerminal) {
      toast("Debes seleccionar un terminal antes de cobrar.", "warn", "Cobrar");
      return;
    }

    const totalCart = round2(getCartTotal(cart));

    // ✅ FAILSAFE: agente obligatorio (antes de abrir el modal)
    const okAgent = await requireAssignedAgentOrBlock({ showModal: true });
    if (!okAgent) return;

    function checkCartStockProblems(cart) {
      for (const item of cart) {
        if (item.noStock && item.noVenderSinStock) {
          return `El producto "${item.descripcion}" no tiene stock y no está permitido vender sin stock.`;
        }
      }
      return null;
    }

    const stockError = checkCartStockProblems(cart);

    if (stockError) {
      toast(stockError, "warn", "Stock");
      return;
    }

    // 1) Modal cobro
    const payResult = await openPayModal(totalCart);
    if (!payResult) {
      customerSetMode("CART");
      setStatusText("Cobro cancelado");
      return;
    }

    // ✅ FAILSAFE: revalidar (por si cambió algo mientras el modal estaba abierto)
    const okAgent2 = await requireAssignedAgentOrBlock({ showModal: true });
    if (!okAgent2) return;

    // ---- Normalizar pagos ----
    const pagosFinal = Array.isArray(payResult?.pagos)
      ? payResult.pagos.map((p) => ({
          ...p,
          codpago: String(p?.codpago || "")
            .trim()
            .toUpperCase(),
          descripcion: String(p?.descripcion || "").trim(),
          importe:
            Math.round((Number(p?.importe || 0) + Number.EPSILON) * 100) / 100,
          entregado:
            Math.round(
              (Number(p?.entregado ?? p?.importe ?? 0) + Number.EPSILON) * 100,
            ) / 100,
        }))
      : [];

    const primary = pagosFinal[0] || null;

    const tpv_cambio =
      Math.round((Number(payResult?.cambio || 0) + Number.EPSILON) * 100) / 100;

    const cashTicketMeta = buildCashTicketMeta({
      pagos: pagosFinal,
      total: totalCart,
      cambio: tpv_cambio,
    });

    const tpv_efectivo =
      Math.round(
        (pagosFinal
          .filter(isCashPago)
          .reduce((s, p) => s + (Number(p?.entregado || 0) || 0), 0) +
          Number.EPSILON) *
          100,
      ) / 100;

    // 2) Snapshot carrito (ANTES de enviar)
    const cartSnapshot = Array.isArray(cart) ? cart.map((i) => ({ ...i })) : [];

    // 3) Payload factura
    const ticketPayload = buildTicketPayloadFromCart();
    ticketPayload.observaciones = (payResult?.observaciones || "").toString();
    ticketPayload.idtpv = Number(currentTerminal?.id || 0) || null;
    ticketPayload.idcaja = Number(cashSession?.remoteCajaId || 0) || null;

    if (!ticketPayload.idtpv || !ticketPayload.idcaja) {
      throw new Error(
        "No hay caja abierta en FacturaScripts (idtpv/idcaja vacíos). Abre caja antes de cobrar.",
      );
    }

    ticketPayload.numero2 = payResult.numero || "";
    const serieVenta = (payResult.serie || "S").toString().trim().toUpperCase();
    ticketPayload.serie = serieVenta;
    ticketPayload.codserie = serieVenta;

    // método para impresión
    ticketPayload.paymentMethod =
      pagosFinal.length === 1
        ? primary?.descripcion || primary?.codpago || "—"
        : "Mixto";

    customerSetMode("PAYING");
    setStatusText("Cobrando...");

    // codpago principal + desglose
    ticketPayload.codpago = primary ? primary.codpago : null;
    ticketPayload.pagos = pagosFinal;

    // ✅ CLAVE: guardar desired pack qty ANTES de enviar/encolar
    ticketPayload._packDesiredByIdProducto =
      buildDesiredPackQtyByIdProducto(cartSnapshot);

    // extras offline/post
    ticketPayload._payBreakdown = pagosFinal;
    ticketPayload._payCambio = Number(tpv_cambio || 0);
    ticketPayload._payNumero2 = (payResult.numero ?? "").toString();
    ticketPayload._payNick = (
      currentAgent?.nick ||
      currentAgent?.nombre ||
      getLoginUser?.() ||
      "Ventas"
    ).toString();

    // 4) Enviar o encolar
    const sendResult = await sendOrQueueFactura(ticketPayload);

    // ========= OFFLINE =========
    if (!sendResult.ok && sendResult.queued) {
      registerPaymentsForCurrentSession(pagosFinal);
      registerPayMethodUsageForTicket(pagosFinal);

      appendPaymentsToCashLedger({
        cajaId: getCajaIdSafe(),
        pagos: pagosFinal,
        kind: "sale",
        ticketRef: sendResult.localId || "OFFLINE",
        source: "offline",
        agentCode: currentAgent?.codagente || "",
        agentName: currentAgent?.name || currentAgent?.nick || "",
      });

      try {
        lastTicket = buildOfflineTicketPrintData(
          cartSnapshot,
          ticketPayload,
          payResult,
        );

        lastTicket.cashMeta = cashTicketMeta;

        try {
          const docCode = lastTicket?.numero || "OFFLINE";
          const totalDoc = Number(payResult?.total ?? totalCart ?? 0);
          const cambio = Number(payResult?.cambio ?? 0);
          openPostPayModal({ docCode, total: totalDoc, cambio });
          setPostPayPrintEnabled(true);
        } catch {}

        saveOfflineTicketForTicketsModal({
          _localId: sendResult.localId,
          codigo: `OFF-${String(sendResult.localId || "")
            .slice(0, 6)
            .toUpperCase()}`,
          nombrecliente: "Venta en cola",
          total: Number(payResult?.total ?? totalCart ?? 0),
          codpago: pagosFinal?.[0]?.codpago || ticketPayload.codpago || "—",
          fecha: lastTicket.fecha,
          hora: lastTicket.hora,
          lineas: Array.isArray(lastTicket.lineas) ? lastTicket.lineas : [],
          pagos: Array.isArray(lastTicket.pagos)
            ? lastTicket.pagos
            : pagosFinal,
          cambio: Number(lastTicket.cambio || payResult.cambio || 0),
          _offline: true,
        });

        document
          .getElementById("printTicketBtn")
          ?.setAttribute("disabled", "0");
      } catch {}

      customerSetMode("THANKS", {
        ttlMs: 12000,
        total: Number(payResult?.total ?? totalCart ?? 0),
        ticket: lastTicket?.numero || "OFFLINE",
        paymentMethod: ticketPayload.paymentMethod || "",
        agent: ticketPayload._payNick || "",
        items: buildCustomerItemsFromCart(cartSnapshot),
      });

      cart = [];
      renderCart();
      setStatusText("Venta guardada en cola (offline)");
      toast("Sin internet: venta guardada en cola ✅", "ok", "Cobrar");
      return;
    }

    // ========= ONLINE =========
    const apiResponse = sendResult.remote;
    const facturaResp =
      apiResponse.doc || apiResponse.factura || apiResponse.data || apiResponse;

    const idfactura = facturaResp?.idfactura || null;

    // ✅ CLAVE: parchear cantidades de líneas gratis del pack
    if (idfactura) {
      try {
        const desiredByPid = buildDesiredPackQtyByIdProducto(cartSnapshot);

        await patchPackChildrenLinesInFacturaByDesired({
          idfactura,
          desiredByPid,
        });
      } catch (e) {
        console.warn("No pude parchear líneas pack en FS:", e?.message || e);
      }
    }

    const codcliente = facturaResp?.codcliente;
    const idempresa = facturaResp?.idempresa;
    const coddivisa = facturaResp?.coddivisa;
    const codigofactura = facturaResp?.codigo;

    const facturaTotalFS =
      Math.round(
        (Number(facturaResp?.total ?? totalCart ?? 0) + Number.EPSILON) * 100,
      ) / 100;

    // Ajuste céntimos: recibos deben sumar totalFS
    const sumPagosFinal = pagosFinal.reduce(
      (s, p) => s + (Number(p.importe) || 0),
      0,
    );
    const diff =
      Math.round((facturaTotalFS - sumPagosFinal + Number.EPSILON) * 100) / 100;

    if (pagosFinal.length && Math.abs(diff) >= 0.01) {
      const last = pagosFinal[pagosFinal.length - 1];
      pagosFinal[pagosFinal.length - 1] = {
        ...last,
        importe:
          Math.round(
            (Number(last.importe || 0) + diff + Number.EPSILON) * 100,
          ) / 100,
      };
    }

    // Update factura (tpv_efectivo=entregado cash, tpv_cambio=cambio)
    if (idfactura) {
      const upd = {
        idestado: 11,
        pagada: 1,
        tpv_venta: 1,
        tpv_efectivo: Number(tpv_efectivo.toFixed(2)),
        tpv_cambio: Number(tpv_cambio.toFixed(2)),
        codpago: ticketPayload.codpago || "",
        idtpv: currentTerminal?.id || "",
        codalmacen: currentTerminal?.codalmacen || "",
        observaciones: (payResult?.observaciones || "").toString(),
        numero2: (payResult?.numero ?? "").toString(),
        nick: ticketPayload._payNick || "Ventas",
      };
      if (currentAgent?.codagente) upd.codagente = currentAgent.codagente;
      await updateFacturaCliente(idfactura, upd);
    }

    // Recibos
    if (idfactura && codcliente) {
      const today = new Date().toISOString().slice(0, 10);
      for (const p of pagosFinal) {
        const importe = Number(Number(p.importe || 0).toFixed(2));
        if (!(importe > 0)) continue;

        await createReciboCliente({
          idfactura,
          codcliente,
          codpago: p.codpago,
          importe,
          fechapago: today,
          fecha: today,
          idempresa,
          codigofactura,
          coddivisa,
        });
      }
    }

    // Cleanup/validate
    try {
      await cleanupRecibosFactura(idfactura, pagosFinal);
      try {
        await validateRecibosAgainstFactura(idfactura);
      } catch {}
    } catch {}

    registerPaymentsForCurrentSession(pagosFinal);
    registerPayMethodUsageForTicket(pagosFinal);

    appendPaymentsToCashLedger({
      cajaId: getCajaIdSafe(),
      pagos: pagosFinal,
      kind: "sale",
      ticketRef: facturaResp?.codigo || idfactura || "",
      source: "runtime",
      agentCode: currentAgent?.codagente || "",
      agentName: currentAgent?.name || currentAgent?.nick || "",
    });

    // completar código si hace falta
    if (idfactura) {
      try {
        const fc = await fetchFacturaClienteById(idfactura);
        if (fc && fc.codigo) {
          if (!apiResponse.factura) apiResponse.factura = facturaResp;
          apiResponse.factura.codigo = String(fc.codigo);
        }
      } catch {}
    }

    await apiUpdateCajaAfterSale({
      totalVenta: facturaTotalFS,
      pagos: pagosFinal,
    });

    lastTicket = buildTicketPrintData(apiResponse, ticketPayload, cartSnapshot);

    lastTicket.cashMeta = buildCashTicketMeta({
      pagos: pagosFinal,
      total: facturaTotalFS,
      cambio: tpv_cambio,
    });

    // Post-cobro
    try {
      const docCode =
        lastTicket?.numero ||
        facturaResp?.codigo ||
        facturaResp?.idfactura ||
        "—";
      const totalDoc = Number(facturaResp?.total ?? facturaTotalFS ?? 0);
      const cambio = Number(payResult?.cambio ?? 0);

      updatePostPayModal({
        docCode,
        total: totalDoc,
        cambio,
        enablePrint: true,
      });
      setPostPayPrintEnabled(true);
    } catch {}

    lastTicket.pagos = pagosFinal;
    lastTicket.cambio = payResult.cambio || 0;

    const printBtn = document.getElementById("printTicketBtn");
    if (printBtn) printBtn.disabled = false;

    customerSetMode("THANKS", {
      ttlMs: 12000,
      total: facturaTotalFS,
      ticket: lastTicket?.numero || facturaResp?.codigo || "",
      paymentMethod: ticketPayload.paymentMethod || "",
      agent: ticketPayload._payNick || "",
      items: buildCustomerItemsFromCart(cartSnapshot),
    });

    cart = [];
    renderCart();
    clearPaidParkedTicket();
    setStatusText("Venta cobrada");

    toast(
      lastTicket.numero
        ? `Venta cobrada ✅ (${ticketPayload.paymentMethod} - ${lastTicket.numero})`
        : `Venta cobrada ✅ (${ticketPayload.paymentMethod})`,
      "ok",
      "Cobrar",
    );

    if (isAutoPrintEnabled()) {
      try {
        await printTicket(lastTicket);
      } catch (e) {
        console.warn("Auto-impresión falló:", e?.message || e);
        toast(
          "Venta cobrada, pero no se pudo imprimir automáticamente.",
          "warn",
          "Impresión",
        );
      }
    }
  } catch (err) {
    console.error("Error al cobrar:", err);
    customerSetMode("CART");
    let msg = err.message || "Error desconocido";

    if (msg.toLowerCase().includes("stock")) {
      msg =
        "No se puede cobrar porque uno o varios productos no tienen stock disponible.";
    }

    toast(msg, "err", "Cobrar");
    setStatusText("Error al cobrar");
  } finally {
    isPayingNow = false;
  }
}

function calcExpectedCash(opening, ingresos, totalmovi) {
  return (
    (Number(opening) || 0) + (Number(ingresos) || 0) + (Number(totalmovi) || 0)
  );
}

function moneyToNumber(v) {
  // Acepta: 2.5, "2.5", "2,50", "2,50 €", "", null...
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace("€", "")
    .replace(/\./g, "") // por si viene "1.234,56"
    .replace(",", "."); // coma decimal a punto
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

// ===== Setting: Abrir cajón siempre =====

function isCashPago(p) {
  const code = String(p?.codpago || "")
    .trim()
    .toUpperCase();
  const desc = String(p?.descripcion || "")
    .trim()
    .toLowerCase();

  const set = Array.isArray(window.__CASH_CODPAGOS__)
    ? window.__CASH_CODPAGOS__
    : [];

  // 1) si el API ya marcó cuáles son cash, usamos eso
  if (set.length && set.includes(code)) return true;

  // 2) fallback por descripción (por si no cargó formapagos aún)
  return (
    desc.includes("contado") ||
    desc.includes("efectivo") ||
    desc.includes("cash")
  );
}

// payResult = lo que te devuelve crearFacturaCliente (o el endpoint que uses)
// totalVenta = total bruto del ticket
// pagos = array de pagos [{codpago, importe, descripcion}]
async function apiUpdateCajaAfterSale({ totalVenta, pagos }) {
  if (TPV_STATE.offline || TPV_STATE.locked) return;
  const remoteId = cashSession.remoteCajaId;
  if (!remoteId) return;

  // 1) Actualiza acumulados LOCALES
  cashSession.totalSales =
    (Number(cashSession.totalSales) || 0) + (Number(totalVenta) || 0);
  cashSession.numtickets = (Number(cashSession.numtickets) || 0) + 1;

  const pagosArr = Array.isArray(pagos) ? pagos : [];
  const contado = pagosArr
    .filter(isCashPago)
    .reduce((s, p) => s + moneyToNumber(p?.importe), 0);

  // ✅ Si por cualquier motivo el set no está listo, al menos CONT siempre cuenta
  if (
    !CASH_CODPAGOS ||
    !(CASH_CODPAGOS instanceof Set) ||
    CASH_CODPAGOS.size === 0
  ) {
    CASH_CODPAGOS = new Set(["CONT"]);
  } else {
    // Aseguramos CONT siempre
    CASH_CODPAGOS.add("CONT");
  }

  // DEBUG (temporal): verifica que aquí suma
  console.log(
    "[CAJA] pagos:",
    pagosArr,
    "CASH_CODPAGOS:",
    Array.from(CASH_CODPAGOS),
    "contado:",
    contado,
  );

  cashSession.cashSalesTotal =
    (Number(cashSession.cashSalesTotal) || 0) + contado;

  // 2) Calcula totalcaja esperado
  const opening = Number(cashSession.openingTotal || 0);
  const totalmovi = Number(cashSession.cashMovementsTotal || 0);
  const ingresos = Number(cashSession.cashSalesTotal || 0);
  const totalcaja = calcExpectedCash(opening, ingresos, totalmovi);

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const payload = {
    ingresos: round2(ingresos),
    totalmovi: round2(totalmovi),
    totalcaja: round2(totalcaja),
    totaltickets: round2(Number(cashSession.totalSales || 0)),
    numtickets: Number(cashSession.numtickets || 0),
    nick: getLoginUser(),
  };

  await apiWrite(`tpvcajas/${remoteId}`, "PUT", payload);
}

// ===== Botón "Eliminar todo" =====
const clearBtn = document.getElementById("clearCartBtn");
if (clearBtn) {
  clearBtn.onclick = () => {
    cart = [];
    renderCart();
  };
}

// ===== Botón "Cobrar" =====
const payBtn = document.getElementById("payBtn");
if (payBtn) {
  payBtn.onclick = () => {
    onPayButtonClick();
  };

  // ✅ estado inicial al arrancar
  refreshAgentGuardUI?.();
}

// Botón imprimir ticket
const printTicketBtn = document.getElementById("printTicketBtn");
if (printTicketBtn) {
  printTicketBtn.onclick = () => {
    if (!lastTicket) {
      toast("No hay ningún ticket para imprimir.", "warn", "Impresión");
      return;
    }

    printTicket(lastTicket);
  };
}

// ===== EFECTIVO desde /formapagos =====
let CASH_CODPAGOS = new Set();

function buildCashCodpagosFromFormapagos(list) {
  const s = new Set();

  (list || []).forEach((fp) => {
    const cod = String(fp.codpago || "").trim();
    const desc = String(fp.descripcion || "")
      .trim()
      .toLowerCase();

    // regla automática por descripción
    if (
      desc.includes("contado") ||
      desc.includes("efectivo") ||
      desc.includes("cash")
    ) {
      if (cod) s.add(cod);
    }
  });

  // fallback seguro: si existe CONT, lo añadimos
  if (
    (list || []).some(
      (x) =>
        String(x.codpago || "")
          .trim()
          .toUpperCase() === "CONT",
    )
  ) {
    s.add("CONT");
  }

  return s;
}

function parseMoney(n) {
  if (typeof n === "string") n = n.replace(",", ".");
  const x = Number(n);
  return isNaN(x) ? 0 : x;
}

// ===== Modal Cobrar (UI tipo FacturaScripts) =====
const payOverlay = document.getElementById("payOverlay");
const payMethodsList = document.getElementById("payMethodsList");
const payTotalBig = document.getElementById("payTotalBig");
const payChangeBig = document.getElementById("payChangeBig");
const payErrorEl = document.getElementById("payError");
const payCancelBtn = document.getElementById("payCancelBtn");
const paySaveBtn = document.getElementById("paySaveBtn");
const payCloseX = document.getElementById("payCloseX");
const payObs = document.getElementById("payObs");
const payNumber = document.getElementById("payNumber");
const paySerie = document.getElementById("paySerie");

let payModalState = {
  totalCents: 0,
  formas: [],
  values: {}, // seguimos guardando strings en inputs
  selectedCodpago: null,
};

// utilidades € (sin romper tus eur())
function toCents(v) {
  // redondea a 2 decimales antes de pasar a céntimos
  const r = round2(v);
  return Math.round((r + Number.EPSILON) * 100);
}
function fromCents(c) {
  return (Number(c) || 0) / 100;
}
function euroStrToCents(input) {
  let s = String(input ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace("€", "");

  if (!s) return 0;

  // deja solo dígitos y separadores
  s = s.replace(/[^0-9.,-]/g, "");

  // soporta negativo si algún día lo necesitas
  let sign = 1;
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }

  // ¿dónde está el separador decimal? -> el ÚLTIMO '.' o ','
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  const decPos = Math.max(lastDot, lastComma);

  let intPart = s;
  let decPart = "";

  if (decPos >= 0) {
    intPart = s.slice(0, decPos);
    decPart = s.slice(decPos + 1);
  }

  // quita separadores de miles del entero
  intPart = intPart.replace(/[.,]/g, "");
  // decimales: solo dígitos y máx 2
  decPart = decPart.replace(/[^\d]/g, "").slice(0, 2);

  const intNum = intPart ? Number(intPart) : 0;
  if (!isFinite(intNum)) return 0;

  const decNum = decPart ? Number(decPart.padEnd(2, "0")) : 0;
  const cents = intNum * 100 + decNum;

  return sign * cents;
}

function centsToEuro2(c) {
  return fromCents(c).toFixed(2);
}
function centsToEuro2es(c) {
  return centsToEuro2(c).replace(".", ",") + " €";
}

function euro2(n) {
  return (Number(n) || 0).toFixed(2);
}
function euro2es(n) {
  return euro2(n).replace(".", ",") + " €";
}

function sumPagosCents() {
  let sum = 0;
  for (const cod of Object.keys(payModalState.values)) {
    sum += euroStrToCents(payModalState.values[cod]);
  }
  return sum;
}

function remainingToPayCents() {
  return Math.max(0, (payModalState.totalCents || 0) - sumPagosCents());
}

function calcChangeCents() {
  return Math.max(0, sumPagosCents() - (payModalState.totalCents || 0));
}

function clampNonCashValue(codEdited) {
  const totalC = payModalState.totalCents || 0;

  let cashGivenC = 0; // efectivo entregado (puede exceder)
  let nonCashSumC = 0; // no-efectivo entregado

  for (const fp of payModalState.formas) {
    const cod = fp.codpago;
    const vC = euroStrToCents(payModalState.values[cod] || "");
    if (isCashPago({ codpago: cod, descripcion: fp.descripcion }))
      cashGivenC += vC;
    else nonCashSumC += vC;
  }

  const maxNonCashTotalC = Math.max(0, totalC - Math.min(cashGivenC, totalC));

  if (nonCashSumC <= maxNonCashTotalC) return;

  const editedIsCash = isCashPago({
    codpago: codEdited,
    descripcion:
      payModalState.formas.find((x) => x.codpago === codEdited)?.descripcion ||
      "",
  });

  let targetCod = null;

  if (!editedIsCash) {
    targetCod = codEdited;
  } else {
    const rev = payModalState.formas.slice().reverse();
    const lastNonCash = rev.find((fp) => {
      const cod = fp.codpago;
      if (isCashPago({ codpago: cod, descripcion: fp.descripcion }))
        return false;
      return euroStrToCents(payModalState.values[cod] || "") > 0;
    });
    targetCod = lastNonCash ? lastNonCash.codpago : null;
  }

  if (!targetCod) return;

  const excessC = nonCashSumC - maxNonCashTotalC;
  const curC = euroStrToCents(payModalState.values[targetCod] || "");
  const newC = Math.max(0, curC - excessC);

  payModalState.values[targetCod] = centsToEuro2(newC);

  const inp = payMethodsList
    ? payMethodsList.querySelector(`.pay-amount[data-codpago="${targetCod}"]`)
    : null;
  if (inp) inp.value = payModalState.values[targetCod];
}

function setPayError(msg) {
  if (!payErrorEl) return;
  payErrorEl.textContent = msg || "";
}

function selectPayInput(codpago) {
  payModalState.selectedCodpago = codpago;

  // marcar visualmente
  const inputs = payMethodsList
    ? payMethodsList.querySelectorAll(".pay-amount")
    : [];
  inputs.forEach((inp) => {
    inp.classList.toggle("active", inp.dataset.codpago === codpago);
  });

  const active = payMethodsList
    ? payMethodsList.querySelector(`.pay-amount[data-codpago="${codpago}"]`)
    : null;
  if (active) active.focus();
}

function renderPayHeaderTotals() {
  const totalC = payModalState.totalCents || 0;
  if (payTotalBig) payTotalBig.textContent = centsToEuro2es(totalC);

  const diffC = sumPagosCents() - totalC; // + = cambio, - = falta
  const sign = diffC < 0 ? "-" : "";
  const absC = Math.abs(diffC);

  if (payChangeBig) payChangeBig.textContent = sign + centsToEuro2es(absC);
}

function renderPayMethods() {
  if (!payMethodsList) return;

  payMethodsList.innerHTML = "";

  payModalState.formas.forEach((fp) => {
    const row = document.createElement("div");
    row.className = "pay-method-row";

    const pill = document.createElement("div");
    pill.className = "pay-pill";
    pill.textContent = fp.descripcion || fp.codpago;

    const inp = document.createElement("input");
    inp.className = "pay-amount";
    inp.inputMode = "decimal";
    inp.placeholder = "";
    inp.dataset.codpago = fp.codpago;

    inp.value = payModalState.values[fp.codpago] || "";

    inp.addEventListener("focus", () => selectPayInput(fp.codpago));
    inp.addEventListener("click", () => selectPayInput(fp.codpago));

    inp.addEventListener("input", () => {
      const raw = inp.value;
      const cleaned = raw
        .replace(/[^0-9.,]/g, "")
        .replace(/(.*)[.,](.*)[.,].*/g, "$1.$2");
      inp.value = cleaned;

      payModalState.values[fp.codpago] = cleaned;

      // ✅ CLAMP: tarjeta/bizum/etc nunca superan el pendiente
      clampNonCashValue(fp.codpago);

      renderPayHeaderTotals();
      setPayError("");
    });

    const maxBtn = document.createElement("button");
    maxBtn.className = "pay-max";
    maxBtn.type = "button";
    maxBtn.textContent = "Máx";
    maxBtn.addEventListener("click", () => {
      const cod = fp.codpago;

      // ¿Cuántos métodos tienen importe > 0?
      const nonZeroCods = payModalState.formas
        .map((x) => x.codpago)
        .filter((c) => euroStrToCents(payModalState.values[c] || "") > 0);

      let targetC = 0;

      if (
        nonZeroCods.length <= 1 &&
        (nonZeroCods.length === 0 || nonZeroCods[0] === cod)
      ) {
        targetC = payModalState.totalCents || 0;
      } else {
        targetC = remainingToPayCents();
      }

      payModalState.values[cod] = centsToEuro2(targetC);
      inp.value = centsToEuro2(targetC);

      selectPayInput(cod);
      renderPayHeaderTotals();
      setPayError("");
    });

    const trashBtn = document.createElement("button");
    trashBtn.className = "pay-trash";
    trashBtn.type = "button";
    trashBtn.textContent = "🗑";
    trashBtn.title = "Borrar este importe";

    trashBtn.addEventListener("click", () => {
      payModalState.values[fp.codpago] = "";
      inp.value = "";
      selectPayInput(fp.codpago);
      renderPayHeaderTotals();
      setPayError("");
    });

    row.appendChild(pill);
    row.appendChild(inp);
    row.appendChild(maxBtn);
    row.appendChild(trashBtn);

    payMethodsList.appendChild(row);
  });

  // Selección inicial: primera forma
  if (!payModalState.selectedCodpago && payModalState.formas[0]) {
    selectPayInput(payModalState.formas[0].codpago);
  } else if (payModalState.selectedCodpago) {
    selectPayInput(payModalState.selectedCodpago);
  }

  renderPayHeaderTotals();
}

// teclado numérico (derecha)
function payKeyAppend(ch) {
  const cod = payModalState.selectedCodpago;
  if (!cod) return;

  let v = String(payModalState.values[cod] || "");

  if (ch === ".") {
    if (v.includes(".") || v.includes(",")) return;
    v = v ? v + "." : "0.";
  } else if (ch === "00") {
    v = v ? v + "00" : "00";
  } else {
    v += String(ch);
  }

  // recorta a 2 decimales si hay punto
  v = v.replace(",", ".");
  if (v.includes(".")) {
    const [a, b] = v.split(".");
    v = a + "." + (b || "").slice(0, 2); // permitir hasta 2 decimales
  }

  payModalState.values[cod] = v;
  const inp = payMethodsList
    ? payMethodsList.querySelector(`.pay-amount[data-codpago="${cod}"]`)
    : null;
  if (inp) inp.value = v;

  // ✅ CLAMP también desde keypad
  clampNonCashValue(cod);

  renderPayHeaderTotals();
  setPayError("");
}

function payKeyBackspace() {
  const cod = payModalState.selectedCodpago;
  if (!cod) return;

  let v = String(payModalState.values[cod] || "");
  v = v.slice(0, -1);
  payModalState.values[cod] = v;

  const inp = payMethodsList
    ? payMethodsList.querySelector(`.pay-amount[data-codpago="${cod}"]`)
    : null;
  if (inp) inp.value = v;

  // ✅ CLAMP también desde keypad
  clampNonCashValue(cod);

  renderPayHeaderTotals();
  setPayError("");
}

function payKeyClearAll() {
  for (const fp of payModalState.formas) {
    payModalState.values[fp.codpago] = "";
  }
  renderPayMethods();
  setPayError("");
}

function payResultHasCash(payResult) {
  const pagos = Array.isArray(payResult?.pagos) ? payResult.pagos : [];
  return pagos.some(
    (p) =>
      isCashPago({ codpago: p.codpago, descripcion: p.descripcion }) &&
      Number(p?.entregado ?? p?.importe ?? 0) > 0,
  );
}

function shouldOpenDrawerForPayResult(payResult) {
  // si el toggle está ON -> siempre
  if (isOpenDrawerAlwaysEnabled()) return true;

  // si está OFF -> solo efectivo
  return payResultHasCash(payResult);
}

// ===== Pay keypad binding (UNA SOLA VEZ, robusto para táctil) =====
let PAY_KEYPAD_BOUND = false;

function bindPayKeypadOnce() {
  if (PAY_KEYPAD_BOUND) return;

  if (!payOverlay) return;
  const keypad = payOverlay.querySelector(".pay-keypad");
  if (!keypad) return;

  PAY_KEYPAD_BOUND = true;

  // Anti-duplicado: misma tecla muy seguida => ignorar
  let lastKey = null;
  let lastTs = 0;
  const DUP_MS = 90; // prueba 70-120 si quieres

  // pointerId activos (para no procesar dos veces el mismo dedo)
  const activePointers = new Set();

  const getKeyFromEvent = (e) => {
    const btn = e.target.closest("[data-k]");
    return btn ? btn.getAttribute("data-k") : null;
  };

  const consumeKey = (k) => {
    const now = performance.now();
    if (k === lastKey && now - lastTs < DUP_MS) return;
    lastKey = k;
    lastTs = now;

    if (k === "back") payKeyBackspace();
    else if (k === "clear") payKeyClearAll();
    else payKeyAppend(k);
  };

  // ✅ Procesamos en POINTERDOWN (aquí el target es fiable)
  const onPointerDown = (e) => {
    const k = getKeyFromEvent(e);
    if (!k) return;

    e.preventDefault();
    e.stopPropagation();

    const pid = e.pointerId ?? "nopid";
    if (activePointers.has(pid)) return; // evita down duplicado
    activePointers.add(pid);

    consumeKey(k);

    // captura para recibir cancel/up y limpiar
    try {
      e.target.setPointerCapture?.(e.pointerId);
    } catch {}
  };

  const onPointerUp = (e) => {
    const pid = e.pointerId ?? "nopid";
    activePointers.delete(pid);

    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerCancel = (e) => {
    const pid = e.pointerId ?? "nopid";
    activePointers.delete(pid);

    e.preventDefault();
    e.stopPropagation();
  };

  keypad.addEventListener("pointerdown", onPointerDown, { passive: false });
  keypad.addEventListener("pointerup", onPointerUp, { passive: false });
  keypad.addEventListener("pointercancel", onPointerCancel, { passive: false });

  // ✅ Bloquea click “fantasma” (muy típico en táctil Windows)
  keypad.addEventListener(
    "click",
    (e) => {
      if (e.target.closest("[data-k]")) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}

// ===== Modal Cobrar =====
async function openPayModal(total) {
  if (!payOverlay) throw new Error("Falta #payOverlay en index.html");

  // bind 1 vez (clave para evitar “se me duplica”)
  bindPayKeypadOnce();

  setPayError("");
  payModalState.totalCents = toCents(total);
  payModalState.values = {};
  payModalState.selectedCodpago = null;

  // cargar formas de pago reales
  const formas = await fetchFormasPagoActivas();
  payModalState.formas = (formas || [])
    .map((f) => ({
      codpago: String(f.codpago || "").trim(),
      descripcion: String(f.descripcion || f.codpago || "").trim(),
      imprimir: f.imprimir !== false,
    }))
    .filter((x) => x.codpago);

  if (!payModalState.formas.length) {
    payModalState.formas = [
      { codpago: "CONT", descripcion: "Efectivo", imprimir: true },
    ];
  }

  renderPayMethods();

  // limpiar extras
  if (payObs) payObs.value = "";
  if (payNumber) payNumber.value = "";
  if (paySerie) paySerie.value = "";

  // QWERTY en Observaciones
  if (payObs) {
    payObs.readOnly = true;
    const open = () => {
      if (typeof window.openQwerty === "function") {
        window.openQwerty(
          String(payObs.value || ""),
          (txt) => (payObs.value = String(txt || "")),
          { title: "Observaciones", emailMode: false },
        );
      } else if (typeof window.openTextKeyboard === "function") {
        window.openTextKeyboard(payObs);
      } else {
        payObs.readOnly = false;
      }
    };
    payObs.onfocus = open;
    payObs.onclick = open;
  }

  payOverlay.classList.remove("hidden");
  if (paySaveBtn) paySaveBtn.disabled = false;

  return await new Promise((resolve) => {
    const closeModal = () => {
      payOverlay.classList.add("hidden");
    };

    const cleanupBtns = () => {
      if (payCancelBtn) payCancelBtn.onclick = null;
      if (paySaveBtn) paySaveBtn.onclick = null;
      if (payCloseX) payCloseX.onclick = null;
    };

    const cancel = () => {
      if (paySaveBtn) paySaveBtn.disabled = false;
      cleanupBtns();
      closeModal();
      resolve(null);
    };

    if (payCloseX) payCloseX.onclick = cancel;
    if (payCancelBtn) payCancelBtn.onclick = cancel;

    if (paySaveBtn) {
      paySaveBtn.onclick = () => {
        setPayError("");

        // 1) Construir entregados (céntimos)
        const entregados = [];
        for (const fp of payModalState.formas) {
          const raw = String(payModalState.values[fp.codpago] || "").trim();
          const c = euroStrToCents(raw);
          if (c > 0) {
            entregados.push({
              codpago: fp.codpago,
              descripcion: fp.descripcion,
              entregadoC: c,
            });
          }
        }

        if (!entregados.length) {
          setPayError("Introduce un importe en alguna forma de pago.");
          return;
        }

        const totalC = payModalState.totalCents || 0;

        // 2) Validación pagado >= total
        const pagadoEntregadoC = entregados.reduce(
          (s, p) => s + (p.entregadoC || 0),
          0,
        );

        if (pagadoEntregadoC < totalC) {
          setPayError("El importe pagado es inferior al total.");
          return;
        }

        // 3) Separar cash / no-cash
        const nonCash = [];
        const cash = [];
        for (const p of entregados) {
          const isCash = isCashPago({
            codpago: p.codpago,
            descripcion: p.descripcion,
          });
          (isCash ? cash : nonCash).push(p);
        }

        // 4) Calcular cambio
        const nonCashSumC = nonCash.reduce((s, p) => s + p.entregadoC, 0);
        let cashNeededC = Math.max(0, totalC - nonCashSumC);
        const cashGivenC = cash.reduce((s, p) => s + p.entregadoC, 0);
        const cambioC = Math.max(0, cashGivenC - cashNeededC);

        // 5) Pagos (importe=aplicado, entregado=entregado)
        const pagos = [];

        for (const p of nonCash) {
          pagos.push({
            codpago: p.codpago,
            descripcion: p.descripcion,
            importe: fromCents(p.entregadoC),
            entregado: fromCents(p.entregadoC),
          });
        }

        for (const p of cash) {
          const aplicadoC = Math.min(p.entregadoC, cashNeededC);
          cashNeededC -= aplicadoC;

          pagos.push({
            codpago: p.codpago,
            descripcion: p.descripcion,
            importe: fromCents(aplicadoC),
            entregado: fromCents(p.entregadoC),
          });
        }

        const result = {
          pagos,
          total: fromCents(totalC),
          pagado: fromCents(pagadoEntregadoC),
          cambio: fromCents(cambioC),
          observaciones: payObs ? String(payObs.value || "") : "",
          numero: payNumber ? String(payNumber.value || "") : "",
          serie: paySerie ? String(paySerie.value || "") : "",
        };

        // abrir cajón inmediato si toca
        try {
          if (shouldOpenDrawerForPayResult({ pagos })) {
            paySaveBtn.disabled = true;
            openDrawerNow({ source: "AUTO" }).catch(() => {});
          }
        } catch {}

        // post-pago inmediato
        try {
          window.__POSTPAY_PENDING__ = {
            docCode: "Procesando…",
            total: result.total,
            cambio: result.cambio,
          };
          openPostPayModal(window.__POSTPAY_PENDING__);
          setPostPayPrintEnabled(false);
        } catch {}

        cleanupBtns();
        closeModal();
        resolve(result);
      };
    }
  });
}

// Botón aparcar ticket
const parkBtn = document.getElementById("parkBtn");

const parkObsOverlay = document.getElementById("parkObsOverlay");
const parkObsInput = document.getElementById("parkObsInput");
const parkObsCancelBtn = document.getElementById("parkObsCancelBtn");
const parkObsOkBtn = document.getElementById("parkObsOkBtn");
const parkObsKeyboardBtn = document.getElementById("parkObsKeyboardBtn");

function openParkObsModal() {
  const overlay = document.getElementById("parkObsOverlay");
  const input = document.getElementById("parkObsInput");
  if (!overlay || !input) {
    toast("Falta el HTML del modal de aparcar.", "err", "Aparcar");
    return;
  }
  input.value = "";
  overlay.classList.remove("hidden");
  input.focus();
}

function closeParkObsModal() {
  parkObsOverlay.classList.add("hidden");
}

parkBtn?.addEventListener("click", () => {
  // 1) No permitir aparcar si el carrito está vacío
  if (!Array.isArray(cart) || cart.length === 0) {
    toast("No puedes aparcar un ticket vacío.", "warn", "Aparcar");
    return;
  }

  // 2) (Opcional pero recomendado) exigir terminal seleccionada antes de aparcar
  if (!currentTerminal) {
    toast("Debes seleccionar un terminal antes de aparcar.", "warn", "Aparcar");
    return;
  }

  // 3) Si todo OK, recién ahí abrimos el modal de observación
  openParkObsModal();
});

parkObsCancelBtn?.addEventListener("click", () => {
  closeParkObsModal();
});

parkObsOkBtn?.addEventListener("click", () => {
  const obs = parkObsInput.value.trim();
  closeParkObsModal();
  parkCurrentCart(obs || "");
});

parkObsKeyboardBtn?.addEventListener("click", () => {
  // Reutiliza tu teclado QWERTY actual
  // Necesitas una función tipo: openQwerty(targetInput)
  openQwertyForInput(parkObsInput);
});

// Botón ver/recuperar aparcados
const parkedListBtn = document.getElementById("parkedListBtn");
if (parkedListBtn) {
  parkedListBtn.onclick = () => {
    openParkedModal();
  };
}

let ticketsCache = []; // última lista cargada
let ticketsLoading = false; // evita dobles cargas
let ticketsUiCache = []; // ✅ lista final (server + offline + vínculos)

const ticketsOverlay = document.getElementById("ticketsOverlay");
const ticketsCloseBtn = document.getElementById("ticketsCloseBtn");
const ticketsList = document.getElementById("ticketsList");
const ticketsReloadBtn = document.getElementById("ticketsReloadBtn");
const ticketsSearch = document.getElementById("ticketsSearch");
const ticketsTabCurrent = document.getElementById("ticketsTabCurrent");
const ticketsTabOther = document.getElementById("ticketsTabOther");
const ticketsSearchClearBtn = document.getElementById("ticketsSearchClearBtn");
const ticketsOtherCajaActions = document.getElementById(
  "ticketsOtherCajaActions",
);
const ticketsExpandAllBtn = document.getElementById("ticketsExpandAllBtn");
const ticketsCollapseAllBtn = document.getElementById("ticketsCollapseAllBtn");
const tkFilterOnlyVisibleCajas = document.getElementById(
  "tkFilterOnlyVisibleCajas",
);

const tkFilterNormal = document.getElementById("tkFilterNormal");
const tkFilterRefunded = document.getElementById("tkFilterRefunded");
const tkFilterPartial = document.getElementById("tkFilterPartial");
const ticketsViewState = {
  tab: "current",
  filters: {
    normal: true,
    refunded: true,
    partial: true,
    onlyVisibleCajas: true,
  },
};
const ticketsCajaCollapseState = {};

function getTicketNetAmountForSummary(t) {
  const totalNum = Number(t?.total || 0);
  const refunds = Array.isArray(t?._refunds) ? t._refunds : [];
  const hasRefunds = refunds.length > 0 || !!t?._hasPartialRefund;
  const isFullyRefunded = !!t?._isFullyRefunded;
  const remaining = Number(t?._remainingAfterRefund ?? totalNum);

  if (isFullyRefunded) return 0;
  if (hasRefunds) return remaining;
  return totalNum;
}

function syncTicketsSearchClearBtn() {
  if (!ticketsSearchClearBtn || !ticketsSearch) return;
  const hasValue = String(ticketsSearch.value || "").trim().length > 0;
  ticketsSearchClearBtn.classList.toggle("hidden", !hasValue);
}

function syncTicketsExtraActionsUI() {
  if (!ticketsOtherCajaActions) return;
  ticketsOtherCajaActions.classList.toggle(
    "hidden",
    ticketsViewState.tab !== "other",
  );
}

function openAllCajaGroups(cajaIds = []) {
  for (const cajaId of cajaIds) {
    setCajaGroupOpen(cajaId, true);
  }
}

function closeAllCajaGroups(cajaIds = []) {
  for (const cajaId of cajaIds) {
    setCajaGroupOpen(cajaId, false);
  }
}

function isCajaGroupOpen(cajaId) {
  const key = String(cajaId || 0);
  return !!ticketsCajaCollapseState[key];
}

function setCajaGroupOpen(cajaId, open) {
  const key = String(cajaId || 0);
  ticketsCajaCollapseState[key] = !!open;
}

async function openTicketsModal() {
  if (!ticketsOverlay) {
    toast(
      "Falta el HTML del modal de tickets (#ticketsOverlay).",
      "err",
      "Tickets",
    );
    return;
  }

  ticketsOverlay.classList.remove("hidden");
  syncTicketsToolbarUI();
  syncTicketsSearchClearBtn();
  syncTicketsExtraActionsUI();
  await renderQueuedTicketsIfAny();
  await loadAndRenderTickets();
}

function closeTicketsModal() {
  if (!ticketsOverlay) return;
  ticketsOverlay.classList.add("hidden");
}

async function loadAndRenderTickets() {
  if (!ticketsList) return;
  if (ticketsLoading) return;
  ticketsLoading = true;

  try {
    ticketsList.innerHTML = "Cargando…";

    // ✅ Online -> trae de API y guarda cache
    if (!TPV_STATE?.offline) {
      ticketsCache = await fetchUltimosTickets(60);
      saveTicketsCache(ticketsCache);

      const merged = getAllTicketsForUI(ticketsCache);

      // ✅ AQUÍ: usar merged, no "list"
      linkTicketsRefundRelations(merged);

      ticketsUiCache = merged;
      renderTicketsList(merged);
      return;
    }

    // ✅ Offline -> usar cache (histórico)
    const cached = loadTicketsCache();
    ticketsCache = cached;

    const merged = getAllTicketsForUI(ticketsCache);

    linkTicketsRefundRelations(merged);
    ticketsUiCache = merged;
    renderTicketsList(merged);
  } catch (e) {
    console.error(e);

    // ✅ fallback final: si falla todo, intenta cache
    const cached = loadTicketsCache();
    if (cached.length) {
      ticketsCache = cached;

      const merged = getAllTicketsForUI(ticketsCache);
      linkTicketsRefundRelations(merged);
      ticketsUiCache = merged;
      renderTicketsList(merged);
    } else {
      ticketsList.innerHTML = `<div class="parked-ticket-empty">Error cargando tickets.</div>`;
      toast("Error cargando tickets: " + (e?.message || e), "err", "Tickets");
    }
  } finally {
    ticketsLoading = false;
  }
}

function getTicketCajaId(t) {
  return Number(t?.idcaja ?? t?._raw?.idcaja ?? 0) || 0;
}

function getCurrentCajaId() {
  return Number(cashSession?.remoteCajaId || 0) || 0;
}

function getTicketVisualType(t) {
  const refunds = Array.isArray(t?._refunds) ? t._refunds : [];
  const hasRefunds = refunds.length > 0 || !!t?._hasPartialRefund;
  const isFullyRefunded = !!t?._isFullyRefunded;

  if (hasRefunds && isFullyRefunded) return "refunded";
  if (hasRefunds) return "partial";
  return "normal";
}

function ticketPassesTypeFilters(t) {
  const type = getTicketVisualType(t);
  return !!ticketsViewState.filters[type];
}

function renderTicketsSummary(tickets) {
  const box = document.getElementById("ticketsSummary");
  if (!box) return;

  if (ticketsViewState.tab !== "current") {
    box.classList.add("hidden");
    return;
  }

  const currentCajaId = getCurrentCajaId();

  const originals = (Array.isArray(tickets) ? tickets : []).filter((t) => {
    const raw = t._raw || {};
    const codserie = String(t.codserie || raw.codserie || "").toUpperCase();

    const isRect =
      codserie === "R" ||
      Number(t.idfacturarect || raw.idfacturarect || 0) > 0 ||
      !!(t.codigorect || raw.codigorect);

    return !isRect && getTicketCajaId(t) === currentCajaId;
  });

  let ticketsCount = originals.length;
  let netoVendido = 0;
  let refundsCount = 0;

  for (const t of originals) {
    netoVendido += getTicketNetAmountForSummary(t);

    const refunds = Array.isArray(t._refunds) ? t._refunds : [];
    refundsCount += refunds.length;
  }

  document.getElementById("tkSumTickets").textContent = String(ticketsCount);
  document.getElementById("tkSumTotal").textContent = eurES(netoVendido);
  document.getElementById("tkSumRefunds").textContent = String(refundsCount);

  box.classList.remove("hidden");
}

function syncTicketsToolbarUI() {
  ticketsTabCurrent?.classList.toggle(
    "is-active",
    ticketsViewState.tab === "current",
  );
  ticketsTabOther?.classList.toggle(
    "is-active",
    ticketsViewState.tab === "other",
  );

  if (tkFilterNormal) {
    tkFilterNormal.checked = !!ticketsViewState.filters.normal;
  }
  if (tkFilterRefunded) {
    tkFilterRefunded.checked = !!ticketsViewState.filters.refunded;
  }
  if (tkFilterPartial) {
    tkFilterPartial.checked = !!ticketsViewState.filters.partial;
  }
  if (tkFilterOnlyVisibleCajas) {
    tkFilterOnlyVisibleCajas.checked =
      !!ticketsViewState.filters.onlyVisibleCajas;
  }

  syncTicketsExtraActionsUI();
  syncTicketsSearchClearBtn();
}

function renderTicketsList(tickets) {
  if (!ticketsList) return;

  renderTicketsSummary(tickets);

  const term = (ticketsSearch?.value || "").trim().toLowerCase();
  const sourceList = Array.isArray(tickets) ? tickets : [];

  const matchesTicket = (t) => {
    const s = `${t.codigo || ""} ${t.nombrecliente || ""} ${t.total || ""} ${
      t.codpago || ""
    } ${t.codserie || ""} ${t.idfactura || ""} ${t.codigorect || ""} ${
      t.idcaja || t?._raw?.idcaja || ""
    }`.toLowerCase();

    return s.includes(term);
  };

  // 1) búsqueda
  let searchedList = sourceList;
  if (term) {
    searchedList = sourceList.filter((t) => {
      if (matchesTicket(t)) return true;

      const refunds = Array.isArray(t._refunds) ? t._refunds : [];
      return refunds.some(matchesTicket);
    });
  }

  ticketsList.innerHTML = "";

  if (!searchedList.length) {
    ticketsList.innerHTML = `<div class="parked-ticket-empty">No hay tickets.</div>`;
    return;
  }

  const currentCajaId = getCurrentCajaId();

  // 2) solo tickets padre/originales, SIN aplicar filtros de tipo todavía
  const searchedOriginalsAll = searchedList.filter((t) => {
    const raw = t._raw || {};
    const codserie = String(t.codserie || raw.codserie || "").toUpperCase();
    const isRect =
      codserie === "R" ||
      Number(t.idfacturarect || raw.idfacturarect || 0) > 0 ||
      !!(t.codigorect || raw.codigorect);

    return !isRect;
  });

  // 3) visibles tras filtros de tipo
  const searchedOriginalsVisible = searchedOriginalsAll.filter(
    ticketPassesTypeFilters,
  );

  const originalsCurrent =
    ticketsViewState.tab === "current"
      ? searchedOriginalsVisible.filter(
          (t) => getTicketCajaId(t) === currentCajaId,
        )
      : searchedOriginalsVisible.filter(
          (t) => getTicketCajaId(t) !== currentCajaId,
        );

  const renderRefundChildren = (
    parentTicket,
    parentNum,
    refunds,
    mountEl = ticketsList,
  ) => {
    if (!refunds.length) return;

    const holder = document.createElement("div");
    holder.className = "ticket-children";

    holder.innerHTML = refunds
      .map((r) => {
        const rnum = r.codigo || `#${r.idfactura}`;
        const rFechaHora = `${r.fecha || ""} ${r.hora || ""}`.trim();
        const rTotal = eurES(Number(r.total || 0));

        return `
          <div class="ticket-row ticket-status-fullref ticket-child" data-id="${Number(
            r.idfactura || 0,
          )}">
            <div class="ticket-left">
              <div class="ticket-num">
                ↩ ${escapeHtml(rnum)}
                <span style="margin-left:8px; font-size:12px; opacity:.7;">De: ${escapeHtml(
                  parentNum,
                )}</span>
              </div>
              <div class="ticket-bot">${escapeHtml(rFechaHora)}</div>
            </div>

            <div class="ticket-right">
              <div class="ticket-total">${rTotal}</div>
              <div class="ticket-actions">
                <button type="button" class="ticket-btn ticket-print" title="Imprimir">🖨</button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    mountEl.appendChild(holder);

    holder.querySelectorAll(".ticket-child").forEach((rowEl) => {
      const id = Number(rowEl.getAttribute("data-id") || 0);
      const rr = refunds.find((x) => Number(x.idfactura) === id);
      const btn = rowEl.querySelector(".ticket-print");

      if (btn && rr) {
        btn.onclick = async (e) => {
          e.stopPropagation();
          await imprimirFacturaHistorica(rr);
        };
      }
    });
  };

  const renderOneTicketRow = (t, mountEl = ticketsList) => {
    const div = document.createElement("div");
    div.className = "ticket-row";

    const num = t.codigo || `#${t.idfactura}`;
    const cliente = t.nombrecliente || "Cliente";
    const fechaHora = `${t.fecha || ""} ${t.hora || ""}`.trim();
    const totalNum = Number(t.total || 0);
    const pago = t.codpago || "—";
    const cajaId = getTicketCajaId(t);

    const obs = String(t.observaciones ?? t._raw?.observaciones ?? "")
      .replace(/\s+/g, " ")
      .trim();

    const refunds = Array.isArray(t._refunds) ? t._refunds : [];
    const hasRefunds = refunds.length > 0 || !!t._hasPartialRefund;
    const isFullyRefunded = !!t._isFullyRefunded;

    let statusClass = "ticket-status-ok";
    let badgeHtml = `<span class="ticket-badge ticket-badge-ok">OK</span>`;

    if (obs) div.classList.add("ticket-has-obs");

    if (hasRefunds && isFullyRefunded) {
      statusClass = "ticket-status-fullref";
      badgeHtml = `<span class="ticket-badge ticket-badge-fullref">DEVUELTO</span>`;
    } else if (hasRefunds) {
      statusClass = "ticket-status-partial";
      badgeHtml = `<span class="ticket-badge ticket-badge-partial">PARCIAL</span>`;
    }

    div.classList.add(statusClass);

    const remaining = Number(t._remainingAfterRefund ?? 0);
    let totalHtml = eurES(totalNum);

    if (hasRefunds && !isFullyRefunded) {
      totalHtml = `${eurES(
        totalNum,
      )} <span style="font-size:12px; font-weight:800; opacity:.85;">(${eurES(
        remaining,
      )} Rest)</span>`;
    }

    const devCountTxt = hasRefunds
      ? `<span style="margin-left:10px; font-size:12px; opacity:.75;">Dev: ${refunds.length}</span>`
      : "";

    const cajaHtml =
      ticketsViewState.tab === "other" && cajaId
        ? `<span class="ticket-id">Caja ${cajaId}</span>`
        : "";

    div.innerHTML = `
      <div class="ticket-left">
        <div class="ticket-num">
          ${escapeHtml(num)}
          ${badgeHtml}
          ${devCountTxt}
        </div>

        <div class="ticket-mid">
          <span class="ticket-client">${escapeHtml(cliente)}</span>
          <span class="ticket-pay">${escapeHtml(pago)}</span>
          ${cajaHtml}
          <span class="ticket-id">ID ${t.idfactura}</span>
        </div>

        ${obs ? `<div class="ticket-obs">${escapeHtml(obs)}</div>` : ""}
        <div class="ticket-bot">${escapeHtml(fechaHora)}</div>
      </div>

      <div class="ticket-right">
        <div class="ticket-total">${totalHtml}</div>

        <div class="ticket-actions">
          <button type="button" class="ticket-btn ticket-print" title="Imprimir">🖨</button>

          ${
            hasRefunds && isFullyRefunded
              ? ""
              : `<button type="button" class="ticket-btn ticket-refund" title="Devolver">↩</button>`
          }

          <button type="button" class="ticket-btn ticket-payedit" title="Cambiar pago">💳</button>
        </div>
      </div>
    `;

    const printBtn = div.querySelector(".ticket-print");
    if (printBtn) {
      printBtn.onclick = async (e) => {
        e.stopPropagation();
        await imprimirFacturaHistorica(t);
      };
    }

    const refundBtn = div.querySelector(".ticket-refund");
    if (refundBtn) {
      refundBtn.onclick = async (e) => {
        e.stopPropagation();
        await openRefundForFactura(t);
      };
    }

    const payEditBtn = div.querySelector(".ticket-payedit");
    if (payEditBtn) {
      payEditBtn.onclick = async (e) => {
        e.stopPropagation();
        await openPayEditForFactura(t);
      };
    }

    div.onclick = async () => {
      if (hasRefunds && isFullyRefunded) return;
      await openRefundForFactura(t);
    };

    mountEl.appendChild(div);
    renderRefundChildren(t, num, refunds, mountEl);
  };

  if (ticketsViewState.tab === "current") {
    if (!originalsCurrent.length) {
      ticketsList.innerHTML = `<div class="parked-ticket-empty">No hay tickets en esta vista.</div>`;
      return;
    }

    sortTicketsByFechaDesc(originalsCurrent).forEach((t) =>
      renderOneTicketRow(t, ticketsList),
    );
    return;
  }

  // 4) OTRAS CAJAS:
  //    groupAll = tickets reales de esa caja dentro de la búsqueda
  //    groupVisible = tickets visibles tras filtros dentro de la búsqueda
  const allOtherOriginals = searchedOriginalsAll.filter(
    (t) => getTicketCajaId(t) !== currentCajaId,
  );

  if (!allOtherOriginals.length) {
    ticketsList.innerHTML = `<div class="parked-ticket-empty">No hay tickets en esta vista.</div>`;
    return;
  }

  const visibleOtherOriginals = searchedOriginalsVisible.filter(
    (t) => getTicketCajaId(t) !== currentCajaId,
  );

  const byCajaAll = new Map();
  for (const t of allOtherOriginals) {
    const cajaId = getTicketCajaId(t) || 0;
    if (!byCajaAll.has(cajaId)) byCajaAll.set(cajaId, []);
    byCajaAll.get(cajaId).push(t);
  }

  const byCajaVisible = new Map();
  for (const t of visibleOtherOriginals) {
    const cajaId = getTicketCajaId(t) || 0;
    if (!byCajaVisible.has(cajaId)) byCajaVisible.set(cajaId, []);
    byCajaVisible.get(cajaId).push(t);
  }

  const orderedCajaIds = Array.from(byCajaAll.keys()).sort((a, b) => b - a);

  for (const cajaId of orderedCajaIds) {
    const groupAll = sortTicketsByFechaDesc(byCajaAll.get(cajaId) || []);
    const groupVisible = sortTicketsByFechaDesc(
      byCajaVisible.get(cajaId) || [],
    );

    const totalReal = groupAll.length;
    const totalVisible = groupVisible.length;
    const totalHidden = Math.max(0, totalReal - totalVisible);

    const totalCajaVisible = groupVisible.reduce(
      (acc, t) => acc + getTicketNetAmountForSummary(t),
      0,
    );

    if (ticketsViewState.filters.onlyVisibleCajas && totalVisible === 0) {
      continue;
    }

    const wrap = document.createElement("div");
    wrap.className = "ticket-caja-group";
    wrap.setAttribute("data-open", isCajaGroupOpen(cajaId) ? "1" : "0");

    const hiddenText = totalHidden > 0 ? ` · ocultos: ${totalHidden}` : "";
    const visibleText =
      totalVisible !== totalReal ? ` · visibles: ${totalVisible}` : "";

    const amountText =
      Math.abs(Number(totalCajaVisible || 0)) > 0.00001
        ? ` · ${eurES(totalCajaVisible)}`
        : "";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "ticket-caja-head";
    head.innerHTML = `
    <div class="ticket-caja-head-left">
      <span>${escapeHtml(cajaId ? `Caja ${cajaId}` : "Sin caja")}</span>
      <span class="ticket-caja-meta">
        ${totalReal} tickets${visibleText}${hiddenText}${amountText}
      </span>
    </div>
    <span class="ticket-caja-chevron">▾</span>
  `;

    const body = document.createElement("div");
    body.className = "ticket-caja-body";

    head.onclick = () => {
      const nextOpen = wrap.getAttribute("data-open") !== "1";
      wrap.setAttribute("data-open", nextOpen ? "1" : "0");
      setCajaGroupOpen(cajaId, nextOpen);
    };

    wrap.appendChild(head);
    wrap.appendChild(body);
    ticketsList.appendChild(wrap);

    if (!groupVisible.length) {
      const empty = document.createElement("div");
      empty.className = "tickets-caja-empty";
      empty.textContent = "No hay tickets visibles con los filtros actuales.";
      body.appendChild(empty);
      continue;
    }

    groupVisible.forEach((t) => renderOneTicketRow(t, body));
  }
}

// Bind botones del overlay
const ticketsKeyboardBtn = document.getElementById("ticketsKeyboardBtn");

ticketsExpandAllBtn?.addEventListener("click", () => {
  const source = ticketsUiCache.length ? ticketsUiCache : ticketsCache;
  const list = Array.isArray(source) ? source : [];
  const currentCajaId = getCurrentCajaId();

  const cajaIds = Array.from(
    new Set(
      list
        .filter((t) => {
          const raw = t._raw || {};
          const codserie = String(
            t.codserie || raw.codserie || "",
          ).toUpperCase();
          const isRect =
            codserie === "R" ||
            Number(t.idfacturarect || raw.idfacturarect || 0) > 0 ||
            !!(t.codigorect || raw.codigorect);

          return !isRect && getTicketCajaId(t) !== currentCajaId;
        })
        .map((t) => getTicketCajaId(t) || 0),
    ),
  );

  openAllCajaGroups(cajaIds);
  renderTicketsList(source);
});

ticketsCollapseAllBtn?.addEventListener("click", () => {
  const source = ticketsUiCache.length ? ticketsUiCache : ticketsCache;
  const list = Array.isArray(source) ? source : [];
  const currentCajaId = getCurrentCajaId();

  const cajaIds = Array.from(
    new Set(
      list
        .filter((t) => {
          const raw = t._raw || {};
          const codserie = String(
            t.codserie || raw.codserie || "",
          ).toUpperCase();
          const isRect =
            codserie === "R" ||
            Number(t.idfacturarect || raw.idfacturarect || 0) > 0 ||
            !!(t.codigorect || raw.codigorect);

          return !isRect && getTicketCajaId(t) !== currentCajaId;
        })
        .map((t) => getTicketCajaId(t) || 0),
    ),
  );

  closeAllCajaGroups(cajaIds);
  renderTicketsList(source);
});

tkFilterOnlyVisibleCajas?.addEventListener("change", () => {
  ticketsViewState.filters.onlyVisibleCajas =
    !!tkFilterOnlyVisibleCajas.checked;
  renderTicketsList(ticketsUiCache.length ? ticketsUiCache : ticketsCache);
});

ticketsSearchClearBtn?.addEventListener("click", () => {
  if (!ticketsSearch) return;
  ticketsSearch.value = "";
  syncTicketsSearchClearBtn();
  renderTicketsList(ticketsUiCache.length ? ticketsUiCache : ticketsCache);
  ticketsSearch.focus();
});

ticketsTabCurrent?.addEventListener("click", () => {
  ticketsViewState.tab = "current";
  syncTicketsToolbarUI();
  renderTicketsList(ticketsUiCache.length ? ticketsUiCache : ticketsCache);
});

ticketsTabOther?.addEventListener("click", () => {
  ticketsViewState.tab = "other";
  syncTicketsToolbarUI();
  renderTicketsList(ticketsUiCache.length ? ticketsUiCache : ticketsCache);
});

tkFilterNormal?.addEventListener("change", () => {
  ticketsViewState.filters.normal = !!tkFilterNormal.checked;
  renderTicketsList(ticketsUiCache.length ? ticketsUiCache : ticketsCache);
});

tkFilterRefunded?.addEventListener("change", () => {
  ticketsViewState.filters.refunded = !!tkFilterRefunded.checked;
  renderTicketsList(ticketsUiCache.length ? ticketsUiCache : ticketsCache);
});

tkFilterPartial?.addEventListener("change", () => {
  ticketsViewState.filters.partial = !!tkFilterPartial.checked;
  renderTicketsList(ticketsUiCache.length ? ticketsUiCache : ticketsCache);
});

ticketsKeyboardBtn?.addEventListener("click", () => {
  if (!ticketsSearch) return;
  openQwertyForInput(ticketsSearch);
});
if (ticketsCloseBtn) ticketsCloseBtn.onclick = closeTicketsModal;
if (ticketsReloadBtn) ticketsReloadBtn.onclick = loadAndRenderTickets;
let ticketsSearchTimer = null;

if (ticketsSearch) {
  ticketsSearch.oninput = () => {
    syncTicketsSearchClearBtn();

    clearTimeout(ticketsSearchTimer);
    ticketsSearchTimer = setTimeout(() => {
      renderTicketsList(ticketsUiCache.length ? ticketsUiCache : ticketsCache);
    }, 250);
  };
}

function mapFacturaRowToTicketRow(f) {
  return {
    idfactura: f.idfactura,
    idfacturarect: f.idfacturarect != null ? Number(f.idfacturarect) : 0, // ✅
    codigo: f.codigo || f.numero || f.codigofactura || null,
    nombrecliente: f.nombrecliente || f.cliente || f.razonsocial || "",
    total: f.total != null ? Number(f.total) : 0,
    codpago: f.codpago || f.formapago || "",
    fecha: f.fecha || "",
    codserie: f.codserie || "",
    codigorect: f.codigorect || "",
    hora: f.hora || "",
    _raw: f,
  };
}

// Botón "Tickets" (YA FUNCIONAL)
const ticketsListBtn = document.getElementById("ticketsListBtn");
if (ticketsListBtn) ticketsListBtn.onclick = openTicketsModal;

function parseFechaHoraFS(fecha, hora, idfactura) {
  // ✅ Si tenemos timestamp local guardado, SIEMPRE manda (corrige tickets de cola)
  const tsLocal = idfactura ? getFacturaLocalTimestamp(idfactura) : 0;
  if (tsLocal) return tsLocal;

  const f = String(fecha || "").trim();
  const h = String(hora || "00:00:00").trim();

  let yyyy, mm, dd;

  // dd-mm-yyyy
  let m = f.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    dd = Number(m[1]);
    mm = Number(m[2]) - 1;
    yyyy = Number(m[3]);
  } else {
    // yyyy-mm-dd
    m = f.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 0;
    yyyy = Number(m[1]);
    mm = Number(m[2]) - 1;
    dd = Number(m[3]);
  }

  const [HH, MM, SS] = h.split(":").map((x) => Number(x || 0));
  return new Date(yyyy, mm, dd, HH, MM, SS).getTime();
}

function sortTicketsByFechaDesc(list) {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => {
    const ta = parseFechaHoraFS(a.fecha, a.hora, a.idfactura);
    const tb = parseFechaHoraFS(b.fecha, b.hora, b.idfactura);
    return tb - ta;
  });
}

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

async function saveResolvedCompany({ email, baseUrl, apiKey }) {
  // legacy
  localStorage.setItem("tpv_companyEmail", email || "");
  localStorage.setItem("tpv_baseUrl", baseUrl || "");
  localStorage.setItem("tpv_apiKey", apiKey || "");

  // ✅ hidratar runtime también (para hasCompanyResolved)
  try {
    if (window.RECIPOK_API) {
      window.RECIPOK_API.baseUrl = baseUrl || "";
      window.RECIPOK_API.apiKey = apiKey || "";
    }
  } catch {}

  // durable
  try {
    const TPV_CFG = window.TPV_CFG;
    if (TPV_CFG) {
      await TPV_CFG.set("company.email", String(email || ""));
      await TPV_CFG.set("company.baseUrl", String(baseUrl || ""));
      await TPV_CFG.set("company.apiKey", String(apiKey || ""));
    }
  } catch {}
}

async function fetchClientsJson() {
  const base = (window.TPV_CONFIG && window.TPV_CONFIG.resolverUrl) || "";
  if (!base) throw new Error("Falta TPV_CONFIG.resolverUrl");
  const url = `${base}?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar clients.json");
  return await res.json();
}

async function resolveCompanyByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) throw new Error("Email vacío");

  const data = await fetchClientsJson();
  const client = (data.clients || []).find(
    (c) => normalizeEmail(c.email) === e,
  );

  if (!client) throw new Error("Cuenta no encontrada");
  if (client.active === false) throw new Error("Cuenta desactivada");

  const slug = client.slug;
  const apiKey = client.apiKey;

  if (!slug) throw new Error("clients.json: falta slug");
  if (!apiKey) throw new Error("clients.json: falta apiKey");

  const baseUrl = `https://plus.recipok.com/${slug}/api/3`;
  return { email: e, baseUrl, apiKey };
}

async function validateBaseUrlOrThrow(baseUrl, apiKey) {
  const url = `${baseUrl.replace(/\/+$/, "")}/productos?limit=1`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", Token: apiKey },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Ping falló: HTTP ${res.status}`);
    }

    await res.json().catch(() => null);
    return true;
  } finally {
    clearTimeout(t);
  }
}

async function forceReconnectFlow() {
  try {
    toast("Conectando…", "info");

    let email = await askEmailWithModal();
    email = normalizeEmail(email);

    if (!email) {
      toast("Conexión cancelada. Sigues en modo demo.", "warn");
      return false;
    }

    // Esto ya valida si existe y si está activa
    const resolved = await resolveCompanyByEmail(email);

    await saveResolvedCompany(resolved);

    await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);

    TPV_STATE.offline = false;
    TPV_STATE.locked = false;
    updateCashButtonLabel();

    toast("Conectado ✅", "ok");

    // Recargamos datos reales
    await loadDataFromApi();

    return true;
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);

    if (msg.toLowerCase().includes("desactivada")) {
      TPV_STATE.locked = true;
      TPV_STATE.offline = false;
      updateCashButtonLabel();
      showMessageModal(
        "Acceso bloqueado",
        "Tu cuenta de TPV está desactivada. Contacta con soporte.",
      );
      return false;
    }

    TPV_STATE.offline = true;
    updateCashButtonLabel();
    toast("No se pudo conectar. Modo demo.", "warn");
    return false;
  }
}

async function bootstrapApp() {
  const ok = await runBootFlow(); // 👈 IMPORTANTE: capturar retorno
  if (!ok) return false;
  await hydrateLegacyCompanyFromCfg();

  // ✅ guardia: solo si hay empresa y login válidos
  if (!hasCompanyResolved() || !getLoginUser() || !getLoginToken()) {
    return false;
  }

  // Precargas (una sola vez)
  try {
    const methods = await fetchFormasPagoActivas({
      forceOnlineIfPossible: true,
    });
    console.log("Formas de pago precargadas:", methods?.length || 0);
  } catch (e) {
    console.warn("No se pudieron precargar formapagos:", e?.message || e);
  }

  try {
    const list = await refreshTicketsCacheFromServer(); // usa tu función (limit 300)
    console.log("Tickets precargados:", list?.length || 0);
  } catch (e) {
    console.warn("No se pudieron precargar tickets:", e?.message || e);
  }

  return true;
}

/*bootstrapApp();*/
async function getPersistedCompanyCfg() {
  try {
    return JSON.parse(localStorage.getItem("tpv_company_cfg") || "{}");
  } catch {
    return {};
  }
}

async function persistCompanyCfg(resolved) {
  if (!resolved) return;

  const data = {
    email: resolved.email || null,
    slug: resolved.slug || null,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
  };

  localStorage.setItem("tpv_company_cfg", JSON.stringify(data));
}

function logCompanyCfg(where = "") {
  try {
    const base = (
      window.RECIPOK_API?.baseUrl ||
      localStorage.getItem("tpv_baseUrl") ||
      ""
    ).trim();

    console.log(`[CFG] ${where}`, {
      RECIPOK_API_baseUrl: window.RECIPOK_API?.baseUrl || "",
      RECIPOK_API_apiKeyLen: String(window.RECIPOK_API?.apiKey || "").length,
      LS_baseUrl: localStorage.getItem("tpv_baseUrl") || "",
      LS_companyEmail: localStorage.getItem("tpv_companyEmail") || "",
      isDemo: /\/demo\/api\/\d+/i.test(base),
    });
  } catch (e) {
    console.warn("[CFG] logCompanyCfg error:", e?.message || e);
  }
}

function warnIfDemoBaseUrl(where = "") {
  try {
    const base = (
      window.RECIPOK_API?.baseUrl ||
      localStorage.getItem("tpv_baseUrl") ||
      ""
    ).trim();

    if (/\/demo\/api\/\d+/i.test(base)) {
      console.warn(`[WARN] baseUrl apunta a DEMO ${where}:`, base);
    }
  } catch {}
}

async function bootstrapCompany() {
  console.log("bootstrapCompany() ejecutándose...");

  // 👇 0) compat/migración antes de leer nada
  await hydrateLegacyCompanyFromCfg();
  await repairCompanyPersistenceIfNeeded();

  // Leer config persistente (userData)
  const saved = await getPersistedCompanyCfg();
  const savedEmail = normalizeEmail(saved?.email || null);

  const applyResolved = ({ baseUrl, apiKey }) => {
    window.RECIPOK_API.baseUrl = baseUrl;
    window.RECIPOK_API.apiKey = apiKey;
  };

  const persistLegacyLocal = ({ email, baseUrl, apiKey }) => {
    try {
      if (email) localStorage.setItem("tpv_companyEmail", String(email));
    } catch {}
    try {
      if (baseUrl) localStorage.setItem("tpv_baseUrl", String(baseUrl));
    } catch {}
    try {
      if (apiKey) localStorage.setItem("tpv_apiKey", String(apiKey));
    } catch {}
  };

  // 0) Cargar clients.json
  let clientsData = null;

  try {
    clientsData = await fetchClientsJson();
  } catch (e) {
    console.warn("No se pudo cargar clients.json:", e);
    clientsData = { clients: [] };
  }

  const findClientByEmail = (email) => {
    const e = normalizeEmail(email);

    return (
      (clientsData.clients || []).find((c) => normalizeEmail(c.email) === e) ||
      null
    );
  };

  // Pedir email hasta que sea válido
  const askAndResolve = async () => {
    while (true) {
      let email = await askEmailWithModal();
      email = normalizeEmail(email);

      if (!email) {
        toast(
          "Activación cancelada. Arrancando en modo demo.",
          "warn",
          "Activación",
        );

        TPV_STATE.offline = true;
        TPV_STATE.locked = false;
        updateCashButtonLabel();

        return null;
      }

      const client = findClientByEmail(email);

      if (!client) {
        alert("Email no encontrado.");
        continue;
      }

      if (client.active === false) {
        TPV_STATE.locked = true;
        TPV_STATE.offline = false;

        updateCashButtonLabel();

        showMessageModal(
          "Acceso bloqueado",
          "Tu cuenta de TPV está desactivada.",
        );

        return null;
      }

      const resolved = await resolveCompanyByEmail(email);
      return { ...resolved, email }; // asegura email dentro del objeto
    }
  };

  // =================================================
  // 1) SI YA HAY EMAIL GUARDADO
  // =================================================
  if (savedEmail) {
    const client = findClientByEmail(savedEmail);

    if (!client) {
      console.warn("Email guardado inválido. Re-pidiendo...");

      const resolved = await askAndResolve();
      if (!resolved) return false;

      await persistCompanyCfg(resolved);
      applyResolved(resolved);
      persistLegacyLocal(resolved);
      logCompanyCfg("after applyResolved");
      warnIfDemoBaseUrl("(boot)");

      await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);

      TPV_STATE.offline = false;
      TPV_STATE.locked = false;
      updateCashButtonLabel();

      return true;
    }

    if (client.active === false) {
      TPV_STATE.locked = true;
      TPV_STATE.offline = false;

      updateCashButtonLabel();

      showMessageModal("Acceso bloqueado", "Cuenta desactivada.");

      return false;
    }

    // Email válido → resolver
    try {
      const resolved = await resolveCompanyByEmail(savedEmail);

      await persistCompanyCfg(resolved);
      applyResolved(resolved);
      persistLegacyLocal(resolved);
      logCompanyCfg("after applyResolved");
      warnIfDemoBaseUrl("(boot)");

      await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);

      TPV_STATE.offline = false;
      TPV_STATE.locked = false;
      updateCashButtonLabel();

      return true;
    } catch (e) {
      console.warn("Validación fallida:", e);

      const resolved2 = await askAndResolve();
      if (!resolved2) return false;

      await persistCompanyCfg(resolved2);
      applyResolved(resolved2);

      await validateBaseUrlOrThrow(resolved2.baseUrl, resolved2.apiKey);

      TPV_STATE.offline = false;
      TPV_STATE.locked = false;
      updateCashButtonLabel();

      return true;
    }
  }

  // =================================================
  // 2) NO HAY EMAIL → PEDIR
  // =================================================
  const resolved = await askAndResolve();

  if (!resolved) return false;

  await persistCompanyCfg(resolved);
  applyResolved(resolved);
  persistLegacyLocal(resolved);
  logCompanyCfg("after applyResolved");
  warnIfDemoBaseUrl("(boot)");

  await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);

  TPV_STATE.offline = false;
  TPV_STATE.locked = false;
  updateCashButtonLabel();

  return true;
}

async function fetchFacturaClienteById(idfactura) {
  const data = await fetchApiResourceWithParams("facturaclientes", {
    "filter[idfactura]": idfactura,
    limit: 1,
  });
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function createReciboCliente({
  idfactura,
  codcliente, // ✅ NUEVO
  codpago,
  importe,
  fechaPago,
  idempresa, // opcional (pero recomendado)
  codigofactura, // opcional (pero recomendado)
  coddivisa, // opcional
  fecha, // opcional (fecha del recibo)
}) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Config API no definida");

  if (!codcliente) throw new Error("Falta codcliente para crear el recibo");

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/reciboclientes`;

  const body = new URLSearchParams();
  body.append("idfactura", String(idfactura));
  body.append("codcliente", String(codcliente)); // ✅ CLAVE
  body.append("codpago", String(codpago));
  body.append("importe", String(importe));
  body.append("pagado", "1");

  // Recomendados para evitar rarezas en algunos setups de FS
  if (idempresa != null) body.append("idempresa", String(idempresa));
  if (codigofactura) body.append("codigofactura", String(codigofactura));
  if (coddivisa) body.append("coddivisa", String(coddivisa));
  if (fecha) body.append("fecha", String(fecha));

  if (fechaPago) body.append("fechapago", String(fechaPago));
  // si tu FS lo usa, también puedes mandar vencimiento = fecha
  if (fecha) body.append("vencimiento", String(fecha));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Error creando recibo: HTTP ${res.status} ${txt}`);
  }

  return await res.json().catch(() => ({}));
}

async function deleteReciboCliente(idrecibo) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Config API no definida");

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/reciboclientes/${idrecibo}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
    },
  });

  // Algunas instalaciones devuelven 200/204 con o sin JSON
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Error borrando recibo ${idrecibo}: HTTP ${res.status} ${txt}`,
    );
  }
  return true;
}

// Deja SOLO los recibos que correspondan a los pagos del modal.
// Elimina el recibo "total" automático y cualquier duplicado.
async function cleanupRecibosFactura(idfactura, pagosEsperados) {
  if (!idfactura) return;

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const normCode = (v) =>
    String(v || "")
      .trim()
      .toUpperCase();

  const expected = (Array.isArray(pagosEsperados) ? pagosEsperados : [])
    .map((p) => ({
      codpago: normCode(p.codpago),
      importe: round2(p.importe),
    }))
    .filter((x) => x.codpago && x.importe > 0);

  if (!expected.length) return;

  const recibos = await fetchRecibosByFactura(idfactura);
  if (!Array.isArray(recibos) || !recibos.length) return;

  // Pool consumible (permitimos repetidos)
  const expectedPool = expected.slice();

  const sameMoney = (a, b) => Math.abs(round2(a) - round2(b)) <= 0.01;

  const matchesOneExpected = (r) => {
    const cod = normCode(r.codpago);
    const imp = round2(r.importe);

    const idx = expectedPool.findIndex(
      (e) => e.codpago === cod && sameMoney(e.importe, imp),
    );

    if (idx >= 0) {
      expectedPool.splice(idx, 1);
      return true;
    }
    return false;
  };

  // Opcional: procesa primero recibos “más nuevos” (reduce errores raros)
  const recibosSorted = [...recibos].sort((a, b) => {
    const ida = Number(a.idrecibo || a.id || a.idrecibocliente || 0);
    const idb = Number(b.idrecibo || b.id || b.idrecibocliente || 0);
    return idb - ida;
  });

  for (const r of recibosSorted) {
    const idrecibo = r.idrecibo || r.id || r.idrecibocliente;
    if (!idrecibo) continue;

    // Si coincide con uno de los pagos esperados, lo dejamos.
    if (matchesOneExpected(r)) continue;

    // Si NO coincide => es el "total" automático o un duplicado => lo borramos
    try {
      await deleteReciboCliente(idrecibo);
    } catch (e) {
      console.warn(
        "No se pudo borrar recibo duplicado:",
        idrecibo,
        e?.message || e,
      );
    }
  }
}

async function fetchApiResourceWithParams(resource, params = {}) {
  const cfg = window.RECIPOK_API;
  if (!cfg || !cfg.baseUrl || !cfg.apiKey)
    throw new Error("Config API no definida");

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();

  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    sp.append(k, String(v));
  });

  const url = `${base}/${resource}${sp.toString() ? "?" + sp.toString() : ""}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", Token: cfg.apiKey },
    cache: "no-store",
  });

  if (res.status === 429)
    throw new Error("API 429 (demasiadas peticiones). Espera unos minutos.");
  const data = await res.json().catch(() => null);

  if (!res.ok) throw new Error(`HTTP ${res.status} en ${resource}`);
  if (data && data.status === "error")
    throw new Error(data.message || `Error API en ${resource}`);

  return data;
}

// ==========================
// PACKS / OFERTAS (Facturascripts plugin)
// ==========================

function normTxt(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildPackChildRefSet() {
  const set = new Set();
  for (const lines of PACKS_STATE.linesByPackId.values()) {
    for (const ln of lines || []) {
      const ref = normTxt(ln.reference);
      if (ref) set.add(ref);
    }
  }
  return set;
}

function buildDesiredByPidFromFacturaLines(fsLines) {
  const desired = {};
  const lines = Array.isArray(fsLines) ? fsLines : [];

  for (const l of lines) {
    const unit = Number(l?.pvpunitario ?? 0);
    if (Math.abs(unit) > 0.00001) continue; // solo 0€
    const pid = Number(l?.idproducto || 0);
    if (!pid) continue;

    // excluir pack parent (producto oferta)
    if (
      typeof isOfferPackProductById === "function" &&
      isOfferPackProductById(pid)
    ) {
      continue;
    }

    const qty = Number(l?.cantidad || 0);
    if (!isFinite(qty) || qty === 0) continue;

    desired[pid] = (desired[pid] ?? 0) + qty;
  }

  return desired; // { [idproducto]: qty }
}

function negateDesiredByPid(desired) {
  const out = {};
  for (const [k, v] of Object.entries(desired || {})) {
    out[k] = -Number(v || 0);
  }
  return out;
}

function isZeroUnitFsLine(l) {
  const u = Number(l?.pvpunitario ?? 0);
  return Math.abs(u) < 1e-9;
}

function ticketHasOfferByName(fsLines) {
  // Detecta si el ticket tiene alguna oferta (por nombre del producto oferta)
  // Usamos tu catálogo `products` (que ya contiene las ofertas como productos)
  const offerNameSet = new Set(
    (products || [])
      .filter((p) => isOfferPackProductById(p.baseProductId || p.id))
      .map((p) =>
        normTxt(p.secondaryName ? `${p.name} - ${p.secondaryName}` : p.name),
      )
      .filter(Boolean),
  );

  const lines = Array.isArray(fsLines) ? fsLines : [];
  return lines.some((l) => {
    const d = normTxt(l?.descripcion);
    if (!d) return false;
    for (const offer of offerNameSet) {
      if (offer && d.includes(offer)) return true;
    }
    return false;
  });
}

function looksLikePackChildByRef(fsLine, childRefSet) {
  const d = normTxt(fsLine?.descripcion);
  if (!d) return false;

  // coincide si la descripción contiene la reference del packline
  for (const ref of childRefSet) {
    if (ref && d.includes(ref)) return true;
  }
  return false;
}

/**
 * ✅ Filtra líneas para devolución:
 * - Si no hay PACKS_STATE listo -> no filtra.
 * - Si el ticket no parece contener ofertas -> no filtra.
 * - Si hay ofertas -> oculta líneas 0,00 que coinciden con references del pack.
 */
function filterRefundLinesForUI(fsLines) {
  const lines = Array.isArray(fsLines) ? fsLines : [];

  if (!PACKS_STATE?.ready) return lines;

  const hasOffer = ticketHasOfferByName(lines);
  if (!hasOffer) return lines;

  const childRefSet = buildPackChildRefSet();

  return lines.filter((l) => {
    if (!isZeroUnitFsLine(l)) return true; // líneas normales
    // si vale 0, solo la ocultamos si parece hijo de pack
    return !looksLikePackChildByRef(l, childRefSet);
  });
}

function isPackParentLine(line) {
  return !!line?.meta?.isPackOffer && !!line?.meta?.packId;
}

function isPackChildLine(line) {
  return !!line?.meta?.includedInPack && !!line?.meta?.parentPackLineId;
}

function getPackChildren(parentLineId) {
  return cart.filter((x) => x?.meta?.parentPackLineId === parentLineId);
}

function removePackCascade(parentLineId) {
  cart = cart.filter(
    (x) =>
      x._lineId !== parentLineId && x?.meta?.parentPackLineId !== parentLineId,
  );
}

function getPackIncludesTextForParentLine(parentLine) {
  if (!isPackParentLine(parentLine)) return "";

  const packId = Number(parentLine?.meta?.packId || 0);
  if (!packId) return "";

  const lines = PACKS_STATE.linesByPackId.get(packId) || [];
  if (!lines.length) return "";

  // Nota: aquí usamos la referencia (más fiable) y multiplicamos por qty del parent
  const parentQty = Number(parentLine.qty || 0) || 0;

  return lines
    .map((ln) => {
      const ref = String(ln.reference || "").trim();
      const baseQ = Number(ln.quantity || 1) || 1;
      const q = baseQ * parentQty;
      return `${ref} x${fmtQty(q)}`;
    })
    .join(" · ");
}

/**
 * Filtra para UI (cliente): oculta hijos del pack.
 * Además, para el parent añade "Incluye: ..." en secondaryName.
 */
function buildCustomerItemsFromCart(cartArr) {
  const src = Array.isArray(cartArr) ? cartArr : [];

  // ocultar hijos
  const visible = src.filter((item) => !isPackChildLine(item));

  return visible.map((item) => {
    const unitPrice = Number(getUnitGross(item) || 0);
    const qty = Number(item.qty || 0);
    const lineTotal = unitPrice * qty;

    const baseSecondary = String(item.secondaryName || "").trim();

    let secondaryName = baseSecondary;

    if (isPackParentLine(item)) {
      // ✅ primero: hijos reales (refleja modificaciones del modal)
      let includes = buildPackIncludesTextFromChildren(src, item._lineId);

      // fallback: si por lo que sea no hay hijos, usar plantilla FS
      if (!includes) includes = getPackIncludesTextForParentLine(item);

      if (includes) {
        secondaryName = baseSecondary
          ? `${baseSecondary} · Incluye: ${includes}`
          : `Incluye: ${includes}`;
      }
    }

    return {
      lineId: item._lineId,
      name: item.name || "",
      secondaryName,
      qty,
      unitPrice,
      lineTotal,
      imageUrl: item.imageUrl || item.imgUrl || null,
      modified: !!isPriceModified?.(item),
    };
  });
}

/**
 * Ajusta qty de hijos = qty_padre * qty_base_del_packline
 * Requiere que cada hijo tenga meta.packRef con la referencia del packline.
 */
function syncSelectedPackChildrenQty(parentLine) {
  if (!isPackParentLine(parentLine)) return;

  const selection = Array.isArray(parentLine?.meta?.packSelection)
    ? parentLine.meta.packSelection
    : [];

  const qByRef = new Map();
  for (const s of selection) {
    const ref = String(s.reference || "").trim();
    const q = Number(s.qty || 0);
    if (ref && q > 0) qByRef.set(ref, q);
  }

  const children = getPackChildren(parentLine._lineId);
  const parentQty = Number(parentLine.qty || 0) || 0;

  // 1) eliminar hijos que ya no están en selección
  for (const ch of [...children]) {
    const ref = String(ch?.meta?.packRef || "").trim();
    if (!qByRef.has(ref)) {
      cart = cart.filter((x) => x._lineId !== ch._lineId);
    }
  }

  // 2) actualizar qty de los que quedan
  const updatedChildren = getPackChildren(parentLine._lineId);
  for (const ch of updatedChildren) {
    const ref = String(ch?.meta?.packRef || "").trim();
    const baseQ = qByRef.get(ref) || 0;
    ch.qty = baseQ * parentQty;

    ch.grossPriceOverride = 0;
    ch.originalGrossPrice =
      ch.originalGrossPrice ?? ch.grossPrice ?? ch.price ?? 0;
  }

  // (Opcional) si faltan hijos porque la selección cambió después, aquí podrías crearlos,
  // pero en tu flujo la selección se define al crear el pack.
}

const PACKS_STATE = {
  ready: false,
  packsByOfferProductId: new Map(), // key: idproducto oferta (idproduct en productpacks)
  linesByPackId: new Map(), // key: idpack -> [lines]
  productByRefCache: new Map(), // key: referencia -> producto FS (o null)
};

async function fetchProductoByReferencia(ref) {
  const key = String(ref || "").trim();
  if (!key) return null;

  if (PACKS_STATE.productByRefCache.has(key)) {
    return PACKS_STATE.productByRefCache.get(key);
  }

  try {
    const data = await fetchApiResourceWithParams("productos", {
      "filter[referencia]": key,
      limit: 1,
      "sort[idproducto]": "DESC",
    });
    const p = Array.isArray(data) && data[0] ? data[0] : null;
    PACKS_STATE.productByRefCache.set(key, p);
    return p;
  } catch {
    PACKS_STATE.productByRefCache.set(key, null);
    return null;
  }
}

async function warmupPacksData() {
  PACKS_STATE.ready = false;
  PACKS_STATE.packsByOfferProductId.clear();
  PACKS_STATE.linesByPackId.clear();
  PACKS_STATE.productByRefCache.clear();

  // si estás offline/demo, no hace nada
  if (TPV_STATE?.offline) return;

  let packs = [];
  let lines = [];

  try {
    // ✅ mejor en paralelo
    [packs, lines] = await Promise.all([
      fetchApiResource("productpacks").catch(() => []),
      fetchApiResource("productpacklines").catch(() => []),
    ]);
  } catch {}

  if (!Array.isArray(packs)) packs = [];
  if (!Array.isArray(lines)) lines = [];

  // productpacks: { id, idproduct, name, reference, ... }
  for (const p of packs) {
    const offerId = Number(p.idproduct || 0);
    const packId = Number(p.id || 0);
    if (!offerId || !packId) continue;
    PACKS_STATE.packsByOfferProductId.set(offerId, {
      id: packId,
      idproduct: offerId,
      name: p.name || "",
      reference: p.reference || "",
      raw: p,
    });
  }

  // productpacklines: { idpack, reference, quantity, ... }
  for (const ln of lines) {
    const packId = Number(ln.idpack || 0);
    if (!packId) continue;
    if (!PACKS_STATE.linesByPackId.has(packId)) {
      PACKS_STATE.linesByPackId.set(packId, []);
    }
    PACKS_STATE.linesByPackId.get(packId).push(ln);
  }

  PACKS_STATE.ready = true;
}

function isOfferPackProductById(productId) {
  const id = Number(productId || 0);
  if (!id) return false;
  return PACKS_STATE.ready && PACKS_STATE.packsByOfferProductId.has(id);
}

function selectionKeyFromArr(arr) {
  // Normaliza para comparar configuraciones (orden estable)
  return JSON.stringify(
    (arr || [])
      .map((x) => ({
        reference: String(x.reference || "").trim(),
        qty: Number(x.qty || 0),
      }))
      .filter((x) => x.reference && x.qty > 0)
      .sort((a, b) => a.reference.localeCompare(b.reference)),
  );
}

async function openPackConfigModal({ offerName, offerSecondary, packLines }) {
  return new Promise((resolve) => {
    document.body.classList.add("modal-locked");

    const overlay = document.createElement("div");
    overlay.className = "pack-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "pack-modal";

    // Header
    const head = document.createElement("div");
    head.className = "pack-modal-head";

    const hTitle = document.createElement("div");
    hTitle.className = "pack-modal-title";
    hTitle.textContent = offerSecondary
      ? `${offerName} - ${offerSecondary}`
      : offerName;

    const xBtn = document.createElement("button");
    xBtn.type = "button";
    xBtn.className = "pack-modal-x";
    xBtn.textContent = "✕";

    head.appendChild(hTitle);
    head.appendChild(xBtn);

    // Body
    const body = document.createElement("div");
    body.className = "pack-modal-body";

    // ✅ Barra acciones
    const bulkActions = document.createElement("div");
    bulkActions.className = "pack-modal-bulk-actions";

    const btnCheckAll = document.createElement("button");
    btnCheckAll.type = "button";
    btnCheckAll.className = "pack-btn pack-btn-bulk";
    btnCheckAll.textContent = "Marcar todo";

    const btnUncheckAll = document.createElement("button");
    btnUncheckAll.type = "button";
    btnUncheckAll.className = "pack-btn pack-btn-bulk";
    btnUncheckAll.textContent = "Desmarcar todo";

    bulkActions.appendChild(btnCheckAll);
    bulkActions.appendChild(btnUncheckAll);

    const list = document.createElement("div");
    list.className = "pack-modal-list";

    // Estado
    const state = packLines.map((pl) => {
      const def = Math.max(1, Math.round(Number(pl.baseQty || 1)));
      return {
        reference: String(pl.reference || "").trim(),
        productName: pl.productName || pl.reference || "Producto",
        defaultQty: def,
        checked: true,
        qty: def,
      };
    });

    function close(result) {
      overlay.remove();
      document.body.classList.remove("modal-locked");
      resolve(result);
    }

    function setRowDisabled(row, disabled) {
      row.classList.toggle("is-disabled", disabled);
    }

    function applyQty(i, newQty) {
      const s = state[i];
      let q = Number(newQty);
      if (!isFinite(q)) q = 0;
      q = Math.max(0, Math.round(q));

      if (q === 0) {
        s.qty = 0;
        s.checked = false;
      } else {
        s.qty = q;
        s.checked = true;
      }

      renderRow(i);
    }

    const rowEls = new Map();

    function renderRow(i) {
      const s = state[i];
      const row = rowEls.get(i);
      if (!row) return;

      const chk = row.querySelector("input[type=checkbox]");
      const valueBtn = row.querySelector(".pack-step-value");

      chk.checked = !!s.checked;

      if (s.checked && (!s.qty || s.qty <= 0)) {
        s.qty = s.defaultQty || 1;
      }

      valueBtn.textContent = String(s.qty || 0);
      setRowDisabled(row, !s.checked);
    }

    // ✅ re-render global
    function renderAllRows() {
      for (let i = 0; i < state.length; i++) {
        renderRow(i);
      }
    }

    // ✅ marcar/desmarcar todo
    function setAllPackRowsChecked(checked) {
      for (const s of state) {
        s.checked = !!checked;

        if (checked) {
          if (!s.qty || s.qty <= 0) {
            s.qty = s.defaultQty || 1;
          }
        } else {
          s.qty = 0;
        }
      }

      renderAllRows();
    }

    function makeRow(i) {
      const s = state[i];

      const row = document.createElement("div");
      row.className = "pack-item";

      const left = document.createElement("div");
      left.className = "pack-item-left";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = !!s.checked;

      const name = document.createElement("div");
      name.className = "pack-item-name";
      name.textContent = s.productName;

      left.appendChild(chk);
      left.appendChild(name);

      const stepper = document.createElement("div");
      stepper.className = "pack-stepper";

      const btnReset = document.createElement("button");
      btnReset.type = "button";
      btnReset.className = "pack-step-btn reset";
      btnReset.title = "Restaurar cantidad por defecto";
      btnReset.textContent = "↺";

      const btnMinus = document.createElement("button");
      btnMinus.type = "button";
      btnMinus.className = "pack-step-btn minus";
      btnMinus.textContent = "−";

      const valueBtn = document.createElement("button");
      valueBtn.type = "button";
      valueBtn.className = "pack-step-value";
      valueBtn.textContent = String(s.qty);

      const btnPlus = document.createElement("button");
      btnPlus.type = "button";
      btnPlus.className = "pack-step-btn plus";
      btnPlus.textContent = "+";

      stepper.appendChild(btnReset);
      stepper.appendChild(btnMinus);
      stepper.appendChild(valueBtn);
      stepper.appendChild(btnPlus);

      row.appendChild(left);
      row.appendChild(stepper);

      function ensureChecked() {
        if (!s.checked) {
          s.checked = true;
          if (!s.qty || s.qty <= 0) s.qty = s.defaultQty || 1;
        }
      }

      chk.addEventListener("change", () => {
        s.checked = chk.checked;

        if (s.checked) {
          if (!s.qty || s.qty <= 0) s.qty = s.defaultQty || 1;
        } else {
          s.qty = 0;
        }

        renderRow(i);
      });

      btnPlus.addEventListener("click", () => {
        ensureChecked();
        applyQty(i, Number(s.qty || 0) + 1);
      });

      btnMinus.addEventListener("click", () => {
        ensureChecked();
        const next = Number(s.qty || 0) - 1;
        applyQty(i, next <= 0 ? 0 : next);
      });

      btnReset.addEventListener("click", () => {
        ensureChecked();
        applyQty(i, s.defaultQty || 1);
      });

      valueBtn.addEventListener("click", () => {
        ensureChecked();
        modal.scrollTop = 0;

        openNumPad(
          String(s.qty || s.defaultQty || 1),
          (val) => {
            let q = Number(val);
            if (!isFinite(q)) q = 0;
            q = Math.max(0, Math.round(q));
            applyQty(i, q);
          },
          s.productName,
        );
      });

      rowEls.set(i, row);
      renderRow(i);
      return row;
    }

    for (let i = 0; i < state.length; i++) {
      list.appendChild(makeRow(i));
    }

    // ✅ bind acciones masivas
    btnCheckAll.addEventListener("click", () => {
      setAllPackRowsChecked(true);
    });

    btnUncheckAll.addEventListener("click", () => {
      setAllPackRowsChecked(false);
    });

    body.appendChild(bulkActions);
    body.appendChild(list);

    // Footer
    const actions = document.createElement("div");
    actions.className = "pack-modal-actions";

    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.className = "pack-btn pack-btn-cancel";
    btnCancel.textContent = "Cancelar";

    const btnOk = document.createElement("button");
    btnOk.type = "button";
    btnOk.className = "pack-btn pack-btn-ok";
    btnOk.textContent = "Confirmar";

    actions.appendChild(btnCancel);
    actions.appendChild(btnOk);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    xBtn.addEventListener("click", () => close(null));
    btnCancel.addEventListener("click", () => close(null));

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });

    btnOk.addEventListener("click", () => {
      const selection = state
        .filter((s) => s.checked && Number(s.qty || 0) > 0)
        .map((s) => ({
          reference: s.reference,
          qty: Number(s.qty || 0),
        }));

      if (!selection.length) {
        toast("La oferta no puede quedar vacía.", "warn");
        return;
      }

      close(selection);
    });
  });
}

// =============================================================
// IMÁGENES DE PRODUCTOS (attachedfiles + attachedfilerelations)
// =============================================================

// Mapa global: { [idproducto]: { idfile, url, filename, mimetype } }
let PRODUCT_IMAGES_MAP = {};

// Devuelve solo los files que sean imagen
async function fetchAttachedImageFiles() {
  const data = await fetchApiResourceWithParams("attachedfiles", {
    limit: 5000,
    "sort[idfile]": "DESC",
  });

  const list = Array.isArray(data) ? data : [];

  return list.filter((f) => {
    const mime = String(f.mimetype || "").toLowerCase();
    const name = String(f.filename || "");
    return mime.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(name);
  });
}

// Devuelve solo relaciones de tipo Producto
async function fetchProductFileRelations() {
  const data = await fetchApiResourceWithParams("attachedfilerelations", {
    "filter[model]": "Producto",
    limit: 5000,
    "sort[id]": "DESC", // o el campo real si lo devuelve como "id"
  });

  const list = Array.isArray(data) ? data : [];
  return list.filter(
    (r) =>
      String(r.model || "") === "Producto" &&
      r.idfile != null &&
      r.modelid != null,
  );
}

// Construye el mapa idproducto -> { url, idfile, ... }
async function buildProductImagesMap() {
  const [files, relations] = await Promise.all([
    fetchAttachedImageFiles(),
    fetchProductFileRelations(),
  ]);

  const fileById = {};
  files.forEach((f) => {
    fileById[Number(f.idfile)] = f;
  });

  const cfg = window.RECIPOK_API || {};
  const apiBase = (cfg.baseUrl || "").replace(/\/+$/, "");
  const fileBase = apiBase.replace(/\/api\/3$/i, "");

  const map = {};

  relations.forEach((rel) => {
    const idprod = Number(rel.modelid);
    const idfile = Number(rel.idfile);
    if (!idprod || !idfile) return;

    if (map[idprod]) return; // nos quedamos con la primera

    const f = fileById[idfile];
    if (!f) return;

    const path = f["download-permanent"] || f.download || f.path || "";

    if (!path) return;

    const url = `${fileBase}/${path.replace(/^\/+/, "")}`;

    map[idprod] = {
      idfile,
      url,
      filename: f.filename || "",
      mimetype: f.mimetype || "",
    };
  });

  PRODUCT_IMAGES_MAP = map;
  return map;
}

async function fetchUltimosTickets(limit = 60, days = 30) {
  const onlyTpvId = String(currentTerminal?.id || "");

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const rows = await fetchApiResourceWithParams("facturaclientes", {
    limit: 300,
    "sort[idfactura]": "DESC", // ✅ tu API
    // opcional: sin filtro por fecha si te quieres curar en salud
    // "filter[fecha_gte]": since,
  });

  let list = (Array.isArray(rows) ? rows : []).map(mapFacturaRowToTicketRow);

  // 1. Filtro de TPV (con fallback para no perder tickets sin ID)
  if (onlyTpvId) {
    list = list.filter((t) => {
      const idtpv = t.idtpv || t._raw?.idtpv;
      return !idtpv || String(idtpv) === onlyTpvId;
    });
  }

  // 2. ORDENACIÓN PREVIA:
  // Antes de vincular, necesitamos que estén ordenados por ID o Fecha
  // para que 'linkTicketsRefundRelations' sepa quién es el más reciente.
  list = sortTicketsByFechaDesc(list);

  // IMPORTANTE: No hagas el .slice(0, limit) aquí todavía,
  // porque podrías dejar fuera un ticket original cuyo abono sí está en la lista.

  return list;
}

function linkTicketsRefundRelations(list) {
  const tickets = Array.isArray(list) ? list : [];

  // Index rápido por código e id
  const byCodigo = {};
  const byId = {};
  tickets.forEach((t) => {
    if (t?.codigo) byCodigo[String(t.codigo)] = t;
    if (t?.idfactura != null) byId[String(t.idfactura)] = t;
  });

  // refundsByOrigCodigo: "FAC2026A124" -> [refundTicket, ...]
  const refundsByOrigCodigo = {};

  // 1) Detecta devoluciones y agrúpalas por codigorect
  for (const t of tickets) {
    const raw = t?._raw || {};
    const codserie = String(t.codserie || raw.codserie || "").toUpperCase();
    const isRefund =
      codserie === "R" ||
      Number(t.idfacturarect || raw.idfacturarect || 0) > 0 ||
      Number(t.total || 0) < 0;

    if (!isRefund) continue;

    const origCodigo = String(t.codigorect || raw.codigorect || "").trim();
    const origId = Number(t.idfacturarect || raw.idfacturarect || 0) || 0;

    // Guardamos referencias para pintar UI
    t._isRefund = true;
    t._origCodigo = origCodigo || null;
    t._origId = origId || null;

    if (origCodigo) {
      if (!refundsByOrigCodigo[origCodigo])
        refundsByOrigCodigo[origCodigo] = [];
      refundsByOrigCodigo[origCodigo].push(t);
    }
  }

  // 2) Marca originales como parciales si tienen devoluciones
  for (const t of tickets) {
    const raw = t?._raw || {};
    const codserie = String(t.codserie || raw.codserie || "").toUpperCase();
    const isRefund =
      t._isRefund || codserie === "R" || Number(t.total || 0) < 0;
    if (isRefund) continue;

    const codigo = String(t.codigo || "").trim();
    const refunds = codigo ? refundsByOrigCodigo[codigo] || [] : [];

    if (refunds.length) {
      t._refunds = refunds.slice().sort((a, b) => {
        const ad = `${a.fecha || ""} ${a.hora || ""}`.trim();
        const bd = `${b.fecha || ""} ${b.hora || ""}`.trim();
        return bd.localeCompare(ad);
      });

      t._hasPartialRefund = true;
      t._refundCount = refunds.length;

      // 👇 total devuelto (en positivo)
      const refundedAbs = refunds.reduce(
        (acc, r) => acc + Math.abs(Number(r.total || 0)),
        0,
      );

      // 👇 total original (positivo)
      const originalTotal = Math.abs(Number(t.total || 0));

      // 👇 restante “cobrado” (lo que queda tras devoluciones)
      const remaining = Math.max(0, originalTotal - refundedAbs);

      t._refundTotalAbs = refundedAbs;
      t._remainingAfterRefund = remaining;

      // ✅ devuelto al 100% (tolerancia céntimos)
      t._isFullyRefunded = remaining <= 0.009;
    } else {
      t._refunds = [];
      t._hasPartialRefund = false;
      t._refundCount = 0;
      t._refundTotalAbs = 0;
      t._remainingAfterRefund = null;
      t._isFullyRefunded = false;
    }
  }

  return tickets;
}

function hideRefundedOriginals(rows) {
  const list = Array.isArray(rows) ? rows : [];

  // Índice de devoluciones por id original
  const refundIdx = buildRefundIndex(list);

  // Creamos salida: rectificativas siempre + originales sólo si queda pendiente
  const out = [];

  for (const r of list) {
    const raw = r._raw || {};
    const id = Number(r.idfactura || raw.idfactura || 0);
    const idOriginal = Number(r.idfacturarect || raw.idfacturarect || 0);
    const isRectificativa = idOriginal > 0;

    if (isRectificativa) {
      // La rectificativa SIEMPRE se muestra (en rojo ya la pintas)
      out.push(r);
      continue;
    }

    // Es original: calcular cuánto queda pendiente
    const originalTotal = Number(r.total ?? raw.total ?? 0);
    const ref = refundIdx.get(id);

    if (!ref) {
      // No tiene devoluciones -> se muestra normal
      out.push(r);
      continue;
    }

    const pending = round2(originalTotal - ref.refundedAbsTotal);

    // Si pendiente <= 0 => devolución total -> ocultar original
    if (pending <= 0.001) {
      continue;
    }

    // Si pendiente > 0 => devolución parcial -> mostramos original pero con total pendiente
    out.push({
      ...r,
      total: pending,
      _pendingTotal: pending,
      _hasPartialRefund: true,
    });
  }

  return out;
}

// Devuelve un Map: idOriginal -> { refundedAbsTotal, rects: [] }
function buildRefundIndex(list) {
  const idx = new Map();

  (Array.isArray(list) ? list : []).forEach((r) => {
    const raw = r._raw || r;
    const idOriginal = Number(r.idfacturarect || raw.idfacturarect || 0);
    if (!(idOriginal > 0)) return; // solo rectificativas

    const total = Number(r.total ?? raw.total ?? 0);
    const refundedAbs = Math.abs(total);

    const entry = idx.get(idOriginal) || { refundedAbsTotal: 0, rects: [] };
    entry.refundedAbsTotal += refundedAbs;
    entry.rects.push(r);
    idx.set(idOriginal, entry);
  });

  return idx;
}

async function fetchLineasFactura(idfactura) {
  // 1) Intento A: filtro tipo FS
  try {
    const data = await fetchApiResourceWithParams("lineafacturaclientes", {
      "filter[idfactura]": idfactura,
      limit: 2000,
    });
    if (Array.isArray(data) && data.length) return data;
  } catch (e) {
    // seguimos al fallback
  }

  // 2) Intento B: query simple
  try {
    const data = await fetchApiResourceWithParams("lineafacturaclientes", {
      idfactura,
      limit: 2000,
    });
    if (Array.isArray(data) && data.length) return data;
  } catch (e) {
    // seguimos al fallback
  }

  // 3) Fallback: traemos muchas y filtramos (no ideal, pero funciona)
  const data = await fetchApiResourceWithParams("lineafacturaclientes", {
    limit: 5000,
  });
  const list = Array.isArray(data) ? data : [];
  return list.filter((l) => Number(l.idfactura) === Number(idfactura));
}

function lineKeyForMatch(desc, pvpunitario, codimpuesto) {
  const d = normalizeRefundDesc(desc).toLowerCase();
  const p = Number(pvpunitario || 0).toFixed(6); // precisión estable
  const c = String(codimpuesto || "")
    .trim()
    .toUpperCase();
  return `${d}__${p}__${c}`;
}

async function fetchRectificativasDeFacturaOriginal(idfacturaOriginal) {
  // Trae facturas rectificativas que apuntan a este original
  const rows = await fetchApiResourceWithParams("facturaclientes", {
    "filter[codserie]": "R",
    "filter[idfacturarect]": idfacturaOriginal,
    limit: 200,
    "sort[idfactura]": "DESC",
  });

  return Array.isArray(rows) ? rows : [];
}

async function buildRefundedQtyMapForOriginal(idfacturaOriginal) {
  // Trae facturas rectificativas que apuntan a este original
  const rects = await fetchRectificativasDeFacturaOriginal(idfacturaOriginal);

  const refunded = {}; // key -> qty devuelta (siempre en positivo)

  for (const r of rects || []) {
    const rid = Number(r?.idfactura || 0);
    if (!rid) continue;

    const lines = await fetchLineasFactura(rid);

    for (const l of lines || []) {
      const key = lineKeyForMatch(
        normalizeRefundDesc
          ? normalizeRefundDesc(l.descripcion)
          : l.descripcion,
        l.pvpunitario,
        l.codimpuesto,
      );

      const q = Math.abs(Number(l.cantidad || 0));
      if (!(q > 0)) continue;

      refunded[key] = (refunded[key] || 0) + q;
    }
  }

  return refunded;
}

function askEmailWithModal() {
  return new Promise((resolve) => {
    // ✅ Buscar DOM SIEMPRE aquí (no usar variables globales cacheadas)
    const emailOverlay = document.getElementById("emailOverlay");
    const emailInput = document.getElementById("emailInput");
    const emailOkBtn = document.getElementById("emailOkBtn");
    const emailCancelBtn = document.getElementById("emailCancelBtn");
    const emailError = document.getElementById("emailError");
    const emailKeyboardBtn = document.getElementById("emailKeyboardBtn");

    // ✅ Si faltan elementos, NO usamos prompt en Electron: mostramos mensaje claro
    if (!emailOverlay || !emailInput || !emailOkBtn || !emailCancelBtn) {
      console.error(
        "Falta el HTML del modal de email (#emailOverlay, #emailInput, #emailOkBtn, #emailCancelBtn).",
      );
      toast?.(
        "Falta el modal de email en el HTML. No puedo pedir el email.",
        "err",
        "Activación",
      );
      resolve("");
      return;
    }

    const isValidEmailFormat = (email) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email || "").trim().toLowerCase());

    const updateValidation = () => {
      const val = (emailInput.value || "").trim();
      const ok = isValidEmailFormat(val);
      emailOkBtn.disabled = !ok;

      if (emailError) {
        if (!val) emailError.textContent = "";
        else
          emailError.textContent = ok
            ? ""
            : "Email no válido (ej: nombre@dominio.com)";
      }
    };

    if (emailError) emailError.textContent = "";
    emailInput.value = "";
    emailOkBtn.disabled = true;

    emailOverlay.classList.remove("hidden");
    emailInput.focus();

    emailInput.addEventListener("input", updateValidation);
    updateValidation();

    if (emailKeyboardBtn) {
      emailKeyboardBtn.onclick = () => {
        openQwertyForInput(emailInput, "email");
      };
    }

    const cleanup = () => {
      emailOkBtn.onclick = null;
      emailCancelBtn.onclick = null;
      emailInput.onkeydown = null;
      emailInput.removeEventListener("input", updateValidation);
    };

    emailCancelBtn.onclick = () => {
      cleanup();
      emailOverlay.classList.add("hidden");
      resolve("");
    };

    emailOkBtn.onclick = () => {
      const val = (emailInput.value || "").trim();
      if (!isValidEmailFormat(val)) {
        updateValidation();
        return;
      }
      cleanup();
      emailOverlay.classList.add("hidden");
      resolve(val);
    };

    emailInput.onkeydown = (e) => {
      if (e.key === "Enter") emailOkBtn.click();
      if (e.key === "Escape") emailCancelBtn.click();
    };
  });
}

// --- Teclados para el modal de movimientos ---
const cashMoveAmountInput = document.getElementById("cashMoveAmount");
const cashMoveReasonInput = document.getElementById("cashMoveReason");
const cashMoveAmountKeyboardBtn = document.getElementById(
  "cashMoveAmountKeyboardBtn",
);
const cashMoveReasonKeyboardBtn = document.getElementById(
  "cashMoveReasonKeyboardBtn",
);

// Teclado numérico para cantidad
if (cashMoveAmountKeyboardBtn && cashMoveAmountInput) {
  cashMoveAmountKeyboardBtn.onclick = () => {
    const initial = cashMoveAmountInput.value
      ? Number(cashMoveAmountInput.value.replace(",", "."))
      : 0;

    openNumPad(
      initial.toString(),
      (val) => {
        // formatear a 2 decimales en el input
        cashMoveAmountInput.value = Number(val).toFixed(2);
      },
      "Movimiento de caja",
      "cash",
    );
  };
}

// Teclado QWERTY para motivo
if (cashMoveReasonKeyboardBtn && cashMoveReasonInput) {
  cashMoveReasonKeyboardBtn.onclick = () => {
    openQwertyForInput(cashMoveReasonInput, "text");
  };
}

function buildTicketFromFacturaRow(facturaRow, lineasFactura) {
  const mapped = (lineasFactura || []).map((l) => {
    const taxRate = extractTaxRateFromCode(l.codimpuesto);
    const unitNet = Number(l.pvpunitario || 0);
    const unitGross = unitNet * (1 + taxRate / 100);

    return {
      name: l.descripcion || "Producto",
      qty: Number(l.cantidad || 0),
      price: unitNet, // neto
      grossPrice: unitGross, // bruto
      codimpuesto: l.codimpuesto || null,
      taxRate,
    };
  });

  return {
    numero:
      facturaRow.codigo || facturaRow.numero || String(facturaRow.idfactura),
    fecha: facturaRow.fecha || "",
    hora: facturaRow.hora || "",
    paymentMethod: facturaRow.codpago || "—",
    clientName: facturaRow.nombrecliente || "Cliente",
    terminalName: currentTerminal
      ? currentTerminal.name
      : `TPV ${facturaRow.idtpv || "—"}`,
    agentName: currentAgent ? currentAgent.name : facturaRow.codagente || "—",
    company: companyInfo ? { ...companyInfo } : null,
    lineas: mapped,
    total: Number(facturaRow.total || 0),
  };
}

async function fetchPagosFacturaByCodigo(codigofactura) {
  const code = String(codigofactura || "").trim();
  if (!code) return [];

  try {
    const rows = await fetchApiResourceWithParams("reciboclientes", {
      "filter[codigofactura]": code,
      limit: 2000,
      "sort[idrecibo]": "ASC",
    });

    const list = Array.isArray(rows) ? rows : [];

    // Nos quedamos con {codpago, importe}
    // y agrupamos por codpago por si hay varios recibos del mismo método
    const grouped = {};
    for (const r of list) {
      const cod = String(r.codpago || "").trim() || "—";
      const imp = Number(r.importe ?? 0) || 0;
      if (!imp) continue;
      grouped[cod] = (grouped[cod] || 0) + imp;
    }

    return Object.entries(grouped).map(([codpago, importe]) => ({
      codpago,
      importe,
    }));
  } catch (e) {
    console.warn("[fetchPagosFacturaByCodigo] error:", e?.message || e);
    return [];
  }
}

async function imprimirFacturaHistorica(facturaRow) {
  const id = Number(facturaRow?.idfactura || 0);
  if (!id) throw new Error("Factura sin idfactura.");

  // ✅ LÍNEAS REALES FS
  const lineasFs = await fetchLineasFacturaCliente(id);

  // ✅ Convertidas a tu formato TPV para no romper diseño
  const lineasTpv = (Array.isArray(lineasFs) ? lineasFs : []).map(
    mapFsLineToTpvPrintLine,
  );

  // Tu builder base (cabecera + totales + datos generales)
  // OJO: le pasamos lineasTpv (no FS raw)
  const ticketBase = buildTicketFromFacturaRow(facturaRow, lineasTpv) || {};
  const raw = facturaRow?._raw || facturaRow || {};

  const codigo = String(
    raw.codigo || facturaRow?.codigo || ticketBase?.numero || "",
  ).trim();

  // Pagos
  let pagos = await fetchPagosFacturaByCodigo(codigo);

  if (!Array.isArray(pagos) || !pagos.length) {
    const cod = String(
      raw.codpago || facturaRow?.codpago || ticketBase.paymentMethod || "—",
    ).trim();
    pagos = [
      {
        codpago: cod,
        importe: Number(
          raw.total ?? facturaRow?.total ?? ticketBase.total ?? 0,
        ),
      },
    ];
  }

  const ticket = {
    ...ticketBase,
    idfactura: id,
    idfacturarect: Number(raw.idfacturarect || facturaRow?.idfacturarect || 0),

    // ✅ IMPORTANTE: estas son las que usará tu diseño
    lineas: lineasTpv,

    _raw: raw,
    pagos,
  };

  const ticketReady = preparePrintableTicket(ticket);
  await printTicket(ticketReady);
}

function preparePrintableTicket(ticket) {
  const lineas0 = Array.isArray(ticket?.lineas) ? [...ticket.lineas] : [];
  if (!lineas0.length) return ticket;

  const isZero = (n) => Math.abs(Number(n || 0)) < 0.00001;

  const cleanSpecialPrefix = (s) =>
    String(s || "")
      .replace(/^AJUSTE PAGO\s*-\s*/i, "")
      .replace(/^DEV\s*-\s*/i, "")
      .trim();

  const norm = (s) =>
    cleanSpecialPrefix(s).toUpperCase().replace(/\s+/g, " ").trim();

  const isPackParent = (l) => {
    if (l?.meta?.isPackOffer) return true;
    if (l?.__isPackParent) return true;

    const pid = Number(l?.idproducto || 0);
    return pid && typeof isOfferPackProductById === "function"
      ? isOfferPackProductById(pid)
      : false;
  };

  const getPackDef = (parentIdProducto) => {
    const pack = PACKS_STATE?.packsByOfferProductId?.get(
      Number(parentIdProducto),
    );
    if (!pack) return [];

    const lines = PACKS_STATE?.linesByPackId?.get(pack.id) || [];
    return lines
      .map((x) => ({
        ref: String(x.reference || "").trim(),
        qty: Number(x.quantity || 1) || 1,
      }))
      .filter((x) => x.ref);
  };

  const pickRefNorm = (l) => {
    const r = norm(l?.referencia);
    if (r) return r;
    return norm(l?.descripcion);
  };

  const parents = lineas0.filter(isPackParent);
  if (!parents.length) {
    return {
      ...ticket,
      lineas: lineas0.map((l) => ({
        ...l,
        descripcion: cleanSpecialPrefix(l.descripcion),
      })),
    };
  }

  const parentDefs = new Map(); // parentPid -> defs
  const allExpectedRefs = new Set();

  for (const p of parents) {
    const pid = Number(p?.idproducto || 0);
    const defs = getPackDef(pid);
    parentDefs.set(pid, defs);
    for (const d of defs) {
      const r = norm(d.ref);
      if (r) allExpectedRefs.add(r);
    }
  }

  // Hijos reales de FS: 0€, no parent, y parecen pertenecer a un pack
  const realChildren = lineas0.filter((l) => {
    if (isPackParent(l)) return false;
    if (!isZero(l?.pvpunitario)) return false;

    const refNorm = pickRefNorm(l);
    return refNorm && allExpectedRefs.has(refNorm);
  });

  // Líneas normales no-pack
  const normalLines = lineas0.filter((l) => {
    if (isPackParent(l)) return false;

    const isRealChild = realChildren.includes(l);
    return !isRealChild;
  });

  // Índice de hijos reales por ref normalizada
  const childByRef = new Map();
  for (const ch of realChildren) {
    const refNorm = pickRefNorm(ch);
    if (!refNorm) continue;

    if (!childByRef.has(refNorm)) childByRef.set(refNorm, []);
    childByRef.get(refNorm).push(ch);
  }

  const byOrder = (a, b) =>
    Number(a?.orden ?? a?.idlinea ?? 0) - Number(b?.orden ?? b?.idlinea ?? 0);

  const parentsSorted = [...parents].sort(byOrder);
  const normalsSorted = [...normalLines].sort(byOrder);

  const out = [];
  const usedChildIds = new Set();

  for (const parent of parentsSorted) {
    const parentPid = Number(parent?.idproducto || 0);
    const defs = parentDefs.get(parentPid) || [];

    out.push({
      ...parent,
      descripcion: cleanSpecialPrefix(parent.descripcion),
      __isPackParent: true,
      __isPackChild: false,
    });

    // Meter debajo los hijos reales del ticket
    for (const d of defs) {
      const refNorm = norm(d.ref);
      const group = childByRef.get(refNorm) || [];

      for (const ch of group) {
        const chId = Number(ch?.idlinea || 0);
        if (chId && usedChildIds.has(chId)) continue;
        if (chId) usedChildIds.add(chId);

        out.push({
          ...ch,
          referencia: cleanSpecialPrefix(ch.referencia || d.ref || ""),
          descripcion: cleanSpecialPrefix(ch.descripcion || d.ref || ""),
          __isPackParent: false,
          __isPackChild: true,
          __forceUnitGross: 0,
          __lineTotalOverride: 0,
        });
      }
    }
  }

  // Añadir resto de líneas normales
  for (const l of normalsSorted) {
    out.push({
      ...l,
      descripcion: cleanSpecialPrefix(l.descripcion),
      __isPackParent: false,
      __isPackChild: false,
    });
  }

  return { ...ticket, lineas: out };
}

function lineTaxRate(l) {
  // si viene "iva": 10, úsalo; si no, saca de codimpuesto
  const iva = Number(l.iva);
  if (!isNaN(iva) && iva > 0) return iva;
  return extractTaxRateFromCode(l.codimpuesto);
}
function lineGrossUnit(l) {
  const net = Number(l.pvpunitario || 0);
  const tax = lineTaxRate(l);
  return net * (1 + tax / 100);
}

let refundState = {
  factura: null,
  lineas: [],
  qtyByLineId: {}, // { idlinea: qtyDevolver }
};

function eurES(n) {
  return (Number(n) || 0).toFixed(2).replace(".", ",") + " €";
}

function formatRefundOriginalPayments(recibos) {
  const list = Array.isArray(recibos) ? recibos : [];
  if (!list.length) return [];

  const grouped = {};
  list.forEach((r) => {
    const code =
      String(r?.codpago || "—")
        .trim()
        .toUpperCase() || "—";

    const amount = Number(r?.importe || 0) || 0;
    if (!(amount > 0)) return;

    grouped[code] = (grouped[code] || 0) + amount;
  });

  const labelMap = window.__PAYMETHOD_LABELS__ || {};

  return Object.entries(grouped)
    .map(([code, amount]) => ({
      code,
      label: labelMap[code] || code,
      amount,
    }))
    .sort((a, b) =>
      String(a.label || a.code).localeCompare(String(b.label || b.code), "es", {
        sensitivity: "base",
      }),
    );
}

function renderRefundPaymentInfo(recibos) {
  const wrap = document.getElementById("refundPaymentInfoInlineWrap");
  const box = document.getElementById("refundPaymentInfoInline");
  if (!wrap || !box) return;

  const rows = formatRefundOriginalPayments(recibos);

  if (!rows.length) {
    wrap.style.display = "none";
    box.textContent = "";
    return;
  }

  wrap.style.display = "block";
  box.textContent = rows
    .map((r) => `${r.label}: ${eurES(r.amount)}`)
    .join("   ·   ");
}

function renderRefundLines() {
  const wrap = document.getElementById("refundLines");
  if (!wrap) return;

  wrap.innerHTML = "";

  const getRefundLineDisplayName = (line) => {
    const clean = (v) =>
      String(v || "")
        .replace(/^DEV\s*-\s*/i, "")
        .trim();

    const normalizeCompare = (v) => clean(v).toUpperCase().replace(/\s+/g, " ");

    const ref = clean(line?.referencia);
    const desc = clean(line?.descripcion);
    const nombre = clean(line?.nombre);

    const isValid = (s) => !!s && s !== "-" && s !== "—";

    const refOk = isValid(ref);
    const descOk = isValid(desc);
    const nombreOk = isValid(nombre);

    if (refOk && descOk && normalizeCompare(ref) === normalizeCompare(desc)) {
      return ref;
    }

    if (refOk && descOk) return `${ref} - ${desc}`;
    if (refOk) return ref;
    if (descOk) return desc;
    if (nombreOk) return nombre;

    return "Producto";
  };

  const buildOriginalPaymentInfoInline = () => {
    const recibos = Array.isArray(refundState.recibosOriginales)
      ? refundState.recibosOriginales
      : [];

    if (!recibos.length) return "";

    const grouped = {};
    recibos.forEach((r) => {
      const code =
        String(r?.codpago || "—")
          .trim()
          .toUpperCase() || "—";

      const amount = Number(r?.importe || 0) || 0;
      if (!(amount > 0)) return;

      grouped[code] = (grouped[code] || 0) + amount;
    });

    const labelMap = window.__PAYMETHOD_LABELS__ || {};

    const parts = Object.entries(grouped)
      .map(([code, amount]) => {
        const label = labelMap[code] || code;
        return `${label}: ${eurES(amount)}`;
      })
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

    return parts.join("   ");
  };

  const paymentInfoText = buildOriginalPaymentInfoInline();

  refundState.lineas.forEach((l) => {
    const max = Number(
      l._remainingQty != null ? l._remainingQty : l.cantidad || 0,
    );
    const id = Number(l.idlinea);
    const curr = Number(refundState.qtyByLineId[id] || 0);

    const unitGross = lineGrossUnit(l);
    const tax = lineTaxRate(l);
    const displayName = getRefundLineDisplayName(l);

    const paymentInfoHtml = paymentInfoText
      ? `
        <div style="margin-top:6px; font-size:13px; color:#475569; padding-left:4px;">
          ${escapeHtml(paymentInfoText)}
        </div>
      `
      : "";

    const row = document.createElement("div");
    row.style.cssText =
      "display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid #eee;";

    row.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHtml(displayName)}
        </div>
        <div style="font-size:12px; opacity:.8;">
          Vendido: ${max} · ${eurES(unitGross)} / ud · IVA ${tax}%
        </div>
        ${paymentInfoHtml}
      </div>

      <div style="display:flex; align-items:center; gap:6px;">
        <button type="button" class="cart-btn" data-a="minus" data-id="${id}">-</button>
        <div style="min-width:34px; text-align:center; font-weight:700;">${curr}</div>
        <button type="button" class="cart-btn" data-a="plus" data-id="${id}">+</button>
      </div>

      <div style="width:110px; text-align:right; font-weight:700;">
        ${eurES(unitGross * curr)}
      </div>
    `;

    wrap.appendChild(row);
  });

  updateRefundAmount();
}

function updateRefundAmount() {
  const el = document.getElementById("refundAmount");
  if (!el) return;

  let total = 0;
  refundState.lineas.forEach((l) => {
    const id = Number(l.idlinea);
    const q = Number(refundState.qtyByLineId[id] || 0);
    total += lineGrossUnit(l) * q;
  });

  el.textContent = eurES(total);
}

function bindRefundLineClicks() {
  const wrap = document.getElementById("refundLines");
  if (!wrap) return;

  wrap.onclick = (e) => {
    const btn = e.target.closest("button[data-a]");
    if (!btn) return;

    const id = Number(btn.dataset.id);
    const action = btn.dataset.a;

    const line = refundState.lineas.find((x) => Number(x.idlinea) === id);
    if (!line) return;

    const max = Number(
      line.__pendingQty != null ? line.__pendingQty : line.cantidad || 0,
    );
    let curr = Number(refundState.qtyByLineId[id] || 0);

    if (action === "plus") curr += 1;
    if (action === "minus") curr -= 1;

    if (curr < 0) curr = 0;
    if (curr > max) curr = max;

    refundState.qtyByLineId[id] = curr;
    renderRefundLines();
  };
}

function getLineDisplayNameForLog(line) {
  const clean = (v) =>
    String(v || "")
      .replace(/^DEV\s*-\s*/i, "")
      .trim();

  const normalizeCompare = (v) => clean(v).toUpperCase().replace(/\s+/g, " ");

  const ref = clean(line?.referencia);
  const desc = clean(line?.descripcion);
  const nombre = clean(line?.nombre);

  const isValid = (s) => !!s && s !== "-" && s !== "—";

  const refOk = isValid(ref);
  const descOk = isValid(desc);
  const nombreOk = isValid(nombre);

  // Si referencia y descripción son iguales, mostrar solo una
  if (refOk && descOk && normalizeCompare(ref) === normalizeCompare(desc)) {
    return ref;
  }

  if (refOk && descOk) return `${ref} - ${desc}`;
  if (refOk) return ref;
  if (descOk) return desc;
  if (nombreOk) return nombre;

  return "Producto";
}

function refundSelectAll() {
  refundState.lineas.forEach((line) => {
    const max = Number(
      line.__pendingQty != null ? line.__pendingQty : line.cantidad || 0,
    );
    refundState.qtyByLineId[Number(line.idlinea)] = max;
  });
  renderRefundLines();
}

function refundSelectNone() {
  refundState.qtyByLineId = {};
  renderRefundLines();
}

async function openRefundForFactura(facturaRow) {
  const ok = await confirmModal(
    "Atención",
    "Al confirmar la devolución se comunicará a gerencia.\n\n¿Deseas continuar?",
  );
  if (!ok) return;

  const overlay = document.getElementById("refundOverlay");
  if (!overlay) {
    toast("Falta #refundOverlay en el HTML.", "err", "Devolución");
    return;
  }

  // ✅ IMPORTANTE: traer líneas reales de FS (incluye 0€)
  const lineasAll = await fetchLineasFactura(facturaRow.idfactura);

  // ✅ NUEVO: traer recibos reales del ticket (información para el trabajador)
  let recibosOriginales = [];
  try {
    recibosOriginales = await fetchRecibosByFactura(facturaRow.idfactura);
  } catch (e) {
    console.warn("No se pudieron leer recibos del ticket:", e?.message || e);
    recibosOriginales = [];
  }

  // Map cantidades ya devueltas (por clave consistente)
  let refundedMap = {};
  try {
    refundedMap = await buildRefundedQtyMapForOriginal(facturaRow.idfactura);
  } catch (e) {
    console.warn("No se pudo calcular devoluciones previas:", e?.message || e);
    refundedMap = {};
  }

  // Pendientes (para TODAS las líneas)
  const lineasPendientesAll = (lineasAll || [])
    .map((l) => {
      const key = lineKeyForMatch(
        normalizeRefundDesc(l.descripcion),
        l.pvpunitario,
        l.codimpuesto,
      );

      const sold = Number(l.cantidad || 0);
      const already = Number(refundedMap[key] || 0);
      const pending = Math.max(0, sold - already);

      return {
        ...l,
        _remainingQty: pending,
        __pendingQty: pending,
        __alreadyRefunded: already,
      };
    })
    .filter((l) => Number(l._remainingQty || 0) > 0);

  // ✅ UI: ocultamos 0€ (pero NO las perdemos, quedan en lineasAll)
  const lineasUI = lineasPendientesAll.filter((l) => {
    const u = Number(lineGrossUnit(l) || 0);
    return u > 0.00001;
  });

  refundState.factura = facturaRow;
  refundState.lineas = lineasUI;
  refundState.lineasAll = lineasPendientesAll;
  refundState.qtyByLineId = {};
  refundState.recibosOriginales = Array.isArray(recibosOriginales)
    ? recibosOriginales
    : [];

  // Cabecera
  const n = document.getElementById("refundTicketNum");
  const c = document.getElementById("refundClient");
  const t = document.getElementById("refundTicketTotal");

  if (n) n.textContent = facturaRow.codigo || `#${facturaRow.idfactura}`;
  if (c) c.textContent = facturaRow.nombrecliente || "Cliente";
  if (t) t.textContent = eurES(facturaRow.total || 0);

  overlay.classList.remove("hidden");
  bindRefundLineClicks();
  renderRefundLines();

  // Botones
  const x = document.getElementById("refundCloseX");
  const cancel = document.getElementById("refundCancelBtn");
  const all = document.getElementById("refundSelectAllBtn");
  const none = document.getElementById("refundSelectNoneBtn");

  if (x) x.onclick = () => overlay.classList.add("hidden");
  if (cancel) cancel.onclick = () => overlay.classList.add("hidden");
  if (all) all.onclick = refundSelectAll;
  if (none) none.onclick = refundSelectNone;

  const confirmBtn = document.getElementById("refundConfirmBtn");
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      try {
        confirmBtn.disabled = true;

        await createRefundInFacturaScriptsPackAware(
          facturaRow,
          refundState.qtyByLineId,
          refundState.lineas,
          refundState.lineasAll,
        );

        toast("Devolución creada ✅", "ok", "Devolución");
        overlay.classList.add("hidden");
        await loadAndRenderTickets();
      } catch (e) {
        console.error(e);
        toast("Error en devolución: " + (e?.message || e), "err", "Devolución");
      } finally {
        confirmBtn.disabled = false;
      }
    };
  }
}

async function createRefundInFacturaScriptsPackAware(
  facturaRow,
  qtyByLineId,
  uiLines,
  allLines, // líneas reales del ORIGINAL (incluye 0€ ya parcheadas)
) {
  const originalId = Number(facturaRow?.idfactura || 0);
  if (!originalId) throw new Error("Factura original inválida.");

  const idtpv = Number(currentTerminal?.id || 0) || null;
  const idcaja = getCajaIdSafe?.() || null;
  const nick = (getLoginUser?.() || currentAgent?.nick || "TPV").toString();

  if (!idtpv || !idcaja) {
    throw new Error("No hay caja abierta (idtpv/idcaja).");
  }

  const codcliente =
    facturaRow?._raw?.codcliente ||
    facturaRow?.codcliente ||
    window.RECIPOK_API?.defaultCodClienteTPV ||
    "1";

  const codpagoOrig = String(
    facturaRow?._raw?.codpago || facturaRow?.codpago || "",
  )
    .trim()
    .toUpperCase();

  const isZero = (n) => Math.abs(Number(n || 0)) < 0.00001;

  const isPackParent = (l) => {
    const pid = Number(l?.idproducto || 0);
    return pid && typeof isOfferPackProductById === "function"
      ? isOfferPackProductById(pid)
      : false;
  };

  try {
    if (!PACKS_STATE?.ready && typeof warmupPacksData === "function") {
      await warmupPacksData();
    }
  } catch {}

  const norm = (s) =>
    String(s || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");

  const getPackDefRefSet = (parentIdProducto) => {
    const pack = PACKS_STATE?.packsByOfferProductId?.get(
      Number(parentIdProducto),
    );
    if (!pack) return null;

    const lines = PACKS_STATE?.linesByPackId?.get(pack.id) || [];
    const refs = (lines || []).map((x) => norm(x.reference)).filter(Boolean);
    return refs.length ? new Set(refs) : null;
  };

  // =========================================================
  // 1) Líneas seleccionadas en UI
  // =========================================================
  const selected = [];

  for (const l of uiLines || []) {
    const idlinea = Number(l?.idlinea || 0);
    if (!idlinea) continue;

    const q = Number(qtyByLineId?.[idlinea] || 0);
    if (q > 0) selected.push({ line: l, qty: q });
  }

  if (!selected.length) {
    throw new Error("No has seleccionado ninguna línea.");
  }

  // =========================================================
  // 2) Crear líneas de rectificativa (solo seleccionadas)
  // =========================================================
  const outLines = [];

  for (const sel of selected) {
    const l = sel.line;
    const refundQty = Number(sel.qty || 0);
    if (!(refundQty > 0)) continue;

    const baseDesc = String(l.descripcion || "")
      .replace(/^DEV\s*-\s*/i, "")
      .trim();

    outLines.push({
      referencia: l.referencia || "",
      descripcion: baseDesc ? `DEV - ${baseDesc}` : "DEV",
      cantidad: -refundQty,
      pvpunitario: Number(l.pvpunitario || 0),
      idproducto: Number(l.idproducto || 0) || undefined,
      ...(l.codimpuesto ? { codimpuesto: l.codimpuesto } : {}),
    });
  }

  if (!outLines.length) {
    throw new Error("No se pudo construir la devolución.");
  }

  const numero2 = `REFUND|ORIG=${originalId}`;

  const payloadRect = {
    codcliente,
    lineas: outLines,
    pagada: 1,
    codpago: codpagoOrig || null, // temporal, luego rehacemos recibos
    serie: "R",
    idtpv,
    idcaja,
    nick,
    numero2,
  };

  const respRect = await createTicketInFacturaScripts(payloadRect);

  const docRect =
    respRect?.doc || respRect?.factura || respRect?.data || respRect || null;

  const rectId = Number(docRect?.idfactura || docRect?.id || 0);
  if (!rectId) {
    throw new Error("No pude crear la rectificativa.");
  }

  // =========================================================
  // 3) PATCH packs en líneas hijas gratis
  // =========================================================
  try {
    const desiredByPid = {}; // pid -> qty NEGATIVA

    for (const sel of selected) {
      const parent = sel.line;
      if (!isPackParent(parent)) continue;

      const refundParentQty = Number(sel.qty || 0);
      const parentQtySold = Number(parent.cantidad || 0);

      if (!(refundParentQty > 0) || !(parentQtySold > 0)) continue;

      const defRefSet = getPackDefRefSet(parent.idproducto);
      if (!defRefSet || !defRefSet.size) continue;

      const children = (allLines || []).filter((x) => {
        if (isPackParent(x)) return false;
        if (!isZero(x?.pvpunitario)) return false;

        const pid = Number(x?.idproducto || 0);
        if (!pid) return false;

        const r = norm(x?.referencia);
        const d = norm(x?.descripcion);

        if (r && defRefSet.has(r)) return true;
        for (const rr of defRefSet) {
          if (rr && d.includes(rr)) return true;
        }
        return false;
      });

      const totalsByPid = {};

      for (const ch of children) {
        const pid = Number(ch?.idproducto || 0);
        if (!pid) continue;

        const q = Number(ch?.cantidad || 0);
        if (!isFinite(q) || q === 0) continue;

        totalsByPid[pid] = (totalsByPid[pid] || 0) + q;
      }

      for (const [pidStr, totalQtyOriginal] of Object.entries(totalsByPid)) {
        const pid = Number(pidStr);
        const totalQty = Number(totalQtyOriginal || 0);
        if (!(totalQty > 0)) continue;

        const perPack = totalQty / parentQtySold;
        const childRefundQty = Math.round(perPack * refundParentQty);
        if (!(childRefundQty > 0)) continue;

        desiredByPid[pid] = (desiredByPid[pid] || 0) - childRefundQty;
      }
    }

    if (Object.keys(desiredByPid).length) {
      await patchPackChildrenLinesInFacturaByDesired({
        idfactura: rectId,
        desiredByPid,
      });
    }
  } catch (e) {
    console.warn(
      "No pude parchear hijos pack en rectificativa:",
      e?.message || e,
    );
  }

  // =========================================================
  // 4) Repartir devolución por métodos según recibos originales
  // =========================================================
  const totalRectAbs = Math.abs(Number(docRect?.total || 0));

  const refundBreakdown = await buildRefundBreakdownFromOriginalFactura(
    originalId,
    totalRectAbs,
    codpagoOrig,
  );

  const cashRefundAbs = refundBreakdown
    .filter((x) => isCashCodpago?.(x.codpago))
    .reduce((s, x) => s + Math.abs(Number(x.importe || 0)), 0);

  const primaryRefundCodpago = refundBreakdown[0]?.codpago || codpagoOrig || "";

  // =========================================================
  // 5) Actualizar rectificativa
  // =========================================================
  await updateFacturaCliente(rectId, {
    idtpv: String(idtpv),
    idcaja: Number(idcaja),
    nick,
    codalmacen: currentTerminal?.codalmacen || "",

    tpv_venta: 1,
    tpv_efectivo: -Number(cashRefundAbs.toFixed(2)), // 👈 solo parte en efectivo
    tpv_cambio: 0,

    idestado: 11,
    pagada: 1,
    codpago: primaryRefundCodpago,

    codserie: "R",
    idfacturarect: originalId,
    codigorect: facturaRow?.codigo || facturaRow?._raw?.codigo || "",
    numero2,

    ...(currentAgent?.codagente ? { codagente: currentAgent.codagente } : {}),
  });

  // ✅ NUEVO: si la venta original era mixta, reescribimos los recibos
  // de la rectificativa para que el reparto por método quede correcto
  try {
    const refundDate = new Date().toISOString().slice(0, 10);
    const refundTotalAbs = Math.abs(Number(docRect?.total || 0));

    await rewriteRefundRecibosFromOriginalMix({
      originalIdfactura: originalId,
      refundIdfactura: rectId,
      refundTotalAbs,
      codcliente,
      idempresa:
        docRect?.idempresa ||
        facturaRow?._raw?.idempresa ||
        facturaRow?.idempresa ||
        1,
      coddivisa:
        docRect?.coddivisa ||
        facturaRow?._raw?.coddivisa ||
        facturaRow?.coddivisa ||
        "EUR",
      codigofactura: docRect?.codigo || docRect?.codigofactura || `#${rectId}`,
      fecha: refundDate,
      fallbackCodpago: codpagoOrig || facturaRow?.codpago || "CONT",
    });
  } catch (e) {
    console.warn(
      "No pude rehacer recibos mixtos en rectificativa:",
      e?.message || e,
    );
  }

  // =========================================================
  // 6) Rehacer recibos de la rectificativa con el reparto correcto
  // =========================================================
  try {
    await replaceFacturaRecibosWithBreakdown(rectId, refundBreakdown);
  } catch (e) {
    console.warn(
      "No pude rehacer recibos de la rectificativa:",
      e?.message || e,
    );
  }

  // =========================================================
  // 7) Log de caja con detalle real del reparto
  // =========================================================
  try {
    const ctx = getLogCtx?.() || {};

    const rectCode =
      String(docRect?.codigo || docRect?.codigoFactura || "").trim() ||
      `#${rectId}`;

    const origCode =
      String(facturaRow?.codigo || facturaRow?._raw?.codigo || "").trim() ||
      `#${originalId}`;

    const devueltoTxt = totalRectAbs.toFixed(2).replace(".", ",") + "€";

    const productos = [];
    for (const l of uiLines || []) {
      const id = Number(l.idlinea);
      const q = Number(qtyByLineId?.[id] || 0);
      if (!(q > 0)) continue;

      const ref = String(l.referencia || "").trim();
      const desc = String(l.descripcion || "")
        .replace(/^DEV\s*-\s*/i, "")
        .trim();

      let label = desc || ref || "Producto";
      if (ref && desc && ref.toUpperCase() !== desc.toUpperCase()) {
        label = `${ref} - ${desc}`;
      }

      productos.push(`${q}x ${label}`);
    }

    const breakdownTxt = refundBreakdown
      .map((x) => {
        const imp = Math.abs(Number(x.importe || 0))
          .toFixed(2)
          .replace(".", ",");
        return `${x.codpago}:${imp}€`;
      })
      .join(" | ");

    const line = buildCajaLogLineWith(
      ctx,
      `DEVOLUCIÓN CONFIRMADA : ${rectCode}`,
      `Ticket Original:${origCode} | Devuelto: ${devueltoTxt} | Reparto:${breakdownTxt || "—"} | Productos:${productos.join(", ") || "—"}`,
    );

    await appendCajaAutoLogLineForId(idcaja, line);
  } catch (e) {
    console.warn("No pude loguear devolución:", e?.message || e);
  }

  return {
    rectId,
    refundBreakdown,
  };
}

async function doLogoutFlow() {
  const ok = await confirmModal(
    "Cambiar usuario",
    "Se cerrará la sesión actual para poder elegir otro usuario.",
  );
  if (!ok) return;

  // 1) Borrar sesión runtime
  try {
    clearLoginSession();
  } catch {}

  try {
    localStorage.removeItem("tpv_login_user");
    localStorage.removeItem("tpv_login_token");
  } catch {}

  // 2) Borrar persistencia (para forzar modal login la próxima vez)
  if (window.TPV_CFG) {
    await window.TPV_CFG.set("auth.username", "");
    await window.TPV_CFG.set("auth.token", "");
    await window.TPV_CFG.set("auth.codagente", "");
    await window.TPV_CFG.set("auth.codalmacen", "");
    // Si quieres resetear terminal también:
    // await window.TPV_CFG.set("tpv.idtpv", "");
  }

  // 3) Reset de selección en runtime para evitar “Terminal/Agente vacíos”
  try {
    currentAgent = null;
    // currentTerminal = null; // opcional, normalmente NO
  } catch {}

  // 4) Refrescar UI
  refreshLoggedUserUI?.();
  renderMainAgentBar?.();
  updateCashButtonLabel?.();
  toast?.("Sesión cerrada", "info", "Usuario");

  cashOpenDialogShown = false;

  // 5) Abrir login inmediatamente (no dependas de “Abrir caja”)
  const ok2 = await openLoginModal();
  if (!ok2) return;

  // 6) Tras login, refresca datos y fija defaults
  try {
    await loadDataFromApi({ refresh: true });
  } catch {}

  // Si tienes esta función, úsala. Si no, me dices y te la escribo.
  if (typeof ensureTerminalAgentDefaults === "function") {
    await ensureTerminalAgentDefaults();
  } else {
    // fallback mínimo: repinta header
    renderMainAgentBar?.();
  }

  // 7) continúa flujo de caja
  if (typeof fireSessionReady === "function") {
    fireSessionReady();
  } else {
    document.dispatchEvent(new CustomEvent("tpv:sessionReady", { detail: {} }));
  }
}

async function ensureDataLoaded() {
  const need =
    !Array.isArray(products) ||
    products.length === 0 ||
    !Array.isArray(categories) ||
    categories.length === 0;

  if (!need) return;

  try {
    await loadDataFromApi();
  } catch (e) {
    console.warn("ensureDataLoaded() fallo:", e);
  }
}

const changePrinterBtn = document.getElementById("changePrinterBtn");
if (changePrinterBtn) {
  changePrinterBtn.onclick = async () => {
    try {
      const chosen = await openPrinterPicker();
      if (!chosen) return;
      toast("Impresora guardada ✅", "ok", "Impresión");
    } catch (e) {
      toast("Error impresoras: " + (e?.message || e), "err", "Impresión");
    }
  };
}

function showMessageModal(title, text) {
  const o = document.getElementById("msgOverlay");
  const t = document.getElementById("msgTitle");
  const p = document.getElementById("msgText");
  const b = document.getElementById("msgOkBtn");
  if (!o || !t || !p || !b) return;

  t.textContent = title || "Aviso";
  p.textContent = text || "";
  o.classList.remove("hidden");

  b.onclick = () => {
    o.classList.add("hidden");
  };
}

// ===== Inicialización =====
window.addEventListener("DOMContentLoaded", async () => {
  renderCart();
  updateCashButtonLabel();
  updateParkedCountBadge();
  refreshOptionsUI();

  startOnlineMonitor();

  await bootstrapApp(); // y listo
});

async function refreshTicketsCacheFromServer() {
  try {
    // ajusta el endpoint/filtros a tu caso
    const resp = await apiRead("facturaclientes?limit=300&order=desc");
    const list = resp?.data || resp?.results || resp?.docs || resp || [];
    saveTicketsCache(Array.isArray(list) ? list : []);
    return list;
  } catch (e) {
    console.warn("refreshTicketsCacheFromServer:", e?.message || e);
    return [];
  }
}

// ===== Atajo de teclado para reset de fábrica (Ctrl+Shift+R) =====
window.addEventListener("keydown", async (e) => {
  if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r")) return;

  e.preventDefault();

  const ok = await confirmModal(
    "Reset de fábrica",
    "Esto borrará empresa, usuario, token, terminal, agente y caja guardada.\n\n¿Continuar?",
  );
  if (!ok) return;

  // 1) Limpiar localStorage (compat + cachés)
  try {
    // empresa (viejo + nuevo)
    localStorage.removeItem("tpv_companyEmail");
    localStorage.removeItem("tpv_baseUrl");
    localStorage.removeItem("tpv_apiKey");

    // sesión
    clearLoginSession?.(); // borra tpv_login_user/token/codagente/codalmacen

    // selección terminal/agente (si los usaste alguna vez en localStorage)
    localStorage.removeItem("tpv_terminal");
    localStorage.removeItem("tpv_agent");

    // caja guardada para recuperación post-corte
    localStorage.removeItem("tpv_remoteCajaId");

    // ✅ NUEVO: borrar persistencia nueva de empresa (localStorage)
    try {
      localStorage.removeItem("tpv_company_cfg");
    } catch {}
    try {
      localStorage.removeItem("tpv_cached_formapagos");
    } catch {}
    try {
      localStorage.removeItem("tpv_cached_tickets");
    } catch {}

    // opcional: cualquier cache que uses
    // localStorage.removeItem("tpv_cached_formapagos");
    // localStorage.removeItem("tpv_cached_tickets");
  } catch {}

  // 2) Limpiar persistencia durable (TPV_CFG en userData)
  try {
    const TPV_CFG = window.TPV_CFG;
    if (TPV_CFG) {
      // empresa
      await TPV_CFG.set("company.email", "");
      await TPV_CFG.set("company.slug", "");
      await TPV_CFG.set("company.baseUrl", "");
      await TPV_CFG.set("company.apiKey", "");

      // auth
      await TPV_CFG.set("auth.username", "");
      await TPV_CFG.set("auth.token", "");
      await TPV_CFG.set("auth.codagente", "");
      await TPV_CFG.set("auth.codalmacen", "");

      // tpv
      await TPV_CFG.set("tpv.idtpv", "");
    }
  } catch {}

  // 3) Reset runtime (por si no recargas)
  try {
    currentAgent = null;
    currentTerminal = null;
    cashSession.open = false;
    pushCustomerState();
    cashSession.remoteCajaId = null;
  } catch {}

  toast("Reset realizado. Reiniciando...", "ok", "Reset");
  setStatusText?.("TPV reseteado");

  // 4) Recargar app para volver a flujo inicial
  window.location.reload();
});

/* =============================================================
   CAJA - Stepper + teclado numérico/calculadora
   ============================================================= */

function cashParseToInt(value) {
  // Permite expresiones tipo "2*4", "10+5", "20/2" etc.
  // Seguridad: solo números y operadores básicos.
  const raw = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!raw) return 0;

  // Solo deja: dígitos, espacios, + - * / ( ) y punto
  if (!/^[0-9+\-*/().\s]+$/.test(raw)) return 0;

  try {
    // Eval controlado (con filtro anterior). Resultado numérico.
    const result = Function(`"use strict"; return (${raw});`)();
    const n = Number(result);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n)); // cantidades enteras >= 0
  } catch (e) {
    return 0;
  }
}

function cashSetInputValue(input, newVal) {
  const n = Math.max(0, parseInt(newVal, 10) || 0);
  input.value = String(n);
  // Si ya tienes un listener que recalcula totales al 'input', lo disparo:
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function cashWrapInputsWithSteppers() {
  const inputs = document.querySelectorAll(".cash-grid-page input[data-denom]");
  inputs.forEach((input) => {
    // Evitar envolver 2 veces
    if (input.closest(".cash-stepper")) return;

    // Convertimos a text para permitir expresiones y evitar spinners
    input.type = "text";
    input.inputMode = "numeric"; // en tablets/móviles abre teclado numérico
    input.autocomplete = "off";

    // Clase por si no la trae
    input.classList.add("cash-hidden-input");

    // Creamos wrapper y botones
    const wrap = document.createElement("div");
    wrap.className = "cash-stepper";

    const btnMinus = document.createElement("button");
    btnMinus.type = "button";
    btnMinus.className = "cash-stepper-btn minus";
    btnMinus.textContent = "–";

    const btnPlus = document.createElement("button");
    btnPlus.type = "button";
    btnPlus.className = "cash-stepper-btn plus";
    btnPlus.textContent = "+";

    // Insertamos wrapper en el DOM (mantenemos el orden)
    const parent = input.parentElement;
    parent.insertBefore(wrap, input);
    wrap.appendChild(btnMinus);
    wrap.appendChild(input);
    wrap.appendChild(btnPlus);

    // Botones +/- suman/restan 1
    btnMinus.addEventListener("click", () => {
      const current = cashParseToInt(input.value);
      cashSetInputValue(input, Math.max(0, current - 1));
    });

    btnPlus.addEventListener("click", () => {
      const current = cashParseToInt(input.value);
      cashSetInputValue(input, current + 1);
    });

    // Al salir del input, normalizamos el valor a entero
    input.addEventListener("blur", () => {
      const n = cashParseToInt(input.value);
      cashSetInputValue(input, n);
    });

    // Al tocar/click: abrir tu num-pad/calculadora
    input.addEventListener("focus", () => {
      cashOpenNumPadForInput(input);
    });
    input.addEventListener("click", () => {
      cashOpenNumPadForInput(input);
    });
  });
}

/**
 * Conecta con TU modal num-pad/calculadora existente.
 * Ajusta aquí el nombre de tu función si ya existe.
 *
 * Necesitamos algo así:
 *   openNumPad({ initialValue, onOk, allowExpression: true })
 *
 * Si ya tienes una función distinta, dime su nombre y la adapto 1:1.
 */
let __cashLastFocusedInput = null;

function cashOpenNumPadForInput(input) {
  // Evita doble apertura por focus+click
  if (__cashLastFocusedInput === input) return;
  __cashLastFocusedInput = input;

  if (typeof window.openNumPad === "function") {
    const initial = String(input.value || "0");

    window.openNumPad(
      initial,
      (val) => {
        const n = cashParseToInt(val);
        cashSetInputValue(input, n);
        __cashLastFocusedInput = null;
        input.blur(); // importante para que vuelva a disparar focus la próxima vez
      },
      "Caja", // productName (puede ser "")
      "cash", // mode (qty para cantidades)
      null,
      null,
    );

    return;
  }

  __cashLastFocusedInput = null;
}

const DRAWER_LOG_SOURCES = new Set(["MAIN", "OPTIONS", "POSTPAY"]);

/*Abrir Cajon*/
async function openDrawerNow({ source = "MAIN" } = {}) {
  try {
    const printerName = await ensurePrinterSelectedForPrint();
    if (!printerName) {
      toast("No hay impresora seleccionada.", "warn", "Cajón");
      return false;
    }

    if (!window.TPV_PRINT?.openCashDrawer) {
      toast(
        "No está implementado openCashDrawer (preload/main).",
        "err",
        "Cajón",
      );
      return false;
    }

    const res = await window.TPV_PRINT.openCashDrawer(printerName);
    if (!res || !res.ok) {
      toast(
        "No se pudo abrir el cajón: " + (res?.error || "error"),
        "err",
        "Cajón",
      );
      return false;
    }

    // ✅ Log solo fuentes manuales / humanas
    if (DRAWER_LOG_SOURCES.has(String(source).toUpperCase())) {
      const label =
        source === "POSTPAY"
          ? "ABRIÓ CAJÓN (POST-PAGO)"
          : source === "OPTIONS"
            ? "ABRIÓ CAJÓN (OPCIONES)"
            : "ABRIÓ CAJÓN (VENTANA PRINCIPAL)";

      try {
        const ctx = getLogCtx();
        if (ctx.idcaja) {
          await appendCajaAutoLogLineForId(
            ctx.idcaja,
            buildCajaLogLineWith(ctx, label),
          );
        }
      } catch {}
    }

    toast("Cajón abierto ✅", "ok", "Cajón");
    return true;
  } catch (e) {
    toast("Error abriendo cajón: " + (e?.message || e), "err", "Cajón");
    return false;
  }
}

async function checkFSOnline() {
  try {
    const cfg = window.RECIPOK_API || {};
    if (!cfg.baseUrl || !cfg.apiKey) return false;

    const base = cfg.baseUrl.replace(/\/+$/, "");
    const url = `${base}/facturaclientes?limit=1`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);

    try {
      const r = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Token: cfg.apiKey },
        cache: "no-store",
        signal: controller.signal,
      });

      return r.ok; // ✅ no uses r.status > 0
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

let isOnlineFS = null; // 👈 para forzar primera actualización

async function startOnlineMonitor() {
  let prevOk = null;

  async function tick() {
    const ok = await checkFSOnline().catch(() => false);

    TPV_STATE.offline = !ok;
    updateOnlineBadge(ok);

    const becameOnline = prevOk === false && ok === true;
    prevOk = ok;

    // ✅ Al volver online: refrescar default customer + sync cola
    if (becameOnline) {
      try {
        await maybeRefreshTerminalDefaultCustomer("online", {
          force: true,
          forceReset: false,
        });
      } catch {}

      try {
        await syncQueueNow?.();
      } catch (e) {
        console.warn("syncQueueNow falló al volver online:", e?.message || e);
      }
    }

    // ✅ Si online y hay pendientes, sincroniza (tu lógica original)
    try {
      if (ok && window.TPV_QUEUE?.count) {
        const c = await window.TPV_QUEUE.count();
        if ((c?.pending || 0) > 0) {
          await syncQueueNow();
        }
      }
    } catch (e) {
      console.warn("No se pudo comprobar/sincronizar cola:", e?.message || e);
    }

    // ✅ Si online y modal cobro abierto, refrescar formas y repintar
    if (ok) {
      if (!payOverlay?.classList.contains("hidden")) {
        try {
          const formas = await fetchFormasPagoActivas({
            forceOnlineIfPossible: true,
          });
          payModalState.formas = (formas || [])
            .map((f) => ({
              codpago: String(f.codpago || "").trim(),
              descripcion: String(f.descripcion || f.codpago || "").trim(),
              imprimir: f.imprimir !== false,
            }))
            .filter((x) => x.codpago);

          renderPayMethods();
        } catch {}
      }
    }

    isOnlineFS = ok;
  }

  await tick();
  setInterval(tick, 5000);
}

/* =============================================================
   Envío/encolado de facturas
   ============================================================= */
async function sendOrQueueFactura(payload) {
  try {
    const r = await createTicketInFacturaScripts(payload);
    return { ok: true, remote: r };
  } catch (e) {
    const msg = e?.message || String(e);
    const isNetwork = isProbablyNetworkError(e);

    if (!isNetwork) {
      return { ok: false, queued: false, error: msg };
    }

    const localId = (
      crypto?.randomUUID?.() ||
      `${Date.now()}_${Math.random().toString(16).slice(2)}`
    ).toString();

    await window.TPV_QUEUE.enqueue({
      type: "CREATE_FACTURACLIENTE",
      localId,
      payload,
      post: {
        pagos: payload?._payBreakdown || [],
        cambio: payload?._payCambio ?? 0,
        numero: payload?._payNumero2 ?? "",
        nick: payload?._payNick ?? "",
        terminal: currentTerminal
          ? { id: currentTerminal.id, codalmacen: currentTerminal.codalmacen }
          : null,
        agente: currentAgent ? { codagente: currentAgent.codagente } : null,
        codpago: payload?.codpago || "",
        observaciones: (payload?.observaciones || "").toString(),

        // ✅ IMPORTANTÍSIMO para aplicar luego en sync offline
        packDesiredByIdProducto: payload?._packDesiredByIdProducto || null,
      },
      createdAt: new Date().toISOString(),
    });

    try {
      saveOfflineTicketForTicketsModal?.({
        codigo: "OFF-" + String(localId).slice(0, 6).toUpperCase(),
        idfactura: null,
        nombrecliente: "Venta en cola",
        total: Number(getCartTotal(cart) || 0),
        codpago: String(payload?.codpago || "—"),
        fecha: new Date().toISOString().slice(0, 10),
        hora: new Date().toTimeString().slice(0, 8),
        _localId: localId,
        _offline: true,
      });
    } catch {}

    return { ok: false, queued: true, localId };
  }
}

/* =============================================================
   Sincronización de la cola
   ============================================================= */
async function syncQueueNow() {
  if (window.__SYNCING__) return;
  window.__SYNCING__ = true;

  try {
    while (true) {
      const next = await window.TPV_QUEUE.next();
      if (!next?.item) break;

      const item = next.item;

      try {
        // =============================================================
        // 1) Ventas offline
        // =============================================================
        if (item.type === "CREATE_FACTURACLIENTE") {
          // 1) Crear factura
          const resp = await createTicketInFacturaScripts(item.payload);

          const idfactura =
            resp?.idfactura ||
            resp?.doc?.idfactura ||
            resp?.data?.idfactura ||
            resp?.factura?.idfactura ||
            null;

          // Guardar timestamp local->remoto si lo usas
          if (idfactura && item.createdAt) {
            try {
              saveFacturaLocalTimestamp?.(idfactura, item.createdAt);
            } catch {}
          }

          if (idfactura) {
            // 2) ✅ PATCH packs (offline) usando desiredByPid guardado en cola
            try {
              const desired =
                item.post?.packDesiredByIdProducto ||
                item.payload?._packDesiredByIdProducto ||
                null;

              if (desired && typeof desired === "object") {
                await patchPackChildrenLinesInFacturaByDesired({
                  idfactura,
                  desiredByPid: desired,
                });
              }
            } catch (e) {
              console.warn(
                "No se pudo parchear líneas pack (offline sync):",
                e?.message || e,
              );
            }

            // 3) Emitir y marcar pagada (tpv_efectivo/tpv_cambio/etc.)
            try {
              const pagos = Array.isArray(item.post?.pagos)
                ? item.post.pagos
                : [];

              // efectivo = ENTREGADO en efectivo (como tu criterio en online)
              const tpv_efectivo = pagos
                .filter((p) =>
                  isCashPago({
                    codpago: p?.codpago,
                    descripcion: p?.descripcion,
                  }),
                )
                .reduce(
                  (s, p) => s + moneyToNumber(p?.entregado ?? p?.importe ?? 0),
                  0,
                );

              const tpv_cambio = moneyToNumber(item.post?.cambio || 0);

              await updateFacturaCliente(idfactura, {
                idestado: 11,
                pagada: 1,

                tpv_venta: 1,
                tpv_efectivo: Number(Number(tpv_efectivo || 0).toFixed(2)),
                tpv_cambio: Number(Number(tpv_cambio || 0).toFixed(2)),

                observaciones: (item.post?.observaciones || "").toString(),
                numero2: (item.post?.numero ?? "").toString(),
                nick: (item.post?.nick || "Ventas").toString(),

                codpago: item.post?.codpago || item.payload?.codpago || "",

                // terminal/caja (si el payload lo llevaba, mejor)
                idtpv:
                  item.payload?.idtpv ||
                  currentTerminal?.id ||
                  item.post?.terminal?.id ||
                  "",
                idcaja:
                  item.payload?.idcaja ||
                  cashSession?.remoteCajaId ||
                  getCajaIdSafe?.() ||
                  "",

                codalmacen:
                  item.payload?.codalmacen ||
                  currentTerminal?.codalmacen ||
                  item.post?.terminal?.codalmacen ||
                  "",

                ...(item.post?.agente?.codagente
                  ? { codagente: item.post.agente.codagente }
                  : currentAgent?.codagente
                    ? { codagente: currentAgent.codagente }
                    : {}),
              });
            } catch (e) {
              console.warn(
                "No se pudo emitir/pagar factura offline:",
                e?.message || e,
              );
            }

            // 4) Recibos por método + cleanup
            try {
              const today = new Date().toISOString().slice(0, 10);
              const pagos = Array.isArray(item.post?.pagos)
                ? item.post.pagos
                : [];
              const fc = await fetchFacturaClienteById(idfactura);

              if (fc?.codcliente && pagos.length) {
                for (const p of pagos) {
                  const importe = Number(Number(p?.importe || 0).toFixed(2));
                  if (!(importe > 0)) continue;

                  await createReciboCliente({
                    idfactura,
                    codcliente: fc.codcliente,
                    codpago: String(p?.codpago || "").trim(),
                    importe,
                    fechapago: today,
                    fecha: today,
                    idempresa: fc.idempresa,
                    codigofactura: fc.codigo || fc.codigofactura || "",
                    coddivisa: fc.coddivisa,
                  });
                }

                await cleanupRecibosFactura(idfactura, pagos);

                // opcional: valida (si ya tienes función)
                try {
                  await validateRecibosAgainstFactura?.(idfactura);
                } catch {}
              }
            } catch (e) {
              console.warn(
                "No se pudieron crear/limpiar recibos offline:",
                e?.message || e,
              );
            }

            // 5) Quitar del modal offline
            try {
              if (item.localId) {
                removeOfflineTicketFromModalByLocalId?.(item.localId);
              }
            } catch {}
          }

          // 6) Marcar como done
          await window.TPV_QUEUE.done(item.id, { resp });
          continue;
        }

        // =============================================================
        // 2) Cambio cliente por defecto de terminal
        // =============================================================
        if (item.type === "tpvterminal.setCodcliente") {
          try {
            await updateTpvTerminalForm(item.idtpv, {
              codcliente: item.codcliente,
            });

            if (
              currentTerminal?.id &&
              String(currentTerminal.id) === String(item.idtpv)
            ) {
              currentTerminal.codcliente = String(item.codcliente || "1");
              await applyTerminalDefaultCustomer();
            }

            await window.TPV_QUEUE.done(item.id, { ok: true });
          } catch (e) {
            if (isNetworkError(e)) {
              await window.TPV_QUEUE.error(item.id, e?.message || String(e));
            } else {
              await window.TPV_QUEUE.done(item.id, {
                ok: false,
                error: e?.message || String(e),
              });
            }
          }
          continue;
        }

        // =============================================================
        // 3) Otros (done)
        // =============================================================
        await window.TPV_QUEUE.done(item.id, {});
      } catch (e) {
        // Si falla por red, marcamos error y salimos (evita bucles)
        await window.TPV_QUEUE.error(item.id, e?.message || String(e));
        break;
      }
    }
  } finally {
    window.__SYNCING__ = false;
  }
}

const PAY_METHODS_CACHE_KEY = "tpv_cachedPayMethods_v1";
const PAY_METHODS_CACHE_TS_KEY = "tpv_cachedPayMethods_ts_v1";

const TICKETS_CACHE_KEY = "tpv_cachedTickets_v1";
const TICKETS_CACHE_TS_KEY = "tpv_cachedTickets_ts_v1";

// ===== OFFLINE tickets visibles en modal =====
const OFFLINE_TICKETS_KEY = "tpv_offlineTickets_v1";

function loadOfflineTicketsForTicketsModal() {
  try {
    const raw = localStorage.getItem(OFFLINE_TICKETS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveOfflineTicketForTicketsModal(t) {
  try {
    const curr = loadOfflineTicketsForTicketsModal();
    curr.unshift(t);
    // limita para no crecer infinito
    localStorage.setItem(
      OFFLINE_TICKETS_KEY,
      JSON.stringify(curr.slice(0, 200)),
    );
  } catch (e) {
    console.warn("No se pudo guardar ticket offline:", e);
  }
}

function removeOfflineTicketFromModalByLocalId(localId) {
  try {
    const curr = loadOfflineTicketsForTicketsModal();
    const next = curr.filter(
      (x) => String(x._localId || "") !== String(localId || ""),
    );
    localStorage.setItem(OFFLINE_TICKETS_KEY, JSON.stringify(next));
  } catch {}
}

// Construye un ticket imprimible MINIMO cuando no hay respuesta de FS
function buildOfflineTicketPrintData(cartSnapshot, ticketPayload, payResult) {
  const now = new Date();
  const fecha = now.toISOString().slice(0, 10);
  const hora = now.toTimeString().slice(0, 8);

  const safeItems = Array.isArray(cartSnapshot)
    ? cartSnapshot
    : Array.isArray(cartSnapshot?.items)
      ? cartSnapshot.items
      : [];

  const pagos = (payResult?.pagos || []).map((p) => ({
    codpago: p.codpago,
    descripcion: p.descripcion,
    importe: Number(p.importe || 0),
  }));

  return {
    numero: "OFFLINE",
    fecha,
    hora,
    paymentMethod: ticketPayload?.paymentMethod || pagos[0]?.codpago || "—",
    clientName: "Ventas tickets",
    terminalName: currentTerminal ? currentTerminal.name : "",
    agentName: currentAgent ? currentAgent.name : "",
    company: companyInfo ? { ...companyInfo } : null,
    lineas: safeItems.map((it) => ({
      name: it.name || it.descripcion || "Producto",
      qty: Number(it.qty || it.cantidad || 1),
      price: Number(it.price || it.pvpunitario || 0),
      grossPrice: Number(it.grossPrice || it.price || 0),
      codimpuesto: it.codimpuesto || null,
      taxRate: Number(it.taxRate || 0),
    })),
    total: Number(ticketPayload?.total || 0),
    pagos,
    cambio: Number(payResult?.cambio || 0),

    // metadatos útiles
    _offline: true,
    _localId: payResult?.localId || null,
  };
}

function saveTicketsCache(list) {
  try {
    localStorage.setItem(TICKETS_CACHE_KEY, JSON.stringify(list || []));
    localStorage.setItem(TICKETS_CACHE_TS_KEY, String(Date.now()));
  } catch (e) {
    console.warn("No se pudo guardar cache de tickets:", e);
  }
}

function loadTicketsCache() {
  try {
    const raw = localStorage.getItem(TICKETS_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function savePayMethodsCache(methods) {
  try {
    localStorage.setItem(PAY_METHODS_CACHE_KEY, JSON.stringify(methods || []));
    localStorage.setItem(PAY_METHODS_CACHE_TS_KEY, String(Date.now()));
  } catch (e) {
    console.warn("No se pudo guardar cache de formas de pago:", e);
  }
}

function loadPayMethodsCache() {
  try {
    const raw = localStorage.getItem(PAY_METHODS_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const FACTURA_TS_KEY = "tpv_factura_ts_v1";

function loadFacturaTsMap() {
  try {
    return JSON.parse(localStorage.getItem(FACTURA_TS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveFacturaLocalTimestamp(idfactura, ts) {
  const map = loadFacturaTsMap();
  map[String(idfactura)] = Number(ts) || Date.now();
  localStorage.setItem(FACTURA_TS_KEY, JSON.stringify(map));
}

function getFacturaLocalTimestamp(idfactura) {
  const map = loadFacturaTsMap();
  return Number(map[String(idfactura)] || 0) || 0;
}

async function renderQueuedTicketsIfAny() {
  if (!ticketsList) return;

  // Si no hay puente de cola, no hacemos nada
  if (!window.TPV_QUEUE?.list) return;

  try {
    const q = await window.TPV_QUEUE.list();
    const pending = Array.isArray(q?.pending) ? q.pending : [];

    // filtra solo creación de factura
    const pendingFacturas = pending.filter(
      (it) => it.type === "CREATE_FACTURACLIENTE",
    );

    // Si no hay pendientes, no mostramos nada
    if (!pendingFacturas.length) return;

    // Creamos un bloque arriba (sin borrar el resto; luego renderTicketsList pondrá los normales)
    const box = document.createElement("div");
    box.className = "parked-ticket-empty";
    box.style.cssText =
      "margin:10px 0; padding:10px; border:1px dashed #f59e0b; background:#fff7ed;";

    box.innerHTML = `
      <div style="font-weight:800; margin-bottom:6px;">Pendientes (sin internet)</div>
      <div style="font-size:13px; opacity:.9;">
        Hay ${pendingFacturas.length} venta(s) en cola. Se sincronizarán al volver internet.
      </div>
    `;

    // lo metemos al inicio del contenedor ticketsList
    ticketsList.innerHTML = "";
    ticketsList.appendChild(box);

    // opcional: listar 5 últimos
    pendingFacturas.slice(0, 5).forEach((it) => {
      const row = document.createElement("div");
      row.className = "ticket-row";
      row.style.opacity = "0.85";
      const d = new Date(it.createdAt);
      const hhmm = d.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const total = Number(it.payload?.total || 0);
      row.innerHTML = `
        <div class="ticket-left">
          <div class="ticket-num">OFFLINE</div>
          <div class="ticket-mid">
            <span class="ticket-client">Venta en cola</span>
            <span class="ticket-pay">—</span>
            <span class="ticket-id">${hhmm}</span>
          </div>
        </div>
        <div class="ticket-right">
          <div class="ticket-total">${eurES(total)}</div>
        </div>
      `;
      ticketsList.appendChild(row);
    });
  } catch (e) {
    console.warn("No se pudo listar cola:", e?.message || e);
  }
}

async function saveCashMovement() {
  if (!cashMoveAmountEl || !cashMoveReasonEl || !cashMoveErrorEl) return;

  cashMoveErrorEl.textContent = "";

  const rawAmount = (cashMoveAmountEl.value || "").replace(",", ".");
  let amount = parseFloat(rawAmount);

  if (!isFinite(amount) || amount <= 0) {
    cashMoveErrorEl.textContent = "Introduce una cantidad mayor que 0.";
    cashMoveAmountEl.focus();
    return;
  }

  const typeRadio = cashMoveOverlay.querySelector(
    'input[name="cashMoveType"]:checked',
  );
  const type = typeRadio ? typeRadio.value : "in"; // "in" o "out"

  const sign = type === "out" ? -1 : 1;
  const signedAmount = sign * amount;

  let reason = (cashMoveReasonEl.value || "").trim();
  if (!reason) {
    reason = type === "out" ? "Salida de caja" : "Entrada de caja";
  }

  // ctx + idcaja (para logs)
  const idcaja = getCajaIdSafe();
  const ctx = {
    agentName: currentAgent?.name || currentAgent?.nick || "—",
    tpvName: currentTerminal?.name || "—",
  };

  if (ctx.idcaja) {
    const tipoTxt = type === "out" ? "SALIDA" : "ENTRADA";
    const extra = `Tipo:${tipoTxt} Importe:${amount.toFixed(2)}€ Motivo:${reason} FS:${fsOk ? "OK" : "FAIL"}`;
    await appendCajaAutoLogLineForId(
      ctx.idcaja,
      buildCajaLogLineWith(ctx, "CONFIRMÓ MOVIMIENTO", extra),
    );
  }

  // 1) Actualizar total de movimientos en la sesión
  const currentMov = Number(cashSession.cashMovementsTotal || 0);
  cashSession.cashMovementsTotal = currentMov + signedAmount;

  let fsOk = false;

  // 2) Registrar en FacturaScripts (si es posible)
  try {
    await apiCreateCashMovementInFS({ amount, type, reason });
    await syncFsCajaTotalsRealtime();
    fsOk = true;
  } catch (e) {
    console.warn("No se pudo registrar el movimiento en FacturaScripts:", e);
    toast(
      "Movimiento guardado solo en el TPV (no se registró en FacturaScripts).",
      "warn",
      "Caja",
    );
  }

  // ✅ LOG: confirmó movimiento (con detalle)
  try {
    if (idcaja) {
      const tipoTxt = type === "out" ? "SALIDA" : "ENTRADA";
      const extra = `Tipo:${tipoTxt} Importe:${amount.toFixed(2)}€ Motivo:${reason} FS:${fsOk ? "OK" : "FAIL"}`;
      await appendCajaAutoLogLineForId(
        idcaja,
        buildCajaLogLineWith(ctx, "CONFIRMÓ MOVIMIENTO", extra),
      );
    }
  } catch (e) {
    console.warn("No pude registrar log de movimiento:", e?.message || e);
  }

  // 3) Aviso y cerrar
  const prefix = type === "out" ? "-" : "+";
  toast(
    `Movimiento de caja registrado: ${prefix}${amount.toFixed(2)} €`,
    "ok",
    "Caja",
  );

  closeCashMoveDialog();
}

if (cashMoveSaveBtn) {
  cashMoveSaveBtn.onclick = () => {
    saveCashMovement();
  };
}

// Crear un movimiento de caja en FacturaScripts
// type: 'in' | 'out'
async function apiCreateCashMovementInFS({ amount, type, reason }) {
  if (TPV_STATE.offline || TPV_STATE.locked) return null;

  // Caja remota abierta en FS (idcaja)
  const fsBoxId =
    (cashSession && cashSession.remoteCajaId) ||
    (cashSession && cashSession.idcaja) ||
    null;

  // Terminal y agente activos
  const fsTerminal = currentTerminal || null;
  const fsAgent = currentAgent || null;

  console.log("DEBUG cash movement FS:", {
    fsBoxId,
    fsTerminal,
    fsAgent,
    cashSession,
  });

  // Si falta algo, no mandamos a FS
  if (!fsBoxId || !fsTerminal || !fsAgent) {
    console.warn("FS no configurado — movimiento solo en TPV local", {
      fsBoxId,
      fsTerminal,
      fsAgent,
      cashSession,
    });
    return null;
  }

  // Cantidad con signo según tipo
  const signedAmount =
    type === "out"
      ? -Math.abs(Number(amount) || 0)
      : Math.abs(Number(amount) || 0);

  const nick = fsAgent.nick || getLoginUser() || "admin";

  const payload = {
    amount: signedAmount, // con signo
    idcaja: String(fsBoxId), // ID caja abierta
    idtpv: String(fsTerminal.id), // TPV (terminal)
    codagente: String(fsAgent.codagente), // Agente
    motive:
      reason && reason.trim()
        ? reason.trim()
        : type === "out"
          ? "Salida de caja"
          : "Entrada de caja",
    nick, // quién crea
  };

  console.log("Enviando movimiento de caja a tpvmovimientos:", payload);

  const resp = await apiWrite("tpvmovimientos", "POST", payload);
  console.log("Movimiento de caja creado en FacturaScripts:", resp);

  return resp;
}

// Actualizar totales de la caja abierta en FacturaScripts (CORREGIDO)
async function syncFsCajaTotalsRealtime() {
  if (TPV_STATE.offline || TPV_STATE.locked) return;

  const fsBoxId =
    (cashSession && cashSession.remoteCajaId) ||
    (cashSession && cashSession.idcaja) ||
    null;

  const fsTerminal = currentTerminal || null;
  const fsAgent = currentAgent || null;

  if (!fsBoxId || !fsTerminal || !fsAgent) {
    console.warn("No se puede sincronizar caja en FS (faltan datos):", {
      fsBoxId,
      fsTerminal,
      fsAgent,
    });
    return;
  }

  const totalMovimientos = Number(cashSession.cashMovementsTotal || 0);
  const dineroInicial = Number(
    cashSession.openingTotal || cashSession.initialCash || 0,
  );
  const ingresos = Number(cashSession.cashSalesTotal || 0);

  // ✅ total en caja esperado = inicial + ingresos + movimientos
  const totalEnCaja = dineroInicial + ingresos + totalMovimientos;

  const payload = {
    dineroini: dineroInicial,
    ingresos: ingresos,
    totalmovi: totalMovimientos,
    totalcaja: totalEnCaja,

    // opcional:
    // totaltickets: Number(cashSession.totalSales || 0),
    // numtickets: Number(cashSession.numtickets || 0),
    // nick: getLoginUser(),
  };

  console.log(
    "Actualizando totales de caja en FacturaScripts:",
    fsBoxId,
    payload,
  );

  try {
    // ✅ IMPORTANTE: PUT al registro concreto
    await apiWrite(`tpvcajas/${fsBoxId}`, "PUT", payload);
  } catch (e) {
    console.warn("Error al actualizar totales de caja en FS:", e);
  }
}

function getAllTicketsForUI(serverTickets) {
  const offline = loadOfflineTicketsForTicketsModal(); // tus OFF-...
  const server = Array.isArray(serverTickets) ? serverTickets : [];

  const seen = new Set();
  const out = [];

  const push = (t) => {
    const key = String(
      t.codigo || t.numero || t.idfactura || t._localId || "",
    ).trim();
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(t);
  };

  offline.forEach(push);
  server.forEach(push);

  return out;
}

// GET genérico (similar a fetchApiResource, pero para un solo registro)
async function apiRead(resource) {
  const cfg = window.RECIPOK_API || {};
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Config API no definida");

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/${String(resource).replace(/^\/+/, "")}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Token: cfg.apiKey,
    },
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    console.error("Respuesta no JSON en", resource, ":", text);
  }

  if (!res.ok || (data && data.status === "error")) {
    throw new Error(data?.message || `HTTP ${res.status} en ${resource}`);
  }

  return data;
}

// Lee la caja remota usando cashSession.remoteCajaId
async function apiReadCurrentCaja() {
  if (TPV_STATE.offline || TPV_STATE.locked) return null;

  const remoteId =
    cashSession?.remoteCajaId ||
    Number(localStorage.getItem("tpv_remoteCajaId") || 0) ||
    null;

  if (!remoteId) {
    console.warn("No hay remoteCajaId para leer tpvcajas.");
    return null;
  }

  const resp = await apiRead(`tpvcajas/${remoteId}`);
  const doc = resp?.doc || resp?.data || resp || null;

  // ✅ si viene bien, sincroniza
  if (doc?.idcaja) {
    cashSession.remoteCajaId = Number(doc.idcaja);
    try {
      localStorage.setItem("tpv_remoteCajaId", String(doc.idcaja));
    } catch {}
  }

  return doc;
}

function setCashDialogMode(mode) {
  const summary = document.querySelector(".cash-summary-page"); // 6 KPIs
  const bigTotal = document.querySelector(".cash-total-big"); // Dinero Asignado
  const closeSummary = document.getElementById("cashCloseSummary"); // formas pago

  const title = document.getElementById("cashDialogTitle");
  const okBtn = document.getElementById("cashOpenOkBtn");

  const isOpenMode = mode === "open"; // apertura

  // Apertura => SOLO Dinero Asignado
  if (summary) summary.classList.toggle("hidden", isOpenMode);
  if (bigTotal) bigTotal.classList.toggle("hidden", !isOpenMode);

  // Cierre => mostrar resumen formas de pago (si existe)
  if (closeSummary) closeSummary.style.display = isOpenMode ? "none" : "block";

  // Textos
  if (title)
    title.textContent = isOpenMode ? "Apertura de caja" : "Cierre de caja";
  if (okBtn) okBtn.textContent = isOpenMode ? "Abrir caja" : "Cerrar caja";
}

const kioskToggle = document.getElementById("kioskToggle");

async function initKioskToggle() {
  const v = await window.TPV_CFG.get("kioskMode");
  kioskToggle.checked = v !== false;

  kioskToggle.onchange = async () => {
    await window.TPV_CFG.set("kioskMode", kioskToggle.checked);
    await window.TPV_UI_MODE.setKioskMode(kioskToggle.checked);
  };
}

initKioskToggle();

// 1) Si algún día vuelve el bootstrap remoto y emite cajaAbierta, dejamos esto consistente
document.addEventListener("tpv:cajaAbierta", (e) => {
  const idcaja = Number(e.detail?.idcaja || 0) || null;
  const idtpv = e.detail?.idtpv != null ? String(e.detail.idtpv) : "";

  if (idcaja) {
    cashSession.remoteCajaId = idcaja;
    cashSession.open = true;
    try {
      localStorage.setItem("tpv_remoteCajaId", String(idcaja));
    } catch {}
  }

  // ✅ GUARDAR TERMINAL para que tras corte no salga "----"
  if (idtpv) {
    try {
      localStorage.setItem("tpv_terminal", idtpv);
    } catch {}
  }

  if (idtpv) {
    try {
      window.TPV_CFG?.set?.("tpv.idtpv", String(idtpv));
    } catch {}
  }

  console.log("[RENDER] tpv:cajaAbierta recibido", e.detail);
  window.cargarPantallaTPV?.(e.detail.idcaja, e.detail.idtpv, e.detail.caja);
});

// 2) sessionReady = punto único para decidir caja (bootstrap desactivado)
document.addEventListener("tpv:sessionReady", () => {
  // Si el bootflow está corriendo, NO hagas nada (ya lo hace runBootFlow)
  if (BOOT_IN_FLIGHT) return;

  // Si estamos ya logueados y con empresa, ok
  if (hasCompanyResolved?.() && getLoginUser?.() && getLoginToken?.()) {
    maybeOpenCashOrRecover();
  }
});

// helper para emitir sessionReady siempre con el mismo formato
function dispatchSessionReady() {
  document.dispatchEvent(
    new CustomEvent("tpv:sessionReady", {
      detail: {
        idtpv: currentTerminal?.id || null,
        codagente: currentAgent?.codagente || null,
        user: getLoginUser?.() || null,
      },
    }),
  );
}

let cashRecoverInFlight = false;

let cashOpenDialogShown = false;

async function hydrateLegacyCompanyFromCfg() {
  try {
    const TPV_CFG = window.TPV_CFG;
    if (!TPV_CFG) return;

    const email = (await TPV_CFG.get("company.email")) || "";
    const baseUrl = (await TPV_CFG.get("company.baseUrl")) || "";
    const apiKey = (await TPV_CFG.get("company.apiKey")) || "";

    if (email) localStorage.setItem("tpv_companyEmail", email);
    if (baseUrl) localStorage.setItem("tpv_baseUrl", baseUrl);
    if (apiKey) localStorage.setItem("tpv_apiKey", apiKey);

    // ✅ IMPORTANTÍSIMO: hidratar RECIPOK_API también
    if (window.RECIPOK_API) {
      if (baseUrl) window.RECIPOK_API.baseUrl = baseUrl;
      if (apiKey) window.RECIPOK_API.apiKey = apiKey;
    }
  } catch {}
}

async function repairCompanyPersistenceIfNeeded() {
  try {
    const emailLS = (localStorage.getItem("tpv_companyEmail") || "").trim();
    const baseUrlLS = (localStorage.getItem("tpv_baseUrl") || "").trim();
    const apiKeyLS = (localStorage.getItem("tpv_apiKey") || "").trim();
    if (!emailLS || !baseUrlLS || !apiKeyLS) return;

    const TPV_CFG = window.TPV_CFG;
    if (!TPV_CFG) return;

    const email = (await TPV_CFG.get("company.email")) || "";
    const baseUrl = (await TPV_CFG.get("company.baseUrl")) || "";
    const apiKey = (await TPV_CFG.get("company.apiKey")) || "";

    // si TPV_CFG aún no tiene datos, migramos desde localStorage
    if (!email || !baseUrl || !apiKey) {
      await TPV_CFG.set("company.email", emailLS);
      await TPV_CFG.set("company.baseUrl", baseUrlLS);
      await TPV_CFG.set("company.apiKey", apiKeyLS);
    }
  } catch {}
}

/*----------------------*/
/* editar precio (ADMIN) */
/*----------------------*/

window.TPV_STATE = window.TPV_STATE || {};
window.TPV_STATE.priceEditMode = false;

function isAdminUser() {
  return !!window.TPV_STATE?.isAdmin;
}

function isPriceEditModeEnabled() {
  return !!window.TPV_STATE?.priceEditMode;
}

async function loadPriceEditModeFromCfg() {
  try {
    const TPV_CFG = window.TPV_CFG;
    const v = TPV_CFG ? await TPV_CFG.get("ui.priceEditMode") : false;
    window.TPV_STATE.priceEditMode = !!v;
  } catch {
    window.TPV_STATE.priceEditMode = false;
  }
}

async function setPriceEditMode(v) {
  window.TPV_STATE.priceEditMode = !!v;
  try {
    const TPV_CFG = window.TPV_CFG;
    if (TPV_CFG) await TPV_CFG.set("ui.priceEditMode", !!v);
  } catch {}
  renderProducts?.();
}

function grossToNet(gross, taxRate) {
  const g = Number(String(gross).replace(",", ".")) || 0;
  const t = Number(taxRate) || 0;
  const divisor = 1 + t / 100;
  const net = divisor > 0 ? g / divisor : g;

  // ✅ guarda con más precisión (ajusta 8/10 según quieras)
  return Number(net.toFixed(8));
}

function refreshPriceEditToggleUI() {
  const tog = document.getElementById("priceEditModeToggle");
  if (!tog) return;

  if (!isAdminUser()) {
    tog.checked = false;
    tog.disabled = true;
    return;
  }

  tog.disabled = false;
  tog.checked = isPriceEditModeEnabled();
}

function bindPriceEditToggleOnce() {
  const tog = document.getElementById("priceEditModeToggle");
  if (!tog || tog.dataset.bound) return;
  tog.dataset.bound = "1";

  tog.addEventListener("change", async () => {
    if (!isAdminUser()) {
      tog.checked = false;
      toast?.("Solo administradores.", "warn", "Opciones");
      return;
    }
    await setPriceEditMode(!!tog.checked);
    renderProducts?.();
  });
}

/* ===== Modal editar precio ===== */

const priceEditState = { product: null };

function openPriceEditForProduct(p) {
  if (!isAdminUser())
    return toast?.("Solo administradores.", "warn", "Productos");
  if (!isPriceEditModeEnabled()) return;

  const overlay = document.getElementById("priceEditOverlay");
  if (!overlay) return toast?.("Falta #priceEditOverlay.", "err", "Productos");

  priceEditState.product = p;

  const taxRate = getTaxRateForProduct(p);
  const grossNow = round2(Number(p.price || 0) * (1 + taxRate / 100) || 0);

  const nameEl = document.getElementById("priceEditName");
  const curEl = document.getElementById("priceEditCurrent");
  const inp = document.getElementById("priceEditInput");
  const err = document.getElementById("priceEditError");

  if (nameEl) nameEl.textContent = p.name || "Producto";
  if (curEl) curEl.textContent = eur2(grossNow);
  if (inp) inp.value = grossNow.toFixed(2);
  if (err) err.textContent = "";

  const keypadBtn = document.getElementById("priceEditKeypadBtn");
  if (keypadBtn && inp) {
    keypadBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const taxRate = getTaxRateForProduct(p);
      const grossNow = round2(Number(p.price || 0) * (1 + taxRate / 100) || 0);

      openNumPad(
        String(inp.value || grossNow.toFixed(2)), // valor inicial
        (val) => {
          inp.value = formatPrice2(val);
        }, // callback
        p.name || "Producto",
        "price",
        grossNow, // originalValue (para “Restaurar”)
        null,
      );
    };
  }

  const close = () => overlay.classList.add("hidden");
  document
    .getElementById("priceEditCloseX")
    ?.addEventListener("click", close, { once: true });
  document
    .getElementById("priceEditCancelBtn")
    ?.addEventListener("click", close, { once: true });

  const saveBtn = document.getElementById("priceEditSaveBtn");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        await confirmAndSaveProductPrice();
      } finally {
        saveBtn.disabled = false;
      }
    };
  }

  overlay.classList.remove("hidden");
}

async function confirmAndSaveProductPrice() {
  const p = priceEditState.product;
  if (!p) return;

  const err = document.getElementById("priceEditError");
  if (err) err.textContent = "";

  const inp = document.getElementById("priceEditInput");
  const raw = String(inp?.value ?? "")
    .trim()
    .replace(",", ".");
  const newGross = round2(Number(raw));
  if (!isFinite(newGross) || newGross < 0) {
    if (err) err.textContent = "Precio no válido.";
    return;
  }

  const taxRate = getTaxRateForProduct(p);
  const grossNow = round2(Number(p.price || 0) * (1 + taxRate / 100) || 0);
  if (round2(newGross) === round2(grossNow)) {
    toast?.("El precio no ha cambiado.", "info", "Productos");
    document.getElementById("priceEditOverlay")?.classList.add("hidden");
    return;
  }

  const ok = await confirmModal(
    "Actualizar precio",
    `Vas a cambiar el precio de "${p.name}"\n\n` +
      `De: ${grossNow.toFixed(2)} € (IVA incl.)\n` +
      `A:  ${newGross.toFixed(2)} € (IVA incl.)\n\n` +
      `¿Quieres actualizarlo permanentemente?`,
  );
  if (!ok) return;

  const newNet = grossToNet(newGross, taxRate);

  try {
    if (p.isVariant) {
      await apiUpdateVariantePrecioNet(p.id, newNet);
    } else {
      await apiUpdateProductoPrecioNet(p.baseProductId || p.id, newNet);
    }

    // ✅ LOG solo si la API fue OK
    await logPermanentPriceChange({
      product: p,
      oldGross: grossNow,
      newGross,
      taxRate,
    });
  } catch (e) {
    console.error(e);
    if (err) err.textContent = e?.message || "No se pudo actualizar el precio.";
    toast?.("No se pudo actualizar el precio.", "err", "Productos");
    return;
  }

  // actualiza memoria y UI
  p.price = newNet;
  const idx = (products || []).findIndex((x) => Number(x.id) === Number(p.id));
  if (idx >= 0) products[idx].price = newNet;

  renderProducts?.();
  toast?.("Precio actualizado ✅", "ok", "Productos");
  document.getElementById("priceEditOverlay")?.classList.add("hidden");
}

async function apiUpdateProductoPrecioNet(idproducto, precioNet) {
  const id = Number(idproducto || 0);
  if (!id) throw new Error("idproducto inválido");
  const payload = { idproducto: id, precio: Number(precioNet || 0) };
  try {
    return await apiWrite(`productos/${id}`, "PATCH", payload);
  } catch {
    return await apiWrite(`productos/${id}`, "PUT", payload);
  }
}

async function apiUpdateVariantePrecioNet(idvariante, precioNet) {
  const id = Number(idvariante || 0);
  if (!id) throw new Error("idvariante inválido");
  const payload = { idvariante: id, precio: Number(precioNet || 0) };
  try {
    return await apiWrite(`variantes/${id}`, "PATCH", payload);
  } catch {
    return await apiWrite(`variantes/${id}`, "PUT", payload);
  }
}

async function logPermanentPriceChange({ product, oldGross, newGross }) {
  try {
    const idcaja = getCajaIdSafe?.() || null;
    if (!idcaja) return;

    const ctx = getLogCtx?.() || { idcaja };

    const from = Number(oldGross || 0);
    const to = Number(newGross || 0);

    const line = buildCajaLogLineWith(
      ctx,
      "Cambio de precio",
      `${String(product?.name || "Producto")} | ${from.toFixed(2)}€ → ${to.toFixed(2)}€ (IVA incl.)`,
    );

    await appendCajaAutoLogLineForId(idcaja, line);
  } catch (e) {
    console.warn("[PRICECHG] No pude escribir log:", e?.message || e);
  }
}

/*----------------------*/
/* fin editar precio     */
/*----------------------*/
