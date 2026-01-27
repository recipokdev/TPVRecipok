const { TPV_CONFIG } = require("./config.js");
const { FacturaScriptsApi } = require("./fsApi.js");
const { listarCajasAbiertas, cerrarCaja, crearCaja } = require("./cajas.js");
const { LockClient } = require("./lockClient.js");
const { showCajaSelector } = require("./ui/selector.js");
console.log("[PRELOAD] cargado OK");

let retryCount = 0;

function getAuthFromYourApp() {
  // En tu app el login vive en localStorage (tpv_login_user / tpv_login_token)
  const user = (localStorage.getItem("tpv_login_user") || "").trim();
  const token = (localStorage.getItem("tpv_login_token") || "").trim();

  if (!user || !token) {
    throw new Error("Usuario no autenticado en TPV");
  }

  // En tu proyecto, la API key es el Token de FS (RECIPOK_API.apiKey)
  // pero para el bootstrap usaremos el mismo esquema que tu fetch: header Token
  return {
    nick: user,
    apiKey: (window.RECIPOK_API?.apiKey || "").trim() || null,
    token: null, // IMPORTANTE: no usar tpv_login_token como Bearer en FacturaScripts
  };
}

function openCajaInUI(cajaOrId) {
  const idcaja = typeof cajaOrId === "object" ? cajaOrId.idcaja : cajaOrId;
  const idtpv =
    typeof cajaOrId === "object" ? cajaOrId.idtpv : TPV_CONFIG.idtpv;

  window.currentCajaId = idcaja;

  document.dispatchEvent(
    new CustomEvent("tpv:cajaAbierta", {
      detail: {
        idcaja,
        idtpv,
        caja: typeof cajaOrId === "object" ? cajaOrId : null,
      },
    }),
  );
}

async function initTPVBootstrap() {
  try {
    console.log("[BOOT] initTPVBootstrap ejecutándose");
    // Si aún no hay sesión, esperamos y reintentamos (sin consumir retryCount)
    try {
      getAuthFromYourApp();
    } catch (e) {
      setTimeout(() => initTPVBootstrap(), 600);
      return;
    }

    // Ahora sí: ya hay sesión -> aplicamos control de reintentos
    if (retryCount > 3) {
      alert("No se pueden resolver las cajas abiertas automáticamente.");
      return;
    }
    retryCount++;

    const { nick, apiKey, token } = getAuthFromYourApp();

    const fsApi = new FacturaScriptsApi({
      baseUrl: TPV_CONFIG.facturaScriptsApiBase,
      apiKey,
      token,
    });

    console.log(
      "[BOOT] initTPVBootstrap ok. idtpv=",
      TPV_CONFIG.idtpv,
      "nick=",
      nick,
    );

    const lock = new LockClient({
      baseUrl: TPV_CONFIG.lockServiceBase,
      ttlSeconds: TPV_CONFIG.lockTtlSeconds,
    });

    // 1) Lock
    const acquired = await lock.acquire({ idtpv: TPV_CONFIG.idtpv, nick });
    if (!acquired.ok) {
      alert(
        `TPV en uso por ${acquired.lockedBy}\n` +
          `Desde: ${new Date(acquired.since).toLocaleTimeString()}`,
      );

      return;
    }

    // 2) Heartbeat
    const heartbeatId = setInterval(() => {
      lock.heartbeat({ idtpv: TPV_CONFIG.idtpv }).catch(() => {});
    }, TPV_CONFIG.heartbeatSeconds * 1000);

    // Release al cerrar ventana/app
    window.addEventListener("beforeunload", () => {
      clearInterval(heartbeatId);
      lock.release({ idtpv: TPV_CONFIG.idtpv }).catch(() => {});
    });

    // 3) Cajas abiertas
    const abiertas = await listarCajasAbiertas({
      fsApi,
      idtpv: TPV_CONFIG.idtpv,
    });
    console.log(
      "[BOOT] cajas abiertas encontradas:",
      abiertas.map((c) => ({
        idcaja: c.idcaja,
        idtpv: c.idtpv,
        nick: c.nick,
        fechaini: c.fechaini,
      })),
    );

    console.log(
      "[TPV][bootstrap] TPV_CONFIG.idtpv =",
      TPV_CONFIG.idtpv,
      "tipo=",
      typeof TPV_CONFIG.idtpv,
    );
    console.log("[TPV][bootstrap] abiertas.length =", abiertas.length);
    if (abiertas[0])
      console.log("[TPV][bootstrap] primera abierta =", abiertas[0]);

    if (abiertas.length === 0) {
      // doble-check rápido por si el listado vino vacío por un fallo puntual
      const abiertas2 = await listarCajasAbiertas({
        fsApi,
        idtpv: TPV_CONFIG.idtpv,
      });
      if (abiertas2.length) {
        retryCount = 0;
        openCajaInUI(abiertas2[0]); // objeto completo
        return;
      }

      const nueva = await crearCaja({
        fsApi,
        idtpv: TPV_CONFIG.idtpv,
        nick,
        dineroini: 0,
      });
      openCajaInUI(nueva.idcaja ?? nueva?.data?.idcaja);
      return;
    }

    if (abiertas.length === 1) {
      retryCount = 0;
      openCajaInUI(abiertas[0]); // pasa objeto completo
      return;
    }

    // > 1 abiertas => selector
    const hide = showCajaSelector({
      cajas: abiertas,
      onOpen: (idcaja) => {
        hide();
        retryCount = 0;
        const caja = abiertas.find((c) => c.idcaja === idcaja) || {
          idcaja,
          idtpv: TPV_CONFIG.idtpv,
        };
        openCajaInUI(caja);
      },
      onClose: async (idcaja) => {
        await cerrarCaja({
          fsApi,
          idcaja,
          observaciones: "Cierre manual desde selector de cajas abiertas.",
        });
        // refrescar lista
        const nuevas = await listarCajasAbiertas({
          fsApi,
          idtpv: TPV_CONFIG.idtpv,
        });
        if (nuevas.length === 1) {
          hide();
          retryCount = 0;
          openCajaInUI(nuevas[0]); // objeto completo
        } else {
          hide();
          initTPVBootstrap();
          return;
        }
      },
      onCancel: () => {
        hide();
        alert("No se ha seleccionado caja.");
      },
    });
  } catch (err) {
    console.error("TPV Bootstrap error:", err);
    alert("Error iniciando TPV. Revisa conexión o sesión.");
  }
}

module.exports = { initTPVBootstrap };
