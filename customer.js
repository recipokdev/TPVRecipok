function eur(n) {
  return (
    Number(n || 0)
      .toFixed(2)
      .replace(".", ",") + " €"
  );
}

function applyThemeMode(mode) {
  const light = mode === "light";
  document.body.classList.toggle("theme-light", light);
  document.body.classList.toggle("theme-dark", !light);
}

applyThemeMode("dark");

/* ===== Reloj ===== */
(function startClock() {
  const el = document.getElementById("clock");
  if (!el) return;

  const tick = () => {
    const d = new Date();
    el.textContent = d.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  tick();
  setInterval(tick, 1000);
})();

/* ===== Estado / timers ===== */
let thanksClearTimer = null;
let thanksOverlayTimer = null;
let thanksCountdownTimer = null;
let autoScrollTimer = null;
let autoScrollDir = 1;
let noticeTimer = null;
let itemsResizeObserverBound = false;

/* Evita rearmar THANKS muchas veces para la misma venta */
let lastThanksKey = null;

/* Cuando se limpia una venta, bloqueamos repintar ese mismo carrito */
let lockedEmpty = false;
let lockedCartKey = null;
let lockedStateTs = 0;
let latestMode = "";
let latestCartKey = "";
let latestSubLine = "---";
let latestStateTs = 0;

const THANKS_SECONDS = 8;

function buildCartKey(state) {
  const items = Array.isArray(state?.items) ? state.items : [];
  const total = Number(state?.total || 0).toFixed(2);

  const itemsKey = items
    .map((it) =>
      [
        it?.name || "",
        it?.secondaryName || "",
        Number(it?.qty || 0),
        Number(it?.unitPrice || 0).toFixed(2),
        Number(it?.lineTotal || 0).toFixed(2),
        it?.modified ? "1" : "0",
      ].join("|"),
    )
    .join("||");

  return `${total}__${itemsKey}`;
}

function clearThanksTimers() {
  if (thanksClearTimer) clearTimeout(thanksClearTimer);
  if (thanksOverlayTimer) clearTimeout(thanksOverlayTimer);
  if (thanksCountdownTimer) clearInterval(thanksCountdownTimer);
  thanksClearTimer = null;
  thanksOverlayTimer = null;
  thanksCountdownTimer = null;
}

function setThanksOverlay(show, title = "", sub = "") {
  const box = document.getElementById("thanksOverlay");
  if (!box) return;

  const titleEl = box.querySelector(".thanks-title");
  const subEl = box.querySelector(".thanks-sub");
  const timerEl = box.querySelector(".thanks-timer");

  if (titleEl) titleEl.textContent = title || "";
  if (subEl) subEl.textContent = sub || "";
  if (timerEl && !show) timerEl.textContent = "";

  box.classList.toggle("hidden", !show);
}

function clearCustomerScreen(subLine = latestSubLine) {
  const itemsEl = document.getElementById("items");
  const totalEl = document.getElementById("total");
  const subEl = document.getElementById("subLine");

  if (itemsEl) itemsEl.innerHTML = "";
  if (totalEl) totalEl.textContent = eur(0);
  if (subEl) subEl.textContent = subLine || "---";

  stopAutoScroll();
  setNotice(false);
  setThanksOverlay(false);
}

/* ===== Notice ===== */
function setNotice(show, title = "", sub = "", ttlMs = 0, variant = "") {
  const box = document.getElementById("notice");
  const tEl = document.getElementById("noticeTitle");
  const sEl = document.getElementById("noticeSub");
  if (!box || !tEl || !sEl) return;

  box.classList.remove("notice-paying");
  if (variant === "paying") box.classList.add("notice-paying");

  if (!show) {
    box.classList.add("hidden");
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    return;
  }

  tEl.textContent = title || "";
  sEl.textContent = sub || "";

  box.classList.remove("hidden");

  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;

  if (ttlMs > 0) {
    noticeTimer = setTimeout(() => {
      box.classList.add("hidden");
      noticeTimer = null;
    }, ttlMs);
  }
}

function setStateOverlay(show, title = "", sub = "") {
  const box = document.getElementById("stateOverlay");
  const tEl = document.getElementById("stateTitle");
  const sEl = document.getElementById("stateSub");
  if (!box || !tEl || !sEl) return;

  tEl.textContent = title || "";
  sEl.textContent = sub || "";
  box.classList.toggle("hidden", !show);
}

/* ===== Layout ===== */
function applyDynamicGridLayout(itemCount) {
  const el = document.getElementById("items");
  if (!el) return;

  const rows = 5;
  const gap =
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--grid-gap"),
      10,
    ) || 12;

  const W = el.clientWidth;
  const minColW =
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--col-min"),
      10,
    ) || 520;

  const colsNeeded = Math.max(1, Math.ceil((itemCount || 0) / rows));
  const maxColsFit = Math.max(1, Math.floor((W + gap) / (minColW + gap)));

  let colW;
  if (colsNeeded <= maxColsFit) {
    colW = Math.floor((W - gap * (colsNeeded - 1)) / colsNeeded);
  } else {
    colW = minColW;
  }

  el.style.setProperty("--col-min", `${colW}px`);
}

/* ===== Autoscroll ===== */
function startAutoScrollIfNeeded() {
  stopAutoScroll();

  const scroller = document.getElementById("items");
  if (!scroller) return;

  const maxX = scroller.scrollWidth - scroller.clientWidth;
  const maxY = scroller.scrollHeight - scroller.clientHeight;

  if (maxX <= 4 && maxY <= 4) {
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
    return;
  }

  autoScrollDir = 1;

  autoScrollTimer = setInterval(() => {
    const mx = scroller.scrollWidth - scroller.clientWidth;
    const my = scroller.scrollHeight - scroller.clientHeight;

    if (mx > 4) {
      scroller.scrollLeft += autoScrollDir * 2.0;
      if (scroller.scrollLeft >= mx) autoScrollDir = -1;
      if (scroller.scrollLeft <= 0) autoScrollDir = 1;
      return;
    }

    if (my > 4) {
      scroller.scrollTop += autoScrollDir * 1.4;
      if (scroller.scrollTop >= my) autoScrollDir = -1;
      if (scroller.scrollTop <= 0) autoScrollDir = 1;
    }
  }, 40);
}

function stopAutoScroll() {
  if (autoScrollTimer) clearInterval(autoScrollTimer);
  autoScrollTimer = null;
}

/* ===== ResizeObserver ===== */
function bindItemsResizeObserverOnce() {
  if (itemsResizeObserverBound) return;
  itemsResizeObserverBound = true;

  const el = document.getElementById("items");
  if (!el) return;

  const ro = new ResizeObserver(() => {
    const count = el.querySelectorAll(".row").length;
    applyDynamicGridLayout(count);
    requestAnimationFrame(() => startAutoScrollIfNeeded());
  });

  ro.observe(el);
}

/* ===== Render lista ===== */
function renderItems(items) {
  const itemsEl = document.getElementById("items");
  if (!itemsEl) return;

  itemsEl.innerHTML = "";

  for (const it of items) {
    const row = document.createElement("div");
    row.className = "row";

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = it.name || "";

    if (it.imageUrl) {
      img.src = it.imageUrl;
      img.style.visibility = "visible";
    } else {
      img.removeAttribute("src");
      img.style.visibility = "hidden";
    }

    const info = document.createElement("div");
    info.className = "info";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = it.name || "";

    const secondary = document.createElement("div");
    secondary.className = "secondary";
    secondary.textContent = it.secondaryName || "";
    if (!it.secondaryName) secondary.style.display = "none";

    const meta = document.createElement("div");
    meta.className = "meta";

    const qty = document.createElement("div");
    qty.className = "qty";
    qty.textContent = `x${String(it.qty ?? 0)}`;

    const unit = document.createElement("div");
    unit.className = "unit";
    unit.textContent = `${eur(it.unitPrice)} / ud`;

    meta.appendChild(qty);
    meta.appendChild(unit);

    if (it.modified) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "MOD";
      meta.appendChild(badge);
    }

    info.appendChild(name);
    info.appendChild(secondary);
    info.appendChild(meta);

    const lineTotal = document.createElement("div");
    lineTotal.className = "lineTotal";
    lineTotal.textContent = eur(it.lineTotal);

    row.appendChild(img);
    row.appendChild(info);
    row.appendChild(lineTotal);

    itemsEl.appendChild(row);
  }

  applyDynamicGridLayout(items.length);
  requestAnimationFrame(() => startAutoScrollIfNeeded());
}

/* ===== THANKS ===== */
function handleThanksState(state) {
  const cartKey = buildCartKey(state);
  const thanksStateTs = Number(state?.ts || 0) || Date.now();

  if (lastThanksKey === cartKey) return;
  lastThanksKey = cartKey;

  clearThanksTimers();
  setNotice(false);

  setThanksOverlay(
    true,
    "Pago realizado",
    "Gracias por su compra. Hasta pronto.",
  );

  const timerEl = document.querySelector("#thanksOverlay .thanks-timer");
  let secondsLeft = THANKS_SECONDS;
  if (timerEl) timerEl.textContent = `${secondsLeft}`;

  thanksCountdownTimer = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      if (timerEl) timerEl.textContent = "";
      if (thanksCountdownTimer) clearInterval(thanksCountdownTimer);
      thanksCountdownTimer = null;
      return;
    }
    if (timerEl) timerEl.textContent = `${secondsLeft}`;
  }, 1000);

  thanksOverlayTimer = setTimeout(() => {
    // Si ya cambió el carrito o entró un nuevo cobro, no tocar overlays antiguos.
    if (
      latestCartKey !== cartKey ||
      latestMode === "PAYING" ||
      latestStateTs > thanksStateTs
    ) {
      thanksOverlayTimer = null;
      return;
    }

    setThanksOverlay(false);
    thanksOverlayTimer = null;
  }, THANKS_SECONDS * 1000);

  thanksClearTimer = setTimeout(() => {
    // Solo limpiamos si sigue siendo la misma venta (cliente se fue sin siguiente carrito).
    if (
      latestCartKey !== cartKey ||
      latestMode === "PAYING" ||
      latestStateTs > thanksStateTs
    ) {
      thanksClearTimer = null;
      return;
    }

    clearCustomerScreen(state?.subLine || latestSubLine);
    lockedEmpty = true;
    lockedCartKey = cartKey;
    lockedStateTs = thanksStateTs;
    thanksClearTimer = null;
  }, THANKS_SECONDS * 1000);
}

/* ===== Render principal ===== */
function render(state) {
  const itemsEl = document.getElementById("items");
  const totalEl = document.getElementById("total");
  const subEl = document.getElementById("subLine");

  if (!itemsEl || !totalEl || !subEl) return;

  bindItemsResizeObserverOnce();

  const cashOpen = !!state?.cashOpen;
  const items = Array.isArray(state?.items) ? state.items : [];
  const total = Number(state?.total || 0);
  const mode = String(state?.mode || "").toUpperCase();
  const cartKey = buildCartKey(state);
  const stateTs = Number(state?.ts || 0);

  latestMode = mode;
  latestCartKey = cartKey;
  latestSubLine = state?.subLine || latestSubLine || "---";
  latestStateTs = stateTs > 0 ? stateTs : latestStateTs;

  if (!cashOpen || mode === "CLOSED") {
    clearThanksTimers();
    lockedEmpty = false;
    lockedCartKey = null;
    lockedStateTs = 0;
    lastThanksKey = null;

    setThanksOverlay(false);
    setNotice(false);
    setStateOverlay(true, "CAJA CERRADA", state?.subLine || "");
    itemsEl.innerHTML = "";
    totalEl.textContent = eur(0);
    subEl.textContent = state?.subLine || "---";
    stopAutoScroll();
    return;
  }

  setStateOverlay(false);

  /* Si ya limpiamos el último carrito y sigue llegando exactamente el mismo estado,
     mantenemos la pantalla vacía hasta que haya actividad nueva. */
  if (lockedEmpty) {
    const hasNewActivity =
      cartKey !== lockedCartKey ||
      mode === "PAYING" ||
      (stateTs > 0 && stateTs !== lockedStateTs);

    if (!hasNewActivity) {
      return;
    }

    lockedEmpty = false;
    lockedCartKey = null;
    lockedStateTs = 0;
    lastThanksKey = null;
  }

  subEl.textContent = state?.subLine || "---";
  totalEl.textContent = eur(total);

  if (mode === "PAYING") {
    setThanksOverlay(false);
    setNotice(true, "COBRANDO…", "Espere por favor", 0, "paying");
  } else if (mode === "THANKS") {
    setNotice(false);
  } else {
    /* no cancelamos lockedEmpty aquí, solo limpiamos overlays */
    setThanksOverlay(false);
    setNotice(false);
  }

  renderItems(items);

  if (mode === "THANKS") {
    handleThanksState(state);
  }
}

window.TPV_CUSTOMER_IPC?.onState?.((state) => {
  try {
    render(state);
  } catch (e) {
    console.error("[CUSTOMER render error]", e);
  }
});

window.TPV_CUSTOMER_IPC?.onTheme?.((mode) => {
  try {
    applyThemeMode(mode);
  } catch (e) {
    console.error("[CUSTOMER theme error]", e);
  }
});
