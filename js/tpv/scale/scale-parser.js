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
  const dataBits = toInt(input.dataBits, 8);
  const stopBits = toInt(input.stopBits, 1);
  const baudRate = Math.max(300, toInt(input.baudRate, 9600));

  return {
    enabled: !!input.enabled,
    portPath: String(input.portPath || "").trim(),

    baudRate,
    dataBits: dataBits === 7 ? 7 : 8,
    stopBits: stopBits === 2 ? 2 : 1,
    parity: ["none", "even", "odd", "mark", "space"].includes(input.parity)
      ? input.parity
      : "none",

    parserMode: input.parserMode === "timeout" ? "timeout" : "delimiter",
    delimiter: decodeEscapes(input.delimiter || "\\r\\n"),
    interByteMs: Math.max(5, toInt(input.interByteMs, 20)),

    // visibles
    chargeUnit: input.chargeUnit === "kg" ? "kg" : "g",
    decimalPlaces: Math.max(0, Math.min(6, toInt(input.decimalPlaces, 4))),
    consumeMode: input.consumeMode === "single" ? "single" : "continuous",

    // internos / fallback
    sourceUnit: input.sourceUnit === "kg" ? "kg" : "g",
    reverseReading: !!input.reverseReading,
    conversionFactor: (() => {
      const n = Number(input.conversionFactor);
      return Number.isFinite(n) && n > 0 ? n : 1;
    })(),

    maxAgeMs: Math.max(500, toInt(input.maxAgeMs, 5000)),
    relockToleranceGrams: Math.max(0, toInt(input.relockToleranceGrams, 2)),
  };
}

function extractAllNumericTokens(raw) {
  const txt = String(raw || "")
    .trim()
    .replace(/,/g, ".");
  return txt.match(/-?\d+(?:\.\d+)?/g) || [];
}

function parseWgtPayload(raw) {
  const txt = String(raw || "")
    .trim()
    .replace(/,/g, ".");

  const m = txt.match(/WGT:\s*\d+\s+(-?\d+(?:\.\d+)?)P\s*(-?\d+(?:\.\d+)?)/i);
  if (!m) return null;

  const kg = Number(m[1]);
  if (!Number.isFinite(kg) || kg < 0) return null;

  const grams = Number((kg * 1000).toFixed(6));

  return {
    raw: txt,
    originalRaw: txt,
    token: m[1],
    parsedValue: kg,
    grams,
    kg: Number(kg.toFixed(6)),
    detectedUnit: "kg",
    parserKind: "wgt",
  };
}

function parseReversedEqualsPayload(raw) {
  const original = String(raw || "").trim();
  if (!original.includes("=")) return null;
  if (/[A-Za-z]/.test(original)) return null;

  const reversed = original.split("").reverse().join("").replace(/,/g, ".");
  const tokens = extractAllNumericTokens(reversed);
  if (!tokens.length) return null;

  const token = tokens[0];
  const grams = Number(token);

  if (!Number.isFinite(grams) || grams < 0) return null;

  return {
    raw: reversed,
    originalRaw: original,
    token,
    parsedValue: grams,
    grams: Number(grams.toFixed(6)),
    kg: Number((grams / 1000).toFixed(6)),
    detectedUnit: "g",
    parserKind: "reversed_equals",
  };
}

function parseGenericPayload(raw, config = {}) {
  const cfg = normalizeScaleConfig(config);

  const originalRaw = String(raw || "").trim();
  const workingRaw = cfg.reverseReading
    ? originalRaw.split("").reverse().join("")
    : originalRaw;

  const tokens = extractAllNumericTokens(workingRaw);
  if (!tokens.length) return null;

  const token = tokens[tokens.length - 1];
  let num = Number(token);
  if (!Number.isFinite(num) || num < 0) return null;

  let grams = cfg.sourceUnit === "kg" ? num * 1000 : num;
  grams = Number(grams.toFixed(6));

  return {
    raw: workingRaw,
    originalRaw,
    token,
    parsedValue: num,
    grams,
    kg: Number((grams / 1000).toFixed(6)),
    detectedUnit: cfg.sourceUnit,
    parserKind: "generic",
  };
}

function parseScalePayload(raw, config = {}) {
  const txt = String(raw || "");

  return (
    parseWgtPayload(txt) ||
    parseReversedEqualsPayload(txt) ||
    parseGenericPayload(txt, config)
  );
}

module.exports = {
  normalizeScaleConfig,
  parseScalePayload,
};
