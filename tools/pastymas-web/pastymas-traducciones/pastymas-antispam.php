<?php
/**
 * Pastymas – Protección antispam del registro de clientes (WooCommerce /mi-cuenta/ y "crear cuenta" en el checkout).
 * Capas, todas en el servidor:
 *   1. Campo trampa (honeypot) que los humanos no ven y los bots rellenan.
 *   2. Control de tiempo firmado: el formulario debe tardar al menos 4 s en enviarse y no más de 3 h.
 *   3. Comprobación de JavaScript: un campo que sólo rellena el navegador (respuesta calculada a partir del sello de tiempo).
 *   4. Límite por IP: máximo 3 registros por hora.
 *   5. Correo: dominio con registros MX/A y lista de dominios desechables.
 *   6. reCAPTCHA v3 (claves de Contact Form 7): token OBLIGATORIO, acción "registro" y puntuación mínima 0,5.
 *   7. Huella de los bots de registro: nombre igual al apellido, empresa "google", teléfonos rusos de 11 cifras,
 *      cirílico o URLs en los campos.
 *   8. Registro nativo de WordPress desactivado.
 * Cada bloqueo se contabiliza y se muestra en Usuarios > Todos los usuarios; cada alta permitida guarda IP y
 * puntuación en los metadatos del usuario (columna "Antispam" en la lista de usuarios).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'PASTYMAS_AS_MIN_SEG', 4 );
define( 'PASTYMAS_AS_MAX_SEG', 3 * HOUR_IN_SECONDS );
define( 'PASTYMAS_AS_MAX_IP_HORA', 3 );
define( 'PASTYMAS_AS_SCORE_MIN', 0.5 );

function pastymas_as_ip() {
	$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
	foreach ( array( 'HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP' ) as $h ) {
		if ( ! empty( $_SERVER[ $h ] ) && filter_var( $_SERVER[ $h ], FILTER_VALIDATE_IP ) ) {
			$ip = (string) $_SERVER[ $h ];
			break;
		}
	}
	return $ip;
}

function pastymas_as_token_tiempo() {
	$t = time();
	return $t . '.' . substr( hash_hmac( 'sha256', 'pm-reg-' . $t, wp_salt( 'nonce' ) ), 0, 20 );
}

function pastymas_as_tiempo_valido( $token ) {
	if ( ! preg_match( '/^(\d{9,11})\.([a-f0-9]{20})$/', (string) $token, $m ) ) {
		return 'sin_token';
	}
	$t = (int) $m[1];
	if ( ! hash_equals( substr( hash_hmac( 'sha256', 'pm-reg-' . $t, wp_salt( 'nonce' ) ), 0, 20 ), $m[2] ) ) {
		return 'token_invalido';
	}
	$edad = time() - $t;
	if ( $edad < PASTYMAS_AS_MIN_SEG ) {
		return 'demasiado_rapido';
	}
	if ( $edad > PASTYMAS_AS_MAX_SEG ) {
		return 'caducado';
	}
	return true;
}

/** Respuesta que debe calcular el navegador a partir del sello de tiempo (misma fórmula en assets/pastymas-registro.js). */
function pastymas_as_js_hash( $pm_t ) {
	$h = 7;
	$s = (string) $pm_t;
	for ( $i = 0, $l = strlen( $s ); $i < $l; $i++ ) {
		$h = ( $h * 31 + ord( $s[ $i ] ) ) % 1000000007;
	}
	return 'ok-' . base_convert( (string) $h, 10, 36 );
}

/** Claves reCAPTCHA v3 reutilizadas de Contact Form 7 (si existen). */
function pastymas_as_recaptcha_keys() {
	$opt = get_option( 'wpcf7' );
	if ( is_array( $opt ) && ! empty( $opt['recaptcha'] ) && is_array( $opt['recaptcha'] ) ) {
		foreach ( $opt['recaptcha'] as $sitekey => $secret ) {
			if ( $sitekey && $secret ) {
				return array( 'sitekey' => $sitekey, 'secret' => $secret );
			}
		}
	}
	return null;
}

function pastymas_as_recaptcha_score( $token ) {
	$keys = pastymas_as_recaptcha_keys();
	if ( ! $keys ) {
		return null; // sin claves no se puede comprobar: se confía en el resto de capas
	}
	if ( ! $token ) {
		return 'sin_recaptcha'; // con claves configuradas el token es obligatorio
	}
	$r = wp_remote_post( 'https://www.google.com/recaptcha/api/siteverify', array(
		'timeout' => 6,
		'body'    => array( 'secret' => $keys['secret'], 'response' => $token, 'remoteip' => pastymas_as_ip() ),
	) );
	if ( is_wp_error( $r ) ) {
		return null;
	}
	$d = json_decode( wp_remote_retrieve_body( $r ), true );
	if ( ! is_array( $d ) ) {
		return null;
	}
	if ( empty( $d['success'] ) ) {
		return 0.0;
	}
	if ( isset( $d['action'] ) && 'registro' !== $d['action'] ) {
		return 0.0; // token generado para otra acción (servicios de resolución de captchas)
	}
	return isset( $d['score'] ) ? (float) $d['score'] : null;
}

/** Huella de los bots de registro masivo en los campos de facturación. Devuelve true o el motivo. */
function pastymas_as_huella_bot( $post ) {
	$campo = function ( $k ) use ( $post ) {
		return isset( $post[ $k ] ) ? trim( wp_unslash( (string) $post[ $k ] ) ) : '';
	};
	$nombre   = $campo( 'billing_first_name' );
	$apellido = $campo( 'billing_last_name' );
	$empresa  = $campo( 'billing_company' );
	$telefono = $campo( 'billing_phone' );
	$ciudad   = $campo( 'billing_city' );
	if ( '' !== $nombre && '' !== $apellido && mb_strtolower( $nombre ) === mb_strtolower( $apellido ) ) {
		return 'nombre_igual_apellido';
	}
	if ( '' !== $empresa && in_array( mb_strtolower( $empresa ), array( 'google', 'gmail', 'yahoo', 'bing', 'facebook', 'test' ), true ) ) {
		return 'empresa_bot';
	}
	$digitos = preg_replace( '/\D+/', '', $telefono );
	if ( '' !== $digitos && preg_match( '/^[78]\d{10}$/', $digitos ) ) {
		return 'telefono_bot'; // formato ruso de 11 cifras que usan estos bots
	}
	foreach ( array( $nombre, $apellido, $empresa, $ciudad ) as $v ) {
		if ( '' === $v ) {
			continue;
		}
		if ( preg_match( '/\p{Cyrillic}/u', $v ) ) {
			return 'cirilico';
		}
		if ( preg_match( '#https?://|www\.#i', $v ) ) {
			return 'url_en_campos';
		}
	}
	return true;
}

function pastymas_as_dominios_desechables() {
	return array( 'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'mohmal.com', 'throwawaymail.com', 'emailondeck.com', 'tempail.com', 'mailnesia.com', 'mintemail.com', 'spamgourmet.com' );
}

function pastymas_as_email_valido( $email ) {
	$email = strtolower( trim( (string) $email ) );
	if ( ! is_email( $email ) ) {
		return 'email_invalido';
	}
	$dominio = substr( strrchr( $email, '@' ), 1 );
	if ( in_array( $dominio, pastymas_as_dominios_desechables(), true ) ) {
		return 'dominio_desechable';
	}
	if ( function_exists( 'checkdnsrr' ) && ! checkdnsrr( $dominio, 'MX' ) && ! checkdnsrr( $dominio, 'A' ) ) {
		return 'dominio_sin_correo';
	}
	return true;
}

function pastymas_as_registrar_bloqueo( $motivo, $email ) {
	$n = (int) get_option( 'pastymas_as_bloqueos', 0 );
	update_option( 'pastymas_as_bloqueos', $n + 1, false );
	$log = get_option( 'pastymas_as_log', array() );
	if ( ! is_array( $log ) ) {
		$log = array();
	}
	array_unshift( $log, array( 't' => time(), 'm' => $motivo, 'e' => substr( (string) $email, 0, 80 ), 'ip' => pastymas_as_ip() ) );
	update_option( 'pastymas_as_log', array_slice( $log, 0, 100 ), false );
}

/**
 * Evalúa un envío. Devuelve true si es legítimo o el motivo del bloqueo.
 */
function pastymas_as_evaluar( $post, $email ) {
	// 1. Honeypot
	if ( ! empty( $post['pm_web'] ) ) {
		return 'honeypot';
	}
	// 2. Tiempo
	$t = pastymas_as_tiempo_valido( isset( $post['pm_t'] ) ? $post['pm_t'] : '' );
	if ( true !== $t ) {
		return $t;
	}
	// 3. JavaScript: el navegador debe calcular la respuesta a partir del sello de tiempo
	if ( empty( $post['pm_js'] ) || ! hash_equals( pastymas_as_js_hash( $post['pm_t'] ), (string) $post['pm_js'] ) ) {
		return 'sin_javascript';
	}
	// 4. Límite por IP
	$clave = 'pm_as_' . md5( pastymas_as_ip() );
	$n     = (int) get_transient( $clave );
	if ( $n >= PASTYMAS_AS_MAX_IP_HORA ) {
		return 'limite_ip';
	}
	// 5. Correo
	$e = pastymas_as_email_valido( $email );
	if ( true !== $e ) {
		return $e;
	}
	// 6. Huella de los bots de registro
	$h = pastymas_as_huella_bot( $post );
	if ( true !== $h ) {
		return $h;
	}
	// 7. reCAPTCHA v3 (obligatorio si hay claves configuradas)
	$score = pastymas_as_recaptcha_score( isset( $post['pm_rc'] ) ? $post['pm_rc'] : '' );
	if ( is_string( $score ) ) {
		return $score;
	}
	if ( null !== $score && $score < PASTYMAS_AS_SCORE_MIN ) {
		return 'recaptcha_' . $score;
	}
	$GLOBALS['pastymas_as_score'] = $score;
	return true;
}

function pastymas_as_contar_ip() {
	$clave = 'pm_as_' . md5( pastymas_as_ip() );
	$n     = (int) get_transient( $clave );
	set_transient( $clave, $n + 1, HOUR_IN_SECONDS );
}

/* ---------- Campos en los formularios ---------- */
function pastymas_as_campos() {
	$keys = pastymas_as_recaptcha_keys();
	echo '<div class="pm-web-field" aria-hidden="true" style="position:absolute !important;left:-5000px !important;top:auto !important;width:1px !important;height:1px !important;overflow:hidden !important;">'
		. '<label for="pm_web">Deja este campo vacío</label><input type="text" name="pm_web" id="pm_web" value="" tabindex="-1" autocomplete="off"></div>';
	echo '<input type="hidden" name="pm_t" value="' . esc_attr( pastymas_as_token_tiempo() ) . '">';
	echo '<input type="hidden" name="pm_js" value="">';
	echo '<input type="hidden" name="pm_rc" value="" data-sitekey="' . esc_attr( $keys ? $keys['sitekey'] : '' ) . '">';
}
add_action( 'woocommerce_register_form', 'pastymas_as_campos' );
add_action( 'woocommerce_after_order_notes', 'pastymas_as_campos' );

/* ---------- Validación: registro en Mi cuenta ---------- */
add_filter( 'woocommerce_registration_errors', 'pastymas_as_validar_registro', 5, 3 );
function pastymas_as_validar_registro( $errors, $username, $email ) {
	if ( current_user_can( 'create_users' ) ) {
		return $errors; // alta hecha por un administrador (escritorio o API autenticada)
	}
	$r = pastymas_as_evaluar( $_POST, $email );
	if ( true !== $r ) {
		pastymas_as_registrar_bloqueo( $r, $email );
		$errors->add( 'pastymas_antispam', 'No hemos podido completar el registro. Vuelve a cargar la página e inténtalo de nuevo; si el problema continúa, escríbenos a info@pastymas.es.' );
		return $errors;
	}
	pastymas_as_contar_ip();
	return $errors;
}

/* ---------- Validación: "Crear una cuenta" en el checkout ---------- */
add_action( 'woocommerce_after_checkout_validation', 'pastymas_as_validar_checkout', 5, 2 );
function pastymas_as_validar_checkout( $data, $errors ) {
	if ( is_user_logged_in() || empty( $_POST['createaccount'] ) ) {
		return;
	}
	$email = isset( $data['billing_email'] ) ? $data['billing_email'] : '';
	$r     = pastymas_as_evaluar( $_POST, $email );
	if ( true !== $r ) {
		pastymas_as_registrar_bloqueo( 'checkout_' . $r, $email );
		$errors->add( 'pastymas_antispam', 'No hemos podido crear la cuenta. Desmarca «Crear una cuenta» o vuelve a cargar la página e inténtalo de nuevo.' );
		return;
	}
	pastymas_as_contar_ip();
}

/* ---------- Trazabilidad: IP y puntuación de cada alta permitida ---------- */
add_action( 'woocommerce_created_customer', function ( $customer_id ) {
	if ( current_user_can( 'create_users' ) ) {
		return;
	}
	update_user_meta( $customer_id, 'pm_as_ip', pastymas_as_ip() );
	if ( isset( $GLOBALS['pastymas_as_score'] ) && null !== $GLOBALS['pastymas_as_score'] ) {
		update_user_meta( $customer_id, 'pm_as_score', (string) $GLOBALS['pastymas_as_score'] );
	}
	$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? substr( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ), 0, 200 ) : '';
	if ( $ua ) {
		update_user_meta( $customer_id, 'pm_as_ua', $ua );
	}
}, 10, 1 );
add_filter( 'manage_users_columns', function ( $cols ) {
	$cols['pm_as'] = 'Antispam';
	return $cols;
} );
add_filter( 'manage_users_custom_column', function ( $out, $col, $user_id ) {
	if ( 'pm_as' !== $col ) {
		return $out;
	}
	$ip = get_user_meta( $user_id, 'pm_as_ip', true );
	$sc = get_user_meta( $user_id, 'pm_as_score', true );
	if ( ! $ip && '' === $sc ) {
		return '<span style="color:#999">—</span>';
	}
	return esc_html( $ip ) . ( '' !== $sc ? ' · ' . esc_html( $sc ) : '' );
}, 10, 3 );

/* ---------- Registro nativo de WordPress siempre cerrado ---------- */
add_filter( 'option_users_can_register', '__return_zero', 99 );
add_filter( 'pre_option_users_can_register', '__return_zero', 99 );

/* ---------- Script del navegador ---------- */
add_action( 'wp_enqueue_scripts', 'pastymas_as_script', 999 );
function pastymas_as_script() {
	if ( ! function_exists( 'is_account_page' ) || ! ( is_account_page() || is_checkout() ) ) {
		return;
	}
	$ruta = plugin_dir_path( __FILE__ ) . 'assets/pastymas-registro.js';
	if ( ! file_exists( $ruta ) ) {
		return;
	}
	wp_enqueue_script( 'pastymas-registro', plugin_dir_url( __FILE__ ) . 'assets/pastymas-registro.js', array(), (string) filemtime( $ruta ), true );
}

/* ---------- Aviso con el recuento en Usuarios ---------- */
add_action( 'admin_notices', function () {
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( ! $screen || 'users' !== $screen->id ) {
		return;
	}
	$n   = (int) get_option( 'pastymas_as_bloqueos', 0 );
	$log = get_option( 'pastymas_as_log', array() );
	$ult = ( is_array( $log ) && $log ) ? $log[0] : null;
	echo '<div class="notice notice-info"><p><strong>Antispam de registro (Pastymas):</strong> ' . (int) $n . ' intentos bloqueados'
		. ( $ult ? ' · último: ' . esc_html( date_i18n( 'd/m/Y H:i', $ult['t'] ) ) . ' (' . esc_html( $ult['m'] ) . ', ' . esc_html( $ult['e'] ) . ')' : '' ) . '.</p></div>';
} );
