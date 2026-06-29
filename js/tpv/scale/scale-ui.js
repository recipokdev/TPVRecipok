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

  let unsubscribeScaleState = null;
  let scaleUiInitialized = false;
  let scaleAdvancedOpen = false;
  let scaleAutoRecoverTimer = null;
  let scaleAutoRecoverInFlight = false;
  let scaleAutoRecoverAttempt = 0;

  const SCALE_AUTO_RECOVER_DELAYS_MS = [1500, 4000, 8000, 15000];

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

  function parserLabel(kind) {
    switch (kind) {
      case "wgt":
        return "WGT / peso en kg";
      case "reversed_equals":
        return "Invertida con =";
      case "generic":
        return "Genérico";
      default:
        return "—";
    }
  }

  function setScaleAdvancedOpen(open) {
    scaleAdvancedOpen = !!open;

    const body = $id("scaleAdvancedBody");
    const btn = $id("scaleAdvancedToggleBtn");

    if (body) body.style.display = scaleAdvancedOpen ? "block" : "none";
    if (btn) btn.textContent = scaleAdvancedOpen ? "Ocultar" : "Mostrar";
  }

  function clearScaleAutoRecoverTimer() {
    if (scaleAutoRecoverTimer) {
      clearTimeout(scaleAutoRecoverTimer);
      scaleAutoRecoverTimer = null;
    }
  }

  function resetScaleAutoRecover() {
    scaleAutoRecoverAttempt = 0;
    clearScaleAutoRecoverTimer();
  }

  function nextScaleAutoRecoverDelayMs() {
    const idx = Math.min(
      scaleAutoRecoverAttempt,
      SCALE_AUTO_RECOVER_DELAYS_MS.length - 1,
    );
    return SCALE_AUTO_RECOVER_DELAYS_MS[idx];
  }

  async function runScaleAutoRecover() {
    if (scaleAutoRecoverInFlight) return;

    scaleAutoRecoverInFlight = true;
    try {
      const portEl = $id("scalePortSelect");
      const previousPort = String(portEl?.value || "").trim();

      await refreshScalePorts(previousPort);

      if (portEl) {
        const selected = String(portEl.value || "").trim();
        if (!selected) {
          const available = Array.from(portEl.options || [])
            .map((opt) => String(opt.value || "").trim())
            .filter(Boolean);

          if (available.length === 1) {
            portEl.value = available[0];
          }
        }
      }

      await applyScaleConfigFromForm(false);
    } catch (_) {
      // Los siguientes cambios de estado volveran a intentar con backoff.
    } finally {
      scaleAutoRecoverAttempt += 1;
      scaleAutoRecoverInFlight = false;
      scaleAutoRecoverTimer = null;
    }
  }

  function maybeScheduleScaleAutoRecover(state) {
    if (!state?.enabled) {
      resetScaleAutoRecover();
      return;
    }

    if (state.connected && !state.error) {
      resetScaleAutoRecover();
      return;
    }

    if (scaleAutoRecoverInFlight || scaleAutoRecoverTimer) {
      return;
    }

    const delay = nextScaleAutoRecoverDelayMs();
    scaleAutoRecoverTimer = setTimeout(() => {
      runScaleAutoRecover();
    }, delay);
  }

  async function getStoredScaleConfig() {
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

    return {
      enabled: !!enabled,
      portPath: String(portPath || "").trim(),
      baudRate: Number(baudRate || 9600),
      dataBits: Number(dataBits || 8) === 7 ? 7 : 8,
      parity: ["none", "even", "odd", "mark", "space"].includes(
        String(parity || "").toLowerCase(),
      )
        ? String(parity || "").toLowerCase()
        : "none",
      stopBits: Number(stopBits || 1) === 2 ? 2 : 1,
      chargeUnit: chargeUnit === "kg" ? "kg" : "g",
      decimalPlaces: Number.isFinite(Number(decimalPlaces))
        ? Number(decimalPlaces)
        : 4,
      consumeMode: consumeMode === "single" ? "single" : "continuous",

      parserMode: parserMode === "delimiter" ? "delimiter" : "timeout",
      delimiter: ["\\r\\n", "\\r", "\\n"].includes(String(delimiter || ""))
        ? String(delimiter)
        : "\\r\\n",
      interByteMs: Number.isFinite(Number(interByteMs))
        ? Math.max(5, Number(interByteMs))
        : 20,
      reverseReading: !!reverseReading,
      sourceUnit: sourceUnit === "kg" ? "kg" : "g",
      conversionFactor: 1,
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
        SCALE_CFG_KEYS.chargeUnit,
        cfg.chargeUnit === "kg" ? "kg" : "g",
      ),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.decimalPlaces,
        Number.isFinite(Number(cfg.decimalPlaces))
          ? Number(cfg.decimalPlaces)
          : 4,
      ),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.consumeMode,
        cfg.consumeMode === "single" ? "single" : "continuous",
      ),
      window.TPV_CFG.set(SCALE_CFG_KEYS.dataBits, Number(cfg.dataBits || 8)),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.parity,
        ["none", "even", "odd", "mark", "space"].includes(cfg.parity)
          ? cfg.parity
          : "none",
      ),
      window.TPV_CFG.set(SCALE_CFG_KEYS.stopBits, Number(cfg.stopBits || 1)),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.parserMode,
        cfg.parserMode === "delimiter" ? "delimiter" : "timeout",
      ),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.delimiter,
        ["\\r\\n", "\\r", "\\n"].includes(String(cfg.delimiter || ""))
          ? String(cfg.delimiter)
          : "\\r\\n",
      ),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.interByteMs,
        Number(cfg.interByteMs || 20),
      ),
      window.TPV_CFG.set(
        SCALE_CFG_KEYS.sourceUnit,
        cfg.sourceUnit === "kg" ? "kg" : "g",
      ),
      window.TPV_CFG.set(SCALE_CFG_KEYS.reverseReading, !!cfg.reverseReading),
    ]);
  }

  function readConfigFromForm() {
    return {
      enabled: !!$id("scaleEnabledToggle")?.checked,
      portPath: String($id("scalePortSelect")?.value || "").trim(),
      baudRate: Number($id("scaleBaudRateSelect")?.value || 9600),
      dataBits: Number($id("scaleDataBitsSelect")?.value || 8),
      parity: String($id("scaleParitySelect")?.value || "none").toLowerCase(),
      stopBits: Number($id("scaleStopBitsSelect")?.value || 1),
      chargeUnit: $id("scaleChargeUnitSelect")?.value === "kg" ? "kg" : "g",
      decimalPlaces: Number($id("scaleDecimalPlacesSelect")?.value || 4),
      consumeMode:
        $id("scaleConsumeModeSelect")?.value === "single"
          ? "single"
          : "continuous",

      parserMode:
        $id("scaleParserModeSelect")?.value === "delimiter"
          ? "delimiter"
          : "timeout",
      delimiter: String($id("scaleDelimiterSelect")?.value || "\\r\\n"),
      interByteMs: Number($id("scaleInterByteMsSelect")?.value || 20),
      reverseReading: !!$id("scaleReverseReadingToggle")?.checked,
      sourceUnit: $id("scaleSourceUnitSelect")?.value === "kg" ? "kg" : "g",
      conversionFactor: 1,
    };
  }

  function applyConfigToForm(cfg) {
    const enabledEl = $id("scaleEnabledToggle");
    const baudEl = $id("scaleBaudRateSelect");
    const dataBitsEl = $id("scaleDataBitsSelect");
    const parityEl = $id("scaleParitySelect");
    const stopBitsEl = $id("scaleStopBitsSelect");
    const chargeUnitEl = $id("scaleChargeUnitSelect");
    const decimalsEl = $id("scaleDecimalPlacesSelect");
    const modeEl = $id("scaleConsumeModeSelect");
    const parserModeEl = $id("scaleParserModeSelect");
    const delimiterEl = $id("scaleDelimiterSelect");
    const sourceUnitEl = $id("scaleSourceUnitSelect");
    const reverseReadingEl = $id("scaleReverseReadingToggle");
    const interByteMsEl = $id("scaleInterByteMsSelect");

    if (enabledEl) enabledEl.checked = !!cfg.enabled;
    if (baudEl) baudEl.value = String(cfg.baudRate || 9600);
    if (dataBitsEl) dataBitsEl.value = String(cfg.dataBits === 7 ? 7 : 8);
    if (parityEl)
      parityEl.value = ["none", "even", "odd", "mark", "space"].includes(
        cfg.parity,
      )
        ? cfg.parity
        : "none";
    if (stopBitsEl) stopBitsEl.value = String(cfg.stopBits === 2 ? 2 : 1);
    if (chargeUnitEl) chargeUnitEl.value = cfg.chargeUnit === "kg" ? "kg" : "g";
    if (decimalsEl) decimalsEl.value = String(Number(cfg.decimalPlaces ?? 4));
    if (modeEl)
      modeEl.value = cfg.consumeMode === "single" ? "single" : "continuous";
    if (parserModeEl) {
      parserModeEl.value =
        cfg.parserMode === "delimiter" ? "delimiter" : "timeout";
    }
    if (delimiterEl) {
      delimiterEl.value = ["\\r\\n", "\\r", "\\n"].includes(
        String(cfg.delimiter || ""),
      )
        ? String(cfg.delimiter)
        : "\\r\\n";
    }
    if (sourceUnitEl) sourceUnitEl.value = cfg.sourceUnit === "kg" ? "kg" : "g";
    if (reverseReadingEl) reverseReadingEl.checked = !!cfg.reverseReading;
    if (interByteMsEl)
      interByteMsEl.value = String(Number(cfg.interByteMs || 20));
  }

  function updateScaleStateUi(payload) {
    const state = payload?.state || payload || null;
    const statusEl = $id("scaleStatusText");
    const liveEl = $id("scaleLiveWeight");
    const parserEl = $id("scaleDiagParser");
    const tokenEl = $id("scaleDiagToken");
    const rawEl = $id("scaleDiagRaw");

    if (!statusEl || !liveEl || !state) return;

    const grams = Number(state.currentGrams || 0);
    const kg = Number(state.currentKg || 0);
    const hasValidWeight =
      !state.error && state.enabled && state.connected && grams > 0;

    try {
      document.body.classList.toggle("scale-has-weight", hasValidWeight);
    } catch (_) {}

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
      liveEl.textContent = `${grams} g (${kg.toFixed(6)} kg)`;
    } else {
      liveEl.textContent = "0 g";
    }

    if (parserEl) parserEl.textContent = parserLabel(state.parserKind);
    if (tokenEl) tokenEl.textContent = state.lastToken || "—";
    if (rawEl) rawEl.textContent = state.lastRaw || "—";

    maybeScheduleScaleAutoRecover(state);
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
        dataBits: cfg.dataBits,
        parity: cfg.parity,
        stopBits: cfg.stopBits,
        chargeUnit: cfg.chargeUnit,
        decimalPlaces: cfg.decimalPlaces,
        consumeMode: cfg.consumeMode,

        parserMode: cfg.parserMode,
        interByteMs: cfg.interByteMs,
        reverseReading: cfg.reverseReading,
        sourceUnit: cfg.sourceUnit,
        conversionFactor: cfg.conversionFactor,
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
      dataBits: cfg.dataBits,
      parity: cfg.parity,
      stopBits: cfg.stopBits,
      chargeUnit: cfg.chargeUnit,
      decimalPlaces: cfg.decimalPlaces,
      consumeMode: cfg.consumeMode,

      parserMode: cfg.parserMode,
      interByteMs: cfg.interByteMs,
      reverseReading: cfg.reverseReading,
      sourceUnit: cfg.sourceUnit,
      conversionFactor: cfg.conversionFactor,
    });

    if (!res?.ok && showToast) {
      safeToast(res?.error || "No se pudo conectar la báscula.", "err");
    }
  }

  async function syncScaleUiFromStoredConfig() {
    const cfg = await getStoredScaleConfig();
    applyConfigToForm(cfg);
    await refreshScalePorts(cfg.portPath);

    if (cfg.enabled && cfg.portPath) {
      await window.TPV_SCALE.setEnabled(true, {
        enabled: true,
        portPath: cfg.portPath,
        baudRate: cfg.baudRate,
        dataBits: cfg.dataBits,
        parity: cfg.parity,
        stopBits: cfg.stopBits,
        chargeUnit: cfg.chargeUnit,
        decimalPlaces: cfg.decimalPlaces,
        consumeMode: cfg.consumeMode,

        parserMode: cfg.parserMode,
        interByteMs: cfg.interByteMs,
        reverseReading: cfg.reverseReading,
        sourceUnit: cfg.sourceUnit,
        conversionFactor: cfg.conversionFactor,
      });
    }

    const stateRes = await window.TPV_SCALE.getState();
    if (stateRes?.ok && stateRes.state) {
      updateScaleStateUi(stateRes.state);
    }
  }

  async function initScaleOptionsUI() {
    const enabledEl = $id("scaleEnabledToggle");
    const portEl = $id("scalePortSelect");
    const baudEl = $id("scaleBaudRateSelect");
    const dataBitsEl = $id("scaleDataBitsSelect");
    const parityEl = $id("scaleParitySelect");
    const stopBitsEl = $id("scaleStopBitsSelect");
    const chargeUnitEl = $id("scaleChargeUnitSelect");
    const modeEl = $id("scaleConsumeModeSelect");
    const decimalsEl = $id("scaleDecimalPlacesSelect");
    const parserModeEl = $id("scaleParserModeSelect");
    const delimiterEl = $id("scaleDelimiterSelect");
    const sourceUnitEl = $id("scaleSourceUnitSelect");
    const reverseReadingEl = $id("scaleReverseReadingToggle");
    const interByteMsEl = $id("scaleInterByteMsSelect");
    const refreshBtn = $id("scaleRefreshPortsBtn");
    const reconnectBtn = $id("scaleReconnectBtn");
    const advancedBtn = $id("scaleAdvancedToggleBtn");

    if (
      !enabledEl ||
      !portEl ||
      !baudEl ||
      !dataBitsEl ||
      !parityEl ||
      !stopBitsEl ||
      !chargeUnitEl ||
      !modeEl ||
      !decimalsEl ||
      !parserModeEl ||
      !delimiterEl ||
      !sourceUnitEl ||
      !reverseReadingEl ||
      !interByteMsEl ||
      !refreshBtn ||
      !reconnectBtn ||
      !advancedBtn
    ) {
      console.warn("[SCALE UI] No encuentro los elementos del overlay.");
      return;
    }

    if (!scaleUiInitialized) {
      scaleUiInitialized = true;

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

      dataBitsEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      parityEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      stopBitsEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      chargeUnitEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      decimalsEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      modeEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      parserModeEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      delimiterEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      sourceUnitEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      reverseReadingEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      interByteMsEl.addEventListener("change", async () => {
        const cfgNow = readConfigFromForm();
        await saveStoredScaleConfig(cfgNow);
        if (cfgNow.enabled) await applyScaleConfigFromForm(false);
      });

      refreshBtn.addEventListener("click", async () => {
        const current = String(portEl.value || "").trim();
        await refreshScalePorts(current);
      });

      reconnectBtn.addEventListener("click", async () => {
        resetScaleAutoRecover();
        await applyScaleConfigFromForm(true);
      });

      advancedBtn.addEventListener("click", () => {
        setScaleAdvancedOpen(!scaleAdvancedOpen);
      });

      if (typeof unsubscribeScaleState === "function") {
        unsubscribeScaleState();
      }

      unsubscribeScaleState = window.TPV_SCALE.onState((payload) => {
        updateScaleStateUi(payload);
      });
    }

    setScaleAdvancedOpen(false);
    await syncScaleUiFromStoredConfig();
  }

  window.initScaleOptionsUI = initScaleOptionsUI;
})();
