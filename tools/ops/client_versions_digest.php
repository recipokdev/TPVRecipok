<?php
declare(strict_types=1);
// Que version del TPV usa cada equipo (por empresa y direccion IP) segun los eventos de actualizacion del servidor
// (audit_log "prefetch-start" cada hora y "update-gate-*" al arrancar, ambos con currentVersion).
// SOLO LECTURA. Uso (en el servidor):  php client_versions_digest.php [horas=72] [slug]
// Se sube por scp a /tmp y se ejecuta con /opt/plesk/php/8.3/bin/php; no se despliega.
// Sirve para ver de un vistazo quien va por detras de la ultima version y llamarle antes de que dé problemas.
chdir('/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api');
$config = require 'config.php';
require_once 'lib/storage.php';
require_once 'lib/parked_db.php';
$hours = max(1, (int)($argv[1] ?? 72));
$onlySlug = trim((string)($argv[2] ?? ''));
$since = gmdate('Y-m-d\TH:i:s', time() - $hours * 3600);
$pdo = getParkedDbConnection($config);
$st = $pdo->prepare("SELECT event, slug, context_json, created_at FROM audit_log WHERE (event = 'prefetch-start' OR event LIKE 'update-gate-%') AND created_at >= :s ORDER BY id");
$st->execute(['s' => $since]);
$seen = []; // slug|ip => [version, last, gateErrors, retries]
$latest = '0';
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $c = json_decode((string)$r['context_json'], true) ?: [];
    $slug = (string)($r['slug'] ?? ($c['slug'] ?? ''));
    if ($slug === '' || ($onlySlug !== '' && $slug !== $onlySlug)) continue;
    $ver = (string)($c['currentVersion'] ?? '');
    $ip = (string)($c['requestIp'] ?? '?');
    $key = $slug . '|' . $ip;
    $row = $seen[$key] ?? ['slug' => $slug, 'ip' => $ip, 'ver' => '', 'last' => '', 'retries' => 0, 'errors' => 0, 'target' => ''];
    if ($ver !== '') {
        $row['ver'] = $ver;
        if (version_compare($ver, $latest, '>')) $latest = $ver;
    }
    $row['last'] = $r['created_at'];
    if ($r['event'] === 'update-gate-retry') $row['retries']++;
    if ($r['event'] === 'update-gate-error') $row['errors']++;
    if (!empty($c['targetVersion'])) {
        $row['target'] = (string)$c['targetVersion'];
        if (version_compare((string)$c['targetVersion'], $latest, '>')) $latest = (string)$c['targetVersion'];
    }
    $seen[$key] = $row;
}
echo "Ultima version vista en estos eventos: $latest   (ultimas $hours h)\n";
echo str_pad('empresa', 28) . str_pad('ip', 18) . str_pad('version', 10) . str_pad('visto por ultima vez (UTC)', 30) . "avisos\n";
uasort($seen, fn($a, $b) => version_compare($a['ver'] ?: '0', $b['ver'] ?: '0') <=> 0 ?: strcmp($a['slug'], $b['slug']));
foreach ($seen as $r) {
    $flags = [];
    if ($r['ver'] !== '' && version_compare($r['ver'], $latest, '<')) $flags[] = 'POR DETRAS de ' . $latest;
    if ($r['retries'] > 0) $flags[] = $r['retries'] . ' reintentos de actualizacion';
    if ($r['errors'] > 0) $flags[] = $r['errors'] . ' errores de actualizacion';
    echo str_pad($r['slug'], 28) . str_pad($r['ip'], 18) . str_pad($r['ver'] ?: '?', 10) . str_pad(substr($r['last'], 0, 19), 30) . implode(' · ', $flags) . "\n";
}
