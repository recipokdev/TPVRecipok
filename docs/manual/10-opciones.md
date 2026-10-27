# Opciones

Desde **Opciones** (el engranaje ⚙ de la cabecera del carrito) se adapta el TPV a cómo trabaja tu negocio. Este capítulo recorre todas las secciones y explica qué hace cada ajuste. Úsalo como guía de consulta: no hace falta leerlo entero.

## 1. Cómo funciona la ventana de Opciones

@fig img/opciones-ventana.png | crop=600,60,720,900 | marks=1:874,97;2:1060,97;3:949,157;4:630,247;5:700,277;6:735,386;7:700,925;8:1235,925 | Ventana de Opciones.

1. **Tutoriales.** Abre los tutoriales interactivos del TPV.
2. **P1 y P2.** Cambian entre modo día y modo noche en la pantalla 1 (la del cajero) y en la pantalla 2 (la del cliente).
3. **Buscador.** Escribe lo que buscas («stock», «impresora», «cajón»…) y verás solo las opciones relacionadas.
4. **Secciones.** Las opciones están agrupadas en *Venta*, *Cobro y caja*, *Equipo y pantalla* y *Programa*. Pulsa el título de una sección para desplegarla.
5. **Resumen de cada sección.** Los botones bajo el título muestran el estado actual de los ajustes (✓ verde = activado) y puedes pulsarlos para ir directamente a ese ajuste.
6. **ADMIN.** Las secciones con esta marca solo las ve un usuario administrador.
7. **Actualizar Programa** y **Salir del Programa**, abajo.
8. **Cerrar Opciones.**

> **Importante:** muchas opciones se guardan solo en **este** terminal. Si tienes varios TPV, configura cada uno.

## 2. Venta

### Carrito
- **Desagrupar líneas.** Activado: cada toque sobre un producto crea una línea nueva, aunque sea el mismo producto. Desactivado: las unidades se suman en una sola línea.
- **Descuentos manuales en carrito.** Permite aplicar descuento a una línea o a todo el carrito (el de línea tiene prioridad sobre el general).
- **Imprimir ticket automáticamente al guardar/aparcar.** Al aparcar o actualizar un pedido (Mesas o TPV normal), el ticket se imprime al instante.
- **Alargar carrito.** Muestra un asa junto al carrito para arrastrar y hacerlo más ancho.
- **Cliente por defecto del terminal.** El cliente que se usa en las ventas si no eliges otro. Se guarda en FacturaScripts para este TPV.
- **Cliente al salir de un aparcado.** Al terminar de aparcar o cobrar un ticket que tenía un cliente distinto, indica a qué cliente vuelve el selector.
- **Accesos rápidos de descuento (%).** Botones de porcentaje en el teclado de descuento (de una línea o del carrito entero). Deja un campo en blanco para no mostrar ese botón; máximo 5.

### Productos (solo administradores)
- **Texto en la tarjeta de producto.** Qué se muestra en cada producto: la descripción, la referencia, o ambas.
- **Modo edición de precio y prioridad.** Muestra el icono ✎ en los productos para cambiar su precio (con IVA) y su prioridad.
- **Añadidos de producto.** Activa los añadidos (por ejemplo «+leche» o «+azúcar») en cada producto, tanto en Modo Mesas como en el TPV normal.
- **Familias primero.** En vez de ver todos los productos de golpe, la pantalla muestra solo botones grandes de familia; al elegir una se ven sus productos, con un botón para volver. Pensado para catálogos grandes. Apagado por defecto.
- **Mostrar stock en productos.** Muestra u oculta el número de stock en la esquina inferior izquierda de cada tarjeta.
- **Solo productos con stock.** Oculta los productos sin stock disponible.
- **Incluir sin control de stock.** Muestra también los productos que no llevan control de stock.
- **Permitir editar stock.** Muestra un botón ✎ junto al stock para modificarlo desde el TPV (solo administradores).
- **Aviso de stock al aparcar.** Avisa si la cantidad a aparcar supera el stock. Desactívalo si no trabajas con stock.
- **Preguntar por el stock al «Borrar pendientes».** Al borrar aparcados sin cobrar, pregunta si son pedidos reales (se devuelve el stock) o duplicados (no se toca). Si lo desactivas, siempre se trata como pedido real.
- **Producto «medio/cuarto» de otro (stock derivado).** Para que el stock de un producto se calcule a partir de otro, por ejemplo «Medio pollo» a partir de «Pollo asado».
- **Orden de productos** y **Reordenar por arrastre.** Elige cómo se ordenan las tarjetas y permite cambiar el orden arrastrando.
- **Restablecer prioridades.** Elimina las prioridades manuales y vuelve al orden base.
- **Modo redimensionar productos.** Muestra asas sobre cada tarjeta para cambiar su tamaño y el tamaño de letra del nombre («Aa»). Afecta a todos los productos. **Restablecer tamaño de productos** y **Restablecer tamaño de letra** devuelven los valores recomendados.
- **Alérgenos.** Marca qué productos llevan cada uno de los 14 alérgenos oficiales de la UE (o alguno propio). Se destaca en la tarjeta, en el carrito y en la comanda impresa.

### Tarifas
- **Tarifa activa en TPV.** Selecciona la tarifa para editarla o asignarla.
- **Crear nueva tarifa**, **Editar tarifa seleccionada** y **Guardar cambios.** Para crear y modificar tarifas (por ejemplo, un porcentaje de descuento) y marcar qué clientes la usan.
- **Restricciones de tarifa** (por ejemplo, *No vender bajo coste* o *No vender sobre PVP*).
- **Clientes con esta tarifa.** Marca los clientes que deben usarla.

### Modo Mesas (solo administradores)
- **Enviar comanda automáticamente al guardar.** Al guardar el pedido de una mesa, la comanda se envía sola a cocina.
- **Espera antes de enviar la comanda.** Con la comanda automática, los segundos que pasan desde el último cambio hasta que se envía.
- **Comanda agrupada por familias.** En el papel de cocina, cada familia aparece una sola vez con sus productos debajo.
- **Comanda compacta.** Ahorra papel: mesa, agente, fecha y hora en una sola línea, sin cabecera de columnas y sin el apartado de observaciones cuando está vacío.
- **Familias para comandas.** Solo estas familias se incluyen al imprimir la comanda de cocina.
- **Familias por comensales.** Los productos de estas familias usan automáticamente el número de comensales de la mesa como cantidad.
- **Vincular tablet de camarero.** Genera un código de un solo uso para introducir en la app de camareros. Una vez introducido, esa tablet queda emparejada de forma permanente con tu negocio. El código caduca a los 10 minutos si no se usa.
- **Tablets emparejadas.** Lista de dispositivos con acceso a tu negocio. Revoca uno si se pierde o se vende: necesitará un código nuevo para volver a emparejarse.

## 3. Cobro y caja

### Caja
- **Abrir cajón con todos los pagos.** Si lo desactivas, el cajón solo se abre con pagos en efectivo.
- **Abrir cajón manualmente.** Abre el cajón con la impresora seleccionada.

### Cierre de caja (solo administradores)
- **Permitir cerrar con aparcados.** Si hay pedidos aparcados, permite cerrar la caja mostrando una confirmación. Los pedidos se conservan.
- **Cierre de caja: mostrar registro de avisos.** Al cerrar, imprime también un listado de eventos (aperturas de cajón, productos quitados…). Desactívalo si solo quieres el resumen de ventas.
- **Incluir aperturas de cajón.** Dentro de ese registro, oculta solo las líneas de «abrió cajón» (suelen ser las más numerosas).

### Impresora
- **Impresora de tickets.** Elige y prueba la impresora de tickets; se guarda para las próximas impresiones.
- **Imprimir automáticamente al cobrar.** Imprime el ticket nada más cobrar.
- **Impresora de comandas.** Impresora que se usa solo para las comandas de cocina.
- **Correo de facturas.** Cuenta de correo desde la que se envían las facturas a los clientes (solo administradores). Consulta el capítulo «Tickets, devoluciones y facturas».

### Báscula
Para productos que se venden por peso.
- **Activar báscula.** Si la báscula marca un peso mayor que 0, al añadir un producto se usa ese valor como cantidad.
- **Puerto.** El puerto al que está conectada. Con adaptadores USB-serie, comprueba que sea el COM correcto y que ningún otro programa lo tenga abierto.
- **Cobrar en.** Unidad en la que se añade al carrito (por ejemplo, si lees 0,170 kg y cobras en gramos, se añade 170).
- **Modo de uso.** *Continuo* es más rápido; *Consumo único* evita reutilizar el mismo peso.
- **Decimales al cobrar.** Redondea la cantidad final.
- **Estado** y **Lectura actual.** Para comprobar que la báscula responde.
- **Opciones avanzadas.** Velocidad, bits de datos, paridad, bits de parada, modo de lectura, delimitador, unidad de origen, inversión de lectura y espera entre bytes. Normalmente no hace falta tocarlas: cámbialas solo si tu báscula concreta no responde. El botón **Reconectar** fuerza una nueva conexión.

## 4. Equipo y pantalla

### Pantalla (solo administradores)
- **Modo TPV (kiosk).** El programa ocupa toda la pantalla. Si lo desactivas, puedes minimizarlo y usar el equipo como un ordenador normal.
- **Escala de la interfaz.** «Automático» ajusta letra, iconos y botones según la resolución para que quepa todo, incluso en pantallas pequeñas. Cámbialo solo si en ese equipo el automático no acierta.
- **Teclado en pantalla.** Desactívalo si el TPV tiene teclado físico: al tocar un campo de texto no se abrirá el teclado táctil.
- **Pantalla cliente (2.ª pantalla).** Actívala solo si el equipo tiene una pantalla secundaria; en **Pantalla a usar** eliges cuál.

### Barra de información (solo administradores)
Controla qué se ve en la barra inferior: **Mostrar barra completa**, **terminal**, **agente**, **usuario** y **caja**. Las **Acciones alternativas** permiten cambiar de sesión aunque hayas ocultado esos botones.

### Terminales (solo administradores)
- **Familias: visibilidad, color e icono.** Qué familias se ven en cada terminal y el color y el icono de cada una. En **Terminal / tablet** eliges qué terminal o tablet de camarero configuras; **Mostrar todos los productos** hace que ese terminal enseñe todo aunque haya familias desmarcadas.
- **Modo redimensionar familias** y **Restablecer tamaño de familias.** Igual que con los productos, para ajustar el tamaño de letra de los botones de familia.
- **PIN de administrador por agente.** Desactivado, cualquier agente puede ver las Opciones de administrador con un usuario administrador. Si lo activas, además se pide el PIN al elegir un agente marcado como administrador: más seguro, pero un paso más al cambiar de agente.
- **Cambiar de empresa.** Quita la empresa, el usuario, el terminal y la caja guardados en **este** TPV y vuelve a pedir el email de la empresa.

### Inicio (solo administradores)
- **Iniciar TPV al encender el PC.** Recomendado solo en equipos dedicados a TPV.

## 5. Programa

### Actualización automática
- **Mostrar avisos de actualización.** Comprueba en segundo plano si hay una versión nueva.
- **Frecuencia de comprobación.** Cada cuánto se comprueba. **Comprobar ahora** lo hace en el momento.
- **Changelog.** Consulta las novedades de cada versión.
- **Actualizar Programa.** Instala la versión nueva cuando está disponible.

### Para pruebas
- **Entorno de pruebas.** Simula cobros, aparcados e impresión sin enviar datos reales. Al salir, se restaura el estado anterior. Úsalo para practicar sin riesgo.
- **Preview de ticket (solo pruebas).** Al cobrar o reimprimir, muestra el ticket en una ventana en lugar de imprimirlo.
