// run-two-tpv-ops-auto.js -- como run-two-tpv-ops.js (Modo Mesas, 2 TPV, guardado por partes) pero con la COMANDA AUTOMATICA encendida (2 s) y la
// impresora simulada: las lineas ya enviadas a cocina pasan a ser "en cocina" entre pasos, y se comprueba que los dos TPV y el servidor
// acaban iguales, que todo lo añadido sale solo a cocina y que nada se queda pendiente. Toda la logica esta en run-two-tpv-ops.js (--auto).
// Uso: node tools/tests/run-two-tpv-ops-auto.js
process.argv.push("--auto");
require("./run-two-tpv-ops.js");
