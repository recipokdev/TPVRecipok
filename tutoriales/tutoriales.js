(function () {
  const api = window.TPV_TUTORIALS_API || null;
  if (!api) {
    console.warn("[TUTORIALES] API no disponible en renderer.");
    return;
  }

  const FALLBACK_HTML = `
<div id="tutorialHubOverlay" class="simple-overlay hidden"></div>
<div id="tutorialCoachDock" class="tutorial-coach hidden" aria-live="polite"></div>
`;

  let els = null;
  let tutorialModeActive = false;
  let tutorialState = null;
  let tutorialHighlightState = null;
  let tutorialRenderRetryTimer = null;
  let tutorialIgnoreClickAdvanceUntil = 0;
  let tutorialDemoSnapshot = null;
  let tutorialLockBound = false;
  let pendingResumeChoice = null;
  let tutorialHubMode = "tpv";

  const TUTORIAL_PROGRESS_KEY = "tpv_tutorial_progress_v1";
  const TUTORIAL_DEMO_SNAPSHOT_KEY = "tpv_tutorial_demo_snapshot_v1";
  const TUTORIAL_HUB_MODE_KEY = "tpv_tutorial_hub_mode_v1";
  const TUTORIAL_MESAS_BACKUP_KEY = "tpv_tutorial_mesas_backup_v1";
  const TUTORIAL_ACTIVE_KEY = "tpv_tutorial_active_v1";
  const MESAS_STATE_KEY = "tpv_tables_state_v3";
  const MESAS_STATE_LEGACY_KEY = "tpv_tables_state_v2";

  try {
    localStorage.removeItem(TUTORIAL_ACTIVE_KEY);
  } catch {}

  function setTutorialActiveFlag(active) {
    try {
      if (active) {
        localStorage.setItem(TUTORIAL_ACTIVE_KEY, "1");
      } else {
        localStorage.removeItem(TUTORIAL_ACTIVE_KEY);
      }
    } catch {}
  }

  const DEMO_KEY_PATTERNS = [
    /^tpv_tables_state_v3$/,
    /^tpv_tables_state_v2$/,
    /^tpv_mesas_layout_cache_v1(?:::.+)?$/,
    /^tpv_mesas_layout_sync_queue_v1(?:::.+)?$/,
  ];

  const TUTORIAL_ESCAPE_CONTROL_IDS = new Set([
    "parkedCloseBtn",
    "ticketsCloseBtn",
    "payCloseX",
    "payCancelBtn",
    "payEditCloseX",
    "payEditCancelBtn",
  ]);

  function toast(msg, tone = "info", title = "Tutoriales") {
    if (typeof api.toast === "function") api.toast(msg, tone, title);
  }

  function isMesasInlineActive() {
    return !!(typeof api.isMesasInlineActive === "function"
      ? api.isMesasInlineActive()
      : false);
  }

  function isMesasModuleEnabled() {
    return !!(typeof api.isMesasModuleEnabled === "function"
      ? api.isMesasModuleEnabled()
      : false);
  }

  function isAdminUser() {
    return !!(typeof api.isAdminUser === "function"
      ? api.isAdminUser()
      : false);
  }

  function keyMatchesDemoScope(key) {
    const safeKey = String(key || "");
    return DEMO_KEY_PATTERNS.some((re) => re.test(safeKey));
  }

  function captureDemoSnapshot() {
    const entries = {};
    let mesasRaw = "";

    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = String(localStorage.key(i) || "");
        if (!keyMatchesDemoScope(key)) continue;
        entries[key] = localStorage.getItem(key);
      }
    } catch (err) {
      console.warn("[TUTORIALES] No se pudo capturar snapshot demo:", err);
      return null;
    }

    try {
      if (typeof api.getMesasTutorialStateRaw === "function") {
        mesasRaw = String(api.getMesasTutorialStateRaw() || "");
      }
    } catch {}

    return {
      createdAt: Date.now(),
      entries,
      mesasRaw,
    };
  }

  function savePersistentDemoSnapshot(snapshot) {
    try {
      if (!snapshot) {
        localStorage.removeItem(TUTORIAL_DEMO_SNAPSHOT_KEY);
        return;
      }
      localStorage.setItem(
        TUTORIAL_DEMO_SNAPSHOT_KEY,
        JSON.stringify(snapshot),
      );
    } catch {}
  }

  function loadPersistentDemoSnapshot() {
    try {
      const raw = localStorage.getItem(TUTORIAL_DEMO_SNAPSHOT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function clearTutorialProgress() {
    try {
      localStorage.removeItem(TUTORIAL_PROGRESS_KEY);
    } catch {}
  }

  function saveTutorialProgress() {
    if (!tutorialState?.active) return;

    try {
      const payload = {
        tutorialId: String(tutorialState.tutorialId || ""),
        stepIndex: Math.max(0, Number(tutorialState.stepIndex || 0) || 0),
        updatedAt: Date.now(),
      };
      localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify(payload));
    } catch {}
  }

  function loadTutorialProgress() {
    try {
      const raw = localStorage.getItem(TUTORIAL_PROGRESS_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;

      const tutorialId = String(parsed.tutorialId || "").trim();
      const stepIndex = Math.max(0, Number(parsed.stepIndex || 0) || 0);
      if (!tutorialId) return null;

      return {
        tutorialId,
        stepIndex,
        updatedAt: Number(parsed.updatedAt || 0) || 0,
      };
    } catch {
      return null;
    }
  }

  function restoreDemoSnapshot() {
    const snap = tutorialDemoSnapshot || loadPersistentDemoSnapshot();
    if (!snap) return false;

    try {
      const existingKeys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = String(localStorage.key(i) || "");
        if (keyMatchesDemoScope(key)) existingKeys.push(key);
      }

      existingKeys.forEach((key) => {
        localStorage.removeItem(key);
      });

      Object.entries(snap.entries || {}).forEach(([key, value]) => {
        if (value == null) return;
        localStorage.setItem(key, value);
      });

      if (typeof api.applyMesasTutorialStateLocal === "function") {
        const raw = String(snap?.mesasRaw || "").trim();
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            api.applyMesasTutorialStateLocal(parsed);
          } catch {}
        }
      }

      window.dispatchEvent(
        new StorageEvent("storage", { key: "tpv_tables_state_v3" }),
      );
      toast("Demo restaurada: se recuperó el estado real de Mesas.", "ok");
    } catch (err) {
      console.warn("[TUTORIALES] No se pudo restaurar snapshot demo:", err);
      toast("No se pudo restaurar automáticamente la demo.", "warn");
    }

    tutorialDemoSnapshot = null;
    savePersistentDemoSnapshot(null);
    return true;
  }

  function restoreDemoSnapshotIfCrashedBefore() {
    const pending = loadPersistentDemoSnapshot();
    if (pending) {
      tutorialDemoSnapshot = pending;
      restoreDemoSnapshot();
    }
    restoreMesasBackupIfPending();
  }

  function saveMesasBackupBeforeTutorial() {
    try {
      const existing = localStorage.getItem(TUTORIAL_MESAS_BACKUP_KEY);
      if (String(existing || "").trim()) return;

      let raw = "";
      if (typeof api.getMesasTutorialStateRaw === "function") {
        raw = String(api.getMesasTutorialStateRaw() || "");
      }
      if (!raw) {
        raw = String(
          localStorage.getItem(MESAS_STATE_KEY) ||
            localStorage.getItem(MESAS_STATE_LEGACY_KEY) ||
            "",
        );
      }
      if (!raw) return;

      localStorage.setItem(
        TUTORIAL_MESAS_BACKUP_KEY,
        JSON.stringify({ savedAt: Date.now(), raw }),
      );
    } catch {}
  }

  function clearMesasBackup() {
    try {
      localStorage.removeItem(TUTORIAL_MESAS_BACKUP_KEY);
    } catch {}
  }

  function restoreMesasBackupIfPending() {
    try {
      const rawBackup = String(
        localStorage.getItem(TUTORIAL_MESAS_BACKUP_KEY) || "",
      ).trim();
      if (!rawBackup) return false;

      const parsedBackup = JSON.parse(rawBackup);
      const mesasRaw = String(parsedBackup?.raw || "").trim();
      if (!mesasRaw) {
        clearMesasBackup();
        return false;
      }

      if (typeof api.applyMesasTutorialStateLocal === "function") {
        try {
          const nextState = JSON.parse(mesasRaw);
          api.applyMesasTutorialStateLocal(nextState);
        } catch {}
      }

      localStorage.setItem(MESAS_STATE_KEY, mesasRaw);
      localStorage.setItem(MESAS_STATE_LEGACY_KEY, mesasRaw);
      window.dispatchEvent(
        new StorageEvent("storage", { key: MESAS_STATE_KEY }),
      );
      clearMesasBackup();
      return true;
    } catch {
      clearMesasBackup();
      return false;
    }
  }

  function hasPendingProgressForTutorial(tutorialId) {
    const progress = loadTutorialProgress();
    if (!progress) return null;
    if (String(progress.tutorialId || "") !== String(tutorialId || ""))
      return null;
    if (!tutorialCatalog[progress.tutorialId]) {
      clearTutorialProgress();
      return null;
    }
    return progress;
  }

  function getMesasInlineFrameDocument() {
    const panelFrame = document.getElementById("mesasInlinePanelFrame");
    if (!panelFrame) return null;

    try {
      return panelFrame.contentDocument || panelFrame.contentWindow?.document;
    } catch {
      return null;
    }
  }

  function buildTutorialMesasBaseState() {
    const roomId = "tut-room-1";
    const roomId2 = "tut-room-2";
    return {
      activeRoomId: roomId,
      selectedTableId: `${roomId}::m2`,
      roomList: [
        {
          id: roomId,
          name: "Sala Tutorial",
          tables: [
            { id: "m1", name: "M1" },
            { id: "m2", name: "M2" },
            { id: "m3", name: "M3" },
            { id: "m4", name: "M4" },
          ],
        },
        {
          id: roomId2,
          name: "Sala Tutorial 2",
          tables: [
            { id: "n1", name: "N1" },
            { id: "n2", name: "N2" },
          ],
        },
      ],
      tableStates: {
        [`${roomId}::m1`]: "ocupada",
        [`${roomId}::m2`]: "libre",
        [`${roomId}::m3`]: "reservada",
        [`${roomId}::m4`]: "cuenta",
        [`${roomId2}::n1`]: "libre",
        [`${roomId2}::n2`]: "ocupada",
      },
      tableMeta: {
        [`${roomId}::m1`]: { diners: 4 },
        [`${roomId}::m2`]: { diners: 0 },
        [`${roomId}::m3`]: {
          diners: 2,
          reservationName: "Reserva demo",
          reservationTime: "21:00",
        },
        [`${roomId}::m4`]: {
          diners: 3,
          serviceStage: "cuenta-pedida",
        },
        [`${roomId2}::n1`]: { diners: 0 },
        [`${roomId2}::n2`]: { diners: 2 },
      },
      tableTicketMap: {},
      draftCartByTable: {},
    };
  }

  function applyMesasTutorialBaseState() {
    try {
      const nextState = buildTutorialMesasBaseState();
      const raw = JSON.stringify(nextState);

      const appliedViaApi =
        typeof api.applyMesasTutorialStateLocal === "function"
          ? api.applyMesasTutorialStateLocal(nextState)
          : false;

      if (!appliedViaApi && window.MESAS_BRIDGE?.setTablesStateRaw) {
        window.MESAS_BRIDGE.setTablesStateRaw(raw);
      }

      // Respaldo en local para mantener coherencia de lectura en distintos flujos.
      localStorage.setItem(MESAS_STATE_KEY, raw);
      localStorage.setItem(MESAS_STATE_LEGACY_KEY, raw);

      for (let i = 0; i < localStorage.length; i += 1) {
        const key = String(localStorage.key(i) || "");
        if (key.startsWith("tpv_mesas_layout_cache_v1::")) {
          localStorage.setItem(key, raw);
        }
      }

      api.setMesasInlineView?.("transacciones", { persist: false });
      window.dispatchEvent(
        new StorageEvent("storage", { key: MESAS_STATE_KEY }),
      );
    } catch (err) {
      console.warn("[TUTORIALES] No se pudo preparar base demo de Mesas:", err);
    }
  }

  function maybeApplyMesasTutorialBaseState() {
    if (!tutorialState?.active) return;
    if (String(tutorialState?.tutorialFamily || "") !== "mesas") return;
    if (tutorialState?.mesasDemoSeedApplied) return;

    applyMesasTutorialBaseState();
    tutorialState.mesasDemoSeedApplied = true;
  }

  function refreshDynamicSelectFreeMesaStep(step) {
    if (!step || step.stepKey !== "select-free-mesa") return;

    const info =
      typeof api.getMesasTutorialSelectionState === "function"
        ? api.getMesasTutorialSelectionState() || {}
        : {};

    const isSelectedMesaFree =
      String(info?.selectedStatusKind || "").toLowerCase() === "libre";

    if (isSelectedMesaFree) {
      step.title = "Mesa libre lista para reserva";
      step.text =
        "Tu mesa actual ya está libre. Recuerda: solo las mesas libres se pueden reservar. Aquí te mostramos la mesa actual y la zona de reservas en Acciones rápidas.";
      step.target = ".mts-selected-card";
      step.highlightSelectors = ["#mesasTransReservaBox"];
      step.blockTargetControls = true;
      step.allowInteractionSelectors = [];
      step.advanceOn = "click";
      step.interactionLevel = "recommended";
      return;
    }

    step.title = "Seleccionar mesa libre";
    step.text =
      "Para reservar, selecciona una mesa libre. Solo las mesas libres pueden reservarse.";
    step.target =
      "#mesasTransOtherTables .mts-table-btn.is-libre, #mesasContextQuickSwitch .mesas-quick-btn.is-libre, #mesasTransOtherTables .mts-table-btn, #mesasContextQuickSwitch .mesas-quick-btn";
    step.allowInteractionSelectors = [
      "#mesasTransOtherTables .mts-table-btn.is-libre",
      "#mesasTransOtherTables .mts-table-btn",
      "#mesasContextQuickSwitch .mesas-quick-btn.is-libre",
      "#mesasContextQuickSwitch .mesas-quick-btn",
    ];
    step.highlightSelectors = [
      "#mesasTransOtherTables .mts-table-btn.is-libre",
    ];
    step.blockTargetControls = false;
    step.advanceOn = "click";
    step.interactionLevel = "recommended";
  }

  function scheduleTutorialStepRefresh(delay = 220) {
    if (tutorialRenderRetryTimer) {
      clearTimeout(tutorialRenderRetryTimer);
    }

    tutorialRenderRetryTimer = setTimeout(
      () => {
        tutorialRenderRetryTimer = null;
        if (!tutorialState?.active) return;
        void renderTutorialStep({ runEnterAction: false });
      },
      Math.max(120, Number(delay) || 220),
    );
  }

  function clearTutorialHighlight() {
    try {
      document
        .querySelectorAll(".tutorial-target-highlight")
        .forEach((node) => node.classList.remove("tutorial-target-highlight"));
    } catch {}

    try {
      const frameDoc = getMesasInlineFrameDocument();
      frameDoc
        ?.querySelectorAll(".tutorial-target-highlight")
        ?.forEach((node) => node.classList.remove("tutorial-target-highlight"));
    } catch {}

    const states = Array.isArray(tutorialHighlightState)
      ? tutorialHighlightState
      : tutorialHighlightState
        ? [tutorialHighlightState]
        : [];

    states.forEach((state) => {
      const el = state?.element || null;
      if (!el) return;

      try {
        el.classList.remove("tutorial-target-highlight");
      } catch {}

      try {
        el.style.outline = state.outline || "";
        el.style.outlineOffset = state.outlineOffset || "";
        el.style.boxShadow = state.boxShadow || "";
        el.style.borderRadius = state.borderRadius || "";
      } catch {}
    });

    tutorialHighlightState = [];
  }

  function getCurrentStepTarget() {
    if (!tutorialState?.active) return null;
    const step = getCurrentStep();
    return resolveTutorialTarget(step);
  }

  function getCurrentStep() {
    if (!tutorialState?.active) return null;
    return tutorialState.steps?.[tutorialState.stepIndex] || null;
  }

  function resolveTutorialTargetBySelector(rawSelector) {
    const rawTarget = String(rawSelector || "").trim();
    if (!rawTarget) return null;

    if (rawTarget.startsWith("iframe:")) {
      const frameSelector = rawTarget.slice(7).trim();
      if (!frameSelector) return null;

      try {
        const doc = getMesasInlineFrameDocument();
        if (!doc) return null;
        return doc.querySelector(frameSelector);
      } catch {
        return null;
      }
    }

    try {
      return document.querySelector(rawTarget);
    } catch {
      return null;
    }
  }

  function getCurrentStepAllowedInteractionTargets() {
    if (!tutorialState?.active) return [];
    const step = tutorialState.steps?.[tutorialState.stepIndex];
    if (!step) return [];

    const rawList = Array.isArray(step?.allowInteractionSelectors)
      ? step.allowInteractionSelectors
      : [];

    const resolved = [];
    rawList.forEach((selector) => {
      const node = resolveTutorialTargetBySelector(selector);
      if (node) resolved.push(node);
    });

    return resolved;
  }

  function isStepInteractive(step) {
    const mode = String(step?.advanceOn || "")
      .trim()
      .toLowerCase();
    return mode === "click" || mode === "manual";
  }

  function getStepInteractionLevel(step) {
    const raw = String(step?.interactionLevel || "")
      .trim()
      .toLowerCase();
    if (raw === "optional") return "optional";
    return "recommended";
  }

  function getCurrentStepCompletionState() {
    if (!tutorialState?.active) return false;
    const key = String(tutorialState.stepIndex);
    return !!tutorialState?.stepInteracted?.[key];
  }

  function eventMatchesManualCompletion(event, step) {
    const mode = String(step?.interactionCompleteOn || "any")
      .trim()
      .toLowerCase();
    const type = String(event?.type || "")
      .trim()
      .toLowerCase();

    if (mode === "change") return type === "change";
    if (mode === "input") return type === "input" || type === "change";
    if (mode === "click") {
      return type === "click" || type === "pointerdown" || type === "mousedown";
    }

    return (
      type === "click" ||
      type === "pointerdown" ||
      type === "mousedown" ||
      type === "change" ||
      type === "input"
    );
  }

  function isInteractiveControlTarget(target) {
    const node =
      target && typeof target.closest === "function"
        ? target.closest(
            "button, input, select, textarea, a, [role='button'], [data-action], .qty-btn, .mesas-quick-btn, .mts-action-btn, .mts-table-btn",
          )
        : null;
    return !!node;
  }

  function isBlockedControlInteraction(target, step, currentTarget) {
    if (!step?.blockTargetControls) return false;
    if (!target || !currentTarget) return false;
    if (target === currentTarget) return false;
    if (!currentTarget.contains(target)) return false;
    return isInteractiveControlTarget(target);
  }

  function updateCoachVisualByStep(step) {
    if (!els?.tutorialCoachDock) return;

    const isInteractive = isStepInteractive(step);
    const isManual = String(step?.advanceOn || "") === "manual";
    const manualDone = isManual && getCurrentStepCompletionState();
    const interactionLevel = getStepInteractionLevel(step);
    const isOptional = isInteractive && interactionLevel === "optional";
    const isRecommended = isInteractive && interactionLevel !== "optional";

    els.tutorialCoachDock.classList.toggle(
      "tutorial-coach--interactive",
      isInteractive,
    );
    els.tutorialCoachDock.classList.toggle("tutorial-coach--manual", isManual);
    els.tutorialCoachDock.classList.toggle(
      "tutorial-coach--manual-done",
      manualDone,
    );
    els.tutorialCoachDock.classList.toggle(
      "tutorial-coach--interactive-optional",
      isOptional,
    );
    els.tutorialCoachDock.classList.toggle(
      "tutorial-coach--interactive-recommended",
      isRecommended,
    );

    els.tutorialModeBackdrop?.classList.toggle(
      "tutorial-mode-backdrop--interactive",
      isInteractive,
    );
    els.tutorialModeBackdrop?.classList.toggle(
      "tutorial-mode-backdrop--interactive-optional",
      isOptional,
    );
    els.tutorialModeBackdrop?.classList.toggle(
      "tutorial-mode-backdrop--interactive-recommended",
      isRecommended,
    );

    els.tutorialCoachNextBtn?.classList.toggle(
      "tutorial-nav-btn--ready",
      manualDone,
    );

    if (els?.tutorialCoachHint && isManual && manualDone) {
      els.tutorialCoachHint.textContent =
        "Acción detectada. Ya puedes continuar cuando quieras con ▶.";
    }
  }

  function maybeMarkCurrentStepInteractionDone(event) {
    if (!tutorialState?.active) return;
    const step = tutorialState.steps?.[tutorialState.stepIndex];
    if (!step || String(step?.advanceOn || "") !== "manual") return;
    if (!eventMatchesManualCompletion(event, step)) return;

    const t = event?.target || null;
    if (!t) return;

    const currentTarget = resolveTutorialTarget(step);
    const allowedTargets = getCurrentStepAllowedInteractionTargets();

    let matched = false;
    if (currentTarget && (t === currentTarget || currentTarget.contains(t))) {
      if (
        step?.blockTargetControls &&
        t !== currentTarget &&
        isInteractiveControlTarget(t)
      ) {
        matched = false;
      } else {
        matched = true;
      }
    }
    if (!matched) {
      for (const extra of allowedTargets) {
        if (t === extra || extra.contains(t)) {
          matched = true;
          break;
        }
      }
    }
    if (!matched) return;

    if (!tutorialState.stepInteracted) tutorialState.stepInteracted = {};
    tutorialState.stepInteracted[String(tutorialState.stepIndex)] = true;
    updateCoachVisualByStep(step);
  }

  function isWithinVisibleKeyboardOverlay(target) {
    const node =
      target && typeof target.closest === "function"
        ? target.closest("#numPadOverlay, #qwertyOverlay")
        : null;
    if (!node) return false;
    return !node.classList.contains("hidden");
  }

  function isWithinVisiblePackOfferOverlay(target) {
    const node =
      target && typeof target.closest === "function"
        ? target.closest(".pack-modal-overlay")
        : null;
    if (!node) return false;
    return node.isConnected;
  }

  function isTutorialEscapeControl(target) {
    const node =
      target && typeof target.closest === "function"
        ? target.closest("button, [role='button'], .parked-close-btn, .pay-x")
        : null;
    if (!node) return false;

    const id = String(node.id || "").trim();
    if (id && TUTORIAL_ESCAPE_CONTROL_IDS.has(id)) return true;
    if (node.hasAttribute("data-tutorial-escape")) return true;
    return false;
  }

  function eventIsAllowedDuringTutorial(eventTarget) {
    if (!tutorialModeActive || !tutorialState?.active) return true;

    const t = eventTarget || null;
    if (!t) return false;

    if (els?.tutorialCoachDock && els.tutorialCoachDock.contains(t))
      return true;
    if (els?.tutorialHubOverlay && els.tutorialHubOverlay.contains(t))
      return true;
    if (isTutorialEscapeControl(t)) return true;
    if (isWithinVisibleKeyboardOverlay(t)) return true;
    if (isWithinVisiblePackOfferOverlay(t)) return true;

    const step = getCurrentStep();
    const currentTarget = getCurrentStepTarget();
    const allowedTargets = getCurrentStepAllowedInteractionTargets();

    if (!currentTarget && !allowedTargets.length) return false;

    if (currentTarget && (t === currentTarget || currentTarget.contains(t))) {
      if (isBlockedControlInteraction(t, step, currentTarget)) {
        return false;
      }
      return true;
    }

    for (const extra of allowedTargets) {
      if (t === extra || extra.contains(t)) return true;
    }

    return false;
  }

  function eventMatchesCurrentStepTarget(eventTarget, step) {
    const t = eventTarget || null;
    if (!t || !step) return false;

    const currentTarget = getCurrentStepTarget();
    if (currentTarget && (t === currentTarget || currentTarget.contains(t))) {
      return true;
    }

    const allowedTargets = getCurrentStepAllowedInteractionTargets();
    return allowedTargets.some((node) => t === node || node.contains(t));
  }

  function preventIfTutorialLocked(event) {
    if (!tutorialModeActive || !tutorialState?.active) return;

    if (event.type === "keydown" && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      finishTutorial({ completed: false });
      return;
    }

    const step = getCurrentStep();
    const currentTarget = getCurrentStepTarget();
    const blockedControlInteraction = isBlockedControlInteraction(
      event.target,
      step,
      currentTarget,
    );

    // En pasos de zona, bloquea controles internos pero permite avanzar
    // tocando dentro del área resaltada cuando el paso es de tipo click.
    if (blockedControlInteraction) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      if (
        step?.advanceOn === "click" &&
        String(event?.type || "").toLowerCase() === "click"
      ) {
        setTimeout(() => tutorialNextStep(), 0);
      }
      return;
    }

    if (eventIsAllowedDuringTutorial(event.target)) {
      if (
        step?.advanceOn === "click" &&
        String(event?.type || "").toLowerCase() === "click" &&
        eventMatchesCurrentStepTarget(event.target, step)
      ) {
        tutorialIgnoreClickAdvanceUntil = Date.now() + 350;
        setTimeout(() => tutorialNextStep(), 0);
        return;
      }

      maybeMarkCurrentStepInteractionDone(event);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  function bindTutorialInteractionLockOnce() {
    if (tutorialLockBound) return;
    tutorialLockBound = true;

    const types = [
      "pointerdown",
      "mousedown",
      "click",
      "change",
      "input",
      "keydown",
    ];
    types.forEach((type) => {
      document.addEventListener(type, preventIfTutorialLocked, true);
    });

    // Bloquea interacciones dentro del iframe de Mesas salvo en el objetivo del paso.
    const bindFrameDoc = () => {
      const frameDoc = getMesasInlineFrameDocument();
      if (!frameDoc || frameDoc.__tutorialLockBound) return;

      frameDoc.__tutorialLockBound = true;
      types.forEach((type) => {
        frameDoc.addEventListener(type, preventIfTutorialLocked, true);
      });
    };

    bindFrameDoc();
    window.addEventListener("focus", bindFrameDoc);
    document.addEventListener("click", bindFrameDoc, true);
  }

  function resolveTutorialTarget(step) {
    if (!step?.target) return null;
    return resolveTutorialTargetBySelector(step.target);
  }

  async function runTutorialStepEnterAction(step) {
    const action = String(step?.enterAction || "")
      .trim()
      .toLowerCase();
    if (!action) return;

    if (action === "ensure-mesas") {
      await api.switchToMesasMode?.().catch(() => {});
      return;
    }

    if (action === "view-transacciones") {
      maybeApplyMesasTutorialBaseState();
      api.setMesasInlineView?.("transacciones", { persist: false });
      return;
    }

    if (action === "view-mapa") {
      maybeApplyMesasTutorialBaseState();
      api.setMesasInlineView?.("mapa", { persist: false });
      return;
    }

    if (action === "view-diseno") {
      if (!isAdminUser()) {
        toast("El tutorial de diseño requiere usuario administrador.", "warn");
        return;
      }
      maybeApplyMesasTutorialBaseState();
      api.setMesasInlineView?.("diseno", { persist: false });
      return;
    }
  }

  function applyTutorialHighlight(target) {
    if (!target) return null;

    let outline = "";
    let outlineOffset = "";
    let boxShadow = "";
    let borderRadius = "";

    try {
      outline = target.style.outline || "";
      outlineOffset = target.style.outlineOffset || "";
      boxShadow = target.style.boxShadow || "";
      borderRadius = target.style.borderRadius || "";

      target.classList.add("tutorial-target-highlight");
      target.style.outline = "3px solid #f59e0b";
      target.style.outlineOffset = "2px";
      target.style.boxShadow = "0 0 0 4px rgba(245, 158, 11, 0.25)";
      target.style.borderRadius = target.style.borderRadius || "10px";
    } catch {}

    return {
      element: target,
      outline,
      outlineOffset,
      boxShadow,
      borderRadius,
    };
  }

  function applyTutorialHighlights(primaryTarget, extraSelectors = []) {
    const nodes = [];
    if (primaryTarget) nodes.push(primaryTarget);

    if (Array.isArray(extraSelectors)) {
      extraSelectors.forEach((selector) => {
        const node = resolveTutorialTargetBySelector(selector);
        if (node) nodes.push(node);
      });
    }

    const uniqueNodes = [];
    const seen = new Set();
    nodes.forEach((node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      uniqueNodes.push(node);
    });

    tutorialHighlightState = uniqueNodes
      .map((node) => applyTutorialHighlight(node))
      .filter(Boolean);
  }

  function runTutorialStepAutoAction(step) {
    const action = String(step?.advanceAction || "")
      .trim()
      .toLowerCase();

    const resolved = resolveTutorialTarget(step);
    const defaultClick = () => {
      if (!resolved || typeof resolved.click !== "function") return false;
      tutorialIgnoreClickAdvanceUntil = Date.now() + 350;
      resolved.click();
      return true;
    };

    if (!action || action === "click-target") {
      return defaultClick();
    }

    if (action === "noop") return true;

    if (action === "select-free-mesa") {
      const freeBtn = document.querySelector(
        "#mesasTransOtherTables .mts-table-btn.is-libre",
      );
      const anyBtn = document.querySelector(
        "#mesasTransOtherTables .mts-table-btn",
      );
      const fallbackFreeBtn = document.querySelector(
        "#mesasContextQuickSwitch .mesas-quick-btn.is-libre",
      );
      const fallbackAnyBtn = document.querySelector(
        "#mesasContextQuickSwitch .mesas-quick-btn",
      );
      const btn = freeBtn || anyBtn || fallbackFreeBtn || fallbackAnyBtn;
      if (!btn || typeof btn.click !== "function") return false;
      tutorialIgnoreClickAdvanceUntil = Date.now() + 350;
      btn.click();
      return true;
    }

    return defaultClick();
  }

  function rectsOverlap(a, b) {
    if (!a || !b) return false;
    return !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );
  }

  function placeCoachForTarget(target) {
    const dock = els?.tutorialCoachDock;
    if (!dock) return;

    dock.classList.remove("tutorial-coach--bottom");

    if (!target) return;

    try {
      const dockRect = dock.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (rectsOverlap(dockRect, targetRect)) {
        dock.classList.add("tutorial-coach--bottom");
      }
    } catch {}
  }

  function getMesasTutorialBasicsSteps() {
    const steps = [];

    if (!isMesasInlineActive()) {
      steps.push({
        title: "Entrar en Mesas",
        text: "Pulsa el botón de cambio de modo para entrar en Mesas.",
        target: ".agent-mode-switch-btn",
        advanceOn: "click",
      });
    }

    steps.push(
      {
        title: "Vista Transacciones",
        text: "La pestaña Transacciones es el centro del servicio: aquí seleccionas sala y mesa, añades productos y gestionas el ticket activo.",
        target: "#mesasInlineTabTransacciones",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Zona de productos",
        text: "En esta zona verás todos los productos disponibles para vender. Cada tarjeta representa un artículo y al pulsarlo se añade al ticket de la mesa seleccionada.",
        target: "#productsGrid",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Categorías rápidas",
        text: "La barra de categorías te ayuda a filtrar el catálogo para ir más rápido en horas punta (bebidas, bollería, etc.). Si pulsas una categoría activa de nuevo, se deselecciona y vuelves a ver todos los productos.",
        target: ".categories-wrapper",
        advanceOn: "manual",
        interactionLevel: "optional",
        enterAction: "view-transacciones",
      },
      {
        title: "Panel lateral de mesa",
        text: "En el lateral izquierdo ves la mesa seleccionada, su sala, estado y total actual. Este panel siempre te dice sobre qué mesa estás trabajando.",
        target: "#mesasTransSidebar",
        advanceOn: "click",
        interactionLevel: "recommended",
        blockTargetControls: true,
        enterAction: "view-transacciones",
      },
      {
        title: "Lista de otras mesas",
        text: "Aquí aparecen las demás mesas para cambiar rápido entre ellas y revisar estado. Los estados habituales son Libre, Ocupada, Reservada y Cuenta.",
        target: "#mesasTransOtherTables",
        advanceOn: "manual",
        interactionLevel: "recommended",
        enterAction: "view-transacciones",
      },
      {
        title: "Selecciona sala",
        text: "Este selector cambia la sala activa para mostrar solo sus mesas. Es útil cuando tienes varias zonas (terraza, interior, barra).",
        target: "#mesasContextRoomSelect",
        advanceOn: "manual",
        interactionLevel: "recommended",
        interactionCompleteOn: "change",
        enterAction: "view-transacciones",
      },
      {
        title: "Selecciona mesa",
        text: "Después eliges la mesa concreta. Todo lo que vendas, edites o consultes se aplicará al ticket de esta mesa.",
        target: "#mesasContextTableSelect",
        advanceOn: "manual",
        interactionLevel: "recommended",
        interactionCompleteOn: "change",
        enterAction: "view-transacciones",
      },
      {
        title: "Acciones rápidas",
        text: "Este bloque agrupa accesos directos para operar sin perder tiempo. En este paso solo verás la zona completa; toca cualquier punto de la zona resaltada para continuar.",
        target: "#mesasTransQuickActionsSection",
        advanceOn: "click",
        interactionLevel: "recommended",
        blockTargetControls: true,
        enterAction: "view-transacciones",
      },
      {
        title: "Tickets de la mesa",
        text: "Desde este botón abres el listado de tickets/pedidos de la mesa activa para revisar, recuperar o continuar operaciones.",
        target: "#mesasTransActionTickets",
        advanceOn: "manual",
        interactionLevel: "optional",
        allowInteractionSelectors: ["#parkedTicketsOverlay"],
        enterAction: "view-transacciones",
      },
      {
        title: "Comensales",
        text: "Con Personas ajustas el número de comensales de la mesa activa.",
        target: "#mesasTransActionPersonas",
        advanceOn: "manual",
        interactionLevel: "recommended",
        allowInteractionSelectors: ["#numPadOverlay"],
        enterAction: "view-transacciones",
      },
      {
        title: "Seleccionar mesa libre",
        text: "Para reservar, pulsa una mesa libre desde este bloque de cambio rápido para continuar.",
        stepKey: "select-free-mesa",
        target:
          "#mesasTransOtherTables .mts-table-btn.is-libre, #mesasContextQuickSwitch .mesas-quick-btn.is-libre, #mesasTransOtherTables .mts-table-btn, #mesasContextQuickSwitch .mesas-quick-btn",
        advanceOn: "click",
        interactionLevel: "recommended",
        allowInteractionSelectors: [
          "#mesasContextQuickSwitch .mesas-quick-btn.is-libre",
          "#mesasContextQuickSwitch .mesas-quick-btn",
          "#mesasTransOtherTables .mts-table-btn.is-libre",
          "#mesasTransOtherTables .mts-table-btn",
        ],
        enterAction: "view-transacciones",
      },
      {
        title: "Reserva de mesa",
        text: "Con una mesa libre seleccionada, aquí puedes activar reserva y abrir el panel para editar nombre y hora.",
        target: "#mesasTransReservaBox",
        advanceOn: "manual",
        interactionLevel: "recommended",
        allowInteractionSelectors: [
          "#mesasTransReservaToggleBtn",
          "#mesasTransReservaEnabled",
          "#mesasTransReservaName",
          "#mesasTransReservaTime",
          "#qwertyOverlay",
          "#numPadOverlay",
        ],
        enterAction: "view-transacciones",
      },
    );

    return steps;
  }

  function getMesasTutorialTicketsSteps() {
    const steps = [];

    if (!isMesasInlineActive()) {
      steps.push({
        title: "Entrar en Mesas",
        text: "Pulsa el botón de cambio de modo para abrir Mesas.",
        target: ".agent-mode-switch-btn",
        advanceOn: "click",
      });
    }

    steps.push(
      {
        title: "Vista Transacciones",
        text: "Esta vista se usa para servicio en vivo: productos, mesa activa y acciones rápidas.",
        target: "#mesasInlineTabTransacciones",
        advanceOn: "manual",
        interactionLevel: "recommended",
        enterAction: "view-transacciones",
      },
      {
        title: "Abrir tickets",
        text: "Pulsa Tickets para abrir la lista de pedidos de esa mesa y revisarlos.",
        target: "#mesasTransSidebar .mts-actions",
        advanceOn: "manual",
        interactionLevel: "optional",
        allowInteractionSelectors: ["#parkedTicketsOverlay"],
      },
      {
        title: "Cerrar ventana de tickets",
        text: "Cierra la ventana de tickets para volver al flujo principal.",
        target: "#parkedCloseBtn",
        advanceOn: "click",
      },
      {
        title: "Vista Mapa",
        text: "Pulsa Mapa de Salas para ver de un vistazo el estado visual y ocupación de cada mesa.",
        target: "#mesasInlineTabMapa",
        advanceOn: "manual",
        interactionLevel: "recommended",
      },
      {
        title: "Vista Diseñar Salas",
        text: "Pulsa Diseñar Salas para editar distribución, posiciones y estructura del plano.",
        target: "#mesasInlineTabDiseno",
        advanceOn: "manual",
        interactionLevel: "recommended",
      },
    );

    return steps;
  }

  function getMesasTutorialServiceSteps() {
    const steps = [];

    if (!isMesasInlineActive()) {
      steps.push({
        title: "Activar modo Mesas",
        text: "Entra a Mesas desde el cambio de modo.",
        target: ".agent-mode-switch-btn",
        advanceOn: "click",
      });
    }

    steps.push(
      {
        title: "Ir a Transacciones",
        text: "Trabaja en Transacciones para localizar sala y mesa.",
        target: "#mesasInlineTabTransacciones",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Sala del servicio",
        text: "Selecciona una sala para filtrar las mesas visibles.",
        target: "#mesasContextRoomSelect",
        advanceOn: "manual",
        interactionLevel: "recommended",
        interactionCompleteOn: "change",
      },
      {
        title: "Mesa del servicio",
        text: "Elige una mesa y revisa su ticket asociado.",
        target: "#mesasContextTableSelect",
        advanceOn: "manual",
        interactionLevel: "recommended",
        interactionCompleteOn: "change",
      },
      {
        title: "Abrir tickets de mesa",
        text: "Abre Tickets para consultar pedidos de la mesa sin cobrar ni guardar cambios.",
        target: "#mesasTransActionTickets",
        advanceOn: "manual",
        interactionLevel: "optional",
        allowInteractionSelectors: ["#parkedTicketsOverlay"],
      },
    );

    return steps;
  }

  function getMesasTutorialRoomsSteps() {
    const steps = [];

    if (!isMesasInlineActive()) {
      steps.push({
        title: "Entrar en Mesas",
        text: "Pulsa el cambio de modo para entrar en Mesas.",
        target: ".agent-mode-switch-btn",
        advanceOn: "click",
      });
    }

    steps.push(
      {
        title: "Abrir Diseño",
        text: "En Diseño gestionas salas y estructura del local.",
        target: "#mesasInlineTabDiseno",
        advanceOn: "click",
        enterAction: "view-diseno",
      },
      {
        title: "Crear sala",
        text: "Este botón crea una sala nueva. Con Siguiente te llevo al control siguiente sin crear datos automáticamente.",
        target: "iframe:#designAddRoomBtn",
        advanceOn: "click",
        advanceAction: "noop",
        enterAction: "view-diseno",
      },
      {
        title: "Renombrar sala",
        text: "Aquí renombras la sala activa. Si quieres practicar, haz clic manualmente.",
        target: "iframe:#designRenameRoomBtn",
        advanceOn: "click",
        advanceAction: "noop",
        enterAction: "view-diseno",
      },
      {
        title: "Borrar sala",
        text: "Este botón borra la sala activa. En tutorial solo te mostramos dónde está.",
        target: "iframe:#designDeleteRoomBtn",
        advanceOn: "click",
        advanceAction: "noop",
        enterAction: "view-diseno",
      },
    );

    return steps;
  }

  function getMesasTutorialDesignTablesSteps() {
    const steps = [];

    if (!isMesasInlineActive()) {
      steps.push({
        title: "Entrar en Mesas",
        text: "Pulsa el cambio de modo para entrar en Mesas.",
        target: ".agent-mode-switch-btn",
        advanceOn: "click",
      });
    }

    steps.push(
      {
        title: "Vista Diseño",
        text: "Abrimos Diseño para crear y ajustar mesas.",
        target: "#mesasInlineTabDiseno",
        advanceOn: "click",
        enterAction: "view-diseno",
      },
      {
        title: "Herramienta de mesa",
        text: "Selecciona esta herramienta para colocar una mesa en el plano.",
        target: "iframe:.tool-btn[data-tool='mesa-redonda']",
        advanceOn: "click",
        enterAction: "view-diseno",
      },
      {
        title: "Lienzo de plano",
        text: "Haz clic en el lienzo para crear la mesa con la herramienta seleccionada.",
        target: "iframe:#designCanvas",
        advanceOn: "click",
        enterAction: "view-diseno",
      },
      {
        title: "Panel de propiedades",
        text: "Al seleccionar una mesa, aquí editas nombre, comensales y capacidad.",
        target: "iframe:#designSelectionPanel",
        advanceOn: "click",
        advanceAction: "noop",
        enterAction: "view-diseno",
      },
    );

    return steps;
  }

  function getMesasTutorialReservaSteps() {
    const steps = [];

    if (!isMesasInlineActive()) {
      steps.push({
        title: "Entrar en Mesas",
        text: "Pulsa el cambio de modo para entrar en Mesas.",
        target: ".agent-mode-switch-btn",
        advanceOn: "click",
      });
    }

    steps.push(
      {
        title: "Ir a Transacciones",
        text: "Abre Transacciones para operar sobre una mesa activa.",
        target: "#mesasInlineTabTransacciones",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Seleccionar mesa libre",
        text: "Primero selecciona una mesa libre. Sin mesa activa no podrás crear la reserva.",
        stepKey: "select-free-mesa",
        target:
          "#mesasTransOtherTables .mts-table-btn.is-libre, #mesasContextQuickSwitch .mesas-quick-btn.is-libre, #mesasTransOtherTables .mts-table-btn, #mesasContextQuickSwitch .mesas-quick-btn",
        advanceOn: "click",
        interactionLevel: "recommended",
        allowInteractionSelectors: [
          "#mesasContextQuickSwitch .mesas-quick-btn.is-libre",
          "#mesasContextQuickSwitch .mesas-quick-btn",
          "#mesasTransOtherTables .mts-table-btn.is-libre",
          "#mesasTransOtherTables .mts-table-btn",
        ],
        enterAction: "view-transacciones",
      },
      {
        title: "Botón de reserva",
        text: "Desde aquí abres el panel de reserva para mesa y hora.",
        target: "#mesasTransReservaToggleBtn",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Panel de reserva",
        text: "Aquí introduces nombre y hora de la reserva de forma guiada.",
        target: "#mesasTransReservaPanel",
        advanceOn: "click",
        advanceAction: "noop",
        enterAction: "view-transacciones",
      },
      {
        title: "Reservar en Mapa y Diseño",
        text: "También puedes reservar desde Mapa o Diseño: entra en una de esas vistas, selecciona una mesa libre y usa el control de reserva de la barra lateral.",
        target: "#mesasInlineTabsRow",
        advanceOn: "manual",
        interactionLevel: "recommended",
      },
      {
        title: "Control de personas",
        text: "Ajusta personas para reflejar comensales de la mesa.",
        target: "#mesasTransActionPersonas",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
    );

    return steps;
  }

  function getMesasTutorialContextSteps() {
    const steps = [];

    if (!isMesasInlineActive()) {
      steps.push({
        title: "Entrar en Mesas",
        text: "Pulsa el cambio de modo para entrar en Mesas.",
        target: ".agent-mode-switch-btn",
        advanceOn: "click",
      });
    }

    steps.push(
      {
        title: "Selector de sala",
        text: "Primero define la sala para acotar las mesas visibles.",
        target: "#mesasContextRoomSelect",
        advanceOn: "manual",
        interactionLevel: "recommended",
        interactionCompleteOn: "change",
        enterAction: "view-transacciones",
      },
      {
        title: "Selector de mesa",
        text: "Después elige la mesa concreta sobre la que operar.",
        target: "#mesasContextTableSelect",
        advanceOn: "manual",
        interactionLevel: "recommended",
        interactionCompleteOn: "change",
        enterAction: "view-transacciones",
      },
      {
        title: "Cambio rápido",
        text: "Usa este acceso para ir al siguiente contexto de forma ágil.",
        target: "#mesasContextQuickSwitch",
        advanceOn: "manual",
        enterAction: "view-transacciones",
      },
      {
        title: "Tarjeta de mesa actual",
        text: "Aquí confirmas estado, sala y total de la mesa activa.",
        target: ".mts-selected-card",
        advanceOn: "click",
        advanceAction: "noop",
        enterAction: "view-transacciones",
      },
    );

    return steps;
  }

  function getTpvTutorialBasicsSteps() {
    return [
      {
        title: "Categorías",
        text: "Empieza filtrando por categoría para encontrar productos rápido.",
        target: ".categories-wrapper",
        advanceOn: "manual",
        interactionLevel: "optional",
      },
      {
        title: "Productos",
        text: "Pulsa un producto para añadirlo al ticket actual.",
        target: "#productsGrid",
        advanceOn: "click",
      },
      {
        title: "Lineas del ticket",
        text: "Aquí se reflejan cantidades, precios y líneas de venta.",
        advanceOn: "manual",
        interactionLevel: "recommended",
        allowInteractionSelectors: ["#numPadOverlay"],
        advanceOn: "click",
        advanceAction: "noop",
      },
      {
        title: "Botón Cobrar",
        text: "Cuando el pedido esté listo, continúa con Cobrar.",
        target: "#payBtn",
        advanceOn: "click",
      },
    ];
  }

  function getTpvTutorialTicketsSteps() {
    return [
      {
        title: "Abrir Tickets",
        text: "Pulsa Tickets para consultar el histórico.",
        target: "#ticketsListBtn",
        advanceOn: "click",
      },
      {
        title: "Buscador",
        text: "Filtra por texto o número para localizar tickets rápido.",
        target: "#ticketsSearch",
        advanceOn: "click",
      },
      {
        title: "Pestañas de listado",
        text: "Cambia entre tickets de caja actual y otras cajas.",
        target: "#ticketsTabOther",
        advanceOn: "click",
      },
      {
        title: "Cerrar listado",
        text: "Vuelve al TPV principal para seguir cobrando.",
        target: "#ticketsCloseBtn",
        advanceOn: "click",
      },
    ];
  }

  function getTpvTutorialChargeSteps() {
    return [
      {
        title: "Abrir Cobro",
        text: "Pulsa Cobrar para abrir el panel de pago.",
        target: "#payBtn",
        advanceOn: "click",
      },
      {
        title: "Métodos de pago",
        text: "Selecciona el método de pago adecuado para el cliente.",
        target: "#payMethodsList",
        advanceOn: "click",
      },
      {
        title: "Número del documento",
        text: "Completa los datos del cobro cuando corresponda.",
        target: "#payNumber",
        advanceOn: "click",
      },
      {
        title: "Cancelar y volver",
        text: "Este botón cierra el panel sin finalizar cobro para practicar sin riesgo.",
        target: "#payCancelBtn",
        advanceOn: "click",
      },
    ];
  }

  const tutorialCatalog = {
    tpvBasics: {
      title: "Apertura rápida del TPV",
      family: "tpv",
      buildSteps: getTpvTutorialBasicsSteps,
    },
    tpvTickets: {
      title: "Tickets y búsqueda",
      family: "tpv",
      buildSteps: getTpvTutorialTicketsSteps,
    },
    tpvCharge: {
      title: "Cobro y cierre de venta",
      family: "tpv",
      buildSteps: getTpvTutorialChargeSteps,
    },
    mesasBasics: {
      title: "Primeros pasos en Mesas",
      family: "mesas",
      buildSteps: getMesasTutorialBasicsSteps,
    },
    mesasTickets: {
      title: "Tickets de mesa y vistas",
      family: "mesas",
      buildSteps: getMesasTutorialTicketsSteps,
    },
    mesasService: {
      title: "Flujo de servicio seguro",
      family: "mesas",
      buildSteps: getMesasTutorialServiceSteps,
    },
    mesasContext: {
      title: "Contexto rápido: sala y mesa",
      family: "mesas",
      buildSteps: getMesasTutorialContextSteps,
    },
    mesasRooms: {
      title: "Salas: crear y renombrar",
      family: "mesas",
      buildSteps: getMesasTutorialRoomsSteps,
    },
    mesasDesignTables: {
      title: "Mesas: crear y propiedades",
      family: "mesas",
      buildSteps: getMesasTutorialDesignTablesSteps,
    },
    mesasReserva: {
      title: "Reservas y personas",
      family: "mesas",
      buildSteps: getMesasTutorialReservaSteps,
    },
  };

  function scrollTutorialTargetIntoView(target) {
    if (!target) return;
    try {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {}
  }

  async function renderTutorialStep({ runEnterAction = true } = {}) {
    if (!tutorialState?.active || !els) return;

    clearTutorialHighlight();

    const step = tutorialState.steps[tutorialState.stepIndex];
    if (!step) {
      finishTutorial({ completed: true });
      return;
    }

    refreshDynamicSelectFreeMesaStep(step);

    if (runEnterAction) {
      await runTutorialStepEnterAction(step);
    }

    if (els.tutorialCoachTitle) {
      const interactiveTag = isStepInteractive(step) ? " · Interactivo" : "";
      els.tutorialCoachTitle.textContent = `${tutorialState.title} (${tutorialState.stepIndex + 1}/${tutorialState.steps.length}${interactiveTag})`;
    }

    if (els.tutorialCoachText)
      els.tutorialCoachText.textContent = step.text || "";

    updateCoachVisualByStep(step);

    const target = resolveTutorialTarget(step);
    placeCoachForTarget(target);

    if (target) {
      if (tutorialState?.stepRetryCount) {
        tutorialState.stepRetryCount[String(tutorialState.stepIndex)] = 0;
      }

      applyTutorialHighlights(target, step?.highlightSelectors);
      scrollTutorialTargetIntoView(target);

      // Reaplica resaltado de mesa libre si una actualización externa repinta el bloque.
      if (step?.stepKey === "select-free-mesa") {
        scheduleTutorialStepRefresh(900);
      }

      if (els.tutorialCoachHint) {
        const levelLabel =
          getStepInteractionLevel(step) === "optional"
            ? "Interacción opcional"
            : "Interacción recomendada";

        els.tutorialCoachHint.textContent =
          step.advanceOn === "click"
            ? `${levelLabel}: puedes pulsar el elemento resaltado para avanzar automático, o usar ▶ para saltar este paso.`
            : step.advanceOn === "manual"
              ? `${levelLabel}: prueba los controles resaltados y avanza cuando quieras con ▶.`
              : "Continúa con ▶.";
      }
    } else if (els.tutorialCoachHint) {
      els.tutorialCoachHint.textContent =
        "Elemento no visible en este momento. Puedes continuar con ▶.";
      if (step?.target && String(step.target).startsWith("iframe:")) {
        const retryKey = String(tutorialState.stepIndex);
        const retries =
          Number(tutorialState?.stepRetryCount?.[retryKey] || 0) || 0;

        if (tutorialState?.stepRetryCount) {
          tutorialState.stepRetryCount[retryKey] = retries + 1;
        }

        if (retries < 4) scheduleTutorialStepRefresh(300);
      }
    }

    if (els.tutorialCoachPrevBtn) {
      els.tutorialCoachPrevBtn.disabled = tutorialState.stepIndex <= 0;
    }

    if (els.tutorialCoachNextBtn) {
      els.tutorialCoachNextBtn.textContent =
        tutorialState.stepIndex >= tutorialState.steps.length - 1 ? "✓" : "▶";
    }

    updateCoachVisualByStep(step);
  }

  function finishTutorial({ completed = false } = {}) {
    const wasMesasTutorial =
      String(tutorialState?.tutorialFamily || "") === "mesas";
    if (tutorialRenderRetryTimer) {
      clearTimeout(tutorialRenderRetryTimer);
      tutorialRenderRetryTimer = null;
    }

    clearTutorialHighlight();
    tutorialModeActive = false;
    if (tutorialState?.active) {
      if (completed) {
        clearTutorialProgress();
      } else {
        saveTutorialProgress();
      }
    }
    tutorialState = null;
    setTutorialActiveFlag(false);
    document.body.classList.remove("tutorial-mode-active");
    els?.tutorialModeBackdrop?.classList.add("hidden");
    els?.tutorialCoachDock?.classList.add("hidden");
    els?.tutorialCoachDock?.classList.remove(
      "tutorial-coach--interactive",
      "tutorial-coach--manual",
      "tutorial-coach--manual-done",
      "tutorial-coach--interactive-optional",
      "tutorial-coach--interactive-recommended",
    );
    els?.tutorialModeBackdrop?.classList.remove(
      "tutorial-mode-backdrop--interactive",
      "tutorial-mode-backdrop--interactive-optional",
      "tutorial-mode-backdrop--interactive-recommended",
    );
    els?.tutorialCoachNextBtn?.classList.remove("tutorial-nav-btn--ready");
    els?.tutorialResumeOverlay?.classList.add("hidden");
    pendingResumeChoice = null;

    api.endTutorialBlankMode?.();
    restoreDemoSnapshot();
    restoreMesasBackupIfPending();
    if (wasMesasTutorial) {
      api.refreshMesasLayoutFromRemoteNow?.()?.catch?.(() => {});
    }
    if (completed) {
      toast("Tutorial finalizado.", "ok");
    } else {
      toast("Tutorial cerrado. Puedes reanudarlo más tarde.", "info");
    }
  }

  function closeTutorialHub() {
    els?.tutorialHubOverlay?.classList.add("hidden");
  }

  function getSavedHubMode() {
    try {
      const raw = String(
        localStorage.getItem(TUTORIAL_HUB_MODE_KEY) || "",
      ).trim();
      return raw === "mesas" ? "mesas" : "tpv";
    } catch {
      return "tpv";
    }
  }

  function setSavedHubMode(mode) {
    try {
      localStorage.setItem(
        TUTORIAL_HUB_MODE_KEY,
        mode === "mesas" ? "mesas" : "tpv",
      );
    } catch {}
  }

  function setTutorialHubMode(mode, { persist = true } = {}) {
    const mesasEnabled = isMesasModuleEnabled();
    let nextMode = mode === "mesas" ? "mesas" : "tpv";
    if (nextMode === "mesas" && !mesasEnabled) nextMode = "tpv";

    tutorialHubMode = nextMode;
    if (persist) setSavedHubMode(nextMode);

    if (els?.tutorialModeTPVBtn) {
      els.tutorialModeTPVBtn.classList.toggle("is-active", nextMode === "tpv");
      els.tutorialModeTPVBtn.setAttribute(
        "aria-selected",
        nextMode === "tpv" ? "true" : "false",
      );
    }

    if (els?.tutorialModeMesasBtn) {
      els.tutorialModeMesasBtn.classList.toggle(
        "is-active",
        nextMode === "mesas",
      );
      els.tutorialModeMesasBtn.setAttribute(
        "aria-selected",
        nextMode === "mesas" ? "true" : "false",
      );
    }

    els?.tutorialListTPV?.classList.toggle("hidden", nextMode !== "tpv");
    els?.tutorialListMesas?.classList.toggle("hidden", nextMode !== "mesas");
  }

  function refreshTutorialHubAvailability() {
    const mesasEnabled = isMesasModuleEnabled();

    if (els?.tutorialModeMesasBtn) {
      els.tutorialModeMesasBtn.classList.toggle("hidden", !mesasEnabled);
    }

    if (els?.tutorialMesasBasicsBtn)
      els.tutorialMesasBasicsBtn.disabled = !mesasEnabled;
    if (els?.tutorialMesasTicketsBtn)
      els.tutorialMesasTicketsBtn.disabled = !mesasEnabled;
    if (els?.tutorialMesasServiceBtn)
      els.tutorialMesasServiceBtn.disabled = !mesasEnabled;
    if (els?.tutorialMesasContextBtn)
      els.tutorialMesasContextBtn.disabled = !mesasEnabled;
    if (els?.tutorialMesasRoomsBtn)
      els.tutorialMesasRoomsBtn.disabled = !mesasEnabled;
    if (els?.tutorialMesasDesignTablesBtn) {
      els.tutorialMesasDesignTablesBtn.disabled = !mesasEnabled;
    }
    if (els?.tutorialMesasReservaBtn)
      els.tutorialMesasReservaBtn.disabled = !mesasEnabled;

    if (els?.tutorialMesasStatus) {
      els.tutorialMesasStatus.textContent = mesasEnabled
        ? "Disponible en este terminal."
        : "No disponible: módulo Mesas desactivado para este cliente.";
    }

    if (els?.tutorialTpvStatus) {
      els.tutorialTpvStatus.textContent = "Disponible en este terminal.";
    }

    if (!mesasEnabled && tutorialHubMode === "mesas") {
      setTutorialHubMode("tpv", { persist: true });
    }
  }

  function openTutorialHub() {
    setTutorialHubMode(getSavedHubMode(), { persist: false });
    refreshTutorialHubAvailability();
    els?.tutorialHubOverlay?.classList.remove("hidden");
  }

  function startTutorial(tutorialId, opts = {}) {
    const tutorialDef = tutorialCatalog[tutorialId];
    if (!tutorialDef || !els) return;

    const steps = tutorialDef.buildSteps();
    if (!Array.isArray(steps) || !steps.length) {
      toast("Este tutorial no tiene pasos disponibles.", "info");
      return;
    }

    closeTutorialHub();
    api.closeOptions?.();

    if (tutorialDef.family === "mesas" && !tutorialDemoSnapshot) {
      tutorialDemoSnapshot = captureDemoSnapshot();
      savePersistentDemoSnapshot(tutorialDemoSnapshot);
      toast("Modo demo temporal activado para Mesas.", "info");
    }

    if (tutorialDef.family === "mesas") {
      saveMesasBackupBeforeTutorial();
    }

    api.beginTutorialBlankMode?.();

    if (tutorialDef.family === "mesas") {
      applyMesasTutorialBaseState();
    }

    const wantedStep = Math.max(0, Number(opts?.stepIndex || 0) || 0);
    const boundedStep = Math.min(wantedStep, Math.max(0, steps.length - 1));

    tutorialModeActive = true;
    tutorialState = {
      active: true,
      tutorialId,
      tutorialFamily: String(tutorialDef.family || ""),
      title: tutorialDef.title,
      stepIndex: boundedStep,
      steps,
      stepRetryCount: {},
      stepInteracted: {},
    };

    saveTutorialProgress();
    setTutorialActiveFlag(true);

    document.body.classList.add("tutorial-mode-active");
    els.tutorialModeBackdrop?.classList.remove("hidden");
    els.tutorialCoachDock?.classList.remove("hidden");
    void renderTutorialStep();
  }

  function openResumeModalForTutorial(tutorialId, progress) {
    if (!els || !progress || !tutorialCatalog[tutorialId]) return;

    pendingResumeChoice = {
      tutorialId,
      stepIndex: Math.max(0, Number(progress.stepIndex || 0) || 0),
    };

    const total = Array.isArray(tutorialCatalog[tutorialId].buildSteps?.())
      ? tutorialCatalog[tutorialId].buildSteps().length
      : 0;
    const stepLabel = pendingResumeChoice.stepIndex + 1;
    const title = tutorialCatalog[tutorialId].title;

    if (els.tutorialResumeText) {
      els.tutorialResumeText.textContent =
        `Se detecto un tutorial incompleto:\n"${title}"\n\n` +
        `Lo dejaste en el paso ${stepLabel}${total ? ` de ${total}` : ""}.\n\n` +
        "Reanudar: vuelve al paso donde te quedaste.\n" +
        "Empezar de nuevo: arranca desde el primer paso.\n" +
        "Cancelar: cierra este aviso y no inicia ningún tutorial.";
    }

    els.tutorialResumeOverlay?.classList.remove("hidden");
  }

  function closeResumeModal() {
    pendingResumeChoice = null;
    els?.tutorialResumeOverlay?.classList.add("hidden");
  }

  function requestStartTutorial(tutorialId) {
    const def = tutorialCatalog[tutorialId];
    if (!def) return;

    if (def.family === "mesas" && !isMesasModuleEnabled()) {
      toast("El módulo Mesas no está disponible en este terminal.", "warn");
      return;
    }

    const progress = hasPendingProgressForTutorial(tutorialId);
    if (progress) {
      openResumeModalForTutorial(tutorialId, progress);
      return;
    }

    startTutorial(tutorialId, { stepIndex: 0 });
  }

  function acceptResumeTutorial() {
    const pending = pendingResumeChoice;
    if (!pending || !tutorialCatalog[pending.tutorialId]) {
      closeResumeModal();
      return;
    }

    closeResumeModal();
    startTutorial(pending.tutorialId, { stepIndex: pending.stepIndex });
  }

  function restartTutorialFromBeginning() {
    const pending = pendingResumeChoice;
    if (!pending || !tutorialCatalog[pending.tutorialId]) {
      closeResumeModal();
      return;
    }

    const tutorialId = pending.tutorialId;
    clearTutorialProgress();
    closeResumeModal();
    startTutorial(tutorialId, { stepIndex: 0 });
  }

  function tutorialNextStep() {
    if (!tutorialState?.active) return;

    const currentStep = tutorialState.steps[tutorialState.stepIndex];
    if (currentStep?.applyActionOnNext === true) {
      runTutorialStepAutoAction(currentStep);
    }

    if (tutorialState.stepIndex >= tutorialState.steps.length - 1) {
      finishTutorial({ completed: true });
      return;
    }

    tutorialState.stepIndex += 1;
    if (tutorialState?.stepInteracted) {
      delete tutorialState.stepInteracted[String(tutorialState.stepIndex)];
    }
    saveTutorialProgress();
    void renderTutorialStep();
  }

  function tutorialPrevStep() {
    if (!tutorialState?.active) return;
    if (tutorialState.stepIndex <= 0) return;
    tutorialState.stepIndex -= 1;
    if (tutorialState?.stepInteracted) {
      delete tutorialState.stepInteracted[String(tutorialState.stepIndex)];
    }
    saveTutorialProgress();
    void renderTutorialStep();
  }

  function bindGlobalClickAdvance() {
    document.addEventListener(
      "click",
      (e) => {
        if (!tutorialModeActive || !tutorialState?.active) return;
        if (Date.now() < tutorialIgnoreClickAdvanceUntil) return;

        if (els?.tutorialCoachDock && els.tutorialCoachDock.contains(e.target))
          return;

        const step = tutorialState.steps[tutorialState.stepIndex];
        if (!step || step.advanceOn !== "click") return;

        const target = resolveTutorialTarget(step);
        const allowedTargets = getCurrentStepAllowedInteractionTargets();

        const matchesPrimary =
          !!target && (target === e.target || target.contains(e.target));
        const matchesAllowed = allowedTargets.some(
          (node) => node === e.target || node.contains(e.target),
        );

        if (matchesPrimary || matchesAllowed) {
          setTimeout(() => tutorialNextStep(), 0);
        }
      },
      true,
    );
  }

  function collectElements() {
    els = {
      optionsTutorialBtn: document.getElementById("optionsTutorialBtn"),
      tutorialHubOverlay: document.getElementById("tutorialHubOverlay"),
      tutorialHubCloseX: document.getElementById("tutorialHubCloseX"),
      tutorialHubCloseBtn: document.getElementById("tutorialHubCloseBtn"),
      tutorialModeTPVBtn: document.getElementById("tutorialModeTPVBtn"),
      tutorialModeMesasBtn: document.getElementById("tutorialModeMesasBtn"),
      tutorialListTPV: document.getElementById("tutorialListTPV"),
      tutorialListMesas: document.getElementById("tutorialListMesas"),
      tutorialTpvStatus: document.getElementById("tutorialTpvStatus"),
      tutorialTpvBasicsBtn: document.getElementById("tutorialTpvBasicsBtn"),
      tutorialTpvTicketsBtn: document.getElementById("tutorialTpvTicketsBtn"),
      tutorialTpvChargeBtn: document.getElementById("tutorialTpvChargeBtn"),
      tutorialMesasStatus: document.getElementById("tutorialMesasStatus"),
      tutorialMesasBasicsBtn: document.getElementById("tutorialMesasBasicsBtn"),
      tutorialMesasTicketsBtn: document.getElementById(
        "tutorialMesasTicketsBtn",
      ),
      tutorialMesasServiceBtn: document.getElementById(
        "tutorialMesasServiceBtn",
      ),
      tutorialMesasContextBtn: document.getElementById(
        "tutorialMesasContextBtn",
      ),
      tutorialMesasRoomsBtn: document.getElementById("tutorialMesasRoomsBtn"),
      tutorialMesasDesignTablesBtn: document.getElementById(
        "tutorialMesasDesignTablesBtn",
      ),
      tutorialMesasReservaBtn: document.getElementById(
        "tutorialMesasReservaBtn",
      ),
      tutorialModeBackdrop: document.getElementById("tutorialModeBackdrop"),
      tutorialCoachDock: document.getElementById("tutorialCoachDock"),
      tutorialCoachTitle: document.getElementById("tutorialCoachTitle"),
      tutorialCoachText: document.getElementById("tutorialCoachText"),
      tutorialCoachHint: document.getElementById("tutorialCoachHint"),
      tutorialCoachPrevBtn: document.getElementById("tutorialCoachPrevBtn"),
      tutorialCoachNextBtn: document.getElementById("tutorialCoachNextBtn"),
      tutorialCoachCloseBtn: document.getElementById("tutorialCoachCloseBtn"),
      tutorialResumeOverlay: document.getElementById("tutorialResumeOverlay"),
      tutorialResumeText: document.getElementById("tutorialResumeText"),
      tutorialResumeYesBtn: document.getElementById("tutorialResumeYesBtn"),
      tutorialResumeNoBtn: document.getElementById("tutorialResumeNoBtn"),
      tutorialResumeCancelBtn: document.getElementById(
        "tutorialResumeCancelBtn",
      ),
    };
  }

  function bindUiEvents() {
    if (!els) return;

    els.optionsTutorialBtn?.addEventListener("click", openTutorialHub);

    els.tutorialHubCloseX?.addEventListener("click", closeTutorialHub);
    els.tutorialHubCloseBtn?.addEventListener("click", closeTutorialHub);

    els.tutorialModeTPVBtn?.addEventListener("click", () =>
      setTutorialHubMode("tpv", { persist: true }),
    );
    els.tutorialModeMesasBtn?.addEventListener("click", () =>
      setTutorialHubMode("mesas", { persist: true }),
    );

    els.tutorialTpvBasicsBtn?.addEventListener("click", () =>
      requestStartTutorial("tpvBasics"),
    );
    els.tutorialTpvTicketsBtn?.addEventListener("click", () =>
      requestStartTutorial("tpvTickets"),
    );
    els.tutorialTpvChargeBtn?.addEventListener("click", () =>
      requestStartTutorial("tpvCharge"),
    );

    els.tutorialMesasBasicsBtn?.addEventListener("click", () =>
      requestStartTutorial("mesasBasics"),
    );
    els.tutorialMesasTicketsBtn?.addEventListener("click", () =>
      requestStartTutorial("mesasTickets"),
    );
    els.tutorialMesasServiceBtn?.addEventListener("click", () =>
      requestStartTutorial("mesasService"),
    );
    els.tutorialMesasContextBtn?.addEventListener("click", () =>
      requestStartTutorial("mesasContext"),
    );
    els.tutorialMesasRoomsBtn?.addEventListener("click", () =>
      requestStartTutorial("mesasRooms"),
    );
    els.tutorialMesasDesignTablesBtn?.addEventListener("click", () =>
      requestStartTutorial("mesasDesignTables"),
    );
    els.tutorialMesasReservaBtn?.addEventListener("click", () =>
      requestStartTutorial("mesasReserva"),
    );

    els.tutorialCoachCloseBtn?.addEventListener("click", () =>
      finishTutorial({ completed: false }),
    );
    els.tutorialCoachPrevBtn?.addEventListener("click", tutorialPrevStep);
    els.tutorialCoachNextBtn?.addEventListener("click", tutorialNextStep);

    els.tutorialResumeYesBtn?.addEventListener("click", acceptResumeTutorial);
    els.tutorialResumeNoBtn?.addEventListener(
      "click",
      restartTutorialFromBeginning,
    );
    els.tutorialResumeCancelBtn?.addEventListener("click", closeResumeModal);

    els.tutorialResumeOverlay?.addEventListener("click", (e) => {
      if (e.target === els.tutorialResumeOverlay) closeResumeModal();
    });

    els.tutorialHubOverlay?.addEventListener("click", (e) => {
      if (e.target === els.tutorialHubOverlay) closeTutorialHub();
    });
  }

  async function ensureTutorialDom() {
    if (document.getElementById("tutorialHubOverlay")) return;

    let html = "";
    try {
      const res = await fetch("tutoriales/tutoriales.html", {
        cache: "no-store",
      });
      if (res.ok) html = await res.text();
    } catch {}

    if (!String(html || "").trim()) {
      html = FALLBACK_HTML;
    }

    const mount = document.getElementById("tutorialesMount") || document.body;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;

    while (wrapper.firstChild) {
      mount.appendChild(wrapper.firstChild);
    }
  }

  async function initTutoriales() {
    restoreDemoSnapshotIfCrashedBefore();
    await ensureTutorialDom();
    collectElements();
    bindUiEvents();
    bindTutorialInteractionLockOnce();
    bindGlobalClickAdvance();
  }

  void initTutoriales();
})();
