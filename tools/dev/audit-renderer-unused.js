const fs = require("fs");
const path = require("path");

const ESLINT_JSON_PATH = path.resolve("tools/dev/eslint-renderer.json");
const RENDERER_PATH = path.resolve("renderer.js");

function readTextAuto(filePath) {
  const buf = fs.readFileSync(filePath);

  // UTF-16 LE BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString("utf16le").replace(/^\uFEFF/, "");
  }

  // UTF-16 BE BOM (rare)
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf);
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const t = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = t;
    }
    return swapped.toString("utf16le").replace(/^\uFEFF/, "");
  }

  return buf.toString("utf8").replace(/^\uFEFF/, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countWholeWord(text, symbol) {
  const rx = new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "g");
  return (text.match(rx) || []).length;
}

function parseUnusedNames(eslintJsonText) {
  const payload = JSON.parse(eslintJsonText);
  const messages = (payload[0] && payload[0].messages) || [];

  const names = messages
    .filter((m) => m.ruleId === "no-unused-vars")
    .map((m) => {
      const found = String(m.message || "").match(/'([^']+)'/);
      return found ? found[1] : "";
    })
    .filter(Boolean);

  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function main() {
  const eslintJson = readTextAuto(ESLINT_JSON_PATH);
  const rendererCode = fs.readFileSync(RENDERER_PATH, "utf8");

  const names = parseUnusedNames(eslintJson);
  const rows = names
    .map((name) => ({
      name,
      count: countWholeWord(rendererCode, name),
    }))
    .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));

  const trulyUnused = rows.filter((r) => r.count <= 1);

  console.log(`total no-unused-vars symbols: ${rows.length}`);
  console.log(`symbols with only one occurrence (likely dead): ${trulyUnused.length}`);
  console.log("--- likely dead symbols ---");
  for (const row of trulyUnused) {
    console.log(`${row.name}\t${row.count}`);
  }

  console.log("--- other no-unused-vars symbols (count > 1) ---");
  for (const row of rows.filter((r) => r.count > 1)) {
    console.log(`${row.name}\t${row.count}`);
  }
}

main();
