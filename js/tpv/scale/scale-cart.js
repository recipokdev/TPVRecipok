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

      const sourceUnit = state?.config?.sourceUnit === "kg" ? "kg" : "g";
      const factor = Number(state?.config?.conversionFactor || 1);
      const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;

      const baseQty =
        sourceUnit === "kg"
          ? Number(consumeRes.kg || 0)
          : Number(consumeRes.grams || 0);

      let qty = baseQty * safeFactor;

      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      qty = Number(qty.toFixed(4));

      return {
        ok: true,
        qty,
        usedScale: true,
        sourceUnit,
        factor: safeFactor,
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
