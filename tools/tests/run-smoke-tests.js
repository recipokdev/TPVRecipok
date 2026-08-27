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
const scaleUiPath = ensureFileExists("js/tpv/scale/scale-ui.js");
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
  !scaleUiPath ||
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
const scaleUi = fs.readFileSync(scaleUiPath, "utf8");

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
  "loadVirtualKeyboardToggle(),",
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
  "loadParkedCustomerResetModeSetting(),",
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
  "hydrateCloseTicketStatsForCaja(cajaId, facturasCajaList),",
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
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 1700) : "";

  if (fnStart < 0) {
    fail("checkCartStockProblems not found");
  } else if (
    fnBody.includes("if (!product.stockManaged) continue;") &&
    fnBody.includes("if (product.allowSellWithoutStock) continue;") &&
    fnBody.includes("getVisibleStockForProduct(product)")
  ) {
    ok(
      "checkCartStockProblems checks against stockManaged/allowSellWithoutStock/visible stock",
    );
  } else {
    fail(
      "checkCartStockProblems checks against stockManaged/allowSellWithoutStock/visible stock",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-26 Cobrar opens the payment modal instantly, without an extra blocking stock refetch\n",
);

// Feedback de cliente real (video del cliente): pulsar "Cobrar" tardaba en
// abrir el modal de pago porque checkCartStockProblems forzaba SIEMPRE una
// peticion nueva a FacturaScripts antes de dejarlo aparecer -- aunque el
// stock local ya estuviera fresco de sobra (el ciclo de fondo lo refresca
// cada 10s desde el delta-sync de ayer). Ahora usa directamente el stock ya
// cacheado en local, sin esperar a ninguna peticion de red antes de abrir
// el modal.
{
  const fnStart = renderer.indexOf("async function checkCartStockProblems(cart)");
  const fnBody = fnStart >= 0 ? renderer.slice(fnStart, fnStart + 400) : "";
  if (fnStart >= 0 && !fnBody.includes("refreshProductsStockOnly")) {
    ok(
      "checkCartStockProblems no longer forces a blocking network refetch before Cobrar can open the payment modal",
    );
  } else {
    fail(
      "checkCartStockProblems no longer forces a blocking network refetch before Cobrar can open the payment modal",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-26 the payment modal itself no longer waits on a formas-de-pago refetch every time\n",
);

// Feedback de cliente real, tras probarlo en real: quitar el refresco de
// stock (arriba) no bastaba -- el propio modal de cobro (openPayModal)
// esperaba ADEMAS a pedir las formas de pago (efectivo, tarjeta...) a
// FacturaScripts en CADA cobro, aunque casi nunca cambian. Ahora usa la
// copia ya guardada en cache (si existe) al instante, y la refresca de
// fondo para la proxima vez -- solo la primerisima vez (cache vacia de
// verdad) espera a la red, igual que ya hacia ensurePaySeriesLoaded con
// las series.
{
  const idx = renderer.indexOf("async function openPayModal(total) {");
  const closeIdx = idx >= 0 ? renderer.indexOf("\nasync function ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes("const cachedFormasPago = loadPayMethodsCache();") &&
    scoped.includes("formasPromise = Promise.resolve(cachedFormasPago);") &&
    scoped.includes("fetchFormasPagoActivas().catch(") &&
    scoped.includes("formasPromise = fetchFormasPagoActivas();")
  ) {
    ok(
      "openPayModal uses the cached formas de pago instantly when available, refreshing in the background, and only awaits a real fetch the very first time",
    );
  } else {
    fail(
      "openPayModal uses the cached formas de pago instantly when available, refreshing in the background, and only awaits a real fetch the very first time",
    );
  }
}
mustContain(
  renderer,
  "fetchFormasPagoActivas().catch(() => {});",
  "confirmCashOpening also warms up formas de pago in the background at cash-open, so even the very first payment of the session can be instant",
);
mustContain(
  renderer,
  "ensurePaySeriesLoaded().catch(() => {});",
  "confirmCashOpening also warms up the invoice series list in the background at cash-open",
);

console.log(
  "\n[SMOKE] Checking 2026-08-26 aparcar a customer no longer blocks the cart for the next one\n",
);

// Feedback de cliente real (video del cliente): aparcar un ticket nuevo
// bloqueaba TODO el carrito (isParkingNow) durante dos llamadas de red
// seguidas (crear presupuesto + guardar la reserva) -- si mientras tanto
// llegaba el siguiente cliente, ni se le podia atender, ni siquiera se
// avisaba (un segundo intento de aparcar se cancelaba en silencio). Ahora
// lo local (ticket visible, carrito limpio para el siguiente) se hace ya;
// las llamadas de red siguen en segundo plano, sin retener al operario --
// EXCEPTO para el autoguardado silencioso, que sigue esperando de verdad
// (tiene su propio guardia de solapamiento aparte, ver MESAS/TPV_AUTO_SAVE_IN_FLIGHT).
{
  const fnStart = renderer.indexOf(
    'async function parkCurrentCart(name = "", obs = "", opts = {}) {',
  );
  const fnEnd = renderer.indexOf("\nfunction apiDeletePresupuesto(", fnStart);
  const fnBody = fnStart >= 0 && fnEnd >= 0 ? renderer.slice(fnStart, fnEnd) : "";

  if (
    fnBody.includes("const finishCreateParkedTail = async () => {") &&
    fnBody.includes("const finishUpdateParkedTail = async () => {") &&
    (fnBody.match(/if \(silentAutoSave\) \{\s*await finish/g) || []).length === 2 &&
    fnBody.includes("finishCreateParkedTail().catch(") &&
    fnBody.includes("finishUpdateParkedTail().catch(")
  ) {
    ok(
      "parkCurrentCart finishes its slow network tail in the background for a manual park, but still awaits it fully for silentAutoSave",
    );
  } else {
    fail(
      "parkCurrentCart finishes its slow network tail in the background for a manual park, but still awaits it fully for silentAutoSave",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-26 first sale of a cash session can also print fast, not just the second one\n",
);

// Feedback de cliente real: el primer cobro de cada sesion de caja era mas
// lento de imprimir a proposito (no se fiaba del numero en cache hasta
// confirmar uno real con FacturaScripts). Ahora, al abrir caja, se pregunta
// en segundo plano cual es el ultimo numero real para las 2 series que usa
// este TPV (S y A), asi que el primer cobro tambien puede pre-imprimir
// rapido si eso funciona -- y si falla (sin internet, sin historico), no
// rompe nada, simplemente no acelera ese primer cobro.
mustContain(
  renderer,
  "async function primeFastTicketPredictorOnCashOpen() {",
  "primeFastTicketPredictorOnCashOpen helper exists",
);
{
  const idx = renderer.indexOf(
    "async function primeFastTicketPredictorOnCashOpen() {",
  );
  const closeIdx = idx >= 0 ? renderer.indexOf("\nasync function ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes('for (const codserie of ["S", "A"]) {') &&
    scoped.includes("updateFastTicketNumberByConfirmedCode({") &&
    scoped.includes("if (anyPrimed) markFastTicketPredictorConfirmed();")
  ) {
    ok(
      "primeFastTicketPredictorOnCashOpen warms up both series (S and A) using the same confirmation path a real sale uses, and only marks the session confirmed if at least one succeeded",
    );
  } else {
    fail(
      "primeFastTicketPredictorOnCashOpen warms up both series (S and A) using the same confirmation path a real sale uses, and only marks the session confirmed if at least one succeeded",
    );
  }
}
mustContain(
  renderer,
  "primeFastTicketPredictorOnCashOpen().catch(() => {});",
  "confirmCashOpening triggers the ticket-number warm-up in the background right when the cash session opens",
);

console.log(
  "\n[SMOKE] Checking 2026-08-26 formas de pago/series keep refreshing periodically, not just once\n",
);

// Feedback de cliente real: cachear formas de pago (arriba) resuelve la
// espera al cobrar, pero si alguien cambia algo en FacturaScripts (añade
// una forma de pago, la desactiva) a mitad de turno, el TPV tardaria en
// enterarse -- antes solo se refrescaba de fondo cuando se abria el modal
// de pago (1-2 cobros de retraso). Cambian mucho menos que el stock, asi
// que no hace falta cada 10s como aquel, pero si un ciclo periodico propio
// (cada 5 min) para no depender de que alguien cobre mientras tanto.
mustContain(
  renderer,
  "function startPayMethodsAutoRefresh() {",
  "startPayMethodsAutoRefresh helper exists",
);
mustContain(
  renderer,
  "function stopPayMethodsAutoRefresh() {",
  "stopPayMethodsAutoRefresh helper exists",
);
{
  const idx = renderer.indexOf("async function forceRefreshPaySeries() {");
  const closeIdx = idx >= 0 ? renderer.indexOf("\nfunction ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (scoped.includes("const rows = await fetchPaySeriesOnce();")) {
    ok(
      "forceRefreshPaySeries always fetches series fresh (unlike ensurePaySeriesLoaded, which only loads once), so the periodic cycle actually refreshes",
    );
  } else {
    fail(
      "forceRefreshPaySeries always fetches series fresh (unlike ensurePaySeriesLoaded, which only loads once), so the periodic cycle actually refreshes",
    );
  }
}
mustContain(
  renderer,
  "async function fetchPaySeriesOnce() {",
  "fetchPaySeriesOnce coalesces concurrent 'series' fetches (ensurePaySeriesLoaded + forceRefreshPaySeries) into one shared request instead of firing duplicates",
);
{
  const occurrences = (renderer.match(/startPayMethodsAutoRefresh\?\.\(\);/g) || []).length;
  if (occurrences >= 3) {
    ok(
      "startPayMethodsAutoRefresh is wired into every place the cash session becomes active (fresh open + both recovery paths), not just one of them",
    );
  } else {
    fail(
      `startPayMethodsAutoRefresh is wired into every place the cash session becomes active (found ${occurrences} call sites, expected >= 3: fresh open + 2 recovery paths)`,
    );
  }
}
{
  const occurrences = (renderer.match(/stopPayMethodsAutoRefresh\?\.\(\);/g) || []).length;
  if (occurrences >= 2) {
    ok(
      "stopPayMethodsAutoRefresh is wired into both places a cash session is detected as closed",
    );
  } else {
    fail(
      `stopPayMethodsAutoRefresh is wired into both places a cash session is detected as closed (found ${occurrences}, expected >= 2)`,
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-26 switching terminal mid-session re-warms that terminal's own ticket-number predictor\n",
);

// Feedback de cliente real (negocio con varias tiendas/almacenes
// compartiendo el mismo TPV): el predictor de numero de ticket es por
// terminal a proposito, cada uno tiene su propia numeracion en
// FacturaScripts. El precalentado de hoy solo se disparaba al abrir caja
// -- si se cambia de terminal CON LA CAJA YA ABIERTA, ese terminal nuevo
// nunca se habria precalentado, y su primer cobro seria lento sin que
// nadie se lo esperase. setCurrentTerminal ahora relanza el mismo
// precalentado (solo si la caja esta abierta, y solo si el terminal
// cambia de verdad).
{
  const idx = renderer.indexOf("function setCurrentTerminal(terminal) {");
  const closeIdx = idx >= 0 ? renderer.indexOf("\nfunction ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes("if (cashSession?.open) {") &&
    scoped.includes("primeFastTicketPredictorOnCashOpen().catch(() => {});")
  ) {
    ok(
      "setCurrentTerminal re-warms the ticket-number predictor for the newly-selected terminal when the cash session is already open",
    );
  } else {
    fail(
      "setCurrentTerminal re-warms the ticket-number predictor for the newly-selected terminal when the cash session is already open",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-26 opening a ticket's info shows a loading notice and fetches in parallel\n",
);

// Feedback de cliente real: tocar un ticket en la lista de Tickets tardaba
// unos segundos en abrir "Informacion de ticket" (dos peticiones a
// FacturaScripts, lineas y recibos, una detras de otra) SIN ningun aviso --
// el cliente penso que se habia quedado colgado. Ahora avisa al instante
// (toast) y pide ambas cosas a la vez en vez de en fila, recortando tambien
// la espera real a la mitad.
{
  const idx = renderer.indexOf(
    "async function openTicketInfoForFactura(facturaRow, options = {}) {",
  );
  const closeIdx = idx >= 0 ? renderer.indexOf("\nfunction ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes('toast("Cargando ticket...", "info", "Tickets");') &&
    scoped.includes("const lineasAllPromise = fetchLineasFactura(idfactura);") &&
    scoped.includes(
      "const recibosOriginalesPromise = fetchRecibosByFactura(idfactura).catch(",
    ) &&
    scoped.indexOf("const lineasAllPromise") <
      scoped.indexOf("lineasAll = await lineasAllPromise")
  ) {
    ok(
      "openTicketInfoForFactura shows an immediate loading toast and fetches lineas+recibos in parallel instead of sequentially",
    );
  } else {
    fail(
      "openTicketInfoForFactura shows an immediate loading toast and fetches lineas+recibos in parallel instead of sequentially",
    );
  }
}
mustContain(
  renderer,
  'toast("No se pudo cargar el ticket.", "err", "Tickets");',
  "Clicking a ticket row surfaces a clear error if loading its info fails, instead of failing silently",
);

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

// Herramienta de pruebas: TPV_RUN_BACKGROUND=1 permite lanzar la app en modo
// real (sin TPV_E2E) reutilizando el mismo comportamiento de ventana oculta
// (showInactive + minimize) que ya existia solo para IS_E2E_BACKGROUND, para
// poder probar contra datos reales sin que la ventana tape lo que el usuario
// esta haciendo.
mustContain(
  main,
  'const IS_REAL_BACKGROUND = String(process.env.TPV_RUN_BACKGROUND || "") === "1";',
  "main.js reads TPV_RUN_BACKGROUND into IS_REAL_BACKGROUND",
);
mustContain(
  main,
  "const e2eBackground = IS_E2E_BACKGROUND || IS_REAL_BACKGROUND;",
  "createWindow() hides the window for a real background-launched session too, not just E2E",
);

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
    scoped.includes(".filter((t) => !isParkedTicketTombstoned(t));") &&
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

// Regresion real detectada en produccion (2026-08-21, reportada por un
// cliente con 2+ terminales trabajando a la vez): un aparcado se quedaba
// "PENDIENTE" para siempre aunque ya se hubiera cobrado por otro lado (o el
// ticket impreso no correspondia con el pedido real). Causa: hay ~20 sitios
// distintos en el codigo llamando a refreshRemoteParkedReservationsOnly
// (accion del usuario, poll de 10s, etc.) sin ninguna coordinacion entre si.
// syncParkedTicketsFromRemote no es reentrante, y dos llamadas solapadas
// podian pisarse -- la que TERMINABA mas tarde ganaba aunque hubiera
// arrancado con una foto del remoto mas vieja, dejando currentParkedTicketIndex
// a null (mesa "desasignada") o pisando parkedTickets con menos aparcados de
// los que realmente habia. Ahora es "single-flight": una llamada mientras ya
// hay otra en curso reutiliza esa misma promesa en vez de lanzar otra.
mustContain(
  renderer,
  "let __refreshRemoteParkedReservationsInFlightPromise = null;",
  "refreshRemoteParkedReservationsOnly has a single-flight in-progress guard",
);
mustContain(
  renderer,
  "async function refreshRemoteParkedReservationsOnlyImpl() {",
  "refreshRemoteParkedReservationsOnly delegates to a wrapped impl (single-flight)",
);

// Cherry-pick de un fix general encontrado en la rama de integracion con la
// app de camareros (2026-08-24): un ticketId no numerico (algo que esa app
// puede mandar, aunque main hoy no genere ninguno) hacia que
// normalizeRemoteParkedTicket lo tirara a id=0. Con id=0,
// getParkedTicketSyncKey(t) devolvia clave VACIA (id falsy), asi que el
// ticket se desvinculaba del carrito en cada sincronizacion -- sin ninguna
// carrera, de forma perfectamente determinista. Ademas, al reenviarlo se
// mandaba ticketId "0" en vez del real, arriesgando una fila duplicada en el
// servidor. Se conserva ahora el id original (como string) en vez de
// descartarlo a 0. No es la causa del bug de 2+ terminales reportado en main
// (esa sigue siendo la carrera que arregla el single-flight de arriba), pero
// es una correccion real en una funcion compartida por todo aparcado.

// Otro cherry-pick de la misma rama (2026-08-24): el badge de "Pedidos"
// parpadeaba entre el total y "1 mesa" cada ~10s en modo
// Transacciones (2026-08-24). Causa: se filtraba por
// mesas.js:state.selectedTableId, que es un estado de NAVEGACION DEL PLANO
// (para resaltar una mesa en el mapa) que ensureActiveRoomAndTable
// auto-rellena con "la primera mesa de la sala" en cuanto detecta que no hay
// ninguna seleccionada -- y eso pasa en cada refresco del plano (cada vez
// que el sync de aparcados escribe en localStorage, ~10s). El boton siempre
// abre la lista COMPLETA sin filtrar (ver openParkedModal), asi que el
// numero debe coincidir con eso siempre.
{
  const idx = renderer.indexOf("function updateParkedCountBadge() {");
  const closeIdx = idx >= 0 ? renderer.indexOf("\nfunction getParkedClosingLockAgeMs", idx) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped &&
    scoped.includes("badge.textContent = String(pendingMesas.length);") &&
    !scoped.includes("selectedCount") &&
    !scoped.includes("loadMesasTablesStateForInline()")
  ) {
    ok(
      "updateParkedCountBadge no longer scopes the Mesas count to mesas.js's map-selection state",
    );
  } else {
    fail(
      "updateParkedCountBadge no longer scopes the Mesas count to mesas.js's map-selection state",
    );
  }
}

{
  const idx = renderer.indexOf("function normalizeRemoteParkedTicket(raw) {");
  const closeIdx = idx >= 0 ? renderer.indexOf("\n  const createdAt = raw.createdAt", idx) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped &&
    scoped.includes("String(rawTicketId ?? \"\").trim() || 0") &&
    !/:\s*0;\s*$/.test(scoped.trim())
  ) {
    ok(
      "normalizeRemoteParkedTicket preserves a non-numeric ticketId instead of collapsing it to 0",
    );
  } else {
    fail(
      "normalizeRemoteParkedTicket preserves a non-numeric ticketId instead of collapsing it to 0",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-22 dedupe redundant paid-history reload per sync\n",
);

// Feedback de cliente real (2+ TPV, lentitud a partir de ~80 aparcados/dia):
// loadParkedPaidHistory() lee localStorage + JSON.parse + normaliza hasta
// 2000 tickets cobrados, y se llamaba 2 veces dentro de la misma pasada de
// syncParkedTicketsFromRemote (que corre cada 10s y ademas la espera
// "Cobrar" al cerrar una mesa). Ahora se calcula una vez y se reutiliza.
{
  const idx = renderer.indexOf("function syncParkedTicketsFromRemote(list) {");
  const endIdx = idx >= 0 ? renderer.indexOf("\nfunction ", idx + 10) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("const paidHistory = loadParkedPaidHistory();") &&
    scoped.includes("...paidHistory.filter((t) => !!t?.paid),") &&
    scoped.includes("...paidHistory,") &&
    !scoped.includes("...loadParkedPaidHistory()")
  ) {
    ok(
      "syncParkedTicketsFromRemote calls loadParkedPaidHistory() only once per sync, not twice",
    );
  } else {
    fail(
      "syncParkedTicketsFromRemote calls loadParkedPaidHistory() only once per sync, not twice",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-23 silent auto-save no longer blocks cart editing\n",
);

// Feedback de cliente real: "cuando le das un producto, hasta que no lo
// guardas... no te deja seguir". El autoguardado de fondo con debounce
// (scheduleMesasAutoSave/scheduleTpvAutoSave, ya existente) llamaba a
// parkCurrentCart con silentAutoSave:true, pero esta seguia tomando
// isParkingNow -- la misma bandera que bloquea la edicion del carrito
// (getCartEditLockReason) -- anulando el proposito de que sea invisible.
// Ahora un guardado silencioso usa isParkingNowSilent (no bloquea la
// interfaz) y solo el guardado manual/explicito sigue tomando isParkingNow.
mustContain(
  renderer,
  "let isParkingNowSilent = false;",
  "isParkingNowSilent flag exists, separate from the UI-blocking isParkingNow",
);
{
  const idx = renderer.indexOf("async function parkCurrentCart(name = \"\"");
  const endIdx = idx >= 0 ? renderer.indexOf("\nasync function ", idx + 10) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("if (isParkingNow || isParkingNowSilent) return;") &&
    scoped.includes("isParkingNowSilent = true;") &&
    scoped.includes("isParkingNowSilent = false;")
  ) {
    ok(
      "parkCurrentCart only sets isParkingNow (UI-blocking) for non-silent saves, using isParkingNowSilent for silent ones",
    );
  } else {
    fail(
      "parkCurrentCart only sets isParkingNow (UI-blocking) for non-silent saves, using isParkingNowSilent for silent ones",
    );
  }
}
{
  const idx = renderer.indexOf("function getCartEditLockReason() {");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 450) : "";
  if (scoped.includes("if (isParkingNow) {") && !scoped.includes("isParkingNowSilent")) {
    ok(
      "getCartEditLockReason still only locks the cart for the non-silent (manual) save, not for background auto-save",
    );
  } else {
    fail(
      "getCartEditLockReason still only locks the cart for the non-silent (manual) save, not for background auto-save",
    );
  }
}
mustContain(
  renderer,
  "async function waitForSilentAutoSaveToSettle(maxMs = 3000) {",
  "waitForSilentAutoSaveToSettle helper exists to avoid closing out a ticket mid-write",
);
mustContain(
  renderer,
  "await waitForSilentAutoSaveToSettle();",
  "Parked-ticket checkout waits for any in-flight silent auto-save before locking/closing the ticket",
);

console.log(
  "\n[SMOKE] Checking 2026-08-24 deleted pending tickets no longer reappear\n",
);

// Feedback de cliente real (probado en vivo en Modo Mesas, pero la funcion es
// compartida con el TPV normal): al borrar un aparcado PENDIENTE (sin
// cobrar), el toast decia "eliminado" pero el ticket volvia a aparecer solo
// segundos despues. Causa: el borrado remoto (apiDeleteParkedReservation) es
// fire-and-forget -- no se espera a que termine antes de quitar el ticket de
// local -- y si un sync (poll de 10s, u otro TPV) llega antes de que el
// servidor procese el borrado, todavia ve el ticket "ahi" y lo trae de
// vuelta. Ya existia este mismo mecanismo (tombstone) para los COBRADOS
// (antes "isParkedPaidTombstoned"/"markParkedPaidTicketAsDeleted"), pero
// nunca se aplicaba a los pendientes. Generalizado (renombrado sin "Paid") y
// aplicado en los 4 sitios que borran un aparcado: borrado individual,
// borrado masivo de pendientes, limpiar cobrados, y unificar partes de un
// ticket dividido.
mustContain(
  renderer,
  "function isParkedTicketTombstoned(ticket) {",
  "Tombstone check generalized beyond paid tickets (renamed from isParkedPaidTombstoned)",
);
mustContain(
  renderer,
  "function markParkedTicketAsDeleted(ticket) {",
  "Tombstone marker generalized beyond paid tickets (renamed from markParkedPaidTicketAsDeleted, no longer requires ticket.paid)",
);
{
  const idx = renderer.indexOf("async function deleteParkedTicketByIndex(");
  const closeIdx = idx >= 0 ? renderer.indexOf("\nasync function ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes("markParkedTicketAsDeleted(removedTicket);") &&
    !/if \(removedTicket\?\.paid[^)]*\)\s*\{\s*markParkedTicketAsDeleted/.test(scoped)
  ) {
    ok(
      "deleteParkedTicketByIndex tombstones any deleted ticket, not only paid ones",
    );
  } else {
    fail(
      "deleteParkedTicketByIndex tombstones any deleted ticket, not only paid ones",
    );
  }
}
{
  const idx = renderer.indexOf(
    "async function deleteAllPendingParkedTickets(",
  );
  const closeIdx = idx >= 0 ? renderer.indexOf("\nfunction ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (scoped.includes("markParkedTicketAsDeleted(ticket);")) {
    ok(
      "deleteAllPendingParkedTickets (bulk 'Borrar pendientes') tombstones each removed ticket",
    );
  } else {
    fail(
      "deleteAllPendingParkedTickets (bulk 'Borrar pendientes') tombstones each removed ticket",
    );
  }
}
{
  const idx = renderer.indexOf("const toDelete = sameGroupEntries.filter(");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 700) : "";
  if (scoped.includes("markParkedTicketAsDeleted(entry.ticket);")) {
    ok(
      "Merging split-ticket parts tombstones the parts it deletes",
    );
  } else {
    fail(
      "Merging split-ticket parts tombstones the parts it deletes",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-24 paid ticket no longer deleted on a stale visibility check\n",
);

// Investigado a peticion del cliente ("cobro un aparcado y no se muestra
// como cobrado / sigue pendiente"), reproducido con un script aislado
// (repro-paid-visibility-bug.js) fuera de este repo, sin tocar ningun
// servidor real: ensureRemoteParkedPaidVisibility() se llama justo despues
// de cobrar, para confirmar que el servidor ya ve el ticket como pagado. Si
// no lo encontraba por clave exacta, caia a comparar solo Number(id) ===
// Number(id), ignorando slug/cajaId/modo. Con 2+ terminales, cada uno con su
// propio contador LOCAL de numeros de ticket (no coordinado por el
// servidor), dos tickets DISTINTOS pueden compartir numero -- ese fallback
// podia confundir el ticket recien cobrado con un pedido pendiente sin
// relacion de otro terminal, y BORRABA el que se acababa de cobrar (la
// factura en FacturaScripts ya estaba bien hecha, pero el TPV dejaba de
// verlo como cobrado). Ahora usa getParkedTicketSyncKeyVariants (mismo
// criterio que el resto de la sincronizacion) y, si de verdad es el mismo
// ticket pero el servidor no lo tiene como pagado, reintenta guardarlo en
// vez de borrarlo.
{
  const idx = renderer.indexOf("async function ensureRemoteParkedPaidVisibility(ticket) {");
  const closeIdx = idx >= 0 ? renderer.indexOf("\nasync function ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes("getParkedTicketSyncKeyVariants(ticket)") &&
    scoped.includes('mode: "resaved"') &&
    !scoped.includes("apiDeleteParkedReservation(ticket)") &&
    !/Number\(it\?\.id \|\| 0\) === Number\(ticket\?\.id \|\| 0\)/.test(scoped)
  ) {
    ok(
      "ensureRemoteParkedPaidVisibility matches by full key variants (not bare numeric id) and retries the save instead of deleting",
    );
  } else {
    fail(
      "ensureRemoteParkedPaidVisibility matches by full key variants (not bare numeric id) and retries the save instead of deleting",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-24 tariff freshness re-checked right before building the invoice\n",
);

// Feedback de cliente real (mismo caso "Mermas" 100%, seguia pasando incluso
// tras el fix anterior de activeCustomerTariffReadyPromise): esa espera solo
// cubre el instante de pulsar "Cobrar", pero el precio final no se calcula
// hasta despues del modal de pago (que puede tardar segundos reales). El
// codcliente que va a la factura se lee siempre en fresco del selector, pero
// activeCustomerTariff es una variable de fondo que podia quedar
// desactualizada respecto al cliente actual en ese momento posterior. Ahora
// se revalida justo antes de calcular el precio (no solo al principio).
mustContain(
  renderer,
  "async function ensureActiveCustomerTariffMatchesSelection() {",
  "ensureActiveCustomerTariffMatchesSelection helper exists",
);
{
  const idx = renderer.indexOf(
    "async function ensureActiveCustomerTariffMatchesSelection() {",
  );
  const closeIdx = idx >= 0 ? renderer.indexOf("\nfunction bindCartCustomerUiEvents", idx) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes("getSelectedCustomerCodcliente") &&
    scoped.includes("selectedCod === activeCod") &&
    scoped.includes("refreshActiveCustomerTariffForSelection(")
  ) {
    ok(
      "ensureActiveCustomerTariffMatchesSelection detects a mismatch between the selected customer and the active tariff, and re-resolves it",
    );
  } else {
    fail(
      "ensureActiveCustomerTariffMatchesSelection detects a mismatch between the selected customer and the active tariff, and re-resolves it",
    );
  }
}
{
  const idx = renderer.indexOf("async function onPayButtonClick() {");
  const closeIdx = idx >= 0 ? renderer.indexOf("const ticketPayload = buildTicketPayloadFromCart();", idx) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (scoped.includes("await ensureActiveCustomerTariffMatchesSelection();")) {
    ok(
      "onPayButtonClick re-verifies the active tariff right before building the invoice payload, not only when Cobrar was first clicked",
    );
  } else {
    fail(
      "onPayButtonClick re-verifies the active tariff right before building the invoice payload, not only when Cobrar was first clicked",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-25 fast pre-print client name matches the real invoiced customer\n",
);

// Feedback de cliente real (misma factura de Mermas): el ticket impreso
// decia "Cliente: Ventas tickets" aunque la factura en FacturaScripts si
// quedo bien vinculada a "Mermas". Causa: la preimpresion rapida (imprime
// antes de que la API confirme la venta) leia el nombre directamente del
// campo de texto en pantalla (cartClientInput.value) -- una fuente distinta
// de la que usa la factura real (codcliente, leido en fresco del selector).
// getSelectedCustomerPrintMeta() ya deriva el nombre del MISMO codcliente
// que va a la factura (mismo patron que usan los demas flujos de
// impresion), asi que ahora no puede desajustarse.
{
  const idx = renderer.indexOf("function buildFastPreApiTicketDraft(ticketPayload, cartSnapshot) {");
  const closeIdx = idx >= 0 ? renderer.indexOf("\nfunction ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes("const clientName = getSelectedCustomerPrintMeta().clientName;") &&
    !scoped.includes("(cartClientInput && (cartClientInput.value")
  ) {
    ok(
      "buildFastPreApiTicketDraft gets the client name from the same codcliente used for the real invoice, not from the on-screen text input",
    );
  } else {
    fail(
      "buildFastPreApiTicketDraft gets the client name from the same codcliente used for the real invoice, not from the on-screen text input",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-25 print pipeline warm-up on startup\n",
);

// Feedback de cliente: el primer ticket/comanda de cada sesion tardaba
// "muchisimo" en imprimir, luego iba rapido -- coste de arranque en frio del
// primer proceso de renderizado de Chromium (createHiddenPrintWindow crea
// una ventana nueva por cada impresion). Se paga ese coste solo, de fondo,
// justo al arrancar, con un printToPDF de mentira (sin imprimir nada fisico
// ni depender de la impresora configurada) en vez de esperar a la primera
// venta real.
mustContain(
  main,
  "async function warmUpPrintPipeline() {",
  "warmUpPrintPipeline helper exists",
);
{
  const idx = main.indexOf("async function warmUpPrintPipeline() {");
  const closeIdx = idx >= 0 ? main.indexOf("\nasync function ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? main.slice(idx, closeIdx) : "";
  if (scoped.includes("printToPDF({})") && !scoped.includes(".print(")) {
    ok(
      "warmUpPrintPipeline uses printToPDF (no physical output) instead of a real print() call",
    );
  } else {
    fail(
      "warmUpPrintPipeline uses printToPDF (no physical output) instead of a real print() call",
    );
  }
}
mustContain(
  main,
  "warmUpPrintPipeline().catch(() => {});",
  "Print pipeline warm-up is triggered at startup, in the background",
);

console.log(
  "\n[SMOKE] Checking 2026-08-25 products/stock delta-sync (only what changed, not the whole catalog)\n",
);

// Feedback de cliente: mientras la caja estaba abierta, el TPV pedia la
// tabla ENTERA de productos a FacturaScripts cada 10 segundos, sin ningun
// filtro -- con catalogos grandes, un coste real que se repetia sin parar.
// Verificado contra la API real de FacturaScripts (demo): 'productos' tiene
// un campo 'actualizado' que si se mantiene al dia, y filter[actualizado_gt]
// funciona de verdad. Ahora solo se pide lo que cambio desde la ultima vez
// (marca de agua = el propio valor 'actualizado' que devuelve el servidor,
// sin reformatear), con una recarga completa periodica como red de
// seguridad para el caso rarisimo de un producto borrado de verdad.
mustContain(
  renderer,
  "let __productsDeltaWatermark = null;",
  "Products delta-sync watermark state exists",
);
mustContain(
  renderer,
  "function parseFsProductTimestamp(str) {",
  "parseFsProductTimestamp helper exists",
);
{
  const idx = renderer.indexOf("function startProductsStockAutoRefresh() {");
  const closeIdx = idx >= 0 ? renderer.indexOf("\nfunction ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes("__productsDeltaWatermark = null;") &&
    scoped.includes("__productsLastFullSyncAt = 0;")
  ) {
    ok(
      "startProductsStockAutoRefresh resets the delta watermark on every (re)start, so boot/reopen/reconnect always begin with a full baseline",
    );
  } else {
    fail(
      "startProductsStockAutoRefresh resets the delta watermark on every (re)start, so boot/reopen/reconnect always begin with a full baseline",
    );
  }
}
{
  const idx = renderer.indexOf("async function refreshProductsStockOnly() {");
  const closeIdx = idx >= 0 ? renderer.indexOf("\nasync function ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes('fetchApiResourceWithParams("productos", { limit: 0 })') &&
    scoped.includes('"filter[actualizado_gt]": __productsDeltaWatermark') &&
    scoped.includes("if (latestRaw) __productsDeltaWatermark = latestRaw;")
  ) {
    ok(
      "refreshProductsStockOnly fetches only products changed since the last known watermark instead of the full catalog every time",
    );
  } else {
    fail(
      "refreshProductsStockOnly fetches only products changed since the last known watermark instead of the full catalog every time",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-26 opening a parked ticket resolves it by stable identity, not by its stale render-time position\n",
);

// Feedback de cliente real (aparcados que se quedaban "PENDIENTE" aunque ya
// se hubieran cobrado, en un local de mucho movimiento): cada tarjeta de la
// lista de aparcados memorizaba su posicion en el array al pintarse. Si esa
// lista cambiaba de orden (llegaba un ticket nuevo, un sync automatico...)
// antes de que el operario hiciera clic, podia abrirse OTRO ticket distinto
// del que se veia en pantalla, sin ningun aviso -- y el que de verdad se
// queria cerrar se quedaba pendiente para siempre. El boton de borrar (🗑)
// de esa misma lista ya resolvia el ticket por su identidad estable
// (getParkedTicketSyncKey) en vez de por posicion; el clic para abrir ahora
// hace lo mismo.
{
  const idx = renderer.indexOf("div.onclick = () => {");
  const closeIdx = idx >= 0 ? renderer.indexOf("\n    return div;", idx) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes("const ticketKey = getParkedTicketSyncKey(t);") &&
    scoped.includes("parkedTickets.findIndex(") &&
    scoped.includes("restoreParkedCartByIndex(freshIndex);") &&
    !scoped.includes("restoreParkedCartByIndex(realIndex);")
  ) {
    ok(
      "Opening a parked ticket from the list re-resolves it by stable identity right before loading, instead of trusting the position captured when the card was rendered",
    );
  } else {
    fail(
      "Opening a parked ticket from the list re-resolves it by stable identity right before loading, instead of trusting the position captured when the card was rendered",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-26 a confirmed sale is never silently lost if its parked ticket vanished from the local list mid-checkout\n",
);

// Feedback de cliente real: markParkedTicketAsPaidByIndex se llama DESPUES
// de confirmar que la factura ya se creo en FacturaScripts. Si para entonces
// el aparcado ya no estaba en la lista local (por cualquier motivo: sync,
// edicion concurrente...), la funcion se rendia en silencio -- ni error, ni
// aviso, ni reintento -- dejando el aparcado "pendiente" para siempre aunque
// la venta ya se hubiera cobrado de verdad. Ahora, si no lo encuentra por
// indice, usa el ultimo dato conocido y confirmado de ese ticket (capturado
// justo antes de empezar la parte lenta del cobro) para no perder el aviso.
mustContain(
  renderer,
  "let parkedTicketFallbackForMark = null;",
  "Payment flow keeps a last-known snapshot of the parked ticket being closed, captured before the slow invoice-creation calls",
);
{
  const idx = renderer.indexOf(
    "async function markParkedTicketAsPaidByIndex(",
  );
  const closeIdx = idx >= 0 ? renderer.indexOf("\nasync function ", idx + 10) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes("fallbackTicket = null") &&
    scoped.includes("if (!ticket && fallbackTicket) {") &&
    scoped.includes("logFeatureWarn(") &&
    scoped.includes("parkedTickets.push(ticket);")
  ) {
    ok(
      "markParkedTicketAsPaidByIndex falls back to the last-known ticket snapshot (and logs it) instead of silently giving up when the ticket can't be found by index",
    );
  } else {
    fail(
      "markParkedTicketAsPaidByIndex falls back to the last-known ticket snapshot (and logs it) instead of silently giving up when the ticket can't be found by index",
    );
  }
}
{
  const occurrences = renderer.split("parkedTicketFallbackForMark").length - 1;
  // 1 declaracion + 1 asignacion (syncedTicket) + 2 usos al llamar
  // markParkedTicketAsPaidByIndex (rama offline y rama online) = 4.
  if (occurrences >= 4) {
    ok(
      "Both markParkedTicketAsPaidByIndex call sites (offline and online) pass the fallback ticket snapshot",
    );
  } else {
    fail(
      `Both markParkedTicketAsPaidByIndex call sites (offline and online) pass the fallback ticket snapshot (found ${occurrences} usages, expected >= 4)`,
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-26 the currently-open parked ticket's real identity is tracked, not just its position\n",
);

// Descubierto con un stress test de operaciones aleatorias (aparcar, abrir,
// cambiar cliente/empleado, editar productos, cobrar, todo mezclado y con
// reordenamientos de la lista entre medias): aunque abrir un aparcado ya
// resolvia el ticket correcto, currentParkedTicketIndex seguia siendo solo
// una POSICION mientras se editaba. Si la lista cambiaba de orden DESPUES de
// abrir un ticket pero ANTES de pulsar "Cobrar" (llega uno nuevo, un sync
// automatico...), el cobro no tenia ninguna identidad estable con la que
// comprobarlo y confiaba ciegamente en esa posicion ya desactualizada --
// cobrando el ticket equivocado. setCurrentParkedTicketIndex() mantiene la
// identidad real (ACTIVE_PARKED_TICKET_SYNC_KEY/ID) sincronizada con la
// posicion en todo momento, y onPayButtonClick ya la usa como primera fuente
// de verdad al resolver que aparcado cerrar.
mustContain(
  renderer,
  "let ACTIVE_PARKED_TICKET_SYNC_KEY = \"\";",
  "ACTIVE_PARKED_TICKET_SYNC_KEY/ID state exists to track the real identity of the loaded parked ticket",
);
mustContain(
  renderer,
  "function setCurrentParkedTicketIndex(index) {",
  "setCurrentParkedTicketIndex helper exists",
);
mustContain(
  renderer,
  "setCurrentParkedTicketIndex(index);",
  "restoreParkedCartByIndex sets the current parked ticket through the identity-tracking helper",
);
{
  const idx = renderer.indexOf("let parkedIndexToClose = resolveUnpaidParkedTicketIndexForCheckout({");
  const closeIdx = idx >= 0 ? renderer.indexOf("});", idx) : -1;
  const scoped = idx >= 0 && closeIdx >= 0 ? renderer.slice(idx, closeIdx) : "";
  if (
    scoped.includes("ACTIVE_PARKED_TICKET_SYNC_KEY") &&
    scoped.includes("ACTIVE_PARKED_TICKET_ID")
  ) {
    ok(
      "onPayButtonClick's initial checkout resolution prefers the tracked ACTIVE_PARKED_TICKET identity over the position alone",
    );
  } else {
    fail(
      "onPayButtonClick's initial checkout resolution prefers the tracked ACTIVE_PARKED_TICKET identity over the position alone",
    );
  }
}
{
  // Ningun otro sitio del archivo deberia volver a asignar
  // currentParkedTicketIndex directamente (fuera del propio helper) -- si
  // alguien lo hace en el futuro, se pierde el seguimiento de identidad para
  // ese caso concreto sin que nadie se entere. Solo deben quedar 2
  // ocurrencias del patron "currentParkedTicketIndex = ": la declaracion
  // inicial ("let currentParkedTicketIndex = null;") y la asignacion de
  // dentro de setCurrentParkedTicketIndex.
  const totalRawAssignments =
    renderer.split("currentParkedTicketIndex = ").length - 1;
  if (totalRawAssignments === 2) {
    ok(
      "No other place in renderer.js assigns currentParkedTicketIndex directly, bypassing the identity-tracking helper",
    );
  } else {
    fail(
      `No other place in renderer.js assigns currentParkedTicketIndex directly, bypassing the identity-tracking helper (found ${totalRawAssignments} raw assignments, expected exactly 2: the declaration and the one inside the helper)`,
    );
  }
}

console.log("\n[SMOKE] Checking offline sync queue (syncQueueNow) fixes\n");

{
  // Bug real de cliente: varias ventas se quedaban "OFF-... ID undefined"
  // para siempre, sin contar en el cierre de caja. Causa: si la venta MAS
  // ANTIGUA en cola fallaba (por cualquier motivo, no solo de red), el
  // catch de fuera hacia "break" y abandonaba TODO el resto de la cola en
  // ese ciclo -- ninguna otra venta detras de ella tenia ninguna
  // oportunidad de sincronizar. Ahora CREATE_FACTURACLIENTE tiene su
  // propio try/catch (igual que CREATE_TPVCAJA_OPEN) y el catch de fuera ya
  // no usa "break".
  const startIdx = renderer.indexOf('if (item.type === "CREATE_FACTURACLIENTE") {');
  const endMarker = 'if (item.type === "tpvterminal.setCodcliente") {';
  const endIdx = renderer.indexOf(endMarker, startIdx);
  const scoped = startIdx >= 0 && endIdx > startIdx ? renderer.slice(startIdx, endIdx) : "";

  if (
    scoped.includes('if (item.type === "CREATE_FACTURACLIENTE") {') &&
    scoped.includes("try {\r\n            // 1) Crear factura") &&
    scoped.includes("if (isNetworkError(e) || isProbablyNetworkError(e)) {") &&
    scoped.includes("dropped: true,")
  ) {
    ok(
      "CREATE_FACTURACLIENTE now has its own try/catch distinguishing network vs permanent errors",
    );
  } else {
    fail(
      "CREATE_FACTURACLIENTE now has its own try/catch distinguishing network vs permanent errors",
    );
  }

  mustContain(
    scoped,
    "La API no devolvió un número de factura válido al crear la venta en cola.",
    "A successful-looking response with no idfactura is now treated as a real failure, not silently marked done",
  );
}

{
  const idx = renderer.indexOf('async function syncQueueNow() {');
  const closeIdx = idx >= 0 ? renderer.indexOf("const PAY_METHODS_CACHE_KEY", idx) : -1;
  const scoped = idx >= 0 && closeIdx > idx ? renderer.slice(idx, closeIdx) : "";

  // El unico "break;" que debe quedar es el de salida normal cuando la cola
  // esta vacia (if (!next?.item) break;). El que abandonaba el resto de la
  // cola tras el fallo de UN item ya no debe existir.
  const breakCount = scoped ? scoped.split("break;").length - 1 : 0;
  if (scoped && breakCount === 1 && scoped.includes("if (!next?.item) break;")) {
    ok(
      "syncQueueNow no longer breaks out of the queue-draining loop on a single item's failure",
    );
  } else {
    fail(
      `syncQueueNow no longer breaks out of the queue-draining loop on a single item's failure (found ${breakCount} break; occurrences, expected exactly 1)`,
    );
  }
}

console.log("\n[SMOKE] Checking 2026-08-26 ticket list no longer shows a broken \"#-\" for a parked origin with no display number\n");

{
  const idx = renderer.indexOf("const parkedOriginNoHtml = parkedOriginNo");
  const closeIdx = idx >= 0 ? renderer.indexOf("if (obs || parkedOrigin)", idx) : -1;
  const scoped = idx >= 0 && closeIdx > idx ? renderer.slice(idx, closeIdx) : "";

  if (scoped && !scoped.includes('"#-"')) {
    ok(
      'A parked-origin ticket row with no valid display number no longer renders a bare "#-"',
    );
  } else {
    fail(
      'A parked-origin ticket row with no valid display number no longer renders a bare "#-"',
    );
  }
}

console.log("\n[SMOKE] Checking 2026-08-26 Options tariff/customer data is warmed up on cash open\n");

{
  const warmupCallSites = renderer.split("ensureCustomerTariffsLoaded().catch(() => {});").length - 1;
  if (warmupCallSites >= 3) {
    ok(
      `Options tariff data (ensureCustomerTariffsLoaded) is warmed up in the background at all cash-open/recovery sites (found ${warmupCallSites})`,
    );
  } else {
    fail(
      `Options tariff data (ensureCustomerTariffsLoaded) is warmed up in the background at all cash-open/recovery sites (found ${warmupCallSites}, expected >= 3)`,
    );
  }

  const customerWarmupCallSites = renderer.split("loadTariffCustomersCache().catch(() => {});").length - 1;
  if (customerWarmupCallSites >= 3) {
    ok(
      `Options tariff-customers data (loadTariffCustomersCache) is warmed up alongside it (found ${customerWarmupCallSites})`,
    );
  } else {
    fail(
      `Options tariff-customers data (loadTariffCustomersCache) is warmed up alongside it (found ${customerWarmupCallSites}, expected >= 3)`,
    );
  }
}

console.log("\n[SMOKE] Checking 2026-08-27 openOptions loads its ~29 settings in a single parallel batch\n");

{
  const idx = renderer.indexOf("async function openOptions() {");
  const endIdx = idx >= 0 ? renderer.indexOf("function closeOptions()", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";

  const promiseAllBatches = scoped.split("await Promise.all([").length - 1;
  if (promiseAllBatches === 1) {
    ok(
      "openOptions batches every independent settings loader into a single parallel Promise.all instead of several sequential batches or ~30 one-by-one awaits",
    );
  } else {
    fail(
      `openOptions batches every independent settings loader into a single parallel Promise.all (found ${promiseAllBatches} Promise.all call(s), expected exactly 1)`,
    );
  }

  if (
    scoped.includes("loadPriceEditModeFromCfg?.(),") &&
    scoped.indexOf("refreshPriceEditToggleUI?.();") >
      scoped.indexOf("await Promise.all([")
  ) {
    ok(
      "refreshPriceEditToggleUI still runs after the whole batch (including loadPriceEditModeFromCfg) resolves, not before it",
    );
  } else {
    fail(
      "refreshPriceEditToggleUI still runs after the whole batch (including loadPriceEditModeFromCfg) resolves, not before it",
    );
  }

  if (
    scoped.includes("const [st] = await Promise.all([\r\n    loadOptionsAccordionState(),") &&
    scoped.includes("await applyOptionsAccordionState(st);") &&
    scoped.indexOf("await applyOptionsAccordionState(st);") >
      scoped.indexOf("await Promise.all([")
  ) {
    ok(
      "loadOptionsAccordionState joins the single batch, and applyOptionsAccordionState(st) still runs only after its real result is known",
    );
  } else {
    fail(
      "loadOptionsAccordionState joins the single batch, and applyOptionsAccordionState(st) still runs only after its real result is known",
    );
  }
}

console.log("\n[SMOKE] Checking 2026-08-27 Bascula section left open from a previous session no longer blocks Options from opening instantly\n");

{
  const idx = scaleUi.indexOf("async function initScaleOptionsUI() {");
  const endIdx = idx >= 0 ? scaleUi.indexOf("window.initScaleOptionsUI = initScaleOptionsUI;", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? scaleUi.slice(idx, endIdx) : "";

  if (
    scoped.includes('bascSection?.dataset?.open === "1"') &&
    !scoped.includes("await ensureScalePortsLoadedAndConnected(cfg);") &&
    scoped.includes("ensureScalePortsLoadedAndConnected(cfg).catch(")
  ) {
    ok(
      "initScaleOptionsUI never awaits the slow port-listing work, even when the Bascula section was already left open from a previous session",
    );
  } else {
    fail(
      "initScaleOptionsUI never awaits the slow port-listing work, even when the Bascula section was already left open from a previous session",
    );
  }
}

console.log("\n[SMOKE] Checking 2026-08-26 scale serial-port list is only queried lazily, when the Bascula section is actually opened\n");

mustContain(
  scaleUi,
  "let __scalePortsCache = null;",
  "Scale ports cache state exists",
);
mustContain(
  scaleUi,
  "async function applyScaleFormFromStoredConfig() {",
  "applyScaleFormFromStoredConfig (fast, local-only) exists separately from the slow port-listing path",
);
mustContain(
  scaleUi,
  "async function ensureScalePortsLoadedAndConnected(cfg) {",
  "ensureScalePortsLoadedAndConnected (the slow OS-level port listing + reconnect) exists as its own function",
);
mustContain(
  scaleUi,
  "let __pendingScaleConfigForLazyLoad = null;",
  "Scale port loading can be deferred until the Bascula section is actually opened",
);
mustContain(
  scaleUi,
  "async function ensureScalePortsLoadedOnSectionOpen() {",
  "ensureScalePortsLoadedOnSectionOpen helper exists, exposed for the accordion click handler",
);
mustContain(
  scaleUi,
  "window.ensureScalePortsLoadedOnSectionOpen = ensureScalePortsLoadedOnSectionOpen;",
  "ensureScalePortsLoadedOnSectionOpen is exposed on window for renderer.js's accordion handler",
);

{
  // Ningun cliente sin bascula deberia pagar el coste de enumerar puertos
  // serie solo por abrir "Opciones", y ni siquiera un cliente que SI la usa
  // deberia quedarse esperando ese coste si la seccion Bascula ya estaba
  // desplegada de una sesion anterior -- ver el bloque "2026-08-27" mas
  // arriba, que reemplaza a este chequeo (antes exigia un "await" ahi que
  // resulto ser la causa exacta de que "Opciones" siguiera notandose lenta).
  const idx = scaleUi.indexOf("async function initScaleOptionsUI() {");
  const endIdx = idx >= 0 ? scaleUi.indexOf("window.initScaleOptionsUI = initScaleOptionsUI;", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? scaleUi.slice(idx, endIdx) : "";

  if (
    scoped.includes('data-sec="bascula"') &&
    scoped.includes('bascSection?.dataset?.open === "1"') &&
    scoped.includes("__pendingScaleConfigForLazyLoad = cfg;")
  ) {
    ok(
      "initScaleOptionsUI only does the slow port-listing work if the Bascula section is already open, deferring it otherwise",
    );
  } else {
    fail(
      "initScaleOptionsUI only does the slow port-listing work if the Bascula section is already open, deferring it otherwise",
    );
  }
}

{
  const idx = renderer.indexOf("function bindOptionsAccordionOnce() {");
  const endIdx = idx >= 0 ? renderer.indexOf("let autostartToggleBound", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";

  if (
    scoped.includes('if (key === "bascula" && !isOpen) {') &&
    scoped.includes("window.ensureScalePortsLoadedOnSectionOpen?.()?.catch(() => {});")
  ) {
    ok(
      "Opening the Bascula accordion section in Options triggers the deferred scale-port load",
    );
  } else {
    fail(
      "Opening the Bascula accordion section in Options triggers the deferred scale-port load",
    );
  }
}

{
  const idx = renderer.indexOf("async function runBootFlow() {");
  const endIdx = idx >= 0 ? renderer.indexOf("await loadDataFromApi();", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";

  if (!scoped.includes("warmUpScalePorts")) {
    ok(
      "runBootFlow no longer eagerly warms up scale ports for every client, including those without a scale",
    );
  } else {
    fail(
      "runBootFlow no longer eagerly warms up scale ports for every client, including those without a scale",
    );
  }
}

{
  const idx = scaleUi.indexOf('async function refreshScalePorts(selectedPath = "", opts = {}) {');
  const endIdx = idx >= 0 ? scaleUi.indexOf("function renderScalePortsOptions(", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? scaleUi.slice(idx, endIdx) : "";

  if (
    scoped.includes("if (!force && Array.isArray(__scalePortsCache)) {") &&
    scoped.includes("const ports = await fetchScalePorts();")
  ) {
    ok(
      "refreshScalePorts reuses the cached port list by default, only calling the OS-level listPorts() when forced or uncached",
    );
  } else {
    fail(
      "refreshScalePorts reuses the cached port list by default, only calling the OS-level listPorts() when forced or uncached",
    );
  }
}

mustContain(
  scaleUi,
  "await refreshScalePorts(current, { force: true });",
  "The manual 'Refrescar puertos' button still forces a real OS-level re-query, bypassing the cache",
);

console.log("\n[SMOKE] Checking cobro en cola (serial background sale processing)\n");

mustContain(
  renderer,
  "let __saleProcessingQueue = Promise.resolve();",
  "A serial sale-processing queue exists",
);
mustContain(
  renderer,
  "function enqueueSaleProcessing(taskFn) {",
  "enqueueSaleProcessing helper exists",
);

{
  // onPayButtonClick debe encolar el resto del cobro (fase 2) justo despues
  // de vaciar el carrito para el siguiente cliente, y devolver el control
  // enseguida (return), en vez de esperar (await) a que la fase 2 termine --
  // si no, "encolar en segundo plano" no seria real.
  const idx = renderer.indexOf("async function onPayButtonClick() {");
  const endIdx = idx >= 0 ? renderer.indexOf("async function processConfirmedSale(ctx) {", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";

  if (
    scoped.includes("enqueueSaleProcessing(() =>") &&
    scoped.includes("processConfirmedSale({") &&
    !scoped.includes("await enqueueSaleProcessing")
  ) {
    ok(
      "onPayButtonClick enqueues the rest of the sale (processConfirmedSale) without awaiting it, right after freeing the cart",
    );
  } else {
    fail(
      "onPayButtonClick enqueues the rest of the sale (processConfirmedSale) without awaiting it, right after freeing the cart",
    );
  }

  if (!scoped.includes("restoreCartSnapshotWithoutDuplicates")) {
    ok(
      "onPayButtonClick's own (phase 1) catch no longer restores the cart snapshot -- phase 1 never touches the live cart before handoff, so there's nothing to restore",
    );
  } else {
    fail(
      "onPayButtonClick's own (phase 1) catch no longer restores the cart snapshot -- phase 1 never touches the live cart before handoff, so there's nothing to restore",
    );
  }
}

{
  const idx = renderer.indexOf("async function processConfirmedSale(ctx) {");
  const endIdx = idx >= 0 ? renderer.indexOf("function calcExpectedCash(", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";

  mustContain(
    scoped,
    "recoveredTicket = await parkFailedSaleForRetry(",
    "A failed queued sale is recovered via parkFailedSaleForRetry instead of being restored into the live cart",
  );

  if (!scoped.includes("restoreCartSnapshotWithoutDuplicates")) {
    ok(
      "processConfirmedSale never puts a failed sale's items back into the live cart (which may already belong to a different, later customer by the time it fails)",
    );
  } else {
    fail(
      "processConfirmedSale never puts a failed sale's items back into the live cart (which may already belong to a different, later customer by the time it fails)",
    );
  }
}

mustContain(
  renderer,
  "async function parkFailedSaleForRetry(cartSnapshot, ticketPayload, reason) {",
  "parkFailedSaleForRetry helper exists",
);
mustContain(
  renderer,
  'parkingMode: PARKED_MODE_TPV,',
  "parkFailedSaleForRetry creates a real standalone parked ticket (not a live-cart mutation) from the failed sale's snapshot",
);

console.log("\n[SMOKE] Checking 2026-08-27 ticket info (lineas/recibos) is cached, not re-fetched every time the same ticket is reopened\n");

mustContain(
  renderer,
  "const TICKET_INFO_CACHE = new Map();",
  "TICKET_INFO_CACHE exists",
);

{
  const idx = renderer.indexOf("async function openTicketInfoForFactura(facturaRow, options = {}) {");
  const endIdx = idx >= 0 ? renderer.indexOf("const parkedOrigin = getPaidTicketParkedOriginForTicketRow(facturaRow);", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";

  if (
    scoped.includes("const cached = TICKET_INFO_CACHE.get(idfactura);") &&
    scoped.includes("TICKET_INFO_CACHE.set(idfactura, { lineasAll, recibosOriginales });")
  ) {
    ok(
      "openTicketInfoForFactura reuses a cached ticket's lineas/recibos instead of re-fetching them from FacturaScripts every time it's reopened",
    );
  } else {
    fail(
      "openTicketInfoForFactura reuses a cached ticket's lineas/recibos instead of re-fetching them from FacturaScripts every time it's reopened",
    );
  }
}

mustContain(
  renderer,
  "TICKET_INFO_CACHE.delete(Number(facturaRow?.idfactura || 0));",
  "Confirming a refund invalidates that invoice's cached ticket info, so the next open fetches fresh data instead of showing stale pre-refund state",
);

console.log("\n[SMOKE] Checking 2026-08-27 broader sweep of sequential-await -> Promise.all parallelization\n");

{
  const idx = renderer.indexOf("async function getPrintableTicketMeta(ticket) {");
  const endIdx = idx >= 0 ? renderer.indexOf("let soldTotal = 0;", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";
  mustContain(
    scoped,
    "const [origLines, refundedMap] = await Promise.all([",
    "getPrintableTicketMeta (on the cobro/print critical path) fetches original lines and the refunded-qty map in parallel",
  );
}

{
  const idx = renderer.indexOf("async function openRefundForFactura(facturaRow) {");
  const endIdx = idx >= 0 ? renderer.indexOf("// Pendientes (para TODAS las líneas)", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";
  mustContain(
    scoped,
    "const [lineasAll, recibosOriginales, refundedMap] = await Promise.all([",
    "openRefundForFactura fetches lineas/recibos/refunded-map in parallel instead of one after another, keeping each call's own error fallback",
  );
}

{
  const idx = renderer.indexOf("async function saveTerminalFamiliesDialog() {");
  const endIdx = idx >= 0 ? renderer.indexOf("if (!okHidden ||", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";
  mustContain(
    scoped,
    "const [okHidden, okMode, okColors] = await Promise.all([",
    "saveTerminalFamiliesDialog saves its 3 independent settings keys in parallel",
  );
}

mustContain(
  renderer,
  "const [entries, currentVersionRaw] = await Promise.all([\r\n    loadChangelogEntries(),\r\n    getCurrentAppVersionText(),\r\n  ]);",
  "Changelog loading and current-version lookup run in parallel (present in both openChangelogDialog and maybeShowChangelogAfterUpdate)",
);

{
  const count = renderer
    .split(
      "const [entries, currentVersionRaw] = await Promise.all([\r\n    loadChangelogEntries(),\r\n    getCurrentAppVersionText(),\r\n  ]);",
    ).length - 1;
  if (count === 2) {
    ok(
      "Both changelog-loading call sites (openChangelogDialog and maybeShowChangelogAfterUpdate) were parallelized, not just one",
    );
  } else {
    fail(
      `Both changelog-loading call sites (openChangelogDialog and maybeShowChangelogAfterUpdate) were parallelized, not just one (found ${count}, expected 2)`,
    );
  }
}

mustContain(
  renderer,
  "reloadTerminalFamilyHiddenCache().catch(() => {}),\r\n    reloadTerminalFamilyModeCache().catch(() => {}),\r\n    reloadFamilyColorsCache().catch(() => {}),",
  "The boot-time terminal-family/color cache reloads run in parallel instead of one after another",
);

{
  const idx = renderer.indexOf("async function printTicket(ticket) {");
  const endIdx = idx >= 0 ? renderer.indexOf("const isPreprint = !!ticket?._preprint;", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";
  mustContain(
    scoped,
    "const [, baseMetaPrint] = await Promise.all([\r\n      enrichTicketClientForGeneral(ticket),\r\n      getPrintableTicketMeta(ticket),\r\n    ]);",
    "printTicket runs enrichTicketClientForGeneral and getPrintableTicketMeta in parallel (they touch disjoint ticket fields)",
  );
}

{
  const idx = renderer.indexOf("async function openPayModal(total) {");
  const endIdx = idx >= 0 ? renderer.indexOf("payModalState.formas = (formas || [])", idx) : -1;
  const scoped = idx >= 0 && endIdx > idx ? renderer.slice(idx, endIdx) : "";

  if (
    scoped.includes("formasPromise = Promise.resolve(cachedFormasPago);") &&
    scoped.includes("formasPromise = fetchFormasPagoActivas();") &&
    scoped.includes(
      "const [formas] = await Promise.all([formasPromise, ensurePaySeriesLoaded()]);",
    )
  ) {
    ok(
      "openPayModal runs formas-de-pago resolution and ensurePaySeriesLoaded in parallel, even on the cold-cache (first payment of session) path",
    );
  } else {
    fail(
      "openPayModal runs formas-de-pago resolution and ensurePaySeriesLoaded in parallel, even on the cold-cache (first payment of session) path",
    );
  }

  if (!scoped.includes("await ensurePaySeriesLoaded();\r\n") || scoped.split("ensurePaySeriesLoaded()").length - 1 <= 2) {
    ok(
      "openPayModal no longer has a leftover duplicate ensurePaySeriesLoaded() call after the merge",
    );
  } else {
    fail(
      "openPayModal no longer has a leftover duplicate ensurePaySeriesLoaded() call after the merge",
    );
  }
}

{
  // Cierre de caja: los 3 resumenes (tickets por agente, importes por
  // metodo, ventas por agente) se calculan a la vez a partir de los mismos
  // datos ya obtenidos (facturasCajaList/recibosByFactura).
  const idx = renderer.indexOf("const [, , agentSalesSummary] = await Promise.all([");
  if (idx >= 0) {
    const scoped = renderer.slice(idx, idx + 500);
    if (
      scoped.includes("hydrateCloseTicketStatsForCaja(cajaId, facturasCajaList),") &&
      scoped.includes("hydratePaymentsByMethodForClose(") &&
      scoped.includes("buildAgentSalesSummaryForCaja(cajaId, facturasCajaList, recibosByFactura),")
    ) {
      ok(
        "Cash-close builds its 3 independent summaries (ticket stats, payment methods, agent sales) in parallel",
      );
    } else {
      fail(
        "Cash-close builds its 3 independent summaries (ticket stats, payment methods, agent sales) in parallel",
      );
    }
  } else {
    fail(
      "Cash-close builds its 3 independent summaries (ticket stats, payment methods, agent sales) in parallel",
    );
  }
}

{
  // Cierre de caja: apiReadCurrentCaja + ensurePayMethodLabelsLoaded + la
  // primera lectura de facturaclientes (usando el remoteCajaId ya conocido)
  // se piden a la vez, no una detras de otra -- eran ~3 idas y vueltas
  // reales secuenciales antes de poder empezar a calcular el resumen.
  const idx = renderer.indexOf(
    "cashCloseSummaryReadyPromise = (async () => {",
  );
  const endIdx =
    idx >= 0 ? renderer.indexOf("const facturasCajaList", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("const cajaIdHint = cashSession.remoteCajaId || null;") &&
    scoped.includes(
      "const [remoteCaja, , facturasCajaEarly] = await Promise.all([",
    ) &&
    scoped.includes("apiReadCurrentCaja(),") &&
    scoped.includes("ensurePayMethodLabelsLoaded(),") &&
    scoped.includes(
      "cajaIdHint === cajaId && Array.isArray(facturasCajaEarly)",
    )
  ) {
    ok(
      "Cash-close fetches the remote caja, pay-method labels, and the caja's facturas up front, in parallel",
    );
  } else {
    fail(
      "Cash-close fetches the remote caja, pay-method labels, and the caja's facturas up front, in parallel",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-27 'Cobrar' no longer dead-ends when no agent is assigned\n",
);

// Cliente real: con caja abierta y terminal seleccionado pero sin agente
// asignado, "Cobrar" salia deshabilitado (gris) y, al ser un boton
// disabled, tocarlo no disparaba ningun click -- el aviso claro que ya
// existia (requireAssignedAgentOrBlock) nunca llegaba a mostrarse.
{
  const idx = renderer.indexOf("function payButtonNeedsAgentAssignment() {");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 400) : "";
  if (
    scoped.includes("hasActiveLoginSession() &&") &&
    scoped.includes("!!cashSession?.open &&") &&
    scoped.includes("!!currentTerminal?.id &&") &&
    scoped.includes("!hasAssignedAgent()")
  ) {
    ok(
      "payButtonNeedsAgentAssignment() detects the specific 'missing agent only' blocking reason",
    );
  } else {
    fail(
      "payButtonNeedsAgentAssignment() detects the specific 'missing agent only' blocking reason",
    );
  }
}
{
  const idx = renderer.indexOf("function updatePayButtonEnabledState() {");
  const endIdx = idx >= 0 ? renderer.indexOf("refreshPreprintButtonUI();\r\n}", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("if (payButtonNeedsAgentAssignment()) {") &&
    scoped.includes("btn.disabled = false;") &&
    scoped.includes('btn.textContent = "Asignar agente";') &&
    scoped.includes('btn.classList.add("cart-btn-pay-needs-agent");')
  ) {
    ok(
      "'Cobrar' stays enabled (with a distinct look and text) instead of disabled when the only missing thing is the agent",
    );
  } else {
    fail(
      "'Cobrar' stays enabled (with a distinct look and text) instead of disabled when the only missing thing is the agent",
    );
  }
}
mustContain(
  styles,
  ".cart-btn-pay.cart-btn-pay-needs-agent {",
  "'Cobrar' gets a visually distinct color (not the normal green, not the normal disabled gray) in the needs-agent state",
);
{
  const idx = renderer.indexOf("payBtn.onclick = () => {");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 300) : "";
  if (
    scoped.includes("if (payButtonNeedsAgentAssignment()) {") &&
    scoped.includes("requireAssignedAgentOrBlock({ showModal: true });")
  ) {
    ok(
      "Tapping 'Cobrar' in the needs-agent state opens the agent picker directly, instead of running the normal checkout guards",
    );
  } else {
    fail(
      "Tapping 'Cobrar' in the needs-agent state opens the agent picker directly, instead of running the normal checkout guards",
    );
  }
}
{
  // Antes, con un solo terminal y 0 agentes asignados, tocar el nombre del
  // agente para cambiarlo no abria nada -- ahora el propio overlay
  // (agentSwitch) es quien decide que mostrar, incluido el aviso "Este
  // terminal no tiene agentes asignados." que ya existia pero nunca se veia.
  const idx = renderer.indexOf("const tryShowAgentSwitchOverlay = () => {");
  const endIdx = idx >= 0 ? renderer.indexOf("};", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes('showTerminalOverlay("agentSwitch");') &&
    scoped.includes("return true;") &&
    !scoped.includes("if (!list || list.length === 0) return false;")
  ) {
    ok(
      "Changing agent no longer silently no-ops when the terminal has zero agents -- the overlay opens and shows its own 'sin agentes' message",
    );
  } else {
    fail(
      "Changing agent no longer silently no-ops when the terminal has zero agents -- the overlay opens and shows its own 'sin agentes' message",
    );
  }
}
mustContain(
  renderer,
  '"Este terminal no tiene agentes asignados.";',
  "The agentSwitch overlay itself still shows a clear message when the selected terminal has zero agents",
);

console.log(
  "\n[SMOKE] Checking 2026-08-27 a 100%-off tariff line no longer bills full price\n",
);

// Cliente real: con una tarifa de cliente al -100%, el carrito y el modal de
// cobro mostraban 0,00 EUR (correcto), pero la factura real creada en
// FacturaScripts se guardaba con el precio COMPLETO sin descuento. Causa:
// "pricing.unitGross || getUnitGross(item)" trata un 0 legitimo (precio
// final gratis) como "vacio" por ser falsy en JS, y cae al precio sin
// descontar. Afecta solo a descuentos que llevan el precio EXACTAMENTE a 0
// (tarifa -100%, o precio manual a 0), no a descuentos parciales.
{
  const idx = renderer.indexOf("function buildFsLinesFromCart(cartArr) {");
  const endIdx = idx >= 0 ? renderer.indexOf("\r\n}\r\n", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("Number.isFinite(pricing?.unitGross)") &&
    scoped.includes("? pricing.unitGross") &&
    !scoped.includes("Number(pricing?.unitGross || getUnitGross(item) || 0)")
  ) {
    ok(
      "buildFsLinesFromCart (the real sale/invoice line builder) no longer treats a legitimate 0 price as missing",
    );
  } else {
    fail(
      "buildFsLinesFromCart (the real sale/invoice line builder) no longer treats a legitimate 0 price as missing",
    );
  }
}
{
  const idx = renderer.indexOf("function buildCustomerItemsFromCart(cartArr) {");
  const scoped = idx >= 0 ? renderer.slice(idx, idx + 600) : "";
  if (
    scoped.includes("Number.isFinite(pricing?.unitGross)") &&
    !scoped.includes("Number(pricing?.unitGross || getUnitGross(item) || 0)")
  ) {
    ok(
      "buildCustomerItemsFromCart (customer-facing display) has the same 0-price fix, not just the invoice builder",
    );
  } else {
    fail(
      "buildCustomerItemsFromCart (customer-facing display) has the same 0-price fix, not just the invoice builder",
    );
  }
}

// Feedback de cliente real: el texto "Confirmar ticket gratuito" se veia muy
// pequeño/apretado en el boton normal de "Confirmar Pago".
mustContain(
  styles,
  ".pay-btn-free {",
  "'Confirmar ticket gratuito' gets its own, taller/bigger button style",
);
mustContain(
  renderer,
  'paySaveBtn.classList.toggle("pay-btn-free", isFreeTicket);',
  "The free-ticket button style is toggled based on isFreeTicket",
);

console.log(
  "\n[SMOKE] Checking 2026-08-27 the 0-price-tariff fix didn't wipe non-pack sales\n",
);

// Segundo bug, descubierto justo despues de arreglar el primero: una vez
// las lineas con tarifa -100% llegan de verdad a FacturaScripts como 0€,
// patchPackChildrenLinesInFacturaByDesired (pensada solo para limpiar
// "hijos de pack" sobrantes a 0€) las confundia con hijos de pack huerfanos
// y BORRABA TODA LA FACTURA (0 lineas, total 0€) en cualquier venta sin
// ningun pack. Antes del primer fix esto nunca se disparaba porque ninguna
// linea llegaba a FS como 0€ de verdad.
{
  const idx = renderer.indexOf(
    "async function patchPackChildrenLinesInFacturaByDesired({",
  );
  const endIdx = idx >= 0 ? renderer.indexOf("const raw = await fetchLineasFacturaCliente(idfactura);", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (scoped.includes("if (!desired.size) return;")) {
    ok(
      "patchPackChildrenLinesInFacturaByDesired skips entirely (no fetch, no deletes) when the cart had zero pack children",
    );
  } else {
    fail(
      "patchPackChildrenLinesInFacturaByDesired skips entirely (no fetch, no deletes) when the cart had zero pack children",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-27 a 0€ product no longer disappears from the ticket-info modal\n",
);

// El mismo dia, el cliente probo el arreglo anterior y confirmo que la
// factura real quedaba bien (linea guardada a 0€, no borrada) -- pero el
// modal "Informacion de ticket" mostraba la venta VACIA. Otro filtro
// distinto ("solo mostrar lineas con precio > 0, salvo que sean hijos de
// pack") tenia la misma suposicion equivocada: un producto normal a 0€ por
// tarifa no es ni "hijo de pack" ni "precio > 0", asi que desaparecia del
// todo.
{
  const idx = renderer.indexOf(
    "let fsFallbackLines = [];",
  );
  const endIdx = idx >= 0 ? renderer.indexOf("const lineasInfo =", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes(
      "Math.abs(Number(l?.cantidad || 0)) > 0.00001",
    ) &&
    !scoped.includes("return unit > 0.00001;")
  ) {
    ok(
      "openTicketInfoForFactura's fallback line list keeps a 0€ product line as long as it has real quantity",
    );
  } else {
    fail(
      "openTicketInfoForFactura's fallback line list keeps a 0€ product line as long as it has real quantity",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-27 a real 0€ product doesn't get pruned as a pack leftover when the cart also has a real pack\n",
);

// Hueco conocido dejado a proposito tras el fix anterior: si el MISMO
// carrito lleva un pack de verdad Y un producto suelto que tambien vale 0€
// (misma tarifa -100%), ese producto suelto podia seguir borrandose --
// "desired" (hijos de pack deseados) no esta vacio en ese caso, asi que el
// guard de "sin packs, no tocar nada" no protege. Arreglo: la funcion nunca
// borra un producto que el carrito pidio EXPLICITAMENTE (no como hijo de
// pack), sea cual sea su precio.
{
  const idx = renderer.indexOf(
    "async function patchPackChildrenLinesInFacturaByDesired({",
  );
  const endIdx = idx >= 0 ? renderer.indexOf("// Agrupar por idproducto", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("explicitProductIds") &&
    scoped.includes("if (pid && explicitPids.has(pid)) return false;")
  ) {
    ok(
      "patchPackChildrenLinesInFacturaByDesired never deletes a line for a product the cart explicitly asked for, regardless of its price",
    );
  } else {
    fail(
      "patchPackChildrenLinesInFacturaByDesired never deletes a line for a product the cart explicitly asked for, regardless of its price",
    );
  }
}
mustContain(
  renderer,
  "function buildExplicitProductIdsFromCart(cartSnapshot) {",
  "buildExplicitProductIdsFromCart helper exists",
);
mustContain(
  renderer,
  "explicitProductIds: buildExplicitProductIdsFromCart(cartSnapshot),",
  "The real cobro flow passes the cart's explicit (non-pack-child) product ids into the pack reconciliation",
);

console.log(
  "\n[SMOKE] Checking 2026-08-27 same 0€-product protection extended to refunds and payment-method changes\n",
);

// El mismo hueco (un producto suelto a 0€ podia borrarse por confundirse
// con un resto de pack) tambien existia en devoluciones y en el cambio de
// forma de pago de un ticket (ambos crean documentos nuevos y reconcilian
// packs por separado). Mismo arreglo: pasar los idproducto explicitos de
// esa operacion para que nunca se borren, sea cual sea su precio.
mustContain(
  renderer,
  "function buildExplicitProductIdsFromFacturaLines(lines) {",
  "buildExplicitProductIdsFromFacturaLines helper exists (for refund/reissue flows, which work from real FS lines, not a cartSnapshot)",
);
{
  const idx = renderer.indexOf("async function createRefundInFacturaScriptsPackAware(");
  const endIdx = idx >= 0 ? renderer.indexOf("No pude parchear hijos pack en rectificativa", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes(
      "explicitProductIds: buildExplicitProductIdsFromFacturaLines(outLines),",
    )
  ) {
    ok(
      "Refunds (createRefundInFacturaScriptsPackAware) protect the explicit lines being refunded from being pruned as pack leftovers",
    );
  } else {
    fail(
      "Refunds (createRefundInFacturaScriptsPackAware) protect the explicit lines being refunded from being pruned as pack leftovers",
    );
  }
}
{
  const idx = renderer.indexOf("async function changeTicketPaymentMethodByReissue(");
  const endIdx = idx >= 0 ? renderer.indexOf("async function createRefundInFacturaScriptsPackAware(", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  const occurrences = (
    scoped.match(
      /explicitProductIds: buildExplicitProductIdsFromFacturaLines\(lineasFactura\),/g,
    ) || []
  ).length;
  if (occurrences >= 2) {
    ok(
      "Changing a ticket's payment method (both the rectificativa and the new reissued ticket) protects explicit lines from being pruned as pack leftovers",
    );
  } else {
    fail(
      `Changing a ticket's payment method (both the rectificativa and the new reissued ticket) protects explicit lines from being pruned as pack leftovers (found ${occurrences}, expected >= 2)`,
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-27 refunding a 0€ ticket is possible again, and 'cambiar pago' hides on it\n",
);

// Cuarto bug de la misma familia: la lista de lineas SELECCIONABLES en el
// dialogo de devolucion ocultaba cualquier linea a 0€ (pensado para no
// dejar marcar hijos de pack sueltos), asi que en un ticket donde TODO vale
// 0€ (tarifa -100%) la lista quedaba vacia y no se podia devolver nada --
// ni para ajustar stock, que es justo para lo que sirve devolver un ticket
// gratuito (no hay dinero que devolver). Ahora solo se ocultan los hijos
// REALES de un pack (comprobado contra la definicion del pack, no solo por
// precio); un producto suelto a 0€ se puede seleccionar y devolver igual
// que cualquier otro.
{
  const idx = renderer.indexOf("async function openRefundForFactura(facturaRow) {");
  const endIdx = idx >= 0 ? renderer.indexOf("refundState.factura = facturaRow;", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("const isLikelyPackChildLine = (l) => {") &&
    scoped.includes(
      "const lineasUI = lineasPendientesAll.filter((l) => !isLikelyPackChildLine(l));",
    )
  ) {
    ok(
      "openRefundForFactura only hides genuine pack children from the selectable list, not every 0€ line",
    );
  } else {
    fail(
      "openRefundForFactura only hides genuine pack children from the selectable list, not every 0€ line",
    );
  }
}

// Peticion de cliente: devolver un ticket a 0€ es para ajustar stock, no
// para devolver dinero -- y cambiar la forma de pago de un ticket a 0€ no
// tiene sentido (no hay pago que cambiar), asi que ese boton no deberia ni
// aparecer en un ticket asi.
{
  const idx = renderer.indexOf('<button type="button" class="ticket-btn ticket-payedit"');
  const scoped = idx >= 0 ? renderer.slice(Math.max(0, idx - 200), idx) : "";
  if (scoped.includes("Math.abs(totalNum) < 0.00001")) {
    ok(
      "The 'cambiar pago' (💳) button is omitted entirely for a 0€ ticket, not just left clickable",
    );
  } else {
    fail(
      "The 'cambiar pago' (💳) button is omitted entirely for a 0€ ticket, not just left clickable",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-27 the very first cobro of a session no longer stacks duplicate requests\n",
);

// Cliente real: aunque el primer cobro de la sesion ya precalentaba formas
// de pago/series al abrir/recuperar caja, ese precalentamiento y el propio
// modal de cobro (si el cliente llegaba rapido) podian disparar VARIAS
// peticiones identicas en paralelo al mismo endpoint lento -- medido en
// real: hasta 4 peticiones simultaneas a "formapagos", cada una tardando
// 2s+ por su cuenta, y el modal de cobro esperando a la suya propia en vez
// de aprovechar una que ya estuviera en vuelo (~6s hasta ver el modal).
// Ahora todas comparten la misma peticion en curso.
mustContain(
  renderer,
  "let __formasPagoInFlight = null;",
  "fetchFormasPagoActivas tracks an in-flight request to share across callers",
);
mustContain(
  renderer,
  "async function fetchFormasPagoActivasOnline() {",
  "The real online fetch was split into its own function so fetchFormasPagoActivas can dedupe around it",
);
{
  const idx = renderer.indexOf("async function fetchFormasPagoActivas(opts = {}) {");
  const endIdx = idx >= 0 ? renderer.indexOf("async function fetchFormasPagoActivasOnline", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("if (__formasPagoInFlight) return __formasPagoInFlight;") &&
    scoped.includes("__formasPagoInFlight = fetchFormasPagoActivasOnline();")
  ) {
    ok(
      "fetchFormasPagoActivas reuses an already in-flight request instead of firing a duplicate one",
    );
  } else {
    fail(
      "fetchFormasPagoActivas reuses an already in-flight request instead of firing a duplicate one",
    );
  }
}
mustContain(
  renderer,
  "let __paySeriesInFlight = null;",
  "The 'series' fetch (used by both ensurePaySeriesLoaded and forceRefreshPaySeries) also tracks an in-flight request",
);

console.log(
  "\n[SMOKE] Checking 2026-08-27 Opciones no longer re-fetches the whole client list every time it opens\n",
);

// Cliente real: Opciones seguia notandose al abrir. loadClientesForTerminalSelect
// (para el select de "cliente por defecto del terminal") pedia SIEMPRE el
// listado COMPLETO de clientes a FacturaScripts de cero, aunque
// CUSTOMER_SELECTOR ya tiene ese mismo listado cargado en memoria desde el
// arranque. Ahora lo reutiliza para abrir al instante, y de fondo pide la
// version online real y la deja en memoria para la proxima vez -- para no
// perder frescura si un cliente cambia algo directamente en FacturaScripts
// (sin pasar por este TPV).
mustContain(
  renderer,
  "async function fetchClientesOnlineForTerminalSelect() {",
  "fetchClientesOnlineForTerminalSelect (the real online fetch) exists as its own function",
);
{
  const idx = renderer.indexOf("async function loadClientesForTerminalSelect() {");
  const endIdx = idx >= 0 ? renderer.indexOf("\r\n}\r\n", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("const mem = window.CUSTOMER_SELECTOR?.listCustomers?.();") &&
    scoped.includes("fetchClientesOnlineForTerminalSelect()") &&
    scoped.includes("window.CUSTOMER_SELECTOR._customers = fresh;")
  ) {
    ok(
      "loadClientesForTerminalSelect returns the already-loaded CUSTOMER_SELECTOR list instantly, and refreshes it online in the background for next time",
    );
  } else {
    fail(
      "loadClientesForTerminalSelect returns the already-loaded CUSTOMER_SELECTOR list instantly, and refreshes it online in the background for next time",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-27 Opciones: tarifas/clientes por defecto ya no se piden en fila\n",
);

// Medido en real: abrir Opciones justo tras abrir/recuperar caja (con las
// cachés de tarifas y clientes-por-tarifa todavia sin calentar) tardaba
// 6.8s en total. Dos causas, ambas del mismo tipo (peticiones
// independientes pedidas una detras de otra en vez de a la vez):
{
  const idx = renderer.indexOf("async function renderTariffCustomerSelectForTariff(codtarifa, opts = {}) {");
  const endIdx = idx >= 0 ? renderer.indexOf("const search = getTariffCustomerSearchText();", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("if (!Array.isArray(serverAssignedCodes) && !force) {") &&
    scoped.includes(
      '.filter((c) => String(c.codtarifa || "") === cod)',
    )
  ) {
    ok(
      "renderTariffCustomerSelectForTariff computes 'which customers use this tariff' locally from the already-loaded customer list, instead of always re-fetching from FacturaScripts",
    );
  } else {
    fail(
      "renderTariffCustomerSelectForTariff computes 'which customers use this tariff' locally from the already-loaded customer list, instead of always re-fetching from FacturaScripts",
    );
  }
}
{
  const idx = renderer.indexOf("async function loadTariffManagerOptionsData(opts = {}) {");
  const endIdx = idx >= 0 ? renderer.indexOf("async function updateClienteCodtarifa(", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes(
      "const customersPreloadPromise = loadTariffCustomersCache({ force }).catch(",
    ) &&
    scoped.includes("await customersPreloadPromise;")
  ) {
    ok(
      "loadTariffManagerOptionsData fetches the tariff list and the customer list in parallel, instead of the customer fetch only starting after the tariff list resolves",
    );
  } else {
    fail(
      "loadTariffManagerOptionsData fetches the tariff list and the customer list in parallel, instead of the customer fetch only starting after the tariff list resolves",
    );
  }
}
{
  const idx = renderer.indexOf("async function openOptions(");
  const endIdx = idx >= 0 ? renderer.indexOf("function closeOptions() {", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes(
      "const defaultCustomerRefreshPromise = maybeRefreshTerminalDefaultCustomer(",
    ) &&
    scoped.includes("await defaultCustomerRefreshPromise;") &&
    scoped.indexOf("const defaultCustomerRefreshPromise") <
      scoped.indexOf("const [st] = await Promise.all([")
  ) {
    ok(
      "openOptions starts refreshing the terminal's default customer up front (parallel with the ~30 settings loaders), instead of waiting until after all of them finish",
    );
  } else {
    fail(
      "openOptions starts refreshing the terminal's default customer up front (parallel with the ~30 settings loaders), instead of waiting until after all of them finish",
    );
  }
}

console.log(
  "\n[SMOKE] Checking 2026-08-27 a sale is attributed to the agent who actually made it, not whoever is active when it finally syncs\n",
);

// Cliente real (Los Argentinos): aparecian ventas en el cierre de caja
// atribuidas a un "Agente —" vacio que nadie habia cargado, de forma
// recurrente en el tiempo. Causa: la fase 2 de cada venta (processConfirmedSale,
// enqueueSaleProcessing) se procesa en una cola serial en segundo plano --
// para cuando le toca el turno, currentAgent/currentTerminal (variables
// EN VIVO) ya pueden ser de OTRO cliente/agente, o estar momentaneamente
// vacias (p.ej. justo tras un corte de red). Arreglo: se toma una foto fija
// del agente/almacen en el momento REAL de cobrar (fase 1, junto a
// _payNick) y esa foto es la que se usa despues, nunca el estado en vivo.
mustContain(
  renderer,
  "ticketPayload._payCodAgente = String(currentAgent?.codagente || \"\").trim();",
  "onPayButtonClick snapshots the active agent's codagente at confirm time (phase 1), same as it already did for _payNick",
);
mustContain(
  renderer,
  "ticketPayload._payCodAlmacen = String(",
  "onPayButtonClick also snapshots the terminal's codalmacen at confirm time",
);
{
  const idx = renderer.indexOf("// Update factura (tpv_efectivo=entregado cash, tpv_cambio=cambio)");
  const endIdx = idx >= 0 ? renderer.indexOf("await updateFacturaCliente(idfactura, upd);", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, endIdx) : "";
  if (
    scoped.includes("idtpv: ticketPayload.idtpv || \"\",") &&
    scoped.includes("codalmacen: ticketPayload._payCodAlmacen || \"\",") &&
    scoped.includes("if (ticketPayload._payCodAgente) upd.codagente = ticketPayload._payCodAgente;") &&
    !scoped.includes("idtpv: currentTerminal?.id || \"\",") &&
    !scoped.includes("if (currentAgent?.codagente) upd.codagente = currentAgent.codagente;")
  ) {
    ok(
      "processConfirmedSale's post-creation factura update uses the phase-1 snapshot (idtpv/codalmacen/codagente), not the live currentTerminal/currentAgent",
    );
  } else {
    fail(
      "processConfirmedSale's post-creation factura update uses the phase-1 snapshot (idtpv/codalmacen/codagente), not the live currentTerminal/currentAgent",
    );
  }
}
{
  const occurrences = (
    renderer.match(
      /agentCode: ticketPayload\._payCodAgente \|\| "",\r?\n\s*agentName: ticketPayload\._payNick \|\| "",/g,
    ) || []
  ).length;
  if (occurrences >= 2) {
    ok(
      "Both appendPaymentsToCashLedger calls in processConfirmedSale (offline-queued and online) use the phase-1 agent snapshot too",
    );
  } else {
    fail(
      `Both appendPaymentsToCashLedger calls in processConfirmedSale (offline-queued and online) use the phase-1 agent snapshot too (found ${occurrences}, expected >= 2)`,
    );
  }
}
{
  const idx = renderer.indexOf("async function sendOrQueueFactura(payload) {");
  const endIdx = idx >= 0 ? renderer.indexOf("await window.TPV_QUEUE.enqueue(", idx) : -1;
  const scoped = idx >= 0 && endIdx >= 0 ? renderer.slice(idx, renderer.indexOf("createdAt: new Date().toISOString(),", idx)) : "";
  if (
    scoped.includes("terminal: payload?.idtpv") &&
    scoped.includes("agente: payload?._payCodAgente") &&
    !scoped.includes("terminal: currentTerminal\r\n          ? { id: currentTerminal.id")
  ) {
    ok(
      "The offline-queue enqueue path (sendOrQueueFactura) also stores the phase-1 agent/terminal snapshot, not live state read whenever the network happens to fail",
    );
  } else {
    fail(
      "The offline-queue enqueue path (sendOrQueueFactura) also stores the phase-1 agent/terminal snapshot, not live state read whenever the network happens to fail",
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
