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
    id: "billetes-cobro", area: B, level: "standard", title: "Cobro: botones de billetes rápidos (5, 10, 20 y 50 €)",
    what: "Abre el TPV en un perfil aislado, sin red, y comprueba los botones de billetes del modal de cobro: salen debajo del teclado, pulsar varios suma sus importes como entregado en efectivo (2×5 = 10; 5+10+20 = 35) con su cambio, también sobre un importe tecleado con coma o decimales, con la tarjeta seleccionada va al efectivo sin tocar la tarjeta, se recorta la tarjeta si el billete cubre el total, se ocultan si no hay efectivo y no se pueden pulsar en un ticket gratuito. No toca la demo.",
    args: ["tools/tests/run-pay-bills.js"], timeoutMs: 150000,
  },
  {
    id: "escala-interfaz", area: B, level: "standard", title: "Escala de la interfaz: ajuste manual hasta 150 % y pantalla detectada",
    what: "Abre el TPV en un perfil aislado, sin red, y comprueba que Opciones ofrece 110, 125 y 150 % además de 100 % y menos, que el ajuste manual se respeta (sin recortarlo al 100 %) y se recorta a 150 % si el valor es absurdo, que el automático nunca amplía, que la ventana aplica el zoom guardado al recargar y que Opciones muestra la pantalla detectada. No toca la demo.",
    args: ["tools/tests/run-ui-zoom.js"], timeoutMs: 150000,
  },
  {
    id: "actualizar-al-reanudar", area: B, level: "standard", title: "Actualizar al reanudar el equipo de la suspensión",
    what: "Abre el TPV en un perfil aislado, sin red, con un actualizador y una consulta de caja falsos, y comprueba que al despertar el equipo solo ofrece actualizar si hay versión nueva Y la caja está cerrada según el servidor Y no hay nada en marcha (carrito, cobro, otras ventanas, sin conexión, ventas sin enviar), que no actúa si se desactiva en Opciones o no se puede consultar la caja, que muestra la cuenta atrás cancelable, que aceptar reinicia una sola vez y que posponer no vuelve a molestar en 6 horas. No toca la demo.",
    args: ["tools/tests/run-update-on-resume.js"], timeoutMs: 150000,
  },
  {
    id: "actualizar-si-inactivo", area: B, level: "standard", title: "Actualizar solo tras un rato sin usar el TPV",
    what: "Abre el TPV en un perfil aislado, sin red, con un actualizador falso y el reloj adelantado, y comprueba que con la versión nueva ya descargada solo se ofrece actualizar tras 10 minutos sin tocar la pantalla con la caja cerrada (30 con la caja abierta, 6 horas con Mesas en pantalla), que no actúa con carrito, cobro, otras ventanas, sin conexión, sin descarga lista o si se desactiva en Opciones, que no insiste en 2 horas tras un intento ni en 3 horas tras posponer, y que aceptar reinicia una sola vez. No toca la demo.",
    args: ["tools/tests/run-update-when-idle.js"], timeoutMs: 150000,
  },
  {
    id: "diagnostico-remoto", area: B, level: "standard", title: "Diagnóstico remoto: foto del equipo, botón de soporte y detalle del cajón",
    what: "Comprueba que la foto del equipo (versión, Windows, memoria, disco, pantallas, impresoras con su estado para Windows, programas auxiliares del cajón con su tamaño) cumple los límites del servidor, no lleva datos personales (el nombre de usuario de Windows se quita de las rutas, también si tiene espacios) y se manda como mucho una vez por semana o al cambiar de versión; el limitador de avisos; las últimas líneas del registro; el detalle de cada programa auxiliar del cajón (existe, tamaño, resultado de cada pin, tiempo). Con el TPV abierto, sin red: la foto se recoge, el botón «Enviar diagnóstico a soporte» existe y no falla sin servidor, el TPV recuerda sus últimos avisos, el tope de 8 avisos de cajón al día y que un error del proceso principal queda anotado. Nunca manda nada a un servidor ni toca la demo.",
    args: ["tools/tests/run-diagnostics.js"], timeoutMs: 170000,
  },
  {
    id: "opciones-acceso-rapido", area: B, level: "standard", title: "Opciones: favoritas, historial, buscador, «Nuevo» y «Cambiadas»",
    what: "Abre el TPV en un perfil aislado y sin red y comprueba las mejoras de Opciones, que se van añadiendo por pasos. Por ahora: que en un TPV nuevo todos los grupos de Opciones salen cerrados (antes salía «Caja» abierto) y que un terminal que ya tenía grupos guardados los conserva tal cual; y las favoritas: una estrella por opción, el bloque «Favoritas» de arriba (los interruptores se cambian desde el propio bloque, el resto te lleva a su fila), que se guardan y se recuperan en el mismo orden, que hay un máximo de 12, que una favorita de un apartado de administrador no se muestra sin serlo y que el bloque se oculta al buscar; y el historial de «Últimos cambios»: solo cambios netos al cerrar Opciones, una entrada por opción que sube arriba y actualiza su hora, máximo 8, se guarda y se recupera, no apunta el puerto de la báscula ni el valor del cliente por defecto, se pliega y se despliega, pulsar una entrada lleva a la opción, no muestra entradas de opciones de administrador sin serlo y el rastro al servidor sigue igual; y el buscador: palabras parecidas («monedero» encuentra «Abrir cajón», sin tildes, solo una palabra de 3 o más letras, con aviso debajo) y las últimas 5 búsquedas (sin repetir, solo al elegir un resultado o pulsar Intro, salen al pulsar el buscador vacío, se repiten con un toque, se borran, se guardan); y recordar dónde te quedaste: al reabrir Opciones en menos de 10 minutos la lista vuelve a su punto, pasado ese tiempo no, no se guarda si estaba arriba del todo ni si se cerró con una búsqueda activa, y no pisa lo guardado con Opciones ocultas; y la marca «Nuevo»: solo las opciones recientes (no las antiguas ni las de administrador a quien no lo es), en la fila, en el grupo y como puntito, una sola vez por opción al repintar, se descarta pulsándola o cambiando la opción, caduca a los 14 días, no empieza a contar con Opciones cerradas y el estado se guarda; y el filtro «Cambiadas»: toda opción del catálogo tiene su valor de fábrica o está marcada sin estándar (obliga a decidirlo al añadir una nueva), la cuenta solo incluye lo cambiado y visible para el usuario, el modo kiosco viene apagado, un control sin cargar no cuenta, el filtro muestra solo esas filas con su valor de fábrica, se combina con la búsqueda, restaura los grupos al apagarse y se apaga al cerrar Opciones; y la ayuda «?»: cada ayuda es de una opción que existe en el catálogo y en pantalla y son frases cortas sin repetir, un botón por fila sin duplicarse al repintar, abre y cierra la explicación dentro de la propia fila sin tocar la opción ni mover filas, convive con la estrella y no ensucia el texto de búsqueda; y «Distintas de fábrica» como cuarta pestaña (exclusiva con las demás, con su línea explicativa, visible al buscar con el filtro encendido y apagada al cerrar Opciones) y que ninguna ayuda «?» repita lo que ya dice su fila (con el propio detector probado); y las pestañas del acceso rápido (solo una línea al abrir, Favoritas y Recientes con su cuenta y de una en una, volver a pulsar cierra, se recuerda la última, «Recientes» desaparece sin cambios y todo se oculta al buscar); y copiar opciones a otro terminal: la lista blanca (cada opción existe y no cuela impresoras, báscula, kiosco, teclado ni actualización), exportar trae tipo/versión/fecha y solo esas opciones, importar rechaza lo que no es de opciones o es de una versión más nueva, descarta valores que no valen (tipo, lista, rango, decimal, descuentos mal formados) e ignora lo que no está en la lista, enseña «antes → después» y no cambia nada hasta aceptar, aplica por el camino normal de cada opción (se guarda de verdad), se puede deshacer respetando lo cambiado a mano después (caduca a las 24 h), cancelar no cambia nada, lo que este terminal no ve no se aplica, y el paso real por el proceso principal (guardar/leer el archivo, rechazar no-JSON y archivos de más de 200 KB, cancelar). No toca la demo.",
    args: ["tools/tests/run-options-quick-access.js"], timeoutMs: 150000,
  },
  {
    id: "cajon-programa-auxiliar", area: B, level: "standard", title: "Apertura del cajón: programa auxiliar diminuto y plan B",
    what: "Comprueba que el programa auxiliar nuevo del cajón (unos KB, en lugar de 64 MB) se comporta igual que el de siempre (mismos mensajes y códigos de salida, también contra una impresora de pruebas con puerto a fichero que se crea y se borra) y la cadena de intentos que usa el TPV: responde el pequeño, si falta o está roto se prueba el de siempre, si no se puede ejecutar ninguno el error trae el detalle de los dos y no rompe la llamada (antes un ejecutable bloqueado lanzaba una excepción). Con el TPV abierto, sin red, comprueba los avisos que ve el cajero (impresora que no responde, programa bloqueado por el antivirus, error genérico) y que el fallo se avisa a nuestro servidor. Nunca toca una impresora real ni la demo.",
    args: ["tools/tests/run-drawer-helper.js"], timeoutMs: 300000,
  },
  {
    id: "vigilante-instalacion", area: B, level: "standard", title: "Vigilante de instalaciones (piezas y casos de fallo)",
    what: "Sin abrir el TPV: lanza el vigilante de instalación (PowerShell) con instaladores falsos y un servidor de avisos local, y comprueba once casos: que detecta el fallo en segundos y no en minutos, que se recupera al segundo intento sin que aparezca ningún icono a la vista, instalación correcta (no avisa de nada y borra la clave), sin programa y con reinstalación que funciona, reinstalación que siempre falla (abre el instalador con ventanas y reapunta el icono en blanco del escritorio al instalador), programa presente pero sin abrir (lo abre), programa abierto pero sin mostrarse (no toca nada), instalador lento, sin instalador guardado, dos vigilantes a la vez y que el vigilante sigue vivo aunque se cierre el programa que lo lanzó (también con rutas con espacios). Comprueba además la copia del instalador de reparación y la lectura de la carpeta de descargas. No toca la demo.",
    args: ["tools/tests/run-install-watchdog.js"], timeoutMs: 400000,
  },
  {
    id: "seguridad-instalacion", area: B, level: "full", title: "Red de seguridad de la instalación, con un TPV empaquetado",
    what: "Monta un TPV empaquetado de pruebas y un falso servidor de actualizaciones que ofrece una versión 9.9.9 cuyo instalador no instala nada (el fallo de Ben_Trempat), y comprueba que antes de cerrarse el TPV deja en el registro quién pidió la actualización, la versión de Windows y el instalador, guarda la copia de reparación, crea el icono REPARAR en un escritorio de pruebas y lanza el vigilante, que detecta que la versión nueva no avisa; y que cuando un TPV nuevo se ve con normalidad el icono y la copia se quitan solos. Necesita internet. No toca la demo, el escritorio real ni la carpeta de descargas real.",
    args: ["tools/tests/run-install-safetynet.js"], timeoutMs: 330000,
  },
  {
    id: "logo-termico", area: B, level: "standard", title: "Logo en blanco y negro puro para impresoras térmicas",
    what: "Abre el TPV en un perfil aislado, sin red, y con imágenes generadas por la propia prueba comprueba que una caligrafía de color (como la de Los Argentinos) se convierte en negro y blanco puros del tamaño exacto de impresión (8 puntos por mm), que una foto o un degradado se deja como estaba, que lo transparente sale blanco, que el interruptor de Opciones lo apaga y que si la imagen no se puede leer no falla. No toca la demo.",
    args: ["tools/tests/run-thermal-logo.js"], timeoutMs: 150000,
  },
  {
    id: "comanda-copia-viva", area: C, level: "standard", title: "Confirmar una comanda cuando el pedido de la lista ya fue sustituido",
    what: "Abre el TPV en un perfil aislado, sin red, y simula lo que ocurría con la app de camareros: mientras se espera a la impresora, la sincronización con el servidor sustituye el pedido de la lista. Comprueba que la confirmación de la comanda (número de comanda y sello de cada línea) llega a la copia que sigue viva, que no hace retroceder una copia más nueva, y que el caso normal y el pedido que ya no está en la lista siguen igual. Antes del arreglo la línea impresa volvía a salir como «sin enviar». No toca la demo.",
    args: ["tools/tests/run-comanda-live-ticket.js"], timeoutMs: 120000,
  },
  {
    id: "vaciar-mesa-de-la-app", area: C, level: "standard", title: "Vaciar una mesa cuyo pedido creó la app de camareros",
    what: "Abre el TPV en un perfil aislado, sin red, y comprueba que cuando el cajero quita todas las líneas de un pedido creado por la app de camareros (su identificador lleva texto, no solo números) se activa el guardado del pedido vacío, igual que con un pedido numérico; que un carrito vacío por otra causa no se guarda vacío; y que la marca se retira al añadir una línea o cambiar de pedido. Antes del arreglo las líneas quitadas se quedaban en el servidor. No toca la demo.",
    args: ["tools/tests/run-empty-table-app-ticket.js"], timeoutMs: 120000,
  },
  {
    id: "e2e-tpv", area: B, level: "standard", title: "Venta completa en TPV normal (demo)",
    what: "Con el TPV real: añadir productos, descuentos y precios, aparcar, recuperar, editar y borrar un pedido, abrir el cobro, imprimir el ticket y cambiar opciones.",
    args: ["tools/tests/run-e2e-demo.js"], timeoutMs: 600000,
  },
  {
    id: "ticket-impreso", area: B, level: "standard", title: "Contenido de lo impreso: ticket, cierre de caja y comanda de cocina (sin imprimir de verdad)",
    what: "Genera el ticket tal como se mandaría a la impresora y comprueba su contenido: datos de la empresa, número, fecha, cliente, terminal y agente, cada línea con su cantidad e importe, descuentos, añadidos, packs, cuentas divididas, resumen de IVA, total, entregado y cambio, y el tipo de documento (simplificada, general, rectificativa, devolución, no facturado). También el informe de cierre de caja (totales, formas de pago, agentes, observaciones) y la comanda de cocina (mesa, camarero, líneas, añadidos, devolución, reimpresión). No toca la demo ni la impresora.",
    args: ["tools/tests/run-ticket-print.js"], timeoutMs: 200000,
  },
  {
    id: "puerta-actualizacion", area: B, level: "full", title: "Arranque con GitHub caído o sin respuesta del servidor de la empresa",
    what: "Arranca un TPV empaquetado de pruebas contra un «GitHub» falso: con un 504 sale el aviso con contador y el botón «Entrar ahora» a los 10 s, no se abre solo con la versión vieja y al pulsar abre en segundos; si GitHub vuelve, se abre solo; sin novedades abre directo; y con el servidor de la empresa caído también hay contador y botón. Si una instalación de la versión nueva falló hace poco, abre con la actual sin volver a intentarlo en cada arranque; y si el servidor pone a ese cliente en «pausa de actualizaciones», abre con la actual sin pedir ni instalar nada (y, como control, sin pausa sí intenta instalar). No toca la demo ni los accesos directos del equipo. Necesita internet.",
    args: ["tools/tests/run-update-gate.js"], timeoutMs: 600000,
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
    id: "mesas-vista-2tpv", area: C, level: "full", demo: true, title: "Mesas con 2 TPV: los dos ven lo mismo (carrito, barra «Enviar comanda» y deshacer)",
    what: "Dos TPV abren la misma mesa. Uno añade un producto y sube la cantidad; se comprueba que el otro lo ve solo, que la barra «Enviar comanda» cuenta líneas (no unidades), que hay un único pedido compartido y que no sale nada a cocina antes de tiempo.",
    args: ["tools/tests/run-two-tpv-vista.js"], timeoutMs: 360000,
  },
  {
    id: "ops-2tpv-mesas", area: E, level: "full", demo: true, title: "Guardado por partes con 2 TPV en Modo Mesas: cambios a la vez en el mismo pedido",
    what: "Dos TPV editan a la vez el pedido de la misma mesa: líneas distintas, +1 a la misma línea y una línea que uno quita mientras el otro la edita. Se comprueba que los dos TPV y el servidor acaban con exactamente lo mismo, sin perder ni duplicar nada.",
    args: ["tools/tests/run-two-tpv-ops.js"], timeoutMs: 360000,
  },
  {
    id: "ops-2tpv-mesas-comanda", area: C, level: "full", demo: true, title: "Dos TPV tocando la misma mesa con la comanda automática encendida",
    what: "Lo mismo que la prueba de cambios a la vez en Modo Mesas, pero con la comanda automática activa: las líneas ya enviadas a cocina se suben, se quitan y se editan desde los dos TPV a la vez. Comprueba que los dos TPV y el servidor acaban iguales, que todo lo añadido sale solo a cocina y que no queda nada pendiente.",
    args: ["tools/tests/run-two-tpv-ops-auto.js"], timeoutMs: 360000,
  },
  {
    id: "ops-2tpv-normal", area: E, level: "full", demo: true, title: "Guardado por partes con 2 TPV en TPV normal: cambios a la vez en el mismo aparcado",
    what: "Lo mismo que la prueba anterior pero con un pedido aparcado del TPV normal (sin Modo Mesas).",
    args: ["tools/tests/run-two-tpv-ops-normal.js"], timeoutMs: 360000,
  },
  {
    id: "ops-2tpv-cobro", area: E, level: "full", demo: true, title: "Dos TPV cobrando el mismo aparcado a la vez, y cobrar mientras el otro añade una línea",
    what: "COBRA DE VERDAD en la demo (2 facturas de prueba). Los dos pulsan Cobrar sobre el mismo pedido: solo se crea una factura. Después uno cobra mientras el otro añade una línea: la línea no se factura ni se pierde sin avisar, y el stock cuadra.",
    args: ["tools/tests/run-two-tpv-ops-pay.js"], timeoutMs: 360000,
  },
  {
    id: "editar-y-cobrar-2tpv", area: E, level: "full", demo: true, title: "Caso real de Asador: un TPV quita y añade un plato y cobra enseguida, y dos cajeros tocando el mismo pedido",
    what: "COBRA DE VERDAD en la demo (2 facturas de prueba). Un TPV aparca, otro lo abre, quita un plato, añade otro y cobra a los 150 ms: sale una sola factura y un solo pedido cobrado con las líneas finales, en guardado entero (el de Asador) y por partes. Después, dos cajeros editan el mismo pedido a la vez: con el guardado por partes convergen siempre y se suman las dos ediciones (comprobación obligatoria); con el guardado entero antiguo es un hueco conocido e intermitente (el guardado de uno pisa al del otro), por eso esa parte sale solo como informativa. El stock cuadra y queda restaurado.",
    args: ["tools/tests/run-two-tpv-edit-and-pay.js"], timeoutMs: 480000,
  },
  {
    id: "servicio-desactivado", area: A, level: "full", demo: true, title: "Servicio desactivado: clave de API rechazada",
    what: "Se simula (solo en memoria, sin tocar el servidor) que la clave de FacturaScripts de la empresa deja de valer. Si en clients.json hay una clave nueva que funciona, el TPV la adopta solo y no se bloquea. Si la clave está desactivada de verdad, el TPV se bloquea con el aviso «Servicio desactivado», deja de llamar a los servidores, no guarda ninguna venta pendiente y no guarda la clave mala; y cuando la clave vuelve a valer, pulsando Reintentar se reanuda solo.",
    args: ["tools/tests/run-service-suspended.js"], timeoutMs: 260000,
  },
  {
    id: "empresa-por-email", area: A, level: "standard", title: "Activación y arranque: el TPV pregunta por UN email en vez de descargar la lista de clientes",
    what: "Fase 1 de privacidad. Contra un servidor falso local (sin red ni demo) se comprueba que el TPV pregunta por su email con una sola petición (con la clave compartida y el email en el cuerpo, no en la dirección) y entiende las tres respuestas: activo (con su clave), de baja y desconocido. Si el servidor responde «demasiadas peticiones» respeta el tiempo de espera y no insiste; si el servidor aún no tiene el servicio nuevo cae al fichero de siempre; y los fallos del servidor se tratan como falta de conexión. En el arranque comprueba que con la empresa guardada hace una sola petición y refresca la clave, bloquea una cuenta de baja, conserva lo guardado si el email ya no existe o no hay conexión sin pedir el email por error, y que la primera activación avisa «Email no encontrado» y vuelve a preguntar. También la autocuración de claves.",
    args: ["tools/tests/run-resolve-company.js"], timeoutMs: 200000,
  },
  {
    id: "mesas-boton-al-cargar", area: C, level: "full", demo: true, title: "Pulsar Mesas mientras el TPV todavía está cargando",
    what: "Se pulsa el botón de Mesas justo al arrancar, antes de que termine la carga: el TPV lo recuerda, avisa «entrará en Modo Mesas al terminar» y entra solo en Modo Mesas cuando acaba de cargar (antes no hacía nada y sin aviso).",
    args: ["tools/tests/run-mesas-button-during-load.js"], timeoutMs: 200000,
  },
  {
    id: "ops-2tpv-dividir", area: D, level: "full", demo: true, title: "Dividir la cuenta mientras otro TPV sube una cantidad (guardado por partes)",
    what: "Un TPV divide la cuenta de la mesa en 2 partes mientras el otro sube la cantidad de una línea: quedan solo las 2 partes, las dos pantallas ven lo mismo y no se duplica ni se pierde ninguna unidad.",
    args: ["tools/tests/run-two-tpv-ops-split.js"], timeoutMs: 360000,
  },
  {
    id: "recuperacion-pantalla", area: B, level: "full", demo: true, title: "Recuperación al volver: suspensión del equipo, catálogo vacío y caída de la pantalla",
    what: "Simula que el equipo se suspende y se reanuda, que la API devuelve 0 productos, que la pantalla se queda sin artículos y que el proceso de dibujo se cae: el TPV recarga solo el catálogo, conserva el anterior si el servidor responde vacío, no recarga en bucle ni con un carrito a medias, y deja constancia en el registro.",
    args: ["tools/tests/run-resume-refresh.js"], timeoutMs: 660000,
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
  {
    id: "caja-abrir-cerrar", area: B, level: "full", demo: true, title: "Cerrar y abrir la caja de verdad (la última: cierra la caja compartida de la demo y abre otra)",
    what: "Cierra la caja de la demo por la pantalla real contando 70 €, comprueba el informe que saldría impreso (totales, esperado, contado y diferencia) y que FacturaScripts la deja cerrada; luego abre una caja nueva con 100 € y comprueba que empieza a cero y que un segundo TPV se engancha a ella. Si algo falla a medias, vuelve a abrir la caja. Deja una caja cerrada más en la demo; no lanzar mientras alguien prueba en ella.",
    args: ["tools/tests/run-caja-open-close.js"], timeoutMs: 660000,
  },
];

module.exports = { SUITES, AREAS: [A, B, C, D, E, F, G] };
