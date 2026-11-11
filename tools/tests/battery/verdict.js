// verdict.js -- ayudante comun de la bateria: imprime cada comprobacion como "[OK] nombre -> detalle" / "[FAIL] ..." y el resumen
// "RESULTADO: n OK, m FAIL", que es lo que lee run-battery.js. Devuelve { fails, total } para fijar el codigo de salida.
// checks: [[nombre, ok(bool), detalle?], ...]
function emitVerdict(checks) {
  let fails = 0;
  for (const [name, ok, extra] of checks) {
    if (!ok) fails += 1;
    console.log(`${ok ? "[OK]  " : "[FAIL]"} ${name}${extra ? " -> " + extra : ""}`);
  }
  console.log(`\nRESULTADO: ${checks.length - fails} OK, ${fails} FAIL`);
  return { fails, total: checks.length };
}
module.exports = { emitVerdict };
