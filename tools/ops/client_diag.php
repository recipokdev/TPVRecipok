<?php
declare(strict_types=1);
// Diagnosticos que mandan los TPV (desde la 0.2.69): foto del equipo (`diag-snapshot`, 1 por semana y al cambiar de version), informe del boton
// «Enviar diagnostico a soporte» (`diag-report`), errores del proceso principal (`main-error`) y fallos del cajon (`client-print` code
// drawer-open-failed). SOLO LECTURA. Uso (en el servidor):  php client_diag.php [horas=168] [slug]
// Se sube por scp a /tmp y se ejecuta con /opt/plesk/php/8.3/bin/php; no se despliega.
// Sirve para ver de un vistazo, SIN entrar en el equipo, que tiene cada cliente (version de Windows, antivirus, impresoras y su estado,
// si los programas auxiliares del cajon existen y su tamano, espacio libre...) y por que fallo algo.
chdir('/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api');
$config = require 'config.php';
require_once 'lib/storage.php';
require_once 'lib/parked_db.php';
$hours = max(1, (int)($argv[1] ?? 168));
$onlySlug = trim((string)($argv[2] ?? ''));
$since = gmdate('Y-m-d\TH:i:s', time() - $hours * 3600);
$pdo = getParkedDbConnection($config);
echo 'now=' . gmdate('c') . "  ventana={$hours}h" . ($onlySlug !== '' ? "  slug=$onlySlug" : '') . "\n";

function ctxOf(array $r): array { return json_decode((string)$r['context_json'], true) ?: []; }
function q(PDO $pdo, string $sql, array $p): array { $st = $pdo->prepare($sql); $st->execute($p); return $st->fetchAll(PDO::FETCH_ASSOC); }

echo "\n== FOTOS DEL EQUIPO (ultima por empresa y direccion IP) ==\n";
$rows = q($pdo, "SELECT slug, context_json, created_at FROM audit_log WHERE event = 'diag-snapshot' AND created_at >= :s ORDER BY created_at DESC", ['s' => $since]);
$seen = [];
foreach ($rows as $r) {
    if ($onlySlug !== '' && $r['slug'] !== $onlySlug) continue;
    $c = ctxOf($r);
    $key = $r['slug'] . '|' . ($c['requestIp'] ?? '?');
    if (isset($seen[$key])) continue;
    $seen[$key] = true;
    echo "  {$r['created_at']}  {$r['slug']} (" . ($c['requestIp'] ?? '?') . ") v" . ($c['appVersion'] ?? '?') . " [" . ($c['reason'] ?? '?') . "]\n";
    echo "      Windows: " . ($c['os'] ?? '?') . " | encendido hace " . ($c['uptimeH'] ?? '?') . " h | RAM " . ($c['ramFreeGb'] ?? '?') . "/" . ($c['ramGb'] ?? '?') . " GB | disco libre " . ($c['diskFreeGb'] ?? '?') . " GB (temp " . ($c['tempFreeGb'] ?? '?') . ")\n";
    echo "      Antivirus: " . ($c['av'] ?? '?') . " | pantallas: " . ($c['displays'] ?? '?') . " | kiosco: " . (!empty($c['kiosk']) ? 'si' : 'no') . "\n";
    echo "      Impresoras: " . ($c['printers'] ?? '?') . "\n";
    echo "      Programas del cajon: " . ($c['helpers'] ?? '?') . "\n";
    echo "      Cajon desde el arranque: " . (($c['drawer'] ?? '') !== '' ? $c['drawer'] : '(sin aperturas)') . "\n";
}
if (!$seen) echo "  Ninguna todavia (llegan con los equipos que ya tengan la version con diagnostico).\n";

echo "\n== INFORMES ENVIADOS CON EL BOTON «Enviar diagnostico» ==\n";
$rows = q($pdo, "SELECT slug, context_json, created_at FROM audit_log WHERE event = 'diag-report' AND created_at >= :s ORDER BY created_at DESC LIMIT 10", ['s' => $since]);
$n = 0;
foreach ($rows as $r) {
    if ($onlySlug !== '' && $r['slug'] !== $onlySlug) continue;
    $n++;
    $c = ctxOf($r);
    echo "  {$r['created_at']}  {$r['slug']} v" . ($c['appVersion'] ?? '?') . ": impresoras " . ($c['printers'] ?? '?') . " | cajon: " . ($c['drawer'] ?? '?') . " | helpers: " . ($c['helpers'] ?? '?') . "\n";
    foreach ((array)($c['events'] ?? []) as $l) echo "      aviso: $l\n";
    foreach (array_slice((array)($c['log'] ?? []), -8) as $l) echo "      log: $l\n";
}
if ($n === 0) echo "  Ninguno.\n";

echo "\n== ERRORES DEL PROCESO PRINCIPAL (main-error) ==\n";
$rows = q($pdo, "SELECT slug, context_json, created_at FROM audit_log WHERE event = 'main-error' AND created_at >= :s ORDER BY created_at DESC LIMIT 15", ['s' => $since]);
$n = 0;
foreach ($rows as $r) {
    if ($onlySlug !== '' && $r['slug'] !== $onlySlug) continue;
    $n++;
    $c = ctxOf($r);
    echo "  {$r['created_at']}  {$r['slug']} v" . ($c['currentVersion'] ?? '?') . " [" . ($c['origin'] ?? '?') . "] " . ($c['name'] ?? '') . ": " . ($c['message'] ?? '') . "\n";
    foreach ((array)($c['stack'] ?? []) as $l) echo "      $l\n";
}
if ($n === 0) echo "  Ninguno.\n";

echo "\n== FALLOS DE APERTURA DEL CAJON (client-print drawer-open-failed) ==\n";
$rows = q($pdo, "SELECT slug, context_json, created_at FROM audit_log WHERE event = 'client-print' AND context_json LIKE '%drawer-open-failed%' AND created_at >= :s ORDER BY created_at DESC LIMIT 15", ['s' => $since]);
$n = 0;
foreach ($rows as $r) {
    if ($onlySlug !== '' && $r['slug'] !== $onlySlug) continue;
    $n++;
    $c = ctxOf($r);
    $d = json_decode((string)($c['detail'] ?? ''), true);
    echo "  {$r['created_at']}  {$r['slug']} v" . ($c['appVersion'] ?? '?') . " terminal " . ($c['terminalId'] ?? '?') . ": " . ($c['message'] ?? '') . "\n";
    if (is_array($d)) {
        echo "      via=" . ($d['via'] ?? '?') . " " . ($d['ms'] ?? '?') . "ms impresora=" . ($d['printer'] ?? '?') . " estado=" . ($d['printerStatus'] ?? '?') . " origen=" . ($d['source'] ?? '?') . "\n";
        if (!empty($d['summary'])) echo "      intentos: " . $d['summary'] . "\n";
        if (!empty($d['raw'])) echo "      error: " . $d['raw'] . "\n";
    } else {
        echo "      detalle: " . substr((string)($c['detail'] ?? ''), 0, 300) . "\n";
    }
}
if ($n === 0) echo "  Ninguno.\n";
