(function () {
  const SCALE_CFG_KEYS = {
    enabled: "scale.enabled",
    portPath: "scale.portPath",
    baudRate: "scale.baudRate",
    sourceUnit: "scale.sourceUnit",
    decimalPlaces: "scale.decimalPlaces",
    parserMode: "scale.parserMode",
    interByteMs: "scale.interByteMs",
    conversionFactor: "scale.conversionFactor",
    consumeMode: "scale.consumeMode",
  };

  let unsubscribeScaleState = null;
  let scaleUiInitialized = false;

  function $id(id) {
    return document.getElementById(id);
  }

  function safeToast(msg, type = "warn", title = "Báscula") {
    try {
      if (typeof toast === "function") {
        toast(msg, type, title);
        return;
      }
    } catch (_) {}
    console.log(`[${title}] ${msg}`);
  }

  function parsePositiveNumber(value, fallback = 1) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  async function getStoredScaleConfig() {
    const [
      enabled,
      portPath,
      baudRate,
      sourceUnit,
      decimalPlaces,
      parserMode,
      interByteMs,
      conversionFactor,
      consumeMode,
    ] = await Promise.all([
      window.TPV_CFG.get(SCALE_CFG_KEYS.enabled),
      window.TPV_CFG.get(SCALE_CFG_KEYS.portPath),
      window.TPV_CFG.get(SCALE_CFG_KEYS.baudRate),
      window.TPV_CFG.get(SCALE_CFG_KEYS.sourceUnit),
      window.TPV_CFG.get(SCALE_CFG_KEYS.decimalPlaces),
      window.TPV_CFG.get(SCALE_CFG_KEYS.parserMode),
      window.TPV_CFG.get(SCALE_CFG_KEYS.interByteMs),
      window.TPV_CFG.get(SCALE_CFG_KEYS.conversionFactor),
      window.TPV_CFG.get(SCALE_CFG_KEYS.consumeMode),
    ]);

    return {
      enabled: !!enabled,
      portPath: String(portPath || "").trim(),
      baudRate: Number(baudRate || 9600),
      sourceUnit: sourceUnit === "kg" ? "kg" : "g",
      decimalPlaces: Number.isFinite(Number(decimalPlaces))
        ? Number(decimalPlaces)
        : 4,
      parserMode: parserMode === "timeout" ? "timeout" : "delimiter",
      interByteMs: Number.isFinite(Number(interByteMs))
        ? Number(interByteMs)
        : 20,
      reverseReading: true,
      conversionFactor: parsePositiveNumber(conversionFactor, 1),
      consumeMode: consumeMode === "single" ? "single" : "continuous",
    };
  }

  async function saveStoredScaleConfig(cfg) {
    await Promise.all([
      window.TPV_CFG.set(SCALE_CFG_KEYS.enabled, !!cfg.enabled),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.portPath,
        String(cfg.portPath || "").trim(),
      ),
      window.TPV_CFG.set(SCALE_CFG_KEYS.baudRate, Number(cfg.baudRate || 9600)),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.sourceUnit,
        cfg.sourceUnit === "kg" ? "kg" : "g",
      ),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.decimalPlaces,
        Number.isFinite(Number(cfg.decimalPlaces))
          ? Number(cfg.decimalPlaces)
          : 0,
      ),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.parserMode,
        cfg.parserMode === "timeout" ? "timeout" : "delimiter",
      ),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.interByteMs,
        Number.isFinite(Number(cfg.interByteMs)) ? Number(cfg.interByteMs) : 80,
      ),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.conversionFactor,
        parsePositiveNumber(cfg.conversionFactor, 1),
      ),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.consumeMode,
        cfg.consumeMode === "single" ? "single" : "continuous",
      ),
    ]);
  }

  function readConfigFromForm() {
    return {
      enabled: !!$id("scaleEnabledToggle")?.checked,
      portPath: String($id("scalePortSelect")?.value || "").trim(),
      baudRate: Number($id("scaleBaudRateSelect")?.value || 9600),
      sourceUnit: $id("scaleSourceUnitSelect")?.value === "kg" ? "kg" : "g",
      decimalPlaces: Number($id("scaleDecimalPlacesSelect")?.value || 4),
      parserMode: "timeout",
      interByteMs: 20,
      reverseReading: true,
      conversionFactor: parsePositiveNumber(
        $id("scaleConversionFactorInput")?.value,
        1,
      ),
      consumeMode:
        $id("scaleConsumeModeSelect")?.value === "single"
          ? "single"
          : "continuous",
    };
  }

  function applyConfigToForm(cfg) {
    const enabledEl = $id("scaleEnabledToggle");
    const baudEl = $id("scaleBaudRateSelect");
    const unitEl = $id("scaleSourceUnitSelect");
    const decimalsEl = $id("scaleDecimalPlacesSelect");
    const factorEl = $id("scaleConversionFactorInput");
    const modeEl = $id("scaleConsumeModeSelect");

    if (enabledEl) enabledEl.checked = !!cfg.enabled;
    if (baudEl) baudEl.value = String(cfg.baudRate || 9600);
    if (unitEl) unitEl.value = cfg.sourceUnit === "kg" ? "kg" : "g";
    if (decimalsEl) decimalsEl.value = String(Number(cfg.decimalPlaces ?? 4));
    if (factorEl)
      factorEl.value = String(parsePositiveNumber(cfg.conversionFactor, 1));
    if (modeEl)
      modeEl.value = cfg.consumeMode === "single" ? "single" : "continuous";
  }

  function updateScaleStateUi(payload) {
    const state = payload?.state || payload || null;
    const statusEl = $id("scaleStatusText");
    const liveEl = $id("scaleLiveWeight");

    if (!statusEl || !liveEl || !state) return;

    const grams = Number(state.currentGrams || 0);
    const kg = Number(state.currentKg || 0);

    if (state.error) {
      statusEl.textContent = `Error: ${state.error}`;
    } else if (state.enabled && state.connected) {
      statusEl.textContent = `Conectada en ${state.portPath || "puerto desconocido"}.`;
    } else if (state.enabled && !state.connected) {
      statusEl.textContent = "Activada, pero no conectada.";
    } else {
      statusEl.textContent = "Báscula desactivada.";
    }

    if (grams > 0) {
      liveEl.textContent = `${grams} g (${kg.toFixed(4)} kg)`;
    } else {
      liveEl.textContent = "0 g";
    }
  }

  async function refreshScalePorts(selectedPath = "") {
    const select = $id("scalePortSelect");
    if (!select) return;

    const currentValue = selectedPath || String(select.value || "").trim();

    const res = await window.TPV_SCALE.listPorts();
    const ports = Array.isArray(res?.ports) ? res.ports : [];

    select.innerHTML = "";

    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = ports.length
      ? "Selecciona un puerto"
      : "No se han encontrado puertos";
    select.appendChild(emptyOpt);

    ports.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.path;
      opt.textContent = `${p.path}${p.friendlyName ? " — " + p.friendlyName : ""}`;
      select.appendChild(opt);
    });

    if (currentValue) {
      select.value = currentValue;
    }
  }

  async function applyScaleConfigFromForm(showToast = false) {
    const cfg = readConfigFromForm();

    await saveStoredScaleConfig(cfg);

    if (!cfg.enabled) {
      const res = await window.TPV_SCALE.setEnabled(false, {
        enabled: false,
        portPath: cfg.portPath,
        baudRate: cfg.baudRate,
        sourceUnit: cfg.sourceUnit,
        decimalPlaces: cfg.decimalPlaces,
        parserMode: cfg.parserMode,
        interByteMs: cfg.interByteMs,
        reverseReading: cfg.reverseReading,
        conversionFactor: cfg.conversionFactor,
        consumeMode: cfg.consumeMode,
      });

      if (!res?.ok && showToast) {
        safeToast(res?.error || "No se pudo desactivar la báscula.", "err");
      }
      return;
    }

    if (!cfg.portPath) {
      if (showToast) {
        safeToast("Selecciona primero el puerto de la báscula.", "warn");
      }
      return;
    }

    const res = await window.TPV_SCALE.setEnabled(true, {
      enabled: true,
      portPath: cfg.portPath,
      baudRate: cfg.baudRate,
      sourceUnit: cfg.sourceUnit,
      decimalPlaces: cfg.decimalPlaces,
      parserMode: cfg.parserMode,
      interByteMs: cfg.interByteMs,
      reverseReading: cfg.reverseReading,
      conversionFactor: cfg.conversionFactor,
      consumeMode: cfg.consumeMode,
    });

    if (!res?.ok && showToast) {
      safeToast(res?.error || "No se pudo conectar la báscula.", "err");
    }
  }

  async function initScaleOptionsUI() {
    if (scaleUiInitialized) return;
    scaleUiInitialized = true;

    const enabledEl = $id("scaleEnabledToggle");
    const portEl = $id("scalePortSelect");
    const baudEl = $id("scaleBaudRateSelect");
    const unitEl = $id("scaleSourceUnitSelect");
    const factorEl = $id("scaleConversionFactorInput");
    const modeEl = $id("scaleConsumeModeSelect");
    const decimalsEl = $id("scaleDecimalPlacesSelect");
    const refreshBtn = $id("scaleRefreshPortsBtn");
    const reconnectBtn = $id("scaleReconnectBtn");
    const presetBtns = document.querySelectorAll("[data-scale-factor-preset]");

    if (
      !enabledEl ||
      !portEl ||
      !baudEl ||
      !unitEl ||
      !factorEl ||
      !modeEl ||
      !decimalsEl ||
      !refreshBtn ||
      !reconnectBtn
    ) {
      console.warn("[SCALE UI] No encuentro los elementos del overlay.");
      return;
    }

    const cfg = await getStoredScaleConfig();
    applyConfigToForm(cfg);
    await refreshScalePorts(cfg.portPath);

    if (cfg.enabled && cfg.portPath) {
      await window.TPV_SCALE.setEnabled(true, {
        enabled: true,
        portPath: cfg.portPath,
        baudRate: cfg.baudRate,
        sourceUnit: cfg.sourceUnit,
        decimalPlaces: cfg.decimalPlaces,
        parserMode: cfg.parserMode,
        interByteMs: cfg.interByteMs,
        reverseReading: cfg.reverseReading,
        conversionFactor: cfg.conversionFactor,
        consumeMode: cfg.consumeMode,
      });
    }

    const stateRes = await window.TPV_SCALE.getState();
    if (stateRes?.ok && stateRes.state) {
      updateScaleStateUi(stateRes.state);
    }

    enabledEl.addEventListener("change", async () => {
      await applyScaleConfigFromForm(false);
    });

    portEl.addEventListener("change", async () => {
      const cfgNow = readConfigFromForm();
      await saveStoredScaleConfig(cfgNow);
      if (cfgNow.enabled) await applyScaleConfigFromForm(false);
    });

    baudEl.addEventListener("change", async () => {
      const cfgNow = readConfigFromForm();
      await saveStoredScaleConfig(cfgNow);
      if (cfgNow.enabled) await applyScaleConfigFromForm(false);
    });

    unitEl.addEventListener("change", async () => {
      const cfgNow = readConfigFromForm();
      await saveStoredScaleConfig(cfgNow);
      if (cfgNow.enabled) await applyScaleConfigFromForm(false);
    });

    decimalsEl.addEventListener("change", async () => {
      const cfgNow = readConfigFromForm();
      await saveStoredScaleConfig(cfgNow);
      if (cfgNow.enabled) await applyScaleConfigFromForm(false);
    });

    factorEl.addEventListener("change", async () => {
      const cfgNow = readConfigFromForm();
      factorEl.value = String(parsePositiveNumber(cfgNow.conversionFactor, 1));
      await saveStoredScaleConfig(cfgNow);
      if (cfgNow.enabled) await applyScaleConfigFromForm(false);
    });

    modeEl.addEventListener("change", async () => {
      const cfgNow = readConfigFromForm();
      await saveStoredScaleConfig(cfgNow);
      if (cfgNow.enabled) await applyScaleConfigFromForm(false);
    });

    presetBtns.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const preset = parsePositiveNumber(btn.dataset.scaleFactorPreset, 1);
        factorEl.value = String(preset);

        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);

        if (cfgNow.enabled) {
          await applyScaleConfigFromForm(false);
        }
      });
    });

    refreshBtn.addEventListener("click", async () => {
      const current = String(portEl.value || "").trim();
      await refreshScalePorts(current);
    });

    reconnectBtn.addEventListener("click", async () => {
      await applyScaleConfigFromForm(false);
    });

    if (typeof unsubscribeScaleState === "function") {
      unsubscribeScaleState();
    }

    unsubscribeScaleState = window.TPV_SCALE.onState((payload) => {
      updateScaleStateUi(payload);
    });
  }

  window.initScaleOptionsUI = initScaleOptionsUI;
})();
