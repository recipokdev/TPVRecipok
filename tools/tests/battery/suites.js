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
const G = "Pedidos de la app de camareros";

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
    id: "comanda-auto", area: C, level: "full", demo: true, title: "Comanda automática: cuenta atrás, pausa, espera propia y «No enviar solo»",
    what: "Con el TPV real (sin imprimir de verdad): al añadir un producto se arma la cuenta atrás y sale UNA comanda; en pausa o al quitar el producto no sale nada; la espera de Opciones y la propia de la mesa se respetan; «No enviar solo» desactiva el envío hasta que cambie el pedido.",
    args: ["tools/tests/run-comanda-auto.js"], timeoutMs: 360000,
  },
  {
    id: "comanda-2tpv", area: E, level: "full", demo: true, title: "Comanda automática con 2 TPV: cada producto sale a cocina una sola vez",
    what: "Dos TPV con la misma mesa y la comanda automática activa: lo que añade uno, o los dos casi a la vez, sale a cocina una sola vez en total (no una por TPV) y los dos acaban con el mismo pedido.",
    args: ["tools/tests/run-two-tpv-comanda.js"], timeoutMs: 360000,
  },
  {
    id: "mesas-cambiar-ocupadas", area: C, level: "full", demo: true, title: "Modo Mesas: ir y volver entre dos mesas ocupadas (guardado por partes)",
    what: "Con dos mesas con pedido, se pasa de una a otra varias veces como haría el camarero: cada mesa conserva SUS productos (ninguna pisa a la otra), en el TPV y en el servidor.",
    args: ["tools/tests/run-switch-tables.js"], timeoutMs: 300000,
  },
  {
    id: "mesas-cambiar-ocupadas-sin-ops", area: C, level: "full", demo: true, title: "Modo Mesas: ir y volver entre dos mesas ocupadas (guardado entero)",
    what: "Lo mismo con el guardado entero, que es el que usan hoy los clientes.",
    args: ["tools/tests/run-switch-tables.js", "--noops"], timeoutMs: 300000,
  },
  {
    id: "mesas-mover-fusionar", area: E, level: "full", demo: true, title: "Mover y fusionar mesas con 2 TPV",
    what: "Un TPV cambia el pedido de una mesa a otra y luego fusiona dos mesas mientras el otro TPV las tiene abiertas: el pedido queda solo en el destino, nada resucita en la mesa de origen y la fusión deja un único pedido con todo.",
    args: ["tools/tests/run-two-tpv-move-merge.js"], timeoutMs: 360000,
  },
  {
    id: "mesas-en-uso", area: E, level: "full", demo: true, title: "Aviso «mesa en uso» entre 2 TPV",
    what: "Con la misma mesa abierta en dos TPV: sin aviso si es el mismo agente; con agentes distintos cada uno ve quién tiene la mesa; el aviso desaparece al cambiar de mesa o salir y reaparece al volver.",
    args: ["tools/tests/run-two-tpv-mesa-in-use.js"], timeoutMs: 360000,
  },
  {
    id: "cobro-fallido", area: C, level: "full", demo: true, title: "Cobro que falla en Mesas: el pedido sigue abierto una sola vez y se puede volver a cobrar",
    what: "Se fuerza un error de stock al cobrar una mesa (sin crear factura): sale el aviso «Cobro fallido», el pedido sigue abierto UNA vez (sin duplicado) y el otro TPV ve lo mismo. Quitado el fallo, se cobra de verdad, la mesa queda libre y el stock cuadra.",
    args: ["tools/tests/run-cobro-fallido.js"], timeoutMs: 450000,
  },
  {
    id: "mesa-libre-al-cobrar", area: C, level: "full", demo: true, title: "Cobrar una mesa la deja libre, sin duplicados ni segunda comanda",
    what: "Al marcar el pedido de una mesa como cobrado: la mesa queda libre (sin «Cuenta cobrada»), no queda pedido abierto, no sale una segunda comanda ni el botón «Enviar devolución», y el otro TPV lo ve igual.",
    args: ["tools/tests/run-mesa-libre-al-cobrar.js"], timeoutMs: 360000,
  },
  {
    id: "cobro-pedido-cambiado", area: E, level: "full", demo: true, title: "Si el pedido cambia mientras se cobra, no se cobra el total viejo",
    what: "Con 2 TPV: A abre la ventana de cobro y B añade una línea al pedido. Al confirmar, A no cobra el importe antiguo: avisa del cambio (con el importe viejo y el nuevo), no cobra nada y el pedido sigue abierto una sola vez.",
    args: ["tools/tests/run-pay-total-changed.js"], timeoutMs: 360000,
  },
  {
    id: "red-guardado-ops", area: B, level: "full", demo: true, title: "Fallos de red al guardar un pedido (guardado por partes)",
    what: "Con el TPV real se simulan tres fallos de red mientras se edita un pedido: la petición no llega, el servidor la aplica pero la respuesta se pierde, y el servidor da error 500. Al volver la red el servidor y el carrito tienen exactamente lo editado: nada perdido, nada duplicado y la cantidad no sube sola.",
    args: ["tools/tests/run-ops-network-failures.js"], timeoutMs: 360000,
  },
  {
    id: "red-guardado-entero", area: B, level: "full", demo: true, title: "Fallos de red al guardar un pedido (guardado entero)",
    what: "Lo mismo con el guardado entero, que es el que usan hoy los clientes.",
    args: ["tools/tests/run-ops-network-failures.js", "--noops"], timeoutMs: 360000,
  },
  {
    id: "camareros-autor-comanda", area: G, level: "full", demo: true, title: "Pedido de la app: sigue a nombre del camarero y su comanda sale al momento",
    what: "Un pedido creado por la API como lo hace la app de camareros (a nombre de «Cintia») no pasa a nombre del agente del TPV; las líneas enviadas conservan a la camarera y la comanda sale a su nombre, sin esperar la espera de la comanda automática (60 s) y una sola vez en total aunque haya 2 TPV.",
    args: ["tools/tests/run-app-ticket-author.js"], timeoutMs: 360000,
  },
  {
    id: "camareros-escribe-con-ops", area: G, level: "full", demo: true, title: "La app escribe el mismo pedido que el TPV con guardado por partes",
    what: "La app guarda el pedido entero (como siempre) mientras el TPV usa el guardado por partes: líneas nuevas, pedido reescrito sin identificadores (sin pisar precios a 0 €), cambios a la vez en la misma cantidad y una versión caducada que el servidor rechaza (412). No se pierde ni se duplica nada.",
    args: ["tools/tests/run-app-writes-vs-tpv-ops.js"], timeoutMs: 360000,
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

module.exports = { SUITES, AREAS: [A, B, C, D, E, F, G] };
