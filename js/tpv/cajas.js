// cajas.js

function buildFsUrl(fsApi, path) {
  const base = String(fsApi?.baseUrl || "").replace(/\/+$/, "");
  const p = String(path || "").startsWith("/") ? String(path) : `/${path}`;
  if (!base) throw new Error("fsApi.baseUrl vacío");
  return `${base}${p}`;
}

async function fsWriteForm(fsApi, path, method = "POST", fields = {}) {
  const url = buildFsUrl(fsApi, path);

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
  }

  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      Token: fsApi.apiKey, // ✅ mismo token que usas en renderer
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok || (data && data.status === "error")) {
    throw new Error(`${method} ${url} -> ${res.status} :: ${text}`);
  }
  return data;
}

// Retry suave para errores típicos de DB (deadlock)
async function withRetry(fn, tries = 3) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const isDeadlock = msg.toLowerCase().includes("deadlock");
      if (!isDeadlock || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 150 + i * 250));
    }
  }
  throw lastErr;
}

function nowFsLike() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function listarCajasAbiertas({ fsApi, idtpv }) {
  const cajas = await fsApi.get(
    "/tpvcajas",
    "sort[idcaja]=DESC&filter[fechafin_null]=1&limit=50",
  );

  return (Array.isArray(cajas) ? cajas : []).filter(
    (c) =>
      String(c?.idtpv) === String(idtpv) &&
      (c?.fechafin === null ||
        c?.fechafin === "" ||
        typeof c?.fechafin === "undefined"),
  );
}

async function crearCaja({ fsApi, idtpv, nick, dineroini = 0 }) {
  return withRetry(() =>
    fsWriteForm(fsApi, "/tpvcajas", "POST", {
      idtpv,
      nick,
      dineroini,
      fechaini: nowFsLike(),
      observaciones: "", // ✅ siempre inicial
    }),
  );
}

async function cerrarCaja({ fsApi, idcaja, observaciones = "" }) {
  const fechafin = nowFsLike();
  const fields = { fechafin, observaciones };

  // Muchos FS aceptan PUT seguro; PATCH a veces falla en algunos setups.
  return withRetry(async () => {
    try {
      return await fsWriteForm(fsApi, `/tpvcajas/${idcaja}`, "PATCH", fields);
    } catch {
      return await fsWriteForm(fsApi, `/tpvcajas/${idcaja}`, "PUT", fields);
    }
  });
}

module.exports = {
  listarCajasAbiertas,
  cerrarCaja,
  crearCaja,
};
