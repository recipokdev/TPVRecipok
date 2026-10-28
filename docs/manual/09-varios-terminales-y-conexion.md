# Varios terminales, camareros y conexión

Este capítulo explica cómo trabajar con más de un TPV a la vez, cómo vincular las tablets de los camareros, qué ocurre cuando se pierde internet y cómo se actualiza el programa.

## 1. Trabajar con varios terminales

Una misma empresa puede tener varios TPV (por ejemplo, uno en barra y otro en sala). Cada equipo es un **terminal**, y el TPV muestra en todo momento con cuál trabajas en la barra inferior.

- **Pedidos aparcados y mesas compartidos.** Lo que hace un terminal (aparcar un pedido, abrir una mesa, añadir productos) lo ven los demás casi al instante, sin tener que hacer nada.
- **Cada terminal tiene su caja.** Cada uno abre y cierra la suya.
- **Cada terminal puede ver familias distintas.** Se configura en **Opciones → Terminales**.

### Dos equipos con el mismo terminal

Si dos ordenadores están configurados como el **mismo terminal**, **comparten una sola caja**. Si la caja se abre o se cierra en uno, el otro lo avisa («la caja se cerró en otro TPV»), y puede aparecer el aviso informativo **«Hay N TPV activos en esta terminal»**. Es solo un aviso: no impide trabajar.

### Si dos terminales tocan el mismo pedido
Si alguien modifica una mesa o un pedido en otro terminal mientras tú lo tienes abierto, el TPV te avisa con un mensaje del tipo **«Esta mesa se actualizó desde otro terminal mientras estaba abierta»** y muestra la versión más reciente. No se pierde nada: revisa que el pedido es el que esperabas.

### Si ves pedidos que no coinciden
En la lista de **Aparcados** hay dos botones para estos casos:
- **Sync** fuerza ahora la sincronización con el servidor.
- **Reiniciar** borra la copia local de aparcados de este TPV y la vuelve a descargar: úsalo si ves pedidos «fantasma» o que no coinciden con los de otro terminal.

## 2. Tablets de camareros

Los camareros pueden tomar las comandas desde una tablet con la **app de camareros**. Para vincular una tablet:

1. En el TPV, entra en **Opciones → Modo Mesas** (como administrador) y pulsa **Vincular tablet de camarero**. El TPV genera un **código de un solo uso**.
2. Escribe ese código en la app de camareros de la tablet.
3. Listo: la tablet queda emparejada de forma permanente con tu negocio y no hace falta volver a introducir ningún código al abrir la app.

> **Importante:** el código caduca a los **10 minutos** si no se usa. Si caduca, genera uno nuevo.

En **Tablets emparejadas** ves los dispositivos con acceso a tu negocio y, de cada uno, el **agente vinculado**. Si una tablet se pierde, se vende o ya no debe tener acceso, **revócala**: necesitará un código nuevo para volver a emparejarse. El botón **Desvincular agente** quita a mano el agente asociado a una tablet (por ejemplo, un móvil perdido o reseteado).

Las tablets revocadas pasan a una **🗑 Papelera** plegada, donde puedes **Olvidar para siempre** las que ya no quieras ver.

## 3. Estado de la conexión

En la esquina inferior izquierda de la pantalla ves siempre el estado de la conexión:

- **Punto verde, «Online Recipok»:** todo conectado.
- **Punto rojo, «Sin internet (modo offline). Reintentando conexión…»:** no hay conexión con el servidor. El TPV lo seguirá intentando solo.

Con el botón **🔄 Actualizar datos** (junto al buscador de productos) puedes recargar los productos y datos de la empresa cuando quieras, por ejemplo después de cambiar un precio en FacturaScripts.

### Qué pasa si se corta internet
- Si el TPV ya tenía los datos cargados, **puedes seguir vendiendo**. Las ventas se guardan en una cola en el propio equipo.
- En la lista de **Tickets**, esas ventas aparecen con un código que empieza por **OFF-** y el cliente «Venta en cola» hasta que se envíen.
- Cuando vuelve la conexión, el TPV envía solo las ventas pendientes y las registra con su número de factura definitivo.
- Si el TPV se abre sin conexión y no tiene datos guardados, muestra el aviso **«No hay conexión con Recipok. Espera por favor, reconectando…»**.
- Con la conexión caída, el botón de caja puede mostrar **Conectar**: púlsalo para reintentar.

> **Importante:** no cierres el programa mientras haya ventas en cola. Espera a que se recupere la conexión y se envíen.

Si una venta de la cola **no se puede sincronizar de verdad**, el TPV lo avisa claramente para que la cobres a mano. Antes de repetir un cobro, **comprueba siempre en Tickets** si la venta ya llegó a registrarse, para no cobrarla dos veces. En la barra de estado puede verse también un tercer estado ámbar, **«Conexión inestable…»**, además del verde (conectado) y el rojo (sin conexión).

## 4. Actualizaciones del programa

El TPV comprueba por sí solo si hay una versión nueva y la descarga en segundo plano. En **Opciones → Actualización automática**:

- **Mostrar avisos de actualización.** Activa o desactiva el aviso.
- **Frecuencia de comprobación.** Cada cuánto se comprueba. **Comprobar ahora** lo hace en el momento.
- **Changelog.** Muestra las novedades de cada versión.
- **Actualizar Programa** (botón al pie de la ventana de Opciones). Instala la versión nueva cuando está lista.

Es mejor actualizar **fuera del horario de servicio**, con la caja cerrada.

## 5. Cambiar el equipo de empresa o dejarlo para otra

Si un TPV se ha activado con la empresa equivocada, o va a pasar a otra empresa:

- **Opciones → Terminales → Cambiar de empresa** (solo administradores). En la ventana de inicio de sesión también existe un botón con el mismo nombre, pero solo se muestra en equipos activados con una empresa de pruebas (demo).

Esto quita la empresa, el usuario, el terminal y la caja guardados en **ese** equipo y vuelve a pedir el email de la empresa.

## 6. Entorno de pruebas

En la parte inferior de la ventana de **Opciones** encontrarás el **Entorno de pruebas**, con el que puedes **practicar sin riesgo**: el TPV simula cobros, aparcados e impresión sin enviar datos reales. Al salir del entorno de pruebas se restaura el estado anterior. Úsalo para formar a personal nuevo.
