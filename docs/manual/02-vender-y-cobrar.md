# Vender y cobrar

Este capítulo explica cómo hacer una venta normal en el TPV, desde elegir los productos hasta cobrar. Si tu empresa trabaja con mesas, consulta el manual aparte del **Modo Mesas**.

## 1. La pantalla de venta

@fig img/vender-pantalla.png | crop=0,0,1920,1017 | marks=1:215,28;2:735,76;3:300,130;4:1640,215;5:1600,83;6:1790,857;7:1575,884;8:1640,28 | Pantalla de venta del TPV con un pedido en curso.

1. **Buscador de productos.** Escribe parte del nombre para encontrar un producto sin recorrer las familias. A su derecha hay cuatro botones: *Ir a modo Mesas*, *Actualizar datos*, *Abrir cajón* y *Familias en columna lateral*.
2. **Familias.** Cada botón agrupa un tipo de productos (cafés, bollería, tartas…). Al pulsarlo se muestran sus productos.
3. **Productos.** Un toque sobre un producto lo añade al carrito. En cada botón se ve el nombre y el precio.
4. **Carrito.** Muestra las líneas del pedido. Con **+** y **−** cambias la cantidad; si tocas el **número** de la cantidad se abre un teclado numérico (que también sirve de calculadora) para poner la cantidad exacta; y con la **✕** quitas la línea.
5. **Cliente.** Por defecto la venta se hace a «Ventas tickets» (cliente genérico). Pulsa aquí para elegir otro cliente.
6. **Total.** Importe total del pedido con impuestos incluidos.
7. **Botones del pedido.** *Vaciar*, *Aparcar*, *Cobrar*, *Tickets* y *Aparcados* (se explican más abajo).
8. **Caja.** Muestra el número de la caja abierta. Pulsándolo cierras la caja, y con **Mov.** registras movimientos de caja.

En la barra inferior verás siempre el estado de la conexión (punto verde = conectado), la versión y quién está trabajando: **terminal**, **agente** y **usuario**.

> **Importante:** para vender, la caja tiene que estar abierta. Si está cerrada, el TPV muestra un aviso sobre los productos con el botón para abrirla.

## 2. Añadir productos al pedido

1. Pulsa la familia que quieras, por ejemplo *Cafés*.
2. Toca el producto. Se añade una línea al carrito.
3. Para vender más unidades, toca el producto otra vez o usa el botón **+** de la línea.

Por defecto **cada toque crea una línea nueva**, aunque sea el mismo producto. Si prefieres que se sumen en una sola línea, desactiva *Desagrupar líneas* en **Opciones → Carrito**.

### Corregir el pedido
- **Quitar una unidad:** botón **−** de la línea.
- **Quitar una línea entera:** botón **✕**.
- **Empezar de cero:** botón **Vaciar**. En **Modo Mesas**, *Vaciar* solo quita lo que **aún no se ha enviado a cocina**: lo ya enviado se quita línea a línea con la **✕** (y avisa a cocina como devolución).

### Cambiar la cantidad, el precio o el descuento de una línea

Cada línea del carrito tiene varios botones.

@fig img/vender-carrito-descuentos.png | crop=1410,112,500,100 | width=85 | marks=1:1675,121;2:1715,121;3:1755,121;4:1805,121;5:1851,121;6:1882,121 | Una línea del carrito.

1. **−** quita una unidad.
2. **Cantidad.** Si tocas el número se abre un teclado numérico (que también sirve de calculadora: **÷ × − +**) para poner la cantidad exacta.
3. **+** añade una unidad.
4. **Importe.** Si tocas el importe de la línea se abre otro teclado para cambiar el **precio unitario** (IVA incluido). El cambio vale **solo para este ticket**: no modifica el precio del catálogo. **Restaurar** devuelve el precio original.
5. **%** aplica un descuento a esa línea (solo aparece si está activada la opción *Descuentos manuales en carrito*, ver más abajo).
6. **✕** quita la línea.

@fig img/vender-teclado-cantidad.png | crop=600,259,720,460 | width=55 | Teclado de cantidad. **Borrar** vacía el número, **Cancelar** no cambia nada y **OK** confirma.

@fig img/vender-teclado-precio.png | crop=600,259,720,510 | width=55 | Teclado de precio: muestra el precio unitario original y **Restaurar** lo recupera.

Las líneas que forman parte de una **oferta** no se pueden tocar una a una: el TPV avisa «Producto incluido en oferta. Modifica la oferta.» (ver «Ofertas y packs» más abajo).

### Descuentos

Un administrador debe activar **Opciones → Carrito → Descuentos manuales en carrito**. Entonces:

- **Descuento de línea.** El botón **%** de la línea abre un teclado con el precio unitario y los accesos rápidos **10 %, 20 %, 50 % y 100 %**, además de poder escribir cualquier otro porcentaje.
- **Descuento general.** Debajo del total aparece la fila «Descuento general». **Cantidad / %** abre el mismo teclado para descontar a todo el pedido; **Quitar** lo elimina. Si una línea tiene su propio descuento, manda el de la línea.
- El descuento general se quita solo después de cobrar, igual que el cliente.

@fig img/vender-descuento-linea.png | crop=600,259,720,560 | width=55 | Teclado del descuento de una línea, con los accesos rápidos de porcentaje.

@fig img/vender-descuento-general.png | crop=600,259,720,510 | width=55 | Teclado del descuento general, con los accesos rápidos de porcentaje.

### Ofertas y packs

Las **ofertas** (por ejemplo «3x1» o un menú) se ven distintas de un producto normal. Al tocarlas se abre una ventana con sus componentes, donde puedes marcar cuáles lleva el cliente y cuántas unidades (**−**, **+** y **↺** para volver al valor inicial), con **Marcar todo** y **Desmarcar todo**. En el carrito la oferta aparece como una línea principal con su lápiz **✎** («Editar oferta») y sus componentes debajo, sin precio. En la información de un ticket los componentes se ven como «↳ … incluido».

### Lector de códigos de barras

Si tu equipo tiene un lector de códigos de barras, **no hace falta tocar ningún campo**: lee el código en cualquier momento y el TPV añade el producto. Si el código no corresponde a ningún producto, avisa con «No se encontró producto para el código …». Con una ventana abierta (por ejemplo, la de cobro) el lector se ignora.

## 3. Elegir un cliente

Si la venta es a un cliente concreto (por ejemplo, para factura), pulsa el icono de persona junto al nombre del cliente.

@fig img/vender-clientes.png | crop=455,0,1010,330 | marks=1:1240,34;2:1397,60;3:1330,91 | Ventana «Seleccionar cliente». Los nombres de la imagen son de ejemplo.

1. **Buscador.** Busca por nombre, CIF o código.
2. **Nuevo cliente.** El botón **+** permite dar de alta un cliente sin salir de la venta.
3. **Lista.** Pulsa sobre un cliente para seleccionarlo. Con el lápiz azul puedes editar sus datos.

@fig img/vender-clientes-botones.png | crop=455,8,1010,160 | marks=1:1308,34;2:1355,34;3:1397,34;4:1383,138;5:1418,138 | Botones de la ventana de clientes (nombres de ejemplo).

1. **⌨** abre el teclado en pantalla.
2. **🗑 Papelera.** Abre la papelera de clientes (ver abajo).
3. **+** da de alta un cliente nuevo. El formulario pide nombre, razón social, tipo, identificación fiscal, dirección, código postal, ciudad, provincia, país, teléfono y email.
4. **✎** edita los datos del cliente.
5. **✖** **no borra** al cliente: lo manda a la papelera, es decir, lo oculta de esta lista. No se ofrece para el cliente por defecto ni para el que está seleccionado.

### La papelera de clientes

@fig img/vender-papelera-clientes.png | crop=580,420,760,180 | width=60 | Papelera de clientes (aquí vacía).

Los clientes que «borras» con la ✖ siguen existiendo en FacturaScripts; solo se esconden del selector de este TPV. En la papelera puedes **Reactivar** a un cliente para que vuelva a la lista, o **Borrar definitivamente**. Si FacturaScripts no deja borrarlo (normalmente porque tiene facturas), el TPV te ofrece **Dar de baja en FacturaScripts**, que sí es un cambio real en FacturaScripts.

En el propio carrito, junto al nombre del cliente: **✖** vuelve al cliente por defecto, **✎** edita el cliente y **+** crea uno nuevo. Si el cliente tiene tarifa especial, verás una etiqueta «Tarifa».

Cuando termines de cobrar, el TPV vuelve al cliente por defecto para la venta siguiente.

## 4. Cobrar

Cuando el pedido esté listo, pulsa **Cobrar**.

@fig img/cobrar-ventana.png | crop=500,190,920,640 | marks=1:650,290;2:1095,290;3:645,360;4:1048,352;5:1398,664;6:522,768 | Ventana de cobro.

1. **Total** a cobrar.
2. **Cambio.** Mientras escribes lo que entrega el cliente, aquí aparece lo que hay que devolverle. Si todavía falta dinero por indicar, aparece en negativo lo que falta por cobrar.
3. **Formas de pago.** Aparecen las configuradas en tu empresa (por ejemplo *Al contado*, *Tarjeta de crédito*, *Transferencia bancaria*). Escribe el importe en la forma de pago que corresponda, o pulsa **Máx** para poner en ella todo el importe pendiente. Puedes repartir una misma venta entre varias formas de pago.
4. **Teclado numérico.** Para escribir los importes con el dedo. El botón dorado borra la última cifra y la **C** borra **todos los importes** escritos (de todas las formas de pago). Para quitar solo el de una forma de pago, usa el icono de papelera de su fila.
5. **Confirmar Pago.** Emite la venta y, si tienes la opción activada, imprime el ticket. **Cancelar** vuelve al pedido sin cobrar nada.
6. **Abrir cajón.** Abre el cajón portamonedas sin tener que hacer una venta.

Los campos **Número**, **Serie** y **Observaciones** son opcionales: la serie viene elegida por defecto y las observaciones quedan guardadas en la venta.

> **Consejo:** si el cliente paga con dos medios (parte en efectivo y parte con tarjeta), escribe cada importe en su forma de pago y comprueba que el cambio queda a cero antes de confirmar.

### Avisos al pulsar Cobrar

Antes de abrir la ventana de cobro el TPV hace varias comprobaciones:

- **Total de 0 €.** Si hay un producto con precio 0 € en el catálogo, sin descuento ni precio editado, **no te deja cobrar** y te dice cuál es. Si el 0 € es intencionado (por ejemplo, un descuento del 100 %), sí te deja y el botón pasa a **Confirmar ticket gratuito**.
- **Agente.** Si el terminal no tiene agente asignado, el botón **Cobrar** se vuelve naranja y pasa a decir **Asignar agente**: al tocarlo se abre el selector. Si el terminal no tiene ningún agente en FacturaScripts, el aviso te dice cómo arreglarlo (Agentes → pestaña «Terminal TPV» del empleado).
- **Stock.** Si hay productos sin stock suficiente que no tienen permitida la venta sin stock en FacturaScripts, sale este aviso:

@fig img/vender-sin-stock.png | crop=650,329,620,360 | width=60 | Aviso «Sin stock suficiente».

Puedes **Cancelar** o continuar con **Cobrar sin stock**. Para que un producto no bloquee nunca la venta, activa «Venta sin stock» en su ficha de FacturaScripts.

El botón también cambia mientras trabaja: **Cobrando…** y **Guardando…**, y queda desactivado con una explicación mientras no se puede cobrar. Si algo se queda colgado más de 45 segundos, el TPV desbloquea «Cobrar» solo y avisa: **antes de volver a cobrar ese ticket, comprueba en Tickets si la venta ya se registró**, para no cobrarla dos veces.

## 5. Después del cobro

- Aparece la ventana **Opciones del ticket**, con el documento, el **total** y el **cambio** que hay que devolver, y los botones **Imprimir ticket** y **Abrir cajón**. Se cierra sola a los 20 segundos.

@fig img/vender-postcobro.png | crop=700,393,520,232 | marks=1:1125,481;2:837,563;3:1083,563;4:1186,425 | Ventana posterior al cobro (datos de ejemplo).

1. **Cambio** a devolver al cliente.
2. **Imprimir ticket** (si no está activada la impresión automática).
3. **Abrir cajón.**
4. **✕** cierra la ventana (también se cierra sola).

- El ticket se imprime automáticamente si la opción **Imprimir al cobrar** está activada (**Opciones → Impresora**).
- El pedido se vacía **al instante** y queda listo para la siguiente venta: el cobro se termina de registrar en segundo plano.
- Si ese registro **falla de verdad**, el TPV avisa con **«Cobro fallido»** y guarda la venta como un pedido aparcado llamado «Cobro fallido #…» (o la deja abierta si aún no se había soltado). **La venta no está cobrada**: recupérala desde Aparcados y vuelve a cobrarla. En Modo Mesas, la mesa vuelve sola a su estado anterior.
- Para consultar o reimprimir ventas anteriores, pulsa **Tickets**.

## 6. Dejar un pedido para más tarde

- **Aparcar** guarda el pedido sin cobrarlo, por ejemplo si el cliente se va a buscar el dinero.
- **Aparcados** (o **Pedidos**, según el modo de trabajo) abre la lista de pedidos guardados. Desde ahí puedes recuperar uno para seguir con él y cobrarlo. El número del botón indica cuántos hay.
