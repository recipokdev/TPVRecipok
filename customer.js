function eur(n) {
  return (
    Number(n || 0)
      .toFixed(2)
      .replace(".", ",") + " €"
  );
}

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

/* ===== Notice ===== */
let noticeTimer = null;

function setNotice(show, title = "", sub = "", ttlMs = 0) {
  const box = document.getElementById("notice");
  const tEl = document.getElementById("noticeTitle");
  const sEl = document.getElementById("noticeSub");
  if (!box || !tEl || !sEl) return;

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

/* ===== Layout (solo ancho de columnas, filas son 5 fijas por CSS) ===== */
function applyDynamicGridLayout(itemCount) {
  const el = document.getElementById("items");
  if (!el) return;

  const rows = 5;
  const gap =
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--grid-gap"),
    ) || 12;

  const W = el.clientWidth;
  const minColW =
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--col-min"),
    ) || 520;

  const colsNeeded = Math.max(1, Math.ceil((itemCount || 0) / rows));
  const maxColsFit = Math.max(1, Math.floor((W + gap) / (minColW + gap)));

  // Si caben, reparte exacto sin scroll; si no, deja minColW y habrá scroll horizontal
  let colW;
  if (colsNeeded <= maxColsFit) {
    colW = Math.floor((W - gap * (colsNeeded - 1)) / colsNeeded);
  } else {
    colW = minColW;
  }

  el.style.setProperty("--col-min", `${colW}px`);
}

/* ===== Autoscroll ===== */
let autoScrollTimer = null;
let autoScrollDir = 1;

function startAutoScrollIfNeeded() {
  stopAutoScroll();

  const scroller = document.getElementById("items");
  if (!scroller) return;

  const maxX = scroller.scrollWidth - scroller.clientWidth;
  const maxY = scroller.scrollHeight - scroller.clientHeight;

  // ✅ solo si hay overflow real
  if (maxX <= 4 && maxY <= 4) {
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
    return;
  }

  autoScrollDir = 1;

  autoScrollTimer = setInterval(() => {
    const mx = scroller.scrollWidth - scroller.clientWidth;
    const my = scroller.scrollHeight - scroller.clientHeight;

    // preferimos horizontal si hay overflow
    if (mx > 4) {
      scroller.scrollLeft += autoScrollDir * 2.0;
      if (scroller.scrollLeft >= mx) autoScrollDir = -1;
      if (scroller.scrollLeft <= 0) autoScrollDir = 1;
      return;
    }

    // fallback vertical (debería NO pasar ya con el CSS corregido)
    if (my > 4) {
      scroller.scrollTop += autoScrollDir * 1.4;
      if (scroller.scrollTop >= my) autoScrollDir = -1;
      if (scroller.scrollTop <= 0) autoScrollDir = 1;
      return;
    }
  }, 40);
}

function stopAutoScroll() {
  if (autoScrollTimer) clearInterval(autoScrollTimer);
  autoScrollTimer = null;
}

/* ===== ResizeObserver (UNO SOLO) ===== */
let itemsResizeObserverBound = false;
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

/* ===== Render ===== */
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

  subEl.textContent = state?.subLine || "---";
  totalEl.textContent = eur(total);

  if (!cashOpen || mode === "CLOSED") {
    setNotice(true, "CAJA CERRADA", state?.subLine || "");
    itemsEl.innerHTML = "";
    stopAutoScroll();
    return;
  }

  if (mode === "PAYING") {
    setNotice(true, "COBRANDO…", "Espere por favor");
  } else if (mode === "THANKS") {
    const t = state?.lastSale?.ticket ? `Ticket: ${state.lastSale.ticket}` : "";
    const pm = state?.lastSale?.paymentMethod
      ? `Pago: ${state.lastSale.paymentMethod}`
      : "";
    const agent = state?.lastSale?.agent
      ? `Agente: ${state.lastSale.agent}`
      : "";

    setNotice(
      true,
      "✅ PAGO REALIZADO",
      [t, pm, agent].filter(Boolean).join(" · "),
      5000,
    );
  } else {
    setNotice(false);
  }

  // Render lista
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

  // Ajustar columnas + autoscroll según overflow
  applyDynamicGridLayout(items.length);
  requestAnimationFrame(() => startAutoScrollIfNeeded());
}

window.TPV_CUSTOMER_IPC?.onState?.((state) => {
  try {
    render(state);
  } catch {}
});
