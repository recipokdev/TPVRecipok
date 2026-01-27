async function listarCajasAbiertas({ fsApi, idtpv }) {
  const id = String(idtpv).trim();

  // ✅ Pedimos SOLO abiertas desde el servidor (fechafin_null=1)
  const cajas = await fsApi.get(
    "/tpvcajas",
    `sort[idcaja]=DESC&filter[fechafin_null]=1&limit=50`
  );

  // ✅ Normalizamos tipos: idtpv puede venir number o string
  return (Array.isArray(cajas) ? cajas : []).filter((c) => String(c.idtpv) === id);
}



async function cerrarCaja({ fsApi, idcaja, observaciones = "" }) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fechafin = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // OJO: según tu API, puede ser PUT /tpvcajas/{id} o /tpvcajas?idcaja=...
  // En tu JSON el id es idcaja. Habitual: /tpvcajas/181
  // Si tu API no soporta PATCH, usa PUT.
  const body = { fechafin, observaciones };
  try {
    return await fsApi.patch(`/tpvcajas/${idcaja}`, body);
  } catch {
    return await fsApi.put(`/tpvcajas/${idcaja}`, body);
  }
}

function nowFsLike() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function crearCaja({ fsApi, idtpv, nick, dineroini = 0 }) {
  return fsApi.post("/tpvcajas", {
    idtpv,
    nick,
    dineroini,
    fechaini: nowFsLike(), // ✅
  });
}

module.exports = {
  listarCajasAbiertas,
  cerrarCaja,
  crearCaja,
};
