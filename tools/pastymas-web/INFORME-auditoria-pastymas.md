# Auditoría de pastymas.es – Carrito, Finalizar compra y traducciones

Fecha: 30/09/2026. Auditoría realizada sobre la web pública (sin acceso al panel de WordPress), con un carrito real de prueba.

## Lo que hay instalado (detectado desde el frontal)

| Componente | Versión / detalle |
|---|---|
| WordPress | 6.9.9, idioma `es-ES`, PHP 8.2 |
| WooCommerce | 10.5.3 (Wholesale Prices 2.2.9, Stripe, Packlink, TM Extra Product Options, Bulk Discount…) |
| Tema | Hello Elementor + Elementor 4.3.2 + Elementor Pro |
| Páginas | Carrito = página 25267 (widget **Cart** de Elementor Pro). Finalizar compra = página 25268 (widget **Checkout** de Elementor Pro) |
| Mini-cesta lateral | WPC Fly Cart (`woo-fly-cart`) |
| Colores globales | Primario/texto `#403625`, Acento y Secundario `#D64290` (el fucsia), fondo `#F9FAFD`, borde `#C8D5DC` |

## Causa raíz de cada problema

### 3) Textos en inglés por toda la web
- En el servidor **no existe el paquete de idioma español de Elementor ni de Elementor Pro**:
  `wp-content/languages/plugins/elementor-es_ES.mo` → 404, `elementor-pro-es_ES.mo` → 404. En cambio `woocommerce-es_ES.mo` y el del tema sí existen.
- Por eso todo lo que pintan los widgets de Elementor Pro sale en inglés: "Update Cart", "Apply coupon", "Coupon code", "Cart Total", "Proceed to Checkout", "Returning customer?", "Click here to login", "Billing Details", "Your Order", "Have a coupon?", "Create an account?", "Ship to a different address?", "I have read and agree to the website terms and conditions"…
- Además el widget Checkout de Elementor Pro **sustituye las etiquetas de los campos** por "First Name", "Last Name", "Company Name", "Email Address", "Phone" (por eso unas etiquetas están en español y otras en inglés en el mismo formulario).
- Otros textos en inglés tienen otro origen:
  - "Check Out" (título de la página de finalizar compra) es un **widget Encabezado** con ese texto escrito a mano.
  - "Shopping cart" y "Share cart" son de la mini-cesta **WPC Fly Cart** (se cambian en sus ajustes).
  - "© All Rights Reserved." está escrito a mano en la plantilla de pie de página (25262).
  - "Unit Price", "Options Amount", "Item Total" vienen del plugin TM Extra Product Options.
  - "Envio 1" (sin tilde) es el nombre del método de envío en WooCommerce > Envío > Zonas.
  - "Añadir a la cesta" en la ficha de producto frente a "Añadir al carrito" en la tienda: dos traducciones distintas de WooCommerce para el mismo botón.

### 2) Carrito: textos ocultos sobre el fucsia
- El widget Cart tiene la sección de la tabla (`.e-shop-table`) y la del cupón con **fondo = color Secundario (#D64290)** y, a la vez, los **enlaces = color Acento (#D64290)**: el nombre del producto, "Editar opciones" y el botón "Update Cart" son fucsia sobre fucsia y desaparecen (en móvil el nombre del producto no se ve en absoluto).
- Los importes de los totales usan una tipografía global con `letter-spacing: 10px` ("1 3 9 , 2 0 €") y los botones una tipografía con `text-transform: capitalize` ("Proceed To Checkout").
- En móvil el botón flotante de la mini-cesta tapa el título "Cart Total".

### 1) Finalizar compra: fucsia, formularios grandes, desorden
- El bloque "Your Order" tiene fondo Secundario (#D64290) con texto marrón oscuro: legible pero muy llamativo.
- Campos con padding grande y separación de 14 px, etiquetas a 16 px: el formulario ocupa el doble de lo necesario.
- **"Ship to a different address?" aparece marcado por defecto**, así que siempre se muestran dos formularios completos (facturación + envío). Esto es lo que más desordena la página. Se corrige en WooCommerce > Ajustes > Envío > *Destino de envío* → "Por defecto a la dirección de facturación del cliente".
- El campo NIF/CIF y los de email/teléfono de envío son más estrechos que el resto (les falta la clase `form-row-wide`).
- La columna de facturación tiene un margen derecho del 18 % y la de envío no, por lo que tienen anchos distintos.
- El texto legal "Tus Datos Personales Se Utilizarán…" sale en cursiva y con cada palabra en mayúscula por la tipografía global.

### Otros hallazgos (fuera de lo pedido, pero importantes)
- **El producto 12137 "Caja para panettone Sfere Bianco" da error crítico (HTTP 500) al añadirlo al carrito** por cualquier vía (enlace `?add-to-cart=12137`, AJAX y Store API). Los demás productos probados funcionan. Hay que revisar ese producto (probablemente su configuración de opciones extra) y el log de errores de PHP.
- Al añadir con cantidad 6 el milhojas se rechaza con «"Caja de 72 unidades" es un campo necesario» aunque el radio esté marcado; conviene revisarlo con el plugin de opciones extra.
- "cONTACTO" en el pie de página (mayúscula mal puesta).
- Polylang está activo (cookie `pll_language`), pero sólo se sirve español. Si no se usa un segundo idioma, es un plugin de más.

## Qué se entrega

1. `pastymas-carrito-checkout.css` – CSS probado sobre las páginas reales (capturas antes/después adjuntas). Paneles neutros (fondo `#F9FAFD`, borde `#C8D5DC`, esquinas 8 px), texto oscuro siempre legible, fucsia sólo en enlaces y en el botón principal, campos de 40 px de alto y 14 px, etiquetas de 13 px, sin letras espaciadas ni Title Case, columnas Nombre/Apellidos iguales, campo NIF a ancho completo, botón flotante oculto en móvil dentro de carrito/checkout. Incluye, comentada, una **variante que mantiene el fucsia con texto blanco** por si se prefiere.
2. `pastymas-traducciones.php` – plugin/snippet que traduce los textos de Elementor Pro, las etiquetas de campos del checkout, la mini-cesta y las opciones extra, de forma segura (sólo actúa en español y no toca archivos de plugins).
3. Capturas `shot_*_antes.png` y `shot_*_despues.png` (escritorio y móvil).

## Pasos para aplicarlo (orden recomendado)

1. **Instalar los idiomas que faltan (raíz del punto 3).**
   - Escritorio > Actualizaciones > botón "Actualizar traducciones". Comprobar que aparecen `elementor-es_ES.mo` y `elementor-pro-es_ES.mo` en `wp-content/languages/plugins/`.
   - Elementor Pro sólo descarga su idioma si la **licencia está activa** (Elementor > Licencia). Si está caducada, el snippet PHP cubre los textos igualmente.
   - Después: Elementor > Herramientas > Regenerar CSS y datos, y vaciar la caché del servidor (Plesk/nginx).
2. **Activar el snippet** `pastymas-traducciones.php` (como plugin, con Code Snippets o en el functions.php de un tema hijo).
3. **Pegar el CSS** en Elementor > Ajustes del sitio > CSS personalizado (o Apariencia > Personalizar > CSS adicional) y regenerar CSS.
4. **Ajustes sin código:**
   - WooCommerce > Ajustes > Envío > Destino de envío → "Por defecto a la dirección de facturación del cliente" (evita el doble formulario).
   - WooCommerce > Envío > Zonas: renombrar "Envio 1" → "Envío estándar" (o el nombre real).
   - Editar con Elementor la página *Finalizar compra*: cambiar el encabezado "Check Out" → "Finalizar compra". En el widget Checkout, pestaña Contenido, se pueden escribir directamente los títulos de sección ("Datos de facturación", "Tu pedido", "¿Tienes un cupón?", botón "Realizar el pedido"…), igual que en el widget Cart ("Actualizar carrito", "Aplicar cupón", "Totales del carrito", "Finalizar compra").
   - WPClever > Fly Cart > Localización: "Shopping cart" → "Tu cesta", "Share cart" → "Compartir cesta" (o desactivar "compartir").
   - Plantilla de pie de página (Elementor > Plantillas > Pie 25262): "© All Rights Reserved." → "© Pastymas. Todos los derechos reservados." y "cONTACTO" → "Contacto".
   - Elementor > Ajustes del sitio > Tipografía global: en las tipografías "Acento" y "Secundaria" poner *Transformar texto: Ninguno*; en la tipografía con *espaciado 10 px* poner 0. Con esto el CSS de arriba deja de necesitar sus reglas de tipografía, pero no estorban.
5. **Revisar el producto 12137** (error 500 al añadir al carrito) y el log de PHP del hosting.
6. Comprobar el resultado en ambas páginas con un producto en el carrito, en escritorio y móvil, con la sesión de invitado y con un usuario profesional logueado (precios mayoristas).

## Colores propuestos (por si se quiere ajustar en Elementor en lugar de con CSS)

| Elemento | Antes | Propuesto |
|---|---|---|
| Fondo tabla del carrito, cupón y "Tu pedido" | #D64290 | #F9FAFD con borde #C8D5DC |
| Enlaces dentro de esos paneles | #D64290 (invisible sobre fucsia) | #403625, hover #D64290 |
| Botón principal (Finalizar compra / Realizar el pedido) | #D64290, Title Case | #D64290, texto blanco, sin Title Case, hover #B8306F |
| Botones secundarios (Actualizar, Aplicar cupón, Acceder) | Fucsia relleno | Contorno fucsia sobre blanco |
| Importes de totales | 300, espaciado 10 px | 500, espaciado 0 |
