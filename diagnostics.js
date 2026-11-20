"use strict";
// Diagnostico remoto del TPV (proceso main). Sin dependencias de Electron: se prueba con Node.
//
// Caso real (Los Argentinos, 2026-11-19): el cajon dejo de abrir con un aviso generico y, sin entrar en el equipo, no habia forma de saber si
// el programa auxiliar existia, que antivirus tenia, cuanto espacio libre habia o en que estado estaba la impresora para Windows. Ahora:
//   - una «foto» del equipo al arrancar (una vez por semana y al cambiar de version): evento `diag-snapshot`;
//   - un boton «Enviar diagnostico a soporte» en Opciones: la foto + las ultimas lineas del registro del actualizador + los ultimos
//     avisos del TPV: evento `diag-report`;
//   - los errores del proceso principal (`main-error`), con limite de frecuencia.
// LIMITES DEL SERVIDOR (lib/audit_log.php auditSanitizeValue): cada texto se recorta a 240 caracteres y cada nivel admite 25 claves como
// maximo. Por eso todo va en textos cortos y en listas de lineas (maximo ~22), y la foto tiene pocas claves.
// PRIVACIDAD: nunca nombre de equipo ni de usuario de Windows (se sustituye en las rutas), ni claves, ni datos de clientes o ventas.
const fs = require("fs");
const path = require("path");

const MAX_TEXT = 230; // margen bajo los 240 que deja el servidor

function clip(s, n = MAX_TEXT) {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

// Quita el nombre de usuario de Windows de las rutas (C:\Users\Nombre\... -> C:\Users\<usuario>\...).
function sanitizeText(s) {
  return String(s == null ? "" : s)
    // el nombre de usuario puede llevar espacios («Maria Lopez»): se sustituye hasta el siguiente separador de ruta
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/"'<>|\r\n]+/gi, "$1<usuario>")
    .replace(/(\/(?:Users|home)\/)[^/\s"']+/gi, "$1<usuario>");
}

// Estado de una impresora segun Windows (PRINTER_INFO_2.Status, que Electron devuelve en `status`).
// Solo se nombran los estados que importan; ocupada o imprimiendo cuentan como «ok».
const PRINTER_FLAGS = [
  [0x1, "pausada"], [0x2, "error"], [0x8, "atasco"], [0x10, "sin-papel"], [0x40, "problema-papel"], [0x80, "sin-conexion"],
  [0x1000, "no-disponible"], [0x100000, "requiere-atencion"], [0x400000, "tapa-abierta"], [0x40000, "sin-toner"],
];
function decodePrinterStatus(status) {
  if (status == null || !Number.isFinite(Number(status))) return "?";
  const n = Number(status);
  if (n === 0) return "ok";
  const bad = PRINTER_FLAGS.filter(([bit]) => (n & bit) !== 0).map(([, name]) => name);
  return bad.length ? bad.join("+") : "ok";
}

// Ficheros que el TPV necesita y que un antivirus podria quitar o dejar a medias: existencia, tamano y dia de modificacion.
function describeHelperFiles(assetsDir, names) {
  return names.map((name) => {
    try {
      const st = fs.statSync(path.join(assetsDir, name));
      return { name, exists: true, size: st.size, day: new Date(st.mtimeMs).toISOString().slice(0, 10) };
    } catch {
      return { name, exists: false, size: 0, day: "" };
    }
  });
}

const gb = (n) => (Number.isFinite(n) && n >= 0 ? Math.round((n / 1073741824) * 10) / 10 : null);

// «Foto» del equipo. Entrada: datos ya recogidos (la recogida con Electron vive en main.js). Pocas claves (el servidor admite 25 por nivel).
function buildSnapshot(i) {
  return {
    reason: clip(i.reason || "arranque", 40),
    appVersion: clip(i.appVersion, 20),
    electron: clip(i.electron, 20),
    packaged: !!i.packaged,
    os: clip(i.os, 60),
    uptimeH: Number.isFinite(i.uptimeSec) ? Math.round(i.uptimeSec / 360) / 10 : null,
    ramGb: gb(i.totalMem),
    ramFreeGb: gb(i.freeMem),
    diskFreeGb: gb(i.diskFree),
    tempFreeGb: gb(i.tempFree),
    displays: clip((i.displays || []).slice(0, 4).map((d) => `${d.w}x${d.h}@${d.scale}`).join(" | "), 120),
    kiosk: !!i.kiosk,
    av: clip(Array.isArray(i.av) ? i.av.join(" | ") || "ninguno-registrado" : "?", 160),
    printers: clip(
      (i.printers || []).slice(0, 8).map((p) => `${clip(p.name, 40)}[${clip(p.state, 30)}]`).join(" | ") || "(ninguna)",
      MAX_TEXT,
    ),
    helpers: clip(
      (i.helpers || []).map((h) => (h.exists ? `${h.name} ${h.size}B ${h.day}` : `${h.name} FALTA`)).join(" | "),
      MAX_TEXT,
    ),
    installDir: clip(sanitizeText(i.installDir), 120),
    localeTz: clip(`${i.locale || "?"} ${i.tz || ""}`, 60),
    drawer: clip(i.drawer || "sin aperturas desde el arranque", 120),
  };
}

// Se manda una foto nueva si nunca se mando, si cambio la version o si han pasado 7 dias (poco volumen a proposito: el registro del servidor
// ya recibe ~2.000 filas al dia de otros avisos; el boton «Enviar diagnostico» da una foto al momento cuando hace falta).
const SNAPSHOT_EVERY_MS = 7 * 24 * 3600 * 1000;
function shouldSendSnapshot(prev, nowMs, version) {
  if (!prev || typeof prev !== "object" || !prev.at) return true;
  if (String(prev.version || "") !== String(version || "")) return true;
  return nowMs - Number(prev.at) > SNAPSHOT_EVERY_MS;
}

// Limitador sencillo: como mucho `max` avisos por ventana de `windowMs` (para no inundar el servidor con un error que se repite).
function makeThrottle(max, windowMs) {
  let start = 0;
  let n = 0;
  return function allow(nowMs = Date.now()) {
    if (nowMs - start > windowMs) {
      start = nowMs;
      n = 0;
    }
    if (n >= max) return false;
    n += 1;
    return true;
  };
}

// Ultimas lineas de un fichero de registro, sin rutas personales y recortadas (para el boton «Enviar diagnostico»).
function tailLines(file, count = 20) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, "r");
    try {
      const size = Math.min(st.size, 65536);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, st.size - size);
      return buf
        .toString("utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-count)
        .map((l) => clip(sanitizeText(l)));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

// Resumen de un error del proceso principal: mensaje y las primeras lineas de la pila, sin rutas personales.
function summarizeError(err, origin) {
  const e = err && typeof err === "object" ? err : { message: String(err) };
  const stack = String(e.stack || "")
    .split(/\r?\n/)
    .slice(1, 4)
    .map((l) => clip(sanitizeText(l).replace(/^\s*at\s+/, ""), 100));
  return {
    origin: clip(origin || "?", 30),
    name: clip(e.name || "Error", 40),
    message: clip(sanitizeText(e.message || e), 200),
    stack,
  };
}

module.exports = {
  SNAPSHOT_EVERY_MS,
  clip,
  sanitizeText,
  decodePrinterStatus,
  describeHelperFiles,
  buildSnapshot,
  shouldSendSnapshot,
  makeThrottle,
  tailLines,
  summarizeError,
};
