// js/tpv/bootstrap.js
const { TPV_CONFIG } = require("./config.js");
const { FacturaScriptsApi } = require("./fsApi.js");
const { listarCajasAbiertas, cerrarCaja, crearCaja } = require("./cajas.js");
const { LockClient } = require("./lockClient.js");
const { showCajaSelector } = require("./ui/selector.js");

let started = false;
let retryCount = 0;

function openCajaInUI(cajaOrId, fallbackIdtpv) {
  const caja = (typeof cajaOrId === "object" && cajaOrId) ? cajaOrId : null;
  const idcaja = caja ? caja.idcaja : cajaOrId;
  const idtpv = caja ? caja.idtpv : (fallbackIdtpv ?? TPV_CONFIG.idtpv);

  console.log("[BOOT] -> dispatch tpv:cajaAbierta", { idcaja, idtpv, cajaNick: caja?.nick });

  document.dispatchEvent(
    new CustomEvent("tpv:cajaAbierta", {
      detail: { idcaja, idtpv, caja },
    }),
  );
}

function safeNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickConfigFromPayload(payload = {}) {
  const nick = String(payload.nick || "").trim();
  const apiKey = String(payload.apiKey || "").trim();
  const baseUrl =
    String(payload.baseUrl || "").trim() ||
    String(TPV_CONFIG.facturaScriptsApiBase || "").trim();

  const idtpv = safeNum(payload.idtpv, safeNum(TPV_CONFIG.idtpv, 1));
  return { nick, apiKey, baseUrl, idtpv };
}

function formatSince(since) {
  // lock puede venir con epoch, ISO o vacío
  if (!since) return null;
  const d = new Date(since);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function initTPVBootstrap(payload = {}) {
  if (started) {
    console.log("[BOOT] init ignorado (ya iniciado)");
    return;
  }

  console.log("[BOOT] initTPVBootstrap ejecutándose");
  const { nick, apiKey, baseUrl, idtpv } = pickConfigFromPayload(payload);

  console.log("[BOOT] cfg:", { nick, apiKeyLen: apiKey.length, baseUrl, idtpv });

  if (!nick || !apiKey || !baseUrl || !idtpv) {
    console.error("[BOOT] Faltan datos para bootstrap:", { nick, apiKeyLen: apiKey.length, baseUrl, idtpv });
    return;
  }

  // Control reintentos (solo errores reales)
  if (retryCount > 3) {
    alert("No se pueden resolver las cajas abiertas automáticamente.");
    return;
  }
  retryCount++;

  const fsApi = new FacturaScriptsApi({ baseUrl, apiKey, token: null });

  const lock = new LockClient({
    baseUrl: TPV_CONFIG.lockServiceBase,
    ttlSeconds: TPV_CONFIG.lockTtlSeconds,
  });

  // 1) Lock
  const acquired = await lock.acquire({ idtpv, nick });
  if (!acquired.ok) {
    const sinceDate = formatSince(acquired.since);
    alert(
      `TPV en uso por ${acquired.lockedBy}\n` +
      `Desde: ${sinceDate ? sinceDate.toLocaleTimeString() : "(sin fecha)"}`
    );
    return;
  }

  started = true;
  retryCount = 0;

  // 2) Heartbeat
  const heartbeatId = setInterval(() => {
    lock.heartbeat({ idtpv }).catch(() => {});
  }, TPV_CONFIG.heartbeatSeconds * 1000);

  window.addEventListener("beforeunload", () => {
    clearInterval(heartbeatId);
    lock.release({ idtpv }).catch(() => {});
  });

  // 3) Cajas abiertas
  console.log("[BOOT] buscando cajas abiertas (idtpv =", idtpv, ")");
  const abiertas = await listarCajasAbiertas({ fsApi, idtpv });

  console.log("[BOOT] abiertas:", abiertas.map(c => ({ idcaja: c.idcaja, idtpv: c.idtpv, nick: c.nick, fechaini: c.fechaini })));

  if (abiertas.length === 0) {
    console.log("[BOOT] no hay abiertas -> crearCaja()");
    const nueva = await crearCaja({ fsApi, idtpv, nick, dineroini: 0 });
    const idcaja = nueva?.idcaja ?? nueva?.data?.idcaja;
    openCajaInUI({ idcaja, idtpv, nick, fechaini: nueva?.fechaini ?? null }, idtpv);
    return;
  }

  if (abiertas.length === 1) {
    console.log("[BOOT] 1 abierta -> reusar", abiertas[0].idcaja);
    openCajaInUI(abiertas[0], idtpv);
    return;
  }

  // >1 abiertas => selector
  console.log("[BOOT] >1 abierta -> mostrar selector");
  const hide = showCajaSelector({
    cajas: abiertas,
    onOpen: (idcaja) => {
      hide();
      const caja = abiertas.find(c => String(c.idcaja) === String(idcaja)) || { idcaja, idtpv };
      openCajaInUI(caja, idtpv);
    },
    onClose: async (idcaja) => {
      await cerrarCaja({
        fsApi,
        idcaja,
        observaciones: "Cierre manual desde selector de cajas abiertas.",
      });
      const nuevas = await listarCajasAbiertas({ fsApi, idtpv });
      if (nuevas.length === 1) {
        hide();
        openCajaInUI(nuevas[0], idtpv);
      } else {
        hide();
        // Reintenta flujo normal sin reiniciar lock/heartbeat
        // (si prefieres, aquí puedes volver a mostrar selector)
        alert("Aún quedan varias cajas abiertas.");
      }
    },
    onCancel: () => {
      hide();
      alert("No se ha seleccionado caja.");
    },
  });
}

module.exports = { initTPVBootstrap };
