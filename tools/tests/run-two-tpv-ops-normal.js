// run-two-tpv-ops-normal.js -- el mismo guion que run-two-tpv-ops.js pero en TPV NORMAL (pedido aparcado de prueba en vez de la mesa M3).
// Se mantiene como archivo aparte por compatibilidad con la bateria y los atajos; toda la logica esta en run-two-tpv-ops.js (--normal).
// Uso: node tools/tests/run-two-tpv-ops-normal.js
process.argv.push("--normal");
require("./run-two-tpv-ops.js");
