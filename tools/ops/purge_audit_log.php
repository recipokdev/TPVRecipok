<?php
declare(strict_types=1);
// Retencion del registro de auditoria del servidor (tabla audit_log). Uso (en el servidor):
//   php purge_audit_log.php                  -> SIMULACION (no borra nada): cuenta lo que se borraria y lo que ocupa
//   php purge_audit_log.php --apply          -> borra de verdad, DESPUES de guardar copia de lo borrado (jsonl.gz)
//   php purge_audit_log.php --selftest       -> prueba el propio script con una tabla TEMPORAL sintetica (no toca datos reales)
//   opciones: --archive-dir=RUTA  --max-rows=N (por ejecucion, 100000 por defecto)  --ruido=45 --mantenimiento=90 --operativo=180
// Se sube por scp a /tmp y se ejecuta con /opt/plesk/php/8.3/bin/php; no se despliega.
//
// POLITICA (2026-11-19, pedida por Sergi al ver que la tabla crece sin limite: ~98.000 filas en 3 meses, ~30 MB):
//  - SOLO se borran los eventos de las listas de abajo. Cualquier otro (client-*, update-install-*, diag-*, main-error, instalaciones,
//    agentes, emparejamiento...) NO se toca nunca: son pocos y son justo los que sirven para investigar.
//  - ruido-tecnico (45 dias): presencia de terminales, descargas en segundo plano y comprobaciones de actualizacion al arrancar.
//  - mantenimiento (90 dias): purgas y calculos periodicos del propio servidor.
//  - operativo (180 dias): altas, cambios y bajas de pedidos aparcados y guardado por partes. Son el 60 % de las filas pero han servido para
//    investigar casos semanas despues (pollo de Asador, posible doble cobro de Lumi), por eso se guardan medio ano.
//  - Antes de borrar, las filas se copian a un fichero .jsonl.gz FUERA de la web; si no se puede escribir la copia, NO se borra nada.
const TIERS = [
    'ruido-tecnico' => ['days' => 45, 'events' => [
        'upsert-terminal-presence', 'clear-terminal-presence', 'prefetch-start', 'prefetch-ready', 'prefetch-download-start',
        'update-gate-searching', 'update-gate-api-connecting', 'update-gate-start', 'update-gate-no-update', 'update-gate-download-progress',
        'get-sync-diagnostics',
    ]],
    'mantenimiento' => ['days' => 90, 'events' => [
        'purge-expired-paid-parked', 'purge-stock-ledger', 'pack-stock-derive-write',
    ]],
    'operativo' => ['days' => 180, 'events' => [
        'update-parked-reservation', 'create-parked-reservation', 'delete-parked-reservation', 'parked-closing', 'parked-ops', 'customer-orders',
    ]],
];
const DEFAULT_ARCHIVE_DIR = '/var/www/vhosts/plus.recipok.com/audit-archive';

$opts = [];
foreach (array_slice($argv, 1) as $a) {
    if (preg_match('/^--([a-z-]+)(?:=(.*))?$/', $a, $m)) $opts[$m[1]] = $m[2] ?? '1';
}
$apply = isset($opts['apply']);
$selftest = isset($opts['selftest']);
$maxRows = max(1, (int)($opts['max-rows'] ?? 100000));
$tiers = TIERS;
foreach (['ruido' => 'ruido-tecnico', 'mantenimiento' => 'mantenimiento', 'operativo' => 'operativo'] as $o => $t) {
    if (isset($opts[$o]) && (int)$opts[$o] > 0) $tiers[$t]['days'] = (int)$opts[$o];
}

function fmtKb($b): string { return number_format(round($b / 1024), 0, ',', '.') . ' KB'; }

// Cuenta (y si $apply, copia y borra) lo que sobrepasa su plazo. Devuelve el informe. $table se valida: solo letras, numeros y guion bajo.
function purgeTable(PDO $pdo, string $table, array $tiers, bool $apply, string $archiveDir, int $maxRows, ?int $now = null): array
{
    if (!preg_match('/^[A-Za-z0-9_]+$/', $table)) throw new RuntimeException('nombre de tabla no valido');
    $now = $now ?? time();
    $report = ['tiers' => [], 'rows' => 0, 'bytes' => 0, 'deleted' => 0, 'archive' => null, 'applied' => $apply];
    $gz = null;
    if ($apply) {
        if (!is_dir($archiveDir) && !@mkdir($archiveDir, 0700, true)) throw new RuntimeException("no se puede crear la carpeta de copias: $archiveDir (no se borra nada)");
        if (!is_writable($archiveDir)) throw new RuntimeException("la carpeta de copias no admite escritura: $archiveDir (no se borra nada)");
        $file = rtrim($archiveDir, '/') . '/audit_log_' . gmdate('Ymd_His', $now) . '.jsonl.gz';
        $gz = gzopen($file, 'wb9');
        if (!$gz) throw new RuntimeException("no se puede crear la copia: $file (no se borra nada)");
        $report['archive'] = $file;
    }
    $left = $maxRows;
    foreach ($tiers as $name => $tier) {
        $cut = gmdate('Y-m-d\TH:i:s', $now - (int)$tier['days'] * 86400);
        $ph = implode(',', array_fill(0, count($tier['events']), '?'));
        $st = $pdo->prepare("SELECT event, COUNT(*) n, COALESCE(SUM(LENGTH(context_json)),0) b, MIN(created_at) first FROM `$table` WHERE created_at < ? AND event IN ($ph) GROUP BY event ORDER BY n DESC");
        $st->execute(array_merge([$cut], $tier['events']));
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        $tn = 0; $tb = 0;
        foreach ($rows as $r) { $tn += (int)$r['n']; $tb += (int)$r['b']; }
        $report['tiers'][$name] = ['days' => $tier['days'], 'cut' => $cut, 'events' => $rows, 'rows' => $tn, 'bytes' => $tb, 'deleted' => 0];
        $report['rows'] += $tn; $report['bytes'] += $tb;
        if (!$apply || $tn === 0 || $left <= 0) continue;
        while ($left > 0) {
            $take = min(2000, $left);
            $sel = $pdo->prepare("SELECT id, event, slug, terminal_id, context_json, created_at FROM `$table` WHERE created_at < ? AND event IN ($ph) ORDER BY id LIMIT $take");
            $sel->execute(array_merge([$cut], $tier['events']));
            $batch = $sel->fetchAll(PDO::FETCH_ASSOC);
            if (!$batch) break;
            foreach ($batch as $row) gzwrite($gz, json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
            $ids = array_map(fn($r) => (int)$r['id'], $batch);
            $del = $pdo->prepare("DELETE FROM `$table` WHERE id IN (" . implode(',', $ids) . ")");
            $del->execute();
            $n = $del->rowCount();
            $report['deleted'] += $n; $report['tiers'][$name]['deleted'] += $n; $left -= $n;
            usleep(150000); // sin ahogar la base de datos
            if (count($batch) < $take) break;
        }
    }
    if ($gz) gzclose($gz);
    if ($apply && $report['deleted'] === 0 && $report['archive'] && is_file($report['archive'])) { @unlink($report['archive']); $report['archive'] = null; }
    return $report;
}

function printReport(array $rep): void
{
    foreach ($rep['tiers'] as $name => $t) {
        echo sprintf("\n[%s] mas de %d dias (antes de %s): %d filas, %s%s\n", $name, $t['days'], $t['cut'], $t['rows'], fmtKb($t['bytes']), $rep['applied'] ? ", borradas {$t['deleted']}" : '');
        foreach ($t['events'] as $e) echo sprintf("    %-34s %7d filas  %s  (la mas vieja: %s)\n", $e['event'], $e['n'], fmtKb((int)$e['b']), substr((string)$e['first'], 0, 10));
    }
    echo sprintf("\nTOTAL: %d filas, %s\n", $rep['rows'], fmtKb($rep['bytes']));
    if ($rep['applied']) echo sprintf("Borradas: %d. Copia guardada en: %s\n", $rep['deleted'], $rep['archive'] ?? '(nada que borrar, sin copia)');
    else echo "SIMULACION: no se ha borrado nada. Para borrar de verdad: php purge_audit_log.php --apply\n";
}

if ($selftest) {
    // Prueba del propio script con una tabla TEMPORAL (desaparece sola al cerrar la conexion): no toca ningun dato real.
    chdir('/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api');
    $config = require 'config.php';
    require_once 'lib/storage.php';
    require_once 'lib/parked_db.php';
    $pdo = getParkedDbConnection($config);
    $pdo->exec('CREATE TEMPORARY TABLE audit_log_selftest LIKE audit_log');
    $now = time();
    $ins = $pdo->prepare('INSERT INTO audit_log_selftest (event, slug, terminal_id, context_json, created_at) VALUES (?,?,?,?,?)');
    $seed = [
        ['upsert-terminal-presence', 60, 3], ['upsert-terminal-presence', 10, 2],   // 3 viejas y 2 recientes
        ['update-parked-reservation', 200, 4], ['update-parked-reservation', 100, 2], // 4 viejas (>180) y 2 que aun se guardan (100 d)
        ['purge-stock-ledger', 120, 1],
        ['client-other', 400, 5], ['update-install-ok', 400, 2], ['evento-desconocido', 400, 2], // NUNCA se tocan, aunque sean muy viejas
    ];
    $expectDelete = 0; $expectKeep = 0;
    foreach ($seed as [$ev, $ageDays, $n]) {
        for ($i = 0; $i < $n; $i++) $ins->execute([$ev, 'selftest', '1', json_encode(['n' => $i, 'ev' => $ev]), gmdate('c', $now - $ageDays * 86400)]);
    }
    $expectDelete = 3 + 4 + 1;
    $before = (int)$pdo->query('SELECT COUNT(*) FROM audit_log_selftest')->fetchColumn();
    $dry = purgeTable($pdo, 'audit_log_selftest', TIERS, false, sys_get_temp_dir(), 100000, $now);
    $afterDry = (int)$pdo->query('SELECT COUNT(*) FROM audit_log_selftest')->fetchColumn();
    $dir = sys_get_temp_dir() . '/audit-archive-selftest-' . getmypid();
    $real = purgeTable($pdo, 'audit_log_selftest', TIERS, true, $dir, 100000, $now);
    $after = (int)$pdo->query('SELECT COUNT(*) FROM audit_log_selftest')->fetchColumn();
    $left = $pdo->query("SELECT event, COUNT(*) n FROM audit_log_selftest GROUP BY event ORDER BY event")->fetchAll(PDO::FETCH_KEY_PAIR);
    $archived = 0;
    if ($real['archive'] && is_file($real['archive'])) { foreach (gzfile($real['archive']) as $l) if (trim($l) !== '') $archived++; }
    // limite por ejecucion
    $pdo->exec('DELETE FROM audit_log_selftest');
    for ($i = 0; $i < 10; $i++) $ins->execute(['upsert-terminal-presence', 'selftest', '1', '{}', gmdate('c', $now - 90 * 86400)]);
    $lim = purgeTable($pdo, 'audit_log_selftest', TIERS, true, $dir, 4, $now);
    $limLeft = (int)$pdo->query('SELECT COUNT(*) FROM audit_log_selftest')->fetchColumn();
    // sin carpeta de copias: no debe borrar nada
    $pdo->exec('DELETE FROM audit_log_selftest');
    for ($i = 0; $i < 3; $i++) $ins->execute(['upsert-terminal-presence', 'selftest', '1', '{}', gmdate('c', $now - 90 * 86400)]);
    $noArch = 'sin-error';
    try { purgeTable($pdo, 'audit_log_selftest', TIERS, true, '/proc/no-se-puede-crear/x', 100000, $now); } catch (Throwable $e) { $noArch = 'error-esperado'; }
    $noArchLeft = (int)$pdo->query('SELECT COUNT(*) FROM audit_log_selftest')->fetchColumn();
    $ok = [
        'la simulacion cuenta ' . $expectDelete . ' filas y no borra nada' => $dry['rows'] === $expectDelete && $afterDry === $before && $dry['deleted'] === 0,
        'apply borra exactamente ' . $expectDelete => $real['deleted'] === $expectDelete && $after === $before - $expectDelete,
        'lo reciente se conserva (presencia de 10 dias y pedidos de 100 dias)' => ($left['upsert-terminal-presence'] ?? 0) === 2 && ($left['update-parked-reservation'] ?? 0) === 2,
        'los eventos NO listados se conservan aunque tengan 400 dias (client-other, update-install-ok, desconocido)' => ($left['client-other'] ?? 0) === 5 && ($left['update-install-ok'] ?? 0) === 2 && ($left['evento-desconocido'] ?? 0) === 2,
        'la copia tiene una linea por fila borrada (' . $expectDelete . ')' => $archived === $expectDelete,
        'el limite por ejecucion se respeta (4 de 10)' => $lim['deleted'] === 4 && $limLeft === 6,
        'si no se puede escribir la copia NO se borra nada' => $noArch === 'error-esperado' && $noArchLeft === 3,
    ];
    $bad = 0;
    foreach ($ok as $label => $v) { echo ($v ? '[OK] ' : '[FAIL] ') . $label . "\n"; if (!$v) $bad++; }
    foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
    @rmdir($dir);
    echo $bad === 0 ? "AUTOPRUEBA CORRECTA\n" : "AUTOPRUEBA CON FALLOS: $bad\n";
    exit($bad === 0 ? 0 : 1);
}

chdir('/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api');
$config = require 'config.php';
require_once 'lib/storage.php';
require_once 'lib/parked_db.php';
$pdo = getParkedDbConnection($config);
$archiveDir = (string)($opts['archive-dir'] ?? DEFAULT_ARCHIVE_DIR);
echo 'now=' . gmdate('c') . ($apply ? '  MODO: BORRAR (con copia previa)' : '  MODO: SIMULACION') . "\n";
$total = (int)$pdo->query('SELECT COUNT(*) FROM audit_log')->fetchColumn();
echo "audit_log tiene ahora $total filas.\n";
try {
    $rep = purgeTable($pdo, 'audit_log', $tiers, $apply, $archiveDir, $maxRows);
} catch (Throwable $e) {
    fwrite(STDERR, 'ERROR: ' . $e->getMessage() . "\n");
    exit(1);
}
printReport($rep);
if ($apply) echo 'audit_log tiene ahora ' . (int)$pdo->query('SELECT COUNT(*) FROM audit_log')->fetchColumn() . " filas.\n";
