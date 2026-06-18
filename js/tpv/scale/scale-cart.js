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

      const maxAgeMs = Math.max(
        500,
        Number(state?.config?.maxAgeMs || 5000) || 5000,
      );
      const updatedAt = Number(state?.updatedAt || 0);
      const age =
        updatedAt > 0 ? Date.now() - updatedAt : Number.POSITIVE_INFINITY;

      // Si la lectura está caducada, no reutilizamos el último peso.
      if (!Number.isFinite(age) || age > maxAgeMs) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      const currentGrams = Number(state.currentGrams || 0);
      if (!Number.isFinite(currentGrams) || currentGrams <= 0) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      const consumeRes = await window.TPV_SCALE.consumeWeight();
      if (!consumeRes?.ok) {
        const errTxt = String(consumeRes?.error || "").toLowerCase();

        // Sin lectura/peso válido => comportamiento normal de TPV: qty por defecto.
        if (
          errTxt.includes("caducada") ||
          errTxt.includes("no hay lectura") ||
          errTxt.includes("no hay peso válido")
        ) {
          return { ok: true, qty: fallbackQty, usedScale: false };
        }

        return { ok: false, blocked: true, silent: true };
      }

      const chargeUnit = state?.config?.chargeUnit === "kg" ? "kg" : "g";
      const configuredDecimals = Number.isFinite(
        Number(state?.config?.decimalPlaces),
      )
        ? Number(state.config.decimalPlaces)
        : 4;
      let saleDecimals = Math.max(0, configuredDecimals);

      // En kg, 0 decimales hace que 0.300 se convierta en 0.
      // Forzamos al menos 1 decimal para no perder la lectura.
      if (chargeUnit === "kg") {
        saleDecimals = Math.max(1, saleDecimals);
      }

      const rawQty =
        chargeUnit === "kg"
          ? Number(consumeRes.kg || 0)
          : Number(consumeRes.grams || 0);

      if (!Number.isFinite(rawQty) || rawQty <= 0) {
        return { ok: true, qty: fallbackQty, usedScale: false };
      }

      let qty = Number(rawQty.toFixed(saleDecimals));

      // Cinturón de seguridad: nunca devolver 0 si la báscula dio un valor positivo.
      if (qty <= 0 && rawQty > 0) {
        const rescueDecimals =
          chargeUnit === "kg"
            ? Math.max(3, saleDecimals + 1)
            : Math.max(1, saleDecimals + 1);
        qty = Number(rawQty.toFixed(rescueDecimals));
      }

      if (qty <= 0 && rawQty > 0) {
        qty = rawQty;
      }

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
