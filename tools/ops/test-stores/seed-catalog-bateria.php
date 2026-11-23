<?php
// CARGA DE DATOS DE PRUEBA EN LA TIENDA `zz_bateria_tpv` (tienda interna de la bateria del TPV; NO es un cliente real). Idempotente.
// Origen: catalogo de `demo` (SOLO LECTURA: familias, productos, agentes); destino: SOLO zz_bateria_tpv. Aborta si el destino no es esa tienda.
// Clientes: ficticios (no se copian los de demo). Stock: cantidad predecible en cada almacen (no se copia el de demo, que tiene negativos).
if (PHP_SAPI !== 'cli') exit(1);
const DEST_SLUG = 'zz_bateria_tpv';
const STOCK_QTY = 100;
chdir('/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api/tools');
require '/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api/lib/storage.php';
require '/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api/lib/camareros_helpers.php';
require '/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api/lib/facturascripts_proxy.php';
$config = require '/var/www/vhosts/plus.recipok.com/httpdocs/tpv/api/config.php';
$src = resolveFacturascriptsCredentialsForSlug($config, 'demo');
$dst = resolveFacturascriptsCredentialsForSlug($config, DEST_SLUG);
// GUARDA: el destino tiene que ser exactamente la tienda de pruebas y distinta del origen.
if (strpos($dst['baseUrl'], '/' . DEST_SLUG . '/') === false || $dst['baseUrl'] === $src['baseUrl']) { fwrite(STDERR, "ABORTO: el destino no es " . DEST_SLUG . " ({$dst['baseUrl']})\n"); exit(2); }

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
function chk($label, $res) { global $ok, $fail; [$c, , $raw] = $res; if ($c >= 200 && $c < 300) { $ok++; return true; } $fail++; echo "  FALLO $label HTTP $c " . substr($raw, 0, 140) . "\n"; return false; }

echo "== familias\n";
[, $srcFam] = api($src, 'GET', '/familias?limit=500');
[, $haveFam] = api($dst, 'GET', '/familias?limit=500');
$haveFam = array_column((array)$haveFam, 'codfamilia');
// primero las que no tienen madre (para que la madre exista antes)
usort($srcFam, fn($a, $b) => (int)!empty($a['madre']) <=> (int)!empty($b['madre']));
foreach ((array)$srcFam as $f) {
  if (in_array($f['codfamilia'], $haveFam, true)) continue;
  $form = ['codfamilia' => $f['codfamilia'], 'descripcion' => $f['descripcion']];
  if (!empty($f['madre'])) $form['madre'] = $f['madre'];
  if (chk('familia ' . $f['codfamilia'], api($dst, 'POST', '/familias', $form))) echo "  creada {$f['codfamilia']}\n";
}

echo "== productos\n";
[, $srcProd] = api($src, 'GET', '/productos?limit=1000');
[, $haveProd] = api($dst, 'GET', '/productos?limit=1000');
$have = []; foreach ((array)$haveProd as $p) $have[$p['referencia']] = $p;
$created = 0; $skipped = 0; $idByRef = [];
foreach ((array)$srcProd as $p) {
  $ref = $p['referencia'];
  if (isset($have[$ref])) { $skipped++; $idByRef[$ref] = $have[$ref]['idproducto']; continue; }
  $form = [
    'referencia' => $ref, 'descripcion' => $p['descripcion'], 'precio' => $p['precio'], 'codfamilia' => $p['codfamilia'],
    'codimpuesto' => $p['codimpuesto'], 'sevende' => (int)$p['sevende'], 'secompra' => (int)$p['secompra'], 'nostock' => (int)$p['nostock'],
    'publico' => (int)$p['publico'], 'bloqueado' => (int)$p['bloqueado'], 'ventasinstock' => (int)($p['ventasinstock'] ?? 1), 'observaciones' => (string)($p['observaciones'] ?? ''),
  ];
  if (isset($p['tpvsort'])) $form['tpvsort'] = $p['tpvsort'];
  $res = api($dst, 'POST', '/productos', $form);
  if (!chk("producto $ref", $res)) continue;
  $created++;
  $idByRef[$ref] = $res[1]['data']['idproducto'] ?? ($res[1]['idproducto'] ?? null);
}
echo "  creados=$created ya_existian=$skipped\n";

echo "== stock (" . STOCK_QTY . " por almacen)\n";
[, $haveStock] = api($dst, 'GET', '/stocks?limit=2000');
$hs = []; foreach ((array)$haveStock as $s) $hs[$s['referencia'] . '|' . $s['codalmacen']] = true;
$stocks = 0;
foreach ((array)$srcProd as $p) {
  if (!empty($p['nostock'])) continue;
  foreach (['ALG', 'TDA2'] as $alm) {
    $k = $p['referencia'] . '|' . $alm; if (isset($hs[$k])) continue;
    $sf = ['referencia' => $p['referencia'], 'codalmacen' => $alm, 'cantidad' => STOCK_QTY];
    if (!empty($idByRef[$p['referencia']])) $sf['idproducto'] = $idByRef[$p['referencia']];
    if (chk("stock $k", api($dst, 'POST', '/stocks', $sf))) $stocks++;
  }
}
echo "  stocks creados=$stocks\n";

echo "== agentes (solo nombre de pila)\n";
[, $srcAg] = api($src, 'GET', '/agentes?limit=100');
[, $haveAg] = api($dst, 'GET', '/agentes?limit=100');
$haveAgCod = array_column((array)$haveAg, 'codagente');
foreach ((array)$srcAg as $a) {
  if (in_array((string)$a['codagente'], array_map('strval', $haveAgCod), true)) continue;
  if (chk('agente ' . $a['codagente'], api($dst, 'POST', '/agentes', ['codagente' => $a['codagente'], 'nombre' => $a['nombre']]))) echo "  creado agente {$a['codagente']} {$a['nombre']}\n";
}

echo "== clientes ficticios\n";
$customers = [['Panadería La Espiga S.L.', 'B00000011'], ['Hotel Marina Azul S.A.', 'A00000022'], ['Cafetería El Rincón', 'B00000033'], ['Catering Sabores del Sur S.L.', 'B00000044'], ['Colegio San Martín', 'Q0000005C'], ['Ana Pérez López', '00000006T'], ['Restaurante La Plaza', 'B00000077'], ['Oficinas Atlántico S.L.', 'B00000088']];
[, $haveCli] = api($dst, 'GET', '/clientes?limit=200');
$haveCliN = array_column((array)$haveCli, 'nombre');
foreach ($customers as [$name, $cif]) {
  if (in_array($name, $haveCliN, true)) continue;
  if (chk("cliente $name", api($dst, 'POST', '/clientes', ['nombre' => $name, 'razonsocial' => $name, 'cifnif' => $cif, 'tipoidfiscal' => 'CIF', 'email' => '', 'telefono1' => '']))) echo "  creado $name\n";
}
echo "\nOK=$ok FALLOS=$fail\n";
