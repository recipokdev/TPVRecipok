<?php
declare(strict_types=1);
// Detector de equipos que se quedan sin TPV tras una actualizacion o que no abren a su hora habitual.
// SOLO LECTURA. Uso (en el servidor):  php install_watch.php [horas=48] [slug]
// Se sube por scp a /tmp y se ejecuta con /opt/plesk/php/8.3/bin/php; no se despliega.
//
// Por que existe (Ben_Trempat, 18-nov-2026): un equipo empezo a instalar la 0.2.67 a las 14:38 UTC y no volvio a dar senal;
// nos enteramos al dia siguiente por una llamada. Si el instalador deja el equipo sin programa, la app no puede avisar
// (la comprobacion `update-install-not-applied` solo corre al arrancar la version nueva), asi que se mira desde el servidor.
//
// Dos comprobaciones:
//  A) INSTALACION SIN CONFIRMAR: un `update-gate-installing` al que, pasados unos minutos, no sigue ni `update-install-ok`
//     de esa empresa (con fromVersion = la version desde la que se instalo) ni ningun aviso de esa misma IP ya con la version nueva.
//  B) NO HA ABIERTO HOY A SU HORA: terminal (empresa + terminalId) que el mismo dia de la semana de las ultimas 4 semanas
//     abria a una hora tipica (mediana de su primera presencia) y hoy, pasados 90 min de esa hora, no ha abierto ni da senal.
//     Solo se evalua mientras todavia deberia estar abierto (antes de su hora tipica de cierre menos 30 min).
chdir('/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api');
$config = require 'config.php';
require_once 'lib/storage.php';
require_once 'lib/parked_db.php';

$hours = max(1, (int)($argv[1] ?? 48));
$onlySlug = trim((string)($argv[2] ?? ''));
const CONFIRM_GRACE_SEC = 600;      // A: margen para que la version nueva reabra y avise (lo normal son 25-50 s)
const LATE_AFTER_MIN = 90;          // B: minutos de retraso sobre la hora tipica de apertura
const MIN_SAME_WEEKDAY_SAMPLES = 2; // B: dias parecidos necesarios para fiarse de la hora tipica

$pdo = getParkedDbConnection($config);
$now = isset($argv[3]) && $argv[3] !== "" ? (int)strtotime($argv[3]) : time(); // 3er argumento opcional: hora simulada (solo para probar)
$nowIso = gmdate('c', $now);
echo "now=$nowIso  ventana={$hours}h" . ($onlySlug !== '' ? "  slug=$onlySlug" : '') . "\n";

function ctx(array $r): array { return json_decode((string)$r['context_json'], true) ?: []; }
function ts(string $iso): int { return (int)strtotime($iso . (strpos($iso, '+') === false && substr($iso, -1) !== 'Z' ? 'Z' : '')); }
function fmtAge(int $sec): string {
    if ($sec < 3600) return intdiv($sec, 60) . ' min';
    return intdiv($sec, 3600) . ' h ' . intdiv($sec % 3600, 60) . ' min';
}

// ---------- A) instalaciones sin confirmar ----------
echo "\n== A) INSTALACIONES SIN CONFIRMAR (update-gate-installing sin vuelta) ==\n";
$since = gmdate('Y-m-d\TH:i:s', $now - $hours * 3600);
$st = $pdo->prepare("SELECT slug, context_json, created_at FROM audit_log WHERE event = 'update-gate-installing' AND created_at >= :s ORDER BY created_at");
$st->execute(['s' => $since]);
$alertsA = 0;
$okA = 0;
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $slug = (string)$r['slug'];
    if ($onlySlug !== '' && $slug !== $onlySlug) continue;
    $c = ctx($r);
    $from = (string)($c['currentVersion'] ?? '');
    $ip = (string)($c['requestIp'] ?? '');
    $at = ts((string)$r['created_at']);
    $confirmed = false;
    $how = '';
    // 1) aviso de que se aplico, de la misma empresa y desde la version de la que se instalo
    $q = $pdo->prepare("SELECT created_at, context_json FROM audit_log WHERE slug = :sl AND event = 'update-install-ok' AND created_at > :a ORDER BY created_at");
    $q->execute(['sl' => $slug, 'a' => $r['created_at']]);
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $o) {
        $oc = ctx($o);
        if ((string)($oc['fromVersion'] ?? '') === $from) { $confirmed = true; $how = 'install-ok a los ' . fmtAge(ts((string)$o['created_at']) - $at); break; }
    }
    // 2) cualquier aviso posterior de esa misma IP (>2 min) ya con otra version
    if (!$confirmed && $ip !== '') {
        $q = $pdo->prepare("SELECT created_at, context_json FROM audit_log WHERE slug = :sl AND created_at > :a AND context_json LIKE :ip ORDER BY created_at LIMIT 40");
        $q->execute(['sl' => $slug, 'a' => gmdate('Y-m-d\TH:i:s', $at + 120), 'ip' => '%"requestIp":"' . $ip . '"%']);
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $o) {
            $oc = ctx($o);
            $v = (string)($oc['currentVersion'] ?? '');
            if ($v !== '' && version_compare($v, $from, '>')) { $confirmed = true; $how = 'senal ya en ' . $v . ' a los ' . fmtAge(ts((string)$o['created_at']) - $at); break; }
        }
    }
    $age = $now - $at;
    if ($confirmed) { $okA++; continue; }
    if ($age < CONFIRM_GRACE_SEC) {
        echo "  [en curso] $slug ($ip) instalando desde $from a las {$r['created_at']} (hace " . fmtAge($age) . ")\n";
        continue;
    }
    $alertsA++;
    echo "  [ALERTA]   $slug ($ip) empezo a instalar desde $from el {$r['created_at']} (hace " . fmtAge($age) . ") y NO ha vuelto a dar senal ni confirmado\n";
}
echo $alertsA === 0 ? "  Sin alertas ($okA instalaciones confirmadas en la ventana).\n" : "  => $alertsA alerta(s): llamar a la tienda (¿existe el icono? ¿antivirus? ver updater.log).\n";

// ---------- B) no ha abierto hoy a su hora ----------
echo "\n== B) NO HAN ABIERTO HOY A SU HORA HABITUAL ==\n";
$since4w = gmdate('Y-m-d\TH:i:s', $now - 28 * 86400);
$st = $pdo->prepare("SELECT slug, event, context_json, created_at FROM audit_log WHERE event IN ('upsert-terminal-presence','clear-terminal-presence','prefetch-start') AND created_at >= :s ORDER BY created_at");
$st->execute(['s' => $since4w]);
// $days[clave terminal][fecha] = [primera, ultima] en minutos UTC; prefetch-start no lleva terminalId: solo cuenta por empresa
$days = [];
$slugDays = [];
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $slug = (string)$r['slug'];
    if ($slug === '' || ($onlySlug !== '' && $slug !== $onlySlug)) continue;
    $c = ctx($r);
    $date = substr((string)$r['created_at'], 0, 10);
    $min = (int)substr((string)$r['created_at'], 11, 2) * 60 + (int)substr((string)$r['created_at'], 14, 2);
    if ($r['event'] === 'prefetch-start') {
        $slugDays[$slug][$date] = true;
        continue;
    }
    $tid = (string)($c['terminalId'] ?? '');
    if ($tid === '') continue;
    $key = $slug . '|' . $tid;
    if (!isset($days[$key][$date])) $days[$key][$date] = [$min, $min];
    else { $days[$key][$date][0] = min($days[$key][$date][0], $min); $days[$key][$date][1] = max($days[$key][$date][1], $min); }
}
// terminales con latido reciente (siguen vivos): no se evaluan
$alive = [];
$st = $pdo->prepare("SELECT slug, terminal_id, heartbeat_at FROM terminal_presence WHERE heartbeat_at >= :h");
$st->execute(['h' => gmdate('c', $now - 300)]);
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $alive[$r['slug'] . '|' . $r['terminal_id']] = true;

$today = gmdate('Y-m-d', $now);
$nowMin = (int)gmdate('G', $now) * 60 + (int)gmdate('i', $now);
$dow = gmdate('N', $now);
$alertsB = 0;
$evaluated = 0;
foreach ($days as $key => $perDate) {
    if (isset($alive[$key])) continue;
    $firsts = []; $lasts = [];
    foreach ($perDate as $d => $fl) {
        if ($d === $today || gmdate('N', strtotime($d . ' 12:00:00 UTC')) !== $dow) continue;
        $firsts[] = $fl[0]; $lasts[] = $fl[1];
    }
    if (count($firsts) < MIN_SAME_WEEKDAY_SAMPLES) continue;
    sort($firsts); sort($lasts);
    $medFirst = $firsts[intdiv(count($firsts), 2)];
    $medLast = $lasts[intdiv(count($lasts), 2)];
    if ($medLast - $medFirst < 120) continue; // dias de actividad muy corta: no es una tienda con jornada fiable
    $evaluated++;
    $opensToday = isset($perDate[$today]);
    $late = $nowMin - $medFirst;
    if ($opensToday || $late < LATE_AFTER_MIN || $nowMin > $medLast - 30) continue;
    $alertsB++;
    [$slug, $tid] = explode('|', $key, 2);
    $last = '';
    $dates = array_keys($perDate); sort($dates);
    $lastDate = end($dates);
    if ($lastDate) $last = " (ultima actividad $lastDate " . sprintf('%02d:%02d', intdiv($perDate[$lastDate][1], 60), $perDate[$lastDate][1] % 60) . ' UTC)';
    echo sprintf("  [ALERTA]   %s terminal %s: suele abrir hacia las %02d:%02d UTC y hoy, con %s de retraso, no ha abierto%s\n",
        $slug, $tid, intdiv($medFirst, 60), $medFirst % 60, fmtAge($late * 60), $last);
}
echo $alertsB === 0 ? "  Sin alertas ($evaluated terminales evaluados con historial suficiente).\n" : "  => $alertsB alerta(s).\n";

// ---------- C) avisos de la red de seguridad de la instalacion (vigilante, accesos directos) ----------
echo "\n== C) AVISOS DEL VIGILANTE DE INSTALACION Y DE ACCESOS DIRECTOS (ventana) ==\n";
$st = $pdo->prepare("SELECT created_at, slug, event, substr(context_json,1,260) c FROM audit_log WHERE (event LIKE 'install-watchdog-%' OR event IN ('shortcut-repaired','shortcut-created','manual-update-accepted')) AND created_at >= :s ORDER BY created_at DESC LIMIT 30");
$st->execute(['s' => $since]);
$rowsC = 0;
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    if ($onlySlug !== '' && $r['slug'] !== $onlySlug) continue;
    $rowsC++;
    echo "  {$r['created_at']} {$r['slug']} {$r['event']} {$r['c']}\n";
}
if ($rowsC === 0) echo "  Ninguno (ningun equipo ha necesitado el vigilante ni ha tenido que recrear accesos).\n";
// El trigger de cada instalacion (quien la pidio) y el antivirus, de los ultimos `update-gate-installing` con datos extra
echo "\n== D) ULTIMAS INSTALACIONES: quien las pidio, antivirus y Windows ==\n";
$st = $pdo->prepare("SELECT created_at, slug, context_json FROM audit_log WHERE event = 'update-gate-installing' AND created_at >= :s ORDER BY created_at DESC LIMIT 15");
$st->execute(['s' => $since]);
$rowsD = 0;
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    if ($onlySlug !== '' && $r['slug'] !== $onlySlug) continue;
    $c = ctx($r);
    if (!isset($c['trigger'])) continue; // las anteriores a esta version no traen los datos extra
    $rowsD++;
    echo sprintf("  %s %-26s desde %s: %s | av=%s | win=%s | instalador=%s %s MB\n", $r['created_at'], $r['slug'], (string)($c['currentVersion'] ?? '?'),
        (string)$c['trigger'], (string)($c['av'] ?? '?'), (string)($c['os'] ?? '?'), (string)($c['installerFile'] ?? '?'), (string)($c['installerMb'] ?? '?'));
}
if ($rowsD === 0) echo "  Aun no hay instalaciones con estos datos (llegan con los equipos que ya tengan la version con la red de seguridad).\n";
