"use strict";
// Apertura del cajon en Windows: cadena de programas auxiliares equivalentes (proceso main). Sin dependencias de Electron: se prueba con Node.
//
// Se prueban DOS programas auxiliares equivalentes (mismos argumentos y mismos mensajes de error):
//   1. open-drawer-lite.exe: diminuto (unos KB, .NET Framework 4 que ya trae Windows), sin descompresion en la carpeta temporal.
//   2. open-drawer.exe: el de siempre, .NET 8 autocontenido de 64 MB sin firmar.
// Caso real (Los Argentinos, 2026-11-19): tras una actualizacion el cajon dejo de abrir con el aviso generico; el codigo no habia cambiado, asi
// que lo mas probable es que algo del sistema (antivirus) impidiera ejecutar el programa de 64 MB. Si el primero NO SE PUEDE EJECUTAR (falta,
// bloqueado, no arranca, tiempo agotado) se prueba el otro. Si el programa SI se ejecuta y Windows dice que la impresora no existe / no
// responde, ese resultado es el bueno: el otro programa diria lo mismo.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PRINTER_LEVEL_ERROR = /OpenPrinter failed|StartDocPrinter failed|StartPagePrinter failed|WritePrinter failed/i;

function defaultHelpers(assetsDir) {
  return [
    { name: "lite", file: path.join(assetsDir, "open-drawer-lite.exe"), timeout: 10000 },
    { name: "net8", file: path.join(assetsDir, "open-drawer.exe"), timeout: 30000 }, // el autocontenido se descomprime la 1a vez
  ];
}

function runPin(helper, deviceName, pin) {
  return new Promise((resolve) => {
    // OJO: con un ejecutable inservible (bloqueado, danado, sustituido por el antivirus...) execFile LANZA la excepcion en el acto
    // ("spawn UNKNOWN"/"EPERM") en lugar de llamar al callback; el codigo anterior no lo cubria y rompia toda la llamada.
    try {
      execFile(
        helper.file,
        [deviceName, String(pin)],
        { windowsHide: true, timeout: helper.timeout || 15000 },
        (err, stdout, stderr) => {
          if (err) {
            const why = err.killed ? `tiempo agotado (${helper.timeout || 15000} ms)` : "";
            resolve({ ok: false, pin, error: (stderr || why || err.message || String(err)).trim() });
          } else {
            resolve({ ok: true, pin, out: (stdout || "").trim() });
          }
        },
      );
    } catch (e) {
      resolve({ ok: false, pin, error: String((e && (e.message || e.code)) || e).trim() });
    }
  });
}

// Devuelve { ok, pin, out?, error?, via? }. `via` = programa que dio la respuesta definitiva.
async function openDrawerViaHelpers(deviceName, helpers) {
  const problems = [];
  for (const helper of helpers) {
    if (!fs.existsSync(helper.file)) {
      problems.push(`${helper.name}: No existe ${path.basename(helper.file)} en: ${path.dirname(helper.file)}`);
      continue;
    }
    let r = await runPin(helper, deviceName, 0);
    if (!r.ok) r = await runPin(helper, deviceName, 1);
    if (r.ok) return { ...r, via: helper.name };
    if (PRINTER_LEVEL_ERROR.test(r.error)) return { ...r, via: helper.name }; // el programa funciona; es la impresora / Windows
    problems.push(`${helper.name}: ${String(r.error).slice(0, 200)}`);
  }
  return { ok: false, error: problems.join(" | ") || "sin programa auxiliar para abrir el cajón" };
}

module.exports = { defaultHelpers, openDrawerViaHelpers, PRINTER_LEVEL_ERROR };
