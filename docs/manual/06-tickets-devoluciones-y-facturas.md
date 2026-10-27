# Tickets, devoluciones y facturas

Este capítulo explica cómo consultar las ventas ya cobradas, reimprimirlas, hacer una devolución, cambiar la forma de pago de un ticket y enviar la factura al cliente por correo electrónico.

## 1. La lista de tickets

Pulsa **Tickets** (abajo a la izquierda del carrito) para ver las ventas cobradas.

@fig img/tickets-lista.png | crop=500,70,920,470 | marks=1:1280,147;2:1313,127;3:648,206;4:1060,190;5:515,243;6:520,320;7:1115,322;8:1181,322;9:1247,322;10:1313,322 | Lista de tickets de la caja actual.

1. **Buscador.** Encuentra un ticket por número, cliente o importe.
2. **Recargar.** Vuelve a pedir la lista al servidor.
3. **Caja actual / Cajas anteriores.** Por defecto ves los tickets de la caja abierta; con *Cajas anteriores* puedes consultar los de jornadas pasadas.
4. **Filtros.** Muestra u oculta los tickets *Normales*, *Devueltos* y *Parciales* (devueltos solo en parte).
5. **Contadores.** Cuántos tickets hay, el neto vendido y cuántas devoluciones.
6. **Un ticket.** Número, estado (*OK* en verde cuando está correcto), cliente, fecha y hora, e importe.
7. **Imprimir.** Vuelve a imprimir el ticket.
8. **Enviar factura por email** (se explica más abajo).
9. **Devolver.**
10. **Cambiar pago.**

## 2. Devolver un ticket

Pulsa **↩ Devolver** en el ticket. El TPV avisa de que la devolución se comunicará a gerencia; pulsa **Aceptar** para continuar.

@fig img/tickets-devolucion.png | crop=510,246,900,525 | marks=1:516,325;2:1288,357;3:1185,405;4:1403,417;5:1232,712;6:516,712 | Ventana de devolución.

1. **Datos del ticket.** Número, cliente y total.
2. **Todo / Nada.** Selecciona de golpe todas las líneas o ninguna.
3. **Unidades a devolver.** En cada línea, indica con **+** y **−** cuántas unidades devuelve el cliente. Verás cuántas se vendieron, el IVA y el precio.
4. **Importe de cada línea** que se va a devolver.
5. **Confirmar devolución.** Registra la devolución. **Cancelar** cierra la ventana sin cambiar nada.
6. **Importe a devolver.** Suma de lo que se va a devolver al cliente.

Puedes devolver el ticket entero (**Todo**) o solo algunas unidades. En este último caso el ticket queda marcado como *Parcial*.

## 3. Cambiar la forma de pago

Si te equivocaste al cobrar (por ejemplo, marcaste efectivo y fue con tarjeta), pulsa **💳 Cambiar pago**. Igual que con las devoluciones, el TPV avisa de que el cambio se comunicará a gerencia.

@fig img/tickets-cambiar-pago.png | crop=510,374,900,270 | marks=1:516,455;2:517,534;3:1160,524;4:1330,584 | Ventana «Cambiar método de pago».

1. **Datos del ticket.**
2. **Recibos (pagos).** Indica la forma de pago actual del ticket.
3. **Cambiar a…** Elige la forma de pago correcta.
4. **Cerrar.** Sale sin cambiar nada.

> **Importante:** el TPV te avisa de que este cambio crea **dos tickets** (uno rectificativo que anula el anterior y uno nuevo con la forma de pago correcta), de modo que la contabilidad quede bien.

## 4. Enviar una factura por correo

Con el botón **✉️** de un ticket puedes enviar la factura en PDF al correo del cliente.

@fig img/tickets-enviar-factura.png | crop=720,336,480,345 | width=66 | marks=1:728,433;2:728,466;3:728,500;4:1114,636 | Ventana «Enviar factura».

1. **Cliente.** Se muestra el nombre del cliente de la venta.
2. **Correo.** Escribe la dirección del cliente. El TPV recuerda las últimas direcciones que has usado para ponértelas a mano la próxima vez.
3. **Mensaje.** Viene escrito («Adjuntamos su factura número…»); puedes cambiarlo.
4. **Enviar.** Genera la factura en PDF y la envía. Verás el aviso «Factura enviada».

La factura sale desde la cuenta de correo de tu empresa, con el nombre de la empresa como remitente. Si en FacturaScripts tienes configuradas copias o una dirección de respuesta, se respetan.

### Si el correo no está configurado
La primera vez, el TPV te avisará de que el correo de la empresa no está configurado:
- Si eres **administrador**, te ofrece **Configurar ahora**.
- Si no, te pide que lo haga un administrador. Además, el botón ✉️ aparece atenuado mientras no esté configurado.

## 5. Configurar el correo de facturas

También se hace desde **Opciones → Impresora → Correo de facturas** (solo administradores).

@fig img/tickets-correo-config.png | crop=700,59,520,899 | marks=1:712,197;2:712,260;3:712,321;4:712,389;5:712,462;6:724,640;7:712,805;8:880,914;9:1041,914 | Ventana «Configurar correo de facturas».

1. **Proveedor.** Elige Gmail, Outlook/Hotmail, IONOS u «Otro / lo escribo yo». Con los tres primeros, el servidor, el puerto y el cifrado se rellenan solos.
2. **Email (remitente).** La dirección desde la que se enviarán las facturas.
3. **Contraseña de aplicación.** Con Gmail y Outlook hay que usar una **contraseña de aplicación**, no la contraseña habitual de la cuenta. Si ya hay una guardada, el campo lo indica y solo hay que escribir otra si quieres cambiarla. El ojo 👁 permite ver lo que escribes.
4. **Aviso importante.** Recuerda que no es la contraseña de tu cuenta.
5. **¿Cómo creo la contraseña de aplicación?** Se despliega con los pasos.
6. **Código QR y botón Copiar dirección.** Escanea el código con tu móvil para abrir directamente la página de contraseñas de aplicación de Google, o copia la dirección.
7. **Servidor, puerto y cifrado.** Solo hay que tocarlos si usas un proveedor distinto.
8. **Comprobar conexión.** Prueba que los datos funcionan **sin enviar ningún correo**.
9. **Guardar y comprobar.** Guarda los datos y los prueba.

### Crear una contraseña de aplicación de Gmail
1. Entra en tu cuenta de Google (la del correo que has escrito arriba).
2. Activa la **verificación en dos pasos** si todavía no la tienes (Seguridad → Verificación en dos pasos).
3. Abre **Contraseñas de aplicaciones** con la dirección que muestra el TPV (o escanea el QR), o búscala en el buscador de tu cuenta.
4. Ponle un nombre, por ejemplo «TPV», y pulsa **Crear**.
5. Copia las 16 letras que te muestra Google y pégalas en el TPV, en **Contraseña de aplicación**. Puedes pegarlas con o sin espacios.

> **Consejo:** si al comprobar la conexión da error, revisa que has escrito la contraseña de aplicación (16 letras) y no la de tu cuenta.
