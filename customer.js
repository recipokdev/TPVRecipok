function eur(n) {
  return (
    Number(n || 0)
      .toFixed(2)
      .replace(".", ",") + " €"
  );
}

function render(state) {
  const itemsEl = document.getElementById("items");
  const totalEl = document.getElementById("total");
  const subEl = document.getElementById("subLine");

  const cashOpen = !!state?.cashOpen;
  const items = Array.isArray(state?.items) ? state.items : [];
  const total = Number(state?.total || 0);

  subEl.textContent = state?.subLine || "---";
  totalEl.textContent = eur(total);

  itemsEl.innerHTML = "";

  // Si caja cerrada: lista vacía
  if (!cashOpen) return;

  const MAX = 999; // prueba 12–16 según tu monitor cliente
  const slice = items.slice(-MAX);

  for (const it of slice) {
    const row = document.createElement("div");
    row.className = "row";

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = it.name || "";
    if (it.imageUrl) img.src = it.imageUrl;
    else img.style.display = "none";

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

    // Si hay overflow horizontal (caso 2 columnas)
    if (maxX > 4) {
      scroller.scrollLeft += autoScrollDir * 1.6; // velocidad horizontal

      if (scroller.scrollLeft >= maxX) autoScrollDir = -1;
      if (scroller.scrollLeft <= 0) autoScrollDir = 1;
      return;
    }

    // Si no hay overflow horizontal pero sí vertical (fallback 1 columna / pantallas pequeñas)
    if (maxY > 4) {
      scroller.scrollTop += autoScrollDir * 1.6; // velocidad vertical

      if (scroller.scrollTop >= maxY) autoScrollDir = -1;
      if (scroller.scrollTop <= 0) autoScrollDir = 1;
      return;
    }

    // Nada que scrollear
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
  };

  autoScrollTimer = setInterval(tick, 60);
}

function stopAutoScroll() {
  if (autoScrollTimer) clearInterval(autoScrollTimer);
  autoScrollTimer = null;
}
