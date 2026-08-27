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
  // Listar puertos serie es una llamada al SO (enumera dispositivos COM/USB)
  // que puede tardar segundos en maquinas con varios perifericos. Los
  // puertos disponibles casi nunca cambian mientras el TPV esta arrancado,
  // asi que se cachea aqui la primera vez que de verdad hace falta (al
  // abrir/desplegar la seccion "Bascula" en Opciones -- ver
  // ensureScalePortsLoadedOnSectionOpen), no para todos los clientes al
  // arrancar (la mayoria no tiene bascula y nunca abre esa seccion). El
  // boton "Refrescar puertos" SI fuerza una consulta real, por si se acaba
  // de enchufar algo.
  let __scalePortsCache = null;

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
  }

  async function fetchScalePorts() {
    const res = await window.TPV_SCALE.listPorts();
    return Array.isArray(res?.ports) ? res.ports : [];
  }

  async function refreshScalePorts(selectedPath = "", opts = {}) {
    const select = $id("scalePortSelect");
    if (!select) return;

    const currentValue = selectedPath || String(select.value || "").trim();

    const force = !!opts?.force;
    if (!force && Array.isArray(__scalePortsCache)) {
      renderScalePortsOptions(select, __scalePortsCache, currentValue);
      return;
    }

    const ports = await fetchScalePorts();
    __scalePortsCache = ports;
    renderScalePortsOptions(select, ports, currentValue);
  }

  function renderScalePortsOptions(select, ports, currentValue) {
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

  // Rellenar el formulario con lo guardado es una simple lectura local
  // (cfg:get) -- rapida, y se hace siempre que se abre "Opciones". Lo unico
  // lento de verdad es enumerar los puertos serie del SO (refreshScalePorts,
  // salvo que ya este en cache) y el intento de reconexion -- eso solo hace
  // falta si el operario de verdad va a mirar/tocar la seccion "Bascula",
  // asi que se separa en su propia funcion (ver ensureScalePortsLoadedAndConnected).
  async function applyScaleFormFromStoredConfig() {
    const cfg = await getStoredScaleConfig();
    applyConfigToForm(cfg);
    return cfg;
  }

  async function ensureScalePortsLoadedAndConnected(cfg) {
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

  async function syncScaleUiFromStoredConfig() {
    const cfg = await applyScaleFormFromStoredConfig();
    await ensureScalePortsLoadedAndConnected(cfg);
  }

  // Config pendiente de la parte lenta (puertos + reconexion) cuando
  // "Opciones" se abre con la seccion "Bascula" todavia cerrada -- se
  // resuelve en cuanto el operario la abra (ver ensureScalePortsLoadedOnSectionOpen,
  // enganchado desde el acordeon de Opciones en renderer.js). La conexion
  // real de la bascula (para pesar en el carrito) NO depende de esto: la
  // mantiene aparte, siempre, el monitor de reconexion del proceso principal.
  let __pendingScaleConfigForLazyLoad = null;

  async function ensureScalePortsLoadedOnSectionOpen() {
    if (!__pendingScaleConfigForLazyLoad) return;
    const cfg = __pendingScaleConfigForLazyLoad;
    __pendingScaleConfigForLazyLoad = null;
    await ensureScalePortsLoadedAndConnected(cfg);
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
        await refreshScalePorts(current, { force: true });
      });

      reconnectBtn.addEventListener("click", async () => {
        await applyScaleConfigFromForm(false);
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

    const cfg = await applyScaleFormFromStoredConfig();

    // La mayoria de clientes no tienen bascula y nunca abren esta seccion:
    // no tiene sentido que paguen el coste de enumerar puertos serie cada
    // vez que abren "Opciones". Si la seccion quedo desplegada de una vez
    // anterior (ese estado se guarda, sobrevive a reinicios), NO se espera
    // aqui tampoco -- "esperar" seria justo lo que se queria evitar: volver
    // a bloquear "Opciones" con el banner de carga por culpa de la bascula.
    // Se lanza en segundo plano (si toca) y, si no, se deja pendiente para
    // cuando el operario la abra de verdad.
    const bascSection = document.querySelector(
      '#optionsAccordion .opt-sec[data-sec="bascula"]',
    );
    if (bascSection?.dataset?.open === "1") {
      ensureScalePortsLoadedAndConnected(cfg).catch((e) => {
        console.warn("No se pudo cargar bascula en segundo plano:", e?.message || e);
      });
    } else {
      __pendingScaleConfigForLazyLoad = cfg;
    }
  }

  window.initScaleOptionsUI = initScaleOptionsUI;
  window.ensureScalePortsLoadedOnSectionOpen = ensureScalePortsLoadedOnSectionOpen;
})();
