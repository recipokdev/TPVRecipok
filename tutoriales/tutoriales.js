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

    return {
      createdAt: Date.now(),
      entries,
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
    if (!snap) return;

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

      window.dispatchEvent(
        new StorageEvent("storage", { key: "tpv_tables_state_v3" }),
      );
      toast("Demo restaurada: se recupero el estado real de Mesas.", "ok");
    } catch (err) {
      console.warn("[TUTORIALES] No se pudo restaurar snapshot demo:", err);
      toast("No se pudo restaurar automaticamente la demo.", "warn");
    }

    tutorialDemoSnapshot = null;
    savePersistentDemoSnapshot(null);
  }

  function restoreDemoSnapshotIfCrashedBefore() {
    const pending = loadPersistentDemoSnapshot();
    if (!pending) return;

    tutorialDemoSnapshot = pending;
    restoreDemoSnapshot();
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

    const el = tutorialHighlightState?.element || null;
    if (el) {
      try {
        el.classList.remove("tutorial-target-highlight");
      } catch {}

      try {
        el.style.outline = tutorialHighlightState.outline || "";
        el.style.outlineOffset = tutorialHighlightState.outlineOffset || "";
        el.style.boxShadow = tutorialHighlightState.boxShadow || "";
        el.style.borderRadius = tutorialHighlightState.borderRadius || "";
      } catch {}
    }

    tutorialHighlightState = null;
  }

  function getCurrentStepTarget() {
    if (!tutorialState?.active) return null;
    const step = tutorialState.steps?.[tutorialState.stepIndex];
    return resolveTutorialTarget(step);
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

    const currentTarget = getCurrentStepTarget();
    if (!currentTarget) return false;

    return t === currentTarget || currentTarget.contains(t);
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

    if (eventIsAllowedDuringTutorial(event.target)) return;

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

    const rawTarget = String(step.target || "").trim();
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
      api.setMesasInlineView?.("transacciones", { persist: false });
      return;
    }

    if (action === "view-mapa") {
      api.setMesasInlineView?.("mapa", { persist: false });
      return;
    }

    if (action === "view-diseno") {
      if (!isAdminUser()) {
        toast("El tutorial de diseno requiere usuario administrador.", "warn");
        return;
      }
      api.setMesasInlineView?.("diseno", { persist: false });
      return;
    }
  }

  function applyTutorialHighlight(target) {
    if (!target) return;

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

    tutorialHighlightState = {
      element: target,
      outline,
      outlineOffset,
      boxShadow,
      borderRadius,
    };
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
        text: "Pulsa el boton de cambio de modo para entrar en Mesas.",
        target: ".agent-mode-switch-btn",
        advanceOn: "click",
      });
    }

    steps.push(
      {
        title: "Vista Transacciones",
        text: "La pestana Transacciones es el centro del servicio: aqui seleccionas sala y mesa, anades productos y gestionas el ticket activo.",
        target: "#mesasInlineTabTransacciones",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Zona de productos",
        text: "En esta zona veras todos los productos disponibles para vender. Cada tarjeta representa un articulo y al pulsarlo se anade al ticket de la mesa seleccionada.",
        target: "#productsGrid",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Categorias rapidas",
        text: "La barra de categorias te ayuda a filtrar el catalogo para ir mas rapido en horas punta (bebidas, bolleria, etc.).",
        target: ".categories-wrapper",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Panel lateral de mesa",
        text: "En el lateral izquierdo ves la mesa seleccionada, su sala, estado y total actual. Este panel siempre te dice sobre que mesa estas trabajando.",
        target: "#mesasTransSidebar",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Lista de otras mesas",
        text: "Aqui aparecen las demas mesas para cambiar rapido entre ellas y revisar estado. Los estados habituales son Libre, Ocupada, Reservada y Cuenta.",
        target: "#mesasTransOtherTables",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Selecciona sala",
        text: "Este selector cambia la sala activa para mostrar solo sus mesas. Es util cuando tienes varias zonas (terraza, interior, barra).",
        target: "#mesasContextRoomSelect",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Selecciona mesa",
        text: "Despues eliges la mesa concreta. Todo lo que vendas, edites o consultes se aplicara al ticket de esta mesa.",
        target: "#mesasContextTableSelect",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Acciones rapidas",
        text: "Este bloque agrupa accesos directos para operar sin perder tiempo, por ejemplo abrir tickets de la mesa o ajustar personas.",
        target: "#mesasTransSidebar .mts-actions",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Tickets de la mesa",
        text: "Desde este boton abres el listado de tickets/pedidos de la mesa activa para revisar, recuperar o continuar operaciones.",
        target: "#mesasTransActionTickets",
        advanceOn: "click",
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
        text: "Pulsa el boton de cambio de modo para abrir Mesas.",
        target: ".agent-mode-switch-btn",
        advanceOn: "click",
      });
    }

    steps.push(
      {
        title: "Tab Transacciones",
        text: "Ve a Transacciones para trabajar sobre tickets por mesa.",
        target: "#mesasInlineTabTransacciones",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Abrir tickets",
        text: "Pulsa Tickets para abrir la lista de pedidos de esa mesa.",
        target: "#mesasTransActionTickets",
        advanceOn: "click",
      },
      {
        title: "Cerrar ventana de tickets",
        text: "Cierra la ventana de tickets para volver al flujo principal.",
        target: "#parkedCloseBtn",
        advanceOn: "click",
      },
      {
        title: "Vista Mapa",
        text: "Pulsa Mapa para cambiar de contexto sin tocar datos del ticket.",
        target: "#mesasInlineTabMapa",
        advanceOn: "click",
        enterAction: "view-mapa",
      },
      {
        title: "Vista Diseno",
        text: "Pulsa Diseno para ubicarte en la vista de edicion del plano.",
        target: "#mesasInlineTabDiseno",
        advanceOn: "click",
        enterAction: "view-diseno",
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
        advanceOn: "click",
      },
      {
        title: "Mesa del servicio",
        text: "Elige una mesa y revisa su ticket asociado.",
        target: "#mesasContextTableSelect",
        advanceOn: "click",
      },
      {
        title: "Abrir tickets de mesa",
        text: "Abre Tickets para consultar pedidos de la mesa sin cobrar ni guardar cambios.",
        target: "#mesasTransActionTickets",
        advanceOn: "click",
      },
      {
        title: "Cerrar tickets",
        text: "Cierra la ventana y vuelve a la vista principal de Mesas.",
        target: "#parkedCloseBtn",
        advanceOn: "click",
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
        title: "Abrir Diseno",
        text: "En Diseno gestionas salas y estructura del local.",
        target: "#mesasInlineTabDiseno",
        advanceOn: "click",
        enterAction: "view-diseno",
      },
      {
        title: "Crear sala",
        text: "Este boton crea una sala nueva. Con Siguiente te llevo al control siguiente sin crear datos automaticamente.",
        target: "iframe:#designAddRoomBtn",
        advanceOn: "click",
        advanceAction: "noop",
        enterAction: "view-diseno",
      },
      {
        title: "Renombrar sala",
        text: "Aqui renombras la sala activa. Si quieres practicar, haz clic manualmente.",
        target: "iframe:#designRenameRoomBtn",
        advanceOn: "click",
        advanceAction: "noop",
        enterAction: "view-diseno",
      },
      {
        title: "Borrar sala",
        text: "Este boton borra la sala activa. En tutorial solo te mostramos donde esta.",
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
        title: "Vista Diseno",
        text: "Abrimos Diseno para crear y ajustar mesas.",
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
        text: "Al seleccionar una mesa, aqui editas nombre, comensales y capacidad.",
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
        title: "Boton de reserva",
        text: "Desde aqui abres el panel de reserva para mesa y hora.",
        target: "#mesasTransReservaToggleBtn",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Panel de reserva",
        text: "Aqui introduces nombre y hora de la reserva de forma guiada.",
        target: "#mesasTransReservaPanel",
        advanceOn: "click",
        advanceAction: "noop",
        enterAction: "view-transacciones",
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
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Selector de mesa",
        text: "Despues elige la mesa concreta sobre la que operar.",
        target: "#mesasContextTableSelect",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Cambio rapido",
        text: "Usa este acceso para ir al siguiente contexto de forma agil.",
        target: "#mesasContextQuickSwitch",
        advanceOn: "click",
        enterAction: "view-transacciones",
      },
      {
        title: "Tarjeta de mesa actual",
        text: "Aqui confirmas estado, sala y total de la mesa activa.",
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
        title: "Categorias",
        text: "Empieza filtrando por categoria para encontrar productos rapido.",
        target: ".categories-wrapper",
        advanceOn: "click",
      },
      {
        title: "Productos",
        text: "Pulsa un producto para anadirlo al ticket actual.",
        target: "#productsGrid",
        advanceOn: "click",
      },
      {
        title: "Lineas del ticket",
        text: "Aqui se reflejan cantidades, precios y lineas de venta.",
        target: "#cartLines",
        advanceOn: "click",
        advanceAction: "noop",
      },
      {
        title: "Boton Cobrar",
        text: "Cuando el pedido este listo, continua con Cobrar.",
        target: "#payBtn",
        advanceOn: "click",
      },
    ];
  }

  function getTpvTutorialTicketsSteps() {
    return [
      {
        title: "Abrir Tickets",
        text: "Pulsa Tickets para consultar el historico.",
        target: "#ticketsListBtn",
        advanceOn: "click",
      },
      {
        title: "Buscador",
        text: "Filtra por texto o numero para localizar tickets rapido.",
        target: "#ticketsSearch",
        advanceOn: "click",
      },
      {
        title: "Pestanas de listado",
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
        title: "Metodos de pago",
        text: "Selecciona el metodo de pago adecuado para el cliente.",
        target: "#payMethodsList",
        advanceOn: "click",
      },
      {
        title: "Numero del documento",
        text: "Completa los datos del cobro cuando corresponda.",
        target: "#payNumber",
        advanceOn: "click",
      },
      {
        title: "Cancelar y volver",
        text: "Este boton cierra el panel sin finalizar cobro para practicar sin riesgo.",
        target: "#payCancelBtn",
        advanceOn: "click",
      },
    ];
  }

  const tutorialCatalog = {
    tpvBasics: {
      title: "Apertura rapida del TPV",
      family: "tpv",
      buildSteps: getTpvTutorialBasicsSteps,
    },
    tpvTickets: {
      title: "Tickets y busqueda",
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
      title: "Contexto rapido: sala y mesa",
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

    if (runEnterAction) {
      await runTutorialStepEnterAction(step);
    }

    if (els.tutorialCoachTitle) {
      const interactiveTag =
        step?.advanceOn === "click" ? " · Interactivo" : "";
      els.tutorialCoachTitle.textContent = `${tutorialState.title} (${tutorialState.stepIndex + 1}/${tutorialState.steps.length}${interactiveTag})`;
    }

    if (els.tutorialCoachText)
      els.tutorialCoachText.textContent = step.text || "";

    const target = resolveTutorialTarget(step);
    placeCoachForTarget(target);

    if (target) {
      if (tutorialState?.stepRetryCount) {
        tutorialState.stepRetryCount[String(tutorialState.stepIndex)] = 0;
      }

      applyTutorialHighlight(target);
      scrollTutorialTargetIntoView(target);

      if (els.tutorialCoachHint) {
        els.tutorialCoachHint.textContent =
          step.advanceOn === "click"
            ? "Paso interactivo: puedes pulsar el elemento resaltado para avanzar automatico, o usar ▶ para saltar este paso."
            : "Continua con Siguiente.";
      }
    } else if (els.tutorialCoachHint) {
      els.tutorialCoachHint.textContent =
        "Elemento no visible en este momento. Puedes continuar con Siguiente.";
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
        tutorialState.stepIndex >= tutorialState.steps.length - 1
          ? "Finalizar"
          : "Siguiente";
    }
  }

  function finishTutorial({ completed = false } = {}) {
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
    document.body.classList.remove("tutorial-mode-active");
    els?.tutorialModeBackdrop?.classList.add("hidden");
    els?.tutorialCoachDock?.classList.add("hidden");
    els?.tutorialResumeOverlay?.classList.add("hidden");
    pendingResumeChoice = null;

    api.endTutorialBlankMode?.();
    restoreDemoSnapshot();
    if (completed) {
      toast("Tutorial finalizado.", "ok");
    } else {
      toast("Tutorial cerrado. Puedes reanudarlo mas tarde.", "info");
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
        : "No disponible: modulo Mesas desactivado para este cliente.";
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

    api.beginTutorialBlankMode?.();

    const wantedStep = Math.max(0, Number(opts?.stepIndex || 0) || 0);
    const boundedStep = Math.min(wantedStep, Math.max(0, steps.length - 1));

    tutorialModeActive = true;
    tutorialState = {
      active: true,
      tutorialId,
      title: tutorialDef.title,
      stepIndex: boundedStep,
      steps,
      stepRetryCount: {},
    };

    saveTutorialProgress();

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
        "Cancelar: cierra este aviso y no inicia ningun tutorial.";
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
      toast("El modulo Mesas no esta disponible en este terminal.", "warn");
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
    if (currentStep?.advanceOn === "click") {
      runTutorialStepAutoAction(currentStep);
    }

    if (tutorialState.stepIndex >= tutorialState.steps.length - 1) {
      finishTutorial({ completed: true });
      return;
    }

    tutorialState.stepIndex += 1;
    saveTutorialProgress();
    void renderTutorialStep();
  }

  function tutorialPrevStep() {
    if (!tutorialState?.active) return;
    if (tutorialState.stepIndex <= 0) return;
    tutorialState.stepIndex -= 1;
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
        if (!target) return;

        if (target === e.target || target.contains(e.target)) {
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
