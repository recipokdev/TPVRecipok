// Encargos (pedidos con pago a cuenta) -- parte del TPV. Diseno: docs/diseno-pedidos-con-pago-a-cuenta.md.
// Se carga DESPUES de renderer.js y usa sus funciones globales (fmtMoney, confirmModal, fetchWithTimeout...).
// Con la opcion apagada (por defecto) no cambia nada en pantalla: los botones siguen ocultos y no se hace
// ninguna llamada al servidor.
//
// Reparto de datos (ver el diseno):
//   - FacturaScripts guarda el PEDIDO (lineas, cliente, total, reserva de stock). Lo crea el propio TPV con la
//     API del cliente, igual que las ventas, con el codigo del encargo en numero2 (asi un reintento no duplica).
//   - Nuestro servidor guarda el encargo (hora de recogida, telefono, dedicatoria, estado) y el DINERO
//     (anticipos y devoluciones), porque FacturaScripts no admite pagos a cuenta en un pedido.
//   - El dinero tambien se escribe en las observaciones del pedido de FacturaScripts para que se vea alli.
(function () {
  "use strict";

  const CFG_ENABLED_KEY = "ui.encargosEnabled";
  const CFG_NOVELTY_SEEN_KEY = "ui.encargosNoveltySeen";

  const state = {
    enabled: false,
    // true | false | null (sin comprobar). El servidor responde "desactivado" si la empresa no esta en el piloto.
    serverAvailable: null,
  };

  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, "0");

  // ------------------------------------------------------------------ configuracion

  async function cfgGet(key) {
    try {
      return await window.TPV_CFG?.get?.(key);
    } catch {
      return undefined;
    }
  }

  async function cfgSet(key, value) {
    try {
      await window.TPV_CFG?.set?.(key, value);
    } catch (e) {
      console.warn("[ENCARGOS] no se pudo guardar", key, e?.message || e);
    }
  }

  function isEnabled() {
    return !!state.enabled;
  }

  async function loadEnabled() {
    const v = await cfgGet(CFG_ENABLED_KEY);
    state.enabled = v !== undefined && v !== null && v !== "" ? parseBoolLike(v, false) : false;
    const el = $("encargosEnabledToggle");
    if (el) el.checked = state.enabled;
    applyUI();
  }

  // Botones visibles solo con la opcion activada. La clase en la botonera cambia la distribucion
  // (Encargos arriba a la izquierda, Vaciar pequeno junto a Tickets); apagada, la botonera queda como siempre.
  function applyUI() {
    const on = isEnabled();
    $("encargosListBtn")?.classList.toggle("hidden", !on);
    $("passToEncargoBtn")?.classList.toggle("hidden", !on);
    $("cartActionGrid")?.classList.toggle("encargos-on", on);
    if (!on) setBadge(0, false);
    refreshPassButton();
  }

  function setBadge(count, overdue) {
    const badge = $("encargosCountBadge");
    if (!badge) return;
    badge.textContent = String(Math.max(0, Number(count) || 0));
    badge.classList.toggle("is-alert", !!overdue);
  }

  // "Pasar a encargo" solo se puede pulsar con productos en el carrito y sin un pedido aparcado cargado (el carrito
  // de un aparcado pertenece a ese pedido: hay que cobrarlo o soltarlo antes).
  function passButtonReason() {
    if (typeof cashSession === "undefined" || !cashSession?.open) return "Abre la caja para poder pasar a encargo.";
    if (!hasVisibleCartLines()) return "Añade productos al carrito para pasarlos a encargo.";
    if (currentParkedTicketIndex != null)
      return "Este carrito pertenece a un pedido aparcado: cóbralo o ábrelo sin aparcar para pasarlo a encargo.";
    if (typeof MESAS_INLINE_ACTIVE !== "undefined" && MESAS_INLINE_ACTIVE && MESAS_INLINE_VIEW === "transacciones")
      return "En Modo Mesas, crea los encargos desde el TPV, fuera de las mesas.";
    return "";
  }

  function refreshPassButton() {
    const btn = $("passToEncargoBtn");
    if (!btn || !isEnabled()) return;
    const reason = passButtonReason();
    btn.disabled = !!reason;
    btn.title = reason || "Convertir este carrito en un encargo";
  }

  // ------------------------------------------------------------------ servidor

  function getScope() {
    return {
      slug: String(getCurrentSlugForReservations() || "").trim(),
      codalmacen: String(getCurrentWarehouseCode() || "").trim(),
    };
  }

  // Llamada a una accion de Encargos. Devuelve { ok, status, json } sin lanzar por errores HTTP esperables
  // (409 desactivado, 412 conflicto, 422 no permitido, 423 candado...); lanza solo si no hay red.
  async function call(action, { method = "GET", query = {}, body = null, timeoutMs = 15000 } = {}) {
    const { slug, codalmacen } = getScope();
    if (!slug) throw new Error("Falta la empresa del TPV.");
    const headers = { Accept: "application/json", "X-TPV-API-KEY": getTpvSyncApiKey() };
    let url = `${TPV_SYNC_API_URL}?action=${encodeURIComponent(action)}`;
    const init = { method, headers };
    if (method === "GET") {
      const q = new URLSearchParams({ slug, codalmacen, ...query });
      url += `&${q.toString()}`;
    } else {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify({ slug, codalmacen, ...(body || {}) });
    }
    const res = await fetchWithTimeout(url, init, timeoutMs);
    const json = await res.json().catch(() => null);
    if (res.status === 409 && json?.customerOrdersDisabled) state.serverAvailable = false;
    else if (res.ok) state.serverAvailable = true;
    return { ok: res.ok && json?.ok !== false, status: res.status, json };
  }

  // Las escrituras son repetibles (codigo de encargo / de operacion), asi que ante un fallo de red se reintenta
  // la MISMA llamada sin riesgo de duplicar nada.
  async function postWithRetry(action, body, attempts = 3) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        return await call(action, { method: "POST", body, timeoutMs: 20000 });
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 700 * (i + 1)));
      }
    }
    throw lastErr || new Error("Sin conexión con el servidor.");
  }

  // ------------------------------------------------------------------ opcion en Opciones

  async function onToggleChanged(wanted) {
    const el = $("encargosEnabledToggle");
    if (wanted) {
      // No se activa en una empresa a la que el servidor aun no le ha dado Encargos: los botones
      // saldrian y todo fallaria.
      let r = null;
      try {
        r = await call("list-customer-orders", { query: { status: "pendiente", limit: "1" } });
      } catch {
        r = null;
      }
      if (r && r.status === 409 && r.json?.customerOrdersDisabled) {
        if (el) el.checked = false;
        state.enabled = false;
        applyUI();
        showMessageModal(
          "Encargos todavía no está disponible",
          "Encargos aún no está activado en el servidor para esta empresa. Cuando lo esté, podrás activarlo aquí.",
        );
        return;
      }
      if (!r) {
        if (el) el.checked = false;
        state.enabled = false;
        applyUI();
        showMessageModal(
          "No se pudo activar Encargos",
          "No hay conexión con el servidor. Conéctate a internet e inténtalo de nuevo.",
        );
        return;
      }
    }
    state.enabled = !!wanted;
    await cfgSet(CFG_ENABLED_KEY, state.enabled);
    // Quien lo activa a mano ya conoce la novedad: no se le avisa despues.
    if (state.enabled) await cfgSet(CFG_NOVELTY_SEEN_KEY, true);
    applyUI();
    if (state.enabled) refreshCount().catch(() => {});
  }

  let toggleBound = false;
  function bindToggleOnce() {
    if (toggleBound) return;
    toggleBound = true;
    const el = $("encargosEnabledToggle");
    if (!el) return;
    el.addEventListener("change", () => onToggleChanged(!!el.checked));
  }

  // ------------------------------------------------------------------ fechas

  function dateKey(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = String(key || "").split("-").map((x) => Number(x));
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function addDays(d, n) {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    c.setDate(c.getDate() + n);
    return c;
  }

  function dayLabelLong(key) {
    const d = parseDateKey(key);
    return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" }).replace(".", "");
  }

  // "hoy a las 20:30" / "mañana a las 12:00" / "jueves 29 oct a las 20:30"
  function pickupLabel(pickupAt) {
    const [day, time] = String(pickupAt || "").split(" ");
    const today = dateKey(new Date());
    const tomorrow = dateKey(addDays(new Date(), 1));
    const dayText = day === today ? "hoy" : day === tomorrow ? "mañana" : dayLabelLong(day);
    return `${dayText} a las ${time || "--:--"}`;
  }

  function formatDateTimeEs(ms) {
    const d = new Date(Number(ms) || Date.now());
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // ------------------------------------------------------------------ contador del boton

  // Encargos de hoy y vencidos que faltan por recoger; en rojo si hay alguno vencido.
  async function refreshCount() {
    // "offline" vive en el TPV_STATE de renderer.js (let global); "isAdmin" en window.TPV_STATE.
    if (!isEnabled() || (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline)) return;
    const today = dateKey(new Date());
    const r = await call("list-customer-orders", { query: { status: "pendiente", to: today, limit: "500" } });
    if (!r.ok) return;
    const rows = Array.isArray(r.json?.data) ? r.json.data : [];
    const overdue = rows.filter((o) => String(o.pickupAt || "").slice(0, 10) < today).length;
    setBadge(rows.length, overdue > 0);
  }

  // ------------------------------------------------------------------ aviso de la novedad (una vez)

  // Sale una sola vez por terminal, a un administrador, cuando la opcion sigue apagada. Se espera a que no haya
  // otro cuadro abierto (login, changelog...) para no taparlo.
  let noveltyTimer = null;
  function scheduleNovelty() {
    if (noveltyTimer) return;
    let tries = 0;
    noveltyTimer = setInterval(async () => {
      tries++;
      if (tries > 400) {
        clearInterval(noveltyTimer);
        noveltyTimer = null;
        return;
      }
      if (!(await noveltyCanShowNow())) return;
      clearInterval(noveltyTimer);
      noveltyTimer = null;
      showNovelty();
    }, 3000);
  }

  async function noveltyCanShowNow() {
    if (!window.TPV_STATE?.isAdmin) return false;
    const seen = await cfgGet(CFG_NOVELTY_SEEN_KEY);
    if (seen !== undefined && seen !== null && seen !== "" && parseBoolLike(seen, false)) {
      // Ya la vio: no hay nada que esperar.
      clearInterval(noveltyTimer);
      noveltyTimer = null;
      return false;
    }
    if (isEnabled()) return false;
    if (document.body.classList.contains("modal-locked")) return false;
    if (document.querySelector(".simple-overlay:not(.hidden), .critical-overlay:not(.hidden)")) return false;
    return !!getCurrentSlugForReservations();
  }

  function showNovelty() {
    const overlay = $("encargosNoveltyOverlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    lockAppUI();
    // Cuenta como vista en cuanto sale: aunque se cierre el programa, no vuelve a molestar.
    cfgSet(CFG_NOVELTY_SEEN_KEY, true);
    const close = () => {
      overlay.classList.add("hidden");
      unlockAppUI();
    };
    const later = $("encargosNoveltyLaterBtn");
    const now = $("encargosNoveltyEnableBtn");
    if (later) later.onclick = close;
    if (now)
      now.onclick = async () => {
        close();
        const el = $("encargosEnabledToggle");
        if (el) el.checked = true;
        await onToggleChanged(true);
      };
  }

  // ------------------------------------------------------------------ pedido en FacturaScripts

  function fsCfg() {
    const cfg = window.RECIPOK_API || {};
    if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Falta la configuración de FacturaScripts (baseUrl/apiKey).");
    return cfg;
  }

  async function findFsPedidoByNumero2(numero2) {
    const cfg = fsCfg();
    const base = String(cfg.baseUrl).replace(/\/+$/, "");
    const params = new URLSearchParams();
    params.set("filter[numero2]", String(numero2));
    params.set("limit", "1");
    const res = await fetch(`${base}/pedidoclientes?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", Token: cfg.apiKey },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return rows.length ? rows[0] : null;
  }

  // Crea el pedido de venta (reserva el stock, NO es una venta). Si ya existe uno con ese numero2 (un intento
  // anterior que dio timeout), se usa ese: nunca se duplica.
  async function createFsPedido({ numero2, codcliente, codalmacen, observaciones, lineas, codagente, nick }) {
    const existing = await findFsPedidoByNumero2(numero2).catch(() => null);
    if (existing) return normalizeFsDoc(existing);

    const fields = {
      codcliente,
      numero2,
      observaciones,
      fecha: `${pad2(new Date().getDate())}-${pad2(new Date().getMonth() + 1)}-${new Date().getFullYear()}`,
      lineas: JSON.stringify(lineas),
    };
    if (codalmacen) fields.codalmacen = codalmacen;
    if (codagente) fields.codagente = codagente;
    if (nick) fields.nick = nick;
    // FacturaScripts tarda ~2,7 s por linea en algunos clientes: el limite crece con las lineas.
    const timeoutMs = Math.min(120000, Math.max(20000, 12000 + 4000 * lineas.length));
    try {
      const data = await apiWrite("crearPedidoCliente", "POST", fields, { timeoutMs });
      const doc = data?.doc || data?.data || null;
      if (doc && (doc.idpedido || doc.id)) return normalizeFsDoc(doc);
    } catch (e) {
      // Respuesta ambigua (timeout, 5xx): puede haberse creado igualmente. Se comprueba antes de dar el fallo.
      const recovered = await findFsPedidoByNumero2(numero2).catch(() => null);
      if (recovered) return normalizeFsDoc(recovered);
      throw e;
    }
    const recovered = await findFsPedidoByNumero2(numero2).catch(() => null);
    if (recovered) return normalizeFsDoc(recovered);
    throw new Error("FacturaScripts no devolvió el pedido creado.");
  }

  function normalizeFsDoc(d) {
    return {
      idpedido: String(d.idpedido || d.id || ""),
      codigo: String(d.codigo || ""),
      total: Number(d.total),
    };
  }

  // Estado de un pedido de venta por su nombre ("Cancelado", "Facturar"...): los ids cambian de una instalacion a otra.
  const fsStateCache = {};
  async function getFsPedidoStateId(kind) {
    if (fsStateCache[kind]) return fsStateCache[kind];
    // El recurso de la API se llama "estadodocumentos" (no "estadosdocumentos").
    const rows = await apiRead("estadodocumentos?limit=100&filter[tipodoc]=PedidoCliente");
    const list = (Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : []).filter(
      (r) => String(r.tipodoc || "PedidoCliente") === "PedidoCliente",
    );
    const norm = (s) => String(s || "").trim().toLowerCase();
    let found = null;
    if (kind === "cancelado") found = list.find((r) => norm(r.nombre) === "cancelado");
    if (kind === "facturar") found = list.find((r) => String(r.generadoc || "") === "FacturaCliente");
    if (!found) throw new Error(`No se encontró el estado «${kind}» de los pedidos en FacturaScripts.`);
    fsStateCache[kind] = Number(found.idestado);
    return fsStateCache[kind];
  }

  async function cancelFsPedidoQuietly(idpedido) {
    try {
      if (!idpedido) return;
      const idestado = await getFsPedidoStateId("cancelado");
      await apiWrite(`pedidoclientes/${encodeURIComponent(idpedido)}`, "PUT", { idestado });
    } catch (e) {
      console.warn("[ENCARGOS] no se pudo cancelar el pedido de FacturaScripts:", e?.message || e);
    }
  }

  // Texto de las observaciones del pedido de FacturaScripts, generado SIEMPRE desde lo que dice nuestro servidor
  // (nunca se "añade" a ciegas: repetirlo da el mismo texto). Asi quien mire el pedido en FacturaScripts ve el dinero.
  async function buildFsObservaciones(order) {
    let labels = {};
    try {
      labels = await getFormasPagoMap();
    } catch {}
    const money = (n) => fmtMoney(n, { symbol: true });
    const pay = (c) => labels[String(c || "").trim()] || String(c || "").trim();
    const out = [];
    out.push(`ENCARGO ${order.orderCode} · ${order.customerName}${order.customerPhone ? " · " + order.customerPhone : ""}`);
    out.push(`Recogida: ${pickupLabel(order.pickupAt)}`);
    if (order.notes) out.push(`Nota: ${order.notes}`);
    (order.moves || []).forEach((m) => {
      if (m.kind === "anticipo") out.push(`Anticipo ${money(m.amount)} (${pay(m.codpago)}) el ${formatDateTimeEs(m.createdAtMs)}`);
      else if (m.kind === "devolucion") out.push(`Devuelto ${money(m.amount)} (${pay(m.codpago)}) el ${formatDateTimeEs(m.createdAtMs)}`);
      else if (m.kind === "resto") out.push(`Cobrado al recoger ${money(m.amount)} (${pay(m.codpago)}) el ${formatDateTimeEs(m.createdAtMs)}`);
    });
    if (order.status === "cancelado") out.push("ENCARGO CANCELADO");
    if (order.status === "cerrado_sin_recoger") out.push("CERRADO SIN RECOGER (facturado lo anticipado)");
    if (order.status === "recogido") out.push("RECOGIDO");
    return out.join("\n");
  }

  // Mejor esfuerzo: si falla, el dinero sigue bien en nuestro servidor y solo falta el texto en FacturaScripts.
  async function syncFsObservaciones(order) {
    try {
      if (!order?.fsIdpedido) return false;
      const observaciones = await buildFsObservaciones(order);
      await apiWrite(`pedidoclientes/${encodeURIComponent(order.fsIdpedido)}`, "PUT", { observaciones });
      return true;
    } catch (e) {
      console.warn("[ENCARGOS] no se pudieron actualizar las observaciones del pedido:", e?.message || e);
      return false;
    }
  }

  // ------------------------------------------------------------------ asistente «Nuevo encargo»

  const wiz = {
    open: false,
    mode: "new", // "new" = nuevo encargo; "advance" = cobrar otro anticipo de un encargo ya guardado
    order: null,
    collected: 0,
    opCode: "",
    page: 1,
    saving: false,
    orderCode: "",
    fsDoc: null,
    snapshot: [],
    total: 0,
    codcliente: "",
    customerName: "",
    day: "today",
    customDay: "",
    time: "12:00",
    amountText: "",
    cashText: "",
    cashTouched: false,
    activeField: "amount",
    codpago: "",
    formas: [],
  };

  function makeOrderCode() {
    const rnd = Math.random().toString(36).slice(2, 4).toUpperCase();
    return `ENC-${String(currentTerminal?.id || "0")}-${Date.now().toString(36).toUpperCase()}${rnd}`;
  }

  function wizDayKey() {
    if (wiz.day === "today") return dateKey(new Date());
    if (wiz.day === "tomorrow") return dateKey(addDays(new Date(), 1));
    return wiz.customDay || dateKey(new Date());
  }

  function defaultTimeForToday() {
    const t = new Date(Date.now() + 60 * 60 * 1000);
    const mins = t.getMinutes() <= 30 ? 30 : 60;
    t.setMinutes(0, 0, 0);
    t.setMinutes(mins);
    return `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  }

  function wizAgentName() {
    return String(currentAgent?.name || currentAgent?.nick || getLoginUser?.() || "").trim();
  }

  function visibleSnapshotLines() {
    return getVisibleCartLines(wiz.snapshot);
  }

  function wizLinesForSave() {
    return visibleSnapshotLines().map((it) => {
      const pricing = getCartLinePricing(it);
      const addons = Array.isArray(it.addons) ? it.addons.map((a) => String(a?.nombre || "").trim()).filter(Boolean) : [];
      const name = String(it.name || it.descripcion || it.referencia || "Producto").trim();
      return {
        name: addons.length ? `${name} (+${addons.join(", +")})` : name,
        qty: Number(it.qty) || 0,
        unit: pricing.unitGross,
        total: pricing.lineTotal,
      };
    });
  }

  async function openWizard() {
    if (!isEnabled()) return;
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) {
      toast("Encargos necesita conexión con el servidor.", "warn", "Encargos");
      return;
    }
    const reason = passButtonReason();
    if (reason) {
      toast(reason, "warn", "Encargos");
      return;
    }
    if (!(await requireAssignedAgentOrBlock({ showModal: true }))) return;
    if (typeof activeCustomerTariffReadyPromise !== "undefined") await activeCustomerTariffReadyPromise;

    wiz.snapshot = (Array.isArray(cart) ? cart : []).map((l) => ({ ...l }));
    wiz.total = round2(getCartTotal(wiz.snapshot));
    if (!(wiz.total > 0)) {
      toast("El total del encargo debe ser mayor que cero.", "warn", "Encargos");
      return;
    }
    const customer = window.CUSTOMER_SELECTOR?.getSelectedCustomer?.() || {};
    wiz.codcliente = String(customer.codcliente || currentTerminal?.codcliente || "1");
    wiz.customerName = String(customer.nombre || "").trim() || "Cliente por defecto";

    wiz.mode = "new";
    wiz.order = null;
    wiz.collected = 0;
    wiz.opCode = "";
    wiz.orderCode = "";
    wiz.fsDoc = null;
    wiz.saving = false;
    wiz.page = 1;
    wiz.day = "today";
    wiz.customDay = "";
    wiz.time = defaultTimeForToday();
    wiz.amountText = "";
    wiz.cashText = "";
    wiz.cashTouched = false;
    wiz.activeField = "amount";

    // Formas de pago (con la copia local mientras llegan las de verdad)
    try {
      const cached = loadPayMethodsCache();
      const list = Array.isArray(cached) && cached.length ? cached : await fetchFormasPagoActivas();
      wiz.formas = (list || [])
        .map((f) => ({ codpago: String(f.codpago || "").trim(), descripcion: String(f.descripcion || f.codpago || "").trim() }))
        .filter((x) => x.codpago);
    } catch {
      wiz.formas = [];
    }
    if (!wiz.formas.length) wiz.formas = [{ codpago: "CONT", descripcion: "Efectivo" }];
    wiz.codpago = (wiz.formas.find((f) => f.codpago === "CONT") || wiz.formas[0]).codpago;

    $("encName").value = "";
    $("encPhone").value = "";
    $("encNotes").value = "";
    $("encDayInput").value = "";
    $("encSumDetail").classList.add("hidden");
    showWizError("");

    wiz.open = true;
    $("encargoWizardOverlay").classList.remove("hidden");
    lockAppUI();
    renderWizard();
  }

  function closeWizard({ keepOrphanCheck = false } = {}) {
    if (!wiz.open) return;
    wiz.open = false;
    $("encargoWizardOverlay").classList.add("hidden");
    unlockAppUI();
    // Si el pedido de FacturaScripts llegó a crearse pero el encargo no se guardó, no se deja huérfano reservando stock.
    if (!keepOrphanCheck && wiz.fsDoc && !wiz.savedOk) cancelFsPedidoQuietly(wiz.fsDoc.idpedido);
    wiz.fsDoc = null;
    wiz.orderCode = "";
    wiz.savedOk = false;
  }

  function showWizError(msg) {
    const el = $("encWizError");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
  }

  function amountCents() {
    return euroStrToCents(wiz.amountText || "");
  }

  // Lo que falta por cobrar del encargo: el total, menos lo ya cobrado a cuenta (en un encargo nuevo, el total).
  function wizRemaining() {
    return Math.max(0, round2(wiz.total - (Number(wiz.collected) || 0)));
  }

  function isCashCode(cod) {
    try {
      return CASH_CODPAGOS instanceof Set && CASH_CODPAGOS.has(String(cod || "").trim().toUpperCase());
    } catch {
      return false;
    }
  }

  function renderWizard() {
    const p1 = wiz.page === 1;
    $("encBackBtn").textContent = wiz.mode === "advance" ? "Cancelar" : "← Atrás";
    $("encPage1").classList.toggle("hidden", !p1);
    $("encPage2").classList.toggle("hidden", p1);
    $("encWizTitle").textContent = wiz.mode === "advance" ? "Cobrar otro anticipo" : p1 ? "Nuevo encargo · Datos" : "Nuevo encargo · Anticipo";
    $("encWizStep").textContent = wiz.mode === "advance" ? "" : `Paso ${wiz.page} de 2`;
    $("encFootP1").classList.toggle("hidden", !p1);
    $("encFootP2").classList.toggle("hidden", p1);

    const lines = wiz.mode === "advance" ? [] : visibleSnapshotLines();
    const units = lines.length;
    $("encSumCount").textContent = `${units} ${units === 1 ? "producto" : "productos"}`;
    $("encSumTotal").textContent = fmtMoney(wiz.total);
    $("encSumDetail").innerHTML = lines
      .map((it) => {
        const pr = getCartLinePricing(it);
        return `<div class="enc-detail-row"><span>${escapeHtml(fmtQty(it.qty))} × ${escapeHtml(String(it.name || it.descripcion || ""))}</span><span>${escapeHtml(fmtMoney(pr.lineTotal))}</span></div>`;
      })
      .join("");
    $("encCustomer").textContent = wiz.customerName;

    // Página 1: chips de día y hora
    const key = wizDayKey();
    $("encDayChips")
      .querySelectorAll("button[data-day]")
      .forEach((b) => b.classList.toggle("is-on", b.dataset.day === wiz.day));
    const customBtn = $("encDayCustomBtn");
    customBtn.textContent = wiz.day === "custom" && wiz.customDay ? dayLabelLong(wiz.customDay) : "Otro día…";
    $("encTime").value = wiz.time;
    $("encDayLabel").textContent = wiz.day === "custom" ? "" : dayLabelLong(key);

    if (!p1) renderPage2();
  }

  function renderPage2() {
    if (wiz.mode === "advance" && wiz.order) {
      $("encP2Name").textContent = wiz.order.customerName;
      $("encP2When").textContent = `Recoge ${pickupLabel(wiz.order.pickupAt)} · Total ${fmtMoney(wiz.total)} · Cobrado ${fmtMoney(wiz.collected)}`;
      $("encP2Total").textContent = fmtMoney(wizRemaining());
    } else {
      $("encP2Name").textContent = $("encName").value.trim() || "—";
      const dayKey = wizDayKey();
      $("encP2When").textContent = `Recoge ${pickupLabel(`${dayKey} ${wiz.time}`)} · ${visibleSnapshotLines().length} productos`;
      $("encP2Total").textContent = fmtMoney(wiz.total);
    }

    const cents = amountCents();
    $("encAmountDisplay").textContent = fmtMoney(cents / 100);
    $("encAmountDisplay").classList.toggle("is-active", wiz.activeField === "amount");
    $("encAllBtn").textContent = `Todo (${fmtMoney(wizRemaining())})`;
    $("encPending").textContent = fmtMoney(Math.max(0, wizRemaining() - cents / 100));

    $("encMethods").innerHTML = wiz.formas
      .map(
        (f) =>
          `<button type="button" class="enc-chip${f.codpago === wiz.codpago ? " is-on" : ""}" data-codpago="${escapeHtml(f.codpago)}">${escapeHtml(f.descripcion)}</button>`,
      )
      .join("");

    const cash = isCashCode(wiz.codpago) && cents > 0;
    $("encCashBox").classList.toggle("hidden", !cash);
    if (cash) {
      if (!wiz.cashTouched) wiz.cashText = wiz.amountText;
      const given = euroStrToCents(wiz.cashText || "");
      $("encCashDisplay").textContent = fmtMoney(given / 100);
      $("encCashDisplay").classList.toggle("is-active", wiz.activeField === "cash");
      $("encChange").textContent = fmtMoney(Math.max(0, given - cents) / 100);
    }

    const btn = $("encSaveBtn");
    btn.textContent =
      wiz.mode === "advance"
        ? `Cobrar ${fmtMoney(cents / 100)}`
        : cents > 0
          ? `Guardar y cobrar ${fmtMoney(cents / 100)}`
          : "Guardar encargo";
    const err = page2Error();
    showWizError(err);
    btn.disabled = !!err || wiz.saving;
  }

  function page2Error() {
    const cents = amountCents();
    if (cents < 0) return "El importe no es válido.";
    if (wiz.mode === "advance" && cents <= 0) return "Escribe el importe del anticipo.";
    if (cents / 100 > wizRemaining() + 0.0001)
      return wiz.mode === "advance"
        ? "El anticipo no puede ser mayor que lo que falta por cobrar."
        : "El anticipo no puede ser mayor que el total del encargo.";
    if (cents > 0 && !cashSession?.open) return "Abre la caja para poder cobrar un anticipo.";
    if (cents > 0 && !currentTerminal?.id) return "Selecciona un terminal para cobrar un anticipo.";
    return "";
  }

  // Teclado numérico propio del cuadro: escribe en el campo activo (importe o entrega del cliente).
  function keypadPress(key) {
    const field = wiz.activeField === "cash" ? "cashText" : "amountText";
    let t = String(wiz[field] || "");
    const decimals = Number(CURRENCY?.decimals ?? 2);
    if (key === "back") {
      t = t.slice(0, -1);
    } else if (key === ",") {
      if (decimals > 0 && !t.includes(",")) t = (t === "" ? "0" : t) + ",";
    } else if (/^\d$/.test(key)) {
      const [i, d] = t.split(",");
      if (d !== undefined && d.length >= decimals) return;
      if (t.length >= 12) return;
      t = i === "0" && d === undefined ? key : t + key;
    }
    wiz[field] = t;
    if (field === "cashText") wiz.cashTouched = true;
    renderPage2();
  }

  function setAmountFromCents(c) {
    const n = Math.max(0, Math.round(c));
    const decimals = Number(CURRENCY?.decimals ?? 2);
    wiz.amountText = n === 0 ? "" : decimals > 0 ? (n / 100).toFixed(decimals).replace(".", ",") : String(Math.round(n / 100));
    wiz.cashTouched = false;
    renderPage2();
  }

  function validatePage1() {
    const name = $("encName").value.trim();
    if (!name) return "Escribe el nombre de quien encarga.";
    const day = wizDayKey();
    if (wiz.day === "custom" && !wiz.customDay) return "Elige el día de recogida.";
    if (!/^\d{2}:\d{2}$/.test(wiz.time)) return "Indica la hora de recogida.";
    const when = new Date(`${day}T${wiz.time}:00`);
    if (when.getTime() < Date.now() - 5 * 60 * 1000) return "El día y la hora de recogida ya han pasado.";
    return "";
  }

  function goPage2() {
    const err = validatePage1();
    if (err) return showWizError(err);
    showWizError("");
    wiz.page = 2;
    renderWizard();
  }

  async function saveWizard(opts = {}) {
    if (wiz.mode === "advance") return saveAdvance();
    if (wiz.saving) return;
    const err1 = validatePage1();
    if (err1) {
      wiz.page = 1;
      renderWizard();
      return showWizError(err1);
    }
    const cents = opts.noAdvance ? 0 : amountCents();
    if (wiz.page === 2 && !opts.noAdvance) {
      const err2 = page2Error();
      if (err2) return showWizError(err2);
    }
    wiz.saving = true;
    setWizBusy(true);
    showWizError("");
    try {
      const name = $("encName").value.trim();
      const pickupAt = `${wizDayKey()} ${wiz.time}`;
      if (!wiz.orderCode) wiz.orderCode = makeOrderCode();

      // 1) pedido en FacturaScripts (una sola vez aunque se reintente)
      if (!wiz.fsDoc) {
        const baseObs = `ENCARGO ${wiz.orderCode} · ${name}${$("encPhone").value.trim() ? " · " + $("encPhone").value.trim() : ""}\nRecogida: ${pickupLabel(pickupAt)}${$("encNotes").value.trim() ? "\nNota: " + $("encNotes").value.trim() : ""}`;
        wiz.fsDoc = await createFsPedido({
          numero2: wiz.orderCode,
          codcliente: wiz.codcliente,
          codalmacen: String(currentTerminal?.codalmacen || "").trim(),
          observaciones: baseObs,
          lineas: buildFsLinesFromCart(wiz.snapshot),
          codagente: String(currentAgent?.codagente || "").trim(),
          nick: String(currentAgent?.nick || getLoginUser?.() || "").trim(),
        });
      }
      // El total que cuenta es el de FacturaScripts (el de la factura que saldrá al recoger).
      const fsTotal = Number.isFinite(wiz.fsDoc.total) ? round2(wiz.fsDoc.total) : wiz.total;
      if (Math.abs(fsTotal - wiz.total) > 0.011) console.warn("[ENCARGOS] total distinto entre el carrito y FacturaScripts:", wiz.total, fsTotal);

      // 2) servidor: encargo + anticipo en una sola operación
      const body = {
        orderCode: wiz.orderCode,
        customerName: name,
        customerPhone: $("encPhone").value.trim(),
        notes: $("encNotes").value.trim(),
        pickupAt,
        codcliente: wiz.codcliente,
        total: fsTotal,
        lines: wizLinesForSave(),
        fsIdpedido: wiz.fsDoc.idpedido,
        fsCodigo: wiz.fsDoc.codigo,
        cajaId: cashSession?.open ? String(getCajaIdSafe() || "") : "",
        idtpv: String(currentTerminal?.id || ""),
        terminalId: String(currentTerminal?.id || ""),
        userName: wizAgentName(),
      };
      if (cents > 0) {
        body.advance = {
          opCode: `${wiz.orderCode}-A1`,
          amount: cents / 100,
          codpago: wiz.codpago,
          cajaId: String(getCajaIdSafe() || ""),
          idtpv: String(currentTerminal?.id || ""),
          agentName: wizAgentName(),
        };
      }
      let r;
      try {
        r = await postWithRetry("create-customer-order", body);
      } catch (e) {
        throw new Error("No hay conexión con el servidor. El encargo no se ha guardado: pulsa Guardar otra vez cuando vuelva la conexión (no se duplicará nada).");
      }
      if (!r.ok) {
        if (r.status === 409 && r.json?.customerOrdersDisabled)
          throw new Error("Encargos no está activado en el servidor para esta empresa.");
        throw new Error(r.json?.error || `El servidor no aceptó el encargo (HTTP ${r.status}).`);
      }
      const order = r.json.data;
      wiz.savedOk = true;
      onCreated(order, { cents, cash: isCashCode(wiz.codpago), given: euroStrToCents(wiz.cashText || "") / 100, codpago: wiz.codpago }).catch((e) =>
        console.warn("[ENCARGOS] tras guardar:", e?.message || e),
      );
    } catch (e) {
      console.warn("[ENCARGOS] guardar encargo:", e?.message || e);
      showWizError(String(e?.message || e));
    } finally {
      wiz.saving = false;
      setWizBusy(false);
      if (wiz.open && wiz.page === 2) renderPage2();
    }
  }

  function setWizBusy(busy) {
    ["encSaveBtn", "encNextBtn", "encSaveNoAdvBtn", "encBackBtn", "encCancelBtn"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = !!busy;
    });
    const save = $("encSaveBtn");
    if (save && busy) save.textContent = "Guardando…";
    const nxt = $("encNextBtn");
    if (nxt && busy) nxt.dataset.label = nxt.textContent;
  }

  // Después de guardar: libera el carrito, abre el cajón si se cobró en efectivo, escribe el dinero en FacturaScripts,
  // imprime y muestra el resultado.
  async function onCreated(order, ctx) {
    closeWizard({ keepOrphanCheck: true });
    try {
      pushCartHistoryStep("clear-cart");
      cart = [];
      if (cartGlobalDiscountPct > 0) {
        cartGlobalDiscountPct = 0;
        clearFrozenGlobalDiscountFromCartLines(cart);
      }
      renderCart();
      setCurrentParkedTicketIndex(null);
      restorePreParkedCustomerSelection();
      window.CUSTOMER_SELECTOR?.resetToDefault?.();
      refreshParkButtonUI();
      refreshParkedEditingBanner();
    } catch (e) {
      console.warn("[ENCARGOS] no se pudo vaciar el carrito:", e?.message || e);
    }
    refreshCount().catch(() => {});

    if (ctx.cents > 0 && (isOpenDrawerAlwaysEnabled() || ctx.cash)) {
      openDrawerNow({ source: "AUTO" }).catch(() => {});
    }
    syncFsObservaciones(order).catch(() => {});

    showResult(order, ctx);
    if (isAutoPrintEnabled()) {
      await printReceipt(order, ctx).catch(() => {});
      if (ctx.cents > 0) await printAdvanceVoucher(order, ctx).catch(() => {});
    }
  }

  // ------------------------------------------------------------------ resultado y datos de impresión

  let lastResult = null;
  function showResult(order, ctx) {
    lastResult = { order, ctx };
    $("encResTitle").textContent = "Encargo guardado ✓";
    $("encResText").innerHTML =
      `<strong>${escapeHtml(order.customerName)}</strong><br>` +
      `Recoge ${escapeHtml(pickupLabel(order.pickupAt))}<br>` +
      `Total ${escapeHtml(fmtMoney(order.total))}` +
      (order.collected > 0
        ? ` · Anticipo cobrado ${escapeHtml(fmtMoney(order.collected))} · Falta ${escapeHtml(fmtMoney(order.pending))}`
        : " · Sin anticipo") +
      `<br><small>Código ${escapeHtml(order.orderCode)}${order.fsCodigo ? " · Pedido " + escapeHtml(order.fsCodigo) : ""}</small>`;
    $("encResVoucherBtn").classList.toggle("hidden", !(order.collected > 0));
    $("encargoResultOverlay").classList.remove("hidden");
    lockAppUI();
  }

  function closeResult() {
    $("encargoResultOverlay").classList.add("hidden");
    unlockAppUI();
  }

  function companyHeaderHtml() {
    const emp = (typeof companyInfo !== "undefined" && companyInfo) || {};
    const esc = escapeHtml;
    const phones = [emp.telefono1, emp.telefono2].map((p) => String(p || "").trim()).filter(Boolean);
    const logo =
      typeof companyLogoUrl !== "undefined" && companyLogoUrl
        ? `<div class="c"><img src="${esc(companyLogoUrl)}" style="max-width:60mm;max-height:18mm" /></div>`
        : "";
    return (
      logo +
      `<div class="c b" style="font-size:16px">${esc(emp.nombrecorto || emp.nombre || "")}</div>` +
      (emp.nombre && emp.nombrecorto ? `<div class="c s">${esc(emp.nombre)}</div>` : "") +
      (emp.direccion ? `<div class="s">${esc(emp.direccion)}</div>` : "") +
      (emp.codpostal || emp.ciudad ? `<div class="s">${esc(`${emp.codpostal ? emp.codpostal + ", " : ""}${emp.ciudad || ""}`)}</div>` : "") +
      (emp.cifnif ? `<div class="s">CIF: ${esc(emp.cifnif)}</div>` : "") +
      (phones.length ? `<div class="s">Tel.: ${esc(phones.join(" / "))}</div>` : "")
    );
  }

  function ticketShell(innerHtml) {
    return (
      "<!doctype html><html><head><meta charset=\"utf-8\"><style>" +
      "*{box-sizing:border-box}@page{size:80mm auto;margin:0}html,body{margin:0;padding:0}" +
      "#t{width:70mm;padding:0 2mm;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Courier New',monospace;font-size:12px;line-height:1.25;color:#000}" +
      ".c{text-align:center}.b{font-weight:700}.s{font-size:11px}.sep{border-top:1px dashed #000;margin:8px 0}" +
      ".r{display:flex;justify-content:space-between;gap:8px}.r>span:first-child{flex:1;min-width:0;word-break:break-word}.r>span:last-child{white-space:nowrap;text-align:right}" +
      ".big{font-size:15px;font-weight:700}.box{border:2px solid #000;padding:4px 6px;margin:6px 0;text-align:center}" +
      "</style></head><body><div id=\"t\">" +
      innerHtml +
      "</div></body></html>"
    );
  }

  async function payLabel(codpago) {
    try {
      const map = await getFormasPagoMap();
      return map[String(codpago || "").trim()] || String(codpago || "");
    } catch {
      return String(codpago || "");
    }
  }

  async function printHtml(html) {
    state.lastPrintHtml = html; // para pruebas y diagnostico
    const printerName = await ensurePrinterSelectedForPrint();
    if (!printerName) {
      toast("Impresión cancelada (sin impresora).", "warn", "Impresión");
      return false;
    }
    const r = await window.TPV_PRINT.printTicket({ html, deviceName: printerName });
    if (!r || !r.ok) {
      toast("No se pudo imprimir: " + (r?.error || "error desconocido"), "err", "Impresión");
      return false;
    }
    return true;
  }

  // Resguardo del encargo: lo que se entrega al cliente. Lleva bien visible el día y la hora de recogida.
  async function printReceipt(order, ctx = {}) {
    const esc = escapeHtml;
    const lines = (Array.isArray(order.lines) ? order.lines : [])
      .map((l) => `<div class="r"><span>${esc(fmtQty(l.qty))} x ${esc(l.name)}</span><span>${esc(fmtMoney(l.total))}</span></div>`)
      .join("");
    const modified = ctx.modified ? `<div class="box b">MODIFICADO (anula el resguardo anterior)</div>` : "";
    const html = ticketShell(
      companyHeaderHtml() +
        `<div class="sep"></div><div class="c b" style="font-size:14px">RESGUARDO DE ENCARGO</div>` +
        modified +
        `<div class="s">Código: ${esc(order.orderCode)}</div>` +
        `<div class="s">Fecha: ${esc(formatDateTimeEs(order.createdAtMs))}</div>` +
        `<div class="box"><div class="s">RECOGE</div><div class="big">${esc(pickupLabel(order.pickupAt).toUpperCase())}</div></div>` +
        `<div>Cliente: <strong>${esc(order.customerName)}</strong></div>` +
        (order.customerPhone ? `<div>Teléfono: ${esc(order.customerPhone)}</div>` : "") +
        (order.notes ? `<div>Nota: ${esc(order.notes)}</div>` : "") +
        `<div class="sep"></div>${lines}<div class="sep"></div>` +
        `<div class="r big"><span>TOTAL</span><span>${esc(fmtMoney(order.total))}</span></div>` +
        `<div class="r"><span>Anticipo cobrado</span><span>${esc(fmtMoney(order.collected))}</span></div>` +
        `<div class="r big"><span>FALTA POR COBRAR</span><span>${esc(fmtMoney(order.pending))}</span></div>` +
        `<div class="sep"></div><div class="c s">Este documento no es una factura.<br>Presente este resguardo al recoger el pedido.</div>` +
        `<div class="s">TPV: ${esc(String(currentTerminal?.name || ""))} · Agente: ${esc(wizAgentName())}</div>`,
    );
    return printHtml(html);
  }

  // Justificante del anticipo: lo cobrado a cuenta. NO es una factura (decisión del jefe: el IVA se factura al recoger).
  async function printAdvanceVoucher(order, ctx = {}) {
    const esc = escapeHtml;
    const label = await payLabel(ctx.codpago || order.moves?.[order.moves.length - 1]?.codpago);
    const amount = ctx.cents ? ctx.cents / 100 : order.collected;
    const cashRows =
      ctx.cash && ctx.given > 0
        ? `<div class="r s"><span>Entregado</span><span>${esc(fmtMoney(ctx.given))}</span></div><div class="r s"><span>Cambio</span><span>${esc(fmtMoney(Math.max(0, ctx.given - amount)))}</span></div>`
        : "";
    const html = ticketShell(
      companyHeaderHtml() +
        `<div class="sep"></div><div class="c b" style="font-size:14px">JUSTIFICANTE DE ANTICIPO</div>` +
        `<div class="c s">No es una factura</div>` +
        `<div class="s">Encargo: ${esc(order.orderCode)}</div>` +
        `<div class="s">Fecha: ${esc(formatDateTimeEs(Date.now()))}</div>` +
        `<div>Cliente: <strong>${esc(order.customerName)}</strong></div>` +
        `<div class="sep"></div>` +
        `<div class="r big"><span>ANTICIPO</span><span>${esc(fmtMoney(amount))}</span></div>` +
        `<div class="r"><span>Forma de pago</span><span>${esc(label)}</span></div>` +
        cashRows +
        `<div class="sep"></div>` +
        `<div class="r"><span>Total del encargo</span><span>${esc(fmtMoney(order.total))}</span></div>` +
        `<div class="r"><span>Cobrado a cuenta</span><span>${esc(fmtMoney(order.collected))}</span></div>` +
        `<div class="r big"><span>PENDIENTE</span><span>${esc(fmtMoney(order.pending))}</span></div>` +
        `<div class="sep"></div><div class="c s">Se descontará de la factura al recoger el pedido.</div>` +
        `<div class="s">TPV: ${esc(String(currentTerminal?.name || ""))} · Agente: ${esc(wizAgentName())}</div>`,
    );
    return printHtml(html);
  }

  // ------------------------------------------------------------------ enganche de los controles

  let wizardBound = false;
  function bindWizardOnce() {
    if (wizardBound) return;
    wizardBound = true;

    $("passToEncargoBtn")?.addEventListener("click", () => openWizard());

    // Teclado en pantalla al tocar los campos de texto (si está activado en Opciones)
    ["encName", "encPhone", "encNotes"].forEach((id) => {
      $(id)?.addEventListener("click", () => openQwertyForInput($(id), "text"));
    });

    $("encDayChips")?.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-day]");
      if (!b) return;
      const day = b.dataset.day;
      if (day === "custom") {
        const input = $("encDayInput");
        input.min = dateKey(new Date());
        input.classList.remove("hidden");
        (input.showPicker ? (() => { try { input.showPicker(); } catch { input.focus(); } }) : () => input.focus())();
        return;
      }
      wiz.day = day;
      $("encDayInput").classList.add("hidden");
      if (day === "today" && wiz.time < defaultTimeForToday()) wiz.time = defaultTimeForToday();
      renderWizard();
    });
    $("encDayInput")?.addEventListener("change", () => {
      const v = $("encDayInput").value;
      if (!v) return;
      wiz.day = "custom";
      wiz.customDay = v;
      renderWizard();
    });
    $("encTime")?.addEventListener("change", () => {
      wiz.time = $("encTime").value || wiz.time;
    });
    const stepTime = (delta) => {
      const [h, m] = wiz.time.split(":").map(Number);
      let total = (h * 60 + m + delta + 1440) % 1440;
      wiz.time = `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
      renderWizard();
    };
    $("encTimeMinus")?.addEventListener("click", () => stepTime(-15));
    $("encTimePlus")?.addEventListener("click", () => stepTime(15));

    $("encSumDetailBtn")?.addEventListener("click", () => $("encSumDetail").classList.toggle("hidden"));

    $("encCancelBtn")?.addEventListener("click", () => closeWizard());
    $("encWizCloseBtn")?.addEventListener("click", () => closeWizard());
    $("encNextBtn")?.addEventListener("click", () => goPage2());
    $("encSaveNoAdvBtn")?.addEventListener("click", () => saveWizard({ noAdvance: true }));
    $("encBackBtn")?.addEventListener("click", () => {
      if (wiz.mode === "advance") return closeWizard();
      wiz.page = 1;
      showWizError("");
      renderWizard();
    });
    $("encSaveBtn")?.addEventListener("click", () => saveWizard());

    $("encKeypad")?.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-key]");
      if (b) keypadPress(b.dataset.key);
    });
    $("encAmountDisplay")?.addEventListener("click", () => {
      wiz.activeField = "amount";
      renderPage2();
    });
    $("encCashDisplay")?.addEventListener("click", () => {
      wiz.activeField = "cash";
      wiz.cashTouched = true;
      renderPage2();
    });
    $("encAllBtn")?.addEventListener("click", () => setAmountFromCents(toCents(wizRemaining())));
    $("encHalfBtn")?.addEventListener("click", () => setAmountFromCents(Math.round(toCents(wizRemaining()) / 2)));
    $("encQuarterBtn")?.addEventListener("click", () => setAmountFromCents(Math.round(toCents(wizRemaining()) / 4)));
    $("encNoneBtn")?.addEventListener("click", () => setAmountFromCents(0));
    $("encMethods")?.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-codpago]");
      if (!b) return;
      wiz.codpago = b.dataset.codpago;
      wiz.cashTouched = false;
      renderPage2();
    });

    $("encResCloseBtn")?.addEventListener("click", () => closeResult());
    $("encResReceiptBtn")?.addEventListener("click", () => lastResult && printReceipt(lastResult.order, lastResult.ctx));
    $("encResVoucherBtn")?.addEventListener("click", () => lastResult && printAdvanceVoucher(lastResult.order, lastResult.ctx));

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && wiz.open && !wiz.saving && $("qwertyOverlay")?.classList.contains("hidden") !== false) closeWizard();
    });
  }

  // ------------------------------------------------------------------ otro anticipo

  async function openAdvanceDialog(order) {
    if (!order || order.status !== "pendiente") return;
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) {
      toast("Encargos necesita conexión con el servidor.", "warn", "Encargos");
      return;
    }
    if (!cashSession?.open) {
      toast("Abre la caja para poder cobrar un anticipo.", "warn", "Encargos");
      return;
    }
    if (!(await requireAssignedAgentOrBlock({ showModal: true }))) return;
    if (!(order.pending > 0)) {
      toast("Este encargo ya está pagado por completo.", "info", "Encargos");
      return;
    }
    try {
      const cached = loadPayMethodsCache();
      const formas = Array.isArray(cached) && cached.length ? cached : await fetchFormasPagoActivas();
      wiz.formas = (formas || [])
        .map((f) => ({ codpago: String(f.codpago || "").trim(), descripcion: String(f.descripcion || f.codpago || "").trim() }))
        .filter((x) => x.codpago);
    } catch {
      wiz.formas = [];
    }
    if (!wiz.formas.length) wiz.formas = [{ codpago: "CONT", descripcion: "Efectivo" }];
    wiz.codpago = (wiz.formas.find((f) => f.codpago === "CONT") || wiz.formas[0]).codpago;
    wiz.mode = "advance";
    wiz.order = order;
    wiz.total = order.total;
    wiz.collected = order.collected;
    wiz.opCode = `${order.orderCode}-A${Date.now().toString(36).toUpperCase()}`;
    wiz.saving = false;
    wiz.savedOk = false;
    wiz.fsDoc = null;
    wiz.orderCode = "";
    wiz.page = 2;
    wiz.amountText = "";
    wiz.cashText = "";
    wiz.cashTouched = false;
    wiz.activeField = "amount";
    showWizError("");
    wiz.open = true;
    $("encargoWizardOverlay").classList.remove("hidden");
    lockAppUI();
    renderWizard();
  }

  async function saveAdvance() {
    if (wiz.saving) return;
    const err = page2Error();
    if (err) return showWizError(err);
    wiz.saving = true;
    setWizBusy(true);
    showWizError("");
    const cents = amountCents();
    const order0 = wiz.order;
    try {
      let r;
      try {
        r = await postWithRetry("add-customer-order-advance", {
          orderId: order0.id,
          advance: {
            opCode: wiz.opCode,
            amount: cents / 100,
            codpago: wiz.codpago,
            cajaId: String(getCajaIdSafe() || ""),
            idtpv: String(currentTerminal?.id || ""),
            agentName: wizAgentName(),
          },
          userName: wizAgentName(),
          terminalId: String(currentTerminal?.id || ""),
          sessionId: sessionId(),
        });
      } catch {
        throw new Error("No hay conexión con el servidor. El anticipo no se ha anotado: pulsa Cobrar otra vez cuando vuelva (no se duplicará).");
      }
      if (!r.ok) {
        if (r.status === 422 && r.json?.code === "advanceTooBig") throw new Error("Con este anticipo se cobraría más que el total del encargo (puede haber cambiado). Revisa el encargo.");
        if (r.status === 423) throw new Error("Este encargo se está atendiendo en otro dispositivo. Inténtalo en unos segundos.");
        throw new Error(r.json?.error || `El servidor no aceptó el anticipo (HTTP ${r.status}).`);
      }
      const order = r.json.data;
      const ctx = { cents, cash: isCashCode(wiz.codpago), given: euroStrToCents(wiz.cashText || "") / 100, codpago: wiz.codpago };
      wiz.savedOk = true;
      closeWizard({ keepOrphanCheck: true });
      if (cents > 0 && (isOpenDrawerAlwaysEnabled() || ctx.cash)) openDrawerNow({ source: "AUTO" }).catch(() => {});
      syncFsObservaciones(order).catch(() => {});
      toast(`Anticipo de ${fmtMoney(cents / 100)} cobrado ✓`, "ok", "Encargos");
      lastResult = { order, ctx };
      if (isAutoPrintEnabled()) printAdvanceVoucher(order, ctx).catch(() => {});
      refreshCount().catch(() => {});
      if (list.open) loadList().catch(() => {});
      if (detail.open) openDetail(order.id).catch(() => {});
    } catch (e) {
      showWizError(String(e?.message || e));
    } finally {
      wiz.saving = false;
      setWizBusy(false);
      if (wiz.open) renderPage2();
    }
  }

  // Identificador de esta sesión del TPV (para el candado de recogida entre dispositivos).
  function sessionId() {
    try {
      let id = sessionStorage.getItem("tpv_encargos_session");
      if (!id) {
        id = `S${String(currentTerminal?.id || "0")}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        sessionStorage.setItem("tpv_encargos_session", id);
      }
      return id;
    } catch {
      return `S${String(currentTerminal?.id || "0")}-nosession`;
    }
  }

  // ------------------------------------------------------------------ lista de encargos

  const list = { open: false, tab: "pendiente", q: "", rows: [], loading: false, counts: {}, seq: 0, error: "" };
  const detail = { open: false, order: null };

  function openList() {
    if (!isEnabled()) return;
    list.open = true;
    list.tab = "pendiente";
    list.q = "";
    $("encListSearch").value = "";
    $("encargosListOverlay").classList.remove("hidden");
    lockAppUI();
    loadList().catch(() => {});
  }

  function closeList() {
    list.open = false;
    $("encargosListOverlay").classList.add("hidden");
    unlockAppUI();
  }

  function statusesForTab(tab) {
    if (tab === "recogido") return "recogido,cerrado_sin_recoger";
    if (tab === "cancelado") return "cancelado";
    return "pendiente";
  }

  async function loadList() {
    const mySeq = ++list.seq;
    list.loading = true;
    renderList();
    const query = { status: statusesForTab(list.tab), withLines: "1", limit: "500" };
    if (list.q) query.q = list.q;
    if (list.tab !== "pendiente") query.from = dateKey(addDays(new Date(), -45));
    try {
      const r = await call("list-customer-orders", { query });
      if (mySeq !== list.seq) return;
      list.rows = r.ok && Array.isArray(r.json?.data) ? r.json.data : [];
      list.error = r.ok ? "" : r.json?.error || "No se pudo cargar la lista.";
    } catch {
      if (mySeq !== list.seq) return;
      list.rows = [];
      list.error = "Sin conexión con el servidor.";
    }
    list.loading = false;
    if (list.tab === "pendiente" && !list.q) list.counts.pendiente = list.rows.length;
    renderList();
  }

  function orderSummaryText(o) {
    const names = (Array.isArray(o.lines) ? o.lines : []).map((l) => String(l.name || "").trim()).filter(Boolean);
    let txt = names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "");
    if (o.notes) txt += (txt ? " · " : "") + `«${o.notes.replace(/\s+/g, " ").slice(0, 40)}»`;
    return txt || "—";
  }

  function orderChip(o, today) {
    if (o.status === "recogido") return { text: "RECOGIDO", cls: "is-done" };
    if (o.status === "cerrado_sin_recoger") return { text: "CERRADO SIN RECOGER", cls: "is-off" };
    if (o.status === "cancelado") return { text: "CANCELADO", cls: "is-off" };
    if (String(o.pickupAt).slice(0, 10) < today) return { text: "VENCIDO", cls: "is-late" };
    if (!(o.pending > 0)) return { text: "PAGADO · RECOGER", cls: "is-paid" };
    return { text: "FALTA RECOGER", cls: "is-wait" };
  }

  function groupTitle(key, today, tomorrow) {
    if (key < today) return { text: `VENCIDO · ${dayLabelLong(key)} (sin recoger)`, cls: "is-late" };
    if (key === today) return { text: `HOY · ${dayLabelLong(key)}`, cls: "is-today" };
    if (key === tomorrow) return { text: `MAÑANA · ${dayLabelLong(key)}`, cls: "" };
    return { text: dayLabelLong(key).toUpperCase(), cls: "" };
  }

  function renderList() {
    document.querySelectorAll("#encListTabs button[data-tab]").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.tab === list.tab);
      if (b.dataset.tab === "pendiente") b.textContent = `Falta recoger${list.counts.pendiente != null ? ` (${list.counts.pendiente})` : ""}`;
    });
    const box = $("encListBody");
    if (list.loading && !list.rows.length) {
      box.innerHTML = `<div class="enc-empty">Cargando…</div>`;
    } else if (list.error && !list.rows.length) {
      box.innerHTML = `<div class="enc-empty is-err">${escapeHtml(list.error)}</div>`;
    } else if (!list.rows.length) {
      box.innerHTML = `<div class="enc-empty">${list.q ? "Ningún encargo coincide con la búsqueda." : list.tab === "pendiente" ? "No hay encargos pendientes." : "No hay encargos en esta lista (últimos 45 días)."}</div>`;
    } else {
      const today = dateKey(new Date());
      const tomorrow = dateKey(addDays(new Date(), 1));
      const rows = [...list.rows].sort((a, b) =>
        list.tab === "pendiente" ? String(a.pickupAt).localeCompare(String(b.pickupAt)) : String(b.pickupAt).localeCompare(String(a.pickupAt)),
      );
      let html = "";
      let lastKey = "";
      rows.forEach((o) => {
        const key = String(o.pickupAt).slice(0, 10);
        if (list.tab === "pendiente") {
          const gkey = key < today ? `late-${key}` : key;
          if (gkey !== lastKey) {
            lastKey = gkey;
            const g = groupTitle(key, today, tomorrow);
            html += `<div class="enc-group ${g.cls}">${escapeHtml(g.text)}</div>`;
          }
        } else if (key !== lastKey) {
          lastKey = key;
          html += `<div class="enc-group">${escapeHtml(dayLabelLong(key).toUpperCase())}</div>`;
        }
        const chip = orderChip(o, today);
        const late = o.status === "pendiente" && key < today;
        html +=
          `<button type="button" class="enc-item${late ? " is-late" : ""}" data-id="${o.id}">` +
          `<div class="enc-item-time"><strong>${escapeHtml(String(o.pickupAt).slice(11, 16))}</strong><small>${late ? "vencido" : "recogida"}</small></div>` +
          `<div class="enc-item-main"><strong>${escapeHtml(o.customerName)}</strong><small>${escapeHtml([o.customerPhone, orderSummaryText(o)].filter(Boolean).join(" · "))}</small></div>` +
          `<div class="enc-item-money"><span>Total ${escapeHtml(fmtMoney(o.total))}</span><small>Anticipo ${escapeHtml(fmtMoney(o.collected))}</small></div>` +
          `<div class="enc-item-pend ${o.pending > 0 ? "is-due" : "is-ok"}">${o.status === "pendiente" ? `Falta ${escapeHtml(fmtMoney(o.pending))}` : ""}</div>` +
          `<div class="enc-item-chip ${chip.cls}">${chip.text}</div>` +
          `</button>`;
      });
      box.innerHTML = html;
    }
    const cartLines = typeof hasVisibleCartLines === "function" ? hasVisibleCartLines() : false;
    $("encListNewBtn").disabled = !!passButtonReason();
    $("encListCartInfo").textContent = cartLines ? `${getVisibleCartLines(cart).length} productos · ${fmtMoney(getCartTotal(cart))}` : "El carrito está vacío";
  }

  // ------------------------------------------------------------------ detalle de un encargo

  async function openDetail(id) {
    let r;
    try {
      r = await call("get-customer-order", { query: { orderId: String(id) } });
    } catch {
      toast("Sin conexión con el servidor.", "warn", "Encargos");
      return;
    }
    if (!r.ok || !r.json?.data) {
      toast(r.json?.error || "No se pudo abrir el encargo.", "warn", "Encargos");
      if (list.open) loadList().catch(() => {});
      return;
    }
    detail.order = r.json.data;
    detail.open = true;
    await renderDetail();
    $("encargoDetailOverlay").classList.remove("hidden");
    if (!document.body.classList.contains("modal-locked")) lockAppUI();
  }

  function closeDetail() {
    detail.open = false;
    detail.order = null;
    $("encargoDetailOverlay").classList.add("hidden");
    if (!list.open) unlockAppUI();
  }

  async function renderDetail() {
    const o = detail.order;
    if (!o) return;
    const labels = await getFormasPagoMap().catch(() => ({}));
    const pay = (c) => labels[String(c || "").trim()] || String(c || "");
    const today = dateKey(new Date());
    const chip = orderChip(o, today);
    $("encDetTitle").textContent = o.customerName;
    $("encDetChip").textContent = chip.text;
    $("encDetChip").className = `enc-item-chip ${chip.cls}`;
    $("encDetInfo").innerHTML =
      `<div><strong>Recoge ${escapeHtml(pickupLabel(o.pickupAt))}</strong>${o.customerPhone ? " · " + escapeHtml(o.customerPhone) : ""}</div>` +
      `<small>Código ${escapeHtml(o.orderCode)}${o.fsCodigo ? " · Pedido " + escapeHtml(o.fsCodigo) : ""}${o.fsFacturaCodigo ? " · Factura " + escapeHtml(o.fsFacturaCodigo) : ""} · creado por ${escapeHtml(o.createdBy || "—")} el ${escapeHtml(formatDateTimeEs(o.createdAtMs))}</small>` +
      (o.notes ? `<div class="enc-det-note">Nota: ${escapeHtml(o.notes)}</div>` : "");
    $("encDetLines").innerHTML = (Array.isArray(o.lines) ? o.lines : [])
      .map((l) => `<div class="enc-detail-row"><span>${escapeHtml(fmtQty(l.qty))} × ${escapeHtml(l.name)}</span><span>${escapeHtml(fmtMoney(l.total))}</span></div>`)
      .join("");
    const moves = (o.moves || [])
      .map((m) => {
        const label = m.kind === "anticipo" ? "Anticipo" : m.kind === "devolucion" ? "Devuelto" : "Cobrado al recoger";
        const sign = m.kind === "devolucion" ? "−" : "";
        return `<div class="enc-detail-row"><span>${label} · ${escapeHtml(pay(m.codpago))} · ${escapeHtml(formatDateTimeEs(m.createdAtMs))}</span><span>${sign}${escapeHtml(fmtMoney(m.amount))}</span></div>`;
      })
      .join("");
    $("encDetMoves").innerHTML = moves || `<div class="enc-detail-row"><span>Sin anticipo cobrado</span><span></span></div>`;
    $("encDetTotals").innerHTML =
      `<div class="enc-tot"><span>Total</span><strong>${escapeHtml(fmtMoney(o.total))}</strong></div>` +
      `<div class="enc-tot"><span>Cobrado a cuenta</span><strong>${escapeHtml(fmtMoney(o.collected))}</strong></div>` +
      (o.status === "pendiente" ? `<div class="enc-tot is-due"><span>Falta por cobrar</span><strong>${escapeHtml(fmtMoney(o.pending))}</strong></div>` : "");
    const pend = o.status === "pendiente";
    $("encDetAdvanceBtn").classList.toggle("hidden", !(pend && o.pending > 0));
    $("encDetCancelBtn").classList.toggle("hidden", !pend);
    $("encDetVoucherBtn").classList.toggle("hidden", !(o.collected > 0));
  }

  // ------------------------------------------------------------------ cancelar un encargo

  async function cancelOrderFlow() {
    const o0 = detail.order;
    if (!o0 || o0.status !== "pendiente") return;
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) return toast("Encargos necesita conexión con el servidor.", "warn", "Encargos");
    // Siempre sobre la versión actual del encargo (otro terminal pudo cobrar otro anticipo).
    let fresh;
    try {
      const r = await call("get-customer-order", { query: { orderId: String(o0.id) } });
      if (!r.ok) throw new Error();
      fresh = r.json.data;
    } catch {
      return toast("No se pudo comprobar el encargo. Inténtalo de nuevo.", "warn", "Encargos");
    }
    if (fresh.status !== "pendiente") {
      detail.order = fresh;
      await renderDetail();
      return toast("Este encargo ya no está pendiente.", "info", "Encargos");
    }
    // Se devuelve cada anticipo con su forma de pago (efectivo: se entrega; tarjeta/transferencia: se reversa).
    const advances = (fresh.moves || []).filter((m) => m.kind === "anticipo");
    let alreadyRefunded = (fresh.moves || []).filter((m) => m.kind === "devolucion").reduce((s, d) => s + d.amount, 0);
    const toRefund = advances.map((m) => ({ codpago: m.codpago, amount: m.amount, opCode: m.opCode }));
    for (const t of toRefund) {
      const take = Math.min(t.amount, alreadyRefunded);
      t.amount = round2(t.amount - take);
      alreadyRefunded = round2(alreadyRefunded - take);
    }
    const refunds = toRefund.filter((t) => t.amount > 0);
    if (refunds.length && !cashSession?.open) return toast("Abre la caja para poder devolver dinero.", "warn", "Encargos");

    const labels = await getFormasPagoMap().catch(() => ({}));
    const pay = (c) => labels[String(c || "").trim()] || String(c || "");
    const total = refunds.reduce((s, r) => s + r.amount, 0);
    const lines = refunds
      .map(
        (r) =>
          `<li><strong>${escapeHtml(fmtMoney(r.amount))}</strong> · ${escapeHtml(pay(r.codpago))} — ${isCashCode(r.codpago) ? "se entrega al cliente" : "hay que reversar la operación (datáfono / banco)"}</li>`,
      )
      .join("");
    const html =
      `<div class="enc-cancel-text"><p>Vas a <strong>cancelar el encargo de ${escapeHtml(fresh.customerName)}</strong> (${escapeHtml(pickupLabel(fresh.pickupAt))}). El pedido de FacturaScripts también se cancela y libera el stock.</p>` +
      (refunds.length
        ? `<p>Hay que devolver <strong>${escapeHtml(fmtMoney(total))}</strong> de lo cobrado a cuenta:</p><ul>${lines}</ul><p class="enc-small">La devolución queda anotada en la caja de hoy.</p>`
        : `<p>No había nada cobrado a cuenta, no hay que devolver dinero.</p>`) +
      `<p class="enc-small">Si el cliente no va a recoger y no se le devuelve nada, usa «Cerrar sin recoger» en vez de cancelar.</p></div>`;
    const ok = await confirmModal("Cancelar encargo", html, {
      isHtml: true,
      okButtonText: refunds.length ? "Cancelar y devolver" : "Cancelar encargo",
    });
    if (!ok) return;

    const cajaId = String(getCajaIdSafe() || "");
    const body = {
      orderId: fresh.id,
      expectedVersion: fresh.version,
      refunds: refunds.map((r, i) => ({
        opCode: `${r.opCode}-D${i + 1}`,
        amount: r.amount,
        codpago: r.codpago,
        cajaId,
        idtpv: String(currentTerminal?.id || ""),
        agentName: wizAgentName(),
      })),
      cajaId,
      userName: wizAgentName(),
      terminalId: String(currentTerminal?.id || ""),
      sessionId: sessionId(),
    };
    let r;
    try {
      r = await postWithRetry("cancel-customer-order", body);
    } catch {
      return toast("No hay conexión con el servidor. No se ha cancelado nada.", "warn", "Encargos");
    }
    if (r.status === 412) {
      detail.order = r.json?.data || fresh;
      await renderDetail();
      return showMessageModal(
        "El encargo ha cambiado",
        "Mientras lo cancelabas, otro terminal lo modificó (por ejemplo, cobró otro anticipo). Revisa los datos actualizados y vuelve a cancelar. No se ha cancelado nada.",
      );
    }
    if (!r.ok) return showMessageModal("No se pudo cancelar", r.json?.error || `El servidor no aceptó la cancelación (HTTP ${r.status}).`);
    const order = r.json.data;
    if (refunds.some((x) => isCashCode(x.codpago)) || (refunds.length && isOpenDrawerAlwaysEnabled())) openDrawerNow({ source: "AUTO" }).catch(() => {});
    // Primero el texto (un pedido cancelado ya no se puede editar en FacturaScripts) y luego se cancela el pedido.
    syncFsObservaciones(order)
      .then(() => cancelFsPedidoQuietly(order.fsIdpedido))
      .catch(() => {});
    toast("Encargo cancelado ✓", "ok", "Encargos");
    detail.order = order;
    await renderDetail();
    refreshCount().catch(() => {});
    if (list.open) loadList().catch(() => {});
  }

  // ------------------------------------------------------------------ lista del día (impresa)

  async function printTodayList() {
    let rows = [];
    const today = dateKey(new Date());
    try {
      const r = await call("list-customer-orders", { query: { status: "pendiente", to: today, withLines: "1", limit: "500" } });
      if (!r.ok) throw new Error();
      rows = (r.json.data || []).sort((a, b) => String(a.pickupAt).localeCompare(String(b.pickupAt)));
    } catch {
      return toast("No se pudo cargar la lista de hoy.", "warn", "Encargos");
    }
    if (!rows.length) return toast("No hay encargos para hoy ni vencidos.", "info", "Encargos");
    const esc = escapeHtml;
    const body = rows
      .map((o) => {
        const late = String(o.pickupAt).slice(0, 10) < today;
        const items = (o.lines || []).map((l) => `${fmtQty(l.qty)} x ${l.name}`).join(", ");
        return (
          `<div class="sep"></div><div class="r b"><span>${esc(late ? dayLabelLong(String(o.pickupAt).slice(0, 10)) + " " : "")}${esc(String(o.pickupAt).slice(11, 16))} ${esc(o.customerName)}</span><span>${o.pending > 0 ? "Falta " + esc(fmtMoney(o.pending)) : "PAGADO"}</span></div>` +
          (o.customerPhone ? `<div class="s">Tel. ${esc(o.customerPhone)}</div>` : "") +
          `<div class="s">${esc(items)}</div>` +
          (o.notes ? `<div class="s">Nota: ${esc(o.notes)}</div>` : "")
        );
      })
      .join("");
    const html = ticketShell(
      `<div class="c b" style="font-size:15px">ENCARGOS PARA HOY (${rows.length})</div><div class="c s">${esc(dayLabelLong(today))} · impreso ${esc(formatDateTimeEs(Date.now()))}</div>` + body,
    );
    await printHtml(html);
  }

  // ------------------------------------------------------------------ tiempo real

  let realtimeTimer = null;
  function onRealtime() {
    if (!isEnabled()) return;
    if (realtimeTimer) clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => {
      realtimeTimer = null;
      refreshCount().catch(() => {});
      if (list.open) loadList().catch(() => {});
      if (detail.open && detail.order) openDetail(detail.order.id).catch(() => {});
    }, 400);
  }

  let listBound = false;
  function bindListOnce() {
    if (listBound) return;
    listBound = true;
    $("encargosListBtn")?.addEventListener("click", () => openList());
    $("encListCloseBtn")?.addEventListener("click", () => closeList());
    $("encListTabs")?.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (!b) return;
      list.tab = b.dataset.tab;
      loadList().catch(() => {});
    });
    let searchTimer = null;
    $("encListSearch")?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        list.q = $("encListSearch").value.trim();
        loadList().catch(() => {});
      }, 350);
    });
    $("encListSearch")?.addEventListener("click", () => openQwertyForInput($("encListSearch"), "text"));
    $("encListBody")?.addEventListener("click", (e) => {
      const it = e.target.closest(".enc-item");
      if (it) openDetail(it.dataset.id).catch(() => {});
    });
    $("encListNewBtn")?.addEventListener("click", () => {
      closeList();
      openWizard();
    });
    $("encListPrintBtn")?.addEventListener("click", () => printTodayList());

    $("encDetCloseBtn")?.addEventListener("click", () => closeDetail());
    $("encDetCloseBtn2")?.addEventListener("click", () => closeDetail());
    $("encDetAdvanceBtn")?.addEventListener("click", () => detail.order && openAdvanceDialog(detail.order));
    $("encDetCancelBtn")?.addEventListener("click", () => cancelOrderFlow());
    $("encDetReceiptBtn")?.addEventListener("click", () => detail.order && printReceipt(detail.order));
    $("encDetVoucherBtn")?.addEventListener("click", () => detail.order && printAdvanceVoucher(detail.order, {}));
  }

  // ------------------------------------------------------------------ arranque

  function init() {
    bindWizardOnce();
    bindListOnce();
    bindToggleOnce();
    loadEnabled()
      .then(() => {
        if (isEnabled()) refreshCount().catch(() => {});
      })
      .catch(() => {});
  }

  window.TPV_ENCARGOS = {
    init,
    isEnabled,
    loadEnabled,
    applyUI,
    bindToggleOnce,
    refreshCount,
    refreshPassButton,
    scheduleNovelty,
    call,
    postWithRetry,
    openWizard,
    openList,
    openDetail,
    openAdvanceDialog,
    onRealtime,
    printTodayList,
    createFsPedido,
    cancelFsPedidoQuietly,
    getFsPedidoStateId,
    syncFsObservaciones,
    buildFsObservaciones,
    printReceipt,
    printAdvanceVoucher,
    pickupLabel,
    formatDateTimeEs,
    dateKey,
    state,
  };
})();
