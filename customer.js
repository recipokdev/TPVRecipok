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

/* ===== Grid layout: 5 filas por columna, scroll SOLO si hace falta ===== */
let lastItemCountForLayout = 0;

function applyDynamicGridLayout(itemCount) {
  const el = document.getElementById("items");
  if (!el) return;

  const rows = 5; // requisito
  const gap = 12;

  const W = el.clientWidth || 0;
  const colsNeeded = Math.max(1, Math.ceil((itemCount || 0) / rows));

  // ancho mínimo aceptable por columna (cuando ya toca scroll)
  const minColW = 520; // puedes bajar a 480/460 si quieres más columnas sin scroll

  // cuántas columnas caben sin scroll si respetamos minColW
  const maxColsFit = Math.max(1, Math.floor((W + gap) / (minColW + gap)));

  const fitsWithoutScroll = colsNeeded <= maxColsFit;

  // Si caben: ajustamos colW para que rellene justo el ancho sin overflow
  // Si no caben: dejamos colW = minColW y habrá scroll horizontal
  let colW;
  if (fitsWithoutScroll) {
    colW = Math.floor((W - gap * (colsNeeded - 1)) / colsNeeded);
    colW = Math.max(1, colW);
  } else {
    colW = minColW;
  }

  el.style.setProperty("--rows", String(rows));
  el.style.setProperty("--colW", `${colW}px`);

  // ✅ esto quita el “scrollbar fantasma” en pantallas grandes
  el.classList.toggle("no-scroll", fitsWithoutScroll);

  // si no hay scroll, reseteamos por si venía de antes
  if (fitsWithoutScroll) {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  }
}

/* ===== ResizeObserver (una sola vez) ===== */
(function watchItemsResizeOnce() {
  const el = document.getElementById("items");
  if (!el) return;
  const ro = new ResizeObserver(() =>
    applyDynamicGridLayout(lastItemCountForLayout),
  );
  ro.observe(el);
})();

/* ===== Render ===== */
function render(state) {
  const itemsEl = document.getElementById("items");
  const totalEl = document.getElementById("total");
  const subEl = document.getElementById("subLine");

  const cashOpen = !!state?.cashOpen;
  const items = Array.isArray(state?.items) ? state.items : [];
  const total = Number(state?.total || 0);
  const mode = String(state?.mode || "").toUpperCase();

  subEl.textContent = state?.subLine || "---";
  totalEl.textContent = eur(total);

  if (!cashOpen || mode === "CLOSED") {
    setNotice(true, "CAJA CERRADA", state?.subLine || "");
    itemsEl.innerHTML = "";
    lastItemCountForLayout = 0;
    applyDynamicGridLayout(0);
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

  // pinta items
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

  // layout + autoscroll
  lastItemCountForLayout = items.length;
  applyDynamicGridLayout(items.length);

  requestAnimationFrame(() => startAutoScroll());
}

window.TPV_CUSTOMER_IPC?.onState?.((state) => {
  try {
    render(state);
  } catch {}
});

/* ===== Autoscroll (solo si hay overflow real) ===== */
let autoScrollTimer = null;
let autoScrollDir = 1;

function startAutoScroll() {
  stopAutoScroll();

  const scroller = document.getElementById("items");
  if (!scroller) return;

  // si no hay overflow, no arrancamos
  const maxX = scroller.scrollWidth - scroller.clientWidth;
  const maxY = scroller.scrollHeight - scroller.clientHeight;
  if (maxX <= 4 && maxY <= 4) {
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
    return;
  }

  autoScrollDir = 1;

  const tick = () => {
    const maxX2 = scroller.scrollWidth - scroller.clientWidth;
    const maxY2 = scroller.scrollHeight - scroller.clientHeight;

    if (maxX2 > 4) {
      scroller.scrollLeft += autoScrollDir * 2.0;
      if (scroller.scrollLeft >= maxX2) autoScrollDir = -1;
      if (scroller.scrollLeft <= 0) autoScrollDir = 1;
      return;
    }

    if (maxY2 > 4) {
      scroller.scrollTop += autoScrollDir * 1.4;
      if (scroller.scrollTop >= maxY2) autoScrollDir = -1;
      if (scroller.scrollTop <= 0) autoScrollDir = 1;
      return;
    }

    // por si cambió el layout mientras tanto
    stopAutoScroll();
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
  };

  autoScrollTimer = setInterval(tick, 40);
}

function stopAutoScroll() {
  if (autoScrollTimer) clearInterval(autoScrollTimer);
  autoScrollTimer = null;
}
