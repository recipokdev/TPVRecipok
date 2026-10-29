<?php
/**
 * Plugin Name: Pastymas – Traducciones y ajustes de tienda
 * Description: Traducciones, estilos de carrito/checkout/producto/móvil, buscador instantáneo, protección antispam del registro y observaciones "Pedido web" en Reciplus.
 * Version:     1.10.0
 * Author:      Pastymas
 *
 * INSTALACIÓN (elige UNA opción):
 *  A) Subir este archivo a wp-content/plugins/pastymas-traducciones/pastymas-traducciones.php y activarlo en Plugins.
 *  B) Pegar todo el contenido (sin la primera línea "<?php") en un snippet PHP del plugin "Code Snippets", ámbito "Ejecutar en todas partes".
 *  C) Pegarlo al final del functions.php de un TEMA HIJO de Hello Elementor (nunca en el tema padre: se pierde al actualizar).
 *
 * IMPORTANTE: esto es un "parche" seguro. La solución de raíz para el punto 3 (textos en inglés en toda la web) es
 * instalar el paquete de idioma es_ES de Elementor y Elementor Pro (ver informe). Aunque se instale, este archivo
 * no molesta: sólo traduce lo que sigue apareciendo en inglés.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Protección antispam del registro de clientes
require_once plugin_dir_path( __FILE__ ) . 'pastymas-antispam.php';
// Observaciones "Pedido web" en los documentos creados por el conector Woo Reciplus
require_once plugin_dir_path( __FILE__ ) . 'pastymas-reciplus.php';

/**
 * 1) Textos de los widgets Carrito y Finalizar compra de Elementor Pro (dominio 'elementor-pro').
 *    Sólo actúa cuando la web se muestra en español.
 */
function pastymas_es_activo() {
	$locale = function_exists( 'determine_locale' ) ? determine_locale() : get_locale();
	return 0 === strpos( $locale, 'es' );
}

add_filter( 'gettext', 'pastymas_traducir_elementor_pro', 20, 3 );
function pastymas_traducir_elementor_pro( $traducido, $original, $dominio ) {
	if ( 'elementor-pro' !== $dominio || ! pastymas_es_activo() ) {
		return $traducido;
	}
	static $mapa = array(
		// Carrito
		'Cart'                                  => 'Carrito',
		'Cart Totals'                           => 'Totales del carrito',
		'Cart Total'                            => 'Total del carrito',
		'Update Cart'                           => 'Actualizar carrito',
		'Update cart'                           => 'Actualizar carrito',
		'Apply coupon'                          => 'Aplicar cupón',
		'Apply Coupon'                          => 'Aplicar cupón',
		'Apply'                                 => 'Aplicar',
		'Coupon code'                           => 'Código de cupón',
		'Proceed to Checkout'                   => 'Finalizar compra',
		'Proceed to checkout'                   => 'Finalizar compra',
		'Remove this item'                      => 'Eliminar este artículo',
		'Your cart is currently empty.'         => 'Tu carrito está vacío.',
		'Return to shop'                        => 'Volver a la tienda',
		'Return To Shop'                        => 'Volver a la tienda',
		// Checkout
		'Check Out'                             => 'Finalizar compra',
		'Checkout'                              => 'Finalizar compra',
		'Returning customer?'                   => '¿Ya eres cliente?',
		'Click here to login'                   => 'Haz clic aquí para acceder',
		'If you have shopped with us before, please enter your details below. If you are a new customer, please proceed to the Billing section.' => 'Si ya has comprado con nosotros, introduce tus datos de acceso. Si eres un cliente nuevo, continúa con los datos de facturación.',
		'Email'                                 => 'Correo electrónico',
		'Password'                              => 'Contraseña',
		'Login'                                 => 'Acceder',
		'Remember me'                           => 'Recordarme',
		'Lost your password?'                   => '¿Has olvidado la contraseña?',
		'Billing Details'                       => 'Datos de facturación',
		'Billing details'                       => 'Datos de facturación',
		'Shipping Details'                      => 'Datos de envío',
		'Shipping details'                      => 'Datos de envío',
		'Additional Information'                => 'Información adicional',
		'Additional information'                => 'Información adicional',
		'Email Address'                         => 'Correo electrónico',
		'First Name'                            => 'Nombre',
		'Last Name'                             => 'Apellidos',
		'Company Name'                          => 'Empresa',
		'Phone'                                 => 'Teléfono',
		'Country / Region'                      => 'País / Región',
		'Street Address'                        => 'Dirección',
		'Street address'                        => 'Dirección',
		'Apartment, suite, unit, etc.'          => 'Piso, puerta, escalera, etc.',
		'Postcode / ZIP'                        => 'Código postal',
		'Town / City'                           => 'Población',
		'State / County'                        => 'Provincia',
		'Create an account?'                    => '¿Crear una cuenta?',
		'Ship to a different address?'          => '¿Enviar a una dirección diferente?',
		'Order notes'                           => 'Notas del pedido',
		'Your Order'                            => 'Tu pedido',
		'Your order'                            => 'Tu pedido',
		'Have a coupon?'                        => '¿Tienes un cupón?',
		'Click here to enter your coupon code'  => 'Haz clic aquí para introducir tu código',
		'If you have a coupon code, please apply it below.' => 'Si tienes un código de cupón, introdúcelo aquí.',
		'Payment'                               => 'Pago',
		'Place Order'                           => 'Realizar el pedido',
		'Place order'                           => 'Realizar el pedido',
		'I have read and agree to the website %s' => 'He leído y acepto los %s de la web',
		'terms and conditions'                  => 'términos y condiciones',
		'Product'                               => 'Producto',
		'Subtotal'                              => 'Subtotal',
		'Total'                                 => 'Total',
		'Shipping'                              => 'Envío',
		'Quantity'                              => 'Cantidad',
		'Price'                                 => 'Precio',
		'Optional'                              => 'Opcional',
		'(optional)'                            => '(opcional)',
		// Mi cuenta (widget My Account de Elementor Pro, por si se usa)
		'Dashboard'                             => 'Escritorio',
		'Orders'                                => 'Pedidos',
		'Downloads'                             => 'Descargas',
		'Addresses'                             => 'Direcciones',
		'Account details'                       => 'Detalles de la cuenta',
		'Logout'                                => 'Cerrar sesión',
	);
	return isset( $mapa[ $original ] ) ? $mapa[ $original ] : $traducido;
}

/**
 * 2) Etiquetas y placeholders de los campos del checkout. El widget de Elementor Pro los sustituye por
 *    "First Name", "Last Name", "Company Name", "Email Address", "Phone" (en inglés y en mayúsculas).
 *    Se ejecuta con prioridad alta para pasar por encima de Elementor.
 */
add_filter( 'woocommerce_checkout_fields', 'pastymas_campos_checkout_es', 9999 );
function pastymas_campos_checkout_es( $fields ) {
	if ( ! pastymas_es_activo() ) {
		return $fields;
	}
	$textos = array(
		'first_name' => array( 'Nombre', 'Nombre' ),
		'last_name'  => array( 'Apellidos', 'Apellidos' ),
		'company'    => array( 'Empresa', 'Nombre de la empresa' ),
		'email'      => array( 'Correo electrónico', 'nombre@ejemplo.com' ),
		'phone'      => array( 'Teléfono', '600 000 000' ),
		'address_1'  => array( 'Dirección', 'Calle y número' ),
		'address_2'  => array( 'Piso, puerta, escalera (opcional)', 'Piso, puerta, escalera (opcional)' ),
		'postcode'   => array( 'Código postal', 'Código postal' ),
		'city'       => array( 'Población', 'Población' ),
		'state'      => array( 'Provincia', 'Provincia' ),
		'country'    => array( 'País', 'País' ),
		'nif'        => array( 'NIF / CIF / NIE', 'Número NIF / CIF / NIE' ),
	);
	foreach ( array( 'billing', 'shipping' ) as $grupo ) {
		if ( empty( $fields[ $grupo ] ) ) {
			continue;
		}
		foreach ( $textos as $campo => $t ) {
			$clave = $grupo . '_' . $campo;
			if ( isset( $fields[ $grupo ][ $clave ] ) ) {
				$fields[ $grupo ][ $clave ]['label']       = $t[0];
				$fields[ $grupo ][ $clave ]['placeholder'] = $t[1];
			}
		}
		// El campo NIF viene sin clase de anchura: lo ponemos a ancho completo.
		if ( isset( $fields[ $grupo ][ $grupo . '_nif' ] ) ) {
			$fields[ $grupo ][ $grupo . '_nif' ]['class'] = array( 'form-row-wide' );
		}
	}
	if ( isset( $fields['order']['order_comments'] ) ) {
		$fields['order']['order_comments']['label']       = 'Notas del pedido';
		$fields['order']['order_comments']['placeholder'] = 'Indicaciones para la entrega, horario, etc.';
	}
	if ( isset( $fields['account']['account_password'] ) ) {
		$fields['account']['account_password']['label']       = 'Contraseña de la cuenta';
		$fields['account']['account_password']['placeholder'] = 'Contraseña';
	}
	return $fields;
}

/**
 * 3) Textos de la mini-cesta lateral (WPC Fly Cart, dominio 'woo-fly-cart').
 *    También se pueden cambiar sin código en WPClever > Fly Cart > Localización.
 */
add_filter( 'gettext', 'pastymas_traducir_fly_cart', 20, 3 );
function pastymas_traducir_fly_cart( $traducido, $original, $dominio ) {
	if ( 'woo-fly-cart' !== $dominio || ! pastymas_es_activo() ) {
		return $traducido;
	}
	static $mapa = array(
		'Shopping cart'                       => 'Tu cesta',
		'Share cart'                          => 'Compartir cesta',
		'Do you want to empty the cart?'      => '¿Quieres vaciar la cesta?',
		'Do you want to remove this item?'    => '¿Quieres eliminar este artículo?',
		'Undo?'                               => '¿Deshacer?',
		'%s was removed'                      => 'Se ha eliminado %s',
		'Continue shopping'                   => 'Seguir comprando',
		'View cart'                           => 'Ver cesta',
		'Checkout'                            => 'Finalizar compra',
		'Empty cart'                          => 'Vaciar cesta',
		'You may be interested in…'           => 'Puede interesarte…',
		'Saved for later'                     => 'Guardado para después',
	);
	return isset( $mapa[ $original ] ) ? $mapa[ $original ] : $traducido;
}

/**
 * 4) Textos sueltos de WooCommerce que quedan en inglés en algunas versiones.
 */
add_filter( 'gettext', 'pastymas_traducir_woocommerce', 20, 3 );
function pastymas_traducir_woocommerce( $traducido, $original, $dominio ) {
	if ( 'woocommerce' !== $dominio || ! pastymas_es_activo() ) {
		return $traducido;
	}
	static $mapa = array(
		'Add to basket'        => 'Añadir al carrito',   // unifica "Añadir a la cesta" / "Añadir al carrito"
		'Add to cart'          => 'Añadir al carrito',
		'View basket'          => 'Ver carrito',
		'Proceed to checkout'  => 'Finalizar compra',
		'Update cart'          => 'Actualizar carrito',
	);
	return isset( $mapa[ $original ] ) ? $mapa[ $original ] : $traducido;
}

/**
 * 5) Textos de las opciones extra de producto (TM Extra Product Options) que aparecen en inglés en el carrito.
 */
add_filter( 'gettext', 'pastymas_traducir_epo', 20, 3 );
function pastymas_traducir_epo( $traducido, $original, $dominio ) {
	if ( 'woocommerce-tm-extra-product-options' !== $dominio || ! pastymas_es_activo() ) {
		return $traducido;
	}
	static $mapa = array(
		'Unit Price'           => 'Precio unitario',
		'Options Amount'       => 'Importe de las opciones',
		'Item Unit Price'      => 'Precio unitario del artículo',
		'Item Options Amount'  => 'Importe de opciones del artículo',
		'Item Total'           => 'Total del artículo',
		'Edit options'         => 'Editar opciones',
	);
	return isset( $mapa[ $original ] ) ? $mapa[ $original ] : $traducido;
}

/**
 * 6) Carga el CSS de carrito/checkout (assets/pastymas-carrito-checkout.css) sólo en esas páginas,
 *    después de los estilos de Elementor. Así no hace falta pegarlo en el editor de Elementor.
 */
add_action( 'wp_enqueue_scripts', 'pastymas_css_carrito_checkout', 999 );
function pastymas_css_carrito_checkout() {
	if ( ! function_exists( 'is_cart' ) || ! ( is_cart() || is_checkout() ) ) {
		return;
	}
	$ruta = plugin_dir_path( __FILE__ ) . 'assets/pastymas-carrito-checkout.css';
	if ( ! file_exists( $ruta ) ) {
		return;
	}
	wp_enqueue_style(
		'pastymas-carrito-checkout',
		plugin_dir_url( __FILE__ ) . 'assets/pastymas-carrito-checkout.css',
		array(),
		(string) filemtime( $ruta )
	);
}

/**
 * 7) Textos escritos a mano en widgets de Elementor (encabezado "Check Out" de la página de finalizar compra
 *    y textos del pie). Se sustituyen al renderizar; si se corrigen en el editor de Elementor, este filtro no hace nada.
 */
add_filter( 'elementor/widget/render_content', 'pastymas_textos_manuales', 10, 2 );
function pastymas_textos_manuales( $content, $widget ) {
	if ( ! pastymas_es_activo() ) {
		return $content;
	}
	static $reemplazos = array(
		// Encabezados y pie escritos a mano
		'>Check Out<'            => '>Finalizar compra<',
		'© All Rights Reserved.' => '© Pastymas. Todos los derechos reservados.',
		'&copy; All Rights Reserved.' => '&copy; Pastymas. Todos los derechos reservados.',
		'>cONTACTO<'             => '>Contacto<',
		// Textos guardados en los ajustes de los widgets Carrito / Finalizar compra de Elementor Pro
		// (no pasan por el sistema de traducción)
		'>Cart Totals<'                          => '>Total del carrito<',
		'>Cart Total<'                           => '>Total del carrito<',
		'>Update Cart<'                          => '>Actualizar carrito<',
		'value="Update Cart"'                    => 'value="Actualizar carrito"',
		'>Apply coupon<'                         => '>Aplicar cupón<',
		'>Apply Coupon<'                         => '>Aplicar cupón<',
		'value="Apply coupon"'                   => 'value="Aplicar cupón"',
		'value="Apply Coupon"'                   => 'value="Aplicar cupón"',
		'placeholder="Coupon code"'              => 'placeholder="Código de cupón"',
		'>Proceed to Checkout<'                  => '>Finalizar compra<',
		'>Proceed to checkout<'                  => '>Finalizar compra<',
		'>Returning customer?<'                  => '>¿Ya eres cliente?<',
		'>Click here to login<'                  => '>Haz clic aquí para acceder<',
		'>Billing Details<'                      => '>Datos de facturación<',
		'>Billing details<'                      => '>Datos de facturación<',
		'>Shipping Details<'                     => '>Datos de envío<',
		'>Shipping details<'                     => '>Datos de envío<',
		'>Additional Information<'               => '>Información adicional<',
		'>Additional information<'               => '>Información adicional<',
		'>Your Order<'                           => '>Tu pedido<',
		'>Your order<'                           => '>Tu pedido<',
		'>Have a coupon?<'                       => '>¿Tienes un cupón?<',
		'>Click here to enter your coupon code<' => '>Haz clic aquí para introducir tu código<',
		'>Payment<'                              => '>Pago<',
		'>Place Order<'                          => '>Realizar el pedido<',
		'value="Place Order"'                    => 'value="Realizar el pedido"',
		'>Apply<'                                => '>Aplicar<',
		'value="Apply"'                          => 'value="Aplicar"',
		'>Login<'                                => '>Acceder<',
		'value="Login"'                          => 'value="Acceder"',
		'>Ship to a different address?<'         => '>¿Enviar a una dirección diferente?<',
		'>Create an account?<'                   => '>¿Crear una cuenta?<',
		'>Remember me<'                          => '>Recordarme<',
		'>Lost your password?<'                  => '>¿Has olvidado la contraseña?<',
		'>Shopping cart<'                        => '>Tu cesta<',
		// Fragmentos con saltos de línea o enlaces dentro (plantillas del widget)
		'Proceed to Checkout</a>'                => 'Finalizar compra</a>',
		'Proceed to checkout</a>'                => 'Finalizar compra</a>',
		'>Update</button>'                       => '>Actualizar</button>',
		'>Have a coupon? <a'                     => '>¿Tienes un cupón? <a',
		'>Returning customer? <a'                => '>¿Ya eres cliente? <a',
		'I have read and agree to the website <a' => 'He leído y acepto los <a',
		'>terms and conditions</a></span>'       => '>términos y condiciones</a> de la web</span>',
		'>Click here to login<'                  => '>Haz clic aquí para acceder<',
		'>Click here to enter your coupon code<' => '>Haz clic aquí para introducir tu código<',
	);
	$content = strtr( $content, $reemplazos );
	// Mismos textos cuando van rodeados de espacios o saltos de línea
	$patrones = array(
		'/>\s*Proceed to Checkout\s*</i' => '>Finalizar compra<',
		'/>\s*Update Cart\s*</i'         => '>Actualizar carrito<',
		'/>\s*Apply coupon\s*</i'        => '>Aplicar cupón<',
		'/>\s*Cart Totals?\s*</i'        => '>Total del carrito<',
		'/>\s*Place order\s*</i'         => '>Realizar el pedido<',
		'/>\s*Billing details\s*</i'     => '>Datos de facturación<',
		'/>\s*Shipping details\s*</i'    => '>Datos de envío<',
		'/>\s*Your order\s*</i'          => '>Tu pedido<',
		'/>\s*Additional information\s*</i' => '>Información adicional<',
	);
	return preg_replace( array_keys( $patrones ), array_values( $patrones ), $content );
}

/**
 * 8) Carga el CSS de la ficha de producto (assets/pastymas-producto.css) sólo en productos individuales.
 */
add_action( 'wp_enqueue_scripts', 'pastymas_css_producto', 999 );
function pastymas_css_producto() {
	if ( ! function_exists( 'is_product' ) || ! is_product() ) {
		return;
	}
	$ruta = plugin_dir_path( __FILE__ ) . 'assets/pastymas-producto.css';
	if ( ! file_exists( $ruta ) ) {
		return;
	}
	wp_enqueue_style(
		'pastymas-producto',
		plugin_dir_url( __FILE__ ) . 'assets/pastymas-producto.css',
		array(),
		(string) filemtime( $ruta )
	);
}

/**
 * 9) Buscador de productos en vivo. Para que sea instantáneo, el plugin genera un índice ligero de todos los
 *    productos visibles (nombre, precio, foto, enlace, SKU) en un archivo JSON estático que el navegador carga una
 *    sola vez; después cada búsqueda se resuelve en local sin llamar al servidor. El índice se regenera cada hora
 *    (WP-Cron), al guardar un producto y al activar el plugin. Si el archivo no existe, se sirve por la API REST.
 */
function pastymas_indice_ruta() {
	$up = wp_upload_dir();
	return array(
		'dir'  => trailingslashit( $up['basedir'] ) . 'pastymas-buscador',
		'file' => trailingslashit( $up['basedir'] ) . 'pastymas-buscador/indice.json',
		'url'  => trailingslashit( $up['baseurl'] ) . 'pastymas-buscador/indice.json',
	);
}

function pastymas_construir_indice() {
	if ( ! function_exists( 'wc_get_products' ) ) {
		return array();
	}
	$ids   = wc_get_products( array( 'status' => 'publish', 'limit' => -1, 'return' => 'ids', 'orderby' => 'title', 'order' => 'ASC' ) );
	$items = array();
	foreach ( $ids as $id ) {
		$product = wc_get_product( $id );
		if ( ! $product || ! $product->is_visible() ) {
			continue;
		}
		$thumb_id = $product->get_image_id();
		$thumb    = $thumb_id ? wp_get_attachment_image_url( $thumb_id, 'woocommerce_gallery_thumbnail' ) : '';
		if ( ! $thumb && $thumb_id ) {
			$thumb = wp_get_attachment_image_url( $thumb_id, 'thumbnail' );
		}
		// Precio como texto limpio ("96,34€ + IVA"); si está rebajado, también el precio anterior.
		$limpia = function ( $html ) {
			$html = preg_replace( '/<span class="screen-reader-text">.*?<\/span>/s', '', (string) $html );
			$txt  = html_entity_decode( wp_strip_all_tags( $html ), ENT_QUOTES, 'UTF-8' );
			return trim( preg_replace( '/\s+/', ' ', $txt ) );
		};
		$sufijo = $limpia( $product->get_price_suffix() );
		$precio = $limpia( wc_price( wc_get_price_to_display( $product ) ) ) . ( $sufijo ? ' ' . $sufijo : '' );
		$antes  = '';
		if ( $product->is_on_sale() && $product->get_regular_price() !== '' && ! $product->is_type( 'variable' ) ) {
			$antes = $limpia( wc_price( wc_get_price_to_display( $product, array( 'price' => $product->get_regular_price() ) ) ) );
		} elseif ( $product->is_type( 'variable' ) ) {
			$precio = $limpia( $product->get_price_html() );
		}
		$items[] = array(
			'i' => (int) $id,
			'n' => html_entity_decode( $product->get_name(), ENT_QUOTES, 'UTF-8' ),
			'u' => $product->get_permalink(),
			't' => $thumb ? $thumb : '',
			'p' => $precio,
			'r' => $antes,
			's' => (string) $product->get_sku(),
			'o' => $product->is_in_stock() ? 1 : 0,
		);
	}
	return $items;
}

function pastymas_regenerar_indice() {
	if ( function_exists( 'set_time_limit' ) ) {
		@set_time_limit( 300 );
	}
	if ( function_exists( 'wp_raise_memory_limit' ) ) {
		wp_raise_memory_limit( 'admin' );
	}
	$items = pastymas_construir_indice();
	if ( empty( $items ) ) {
		return false;
	}
	$r = pastymas_indice_ruta();
	if ( ! is_dir( $r['dir'] ) ) {
		wp_mkdir_p( $r['dir'] );
	}
	$json = wp_json_encode( array( 'v' => time(), 'items' => $items ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
	$ok   = (bool) file_put_contents( $r['file'], $json );
	if ( $ok ) {
		update_option( 'pastymas_indice_version', time(), false );
	}
	return $ok;
}
add_action( 'pastymas_regenerar_indice', 'pastymas_regenerar_indice' );

// Programación: cada hora, y 2 minutos después de guardar/borrar un producto (una sola vez aunque se guarden varios).
add_action( 'init', function () {
	if ( ! wp_next_scheduled( 'pastymas_regenerar_indice' ) ) {
		wp_schedule_event( time() + 60, 'hourly', 'pastymas_regenerar_indice' );
	}
	// Tras instalar o actualizar el plugin (sin pasar por la activación) el índice puede no existir: se genera enseguida.
	$r = pastymas_indice_ruta();
	// Si cambia el formato del índice (nueva versión del plugin) se regenera también.
	$esquema_actual = 2;
	if ( ( ! file_exists( $r['file'] ) || (int) get_option( 'pastymas_indice_esquema', 0 ) !== $esquema_actual )
		&& ! wp_next_scheduled( 'pastymas_regenerar_indice_pronto' ) ) {
		update_option( 'pastymas_indice_esquema', $esquema_actual, false );
		wp_schedule_single_event( time() + 10, 'pastymas_regenerar_indice_pronto' );
	}
} );
function pastymas_programar_regeneracion() {
	if ( ! wp_next_scheduled( 'pastymas_regenerar_indice_pronto' ) ) {
		wp_schedule_single_event( time() + 120, 'pastymas_regenerar_indice_pronto' );
	}
}
add_action( 'pastymas_regenerar_indice_pronto', 'pastymas_regenerar_indice' );
add_action( 'woocommerce_update_product', 'pastymas_programar_regeneracion' );
add_action( 'woocommerce_new_product', 'pastymas_programar_regeneracion' );
add_action( 'woocommerce_delete_product', 'pastymas_programar_regeneracion' );
add_action( 'woocommerce_trash_product', 'pastymas_programar_regeneracion' );
register_activation_hook( __FILE__, 'pastymas_regenerar_indice' );
register_deactivation_hook( __FILE__, function () {
	wp_clear_scheduled_hook( 'pastymas_regenerar_indice' );
	wp_clear_scheduled_hook( 'pastymas_regenerar_indice_pronto' );
} );

// API REST de respaldo: sirve el índice (y lo genera si aún no existe).
add_action( 'rest_api_init', function () {
	register_rest_route( 'pastymas/v1', '/indice', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function () {
			$r = pastymas_indice_ruta();
			if ( ! file_exists( $r['file'] ) ) {
				pastymas_regenerar_indice();
			}
			$json = file_exists( $r['file'] ) ? file_get_contents( $r['file'] ) : '';
			$data = $json ? json_decode( $json, true ) : null;
			$resp = new WP_REST_Response( $data ? $data : array( 'v' => 0, 'items' => array() ) );
			$resp->header( 'Cache-Control', 'public, max-age=1800' );
			return $resp;
		},
	) );
} );

add_action( 'wp_enqueue_scripts', 'pastymas_buscador_assets', 999 );
function pastymas_buscador_assets() {
	$dir = plugin_dir_path( __FILE__ );
	$url = plugin_dir_url( __FILE__ );
	if ( ! file_exists( $dir . 'assets/pastymas-buscador.js' ) ) {
		return;
	}
	$r  = pastymas_indice_ruta();
	$ver = (int) get_option( 'pastymas_indice_version', 0 );
	wp_enqueue_style( 'pastymas-buscador', $url . 'assets/pastymas-buscador.css', array(), (string) filemtime( $dir . 'assets/pastymas-buscador.css' ) );
	wp_enqueue_script( 'pastymas-buscador', $url . 'assets/pastymas-buscador.js', array(), (string) filemtime( $dir . 'assets/pastymas-buscador.js' ), true );
	wp_localize_script( 'pastymas-buscador', 'pastymasBuscador', array(
		'indexUrl'  => file_exists( $r['file'] ) ? esc_url_raw( add_query_arg( 'v', $ver, $r['url'] ) ) : '',
		'indexApi'  => esc_url_raw( rest_url( 'pastymas/v1/indice' ) ),
		'api'       => esc_url_raw( rest_url( 'wc/store/v1/products' ) ),
		'searchUrl' => esc_url_raw( home_url( '/' ) ),
		'minChars'  => 3,
		'limit'     => 8,
		'i18n'      => array(
			'viewAll'    => 'Ver todos los resultados',
			'noResults'  => 'No hay productos con ese nombre',
			'outOfStock' => 'Agotado',
			'loading'    => 'Buscando…',
		),
	) );
}

/** Título de la página de resultados cuando se busca en productos ("Todos los productos" → "Resultados para: …"). */
add_filter( 'woocommerce_page_title', 'pastymas_titulo_busqueda' );
function pastymas_titulo_busqueda( $title ) {
	if ( is_search() && get_search_query() ) {
		return sprintf( 'Resultados para «%s»', get_search_query() );
	}
	return $title;
}

/**
 * 10) Nombre del bloque de envío en carrito y checkout ("Envio 1" → "Envío").
 */
add_filter( 'woocommerce_shipping_package_name', 'pastymas_nombre_paquete_envio', 99, 3 );
function pastymas_nombre_paquete_envio( $name, $i, $package ) {
	return 0 === (int) $i ? 'Envío' : sprintf( 'Envío %d', (int) $i + 1 );
}

/**
 * 11) El widget Checkout de Elementor Pro reescribe etiquetas y placeholders al pintar cada campo
 *     (filtro woocommerce_form_field_args). Se corrigen aquí con prioridad máxima.
 */
add_filter( 'woocommerce_form_field_args', 'pastymas_args_campos_es', 9999, 3 );
function pastymas_args_campos_es( $args, $key, $value ) {
	if ( ! pastymas_es_activo() ) {
		return $args;
	}
	static $textos = array(
		'first_name'  => array( 'Nombre', 'Nombre' ),
		'last_name'   => array( 'Apellidos', 'Apellidos' ),
		'company'     => array( 'Empresa', 'Nombre de la empresa' ),
		'email'       => array( 'Correo electrónico', 'nombre@ejemplo.com' ),
		'phone'       => array( 'Teléfono', '600 000 000' ),
		'address_1'   => array( 'Dirección', 'Calle y número' ),
		'address_2'   => array( 'Piso, puerta, escalera (opcional)', 'Piso, puerta, escalera (opcional)' ),
		'postcode'    => array( 'Código postal', 'Código postal' ),
		'city'        => array( 'Población', 'Población' ),
		'state'       => array( 'Provincia', null ),
		'country'     => array( 'País', null ),
		'nif'         => array( 'NIF / CIF / NIE', 'Número NIF / CIF / NIE' ),
	);
	$base = preg_replace( '/^(billing|shipping)_/', '', (string) $key );
	if ( $base !== $key && isset( $textos[ $base ] ) ) {
		$args['label'] = $textos[ $base ][0];
		if ( null !== $textos[ $base ][1] ) {
			$args['placeholder'] = $textos[ $base ][1];
		}
		if ( 'nif' === $base && ! empty( $args['class'] ) && is_array( $args['class'] ) && ! in_array( 'form-row-wide', $args['class'], true ) ) {
			$args['class'][] = 'form-row-wide';
		}
	}
	return $args;
}

/**
 * 12) Ajustes de la versión móvil (sólo @media max-width 767px): hero y secciones de la home, listado de la
 *     tienda a dos columnas, pie de página y corrección del ensanchamiento de la página en móvil.
 */
add_action( 'wp_enqueue_scripts', 'pastymas_css_movil', 999 );
function pastymas_css_movil() {
	$ruta = plugin_dir_path( __FILE__ ) . 'assets/pastymas-movil.css';
	if ( ! file_exists( $ruta ) ) {
		return;
	}
	wp_enqueue_style( 'pastymas-movil', plugin_dir_url( __FILE__ ) . 'assets/pastymas-movil.css', array(), (string) filemtime( $ruta ) );
}
