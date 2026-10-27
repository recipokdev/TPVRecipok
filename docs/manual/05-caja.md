# Caja

La caja es el registro del dinero de cada jornada: lo que hay al empezar, lo que se cobra, lo que entra o sale y lo que queda al terminar. Para vender, la caja tiene que estar abierta. Este capítulo explica cómo abrirla, registrar movimientos y cerrarla.

## 1. Dónde está la caja

@fig img/caja-cabecera.png | crop=1410,0,500,110 | marks=1:1745,60;2:1845,60 | Cabecera del carrito.

1. **Abrir / Cerrar caja.** El botón cambia según el estado: pone *Abrir caja* cuando está cerrada y *Cerrar caja* seguido del número de caja cuando está abierta.
2. **Mov.** Para registrar entradas y salidas de dinero (explicado más abajo). Solo está disponible con la caja abierta.

## 2. Abrir la caja

Pulsa **Abrir caja**. Se abre la ventana de apertura.

@fig img/caja-apertura.png | crop=456,180,1008,660 | marks=1:459,262;2:459,566;3:459,676;4:459,772;5:1359,794 | Ventana de apertura de caja.

1. **Billetes y monedas.** Cuenta el dinero que dejas en la caja: escribe la cantidad de cada billete o moneda, o usa los botones **+** y **−**.
2. **Importe directo.** Si no quieres contar pieza a pieza, escribe aquí el total.
3. **Observaciones.** Una nota opcional sobre la apertura.
4. **Dinero asignado.** Suma de lo que has contado: es el dinero inicial con el que empieza la caja.
5. **Abrir caja.** Confirma la apertura. Con **Cancelar** sales sin abrir nada.

> **Importante:** la caja se abre para el terminal que aparece en la parte superior de la ventana («Terminal: …»).

## 3. Registrar entradas y salidas de dinero

Si metes o sacas dinero de la caja sin que sea una venta (por ejemplo, para dejar cambio, ingresar en el banco o pagar a un proveedor), regístralo con **Mov.**: así el cierre de caja cuadra.

@fig img/caja-movimiento.png | crop=720,335,480,347 | width=66 | marks=1:723,404;2:723,472;3:723,526;4:1101,640 | Ventana «Nuevo movimiento de caja».

1. **Cantidad.** Importe en euros.
2. **Tipo.** *Entrada de dinero* (el dinero entra en la caja) o *Salida de dinero* (sale de la caja).
3. **Motivo.** Explica para qué es, por ejemplo «cambio inicial», «ingreso en banco» o «pago proveedor». Así luego se sabe qué pasó.
4. **Guardar.** Registra el movimiento.

## 4. Cerrar la caja

Cuando termines la jornada, pulsa **Cerrar caja**. Se abre la ventana de cierre.

@fig img/caja-cierre.png | crop=456,59,1008,900 | marks=1:459,143;2:459,436;3:459,555;4:459,610;5:459,698;6:459,826;7:884,914;8:1350,914 | Ventana de cierre de caja. Los importes son de ejemplo.

1. **Conteo.** Cuenta el dinero que hay en la caja al terminar, igual que en la apertura.
2. **Observaciones.** Una nota opcional sobre el cierre.
3. **Resumen del efectivo.** *Dinero inicial*, *Cobros en efectivo* y *Total movimientos* forman el **Total esperado en caja**: lo que debería haber. *Conteo caja* es lo que has contado y *Diferencia* es la resta entre las dos cantidades. Si es cero, la caja cuadra.
4. **Total ventas.** Importe vendido en la jornada con todas las formas de pago.
5. **Tickets y pagos.** Número de tickets y de pagos, con el importe de cada forma de pago.
6. **Ventas por agente.** Cuánto ha vendido cada agente.
7. **Imprimir informe.** Imprime el resumen **sin cerrar la caja**: útil para hacer un control a mitad de jornada. Queda anotado en el registro de la caja.
8. **Cerrar caja.** Cierra la jornada. **Cancelar** vuelve a la venta.

### Si hay pedidos aparcados
Si al cerrar la caja quedan pedidos aparcados, el TPV te lo avisa:
- Normalmente tienes que recuperarlos o eliminarlos antes de cerrar.
- Si tu administrador ha activado **Permitir cerrar con aparcados** (**Opciones → Cierre de Caja**, solo administradores), puedes cerrar igualmente: los pedidos se conservan y podrás recuperarlos después.

## 5. Consejos

- Haz siempre el conteo de apertura y de cierre: es lo que permite detectar descuadres.
- Anota **cada** entrada y salida de dinero con **Mov.**: si no, aparecerá como diferencia en el cierre.
- Si quieres comprobar cómo va la caja a media jornada, usa **Imprimir informe** en la ventana de cierre y cancela sin cerrar.
