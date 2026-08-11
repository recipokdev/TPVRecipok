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
const preloadPath = ensureFileExists("preload.js");
const ticketPrintPath = ensureFileExists("ticket_print.html");
const mesasJsPath = ensureFileExists("mesas/mesas.js");
const customerSelectorPath = ensureFileExists(
  "js/tpv/ui/customer_selector/customer_selector.js",
);
const checklistPath = ensureFileExists("tools/tests/cash-smoke-checklist.md");

if (
  !rendererPath ||
  !indexPath ||
  !stylesPath ||
  !mainPath ||
  !preloadPath ||
  !ticketPrintPath ||
  !mesasJsPath ||
  !customerSelectorPath ||
  !checklistPath
) {
  process.exit(1);
}

const renderer = fs.readFileSync(rendererPath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");
const main = fs.readFileSync(mainPath, "utf8");
const preload = fs.readFileSync(preloadPath, "utf8");
const ticketPrint = fs.readFileSync(ticketPrintPath, "utf8");
const customerSelector = fs.readFileSync(customerSelectorPath, "utf8");
const mesasJs = fs.readFileSync(mesasJsPath, "utf8");

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

// Si se desactiva la pregunta de stock, el comportamiento por defecto debe
// ser el normal (devolver stock, como al borrar uno solo), NO el caso
// excepcional de duplicados fantasma (eso habria dejado stock sin devolver
// en silencio en el caso de uso mas comun).
mustContain(
  renderer,
  "async function deleteAllPendingParkedTickets({ releaseStock = true } = {})",
  "Bulk delete pending defaults to releasing stock (the normal case)",
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

console.log("\n[SMOKE] Checking 2026-08-07 update-gate resilience fixes\n");

// Clic en "Actualizar" mientras ya hay una comprobacion en curso: antes no
// hacia nada en absoluto (parecia que el boton estaba roto). Ahora avisa.
mustContain(
  renderer,
  "Ya hay una comprobación de actualización en curso",
  "Manual update button warns instead of silently no-op'ing",
);

// Mensaje de "llevas X tiempo esperando" en los reintentos del arranque
// (no cambia el comportamiento, solo explica por que tarda).
mustContain(
  main,
  "function elapsedRetryHint(startedAt)",
  "Startup gate shows elapsed-wait hint during retries",
);

// Sin internet de verdad (ni Google, ni Cloudflare, ni GitHub responden) tras
// un tiempo razonable: se abre con la version actual en vez de bloquear para
// siempre (el riesgo que evita la comprobacion no existe sin conexion).
mustContain(
  main,
  "const NO_INTERNET_BYPASS_MS = 50_000;",
  "No-internet startup bypass constant present",
);
mustContain(
  main,
  "return { ok: true, noInternet: true };",
  "Internet check returns noInternet bypass signal",
);
mustContain(
  main,
  "if (netGate?.noInternet) {",
  "Update gate skips update check when there is no internet at all",
);
mustContain(
  main,
  'ipcMain.handle("updater:getStartupNoInternetFlag"',
  "Startup no-internet flag exposed via IPC",
);
mustContain(
  preload,
  "getStartupNoInternetFlag:",
  "Startup no-internet flag bridged in preload",
);
mustContain(
  renderer,
  "function showStartupNoInternetBanner()",
  "Persistent no-internet startup banner present",
);
mustContain(
  renderer,
  "checkStartupNoInternetFlag()",
  "App checks the no-internet startup flag on boot",
);

console.log(
  "\n[SMOKE] Checking 2026-08-07 parked-paid-sync-stuck-forever fix\n",
);

// Un cobro confirmado en local nunca debe perder frente a una comparacion de
// fechas al reintentar la cola: sin esto, si el remoto parecia "mas
// reciente" por cualquier motivo, el aviso de "cobrado" se descartaba para
// siempre en silencio y el servidor se quedaba en paid:false indefinidamente
// (otros TPV seguian contando ese ticket como pendiente sin fin).
mustContain(
  renderer,
  "if (!!localTicket?.paid && !remoteTicket?.paid) {",
  "Confirmed-paid queued upsert always wins over remote-newer heuristic",
);

// Sin logging, un elemento de la cola que falla siempre por el mismo motivo
// reintentaba en silencio para siempre sin ninguna pista de por que.
mustContain(
  renderer,
  "No se pudo sincronizar reserva aparcada en cola",
  "Parked sync queue retry failures are logged instead of silently swallowed",
);

// Vaciar el carrito (o soltar un aparcado) llamaba a
// restorePreParkedCustomerSelection(), que leia/escribia esta variable sin
// que existiera ninguna declaracion a nivel de modulo -> ReferenceError en
// produccion (0.2.14) al pulsar "Vaciar".
mustContain(
  renderer,
  "let preParkedCustomerSelection = null;",
  "preParkedCustomerSelection has a module-level declaration (was missing, crashed clear-cart)",
);

// "Limpiar cobrados" en un TPV podia tardar hasta 12h en reflejarse en otro
// TPV (la cache local de "cobrados recientes" ganaba sobre el borrado remoto
// durante esa ventana). Ahora es una ventana corta, solo para cubrir la
// ida y vuelta de red real tras cobrar.
mustContain(
  renderer,
  "const PARKED_PAID_LOCAL_GRACE_MS = 2 * 60 * 1000;",
  "Paid-ticket local grace window is short, not 12h (cross-TPV 'Limpiar cobrados' propagates promptly)",
);

console.log("\n[SMOKE] Checking 2026-08-10 Mesas scope/state-loss fixes\n");

// getCurrentParkingModeScope() solo contaba "Transacciones" como modo Mesas.
// En "Mapa de Salas"/"Diseñar Salas" (mismo MESAS_INLINE_ACTIVE) el scope
// caia a "tpv" y cada sondeo automatico descartaba TODOS los tickets de
// Mesas de la cache local, sin que nadie tocara nada.
mustContain(
  renderer,
  "return MESAS_INLINE_ACTIVE ? PARKED_MODE_MESAS : PARKED_MODE_TPV;",
  "Mesas parking-mode scope covers all Mesas sub-views, not just Transacciones",
);

// El mapa de mesas (iframe mesas/mesas.js) reescribe TODO el estado en cada
// guardado; si no conserva draftCartByTable, lo borra para todas las mesas
// en cuanto se toca cualquiera.
mustContain(
  mesasJs,
  "draftCartByTable: {},",
  "Mesas iframe DEFAULT_STATE preserves draftCartByTable",
);
mustContain(
  mesasJs,
  "parsed?.draftCartByTable && typeof parsed.draftCartByTable === \"object\"",
  "Mesas iframe loadState() preserves draftCartByTable instead of dropping it",
);

// Un borrado que triunfa debe limpiar cualquier "upsert" que quedara en cola
// para ese mismo ticket; si no, el siguiente drenaje de la cola lo resucita.
mustContain(
  renderer,
  "!variants.includes(String(q?.key || \"\"))",
  "Successful delete clears any stale queued upsert for the same ticket (prevents resurrection)",
);

// El teclado en pantalla de "Aparcar ticket"/"Guardar pedido de mesa" se
// abre al tocar el propio campo, no con un boton aparte.
mustContain(
  renderer,
  'parkNameInput?.addEventListener("click", () => {',
  "Park name input opens the on-screen keyboard on tap (button removed)",
);
mustContain(
  renderer,
  'parkObsInput?.addEventListener("click", () => {',
  "Park obs input opens the on-screen keyboard on tap (button removed)",
);
if (index.includes('id="parkNameKeyboardBtn"') || index.includes('id="parkObsKeyboardBtn"')) {
  fail("Old park keyboard buttons should be removed from index.html");
} else {
  ok("Old park keyboard buttons removed from index.html");
}

// Barrido general: ningun boton "...KeyboardBtn" deberia quedar ya en el
// HTML — todos los campos abren su teclado/numpad al tocarse a si mismos.
const leftoverKeyboardBtnMatch = index.match(/id="[A-Za-z]*[Kk]eyboardBtn"/);
if (leftoverKeyboardBtnMatch) {
  fail(
    `Leftover separate keyboard button in index.html: ${leftoverKeyboardBtnMatch[0]} (inputs should open their own keyboard on tap instead)`,
  );
} else {
  ok("No leftover separate keyboard buttons in index.html");
}

mustContain(
  renderer,
  'searchInput?.addEventListener("click", () => {',
  "Main product search opens keyboard on tap (button removed)",
);
mustContain(
  renderer,
  "ticketsSearch?.addEventListener(\"click\", () => {",
  "Tickets modal search opens keyboard on tap (button removed)",
);
mustContain(
  renderer,
  "parkedSearch?.addEventListener(\"click\", () => {",
  "Parked tickets search opens keyboard on tap (button removed)",
);
mustContain(
  renderer,
  "emailInput.onclick = () => {",
  "Activation email input opens keyboard on tap (button removed)",
);
mustContain(
  renderer,
  "cashMoveAmountInput.addEventListener(\"click\", () => {",
  "Cash movement amount input opens numpad on tap (button removed)",
);
mustContain(
  renderer,
  "cashMoveReasonInput.addEventListener(\"click\", () => {",
  "Cash movement reason input opens keyboard on tap (button removed)",
);

console.log("\n[SMOKE] Checking 2026-08-11 self-inflicted offline-loop fix\n");

// loadDataFromApi() dispara 7 peticiones a la vez; con solo 3s de margen, la
// propia comprobacion de conexion podia quedarse en cola detras de esa
// rafaga y fallar por tiempo sin que hubiera ningun problema real de red.
mustContain(
  renderer,
  "const t = setTimeout(() => controller.abort(), 8000);",
  "Connectivity check has enough margin to survive a full-reload burst",
);

// Con el ping tardando hasta 8s pero el intervalo siendo de 5s, sin candado
// dos comprobaciones podian quedar corriendo a la vez.
mustContain(
  renderer,
  "if (tickInFlight) return;",
  "Online-monitor tick has a re-entrancy guard",
);

// Antes eran 15s: una recarga completa disparada al "reconectar" podia
// saturar las conexiones, hacer fallar la propia comprobacion de conexion,
// y disparar OTRA recarga completa -> bucle que se retroalimenta solo.
mustContain(
  renderer,
  "Date.now() - Number(LAST_FULL_LOAD_AT || 0) < 60000;",
  "Full data reload on reconnect is throttled to once per minute, not 15s",
);

// Los 4 monitores de refresco cada 10s (stock, aparcados, estado/salud de
// caja compartida) arrancaban todos a la vez tras abrir caja, agrupando sus
// peticiones en el mismo instante cada 10s y saturando el pool de conexiones.
mustContain(
  renderer,
  "const AUTO_REFRESH_STAGGER_MS = 2500;",
  "Auto-refresh timers share a stagger constant to avoid firing all at once",
);
mustContain(
  renderer,
  "__stockRefreshStartTimeout = setTimeout(() => {",
  "Stock auto-refresh start is staggered",
);
mustContain(
  renderer,
  "__parkedReservationsRefreshStartTimeout = setTimeout(() => {",
  "Parked reservations auto-refresh start is staggered",
);
mustContain(
  renderer,
  "}, 2 * AUTO_REFRESH_STAGGER_MS);",
  "Shared caja state monitor start is staggered",
);
mustContain(
  renderer,
  "}, 3 * AUTO_REFRESH_STAGGER_MS);",
  "Shared caja health monitor start is staggered",
);

console.log(
  "\n[SMOKE] Checking 2026-08-11 slow-first-Opciones-open / stale-toggle fixes\n",
);

// Options modal does ~30 sequential "cfg:get" IPC calls on open; each one
// used to re-read+parse the whole config file from disk, which was slow
// the first time (cold OS file cache).
mustContain(main, "let __cfgCache = null;", "Main-process config reads are cached in memory");
mustContain(
  main,
  "if (__cfgCache) return __cfgCache;",
  "readCfg() serves from cache instead of re-reading disk every call",
);
mustContain(
  main,
  "__cfgCache = next;",
  "writeCfg() keeps the in-memory cache in sync after a write",
);

// askStockOnBulkDeletePendingEnabled defaulted to true and was only ever
// re-read from persisted config when Opciones was opened, so a saved "off"
// stayed ignored (asking about stock again) until Opciones was opened once.
mustContain(
  renderer,
  "if (askAboutStock) await loadAskStockBulkDeletePendingToggle();",
  "Single parked-ticket delete re-reads the ask-stock toggle instead of trusting a stale in-memory default",
);
mustContain(
  renderer,
  "    await loadAskStockBulkDeletePendingToggle();",
  "Bulk delete pending re-reads the ask-stock toggle instead of trusting a stale in-memory default",
);

// openOptions() kept the modal hidden through ~30 sequential settings loads
// (several hitting the live server) before revealing it, so a slow response
// anywhere in that chain made "Opciones" look frozen for several seconds.
mustContain(
  renderer,
  "// Mostrar el modal YA: a partir de aqui hay ~30 cargas de ajustes en",
  "Options modal is shown before its settings load, not after",
);

// The main product search "X" clear button was always visible, even with
// an empty search box.
mustContain(
  renderer,
  "function syncSearchClearBtnVisibility() {",
  "Main search clear button visibility helper present",
);
mustContain(
  renderer,
  'searchClearBtn?.classList.toggle("hidden", !searchInput?.value);',
  "Main search clear button hides itself when the search box is empty",
);

console.log(
  "\n[SMOKE] Checking 2026-08-11 keyboard-dismiss / clear-X / accent-insensitive search\n",
);

// Tapping outside the on-screen QWERTY keyboard used to revert to whatever
// was in the field before it opened; there is already a dedicated
// "Cancelar" key for that, so outside-tap should keep what was typed.
mustContain(
  renderer,
  'handleOverlayOutsideClick(e, ".qwerty-pad", () => closeQwerty("confirm"))',
  "Tapping outside the QWERTY keyboard keeps the typed text instead of reverting it",
);

// Generic reusable "X" clear button for text inputs/textareas that don't
// have their own search-style clear logic, so users don't have to open the
// keyboard just to empty a field.
mustContain(
  renderer,
  "function wireInputClearButton(inputEl, btnEl) {",
  "Generic input-clear-button helper present",
);
mustContain(
  styles,
  ".input-clear-wrap {",
  "Generic input-clear-wrap CSS present",
);
mustContain(
  index,
  'id="tariffCustomerSearchClearBtn"',
  "Tariff customer search has a clear button",
);
mustContain(
  index,
  'id="parkNameClearBtn"',
  "Park name input has a clear button",
);
mustContain(index, 'id="parkObsClearBtn"', "Park obs input has a clear button");
mustContain(index, 'id="emailClearBtn"', "Activation email input has a clear button");
mustContain(
  index,
  'id="cashMoveReasonClearBtn"',
  "Cash movement reason has a clear button",
);
mustContain(index, 'id="payObsClearBtn"', "Payment obs has a clear button");
mustContain(index, 'id="payNumberClearBtn"', "Payment number has a clear button");
mustContain(
  index,
  'id="comandaObsClearBtn"',
  "Comanda obs has a clear button",
);
mustContain(
  index,
  'id="mesasTransReservaNameClearBtn"',
  "Mesas reservation name has a clear button",
);
mustContain(index, 'id="cashObsClearBtn"', "Cash-open obs has a clear button");

// Accent/case-insensitive search: "jamon" should find "jamón" everywhere a
// text search filters a list (products, tickets, parked, tariff customers,
// customer selector).
mustContain(
  renderer,
  "function normalizeSearchText(str) {",
  "Shared accent/case-insensitive search normalizer present",
);
mustContain(
  renderer,
  "const term = normalizeSearchText((searchTerm || \"\").trim());",
  "Product search filter is accent/case-insensitive",
);
mustContain(
  renderer,
  "const q = normalizeSearchText(String(term || \"\").trim());",
  "Parked ticket search is accent/case-insensitive",
);
mustContain(
  renderer,
  "const term = normalizeSearchText((ticketsSearch?.value || \"\").trim());",
  "Tickets search is accent/case-insensitive",
);
mustContain(
  customerSelector,
  "function normalizeCustomerSearchText(str) {",
  "Customer selector has its own accent/case-insensitive normalizer",
);

console.log(
  "\n[SMOKE] Checking 2026-08-12 terminal/agent-switch speed, tickets outside-click, options loading state fixes\n",
);

// Clicking the terminal/agent chips used to wait for a full network refresh
// before showing the switch modal at all, making the button feel dead.
mustContain(
  renderer,
  "const canSwitchNow = Array.isArray(terminals) && terminals.length > 1;",
  "Terminal-name chip opens the switch modal with cached data before refreshing",
);
mustContain(
  renderer,
  "const tryShowAgentSwitchOverlay = () => {",
  "Agent-name chip opens the switch modal with cached data before refreshing",
);
const altSwitchDeferredRefreshCount = (
  renderer.match(/refreshTerminalsAndAgents\(\)\s*\.then\(/g) || []
).length;
if (altSwitchDeferredRefreshCount >= 3) {
  ok("Alt terminal/agent buttons show the modal before refreshing terminals/agents");
} else {
  fail(
    `Alt terminal/agent buttons show the modal before refreshing terminals/agents (found ${altSwitchDeferredRefreshCount}, expected >= 3)`,
  );
}

// Opening the terminal/agent switch modal quickly and closing it before the
// background refresh finished re-opened it on its own a few seconds later.
mustContain(
  renderer,
  "function isTerminalOverlayCurrentlyOpen() {",
  "Terminal overlay has a helper to check if it's still open before a deferred re-show",
);
const deferredReshowGuardCount = (
  renderer.match(/isTerminalOverlayCurrentlyOpen\(\)/g) || []
).length;
if (deferredReshowGuardCount >= 5) {
  ok(
    "Deferred terminal/agent overlay re-shows are guarded against reopening a closed modal",
  );
} else {
  fail(
    `Deferred terminal/agent overlay re-shows are guarded against reopening a closed modal (found ${deferredReshowGuardCount} usages, expected >= 5)`,
  );
}

// The Tickets modal was the one overlay missing the "click outside closes
// it" behavior every other modal already has.
mustContain(
  renderer,
  "if (e.target === ticketsOverlay) {",
  "Tickets modal closes on outside click, consistent with other modals",
);

// The parked-tickets search box had no styling at all (bare browser input),
// unlike the pill-styled main product search.
mustContain(
  styles,
  "#parkedToolbar .tickets-search-wrap {",
  "Parked search box gets the same pill styling as the product search bar",
);

// Options took a visible pause with zero feedback while its ~30 settings
// loaded; now it shows a "cargando" banner and blocks the accordion so a
// click can't race a setting that hasn't loaded yet.
mustContain(
  index,
  'id="optionsLoadingBanner"',
  "Options modal has a loading banner",
);
mustContain(
  styles,
  ".opt-acc.opt-loading {",
  "Options accordion is disabled while settings are loading",
);
mustContain(
  renderer,
  'optionsAccordionEl?.classList.add("opt-loading");',
  "openOptions() disables the accordion while loading",
);
mustContain(
  renderer,
  'optionsAccordionEl?.classList.remove("opt-loading");',
  "openOptions() re-enables the accordion once loading finishes",
);

console.log(
  "\n[SMOKE] Checking 2026-08-12 Options reorg (Mesas section, gating, section previews)\n",
);

// Mesas-specific settings (family rules, auto-comanda) used to be scattered
// across Productos/Impresora with no way to hide them from clients who
// don't have Mesas mode contracted. Now they live in their own section.
mustContain(
  index,
  'data-sec="mesas"',
  "Dedicated Modo Mesas options section exists",
);
mustContain(
  index,
  "data-mesas-only",
  "data-mesas-only gating attribute is used in the Options HTML",
);

// data-admin-only and data-mesas-only used to be handled by two separate
// functions that both wrote el.style.display directly, so an element with
// both attributes (the new Mesas section) would have one gate silently
// overwrite the other's decision.
mustContain(
  renderer,
  '"[data-admin-only], [data-mesas-only]"',
  "Admin-only and Mesas-only visibility are computed together for elements with both attributes",
);
mustContain(
  renderer,
  "const shouldShow = (!needsAdmin || isAdmin) && (!needsMesas || mesasEnabled);",
  "Combined admin/mesas visibility check present",
);

// "Permitir cerrar con aparcados" moved out of Productos into Cierre de Caja.
mustContain(
  index,
  'data-sec="cierre-caja" data-admin-only>',
  "Cierre de Caja section header intact after reorg",
);
mustContain(
  index,
  "Permitir cerrar con aparcados",
  "'Permitir cerrar con aparcados' row still present after moving sections",
);

// Each Options accordion section now shows a short preview of its contents
// while collapsed, so users don't have to open every section to see what's
// inside.
const optSecPreviewCount = (
  index.match(/class="opt-sec-preview"/g) || []
).length;
if (optSecPreviewCount >= 13) {
  ok(`All Options sections have a collapsed preview (${optSecPreviewCount} found)`);
} else {
  fail(
    `All Options sections have a collapsed preview (found ${optSecPreviewCount}, expected >= 13)`,
  );
}
mustContain(
  styles,
  ".opt-sec-preview {",
  "Options section preview has its own CSS style",
);
mustContain(
  styles,
  '.opt-sec[data-open="1"] .opt-sec-preview {',
  "Options section preview hides itself once the section is expanded",
);

// Clicking the collapsed-section preview text did nothing, since the click
// handler only recognized clicks on the header button itself.
mustContain(
  renderer,
  "#optionsAccordion .opt-sec-h, #optionsAccordion .opt-sec-preview",
  "Clicking the section preview text also opens/closes the section",
);

// The Mesas section needed a visual tag besides ADMIN so it's clearly
// distinguishable from the other admin-only sections.
mustContain(
  index,
  'class="opt-mesas-pill">MESAS</span>',
  "Modo Mesas section has its own MESAS tag",
);
mustContain(
  styles,
  ".opt-mesas-pill {",
  "MESAS tag has its own CSS style",
);

// Preview-list items that map to a real toggle turn green when that toggle
// is on, read live from the checkbox's own .checked state (never a
// separate variable that could drift out of sync).
mustContain(
  renderer,
  "function syncOptionsPreviewItemStates() {",
  "Preview-item green-highlight sync function present",
);
mustContain(
  renderer,
  'span.classList.toggle("is-on", !!input?.checked);',
  "Preview items are colored from the checkbox's live .checked state",
);
mustContain(
  renderer,
  "syncOptionsPreviewItemStates();",
  "openOptions() syncs preview item colors after settings load",
);
mustContain(
  styles,
  ".opt-preview-item.is-on {",
  "Preview item 'on' color style present",
);
const previewItemSpanCount = (
  index.match(/class="opt-preview-item"/g) || []
).length;
if (previewItemSpanCount >= 15) {
  ok(`Multiple options sections have colorable preview items (${previewItemSpanCount} found)`);
} else {
  fail(
    `Multiple options sections have colorable preview items (found ${previewItemSpanCount}, expected >= 15)`,
  );
}

// Changing the update-check frequency (or enabling the toggle) always
// restarted the monitor with the fixed 5-minute boot grace period, so the
// countdown showed "~5 min" right after picking any frequency, no matter
// which one, until that first window happened to elapse.
mustContain(
  renderer,
  "function startBackgroundUpdateMonitor({ useFirstDelay = true } = {}) {",
  "Background update monitor accepts a useFirstDelay flag",
);
const noFirstDelayRestartCount = (
  renderer.match(/startBackgroundUpdateMonitor\(\{ useFirstDelay: false \}\)/g) ||
  []
).length;
if (noFirstDelayRestartCount >= 2) {
  ok(
    `Manual enable/frequency-change restarts skip the 5-minute boot delay (${noFirstDelayRestartCount} call sites)`,
  );
} else {
  fail(
    `Manual enable/frequency-change restarts skip the 5-minute boot delay (found ${noFirstDelayRestartCount}, expected >= 2)`,
  );
}

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
