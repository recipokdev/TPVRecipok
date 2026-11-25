# Pausa remota de actualizaciones por cliente

Para cuando un cliente no puede instalar una versión (por ejemplo, Windows bloquea el instalador sin firmar, como pasó en Sabor el
25-nov-2026) y su TPV no consigue abrir: desde el servidor se **pausa** las actualizaciones de ese cliente y su TPV abre con la versión
que tiene, sin descargar ni instalar nada. Funciona en los TPV con la **0.2.73 o posterior**; los anteriores no preguntan.

## Cómo se usa (por `ssh recipok-plesk`)

```
/opt/plesk/php/8.3/bin/php /var/www/vhosts/plus.recipok.com/httpdocs/tpv/api/tools/update_hold.php list
/opt/plesk/php/8.3/bin/php .../tools/update_hold.php set sabor_100x100 "Windows bloquea el instalador" --days=7
/opt/plesk/php/8.3/bin/php .../tools/update_hold.php clear sabor_100x100
/opt/plesk/php/8.3/bin/php .../tools/update_hold.php set "*" "version mala, esperar arreglo" --days=2   # TODOS los clientes
/opt/plesk/php/8.3/bin/php .../tools/update_hold.php clear "*"
```

- **Caduca sola** a los 7 días por defecto (`--days=N`; `--days=0` = sin caducidad). Así una pausa olvidada no deja a nadie sin actualizar
  para siempre.
- `"*"` es el interruptor general: pausa a todos los clientes.
- Cada cambio queda en el registro de auditoría (`update-hold-changed`). Cuando el TPV abre por una pausa anota
  `update-gate-held-by-server` con el motivo.
- Los datos están en `tpv/api/storage/update_hold.json` (la carpeta `storage` no se puede descargar por web). Un fichero que falte o esté
  roto significa «sin pausa».

## Qué cubre y qué no

- Cubre el arranque, el botón «Actualizar programa», la descarga en segundo plano y las ofertas al cerrar caja, al reanudar y por
  inactividad (todas pasan por la misma comprobación de política en el código). **Probado de punta a punta solo el arranque**; las demás vías comparten ese punto pero no tienen prueba propia.
- **Falla abierto:** si el TPV no tiene empresa configurada, o el servidor no contesta en 4 segundos, sigue como siempre. Nunca puede
  dejar a nadie sin TPV.
- No arregla el bloqueo de Windows: solo evita que el TPV se quede intentando. Para actualizar de verdad hay que desactivar el
  Control inteligente de aplicaciones en ese PC, o firmar el instalador.
- Si la pausa se pone cuando el TPV ya descargó una versión en segundo plano, esa descarga queda pendiente pero no se instala mientras dure.
