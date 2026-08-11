const APP_MODE_KEY = "tpv_app_mode";
const APP_MODE_CFG_KEY = "app.mode";
const TPV_THEME_KEY = "tpv_theme_mode";
const MESAS_CATALOG_SESSION_KEY = "tpv_mesas_catalog_session_v1";
const SHARED_CATALOG_CACHE_KEY = "tpv_shared_catalog_v1";
const PRODUCT_VISUAL_MIN_SLOTS = 24;
const PARKED_TICKETS_CACHE_KEY = "tpv_parked_tickets_cache_v1";
const TABLES_STATE_KEY = "tpv_tables_state_v3";
const LEGACY_TABLES_STATE_KEY = "tpv_tables_state_v2";
const MESAS_LAYOUT_CACHE_KEY = "tpv_mesas_layout_cache_v1";
const MESAS_LAYOUT_SYNC_QUEUE_KEY = "tpv_mesas_layout_sync_queue_v1";
const MESAS_LOCAL_EDIT_TS_KEY = "tpv_mesas_local_edit_ts_v1";
const TUTORIAL_BLANK_MODE_KEY = "tpv_tutorial_blank_mode_v1";
const TUTORIAL_ACTIVE_KEY = "tpv_tutorial_active_v1";
const MESAS_REMOTE_SYNC_POLL_MS = 8000;
const MESAS_REMOTE_PULL_GRACE_MS = 15000;
const DESIGN_GRID_SIZE = 20;
const RESERVATION_MIN_TIME = "08:00";
const RESERVATION_MAX_TIME = "23:30";
const DESIGN_WORKSPACE_MIN_WIDTH = 1800;
const DESIGN_WORKSPACE_MIN_HEIGHT = 1100;

const DEFAULT_STATE = {
  activeView: "mapa",
  activeRoomId: null,
  selectedTableId: null,
  category: "all",
  search: "",
  parkedCounter: 0,
  roomList: [],
  tableTicketMap: {},
  tableStates: {},
  tableMeta: {},
  designSnapMode: "free",
  roomDesigns: {},
  // Este iframe no usa draftCartByTable para nada, pero como saveState()
  // reescribe el bloque ENTERO, si no lo conserva aqui lo borra para todas
  // las mesas en cuanto se toca cualquiera (aunque sea con el renderer
  // principal usandolo activamente en otra pestaña).
  draftCartByTable: {},
};

let state = cloneDefaultState();
let parkedTickets = [];
let cart = [];
let categories = [];
let products = [];
let selectedDesignObjectId = null;
let activeDesignTool = "mesa-redonda";
let dragState = null;
let designDragMoved = false;
let designPanState = null;
let designPanMoved = false;
let designCanvasSuppressClickUntil = 0;
let quickReturnView = "";
let mesasRemoteSyncTimer = null;
let mesasRemoteSyncInFlight = false;
let mesasRemotePollTimer = null;
let mesasRemoteFetchInFlight = false;
let mesasRemoteEventsBound = false;
let mesasRemoteQueueDrainInFlight = false;
let activeMapTooltipEl = null;
let activeMapTooltipUid = "";
let mapTooltipCloseGuardUntil = 0;
let designUndoByRoom = {};
let designRedoByRoom = {};
let designSnapToGrid = false;

const tabs = Array.from(document.querySelectorAll(".mesas-tab"));
const views = {
  mapa: document.getElementById("view-mapa"),
  transacciones: document.getElementById("view-transacciones"),
  diseno: document.getElementById("view-diseno"),
};

const roomSelect = document.getElementById("roomSelect");
const designRoomSelect = document.getElementById("designRoomSelect");
const mapEmptyState = document.getElementById("mapEmptyState");
const mesaCards = document.getElementById("mesaCards");
const selectedTableTitle = document.getElementById("selectedTableTitle");
const selectedTableState = document.getElementById("selectedTableState");
const ticketMesaTitle = document.getElementById("ticketMesaTitle");
const ticketMeta = document.getElementById("ticketMeta");
const ticketLines = document.getElementById("ticketLinesMesas");
const ticketTotal = document.getElementById("ticketTotalMesas");
const ticketSummaryLines = document.getElementById("ticketSummaryLines");
const ticketSummaryUnits = document.getElementById("ticketSummaryUnits");
const ticketSummaryUpdated = document.getElementById("ticketSummaryUpdated");
const productsGrid = document.getElementById("productsGridMesas");
const categoryBar = document.getElementById("categoryBar");
const otherTablesList = document.getElementById("otherTablesList");
const quickReturnBtn = document.getElementById("quickReturnBtn");
const productSearchInput = document.getElementById("productSearchMesas");
const designCanvas = document.getElementById("designCanvas");
const designHintText = document.getElementById("designHintText");
const designSelectionPanel = document.getElementById("designSelectionPanel");
const designSelectionTitle = document.getElementById("designSelectionTitle");
const designSelectionMeta = document.getElementById("designSelectionMeta");
const designSelectionActions = document.getElementById(
  "designSelectionActions",
);
const designUndoBtn = document.getElementById("designUndoBtn");
const designRedoBtn = document.getElementById("designRedoBtn");
const designSnapToggleBtn = document.getElementById("designSnapToggleBtn");
const toolButtons = Array.from(document.querySelectorAll(".tool-btn"));
const MESAS_BRIDGE = window.MESAS_BRIDGE || null;
const MESAS_URL_PARAMS = new URLSearchParams(window.location.search);
const MESAS_EMBED_MODE = MESAS_URL_PARAMS.get("embed") === "1";
const MESAS_EMBED_VIEW = ["mapa", "transacciones", "diseno"].includes(
  String(MESAS_URL_PARAMS.get("view") || "").toLowerCase(),
)
  ? String(MESAS_URL_PARAMS.get("view") || "").toLowerCase()
  : "";

function cloneDefaultState() {
  return {
    ...DEFAULT_STATE,
    tableTicketMap: { ...DEFAULT_STATE.tableTicketMap },
    tableStates: { ...DEFAULT_STATE.tableStates },
    tableMeta: { ...DEFAULT_STATE.tableMeta },
    roomList: [],
    roomDesigns: {},
  };
}

function getDefaultCapacityByClass(cls) {
  const key = String(cls || "").trim();
  if (key === "table-rect") return 6;
  if (key === "table-round") return 4;
  return 4;
}

function getTableMeta(uid, opts = {}) {
  const key = String(uid || "").trim();
  if (!key) {
    return {
      capacity: 4,
      diners: 0,
      reservationName: "",
      reservationTime: "",
      serviceStage: "",
    };
  }

  if (!state.tableMeta || typeof state.tableMeta !== "object") {
    state.tableMeta = {};
  }

  const existing = state.tableMeta[key];
  if (existing && typeof existing === "object") {
    return {
      capacity: Math.max(1, Number(existing.capacity || 4) || 4),
      diners: Math.max(0, Number(existing.diners || 0) || 0),
      reservationName: String(existing.reservationName || ""),
      reservationTime: String(existing.reservationTime || ""),
      serviceStage: String(existing.serviceStage || "")
        .trim()
        .toLowerCase(),
    };
  }

  const defaultCapacity = Math.max(
    1,
    Number(
      opts?.defaultCapacity || getDefaultCapacityByClass(opts?.objClass),
    ) || 4,
  );
  const meta = {
    capacity: defaultCapacity,
    diners: 0,
    reservationName: "",
    reservationTime: "",
    serviceStage: "",
  };
  state.tableMeta[key] = meta;
  return { ...meta };
}

function getHostApi() {
  try {
    if (window.parent && window.parent !== window) return window.parent;
  } catch {}
  return window;
}

async function showNotice(message, title = "Mesas") {
  const host = getHostApi();
  if (typeof host?.confirmModal === "function") {
    await host.confirmModal(title, String(message || ""), {
      cancelText: "Cerrar",
      confirmText: "Aceptar",
      hideCancel: true,
    });
    return;
  }
  alert(String(message || ""));
}

async function askConfirm(message, title = "Mesas") {
  const host = getHostApi();
  if (typeof host?.confirmModal === "function") {
    return !!(await host.confirmModal(title, String(message || ""), {
      cancelText: "Cancelar",
      confirmText: "Aceptar",
    }));
  }
  return !!confirm(String(message || ""));
}

function openVirtualKeyboardForInput(input, mode = "text") {
  try {
    const host = getHostApi();

    const resolveInput = () => {
      if (input?.isConnected) return input;

      const doc = input?.ownerDocument || document;
      const selectors = [];
      const id = String(input?.id || "").trim();
      const designField = String(
        input?.getAttribute?.("data-design-field") || "",
      ).trim();
      const tableInput = String(
        input?.getAttribute?.("data-table-input") || "",
      ).trim();
      const tableUid = String(
        input?.getAttribute?.("data-table-uid") || "",
      ).trim();
      const name = String(input?.getAttribute?.("name") || "").trim();

      if (id) selectors.push(`#${id}`);
      if (designField) selectors.push(`[data-design-field="${designField}"]`);
      if (tableInput && tableUid) {
        selectors.push(
          `[data-table-input="${tableInput}"][data-table-uid="${tableUid}"]`,
        );
      }
      if (name) selectors.push(`[name="${name}"]`);

      for (const selector of selectors) {
        try {
          const found = doc.querySelector(selector);
          if (found) return found;
        } catch {}
      }

      return input;
    };

    const liveInput = resolveInput();
    if (liveInput && typeof liveInput.focus === "function") liveInput.focus();

    if (liveInput?.type === "time") {
      try {
        if (typeof liveInput.showPicker === "function") liveInput.showPicker();
      } catch {}
      return false;
    }

    if (mode === "number" && typeof host?.openNumPad === "function") {
      const current = String(liveInput?.value || "").trim();
      host.openNumPad(
        current || "0",
        (newValue, meta = {}) => {
          if (meta?.phase !== "confirm") return;
          const target = resolveInput();
          if (!target) return;
          const raw = String(newValue ?? "").replace(",", ".");
          if (target?.type === "time") {
            const n = Math.max(0, Number(raw) || 0);
            const hh = String(Math.floor(n / 100) % 24).padStart(2, "0");
            const mm = String(Math.floor(n % 100)).padStart(2, "0");
            target.value = `${hh}:${mm}`;
          } else {
            target.value = String(Number(raw) || 0);
          }
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
        },
        "",
        "qty",
        null,
        null,
      );
      return true;
    }

    if (host?.TPV_QWERTY?.openForInput) {
      if (liveInput && typeof liveInput.focus === "function") {
        liveInput.focus();
        try {
          const len = String(liveInput.value || "").length;
          if (typeof liveInput.setSelectionRange === "function") {
            liveInput.setSelectionRange(len, len);
          }
        } catch {}
      }
      host.TPV_QWERTY.openForInput(liveInput, mode);
      return true;
    }
  } catch {}
  return false;
}

function shouldSkipKeyboardOnPointer(input, event) {
  if (!input || input.type !== "number") return false;
  if (!event || typeof event.clientX !== "number") return false;

  const rect = input.getBoundingClientRect();
  if (!rect || !Number.isFinite(rect.width) || rect.width <= 0) return false;

  const x = event.clientX - rect.left;
  const spinZone = Math.min(36, rect.width * 0.35);
  const dir = String(getComputedStyle(input).direction || "ltr").toLowerCase();
  if (dir === "rtl") return x <= spinZone;
  return x >= rect.width - spinZone;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uniqueId(base, taken) {
  let i = 1;
  let candidate = base || "item";
  while (taken.has(candidate)) {
    i += 1;
    candidate = `${base}-${i}`;
  }
  return candidate;
}

function extractMaxSuffixByPrefix(items, prefix) {
  const upper = String(prefix || "").toUpperCase();
  let max = 0;
  (Array.isArray(items) ? items : []).forEach((value) => {
    const text = String(value || "")
      .trim()
      .toUpperCase();
    const match = text.match(new RegExp(`^${upper}(\\d+)$`));
    if (!match) return;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max;
}

function nextRoomAutoName() {
  const max = extractMaxSuffixByPrefix(
    state.roomList.map((room) => room?.name),
    "S",
  );
  return `S${max + 1}`;
}

function safeText(value, fallback = "") {
  const t = String(value || "").trim();
  return t || fallback;
}

function sanitizeEntityName(value, fallback = "") {
  return safeText(value, fallback).replace(/\s+/g, " ");
}

function normalizeEntityName(value) {
  return sanitizeEntityName(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isRoomNameTaken(name, opts = {}) {
  const target = normalizeEntityName(name);
  if (!target) return false;

  const excludeRoomId = String(opts?.excludeRoomId || "").trim();
  return state.roomList.some((room) => {
    const roomId = String(room?.id || "").trim();
    if (excludeRoomId && roomId === excludeRoomId) return false;
    return normalizeEntityName(room?.name || "") === target;
  });
}

function isTableNameTaken(room, name, opts = {}) {
  const target = normalizeEntityName(name);
  if (!target || !room || !Array.isArray(room.tables)) return false;

  const excludeTableId = String(opts?.excludeTableId || "").trim();
  return room.tables.some((table) => {
    const tableId = String(table?.id || "").trim();
    if (excludeTableId && tableId === excludeTableId) return false;
    return normalizeEntityName(table?.name || "") === target;
  });
}

function normalizeTableCode(raw) {
  const m = String(raw || "")
    .trim()
    .toUpperCase()
    .match(/^M(\d+)$/);
  return m ? `M${Number(m[1])}` : "";
}

function extractTableCodeNum(raw) {
  const code = normalizeTableCode(raw);
  if (!code) return 0;
  return Number(code.slice(1)) || 0;
}

function nextTableCodeForRoom(room, usedSet = null) {
  const used = usedSet || new Set();
  if (!usedSet) {
    (Array.isArray(room?.tables) ? room.tables : []).forEach((table) => {
      const code = normalizeTableCode(table?.code || table?.name || "");
      if (code) used.add(code);
    });
  }
  let n = 1;
  while (used.has(`M${n}`)) n += 1;
  return `M${n}`;
}

function ensureRoomTableCodes(room) {
  if (!room || !Array.isArray(room.tables)) return;
  const used = new Set();

  room.tables.forEach((table) => {
    const fromCode = normalizeTableCode(table?.code || "");
    const fromName = normalizeTableCode(table?.name || "");
    const preferred = fromCode || fromName;
    if (preferred && !used.has(preferred)) {
      table.code = preferred;
      used.add(preferred);
      return;
    }
    table.code = "";
  });

  room.tables.forEach((table) => {
    if (normalizeTableCode(table.code)) return;
    const code = nextTableCodeForRoom(room, used);
    table.code = code;
    used.add(code);
  });
}

function getTableCode(room, table) {
  if (!table) return "M";
  const code = normalizeTableCode(table.code || "");
  if (code) return code;
  ensureRoomTableCodes(room);
  return normalizeTableCode(table.code || "") || "M";
}

function formatTableDisplay(room, table) {
  const code = getTableCode(room, table);
  const name = sanitizeEntityName(table?.name || "");
  if (!name || normalizeEntityName(name) === normalizeEntityName(code))
    return code;
  return `${code} - ${name}`;
}

function normalizeMesasViewName(viewName) {
  return ["mapa", "transacciones", "diseno"].includes(viewName) ? viewName : "";
}

function normalizeReservationTime(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return String(fallback || "").trim() || RESERVATION_MIN_TIME;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return String(fallback || "").trim() || RESERVATION_MIN_TIME;

  const hh = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const mm = Math.max(0, Math.min(59, Number(match[2]) || 0));
  const total = hh * 60 + mm;

  const [minH, minM] = RESERVATION_MIN_TIME.split(":").map(Number);
  const [maxH, maxM] = RESERVATION_MAX_TIME.split(":").map(Number);
  const minTotal = (Number(minH) || 0) * 60 + (Number(minM) || 0);
  const maxTotal = (Number(maxH) || 23) * 60 + (Number(maxM) || 59);
  const clamped = Math.max(minTotal, Math.min(maxTotal, total));

  const outH = String(Math.floor(clamped / 60)).padStart(2, "0");
  const outM = String(clamped % 60).padStart(2, "0");
  return `${outH}:${outM}`;
}

function getReservationAllowedTimes(stepMinutes = 30) {
  const [minH, minM] = RESERVATION_MIN_TIME.split(":").map(Number);
  const [maxH, maxM] = RESERVATION_MAX_TIME.split(":").map(Number);
  const minTotal = (Number(minH) || 0) * 60 + (Number(minM) || 0);
  const maxTotal = (Number(maxH) || 23) * 60 + (Number(maxM) || 59);
  const step = Math.max(5, Number(stepMinutes) || 30);
  const out = [];
  for (let total = minTotal; total <= maxTotal; total += step) {
    const h = String(Math.floor(total / 60)).padStart(2, "0");
    const m = String(total % 60).padStart(2, "0");
    out.push(`${h}:${m}`);
  }
  return out;
}

function buildReservationTimeOptions(selectedValue) {
  const normalized = normalizeReservationTime(
    selectedValue,
    RESERVATION_MIN_TIME,
  );
  return getReservationAllowedTimes(30)
    .map((time) => {
      const selected = time === normalized ? " selected" : "";
      return `<option value="${time}"${selected}>${time}</option>`;
    })
    .join("");
}

function updateDesignSnapToggleUI() {
  if (!designSnapToggleBtn) return;
  const mode = designSnapToGrid ? "grid" : "free";
  designSnapToggleBtn.dataset.mode = mode;
  designSnapToggleBtn.classList.toggle("is-active", designSnapToGrid);
  designSnapToggleBtn.textContent = designSnapToGrid
    ? "Modo grid"
    : "Modo libre";
  designSnapToggleBtn.title = designSnapToGrid
    ? "Snap activado: mover y redimensionar ajustando al grid"
    : "Snap desactivado: mover y redimensionar libremente";
}

function setDesignSnapMode(mode) {
  const next =
    String(mode || "free")
      .trim()
      .toLowerCase() === "grid";
  designSnapToGrid = next;
  state.designSnapMode = next ? "grid" : "free";
  updateDesignSnapToggleUI();
}

function setQuickReturnView(viewName) {
  const normalized = normalizeMesasViewName(String(viewName || "").trim());
  quickReturnView =
    normalized === "mapa" || normalized === "diseno" ? normalized : "";
}

function updateQuickReturnButton() {
  if (!quickReturnBtn) return;

  const canReturn = state.activeView === "transacciones" && !!quickReturnView;
  quickReturnBtn.classList.toggle("hidden", !canReturn);
  if (!canReturn) return;

  quickReturnBtn.textContent =
    quickReturnView === "diseno" ? "Volver al diseno" : "Volver al mapa";
}

function isTableDesignClass(cls) {
  return ["table-round", "table-square", "table-rect"].includes(
    String(cls || ""),
  );
}

function isResizableStructureClass(cls) {
  return ["structure-barra", "structure-entrada", "structure-muro"].includes(
    String(cls || ""),
  );
}

function closeMapTooltip() {
  if (activeMapTooltipEl) activeMapTooltipEl.remove();
  activeMapTooltipEl = null;
  activeMapTooltipUid = "";
}

function nextTableNameForRoom(room) {
  ensureRoomTableCodes(room);
  return nextTableCodeForRoom(room);
}

function createTableInRoom(room, preferredName = "") {
  if (!room || !Array.isArray(room.tables)) return null;

  const wanted =
    sanitizeEntityName(preferredName) || nextTableNameForRoom(room);
  if (!wanted || isTableNameTaken(room, wanted)) return null;

  const used = new Set(room.tables.map((table) => table.id));
  const id = uniqueId(
    slugify(wanted) || `mesa-${room.tables.length + 1}`,
    used,
  );
  const table = { id, name: wanted, code: "" };
  room.tables.push(table);
  ensureRoomTableCodes(room);
  return table;
}

function getDesignTableDisplayLabel(room, tableId) {
  const table = Array.isArray(room?.tables)
    ? room.tables.find((entry) => entry.id === tableId)
    : null;
  return getTableCode(room, table);
}

function createTableDesignObject(room, table, opts = {}) {
  const index = Number(opts.index || 0);
  const cls = String(opts.cls || "table-square");
  const defaults = getDefaultDesignObjectSizeByClass(cls);
  const w = Number(opts.w || defaults.w || 110);
  const h = Number(opts.h || defaults.h || 92);

  const columns = 6;
  const col = index % columns;
  const row = Math.floor(index / columns);
  const x = Number.isFinite(opts.x) ? opts.x : 22 + col * 108;
  const y = Number.isFinite(opts.y) ? opts.y : 22 + row * 92;

  return {
    id: opts.id || `obj-table-${room.id}-${table.id}`,
    cls,
    label: getDesignTableDisplayLabel(room, table.id),
    tableId: table.id,
    tableUid: tableUid(room.id, table.id),
    x,
    y,
    w,
    h,
  };
}

function syncRoomDesignWithTables(roomId, opts = {}) {
  const ensureMissing = opts?.ensureMissing !== false;
  const room = roomById(roomId);
  if (!room) return;

  const objects = getRoomDesignObjects(roomId);
  const tableMap = new Map(room.tables.map((table) => [table.id, table]));
  const usedTableIds = new Set();
  const nextObjects = [];

  objects.forEach((obj) => {
    if (!obj || typeof obj !== "object") return;
    if (!isTableDesignClass(obj.cls)) {
      nextObjects.push(obj);
      return;
    }

    let tableId = String(obj.tableId || "").trim();
    if (!tableId && obj.tableUid) {
      tableId = splitTableUid(obj.tableUid).tableId;
    }

    if (!tableId) {
      const freeTable = room.tables.find(
        (table) => !usedTableIds.has(table.id),
      );
      tableId = freeTable ? freeTable.id : "";
    }

    const table = tableMap.get(tableId);
    if (!table) return;

    usedTableIds.add(table.id);
    obj.tableId = table.id;
    obj.tableUid = tableUid(room.id, table.id);
    obj.label = getDesignTableDisplayLabel(room, table.id);
    nextObjects.push(obj);
  });

  if (ensureMissing) {
    room.tables.forEach((table) => {
      if (usedTableIds.has(table.id)) return;
      const tableCount = nextObjects.filter((obj) =>
        isTableDesignClass(obj.cls),
      ).length;
      nextObjects.push(
        createTableDesignObject(room, table, { index: tableCount }),
      );
    });
  }

  state.roomDesigns[roomId] = nextObjects;
}

function promptTextDialog(opts = {}) {
  const title = String(opts.title || "Introduce un valor");
  const initialValue = String(opts.initialValue || "");
  const placeholder = String(opts.placeholder || "");
  const keyboardMode = String(opts.keyboardMode || "text");

  if (MESAS_EMBED_MODE && getHostApi()?.TPV_QWERTY?.openForInput) {
    return new Promise((resolve) => {
      const host = getHostApi();
      const hiddenInput = document.createElement("input");
      hiddenInput.type = "text";
      hiddenInput.value = initialValue;
      hiddenInput.style.position = "fixed";
      hiddenInput.style.left = "-9999px";
      hiddenInput.style.top = "-9999px";
      hiddenInput.style.opacity = "0";
      hiddenInput.setAttribute("aria-hidden", "true");
      document.body.appendChild(hiddenInput);

      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        observer?.disconnect?.();
        hiddenInput.remove();
        resolve(String(value || ""));
      };

      let observer = null;
      try {
        host.TPV_QWERTY.openForInput(hiddenInput, keyboardMode);
      } catch {
        finish(hiddenInput.value);
        return;
      }

      const overlay = host?.document?.getElementById?.("qwertyOverlay");
      if (!overlay) {
        finish(hiddenInput.value);
        return;
      }

      observer = new MutationObserver(() => {
        if (overlay.classList.contains("hidden")) {
          finish(hiddenInput.value);
        }
      });
      observer.observe(overlay, {
        attributes: true,
        attributeFilter: ["class"],
      });

      if (overlay.classList.contains("hidden")) {
        finish(hiddenInput.value);
      }
    });
  }

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(15, 23, 42, 0.45)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    const panel = document.createElement("div");
    panel.style.width = "min(460px, calc(100vw - 32px))";
    panel.style.background = "#ffffff";
    panel.style.border = "1px solid #cbd5e1";
    panel.style.borderRadius = "12px";
    panel.style.padding = "14px";
    panel.style.boxShadow = "0 16px 30px rgba(0, 0, 0, 0.24)";

    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.fontWeight = "700";
    heading.style.marginBottom = "10px";

    const input = document.createElement("input");
    input.type = "text";
    input.value = initialValue;
    input.placeholder = placeholder;
    input.style.width = "100%";
    input.style.height = "38px";
    input.style.border = "1px solid #cbd5e1";
    input.style.borderRadius = "8px";
    input.style.padding = "8px 10px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "12px";

    const keyboardBtn = document.createElement("button");
    keyboardBtn.type = "button";
    keyboardBtn.textContent = "Teclado";
    keyboardBtn.className = "btn-soft";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.className = "btn-soft";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Guardar";
    saveBtn.className = "btn-soft";
    saveBtn.style.background = "#198cff";
    saveBtn.style.borderColor = "#198cff";
    saveBtn.style.color = "#ffffff";

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      overlay.remove();
      resolve(value);
    };

    cancelBtn.addEventListener("click", () => finish(""));
    saveBtn.addEventListener("click", () => finish(input.value));
    keyboardBtn.addEventListener("click", () => {
      input.focus();
      openVirtualKeyboardForInput(input, keyboardMode);
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish("");
    });
    input.addEventListener("focus", () => {
      openVirtualKeyboardForInput(input, keyboardMode);
    });
    input.addEventListener("pointerdown", (event) => {
      if (shouldSkipKeyboardOnPointer(input, event)) return;
      openVirtualKeyboardForInput(input, keyboardMode);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(input.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish("");
      }
    });

    actions.appendChild(keyboardBtn);
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    panel.appendChild(heading);
    panel.appendChild(input);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    input.focus();
    input.select();
  });
}

function promptTableMetaDialog(opts = {}) {
  const title = String(opts?.title || "Editar mesa");
  const initial = opts?.initial || {};

  const normalizeInt = (value, fallback, min) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.round(num));
  };

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(15, 23, 42, 0.45)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    const panel = document.createElement("div");
    panel.style.width = "min(520px, calc(100vw - 28px))";
    panel.style.background = "#ffffff";
    panel.style.border = "1px solid #cbd5e1";
    panel.style.borderRadius = "12px";
    panel.style.padding = "14px";
    panel.style.boxShadow = "0 16px 30px rgba(0, 0, 0, 0.24)";

    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.fontWeight = "700";
    heading.style.marginBottom = "10px";

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    grid.style.gap = "10px";

    const makeField = (labelText, inputEl) => {
      const wrap = document.createElement("label");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "4px";
      wrap.style.fontSize = "12px";
      wrap.style.fontWeight = "700";
      wrap.style.color = "#334155";
      const label = document.createElement("span");
      label.textContent = labelText;
      wrap.appendChild(label);
      wrap.appendChild(inputEl);
      return wrap;
    };

    const capacityInput = document.createElement("input");
    capacityInput.type = "number";
    capacityInput.min = "1";
    capacityInput.step = "1";
    capacityInput.value = String(normalizeInt(initial.capacity, 4, 1));

    const dinersInput = document.createElement("input");
    dinersInput.type = "number";
    dinersInput.min = "0";
    dinersInput.step = "1";
    dinersInput.value = String(normalizeInt(initial.diners, 0, 0));

    [capacityInput, dinersInput].forEach((el) => {
      el.style.width = "100%";
      el.style.height = "38px";
      el.style.border = "1px solid #cbd5e1";
      el.style.borderRadius = "8px";
      el.style.padding = "8px 10px";
      el.style.background = "#ffffff";
    });

    grid.appendChild(makeField("Capacidad", capacityInput));
    grid.appendChild(makeField("Comensales", dinersInput));

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "12px";

    const keyboardBtn = document.createElement("button");
    keyboardBtn.type = "button";
    keyboardBtn.textContent = "Teclado";
    keyboardBtn.className = "btn-soft";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.className = "btn-soft";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Guardar";
    saveBtn.className = "btn-soft";
    saveBtn.style.background = "#198cff";
    saveBtn.style.borderColor = "#198cff";
    saveBtn.style.color = "#ffffff";

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      overlay.remove();
      resolve(value);
    };

    const saveResult = () => {
      const capacity = normalizeInt(capacityInput.value, 4, 1);
      const diners = Math.min(capacity, normalizeInt(dinersInput.value, 0, 0));

      finish({ capacity, diners });
    };

    const bindKeyboard = (el, mode = "text") => {
      el.addEventListener("pointerdown", (event) => {
        if (shouldSkipKeyboardOnPointer(el, event)) return;
        openVirtualKeyboardForInput(el, mode);
      });
    };

    bindKeyboard(capacityInput, "number");
    bindKeyboard(dinersInput, "number");

    keyboardBtn.addEventListener("click", () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement) {
        openVirtualKeyboardForInput(
          active,
          active.type === "number" ? "number" : "text",
        );
      } else {
        dinersInput.focus();
        openVirtualKeyboardForInput(dinersInput, "number");
      }
    });
    cancelBtn.addEventListener("click", () => finish(null));
    saveBtn.addEventListener("click", saveResult);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveResult();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });

    actions.appendChild(keyboardBtn);
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    panel.appendChild(heading);
    panel.appendChild(grid);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    capacityInput.focus();
    capacityInput.select();
  });
}

function promptReservationDialog(opts = {}) {
  const title = String(opts?.title || "Reservar mesa");
  const initial = opts?.initial || {};

  const normalizeInt = (value, fallback, min) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.round(num));
  };

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(15, 23, 42, 0.45)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    const panel = document.createElement("div");
    panel.style.width = "min(520px, calc(100vw - 28px))";
    panel.style.background = "#ffffff";
    panel.style.border = "1px solid #cbd5e1";
    panel.style.borderRadius = "12px";
    panel.style.padding = "14px";
    panel.style.boxShadow = "0 16px 30px rgba(0, 0, 0, 0.24)";

    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.fontWeight = "700";
    heading.style.marginBottom = "10px";

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    grid.style.gap = "10px";

    const makeField = (labelText, inputEl) => {
      const wrap = document.createElement("label");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "4px";
      wrap.style.fontSize = "12px";
      wrap.style.fontWeight = "700";
      wrap.style.color = "#334155";
      const label = document.createElement("span");
      label.textContent = labelText;
      wrap.appendChild(label);
      wrap.appendChild(inputEl);
      return wrap;
    };

    const dinersInput = document.createElement("input");
    dinersInput.type = "number";
    dinersInput.min = "1";
    dinersInput.step = "1";
    dinersInput.value = String(normalizeInt(initial.diners, 2, 1));

    const reservationNameInput = document.createElement("input");
    reservationNameInput.type = "text";
    reservationNameInput.value = String(initial.reservationName || "");
    reservationNameInput.placeholder = "Nombre reserva";

    const reservationTimeInput = document.createElement("select");
    reservationTimeInput.innerHTML = buildReservationTimeOptions(
      initial.reservationTime,
    );
    reservationTimeInput.value = normalizeReservationTime(
      initial.reservationTime,
      RESERVATION_MIN_TIME,
    );

    [dinersInput, reservationNameInput, reservationTimeInput].forEach((el) => {
      el.style.width = "100%";
      el.style.height = "38px";
      el.style.border = "1px solid #cbd5e1";
      el.style.borderRadius = "8px";
      el.style.padding = "8px 10px";
      el.style.background = "#ffffff";
    });

    grid.appendChild(makeField("Personas", dinersInput));
    grid.appendChild(makeField("Hora reserva", reservationTimeInput));
    const fullRow = document.createElement("div");
    fullRow.style.gridColumn = "1 / -1";
    fullRow.appendChild(makeField("Nombre reserva", reservationNameInput));
    grid.appendChild(fullRow);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "12px";

    const keyboardBtn = document.createElement("button");
    keyboardBtn.type = "button";
    keyboardBtn.textContent = "Teclado";
    keyboardBtn.className = "btn-soft";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.className = "btn-soft";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Reservar";
    saveBtn.className = "btn-soft";
    saveBtn.style.background = "#198cff";
    saveBtn.style.borderColor = "#198cff";
    saveBtn.style.color = "#ffffff";

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      overlay.remove();
      resolve(value);
    };

    const saveResult = () => {
      const diners = normalizeInt(dinersInput.value, 2, 1);
      const reservationName =
        sanitizeEntityName(reservationNameInput.value, "Reserva") || "Reserva";
      const reservationTime = normalizeReservationTime(
        reservationTimeInput.value,
        initial.reservationTime || RESERVATION_MIN_TIME,
      );
      finish({ diners, reservationName, reservationTime });
    };

    const bindKeyboard = (el, mode = "text") => {
      el.addEventListener("pointerdown", (event) => {
        if (shouldSkipKeyboardOnPointer(el, event)) return;
        openVirtualKeyboardForInput(el, mode);
      });
    };
    bindKeyboard(dinersInput, "number");
    bindKeyboard(reservationNameInput, "text");

    keyboardBtn.addEventListener("click", () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement) {
        openVirtualKeyboardForInput(
          active,
          active.type === "number" ? "number" : "text",
        );
      }
    });
    cancelBtn.addEventListener("click", () => finish(null));
    saveBtn.addEventListener("click", saveResult);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveResult();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });

    actions.appendChild(keyboardBtn);
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    panel.appendChild(heading);
    panel.appendChild(grid);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    dinersInput.focus();
    dinersInput.select();
  });
}

function eur(v) {
  return `${(Number(v) || 0).toFixed(2).replace(".", ",")} EUR`;
}

function formatHourShort(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function applySavedThemeMode() {
  const mode = String(
    MESAS_BRIDGE?.getThemeMode?.() ||
      localStorage.getItem(TPV_THEME_KEY) ||
      "light",
  )
    .trim()
    .toLowerCase();
  document.body.classList.toggle("theme-dark", mode === "dark");
}

function tableUid(roomId, tableId) {
  return `${roomId}::${tableId}`;
}

function splitTableUid(uid) {
  const [roomId, tableId] = String(uid || "").split("::");
  return { roomId: roomId || "", tableId: tableId || "" };
}

function getSyncConfigRuntime() {
  const own = window.TPV_CONFIG || null;
  if (own) return own;
  try {
    if (window.parent && window.parent !== window) {
      return window.parent.TPV_CONFIG || null;
    }
  } catch {}
  return null;
}

function getMesasSyncApiUrl() {
  const cfg = getSyncConfigRuntime();
  return (
    String(cfg?.tpvSyncApiUrl || "").trim() ||
    "https://plus.recipok.com/tpv/api/index.php"
  );
}

function getMesasSyncApiKey() {
  const cfg = getSyncConfigRuntime();
  const fromCfg = String(cfg?.tpvApiKey || "").trim();
  if (fromCfg) return fromCfg;

  const fromRuntime = String(window.RECIPOK_API?.apiKey || "").trim();
  if (fromRuntime) return fromRuntime;

  const fromLs = String(localStorage.getItem("tpv_sync_api_key") || "").trim();
  if (fromLs) return fromLs;

  return "";
}

function getMesasSlugScope() {
  const baseUrl =
    localStorage.getItem("tpv_baseUrl") || window.RECIPOK_API?.baseUrl || "";
  const m = String(baseUrl).match(/plus\.recipok\.com\/([^/]+)\/api\/\d+/i);
  return m ? String(m[1]).trim() : "";
}

function getMesasLayoutScopedStorageKey() {
  const slug = String(getMesasSlugScope() || "").trim() || "default";
  return `${MESAS_LAYOUT_CACHE_KEY}::${slug}`;
}

function isTutorialBlankModeActive() {
  try {
    return String(localStorage.getItem(TUTORIAL_BLANK_MODE_KEY) || "") === "1";
  } catch {
    return false;
  }
}

function isTutorialPauseActive() {
  if (isTutorialBlankModeActive()) return true;
  try {
    return String(localStorage.getItem(TUTORIAL_ACTIVE_KEY) || "") === "1";
  } catch {
    return false;
  }
}

function isVirtualKeyboardOpen() {
  try {
    const host = getHostApi();
    const hostDoc = host?.document;
    if (!hostDoc) return false;

    const qwerty = hostDoc.getElementById?.("qwertyOverlay");
    if (qwerty && !qwerty.classList.contains("hidden")) return true;

    const numPad = hostDoc.getElementById?.("numPadOverlay");
    if (numPad && !numPad.classList.contains("hidden")) return true;
  } catch {}

  return false;
}

function markMesasLocalEditNow() {
  try {
    localStorage.setItem(MESAS_LOCAL_EDIT_TS_KEY, String(Date.now()));
  } catch {}
}

function hasRecentMesasLocalEdit() {
  try {
    const ts = Number(localStorage.getItem(MESAS_LOCAL_EDIT_TS_KEY) || 0) || 0;
    if (!ts) return false;
    return Date.now() - ts < MESAS_REMOTE_PULL_GRACE_MS;
  } catch {
    return false;
  }
}

function writeTablesStateRaw(payload) {
  if (MESAS_BRIDGE?.setTablesStateRaw) {
    MESAS_BRIDGE.setTablesStateRaw(payload);
  } else {
    localStorage.setItem(TABLES_STATE_KEY, payload);
  }
  localStorage.setItem(getMesasLayoutScopedStorageKey(), payload);
}

function readTablesStateRaw() {
  return (
    MESAS_BRIDGE?.getTablesStateRaw?.() ||
    localStorage.getItem(TABLES_STATE_KEY) ||
    localStorage.getItem(LEGACY_TABLES_STATE_KEY) ||
    localStorage.getItem(getMesasLayoutScopedStorageKey()) ||
    ""
  );
}

async function apiGetMesasLayoutRemote() {
  const slug = String(getMesasSlugScope() || "").trim();
  const apiKey = getMesasSyncApiKey();
  if (!slug || !apiKey) return null;

  const apiUrl = getMesasSyncApiUrl();
  const url = `${apiUrl}?action=get-mesas-layout&slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-TPV-API-KEY": apiKey,
    },
    cache: "no-store",
  });

  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const layout = data?.data?.layout ?? data?.layout ?? data?.data ?? null;
  return layout && typeof layout === "object" ? layout : null;
}

async function apiSaveMesasLayoutRemote(nextState) {
  const slug = String(getMesasSlugScope() || "").trim();
  const apiKey = getMesasSyncApiKey();
  if (!slug || !apiKey) {
    throw new Error("missing-mesas-remote-config");
  }

  const apiUrl = getMesasSyncApiUrl();
  const payload = {
    slug,
    layout: nextState && typeof nextState === "object" ? nextState : {},
    updatedAt: new Date().toISOString(),
  };

  const res = await fetch(`${apiUrl}?action=save-mesas-layout`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-TPV-API-KEY": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`mesas-layout-save-http-${res.status}`);
  }

  return true;
}

function getMesasLayoutSyncQueueStorageKey() {
  const slug = String(getMesasSlugScope() || "").trim() || "default";
  return `${MESAS_LAYOUT_SYNC_QUEUE_KEY}::${slug}`;
}

function loadMesasLayoutSyncQueue() {
  try {
    const raw = localStorage.getItem(getMesasLayoutSyncQueueStorageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMesasLayoutSyncQueue(queue) {
  try {
    const safe = Array.isArray(queue) ? queue : [];
    localStorage.setItem(
      getMesasLayoutSyncQueueStorageKey(),
      JSON.stringify(safe.slice(-200)),
    );
  } catch (e) {
    console.warn("No se pudo guardar cola de sync de Mesas:", e?.message || e);
  }
}

function enqueueMesasLayoutSync(nextState, opts = {}) {
  const slug = String(getMesasSlugScope() || "").trim() || "default";
  const layout = nextState && typeof nextState === "object" ? nextState : {};
  const updatedAt = String(opts?.updatedAt || new Date().toISOString());

  const queue = loadMesasLayoutSyncQueue();
  const entry = {
    key: `${slug}|layout`,
    slug,
    layout,
    queuedAt: new Date().toISOString(),
    updatedAt,
  };

  const idx = queue.findIndex((it) => String(it?.key || "") === entry.key);
  if (idx >= 0) queue[idx] = entry;
  else queue.push(entry);

  saveMesasLayoutSyncQueue(queue);
}

function isMesasSyncTransientError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("offline") ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("timeout") ||
    msg.includes("abort") ||
    msg.includes("http 5") ||
    msg.includes("http 429") ||
    msg.includes("missing-mesas-remote-config")
  );
}

async function processMesasLayoutSyncQueue() {
  if (mesasRemoteQueueDrainInFlight) return false;

  const queue = loadMesasLayoutSyncQueue();
  if (!queue.length) return true;

  mesasRemoteQueueDrainInFlight = true;
  try {
    const remaining = [];

    for (const entry of queue) {
      try {
        await apiSaveMesasLayoutRemote(entry?.layout || {});
      } catch (e) {
        remaining.push(entry);
        if (!isMesasSyncTransientError(e)) {
          console.warn(
            "Error persistente drenando cola de Mesas:",
            e?.message || e,
          );
        }
      }
    }

    saveMesasLayoutSyncQueue(remaining);
    return remaining.length === 0;
  } finally {
    mesasRemoteQueueDrainInFlight = false;
  }
}

function scheduleRemoteMesasStateSave(nextState) {
  if (isTutorialPauseActive()) return;

  if (mesasRemoteSyncTimer) {
    clearTimeout(mesasRemoteSyncTimer);
    mesasRemoteSyncTimer = null;
  }

  const safeState = nextState && typeof nextState === "object" ? nextState : {};
  mesasRemoteSyncTimer = setTimeout(async () => {
    mesasRemoteSyncTimer = null;
    if (mesasRemoteSyncInFlight) return;

    mesasRemoteSyncInFlight = true;
    try {
      await apiSaveMesasLayoutRemote(safeState);
    } catch (e) {
      enqueueMesasLayoutSync(safeState);
      console.warn("No se pudo guardar Mesas en remoto:", e?.message || e);
    } finally {
      mesasRemoteSyncInFlight = false;
    }
  }, 350);
}

function saveState() {
  const payload = JSON.stringify(state);
  writeTablesStateRaw(payload);
  markMesasLocalEditNow();
  scheduleRemoteMesasStateSave(state);
  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ type: "tpv:mesas-state-changed" }, "*");
    } catch {}
  }
}

function normalizeTables(rawTables, roomId) {
  if (!Array.isArray(rawTables)) return [];
  const seen = new Set();
  const seenNames = new Set();
  const out = [];

  rawTables.forEach((entry, idx) => {
    if (typeof entry === "string") {
      const tableName = sanitizeEntityName(entry);
      if (!tableName) return;

      const normName = normalizeEntityName(tableName);
      if (!normName || seenNames.has(normName)) return;

      const id = uniqueId(slugify(tableName) || `mesa-${idx + 1}`, seen);
      seen.add(id);
      seenNames.add(normName);
      out.push({ id, name: tableName, code: normalizeTableCode(tableName) });
      return;
    }

    const name = sanitizeEntityName(entry?.name || entry?.id, "Mesa");
    const code = normalizeTableCode(entry?.code || entry?.name || "");
    const normName = normalizeEntityName(name);
    if (!normName || seenNames.has(normName)) return;

    const proposedId = slugify(entry?.id || entry?.name || `mesa-${idx + 1}`);
    const id = uniqueId(proposedId || `mesa-${idx + 1}`, seen);
    seen.add(id);
    seenNames.add(normName);
    out.push({ id, name, code });
  });

  return out;
}

function loadState() {
  try {
    const raw =
      MESAS_BRIDGE?.getTablesStateRaw?.() ||
      localStorage.getItem(TABLES_STATE_KEY) ||
      localStorage.getItem(LEGACY_TABLES_STATE_KEY) ||
      localStorage.getItem(getMesasLayoutScopedStorageKey());
    if (!raw) {
      state = cloneDefaultState();
      return;
    }

    const parsed = JSON.parse(raw);
    const base = cloneDefaultState();
    const roomList = Array.isArray(parsed?.roomList)
      ? parsed.roomList
          .map((r, idx) => {
            const name = sanitizeEntityName(r?.name, `Sala ${idx + 1}`);
            const id = slugify(r?.id || name) || `sala-${idx + 1}`;
            const tables = normalizeTables(r?.tables, id);
            return { id, name, tables };
          })
          .filter((r) => r.id)
      : [];

    roomList.forEach((room) => ensureRoomTableCodes(room));

    state = {
      ...base,
      activeView: ["mapa", "transacciones", "diseno"].includes(
        parsed?.activeView,
      )
        ? parsed.activeView
        : base.activeView,
      activeRoomId: parsed?.activeRoomId ? String(parsed.activeRoomId) : null,
      selectedTableId: parsed?.selectedTableId
        ? String(parsed.selectedTableId)
        : null,
      designSnapMode:
        String(parsed?.designSnapMode || "")
          .trim()
          .toLowerCase() === "grid"
          ? "grid"
          : "free",
      category: String(parsed?.category || "all"),
      search: String(parsed?.search || ""),
      parkedCounter: Number(parsed?.parkedCounter || 0) || 0,
      tableTicketMap:
        parsed?.tableTicketMap && typeof parsed.tableTicketMap === "object"
          ? { ...parsed.tableTicketMap }
          : {},
      tableStates:
        parsed?.tableStates && typeof parsed.tableStates === "object"
          ? { ...parsed.tableStates }
          : {},
      tableMeta:
        parsed?.tableMeta && typeof parsed.tableMeta === "object"
          ? { ...parsed.tableMeta }
          : {},
      roomDesigns:
        parsed?.roomDesigns && typeof parsed.roomDesigns === "object"
          ? { ...parsed.roomDesigns }
          : {},
      draftCartByTable:
        parsed?.draftCartByTable && typeof parsed.draftCartByTable === "object"
          ? { ...parsed.draftCartByTable }
          : {},
      roomList,
    };
    designSnapToGrid = state.designSnapMode === "grid";
    updateDesignSnapToggleUI();
  } catch {
    state = cloneDefaultState();
    designSnapToGrid = false;
    updateDesignSnapToggleUI();
  }
}

async function hydrateStateFromRemote() {
  if (isTutorialPauseActive()) return false;
  if (isVirtualKeyboardOpen()) return false;
  if (hasRecentMesasLocalEdit()) return false;
  if (mesasRemoteSyncTimer || mesasRemoteSyncInFlight) return false;
  if (mesasRemoteQueueDrainInFlight) return false;
  if (mesasRemoteFetchInFlight) return false;

  try {
    await processMesasLayoutSyncQueue();
    mesasRemoteFetchInFlight = true;
    const remote = await apiGetMesasLayoutRemote();
    if (!remote || typeof remote !== "object") return false;

    const payload = JSON.stringify(remote);
    const currentRaw = String(readTablesStateRaw() || "").trim();
    if (payload === currentRaw) return false;

    writeTablesStateRaw(payload);
    return true;
  } catch (e) {
    console.warn("No se pudo cargar Mesas desde remoto:", e?.message || e);
    return false;
  } finally {
    mesasRemoteFetchInFlight = false;
  }
}

async function refreshMesasStateFromRemoteWithRerender() {
  if (isTutorialPauseActive()) return false;
  if (isVirtualKeyboardOpen()) return false;
  const changed = await hydrateStateFromRemote();
  if (!changed) return false;

  // Evita cerrar el contextual mientras se esta consultando/editarndo una mesa.
  if (activeMapTooltipEl && state.activeView === "mapa") return false;
  if (state.activeView === "diseno") return false;

  loadState();
  ensureActiveRoomAndTable();
  loadCartFromSelectedTable();
  renderEverything();
  switchView(state.activeView);
  return true;
}

function startMesasRemoteSyncPolling() {
  if (mesasRemotePollTimer) return;

  mesasRemotePollTimer = setInterval(() => {
    if (isTutorialPauseActive()) return;
    if (isVirtualKeyboardOpen()) return;
    if (document.hidden) return;
    refreshMesasStateFromRemoteWithRerender().catch(() => {});
  }, MESAS_REMOTE_SYNC_POLL_MS);
}

function bindMesasRemoteSyncEventsOnce() {
  if (mesasRemoteEventsBound) return;
  mesasRemoteEventsBound = true;

  document.addEventListener("visibilitychange", () => {
    if (isTutorialPauseActive()) return;
    if (isVirtualKeyboardOpen()) return;
    if (document.hidden) return;
    refreshMesasStateFromRemoteWithRerender().catch(() => {});
  });

  window.addEventListener("focus", () => {
    if (isTutorialPauseActive()) return;
    if (isVirtualKeyboardOpen()) return;
    refreshMesasStateFromRemoteWithRerender().catch(() => {});
  });

  window.addEventListener("online", () => {
    if (isTutorialPauseActive()) return;
    if (isVirtualKeyboardOpen()) return;
    processMesasLayoutSyncQueue()
      .then(() => refreshMesasStateFromRemoteWithRerender())
      .catch(() => {});
  });
}

function loadParkedTickets() {
  try {
    const baseUrl =
      localStorage.getItem("tpv_baseUrl") || window.RECIPOK_API?.baseUrl || "";
    const slugMatch = String(baseUrl).match(
      /plus\.recipok\.com\/([^/]+)\/api\/\d+/i,
    );
    const slug = slugMatch ? String(slugMatch[1] || "").trim() : "";
    const scopedKey = `${PARKED_TICKETS_CACHE_KEY}::${slug || "default"}::mesas`;

    const raw =
      localStorage.getItem(scopedKey) ||
      localStorage.getItem(PARKED_TICKETS_CACHE_KEY);
    parkedTickets = raw ? JSON.parse(raw) : [];
  } catch {
    parkedTickets = [];
  }

  if (!Array.isArray(parkedTickets)) parkedTickets = [];
}

function saveParkedTickets() {
  const payload = JSON.stringify(parkedTickets);
  localStorage.setItem(PARKED_TICKETS_CACHE_KEY, payload);

  try {
    const baseUrl =
      localStorage.getItem("tpv_baseUrl") || window.RECIPOK_API?.baseUrl || "";
    const slugMatch = String(baseUrl).match(
      /plus\.recipok\.com\/([^/]+)\/api\/\d+/i,
    );
    const slug = slugMatch ? String(slugMatch[1] || "").trim() : "";
    const scopedKey = `${PARKED_TICKETS_CACHE_KEY}::${slug || "default"}::mesas`;
    localStorage.setItem(scopedKey, payload);
  } catch {}
}

async function persistAppMode(mode) {
  const next =
    String(mode || "tpv").toLowerCase() === "mesas" ? "mesas" : "tpv";

  try {
    if (MESAS_BRIDGE?.setAppMode) MESAS_BRIDGE.setAppMode(next);
    else localStorage.setItem(APP_MODE_KEY, next);
  } catch {}

  try {
    await window.TPV_CFG?.set?.(APP_MODE_CFG_KEY, next);
  } catch {}

  return next;
}

function roomById(roomId) {
  return state.roomList.find((r) => r.id === roomId) || null;
}

function findTableByUid(uid) {
  const { roomId, tableId } = splitTableUid(uid);
  const room = roomById(roomId);
  if (!room) return null;
  const table = room.tables.find((t) => t.id === tableId);
  if (!table) return null;
  return { room, table, uid };
}

function allTables() {
  const result = [];
  state.roomList.forEach((room) => {
    room.tables.forEach((table) => {
      result.push({ room, table, uid: tableUid(room.id, table.id) });
    });
  });
  return result;
}

function resolveTicketMesaUidLocal(ticket) {
  const directUid = String(ticket?.mesaUid || "").trim();
  if (directUid) return directUid;

  const normalize = (v) =>
    String(v || "")
      .trim()
      .toLowerCase();

  const obs = String(ticket?.obs || "").trim();
  const obsMatch =
    obs.match(/^mesa\s+(.+?)\s*·\s*(.+)$/i) ||
    obs.match(/^mesa\s+(.+?)\s+-\s+(.+)$/i);
  const mesaName = String(
    ticket?.mesaName ||
      ticket?.mesaTableName ||
      (obsMatch ? obsMatch[1] : "") ||
      "",
  ).trim();
  if (!mesaName) return "";

  const roomHintId = String(ticket?.mesaRoomId || "").trim();
  const roomHintName = String(
    ticket?.mesaRoomName || (obsMatch ? obsMatch[2] : "") || "",
  ).trim();

  const roomList = Array.isArray(state?.roomList) ? state.roomList : [];
  const candidateRooms = roomList.filter((room) => {
    if (roomHintId && String(room?.id || "").trim() === roomHintId) return true;
    if (!roomHintName) return !roomHintId;
    return normalize(room?.name || room?.id || "") === normalize(roomHintName);
  });

  const roomsToScan = candidateRooms.length ? candidateRooms : roomList;
  for (const room of roomsToScan) {
    const roomId = String(room?.id || "").trim();
    if (!roomId) continue;
    const tables = Array.isArray(room?.tables) ? room.tables : [];
    const match = tables.find((table) => {
      const tableCode = getTableCode(room, table);
      const tableName = String(table?.name || table?.id || "").trim();
      const tableDisplay = formatTableDisplay(room, table);
      const target = normalize(mesaName);
      return (
        (tableCode && normalize(tableCode) === target) ||
        (tableName && normalize(tableName) === target) ||
        (tableDisplay && normalize(tableDisplay) === target)
      );
    });
    if (match) return tableUid(roomId, String(match.id || "").trim());
  }

  return "";
}

function getMappedTicketForTable(uid) {
  const ticketId = state.tableTicketMap[uid];
  if (ticketId) {
    const direct =
      parkedTickets.find((t) => String(t.id) === String(ticketId) && !t.paid) ||
      null;
    if (direct) return direct;
  }

  return (
    parkedTickets.find(
      (t) =>
        !t?.paid && resolveTicketMesaUidLocal(t) === String(uid || "").trim(),
    ) || null
  );
}

function getLineUnitForTotals(line) {
  const gross = Number(line?.grossPrice);
  if (Number.isFinite(gross)) return gross;

  const net = Number(line?.price);
  const tax = Number(line?.taxRate);
  if (Number.isFinite(net)) {
    if (Number.isFinite(tax)) return net * (1 + tax / 100);
    return net;
  }

  return 0;
}

function round2Mesas(n) {
  const v = Number(n) || 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// "Neto primero" como FacturaScripts (y como el TPV principal), para que el
// total de la mesa coincida con lo que se cobra/factura:
// base = round2(neto*qty); iva = round2(base*tasa/100); total = base+iva.
function computeLineTotalNetFirst(line, qty) {
  const gross = getLineUnitForTotals(line);
  const rate = Number(line?.taxRate) || 0;
  const divisor = 1 + rate / 100;
  const netUnit = divisor > 0 ? gross / divisor : gross;
  const base = round2Mesas(netUnit * qty);
  const iva = round2Mesas(base * (rate / 100));
  return round2Mesas(base + iva);
}

function computeTicketTotalFromItems(items) {
  const src = Array.isArray(items) ? items : [];
  return src.reduce((sum, line) => {
    const qty = Number(line?.qty ?? line?.cantidad ?? 1) || 0;
    return sum + computeLineTotalNetFirst(line, qty);
  }, 0);
}

function getTableStatus(uid) {
  const ticket = getMappedTicketForTable(uid);
  const manualState = String(state.tableStates?.[uid] || "")
    .trim()
    .toLowerCase();

  // Un ticket activo siempre implica mesa ocupada (o pide cuenta si se marcó manualmente).
  if (ticket) {
    const computed = computeTicketTotalFromItems(ticket?.items);
    const fallback = Number(ticket?.total || 0) || 0;
    const total = computed > 0 ? computed : fallback;
    if (manualState === "cuenta") {
      return { code: "cuenta", label: "Pide cuenta", total };
    }
    return { code: "ocupada", label: "Ocupada", total };
  }

  if (manualState === "reservada")
    return { code: "reservada", label: "Reservada", total: 0 };
  if (manualState === "ocupada")
    return { code: "ocupada", label: "Ocupada", total: 0 };
  if (manualState === "cuenta")
    return { code: "cuenta", label: "Pide cuenta", total: 0 };
  return { code: "libre", label: "Libre", total: 0 };
}

function getTableServiceStage(uid, ticket, statusCode = "") {
  const raw = String(state?.tableMeta?.[uid]?.serviceStage || "")
    .trim()
    .toLowerCase();

  if (raw === "cuenta-pedida") return "Cuenta pedida";
  if (raw === "cobro-realizado") return "Cuenta cobrada";
  if (raw === "sin-pedir") return "Sin pedir";
  if (raw === "pedido") return "Pedido";
  if (raw === "entregado") return "Entregado";

  const st = String(statusCode || "")
    .trim()
    .toLowerCase();
  if (st !== "ocupada" && st !== "cuenta") return "";
  if (st === "cuenta") return "Cuenta pedida";
  if (ticket) {
    const hasItems = Array.isArray(ticket?.items) && ticket.items.length > 0;
    return hasItems ? "Pedido" : "Sin pedir";
  }

  return "";
}

function getTableServiceStageKey(uid, ticket, statusCode = "") {
  const raw = String(state?.tableMeta?.[uid]?.serviceStage || "")
    .trim()
    .toLowerCase();
  if (
    [
      "sin-pedir",
      "pedido",
      "entregado",
      "cuenta-pedida",
      "cobro-realizado",
    ].includes(raw)
  ) {
    return raw;
  }
  const st = String(statusCode || "")
    .trim()
    .toLowerCase();
  if (st !== "ocupada" && st !== "cuenta") return "";
  if (st === "cuenta") return "cuenta-pedida";
  if (ticket) {
    const hasItems = Array.isArray(ticket?.items) && ticket.items.length > 0;
    return hasItems ? "pedido" : "sin-pedir";
  }
  return "";
}

function setTableManualState(uid, nextState) {
  const key = String(uid || "").trim();
  if (!key) return;

  const next = String(nextState || "")
    .trim()
    .toLowerCase();
  if (!state.tableStates || typeof state.tableStates !== "object") {
    state.tableStates = {};
  }

  if (["libre", "reservada", "ocupada", "cuenta"].includes(next)) {
    state.tableStates[key] = next;
  } else {
    delete state.tableStates[key];
  }

  if (next !== "ocupada" && next !== "cuenta") {
    const meta = getTableMeta(key);
    state.tableMeta[key] = { ...meta, serviceStage: "" };
  }

  // Si se marca manualmente como ocupada, parte en "sin-pedir".
  if (next === "ocupada") {
    const meta = getTableMeta(key);
    state.tableMeta[key] = {
      ...meta,
      serviceStage: "sin-pedir",
    };
  }

  if (next === "cuenta") {
    const meta = getTableMeta(key);
    state.tableMeta[key] = {
      ...meta,
      serviceStage: "cuenta-pedida",
    };
  }

  if (next !== "reservada") {
    const meta = getTableMeta(key);
    state.tableMeta[key] = {
      ...meta,
      reservationName: "",
      reservationTime: "",
    };
  }
}

function setTableServiceStage(uid, stage) {
  const key = String(uid || "").trim();
  if (!key) return;

  const status = getTableStatus(key).code;
  if (status !== "ocupada" && status !== "cuenta") return;

  const next = String(stage || "")
    .trim()
    .toLowerCase();
  if (!state.tableMeta || typeof state.tableMeta !== "object") {
    state.tableMeta = {};
  }

  const currentMeta = getTableMeta(key);
  const allowed =
    status === "cuenta"
      ? ["cuenta-pedida", "cobro-realizado"]
      : ["sin-pedir", "pedido", "entregado"];
  state.tableMeta[key] = {
    ...currentMeta,
    serviceStage: allowed.includes(next)
      ? next
      : currentMeta.serviceStage || "",
  };
}

function getAvailableStateTransitions(statusCode = "", uid = "") {
  const current = String(statusCode || "")
    .trim()
    .toLowerCase();
  if (current === "reservada") {
    return [
      { code: "ocupada", label: "Pasar a ocupada" },
      { code: "libre", label: "Cancelar reserva" },
    ];
  }
  if (current === "ocupada") {
    return [{ code: "cuenta", label: "Pide cuenta" }];
  }
  if (current === "cuenta") {
    const stage = String(state?.tableMeta?.[uid]?.serviceStage || "")
      .trim()
      .toLowerCase();
    if (stage !== "cobro-realizado") return [];
    return [{ code: "libre", label: "Cobrada y liberar" }];
  }
  return [
    { code: "ocupada", label: "Pasar a ocupada" },
    { code: "reservada", label: "Reservar" },
  ];
}

function cycleTableServiceStage(uid) {
  const status = getTableStatus(uid).code;
  if (status !== "ocupada" && status !== "cuenta") return;

  const current = String(state?.tableMeta?.[uid]?.serviceStage || "")
    .trim()
    .toLowerCase();
  const order = ["", "sin-pedir", "pedido", "entregado", ""];
  const idx = order.indexOf(current);
  const next = order[idx >= 0 ? idx + 1 : 1] || "";

  if (!state.tableMeta || typeof state.tableMeta !== "object") {
    state.tableMeta = {};
  }

  const currentMeta = getTableMeta(uid);
  state.tableMeta[uid] = {
    ...currentMeta,
    serviceStage: next,
  };
}

function cycleTableStatus(uid) {
  const current = String(state.tableStates?.[uid] || "")
    .trim()
    .toLowerCase();
  const order = ["", "reservada", "ocupada", "cuenta", ""];
  const idx = order.indexOf(current);
  const next = order[idx >= 0 ? idx + 1 : 1] || "";

  if (!state.tableStates || typeof state.tableStates !== "object") {
    state.tableStates = {};
  }

  if (next) state.tableStates[uid] = next;
  else delete state.tableStates[uid];

  if (
    next !== "ocupada" &&
    state.tableMeta &&
    state.tableMeta[uid] &&
    typeof state.tableMeta[uid] === "object"
  ) {
    state.tableMeta[uid].serviceStage = "";
  }
}

async function editTableMeta(uid) {
  const info = findTableByUid(uid);
  if (!info) return;

  const currentMeta = getTableMeta(uid);
  const result = await promptTableMetaDialog({
    title: `Mesa ${formatTableDisplay(info.room, info.table)}`,
    initial: currentMeta,
  });
  if (!result) return;

  if (!state.tableMeta || typeof state.tableMeta !== "object") {
    state.tableMeta = {};
  }

  state.tableMeta[uid] = {
    ...currentMeta,
    capacity: Math.max(1, Number(result.capacity || 4) || 4),
    diners: Math.max(0, Number(result.diners || 0) || 0),
    reservationName: String(currentMeta.reservationName || ""),
    reservationTime: String(currentMeta.reservationTime || ""),
    serviceStage: String(currentMeta.serviceStage || ""),
  };

  saveState();
  renderEverything();
}

async function reserveTable(uid) {
  const info = findTableByUid(uid);
  if (!info) return;

  const currentStatus = getTableStatus(uid).code;
  if (currentStatus !== "libre") {
    await showNotice("Solo puedes reservar mesas libres.");
    return;
  }

  const currentMeta = getTableMeta(uid);
  const result = await promptReservationDialog({
    title: `Reservar ${formatTableDisplay(info.room, info.table)}`,
    initial: currentMeta,
  });
  if (!result) return;

  if (!state.tableMeta || typeof state.tableMeta !== "object") {
    state.tableMeta = {};
  }

  state.tableMeta[uid] = {
    ...currentMeta,
    diners: Math.min(
      Math.max(1, Number(currentMeta.capacity || 4) || 4),
      Math.max(1, Number(result.diners || 1) || 1),
    ),
    reservationName: String(result.reservationName || "Reserva"),
    reservationTime: normalizeReservationTime(
      result.reservationTime,
      currentMeta.reservationTime || RESERVATION_MIN_TIME,
    ),
  };
  setTableManualState(uid, "reservada");

  saveState();
  renderEverything();
}

function lineTotal(line) {
  return (Number(line.qty) || 0) * getLineUnitForTotals(line);
}

function cartTotal() {
  return cart.reduce((sum, line) => sum + lineTotal(line), 0);
}

function ensureActiveRoomAndTable() {
  if (!state.roomList.length) {
    state.activeRoomId = null;
    state.selectedTableId = null;
    cart = [];
    return;
  }

  if (!roomById(state.activeRoomId)) {
    state.activeRoomId = state.roomList[0].id;
  }

  const current = findTableByUid(state.selectedTableId);
  if (!current) {
    const room = roomById(state.activeRoomId);
    if (room && room.tables.length) {
      state.selectedTableId = tableUid(room.id, room.tables[0].id);
    } else {
      state.selectedTableId = null;
      cart = [];
    }
  }
}

function switchView(viewName) {
  state.activeView = ["mapa", "transacciones", "diseno"].includes(viewName)
    ? viewName
    : "mapa";

  if (state.activeView !== "transacciones") {
    setQuickReturnView("");
  }

  saveState();

  tabs.forEach((tab) =>
    tab.classList.toggle("is-active", tab.dataset.view === state.activeView),
  );
  Object.entries(views).forEach(([name, el]) => {
    el.classList.toggle("is-active", name === state.activeView);
  });

  if (state.activeView === "diseno") {
    renderDesignCanvas();
  } else {
    // Refresca mapa/transacciones al volver desde flujo embebido.
    renderEverything();
  }

  updateQuickReturnButton();
}

function renderRoomSelectors() {
  const hasRooms = state.roomList.length > 0;
  mapEmptyState.classList.toggle("hidden", hasRooms);
  mesaCards.classList.toggle("hidden", !hasRooms);

  roomSelect.innerHTML = "";
  designRoomSelect.innerHTML = "";

  state.roomList.forEach((room) => {
    const option = document.createElement("option");
    option.value = room.id;
    option.textContent = room.name;
    if (room.id === state.activeRoomId) option.selected = true;
    roomSelect.appendChild(option);

    const optionDesign = document.createElement("option");
    optionDesign.value = room.id;
    optionDesign.textContent = room.name;
    if (room.id === state.activeRoomId) optionDesign.selected = true;
    designRoomSelect.appendChild(optionDesign);
  });

  roomSelect.disabled = !hasRooms;
  designRoomSelect.disabled = !hasRooms;
}

function renderMapCards() {
  const reopenTooltipUid = String(activeMapTooltipUid || "").trim();
  if (activeMapTooltipEl) activeMapTooltipEl.remove();
  mesaCards.innerHTML = "";
  activeMapTooltipEl = null;
  const room = roomById(state.activeRoomId);
  if (!room) return;

  mesaCards.classList.add("gestion-canvas");
  syncRoomDesignWithTables(room.id);
  const objects = getRoomDesignObjects(room.id);

  const orderByUid = new Map();
  objects
    .filter((obj) => !!obj?.tableUid)
    .map((obj) => {
      const uid = String(obj.tableUid || "").trim();
      const ticket = getMappedTicketForTable(uid);
      const statusCode = getTableStatus(uid).code;
      if (!ticket || (statusCode !== "ocupada" && statusCode !== "cuenta")) {
        return null;
      }
      const order = Number(ticket?.id || 0);
      return {
        uid,
        order: Number.isFinite(order) && order > 0 ? order : 0,
        createdAt: new Date(
          ticket?.createdAt || ticket?.updatedAt || Date.now(),
        ).getTime(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((entry, idx) => {
      orderByUid.set(entry.uid, entry.order > 0 ? entry.order : idx + 1);
    });

  const formatTicketHour = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const buildTooltipHtml = (
    tableLabel,
    status,
    meta,
    ticket,
    totalText,
    uid,
  ) => {
    const statusLabel = String(status?.label || "");
    const statusCode = String(status?.code || "");
    const items = Array.isArray(ticket?.items) ? ticket.items : [];
    const startedAt = ticket?.createdAt
      ? formatTicketHour(ticket.createdAt)
      : "--:--";
    const stageLabel = getTableServiceStage(uid, ticket, statusCode);
    const rows = [];
    rows.push(
      `<div class="gestion-tip-title">Mesa ${tableLabel} · ${statusLabel}</div>`,
    );

    let quickAction = "";
    let editBlock = "";
    if (statusCode === "libre") {
      rows.push(
        `<div class="gestion-tip-row"><span>Capacidad</span><strong>${meta.capacity}</strong></div>`,
      );
      quickAction = `<button type="button" class="gestion-tip-primary is-open" data-table-act="open" data-table-uid="${uid}">Abrir ticket</button>`;
      editBlock = `
        <div class="gestion-tip-group-title">Editar mesa</div>
        <div class="gestion-tip-edit-grid">
          <label class="gestion-tip-input-wrap is-full">
            <span>Comensales</span>
            <input type="number" min="0" step="1" value="${Math.max(0, Number(meta.diners || 0) || 0)}" data-table-input="diners" data-table-uid="${uid}" />
          </label>
        </div>
      `;
    } else if (statusCode === "reservada") {
      rows.push(
        `<div class="gestion-tip-row"><span>Reserva</span><strong>${meta.reservationName || "-"}</strong></div>`,
      );
      rows.push(
        `<div class="gestion-tip-row"><span>Personas</span><strong>${meta.diners || 0}</strong></div>`,
      );
      rows.push(
        `<div class="gestion-tip-row"><span>Hora</span><strong>${meta.reservationTime || "--:--"}</strong></div>`,
      );
      quickAction = `<button type="button" class="gestion-tip-primary is-open" data-table-act="open" data-table-uid="${uid}">Abrir ticket</button>`;
      editBlock = `
        <div class="gestion-tip-group-title">Editar reserva</div>
        <div class="gestion-tip-edit-grid is-reservation">
          <label class="gestion-tip-input-wrap">
            <span>Comensales</span>
            <input type="number" min="1" step="1" value="${Math.max(1, Number(meta.diners || 1) || 1)}" data-table-input="diners" data-table-uid="${uid}" />
          </label>
          <label class="gestion-tip-input-wrap is-full">
            <span>Nombre</span>
            <input type="text" value="${String(meta.reservationName || "").replace(/"/g, "&quot;")}" data-table-input="reservation-name" data-table-uid="${uid}" />
          </label>
          <label class="gestion-tip-input-wrap">
            <span>Hora (24h)</span>
            <select data-table-input="reservation-time" data-table-uid="${uid}">${buildReservationTimeOptions(meta.reservationTime)}</select>
          </label>
        </div>
      `;
    } else if (statusCode === "ocupada") {
      rows.push(
        `<div class="gestion-tip-row"><span>Comensales</span><strong>${meta.diners}</strong></div>`,
      );
      rows.push(
        `<div class="gestion-tip-row"><span>Total</span><strong>${totalText || eur(0)}</strong></div>`,
      );
      rows.push(
        `<div class="gestion-tip-row"><span>Líneas</span><strong>${items.length}</strong></div>`,
      );
      rows.push(
        `<div class="gestion-tip-row"><span>Inicio</span><strong>${startedAt}</strong></div>`,
      );
      if (stageLabel)
        rows.push(
          `<div class="gestion-tip-row"><span>Servicio</span><strong>${stageLabel}</strong></div>`,
        );
      quickAction = `<button type="button" class="gestion-tip-primary is-view" data-table-act="view" data-table-uid="${uid}">Ver ticket</button>`;
      editBlock = `
        <div class="gestion-tip-group-title">Editar mesa</div>
        <div class="gestion-tip-edit-grid">
          <label class="gestion-tip-input-wrap is-full">
            <span>Comensales</span>
            <input type="number" min="0" step="1" value="${Math.max(0, Number(meta.diners || 0) || 0)}" data-table-input="diners" data-table-uid="${uid}" />
          </label>
        </div>
      `;
    } else if (statusCode === "cuenta") {
      rows.push(
        `<div class="gestion-tip-row"><span>Comensales</span><strong>${meta.diners}</strong></div>`,
      );
      rows.push(
        `<div class="gestion-tip-row"><span>Total</span><strong>${totalText || eur(0)}</strong></div>`,
      );
      rows.push(
        `<div class="gestion-tip-row"><span>Inicio</span><strong>${startedAt}</strong></div>`,
      );
      if (stageLabel)
        rows.push(
          `<div class="gestion-tip-row"><span>Servicio</span><strong>${stageLabel}</strong></div>`,
        );
      quickAction = `<button type="button" class="gestion-tip-primary is-cash" data-table-act="charge" data-table-uid="${uid}">Cobrar mesa</button>`;
    }

    if (quickAction) rows.push(quickAction);

    const transitionEntries = getAvailableStateTransitions(statusCode, uid);
    const stateActions = transitionEntries
      .filter((entry) => entry.code !== "cuenta")
      .map(
        (entry) =>
          `<button type="button" class="gestion-tip-btn" data-table-act="set-state" data-table-state="${entry.code}" data-table-uid="${uid}">${entry.label}</button>`,
      )
      .join("");

    const cashActions = transitionEntries
      .filter((entry) => entry.code === "cuenta")
      .map(
        (entry) =>
          `<button type="button" class="gestion-tip-btn is-cash" data-table-act="set-state" data-table-state="${entry.code}" data-table-uid="${uid}">${entry.label}</button>`,
      )
      .join("");

    let phaseActions = "";
    if (statusCode === "ocupada") {
      phaseActions = ["sin-pedir", "pedido", "entregado"]
        .filter(
          (phase) => phase !== getTableServiceStageKey(uid, ticket, statusCode),
        )
        .map((phase) => {
          const label =
            phase === "sin-pedir"
              ? "Sin pedir"
              : phase === "pedido"
                ? "Pedido"
                : "Entregado";
          return `<button type="button" class="gestion-tip-btn" data-table-act="set-phase" data-table-phase="${phase}" data-table-uid="${uid}">${label}</button>`;
        })
        .join("");
    } else if (statusCode === "cuenta") {
      const currentPhase = getTableServiceStageKey(uid, ticket, statusCode);
      phaseActions = ["cuenta-pedida", "cobro-realizado"]
        .filter((phase) => phase !== currentPhase)
        .map((phase) => {
          const label =
            phase === "cuenta-pedida" ? "Cuenta pedida" : "Cuenta cobrada";
          return `<button type="button" class="gestion-tip-btn" data-table-act="set-phase" data-table-phase="${phase}" data-table-uid="${uid}">${label}</button>`;
        })
        .join("");
    }

    if (phaseActions) {
      rows.push(`<div class="gestion-tip-group-title">Servicio</div>`);
      rows.push(`<div class="gestion-tip-actions">${phaseActions}</div>`);
    }

    if (cashActions) {
      rows.push(`<div class="gestion-tip-group-title">Cobro</div>`);
      rows.push(`<div class="gestion-tip-actions">${cashActions}</div>`);
    }

    if (stateActions) {
      rows.push(`<div class="gestion-tip-group-title">Estado mesa</div>`);
      rows.push(`<div class="gestion-tip-actions">${stateActions}</div>`);
    } else if (statusCode === "cuenta") {
      rows.push(`<div class="gestion-tip-group-title">Estado mesa</div>`);
      rows.push(
        `<div class="gestion-tip-row"><span></span><strong>Marca "Cuenta cobrada" para liberar</strong></div>`,
      );
    }

    if (editBlock) rows.push(editBlock);
    return rows.join("");
  };

  const showMapTooltipForNode = (node, tooltipHtml, uid) => {
    if (!node || !tooltipHtml) return;
    if (activeMapTooltipEl) activeMapTooltipEl.remove();

    const tipEl = document.createElement("div");
    tipEl.className = "gestion-tooltip";
    tipEl.innerHTML = tooltipHtml;
    const rect = node.getBoundingClientRect();
    const hostRect = mesaCards.getBoundingClientRect();
    tipEl.style.left = `${Math.max(8, rect.left - hostRect.left + rect.width / 2 - 100)}px`;
    tipEl.style.top = `${Math.max(8, rect.top - hostRect.top - 92)}px`;
    mesaCards.appendChild(tipEl);
    activeMapTooltipEl = tipEl;
    activeMapTooltipUid = String(uid || "").trim();
  };

  let reopenPayload = null;

  objects.forEach((obj) => {
    const node = document.createElement("div");
    const isTable = !!obj.tableUid;
    const baseWidth = Number(obj.w) || 0;
    const baseHeight = Number(obj.h) || 0;
    const isRoundTable = obj.cls === "table-round";
    const tableMinW = isRoundTable ? 118 : 110;
    const tableMinH = isRoundTable ? 118 : 92;
    const visualW = isTable
      ? Math.max(
          tableMinW,
          isRoundTable ? Math.max(baseWidth, baseHeight) : baseWidth,
        )
      : Math.max(10, baseWidth);
    const visualH = isTable
      ? Math.max(
          tableMinH,
          isRoundTable ? Math.max(baseWidth, baseHeight) : baseHeight,
        )
      : Math.max(10, baseHeight);
    node.className = `gestion-obj ${obj.cls} ${isTable ? "table" : "structure"}`;
    node.style.left = `${obj.x}px`;
    node.style.top = `${obj.y}px`;
    node.style.width = `${visualW}px`;
    node.style.height = `${visualH}px`;
    if (isTable) node.dataset.tableUid = String(obj.tableUid || "");

    if (isTable) {
      const uid = obj.tableUid;
      const info = findTableByUid(uid);
      const st = getTableStatus(uid);
      const ticket = getMappedTicketForTable(uid);
      const meta = getTableMeta(uid, { objClass: obj.cls });
      const hourText = formatTicketHour(ticket?.createdAt || ticket?.updatedAt);
      const stageKey = getTableServiceStageKey(uid, ticket, st.code);
      node.classList.add(`state-${st.code}`);
      if (stageKey) node.classList.add(`phase-${stageKey}`);

      const reservationNameText = String(meta.reservationName || "").trim();
      const totalText =
        st.code === "cuenta"
          ? stageKey === "cobro-realizado"
            ? "Recoger"
            : eur(Math.max(0, Number(st.total || 0) || 0))
          : st.code === "reservada"
            ? reservationNameText || "Reservada"
            : st.total > 0
              ? eur(st.total)
              : "";
      const reservationBadgeText = String(meta.reservationTime || "").trim();
      const badgeText =
        st.code === "reservada"
          ? reservationBadgeText || "Reservada"
          : hourText;
      const badgeClass =
        st.code === "reservada" ? "gestion-badge reserva" : "gestion-badge";
      const serviceOrder = Number(orderByUid.get(uid) || 0) || 0;

      node.innerHTML = `
        <span class="gestion-name">${obj.label || "Mesa"}</span>
        ${totalText ? `<span class="gestion-total">${totalText}</span>` : ""}
        ${badgeText ? `<span class="${badgeClass}">${badgeText}</span>` : ""}
        ${serviceOrder > 0 ? `<span class="gestion-order">${serviceOrder}</span>` : ""}
      `;

      const tooltipHtml = buildTooltipHtml(
        info ? formatTableDisplay(info.room, info.table) : obj.label || "Mesa",
        st,
        meta,
        ticket,
        st.total > 0 ? eur(st.total) : "",
        uid,
      );

      let longPressTimer = null;
      let suppressClick = false;
      const hideTip = () => closeMapTooltip();

      const showTip = () => {
        showMapTooltipForNode(node, tooltipHtml, uid);
      };

      if (reopenTooltipUid && reopenTooltipUid === uid) {
        reopenPayload = { node, tooltipHtml, uid };
      }

      node.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        suppressClick = false;
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
          suppressClick = true;
          showTip();
        }, 420);
      });

      const clearLongPress = () => {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      };

      node.addEventListener("pointerup", clearLongPress);
      node.addEventListener("pointercancel", clearLongPress);
      node.addEventListener("pointerleave", clearLongPress);

      node.addEventListener("click", () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        hideTip();
        handlePrimaryTableClick(uid, st.code, stageKey);
      });
    } else {
      const cls = String(obj.cls || "").trim();
      const isWall = cls === "structure-muro";
      const isVertical = visualH > visualW * 1.25;
      if (!isWall) {
        node.innerHTML = `<span class="gestion-name ${isVertical ? "is-vertical" : "is-horizontal"}">${obj.label || ""}</span>`;
      } else {
        node.innerHTML = "";
      }
      node.title = obj.label || "";
    }

    mesaCards.appendChild(node);
  });

  if (reopenTooltipUid && state.activeView === "mapa") {
    if (reopenPayload) {
      showMapTooltipForNode(
        reopenPayload.node,
        reopenPayload.tooltipHtml,
        reopenPayload.uid,
      );
    } else {
      activeMapTooltipUid = "";
    }
  }
}

function renderSelectedTableInfo() {
  const current = findTableByUid(state.selectedTableId);
  const st = state.selectedTableId
    ? getTableStatus(state.selectedTableId)
    : { code: "", label: "Sin seleccionar", total: 0 };
  const tableLabel = current
    ? formatTableDisplay(current.room, current.table)
    : "-";
  const uid = state.selectedTableId;
  const meta = uid ? getTableMeta(uid) : { diners: 0, capacity: 0 };
  const ticket = uid ? getMappedTicketForTable(uid) : null;
  const units = cart.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
  const parts = [];

  if (current?.room?.name) parts.push(current.room.name);
  if (uid) parts.push(`${meta.diners}/${meta.capacity} comensales`);
  if (ticket?.createdAt)
    parts.push(`Inicio ${formatHourShort(ticket.createdAt)}`);
  if (st.code === "reservada" && meta.reservationTime) {
    parts.push(`Reserva ${meta.reservationTime}`);
  }

  const metaMain = cart.length
    ? `${cart.length} lineas · ${units} uds`
    : "Sin pedido";

  selectedTableTitle.textContent = tableLabel;
  selectedTableState.dataset.status = st.code || "none";
  selectedTableState.textContent =
    st.total > 0 ? `${st.label} · ${eur(st.total)}` : st.label;
  ticketMesaTitle.textContent = `Mesa ${tableLabel}`;
  ticketMeta.textContent = parts.length
    ? `${metaMain} · ${parts.join(" · ")}`
    : metaMain;
}

function renderOtherTables() {
  otherTablesList.innerHTML = "";
  if (!state.roomList.length) {
    const empty = document.createElement("div");
    empty.className = "mesa-menu-empty";
    empty.textContent = "No hay mesas disponibles.";
    otherTablesList.appendChild(empty);
    return;
  }

  const currentUid = state.selectedTableId;
  state.roomList.forEach((room) => {
    const group = document.createElement("div");
    group.className = "mesa-room-group";

    const head = document.createElement("div");
    head.className = "mesa-room-head";
    head.textContent = `${room.name} · ${room.tables.length} mesas`;
    group.appendChild(head);

    const body = document.createElement("div");
    body.className = "mesa-room-body";

    room.tables.forEach((table) => {
      const uid = tableUid(room.id, table.id);
      const st = getTableStatus(uid);
      const meta = getTableMeta(uid);
      const ticket = getMappedTicketForTable(uid);
      const ticketHour = formatHourShort(
        ticket?.createdAt || ticket?.updatedAt,
      );
      const detailRight =
        st.code === "reservada"
          ? [
              String(meta.reservationTime || "").trim(),
              String(meta.reservationName || "").trim(),
            ]
              .filter(Boolean)
              .join(" · ") || "Reservada"
          : ticketHour || "";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "other-table-btn";
      if (uid === currentUid) button.classList.add("is-active");
      button.innerHTML = `
        <div class="mesa-btn-line1">
          <span>${formatTableDisplay(room, table)}</span>
          <span class="mesa-state-chip ${st.code}">${st.label}</span>
        </div>
        <div class="mesa-btn-line2">
          <span>${meta.diners}/${meta.capacity} comensales</span>
          <span>${st.total > 0 ? eur(st.total) : detailRight}</span>
        </div>
      `;
      button.addEventListener("click", () => switchTable(uid));
      body.appendChild(button);
    });

    group.appendChild(body);
    otherTablesList.appendChild(group);
  });
}

function renderCategoryBar() {
  categoryBar.innerHTML = "";
  const list = [{ id: "all", name: "Todos" }, ...categories];

  list.forEach((cat) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cat-btn";
    if (state.category === cat.id) button.classList.add("active");
    button.textContent = cat.name;
    button.addEventListener("click", () => {
      state.category = cat.id;
      saveState();
      renderCategoryBar();
      renderProducts();
    });
    categoryBar.appendChild(button);
  });
}

function productVisible(product) {
  if (
    state.category !== "all" &&
    String(product.category) !== String(state.category)
  ) {
    return false;
  }

  const q = String(state.search || "")
    .trim()
    .toLowerCase();
  if (!q) return true;

  const haystack = [product.name, product.secondaryName, product.referencia]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return haystack.includes(q);
}

function renderProducts() {
  productsGrid.innerHTML = "";
  const visible = products.filter(productVisible);

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-products";
    empty.textContent = "No hay productos para este filtro.";
    productsGrid.appendChild(empty);
    return;
  }

  visible.forEach((product) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "product-card";
    button.innerHTML = `
      <div class="product-overlay-top">
        <div class="product-name">${product.name}</div>
        ${product.secondaryName ? `<div class="product-secondary">${product.secondaryName}</div>` : ""}
      </div>
      <div class="product-footer">
        <span class="product-price">${eur(product.price)}</span>
      </div>
    `;
    button.addEventListener("click", () => addProductToCart(product));
    productsGrid.appendChild(button);
  });

  const placeholders = Math.max(0, PRODUCT_VISUAL_MIN_SLOTS - visible.length);
  for (let i = 0; i < placeholders; i += 1) {
    const ghost = document.createElement("button");
    ghost.type = "button";
    ghost.className = "product-card product-card-placeholder";
    ghost.disabled = true;
    ghost.tabIndex = -1;
    ghost.setAttribute("aria-hidden", "true");
    ghost.innerHTML = `
      <div class="product-overlay-top">
        <div class="product-name">Producto</div>
      </div>
      <div class="product-footer">
        <span class="product-price">0,00 EUR</span>
      </div>
    `;
    productsGrid.appendChild(ghost);
  }
}

function renderCart() {
  ticketLines.innerHTML = "";

  const units = cart.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
  if (ticketSummaryLines) ticketSummaryLines.textContent = String(cart.length);
  if (ticketSummaryUnits) ticketSummaryUnits.textContent = String(units);
  if (ticketSummaryUpdated) {
    ticketSummaryUpdated.textContent = cart.length
      ? formatHourShort(new Date())
      : "--:--";
  }

  if (!cart.length) {
    const empty = document.createElement("div");
    empty.className = "ticket-empty";
    empty.textContent = "Esta mesa aun no tiene lineas en el ticket.";
    ticketLines.appendChild(empty);
  }

  cart.forEach((line, idx) => {
    const row = document.createElement("div");
    row.className = "ticket-line";
    row.innerHTML = `
      <div class="ticket-line-top">
        <div class="ticket-line-name">${line.name}</div>
        <strong>${eur(lineTotal(line))}</strong>
      </div>
      <div class="ticket-line-sub">${line.qty} x ${eur(line.price)}</div>
      <div class="ticket-line-sub">
        <button data-act="minus" data-idx="${idx}">-</button>
        <button data-act="plus" data-idx="${idx}">+</button>
        <button data-act="del" data-idx="${idx}">Eliminar</button>
      </div>
    `;
    ticketLines.appendChild(row);
  });

  ticketTotal.textContent = eur(cartTotal());
  renderSelectedTableInfo();
}

function addProductToCart(product) {
  if (!state.selectedTableId) {
    void showNotice("Selecciona una mesa primero.");
    return;
  }

  const existing = cart.find((line) => String(line.id) === String(product.id));
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      qty: 1,
      price: Number(product.price) || 0,
      referencia: product.referencia || "",
      secondaryName: product.secondaryName || "",
    });
  }

  renderCart();
}

function updateCartLine(action, idx) {
  const line = cart[idx];
  if (!line) return;

  if (action === "plus") line.qty += 1;
  if (action === "minus") line.qty -= 1;
  if (action === "del" || line.qty <= 0) cart.splice(idx, 1);

  renderCart();
}

function nextTicketId() {
  const maxId = parkedTickets.reduce(
    (max, ticket) => Math.max(max, Number(ticket.id) || 0),
    0,
  );
  state.parkedCounter = Math.max(state.parkedCounter + 1, maxId + 1);
  saveState();
  return state.parkedCounter;
}

function upsertSelectedTableTicket() {
  const tableInfo = findTableByUid(state.selectedTableId);
  if (!tableInfo) return null;

  if (!cart.length) {
    delete state.tableTicketMap[tableInfo.uid];
    const manual = String(state.tableStates?.[tableInfo.uid] || "")
      .trim()
      .toLowerCase();
    const stage = String(state.tableMeta?.[tableInfo.uid]?.serviceStage || "")
      .trim()
      .toLowerCase();
    if (
      (manual === "ocupada" || manual === "cuenta") &&
      stage !== "entregado"
    ) {
      setTableManualState(tableInfo.uid, "libre");
    }
    saveState();
    return null;
  }

  const mapped = getMappedTicketForTable(tableInfo.uid);

  if (mapped) {
    mapped.items = cart.map((line) => ({ ...line }));
    mapped.total = cartTotal();
    mapped.updatedAt = new Date().toISOString();
    const tableDisplay = formatTableDisplay(tableInfo.room, tableInfo.table);
    if (!String(mapped.name || "").trim()) {
      mapped.name = tableDisplay;
    }
    if (!String(mapped.obs || "").trim()) {
      mapped.obs = `Mesa ${tableDisplay} · ${tableInfo.room.name}`;
    }
    setTableManualState(tableInfo.uid, "ocupada");
    setTableServiceStage(
      tableInfo.uid,
      Array.isArray(mapped.items) && mapped.items.length
        ? "pedido"
        : "sin-pedir",
    );
    saveParkedTickets();
    saveState();
    return mapped;
  }

  const ticket = {
    id: nextTicketId(),
    createdAt: new Date().toISOString(),
    updatedAt: null,
    items: cart.map((line) => ({ ...line })),
    total: cartTotal(),
    clientName: "Ventas tickets",
    name: formatTableDisplay(tableInfo.room, tableInfo.table),
    obs: `Mesa ${formatTableDisplay(tableInfo.room, tableInfo.table)} · ${tableInfo.room.name}`,
    paid: false,
    paidAt: null,
    paidTicketCode: null,
    paidTicketId: null,
    fs: null,
  };

  parkedTickets.push(ticket);
  state.tableTicketMap[tableInfo.uid] = ticket.id;
  setTableManualState(tableInfo.uid, "ocupada");
  setTableServiceStage(
    tableInfo.uid,
    Array.isArray(ticket.items) && ticket.items.length ? "pedido" : "sin-pedir",
  );
  saveParkedTickets();
  saveState();
  return ticket;
}

function loadCartFromSelectedTable() {
  const mapped = getMappedTicketForTable(state.selectedTableId);
  if (!mapped || !Array.isArray(mapped.items)) {
    cart = [];
    return;
  }

  cart = mapped.items.map((line) => ({
    id: line.id,
    name: String(line.name || "Producto"),
    qty: Math.max(1, Number(line.qty) || 1),
    price: Number(line.price) || 0,
    grossPrice: Number(line.grossPrice),
    taxRate: Number(line.taxRate),
    referencia: String(line.referencia || ""),
    secondaryName: String(line.secondaryName || ""),
  }));
}

function switchTable(uid, opts = {}) {
  const { openTrans = false, returnView = "", preferredAction = "open" } = opts;
  if (
    !MESAS_EMBED_MODE &&
    state.selectedTableId &&
    state.selectedTableId !== uid
  ) {
    upsertSelectedTableTicket();
  }

  const tableInfo = findTableByUid(uid);
  if (!tableInfo) return;

  state.selectedTableId = uid;
  state.activeRoomId = tableInfo.room.id;
  saveState();

  loadCartFromSelectedTable();
  renderEverything();
  if (openTrans) {
    const sourceView =
      normalizeMesasViewName(String(returnView || "").trim()) ||
      normalizeMesasViewName(state.activeView);

    if (MESAS_EMBED_MODE && window.parent && window.parent !== window) {
      try {
        window.parent.postMessage(
          {
            type: "tpv:mesas-open-table",
            uid,
            sourceView,
            preferredAction,
          },
          "*",
        );
        return;
      } catch {}
    }

    setQuickReturnView(sourceView);
    switchView("transacciones");
  }
}

function handlePrimaryTableClick(uid, statusCode = "") {
  const code = String(statusCode || "")
    .trim()
    .toLowerCase();

  // Click simple en mapa: abrir siempre el ticket de la mesa seleccionada.
  // Si la mesa esta libre se abrira para crear; si esta ocupada para editar.
  if (
    code === "libre" ||
    code === "ocupada" ||
    code === "reservada" ||
    code === "cuenta" ||
    code === "cobradas"
  ) {
    switchTable(uid, {
      openTrans: true,
      returnView: "mapa",
      preferredAction: "open",
    });
    return;
  }

  switchTable(uid, {
    openTrans: true,
    returnView: "mapa",
    preferredAction: "open",
  });
}

async function parkSelectedTable() {
  const tableInfo = findTableByUid(state.selectedTableId);
  if (!tableInfo) {
    await showNotice("Selecciona una mesa primero.");
    return;
  }

  if (!cart.length) {
    await showNotice("No hay productos para aparcar en esta mesa.");
    return;
  }

  upsertSelectedTableTicket();
  renderEverything();
  await showNotice(
    `Mesa ${formatTableDisplay(tableInfo.room, tableInfo.table)} aparcada.`,
  );
}

async function chargeSelectedTable() {
  const tableInfo = findTableByUid(state.selectedTableId);
  if (!tableInfo) {
    await showNotice("Selecciona una mesa primero.");
    return;
  }

  if (!cart.length) {
    await showNotice("No hay productos para cobrar.");
    return;
  }

  const ticket = upsertSelectedTableTicket();
  if (ticket) {
    ticket.paid = true;
    ticket.paidAt = new Date().toISOString();
    ticket.paidTicketCode = `MESA-${ticket.id}`;
    delete state.tableTicketMap[tableInfo.uid];
    setTableManualState(tableInfo.uid, "cuenta");
    setTableServiceStage(tableInfo.uid, "cobro-realizado");
    saveParkedTickets();
    saveState();
  }

  cart = [];
  renderEverything();
  switchView("mapa");
  await showNotice(
    `Mesa ${formatTableDisplay(tableInfo.room, tableInfo.table)} cobrada.`,
  );
}

function addRoom() {
  const trimmedName = sanitizeEntityName(nextRoomAutoName());

  if (isRoomNameTaken(trimmedName)) {
    // Fallback defensivo por si hubo nombres duplicados atipicos.
    let i = 1;
    let candidate = sanitizeEntityName(`S${i}`);
    while (isRoomNameTaken(candidate) && i < 9999) {
      i += 1;
      candidate = sanitizeEntityName(`S${i}`);
    }

    if (!candidate || isRoomNameTaken(candidate)) {
      void showNotice("No se pudo generar un nombre de sala disponible.");
      return;
    }

    const used = new Set(state.roomList.map((room) => room.id));
    const id = uniqueId(slugify(candidate) || "sala", used);
    const room = { id, name: candidate, tables: [] };
    state.roomList.push(room);
    state.roomDesigns[id] = state.roomDesigns[id] || [];
    state.activeRoomId = id;
    state.selectedTableId = null;
    ensureActiveRoomAndTable();
    saveState();
    renderEverything();
    return;
  }

  const used = new Set(state.roomList.map((room) => room.id));
  const id = uniqueId(slugify(trimmedName) || "sala", used);
  const room = { id, name: trimmedName, tables: [] };
  state.roomList.push(room);
  state.roomDesigns[id] = state.roomDesigns[id] || [];
  state.activeRoomId = id;
  state.selectedTableId = null;
  ensureActiveRoomAndTable();
  saveState();
  renderEverything();
}

async function renameActiveRoom() {
  const room = roomById(state.activeRoomId);
  if (!room) {
    await showNotice("No hay una sala seleccionada.");
    return;
  }

  const newName = await promptTextDialog({
    title: "Nuevo nombre de la sala",
    initialValue: room.name,
    placeholder: "Ej: Terraza",
  });
  if (!newName) return;

  const cleanName = sanitizeEntityName(newName, room.name);
  if (!cleanName) return;

  if (isRoomNameTaken(cleanName, { excludeRoomId: room.id })) {
    await showNotice("Ya existe otra sala con ese nombre.");
    return;
  }

  room.name = cleanName;
  saveState();
  renderEverything();
}

async function deleteActiveRoom() {
  const room = roomById(state.activeRoomId);
  if (!room) {
    await showNotice("No hay una sala seleccionada.");
    return;
  }

  if (
    !(await askConfirm(
      `Borrar sala \"${room.name}\" y sus mesas?`,
      "Eliminar sala",
    ))
  )
    return;

  room.tables.forEach((table) => {
    const uid = tableUid(room.id, table.id);
    delete state.tableTicketMap[uid];
    delete state.tableStates[uid];
    delete state.tableMeta[uid];
  });

  delete state.roomDesigns[room.id];
  state.roomList = state.roomList.filter((entry) => entry.id !== room.id);
  ensureActiveRoomAndTable();
  loadCartFromSelectedTable();
  saveState();
  renderEverything();
}

function addTableToActiveRoom() {
  const room = roomById(state.activeRoomId);
  if (!room) {
    void showNotice("Crea o selecciona una sala primero.");
    return;
  }

  let trimmedName = nextTableNameForRoom(room);

  if (isTableNameTaken(room, trimmedName)) {
    let i = 1;
    let candidate = sanitizeEntityName(`M${i}`);
    while (isTableNameTaken(room, candidate) && i < 9999) {
      i += 1;
      candidate = sanitizeEntityName(`M${i}`);
    }

    if (!candidate || isTableNameTaken(room, candidate)) {
      void showNotice("No se pudo generar un nombre de mesa disponible.");
      return;
    }

    trimmedName = candidate;
  }

  const table = createTableInRoom(room, trimmedName);
  if (!table) {
    void showNotice("No se pudo crear la mesa.");
    return;
  }

  syncRoomDesignWithTables(room.id);
  state.selectedTableId = tableUid(room.id, table.id);
  saveState();
  loadCartFromSelectedTable();
  renderEverything();
}

async function editTable(uid) {
  const info = findTableByUid(uid);
  if (!info) return;

  const newName = await promptTextDialog({
    title: "Nuevo nombre de mesa",
    initialValue: info.table.name,
    placeholder: "Ej: Mesa 12",
  });
  if (!newName) return;

  const cleanName = sanitizeEntityName(newName, info.table.name);
  if (!cleanName) return;

  if (
    isTableNameTaken(info.room, cleanName, { excludeTableId: info.table.id })
  ) {
    await showNotice("Ya existe otra mesa con ese nombre en esta sala.");
    return;
  }

  info.table.name = cleanName;
  syncRoomDesignWithTables(info.room.id);
  saveState();
  renderEverything();
}

async function deleteTable(uid) {
  const info = findTableByUid(uid);
  if (!info) return;

  if (
    !(await askConfirm(
      `Borrar mesa \"${formatTableDisplay(info.room, info.table)}\"?`,
      "Eliminar mesa",
    ))
  )
    return;

  info.room.tables = info.room.tables.filter(
    (table) => table.id !== info.table.id,
  );
  state.roomDesigns[info.room.id] = getRoomDesignObjects(info.room.id).filter(
    (obj) => String(obj.tableId || "") !== info.table.id,
  );
  delete state.tableTicketMap[uid];
  delete state.tableStates[uid];
  delete state.tableMeta[uid];

  if (state.selectedTableId === uid) {
    state.selectedTableId = null;
  }

  ensureActiveRoomAndTable();
  loadCartFromSelectedTable();
  saveState();
  renderEverything();
}

function fetchApiResource(resource) {
  const cfg = window.RECIPOK_API || {};
  const baseUrl = String(cfg.baseUrl || "").replace(/\/+$/, "");
  const apiKey = String(cfg.apiKey || "").trim();
  if (!baseUrl || !apiKey) {
    return Promise.reject(new Error("Config API no definida"));
  }

  const url = `${baseUrl}/${resource}?limit=0`;
  return fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Token: apiKey,
    },
    cache: "no-store",
  }).then(async (res) => {
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} en ${resource}`);
    }
    if (!Array.isArray(data)) {
      throw new Error(`Formato inesperado en ${resource}`);
    }
    return data;
  });
}

function loadCatalogSessionCache(baseUrl) {
  try {
    const raw = sessionStorage.getItem(MESAS_CATALOG_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    if (String(parsed.baseUrl || "") !== String(baseUrl || "")) return null;

    const cachedCategories = Array.isArray(parsed.categories)
      ? parsed.categories
      : [];
    const cachedProducts = Array.isArray(parsed.products)
      ? parsed.products
      : [];
    if (!cachedCategories.length || !cachedProducts.length) return null;

    return {
      categories: cachedCategories,
      products: cachedProducts,
    };
  } catch {
    return null;
  }
}

function saveCatalogSessionCache(baseUrl, nextCategories, nextProducts) {
  try {
    const payload = {
      baseUrl: String(baseUrl || ""),
      categories: Array.isArray(nextCategories) ? nextCategories : [],
      products: Array.isArray(nextProducts) ? nextProducts : [],
      savedAt: Date.now(),
    };
    sessionStorage.setItem(MESAS_CATALOG_SESSION_KEY, JSON.stringify(payload));
  } catch {}
}

function loadSharedCatalogCache(baseUrl) {
  if (MESAS_BRIDGE?.getSharedCatalog) {
    const fromBridge = MESAS_BRIDGE.getSharedCatalog(baseUrl);
    if (fromBridge) {
      return {
        categories: fromBridge.categories,
        products: fromBridge.products,
      };
    }
  }

  try {
    const raw = localStorage.getItem(SHARED_CATALOG_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (String(parsed.baseUrl || "") !== String(baseUrl || "")) return null;

    const cachedCategories = Array.isArray(parsed.categories)
      ? parsed.categories
      : [];
    const cachedProducts = Array.isArray(parsed.products)
      ? parsed.products
      : [];
    if (!cachedCategories.length || !cachedProducts.length) return null;

    return {
      categories: cachedCategories,
      products: cachedProducts,
    };
  } catch {
    return null;
  }
}

function saveSharedCatalogCache(baseUrl, nextCategories, nextProducts) {
  if (MESAS_BRIDGE?.setSharedCatalog) {
    const ok = MESAS_BRIDGE.setSharedCatalog(
      baseUrl,
      nextCategories,
      nextProducts,
      "mesas",
    );
    if (ok) return;
  }

  try {
    const payload = {
      version: 1,
      ts: Date.now(),
      baseUrl: String(baseUrl || ""),
      categories: Array.isArray(nextCategories) ? nextCategories : [],
      products: Array.isArray(nextProducts) ? nextProducts : [],
      source: "mesas",
    };

    if (
      !payload.baseUrl ||
      !payload.categories.length ||
      !payload.products.length
    ) {
      return;
    }

    localStorage.setItem(SHARED_CATALOG_CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

async function loadCatalog() {
  const ownCfg = window.RECIPOK_API || {};
  const hostCfg = getHostApi()?.RECIPOK_API || {};
  const cfg = {
    baseUrl: String(
      ownCfg.baseUrl ||
        hostCfg.baseUrl ||
        localStorage.getItem("tpv_baseUrl") ||
        "",
    )
      .trim()
      .replace(/\/+$/, ""),
    apiKey: String(
      ownCfg.apiKey ||
        hostCfg.apiKey ||
        localStorage.getItem("tpv_sync_api_key") ||
        "",
    ).trim(),
  };
  const hasApi =
    String(cfg.baseUrl || "").trim() && String(cfg.apiKey || "").trim();

  if (!hasApi) {
    const fallbackBaseUrl = String(cfg.baseUrl || "")
      .trim()
      .replace(/\/+$/, "");
    const sharedCatalog = loadSharedCatalogCache(fallbackBaseUrl);
    if (sharedCatalog) {
      categories = sharedCatalog.categories.map((cat) => ({ ...cat }));
      products = sharedCatalog.products.map((product) => ({ ...product }));
      saveCatalogSessionCache(fallbackBaseUrl, categories, products);
      return;
    }

    categories = [];
    products = [];
    return;
  }

  const baseUrl = String(cfg.baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  const cachedCatalog = loadCatalogSessionCache(baseUrl);
  if (cachedCatalog) {
    categories = cachedCatalog.categories.map((cat) => ({ ...cat }));
    products = cachedCatalog.products.map((product) => ({ ...product }));
    return;
  }

  const sharedCatalog = loadSharedCatalogCache(baseUrl);
  if (sharedCatalog) {
    categories = sharedCatalog.categories.map((cat) => ({ ...cat }));
    products = sharedCatalog.products.map((product) => ({ ...product }));
    saveCatalogSessionCache(baseUrl, categories, products);
    return;
  }

  try {
    const [familiasRaw, productosRaw] = await Promise.all([
      fetchApiResource("familias"),
      fetchApiResource("productos"),
    ]);

    categories = familiasRaw
      .filter((family) => {
        const flag =
          family.tpv_show ??
          family.tpv ??
          family.mostrarentpv ??
          family.mostrar_en_tpv;
        return flag !== false && flag !== 0 && flag !== "0";
      })
      .map((family, idx) => ({
        id: String(family.codfamilia ?? family.id ?? idx),
        name: safeText(
          family.descripcion ?? family.nombre ?? family.codfamilia,
          `Grupo ${idx + 1}`,
        ),
      }));

    const allowedCategories = new Set(categories.map((cat) => String(cat.id)));
    products = productosRaw
      .filter((product) => {
        if (product.bloqueado) return false;
        if (
          product.sevende === false ||
          product.sevende === 0 ||
          product.sevende === "0"
        )
          return false;
        const name = safeText(product.descripcion ?? product.referencia);
        if (!name || name === "-") return false;
        const cat = String(product.codfamilia ?? "");
        return !allowedCategories.size || allowedCategories.has(cat);
      })
      .map((product, idx) => {
        const name = safeText(
          product.descripcion ?? product.referencia,
          `Producto ${idx + 1}`,
        );
        return {
          id: String(product.idproducto ?? product.id ?? idx),
          name,
          secondaryName: "",
          referencia: safeText(product.referencia, name),
          price: Number(product.precio ?? 0) || 0,
          category: String(product.codfamilia ?? ""),
        };
      });

    if (!products.length) return;

    saveCatalogSessionCache(baseUrl, categories, products);
    saveSharedCatalogCache(baseUrl, categories, products);
  } catch (error) {
    console.warn(
      "No se pudo cargar catalogo real para mesas:",
      error?.message || error,
    );
    categories = [];
    products = [];
  }
}

function getCurrentDesignRoomId() {
  return designRoomSelect.value || state.activeRoomId;
}

function getRoomDesignObjects(roomId) {
  if (!roomId) return [];
  if (!Array.isArray(state.roomDesigns[roomId])) {
    state.roomDesigns[roomId] = [];
  }
  return state.roomDesigns[roomId];
}

function toolToObject(tool) {
  const map = {
    "mesa-redonda": { cls: "table-round", label: "Mesa", w: 118, h: 118 },
    "mesa-cuadrada": { cls: "table-square", label: "Mesa", w: 110, h: 92 },
    "mesa-rectangular": { cls: "table-rect", label: "Mesa", w: 146, h: 92 },
    barra: { cls: "structure-barra", label: "Barra", w: 190, h: 52 },
    entrada: { cls: "structure-entrada", label: "Entrada", w: 140, h: 52 },
    muro: { cls: "structure-muro", label: "Muro", w: 160, h: 24 },
  };
  return map[tool] || null;
}

function getDefaultDesignObjectSizeByClass(cls) {
  const key = String(cls || "").trim();
  const found = Object.values({
    "mesa-redonda": { cls: "table-round", w: 118, h: 118 },
    "mesa-cuadrada": { cls: "table-square", w: 110, h: 92 },
    "mesa-rectangular": { cls: "table-rect", w: 146, h: 92 },
    barra: { cls: "structure-barra", w: 190, h: 52 },
    entrada: { cls: "structure-entrada", w: 140, h: 52 },
    muro: { cls: "structure-muro", w: 160, h: 24 },
  }).find((entry) => entry.cls === key);
  return found ? { w: found.w, h: found.h } : { w: 100, h: 40 };
}

function cloneDesignObjectsForRoom(roomId) {
  return getRoomDesignObjects(roomId).map((obj) => ({ ...obj }));
}

function ensureDesignHistoryBuckets(roomId) {
  const key = String(roomId || "").trim();
  if (!key) return null;
  if (!Array.isArray(designUndoByRoom[key])) designUndoByRoom[key] = [];
  if (!Array.isArray(designRedoByRoom[key])) designRedoByRoom[key] = [];
  return key;
}

function pushDesignUndoSnapshot(roomId, snapshot) {
  const key = ensureDesignHistoryBuckets(roomId);
  if (!key || !Array.isArray(snapshot)) return;
  const undo = designUndoByRoom[key];
  const next = snapshot.map((obj) => ({ ...obj }));
  const nextRaw = JSON.stringify(next);
  const prevRaw = undo.length ? JSON.stringify(undo[undo.length - 1]) : "";
  if (nextRaw === prevRaw) return;
  undo.push(next);
  if (undo.length > 60) undo.shift();
  designRedoByRoom[key] = [];
}

function updateDesignHistoryButtons(roomId = getCurrentDesignRoomId()) {
  const key = ensureDesignHistoryBuckets(roomId);
  const canUndo = !!(key && designUndoByRoom[key]?.length);
  const canRedo = !!(key && designRedoByRoom[key]?.length);
  if (designUndoBtn) designUndoBtn.disabled = !canUndo;
  if (designRedoBtn) designRedoBtn.disabled = !canRedo;
}

function undoDesignChange() {
  const roomId = getCurrentDesignRoomId();
  const key = ensureDesignHistoryBuckets(roomId);
  if (!key) return;
  const undo = designUndoByRoom[key];
  if (!undo.length) return;

  const current = cloneDesignObjectsForRoom(roomId);
  designRedoByRoom[key].push(current);
  const prev = undo.pop();
  state.roomDesigns[roomId] = prev.map((obj) => ({ ...obj }));

  if (
    selectedDesignObjectId &&
    !state.roomDesigns[roomId].some((obj) => obj.id === selectedDesignObjectId)
  ) {
    selectedDesignObjectId = null;
  }

  saveState();
  renderDesignCanvas();
}

function redoDesignChange() {
  const roomId = getCurrentDesignRoomId();
  const key = ensureDesignHistoryBuckets(roomId);
  if (!key) return;
  const redo = designRedoByRoom[key];
  if (!redo.length) return;

  const current = cloneDesignObjectsForRoom(roomId);
  designUndoByRoom[key].push(current);
  const next = redo.pop();
  state.roomDesigns[roomId] = next.map((obj) => ({ ...obj }));

  if (
    selectedDesignObjectId &&
    !state.roomDesigns[roomId].some((obj) => obj.id === selectedDesignObjectId)
  ) {
    selectedDesignObjectId = null;
  }

  saveState();
  renderDesignCanvas();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function snapToGrid(value) {
  const size = Math.max(4, Number(DESIGN_GRID_SIZE) || 20);
  return Math.round((Number(value) || 0) / size) * size;
}

function maybeSnap(value) {
  return designSnapToGrid ? snapToGrid(value) : Number(value) || 0;
}

function getDesignWorkspaceSize() {
  const rect = designCanvas.getBoundingClientRect();
  const width = Math.max(
    Number(DESIGN_WORKSPACE_MIN_WIDTH) || 0,
    Math.round(Number(rect?.width || 0) || 0),
  );
  const height = Math.max(
    Number(DESIGN_WORKSPACE_MIN_HEIGHT) || 0,
    Math.round(Number(rect?.height || 0) || 0),
  );
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function getDesignObjectMinSize(cls) {
  const key = String(cls || "").trim();
  if (key === "structure-muro") return { w: 2, h: 2 };
  if (key.startsWith("structure-")) return { w: 4, h: 4 };
  if (key === "table-round") return { w: 118, h: 118 };
  if (key === "table-square") return { w: 110, h: 92 };
  if (key === "table-rect") return { w: 110, h: 92 };
  return { w: 4, h: 4 };
}

function renderDesignCanvas() {
  designCanvas.querySelectorAll(".design-obj").forEach((node) => node.remove());
  const workspace = getDesignWorkspaceSize();
  designCanvas.style.setProperty(
    "--design-workspace-w",
    `${workspace.width}px`,
  );
  designCanvas.style.setProperty(
    "--design-workspace-h",
    `${workspace.height}px`,
  );

  const roomId = getCurrentDesignRoomId();
  syncRoomDesignWithTables(roomId, { ensureMissing: false });
  const objects = getRoomDesignObjects(roomId);
  const canPaint = Boolean(roomId);

  designHintText.classList.toggle("hidden", canPaint && objects.length > 0);
  if (!canPaint) {
    designHintText.textContent = "Crea una sala para empezar a diseñar.";
    designHintText.classList.remove("hidden");
    renderDesignSelectionPanel();
    updateDesignHistoryButtons(roomId);
    return;
  }

  if (!objects.length) {
    designHintText.textContent =
      "Selecciona una herramienta y haz clic en el plano.";
  }

  objects.forEach((obj) => {
    const node = document.createElement("div");
    const cls = String(obj.cls || "").trim();
    node.className = `design-obj ${cls}`;
    node.dataset.objectId = obj.id;
    if (obj.tableUid) node.dataset.tableUid = obj.tableUid;
    const isRound = cls === "table-round";
    const minSize = getDesignObjectMinSize(cls);
    const baseW = Number(obj.w) || 0;
    const baseH = Number(obj.h) || 0;
    const width = isRound
      ? Math.max(baseW, baseH, Number(minSize.w) || 0)
      : Math.max(baseW, Number(minSize.w) || 0);
    const height = isRound ? width : Math.max(baseH, Number(minSize.h) || 0);
    node.style.left = `${obj.x}px`;
    node.style.top = `${obj.y}px`;
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
    const label = String(obj.label || "").trim();
    const isStructure = cls.startsWith("structure-");
    const isVertical = height > width * 1.25;

    if (label) {
      if (isStructure) {
        const labelEl = document.createElement("span");
        labelEl.className = `design-label ${isVertical ? "is-vertical" : "is-horizontal"}`;
        labelEl.textContent = label;
        node.appendChild(labelEl);
      } else {
        node.textContent = label;
      }
    }
    if (obj.id === selectedDesignObjectId) node.classList.add("selected");
    if (cls === "structure-muro") node.classList.add("is-thin");

    if (obj.tableUid) {
      const status = getTableStatus(obj.tableUid);
      const ticket = getMappedTicketForTable(obj.tableUid);
      const stageKey = getTableServiceStageKey(
        obj.tableUid,
        ticket,
        status.code,
      );
      node.classList.add(`table-state-${status.code}`);
      if (stageKey) node.classList.add(`table-phase-${stageKey}`);
      node.title = `${obj.label || "Mesa"} · ${status.label}`;
    }

    if (obj.id === selectedDesignObjectId) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "design-obj-delete";
      del.dataset.objectDelete = obj.id;
      del.textContent = "x";
      node.appendChild(del);

      if (isResizableStructureClass(obj.cls)) {
        const handles = [
          { dir: "e", title: "Redimensionar horizontal" },
          { dir: "s", title: "Redimensionar vertical" },
          { dir: "se", title: "Redimensionar diagonal" },
        ];
        handles.forEach((entry) => {
          const resize = document.createElement("button");
          resize.type = "button";
          resize.className = `design-obj-resize dir-${entry.dir}`;
          resize.dataset.objectResize = obj.id;
          resize.dataset.resizeDir = entry.dir;
          resize.title = entry.title;
          resize.setAttribute("aria-label", entry.title);
          node.appendChild(resize);
        });
      }
    }

    designCanvas.appendChild(node);
  });

  renderDesignSelectionPanel();
  updateDesignHistoryButtons(roomId);
}

function renderDesignSelectionPanel() {
  if (
    !designSelectionPanel ||
    !designSelectionTitle ||
    !designSelectionMeta ||
    !designSelectionActions
  ) {
    return;
  }

  const roomId = getCurrentDesignRoomId();
  const objects = getRoomDesignObjects(roomId);
  const selected =
    objects.find((obj) => obj.id === selectedDesignObjectId) || null;

  if (!selected) {
    designSelectionPanel.classList.add("hidden");
    designSelectionActions.innerHTML = "";
    return;
  }

  designSelectionPanel.classList.remove("hidden");
  designSelectionActions.innerHTML = "";

  if (selected.tableUid) {
    designSelectionActions.className = "design-selection-actions is-table";
    const info = findTableByUid(selected.tableUid);
    const st = getTableStatus(selected.tableUid);
    const ticket = getMappedTicketForTable(selected.tableUid);
    const meta = getTableMeta(selected.tableUid, { objClass: selected.cls });
    const stage = getTableServiceStage(selected.tableUid, ticket, st.code);
    const stageKey = getTableServiceStageKey(
      selected.tableUid,
      ticket,
      st.code,
    );
    const stateButtons = getAvailableStateTransitions(
      st.code,
      selected.tableUid,
    )
      .map(
        (entry) =>
          `<button type="button" data-design-action="set-state" data-table-uid="${selected.tableUid}" data-state="${entry.code}">${entry.label}</button>`,
      )
      .join("");
    const phaseButtons =
      st.code === "ocupada" || st.code === "cuenta"
        ? (st.code === "cuenta"
            ? ["cuenta-pedida", "cobro-realizado"]
            : ["sin-pedir", "pedido", "entregado"]
          )
            .filter((phase) => phase !== stageKey)
            .map((phase) => {
              const label =
                phase === "sin-pedir"
                  ? "Sin pedir"
                  : phase === "pedido"
                    ? "Pedido"
                    : phase === "entregado"
                      ? "Entregado"
                      : phase === "cuenta-pedida"
                        ? "Cuenta pedida"
                        : "Cuenta cobrada";
              return `<button type="button" data-design-action="set-phase" data-table-uid="${selected.tableUid}" data-phase="${phase}">${label}</button>`;
            })
            .join("")
        : "";

    designSelectionTitle.textContent = info
      ? formatTableDisplay(info.room, info.table)
      : selected.label || "Mesa";
    designSelectionMeta.textContent = `${st.label}${stage ? ` · ${stage}` : ""} · ${meta.diners}/${meta.capacity} pax`;

    const showReservationFields = st.code === "reservada";
    const currentCode = info ? getTableCode(info.room, info.table) : "";
    const currentCustomName = info
      ? sanitizeEntityName(info.table.name || "", "")
      : "";
    const nameValue =
      currentCustomName &&
      normalizeEntityName(currentCustomName) !==
        normalizeEntityName(currentCode)
        ? currentCustomName
        : "";

    designSelectionActions.innerHTML = `
      <label class="design-inline-field">
        <span>Nombre</span>
        <input type="text" data-design-field="name" value="${String(nameValue).replace(/"/g, "&quot;")}" placeholder="" />
      </label>
      <label class="design-inline-field">
        <span>Comensales</span>
        <input type="number" min="0" step="1" data-design-field="diners" value="${Math.max(0, Number(meta.diners || 0) || 0)}" />
      </label>
      <label class="design-inline-field">
        <span>Capacidad</span>
        <input type="number" min="1" step="1" data-design-field="capacity" value="${Math.max(1, Number(meta.capacity || 4) || 4)}" />
      </label>
      ${
        showReservationFields
          ? `<label class="design-inline-field">
               <span>Reserva</span>
               <input type="text" data-design-field="reservationName" value="${String(meta.reservationName || "").replace(/"/g, "&quot;")}" />
             </label>
             <label class="design-inline-field">
               <span>Hora</span>
               <select data-design-field="reservationTime">${buildReservationTimeOptions(meta.reservationTime)}</select>
             </label>`
          : ""
      }
      ${stateButtons}
      ${phaseButtons}
      <button type="button" class="danger design-action-full" data-design-action="delete" data-table-uid="${selected.tableUid}">Borrar</button>
    `;
  } else {
    designSelectionActions.className = "design-selection-actions is-object";
    designSelectionTitle.textContent = selected.label || "Elemento";
    designSelectionMeta.textContent = `Posicion ${Math.round(selected.x)},${Math.round(selected.y)} · ${Math.round(selected.w)}x${Math.round(selected.h)}`;

    const safeNum = (v, min, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(min, Math.round(n));
    };

    designSelectionActions.innerHTML = `
      <label class="design-inline-field">
        <span>X</span>
        <input type="number" step="1" data-design-field="x" value="${safeNum(selected.x, 0, 0)}" />
      </label>
      <label class="design-inline-field">
        <span>Y</span>
        <input type="number" step="1" data-design-field="y" value="${safeNum(selected.y, 0, 0)}" />
      </label>
      <label class="design-inline-field">
        <span>Ancho</span>
        <input type="number" min="1" step="1" data-design-field="w" value="${safeNum(selected.w, 1, 100)}" />
      </label>
      <label class="design-inline-field">
        <span>Alto</span>
        <input type="number" min="1" step="1" data-design-field="h" value="${safeNum(selected.h, 1, 40)}" />
      </label>
      <button type="button" data-design-action="reset-size-obj" data-object-id="${selected.id}">Tamano por defecto</button>
      <button type="button" data-design-action="revert-pos-obj" data-object-id="${selected.id}">Retroceder posicion</button>
      <button type="button" class="danger" data-design-action="delete-obj" data-object-id="${selected.id}">Borrar</button>
    `;
  }
}

async function addDesignObjectAt(clientX, clientY) {
  const roomId = getCurrentDesignRoomId();
  if (!roomId) {
    await showNotice("Selecciona una sala en el diseno.");
    return;
  }

  const base = toolToObject(activeDesignTool);
  if (!base) return;

  const room = roomById(roomId);
  if (!room) return;

  const rect = designCanvas.getBoundingClientRect();
  const workspace = getDesignWorkspaceSize();
  const rawX = clientX - rect.left + designCanvas.scrollLeft - base.w / 2;
  const rawY = clientY - rect.top + designCanvas.scrollTop - base.h / 2;
  const x = clamp(maybeSnap(rawX), 0, Math.max(0, workspace.width - base.w));
  const y = clamp(maybeSnap(rawY), 0, Math.max(0, workspace.height - base.h));

  const objects = getRoomDesignObjects(roomId);
  pushDesignUndoSnapshot(roomId, cloneDesignObjectsForRoom(roomId));
  if (isTableDesignClass(base.cls)) {
    const table = createTableInRoom(room);
    if (!table) {
      await showNotice("No se pudo crear una mesa nueva.");
      return;
    }

    const tableObj = createTableDesignObject(room, table, {
      id: `obj-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      cls: base.cls,
      w: base.w,
      h: base.h,
      x,
      y,
    });
    objects.push(tableObj);
    state.selectedTableId = tableObj.tableUid;
  } else {
    objects.push({
      id: `obj-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      cls: base.cls,
      label: base.label,
      x,
      y,
      w: base.w,
      h: base.h,
    });
  }

  saveState();
  renderDesignCanvas();
}

function selectDesignObject(objectId) {
  selectedDesignObjectId = objectId;
  renderDesignCanvas();
}

function removeDesignObject(objectId) {
  const roomId = getCurrentDesignRoomId();
  if (!roomId) return;
  const room = roomById(roomId);
  if (!room) return;

  const objects = getRoomDesignObjects(roomId);
  pushDesignUndoSnapshot(roomId, cloneDesignObjectsForRoom(roomId));
  const target = objects.find((obj) => obj.id === objectId) || null;

  if (target?.tableId) {
    room.tables = room.tables.filter((table) => table.id !== target.tableId);
    const uid = tableUid(room.id, target.tableId);
    delete state.tableTicketMap[uid];
    delete state.tableStates[uid];
    delete state.tableMeta[uid];
    if (state.selectedTableId === uid) state.selectedTableId = null;
  }

  state.roomDesigns[roomId] = objects.filter((obj) => obj.id !== objectId);
  if (selectedDesignObjectId === objectId) selectedDesignObjectId = null;
  ensureActiveRoomAndTable();
  loadCartFromSelectedTable();
  saveState();
  renderDesignCanvas();
}

function updateDesignTool(tool) {
  const next = String(tool || "").trim();
  if (activeDesignTool === next) {
    activeDesignTool = "";
  } else {
    activeDesignTool = next;
  }
  toolButtons.forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.tool === activeDesignTool,
    );
  });
}

function bindDesignerEvents() {
  toolButtons.forEach((button) => {
    button.addEventListener("click", () =>
      updateDesignTool(button.dataset.tool),
    );
  });

  const stopDesignPan = () => {
    if (!designPanState) return;
    if (designPanMoved) {
      designCanvasSuppressClickUntil = Date.now() + 200;
    }
    designPanState = null;
    designPanMoved = false;
    designCanvas.classList.remove("is-panning");
  };

  designCanvas.addEventListener("pointerdown", (event) => {
    if (state.activeView !== "diseno") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest(".design-selection-panel")) return;
    if (event.target.closest(".design-obj")) return;

    designPanState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: designCanvas.scrollLeft,
      startScrollTop: designCanvas.scrollTop,
    };
    designPanMoved = false;
    designCanvas.classList.add("is-panning");
    try {
      designCanvas.setPointerCapture(event.pointerId);
    } catch {}
  });

  designCanvas.addEventListener("pointermove", (event) => {
    if (!designPanState) return;
    if (event.pointerId !== designPanState.pointerId) return;

    const dx = event.clientX - designPanState.startX;
    const dy = event.clientY - designPanState.startY;
    designCanvas.scrollLeft = (designPanState.startScrollLeft || 0) - dx;
    designCanvas.scrollTop = (designPanState.startScrollTop || 0) - dy;
    if (Math.hypot(dx, dy) >= 5) designPanMoved = true;
    if (designPanMoved) event.preventDefault();
  });

  designCanvas.addEventListener("pointerup", stopDesignPan);
  designCanvas.addEventListener("pointercancel", stopDesignPan);
  designCanvas.addEventListener("lostpointercapture", stopDesignPan);

  designCanvas.addEventListener("click", (event) => {
    if (Date.now() < designCanvasSuppressClickUntil) return;
    const deleteBtn = event.target.closest("[data-object-delete]");
    if (deleteBtn) {
      removeDesignObject(deleteBtn.dataset.objectDelete);
      return;
    }

    if (event.target.closest("[data-object-resize]")) return;

    const objNode = event.target.closest(".design-obj");
    if (objNode) {
      const roomId = getCurrentDesignRoomId();
      const objects = getRoomDesignObjects(roomId);
      const obj = objects.find(
        (entry) => entry.id === objNode.dataset.objectId,
      );
      if (!obj) return;

      designDragMoved = false;
      selectDesignObject(objNode.dataset.objectId);
      return;
    }

    if (selectedDesignObjectId) {
      selectedDesignObjectId = null;
      renderDesignCanvas();
      return;
    }

    void addDesignObjectAt(event.clientX, event.clientY);
  });

  designCanvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("[data-object-delete]")) return;
    const resizingHandle = event.target.closest("[data-object-resize]");
    const node = event.target.closest(".design-obj");
    if (!node) return;

    const objectId = node.dataset.objectId;
    const roomId = getCurrentDesignRoomId();
    const objects = getRoomDesignObjects(roomId);
    const obj = objects.find((entry) => entry.id === objectId);
    if (!obj) return;

    const rect = designCanvas.getBoundingClientRect();
    const workspace = getDesignWorkspaceSize();
    const beforeSnapshot = cloneDesignObjectsForRoom(roomId);
    obj.prevX = Number(obj.x) || 0;
    obj.prevY = Number(obj.y) || 0;
    obj.prevW = Number(obj.w) || 10;
    obj.prevH = Number(obj.h) || 10;
    if (resizingHandle && isResizableStructureClass(obj.cls)) {
      dragState = {
        mode: "resize",
        beforeSnapshot,
        resizeDir: String(resizingHandle.dataset.resizeDir || "se")
          .trim()
          .toLowerCase(),
        objectId,
        roomId,
        startX: event.clientX,
        startY: event.clientY,
        startW: Number(obj.w) || 0,
        startH: Number(obj.h) || 0,
      };
      designDragMoved = true;
      event.preventDefault();
      selectDesignObject(objectId);
      return;
    }

    dragState = {
      mode: "move",
      beforeSnapshot,
      objectId,
      roomId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left + designCanvas.scrollLeft - obj.x,
      offsetY: event.clientY - rect.top + designCanvas.scrollTop - obj.y,
    };
    designDragMoved = false;
    event.preventDefault();
    selectDesignObject(objectId);
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragState) return;

    const objects = getRoomDesignObjects(dragState.roomId);
    const obj = objects.find((entry) => entry.id === dragState.objectId);
    if (!obj) return;

    const rect = designCanvas.getBoundingClientRect();
    const workspace = getDesignWorkspaceSize();
    if (dragState.mode === "resize") {
      const minSize = getDesignObjectMinSize(obj.cls);
      const minW = Math.max(1, Number(minSize.w) || 1);
      const minH = Math.max(1, Number(minSize.h) || 1);
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      const resizeDir = String(dragState.resizeDir || "se");
      if (resizeDir.includes("e")) {
        const nextW = (Number(dragState.startW) || obj.w || minW) + dx;
        obj.w = clamp(
          maybeSnap(nextW),
          minW,
          Math.max(minW, workspace.width - obj.x),
        );
      }
      if (resizeDir.includes("s")) {
        const nextH = (Number(dragState.startH) || obj.h || minH) + dy;
        obj.h = clamp(
          maybeSnap(nextH),
          minH,
          Math.max(minH, workspace.height - obj.y),
        );
      }
      event.preventDefault();
      renderDesignCanvas();
      return;
    }

    const rawX =
      event.clientX - rect.left + designCanvas.scrollLeft - dragState.offsetX;
    const rawY =
      event.clientY - rect.top + designCanvas.scrollTop - dragState.offsetY;
    const x = clamp(maybeSnap(rawX), 0, Math.max(0, workspace.width - obj.w));
    const y = clamp(maybeSnap(rawY), 0, Math.max(0, workspace.height - obj.h));
    obj.x = x;
    obj.y = y;
    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );
    if (distance >= 6) designDragMoved = true;
    if (!designDragMoved) return;
    event.preventDefault();
    renderDesignCanvas();
  });

  window.addEventListener("mouseup", () => {
    if (!dragState) return;
    if (designDragMoved && Array.isArray(dragState.beforeSnapshot)) {
      pushDesignUndoSnapshot(dragState.roomId, dragState.beforeSnapshot);
    }
    dragState = null;
    saveState();
    updateDesignHistoryButtons();
  });
}

function renderEverything() {
  loadParkedTickets();
  ensureActiveRoomAndTable();
  renderRoomSelectors();
  renderMapCards();
  renderSelectedTableInfo();
  renderOtherTables();
  renderCategoryBar();
  renderProducts();
  renderCart();
  renderDesignCanvas();
}

function tickClock() {
  const now = new Date();
  const hh = now.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dd = now.toLocaleDateString("es-ES");
  document.getElementById("mesasClock").textContent = hh;
  document.getElementById("mesasDate").textContent = dd;
}

function bindEvents() {
  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", handler);
  };

  const reloadStateFromStorage = () => {
    if (isTutorialPauseActive()) return;
    if (isVirtualKeyboardOpen()) return;
    if (activeMapTooltipEl && state.activeView === "mapa") return;
    if (state.activeView === "diseno" && dragState) return;

    const currentView = state.activeView;
    const currentSelected = state.selectedTableId;

    loadState();
    loadParkedTickets();

    if (currentView) state.activeView = currentView;
    if (currentSelected) state.selectedTableId = currentSelected;

    ensureActiveRoomAndTable();
    loadCartFromSelectedTable();
    renderEverything();
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  window.addEventListener("message", (event) => {
    const type = String(event?.data?.type || "")
      .trim()
      .toLowerCase();
    if (type !== "tpv:mesas-state-changed") return;
    reloadStateFromStorage();
  });

  window.addEventListener("storage", (event) => {
    const key = String(event?.key || "").trim();
    if (
      key !== TABLES_STATE_KEY &&
      key !== LEGACY_TABLES_STATE_KEY &&
      key !== PARKED_TICKETS_CACHE_KEY &&
      key !== getMesasLayoutScopedStorageKey()
    ) {
      return;
    }
    reloadStateFromStorage();
  });

  roomSelect.addEventListener("change", () => {
    upsertSelectedTableTicket();
    state.activeRoomId = roomSelect.value;
    ensureActiveRoomAndTable();
    loadCartFromSelectedTable();
    saveState();
    renderEverything();
  });

  designRoomSelect.addEventListener("change", () => {
    state.activeRoomId = designRoomSelect.value;
    ensureActiveRoomAndTable();
    saveState();
    renderEverything();
  });

  if (designSnapToggleBtn) {
    designSnapToggleBtn.addEventListener("click", () => {
      setDesignSnapMode(designSnapToGrid ? "free" : "grid");
      saveState();
    });
  }

  bindClick("createFirstRoomBtn", () => switchView("diseno"));
  bindClick("designAddRoomBtn", addRoom);
  bindClick("designRenameRoomBtn", renameActiveRoom);
  bindClick("designDeleteRoomBtn", deleteActiveRoom);

  mesaCards.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("[data-table-act]");
    if (!actionBtn) return;

    const action = actionBtn.dataset.tableAct;
    const uid = actionBtn.dataset.tableUid;
    if (!uid) return;
    const shouldKeepTooltip = !!activeMapTooltipEl;
    const reopenTooltip = () => {
      if (!shouldKeepTooltip) return;
      activeMapTooltipUid = uid;
      if (state.activeView === "mapa") renderMapCards();
    };

    if (action === "open" || action === "view") {
      closeMapTooltip();
      switchTable(uid, {
        openTrans: true,
        returnView: "mapa",
        preferredAction: "open",
      });
      return;
    }
    if (action === "charge") {
      closeMapTooltip();
      switchTable(uid, {
        openTrans: true,
        returnView: "mapa",
        preferredAction: "charge",
      });
      return;
    }

    if (action === "set-state") {
      const nextState = String(actionBtn.dataset.tableState || "")
        .trim()
        .toLowerCase();
      if (nextState === "reservada") {
        reserveTable(uid);
        reopenTooltip();
        return;
      }
      setTableManualState(uid, nextState);
      saveState();
      renderEverything();
      reopenTooltip();
      return;
    }
    if (action === "set-phase") {
      const nextPhase = String(actionBtn.dataset.tablePhase || "")
        .trim()
        .toLowerCase();
      setTableServiceStage(uid, nextPhase);
      saveState();
      renderEverything();
      reopenTooltip();
      return;
    }
  });

  mesaCards.addEventListener("change", (event) => {
    const input = event.target.closest(
      "input[data-table-input][data-table-uid], select[data-table-input][data-table-uid]",
    );
    if (!input) return;
    const uid = String(input.dataset.tableUid || "").trim();
    if (!uid) return;

    const meta = getTableMeta(uid);
    const statusCode = getTableStatus(uid).code;
    const dinersInput = activeMapTooltipEl?.querySelector?.(
      `[data-table-input='diners'][data-table-uid='${uid}']`,
    );
    const reservationNameInput = activeMapTooltipEl?.querySelector?.(
      `[data-table-input='reservation-name'][data-table-uid='${uid}']`,
    );
    const reservationTimeInput = activeMapTooltipEl?.querySelector?.(
      `[data-table-input='reservation-time'][data-table-uid='${uid}']`,
    );
    const min = statusCode === "reservada" ? 1 : 0;

    state.tableMeta[uid] = {
      ...meta,
      diners: Math.max(
        min,
        Number(dinersInput?.value || meta.diners || min) || min,
      ),
      reservationName:
        statusCode === "reservada"
          ? sanitizeEntityName(
              reservationNameInput?.value || meta.reservationName || "",
              "Reserva",
            ) || "Reserva"
          : String(meta.reservationName || ""),
      reservationTime:
        statusCode === "reservada"
          ? normalizeReservationTime(
              reservationTimeInput?.value || meta.reservationTime || "",
              meta.reservationTime || RESERVATION_MIN_TIME,
            )
          : String(meta.reservationTime || ""),
    };
    activeMapTooltipUid = uid;
    saveState();
    renderEverything();
  });

  mesaCards.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const input = event.target.closest(
      "input[data-table-input][data-table-uid], select[data-table-input][data-table-uid]",
    );
    if (!input) return;
    event.preventDefault();
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  document.addEventListener("pointerdown", (event) => {
    if (!activeMapTooltipEl) return;
    const input = event.target?.closest?.(
      ".gestion-tooltip input[data-table-input], .gestion-tooltip select[data-table-input]",
    );
    if (input) {
      if (input.tagName === "SELECT") return;
      if (shouldSkipKeyboardOnPointer(input, event)) return;
      if (input.type === "time") {
        mapTooltipCloseGuardUntil = Date.now() + 6000;
        try {
          input.min = RESERVATION_MIN_TIME;
          input.max = RESERVATION_MAX_TIME;
          if (typeof input.showPicker === "function") input.showPicker();
        } catch {}
        return;
      }
      const mode = input.type === "number" ? "number" : "text";
      openVirtualKeyboardForInput(input, mode);
      return;
    }
    if (event.target?.closest?.(".gestion-tooltip")) return;
    if (event.target?.closest?.(".gestion-obj.table")) return;
    if (event.target !== mesaCards) return;
    if (Date.now() < mapTooltipCloseGuardUntil) return;
    closeMapTooltip();
  });

  document.addEventListener("pointerdown", (event) => {
    if (state.activeView !== "diseno") return;
    if (!selectedDesignObjectId) return;
    if (event.target?.closest?.(".design-selection-panel")) return;
    if (event.target?.closest?.(".design-obj")) return;
    if (event.target?.closest?.(".tool-btn")) return;
    selectedDesignObjectId = null;
    renderDesignCanvas();
  });

  if (designSelectionActions) {
    designSelectionActions.addEventListener("pointerdown", (event) => {
      const input = event.target.closest(
        "input[data-design-field], select[data-design-field]",
      );
      if (!input) return;
      if (input.tagName === "SELECT") return;
      if (shouldSkipKeyboardOnPointer(input, event)) return;
      if (input.type === "time") {
        try {
          input.min = RESERVATION_MIN_TIME;
          input.max = RESERVATION_MAX_TIME;
          if (typeof input.showPicker === "function") input.showPicker();
        } catch {}
        return;
      }
      const mode = input.type === "number" ? "number" : "text";
      openVirtualKeyboardForInput(input, mode);
    });

    const applyObjectFormEdits = (objectId, { pushUndo = false } = {}) => {
      const roomId = getCurrentDesignRoomId();
      const objects = getRoomDesignObjects(roomId);
      const obj = objects.find((entry) => entry.id === objectId);
      if (!obj) return;
      if (pushUndo)
        pushDesignUndoSnapshot(roomId, cloneDesignObjectsForRoom(roomId));

      const xInput = designSelectionActions.querySelector(
        "[data-design-field='x']",
      );
      const yInput = designSelectionActions.querySelector(
        "[data-design-field='y']",
      );
      const wInput = designSelectionActions.querySelector(
        "[data-design-field='w']",
      );
      const hInput = designSelectionActions.querySelector(
        "[data-design-field='h']",
      );
      const workspace = getDesignWorkspaceSize();

      const minSize = getDesignObjectMinSize(obj.cls);
      const minW = Math.max(1, Number(minSize.w) || 1);
      const minH = Math.max(1, Number(minSize.h) || 1);
      const prevW = Number(obj.w) || minW;
      const prevH = Number(obj.h) || minH;
      if (pushUndo) {
        obj.prevW = prevW;
        obj.prevH = prevH;
      }

      const nextWRaw = Math.max(minW, Number(wInput?.value || prevW) || prevW);
      const nextHRaw = Math.max(minH, Number(hInput?.value || prevH) || prevH);
      const nextW =
        obj.cls === "table-round" ? Math.max(nextWRaw, nextHRaw) : nextWRaw;
      const nextH = obj.cls === "table-round" ? nextW : nextHRaw;
      obj.w = Math.min(nextW, Math.max(minW, workspace.width));
      obj.h = Math.min(nextH, Math.max(minH, workspace.height));

      obj.x = clamp(
        Number(xInput?.value || obj.x || 0) || 0,
        0,
        Math.max(0, workspace.width - obj.w),
      );
      obj.y = clamp(
        Number(yInput?.value || obj.y || 0) || 0,
        0,
        Math.max(0, workspace.height - obj.h),
      );

      saveState();
      renderDesignCanvas();
    };

    const applyTableFormEdits = (uid) => {
      const info = findTableByUid(uid);
      if (!info) return;

      const nameInput = designSelectionActions.querySelector(
        "[data-design-field='name']",
      );
      const dinersInput = designSelectionActions.querySelector(
        "[data-design-field='diners']",
      );
      const capacityInput = designSelectionActions.querySelector(
        "[data-design-field='capacity']",
      );
      const reservationNameInput = designSelectionActions.querySelector(
        "[data-design-field='reservationName']",
      );
      const reservationTimeInput = designSelectionActions.querySelector(
        "[data-design-field='reservationTime']",
      );

      const typedName = sanitizeEntityName(nameInput?.value || "", "");
      if (!typedName) {
        info.table.name = "";
      } else if (
        !isTableNameTaken(info.room, typedName, {
          excludeTableId: info.table.id,
        })
      ) {
        info.table.name = typedName;
      }

      const statusCode = getTableStatus(uid).code;
      const meta = getTableMeta(uid);
      state.tableMeta[uid] = {
        ...meta,
        diners: Math.max(
          0,
          Number(dinersInput?.value || meta.diners || 0) || 0,
        ),
        capacity: Math.max(
          1,
          Number(capacityInput?.value || meta.capacity || 4) || 4,
        ),
        reservationName:
          statusCode === "reservada"
            ? sanitizeEntityName(
                reservationNameInput?.value || meta.reservationName || "",
                "Reserva",
              ) || "Reserva"
            : String(meta.reservationName || ""),
        reservationTime:
          statusCode === "reservada"
            ? normalizeReservationTime(
                reservationTimeInput?.value || meta.reservationTime || "",
                meta.reservationTime || RESERVATION_MIN_TIME,
              )
            : String(meta.reservationTime || ""),
      };

      syncRoomDesignWithTables(info.room.id);
      saveState();
      renderEverything();
    };

    designSelectionActions.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-design-action]");
      if (!btn) return;

      const action = String(btn.dataset.designAction || "").trim();
      const uid = String(btn.dataset.tableUid || "").trim();
      const objectId = String(btn.dataset.objectId || "").trim();

      if (action === "delete-obj" && objectId) {
        removeDesignObject(objectId);
        return;
      }

      if (action === "save-form-obj" && objectId) {
        applyObjectFormEdits(objectId, { pushUndo: true });
        return;
      }

      if (action === "reset-size-obj" && objectId) {
        const roomId = getCurrentDesignRoomId();
        const objects = getRoomDesignObjects(roomId);
        const obj = objects.find((entry) => entry.id === objectId);
        if (!obj) return;
        pushDesignUndoSnapshot(roomId, cloneDesignObjectsForRoom(roomId));

        const def = getDefaultDesignObjectSizeByClass(obj.cls);
        obj.prevW = Number(obj.w) || def.w;
        obj.prevH = Number(obj.h) || def.h;
        obj.w = def.w;
        obj.h = def.h;

        const rect = designCanvas.getBoundingClientRect();
        obj.x = clamp(Number(obj.x) || 0, 0, Math.max(0, rect.width - obj.w));
        obj.y = clamp(Number(obj.y) || 0, 0, Math.max(0, rect.height - obj.h));

        saveState();
        renderDesignCanvas();
        return;
      }

      if (action === "revert-pos-obj" && objectId) {
        const roomId = getCurrentDesignRoomId();
        const objects = getRoomDesignObjects(roomId);
        const obj = objects.find((entry) => entry.id === objectId);
        if (!obj) return;
        const hasPrev =
          Number.isFinite(Number(obj.prevX)) &&
          Number.isFinite(Number(obj.prevY));
        if (!hasPrev) return;
        pushDesignUndoSnapshot(roomId, cloneDesignObjectsForRoom(roomId));

        const currentX = Number(obj.x) || 0;
        const currentY = Number(obj.y) || 0;
        obj.x = Number(obj.prevX) || 0;
        obj.y = Number(obj.prevY) || 0;
        obj.prevX = currentX;
        obj.prevY = currentY;

        saveState();
        renderDesignCanvas();
        return;
      }

      if (!uid) return;
      if (action === "save-form") {
        applyTableFormEdits(uid);
        return;
      }

      if (action === "set-state") {
        const nextState = String(btn.dataset.state || "")
          .trim()
          .toLowerCase();
        if (nextState === "reservada") {
          reserveTable(uid);
          return;
        }
        setTableManualState(uid, nextState);
        saveState();
        renderEverything();
        return;
      }

      if (action === "set-phase") {
        const nextPhase = String(btn.dataset.phase || "")
          .trim()
          .toLowerCase();
        setTableServiceStage(uid, nextPhase);
        saveState();
        renderEverything();
        return;
      }

      if (action === "delete") {
        deleteTable(uid);
      }
    });

    designSelectionActions.addEventListener("change", (event) => {
      const input = event.target.closest(
        "input[data-design-field], select[data-design-field]",
      );
      if (!input) return;

      const tableDeleteBtn = designSelectionActions.querySelector(
        "[data-design-action='delete'][data-table-uid]",
      );
      const objectDeleteBtn = designSelectionActions.querySelector(
        "[data-design-action='delete-obj'][data-object-id]",
      );

      const tableUid = String(tableDeleteBtn?.dataset.tableUid || "").trim();
      const objectId = String(objectDeleteBtn?.dataset.objectId || "").trim();

      if (tableUid) {
        applyTableFormEdits(tableUid);
        return;
      }

      if (objectId) {
        applyObjectFormEdits(objectId, { pushUndo: false });
      }
    });
  }

  document.getElementById("backToMapBtn").addEventListener("click", () => {
    setQuickReturnView("");
    switchView("mapa");
  });

  if (quickReturnBtn) {
    quickReturnBtn.addEventListener("click", () => {
      const target = normalizeMesasViewName(quickReturnView) || "mapa";
      setQuickReturnView("");
      switchView(target);
    });
  }

  productSearchInput.value = state.search || "";
  productSearchInput.addEventListener("input", () => {
    state.search = productSearchInput.value;
    saveState();
    renderProducts();
  });

  document.getElementById("clearSearchMesas").addEventListener("click", () => {
    state.search = "";
    productSearchInput.value = "";
    saveState();
    renderProducts();
  });

  document
    .getElementById("clearCartBtnMesas")
    .addEventListener("click", async () => {
      if (!cart.length) return;
      if (
        !(await askConfirm("Vaciar pedido actual de la mesa?", "Vaciar pedido"))
      )
        return;
      cart = [];
      upsertSelectedTableTicket();
      renderEverything();
    });

  document
    .getElementById("parkBtnMesas")
    .addEventListener("click", parkSelectedTable);
  document
    .getElementById("chargeBtnMesas")
    .addEventListener("click", chargeSelectedTable);

  ticketLines.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-act]");
    if (!btn) return;
    updateCartLine(btn.dataset.act, Number(btn.dataset.idx));
  });

  document
    .getElementById("saveDesignBtn")
    .addEventListener("click", async () => {
      saveState();
      await showNotice("Diseno de sala guardado.");
    });

  document
    .getElementById("clearDesignBtn")
    .addEventListener("click", async () => {
      const roomId = getCurrentDesignRoomId();
      const room = roomById(roomId);
      if (!room) {
        await showNotice("Selecciona una sala en el diseno.");
        return;
      }
      if (
        !(await askConfirm(
          `Limpiar diseno de la sala \"${room.name}\"?`,
          "Limpiar diseno",
        ))
      )
        return;
      pushDesignUndoSnapshot(roomId, cloneDesignObjectsForRoom(roomId));
      state.roomDesigns[roomId] = [];
      selectedDesignObjectId = null;
      saveState();
      renderDesignCanvas();
    });

  designUndoBtn?.addEventListener("click", () => undoDesignChange());
  designRedoBtn?.addEventListener("click", () => redoDesignChange());

  document.getElementById("switchToNormalBtn").addEventListener("click", () => {
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: "tpv:mesas-exit" }, "*");
        return;
      } catch {}
    }

    persistAppMode("tpv").finally(() => {
      window.location.href = "../index.html";
    });
  });

  bindDesignerEvents();
}

async function init() {
  if (MESAS_EMBED_MODE) document.body.classList.add("embed-mode");

  applySavedThemeMode();

  if (!MESAS_EMBED_MODE) {
    const localMode = String(
      MESAS_BRIDGE?.getAppMode?.() || localStorage.getItem(APP_MODE_KEY) || "",
    )
      .trim()
      .toLowerCase();
    const cfgMode = String(
      (await window.TPV_CFG?.get?.(APP_MODE_CFG_KEY)) || "",
    )
      .trim()
      .toLowerCase();

    if (localMode !== "mesas" || cfgMode !== "mesas") {
      await persistAppMode("mesas");
    }
  }

  if (MESAS_EMBED_MODE) {
    // En embed esperamos la hidratacion para evitar que un callback tardio
    // sobrescriba la vista actual (ej. diseno -> mapa).
    await hydrateStateFromRemote();
  } else {
    await hydrateStateFromRemote();
  }

  loadState();
  loadParkedTickets();
  ensureActiveRoomAndTable();
  await loadCatalog();
  loadCartFromSelectedTable();

  bindEvents();
  if (MESAS_EMBED_VIEW) {
    state.activeView = MESAS_EMBED_VIEW;
    saveState();
  }
  renderEverything();
  switchView(state.activeView);

  if (!MESAS_EMBED_MODE) {
    processMesasLayoutSyncQueue().catch(() => {});
    startMesasRemoteSyncPolling();
    bindMesasRemoteSyncEventsOnce();
  }

  tickClock();
  setInterval(tickClock, 1000);
}

init();
