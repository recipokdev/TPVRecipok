function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function decodeEscapes(str) {
  return String(str || "")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function normalizeScaleConfig(input = {}) {
  return {
    enabled: !!input.enabled,
    portPath: String(input.portPath || "").trim(),

    baudRate: toInt(input.baudRate, 9600),
    dataBits: toInt(input.dataBits, 8),
    stopBits: toInt(input.stopBits, 1),
    parity: ["none", "even", "odd", "mark", "space"].includes(input.parity)
      ? input.parity
      : "none",

    parserMode: input.parserMode === "timeout" ? "timeout" : "delimiter",
    delimiter: decodeEscapes(input.delimiter || "\\r\\n"),
    interByteMs: Math.max(5, toInt(input.interByteMs, 20)),

    sourceUnit: input.sourceUnit === "kg" ? "kg" : "g",
    decimalPlaces: Math.max(0, Math.min(6, toInt(input.decimalPlaces, 0))),
    reverseReading: !!input.reverseReading,

    conversionFactor: (() => {
      const n = Number(input.conversionFactor);
      return Number.isFinite(n) && n > 0 ? n : 1;
    })(),

    consumeMode: input.consumeMode === "single" ? "single" : "continuous",

    maxAgeMs: Math.max(500, toInt(input.maxAgeMs, 5000)),
    relockToleranceGrams: Math.max(0, toInt(input.relockToleranceGrams, 2)),
  };
}

function extractNumericToken(raw) {
  const txt = String(raw || "")
    .trim()
    .replace(/,/g, ".");
  const matches = txt.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || !matches.length) return null;

  // ✅ importante: usar el ÚLTIMO valor recibido, no el primero
  return matches[matches.length - 1];
}

function parseScalePayload(raw, config = {}) {
  const cfg = normalizeScaleConfig(config);

  const originalRaw = String(raw || "");
  const workingRaw = cfg.reverseReading
    ? originalRaw.split("").reverse().join("")
    : originalRaw;

  const token = extractNumericToken(workingRaw);
  if (!token) return null;

  let num = Number(token);
  if (!Number.isFinite(num)) return null;

  const hasExplicitDecimal = token.includes(".");

  if (!hasExplicitDecimal && cfg.decimalPlaces > 0) {
    num = num / Math.pow(10, cfg.decimalPlaces);
  }

  let grams = cfg.sourceUnit === "kg" ? num * 1000 : num;
  grams = Number(grams.toFixed(3));

  if (!Number.isFinite(grams) || grams < 0) return null;

  return {
    raw: workingRaw,
    originalRaw,
    token,
    parsedValue: num,
    grams,
    kg: Number((grams / 1000).toFixed(4)),
  };
}

module.exports = {
  normalizeScaleConfig,
  parseScalePayload,
};
