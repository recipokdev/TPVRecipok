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
const mainPath = ensureFileExists("main.js");
const ticketPrintPath = ensureFileExists("ticket_print.html");
const checklistPath = ensureFileExists("tools/tests/cash-smoke-checklist.md");

if (
  !rendererPath ||
  !indexPath ||
  !stylesPath ||
  !mainPath ||
  !ticketPrintPath ||
  !checklistPath
) {
  process.exit(1);
}

const renderer = fs.readFileSync(rendererPath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");
const main = fs.readFileSync(mainPath, "utf8");
const ticketPrint = fs.readFileSync(ticketPrintPath, "utf8");

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

console.log("\n[SMOKE] Checking 2026-08-05 batch of fixes\n");

// Timeouts en escrituras a FacturaScripts (sin esto, una red inestable puede
// dejar el boton de cobrar/cerrar caja bloqueado para siempre sin error).
mustContain(
  renderer,
  "Timeout al escribir en",
  "apiWrite timeout guard present",
);
mustContain(
  renderer,
  "Timeout al crear la factura en FacturaScripts",
  "createTicketInFacturaScripts timeout guard present",
);

// Deduplicacion de facturas por numero2 (evita cobros duplicados en reintentos).
mustContain(
  renderer,
  "async function findExistingFacturaByNumero2",
  "Invoice dedup by numero2 present",
);

// Bloqueo entre terminales por sesion, no por id de terminal configurado
// (dos TPV con el mismo id de terminal deben seguir bloqueandose entre si).
mustContain(
  renderer,
  "ticket.closingByTerminalId = ensureTerminalPresenceSessionId();",
  "Parked-ticket checkout lock uses per-session id",
);

// El aviso de "varios TPV activos" no debe poder dispararse dos veces solapado.
mustContain(
  renderer,
  "if (__terminalPresenceInFlight) return null;",
  "Terminal presence check has overlap guard",
);

// Descuento de stock local tras la venta (en vez de refrescar todo el catalogo).
mustContain(
  renderer,
  "function applyLocalStockDecrementForSale",
  "Local stock decrement after sale present",
);

// Reset de cliente y sugerencia de nombre al aparcar.
mustContain(
  renderer,
  "El siguiente ticket debe arrancar con el cliente por defecto",
  "Customer resets to default after payment",
);
mustContain(
  renderer,
  "selectedCustomerName && !selectedCustomer?.isDefault",
  "Park name suggestion uses selected customer",
);

// Cash dialog y modal de ticket/devolucion: los botones no deben quedar
// dentro del area que hace scroll.
mustContain(
  styles,
  ".cash-page-scroll",
  "Cash dialog scroll wrapper present",
);
mustContain(
  styles,
  ".pay-modal-scroll",
  "Ticket/refund modal scroll wrapper present",
);
mustContain(
  styles,
  "flex-shrink: 0; /* sin esto, un texto largo al lado lo encoge",
  "Toggle switch protected from flex-shrink",
);

// Sincronizacion de aparcados: las llamadas a la API de reservas deben pasar
// por fetchWithTimeout (sin esto, un fetch colgado bloquea el reintento de
// la cola para siempre y en silencio).
mustContain(
  renderer,
  "async function fetchWithTimeout",
  "Shared fetch-with-timeout helper present",
);
mustContain(
  renderer,
  "await fetchWithTimeout(createUrl,",
  "Parked reservation create/upsert uses timeout",
);
mustContain(
  renderer,
  "await fetchWithTimeout(deleteUrl,",
  "Parked reservation delete uses timeout",
);

// El id interno de un aparcado (usado como clave de sincronizacion con el
// servidor) no puede depender solo de un contador local: dos TPV que no se
// hayan visto aun pueden calcular el mismo "siguiente id" y uno pisa al otro.
mustContain(
  renderer,
  "Math.max(basis + 1, Date.now());",
  "Parked ticket id generation is multi-terminal safe",
);

// "Reiniciar aparcados" no debe poder borrar cambios aun sin subir (p.ej. un
// cobro marcado localmente pero no confirmado todavia con el servidor).
mustContain(
  renderer,
  "if (k.startsWith(PARKED_SYNC_QUEUE_KEY)) continue;",
  "Reset-parked-cache preserves pending sync queue",
);

// Borrado en bloque de pendientes sin cobrar (admin-only), sin tocar stock
// por defecto (evita inflar stock si son duplicados fantasma por un fallo
// de sincronizacion entre TPV).
mustContain(
  renderer,
  "async function deleteAllPendingParkedTickets",
  "Bulk delete pending parked tickets function present",
);
mustContain(
  renderer,
  'id="parkedClearPendingBtn"',
  "Bulk delete pending button present",
);
mustContain(
  renderer,
  "!!window.TPV_STATE?.isAdmin;",
  "Bulk delete pending button is admin-gated",
);
mustContain(
  renderer,
  "if (askStockOnBulkDeletePendingEnabled) {",
  "Bulk delete pending respects ask-stock toggle",
);
mustContain(
  index,
  'id="askStockBulkDeletePendingToggle"',
  "Ask-stock-on-bulk-delete option present",
);

// Borrado individual de un aparcado pendiente: misma pregunta real/duplicado
// que en el borrado en bloque (antes liberaba el stock siempre, sin
// preguntar, lo cual era inconsistente y podia inflar stock en duplicados).
mustContain(
  renderer,
  "const askAboutStock =",
  "Single delete asks real-vs-duplicate stock question",
);
mustContain(
  styles,
  "#msgOverlay .simple-dialog.wide-dialog {",
  "Wide dialog style for long confirm texts present",
);

// Opciones de cierre de caja (admin-only) y su subopcion dependiente.
mustContain(
  index,
  'data-sec="cierre-caja"',
  "Cierre de Caja options section present",
);
mustContain(
  index,
  'id="printCajaDrawerLogsRow"',
  "Drawer-open logs suboption row present",
);
mustContain(
  renderer,
  "function syncPrintCajaDrawerLogsRowVisibility",
  "Suboption visibility sync function present",
);

// Impresion: logo debe esperar a cargar antes de imprimir; descripcion de
// producto debe imprimirse solida, no atenuada.
mustContain(
  main,
  "Array.from(document.images).map((img) =>",
  "Print window waits for images before printing",
);
mustContain(
  ticketPrint,
  ".item-sub.muted {",
  "Product description prints at full opacity",
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
