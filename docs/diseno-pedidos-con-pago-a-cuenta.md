# Pedidos con pago a cuenta: propuesta de diseño (borrador)

Fecha: 2026-10-29 (actualizado el mismo día con las pantallas y, por la noche, con las respuestas del jefe). Estado: borrador. Todavía no se ha programado nada.

**Decisiones del jefe (29-oct, 19:02):** (1) el IVA no se tiene en cuenta en el anticipo: no genera factura hasta que se liquida el total; (2) el módulo se puede **activar o desactivar**, **desactivado por defecto**, con un **aviso especial (popup) de la novedad**, y hay que enviar un correo a los usuarios con TPV para que lo sepan; (3) se llamará **«Encargos»**; (4) el encargo **debe poder editarse desde la primera versión**.

**Nombre en pantalla:** **«Encargos»** (confirmado por el jefe) y no «Pedidos»: en Modo Mesas el botón de aparcados ya se llama «Pedidos», y un restaurante con Modo Mesas tendría dos cosas con el mismo nombre. En este documento, «pedido» y «encargo» son lo mismo.

## 1. Qué se quiere (resumen de la especificación)

- Una sección **Encargos**, aparte de las ventas, que **se puede activar o desactivar** y viene **desactivada por defecto**. Al llegar la versión que la incluye, sale una vez un aviso de la novedad. *(Historial: el texto original decía «habilitable por cliente»; Sergi propuso que fuera para todos; el jefe ha decidido finalmente «activable y apagada por defecto, con aviso». Ver apartado 3c.)*
- El **anticipo no genera factura ni IVA** en ese momento: es un cobro a cuenta con su justificante. La factura (con su IVA) se emite al liquidar el total.
- El encargo **se puede editar** después de crearlo (apartado 3d).
- Se crea un pedido con los productos. El cliente puede **pagar una parte (anticipo)** ese día.
- El anticipo **cuenta en la caja del día en que se cobra**. El resto, en la caja del día en que se recoge.
- El pedido **no cuenta como venta ni toca el stock hasta que se recoge**. Estados visibles: «falta recoger» y «recogido».
- Crear y cobrar pedidos puede hacerlo cualquier trabajador. El anticipo admite cualquier forma de pago. Se imprimen (y se pueden enviar por correo) el resguardo del pedido y el justificante del anticipo.

## 2. Recomendación en una frase

**Guardar el pedido como pedido de FacturaScripts, guardar los anticipos en una tabla propia en nuestro servidor, y al recoger dejar que FacturaScripts convierta el pedido en factura.**

## 3. Cómo funcionaría (ejemplo: 150 €, anticipo 50 € el día 11, resto el día 13)

**Día 11, crear el pedido**
1. El cajero prepara el carrito y pulsa «Pasar a encargo». En dos páginas seguidas rellena nombre, teléfono (opcional), día y hora de recogida y una observación (la dedicatoria), y pone el anticipo (50 €, con cualquier forma de pago). Las pantallas están en el apartado 3b.
2. Al guardar, en una sola operación se crea el pedido en FacturaScripts, se anota en nuestro servidor y se registra el anticipo. Todavía **no es una venta**.
3. El anticipo queda en la **caja del día 11**. Se imprime el resguardo del pedido y el justificante del anticipo.

**Día 13, recoger**
1. El cajero abre Pedidos y elige el pedido. La pantalla muestra «Total 150 €, anticipo 50 €, falta 100 €».
2. Cobra los 100 € que faltan, con cualquier forma de pago.
3. FacturaScripts convierte el pedido en factura (con fecha del día 13) y descuenta el stock en ese momento. La factura queda en la caja del día 13 y lleva dos pagos: los 50 € del anticipo (marcados como «anticipo, ya cobrado el día 11») y los 100 € de hoy.
4. El pedido pasa a «recogido».

## 3b. Cómo se vería (maquetas con datos de ejemplo, dibujadas sobre la pantalla real)

**Dos botones nuevos, visibles solo si el cliente ha activado Encargos** (apartado 3c):
- **«Encargos»**, con un número que cuenta los encargos de **hoy y los vencidos** (rojo si hay algún vencido). Abre la lista: ver, recoger, cobrar otro anticipo, cancelar e imprimir la lista del día. **Ubicación (decidida por el jefe, 30-oct):** zona de botones de abajo a la derecha, con el reparto de la opción 2 pero **intercambiando Vaciar y Encargos**: «Encargos» ocupa el sitio grande de arriba a la izquierda (donde estaba Vaciar), y «Vaciar» pasa al hueco pequeño de abajo, junto a Tickets. Aparcar, Aparcados y Cobrar no cambian. Maqueta: `mock-encargos-botones-elegida.png`. *(Las maquetas de los pasos todavía dibujan el botón en la barra de búsqueda; se redibujarán.)*
- **«Pasar a encargo»**, en la cabecera del carrito junto a «Mov.» (desactivado con el carrito vacío). Convierte el carrito en un encargo en un solo toque. Abrir el formulario no hace nada irreversible: se cierra con Cancelar.

Decisiones tomadas al diseñar las pantallas:
- **Botonera de abajo.** Se había descartado tocarla por estar llena, pero el jefe prefiere el acceso rápido ahí. Se dibujaron tres opciones y **eligió la 2 con un cambio**: Encargos grande arriba y Vaciar pequeño abajo junto a Tickets (`mock-encargos-botones-elegida.png`; las tres opciones originales siguen en `mock-encargos-botones-zona-inferior.png`). Se conserva el tamaño de Cobrar. Efecto: Vaciar cambia de sitio y se hace más pequeño (los cajeros tendrán que acostumbrarse), pero así es más difícil pulsarlo sin querer. Solo cambia de sitio con Encargos activado: apagado, la botonera queda como hoy.
- **No va dentro de Aparcados.** Los aparcados avisan al cerrar caja, están ligados a una caja, se limpian solos y reservan stock; los encargos viven días, sobreviven a los cierres y no reservan. Mezclarlos obligaría a meter excepciones en todo eso y arriesgaría algo que hoy funciona bien.
- **Acceso rápido.** Lo habitual será buscar y recoger (botón «Encargos» siempre a la vista) y, para quien trabaje sobre todo con encargos, crear (botón «Pasar a encargo» en el carrito). La lista también tiene «+ Nuevo encargo con el carrito actual»: es otra puerta al mismo formulario.
- **Dos páginas seguidas, un solo guardado.** El formulario se reparte en «Datos» (página 1) y «Anticipo» (página 2), para que cada una tenga sitio de sobra con pedidos grandes y en pantallas pequeñas. **No se guarda nada hasta el último botón** («Guardar y cobrar»); con «Atrás» se puede corregir lo que sea. Para el programa es una sola llamada al servidor que crea el encargo y cobra el anticipo: o se hace todo o no se hace nada, sin encargos a medias si se corta la conexión. Quien no quiera anticipo usa «Guardar sin anticipo» en la página 1 y no pasa por la 2. Un anticipo posterior se cobra desde el detalle con «Cobrar otro anticipo».
- **Resumen compacto.** La página 1 muestra solo «4 productos · Total 150,00 €» con «Ver detalle», que despliega la lista con su propio scroll y altura máxima. Así un encargo de 30 líneas no desborda la pantalla, y el total y el anticipo se ven siempre.
- Si, aun así, el cobro falla pero el encargo se guarda, la pantalla lo dice claramente («Encargo guardado, anticipo NO cobrado») y queda en la lista para cobrarlo con «Cobrar otro anticipo».
- El importe del anticipo se teclea con el **teclado numérico que ya sale en pantalla** en el resto del programa. Hay que probar el conjunto en pantallas pequeñas.

Recorrido de un encargo desde cero (Hotel Marina Azul, 150 €, anticipo 50 €):

| Paso | Qué ocurre | Imagen |
|---|---|---|
| 1 | Se añaden los productos al carrito como siempre y se pulsa **«Pasar a encargo»** | `mock-encargos-paso1-carrito.png` |
| 2 | **Página 1, «Datos»:** nombre*, teléfono, día* (Hoy / Mañana / un día concreto / otro), hora*, dedicatoria o nota para cocina, cliente de la factura (por defecto el del carrito) y resumen compacto. Botones: Cancelar, Guardar sin anticipo, **Siguiente: anticipo** | `mock-encargos-paso2a-datos.png` |
| 3 | **Página 2, «Anticipo»:** importe (atajos Todo / 50 % / 25 % / Sin anticipo y teclado numérico), cualquier forma de pago, entrega y cambio si es efectivo, y «Por cobrar al recoger». Botones: Atrás y **«Guardar y cobrar 50,00 €»** (con el anticipo a 0 dice «Guardar encargo») | `mock-encargos-paso2b-anticipo.png` |
| 4 | Todo guardado y carrito libre. Se imprimen el **resguardo** del encargo (con la fecha y hora de recogida bien visible) y el **justificante** del anticipo; también se pueden enviar por correo | `mock-encargos-paso3-resguardo.png` |

Alternativa al paso 1, desde la lista: «Encargos» → «+ Nuevo encargo con el carrito actual» abre el mismo formulario (`mock-encargos-alt-desde-la-lista.png`).

**Cómo se ven los pendientes**
- **El botón «Encargos»** lleva el número de los de hoy y los vencidos, en rojo si hay vencidos.
- **La lista** (`mock-encargos-1-lista.png`): pestañas «Falta recoger», «Recogidos» y «Cancelados»; agrupados por día («Vencidos», «Hoy», «Mañana»…) y ordenados por hora; buscador por nombre o teléfono; cada fila muestra hora, nombre, teléfono, resumen, total, anticipo y lo que falta (los pagados del todo salen en azul y los vencidos sin recoger en rojo). Botón **«Imprimir lista de hoy»**, útil para quien prepara los pedidos.
- **Aviso al abrir la caja** (opcional, `mock-encargos-aviso-apertura.png`): si hay encargos de hoy o vencidos, una ventana los resume con «Ver encargos» o «Ahora no». Si no hay ninguno, no aparece.
- **El detalle** (`mock-encargos-2-recoger.png`): líneas, dedicatoria, «Total − anticipo = falta por cobrar» y el botón grande **«Recoger y cobrar»**, además de «Cobrar otro anticipo», «Editar encargo», «Imprimir resguardo», «Enviar por correo» y «Cancelar encargo».
- **El cierre de caja** tiene un bloque «Encargos» aparte de las ventas, con los anticipos cobrados ese día (apartado 5).
- **En FacturaScripts** aparecen como pedidos abiertos de venta, pero sin la hora de recogida ni el anticipo (que están en nuestra tabla).
- Las demás terminales del cliente ven los cambios al momento, con el aviso en tiempo real.

Las imágenes están en esta misma carpeta (`docs/`). `propuesta-botones-encargos.png` es una primera versión de la ubicación de los botones, anterior a esta; vale como referencia de dónde va el botón «Encargos».

Detalles que se han decidido sobre la marcha (a confirmar):
- El encargo necesita un **cliente de FacturaScripts** para la factura futura. Por defecto, el del carrito (normalmente «Ventas tickets»); el nombre de quien encarga se guarda aparte.
- Se permite **guardar sin anticipo**.
- El anticipo se cobra con **su propia pantalla dentro del asistente** (no con el modal de cobro actual, que exige pagar el total).
- La primera versión necesita conexión (ver riesgos).

## 3c. Activación y aviso de la novedad (decisión del jefe)

- **Opción «Encargos» en Opciones, apagada por defecto** (solo la cambia un administrador). Apagada, el programa queda **exactamente como hoy**: sin botones nuevos, sin avisos al abrir la caja y sin bloque en el cierre. Así, publicar la versión no cambia nada a nadie que no la active.
- **Popup de la novedad, una sola vez:** al abrir la primera vez una versión que incluye Encargos, sale una ventana propia (distinta del changelog normal) que explica en pocas líneas qué son los encargos (anotar pedidos con día y hora, cobrar un anticipo y cobrar el resto al recoger) y que se activan en Opciones. Botones: **«Activar ahora»** (pide ser administrador, como el resto de opciones), **«Ahora no»** y «No volver a mostrar». Cuando se activa o se descarta, no vuelve a salir. Maqueta pendiente.
- **Si la opción es por terminal o por cliente:** lo ideal es por cliente (que todas las terminales de una tienda sigan el mismo ajuste). Hay que comprobar al implementarlo qué ajustes ya se comparten entre terminales; si no hay un sitio adecuado, será por terminal. Es un detalle técnico, no cambia lo que ve el cajero.
- **El dinero nunca se oculta:** si una terminal tiene la opción apagada pero otra terminal del mismo cliente ya cobró anticipos, el **cierre de caja muestra igualmente el bloque «Encargos»** de esa caja, para que la caja cuadre. Apagar la opción solo quita los botones y los avisos, no los datos.
- **Correo a los usuarios (recordatorio para el lanzamiento):** el jefe pide enviar un correo a los clientes que usan TPV para anunciar la mejora. Hay que recordárselo **el día de la publicación**; yo lo apunto como pendiente de esa versión.

## 3d. Editar un encargo (en la primera versión)

**Qué se puede cambiar** mientras el encargo está en «Falta recoger»: productos, cantidades y precios, día y hora, nombre, teléfono, dedicatoria/nota, cliente de la factura. No se edita uno ya recogido o cancelado.

**Cómo se hace en pantalla:** en el detalle, botón **«Editar encargo»**. Se cargan sus líneas en el carrito (que el cajero ya sabe manejar: añadir, quitar, cambiar cantidad y precio), con una franja visible «Editando encargo de Hotel Marina Azul · Guardar cambios · Descartar». Mientras se edita, Cobrar y Aparcar quedan desactivados. «Guardar cambios» abre la página «Datos» ya rellenada. Si el carrito tenía una venta a medias, antes se avisa y se aparca. Si se cierra el programa a mitad, **no se pierde ni se cambia nada en el servidor** (los cambios solo se guardan al final), y el carrito recuperado conserva la franja de «editando».

**Qué ocurre por dentro:** FacturaScripts no recalcula el total del pedido si se editan sus líneas por la API (comprobado en la demo). Por eso **editar = crear un pedido nuevo con las líneas nuevas y cancelar el anterior**, en una sola acción del servidor repetible (cada versión lleva su propio código en `numero2`). Cada operación por separado ya está comprobada en la demo (crear 0,17 s; cancelar libera la reserva); el conjunto se probará al implementarlo. Los **anticipos cobrados cuelgan de nuestro encargo, no del pedido de FacturaScripts**, así que no se pierden ni se mueven al cambiar de pedido.

**Qué pasa con el dinero al editar:**
- Total nuevo **mayor** que lo cobrado: simplemente «falta por cobrar» sube. Se puede cobrar otro anticipo.
- Total nuevo **menor** que lo ya cobrado (por ejemplo, anticipo de 50 € y el encargo baja a 40 €): el programa lo avisa y obliga a **registrar la devolución de la diferencia** (10 €, con su forma de pago) antes de guardar. Sale en el cierre como «anticipos devueltos», igual que una cancelación.
- Se anota quién lo editó y cuándo. El resguardo se **reimprime marcado como «MODIFICADO»**, y el anterior deja de valer.

**Dos terminales a la vez:** cada encargo lleva un número de versión. Si alguien lo edita o lo recoge mientras otro lo está editando, el que guarda después recibe «este encargo ha cambiado, revísalo» y ve la versión nueva (el mismo mecanismo que ya usan los aparcados). Mientras se recoge, queda bloqueado para editar.

**Coste:** añade aproximadamente 1-2 días a la fase de crear el encargo (apartado 10).

## 4. Qué guarda cada sitio

| Dato | Dónde | Por qué |
|---|---|---|
| Productos, cliente, total del pedido, reserva de stock | Pedido de FacturaScripts | Es lo que FacturaScripts ya sabe hacer, y al recoger genera la factura él solo |
| Nombre y teléfono, día y hora de recogida, dedicatoria, estado, enlace pedido → factura | Tabla nueva en nuestro servidor | El pedido de FacturaScripts no tiene huecos para esos datos |
| Anticipos (importe, forma de pago, caja, agente, hora) y devoluciones | Tabla nueva en nuestro servidor | FacturaScripts no tiene «pago a cuenta» en los pedidos: los recibos solo cuelgan de facturas |

## 5. Cómo afecta a la caja y al cierre

- Hoy el cierre se calcula con las facturas de la caja, sus recibos y los movimientos de caja. Un anticipo no es ninguna de las tres cosas.
- Los movimientos de caja no admiten forma de pago, así que no sirven para anticipos con tarjeta o transferencia. Por eso van en la tabla propia.
- Maquetas: `mock-encargos-cierre-pantalla.png` (ventana de cierre) y `mock-encargos-cierre-impreso.png` (informe impreso). Cambios en el cierre:
  - **Bloque «Encargos», aparte de «Ventas»** (las ventas normales se muestran como hoy, sin los encargos). Con efectivo, tarjeta, etc. por separado muestra: anticipos cobrados hoy, resto cobrado al recoger, anticipos devueltos y el total cobrado por encargos.
  - Las **ventas** del bloque «Ventas» son solo los tickets normales. Los encargos recogidos se facturan ese día, pero su dinero se cuenta en el bloque «Encargos» (para no mezclarlos ni contar el anticipo dos veces).
  - Al «Total esperado en caja» solo entra el **efectivo** de los encargos (anticipos y restos en efectivo, menos devoluciones). Tarjeta y transferencia aparecen en el bloque, pero no suman al efectivo del cajón. En el resumen superior hay una celda nueva, «Cobros efectivo encargos», junto a la de ventas.
  - **Para cuadrar con las facturas del día:** el bloque dice cuántos encargos se recogieron hoy, su importe facturado y cuánto de eso ya se cobró en días anteriores (los anticipos previos, marcados en sus recibos). Y cuántos encargos siguen pendientes, con cuánto dinero ya cobrado en anticipos.
  - **Total cobrado hoy** = ventas + encargos (en el ejemplo, 133,12 € + 218,20 € = 351,32 €). Puede no coincidir con lo facturado del día, porque los anticipos de encargos aún sin recoger se cobran pero no se facturan.
- Cancelación: según la opción de cada empresa, se devuelve el anticipo (queda como devolución en la caja del día de la devolución) o se retiene (ver preguntas abiertas).

## 6. Alternativas valoradas y por qué no

| Alternativa | Lo bueno | Por qué no |
|---|---|---|
| **A. Todo en nuestro servidor**, sin pedido de FacturaScripts (como los aparcados); la factura solo al recoger | Más sencillo y rápido de programar | El pedido no existiría en FacturaScripts, y la especificación pide usar su API. Habría que reimplementar la conversión a factura y las reservas |
| **B. Anticipo como factura de anticipo** (una factura real el día 11 que luego se descuenta) | Es lo más correcto fiscalmente (IVA). La caja funcionaría sin cambios, y cancelar sería una rectificativa | El anticipo pasaría a ser **una venta del día 11**, lo que contradice la especificación. Gasta números de factura (y envíos de Verifactu) por cada anticipo. Hay que repartir el anticipo entre tipos de IVA. Es bastante más complejo |
| **C. Anticipos como movimientos de caja de FacturaScripts** | Todo el dinero en FacturaScripts | No admiten forma de pago (solo efectivo). Mezclarían los anticipos con los ingresos y gastos manuales, y confundirían el cierre |
| **D. Recomendada** | Encaja con la especificación; reutiliza la conversión nativa; anticipos con forma de pago; cuadre claro | Hay dos sitios de datos (se explica en el apartado de riesgos) |

La opción B es la ruta de mejora si la gestoría exige factura del anticipo. Los anticipos se guardan con forma de pago, fecha y caja, así que se podría pasar a B más adelante sin perder datos.

## 7. Qué se ha comprobado en la demo (todo borrado después; stock idéntico al de partida)

- Crear un pedido de 10 líneas tarda 0,17 s. Pasarlo a factura, 0,27 s. (Son tiempos de la demo; en un cliente real dependen de sus plugins, ver riesgos.)
- Al pasar el pedido a «Facturar», FacturaScripts crea la factura con las mismas líneas, **con la fecha del día en que se convierte** (no la del pedido) y descuenta el stock en ese momento. Copia el campo `numero2`, así que podemos reconocer la factura aunque la conexión se corte a mitad, igual que hoy con las ventas.
- Un pedido abierto marca el stock como «reservado» dentro de FacturaScripts. **El TPV no lee ese dato**: no afecta a las ventas ni al stock que muestra el TPV.
- Cancelar un pedido libera esa reserva.
- **Editar las líneas de un pedido ya creado deja el total desactualizado.** Cambiar la cantidad cambia la reserva pero no recalcula el total del pedido. Por eso, para poder editar (decisión del jefe), editar se implementa como crear el pedido nuevo y cancelar el anterior, con los anticipos colgando de nuestro encargo (apartado 3d).

## 8. Riesgos y cosas que no se han resuelto

1. **IVA del anticipo: decidido por el jefe** (no se tiene en cuenta; no hay factura hasta liquidar el total). Se implementa como justificante, que debe decir claramente «no es una factura». Si la gestoría de algún cliente dijera lo contrario, la ruta de mejora es la opción B (apartado 6) y los anticipos ya se guardan con los datos necesarios.
2. **Clientes con el plugin de WooCommerce (Asador), y en general clientes con muchos plugins.** Reservar y cancelar toca las filas de stock, que son las que disparan los avisos a su web (~0,7 s cada uno). Es probable que crear un pedido tarde varios segundos allí. Sin verificar, porque en la demo el plugin no está configurado. La cola asíncrona del plugin lo solucionaría.
3. **Dos sitios de datos** (pedido en FacturaScripts, resto en nuestro servidor). Mitigación: cada paso es repetible sin duplicar (se identifica por un código único en `numero2`), y un revisor sencillo puede detectar pedidos huérfanos.
4. **Necesita conexión** en la primera versión: crear pedidos, cobrar anticipos y recoger hablan con el servidor. Las ventas normales siguen funcionando sin conexión como hasta ahora.
5. **Tiempos reales sin medir:** crear pedidos y convertirlos a factura en un cliente real. Se medirá la primera vez que lo use cada cliente.
6. **Aplicaciones aparte:** la app de camareros y la versión Android no se tocan en la primera versión.
7. **Recogida parcial:** la primera versión es todo o nada.
8. **El código llega a todos los clientes, aunque la función esté apagada.** Mitigaciones: desarrollo en rama aparte y publicación solo cuando esté terminado y probado; con la opción apagada (por defecto) nada cambia en pantalla; el cierre de caja solo muestra el bloque de encargos si hay movimientos de encargos. Se probará primero con la opción activada en un solo cliente.
9. **Editar tiene más piezas** (carrito en modo edición, devolución si baja el total, reimpresión, conflictos entre terminales). Es la parte con más posibilidades de fallos de detalle: se probará en la demo con dos terminales reales antes de darla por buena.

## 9. Preguntas para el jefe

**Respondidas:** IVA/factura del anticipo (no se tiene en cuenta), disponibilidad (activable, apagada por defecto, con popup), nombre («Encargos») y edición (sí, desde la primera versión) el 29-oct; ubicación del botón (opción 2 con Vaciar y Encargos intercambiados) el 30-oct.

**Siguen abiertas:**
1. **Anticipo que no se devuelve (encargo cancelado):** ¿cómo se contabiliza? Opciones: (a) queda como ingreso de la caja del día de la cancelación, con su justificante; (b) se emite una factura por ese concepto. Depende de la gestoría. (Mientras no se decida, la primera versión solo permite devolver el anticipo al cancelar.)
2. Si al editar el encargo el total baja por debajo de lo cobrado, ¿vale obligar a registrar la devolución de la diferencia (apartado 3d)?
3. ¿Qué clientes lo activan primero en real? Los Argentinos parecen el caso natural.
4. **Popup de la novedad:** el texto lo preparamos nosotros para que lo reviséis; conviene que el correo a los usuarios diga lo mismo.

**Se asume, salvo que digáis lo contrario:** se puede crear un encargo **sin anticipo**; el **cliente de la factura** es por defecto el del carrito («Ventas tickets») y se puede cambiar; «cierre» = **cierre de caja**; la recogida es **todo o nada**; la primera versión **necesita conexión**.

## 10. Plan por fases (cada fase se prueba en la demo antes de pasar a la siguiente)

| Fase | Contenido | Tamaño |
|---|---|---|
| 1. Servidor | Tablas de pedidos y anticipos (creación automática al primer uso), acciones atómicas (crear, anticipo, cancelar, bloquear recogida) con control de conflictos y aviso en tiempo real | M |
| 2. Crear y editar el encargo | Opción «Encargos» apagada por defecto y popup de la novedad (una vez); botones «Encargos» (con contador) y «Pasar a encargo», ventana con la lista (pestañas, buscador, agrupado por día), asistente de dos páginas con un solo guardado (datos; anticipo con importe y forma de pago), aviso opcional al abrir la caja, impresión de la lista del día, resguardo y justificante impresos; **edición del encargo** (apartado 3d: carrito en modo edición, devolución si baja el total, reimpresión «MODIFICADO», control de versiones). **No puede salir a medias**: se desarrolla en una rama aparte y solo se publica terminado y probado | L+ |
| 3. Recoger y cobrar el resto | Conversión a factura por FacturaScripts, recibos con anticipo marcado, reintentos y deduplicación como en las ventas, ticket | L |
| 4. Cierre de caja | Bloque «Pedidos», efectivo esperado, anticipos previos aplicados, cancelación con o sin devolución | M |
| 5. Correo y presupuestos | Envío del resguardo y justificante por correo (reutiliza el de facturas). Presupuestos → pedido más adelante | S |

Tamaños aproximados: S ≈ medio día, M ≈ 1-2 días, L ≈ 2-3 días de trabajo con pruebas. Total estimado: 2-2,5 semanas (la edición añade 1-2 días). El correo del jefe a los usuarios se envía el día de la publicación.

---

## Apéndice técnico

**Puntos de enganche en el código (por si se aprueba)**
- **Interruptor en Opciones, apagado por defecto** (no es de pago como Mesas, así que no se toca `clients.json` ni `get-client-features`): opción «Encargos» solo para administradores (`applyAdminOnlyUI`, tabla `OPT_PREVIEW_DEFS` para que aparezca en los resúmenes y el buscador de Opciones). Popup de novedad: modal propio con su clave en `localStorage`, lanzado junto a `maybeShowChangelogAfterUpdate()`, una sola vez por terminal.
- **Edición:** acción de servidor `update-customer-order` (versión esperada + pedido nuevo con `numero2` = código + revisión + cancelar el anterior + devolución opcional); en el cliente, estado de «carrito en edición» persistido con el carrito.
- Tablas nuevas: autocreación perezosa con `CREATE TABLE IF NOT EXISTS`, como `display_settings` o `parked_reservations_ops` (`getParkedDbConnection`).
- Guardado por acciones con `SELECT … FOR UPDATE` y candado de recogida, como el guardado de aparcados (`closing_in_progress`), para que dos terminales no recojan el mismo pedido.
- Tiempo real: tema nuevo `customer-orders` en `notifyRealtimeChange` y rama en `handleRealtimeChangeNotice`.
- Cierre de caja: `runCashCloseSummaryComputation` / `hydratePaymentsByMethodForClose` (excluir los recibos marcados como anticipo y sumar el bloque de pedidos) y el ticket de cierre (`cash_close_print.html`).
- Recoger: reutilizar `processConfirmedSale` (fase 2) cambiando solo el paso de crear la factura por «pasar el pedido a Facturar + localizar la factura por `numero2` + completar campos del TPV (`idcaja`, `idtpv`, `tpv_venta`, `codagente`…)». El pago repartido (anticipo + resto) ya se representa con varios recibos (`createReciboCliente`, `cleanupRecibosFactura`).
- Impresión: nuevas plantillas `*_print.html` clonando `printCashCloseReport`. Correo: `renderInvoicePdf` + `apiSendInvoiceEmail`.
- Nombre: en el código ya existe un tipo `docType: "pedido"` en los aparcados (estados `pendiente`/`pagado-no-recogido`/`recogido`), **sin ningún botón que lo cree**. Para no mezclarlo, el módulo nuevo se llamará internamente `customerOrders` y en pantalla «Encargos» (en Modo Mesas el botón de aparcados ya se llama «Pedidos»).
- Botones nuevos: «Encargos» se crea por código junto a los de la barra de búsqueda (`renderMainAgentBar`, como `createTablesBtn`), y «Pasar a encargo» va en la cabecera del carrito; los dos visibles solo con la opción activada. La ventana de la lista sigue el patrón de las demás (`simple-overlay` > `parked-modal`); el asistente de dos páginas (datos y anticipo) y el detalle de recoger son modales aparte. La lista y el contador se refrescan con el tema de tiempo real `customer-orders`.
- Crear + anticipo, una sola acción de servidor (atómica y repetible con un código único): `create-customer-order` con el anticipo dentro. Mismo patrón de acciones con `SELECT … FOR UPDATE` que el guardado de aparcados.
- Un hallazgo menor: `createReciboCliente` lee `fechaPago` (con P mayúscula) mientras que los llamadores pasan `fechapago`, así que la fecha de pago nunca llega a FacturaScripts. Para los anticipos (recibo con la fecha del día 11) hay que corregirlo.
