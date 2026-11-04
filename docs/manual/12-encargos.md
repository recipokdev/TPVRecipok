# Encargos

Los encargos sirven para **apuntar un pedido para otro día** (una tarta, un pollo asado, un pedido grande…), **cobrar un anticipo** si el cliente lo deja a cuenta y **cobrar el resto cuando viene a recogerlo**. Este capítulo explica cómo activarlos y cómo trabajar con ellos.

> Es un módulo opcional: **viene apagado por defecto** y se activa por terminal. Si al intentar activarlo el TPV dice que «Encargos todavía no está disponible», tu empresa aún no lo tiene activado en el servidor.

## 1. Qué es un encargo (y qué no es)

- Un encargo **no es una venta**: al crearlo **no se emite ninguna factura ni se descuenta stock**. La factura se emite **cuando el cliente recoge el pedido**.
- El **anticipo** es dinero cobrado a cuenta. Se anota en la caja del día en que se cobra, pero **no es una factura** y no lleva IVA: el IVA se factura al recoger, descontando lo ya cobrado.
- Cada encargo lleva un **código** (empieza por «ENC-») y se ve también como un **pedido** en FacturaScripts.
- Hace falta **conexión con el servidor** para crear, editar o recoger un encargo (los encargos se comparten entre todos los terminales de la empresa).

## 2. Activar Encargos

Solo un administrador: **Opciones → Encargos → Activar Encargos**. Al activarlo aparecen en el carrito dos botones: **Pasar a encargo** y **Encargos** (la lista). La primera vez que entra un administrador, el TPV muestra una pantalla de novedad que permite activarlo directamente.

## 3. Crear un encargo

1. **Prepara el carrito** con los productos del pedido (con el cliente y los precios que correspondan, como en una venta).
2. Pulsa **Pasar a encargo**.
3. **Paso 1 de 2: datos.** El **nombre** y el **teléfono** vienen ya rellenados con los del **cliente que hayas elegido en el carrito** (si no es el cliente por defecto); se pueden cambiar o vaciar de un toque con la **✕** que hay a la derecha de cada campo. El nombre es obligatorio. Añade una **nota** si hace falta (por ejemplo una dedicatoria): en el resguardo sale **en un recuadro destacado**. Elige el **día** de recogida (Hoy, Mañana u otro día) y la **hora**. No se puede elegir un día y hora que ya han pasado.
4. **Paso 2 de 2: anticipo.** Elige cuánto cobra ahora (con el teclado numérico o con los atajos **Todo**, **50 %**, **25 %** y **Sin anticipo**) y la **forma de pago**. Si es en efectivo, puedes indicar lo que entrega el cliente y el TPV calcula el cambio. El anticipo no puede ser mayor que el total.
5. Pulsa **Guardar y cobrar** (o **Guardar encargo** si no hay anticipo).

El TPV imprime el **resguardo** (lo que se entrega al cliente, con el día y la hora de recogida bien grandes) y, si hubo anticipo, el **justificante de anticipo**. Después se **vacía el carrito**. Desde la ventana de resultado puedes **reimprimir** ambos o **enviar el resguardo por email**.

## 4. La lista de encargos

El botón **Encargos** (con un contador) abre la lista, con tres pestañas: **Falta recoger**, **Recogidos** y **Cancelados**.

- El contador del botón cuenta los encargos **de hoy y vencidos** que faltan por recoger; se pone **en rojo** si hay alguno vencido (de un día anterior).
- En la lista, cada fila muestra **todos los productos y la nota completos** (la fila crece lo que haga falta). Cada encargo pendiente tiene un botón **Cancelar** en la propia fila, para cancelarlo sin abrir el detalle (pide confirmación y devuelve el dinero cobrado a cuenta, igual que desde el detalle).
- Al abrir la caja, si hay encargos para hoy, aparece el aviso **«Encargos por entregar hoy»** con la lista.
- Se puede **buscar** por nombre, teléfono o código.
- **Imprimir lista de hoy** saca en la impresora un listado **para colgar en la pared**: por cada encargo de hoy y vencido, la **hora en grande**, el **nombre**, el teléfono, **un producto por línea** (cantidad y nombre) y la **nota enmarcada**, sin precios. Cada encargo indica si está **PAGADO** o **A COBRAR**.
- Al **abrir la caja** (una vez por caja y día) el TPV muestra un aviso con los encargos de hoy y los vencidos, para tenerlos presentes desde el principio del turno.

Al tocar un encargo se abre su **detalle**: datos, productos, anticipos y devoluciones cobrados, y lo que falta por cobrar. Desde ahí:

| Botón | Qué hace |
|---|---|
| **Recoger y cobrar** | Entrega el pedido: cobra lo que falta y emite la factura (apartado 5). |
| **Editar encargo** | Cambia productos, día/hora, nombre, teléfono o nota (apartado 6). |
| **Editar datos** | Cambia solo el **nombre, teléfono, nota, día u hora**, sin tocar el carrito ni el dinero (apartado 6). |
| **Cobrar otro anticipo** | Añade otro pago a cuenta. |
| **Imprimir resguardo / justificante** | Reimprime los papeles del cliente. |
| **Imprimir justificante de devolución** | Solo aparece si ya se devolvió dinero: reimprime el papel de la devolución. |
| **Enviar resguardo por email** | Manda el resguardo en PDF al correo del cliente (apartado 7). |
| **Cerrar sin recoger** | Cierra un encargo que no se va a recoger y no se devuelve nada (apartado 8). |
| **Cancelar encargo** | Anula el encargo y devuelve el dinero cobrado (apartado 8). |

## 5. Recoger y cobrar

1. Abre el encargo y pulsa **Recoger y cobrar**. Hace falta la **caja abierta** y un **agente** asignado.
2. El TPV abre la ventana de cobro con **lo que falta por cobrar** (el total menos los anticipos). Cobra como en una venta normal.
3. Se emite **una factura** con todas las líneas del encargo, en la que lo cobrado a cuenta **ya figura como pagado** (con la forma de pago y la fecha en que se cobró cada anticipo), y se **descuenta el stock**.
4. Si el encargo ya está **pagado por completo**, el TPV lo entrega directamente y emite la factura sin cobrar nada más.

Si alguien más está recogiendo ese mismo encargo en otro terminal, el TPV avisa de que «se está atendiendo en otro dispositivo». Si se corta la conexión a mitad de la entrega, vuelve a pulsar **Recoger y cobrar**: continúa donde se quedó, sin duplicar la factura ni el cobro.

> Si falta stock de algún producto al recoger, aparece el mismo aviso **«Sin stock suficiente»** que al cobrar, con la opción de cobrar sin stock.

## 6. Editar un encargo

**Solo los datos:** si únicamente hay que corregir el nombre, el teléfono, la nota o el día/hora, abre el encargo y pulsa **Editar datos**: se abre el asistente con esos campos, **sin carrito**. Al guardar, el TPV muestra el resguardo de nuevo (si cambió el día/hora o la nota, sale marcado **«MODIFICADO»** y anula el anterior) y se actualiza el texto del pedido en FacturaScripts.

**Productos o cliente de la factura:** para cambiar productos o el cliente, usa **Editar encargo**:

1. Abre el encargo y pulsa **Editar encargo**. Los productos pasan al **carrito**, con una franja violeta **«Editando el encargo de…»** y los botones **Guardar cambios** y **Descartar**. Mientras editas, **Cobrar y Aparcar están bloqueados**. Para editar, el carrito debe estar vacío y hay que estar en el **TPV normal** (no en la vista del Modo Mesas, donde el carrito es el de la mesa).
2. Cambia lo que haga falta: añade o quita productos, cambia cantidades… También puedes **cambiar el cliente** desde el propio carrito (el selector de cliente de siempre): al empezar a editar, el carrito lleva el cliente del encargo, y el que haya al guardar es el que se queda. Los precios siguen la tarifa de ese cliente.
3. Pulsa **Guardar cambios**. Revisa el día, la hora, el nombre, el teléfono y la nota, y pulsa **Guardar cambios** otra vez.
4. El TPV imprime un **nuevo resguardo marcado «MODIFICADO»**, que anula el anterior. Si cambiaste el cliente, el asistente lo indica con **«(cambiado)»** y la **factura saldrá a nombre del nuevo cliente** al recoger el pedido. En el detalle del encargo se ve siempre **«Factura a nombre de»** (cuando no es el cliente por defecto).

Reglas:
- **No se puede dejar el total por debajo de lo ya cobrado a cuenta.** Si el cliente quiere menos, **cancela el encargo** (se le devuelve el dinero) y crea otro.
- **Descartar** deja el encargo tal como estaba. Hasta que se pulsa **Guardar cambios** no se cambia nada, ni siquiera si se cierra el programa a mitad: al volver a abrirlo, el carrito y la franja de edición se recuperan.
- Si mientras editabas otro terminal modificó el mismo encargo, el TPV **no guarda tus cambios** y te avisa: descarta, revisa el encargo y vuelve a editarlo.

## 7. Enviar el resguardo por email

Desde el detalle (**Enviar resguardo por email**) o desde la ventana de resultado al guardar (**Enviar por email**): escribe el correo del cliente, revisa el mensaje (viene escrito, y es editable) y pulsa enviar. Llega un **PDF** con el resguardo. Usa el mismo correo de la empresa que **Enviar factura**; si no está configurado, el TPV lo avisa (un administrador puede configurarlo desde ahí mismo).

## 8. Cancelar o cerrar sin recoger

Si el cliente **ya no quiere el pedido**, hay dos caminos según lo que se haga con el dinero:

- **Cancelar encargo.** Se anula el encargo y se **devuelve cada anticipo con la forma de pago con la que se cobró**: el efectivo se entrega al cliente y, si fue con tarjeta o transferencia, el TPV recuerda que hay que **reversar la operación** en el datáfono o en el banco. La devolución queda anotada en la caja del día en que se hace, y el pedido de FacturaScripts también se cancela. Si hay dinero que devolver, se imprime un **justificante de devolución** (con la impresión automática activada; si no, desde el detalle del encargo) que dice cuánto se devuelve por cada forma de pago. Hace falta la caja abierta si hay dinero que devolver.
- **Cerrar sin recoger.** Si el cliente no viene a por el pedido y **no se le devuelve nada**, el anticipo se queda como una venta: el TPV emite **una factura por lo cobrado a cuenta**, con las líneas del encargo y un **descuento** por el resto (repartido para que el total salga exacto), y descuenta el stock. El encargo pasa a «Cerrado sin recoger».

## 9. Stock y encargos

Un encargo **no descuenta stock** al crearlo; el stock real baja al facturar, como en cualquier venta. Para no vender lo que ya está prometido, el TPV hace una **reserva virtual**:

- Los encargos pendientes **con recogida de hoy o de un día anterior** se restan del stock que ve el TPV desde las **00:00 del día de la recogida**. Los de días futuros todavía no reservan.
- Si «**Mostrar stock**» está activado (Opciones → Productos), la tarjeta del producto enseña el stock disponible y un pequeño **«N reservados»**.
- Si vendes en mostrador más de lo disponible, el TPV **avisa pero no bloquea** (aparece el aviso «Sin stock suficiente» con la opción de cobrar igualmente).
- La reserva se libera sola cuando el encargo se recoge, se cancela o se cierra sin recoger.
- **Los packs reservan igual que en una venta:** el propio pack y cada uno de sus componentes (con la cantidad ya multiplicada). Por ejemplo, 4 «Medio pollo» reservan 2 «Pollo entero». En los packs con stock derivado, el stock que se ve baja a la vez que el del producto del que salen.

## 10. Cierre de caja

En el cierre de caja, los encargos tienen **su propio bloque**, separado de las ventas: anticipos cobrados, devoluciones, y lo cobrado al recoger. Las facturas de los encargos **no se cuentan dos veces** en el total de ventas, y el **efectivo** de los anticipos y las devoluciones se tiene en cuenta en el **efectivo esperado** de la caja. El informe impreso del cierre incluye el bloque de encargos y un total **«cobrado hoy (ventas + encargos)»**.

> Un anticipo se anota en la caja del día en que se cobra, aunque el encargo se recoja otro día.
