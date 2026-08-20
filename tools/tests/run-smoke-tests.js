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

// The 3 terminal-presence API calls used a bare fetch() with no timeout. A
// hung request (flaky network) left __terminalPresenceInFlight stuck true
// forever (only released in the finally block once the request settles),
// silently disabling all future heartbeats for that session.
mustContain(
  renderer,
  "async function apiUpsertTerminalPresenceRemote",
  "apiUpsertTerminalPresenceRemote present",
);
[
  "apiUpsertTerminalPresenceRemote",
  "apiListTerminalPresenceRemote",
  "apiClearTerminalPresenceRemote",
].forEach((fnName) => {
  const fnStart = renderer.indexOf(`async function ${fnName}(`);
  const fnBody =
    fnStart >= 0 ? renderer.slice(fnStart, fnStart + 1500) : "";
  const fnEnd = fnBody.indexOf("\n}\n");
  const scoped = fnEnd >= 0 ? fnBody.slice(0, fnEnd) : fnBody;

  if (fnStart < 0) {
    fail(`${fnName} not found`);
  } else if (
    scoped.includes("await fetchWithTimeout(url") &&
    !/[^.]\bawait fetch\(url/.test(scoped)
  ) {
    ok(`${fnName} uses fetchWithTimeout instead of bare fetch`);
  } else {
    fail(`${fnName} uses fetchWithTimeout instead of bare fetch`);
  }
});

// The delete-parked-reservation payload never included which terminal
// issued the delete, so the audit log couldn't be filtered/traced by
// terminal for that action like every other parked-reservation action.
mustContain(
  renderer,
  'terminalId: String(currentTerminal?.id || ""),',
  "Delete-parked-reservation payload now includes terminalId for the audit log",
);

// The real bug behind "only ever one heartbeat per session": the interval
// wrapper pre-set __terminalPresenceInFlight before calling
// checkTerminalPresenceOnce(), which has that exact same guard internally —
// so every tick after the first saw "already in flight" and skipped without
// ever sending a heartbeat. fetchWithTimeout alone could not fix this.
{
  const fnStart = renderer.indexOf("function startTerminalPresenceMonitor(");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 900) : "";
  const fnEnd = fnBody.indexOf("\n}\n");
  const scoped = fnEnd >= 0 ? fnBody.slice(0, fnEnd) : fnBody;

  if (fnStart < 0) {
    fail("startTerminalPresenceMonitor not found");
  } else if (
    scoped.includes("setInterval(() => {") &&
    !scoped.includes("__terminalPresenceInFlight = true;")
  ) {
    ok(
      "startTerminalPresenceMonitor's interval no longer double-sets the in-flight guard",
    );
  } else {
    fail(
      "startTerminalPresenceMonitor's interval no longer double-sets the in-flight guard",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-13 double-charge (cobrado pero no descontado) fix\n",
);

// createTicketInFacturaScripts used to throw immediately on an ambiguous
// FacturaScripts response (5xx, or a 200 with an empty/unparseable body)
// without checking whether the invoice had actually been created server-side.
// That left the ticket "unpaid" in the TPV even when FS had already billed
// it, so it could get charged again on another terminal. Fixed by checking
// for an existing factura by numero2 (the same dedup already used for
// offline-queue retries) before giving up.
{
  const fnStart = renderer.indexOf(
    "async function createTicketInFacturaScripts(",
  );
  const fnEnd = renderer.indexOf(
    "\nfunction buildTicketPrintData(",
    fnStart,
  );
  const scoped =
    fnStart >= 0 && fnEnd > fnStart ? renderer.slice(fnStart, fnEnd) : "";

  if (fnStart < 0 || fnEnd < 0) {
    fail("createTicketInFacturaScripts not found");
  } else if (
    scoped.includes("const tryRecoverExistingFactura = async () =>") &&
    scoped.includes("submit.res.status >= 500") &&
    (scoped.match(/return \{ doc: recovered, dedup: true, recovered: true \};/g) || [])
      .length === 2
  ) {
    ok(
      "createTicketInFacturaScripts reconciles by numero2 before failing on an ambiguous response",
    );
  } else {
    fail(
      "createTicketInFacturaScripts reconciles by numero2 before failing on an ambiguous response",
    );
  }
}

// The caller used to fall through into the ONLINE success block on ANY
// non-network failure (sendResult.ok===false, queued===false), unconditionally
// setting saleCommitted=true and masking the real error behind a generic
// E_COBRO_RESP_INVALIDA. That skipped the cart-restore-on-failure logic and
// left genuinely-failed sales looking "committed". Fixed by handling that
// case explicitly, before saleCommitted is touched.
{
  const failMarker = "// ========= FALLO (no offline/encolado, tampoco éxito) =========";
  const onlineMarker = "// ========= ONLINE =========";
  const failStart = renderer.indexOf(failMarker);
  const onlineStart = renderer.indexOf(onlineMarker, failStart);
  const scoped =
    failStart >= 0 && onlineStart > failStart
      ? renderer.slice(failStart, onlineStart)
      : "";

  if (failStart < 0 || onlineStart < 0) {
    fail("Cobro sendResult-handling block not found");
  } else if (
    scoped.includes("if (!sendResult.ok) {") &&
    scoped.includes(
      'sendResult.error || "No se pudo crear la venta en FacturaScripts."',
    ) &&
    !scoped.includes("saleCommitted = true;")
  ) {
    ok(
      "Cobro flow throws the real sendOrQueueFactura error instead of masking non-network failures as E_COBRO_RESP_INVALIDA",
    );
  } else {
    fail(
      "Cobro flow throws the real sendOrQueueFactura error instead of masking non-network failures as E_COBRO_RESP_INVALIDA",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-13 virtual keyboard toggle + parked-customer-reset setting\n",
);

// Feedback de cliente: TPV con teclado fisico conectado no debia abrir el
// teclado tactil al tocar un campo. Nuevo toggle en Opciones -> Pantalla.
mustContain(
  index,
  'id="virtualKeyboardToggle"',
  "Virtual keyboard toggle checkbox present in Options HTML",
);
mustContain(
  index,
  'data-toggle-id="virtualKeyboardToggle"',
  "Virtual keyboard toggle wired into its section preview (green-highlight sync)",
);

{
  const fnStart = renderer.indexOf("function openQwertyForInput(");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 400) : "";

  if (fnStart < 0) {
    fail("openQwertyForInput not found");
  } else if (
    fnBody.includes("if (!virtualKeyboardEnabled) {") &&
    fnBody.includes("inputEl?.focus?.();")
  ) {
    ok(
      "openQwertyForInput skips the overlay and focuses the real input when the virtual keyboard is disabled",
    );
  } else {
    fail(
      "openQwertyForInput skips the overlay and focuses the real input when the virtual keyboard is disabled",
    );
  }
}

mustContain(
  renderer,
  "bindVirtualKeyboardToggleOnce();",
  "openOptions() binds the virtual keyboard toggle",
);
mustContain(
  renderer,
  "await loadVirtualKeyboardToggle();",
  "openOptions() loads the virtual keyboard toggle",
);

// Feedback de cliente: al guardar un aparcado con un cliente distinto al
// que habia antes de abrirlo, el selector volvia siempre a "el de antes"
// aunque se hubiera elegido y guardado otro cliente explicitamente. Nuevo
// select en Opciones -> Carrito para elegir "cliente anterior" vs "por
// defecto".
mustContain(
  index,
  'id="parkedCustomerResetModeSelect"',
  "Parked-customer-reset-mode select present in Options HTML",
);
mustContain(
  index,
  '<option value="default">Al cliente por defecto</option>',
  "Parked-customer-reset-mode select has a 'default customer' option",
);

{
  const fnStart = renderer.indexOf("function restorePreParkedCustomerSelection(");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 500) : "";

  if (fnStart < 0) {
    fail("restorePreParkedCustomerSelection not found");
  } else if (
    fnBody.includes('parkedCustomerResetMode === "default"') &&
    fnBody.includes("window.CUSTOMER_SELECTOR?.resetToDefault?.();")
  ) {
    ok(
      "restorePreParkedCustomerSelection resets to the default customer when that mode is selected, instead of always restoring the previous customer",
    );
  } else {
    fail(
      "restorePreParkedCustomerSelection resets to the default customer when that mode is selected, instead of always restoring the previous customer",
    );
  }
}

mustContain(
  renderer,
  "bindParkedCustomerResetModeOnce();",
  "openOptions() binds the parked-customer-reset-mode select",
);
mustContain(
  renderer,
  "await loadParkedCustomerResetModeSetting();",
  "openOptions() loads the parked-customer-reset-mode select",
);

console.log(
  "\n[SMOKE] Checking 2026-08-13 parked-customer-reset actually wired into park/exit flow\n",
);

// The Options setting above did nothing on its own: neither the explicit
// "Aparcar" action nor "Salir" ever called the restore function, and a
// brand-new (never-reopened) ticket had no "previous customer" snapshot to
// restore in the first place. These checks make sure the wiring is real.

{
  const fnStart = renderer.indexOf("async function addToCart(");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 1200) : "";

  if (fnStart < 0) {
    fail("addToCart not found");
  } else if (
    fnBody.includes("currentParkedTicketIndex == null") &&
    fnBody.includes("!preParkedCustomerSelection") &&
    fnBody.includes("captureCurrentCustomerSelectionForParked()")
  ) {
    ok(
      "addToCart captures the customer selected before starting a brand-new (non-reopened) ticket",
    );
  } else {
    fail(
      "addToCart captures the customer selected before starting a brand-new (non-reopened) ticket",
    );
  }
}

{
  const fnStart = renderer.indexOf("async function parkCurrentCart(");
  const fnEnd = renderer.indexOf(
    "\nfunction apiDeletePresupuesto(",
    fnStart,
  );
  const scoped =
    fnStart >= 0 && fnEnd > fnStart ? renderer.slice(fnStart, fnEnd) : "";

  if (fnStart < 0 || fnEnd < 0) {
    fail("parkCurrentCart not found");
  } else if (
    (scoped.match(/restorePreParkedCustomerSelection\(\);/g) || []).length ===
    2
  ) {
    ok(
      "parkCurrentCart resets the customer selector (per the configured mode) after clearing the cart, both when creating a new ticket and when updating an existing one",
    );
  } else {
    fail(
      "parkCurrentCart resets the customer selector (per the configured mode) after clearing the cart, both when creating a new ticket and when updating an existing one",
    );
  }
}

{
  const fnStart = renderer.indexOf(
    'const clearBtn = document.getElementById("clearCartBtn");',
  );
  const scoped = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 2000) : "";

  if (fnStart < 0) {
    fail("clearCartBtn handler not found");
  } else if (
    scoped.includes("await flushPendingParkedAutoSaveBeforeModeSwitch()") &&
    scoped.includes("restorePreParkedCustomerSelection();")
  ) {
    ok(
      '"Salir"/"Vaciar" flushes any pending autosave and resets the customer selector before clearing the cart',
    );
  } else {
    fail(
      '"Salir"/"Vaciar" flushes any pending autosave and resets the customer selector before clearing the cart',
    );
  }
}

{
  const fnStart = renderer.indexOf(
    "function hasUnsavedChangesForLoadedParkedTicket(",
  );
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 1200) : "";

  if (fnStart < 0) {
    fail("hasUnsavedChangesForLoadedParkedTicket not found");
  } else if (
    fnBody.includes("getSelectedCustomerCodcliente") &&
    fnBody.includes("currentCod !== savedCod")
  ) {
    ok(
      "hasUnsavedChangesForLoadedParkedTicket detects a customer-only change (not just line/qty edits), so autosave actually persists it",
    );
  } else {
    fail(
      "hasUnsavedChangesForLoadedParkedTicket detects a customer-only change (not just line/qty edits), so autosave actually persists it",
    );
  }
}

{
  const fnStart = renderer.indexOf("await window.CUSTOMER_SELECTOR.mount({");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 700) : "";

  if (fnStart < 0) {
    fail("CUSTOMER_SELECTOR.mount call not found");
  } else if (
    fnBody.includes("scheduleMesasAutoSave?.();") &&
    fnBody.includes("scheduleTpvAutoSave?.();")
  ) {
    ok(
      "Changing the selected customer schedules the parked-ticket autosave, not just cart line edits",
    );
  } else {
    fail(
      "Changing the selected customer schedules the parked-ticket autosave, not just cart line edits",
    );
  }
}

// Feedback de cliente: "Ticket #1786619975110" en la banda de edicion de
// aparcado. Los ids nuevos son epoch ms (Date.now()) para evitar colisiones
// entre TPV, pero el numero corto (displayNo) nunca se enviaba al servidor,
// asi que al recargar el ticket desde otro TPV se perdia y el fallback
// decodificaba mal el id largo, mostrando el numero entero.
mustContain(
  renderer,
  "displayNo: Number(ticket?.displayNo || 0) || null,",
  "apiSaveParkedReservation now sends the short displayNo so it survives a reload from another TPV",
);

{
  const fnStart = renderer.indexOf("function getParkedDisplayNumberFromId(");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 800) : "";

  if (fnStart < 0) {
    fail("getParkedDisplayNumberFromId not found");
  } else if (fnBody.includes('if (id > 999999) return "";')) {
    ok(
      "getParkedDisplayNumberFromId no longer falls back to the raw Date.now()-sized id (would render as a 13-digit ticket number)",
    );
  } else {
    fail(
      "getParkedDisplayNumberFromId no longer falls back to the raw Date.now()-sized id (would render as a 13-digit ticket number)",
    );
  }
}

// Feedback de cliente: saltar de un aparcado cargado a otro (desde la lista,
// o navegando partes de un dividido) pisaba el carrito sin guardar antes lo
// pendiente del que se abandonaba (cliente, cantidades...).
{
  const fnStart = renderer.indexOf("function restoreParkedCartByIndex(");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 700) : "";

  if (fnStart < 0) {
    fail("restoreParkedCartByIndex not found");
  } else if (
    fnBody.includes(
      "currentParkedTicketIndex !== null && currentParkedTicketIndex !== index",
    ) &&
    fnBody.includes("flushLoadedParkedTicketChangesSync();")
  ) {
    ok(
      "restoreParkedCartByIndex flushes the previously-loaded ticket's pending changes before switching to a different one",
    );
  } else {
    fail(
      "restoreParkedCartByIndex flushes the previously-loaded ticket's pending changes before switching to a different one",
    );
  }
}

mustContain(
  renderer,
  "function flushLoadedParkedTicketChangesSync()",
  "flushLoadedParkedTicketChangesSync helper present",
);

console.log("\n[SMOKE] Checking 2026-08-14 on-screen keyboard paste support\n");

// Feedback de cliente: el email de activacion (primer arranque, sin acceso
// a Opciones) se escribe con el teclado en pantalla, que hasta ahora no
// dejaba pegar (ctrl+v ni un boton). Sin poder copiar/pegar, un email largo
// habia que teclearlo entero a mano.
mustContain(
  index,
  'id="qwertyOverlay"',
  "Qwerty overlay still present (sanity check for the rest of this block)",
);
mustContain(
  index,
  'data-key="paste"',
  "On-screen keyboard has a 'Pegar' button",
);

mustContain(
  preload,
  'contextBridge.exposeInMainWorld("TPV_CLIPBOARD"',
  "preload.js exposes a clipboard bridge to the renderer",
);
mustContain(
  preload,
  "clipboard.readText()",
  "TPV_CLIPBOARD reads from the OS clipboard",
);

{
  const fnStart = renderer.indexOf(
    "async function qwertyPasteFromClipboard()",
  );
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 700) : "";

  if (fnStart < 0) {
    fail("qwertyPasteFromClipboard not found");
  } else if (
    fnBody.includes("window.TPV_CLIPBOARD?.readText?.()") &&
    fnBody.includes("qwertyAddChar(text)")
  ) {
    ok(
      "qwertyPasteFromClipboard reads the clipboard and inserts it at the caret",
    );
  } else {
    fail(
      "qwertyPasteFromClipboard reads the clipboard and inserts it at the caret",
    );
  }
}

{
  const idx = renderer.indexOf('key === "paste") {');
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 60) : "";
  if (idx >= 0 && scoped.includes("qwertyPasteFromClipboard();")) {
    ok(
      "On-screen keyboard's click handler wires the 'Pegar' button to the paste helper",
    );
  } else {
    fail(
      "On-screen keyboard's click handler wires the 'Pegar' button to the paste helper",
    );
  }
}

{
  const idx = renderer.indexOf("if (!qwertyVisible) return;");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 300) : "";

  if (idx < 0) {
    fail("Qwerty physical-keyboard keydown handler not found");
  } else if (
    scoped.includes("e.ctrlKey || e.metaKey") &&
    scoped.includes('"v"') &&
    scoped.includes("qwertyPasteFromClipboard();")
  ) {
    ok(
      "Ctrl+V/Cmd+V pastes into the on-screen keyboard instead of typing a literal 'v'",
    );
  } else {
    fail(
      "Ctrl+V/Cmd+V pastes into the on-screen keyboard instead of typing a literal 'v'",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-14 slow cash-close fix (broken multi-id filter + duplicate fetch)\n",
);

// Feedback de cliente: "Cierre de caja" tardaba muchisimo con cajas de
// muchos tickets. Causa real: la API de FacturaScripts no soporta un filtro
// "IN" por querystring — repetir "filter[idfactura]" en lotes de 30 (como se
// hacia antes) no funciona como OR, PHP colapsa las claves repetidas y se
// queda con el ULTIMO valor de cada lote, asi que ~29 de cada 30 facturas
// nunca se encontraban en el prefetch y cada una disparaba una peticion
// individual de mas, en secuencia, dentro del cierre. Con cientos de
// tickets en caja, eso eran cientos de peticiones seguidas.
{
  const fnStart = renderer.indexOf(
    "async function fetchRecibosByFacturasMulti(",
  );
  const fnEnd = renderer.indexOf("\nfunction normalizePayCode(", fnStart);
  const scoped =
    fnStart >= 0 && fnEnd > fnStart ? renderer.slice(fnStart, fnEnd) : "";

  if (fnStart < 0 || fnEnd < 0) {
    fail("fetchRecibosByFacturasMulti not found");
  } else if (
    !scoped.includes("chunk(ids, 30)") &&
    !scoped.includes('append("filter[idfactura]"') &&
    scoped.includes('url.searchParams.set("filter[idfactura]", id)') &&
    scoped.includes("CONCURRENCY")
  ) {
    ok(
      "fetchRecibosByFacturasMulti fetches per-invoice (the only filter FacturaScripts actually honors) concurrently instead of a broken batched OR filter",
    );
  } else {
    fail(
      "fetchRecibosByFacturasMulti fetches per-invoice (the only filter FacturaScripts actually honors) concurrently instead of a broken batched OR filter",
    );
  }
}

{
  const fnStart = renderer.indexOf(
    "async function hydrateCloseTicketStatsForCaja(",
  );
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 650) : "";

  if (fnStart < 0) {
    fail("hydrateCloseTicketStatsForCaja not found");
  } else if (
    fnBody.includes("facturasInput = null") &&
    fnBody.includes("Array.isArray(facturasInput)")
  ) {
    ok(
      "hydrateCloseTicketStatsForCaja can reuse an already-fetched invoice list instead of always re-fetching",
    );
  } else {
    fail(
      "hydrateCloseTicketStatsForCaja can reuse an already-fetched invoice list instead of always re-fetching",
    );
  }
}

mustContain(
  renderer,
  "await hydrateCloseTicketStatsForCaja(cajaId, facturasCajaList);",
  "Cash-close flow passes the already-fetched invoice list into hydrateCloseTicketStatsForCaja instead of triggering a second full fetch",
);

console.log(
  "\n[SMOKE] Checking 2026-08-17 real stock-block-on-checkout + no silent referencia loss\n",
);

// Feedback de cliente: "no permitir vender sin stock" (ventasinstock=0 en
// FacturaScripts) nunca bloqueaba el cobro en el TPV -- item.noStock/
// item.noVenderSinStock no se rellenaban nunca en ningun sitio, asi que el
// aviso era codigo muerto. Encima, cuando FacturaScripts SI rechazaba la
// venta (422 error-calculating-totals) el TPV reintentaba en silencio
// borrando referencia/idproducto de todas las lineas, perdiendo el vinculo
// con el producto para siempre.

mustContain(
  renderer,
  "stockManaged: isFalseFlag(base.nostock)",
  "Variant products carry stockManaged from FacturaScripts' nostock flag",
);
mustContain(
  renderer,
  "allowSellWithoutStock: !isFalseFlag(base.ventasinstock)",
  "Variant products carry allowSellWithoutStock from FacturaScripts' ventasinstock flag",
);
mustContain(
  renderer,
  "stockManaged: isFalseFlag(p.nostock)",
  "Non-variant products carry stockManaged from FacturaScripts' nostock flag",
);
mustContain(
  renderer,
  "allowSellWithoutStock: !isFalseFlag(p.ventasinstock)",
  "Non-variant products carry allowSellWithoutStock from FacturaScripts' ventasinstock flag",
);

{
  const fnStart = renderer.indexOf("async function checkCartStockProblems(cart)");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 1600) : "";

  if (fnStart < 0) {
    fail("checkCartStockProblems not found");
  } else if (
    fnBody.includes("await refreshProductsStockOnly()") &&
    fnBody.includes("if (!product.stockManaged) continue;") &&
    fnBody.includes("if (product.allowSellWithoutStock) continue;") &&
    fnBody.includes("getVisibleStockForProduct(product)")
  ) {
    ok(
      "checkCartStockProblems does a real, fresh check against stockManaged/allowSellWithoutStock/visible stock",
    );
  } else {
    fail(
      "checkCartStockProblems does a real, fresh check against stockManaged/allowSellWithoutStock/visible stock",
    );
  }
}

mustContain(
  renderer,
  "async function setProductVentasInStock(idProducto, enabled)",
  "setProductVentasInStock helper present (for the 'cobrar sin stock' override)",
);
mustContain(
  renderer,
  "await apiWrite(`productos/${idProducto}`, \"PUT\", {",
  "setProductVentasInStock actually PUTs ventasinstock to FacturaScripts",
);
mustContain(
  renderer,
  "ventasinstock: enabled ? 1 : 0,",
  "setProductVentasInStock toggles ventasinstock true/false based on the enabled flag",
);

{
  const fnStart = renderer.indexOf("async function onPayButtonClick()");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 4500) : "";

  if (fnStart < 0) {
    fail("onPayButtonClick not found");
  } else if (
    fnBody.includes("const stockProblems = await checkCartStockProblems(cart);") &&
    fnBody.includes('okButtonText: "Cobrar sin stock"') &&
    fnBody.includes("stockOverrideProductIds = stockProblems.map((w) => w.baseProductId);") &&
    !fnBody.includes("item.noStock && item.noVenderSinStock")
  ) {
    ok(
      "onPayButtonClick blocks checkout on real stock problems and offers a 'cobrar sin stock' override instead of the old dead check",
    );
  } else {
    fail(
      "onPayButtonClick blocks checkout on real stock problems and offers a 'cobrar sin stock' override instead of the old dead check",
    );
  }
}

mustContain(
  renderer,
  "stockOverrideProductIds.map((id) => setProductVentasInStock(id, true))",
  "onPayButtonClick applies the temporary ventasinstock override right before sending the sale",
);
mustContain(
  renderer,
  "stockOverrideProductIds.map((id) => setProductVentasInStock(id, false))",
  "onPayButtonClick's finally block always reverts the temporary ventasinstock override",
);

{
  const fnStart = renderer.indexOf(
    "async function createTicketInFacturaScripts(ticketPayload)",
  );
  const fnEnd = renderer.indexOf("\nfunction buildTicketPrintData(", fnStart);
  const scoped =
    fnStart >= 0 && fnEnd > fnStart ? renderer.slice(fnStart, fnEnd) : "";

  if (fnStart < 0 || fnEnd < 0) {
    fail("createTicketInFacturaScripts not found");
  } else if (
    !scoped.includes("delete next.idproducto;") &&
    !scoped.includes("Reintentando sin idproducto/referencia") &&
    scoped.includes('"error-calculating-totals"')
  ) {
    ok(
      "createTicketInFacturaScripts no longer silently strips idproducto/referencia and retries on the stock 422 -- it surfaces the error instead",
    );
  } else {
    fail(
      "createTicketInFacturaScripts no longer silently strips idproducto/referencia and retries on the stock 422 -- it surfaces the error instead",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-17 cart locked while parking is in progress\n",
);

// Feedback de cliente: mientras se guardaba un aparcado (varios awaits:
// confirmar stock, crear presupuesto, guardar reserva remota...) se podia
// seguir tocando productos y editando/borrando lineas del carrito sin
// ningun aviso; esos cambios nunca se aplicaban al aparcado en curso, solo
// confundian al personal.

mustContain(
  index,
  'id="productsGridWrap"',
  "Products grid has a wrapper for the parking overlay",
);
mustContain(
  index,
  'id="productsGridParkingOverlay"',
  "Parking overlay element present over the products grid",
);
mustContain(index, "Aparcando...", "Parking overlay shows a clear label");

mustContain(
  renderer,
  "function refreshProductsGridParkingOverlay()",
  "refreshProductsGridParkingOverlay helper present",
);
mustContain(
  renderer,
  'overlay.classList.toggle("hidden", !isParkingNow);',
  "The parking overlay is shown/hidden based on isParkingNow",
);
{
  const idx = renderer.indexOf("function refreshParkButtonUI()");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 150) : "";
  if (
    scoped.includes("refreshProductsGridParkingOverlay();") &&
    scoped.includes("if (!parkBtn) return;")
  ) {
    ok(
      "refreshParkButtonUI refreshes the parking overlay every time it runs (both when parking starts and finishes)",
    );
  } else {
    fail(
      "refreshParkButtonUI refreshes the parking overlay every time it runs (both when parking starts and finishes)",
    );
  }
}

{
  const fnStart = renderer.indexOf("function getCartEditLockReason()");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 500) : "";

  if (fnStart < 0) {
    fail("getCartEditLockReason not found (rename from getMesasCartEditLockReason?)");
  } else if (
    fnBody.includes("if (isParkingNow) {") &&
    fnBody.includes("Aparcando... espera a que termine para seguir.")
  ) {
    ok(
      "getCartEditLockReason blocks adding/editing cart lines while a park save is in progress",
    );
  } else {
    fail(
      "getCartEditLockReason blocks adding/editing cart lines while a park save is in progress",
    );
  }
}

// El propio addToCart/updateCartItemQuantity/previewCartItemQuantity ya
// llamaban a esta funcion (antes solo para el bloqueo de Mesas); al
// extenderla y renombrarla, esas mismas llamadas ya bloquean durante el
// guardado sin tocar cada sitio por separado. Ningun sitio deberia seguir
// usando el nombre viejo.
if (!renderer.includes("getMesasCartEditLockReason")) {
  ok("No leftover references to the old getMesasCartEditLockReason name");
} else {
  fail("No leftover references to the old getMesasCartEditLockReason name");
}

console.log(
  "\n[SMOKE] Checking 2026-08-17 cash-close print log toggle loaded at boot\n",
);

// Feedback de cliente: el ticket de cierre de caja imprimia el registro de
// avisos aunque lo tuvieran desactivado en Ajustes. Causa: printCajaAutoLogEnabled
// (y printCajaDrawerOpenLogsEnabled) solo se cargaban desde la config guardada
// dentro de openOptions() -- si el TPV se reiniciaba y nadie abria Opciones
// ese dia antes de cerrar caja, la variable se quedaba en su valor por
// defecto (true) toda la sesion, ignorando el ajuste guardado.

{
  const idx = renderer.indexOf("async function runBootFlow()");
  const endIdx = idx >= 0 ? renderer.indexOf("await loadDataFromApi();", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("await loadPrintCajaAutoLogToggle?.();") &&
    scoped.includes("await loadPrintCajaDrawerOpenLogsToggle?.();")
  ) {
    ok(
      "runBootFlow loads the cash-close print log toggles at boot, not only when Options is opened",
    );
  } else {
    fail(
      "runBootFlow loads the cash-close print log toggles at boot, not only when Options is opened",
    );
  }

  // Mismo patron de bug, encontrado al auditar el resto de Opciones tras el
  // caso anterior: cualquier ajuste cuya funcion loadXxx() solo se llamaba
  // dentro de openOptions() se queda en su valor por defecto (ignorando lo
  // guardado) si el TPV arranca y nadie abre Opciones ese dia. El caso de
  // "modo entrenamiento seguro" es el mas grave: su variable gobierna
  // shouldBlockRemoteWrites(), asi que si no se carga a tiempo, un TPV
  // pensado para practicar sin tocar datos reales podria acabar escribiendo
  // en la FacturaScripts real sin que nadie se diera cuenta.
  if (
    scoped.includes("await loadVirtualKeyboardToggle?.();") &&
    scoped.includes("await loadParkedCustomerResetModeSetting?.();") &&
    scoped.includes("await loadSafeTrainingModeToggle?.();")
  ) {
    ok(
      "runBootFlow also loads the virtual-keyboard, parked-customer-reset and safe-training-mode settings at boot",
    );
  } else {
    fail(
      "runBootFlow also loads the virtual-keyboard, parked-customer-reset and safe-training-mode settings at boot",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-17 cash-close waits for totals/methods/agents to load before closing\n",
);

// Feedback de cliente: el ticket de cierre de caja a veces salia sin las
// cajas de importes (total ventas, pagos, ventas por agente). Esos datos se
// cargan en segundo plano al abrir el dialogo de "Cerrar caja" (fetch de
// facturas/recibos de la caja, puede tardar en cajas grandes) sin bloquear
// el boton -- si se pulsaba "Cerrar caja" antes de que terminase, se
// imprimia/cerraba con cashSession.paymentsByMethod/agentSalesSummary aun
// vacios. El registro de avisos, en cambio, viene de un fetch aparte y mas
// rapido (la caja remota), por eso siempre salia completo aunque el resto no.

{
  const idx = renderer.indexOf("function openCashOpenDialog(mode");
  const endIdx = idx >= 0 ? renderer.indexOf("cashOpenOverlay.classList.remove", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("cashCloseSummaryLoading = true;") &&
    scoped.includes("cashCloseSummaryReadyPromise = (async () => {") &&
    scoped.includes("cashCloseSummaryLoading = false;")
  ) {
    ok(
      "openCashOpenDialog tracks when the close-summary background load is in flight",
    );
  } else {
    fail(
      "openCashOpenDialog tracks when the close-summary background load is in flight",
    );
  }

  if (
    scoped.includes('cashOpenOkBtn.textContent = "Cargando...";') &&
    /cashOpenOkBtn\.disabled = true;\s*\n\s*cashOpenOkBtn\.textContent = "Cargando\.\.\."/.test(
      scoped,
    ) &&
    /cashOpenOkBtn\.disabled = false;\s*\n\s*cashOpenOkBtn\.textContent = "Cerrar caja";/.test(
      scoped,
    )
  ) {
    ok(
      "'Cerrar caja' button turns into a disabled 'Cargando...' state while the close summary loads, and restores itself when done",
    );
  } else {
    fail(
      "'Cerrar caja' button turns into a disabled 'Cargando...' state while the close summary loads, and restores itself when done",
    );
  }
}

{
  const idx = renderer.indexOf('cashOpenOkBtn.onclick = async () => {');
  const endIdx = idx >= 0 ? renderer.indexOf("const parkedCountGlobal", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("if (cashCloseSummaryLoading) {") &&
    scoped.includes("await cashCloseSummaryReadyPromise.catch(() => {});")
  ) {
    ok(
      "Clicking 'Cerrar caja' waits for the close-summary background load to finish before proceeding",
    );
  } else {
    fail(
      "Clicking 'Cerrar caja' waits for the close-summary background load to finish before proceeding",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-18 post-update install splash (Windows)\n",
);

// Peticion de cliente: durante la instalacion silenciosa de una actualizacion
// (NSIS con /S), Windows no da ningun progreso real -- el icono del
// escritorio se queda en blanco un instante y la app se reabre sola sin
// ningun aviso visible. Se añade un proceso ligero e independiente
// (main.js --post-update-splash) que se lanza justo antes de quitAndInstall
// y se queda con un aviso "Instalando..." hasta que la nueva version avisa de
// que ya se ve (o hasta un tope de 30s de seguridad).

mustContain(
  main,
  'process.argv.includes("--post-update-splash")',
  "main.js detects the --post-update-splash flag",
);
{
  const idx = main.indexOf("const IS_POST_UPDATE_SPLASH");
  const scoped = idx >= 0 ? main.slice(idx, idx + 250) : "";
  if (
    scoped.includes("runPostUpdateSplashProcess();") &&
    scoped.includes("return;")
  ) {
    ok(
      "The post-update-splash process short-circuits before the rest of main.js runs (single-instance lock, normal boot, etc.)",
    );
  } else {
    fail(
      "The post-update-splash process short-circuits before the rest of main.js runs (single-instance lock, normal boot, etc.)",
    );
  }
}

mustContain(
  main,
  "function spawnPostUpdateSplash()",
  "spawnPostUpdateSplash helper present",
);
mustContain(
  main,
  "function notifyPostUpdateSplashReady()",
  "notifyPostUpdateSplashReady helper present",
);
mustContain(
  main,
  "function runPostUpdateSplashProcess()",
  "runPostUpdateSplashProcess helper present",
);

{
  const count = (main.match(/spawnPostUpdateSplash\(\);/g) || []).length;
  if (count === 2) {
    ok("spawnPostUpdateSplash() is called at both quitAndInstall call sites");
  } else {
    fail(
      `spawnPostUpdateSplash() is called at both quitAndInstall call sites (found ${count} call(s), expected 2)`,
    );
  }
}

{
  // Verificado a mano lanzando el splash + una instancia normal a la vez:
  // sin este userData propio, la app real que arranca justo despues de
  // instalarse podria confundirse con el candado de instancia unica del
  // splash y no abrir su propia ventana -- justo el fallo que preocupaba al
  // cliente ("no puede haber 2 instancias a la vez").
  const idx = main.indexOf("function runPostUpdateSplashProcess()");
  const endIdx = idx >= 0 ? main.indexOf("app.whenReady().then(() => {", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? main.slice(idx, endIdx) : "";
  if (
    scoped.includes('app.setPath(') &&
    scoped.includes('"tpv-recipok-post-update-splash"')
  ) {
    ok(
      "The post-update splash uses its own isolated userData profile, so it can never be mistaken for the real app's single-instance lock",
    );
  } else {
    fail(
      "The post-update splash uses its own isolated userData profile, so it can never be mistaken for the real app's single-instance lock",
    );
  }
}

{
  const found = /mainWin\.show\(\);\s*\n\s*notifyPostUpdateSplashReady\(\);/.test(
    main,
  );
  if (found) {
    ok(
      "notifyPostUpdateSplashReady() runs right when the main window is shown, so the splash closes as soon as the real window appears",
    );
  } else {
    fail(
      "notifyPostUpdateSplashReady() runs right when the main window is shown, so the splash closes as soon as the real window appears",
    );
  }
}

{
  const idx = main.indexOf("function runPostUpdateSplashProcess()");
  const endIdx = idx >= 0 ? main.indexOf("win.removeMenu();", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? main.slice(idx, endIdx) : "";
  // Feedback de cliente tras probarlo: con alwaysOnTop se ponia delante de
  // CUALQUIER otra ventana sin dejar trabajar con nada mas; sin taskbar no
  // habia forma de recuperarla si quedaba detras de otra ventana. Buscamos
  // las propiedades puestas a true, no solo el nombre (que sigue apareciendo
  // en los comentarios que explican por que no se usan).
  if (
    !/alwaysOnTop\s*:\s*true/.test(scoped) &&
    !/skipTaskbar\s*:\s*true/.test(scoped)
  ) {
    ok(
      "Post-update splash window is not alwaysOnTop and keeps its taskbar entry, so it doesn't hog the screen but can still be brought back",
    );
  } else {
    fail(
      "Post-update splash window is not alwaysOnTop and keeps its taskbar entry, so it doesn't hog the screen but can still be brought back",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-18 quick discount percent buttons\n",
);

// Peticion de cliente: en el teclado numerico de descuentos, poder pulsar un
// boton en vez de teclear a mano los porcentajes redondos mas habituales.
// Ahora configurable en Opciones -> Carrito (hasta 5, por defecto 10/20/50/100).
// Solo debe verse en los teclados de descuento (linea y general del
// carrito), no en cantidad/precio/caja/stock.

mustContain(
  index,
  'id="numPadQuickPercents"',
  "Quick-percent buttons row present in the numpad overlay (filled dynamically by JS)",
);
mustContain(
  renderer,
  "const numPadQuickPercentsEl",
  "numPadQuickPercentsEl reference present",
);
mustContain(
  renderer,
  "function renderNumPadQuickPercents(show)",
  "renderNumPadQuickPercents helper present (builds the buttons from discountQuickPercents)",
);
{
  const idx = renderer.indexOf("function renderNumPadQuickPercents(show)");
  const endIdx = idx >= 0 ? renderer.indexOf("function openNumPad(", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("!show || !discountQuickPercents.length") &&
    scoped.includes('data-pct="${pct}"')
  ) {
    ok(
      "renderNumPadQuickPercents hides the row when not requested or when the configured list is empty, otherwise builds one button per configured percent",
    );
  } else {
    fail(
      "renderNumPadQuickPercents hides the row when not requested or when the configured list is empty, otherwise builds one button per configured percent",
    );
  }
}
{
  const idx = renderer.indexOf("function openNumPad(");
  const endIdx = idx >= 0 ? renderer.indexOf("updateNumPadDisplay();", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (scoped.includes("renderNumPadQuickPercents(!!opts.showQuickPercents);")) {
    ok(
      "openNumPad only shows the quick-percent row when explicitly requested (showQuickPercents), hidden by default for qty/price/cash/stock",
    );
  } else {
    fail(
      "openNumPad only shows the quick-percent row when explicitly requested (showQuickPercents), hidden by default for qty/price/cash/stock",
    );
  }
}

// Configuracion en Opciones -> Carrito
mustContain(
  index,
  'id="discountQuickPct1"',
  "5 quick-percent config inputs present in Options -> Carrito (checking field 1)",
);
mustContain(index, 'id="discountQuickPct5"', "5th quick-percent config input present");
mustContain(
  index,
  'id="discountQuickPctsSaveBtn"',
  "Save button for the quick-percent config present",
);
mustContain(
  index,
  "accesos rapidos de descuento",
  "Carrito section preview mentions the new quick-discount setting",
);
mustContain(
  renderer,
  "const DISCOUNT_QUICK_PERCENT_SLOTS_DEFAULT = [10, 20, 50, 100, null];",
  "Default quick-percent slots match the previous fixed set (10/20/50/100), so behavior doesn't change until customized",
);
mustContain(
  renderer,
  "const DISCOUNT_QUICK_PERCENTS_MAX = 5;",
  "Quick percents capped at 5 (matches the 5 Options input fields)",
);
mustContain(
  renderer,
  "function sanitizeDiscountQuickPercentSlot(raw)",
  "sanitizeDiscountQuickPercentSlot helper present (a single field's value -> percent or null)",
);
{
  const idx = renderer.indexOf("function sanitizeDiscountQuickPercentSlot(raw)");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 260) : "";
  if (scoped.includes("if (!(n > 0)) return null;")) {
    ok(
      "Feedback de cliente: writing 0 in a quick-percent field is treated the same as leaving it blank (no button for that slot)",
    );
  } else {
    fail(
      "Feedback de cliente: writing 0 in a quick-percent field is treated the same as leaving it blank (no button for that slot)",
    );
  }
}
mustContain(
  renderer,
  "function computeActiveDiscountQuickPercents(slots)",
  "computeActiveDiscountQuickPercents helper present (compacts/dedupes for the numpad buttons WITHOUT touching the Options fields)",
);
mustContain(
  renderer,
  "async function loadDiscountQuickPercentsSetting()",
  "loadDiscountQuickPercentsSetting helper present",
);
mustContain(
  renderer,
  "async function saveDiscountQuickPercentsSetting()",
  "saveDiscountQuickPercentsSetting helper present",
);
{
  // Feedback de cliente: al borrar un campo y guardar, los demas se movian
  // (se compactaban hacia la izquierda) -- cada campo debe conservar su
  // propio valor y posicion siempre, solo la lista de botones del teclado
  // (discountQuickPercents) se compacta, nunca los inputs de Opciones.
  const idx = renderer.indexOf("async function saveDiscountQuickPercentsSetting()");
  const endIdx = idx >= 0 ? renderer.indexOf("try {", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("slots.push(sanitizeDiscountQuickPercentSlot(el?.value));") &&
    scoped.includes("fillDiscountQuickPercentInputs(slots);") &&
    !scoped.includes(".filter(")
  ) {
    ok(
      "saveDiscountQuickPercentsSetting refills each field with its OWN slot value -- it never reorders/compacts the 5 Options input fields",
    );
  } else {
    fail(
      "saveDiscountQuickPercentsSetting refills each field with its OWN slot value -- it never reorders/compacts the 5 Options input fields",
    );
  }
}

// Feedback de cliente: los 5 campos son type="number" pero no abrian ningun
// teclado en pantalla al tocarlos (ni con el teclado virtual activado).
mustContain(
  renderer,
  "function openNumPadForDiscountQuickPctInput(inputEl)",
  "openNumPadForDiscountQuickPctInput helper present (opens the numeric numpad for a single quick-percent field)",
);
{
  const idx = renderer.indexOf("function bindDiscountQuickPctsSaveOnce()");
  const endIdx = idx >= 0 ? renderer.indexOf("\n}", renderer.indexOf("for (let i = 0", idx)) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes('el.addEventListener("focus", () => openNumPadForDiscountQuickPctInput(el));') &&
    scoped.includes('el.addEventListener("click", () => openNumPadForDiscountQuickPctInput(el));')
  ) {
    ok(
      "bindDiscountQuickPctsSaveOnce wires all 5 quick-percent inputs to open the numeric numpad on focus/click",
    );
  } else {
    fail(
      "bindDiscountQuickPctsSaveOnce wires all 5 quick-percent inputs to open the numeric numpad on focus/click",
    );
  }
}
{
  // Mismo bug que ya corregimos para otros ajustes en esta sesion: si esto
  // solo se carga dentro de openOptions(), quedarse en el default hasta que
  // alguien abra Opciones una vez, ignorando lo guardado.
  const idx = renderer.indexOf("async function runBootFlow()");
  const endIdx = idx >= 0 ? renderer.indexOf("await loadDataFromApi();", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (scoped.includes("await loadDiscountQuickPercentsSetting?.();")) {
    ok(
      "runBootFlow loads the quick-discount-percents setting at boot, not only when Options is opened",
    );
  } else {
    fail(
      "runBootFlow loads the quick-discount-percents setting at boot, not only when Options is opened",
    );
  }
}

{
  // Actualizado 2026-08-20 (ver bloque de mas abajo): un boton rapido ahora
  // confirma de una en vez de dejar el valor a medio meter esperando "OK" --
  // ver el "Checking 2026-08-20 quick-percent buttons auto-confirm..." para
  // la prueba completa de ese cambio. Aqui solo comprobamos que sigue
  // rellenando el valor antes de confirmar.
  const idx = renderer.indexOf('const pctBtn = e.target.closest("[data-pct]");');
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 700) : "";
  if (
    idx >= 0 &&
    scoped.includes("numPadCurrentValue = pctBtn.getAttribute") &&
    scoped.includes("updateNumPadDisplay();")
  ) {
    ok("Tapping a quick-percent button fills the numpad value before confirming it");
  } else {
    fail("Tapping a quick-percent button fills the numpad value before confirming it");
  }
}

{
  const count = (
    renderer.match(/\.\.\.DISCOUNT_QUICK_PERCENTS_OPTS/g) || []
  ).length;
  if (count === 2) {
    ok(
      "Both the line-discount and cart-global-discount numpads opt into the quick-percent buttons",
    );
  } else {
    fail(
      `Both the line-discount and cart-global-discount numpads opt into the quick-percent buttons (found ${count}, expected 2)`,
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-20 quick-percent buttons auto-confirm instead of silently cancelable\n",
);

// Feedback de cliente real (Ben_Trempat): una venta con el cliente "Mermas"
// (que tiene una tarifa del 100% asociada) se cobro a precio normal. Una de
// las causas encontradas: el boton rapido "100%" del teclado de descuento
// solo rellenaba el valor en pantalla sin confirmarlo -- un toque fuera del
// teclado justo despues (habitual al ir a "Cobrar") se interpretaba como
// cancelar y lo descartaba en silencio, sin avisar. Ahora un boton rapido
// aplica el % de una, como una accion completa, no un valor a medio meter.
{
  const idx = renderer.indexOf('const pctBtn = e.target.closest("[data-pct]");');
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 700) : "";
  if (idx >= 0 && scoped.includes("numPadConfirm();")) {
    ok(
      "Tapping a quick-percent button confirms it immediately instead of leaving it cancelable by an outside tap",
    );
  } else {
    fail(
      "Tapping a quick-percent button confirms it immediately instead of leaving it cancelable by an outside tap",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-20 checkout waits for the customer's tariff to resolve\n",
);

// Feedback de cliente real (Ben_Trempat): la otra causa encontrada para el
// mismo caso -- refreshActiveCustomerTariffForSelection() se lanzaba "y ya
// veremos" al elegir cliente, sin esperar la respuesta de FacturaScripts. Si
// el cajero le daba a "Cobrar" rapido tras elegir un cliente con tarifa
// (ej. "Mermas" al 100%), el total se calculaba antes de que la tarifa
// llegara, cobrando al precio normal sin ningun aviso.
mustContain(
  renderer,
  "let activeCustomerTariffReadyPromise = Promise.resolve();",
  "activeCustomerTariffReadyPromise tracker present",
);
{
  const idx = renderer.indexOf("function renderSelectedCustomerInCartHeader(c)");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 600) : "";
  if (
    scoped.includes(
      "activeCustomerTariffReadyPromise = refreshActiveCustomerTariffForSelection(",
    )
  ) {
    ok(
      "renderSelectedCustomerInCartHeader tracks the in-flight tariff-refresh promise instead of firing it and forgetting",
    );
  } else {
    fail(
      "renderSelectedCustomerInCartHeader tracks the in-flight tariff-refresh promise instead of firing it and forgetting",
    );
  }
}
{
  const idx = renderer.indexOf("async function onPayButtonClick()");
  const endIdx = idx >= 0 ? renderer.indexOf("const totalCart = round2(getCartTotal(cart));", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (scoped.includes("await activeCustomerTariffReadyPromise;")) {
    ok(
      "onPayButtonClick waits for any in-flight customer-tariff resolution before computing the total",
    );
  } else {
    fail(
      "onPayButtonClick waits for any in-flight customer-tariff resolution before computing the total",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-20 ticket print quantity column width\n",
);

// Feedback de cliente real (ticket impreso): cantidades con 3 decimales
// (ej. 0,694) se cortaban por falta de espacio en la columna de cantidad,
// mostrando un numero distinto al real sin ningun aviso. Ensanchada de
// 8mm a 14mm via una variable CSS (probado con mockups: 14mm da margen
// incluso para el peor caso realista, cantidad negativa de 2 digitos con
// 3 decimales).
mustContain(
  ticketPrint,
  "--qty-col: 14mm;",
  "Ticket quantity column widened to 14mm",
);
mustContain(
  ticketPrint,
  "grid-template-columns: var(--qty-col) 1fr 20mm;",
  "Item rows and header use the --qty-col variable (both stay in sync)",
);
if (ticketPrint.includes("grid-template-columns: 8mm 1fr 20mm;")) {
  fail("Old 8mm quantity column fully replaced (no leftover reference)");
} else {
  ok("Old 8mm quantity column fully replaced (no leftover reference)");
}

// Feedback de cliente real: la linea de descripcion (.item-sub) siempre
// arrancaba pegada al margen izquierdo (bajo "Cant."), no bajo "Ref." como
// el nombre del producto de arriba. Con 8mm el desajuste apenas se notaba;
// con 14mm quedaba un hueco raro debajo de cantidad+referencia. Indentada
// para alinearse con la columna Ref., y su max-width recalculado para no
// salirse del ticket con el nuevo margen.
mustContain(
  ticketPrint,
  "margin-left: calc(var(--qty-col) + 4px);",
  "item-sub is indented to align with the Ref. column, not flush under Cant.",
);
mustContain(
  ticketPrint,
  "max-width: calc(100% - var(--qty-col) - 4px);",
  "item-sub max-width accounts for its own indent so it can't overflow the ticket",
);

console.log(
  "\n[SMOKE] Checking 2026-08-19 cross-terminal stock lock around reserved stock sync\n",
);

// Feedback de cliente (2 TPV): syncReservedStockDeltaToFS lee el stock real
// de FacturaScripts, calcula el nuevo valor en el propio TPV y lo vuelve a
// escribir -- no es atomico, asi que 2 TPV tocando el mismo producto casi a
// la vez pueden pisarse el ajuste sin que nadie se entere (descuadre real de
// stock). Se añade un candado por producto en la base de datos compartida
// (solo activo para clientes piloto en el servidor) que serializa esa
// seccion critica entre terminales, con fail-open si el servidor compartido
// no responde (no debe bloquear un cobro/aparcado real).

mustContain(
  renderer,
  "async function apiAcquireStockLock(idProducto, ttlSec = 12)",
  "apiAcquireStockLock helper present",
);
mustContain(
  renderer,
  "async function apiReleaseStockLock(idProducto)",
  "apiReleaseStockLock helper present",
);
mustContain(
  renderer,
  "async function acquireStockLockWithRetry(idProducto, attempts = 5)",
  "acquireStockLockWithRetry helper present (retries with backoff if another TPV holds it)",
);

{
  const idx = renderer.indexOf("async function apiAcquireStockLock(idProducto, ttlSec = 12)");
  const endIdx = idx >= 0 ? renderer.indexOf("async function apiReleaseStockLock(idProducto)", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  const failOpenCount = (scoped.match(/\{ acquired: true \}/g) || []).length;
  if (failOpenCount >= 2) {
    ok(
      "apiAcquireStockLock fails open (acquired: true) on any network/API error or non-OK response, so the lock can never block a sale/park by itself",
    );
  } else {
    fail(
      "apiAcquireStockLock fails open (acquired: true) on any network/API error or non-OK response, so the lock can never block a sale/park by itself",
    );
  }
}

{
  const idx = renderer.indexOf("action=acquire-stock-lock");
  const idx2 = renderer.indexOf("action=release-stock-lock");
  if (idx >= 0 && idx2 >= 0) {
    ok("Client calls both the acquire-stock-lock and release-stock-lock shared-API actions");
  } else {
    fail("Client calls both the acquire-stock-lock and release-stock-lock shared-API actions");
  }
}

{
  const idx = renderer.indexOf("async function syncReservedStockDeltaToFS(deltaMap, reason");
  const endIdx = idx >= 0 ? renderer.indexOf("function rebuildRemoteReservedByProductMap()", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("const lockInfo = await acquireStockLockWithRetry(idProd);") &&
    scoped.includes("if (lockInfo?.acquired) {") &&
    scoped.includes("await apiReleaseStockLock(idProd).catch(() => {});")
  ) {
    ok(
      "syncReservedStockDeltaToFS acquires the per-product lock before its read-then-write against FacturaScripts stock, and releases it in a finally block",
    );
  } else {
    fail(
      "syncReservedStockDeltaToFS acquires the per-product lock before its read-then-write against FacturaScripts stock, and releases it in a finally block",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-18 allow 0-euro checkout only for deliberate discounts/price edits\n",
);

// Peticion de cliente: promocion del 100% de descuento (producto o carrito
// entero gratis) no se podia cobrar porque el TPV no dejaba cerrar un cobro
// a 0€. Se permite ahora, pero SOLO si ese 0€ viene de una accion deliberada
// en ese ticket (descuento aplicado o precio editado a mano) -- si una linea
// esta a 0€ "de fabrica" (precio del catalogo sin tocar, ej. un producto mal
// puesto a 0€ por error en FacturaScripts), se sigue bloqueando para que no
// se venda gratis para siempre sin que nadie se de cuenta.

mustContain(
  renderer,
  "function getZeroPricedUnmodifiedLines(cart)",
  "getZeroPricedUnmodifiedLines helper present",
);
{
  const idx = renderer.indexOf("function getZeroPricedUnmodifiedLines(cart)");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 400) : "";
  if (
    scoped.includes("isPackChildLine(item)") &&
    scoped.includes("getOriginalUnitGross(item)")
  ) {
    ok(
      "getZeroPricedUnmodifiedLines checks the untouched catalog price (ignoring discounts/overrides), not the final discounted price",
    );
  } else {
    fail(
      "getZeroPricedUnmodifiedLines checks the untouched catalog price (ignoring discounts/overrides), not the final discounted price",
    );
  }
}

{
  const idx = renderer.indexOf("async function onPayButtonClick()");
  const endIdx = idx >= 0 ? renderer.indexOf("logFeatureInfo(\"COBRO\", \"inicio\"", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("getZeroPricedUnmodifiedLines(cart)") &&
    scoped.includes("precio 0€ de catalogo")
  ) {
    ok(
      "onPayButtonClick blocks checkout on an unmodified 0€ catalog line before opening the pay modal",
    );
  } else {
    fail(
      "onPayButtonClick blocks checkout on an unmodified 0€ catalog line before opening the pay modal",
    );
  }
}

mustContain(
  renderer,
  "Confirmar ticket gratuito",
  "Pay modal shows a distinct 'free ticket' confirmation label for 0€ totals",
);
mustContain(
  renderer,
  'payMethodsList.classList.toggle("pay-frozen", isFreeTicket);',
  "Pay modal freezes the amount inputs when the total is 0€ (nothing to type)",
);
mustContain(
  styles,
  ".pay-frozen",
  "pay-frozen CSS class defined (blocks interaction + dims the amount inputs/keypad)",
);

{
  const idx = renderer.indexOf("paySaveBtn.onclick = () => {");
  const endIdx = idx >= 0 ? renderer.indexOf("const selectedSerie =", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("if (totalC === 0) {") &&
    scoped.includes("importe: 0,") &&
    scoped.includes("entregado: 0,")
  ) {
    ok(
      "Confirming a 0€ ticket skips the 'enter an amount' requirement and builds a 0€ payment entry directly",
    );
  } else {
    fail(
      "Confirming a 0€ ticket skips the 'enter an amount' requirement and builds a 0€ payment entry directly",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-17 paid parked tickets are not dropped by cross-terminal mode mismatch\n",
);

// Feedback de cliente: un aparcado creado en un TPV y cobrado en otro
// desaparecia de "Aparcados cobrados" (y el boton "Sync" no lo arreglaba)
// porque syncParkedTicketsFromRemote descartaba los cobrados confirmados por
// el servidor si no coincidian con el modo (Mesas/TPV) actual del terminal
// que sincronizaba -- un cobro real y confirmado no deberia depender de en
// que modo este el terminal justo en ese instante.

{
  const idx = renderer.indexOf("const remotePaid = normalizedRemote");
  const closeIdx = idx >= 0 ? renderer.indexOf("upsertParkedPaidHistoryMany(remotePaid);", idx) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped &&
    !/return merged;\s*\}\)\s*\.filter\(\(t\) => isTicketInCurrentParkingMode\(t\)\);/.test(
      scoped,
    )
  ) {
    ok(
      "remotePaid (server-confirmed paid tickets) is no longer filtered out by the current terminal's parking mode",
    );
  } else {
    fail(
      "remotePaid (server-confirmed paid tickets) is no longer filtered out by the current terminal's parking mode",
    );
  }
}

{
  const idx = renderer.indexOf("const preservedPaidCandidates = [");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 260) : "";
  if (
    scoped.includes(".filter((t) => !isParkedPaidTombstoned(t));") &&
    !scoped.includes(".filter((t) => isTicketInCurrentParkingMode(t));")
  ) {
    ok(
      "preservedPaidCandidates (locally-known paid tickets) is no longer filtered out by the current terminal's parking mode",
    );
  } else {
    fail(
      "preservedPaidCandidates (locally-known paid tickets) is no longer filtered out by the current terminal's parking mode",
    );
  }
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
