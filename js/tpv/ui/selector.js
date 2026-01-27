function showCajaSelector({ cajas, onOpen, onClose, onCancel }) {
  const overlay = document.getElementById("tpvSelectorOverlay");
  const list = document.getElementById("tpvSelectorList");
  const cancel = document.getElementById("tpvSelectorCancel");

  list.innerHTML = "";

  cajas.forEach((c) => {
    const row = document.createElement("div");
    row.className = "tpv-caja-row";
    row.innerHTML = `
      <div>
        <strong>#${c.idcaja}</strong> - ${c.fechaini} - usuario: ${c.nick}
      </div>
      <div>
        <button data-open="${c.idcaja}">Abrir</button>
        <button data-close="${c.idcaja}">Cerrar</button>
      </div>
    `;
    list.appendChild(row);
  });

  list.onclick = (e) => {
    const openId = e.target?.getAttribute?.("data-open");
    const closeId = e.target?.getAttribute?.("data-close");
    if (openId) onOpen(Number(openId));
    if (closeId) onClose(Number(closeId));
  };

  cancel.onclick = () => onCancel();

  overlay.style.display = "block";

  return () => {
    overlay.style.display = "none";
  };
}

module.exports = { showCajaSelector };
