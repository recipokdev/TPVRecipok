<?php
/**
 * Pastymas – Observaciones "Pedido web" en los documentos que el conector Woo Reciplus crea en FacturaScripts.
 *
 * El conector no permite personalizar las observaciones, así que se interviene en la petición HTTP que envía
 * a la API de Reciplus (filtro http_request_args de WordPress): cuando el cuerpo es el de creación de un
 * documento (lleva codcliente + lineas), se añade/antepone "Pedido web pastymas.es nº X".
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Guarda el nº de pedido WooCommerce que se está procesando para poder citarlo en las observaciones. */
function pastymas_rp_recordar_pedido( $order_id ) {
	if ( is_numeric( $order_id ) && (int) $order_id > 0 ) {
		$GLOBALS['pastymas_rp_pedido'] = (int) $order_id;
	}
}
add_action( 'woocommerce_pre_payment_complete', 'pastymas_rp_recordar_pedido', 1, 1 );
add_action( 'woocommerce_payment_complete', 'pastymas_rp_recordar_pedido', 1, 1 );
add_action( 'woocommerce_order_status_changed', 'pastymas_rp_recordar_pedido', 1, 1 );
add_action( 'woocommerce_thankyou', 'pastymas_rp_recordar_pedido', 1, 1 );
add_action( 'admin_post_reciplus_manual_send', function () {
	if ( isset( $_GET['order_id'] ) ) {
		pastymas_rp_recordar_pedido( absint( $_GET['order_id'] ) );
	}
}, 1 );

/** Texto de observaciones para el documento. */
function pastymas_rp_texto( $existente = '' ) {
	$n     = isset( $GLOBALS['pastymas_rp_pedido'] ) ? (int) $GLOBALS['pastymas_rp_pedido'] : 0;
	$texto = 'Pedido web pastymas.es' . ( $n ? ' nº ' . $n : '' );
	$existente = trim( (string) $existente );
	if ( '' !== $existente && false === stripos( $existente, 'Pedido web' ) ) {
		$texto .= ' · ' . $existente;
	}
	return $texto;
}

/** ¿Es la petición de creación de documento del conector a la API de Reciplus? */
function pastymas_rp_es_creacion( $url, $body ) {
	if ( ! is_string( $url ) || false === stripos( $url, '/api/3' ) ) {
		return false;
	}
	$host = (string) wp_parse_url( $url, PHP_URL_HOST );
	if ( false === stripos( $host, 'recipok.com' ) ) {
		return false;
	}
	return is_array( $body ) && isset( $body['codcliente'], $body['lineas'] );
}

/** Devuelve [cuerpo decodificado, formato] o null. */
function pastymas_rp_decodificar( $body ) {
	if ( is_array( $body ) ) {
		return array( $body, 'array' );
	}
	if ( ! is_string( $body ) || '' === $body ) {
		return null;
	}
	$j = json_decode( $body, true );
	if ( is_array( $j ) ) {
		return array( $j, 'json' );
	}
	$q = array();
	parse_str( $body, $q );
	return $q ? array( $q, 'query' ) : null;
}

function pastymas_rp_codificar( $data, $formato ) {
	if ( 'json' === $formato ) {
		return wp_json_encode( $data );
	}
	if ( 'query' === $formato ) {
		return http_build_query( $data, '', '&' );
	}
	return $data;
}

add_filter( 'http_request_args', 'pastymas_rp_filtrar_peticion', 20, 2 );
function pastymas_rp_filtrar_peticion( $args, $url ) {
	if ( ! is_array( $args ) || empty( $args['body'] ) ) {
		return $args;
	}
	$dec = pastymas_rp_decodificar( $args['body'] );
	if ( ! $dec ) {
		return $args;
	}
	list( $data, $formato ) = $dec;
	if ( ! pastymas_rp_es_creacion( $url, $data ) ) {
		return $args;
	}
	$data['observaciones'] = pastymas_rp_texto( isset( $data['observaciones'] ) ? $data['observaciones'] : '' );
	$args['body']          = pastymas_rp_codificar( $data, $formato );
	return $args;
}
