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

  // Edición de un encargo (ver el bloque «editar un encargo»): el carrito se usa para cambiar sus productos.
  const edit = {
    active: false,
    pendingRestore: null,
    restoreAt: 0,
    orderId: 0,
    orderCode: "",
    version: 0,
    codcliente: "",
    customerName: "",
    customerPhone: "",
    notes: "",
    pickupAt: "",
    fsIdpedido: "",
    collected: 0,
    total: 0,
    label: "",
  };

  // Copia de una línea del carrito apta para guardar (JSON) y volver a cargar al editar.
  function cleanCartLine(it) {
    try {
      return JSON.parse(JSON.stringify(it));
    } catch {
      return null;
    }
  }

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
    if (edit.active) return "Estás editando un encargo: guarda o descarta los cambios antes de pasar otro carrito a encargo.";
    if (typeof cashSession === "undefined" || !cashSession?.open) return "Abre la caja para poder pasar a encargo.";
    if (!hasVisibleCartLines()) return "Añade productos al carrito para pasarlos a encargo.";
    if (currentParkedTicketIndex != null)
      return "Este carrito pertenece a un pedido aparcado: cóbralo o ábrelo sin aparcar para pasarlo a encargo.";
    if (typeof MESAS_INLINE_ACTIVE !== "undefined" && MESAS_INLINE_ACTIVE && MESAS_INLINE_VIEW === "transacciones")
      return "En Modo Mesas, crea los encargos desde el TPV, fuera de las mesas.";
    return "";
  }

  function refreshPassButton() {
    maybeRestoreEdit();
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
  // Reserva virtual de stock (decisión del jefe, 3-nov): lo de los encargos pendientes con recogida de hoy o anterior
  // se resta del stock que ve el TPV (tarjeta y aviso al vender) sin tocar el stock real de FacturaScripts. Empieza a
  // las 00:00 del día de la recogida y se libera sola cuando el encargo deja de estar pendiente. Un pack reserva igual
  // que en el carrito: su propia unidad y cada componente elegido (por referencia, con la cantidad ya multiplicada).
  const reserved = { map: new Map(), day: "" };

  function getReservedQty(idproducto) {
    if (!isEnabled()) return 0;
    return Number(reserved.map.get(Number(idproducto)) || 0);
  }

  function setReservations(rows, today) {
    const next = new Map();
    for (const o of rows) {
      for (const l of Array.isArray(o.lines) ? o.lines : []) {
        const id = Number(l.idproducto) || 0;
        const q = Number(l.qty) || 0;
        if (id > 0 && q > 0) next.set(id, (next.get(id) || 0) + q);
        for (const c of Array.isArray(l.children) ? l.children : []) {
          const cq = Number(c.qty) || 0;
          const cid = cq > 0 ? Number(resolveProductIdByReferenceSync(String(c.ref || ""))) || 0 : 0;
          if (cid > 0) next.set(cid, round2((next.get(cid) || 0) + cq));
        }
      }
    }
    reserved.map = next;
    reserved.day = today;
    try {
      updateRenderedProductStocks();
    } catch {}
  }

  async function refreshCount() {
    if (!isEnabled()) {
      if (reserved.map.size) setReservations([], "");
      return;
    }
    // "offline" vive en el TPV_STATE de renderer.js (let global); "isAdmin" en window.TPV_STATE.
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) return;
    const today = dateKey(new Date());
    // withLines=slim: solo producto y cantidad de cada línea (para la reserva), no la copia entera del carrito
    const r = await call("list-customer-orders", { query: { status: "pendiente", to: today, limit: "500", withLines: "slim" } });
    if (!r.ok) return;
    const rows = Array.isArray(r.json?.data) ? r.json.data : [];
    const overdue = rows.filter((o) => String(o.pickupAt || "").slice(0, 10) < today).length;
    setBadge(rows.length, overdue > 0);
    setReservations(rows, today);
  }

  // A las 00:00 empiezan a reservar los encargos de ese día: se vuelve a calcular al cambiar de fecha.
  setInterval(() => {
    if (isEnabled() && reserved.day && reserved.day !== dateKey(new Date())) refreshCount().catch(() => {});
  }, 60000);

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

  // ------------------------------------------------------------------ aviso al abrir la caja

  // Una vez por caja y día, con la caja abierta: lista de los encargos de hoy y los vencidos que faltan por recoger,
  // para que el equipo los tenga presentes desde el principio del turno. No molesta si no hay ninguno.
  const CFG_TODAY_PROMPT_KEY = "ui.encargosTodayPromptKey";
  let todayPromptBusy = false;

  async function maybeShowTodayPrompt() {
    if (todayPromptBusy || !isEnabled()) return;
    if (typeof cashSession === "undefined" || !cashSession?.open) return;
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) return;
    if (document.body.classList.contains("modal-locked")) return;
    if (document.querySelector(".simple-overlay:not(.hidden), .critical-overlay:not(.hidden)")) return;
    if (wiz.open || edit.active || hasVisibleCartLines()) return;
    const today = dateKey(new Date());
    const key = `${String(getCajaIdSafe() || "")}|${today}|${String(currentTerminal?.id || "")}`;
    todayPromptBusy = true;
    try {
      if (String((await cfgGet(CFG_TODAY_PROMPT_KEY)) || "") === key) return;
      const r = await call("list-customer-orders", { query: { status: "pendiente", to: today, limit: "100" } });
      if (!r.ok) return;
      // Se recomprueba: durante la espera pudo abrirse otro cuadro o el cajero empezar una venta.
      if (document.querySelector(".simple-overlay:not(.hidden), .critical-overlay:not(.hidden)") || hasVisibleCartLines()) return;
      await cfgSet(CFG_TODAY_PROMPT_KEY, key);
      const rows = Array.isArray(r.json?.data) ? r.json.data : [];
      if (!rows.length) return;
      showTodayPrompt(rows, today);
    } finally {
      todayPromptBusy = false;
    }
  }

  function showTodayPrompt(rows, today) {
    const overlay = $("encargosTodayOverlay");
    if (!overlay) return;
    const late = rows.filter((o) => String(o.pickupAt || "").slice(0, 10) < today).length;
    $("encTodaySub").textContent =
      `${rows.length} ${rows.length === 1 ? "encargo" : "encargos"} de hoy o vencidos por entregar` + (late ? ` (${late} vencido${late === 1 ? "" : "s"}).` : ".");
    $("encTodayList").innerHTML = rows
      .map((o) => {
        const isLate = String(o.pickupAt || "").slice(0, 10) < today;
        const when = isLate ? `${String(o.pickupAt).slice(8, 10)}/${String(o.pickupAt).slice(5, 7)}` : String(o.pickupAt).slice(11, 16);
        return (
          `<div class="enc-today-row${isLate ? " is-late" : ""}">` +
          `<span class="t">${escapeHtml(when)}</span>` +
          `<span class="n">${escapeHtml(o.customerName)}${o.customerPhone ? " · " + escapeHtml(o.customerPhone) : ""}</span>` +
          `<span class="m">${o.pending > 0 ? "Falta " + escapeHtml(fmtMoney(o.pending)) : "Pagado"}</span>` +
          `</div>`
        );
      })
      .join("");
    overlay.classList.remove("hidden");
    lockAppUI();
    const close = () => {
      overlay.classList.add("hidden");
      unlockAppUI();
    };
    $("encTodayCloseBtn").onclick = close;
    $("encTodayOpenBtn").onclick = () => {
      close();
      openList();
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
      codserie: "S",
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
    contact: { name: "", phone: "" }, // nombre y telefono del cliente de la factura (para ponerlos con un toque)
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
    const all = Array.isArray(wiz.snapshot) ? wiz.snapshot : [];
    const out = visibleSnapshotLines().map((it) => {
      const pricing = getCartLinePricing(it);
      const addons = Array.isArray(it.addons) ? it.addons.map((a) => String(a?.nombre || "").trim()).filter(Boolean) : [];
      const name = String(it.name || it.descripcion || it.referencia || "Producto").trim();
      return {
        name: addons.length ? `${name} (+${addons.join(", +")})` : name,
        idproducto: Number(it.baseProductId || it.idproducto || it.id || 0) || 0,
        referencia: String(it.referencia || "").trim(),
        qty: Number(it.qty) || 0,
        unit: pricing.unitGross,
        total: pricing.lineTotal,
        // copia de la línea del carrito y de sus componentes (packs), para recuperarla tal cual al editar
        cartLine: cleanCartLine(it),
        cartChildren: all
          .filter((c) => c?.meta?.includedInPack && String(c?.meta?.parentPackLineId || "") === String(it._lineId || ""))
          .map(cleanCartLine)
          .filter(Boolean),
      };
    });
    // Si el encargo es enorme, se guarda sin las copias (se podrá editar reconstruyendo las líneas desde el catálogo).
    if (JSON.stringify(out).length > 200000) out.forEach((l) => { delete l.cartLine; delete l.cartChildren; });
    return out;
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

    {
      const ct = customerContact(wiz.codcliente);
      wiz.contact = ct;
      $("encName").value = ct.name;
      $("encPhone").value = ct.phone;
    }
    $("encNotes").value = "";
    $("encDayInput").value = "";
    $("encSumDetail").classList.add("hidden");
    showWizError("");

    wiz.serverError = "";
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
    wiz.editNumero2 = "";
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
    const single = wiz.mode === "edit" || wiz.mode === "data";
    $("encWizTitle").textContent =
      wiz.mode === "advance"
        ? "Cobrar otro anticipo"
        : wiz.mode === "edit"
          ? "Editar encargo · Datos"
          : wiz.mode === "data"
            ? "Editar datos del encargo"
            : p1
              ? "Nuevo encargo · Datos"
              : "Nuevo encargo · Anticipo";
    $("encWizStep").textContent = wiz.mode === "advance" || single ? "" : `Paso ${wiz.page} de 2`;
    // Editar: una sola página, sin anticipo (los anticipos no se tocan aquí; «Cobrar otro anticipo» está en el detalle).
    $("encNextBtn").classList.toggle("hidden", single);
    $("encargoWizardOverlay").classList.toggle("enc-data-mode", wiz.mode === "data");
    $("encSaveNoAdvBtn").textContent = single ? "Guardar cambios" : "Guardar sin anticipo";
    $("encSaveNoAdvBtn").classList.toggle("enc-btn-blue", single);
    $("encSaveNoAdvBtn").classList.toggle("enc-btn-outline", !single);
    syncClearButtons();
    if ($("encFootNote")) $("encFootNote").textContent = single ? "Los campos con * son obligatorios." : "Los campos con * son obligatorios. Hasta el último paso no se guarda nada.";
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
    // El error del servidor (p. ej. «se está atendiendo en otro dispositivo») se conserva hasta que el usuario toque
    // algo; antes este redibujado lo borraba al instante y el cajero no veía nada.
    const err = page2Error();
    showWizError(err || wiz.serverError || "");
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
    wiz.serverError = "";
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
    wiz.serverError = "";
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
    // Al editar, un encargo vencido puede conservar su fecha: solo se exige futura si se ha cambiado.
    const unchanged =
      (wiz.mode === "edit" && `${day} ${wiz.time}` === edit.pickupAt) ||
      (wiz.mode === "data" && wiz.order && `${day} ${wiz.time}` === wiz.order.pickupAt);
    if (!unchanged && when.getTime() < Date.now() - 5 * 60 * 1000) return "El día y la hora de recogida ya han pasado.";
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
    if (wiz.mode === "edit") return saveEdit();
    if (wiz.mode === "data") return saveDataEdit();
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
    wiz.serverError = "";
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
      wiz.serverError = String(e?.message || e);
      showWizError(wiz.serverError);
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
  function showResult(order, ctx, title) {
    lastResult = { order, ctx };
    $("encResTitle").textContent = String(title || "Encargo guardado").replace(/\s*✓$/, "");
    $("encResText").innerHTML =
      `<div class="enc-res-name">${escapeHtml(order.customerName)}</div>` +
      `<div class="enc-res-when">Recoge ${escapeHtml(pickupLabel(order.pickupAt))}</div>` +
      `<div class="enc-res-stats">` +
      `<div><small>Total</small><strong>${escapeHtml(fmtMoney(order.total))}</strong></div>` +
      `<div><small>Anticipo</small><strong>${escapeHtml(fmtMoney(order.collected))}</strong></div>` +
      `<div class="${order.pending > 0 ? "is-due" : "is-ok"}"><small>Falta</small><strong>${escapeHtml(fmtMoney(order.pending))}</strong></div>` +
      `</div>` +
      `<div class="enc-res-code">Código ${escapeHtml(order.orderCode)}${order.fsCodigo ? " · Pedido " + escapeHtml(order.fsCodigo) : ""}</div>`;
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
      // Sin relleno negro: en la termica POS-80C un bloque negro grande hacia parar la impresora (pitido y error de Windows).
      ".pick{border:5px solid #000;margin:8px 0;padding:4px 2px;text-align:center}.pick .l{font-size:13px;font-weight:800;letter-spacing:4px}.pick .v{font-size:25px;font-weight:900;margin-top:2px}" +
      ".note{border:2px solid #000;padding:5px 6px;margin:8px 0}.note .l{font-size:11px;font-weight:700;letter-spacing:1px}.note .v{font-size:16px;font-weight:800;margin-top:2px;word-break:break-word}" +
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
        `<div class="pick"><div class="l">RECOGE</div><div class="v">${esc(pickupLabel(order.pickupAt).toUpperCase())}</div></div>` +
        `<div>Cliente: <strong>${esc(order.customerName)}</strong></div>` +
        (order.customerPhone ? `<div>Teléfono: ${esc(order.customerPhone)}</div>` : "") +
        (order.notes ? `<div class="note"><div class="l">NOTA</div><div class="v">${esc(order.notes)}</div></div>` : "") +
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

  // Justificante de devolucion: lo que se devuelve al cliente al cancelar un encargo con anticipo. Una linea por forma de
  // pago: el efectivo se entrega; tarjeta/transferencia se reversa fuera del TPV (datafono / banco), y asi queda dicho.
  async function printRefundVoucher(order, refunds) {
    const esc = escapeHtml;
    const rows = Array.isArray(refunds) && refunds.length
      ? refunds
      : (order.moves || []).filter((m) => m.kind === "devolucion").map((m) => ({ codpago: m.codpago, amount: m.amount }));
    if (!rows.length) return false;
    const total = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const labels = await getFormasPagoMap().catch(() => ({}));
    const body = rows
      .map((r) => {
        const label = labels[String(r.codpago || "").trim()] || String(r.codpago || "");
        return (
          `<div class="r"><span>${esc(label)}</span><span>${esc(fmtMoney(r.amount))}</span></div>` +
          `<div class="s">${isCashCode(r.codpago) ? "Entregado en efectivo al cliente" : "Devolución a reversar en datáfono / banco"}</div>`
        );
      })
      .join("");
    const html = ticketShell(
      companyHeaderHtml() +
        `<div class="sep"></div><div class="c b" style="font-size:14px">JUSTIFICANTE DE DEVOLUCIÓN</div>` +
        `<div class="c s">No es una factura</div>` +
        `<div class="s">Encargo: ${esc(order.orderCode)} (cancelado)</div>` +
        `<div class="s">Fecha: ${esc(formatDateTimeEs(Date.now()))}</div>` +
        `<div>Cliente: <strong>${esc(order.customerName)}</strong></div>` +
        `<div class="sep"></div>` +
        body +
        `<div class="sep"></div>` +
        `<div class="r big"><span>TOTAL DEVUELTO</span><span>${esc(fmtMoney(total))}</span></div>` +
        `<div class="sep"></div><div class="c s">Se devuelve el anticipo cobrado a cuenta.<br>El encargo queda cancelado.</div>` +
        `<div class="s">TPV: ${esc(String(currentTerminal?.name || ""))} · Agente: ${esc(wizAgentName())}</div>`,
    );
    return printHtml(html);
  }

  // ------------------------------------------------------------------ resguardo por email

  // Mismo cuadro, mismo PDF por IPC y mismo envío por el servidor que «Enviar factura»; solo cambia el documento.
  function buildReceiptEmailHtml(order) {
    const esc = escapeHtml;
    const emp = (typeof companyInfo !== "undefined" && companyInfo) || {};
    const logo =
      typeof companyLogoUrl !== "undefined" && companyLogoUrl
        ? `<img src="${esc(companyLogoUrl)}" style="max-width:55mm;max-height:22mm;display:block;margin-bottom:6px" />`
        : "";
    const rows = (Array.isArray(order.lines) ? order.lines : [])
      .map(
        (l) =>
          `<tr><td>${esc(fmtQty(l.qty))}</td><td>${esc(l.name)}</td><td class="n">${esc(fmtMoney(l.unit))}</td><td class="n">${esc(fmtMoney(l.total))}</td></tr>`,
      )
      .join("");
    const addr = [emp.direccion, `${emp.codpostal ? emp.codpostal + ", " : ""}${emp.ciudad || ""}`.trim(), emp.cifnif ? "CIF: " + emp.cifnif : ""]
      .filter(Boolean)
      .map(esc)
      .join(" · ");
    return (
      `<!doctype html><html><head><meta charset="utf-8"><style>` +
      `@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1f2937}` +
      `h1{font-size:20px;margin:0}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}` +
      `.bar{background:#3D67AC;color:#fff;padding:10px 14px;margin:14px 0;border-radius:6px;display:flex;justify-content:space-between;font-size:15px;font-weight:700}` +
      `.box{border:2px solid #1f2937;border-radius:8px;padding:10px 14px;margin:10px 0;text-align:center}.box .big{font-size:20px;font-weight:800}` +
      `table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:6px 8px;border-bottom:1px solid #d1d5db;text-align:left}th{background:#f3f4f6}.n{text-align:right;white-space:nowrap}` +
      `.tot td{font-weight:700;border-bottom:none}.pend td{font-size:16px;font-weight:800}.foot{margin-top:18px;color:#6b7280;font-size:12px}` +
      `</style></head><body>` +
      `<div class="top"><div>${logo}<h1>${esc(emp.nombrecorto || emp.nombre || "")}</h1><div style="color:#6b7280;font-size:12px">${addr}</div></div>` +
      `<div style="text-align:right"><strong>Código</strong><br>${esc(order.orderCode)}<br><span style="color:#6b7280;font-size:12px">${esc(formatDateTimeEs(order.createdAtMs))}</span></div></div>` +
      `<div class="bar"><span>RESGUARDO DE ENCARGO</span><span>${esc(fmtMoney(order.total))}</span></div>` +
      `<div class="box"><div style="font-size:12px;letter-spacing:1px">RECOGE</div><div class="big">${esc(pickupLabel(order.pickupAt).toUpperCase())}</div></div>` +
      `<div><strong>Cliente:</strong> ${esc(order.customerName)}${order.customerPhone ? " · " + esc(order.customerPhone) : ""}</div>` +
      (order.notes ? `<div style="margin:8px 0;border:2px solid #1f2937;border-radius:8px;padding:8px 12px;font-size:15px;font-weight:700"><span style="font-size:12px;letter-spacing:1px">NOTA</span><br>${esc(order.notes)}</div>` : "") +
      `<table><thead><tr><th>Cant.</th><th>Descripción</th><th class="n">Precio</th><th class="n">Importe</th></tr></thead><tbody>${rows}` +
      `<tr class="tot"><td colspan="3" class="n">Total</td><td class="n">${esc(fmtMoney(order.total))}</td></tr>` +
      `<tr class="tot"><td colspan="3" class="n">Anticipo cobrado</td><td class="n">${esc(fmtMoney(order.collected))}</td></tr>` +
      `<tr class="pend"><td colspan="3" class="n">Falta por cobrar</td><td class="n">${esc(fmtMoney(order.pending))}</td></tr></tbody></table>` +
      `<div class="foot">Este documento no es una factura. Presente este resguardo al recoger el pedido; la factura se emite en ese momento.</div>` +
      `</body></html>`
    );
  }

  async function emailReceiptFlow(order) {
    if (!order) return;
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) return toast("Enviar por email necesita conexión.", "warn", "Encargos");
    if ((await getInvoiceEmailStatus()) === false) {
      if (!isAdminUser()) {
        return showMessageModal(
          "Enviar resguardo",
          "El correo de esta empresa no está configurado, así que no se pueden enviar emails.\n\nPide a un administrador que lo configure desde el botón «Enviar factura» de un ticket.",
        );
      }
      const configure = await confirmModal(
        "Enviar resguardo",
        "El correo de esta empresa no está configurado, así que no se pueden enviar emails.\n\n¿Quieres configurarlo ahora? Solo hace falta el email y su contraseña.",
        { okButtonText: "Configurar ahora" },
      );
      if (!configure) return;
      if (!(await openEmailConfigModal())) return;
    }
    const code = String(order.orderCode || "");
    const res = await openSendInvoiceEmailModal({
      title: "Enviar resguardo por email",
      prefillEmail: "",
      prefillName: order.customerName || "",
      defaultMessage: `Hola.\n\nLe enviamos el resguardo de su encargo (${code}), para recoger ${pickupLabel(order.pickupAt)}.\n\nGracias, un saludo.`,
    });
    if (!res) return;
    toast("Generando resguardo…", "info", "Encargos");
    const pdf = await window.TPV_PRINT?.renderInvoicePdf?.({ html: buildReceiptEmailHtml(order) });
    if (!pdf?.ok) return toast("No se pudo generar el PDF: " + (pdf?.error || "error"), "err", "Encargos");
    try {
      await apiSendInvoiceEmail({
        toEmail: res.toEmail,
        subject: `Resguardo de su encargo ${code}`,
        message: res.message,
        pdfBase64: pdf.pdfBase64,
        fileName: `Resguardo ${code}.pdf`,
      });
      toast("Resguardo enviado ✅", "ok", "Encargos");
    } catch (e) {
      reportClientEvent("email", "send-encargo-receipt-failed", e?.message || e, {}, "error");
      toast("No se pudo enviar el resguardo: " + (e?.message || e), "err", "Encargos");
    }
  }

  // ------------------------------------------------------------------ enganche de los controles

  function syncClearButtons() {
    document.querySelectorAll("#encargoWizardOverlay .enc-input-x").forEach((b) => {
      const inp = $(b.dataset.clear);
      b.classList.toggle("hidden", !(inp && inp.value));
    });
    // Si el campo se vació, un botón junto al cliente de la factura permite volver a poner su nombre/teléfono de un toque.
    const useName = $("encUseNameBtn");
    const usePhone = $("encUsePhoneBtn");
    const ct = wiz.contact || { name: "", phone: "" };
    if (useName) {
      useName.classList.toggle("hidden", !(ct.name && !$("encName").value.trim()));
      useName.textContent = "Usar «" + ct.name + "» como nombre";
    }
    if (usePhone) {
      usePhone.classList.toggle("hidden", !(ct.phone && !$("encPhone").value.trim()));
      usePhone.textContent = "Usar el teléfono " + ct.phone;
    }
  }

  let wizardBound = false;
  function bindWizardOnce() {
    if (wizardBound) return;
    wizardBound = true;

    $("passToEncargoBtn")?.addEventListener("click", () => openWizard());

    // Botón ✕ para vaciar de un toque el nombre y el teléfono
    document.querySelectorAll("#encargoWizardOverlay .enc-input-x").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const inp = $(b.dataset.clear);
        if (inp) inp.value = "";
        syncClearButtons();
      });
    });
    ["encName", "encPhone"].forEach((id) => $(id)?.addEventListener("input", syncClearButtons));
    $("encUseNameBtn")?.addEventListener("click", () => {
      $("encName").value = (wiz.contact && wiz.contact.name) || "";
      syncClearButtons();
    });
    $("encUsePhoneBtn")?.addEventListener("click", () => {
      $("encPhone").value = (wiz.contact && wiz.contact.phone) || "";
      syncClearButtons();
    });
    // el teclado en pantalla escribe sin lanzar "input": se repasa mientras el asistente está abierto
    setInterval(() => {
      if (wiz.open) syncClearButtons();
    }, 400);

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
      wiz.serverError = "";
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
    wiz.serverError = "";
    wiz.open = true;
    $("encargoWizardOverlay").classList.remove("hidden");
    lockAppUI();
    renderWizard();
  }

  async function saveAdvance() {
    if (wiz.saving) return;
    const err = page2Error();
    if (err) return showWizError(err);
    wiz.serverError = "";
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
      wiz.serverError = String(e?.message || e);
      showWizError(wiz.serverError);
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
        const isToday = o.status === "pendiente" && key === today;
        html +=
          `<div role="button" tabindex="0" class="enc-item${late ? " is-late" : ""}${isToday ? " is-today" : ""}" data-id="${o.id}">` +
          `<div class="enc-item-time"><strong>${escapeHtml(String(o.pickupAt).slice(11, 16))}</strong><small>${late ? "vencido" : "recogida"}</small></div>` +
          `<div class="enc-item-main"><strong>${escapeHtml(o.customerName)}</strong><small>${escapeHtml([o.customerPhone, orderSummaryText(o)].filter(Boolean).join(" · "))}</small></div>` +
          `<div class="enc-item-money"><span>Total ${escapeHtml(fmtMoney(o.total))}</span><small>Anticipo ${escapeHtml(fmtMoney(o.collected))}</small></div>` +
          `<div class="enc-item-pend ${o.pending > 0 ? "is-due" : "is-ok"}">${o.status === "pendiente" ? `Falta ${escapeHtml(fmtMoney(o.pending))}` : ""}</div>` +
          `<div class="enc-item-chip ${chip.cls}">${chip.text}</div>` +
          `<div class="enc-item-act">${o.status === "pendiente" ? `<button type="button" class="enc-item-x" data-cancel-id="${o.id}" title="Cancelar este encargo">Cancelar</button>` : ""}</div>` +
          `</div>`;
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
    const invName = customerNameForCod(o.codcliente);
    $("encDetInfo").innerHTML =
      `<div class="enc-det-when">Recoge ${escapeHtml(pickupLabel(o.pickupAt))}</div>` +
      `<div class="enc-det-meta">` +
      (o.customerPhone ? `<span class="enc-det-tag">📞 ${escapeHtml(o.customerPhone)}</span>` : "") +
      (invName && String(o.codcliente) !== String(currentTerminal?.codcliente || "1")
        ? `<span class="enc-det-tag is-invoice">Factura a nombre de: ${escapeHtml(invName)}</span>`
        : "") +
      `<span class="enc-det-tag">Código ${escapeHtml(o.orderCode)}</span>` +
      (o.fsCodigo ? `<span class="enc-det-tag">Pedido ${escapeHtml(o.fsCodigo)}</span>` : "") +
      (o.fsFacturaCodigo ? `<span class="enc-det-tag">Factura ${escapeHtml(o.fsFacturaCodigo)}</span>` : "") +
      `<span class="enc-det-tag">Creado por ${escapeHtml(o.createdBy || "—")} · ${escapeHtml(formatDateTimeEs(o.createdAtMs))}</span>` +
      `</div>` +
      (o.notes ? `<div class="enc-det-notecard"><b>Nota</b><span>${escapeHtml(o.notes)}</span></div>` : "");
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
      `<div class="enc-stat"><small>Total</small><strong>${escapeHtml(fmtMoney(o.total))}</strong></div>` +
      `<div class="enc-stat"><small>Cobrado a cuenta</small><strong>${escapeHtml(fmtMoney(o.collected))}</strong></div>` +
      (o.status === "pendiente" ? `<div class="enc-stat is-due"><small>Falta por cobrar</small><strong>${escapeHtml(fmtMoney(o.pending))}</strong></div>` : "");
    const pend = o.status === "pendiente";
    $("encDetAdvanceBtn").classList.toggle("hidden", !(pend && o.pending > 0));
    $("encDetPickupBtn").classList.toggle("hidden", !pend);
    $("encDetEditBtn").classList.toggle("hidden", !pend);
    $("encDetEditDataBtn").classList.toggle("hidden", !pend);
    $("encDetEmailBtn").classList.toggle("hidden", !pend);
    $("encDetCloseUnclaimedBtn").classList.toggle("hidden", !(pend && o.collected > 0));
    $("encDetPickupBtn").textContent = o.pending > 0 ? "Recoger y cobrar " + fmtMoney(o.pending) : "Entregar (ya pagado)";
    $("encDetCancelBtn").classList.toggle("hidden", !pend);
    $("encDetVoucherBtn").classList.toggle("hidden", !(o.collected > 0));
    $("encDetRefundBtn").classList.toggle("hidden", !(o.moves || []).some((m) => m.kind === "devolucion"));
  }

  // ------------------------------------------------------------------ cancelar un encargo

  // Cancelar desde la propia lista, sin abrir el detalle (pide confirmación y devuelve el dinero igual que desde el detalle).
  async function quickCancel(id) {
    let r;
    try {
      r = await call("get-customer-order", { query: { orderId: String(id) } });
    } catch {
      return toast("Sin conexión con el servidor.", "warn", "Encargos");
    }
    if (!r.ok || !r.json?.data) {
      toast(r.json?.error || "No se pudo abrir el encargo.", "warn", "Encargos");
      if (list.open) loadList().catch(() => {});
      return;
    }
    detail.order = r.json.data;
    try {
      await cancelOrderFlow();
    } finally {
      if (!detail.open) detail.order = null;
    }
  }

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
    if (refunds.length && isAutoPrintEnabled()) printRefundVoucher(order, refunds).catch(() => {});
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
          (o.notes ? `<div style="font-size:13px;font-weight:800;border:2px solid #000;padding:2px 4px;margin-top:3px">NOTA: ${esc(o.notes)}</div>` : "")
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
      const x = e.target.closest(".enc-item-x");
      if (x) {
        e.stopPropagation();
        quickCancel(x.dataset.cancelId).catch(() => {});
        return;
      }
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
    $("encDetPickupBtn")?.addEventListener("click", () => pickupFlow());
    $("encDetCloseUnclaimedBtn")?.addEventListener("click", () => closeUnclaimedFlow());
    $("encDetCancelBtn")?.addEventListener("click", () => cancelOrderFlow());
    $("encDetReceiptBtn")?.addEventListener("click", () => detail.order && printReceipt(detail.order));
    $("encDetRefundBtn")?.addEventListener("click", () => detail.order && printRefundVoucher(detail.order));
    $("encDetEmailBtn")?.addEventListener("click", () => emailReceiptFlow(detail.order));
    $("encResEmailBtn")?.addEventListener("click", () => lastResult && emailReceiptFlow(lastResult.order));
    $("encDetVoucherBtn")?.addEventListener("click", () => detail.order && printAdvanceVoucher(detail.order, {}));
  }

  // ------------------------------------------------------------------ recoger y cobrar el resto

  // Pasos (cada uno se puede repetir sin duplicar nada, para poder continuar si algo se corta a medias):
  //   1. candado de recogida en el servidor (nadie mas lo edita ni lo recoge a la vez);
  //   2. si falta dinero, la ventana de cobro de siempre (varias formas de pago, cambio, cajon);
  //   3. aviso de stock como al cobrar («Sin stock suficiente» / «Cobrar sin stock»);
  //   4. FacturaScripts convierte el pedido en factura (estado «Facturar»), la reconocemos por numero2;
  //   5. se completan los datos del TPV y se emite; recibos = cada anticipo (con su fecha) + lo cobrado ahora;
  //   6. el servidor anota el resto, aplica los anticipos a la factura y marca el encargo como recogido.

  async function findFsFacturaByNumero2(numero2) {
    const rows = await apiRead(`facturaclientes?filter[numero2]=${encodeURIComponent(numero2)}&limit=1`);
    const rowsArr = Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : [];
    return rowsArr[0] || null;
  }

  // numero2 del pedido VIGENTE de FacturaScripts (tras editar un encargo, el pedido nuevo lleva otro numero2 que
  // el código del encargo); la factura que sale de convertirlo lo copia.
  async function pedidoNumero2(order) {
    try {
      if (order.fsIdpedido) {
        const p = await apiRead(`pedidoclientes/${encodeURIComponent(order.fsIdpedido)}`);
        const n = String((p?.data || p)?.numero2 || "").trim();
        if (n) return n;
      }
    } catch {}
    return order.orderCode;
  }

  async function ensureFsFacturaFromPedido(order) {
    const n2 = await pedidoNumero2(order);
    let f = await findFsFacturaByNumero2(n2).catch(() => null);
    if (f) return f; // ya convertido (reintento)
    if (!order.fsIdpedido) throw new Error("El encargo no tiene pedido en FacturaScripts.");
    const idestado = await getFsPedidoStateId("facturar");
    try {
      await apiWrite(`pedidoclientes/${encodeURIComponent(order.fsIdpedido)}`, "PUT", { idestado }, { timeoutMs: 120000 });
    } catch (e) {
      f = await findFsFacturaByNumero2(n2).catch(() => null);
      if (f) return f;
      throw e;
    }
    for (let i = 0; i < 6; i++) {
      f = await findFsFacturaByNumero2(n2).catch(() => null);
      if (f) return f;
      await sleep(600);
    }
    throw new Error("FacturaScripts no creó la factura del encargo.");
  }

  // Recibo pagado (anticipo o resto). El texto de las observaciones lo identifica (así un reintento no lo duplica).
  async function createEncargoRecibo({ factura, codpago, importe, fechapago, note }) {
    const fields = {
      idfactura: factura.idfactura,
      codcliente: factura.codcliente,
      codpago,
      importe: Number(Number(importe).toFixed(2)),
      pagado: 1,
      fecha: dateKey(new Date()),
      vencimiento: dateKey(new Date()),
      fechapago,
      observaciones: note,
    };
    if (factura.idempresa != null) fields.idempresa = factura.idempresa;
    if (factura.codigo) fields.codigofactura = factura.codigo;
    if (factura.coddivisa) fields.coddivisa = factura.coddivisa;
    return apiWrite("reciboclientes", "POST", fields, { timeoutMs: 30000 });
  }

  async function syncEncargoRecibos(factura, order, expected) {
    const tag = `ENCARGO ${order.orderCode}`;
    const existing = await fetchRecibosByFactura(factura.idfactura);
    for (const e of expected) {
      const note = `${tag} ${e.opCode} ${e.label}`;
      if ((existing || []).some((r) => String(r.observaciones || "").includes(`${tag} ${e.opCode}`))) continue;
      await createEncargoRecibo({ factura, codpago: e.codpago, importe: e.amount, fechapago: e.fechapago, note });
    }
    // El recibo automatico por el total (y cualquier otro que no sea de este encargo) se quita.
    const after = await fetchRecibosByFactura(factura.idfactura);
    for (const r of after || []) {
      if (String(r.observaciones || "").includes(tag)) continue;
      const id = r.idrecibo || r.id || r.idrecibocliente;
      if (id) await deleteReciboCliente(id).catch((err) => console.warn("[ENCARGOS] recibo sobrante:", err?.message || err));
    }
  }

  function hidePostPayQuietly() {
    try {
      if (typeof __postPayTimer !== "undefined" && __postPayTimer) clearTimeout(__postPayTimer);
      if (typeof __postPayCountdownTimer !== "undefined" && __postPayCountdownTimer) clearInterval(__postPayCountdownTimer);
    } catch {}
    $("postPayOverlay")?.classList.add("hidden");
    window.__POSTPAY_PENDING__ = null;
  }

  async function payRestWithModal(amount) {
    const overlay = $("payOverlay");
    const title = overlay?.querySelector(".pay-header h2");
    document.body.classList.add("pay-encargo-mode");
    if (title) title.textContent = "Cobrar el resto del encargo";
    try {
      return await openPayModal(amount);
    } finally {
      document.body.classList.remove("pay-encargo-mode");
      if (title) title.textContent = "Cobrar";
    }
  }

  // Productos del encargo con stock insuficiente (solo los que FacturaScripts no deja vender sin stock).
  async function stockProblemsForOrder(order) {
    const items = (Array.isArray(order.lines) ? order.lines : [])
      .filter((l) => Number(l.idproducto) > 0)
      .map((l) => ({ baseProductId: Number(l.idproducto), id: Number(l.idproducto), qty: Number(l.qty) || 0, name: l.name }));
    if (!items.length) return null;
    // Al recoger se compara con el stock físico: la reserva de este y otros encargos no debe bloquear su propia entrega.
    return checkCartStockProblems(items, { ignoreEncargos: true });
  }

  async function pickupFlow() {
    const o0 = detail.order;
    if (!o0 || o0.status !== "pendiente") return;
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) return toast("Encargos necesita conexión con el servidor.", "warn", "Encargos");
    if (!cashSession?.open) return toast("Abre la caja para poder cobrar.", "warn", "Encargos");
    if (!currentTerminal?.id) return toast("Selecciona un terminal para cobrar.", "warn", "Encargos");
    if (!(await requireAssignedAgentOrBlock({ showModal: true }))) return;

    // 1) candado
    let lockR;
    try {
      lockR = await call("lock-customer-order-pickup", { method: "POST", body: { orderId: o0.id, sessionId: sessionId(), ttlMs: 600000 } });
    } catch {
      return toast("Sin conexión con el servidor.", "warn", "Encargos");
    }
    if (lockR.status === 423) {
      return showMessageModal("Se está atendiendo en otro dispositivo", "Este encargo se está recogiendo o editando en otro terminal. Espera unos segundos y vuelve a intentarlo.");
    }
    if (!lockR.ok || !lockR.json?.data) return showMessageModal("No se pudo recoger", lockR.json?.error || `El servidor no aceptó la recogida (HTTP ${lockR.status}).`);

    let released = false;
    const unlock = async () => {
      if (released) return;
      released = true;
      try {
        await call("unlock-customer-order-pickup", { method: "POST", body: { orderId: o0.id, sessionId: sessionId() } });
      } catch {}
    };
    let stockOverrideIds = [];
    let payModalShown = false;
    try {
      const order = lockR.json.data;
      if (order.status !== "pendiente") {
        detail.order = order;
        await renderDetail();
        await unlock();
        return toast("Este encargo ya no está pendiente.", "info", "Encargos");
      }
      const pending = round2(order.pending);

      // Si una recogida anterior se cortó a medias (la factura ya tiene los recibos de lo cobrado), se continúa con
      // ESOS cobros: no se vuelve a pedir el pago ni se puede cambiar la forma de pago por el camino.
      let resumed = null;
      const existingFactura = await findFsFacturaByNumero2(await pedidoNumero2(order)).catch(() => null);
      if (existingFactura) {
        const rec = await fetchRecibosByFactura(existingFactura.idfactura).catch(() => []);
        // El texto de cada recibo del resto lleva el código de la operación («<código>-R1»); el código del encargo
        // solo tiene letras, cifras, punto, guion y guion bajo.
        const prefix = `${order.orderCode}-R`;
        const opOf = (obs) => {
          const i = String(obs || "").indexOf(prefix);
          if (i < 0) return "";
          let j = i + prefix.length;
          while (j < obs.length && obs[j] >= "0" && obs[j] <= "9") j++;
          return j > i + prefix.length ? obs.slice(i, j) : "";
        };
        const mine = (rec || [])
          .map((r) => ({ r, op: opOf(r.observaciones) }))
          .filter((x) => x.op)
          .map((x) => ({ codpago: String(x.r.codpago || "").trim().toUpperCase(), importe: Number(x.r.importe) || 0, entregado: Number(x.r.importe) || 0, opCode: x.op }));
        if (mine.length) resumed = mine;
      }

      // 2) cobro del resto (o confirmación si ya está pagado)
      let payResult = null;
      if (resumed) {
        toast("Se continúa una recogida anterior que se quedó a medias.", "info", "Encargos");
      } else if (pending > 0) {
        payResult = await payRestWithModal(pending);
        payModalShown = true;
        if (!payResult) {
          await unlock();
          return;
        }
      } else {
        const ok = await confirmModal(
          "Entregar encargo",
          `<div class="enc-cancel-text"><p>El encargo de <strong>${escapeHtml(order.customerName)}</strong> ya está <strong>pagado por completo</strong> (${escapeHtml(fmtMoney(order.total))}).</p><p>Se emitirá la factura y se descontará el stock.</p></div>`,
          { isHtml: true, okButtonText: "Entregar" },
        );
        if (!ok) {
          await unlock();
          return;
        }
      }
      const pagos = resumed || (payResult?.pagos || []).filter((p) => Number(p.importe) > 0);

      // 3) stock (como al cobrar)
      const problems = await stockProblemsForOrder(order);
      if (problems) {
        const rows = problems
          .map((w, i) => `<div class="stock-warning-item"><div class="stock-warning-name">${i + 1}. ${escapeHtml(w.productName)}</div><div class="stock-warning-row">Cantidad: <strong>${escapeHtml(fmtQty(w.qtyToSell))}</strong> · Stock actual: <strong>${escapeHtml(formatProductStock(w.visibleStock))}</strong></div></div>`)
          .join("");
        const proceed = await confirmModal(
          "Sin stock suficiente",
          `<div class="stock-warning-wrap"><div class="stock-warning-intro">No hay stock suficiente de estos productos (no tienen permitida la venta sin stock en FacturaScripts):</div><div class="stock-warning-list">${rows}</div><div class="stock-warning-outro">¿Entregar el encargo igualmente? El stock quedará en negativo y habrá que dar entrada de mercancía.</div></div>`,
          { isHtml: true, textClassName: "stock-warning-content", dialogClassName: "stock-warning-dialog", okButtonText: "Entregar sin stock" },
        );
        if (!proceed) {
          hidePostPayQuietly();
          await unlock();
          return;
        }
        stockOverrideIds = problems.map((w) => w.baseProductId);
        await Promise.all(stockOverrideIds.map((id) => setProductVentasInStock(id, true)));
      }

      // 4) factura desde el pedido
      const factura = await ensureFsFacturaFromPedido(order);

      // 5) datos del TPV + recibos + emitir
      const today = dateKey(new Date());
      const restoRows = pagos.map((p, i) => ({
        codpago: String(p.codpago || "").trim().toUpperCase(),
        amount: round2(p.importe),
        opCode: p.opCode || `${order.orderCode}-R${i + 1}`,
        label: "resto",
        fechapago: today,
        entregado: round2(p.entregado ?? p.importe),
      }));
      // Ajuste de céntimos: lo cobrado a cuenta + lo cobrado ahora tiene que ser el total de la factura.
      const advanceRows = (order.moves || [])
        .filter((m) => m.kind === "anticipo")
        .map((m) => ({ codpago: m.codpago, amount: round2(m.amount), opCode: m.opCode, label: `anticipo cobrado el ${dateKey(new Date(m.createdAtMs))}`, fechapago: dateKey(new Date(m.createdAtMs)) }));
      const sumRest = restoRows.reduce((s, r) => s + r.amount, 0);
      const diff = round2(order.total - order.collected - sumRest);
      if (restoRows.length && Math.abs(diff) >= 0.01) restoRows[restoRows.length - 1].amount = round2(restoRows[restoRows.length - 1].amount + diff);

      const cashGiven = pagos.filter((p) => isCashCode(p.codpago)).reduce((s, p) => s + (Number(p.entregado) || 0), 0);
      // En una recogida retomada el cambio ya está guardado en la propia factura.
      const cambio = resumed ? Number(existingFactura?.tpv_cambio) || 0 : Number(payResult?.cambio || 0);
      const primary = restoRows[0]?.codpago || advanceRows[0]?.codpago || String(factura.codpago || "");
      if (Number(factura.idestado) !== 11) {
        const upd = {
          idestado: 11,
          pagada: 1,
          tpv_venta: 1,
          tpv_efectivo: Number(cashGiven.toFixed(2)),
          tpv_cambio: Number(cambio.toFixed(2)),
          codpago: primary,
          idtpv: Number(currentTerminal.id) || "",
          idcaja: Number(getCajaIdSafe() || 0) || "",
          nick: String(currentAgent?.nick || currentAgent?.nombre || getLoginUser?.() || "Ventas"),
        };
        if (currentAgent?.codagente) upd.codagente = String(currentAgent.codagente);
        await apiWrite(`facturaclientes/${encodeURIComponent(factura.idfactura)}`, "PUT", upd, { timeoutMs: 60000 });
      }
      await syncEncargoRecibos(factura, order, [...advanceRows, ...restoRows]);

      // 6) servidor: resto + anticipos aplicados + recogido
      const fresh2 = await apiRead(`facturaclientes/${encodeURIComponent(factura.idfactura)}`).catch(() => null);
      const fData = fresh2?.data || fresh2 || factura;
      const body = {
        orderId: order.id,
        expectedVersion: order.version,
        payments: restoRows.map((r) => ({ opCode: r.opCode, amount: r.amount, codpago: r.codpago, cajaId: String(getCajaIdSafe() || ""), idtpv: String(currentTerminal.id), agentName: wizAgentName() })),
        fsIdfactura: String(factura.idfactura),
        fsFacturaCodigo: String(fData.codigo || factura.codigo || ""),
        cajaId: String(getCajaIdSafe() || ""),
        userName: wizAgentName(),
        terminalId: String(currentTerminal.id),
        sessionId: sessionId(),
      };
      let r;
      try {
        r = await postWithRetry("complete-customer-order-pickup", body);
      } catch {
        throw new Error(`La factura ${fData.codigo || factura.codigo} ya está creada, pero no hay conexión para anotarla en el encargo.`);
      }
      if (r.status === 412) throw new Error("Mientras cobrabas, otro terminal modificó el encargo. Revisa el encargo y vuelve a pulsar «Recoger y cobrar».");
      if (!r.ok) throw new Error(r.json?.error || `El servidor no aceptó la recogida (HTTP ${r.status}).`);
      released = true; // el servidor ya liberó el candado al completar
      const done = r.json.data;

      // Ticket / ventana final (la misma de después de cobrar una venta)
      const ticket = {
        numero: String(fData.codigo || factura.codigo || ""),
        paymentMethod: restoRows.length === 1 ? restoRows[0].codpago : "Mixto",
        fecha: fData.fecha || "",
        hora: fData.hora || "",
        total: Number(fData.total ?? order.total),
        terminalName: String(currentTerminal?.name || ""),
        agentName: String(currentAgent?.name || ""),
        codcliente: String(fData.codcliente || order.codcliente || "1"),
        clientName: order.customerName,
        clientFiscalId: "",
        clientAddress: "",
        isDefaultCustomer: false,
        company: typeof companyInfo !== "undefined" && companyInfo ? { ...companyInfo } : null,
        lineas: [],
        codserie: fData.codserie || "",
        numero2: fData.numero2 || order.orderCode,
        idfactura: factura.idfactura,
        pagos: [...advanceRows, ...restoRows].map((p) => ({ codpago: p.codpago, importe: p.amount, entregado: p.entregado ?? p.amount })),
      };
      try {
        ticket.cashMeta = buildCashTicketMeta({ pagos: restoRows.map((p) => ({ codpago: p.codpago, importe: p.amount, entregado: p.entregado })), total: pending, cambio });
      } catch {}
      lastTicket = ticket;
      window.__POSTPAY_PENDING__ = null;
      try {
        openPostPayModal({ docCode: ticket.numero, total: pending, cambio });
        updatePostPayModal({ docCode: ticket.numero, total: pending, cambio, enablePrint: true });
      } catch {}
      if (isAutoPrintEnabled()) printTicket(ticket).catch(() => {});

      detail.order = done;
      await renderDetail();
      toast(`Encargo entregado ✓ · Factura ${ticket.numero}`, "ok", "Encargos");
      refreshCount().catch(() => {});
      if (list.open) loadList().catch(() => {});
    } catch (e) {
      console.warn("[ENCARGOS] recoger:", e?.message || e);
      if (payModalShown) hidePostPayQuietly();
      showMessageModal(
        "No se pudo completar la recogida",
        `${String(e?.message || e)}\n\nPuedes volver a pulsar «Recoger y cobrar»: continúa donde se quedó, sin duplicar la factura ni los cobros.`,
      );
      await unlock();
    } finally {
      if (stockOverrideIds.length) await Promise.all(stockOverrideIds.map((id) => setProductVentasInStock(id, false)));
    }
  }

  // ------------------------------------------------------------------ cerrar sin recoger

  // Decisión del jefe: si el cliente no recoge y no pide la devolución, el encargo se factura como una venta con
  // descuento por el restante: UNA factura con las líneas del encargo y un descuento tal que el total sea exactamente
  // lo cobrado a cuenta (150 € con 50 € de anticipo -> factura de 50 €). Es una acción manual y descuenta stock.

  // Total que calcularía FacturaScripts para unas líneas con un descuento (%) por línea: acumula neto e IVA SIN
  // redondear cada línea y redondea al final el neto y el IVA por separado (ver computeLineNetFirst en renderer.js).
  function fsTotalWithDiscounts(lines, pcts) {
    let net = 0;
    let iva = 0;
    lines.forEach((l, i) => {
      const n = l.pvp * l.qty * (1 - (pcts[i] || 0) / 100);
      net += n;
      iva += (n * l.rate) / 100;
    });
    return round2(round2(net) + round2(iva));
  }

  // Descuentos por línea para que el total sea EXACTAMENTE `target`. El total de FacturaScripts baja a saltos de 1 o 2
  // céntimos al subir el descuento, así que se busca el TRAMO de descuento donde da justo `target` y se toma su punto
  // medio (en los extremos, redondear el % a 8 decimales podría salirse del tramo). Primero un % común a todas las
  // líneas; si ese tramo no existe, se afina el descuento de la línea de mayor importe.
  function solveDiscounts(lines, target) {
    const T = round2(target);
    const total0 = fsTotalWithDiscounts(lines, lines.map(() => 0));
    if (total0 === T) return lines.map(() => 0);
    if (T > total0 || T < 0) return null;
    const fix = (p) => Number(Number(p).toFixed(8));
    const midOfTramo = (fn) => {
      let lo = 0;
      let hi = 100;
      for (let k = 0; k < 90; k++) {
        const m = (lo + hi) / 2;
        if (fn(m) >= T) lo = m;
        else hi = m;
      }
      const pHi = lo; // mayor descuento con total >= T
      lo = 0;
      hi = 100;
      for (let k = 0; k < 90; k++) {
        const m = (lo + hi) / 2;
        if (fn(m) <= T) hi = m;
        else lo = m;
      }
      const pLo = hi; // menor descuento con total <= T
      return pLo <= pHi ? (pLo + pHi) / 2 : null;
    };
    // 1) % común
    const common = midOfTramo((p) => fsTotalWithDiscounts(lines, lines.map(() => fix(p))));
    if (common !== null) {
      const out = lines.map(() => fix(common));
      if (fsTotalWithDiscounts(lines, out) === T) return out;
    }
    // 2) % común aproximado + afinar la línea de mayor importe
    let big = 0;
    lines.forEach((l, i) => {
      if (l.pvp * l.qty > lines[big].pvp * lines[big].qty) big = i;
    });
    let base = 0;
    {
      let lo = 0;
      let hi = 100;
      for (let k = 0; k < 90; k++) {
        const m = (lo + hi) / 2;
        if (fsTotalWithDiscounts(lines, lines.map(() => fix(m))) >= T) lo = m;
        else hi = m;
      }
      base = lo;
    }
    const tuned = midOfTramo((p) => {
      const test = lines.map(() => fix(base));
      test[big] = fix(p);
      return fsTotalWithDiscounts(lines, test);
    });
    if (tuned !== null) {
      const out = lines.map(() => fix(base));
      out[big] = fix(tuned);
      if (fsTotalWithDiscounts(lines, out) === T) return out;
    }
    return null;
  }

  async function fetchPedidoLines(idpedido) {
    const rows = await apiRead(`lineapedidoclientes?filter[idpedido]=${encodeURIComponent(idpedido)}&limit=500&sort[orden]=ASC`);
    return Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : [];
  }

  async function createFsFacturaDiscounted({ order, fsLines, nick }) {
    const cfg = window.RECIPOK_API || {};
    const base = String(cfg.baseUrl || "").replace(/\/+$/, "");
    const body = new URLSearchParams();
    body.append("codcliente", String(order.codcliente || "1"));
    body.append("lineas", JSON.stringify(fsLines));
    body.append("idtpv", String(currentTerminal.id));
    body.append("idcaja", String(getCajaIdSafe() || ""));
    if (currentTerminal?.codalmacen) body.append("codalmacen", String(currentTerminal.codalmacen));
    body.append("tpv_venta", "1");
    if (currentAgent?.codagente) body.append("codagente", String(currentAgent.codagente));
    body.append("nick", nick);
    body.append("numero2", order.orderCode);
    body.append("codserie", "S");
    body.append("observaciones", `ENCARGO ${order.orderCode} · ${order.customerName}\nNo recogido: facturado lo anticipado (${fmtMoney(order.collected)} de ${fmtMoney(order.total)}).`);
    const res = await fetch(`${base}/crearFacturaCliente`, {
      method: "POST",
      headers: { Accept: "application/json", Token: cfg.apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.status === "error") throw new Error(data?.message || `FacturaScripts no creó la factura (HTTP ${res.status}).`);
    return data?.doc || data?.data || data;
  }

  async function closeUnclaimedFlow() {
    const o0 = detail.order;
    if (!o0 || o0.status !== "pendiente") return;
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) return toast("Encargos necesita conexión con el servidor.", "warn", "Encargos");
    if (!cashSession?.open) return toast("Abre la caja para poder facturar.", "warn", "Encargos");
    if (!currentTerminal?.id) return toast("Selecciona un terminal para facturar.", "warn", "Encargos");
    if (!(await requireAssignedAgentOrBlock({ showModal: true }))) return;

    let lockR;
    try {
      lockR = await call("lock-customer-order-pickup", { method: "POST", body: { orderId: o0.id, sessionId: sessionId(), ttlMs: 600000 } });
    } catch {
      return toast("Sin conexión con el servidor.", "warn", "Encargos");
    }
    if (lockR.status === 423) return showMessageModal("Se está atendiendo en otro dispositivo", "Este encargo se está recogiendo o editando en otro terminal. Espera unos segundos y vuelve a intentarlo.");
    if (!lockR.ok || !lockR.json?.data) return showMessageModal("No se pudo cerrar", lockR.json?.error || `El servidor no aceptó la operación (HTTP ${lockR.status}).`);

    let released = false;
    const unlock = async () => {
      if (released) return;
      released = true;
      try {
        await call("unlock-customer-order-pickup", { method: "POST", body: { orderId: o0.id, sessionId: sessionId() } });
      } catch {}
    };
    try {
      const order = lockR.json.data;
      if (order.status !== "pendiente") {
        detail.order = order;
        await renderDetail();
        await unlock();
        return toast("Este encargo ya no está pendiente.", "info", "Encargos");
      }
      if (!(order.collected > 0)) {
        await unlock();
        return showMessageModal("No hay nada que facturar", "Este encargo no tiene ningún anticipo cobrado. Si el cliente no va a recoger, cancélalo.");
      }
      const pct = order.total > 0 ? Math.round((1 - order.collected / order.total) * 10000) / 100 : 0;
      const ok = await confirmModal(
        "Cerrar sin recoger",
        `<div class="enc-cancel-text"><p>El encargo de <strong>${escapeHtml(order.customerName)}</strong> no se va a recoger y no se devuelve nada.</p>` +
          `<p>Se emitirá <strong>una factura por ${escapeHtml(fmtMoney(order.collected))}</strong> (lo cobrado a cuenta), con las líneas del encargo (${escapeHtml(fmtMoney(order.total))}) y un descuento de aproximadamente el <strong>${pct.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %</strong> por el resto (repartido en las líneas para que el total salga exacto).</p>` +
          `<p class="enc-small">Se descuenta el stock de los productos, igual que en una venta. El encargo pasa a «Cerrado sin recoger».</p></div>`,
        { isHtml: true, okButtonText: "Cerrar sin recoger" },
      );
      if (!ok) {
        await unlock();
        return;
      }

      // Si un intento anterior se cortó a medias, la factura ya existe: se continúa con ella.
      let factura = await findFsFacturaByNumero2(order.orderCode).catch(() => null);
      let roundingDiff = 0;
      const nick = String(currentAgent?.nick || currentAgent?.nombre || getLoginUser?.() || "Ventas");
      if (!factura) {
        const pedLines = await fetchPedidoLines(order.fsIdpedido);
        if (!pedLines.length) throw new Error("No se encontraron las líneas del pedido en FacturaScripts.");
        const calc = pedLines.map((l) => ({ pvp: Number(l.pvpunitario) || 0, qty: Number(l.cantidad) || 0, rate: Number(l.iva) || 0 }));
        // Casi siempre se llega al céntimo exacto. Con alguna línea suelta FacturaScripts se salta justo ese importe
        // (sube de 1 en 1 o de 2 en 2 céntimos): entonces se acepta el más cercano, a menos de 2 céntimos, y queda anotado.
        let pcts = null;
        for (const d of [0, 0.01, -0.01, 0.02, -0.02]) {
          pcts = solveDiscounts(calc, round2(order.collected + d));
          if (pcts) {
            roundingDiff = d;
            break;
          }
        }
        if (!pcts) throw new Error("No se pudo calcular un descuento que deje la factura en lo anticipado.");
        const fsLines = pedLines.map((l, i) => {
          const out = {
            descripcion: l.descripcion,
            cantidad: Number(l.cantidad) || 0,
            pvpunitario: Number(l.pvpunitario) || 0,
            dtopor: pcts[i],
          };
          if (l.referencia) out.referencia = l.referencia;
          if (l.idproducto) out.idproducto = Number(l.idproducto);
          if (l.codimpuesto) out.codimpuesto = l.codimpuesto;
          return out;
        });
        const created = await createFsFacturaDiscounted({ order, fsLines, nick });
        factura = created?.idfactura ? created : await findFsFacturaByNumero2(order.orderCode);
        if (!factura) throw new Error("FacturaScripts no devolvió la factura creada.");
      }
      const fsTotal = round2(Number(factura.total));
      // (en una factura retomada la diferencia ya está en su total)
      roundingDiff = round2(fsTotal - order.collected);
      if (Math.abs(roundingDiff) > 0.021) {
        throw new Error(`La factura ${factura.codigo || factura.idfactura} sale por ${fmtMoney(fsTotal)} y debería ser ${fmtMoney(order.collected)}. Revísala en FacturaScripts antes de seguir.`);
      }

      const advanceRows = (order.moves || [])
        .filter((m) => m.kind === "anticipo")
        .map((m) => ({ codpago: m.codpago, amount: round2(m.amount), opCode: m.opCode, label: `anticipo cobrado el ${dateKey(new Date(m.createdAtMs))}`, fechapago: dateKey(new Date(m.createdAtMs)) }));
      // Con una diferencia de céntimos, el último recibo se ajusta para que la factura quede pagada exactamente.
      if (advanceRows.length && Math.abs(roundingDiff) >= 0.005) {
        advanceRows[advanceRows.length - 1].amount = round2(advanceRows[advanceRows.length - 1].amount + roundingDiff);
        advanceRows[advanceRows.length - 1].label += ` (ajuste de redondeo ${roundingDiff > 0 ? "+" : ""}${roundingDiff.toFixed(2)})`;
      }
      if (Number(factura.idestado) !== 11) {
        const upd = { idestado: 11, pagada: 1, tpv_venta: 1, tpv_efectivo: 0, tpv_cambio: 0, codpago: advanceRows[0]?.codpago || factura.codpago, idtpv: Number(currentTerminal.id), idcaja: Number(getCajaIdSafe() || 0) || "", nick };
        if (currentAgent?.codagente) upd.codagente = String(currentAgent.codagente);
        await apiWrite(`facturaclientes/${encodeURIComponent(factura.idfactura)}`, "PUT", upd, { timeoutMs: 60000 });
      }
      await syncEncargoRecibos(factura, order, advanceRows);

      let r;
      try {
        r = await postWithRetry("close-customer-order-unclaimed", {
          orderId: order.id,
          expectedVersion: order.version,
          invoiceTotal: fsTotal,
          fsIdfactura: String(factura.idfactura),
          fsFacturaCodigo: String(factura.codigo || ""),
          cajaId: String(getCajaIdSafe() || ""),
          userName: wizAgentName(),
          terminalId: String(currentTerminal.id),
          sessionId: sessionId(),
        });
      } catch {
        throw new Error(`La factura ${factura.codigo} ya está creada, pero no hay conexión para anotarla en el encargo.`);
      }
      if (r.status === 412) throw new Error("Mientras tanto otro terminal modificó el encargo. Revísalo y vuelve a intentarlo.");
      if (!r.ok) throw new Error(r.json?.error || `El servidor no aceptó el cierre (HTTP ${r.status}).`);
      released = true;

      // El pedido ya no hace falta: se cancela para liberar la reserva de stock (la factura ya descuenta lo vendido).
      cancelFsPedidoQuietly(order.fsIdpedido);
      detail.order = r.json.data;
      await renderDetail();
      toast(`Encargo cerrado sin recoger ✓ · Factura ${factura.codigo}`, "ok", "Encargos");
      refreshCount().catch(() => {});
      if (list.open) loadList().catch(() => {});
    } catch (e) {
      console.warn("[ENCARGOS] cerrar sin recoger:", e?.message || e);
      showMessageModal("No se pudo cerrar el encargo", `${String(e?.message || e)}\n\nPuedes volver a pulsar «Cerrar sin recoger»: continúa donde se quedó, sin duplicar la factura.`);
      await unlock();
    }
  }

  // ------------------------------------------------------------------ cierre de caja

  // El cierre de caja se calcula con las facturas y recibos REALES de la caja (renderer.js, runCashCloseSummaryComputation).
  // Las facturas de un encargo llevan recibos de anticipos cobrados otros días (o hoy, ya contados aparte): si entraran en
  // «Ventas» se contaría dos veces el dinero. Por eso el cierre saca esas facturas de las ventas y suma el dinero de los
  // encargos desde nuestro servidor: anticipos, restos cobrados al recoger y devoluciones, de ESTA caja.
  //
  // El dinero NUNCA se oculta: si hay movimientos de encargos en la caja se muestran aunque la opción esté apagada en
  // este terminal (otro terminal puede haber cobrado un anticipo).

  const cashKinds = ["anticipo", "resto", "devolucion"];

  function isEncargoInvoice(f, invoiceIds) {
    const id = String(f?.idfactura ?? "").trim();
    if (id && invoiceIds && invoiceIds.has(id)) return true;
    // Respaldo si el servidor aún no ha anotado el cierre (se cortó a medias): el número2 lleva el código del encargo.
    return /^ENC-/.test(String(f?.numero2 || "").trim());
  }

  async function getCashSummaryForClose(cajaId) {
    if (!cajaId || state.serverAvailable === false) return null;
    let r;
    try {
      r = await call("customer-orders-cash-summary", { query: { cajaId: String(cajaId) }, timeoutMs: 12000 });
    } catch {
      return null;
    }
    if (!r.ok || !r.json?.data) return null;
    const s = r.json.data;
    const out = {
      cajaId: String(cajaId),
      invoiceIds: (s.invoiceIds || []).map((x) => String(x)),
      byKind: {},
      methodsNet: {},
      completed: s.completed || {},
      pending: s.pending || { count: 0, collected: 0 },
      cashNet: 0,
      totalNet: 0,
      hasMoney: false,
    };
    cashKinds.forEach((k) => (out.byKind[k] = { count: 0, total: 0, cash: 0, methods: {} }));
    (s.moves || []).forEach((m) => {
      const kind = String(m.kind);
      if (!out.byKind[kind]) return;
      const code = normalizePayCode(m.codpago);
      const amount = Number(m.amount) || 0;
      const sign = kind === "devolucion" ? -1 : 1;
      const row = out.byKind[kind];
      row.count += Number(m.count) || 0;
      row.total = round2(row.total + sign * amount);
      row.methods[code] = round2((row.methods[code] || 0) + sign * amount);
      out.methodsNet[code] = round2((out.methodsNet[code] || 0) + sign * amount);
      out.totalNet = round2(out.totalNet + sign * amount);
      if (isCashPago({ codpago: m.codpago })) {
        row.cash = round2(row.cash + sign * amount);
        out.cashNet = round2(out.cashNet + sign * amount);
      }
      out.hasMoney = true;
    });
    const c = out.completed;
    out.completedCount = (Number(c.recogido?.count) || 0) + (Number(c.cerrado_sin_recoger?.count) || 0);
    return out;
  }

  function closeBlockVisible(enc) {
    if (!enc) return false;
    return enc.hasMoney || enc.completedCount > 0 || (isEnabled() && Number(enc.pending?.count) > 0);
  }

  // Filas del bloque (las usan la pantalla de cierre y el informe impreso)
  function closeBlockRows(enc) {
    const labels = window.__PAYMETHOD_LABELS__ || {};
    const lbl = (c) => labels[c] || c;
    const rows = [];
    const k = enc.byKind;
    const nonCash = (kind) => round2(k[kind].total - k[kind].cash);
    rows.push({ label: `Anticipos cobrados hoy (${k.anticipo.count})`, cash: k.anticipo.cash, other: nonCash("anticipo"), total: k.anticipo.total, methods: k.anticipo.methods });
    rows.push({
      label: `Resto cobrado al recoger (${(Number(enc.completed.recogido?.count) || 0)} ${Number(enc.completed.recogido?.count) === 1 ? "encargo recogido" : "encargos recogidos"})`,
      cash: k.resto.cash,
      other: nonCash("resto"),
      total: k.resto.total,
      methods: k.resto.methods,
    });
    if (k.devolucion.count > 0) rows.push({ label: `Anticipos devueltos (${k.devolucion.count})`, cash: k.devolucion.cash, other: nonCash("devolucion"), total: k.devolucion.total, methods: k.devolucion.methods });
    return { rows, lbl };
  }

  function renderCloseBlock() {
    const box = $("encargosCloseBlock");
    const cell = $("sumEncargosItem");
    const enc = typeof cashSession !== "undefined" ? cashSession.encargos : null;
    if (!box) return;
    const visible = closeBlockVisible(enc);
    if (cell) {
      cell.style.display = visible && enc.hasMoney ? "" : "none";
      const v = $("sumEncargosCash");
      if (v && enc) v.textContent = fmtMoney(enc.cashNet);
    }
    if (!visible) {
      box.style.display = "none";
      box.innerHTML = "";
      return;
    }
    const esc = escapeHtml;
    const money = (n) => fmtMoney(n);
    const { rows, lbl } = closeBlockRows(enc);
    const rec = enc.completed.recogido || {};
    const cer = enc.completed.cerrado_sin_recoger || {};
    const sales = Number(cashSession.totalSales || 0);
    const body = rows
      .map(
        (r) =>
          `<tr><td>${esc(r.label)}</td><td class="n">${esc(money(r.cash))}</td><td class="n">${esc(money(r.other))}</td><td class="n">${esc(money(r.total))}</td></tr>`,
      )
      .join("");
    const other = Object.entries(enc.methodsNet)
      .filter(([code]) => !isCashPago({ codpago: code }))
      .filter(([, v]) => Math.abs(v) > 0.004)
      .map(([code, v]) => `${esc(lbl(code))} ${esc(money(v))}`)
      .join(" · ");
    box.style.display = "block";
    box.innerHTML =
      `<div class="enc-close-title">Encargos</div>` +
      `<table class="enc-close-table"><thead><tr><th>Concepto</th><th class="n">Efectivo</th><th class="n">Otras formas</th><th class="n">Total</th></tr></thead><tbody>${body}` +
      `<tr class="tot"><td>Cobrado por encargos hoy</td><td class="n">${esc(money(enc.cashNet))}</td><td class="n">${esc(money(round2(enc.totalNet - enc.cashNet)))}</td><td class="n">${esc(money(enc.totalNet))}</td></tr></tbody></table>` +
      (other ? `<div class="enc-close-note">Otras formas de pago: ${other}</div>` : "") +
      `<div class="enc-close-sub">Para cuadrar con las facturas del día:</div>` +
      `<ul class="enc-close-list">` +
      `<li>Encargos recogidos hoy (facturados hoy): ${Number(rec.count) || 0}, por ${esc(money(Number(rec.invoiced) || 0))}.` +
      (Number(rec.collectedInOtherCajas) > 0 ? ` De ellos, ya cobrado en otros días o cajas (anticipos previos): ${esc(money(Number(rec.collectedInOtherCajas)))}.` : "") +
      `</li>` +
      (Number(cer.count) > 0 ? `<li>Cerrados sin recoger (facturados hoy): ${Number(cer.count)}, por ${esc(money(Number(cer.invoiced) || 0))}.</li>` : "") +
      `</ul>` +
      (Number(enc.pending.count) > 0
        ? `<div class="enc-close-sub">Dinero de encargos aún sin recoger:</div><ul class="enc-close-list"><li>${Number(enc.pending.count)} ${Number(enc.pending.count) === 1 ? "encargo pendiente" : "encargos pendientes"}, con ${esc(money(Number(enc.pending.collected) || 0))} ya cobrados en anticipos.</li></ul>`
        : "") +
      `<div class="enc-close-foot">Solo el efectivo de los encargos (${esc(money(enc.cashNet))}) suma al total esperado en caja.</div>` +
      `<div class="enc-close-grand"><span>TOTAL COBRADO HOY (ventas + encargos)</span><strong>${esc(money(round2(sales + enc.totalNet)))}</strong></div>`;
  }

  // Texto del bloque para el informe impreso (80 mm).
  function buildCloseReportHtml(enc, salesTotal) {
    if (!closeBlockVisible(enc)) return "";
    const esc = escapeHtml;
    const money = (n) => fmtMoney(n);
    const { rows, lbl } = closeBlockRows(enc);
    const rec = enc.completed.recogido || {};
    const cer = enc.completed.cerrado_sin_recoger || {};
    const row = (label, val, cls = "") => `<div class="row small ${cls}"><div class="col-left">${esc(label)}</div><div class="col-right">${esc(val)}</div></div>`;
    let h = `<div class="sep"></div><div class="section-title center">ENCARGOS</div>`;
    rows.forEach((r) => {
      h += row(r.label, money(r.total), "bold");
      Object.entries(r.methods)
        .filter(([, v]) => Math.abs(v) > 0.004)
        .forEach(([code, v]) => (h += row(`   ${lbl(code)}`, money(v))));
    });
    h += `<div class="sep"></div>` + row("COBRADO POR ENCARGOS", money(enc.totalNet), "bold");
    Object.entries(enc.methodsNet)
      .filter(([, v]) => Math.abs(v) > 0.004)
      .forEach(([code, v]) => (h += row(`   ${lbl(code)}`, money(v))));
    h += `<div class="small bold" style="margin-top:6px">Para cuadrar con las facturas:</div>`;
    h += row(`Encargos recogidos hoy (${Number(rec.count) || 0})`, money(Number(rec.invoiced) || 0));
    if (Number(rec.collectedInOtherCajas) > 0) h += row("  ya cobrado otros días", money(Number(rec.collectedInOtherCajas)));
    if (Number(cer.count) > 0) h += row(`Cerrados sin recoger (${Number(cer.count)})`, money(Number(cer.invoiced) || 0));
    if (Number(enc.pending.count) > 0) {
      h += `<div class="small bold" style="margin-top:6px">Pendientes de recoger:</div>`;
      h += row(`${Number(enc.pending.count)} encargos, anticipos cobrados`, money(Number(enc.pending.collected) || 0));
    }
    h += `<div class="sep"></div>` + row("TOTAL COBRADO HOY", money(round2(Number(salesTotal || 0) + enc.totalNet)), "bold");
    h += `<div class="small">(ventas + encargos)</div>`;
    return h;
  }

  // ------------------------------------------------------------------ editar un encargo

  // FacturaScripts no recalcula el total de un pedido si se editan sus líneas por la API, así que EDITAR = crear un pedido
  // NUEVO con las líneas nuevas y cancelar el anterior (cada intento lleva su propio numero2, para no duplicar al
  // reintentar). Los anticipos cuelgan de nuestro encargo, no del pedido, y no se mueven. Reglas del jefe: lo ya cobrado
  // a cuenta no se toca (el total nuevo no puede ser menor) y no se devuelve dinero al editar.
  // El encargo se edita en el carrito de siempre, con una franja «Editando…»; hasta guardar no se cambia nada en el
  // servidor, así que si se cierra el programa a mitad no se pierde ni se estropea nada.

  const EDIT_CFG_KEY = "ui.encargosEditing";

  function isEditing() {
    return !!edit.active;
  }

  // En la vista de Mesas el carrito es el del pedido de la mesa (se recarga solo al llegar cambios de otros terminales y
  // se guarda como aparcado de la mesa): no sirve para editar un encargo. Se edita en el TPV normal.
  function inMesasView() {
    return typeof MESAS_INLINE_ACTIVE !== "undefined" && !!MESAS_INLINE_ACTIVE;
  }
  const MESAS_EDIT_MSG = "Sal del Modo Mesas (✕ arriba a la derecha) y vuelve a pulsar «Editar encargo»: los encargos se editan en el TPV normal.";

  // Cliente de la factura del encargo = el cliente seleccionado en el carrito (asi se crea). Al editar, el carrito debe
  // llevar ESE cliente (si no, los precios de su tarifa y el cliente del pedido nuevo saldrian del que hubiera puesto
  // antes) y se puede cambiar desde el propio carrito: el pedido nuevo y, al recoger, la factura salen a nombre del elegido.
  // Nombre y telefono por defecto de un encargo = los del cliente seleccionado en el carrito (si no es el cliente por defecto).
  function customerContact(cod) {
    const c = String(cod || "").trim();
    if (!c || c === String(currentTerminal?.codcliente || "1")) return { name: "", phone: "" };
    const found = (window.CUSTOMER_SELECTOR?.listCustomers?.() || []).find((x) => String(x.codcliente) === c);
    if (!found) return { name: "", phone: "" };
    return {
      name: String(found.nombre || "").trim(),
      phone: String(found.telefono1 || found.telefono2 || found.movil || "").trim(),
    };
  }

  function customerNameForCod(cod) {
    const c = String(cod || "").trim();
    if (!c) return "";
    const list = window.CUSTOMER_SELECTOR?.listCustomers?.() || [];
    const found = list.find((x) => String(x.codcliente) === c);
    return found ? String(found.nombre || "").trim() : "";
  }

  function selectCustomerForEdit(cod) {
    const CS = window.CUSTOMER_SELECTOR;
    const c = String(cod || "").trim();
    if (!CS || !c) return;
    try {
      if (String(CS.getSelectedCustomerCodcliente?.() || "") === c) return;
      const list = CS.listCustomers?.() || [];
      const found = list.find((x) => String(x.codcliente) === c);
      if (found) CS.setSelected(found);
      else if (c === String(currentTerminal?.codcliente || "1")) CS.resetToDefault();
      else CS.setSelected({ codcliente: c, nombre: "" });
    } catch (e) {
      console.warn("[ENCARGOS] no se pudo poner el cliente del encargo en el carrito:", e?.message || e);
    }
  }

  function buildCartFromOrder(order) {
    const out = [];
    for (const l of Array.isArray(order.lines) ? order.lines : []) {
      if (l.cartLine && typeof l.cartLine === "object") {
        const item = cleanCartLine(l.cartLine);
        if (!item) throw new Error(`No se pudo recuperar la línea «${l.name}».`);
        item._lineId = makeLineId();
        out.push(item);
        (Array.isArray(l.cartChildren) ? l.cartChildren : []).forEach((c) => {
          const child = cleanCartLine(c);
          if (!child) return;
          child._lineId = makeLineId();
          if (child.meta && child.meta.parentPackLineId) child.meta.parentPackLineId = item._lineId;
          out.push(child);
        });
        continue;
      }
      // Encargo sin copia de la línea: se reconstruye desde el catálogo con el precio guardado.
      const product = (Array.isArray(products) ? products : []).find((p) => getProductBaseId(p) === Number(l.idproducto));
      if (!product) throw new Error(`No se encuentra el producto «${l.name}» en el catálogo.`);
      const item = buildCartLine(product, Number(l.qty) || 1);
      if (Math.abs((Number(l.unit) || 0) - item.grossPrice) > 0.005) item.grossPriceOverride = Number(l.unit);
      out.push(item);
    }
    if (!out.length) throw new Error("El encargo no tiene líneas.");
    return out;
  }

  async function persistEdit() {
    await cfgSet(
      EDIT_CFG_KEY,
      edit.active
        ? {
            orderId: edit.orderId, orderCode: edit.orderCode, version: edit.version, codcliente: edit.codcliente,
            customerName: edit.customerName, customerPhone: edit.customerPhone, notes: edit.notes, pickupAt: edit.pickupAt,
            fsIdpedido: edit.fsIdpedido, collected: edit.collected, total: edit.total, label: edit.label,
          }
        : "",
    );
  }

  function applyEditUI() {
    const on = isEditing();
    document.body.classList.toggle("encargo-editing", on);
    const banner = $("encargoEditBanner");
    if (banner) banner.classList.toggle("hidden", !on);
    if (on) {
      $("encEditBannerTitle").textContent = `Editando el encargo de ${edit.customerName}`;
      $("encEditBannerSub").textContent = `${edit.orderCode} · antes ${fmtMoney(edit.total)} · ya cobrado ${fmtMoney(edit.collected)}`;
    }
    refreshPassButton();
  }

  async function startEdit() {
    const o0 = detail.order;
    if (!o0 || o0.status !== "pendiente") return;
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) return toast("Encargos necesita conexión con el servidor.", "warn", "Encargos");
    if (!cashSession?.open) return toast("Abre la caja para poder editar un encargo.", "warn", "Encargos");
    if (edit.active) return toast("Ya estás editando un encargo: guarda o descarta los cambios.", "info", "Encargos");
    if (inMesasView()) return showMessageModal("Editar encargo", MESAS_EDIT_MSG);
    if (hasVisibleCartLines()) {
      return showMessageModal(
        "Hay productos en el carrito",
        "Para editar un encargo se usa el carrito: termina, cobra o aparca antes la venta que tienes a medias y vuelve a pulsar «Editar encargo».",
      );
    }
    if (currentParkedTicketIndex != null) return toast("Suelta antes el pedido aparcado que tienes cargado.", "warn", "Encargos");

    let fresh;
    try {
      const r = await call("get-customer-order", { query: { orderId: String(o0.id) } });
      if (!r.ok) throw new Error();
      fresh = r.json.data;
    } catch {
      return toast("No se pudo cargar el encargo. Inténtalo de nuevo.", "warn", "Encargos");
    }
    detail.order = fresh;
    if (fresh.status !== "pendiente") {
      await renderDetail();
      return toast("Este encargo ya no está pendiente.", "info", "Encargos");
    }
    if (fresh.lockSession && fresh.lockSession !== sessionId()) {
      return showMessageModal("Se está atendiendo en otro dispositivo", "Este encargo se está recogiendo en otro terminal. Espera unos segundos y vuelve a intentarlo.");
    }
    let built;
    try {
      built = buildCartFromOrder(fresh);
    } catch (e) {
      return showMessageModal("No se puede editar este encargo", String(e?.message || e));
    }

    pushCartHistoryStep("encargo-edit-load");
    cart = built;
    setCurrentParkedTicketIndex(null);
    selectCustomerForEdit(fresh.codcliente);
    renderCart();
    Object.assign(edit, {
      active: true,
      pendingRestore: null,
      orderId: fresh.id,
      orderCode: fresh.orderCode,
      version: fresh.version,
      codcliente: fresh.codcliente,
      customerName: fresh.customerName,
      customerPhone: fresh.customerPhone,
      notes: fresh.notes,
      pickupAt: fresh.pickupAt,
      fsIdpedido: fresh.fsIdpedido,
      collected: fresh.collected,
      total: fresh.total,
      label: "",
    });
    await persistEdit();
    closeDetail();
    closeList();
    applyEditUI();
    toast("Cambia los productos en el carrito y pulsa «Guardar cambios». Hasta entonces no se cambia nada.", "info", "Editando encargo");
  }

  // Editar solo los datos de un encargo (nombre, teléfono, nota, día y hora) sin tocar el carrito ni el dinero:
  // el servidor sube la versión y el texto del pedido de FacturaScripts se actualiza solo.
  async function openDataEditor() {
    const o0 = detail.order;
    if (!o0 || o0.status !== "pendiente") return;
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) return toast("Encargos necesita conexión con el servidor.", "warn", "Encargos");
    let fresh;
    try {
      const r = await call("get-customer-order", { query: { orderId: String(o0.id) } });
      if (!r.ok) throw new Error();
      fresh = r.json.data;
    } catch {
      return toast("No se pudo abrir el encargo. Inténtalo de nuevo.", "warn", "Encargos");
    }
    if (fresh.status !== "pendiente") {
      detail.order = fresh;
      await renderDetail();
      return toast("Este encargo ya no está pendiente.", "info", "Encargos");
    }
    if (fresh.lockSession && fresh.lockSession !== sessionId()) {
      return showMessageModal("Se está atendiendo en otro dispositivo", "Este encargo se está recogiendo en otro terminal. Espera unos segundos y vuelve a intentarlo.");
    }
    wiz.mode = "data";
    wiz.order = fresh;
    wiz.snapshot = [];
    wiz.total = fresh.total;
    wiz.collected = fresh.collected;
    wiz.codcliente = String(fresh.codcliente || "");
    wiz.customerName = customerNameForCod(fresh.codcliente) || "Cliente por defecto";
    wiz.contact = customerContact(fresh.codcliente);
    wiz.orderCode = "";
    wiz.fsDoc = null;
    wiz.saving = false;
    wiz.savedOk = false;
    wiz.serverError = "";
    wiz.page = 1;
    const [d, t] = String(fresh.pickupAt || "").split(" ");
    if (d === dateKey(new Date())) wiz.day = "today";
    else if (d === dateKey(addDays(new Date(), 1))) wiz.day = "tomorrow";
    else {
      wiz.day = "custom";
      wiz.customDay = d;
    }
    wiz.time = t || "12:00";
    $("encName").value = fresh.customerName || "";
    $("encPhone").value = fresh.customerPhone || "";
    $("encNotes").value = fresh.notes || "";
    $("encDayInput").value = wiz.day === "custom" ? d : "";
    $("encDayInput").classList.toggle("hidden", wiz.day !== "custom");
    $("encSumDetail").classList.add("hidden");
    showWizError("");
    closeDetail();
    closeList();
    wiz.open = true;
    $("encargoWizardOverlay").classList.remove("hidden");
    lockAppUI();
    renderWizard();
  }

  async function saveDataEdit() {
    if (wiz.saving || !wiz.order) return;
    const err1 = validatePage1();
    if (err1) return showWizError(err1);
    const name = $("encName").value.trim();
    const phone = $("encPhone").value.trim();
    const notes = $("encNotes").value.trim();
    const pickupAt = `${wizDayKey()} ${wiz.time}`;
    wiz.saving = true;
    setWizBusy(true);
    showWizError("");
    try {
      let r;
      try {
        r = await postWithRetry("update-customer-order", {
          orderId: wiz.order.id,
          expectedVersion: wiz.order.version,
          customerName: name,
          customerPhone: phone,
          notes,
          pickupAt,
          userName: wizAgentName(),
          terminalId: String(currentTerminal?.id || ""),
          sessionId: sessionId(),
        });
      } catch {
        throw new Error("No hay conexión con el servidor. No se ha guardado nada: pulsa Guardar cambios otra vez cuando vuelva la conexión.");
      }
      if (r.status === 412) throw new Error("Mientras editabas, otro terminal modificó este encargo (cobró un anticipo, lo editó…). No se ha guardado nada: ciérralo, ábrelo de nuevo y vuelve a editar los datos.");
      if (r.status === 423) throw new Error("Este encargo se está atendiendo en otro dispositivo. Espera unos segundos y vuelve a pulsar Guardar cambios.");
      if (!r.ok) throw new Error(r.json?.error || `El servidor no aceptó los cambios (HTTP ${r.status}).`);
      const order = r.json.data;
      wiz.savedOk = true;
      closeWizard({ keepOrphanCheck: true });
      wiz.mode = "new";
      syncFsObservaciones(order).catch(() => {});
      refreshCount().catch(() => {});
      if (list.open) loadList().catch(() => {});
      const changedWhenOrNote = String(order.pickupAt) !== String(wiz.order.pickupAt) || String(order.notes || "") !== String(wiz.order.notes || "");
      const ctx = { cents: 0, modified: changedWhenOrNote };
      showResult(order, ctx, "Datos modificados ✓");
      if (isAutoPrintEnabled() && changedWhenOrNote) await printReceipt(order, ctx).catch(() => {});
    } catch (e) {
      showWizError(String(e?.message || e));
    } finally {
      wiz.saving = false;
      setWizBusy(false);
    }
  }

  async function discardEdit() {
    if (!edit.active) return;
    const ok = await confirmModal("Descartar los cambios", "Se descartan los cambios del encargo y se vacía el carrito. El encargo queda como estaba.", { okButtonText: "Descartar" });
    if (!ok) return;
    await endEdit();
  }

  async function endEdit() {
    edit.active = false;
    edit.pendingRestore = null;
    try {
      pushCartHistoryStep("clear-cart");
      cart = [];
      setCurrentParkedTicketIndex(null);
      renderCart();
      window.CUSTOMER_SELECTOR?.resetToDefault?.();
    } catch {}
    await persistEdit();
    applyEditUI();
  }

  // Tras reiniciar el programa en mitad de una edición, el carrito se recupera solo: se recupera también la franja.
  function maybeRestoreEdit() {
    const pr = edit.pendingRestore;
    if (!pr || edit.active) return;
    if (hasVisibleCartLines()) {
      Object.assign(edit, pr, { active: true, pendingRestore: null });
      selectCustomerForEdit(edit.codcliente);
      applyEditUI();
    } else if (Date.now() - Number(edit.restoreAt || 0) > 20000) {
      edit.pendingRestore = null;
      cfgSet(EDIT_CFG_KEY, "");
    }
  }

  async function loadEditState() {
    const v = await cfgGet(EDIT_CFG_KEY);
    if (v && typeof v === "object" && v.orderId) {
      edit.pendingRestore = v;
      edit.restoreAt = Date.now();
      maybeRestoreEdit();
      setTimeout(maybeRestoreEdit, 21000);
    }
  }

  async function openEditWizard() {
    if (!edit.active) return;
    if (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline) return toast("Encargos necesita conexión con el servidor.", "warn", "Encargos");
    if (inMesasView()) return showMessageModal("Guardar cambios del encargo", "Estás en el Modo Mesas: aquí el carrito es el de la mesa, no el del encargo. Vuelve al TPV normal (✕ arriba a la derecha) para guardar o descartar los cambios.");
    if (!hasVisibleCartLines()) return showMessageModal("Sin productos", "El encargo no puede quedar sin productos. Añade alguno o descarta los cambios.");
    if (currentParkedTicketIndex != null) return toast("Suelta antes el pedido aparcado que tienes cargado.", "warn", "Encargos");
    if (typeof activeCustomerTariffReadyPromise !== "undefined") await activeCustomerTariffReadyPromise;
    wiz.snapshot = (Array.isArray(cart) ? cart : []).map((l) => ({ ...l }));
    wiz.total = round2(getCartTotal(wiz.snapshot));
    if (!(wiz.total > 0)) return toast("El total del encargo debe ser mayor que cero.", "warn", "Encargos");
    if (wiz.total + 0.0001 < edit.collected) {
      return showMessageModal(
        "No se puede bajar de lo ya cobrado",
        `El nuevo total (${fmtMoney(wiz.total)}) es menor que lo ya cobrado a cuenta (${fmtMoney(edit.collected)}), y lo cobrado a cuenta no se toca. Si el cliente quiere menos, cancela el encargo (con devolución) y crea otro.`,
      );
    }
    wiz.mode = "edit";
    wiz.order = null;
    wiz.collected = edit.collected;
    wiz.codcliente = String(window.CUSTOMER_SELECTOR?.getSelectedCustomerCodcliente?.() || edit.codcliente || "1");
    {
      const nm = customerNameForCod(wiz.codcliente) || (wiz.codcliente === String(currentTerminal?.codcliente || "1") ? "Cliente por defecto" : "Cliente " + wiz.codcliente);
      wiz.customerName = wiz.codcliente === String(edit.codcliente) ? nm : nm + " (cambiado)";
    }
    wiz.orderCode = "";
    wiz.editNumero2 = "";
    wiz.fsDoc = null;
    wiz.saving = false;
    wiz.savedOk = false;
    wiz.serverError = "";
    wiz.page = 1;
    const [d, t] = String(edit.pickupAt || "").split(" ");
    if (d === dateKey(new Date())) wiz.day = "today";
    else if (d === dateKey(addDays(new Date(), 1))) wiz.day = "tomorrow";
    else {
      wiz.day = "custom";
      wiz.customDay = d;
    }
    wiz.time = t || "12:00";
    $("encName").value = edit.customerName;
    $("encPhone").value = edit.customerPhone;
    wiz.contact = customerContact(wiz.codcliente);
    if (wiz.codcliente !== String(edit.codcliente)) {
      // se cambio de cliente: su nombre y telefono pasan al encargo
      const ct = wiz.contact;
      if (ct.name) $("encName").value = ct.name;
      if (ct.phone) $("encPhone").value = ct.phone;
    }
    $("encNotes").value = edit.notes;
    $("encDayInput").value = wiz.day === "custom" ? d : "";
    $("encDayInput").classList.toggle("hidden", wiz.day !== "custom");
    $("encSumDetail").classList.add("hidden");
    showWizError("");
    wiz.open = true;
    $("encargoWizardOverlay").classList.remove("hidden");
    lockAppUI();
    renderWizard();
  }

  async function saveEdit() {
    if (wiz.saving) return;
    const err1 = validatePage1();
    if (err1) return showWizError(err1);
    if (wiz.total + 0.0001 < edit.collected) return showWizError(`No se puede bajar de lo ya cobrado (${fmtMoney(edit.collected)}).`);
    wiz.serverError = "";
    wiz.saving = true;
    setWizBusy(true);
    showWizError("");
    const discardNewPedido = async () => {
      if (wiz.fsDoc) await cancelFsPedidoQuietly(wiz.fsDoc.idpedido);
      wiz.fsDoc = null;
      wiz.editNumero2 = "";
    };
    try {
      const name = $("encName").value.trim();
      const phone = $("encPhone").value.trim();
      const notes = $("encNotes").value.trim();
      const pickupAt = `${wizDayKey()} ${wiz.time}`;
      if (!wiz.editNumero2) wiz.editNumero2 = `${edit.orderCode}.E${Date.now().toString(36).toUpperCase()}`;

      // 1) pedido NUEVO en FacturaScripts (una sola vez por intento aunque se reintente)
      if (!wiz.fsDoc) {
        wiz.fsDoc = await createFsPedido({
          numero2: wiz.editNumero2,
          codcliente: wiz.codcliente,
          codalmacen: String(currentTerminal?.codalmacen || "").trim(),
          observaciones: `ENCARGO ${edit.orderCode} · ${name}${phone ? " · " + phone : ""}\nRecogida: ${pickupLabel(pickupAt)}${notes ? "\nNota: " + notes : ""}\n(encargo editado)`,
          lineas: buildFsLinesFromCart(wiz.snapshot),
          codagente: String(currentAgent?.codagente || "").trim(),
          nick: String(currentAgent?.nick || getLoginUser?.() || "").trim(),
        });
      }
      const fsTotal = Number.isFinite(wiz.fsDoc.total) ? round2(wiz.fsDoc.total) : wiz.total;

      // 2) servidor: versión esperada + pedido nuevo (todo o nada)
      let r;
      try {
        r = await postWithRetry("update-customer-order", {
          orderId: edit.orderId,
          expectedVersion: edit.version,
          customerName: name,
          customerPhone: phone,
          notes,
          pickupAt,
          codcliente: wiz.codcliente,
          total: fsTotal,
          lines: wizLinesForSave(),
          fsIdpedido: wiz.fsDoc.idpedido,
          fsCodigo: wiz.fsDoc.codigo,
          userName: wizAgentName(),
          terminalId: String(currentTerminal?.id || ""),
          sessionId: sessionId(),
        });
      } catch {
        throw new Error("No hay conexión con el servidor. Los cambios no se han guardado: pulsa Guardar cambios otra vez cuando vuelva la conexión (no se duplicará nada).");
      }
      if (r.status === 412) {
        await discardNewPedido();
        throw new Error("Mientras editabas, otro terminal modificó este encargo (cobró un anticipo, lo editó…). Tus cambios NO se han guardado: descarta la edición, revisa el encargo y vuelve a editarlo.");
      }
      if (r.status === 423) {
        await discardNewPedido();
        throw new Error("Este encargo se está atendiendo en otro dispositivo. Espera unos segundos y vuelve a pulsar Guardar cambios.");
      }
      if (!r.ok) {
        await discardNewPedido();
        throw new Error(r.json?.error || `El servidor no aceptó los cambios (HTTP ${r.status}).`);
      }
      const order = r.json.data;
      wiz.savedOk = true;
      onEdited(order, edit.fsIdpedido).catch((e) => console.warn("[ENCARGOS] tras editar:", e?.message || e));
    } catch (e) {
      wiz.serverError = String(e?.message || e);
      showWizError(wiz.serverError);
    } finally {
      wiz.saving = false;
      setWizBusy(false);
    }
  }

  // Después de guardar: el pedido anterior se cancela (libera su reserva), el nuevo recibe el texto con el dinero, se
  // reimprime el resguardo marcado «MODIFICADO» y se vacía el carrito.
  async function onEdited(order, oldIdpedido) {
    closeWizard({ keepOrphanCheck: true });
    edit.active = false;
    await persistEdit();
    try {
      pushCartHistoryStep("clear-cart");
      cart = [];
      setCurrentParkedTicketIndex(null);
      renderCart();
      window.CUSTOMER_SELECTOR?.resetToDefault?.();
    } catch {}
    applyEditUI();
    refreshCount().catch(() => {});
    if (list.open) loadList().catch(() => {});

    // texto del pedido anterior (mientras aún se puede editar) y su cancelación
    if (oldIdpedido && String(oldIdpedido) !== String(order.fsIdpedido)) {
      apiWrite(`pedidoclientes/${encodeURIComponent(oldIdpedido)}`, "PUT", {
        observaciones: `ENCARGO ${order.orderCode} · SUSTITUIDO: el encargo se editó y ahora es el pedido ${order.fsCodigo}.`,
      })
        .catch(() => {})
        .then(() => cancelFsPedidoQuietly(oldIdpedido));
    }
    syncFsObservaciones(order).catch(() => {});

    const ctx = { cents: 0, modified: true };
    showResult(order, ctx, "Encargo modificado ✓");
    if (isAutoPrintEnabled()) await printReceipt(order, ctx).catch(() => {});
  }

  let editBound = false;
  function bindEditOnce() {
    if (editBound) return;
    editBound = true;
    $("encDetEditBtn")?.addEventListener("click", () => startEdit());
    $("encDetEditDataBtn")?.addEventListener("click", () => openDataEditor());
    $("encEditSaveBtn")?.addEventListener("click", () => openEditWizard());
    $("encEditDiscardBtn")?.addEventListener("click", () => discardEdit());
  }

  // ------------------------------------------------------------------ arranque

  function init() {
    bindWizardOnce();
    bindListOnce();
    bindEditOnce();
    setInterval(() => maybeShowTodayPrompt().catch(() => {}), 5000);
    bindToggleOnce();
    loadEnabled()
      .then(() => {
        if (isEnabled()) refreshCount().catch(() => {});
        return loadEditState();
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
    getReservedQty,
    buildReceiptEmailHtml,
    maybeShowTodayPrompt,
    startEdit,
    isEditing,
    openEditWizard,
    buildCartFromOrder,
    getCashSummaryForClose,
    isEncargoInvoice,
    renderCloseBlock,
    buildCloseReportHtml,
    pickupFlow,
    closeUnclaimedFlow,
    solveDiscounts,
    fsTotalWithDiscounts,
    onRealtime,
    printTodayList,
    createFsPedido,
    cancelFsPedidoQuietly,
    getFsPedidoStateId,
    syncFsObservaciones,
    buildFsObservaciones,
    printReceipt,
    printAdvanceVoucher,
    printRefundVoucher,
    pickupLabel,
    formatDateTimeEs,
    dateKey,
    state,
  };
})();
