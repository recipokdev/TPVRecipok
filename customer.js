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

/* ===== Banner (usa tu HTML/CSS de .banner) =====
   Si ya tienes setNotice(), lo usamos; si no, lo creamos aquí.
*/
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

function applyDynamicGridLayout(itemCount) {
  const el = document.getElementById("items");
  if (!el) return;

  // Altura disponible real
  const H = el.clientHeight;

  // 1) Decide cuántas filas quieres “máximo” por columna
  //    (tu caso: 5-6 suele quedar bien)
  const targetRows = 5; // prueba 5; si quieres más compacto, 6
  const rows = Math.max(1, targetRows);

  // 2) Calcula altura de cada fila para que NO quede hueco abajo
  //    Restamos gaps: (rows-1)*gap
  const gap = 12;
  const rowH = Math.floor((H - gap * (rows - 1)) / rows);

  // 3) Cuántas columnas necesitas para itemCount
  const colsNeeded = Math.max(1, Math.ceil((itemCount || 0) / rows));

  // 4) Intentar que quepan sin scroll hasta cierto mínimo
  const W = el.clientWidth;
  const minColW = 430; // mínimo legible (ajusta)
  const maxColsFit = Math.max(1, Math.floor((W + gap) / (minColW + gap)));

  // si caben, ajustamos ancho para encajar justo; si no, usamos minColW y habrá scroll
  let colW;
  if (colsNeeded <= maxColsFit) {
    colW = Math.floor((W - gap * (colsNeeded - 1)) / colsNeeded);
  } else {
    colW = minColW;
  }

  el.style.setProperty("--rows", String(rows));
  el.style.setProperty("--rowH", `${rowH}px`);
  el.style.setProperty("--colW", `${colW}px`);
}

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
    return;
  }

  if (mode === "PAYING") {
    // sin TTL: mientras se está cobrando
    setNotice(true, "COBRANDO…", "Espere por favor");
  } else if (mode === "THANKS") {
    const t = state?.lastSale?.ticket ? `Ticket: ${state.lastSale.ticket}` : "";
    const pm = state?.lastSale?.paymentMethod
      ? `Pago: ${state.lastSale.paymentMethod}`
      : "";
    const agent = state?.lastSale?.agent
      ? `Agente: ${state.lastSale.agent}`
      : "";

    // ✅ CON TTL: se oculta solo aunque el modo THANKS siga
    setNotice(
      true,
      "✅ PAGO REALIZADO",
      [t, pm, agent].filter(Boolean).join(" · "),
      5000, // 5s (ajusta)
    );
  } else {
    setNotice(false);
  }

  (function watchItemsResize() {
    const el = document.getElementById("items");
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // recalcula con lo último que haya en DOM
      const count = el.querySelectorAll(".row").length;
      applyDynamicGridLayout(count);
    });
    ro.observe(el);
  })();
  // ✅ render normal de lista (SIEMPRE)
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
      img.style.visibility = "hidden"; // ocupa espacio igual, pero no se ve
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

  requestAnimationFrame(() => startAutoScroll());
}

window.TPV_CUSTOMER_IPC?.onState?.((state) => {
  try {
    render(state);
  } catch {}
});

/* ===== Autoscroll ===== */
let autoScrollTimer = null;
let autoScrollDir = 1;

function startAutoScroll() {
  stopAutoScroll();

  const scroller = document.getElementById("items");
  if (!scroller) return;

  autoScrollDir = 1;

  const tick = () => {
    const maxX = scroller.scrollWidth - scroller.clientWidth;
    const maxY = scroller.scrollHeight - scroller.clientHeight;

    // preferimos horizontal si hay overflow
    if (maxX > 4) {
      scroller.scrollLeft += autoScrollDir * 2.0;
      if (scroller.scrollLeft >= maxX) autoScrollDir = -1;
      if (scroller.scrollLeft <= 0) autoScrollDir = 1;
      return;
    }

    // fallback vertical
    if (maxY > 4) {
      scroller.scrollTop += autoScrollDir * 1.4;
      if (scroller.scrollTop >= maxY) autoScrollDir = -1;
      if (scroller.scrollTop <= 0) autoScrollDir = 1;
      return;
    }

    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
  };

  autoScrollTimer = setInterval(tick, 40);
}

function stopAutoScroll() {
  if (autoScrollTimer) clearInterval(autoScrollTimer);
  autoScrollTimer = null;
}
