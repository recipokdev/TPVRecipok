<?php
declare(strict_types=1);

/**
 * Limpieza del ruido de la tabla `logs` de una instalacion de FacturaScripts (2026-10-28).
 *
 * Motivo: el plugin WooStockWebhook escribe DOS lineas "info" en cada peticion (Init::init), asi que en
 * Asador la tabla llego a 6,4 M de filas / 795 MB (97 % ruido) y la demo a 3 M / 516 MB. Esta
 * herramienta borra SOLO esas dos lineas (canal WooStockWebhook, nivel info), por tandas sobre rangos
 * de id (la tabla no tiene mas indice que la clave primaria), conservando los ultimos N dias, y
 * opcionalmente recupera el espacio (OPTIMIZE TABLE). No toca nada mas: ni ventas, ni stock, ni los
 * demas registros (api/audit/errores).
 *
 *   php purge_fs_logs.php <slug> [--days=7] [--batch=20000] [--optimize] [--apply]
 *                         [--confirm-real-client=<slug>]
 *
 * - Sin --apply solo CUENTA (prueba en seco).
 * - Para un slug distinto de "demo" exige --confirm-real-client=<mismo slug> (son datos de cliente real).
 * - Debe ejecutarse en el propio servidor (por SSH).
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Solo por linea de comandos (SSH).\n");
    exit(1);
}

const NOISY_MESSAGES = [
    'Hook WooStockWebhook cargado para modelo Stock',
    'Registro de Join\\StockProducto omitido por compatibilidad',
];
const FS_ROOT = '/var/www/vhosts/plus.recipok.com/httpdocs';

$slug = trim((string)($argv[1] ?? ''));
$opts = [];
foreach (array_slice($argv, 2) as $arg) {
    if (str_starts_with($arg, '--')) {
        $parts = explode('=', substr($arg, 2), 2);
        $opts[$parts[0]] = $parts[1] ?? true;
    }
}
if ($slug === '' || !preg_match('/^[A-Za-z0-9_\-]+$/', $slug)) {
    fwrite(STDERR, "Uso: php purge_fs_logs.php <slug> [--days=7] [--batch=20000] [--optimize] [--apply] [--confirm-real-client=<slug>]\n");
    exit(1);
}
$apply = isset($opts['apply']);
$optimize = isset($opts['optimize']);
$days = max(1, (int)($opts['days'] ?? 7));
$batch = max(1000, min(100000, (int)($opts['batch'] ?? 20000)));

if ($slug !== 'demo' && ($opts['confirm-real-client'] ?? '') !== $slug) {
    fwrite(STDERR, "'$slug' no es la demo: son datos de un cliente real. Si Sergi lo ha autorizado, repite con --confirm-real-client=$slug\n");
    exit(2);
}

$cfgPath = FS_ROOT . "/$slug/config.php";
if (!is_readable($cfgPath)) {
    fwrite(STDERR, "No encuentro $cfgPath\n");
    exit(1);
}
$cfg = (string)file_get_contents($cfgPath);
$c = [];
foreach (['HOST', 'NAME', 'USER', 'PASS'] as $k) {
    if (!preg_match("/FS_DB_$k'\\s*,\\s*'([^']*)'/", $cfg, $m)) {
        fwrite(STDERR, "Falta FS_DB_$k en la config.\n");
        exit(1);
    }
    $c[$k] = $m[1];
}
$db = new PDO("mysql:host={$c['HOST']};dbname={$c['NAME']};charset=utf8mb4", $c['USER'], $c['PASS'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

function tableInfo(PDO $db): array
{
    $r = $db->query("SELECT table_rows r, ROUND((data_length+index_length)/1048576) mb FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='logs'")->fetch(PDO::FETCH_ASSOC);
    return ['rows' => (int)($r['r'] ?? 0), 'mb' => (int)($r['mb'] ?? 0)];
}

$placeholders = implode(',', array_fill(0, count(NOISY_MESSAGES), '?'));
$cutoff = date('Y-m-d H:i:s', time() - $days * 86400);

echo ($apply ? 'MODO APLICAR' : 'PRUEBA EN SECO (no borra nada)') . " | $slug | se conserva lo posterior a $cutoff ($days dias)\n";
$before = tableInfo($db);
echo "antes: ~{$before['rows']} filas, {$before['mb']} MB\n";

$t0 = microtime(true);
$cutoffId = (int)$db->query("SELECT COALESCE(MAX(id),0) FROM logs WHERE time < " . $db->quote($cutoff))->fetchColumn();
$minId = (int)$db->query('SELECT COALESCE(MIN(id),0) FROM logs')->fetchColumn();
echo "ids a revisar: $minId .. $cutoffId\n";
if ($cutoffId <= 0) {
    echo "Nada anterior a la fecha de corte.\n";
    exit(0);
}

$params = NOISY_MESSAGES;
$count = $db->prepare("SELECT COUNT(*) FROM logs WHERE id <= $cutoffId AND channel='WooStockWebhook' AND level='info' AND message IN ($placeholders)");
$count->execute($params);
$candidates = (int)$count->fetchColumn();
$all = (int)$db->query("SELECT COUNT(*) FROM logs WHERE id <= $cutoffId")->fetchColumn();
echo "filas anteriores al corte: $all; de ellas ruido a borrar: $candidates (" . ($all ? round(100 * $candidates / $all) : 0) . " %)\n";

if (!$apply) {
    echo "Prueba en seco terminada en " . round(microtime(true) - $t0, 1) . " s. Repite con --apply para borrar.\n";
    exit(0);
}

$del = $db->prepare("DELETE FROM logs WHERE id BETWEEN ? AND ? AND channel='WooStockWebhook' AND level='info' AND message IN ($placeholders)");
$deleted = 0;
$batches = 0;
for ($from = $minId; $from <= $cutoffId; $from += $batch) {
    $to = min($from + $batch - 1, $cutoffId);
    $del->execute(array_merge([$from, $to], $params));
    $deleted += $del->rowCount();
    $batches++;
    if ($batches % 25 === 0) {
        echo "  ... tanda $batches, borradas $deleted (" . round(microtime(true) - $t0) . " s)\n";
    }
    usleep(150000); // respiro para no cargar el servidor compartido
}
echo "borradas $deleted filas en $batches tandas (" . round(microtime(true) - $t0, 1) . " s)\n";

if ($optimize) {
    echo "recuperando espacio (OPTIMIZE TABLE logs)...\n";
    $t1 = microtime(true);
    $db->query('OPTIMIZE TABLE logs')->fetchAll();
    echo "hecho en " . round(microtime(true) - $t1, 1) . " s\n";
}
$after = tableInfo($db);
echo "despues: ~{$after['rows']} filas, {$after['mb']} MB (antes {$before['mb']} MB)\n";
