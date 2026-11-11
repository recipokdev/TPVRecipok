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
6. **Resumen** muestra un resumen de los aparcados. **Borrar pendientes** (solo aparece con el filtro *Sin cobrar*) elimina todos los pedidos sin cobrar de golpe: es irreversible y solo está disponible para administradores.
7. **Estado de la sincronización.** En verde indica «Sync al día»; muestra además cuántas operaciones esperan en cola, si hay incidencias y cuándo fue la última sincronización.
8. **El pedido.** Nombre, observaciones, fecha, cliente, productos e importe. La etiqueta **PENDIENTE** indica que aún no está cobrado.
9. **Imprimir** el ticket del pedido.
10. **Eliminar** el pedido aparcado.

### Pedidos cobrados y avisos de sincronización

Los pedidos ya cobrados se quedan en la lista durante el turno, con la etiqueta **COBRADO** y el número de factura. Para vaciarlos hay un botón propio:

@fig img/aparcados-cobrados.png | crop=470,285,980,215 | marks=1:1425,343;2:500,397;3:615,397 | Lista de aparcados con el filtro «Cobrados».

1. **Cobrados.** Muestra solo los pedidos ya cobrados.
2. **Resumen.**
3. **Limpiar cobrados.** Pide confirmación y borra del historial todos los pedidos cobrados. Se quitan también en los demás TPV en unos segundos.

Si la sincronización detecta algún problema, aparece además un botón **Incidencias sync (N)** que abre una tabla con el motivo, el ticket y lo que había en este TPV y en el servidor. Cuando hay un conflicto manda siempre la versión del servidor. **Limpiar incidencias** vacía la tabla. Es un registro de diagnóstico: normalmente no hay que hacer nada.

## 3. Recuperar un pedido y cobrarlo

Pulsa sobre el **nombre** del pedido en la lista. Se carga en el carrito y la ventana se cierra.

@fig img/aparcados-recuperado.png | crop=1410,100,500,430 | marks=1:1425,115;2:1770,180;3:1840,166 | Pedido recuperado en el carrito.

1. **Cabecera del pedido.** Muestra el nombre, el cliente, la fecha y las observaciones del ticket que estás atendiendo.
2. **Editar.** Cambia el nombre o las observaciones (la ventana pasa a llamarse «Editar ticket aparcado» y el botón es **Actualizar**).
3. **Borrar.** Elimina el pedido aparcado.
4. **↶ Deshacer.** Deshace el último cambio del pedido (líneas, cantidades y descuentos). Una vez usado aparece **↷ Rehacer** para volver a aplicarlo. Cada botón solo se ve cuando hay algo que deshacer o rehacer, y no aparecen en pedidos ya cobrados.

Ahora puedes añadir o quitar productos como en cualquier venta y pulsar **Cobrar**. **Los cambios se guardan solos** medio segundo después de hacerlos, así que no hace falta volver a aparcar: por eso el botón *Aparcar* se sustituye por **PreImpr**.

@fig img/aparcados-abierto.png | crop=1405,880,505,135 | marks=1:1491,912;2:1660,912;3:1829,944 | Botones con un pedido abierto.

1. **Salir.** (Antes *Vaciar*.) Deja el pedido tal como está y vuelve a una venta nueva, **sin borrarlo**: el pedido sigue pendiente en Aparcados.
2. **PreImpr** (preimpresión). Imprime la **cuenta provisional** («Pendiente de pago») sin cobrar nada, para dársela al cliente antes de cobrar. Solo está activo con un pedido abierto que tenga productos. En Modo Mesas, la mesa sigue ocupada.
3. **Cobrar.**

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

## 6. Dividir la cuenta

Sirve para cobrar un mismo pedido en **varias cuentas** (cada persona paga lo suyo, o a partes iguales), también fuera de Modo Mesas, por ejemplo en el mostrador o en un pedido «para llevar».

> Esta función viene **apagada**. Un administrador la activa en **Opciones → Carrito → «Dividir cuenta en el TPV normal»** (ver el capítulo «Opciones»).

Con ella activada, junto al total del carrito aparece el botón **Dividir**.

@fig img/dividir-tpv-carrito.png | crop=1405,100,505,800 | width=48 | marks=1:1809,853 | Carrito con el botón «Dividir» junto al total.

1. **Dividir.** Con productos en el carrito, púlsalo: el TPV guarda el pedido como aparcado y abre la ventana para repartirlo. Si ya tienes abierto un pedido desde **Aparcados**, el botón **Dividir** está en la cabecera del pedido.

@fig img/dividir-tpv-asistente.png | crop=510,292,900,434 | marks=1:1318,424;2:680,462;3:1180,548;4:1329,684 | Ventana «Dividir ticket».

1. **Partes.** En cuántas cuentas quieres dividir (de 2 a 12).
2. **Modo.** *Por artículos (asignación manual)*: tú indicas cuántas unidades de cada producto van en cada cuenta. *Igualitario*: cada cuenta lleva la misma fracción de cada línea y las partes suman siempre el total exacto.
3. **Columnas P1, P2…** En el modo por artículos, escribe o usa **+** y **−** para repartir las unidades. Debajo de cada producto se lee lo que aún no has asignado («Restante»).
4. **Generar división.** Crea las cuentas separadas.

Cada parte pasa a ser un pedido con el nombre del original y su número, por ejemplo «Ticket #12 (2/3)». Se abre la primera, con estas señales:

@fig img/dividir-tpv-partes.png | crop=1405,100,505,780 | width=48 | marks=1:1521,180;2:1735,180;3:1460,278;4:1470,831;5:1470,860 | La parte 1 de 2 abierta.

1. **← «Parte 1 de 2» →.** Qué parte tienes abierta y cuántas hay; las flechas pasan a la anterior o a la siguiente.
2. **Dividir.** Vuelve a abrir la ventana (por ejemplo, para deshacer la división).
3. **Cantidad y precio dividido.** En el modo igualitario, cada producto conserva su cantidad de siempre y debajo se lee «2 x 2,50 € ÷ 2».
4. **Tu parte.** El total grande es lo que paga **esta cuenta**.
5. **Cuenta completa / Por cobrar.** El total de todo el pedido y lo que queda por cobrar, que baja al cobrar cada parte.

**Cobrar las partes.** Pulsa **Cobrar** como siempre. Al terminar una parte, el TPV abre **solo la siguiente** («Siguiente parte lista»); al cobrar la última aparece «División completada». Si sales sin cobrar todas, las partes que faltan quedan en **Aparcados** como pedidos «(2/2)», «(3/3)»… y las cobras cuando quieras desde allí.

**Deshacer la división.** Con ninguna parte cobrada todavía, abre **Dividir**, pon **Partes = 1** y pulsa **Revertir división**: todo vuelve a ser un único pedido con las cantidades originales.

El **stock** se reparte solo entre las partes: no tienes que hacer nada para que cuadre.

En **Modo Mesas** la división funciona igual, con una explicación más detallada en el capítulo «Modo Mesas».

## 7. Consejos

- Pon un nombre reconocible al aparcar: la lista se entiende mucho mejor.
- No cierres la jornada con pedidos olvidados: revisa **Días anteriores** de vez en cuando.
- Si el cierre de caja te avisa de que hay pedidos aparcados, consulta el capítulo «Caja».
