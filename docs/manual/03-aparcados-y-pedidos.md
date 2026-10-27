# Aparcados y pedidos

«Aparcar» un pedido es guardarlo sin cobrarlo para retomarlo más tarde. Se usa, por ejemplo, cuando un cliente encarga algo que recogerá luego, o cuando hay que atender a otra persona y se quiere dejar el pedido a medias.

## 1. Aparcar un pedido

Con el pedido en el carrito, pulsa **Aparcar**.

@fig img/aparcados-aparcar.png | crop=680,372,560,273 | width=75 | marks=1:688,448;2:688,523;3:1134,590 | Ventana «Aparcar ticket».

1. **Nombre del ticket.** El TPV propone uno automático («Ticket #210»); puedes cambiarlo por algo que te ayude a reconocerlo, como el nombre del cliente. La **✕** lo borra para escribir otro.
2. **Observaciones.** Opcional. Por ejemplo: «sin cebolla», «para llevar» o «pasa a recogerlo a las 17:00».
3. **Aparcar.** Guarda el pedido y deja el carrito vacío para atender al siguiente cliente.

> **Importante:** mientras el pedido está aparcado, el TPV reserva el stock de sus productos.

> **Aviso de pedido repetido:** si el cliente ya tiene un pedido sin cobrar, al aparcar otro el TPV te avisa. Si el cliente quiere **cambiar** su pedido, no crees uno nuevo: ábrelo desde Aparcados y edítalo (quita y añade productos). Así no se duplica ni se descuenta el stock dos veces. Puedes elegir *Crear uno nuevo igualmente*, *Ver Aparcados* o *Cancelar*.

## 2. La lista de aparcados

Pulsa **Aparcados** (en el botón verás cuántos hay pendientes) para abrir la lista.

@fig img/aparcados-lista.png | crop=470,337,980,343 | marks=1:476,413;2:868,398;3:971,398;4:1070,398;5:494,452;6:1055,467;7:478,512;8:488,580;9:1340,592;10:1388,592 | Lista de tickets aparcados.

1. **Buscador.** Encuentra un ticket por su nombre.
2. **Sync.** Fuerza ahora la sincronización con el servidor.
3. **Reiniciar.** Borra la copia local de aparcados de este TPV y la vuelve a descargar. Úsalo solo si ves pedidos «fantasma» o que no coinciden con los de otro terminal.
4. **Filtros.** *Todos*, *Sin cobrar* o *Cobrados*. Entre paréntesis ves cuántos hay de cada tipo.
5. **Hoy / Días anteriores.** Separa los pedidos de hoy de los que se quedaron sin cobrar otros días.
6. **Resumen** muestra un resumen de los aparcados. **Borrar pendientes** elimina todos los pedidos sin cobrar de golpe: es irreversible y solo está disponible para administradores.
7. **Estado de la sincronización.** En verde indica «Sync al día»; muestra además cuántas operaciones esperan en cola, si hay incidencias y cuándo fue la última sincronización.
8. **El pedido.** Nombre, observaciones, fecha, cliente, productos e importe. La etiqueta **PENDIENTE** indica que aún no está cobrado.
9. **Imprimir** el ticket del pedido.
10. **Eliminar** el pedido aparcado.

## 3. Recuperar un pedido y cobrarlo

Pulsa sobre el **nombre** del pedido en la lista. Se carga en el carrito y la ventana se cierra.

@fig img/aparcados-recuperado.png | crop=1410,100,500,430 | marks=1:1425,115;2:1770,180;3:1840,166 | Pedido recuperado en el carrito.

1. **Cabecera del pedido.** Muestra el nombre, el cliente, la fecha y las observaciones del ticket que estás atendiendo.
2. **Editar.** Cambia el nombre o las observaciones (la ventana pasa a llamarse «Editar ticket aparcado» y el botón es **Actualizar**).
3. **Borrar.** Elimina el pedido aparcado.

Ahora puedes añadir o quitar productos como en cualquier venta y pulsar **Cobrar**. Abajo a la izquierda, el botón **Vaciar** pasa a llamarse **Salir**: sirve para dejar el pedido tal como está y volver a una venta nueva, sin borrarlo.

## 4. Eliminar un pedido aparcado

Al eliminar un pedido sin cobrar, el TPV te pide confirmación, porque la acción no se puede deshacer, y te pregunta qué hacer con el stock que ese pedido tenía reservado.

@fig img/aparcados-borrar.png | crop=700,298,520,421 | marks=1:722,660;2:812,660;3:993,660 | Confirmación al eliminar un ticket aparcado.

1. **Cancelar.** No se borra nada.
2. **Es un fantasma: no tocar stock.** Solo para el caso raro de un ticket «fantasma»: un fallo de sincronización entre terminales lo sigue mostrando, pero ese pedido ya no existe (por ejemplo, ya se cobró en otro ordenador). No se modifica el stock.
3. **Eliminar y devolver el stock (lo normal).** El stock que estaba reservado vuelve a estar disponible. **Elige esta opción siempre que el pedido exista de verdad**, aunque esté repetido, lo hayas metido dos veces o el cliente ya no lo quiera.

> **Importante:** si dudas, elige **devolver el stock**. Si eliminas un pedido repetido con «no tocar stock», el stock de esos productos se queda descontado de más.

Si no quieres que se te pregunte siempre, un administrador puede desactivarlo en **Opciones → Productos → «Preguntar por el stock al Borrar pendientes»**. En ese caso se considera siempre que es un pedido real y se devuelve el stock.

## 5. Pedidos de días anteriores

Si un pedido se queda sin cobrar de un día para otro, el botón **Aparcados** se marca con el número en rojo, y una vez al día, con la caja abierta, el TPV te muestra un aviso. Abre la lista, entra en **Días anteriores** y cobra o elimina esos pedidos para tener la lista al día.

## 6. Consejos

- Pon un nombre reconocible al aparcar: la lista se entiende mucho mejor.
- No cierres la jornada con pedidos olvidados: revisa **Días anteriores** de vez en cuando.
- Si el cierre de caja te avisa de que hay pedidos aparcados, consulta el capítulo «Caja».
