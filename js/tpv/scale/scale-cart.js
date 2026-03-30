(function () {
  async function resolveScaleQuantityIfNeeded(product, fallbackQty = 1) {
    try {
      if (!window.TPV_SCALE) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      const stateRes = await window.TPV_SCALE.getState();
      const state = stateRes?.state || null;

      if (!state?.enabled || !state?.connected) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      const currentGrams = Number(state.currentGrams || 0);
      if (!Number.isFinite(currentGrams) || currentGrams <= 0) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      const consumeRes = await window.TPV_SCALE.consumeWeight();
      if (!consumeRes?.ok) {
        return { ok: false, blocked: true, silent: true };
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
})();
