# Modo Mesas

El Modo Mesas está pensado para bares y restaurantes: cada mesa tiene su propio pedido, la cocina recibe las comandas y la cuenta se cobra al final. Este capítulo explica cómo trabajar con el plano de la sala, atender una mesa, enviar comandas a cocina, dividir la cuenta y cobrar.

## 1. Entrar y salir del Modo Mesas

- Para **entrar**, pulsa el botón del cubierto (🍽️) *Ir a modo Mesas*, junto al buscador de productos.
- Para **salir**, pulsa la **✕** de la esquina superior derecha del panel de mesas.

El panel tiene tres pestañas: **Transacciones** (atender la mesa), **Mapa de Salas** (ver todas las mesas) y **Diseñar Salas** (cambiar la distribución).

> **Dos zonas separadas.** El Modo Mesas y el TPV normal **no comparten sus pedidos aparcados**: cada uno tiene los suyos. Los pedidos de las mesas solo se ven (en el botón **Pedidos**) dentro del Modo Mesas, y los aparcados del TPV normal solo se ven fuera de él. Los productos y el stock sí son los mismos para los dos.

> Cada modo **recuerda su carrito**: al pasar de uno a otro, o si se reinicia el programa, el TPV vuelve a dejarte lo que tenías abierto en ese modo y los pedidos aparcados tal como estaban.

## 2. El mapa de salas

@fig img/mesas-mapa-estados.png | crop=0,0,800,540 | marks=1:300,58;2:790,41;3:360,362;4:352,224;5:538,224;6:140,92 | Mapa de la sala con mesas libres, reservadas y ocupadas.

1. **Pestañas.** Cambias entre *Transacciones*, *Mapa de Salas* y *Diseñar Salas*.
2. **Accesos rápidos a mesas.** Cada mesa tiene un botón con su color; si tiene un pedido abierto, aparece un número que es su **turno**: el 1 es la mesa que lleva más tiempo abierta en esa sala, así ves cuál atender primero. Dentro de *Transacciones*, un toque en uno de estos botones **cambia a esa mesa**; estando en el *Mapa de Salas*, solo la deja resaltada (para abrirla, toca la mesa en el plano).
3. **Mesa ocupada.** Se muestra en naranja con el importe, la hora a la que se abrió, su **número de turno** (el circulito blanco de debajo) y, si hay algo pendiente de enviar a cocina, el aviso **Sin enviar**. El círculo de color que la rodea indica qué camarero la está atendiendo.
4. **Mesa libre.** Se muestra en verde.
5. **Mesa reservada.** Se muestra en violeta, con el nombre y la hora de la reserva.
6. **Sala.** Si tu local tiene varias salas, cámbialas aquí.

Los colores de las mesas son: **verde** = libre, **naranja** = ocupada, **violeta** = reservada.

> **Cobrar libera la mesa:** al cobrar la cuenta, la mesa queda libre automáticamente. No hay que hacer nada más.

### Pulsación larga sobre una mesa

Un toque corto sobre una mesa la abre. Si en cambio **mantienes pulsada** una mesa (algo menos de medio segundo), se abre una ventanita con su información y acciones rápidas.

@fig img/mesas-pulsacion-larga.png | crop=215,265,240,300 | width=34 | Información de una mesa ocupada (pulsación larga).

- **Datos de la mesa:** camarero, comensales, total, número de líneas, hora de inicio y fase de servicio.
- **Ver ticket** (en una mesa ocupada) o **Abrir ticket** (en una mesa libre o reservada).
- **Servicio:** marca la fase en la que está la mesa: **Sin pedir**, **Pedido** o **Entregado**.
- **Editar mesa:** cambia los **comensales** y, en una reserva, el nombre y la hora.
- **Estado de la mesa:** en una mesa libre puedes **Reservar**, **Cancelar reserva** o pasarla a **ocupada**. Una mesa ocupada solo se puede **Liberar** si **no tiene productos**.

### Señales en el plano

- **Número de turno** bajo cada mesa ocupada. Ordena las mesas ocupadas **de esa sala** por antigüedad: la que lleva más tiempo abierta es la **1**, la siguiente la **2**, y así. No es un contador que siga subiendo: se recalcula solo. Si se cobra o se libera la mesa 1, la que era la 2 pasa a ser la 1, como en una cola de espera.

@fig img/mesas-mapa-estados.png | crop=230,335,360,135 | width=42 | Dos mesas ocupadas: la M3 es la que lleva más tiempo (1) y la M4 la siguiente (2).

@fig img/mesas-mapa-renumerado.png | crop=230,335,360,135 | width=42 | Al liberar la M3, la M4 pasa a ser la 1.
- **Fase de servicio:** la mesa ocupada se anima de forma distinta según la fase (*Sin pedir* llama más la atención; *Pedido* es suave; *Entregado* no se anima).
- **🖨 Sin enviar:** hay productos sin enviar a cocina. Se pone en **rojo** cuando lleva unos 10 minutos sin enviarse.
- **⚠ Comanda:** la impresión automática de la comanda ha fallado en este TPV. Comprueba la impresora de comandas (capítulo «Impresión y cajón»).
- **Aviso discreto «Ana (Barra) tiene esta mesa abierta»:** otra persona tiene la misma mesa abierta en otro dispositivo. Solo informa, no bloquea. Si usa la app de camareros y tu empresa lo tiene activado, también verás lo que **está preparando** (sin enviar) en solo lectura: no reserva stock ni sale en la comanda hasta que lo envíe.

## 3. Atender una mesa

1. Entra en **Mapa de Salas** y toca la mesa. Se abre la pestaña **Transacciones** con esa mesa seleccionada. También puedes elegir **Sala** y **Mesa** en los desplegables de la parte superior.
2. Toca los productos que pide el cliente. No hay que guardar: **el pedido se guarda solo** desde el primer producto, y la mesa pasa a «Ocupada».

@fig img/mesas-transacciones.png | crop=0,0,1920,1017 | marks=1:165,72;2:240,150;3:240,300;4:240,458;5:1415,125;6:1745,189;7:1425,289;8:1425,341;9:1405,812;10:1858,812;11:1745,890 | Pestaña Transacciones con una mesa ocupada.

1. **Pestañas y selector de sala y mesa.**
2. **Mesa seleccionada.** Su nombre, la sala, el estado y el importe acumulado.
3. **Otras mesas.** Lista rápida para cambiar de mesa o mover el pedido (ver más abajo).
4. **Acciones rápidas.** *Tickets*, *Personas* (número de comensales) y *Cambiar de mesa*. En una mesa libre también aparece **Reserva**, con un interruptor para marcarla como reservada y anotar los datos de la reserva.
5. **Cabecera del pedido.** Nombre de la mesa, número de ticket, estado y hora.
6. **Dividir**, **Editar** (nombre y observaciones del pedido) y **Borrar mesa**.
7. **Enviado a cocina.** Las líneas que ya se han enviado se agrupan aquí (pulsa para desplegarlas o plegarlas; con 4 líneas enviadas o más, se pliega sola).
8. **Pendiente de enviar.** Las líneas nuevas que aún no han llegado a cocina.
9. **Enviar comanda.** Envía a cocina lo pendiente; el número indica cuántas líneas hay.
10. **Comanda con observación (✎).** Añade una nota a la comanda, como «sin sal» o «para compartir».
11. **Cobrar.** Cobra la cuenta de la mesa (ver el capítulo «Vender y cobrar»).

### Más cosas de la cabecera y del pedido

- **↶ Deshacer / ↷ Rehacer.** Junto a *Borrar mesa*: deshace el último cambio del pedido. Solo aparecen cuando hay algo que deshacer o rehacer.
- **Vaciar.** Quita **solo lo que aún no se ha enviado a cocina** y mantiene la mesa y el ticket. Lo ya enviado no se vacía: se quita línea a línea con la **✕** (ver «Devolver algo a cocina»).
- **Comensales.** En la cabecera aparece «👥 N comensales». Si tu local tiene *familias por comensales*, verás también «×N en: …», para que no parezca un fallo que al tocar 1 producto salgan N.
- **Editar.** Además del nombre y las observaciones del pedido, ofrece cinco **avisos rápidos de mesa**: *Niños*, *Vegetariano*, *Sin sal*, *Alérgicos* y *Sin gluten*. Salen como etiquetas en la cabecera del pedido y en la lista de pedidos.

@fig img/mesas-editar-avisos.png | crop=680,308,560,401 | width=50 | Ventana «Editar pedido de mesa» con los avisos rápidos.

## 4. Comandas a cocina

Cuando los clientes piden, toca los productos y después **Enviar comanda**. Mientras no se envían, cada línea muestra un botón **⏸** (retener) y la barra naranja indica cuántas líneas hay pendientes.

@fig img/mesas-carrito-pendiente.png | crop=1405,100,505,770 | width=62 | Mesa con tres líneas pendientes: la barra «Enviar comanda» cuenta atrás.

Si tu administrador activa la **comanda automática** (**Opciones → Modo Mesas**), la comanda se envía sola pasados unos segundos desde el último producto añadido (por defecto 60 segundos; con 0 se envía al instante). En la barra verás la cuenta atrás y podrás **pausarla (⏸)** si el cliente aún está decidiendo.

Si la mesa sigue con productos sin enviar, en el mapa verás el aviso **Sin enviar**: así no se olvida nada.

> Lo que el camarero envía desde la **app de camareros** se imprime en cocina en pocos segundos y **siempre**, aunque la comanda automática esté apagada: la espera solo se aplica a lo que se monta en el TPV. Cada línea conserva el nombre del camarero («Enviado · hora · Comanda N · nombre»).

### Lo ya enviado y lo pendiente

@fig img/mesas-lineas-enviadas.png | crop=1405,290,505,420 | marks=1:1430,310;2:1812,351;3:1436,377;4:1540,617;5:1494,648 | Carrito con comandas ya enviadas y una línea pendiente.

1. **Enviado a cocina.** Agrupa lo ya enviado, con una cabecera por envío («Enviado · hora · Comanda N · TPV»). Se pliega y despliega al pulsar; con 4 líneas enviadas o más se pliega sola.
2. **🖨 Reimprimir.** Vuelve a imprimir **solo esa comanda**, con el aviso REIMPRESIÓN, y no envía nada nuevo. Solo aparece en las comandas que salieron de este TPV.
3. **Líneas en gris.** Lo ya enviado se ve atenuado y no se cambia sin confirmar.
4. **Pendiente de enviar.** Lo nuevo, que saldrá en la siguiente comanda.
5. **⏸ Retener.** Pulsa ⏸ en una línea pendiente para que **no salga** en la próxima comanda (por ejemplo, el postre).

Si **subes la cantidad** de una línea ya enviada con **+**, esa línea se queda intacta y las unidades nuevas aparecen como **una línea aparte** pendiente (si tenías 2 enviadas y subes a 5, verás 2 en gris y 3 nuevas). Al pulsar **−**, se quita primero la línea nueva.

### Retener una línea y lanzarla después

@fig img/mesas-retenida.png | crop=1405,290,505,170 | marks=1:1523,392 | Línea retenida («En espera»).

1. **▶ Lanzar.** Una línea retenida muestra «En espera (no enviado a cocina)». Pulsa **▶** cuando el cliente esté listo y pasará a pendiente de envío. Mientras solo queden líneas retenidas no hay comanda que enviar.

### Devolver algo a cocina

Si **bajas la cantidad, quitas, o cambias el precio o el descuento** de una línea que ya se ha enviado, el TPV pide confirmación:

@fig img/mesas-ya-en-cocina.png | crop=650,388,620,241 | width=55 | Aviso al tocar una línea ya enviada.

Al aceptar, la barra pasa a **Enviar devolución (N)**. Cuando se envía, sale en cocina un papel con el título **DEVOLUCIÓN** (en grande y con fondo invertido) para que no preparen lo que se ha quitado.

@fig img/mesas-devolucion-barra.png | crop=1405,785,505,85 | width=70 | marks=1:1520,803;2:1825,803;3:1883,803 | Barra con una devolución pendiente.

1. **Enviar devolución.** Avisa a cocina de lo quitado.
2. **⏸** pausa el envío automático.
3. **✎** abre la ventana de la comanda (ver abajo).

### La ventana «Comanda cocina» (✎)

Con algo pendiente de enviar, el botón **✎** abre la comanda para revisarla o añadir una nota.

@fig img/mesas-comanda-ventana.png | crop=510,254,900,509 | width=72 | marks=1:528,605;2:545,648;3:630,648;4:790,648;5:1262,708 | Ventana «Comanda cocina».

1. **Envío automático (esta mesa).** Muestra «Se envía solo en N s» o «En pausa».
2. **Pausar / Reanudar** la cuenta atrás de esta mesa.
3. **No enviar solo.** La comanda no se enviará sola mientras lo pendiente no cambie; **Activar de nuevo** la devuelve al envío automático.
4. **Espera (s).** Los segundos de espera **solo para esta mesa** (se escribe con el teclado numérico). *Usar la de Opciones* vuelve al valor general.
5. **Imprimir comanda** envía ya lo pendiente, con la nota que hayas escrito en **Observaciones**. **Cancelar** cierra sin enviar.

Cuando la cuenta atrás la lleva **otro TPV** (el que editó la mesa el último), la barra muestra «se envía solo en N s (desde otro TPV)» y no tiene botón de pausa: solo imprime quien tiene el turno de impresión, para que la comanda no salga dos veces.

## 5. Dividir la cuenta

Pulsa **Dividir** en la cabecera del pedido.

@fig img/mesas-dividir.png | crop=510,198,900,621 | marks=1:1192,331;2:516,369;3:1234,392;4:700,466;5:1268,762 | Ventana «Dividir ticket».

1. **Partes.** En cuántas cuentas quieres dividir.
2. **Modo.** Cómo se reparte el pedido (se explica justo debajo): *Por artículos (asignación manual)* o *Igualitario*.
3. **Columnas P1, P2…** (una por parte). En el modo por artículos, escribe o usa **+** y **−** para indicar cuántas unidades de cada producto van en cada cuenta.
4. **Restante.** Debajo de cada producto, lo que aún no has asignado a ninguna cuenta.
5. **Generar división.** Crea las cuentas separadas, que puedes cobrar una a una.

### Qué diferencia hay entre los dos modos

- **Por artículos (asignación manual).** Tú decides **qué consume cada cuenta**: para cada producto indicas cuántas unidades van en la P1, en la P2, etc. Es el modo para cuando cada comensal paga lo suyo («yo la cerveza y el bocadillo; tú el café»). Hay que asignar artículos al menos a **dos** partes, y debajo de cada producto ves lo que **aún no has asignado**.
- **Igualitario.** Divide el pedido **a partes iguales**: cada cuenta lleva **la misma fracción de cada línea** (con 3 partes, un tercio de cada producto, con la cantidad en decimales) y el total sale repartido por igual. Es el modo para cuando se comparte todo y se paga a medias.

Se puede dividir en **2 a 12 partes**. Cada parte pasa a ser un pedido de esa misma mesa, con el nombre del original y el número de la parte, por ejemplo «Ticket #12 (2/3)», que se **cobra por separado**.

Una vez dividido, la cabecera permite moverte entre las partes («Parte n/m») con las flechas. Si te equivocas, vuelve a abrir **Dividir** y usa **Revertir división** (equivale a poner *Partes = 1*): junta todas las partes en un único ticket.

## 6. Cambiar o juntar mesas

Pulsa **Cambiar de mesa** y toca la mesa de destino en **Otras mesas**.

@fig img/mesas-cambiar.png | crop=0,230,500,400 | marks=1:12,267;2:238,303;3:238,589 | Elegir la mesa de destino.

1. **Elige la mesa destino.** Todo el pedido pasa a la mesa que toques.
2. **Mesa libre.** Si la mesa de destino está libre, el pedido se mueve entero y la mesa de origen queda libre.
3. **Cancelar cambio.** Anula la operación.

Si la mesa de destino **ya tiene un pedido**, el TPV te pregunta si quieres **juntar** las dos cuentas en una. Lo que ya se había enviado a cocina vuelve a quedar como pendiente en la mesa resultante, para no olvidar avisar a cocina de algo nuevo.

## 7. Comensales y reservas

- **Personas.** Pulsa para indicar cuántos comensales hay en la mesa con el teclado numérico.
- **Reserva.** En una mesa libre, activa el interruptor para marcarla como **reservada** (en el plano se ve en violeta).

## 8. Eliminar el pedido de una mesa

**Borrar mesa** elimina el pedido de la mesa. Igual que con los pedidos aparcados, el TPV pregunta si es un pedido real (se devuelve el stock) o un duplicado causado por un fallo de sincronización (no se toca el stock). Consulta el capítulo «Aparcados y pedidos».

## 9. Diseñar las salas

La pestaña **Diseñar Salas** permite montar el plano de tu local. Solo la ven los **administradores**.

@fig img/mesas-disenar.png | crop=0,80,1900,640 | marks=1:44,234;2:44,437;3:1332,111;4:1790,111;5:60,616;6:1655,111 | Pestaña Diseñar Salas.

1. **Mesas.** Elige la herramienta (mesa redonda, cuadrada o rectangular) y haz **clic en el plano** donde la quieras; vuelve a pulsar la herramienta para dejar de colocar. Para moverla después, arrástrala. Al seleccionar una mesa aparece el panel «Seleccionado» (nombre, comensales, capacidad…).
2. **Estructura.** *Barra*, *Entrada* y *Muro/Pared* para completar el local.
3. **Sala.** Cambia de sala, añade una (**+ Sala**), cámbiala de nombre (**Renombrar**) o bórrala.
4. **Deshacer / Rehacer.** Para corregir errores.
5. **Guardar sala.** Conserva los cambios. **Limpiar sala** la deja vacía.
6. **Modo libre.** Alterna entre mover las piezas **ajustándolas a la cuadrícula** y moverlas **libremente**.

## 10. Consejos

- Antes de empezar el servicio, comprueba que la caja está abierta.
- Revisa el mapa de vez en cuando: las mesas con el aviso **Sin enviar** tienen productos que la cocina aún no ha recibido.
- Si trabajas con varios terminales o con la app de camareros, todos ven el mismo plano: lo que hace uno se ve en los demás casi al instante.
