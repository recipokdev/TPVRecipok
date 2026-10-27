<?php
declare(strict_types=1);
// Resumen de los eventos de cliente que los TPV mandan al servidor (audit_log "client-<categoria>").
// SOLO LECTURA. Uso (en el servidor):  php client_events_digest.php [horas=72] [slug]
// Se sube por scp a /tmp y se ejecuta con /opt/plesk/php/8.3/bin/php; no se despliega.
chdir('/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api');
$config = require 'config.php';
require_once 'lib/storage.php';
require_once 'lib/parked_db.php';
$hours = max(1, (int)($argv[1] ?? 72));
$onlySlug = trim((string)($argv[2] ?? ''));
$since = gmdate('Y-m-d\TH:i:s', time() - $hours * 3600);
$pdo = getParkedDbConnection($config);
$st = $pdo->prepare("SELECT event, context_json, created_at FROM audit_log WHERE event LIKE 'client-%' AND created_at >= :s ORDER BY id");
$st->execute(['s' => $since]);
$groups = [];
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $c = json_decode((string)$r['context_json'], true) ?: [];
    if ($onlySlug !== '' && ($c['slug'] ?? '') !== $onlySlug) continue;
    $key = substr($r['event'], 7) . ' | ' . ($c['code'] ?? '?') . ' | ' . ($c['slug'] ?? '?') . ' | v' . ($c['appVersion'] ?? '?');
    $g = &$groups[$key];
    $g['n'] = ($g['n'] ?? 0) + max(1, (int)($c['count'] ?? 1));
    $g['sev'] = $c['severity'] ?? 'warn';
    $g['first'] = $g['first'] ?? $r['created_at'];
    $g['last'] = $r['created_at'];
    $g['msg'] = (string)($c['message'] ?? '');
    $g['detail'] = (string)($c['detail'] ?? '');
    unset($g);
}
uasort($groups, fn($a, $b) => $b['n'] <=> $a['n']);
echo "Eventos de cliente en las ultimas {$hours} h" . ($onlySlug !== '' ? " (cliente $onlySlug)" : '') . ": " . count($groups) . " tipos distintos\n";
foreach ($groups as $k => $g) {
    echo sprintf("%5d x [%s] %s\n        primero %s | ultimo %s\n        ej: %s %s\n", $g['n'], $g['sev'], $k, substr($g['first'], 5, 11), substr($g['last'], 5, 11), mb_substr($g['msg'], 0, 110), mb_substr($g['detail'], 0, 120));
}
