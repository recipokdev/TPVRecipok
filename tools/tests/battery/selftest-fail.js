// selftest-fail.js -- CONTROL NEGATIVO de la bateria: falla a proposito (una comprobacion «[FAIL]» y codigo de salida 1).
// run-battery.js lo marca con expectFail: la prueba se da por buena SOLO si la bateria detecta ese fallo. Asi se demuestra
// en cada informe que un fallo real no pasaria desapercibido.
console.log("[OK]   comprobación de ejemplo que sale bien");
console.log("[OK]   otra comprobación de ejemplo que sale bien");
console.log("[FAIL] fallo provocado a propósito para comprobar que la batería lo detecta");
process.exit(1);
