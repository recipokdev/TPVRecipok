# Productos, stock y alérgenos

Este capítulo explica cómo organizar lo que se ve en la pantalla de venta (familias, tamaño y orden de los productos), cómo trabajar con el stock y cómo marcar los alérgenos. Casi todos estos ajustes están en **Opciones → Productos** y solo los ve un administrador.

> Los productos, sus precios, impuestos y familias se crean y mantienen en **FacturaScripts**. El TPV los carga y los muestra.

## 1. Familias y productos en pantalla

Los productos aparecen en botones agrupados por **familias**. Pulsa una familia para ver sus productos.

### Familias primero
Si tu catálogo es grande, activa **Familias primero** (**Opciones → Productos**). En lugar de ver todos los productos de golpe, la pantalla muestra solo botones grandes de familia; al elegir una, se ven sus productos y aparece un botón para volver a las familias.

@fig img/productos-familias-primero.png | crop=0,40,1400,260 | marks=1:30,70;2:380,70 | Modo «Familias primero».

1. **Todos los productos.** Permite ver el catálogo completo sin elegir familia.
2. **Familias.** Un toque abre esa familia.

### Qué familias se ven
En **Opciones → Terminales** puedes elegir qué familias se ven en cada terminal (y su color e icono). Con **Mostrar todos los productos** un terminal enseña todo aunque haya familias desmarcadas.

### Tamaño de los botones
- **Modo redimensionar productos** muestra dos asas sobre cada tarjeta: una (abajo a la derecha) cambia el tamaño de la tarjeta y otra («Aa», abajo a la izquierda) cambia el tamaño de letra del nombre. El cambio se ve al momento y afecta a todos los productos.
- **Restablecer tamaño de productos** y **Restablecer tamaño de letra** devuelven los valores recomendados.
- Lo mismo se puede hacer con los botones de familia con **Modo redimensionar familias**.

### Orden de los productos
- **Orden de productos** permite elegir cómo se ordenan las tarjetas.
- **Reordenar por arrastre** permite cambiar el orden a mano, arrastrando con el dedo o el ratón.
- **Restablecer prioridades** elimina el orden manual y vuelve al orden base.

### Qué texto muestra cada tarjeta
En **Texto en la tarjeta de producto** eliges si se muestra la descripción del producto, la referencia, o ambas.

## 2. Precios

Con **Modo edición de precio y prioridad** activado aparece un icono ✎ en cada producto. Pulsándolo se abre la ventana **Editar precio**, que muestra el precio actual (IVA incluido) y permite escribir uno nuevo; también puedes cambiar la prioridad del producto (su posición en la pantalla). Si tu empresa trabaja con precios distintos por almacén, la propia ventana te lo indica.

> **Consejo:** activa este modo solo cuando vayas a cambiar precios, para no tocarlos sin querer durante el servicio.

## 3. Stock

@fig img/productos-stock.png | crop=0,40,950,230 | marks=1:28,222;2:140,222 | Productos con el stock visible.

1. **Stock.** El número en la esquina inferior izquierda de cada producto.
2. **Precio.** En la esquina inferior derecha.

Ajustes disponibles en **Opciones → Productos**:
- **Mostrar stock en productos.** Muestra u oculta ese número.
- **Solo productos con stock.** Oculta los productos con stock 0 o sin stock disponible.
- **Incluir sin control de stock.** Muestra también los productos que no llevan control de stock en FacturaScripts.
- **Permitir editar stock.** Muestra un botón ✎ junto al stock para corregirlo desde el TPV (solo administradores).
- **Aviso de stock al aparcar.** Avisa si la cantidad a aparcar supera el stock. Desactívalo si no trabajas con stock.
- **Preguntar por el stock al «Borrar pendientes».** Al borrar pedidos aparcados, pregunta si eran pedidos reales (se devuelve su stock) o duplicados (no se toca).

### Productos «medio» o «cuarto» de otro (stock derivado)
Hay productos que se venden por fracciones de otro, por ejemplo «Medio pollo» a partir de «Pollo asado». Con **Producto «medio/cuarto» de otro** puedes configurar que el stock de la fracción se calcule automáticamente a partir del producto entero, en lugar de llevar su propio contador. El asistente hace todo lo necesario en FacturaScripts por ti.

## 4. Añadidos de producto

Los **añadidos** son extras que se pueden sumar a un producto al venderlo (por ejemplo «+leche» o «+azúcar» en un café). Se activan con **Añadidos de producto** (**Opciones → Productos**); entonces cada producto tiene un botón para gestionar sus añadidos y, al venderlo, aparece el selector. Funcionan tanto en Modo Mesas como en el TPV normal. Un añadido puede tener precio o ser gratuito: si lo tiene, se cobra como una línea más en la factura.

## 5. Alérgenos

Con **Alérgenos** marcas qué productos llevan cada uno de los 14 alérgenos oficiales de la UE (o alguno propio que añadas). El alérgeno se destaca en la tarjeta del producto, en el carrito y en la comanda impresa para cocina.

@fig img/productos-alergenos.png | crop=600,92,720,420 | marks=1:606,171;2:612,200;3:1240,205 | Lista de alérgenos.

1. **Indicación.** Los 14 alérgenos oficiales ya están creados.
2. **Alérgeno.** Cada uno indica cuántos productos lo llevan. Púlsalo para marcar qué productos lo contienen.
3. **Lápiz.** Cambia el nombre del alérgeno.

Al pulsar un alérgeno se abre la lista de productos:

@fig img/productos-alergeno-productos.png | crop=600,92,720,420 | marks=1:616,170;2:1010,182;3:1214,212 | Productos de un alérgeno.

1. **Todos los alérgenos.** Vuelve a la lista de alérgenos.
2. **Buscador.** Para encontrar un producto concreto.
3. **+ Añadir.** Marca el producto como portador de ese alérgeno.

> **Importante:** revisa con atención qué productos marcas. El aviso en pantalla y en la comanda depende de esta información.

## 6. Descuentos y tarifas

- **Descuentos manuales en carrito** (**Opciones → Carrito**) permite aplicar un descuento a una línea o a todo el carrito. En **Accesos rápidos de descuento (%)** defines hasta 5 porcentajes de un solo toque.
- **Tarifas** (**Opciones → Tarifas**) permiten tener precios o descuentos distintos según el cliente: creas la tarifa, eliges los clientes que la usan y puedes impedir vender por debajo del coste o por encima del PVP.
