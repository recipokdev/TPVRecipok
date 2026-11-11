// suites.js -- lista de pruebas de la BATERIA del TPV (ver run-battery.js y docs/bateria-de-pruebas.md).
//
// Cada entrada:
//   id        identificador corto (para --only=id1,id2)
//   area      grupo en el que sale en el informe
//   title     nombre en lenguaje claro
//   what      que comprueba, explicado para alguien que no es programador
//   args      comando de node (relativo a la raiz del proyecto)
//   level     "quick" (solo codigo, ~2 min) | "standard" (+ TPV real aislado, ~10 min) | "full" (+ TPV real contra la demo, ~40 min)
//   demo      true si usa la demo con TPV reales (perfiles tpvrecipok-2tpv-real-1/2, sin PIN) y escribe datos de prueba en ella
//   timeoutMs tiempo maximo
//   expectFail true = control negativo: la prueba se da por buena SOLO si falla (y la bateria lo detecta)
//   noCheckList true = el informe solo cuenta las comprobaciones (miles de lineas) sin listarlas una a una
//
// REGLA: toda prueba debe imprimir lineas "[OK] ..." / "[FAIL] ..." (o fijar un codigo de salida distinto de 0 al fallar).
// Una prueba que solo imprime datos para que una persona los interprete NO entra aqui.

const A = "Código y reglas internas";
const B = "Venta, aparcados y caja (TPV normal)";
const C = "Modo Mesas";
const D = "Dividir cuenta";
const E = "Varios TPV a la vez y stock";
const F = "Encargos";

const SUITES = [
  // ---------------------------------------------------------------- nivel quick: solo codigo
  {
    id: "autoprueba", area: A, level: "quick", expectFail: true, title: "Autoprueba: la batería detecta un fallo provocado",
    what: "Control negativo: una prueba falla a propósito y esta comprobación solo sale bien si la batería lo detecta. Demuestra que un fallo real no pasaría desapercibido.",
    args: ["tools/tests/battery/selftest-fail.js"], timeoutMs: 30000,
  },
  {
    id: "quick", area: A, level: "quick", title: "Sintaxis de todos los archivos",
    what: "Comprueba que ningún archivo del programa tiene errores de escritura que impidan arrancarlo.",
    args: ["tools/tests/run-quick-tests.js"], timeoutMs: 120000,
  },
  {
    id: "smoke", area: A, level: "quick", title: "Reglas internas del TPV (más de 1.300 comprobaciones)",
    what: "Revisa que cada función y arreglo importante sigue en su sitio y que las fórmulas clave (precios, IVA, descuentos, stock, división de cuentas, Encargos, actualizaciones…) dan el resultado correcto.",
    args: ["tools/tests/run-smoke-tests.js"], timeoutMs: 300000, noCheckList: true,
  },
  {
    id: "parked-ops", area: A, level: "quick", title: "Guardado por partes de los pedidos",
    what: "Comprueba la lógica que junta los cambios de varios TPV sobre un mismo pedido sin pisarse ni duplicar líneas.",
    args: ["tools/tests/run-parked-ops-tests.js"], timeoutMs: 120000,
  },

  // ---------------------------------------------------------------- nivel standard: TPV real, perfil aislado
  {
    id: "e2e-safe", area: B, level: "standard", title: "Arranque y comprobaciones seguras",
    what: "Abre el TPV de verdad en un perfil aislado y comprueba que arranca, que no da errores graves y que las opciones de seguridad se comportan.",
    args: ["tools/tests/run-e2e-safe-checks.js"], timeoutMs: 300000,
  },
  {
    id: "e2e-tpv", area: B, level: "standard", title: "Venta completa en TPV normal (demo)",
    what: "Con el TPV real: añadir productos, descuentos y precios, aparcar, recuperar, editar y borrar un pedido, abrir el cobro, imprimir el ticket y cambiar opciones.",
    args: ["tools/tests/run-e2e-demo.js"], timeoutMs: 600000,
  },
  {
    id: "e2e-mesas", area: C, level: "standard", title: "Modo Mesas: abrir, cambiar de mesa y cerrar",
    what: "Con el TPV real: entrar y salir de Modo Mesas y cambiar entre mesas con el selector rápido.",
    args: ["tools/tests/run-e2e-mesas-mode.js"], timeoutMs: 300000,
  },

  // ---------------------------------------------------------------- nivel full: TPV reales contra la demo
  {
    id: "caja-devoluciones", area: B, level: "full", demo: true, title: "Caja y devoluciones: movimientos, ventas, devoluciones y cierre",
    what: "Con el TPV real: movimientos de caja (entrada y salida), una venta en efectivo y otra con tarjeta, devolución parcial de una y total de la otra por la pantalla de Tickets. Comprueba que efectivo, total de ventas, nº de tickets y total esperado de caja suben y bajan lo justo (y que el cuadro de «Cerrar caja» muestra lo mismo), que las rectificativas quedan bien y que el stock cuadra.",
    args: ["tools/tests/run-caja-devoluciones.js"], timeoutMs: 450000,
  },
  {
    id: "mesas-lineas-sin-ops", area: C, level: "full", demo: true, title: "Mesas con 2 TPV: los productos añadidos no se pierden",
    what: "Dos TPV con la misma mesa; uno añade 4 productos seguidos. Comprueba que se guardan los 4 y que el otro TPV ve el pedido completo (guardado entero, como los clientes).",
    args: ["tools/tests/run-two-tpv-lines-lost.js", "--no-ops"], timeoutMs: 300000,
  },
  {
    id: "mesas-lineas-ops", area: C, level: "full", demo: true, title: "Mesas con 2 TPV y guardado por partes: no se pierden productos",
    what: "Lo mismo con el guardado por partes activado.",
    args: ["tools/tests/run-two-tpv-lines-lost.js"], timeoutMs: 300000,
  },
  {
    id: "mesas-borrador-viejo", area: C, level: "full", demo: true, title: "Mesas: un borrador antiguo no machaca el pedido",
    what: "Simula reiniciar con un borrador viejo de la mesa en el plano compartido y comprueba que el pedido conserva todas sus líneas al añadir un producto.",
    args: ["tools/tests/run-two-tpv-lines-lost.js", "--no-ops", "--solo-a", "--stale-draft"], timeoutMs: 300000,
  },
  {
    id: "dividir-normal", area: D, level: "full", demo: true, title: "Dividir cuenta en TPV normal y cobrar las partes",
    what: "Divide un carrito en 2 partes, cobra la primera y comprueba que se abre sola la segunda; al terminar no quedan partes y el stock cuadra.",
    args: ["tools/tests/run-split-tpv-normal.js"], timeoutMs: 400000,
  },
  {
    id: "dividir-normal-unificar", area: D, level: "full", demo: true, title: "Dividir y deshacer la división (TPV normal)",
    what: "Divide, deshace la división y cobra el pedido entero; el stock cuadra.",
    args: ["tools/tests/run-split-tpv-normal.js", "--merge"], timeoutMs: 400000,
  },
  {
    id: "dividir-mesas-ops", area: D, level: "full", demo: true, title: "Dividir cuenta en Mesas (guardado por partes)",
    what: "En Modo Mesas: dividir, cobrar la parte 1 (se abre la 2), cobrar la 2; sin pedidos duplicados ni pendientes y con el stock correcto.",
    args: ["tools/tests/run-split-tpv-normal.js", "--mesas"], timeoutMs: 400000,
  },
  {
    id: "dividir-mesas-sin-ops", area: D, level: "full", demo: true, title: "Dividir cuenta en Mesas (guardado entero)",
    what: "Lo mismo con el guardado entero, que es el que usan hoy los clientes.",
    args: ["tools/tests/run-split-tpv-normal.js", "--mesas", "--no-ops"], timeoutMs: 400000,
  },
  {
    id: "dividir-mesas-unificar", area: D, level: "full", demo: true, title: "Dividir y deshacer la división en Mesas",
    what: "Divide, deshace y cobra entero en Modo Mesas; el stock cuadra.",
    args: ["tools/tests/run-split-tpv-normal.js", "--mesas", "--no-ops", "--merge"], timeoutMs: 400000,
  },
  {
    id: "dividir-2tpv-ops", area: D, level: "full", demo: true, title: "Dividir y cobrar con 2 TPV (guardado por partes)",
    what: "Un TPV divide y cobra la parte 1; el otro abre y cobra la parte 2. Todo queda pagado, sin duplicados y con el stock correcto.",
    args: ["tools/tests/run-two-tpv-split-pay.js", "--seq"], timeoutMs: 500000,
  },
  {
    id: "dividir-2tpv-sin-ops", area: D, level: "full", demo: true, title: "Dividir y cobrar con 2 TPV (guardado entero)",
    what: "Lo mismo con el guardado entero.",
    args: ["tools/tests/run-two-tpv-split-pay.js", "--seq", "--no-ops"], timeoutMs: 500000,
  },
  {
    id: "stock-carrera", area: E, level: "full", demo: true, title: "Dos TPV cobrando el mismo producto a la vez",
    what: "Dos TPV reales cobran a la vez pedidos del mismo producto con la escritura de stock retrasada; comprueba que el stock queda exacto (sin unidades de más).",
    args: ["tools/tests/run-two-tpv-stock-race.js", "fix"], timeoutMs: 400000,
  },
  {
    id: "encargos-2tpv", area: F, level: "full", demo: true, title: "Encargos con 2 TPV: crear, recoger, cancelar y cierre de caja",
    what: "Crear con anticipo, aviso en tiempo real al otro TPV, bloqueos de recogida, recoger y cobrar, cancelar con devolución por forma de pago y cierre de caja idéntico en los dos TPV.",
    args: ["tools/tests/run-two-tpv-encargos.js"], timeoutMs: 600000,
  },
  {
    id: "encargos-editar-2tpv", area: F, level: "full", demo: true, title: "Editar encargos con 2 TPV",
    what: "Editar un encargo cuando otro TPV lo cambia, lo recoge o lo edita a la vez: conflictos detectados y nada se guarda a medias.",
    args: ["tools/tests/run-two-tpv-encargos-edit.js"], timeoutMs: 600000,
  },
  {
    id: "encargos-variantes-tiendas", area: F, level: "full", demo: true, title: "Encargos con variantes, añadidos de pago y varias tiendas",
    what: "Un encargo con una variante y un producto con añadido de pago: el pedido, la factura y el stock real son correctos; el encargo de una tienda no se ve ni reserva stock en otra.",
    args: ["tools/tests/run-encargos-variants-stores.js"], timeoutMs: 500000,
  },
];

module.exports = { SUITES, AREAS: [A, B, C, D, E, F] };
