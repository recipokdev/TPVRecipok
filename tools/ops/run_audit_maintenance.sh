#!/bin/sh
# Mantenimiento mensual del registro de auditoria (tabla audit_log) en el servidor. Lo lanza cron el dia 1 de cada mes (ver abajo).
#   1) copia COMPLETA de la tabla (backup_audit_log.php); si falla, NO se purga;
#   2) purga con copia previa de lo borrado (purge_audit_log.php --apply);
#   3) se conservan solo las 3 ultimas copias completas (las copias de lo borrado son diminutas y se guardan todas).
# Todo queda anotado en $OPS/audit_maintenance.log. Los scripts viven FUERA de la web, en $OPS.
# Cron (usuario del dominio):  30 3 1 * * /bin/sh /var/www/vhosts/plus.recipok.com/ops/run_audit_maintenance.sh
PHP=/opt/plesk/php/8.3/bin/php
OPS=/var/www/vhosts/plus.recipok.com/ops
ARCH=/var/www/vhosts/plus.recipok.com/audit-archive
LOG="$OPS/audit_maintenance.log"
{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) mantenimiento de audit_log ==="
  if $PHP "$OPS/backup_audit_log.php" --dir="$ARCH"; then
    $PHP "$OPS/purge_audit_log.php" --apply --archive-dir="$ARCH"
  else
    echo "ERROR: la copia completa fallo; NO se purga"
  fi
  ls -1t "$ARCH"/audit_log_COMPLETA_*.jsonl.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
  echo
} >> "$LOG" 2>&1
