<?php
// SIEMBRA 2 PARA LAS TIENDAS DE PRUEBAS INTERNAS (NO son clientes reales). Idempotente. Uso: php zz_seed2.php bateria | app
//  bateria -> zz_bateria_tpv: copia del plano de mesas de demo (estado limpio), banderas de los terminales y enlace agente-terminal como demo.
//  app     -> zz_app_camareros: catalogo minimo (3 familias, 10 productos con variantes, anadidos y 2 IVA), stock, 3 agentes + enlace, 3 clientes
//             ficticios y plano de 2 salas / 4 mesas.
// LECTURA de demo solo para copiar el plano/terminales/enlaces; ESCRITURA solo en la tienda destino (guarda: aborta si la URL no es la suya).
if (PHP_SAPI !== 'cli') exit(1);
$mode = $argv[1] ?? '';
$SLUGS = ['bateria' => 'zz_bateria_tpv', 'app' => 'zz_app_camareros'];
if (!isset($SLUGS[$mode])) { fwrite(STDERR, "Uso: php zz_seed2.php bateria|app\n"); exit(1); }
$DEST = $SLUGS[$mode];
chdir('/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api/tools');
$root = '/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api';
foreach (['json', 'storage', 'camareros_helpers', 'facturascripts_proxy', 'parked_db', 'mesas_layout_db', 'mesas_layout', 'product_addons_db', 'product_addons'] as $b) require_once "$root/lib/$b.php";
$config = require "$root/config.php";
$src = resolveFacturascriptsCredentialsForSlug($config, 'demo');
$dst = resolveFacturascriptsCredentialsForSlug($config, $DEST);
if (strpos($dst['baseUrl'], '/' . $DEST . '/') === false || $dst['baseUrl'] === $src['baseUrl']) { fwrite(STDERR, "ABORTO: el destino no es $DEST ({$dst['baseUrl']})\n"); exit(2); }

function api($cr, $method, $path, $form = null) {
  $ch = curl_init($cr['baseUrl'] . $path);
  $h = ['Accept: application/json', 'Token: ' . $cr['apiKey']];
  $o = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CUSTOMREQUEST => $method];
  if ($form !== null) { $o[CURLOPT_POSTFIELDS] = http_build_query($form); $h[] = 'Content-Type: application/x-www-form-urlencoded'; }
  $o[CURLOPT_HTTPHEADER] = $h;
  curl_setopt_array($ch, $o);
  $r = curl_exec($ch); $c = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  return [$c, json_decode((string)$r, true), (string)$r];
}
$ok = 0; $fail = 0;
function chk($label, $res) { global $ok, $fail; [$c, , $raw] = $res; if ($c >= 200 && $c < 300) { $ok++; return true; } $fail++; echo "  FALLO $label HTTP $c " . substr($raw, 0, 160) . "\n"; return false; }

// ---- enlace agente-terminal
function linkAgents($dst, array $pairs) {
  [, $have] = api($dst, 'GET', '/tpvagentes?limit=500');
  $hv = []; foreach ((array)$have as $r) $hv[$r['codagente'] . '|' . $r['idtpv']] = true;
  $n = 0;
  foreach ($pairs as [$cod, $idtpv]) { if (isset($hv["$cod|$idtpv"])) continue; if (chk("enlace agente $cod terminal $idtpv", api($dst, 'POST', '/tpvagentes', ['codagente' => $cod, 'idtpv' => $idtpv]))) $n++; }
  echo "  enlaces creados=$n\n";
}

// ---- plano de mesas (solo si no existe ya)
function saveLayout($config, $slug, $alm, array $layout) {
  if (readMesasLayoutDb($config, $slug, $alm)) { echo "  plano $slug/$alm ya existe: no se toca\n"; return; }
  $r = saveMesasLayoutDb($config, $slug, $layout, $alm);
  echo "  plano $slug/$alm guardado (" . count($layout['roomList']) . " salas)\n";
}

if ($mode === 'bateria') {
  echo "== terminales: banderas como demo\n";
  [, $sT] = api($src, 'GET', '/tpvterminales?limit=20');
  foreach ((array)$sT as $t) {
    $form = []; foreach (['adddiscount', 'addemptyline', 'changeprice', 'closeagent', 'grouplines', 'listtype'] as $k) if (array_key_exists($k, $t) && $t[$k] !== null) $form[$k] = is_bool($t[$k]) ? (int)$t[$k] : $t[$k];
    if ($form && chk('terminal ' . $t['idtpv'], api($dst, 'PUT', '/tpvterminales/' . $t['idtpv'], $form))) echo "  terminal {$t['idtpv']} actualizado (" . implode(',', array_keys($form)) . ")\n";
  }
  echo "== enlace agente-terminal como demo\n";
  [, $sL] = api($src, 'GET', '/tpvagentes?limit=500');
  linkAgents($dst, array_map(fn($r) => [$r['codagente'], $r['idtpv']], (array)$sL));
  echo "== variantes extra (productos con varias variantes en demo) y anadidos utiles\n";
  [, $dv] = api($src, 'GET', '/variantes?limit=3000'); [, $dp] = api($src, 'GET', '/productos?limit=3000');
  [, $zv] = api($dst, 'GET', '/variantes?limit=3000'); [, $zp] = api($dst, 'GET', '/productos?limit=3000');
  $dRefById = []; foreach ((array)$dp as $x) $dRefById[$x['idproducto']] = $x['referencia'];
  $zIdByRef = []; foreach ((array)$zp as $x) $zIdByRef[$x['referencia']] = $x['idproducto'];
  $zVarRefs = array_column((array)$zv, 'referencia');
  [, $zst] = api($dst, 'GET', '/stocks?limit=3000'); $zs = []; foreach ((array)$zst as $x) $zs[$x['referencia'] . '|' . $x['codalmacen']] = true;
  $byProd = []; foreach ((array)$dv as $v) $byProd[$v['idproducto']][] = $v;
  $nv = 0;
  foreach ($byProd as $idp => $vars) {
    if (count($vars) < 2) continue;
    $zid = $zIdByRef[$dRefById[$idp] ?? ''] ?? null; if (!$zid) continue;
    foreach ($vars as $v) {
      if (in_array($v['referencia'], $zVarRefs, true)) continue;
      $form = ['idproducto' => $zid, 'referencia' => $v['referencia'], 'precio' => $v['precio']]; if (!empty($v['codbarras'])) $form['codbarras'] = $v['codbarras'];
      if (chk("variante {$v['referencia']}", api($dst, 'POST', '/variantes', $form))) { $nv++; $zVarRefs[] = $v['referencia']; echo "  variante '{$v['referencia']}' (cod {$v['codbarras']}) de " . ($dRefById[$idp] ?? '?') . "\n"; }
      foreach (['ALG', 'TDA2'] as $alm) { if (isset($zs[$v['referencia'] . '|' . $alm])) continue; chk("stock variante {$v['referencia']} $alm", api($dst, 'POST', '/stocks', ['referencia' => $v['referencia'], 'codalmacen' => $alm, 'cantidad' => 100, 'idproducto' => $zid])); }
    }
  }
  echo "  variantes creadas=$nv\n";
  $zAdd = listProductAddons($config, $DEST); $na = 0;
  foreach (listProductAddons($config, 'demo') as $a) {
    if (preg_match('/DBG|BORRAR|VERIFY|Nuevo a/iu', (string)$a['nombre'])) continue;
    $zid = $zIdByRef[$dRefById[(int)$a['idproducto']] ?? ''] ?? null; if (!$zid) continue;
    $dup = false; foreach ($zAdd as $e) if ((int)$e['idproducto'] === (int)$zid && $e['nombre'] === $a['nombre']) $dup = true;
    if ($dup) continue;
    saveProductAddon($config, $DEST, (int)$zid, null, (string)$a['nombre'], (float)$a['precio']); $na++; echo "  anadido '{$a['nombre']}' ({$a['precio']}) en " . ($dRefById[(int)$a['idproducto']] ?? '?') . "\n";
  }
  echo "  anadidos creados=$na\n";
  echo "== plano de mesas: copia de demo con estado limpio\n";
  foreach (['ALG', 'TDA2'] as $alm) {
    $row = readMesasLayoutDb($config, 'demo', $alm);
    if (!$row) { echo "  demo/$alm sin plano\n"; continue; }
    $l = $row['layout'];
    $l['tableTicketMap'] = new stdClass();
    foreach (array_keys($l['tableStates'] ?? []) as $k) $l['tableStates'][$k] = 'libre';
    $l['parkedCounter'] = 0; $l['draftCartByTable'] = [];
    saveLayout($config, $DEST, $alm, $l);
  }
}

if ($mode === 'app') {
  echo "== familias\n";
  $fams = ['APPCAF' => 'Cafés', 'APPBOL' => 'Bollería', 'APPBEB' => 'Bebidas'];
  [, $hf] = api($dst, 'GET', '/familias?limit=100'); $hf = array_column((array)$hf, 'codfamilia');
  foreach ($fams as $cod => $d) { if (in_array($cod, $hf, true)) continue; if (chk("familia $cod", api($dst, 'POST', '/familias', ['codfamilia' => $cod, 'descripcion' => $d]))) echo "  creada $cod\n"; }
  echo "== productos (precios con IVA; neto = bruto/(1+iva))\n";
  // [ref, nombre, familia, bruto, iva, variante extra [ref, nombre, bruto] | null, anadidos [[nombre, precio]...]]
  $P = [
    ['APP01', 'Café solo', 'APPCAF', 1.35, 10, null, [['Con leche', 0.30], ['Sin azúcar', 0.00]]],
    ['APP02', 'Café con leche', 'APPCAF', 1.85, 10, null, [['Leche de avena', 0.40]]],
    ['APP03', 'Cortado', 'APPCAF', 1.55, 10, null, []],
    ['APP04', 'Croissant', 'APPBOL', 1.45, 10, ['APP04X6', '6 croissants', 7.95], [['Con mantequilla', 0.20]]],
    ['APP05', 'Napolitana', 'APPBOL', 1.95, 10, null, []],
    ['APP06', 'Ensaimada', 'APPBOL', 2.35, 10, null, []],
    ['APP07', 'Agua 50 cl', 'APPBEB', 1.10, 10, null, []],
    ['APP08', 'Zumo de naranja', 'APPBEB', 2.90, 10, null, []],
    ['APP09', 'Cerveza', 'APPBEB', 2.45, 21, null, []],
    ['APP10', 'Copa de vino', 'APPBEB', 3.25, 21, null, []],
  ];
  [, $hp] = api($dst, 'GET', '/productos?limit=500'); $have = []; foreach ((array)$hp as $p) $have[$p['referencia']] = $p['idproducto'];
  [, $hs] = api($dst, 'GET', '/stocks?limit=2000'); $hst = []; foreach ((array)$hs as $s) $hst[$s['referencia'] . '|' . $s['codalmacen']] = true;
  [, $hv] = api($dst, 'GET', '/variantes?limit=2000'); $hvar = array_column((array)$hv, 'referencia');
  $existingAddons = listProductAddons($config, $DEST);
  foreach ($P as [$ref, $name, $fam, $gross, $iva, $var, $addons]) {
    $idp = $have[$ref] ?? null;
    if (!$idp) {
      $form = ['referencia' => $ref, 'descripcion' => $name, 'precio' => round($gross / (1 + $iva / 100), 6), 'codfamilia' => $fam, 'codimpuesto' => 'IVA' . $iva, 'sevende' => 1, 'secompra' => 1, 'nostock' => 0, 'publico' => 1, 'ventasinstock' => 1];
      $res = api($dst, 'POST', '/productos', $form);
      if (!chk("producto $ref", $res)) continue;
      $idp = $res[1]['data']['idproducto'] ?? ($res[1]['idproducto'] ?? null);
      if (!$idp) { [, $g] = api($dst, 'GET', '/productos?filter[referencia]=' . urlencode($ref)); $idp = $g[0]['idproducto'] ?? null; }
      echo "  creado $ref $name ($gross EUR, IVA $iva%)\n";
    }
    foreach (['ALG', 'TDA2'] as $alm) { if (isset($hst["$ref|$alm"])) continue; $sf = ['referencia' => $ref, 'codalmacen' => $alm, 'cantidad' => 100]; if ($idp) $sf['idproducto'] = $idp; chk("stock $ref $alm", api($dst, 'POST', '/stocks', $sf)); }
    if ($var && !in_array($var[0], $hvar, true) && $idp) { if (chk("variante {$var[0]}", api($dst, 'POST', '/variantes', ['idproducto' => $idp, 'referencia' => $var[0], 'precio' => round($var[2] / (1 + $iva / 100), 6), 'codbarras' => $var[0]]))) echo "  variante {$var[0]} de $ref\n"; }
    foreach ($addons as [$an, $ap]) {
      $dup = false; foreach ($existingAddons as $e) if ((int)$e['idproducto'] === (int)$idp && $e['nombre'] === $an) $dup = true;
      if ($dup || !$idp) continue;
      saveProductAddon($config, $DEST, (int)$idp, null, $an, (float)$ap); echo "  añadido '$an' ($ap) en $ref\n";
    }
  }
  echo "== agentes (3) y enlace con los dos terminales\n";
  [, $ha] = api($dst, 'GET', '/agentes?limit=100'); $haCod = array_map('strval', array_column((array)$ha, 'codagente'));
  foreach ([['2', 'Ana'], ['3', 'Beto'], ['4', 'Carla']] as [$cod, $nom]) { if (in_array($cod, $haCod, true)) continue; if (chk("agente $cod", api($dst, 'POST', '/agentes', ['codagente' => $cod, 'nombre' => $nom]))) echo "  creado agente $cod $nom\n"; }
  $pairs = []; foreach (['1', '2', '3', '4'] as $c) foreach ([1, 2] as $t) $pairs[] = [$c, $t];
  linkAgents($dst, $pairs);
  echo "== clientes ficticios\n";
  [, $hc] = api($dst, 'GET', '/clientes?limit=200'); $hcn = array_column((array)$hc, 'nombre');
  foreach ([['Cliente Prueba Uno S.L.', 'B00000101'], ['Cliente Prueba Dos S.A.', 'A00000202'], ['Persona Prueba Tres', '00000303T']] as [$n, $cif]) {
    if (in_array($n, $hcn, true)) continue; if (chk("cliente $n", api($dst, 'POST', '/clientes', ['nombre' => $n, 'razonsocial' => $n, 'cifnif' => $cif, 'tipoidfiscal' => 'CIF', 'email' => '', 'telefono1' => '']))) echo "  creado $n\n";
  }
  echo "== plano: Sala (M1-M3) y Terraza (M4)\n";
  $mk = function ($room, $roomName, $tables) {
    $items = []; $meta = []; $states = []; $x = 80;
    foreach ($tables as [$id, $code, $cap]) {
      $uid = "$room::$id";
      $items[] = ['id' => "obj-$room-$id", 'cls' => 'table-round', 'label' => $code, 'tableId' => $id, 'tableUid' => $uid, 'x' => $x, 'y' => 80, 'w' => 118, 'h' => 118, 'prevX' => $x, 'prevY' => 80, 'prevW' => 118, 'prevH' => 118];
      $meta[$uid] = ['capacity' => $cap, 'diners' => 0, 'reservationName' => '', 'reservationTime' => '', 'serviceStage' => ''];
      $states[$uid] = 'libre'; $x += 160;
    }
    return [['id' => $room, 'name' => $roomName, 'tables' => array_map(fn($t) => ['id' => $t[0], 'name' => $t[1], 'code' => $t[1]], $tables)], $items, $meta, $states];
  };
  [$r1, $d1, $m1, $s1] = $mk('sala', 'Sala', [['m1', 'M1', 4], ['m2', 'M2', 4], ['m3', 'M3', 6]]);
  [$r2, $d2, $m2, $s2] = $mk('terraza', 'Terraza', [['m4', 'M4', 4]]);
  $layout = ['activeView' => 'mapa', 'activeRoomId' => 'sala', 'selectedTableId' => 'sala::m1', 'category' => 'all', 'search' => '', 'parkedCounter' => 0, 'roomList' => [$r1, $r2],
    'tableTicketMap' => new stdClass(), 'tableStates' => $s1 + $s2, 'tableMeta' => $m1 + $m2, 'designSnapMode' => 'free', 'roomDesigns' => ['sala' => $d1, 'terraza' => $d2], 'draftCartByTable' => []];
  foreach (['ALG', 'TDA2'] as $alm) saveLayout($config, $DEST, $alm, $layout);
}
echo "\nOK=$ok FALLOS=$fail\n";
