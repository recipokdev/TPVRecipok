// Encargos (pedidos con pago a cuenta) -- parte del TPV. Diseno: docs/diseno-pedidos-con-pago-a-cuenta.md.
// Se carga DESPUES de renderer.js y usa sus funciones globales (fmtMoney, confirmModal, fetchWithTimeout...).
// Con la opcion apagada (por defecto) no cambia nada en pantalla: los botones siguen ocultos y no se hace
// ninguna llamada al servidor.
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
  }

  function setBadge(count, overdue) {
    const badge = $("encargosCountBadge");
    if (!badge) return;
    badge.textContent = String(Math.max(0, Number(count) || 0));
    badge.classList.toggle("is-alert", !!overdue);
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
    let init = { method, headers };
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

  // ------------------------------------------------------------------ contador del boton

  // Encargos de hoy y vencidos que faltan por recoger; en rojo si hay alguno vencido.
  async function refreshCount() {
    // "offline" vive en el TPV_STATE de renderer.js (let global); "isAdmin" en window.TPV_STATE.
    if (!isEnabled() || (typeof TPV_STATE !== "undefined" && TPV_STATE?.offline)) return;
    const today = localDateKey(new Date());
    const r = await call("list-customer-orders", { query: { status: "pendiente", to: today, limit: "500" } });
    if (!r.ok) return;
    const rows = Array.isArray(r.json?.data) ? r.json.data : [];
    const overdue = rows.filter((o) => String(o.pickupAt || "").slice(0, 10) < today).length;
    setBadge(rows.length, overdue > 0);
  }

  function localDateKey(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

  // ------------------------------------------------------------------ arranque

  function init() {
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
    scheduleNovelty,
    call,
    state,
  };
})();
