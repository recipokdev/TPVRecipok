# Batería de pruebas del TPV Recipok

Una sola orden que ejecuta, en orden, todas las pruebas automáticas del TPV que tienen un resultado claro («correcto» / «fallo») y
genera un **informe** que se puede leer y enseñar sin saber programar.

## Cómo se lanza

| Orden | Qué ejecuta | Duración aprox. |
|---|---|---|
| `npm run battery:quick` | Solo el código: sintaxis, más de 1.300 reglas internas, guardado por partes y la autoprueba | ~5 s |
| `npm run battery` | Lo anterior + el TPV real en un perfil aislado (venta, aparcados, Modo Mesas, arranque) | ~10 min |
| `npm run battery:full` | Todo lo anterior + TPV reales contra la **demo**, incluidos escenarios con **2 TPV a la vez** (Mesas, dividir cuenta, stock, Encargos) | ~20 min |
| `node tools/tests/battery/run-battery.js --only=encargos-2tpv,smoke` | Solo las pruebas indicadas (por identificador o por área) | — |
| `node tools/tests/battery/run-battery.js --list` | Muestra la lista | — |

El informe queda en `tools/tests/reports/battery-<fecha>/report.html` (y una copia en `tools/tests/reports/latest.html`), junto con
`report.md`, `results.json` y el texto completo de cada prueba en `logs/`. Esa carpeta no se sube a git.

## Cómo leer el informe

- Arriba: **resultado global** (APROBADA / APROBADA con pruebas omitidas / CON FALLOS), versión, commit, fecha y duración.
- Por **áreas** (Código, Venta/aparcados/caja, Modo Mesas, Dividir cuenta, Varios TPV y stock, Encargos): cada prueba explica en
  lenguaje claro qué comprueba, cuántas comprobaciones han salido bien y cuánto ha tardado. «Ver detalle» lista cada comprobación.
- Si algo falla se abre solo el detalle con el motivo y las últimas líneas de lo que ocurrió.
- Al final, **qué NO cubre** la batería (para no dar una falsa sensación de seguridad).
- La **Autoprueba** es un control negativo: una prueba falla a propósito y solo sale «bien» si la batería lo detecta. Si alguna vez
  aparece en rojo, la propia batería no es de fiar.

## Qué necesita

- `quick` y `standard` no necesitan nada más (el TPV se abre en segundo plano con perfiles temporales aislados).
- `full` necesita los perfiles de pruebas `tpvrecipok-2tpv-real-1` y `-2` (en la carpeta temporal del equipo) **con la sesión ya iniciada**
  y conexión con el servidor. Si faltan, esas pruebas se **omiten** (no fallan) y el informe lo dice. Para crearlos: `npm run test:2tpv`,
  iniciar sesión en cada ventana una vez y cerrarlas. La batería **nunca escribe el PIN**.
- Las pruebas con la demo crean datos de prueba en ella (facturas con «[PRUEBA…]», que FacturaScripts no deja borrar) y mueven unas
  pocas unidades del stock de algunos productos de prueba. No tocan clientes reales.
- **Limpieza automática:** antes y después de las pruebas con la demo se borran los encargos y pedidos de prueba (solo los que empiezan por
  `TEST2TPV…` o `TEST-ENC-…`, nunca algo que escriba una persona probando). Necesita acceso `ssh recipok-plesk`; si no lo hay, el informe lo
  avisa y puede fallar una prueba de Encargos si quedan restos de una ejecución anterior.
- **No lanzar `full` mientras otra persona prueba en la demo** (por ejemplo, el jefe probando Encargos): comparten caja y los totales del
  cierre de caja se mezclarían y alguna prueba podría fallar sin que haya un fallo real.

## Cómo añadir una prueba nueva

1. Escribir el script en `tools/tests/` imprimiendo cada comprobación como `[OK] texto` o `[FAIL] texto` (el ayudante
   `tools/tests/battery/verdict.js` lo hace: `emitVerdict([[nombre, ok, detalle?], ...])`) y saliendo con código distinto de 0 si algo falla.
2. Añadirla a `tools/tests/battery/suites.js` con un título y una explicación **para personas que no programan**, su nivel
   (`quick` / `standard` / `full`) y si usa la demo.

**Regla:** una prueba que solo imprime datos para que alguien los interprete a mano no entra en la batería.

## Estado actual de la cobertura

Con veredicto automático hoy: reglas internas del código, venta/aparcados/opciones en TPV normal, movimientos de caja, cobro en efectivo y
con tarjeta, devoluciones (parcial y total) y totales de cierre, Modo Mesas básico, comanda automática (1 y 2 TPV), cambiar entre mesas ocupadas, mover y fusionar mesas, aviso «mesa en uso», cobro que falla, cobrar una mesa y que el pedido cambie mientras se cobra, fallos de red al guardar, pedidos de la app de camareros, líneas que no se
pierden con 2 TPV, dividir cuenta (TPV normal y Mesas, con y sin guardado por partes, con 1 y 2 TPV), carrera de stock con 2 TPV y
Encargos (crear, editar, recoger, cancelar, cierre de caja, variantes, añadidos de pago, varias tiendas).

Pendiente de convertir a pruebas con veredicto (existen como scripts manuales que solo imprimen datos): vista y recuperación al volver, `run-two-tpv-ops*.js`.
Pendiente de crear: apertura y cierre real de la caja (la prueba de caja solo abre y cancela el cuadro de cierre, para no cerrar la caja
compartida de la demo), arranque con GitHub caído / sin internet.

## Relación con el `stable patch`

Hoy, al publicar, `npm run release` ejecuta `npm test` (las reglas sobre el código, unos segundos) y el hook de pre-push ejecuta además
las pruebas de Mesas. La batería no está conectada a la publicación: se lanza a mano (por ejemplo `npm run battery` antes de publicar,
o `npm run battery:full` antes de una versión importante).
