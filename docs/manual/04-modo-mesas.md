# Modo Mesas

El Modo Mesas está pensado para bares y restaurantes: cada mesa tiene su propio pedido, la cocina recibe las comandas y la cuenta se cobra al final. Este capítulo explica cómo trabajar con el plano de la sala, atender una mesa, enviar comandas a cocina, dividir la cuenta y cobrar.

## 1. Entrar y salir del Modo Mesas

- Para **entrar**, pulsa el botón del cubierto (🍽️) *Ir a modo Mesas*, junto al buscador de productos.
- Para **salir**, pulsa la **✕** de la esquina superior derecha del panel de mesas.

El panel tiene tres pestañas: **Transacciones** (atender la mesa), **Mapa de Salas** (ver todas las mesas) y **Diseñar Salas** (cambiar la distribución).

## 2. El mapa de salas

@fig img/mesas-mapa.png | crop=0,0,800,540 | marks=1:166,62;2:680,58;3:262,352;4:552,360;5:16,107 | Mapa de la sala con una mesa ocupada.

1. **Pestañas.** Cambias entre *Transacciones*, *Mapa de Salas* y *Diseñar Salas*.
2. **Accesos rápidos a mesas.** Cada mesa tiene un botón con su color; si tiene un pedido abierto, aparece el número de pedidos. Un toque te lleva directamente a ella.
3. **Mesa ocupada.** Se muestra en naranja con el importe, la hora a la que se abrió y, si hay algo pendiente de enviar a cocina, el aviso **Sin enviar**. El círculo de color que la rodea indica qué camarero la está atendiendo.
4. **Mesa libre.** Se muestra en verde.
5. **Sala.** Si tu local tiene varias salas, cámbialas aquí.

Los colores de las mesas son: **verde** = libre, **naranja** = ocupada, **violeta** = reservada.

> **Cobrar libera la mesa:** al cobrar la cuenta, la mesa queda libre automáticamente. No hay que hacer nada más.

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
7. **Enviado a cocina.** Las líneas que ya se han enviado se agrupan aquí (pulsa para desplegarlas).
8. **Pendiente de enviar.** Las líneas nuevas que aún no han llegado a cocina.
9. **Enviar comanda.** Envía a cocina lo pendiente; el número indica cuántas líneas hay.
10. **Comanda con observación (✎).** Añade una nota a la comanda, como «sin sal» o «para compartir».
11. **Cobrar.** Cobra la cuenta de la mesa (ver el capítulo «Vender y cobrar»).

## 4. Comandas a cocina

Cuando los clientes piden, toca los productos y después **Enviar comanda**. Lo enviado pasa a la sección *Enviado a cocina* y, si añades más productos, aparecen otra vez como *Pendiente de enviar* para el siguiente envío.

Si tu administrador activa la **comanda automática** (**Opciones → Modo Mesas**), la comanda se envía sola pasados unos segundos desde el último producto añadido; en la barra verás la cuenta atrás y podrás **pausarla (⏸)** si el cliente aún está decidiendo.

Si la mesa sigue con productos sin enviar, en el mapa verás el aviso **Sin enviar**: así no se olvida nada.

## 5. Dividir la cuenta

Pulsa **Dividir** en la cabecera del pedido.

@fig img/mesas-dividir.png | crop=510,198,900,621 | marks=1:1192,331;2:516,369;3:1234,392;4:700,466;5:1268,762 | Ventana «Dividir ticket».

1. **Partes.** En cuántas cuentas quieres dividir.
2. **Modo.** *Por artículos (asignación manual)* o *Igualitario*.
3. **Columnas P1, P2…** (una por parte). En el modo por artículos, escribe o usa **+** y **−** para indicar cuántas unidades de cada producto van en cada cuenta.
4. **Restante.** Debajo de cada producto, lo que aún no has asignado a ninguna cuenta.
5. **Generar división.** Crea las cuentas separadas, que puedes cobrar una a una.

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

La pestaña **Diseñar Salas** permite montar el plano de tu local.

@fig img/mesas-disenar.png | crop=0,80,1900,520 | marks=1:44,234;2:44,430;3:1300,112;4:1790,112;5:150,596 | Pestaña Diseñar Salas.

1. **Mesas.** Elige el tipo de mesa (redonda, cuadrada o rectangular) y arrástrala al plano.
2. **Estructura.** *Barra*, *Entrada* y *Muro/Pared* para completar el local.
3. **Sala.** Cambia de sala, añade una (**+ Sala**), cámbiala de nombre (**Renombrar**) o bórrala.
4. **Deshacer / Rehacer.** Para corregir errores.
5. **Guardar sala.** Conserva los cambios. **Limpiar sala** la deja vacía.

## 10. Consejos

- Antes de empezar el servicio, comprueba que la caja está abierta.
- Revisa el mapa de vez en cuando: las mesas con el aviso **Sin enviar** tienen productos que la cocina aún no ha recibido.
- Si trabajas con varios terminales o con la app de camareros, todos ven el mismo plano: lo que hace uno se ve en los demás casi al instante.
