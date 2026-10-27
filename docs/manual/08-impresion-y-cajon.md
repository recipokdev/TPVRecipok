# Impresión, comandas y cajón

Este capítulo explica cómo configurar las impresoras, qué información lleva el ticket y la comanda de cocina, y cómo funciona el cajón portamonedas.

## 1. Elegir las impresoras

Entra en **Opciones → Impresora**.

- **Impresora de tickets.** Muestra la impresora actual y permite **cambiarla y probarla**. Se guarda para las próximas impresiones.
- **Imprimir automáticamente al cobrar.** Si está activado, el ticket sale nada más confirmar el cobro. Si lo desactivas, no se imprime solo.
- **Impresora de comandas.** Impresora que se usa **solo** para las comandas de cocina. Si todavía no has elegido una, el TPV te abre directamente el selector al enviar la primera comanda.
- **Correo de facturas.** Para enviar facturas por email (ver el capítulo «Tickets, devoluciones y facturas»).

Si intentas imprimir un ticket y todavía no hay impresora elegida, el TPV abre esta ventana:

@fig img/impresion-seleccionar.png | crop=780,397,360,223 | width=62 | marks=1:790,546;2:1040,578 | Ventana «Seleccionar impresora».

1. **Lista de impresoras.** Aparecen las impresoras instaladas en el equipo. Elige la de tickets.
2. **Guardar.** Se recordará para las próximas impresiones. **Cancelar** cierra la ventana sin imprimir.

> **Consejo:** usa siempre el botón de **probar** después de cambiar de impresora, para comprobar que sale bien.

## 2. El ticket

El ticket es el comprobante de la venta que se entrega al cliente.

@fig img/impresion-ticket.png | crop=0,0,300,500 | width=42 | marks=1:288,22;2:288,130;3:288,215;4:288,345;5:288,390;6:288,437 | Ejemplo de ticket. Los datos son de ejemplo.

1. **Datos de la empresa.** Nombre, dirección, CIF y teléfono. Si tu empresa tiene logo, también aparece arriba.
2. **Número de factura, fecha y cliente.**
3. **Líneas.** Cantidad, descripción y total de cada producto.
4. **Desglose de impuestos.** Base imponible e IVA de cada tipo.
5. **Total y formas de pago.** Si se paga en efectivo, también se muestran la cantidad entregada y el cambio.
6. **Terminal y agente** que hicieron la venta.

El ticket se puede volver a imprimir en cualquier momento desde **Tickets** (botón 🖨).

## 3. La comanda de cocina

La comanda es el papel que se imprime en la cocina o en la barra con lo que hay que preparar. Se usa en el **Modo Mesas** (capítulo «Modo Mesas»).

@fig img/impresion-comanda.png | crop=0,0,380,290 | width=48 | marks=1:330,45;2:330,97;3:330,190;4:330,262 | Ejemplo de comanda. Los datos son de ejemplo.

1. **Mesa.** El nombre de la mesa en grande, para que se vea de un vistazo.
2. **Mesa, agente, fecha y hora.**
3. **Productos** con su cantidad.
4. **Observaciones** que se hayan escrito para cocina.

Si algún producto lleva **alérgenos** marcados, se destacan en la comanda impresa.

### Ajustes de la comanda
En **Opciones → Modo Mesas** (administradores):
- **Familias para comandas.** Solo las familias seleccionadas se imprimen en la comanda (por ejemplo, la cocina no necesita ver las bebidas).
- **Comanda agrupada por familias.** Cada familia aparece una sola vez con sus productos debajo.
- **Comanda compacta.** Ahorra papel: mesa, agente, fecha y hora en una sola línea, sin cabecera de columnas y sin el apartado de observaciones cuando está vacío.
- **Enviar comanda automáticamente al guardar** y **Espera antes de enviar la comanda.** Ver el capítulo «Modo Mesas».

### Imprimir el ticket al aparcar
Si activas **Imprimir ticket automáticamente al guardar/aparcar** (**Opciones → Carrito**), al aparcar un pedido (en Mesas o en el TPV normal) se imprime el ticket al instante. No sustituye a la comanda de cocina.

## 4. El cajón portamonedas

El cajón se conecta a la impresora de tickets y se abre con una señal que esta envía.

- **Al cobrar.** Por defecto el cajón se abre en todos los pagos. Si prefieres que solo se abra con efectivo, desactiva **Abrir cajón con todos los pagos** (**Opciones → Caja**).
- **Manualmente.** Hay tres sitios: el botón **📤 Abrir cajón** de la barra junto al buscador de productos, el botón **Abrir cajón** de la ventana de cobro y **Abrir cajón manualmente** en **Opciones → Caja**.

> **Consejo:** las aperturas del cajón pueden aparecer en el registro de avisos que se imprime al cerrar la caja. Si prefieres no verlas, desactiva **Incluir aperturas de cajón** en **Opciones → Cierre de Caja**.

## 5. Informe de cierre de caja

Al cerrar la caja se imprime el informe de la jornada con el resumen de ventas, los pagos por forma de pago y las ventas por agente. También puedes sacarlo a mitad de jornada sin cerrar la caja con **Imprimir informe** (ver el capítulo «Caja»).

## 6. Báscula

Si vendes productos por peso, puedes conectar una báscula. Se configura en **Opciones → Báscula**: actívala, elige el puerto, la unidad en la que se cobra y los decimales. Con la báscula activa, al tocar un producto se usa el peso que marca como cantidad. Consulta los ajustes en el capítulo «Opciones».

## 7. Pantalla del cliente

Si el equipo tiene una segunda pantalla, el TPV puede mostrar al cliente su pedido mientras se vende. Se activa en **Opciones → Pantalla → Pantalla cliente (2.ª pantalla)** y en **Pantalla a usar** eliges cuál. Con el botón **P2** de la ventana de Opciones cambias esa pantalla entre modo día y modo noche.
