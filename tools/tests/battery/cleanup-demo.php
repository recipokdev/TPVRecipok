<?php
// cleanup-demo.php -- limpieza de los datos de prueba que dejan las pruebas de la bateria en la DEMO (solo slug demo). Se ejecuta en el
// servidor: ssh recipok-plesk /opt/plesk/php/8.3/bin/php < tools/tests/battery/cleanup-demo.php (lo hace run-battery.js solo).
// Patron ESTRECHO a proposito (nada que empiece por "TEST" a secas): solo "TEST2TPV…" (nombre/observaciones de los encargos de las
// pruebas) y los codigos "TEST-ENC-…", para no borrar lo que pruebe una persona en la demo.
chdir('/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api');
require_once 'lib/storage.php'; require_once 'lib/camareros_helpers.php'; require_once 'lib/facturascripts_proxy.php';
require_once 'lib/parked_db.php'; require_once 'lib/customer_orders_db.php';
$config = require 'config.php';

// 1) pedidos de FacturaScripts de prueba (los ya facturados no se pueden borrar: devuelven 400 y se ignoran)
$creds = resolveFacturascriptsCredentialsForSlug($config, 'demo');
function fsCall($m, $u, $k) { $ch = curl_init($u); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CUSTOMREQUEST => $m, CURLOPT_HTTPHEADER => ['Accept: application/json', 'Token: ' . $k]]); $b = curl_exec($ch); $c = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, json_decode((string)$b, true)]; }
[$c, $rows] = fsCall('GET', $creds['baseUrl'] . '/pedidoclientes?limit=300&sort[idpedido]=DESC', $creds['apiKey']);
$del = 0;
foreach ((array)$rows as $p) {
    if (preg_match('/^ENC-/', (string)($p['numero2'] ?? '')) && stripos((string)($p['observaciones'] ?? ''), 'TEST2TPV') !== false) {
        [$hc,] = fsCall('DELETE', $creds['baseUrl'] . '/pedidoclientes/' . $p['idpedido'], $creds['apiKey']);
        if ($hc >= 200 && $hc < 300) $del++;
    }
}
echo "pedidos de FS borrados: $del\n";

// 2) filas de prueba de las tablas de Encargos
$pdo = getParkedDbConnection($config);
customerOrdersEnsureTables($pdo);
$ids = $pdo->query("SELECT id FROM customer_orders WHERE slug = 'demo' AND (order_code LIKE 'TEST-ENC-%' OR customer_name LIKE 'TEST2TPV%')")->fetchAll(PDO::FETCH_COLUMN);
if ($ids) {
    $in = implode(',', array_map('intval', $ids));
    $m = $pdo->exec("DELETE FROM customer_order_moves WHERE slug = 'demo' AND order_id IN ($in)");
    $o = $pdo->exec("DELETE FROM customer_orders WHERE slug = 'demo' AND id IN ($in)");
    echo "encargos de prueba borrados: $o ($m movimientos)\n";
} else {
    echo "encargos de prueba borrados: 0\n";
}
