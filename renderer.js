// ============================================================
// MAPA ESTRUCTURAL renderer.js (pre-modularizacion)
// 01) Demo/fallback + bootstrap config global
// 02) Estado runtime y sesion TPV
// 03) Modo E2E / guardas de escritura remota
// 04) Logging tecnico y utilidades de request tracing
// 05) Guardas de cierre y estado UI protegido
// 06) Referencias DOM base y overlays principales
// 07) Carga de datos API + cache + reintentos/red
// 08) Flujo carrito/aparcados/cobro/impresion
// 09) Dialogos de opciones, terminales, familias, periféricos
// 10) Inicializacion DOMContentLoaded y bootstrap general
// ============================================================

// SUBZONAS (2a pasada de zonificacion)
// Z07.1 Recursos API y disponibilidad
// Z07.2 Carga principal de catalogo/terminales
// Z07.3 Caches locales de soporte operativo
// Z08.1 Flujo de venta (carrito, cobro, aparcados)
// Z08.2 Cola offline (enqueue + sync)
// Z08.3 Caja (movimientos, logs, estado)
// Z09.1 Opciones del TPV
// Z09.2 Modales y teclados
// Z09.3 Edicion avanzada (precio, devoluciones)

// ===== [01] Datos de ejemplo (fallback offline) =====
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
// ===== [01] Bootstrap de config global (evita modo demo por undefined) =====
window.RECIPOK_API = window.RECIPOK_API || {
  baseUrl: "", // ej: https://plus.recipok.com/SLUG/api/3
  apiKey: "", // token
  defaultCodClienteTPV: "1",
};

window.TPV_CONFIG = window.TPV_CONFIG || {
  // OBLIGATORIO: URL absoluta a tu clients.json (o al endpoint que lo devuelva)
  resolverUrl: "", // ej: https://tu-dominio.com/clients.json
};

// ===== [02] Estado runtime principal =====
// Estas son las que usará la app realmente (las podremos sobrescribir con la API)
let categories = []; // familias (incluye raíz + hijas)
let products = [];
let managedStockProductIds = new Set();
let managedStockCatalogLoaded = false;

// Mapa codimpuesto -> porcentaje real de IVA
let taxRatesByCode = {};

// Para saber si ya hemos pintado la UI principal
let mainUiRendered = false;
let LAST_FULL_LOAD_AT = 0;

// Filtro actual
let selectedCategory = null; // id de familia simple
let activeFamilyParentId = null; // id de familia padre (para subfamilias)
let activeSubfamilyId = null; // id de subfamilia activa (hija)
let cart = [];
let searchTerm = "";
const RUNTIME_CART_SNAPSHOT_KEY = "tpv_runtime_cart_snapshot_v1";
const RUNTIME_CART_SNAPSHOT_CFG_KEY = "runtime.cartSnapshot";
const LOGIN_LAST_USER_KEY = "tpv_last_user";
let CART_SNAPSHOT_ARMED = false;
let CART_SNAPSHOT_CFG_WRITE_TIMER = null;
let PENDING_RUNTIME_UI_RESTORE = null;

let lastTicket = null; // guardará el último ticket/factura creada para poder imprimirla

let parkedTickets = []; // cada item: { id, createdAt, items, total, clientName, codcliente, obs, fs, paid, paidAt, paidTicketCode, paidTicketId }

const parkedViewState = {
  search: "",
  filter: "pending", // "all" | "pending" | "paid"
  pendingScope: "today", // "today" | "older"
};
let parkedCounter = 0;
// Índice del ticket aparcado actualmente cargado en el carrito
let currentParkedTicketIndex = null;
let preParkedCustomerSelection = null;
let PENDING_RUNTIME_PARKED_SYNC_KEY = "";
let PENDING_RUNTIME_PARKED_TICKET_ID = 0;
let showParkStockWarning = true;

// ===== [02] Estado operativo: TPVs, agentes y caja =====
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

// ===== [03] Soporte E2E y protección de escrituras remotas =====
const TPV_E2E_MODE =
  String(window.TPV_ENV?.mode || "").toLowerCase() === "demo" ||
  !!window.TPV_ENV?.e2e;
const TPV_E2E_ALLOW_WRITES = !!window.TPV_ENV?.e2eAllowWrites;
const TPV_SAFE_TRAINING_MODE_LS_KEY = "tpv_safe_training_mode";
const TPV_SAFE_TRAINING_SNAPSHOT_LS_KEY =
  "tpv_safe_training_runtime_snapshot_v1";
const TPV_SAFE_TRAINING_SIM_SALE_SEQ_KEY = "tpv_safe_training_sim_sale_seq";
const TPV_SAFE_TRAINING_SIM_REFUND_SEQ_KEY = "tpv_safe_training_sim_refund_seq";

let safeTrainingModeEnabled = false;
let safeTrainingRuntimeSnapshot = null;

function isSafeTrainingModeEnabled() {
  return !!safeTrainingModeEnabled;
}

function shouldBlockRemoteWrites() {
  if (TPV_E2E_MODE && !TPV_E2E_ALLOW_WRITES) return true;
  return isSafeTrainingModeEnabled();
}

function applySafeTrainingModeUi() {
  try {
    if (safeTrainingModeEnabled) {
      document.body.dataset.safeTrainingMode = "1";
    } else {
      delete document.body.dataset.safeTrainingMode;
    }
  } catch {}
}

function clonePlain(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function getLocalStorageRawValue(key) {
  try {
    if (!key) return null;
    return localStorage.getItem(String(key));
  } catch {
    return null;
  }
}

function setLocalStorageRawValue(key, rawValue) {
  try {
    if (!key) return;
    if (rawValue == null) {
      localStorage.removeItem(String(key));
      return;
    }
    localStorage.setItem(String(key), String(rawValue));
  } catch {}
}

function readSafeTrainingSequence(key) {
  const n = Number(getLocalStorageRawValue(key) || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function nextSafeTrainingSequence(key) {
  const next = readSafeTrainingSequence(key) + 1;
  setLocalStorageRawValue(key, String(next));
  return next;
}

function nextSafeTrainingSimSaleCode() {
  return `SIM${nextSafeTrainingSequence(TPV_SAFE_TRAINING_SIM_SALE_SEQ_KEY)}`;
}

function nextSafeTrainingSimRefundCode() {
  return `SIMR${nextSafeTrainingSequence(TPV_SAFE_TRAINING_SIM_REFUND_SEQ_KEY)}`;
}

function isSimulatedTicketLike(ticket) {
  const t = ticket && typeof ticket === "object" ? ticket : {};
  if (t._simulated === true || t.simulated === true) return true;
  const code = String(t.codigo || t.paidTicketCode || "")
    .trim()
    .toUpperCase();
  return code.startsWith("SIM");
}

function isSimulatedParkedTicket(ticket) {
  const t = ticket && typeof ticket === "object" ? ticket : {};
  if (t._simulated === true || t.simulated === true) return true;
  const fsCode = String(t?.fs?.codigo || "")
    .trim()
    .toUpperCase();
  return fsCode.startsWith("SIM");
}

function clearSafeTrainingSessionData() {
  cart = [];
  parkedTickets = [];
  parkedCounter = 0;
  currentParkedTicketIndex = null;
  preParkedCustomerSelection = null;

  lastTicket = null;
  customerDisplayOverride = null;
  customerThanksUntil = 0;
  customerLastSale = null;

  try {
    saveParkedTicketsCache([]);
  } catch {}
  try {
    saveParkedSyncQueue([]);
  } catch {}

  REMOTE_PARKED_RESERVATIONS = [];

  setLocalStorageRawValue("tpv_remoteCajaId", null);
  setLocalStorageRawValue(TPV_SAFE_TRAINING_SIM_SALE_SEQ_KEY, "0");
  setLocalStorageRawValue(TPV_SAFE_TRAINING_SIM_REFUND_SEQ_KEY, "0");
  setLocalStorageRawValue("tpv_offlineTickets_v1", "[]");
  setLocalStorageRawValue("tpv_cachedTickets_v1", "[]");
  setLocalStorageRawValue("tpv_cachedTickets_ts_v1", null);

  if (typeof ticketsCache !== "undefined") ticketsCache = [];
  if (typeof ticketsUiCache !== "undefined") ticketsUiCache = [];

  if (cashSession && typeof cashSession === "object") {
    cashSession.open = false;
    cashSession.remoteCajaId = null;
    cashSession.openedAt = null;
    cashSession.openingCash = 0;
    cashSession.cashSales = 0;
    cashSession.cardSales = 0;
    cashSession.totalSales = 0;
    cashSession.ticketsCount = 0;
    cashSession.paymentsByMethod = {};
    cashSession.cashMovements = [];
    cashSession.cashMovementsTotal = 0;
    cashSession.isRecovering = false;
  }

  if (typeof cashOpenDialogShown !== "undefined") {
    cashOpenDialogShown = false;
  }

  renderCart?.();
  renderMainUI?.(true);
  refreshParkButtonUI?.();
  refreshParkedEditingBanner?.();
  updateParkedCountBadge?.();
  updateCashButtonLabel?.();
  renderCashIdChip?.();
  pushCustomerState?.();
}

function persistSafeTrainingRuntimeSnapshot(snapshot) {
  try {
    if (!snapshot || typeof snapshot !== "object") {
      localStorage.removeItem(TPV_SAFE_TRAINING_SNAPSHOT_LS_KEY);
      return;
    }

    localStorage.setItem(
      TPV_SAFE_TRAINING_SNAPSHOT_LS_KEY,
      JSON.stringify(snapshot),
    );
  } catch {}
}

function loadSafeTrainingRuntimeSnapshot() {
  if (safeTrainingRuntimeSnapshot) return safeTrainingRuntimeSnapshot;

  try {
    const raw = localStorage.getItem(TPV_SAFE_TRAINING_SNAPSHOT_LS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    safeTrainingRuntimeSnapshot = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function clearSafeTrainingRuntimeSnapshot() {
  safeTrainingRuntimeSnapshot = null;
  persistSafeTrainingRuntimeSnapshot(null);
}

function captureSafeTrainingRuntimeSnapshot() {
  const snapshot = {
    capturedAt: new Date().toISOString(),
    products: clonePlain(Array.isArray(products) ? products : [], []),
    cart: clonePlain(Array.isArray(cart) ? cart : [], []),
    parkedTickets: clonePlain(getScopedPendingParkedTickets(parkedTickets), []),
    parkedCounter: Number(parkedCounter || 0) || 0,
    currentParkedTicketIndex:
      currentParkedTicketIndex == null
        ? null
        : Number(currentParkedTicketIndex),
    preParkedCustomerSelection: clonePlain(preParkedCustomerSelection, null),
    customerSelection: clonePlain(
      captureCurrentCustomerSelectionForParked(),
      null,
    ),
    cashSession: clonePlain(cashSession, null),
    lastTicket: clonePlain(lastTicket, null),
    customerDisplayOverride: clonePlain(customerDisplayOverride, null),
    customerMode: String(customerMode || "CART"),
    customerThanksUntil: Number(customerThanksUntil || 0) || 0,
    customerLastSale: clonePlain(customerLastSale, null),
    productDiscountPctById: clonePlain(productDiscountPctById, {}),
    productManualOrderById: clonePlain(productManualOrderById, {}),
    offlineTicketsRaw: getLocalStorageRawValue("tpv_offlineTickets_v1"),
    ticketsCacheRaw: getLocalStorageRawValue("tpv_cachedTickets_v1"),
    ticketsCacheTsRaw: getLocalStorageRawValue("tpv_cachedTickets_ts_v1"),
    remoteCajaIdRaw: getLocalStorageRawValue("tpv_remoteCajaId"),
    simSaleSeqRaw: getLocalStorageRawValue(TPV_SAFE_TRAINING_SIM_SALE_SEQ_KEY),
    simRefundSeqRaw: getLocalStorageRawValue(
      TPV_SAFE_TRAINING_SIM_REFUND_SEQ_KEY,
    ),
  };

  safeTrainingRuntimeSnapshot = snapshot;
  persistSafeTrainingRuntimeSnapshot(snapshot);
  return snapshot;
}

function restoreSafeTrainingRuntimeSnapshot(snapshot) {
  const src = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!src) return false;

  products = Array.isArray(src.products) ? clonePlain(src.products, []) : [];
  cart = Array.isArray(src.cart) ? clonePlain(src.cart, []) : [];
  parkedTickets = Array.isArray(src.parkedTickets)
    ? src.parkedTickets
        .map((it) => normalizeRemoteParkedTicket(it))
        .filter(Boolean)
        .filter((t) => !t?.paid)
    : [];
  parkedCounter = Number(src.parkedCounter || 0) || 0;
  currentParkedTicketIndex =
    src.currentParkedTicketIndex == null
      ? null
      : Math.max(0, Number(src.currentParkedTicketIndex) || 0);
  if (
    currentParkedTicketIndex != null &&
    currentParkedTicketIndex >= parkedTickets.length
  ) {
    currentParkedTicketIndex = null;
  }

  preParkedCustomerSelection = src.preParkedCustomerSelection || null;

  if (src.cashSession && typeof src.cashSession === "object") {
    cashSession = { ...cashSession, ...clonePlain(src.cashSession, {}) };
  }

  lastTicket = src.lastTicket ? clonePlain(src.lastTicket, null) : null;
  customerDisplayOverride = src.customerDisplayOverride
    ? clonePlain(src.customerDisplayOverride, null)
    : null;
  customerMode = String(src.customerMode || "CART");
  customerThanksUntil = Number(src.customerThanksUntil || 0) || 0;
  customerLastSale = src.customerLastSale
    ? clonePlain(src.customerLastSale, null)
    : null;
  productDiscountPctById =
    src.productDiscountPctById && typeof src.productDiscountPctById === "object"
      ? clonePlain(src.productDiscountPctById, {})
      : {};
  productManualOrderById =
    src.productManualOrderById && typeof src.productManualOrderById === "object"
      ? clonePlain(src.productManualOrderById, {})
      : {};

  setLocalStorageRawValue("tpv_offlineTickets_v1", src.offlineTicketsRaw);
  setLocalStorageRawValue("tpv_cachedTickets_v1", src.ticketsCacheRaw);
  setLocalStorageRawValue("tpv_cachedTickets_ts_v1", src.ticketsCacheTsRaw);
  setLocalStorageRawValue("tpv_remoteCajaId", src.remoteCajaIdRaw);
  setLocalStorageRawValue(
    TPV_SAFE_TRAINING_SIM_SALE_SEQ_KEY,
    src.simSaleSeqRaw,
  );
  setLocalStorageRawValue(
    TPV_SAFE_TRAINING_SIM_REFUND_SEQ_KEY,
    src.simRefundSeqRaw,
  );

  if (typeof ticketsCache !== "undefined") {
    try {
      ticketsCache = JSON.parse(src.ticketsCacheRaw || "[]");
      if (!Array.isArray(ticketsCache)) ticketsCache = [];
    } catch {
      ticketsCache = [];
    }
  }

  if (typeof ticketsUiCache !== "undefined") {
    ticketsUiCache = [];
  }

  saveParkedTicketsCache(parkedTickets);
  saveParkedSyncQueue([]);

  if (src.customerSelection) {
    applyCustomerSelectionSnapshot(src.customerSelection);
  }

  renderCart?.();
  renderMainUI?.(true);
  refreshParkButtonUI?.();
  refreshParkedEditingBanner?.();
  updateParkedCountBadge?.();
  updateCashButtonLabel?.();
  renderCashIdChip?.();
  pushCustomerState?.();

  if (
    parkedTicketsOverlay &&
    !parkedTicketsOverlay.classList.contains("hidden")
  ) {
    renderParkedTicketsModal?.();
  }

  return true;
}

async function enterSafeTrainingMode() {
  captureSafeTrainingRuntimeSnapshot();
  clearSafeTrainingSessionData();
  await saveSafeTrainingModeToggle(true);
  setStatusText?.("Entorno de pruebas activo");
  toast(
    "Entorno de pruebas iniciado: sesión limpia (tickets/aparcados/caja).",
    "info",
    "Modo pruebas",
  );
  return true;
}

async function exitSafeTrainingMode() {
  const snapshot = loadSafeTrainingRuntimeSnapshot();
  const restored = restoreSafeTrainingRuntimeSnapshot(snapshot);
  await saveSafeTrainingModeToggle(false);
  clearSafeTrainingRuntimeSnapshot();

  if (restored) {
    toast(
      "Entorno de pruebas finalizado. Estado restaurado.",
      "ok",
      "Modo pruebas",
    );
  } else {
    toast(
      "Entorno de pruebas finalizado. No había estado previo para restaurar.",
      "warn",
      "Modo pruebas",
    );
  }

  return true;
}

function isTargetRemoteWriteUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return false;

  const baseFs = String(window.RECIPOK_API?.baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  const syncBase = String(TPV_SYNC_API_URL || "")
    .trim()
    .replace(/\/+$/, "");

  if (baseFs && url.startsWith(baseFs)) return true;
  if (syncBase && url.startsWith(syncBase)) return true;
  if (url.includes("/demo/api/")) return true;

  return false;
}

function buildRemoteWriteBlockedError(method, url) {
  const target =
    `${String(method || "").toUpperCase()} ${String(url || "")}`.trim();
  const err = new Error(
    `Modo pruebas activo: escritura remota bloqueada (${target}).`,
  );
  err.code = "TPV_SAFE_TRAINING_WRITE_BLOCKED";
  return err;
}

function installRemoteWriteGuard() {
  if (window.__TPV_REMOTE_WRITE_GUARD_INSTALLED__) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const method = String(init?.method || "GET").toUpperCase();
    const url =
      typeof input === "string"
        ? input
        : input && typeof input.url === "string"
          ? input.url
          : "";

    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    if (isWrite && shouldBlockRemoteWrites() && isTargetRemoteWriteUrl(url)) {
      throw buildRemoteWriteBlockedError(method, url);
    }

    return originalFetch(input, init);
  };

  window.__TPV_REMOTE_WRITE_GUARD_INSTALLED__ = true;
}

function installE2ERemoteWriteGuard(_baseUrl) {
  if (!TPV_E2E_MODE || TPV_E2E_ALLOW_WRITES) return;
  installRemoteWriteGuard();
}

const TPV_DEBUG_LOGS = false;
const BROKEN_PRODUCT_IMAGE_URLS = new Set();

// ===== [04] Logging tecnico =====

function logFeatureInfo(feature, action, details = {}) {
  const requestId = String(details?.requestId || "").trim();
  const prefix = requestId ? `[${requestId}] ` : "";
  console.info(`[TPV][${feature}] ${prefix}${action}`, details);
}

function logFeatureWarn(feature, action, details = {}) {
  const requestId = String(details?.requestId || "").trim();
  const prefix = requestId ? `[${requestId}] ` : "";
  console.warn(`[TPV][${feature}] ${prefix}${action}`, details);
}

function logFeatureError(feature, action, error, details = {}) {
  const requestId = String(details?.requestId || "").trim();
  const prefix = requestId ? `[${requestId}] ` : "";
  const msg = error?.message || String(error || "");
  console.error(`[TPV][${feature}] ${prefix}${action}: ${msg}`, {
    ...details,
    message: msg,
  });
}

function createRequestId(prefix = "REQ") {
  const p = String(prefix || "REQ")
    .trim()
    .toUpperCase()
    .slice(0, 6);
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${p}-${t}-${r}`;
}

function debugLog(...args) {
  if (!TPV_DEBUG_LOGS) return;
  console.log(...args);
}

function debugTrace(...args) {
  if (!TPV_DEBUG_LOGS) return;
  console.trace(...args);
}

// ✅ lo que se verá mientras el carrito real esté vacío tras el cobro
let customerDisplayOverride = null;

// ===== [05] Guardas de cierre y protecciones de estado =====
window.__TPV_GUARDS__ = () => {
  if (TPV_E2E_MODE) {
    return {
      cashOpen: false,
      parkedCount: 0,
      allowCloseWithParked: true,
    };
  }

  const cashOpen = !!(cashSession && cashSession.open);
  const parkedCount = cashOpen
    ? Array.isArray(parkedTickets)
      ? parkedTickets.length
      : 0
    : 0;
  let allowCloseWithParked = false;

  try {
    const toggleEl = document.getElementById("allowCloseWithParkedToggle");
    if (toggleEl) {
      allowCloseWithParked = !!toggleEl.checked;
    } else {
      const lsVal = localStorage.getItem("tpv_allowCloseWithParkedTickets");
      allowCloseWithParked = lsVal === "1" || lsVal === "true";
    }
  } catch {
    allowCloseWithParked = false;
  }

  return {
    cashOpen,
    parkedCount,
    allowCloseWithParked,
  };
};

// ===== [06] Referencias DOM base =====
const searchInput = document.getElementById("searchInput");
const searchClearBtn = document.getElementById("searchClearBtn");
const searchKeyboardBtn = document.getElementById("searchKeyboardBtn");
const productsStockOnlyToggle = document.getElementById(
  "productsStockOnlyToggle",
);
const productsIncludeUnmanagedToggle = document.getElementById(
  "productsIncludeUnmanagedToggle",
);
const terminalMetaItemEl = document.getElementById("terminalMetaItem");
const agentMetaItemEl = document.getElementById("agentMetaItem");
const userMetaItemEl = document.getElementById("userMetaItem");

const productSortModeSelect = document.getElementById("productSortModeSelect");
const productReorderModeToggle = document.getElementById(
  "productReorderModeToggle",
);
const productManualOrderResetBtn = document.getElementById(
  "productManualOrderResetBtn",
);

const infoBarVisibleToggle = document.getElementById("infoBarVisibleToggle");
const infoBarShowTerminalToggle = document.getElementById(
  "infoBarShowTerminalToggle",
);
const infoBarShowAgentToggle = document.getElementById(
  "infoBarShowAgentToggle",
);
const infoBarShowUserToggle = document.getElementById("infoBarShowUserToggle");
const infoBarShowCashToggle = document.getElementById("infoBarShowCashToggle");
const infoBarAltTerminalBtn = document.getElementById("infoBarAltTerminalBtn");
const infoBarAltAgentBtn = document.getElementById("infoBarAltAgentBtn");
const infoBarAltUserBtn = document.getElementById("infoBarAltUserBtn");

const BARCODE_SCANNER_CFG = {
  minLength: 6,
  maxLength: 64,
  interKeyMaxMs: 120,
};

let barcodeScannerBuffer = "";
let barcodeScannerLastKeyAt = 0;
let barcodeScannerLookupInFlight = false;
let barcodeCatalogReady = false;
let barcodeReadyToastAt = 0;
const BARCODE_LOCAL_PRODUCT_BY_CODE = new Map();

const PRODUCT_THUMB_DB_NAME = "tpv-product-thumbs";
const PRODUCT_THUMB_DB_VERSION = 1;
const PRODUCT_THUMB_STORE = "thumbs";
const PRODUCT_THUMB_MAX_LONG_EDGE = 640;
const PRODUCT_THUMB_WEBP_QUALITY = 0.74;
const PRODUCT_THUMB_MAX_CACHE_BYTES = 220 * 1024 * 1024;
const PRODUCT_THUMB_MAX_CONCURRENT_JOBS = 3;

let PRODUCT_THUMB_DB_PROMISE = null;
let productThumbTenantKey = "global";
let productThumbActiveJobs = 0;
const productThumbPendingJobs = [];
const PRODUCT_THUMB_OBJECT_URL_BY_KEY = new Map();
const PRODUCT_THUMB_IN_FLIGHT_BY_KEY = new Map();
const PRODUCT_THUMB_FAILED_KEYS = new Set();

// Terminal / caja
const terminalNameEl = document.getElementById("terminalName");
const agentNameEl = document.getElementById("agentName");
const userNameEl = document.getElementById("userName");

// Overlay seleccion de terminal / agente
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
const cashDirectTotalClearBtn = document.getElementById(
  "cashDirectTotalClearBtn",
);
const cashDirectTotalKeyboardBtn = document.getElementById(
  "cashDirectTotalKeyboardBtn",
);

// ===== [08] Caja: movimientos manuales (entrada/salida) =====
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
const cartGlobalDiscountRow = document.getElementById("cartGlobalDiscountRow");
const cartGlobalDiscountSummary = document.getElementById(
  "cartGlobalDiscountSummary",
);
const cartGlobalDiscountBtn = document.getElementById("cartGlobalDiscountBtn");
const cartGlobalDiscountClearBtn = document.getElementById(
  "cartGlobalDiscountClearBtn",
);

// ===== [04] Funciones auxiliares y logging de auditoria =====

function cleanCajaLogValue(value) {
  return String(value || "")
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatParkedAuditAmount(value) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2).replace(".", ",") + " €";
}

function getCajaLogCtx() {
  return {
    agentName: currentAgent?.name || currentAgent?.nick || "—",
    tpvName: currentTerminal?.name || "—",
  };
}

function getParkedTicketDisplayName(ticket) {
  return (
    cleanCajaLogValue(
      ticket?.label ||
        ticket?.name ||
        ticket?.obs ||
        ticket?.clientName ||
        "Sin nombre",
    ) || "Sin nombre"
  );
}

function buildParkedManualDeleteLogLine(ticket) {
  if (!ticket || ticket?.paid) return "";

  const extra = [
    `Aparcado #${ticket?.id ?? "—"}`,
    shouldShowParkedName(ticket)
      ? `Nombre: ${getParkedTicketDisplayName(ticket)}`
      : "",
    `Total: ${formatParkedAuditAmount(ticket?.total)}`,
  ]
    .filter(Boolean)
    .join(" | ");

  return buildCajaLogLineWith(
    getCajaLogCtx(),
    "BORRÓ APARCADO SIN COBRAR",
    extra,
  );
}

function shouldShowParkedName(ticket) {
  const id = ticket?.id ?? "";
  const name = getParkedTicketDisplayName(ticket).toLowerCase();

  const autoNames = [
    `ticket #${id}`.toLowerCase(),
    `aparcado #${id}`.toLowerCase(),
  ];

  return !autoNames.includes(name);
}

function buildCajaAutoLogText(lines) {
  const items = Array.isArray(lines)
    ? lines.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  if (!items.length) return "";

  return items.join("\n\n");
}

// ===== [08] Aparcados/reservas remotas + sincronizacion =====

let REMOTE_PARKED_RESERVATIONS = [];
let REMOTE_RESERVED_BY_PRODUCT = new Map();

const PARKED_TICKETS_CACHE_KEY = "tpv_parked_tickets_cache_v1";
const PARKED_SYNC_QUEUE_KEY = "tpv_parked_sync_queue_v1";
const PARKED_PAID_HISTORY_KEY = "tpv_parked_paid_history_v1";
const PARKED_DEVICE_NODE_ID_KEY = "tpv_parked_device_node_id_v1";
const PARKED_DEVICE_SEQ_KEY = "tpv_parked_device_seq_v1";
const PAID_TICKET_PARKED_ORIGIN_KEY = "tpv_paid_ticket_parked_origin_v1";
const TPV_USERS_CACHE_KEY = "tpv_cachedUsers_v1";
const TPV_USERS_CACHE_TS_KEY = "tpv_cachedUsers_ts_v1";
const TERMINAL_AGENT_CACHE_KEY = "tpv_cachedTerminalAgent_v1";
const TERMINAL_AGENT_CACHE_TS_KEY = "tpv_cachedTerminalAgent_ts_v1";
const BOOT_SNAPSHOT_CACHE_KEY = "tpv_boot_snapshot_v1";
const BOOT_SNAPSHOT_CACHE_TS_KEY = "tpv_boot_snapshot_ts_v1";
const API_RESOURCES_CACHE_KEY = "tpv_api_resources_cache_v1";
const API_RESOURCES_CACHE_TS_KEY = "tpv_api_resources_ts_v1";
const API_MISSING_RESOURCES_CACHE_KEY = "tpv_api_missing_resources_cache_v1";
const API_MISSING_RESOURCES_CACHE_TS_KEY = "tpv_api_missing_resources_ts_v1";

let __parkedSyncDrainInFlight = false;

let __parkedReservationsRefreshTimer = null;
let __parkedReservationsRefreshInFlight = false;
let __parkedBurstRefreshTimers = [];
let __sharedCajaHealthTimer = null;
let __sharedCajaHealthInFlight = false;

// Ajusta esta URL a tu API TPV real
const TPV_SYNC_API_URL =
  window.TPV_CONFIG?.tpvSyncApiUrl ||
  "https://plus.recipok.com/tpv/api/index.php";

function getTpvSyncApiKey() {
  const fromCfg = String(window.TPV_CONFIG?.tpvApiKey || "").trim();
  if (fromCfg) return fromCfg;

  // Compat fallback: if integrators reuse the same key in runtime config.
  const fromRuntime = String(window.RECIPOK_API?.apiKey || "").trim();
  if (fromRuntime) return fromRuntime;

  const fromLs = String(localStorage.getItem("tpv_sync_api_key") || "").trim();
  if (fromLs) return fromLs;

  return "";
}

async function confirmIfCartExceedsVisibleStock(cartSnapshot) {
  if (!showParkStockWarning) return true;

  const requestedByProduct = new Map();

  (Array.isArray(cartSnapshot) ? cartSnapshot : []).forEach((it) => {
    const idProd = getProductBaseId(it);
    if (!idProd) return;

    const qty = getCartItemReservedQty(it);
    const name = String(
      it?.name || it?.descripcion || it?.referencia || `Producto ${idProd}`,
    ).trim();
    const description = String(
      it?.descripcion2 ||
        it?.secondaryName ||
        it?.description2 ||
        it?.descripcion ||
        it?.description ||
        "",
    ).trim();

    if (!requestedByProduct.has(idProd)) {
      requestedByProduct.set(idProd, {
        qty: 0,
        name,
        description,
      });
    }

    const row = requestedByProduct.get(idProd);
    row.qty = Number(row.qty || 0) + qty;
    if (!row.name && name) row.name = name;
    if (!row.description && description) row.description = description;
  });

  const warnings = [];

  for (const [idProd, row] of requestedByProduct.entries()) {
    const qtyToReserve = Number(row?.qty || 0);

    const product = Array.isArray(products)
      ? products.find((p) => getProductBaseId(p) === idProd)
      : null;

    const productName = String(
      product?.referencia ||
        product?.name ||
        product?.descripcion ||
        row?.name ||
        `Producto ${idProd}`,
    ).trim();

    let productDescription = String(
      product?.descripcion ||
        product?.descripcion2 ||
        product?.secondaryName ||
        product?.description ||
        row?.description ||
        row?.name ||
        "",
    ).trim();

    // Evita repetir el mismo texto en nombre y descripción.
    if (
      productDescription &&
      productDescription.localeCompare(productName, "es", {
        sensitivity: "base",
      }) === 0
    ) {
      productDescription = "";
    }

    const visibleStock = getVisibleStockForProduct(idProd);
    if (visibleStock === null) continue;

    if (qtyToReserve > visibleStock) {
      warnings.push({
        productName,
        productDescription,
        qtyToReserve,
        visibleStock,
      });
    }
  }

  if (warnings.length) {
    const blocksHtml = warnings
      .map((w, idx) => {
        const title = escapeHtmlForModal(
          w.productName || `Producto ${idx + 1}`,
        );
        const desc = escapeHtmlForModal(w.productDescription || "");
        const qty = escapeHtmlForModal(fmtQty(w.qtyToReserve));
        const stock = escapeHtmlForModal(formatProductStock(w.visibleStock));

        return [
          `<div class="stock-warning-item">`,
          `  <div class="stock-warning-name">${idx + 1}. ${title}</div>`,
          desc ? `  <div class="stock-warning-desc">${desc}</div>` : "",
          `  <div class="stock-warning-row">Cantidad a aparcar: <strong>${qty}</strong></div>`,
          `  <div class="stock-warning-row">Stock actual: <strong>${stock}</strong></div>`,
          `</div>`,
        ].join("\n");
      })
      .join("\n");

    const html = [
      `<div class="stock-warning-wrap">`,
      `  <div class="stock-warning-intro">Hay productos con stock insuficiente para aparcar:</div>`,
      `  <div class="stock-warning-list">${blocksHtml}</div>`,
      `  <div class="stock-warning-outro">¿Continuar de todos modos?</div>`,
      `</div>`,
    ].join("\n");

    const ok = await confirmModal("Stock insuficiente para aparcar", html, {
      isHtml: true,
      textClassName: "stock-warning-content",
      dialogClassName: "stock-warning-dialog",
    });
    if (!ok) return false;
  }

  return true;
}

// ===== [07] Refrescos automaticos de datos (stock, etc.) =====

let __stockRefreshTimer = null;
let __stockRefreshInFlight = false;

async function runProductsStockRefreshOnce() {
  if (__stockRefreshInFlight) return;
  if (TPV_STATE?.offline) return;
  if (!cashSession?.open) return;
  if (!Array.isArray(products) || !products.length) return;

  __stockRefreshInFlight = true;

  try {
    await refreshProductsStockOnly();
  } catch (e) {
    console.warn("Refresh de stock falló:", e?.message || e);
  } finally {
    __stockRefreshInFlight = false;
  }
}

function startProductsStockAutoRefresh() {
  stopProductsStockAutoRefresh();

  // primer refresh inmediato
  runProductsStockRefreshOnce().catch(() => {});

  __stockRefreshTimer = setInterval(async () => {
    await runProductsStockRefreshOnce();
  }, 10000); // 10 segundos
}

function stopProductsStockAutoRefresh() {
  if (__stockRefreshTimer) {
    clearInterval(__stockRefreshTimer);
    __stockRefreshTimer = null;
  }
}

// ===== [07] Configuracion persistida y validaciones base =====

// ===== [07] Estrategia de reintentos/red + cooldown 429 =====
const API_RETRY_MS = 5000;
const API_429_COOLDOWN_MS = 30000;

let apiRetryTimer = null;
let apiConnectionWasLost = false;
let api429BlockedUntil = 0;
let api429LastWarnAt = 0;

function getApi429RemainingMs() {
  return Math.max(0, api429BlockedUntil - Date.now());
}

function isApi429CooldownActive() {
  return getApi429RemainingMs() > 0;
}

function parseRetryAfterMs(retryAfterHeader) {
  const raw = String(retryAfterHeader || "").trim();
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const at = Date.parse(raw);
  if (Number.isFinite(at)) {
    return Math.max(0, at - Date.now());
  }

  return 0;
}

function buildApi429Error() {
  const seconds = Math.max(1, Math.ceil(getApi429RemainingMs() / 1000));
  return new Error(
    `API 429 (demasiadas peticiones). Reintentando automaticamente en ${seconds}s.`,
  );
}

function triggerApi429Cooldown(source = "api", retryAfterHeader = "") {
  const cooldownMs = Math.max(
    API_429_COOLDOWN_MS,
    parseRetryAfterMs(retryAfterHeader),
  );
  const nextUntil = Date.now() + cooldownMs;
  if (nextUntil > api429BlockedUntil) {
    api429BlockedUntil = nextUntil;
  }

  enterApiRetryMode(
    "API con bloqueo temporal (429). Esperando para reintentar...",
    {
      lock: false,
      scheduleRetry: false,
      showOverlay: false,
    },
  );

  const now = Date.now();
  if (now - api429LastWarnAt > 10000) {
    api429LastWarnAt = now;
    const seconds = Math.max(1, Math.ceil(getApi429RemainingMs() / 1000));
    console.warn(`[API429] Cooldown activo ${seconds}s (${source})`);
  }
}

function throwIfApi429Cooldown(source = "api") {
  if (!isApi429CooldownActive()) return;

  const now = Date.now();
  if (now - api429LastWarnAt > 10000) {
    api429LastWarnAt = now;
    const seconds = Math.max(1, Math.ceil(getApi429RemainingMs() / 1000));
    console.warn(
      `[API429] Saltando llamada durante cooldown ${seconds}s (${source})`,
    );
  }

  throw buildApi429Error();
}

function clearApiRetryTimer() {
  if (apiRetryTimer) {
    clearTimeout(apiRetryTimer);
    apiRetryTimer = null;
  }
}

function scheduleApiRetry() {
  if (apiRetryTimer) return;

  apiRetryTimer = setTimeout(async () => {
    apiRetryTimer = null;
    await loadDataFromApi({ refresh: true, silentRetry: true });
  }, API_RETRY_MS);
}

function hasRealDataLoaded() {
  return Array.isArray(products) && products.length > 0;
}

function enterApiRetryMode(
  message = "Sin conexión con Recipok. Reintentando...",
  opts = {},
) {
  const { lock = false, scheduleRetry = false, showOverlay = true } = opts;

  setStatusText(message);

  TPV_STATE.offline = true;
  TPV_STATE.locked = !!lock;
  TPV_STATE.apiRecovering = true;
  updateCashButtonLabel();

  apiConnectionWasLost = true;

  // ✅ Si ya hay caja abierta, no molestamos con overlay modal
  if (showOverlay && !cashSession?.open) {
    showReconnectIfAvailable(message);
  }

  if (hasRealDataLoaded()) {
    renderMainUI(true);
  }

  if (scheduleRetry) {
    scheduleApiRetry();
  }
}

function exitApiRetryMode() {
  clearApiRetryTimer();

  TPV_STATE.offline = false;
  TPV_STATE.locked = false;
  TPV_STATE.apiRecovering = false;
  updateCashButtonLabel();

  hideReconnectIfAvailable();

  if (apiConnectionWasLost) {
    toast("Conexión con Recipok restablecida.", "success");
    apiConnectionWasLost = false;
  }

  api429BlockedUntil = 0;
}

// ===== [08] Flujo de caja: input directo apertura/cierre =====

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
    syncCashStepperClearButton(inp);
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
  syncCashDirectClearButtonVisibility();

  // 4) Refrescar total principal
  if (cashOpenTotalEl) {
    cashOpenTotalEl.textContent = total.toFixed(2).replace(".", ",") + " €";
  }

  // 5) Si estamos cerrando caja, recalcular resumen
  if (cashDialogMode !== "open") {
    updateCloseSummary(total);
  }
}

function snapshotCashBreakdownState() {
  const items = [];
  if (cashOpenOverlay) {
    const inputs = cashOpenOverlay.querySelectorAll(".cash-hidden-input");
    inputs.forEach((inp) => {
      const denom = String(inp.dataset.denom || "");
      const qty = Math.max(0, parseInt(inp.value || "0", 10) || 0);
      if (!denom) return;
      items.push({ denom, qty });
    });
  }

  const total =
    cashDialogMode === "open"
      ? Number(cashSession?.openingTotal || 0)
      : Number(cashSession?.closingTotal || 0);

  return {
    mode: cashDialogMode,
    total,
    items,
  };
}

function restoreCashBreakdownState(snapshot) {
  if (!snapshot) return;

  if (cashOpenOverlay) {
    const byDenom = new Map(
      (Array.isArray(snapshot.items) ? snapshot.items : []).map((it) => [
        String(it?.denom || ""),
        Math.max(0, parseInt(it?.qty || "0", 10) || 0),
      ]),
    );

    const inputs = cashOpenOverlay.querySelectorAll(".cash-hidden-input");
    inputs.forEach((inp) => {
      const denom = String(inp.dataset.denom || "");
      const qty = byDenom.get(denom) || 0;
      inp.value = String(qty);
    });
  }

  const hasBreakdown = (
    Array.isArray(snapshot.items) ? snapshot.items : []
  ).some((it) => Number(it?.qty || 0) > 0);

  if (hasBreakdown) {
    updateCashOpenTotal();
  } else {
    applyCashDirectTotal(Number(snapshot.total || 0));
  }
}

function openCashDirectTotalNumPad() {
  const initialValue = cashDirectTotalEl?.value || "0";
  const snapshot = snapshotCashBreakdownState();

  openNumPad(
    initialValue,
    (value, meta = {}) => {
      const phase = String(meta?.phase || "");

      // Evita live-change en "Importe directo": solo aplicar en OK.
      if (phase === "preview") return;

      // Al cancelar, restauramos exactamente lo que había antes de abrir teclado.
      if (phase === "cancel") {
        restoreCashBreakdownState(snapshot);
        return;
      }

      const safeValue =
        Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
      applyCashDirectTotal(safeValue);
    },
    "Importe directo",
    "cash",
  );
}

function syncCashDirectClearButtonVisibility() {
  if (!cashDirectTotalClearBtn || !cashDirectTotalEl) return;

  const total = parseCashDirectAmount(cashDirectTotalEl.value);
  const visible = Number(total || 0) > 0;
  cashDirectTotalClearBtn.classList.toggle("hidden", !visible);
}

function bindCashDirectTotalInput() {
  if (cashDirectTotalKeyboardBtn && !cashDirectTotalKeyboardBtn.dataset.bound) {
    cashDirectTotalKeyboardBtn.dataset.bound = "1";

    cashDirectTotalKeyboardBtn.onclick = () => {
      openCashDirectTotalNumPad();
    };
  }

  if (cashDirectTotalEl && !cashDirectTotalEl.dataset.bound) {
    cashDirectTotalEl.dataset.bound = "1";

    cashDirectTotalEl.onclick = () => {
      openCashDirectTotalNumPad();
    };
  }

  if (cashDirectTotalClearBtn && !cashDirectTotalClearBtn.dataset.bound) {
    cashDirectTotalClearBtn.dataset.bound = "1";

    cashDirectTotalClearBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    cashDirectTotalClearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyCashDirectTotal(0);
    });
  }

  syncCashDirectClearButtonVisibility();
}

// ===== [08] Caja: ledger local de metodos de pago =====

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

// ===== [09] Opciones: colores de familias/grupos =====

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

// ===== [09] Opciones: pantalla de cliente =====
async function loadCustomerDisplayToggle() {
  const el = document.getElementById("customerDisplayToggle");
  if (!el || !window.TPV_CUSTOMER_CTRL?.getEnabled) return;

  const canToggle = isAdminUser();
  el.disabled = !canToggle;
  el.title = canToggle
    ? "Activar/desactivar pantalla cliente"
    : "Solo usuarios ADMIN pueden cambiar este ajuste.";

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
const OPTIONS_SHOW_PRODUCT_STOCK_KEY = "ui.showProductStockBadge";
const OPTIONS_ENABLE_STOCK_EDIT_KEY = "ui.enableStockEdition";
const OPTIONS_ALLOW_CLOSE_WITH_PARKED_KEY = "ui.allowCloseWithParkedTickets";
const OPTIONS_SHOW_PARK_STOCK_WARNING_KEY = "ui.showParkStockWarning";
const OPTIONS_PRODUCT_TILE_SIZE_KEY = "ui.productTileMinSize";
const OPTIONS_PRODUCT_TILE_RESIZE_MODE_KEY = "ui.productTileResizeMode";
const OPTIONS_PRODUCT_MANUAL_ORDER_KEY = "ui.productManualOrderById";
const OPTIONS_PRODUCT_SORT_MODE_KEY = "ui.productSortMode";
const OPTIONS_PRODUCT_REORDER_MODE_KEY = "ui.productReorderMode";
const OPTIONS_INFOBAR_VISIBLE_KEY = "ui.infoBarVisible";
const OPTIONS_INFOBAR_SHOW_TERMINAL_KEY = "ui.infoBarShowTerminal";
const OPTIONS_INFOBAR_SHOW_AGENT_KEY = "ui.infoBarShowAgent";
const OPTIONS_INFOBAR_SHOW_USER_KEY = "ui.infoBarShowUser";
const OPTIONS_INFOBAR_SHOW_CASH_KEY = "ui.infoBarShowCash";
const OPTIONS_SCALE_MANUAL_CAPTURE_MODE_KEY = "scale.manualCaptureMode";
const OPTIONS_CART_DISCOUNT_TOOLS_KEY = "ui.cartDiscountToolsEnabled";
const OPTIONS_SAFE_TRAINING_MODE_KEY = "runtime.safeTrainingMode";
const PRODUCT_DISCOUNTS_SESSION_KEY = "tpv_productDiscountPctById_session";
const PRODUCT_NAME_COLLATOR = new Intl.Collator("es", {
  numeric: true,
  sensitivity: "base",
});
const PRODUCT_TILE_MIN_SIZE_DEFAULT = 150;
const PRODUCT_TILE_MIN_SIZE_MIN = 110;
const PRODUCT_TILE_MIN_SIZE_MAX = 260;
const LS_ALLOW_CLOSE_WITH_PARKED_KEY = "tpv_allowCloseWithParkedTickets";
let showProductStockBadge = false;
let enableProductStockEdition = false;
let allowCloseWithParkedTickets = false;
let productDiscountPctById = {};
let productManualOrderById = {};
let customerTariffCatalog = [];
let customerTariffByCode = {};
let activeCustomerTariff = null;
let activeCustomerTariffCodcliente = "";
let tariffsLoadedOnce = false;
let tariffOptionsBound = false;
let tariffCustomersCache = [];
let tariffAssignedCustomersByCode = {};
let tariffAssignedServerCodesByCode = {};
let tariffEditBaselineByCode = {};
let tariffInputKeyboardBound = false;

function getUniqueTariffCustomerCodes(codes = []) {
  return Array.from(
    new Set(
      (Array.isArray(codes) ? codes : [])
        .map((x) => String(x || "").trim())
        .filter(Boolean),
    ),
  );
}

function buildTariffCustomersFromCodes(codes = []) {
  const unique = getUniqueTariffCustomerCodes(codes);
  const byCode = new Map(
    (Array.isArray(tariffCustomersCache) ? tariffCustomersCache : []).map(
      (c) => [String(c?.codcliente || "").trim(), c],
    ),
  );

  return unique.map((codcliente) => {
    const found = byCode.get(codcliente);
    return {
      codcliente,
      nombre: String(found?.nombre || "").trim(),
    };
  });
}

function captureTariffEditBaseline(codtarifa, tariff, assignedCodes = []) {
  const cod = String(codtarifa || "").trim();
  if (!cod || !tariff) return;

  tariffEditBaselineByCode[cod] = {
    codtarifa: cod,
    nombre: String(tariff?.nombre || "").trim(),
    aplicar:
      normalizeTariffApplyMode(tariff?.aplicar) === "coste" ? "coste" : "pvp",
    valorx: clampDiscountPercent(parseNumericLike(tariff?.valorx, 0)),
    valory: round2(parseNumericLike(tariff?.valory, 0)),
    mincoste: !!tariff?.mincoste,
    maxpvp: !!tariff?.maxpvp,
    assignedCodes: getUniqueTariffCustomerCodes(assignedCodes),
    searchText: "",
  };
}

function getTariffEditBaseline(codtarifa) {
  const cod = String(codtarifa || "").trim();
  return tariffEditBaselineByCode[cod] || null;
}

function getTariffCustomerSearchText() {
  const input = document.getElementById("tariffCustomerSearchInput");
  return String(input?.value || "")
    .trim()
    .toLowerCase();
}

function getAssignedCustomerSetForTariff(codtarifa) {
  const cod = String(codtarifa || "").trim();
  const list = tariffAssignedCustomersByCode[cod] || [];
  return new Set(
    list.map((c) => String(c?.codcliente || "").trim()).filter(Boolean),
  );
}

function setAssignedCustomersForTariff(codtarifa, customers = []) {
  const cod = String(codtarifa || "").trim();
  tariffAssignedCustomersByCode[cod] = (
    Array.isArray(customers) ? customers : []
  )
    .map((c) => ({
      codcliente: String(c?.codcliente || "").trim(),
      nombre: String(c?.nombre || "").trim(),
    }))
    .filter((c) => !!c.codcliente);
}

function updateTariffCustomersSelectedCount(codtarifa) {
  const chip = document.getElementById("tariffCustomersSelectedCount");
  if (!chip) return;

  const count = getAssignedCustomerSetForTariff(codtarifa).size;
  chip.textContent = `${count} seleccionado${count === 1 ? "" : "s"}`;
}
let productTileMinSize = PRODUCT_TILE_MIN_SIZE_DEFAULT;
let productTileResizeMode = false;
let productsFilterStockOnly = false;
let productsFilterIncludeUnmanaged = true;
let productsFilterIncludeUnmanagedSnapshot = true;
let productSortMode = "manual";
let productReorderMode = false;
let infoBarVisible = true;
let infoBarShowTerminal = true;
let infoBarShowAgent = true;
let infoBarShowUser = true;
let infoBarShowCash = true;
let scaleManualCaptureMode = false;
let cartDiscountToolsEnabled = false;
let cartGlobalDiscountPct = 0;
let cartDiscountToolsToggleBound = false;
let safeTrainingModeToggleBound = false;

const productReorderDragState = {
  active: false,
  sourceId: 0,
  targetId: 0,
  targetTile: null,
};

function clampDiscountPercent(value) {
  const n = Number(value);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

function formatDiscountPercent(value) {
  const pct = clampDiscountPercent(value);
  if (Number.isInteger(pct)) return String(pct);
  return pct.toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}

function getCartLineDiscountPercent(item) {
  return clampDiscountPercent(parseNumericLike(item?.cartLineDiscountPct, 0));
}

function hasLockedManualUnitPrice(item) {
  if (!item || typeof item !== "object") return false;
  if (!isPriceModified(item)) return false;
  return parseBoolLike(item?.manualPriceLocksAdjustments, true);
}

function getCartGlobalDiscountPercent() {
  if (!cartDiscountToolsEnabled) return 0;
  return clampDiscountPercent(parseNumericLike(cartGlobalDiscountPct, 0));
}

function getEffectiveCartDiscountForLine(item) {
  const linePct = getCartLineDiscountPercent(item);
  if (linePct > 0) return { pct: linePct, source: "line" };

  const frozenGlobalPct = clampDiscountPercent(
    parseNumericLike(item?.cartGlobalDiscountPctApplied, 0),
  );
  const globalPct =
    frozenGlobalPct > 0 ? frozenGlobalPct : getCartGlobalDiscountPercent();
  if (globalPct > 0) return { pct: globalPct, source: "global" };

  return { pct: 0, source: "" };
}

function parseNumericLike(value, fallback = 0) {
  if (typeof value === "number" && isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  // Accept backend/localized strings like "1,25", " 2.500,50 " or "5 €".
  let normalized = raw.replace(/\s+/g, "").replace(/[^\d,.-]/g, "");
  if (!normalized) return fallback;

  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");
  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = normalized.replace(",", ".");
  }

  const n = Number(normalized);
  return isFinite(n) ? n : fallback;
}

function normalizeTariffCodeKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw;
}

function formatTariffFixedAmount(value) {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return "0";
  return eur(round2(n));
}

function getTariffDiscountDisplayParts(tariff) {
  const mode = normalizeTariffApplyMode(tariff?.aplicar);
  const isCostMode = mode === "coste";
  const sign = isCostMode ? "+" : "-";
  const pct = clampDiscountPercent(parseNumericLike(tariff?.valorx, 0));
  const fix = Math.max(0, round2(parseNumericLike(tariff?.valory, 0)));
  const parts = [];
  if (pct > 0) parts.push(`${sign}${formatDiscountPercent(pct)}%`);
  if (fix > 0) parts.push(`${sign}${formatTariffFixedAmount(fix)}`);
  return { pct, fix, parts };
}

function getTariffDiscountDisplayText(tariff, fallback = "sin descuento") {
  const { parts } = getTariffDiscountDisplayParts(tariff);
  return parts.length ? parts.join(" y ") : fallback;
}

function getDiscountProductId(productOrId) {
  if (typeof productOrId === "number" || typeof productOrId === "string") {
    return String(Number(productOrId) || 0);
  }
  const p = productOrId || {};
  return String(Number(p.baseProductId || p.id || 0));
}

function getProductDiscountPercent(productOrId) {
  const key = getDiscountProductId(productOrId);
  if (!key || key === "0") return 0;
  return clampDiscountPercent(productDiscountPctById?.[key] || 0);
}

function clampManualOrderPriority(value) {
  const n = Number(value);
  if (!isFinite(n)) return 0;
  return Math.max(-9999, Math.min(9999, Math.round(n)));
}

function getManualOrderProductId(productOrId) {
  return getDiscountProductId(productOrId);
}

function getProductManualOrderPriority(productOrId) {
  const key = getManualOrderProductId(productOrId);
  if (!key || key === "0") return 0;
  return clampManualOrderPriority(productManualOrderById?.[key] || 0);
}

function normalizeProductSortMode(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (["default", "manual", "reference", "description", "id"].includes(v))
    return v;
  return "manual";
}

function compareProductTieBreakers(a, b) {
  if (Number(a?.baseProductId || 0) === Number(b?.baseProductId || 0)) {
    return (
      (Number(a?.variantOrder || 0) || 0) - (Number(b?.variantOrder || 0) || 0)
    );
  }

  const nameCmp = PRODUCT_NAME_COLLATOR.compare(
    String(a?.name || ""),
    String(b?.name || ""),
  );
  if (nameCmp !== 0) return nameCmp;

  return PRODUCT_NAME_COLLATOR.compare(
    String(a?.secondaryName || ""),
    String(b?.secondaryName || ""),
  );
}

function compareProductsForDisplay(a, b) {
  if (productSortMode === "default") {
    const sa = Number(a?.sortKey || 0) || 0;
    const sb = Number(b?.sortKey || 0) || 0;
    if (sa !== sb) return sa - sb;

    if (Number(a?.baseProductId || 0) === Number(b?.baseProductId || 0)) {
      return (
        (Number(a?.variantOrder || 0) || 0) -
        (Number(b?.variantOrder || 0) || 0)
      );
    }

    return String(a?.name || "").localeCompare(String(b?.name || ""), "es");
  }

  if (productSortMode === "manual") {
    const priorityA = getProductManualOrderPriority(a);
    const priorityB = getProductManualOrderPriority(b);
    if (priorityA !== priorityB) return priorityA - priorityB;

    const sa = Number(a?.sortKey || 0) || 0;
    const sb = Number(b?.sortKey || 0) || 0;
    if (sa !== sb) return sa - sb;

    return compareProductTieBreakers(a, b);
  }

  if (productSortMode === "reference") {
    const refCmp = PRODUCT_NAME_COLLATOR.compare(
      String(a?.referencia || a?.name || ""),
      String(b?.referencia || b?.name || ""),
    );
    if (refCmp !== 0) return refCmp;
    return compareProductTieBreakers(a, b);
  }

  if (productSortMode === "description") {
    const descCmp = PRODUCT_NAME_COLLATOR.compare(
      String(a?.descripcion || a?.name || ""),
      String(b?.descripcion || b?.name || ""),
    );
    if (descCmp !== 0) return descCmp;
    return compareProductTieBreakers(a, b);
  }

  if (productSortMode === "id") {
    const idCmp =
      (Number(a?.baseProductId || a?.id || 0) || 0) -
      (Number(b?.baseProductId || b?.id || 0) || 0);
    if (idCmp !== 0) return idCmp;
    return compareProductTieBreakers(a, b);
  }

  return compareProductTieBreakers(a, b);
}

function applyDiscountToNetPrice(baseNet, discountPct) {
  const net = Number(baseNet) || 0;
  const pct = clampDiscountPercent(discountPct);
  const factor = 1 - pct / 100;
  return Number((net * factor).toFixed(8));
}

function buildProductWithAppliedDiscount(product) {
  if (!product) return product;

  const pct = getProductDiscountPercent(product);
  if (!(pct > 0)) return product;

  const baseNet = Number(product.price || 0) || 0;
  const discountedNet = applyDiscountToNetPrice(baseNet, pct);

  return {
    ...product,
    price: discountedNet,
    discountPctApplied: pct,
    discountBaseNetPrice: baseNet,
  };
}

function normalizeTariffApplyMode(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeTariffRow(row) {
  const codtarifa = String(row?.codtarifa || "").trim();
  if (!codtarifa) return null;

  return {
    codtarifa,
    nombre: String(row?.nombre || `Tarifa ${codtarifa}`).trim(),
    aplicar: normalizeTariffApplyMode(row?.aplicar),
    valorx: parseNumericLike(row?.valorx, 0),
    valory: parseNumericLike(row?.valory, 0),
    mincoste: !!row?.mincoste,
    maxpvp: !!row?.maxpvp,
    _raw: row || null,
  };
}

function findTariffByCode(codtarifa) {
  const code = String(codtarifa || "").trim();
  if (!code) return null;

  if (customerTariffByCode[code]) return customerTariffByCode[code];

  const codeKey = normalizeTariffCodeKey(code);
  return (
    customerTariffCatalog.find(
      (item) => normalizeTariffCodeKey(item?.codtarifa) === codeKey,
    ) || null
  );
}

function getTariffSummaryText(tariff) {
  if (!tariff) return "Sin tarifa seleccionada.";

  const discountText = getTariffDiscountDisplayText(tariff);
  const customers =
    tariffAssignedCustomersByCode[String(tariff.codtarifa || "")] || [];

  if (customers.length) {
    const names = customers
      .map((c) => String(c?.nombre || "").trim())
      .filter(Boolean);

    if (names.length <= 2) {
      return `${tariff.nombre} · Ajuste actual: ${discountText} · Cliente${names.length > 1 ? "s" : ""} "${names.join('", "')}"`;
    }

    const preview = names.slice(0, 2).join('", "');
    const extra = names.length - 2;
    return `${tariff.nombre} · Ajuste actual: ${discountText} · Clientes "${preview}" y ${extra} más`;
  }

  return `${tariff.nombre} · Ajuste actual: ${discountText} · Sin cliente asignado`;
}

function getUnitGrossBase(item) {
  const v = item?.grossPriceOverride;
  if (typeof v === "number" && isFinite(v) && v >= 0) return v;
  if (typeof item?.grossPrice === "number" && isFinite(item.grossPrice))
    return item.grossPrice;
  return Number(item?.price || 0);
}

function getUnitCostGrossBase(item) {
  const directCandidates = [
    item?.costGrossOverride,
    item?.costGross,
    item?.costeGross,
    item?.grossCost,
  ];

  for (const v of directCandidates) {
    const n = Number(v);
    if (isFinite(n) && n > 0) return n;
  }

  const netCandidates = [
    item?.costNet,
    item?.coste,
    item?.precioCoste,
    item?.costPrice,
    item?.pcoste,
    item?.cost,
  ];

  for (const v of netCandidates) {
    const net = Number(v);
    if (!isFinite(net) || net <= 0) continue;
    const taxRate = Number(item?.taxRate || 0) || 0;
    return round2(net * (1 + taxRate / 100));
  }

  return 0;
}

function getTariffAdjustedGross(baseGross, tariff, opts = {}) {
  const base = Number(baseGross || 0);
  if (!isFinite(base) || base <= 0 || !tariff) {
    return {
      applied: false,
      finalGross: Math.max(0, base),
      discountPct: 0,
      discountFixed: 0,
      mode: "pvp",
    };
  }

  const mode = normalizeTariffApplyMode(tariff.aplicar);
  const pct = clampDiscountPercent(parseNumericLike(tariff.valorx, 0));
  const fix = Math.max(0, round2(parseNumericLike(tariff.valory, 0)));
  const costGross = Number(opts?.costGross || 0);
  const hasCostGross = isFinite(costGross) && costGross > 0;

  let finalGross = base;
  if (mode === "coste") {
    const costBase = hasCostGross ? costGross : base;
    finalGross = costBase * (1 + pct / 100) + fix;
    if (tariff.mincoste && hasCostGross) {
      finalGross = Math.max(finalGross, costGross);
    }
    if (tariff.maxpvp) {
      finalGross = Math.min(finalGross, base);
    }
  } else {
    finalGross = base * (1 - pct / 100) - fix;
    if (tariff.mincoste && hasCostGross) {
      finalGross = Math.max(finalGross, costGross);
    }
    if (tariff.maxpvp) {
      finalGross = Math.min(finalGross, base);
    }
  }

  finalGross = Math.max(0, round2(finalGross));

  const applied = round2(finalGross) !== round2(base);
  return {
    applied,
    finalGross,
    discountPct: applied ? pct : 0,
    discountFixed: applied ? fix : 0,
    mode: mode === "coste" ? "coste" : "pvp",
  };
}

function getCartLinePricing(item) {
  const baseUnitGross = Number(getUnitGrossBase(item) || 0);
  const baseCostGross = Number(getUnitCostGrossBase(item) || 0);
  const manualPriceLocked = hasLockedManualUnitPrice(item);

  const tariffResult = getTariffAdjustedGross(
    baseUnitGross,
    activeCustomerTariff,
    { costGross: baseCostGross },
  );
  const tariffUnitGross = tariffResult.applied
    ? tariffResult.finalGross
    : baseUnitGross;
  const cartDiscount = getEffectiveCartDiscountForLine(item);
  const cartDiscountApplied = cartDiscount.pct > 0;
  const unitGross = cartDiscountApplied
    ? round2(tariffUnitGross * (1 - cartDiscount.pct / 100))
    : tariffUnitGross;

  const qty = Number(item?.qty || 0) || 0;
  const baseLineTotal = round2(baseUnitGross * qty);
  const lineTotal = round2(unitGross * qty);

  return {
    unitGross,
    lineTotal,
    baseUnitGross,
    tariffUnitGross,
    baseLineTotal,
    tariffApplied: !!tariffResult.applied,
    tariffDiscountPct: tariffResult.discountPct,
    tariffDiscountFixed: tariffResult.discountFixed,
    tariffMode: tariffResult.mode,
    cartDiscountApplied,
    cartDiscountPct: cartDiscount.pct,
    cartDiscountSource: cartDiscount.source,
    manualPriceLocked,
    anyPricingAdjustment: !!tariffResult.applied || cartDiscountApplied,
  };
}

function clampProductTileMinSize(value) {
  const n = Math.round(Number(value) || PRODUCT_TILE_MIN_SIZE_DEFAULT);
  return Math.max(
    PRODUCT_TILE_MIN_SIZE_MIN,
    Math.min(PRODUCT_TILE_MIN_SIZE_MAX, n),
  );
}

function applyProductTileMinSizeCssVar() {
  document.documentElement.style.setProperty(
    "--product-tile-min-size",
    `${clampProductTileMinSize(productTileMinSize)}px`,
  );
}

function parseBoolLike(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

async function loadProductStockToggle() {
  const el = document.getElementById("productStockToggle");
  let enabled = false;

  try {
    const cfgVal = await window.TPV_CFG?.get?.(OPTIONS_SHOW_PRODUCT_STOCK_KEY);
    if (typeof cfgVal === "boolean") {
      enabled = cfgVal;
    } else if (typeof cfgVal === "string") {
      const normalized = cfgVal.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") enabled = true;
      else if (normalized === "false" || normalized === "0") enabled = false;
    }
  } catch {}

  showProductStockBadge = !!enabled;
  if (el) el.checked = showProductStockBadge;
}

async function loadProductStockEditionToggle() {
  const el = document.getElementById("productStockEditToggle");
  let enabled = false;

  try {
    const cfgVal = await window.TPV_CFG?.get?.(OPTIONS_ENABLE_STOCK_EDIT_KEY);
    if (typeof cfgVal === "boolean") {
      enabled = cfgVal;
    } else if (typeof cfgVal === "string") {
      const normalized = cfgVal.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") enabled = true;
      else if (normalized === "false" || normalized === "0") enabled = false;
    }
  } catch {}

  enableProductStockEdition = !!enabled;
  if (el) el.checked = enableProductStockEdition;
}

async function loadAllowCloseWithParkedToggle() {
  const el = document.getElementById("allowCloseWithParkedToggle");
  let enabled = false;
  let hasCfgValue = false;

  try {
    const cfgVal = await window.TPV_CFG?.get?.(
      OPTIONS_ALLOW_CLOSE_WITH_PARKED_KEY,
    );
    if (cfgVal !== undefined && cfgVal !== null && cfgVal !== "") {
      enabled = parseBoolLike(cfgVal, false);
      hasCfgValue = true;
    }
  } catch {}

  if (!hasCfgValue) {
    try {
      const lsVal = localStorage.getItem(LS_ALLOW_CLOSE_WITH_PARKED_KEY);
      if (lsVal !== null) enabled = parseBoolLike(lsVal, false);
    } catch {}
  }

  allowCloseWithParkedTickets = !!enabled;
  if (el) el.checked = allowCloseWithParkedTickets;
}

async function loadParkStockWarningToggle() {
  const el = document.getElementById("parkStockWarningToggle");
  let enabled = true;

  try {
    const cfgVal = await window.TPV_CFG?.get?.(
      OPTIONS_SHOW_PARK_STOCK_WARNING_KEY,
    );
    if (cfgVal !== undefined && cfgVal !== null && cfgVal !== "") {
      enabled = parseBoolLike(cfgVal, true);
    }
  } catch {}

  showParkStockWarning = !!enabled;
  if (el) el.checked = showParkStockWarning;
}

async function loadProductDiscountConfig() {
  let map = { ...productDiscountPctById };

  try {
    const rawStr = String(
      sessionStorage.getItem(PRODUCT_DISCOUNTS_SESSION_KEY) || "",
    ).trim();
    if (!rawStr) {
      productDiscountPctById = map;
      return;
    }

    const raw = JSON.parse(rawStr);
    map = {};
    Object.entries(raw || {}).forEach(([k, v]) => {
      const id = String(Number(k) || 0);
      if (!id || id === "0") return;
      const pct = clampDiscountPercent(v);
      if (pct > 0) map[id] = pct;
    });
  } catch {
    // Mantener descuentos ya cargados en memoria si falla parseo.
  }

  productDiscountPctById = map;
}

async function saveProductDiscountConfig() {
  if (isSafeTrainingModeEnabled()) return;
  try {
    sessionStorage.setItem(
      PRODUCT_DISCOUNTS_SESSION_KEY,
      JSON.stringify(productDiscountPctById || {}),
    );
  } catch (e) {
    console.warn("No se pudo guardar descuentos de productos:", e);
  }
}

async function setProductDiscountPercentForProduct(productOrId, pct) {
  const key = getDiscountProductId(productOrId);
  if (!key || key === "0") return;

  const next = clampDiscountPercent(pct);
  if (next > 0) productDiscountPctById[key] = next;
  else delete productDiscountPctById[key];

  await saveProductDiscountConfig();
}

async function loadProductManualOrderConfig() {
  let map = {};

  try {
    const raw = await window.TPV_CFG?.get?.(OPTIONS_PRODUCT_MANUAL_ORDER_KEY);
    if (raw && typeof raw === "object") {
      map = raw;
    } else if (typeof raw === "string" && raw.trim()) {
      map = JSON.parse(raw);
    }
  } catch {
    map = {};
  }

  const normalized = {};
  Object.entries(map || {}).forEach(([k, v]) => {
    const id = String(Number(k) || 0);
    if (!id || id === "0") return;
    const priority = clampManualOrderPriority(v);
    if (priority !== 0) normalized[id] = priority;
  });

  productManualOrderById = normalized;
}

async function saveProductManualOrderConfig() {
  if (isSafeTrainingModeEnabled()) return;
  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_PRODUCT_MANUAL_ORDER_KEY,
      productManualOrderById,
    );
  } catch (e) {
    console.warn("No se pudo guardar prioridad manual de productos:", e);
  }
}

async function setProductManualOrderPriorityForProduct(productOrId, priority) {
  const key = getManualOrderProductId(productOrId);
  if (!key || key === "0") return;

  const next = clampManualOrderPriority(priority);
  if (next !== 0) productManualOrderById[key] = next;
  else delete productManualOrderById[key];

  await saveProductManualOrderConfig();
}

async function loadProductSortModeSetting() {
  let mode = "manual";
  try {
    mode = normalizeProductSortMode(
      await window.TPV_CFG?.get?.(OPTIONS_PRODUCT_SORT_MODE_KEY),
    );
  } catch {
    mode = "manual";
  }

  productSortMode = mode;
  if (productSortModeSelect) productSortModeSelect.value = mode;
}

async function saveProductSortModeSetting(mode) {
  productSortMode = normalizeProductSortMode(mode);
  try {
    await window.TPV_CFG?.set?.(OPTIONS_PRODUCT_SORT_MODE_KEY, productSortMode);
  } catch (e) {
    console.warn("No se pudo guardar orden de productos:", e);
  }
}

async function loadProductReorderModeSetting() {
  let enabled = false;
  try {
    enabled = parseBoolLike(
      await window.TPV_CFG?.get?.(OPTIONS_PRODUCT_REORDER_MODE_KEY),
      false,
    );
  } catch {
    enabled = false;
  }

  productReorderMode = !!enabled;
  if (productReorderModeToggle) productReorderModeToggle.checked = !!enabled;
}

async function saveProductReorderModeSetting(enabled) {
  productReorderMode = !!enabled;
  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_PRODUCT_REORDER_MODE_KEY,
      productReorderMode,
    );
  } catch (e) {
    console.warn("No se pudo guardar modo de reordenar:", e);
  }
}

function applyInfoBarVisibilityUi() {
  const row = document.querySelector(".cart-terminal-row");
  const cashInfoEl = document.getElementById("cashInfo");
  if (row) row.style.display = infoBarVisible ? "" : "none";

  if (terminalMetaItemEl) {
    terminalMetaItemEl.style.display =
      infoBarVisible && infoBarShowTerminal ? "" : "none";
  }
  if (agentMetaItemEl) {
    agentMetaItemEl.style.display =
      infoBarVisible && infoBarShowAgent ? "" : "none";
  }
  if (userMetaItemEl) {
    userMetaItemEl.style.display =
      infoBarVisible && infoBarShowUser ? "" : "none";
  }
  if (cashInfoEl) {
    cashInfoEl.style.display = infoBarVisible && infoBarShowCash ? "" : "none";
  }

  if (infoBarVisibleToggle) infoBarVisibleToggle.checked = !!infoBarVisible;
  if (infoBarShowTerminalToggle) {
    infoBarShowTerminalToggle.checked = !!infoBarShowTerminal;
    infoBarShowTerminalToggle.disabled = !infoBarVisible;
  }
  if (infoBarShowAgentToggle) {
    infoBarShowAgentToggle.checked = !!infoBarShowAgent;
    infoBarShowAgentToggle.disabled = !infoBarVisible;
  }
  if (infoBarShowUserToggle) {
    infoBarShowUserToggle.checked = !!infoBarShowUser;
    infoBarShowUserToggle.disabled = !infoBarVisible;
  }
  if (infoBarShowCashToggle) {
    infoBarShowCashToggle.checked = !!infoBarShowCash;
    infoBarShowCashToggle.disabled = !infoBarVisible;
  }

  const showAltTerminal = !infoBarVisible || !infoBarShowTerminal;
  const showAltAgent = !infoBarVisible || !infoBarShowAgent;
  const showAltUser = !infoBarVisible || !infoBarShowUser;
  if (infoBarAltTerminalBtn)
    infoBarAltTerminalBtn.style.display = showAltTerminal ? "" : "none";
  if (infoBarAltAgentBtn)
    infoBarAltAgentBtn.style.display = showAltAgent ? "" : "none";
  if (infoBarAltUserBtn)
    infoBarAltUserBtn.style.display = showAltUser ? "" : "none";
}

async function loadInfoBarVisibilitySettings() {
  try {
    infoBarVisible = parseBoolLike(
      await window.TPV_CFG?.get?.(OPTIONS_INFOBAR_VISIBLE_KEY),
      true,
    );
    infoBarShowTerminal = parseBoolLike(
      await window.TPV_CFG?.get?.(OPTIONS_INFOBAR_SHOW_TERMINAL_KEY),
      true,
    );
    infoBarShowAgent = parseBoolLike(
      await window.TPV_CFG?.get?.(OPTIONS_INFOBAR_SHOW_AGENT_KEY),
      true,
    );
    infoBarShowUser = parseBoolLike(
      await window.TPV_CFG?.get?.(OPTIONS_INFOBAR_SHOW_USER_KEY),
      true,
    );
    infoBarShowCash = parseBoolLike(
      await window.TPV_CFG?.get?.(OPTIONS_INFOBAR_SHOW_CASH_KEY),
      true,
    );
  } catch {}

  applyInfoBarVisibilityUi();
}

async function saveInfoBarVisibilitySettings() {
  try {
    await window.TPV_CFG?.set?.(OPTIONS_INFOBAR_VISIBLE_KEY, !!infoBarVisible);
    await window.TPV_CFG?.set?.(
      OPTIONS_INFOBAR_SHOW_TERMINAL_KEY,
      !!infoBarShowTerminal,
    );
    await window.TPV_CFG?.set?.(
      OPTIONS_INFOBAR_SHOW_AGENT_KEY,
      !!infoBarShowAgent,
    );
    await window.TPV_CFG?.set?.(
      OPTIONS_INFOBAR_SHOW_USER_KEY,
      !!infoBarShowUser,
    );
    await window.TPV_CFG?.set?.(
      OPTIONS_INFOBAR_SHOW_CASH_KEY,
      !!infoBarShowCash,
    );
  } catch (e) {
    console.warn("No se pudo guardar visibilidad de barra:", e);
  }
}

function refreshProductStockFilterUIState() {
  if (productsStockOnlyToggle) {
    productsStockOnlyToggle.checked = !!productsFilterStockOnly;
  }

  const includeWrapper = productsIncludeUnmanagedToggle?.closest(
    ".product-filter-check, .opt-row",
  );

  if (productsFilterStockOnly) {
    productsFilterIncludeUnmanaged = false;
    if (productsIncludeUnmanagedToggle) {
      productsIncludeUnmanagedToggle.checked = false;
      productsIncludeUnmanagedToggle.disabled = true;
    }
    includeWrapper?.classList.add("hidden");
  } else {
    productsFilterIncludeUnmanaged = !!productsFilterIncludeUnmanagedSnapshot;
    if (productsIncludeUnmanagedToggle) {
      productsIncludeUnmanagedToggle.checked = !!productsFilterIncludeUnmanaged;
      productsIncludeUnmanagedToggle.disabled = false;
    }
    includeWrapper?.classList.remove("hidden");
  }

  if (productsIncludeUnmanagedToggle) {
    productsIncludeUnmanagedToggle.checked = !!productsFilterIncludeUnmanaged;
  }
}

async function loadProductTileSizeSetting() {
  const raw = await window.TPV_CFG?.get?.(OPTIONS_PRODUCT_TILE_SIZE_KEY);
  const parsed = Number(raw);
  if (isFinite(parsed)) {
    productTileMinSize = clampProductTileMinSize(parsed);
  } else {
    productTileMinSize = PRODUCT_TILE_MIN_SIZE_DEFAULT;
  }

  applyProductTileMinSizeCssVar();
}

async function saveProductTileSizeSetting() {
  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_PRODUCT_TILE_SIZE_KEY,
      clampProductTileMinSize(productTileMinSize),
    );
  } catch (e) {
    console.warn("No se pudo guardar tamaño de productos:", e);
  }
}

async function setProductTileMinSize(nextSize, opts = {}) {
  const { persist = true, rerender = false } = opts;
  productTileMinSize = clampProductTileMinSize(nextSize);
  applyProductTileMinSizeCssVar();
  if (persist) await saveProductTileSizeSetting();
  if (rerender) renderProducts?.();
}

async function loadProductTileResizeModeToggle() {
  const el = document.getElementById("productTileResizeModeToggle");
  let enabled = false;

  try {
    const cfgVal = await window.TPV_CFG?.get?.(
      OPTIONS_PRODUCT_TILE_RESIZE_MODE_KEY,
    );
    enabled = parseBoolLike(cfgVal, false);
  } catch {}

  productTileResizeMode = !!enabled;
  if (el) el.checked = productTileResizeMode;
}

async function loadScaleManualCaptureModeToggle() {
  const el = document.getElementById("scaleManualCaptureToggle");
  let enabled = false;

  try {
    enabled = parseBoolLike(
      await window.TPV_CFG?.get?.(OPTIONS_SCALE_MANUAL_CAPTURE_MODE_KEY),
      false,
    );
  } catch {
    enabled = false;
  }

  scaleManualCaptureMode = !!enabled;
  if (el) el.checked = scaleManualCaptureMode;
}

async function saveProductTileResizeModeToggle(enabled) {
  productTileResizeMode = !!enabled;

  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_PRODUCT_TILE_RESIZE_MODE_KEY,
      productTileResizeMode,
    );
  } catch (e) {
    console.warn("No se pudo guardar modo redimensionar productos:", e);
  }
}

async function saveScaleManualCaptureModeToggle(enabled) {
  scaleManualCaptureMode = !!enabled;

  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_SCALE_MANUAL_CAPTURE_MODE_KEY,
      scaleManualCaptureMode,
    );
  } catch (e) {
    console.warn("No se pudo guardar modo manual de báscula:", e);
  }
}

async function saveProductStockToggle(enabled) {
  showProductStockBadge = !!enabled;

  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_SHOW_PRODUCT_STOCK_KEY,
      showProductStockBadge,
    );
  } catch (e) {
    console.warn("No se pudo guardar toggle de stock en productos:", e);
  }
}

async function saveProductStockEditionToggle(enabled) {
  enableProductStockEdition = !!enabled;

  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_ENABLE_STOCK_EDIT_KEY,
      enableProductStockEdition,
    );
  } catch (e) {
    console.warn("No se pudo guardar toggle de edición de stock:", e);
  }
}

async function saveAllowCloseWithParkedToggle(enabled) {
  allowCloseWithParkedTickets = !!enabled;

  try {
    localStorage.setItem(
      LS_ALLOW_CLOSE_WITH_PARKED_KEY,
      allowCloseWithParkedTickets ? "1" : "0",
    );
  } catch {}

  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_ALLOW_CLOSE_WITH_PARKED_KEY,
      allowCloseWithParkedTickets,
    );
  } catch (e) {
    console.warn("No se pudo guardar toggle de cierre con aparcados:", e);
  }
}

async function saveParkStockWarningToggle(enabled) {
  showParkStockWarning = !!enabled;

  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_SHOW_PARK_STOCK_WARNING_KEY,
      showParkStockWarning,
    );
  } catch (e) {
    console.warn("No se pudo guardar toggle de aviso de stock al aparcar:", e);
  }
}

async function loadCartDiscountToolsToggle() {
  const el = document.getElementById("cartDiscountToolsToggle");
  let enabled = false;

  try {
    enabled = parseBoolLike(
      await window.TPV_CFG?.get?.(OPTIONS_CART_DISCOUNT_TOOLS_KEY),
      false,
    );
  } catch {
    enabled = false;
  }

  cartDiscountToolsEnabled = !!enabled;
  if (el) el.checked = cartDiscountToolsEnabled;

  if (!cartDiscountToolsEnabled) {
    cartGlobalDiscountPct = 0;
    clearAllCartLineDiscounts();
  }

  refreshCartDiscountUi?.();
}

async function saveCartDiscountToolsToggle(enabled) {
  cartDiscountToolsEnabled = !!enabled;
  if (!cartDiscountToolsEnabled) {
    cartGlobalDiscountPct = 0;
    clearAllCartLineDiscounts();
  }

  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_CART_DISCOUNT_TOOLS_KEY,
      cartDiscountToolsEnabled,
    );
  } catch (e) {
    console.warn("No se pudo guardar toggle descuentos carrito:", e);
  }

  renderCart?.();
}

async function loadSafeTrainingModeToggle() {
  const el = document.getElementById("safeTrainingModeToggle");
  let enabled = false;
  let hasCfgValue = false;

  try {
    const cfgVal = await window.TPV_CFG?.get?.(OPTIONS_SAFE_TRAINING_MODE_KEY);
    if (cfgVal !== undefined && cfgVal !== null && cfgVal !== "") {
      enabled = parseBoolLike(cfgVal, false);
      hasCfgValue = true;
    }
  } catch {}

  if (!hasCfgValue) {
    try {
      const lsVal = localStorage.getItem(TPV_SAFE_TRAINING_MODE_LS_KEY);
      if (lsVal !== null) enabled = parseBoolLike(lsVal, false);
    } catch {}
  }

  safeTrainingModeEnabled = !!enabled;
  applySafeTrainingModeUi();
  if (el) el.checked = safeTrainingModeEnabled;
}

async function saveSafeTrainingModeToggle(enabled) {
  safeTrainingModeEnabled = !!enabled;
  applySafeTrainingModeUi();

  try {
    localStorage.setItem(
      TPV_SAFE_TRAINING_MODE_LS_KEY,
      safeTrainingModeEnabled ? "1" : "0",
    );
  } catch {}

  try {
    await window.TPV_CFG?.set?.(
      OPTIONS_SAFE_TRAINING_MODE_KEY,
      safeTrainingModeEnabled,
    );
  } catch (e) {
    console.warn("No se pudo guardar modo pruebas seguro:", e);
  }

  if (safeTrainingModeEnabled) {
    setStatusText?.("Modo pruebas activo: sin envios a FacturaScripts/API");
  } else {
    setStatusText?.("Modo pruebas desactivado");
  }
}

function bindSafeTrainingModeToggleOnce() {
  if (safeTrainingModeToggleBound) return;
  safeTrainingModeToggleBound = true;

  const el = document.getElementById("safeTrainingModeToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    const wanted = !!el.checked;
    const current = isSafeTrainingModeEnabled();
    if (wanted === current) return;

    if (wanted) {
      const ok = await confirmModal(
        "Entrar en entorno de pruebas",
        "Vas a entrar en el entorno de pruebas.\n\nSe guardará el estado actual y todo funcionará en modo simulación (sin enviar datos a FacturaScripts/API).\n\n¿Continuar?",
      );
      if (!ok) {
        el.checked = current;
        return;
      }

      await enterSafeTrainingMode();
      refreshOptionsUI?.();
      closeOptions?.();
      return;
    }

    const ok = await confirmModal(
      "Salir del entorno de pruebas",
      "Vas a salir del entorno de pruebas.\n\nSe restaurará el estado que tenías justo antes de entrar.\n\n¿Continuar?",
    );
    if (!ok) {
      el.checked = current;
      return;
    }

    await exitSafeTrainingMode();
    refreshOptionsUI?.();
    closeOptions?.();
  });
}

let productStockToggleBound = false;
let productStockEditionToggleBound = false;
let allowCloseWithParkedToggleBound = false;
let parkStockWarningToggleBound = false;
let productTileResizeModeToggleBound = false;
let scaleManualCaptureToggleBound = false;
let productTileSizeResetBtnBound = false;
let productSortModeBound = false;
let productReorderModeBound = false;
let productManualOrderResetBtnBound = false;
let infoBarVisibilityBound = false;

function bindProductStockToggleOnce() {
  if (productStockToggleBound) return;
  productStockToggleBound = true;

  const el = document.getElementById("productStockToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    const wanted = !!el.checked;
    await saveProductStockToggle(wanted);
    renderProducts?.();
    updateRenderedProductStocks?.();
  });
}

function bindProductStockEditionToggleOnce() {
  if (productStockEditionToggleBound) return;
  productStockEditionToggleBound = true;

  const el = document.getElementById("productStockEditToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    const wanted = !!el.checked;
    await saveProductStockEditionToggle(wanted);
    renderProducts?.();
  });
}

function bindAllowCloseWithParkedToggleOnce() {
  if (allowCloseWithParkedToggleBound) return;
  allowCloseWithParkedToggleBound = true;

  const el = document.getElementById("allowCloseWithParkedToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    const wanted = !!el.checked;
    await saveAllowCloseWithParkedToggle(wanted);
  });
}

function bindCartDiscountToolsToggleOnce() {
  if (cartDiscountToolsToggleBound) return;
  cartDiscountToolsToggleBound = true;

  const el = document.getElementById("cartDiscountToolsToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    const wanted = !!el.checked;
    await saveCartDiscountToolsToggle(wanted);
  });
}

async function loadTariffCustomersCache(opts = {}) {
  const force = !!opts?.force;
  if (tariffCustomersCache.length && !force) return tariffCustomersCache;

  try {
    const rows = await fetchApiResourceWithParams("clientes", {
      "sort[codcliente]": "DESC",
      limit: 0,
    });

    tariffCustomersCache = (Array.isArray(rows) ? rows : [])
      .filter((c) => !c?.debaja)
      .map((c) => ({
        codcliente: String(c?.codcliente || "").trim(),
        nombre: String(c?.nombre || c?.razonsocial || "").trim(),
        codtarifa: String(c?.codtarifa || "").trim(),
      }))
      .filter((c) => !!c.codcliente);
  } catch (e) {
    console.warn("No se pudieron cargar clientes para tarifas:", e);
    tariffCustomersCache = [];
  }

  return tariffCustomersCache;
}

function getSelectedTariffCodeInOptions() {
  const sel = document.getElementById("tariffSelect");
  return String(sel?.value || "").trim();
}

function renderTariffSummaryInOptions(tariff) {
  const summary = document.getElementById("tariffSummaryText");
  if (!summary) return;
  summary.textContent = getTariffSummaryText(tariff);
}

function renderTariffEditorFields(tariff) {
  const nameInp = document.getElementById("tariffNameInput");
  const formulaSel = document.getElementById("tariffFormulaSelect");
  const valXInp = document.getElementById("tariffValorXInput");
  const valYInp = document.getElementById("tariffValorYInput");
  const minToggle = document.getElementById("tariffMinCosteToggle");
  const maxToggle = document.getElementById("tariffMaxPvpToggle");
  const saveBtn = document.getElementById("tariffSaveAllBtn");
  const revertBtn = document.getElementById("tariffRevertBtn");
  const deleteBtn = document.getElementById("tariffDeleteBtn");

  const disabled = !tariff;
  if (nameInp) {
    nameInp.disabled = disabled;
    nameInp.value = disabled ? "" : String(tariff.nombre || "").trim();
  }

  if (formulaSel) {
    formulaSel.disabled = disabled;
    formulaSel.value = disabled
      ? "pvp"
      : normalizeTariffApplyMode(tariff.aplicar) === "coste"
        ? "coste"
        : "pvp";
  }

  if (valXInp) {
    valXInp.disabled = disabled;
    valXInp.value = disabled ? "" : String(Number(tariff.valorx || 0));
  }

  if (valYInp) {
    valYInp.disabled = disabled;
    valYInp.value = disabled ? "" : String(Number(tariff.valory || 0));
  }

  if (minToggle) {
    minToggle.disabled = disabled;
    minToggle.checked = !disabled && !!tariff.mincoste;
  }

  if (maxToggle) {
    maxToggle.disabled = disabled;
    maxToggle.checked = !disabled && !!tariff.maxpvp;
  }

  if (saveBtn) saveBtn.disabled = disabled;
  if (revertBtn) revertBtn.disabled = disabled;
  if (deleteBtn) deleteBtn.disabled = disabled;
}

function renderTariffSelectOptions(selectedCod = "") {
  const sel = document.getElementById("tariffSelect");
  if (!sel) return;

  if (!customerTariffCatalog.length) {
    sel.innerHTML = `<option value="">(sin tarifas)</option>`;
    sel.disabled = true;
    renderTariffSummaryInOptions(null);
    renderTariffEditorFields(null);
    return;
  }

  sel.disabled = false;
  sel.innerHTML = customerTariffCatalog
    .map((t) => {
      const selected =
        String(t.codtarifa) === String(selectedCod || "") ? "selected" : "";
      const label = `${t.codtarifa} | ${t.nombre}`;
      return `<option value="${escapeHtml(t.codtarifa)}" ${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  if (!sel.value) sel.value = String(customerTariffCatalog[0]?.codtarifa || "");
  const selectedTariff = findTariffByCode(String(sel.value || ""));
  renderTariffSummaryInOptions(selectedTariff);
  renderTariffEditorFields(selectedTariff || null);
}

async function renderTariffCustomerSelectForTariff(codtarifa, opts = {}) {
  const list = document.getElementById("tariffCustomerChecklist");
  if (!list) return;

  const cod = String(codtarifa || "").trim();
  if (!cod) {
    list.innerHTML = `<div class="tariff-customer-check-empty">Selecciona una tarifa.</div>`;
    delete tariffAssignedCustomersByCode[cod];
    updateTariffCustomersSelectedCount(cod);
    return;
  }

  const force = !!opts?.force;
  const keepLocalSelection = opts?.keepLocalSelection !== false;
  const skipBaselineUpdate = !!opts?.skipBaselineUpdate;
  const customers = await loadTariffCustomersCache({ force });

  let serverAssignedCodes = tariffAssignedServerCodesByCode[cod];
  if (!Array.isArray(serverAssignedCodes) || force) {
    try {
      const rows = await fetchApiResourceWithParams("clientes", {
        "filter[codtarifa]": cod,
        limit: 0,
      });
      serverAssignedCodes = (Array.isArray(rows) ? rows : [])
        .filter((x) => !x?.debaja)
        .map((x) => String(x?.codcliente || "").trim())
        .filter(Boolean);
    } catch (e) {
      console.warn("No se pudo cargar cliente de la tarifa:", e);
      serverAssignedCodes = customers
        .filter((c) => String(c.codtarifa || "") === cod)
        .map((c) => String(c.codcliente || "").trim())
        .filter(Boolean);
    }
    tariffAssignedServerCodesByCode[cod] =
      getUniqueTariffCustomerCodes(serverAssignedCodes);
  }

  const search = getTariffCustomerSearchText();
  const localAssigned = tariffAssignedCustomersByCode[cod] || [];
  const selectedSet = new Set(
    keepLocalSelection && Array.isArray(localAssigned) && localAssigned.length
      ? localAssigned
          .map((x) => String(x?.codcliente || "").trim())
          .filter(Boolean)
      : tariffAssignedServerCodesByCode[cod] || [],
  );
  if (!customers.length) {
    list.innerHTML = `<div class="tariff-customer-check-empty">No hay clientes disponibles.</div>`;
    setAssignedCustomersForTariff(cod, []);
    updateTariffCustomersSelectedCount(cod);
    renderTariffSummaryInOptions(findTariffByCode(cod));
    return;
  }

  const visible = customers.filter((c) => {
    if (!search) return true;
    const hay = `${c.codcliente} ${c.nombre}`.toLowerCase();
    return hay.includes(search);
  });

  const markedVisible = visible.filter((c) =>
    selectedSet.has(String(c.codcliente || "").trim()),
  );
  const unmarkedVisible = visible.filter(
    (c) => !selectedSet.has(String(c.codcliente || "").trim()),
  );

  const renderCustomerRow = (c) => {
    const cc = String(c.codcliente || "").trim();
    const label = `${c.codcliente} | ${c.nombre || "—"}`;
    const checked = selectedSet.has(cc) ? "checked" : "";
    return `<label class="tariff-customer-check-item"><input type="checkbox" data-role="tariff-customer-check" data-codcliente="${escapeHtml(cc)}" ${checked} /><span>${escapeHtml(label)}</span></label>`;
  };

  if (!visible.length) {
    list.innerHTML = `<div class="tariff-customer-check-empty">Sin resultados para la búsqueda.</div>`;
  } else {
    const markedHtml = markedVisible.length
      ? markedVisible.map((c) => renderCustomerRow(c)).join("")
      : `<div class="tariff-customer-check-empty">No hay clientes marcados en este filtro.</div>`;

    const unmarkedHtml = unmarkedVisible.length
      ? unmarkedVisible.map((c) => renderCustomerRow(c)).join("")
      : `<div class="tariff-customer-check-empty">No hay clientes sin marcar en este filtro.</div>`;

    list.innerHTML = `
      <div class="tariff-customer-check-group-title">Clientes marcados (${markedVisible.length})</div>
      ${markedHtml}
      <div class="tariff-customer-check-group-title">Clientes no marcados (${unmarkedVisible.length})</div>
      ${unmarkedHtml}
    `;
  }

  setAssignedCustomersForTariff(
    cod,
    customers
      .filter((c) => selectedSet.has(String(c.codcliente || "").trim()))
      .map((c) => ({
        codcliente: String(c.codcliente || "").trim(),
        nombre: String(c.nombre || "").trim(),
      })),
  );

  updateTariffCustomersSelectedCount(cod);

  if (!skipBaselineUpdate) {
    const tariff = findTariffByCode(cod);
    if (!getTariffEditBaseline(cod) || force) {
      captureTariffEditBaseline(
        cod,
        tariff,
        tariffAssignedServerCodesByCode[cod],
      );
    }
  }

  renderTariffSummaryInOptions(findTariffByCode(cod));
}

async function loadTariffManagerOptionsData(opts = {}) {
  const force = !!opts?.force;
  const prev = getSelectedTariffCodeInOptions();

  try {
    await ensureCustomerTariffsLoaded({ force });
  } catch (e) {
    console.warn("No se pudieron cargar tarifas:", e);
  }

  renderTariffSelectOptions(prev);

  const codtarifa = getSelectedTariffCodeInOptions();
  await renderTariffCustomerSelectForTariff(codtarifa, { force });
}

async function updateClienteCodtarifa(codcliente, codtarifa) {
  const cod = String(codcliente || "").trim();
  if (!cod) throw new Error("Cliente inválido.");

  const payload = {
    codtarifa: String(codtarifa || "").trim(),
  };

  try {
    await apiWrite(`clientes/${encodeURIComponent(cod)}`, "PATCH", payload);
    return;
  } catch {
    await apiWrite(`clientes/${encodeURIComponent(cod)}`, "PUT", payload);
  }
}

async function updateTarifaByCode(codtarifa, payload) {
  const cod = String(codtarifa || "").trim();
  if (!cod) throw new Error("Tarifa inválida.");

  try {
    await apiWrite(`tarifas/${encodeURIComponent(cod)}`, "PATCH", payload);
    return;
  } catch {
    await apiWrite(`tarifas/${encodeURIComponent(cod)}`, "PUT", payload);
  }
}

function buildTariffPayloadFromOptionsForm(opts = {}) {
  const includeName = opts?.includeName !== false;
  const nameInp = document.getElementById("tariffNameInput");
  const formulaSel = document.getElementById("tariffFormulaSelect");
  const valXInp = document.getElementById("tariffValorXInput");
  const valYInp = document.getElementById("tariffValorYInput");
  const minToggle = document.getElementById("tariffMinCosteToggle");
  const maxToggle = document.getElementById("tariffMaxPvpToggle");

  const payload = {
    aplicar:
      normalizeTariffApplyMode(formulaSel?.value) === "coste" ? "coste" : "pvp",
    valorx: clampDiscountPercent(parseNumericLike(valXInp?.value, 0)),
    valory: round2(parseNumericLike(valYInp?.value, 0) || 0),
    mincoste: !!minToggle?.checked,
    maxpvp: !!maxToggle?.checked,
  };

  if (includeName) {
    payload.nombre = String(nameInp?.value || "").trim();
  }

  return payload;
}

async function createTariffFromOptions() {
  const input = document.getElementById("tariffCreateNameInput");
  const btn = document.getElementById("tariffCreateBtn");
  const name = String(input?.value || "").trim();

  if (!name) {
    toast("Escribe un nombre para la nueva tarifa.", "warn", "Tarifas");
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const payload = {
      nombre: name,
      ...buildTariffPayloadFromOptionsForm({ includeName: false }),
    };

    await apiWrite("tarifas", "POST", payload);
    await loadTariffManagerOptionsData({ force: true });

    const found = customerTariffCatalog.find(
      (t) =>
        String(t.nombre || "")
          .trim()
          .toLowerCase() === name.toLowerCase(),
    );

    const tariffSel = document.getElementById("tariffSelect");
    if (tariffSel && found?.codtarifa) {
      tariffSel.value = String(found.codtarifa);
      tariffSel.dispatchEvent(new Event("change"));
    }

    if (input) input.value = "";
    toast("Tarifa creada correctamente.", "ok", "Tarifas");
  } catch (e) {
    toast("No se pudo crear la tarifa: " + (e?.message || e), "err", "Tarifas");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveTariffAndAssignmentFromOptions() {
  const saveBtn = document.getElementById("tariffSaveAllBtn");
  const codtarifa = getSelectedTariffCodeInOptions();
  const targetCustomers =
    tariffAssignedCustomersByCode[String(codtarifa || "")] || [];
  const targetCodes = new Set(
    targetCustomers
      .map((c) => String(c?.codcliente || "").trim())
      .filter(Boolean),
  );

  if (!codtarifa) {
    toast("Selecciona una tarifa válida.", "warn", "Tarifas");
    return;
  }

  const payload = buildTariffPayloadFromOptionsForm({ includeName: true });
  if (!String(payload?.nombre || "").trim()) {
    toast("El nombre de la tarifa no puede estar vacío.", "warn", "Tarifas");
    return;
  }

  if (saveBtn) saveBtn.disabled = true;
  try {
    await updateTarifaByCode(codtarifa, payload);

    const currentRows = await fetchApiResourceWithParams("clientes", {
      "filter[codtarifa]": codtarifa,
      limit: 0,
    });

    const currentAssigned = (Array.isArray(currentRows) ? currentRows : [])
      .filter((c) => !c?.debaja)
      .map((c) => String(c?.codcliente || "").trim())
      .filter(Boolean);

    for (const cod of currentAssigned) {
      if (cod && !targetCodes.has(cod)) {
        await updateClienteCodtarifa(cod, "");
      }
    }

    for (const cod of targetCodes) {
      await updateClienteCodtarifa(cod, codtarifa);
    }

    tariffCustomersCache = [];
    delete tariffAssignedServerCodesByCode[String(codtarifa || "")];
    await loadTariffManagerOptionsData({ force: true });

    await refreshActiveCustomerTariffForSelection(
      window.CUSTOMER_SELECTOR?.getSelectedCustomer?.() || null,
      { forceTariffs: true, forceCustomer: true },
    );

    toast("Tarifa y cliente guardados correctamente.", "ok", "Tarifas");
  } catch (e) {
    toast(
      "No se pudieron guardar los cambios de tarifa: " + (e?.message || e),
      "err",
      "Tarifas",
    );
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteTariffByCode(codtarifa) {
  const cod = String(codtarifa || "").trim();
  if (!cod) throw new Error("Tarifa inválida.");
  await apiWrite(`tarifas/${encodeURIComponent(cod)}`, "DELETE");
}

async function deleteTariffFromOptions() {
  const codtarifa = getSelectedTariffCodeInOptions();
  const saveBtn = document.getElementById("tariffSaveAllBtn");
  const deleteBtn = document.getElementById("tariffDeleteBtn");
  const revertBtn = document.getElementById("tariffRevertBtn");

  if (!codtarifa) {
    toast("Selecciona una tarifa válida.", "warn", "Tarifas");
    return;
  }

  const tariff = findTariffByCode(codtarifa);
  const name = String(tariff?.nombre || `Tarifa ${codtarifa}`).trim();
  const ok = window.confirm(
    `¿Seguro que quieres borrar la tarifa "${name}"? Se desasignará de sus clientes.`,
  );
  if (!ok) return;

  if (saveBtn) saveBtn.disabled = true;
  if (deleteBtn) deleteBtn.disabled = true;
  if (revertBtn) revertBtn.disabled = true;

  try {
    const currentRows = await fetchApiResourceWithParams("clientes", {
      "filter[codtarifa]": codtarifa,
      limit: 0,
    });

    const currentAssigned = (Array.isArray(currentRows) ? currentRows : [])
      .filter((c) => !c?.debaja)
      .map((c) => String(c?.codcliente || "").trim())
      .filter(Boolean);

    for (const cod of currentAssigned) {
      await updateClienteCodtarifa(cod, "");
    }

    await deleteTariffByCode(codtarifa);

    delete tariffAssignedCustomersByCode[String(codtarifa || "")];
    delete tariffAssignedServerCodesByCode[String(codtarifa || "")];
    delete tariffEditBaselineByCode[String(codtarifa || "")];

    tariffCustomersCache = [];
    await loadTariffManagerOptionsData({ force: true });

    await refreshActiveCustomerTariffForSelection(
      window.CUSTOMER_SELECTOR?.getSelectedCustomer?.() || null,
      { forceTariffs: true, forceCustomer: true },
    );

    toast("Tarifa borrada correctamente.", "ok", "Tarifas");
  } catch (e) {
    toast(
      "No se pudo borrar la tarifa: " + (e?.message || e),
      "err",
      "Tarifas",
    );
  } finally {
    const selectedTariff = findTariffByCode(getSelectedTariffCodeInOptions());
    renderTariffEditorFields(selectedTariff || null);
  }
}

async function revertTariffOptionsChanges() {
  const cod = getSelectedTariffCodeInOptions();
  if (!cod) {
    toast("Selecciona una tarifa válida.", "warn", "Tarifas");
    return;
  }

  const baseline = getTariffEditBaseline(cod);
  if (!baseline) {
    await loadTariffManagerOptionsData({ force: true });
    toast(
      "No había estado inicial guardado. Se recargó desde la API.",
      "warn",
      "Tarifas",
    );
    return;
  }

  const nameInp = document.getElementById("tariffNameInput");
  const formulaSel = document.getElementById("tariffFormulaSelect");
  const valXInp = document.getElementById("tariffValorXInput");
  const valYInp = document.getElementById("tariffValorYInput");
  const minToggle = document.getElementById("tariffMinCosteToggle");
  const maxToggle = document.getElementById("tariffMaxPvpToggle");
  const searchInp = document.getElementById("tariffCustomerSearchInput");

  if (nameInp) nameInp.value = String(baseline.nombre || "");
  if (formulaSel)
    formulaSel.value = baseline.aplicar === "coste" ? "coste" : "pvp";
  if (valXInp) valXInp.value = String(baseline.valorx || 0);
  if (valYInp) valYInp.value = String(baseline.valory || 0);
  if (minToggle) minToggle.checked = !!baseline.mincoste;
  if (maxToggle) maxToggle.checked = !!baseline.maxpvp;
  if (searchInp) searchInp.value = String(baseline.searchText || "");

  setAssignedCustomersForTariff(
    cod,
    buildTariffCustomersFromCodes(baseline.assignedCodes),
  );
  await renderTariffCustomerSelectForTariff(cod, {
    force: false,
    keepLocalSelection: true,
    skipBaselineUpdate: true,
  });

  renderTariffSummaryInOptions(findTariffByCode(cod));
  toast("Cambios revertidos al estado inicial.", "ok", "Tarifas");
}

function bindTariffInputVirtualKeyboardsOnce() {
  if (tariffInputKeyboardBound) return;
  tariffInputKeyboardBound = true;

  const createNameInput = document.getElementById("tariffCreateNameInput");
  const tariffNameInput = document.getElementById("tariffNameInput");
  const valueXInput = document.getElementById("tariffValorXInput");
  const valueYInput = document.getElementById("tariffValorYInput");

  const openTariffNumPad = (inputEl, label) => {
    if (!inputEl) return;

    const raw = String(inputEl.value || "")
      .trim()
      .replace(",", ".");
    const initial = raw === "" ? 0 : Number(raw);

    openNumPad(
      Number.isFinite(initial) ? initial : 0,
      (nextValue, meta = {}) => {
        if (meta?.phase !== "confirm") return;

        const n = Number(nextValue);
        if (!Number.isFinite(n)) return;

        inputEl.value = String(round2(n));
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      },
      label,
      "qty",
      null,
      null,
    );
  };

  const bindPointerOpen = (inputEl, openFn) => {
    if (!inputEl || typeof openFn !== "function") return;

    inputEl.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      openFn();
    });
  };

  bindPointerOpen(createNameInput, () => {
    window.TPV_QWERTY?.openForInput?.(createNameInput, "text");
  });

  bindPointerOpen(tariffNameInput, () => {
    window.TPV_QWERTY?.openForInput?.(tariffNameInput, "text");
  });

  bindPointerOpen(valueXInput, () => {
    openTariffNumPad(valueXInput, "Tarifa %");
  });

  bindPointerOpen(valueYInput, () => {
    openTariffNumPad(valueYInput, "Tarifa €");
  });
}

function bindTariffOptionsOnce() {
  if (tariffOptionsBound) return;
  tariffOptionsBound = true;

  const tariffSel = document.getElementById("tariffSelect");
  const refreshBtn = document.getElementById("tariffRefreshBtn");
  const createBtn = document.getElementById("tariffCreateBtn");
  const saveAllBtn = document.getElementById("tariffSaveAllBtn");
  const revertBtn = document.getElementById("tariffRevertBtn");
  const deleteBtn = document.getElementById("tariffDeleteBtn");
  const customerList = document.getElementById("tariffCustomerChecklist");
  const customerSearchInput = document.getElementById(
    "tariffCustomerSearchInput",
  );
  const customerSearchKbBtn = document.getElementById(
    "tariffCustomerSearchKeyboardBtn",
  );
  const selectVisibleBtn = document.getElementById(
    "tariffCustomersSelectVisibleBtn",
  );
  const clearVisibleBtn = document.getElementById(
    "tariffCustomersClearVisibleBtn",
  );

  bindTariffInputVirtualKeyboardsOnce();

  tariffSel?.addEventListener("change", async () => {
    const customerSearchInput = document.getElementById(
      "tariffCustomerSearchInput",
    );
    if (customerSearchInput) customerSearchInput.value = "";

    const cod = getSelectedTariffCodeInOptions();
    const tariff = findTariffByCode(cod);
    renderTariffSummaryInOptions(tariff);
    renderTariffEditorFields(tariff);
    await renderTariffCustomerSelectForTariff(cod, { force: false });
  });

  refreshBtn?.addEventListener("click", async () => {
    await loadTariffManagerOptionsData({ force: true });
  });

  createBtn?.addEventListener("click", async () => {
    await createTariffFromOptions();
  });

  saveAllBtn?.addEventListener("click", async () => {
    await saveTariffAndAssignmentFromOptions();
  });

  revertBtn?.addEventListener("click", async () => {
    await revertTariffOptionsChanges();
  });

  deleteBtn?.addEventListener("click", async () => {
    await deleteTariffFromOptions();
  });

  customerSearchInput?.addEventListener("input", async () => {
    const cod = getSelectedTariffCodeInOptions();
    await renderTariffCustomerSelectForTariff(cod, {
      force: false,
      keepLocalSelection: true,
      skipBaselineUpdate: true,
    });
  });

  customerSearchInput?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    window.TPV_QWERTY?.openForInput?.(customerSearchInput, "text");
  });

  customerSearchKbBtn?.addEventListener("click", () => {
    if (!customerSearchInput) return;
    window.TPV_QWERTY?.openForInput?.(customerSearchInput, "text");
  });

  selectVisibleBtn?.addEventListener("click", async () => {
    const cod = getSelectedTariffCodeInOptions();
    const selected = getAssignedCustomerSetForTariff(cod);
    const checks = Array.from(
      customerList?.querySelectorAll(
        'input[data-role="tariff-customer-check"]',
      ) || [],
    );

    checks.forEach((el) => {
      const cc = String(el.getAttribute("data-codcliente") || "").trim();
      if (cc) selected.add(cc);
      el.checked = true;
    });

    const customers = tariffCustomersCache || [];
    setAssignedCustomersForTariff(
      cod,
      customers.filter((c) => selected.has(String(c?.codcliente || "").trim())),
    );
    updateTariffCustomersSelectedCount(cod);
    renderTariffSummaryInOptions(findTariffByCode(cod));
  });

  clearVisibleBtn?.addEventListener("click", async () => {
    const cod = getSelectedTariffCodeInOptions();
    const selected = getAssignedCustomerSetForTariff(cod);
    const checks = Array.from(
      customerList?.querySelectorAll(
        'input[data-role="tariff-customer-check"]',
      ) || [],
    );

    checks.forEach((el) => {
      const cc = String(el.getAttribute("data-codcliente") || "").trim();
      if (cc) selected.delete(cc);
      el.checked = false;
    });

    const customers = tariffCustomersCache || [];
    setAssignedCustomersForTariff(
      cod,
      customers.filter((c) => selected.has(String(c?.codcliente || "").trim())),
    );
    updateTariffCustomersSelectedCount(cod);
    renderTariffSummaryInOptions(findTariffByCode(cod));
  });

  customerList?.addEventListener("change", () => {
    const checks = Array.from(
      customerList.querySelectorAll('input[data-role="tariff-customer-check"]'),
    );
    const cod = getSelectedTariffCodeInOptions();
    const customers = tariffCustomersCache || [];

    setAssignedCustomersForTariff(
      cod,
      checks
        .filter((el) => !!el.checked)
        .map((el) => String(el.getAttribute("data-codcliente") || "").trim())
        .filter(Boolean)
        .map((cc) => {
          const found = customers.find(
            (c) => String(c?.codcliente || "").trim() === cc,
          );
          return {
            codcliente: cc,
            nombre: String(found?.nombre || "").trim(),
          };
        }),
    );

    updateTariffCustomersSelectedCount(cod);
    renderTariffSummaryInOptions(findTariffByCode(cod));
  });
}

function bindParkStockWarningToggleOnce() {
  if (parkStockWarningToggleBound) return;
  parkStockWarningToggleBound = true;

  const el = document.getElementById("parkStockWarningToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    const wanted = !!el.checked;
    await saveParkStockWarningToggle(wanted);
  });
}

function bindProductTileResizeModeToggleOnce() {
  if (productTileResizeModeToggleBound) return;
  productTileResizeModeToggleBound = true;

  const el = document.getElementById("productTileResizeModeToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    const wanted = !!el.checked;
    await saveProductTileResizeModeToggle(wanted);
    renderProducts?.();
  });
}

function bindScaleManualCaptureToggleOnce() {
  if (scaleManualCaptureToggleBound) return;
  scaleManualCaptureToggleBound = true;

  const el = document.getElementById("scaleManualCaptureToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    const wanted = !!el.checked;
    await saveScaleManualCaptureModeToggle(wanted);
    renderProducts?.();
  });
}

function bindProductTileSizeResetButtonOnce() {
  if (productTileSizeResetBtnBound) return;
  productTileSizeResetBtnBound = true;

  const btn = document.getElementById("productTileSizeResetBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    await setProductTileMinSize(PRODUCT_TILE_MIN_SIZE_DEFAULT, {
      persist: true,
      rerender: false,
    });
    toast?.("Tamaño de productos restablecido.", "ok", "Productos");
  });
}

function bindProductSortModeOnce() {
  if (productSortModeBound) return;
  productSortModeBound = true;
  if (!productSortModeSelect) return;

  productSortModeSelect.addEventListener("change", async () => {
    await saveProductSortModeSetting(productSortModeSelect.value);
    renderProducts?.();
  });
}

function bindProductReorderModeOnce() {
  if (productReorderModeBound) return;
  productReorderModeBound = true;
  if (!productReorderModeToggle) return;

  productReorderModeToggle.addEventListener("change", async () => {
    if (!isAdminUser()) {
      productReorderModeToggle.checked = false;
      toast?.("Solo administradores.", "warn", "Productos");
      return;
    }

    const wanted = !!productReorderModeToggle.checked;
    await saveProductReorderModeSetting(wanted);
    if (wanted && productSortMode !== "manual") {
      await saveProductSortModeSetting("manual");
      if (productSortModeSelect) productSortModeSelect.value = "manual";
      toast?.(
        "Reordenar usa orden manual. Se cambió automáticamente.",
        "info",
        "Productos",
      );
    }
    renderProducts?.();
  });
}

function bindProductManualOrderResetButtonOnce() {
  if (productManualOrderResetBtnBound) return;
  productManualOrderResetBtnBound = true;
  if (!productManualOrderResetBtn) return;

  productManualOrderResetBtn.addEventListener("click", async () => {
    if (!isAdminUser()) {
      toast?.("Solo administradores.", "warn", "Productos");
      return;
    }

    const ok = await confirmModal(
      "Restablecer prioridades",
      "Se eliminarán todas las prioridades manuales de productos.\n\n¿Continuar?",
    );
    if (!ok) return;

    productManualOrderById = {};
    await saveProductManualOrderConfig();
    await saveProductSortModeSetting("default");
    if (productSortModeSelect) productSortModeSelect.value = "default";
    renderProducts?.();
    toast?.("Prioridades restablecidas.", "ok", "Productos");
  });
}

function bindInfoBarVisibilityOnce() {
  if (infoBarVisibilityBound) return;
  infoBarVisibilityBound = true;

  infoBarVisibleToggle?.addEventListener("change", async () => {
    infoBarVisible = !!infoBarVisibleToggle.checked;
    applyInfoBarVisibilityUi();
    await saveInfoBarVisibilitySettings();
  });

  infoBarShowTerminalToggle?.addEventListener("change", async () => {
    infoBarShowTerminal = !!infoBarShowTerminalToggle.checked;
    applyInfoBarVisibilityUi();
    await saveInfoBarVisibilitySettings();
  });

  infoBarShowAgentToggle?.addEventListener("change", async () => {
    infoBarShowAgent = !!infoBarShowAgentToggle.checked;
    applyInfoBarVisibilityUi();
    await saveInfoBarVisibilitySettings();
  });

  infoBarShowUserToggle?.addEventListener("change", async () => {
    infoBarShowUser = !!infoBarShowUserToggle.checked;
    applyInfoBarVisibilityUi();
    await saveInfoBarVisibilitySettings();
  });

  infoBarShowCashToggle?.addEventListener("change", async () => {
    infoBarShowCash = !!infoBarShowCashToggle.checked;
    applyInfoBarVisibilityUi();
    await saveInfoBarVisibilitySettings();
  });

  infoBarAltTerminalBtn?.addEventListener("click", async () => {
    if (TPV_LOADING) return;
    await refreshTerminalsAndAgents();
    showTerminalOverlay("terminalSwitch");
  });

  infoBarAltAgentBtn?.addEventListener("click", async () => {
    if (TPV_LOADING) return;
    if (!hasActiveLoginSession()) return;
    await refreshTerminalsAndAgents();
    showTerminalOverlay("agentSwitch");
  });

  infoBarAltUserBtn?.addEventListener("click", async () => {
    if (TPV_LOADING) return;
    await doLogoutFlow();
  });
}

function bindProductTileResizeHandle(handle) {
  if (!handle || handle.dataset.bound) return;
  handle.dataset.bound = "1";

  handle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const pointerId = ev.pointerId;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startSize = clampProductTileMinSize(productTileMinSize);

    try {
      handle.setPointerCapture(pointerId);
    } catch {}

    const onPointerMove = (moveEv) => {
      if (moveEv.pointerId !== pointerId) return;
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      const next = clampProductTileMinSize(startSize + delta);

      setProductTileMinSize(next, { persist: false, rerender: false }).catch(
        () => {},
      );
    };

    const onPointerEnd = (endEv) => {
      if (endEv.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      saveProductTileSizeSetting().catch(() => {});
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
  });
}

function bindCustomerDisplayToggleOnce() {
  if (customerDisplayToggleBound) return;
  customerDisplayToggleBound = true;

  const el = document.getElementById("customerDisplayToggle");
  if (!el) return;

  el.addEventListener("change", async () => {
    if (!isAdminUser()) {
      el.checked = false;
      toast(
        "Solo usuarios ADMIN pueden activar la pantalla cliente.",
        "warn",
        "Pantalla cliente",
      );
      return;
    }

    const wanted = !!el.checked;

    try {
      const r = await window.TPV_CUSTOMER_CTRL?.setEnabled?.(wanted);

      if (!r?.ok) {
        el.checked = !wanted;
        if (String(r?.error || "").toUpperCase() === "FORBIDDEN") {
          toast(
            "No tienes permisos para cambiar este ajuste.",
            "warn",
            "Pantalla cliente",
          );
        }
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

// ===== [09] Opciones: visibilidad de familias por terminal =====

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

function getTerminalModeFromMap(modeMap, terminalId) {
  const key = String(terminalId || "").trim();
  if (!key) return "all";

  const raw = modeMap && typeof modeMap === "object" ? modeMap[key] : undefined;

  // Primera vez (sin config guardada): mostrar todos activado por defecto.
  if (typeof raw === "undefined" || raw === null || raw === "") return "all";

  // Valores actuales
  if (raw === "filtered" || raw === "all") return raw;

  // Compatibilidad con formatos legacy (booleanos / numéricos / strings).
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "false" || normalized === "0") return "filtered";
  if (normalized === "true" || normalized === "1") return "all";

  return "all";
}

function getTerminalModeSync(terminalId) {
  return getTerminalModeFromMap(terminalFamilyModeCache, terminalId);
}

function renderTerminalFamiliesModeUi() {
  const select = document.getElementById("terminalFamiliesSelect");
  const toggle = document.getElementById("terminalFamiliesShowAllToggle");
  if (!select || !toggle) return;

  const terminalId = String(select.value || "");
  const mode = getTerminalModeFromMap(terminalFamiliesDraftModeMap, terminalId);

  toggle.checked = mode === "all";
}

// ===== [08] Guardas operativas: agente obligatorio para cobrar =====
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

  btn.textContent = isPayingNow ? "Cobrando..." : "Cobrar";

  if (isPayingNow) {
    btn.disabled = true;
    btn.title = "Hay un cobro en curso. Espera a que termine.";
    return;
  }

  const hasCart = hasVisibleCartLines();
  const hasCaja = !!cashSession?.open;
  const hasTpv = !!currentTerminal?.id;
  const hasAgent = hasAssignedAgent();
  const hasLogin = hasActiveLoginSession();

  const disabled = !hasLogin || !hasCaja || !hasTpv || !hasCart || !hasAgent;
  btn.disabled = disabled;

  if (!hasLogin) btn.title = "Inicia sesión para operar el TPV";
  else if (!hasCaja) btn.title = "Abre la caja para poder cobrar";
  else if (!hasTpv) btn.title = "Selecciona un terminal";
  else if (!hasAgent) btn.title = "Falta agente asignado";
  else if (!hasCart) btn.title = "Añade productos antes de cobrar";
  else btn.title = "";
}

function renderAgentMissingBadge() {
  const b = document.getElementById("agentMissingBadge");
  if (!b) return;

  const cashOpen = !!cashSession?.open;
  const showBadge = cashOpen && hasActiveLoginSession() && !hasAssignedAgent();
  b.style.display = showBadge ? "inline" : "none";
}

function ensureActiveAgentIfPossible() {
  if (!hasActiveLoginSession()) return;

  const terminalId = currentTerminal?.id;
  if (!terminalId) return;

  const list = getAgentsForTerminalId(terminalId) || [];
  if (!list.length) return;

  const stillValid =
    currentAgent &&
    list.some(
      (a) =>
        String(a?.codagente || "") === String(currentAgent?.codagente || ""),
    );

  if (stillValid) return;

  currentAgent = list[0];
  if (agentNameEl) agentNameEl.textContent = currentAgent?.name || "---";

  try {
    window.TPV_CFG?.set?.(
      "auth.codagente",
      String(currentAgent?.codagente || ""),
    );
  } catch {}
}

function refreshAgentGuardUI() {
  ensureActiveAgentIfPossible?.();
  renderAgentMissingBadge?.();
  updatePayButtonEnabledState?.();
}

const agentMissingBadgeEl = document.getElementById("agentMissingBadge");
if (agentMissingBadgeEl) {
  agentMissingBadgeEl.style.cursor = "pointer";
  agentMissingBadgeEl.title = "Seleccionar agente";
  agentMissingBadgeEl.addEventListener("click", async () => {
    if (TPV_LOADING) return;
    if (!hasActiveLoginSession()) return;
    await refreshTerminalsAndAgents();
    showTerminalOverlay("agentSwitch");
  });
}

// ===== [08] UX operativa: cambio rapido de terminal =====
function setTerminalNameClickable(isClickable, isLoading = false) {
  if (!terminalNameEl) return;

  const enabled = isClickable && !isLoading;

  if (enabled) {
    terminalNameEl.style.cursor = "pointer";
    terminalNameEl.style.textDecoration = "none";
    terminalNameEl.title = "Cambiar terminal";
  } else {
    terminalNameEl.style.cursor = "";
    terminalNameEl.style.textDecoration = "none";
    terminalNameEl.title = isLoading
      ? "Disponible cuando finalice la carga"
      : "";
  }
}

// Estado inicial (por si terminals ya está cargado)
setTerminalNameClickable(
  Array.isArray(terminals) && terminals.length > 1,
  true,
);

if (terminalNameEl) {
  terminalNameEl.addEventListener("click", async () => {
    if (TPV_LOADING) return;

    // Refrescar datos antes de decidir
    await refreshTerminalsAndAgents();

    const canSwitch = Array.isArray(terminals) && terminals.length > 1;
    setTerminalNameClickable(canSwitch, false);

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
  const qty = parseQtyValue(l?.cantidad ?? l?.qty, 0);

  // Tu ticket suele usar getUnitGross(item). Para históricos no lo tienes,
  // así que guardamos un campo unitGross “directo” si tu print lo soporta.
  // Si tu print usa otra cosa, mantenemos pvpunitario y ya.
  const unitNet = parseQtyValue(l?.pvpunitario, 0);

  return {
    // campos típicos TPV
    qty: qty,
    name: String(l?.descripcion || "").trim() || "Producto",
    referencia: String(l?.referencia || "").trim() || "-",

    // para impresión / totales
    pvpunitario: unitNet, // normalmente neto en FS (según tu API)
    pvpsindto: parseQtyValue(l?.pvpsindto, 0),
    pvptotal: parseQtyValue(l?.pvptotal, unitNet * qty),
    dtopor1: parseQtyValue(l?.dtopor1, 0),
    dtopor: parseQtyValue(l?.dtopor, 0),
    dtopor2: parseQtyValue(l?.dtopor2, 0),
    dtopor3: parseQtyValue(l?.dtopor3, 0),
    dtopor4: parseQtyValue(l?.dtopor4, 0),
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

const CUSTOMER_PRINT_CACHE_KEY = "tpv.customer.print.cache.v1";
let customerPrintCache = {};

function loadCustomerPrintCache() {
  try {
    const raw = localStorage.getItem(CUSTOMER_PRINT_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveCustomerPrintCache() {
  try {
    localStorage.setItem(
      CUSTOMER_PRINT_CACHE_KEY,
      JSON.stringify(customerPrintCache || {}),
    );
  } catch {}
}

function normalizeClientPrintEntry(src) {
  const cod = String(src?.codcliente || "").trim();
  if (!cod) return null;

  const nombre = String(src?.nombre || src?.razonsocial || "").trim();
  const razonsocial = String(src?.razonsocial || src?.nombre || "").trim();
  const cifnif = String(src?.cifnif || src?.cif || "").trim();
  const direccion = String(src?.direccion || "").trim();
  const codpostal = String(src?.codpostal || "").trim();
  const ciudad = String(src?.ciudad || "").trim();

  return {
    codcliente: cod,
    nombre,
    razonsocial,
    cifnif,
    direccion,
    codpostal,
    ciudad,
    updatedAt: Date.now(),
  };
}

function upsertCustomerPrintCache(src) {
  const entry = normalizeClientPrintEntry(src);
  if (!entry) return;
  customerPrintCache[entry.codcliente] = {
    ...(customerPrintCache[entry.codcliente] || {}),
    ...entry,
  };
  saveCustomerPrintCache();
}

function getCustomerPrintCacheByCod(codcliente) {
  const cod = String(codcliente || "").trim();
  if (!cod) return null;
  return customerPrintCache[cod] || null;
}

async function refreshCustomerPrintCacheByCod(codcliente) {
  const cod = String(codcliente || "").trim();
  if (!cod) return null;

  try {
    const rows = await fetchApiResourceWithParams("clientes", {
      limit: 1,
      "filter[codcliente]": cod,
    });
    const cli = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (cli) {
      upsertCustomerPrintCache(cli);
      return cli;
    }
  } catch {}

  return null;
}

async function syncCustomerPrintCacheFromSelection(c) {
  try {
    const cod = String(c?.codcliente || "").trim();
    if (!cod) return;

    const selectorList =
      typeof window.CUSTOMER_SELECTOR?.listCustomers === "function"
        ? window.CUSTOMER_SELECTOR.listCustomers()
        : [];

    const fromList = Array.isArray(selectorList)
      ? selectorList.find((x) => String(x?.codcliente || "").trim() === cod)
      : null;

    if (fromList?._raw) upsertCustomerPrintCache(fromList._raw);
    else if (fromList) upsertCustomerPrintCache(fromList);
    else upsertCustomerPrintCache(c);

    // Refresco online sin bloquear UI.
    refreshCustomerPrintCacheByCod(cod).catch(() => {});
  } catch {}
}

function renderCartCustomerTariffBadge() {
  const badge = document.getElementById("cartCustomerTariffBadge");
  if (!badge) return;

  if (!activeCustomerTariff) {
    badge.classList.add("hidden");
    badge.textContent = "Tarifa";
    badge.removeAttribute("title");
    return;
  }

  const discountText = getTariffDiscountDisplayText(activeCustomerTariff);
  badge.textContent = `Tarifa: ${discountText}`;
  badge.title = `${activeCustomerTariff.nombre} (${discountText})`;
  badge.classList.remove("hidden");
}

function setActiveCustomerTariffState(tariff, codcliente) {
  const nextTariffCod = String(tariff?.codtarifa || "").trim();
  const nextCustomerCod = String(codcliente || "").trim();
  const prevTariffCod = String(activeCustomerTariff?.codtarifa || "").trim();

  const changed =
    nextTariffCod !== prevTariffCod ||
    nextCustomerCod !== String(activeCustomerTariffCodcliente || "").trim();

  activeCustomerTariff = tariff || null;
  activeCustomerTariffCodcliente = nextCustomerCod;

  renderCartCustomerTariffBadge();
  if (changed) renderCart?.();
}

async function ensureCustomerTariffsLoaded(opts = {}) {
  const force = !!opts?.force;
  if (tariffsLoadedOnce && !force) return customerTariffCatalog;

  const rows = await fetchApiResourceWithParams("tarifas", { limit: 0 });
  const list = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeTariffRow(row))
    .filter(Boolean)
    .sort((a, b) => Number(a.codtarifa) - Number(b.codtarifa));

  customerTariffCatalog = list;
  customerTariffByCode = list.reduce((acc, item) => {
    acc[item.codtarifa] = item;
    return acc;
  }, {});
  tariffsLoadedOnce = true;

  return customerTariffCatalog;
}

function getCustomerFromSelectorByCod(codcliente) {
  const cod = String(codcliente || "").trim();
  if (!cod) return null;

  const list =
    typeof window.CUSTOMER_SELECTOR?.listCustomers === "function"
      ? window.CUSTOMER_SELECTOR.listCustomers()
      : [];

  if (!Array.isArray(list) || !list.length) return null;

  return (
    list.find((item) => String(item?.codcliente || "").trim() === cod) || null
  );
}

async function resolveCustomerTariffForCodcliente(codcliente, opts = {}) {
  const cod = String(codcliente || "").trim();
  if (!cod || cod === "1") return null;

  const forceTariffs = !!opts?.forceTariffs;
  const forceCustomer = !!opts?.forceCustomer;

  let codtarifa = "";
  const fromSelector = getCustomerFromSelectorByCod(cod);
  if (fromSelector?._raw) {
    codtarifa = String(fromSelector._raw.codtarifa || "").trim();
  }

  if (!codtarifa || forceCustomer) {
    if (forceCustomer) {
      const fresh = await refreshCustomerPrintCacheByCod(cod);
      if (fresh) codtarifa = String(fresh?.codtarifa || "").trim();
    }

    const cli = await fetchClienteByCodcliente(cod);
    if (!codtarifa) codtarifa = String(cli?.codtarifa || "").trim();
  }

  if (!codtarifa) return null;

  await ensureCustomerTariffsLoaded({ force: forceTariffs });
  let tariff = findTariffByCode(codtarifa);
  if (tariff) return tariff;

  // Last-chance refresh when client codtarifa exists but catalog map missed it.
  await ensureCustomerTariffsLoaded({ force: true });
  tariff = findTariffByCode(codtarifa);
  return tariff || null;
}

async function refreshActiveCustomerTariffForSelection(c, opts = {}) {
  const cod = String(
    c?.codcliente ||
      window.CUSTOMER_SELECTOR?.getSelectedCustomerCodcliente?.() ||
      "",
  ).trim();

  if (!cod || cod === "1") {
    setActiveCustomerTariffState(null, cod || "1");
    return;
  }

  try {
    const tariff = await resolveCustomerTariffForCodcliente(cod, {
      forceTariffs: !!opts?.forceTariffs,
      forceCustomer: !!opts?.forceCustomer,
    });
    setActiveCustomerTariffState(tariff, cod);
  } catch (e) {
    console.warn("No se pudo resolver tarifa del cliente:", e?.message || e);
    setActiveCustomerTariffState(null, cod);
  }
}

function renderSelectedCustomerInCartHeader(c) {
  const input = document.getElementById("cartCustomerInput");
  const btnClear = document.getElementById("cartCustomerClear");

  const nom = String(c?.nombre || "Ventas tickets");

  if (input) input.value = nom;

  const isDefault = !!c?.isDefault;
  if (btnClear) btnClear.style.display = isDefault ? "none" : "";

  syncCustomerPrintCacheFromSelection(c).catch(() => {});
  refreshActiveCustomerTariffForSelection(c).catch(() => {});
}

function bindCartCustomerUiEvents() {
  const input = document.getElementById("cartCustomerInput");
  const btnList = document.getElementById("cartCustomerListBtn");
  const btnOpen = document.getElementById("cartCustomerOpen");
  const btnClear = document.getElementById("cartCustomerClear");

  const openList = () => {
    if (TPV_LOADING) return;
    window.CUSTOMER_SELECTOR?.open?.();
  };
  const openCreate = () => {
    if (TPV_LOADING) return;
    window.CUSTOMER_SELECTOR?.openCreate?.();
  };

  if (input) input.addEventListener("click", openList);
  if (btnList) btnList.addEventListener("click", openList);
  if (btnOpen) btnOpen.addEventListener("click", openCreate);

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      if (TPV_LOADING) return;
      window.CUSTOMER_SELECTOR?.resetToDefault?.();
    });
  }

  syncCustomerControlsLoadingState();
}

let __customerSelectorInited = false;

async function initCustomerSelectorOnce() {
  if (__customerSelectorInited) return;
  __customerSelectorInited = true;

  const cfg = window.RECIPOK_API || {};
  const baseUrl = String(cfg.baseUrl || "").replace(/\/+$/, "");
  const apiKey = String(cfg.apiKey || "").trim();

  customerPrintCache = loadCustomerPrintCache();

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

  if (
    currentParkedTicketIndex != null &&
    Array.isArray(parkedTickets) &&
    parkedTickets[currentParkedTicketIndex]
  ) {
    applyCustomerSelectionForParkedTicket(
      parkedTickets[currentParkedTicketIndex],
    );
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

  let res = await fetch(url, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Token: cfg.apiKey,
    },
    body,
  });

  // Compatibilidad: algunas instalaciones no aceptan PATCH en este recurso.
  // En fallback evitamos PUT parcial destructivo: primero leemos el documento
  // actual y hacemos PUT con merge completo.
  if (res.status === 404 || res.status === 405) {
    let mergedBody = body;
    try {
      const currentRaw = await apiRead(`tpvterminales/${idtpv}`);
      const current =
        currentRaw?.doc && typeof currentRaw.doc === "object"
          ? currentRaw.doc
          : currentRaw?.data && typeof currentRaw.data === "object"
            ? currentRaw.data
            : currentRaw && typeof currentRaw === "object"
              ? currentRaw
              : {};

      const merged = { ...current, ...(patch || {}) };
      mergedBody = toFormUrlEncoded(merged);
    } catch {
      // Si no podemos leer el actual, mantenemos fallback con patch mínimo.
    }

    res = await fetch(url, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Token: cfg.apiKey,
      },
      body: mergedBody,
    });
  }

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

async function resetCartCustomerToTerminalDefault(reason = "post-action") {
  preParkedCustomerSelection = null;

  try {
    await applyTerminalDefaultCustomer({
      forceReset: true,
      reason: `reset-cart-customer:${reason}`,
    });
  } catch {
    window.CUSTOMER_SELECTOR?.resetToDefault?.();
  }
}

/*----------------------*/
/* Fin Cambiar Clientes */
/*----------------------*/

function isPackChildForPrint(l) {
  // 1) si viene meta desde carrito
  if (l?.meta?.includedInPack) return true;

  // 2) si lo marcaste en buildFsLinesFromCart (recomendado)
  if (l?.__isPackChild) return true;

  // 3) fallback por texto (por si viene de FS reconstruido)
  const d = String(l?.descripcion || l?.desc || "").trim();
  return d.startsWith("↳") || d.startsWith("└") || d.startsWith("↓");
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

    // Si no hay carrito nuevo, limpiamos el snapshot vendido para que no reaparezca.
    if ((cart?.length || 0) === 0) {
      customerDisplayOverride = null;
    }

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

    // Durante PAYING mostramos siempre el snapshot congelado de la venta en curso,
    // aunque el cajero esté montando otro carrito.
    if (customerMode === "PAYING" && customerDisplayOverride?.items?.length) {
      itemsToShow = Array.isArray(customerDisplayOverride.items)
        ? customerDisplayOverride.items
        : [];
      totalToShow = Number(customerDisplayOverride.total || 0);
    }

    // Si carrito vacío pero existe override, mostramos override (pero filtrado)
    else if (
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

  if (open && id && infoBarVisible && infoBarShowCash) {
    el.style.display = "";
    el.textContent = `Caja ${id}`;
  } else {
    el.style.display = "none";
    el.textContent = "";
  }
}

let BOOT_IN_FLIGHT = false;
let TPV_LOADING = true;
const TPV_THEME_KEY = "tpv_theme_mode";
let TPV_THEME_MODE = "light";
let TPV_CUSTOMER_THEME_MODE = "dark";

function syncCustomerControlsLoadingState() {
  const input = document.getElementById("cartCustomerInput");
  const btnList = document.getElementById("cartCustomerListBtn");
  const btnOpen = document.getElementById("cartCustomerOpen");
  const btnClear = document.getElementById("cartCustomerClear");
  const row = document.querySelector(".cart-client-row");

  const title = TPV_LOADING
    ? "Clientes disponibles cuando finalice la carga"
    : "";

  if (input) {
    input.disabled = TPV_LOADING;
    input.readOnly = TPV_LOADING;
    input.title = title;
  }
  if (btnList) {
    btnList.disabled = TPV_LOADING;
    btnList.title = title;
  }
  if (btnOpen) {
    btnOpen.disabled = TPV_LOADING;
    btnOpen.title = title;
  }
  if (btnClear) {
    btnClear.disabled = TPV_LOADING;
    btnClear.title = title;
  }
  if (row) {
    row.classList.toggle("is-loading", TPV_LOADING);
  }
}

function syncHeaderIdentityLoadingState() {
  const targets = [terminalNameEl, agentNameEl, userNameEl];
  const loadingTitle = "Disponible cuando finalice la carga";

  targets.forEach((el) => {
    if (!el) return;
    el.classList.toggle("tpv-loading-lock", TPV_LOADING);
    el.setAttribute("aria-disabled", TPV_LOADING ? "true" : "false");

    if (TPV_LOADING) {
      el.title = loadingTitle;
      return;
    }

    if (el === terminalNameEl) {
      setTerminalNameClickable(
        Array.isArray(terminals) && terminals.length > 1,
        TPV_LOADING,
      );
      return;
    }

    if (el === userNameEl) {
      el.title = hasActiveLoginSession() ? "Cerrar sesión" : "Iniciar sesión";
      return;
    }

    el.title = "";
  });
}

function setTpvLoadingState(isLoading) {
  TPV_LOADING = !!isLoading;
  if (cashHeaderBtn) {
    cashHeaderBtn.disabled = TPV_LOADING;
    if (TPV_LOADING) {
      cashHeaderBtn.title = "Cargando TPV...";
    } else if (cashHeaderBtn.title === "Cargando TPV...") {
      cashHeaderBtn.title = "";
    }
  }
  syncCustomerControlsLoadingState();
  syncHeaderIdentityLoadingState();
  updateCashButtonLabel?.();
}

function updateThemeButtonsUI() {
  const p1Dark = TPV_THEME_MODE === "dark";
  const p2Dark = TPV_CUSTOMER_THEME_MODE === "dark";

  document.querySelectorAll(".agent-theme-btn-main").forEach((btn) => {
    btn.classList.toggle("mode-dark", p1Dark);
    btn.classList.toggle("mode-light", !p1Dark);
    btn.innerHTML = p1Dark
      ? '<span class="theme-mini-label">P1</span><span class="theme-icon theme-icon-moon" aria-hidden="true">🌙</span>'
      : '<span class="theme-mini-label">P1</span><span class="theme-icon theme-icon-sun" aria-hidden="true">☀️</span>';
    btn.title = p1Dark
      ? "Pantalla 1 en modo noche (pulsa para pasar a dia)"
      : "Pantalla 1 en modo dia (pulsa para pasar a noche)";
    btn.setAttribute("aria-label", btn.title);
  });

  document.querySelectorAll(".agent-theme-btn-customer").forEach((btn) => {
    btn.classList.toggle("mode-dark", p2Dark);
    btn.classList.toggle("mode-light", !p2Dark);
    btn.innerHTML = p2Dark
      ? '<span class="theme-mini-label">P2</span><span class="theme-icon theme-icon-moon" aria-hidden="true">🌙</span>'
      : '<span class="theme-mini-label">P2</span><span class="theme-icon theme-icon-sun" aria-hidden="true">☀️</span>';
    btn.title = p2Dark
      ? "Pantalla 2 en modo noche (pulsa para pasar a dia)"
      : "Pantalla 2 en modo dia (pulsa para pasar a noche)";
    btn.setAttribute("aria-label", btn.title);
  });
}

function applyThemeMode(mode, { persist = true } = {}) {
  TPV_THEME_MODE = mode === "dark" ? "dark" : "light";
  document.body.classList.toggle("theme-dark", TPV_THEME_MODE === "dark");
  updateThemeButtonsUI();

  if (persist) {
    try {
      localStorage.setItem(TPV_THEME_KEY, TPV_THEME_MODE);
    } catch {}
  }
}

function toggleThemeMode() {
  applyThemeMode(TPV_THEME_MODE === "dark" ? "light" : "dark");
}

async function setCustomerDisplayThemeMode(mode) {
  const wanted = mode === "light" ? "light" : "dark";
  try {
    const r = await window.TPV_CUSTOMER_CTRL?.setTheme?.(wanted);
    if (!r?.ok) return false;
    TPV_CUSTOMER_THEME_MODE = r.mode || wanted;
    updateThemeButtonsUI();
    return true;
  } catch {
    return false;
  }
}

async function toggleCustomerDisplayThemeMode() {
  const wanted = TPV_CUSTOMER_THEME_MODE === "dark" ? "light" : "dark";
  const ok = await setCustomerDisplayThemeMode(wanted);
  if (!ok) {
    toast(
      "No se pudo cambiar el tema de la pantalla cliente.",
      "err",
      "Pantalla cliente",
    );
  }
}

async function initCustomerDisplayThemeMode() {
  try {
    const r = await window.TPV_CUSTOMER_CTRL?.getTheme?.();
    TPV_CUSTOMER_THEME_MODE = r?.ok
      ? r.mode === "light"
        ? "light"
        : "dark"
      : "dark";
  } catch {
    TPV_CUSTOMER_THEME_MODE = "dark";
  }
  updateThemeButtonsUI();
}

function initThemeMode() {
  let saved = "light";
  try {
    saved = String(localStorage.getItem(TPV_THEME_KEY) || "light").trim();
  } catch {}
  applyThemeMode(saved, { persist: false });
}

function applyAdminOnlyUI() {
  const isAdmin = !!window.TPV_STATE?.isAdmin;
  const els = document.querySelectorAll("[data-admin-only]");

  debugLog("[ADMIN] applyAdminOnlyUI", {
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
  setTpvLoadingState(true);

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

    // Cargar preferencia de visibilidad de stock antes de pintar UI principal.
    await loadProductStockToggle?.();
    await loadProductStockEditionToggle?.();
    await loadAllowCloseWithParkedToggle?.();
    await loadCartDiscountToolsToggle?.();
    await loadParkStockWarningToggle?.();
    await loadProductDiscountConfig?.();
    await loadProductManualOrderConfig?.();
    await loadProductSortModeSetting?.();
    await loadProductReorderModeSetting?.();
    await loadInfoBarVisibilitySettings?.();
    await loadProductTileSizeSetting?.();
    await loadProductTileResizeModeToggle?.();
    await loadScaleManualCaptureModeToggle?.();

    // Arranca la báscula al iniciar TPV para no depender de abrir Opciones.
    try {
      await window.initScaleOptionsUI?.();
    } catch (e) {
      console.warn("[SCALE] init on boot failed:", e?.message || e);
    }

    // 3) Datos
    await loadDataFromApi();

    const restoredCart = await restoreRuntimeCartSnapshot();
    if (restoredCart) {
      renderCart();
      toast(
        "Carrito recuperado tras cierre inesperado.",
        "info",
        "Recuperación",
      );
    }
    CART_SNAPSHOT_ARMED = true;

    // Aplicar visibilidad/admin una vez tras completar carga inicial.
    applyAdminOnlyUI?.();
    refreshOptionsUI?.();

    // 4) Terminal+Agente por defecto (NO overlay)
    await ensureTerminalAgentDefaults();

    // 5) Caja (recupera o abre modal)
    maybeOpenCashOrRecover();

    scheduleRuntimeUiRestoreAfterBoot();

    return true;
  } finally {
    BOOT_IN_FLIGHT = false;
    setTpvLoadingState(false);
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
  updateSessionLockUi?.();
}

function updateCashButtonLabel() {
  if (!cashHeaderLabel) return;

  if (TPV_LOADING) {
    cashHeaderLabel.textContent = "Cargando...";
    return;
  }

  if (TPV_STATE.locked) {
    cashHeaderLabel.textContent = "Bloqueado";
    return;
  }

  if (TPV_STATE.offline) {
    cashHeaderLabel.textContent = "Conectar";
    return;
  }

  cashHeaderLabel.textContent = cashSession.open ? "Cerrar caja" : "Abrir caja";
  syncCashClosedUiState();
}

function syncCashClosedUiState() {
  const cashOpen = !!cashSession?.open;
  const hasLogin = hasActiveLoginSession();

  const cashMove = document.getElementById("cashMoveBtn");
  if (cashMove) {
    cashMove.disabled = !cashOpen || !hasLogin;
    cashMove.title = !hasLogin
      ? "Inicia sesión para usar movimientos"
      : cashOpen
        ? "Movimientos de caja"
        : "Disponible solo con la caja abierta";
  }

  const options = document.getElementById("optionsBtn");
  if (options) {
    options.disabled = false;
    options.title = "Opciones";
  }

  const bottomActionIds = ["clearCartBtn", "ticketsListBtn", "parkedListBtn"];

  bottomActionIds.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !cashOpen;
  });

  if (!cashOpen) {
    if (parkBtn) parkBtn.disabled = true;
    const payBtnEl = document.getElementById("payBtn");
    if (payBtnEl) payBtnEl.disabled = true;
  } else {
    // No pisar la lógica real de estado (carrito/agent/login).
    refreshAgentGuardUI?.();
    refreshParkButtonUI?.();
  }

  const badge = document.getElementById("parkedCountBadge");
  if (!badge) return;

  if (!cashOpen) {
    badge.textContent = "0";
    return;
  }

  const pendingCount = (
    Array.isArray(parkedTickets) ? parkedTickets : []
  ).filter((t) => !t.paid && !t?.closingInProgress).length;
  badge.textContent = String(pendingCount);
}

// ===== [08] UI venta: categorias/familias =====
function renderCategories() {
  debugTrace("[TRACE] renderCategories()");

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

// ===== [08] UI venta: rejilla de productos =====
function formatProductStock(value) {
  const n = parseManagedStockValue(value);
  if (n === null) return "—";

  return Number.isInteger(n)
    ? String(n)
    : String(n.toFixed(2)).replace(".", ",");
}

function getProductStockClass(value) {
  const n = parseManagedStockValue(value);
  if (n === null) return "is-unknown";
  if (n < 0) return "is-zero";
  if (n === 0) return "is-zero";
  if (n <= 5) return "is-low";
  return "is-ok";
}

function updateRenderedProductStocks() {
  const grid = document.getElementById("productsGrid");
  if (!grid) return;

  const badges = grid.querySelectorAll(
    ".product-stock-badge[data-stock-product-id]",
  );

  badges.forEach((badge) => {
    const baseId = Number(badge.dataset.stockProductId || 0);
    if (!baseId) return;

    const visibleStock = getVisibleStockForProduct(baseId);
    const stockText = formatProductStock(visibleStock);
    const stockClass = getProductStockClass(visibleStock);

    if (badge.textContent !== stockText) {
      badge.textContent = stockText;
    }

    badge.classList.remove("is-unknown", "is-zero", "is-low", "is-ok");
    badge.classList.add(stockClass);
  });
}

async function saveManualOrderFromBaseIdSequence(baseIds) {
  const seq = [];
  const seen = new Set();

  (baseIds || []).forEach((id) => {
    const n = Number(id || 0);
    if (!n || seen.has(n)) return;
    seen.add(n);
    seq.push(n);
  });

  if (!seq.length) return;

  seq.forEach((id, idx) => {
    const priority = idx * 2 - (seq.length - 1);
    const key = String(id);
    if (priority !== 0) productManualOrderById[key] = priority;
    else delete productManualOrderById[key];
  });

  await saveProductManualOrderConfig();
}

function clearProductReorderTargetVisual() {
  if (productReorderDragState.targetTile) {
    productReorderDragState.targetTile.classList.remove("reorder-target");
  }
  productReorderDragState.targetTile = null;
  productReorderDragState.targetId = 0;
}

function bindProductTileReorderEvents(tile) {
  if (!tile || tile.dataset.reorderBound === "1") return;
  tile.dataset.reorderBound = "1";

  const resolveTileFromPoint = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    return el?.closest?.(".product-tile") || null;
  };

  tile.addEventListener("pointerdown", (ev) => {
    if (!productReorderMode || !isAdminUser()) return;

    const sourceId = Number(tile.dataset.productId || 0);
    if (!sourceId) return;

    ev.preventDefault();
    ev.stopPropagation();

    productReorderDragState.active = true;
    productReorderDragState.sourceId = sourceId;
    productReorderDragState.targetId = sourceId;
    productReorderDragState.targetTile = tile;

    tile.classList.add("reorder-source", "reorder-target");
  });

  tile.addEventListener("pointermove", (ev) => {
    if (!productReorderDragState.active) return;

    const target = resolveTileFromPoint(ev.clientX, ev.clientY);
    if (!target) return;

    const targetId = Number(target.dataset.productId || 0);
    if (!targetId) return;

    if (productReorderDragState.targetTile !== target) {
      clearProductReorderTargetVisual();
      target.classList.add("reorder-target");
      productReorderDragState.targetTile = target;
      productReorderDragState.targetId = targetId;
    }
  });

  tile.addEventListener("pointerup", async (ev) => {
    if (!productReorderDragState.active) return;

    ev.preventDefault();
    ev.stopPropagation();

    const sourceId = Number(productReorderDragState.sourceId || 0);
    const targetId = Number(productReorderDragState.targetId || 0);

    document.querySelectorAll(".product-tile.reorder-source").forEach((el) => {
      el.classList.remove("reorder-source");
    });
    clearProductReorderTargetVisual();

    productReorderDragState.active = false;
    productReorderDragState.sourceId = 0;

    if (!sourceId || !targetId || sourceId === targetId) return;

    const ids = Array.from(
      document.querySelectorAll("#productsGrid .product-tile"),
    ).map((el) => Number(el.dataset.productId || 0));

    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;

    ids.splice(from, 1);
    const insertAt = ids.indexOf(targetId);
    ids.splice(insertAt < 0 ? ids.length : insertAt, 0, sourceId);

    await saveManualOrderFromBaseIdSequence(ids);
    if (productSortMode !== "manual") {
      await saveProductSortModeSetting("manual");
      if (productSortModeSelect) productSortModeSelect.value = "manual";
    }
    renderProducts?.();
  });

  tile.addEventListener("pointercancel", () => {
    if (!productReorderDragState.active) return;

    document.querySelectorAll(".product-tile.reorder-source").forEach((el) => {
      el.classList.remove("reorder-source");
    });
    clearProductReorderTargetVisual();
    productReorderDragState.active = false;
    productReorderDragState.sourceId = 0;
  });
}

function renderProducts() {
  debugTrace("[TRACE] renderProducts()");

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

  if (!productsFilterIncludeUnmanaged) {
    filtered = filtered.filter((p) => !isProductWithoutStockControl(p));
  }

  if (productsFilterStockOnly) {
    filtered = filtered.filter((p) => {
      const stockValue = getVisibleStockForProduct(p);
      if (stockValue === null) return false;
      return Number(stockValue) > 0;
    });
  }

  filtered.sort(compareProductsForDisplay);

  filtered.forEach((p) => {
    const tile = document.createElement("div");
    const imageInfo = getProductImageInfoForProduct(p);
    const thumbUrl = getProductThumbObjectUrlSync(imageInfo);
    const fallbackUrl = String(p.imageUrl || "").trim();

    const safeImageUrl = BROKEN_PRODUCT_IMAGE_URLS.has(
      String(fallbackUrl || ""),
    )
      ? ""
      : String(thumbUrl || "").trim();

    tile.className = "product-tile" + (safeImageUrl ? "" : " no-img");
    tile.dataset.productId = String(Number(p.baseProductId || p.id || 0));

    const prodId = Number(p.baseProductId || p.id || 0);
    if (isOfferPackProductById(prodId)) tile.classList.add("is-offer");

    const taxRate = getTaxRateForProduct(p);
    const discountPct = getProductDiscountPercent(p);
    const baseNetPrice = Number(p.price || 0) || 0;
    const effectiveNetPrice = applyDiscountToNetPrice(
      baseNetPrice,
      discountPct,
    );
    const priceGrossBase =
      (Number(baseNetPrice) || 0) * (1 + (Number(taxRate) || 0) / 100);
    const priceGross =
      (Number(effectiveNetPrice) || 0) * (1 + (Number(taxRate) || 0) / 100);
    const canEditPrices = isAdminUser() && isPriceEditModeEnabled();
    const canResizeTiles = isAdminUser() && !!productTileResizeMode;
    const canReorderTiles = isAdminUser() && !!productReorderMode;
    const showScaleCaptureBtn = !!scaleManualCaptureMode && !canReorderTiles;

    const priceHtml =
      discountPct > 0
        ? `<div class="product-price"><span class="product-price-old">${priceGrossBase.toFixed(2)} €</span><span class="product-price-current">${priceGross.toFixed(2)} €</span></div>`
        : `<div class="product-price">${priceGross.toFixed(2)} €</div>`;

    const stockValue = getVisibleStockForProduct(p);
    const stockText = formatProductStock(stockValue);
    const stockClass = getProductStockClass(stockValue);
    const canShowStockEdit =
      isAdminUser() &&
      enableProductStockEdition &&
      showProductStockBadge &&
      stockValue !== null;

    const footerLeftBits = [];
    if (showProductStockBadge) {
      footerLeftBits.push(`<div class="product-stock-wrap">
  <div
    class="product-stock-badge ${stockClass}"
    data-stock-product-id="${Number(p.baseProductId || p.id || 0)}"
    title="Stock actual"
  >
    ${stockText}
  </div>
  ${
    canShowStockEdit
      ? `<button
    type="button"
    class="product-stock-edit-btn"
    title="Editar stock"
    aria-label="Editar stock"
  >✎</button>`
      : ""
  }
</div>`);
    }

    const footerLeftHtml = footerLeftBits.length
      ? `<div class="product-footer-left">${footerLeftBits.join("")}</div>`
      : "";
    const scaleButtonHtml = showScaleCaptureBtn
      ? `<button
  type="button"
  class="product-scale-btn"
  title="Añadir con peso de báscula"
  aria-label="Añadir con peso de báscula"
><span class="product-scale-btn-label">kg</span></button>`
      : "";

    tile.innerHTML = `
      <div class="product-img-wrapper">
        ${safeImageUrl ? `<img src="${safeImageUrl}" class="product-img" loading="lazy" decoding="async">` : ""}
      </div>

      <div class="product-overlay-top">
        <div class="product-name">${p.name || ""}</div>
        ${p.secondaryName ? `<div class="product-secondary">${p.secondaryName}</div>` : ""}
      </div>

      ${discountPct > 0 ? `<div class="product-discount-badge" title="Descuento aplicado">-${formatDiscountPercent(discountPct)}%</div>` : ""}

      ${scaleButtonHtml}

      <div class="product-footer">
        ${footerLeftHtml}
        ${priceHtml}
      </div>
    `;

    const productForSale =
      discountPct > 0
        ? {
            ...p,
            price: effectiveNetPrice,
            discountPctApplied: discountPct,
            discountBaseNetPrice: baseNetPrice,
          }
        : p;

    if (canReorderTiles) {
      tile.classList.add("reorder-mode");
      bindProductTileReorderEvents(tile);
      tile.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
    } else {
      tile.onclick = async () => {
        try {
          if (scaleManualCaptureMode) {
            await addToCart(productForSale, 1, { skipScale: true });
          } else {
            await addToCart(productForSale);
          }
        } catch (e) {
          console.warn("addToCart error:", e);
          toast("No se pudo añadir al carrito.", "error");
        }
      };
    }

    if (canShowStockEdit) {
      const stockEditBtn = tile.querySelector(".product-stock-edit-btn");
      if (stockEditBtn) {
        stockEditBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await openProductStockEditFlow(p);
        };
      }
    }

    if (showScaleCaptureBtn) {
      const scaleBtn = tile.querySelector(".product-scale-btn");
      if (scaleBtn) {
        scaleBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            await addToCart(productForSale, 1, { forceScale: true });
          } catch (err) {
            console.warn("addToCart scale button error:", err);
            toast("No se pudo añadir con báscula.", "error", "Báscula");
          }
        };
      }
    }

    const imgEl = tile.querySelector(".product-img");
    if (imgEl) {
      imgEl.onerror = () => {
        const src = String(imgEl.getAttribute("src") || "").trim();
        if (src) BROKEN_PRODUCT_IMAGE_URLS.add(src);

        tile.classList.add("no-img");
        const wrap = tile.querySelector(".product-img-wrapper");
        if (wrap) wrap.innerHTML = "";
      };
    }

    if (!safeImageUrl && imageInfo?.url) {
      hydrateProductTileImage(tile, imageInfo, fallbackUrl).catch(() => {});
    }

    if (canEditPrices) {
      tile.style.position = "relative";
      if (discountPct > 0) tile.classList.add("has-price-edit");

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

    if (canResizeTiles) {
      const resizeHandle = document.createElement("button");
      resizeHandle.type = "button";
      resizeHandle.className = "product-tile-resize-handle";
      resizeHandle.title = "Arrastra para cambiar tamaño";
      resizeHandle.ariaLabel = "Cambiar tamaño de productos";

      resizeHandle.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };

      bindProductTileResizeHandle(resizeHandle);
      tile.appendChild(resizeHandle);
    }

    grid.appendChild(tile);
  });
}

function renderMainUI(force = false) {
  debugLog("[TRACE] renderMainUI cashSession.open=", cashSession?.open);

  syncCashClosedUiState();

  if (!cashSession?.open) {
    const grid = document.getElementById("productsGrid");
    const catContainer = document.getElementById("categories");
    const subCatContainer = document.getElementById("subcategories");
    if (grid) grid.innerHTML = "";
    if (catContainer) catContainer.innerHTML = "";
    if (subCatContainer) subCatContainer.innerHTML = "";
    mainUiRendered = false;
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

// ===== [08] UI venta: buscador =====
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

if (productsStockOnlyToggle) {
  productsStockOnlyToggle.addEventListener("change", () => {
    if (productsStockOnlyToggle.checked) {
      productsFilterIncludeUnmanagedSnapshot = !!productsFilterIncludeUnmanaged;
    }
    productsFilterStockOnly = !!productsStockOnlyToggle.checked;
    refreshProductStockFilterUIState();
    renderProducts?.();
  });
}

if (productsIncludeUnmanagedToggle) {
  productsIncludeUnmanagedToggle.addEventListener("change", () => {
    productsFilterIncludeUnmanaged = !!productsIncludeUnmanagedToggle.checked;
    productsFilterIncludeUnmanagedSnapshot = !!productsFilterIncludeUnmanaged;
    renderProducts?.();
  });
}

// ===== [08] UI venta: carrito =====
function makeLineId() {
  return "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function buildCartLine(product, quantity) {
  const taxRate = getTaxRateForProduct(product);
  const priceNet = product.price || 0;
  const priceGross = priceNet * (1 + taxRate / 100);
  const costNet =
    parseNumericLike(
      product?.costNet ??
        product?.coste ??
        product?.precioCoste ??
        product?.costPrice ??
        product?.pcoste ??
        product?.cost,
      0,
    ) || 0;
  const costGross =
    costNet > 0 ? round2(costNet * (1 + Number(taxRate || 0) / 100)) : 0;

  return {
    _lineId: makeLineId(),

    id: product.id,
    baseProductId: product.baseProductId || product.id,

    // ✅ NUEVO: referencia/descripcion separadas (como FS)
    referencia:
      product.referencia || product.ref || product.codigo || product.name || "",
    descripcion: product.descripcion || product.name || "",
    descripcion2: product.descripcion2 || product.secondaryName || "",

    name: product.name,
    secondaryName: product.secondaryName || "",

    imageUrl: product.imageUrl || null,

    price: priceNet,
    taxRate,
    grossPrice: priceGross,
    costNet,
    costGross,
    codimpuesto: product.codimpuesto || null,
    qty: quantity,

    originalNetPrice: priceNet,
    originalGrossPrice: priceGross,
    grossPriceOverride: null,
    manualPriceLocksAdjustments: false,
    cartLineDiscountPct: 0,
    discountPctApplied: clampDiscountPercent(product.discountPctApplied || 0),
    discountBaseNetPrice: Number(product.discountBaseNetPrice || priceNet),
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

async function addToCart(product, quantity = 1, options = {}) {
  if (!hasActiveLoginSession()) {
    const okLogin = await openLoginModal();
    if (!okLogin || !hasActiveLoginSession()) {
      applyLoggedOutUiState({ lock: true });
      return;
    }
    unlockAppUI();
  }

  product = buildProductWithAppliedDiscount(product);

  const prodId = Number(product.baseProductId || product.id || 0);

  // Primera versión:
  // NO aplicamos báscula a packs/ofertas para no romper esa lógica.
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
      const baseQty = Math.max(
        0.001,
        roundQty3(parseQtyValue(ln?.quantity ?? ln?.qty, 1)),
      );
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

  // Báscula: para productos normales.
  // - forceScale: obliga a tomar peso (botón ⚖).
  // - skipScale: no usa báscula (toque normal en modo manual).
  const useScale = !!options?.forceScale || !options?.skipScale;
  if (useScale && window.TPV_SCALE_CART?.resolveScaleQuantityIfNeeded) {
    const scaleResult =
      await window.TPV_SCALE_CART.resolveScaleQuantityIfNeeded(
        product,
        quantity,
      );

    if (!scaleResult?.ok) {
      return;
    }

    quantity = scaleResult.qty;
  }

  // NORMAL (tu comportamiento)
  if (isGroupLinesEnabled()) {
    cart.push(buildCartLine(product, quantity));
    renderCart();
    return;
  }

  const existing = cart.find((c) => {
    if (Number(c?.id) !== Number(product?.id)) return false;
    // Nunca mezclar una línea independiente con líneas de oferta.
    if (isPackParentLine(c) || isPackChildLine(c)) return false;
    const existingGross = round2(getUnitGross(c));
    const productGross = round2(
      (Number(product?.price || 0) || 0) *
        (1 + (Number(getTaxRateForProduct(product)) || 0) / 100),
    );
    if (existingGross !== productGross) return false;
    return true;
  });

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

function previewCartItemQuantity(lineId, newQty) {
  const item = cart.find((c) => c._lineId === lineId);
  if (!item || isPackChildLine(item)) return;

  let q = Number(newQty);
  if (!isFinite(q)) q = 0;
  q = Math.max(0, Math.round(q * 1000) / 1000);

  if (isPackParentLine(item)) {
    item.qty = q;
    syncSelectedPackChildrenQty(item);
    renderCart();
    return;
  }

  item.qty = q;
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
    item.manualPriceLocksAdjustments = false;
    // opcional: delete item.grossPriceOverride;
    return;
  }

  item.grossPriceOverride = v;
  item.manualPriceLocksAdjustments = true;
}

function eur(n) {
  return (Number(n) || 0).toFixed(2).replace(".", ",") + " €";
}

function getUnitGross(item) {
  return Number(getCartLinePricing(item).unitGross || 0);
}

function fmtQty(q) {
  const n = Number(q);
  if (!isFinite(n)) return "0";
  // hasta 6 decimales, sin ceros sobrantes
  return n.toLocaleString("es-ES", { maximumFractionDigits: 6 });
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

function normalizeCartLineFromSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;

  const qty = Number(raw.qty || 0);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const line = { ...raw };
  line._lineId = String(raw._lineId || makeLineId());
  line.qty = qty;

  const numFields = [
    "id",
    "baseProductId",
    "price",
    "taxRate",
    "grossPrice",
    "originalNetPrice",
    "originalGrossPrice",
    "grossPriceOverride",
    "manualPriceLocksAdjustments",
    "cartLineDiscountPct",
    "cartGlobalDiscountPctApplied",
  ];

  numFields.forEach((f) => {
    if (line[f] == null || line[f] === "") return;
    const n = Number(line[f]);
    line[f] = Number.isFinite(n) ? n : line[f];
  });

  return line;
}

function buildCartRecoveryLineToken(line) {
  if (!line || typeof line !== "object") return "";

  const role = line?.meta?.isPackOffer
    ? "P"
    : line?.meta?.includedInPack
      ? "C"
      : "N";

  const qty = roundQty3(getCartItemReservedQty(line));
  const idProd = getProductBaseId(line);
  const ref = String(
    line?.meta?.packRef ||
      line?.referencia ||
      line?.name ||
      line?.descripcion ||
      "",
  )
    .trim()
    .toLowerCase();

  let extra = "";
  if (role === "P") {
    const packId = Number(line?.meta?.packId || 0) || 0;
    const sel = Array.isArray(line?.meta?.packSelection)
      ? line.meta.packSelection
      : [];
    const selKey = selectionKeyFromArr(sel);
    extra = `|${packId}|${selKey}`;
  }

  return `${role}|${idProd}|${ref}|${qty}${extra}`;
}

function buildCartRecoverySignature(items) {
  const tokens = (Array.isArray(items) ? items : [])
    .map((line) => buildCartRecoveryLineToken(line))
    .filter(Boolean)
    .sort();

  return tokens.join("||");
}

function tryResolvePendingParkedTicketByCartMatch() {
  if (!Array.isArray(parkedTickets) || !parkedTickets.length) return false;
  if (!Array.isArray(cart) || !cart.length) return false;

  const cartSig = buildCartRecoverySignature(cart);
  if (!cartSig) return false;

  const idx = parkedTickets.findIndex((t) => {
    const sig = buildCartRecoverySignature(
      Array.isArray(t?.items) ? t.items : [],
    );
    return !!sig && sig === cartSig;
  });

  if (idx < 0) return false;

  currentParkedTicketIndex = idx;
  applyCustomerSelectionForParkedTicket(parkedTickets[idx]);
  PENDING_RUNTIME_PARKED_SYNC_KEY = "";
  PENDING_RUNTIME_PARKED_TICKET_ID = 0;
  return true;
}

function buildRuntimeCartSnapshotPayload() {
  const safeCart = Array.isArray(cart)
    ? cart
        .map((line) => {
          if (!line || typeof line !== "object") return null;
          const rest = { ...line };
          delete rest.__livePreviewQty;
          return rest;
        })
        .filter(Boolean)
    : [];

  const activeParkedTicket =
    currentParkedTicketIndex != null && Array.isArray(parkedTickets)
      ? parkedTickets[currentParkedTicketIndex] || null
      : null;

  const activeEl = document.activeElement;
  const activeElementId =
    activeEl && typeof activeEl.id === "string" && activeEl.id.trim()
      ? activeEl.id.trim()
      : null;

  const uiSnapshot = {
    selectedCategory:
      selectedCategory !== undefined && selectedCategory !== null
        ? String(selectedCategory)
        : null,
    activeFamilyParentId:
      activeFamilyParentId !== undefined && activeFamilyParentId !== null
        ? String(activeFamilyParentId)
        : null,
    activeSubfamilyId:
      activeSubfamilyId !== undefined && activeSubfamilyId !== null
        ? String(activeSubfamilyId)
        : null,
    searchTerm: String(searchInput?.value ?? searchTerm ?? ""),
    optionsOpen:
      !!optionsOverlay && !optionsOverlay.classList.contains("hidden"),
    focusElementId: activeElementId,
  };

  return {
    v: 2,
    ts: Date.now(),
    items: safeCart,
    uiSnapshot,
    selectedCategory:
      selectedCategory !== undefined && selectedCategory !== null
        ? String(selectedCategory)
        : null,
    parkedTicketSyncKey: getParkedTicketSyncKey(activeParkedTicket),
    parkedTicketId: Number(activeParkedTicket?.id || 0) || null,
  };
}

function tryResolvePendingParkedTicketIndex() {
  const key = String(PENDING_RUNTIME_PARKED_SYNC_KEY || "").trim();
  if (!Array.isArray(parkedTickets) || !parkedTickets.length) return false;

  const pendingId = Number(PENDING_RUNTIME_PARKED_TICKET_ID || 0) || 0;

  let idx = -1;
  if (key) {
    idx = parkedTickets.findIndex((t) => getParkedTicketSyncKey(t) === key);
  }

  if (idx < 0 && pendingId > 0) {
    idx = parkedTickets.findIndex((t) => Number(t?.id || 0) === pendingId);
  }

  if (idx < 0) {
    return tryResolvePendingParkedTicketByCartMatch();
  }

  currentParkedTicketIndex = idx;
  applyCustomerSelectionForParkedTicket(parkedTickets[idx]);
  PENDING_RUNTIME_PARKED_SYNC_KEY = "";
  PENDING_RUNTIME_PARKED_TICKET_ID = 0;
  return true;
}

function scheduleRuntimeCartSnapshotCfgWrite(
  payload,
  { immediate = false } = {},
) {
  try {
    if (!window.TPV_CFG?.set) return;

    if (CART_SNAPSHOT_CFG_WRITE_TIMER) {
      clearTimeout(CART_SNAPSHOT_CFG_WRITE_TIMER);
      CART_SNAPSHOT_CFG_WRITE_TIMER = null;
    }

    const writeNow = async () => {
      try {
        await window.TPV_CFG.set(RUNTIME_CART_SNAPSHOT_CFG_KEY, payload);
      } catch (e) {
        console.warn(
          "No se pudo guardar snapshot de carrito en TPV_CFG:",
          e?.message || e,
        );
      }
    };

    if (immediate) {
      writeNow();
      return;
    }

    CART_SNAPSHOT_CFG_WRITE_TIMER = setTimeout(() => {
      CART_SNAPSHOT_CFG_WRITE_TIMER = null;
      writeNow();
    }, 220);
  } catch (e) {
    console.warn(
      "No se pudo programar persistencia de snapshot:",
      e?.message || e,
    );
  }
}

function persistRuntimeCartSnapshot({ force = false } = {}) {
  try {
    if (!force && !CART_SNAPSHOT_ARMED) return;

    const payload = buildRuntimeCartSnapshotPayload();

    localStorage.setItem(RUNTIME_CART_SNAPSHOT_KEY, JSON.stringify(payload));

    scheduleRuntimeCartSnapshotCfgWrite(payload, { immediate: !!force });
  } catch (e) {
    console.warn("No se pudo guardar snapshot de carrito:", e?.message || e);
  }
}

async function restoreRuntimeCartSnapshot() {
  try {
    if (Array.isArray(cart) && cart.length > 0) return false;

    let parsed = null;

    try {
      const cfgRaw = await window.TPV_CFG?.get?.(RUNTIME_CART_SNAPSHOT_CFG_KEY);
      if (cfgRaw && typeof cfgRaw === "object") {
        parsed = cfgRaw;
      } else if (typeof cfgRaw === "string" && cfgRaw.trim()) {
        parsed = JSON.parse(cfgRaw);
      }
    } catch {}

    if (!parsed) {
      const raw = localStorage.getItem(RUNTIME_CART_SNAPSHOT_KEY);
      if (raw) {
        parsed = JSON.parse(raw);
      }
    }

    if (!parsed) return false;

    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    const restored = items.map(normalizeCartLineFromSnapshot).filter(Boolean);

    if (!restored.length) return false;

    cart = restored;

    const uiSnapshot =
      parsed?.uiSnapshot && typeof parsed.uiSnapshot === "object"
        ? parsed.uiSnapshot
        : null;

    const normalizeIdOrNull = (value) => {
      if (value === undefined || value === null || value === "") return null;
      return String(value);
    };

    const restoredCategoryRaw =
      uiSnapshot?.selectedCategory ?? parsed?.selectedCategory;
    selectedCategory = normalizeIdOrNull(restoredCategoryRaw);
    activeFamilyParentId = normalizeIdOrNull(uiSnapshot?.activeFamilyParentId);
    activeSubfamilyId = normalizeIdOrNull(uiSnapshot?.activeSubfamilyId);

    const restoredSearch = String(uiSnapshot?.searchTerm ?? "");
    searchTerm = restoredSearch;
    if (searchInput) searchInput.value = restoredSearch;

    PENDING_RUNTIME_UI_RESTORE = {
      optionsOpen: !!uiSnapshot?.optionsOpen,
      focusElementId: normalizeIdOrNull(uiSnapshot?.focusElementId),
    };

    const parkedSyncKey = String(parsed?.parkedTicketSyncKey || "").trim();
    const parkedTicketId = Number(parsed?.parkedTicketId || 0) || 0;
    PENDING_RUNTIME_PARKED_SYNC_KEY = parkedSyncKey;
    PENDING_RUNTIME_PARKED_TICKET_ID = parkedTicketId;

    if (!tryResolvePendingParkedTicketIndex()) {
      const cachedParked = loadParkedTicketsCache();
      if (cachedParked.length) {
        parkedTickets = cachedParked;
        tryResolvePendingParkedTicketIndex();
      }
    }

    // Si restauramos desde localStorage, replicamos a TPV_CFG para siguientes arranques.
    scheduleRuntimeCartSnapshotCfgWrite(parsed, { immediate: true });

    renderCategories?.();
    renderProducts?.();

    return true;
  } catch (e) {
    console.warn("No se pudo restaurar snapshot de carrito:", e?.message || e);
    return false;
  }
}

function scheduleRuntimeUiRestoreAfterBoot() {
  const pending = PENDING_RUNTIME_UI_RESTORE;
  if (!pending || typeof pending !== "object") return;

  const focusElementId = String(pending.focusElementId || "").trim();

  // No reabrir automáticamente Opciones tras actualización/reinicio.
  const wantsOptionsOpen = false;

  const applyFocus = () => {
    if (!focusElementId) return;

    const optionsOpen =
      !!optionsOverlay && !optionsOverlay.classList.contains("hidden");
    if (!optionsOpen && /^options/i.test(focusElementId)) return;

    const el = document.getElementById(focusElementId);
    if (!el || typeof el.focus !== "function") return;
    try {
      el.focus();
      if (typeof el.select === "function") el.select();
    } catch {}
  };

  const clearPending = () => {
    PENDING_RUNTIME_UI_RESTORE = null;
  };

  if (!wantsOptionsOpen) {
    setTimeout(() => {
      applyFocus();
      clearPending();
    }, 40);
    return;
  }

  let retries = 0;
  const maxRetries = 20;

  const tryOpenOptions = async () => {
    if (!PENDING_RUNTIME_UI_RESTORE) return;
    retries += 1;

    const canOpenOptions = !!(cashSession?.open && hasActiveLoginSession());
    if (canOpenOptions) {
      try {
        await openOptions();
      } catch {}

      setTimeout(() => {
        applyFocus();
      }, 120);

      clearPending();
      return;
    }

    if (retries >= maxRetries) {
      clearPending();
      return;
    }

    setTimeout(tryOpenOptions, 250);
  };

  setTimeout(tryOpenOptions, 120);
}

function renderCart() {
  const container = document.getElementById("cartLines");
  if (!container) return;
  container.innerHTML = "";

  let total = 0;
  const cartItems = Array.isArray(cart) ? cart : [];

  // Índice O(1) de hijos por parent para evitar filtrar todo el carrito por línea.
  const packChildrenByParent = new Map();
  cartItems.forEach((line) => {
    const parentId = String(line?.meta?.parentPackLineId || "").trim();
    if (!parentId) return;
    if (!packChildrenByParent.has(parentId)) {
      packChildrenByParent.set(parentId, []);
    }
    packChildrenByParent.get(parentId).push(line);
  });

  // ✅ UI: solo pintamos líneas NO-hijas
  const uiLines = getVisibleCartLines(cartItems);

  const buildCartLineMiniLegend = (pricing) => {
    const tags = [];
    if (pricing?.manualPriceLocked) tags.push("Manual");
    if (pricing?.tariffApplied) tags.push("Tarifa");
    if (pricing?.cartDiscountApplied) {
      tags.push(
        pricing?.cartDiscountSource === "line"
          ? "Dto linea (prioridad)"
          : "Dto general",
      );
    }
    if (!tags.length) return "";
    return `<div class="cart-line-mini-legend">${tags.join(" · ")}</div>`;
  };

  uiLines.forEach((item) => {
    const pricing = getCartLinePricing(item);
    const unitPrice = Number(pricing.unitGross || 0);
    const lineTotal = Number(pricing.lineTotal || 0);
    total += lineTotal;

    const row = document.createElement("div");
    row.className = "cart-line";
    row.dataset.lineid = item._lineId;

    const modifiedMark = isPriceModified(item)
      ? " <span class='price-mod'>MOD</span>"
      : "";

    const pricingBadges = [];
    if (pricing.tariffApplied) {
      const tariffLabel =
        pricing.tariffDiscountPct > 0 && pricing.tariffDiscountFixed > 0
          ? `${pricing.tariffMode === "coste" ? "+" : "-"}${formatDiscountPercent(pricing.tariffDiscountPct)}% y ${pricing.tariffMode === "coste" ? "+" : "-"}${eur(pricing.tariffDiscountFixed)}`
          : pricing.tariffDiscountPct > 0
            ? `${pricing.tariffMode === "coste" ? "+" : "-"}${formatDiscountPercent(pricing.tariffDiscountPct)}%`
            : pricing.tariffDiscountFixed > 0
              ? `${pricing.tariffMode === "coste" ? "+" : "-"}${eur(pricing.tariffDiscountFixed)}`
              : "Tarifa";
      pricingBadges.push(
        `<span class="cart-price-discount">${tariffLabel}</span>`,
      );
    }

    if (pricing.cartDiscountApplied) {
      const sourceLabel =
        pricing.cartDiscountSource === "line" ? "Línea" : "General";
      pricingBadges.push(
        `<span class="cart-price-discount cart-price-discount--cart">${sourceLabel} -${formatDiscountPercent(pricing.cartDiscountPct)}%</span>`,
      );
    }

    const unitTxt = pricing.anyPricingAdjustment
      ? `<span class="cart-price-old">${eur(pricing.baseUnitGross)}</span><span class="cart-price-new">${eur(unitPrice)}</span>${pricingBadges.join("")}${modifiedMark}`
      : eur(unitPrice) + modifiedMark;

    const lineTxt = pricing.anyPricingAdjustment
      ? `<span class="cart-price-old">${eur(pricing.baseLineTotal)}</span><span class="cart-price-new">${eur(lineTotal)}</span>`
      : eur(lineTotal);

    // ✅ Si es pack, añadimos "Incluye: ..."
    let includesText = "";
    if (isPackParentLine(item)) {
      const parentChildren =
        packChildrenByParent.get(String(item._lineId)) || [];
      includesText = buildPackIncludesTextFromChildren(
        parentChildren,
        item._lineId,
      );
      if (!includesText) includesText = getPackIncludesTextForParentLine(item);
      if (includesText) includesText = "Incluye: " + includesText;
    }

    row.innerHTML = `
      <div class="cart-line-name">
        <div class="cart-line-name-head">
          <div>${item.name}</div>
          ${
            isPackParentLine(item)
              ? `<button class="cart-line-pack-edit" data-action="pack-edit" data-lineid="${item._lineId}" title="Editar oferta" aria-label="Editar oferta">✎</button>`
              : ""
          }
        </div>

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

        ${buildCartLineMiniLegend(pricing)}

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
        <button type="button" class="line-price-btn ${pricing.anyPricingAdjustment ? "has-cart-tariff" : ""}" data-action="price" data-lineid="${item._lineId}">
          ${lineTxt}
        </button>
        ${
          cartDiscountToolsEnabled
            ? `<button class="line-discount-btn ${getCartLineDiscountPercent(item) > 0 ? "is-active" : ""}" data-action="line-discount" data-lineid="${item._lineId}" title="Descuento de línea">%</button>`
            : ""
        }
        <button class="line-delete-btn" data-lineid="${item._lineId}">✕</button>
      </div>
    `;

    container.appendChild(row);
  });

  const totalEl = document.getElementById("totalAmount");
  if (totalEl) totalEl.textContent = eur(total);

  // ✅ Completar imageUrl para customer display (solo si no viene)
  // Completa imageUrl sin O(n*m): crea índice solo si hay líneas sin imagen.
  if (cartItems.some((item) => !item?.imageUrl && item?.id != null)) {
    const imageByProductId = new Map();
    (Array.isArray(products) ? products : []).forEach((p) => {
      const id = String(Number(p?.id || 0));
      if (!id || id === "0") return;
      if (!p?.imageUrl) return;
      if (!imageByProductId.has(id)) imageByProductId.set(id, p.imageUrl);
    });

    cartItems.forEach((item) => {
      if (item?.imageUrl || item?.id == null) return;
      const hit = imageByProductId.get(String(Number(item.id || 0)));
      if (hit) item.imageUrl = hit;
    });
  }

  // ✅ si empieza un nuevo carrito, dejamos de mostrar el último cobrado
  // (excepto durante un cobro en curso)
  if ((cart?.length || 0) > 0 && customerMode === "THANKS" && !isPayingNow) {
    customerMode = "CART";
    customerThanksUntil = 0;
  }

  if ((cart?.length || 0) > 0 && customerDisplayOverride && !isPayingNow) {
    customerDisplayOverride = null;
  }

  pushCustomerState();
  refreshAgentGuardUI?.();

  if (!uiLines.length && currentParkedTicketIndex !== null) {
    restorePreParkedCustomerSelection();
    currentParkedTicketIndex = null;
  }

  persistRuntimeCartSnapshot();

  if (currentParkedTicketIndex == null && PENDING_RUNTIME_PARKED_SYNC_KEY) {
    if (tryResolvePendingParkedTicketIndex()) {
      refreshParkButtonUI();
      refreshParkedEditingBanner();
    }
  }

  refreshParkButtonUI();
  refreshParkedEditingBanner();
  refreshCartDiscountUi();
}

const LOGIN_TOKEN_KEY = "tpv_login_token";
const LOGIN_USER_KEY = "tpv_login_user";

let LOGIN_ACTIVE = false;
let LOGIN_MODAL_PROMISE = null;
let LOGIN_MODAL_DRAFT = {
  user: "",
  pin: "",
  isAdmin: false,
};

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

function hasActiveLoginSession() {
  const user = String(getLoginUser() || "").trim();
  const token = String(getLoginToken() || "").trim();
  return !!(user && token);
}

async function getRememberedLoginUser() {
  const fromDraft = String(LOGIN_MODAL_DRAFT?.user || "").trim();
  if (fromDraft) return fromDraft;

  const fromSession = String(getLoginUser?.() || "").trim();
  if (fromSession) return fromSession;

  const fromLast = String(
    localStorage.getItem(LOGIN_LAST_USER_KEY) || "",
  ).trim();
  if (fromLast) return fromLast;

  try {
    const fromCfg = String(
      (await window.TPV_CFG?.get?.("tpv.lastUser")) || "",
    ).trim();
    if (fromCfg) return fromCfg;
  } catch {}

  return "";
}

function updateSessionLockUi() {
  const locked = !hasActiveLoginSession() && !LOGIN_ACTIVE;
  document.body.classList.toggle("session-locked", locked);
  const companyReady = hasCompanyResolved();

  if (mainAgentBar) {
    mainAgentBar.classList.toggle("session-agentbar-hidden", locked);
  }

  if (agentNameEl) {
    agentNameEl.classList.toggle("session-agent-disabled", locked);
    agentNameEl.setAttribute("aria-disabled", locked ? "true" : "false");
    if (locked) {
      agentNameEl.title = "Inicia sesión para seleccionar agente";
    } else if (agentNameEl.title === "Inicia sesión para seleccionar agente") {
      agentNameEl.title = "";
    }
  }

  let hint = document.getElementById("sessionLockHint");
  const productsArea = document.querySelector(".products-area");
  if (!hint && productsArea) {
    hint = document.createElement("div");
    hint.id = "sessionLockHint";
    hint.className = "session-lock-hint hidden";
    hint.innerHTML =
      '<div class="session-lock-hint-card"><div class="session-lock-hint-title">No hay usuario activo</div><button type="button" id="sessionLockHintBtn">Iniciar sesión</button></div>';
    productsArea.appendChild(hint);

    const btn = hint.querySelector("#sessionLockHintBtn");
    btn?.addEventListener("click", async () => {
      if (TPV_LOADING) return;

      if (!hasCompanyResolved()) {
        const okSetup = await forceReconnectFlow?.();
        if (okSetup && hasCompanyResolved()) {
          const okLoginAfterSetup = await openLoginModal();
          if (okLoginAfterSetup && hasActiveLoginSession()) {
            updateSessionLockUi();
          }
        } else {
          updateSessionLockUi();
        }
        return;
      }

      const ok = await openLoginModal();
      if (ok && hasActiveLoginSession()) {
        updateSessionLockUi();
      }
    });
  }

  if (hint) {
    const titleEl = hint.querySelector(".session-lock-hint-title");
    const btnEl = hint.querySelector("#sessionLockHintBtn");
    if (titleEl && btnEl) {
      if (companyReady) {
        titleEl.textContent = "No hay usuario activo";
        btnEl.textContent = "Iniciar sesión";
      } else {
        titleEl.textContent = "Falta activar la empresa";
        btnEl.textContent = "Escribir email";
      }
    }
  }

  if (hint) {
    hint.classList.toggle("hidden", !locked);
  }

  const optionsBtn = document.getElementById("optionsBtn");
  if (optionsBtn && locked) {
    optionsBtn.disabled = false;
    optionsBtn.title = "Opciones";
  }
}

function applyLoggedOutUiState({ lock = true } = {}) {
  document.body.classList.toggle("session-locked", !!lock);
  unlockAppUI();

  currentAgent = null;
  setAdminFlag?.(false, "logout");
  refreshOptionsUI?.();

  if (agentNameEl) agentNameEl.textContent = "---";
  refreshLoggedUserUI?.();
  renderMainAgentBar?.();
  refreshAgentGuardUI?.();
  updateSessionLockUi();
}

function setLoginSession({ token, user, codagente, codalmacen }) {
  localStorage.setItem("tpv_login_token", token || "");
  localStorage.setItem("tpv_login_user", user || "");
  localStorage.setItem("tpv_login_codagente", codagente || "");
  localStorage.setItem("tpv_login_codalmacen", codalmacen || "");
  if (String(user || "").trim()) {
    localStorage.setItem(LOGIN_LAST_USER_KEY, String(user).trim());
  }
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
  const statusEl = document.getElementById("loginStatus");
  const okBtn = document.getElementById("loginOkBtn");
  const exitBtn = document.getElementById("loginExitBtn");
  const pinPad = document.getElementById("loginPinPad");
  const pinSection = document.querySelector(".login-pin-wrap");
  const pinTitle = passInp.previousElementSibling;

  if (!overlay || !usersBar || !passInp || !okBtn || !exitBtn) return false;

  if (LOGIN_MODAL_PROMISE) return LOGIN_MODAL_PROMISE;

  const rememberedUser = await getRememberedLoginUser();
  let selectedUser = String(
    LOGIN_MODAL_DRAFT.user || rememberedUser || "",
  ).trim();
  let isAdminSelected = !!LOGIN_MODAL_DRAFT.isAdmin;
  let usersLoaded = false;
  let loginBusy = false;

  function saveLoginDraft() {
    LOGIN_MODAL_DRAFT = {
      user: String(selectedUser || "").trim(),
      pin: String(passInp.value || ""),
      isAdmin: !!isAdminSelected,
    };
  }

  function setLoginStatus(msg = "") {
    if (!statusEl) return;
    statusEl.textContent = msg;
  }

  function setPinVisibility(show) {
    const isVisible = !!show;
    if (pinSection) pinSection.style.display = isVisible ? "block" : "none";
    if (pinTitle) pinTitle.style.display = isVisible ? "block" : "none";
    passInp.style.display = isVisible ? "block" : "none";
  }

  function updateLoginSubmitState() {
    const hasUser = !!String(selectedUser || "").trim();
    const pinTxt = String(passInp.value || "").trim();
    const hasPin = !!pinTxt;
    const hasValidAdminPin = /^\d{4}$/.test(pinTxt);
    const needsPin = !!isAdminSelected;

    const canSubmit =
      usersLoaded && hasUser && (!needsPin || hasValidAdminPin) && !loginBusy;

    okBtn.disabled = !canSubmit;

    if (!usersLoaded) {
      setLoginStatus("Cargando TPV, espere por favor...");
      return;
    }

    if (!hasUser) {
      setLoginStatus("Aun no se ha seleccionado ningun usuario.");
      return;
    }

    if (needsPin && !hasPin) {
      setLoginStatus("Usuario administrador seleccionado. Introduce el PIN.");
      return;
    }

    if (needsPin && !hasValidAdminPin) {
      setLoginStatus("El PIN de administrador debe tener 4 digitos.");
      return;
    }

    if (TPV_STATE?.offline) {
      setLoginStatus("TPV cargado en modo offline. Ya puedes entrar.");
      return;
    }

    setLoginStatus("");
  }

  passInp.oninput = () => {
    errEl.textContent = "";
    saveLoginDraft();
    updateLoginSubmitState();
  };

  // --- 1) REPARACIÓN DE BOTONES NUMÉRICOS (PINPAD) ---
  if (pinPad) {
    pinPad.onclick = (e) => {
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
      errEl.textContent = "";
      saveLoginDraft();
      updateLoginSubmitState();
      passInp.focus();
    };
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
        return loadTpvUsersCache();

      const users = data.users
        .filter((u) => u && u.nick) // ya viene filtrado desde PHP
        .sort((a, b) => String(a.nick).localeCompare(String(b.nick), "es"));

      if (users.length) saveTpvUsersCache(users);

      return users;
    } catch (e) {
      console.error("❌ Error fetch tpv_users.php:", e);
      return loadTpvUsersCache();
    }
  };

  // --- 3) PINTAR BOTONES POR GRUPOS ---
  function renderUserButtons(userList) {
    usersBar.innerHTML = "";
    let matchedSelectedUser = false;

    const admins = userList.filter((u) => u.admin === true);
    const staff = userList.filter((u) => u.admin !== true);

    const createGroup = (title, list) => {
      if (list.length === 0) return;
      const t = document.createElement("div");
      t.className = "user-group-title";
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

          // PIN solo para admin. No limpiamos passInp para conservar lo tecleado.
          setPinVisibility(!!u.admin);
          saveLoginDraft();
          if (u.admin) passInp.focus();
          updateLoginSubmitState();
        };

        if (selectedUser && String(u.nick) === selectedUser) {
          btn.classList.add("selected");
          isAdminSelected = !!u.admin;
          matchedSelectedUser = true;
        }

        usersBar.appendChild(btn);
      });
    };

    createGroup("Administradores", admins);
    createGroup("Personal TPV", staff);

    if (matchedSelectedUser) {
      setPinVisibility(!!isAdminSelected);
    } else {
      selectedUser = "";
      isAdminSelected = false;
      setPinVisibility(false);
    }

    saveLoginDraft();
  }
  // --- 4) LÓGICA DE LOGIN ---
  const doLogin = async () => {
    if (!usersLoaded || loginBusy) return false;

    const u = (selectedUser || "").trim();
    const p = (passInp.value || "").trim();

    if (!u) {
      errEl.textContent = "Selecciona un usuario.";
      return false;
    }
    if (isAdminSelected && !/^\d{4}$/.test(p)) {
      errEl.textContent = "El PIN debe tener 4 digitos.";
      updateLoginSubmitState();
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

    const finalizeLoginSuccess = async ({
      loggedUser,
      token,
      codagente = "",
      codalmacen = "",
      isAdmin = false,
    }) => {
      const safeUser = String(loggedUser || u || "").trim();
      const safeToken = String(token || "").trim();

      if (!safeUser || !safeToken) {
        errEl.textContent = "Respuesta inválida del servidor (sin token).";
        loginBusy = false;
        updateLoginSubmitState();
        return false;
      }

      try {
        localStorage.setItem("tpv_login_user", safeUser);
        localStorage.setItem("tpv_login_token", safeToken);
      } catch {}

      setLoginSession({
        token: safeToken,
        user: safeUser,
        codagente: codagente || "",
        codalmacen: codalmacen || "",
      });

      try {
        localStorage.setItem(LOGIN_LAST_USER_KEY, safeUser);
      } catch {}

      try {
        if (window.TPV_CFG) await window.TPV_CFG.set("tpv.lastUser", safeUser);
      } catch {}

      setAdminFlag(!!isAdmin, "login");
      await loadPriceEditModeFromCfg?.();
      await warmupPacksData({ force: true }).catch(() => {});

      if (window.TPV_CFG) {
        await window.TPV_CFG.set("auth.username", safeUser);
        await window.TPV_CFG.set("auth.token", safeToken);
        await window.TPV_CFG.set("auth.isAdmin", !!isAdmin);

        if (codagente) {
          await window.TPV_CFG.set("auth.codagente", String(codagente));
        }
        if (codalmacen) {
          await window.TPV_CFG.set("auth.codalmacen", String(codalmacen));
        }
      }

      try {
        await window.TPV_AUTH?.setCurrentUser?.(safeUser, !!isAdmin);
      } catch {}

      try {
        const idcaja = getCajaIdSafe?.();
        if (idcaja && !TPV_STATE?.offline) {
          await apiWrite(`tpvcajas/${idcaja}`, "PATCH", {
            idcaja: String(idcaja),
            nick: String(safeUser || "").trim(),
          });
        }
      } catch (e) {
        console.warn(
          "[LOGIN] No pude actualizar nick en caja:",
          e?.message || e,
        );
      }

      overlay.classList.add("hidden");
      unlockAppUI();
      CART_SNAPSHOT_ARMED = true;
      updateSessionLockUi();

      if (codagente) {
        const wanted = String(codagente || "").trim();
        const listNow = currentTerminal
          ? getAgentsForTerminalId(currentTerminal.id)
          : [];
        const picked = (Array.isArray(listNow) ? listNow : []).find(
          (a) => String(a?.codagente || "").trim() === wanted,
        );
        if (picked) currentAgent = picked;
      }

      refreshLoggedUserUI?.();
      refreshAgentGuardUI?.();

      LOGIN_MODAL_DRAFT = {
        user: safeUser,
        pin: "",
        isAdmin: !!isAdmin,
      };

      LOGIN_ACTIVE = false;

      if (!BOOT_IN_FLIGHT) {
        await ensureTerminalAgentDefaults();
        renderCashIdChip();

        if (cashSession?.open) {
          renderMainUI?.();
        } else {
          renderMainUI?.();
        }
      }

      return true;
    };

    // Evita reautenticar contra tpv_login.php si ya hay sesión activa del mismo usuario.
    // Algunos backends aplican efectos colaterales al re-login (p. ej. estado de acceso web).
    const activeUserNow = String(getLoginUser?.() || "").trim();
    const activeTokenNow = String(getLoginToken?.() || "").trim();
    if (activeUserNow && activeTokenNow && activeUserNow === u) {
      return await finalizeLoginSuccess({
        loggedUser: activeUserNow,
        token: activeTokenNow,
        codagente: String(
          localStorage.getItem("tpv_login_codagente") || "",
        ).trim(),
        codalmacen: String(
          localStorage.getItem("tpv_login_codalmacen") || "",
        ).trim(),
        isAdmin: !!isAdminSelected,
      });
    }

    const body = new URLSearchParams();
    body.append("companyEmail", companyEmail);
    body.append("user", u);
    body.append("pass", isAdminSelected ? p : "0000");

    errEl.textContent = "";
    loginBusy = true;
    updateLoginSubmitState();

    if (TPV_STATE?.offline) {
      const cachedUsers = loadTpvUsersCache();
      const localUser = (Array.isArray(cachedUsers) ? cachedUsers : []).find(
        (row) => String(row?.nick || "").trim() === u,
      );

      if (!localUser) {
        errEl.textContent =
          "Sin internet y usuario no disponible en caché local.";
        loginBusy = false;
        updateLoginSubmitState();
        return false;
      }

      return await finalizeLoginSuccess({
        loggedUser: u,
        token: `offline:${Date.now()}:${u}`,
        codagente: String(localUser?.codagente || "").trim(),
        codalmacen: String(localUser?.codalmacen || "").trim(),
        isAdmin: !!isAdminSelected,
      });
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const data = await res.json().catch(() => null);

      if (!data || !data.ok) {
        errEl.textContent = data?.message || "PIN incorrecto";
        loginBusy = false;
        updateLoginSubmitState();
        return false;
      }

      return await finalizeLoginSuccess({
        loggedUser: (data.user || u || "").trim(),
        token: (data.token || "").trim(),
        codagente: data.codagente || "",
        codalmacen: data.codalmacen || "",
        isAdmin: !!isAdminSelected,
      });
    } catch (e) {
      errEl.textContent = "Error de conexión";
      loginBusy = false;
      updateLoginSubmitState();
      return false;
    }
  };

  // --- ESTADO INICIAL ---
  errEl.textContent = "";
  passInp.value = String(LOGIN_MODAL_DRAFT.pin || "");
  setPinVisibility(!!isAdminSelected);
  usersLoaded = false;
  loginBusy = false;
  saveLoginDraft();
  updateLoginSubmitState();
  overlay.classList.remove("hidden");
  lockAppUI();
  LOGIN_ACTIVE = true;
  updateSessionLockUi();

  try {
    const users = await fetchFsUsers();
    renderUserButtons(users);
    usersLoaded = true;
  } catch (e) {
    renderUserButtons([{ nick: "admin", admin: true }]);
    usersLoaded = true;
  }

  updateLoginSubmitState();

  const modalPromise = new Promise((resolve) => {
    okBtn.onclick = async () => {
      if (await doLogin()) resolve(true);
    };
    exitBtn.onclick = () => {
      saveLoginDraft();
      overlay.classList.add("hidden");
      LOGIN_ACTIVE = false;

      if (hasActiveLoginSession()) {
        unlockAppUI();
      } else {
        applyLoggedOutUiState({ lock: true });
      }

      resolve(false);
    };
  });

  LOGIN_MODAL_PROMISE = modalPromise.finally(() => {
    LOGIN_MODAL_PROMISE = null;
  });

  return await LOGIN_MODAL_PROMISE;
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
    await warmupPacksData({ force: true }).catch(() => {});

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
    await warmupPacksData({ force: true }).catch(() => {});
    refreshLoggedUserUI?.();
    return true;
  }

  // 3) pedir login
  const ok = await openLoginModal();
  return !!ok;
}

// ===== [09] Modales UI: confirmacion generica (msgOverlay) =====
function escapeHtmlForModal(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function confirmModal(title, text, options = {}) {
  const overlay = document.getElementById("msgOverlay");
  const dialogEl = overlay?.querySelector?.(".simple-dialog");
  const titleEl = document.getElementById("msgTitle");
  const textEl = document.getElementById("msgText");
  const okBtn = document.getElementById("msgOkBtn");
  const cancelBtn = document.getElementById("msgCancelBtn");
  const midBtn = document.getElementById("msgMidBtn");

  if (!overlay || !titleEl || !textEl || !okBtn || !cancelBtn) {
    // fallback seguro si falta algo
    return Promise.resolve(window.confirm(text));
  }

  okBtn.textContent = "Aceptar";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.classList.remove("hidden");

  titleEl.textContent = title || "Confirmar";
  const {
    isHtml = false,
    textClassName = "",
    dialogClassName = "",
    middleButtonText = "",
    middleButtonResult = "middle",
  } = options || {};

  if (dialogEl) {
    dialogEl.classList.remove("stock-warning-dialog");
    if (dialogClassName) dialogEl.classList.add(dialogClassName);
  }

  if (isHtml) {
    textEl.innerHTML = text || "";
    textEl.style.whiteSpace = "normal";
  } else {
    textEl.textContent = text || "";
    textEl.style.whiteSpace = "pre-line";
  }

  textEl.className = textClassName || "";
  textEl.style.maxHeight = isHtml ? "none" : "260px";
  textEl.style.overflowY = isHtml ? "visible" : "auto";
  textEl.style.paddingRight = "4px";

  if (midBtn) {
    const hasMiddle = String(middleButtonText || "").trim() !== "";
    midBtn.textContent = hasMiddle ? String(middleButtonText) : "";
    midBtn.classList.toggle("hidden", !hasMiddle);
  }

  overlay.classList.remove("hidden");
  lockAppUI();

  return new Promise((resolve) => {
    const cleanup = () => {
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      if (midBtn) midBtn.onclick = null;
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

    if (midBtn && !midBtn.classList.contains("hidden")) {
      midBtn.onclick = () => {
        cleanup();
        resolve(middleButtonResult);
      };
    }
  });
}

window.TPV_UI?.onGuard?.(async ({ title, text }) => {
  await confirmModal(title || "Aviso", text || "");
});

// ===== [09] Feedback UI: toasts =====

function toast(message, type = "info", title = "") {
  if (isSafeTrainingModeEnabled()) {
    const t = String(type || "").toLowerCase();
    const text =
      `${String(title || "")} ${String(message || "")}`.toLowerCase();
    const isApiNoise =
      text.includes("facturascripts") ||
      text.includes("api") ||
      text.includes("sin internet") ||
      text.includes("sincroniz") ||
      text.includes("reserva remota") ||
      text.includes("en cola") ||
      text.includes("offline");

    if ((t === "warn" || t === "err") && isApiNoise) return;
  }

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

// ===== [09] Entrada UI: teclado numerico =====
const numPadOverlay = document.getElementById("numPadOverlay");
const numPadEl = numPadOverlay?.querySelector(".num-pad");
const numPadDisplay = document.getElementById("numPadDisplay");
const numPadProductName = document.getElementById("numPadProductName");
const numPadPricePreview = document.getElementById("numPadPricePreview");
const numPadTopDiscountPct = document.getElementById("numPadTopDiscountPct");
let numPadCurrentValue = "";
let numPadOnConfirm = null;
let numPadVisible = false;
let numPadOverwriteNextDigit = true;
let numPadMode = "qty"; // "qty" | "price"
let numPadOriginalUnitGross = null;
let numPadTargetItemId = null;
let numPadDefaultValue = "0";
let numPadLiveValue = null;
let numPadInitialValue = 0;
let numPadPricePreviewEnabled = true;
let numPadPricePreviewTopDiscountText = "";

// Función común para cerrar overlays de teclados al hacer clic fuera
function handleOverlayOutsideClick(e, padSelector, closeFn) {
  const pad = e.target.closest(padSelector);
  if (!pad) {
    closeFn();
    return true;
  }
  return false;
}

const KEYBOARD_LAYOUT_STORAGE_KEY = "tpv_keyboard_layout_v1";

function loadKeyboardLayoutState() {
  try {
    const raw = localStorage.getItem(KEYBOARD_LAYOUT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return { byAgent: {} };

    if (parsed.byAgent && typeof parsed.byAgent === "object") {
      return parsed;
    }

    // Migración desde formato legacy { qwerty: {...}, numpad: {...} }
    const legacyLayouts = {};
    Object.entries(parsed).forEach(([k, v]) => {
      if (!v || typeof v !== "object") return;
      if (
        Object.prototype.hasOwnProperty.call(v, "left") ||
        Object.prototype.hasOwnProperty.call(v, "top") ||
        Object.prototype.hasOwnProperty.call(v, "width")
      ) {
        legacyLayouts[k] = v;
      }
    });

    return {
      byAgent: Object.keys(legacyLayouts).length
        ? { _default: legacyLayouts }
        : {},
    };
  } catch {
    return { byAgent: {} };
  }
}

const keyboardLayoutState = loadKeyboardLayoutState();

function saveKeyboardLayoutState() {
  try {
    localStorage.setItem(
      KEYBOARD_LAYOUT_STORAGE_KEY,
      JSON.stringify(keyboardLayoutState),
    );
  } catch {}
}

function getKeyboardAgentScopeKey() {
  const code = String(currentAgent?.codagente || currentAgent?.id || "").trim();
  return code || "_default";
}

function createKeyboardWindowManager({
  id,
  overlay,
  pad,
  title,
  baseWidth,
  baseHeight = 420,
  resetWidth,
  resetHeight,
  minWidth = 420,
  maxWidth = 1300,
  minHeight = 260,
  maxHeight = 1000,
  allowFreeHeight = true,
  defaultAnchor = "bottom",
}) {
  if (!overlay || !pad) return null;

  if (!pad.querySelector(".kb-window-bar")) {
    const bar = document.createElement("div");
    bar.className = "kb-window-bar";
    bar.innerHTML = `
      <div class="kb-drag-handle" title="Mover teclado">${title}</div>
      <div class="kb-window-actions">
        <button type="button" class="kb-window-btn" data-kb-action="lock" title="Fijar o desbloquear posición">Fijar</button>
        <button type="button" class="kb-window-btn" data-kb-action="reset-pos" title="Centrar posición del teclado">Centrar</button>
        <button type="button" class="kb-window-btn" data-kb-action="reset-size" title="Restaurar tamaño original">Tamaño</button>
      </div>
    `;

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "kb-resize-handle";
    resizeHandle.title = "Cambiar tamaño";

    pad.prepend(bar);
    pad.appendChild(resizeHandle);
  }

  const dragHandle = pad.querySelector(".kb-drag-handle");
  const resizeHandle = pad.querySelector(".kb-resize-handle");
  const lockBtn = pad.querySelector('[data-kb-action="lock"]');
  const resetPosBtn = pad.querySelector('[data-kb-action="reset-pos"]');
  const resetSizeBtn = pad.querySelector('[data-kb-action="reset-size"]');

  let mode = null;
  let pointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startWidth = 0;
  let startHeight = 0;
  let movedSincePointerDown = false;
  let suppressCloseUntil = 0;

  function getSavedState() {
    const agentKey = getKeyboardAgentScopeKey();
    const byAgent = keyboardLayoutState.byAgent || {};
    return byAgent[agentKey]?.[id] || byAgent._default?.[id] || null;
  }

  function setSavedState(next) {
    const agentKey = getKeyboardAgentScopeKey();
    if (
      !keyboardLayoutState.byAgent ||
      typeof keyboardLayoutState.byAgent !== "object"
    ) {
      keyboardLayoutState.byAgent = {};
    }
    if (!keyboardLayoutState.byAgent[agentKey]) {
      keyboardLayoutState.byAgent[agentKey] = {};
    }
    keyboardLayoutState.byAgent[agentKey][id] = next;
    saveKeyboardLayoutState();
  }

  function getNaturalHeight(width, scale) {
    const prevWidth = pad.style.width;
    const prevHeight = pad.style.height;
    const prevScale = pad.style.getPropertyValue("--kb-scale");

    pad.style.width = `${Math.round(width)}px`;
    pad.style.setProperty("--kb-scale", String(scale || 1));
    pad.style.height = "auto";

    const natural = Math.ceil(pad.scrollHeight + 2);

    pad.style.width = prevWidth;
    pad.style.height = prevHeight;
    if (prevScale) pad.style.setProperty("--kb-scale", prevScale);
    else pad.style.removeProperty("--kb-scale");

    return natural;
  }

  function clampState(state) {
    const rect = pad.getBoundingClientRect();
    const maxAllowedWidth = Math.min(
      maxWidth,
      Math.max(minWidth, window.innerWidth - 16),
    );

    const requestedScale = Math.max(
      0.8,
      Math.min(1.35, Number(state.scale) || 1),
    );
    const width = Math.max(
      minWidth,
      Math.min(maxAllowedWidth, Number(state.width) || rect.width || baseWidth),
    );

    const naturalMinHeight = getNaturalHeight(width, requestedScale);
    const effectiveMinHeight = Math.max(minHeight, naturalMinHeight);
    const maxAllowedHeight = Math.min(
      maxHeight,
      Math.max(effectiveMinHeight, window.innerHeight - 16),
    );

    const autoHeight = !allowFreeHeight || state.autoHeight !== false;
    const height = Math.max(
      effectiveMinHeight,
      Math.min(
        maxAllowedHeight,
        Number(state.height) || rect.height || baseHeight,
      ),
    );

    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const visualHeight = autoHeight ? naturalMinHeight : height;
    const maxTop = Math.max(8, window.innerHeight - visualHeight - 8);

    const left = Math.max(8, Math.min(maxLeft, Number(state.left) || 8));
    const top = Math.max(8, Math.min(maxTop, Number(state.top) || 8));
    const locked = !!state.locked;

    return {
      left,
      top,
      width,
      height,
      scale: requestedScale,
      locked,
      autoHeight,
      naturalMinHeight,
    };
  }

  function updateLockUi(locked) {
    pad.classList.toggle("kb-locked", !!locked);
    if (lockBtn) lockBtn.textContent = locked ? "Fijado" : "Fijar";
    if (dragHandle) dragHandle.style.cursor = locked ? "default" : "grab";
    if (resizeHandle) resizeHandle.style.display = locked ? "none" : "block";
  }

  function applyState(rawState, { persist = false } = {}) {
    const state = clampState(rawState || {});
    pad.style.position = "fixed";
    pad.style.left = `${state.left}px`;
    pad.style.top = `${state.top}px`;
    pad.style.width = `${state.width}px`;
    pad.style.height = state.autoHeight
      ? "auto"
      : `${Math.max(state.height, state.naturalMinHeight)}px`;
    pad.style.setProperty("--kb-scale", String(state.scale));
    pad.classList.add("kb-floating");
    updateLockUi(state.locked);

    if (persist) setSavedState(state);
    return state;
  }

  function applyDefaultState({ persist = false } = {}) {
    const width = Math.max(
      minWidth,
      Math.min(baseWidth, window.innerWidth - 16),
    );
    const height = Math.max(
      minHeight,
      Math.min(baseHeight, window.innerHeight - 16),
    );
    const left = Math.max(8, Math.round((window.innerWidth - width) / 2));
    const top =
      defaultAnchor === "bottom"
        ? Math.max(8, window.innerHeight - height - 12)
        : Math.max(8, Math.round((window.innerHeight - height) / 2));

    return applyState(
      { left, top, width, height, scale: 1, locked: false },
      { persist },
    );
  }

  function resetPositionOnly() {
    const current = getSavedState() || applyDefaultState({ persist: false });
    const visualHeight = current.autoHeight
      ? getNaturalHeight(current.width || baseWidth, current.scale || 1)
      : current.height || baseHeight;
    const left = Math.max(
      8,
      Math.round((window.innerWidth - (current.width || baseWidth)) / 2),
    );
    const top =
      defaultAnchor === "bottom"
        ? Math.max(8, window.innerHeight - visualHeight - 12)
        : Math.max(8, Math.round((window.innerHeight - visualHeight) / 2));

    applyState({ ...current, left, top }, { persist: true });
  }

  function resetSizeOnly() {
    const current = getSavedState() || applyDefaultState({ persist: false });
    const targetWidth = Number(resetWidth) > 0 ? Number(resetWidth) : baseWidth;
    const targetHeight =
      Number(resetHeight) > 0 ? Number(resetHeight) : baseHeight;
    applyState(
      {
        ...current,
        width: targetWidth,
        height: targetHeight,
        scale: 1,
        autoHeight: true,
      },
      { persist: true },
    );
  }

  function onOpen() {
    const saved = getSavedState();
    if (saved) applyState(saved, { persist: false });
    else applyDefaultState({ persist: true });
  }

  function onPointerMove(e) {
    if (!mode || e.pointerId !== pointerId) return;
    if (e.cancelable) e.preventDefault();
    movedSincePointerDown = true;

    if (mode === "drag") {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      applyState(
        {
          left: startLeft + dx,
          top: startTop + dy,
          width: startWidth,
          height: startHeight,
          scale: Number(getSavedState()?.scale || 1),
          locked: !!getSavedState()?.locked,
        },
        { persist: true },
      );
      return;
    }

    if (mode === "resize") {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const nextWidth = startWidth + dx;
      const nextHeight = startHeight + dy;

      // En qwerty mantenemos altura automática para evitar huecos en blanco.
      if (!allowFreeHeight) {
        const nextScale = Math.max(0.8, Math.min(1.35, nextWidth / baseWidth));
        applyState(
          {
            left: startLeft,
            top: startTop,
            width: nextWidth,
            scale: nextScale,
            locked: !!getSavedState()?.locked,
            autoHeight: true,
          },
          { persist: true },
        );
        return;
      }

      const nextScale = Math.max(
        0.8,
        Math.min(
          1.35,
          Math.min(nextWidth / baseWidth, nextHeight / baseHeight),
        ),
      );
      applyState(
        {
          left: startLeft,
          top: startTop,
          width: nextWidth,
          height: nextHeight,
          scale: nextScale,
          locked: !!getSavedState()?.locked,
          autoHeight: false,
        },
        { persist: true },
      );
    }
  }

  function onPointerUp(e) {
    if (e.pointerId !== pointerId) return;
    if (movedSincePointerDown) suppressCloseUntil = Date.now() + 260;
    mode = null;
    pointerId = null;
    movedSincePointerDown = false;
    overlay.releasePointerCapture?.(e.pointerId);
    dragHandle?.releasePointerCapture?.(e.pointerId);
    resizeHandle?.releasePointerCapture?.(e.pointerId);
  }

  dragHandle?.addEventListener("pointerdown", (e) => {
    if (getSavedState()?.locked) return;
    e.preventDefault();
    const rect = pad.getBoundingClientRect();
    const saved = getSavedState() || {};

    mode = "drag";
    pointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startLeft = Number(saved.left ?? rect.left);
    startTop = Number(saved.top ?? rect.top);
    startWidth = Number(saved.width ?? rect.width);
    startHeight = Number(saved.height ?? rect.height);
    movedSincePointerDown = false;
    suppressCloseUntil = Date.now() + 220;
    e.currentTarget?.setPointerCapture?.(pointerId);
  });

  resizeHandle?.addEventListener("pointerdown", (e) => {
    if (getSavedState()?.locked) return;
    e.preventDefault();
    const rect = pad.getBoundingClientRect();
    const saved = getSavedState() || {};

    mode = "resize";
    pointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startLeft = Number(saved.left ?? rect.left);
    startTop = Number(saved.top ?? rect.top);
    startWidth = Number(saved.width ?? rect.width);
    startHeight = Number(saved.height ?? rect.height);
    movedSincePointerDown = false;
    suppressCloseUntil = Date.now() + 220;
    e.currentTarget?.setPointerCapture?.(pointerId);
  });

  overlay.addEventListener("pointermove", onPointerMove);
  overlay.addEventListener("pointerup", onPointerUp);
  overlay.addEventListener("pointercancel", onPointerUp);

  lockBtn?.addEventListener("click", () => {
    const current = getSavedState() || applyDefaultState({ persist: false });
    applyState({ ...current, locked: !current.locked }, { persist: true });
  });

  resetPosBtn?.addEventListener("click", () => {
    resetPositionOnly();
  });

  resetSizeBtn?.addEventListener("click", () => {
    if (getSavedState()?.locked) return;
    resetSizeOnly();
  });

  window.addEventListener("resize", () => {
    if (!overlay || overlay.classList.contains("hidden")) return;
    const saved = getSavedState();
    if (!saved) return;
    applyState(saved, { persist: true });
  });

  return {
    onOpen,
    shouldIgnoreOutsideClick: () => Date.now() < suppressCloseUntil || !!mode,
  };
}

const numPadWindowManager = createKeyboardWindowManager({
  id: "numpad",
  overlay: numPadOverlay,
  pad: numPadEl,
  title: "Teclado numerico",
  baseWidth: 720,
  baseHeight: 500,
  resetWidth: 460,
  resetHeight: 340,
  minWidth: 420,
  maxWidth: 1080,
  minHeight: 320,
  maxHeight: 900,
  allowFreeHeight: true,
  defaultAnchor: "center",
});

function normalizeNumericExpression(rawValue, { cashLenient = false } = {}) {
  let s = String(rawValue || "").trim();
  if (!s) return "";

  s = s
    .replace(/\s+/g, "")
    .replace(/[−–]/g, "-")
    .replace(/[×xX]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/,/g, ".");

  // En importes, permitir miles con punto cuando no hay operadores.
  if (cashLenient && !/[+\-*/()]/.test(s.slice(1))) {
    const sign = s.startsWith("-") ? "-" : "";
    const unsigned = sign ? s.slice(1) : s;
    const parts = unsigned.split(".");
    if (parts.length > 2) {
      s = `${sign}${parts.slice(0, -1).join("")}.${parts[parts.length - 1]}`;
    }
  }

  return s;
}

function evaluateNumericExpression(rawValue, { cashLenient = false } = {}) {
  const src = normalizeNumericExpression(rawValue, { cashLenient });
  if (!src) return 0;
  if (/[^0-9+\-*/().]/.test(src)) return null;

  let i = 0;

  function parseExpression() {
    let value = parseTerm();
    if (value == null) return null;

    while (i < src.length) {
      const op = src[i];
      if (op !== "+" && op !== "-") break;
      i += 1;
      const right = parseTerm();
      if (right == null) return null;
      value = op === "+" ? value + right : value - right;
    }

    return value;
  }

  function parseTerm() {
    let value = parseFactor();
    if (value == null) return null;

    while (i < src.length) {
      const op = src[i];
      if (op !== "*" && op !== "/") break;
      i += 1;
      const right = parseFactor();
      if (right == null) return null;
      if (op === "*") {
        value *= right;
      } else {
        if (right === 0) return null;
        value /= right;
      }
    }

    return value;
  }

  function parseFactor() {
    if (i >= src.length) return null;

    const ch = src[i];

    if (ch === "+" || ch === "-") {
      i += 1;
      const next = parseFactor();
      if (next == null) return null;
      return ch === "-" ? -next : next;
    }

    if (ch === "(") {
      i += 1;
      const inner = parseExpression();
      if (inner == null) return null;
      if (src[i] !== ")") return null;
      i += 1;
      return inner;
    }

    const start = i;
    let seenDot = false;
    while (i < src.length) {
      const c = src[i];
      if (c >= "0" && c <= "9") {
        i += 1;
        continue;
      }
      if (c === "." && !seenDot) {
        seenDot = true;
        i += 1;
        continue;
      }
      break;
    }

    if (i === start) return null;

    const token = src.slice(start, i);
    if (token === ".") return null;

    const n = Number(token);
    return Number.isFinite(n) ? n : null;
  }

  const result = parseExpression();
  if (result == null) return null;
  if (i !== src.length) return null;
  return Number.isFinite(result) ? result : null;
}

function formatPrice2(v) {
  const n = Number(String(v).replace(",", "."));
  if (!isFinite(n)) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

function hideNumPadPricePreview() {
  if (!numPadPricePreview) return;
  numPadPricePreview.classList.add("hidden");
  numPadPricePreview.innerHTML = "";
  numPadPricePreviewTopDiscountText = "";
  if (numPadTopDiscountPct) {
    numPadTopDiscountPct.classList.add("hidden");
    numPadTopDiscountPct.textContent = "";
  }
}

function buildNumPadPricePreviewHtml() {
  numPadPricePreviewTopDiscountText = "";
  if (numPadMode !== "price" || !numPadPricePreviewEnabled) return "";

  const item = cart.find((c) => c._lineId === numPadTargetItemId);
  if (!item) return "";

  const nextUnitGross = evaluateNumPadCurrentValue({ silent: true });
  if (nextUnitGross == null) return "";

  const qty = Math.max(0, Number(item?.qty || 0) || 0);
  const currentUnitGross = round2(Number(getUnitGross(item) || 0));
  const currentLineGross = round2(currentUnitGross * qty);

  const previewItem = { ...item, grossPriceOverride: round2(nextUnitGross) };
  const previewPricing = getCartLinePricing(previewItem);
  const previewUnitGross = round2(Number(previewPricing?.unitGross || 0));
  const previewBaseUnitGross = round2(
    Number(previewPricing?.baseUnitGross || previewUnitGross),
  );
  const previewLineGross = round2(Number(previewPricing?.lineTotal || 0));
  const previewBaseLineGross = round2(
    Number(previewPricing?.baseLineTotal || 0),
  );

  const hasPreviewDiscount = previewBaseUnitGross > previewUnitGross + 0.0001;
  const discountPctRawDerived =
    hasPreviewDiscount && previewBaseUnitGross > 0
      ? ((previewBaseUnitGross - previewUnitGross) / previewBaseUnitGross) * 100
      : 0;

  let preferredPct = 0;
  if (previewPricing?.cartDiscountApplied) {
    preferredPct = clampDiscountPercent(previewPricing?.cartDiscountPct);
  } else if (
    previewPricing?.tariffApplied &&
    Number(previewPricing?.tariffDiscountFixed || 0) <= 0
  ) {
    preferredPct = clampDiscountPercent(previewPricing?.tariffDiscountPct);
  } else {
    preferredPct = Math.max(0, discountPctRawDerived);
  }
  const discountPctDisplay =
    preferredPct > 0.0001 ? Math.round(preferredPct * 10) / 10 : 0;

  let html = "";

  if (hasPreviewDiscount) {
    if (discountPctDisplay > 0.0001) {
      numPadPricePreviewTopDiscountText = `-${formatDiscountPercent(discountPctDisplay)}%`;
    }
    const unitValues = `<span class="num-pad-price-preview-old">${eur(previewBaseUnitGross)}</span><span>${eur(previewUnitGross)}</span>`;
    html += `
      <div class="num-pad-price-preview-row num-pad-price-preview-row--unit">
        <span class="num-pad-price-preview-label">Unitario</span>
        <span class="num-pad-price-preview-values">${unitValues}</span>
      </div>
    `;

    if (qty > 1.0001) {
      const totalValues = `<span class="num-pad-price-preview-old">${eur(previewBaseLineGross)}</span><span>${eur(previewLineGross)}</span>`;
      html += `
        <div class="num-pad-price-preview-row num-pad-price-preview-row--total">
          <span class="num-pad-price-preview-label">Total x${fmtQty(qty)}</span>
          <span class="num-pad-price-preview-values">${totalValues}</span>
        </div>
      `;
    }
  } else if (qty > 1.0001) {
    html += `
      <div class="num-pad-price-preview-row num-pad-price-preview-row--totalonly">
        <span class="num-pad-price-preview-label">Total nuevo x${fmtQty(qty)}</span>
        <span class="num-pad-price-preview-values">${eur(previewLineGross)}</span>
      </div>
    `;
  }

  return html;
}

function updateNumPadPricePreview() {
  if (!numPadPricePreview) return;

  const html = buildNumPadPricePreviewHtml();
  if (!html) {
    hideNumPadPricePreview();
    return;
  }

  numPadPricePreview.innerHTML = html;
  numPadPricePreview.classList.remove("hidden");

  if (numPadTopDiscountPct && numPadPricePreviewTopDiscountText) {
    numPadTopDiscountPct.textContent = numPadPricePreviewTopDiscountText;
    numPadTopDiscountPct.classList.remove("hidden");
  } else if (numPadTopDiscountPct) {
    numPadTopDiscountPct.classList.add("hidden");
    numPadTopDiscountPct.textContent = "";
  }
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
    updateNumPadPricePreview();
    return;
  }

  hideNumPadPricePreview();

  // qty/cash (como lo tenías)
  numPadDisplay.textContent =
    numPadCurrentValue === "" ? "0" : String(numPadCurrentValue);

  applyNumPadPreview();
}

function evaluateNumPadCurrentValue({ silent = true } = {}) {
  const raw = String(numPadCurrentValue || "").trim();
  if (!raw) {
    if (numPadMode === "price") {
      const item = cart.find((c) => c._lineId === numPadTargetItemId);
      const fallback = item
        ? getUnitGross(item)
        : Number(numPadOriginalUnitGross) || 0;
      return Math.round(fallback * 100) / 100;
    }
    return 0;
  }

  const value = evaluateNumericExpression(raw, {
    cashLenient: numPadMode === "cash",
  });
  if (value == null) {
    if (!silent) toast("Expresión no válida", "warn", "Teclado");
    return null;
  }

  let nextValue = Number(value);
  if (!isFinite(nextValue)) return null;

  if (numPadMode === "price") {
    if (nextValue <= 0) nextValue = 0;
    return Math.round(nextValue * 100) / 100;
  }

  if (numPadMode === "cash") {
    if (nextValue < 0) nextValue = 0;
    return Math.round(nextValue * 100) / 100;
  }

  if (numPadMode === "stock") {
    return Math.round(nextValue * 1000) / 1000;
  }

  // qty
  if (nextValue <= 0) nextValue = 0;
  nextValue = Math.round(nextValue * 1000) / 1000;
  if (nextValue > 0 && nextValue < 0.001) nextValue = 0.001;
  return nextValue;
}

function applyNumPadPreview() {
  // El flujo de stock usa promesas para esperar OK; preview lo rompería.
  if (numPadMode === "stock") return;
  if (typeof numPadOnConfirm !== "function") return;

  const nextValue = evaluateNumPadCurrentValue({ silent: true });
  if (nextValue == null || nextValue === numPadLiveValue) return;

  numPadLiveValue = nextValue;
  numPadOnConfirm(nextValue, { phase: "preview", mode: numPadMode });
}

function openNumPad(
  initialValue,
  onConfirm,
  productName,
  mode = "qty",
  originalValue = null,
  targetId = null,
  options = null,
) {
  numPadMode = mode;
  numPadOriginalUnitGross = originalValue;
  numPadTargetItemId = targetId;

  numPadCurrentValue = initialValue != null ? String(initialValue) : "";
  numPadDefaultValue = numPadCurrentValue === "" ? "0" : numPadCurrentValue; // ✅
  numPadOverwriteNextDigit = true;
  numPadOnConfirm = onConfirm;
  numPadLiveValue = null;
  numPadInitialValue = evaluateNumPadCurrentValue({ silent: true }) ?? 0;
  numPadPricePreviewEnabled =
    mode === "price" ? options?.showPricePreview !== false : false;

  if (numPadProductName) {
    numPadProductName.textContent = productName ? ` - ${productName}` : "";
  }

  // ✅ si es precio, muestra botón “Restaurar”
  const resetBtn = document.querySelector('[data-key="resetPrice"]');
  if (resetBtn) resetBtn.style.display = mode === "price" ? "" : "none";

  updateNumPadDisplay();
  if (numPadOverlay) numPadOverlay.classList.remove("hidden");
  numPadWindowManager?.onOpen?.();
  numPadVisible = true;
}

function closeNumPad(reason = "cancel") {
  // Con preview en vivo:
  // - En caja (cash), cancelar/click-fuera limpia (0) como pidió el usuario.
  // - En qty/price, cancelar revierte al valor inicial para no dejar cambios sin OK.
  // - En stock no aplicamos preview y se mantiene el comportamiento original.
  if (
    reason !== "confirm" &&
    numPadMode !== "stock" &&
    typeof numPadOnConfirm === "function"
  ) {
    if (numPadMode === "cash") {
      numPadOnConfirm(0, { phase: "cancel", mode: numPadMode, reason });
    } else {
      numPadOnConfirm(numPadInitialValue, {
        phase: "cancel",
        mode: numPadMode,
        reason,
      });
    }
  }

  if (numPadOverlay) {
    numPadOverlay.classList.add("hidden");
  }
  if (numPadProductName) {
    numPadProductName.textContent = "";
  }
  hideNumPadPricePreview();
  numPadVisible = false;
  numPadOnConfirm = null;
  numPadLiveValue = null;
  numPadInitialValue = 0;
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
  const value = evaluateNumPadCurrentValue({ silent: false });
  if (value == null) return;

  if (typeof numPadOnConfirm === "function") {
    numPadOnConfirm(value, { phase: "confirm", mode: numPadMode });
  }
  closeNumPad("confirm");
  return;
}

if (numPadOverlay) {
  numPadOverlay.addEventListener("mousedown", (e) => {
    if (
      e.target.closest("[data-key]") ||
      e.target.closest(".kb-window-btn") ||
      e.target.closest(".kb-drag-handle") ||
      e.target.closest(".kb-resize-handle")
    ) {
      e.preventDefault();
    }
  });

  numPadOverlay.addEventListener("click", (e) => {
    if (numPadWindowManager?.shouldIgnoreOutsideClick?.()) return;

    if (handleOverlayOutsideClick(e, ".num-pad", () => closeNumPad("cancel"))) {
      return;
    }

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
      closeNumPad("cancel");
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
    if (/^[0-9+\-*/().,]$/.test(e.key)) {
      e.preventDefault();
      numPadAppend(e.key === "," ? "." : e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      numPadBackspace();
    } else if (e.key === "Enter") {
      e.preventDefault();
      numPadConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeNumPad("cancel");
    }
    return;
  }

  // Teclado QWERTY se gestiona más abajo
});

// ===== [09] Entrada UI: teclado QWERTY =====
const qwertyOverlay = document.getElementById("qwertyOverlay");
const qwertyPadEl = qwertyOverlay?.querySelector(".qwerty-pad");
const qwertyDisplay = document.getElementById("qwertyDisplay");
let qwertyCurrentValue = "";
let qwertyVisible = false;
let qwertyCaps = false;
let qwertyCaretStart = 0;
let qwertyCaretEnd = 0;
let qwertyCommitted = false;
let qwertyOriginalValue = "";

const qwertyWindowManager = createKeyboardWindowManager({
  id: "qwerty",
  overlay: qwertyOverlay,
  pad: qwertyPadEl,
  title: "Teclado qwerty",
  baseWidth: 860,
  baseHeight: 500,
  minWidth: 420,
  maxWidth: 1320,
  minHeight: 300,
  maxHeight: 940,
  allowFreeHeight: false,
  defaultAnchor: "center",
});

function clampQwertyCaret(pos, len) {
  const n = Number(pos);
  if (!Number.isFinite(n)) return len;
  return Math.max(0, Math.min(len, n));
}

function getQwertyInsertKey(rawKey) {
  const key = String(rawKey || "");
  if (!key) return "";
  if (key.length !== 1) return key;
  if (!/[a-zñ]/i.test(key)) return key;
  return qwertyCaps ? key.toUpperCase() : key.toLowerCase();
}

function syncQwertyDisplaySelection() {
  if (!qwertyDisplay) return;
  const len = String(qwertyCurrentValue || "").length;
  qwertyCaretStart = clampQwertyCaret(qwertyDisplay.selectionStart, len);
  qwertyCaretEnd = clampQwertyCaret(qwertyDisplay.selectionEnd, len);
}

function setQwertySelection(start, end = start) {
  const len = String(qwertyCurrentValue || "").length;
  qwertyCaretStart = clampQwertyCaret(start, len);
  qwertyCaretEnd = clampQwertyCaret(end, len);
  if (!qwertyDisplay) return;
  qwertyDisplay.setSelectionRange(qwertyCaretStart, qwertyCaretEnd);
}

function applyQwertyPreview() {
  if (!qwertyTargetInput) return;
  qwertyTargetInput.value = qwertyCurrentValue;

  if (qwertyTargetInput === searchInput) {
    searchTerm = qwertyCurrentValue;
    renderProducts();
  }

  qwertyTargetInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateQwertyDisplay() {
  if (!qwertyDisplay) return;
  qwertyDisplay.value = qwertyCurrentValue || "";
  setQwertySelection(qwertyCaretStart, qwertyCaretEnd);
}

function refreshQwertyKeysCase() {
  if (!qwertyOverlay) return;

  qwertyOverlay.querySelectorAll(".q-key").forEach((btn) => {
    const raw = String(btn.getAttribute("data-key") || "");
    const isLetter = raw.length === 1 && /[a-zñ]/i.test(raw);
    if (!isLetter) return;
    btn.textContent = qwertyCaps ? raw.toUpperCase() : raw.toLowerCase();
  });

  const capsBtn = qwertyOverlay.querySelector('.q-btn[data-key="caps"]');
  if (capsBtn) {
    capsBtn.classList.toggle("active", qwertyCaps);
    capsBtn.textContent = qwertyCaps ? "Minus" : "Mayus";
  }
}

function initQwertyKeysStyling() {
  if (!qwertyOverlay) return;
  qwertyOverlay.querySelectorAll(".q-key").forEach((btn) => {
    const key = String(btn.getAttribute("data-key") || "");
    btn.classList.remove("key-letter", "key-number", "key-special");

    if (/^[0-9]$/.test(key)) {
      btn.classList.add("key-number");
      return;
    }

    if (key.length === 1 && /[a-zñ]/i.test(key)) {
      btn.classList.add("key-letter");
      return;
    }

    btn.classList.add("key-special");
  });

  refreshQwertyKeysCase();
}

let qwertyTargetInput = null;

// default: text
function openQwertyForInput(inputEl, mode = "text") {
  qwertyMode = mode;
  qwertyCommitted = false;

  const emailRow = document.getElementById("qwertyEmailRow");
  if (emailRow) {
    emailRow.classList.toggle("hidden", qwertyMode !== "email");
  }

  qwertyTargetInput = inputEl || null;
  qwertyOriginalValue = inputEl?.value ? String(inputEl.value) : "";
  qwertyCurrentValue = qwertyOriginalValue;
  qwertyCaps = false;
  qwertyCaretStart = qwertyCurrentValue.length;
  qwertyCaretEnd = qwertyCurrentValue.length;
  refreshQwertyKeysCase();
  updateQwertyDisplay();
  applyQwertyPreview();

  const qwertyOverlay = document.getElementById("qwertyOverlay");
  if (qwertyOverlay) qwertyOverlay.classList.remove("hidden");
  qwertyWindowManager?.onOpen?.();
  qwertyVisible = true;

  if (qwertyDisplay) {
    qwertyDisplay.focus();
    setQwertySelection(qwertyCurrentValue.length);
  }
}

function closeQwerty(reason = "cancel") {
  const emailRow = document.getElementById("qwertyEmailRow");
  if (emailRow) emailRow.classList.add("hidden");

  const shouldCommit = reason === "confirm" || qwertyCommitted;

  if (qwertyTargetInput) {
    if (shouldCommit) {
      qwertyTargetInput.value = qwertyCurrentValue;
    } else {
      qwertyTargetInput.value = qwertyOriginalValue;
      qwertyCurrentValue = qwertyOriginalValue;
      const end = qwertyCurrentValue.length;
      qwertyCaretStart = end;
      qwertyCaretEnd = end;
    }

    if (qwertyTargetInput === searchInput) {
      searchTerm = qwertyTargetInput.value || "";
      renderProducts();
    }

    qwertyTargetInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const qwertyOverlay = document.getElementById("qwertyOverlay");
  if (qwertyOverlay) qwertyOverlay.classList.add("hidden");

  qwertyVisible = false;
  qwertyMode = "text";
  qwertyTargetInput = null;
  qwertyOriginalValue = "";
}

function qwertyAddChar(ch) {
  if (qwertyDisplay && document.activeElement === qwertyDisplay) {
    syncQwertyDisplaySelection();
  }

  const insertion = getQwertyInsertKey(ch);
  const start = Math.min(qwertyCaretStart, qwertyCaretEnd);
  const end = Math.max(qwertyCaretStart, qwertyCaretEnd);
  const before = qwertyCurrentValue.slice(0, start);
  const after = qwertyCurrentValue.slice(end);
  qwertyCurrentValue = `${before}${insertion}${after}`;
  const nextCaret = start + insertion.length;
  setQwertySelection(nextCaret, nextCaret);
  updateQwertyDisplay();
  applyQwertyPreview();
}

function qwertyBackspace() {
  if (qwertyDisplay && document.activeElement === qwertyDisplay) {
    syncQwertyDisplaySelection();
  }

  const start = Math.min(qwertyCaretStart, qwertyCaretEnd);
  const end = Math.max(qwertyCaretStart, qwertyCaretEnd);
  if (start === 0 && end === 0) return;

  if (start !== end) {
    qwertyCurrentValue =
      qwertyCurrentValue.slice(0, start) + qwertyCurrentValue.slice(end);
    setQwertySelection(start, start);
  } else {
    qwertyCurrentValue =
      qwertyCurrentValue.slice(0, start - 1) + qwertyCurrentValue.slice(end);
    setQwertySelection(start - 1, start - 1);
  }

  updateQwertyDisplay();
  applyQwertyPreview();
}

function qwertyClearAll() {
  qwertyCurrentValue = "";
  setQwertySelection(0, 0);
  updateQwertyDisplay();
  applyQwertyPreview();
}

function qwertyConfirm() {
  qwertyCommitted = true;
  closeQwerty("confirm");
}

window.TPV_QWERTY = {
  openForInput: (inputEl, mode = "text") => openQwertyForInput(inputEl, mode),
  close: () => closeQwerty(),
};

if (searchKeyboardBtn) {
  searchKeyboardBtn.onclick = () => {
    openQwertyForInput(searchInput);
  };
}

if (qwertyOverlay) {
  initQwertyKeysStyling();

  // Evita que el foco salte a los botones del teclado al pulsarlos con mouse/touch.
  qwertyOverlay.addEventListener("mousedown", (e) => {
    if (
      e.target.closest("[data-key]") ||
      e.target.closest(".kb-window-btn") ||
      e.target.closest(".kb-drag-handle") ||
      e.target.closest(".kb-resize-handle")
    ) {
      e.preventDefault();
    }
  });

  if (qwertyDisplay) {
    qwertyDisplay.addEventListener("click", () => {
      syncQwertyDisplaySelection();
    });

    qwertyDisplay.addEventListener("keyup", () => {
      syncQwertyDisplaySelection();
    });

    qwertyDisplay.addEventListener("select", () => {
      syncQwertyDisplaySelection();
    });

    qwertyDisplay.addEventListener("input", () => {
      qwertyCurrentValue = qwertyDisplay.value || "";
      syncQwertyDisplaySelection();
      applyQwertyPreview();
    });
  }

  qwertyOverlay.addEventListener("click", (e) => {
    if (qwertyWindowManager?.shouldIgnoreOutsideClick?.()) return;

    if (
      handleOverlayOutsideClick(e, ".qwerty-pad", () => closeQwerty("cancel"))
    ) {
      return;
    }

    const keyBtn = e.target.closest("[data-key]");
    if (!keyBtn) return;

    if (qwertyDisplay && document.activeElement !== qwertyDisplay) {
      qwertyDisplay.focus();
      setQwertySelection(qwertyCaretStart, qwertyCaretEnd);
    }

    const key = keyBtn.getAttribute("data-key");
    if (key === ".com") {
      qwertyAddChar(".com");
    } else if (key === "gmail.com") {
      qwertyAddChar("gmail.com");
    } else if (key === "caps") {
      qwertyCaps = !qwertyCaps;
      refreshQwertyKeysCase();
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
      closeQwerty("cancel");
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
    closeQwerty("cancel");
  }
});

window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return;
  if (numPadVisible || qwertyVisible) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const target = e.target;
  const tagName = String(target?.tagName || "").toUpperCase();
  const isEditable =
    !!target?.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT";

  const now = Date.now();
  const key = String(e.key || "");

  // Si el foco está en un campo editable, solo atendemos secuencia de lector (dígitos + Enter).
  if (isEditable && !/^\d$/.test(key) && key !== "Enter") return;

  if (/^\d$/.test(key)) {
    if (now - barcodeScannerLastKeyAt > BARCODE_SCANNER_CFG.interKeyMaxMs) {
      barcodeScannerBuffer = "";
    }

    barcodeScannerBuffer += key;
    barcodeScannerLastKeyAt = now;

    if (barcodeScannerBuffer.length > BARCODE_SCANNER_CFG.maxLength) {
      barcodeScannerBuffer = barcodeScannerBuffer.slice(
        -BARCODE_SCANNER_CFG.maxLength,
      );
    }

    return;
  }

  if (key === "Enter") {
    const scanned = barcodeScannerBuffer;
    barcodeScannerBuffer = "";
    barcodeScannerLastKeyAt = 0;

    const normalized = normalizeBarcodeInput(scanned);
    if (normalized.length < BARCODE_SCANNER_CFG.minLength) return;

    e.preventDefault();
    void handleBarcodeScannerSubmit(normalized);
    return;
  }

  if (now - barcodeScannerLastKeyAt > BARCODE_SCANNER_CFG.interKeyMaxMs) {
    barcodeScannerBuffer = "";
    barcodeScannerLastKeyAt = 0;
  }
});

// ===== [09] Entrada UI: wiring QWERTY en inputs TPV =====
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

// ===== [08] UI venta: eventos del carrito =====
const cartLinesContainer = document.getElementById("cartLines");

if (cartLinesContainer) {
  cartLinesContainer.addEventListener("click", async (e) => {
    const lineId = e.target?.closest(".cart-line")?.dataset?.lineid;
    const item = lineId ? cart.find((c) => c._lineId === lineId) : null;

    const packEditBtn = e.target.closest('[data-action="pack-edit"]');
    if (packEditBtn) {
      if (!item || !isPackParentLine(item)) return;
      await openPackEditModalForParentLine(item);
      return;
    }

    // ✅ Bloquear TOTAL para hijos de pack
    if (item && isPackChildLine(item)) {
      toast("Producto incluido en oferta. Modifica la oferta.", "warn");
      return;
    }

    const lineDiscountBtn = e.target.closest('[data-action="line-discount"]');
    if (lineDiscountBtn) {
      if (!item) return;
      if (!cartDiscountToolsEnabled) {
        toast("Activa descuentos de carrito en Opciones.", "warn", "Carrito");
        return;
      }

      const currentPct = getCartLineDiscountPercent(item);
      const globalPct = getCartGlobalDiscountPercent();

      openNumPad(
        String(formatDiscountPercent(currentPct || globalPct || 0)),
        (nextValue, meta = {}) => {
          if (meta?.phase && meta.phase !== "confirm") return;

          const parsed = parseNumericLike(nextValue, 0);
          const pct = clampDiscountPercent(parsed);
          item.cartLineDiscountPct = pct;
          renderCart();
        },
        `${item.name} - descuento línea (%)`,
        "price",
        currentPct,
        lineId,
        { showPricePreview: false },
      );
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
          (newQty, meta = {}) => {
            const q = Number(String(newQty).replace(",", "."));
            if (!isFinite(q)) return;

            const qq = roundQty(q);
            const isConfirm = meta.phase === "confirm";

            if (isPackParentLine(item)) {
              if (isConfirm && qq <= 0) removePackCascade(item._lineId);
              else {
                item.qty = qq;
                syncSelectedPackChildrenQty(item);
              }
              renderCart();
              return;
            }

            if (isConfirm) updateCartItemQuantity(lineId, qq);
            else previewCartItemQuantity(lineId, qq);
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

      const currentOverrideRaw = item?.grossPriceOverride;
      const hadOverride =
        currentOverrideRaw !== null && currentOverrideRaw !== undefined;
      const previousOverride = hadOverride ? Number(currentOverrideRaw) : null;

      const editableBaseUnit = hadOverride
        ? Number(currentOverrideRaw)
        : Number(getOriginalUnitGross(item));

      const originalUnit =
        item.originalGrossPrice ?? item.grossPrice ?? item.price ?? 0;

      openNumPad(
        Number(editableBaseUnit || 0).toFixed(2),
        (newUnitGross, meta = {}) => {
          const phase = String(meta?.phase || "");

          if (phase === "preview") return;

          if (phase === "cancel") {
            item.grossPriceOverride = previousOverride;
            item.manualPriceLocksAdjustments = !!(
              previousOverride !== null && previousOverride !== undefined
            );
            renderCart();
            return;
          }

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

cartGlobalDiscountBtn?.addEventListener("click", () => {
  if (!cartDiscountToolsEnabled) {
    toast("Activa descuentos de carrito en Opciones.", "warn", "Carrito");
    return;
  }

  const current = getCartGlobalDiscountPercent();

  openNumPad(
    String(formatDiscountPercent(current || 0)),
    (nextValue, meta = {}) => {
      if (meta?.phase && meta.phase !== "confirm") return;

      const pct = clampDiscountPercent(parseNumericLike(nextValue, 0));
      cartGlobalDiscountPct = pct;
      renderCart();
    },
    "Descuento general carrito (%)",
    "price",
    current,
    null,
  );
});

cartGlobalDiscountClearBtn?.addEventListener("click", () => {
  if (!cartDiscountToolsEnabled) return;

  cartGlobalDiscountPct = 0;
  renderCart();
});

// ===== [06] UI base: indicador de estado =====
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

  if (!cashSession?.open) {
    badge.textContent = "0";
    return;
  }

  const pendingCount = (
    Array.isArray(parkedTickets) ? parkedTickets : []
  ).filter((t) => !t.paid && !t?.closingInProgress).length;

  badge.textContent = String(pendingCount);
}

function getCartTotal(items) {
  return (items || []).reduce((sum, item) => {
    const unit = getUnitGross(item);

    return sum + unit * (item.qty || 1);
  }, 0);
}

function clearAllCartLineDiscounts() {
  const lines = Array.isArray(cart) ? cart : [];
  lines.forEach((line) => {
    if (!line || typeof line !== "object") return;
    line.cartLineDiscountPct = 0;
  });
}

function refreshCartDiscountUi() {
  const enabled = !!cartDiscountToolsEnabled;
  if (cartGlobalDiscountRow) {
    cartGlobalDiscountRow.classList.toggle("hidden", !enabled);
  }

  if (!enabled) return;

  const globalPct = getCartGlobalDiscountPercent();
  const visibleLines = getVisibleCartLines(cart);
  const lineCount = visibleLines.filter(
    (line) => getCartLineDiscountPercent(line) > 0,
  ).length;

  if (cartGlobalDiscountSummary) {
    const globalText =
      globalPct > 0
        ? `Descuento general: -${formatDiscountPercent(globalPct)}%`
        : "Descuento general: sin aplicar";
    const lineText =
      lineCount > 0
        ? ` · Líneas con descuento: ${lineCount}`
        : " · Sin líneas con descuento";
    cartGlobalDiscountSummary.textContent = `${globalText}${lineText}`;
  }

  if (cartGlobalDiscountClearBtn) {
    cartGlobalDiscountClearBtn.disabled = globalPct <= 0 && lineCount <= 0;
  }
}

function buildLineIdSetFromSnapshot(items) {
  const ids = new Set();
  (Array.isArray(items) ? items : []).forEach((it) => {
    const id = String(it?._lineId || "").trim();
    if (id) ids.add(id);
  });
  return ids;
}

function removeCartLinesByIdSet(lineIds) {
  if (!(lineIds instanceof Set) || lineIds.size === 0) return;
  cart = (Array.isArray(cart) ? cart : []).filter((it) => {
    const id = String(it?._lineId || "").trim();
    return !lineIds.has(id);
  });
}

function restoreCartSnapshotWithoutDuplicates(snapshot) {
  const current = Array.isArray(cart) ? cart : [];
  const existing = new Set(
    current.map((it) => String(it?._lineId || "").trim()).filter((id) => !!id),
  );

  const toRestore = (Array.isArray(snapshot) ? snapshot : [])
    .filter((it) => {
      const id = String(it?._lineId || "").trim();
      return id && !existing.has(id);
    })
    .map((it) => ({ ...it }));

  if (!toRestore.length) return;
  cart = [...toRestore, ...current];
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

async function parkCurrentCart(name = "", obs = "") {
  const requestId = createRequestId("PARK");

  logFeatureInfo("APARCAR", "inicio", {
    requestId,
    cartLines: Array.isArray(cart) ? cart.length : 0,
    editing: currentParkedTicketIndex !== null,
  });

  if (!cart || cart.length === 0) {
    logFeatureWarn("APARCAR", "cancelado-carrito-vacio", { requestId });
    toast("No hay productos para aparcar.", "warn", "Aparcar");
    return;
  }

  const snapshot = cart.map((item) => ({ ...item }));
  const canContinue = await confirmIfCartExceedsVisibleStock(snapshot);
  if (!canContinue) {
    logFeatureWarn("APARCAR", "cancelado-stock", { requestId });
    return;
  }
  const total = getCartTotal(snapshot);
  const discountSummary = buildParkedDiscountSummarySnapshot(snapshot);

  const clientName = cartClientInput
    ? cartClientInput.value || "Cliente"
    : "Cliente";
  const selectedCustomerCod = String(
    window.CUSTOMER_SELECTOR?.getSelectedCustomerCodcliente?.() ||
      currentTerminal?.codcliente ||
      "1",
  ).trim();

  const ticketName = String(name || "").trim();
  const observation = String(obs || "").trim();
  let nextDisplayNo = getNextParkedDisplayNumber();

  // ✅ ACTUALIZAR ticket ya cargado
  if (
    currentParkedTicketIndex !== null &&
    Array.isArray(parkedTickets) &&
    parkedTickets[currentParkedTicketIndex] &&
    !parkedTickets[currentParkedTicketIndex].paid
  ) {
    const existing = parkedTickets[currentParkedTicketIndex];
    const prevItems = Array.isArray(existing?.items)
      ? existing.items.map((it) => ({ ...it }))
      : [];
    const reservedDelta = buildReservedQtyDeltaMap(snapshot, prevItems);

    existing.items = snapshot;
    existing.total = total;
    existing.discountSummary = discountSummary;
    existing._simulated =
      isSafeTrainingModeEnabled() || isSimulatedParkedTicket(existing);
    existing.clientName = clientName;
    existing.codcliente = selectedCustomerCod;
    if (!Number(existing.displayNo || 0)) {
      const withoutCurrent = (
        Array.isArray(parkedTickets) ? parkedTickets : []
      ).filter((t) => t !== existing);
      nextDisplayNo = ensureUniqueNextParkedDisplayNumber(
        getNextParkedDisplayNumber(withoutCurrent),
        withoutCurrent,
      );
      existing.displayNo = nextDisplayNo;
    }
    existing.name = getCanonicalParkedTicketName(existing, ticketName);
    existing.obs = observation;
    existing.updatedAt = new Date();
    saveParkedTicketsCache();

    try {
      await apiSaveParkedReservation(existing);
      await refreshRemoteParkedReservationsOnly();
      scheduleParkedReservationsBurstRefresh("update-parked");
    } catch (e) {
      enqueueParkedSyncOperation("upsert", existing);
      scheduleParkedReservationsBurstRefresh("queue-update-parked");
      console.warn(
        "No se pudo guardar la reserva remota al actualizar:",
        e?.message || e,
      );

      if (isParkedSyncTransientError(e)) {
        toast(
          "Sin internet: actualización de aparcado guardada en cola.",
          "warn",
          "Aparcados",
        );
      }
    }

    if (reservedDelta.size > 0) {
      try {
        await syncReservedStockDeltaToFS(reservedDelta, "actualizar aparcado");
      } catch (e) {
        console.warn(
          "No se pudo sincronizar stock al actualizar aparcado:",
          e?.message || e,
        );
        toast(
          "Aparcado actualizado, pero no se pudo sincronizar stock en FacturaScripts.",
          "warn",
          "Stock",
        );
      }
    }

    // opcional: si quieres actualizar presupuesto remoto más adelante, aquí irá

    // ✅ limpiar carrito y salir del modo edición
    cart = [];
    renderCart();

    currentParkedTicketIndex = null;
    refreshParkButtonUI();
    refreshParkedEditingBanner();
    updateParkedCountBadge();
    await resetCartCustomerToTerminalDefault("park-update");

    toast("Ticket aparcado actualizado ✅", "ok", "Aparcados");
    setStatusText("Ticket aparcado actualizado.");
    logFeatureInfo("APARCAR", "actualizado", {
      requestId,
      id: existing?.id || null,
      total: Number(total || 0),
      lineas: snapshot.length,
    });
    return;
  }

  // ✅ CREAR ticket nuevo
  try {
    // Refresco previo para reducir al minimo colisiones de numeracion entre TPVs.
    await refreshRemoteParkedReservationsOnly();
  } catch {}

  nextDisplayNo = ensureUniqueNextParkedDisplayNumber(
    getNextParkedDisplayNumber(),
  );

  const nextParkedId = nextParkedTicketId();

  const localTicket = {
    id: nextParkedId,
    displayNo: nextDisplayNo,
    createdAt: new Date(),
    updatedAt: null,
    items: snapshot,
    total,
    discountSummary,
    clientName,
    codcliente: selectedCustomerCod,
    name: getCanonicalParkedTicketName(
      { id: nextParkedId, displayNo: nextDisplayNo, name: ticketName },
      ticketName || `Ticket #${nextDisplayNo}`,
    ),
    obs: observation,
    paid: false,
    paidAt: null,
    paidTicketCode: null,
    paidTicketId: null,
    fs: null,
    _simulated: isSafeTrainingModeEnabled(),
  };

  try {
    const remote = await apiCreatePresupuestoFromCart(observation);
    if (remote && (remote.doc || remote.data)) {
      const doc = remote.doc || remote.data;
      localTicket.fs = {
        idpresupuesto: doc.idpresupuesto ?? doc.id ?? null,
        codigo: doc.codigo ?? null,
      };
    }
  } catch (e) {
    // Si FS falla, mantenemos el aparcado local/remoto de reservas para no perder operativa.
    console.warn(
      "No se pudo crear presupuesto en FS al aparcar:",
      e?.message || e,
    );
  }

  parkedTickets.push(localTicket);
  saveParkedTicketsCache();

  const reservedDelta = buildReservedQtyDeltaMap(snapshot, []);

  try {
    await apiSaveParkedReservation(localTicket);
    await refreshRemoteParkedReservationsOnly();
    scheduleParkedReservationsBurstRefresh("create-parked");
  } catch (e) {
    enqueueParkedSyncOperation("upsert", localTicket);
    scheduleParkedReservationsBurstRefresh("queue-create-parked");
    console.warn(
      "No se pudo guardar la reserva remota al aparcar:",
      e?.message || e,
    );

    if (isParkedSyncTransientError(e)) {
      toast(
        "Sin internet: ticket aparcado guardado en cola.",
        "warn",
        "Aparcados",
      );
    }
  }

  if (reservedDelta.size > 0) {
    try {
      await syncReservedStockDeltaToFS(reservedDelta, "crear aparcado");
    } catch (e) {
      console.warn(
        "No se pudo sincronizar stock al crear aparcado:",
        e?.message || e,
      );
      toast(
        "Ticket aparcado, pero no se pudo sincronizar stock en FacturaScripts.",
        "warn",
        "Stock",
      );
    }
  }

  // ✅ limpiar carrito
  cart = [];
  renderCart();

  currentParkedTicketIndex = null;
  refreshParkButtonUI();
  refreshParkedEditingBanner();
  updateParkedCountBadge();
  await resetCartCustomerToTerminalDefault("park-create");

  toast("Ticket aparcado ✅", "ok", "Aparcados");
  setStatusText("Ticket aparcado.");
  logFeatureInfo("APARCAR", "creado", {
    requestId,
    id: localTicket?.id || null,
    total: Number(total || 0),
    lineas: snapshot.length,
  });
}

function apiDeletePresupuesto(idpresupuesto) {
  if (!idpresupuesto || TPV_STATE.offline || TPV_STATE.locked) return;

  // usamos apiWrite con DELETE
  apiWrite(`presupuestoclientes/${idpresupuesto}`, "DELETE", {}).catch((e) => {
    console.warn("No se pudo borrar presupuesto en FS:", e);
  });
}

// ===== [08] UI venta: modal de tickets aparcados =====
const parkedTicketsOverlay = document.getElementById("parkedTicketsOverlay");
const parkedTicketsList = document.getElementById("parkedTicketsList");
const parkedCloseBtn = document.getElementById("parkedCloseBtn");

function parkedNormalizeText(value) {
  return String(value || "").trim();
}

function parkedIsPlaceholderText(value) {
  const txt = parkedNormalizeText(value).toLowerCase();
  if (!txt) return true;

  if (
    txt === "-" ||
    txt === "--" ||
    txt === "---" ||
    txt === "_" ||
    txt === "n/a" ||
    txt === "na" ||
    txt === "s/d" ||
    txt === "sin descripcion" ||
    txt === "sin descripción"
  ) {
    return true;
  }

  return /^[.\-_/\\|·\s]+$/.test(txt);
}

function parkedGetItemQty(it) {
  return Number(it?.qty ?? it?.cantidad ?? 1) || 1;
}

function parkedGetItemPrimaryName(it) {
  const direct =
    it?.name ?? it?.nombre ?? it?.productName ?? it?.referencia ?? "";
  const directText = parkedNormalizeText(direct);
  if (directText && !parkedIsPlaceholderText(directText)) return directText;

  const fallbackId = Number(it?.idproducto ?? it?.id ?? 0) || 0;
  return fallbackId ? String(fallbackId) : "";
}

function parkedGetItemDescription(it) {
  const desc = parkedNormalizeText(
    it?.descripcion ??
      it?.description ??
      it?.productDescription ??
      it?.descripcion2 ??
      it?.secondaryName ??
      "",
  );

  if (parkedIsPlaceholderText(desc)) return "";
  return desc;
}

function parkedBuildItemDisplayName(it) {
  const primary = parkedGetItemPrimaryName(it);
  const desc = parkedGetItemDescription(it);

  if (primary && desc && primary.toLowerCase() !== desc.toLowerCase()) {
    return `${primary} · ${desc}`;
  }

  return primary || desc || "Producto";
}

function parkedBuildGroupedPreview(items) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return "";

  const byParent = new Map();
  arr.forEach((line) => {
    const parentId = String(line?.meta?.parentPackLineId || "").trim();
    if (!parentId) return;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(line);
  });

  const chunks = [];

  arr.forEach((line) => {
    if (line?.meta?.includedInPack) return;

    const qty = parkedGetItemQty(line);
    const name = parkedBuildItemDisplayName(line);

    if (line?.meta?.isPackOffer) {
      const children = byParent.get(String(line?._lineId || "").trim()) || [];
      let includesTxt = children
        .map(
          (ch) =>
            `${fmtQty(parkedGetItemQty(ch))}x ${parkedBuildItemDisplayName(ch)}`,
        )
        .join(" · ");

      if (!includesTxt) {
        const selection = Array.isArray(line?.meta?.packSelection)
          ? line.meta.packSelection
          : [];

        includesTxt = selection
          .map((sel) => {
            const ref = String(sel?.reference || "").trim();
            const sq = parseQtyValue(sel?.qty, 0);
            if (!ref || sq <= 0) return "";
            const q = roundQty3(sq * qty);
            return `${ref} x${fmtQty(q)}`;
          })
          .filter(Boolean)
          .join(" · ");
      }

      const packTxt = includesTxt
        ? `${fmtQty(qty)}x ${name} · Incluye: ${includesTxt}`
        : `${fmtQty(qty)}x ${name}`;

      chunks.push(packTxt);
      return;
    }

    chunks.push(`${fmtQty(qty)}x ${name}`);
  });

  return chunks.join(" | ");
}

function parkedGetDiscountSummary(items) {
  const ticketLike =
    items && !Array.isArray(items) && typeof items === "object" ? items : null;
  const frozen = ticketLike?.discountSummary;
  if (frozen && typeof frozen === "object") {
    const base = round2(Number(frozen.baseTotal || 0));
    const final = round2(Number(frozen.finalTotal || 0));
    const savings = round2(Math.max(0, Number(frozen.savings || base - final)));
    const hasDiscount = savings > 0.009 && base > final + 0.0001;
    return {
      hasDiscount,
      baseTotal: base,
      finalTotal: final,
      savings,
      labelsText: hasDiscount ? String(frozen.labelsText || "").trim() : "",
    };
  }

  const sourceItems = ticketLike ? ticketLike.items : items;
  const visibleSource = getVisibleCartLines(
    Array.isArray(sourceItems) ? sourceItems : [],
  );
  if (!visibleSource.length) {
    return {
      hasDiscount: false,
      baseTotal: 0,
      finalTotal: 0,
      savings: 0,
      labelsText: "",
    };
  }

  let baseTotal = 0;
  let finalTotal = 0;
  const labels = new Set();

  visibleSource.forEach((item) => {
    const pricing = getCartLinePricing(item);
    const baseLine = Number(pricing?.baseLineTotal || 0);
    const finalLine = Number(pricing?.lineTotal || 0);

    baseTotal += baseLine;
    finalTotal += finalLine;

    if (baseLine <= finalLine + 0.0001) return;

    if (pricing?.manualPriceLocked) {
      labels.add("Manual");
      return;
    }

    if (pricing?.cartDiscountApplied) {
      labels.add(
        pricing?.cartDiscountSource === "line" ? "Dto linea" : "Dto general",
      );
    }

    if (pricing?.tariffApplied) {
      labels.add("Tarifa");
    }

    if (!pricing?.cartDiscountApplied && !pricing?.tariffApplied) {
      labels.add("Descuento");
    }
  });

  const base = round2(baseTotal);
  const final = round2(finalTotal);
  const savings = round2(Math.max(0, base - final));

  return {
    hasDiscount: savings > 0.009 && base > final + 0.0001,
    baseTotal: base,
    finalTotal: final,
    savings,
    labelsText: Array.from(labels).join(" · "),
  };
}

function buildParkedDiscountSummarySnapshot(items) {
  const summary = parkedGetDiscountSummary(Array.isArray(items) ? items : []);
  return {
    hasDiscount: !!summary.hasDiscount,
    baseTotal: round2(Number(summary.baseTotal || 0)),
    finalTotal: round2(Number(summary.finalTotal || 0)),
    savings: round2(Number(summary.savings || 0)),
    labelsText: String(summary.labelsText || "").trim(),
  };
}

function buildParkedSummaryStats(sourceTickets) {
  const list = Array.isArray(sourceTickets) ? sourceTickets : [];
  const pendingList = list.filter((t) => !t?.paid);

  let linesTotal = 0;
  let unitsTotal = 0;
  let amountPending = 0;
  let amountAll = 0;
  const productsMap = new Map();

  list.forEach((t) => {
    const totalTicket = Number(t?.total || 0) || 0;
    amountAll += totalTicket;
  });

  pendingList.forEach((t) => {
    const totalTicket = Number(t?.total || 0) || 0;
    amountPending += totalTicket;

    const items = Array.isArray(t?.items) ? t.items : [];
    linesTotal += items.length;

    items.forEach((it) => {
      const qty = parkedGetItemQty(it);
      unitsTotal += qty;

      const productName = parkedBuildItemDisplayName(it);
      const productKey = productName.toLowerCase();
      if (!productKey) return;

      const prev = productsMap.get(productKey) || { name: productName, qty: 0 };
      prev.qty += qty;
      productsMap.set(productKey, prev);
    });
  });

  const paidCount = list.filter((t) => !!t?.paid).length;
  const pendingCount = Math.max(0, list.length - paidCount);
  const products = Array.from(productsMap.values()).sort((a, b) => {
    const byQty = Number(b.qty || 0) - Number(a.qty || 0);
    if (byQty !== 0) return byQty;
    return String(a.name || "").localeCompare(String(b.name || ""), "es");
  });

  return {
    ticketsTotal: list.length,
    pendingCount,
    paidCount,
    linesTotal,
    unitsTotal,
    productsDistinct: products.length,
    products,
    amountPending,
    amountAll,
  };
}

function buildParkedSummaryHtml(stats) {
  const fmtQty = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "0";
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  };

  const row = (label, value) =>
    `<div class="parked-summary-row"><span>${escapeHtmlForModal(label)}</span><strong>${escapeHtmlForModal(String(value))}</strong></div>`;

  const productsHtml = (Array.isArray(stats.products) ? stats.products : [])
    .map(
      (p) => `
      <div class="parked-summary-product-row">
        <span class="parked-summary-product-name">${escapeHtmlForModal(p?.name || "Producto")}</span>
        <strong class="parked-summary-product-qty">x ${escapeHtmlForModal(fmtQty(p?.qty))}</strong>
      </div>
    `,
    )
    .join("");

  return `
    <div class="parked-summary-wrap">
      ${row("Tickets sin cobrar", stats.pendingCount)}
      ${row("Importe total aparcado", formatParkedAuditAmount(stats.amountPending))}
      ${row("Productos distintos", stats.productsDistinct)}
      ${row("Líneas de producto", stats.linesTotal)}
      ${row("Unidades totales", Number(stats.unitsTotal).toFixed(2))}

      <div class="parked-summary-products">
        <div class="parked-summary-products-title">Productos aparcados</div>
        <div class="parked-summary-products-list">
          ${
            productsHtml ||
            '<div class="parked-summary-empty">No hay productos aparcados en esta vista.</div>'
          }
        </div>
      </div>
    </div>
  `;
}

function parkedTicketMatchesSearch(t, term) {
  const q = String(term || "")
    .trim()
    .toLowerCase();
  if (!q) return true;

  const itemsText = Array.isArray(t.items)
    ? t.items.map((it) => parkedBuildItemDisplayName(it)).join(" ")
    : "";

  const fecha = t.createdAt ? new Date(t.createdAt) : null;
  const hora = fecha
    ? fecha.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const haystack = [
    t.id || "",
    `ticket #${t.id || ""}`,
    getParkedTicketDisplayNumber(t) || "",
    `ticket #${getParkedTicketDisplayNumber(t) || ""}`,
    getParkedDisplayNumberFromId(t?.id || t?.ticketId || 0) || "",
    `ticket #${getParkedDisplayNumberFromId(t?.id || t?.ticketId || 0) || ""}`,
    t.name || "",
    t.clientName || "",
    t.obs || "",
    t.total || "",
    hora,
    itemsText,
    t.paidTicketCode || "",
    t.paidTicketId || "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function isParkedTicketFromToday(ticket) {
  const created = ticket?.createdAt ? new Date(ticket.createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return false;

  const now = new Date();
  return (
    created.getFullYear() === now.getFullYear() &&
    created.getMonth() === now.getMonth() &&
    created.getDate() === now.getDate()
  );
}

function hasOlderPendingParkedTickets(sourceTickets) {
  const list = Array.isArray(sourceTickets) ? sourceTickets : [];
  return list.some((t) => !t?.paid && !isParkedTicketFromToday(t));
}

function parkedTicketPassesFilter(t) {
  if (parkedViewState.filter === "all") return true;
  if (parkedViewState.filter === "paid") return !!t.paid;

  if (!!t?.paid) return false;

  if (parkedViewState.pendingScope === "older") {
    return !isParkedTicketFromToday(t);
  }

  return isParkedTicketFromToday(t);
}

function getParkedTicketSortTimeMs(t) {
  const createdMs = t?.createdAt ? new Date(t.createdAt).getTime() : 0;
  if (Number.isFinite(createdMs) && createdMs > 0) return createdMs;

  const updatedMs = t?.updatedAt ? new Date(t.updatedAt).getTime() : 0;
  if (Number.isFinite(updatedMs) && updatedMs > 0) return updatedMs;

  return 0;
}

function compareParkedTicketsForList(a, b) {
  const aPaid = !!a?.paid;
  const bPaid = !!b?.paid;
  if (aPaid !== bPaid) return aPaid ? 1 : -1;

  const aTime = getParkedTicketSortTimeMs(a);
  const bTime = getParkedTicketSortTimeMs(b);
  if (aTime !== bTime) return bTime - aTime;

  const aNo = Number(getParkedTicketDisplayNumber(a) || 0) || 0;
  const bNo = Number(getParkedTicketDisplayNumber(b) || 0) || 0;
  if (aNo !== bNo) return bNo - aNo;

  const aName = String(a?.clientName || a?.name || "");
  const bName = String(b?.clientName || b?.name || "");
  return aName.localeCompare(bName, "es", { sensitivity: "base" });
}

function syncParkedSearchClearBtn() {
  const btn = document.getElementById("parkedSearchClearBtn");
  const input = document.getElementById("parkedSearch");

  if (!btn || !input) return;

  const hasValue = String(input.value || "").trim().length > 0;
  btn.classList.toggle("hidden", !hasValue);
}

function syncParkedToolbarUI() {
  const parkedSearch = document.getElementById("parkedSearch");
  const parkedFilterAll = document.getElementById("parkedFilterAll");
  const parkedFilterPending = document.getElementById("parkedFilterPending");
  const parkedFilterPaid = document.getElementById("parkedFilterPaid");
  const parkedClearPaidBtn = document.getElementById("parkedClearPaidBtn");
  const parkedPendingScopeWrap = document.getElementById(
    "parkedPendingScopeWrap",
  );
  const parkedPendingScopeToday = document.getElementById(
    "parkedPendingScopeToday",
  );
  const parkedPendingScopeOlder = document.getElementById(
    "parkedPendingScopeOlder",
  );

  const source = getScopedAllParkedTickets(parkedTickets);
  const allCount = source.length;
  const paidList = source.filter((t) => !!t?.paid);
  const paidCount = paidList.length;
  const pendingList = source.filter((t) => !t?.paid);
  const pendingCount = pendingList.length;
  const pendingTodayCount = pendingList.filter((t) =>
    isParkedTicketFromToday(t),
  ).length;
  const pendingOlderCount = Math.max(0, pendingCount - pendingTodayCount);
  const hasOlderPending = hasOlderPendingParkedTickets(source);

  if (!hasOlderPending) {
    parkedViewState.pendingScope = "today";
  }

  if (parkedSearch) {
    parkedSearch.value = parkedViewState.search || "";
  }

  parkedFilterAll?.classList.toggle(
    "is-active",
    parkedViewState.filter === "all",
  );
  parkedFilterPending?.classList.toggle(
    "is-active",
    parkedViewState.filter === "pending",
  );
  parkedFilterPaid?.classList.toggle(
    "is-active",
    parkedViewState.filter === "paid",
  );

  if (parkedFilterAll) {
    parkedFilterAll.textContent = `Todos (${allCount})`;
  }

  if (parkedFilterPending) {
    parkedFilterPending.textContent = `Sin cobrar (${pendingCount})`;
  }

  if (parkedFilterPaid) {
    parkedFilterPaid.textContent = `Cobrados (${paidCount})`;
  }

  if (parkedClearPaidBtn) {
    parkedClearPaidBtn.classList.toggle(
      "hidden",
      parkedViewState.filter !== "paid",
    );
  }

  const shouldShowPendingScope =
    parkedViewState.filter === "pending" && hasOlderPending;

  parkedPendingScopeWrap?.classList.toggle("hidden", !shouldShowPendingScope);

  parkedPendingScopeToday?.classList.toggle(
    "is-active",
    parkedViewState.pendingScope !== "older",
  );

  parkedPendingScopeOlder?.classList.toggle(
    "is-active",
    parkedViewState.pendingScope === "older",
  );

  if (parkedPendingScopeToday) {
    parkedPendingScopeToday.textContent = `Hoy (${pendingTodayCount})`;
  }

  if (parkedPendingScopeOlder) {
    parkedPendingScopeOlder.textContent = `Dias anteriores (${pendingOlderCount})`;
  }

  syncParkedSearchClearBtn();
}

async function clearPaidParkedHistory() {
  const source = Array.isArray(parkedTickets) ? parkedTickets : [];
  const removedPaid = source.filter((t) => !!t?.paid);

  if (!removedPaid.length) return;

  parkedTickets = source.filter((t) => !t?.paid);
  saveParkedTicketsCache(parkedTickets);
  saveParkedPaidHistory([]);

  if (
    currentParkedTicketIndex != null &&
    (!parkedTickets[currentParkedTicketIndex] ||
      parkedTickets[currentParkedTicketIndex]?.paid)
  ) {
    currentParkedTicketIndex = null;
  }

  updateParkedCountBadge?.();
  refreshParkButtonUI?.();
  refreshParkedEditingBanner?.();
  renderParkedTicketsModal?.();
}

function ensureParkedToolbar() {
  if (!parkedTicketsOverlay) return null;

  let toolbar = document.getElementById("parkedToolbar");
  if (toolbar) {
    syncParkedToolbarUI();
    return toolbar;
  }

  const body = parkedTicketsOverlay.querySelector(".parked-modal-body");
  if (!body || !parkedTicketsList) return null;

  toolbar = document.createElement("div");
  toolbar.id = "parkedToolbar";
  toolbar.className = "tickets-tools";
  toolbar.innerHTML = `
    <div class="tickets-search-wrap">
      <input
        id="parkedSearch"
        type="text"
        placeholder="Buscar ticket aparcado..."
        autocomplete="off"
      />
      <button
      id="parkedKeyboardBtn"
      type="button"
      class="cart-btn"
      title="Teclado"
    >
      ⌨
    </button>
      <button
        id="parkedSearchClearBtn"
        type="button"
        class="tickets-search-clear hidden"
        title="Limpiar búsqueda"
      >
        ✕
      </button>
    </div>

    <div class="tickets-tabs" style="margin-left: 10px;">
      <button id="parkedFilterAll" type="button" class="cart-btn tickets-tab-btn">
        Todos
      </button>
      <button id="parkedFilterPending" type="button" class="cart-btn tickets-tab-btn">
        Sin cobrar
      </button>
      <button id="parkedFilterPaid" type="button" class="cart-btn tickets-tab-btn">
        Cobrados
      </button>
    </div>

    <div id="parkedPendingScopeWrap" class="tickets-tabs hidden" style="margin-left: 10px;">
      <button id="parkedPendingScopeToday" type="button" class="cart-btn tickets-tab-btn">
        Hoy
      </button>
      <button id="parkedPendingScopeOlder" type="button" class="cart-btn tickets-tab-btn">
        Dias anteriores
      </button>
    </div>

    <div class="tickets-tabs" style="margin-left: 10px; display:flex; align-items:center; gap:8px;">
      <button id="parkedSummaryBtn" type="button" class="cart-btn tickets-tab-btn" title="Resumen de aparcados">
        Resumen
      </button>
      <button id="parkedClearPaidBtn" type="button" class="cart-btn tickets-tab-btn" title="Limpiar historial de cobrados">
        Limpiar cobrados
      </button>
    </div>
  `;

  body.insertBefore(toolbar, parkedTicketsList);

  const parkedSearch = document.getElementById("parkedSearch");
  const parkedSearchClearBtn = document.getElementById("parkedSearchClearBtn");
  const parkedFilterAll = document.getElementById("parkedFilterAll");
  const parkedFilterPending = document.getElementById("parkedFilterPending");
  const parkedFilterPaid = document.getElementById("parkedFilterPaid");
  const parkedPendingScopeToday = document.getElementById(
    "parkedPendingScopeToday",
  );
  const parkedPendingScopeOlder = document.getElementById(
    "parkedPendingScopeOlder",
  );
  const parkedKeyboardBtn = document.getElementById("parkedKeyboardBtn");
  const parkedSummaryBtn = document.getElementById("parkedSummaryBtn");
  const parkedClearPaidBtn = document.getElementById("parkedClearPaidBtn");

  let timer = null;

  parkedSearch?.addEventListener("input", () => {
    parkedViewState.search = parkedSearch.value || "";
    syncParkedSearchClearBtn();

    clearTimeout(timer);
    timer = setTimeout(() => {
      renderParkedTicketsModal();
    }, 200);
  });

  parkedSearchClearBtn?.addEventListener("click", () => {
    parkedViewState.search = "";
    if (parkedSearch) parkedSearch.value = "";
    syncParkedToolbarUI();
    renderParkedTicketsModal();
    parkedSearch?.focus();
  });

  parkedFilterAll?.addEventListener("click", () => {
    parkedViewState.filter = "all";
    syncParkedToolbarUI();
    renderParkedTicketsModal();
  });

  parkedFilterPending?.addEventListener("click", () => {
    parkedViewState.filter = "pending";
    parkedViewState.pendingScope = "today";
    syncParkedToolbarUI();
    renderParkedTicketsModal();
  });

  parkedFilterPaid?.addEventListener("click", () => {
    parkedViewState.filter = "paid";
    syncParkedToolbarUI();
    renderParkedTicketsModal();
  });

  parkedPendingScopeToday?.addEventListener("click", () => {
    parkedViewState.pendingScope = "today";
    syncParkedToolbarUI();
    renderParkedTicketsModal();
  });

  parkedPendingScopeOlder?.addEventListener("click", () => {
    parkedViewState.pendingScope = "older";
    syncParkedToolbarUI();
    renderParkedTicketsModal();
  });

  parkedKeyboardBtn?.addEventListener("click", () => {
    if (!parkedSearch) return;
    openQwertyForInput(parkedSearch, "text");
  });

  parkedSummaryBtn?.addEventListener("click", async () => {
    const scoped = getScopedAllParkedTickets(parkedTickets);
    const stats = buildParkedSummaryStats(scoped);
    const html = buildParkedSummaryHtml(stats);

    await confirmModal("Resumen de aparcados", html, {
      isHtml: true,
      textClassName: "parked-summary-text",
      dialogClassName: "parked-summary-dialog",
    });
  });

  parkedClearPaidBtn?.addEventListener("click", async () => {
    const hasPaid = (Array.isArray(parkedTickets) ? parkedTickets : []).some(
      (t) => !!t?.paid,
    );

    if (!hasPaid) {
      toast("No hay tickets cobrados que limpiar.", "info", "Aparcados");
      return;
    }

    const ok = await confirmModal(
      "Limpiar cobrados",
      "Se eliminará el historial local de tickets aparcados cobrados. ¿Continuar?",
    );
    if (!ok) return;

    await clearPaidParkedHistory();
    toast("Historial de cobrados limpiado.", "ok", "Aparcados");
  });

  syncParkedToolbarUI();
  return toolbar;
}

function refreshParkButtonUI() {
  if (!parkBtn) return;

  const hasLoadedParkedTicket =
    currentParkedTicketIndex !== null &&
    Array.isArray(parkedTickets) &&
    parkedTickets[currentParkedTicketIndex] &&
    !parkedTickets[currentParkedTicketIndex].paid;

  const hasCartLines = hasVisibleCartLines();
  parkBtn.disabled = !hasCartLines;

  parkBtn.textContent = hasLoadedParkedTicket ? "Actualizar" : "Aparcar";
  if (!hasCartLines) {
    parkBtn.title = "Añade productos al carrito para aparcar";
  } else {
    parkBtn.title = hasLoadedParkedTicket
      ? "Actualizar ticket aparcado"
      : "Aparcar ticket";
  }
}

function refreshParkedEditingBanner() {
  const wrap = document.getElementById("parkedEditingBanner");
  const title = document.getElementById("parkedEditingTitle");
  const obs = document.getElementById("parkedEditingObs");

  if (!wrap || !title || !obs) return;

  if (!cashSession?.open) {
    wrap.classList.add("hidden");
    title.textContent = "";
    obs.textContent = "";
    return;
  }

  const t =
    currentParkedTicketIndex !== null &&
    Array.isArray(parkedTickets) &&
    parkedTickets[currentParkedTicketIndex]
      ? parkedTickets[currentParkedTicketIndex]
      : null;

  if (!t || t.paid) {
    wrap.classList.add("hidden");
    title.textContent = "";
    obs.textContent = "";
    return;
  }

  title.textContent = `Ticket Aparcado: ${getParkedTicketDisplayLabel(t)}`;
  obs.textContent = t.obs ? `Observación: ${t.obs}` : "Sin observaciones";

  wrap.classList.remove("hidden");
}

async function openParkedModal() {
  const requestId = createRequestId("PRKMOD");

  if (!parkedTicketsOverlay) return;

  startParkedReservationsAutoRefresh?.();

  try {
    await refreshRemoteParkedReservationsOnly();
  } catch (e) {
    console.warn(
      "No se pudo refrescar aparcados al abrir modal:",
      e?.message || e,
    );
  }

  reconcileParkedPaidTwins(parkedTickets);

  const allParked = getScopedAllParkedTickets(parkedTickets);
  const pending = getScopedPendingParkedTickets(parkedTickets);
  const paid = allParked.filter((t) => !!t?.paid);

  if (!allParked.length) {
    toast("No hay tickets aparcados.", "info", "Aparcados");
    return;
  }

  ensureParkedToolbar();
  renderParkedTicketsModal();
  parkedTicketsOverlay.classList.remove("hidden");

  logFeatureInfo("APARCADOS", "modal-abierto", {
    requestId,
    total: allParked.length,
    pendientes: pending.length,
    cobrados: paid.length,
  });
}

function closeParkedModal() {
  if (!parkedTicketsOverlay) return;
  parkedTicketsOverlay.classList.add("hidden");
}

function renderParkedTicketsModal() {
  if (!parkedTicketsList) return;

  ensureParkedToolbar();
  parkedTicketsList.innerHTML = "";

  const term = String(parkedViewState.search || "")
    .trim()
    .toLowerCase();

  const source = getScopedAllParkedTickets(parkedTickets);

  const filtered = source.filter((t) => {
    return parkedTicketPassesFilter(t) && parkedTicketMatchesSearch(t, term);
  });

  filtered.sort(compareParkedTicketsForList);

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "parked-ticket-empty";
    if (parkedViewState.filter === "pending") {
      empty.textContent =
        parkedViewState.pendingScope === "older"
          ? "No hay tickets sin cobrar de dias anteriores en esta vista."
          : "No hay tickets sin cobrar de hoy en esta vista.";
    } else {
      empty.textContent = "No hay tickets aparcados en esta vista.";
    }
    parkedTicketsList.appendChild(empty);
    return;
  }

  filtered.forEach((t) => {
    const realIndex = parkedTickets.indexOf(t);

    const div = document.createElement("div");
    div.className = "parked-ticket-item parked-ticket-compact";
    div.dataset.index = realIndex;

    const createdDate = t?.createdAt ? new Date(t.createdAt) : null;
    const updatedDate = t?.updatedAt ? new Date(t.updatedAt) : null;
    const fechaValida =
      createdDate && !Number.isNaN(createdDate.getTime())
        ? createdDate
        : updatedDate && !Number.isNaN(updatedDate.getTime())
          ? updatedDate
          : null;

    const fechaHoraLabel = fechaValida
      ? `${fechaValida.toLocaleDateString("es-ES")} ${fechaValida.toLocaleTimeString(
          "es-ES",
          {
            hour: "2-digit",
            minute: "2-digit",
          },
        )}`
      : "Sin fecha";

    const items = Array.isArray(t.items) ? t.items : [];
    const preview = parkedBuildGroupedPreview(items);
    const discountSummary = parkedGetDiscountSummary(t);
    const finalTotalValue =
      t.total != null
        ? round2(Number(t.total || 0))
        : round2(Number(discountSummary.finalTotal || 0));
    const baseTotalValue = round2(Number(discountSummary.baseTotal || 0));
    const savingsValue = round2(Math.max(0, baseTotalValue - finalTotalValue));
    const hasDiscountView =
      savingsValue > 0.009 && baseTotalValue > finalTotalValue + 0.0001;
    const obs = (t.obs || "").trim();

    const paidBadge = t.paid
      ? `<span class="ticket-badge ticket-badge-ok">✔ COBRADO</span>`
      : `<span class="ticket-badge ticket-badge-partial">PENDIENTE</span>`;
    const simBadge = isSimulatedParkedTicket(t)
      ? `<span class="ticket-badge ticket-badge-sim">SIM</span>`
      : "";

    const discountBadge = hasDiscountView
      ? `<span class="ticket-badge ticket-badge-discount">DTO</span>`
      : "";

    const totalFinalText = `${finalTotalValue.toFixed(2)} €`;

    const totalOldText = hasDiscountView
      ? `${baseTotalValue.toFixed(2)} €`
      : "";

    const discountNote = hasDiscountView
      ? `Ahorro ${savingsValue.toFixed(2)} €${discountSummary.labelsText ? ` · ${discountSummary.labelsText}` : ""}`
      : "";

    const paidSub = t.paid
      ? `<div class="pt-items pt-items-paid">Cobrado${
          t.paidTicketCode ? ` · ${escapeHtml(t.paidTicketCode)}` : ""
        }</div>`
      : "";

    if (t.paid) {
      div.classList.add("parked-ticket-paid");
    }

    div.innerHTML = `
      <div class="pt-left">
        <div class="pt-title">
          ${paidBadge}
          ${simBadge}
          ${discountBadge}
          ${escapeHtml(getParkedTicketDisplayLabel(t))}
        </div>

        ${
          obs
            ? `<div class="pt-obs">${escapeHtml(obs)}</div>`
            : `<div class="pt-obs pt-obs-muted">Sin observación</div>`
        }

        <div class="pt-sub">
          ${fechaHoraLabel} · ${escapeHtml(t.clientName || "Cliente")} · ${isSimulatedParkedTicket(t) ? "SIM" : "Ticket"} #${getParkedTicketDisplayNumber(t) || "0"}
        </div>
      </div>

      <div class="pt-mid">
        <div class="pt-items">${escapeHtml(preview || "Sin productos")}</div>
        ${
          hasDiscountView
            ? `<div class="pt-discount-note">${escapeHtml(discountNote)}</div>`
            : ""
        }
        ${paidSub}
      </div>

      <div class="pt-right">
        <div class="pt-right-top">
          <div class="pt-total-wrap">
            ${
              hasDiscountView
                ? `<div class="pt-total-old">${totalOldText}</div>`
                : ""
            }
            <div class="pt-total">${totalFinalText}</div>
          </div>
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
          `¿Seguro que quieres eliminar el Ticket #${getParkedTicketDisplayNumber(t) || "0"}?`,
        );
        if (!ok) return;

        let deletedRemotelySynced = false;
        try {
          const deletedRemote = await apiDeleteParkedReservation(t);
          deletedRemotelySynced = !!deletedRemote;

          if (deletedRemotelySynced) {
            await refreshRemoteParkedReservationsOnly();
            scheduleParkedReservationsBurstRefresh("delete-parked");
          }
        } catch (e) {
          enqueueParkedSyncOperation("delete", t);
          scheduleParkedReservationsBurstRefresh("queue-delete-parked");
          console.warn("No se pudo borrar la reserva remota:", e?.message || e);

          if (isParkedSyncTransientError(e)) {
            toast(
              "Sin internet: borrado de aparcado guardado en cola.",
              "warn",
              "Aparcados",
            );
          }
        }

        try {
          const releaseDelta = buildReservedQtyDeltaMap([], t?.items || []);
          if (releaseDelta.size > 0) {
            await syncReservedStockDeltaToFS(releaseDelta, "eliminar aparcado");
          }
        } catch (e) {
          console.warn(
            "No se pudo sincronizar stock al eliminar aparcado:",
            e?.message || e,
          );
          toast(
            "Aparcado eliminado localmente, pero no se pudo sincronizar stock en FacturaScripts.",
            "warn",
            "Stock",
          );
        }

        if (!deletedRemotelySynced || isSafeTrainingModeEnabled()) {
          parkedTickets.splice(realIndex, 1);
          saveParkedTicketsCache();
        }

        try {
          const idcaja = getCajaIdSafe();
          if (idcaja) {
            await appendCajaAutoLogLineForId(
              idcaja,
              buildParkedManualDeleteLogLine(t),
            );
          }
        } catch (e) {
          console.warn(
            "No se pudo registrar el borrado del ticket aparcado en la caja:",
            e?.message || e,
          );
        }

        if (!deletedRemotelySynced || isSafeTrainingModeEnabled()) {
          if (currentParkedTicketIndex === realIndex) {
            currentParkedTicketIndex = null;
          } else if (
            currentParkedTicketIndex !== null &&
            currentParkedTicketIndex > realIndex
          ) {
            currentParkedTicketIndex -= 1;
          }
        }

        updateParkedCountBadge();
        refreshParkButtonUI();
        refreshParkedEditingBanner();

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
      if (t.paid) {
        toast(
          "Ese ticket ya está cobrado. No se puede volver a cargar.",
          "warn",
          "Aparcados",
        );
        return;
      }

      restoreParkedCartByIndex(realIndex);
      closeParkedModal();
    };

    parkedTicketsList.appendChild(div);
  });
}

function beginParkedCheckoutLock(index) {
  if (!Array.isArray(parkedTickets) || !parkedTickets.length) return null;
  if (index == null || index < 0 || index >= parkedTickets.length) return null;

  const ticket = parkedTickets[index];
  if (!ticket || ticket.paid || ticket.closingInProgress) return null;

  if (!String(ticket.slug || "").trim()) {
    ticket.slug = String(getCurrentSlugForReservations() || "").trim();
  }
  if (!String(ticket.cajaId || "").trim()) {
    ticket.cajaId = String(
      ticket?.cajaId || getCajaIdSafe?.() || currentTerminal?.id || "",
    ).trim();
  }

  ticket.closingInProgress = true;
  ticket.closingByTerminalId = String(currentTerminal?.id || "").trim();
  ticket.closingByTerminalName = String(currentTerminal?.name || "").trim();
  ticket.closingByAt = new Date().toISOString();

  updateParkedCountBadge?.();
  refreshParkButtonUI?.();
  refreshParkedEditingBanner?.();
  if (
    parkedTicketsOverlay &&
    !parkedTicketsOverlay.classList.contains("hidden")
  ) {
    renderParkedTicketsModal?.();
  }

  syncParkedTicketClosingState(ticket, "lock");

  return () => {
    if (!ticket || ticket.paid) return;
    ticket.closingInProgress = false;
    ticket.closingByTerminalId = "";
    ticket.closingByTerminalName = "";
    ticket.closingByAt = null;
    updateParkedCountBadge?.();
    refreshParkButtonUI?.();
    refreshParkedEditingBanner?.();
    if (
      parkedTicketsOverlay &&
      !parkedTicketsOverlay.classList.contains("hidden")
    ) {
      renderParkedTicketsModal?.();
    }

    syncParkedTicketClosingState(ticket, "unlock");
  };
}

function syncParkedTicketClosingState(ticket, reason = "") {
  if (!ticket || ticket.paid) return;
  if (TPV_STATE?.offline) {
    enqueueParkedSyncOperation("upsert", ticket);
    return;
  }

  Promise.resolve()
    .then(() => apiSaveParkedReservation(ticket))
    .then(() => scheduleParkedReservationsBurstRefresh(`closing-${reason}`))
    .catch((e) => {
      enqueueParkedSyncOperation("upsert", ticket);
      console.warn(
        "No se pudo sincronizar estado closingInProgress de aparcado:",
        e?.message || e,
      );
      scheduleParkedReservationsBurstRefresh(`queue-closing-${reason}`);
    });
}

function isParkedTicketLockedByAnotherTerminal(ticket) {
  if (!ticket || !ticket.closingInProgress) return false;

  const mine = String(currentTerminal?.id || "").trim();
  const owner = String(ticket?.closingByTerminalId || "").trim();
  if (!owner) return false;
  if (!mine) return true;
  return owner !== mine;
}

function findPaidTwinForParkedTicket(ticket, list = parkedTickets) {
  if (!ticket) return null;

  const source = Array.isArray(list) ? list : [];
  const ticketKey = String(getParkedTicketSyncKey(ticket) || "").trim();
  if (!ticketKey) return null;

  return (
    source.find((candidate) => {
      if (!candidate || !candidate?.paid) return false;

      const candidateKey = String(
        getParkedTicketSyncKey(candidate) || "",
      ).trim();
      return candidateKey === ticketKey;
    }) || null
  );
}

function reconcileParkedPaidTwins(list = parkedTickets) {
  const source = Array.isArray(list) ? list : [];
  if (!source.length) return 0;

  let changes = 0;

  source.forEach((ticket) => {
    if (!ticket || ticket?.paid) return;

    const paidTwin = findPaidTwinForParkedTicket(ticket, source);
    if (!paidTwin) return;

    ticket.paid = true;
    ticket.paidAt = paidTwin?.paidAt || ticket.paidAt || new Date();
    ticket.paidTicketCode =
      paidTwin?.paidTicketCode || ticket.paidTicketCode || null;
    ticket.paidTicketId = paidTwin?.paidTicketId || ticket.paidTicketId || null;
    upsertParkedPaidHistory(ticket);
    changes += 1;
  });

  if (changes > 0) {
    saveParkedTicketsCache(source);
  }

  return changes;
}

async function markParkedTicketAsPaidByIndex(index, paidInfo = {}) {
  if (!Array.isArray(parkedTickets) || !parkedTickets.length) return false;
  if (index == null || index < 0 || index >= parkedTickets.length) return false;

  const ticket = parkedTickets[index];
  if (!ticket) return false;
  if (ticket.paid) return true;

  const reservedItems = Array.isArray(ticket?.items) ? ticket.items : [];
  const reservedDelta = buildReservedQtyDeltaMap([], reservedItems);

  if (reservedDelta.size > 0) {
    try {
      await syncReservedStockDeltaToFS(reservedDelta, "cobrar aparcado");
    } catch (e) {
      console.warn(
        "No se pudo sincronizar stock al cobrar aparcado:",
        e?.message || e,
      );
      toast(
        "Ticket cobrado, pero no se pudo liberar stock reservado en FacturaScripts.",
        "warn",
        "Stock",
      );
    }
  }

  ticket.paid = true;
  ticket.closingInProgress = false;
  ticket.closingByTerminalId = "";
  ticket.closingByTerminalName = "";
  ticket.closingByAt = null;
  ticket.paidAt = new Date();
  ticket.paidTicketCode =
    paidInfo.codigo || paidInfo.numero || ticket.paidTicketCode || null;
  ticket.paidTicketId = paidInfo.idfactura || ticket.paidTicketId || null;
  rememberPaidTicketParkedOrigin(ticket, paidInfo);
  upsertParkedPaidHistory(ticket);
  saveParkedTicketsCache();

  const fsInfo = ticket.fs || {};
  const idpresupuesto = fsInfo.idpresupuesto || null;

  if (idpresupuesto) {
    try {
      const maybePromise = apiDeletePresupuesto(idpresupuesto);
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch(() => {});
      }
    } catch (e) {
      console.warn(
        "No se pudo borrar el presupuesto aparcado en FS:",
        e?.message || e,
      );
    }
  }

  try {
    await apiSaveParkedReservation(ticket);
    await ensureRemoteParkedPaidVisibility(ticket);
    await refreshRemoteParkedReservationsOnly();
    scheduleParkedReservationsBurstRefresh("pay-mark-parked");
  } catch (e) {
    enqueueParkedSyncOperation("upsert", ticket);
    scheduleParkedReservationsBurstRefresh("queue-pay-mark-parked");
    console.warn(
      "No se pudo marcar como cobrada la reserva remota:",
      e?.message || e,
    );

    if (isParkedSyncTransientError(e)) {
      toast(
        "Sin internet: cobro aplicado localmente y marcado en cola.",
        "warn",
        "Aparcados",
      );
    }
  }

  if (currentParkedTicketIndex === index) {
    currentParkedTicketIndex = null;
  }

  updateParkedCountBadge();
  refreshParkButtonUI();
  refreshParkedEditingBanner();

  return true;
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

function hydrateParkedItemForCart(item) {
  const src = item && typeof item === "object" ? item : {};
  const qty = parseQtyValue(src.qty ?? src.cantidad, 1);

  const toFiniteNumberOrNull = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const srcPrice = toFiniteNumberOrNull(src.price);
  const srcGross = toFiniteNumberOrNull(src.grossPrice);
  const srcTax = toFiniteNumberOrNull(src.taxRate);

  const baseId = getProductBaseId(src);
  const product = Array.isArray(products)
    ? products.find((p) => getProductBaseId(p) === baseId)
    : null;

  const built = product ? buildCartLine(product, qty) : null;

  return {
    ...(built || {}),
    ...src,
    qty,
    _lineId: makeLineId(),
    id:
      Number(src.id || src.idproducto || built?.id || baseId || 0) || undefined,
    baseProductId:
      Number(
        src.baseProductId ||
          src.idproducto ||
          built?.baseProductId ||
          baseId ||
          0,
      ) || undefined,
    name: String(src.name || src.descripcion || built?.name || "Producto"),
    secondaryName: String(
      src.secondaryName || src.descripcion2 || built?.secondaryName || "",
    ),
    imageUrl: src.imageUrl || built?.imageUrl || null,
    price: srcPrice != null ? srcPrice : Number(built?.price || 0),
    grossPrice:
      srcGross != null
        ? srcGross
        : Number(built?.grossPrice || built?.price || 0),
    taxRate: srcTax != null ? srcTax : Number(built?.taxRate || 0),
    codimpuesto: src.codimpuesto || built?.codimpuesto || null,
    __parkedPrevLineId: String(src._lineId || "").trim() || null,
  };
}

function captureCurrentCustomerSelectionForParked() {
  const selected = window.CUSTOMER_SELECTOR?.getSelectedCustomer?.() || null;
  const cod = String(
    selected?.codcliente ||
      window.CUSTOMER_SELECTOR?.getSelectedCustomerCodcliente?.() ||
      currentTerminal?.codcliente ||
      "1",
  ).trim();

  return {
    codcliente: cod || "1",
    nombre: String(selected?.nombre || "").trim(),
    isDefault: !!selected?.isDefault,
  };
}

function applyCustomerSelectionSnapshot(snapshot) {
  if (!snapshot || !window.CUSTOMER_SELECTOR) return false;

  const defaultCod = String(currentTerminal?.codcliente || "1").trim() || "1";
  const targetCod = String(snapshot?.codcliente || "").trim() || defaultCod;

  if (snapshot?.isDefault || targetCod === defaultCod) {
    window.CUSTOMER_SELECTOR.resetToDefault?.();
    return true;
  }

  const customers =
    typeof window.CUSTOMER_SELECTOR.listCustomers === "function"
      ? window.CUSTOMER_SELECTOR.listCustomers()
      : [];

  const found = Array.isArray(customers)
    ? customers.find((c) => String(c?.codcliente || "").trim() === targetCod)
    : null;

  const target = found || {
    codcliente: targetCod,
    nombre: String(snapshot?.nombre || "Cliente").trim() || "Cliente",
  };

  if (typeof window.CUSTOMER_SELECTOR.setSelected === "function") {
    window.CUSTOMER_SELECTOR.setSelected(target);
    return true;
  }

  return false;
}

function applyCustomerSelectionForParkedTicket(ticket) {
  if (!ticket || !window.CUSTOMER_SELECTOR) return false;

  const parkedCodcliente = String(ticket?.codcliente || "").trim();
  const defaultCod = String(currentTerminal?.codcliente || "1").trim() || "1";
  const customers =
    typeof window.CUSTOMER_SELECTOR.listCustomers === "function"
      ? window.CUSTOMER_SELECTOR.listCustomers()
      : [];

  let targetCustomer = null;
  if (parkedCodcliente && parkedCodcliente !== defaultCod) {
    targetCustomer = Array.isArray(customers)
      ? customers.find(
          (c) => String(c?.codcliente || "").trim() === parkedCodcliente,
        )
      : null;

    if (!targetCustomer) {
      targetCustomer = {
        codcliente: parkedCodcliente,
        nombre: String(ticket?.clientName || "Cliente").trim() || "Cliente",
      };
    }
  } else if (!parkedCodcliente) {
    const parkedName = String(ticket?.clientName || "")
      .trim()
      .toLowerCase();
    targetCustomer = Array.isArray(customers)
      ? customers.find(
          (c) =>
            String(c?.nombre || "")
              .trim()
              .toLowerCase() === parkedName,
        ) || null
      : null;
  }

  if (
    targetCustomer &&
    typeof window.CUSTOMER_SELECTOR.setSelected === "function"
  ) {
    window.CUSTOMER_SELECTOR.setSelected(targetCustomer);
    return true;
  }

  if (parkedCodcliente === defaultCod || !targetCustomer) {
    window.CUSTOMER_SELECTOR.resetToDefault?.();
    return true;
  }

  return false;
}

function restorePreParkedCustomerSelection() {
  const snapshot = preParkedCustomerSelection;
  preParkedCustomerSelection = null;
  if (!snapshot) return;
  applyCustomerSelectionSnapshot(snapshot);
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

  const paidTwin = findPaidTwinForParkedTicket(ticket, parkedTickets);
  if (paidTwin) {
    ticket.paid = true;
    ticket.paidAt = paidTwin?.paidAt || ticket.paidAt || new Date();
    ticket.paidTicketCode =
      paidTwin?.paidTicketCode || ticket.paidTicketCode || null;
    ticket.paidTicketId = paidTwin?.paidTicketId || ticket.paidTicketId || null;
    upsertParkedPaidHistory(ticket);
    saveParkedTicketsCache();
    renderParkedTicketsModal?.();
    toast(
      "Ese ticket aparcado ya figura como cobrado. No se puede volver a cargar.",
      "warn",
      "Aparcados",
    );
    return;
  }

  if (ticket.paid) {
    toast(
      "Ese ticket ya está cobrado. No se puede volver a cargar.",
      "warn",
      "Aparcados",
    );
    return;
  }

  if (currentParkedTicketIndex == null) {
    preParkedCustomerSelection = captureCurrentCustomerSelectionForParked();
  }

  applyCustomerSelectionForParkedTicket(ticket);

  cart = (ticket.items || []).map((i) => hydrateParkedItemForCart(i));

  // Reenlaza hijos de oferta al nuevo _lineId del parent tras hidratar.
  const parentIdMap = new Map();
  cart.forEach((line) => {
    if (!isPackParentLine(line)) return;
    const prevId = String(line?.__parkedPrevLineId || "").trim();
    if (!prevId) return;
    parentIdMap.set(prevId, line._lineId);
  });

  cart.forEach((line) => {
    const prevParent = String(line?.meta?.parentPackLineId || "").trim();
    if (!prevParent) return;

    const mapped = parentIdMap.get(prevParent);
    if (mapped) {
      line.meta = line.meta || {};
      line.meta.parentPackLineId = mapped;
    }
  });

  cart.forEach((line) => {
    delete line.__parkedPrevLineId;
  });

  renderCart();

  currentParkedTicketIndex = index;

  setStatusText("Ticket aparcado cargado en el carrito.");
  refreshParkButtonUI();
  refreshParkedEditingBanner();
}

// ===== [08] Operativa: gestion de terminales/agentes/caja =====
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

  if (!hasActiveLoginSession()) {
    mainAgentBar.innerHTML = "";
    mainAgentBar.classList.add("session-agentbar-hidden");
    if (agentNameEl) agentNameEl.textContent = "---";
    return;
  }

  mainAgentBar.classList.remove("session-agentbar-hidden");

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

  const createThemeStack = () => {
    const stack = document.createElement("div");
    stack.className = "agent-theme-stack";

    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "agent-btn agent-theme-mini agent-theme-btn-main";
    mainBtn.onclick = () => {
      toggleThemeMode();
    };

    const customerBtn = document.createElement("button");
    customerBtn.type = "button";
    customerBtn.className =
      "agent-btn agent-theme-mini agent-theme-btn-customer";
    customerBtn.onclick = () => {
      toggleCustomerDisplayThemeMode();
    };

    stack.appendChild(mainBtn);
    stack.appendChild(customerBtn);
    return stack;
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
    agentActions.appendChild(createThemeStack());
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
  agentActions.appendChild(createThemeStack());
  agentActions.appendChild(createDrawerBtn());

  if (agentNameEl) {
    agentNameEl.textContent = currentAgent ? currentAgent.name : "---";
  }

  updateThemeButtonsUI();
}

// Overlay para elegir TPV / agente
function showTerminalOverlay(mode = "session") {
  if (LOGIN_ACTIVE) return;
  if (!terminalOverlay) return;
  if (mode === "agentSwitch" && !hasActiveLoginSession()) return;

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

    const applyTerminalToAgentUI = (
      terminalId,
      { resetSelection = true } = {},
    ) => {
      terminalErrorEl.textContent = "";

      const list = getAgentsForTerminalId(terminalId);

      if (!list || list.length === 0) {
        currentAgent = null;
        if (agentNameEl) agentNameEl.textContent = "---";
        if (agentSelectWrapper) agentSelectWrapper.style.display = "none";
        if (agentButtonsOverlay) agentButtonsOverlay.innerHTML = "";
        terminalErrorEl.textContent =
          "Este terminal no tiene agentes asignados.";
        return;
      }

      if (resetSelection) {
        currentAgent = null;
        if (agentNameEl) agentNameEl.textContent = "---";
      } else if (
        currentAgent &&
        !list.some(
          (a) => String(a.codagente) === String(currentAgent?.codagente),
        )
      ) {
        currentAgent = null;
      }

      if (!currentAgent) {
        currentAgent = list[0] || null;
        try {
          window.TPV_CFG?.set?.(
            "auth.codagente",
            String(currentAgent?.codagente || ""),
          );
        } catch {}
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

        applyTerminalToAgentUI(tid, { resetSelection: true });
      };
    } else if (terminalSelect) {
      // por seguridad: en modo agentSwitch con 1 TPV, no necesitamos onchange
      terminalSelect.onchange = null;
    }

    // UI inicial con TPV actual
    applyTerminalToAgentUI(String(currentTerminal.id), {
      resetSelection: false,
    });

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

// ===== [08] Caja: observaciones y log robusto =====
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
  return looksLikeCashMethod({ codpago: c, descripcion: "" });
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
  const prefetched = arguments[1];
  if (Array.isArray(prefetched)) {
    return countPayChangesInFacturas(prefetched);
  }

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

  // Sincroniza predictor también para la rectificativa (serie R)
  updateFastTicketNumberByConfirmedCode({
    codigo: docRect?.codigo,
    codserie: payloadRect?.serie,
    numero2: payloadRect?.numero2,
    idfactura: rectId,
    terminalId: idtpv,
  });

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

  // Sincroniza predictor de numeracion para siguientes preimpresiones
  // (este flujo crea un ticket nuevo real fuera del cobro normal onPay).
  updateFastTicketNumberByConfirmedCode({
    codigo: docNew?.codigo,
    codserie: payloadNew?.serie,
    numero2: payloadNew?.numero2,
    idfactura: newId,
    terminalId: idtpv,
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
                <div class="cash-agent-stats">
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

function isSharedCashModeEnabled() {
  const cfgVal = window.TPV_CONFIG?.sharedCashMode;
  if (cfgVal == null) return true;
  return !!cfgVal;
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

async function apiReadLastOpenCajaGlobal() {
  const list = await fetchApiResourceWithParams("tpvcajas", {
    "sort[idcaja]": "DESC",
    "filter[fechafin_null]": 1,
    limit: 1,
  });
  return Array.isArray(list) && list[0] ? list[0] : null;
}

async function checkSharedCajaHealthOnce() {
  if (!isSharedCashModeEnabled()) return true;
  if (TPV_STATE?.offline || TPV_STATE?.locked) return true;
  if (!cashSession?.open) return true;

  const idcaja = getCajaIdSafe();
  if (!idcaja) return true;

  try {
    const remoteCaja = await apiReadCajaById(idcaja);
    if (remoteCaja && isCajaOpen(remoteCaja)) return true;

    cashSession.open = false;
    cashSession.remoteCajaId = null;
    pushCustomerState();

    stopProductsStockAutoRefresh?.();
    stopParkedReservationsAutoRefresh?.();
    stopSharedCajaHealthMonitor?.();

    try {
      localStorage.removeItem("tpv_remoteCajaId");
    } catch {}

    updateCashButtonLabel?.();
    renderCashIdChip?.();
    refreshAgentGuardUI?.();
    setStatusText("Caja cerrada en otro TPV");

    toast(
      "La caja se cerró en otro TPV. Debes abrir o recuperar una caja para continuar.",
      "warn",
      "Caja",
    );

    setTimeout(() => {
      maybeOpenCashOrRecover?.().catch?.(() => {});
    }, 250);

    return false;
  } catch (e) {
    if (!isConnectivityLikeError(e)) {
      console.warn("Chequeo de caja compartida falló:", e?.message || e);
    }
    return true;
  }
}

function startSharedCajaHealthMonitor() {
  stopSharedCajaHealthMonitor();

  if (!isSharedCashModeEnabled()) return;

  checkSharedCajaHealthOnce().catch(() => {});

  __sharedCajaHealthTimer = setInterval(async () => {
    if (__sharedCajaHealthInFlight) return;
    if (!cashSession?.open) return;

    __sharedCajaHealthInFlight = true;
    try {
      await checkSharedCajaHealthOnce();
    } finally {
      __sharedCajaHealthInFlight = false;
    }
  }, 10000);
}

function stopSharedCajaHealthMonitor() {
  if (__sharedCajaHealthTimer) {
    clearInterval(__sharedCajaHealthTimer);
    __sharedCajaHealthTimer = null;
  }
}

async function maybeOpenCashOrRecover() {
  if (cashRecoverInFlight) return;
  cashRecoverInFlight = true;

  try {
    if (isSafeTrainingModeEnabled()) {
      cashSession.remoteCajaId = null;
      cashSession.open = false;
      stopSharedCajaHealthMonitor?.();
      pushCustomerState();
      renderCashIdChip?.();

      try {
        localStorage.removeItem("tpv_remoteCajaId");
      } catch {}

      if (!cashOpenDialogShown) {
        cashOpenDialogShown = true;
        await ensureTerminalAgentDefaults();
        refreshAgentGuardUI?.();
        setTimeout(() => {
          if (cashSession?.open) {
            cashOpenDialogShown = false;
            return;
          }
          openCashOpenDialog("open");
        }, 0);
      }
      return;
    }

    const storedIdRaw = localStorage.getItem("tpv_remoteCajaId");
    const storedId = Number(storedIdRaw || 0) || 0;

    debugLog("[TPV] maybeOpenCashOrRecover()", {
      open: cashSession.open,
      storedId,
      sessionId: cashSession?.remoteCajaId || null,
      idtpv: currentTerminal?.id || null,
    });

    // Si no hay terminal, no podemos consultar abiertas por TPV
    const idtpv = Number(currentTerminal?.id || 0) || 0;

    // 1) Si hay ID guardado, VALIDAR en FS si sigue abierta
    if (storedId) {
      let shouldClearStoredId = true;

      try {
        const remoteCaja = await apiReadCajaById(storedId);

        if (remoteCaja && isCajaOpen(remoteCaja)) {
          // ✅ recuperable
          cashSession.remoteCajaId = Number(remoteCaja.idcaja || storedId);
          cashSession.open = true;
          pushCustomerState();
          loadCashLedgerIntoSession(cashSession.remoteCajaId);

          await ensureTerminalAgentDefaults();
          renderMainUI();
          renderMainAgentBar?.();
          refreshAgentGuardUI?.();
          updateCashButtonLabel();
          renderCashIdChip();
          await refreshStockAndReservationsOnly().catch(() => {});
          startProductsStockAutoRefresh?.();
          startParkedReservationsAutoRefresh?.();
          startSharedCajaHealthMonitor?.();
          return;
        }

        // ❌ estaba cerrada (o no existe)
        console.warn(
          "[TPV] Caja guardada no está abierta. Limpiando:",
          storedId,
        );
      } catch (e) {
        if (isConnectivityLikeError(e)) {
          shouldClearStoredId = false;
          console.warn(
            "[TPV] No se pudo validar caja guardada por conectividad. Se mantiene ID para reintento:",
            storedId,
          );
        }

        console.warn("[TPV] No se pudo validar caja guardada:", storedId, e);
      }

      // limpiar solo si realmente quedó invalidada (no por falta de conectividad)
      if (shouldClearStoredId) {
        cashSession.remoteCajaId = null;
        cashSession.open = false;
        pushCustomerState();
        localStorage.removeItem("tpv_remoteCajaId");
      } else {
        cashSession.remoteCajaId = storedId;
      }
    }

    // 2) Si NO hay caja guardada válida, buscar ABIERTAS en FS.
    //    En modo compartido se busca globalmente, no solo por idtpv local.
    if (idtpv || isSharedCashModeEnabled()) {
      try {
        const resp = isSharedCashModeEnabled()
          ? await apiReadLastOpenCajaGlobal()
          : await apiReadLastOpenCajaForTpv(idtpv);

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
          pushCustomerState();
          localStorage.setItem("tpv_remoteCajaId", String(pick.idcaja));
          loadCashLedgerIntoSession(cashSession.remoteCajaId);

          await ensureTerminalAgentDefaults();

          renderMainUI();
          renderMainAgentBar?.();
          refreshAgentGuardUI?.();
          updateCashButtonLabel();
          renderCashIdChip();
          await refreshStockAndReservationsOnly().catch(() => {});
          startProductsStockAutoRefresh?.();
          startParkedReservationsAutoRefresh?.();
          startSharedCajaHealthMonitor?.();

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
    stopSharedCajaHealthMonitor?.();
    pushCustomerState();
    renderCashIdChip();

    if (!cashOpenDialogShown) {
      cashOpenDialogShown = true;
      debugLog("[TPV] No hay caja abierta → mostrar modal apertura");
      await ensureTerminalAgentDefaults();
      refreshAgentGuardUI?.();
      // Abrimos en el siguiente tick para que cashRecoverInFlight
      // ya esté liberado en el finally y no bloquee el modal.
      setTimeout(() => {
        if (cashSession?.open) {
          cashOpenDialogShown = false;
          return;
        }
        openCashOpenDialog("open");
      }, 0);
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
  const prefetchedRecibosByFactura = arguments[1];

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
  if (
    prefetchedRecibosByFactura &&
    typeof prefetchedRecibosByFactura === "object"
  ) {
    recibos = prefetchedRecibosByFactura[String(idfactura)] || [];
  } else {
    try {
      recibos = await fetchRecibosByFactura(idfactura);
    } catch (e) {
      console.warn(
        "No pude leer recibos de factura",
        idfactura,
        e?.message || e,
      );
      recibos = [];
    }
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

function buildRecibosByFacturaMap(recibos) {
  const map = {};
  for (const r of Array.isArray(recibos) ? recibos : []) {
    const fid = String(r?.idfactura || "").trim();
    if (!fid) continue;
    if (!map[fid]) map[fid] = [];
    map[fid].push(r);
  }
  return map;
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
  const prefetchedFacturas = arguments[1];
  const prefetchedRecibosByFactura = arguments[2];

  const facturas =
    Array.isArray(prefetchedFacturas) && prefetchedFacturas.length
      ? prefetchedFacturas
      : await fetchApiResourceWithParams("facturaclientes", {
          "filter[idcaja]": idcaja,
          limit: 0,
        });

  const map = {};
  let totalPaymentUses = 0;

  for (const f of Array.isArray(facturas) ? facturas : []) {
    if (f.tpv_venta !== true) continue;

    const breakdown = await getFacturaPaymentBreakdown(
      f,
      prefetchedRecibosByFactura,
    );
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
  const prefetchedFacturas = arguments[1];

  const cajaId = Number(idcaja || 0) || 0;
  if (!cajaId) {
    cashSession.numtickets = 0;
    cashSession.ticketCountByAgent = {};
    return { totalTickets: 0, byAgent: {} };
  }

  const facturas =
    Array.isArray(prefetchedFacturas) && prefetchedFacturas.length
      ? prefetchedFacturas
      : await fetchApiResourceWithParams("facturaclientes", {
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
  const prefetchedFacturas = arguments[1];
  const prefetchedRecibosByFactura = arguments[2];

  const facturas =
    Array.isArray(prefetchedFacturas) && prefetchedFacturas.length
      ? prefetchedFacturas
      : await fetchApiResourceWithParams("facturaclientes", {
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

    const breakdown = await getFacturaPaymentBreakdown(
      f,
      prefetchedRecibosByFactura,
    );
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

  closeWithParkedPreConfirmed = false;
  if (cashDialogMode === "open" && !cashSession?.open) {
    cashOpenDialogShown = false;
  }
  cashOpenOverlay.classList.add("hidden");
  unlockAppUI?.();
  syncCashClosedUiState?.();
}

const cashOpenCloseX = document.getElementById("cashOpenCloseX");
const cashOpenCancelBtn = document.getElementById("cashOpenCancelBtn");
let closeWithParkedPreConfirmed = false;

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
  if (BOOT_IN_FLIGHT || cashRecoverInFlight) {
    setStatusText("Esperando recuperación de sesión...");
    return;
  }

  if (
    TPV_STATE?.offline ||
    TPV_STATE?.apiRecovering ||
    isReconnectOverlayVisible()
  ) {
    showReconnectIfAvailable(
      "No hay conexión con Recipok. Espera por favor, reconectando...",
    );
    return;
  }
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

        const facturasCaja = await fetchApiResourceWithParams(
          "facturaclientes",
          {
            "filter[idcaja]": cajaId,
            limit: 0,
          },
        );
        const facturasCajaList = Array.isArray(facturasCaja)
          ? facturasCaja
          : [];

        const idsFacturasCaja = facturasCajaList
          .map((f) => Number(f?.idfactura || 0))
          .filter((n) => Number.isFinite(n) && n > 0);

        const recibosCaja = idsFacturasCaja.length
          ? await fetchRecibosByFacturasMulti(idsFacturasCaja)
          : [];
        const recibosByFactura = buildRecibosByFacturaMap(recibosCaja);

        cashSession.closeFacturasSnapshot = facturasCajaList;

        // ✅ tickets reales de la caja
        await hydrateCloseTicketStatsForCaja(cajaId, facturasCajaList);

        // Métodos (TOTAL)
        await hydratePaymentsByMethodForClose(
          cajaId,
          facturasCajaList,
          recibosByFactura,
        );

        // Agentes + métodos por agente
        cashSession.agentSalesSummary = await buildAgentSalesSummaryForCaja(
          cajaId,
          facturasCajaList,
          recibosByFactura,
        );

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
  const autoLogText = buildCajaAutoLogText(autoLines);

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
  if (!hasActiveLoginSession()) {
    toast("Inicia sesión para registrar movimientos.", "warn", "Caja");
    return;
  }

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
        "qty",
      );
      return;
    }
  });
}

function hideCashOpenDialog() {
  if (!cashOpenOverlay) return;
  closeWithParkedPreConfirmed = false;
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
  syncCashDirectClearButtonVisibility();
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
  const requestId = createRequestId("CASHOP");

  logFeatureInfo("CAJA", "apertura-inicio", {
    requestId,
    terminalId: currentTerminal?.id || null,
    terminal: currentTerminal?.name || "---",
    agent: currentAgent?.name || currentAgent?.nick || "---",
    openingTotal: Number(cashSession?.openingTotal || 0),
  });

  ensureCashSessionCounters();
  resetCashRuntimeForNewCaja();

  cashSession.open = true;
  cashSession.openedAt = new Date().toISOString();
  pushCustomerState();

  try {
    await apiOpenCashInFS();

    const idcaja = getCajaIdSafe();
    if (idcaja) {
      clearCashLedger(idcaja);
      loadCashLedgerIntoSession(idcaja);
    }
  } catch (e) {
    logFeatureWarn("CAJA", "apertura-fs-no-disponible", {
      requestId,
      error: e?.message || e,
    });
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
  setTerminalNameClickable(
    Array.isArray(terminals) && terminals.length > 1,
    TPV_LOADING,
  );
  if (agentNameEl)
    agentNameEl.textContent = currentAgent ? currentAgent.name : "---";

  renderMainUI();
  renderMainAgentBar();
  updateCashButtonLabel();
  renderCashIdChip();

  await refreshStockAndReservationsOnly().catch(() => {});
  startProductsStockAutoRefresh?.();
  startParkedReservationsAutoRefresh?.();
  startSharedCajaHealthMonitor?.();

  logFeatureInfo("CAJA", "apertura-ok", {
    requestId,
    cajaId: getCajaIdSafe(),
    terminalId: currentTerminal?.id || null,
    terminal: currentTerminal?.name || "---",
    agent: currentAgent?.name || currentAgent?.nick || "---",
  });
}

async function confirmCashClosing() {
  const requestId = createRequestId("CASHCL");
  const trainingMode = isSafeTrainingModeEnabled();

  logFeatureInfo("CAJA", "cierre-inicio", {
    requestId,
    cajaId: getCajaIdSafe(),
    totalVentas: Number(cashSession?.totalSales || 0),
    numTickets: Number(cashSession?.numtickets || 0),
  });

  try {
    if (cashOpenOkBtn) cashOpenOkBtn.disabled = true;
  } catch {}

  const idcaja = getCajaIdSafe();

  const runWithTimeout = async (promise, timeoutMs, label) => {
    let timer = null;
    try {
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label || "Operación"} tardó demasiado`)),
            Math.max(1000, Number(timeoutMs || 0) || 10000),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

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
    report.payEditsCount = await getPayEditsCountForCaja(
      idcaja,
      cashSession?.closeFacturasSnapshot,
    );
    await runWithTimeout(printCashCloseReport(report), 12000, "Impresión");
  } catch (e) {
    console.warn("No se pudo imprimir el cierre:", e?.message || e);
  }

  let closedOk = false;
  try {
    await apiCloseCashInFS();

    if (trainingMode) {
      // En entorno de pruebas no dependemos de confirmación remota.
      closedOk = true;
    } else {
      const check = idcaja ? await apiReadCajaById(idcaja) : null;
      closedOk = !!check && !isCajaOpen(check);

      if (!check) closedOk = true;
    }
  } catch (e) {
    logFeatureWarn("CAJA", "cierre-fs-no-disponible", {
      requestId,
      cajaId: idcaja || null,
      error: e?.message || e,
    });
    console.warn("No se pudo cerrar caja en FacturaScripts:", e?.message || e);
    toast("No se pudo registrar el cierre en FacturaScripts.", "warn", "Caja");
  }

  if (!closedOk) {
    logFeatureWarn("CAJA", "cierre-no-confirmado", {
      requestId,
      cajaId: idcaja || null,
    });
    toast("No se pudo cerrar la caja. Reintenta.", "warn", "Caja");
    try {
      if (cashOpenOkBtn) cashOpenOkBtn.disabled = false;
    } catch {}
    return;
  }

  cashSession.open = false;
  stopProductsStockAutoRefresh?.();
  stopParkedReservationsAutoRefresh?.();
  stopSharedCajaHealthMonitor?.();
  pushCustomerState();

  cashSession.remoteCajaId = null;
  try {
    localStorage.removeItem("tpv_remoteCajaId");
  } catch {}

  hideCashOpenDialog();
  updateCashButtonLabel();
  renderCashIdChip();
  cashOpenDialogShown = false;

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

  logFeatureInfo("CAJA", "cierre-ok", {
    requestId,
    cajaId: idcaja || null,
    terminalId: currentTerminal?.id || null,
  });

  renderCashIdChip();

  if (trainingMode) {
    const leaveTraining = await confirmModal(
      "Cierre en entorno de pruebas",
      "Has cerrado la caja de pruebas.\n\n¿Quieres salir del entorno de pruebas y volver al modo normal?\n\nSi pulsas Cancelar, seguirás en modo pruebas.",
    );

    if (leaveTraining) {
      await exitSafeTrainingMode();
    }
  }

  try {
    if (cashOpenOkBtn) cashOpenOkBtn.disabled = false;
  } catch {}
}

// ===== [07] API: llamadas Recipok/FacturaScripts =====
async function fetchApiResource(resource, opts = {}) {
  const cfg = window.RECIPOK_API;
  if (!cfg || !cfg.baseUrl || !cfg.apiKey) {
    throw new Error("Config API no definida");
  }

  throwIfApi429Cooldown(`fetchApiResource:${resource}`);

  const availability = await canCallApiResource(resource, {
    force: opts.forceResources,
  });
  if (availability.known && !availability.ok) {
    throw new Error(
      `Recurso no disponible en API: ${availability.missing?.[0] || resource}`,
    );
  }

  const timeoutMs = Number(opts.timeoutMs || 10000);
  const url = `${cfg.baseUrl}/${resource}?limit=0`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;

  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Token: cfg.apiKey,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Timeout al cargar ${resource}`);
    }

    throw new Error(`Error de red en ${resource}: ${err?.message || err}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 429) {
    triggerApi429Cooldown(
      `fetchApiResource:${resource}`,
      res.headers?.get?.("Retry-After") || "",
    );
    throw buildApi429Error();
  }

  if (!res.ok) {
    if (res.status === 404) {
      markApiResourceMissing(resource);
    }
    throw new Error(
      `HTTP ${res.status} en ${resource}: ${res.statusText || ""}`,
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

  if (!Array.isArray(data)) {
    console.warn(`Formato inesperado para ${resource}:`, data);
  }

  return data;
}

let apiResourcesCacheSet = null;
let apiResourcesCacheBaseUrl = "";
let apiMissingResourcesSet = new Set();
let apiMissingResourcesBaseUrl = "";

const API_FEATURE_REQUIREMENTS = {
  packs: ["productpacks", "productpacklines"],
};

function loadApiResourcesCacheForBase(baseUrl) {
  try {
    const raw = localStorage.getItem(API_RESOURCES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const list = Array.isArray(parsed?.resources) ? parsed.resources : [];
    const cachedBase = String(parsed?.baseUrl || "").trim();

    if (!cachedBase || cachedBase !== String(baseUrl || "").trim()) {
      return null;
    }

    const set = new Set(
      list.map((x) => String(x || "").trim()).filter(Boolean),
    );
    if (!set.size) return null;

    return set;
  } catch {
    return null;
  }
}

function loadApiMissingResourcesCacheForBase(baseUrl) {
  try {
    const raw = localStorage.getItem(API_MISSING_RESOURCES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const list = Array.isArray(parsed?.resources) ? parsed.resources : [];
    const cachedBase = String(parsed?.baseUrl || "").trim();

    if (!cachedBase || cachedBase !== String(baseUrl || "").trim()) {
      return new Set();
    }

    return new Set(list.map((x) => String(x || "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function saveApiMissingResourcesCacheForBase(baseUrl, missingSet) {
  try {
    const resources = Array.from(missingSet || [])
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    const safe = {
      baseUrl: String(baseUrl || "").trim(),
      resources,
    };

    localStorage.setItem(API_MISSING_RESOURCES_CACHE_KEY, JSON.stringify(safe));
    localStorage.setItem(
      API_MISSING_RESOURCES_CACHE_TS_KEY,
      String(Date.now()),
    );
  } catch {}
}

function saveApiResourcesCacheForBase(baseUrl, resourcesSet) {
  try {
    const resources = Array.from(resourcesSet || []).map((x) =>
      String(x || "").trim(),
    );
    const safe = {
      baseUrl: String(baseUrl || "").trim(),
      resources: resources.filter(Boolean),
    };
    localStorage.setItem(API_RESOURCES_CACHE_KEY, JSON.stringify(safe));
    localStorage.setItem(API_RESOURCES_CACHE_TS_KEY, String(Date.now()));
  } catch {}
}

async function getApiResourcesSet(opts = {}) {
  const force = opts.force === true;

  const cfg = window.RECIPOK_API || {};
  const baseUrl = String(cfg.baseUrl || "").replace(/\/+$/, "");
  const apiKey = String(cfg.apiKey || "").trim();
  if (!baseUrl || !apiKey) return null;

  if (!force && isApi429CooldownActive()) {
    return apiResourcesCacheSet;
  }

  if (apiResourcesCacheBaseUrl !== baseUrl) {
    apiResourcesCacheBaseUrl = baseUrl;
    apiResourcesCacheSet = null;
  }

  if (apiMissingResourcesBaseUrl !== baseUrl) {
    apiMissingResourcesBaseUrl = baseUrl;
    apiMissingResourcesSet = loadApiMissingResourcesCacheForBase(baseUrl);
  }

  if (!force && apiResourcesCacheSet && apiResourcesCacheSet.size) {
    return apiResourcesCacheSet;
  }

  if (!force && (!apiResourcesCacheSet || !apiResourcesCacheSet.size)) {
    const fromStorage = loadApiResourcesCacheForBase(baseUrl);
    if (fromStorage && fromStorage.size) {
      apiResourcesCacheSet = fromStorage;
      return apiResourcesCacheSet;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${baseUrl}/`, {
      method: "GET",
      headers: { Accept: "application/json", Token: apiKey },
      cache: "no-store",
      signal: controller.signal,
    });

    if (res.status === 429) {
      triggerApi429Cooldown(
        "getApiResourcesSet",
        res.headers?.get?.("Retry-After") || "",
      );
      return apiResourcesCacheSet;
    }

    if (!res.ok) return apiResourcesCacheSet;

    const data = await res.json().catch(() => null);
    const list = Array.isArray(data?.resources) ? data.resources : [];
    const set = new Set(
      list.map((x) => String(x || "").trim()).filter(Boolean),
    );

    if (set.size) {
      apiResourcesCacheSet = set;
      saveApiResourcesCacheForBase(baseUrl, set);

      let missingChanged = false;
      for (const resourceName of Array.from(apiMissingResourcesSet)) {
        if (set.has(resourceName)) {
          apiMissingResourcesSet.delete(resourceName);
          missingChanged = true;
        }
      }
      if (missingChanged) {
        saveApiMissingResourcesCacheForBase(baseUrl, apiMissingResourcesSet);
      }
    }

    return apiResourcesCacheSet;
  } catch {
    return apiResourcesCacheSet;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeApiResourceName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  return raw.split("/").filter(Boolean)[0] || "";
}

function markApiResourceMissing(resourceName) {
  const normalized = normalizeApiResourceName(resourceName);
  if (!normalized) return;
  if (apiMissingResourcesSet.has(normalized)) return;
  apiMissingResourcesSet.add(normalized);
  saveApiMissingResourcesCacheForBase(
    apiMissingResourcesBaseUrl,
    apiMissingResourcesSet,
  );
}

async function apiHasResources(requiredResources = [], opts = {}) {
  const required = Array.from(
    new Set(
      (Array.isArray(requiredResources) ? requiredResources : [])
        .map(normalizeApiResourceName)
        .filter(Boolean),
    ),
  );

  if (!required.length) {
    return { known: false, ok: true, missing: [] };
  }

  const resourcesSet = await getApiResourcesSet(opts);
  if (!resourcesSet || !resourcesSet.size) {
    // Fail-open: si no pudimos descubrir recursos, no bloqueamos features.
    return { known: false, ok: true, missing: [] };
  }

  const missing = required.filter((r) => !resourcesSet.has(r));
  return { known: true, ok: missing.length === 0, missing };
}

async function isApiFeatureAvailable(featureKey, opts = {}) {
  const key = String(featureKey || "").trim();
  const required = API_FEATURE_REQUIREMENTS[key] || [];
  return await apiHasResources(required, opts);
}

async function canCallApiResource(resourceName, opts = {}) {
  const normalized = normalizeApiResourceName(resourceName);
  if (!normalized) return { known: false, ok: true, missing: [] };

  await getApiResourcesSet(opts);

  if (apiMissingResourcesSet?.has?.(normalized)) {
    return { known: true, ok: false, missing: [normalized] };
  }

  if (!apiResourcesCacheSet || !apiResourcesCacheSet.size) {
    return { known: false, ok: true, missing: [] };
  }

  if (!apiResourcesCacheSet.has(normalized)) {
    markApiResourceMissing(normalized);
    return { known: true, ok: false, missing: [normalized] };
  }

  return { known: true, ok: true, missing: [] };
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

    // Guardar caché SIEMPRE que haya algo válido
    if (list.length) savePayMethodsCache(list);

    // ✅ construir lista de codpago que son EFECTIVO, basado en /formapagos
    CASH_CODPAGOS = buildCashCodpagosFromFormapagos(list);
    window.__CASH_CODPAGOS__ = Array.from(CASH_CODPAGOS);

    return list;
  } catch (e) {
    // Fallback: si falla online, usamos caché
    const cached = loadPayMethodsCache();
    if (Array.isArray(cached) && cached.length) {
      CASH_CODPAGOS = buildCashCodpagosFromFormapagos(cached);
      window.__CASH_CODPAGOS__ = Array.from(CASH_CODPAGOS);
      return cached;
    }

    const fallback = [
      { codpago: "CONT", descripcion: "Al contado", imprimir: true },
    ];
    CASH_CODPAGOS = buildCashCodpagosFromFormapagos(fallback);
    window.__CASH_CODPAGOS__ = Array.from(CASH_CODPAGOS);
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
    closeWithParkedPreConfirmed = false;

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

    // Mantener terminal/agente seleccionados al cancelar apertura.
    if (terminalNameEl)
      terminalNameEl.textContent = currentTerminal?.name || "---";
    if (agentNameEl) agentNameEl.textContent = currentAgent?.name || "---";
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

      const parkedCount = getScopedPendingParkedTickets(parkedTickets).length;

      // Releer valor efectivo para evitar cierres bloqueados por estado stale.
      await loadAllowCloseWithParkedToggle();

      let closeQuestion =
        "¿Seguro que quieres cerrar la caja?\n\nEsta acción registrará el cierre y no se puede deshacer.";

      if (parkedCount > 0) {
        if (!allowCloseWithParkedTickets) {
          await confirmModal(
            "No puedes cerrar la caja",
            `Tienes ${parkedCount} ticket(s) aparcado(s).\n\nRecupéralos (o elimínalos) antes de cerrar la caja.`,
          );
          openParkedModal();
          return;
        }

        if (!closeWithParkedPreConfirmed) {
          const okWithParked = await confirmModal(
            "Tickets aparcados",
            `Tienes ${parkedCount} ticket(s) aparcado(s).\n\nSe conservarán para recuperarlos después.\n\n¿Cerrar caja de todos modos?`,
            {
              middleButtonText: "Revisar aparcados",
              middleButtonResult: "parked",
            },
          );

          if (okWithParked === "parked") {
            openParkedModal();
            return;
          }
          if (!okWithParked) return;
        }

        closeWithParkedPreConfirmed = false;
      }

      const ok = await confirmCashCloseModal(closeQuestion);
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

// ===== [08] Caja: logs remotos en FacturaScripts =====

// 1) Request genérico (form-urlencoded) para POST/PUT/DELETE
async function apiWrite(resource, method = "POST", fields = {}) {
  if (isSafeTrainingModeEnabled()) {
    throw buildRemoteWriteBlockedError(method, resource);
  }

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
  if (isSafeTrainingModeEnabled()) return null;
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
  if (isSafeTrainingModeEnabled()) {
    const existing =
      Number(cashSession?.remoteCajaId || 0) ||
      Number(localStorage.getItem("tpv_remoteCajaId") || 0);

    if (existing > 0) {
      cashSession.remoteCajaId = existing;
      return { ok: true, reused: true, idcaja: existing, simulated: true };
    }

    const simulatedId = 900000000 + (Date.now() % 10000000);
    cashSession.remoteCajaId = simulatedId;
    try {
      localStorage.setItem("tpv_remoteCajaId", String(simulatedId));
    } catch {}
    return { ok: true, idcaja: simulatedId, simulated: true };
  }

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

  if (isSharedCashModeEnabled()) {
    try {
      const sharedOpen = await apiReadLastOpenCajaGlobal();
      if (
        sharedOpen &&
        isCajaOpen(sharedOpen) &&
        Number(sharedOpen.idcaja || 0)
      ) {
        const reusedId = Number(sharedOpen.idcaja || 0);
        cashSession.remoteCajaId = reusedId;
        try {
          localStorage.setItem("tpv_remoteCajaId", String(reusedId));
        } catch {}
        return { ok: true, reused: true, idcaja: reusedId };
      }
    } catch (e) {
      console.warn(
        "No se pudo comprobar caja compartida abierta:",
        e?.message || e,
      );
    }
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
  if (isSafeTrainingModeEnabled()) {
    return {
      ok: true,
      simulated: true,
      idcaja: Number(getCajaIdSafe?.() || 0) || null,
    };
  }

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
  // Si estamos en "demo" pero ya hay terminales reales cargados,
  // volvemos a resolver para no quedarnos pegados al fallback.
  const hasRealTerminalLoaded =
    Array.isArray(terminals) &&
    terminals.some((t) => String(t?.id || "") !== "demo");
  const shouldResolveTerminal =
    !currentTerminal ||
    (String(currentTerminal?.id || "") === "demo" && hasRealTerminalLoaded);

  if (shouldResolveTerminal) {
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

let __cashHeaderActionInFlight = false;

async function handleCashHeaderAction(opts = {}) {
  const { auto = false } = opts;

  if (__cashHeaderActionInFlight) {
    if (!auto) {
      toast("Procesando caja...", "info", "Caja");
    }
    return false;
  }

  __cashHeaderActionInFlight = true;
  if (cashHeaderBtn) cashHeaderBtn.disabled = true;

  try {
    // 0) Bloqueado
    if (TPV_STATE.locked) {
      showMessageModal(
        "Acceso bloqueado",
        "Tu cuenta de TPV está desactivada. Contacta con soporte.",
      );
      return false;
    }

    // 1) Si NO hay empresa resuelta
    if (!hasCompanyResolved()) {
      await forceReconnectFlow();
      if (!hasCompanyResolved()) return false;
    }

    // 1.5) Si seguimos offline
    if (TPV_STATE.offline) {
      try {
        await loadDataFromApi({ refresh: true });
      } catch {}

      if (TPV_STATE.offline) {
        if (!auto) {
          toast(
            "Sin conexión. Reintenta cuando tengas internet.",
            "warn",
            "Caja",
          );
        }
        return false;
      }
    }

    // 2) Datos base
    await ensureDataLoaded();

    // 3) Login
    if (!getLoginUser?.() && !localStorage.getItem("tpv_login_user")) {
      const ok = await ensureLoginAutoOrPrompt();
      if (!ok) return false;
    }

    // 4) Si caja abierta => si es automático, recuperar/salir sin abrir cierre
    if (cashSession.open) {
      if (auto) {
        return true;
      }

      const parkedCount = getScopedPendingParkedTickets(parkedTickets).length;

      // Releer valor efectivo por si el toggle cambió en opciones recientemente.
      await loadAllowCloseWithParkedToggle();

      if (parkedCount > 0) {
        if (!allowCloseWithParkedTickets) {
          await confirmModal(
            "Tickets aparcados",
            `Tienes ${parkedCount} ticket${parkedCount === 1 ? "" : "s"} aparcado${
              parkedCount === 1 ? "" : "s"
            }.\n\nAntes de cerrar la caja, recupera o elimina los tickets aparcados.`,
          );
          openParkedModal();
          return false;
        }

        const okWithParked = await confirmModal(
          "Tickets aparcados",
          `Tienes ${parkedCount} ticket${parkedCount === 1 ? "" : "s"} aparcado${
            parkedCount === 1 ? "" : "s"
          }.\n\nSe conservarán para recuperarlos después.\n\n¿Cerrar caja de todos modos?`,
          {
            middleButtonText: "Revisar aparcados",
            middleButtonResult: "parked",
          },
        );

        if (okWithParked === "parked") {
          openParkedModal();
          return false;
        }
        if (!okWithParked) return false;

        closeWithParkedPreConfirmed = true;
      }

      openCashOpenDialog("close");
      return true;
    }

    // 5) Refrescar terminales/agentes
    await refreshTerminalsAndAgents();

    if (!Array.isArray(terminals) || terminals.length === 0) {
      if (!currentTerminal) {
        setCurrentTerminal({ id: "demo", name: "TPV demo" });
      }

      cashResetUIForOpening();
      cashWrapInputsWithSteppers();

      cashOpenDialogShown = false;
      await maybeOpenCashOrRecover();
      return true;
    }

    await ensureTerminalAgentDefaults();

    if (!currentTerminal) {
      if (!auto) {
        showTerminalOverlay("session");
      }
      return false;
    }

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

      if (agentNameEl) {
        agentNameEl.textContent =
          currentAgent.name || currentAgent.nick || "---";
      }

      renderMainAgentBar?.();
    }

    cashOpenDialogShown = false;
    await maybeOpenCashOrRecover();
    return true;
  } finally {
    __cashHeaderActionInFlight = false;
    if (cashHeaderBtn) cashHeaderBtn.disabled = !!TPV_LOADING;
  }
}

if (cashHeaderBtn) {
  cashHeaderBtn.onclick = async () => {
    if (TPV_LOADING) return;
    await handleCashHeaderAction({ auto: false });
  };
}

// Click en nombre de agente: cambio rápido (agente y, si hay >1, también terminal)
if (agentNameEl) {
  agentNameEl.addEventListener("click", async () => {
    if (TPV_LOADING) return;
    if (!hasActiveLoginSession()) return;

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
    if (TPV_LOADING) return;
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

// ===== [07] API: carga principal de datos Recipok =====
async function loadDataFromApi(opts = {}) {
  console.log("loadDataFromApi() ejecutándose con:", window.RECIPOK_API);

  try {
    const cfg = window.RECIPOK_API || {};

    // Si no hay configuración, solo demo si está expresamente permitido
    if (!cfg.baseUrl || !cfg.apiKey) {
      console.warn("Config API Recipok no definida.");

      clearApiRetryTimer();

      if (restoreBootSnapshotIntoRuntime("config-sin-api")) {
        setStatusText("Offline (cache local)");
        TPV_STATE.offline = true;
        TPV_STATE.locked = false;
        updateCashButtonLabel();
        renderMainUI();
        toast("Modo offline con datos guardados.", "info", "Offline");
        return;
      }

      setStatusText("API de Recipok no configurada");
      TPV_STATE.offline = true;
      TPV_STATE.locked = true;
      updateCashButtonLabel();

      return;
    }

    // base de la API, tal cual (normalmente acaba en /api/3)
    apiBaseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
    setProductThumbTenantFromApiBase(apiBaseUrl);

    // base para ficheros: quitamos el sufijo /api/loquesea
    filesBaseUrl = apiBaseUrl.replace(/\/api\/[^/]+$/i, "");

    setStatusText("Conectando API...");

    // 1) Cargamos recursos principales
    const results = await Promise.allSettled([
      fetchApiResource("familias"),
      fetchApiResource("productos"),
      fetchApiResource("tpvterminales"),
      fetchApiResource("variantes"),
      fetchApiResource("stocks"),
      fetchApiResource("empresas"),
      buildProductImagesMap().catch((e) => {
        console.warn(
          "No se pudieron cargar imágenes de productos:",
          e?.message || e,
        );
        return {};
      }),
    ]);

    const [
      familiasRes,
      productosRes,
      tpvTerminalesRes,
      variantesRes,
      stocksRes,
      empresasRes,
      productImagesRes,
    ] = results;

    // Críticos
    if (
      familiasRes.status !== "fulfilled" ||
      productosRes.status !== "fulfilled"
    ) {
      throw new Error("No se pudieron cargar recursos críticos de la API.");
    }

    // No críticos o semi-críticos
    const familiasRaw = Array.isArray(familiasRes.value)
      ? familiasRes.value
      : [];
    const productosData = Array.isArray(productosRes.value)
      ? productosRes.value
      : [];
    const tpvTerminales =
      tpvTerminalesRes.status === "fulfilled" &&
      Array.isArray(tpvTerminalesRes.value)
        ? tpvTerminalesRes.value
        : [];
    const variantesData =
      variantesRes.status === "fulfilled" && Array.isArray(variantesRes.value)
        ? variantesRes.value
        : [];
    const stocksData =
      stocksRes.status === "fulfilled" && Array.isArray(stocksRes.value)
        ? stocksRes.value
        : [];
    const empresasData =
      empresasRes.status === "fulfilled" && Array.isArray(empresasRes.value)
        ? empresasRes.value
        : [];
    const productImagesMap =
      productImagesRes.status === "fulfilled" &&
      productImagesRes.value &&
      typeof productImagesRes.value === "object"
        ? productImagesRes.value
        : {};

    companyInfo = empresasData[0] || null;

    try {
      await loadCompanyLogoUrl();
    } catch (e) {
      console.warn("No se pudo cargar el logo de empresa:", e?.message || e);
    }

    PRODUCT_IMAGES_MAP = productImagesMap;

    if (stocksRes.status === "fulfilled") {
      rebuildManagedStockProductIds(stocksData);
    } else {
      managedStockProductIds = new Set();
      managedStockCatalogLoaded = false;
    }

    // 2) Impuestos
    taxRatesByCode = {};
    try {
      const impuestosData = await fetchApiResource("impuestos");
      if (Array.isArray(impuestosData)) {
        impuestosData.forEach((imp) => {
          const code = String(
            imp.codimpuesto || imp.codigo || imp.id || "",
          ).trim();
          if (!code) return;

          let rate =
            imp.iva ?? imp.porcentaje ?? imp.porcentajeiva ?? imp.impuesto ?? 0;

          rate = Number(rate);
          if (isNaN(rate)) rate = 0;

          taxRatesByCode[code] = rate;
        });
      }
    } catch (e) {
      console.warn(
        "No se pudieron cargar los impuestos. Se usará el fallback del código:",
        e?.message || e,
      );
      taxRatesByCode = {};
    }

    // 3) TPV-agentes
    let tpvAgentesData = [];
    let agentesMaestros = [];
    try {
      const [tpvAgentesRes, agentesRes] = await Promise.allSettled([
        fetchApiResource("tpvagentes"),
        fetchApiResource("agentes"),
      ]);

      tpvAgentesData =
        tpvAgentesRes.status === "fulfilled" &&
        Array.isArray(tpvAgentesRes.value)
          ? tpvAgentesRes.value
          : [];

      agentesMaestros =
        agentesRes.status === "fulfilled" && Array.isArray(agentesRes.value)
          ? agentesRes.value
          : [];
    } catch (e) {
      console.warn(
        "No se pudieron cargar tpvagentes/agentes:",
        e?.message || e,
      );
    }

    // ===== Familias -> categories =====
    if (familiasRaw.length) {
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
      categories = [];
    }

    // ===== Productos + variantes -> products =====
    if (productosData.length) {
      const productoById = new Map();
      productosData.forEach((p, idx) => {
        const idProd = Number(p.idproducto ?? p.id ?? idx);
        if (!idProd) return;
        productoById.set(idProd, p);
      });

      const variantsByProduct = {};
      if (variantesData.length) {
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
        const codImpuestoBase = base.codimpuesto || null;
        const taxRateBase = extractTaxRateFromCode(codImpuestoBase);
        const baseSort = Number(base.tpv_sort ?? base.tpvsort ?? 0) || 0;
        const baseSortKey = baseSort * 1000;
        const imgInfoBase = PRODUCT_IMAGES_MAP[baseId] || null;

        const sortedVariants = list.slice().sort((a, b) => a.idx - b.idx);

        sortedVariants.forEach(({ v }, pos) => {
          let mainName = String(v.referencia ?? "").trim();
          if (!mainName) mainName = baseName;
          if (!mainName || mainName === "-") return;

          const price = Number(v.precio ?? base.precio ?? 0);
          const idVar = Number(v.idvariante ?? v.id ?? baseId * 1000 + pos);
          const secondaryName =
            baseName && mainName !== baseName ? baseName : "";

          combined.push({
            id: idVar,
            name: mainName,
            secondaryName,
            referencia: mainName,
            descripcion: baseName,
            descripcion2: secondaryName,
            price,
            category,
            sortKey: baseSortKey + pos,
            baseProductId: baseId,
            isVariant: true,
            variantOrder: pos,
            isPrimaryVariant: pos === 0,
            codimpuesto: codImpuestoBase,
            taxRate: taxRateBase,
            imageUrl: imgInfoBase ? imgInfoBase.url : null,
            stockfisRaw: base.stockfis,
            stockfis: parseManagedStockValue(base.stockfis),
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
        const imgInfo = PRODUCT_IMAGES_MAP[idProd] || null;

        combined.push({
          id: idProd,
          name,
          secondaryName: "",
          referencia: String(p.referencia ?? name).trim(),
          descripcion: String(p.descripcion ?? name).trim(),
          descripcion2: "",
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
          stockfisRaw: p.stockfis,
          stockfis: parseManagedStockValue(p.stockfis),
        });
      });

      // ---- ORDEN FINAL ----
      combined.sort(compareProductsForDisplay);

      products = combined;
      rebuildBarcodeLocalIndex(variantesData);
    } else {
      products = [];
      BARCODE_LOCAL_PRODUCT_BY_CODE.clear();
      barcodeCatalogReady = false;
    }

    // Packs: carga normal (no forzada) para evitar reintentos agresivos.
    await warmupPacksData().catch(() => {});

    // ===== Terminales -> terminals =====
    terminals = Array.isArray(tpvTerminales)
      ? tpvTerminales.map((t, idx) => {
          const id = String(t.idtpv ?? t.id ?? idx);
          return {
            id,
            name: t.name || t.descripcion || `TPV ${id}`,
            codalmacen: t.codalmacen || null,
            productlimit: t.productlimit || null,
            codcliente: String(t.codcliente || "1"),
          };
        })
      : [];

    // ===== Agentes =====
    if (agentesMaestros.length) {
      buildAgentNameMap(agentesMaestros);
    } else if (!Object.keys(agentNameByCode).length) {
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

    saveTerminalAgentCache({ terminals, agentsByTerminal, agents });
    saveBootSnapshot({
      categories,
      products,
      terminals,
      agentsByTerminal,
      agents,
      agentNameByCode,
      taxRatesByCode,
      companyInfo,
      productImagesMap: PRODUCT_IMAGES_MAP,
      source: "online-loadDataFromApi",
    });

    // Aquí sí: ya está todo cargado correctamente
    LAST_FULL_LOAD_AT = Date.now();
    exitApiRetryMode();
    setStatusText("Online Recipok");

    const numTerminals = terminals.length;
    const onlyTerminal = numTerminals === 1 ? terminals[0] : null;

    // =========================
    // MODO REFRESH (sin overlays)
    // =========================
    if (opts.refresh === true) {
      if (currentTerminal) {
        const stillExists = terminals.some(
          (t) => String(t.id) === String(currentTerminal.id),
        );
        if (!stillExists) currentTerminal = null;
      }

      if (!currentTerminal) {
        if (onlyTerminal) {
          setCurrentTerminal(onlyTerminal);
          await renderTerminalDefaultCustomerSelect();
        } else if (terminals.length) {
          setCurrentTerminal(terminals[0]);
        }
      }

      if (currentTerminal) {
        const listNow = getAgentsForTerminalId(currentTerminal.id);

        if (currentAgent) {
          const ok = listNow.some(
            (a) => String(a.codagente) === String(currentAgent.codagente),
          );
          if (!ok) currentAgent = null;
        }

        if (!currentAgent) {
          currentAgent = listNow[0] || null;
        }
      }

      renderMainUI(true);
      return;
    }

    // =========================
    // MODO ARRANQUE
    // =========================
    await autoSelectTerminalAndAgentIfPossible();

    if (!currentTerminal) {
      if (numTerminals > 0 || agents.length > 0) {
        showTerminalOverlay("session");
      } else {
        renderMainUI();
      }
      return;
    }

    fireSessionReady();
  } catch (err) {
    console.error("Error llamando a la API de Recipok:", err);

    const restored = restoreBootSnapshotIntoRuntime("loadDataFromApi-error");
    if (restored) {
      setStatusText("Offline (cache local)");
      TPV_STATE.offline = true;
      TPV_STATE.locked = false;
      updateCashButtonLabel();
      renderMainUI(true);
      hideReconnectIfAvailable();
      enterApiRetryMode(
        "Sin conexión con Recipok. Trabajando con caché local.",
        {
          lock: false,
          scheduleRetry: false,
          showOverlay: false,
        },
      );

      if (!opts.silentRetry) {
        toast("Sin conexión: usando datos guardados en local.", "warn");
      }
      return;
    }

    enterApiRetryMode("Sin conexión con Recipok. Reintentando...", {
      lock: false,
      scheduleRetry: false,
      showOverlay: true,
    });

    if (!opts.silentRetry) {
      toast("Se ha perdido la conexión con Recipok. Reintentando...", "warn");
    }
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
    resetProductImageRetryState({ clearBrokenUrls: true });
    await loadDataFromApi({ refresh: true });
    await warmupPacksData({ force: true }).catch(() => {});
    await refreshTerminalsAndAgents();

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

// ===== [10] Bootstrap bridge: recuperar caja ya abierta =====
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
        TPV_LOADING,
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
    saveTerminalAgentCache({ terminals, agentsByTerminal, agents });

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
    const fallback = loadTerminalAgentCache();
    if (
      fallback &&
      Array.isArray(fallback.terminals) &&
      fallback.terminals.length
    ) {
      terminals = fallback.terminals;
      agentsByTerminal = fallback.agentsByTerminal || {};
      agents = Array.isArray(fallback.agents) ? fallback.agents : [];
      await restoreTerminalAgentFromCfg();
      refreshAgentGuardUI?.();
      console.warn("TPVs/agentes cargados desde caché local (offline).");
      return;
    }

    console.warn("No se pudieron refrescar TPVs/agentes:", e);
  }
}

// ===== [08] Cobro: creacion de ticket en FacturaScripts =====
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

// ===== [09] Modal: confirmacion de cierre de caja =====
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

// ===== [09] Modal: post-cobro =====
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

function getPostPayPrintTicketCandidate() {
  const pending = window.__POSTPAY_PENDING__;
  if (pending && typeof pending === "object") {
    return pending.printDraft || null;
  }
  return lastTicket || null;
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
    setPostPayPrintEnabled(!!getPostPayPrintTicketCandidate());
    postPayPrintBtn.onclick = async () => {
      const t = getPostPayPrintTicketCandidate();
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

// ===== [09] Opciones (panel principal) =====
const OPTIONS_AUTOPRINT_KEY = "tpv_autoPrint";
const OPTIONS_GROUPLINES_KEY = "tpv_groupLines";
const FAST_TICKET_NUMBER_CACHE_KEY = "tpv_fast_ticket_number_by_type_v1";

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
// ===== [09] Opciones: abrir cajon siempre (toggle) =====
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

// ===== [09] Opciones: impresora =====
const PRINTER_REAL_KEY = "tpv_printerRealName"; // POS-80 (lo que ve el usuario)
const PRINTER_QUEUE_KEY = "tpv_printerQueueName"; // RECIPOK_POS (Linux)

function isLinux() {
  return window.TPV_ENV?.platform === "linux";
}

function getFastTicketNumberCache() {
  try {
    const raw = localStorage.getItem(FAST_TICKET_NUMBER_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setFastTicketNumberCache(cache) {
  try {
    const safe = cache && typeof cache === "object" ? cache : {};
    localStorage.setItem(FAST_TICKET_NUMBER_CACHE_KEY, JSON.stringify(safe));
  } catch {}
}

function parseTrailingInteger(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const m = s.match(/(\d+)(?!.*\d)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function normalizeTicketCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function formatTicketPrintDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

function formatTicketPrintTimeWithSeconds(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mi}:${ss}`;
}

function getSalePrintTypeKey({ codserie, numero2, terminalId }) {
  const serie = String(codserie || "S")
    .trim()
    .toUpperCase();
  const n2 = String(numero2 || "").trim();
  const term = String(terminalId || "NO_TERM").trim();
  return `${term}::${serie}::${n2 || "_"}`;
}

function formatPredictedCode(lastCode, nextNumber, codserie) {
  const safeNext = Math.max(1, Number(nextNumber || 1));
  const baseSerie = String(codserie || "S")
    .trim()
    .toUpperCase();

  const fromLast = String(lastCode || "").trim();
  if (fromLast) {
    const m = fromLast.match(/(\d+)(?!.*\d)/);
    if (m) {
      const width = m[1].length;
      const padded = String(safeNext).padStart(width, "0");
      return fromLast.replace(/(\d+)(?!.*\d)/, padded);
    }
  }

  return `${baseSerie}-${safeNext}`;
}

function predictNextTicketCodeByType({ codserie, numero2, terminalId }) {
  const typeKey = getSalePrintTypeKey({ codserie, numero2, terminalId });
  const cache = getFastTicketNumberCache();
  const entry = cache[typeKey] || {};

  const lastNumber = Number(entry?.lastNumber || 0);
  const nextNumber =
    Number.isFinite(lastNumber) && lastNumber > 0 ? lastNumber + 1 : 1;
  const code = formatPredictedCode(entry?.lastCode, nextNumber, codserie);

  return {
    typeKey,
    nextNumber,
    code,
    hasHistory: Number.isFinite(lastNumber) && lastNumber > 0,
  };
}

function hasFastTicketPredictorHistory({ codserie, numero2, terminalId }) {
  const typeKey = getSalePrintTypeKey({ codserie, numero2, terminalId });
  const cache = getFastTicketNumberCache();
  const entry = cache[typeKey] || {};
  const lastNumber = Number(entry?.lastNumber || 0);
  return Number.isFinite(lastNumber) && lastNumber > 0;
}

function updateFastTicketNumberByConfirmedCode({
  codigo,
  codserie,
  numero2,
  idfactura,
  terminalId,
}) {
  const cache = getFastTicketNumberCache();

  const code = String(codigo || "").trim();
  const trailing = parseTrailingInteger(code);
  const fallbackId = Number(idfactura || 0);

  const confirmedNumber =
    trailing !== null ? trailing : fallbackId > 0 ? fallbackId : null;

  if (confirmedNumber === null) return;

  const upsertCacheKey = (key) => {
    const prev = cache[key] || {};
    const prevNumber = Number(prev?.lastNumber || 0);

    // Nunca retroceder numeracion si llega una confirmacion antigua
    if (Number.isFinite(prevNumber) && prevNumber > confirmedNumber) return;

    cache[key] = {
      lastNumber: confirmedNumber,
      lastCode: code || String(confirmedNumber),
      updatedAt: Date.now(),
    };
  };

  // 1) clave exacta (terminal + serie + tipo/numero2)
  const exactTypeKey = getSalePrintTypeKey({ codserie, numero2, terminalId });
  upsertCacheKey(exactTypeKey);

  // 2) clave base (terminal + serie sin tipo): usada por ventas normales
  //    Esto evita repetir numero tras reemisiones/cambios de pago con numero2 especial.
  const baseTypeKey = getSalePrintTypeKey({
    codserie,
    numero2: "",
    terminalId,
  });
  upsertCacheKey(baseTypeKey);

  setFastTicketNumberCache(cache);
}

function buildFastPreApiTicketDraft(ticketPayload, cartSnapshot) {
  const serie = String(ticketPayload?.codserie || ticketPayload?.serie || "S")
    .trim()
    .toUpperCase();
  const numero2 = String(ticketPayload?.numero2 || "").trim();
  const terminalId = String(
    ticketPayload?.idtpv || currentTerminal?.id || "",
  ).trim();

  const predicted = predictNextTicketCodeByType({
    codserie: serie,
    numero2,
    terminalId,
  });

  // Primera venta de este terminal/tipo: no preimprimir hasta tener referencia real
  if (!predicted?.hasHistory) return null;

  const total = (Array.isArray(cartSnapshot) ? cartSnapshot : []).reduce(
    (sum, item) => {
      const unit = getUnitGross(item);
      return sum + unit * (item?.qty || 1);
    },
    0,
  );

  const now = new Date();
  const fecha = formatTicketPrintDate(now);
  const hora = formatTicketPrintTimeWithSeconds(now);

  const clientName =
    (cartClientInput && (cartClientInput.value || "").trim()) || "Cliente";

  const pagos = Array.isArray(ticketPayload?._payBreakdown)
    ? ticketPayload._payBreakdown
    : Array.isArray(ticketPayload?.pagos)
      ? ticketPayload.pagos
      : [];

  const cambio = Number(ticketPayload?._payCambio ?? 0) || 0;

  const cashMeta = buildCashTicketMeta({
    pagos,
    total: Number(total || 0),
    cambio,
  });

  return {
    numero: predicted.code,
    paymentMethod: ticketPayload?.paymentMethod || "—",
    fecha,
    hora,
    total: Number(total || 0),
    terminalName: currentTerminal ? currentTerminal.name || "" : "",
    agentName: currentAgent ? currentAgent.name || "" : "",
    clientName,
    company: companyInfo ? { ...companyInfo } : null,
    lineas: Array.isArray(cartSnapshot) ? cartSnapshot : [],
    pagos,
    cambio,
    cashMeta,
    tpv_efectivo: Number(cashMeta?.cashTendered || 0),
    tpv_cambio: Number(cambio || 0),
    codserie: serie,
    numero2,
    idfactura: null,
    idtpv: terminalId || null,
    _fastPreApiPrint: true,
  };
}

function getSavedPrinterReal() {
  return localStorage.getItem(PRINTER_REAL_KEY) || "";
}
function savePrinterReal(name) {
  localStorage.setItem(PRINTER_REAL_KEY, name || "");
}
function savePrinterQueue(name) {
  localStorage.setItem(PRINTER_QUEUE_KEY, name || "");
}

function getSavedPrinterNameForUI() {
  // en UI siempre mostramos la real
  return getSavedPrinterReal();
}

async function ensurePrinterSelectedForPrint() {
  if (TPV_E2E_MODE) {
    return "E2E Mock Printer";
  }

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

  const cartDiscountToggle = document.getElementById("cartDiscountToolsToggle");
  if (cartDiscountToggle) {
    cartDiscountToggle.checked = !!cartDiscountToolsEnabled;
  }

  const safeTrainingToggle = document.getElementById("safeTrainingModeToggle");
  if (safeTrainingToggle) {
    safeTrainingToggle.checked = isSafeTrainingModeEnabled();
  }

  const stockToggle = document.getElementById("productStockToggle");
  if (stockToggle) stockToggle.checked = !!showProductStockBadge;

  const stockEditToggle = document.getElementById("productStockEditToggle");
  if (stockEditToggle) stockEditToggle.checked = !!enableProductStockEdition;

  const allowCloseParkedToggle = document.getElementById(
    "allowCloseWithParkedToggle",
  );
  if (allowCloseParkedToggle)
    allowCloseParkedToggle.checked = !!allowCloseWithParkedTickets;

  const parkStockWarningToggle = document.getElementById(
    "parkStockWarningToggle",
  );
  if (parkStockWarningToggle)
    parkStockWarningToggle.checked = !!showParkStockWarning;

  const tileResizeToggle = document.getElementById(
    "productTileResizeModeToggle",
  );
  if (tileResizeToggle) tileResizeToggle.checked = !!productTileResizeMode;

  const scaleManualToggle = document.getElementById("scaleManualCaptureToggle");
  if (scaleManualToggle) scaleManualToggle.checked = !!scaleManualCaptureMode;

  if (productSortModeSelect) {
    productSortModeSelect.value = normalizeProductSortMode(productSortMode);
  }

  if (productReorderModeToggle) {
    productReorderModeToggle.disabled = !isAdminUser();
    productReorderModeToggle.checked = isAdminUser() && !!productReorderMode;
  }

  applyInfoBarVisibilityUi?.();

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

  syncBackgroundUpdateCountdownUi();
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

    syncBackgroundUpdateCountdownUi();
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
  const cashOpen = !!cashSession?.open;

  const setOptionsReadOnlyMode = (readonly) => {
    optionsOverlay?.classList.toggle("options-readonly", !!readonly);

    // Caja cerrada: mostrar modal mínimo (acciones del footer únicamente).
    optionsOverlay?.classList.toggle("options-cash-closed-mode", !cashOpen);

    const acc = document.getElementById("optionsAccordion");
    if (acc) {
      acc.querySelectorAll(".opt-sec").forEach((sec) => {
        sec.dataset.open = "0";
      });
    }

    let note = document.getElementById("optionsReadonlyNote");
    const dialog = optionsOverlay?.querySelector(".opt-dialog");
    if (!note && dialog) {
      note = document.createElement("div");
      note.id = "optionsReadonlyNote";
      note.className = "options-readonly-note hidden";
      note.textContent = "Inicia sesión para desbloquear las opciones del TPV.";
      const head = dialog.querySelector(".opt-head");
      if (head && head.nextSibling) dialog.insertBefore(note, head.nextSibling);
      else dialog.appendChild(note);
    }

    if (note) {
      if (!cashOpen) {
        note.textContent =
          "Caja cerrada: solo están disponibles Actualizar programa y Salir del programa.";
        note.classList.remove("hidden");
      } else {
        note.textContent =
          "Inicia sesión para desbloquear las opciones del TPV.";
        note.classList.toggle("hidden", !readonly);
      }
    }
  };

  if (!cashOpen) {
    setOptionsReadOnlyMode(true);
    optionsOverlay?.classList.remove("hidden");
    return;
  }

  if (!hasActiveLoginSession()) {
    setOptionsReadOnlyMode(true);
    optionsOverlay?.classList.remove("hidden");
    return;
  }

  setOptionsReadOnlyMode(false);

  await loadPriceEditModeFromCfg?.();
  await loadProductDiscountConfig?.();
  await loadProductManualOrderConfig?.();
  await loadProductSortModeSetting?.();
  await loadProductReorderModeSetting?.();
  await loadInfoBarVisibilitySettings?.();

  applyAdminOnlyUI?.();
  refreshOptionsUI?.();
  refreshPriceEditToggleUI?.();
  bindPriceEditToggleOnce?.();

  bindCustomerDisplayToggleOnce();
  await loadCustomerDisplayToggle();

  bindProductStockToggleOnce();
  await loadProductStockToggle();

  bindProductStockEditionToggleOnce();
  await loadProductStockEditionToggle();

  bindAllowCloseWithParkedToggleOnce();
  await loadAllowCloseWithParkedToggle();

  bindCartDiscountToolsToggleOnce();
  await loadCartDiscountToolsToggle();

  bindSafeTrainingModeToggleOnce();
  await loadSafeTrainingModeToggle();

  bindParkStockWarningToggleOnce();
  await loadParkStockWarningToggle();

  bindProductTileResizeModeToggleOnce();
  await loadProductTileResizeModeToggle();

  bindScaleManualCaptureToggleOnce();
  await loadScaleManualCaptureModeToggle();

  bindProductSortModeOnce();
  bindProductReorderModeOnce();
  bindProductManualOrderResetButtonOnce();
  bindInfoBarVisibilityOnce();

  bindProductTileSizeResetButtonOnce();
  await loadProductTileSizeSetting();

  bindAutostartToggleOnce();
  await loadAutostartToggle();

  bindBackgroundUpdateOptionsOnce();
  refreshBackgroundUpdateOptionsUI();

  bindOptionsAccordionOnce();
  const st = await loadOptionsAccordionState();
  await applyOptionsAccordionState(st);

  await window.initScaleOptionsUI?.();

  bindTariffOptionsOnce();
  await loadTariffManagerOptionsData({ force: false });

  optionsOverlay?.classList.remove("hidden");
  syncBackgroundUpdateCountdownUi();
  refreshBackgroundUpdateCurrentVersionUi().catch(() => {});

  bindTerminalDefaultCustomerSave();

  await maybeRefreshTerminalDefaultCustomer("open-options", {
    minIntervalMs: 2000,
  }).catch(() => {});

  await renderTerminalDefaultCustomerSelect();
}

function closeOptions() {
  optionsOverlay?.classList.add("hidden");
  stopBackgroundUpdateCountdownUi();
}

optionsBtn?.addEventListener("click", () => openOptions());
optionsCloseX?.addEventListener("click", closeOptions);
optionsCloseBtn?.addEventListener("click", closeOptions);

optionsOverlay?.addEventListener("click", (e) => {
  if (e.target === optionsOverlay) closeOptions();
});

// ===== [09] Opciones impresora: cambiar dispositivo =====
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

// ===== [09] Opciones impresora: prueba de impresion =====
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

    await updateTpvTerminalForm(currentTerminal.id, {
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
const optionsUpdateAppBtn = document.getElementById("optionsUpdateAppBtn");

let manualUpdateActionInFlight = false;
let backgroundUpdateCheckInFlight = false;
let backgroundUpdateNoticeTimer = null;
let backgroundUpdateNoticeFirstTimer = null;
let backgroundUpdateOptionsBound = false;
let backgroundUpdateNextCheckAt = 0;
let backgroundUpdateCountdownUiTimer = null;

const BACKGROUND_UPDATE_SNOOZE_KEY = "tpv_background_update_snooze_v1";
const BACKGROUND_UPDATE_SETTINGS_KEY = "tpv_background_update_settings_v1";
const CHANGELOG_LAST_SEEN_VERSION_KEY = "tpv_changelog_last_seen_version_v1";
const CHANGELOG_SOURCE_FILE = "changelog.json";

const BACKGROUND_UPDATE_DEFAULT_SETTINGS = {
  enabled: true,
  intervalMs: 60 * 60 * 1000,
  firstDelayMs: 5 * 60 * 1000,
};

let backgroundUpdateSettings = loadBackgroundUpdateSettings();
let changelogEntriesCache = null;

function formatMsAsHumanCountdown(ms) {
  const safeMs = Math.max(0, Number(ms || 0));
  const totalSeconds = Math.ceil(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function isBackgroundUpdateSectionOpen() {
  const overlayOpen =
    !!optionsOverlay && !optionsOverlay.classList.contains("hidden");
  if (!overlayOpen) return false;

  const sec = document.querySelector(
    '#optionsAccordion .opt-sec[data-sec="actualizacion"]',
  );
  return !!sec && sec.dataset.open === "1";
}

function setBackgroundUpdateNextCheckAt(ts) {
  backgroundUpdateNextCheckAt = Number(ts || 0);
}

function paintBackgroundUpdateCountdownUi() {
  const countdownEl = document.getElementById("updateNoticeCountdownText");
  if (!countdownEl) return;

  if (backgroundUpdateSettings?.enabled === false) {
    countdownEl.textContent = "Proxima comprobacion: desactivada.";
    return;
  }

  const nextAt = Number(backgroundUpdateNextCheckAt || 0);
  if (!(nextAt > 0)) {
    countdownEl.textContent = "Proxima comprobacion: pendiente...";
    return;
  }

  const left = Math.max(0, nextAt - Date.now());
  countdownEl.textContent =
    left > 0
      ? `Proxima comprobacion: en ${formatMsAsHumanCountdown(left)}.`
      : "Proxima comprobacion: ahora...";
}

function stopBackgroundUpdateCountdownUi() {
  if (backgroundUpdateCountdownUiTimer) {
    clearInterval(backgroundUpdateCountdownUiTimer);
    backgroundUpdateCountdownUiTimer = null;
  }
}

function syncBackgroundUpdateCountdownUi() {
  if (!isBackgroundUpdateSectionOpen()) {
    stopBackgroundUpdateCountdownUi();
    return;
  }

  paintBackgroundUpdateCountdownUi();

  if (!backgroundUpdateCountdownUiTimer) {
    backgroundUpdateCountdownUiTimer = setInterval(() => {
      paintBackgroundUpdateCountdownUi();
    }, 1000);
  }
}

async function getCurrentAppVersionText() {
  try {
    const r = await window.TPV_SYS?.getVersion?.();
    const v = String(r?.version || "").trim();
    return r?.ok && v ? `v${v}` : "desconocida";
  } catch {
    return "desconocida";
  }
}

function normalizeVersionTag(versionText) {
  return String(versionText || "")
    .trim()
    .replace(/^v/i, "");
}

async function loadChangelogEntries() {
  if (Array.isArray(changelogEntriesCache)) return changelogEntriesCache;

  try {
    const url = `${CHANGELOG_SOURCE_FILE}?_=${Date.now()}`;
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      changelogEntriesCache = [];
      return changelogEntriesCache;
    }

    const json = await resp.json();
    const versions = Array.isArray(json?.versions) ? json.versions : [];

    changelogEntriesCache = versions
      .map((it) => ({
        version: normalizeVersionTag(it?.version),
        date: String(it?.date || "").trim(),
        title: String(it?.title || "").trim(),
        changes: Array.isArray(it?.changes)
          ? it.changes.map((x) => String(x || "").trim()).filter(Boolean)
          : [],
      }))
      .filter((it) => !!it.version);
  } catch {
    changelogEntriesCache = [];
  }

  return changelogEntriesCache;
}

function buildChangelogMessage(entries, { onlyVersion = "" } = {}) {
  const normalizedOnly = normalizeVersionTag(onlyVersion);
  const source = Array.isArray(entries) ? entries : [];
  const list = normalizedOnly
    ? source.filter((it) => normalizeVersionTag(it?.version) === normalizedOnly)
    : source;

  if (!list.length) {
    return normalizedOnly
      ? `No hay notas de cambios registradas para la version v${normalizedOnly}.`
      : "No hay changelog registrado todavia.";
  }

  const chunks = list.map((it) => {
    const v = normalizeVersionTag(it?.version);
    const d = String(it?.date || "").trim();
    const t = String(it?.title || "").trim();
    const head = [`Version v${v}`, d ? `(${d})` : "", t ? `- ${t}` : ""]
      .filter(Boolean)
      .join(" ");

    const changes = Array.isArray(it?.changes) ? it.changes : [];
    const lines = changes.length
      ? changes.map((c) => `- ${c}`).join("\n")
      : "- Sin detalle de cambios.";

    return `${head}\n${lines}`;
  });

  return chunks.join("\n\n");
}

async function openChangelogDialog({ onlyCurrentVersion = false } = {}) {
  const entries = await loadChangelogEntries();
  const currentVersion = normalizeVersionTag(await getCurrentAppVersionText());
  const onlyVersion = onlyCurrentVersion ? currentVersion : "";
  const text = buildChangelogMessage(entries, { onlyVersion });

  showMessageModal("Changelog", text);
}

async function maybeShowChangelogAfterUpdate() {
  const currentVersion = normalizeVersionTag(await getCurrentAppVersionText());
  if (!currentVersion || currentVersion === "desconocida") return;

  let lastSeenVersion = "";
  try {
    lastSeenVersion = normalizeVersionTag(
      localStorage.getItem(CHANGELOG_LAST_SEEN_VERSION_KEY) || "",
    );
  } catch {}

  if (lastSeenVersion === currentVersion) return;

  await openChangelogDialog({ onlyCurrentVersion: true });

  try {
    localStorage.setItem(CHANGELOG_LAST_SEEN_VERSION_KEY, currentVersion);
  } catch {}
}

async function refreshBackgroundUpdateCurrentVersionUi() {
  const versionEl = document.getElementById("updateNoticeCurrentVersionText");
  if (!versionEl) return;
  const currentVersion = await getCurrentAppVersionText();
  versionEl.textContent = `Version actual: ${currentVersion}`;
}

function normalizeBackgroundUpdateSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};

  const intervalAllowed = new Set([30, 60, 120, 240].map((m) => m * 60 * 1000));
  const intervalCandidate = Number(src.intervalMs || 0);

  return {
    enabled: src.enabled !== false,
    intervalMs: intervalAllowed.has(intervalCandidate)
      ? intervalCandidate
      : BACKGROUND_UPDATE_DEFAULT_SETTINGS.intervalMs,
    firstDelayMs: BACKGROUND_UPDATE_DEFAULT_SETTINGS.firstDelayMs,
  };
}

function loadBackgroundUpdateSettings() {
  try {
    const raw = localStorage.getItem(BACKGROUND_UPDATE_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeBackgroundUpdateSettings(parsed);
  } catch {
    return { ...BACKGROUND_UPDATE_DEFAULT_SETTINGS };
  }
}

function saveBackgroundUpdateSettings(partial = {}) {
  const next = normalizeBackgroundUpdateSettings({
    ...backgroundUpdateSettings,
    ...(partial || {}),
  });

  backgroundUpdateSettings = next;

  try {
    localStorage.setItem(BACKGROUND_UPDATE_SETTINGS_KEY, JSON.stringify(next));
  } catch {}

  return next;
}

function getBackgroundUpdateSnoozeState() {
  try {
    const raw = localStorage.getItem(BACKGROUND_UPDATE_SNOOZE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setBackgroundUpdateSnooze(
  version,
  ms = BACKGROUND_UPDATE_DEFAULT_SETTINGS.intervalMs,
) {
  try {
    const fallbackMs = Number(backgroundUpdateSettings?.intervalMs || 0);
    const until = Date.now() + Math.max(60_000, Number(ms || fallbackMs || 0));
    const payload = {
      version: String(version || "").trim(),
      until,
      savedAt: Date.now(),
    };
    localStorage.setItem(BACKGROUND_UPDATE_SNOOZE_KEY, JSON.stringify(payload));
  } catch {}
}

function isBackgroundUpdateSnoozed(version) {
  const state = getBackgroundUpdateSnoozeState();
  const until = Number(state?.until || 0);
  const target = String(version || "").trim();
  const savedVersion = String(state?.version || "").trim();

  if (!(until > Date.now())) return false;
  if (!savedVersion) return true;
  if (!target) return true;
  return savedVersion === target;
}

function ensureBackgroundUpdateNoticeUi() {
  let root = document.getElementById("updatePassiveNotice");
  if (root) return root;

  if (!document.getElementById("updatePassiveNoticeStyle")) {
    const style = document.createElement("style");
    style.id = "updatePassiveNoticeStyle";
    style.textContent = `
      .update-passive-notice {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 1200;
        max-width: min(420px, calc(100vw - 24px));
        background: #ffffff;
        border: 1px solid #cfe0ff;
        border-radius: 14px;
        box-shadow: 0 10px 28px rgba(17, 24, 39, 0.20);
        color: #102046;
        padding: 12px 14px;
        display: none;
      }

      .update-passive-notice.is-visible {
        display: block;
      }

      .update-passive-title {
        font-weight: 800;
        font-size: 14px;
        margin-bottom: 4px;
      }

      .update-passive-text {
        font-size: 13px;
        line-height: 1.35;
        margin-bottom: 10px;
      }

      .update-passive-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      .update-passive-btn {
        border: 1px solid #2d5de7;
        border-radius: 999px;
        background: #ffffff;
        color: #1f4fd0;
        font-size: 12px;
        font-weight: 700;
        padding: 6px 10px;
        cursor: pointer;
      }

      .update-passive-btn.primary {
        background: #2d5de7;
        color: #ffffff;
      }
    `;
    document.head.appendChild(style);
  }

  root = document.createElement("div");
  root.id = "updatePassiveNotice";
  root.className = "update-passive-notice";
  root.innerHTML = `
    <div class="update-passive-title">Nueva versión disponible</div>
    <div class="update-passive-text" id="updatePassiveNoticeText"></div>
    <div class="update-passive-actions">
      <button type="button" class="update-passive-btn" id="updatePassiveNoticeLaterBtn">Más tarde</button>
      <button type="button" class="update-passive-btn primary" id="updatePassiveNoticeNowBtn">Actualizar</button>
    </div>
  `;

  document.body.appendChild(root);

  const nowBtn = document.getElementById("updatePassiveNoticeNowBtn");
  const laterBtn = document.getElementById("updatePassiveNoticeLaterBtn");

  nowBtn?.addEventListener("click", async () => {
    root.classList.remove("is-visible");
    await startManualUpdateFlowFromOptions();
  });

  laterBtn?.addEventListener("click", () => {
    const targetVersion = String(root.dataset.targetVersion || "").trim();
    setBackgroundUpdateSnooze(targetVersion);
    root.classList.remove("is-visible");
    toast(
      "Recordatorio pospuesto hasta la siguiente comprobación.",
      "info",
      "Actualización",
    );
  });

  return root;
}

function showBackgroundUpdateNotice({ targetVersion = "" } = {}) {
  const root = ensureBackgroundUpdateNoticeUi();
  const textEl = document.getElementById("updatePassiveNoticeText");
  const verTxt = String(targetVersion || "").trim();

  root.dataset.targetVersion = verTxt;
  if (textEl) {
    textEl.textContent = verTxt
      ? `Versión detectada: ${verTxt}. Puedes actualizar cuando te venga bien.`
      : "Hay una versión nueva lista para instalar.";
  }

  root.classList.add("is-visible");
}

function hideBackgroundUpdateNotice() {
  const root = document.getElementById("updatePassiveNotice");
  if (!root) return;
  root.classList.remove("is-visible");
}

async function runBackgroundUpdateAvailabilityCheck(reason = "timer") {
  if (manualUpdateActionInFlight || backgroundUpdateCheckInFlight)
    return { ok: false, skipped: "busy" };
  if (!backgroundUpdateSettings?.enabled)
    return { ok: false, skipped: "disabled" };

  const updaterApi = window.TPV_UPDATER;
  if (!updaterApi?.checkNow) return { ok: false, skipped: "api-unavailable" };

  backgroundUpdateCheckInFlight = true;
  try {
    const check = await updaterApi.checkNow();
    if (!check?.ok) return check;

    if (check?.devMode) return check;

    if (!check?.updateAvailable) {
      hideBackgroundUpdateNotice();
      return check;
    }

    const targetVersion = String(check?.targetVersion || "").trim();
    if (isBackgroundUpdateSnoozed(targetVersion)) return;

    showBackgroundUpdateNotice({ targetVersion });
    console.info(
      `[UPDATE-PASSIVE] update available (${targetVersion || "unknown"}) via ${reason}`,
    );
    return check;
  } catch (e) {
    console.warn("[UPDATE-PASSIVE] check failed:", e?.message || e);
    return { ok: false, message: e?.message || "check-failed" };
  } finally {
    backgroundUpdateCheckInFlight = false;
  }
}

function refreshBackgroundUpdateOptionsUI() {
  const enabledToggle = document.getElementById("updateNoticeEnabledToggle");
  const intervalSelect = document.getElementById("updateNoticeIntervalSelect");
  const checkNowBtn = document.getElementById("updateNoticeCheckNowBtn");

  if (enabledToggle) {
    enabledToggle.checked = backgroundUpdateSettings?.enabled !== false;
  }

  if (intervalSelect) {
    intervalSelect.value = String(
      Number(backgroundUpdateSettings?.intervalMs || 0) ||
        BACKGROUND_UPDATE_DEFAULT_SETTINGS.intervalMs,
    );
    intervalSelect.disabled = backgroundUpdateSettings?.enabled === false;
  }

  if (checkNowBtn) {
    checkNowBtn.disabled = backgroundUpdateSettings?.enabled === false;
  }

  syncBackgroundUpdateCountdownUi();
  refreshBackgroundUpdateCurrentVersionUi().catch(() => {});
}

function bindBackgroundUpdateOptionsOnce() {
  if (backgroundUpdateOptionsBound) return;
  backgroundUpdateOptionsBound = true;

  const enabledToggle = document.getElementById("updateNoticeEnabledToggle");
  const intervalSelect = document.getElementById("updateNoticeIntervalSelect");
  const checkNowBtn = document.getElementById("updateNoticeCheckNowBtn");
  const changelogBtn = document.getElementById("updateNoticeChangelogBtn");

  enabledToggle?.addEventListener("change", () => {
    const next = saveBackgroundUpdateSettings({
      enabled: !!enabledToggle.checked,
    });

    if (next.enabled) {
      startBackgroundUpdateMonitor();
      runBackgroundUpdateAvailabilityCheck("toggle-enable").catch(() => {});
      toast("Avisos automáticos de actualización activados.", "ok", "Opciones");
    } else {
      stopBackgroundUpdateMonitor();
      hideBackgroundUpdateNotice();
      toast(
        "Avisos automáticos de actualización desactivados.",
        "info",
        "Opciones",
      );
    }

    refreshBackgroundUpdateOptionsUI();
  });

  intervalSelect?.addEventListener("change", () => {
    const intervalMs = Number(intervalSelect.value || 0);
    saveBackgroundUpdateSettings({ intervalMs });

    if (backgroundUpdateSettings?.enabled) {
      startBackgroundUpdateMonitor();
    }

    refreshBackgroundUpdateOptionsUI();
    toast("Frecuencia de aviso de actualización guardada.", "ok", "Opciones");
  });

  checkNowBtn?.addEventListener("click", async () => {
    if (!backgroundUpdateSettings?.enabled) return;

    checkNowBtn.disabled = true;
    checkNowBtn.textContent = "Comprobando...";

    try {
      const check =
        await runBackgroundUpdateAvailabilityCheck("options-check-now");
      const currentVersionRaw = String(
        check?.currentVersion || (await getCurrentAppVersionText()),
      ).trim();
      const currentVersion = currentVersionRaw
        ? currentVersionRaw.replace(/^v/i, "")
        : "?";

      if (check?.ok && check?.updateAvailable) {
        const targetVersion = String(check?.targetVersion || "").trim();
        toast(
          `Estas en v${currentVersion}. Hay una nueva version ${targetVersion ? `v${targetVersion}` : "disponible"}.`,
          "info",
          "Actualización",
        );
      } else if (check?.ok) {
        toast(
          `Estas en v${currentVersion}. Ya tienes la version mas reciente.`,
          "ok",
          "Actualización",
        );
      } else {
        const msg = String(
          check?.message || "No se pudo completar la comprobacion.",
        );
        toast(msg, "err", "Actualización");
      }
    } finally {
      checkNowBtn.disabled = false;
      checkNowBtn.textContent = "Comprobar";
      refreshBackgroundUpdateOptionsUI();
    }
  });

  changelogBtn?.addEventListener("click", async () => {
    await openChangelogDialog({ onlyCurrentVersion: false });
  });
}

function startBackgroundUpdateMonitor() {
  stopBackgroundUpdateMonitor();

  if (!backgroundUpdateSettings?.enabled) {
    setBackgroundUpdateNextCheckAt(0);
    syncBackgroundUpdateCountdownUi();
    return;
  }

  const run = (reason) => {
    runBackgroundUpdateAvailabilityCheck(reason).catch(() => {});
  };

  const firstDelayMs = Number(backgroundUpdateSettings?.firstDelayMs || 0);
  const intervalMs = Number(backgroundUpdateSettings?.intervalMs || 0);

  setBackgroundUpdateNextCheckAt(Date.now() + Math.max(1000, firstDelayMs));
  syncBackgroundUpdateCountdownUi();

  backgroundUpdateNoticeFirstTimer = setTimeout(() => {
    setBackgroundUpdateNextCheckAt(Date.now() + Math.max(1000, intervalMs));
    syncBackgroundUpdateCountdownUi();
    run("first-delay");
  }, firstDelayMs);

  backgroundUpdateNoticeTimer = setInterval(() => {
    setBackgroundUpdateNextCheckAt(Date.now() + Math.max(1000, intervalMs));
    syncBackgroundUpdateCountdownUi();
    run("interval");
  }, intervalMs);
}

function stopBackgroundUpdateMonitor() {
  if (backgroundUpdateNoticeFirstTimer) {
    clearTimeout(backgroundUpdateNoticeFirstTimer);
    backgroundUpdateNoticeFirstTimer = null;
  }
  if (backgroundUpdateNoticeTimer) {
    clearInterval(backgroundUpdateNoticeTimer);
    backgroundUpdateNoticeTimer = null;
  }

  setBackgroundUpdateNextCheckAt(0);
  syncBackgroundUpdateCountdownUi();
}

function runUpdateRelaunchCountdown({ seconds = 5, targetVersion = "" } = {}) {
  const overlay = document.getElementById("msgOverlay");
  const titleEl = document.getElementById("msgTitle");
  const textEl = document.getElementById("msgText");
  const okBtn = document.getElementById("msgOkBtn");
  const cancelBtn = document.getElementById("msgCancelBtn");
  const midBtn = document.getElementById("msgMidBtn");

  if (!overlay || !titleEl || !textEl || !okBtn || !cancelBtn) {
    const ask = window.confirm(
      "Nueva versión encontrada. El programa se cerrará y abrirá de nuevo para actualizar. ¿Continuar?",
    );
    return Promise.resolve(!!ask);
  }

  const safeSeconds = Math.max(1, Number(seconds) || 5);
  const verTxt = String(targetVersion || "").trim();

  titleEl.textContent = "Actualizar programa";
  okBtn.textContent = "Cerrar ahora";
  cancelBtn.textContent = "Cancelar";
  if (midBtn) midBtn.classList.add("hidden");

  overlay.classList.remove("hidden");
  lockAppUI();

  return new Promise((resolve) => {
    let closed = false;
    let left = safeSeconds;
    let timer = null;

    const paint = () => {
      const verLine = verTxt ? `Versión nueva: ${verTxt}\n` : "";
      textEl.textContent =
        `${verLine}Cerrando el programa en ${left}s para actualizar.\n` +
        "Puedes cancelar si quieres seguir trabajando.";
      textEl.style.whiteSpace = "pre-line";
    };

    const cleanup = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      window.removeEventListener("keydown", onKey);
      overlay.classList.add("hidden");
      unlockAppUI();
    };

    const finish = (accept) => {
      if (closed) return;
      closed = true;
      cleanup();
      resolve(!!accept);
    };

    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
      if (e.key === "Enter") finish(true);
    };

    window.addEventListener("keydown", onKey);
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);

    paint();
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        finish(true);
        return;
      }
      paint();
    }, 1000);
  });
}

async function startManualUpdateFlowFromOptions() {
  if (manualUpdateActionInFlight) return;
  manualUpdateActionInFlight = true;

  try {
    const ok = await confirmModal(
      "Actualizar programa",
      "Se comprobará si hay una nueva versión.\nSi existe, el TPV se cerrará y se abrirá automáticamente sin perder el estado.",
    );
    if (!ok) return;

    closeOptions?.();

    const updaterApi = window.TPV_UPDATER;
    if (!updaterApi?.checkNow || !updaterApi?.relaunchForUpdate) {
      showMessageModal(
        "Actualizar programa",
        "Esta versión no tiene disponible la API de actualización manual.",
      );
      return;
    }

    const check = await updaterApi.checkNow();

    if (!check?.ok) {
      const msg = String(
        check?.message || "No se pudo comprobar si hay actualizaciones.",
      );
      showMessageModal("Actualizar programa", msg);
      return;
    }

    if (!check?.updateAvailable) {
      showMessageModal(
        "Actualizar programa",
        String(check?.message || "Estás en la versión más reciente."),
      );
      return;
    }

    if (check?.devMode) {
      const currentV = String(check?.currentVersion || "").trim();
      const targetV = String(check?.targetVersion || "").trim();
      const repo = String(check?.githubRepo || "").trim();
      const tag = String(check?.githubTag || "").trim();

      const details = [
        String(check?.message || "Simulación de actualización en npm start."),
        currentV ? `Versión actual: ${currentV}` : "",
        targetV ? `Versión detectada en GitHub: ${targetV}` : "",
        repo ? `Repositorio: ${repo}` : "",
        tag ? `Tag: ${tag}` : "",
        check?.wouldDownload
          ? "Resultado: en app instalada, sí se descargaría e instalaría."
          : "Resultado: en app instalada, no descargaría actualización ahora.",
      ]
        .filter(Boolean)
        .join("\n");

      if (!check?.wouldDownload) {
        showMessageModal("Actualizar programa (simulación)", details);
        return;
      }

      const doSimulated = await confirmModal(
        "Actualizar programa (simulación)",
        `${details}\n\n¿Quieres simular ahora el cierre y reapertura para validar recuperación de estado?`,
      );

      if (!doSimulated) return;

      const proceedSim = await runUpdateRelaunchCountdown({
        seconds: 5,
        targetVersion: targetV,
      });

      if (!proceedSim) {
        toast(
          "Simulación de actualización cancelada.",
          "info",
          "Actualizar programa",
        );
        return;
      }

      persistRuntimeCartSnapshot({ force: true });

      const relaunchSim = await updaterApi.relaunchForUpdate();
      if (!relaunchSim?.ok) {
        showMessageModal(
          "Actualizar programa (simulación)",
          String(
            relaunchSim?.message ||
              "No se pudo reiniciar el programa en simulación.",
          ),
        );
      }
      return;
    }

    const proceed = await runUpdateRelaunchCountdown({
      seconds: 5,
      targetVersion: check?.targetVersion || "",
    });

    if (!proceed) {
      toast("Actualización cancelada.", "info", "Actualizar programa");
      return;
    }

    // Reutilizamos la misma persistencia ante cierre inesperado.
    persistRuntimeCartSnapshot({ force: true });

    const relaunch = await updaterApi.relaunchForUpdate();
    if (!relaunch?.ok) {
      showMessageModal(
        "Actualizar programa",
        String(relaunch?.message || "No se pudo reiniciar el programa."),
      );
      return;
    }
  } catch (e) {
    console.warn("[UPDATE-MANUAL]", e?.message || e);
    showMessageModal(
      "Actualizar programa",
      "Ha ocurrido un error al preparar la actualización.",
    );
  } finally {
    manualUpdateActionInFlight = false;
  }
}

optionsUpdateAppBtn?.addEventListener("click", () => {
  startManualUpdateFlowFromOptions();
});

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

  const doPost = async (params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Token: cfg.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const rawText = await res.text().catch(() => "");
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = null;
    }

    return { res, data, rawText };
  };

  const canRetryWithoutNumero2 = (params, submit) => {
    const n2 = String(params?.get?.("numero2") || "").trim();
    if (!n2) return false;

    // Mantener numero2 especiales de flujos internos (refund/paychg) para no romper trazabilidad.
    if (n2.includes("|")) return false;

    const status = Number(submit?.res?.status || 0);
    if (![400, 409, 422, 500].includes(status)) return false;

    const details = [
      String(submit?.data?.message || ""),
      typeof submit?.data?.errors === "string"
        ? submit.data.errors
        : JSON.stringify(submit?.data?.errors || ""),
      String(submit?.rawText || ""),
    ]
      .join(" ")
      .toLowerCase();

    return (
      details.includes("numero2") ||
      details.includes("duplicate") ||
      details.includes("duplicad") ||
      details.includes("repetid") ||
      details.includes("ya existe") ||
      details.includes("unique") ||
      details.includes("constraint")
    );
  };

  let submit = await doPost(bodyParams);

  const isTotals422 =
    submit.res.status === 422 &&
    String(submit.data?.message || "")
      .trim()
      .toLowerCase() === "error-calculating-totals";

  if (isTotals422) {
    const hasProductBoundLine = (
      Array.isArray(ticketPayload.lineas) ? ticketPayload.lineas : []
    ).some((l) => l?.idproducto != null || String(l?.referencia || "").trim());

    if (hasProductBoundLine) {
      const cleanLines = (
        Array.isArray(ticketPayload.lineas) ? ticketPayload.lineas : []
      ).map((l) => {
        const next = { ...l };
        delete next.idproducto;
        delete next.referencia;
        return next;
      });

      const retryParams = new URLSearchParams(bodyParams.toString());
      retryParams.set("lineas", JSON.stringify(cleanLines));

      console.warn(
        "[crearFacturaCliente] 422 error-calculating-totals. Reintentando sin idproducto/referencia...",
      );
      console.log(
        ">>> Enviando a crearFacturaCliente [retry-lineas-sin-idproducto-referencia]:",
        retryParams.toString(),
      );

      submit = await doPost(retryParams);
    }
  }

  if (!submit.res.ok && canRetryWithoutNumero2(bodyParams, submit)) {
    const retryNoNumero2 = new URLSearchParams(bodyParams.toString());
    retryNoNumero2.delete("numero2");

    console.warn(
      "[crearFacturaCliente] Posible conflicto de numero2. Reintentando sin numero2...",
    );
    console.log(
      ">>> Enviando a crearFacturaCliente [retry-sin-numero2]:",
      retryNoNumero2.toString(),
    );

    submit = await doPost(retryNoNumero2);
  }

  if (submit.res.status === 429) {
    console.error(
      "Error 429 crearFacturaCliente:",
      submit.rawText || submit.data,
    );
    throw new Error(
      "La API ha devuelto 429 (demasiadas peticiones). " +
        "Es un bloqueo temporal por seguridad; espera unos minutos antes de seguir usando el TPV.",
    );
  }

  if (!submit.res.ok) {
    let msg = `Error HTTP ${submit.res.status}`;
    if (submit.data && typeof submit.data === "object") {
      console.error("Respuesta de error crearFacturaCliente:", submit.data);
      if (submit.data.message) msg += `: ${submit.data.message}`;
      if (submit.data.errors)
        msg += " | Detalles: " + JSON.stringify(submit.data.errors);
    } else if (submit.rawText) {
      msg += `: ${submit.rawText}`;
    }
    throw new Error(msg);
  }

  const data = submit.data;
  if (!data || typeof data !== "object") {
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
    apiResponse?.doc ||
    apiResponse?.factura ||
    apiResponse?.data ||
    apiResponse ||
    {};

  const safePayload = ticketPayload || {};

  const paymentMethod =
    factura.formapago ||
    factura.metodopago ||
    factura.codpago ||
    factura.codpago_desc ||
    safePayload.paymentMethod ||
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

  const selectedCustomer = getSelectedCustomerPrintMeta();

  // Fallback final: input visual del carrito.
  const clientName =
    selectedCustomer.clientName ||
    (cartClientInput && (cartClientInput.value || "").trim()) ||
    "Cliente";

  return {
    numero,
    paymentMethod,
    fecha: factura.fecha || safePayload.fecha,
    hora: factura.hora || safePayload.hora,
    total: totalFromFactura !== null ? totalFromFactura : totalFromCart,

    // ✅ mejor guardar el estado real en el ticket (por si luego cierras caja)
    terminalName: currentTerminal ? currentTerminal.name || "" : "",
    agentName: currentAgent ? currentAgent.name || "" : "",

    codcliente: selectedCustomer.codcliente,
    clientName,
    clientFiscalId: selectedCustomer.clientFiscalId,
    clientAddress: selectedCustomer.clientAddress,
    isDefaultCustomer: selectedCustomer.isDefaultCustomer,
    company: companyInfo ? { ...companyInfo } : null,
    lineas: cartSnapshot,
    codserie:
      factura.codserie || safePayload.codserie || safePayload.serie || null,
    numero2: factura.numero2 || safePayload.numero2 || null,
    idfactura: factura.idfactura || factura.id || null,
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
  const direct = parseQtyValue(l?.taxRate, 0);
  if (isFinite(direct) && direct > 0) return direct;

  const fromCode = parseQtyValue(extractTaxRateFromCode(l?.codimpuesto), 0);
  if (isFinite(fromCode) && fromCode > 0) return fromCode;

  return 0;
}

function getUnitGrossForPrint(l) {
  if (l && typeof l.__forceUnitGross === "number")
    return parseQtyValue(l.__forceUnitGross, 0);

  // Preimpresión (snapshot carrito): calcular siempre el bruto final dinámico.
  const hasFsMoneyShape =
    l?.idlinea != null || typeof l?.pvpunitario !== "undefined";
  if (!hasFsMoneyShape) {
    try {
      const dynamicGross = Number(getUnitGross?.(l));
      if (isFinite(dynamicGross) && dynamicGross > 0) return dynamicGross;
    } catch {}
  }

  if (l && l.grossPriceOverride != null)
    return parseQtyValue(l.grossPriceOverride, 0);
  if (l?.grossPrice != null) return parseQtyValue(l.grossPrice, 0);

  if (l?.price != null) {
    const tax = getTaxRateForLine(l);
    return parseQtyValue(l.price, 0) * (1 + tax / 100);
  }

  if (typeof l.pvpunitario !== "undefined") {
    const tax = getTaxRateForLine(l);
    return parseQtyValue(l.pvpunitario, 0) * (1 + tax / 100);
  }

  return 0;
}

function getCatalogBaseUnitGrossForProductId(productId) {
  const pid = Number(productId || 0);
  if (!pid || !Array.isArray(products) || !products.length) return 0;

  const product = products.find(
    (p) => Number(getProductBaseId(p) || 0) === pid,
  );
  if (!product) return 0;

  try {
    const cartLike = buildCartLine(product, 1);
    const gross = Number(cartLike?.grossPrice || cartLike?.price || 0);
    return isFinite(gross) && gross > 0 ? gross : 0;
  } catch {
    return 0;
  }
}

function getPrintableLinePricingBreakdown(line) {
  const qty = parseQtyValue(line?.qty ?? line?.cantidad, 0);
  const absQty = Math.abs(qty);
  const taxRate = getTaxRateForLine(line);
  const taxFactor = 1 + taxRate / 100;

  const finalUnitGross = parseQtyValue(getUnitGrossForPrint(line), 0);
  let baseUnitGross = parseQtyValue(line?.__baseUnitGrossHint, NaN);
  if (!isFinite(baseUnitGross) || baseUnitGross <= 0) {
    baseUnitGross = finalUnitGross;
  }

  // Histórico FS: priorizar campos explícitos sin descuento / total final.
  const totalNetNoDiscount = parseQtyValue(line?.pvpsindto, NaN);
  const totalNetFinal = parseQtyValue(line?.pvptotal, NaN);
  if (
    absQty > 0 &&
    isFinite(totalNetNoDiscount) &&
    isFinite(totalNetFinal) &&
    totalNetNoDiscount > totalNetFinal + 0.0001
  ) {
    const baseUnitNet = totalNetNoDiscount / absQty;
    baseUnitGross = baseUnitNet * taxFactor;
  } else {
    const fsDiscountFields = [
      line?.dtopor,
      line?.dtopor1,
      line?.dtopor2,
      line?.dtopor3,
      line?.dtopor4,
    ]
      .map((v) => parseQtyValue(v, 0))
      .filter((v) => isFinite(v) && v > 0 && v < 100);

    if (fsDiscountFields.length) {
      const finalFactor = fsDiscountFields.reduce(
        (acc, pct) => acc * (1 - pct / 100),
        1,
      );
      if (finalFactor > 0.000001 && finalFactor < 0.999999) {
        baseUnitGross = finalUnitGross / finalFactor;
      }
    }

    // Carrito actual/pre-ticket: usar pricing en vivo para obtener base real.
    if (!(baseUnitGross > finalUnitGross + 0.0001)) {
      try {
        const pricing = getCartLinePricing?.(line);
        const candidate = Number(pricing?.baseUnitGross || 0);
        if (isFinite(candidate) && candidate > 0) baseUnitGross = candidate;
      } catch {}
    }

    if (!(baseUnitGross > finalUnitGross + 0.0001)) {
      const catalogBase = getCatalogBaseUnitGrossForProductId(
        line?.idproducto || line?.id || line?.baseProductId,
      );
      if (catalogBase > finalUnitGross + 0.0001) {
        baseUnitGross = catalogBase;
      }
    }
  }

  const baseUnit = round2(baseUnitGross);
  const finalUnit = round2(finalUnitGross);
  const discountPerUnit = Math.max(0, round2(baseUnit - finalUnit));
  const discountTotal = round2(discountPerUnit * absQty);
  const hasDiscount = discountPerUnit > 0.0001;

  return {
    qty,
    absQty,
    baseUnitGross: baseUnit,
    finalUnitGross: finalUnit,
    discountPerUnit,
    discountTotal,
    hasDiscount,
  };
}

function getPrintableLineDiscountType(line, pricing = null) {
  const p = pricing || getPrintableLinePricingBreakdown(line);
  if (!p?.hasDiscount) return "";

  const hint = String(line?.__discountTypeHint || "").trim();
  if (hint) return hint;

  try {
    const cartPricing = getCartLinePricing?.(line);
    if (cartPricing?.manualPriceLocked) return "Manual";
    if (cartPricing?.cartDiscountApplied) {
      return cartPricing?.cartDiscountSource === "line"
        ? "Dto linea"
        : "Dto general";
    }
    if (cartPricing?.tariffApplied) return "Tarifa";
  } catch {}

  const fsDiscountFields = [
    line?.dtopor,
    line?.dtopor1,
    line?.dtopor2,
    line?.dtopor3,
    line?.dtopor4,
  ]
    .map((v) => parseQtyValue(v, 0))
    .filter((v) => isFinite(v) && v > 0 && v < 100);

  if (fsDiscountFields.length) return "Descuento";
  return "Descuento";
}

function calcPrintableDiscountTotal(lineas) {
  let total = 0;
  for (const line of Array.isArray(lineas) ? lineas : []) {
    if (isPackChildForPrint(line)) continue;
    const b = getPrintableLinePricingBreakdown(line);
    total += Number(b?.discountTotal || 0);
  }
  return round2(total);
}

function attachPrintableDiscountHintsFromSnapshot(
  fsMappedLines,
  snapshotLines,
) {
  const fs = Array.isArray(fsMappedLines) ? fsMappedLines : [];
  const snap = Array.isArray(snapshotLines) ? snapshotLines : [];
  if (!fs.length || !snap.length) return fs;

  const normalize = (v) =>
    String(v || "")
      .trim()
      .replace(/^DEV\s*-\s*/i, "")
      .replace(/\s+/g, " ")
      .toUpperCase();

  const available = snap
    .map((line, idx) => ({ line, idx, used: false }))
    .filter((x) => !isPackChildForPrint(x.line));

  const out = fs.map((line) => ({ ...line }));

  out.forEach((row) => {
    const fsQty = Math.abs(parseQtyValue(row?.cantidad ?? row?.qty, 0));
    const fsUnit = round2(Number(getUnitGrossForPrint(row) || 0));
    const fsRef = normalize(row?.referencia);
    const fsDesc = normalize(row?.descripcion);

    let best = null;
    let bestScore = -1;

    for (const c of available) {
      if (c.used) continue;
      const qty = Math.abs(parseQtyValue(c.line?.qty ?? c.line?.cantidad, 0));
      if (Math.abs(qty - fsQty) > 0.001) continue;

      const unit = round2(Number(getUnitGross(c.line) || 0));
      if (Math.abs(unit - fsUnit) > 0.02) continue;

      let score = 0;
      const snapRef = normalize(c.line?.referencia || c.line?.name);
      const snapDesc = normalize(c.line?.descripcion || c.line?.secondaryName);
      if (fsRef && snapRef && fsRef === snapRef) score += 2;
      if (fsDesc && snapDesc && fsDesc === snapDesc) score += 1;

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (!best) return;

    const pricing = getCartLinePricing(best.line);
    if (
      pricing?.anyPricingAdjustment &&
      Number(pricing?.baseUnitGross || 0) > Number(pricing?.unitGross || 0)
    ) {
      row.__baseUnitGrossHint = Number(pricing.baseUnitGross || 0);

      if (pricing?.manualPriceLocked) {
        row.__discountTypeHint = "Manual";
      } else if (pricing?.cartDiscountApplied) {
        row.__discountTypeHint =
          pricing?.cartDiscountSource === "line" ? "Dto linea" : "Dto general";
      } else if (pricing?.tariffApplied) {
        row.__discountTypeHint = "Tarifa";
      } else {
        row.__discountTypeHint = "Descuento";
      }
    }

    best.used = true;
  });

  return out;
}

function calcTotalsAndTaxMap(lineas, totalsOnlyPositive) {
  let totalToShow = 0;
  const taxMap = {}; // { rate: { base, iva } }

  for (const l of lineas || []) {
    const qty = parseQtyValue(l.qty ?? l.cantidad, 1);

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

function enrichPrintableLineLabels(lineas) {
  const rows = Array.isArray(lineas) ? lineas : [];
  if (!rows.length) return rows;

  return rows.map((row) => {
    const r = row && typeof row === "object" ? { ...row } : row;
    if (!r || typeof r !== "object") return r;

    const mainCandidate = String(
      r.ref ??
        r.referencia ??
        r.codigo ??
        r.codarticulo ??
        r.sku ??
        r.name ??
        r.nombre ??
        "",
    ).trim();

    const descCandidate = String(
      r.secondaryName ?? r.descripcion2 ?? r.detalle ?? r.descripcion ?? "",
    ).trim();

    // Si ya tenemos nombre o descripción útiles, no tocamos nada.
    if (mainCandidate || descCandidate) return r;

    const productId =
      Number(r.idproducto || r.baseProductId || r.id || r.idarticulo || 0) || 0;

    if (!productId || !Array.isArray(products) || !products.length) return r;

    const source = products.find(
      (p) =>
        Number(p?.id || p?.idproducto || p?.baseProductId || 0) === productId,
    );

    if (!source) return r;

    const fallbackName = String(
      source?.referencia ||
        source?.name ||
        source?.nombre ||
        source?.descripcion ||
        "",
    ).trim();
    const fallbackDesc = String(
      source?.descripcion ||
        source?.descripcion2 ||
        source?.secondaryName ||
        "",
    ).trim();

    if (fallbackName && !String(r.name || r.nombre || "").trim()) {
      r.name = fallbackName;
    }

    if (fallbackDesc && !String(r.descripcion || r.descripcion2 || "").trim()) {
      r.descripcion = fallbackDesc;
    }

    return r;
  });
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
    const n = parseQtyValue(q, 0);
    return isNaN(n) ? 0 : n;
  };

  const arr = Array.isArray(lineas) ? lineas : [];

  box.innerHTML = arr
    .map((l) => {
      const isChild = isPackChildForPrint(l);
      const pricing = getPrintableLinePricingBreakdown(l);
      const qty = getQtyForPrint(l);
      const absQty = Math.abs(Number(pricing?.absQty || qty || 0));
      const unitGross = Number(pricing?.finalUnitGross || 0);

      const lineTotal =
        l.__lineTotalOverride != null
          ? Number(l.__lineTotalOverride || 0)
          : isChild
            ? 0
            : qty * unitGross;

      const discountPct =
        pricing?.hasDiscount && Number(pricing?.baseUnitGross || 0) > 0
          ? round2(
              ((Number(pricing.baseUnitGross || 0) -
                Number(pricing.finalUnitGross || 0)) /
                Number(pricing.baseUnitGross || 0)) *
                100,
            )
          : 0;
      const discountType = getPrintableLineDiscountType(l, pricing);
      const discountLabel = discountType
        ? `${discountType} -${formatDiscountPercent(discountPct)}%`
        : `-${formatDiscountPercent(discountPct)}%`;

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
          ${
            !isChild && pricing?.hasDiscount
              ? `<div class="item-sub small muted"><span class="price-old-strike">${safe(eurTicket(pricing.baseUnitGross))}</span> ${safe(eurTicket(pricing.finalUnitGross))} · ${safe(discountLabel)}</div>`
              : ""
          }
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
        const qty = parseQtyValue(item?.qty ?? item?.cantidad, 1);

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
  const lineasForDiscount = Array.isArray(ticket?.lineas) ? ticket.lineas : [];
  const discountTotal = calcPrintableDiscountTotal(lineasForDiscount);

  // Agrupar por descripción final (por si vienen repetidos)
  const grouped = {};
  for (const p of pagos) {
    const code = String(p.codpago || "—").trim() || "—";
    const desc = map[code] || code;
    const imp = Number(p.importe ?? 0) || 0;
    grouped[desc] = (grouped[desc] || 0) + imp;
  }

  const wrap = doc.getElementById("payments");
  const cashBlockTitle = doc.getElementById("cashBlockTitle");
  const cashBlockSep = doc.getElementById("cashBlockSep");
  const cashRow = doc.getElementById("cashRow");
  const cashGiven = doc.getElementById("cashGiven");
  const cashLabel = doc.getElementById("cashLabel");
  const changeRow = doc.getElementById("changeRow");
  const changeCash = doc.getElementById("changeCash");
  const changeLabel = doc.getElementById("changeLabel");

  const rawNumero2 = String(ticket?.numero2 || ticket?._raw?.numero2 || "")
    .trim()
    .toUpperCase();

  const isRefundTicket =
    rawNumero2.startsWith("REFUND|") ||
    Number(ticket?.idfacturarect || ticket?._raw?.idfacturarect || 0) > 0 ||
    Number(totalToShow || 0) < 0 ||
    pagos.some((p) => Number(p?.importe || 0) < 0);

  const inferredCashPaid = pagos
    .filter((p) =>
      isCashPago({
        codpago: p?.codpago,
        descripcion: p?.descripcion,
      }),
    )
    .reduce((s, p) => s + (Number(p?.importe || 0) || 0), 0);

  const apiCashTendered = Number(
    ticket?.tpv_efectivo ?? ticket?._raw?.tpv_efectivo,
  );
  const apiChange = Number(ticket?.tpv_cambio ?? ticket?._raw?.tpv_cambio);

  const hasApiCashInfo =
    isFinite(apiCashTendered) ||
    (isFinite(apiChange) && Math.abs(apiChange || 0) > 0.009);

  const cashMeta =
    (hasApiCashInfo
      ? {
          hasCash: Math.abs(Number(apiCashTendered || 0)) > 0.009,
          total: Number(totalToShow || 0) || 0,
          cashPaid: Number(apiCashTendered || 0),
          cashTendered: Number(apiCashTendered || 0),
          change: Number(apiChange || 0),
        }
      : null) ||
    ticket?.cashMeta ||
    (Math.abs(inferredCashPaid) > 0.009
      ? {
          hasCash: true,
          total: Number(totalToShow || 0) || 0,
          cashPaid: inferredCashPaid,
          cashTendered: inferredCashPaid,
          change: 0,
        }
      : null);

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

  if (discountTotal > 0.0001) {
    const baseTotal = round2(
      Number(totalToShow || 0) + Number(discountTotal || 0),
    );

    const rowSubtotal = doc.createElement("div");
    rowSubtotal.className = "row small muted";
    rowSubtotal.innerHTML = `
      <div>Subtotal</div>
      <div class="right">${eurTicket(baseTotal)}</div>
    `;
    wrap.appendChild(rowSubtotal);

    const rowDiscount = doc.createElement("div");
    rowDiscount.className = "row small muted";
    rowDiscount.innerHTML = `
      <div>Descuentos aplicados</div>
      <div class="right">-${eurTicket(discountTotal)}</div>
    `;
    wrap.appendChild(rowDiscount);

    const rowTotal = doc.createElement("div");
    rowTotal.className = "row";
    rowTotal.innerHTML = `
      <div class="bold">Total</div>
      <div class="bold right">${eurTicket(totalToShow)}</div>
    `;
    wrap.appendChild(rowTotal);
  } else {
    const rowTotal = doc.createElement("div");
    rowTotal.className = "row";
    rowTotal.innerHTML = `
      <div class="bold">Total</div>
      <div class="bold right">${eurTicket(totalToShow)}</div>
    `;
    wrap.appendChild(rowTotal);
  }

  // Métodos
  const paymentRows = Object.entries(grouped);
  const singleMethodMatchesTotal =
    paymentRows.length === 1 &&
    Math.abs(Number(paymentRows[0]?.[1] || 0) - Number(totalToShow || 0)) <=
      0.009;

  paymentRows.forEach(([desc, imp]) => {
    const row = doc.createElement("div");
    row.className = "row small muted";
    row.innerHTML = `
      <div>${escapeHtml(desc)}</div>
      <div class="right">${singleMethodMatchesTotal ? "" : eurTicket(imp)}</div>
    `;
    wrap.appendChild(row);
  });

  // Entregado / Cambio o Devolución (también en reimpresión histórica)
  if (
    cashMeta &&
    cashMeta.hasCash &&
    Math.abs(Number(cashMeta.cashTendered || 0)) > 0.009
  ) {
    const cashTenderedAbs = Math.abs(Number(cashMeta.cashTendered || 0));
    const cashPaidAbs = Math.abs(Number(cashMeta.cashPaid || 0));
    const safeCashValue =
      cashTenderedAbs > 0.009 ? cashTenderedAbs : cashPaidAbs;
    const changeAbs = Math.abs(Number(cashMeta.change || 0));
    const shouldShowTenderedRow = isRefundTicket || changeAbs > 0.009;
    const shouldShowChangeRow = !isRefundTicket && changeAbs > 0.009;
    const shouldShowCashBlock = shouldShowTenderedRow || shouldShowChangeRow;

    if (cashBlockTitle) {
      cashBlockTitle.style.display = shouldShowCashBlock ? "block" : "none";
    }

    if (cashBlockSep) {
      cashBlockSep.style.display = shouldShowCashBlock ? "block" : "none";
    }

    if (cashRow && cashGiven) {
      if (!shouldShowTenderedRow) {
        cashRow.style.display = "none";
      } else {
        cashRow.style.display = "flex";
        cashGiven.textContent = eurTicket(safeCashValue);
        if (cashLabel)
          cashLabel.textContent = isRefundTicket ? "Devolución" : "Entregado";
      }
    }

    if (changeRow && changeCash) {
      if (shouldShowChangeRow) {
        changeRow.style.display = "flex";
        changeCash.textContent = eurTicket(changeAbs);
        if (changeLabel) changeLabel.textContent = "Cambio";
      } else {
        changeRow.style.display = "none";
      }
    }
  } else {
    if (cashBlockTitle) cashBlockTitle.style.display = "none";
    if (cashBlockSep) cashBlockSep.style.display = "none";
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
    const n = parseQtyValue(q, 0);
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
  const ticketSerie = String(ticket?.codserie || ticket?._raw?.codserie || "S")
    .trim()
    .toUpperCase();
  if (ticketSerie === "A") {
    const fiscal = String(ticket?.clientFiscalId || "").trim();
    const addr = String(ticket?.clientAddress || "").trim();
    const fiscalText = fiscal || "(sin informar)";
    const addrText = addr || "(sin informar)";
    push(`NIF/CIF: ${fiscalText}\n`);
    push(`Dirección: ${addrText}\n`);
  }
  if (term) push(`Terminal: ${term}\n`);
  if (ag) push(`Agente: ${ag}\n`);
  push("\n");

  for (const l of lineas || []) {
    const pricing = getPrintableLinePricingBreakdown(l);
    const qty = getQtyForPrint(l);
    const isChild = isPackChildForPrint(l);

    const unitGross = Number(pricing?.finalUnitGross || 0);
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
      if (pricing?.hasDiscount) {
        const discountPct =
          Number(pricing?.baseUnitGross || 0) > 0
            ? round2(
                ((Number(pricing.baseUnitGross || 0) -
                  Number(pricing.finalUnitGross || 0)) /
                  Number(pricing.baseUnitGross || 0)) *
                  100,
              )
            : 0;
        push(
          `    Desc: -${formatDiscountPercent(discountPct)}% (-${eurTicket(pricing.discountTotal)})\n`,
        );
      }
      push(`    ${eurTicket(lineGross)}\n`);
    }
  }

  push("\n");
  hr();
  push(`TOTAL: ${eurTicket(totalToShow)}\n`);
  const totalDiscount = calcPrintableDiscountTotal(lineas);
  if (totalDiscount > 0.0001) {
    push(`DESCUENTOS: -${eurTicket(totalDiscount)}\n`);
  }
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

function getInvoiceLabelBySerie(codserie) {
  const serie = String(codserie || "S")
    .trim()
    .toUpperCase();
  if (serie === "R") return "Factura Rectificativa";
  if (serie === "A") return "Factura General";
  return "Factura Simplificada";
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
      label: getInvoiceLabelBySerie(codserie || "S"),
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
          label: getInvoiceLabelBySerie(codserie || "S"),
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
            label: getInvoiceLabelBySerie(codserie || "S"),
            badge: "DEVUELTO",
            isRect: false,
          };
        }

        if (refundedTotal > 0) {
          return {
            kind: "PARTIAL_REFUND",
            label: getInvoiceLabelBySerie(codserie || "S"),
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
    label: getInvoiceLabelBySerie(codserie || "S"),
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

    await enrichTicketClientForGeneral(ticket);

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
              dtopor1: Number(l.dtopor1 || 0),
              dtopor: Number(l.dtopor || 0),
              dtopor2: Number(l.dtopor2 || 0),
              dtopor3: Number(l.dtopor3 || 0),
              dtopor4: Number(l.dtopor4 || 0),
              pvpsindto: Number(l.pvpsindto || 0),
              pvptotal: Number(l.pvptotal || 0),
            };
          });

          // Si FS no trae detalle de descuento, intentar rescatarlo del snapshot local.
          lineas = attachPrintableDiscountHintsFromSnapshot(
            lineas,
            Array.isArray(ticket?.lineas) ? ticket.lineas : [],
          );
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

    // Refuerzo offline: rellena nombre/descripcion cuando faltan en líneas.
    lineas = enrichPrintableLineLabels(lineas);

    // 3) Totales + IVA/Base
    const { totalToShow: computedTotalToShow, taxMap } = calcTotalsAndTaxMap(
      lineas,
      totalsOnlyPositive,
    );

    const ticketTotalNumber = Number(ticket?.total);
    const totalToShow = Number.isFinite(ticketTotalNumber)
      ? round2(ticketTotalNumber)
      : computedTotalToShow;

    if (TPV_E2E_MODE) {
      try {
        window.__TPV_E2E_LAST_PRINT_MODEL__ = {
          ticket: {
            numero: ticket?.numero || "",
            clientName: ticket?.clientName || "",
          },
          lineas: Array.isArray(lineas)
            ? lineas.map((l) => ({
                descripcion: String(l?.descripcion || ""),
                cantidad: Number(l?.cantidad || 0),
                pvpunitario: Number(l?.pvpunitario || 0),
                pvptotal: Number(l?.pvptotal || 0),
              }))
            : [],
          totalToShow: Number(totalToShow || 0),
        };
      } catch {}
    }

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

    const isGeneralSerie =
      String(ticket?.codserie || ticket?._raw?.codserie || "")
        .trim()
        .toUpperCase() === "A";
    const clientFiscalRow = doc.getElementById("clientFiscalRow");
    const clientAddressRow = doc.getElementById("clientAddressRow");
    const clientFiscalValue = String(ticket?.clientFiscalId || "").trim();
    const clientAddressValue = String(ticket?.clientAddress || "").trim();
    const clientFiscalText = clientFiscalValue || "(sin informar)";
    const clientAddressText = clientAddressValue || "(sin informar)";

    if (clientFiscalRow) {
      if (isGeneralSerie) {
        setText(doc, "clientFiscal", clientFiscalText);
        clientFiscalRow.style.display = "block";
      } else {
        setText(doc, "clientFiscal", "");
        clientFiscalRow.style.display = "none";
      }
    }

    if (clientAddressRow) {
      if (isGeneralSerie) {
        setText(doc, "clientAddress", clientAddressText);
        clientAddressRow.style.display = "block";
      } else {
        setText(doc, "clientAddress", "");
        clientAddressRow.style.display = "none";
      }
    }

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
    const phones = [emp?.telefono1, emp?.telefono2]
      .map((p) => String(p || "").trim())
      .filter(Boolean);

    const phoneRow = doc.getElementById("companyPhoneRow");

    if (phones.length > 0) {
      setText(doc, "companyPhone", `Tel.: ${phones.join(" / ")}`);
      if (phoneRow) phoneRow.style.display = "block";
    } else {
      setText(doc, "companyPhone", "");
      if (phoneRow) phoneRow.style.display = "none";
    }

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
  const low = msg.toLowerCase();
  return (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    low.includes("network") ||
    low.includes("timeout") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONN") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ERR_FAILED") ||
    msg.includes("ERR_INTERNET_DISCONNECTED") ||
    msg.includes("ERR_CONNECTION") ||
    msg.includes("ERR_UNSAFE_PORT")
  );
}

function isRetryableQueueSyncError(err) {
  if (isProbablyNetworkError(err)) return true;

  const msg = String(err?.message || err || "");
  const low = msg.toLowerCase();

  if (low.includes("error http 429")) return true;
  if (low.includes("demasiadas peticiones")) return true;
  if (/error http\s*5\d\d/i.test(msg)) return true;
  if (low.includes("tempor") && low.includes("error")) return true;

  return false;
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

function getCurrentSlugForReservations() {
  const saved =
    getSavedCompanySnapshot?.(
      JSON.parse(localStorage.getItem("tpv_company_cfg") || "{}"),
    ) || {};
  const baseUrl =
    saved.baseUrl ||
    window.RECIPOK_API?.baseUrl ||
    localStorage.getItem("tpv_baseUrl") ||
    "";

  const m = String(baseUrl).match(/plus\.recipok\.com\/([^/]+)\/api\/\d+/i);
  return m ? String(m[1]).trim() : "";
}

function getParkedScopedStorageKey(baseKey) {
  const slug = String(getCurrentSlugForReservations() || "").trim();
  const scope = slug || "default";
  return `${baseKey}::${scope}`;
}

function getParkedDeviceNodeId() {
  const key = getParkedScopedStorageKey(PARKED_DEVICE_NODE_ID_KEY);

  try {
    const raw = Number(localStorage.getItem(key) || 0);
    if (Number.isInteger(raw) && raw >= 1000 && raw <= 9999) {
      return raw;
    }
  } catch {}

  const generated = 1000 + Math.floor(Math.random() * 9000);
  try {
    localStorage.setItem(key, String(generated));
  } catch {}

  return generated;
}

function nextParkedTicketId() {
  const nodeId = getParkedDeviceNodeId();
  const seqKey = getParkedScopedStorageKey(PARKED_DEVICE_SEQ_KEY);

  let seq = 0;
  try {
    const raw = Number(localStorage.getItem(seqKey) || 0);
    if (Number.isInteger(raw) && raw >= 0 && raw <= 9999) {
      seq = raw;
    }
  } catch {}

  const usedIds = new Set(
    (Array.isArray(parkedTickets) ? parkedTickets : [])
      .map((t) => Number(t?.id || 0))
      .filter((n) => Number.isFinite(n) && n > 0),
  );

  for (let i = 0; i < 10010; i += 1) {
    seq = (seq % 9999) + 1;
    const candidate = nodeId * 10000 + seq;
    if (usedIds.has(candidate)) continue;

    try {
      localStorage.setItem(seqKey, String(seq));
    } catch {}

    parkedCounter = Math.max(Number(parkedCounter || 0), candidate);
    return candidate;
  }

  const fallback = Date.now();
  parkedCounter = Math.max(Number(parkedCounter || 0), fallback);
  return fallback;
}

function getParkedDisplayNumberFromId(rawId) {
  const id = Number(rawId || 0) || 0;
  if (!id) return "";

  const nodePart = Math.floor(id / 10000);
  const seqPart = id % 10000;

  if (nodePart >= 1000 && nodePart <= 9999 && seqPart >= 1 && seqPart <= 9999) {
    return String(seqPart);
  }

  return String(id);
}

function parseParkedDisplayNumber(value) {
  const n = Number(String(value || "").trim());
  if (!Number.isInteger(n) || n <= 0) return 0;
  return n;
}

function getParkedDisplayNumberFromLabel(label) {
  const txt = String(label || "").trim();
  if (!txt) return 0;
  const m = txt.match(/^ticket\s*#\s*(\d+)$/i);
  return m ? parseParkedDisplayNumber(m[1]) : 0;
}

function normalizeParkedDisplayNumberValue(value) {
  const parsed = parseParkedDisplayNumber(value);
  if (!parsed) return 0;

  const normalized = getParkedDisplayNumberFromId(parsed) || String(parsed);
  return parseParkedDisplayNumber(normalized);
}

function getNextParkedDisplayNumber(list = parkedTickets) {
  const maxCurrent = getScopedPendingParkedTickets(list).reduce((max, t) => {
    const n = Number(getParkedTicketDisplayNumber(t) || 0);
    return n > max ? n : max;
  }, 0);

  return maxCurrent > 0 ? maxCurrent + 1 : 1;
}

function getParkedTicketDisplayNumber(ticket) {
  const explicit = normalizeParkedDisplayNumberValue(
    ticket?.displayNo ?? ticket?.displayNumber ?? ticket?.ticketDisplayNo,
  );
  if (explicit > 0) return String(explicit);

  const fromLabel = getParkedDisplayNumberFromLabel(
    ticket?.name || ticket?.label,
  );
  if (fromLabel > 0) {
    return getParkedDisplayNumberFromId(fromLabel) || String(fromLabel);
  }

  return getParkedDisplayNumberFromId(ticket?.id || ticket?.ticketId || 0);
}

function getParkedTicketDisplayLabel(ticket) {
  const explicit = String(ticket?.name || ticket?.label || "").trim();
  const clientName = String(ticket?.clientName || "").trim();
  const displayNo = getParkedTicketDisplayNumber(ticket) || "0";

  if (!explicit) {
    return clientName || `Ticket #${displayNo}`;
  }

  const m = explicit.match(/^ticket\s*#\s*(\d+)$/i);
  if (m) {
    if (clientName) return clientName;
    const fromText = getParkedDisplayNumberFromId(m[1]) || displayNo;
    return `Ticket #${fromText}`;
  }

  return explicit;
}

function getCanonicalParkedTicketName(ticket, fallbackName = "") {
  const rawName = String(
    ticket?.name || ticket?.label || fallbackName || "",
  ).trim();
  const displayNo = getParkedTicketDisplayNumber(ticket) || "0";

  if (!rawName) return `Ticket #${displayNo}`;

  const m = rawName.match(/^ticket\s*#\s*(\d+)$/i);
  if (!m) return rawName;

  const shortNo = getParkedDisplayNumberFromId(m[1]) || displayNo;
  return `Ticket #${shortNo}`;
}

function getScopedPendingParkedTickets(list = parkedTickets) {
  return (Array.isArray(list) ? list : []).filter(
    (t) => !t?.paid && !t?.closingInProgress,
  );
}

function getScopedAllParkedTickets(list = parkedTickets) {
  return (Array.isArray(list) ? list : []).filter((t) => !t?.closingInProgress);
}

function collectUsedParkedDisplayNumbers(list = parkedTickets) {
  const used = new Set();

  getScopedAllParkedTickets(list).forEach((t) => {
    const n = Number(getParkedTicketDisplayNumber(t) || 0) || 0;
    if (n > 0) used.add(n);
  });

  return used;
}

function ensureUniqueNextParkedDisplayNumber(preferred, list = parkedTickets) {
  const used = collectUsedParkedDisplayNumbers(list);
  let candidate = Number(preferred || 0) || 1;
  if (candidate <= 0) candidate = 1;

  while (used.has(candidate)) {
    candidate += 1;
    if (candidate > 999999) {
      candidate = Date.now() % 1000000;
      if (candidate <= 0) candidate = 1;
      break;
    }
  }

  return candidate;
}

function getPaidTicketParkedOriginStorageKey() {
  return getParkedScopedStorageKey(PAID_TICKET_PARKED_ORIGIN_KEY);
}

function loadPaidTicketParkedOriginMap() {
  try {
    const raw = localStorage.getItem(getPaidTicketParkedOriginStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePaidTicketParkedOriginMap(map) {
  try {
    const safe = map && typeof map === "object" ? map : {};
    const entries = Object.entries(safe);
    const trimmed =
      entries.length > 3000
        ? Object.fromEntries(entries.slice(entries.length - 3000))
        : safe;
    localStorage.setItem(
      getPaidTicketParkedOriginStorageKey(),
      JSON.stringify(trimmed),
    );
  } catch {}
}

function rememberPaidTicketParkedOrigin(ticket, paidInfo = {}) {
  const paidId = Number(paidInfo?.idfactura || ticket?.paidTicketId || 0) || 0;
  const paidCode = String(
    paidInfo?.codigo || paidInfo?.numero || ticket?.paidTicketCode || "",
  )
    .trim()
    .toLowerCase();

  if (!paidId && !paidCode) return;

  const origin = {
    parkedDisplayNo: String(getParkedTicketDisplayNumber(ticket) || ""),
    parkedLabel: String(getParkedTicketDisplayLabel(ticket) || "").trim(),
    parkedClientName: String(ticket?.clientName || "").trim(),
    parkedTicketId: Number(ticket?.id || 0) || 0,
    paidAt: new Date().toISOString(),
  };

  const map = loadPaidTicketParkedOriginMap();
  if (paidId > 0) map[`id:${paidId}`] = origin;
  if (paidCode) map[`code:${paidCode}`] = origin;
  savePaidTicketParkedOriginMap(map);
}

function getPaidTicketParkedOriginForTicketRow(ticketRow) {
  const map = loadPaidTicketParkedOriginMap();

  const paidId = Number(ticketRow?.idfactura || 0) || 0;
  if (paidId > 0 && map[`id:${paidId}`]) {
    return map[`id:${paidId}`];
  }

  const paidCode = String(ticketRow?.codigo || "")
    .trim()
    .toLowerCase();
  if (paidCode && map[`code:${paidCode}`]) {
    return map[`code:${paidCode}`];
  }

  return null;
}

function getProductBaseId(product) {
  return (
    Number(product?.baseProductId || product?.id || product?.idproducto || 0) ||
    0
  );
}

function resolveProductIdByReferenceSync(reference) {
  const ref = String(reference || "")
    .trim()
    .toLowerCase();
  if (!ref) return 0;

  const local = Array.isArray(products)
    ? products.find((p) => {
        const pRef = String(p?.referencia || p?.ref || p?.codigo || "")
          .trim()
          .toLowerCase();
        return pRef === ref;
      })
    : null;

  const localId = Number(local?.baseProductId || local?.id || 0) || 0;
  if (localId) return localId;

  const cache = PACKS_STATE?.productByRefCache;
  if (!(cache instanceof Map)) return 0;

  for (const [key, value] of cache.entries()) {
    if (
      String(key || "")
        .trim()
        .toLowerCase() !== ref
    )
      continue;
    const cachedId = Number(value?.idproducto || value?.id || 0) || 0;
    if (cachedId) return cachedId;
  }

  return 0;
}

function parseQtyValue(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  const normalized = raw.replace(",", ".");
  const qty = Number(normalized);
  return Number.isFinite(qty) ? qty : fallback;
}

function getCartItemReservedQty(item) {
  return parseQtyValue(item?.qty ?? item?.cantidad, 0);
}

function roundQty3(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;
}

function buildReservedQtyByProductMap(items) {
  const out = new Map();

  (Array.isArray(items) ? items : []).forEach((it) => {
    let idProd = getProductBaseId(it);

    // Para hijos de pack, prioriza resolver por referencia para evitar ids inválidos
    // heredados de líneas de plantilla (p. ej. id de packline en lugar de idproducto).
    if (it?.meta?.includedInPack) {
      const packRef = String(it?.meta?.packRef || it?.referencia || "").trim();
      const byRefId = resolveProductIdByReferenceSync(packRef);
      if (byRefId) idProd = byRefId;
    }

    if (!idProd) return;

    const qty = getCartItemReservedQty(it);
    if (!Number.isFinite(qty) || Math.abs(qty) < 0.0005) return;

    const prev = Number(out.get(idProd) || 0);
    out.set(idProd, roundQty3(prev + qty));
  });

  return out;
}

function buildReservedQtyDeltaMap(nextItems, prevItems) {
  const nextMap = buildReservedQtyByProductMap(nextItems);
  const prevMap = buildReservedQtyByProductMap(prevItems);

  const out = new Map();
  const keys = new Set([...nextMap.keys(), ...prevMap.keys()]);

  keys.forEach((idProd) => {
    const nextQty = Number(nextMap.get(idProd) || 0);
    const prevQty = Number(prevMap.get(idProd) || 0);
    const delta = roundQty3(nextQty - prevQty);
    if (Math.abs(delta) < 0.0005) return;
    out.set(idProd, delta);
  });

  return out;
}

function findProductByBaseId(idProd) {
  const id = Number(idProd || 0) || 0;
  if (!id || !Array.isArray(products)) return null;
  return products.find((p) => getProductBaseId(p) === id) || null;
}

function applyStockQtyToLocalProductsById(idProd, qty) {
  const baseId = Number(idProd || 0) || 0;
  if (!baseId || !Array.isArray(products) || !products.length) return;

  products = products.map((p) => {
    if (Number(p?.baseProductId || p?.id || 0) !== baseId) return p;
    return {
      ...p,
      stockfisRaw: Number(qty),
      stockfis: Number(qty),
    };
  });

  renderProducts?.();
  updateRenderedProductStocks?.();
}

function isReservedStockSyncedToFsEnabled() {
  const cfgVal = window.TPV_CONFIG?.syncReservedStockToFS;
  if (cfgVal == null) return true;
  return !!cfgVal;
}

async function syncReservedStockDeltaToFS(deltaMap, reason = "") {
  if (isSafeTrainingModeEnabled()) return true;
  if (!isReservedStockSyncedToFsEnabled()) return true;
  if (!(deltaMap instanceof Map) || deltaMap.size === 0) return true;
  if (TPV_STATE?.offline || TPV_STATE?.locked) {
    throw new Error("Sin conexión con FacturaScripts para sincronizar stock.");
  }

  const issues = [];

  for (const [idProdRaw, deltaRaw] of deltaMap.entries()) {
    const idProd = Number(idProdRaw || 0) || 0;
    const delta = Number(deltaRaw || 0);

    if (!idProd || !Number.isFinite(delta) || Math.abs(delta) < 0.0005) {
      continue;
    }

    try {
      const product = findProductByBaseId(idProd);
      const stockRowsByReference = await fetchStockRowsByProductReference(
        product || { id: idProd, baseProductId: idProd },
      );

      // Regla operativa: si no existen filas en stocks por referencia,
      // el producto se considera sin control de stock y se ignora.
      if (!stockRowsByReference.length) {
        continue;
      }

      const stockRow = pickStockRowByWarehouse(
        stockRowsByReference,
        getCurrentWarehouseCode(),
      );

      if (!stockRow) {
        throw new Error(`No se encontró fila de stock para producto ${idProd}`);
      }

      const currentQty = parseQtyValue(
        stockRow?.cantidad ?? product?.stockfis,
        0,
      );

      // delta > 0 => se aparca más y baja stock, delta < 0 => se libera y sube stock.
      const nextQty = roundQty3(currentQty - delta);

      await updateStockRowCantidad(stockRow, nextQty);
      applyStockQtyToLocalProductsById(idProd, nextQty);
    } catch (e) {
      issues.push(`${idProd}: ${e?.message || e}`);
    }
  }

  if (issues.length) {
    const detail = issues.slice(0, 3).join(" | ");
    throw new Error(
      `No se pudo sincronizar stock en FacturaScripts (${reason || "aparcados"}): ${detail}`,
    );
  }

  return true;
}

function rebuildRemoteReservedByProductMap() {
  const map = new Map();

  (Array.isArray(REMOTE_PARKED_RESERVATIONS)
    ? REMOTE_PARKED_RESERVATIONS
    : []
  ).forEach((ticket) => {
    if (ticket?.paid) return;

    const items = Array.isArray(ticket?.items) ? ticket.items : [];

    items.forEach((it) => {
      const idProd = getProductBaseId(it);
      if (!idProd) return;

      const qty = getCartItemReservedQty(it);
      map.set(idProd, Number(map.get(idProd) || 0) + qty);
    });
  });

  REMOTE_RESERVED_BY_PRODUCT = map;
}

function normalizeRemoteParkedTicket(raw) {
  if (!raw || typeof raw !== "object") return null;

  const rawTicketId =
    raw.ticketId ?? raw.id ?? raw.ticketid ?? raw.ticket_id ?? null;
  const numTicketId = Number(rawTicketId);

  const id = Number.isFinite(numTicketId) && numTicketId > 0 ? numTicketId : 0;

  const createdAt = raw.createdAt
    ? new Date(raw.createdAt)
    : raw.updatedAt
      ? new Date(raw.updatedAt)
      : new Date();

  const updatedAt = raw.updatedAt ? new Date(raw.updatedAt) : null;

  const items = Array.isArray(raw.items)
    ? raw.items.map((it) => ({
        ...it,
        qty: parseQtyValue(it?.qty ?? it?.cantidad, 1),
      }))
    : [];

  const normalizedTicket = {
    id,
    slug: String(raw.slug || "").trim(),
    cajaId: String(raw.cajaId || raw.cajaid || "").trim(),
    createdAt,
    updatedAt,
    items,
    total: Number(raw.total || 0),
    discountSummary:
      raw?.discountSummary && typeof raw.discountSummary === "object"
        ? {
            hasDiscount: !!raw.discountSummary.hasDiscount,
            baseTotal: round2(Number(raw.discountSummary.baseTotal || 0)),
            finalTotal: round2(Number(raw.discountSummary.finalTotal || 0)),
            savings: round2(Number(raw.discountSummary.savings || 0)),
            labelsText: String(raw.discountSummary.labelsText || "").trim(),
          }
        : null,
    clientName: String(raw.clientName || "").trim() || "Cliente",
    codcliente:
      String(raw.codcliente || raw.clientCodcliente || "").trim() || "",
    displayNo:
      normalizeParkedDisplayNumberValue(
        raw.displayNo ?? raw.displayNumber ?? raw.ticketDisplayNo,
      ) ||
      normalizeParkedDisplayNumberValue(
        getParkedDisplayNumberFromLabel(raw.ticketName || raw.name),
      ) ||
      0,
    name: String(raw.ticketName || raw.name || "").trim(),
    obs: String(raw.obs || raw.ticketObs || "").trim(),
    closingInProgress: parseBoolLike(
      raw?.closingInProgress ?? raw?.closing_in_progress,
      false,
    ),
    closingByTerminalId: String(
      raw?.closingByTerminalId || raw?.closing_by_terminal_id || "",
    ).trim(),
    closingByTerminalName: String(
      raw?.closingByTerminalName || raw?.closing_by_terminal_name || "",
    ).trim(),
    closingByAt: raw?.closingByAt || raw?.closing_by_at || null,
    paid: !!raw.paid,
    paidAt: raw.paidAt ? new Date(raw.paidAt) : null,
    paidTicketCode: raw.paidTicketCode || null,
    paidTicketId: raw.paidTicketId || null,
    fs: raw.fs && typeof raw.fs === "object" ? raw.fs : null,
    _simulated: !!(raw._simulated || raw.simulated),
  };

  normalizedTicket.name = getCanonicalParkedTicketName(
    normalizedTicket,
    normalizedTicket.name ||
      (id ? `Ticket #${getParkedDisplayNumberFromId(id) || id}` : "Ticket"),
  );

  return normalizedTicket;
}

function saveParkedTicketsCache(list = parkedTickets) {
  const safe = getScopedPendingParkedTickets(list).map((t) => ({
    ...t,
    createdAt: t?.createdAt
      ? new Date(t.createdAt).toISOString()
      : new Date().toISOString(),
    updatedAt: t?.updatedAt ? new Date(t.updatedAt).toISOString() : null,
    paidAt: t?.paidAt ? new Date(t.paidAt).toISOString() : null,
  }));

  try {
    localStorage.setItem(
      getParkedScopedStorageKey(PARKED_TICKETS_CACHE_KEY),
      JSON.stringify(safe),
    );
  } catch (e) {
    console.warn(
      "No se pudo guardar cache local de aparcados:",
      e?.message || e,
    );
  }
}

function saveParkedPaidHistory(list) {
  const safe = (Array.isArray(list) ? list : [])
    .filter((t) => !!t?.paid)
    .map((t) => ({
      ...t,
      createdAt: t?.createdAt
        ? new Date(t.createdAt).toISOString()
        : new Date().toISOString(),
      updatedAt: t?.updatedAt ? new Date(t.updatedAt).toISOString() : null,
      paidAt: t?.paidAt ? new Date(t.paidAt).toISOString() : null,
    }));

  try {
    localStorage.setItem(
      getParkedScopedStorageKey(PARKED_PAID_HISTORY_KEY),
      JSON.stringify(safe.slice(-2000)),
    );
  } catch (e) {
    console.warn(
      "No se pudo guardar historial de aparcados cobrados:",
      e?.message || e,
    );
  }
}

function loadParkedPaidHistory() {
  try {
    const raw = localStorage.getItem(
      getParkedScopedStorageKey(PARKED_PAID_HISTORY_KEY),
    );
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];

    return arr
      .map((it) => normalizeRemoteParkedTicket(it))
      .filter(Boolean)
      .filter((t) => !!t?.paid);
  } catch (e) {
    console.warn(
      "No se pudo leer historial de aparcados cobrados:",
      e?.message || e,
    );
    return [];
  }
}

function upsertParkedPaidHistory(ticket) {
  if (!ticket || !ticket?.paid) return;

  const key = getParkedTicketSyncKey(ticket);
  if (!key) return;

  const list = loadParkedPaidHistory();
  const idx = list.findIndex((it) => getParkedTicketSyncKey(it) === key);

  if (idx >= 0) list[idx] = { ...list[idx], ...ticket };
  else list.push(ticket);

  saveParkedPaidHistory(list);
}

function loadParkedTicketsCache() {
  try {
    const raw = localStorage.getItem(
      getParkedScopedStorageKey(PARKED_TICKETS_CACHE_KEY),
    );
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];

    return arr
      .map((it) => normalizeRemoteParkedTicket(it))
      .filter(Boolean)
      .filter((t) => !t?.paid);
  } catch (e) {
    console.warn("No se pudo leer cache local de aparcados:", e?.message || e);
    return [];
  }
}

function getParkedTicketSyncKey(ticket) {
  if (!ticket) return "";
  const slug = String(ticket.slug || "").trim();
  const cajaId = String(ticket.cajaId || "").trim();
  const id = String(ticket.id || ticket.ticketId || "").trim();
  return `${slug}|${cajaId}|${id}`;
}

function isParkedSyncTransientError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("offline") ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("timeout") ||
    msg.includes("abort") ||
    msg.includes("http 5") ||
    msg.includes("http 429")
  );
}

function loadParkedSyncQueue() {
  try {
    const raw = localStorage.getItem(
      getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY),
    );
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveParkedSyncQueue(queue) {
  try {
    const safe = Array.isArray(queue) ? queue : [];
    localStorage.setItem(
      getParkedScopedStorageKey(PARKED_SYNC_QUEUE_KEY),
      JSON.stringify(safe.slice(-2000)),
    );
  } catch (e) {
    console.warn("No se pudo guardar cola de aparcados:", e?.message || e);
  }
}

function snapshotTicketForSync(ticket) {
  const t = ticket && typeof ticket === "object" ? ticket : {};
  return {
    ...t,
    createdAt: t?.createdAt ? new Date(t.createdAt).toISOString() : null,
    updatedAt: t?.updatedAt ? new Date(t.updatedAt).toISOString() : null,
    paidAt: t?.paidAt ? new Date(t.paidAt).toISOString() : null,
  };
}

function enqueueParkedSyncOperation(op, ticket) {
  if (isSafeTrainingModeEnabled()) return;

  const ticketSnapshot = snapshotTicketForSync(ticket);
  const key = getParkedTicketSyncKey(ticketSnapshot);
  if (!key) return;

  const queue = loadParkedSyncQueue();
  const nextEntry = {
    op: op === "delete" ? "delete" : "upsert",
    key,
    ticket: ticketSnapshot,
    queuedAt: new Date().toISOString(),
  };

  const idx = queue.findIndex((q) => q?.key === key);
  if (idx >= 0) queue[idx] = nextEntry;
  else queue.push(nextEntry);

  saveParkedSyncQueue(queue);
}

async function processParkedSyncQueue() {
  if (isSafeTrainingModeEnabled()) return true;
  if (__parkedSyncDrainInFlight) return false;
  if (TPV_STATE?.offline) return false;

  const queue = loadParkedSyncQueue();
  if (!queue.length) return true;

  __parkedSyncDrainInFlight = true;
  try {
    const remaining = [];

    for (const entry of queue) {
      try {
        if (entry?.op === "delete") {
          await apiDeleteParkedReservation(entry?.ticket || {});
        } else {
          await apiSaveParkedReservation(entry?.ticket || {});
        }
      } catch {
        remaining.push(entry);
      }
    }

    saveParkedSyncQueue(remaining);
    return remaining.length === 0;
  } finally {
    __parkedSyncDrainInFlight = false;
  }
}

function syncParkedTicketsFromRemote(list) {
  const prevByKey = new Map(
    (Array.isArray(parkedTickets) ? parkedTickets : []).map((t) => [
      getParkedTicketSyncKey(t),
      t,
    ]),
  );
  const prevByIdCount = new Map();
  (Array.isArray(parkedTickets) ? parkedTickets : []).forEach((t) => {
    const id = Number(t?.id || 0) || 0;
    if (!id) return;
    prevByIdCount.set(id, Number(prevByIdCount.get(id) || 0) + 1);
  });
  const prevByIdUnique = new Map();
  (Array.isArray(parkedTickets) ? parkedTickets : []).forEach((t) => {
    const id = Number(t?.id || 0) || 0;
    if (!id) return;
    if (Number(prevByIdCount.get(id) || 0) === 1) {
      prevByIdUnique.set(id, t);
    }
  });

  const prevLoadedTicket =
    currentParkedTicketIndex != null
      ? parkedTickets[currentParkedTicketIndex]
      : null;
  const prevLoadedKey = getParkedTicketSyncKey(prevLoadedTicket);

  const nextRaw = (Array.isArray(list) ? list : [])
    .map((it) => normalizeRemoteParkedTicket(it))
    .map((t) => {
      const id = Number(t?.id || 0) || 0;
      const key = getParkedTicketSyncKey(t);
      const prev = prevByKey.get(key) || prevByIdUnique.get(id) || null;
      if (!prev) return t;

      if (!String(t?.codcliente || "").trim()) {
        t.codcliente = String(prev?.codcliente || "").trim();
      }

      if (!String(t?.clientName || "").trim()) {
        t.clientName = String(prev?.clientName || "").trim() || "Cliente";
      }

      if (!Number(t?.displayNo || 0) && Number(prev?.displayNo || 0) > 0) {
        t.displayNo = Number(prev.displayNo);
      }

      if (
        (!t?.discountSummary || typeof t.discountSummary !== "object") &&
        prev?.discountSummary &&
        typeof prev.discountSummary === "object"
      ) {
        t.discountSummary = { ...prev.discountSummary };
      }

      if (!t?.paid && prev?.closingInProgress) {
        t.closingInProgress = true;
      }

      return t;
    })
    .filter(Boolean);

  const mergedRaw = [...nextRaw, ...loadParkedPaidHistory()];

  const dedupByKey = new Map();
  mergedRaw.forEach((t) => {
    const keyBySync = String(getParkedTicketSyncKey(t) || "").trim();
    const keyById = Number(t?.id || 0) > 0 ? `id:${Number(t.id)}` : "";
    const key = keyBySync || keyById;
    if (!key) return;

    const prev = dedupByKey.get(key);
    if (!prev) {
      dedupByKey.set(key, t);
      return;
    }

    if (!!t?.paid && !prev?.paid) {
      dedupByKey.set(key, t);
      return;
    }

    const tsFrom = (x) => {
      const paidAtMs = x?.paidAt ? new Date(x.paidAt).getTime() : 0;
      const updMs = x?.updatedAt ? new Date(x.updatedAt).getTime() : 0;
      const crtMs = x?.createdAt ? new Date(x.createdAt).getTime() : 0;
      return Math.max(
        Number.isFinite(paidAtMs) ? paidAtMs : 0,
        Number.isFinite(updMs) ? updMs : 0,
        Number.isFinite(crtMs) ? crtMs : 0,
      );
    };

    const prevTs = tsFrom(prev);
    const nextTs = tsFrom(t);
    if (nextTs >= prevTs) {
      dedupByKey.set(key, t);
    }
  });

  const next = Array.from(dedupByKey.values()).sort(
    compareParkedTicketsForList,
  );

  parkedTickets = next;
  const reconciledCount = reconcileParkedPaidTwins(parkedTickets);

  // Persistir enlace origen aparcado -> ticket cobrado también cuando el cobro
  // llega por sincronización de otro TPV.
  parkedTickets.forEach((t) => {
    if (!t?.paid) return;
    rememberPaidTicketParkedOrigin(t, {
      idfactura: Number(t?.paidTicketId || 0) || null,
      codigo: String(t?.paidTicketCode || "").trim() || null,
    });
  });

  if (reconciledCount > 0) {
    console.info(
      `[TPV] Reconciliados ${reconciledCount} aparcado(s) como cobrados por sincronización.`,
    );
  }

  saveParkedPaidHistory(next.filter((t) => !!t?.paid));

  const maxId = parkedTickets.reduce((m, t) => {
    const n = Number(t?.id || 0);
    return n > m ? n : m;
  }, 0);

  parkedCounter = Math.max(Number(parkedCounter || 0), maxId);
  saveParkedTicketsCache(parkedTickets);

  if (prevLoadedKey) {
    const nextIdx = parkedTickets.findIndex(
      (t) => getParkedTicketSyncKey(t) === prevLoadedKey,
    );
    currentParkedTicketIndex = nextIdx >= 0 ? nextIdx : null;
  } else if (PENDING_RUNTIME_PARKED_SYNC_KEY) {
    if (!tryResolvePendingParkedTicketIndex()) {
      if (!tryResolvePendingParkedTicketByCartMatch()) {
        currentParkedTicketIndex = null;
      }
    }
  } else if (PENDING_RUNTIME_PARKED_TICKET_ID) {
    if (!tryResolvePendingParkedTicketIndex()) {
      if (!tryResolvePendingParkedTicketByCartMatch()) {
        currentParkedTicketIndex = null;
      }
    }
  } else {
    currentParkedTicketIndex = null;
  }

  updateParkedCountBadge?.();
  refreshParkButtonUI?.();
  refreshParkedEditingBanner?.();

  if (
    parkedTicketsOverlay &&
    !parkedTicketsOverlay.classList.contains("hidden")
  ) {
    renderParkedTicketsModal?.();
  }
}

function getReservedQtyForProduct(productOrId) {
  const idProd =
    typeof productOrId === "number"
      ? Number(productOrId || 0)
      : getProductBaseId(productOrId);

  if (!idProd) return 0;
  return Number(REMOTE_RESERVED_BY_PRODUCT.get(idProd) || 0);
}

function parseManagedStockValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rebuildManagedStockProductIds(stockRows) {
  const next = new Set();

  (Array.isArray(stockRows) ? stockRows : []).forEach((row) => {
    const idProd = Number(row?.idproducto || 0);
    if (idProd > 0) next.add(idProd);
  });

  managedStockProductIds = next;
  managedStockCatalogLoaded = true;
}

function isProductWithoutStockControl(product) {
  if (!product || typeof product !== "object") return false;

  const baseId = Number(getProductBaseId(product) || 0);
  if (managedStockCatalogLoaded && baseId > 0) {
    return !managedStockProductIds.has(baseId);
  }

  const rawManaged = parseManagedStockValue(product.stockfisRaw);
  if (rawManaged !== null) return false;

  const effectiveManaged = parseManagedStockValue(product.stockfis);
  return effectiveManaged === null;
}

function getVisibleStockForProduct(productOrId) {
  const product =
    typeof productOrId === "object"
      ? productOrId
      : Array.isArray(products)
        ? products.find((p) => getProductBaseId(p) === Number(productOrId))
        : null;

  if (!product) return null;

  const realStock = parseManagedStockValue(product.stockfis);
  if (realStock === null) return null;

  // Si ya sincronizamos reservas contra FacturaScripts, stockfis ya viene descontado.
  // Evita doble descuento visual en TPV.
  if (isReservedStockSyncedToFsEnabled()) {
    return realStock;
  }

  const reserved = getReservedQtyForProduct(product);

  return realStock - reserved;
}

async function apiListParkedReservations() {
  if (isSafeTrainingModeEnabled()) {
    return getScopedPendingParkedTickets(parkedTickets).map((t) =>
      snapshotTicketForSync(t),
    );
  }

  const slug = getCurrentSlugForReservations();
  if (!slug) return [];

  const syncApiKey = getTpvSyncApiKey();
  if (!syncApiKey) {
    throw new Error("Falta TPV_CONFIG.tpvApiKey para listar reservas remotas.");
  }

  const url = `${TPV_SYNC_API_URL}?action=list-parked-reservations&slug=${encodeURIComponent(slug)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-TPV-API-KEY": syncApiKey,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Error listando reservas remotas: HTTP ${res.status}`);
  }

  const data = await res.json().catch(() => null);
  return Array.isArray(data?.data) ? data.data : [];
}

async function apiSaveParkedReservation(ticket) {
  if (isSafeTrainingModeEnabled()) {
    return { ok: true, simulated: true };
  }

  const slug = String(ticket?.slug || getCurrentSlugForReservations() || "");
  const cajaId = String(
    ticket?.cajaId || getCajaIdSafe?.() || currentTerminal?.id || "",
  );
  const syncApiKey = getTpvSyncApiKey();

  if (!slug || !cajaId || !ticket?.id) {
    throw new Error("Faltan datos para guardar la reserva remota.");
  }
  if (!syncApiKey) {
    throw new Error(
      "Falta TPV_CONFIG.tpvApiKey para guardar reservas remotas.",
    );
  }

  const payload = {
    slug,
    cajaId,
    ticketId: String(ticket.id),
    ticketDisplayNo:
      Number(getParkedTicketDisplayNumber(ticket) || 0) || undefined,
    ticketName: getCanonicalParkedTicketName(
      ticket,
      `Ticket #${getParkedTicketDisplayNumber(ticket) || getParkedDisplayNumberFromId(ticket.id) || ticket.id}`,
    ),
    obs: String(ticket.obs || ""),
    clientName: String(ticket.clientName || ""),
    codcliente: String(ticket.codcliente || "").trim(),
    clientCodcliente: String(ticket.codcliente || "").trim(),
    closingInProgress: !!ticket?.closingInProgress,
    closingByTerminalId: String(ticket?.closingByTerminalId || "").trim(),
    closingByTerminalName: String(ticket?.closingByTerminalName || "").trim(),
    closingByAt: ticket?.closingByAt || null,
    paid: !!ticket?.paid,
    paidAt: ticket?.paidAt ? new Date(ticket.paidAt).toISOString() : null,
    paidTicketCode: String(ticket?.paidTicketCode || "").trim() || null,
    paidTicketId: Number(ticket?.paidTicketId || 0) || null,
    discountSummary:
      ticket?.discountSummary && typeof ticket.discountSummary === "object"
        ? {
            hasDiscount: !!ticket.discountSummary.hasDiscount,
            baseTotal: round2(Number(ticket.discountSummary.baseTotal || 0)),
            finalTotal: round2(Number(ticket.discountSummary.finalTotal || 0)),
            savings: round2(Number(ticket.discountSummary.savings || 0)),
            labelsText: String(ticket.discountSummary.labelsText || "").trim(),
          }
        : null,
    total: Number(ticket.total || 0),
    terminalId: String(currentTerminal?.id || ""),
    terminalName: String(currentTerminal?.name || ""),
    userName: String(currentAgent?.name || currentAgent?.nick || ""),
    fs: ticket?.fs || null,
    items: Array.isArray(ticket.items)
      ? ticket.items.map((it) => ({
          _lineId: String(it?._lineId || "").trim() || null,
          id: Number(it?.id || 0) || null,
          baseProductId: Number(it?.baseProductId || 0) || null,
          idproducto: getProductBaseId(it),
          qty: getCartItemReservedQty(it),
          cantidad: getCartItemReservedQty(it),
          name: String(it.name || it.nombre || it.descripcion || ""),
          secondaryName: String(it.secondaryName || it.descripcion2 || ""),
          descripcion: String(it.descripcion || it.name || ""),
          descripcion2: String(it.descripcion2 || it.secondaryName || ""),
          referencia: String(it.referencia || ""),
          price: Number(it?.price || 0),
          grossPrice: Number(it?.grossPrice || 0),
          taxRate: Number(it?.taxRate || 0),
          codimpuesto: it?.codimpuesto || null,
          originalNetPrice: Number(it?.originalNetPrice || 0),
          originalGrossPrice: Number(it?.originalGrossPrice || 0),
          grossPriceOverride:
            it?.grossPriceOverride == null
              ? null
              : Number(it.grossPriceOverride),
          manualPriceLocksAdjustments: parseBoolLike(
            it?.manualPriceLocksAdjustments,
            true,
          ),
          cartLineDiscountPct: Number(it?.cartLineDiscountPct || 0),
          cartGlobalDiscountPctApplied: Number(
            it?.cartGlobalDiscountPctApplied || 0,
          ),
          imageUrl: it?.imageUrl || null,
          meta: it?.meta && typeof it.meta === "object" ? it.meta : null,
        }))
      : [],
  };

  const createUrl = `${TPV_SYNC_API_URL}?action=create-parked-reservation`;

  const res = await fetch(createUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-TPV-API-KEY": syncApiKey,
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    return await res.json().catch(() => ({}));
  }

  // Compat: if backend expects update for existing rows, retry once.
  if (res.status === 409 || res.status === 422 || res.status === 404) {
    const updateUrl = `${TPV_SYNC_API_URL}?action=update-parked-reservation`;

    const retryRes = await fetch(updateUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-TPV-API-KEY": syncApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (retryRes.ok) {
      return await retryRes.json().catch(() => ({}));
    }
  }

  throw new Error(`Error guardando reserva remota: HTTP ${res.status}`);
}

async function apiDeleteParkedReservation(ticket) {
  if (isSafeTrainingModeEnabled()) return true;

  const slug = String(ticket?.slug || getCurrentSlugForReservations() || "");
  const cajaId = String(
    ticket?.cajaId || getCajaIdSafe?.() || currentTerminal?.id || "",
  );
  const syncApiKey = getTpvSyncApiKey();

  if (!slug || !cajaId || !ticket?.id) return false;
  if (!syncApiKey) {
    throw new Error("Falta TPV_CONFIG.tpvApiKey para borrar reservas remotas.");
  }

  const payload = {
    slug,
    cajaId,
    ticketId: String(ticket.id),
  };

  const deleteUrl = `${TPV_SYNC_API_URL}?action=delete-parked-reservation`;

  const res = await fetch(deleteUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-TPV-API-KEY": syncApiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Error borrando reserva remota: HTTP ${res.status}`);
  }

  return true;
}

async function ensureRemoteParkedPaidVisibility(ticket) {
  if (!ticket || !ticket?.paid) {
    return { ok: true, mode: "skip" };
  }

  const list = await apiListParkedReservations();
  const normalized = (Array.isArray(list) ? list : [])
    .map((it) => normalizeRemoteParkedTicket(it))
    .filter(Boolean);

  const key = getParkedTicketSyncKey(ticket);
  const byKey = key
    ? normalized.find((it) => getParkedTicketSyncKey(it) === key)
    : null;

  const byId =
    byKey ||
    normalized.find((it) => Number(it?.id || 0) === Number(ticket?.id || 0));

  // Backend moderno: ya soporta paid y se ve igual en todos los TPV.
  if (byId?.paid) {
    return { ok: true, mode: "paid" };
  }

  // Backend antiguo: si sigue pendiente, eliminar evita duplicados entre TPV.
  if (byId && !byId?.paid) {
    await apiDeleteParkedReservation(ticket);
    return { ok: true, mode: "deleted-fallback" };
  }

  return { ok: true, mode: "missing" };
}

async function refreshRemoteParkedReservationsOnly() {
  if (isSafeTrainingModeEnabled()) {
    REMOTE_PARKED_RESERVATIONS = getScopedPendingParkedTickets(parkedTickets);
    rebuildRemoteReservedByProductMap();
    updateRenderedProductStocks();
    updateParkedCountBadge?.();
    refreshParkButtonUI?.();
    refreshParkedEditingBanner?.();
    if (
      parkedTicketsOverlay &&
      !parkedTicketsOverlay.classList.contains("hidden")
    ) {
      renderParkedTicketsModal?.();
    }
    return true;
  }

  if (TPV_STATE?.offline) return false;

  try {
    await processParkedSyncQueue();

    const list = await apiListParkedReservations();
    REMOTE_PARKED_RESERVATIONS = Array.isArray(list) ? list : [];
    syncParkedTicketsFromRemote(REMOTE_PARKED_RESERVATIONS);
    rebuildRemoteReservedByProductMap();
    updateRenderedProductStocks();
    return true;
  } catch (e) {
    console.warn("No se pudieron refrescar reservas remotas:", e?.message || e);

    const cached = loadParkedTicketsCache();
    const paidHistory = loadParkedPaidHistory();
    if (cached.length || paidHistory.length) {
      parkedTickets = [...cached, ...paidHistory];
      REMOTE_PARKED_RESERVATIONS = cached.filter((t) => !t.paid);
      tryResolvePendingParkedTicketIndex();
      rebuildRemoteReservedByProductMap();
      updateRenderedProductStocks();
      updateParkedCountBadge?.();
      refreshParkButtonUI?.();
      refreshParkedEditingBanner?.();
      if (
        parkedTicketsOverlay &&
        !parkedTicketsOverlay.classList.contains("hidden")
      ) {
        renderParkedTicketsModal?.();
      }
      return true;
    }

    return false;
  }
}

async function refreshStockAndReservationsOnly() {
  await Promise.allSettled([
    refreshProductsStockOnly(),
    refreshRemoteParkedReservationsOnly(),
  ]);

  updateRenderedProductStocks();
  return true;
}

function scheduleParkedReservationsBurstRefresh(reason = "manual") {
  if (TPV_STATE?.offline) return;

  // Limpia rafagas anteriores para no acumular timers en uso intensivo.
  (__parkedBurstRefreshTimers || []).forEach((id) => clearTimeout(id));
  __parkedBurstRefreshTimers = [];

  const runOnce = async () => {
    if (TPV_STATE?.offline) return;
    if (!cashSession?.open) return;
    try {
      await refreshRemoteParkedReservationsOnly();
    } catch (e) {
      console.warn(
        `Burst refresh reservas falló (${reason}):`,
        e?.message || e,
      );
    }
  };

  // inmediato + dos repeticiones cortas para converger entre 2 TPV.
  runOnce();
  __parkedBurstRefreshTimers.push(setTimeout(runOnce, 1200));
  __parkedBurstRefreshTimers.push(setTimeout(runOnce, 3200));
}

function startParkedReservationsAutoRefresh() {
  stopParkedReservationsAutoRefresh();

  const runOnce = async () => {
    if (__parkedReservationsRefreshInFlight) return;
    if (TPV_STATE?.offline) return;
    if (!cashSession?.open) return;

    __parkedReservationsRefreshInFlight = true;
    try {
      await refreshRemoteParkedReservationsOnly();
    } catch (e) {
      console.warn("Auto refresh reservas falló:", e?.message || e);
    } finally {
      __parkedReservationsRefreshInFlight = false;
    }
  };

  runOnce();

  __parkedReservationsRefreshTimer = setInterval(async () => {
    await runOnce();
  }, 4000);
}

function stopParkedReservationsAutoRefresh() {
  if (__parkedReservationsRefreshTimer) {
    clearInterval(__parkedReservationsRefreshTimer);
    __parkedReservationsRefreshTimer = null;
  }
}

async function refreshProductsStockOnly() {
  if (TPV_STATE?.offline) return false;

  try {
    const productosData = await fetchApiResource("productos");
    const list = Array.isArray(productosData) ? productosData : [];

    const stockById = new Map();
    list.forEach((p, idx) => {
      const idProd = Number(p.idproducto ?? p.id ?? idx);
      if (!idProd) return;
      stockById.set(idProd, p.stockfis);
    });

    if (!Array.isArray(products) || !products.length) {
      return false;
    }

    let changed = false;

    products = products.map((p) => {
      const baseId = Number(p.baseProductId || p.id || 0);
      if (!baseId) return p;
      if (!stockById.has(baseId)) return p;

      const nextRawStock = stockById.get(baseId);
      const nextStock = parseManagedStockValue(nextRawStock);
      const prevStock = parseManagedStockValue(p.stockfis);
      const prevRawStock = p.stockfisRaw;

      if (prevStock !== nextStock || prevRawStock !== nextRawStock) {
        changed = true;
        return {
          ...p,
          stockfisRaw: nextRawStock,
          stockfis: nextStock,
        };
      }

      return p;
    });

    if (!changed) return true;

    updateRenderedProductStocks();
    return true;
  } catch (e) {
    console.warn("No se pudieron refrescar stocks:", e?.message || e);
    return false;
  }
}

async function onPayButtonClick() {
  const requestId = createRequestId("PAY");

  let cartSnapshot = [];
  let saleLineIds = new Set();
  let saleCommitted = false;
  let didFastAutoPrint = false;
  let fastPreApiPrintedNumber = "";
  let releaseParkedCheckoutLock = null;

  try {
    if (isPayingNow) return;
    isPayingNow = true;
    refreshAgentGuardUI?.();

    window.__POSTPAY_PENDING__ = null;

    if (!cashSession || !cashSession.open) {
      toast("Abre la caja para poder cobrar.", "warn", "Cobrar");
      return;
    }

    if (!hasVisibleCartLines()) {
      toast("Añade productos antes de cobrar.", "warn", "Cobrar");
      return;
    }

    if (!currentTerminal) {
      toast("Debes seleccionar un terminal antes de cobrar.", "warn", "Cobrar");
      return;
    }

    const totalCart = round2(getCartTotal(cart));
    logFeatureInfo("COBRO", "inicio", {
      requestId,
      cartLines: Array.isArray(cart) ? cart.length : 0,
      total: Number(totalCart || 0),
      cajaId: getCajaIdSafe(),
      terminalId: currentTerminal?.id || null,
      agent: currentAgent?.name || currentAgent?.nick || "---",
    });

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
    const preParkedIndexForPay =
      currentParkedTicketIndex !== null
        ? Number(currentParkedTicketIndex)
        : null;
    const preParkedTicketForPay =
      preParkedIndexForPay != null && Array.isArray(parkedTickets)
        ? parkedTickets[preParkedIndexForPay] || null
        : null;

    const payResult = await openPayModal(totalCart, {
      initialObservaciones: String(preParkedTicketForPay?.obs || "").trim(),
    });
    if (!payResult) {
      logFeatureInfo("COBRO", "cancelado-usuario", {
        requestId,
        total: Number(totalCart || 0),
      });
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
    const snapshotGlobalDiscountPct = getCartGlobalDiscountPercent();
    cartSnapshot = Array.isArray(cart)
      ? cart.map((i) => ({
          ...i,
          cartGlobalDiscountPctApplied: snapshotGlobalDiscountPct,
        }))
      : [];
    saleLineIds = buildLineIdSetFromSnapshot(cartSnapshot);

    let parkedIndexToClose =
      currentParkedTicketIndex !== null
        ? Number(currentParkedTicketIndex)
        : null;

    const parkedTicketToClose =
      parkedIndexToClose != null && Array.isArray(parkedTickets)
        ? parkedTickets[parkedIndexToClose] || null
        : null;
    const parkedSyncKeyToClose = getParkedTicketSyncKey(parkedTicketToClose);
    const parkedIdToClose = Number(parkedTicketToClose?.id || 0) || 0;

    if (
      parkedTicketToClose &&
      isParkedTicketLockedByAnotherTerminal(parkedTicketToClose)
    ) {
      throw new Error(
        "Ese ticket aparcado se está cobrando en otro TPV. Espera unos segundos y vuelve a intentarlo.",
      );
    }

    releaseParkedCheckoutLock = beginParkedCheckoutLock(parkedIndexToClose);

    if (parkedIndexToClose != null) {
      await refreshRemoteParkedReservationsOnly();

      let syncedIdx = -1;
      if (parkedSyncKeyToClose) {
        syncedIdx = (
          Array.isArray(parkedTickets) ? parkedTickets : []
        ).findIndex((t) => getParkedTicketSyncKey(t) === parkedSyncKeyToClose);
      }
      if (syncedIdx < 0 && parkedIdToClose > 0) {
        syncedIdx = (
          Array.isArray(parkedTickets) ? parkedTickets : []
        ).findIndex((t) => Number(t?.id || 0) === parkedIdToClose);
      }

      if (syncedIdx < 0) {
        throw new Error(
          "El ticket aparcado ya no está disponible para cobrar (puede haberse cobrado o borrado en otro TPV).",
        );
      }

      const syncedTicket = parkedTickets[syncedIdx];
      if (!syncedTicket || syncedTicket.paid) {
        throw new Error("El ticket aparcado ya está cobrado en otro TPV.");
      }

      const paidTwin = findPaidTwinForParkedTicket(syncedTicket, parkedTickets);
      if (paidTwin) {
        syncedTicket.paid = true;
        syncedTicket.paidAt =
          paidTwin?.paidAt || syncedTicket.paidAt || new Date();
        syncedTicket.paidTicketCode =
          paidTwin?.paidTicketCode || syncedTicket.paidTicketCode || null;
        syncedTicket.paidTicketId =
          paidTwin?.paidTicketId || syncedTicket.paidTicketId || null;
        upsertParkedPaidHistory(syncedTicket);
        saveParkedTicketsCache();
        throw new Error(
          "Ese ticket aparcado ya aparece como cobrado y no se puede volver a cobrar.",
        );
      }

      if (isParkedTicketLockedByAnotherTerminal(syncedTicket)) {
        throw new Error(
          "Ese ticket aparcado se está cobrando en otro TPV. Espera unos segundos y vuelve a intentarlo.",
        );
      }

      parkedIndexToClose = syncedIdx;
    }

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

    const hasFastPredictorHistory = hasFastTicketPredictorHistory({
      codserie: ticketPayload?.codserie || ticketPayload?.serie,
      numero2: ticketPayload?.numero2,
      terminalId: ticketPayload?.idtpv || currentTerminal?.id,
    });

    // Preprint rapido: imprime antes de enviar a API usando numeracion local por serie/tipo
    if (isAutoPrintEnabled() && hasFastPredictorHistory) {
      try {
        const preApiDraft = buildFastPreApiTicketDraft(
          ticketPayload,
          cartSnapshot,
        );
        if (preApiDraft) {
          fastPreApiPrintedNumber = String(preApiDraft?.numero || "").trim();
          await printTicket(preApiDraft);
          didFastAutoPrint = true;
        }
      } catch (e) {
        console.warn("Preprint rápido falló:", e?.message || e);
      }
    }

    const payingItemsSnapshot = buildCustomerItemsFromCart(cartSnapshot);
    customerDisplayOverride = {
      items: payingItemsSnapshot,
      total: totalCart,
    };

    removeCartLinesByIdSet(saleLineIds);
    renderCart();

    // 4) Enviar o encolar
    const sendResult = await sendOrQueueFactura(ticketPayload);

    // ========= OFFLINE =========
    if (!sendResult.ok && sendResult.queued) {
      saleCommitted = true;
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

        // La venta ya está resuelta (offline en cola): deja de usar draft pendiente.
        window.__POSTPAY_PENDING__ = null;

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

      const hasNextCartAfterPay = (Array.isArray(cart) ? cart.length : 0) > 0;
      if (hasNextCartAfterPay) {
        customerDisplayOverride = null;
        customerSetMode("CART");
      } else {
        customerSetMode("THANKS", {
          ttlMs: 12000,
          total: Number(payResult?.total ?? totalCart ?? 0),
          ticket: lastTicket?.numero || "OFFLINE",
          paymentMethod: ticketPayload.paymentMethod || "",
          agent: ticketPayload._payNick || "",
          items: buildCustomerItemsFromCart(cartSnapshot),
        });
      }

      await markParkedTicketAsPaidByIndex(parkedIndexToClose, {
        idfactura: null,
        codigo:
          lastTicket?.numero ||
          `OFF-${String(sendResult.localId || "")
            .slice(0, 6)
            .toUpperCase()}`,
      });

      removeCartLinesByIdSet(saleLineIds);
      renderCart();
      await resetCartCustomerToTerminalDefault("pay-offline");
      setStatusText("Venta guardada en cola (offline)");
      toast("Sin internet: venta guardada en cola ✅", "ok", "Cobrar");
      logFeatureWarn("COBRO", "offline-cola", {
        requestId,
        total: Number(payResult?.total ?? totalCart ?? 0),
        localId: sendResult.localId || null,
        pagos: pagosFinal.map((p) => ({
          codpago: p.codpago,
          importe: Number(p.importe || 0),
        })),
      });
      return;
    }

    // ========= ONLINE =========
    saleCommitted = true;
    const apiResponse = sendResult?.remote || null;
    const facturaResp =
      apiResponse?.doc ||
      apiResponse?.factura ||
      apiResponse?.data ||
      apiResponse;

    if (!facturaResp || typeof facturaResp !== "object") {
      const remoteType = apiResponse == null ? "null" : typeof apiResponse;
      const remoteKeys =
        apiResponse && typeof apiResponse === "object"
          ? Object.keys(apiResponse).slice(0, 8).join(",")
          : "";
      throw new Error(
        `E_COBRO_RESP_INVALIDA: respuesta de venta inválida (sin doc/factura/data). tipo=${remoteType}${remoteKeys ? ` keys=${remoteKeys}` : ""}`,
      );
    }

    const idfactura = facturaResp?.idfactura || null;

    const confirmedTicketCode = String(facturaResp?.codigo || "").trim();
    const hadFastPreprintCode = String(fastPreApiPrintedNumber || "").trim();
    if (hadFastPreprintCode && confirmedTicketCode) {
      const preNorm = normalizeTicketCode(hadFastPreprintCode);
      const fsNorm = normalizeTicketCode(confirmedTicketCode);
      if (preNorm !== fsNorm) {
        logFeatureWarn("COBRO", "preprint-code-mismatch", {
          requestId,
          preprintedCode: hadFastPreprintCode,
          confirmedCode: confirmedTicketCode,
          codserie: ticketPayload?.codserie || ticketPayload?.serie || null,
          numero2: ticketPayload?.numero2 || null,
          terminalId: ticketPayload?.idtpv || currentTerminal?.id || null,
        });
      }
    }

    updateFastTicketNumberByConfirmedCode({
      codigo: facturaResp?.codigo,
      codserie: ticketPayload?.codserie || ticketPayload?.serie,
      numero2: ticketPayload?.numero2,
      idfactura,
      terminalId: ticketPayload?.idtpv || currentTerminal?.id,
    });

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

    await runProductsStockRefreshOnce();

    lastTicket = buildTicketPrintData(apiResponse, ticketPayload, cartSnapshot);

    // Ya tenemos ticket confirmado de FS: deja de usar draft pendiente.
    window.__POSTPAY_PENDING__ = null;

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

    if (isSafeTrainingModeEnabled() || sendResult?.simulated) {
      try {
        const simulatedId = Number(facturaResp?.idfactura || 0) || null;
        saveOfflineTicketForTicketsModal({
          _localId:
            (crypto?.randomUUID?.() ||
              `${Date.now()}_${Math.random().toString(16).slice(2)}`) + "_sim",
          idfactura: simulatedId,
          codigo:
            String(lastTicket?.numero || facturaResp?.codigo || "SIM") || "SIM",
          nombrecliente: String(lastTicket?.clientName || "Ventas tickets"),
          total: Number(facturaTotalFS || 0),
          codpago: pagosFinal?.[0]?.codpago || ticketPayload.codpago || "—",
          fecha: String(
            lastTicket?.fecha || new Date().toISOString().slice(0, 10),
          ),
          hora: String(
            lastTicket?.hora || new Date().toTimeString().slice(0, 8),
          ),
          lineas: Array.isArray(lastTicket?.lineas) ? lastTicket.lineas : [],
          pagos: Array.isArray(pagosFinal) ? pagosFinal : [],
          cambio: Number(lastTicket?.cambio || payResult?.cambio || 0),
          codserie: String(
            lastTicket?.codserie || ticketPayload?.codserie || "S",
          ),
          idcaja: Number(getCajaIdSafe?.() || 0) || 0,
          _offline: true,
          _simulated: true,
        });
      } catch (e) {
        console.warn("No se pudo guardar ticket simulado en listado:", e);
      }
    }

    const printBtn = document.getElementById("printTicketBtn");
    if (printBtn) printBtn.disabled = false;

    const hasNextCartAfterPay = (Array.isArray(cart) ? cart.length : 0) > 0;
    if (hasNextCartAfterPay) {
      customerDisplayOverride = null;
      customerSetMode("CART");
    } else {
      customerSetMode("THANKS", {
        ttlMs: 12000,
        total: facturaTotalFS,
        ticket: lastTicket?.numero || facturaResp?.codigo || "",
        paymentMethod: ticketPayload.paymentMethod || "",
        agent: ticketPayload._payNick || "",
        items: buildCustomerItemsFromCart(cartSnapshot),
      });
    }

    await markParkedTicketAsPaidByIndex(parkedIndexToClose, {
      idfactura: facturaResp?.idfactura || null,
      codigo: lastTicket?.numero || facturaResp?.codigo || null,
    });

    removeCartLinesByIdSet(saleLineIds);
    renderCart();
    await resetCartCustomerToTerminalDefault("pay-online");
    refreshParkButtonUI();
    refreshParkedEditingBanner();
    setStatusText("Venta cobrada");

    toast(
      lastTicket.numero
        ? `Venta cobrada ✅ (${ticketPayload.paymentMethod} - ${lastTicket.numero})`
        : `Venta cobrada ✅ (${ticketPayload.paymentMethod})`,
      "ok",
      "Cobrar",
    );

    if (isAutoPrintEnabled() && !didFastAutoPrint) {
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

    logFeatureInfo("COBRO", "ok", {
      requestId,
      ticket:
        lastTicket?.numero ||
        facturaResp?.codigo ||
        facturaResp?.idfactura ||
        null,
      idfactura: facturaResp?.idfactura || null,
      total: Number(facturaTotalFS || 0),
      pagos: pagosFinal.map((p) => ({
        codpago: p.codpago,
        importe: Number(p.importe || 0),
      })),
    });
  } catch (err) {
    logFeatureError("COBRO", "error", err, {
      requestId,
      cartLines: cartSnapshot.length,
      saleCommitted,
      cajaId: getCajaIdSafe(),
      terminalId: currentTerminal?.id || null,
    });
    console.error("Error al cobrar:", err);

    if (!saleCommitted && cartSnapshot.length) {
      releaseParkedCheckoutLock?.();
      releaseParkedCheckoutLock = null;
      restoreCartSnapshotWithoutDuplicates(cartSnapshot);
      renderCart();
    }

    customerSetMode("CART");
    let msg = String(err?.message || err || "Error desconocido").trim();
    let errCode = "E_COBRO";

    if (msg.toLowerCase().includes("stock")) {
      errCode = "E_COBRO_STOCK";
      msg =
        "No se puede cobrar porque uno o varios productos no tienen stock disponible.";
    } else if (msg.includes("E_COBRO_RESP_INVALIDA")) {
      errCode = "E_COBRO_RESP_INVALIDA";
      msg = msg.replace(/^E_COBRO_RESP_INVALIDA:\s*/i, "");
    } else if (msg.toLowerCase().includes("429")) {
      errCode = "E_COBRO_RATE_LIMIT";
    } else if (msg.toLowerCase().includes("timeout")) {
      errCode = "E_COBRO_TIMEOUT";
    }

    toast(`[${errCode}] ${msg}`, "err", "Cobrar");
    setStatusText("Error al cobrar");

    // Si falló el cobro, limpiar estado pendiente para no imprimir borradores o tickets previos.
    window.__POSTPAY_PENDING__ = null;
    if (isPostPayOpen()) {
      setPostPayPrintEnabled(!!lastTicket);
    }
  } finally {
    isPayingNow = false;
    refreshAgentGuardUI?.();
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

// ===== [09] Ajuste: abrir cajon siempre =====

function isCashPago(p) {
  const code = normalizeCashText(p?.codpago || "");

  const set = Array.isArray(window.__CASH_CODPAGOS__)
    ? window.__CASH_CODPAGOS__.map((x) => normalizeCashText(x))
    : [];

  // 1) si el API ya marcó cuáles son cash, usamos eso
  if (set.length && set.includes(code)) return true;

  if (CASH_CODPAGOS && CASH_CODPAGOS instanceof Set && CASH_CODPAGOS.size) {
    if (CASH_CODPAGOS.has(code)) return true;
  }

  // 2) fallback por código/descripcion (por si no cargó formapagos aún)
  return looksLikeCashMethod({
    codpago: p?.codpago,
    descripcion: p?.descripcion,
  });
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

  if (isSafeTrainingModeEnabled()) return;

  await apiWrite(`tpvcajas/${remoteId}`, "PUT", payload);
}

// ===== [08] UI venta: boton eliminar todo =====
const clearBtn = document.getElementById("clearCartBtn");
if (clearBtn) {
  clearBtn.onclick = () => {
    if (!cashSession?.open) return;

    cart = [];
    renderCart();
    currentParkedTicketIndex = null;
    refreshParkButtonUI();
    refreshParkedEditingBanner();
  };
}

// ===== [08] UI venta: boton cobrar =====
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

// ===== [07] API pago: resolver forma de pago EFECTIVO =====
let CASH_CODPAGOS = new Set();

const CASH_DESC_HINTS = [
  "contado",
  "efectivo",
  "cash",
  "metalico",
  "metalic",
  "billete",
  "moneda",
];

const CASH_CODE_HINTS = ["CONT", "EFEC", "CASH", "METAL", "MET", "EFE"];

function normalizeCashText(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function looksLikeCashMethod({ codpago, descripcion }) {
  const code = normalizeCashText(codpago);
  const descNorm = normalizeCashText(descripcion).toLowerCase();

  if (!code && !descNorm) return false;

  if (CASH_CODE_HINTS.some((k) => code === k || code.startsWith(k))) {
    return true;
  }

  return CASH_DESC_HINTS.some((k) => descNorm.includes(k));
}

function buildCashCodpagosFromFormapagos(list) {
  const s = new Set();

  (list || []).forEach((fp) => {
    const cod = normalizeCashText(fp.codpago);

    if (
      cod &&
      looksLikeCashMethod({
        codpago: cod,
        descripcion: fp.descripcion,
      })
    ) {
      s.add(cod);
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

// ===== [09] Modal cobrar (UI tipo FacturaScripts) =====
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

let PAY_SERIES_CACHE = null;

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

function normalizePaySeriesRows(rawList) {
  const src = Array.isArray(rawList) ? rawList : [];
  const out = [];
  const seen = new Set();

  src.forEach((row) => {
    const cod = String(row?.codserie || "")
      .trim()
      .toUpperCase();
    if (cod !== "S" && cod !== "A") return;
    if (!cod || seen.has(cod)) return;

    seen.add(cod);
    out.push({
      codserie: cod,
      descripcion: String(row?.descripcion || cod).trim(),
      tipo: String(row?.tipo || "")
        .trim()
        .toUpperCase(),
    });
  });

  // Fallback seguro para TPV: simplificada y general.
  if (!seen.has("S")) {
    out.push({ codserie: "S", descripcion: "Simplificadas", tipo: "S" });
    seen.add("S");
  }
  if (!seen.has("A")) {
    out.push({ codserie: "A", descripcion: "General", tipo: "" });
    seen.add("A");
  }

  return out.sort((a, b) => {
    const pri = (x) => (x.codserie === "S" ? 0 : x.codserie === "A" ? 1 : 9);
    const pa = pri(a);
    const pb = pri(b);
    if (pa !== pb) return pa - pb;
    return String(a.descripcion || a.codserie).localeCompare(
      String(b.descripcion || b.codserie),
      "es",
    );
  });
}

function renderPaySerieOptions(seriesRows) {
  if (!paySerie) return;

  const rows = normalizePaySeriesRows(seriesRows);
  paySerie.innerHTML = rows
    .map((s) => {
      const cod = String(s.codserie || "")
        .trim()
        .toUpperCase();
      const label = String(s.descripcion || cod).trim() || cod;
      return `<option value="${escapeHtml(cod)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  const hasSimplificada = rows.some((r) => r.codserie === "S");
  paySerie.value = hasSimplificada ? "S" : rows[0]?.codserie || "S";
}

async function ensurePaySeriesLoaded() {
  if (Array.isArray(PAY_SERIES_CACHE) && PAY_SERIES_CACHE.length) {
    renderPaySerieOptions(PAY_SERIES_CACHE);
    return;
  }

  try {
    const rows = await fetchApiResource("series");
    PAY_SERIES_CACHE = normalizePaySeriesRows(rows);
  } catch (e) {
    console.warn("No se pudo cargar series de facturas:", e?.message || e);
    PAY_SERIES_CACHE = normalizePaySeriesRows([]);
  }

  renderPaySerieOptions(PAY_SERIES_CACHE);
}

function getSelectedCustomerPrintMeta() {
  const selected = window.CUSTOMER_SELECTOR?.getSelectedCustomer?.() || null;
  const cod = String(
    selected?.codcliente ||
      window.CUSTOMER_SELECTOR?.getSelectedCustomerCodcliente?.() ||
      "",
  )
    .trim()
    .toUpperCase();

  const list =
    typeof window.CUSTOMER_SELECTOR?.listCustomers === "function"
      ? window.CUSTOMER_SELECTOR.listCustomers()
      : [];

  const full = Array.isArray(list)
    ? list.find(
        (c) =>
          String(c?.codcliente || "")
            .trim()
            .toUpperCase() === cod,
      ) || selected
    : selected;

  const cache = getCustomerPrintCacheByCod(
    cod || String(full?.codcliente || "").trim(),
  );
  const raw = full?._raw || null;

  const name = String(
    cache?.razonsocial ||
      cache?.nombre ||
      full?.razonsocial ||
      full?.nombre ||
      selected?.nombre ||
      "Cliente",
  ).trim();

  const fiscalId = String(
    cache?.cifnif || full?.cifnif || full?.cif || raw?.cifnif || raw?.cif || "",
  ).trim();

  const address = [
    String(cache?.direccion || full?.direccion || raw?.direccion || "").trim(),
    String(cache?.codpostal || full?.codpostal || raw?.codpostal || "").trim(),
    String(cache?.ciudad || full?.ciudad || raw?.ciudad || "").trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    codcliente: cod || String(full?.codcliente || "").trim() || "1",
    clientName: name || "Cliente",
    clientFiscalId: fiscalId,
    clientAddress: address,
    isDefaultCustomer:
      cod === "1" ||
      full?.isDefault === true ||
      /^ventas\s*tickets$/i.test(String(name || "")),
  };
}

async function fetchClienteByCodcliente(codcliente) {
  const cod = String(codcliente || "").trim();
  if (!cod) return null;

  const cached = getCustomerPrintCacheByCod(cod);
  if (cached) return cached;

  try {
    const rows = await fetchApiResourceWithParams("clientes", {
      limit: 1,
      "filter[codcliente]": cod,
    });
    const cli = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (cli) upsertCustomerPrintCache(cli);
    return cli;
  } catch (e) {
    console.warn("No se pudo cargar cliente por codcliente:", e?.message || e);
    return null;
  }
}

async function enrichTicketClientForGeneral(ticket) {
  const serie = String(ticket?.codserie || ticket?._raw?.codserie || "")
    .trim()
    .toUpperCase();
  if (serie !== "A") return ticket;

  const hasFiscal = !!String(ticket?.clientFiscalId || "").trim();
  const hasAddress = !!String(ticket?.clientAddress || "").trim();
  if (hasFiscal && hasAddress) return ticket;

  let codcliente = String(
    ticket?.codcliente || ticket?._raw?.codcliente || "",
  ).trim();

  if (!codcliente) {
    const idfactura = Number(ticket?.idfactura || ticket?._raw?.idfactura || 0);
    if (idfactura > 0) {
      try {
        const fc = await fetchFacturaClienteById(idfactura);
        codcliente = String(fc?.codcliente || "").trim();
        const facturaName = String(fc?.nombrecliente || "").trim();
        const facturaFiscal = String(fc?.cifnif || "").trim();
        const facturaAddress = [
          String(fc?.direccion || "").trim(),
          String(fc?.codpostal || "").trim(),
          String(fc?.ciudad || "").trim(),
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

        if (facturaName) ticket.clientName = facturaName;
        if (facturaFiscal) ticket.clientFiscalId = facturaFiscal;
        if (facturaAddress) ticket.clientAddress = facturaAddress;
      } catch (e) {
        console.warn(
          "No se pudo leer factura para codcliente:",
          e?.message || e,
        );
      }
    }
  }

  if (!codcliente) return ticket;

  const cli = await fetchClienteByCodcliente(codcliente);
  if (!cli) return ticket;

  const fiscal = String(cli?.cifnif || cli?.cif || "").trim();
  const address = [
    String(cli?.direccion || "").trim(),
    String(cli?.codpostal || "").trim(),
    String(cli?.ciudad || "").trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const betterName = String(cli?.razonsocial || cli?.nombre || "").trim();
  if (betterName) ticket.clientName = betterName;
  if (fiscal) ticket.clientFiscalId = fiscal;
  if (address) ticket.clientAddress = address;
  ticket.codcliente = codcliente;

  return ticket;
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

// ===== [09] Modal cobrar: binding keypad (una sola vez) =====
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

// ===== [09] Modal cobrar: flujo principal =====
async function openPayModal(total, options = {}) {
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

  // cargar series disponibles (S/A y resto que devuelva FS)
  await ensurePaySeriesLoaded();

  // limpiar extras
  const initialObservaciones = String(
    options?.initialObservaciones || "",
  ).trim();
  if (payObs) payObs.value = initialObservaciones;
  if (payNumber) payNumber.value = "";
  if (paySerie && !String(paySerie.value || "").trim()) paySerie.value = "S";

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

        const selectedSerie = String(paySerie ? paySerie.value || "S" : "S")
          .trim()
          .toUpperCase();

        const result = {
          pagos,
          total: fromCents(totalC),
          pagado: fromCents(pagadoEntregadoC),
          cambio: fromCents(cambioC),
          observaciones: payObs ? String(payObs.value || "") : "",
          numero: payNumber ? String(payNumber.value || "") : "",
          serie: selectedSerie || "S",
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
          const pendingPayload = {
            codserie: result.serie || "S",
            serie: result.serie || "S",
            numero2: result.numero || "",
            idtpv: Number(currentTerminal?.id || 0) || null,
            paymentMethod:
              (Array.isArray(pagos) && pagos.length === 1
                ? pagos?.[0]?.descripcion || pagos?.[0]?.codpago
                : "Mixto") || "—",
            _payBreakdown: Array.isArray(pagos) ? pagos : [],
            _payCambio: Number(result.cambio || 0),
          };

          const canFastPrintPending = hasFastTicketPredictorHistory({
            codserie: pendingPayload.codserie,
            numero2: pendingPayload.numero2,
            terminalId: pendingPayload.idtpv || currentTerminal?.id,
          });

          const pendingDraft = canFastPrintPending
            ? buildFastPreApiTicketDraft(pendingPayload, cart)
            : null;

          window.__POSTPAY_PENDING__ = {
            docCode: "Procesando…",
            total: result.total,
            cambio: result.cambio,
            printDraft: pendingDraft,
          };
          openPostPayModal(window.__POSTPAY_PENDING__);
          setPostPayPrintEnabled(!!pendingDraft);
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
const parkNameInput = document.getElementById("parkNameInput");
const parkNameKeyboardBtn = document.getElementById("parkNameKeyboardBtn");

function openParkObsModal() {
  const overlay = document.getElementById("parkObsOverlay");
  const nameInput = document.getElementById("parkNameInput");
  const obsInput = document.getElementById("parkObsInput");

  if (!overlay || !nameInput || !obsInput) {
    toast("Falta el HTML del modal de aparcar.", "err", "Aparcar");
    return;
  }

  // ✅ si estamos editando un ticket ya cargado, rellenar datos
  if (
    currentParkedTicketIndex !== null &&
    Array.isArray(parkedTickets) &&
    parkedTickets[currentParkedTicketIndex]
  ) {
    const t = parkedTickets[currentParkedTicketIndex];
    nameInput.value = t.name || "";
    obsInput.value = t.obs || "";
  } else {
    nameInput.value = "";
    obsInput.value = "";
  }

  overlay.classList.remove("hidden");
  nameInput.focus();
}

function closeParkObsModal() {
  parkObsOverlay.classList.add("hidden");
}

parkBtn?.addEventListener("click", () => {
  if (!cashSession?.open) {
    toast("Abre la caja para aparcar tickets.", "warn", "Aparcar");
    return;
  }

  // 1) No permitir aparcar si el carrito está vacío
  if (!hasVisibleCartLines()) {
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
  const ticketName = (parkNameInput?.value || "").trim();
  const obs = (parkObsInput?.value || "").trim();

  closeParkObsModal();
  parkCurrentCart(ticketName, obs);
});

parkObsKeyboardBtn?.addEventListener("click", () => {
  // Reutiliza tu teclado QWERTY actual
  // Necesitas una función tipo: openQwerty(targetInput)
  openQwertyForInput(parkObsInput);
});

parkNameKeyboardBtn?.addEventListener("click", () => {
  openQwertyForInput(parkNameInput, "text");
});

parkObsKeyboardBtn?.addEventListener("click", () => {
  openQwertyForInput(parkObsInput, "text");
});

// Botón ver/recuperar aparcados
const parkedListBtn = document.getElementById("parkedListBtn");
if (parkedListBtn) {
  parkedListBtn.onclick = () => {
    if (!cashSession?.open) {
      toast("Abre la caja para ver aparcados.", "info", "Aparcados");
      return;
    }

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
  const requestId = createRequestId("TKMOD");

  if (!cashSession?.open) {
    toast("Abre la caja para ver tickets.", "info", "Tickets");
    return;
  }

  if (!ticketsOverlay) {
    toast(
      "Falta el HTML del modal de tickets (#ticketsOverlay).",
      "err",
      "Tickets",
    );
    return;
  }

  ticketsOverlay.classList.remove("hidden");
  logFeatureInfo("TICKETS", "modal-abierto", {
    requestId,
    cajaId: getCajaIdSafe(),
    tab: ticketsViewState.tab,
  });
  syncTicketsToolbarUI();
  syncTicketsSearchClearBtn();
  syncTicketsExtraActionsUI();
  await renderQueuedTicketsIfAny();
  await loadAndRenderTickets(requestId);
}

function closeTicketsModal() {
  if (!ticketsOverlay) return;
  ticketsOverlay.classList.add("hidden");
}

async function loadAndRenderTickets(requestId = null) {
  const reqId = requestId || createRequestId("TKLOAD");

  if (!ticketsList) return;
  if (ticketsLoading) return;
  ticketsLoading = true;

  try {
    ticketsList.innerHTML = "Cargando…";

    // ✅ En modo pruebas mostramos solo tickets locales/simulados
    if (isSafeTrainingModeEnabled()) {
      ticketsCache = [];
      const merged = getAllTicketsForUI([]);
      linkTicketsRefundRelations(merged);
      ticketsUiCache = merged;
      renderTicketsList(merged);
      logFeatureInfo("TICKETS", "carga-ok-training", {
        requestId: reqId,
        total: merged.length,
      });
      return;
    }

    // ✅ Online -> trae de API y guarda cache
    if (!TPV_STATE?.offline) {
      ticketsCache = await fetchUltimosTickets(60);
      saveTicketsCache(ticketsCache);

      const merged = getAllTicketsForUI(ticketsCache);

      // ✅ AQUÍ: usar merged, no "list"
      linkTicketsRefundRelations(merged);

      ticketsUiCache = merged;
      renderTicketsList(merged);
      logFeatureInfo("TICKETS", "carga-ok-online", {
        requestId: reqId,
        total: merged.length,
      });
      return;
    }

    // ✅ Offline -> usar cache (histórico)
    const cached = loadTicketsCache();
    ticketsCache = cached;

    const merged = getAllTicketsForUI(ticketsCache);

    linkTicketsRefundRelations(merged);
    ticketsUiCache = merged;
    renderTicketsList(merged);
    logFeatureInfo("TICKETS", "carga-ok-offline", {
      requestId: reqId,
      total: merged.length,
    });
  } catch (e) {
    logFeatureError("TICKETS", "carga-error", e, {
      requestId: reqId,
      offline: !!TPV_STATE?.offline,
    });
    console.error(e);

    // ✅ fallback final: usa cache + offline local (aunque cache esté vacío)
    const cached = loadTicketsCache();
    ticketsCache = cached;

    const merged = getAllTicketsForUI(ticketsCache);
    if (merged.length) {
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

function removeOfflineTicketByMatch(ticketRow) {
  const list = loadOfflineTicketsForTicketsModal();
  if (!Array.isArray(list) || !list.length) return false;

  const code = String(ticketRow?.codigo || "").trim();
  const targetId = String(ticketRow?.idfactura || "").trim();
  let removed = false;

  const next = list.filter((row) => {
    if (removed) return true;

    const rowCode = String(row?.codigo || "").trim();
    const rowId = String(row?.idfactura || "").trim();

    const sameCode = !!code && rowCode === code;
    const sameId = !!targetId && rowId === targetId;

    if (sameCode || sameId) {
      removed = true;
      return false;
    }
    return true;
  });

  if (!removed) return false;
  localStorage.setItem(OFFLINE_TICKETS_KEY, JSON.stringify(next));
  return true;
}

function markOfflineTicketFullyRefunded(ticketRow) {
  const list = loadOfflineTicketsForTicketsModal();
  if (!Array.isArray(list) || !list.length) return false;

  const code = String(ticketRow?.codigo || "").trim();
  const targetId = String(ticketRow?.idfactura || "").trim();
  let changed = false;

  const next = list.map((row) => {
    const rowCode = String(row?.codigo || "").trim();
    const rowId = String(row?.idfactura || "").trim();
    const sameCode = !!code && rowCode === code;
    const sameId = !!targetId && rowId === targetId;
    if (!sameCode && !sameId) return row;

    changed = true;
    return {
      ...row,
      _simulated: true,
      _hasPartialRefund: true,
      _isFullyRefunded: true,
      _remainingAfterRefund: 0,
    };
  });

  if (!changed) return false;
  localStorage.setItem(OFFLINE_TICKETS_KEY, JSON.stringify(next));
  return true;
}

async function deleteSimulatedTicketLocal(ticketRow) {
  const ok = await confirmModal(
    "Eliminar ticket simulado",
    `¿Eliminar ${ticketRow?.codigo || "ticket"} del entorno de pruebas?`,
  );
  if (!ok) return;

  if (!removeOfflineTicketByMatch(ticketRow)) {
    toast(
      "No se encontró el ticket simulado para eliminar.",
      "warn",
      "Tickets",
    );
    return;
  }

  toast("Ticket simulado eliminado.", "ok", "Tickets");
  await loadAndRenderTickets();
}

async function refundSimulatedTicketLocal(ticketRow) {
  const totalAbs = Math.abs(Number(ticketRow?.total || 0));
  if (!(totalAbs > 0.0001)) {
    toast(
      "El ticket simulado no tiene importe para devolver.",
      "warn",
      "Tickets",
    );
    return;
  }

  const ok = await confirmModal(
    "Devolución simulada",
    `Se marcará ${ticketRow?.codigo || "ticket"} como devuelto y se creará su abono simulado.`,
  );
  if (!ok) return;

  const baseId = Number(ticketRow?.idfactura || 0) || 900000;
  const refundCode = nextSafeTrainingSimRefundCode();
  const refundId =
    990000 + readSafeTrainingSequence(TPV_SAFE_TRAINING_SIM_REFUND_SEQ_KEY);

  markOfflineTicketFullyRefunded(ticketRow);
  saveOfflineTicketForTicketsModal({
    codigo: refundCode,
    idfactura: refundId,
    idfacturarect: baseId,
    codigorect: String(ticketRow?.codigo || ""),
    nombrecliente: ticketRow?.nombrecliente || "Cliente",
    total: -totalAbs,
    codpago: String(ticketRow?.codpago || ""),
    fecha: new Date().toISOString().slice(0, 10),
    hora: new Date().toTimeString().slice(0, 8),
    codserie: "R",
    _simulated: true,
  });

  toast("Devolución simulada registrada.", "ok", "Tickets");
  await loadAndRenderTickets();
}

function renderTicketsList(tickets) {
  if (!ticketsList) return;

  renderTicketsSummary(tickets);

  const term = (ticketsSearch?.value || "").trim().toLowerCase();
  const sourceList = Array.isArray(tickets) ? tickets : [];

  const matchesTicket = (t) => {
    const parkedOrigin = getPaidTicketParkedOriginForTicketRow(t);
    const parkedOriginText = parkedOrigin
      ? `${parkedOrigin.parkedDisplayNo || ""} ${parkedOrigin.parkedLabel || ""} ${parkedOrigin.parkedClientName || ""}`
      : "";

    const s = `${t.codigo || ""} ${t.nombrecliente || ""} ${t.total || ""} ${
      t.codpago || ""
    } ${t.codserie || ""} ${t.idfactura || ""} ${t.codigorect || ""} ${
      t.idcaja || t?._raw?.idcaja || ""
    } ${parkedOriginText}`.toLowerCase();

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
    const isSimulated = isSimulatedTicketLike(t);

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

    if (isSimulated) {
      badgeHtml += ` <span class="ticket-badge ticket-badge-sim">SIM</span>`;
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

    const ticketIdText = t.idfactura
      ? `ID ${t.idfactura}`
      : isSimulated
        ? "ID SIM"
        : "ID —";

    const parkedOrigin = getPaidTicketParkedOriginForTicketRow(t);
    const parkedOriginNo = String(parkedOrigin?.parkedDisplayNo || "").trim();
    const parkedOriginLabel = String(parkedOrigin?.parkedLabel || "").trim();
    const parkedOriginClient = String(
      parkedOrigin?.parkedClientName || "",
    ).trim();
    const parkedOriginText = parkedOrigin
      ? parkedOriginLabel ||
        parkedOriginClient ||
        (parkedOriginNo ? `Ticket #${parkedOriginNo}` : "")
      : "";

    const parkedOriginHtml = parkedOrigin
      ? `<div class="ticket-obs">Origen aparcado: ${escapeHtml(
          parkedOriginNo ? `#${parkedOriginNo}` : "#—",
        )}${parkedOriginText ? ` · ${escapeHtml(parkedOriginText)}` : ""}</div>`
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
          <span class="ticket-id">${ticketIdText}</span>
        </div>

        ${obs ? `<div class="ticket-obs">${escapeHtml(obs)}</div>` : ""}
        ${parkedOriginHtml}
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

          ${
            isSimulated
              ? `<button type="button" class="ticket-btn ticket-delete" title="Eliminar">🗑</button>`
              : ""
          }

          ${
            isSimulated
              ? ""
              : `<button type="button" class="ticket-btn ticket-payedit" title="Cambiar pago">💳</button>`
          }
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
        if (isSimulated) {
          await refundSimulatedTicketLocal(t);
          return;
        }
        await openRefundForFactura(t);
      };
    }

    const deleteBtn = div.querySelector(".ticket-delete");
    if (deleteBtn) {
      deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        await deleteSimulatedTicketLocal(t);
      };
    }

    const payEditBtn = div.querySelector(".ticket-payedit");
    if (payEditBtn) {
      payEditBtn.onclick = async (e) => {
        e.stopPropagation();
        await openPayEditForFactura(t);
      };
    }

    div.onclick = () => {};

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
  throwIfApi429Cooldown("validateBaseUrlOrThrow");

  const url = `${baseUrl.replace(/\/+$/, "")}/productos?limit=1`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", Token: apiKey },
      cache: "no-store",
      signal: controller.signal,
    });

    if (res.status === 429) {
      triggerApi429Cooldown(
        "validateBaseUrlOrThrow",
        res.headers?.get?.("Retry-After") || "",
      );
      throw buildApi429Error();
    }

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
  let typedEmail = "";

  try {
    toast("Conectando…", "info");

    const savedRaw = await getPersistedCompanyCfg();
    const saved = getSavedCompanySnapshot(savedRaw);

    let resolved = null;

    if (saved.isComplete) {
      resolved = {
        email: saved.email,
        baseUrl: saved.baseUrl,
        apiKey: saved.apiKey,
      };
    } else {
      if (TPV_STATE?.apiRecovering) {
        showReconnectIfAvailable(
          "No hay conexión con Recipok. Espera por favor, reconectando...",
        );
        return false;
      }

      typedEmail = normalizeEmail(await askEmailWithModal());

      if (!typedEmail) {
        toast("Conexión cancelada.", "warn");
        return false;
      }

      resolved = await resolveCompanyByEmail(typedEmail);
      resolved = { ...resolved, email: typedEmail };
    }

    await saveResolvedCompanyFull(resolved, resolved.email || typedEmail);
    await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);

    hideReconnectIfAvailable();
    setConnectionStateOnline();

    toast("Conectado ✅", "ok");

    await loadDataFromApi({ refresh: true });
    return true;
  } catch (e) {
    const msg = e?.message || String(e);

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

    if (isConnectivityLikeError(e)) {
      setActivationRecovering(
        "Se perdió la conexión mientras activábamos el TPV. Espera por favor, reconectando...",
        typedEmail,
      );
      toast("Seguimos intentando reconectar…", "warn");
      return false;
    }

    toast("No se pudo conectar: " + msg, "warn");
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
    debugLog("Formas de pago precargadas:", methods?.length || 0);
  } catch (e) {
    console.warn("No se pudieron precargar formapagos:", e?.message || e);
  }

  try {
    const list = await refreshTicketsCacheFromServer(); // usa tu función (limit 300)
    debugLog("Tickets precargados:", list?.length || 0);
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
  window.__tpvDemoWarnedKeys = window.__tpvDemoWarnedKeys || new Set();

  try {
    const base = (
      window.RECIPOK_API?.baseUrl ||
      localStorage.getItem("tpv_baseUrl") ||
      ""
    ).trim();

    if (/\/demo\/api\/\d+/i.test(base)) {
      const key = `${base}|${String(where || "")}`;
      if (!window.__tpvDemoWarnedKeys.has(key)) {
        window.__tpvDemoWarnedKeys.add(key);
        console.warn(`[WARN] baseUrl apunta a DEMO ${where}:`, base);
      }
    }
  } catch {}
}

let PENDING_COMPANY_EMAIL = "";
let ACTIVATION_RECOVERY_IN_FLIGHT = false;

function getSavedCompanySnapshot(saved = {}) {
  const hasOwn = (obj, key) =>
    !!obj && Object.prototype.hasOwnProperty.call(obj, key);

  const hasNewEmailKey = hasOwn(saved, "company.email");
  const hasNewBaseUrlKey = hasOwn(saved, "company.baseUrl");
  const hasNewApiKeyKey = hasOwn(saved, "company.apiKey");

  const emailNew = normalizeEmail(saved?.["company.email"] ?? "");
  const baseUrlNew = String(saved?.["company.baseUrl"] ?? "").trim();
  const apiKeyNew = String(saved?.["company.apiKey"] ?? "").trim();

  const emailNormalized = normalizeEmail(saved?.email ?? "");
  const baseUrlNormalized = String(saved?.baseUrl ?? "").trim();
  const apiKeyNormalized = String(saved?.apiKey ?? "").trim();

  const emailLegacy = normalizeEmail(
    saved?.companyEmail || localStorage.getItem("tpv_companyEmail") || "",
  );

  const baseUrlLegacy = String(
    localStorage.getItem("tpv_baseUrl") || "",
  ).trim();

  const apiKeyLegacy = String(localStorage.getItem("tpv_apiKey") || "").trim();

  const email = hasNewEmailKey ? emailNew : emailNormalized || emailLegacy;

  const baseUrl = hasNewBaseUrlKey
    ? baseUrlNew
    : baseUrlNormalized || baseUrlLegacy;

  const apiKey = hasNewApiKeyKey ? apiKeyNew : apiKeyNormalized || apiKeyLegacy;

  return {
    email,
    baseUrl,
    apiKey,
    hasEmail: !!email,
    isComplete: !!(email && baseUrl && apiKey),
  };
}

function isConnectivityLikeError(err) {
  const msg = String(err?.message || err || "").toLowerCase();

  return (
    !!TPV_STATE?.offline ||
    !!TPV_STATE?.apiRecovering ||
    msg.includes("offline") ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch") ||
    msg.includes("timeout") ||
    msg.includes("abort") ||
    msg.includes("429") ||
    msg.includes("demasiadas peticiones") ||
    msg.includes("respuesta no válida")
  );
}

function ensureRecipokApiObject() {
  if (!window.RECIPOK_API) window.RECIPOK_API = {};
}

function setConnectionStateOnline() {
  TPV_STATE.offline = false;
  TPV_STATE.locked = false;
  updateCashButtonLabel();

  // Reintento rápido al volver internet para sincronizar aparcados en cola.
  processParkedSyncQueue()
    .then(() => refreshRemoteParkedReservationsOnly())
    .catch(() => {});
}

function isReconnectOverlayVisible() {
  const overlay = document.getElementById("reconnectOverlay");
  return !!overlay && !overlay.classList.contains("hidden");
}

function showReconnectOverlay(
  message = "No hay conexión con Recipok. Espera por favor, reconectando...",
) {
  const overlay = document.getElementById("reconnectOverlay");
  const text = document.getElementById("reconnectText");

  if (text) {
    text.textContent = message;
  }

  if (overlay) {
    overlay.classList.remove("hidden");
  }
}

function hideReconnectOverlay() {
  const overlay = document.getElementById("reconnectOverlay");

  if (overlay) {
    overlay.classList.add("hidden");
  }
}

function showReconnectIfAvailable(
  message = "No hay conexión con Recipok. Espera por favor, reconectando...",
  opts = {},
) {
  const { forceOverlay = false } = opts;

  if (!forceOverlay) {
    const hasOfflineData = hasRealDataLoaded() || !!loadBootSnapshot?.();
    if (hasOfflineData) {
      hideReconnectIfAvailable();
      setStatusText("Sin internet (modo offline). Reintentando conexión...");
      return;
    }
  }

  try {
    if (typeof showReconnectOverlay === "function") {
      showReconnectOverlay(message);
    }
  } catch {}
}

function hideReconnectIfAvailable() {
  try {
    if (typeof hideReconnectOverlay === "function") {
      hideReconnectOverlay();
    }
  } catch {}
}

function setActivationRecovering(
  message = "Se perdió la conexión mientras activábamos el TPV. Espera por favor, reconectando...",
  email = "",
) {
  if (email) {
    PENDING_COMPANY_EMAIL = normalizeEmail(email);
  }

  TPV_STATE.offline = true;
  TPV_STATE.apiRecovering = true;
  TPV_STATE.locked = false;
  updateCashButtonLabel();

  showReconnectIfAvailable(message);
}

async function saveResolvedCompanyFull(resolved, email = "") {
  const full = {
    ...resolved,
    email: normalizeEmail(email || resolved?.email || ""),
  };

  if (typeof saveResolvedCompany === "function") {
    await saveResolvedCompany(full);
  } else if (typeof persistCompanyCfg === "function") {
    await persistCompanyCfg(full);
  }

  return full;
}

async function resumePendingCompanyActivation(opts = {}) {
  const { promptIfNoPending = false } = opts;

  if (ACTIVATION_RECOVERY_IN_FLIGHT) return false;
  ACTIVATION_RECOVERY_IN_FLIGHT = true;

  try {
    let email = normalizeEmail(PENDING_COMPANY_EMAIL || "");

    if (!email && promptIfNoPending) {
      hideReconnectIfAvailable();
      email = normalizeEmail(await askEmailWithModal());
    }

    if (!email) return false;

    const resolved = await resolveCompanyByEmail(email);
    const full = await saveResolvedCompanyFull(resolved, email);

    PENDING_COMPANY_EMAIL = "";

    await validateBaseUrlOrThrow(full.baseUrl, full.apiKey);

    hideReconnectIfAvailable();
    setConnectionStateOnline();

    await loadDataFromApi({ refresh: true });
    return true;
  } catch (e) {
    if (isConnectivityLikeError(e)) {
      setActivationRecovering(
        "Se perdió la conexión mientras activábamos el TPV. Espera por favor, reconectando...",
      );
      return false;
    }

    PENDING_COMPANY_EMAIL = "";
    hideReconnectIfAvailable();

    toast(
      "No se pudo activar el TPV: " + (e?.message || e),
      "err",
      "Activación",
    );
    return false;
  } finally {
    ACTIVATION_RECOVERY_IN_FLIGHT = false;
  }
}

async function bootstrapCompany() {
  debugLog("bootstrapCompany() ejecutándose...");

  await hydrateLegacyCompanyFromCfg();
  await repairCompanyPersistenceIfNeeded();

  ensureRecipokApiObject();

  const savedRaw = await getPersistedCompanyCfg();
  const saved = getSavedCompanySnapshot(savedRaw);

  const applyResolved = ({ baseUrl, apiKey }) => {
    window.RECIPOK_API.baseUrl = String(baseUrl || "").trim();
    window.RECIPOK_API.apiKey = String(apiKey || "").trim();
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

  let clientsData = null;

  try {
    clientsData = await fetchClientsJson();
  } catch (e) {
    console.warn("No se pudo cargar clients.json:", e);
    clientsData = null;
  }

  const findClientByEmail = (email) => {
    if (!clientsData || !Array.isArray(clientsData.clients)) return null;

    const e = normalizeEmail(email);

    return (
      clientsData.clients.find((c) => normalizeEmail(c.email) === e) || null
    );
  };

  const askAndResolve = async () => {
    // Si no hay conexión o estamos recuperando, NO pedir email
    if (TPV_STATE?.apiRecovering || !clientsData) {
      showReconnectIfAvailable(
        "No hay conexión con Recipok. Espera por favor, reconectando...",
      );
      return null;
    }

    while (true) {
      let email = await askEmailWithModal();
      email = normalizeEmail(email);

      if (!email) {
        toast("Activación cancelada.", "warn", "Activación");
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

      try {
        const resolved = await resolveCompanyByEmail(email);
        return { ...resolved, email };
      } catch (e) {
        if (isConnectivityLikeError(e)) {
          setActivationRecovering(
            "Se perdió la conexión mientras validábamos el email. Espera por favor, reconectando...",
            email,
          );
          return null;
        }

        throw e;
      }
    }
  };

  // =================================================
  // 1) SI YA HAY CFG COMPLETA GUARDADA
  // =================================================
  if (saved.isComplete) {
    applyResolved(saved);
    persistLegacyLocal(saved);
    await persistCompanyCfg(saved).catch(() => {});
    logCompanyCfg("after applyResolved(saved)");
    warnIfDemoBaseUrl("(boot)");

    // Si estamos sin conexión o aún recuperando, no repidas email.
    // Ya tenemos empresa vinculada.
    if (TPV_STATE?.offline || TPV_STATE?.apiRecovering || !clientsData) {
      showReconnectIfAvailable(
        "No hay conexión con Recipok. Espera por favor, reconectando...",
      );
      return true;
    }

    const client = findClientByEmail(saved.email);

    if (client && client.active === false) {
      TPV_STATE.locked = true;
      TPV_STATE.offline = false;
      updateCashButtonLabel();

      showMessageModal("Acceso bloqueado", "Cuenta desactivada.");
      return false;
    }

    // Si clients.json no encuentra el email guardado, NO repedimos email automáticamente.
    // Mantenemos la empresa ya vinculada y evitamos molestar al usuario.
    if (!client) {
      console.warn(
        "El email guardado no aparece en clients.json. Se mantiene la configuración guardada.",
      );
      return true;
    }

    try {
      const resolved = await resolveCompanyByEmail(saved.email);

      await persistCompanyCfg(resolved);
      applyResolved(resolved);
      persistLegacyLocal(resolved);
      logCompanyCfg("after applyResolved(resolved)");
      warnIfDemoBaseUrl("(boot)");

      await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);

      hideReconnectIfAvailable();
      setConnectionStateOnline();
      return true;
    } catch (e) {
      console.warn("No se pudo validar la empresa guardada:", e);

      // Si es un fallo de conexión/timeout/429, mantenemos la cfg guardada y NO pedimos email.
      if (isConnectivityLikeError(e)) {
        showReconnectIfAvailable(
          "No hay conexión con Recipok. Espera por favor, reconectando...",
        );
        return true;
      }

      // Si es un fallo real no relacionado con conectividad, mantenemos la cfg
      // y evitamos abrir el modal automáticamente.
      toast(
        "No se pudo validar la empresa guardada. Se mantendrá la configuración actual.",
        "warn",
        "Activación",
      );
      return true;
    }
  }

  // =================================================
  // 2) SOLO HAY EMAIL GUARDADO PERO NO CFG COMPLETA
  // =================================================
  if (saved.hasEmail && !saved.isComplete) {
    // Si no hay conexión, no podemos resolver nada todavía
    if (TPV_STATE?.apiRecovering || !clientsData) {
      showReconnectIfAvailable(
        "No hay conexión con Recipok. Espera por favor, reconectando...",
      );
      return false;
    }

    const client = findClientByEmail(saved.email);

    if (client && client.active === false) {
      TPV_STATE.locked = true;
      TPV_STATE.offline = false;
      updateCashButtonLabel();

      showMessageModal("Acceso bloqueado", "Cuenta desactivada.");
      return false;
    }

    try {
      const resolved = await resolveCompanyByEmail(saved.email);

      await persistCompanyCfg(resolved);
      applyResolved(resolved);
      persistLegacyLocal(resolved);
      logCompanyCfg("after applyResolved(savedEmailOnly)");
      warnIfDemoBaseUrl("(boot)");

      await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);

      hideReconnectIfAvailable();
      setConnectionStateOnline();
      return true;
    } catch (e) {
      console.warn(
        "No se pudo completar la cfg a partir del email guardado:",
        e,
      );

      if (isConnectivityLikeError(e)) {
        showReconnectIfAvailable(
          "No hay conexión con Recipok. Espera por favor, reconectando...",
        );
        return false;
      }

      // Solo aquí tiene sentido volver a pedir email
      const resolved2 = await askAndResolve();
      if (!resolved2) return false;

      await persistCompanyCfg(resolved2);
      applyResolved(resolved2);
      persistLegacyLocal(resolved2);
      logCompanyCfg("after applyResolved(re-asked)");
      warnIfDemoBaseUrl("(boot)");

      await validateBaseUrlOrThrow(resolved2.baseUrl, resolved2.apiKey);

      hideReconnectIfAvailable();
      setConnectionStateOnline();
      return true;
    }
  }

  // =================================================
  // 3) NO HAY NADA GUARDADO
  // =================================================
  if (TPV_STATE?.apiRecovering || !clientsData) {
    showReconnectIfAvailable(
      "No hay conexión con Recipok. Espera por favor, reconectando...",
    );
    return false;
  }

  const resolved = await askAndResolve();
  if (!resolved) return false;

  await persistCompanyCfg(resolved);
  applyResolved(resolved);
  persistLegacyLocal(resolved);
  logCompanyCfg("after applyResolved(first-time)");
  warnIfDemoBaseUrl("(boot)");

  await validateBaseUrlOrThrow(resolved.baseUrl, resolved.apiKey);

  hideReconnectIfAvailable();
  setConnectionStateOnline();
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

  throwIfApi429Cooldown(`fetchApiResourceWithParams:${resource}`);

  const availability = await canCallApiResource(resource, {});
  if (availability.known && !availability.ok) {
    throw new Error(
      `Recurso no disponible en API: ${availability.missing?.[0] || resource}`,
    );
  }

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

  if (res.status === 429) {
    triggerApi429Cooldown(
      `fetchApiResourceWithParams:${resource}`,
      res.headers?.get?.("Retry-After") || "",
    );
    throw buildApi429Error();
  }
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 404) {
      markApiResourceMissing(resource);
    }
    throw new Error(`HTTP ${res.status} en ${resource}`);
  }
  if (data && data.status === "error")
    throw new Error(data.message || `Error API en ${resource}`);

  return data;
}

function getCurrentWarehouseCode() {
  return String(
    currentTerminal?.codalmacen || getLoginWarehouse() || "",
  ).trim();
}

function pickStockRowByWarehouse(rows, warehouseCode = "") {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;

  const wanted = String(warehouseCode || "")
    .trim()
    .toUpperCase();

  if (wanted) {
    const byWarehouse = list.find(
      (x) =>
        String(x?.codalmacen || "")
          .trim()
          .toUpperCase() === wanted,
    );
    if (byWarehouse) return byWarehouse;
  }

  return list[0] || null;
}

async function fetchStockRowsByParams(params = {}) {
  const rows = await fetchApiResourceWithParams("stocks", {
    ...params,
    limit: 200,
  });
  return Array.isArray(rows) ? rows : [];
}

function buildStockReferenceCandidates(product) {
  const out = [];
  const pushRef = (value) => {
    const ref = String(value || "").trim();
    if (!ref || ref === "-") return;
    if (out.some((x) => x.toLowerCase() === ref.toLowerCase())) return;
    out.push(ref);
  };

  const baseId = Number(getProductBaseId(product) || 0);

  pushRef(product?.referencia);
  pushRef(product?.name);
  pushRef(product?.descripcion);

  if (baseId > 0 && Array.isArray(products)) {
    const canonical = products.find((p) => getProductBaseId(p) === baseId);
    pushRef(canonical?.referencia);
    pushRef(canonical?.name);
    pushRef(canonical?.descripcion);
  }

  return out;
}

async function fetchStockRowsByProductReference(product) {
  const refCandidates = buildStockReferenceCandidates(product);
  if (!refCandidates.length) return [];

  let mergedRows = [];
  for (const ref of refCandidates) {
    try {
      const byRef = await fetchStockRowsByParams({
        "filter[referencia]": ref,
      });
      if (byRef.length) mergedRows = mergedRows.concat(byRef);
    } catch {
      // Continuamos con otras referencias candidatas.
    }
  }

  if (!mergedRows.length) return [];

  const seen = new Set();
  return mergedRows.filter((row) => {
    const key = String(row?.idstock || "").trim();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchStockRowForProduct(product) {
  const warehouse = getCurrentWarehouseCode();
  const baseId = Number(getProductBaseId(product) || 0);

  // Estrategia 1: buscar por idproducto (más estable entre equipos).
  if (baseId > 0) {
    try {
      const byProduct = await fetchStockRowsByParams({
        "filter[idproducto]": baseId,
      });
      const picked = pickStockRowByWarehouse(byProduct, warehouse);
      if (picked) return picked;
    } catch (e) {
      console.warn(
        "Lookup stock por idproducto falló:",
        e?.message || e,
        "idproducto=",
        baseId,
      );
    }
  }

  // Estrategia 2: fallback por referencias candidatas (compat legacy).
  const list = await fetchStockRowsByProductReference(product);
  if (!list.length) return null;

  return pickStockRowByWarehouse(list, warehouse);
}

async function updateStockRowCantidad(stockRow, nextQty) {
  const idstock = Number(stockRow?.idstock || 0);
  if (!idstock) throw new Error("No se encontró idstock para actualizar.");

  const payload = {
    idstock,
    cantidad: Number(nextQty),
    codalmacen: String(stockRow?.codalmacen || getCurrentWarehouseCode() || ""),
    referencia: String(stockRow?.referencia || "").trim(),
    idproducto: Number(stockRow?.idproducto || 0) || undefined,
  };

  try {
    return await apiWrite(`stocks/${idstock}`, "PATCH", payload);
  } catch {
    return await apiWrite(`stocks/${idstock}`, "PUT", payload);
  }
}

function applyStockQtyToLocalProducts(product, qty) {
  const baseId = Number(product?.baseProductId || product?.id || 0);
  if (!baseId || !Array.isArray(products) || !products.length) return;

  products = products.map((p) => {
    if (Number(p?.baseProductId || p?.id || 0) !== baseId) return p;
    return {
      ...p,
      stockfisRaw: Number(qty),
      stockfis: Number(qty),
    };
  });

  renderProducts?.();
  updateRenderedProductStocks?.();
}

async function openProductStockEditFlow(product) {
  if (!isAdminUser()) {
    toast("Solo administradores.", "warn", "Stock");
    return;
  }

  if (TPV_STATE?.offline) {
    toast("Sin conexión. No se puede editar stock ahora.", "warn", "Stock");
    return;
  }

  const productName = String(
    product?.referencia || product?.name || "Producto",
  ).trim();

  const stockRow = await fetchStockRowForProduct(product).catch((e) => {
    console.warn("No se pudo leer stock del producto:", e?.message || e);
    return null;
  });

  if (!stockRow) {
    const localStock = parseManagedStockValue(product?.stockfis);
    if (localStock === null) return;

    toast("No se encontró stock para este producto.", "warn", "Stock");
    return;
  }

  const rowQty = parseManagedStockValue(stockRow?.cantidad);
  const productQty = parseManagedStockValue(product?.stockfis);
  const currentQty = rowQty ?? productQty;
  if (currentQty === null) return;

  const wantedQty = await new Promise((resolve) => {
    openNumPad(
      String(currentQty),
      (value) => resolve(value),
      `${productName} · stock actual ${formatProductStock(currentQty)}`,
      "stock",
      currentQty,
      null,
    );
  });

  const nextQty = Number(wantedQty);
  if (!Number.isFinite(nextQty)) return;

  const roundedNext = Math.round(nextQty * 1000) / 1000;
  if (roundedNext === currentQty) return;

  const ok = await confirmModal(
    "Confirmar cambio de stock",
    `Producto: ${productName}\n\nStock actual: ${formatProductStock(currentQty)}\nNuevo stock: ${formatProductStock(roundedNext)}\n\n¿Seguro que quieres guardar este cambio?`,
  );
  if (!ok) return;

  try {
    await updateStockRowCantidad(stockRow, roundedNext);
    applyStockQtyToLocalProducts(product, roundedNext);
    toast("Stock actualizado correctamente.", "ok", "Stock");
  } catch (e) {
    console.error("Error actualizando stock:", e);
    toast(e?.message || "No se pudo actualizar el stock.", "err", "Stock");
  }
}

// ===== [08] Venta avanzada: packs/ofertas (plugin FacturaScripts) =====

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

function isPackParentLine(line) {
  return !!line?.meta?.isPackOffer && !!line?.meta?.packId;
}

function isPackChildLine(line) {
  return !!line?.meta?.includedInPack && !!line?.meta?.parentPackLineId;
}

function getVisibleCartLines(cartArr = cart) {
  const src = Array.isArray(cartArr) ? cartArr : [];
  return src.filter((line) => !isPackChildLine(line));
}

function hasVisibleCartLines(cartArr = cart) {
  return getVisibleCartLines(cartArr).length > 0;
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
  const parentQty = Number(parentLine.qty || 0) || 0;

  const selected = Array.isArray(parentLine?.meta?.packSelection)
    ? parentLine.meta.packSelection
    : [];

  if (selected.length) {
    return selected
      .map((ln) => {
        const ref = String(ln.reference || "").trim();
        const baseQ = parseQtyValue(ln.qty, 0);
        const q = roundQty3(baseQ * parentQty);
        if (!ref || q <= 0) return "";
        return `${ref} x${fmtQty(q)}`;
      })
      .filter(Boolean)
      .join(" · ");
  }

  if (!packId) return "";

  const lines = PACKS_STATE.linesByPackId.get(packId) || [];
  if (!lines.length) return "";

  return lines
    .map((ln) => {
      const ref = String(ln.reference || "").trim();
      const baseQ = parseQtyValue(ln?.quantity ?? ln?.qty, 1);
      const q = roundQty3(baseQ * parentQty);
      return `${ref} x${fmtQty(q)}`;
    })
    .join(" · ");
}

async function openPackEditModalForParentLine(parentLine) {
  if (!isPackParentLine(parentLine)) return false;

  const selection = Array.isArray(parentLine?.meta?.packSelection)
    ? parentLine.meta.packSelection
    : [];

  const packId = Number(parentLine?.meta?.packId || 0);
  const templateLines = packId
    ? PACKS_STATE.linesByPackId.get(packId) || []
    : [];

  const sourceLines = templateLines.length ? templateLines : selection;

  if (!sourceLines.length) {
    toast("No hay configuracion de oferta para editar.", "warn", "Oferta");
    return false;
  }

  const selectedQtyByRef = new Map(
    selection.map((s) => [
      String(s.reference || "").trim(),
      parseQtyValue(s.qty, 1),
    ]),
  );

  const packLines = sourceLines.map((line) => ({
    reference: String(line.reference || "").trim(),
    baseQty: Math.max(
      0.001,
      roundQty3(parseQtyValue(line.quantity ?? line.qty ?? 1, 1)),
    ),
    productName:
      line.productName || line.descripcion || line.reference || "Producto",
  }));

  const result = await openPackConfigModal({
    offerName: parentLine?.name || "Oferta",
    offerSecondary: parentLine?.secondaryName || "",
    packLines,
    initialSelection: selectedQtyByRef,
  });

  if (!result) return false;

  parentLine.meta = parentLine.meta || {};
  parentLine.meta.packSelection = result;
  parentLine.meta.packSelectionKey = selectionKeyFromArr(result);

  syncSelectedPackChildrenQty(parentLine);
  renderCart();
  return true;
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
    const pricing = getCartLinePricing(item);
    const unitPrice = Number(pricing?.unitGross || getUnitGross(item) || 0);
    const qty = Number(item.qty || 0);
    const lineTotal = Number(pricing?.lineTotal || unitPrice * qty);
    const baseUnitPrice = Number(pricing?.baseUnitGross || unitPrice);
    const baseLineTotal = Number(pricing?.baseLineTotal || lineTotal);
    const hasDiscount = baseUnitPrice > unitPrice + 0.0001;

    let discountLabel = "";
    if (hasDiscount) {
      if (pricing?.manualPriceLocked) {
        discountLabel = "Manual";
      } else if (pricing?.cartDiscountApplied) {
        discountLabel =
          pricing?.cartDiscountSource === "line" ? "Dto linea" : "Dto general";
      } else if (pricing?.tariffApplied) {
        discountLabel = "Tarifa";
      } else {
        discountLabel = "Descuento";
      }

      const pct =
        baseUnitPrice > 0
          ? round2(((baseUnitPrice - unitPrice) / baseUnitPrice) * 100)
          : 0;

      if (pct > 0.0001) {
        discountLabel += ` -${formatDiscountPercent(pct)}%`;
      }
    }

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
      baseUnitPrice,
      baseLineTotal,
      hasDiscount,
      discountLabel,
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

  const packId = Number(parentLine?.meta?.packId || 0);
  const templateLines = packId
    ? PACKS_STATE.linesByPackId.get(packId) || []
    : [];
  const templateByRef = new Map();

  for (const ln of templateLines) {
    const ref = String(ln.reference || "").trim();
    if (ref && !templateByRef.has(ref)) templateByRef.set(ref, ln);
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

  const currentChildren = getPackChildren(parentLine._lineId);
  const childRefSet = new Set(
    currentChildren
      .map((ch) => String(ch?.meta?.packRef || "").trim())
      .filter(Boolean),
  );

  // 2) crear los hijos que faltan cuando se re-activa una opción de la oferta
  const parentIndex = cart.findIndex((x) => x._lineId === parentLine._lineId);
  let insertAt = parentIndex >= 0 ? parentIndex + 1 : cart.length;

  for (const [ref, baseQ] of qByRef.entries()) {
    if (childRefSet.has(ref)) continue;

    const tpl = templateByRef.get(ref);
    const refKey = String(ref || "").trim();
    const refLower = refKey.toLowerCase();
    const localProduct = Array.isArray(products)
      ? products.find((p) => {
          const pRef = String(p?.referencia || p?.ref || p?.codigo || "")
            .trim()
            .toLowerCase();
          return pRef === refLower;
        })
      : null;

    const cachedFs = PACKS_STATE.productByRefCache.get(refKey) || null;
    const resolvedId =
      Number(
        localProduct?.baseProductId ||
          localProduct?.id ||
          cachedFs?.idproducto ||
          cachedFs?.id ||
          0,
      ) || null;

    const productName = String(
      localProduct?.name ||
        localProduct?.descripcion ||
        cachedFs?.descripcion ||
        tpl?.productName ||
        tpl?.descripcion ||
        ref ||
        "Producto",
    );

    const child = buildCartLine(
      {
        id: resolvedId,
        baseProductId: resolvedId,
        referencia: refKey,
        name: productName,
        descripcion: productName,
        secondaryName: "",
        imageUrl: null,
        price: 0,
        codimpuesto:
          localProduct?.codimpuesto ||
          cachedFs?.codimpuesto ||
          tpl?.codimpuesto ||
          parentLine?.codimpuesto ||
          null,
      },
      roundQty3(baseQ * parentQty),
    );

    child.price = 0;
    child.grossPrice = 0;
    child.originalGrossPrice = 0;
    child.grossPriceOverride = 0;
    child.meta = {
      includedInPack: true,
      parentPackLineId: parentLine._lineId,
      packRef: ref,
    };

    cart.splice(insertAt, 0, child);
    insertAt += 1;
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
  apiUnsupported: false,
  unsupportedFailCount: 0,
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

function normalizeBarcodeInput(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "");
}

function resolveProductFromVariantRow(variantRow) {
  if (!variantRow || !Array.isArray(products) || products.length === 0) {
    return null;
  }

  const idVar = Number(variantRow.idvariante ?? variantRow.id ?? 0);
  if (idVar) {
    const byVariantId = products.find((p) => Number(p.id) === idVar);
    if (byVariantId) return byVariantId;
  }

  const baseId = Number(variantRow.idproducto ?? 0);
  if (baseId) {
    const primaryVariant = products.find(
      (p) =>
        Number(p.baseProductId || 0) === baseId &&
        (p.isPrimaryVariant || p.variantOrder === 0),
    );
    if (primaryVariant) return primaryVariant;

    const byBaseProduct = products.find(
      (p) => Number(p.baseProductId || p.id || 0) === baseId,
    );
    if (byBaseProduct) return byBaseProduct;
  }

  const ref = String(variantRow.referencia ?? "").trim();
  if (ref) {
    const byRef = products.find(
      (p) => String(p.referencia || p.name || "").trim() === ref,
    );
    if (byRef) return byRef;
  }

  return null;
}

function rebuildBarcodeLocalIndex(variantesData = []) {
  BARCODE_LOCAL_PRODUCT_BY_CODE.clear();

  const rows = Array.isArray(variantesData) ? variantesData : [];
  rows.forEach((row) => {
    const barcode = normalizeBarcodeInput(
      row?.codbarras || row?.barcode || row?.ean13 || row?.ean || "",
    );
    if (!barcode) return;

    const product = resolveProductFromVariantRow(row);
    const productId = Number(product?.id || 0) || 0;
    if (!productId) return;

    if (!BARCODE_LOCAL_PRODUCT_BY_CODE.has(barcode)) {
      BARCODE_LOCAL_PRODUCT_BY_CODE.set(barcode, productId);
    }
  });

  barcodeCatalogReady = BARCODE_LOCAL_PRODUCT_BY_CODE.size > 0;
}

function resolveBarcodeProductFromLocalIndex(barcode) {
  const normalized = normalizeBarcodeInput(barcode);
  if (!normalized) return null;

  const productId = Number(BARCODE_LOCAL_PRODUCT_BY_CODE.get(normalized) || 0);
  if (!productId || !Array.isArray(products) || !products.length) return null;

  return products.find((p) => Number(p?.id || 0) === productId) || null;
}

async function addProductToCartByBarcode(barcode) {
  const normalized = normalizeBarcodeInput(barcode);
  if (!normalized) return false;

  const localHit = resolveBarcodeProductFromLocalIndex(normalized);
  if (localHit) {
    await addToCart(localHit, 1);
    return true;
  }

  const variants = await fetchApiResourceWithParams("variantes", {
    "filter[codbarras]": normalized,
    limit: 10,
    "sort[idvariante]": "DESC",
  });

  const rows = Array.isArray(variants) ? variants : [];
  if (!rows.length) return false;

  let productToAdd = null;
  for (const row of rows) {
    productToAdd = resolveProductFromVariantRow(row);
    if (productToAdd) break;
  }

  if (!productToAdd) return false;

  await addToCart(productToAdd, 1);
  return true;
}

async function handleBarcodeScannerSubmit(barcode) {
  if (barcodeScannerLookupInFlight) return;

  const normalized = normalizeBarcodeInput(barcode);
  if (!normalized || normalized.length < BARCODE_SCANNER_CFG.minLength) return;

  if (!barcodeCatalogReady && (!Array.isArray(products) || !products.length)) {
    const now = Date.now();
    if (now - barcodeReadyToastAt > 1500) {
      barcodeReadyToastAt = now;
      toast("Lector de barras inicializando catálogo...", "info", "Barcode");
    }
  }

  barcodeScannerLookupInFlight = true;
  try {
    const added = await addProductToCartByBarcode(normalized);
    if (!added) {
      toast(`No se encontro producto para el codigo ${normalized}.`, "warn");
    }
  } catch (e) {
    console.warn("Error en busqueda por codigo de barras:", e?.message || e);
    toast("No se pudo buscar el codigo de barras.", "error");
  } finally {
    barcodeScannerLookupInFlight = false;
  }
}

async function warmupPacksData(opts = {}) {
  const force = opts.force === true;

  // Si ya hay datos de packs y no se fuerza, evita peticiones innecesarias.
  if (PACKS_STATE.ready && !force) return true;

  // Si los endpoints están marcados como no soportados, solo reintenta al forzar.
  if (PACKS_STATE.apiUnsupported && !force) return false;

  // Si estamos offline y no se ha forzado, no tocamos nada
  if (TPV_STATE?.offline && !force) {
    return false;
  }

  // Validación genérica por recursos requeridos de la feature "packs".
  try {
    const availability = await isApiFeatureAvailable("packs", { force });
    if (availability.known && !availability.ok) {
      PACKS_STATE.apiUnsupported = true;
      console.info(
        `[PACKS] Recursos no declarados en /api/3/: ${availability.missing.join(", ")}. Se deshabilita precarga de packs.`,
      );
      return false;
    }

    // Si reaparecieron en recursos, limpiamos estado previo de no soportado.
    if (availability.known && availability.ok && PACKS_STATE.apiUnsupported) {
      PACKS_STATE.apiUnsupported = false;
    }
  } catch {}

  let packs = [];
  let lines = [];

  try {
    const [packsRes, linesRes] = await Promise.allSettled([
      fetchApiResource("productpacks"),
      fetchApiResource("productpacklines"),
    ]);

    const errText = (err) => String(err?.message || err || "").toLowerCase();
    const is404Like = (err) => {
      const txt = errText(err);
      return (
        txt.includes("http 404") ||
        txt.includes("404") ||
        txt.includes("not found") ||
        txt.includes("no encontrado")
      );
    };
    const isTransient = (err) => {
      const txt = errText(err);
      return (
        txt.includes("offline") ||
        txt.includes("network") ||
        txt.includes("failed to fetch") ||
        txt.includes("timeout") ||
        txt.includes("abort") ||
        txt.includes("429")
      );
    };

    const packsErr = packsRes.status === "rejected" ? packsRes.reason : null;
    const linesErr = linesRes.status === "rejected" ? linesRes.reason : null;

    if (
      (packsErr && is404Like(packsErr)) ||
      (linesErr && is404Like(linesErr))
    ) {
      PACKS_STATE.apiUnsupported = true;
      console.info(
        "[PACKS] Endpoints no disponibles (404/not-found). Se deshabilita precarga de packs.",
      );
      return false;
    }

    if (packsErr || linesErr) {
      const transient =
        (packsErr && isTransient(packsErr)) ||
        (linesErr && isTransient(linesErr));
      if (!transient) {
        PACKS_STATE.unsupportedFailCount += 1;
        if (PACKS_STATE.unsupportedFailCount >= 2) {
          PACKS_STATE.apiUnsupported = true;
          console.info(
            "[PACKS] Endpoints no soportados en este cliente. Se deshabilita precarga.",
          );
          return false;
        }
      }
    }

    // Si falla cualquiera, mantenemos la caché anterior
    if (packsRes.status !== "fulfilled" || linesRes.status !== "fulfilled") {
      console.warn(
        "No se pudieron precargar los packs. Se mantiene la caché anterior.",
      );
      return false;
    }

    packs = Array.isArray(packsRes.value) ? packsRes.value : [];
    lines = Array.isArray(linesRes.value) ? linesRes.value : [];
  } catch (e) {
    console.warn("Error cargando packs:", e?.message || e);
    return false;
  }

  PACKS_STATE.unsupportedFailCount = 0;
  PACKS_STATE.apiUnsupported = false;

  // Construimos mapas temporales y solo si todo fue bien sustituimos el estado
  const nextPacksByOfferProductId = new Map();
  const nextLinesByPackId = new Map();

  // productpacks: { id, idproduct, name, reference, ... }
  for (const p of packs) {
    const offerId = Number(p.idproduct || 0);
    const packId = Number(p.id || 0);
    if (!offerId || !packId) continue;

    nextPacksByOfferProductId.set(offerId, {
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

    if (!nextLinesByPackId.has(packId)) {
      nextLinesByPackId.set(packId, []);
    }
    nextLinesByPackId.get(packId).push(ln);
  }

  // Reemplazo atómico
  PACKS_STATE.ready = false;
  PACKS_STATE.packsByOfferProductId.clear();
  PACKS_STATE.linesByPackId.clear();
  PACKS_STATE.productByRefCache.clear();

  for (const [key, value] of nextPacksByOfferProductId.entries()) {
    PACKS_STATE.packsByOfferProductId.set(key, value);
  }

  for (const [key, value] of nextLinesByPackId.entries()) {
    PACKS_STATE.linesByPackId.set(key, value);
  }

  PACKS_STATE.ready = true;
  return true;
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
        qty: roundQty3(parseQtyValue(x.qty, 0)),
      }))
      .filter((x) => x.reference && x.qty > 0)
      .sort((a, b) => a.reference.localeCompare(b.reference)),
  );
}

async function openPackConfigModal({
  offerName,
  offerSecondary,
  packLines,
  initialSelection = new Map(),
}) {
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
    const hasInitialSelection =
      initialSelection instanceof Map
        ? initialSelection.size > 0
        : !!(initialSelection && Object.keys(initialSelection).length > 0);

    const state = packLines.map((pl) => {
      const def = Math.max(0.001, roundQty3(parseQtyValue(pl.baseQty, 1)));
      const key = String(pl.reference || "").trim();
      const selectedQty =
        initialSelection instanceof Map
          ? initialSelection.get(key)
          : initialSelection?.[key];
      const hasSelection = Number(selectedQty) > 0;
      return {
        reference: String(pl.reference || "").trim(),
        productName: pl.productName || pl.reference || "Producto",
        defaultQty: def,
        checked: hasInitialSelection ? hasSelection : true,
        qty: hasSelection
          ? Math.max(0.001, roundQty3(parseQtyValue(selectedQty, def)))
          : def,
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
      let q = parseQtyValue(newQty, 0);
      q = Math.max(0, roundQty3(q));

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
            let q = parseQtyValue(val, 0);
            q = Math.max(0, roundQty3(q));
            applyQty(i, q);
          },
          s.productName,
          "qty",
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

// ===== [07] API media: imagenes de productos =====
// Prioridad:
//   1) productoimagenes  -> relacion directa producto -> imagen
//   2) fallback antiguo  -> attachedfiles + attachedfilerelations

// Mapa global: { [idproducto]: { idfile, url, filename, mimetype, orden } }
let PRODUCT_IMAGES_MAP = {};

function hashStringFast(input) {
  const s = String(input || "");
  let hash = 5381;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 33) ^ s.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function normalizeThumbTenantFromApiBase(baseUrl) {
  const raw = String(baseUrl || "")
    .trim()
    .toLowerCase();
  if (!raw) return "global";
  return hashStringFast(raw);
}

function setProductThumbTenantFromApiBase(baseUrl) {
  productThumbTenantKey = normalizeThumbTenantFromApiBase(baseUrl);
}

function buildProductThumbCacheKey(imageInfo) {
  const idfile = Number(imageInfo?.idfile || 0) || 0;
  const src = String(imageInfo?.url || "").trim();
  const srcHash = hashStringFast(src);
  return `${productThumbTenantKey}:${idfile || "url"}:${srcHash}`;
}

function isProductThumbFetchBlocked(imageInfo) {
  if (!imageInfo?.url) return false;
  const cacheKey = buildProductThumbCacheKey(imageInfo);
  return PRODUCT_THUMB_FAILED_KEYS.has(cacheKey);
}

function resetProductImageRetryState(opts = {}) {
  const { clearBrokenUrls = false } = opts;
  PRODUCT_THUMB_FAILED_KEYS.clear();

  if (clearBrokenUrls) {
    BROKEN_PRODUCT_IMAGE_URLS.clear();
  }
}

function getProductImageInfoForProduct(product) {
  const productId = Number(product?.baseProductId || product?.id || 0) || 0;
  if (!productId) return null;
  return PRODUCT_IMAGES_MAP[productId] || null;
}

function runProductThumbJob(task) {
  return new Promise((resolve, reject) => {
    const start = () => {
      productThumbActiveJobs += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          productThumbActiveJobs = Math.max(0, productThumbActiveJobs - 1);
          const next = productThumbPendingJobs.shift();
          if (next) next();
        });
    };

    if (productThumbActiveJobs < PRODUCT_THUMB_MAX_CONCURRENT_JOBS) start();
    else productThumbPendingJobs.push(start);
  });
}

function idbRequestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB error"));
  });
}

function idbTxDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB tx error"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB tx aborted"));
  });
}

function openProductThumbDb() {
  if (PRODUCT_THUMB_DB_PROMISE) return PRODUCT_THUMB_DB_PROMISE;

  if (typeof indexedDB === "undefined") {
    PRODUCT_THUMB_DB_PROMISE = Promise.resolve(null);
    return PRODUCT_THUMB_DB_PROMISE;
  }

  PRODUCT_THUMB_DB_PROMISE = new Promise((resolve, reject) => {
    const req = indexedDB.open(PRODUCT_THUMB_DB_NAME, PRODUCT_THUMB_DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      let store;

      if (!db.objectStoreNames.contains(PRODUCT_THUMB_STORE)) {
        store = db.createObjectStore(PRODUCT_THUMB_STORE, {
          keyPath: "cacheKey",
        });
      } else {
        store = req.transaction.objectStore(PRODUCT_THUMB_STORE);
      }

      if (!store.indexNames.contains("byTenant")) {
        store.createIndex("byTenant", "tenant", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error || new Error("No se pudo abrir cache"));
  }).catch((e) => {
    console.warn("[thumb-cache] IndexedDB no disponible:", e?.message || e);
    return null;
  });

  return PRODUCT_THUMB_DB_PROMISE;
}

async function getProductThumbRecord(cacheKey) {
  const db = await openProductThumbDb();
  if (!db) return null;

  const tx = db.transaction(PRODUCT_THUMB_STORE, "readonly");
  const store = tx.objectStore(PRODUCT_THUMB_STORE);
  const record = await idbRequestToPromise(store.get(cacheKey));
  await idbTxDone(tx);
  return record || null;
}

async function putProductThumbRecord(record) {
  const db = await openProductThumbDb();
  if (!db) return;

  const tx = db.transaction(PRODUCT_THUMB_STORE, "readwrite");
  tx.objectStore(PRODUCT_THUMB_STORE).put(record);
  await idbTxDone(tx);
}

function materializeProductThumbObjectUrl(cacheKey, blob) {
  if (!(blob instanceof Blob)) return "";

  const prev = PRODUCT_THUMB_OBJECT_URL_BY_KEY.get(cacheKey);
  if (prev) {
    try {
      URL.revokeObjectURL(prev);
    } catch {}
  }

  const objectUrl = URL.createObjectURL(blob);
  PRODUCT_THUMB_OBJECT_URL_BY_KEY.set(cacheKey, objectUrl);
  return objectUrl;
}

function getProductThumbObjectUrlSync(imageInfo) {
  if (!imageInfo?.url) return "";
  const cacheKey = buildProductThumbCacheKey(imageInfo);
  return PRODUCT_THUMB_OBJECT_URL_BY_KEY.get(cacheKey) || "";
}

async function getProductThumbObjectUrlFromDb(cacheKey) {
  const record = await getProductThumbRecord(cacheKey);
  if (!record?.blob) return "";

  const now = Date.now();
  putProductThumbRecord({
    ...record,
    atime: now,
    updatedAt: record.updatedAt || now,
  }).catch(() => {});

  return materializeProductThumbObjectUrl(cacheKey, record.blob);
}

async function enforceProductThumbTenantLimit(tenant) {
  const db = await openProductThumbDb();
  if (!db) return;

  const txRead = db.transaction(PRODUCT_THUMB_STORE, "readonly");
  const list = await idbRequestToPromise(
    txRead.objectStore(PRODUCT_THUMB_STORE).index("byTenant").getAll(tenant),
  );
  await idbTxDone(txRead);

  const rows = Array.isArray(list) ? list : [];
  let total = rows.reduce((sum, row) => sum + Number(row?.size || 0), 0);
  if (total <= PRODUCT_THUMB_MAX_CACHE_BYTES) return;

  const sorted = rows
    .slice()
    .sort((a, b) => Number(a?.atime || 0) - Number(b?.atime || 0));

  const txWrite = db.transaction(PRODUCT_THUMB_STORE, "readwrite");
  const store = txWrite.objectStore(PRODUCT_THUMB_STORE);

  for (const row of sorted) {
    if (total <= PRODUCT_THUMB_MAX_CACHE_BYTES) break;
    const cacheKey = String(row?.cacheKey || "");
    if (!cacheKey) continue;

    total -= Number(row?.size || 0);
    store.delete(cacheKey);

    const objUrl = PRODUCT_THUMB_OBJECT_URL_BY_KEY.get(cacheKey);
    if (objUrl) {
      try {
        URL.revokeObjectURL(objUrl);
      } catch {}
      PRODUCT_THUMB_OBJECT_URL_BY_KEY.delete(cacheKey);
    }
  }

  await idbTxDone(txWrite);
}

async function buildThumbnailBlobFromSourceBlob(sourceBlob) {
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const srcW = Math.max(1, Number(bitmap.width || 0));
    const srcH = Math.max(1, Number(bitmap.height || 0));
    const longest = Math.max(srcW, srcH);
    const scale =
      longest > PRODUCT_THUMB_MAX_LONG_EDGE
        ? PRODUCT_THUMB_MAX_LONG_EDGE / longest
        : 1;

    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return sourceBlob;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(bitmap, 0, 0, outW, outH);

    const encode = (quality) =>
      new Promise((resolve) => {
        canvas.toBlob(
          (blob) => resolve(blob || sourceBlob),
          "image/webp",
          quality,
        );
      });

    let outBlob = await encode(PRODUCT_THUMB_WEBP_QUALITY);

    if (outBlob.size > 320 * 1024) {
      outBlob = await encode(0.62);
    }

    return outBlob;
  } finally {
    try {
      bitmap.close();
    } catch {}
  }
}

async function persistProductThumbBlob(cacheKey, imageInfo, blob) {
  const now = Date.now();
  await putProductThumbRecord({
    cacheKey,
    tenant: productThumbTenantKey,
    idfile: Number(imageInfo?.idfile || 0) || 0,
    sourceUrl: String(imageInfo?.url || ""),
    mimeType: String(blob?.type || "image/webp"),
    size: Number(blob?.size || 0),
    updatedAt: now,
    atime: now,
    blob,
  });

  enforceProductThumbTenantLimit(productThumbTenantKey).catch(() => {});
}

async function ensureProductThumbObjectUrl(imageInfo) {
  if (!imageInfo?.url) return "";

  const cacheKey = buildProductThumbCacheKey(imageInfo);

  if (PRODUCT_THUMB_FAILED_KEYS.has(cacheKey)) {
    return "";
  }

  const inMemory = PRODUCT_THUMB_OBJECT_URL_BY_KEY.get(cacheKey);
  if (inMemory) return inMemory;

  const fromDb = await getProductThumbObjectUrlFromDb(cacheKey);
  if (fromDb) {
    PRODUCT_THUMB_FAILED_KEYS.delete(cacheKey);
    return fromDb;
  }

  if (TPV_STATE?.offline) return "";

  if (PRODUCT_THUMB_IN_FLIGHT_BY_KEY.has(cacheKey)) {
    return PRODUCT_THUMB_IN_FLIGHT_BY_KEY.get(cacheKey);
  }

  const promise = runProductThumbJob(async () => {
    const resp = await fetch(String(imageInfo.url), {
      cache: "force-cache",
      credentials: "omit",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const sourceBlob = await resp.blob();
    const thumbBlob = await buildThumbnailBlobFromSourceBlob(sourceBlob);

    await persistProductThumbBlob(cacheKey, imageInfo, thumbBlob);
    PRODUCT_THUMB_FAILED_KEYS.delete(cacheKey);
    return materializeProductThumbObjectUrl(cacheKey, thumbBlob);
  })
    .catch((e) => {
      const firstFail = !PRODUCT_THUMB_FAILED_KEYS.has(cacheKey);
      PRODUCT_THUMB_FAILED_KEYS.add(cacheKey);
      if (firstFail) {
        console.warn(
          "[thumb-cache] No se pudo crear miniatura:",
          e?.message || e,
        );
      }
      return "";
    })
    .finally(() => {
      PRODUCT_THUMB_IN_FLIGHT_BY_KEY.delete(cacheKey);
    });

  PRODUCT_THUMB_IN_FLIGHT_BY_KEY.set(cacheKey, promise);
  return promise;
}

async function hydrateProductTileImage(tile, imageInfo, fallbackUrl = "") {
  if (!tile || !imageInfo?.url) return;

  if (isProductThumbFetchBlocked(imageInfo)) {
    return;
  }

  const cacheKey = buildProductThumbCacheKey(imageInfo);
  tile.dataset.thumbCacheKey = cacheKey;

  const thumbUrl = await ensureProductThumbObjectUrl(imageInfo);
  if (!tile.isConnected) return;
  if (String(tile.dataset.thumbCacheKey || "") !== cacheKey) return;

  const fallback = String(fallbackUrl || "").trim();
  const safeFallback = BROKEN_PRODUCT_IMAGE_URLS.has(fallback) ? "" : fallback;
  const finalSrc = String(thumbUrl || safeFallback || "").trim();
  if (!finalSrc) return;

  const wrap = tile.querySelector(".product-img-wrapper");
  if (!wrap) return;

  if (!wrap.querySelector("img.product-img")) {
    wrap.innerHTML = `<img src="${escapeHtml(finalSrc)}" class="product-img" loading="lazy" decoding="async">`;
  } else {
    const img = wrap.querySelector("img.product-img");
    if (img) img.setAttribute("src", finalSrc);
  }

  tile.classList.remove("no-img");
}

async function clearProductImageThumbCache() {
  PRODUCT_THUMB_IN_FLIGHT_BY_KEY.clear();
  productThumbPendingJobs.length = 0;
  PRODUCT_THUMB_FAILED_KEYS.clear();

  PRODUCT_THUMB_OBJECT_URL_BY_KEY.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
  PRODUCT_THUMB_OBJECT_URL_BY_KEY.clear();

  const db = await openProductThumbDb();
  if (!db) return;

  const tx = db.transaction(PRODUCT_THUMB_STORE, "readwrite");
  tx.objectStore(PRODUCT_THUMB_STORE).clear();
  await idbTxDone(tx);
}

// ===== [07] API media fallback: attachedfiles =====
async function fetchAttachedImageFiles() {
  const data = await fetchApiResourceWithParams("attachedfiles", {
    limit: 0,
    "sort[idfile]": "DESC",
  });

  const list = Array.isArray(data) ? data : [];

  return list.filter((f) => {
    const mime = String(f.mimetype || "").toLowerCase();
    const name = String(f.filename || "");
    return mime.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(name);
  });
}

// ===== [07] API media fallback: relaciones de Producto =====
async function fetchProductFileRelations() {
  const data = await fetchApiResourceWithParams("attachedfilerelations", {
    "filter[model]": "Producto",
    limit: 0,
    "sort[id]": "DESC",
  });

  const list = Array.isArray(data) ? data : [];

  return list.filter(
    (r) =>
      String(r.model || "") === "Producto" &&
      r.idfile != null &&
      r.modelid != null,
  );
}

// -------------------------------------------------------------
// Nuevo endpoint bueno: productoimagenes
// -------------------------------------------------------------
async function fetchProductoImagenes() {
  const data = await fetchApiResourceWithParams("productoimagenes", {
    limit: 0,
    "sort[idproducto]": "ASC",
    "sort[orden]": "ASC",
    "sort[id]": "ASC",
  });

  return Array.isArray(data) ? data : [];
}

// -------------------------------------------------------------
// Construye mapa idproducto -> imagen
// Usa primero productoimagenes
// Si falla o viene vacío, usa fallback antiguo
// -------------------------------------------------------------
async function buildProductImagesMap() {
  const cfg = window.RECIPOK_API || {};
  const apiBase = (cfg.baseUrl || "").replace(/\/+$/, "");
  const fileBase = apiBase.replace(/\/api\/[^/]+$/i, "");

  // =========================================================
  // 1) Intento principal: productoimagenes
  // =========================================================
  try {
    const rows = await fetchProductoImagenes();

    if (Array.isArray(rows) && rows.length) {
      const map = {};

      rows.forEach((img) => {
        const idprod = Number(img.idproducto || 0);
        const idfile = Number(img.idfile || 0);
        if (!idprod || !idfile) return;

        // Nos quedamos con la primera por orden
        if (map[idprod]) return;

        const path = img["download-permanent"] || img.download || "";

        if (!path) return;

        const url = `${fileBase}/${String(path).replace(/^\/+/, "")}`;
        const cleanPath = String(path).split("?")[0];
        const filename = cleanPath.split("/").pop() || "";

        map[idprod] = {
          idfile,
          url,
          filename,
          mimetype: "",
          orden: Number(img.orden || 0),
        };
      });

      PRODUCT_IMAGES_MAP = map;
      return map;
    }
  } catch (e) {
    console.warn(
      "No se pudo usar productoimagenes. Se intentará el sistema antiguo:",
      e?.message || e,
    );
  }

  // =========================================================
  // 2) Fallback antiguo: attachedfiles + attachedfilerelations
  // =========================================================
  const [files, relations] = await Promise.all([
    fetchAttachedImageFiles(),
    fetchProductFileRelations(),
  ]);

  const fileById = {};
  files.forEach((f) => {
    fileById[Number(f.idfile)] = f;
  });

  const map = {};

  relations.forEach((rel) => {
    const idprod = Number(rel.modelid || 0);
    const idfile = Number(rel.idfile || 0);
    if (!idprod || !idfile) return;

    if (map[idprod]) return; // nos quedamos con la primera

    const f = fileById[idfile];
    if (!f) return;

    const path = f["download-permanent"] || f.download || f.path || "";

    if (!path) return;

    const url = `${fileBase}/${String(path).replace(/^\/+/, "")}`;

    map[idprod] = {
      idfile,
      url,
      filename: f.filename || "",
      mimetype: f.mimetype || "",
      orden: 0,
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
  if (facturaRow?._offline || !Number(facturaRow?.idfactura || 0)) {
    const offlineLines = Array.isArray(facturaRow?.lineas)
      ? facturaRow.lineas
      : [];

    if (!offlineLines.length) {
      throw new Error("Ticket offline sin líneas para imprimir.");
    }

    const ticket = {
      numero: String(facturaRow?.codigo || "OFFLINE"),
      fecha: String(facturaRow?.fecha || new Date().toISOString().slice(0, 10)),
      hora: String(facturaRow?.hora || new Date().toTimeString().slice(0, 8)),
      paymentMethod: String(facturaRow?.codpago || "—"),
      clientName: String(facturaRow?.nombrecliente || "Venta en cola"),
      terminalName: currentTerminal ? currentTerminal.name : "",
      agentName: currentAgent ? currentAgent.name : "",
      company: companyInfo ? { ...companyInfo } : null,
      lineas: offlineLines,
      total: Number(facturaRow?.total || 0),
      pagos: Array.isArray(facturaRow?.pagos) ? facturaRow.pagos : [],
      cambio: Number(facturaRow?.cambio || 0),
      codserie: String(
        facturaRow?.codserie || facturaRow?._raw?.codserie || "S",
      ),
      numero2: String(facturaRow?.numero2 || facturaRow?._raw?.numero2 || ""),
      idfacturarect: Number(
        facturaRow?.idfacturarect || facturaRow?._raw?.idfacturarect || 0,
      ),
      _offline: true,
      _localId: facturaRow?._localId || null,
    };

    ticket.cashMeta = buildCashTicketMeta({
      pagos: ticket.pagos,
      total: ticket.total,
      cambio: ticket.cambio,
    });

    const ticketReady = preparePrintableTicket(ticket);
    await printTicket(ticketReady);
    return;
  }

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
    codserie: String(raw.codserie || facturaRow?.codserie || "S"),
    numero2: String(raw.numero2 || facturaRow?.numero2 || ""),
    idfacturarect: Number(raw.idfacturarect || facturaRow?.idfacturarect || 0),

    // ✅ IMPORTANTE: estas son las que usará tu diseño
    lineas: lineasTpv,

    _raw: raw,
    pagos,
  };

  ticket.cashMeta = buildCashTicketMeta({
    pagos,
    total: Number(ticket.total || facturaRow?.total || 0),
    cambio: Number(facturaRow?.cambio || raw?.tpv_cambio || 0),
  });

  const ticketReady = preparePrintableTicket(ticket);
  await printTicket(ticketReady);
}

function preparePrintableTicket(ticket) {
  const lineas0 = Array.isArray(ticket?.lineas) ? [...ticket.lineas] : [];
  if (!lineas0.length) return ticket;
  const isFastPreApiDraft = !!ticket?._fastPreApiPrint;

  const isZero = (n) => Math.abs(parseQtyValue(n, 0)) < 0.00001;

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

    // Si la línea ya viene marcada explícitamente como hijo, respetarla siempre.
    if (l?.meta?.includedInPack || l?.__isPackChild) return true;

    // En preimpresión rápida (snapshot de carrito), no inferir por referencia:
    // las líneas aún no tienen shape monetario FS y se pueden falsear a 0.
    if (isFastPreApiDraft) return false;

    const hasFsMoneyShape =
      l?.pvpunitario != null || l?.pvptotal != null || l?.idlinea != null;
    if (!hasFsMoneyShape) return false;

    const unitNet = parseQtyValue(l?.pvpunitario, 0);
    const qty = parseQtyValue(l?.cantidad ?? l?.qty, 0);
    const totalNet = parseQtyValue(l?.pvptotal, unitNet * qty);

    // Solo tratar como hijo si realmente es una linea monetaria cero.
    if (!isZero(unitNet) || !isZero(totalNet)) return false;

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

  // En preimpresión (o estados sin PACKS_STATE listo), muchos hijos vienen
  // enlazados al padre por meta.parentPackLineId.
  const childByParentLineId = new Map();
  for (const ch of realChildren) {
    const parentLineId = String(ch?.meta?.parentPackLineId || "").trim();
    if (!parentLineId) continue;
    if (!childByParentLineId.has(parentLineId)) {
      childByParentLineId.set(parentLineId, []);
    }
    childByParentLineId.get(parentLineId).push(ch);
  }

  const getChildKey = (ch) => {
    const lineId = String(ch?._lineId || "").trim();
    if (lineId) return `L:${lineId}`;

    const idlinea = Number(ch?.idlinea || 0);
    if (idlinea > 0) return `I:${idlinea}`;

    const refNorm = pickRefNorm(ch);
    const qty = parseQtyValue(ch?.cantidad ?? ch?.qty, 0);
    return `R:${refNorm}|Q:${qty}`;
  };

  const byOrder = (a, b) =>
    Number(a?.orden ?? a?.idlinea ?? 0) - Number(b?.orden ?? b?.idlinea ?? 0);

  const parentsSorted = [...parents].sort(byOrder);
  const normalsSorted = [...normalLines].sort(byOrder);

  const out = [];
  const usedChildIds = new Set();

  for (const parent of parentsSorted) {
    const parentPid = Number(parent?.idproducto || 0);
    const defs = parentDefs.get(parentPid) || [];
    const parentLineId = String(parent?._lineId || "").trim();
    const directChildren = parentLineId
      ? childByParentLineId.get(parentLineId) || []
      : [];

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
        const chId = getChildKey(ch);
        if (usedChildIds.has(chId)) continue;
        usedChildIds.add(chId);

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

    // Fallback: si no hay defs o quedan hijos explícitos sin casar por ref,
    // respetar igualmente los hijos enlazados por parentPackLineId.
    for (const ch of directChildren) {
      const chId = getChildKey(ch);
      if (usedChildIds.has(chId)) continue;
      usedChildIds.add(chId);

      const fallbackRef = cleanSpecialPrefix(
        ch.referencia || ch?.meta?.packRef || "",
      );
      out.push({
        ...ch,
        referencia: fallbackRef,
        descripcion: cleanSpecialPrefix(ch.descripcion || fallbackRef || ""),
        __isPackParent: false,
        __isPackChild: true,
        __forceUnitGross: 0,
        __lineTotalOverride: 0,
      });
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

function getRefundLinePricingBreakdown(l) {
  const soldQty = Math.abs(Number(l?.cantidad || 0)) || 1;
  const tax = Number(lineTaxRate(l) || 0);
  const finalUnitGross = Number(lineGrossUnit(l) || 0);
  let baseUnitGross = finalUnitGross;

  const totalNetNoDiscount = Number(l?.pvpsindto);
  const totalNetFinal = Number(l?.pvptotal);

  if (
    isFinite(totalNetNoDiscount) &&
    isFinite(totalNetFinal) &&
    totalNetNoDiscount > totalNetFinal + 0.0001
  ) {
    const unitNetBase = totalNetNoDiscount / soldQty;
    baseUnitGross = unitNetBase * (1 + tax / 100);
  } else {
    const fsDiscountFields = [
      l?.dtopor,
      l?.dtopor1,
      l?.dtopor2,
      l?.dtopor3,
      l?.dtopor4,
    ]
      .map((v) => Number(v || 0))
      .filter((v) => isFinite(v) && v > 0 && v < 100);

    if (fsDiscountFields.length) {
      const finalFactor = fsDiscountFields.reduce(
        (acc, pct) => acc * (1 - pct / 100),
        1,
      );
      if (finalFactor > 0.000001 && finalFactor < 0.999999) {
        baseUnitGross = finalUnitGross / finalFactor;
      }
    }

    if (!(baseUnitGross > finalUnitGross + 0.0001)) {
      const catalogBase = getCatalogBaseUnitGrossForProductId(
        l?.idproducto || l?.id || l?.baseProductId,
      );
      if (catalogBase > finalUnitGross + 0.0001) {
        baseUnitGross = catalogBase;
      }
    }
  }

  const baseUnit = round2(baseUnitGross);
  const finalUnit = round2(finalUnitGross);
  const discountPerUnit = Math.max(0, round2(baseUnit - finalUnit));
  const hasDiscount = discountPerUnit > 0.0001;
  const discountPct =
    hasDiscount && baseUnit > 0
      ? round2(((baseUnit - finalUnit) / baseUnit) * 100)
      : 0;

  return {
    baseUnitGross: baseUnit,
    finalUnitGross: finalUnit,
    discountPerUnit,
    discountPct,
    hasDiscount,
  };
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

  const paymentInfoEl = document.getElementById("refundPaymentInfoInline");
  if (paymentInfoEl) {
    const paymentParts = formatRefundOriginalPayments(
      Array.isArray(refundState.recibosOriginales)
        ? refundState.recibosOriginales
        : [],
    ).map((p) => `${p.label}: ${eurES(p.amount)}`);

    if (paymentParts.length) {
      paymentInfoEl.innerHTML = `Pago original: <strong>${escapeHtml(paymentParts.join("  |  "))}</strong>`;
      paymentInfoEl.style.display = "inline-block";
    } else {
      paymentInfoEl.innerHTML = "";
      paymentInfoEl.style.display = "none";
    }
  }

  refundState.lineas.forEach((l) => {
    const max = Number(
      l._remainingQty != null ? l._remainingQty : l.cantidad || 0,
    );
    const id = Number(l.idlinea);
    const curr = Number(refundState.qtyByLineId[id] || 0);

    const pricing = getRefundLinePricingBreakdown(l);
    const unitGross = Number(pricing.finalUnitGross || 0);
    const tax = lineTaxRate(l);
    const displayName = getRefundLineDisplayName(l);

    const discountInfoHtml = pricing.hasDiscount
      ? `<div style="font-size:12px; opacity:.85; margin-top:2px;">PVP: <span style="text-decoration:line-through; opacity:.72;">${eurES(pricing.baseUnitGross)}</span> → <strong>${eurES(pricing.finalUnitGross)}</strong> · Descuento -${formatDiscountPercent(pricing.discountPct)}%</div>`
      : `<div style="font-size:12px; opacity:.8;">Precio: <strong>${eurES(unitGross)}</strong> / ud</div>`;

    const lineOldTotal = pricing.hasDiscount
      ? round2(Number(pricing.baseUnitGross || 0) * Number(curr || 0))
      : 0;
    const lineFinalTotal = round2(
      Number(pricing.finalUnitGross || 0) * Number(curr || 0),
    );

    const row = document.createElement("div");
    row.style.cssText =
      "display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid #eee;";

    row.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHtml(displayName)}
        </div>
        ${discountInfoHtml}
        <div style="font-size:12px; opacity:.75;">Vendido: ${max} · IVA ${tax}%</div>
      </div>

      <div style="display:flex; align-items:center; gap:6px;">
        <button type="button" class="cart-btn" data-a="minus" data-id="${id}">-</button>
        <div style="min-width:34px; text-align:center; font-weight:700;">${curr}</div>
        <button type="button" class="cart-btn" data-a="plus" data-id="${id}">+</button>
      </div>

      <div style="width:110px; text-align:right; font-weight:700;">
        ${
          pricing.hasDiscount && curr > 0
            ? `<div style="font-size:12px; font-weight:500; opacity:.7; text-decoration:line-through;">${eurES(lineOldTotal)}</div>`
            : ""
        }
        ${eurES(lineFinalTotal)}
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

  // Sincroniza predictor para la serie de rectificativas.
  updateFastTicketNumberByConfirmedCode({
    codigo: docRect?.codigo,
    codserie: payloadRect?.serie,
    numero2: payloadRect?.numero2,
    idfactura: rectId,
    terminalId: idtpv,
  });

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
  if (!hasActiveLoginSession()) {
    const okLoginDirect = await openLoginModal();
    if (!okLoginDirect || !hasActiveLoginSession()) {
      applyLoggedOutUiState({ lock: true });
    } else {
      unlockAppUI();
    }
    return;
  }

  const ok = await confirmModal(
    "Cambiar usuario",
    "Se cerrará la sesión actual para poder elegir otro usuario.",
  );
  if (!ok) return;

  const currentUser = String(getLoginUser() || "").trim();
  LOGIN_MODAL_DRAFT = {
    user: currentUser || LOGIN_MODAL_DRAFT.user || "",
    pin: "",
    isAdmin: false,
  };

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
  refreshAgentGuardUI?.();
  toast?.("Sesión cerrada", "info", "Usuario");

  cashOpenDialogShown = false;

  applyLoggedOutUiState({ lock: true });

  // 5) Abrir login inmediatamente (no dependas de “Abrir caja”)
  const ok2 = await openLoginModal();
  if (!ok2 || !hasActiveLoginSession()) {
    applyLoggedOutUiState({ lock: true });
    return;
  }

  unlockAppUI();

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
  const cancelBtn = document.getElementById("msgCancelBtn");
  const midBtn = document.getElementById("msgMidBtn");
  if (!o || !t || !p || !b) return;

  t.textContent = title || "Aviso";
  p.textContent = text || "";
  p.style.whiteSpace = "pre-line";
  if (cancelBtn) cancelBtn.classList.add("hidden");
  if (midBtn) midBtn.classList.add("hidden");
  b.textContent = "Aceptar";
  o.classList.remove("hidden");
  lockAppUI();

  b.onclick = () => {
    o.classList.add("hidden");
    unlockAppUI();
  };
}

async function bootstrapE2EMode() {
  try {
    document.body.dataset.e2eMode = "1";
    document.body.dataset.e2eSource = "booting";
  } catch {}
  window.__TPV_E2E_BOOT_SOURCE__ = "booting";
  window.__TPV_E2E_BOOT_ERROR__ = "";

  try {
    localStorage.clear();
  } catch {}

  const e2eBaseUrl =
    String(window.TPV_ENV?.e2eApiBaseUrl || "").trim() ||
    "https://plus.recipok.com/demo/api/3";
  const e2eApiKey = String(window.TPV_ENV?.e2eApiKey || "").trim();
  const requireOnline = !!window.TPV_ENV?.e2eRequireOnline;

  window.RECIPOK_API = {
    baseUrl: e2eBaseUrl,
    apiKey: e2eApiKey,
    defaultCodClienteTPV: "1",
  };

  TPV_STATE.locked = false;
  TPV_STATE.offline = false;
  TPV_STATE.isAdmin = true;

  installE2ERemoteWriteGuard(e2eBaseUrl);

  terminals = [{ id: 9999, name: "TPV DEMO E2E" }];
  currentTerminal = terminals[0];

  agents = [{ id: 9999, codagente: "E2E", name: "Agente Demo E2E" }];
  agentsByTerminal = { [String(currentTerminal.id)]: agents };
  currentAgent = agents[0];

  localStorage.setItem(LOGIN_USER_KEY, "e2e-demo");
  localStorage.setItem(LOGIN_TOKEN_KEY, "e2e-token");
  localStorage.setItem("tpv_login_codagente", "E2E");
  localStorage.setItem("tpv_login_codalmacen", "1");
  localStorage.setItem("tpv_login_isAdmin", "1");
  localStorage.setItem("tpv_printerRealName", "E2E Mock Printer");
  localStorage.setItem("tpv_autoPrint", "1");

  let bootSource = "local-fallback";
  let lastBootstrapError = "";

  const attempts = requireOnline ? 3 : 1;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await loadDataFromApi({ refresh: true, silentRetry: true });

      const onlineReady =
        !TPV_STATE.offline &&
        Array.isArray(products) &&
        products.length > 0 &&
        Array.isArray(categories) &&
        categories.length > 0;

      if (onlineReady) {
        bootSource = "remote-demo";
        break;
      }
    } catch (e) {
      lastBootstrapError = String(e?.message || e || "").trim();
      console.warn("[E2E] Remote demo bootstrap failed:", e?.message || e);
    }

    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (bootSource !== "remote-demo") {
    categories = [...demoCategories];
    products = [...demoProducts];

    if (requireOnline) {
      const reason = e2eApiKey
        ? `No se pudo conectar al slug demo remoto con la API key indicada.${lastBootstrapError ? ` Detalle: ${lastBootstrapError}` : ""}`
        : "Falta TPV_E2E_API_KEY para conectar al slug demo remoto.";

      window.__TPV_E2E_BOOT_ERROR__ = reason;
      throw new Error(reason);
    }
  }

  if (!currentTerminal) {
    terminals = [{ id: 9999, name: "TPV DEMO E2E" }];
    currentTerminal = terminals[0];
  }

  if (!currentAgent) {
    agents = [{ id: 9999, codagente: "E2E", name: "Agente Demo E2E" }];
    agentsByTerminal = { [String(currentTerminal.id)]: agents };
    currentAgent = agents[0];
  }

  cart = [];
  parkedTickets = [];
  cashSession.open = true;
  cashSession.openedAt = new Date().toISOString();
  cashSession.remoteCajaId = 9999;
  cashSession.openingTotal = 0;
  cashSession.closingTotal = 0;
  cashSession.totalSales = 0;
  cashSession.cashSalesTotal = 0;
  cashSession.cashMovementsTotal = 0;
  cashSession.paymentsByMethod = {};
  cashSession.paymentLedger = [];

  try {
    document.body.dataset.e2eMode = "1";
    document.body.dataset.e2eSource = bootSource;
  } catch {}

  window.__TPV_E2E_BOOT_SOURCE__ = bootSource;

  renderMainUI();
  renderMainAgentBar?.();
  renderCart();
  updateSessionLockUi();
  updateCashButtonLabel();
  updateParkedCountBadge();
  refreshOptionsUI();
  renderCashIdChip();
  refreshAgentGuardUI?.();
  refreshParkButtonUI?.();
  pushCustomerState?.();
}

// ===== [10] Inicializacion principal (bootstrap UI y modo E2E) =====
window.addEventListener("DOMContentLoaded", async () => {
  installRemoteWriteGuard();
  await loadSafeTrainingModeToggle();
  initThemeMode();
  await initCustomerDisplayThemeMode();
  await loadProductManualOrderConfig?.();
  await loadProductSortModeSetting?.();
  await loadProductReorderModeSetting?.();
  await loadInfoBarVisibilitySettings?.();
  setTpvLoadingState(true);
  renderCart();
  updateSessionLockUi();
  updateCashButtonLabel();
  updateParkedCountBadge();
  refreshOptionsUI();
  refreshProductStockFilterUIState();
  applyInfoBarVisibilityUi?.();

  if (TPV_E2E_MODE) {
    try {
      await bootstrapE2EMode();
    } catch (e) {
      window.__TPV_E2E_BOOT_ERROR__ =
        e?.message || "No se pudo iniciar E2E remoto.";
      window.__TPV_E2E_BOOT_SOURCE__ = "boot-error";
      try {
        document.body.dataset.e2eMode = "1";
        document.body.dataset.e2eSource = "boot-error";
      } catch {}
      showMessageModal(
        "E2E remoto no disponible",
        e?.message || "No se pudo iniciar E2E remoto.",
      );
    }
    setTpvLoadingState(false);
    return;
  }

  startOnlineMonitor();

  await bootstrapApp(); // y listo
  startBackgroundUpdateMonitor();
  maybeShowChangelogAfterUpdate().catch(() => {});
});

window.addEventListener("beforeunload", () => {
  stopBackgroundUpdateMonitor();
  persistRuntimeCartSnapshot({ force: true });
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

// ===== [06] Atajos globales: reset de fabrica (Ctrl+Shift+R) =====
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
    try {
      localStorage.removeItem(API_RESOURCES_CACHE_KEY);
      localStorage.removeItem(API_RESOURCES_CACHE_TS_KEY);
      localStorage.removeItem(API_MISSING_RESOURCES_CACHE_KEY);
      localStorage.removeItem(API_MISSING_RESOURCES_CACHE_TS_KEY);
    } catch {}
    try {
      await clearProductImageThumbCache();
    } catch {}

    // opcional: cualquier cache que uses
    // localStorage.removeItem("tpv_cached_formapagos");
    // localStorage.removeItem("tpv_cached_tickets");
  } catch {}

  // 2) Limpiar persistencia durable (TPV_CFG en userData)
  try {
    const TPV_CFG = window.TPV_CFG;
    if (TPV_CFG) {
      // empresa (nuevo esquema)
      await TPV_CFG.set("company.email", "");
      await TPV_CFG.set("company.slug", "");
      await TPV_CFG.set("company.baseUrl", "");
      await TPV_CFG.set("company.apiKey", "");

      // empresa (legacy)
      await TPV_CFG.set("companyEmail", "");
      await TPV_CFG.set("baseUrl", "");
      await TPV_CFG.set("apiKey", "");

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

  try {
    if (window.RECIPOK_API) {
      window.RECIPOK_API.baseUrl = "";
      window.RECIPOK_API.apiKey = "";
    }

    TPV_STATE.offline = false;
    TPV_STATE.apiRecovering = false;
    TPV_STATE.locked = false;

    hideReconnectIfAvailable?.();
  } catch {}

  toast("Reset realizado. Reiniciando...", "ok", "Reset");
  setStatusText?.("TPV reseteado");

  // 4) Recargar app para volver a flujo inicial
  window.location.reload();
});

// ===== [08][Z08.3] Caja UI: stepper + teclado numerico/calculadora =====

function cashParseToInt(value) {
  const n = evaluateNumericExpression(String(value ?? ""));
  if (n == null) return 0;
  return Math.max(0, Math.round(Number(n) || 0));
}

function cashSetInputValue(input, newVal) {
  const n = Math.max(0, parseInt(newVal, 10) || 0);
  input.value = String(n);
  syncCashStepperClearButton(input);
  // Si ya tienes un listener que recalcula totales al 'input', lo disparo:
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function syncCashStepperClearButton(input) {
  const wrap = input?.closest?.(".cash-stepper-input-wrap");
  const btn = wrap?.querySelector?.(".cash-stepper-clear-btn");
  if (!btn) return;

  const qty = Math.max(0, parseInt(input?.value || "0", 10) || 0);
  btn.classList.toggle("hidden", qty <= 0);
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

    const inputWrap = document.createElement("div");
    inputWrap.className = "cash-stepper-input-wrap";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "cash-stepper-clear-btn hidden";
    clearBtn.textContent = "×";
    clearBtn.title = "Poner a 0";

    // Insertamos wrapper en el DOM (mantenemos el orden)
    const parent = input.parentElement;
    parent.insertBefore(wrap, input);
    wrap.appendChild(btnMinus);
    wrap.appendChild(inputWrap);
    inputWrap.appendChild(input);
    inputWrap.appendChild(clearBtn);
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

    clearBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cashSetInputValue(input, 0);
      input.blur();
    });

    syncCashStepperClearButton(input);
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
      "qty",
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
    if (navigator.onLine === false) {
      return false;
    }

    if (isApi429CooldownActive()) {
      return false;
    }

    const cfg = window.RECIPOK_API || {};

    // ✅ Si aún no hay empresa/config resuelta, distinguimos este caso
    if (!cfg.baseUrl || !cfg.apiKey) {
      return navigator.onLine ? "NO_CFG_ONLINE" : false;
    }

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

      if (r.status === 429) {
        triggerApi429Cooldown(
          "checkFSOnline",
          r.headers?.get?.("Retry-After") || "",
        );
        return false;
      }

      return r.ok;
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

    // ✅ Caso especial: hay internet, pero aún no hay cfg de empresa
    if (ok === "NO_CFG_ONLINE") {
      TPV_STATE.offline = false;
      updateOnlineBadge(true);

      const shouldResumeActivation =
        !!PENDING_COMPANY_EMAIL || isReconnectOverlayVisible();

      if (shouldResumeActivation) {
        try {
          await resumePendingCompanyActivation({
            promptIfNoPending: !PENDING_COMPANY_EMAIL,
          });
        } catch (e) {
          console.warn(
            "No se pudo reanudar la activación pendiente:",
            e?.message || e,
          );
        }
      }

      prevOk = ok;
      isOnlineFS = ok;
      return;
    }

    TPV_STATE.offline = !ok;
    updateOnlineBadge(!!ok);

    if (ok) {
      TPV_STATE.locked = false;
      TPV_STATE.apiRecovering = false;
      hideReconnectIfAvailable();
      updateCashButtonLabel();
    }

    const becameOnline =
      (prevOk === false || prevOk === "NO_CFG_ONLINE") && ok === true;

    prevOk = ok;

    if (becameOnline) {
      try {
        exitApiRetryMode();
      } catch {}

      try {
        const loadedRecently =
          Date.now() - Number(LAST_FULL_LOAD_AT || 0) < 15000;
        if (!BOOT_IN_FLIGHT && !loadedRecently) {
          await loadDataFromApi({ refresh: true, silentRetry: true });
        }
      } catch (e) {
        console.warn(
          "No se pudo refrescar datos completos al volver online:",
          e?.message || e,
        );
      }

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

      try {
        await handleCashHeaderAction({ auto: true });
      } catch (e) {
        console.warn(
          "No se pudo relanzar el flujo de caja al volver online:",
          e?.message || e,
        );
      }
    }

    try {
      if (ok && window.TPV_QUEUE?.count) {
        const c = await window.TPV_QUEUE.count();
        if ((c?.pending || 0) > 0) {
          await syncQueueNow();
          await evaluateQueueHealthAndWarn({ online: true });
        }
      }
    } catch (e) {
      console.warn("No se pudo comprobar/sincronizar cola:", e?.message || e);
    }

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

// ===== [08][Z08.2] Cola offline: envio y encolado de facturas =====
function buildSafeTrainingTicketResponse(payload = {}) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fecha = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hora = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const lineas = Array.isArray(payload?.lineas) ? payload.lineas : [];
  const total = round2(
    lineas.reduce((sum, line) => {
      const qty = Number(line?.cantidad ?? line?.qty ?? 1) || 0;
      const lineTotal = Number(
        line?.pvptotal ??
          line?.total ??
          (Number(line?.pvpunitario ?? line?.pvp ?? 0) || 0) * qty,
      );
      return sum + (isFinite(lineTotal) ? lineTotal : 0);
    }, 0),
  );

  const code = nextSafeTrainingSimSaleCode();
  const idfactura =
    900000 + readSafeTrainingSequence(TPV_SAFE_TRAINING_SIM_SALE_SEQ_KEY);

  return {
    doc: {
      idfactura,
      codigo: code,
      total,
      codcliente: String(payload?.codcliente || ""),
      fecha,
      hora,
      codserie: String(payload?.codserie || payload?.serie || "S").trim(),
      numero2: String(payload?.numero2 || "").trim(),
      _simulated: true,
    },
    simulated: true,
  };
}

async function sendOrQueueFactura(payload) {
  if (isSafeTrainingModeEnabled()) {
    return {
      ok: true,
      remote: buildSafeTrainingTicketResponse(payload),
      simulated: true,
    };
  }

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

const SYNC_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const QUEUE_HEALTH_CHECK_EVERY_MS = 60 * 1000;
const QUEUE_STUCK_MIN_AGE_MIN = 10;
const QUEUE_STUCK_MIN_ATTEMPTS = 4;

let __queueHealthLastCheckAt = 0;
const __syncAlertLastAtByKey = new Map();

function notifyWorkerSyncIssue(key, message, opts = {}) {
  const allowOffline = opts?.allowOffline === true;
  if (!allowOffline) {
    if (TPV_STATE?.offline) return;
    if (isOnlineFS === false) return;
  }

  const cooldownMs = Math.max(
    0,
    Number(opts?.cooldownMs || SYNC_ALERT_COOLDOWN_MS),
  );
  const now = Date.now();
  const last = Number(__syncAlertLastAtByKey.get(String(key)) || 0);
  if (now - last < cooldownMs) return;

  __syncAlertLastAtByKey.set(String(key), now);

  const title =
    String(opts?.title || "Sincronizacion").trim() || "Sincronizacion";
  const text = String(message || "Problema de sincronizacion").trim();
  if (!text) return;

  toast(text, "err", title);
  setStatusText("Atencion: revisar sincronizacion y avisar a soporte.");

  if (opts?.modal) {
    showMessageModal(
      "Aviso de sincronizacion",
      `${text}\n\nContacta con soporte para revisarlo.`,
    );
  }
}

function minutesSinceIso(isoLike) {
  const ts = Date.parse(String(isoLike || ""));
  if (!isFinite(ts)) return 0;
  return Math.max(0, (Date.now() - ts) / 60000);
}

async function evaluateQueueHealthAndWarn({ online = false } = {}) {
  if (!online) return;
  if (!window.TPV_QUEUE?.list) return;

  const now = Date.now();
  if (now - __queueHealthLastCheckAt < QUEUE_HEALTH_CHECK_EVERY_MS) return;
  __queueHealthLastCheckAt = now;

  try {
    const q = await window.TPV_QUEUE.list();
    const pending = Array.isArray(q?.pending) ? q.pending : [];
    const done = Array.isArray(q?.done) ? q.done : [];

    const pendingSales = pending.filter(
      (it) => it?.type === "CREATE_FACTURACLIENTE",
    );

    if (pendingSales.length) {
      let oldestMinutes = 0;
      let maxAttempts = 0;

      for (const it of pendingSales) {
        oldestMinutes = Math.max(oldestMinutes, minutesSinceIso(it?.createdAt));
        maxAttempts = Math.max(maxAttempts, Number(it?.attempts || 0) || 0);
      }

      if (
        oldestMinutes >= QUEUE_STUCK_MIN_AGE_MIN ||
        maxAttempts >= QUEUE_STUCK_MIN_ATTEMPTS
      ) {
        notifyWorkerSyncIssue(
          "queue-stuck",
          `Hay ${pendingSales.length} venta(s) sin sincronizar (${Math.floor(oldestMinutes)} min en cola).`,
          { title: "Sincronizacion" },
        );
      }
    }

    const recentDone = done.slice(0, 20);
    const dropped = recentDone.filter(
      (it) =>
        it?.type === "CREATE_FACTURACLIENTE" &&
        (it?.remote?.dropped === true || it?.remote?.ok === false),
    );

    if (dropped.length) {
      const top = dropped[0];
      const sampleErr = String(
        top?.remote?.error || top?.lastError || "",
      ).slice(0, 140);
      notifyWorkerSyncIssue(
        `queue-dropped-${String(top?.id || "x")}`,
        `Se detecto una venta descartada en sincronizacion.${sampleErr ? ` Motivo: ${sampleErr}` : ""}`,
        { title: "Sincronizacion", modal: true, cooldownMs: 60 * 60 * 1000 },
      );
    }
  } catch (e) {
    console.warn("No se pudo evaluar salud de cola:", e?.message || e);
  }
}

// ===== [08][Z08.2] Cola offline: sincronizacion =====
async function syncQueueNow() {
  if (isSafeTrainingModeEnabled()) return true;
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

          const doc = resp?.doc || resp?.factura || resp?.data || resp || null;

          const idfactura =
            resp?.idfactura ||
            resp?.doc?.idfactura ||
            resp?.data?.idfactura ||
            resp?.factura?.idfactura ||
            null;

          // Mantener predictor al día también con ventas sincronizadas desde cola offline.
          updateFastTicketNumberByConfirmedCode({
            codigo: doc?.codigo,
            codserie: item?.payload?.serie || item?.payload?.codserie,
            numero2: item?.payload?.numero2,
            idfactura,
            terminalId: item?.payload?.idtpv,
          });

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
        const errMsg = e?.message || String(e);

        if (isRetryableQueueSyncError(e)) {
          if ((Number(item?.attempts || 0) || 0) >= QUEUE_STUCK_MIN_ATTEMPTS) {
            notifyWorkerSyncIssue(
              "queue-retries-high",
              `Una venta lleva varios reintentos de sincronizacion (intento ${item?.attempts || 0}).`,
              { title: "Sincronizacion" },
            );
          }

          // Error temporal: se reintenta y se corta el ciclo para evitar martilleo.
          await window.TPV_QUEUE.error(item.id, errMsg);
          break;
        }

        // Error permanente (ej. validación): no bloquea toda la cola.
        await window.TPV_QUEUE.done(item.id, {
          ok: false,
          dropped: true,
          error: errMsg,
        });

        console.warn(
          "[syncQueueNow] Item descartado por error permanente:",
          item?.type,
          item?.id,
          errMsg,
        );

        notifyWorkerSyncIssue(
          `queue-dropped-live-${String(item?.id || "x")}`,
          `No se pudo sincronizar una venta y se descarto para no bloquear la cola. Motivo: ${errMsg}`,
          { title: "Sincronizacion", modal: true, cooldownMs: 60 * 60 * 1000 },
        );

        continue;
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

// ===== [08] Venta offline: tickets visibles en modal =====
const OFFLINE_TICKETS_KEY = "tpv_offlineTickets_v1";

function saveTpvUsersCache(users) {
  try {
    const safe = (Array.isArray(users) ? users : [])
      .filter((u) => u && String(u.nick || "").trim())
      .map((u) => ({
        ...u,
        nick: String(u.nick || "").trim(),
        admin: !!u.admin,
        codagente: String(u.codagente || "").trim(),
        codalmacen: String(u.codalmacen || "").trim(),
      }));

    localStorage.setItem(TPV_USERS_CACHE_KEY, JSON.stringify(safe));
    localStorage.setItem(TPV_USERS_CACHE_TS_KEY, String(Date.now()));
  } catch (e) {
    console.warn("No se pudo guardar cache de usuarios TPV:", e?.message || e);
  }
}

function loadTpvUsersCache() {
  try {
    const raw = localStorage.getItem(TPV_USERS_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((u) => u && String(u.nick || "").trim())
      : [];
  } catch {
    return [];
  }
}

function saveTerminalAgentCache(data = {}) {
  try {
    const safe = {
      terminals: Array.isArray(data.terminals) ? data.terminals : [],
      agentsByTerminal:
        data.agentsByTerminal && typeof data.agentsByTerminal === "object"
          ? data.agentsByTerminal
          : {},
      agents: Array.isArray(data.agents) ? data.agents : [],
    };

    localStorage.setItem(TERMINAL_AGENT_CACHE_KEY, JSON.stringify(safe));
    localStorage.setItem(TERMINAL_AGENT_CACHE_TS_KEY, String(Date.now()));
  } catch (e) {
    console.warn(
      "No se pudo guardar cache de terminales/agentes:",
      e?.message || e,
    );
  }
}

function loadTerminalAgentCache() {
  try {
    const raw = localStorage.getItem(TERMINAL_AGENT_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;

    return {
      terminals: Array.isArray(parsed.terminals) ? parsed.terminals : [],
      agentsByTerminal:
        parsed.agentsByTerminal && typeof parsed.agentsByTerminal === "object"
          ? parsed.agentsByTerminal
          : {},
      agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    };
  } catch {
    return null;
  }
}

function saveBootSnapshot(payload = {}) {
  try {
    const safe = {
      version: 1,
      ts: Date.now(),
      categories: Array.isArray(payload.categories) ? payload.categories : [],
      products: Array.isArray(payload.products) ? payload.products : [],
      terminals: Array.isArray(payload.terminals) ? payload.terminals : [],
      agentsByTerminal:
        payload.agentsByTerminal && typeof payload.agentsByTerminal === "object"
          ? payload.agentsByTerminal
          : {},
      agents: Array.isArray(payload.agents) ? payload.agents : [],
      agentNameByCode:
        payload.agentNameByCode && typeof payload.agentNameByCode === "object"
          ? payload.agentNameByCode
          : {},
      taxRatesByCode:
        payload.taxRatesByCode && typeof payload.taxRatesByCode === "object"
          ? payload.taxRatesByCode
          : {},
      companyInfo:
        payload.companyInfo && typeof payload.companyInfo === "object"
          ? payload.companyInfo
          : null,
      productImagesMap:
        payload.productImagesMap && typeof payload.productImagesMap === "object"
          ? payload.productImagesMap
          : {},
      source: String(payload.source || "online").trim(),
    };

    localStorage.setItem(BOOT_SNAPSHOT_CACHE_KEY, JSON.stringify(safe));
    localStorage.setItem(BOOT_SNAPSHOT_CACHE_TS_KEY, String(Date.now()));
  } catch (e) {
    console.warn("No se pudo guardar snapshot de arranque:", e?.message || e);
  }
}

function loadBootSnapshot() {
  try {
    const raw = localStorage.getItem(BOOT_SNAPSHOT_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function restoreBootSnapshotIntoRuntime(reason = "") {
  const snap = loadBootSnapshot();
  if (!snap) return false;

  const hasCatalog = Array.isArray(snap.products) && snap.products.length > 0;
  if (!hasCatalog) return false;

  categories = Array.isArray(snap.categories) ? snap.categories : [];
  products = Array.isArray(snap.products) ? snap.products : [];
  terminals = Array.isArray(snap.terminals) ? snap.terminals : [];
  agentsByTerminal =
    snap.agentsByTerminal && typeof snap.agentsByTerminal === "object"
      ? snap.agentsByTerminal
      : {};
  agents = Array.isArray(snap.agents) ? snap.agents : [];
  agentNameByCode =
    snap.agentNameByCode && typeof snap.agentNameByCode === "object"
      ? snap.agentNameByCode
      : {};
  taxRatesByCode =
    snap.taxRatesByCode && typeof snap.taxRatesByCode === "object"
      ? snap.taxRatesByCode
      : {};
  companyInfo =
    snap.companyInfo && typeof snap.companyInfo === "object"
      ? snap.companyInfo
      : null;
  PRODUCT_IMAGES_MAP =
    snap.productImagesMap && typeof snap.productImagesMap === "object"
      ? snap.productImagesMap
      : {};

  saveTerminalAgentCache({ terminals, agentsByTerminal, agents });

  logFeatureWarn("BOOT", "snapshot-restaurado", {
    reason,
    products: products.length,
    categories: categories.length,
    terminals: terminals.length,
  });

  return true;
}

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

    const lineas = Array.isArray(t?.lineas) ? t.lineas : [];
    const totalFromLines = lineas.reduce((acc, ln) => {
      const qty = Number(ln?.qty ?? ln?.cantidad ?? 1) || 1;
      const unit =
        Number(ln?.grossPrice ?? ln?.price ?? ln?.pvpunitario ?? 0) || 0;
      return acc + qty * unit;
    }, 0);

    const normalized = {
      ...(t || {}),
      _offline: true,
      _localId: String(t?._localId || ""),
      codigo: String(t?.codigo || "OFFLINE"),
      nombrecliente: String(t?.nombrecliente || "Venta en cola"),
      total: Number(t?.total || totalFromLines || 0),
      codpago: String(t?.codpago || "—"),
      fecha: String(t?.fecha || new Date().toISOString().slice(0, 10)),
      hora: String(t?.hora || new Date().toTimeString().slice(0, 8)),
      idcaja: Number(t?.idcaja || cashSession?.remoteCajaId || 0) || 0,
      codserie: String(t?.codserie || "S"),
      lineas,
      pagos: Array.isArray(t?.pagos) ? t.pagos : [],
      _raw: {
        ...(t?._raw || {}),
        idcaja: Number(t?.idcaja || cashSession?.remoteCajaId || 0) || 0,
        codserie: String(t?.codserie || "S"),
      },
    };

    const next = curr.filter(
      (x) => String(x?._localId || "") !== String(normalized._localId || ""),
    );

    next.unshift(normalized);
    // limita para no crecer infinito
    localStorage.setItem(
      OFFLINE_TICKETS_KEY,
      JSON.stringify(next.slice(0, 200)),
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

  throwIfApi429Cooldown(`apiRead:${resource}`);

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

  if (res.status === 429) {
    triggerApi429Cooldown(
      `apiRead:${resource}`,
      res.headers?.get?.("Retry-After") || "",
    );
    throw buildApi429Error();
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
  if (BOOT_IN_FLIGHT) return;

  if (
    TPV_STATE?.offline ||
    TPV_STATE?.apiRecovering ||
    isReconnectOverlayVisible()
  ) {
    return;
  }

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

// ===== [09][Z09.3] Edicion de precio (solo ADMIN) =====

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

// ===== [09][Z09.3] Modal editar precio =====

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
  const orderPriorityInp = document.getElementById(
    "priceEditOrderPriorityInput",
  );
  const finalEl = document.getElementById("priceEditFinal");
  const err = document.getElementById("priceEditError");
  const currentOrderPriority = getProductManualOrderPriority(p);

  const updateDerived = () => {
    const baseRaw = String(inp?.value ?? "")
      .trim()
      .replace(",", ".");
    const baseGross = round2(Number(baseRaw));

    if (finalEl) finalEl.textContent = eur2(baseGross);
  };

  if (nameEl) nameEl.textContent = p.name || "Producto";
  if (curEl) curEl.textContent = eur2(grossNow);
  if (inp) inp.value = grossNow.toFixed(2);
  if (orderPriorityInp) orderPriorityInp.value = String(currentOrderPriority);
  if (err) err.textContent = "";

  if (inp) inp.oninput = updateDerived;

  if (orderPriorityInp) {
    const openPriorityPad = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();

      openNumPad(
        String(orderPriorityInp.value || currentOrderPriority || "0"),
        (val) => {
          orderPriorityInp.value = String(clampManualOrderPriority(val));
        },
        `${p.name || "Producto"} - prioridad`,
        "stock",
        currentOrderPriority,
        null,
      );
    };

    orderPriorityInp.onpointerdown = openPriorityPad;
  }

  updateDerived();

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
          updateDerived();
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
  const orderPriorityInp = document.getElementById(
    "priceEditOrderPriorityInput",
  );
  const raw = String(inp?.value ?? "")
    .trim()
    .replace(",", ".");
  const baseGross = round2(Number(raw));
  if (!isFinite(baseGross) || baseGross < 0) {
    if (err) err.textContent = "Precio no válido.";
    return;
  }

  const orderPriorityRaw = String(orderPriorityInp?.value ?? "")
    .trim()
    .replace(",", ".");
  const orderPriority = clampManualOrderPriority(Number(orderPriorityRaw));

  const taxRate = getTaxRateForProduct(p);
  const grossNow = round2(Number(p.price || 0) * (1 + taxRate / 100) || 0);
  const currentOrderPriority = getProductManualOrderPriority(p);
  const baseChanged = round2(baseGross) !== round2(grossNow);
  const orderPriorityChanged = orderPriority !== currentOrderPriority;

  if (!baseChanged && !orderPriorityChanged) {
    toast?.("No hay cambios en precio base ni prioridad.", "info", "Productos");
    document.getElementById("priceEditOverlay")?.classList.add("hidden");
    return;
  }

  if (!baseChanged && orderPriorityChanged) {
    const orderKeyProductId = Number(p.baseProductId || p.id || 0);
    await setProductManualOrderPriorityForProduct(
      orderKeyProductId,
      orderPriority,
    );
    renderProducts?.();
    toast?.(
      `Prioridad de orden guardada: ${orderPriority}.`,
      "ok",
      "Productos",
    );
    document.getElementById("priceEditOverlay")?.classList.add("hidden");
    return;
  }

  const ok = await confirmModal(
    "Actualizar precio base",
    `Vas a cambiar el precio de "${p.name}"\n\n` +
      `Base: ${grossNow.toFixed(2)} € -> ${baseGross.toFixed(2)} €\n` +
      `Prioridad: ${currentOrderPriority} -> ${orderPriority}\n` +
      `Final: ${baseGross.toFixed(2)} € (IVA incl.)\n\n` +
      (isSafeTrainingModeEnabled()
        ? `Modo pruebas activo: los cambios se aplicarán solo en local y no se enviarán a API.\n\n`
        : `El precio base se guardará en FacturaScripts permanentemente.\n` +
          `La prioridad es un ajuste local del TPV.\n\n`) +
      `¿Quieres continuar?`,
  );
  if (!ok) return;

  const newNet = grossToNet(baseGross, taxRate);
  const keyProductId = Number(p.baseProductId || p.id || 0);

  if (isSafeTrainingModeEnabled()) {
    await setProductDiscountPercentForProduct(keyProductId, 0);
    await setProductManualOrderPriorityForProduct(keyProductId, orderPriority);

    p.price = newNet;
    const idxLocal = (products || []).findIndex(
      (x) => Number(x.id) === Number(p.id),
    );
    if (idxLocal >= 0) products[idxLocal].price = newNet;

    renderProducts?.();
    toast?.(
      "Modo pruebas: precio/prioridad aplicados solo en local ✅",
      "ok",
      "Productos",
    );
    document.getElementById("priceEditOverlay")?.classList.add("hidden");
    return;
  }

  try {
    if (p.isVariant) {
      await apiUpdateVariantePrecioNet(p.id, newNet);
    } else {
      await apiUpdateProductoPrecioNet(p.baseProductId || p.id, newNet);
    }

    await setProductDiscountPercentForProduct(keyProductId, 0);
    await setProductManualOrderPriorityForProduct(keyProductId, orderPriority);

    // ✅ LOG solo si la API fue OK
    await logPermanentPriceChange({
      product: p,
      oldGross: grossNow,
      newGross: baseGross,
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
  toast?.("Precio base actualizado ✅", "ok", "Productos");
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

// ===== [09][Z09.3] Fin edicion de precio =====
