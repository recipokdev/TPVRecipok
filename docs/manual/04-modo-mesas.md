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

### Cuando otra persona tiene la misma mesa abierta

Al abrir una mesa que otra persona tiene abierta en otro dispositivo (otro TPV o la tablet de un camarero), aparece una franja justo sobre las líneas del carrito:

@fig img/mesas-en-uso.png | crop=1410,60,500,100 | width=70 | marks=1:1870,120 | Aviso de mesa en uso.

1. **«Cintia (Tablet barra) tiene esta mesa abierta».** Quién la tiene abierta y desde qué dispositivo. Solo **informa**: no bloquea nada y puedes seguir trabajando. Si es la misma persona (el mismo agente) en otro dispositivo, no se avisa. Se actualiza sola, sin que tengas que hacer nada.

Ojo: lo que esa persona **ya ha guardado en la mesa** (el pedido) lo ves tú directamente en el carrito, y se actualiza en cuestión de segundos cuando ella lo cambia (y ella ve lo tuyo igual). La franja solo es el aviso de que está ahí.

Si esa persona usa la **app de camareros** y tu empresa tiene activada esta función, debajo de las líneas del carrito verás además **lo que está componiendo y aún no ha guardado** en la mesa, en un cuadro gris:

@fig img/mesas-preparando.png | crop=1410,95,500,590 | width=70 | marks=1:1880,121;2:1620,421;3:1862,566;4:1722,638 | La mesa ya tiene un pedido guardado y la tablet tiene un borrador sin enviar.

1. **El aviso de siempre:** «Cintia (Tablet barra) tiene esta mesa abierta».
2. **El pedido real** de la mesa (las líneas de arriba): ya está guardado, es el que se cobra y su total (8,60 €) es el del carrito.
3. **«Cintia está preparando · sin enviar».** Sus líneas, en gris y cursiva, como **vista previa de solo lectura**. No son un pedido: no reservan stock, no salen en la comanda y no se pueden cobrar hasta que el camarero pulse **Enviar**. Si la mesa aún no tiene pedido, el carrito de arriba queda vacío y solo se ve este cuadro.
4. **Total del borrador.** No se suma al total del carrito.

Cosas que conviene saber:

- Si **dos camareros** tienen un borrador a la vez, salen dos bloques, uno debajo de otro, separados por una línea punteada.
- Un borrador muy largo se corta a las 12 primeras líneas («… y 3 más»).
- Cuando el camarero vacía o envía su borrador, el cuadro desaparece. Si su tablet **pierde la conexión**, desaparece sola en menos de un minuto.
- Al **cambiar de mesa**, el aviso y el borrador desaparecen; vuelven si regresas a una mesa que alguien tiene abierta.

@fig img/mesas-dos-borradores.png | crop=1410,95,500,720 | width=70 | Dos tablets con un borrador cada una.

### Si intentas cobrar o borrar la mesa mientras hay un borrador

Si pulsas **Cobrar** (o **Borrar mesa**) y otro dispositivo tiene en esa mesa un borrador sin enviar, el TPV te avisa antes, porque lo que está componiendo **no entraría en la cuenta**:

@fig img/mesas-aviso-cobrar.png | crop=780,382,360,262 | width=55 | marks=1:960,520;2:967,628;3:1083,628 | Aviso al cobrar con un borrador sin enviar.

1. **Qué está preparando y quién.** Si lo cobras ahora, eso no se incluirá en la cuenta.
2. **Cobrar igualmente.** Sigue con el cobro. Es para cuando el borrador se quedó olvidado en la tablet.
3. **Esperar** (el botón destacado; también **Enter** o **Esc**). No pasa nada: puedes esperar a que el camarero envíe y cobrar entonces.

Con **Borrar mesa** el aviso es el mismo y el botón dice **Borrar igualmente**. Si no hay ningún borrador, no pregunta nada. Se basa en lo último que sabe el TPV de esa mesa, que se actualiza solo en unos segundos.

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
- **Igualitario.** Divide el pedido **a partes iguales**: cada cuenta lleva **la misma fracción de cada línea** (con 3 partes, un tercio de cada producto y de su precio) y el total sale repartido por igual. Las partes **suman siempre el total exacto del ticket**: si no se puede repartir a partes iguales al céntimo, alguna cuenta sale un céntimo más cara que otra (el cuadro lo muestra como «5,86 – 5,87»). Es el modo para cuando se comparte todo y se paga a medias.

@fig img/mesas-dividir-igualitario.png | crop=510,198,900,621 | marks=1:1192,331;2:516,369 | Modo igualitario con 3 partes.

1. **Partes.** Aquí, 3: cada cuenta lleva un tercio.
2. **Modo: Igualitario.** No hay columnas por parte: las líneas se reparten solas, sin que tengas que asignar nada.

Se puede dividir en **2 a 12 partes**. Cada parte pasa a ser un pedido de esa misma mesa, con el nombre del original y el número de la parte, por ejemplo «Ticket #12 (2/3)», que se **cobra por separado**.

Una vez dividido, la cabecera permite moverte entre las partes («Parte n de m») con las flechas.

@fig img/mesas-dividido-partes.png | crop=1410,100,500,720 | width=70 | marks=1:1445,226;2:1515,226;3:1596,226;4:1664,226;5:1546,314;6:1837,322;7:1590,771;8:1650,801 | Pedido ya dividido: la parte 1 de 3.

1. **←** pasa a la parte anterior.
2. **«Ticket: Parte 1 de 3».** La parte que tienes abierta y cuántas hay: «1 de 3» quiere decir que eres la primera de las tres cuentas, no «un tercio».
3. **→** pasa a la parte siguiente.
4. **Dividir** vuelve a abrir la ventana, por ejemplo para **Revertir división**.
5. **Cantidad de siempre y precio dividido.** Cada producto conserva su cantidad (los 2 cafés) y debajo se lee «2 x 1,60 € ÷ 3»: lo que cuesta, repartido entre las 3 partes.
6. **Lo que pagas por esa línea** en esta cuenta (1,07 €).
7. **Tu parte: 1 de 3.** El total grande es lo que paga **esta cuenta**.
8. **Mesa completa / Por cobrar.** Debajo, el total de **toda la mesa** (todas las partes) y lo que queda **por cobrar**, que baja al cobrar cada parte.

Por dentro, el programa guarda en cada parte la fracción exacta de cada producto (por ejemplo 0,6667 de los 2 cafés), para que el stock y las facturas cuenten bien; en pantalla no tienes que verla. Las partes suman siempre el total exacto de la mesa.

### El ticket impreso de cada parte

Al cobrar una parte, el **ticket** sale con la misma presentación que el carrito: cada producto con su cantidad de siempre y, debajo, «2 x 1,60 ÷ 3», y una línea en la cabecera que dice «Cuenta dividida en 3 partes iguales».

@fig img/impresion-ticket-dividido.png | width=42 | Ticket de una parte de una cuenta dividida en 3.

Si más adelante **reimprimes** ese ticket desde **Tickets**, el programa ya no tiene a mano la información de cómo se dividió y las cantidades salen como decimales (por ejemplo 0,67), con los importes iguales.

### Un ejemplo completo

Esta mesa de **18,00 €** (2 cafés, 1 croissant, 1 zumo y 3 milhojas), dividida en **3 partes iguales**, queda así:

@fig img/mesas-dividir-comparacion.png | width=100 | La misma mesa antes de dividir y las tres partes.

Cada cuenta paga **6,00 €**, y si sumas lo que paga cada parte por cada producto sale lo de la mesa original: café 1,07 + 1,07 + 1,06 = 3,20 €; croissant 0,50 × 3 = 1,50 €; zumo 0,93 + 0,93 + 0,94 = 2,80 €; milhojas 3,50 × 3 = 10,50 €. Cuando un importe no se puede repartir por igual al céntimo, alguna parte paga un céntimo más y otra uno menos, de forma que **el total de la mesa no cambia**. Fíjate también en que «Mesa completa» y «Por cobrar» son los mismos en las tres partes mientras no se cobra ninguna.

Si te equivocas, vuelve a abrir **Dividir** y usa **Revertir división** (equivale a poner *Partes = 1*): junta todas las partes en un único ticket, con las cantidades exactamente como estaban en el pedido original.

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
