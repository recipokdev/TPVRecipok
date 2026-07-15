(function () {
  const SCALE_CFG_KEYS = {
    enabled: "scale.enabled",
    portPath: "scale.portPath",
    baudRate: "scale.baudRate",
    dataBits: "scale.dataBits",
    parity: "scale.parity",
    stopBits: "scale.stopBits",
    chargeUnit: "scale.chargeUnit",
    decimalPlaces: "scale.decimalPlaces",
    consumeMode: "scale.consumeMode",
    parserMode: "scale.parserMode",
    delimiter: "scale.delimiter",
    interByteMs: "scale.interByteMs",
    sourceUnit: "scale.sourceUnit",
    reverseReading: "scale.reverseReading",
  };

  const SCALE_BOOT_RETRY_MS = 15000;
  const SCALE_SINGLE_FRESH_MS = 1500;
  const SCALE_BACKGROUND_RETRY_MS = 20000;
  let lastScaleBootAttemptAt = 0;
  let scaleReconnectTimer = null;

  function normalizeScaleBootConfig(raw = {}) {
    return {
      enabled: !!raw.enabled,
      portPath: String(raw.portPath || "").trim(),
      baudRate: Number(raw.baudRate || 9600),
      dataBits: Number(raw.dataBits || 8) === 7 ? 7 : 8,
      parity: ["none", "even", "odd", "mark", "space"].includes(
        String(raw.parity || "").toLowerCase(),
      )
        ? String(raw.parity || "").toLowerCase()
        : "none",
      stopBits: Number(raw.stopBits || 1) === 2 ? 2 : 1,
      chargeUnit: raw.chargeUnit === "kg" ? "kg" : "g",
      decimalPlaces: Number.isFinite(Number(raw.decimalPlaces))
        ? Number(raw.decimalPlaces)
        : 4,
      consumeMode: raw.consumeMode === "single" ? "single" : "continuous",
      parserMode: raw.parserMode === "delimiter" ? "delimiter" : "timeout",
      delimiter: ["\\r\\n", "\\r", "\\n"].includes(String(raw.delimiter || ""))
        ? String(raw.delimiter)
        : "\\r\\n",
      interByteMs: Number.isFinite(Number(raw.interByteMs))
        ? Math.max(5, Number(raw.interByteMs))
        : 20,
      reverseReading: !!raw.reverseReading,
      sourceUnit: raw.sourceUnit === "kg" ? "kg" : "g",
      conversionFactor: 1,
    };
  }

  async function getStoredScaleBootConfig() {
    if (!window.TPV_CFG?.get) return null;

    const [
      enabled,
      portPath,
      baudRate,
      dataBits,
      parity,
      stopBits,
      chargeUnit,
      decimalPlaces,
      consumeMode,
      parserMode,
      delimiter,
      interByteMs,
      sourceUnit,
      reverseReading,
    ] = await Promise.all([
      window.TPV_CFG.get(SCALE_CFG_KEYS.enabled),
      window.TPV_CFG.get(SCALE_CFG_KEYS.portPath),
      window.TPV_CFG.get(SCALE_CFG_KEYS.baudRate),
      window.TPV_CFG.get(SCALE_CFG_KEYS.dataBits),
      window.TPV_CFG.get(SCALE_CFG_KEYS.parity),
      window.TPV_CFG.get(SCALE_CFG_KEYS.stopBits),
      window.TPV_CFG.get(SCALE_CFG_KEYS.chargeUnit),
      window.TPV_CFG.get(SCALE_CFG_KEYS.decimalPlaces),
      window.TPV_CFG.get(SCALE_CFG_KEYS.consumeMode),
      window.TPV_CFG.get(SCALE_CFG_KEYS.parserMode),
      window.TPV_CFG.get(SCALE_CFG_KEYS.delimiter),
      window.TPV_CFG.get(SCALE_CFG_KEYS.interByteMs),
      window.TPV_CFG.get(SCALE_CFG_KEYS.sourceUnit),
      window.TPV_CFG.get(SCALE_CFG_KEYS.reverseReading),
    ]);

    return normalizeScaleBootConfig({
      enabled,
      portPath,
      baudRate,
      dataBits,
      parity,
      stopBits,
      chargeUnit,
      decimalPlaces,
      consumeMode,
      parserMode,
      delimiter,
      interByteMs,
      sourceUnit,
      reverseReading,
    });
  }

  async function ensureScaleConnectedIfConfigured() {
    try {
      if (!window.TPV_SCALE?.setEnabled || !window.TPV_SCALE?.getState) return;

      const now = Date.now();
      if (now - lastScaleBootAttemptAt < SCALE_BOOT_RETRY_MS) return;

      const stateRes = await window.TPV_SCALE.getState();
      const state = stateRes?.state || null;
      if (state?.enabled && state?.connected) return;

      const cfg = await getStoredScaleBootConfig();
      if (!cfg?.enabled || !cfg.portPath) return;

      lastScaleBootAttemptAt = now;
      await window.TPV_SCALE.setEnabled(true, cfg);
    } catch (e) {
      console.warn("[scale-cart] auto-connect retry failed:", e);
    }
  }

  function startScaleReconnectMonitor() {
    if (scaleReconnectTimer) return;

    // Primer intento diferido para dar tiempo a enumerar puertos tras arranque.
    setTimeout(() => {
      ensureScaleConnectedIfConfigured().catch(() => {});
    }, 2500);

    scaleReconnectTimer = setInterval(() => {
      ensureScaleConnectedIfConfigured().catch(() => {});
    }, SCALE_BACKGROUND_RETRY_MS);

    try {
      window.addEventListener("focus", () => {
        ensureScaleConnectedIfConfigured().catch(() => {});
      });
    } catch {}

    try {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          ensureScaleConnectedIfConfigured().catch(() => {});
        }
      });
    } catch {}
  }

  async function resolveScaleQuantityIfNeeded(product, fallbackQty = 1) {
    try {
      if (!window.TPV_SCALE) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      await ensureScaleConnectedIfConfigured();

      const stateRes = await window.TPV_SCALE.getState();
      const state = stateRes?.state || null;

      if (!state?.enabled || !state?.connected) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      const currentGrams = Number(state.currentGrams || 0);
      const updatedAt = Number(state.updatedAt || 0);
      const ageMs =
        updatedAt > 0 ? Date.now() - updatedAt : Number.POSITIVE_INFINITY;
      const consumeMode =
        state?.config?.consumeMode === "single" ? "single" : "continuous";
      const maxAgeMs = Math.max(500, Number(state?.config?.maxAgeMs || 5000));
      const freshnessMs =
        consumeMode === "single" ? SCALE_SINGLE_FRESH_MS : maxAgeMs;

      if (!Number.isFinite(currentGrams) || currentGrams <= 0) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      // Si la lectura está envejecida, asumimos báscula sin peso útil.
      if (!Number.isFinite(ageMs) || ageMs > freshnessMs) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      const consumeRes = await window.TPV_SCALE.consumeWeight();
      if (!consumeRes?.ok) {
        // No bloqueamos el flujo de venta: fallback a cantidad por defecto.
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      const chargeUnit = state?.config?.chargeUnit === "kg" ? "kg" : "g";
      const saleDecimals = Number.isFinite(Number(state?.config?.decimalPlaces))
        ? Number(state.config.decimalPlaces)
        : 4;

      let qty =
        chargeUnit === "kg"
          ? Number(consumeRes.kg || 0)
          : Number(consumeRes.grams || 0);

      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      qty = Number(qty.toFixed(saleDecimals));

      return {
        ok: true,
        qty,
        usedScale: true,
        chargeUnit,
      };
    } catch (e) {
      console.warn("[scale-cart] resolveScaleQuantityIfNeeded error:", e);
      return { ok: true, qty: fallbackQty, usedScale: false };
    }
  }

  window.TPV_SCALE_CART = {
    resolveScaleQuantityIfNeeded,
  };

  startScaleReconnectMonitor();
})();
