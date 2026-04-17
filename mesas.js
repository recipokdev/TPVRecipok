const APP_MODE_KEY = "tpv_app_mode";
const PARKED_TICKETS_CACHE_KEY = "tpv_parked_tickets_cache_v1";
const TABLES_STATE_KEY = "tpv_tables_state_v3";
const LEGACY_TABLES_STATE_KEY = "tpv_tables_state_v2";

const DEFAULT_STATE = {
  activeView: "mapa",
  activeRoomId: null,
  selectedTableId: null,
  category: "all",
  search: "",
  parkedCounter: 0,
  roomList: [],
  tableTicketMap: {},
  roomDesigns: {},
};

const DEMO_CATEGORIES = [
  { id: "bebidas", name: "Bebidas" },
  { id: "desayunos", name: "Desayunos" },
  { id: "comida", name: "Comida" },
];

const DEMO_PRODUCTS = [
  { id: 1, name: "Cafe solo", secondaryName: "", price: 1.2, category: "bebidas" },
  { id: 2, name: "Cafe con leche", secondaryName: "", price: 1.6, category: "bebidas" },
  { id: 3, name: "Tostada tomate", secondaryName: "", price: 2.2, category: "desayunos" },
  { id: 4, name: "Bocadillo jamon", secondaryName: "", price: 4.5, category: "comida" },
  { id: 5, name: "Sandwich mixto", secondaryName: "", price: 3.2, category: "comida" },
];

let state = cloneDefaultState();
let parkedTickets = [];
let cart = [];
let categories = [];
let products = [];
let selectedDesignObjectId = null;
let activeDesignTool = "select";
let dragState = null;

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
const productsGrid = document.getElementById("productsGridMesas");
const categoryBar = document.getElementById("categoryBar");
const otherTablesList = document.getElementById("otherTablesList");
const productSearchInput = document.getElementById("productSearchMesas");
const designCanvas = document.getElementById("designCanvas");
const designHintText = document.getElementById("designHintText");
const toolButtons = Array.from(document.querySelectorAll(".tool-btn"));

function cloneDefaultState() {
  return {
    ...DEFAULT_STATE,
    tableTicketMap: { ...DEFAULT_STATE.tableTicketMap },
    roomList: [],
    roomDesigns: {},
  };
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

function safeText(value, fallback = "") {
  const t = String(value || "").trim();
  return t || fallback;
}

function eur(v) {
  return `${(Number(v) || 0).toFixed(2).replace(".", ",")} EUR`;
}

function tableUid(roomId, tableId) {
  return `${roomId}::${tableId}`;
}

function splitTableUid(uid) {
  const [roomId, tableId] = String(uid || "").split("::");
  return { roomId: roomId || "", tableId: tableId || "" };
}

function saveState() {
  localStorage.setItem(TABLES_STATE_KEY, JSON.stringify(state));
}

function normalizeTables(rawTables, roomId) {
  if (!Array.isArray(rawTables)) return [];
  const seen = new Set();
  const out = [];

  rawTables.forEach((entry, idx) => {
    if (typeof entry === "string") {
      const tableName = safeText(entry);
      if (!tableName) return;
      const id = uniqueId(slugify(tableName) || `mesa-${idx + 1}`, seen);
      seen.add(id);
      out.push({ id, name: tableName });
      return;
    }

    const name = safeText(entry?.name || entry?.id, "Mesa");
    const proposedId = slugify(entry?.id || entry?.name || `mesa-${idx + 1}`);
    const id = uniqueId(proposedId || `mesa-${idx + 1}`, seen);
    seen.add(id);
    out.push({ id, name });
  });

  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(TABLES_STATE_KEY) || localStorage.getItem(LEGACY_TABLES_STATE_KEY);
    if (!raw) {
      state = cloneDefaultState();
      return;
    }

    const parsed = JSON.parse(raw);
    const base = cloneDefaultState();
    const roomList = Array.isArray(parsed?.roomList)
      ? parsed.roomList
          .map((r, idx) => {
            const name = safeText(r?.name, `Sala ${idx + 1}`);
            const id = slugify(r?.id || name) || `sala-${idx + 1}`;
            const tables = normalizeTables(r?.tables, id);
            return { id, name, tables };
          })
          .filter((r) => r.id)
      : [];

    state = {
      ...base,
      activeView: ["mapa", "transacciones", "diseno"].includes(parsed?.activeView)
        ? parsed.activeView
        : base.activeView,
      activeRoomId: parsed?.activeRoomId ? String(parsed.activeRoomId) : null,
      selectedTableId: parsed?.selectedTableId ? String(parsed.selectedTableId) : null,
      category: String(parsed?.category || "all"),
      search: String(parsed?.search || ""),
      parkedCounter: Number(parsed?.parkedCounter || 0) || 0,
      tableTicketMap:
        parsed?.tableTicketMap && typeof parsed.tableTicketMap === "object"
          ? { ...parsed.tableTicketMap }
          : {},
      roomDesigns:
        parsed?.roomDesigns && typeof parsed.roomDesigns === "object"
          ? { ...parsed.roomDesigns }
          : {},
      roomList,
    };
  } catch {
    state = cloneDefaultState();
  }
}

function loadParkedTickets() {
  try {
    const raw = localStorage.getItem(PARKED_TICKETS_CACHE_KEY);
    parkedTickets = raw ? JSON.parse(raw) : [];
  } catch {
    parkedTickets = [];
  }

  if (!Array.isArray(parkedTickets)) parkedTickets = [];
}

function saveParkedTickets() {
  localStorage.setItem(PARKED_TICKETS_CACHE_KEY, JSON.stringify(parkedTickets));
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

function getMappedTicketForTable(uid) {
  const ticketId = state.tableTicketMap[uid];
  if (!ticketId) return null;
  return parkedTickets.find((t) => String(t.id) === String(ticketId) && !t.paid) || null;
}

function getTableStatus(uid) {
  const ticket = getMappedTicketForTable(uid);
  if (!ticket) return { code: "libre", label: "Libre", total: 0 };
  const total = Number(ticket.total) || 0;
  if (total > 0) return { code: "ocupada", label: "Ocupada", total };
  return { code: "libre", label: "Libre", total: 0 };
}

function lineTotal(line) {
  return (Number(line.qty) || 0) * (Number(line.price) || 0);
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
  state.activeView = ["mapa", "transacciones", "diseno"].includes(viewName) ? viewName : "mapa";
  saveState();

  tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === state.activeView));
  Object.entries(views).forEach(([name, el]) => {
    el.classList.toggle("is-active", name === state.activeView);
  });

  if (state.activeView === "diseno") {
    renderDesignCanvas();
  }
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
  mesaCards.innerHTML = "";
  const room = roomById(state.activeRoomId);
  if (!room) return;

  room.tables.forEach((table) => {
    const uid = tableUid(room.id, table.id);
    const st = getTableStatus(uid);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "mesa-card";
    if (state.selectedTableId === uid) card.classList.add("is-selected");

    card.innerHTML = `
      <div class="mesa-card-head">
        <span class="mesa-name">${table.name}</span>
        <span class="mesa-state-dot ${st.code}"></span>
      </div>
      <div class="mesa-sub">${st.total > 0 ? eur(st.total) : st.label}</div>
      <div class="mesa-card-actions">
        <button type="button" class="mini-action" data-table-act="edit" data-table-uid="${uid}">Editar</button>
        <button type="button" class="mini-action danger" data-table-act="delete" data-table-uid="${uid}">Borrar</button>
      </div>
    `;

    card.addEventListener("click", (event) => {
      if (event.target.closest("[data-table-act]")) return;
      switchTable(uid, { openTrans: true });
    });

    mesaCards.appendChild(card);
  });
}

function renderSelectedTableInfo() {
  const current = findTableByUid(state.selectedTableId);
  const st = state.selectedTableId ? getTableStatus(state.selectedTableId) : { label: "Sin seleccionar", total: 0 };
  const tableLabel = current ? current.table.name : "-";

  selectedTableTitle.textContent = tableLabel;
  selectedTableState.textContent = st.total > 0 ? `${st.label} · ${eur(st.total)}` : st.label;
  ticketMesaTitle.textContent = `Mesa ${tableLabel}`;
  ticketMeta.textContent = cart.length ? `${cart.length} lineas` : "Sin pedido";
}

function renderOtherTables() {
  otherTablesList.innerHTML = "";

  const currentUid = state.selectedTableId;
  allTables().forEach(({ room, table, uid }) => {
    if (uid === currentUid) return;
    const st = getTableStatus(uid);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "other-table-btn";
    button.innerHTML = `<span>${table.name} · ${room.name}</span><span>${st.total > 0 ? eur(st.total) : st.label}</span>`;
    button.addEventListener("click", () => switchTable(uid));
    otherTablesList.appendChild(button);
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
  if (state.category !== "all" && String(product.category) !== String(state.category)) {
    return false;
  }

  const q = String(state.search || "").trim().toLowerCase();
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
      <div>${product.name}</div>
      ${product.secondaryName ? `<div class="product-secondary">${product.secondaryName}</div>` : ""}
      <div class="product-price">${eur(product.price)}</div>
    `;
    button.addEventListener("click", () => addProductToCart(product));
    productsGrid.appendChild(button);
  });
}

function renderCart() {
  ticketLines.innerHTML = "";

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
    alert("Selecciona una mesa primero.");
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
  const maxId = parkedTickets.reduce((max, ticket) => Math.max(max, Number(ticket.id) || 0), 0);
  state.parkedCounter = Math.max(state.parkedCounter + 1, maxId + 1);
  saveState();
  return state.parkedCounter;
}

function upsertSelectedTableTicket() {
  const tableInfo = findTableByUid(state.selectedTableId);
  if (!tableInfo) return null;

  if (!cart.length) {
    delete state.tableTicketMap[tableInfo.uid];
    saveState();
    return null;
  }

  const mapped = getMappedTicketForTable(tableInfo.uid);

  if (mapped) {
    mapped.items = cart.map((line) => ({ ...line }));
    mapped.total = cartTotal();
    mapped.updatedAt = new Date().toISOString();
    mapped.name = tableInfo.table.name;
    mapped.obs = `Mesa ${tableInfo.table.name} · ${tableInfo.room.name}`;
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
    name: tableInfo.table.name,
    obs: `Mesa ${tableInfo.table.name} · ${tableInfo.room.name}`,
    paid: false,
    paidAt: null,
    paidTicketCode: null,
    paidTicketId: null,
    fs: null,
  };

  parkedTickets.push(ticket);
  state.tableTicketMap[tableInfo.uid] = ticket.id;
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
    referencia: String(line.referencia || ""),
    secondaryName: String(line.secondaryName || ""),
  }));
}

function switchTable(uid, opts = {}) {
  const { openTrans = false } = opts;
  if (state.selectedTableId && state.selectedTableId !== uid) {
    upsertSelectedTableTicket();
  }

  const tableInfo = findTableByUid(uid);
  if (!tableInfo) return;

  state.selectedTableId = uid;
  state.activeRoomId = tableInfo.room.id;
  saveState();

  loadCartFromSelectedTable();
  renderEverything();
  if (openTrans) switchView("transacciones");
}

function parkSelectedTable() {
  const tableInfo = findTableByUid(state.selectedTableId);
  if (!tableInfo) {
    alert("Selecciona una mesa primero.");
    return;
  }

  if (!cart.length) {
    alert("No hay productos para aparcar en esta mesa.");
    return;
  }

  upsertSelectedTableTicket();
  renderEverything();
  alert(`Mesa ${tableInfo.table.name} aparcada.`);
}

function chargeSelectedTable() {
  const tableInfo = findTableByUid(state.selectedTableId);
  if (!tableInfo) {
    alert("Selecciona una mesa primero.");
    return;
  }

  if (!cart.length) {
    alert("No hay productos para cobrar.");
    return;
  }

  const ticket = upsertSelectedTableTicket();
  if (ticket) {
    ticket.paid = true;
    ticket.paidAt = new Date().toISOString();
    ticket.paidTicketCode = `MESA-${ticket.id}`;
    delete state.tableTicketMap[tableInfo.uid];
    saveParkedTickets();
    saveState();
  }

  cart = [];
  renderEverything();
  switchView("mapa");
  alert(`Mesa ${tableInfo.table.name} cobrada y liberada.`);
}

function addRoom() {
  const roomName = prompt("Nombre de la nueva sala:", "Nueva sala");
  if (!roomName) return;

  const trimmedName = safeText(roomName);
  if (!trimmedName) return;

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

function renameActiveRoom() {
  const room = roomById(state.activeRoomId);
  if (!room) {
    alert("No hay una sala seleccionada.");
    return;
  }

  const newName = prompt("Nuevo nombre de la sala:", room.name);
  if (!newName) return;

  room.name = safeText(newName, room.name);
  saveState();
  renderEverything();
}

function deleteActiveRoom() {
  const room = roomById(state.activeRoomId);
  if (!room) {
    alert("No hay una sala seleccionada.");
    return;
  }

  if (!confirm(`Borrar sala \"${room.name}\" y sus mesas?`)) return;

  room.tables.forEach((table) => {
    const uid = tableUid(room.id, table.id);
    delete state.tableTicketMap[uid];
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
    alert("Crea o selecciona una sala primero.");
    return;
  }

  const tableName = prompt("Nombre o numero de mesa:", `Mesa ${room.tables.length + 1}`);
  if (!tableName) return;

  const trimmedName = safeText(tableName);
  if (!trimmedName) return;

  const used = new Set(room.tables.map((table) => table.id));
  const id = uniqueId(slugify(trimmedName) || `mesa-${room.tables.length + 1}`, used);
  const table = { id, name: trimmedName };
  room.tables.push(table);
  state.selectedTableId = tableUid(room.id, table.id);
  saveState();
  loadCartFromSelectedTable();
  renderEverything();
}

function editTable(uid) {
  const info = findTableByUid(uid);
  if (!info) return;

  const newName = prompt("Nuevo nombre de mesa:", info.table.name);
  if (!newName) return;

  info.table.name = safeText(newName, info.table.name);
  saveState();
  renderEverything();
}

function deleteTable(uid) {
  const info = findTableByUid(uid);
  if (!info) return;

  if (!confirm(`Borrar mesa \"${info.table.name}\"?`)) return;

  info.room.tables = info.room.tables.filter((table) => table.id !== info.table.id);
  delete state.tableTicketMap[uid];

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

function loadDemoCatalog() {
  categories = DEMO_CATEGORIES.map((cat) => ({ ...cat }));
  products = DEMO_PRODUCTS.map((product) => ({ ...product }));
}

async function loadCatalog() {
  const cfg = window.RECIPOK_API || {};
  const hasApi = String(cfg.baseUrl || "").trim() && String(cfg.apiKey || "").trim();

  if (!hasApi) {
    loadDemoCatalog();
    return;
  }

  try {
    const [familiasRaw, productosRaw] = await Promise.all([
      fetchApiResource("familias"),
      fetchApiResource("productos"),
    ]);

    categories = familiasRaw
      .filter((family) => {
        const flag = family.tpv_show ?? family.tpv ?? family.mostrarentpv ?? family.mostrar_en_tpv;
        return flag !== false && flag !== 0 && flag !== "0";
      })
      .map((family, idx) => ({
        id: String(family.codfamilia ?? family.id ?? idx),
        name: safeText(family.descripcion ?? family.nombre ?? family.codfamilia, `Grupo ${idx + 1}`),
      }));

    const allowedCategories = new Set(categories.map((cat) => String(cat.id)));
    products = productosRaw
      .filter((product) => {
        if (product.bloqueado) return false;
        if (product.sevende === false || product.sevende === 0 || product.sevende === "0") return false;
        const name = safeText(product.descripcion ?? product.referencia);
        if (!name || name === "-") return false;
        const cat = String(product.codfamilia ?? "");
        return !allowedCategories.size || allowedCategories.has(cat);
      })
      .map((product, idx) => {
        const name = safeText(product.descripcion ?? product.referencia, `Producto ${idx + 1}`);
        return {
          id: String(product.idproducto ?? product.id ?? idx),
          name,
          secondaryName: "",
          referencia: safeText(product.referencia, name),
          price: Number(product.precio ?? 0) || 0,
          category: String(product.codfamilia ?? ""),
        };
      });

    if (!products.length) {
      loadDemoCatalog();
    }
  } catch (error) {
    console.warn("No se pudo cargar catalogo real para mesas:", error?.message || error);
    loadDemoCatalog();
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
    "mesa-redonda": { cls: "table-round", label: "Mesa", w: 78, h: 78 },
    "mesa-cuadrada": { cls: "table-square", label: "Mesa", w: 82, h: 82 },
    "mesa-rectangular": { cls: "table-rect", label: "Mesa", w: 120, h: 72 },
    barra: { cls: "structure-barra", label: "Barra", w: 170, h: 46 },
    entrada: { cls: "structure-entrada", label: "Entrada", w: 120, h: 44 },
    muro: { cls: "structure-muro", label: "Muro", w: 140, h: 20 },
  };
  return map[tool] || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function renderDesignCanvas() {
  designCanvas.querySelectorAll(".design-obj").forEach((node) => node.remove());

  const roomId = getCurrentDesignRoomId();
  const objects = getRoomDesignObjects(roomId);
  const canPaint = Boolean(roomId);

  designHintText.classList.toggle("hidden", canPaint && objects.length > 0);
  if (!canPaint) {
    designHintText.textContent = "Crea una sala para empezar a disenar.";
    designHintText.classList.remove("hidden");
    return;
  }

  if (!objects.length) {
    designHintText.textContent = "Selecciona una herramienta y haz clic en el plano.";
  }

  objects.forEach((obj) => {
    const node = document.createElement("div");
    node.className = `design-obj ${obj.cls}`;
    node.dataset.objectId = obj.id;
    node.style.left = `${obj.x}px`;
    node.style.top = `${obj.y}px`;
    node.style.width = `${obj.w}px`;
    node.style.height = `${obj.h}px`;
    node.textContent = obj.label || "";
    if (obj.id === selectedDesignObjectId) node.classList.add("selected");

    const del = document.createElement("button");
    del.type = "button";
    del.className = "design-obj-delete";
    del.dataset.objectDelete = obj.id;
    del.textContent = "x";
    node.appendChild(del);

    designCanvas.appendChild(node);
  });
}

function addDesignObjectAt(clientX, clientY) {
  const roomId = getCurrentDesignRoomId();
  if (!roomId) {
    alert("Selecciona una sala en el diseno.");
    return;
  }

  const base = toolToObject(activeDesignTool);
  if (!base) return;

  const rect = designCanvas.getBoundingClientRect();
  const x = clamp(clientX - rect.left - base.w / 2, 0, Math.max(0, rect.width - base.w));
  const y = clamp(clientY - rect.top - base.h / 2, 0, Math.max(0, rect.height - base.h));

  const objects = getRoomDesignObjects(roomId);
  objects.push({
    id: `obj-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    cls: base.cls,
    label: base.label,
    x,
    y,
    w: base.w,
    h: base.h,
  });

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
  const objects = getRoomDesignObjects(roomId);
  state.roomDesigns[roomId] = objects.filter((obj) => obj.id !== objectId);
  if (selectedDesignObjectId === objectId) selectedDesignObjectId = null;
  saveState();
  renderDesignCanvas();
}

function updateDesignTool(tool) {
  activeDesignTool = tool;
  toolButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === activeDesignTool);
  });
}

function bindDesignerEvents() {
  toolButtons.forEach((button) => {
    button.addEventListener("click", () => updateDesignTool(button.dataset.tool));
  });

  designCanvas.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest("[data-object-delete]");
    if (deleteBtn) {
      removeDesignObject(deleteBtn.dataset.objectDelete);
      return;
    }

    const objNode = event.target.closest(".design-obj");
    if (objNode) {
      selectDesignObject(objNode.dataset.objectId);
      return;
    }

    if (activeDesignTool !== "select") {
      addDesignObjectAt(event.clientX, event.clientY);
    }
  });

  designCanvas.addEventListener("mousedown", (event) => {
    if (activeDesignTool !== "select") return;
    const node = event.target.closest(".design-obj");
    if (!node) return;

    const objectId = node.dataset.objectId;
    const roomId = getCurrentDesignRoomId();
    const objects = getRoomDesignObjects(roomId);
    const obj = objects.find((entry) => entry.id === objectId);
    if (!obj) return;

    const rect = designCanvas.getBoundingClientRect();
    dragState = {
      objectId,
      roomId,
      offsetX: event.clientX - rect.left - obj.x,
      offsetY: event.clientY - rect.top - obj.y,
    };
    selectDesignObject(objectId);
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragState) return;

    const objects = getRoomDesignObjects(dragState.roomId);
    const obj = objects.find((entry) => entry.id === dragState.objectId);
    if (!obj) return;

    const rect = designCanvas.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left - dragState.offsetX, 0, Math.max(0, rect.width - obj.w));
    const y = clamp(event.clientY - rect.top - dragState.offsetY, 0, Math.max(0, rect.height - obj.h));
    obj.x = x;
    obj.y = y;
    renderDesignCanvas();
  });

  window.addEventListener("mouseup", () => {
    if (!dragState) return;
    dragState = null;
    saveState();
  });
}

function renderEverything() {
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
  const hh = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const dd = now.toLocaleDateString("es-ES");
  document.getElementById("mesasClock").textContent = hh;
  document.getElementById("mesasDate").textContent = dd;
}

function bindEvents() {
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
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

  document.getElementById("addRoomBtn").addEventListener("click", addRoom);
  document.getElementById("createFirstRoomBtn").addEventListener("click", addRoom);
  document.getElementById("renameRoomBtn").addEventListener("click", renameActiveRoom);
  document.getElementById("deleteRoomBtn").addEventListener("click", deleteActiveRoom);
  document.getElementById("addTableBtn").addEventListener("click", addTableToActiveRoom);

  mesaCards.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("[data-table-act]");
    if (!actionBtn) return;

    const action = actionBtn.dataset.tableAct;
    const uid = actionBtn.dataset.tableUid;
    if (!uid) return;

    if (action === "edit") editTable(uid);
    if (action === "delete") deleteTable(uid);
  });

  document.getElementById("backToMapBtn").addEventListener("click", () => switchView("mapa"));

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

  document.getElementById("clearCartBtnMesas").addEventListener("click", () => {
    if (!cart.length) return;
    if (!confirm("Vaciar pedido actual de la mesa?")) return;
    cart = [];
    upsertSelectedTableTicket();
    renderEverything();
  });

  document.getElementById("parkBtnMesas").addEventListener("click", parkSelectedTable);
  document.getElementById("chargeBtnMesas").addEventListener("click", chargeSelectedTable);

  ticketLines.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-act]");
    if (!btn) return;
    updateCartLine(btn.dataset.act, Number(btn.dataset.idx));
  });

  document.getElementById("saveDesignBtn").addEventListener("click", () => {
    saveState();
    alert("Diseno de sala guardado.");
  });

  document.getElementById("clearDesignBtn").addEventListener("click", () => {
    const roomId = getCurrentDesignRoomId();
    const room = roomById(roomId);
    if (!room) {
      alert("Selecciona una sala en el diseno.");
      return;
    }
    if (!confirm(`Limpiar diseno de la sala \"${room.name}\"?`)) return;
    state.roomDesigns[roomId] = [];
    selectedDesignObjectId = null;
    saveState();
    renderDesignCanvas();
  });

  document.getElementById("switchToNormalBtn").addEventListener("click", () => {
    localStorage.setItem(APP_MODE_KEY, "normal");
    window.location.href = "index.html";
  });

  bindDesignerEvents();
}

async function init() {
  const mode = localStorage.getItem(APP_MODE_KEY);
  if (mode !== "mesas") {
    localStorage.setItem(APP_MODE_KEY, "mesas");
  }

  loadState();
  loadParkedTickets();
  ensureActiveRoomAndTable();
  await loadCatalog();
  loadCartFromSelectedTable();

  bindEvents();
  renderEverything();
  switchView(state.activeView);

  tickClock();
  setInterval(tickClock, 1000);
}

init();
