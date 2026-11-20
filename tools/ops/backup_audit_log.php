<?php
declare(strict_types=1);
// Copia de seguridad COMPLETA de la tabla audit_log a un fichero .jsonl.gz FUERA de la web, con comprobacion (filas del fichero = filas de la tabla)
// y huella sha256. SOLO LECTURA sobre la base de datos. Uso (en el servidor):  php backup_audit_log.php [--dir=RUTA]
// Se sube por scp a /tmp y se ejecuta con /opt/plesk/php/8.3/bin/php; no se despliega.
// Pensada para hacerla ANTES de purgar (tools/ops/purge_audit_log.php --apply) y para guardarla como punto de restauracion.
// Restaurar: cada linea es un JSON con id, event, slug, terminal_id, context_json y created_at (se puede volver a insertar fila a fila).
chdir('/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api');
$config = require 'config.php';
require_once 'lib/storage.php';
require_once 'lib/parked_db.php';

$dir = '/var/www/vhosts/plus.recipok.com/audit-archive';
foreach (array_slice($argv, 1) as $a) {
    if (preg_match('/^--dir=(.+)$/', $a, $m)) $dir = $m[1];
}
if (!is_dir($dir) && !@mkdir($dir, 0700, true)) { fwrite(STDERR, "ERROR: no se puede crear $dir\n"); exit(1); }
if (!is_writable($dir)) { fwrite(STDERR, "ERROR: $dir no admite escritura\n"); exit(1); }

$pdo = getParkedDbConnection($config);
$total = (int)$pdo->query('SELECT COUNT(*) FROM audit_log')->fetchColumn();
$maxId = (int)$pdo->query('SELECT COALESCE(MAX(id),0) FROM audit_log')->fetchColumn();
$file = rtrim($dir, '/') . '/audit_log_COMPLETA_' . gmdate('Ymd_His') . '.jsonl.gz';
$gz = gzopen($file, 'wb9');
if (!$gz) { fwrite(STDERR, "ERROR: no se puede crear $file\n"); exit(1); }
chmod($file, 0600);

$written = 0;
$last = 0;
while (true) {
    $st = $pdo->prepare('SELECT id, event, slug, terminal_id, context_json, created_at FROM audit_log WHERE id > ? AND id <= ? ORDER BY id LIMIT 5000');
    $st->execute([$last, $maxId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) break;
    foreach ($rows as $r) {
        gzwrite($gz, json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
        $written++;
        $last = (int)$r['id'];
    }
}
gzclose($gz);

// comprobacion: se relee el fichero y se cuentan las lineas; las filas con id <= maxId de la tabla deben coincidir
$readBack = 0;
$gzr = gzopen($file, 'rb');
while (!gzeof($gzr)) { $l = gzgets($gzr); if ($l !== false && trim($l) !== '') $readBack++; }
gzclose($gzr);
$inTable = (int)$pdo->query("SELECT COUNT(*) FROM audit_log WHERE id <= $maxId")->fetchColumn();
$ok = ($readBack === $written);
echo 'now=' . gmdate('c') . "\n";
echo "Filas en la tabla al empezar: $total (hasta id $maxId)\n";
echo "Filas escritas: $written | releidas del fichero: $readBack | filas de la tabla hasta ese id ahora: $inTable\n";
echo 'Fichero: ' . $file . ' (' . round(filesize($file) / 1024) . " KB)\n";
echo 'sha256: ' . hash_file('sha256', $file) . "\n";
echo $ok && $written === $inTable ? "COPIA CORRECTA\n" : ($ok ? "COPIA COHERENTE (la tabla cambio mientras se copiaba: filas nuevas o borradas)\n" : "COPIA CON FALLOS\n");
exit($ok ? 0 : 1);
