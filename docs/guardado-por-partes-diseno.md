# Guardado de pedidos por partes — diseño

Estado (2026-10-15): **aprobado** por Sergi. Paso 1 (identidad estable de línea) hecho (`e441821`). **Servidor hecho y desplegado**, activo solo para `demo`, en Modo Mesas (`parked_ops_pilot_slugs_mesas`) y desde 2026-10-16 también en TPV normal (`parked_ops_pilot_slugs_tpv`). **Cliente hecho** (2026-10-16): el TPV de escritorio ya usa la acción nueva cuando el servidor la activa (solo `demo`/Mesas).

## 1. El problema

Hoy cada cambio en un pedido (aparcado de TPV normal o pedido de Modo Mesas) hace que el TPV mande **el documento entero** (cabecera + todas las líneas) a `create-parked-reservation` / `update-parked-reservation`, y el servidor lo sobrescribe (`saveParkedReservationDb`). La protección es un bloqueo optimista de "todo o nada" (`expectedUpdatedAt`, 412).

Consecuencias reales vistas este mes:

- Dos dispositivos tocan la misma mesa casi a la vez → uno gana, el otro pierde su cambio entero (aunque tocaran líneas distintas).
- Líneas que desaparecen / reaparecen (Lumi, Asador el Gallo).
- Campos ajenos borrados por una escritura de otro (`comandaState`, `sentBatchAt`, nombre de cliente).
- Falsos 412 y avisos "Remoto más reciente" que asustan al cliente.
- Mesas que "reviven" al cobrar en otro terminal.

Causa común: **la unidad de escritura es el pedido entero**, así que cualquier escritura pisa todo lo demás.

## 2. Idea

Escribir **operaciones pequeñas e idempotentes** sobre partes del pedido, no el pedido entero:

| Operación | Efecto |
|---|---|
| `line-upsert` | pone una línea completa (por `lineId`): producto, cantidad, precio, descuentos, añadidos, sellos de envío |
| `line-remove` | quita una línea por `lineId` |
| `header-set` | fija campos de cabecera (nombre, observaciones, cliente, descuento general, alertas de mesa, comensales…) — **solo los campos que se mandan** |
| `comanda-commit` | registra lo impreso (`comandaState`) y sella las líneas enviadas |
| `mesa-link` | asigna/mueve la mesa (scope de sala/mesa) |
| `pay-flags` | marcas de cobro/cierre en curso (hoy ya protegidas; siguen su propio camino) |

Reglas:

1. **Cantidades por diferencia, el resto por valor completo.** Subir/bajar una cantidad se manda como "+1"/"−1" (`line-qty-delta`) para que dos dispositivos que suman a la vez **se sumen** (en la realidad se pidieron dos más). Es seguro repetirlas porque **cada petición lleva un `clientOpId`** y el servidor ignora la que ya aplicó (tabla `parked_ops_applied`, limpieza a las 24 h). Precio, descuento, nombre, observaciones y demás campos van por valor completo.
2. **Reglas de conflicto** (acordadas con Sergi):

| Cambio | Quién gana |
|---|---|
| Añadir/subir/bajar cantidad | Se suman los dos cambios |
| Precio, descuento, nombre, observaciones, campos de línea | El último en llegar al servidor (la fila bloqueada pone el orden); el otro dispositivo lo ve al instante por el aviso en tiempo real |
| Quitar una línea mientras otro la edita | Gana quitar; la edición vuelve como conflicto `line-missing` |
| Pedido ya cobrado | Siempre el servidor: las operaciones se ignoran |
| Pedido borrado | No se resucita (`missing`) |
3. **El servidor aplica la operación sobre el documento guardado dentro de una transacción con la fila bloqueada** (`SELECT … FOR UPDATE`), y devuelve el documento resultante. No hay tabla nueva de líneas en la primera versión: `items_json` sigue siendo la fuente. Sin migración de datos ni de esquema.
4. `items_json` sigue siendo el formato que leen la app de camareros y el resto → **cero cambios para quien no use operaciones**.

## 3. Cubre los dos modos con un solo motor

El servidor ya comparte toda la lógica de guardar/borrar/proteger el cobro entre las dos tablas, parametrizada por nombre de tabla (`parkedTableNameFor()` → `parked_reservations` o `parked_reservations_mesas`). La acción nueva usa **la misma función de resolución de tabla**.

| | Modo Mesas (`parked_reservations_mesas`) | TPV normal (`parked_reservations`) |
|---|---|---|
| Concurrencia | alta (varios dispositivos, muchos cambios seguidos) | baja |
| Campos extra | mesa/sala, comensales, alertas, `comandaState`, división de cuenta | docType `pedido`, estado de recogida, cliente, aislamiento por tienda (`codalmacen`) |
| Operaciones específicas | `mesa-link`, `comanda-commit` | `header-set` con los campos de pedido |
| Activación | lista piloto propia | lista piloto propia |

Cada modo se activa **por separado** por cliente (mismo patrón que `parked_tpv_codalmacen_isolation_slugs`, `realtime_pilot_slugs`): se puede empezar por uno y apagar el otro sin tocar nada.

## 4. Servidor

Acción nueva, **al lado** de las existentes (que no cambian):

```
POST ?action=save-parked-reservation-ops
{
  slug, cajaId, ticketId, codalmacen, parkingMode/modoMesas,   // identifican documento y tabla
  clientOpId,                                                  // para idempotencia
  ops: [ { type, lineId?, data, expectedLineRev? }, … ]
}
→ 200 { data: <documento resultante, mismo formato que hoy>, applied: [...], conflicts: [...] }
```

- Una sola transacción por petición, `FOR UPDATE` sobre la fila; se aplican las ops en orden; se recalcula `total`, `updated_at` y se regenera `items_json`.
- **Conflictos por operación**, no por documento: si una op toca una línea que cambió desde `expectedLineRev`, esa op se devuelve en `conflicts` con el valor actual; las demás se aplican. El cliente decide (normalmente gana el valor del servidor y se avisa solo si de verdad se perdió algo del usuario).
- Si el pedido ya está pagado, `closingInProgress` de otro terminal, o la fila no existe → mismas reglas que hoy (candado anti-"descobrar", 410/412 equivalentes). Las operaciones **no pueden saltarse** las protecciones de cobro.
- Notificación en tiempo real (relay) tras éxito, igual que ahora.
- Auditoría: un evento `parked-ops` con tipos de operación y recuento (sin contenido).
- `clientOpId` + tabla pequeña de ops recientes (o clave en memoria con TTL) para devolver el mismo resultado si llega repetida.
- Límite de tamaño y de nº de ops por petición; el límite de peticiones por minuto se ajusta (cada petición es mucho más pequeña).

## 5. Cliente (`renderer.js`)

- **Identidad estable de línea (paso 1, hecho)**: `_lineId` se conserva al cargar un pedido, ids repetidos se rehacen, líneas sin id reciben uno que se anota en el pedido. Sin esto no se puede casar una línea entre carrito, servidor y otros dispositivos.
- Punto único de guardado nuevo que **compara el carrito con la última versión confirmada por el servidor** (por `lineId`) y produce la lista de operaciones. Sustituye a las ~16 llamadas actuales a `apiSaveParkedReservation`.
- Decide por cliente/modo si habla el protocolo nuevo o el de siempre (activación desde el servidor, no desde la versión de la app, para poder encender y apagar sin release).
- Reutiliza la cola de reintento existente: las ops se encolan igual que hoy los documentos, y por ser idempotentes se reintentan sin riesgo.
- La app de camareros no cambia: sigue con las acciones de siempre.

## 5b. Operaciones implementadas (v1)

`line-add`, `line-qty-delta`, `line-set`, `line-remove`, `header-set` (ticketName, obs, clientName, codcliente, mesaAlerts en Mesas), `comanda-commit` (comandaState + sellos de envío; solo Mesas). Solo operan sobre un pedido que **ya existe**; crear el pedido sigue siendo el guardado entero de siempre. El `total` lo manda el cliente (tarifas y descuentos se calculan allí); si falta, el servidor calcula uno aproximado.

Respuesta: `{ok, data: <pedido resultante>, applied: [índices], conflicts: [...], duplicate}`; `409 {opsDisabled}` si el cliente/modo no está activado (el TPV sigue con el guardado entero); `404 {missing}`; `200 {paid}`.

Pruebas del servidor (`tools/parked_ops_test.php`, `tools/parked_ops_concurrency_test.php`): 16 casos de motor + 6 procesos en paralelo sumando +1 a la misma línea (60 operaciones → cantidad exacta) + HTTP extremo a extremo + auditoría (`parked-ops`).

## 5c. Cliente (estado 2026-10-16)

- `js/tpv/parked-ops.js`: parte pura (diff → operaciones, aplicar operaciones, reconciliar remoto con local, id de petición determinista por dispositivo+pedido+base+operaciones). Probada en `tools/tests/run-parked-ops-tests.js` (13 casos, incluida una simulación de dos dispositivos contra un servidor en memoria y 300 casos aleatorios de ida y vuelta). Corre dentro de `npm test`.
- `renderer.js`: `buildParkedSavePayload` (el documento de siempre), `tryParkedOpsSave` (compara con la **base** = última versión confirmada del servidor y manda la diferencia), `parkedOpsReconcileRemoteIntoMerged` (al refrescar integra lo remoto sin pisar lo local pendiente, y avanza la base), y la integración del carrito en `mergeMissingRemoteLinesIntoCart`.
- **Activación**: `list-parked-reservations` devuelve `features.parkedOps {mesas, tpv}` para el cliente; sin eso el TPV no usa operaciones. **Interruptor de emergencia local**: `localStorage.setItem("tpv_parkedOpsDisabled","1")`.
- **Cae al guardado entero** si: no hay base (primer guardado), líneas sin `_lineId` o repetidas, cambia algo que las operaciones no cubren (mesa, división, cobro, tipo de documento…), el pedido está cobrado o ya no existe, o el servidor no lo tiene activado.
- **Base tras un guardado**: base anterior + *mis* operaciones (no la respuesta, que puede traer cambios ajenos aún sin integrar). Versiones del servidor más viejas que la base se ignoran (se compara la marca con microsegundos).
- Encontrado de paso: el guardado entero **no mandaba** `sentBatchAt`, `sentAt/sentPart/sentBy` ni `comandaHeld`, y cada autoguardado los borraba del servidor (arreglado, `acf4b85`).
- Prueba de extremo a extremo contra el servidor real del demo (pedido de prueba, ya borrado): creación por guardado entero → siguientes cambios por operaciones → sin cambios no manda nada → cambios de "otro dispositivo" (+2, línea nueva, línea quitada) se integran sin perder lo local y el siguiente guardado manda solo lo propio.
- Ruido conocido: una línea creada por otro dispositivo con menos campos genera un `line-set` inofensivo con los campos que este TPV completa del catálogo.

## 5d. Prueba con dos TPV reales (2026-10-16)

`tools/tests/run-two-tpv-ops.js` (Mesas, mesa M3) y `tools/tests/run-two-tpv-ops-normal.js` (TPV normal, aparcados): dos instancias reales a la vez contra el demo. Escenarios: cambios a la vez en líneas distintas, +1 simultáneo a la misma línea (de 2 pasa a 4) y quitar-contra-editar (gana quitar; el otro registra `line-missing`). En los dos modos los dos carritos convergen sin perder nada. Hallazgo: los borradores compartidos del plano (copia del carrito en el layout) pisaban el carrito del otro dispositivo; en modo operaciones no se escriben ni se aplican para una mesa con pedido guardado.

## 6. Pasos

0. ✅ **Identidad estable de línea** (`e441821`).
1. ✅ **Servidor**: `save-parked-reservation-ops` desplegado y probado; funciona para las dos tablas, activo solo en `demo`/Mesas.
2. ✅ **Cliente**: guardado por diferencia + reconciliación; protocolo nuevo solo si el servidor lo activa; fallback al guardado entero.
3. **Prueba en demo con 2 TPV reales a la vez** (cada uno tocando líneas distintas de la misma mesa y la misma línea a la vez), y lo mismo en TPV normal. Incluye: cobro mientras otro edita, borrar mesa, mover/fusionar mesas, división de cuenta, reintento sin red.
4. Activar TPV normal en demo; después **un cliente piloto** (Asador el Gallo, por Mesas) con interruptor de apagado inmediato; vigilar el audit log varios días.
5. Extender al resto.

## 7. Riesgos y cómo se cubren

| Riesgo | Mitigación |
|---|---|
| Bug en el motor de operaciones borra líneas de un cliente real | Piloto por slug y por modo; `items_json` siempre guardado completo tras cada op; copia de seguridad previa de la fila en cada cambio durante el piloto (mismo patrón que la red de seguridad del plano) |
| Dos dispositivos con versiones distintas de la app | Las acciones de siempre siguen funcionando indefinidamente; el protocolo nuevo es opcional por cliente |
| Cobro mientras llegan operaciones | Mismas protecciones que hoy; ops rechazadas si pagado/cierre en curso |
| Orden de operaciones entre dispositivos | Cada op es valor completo + versión de lo que toca; el servidor serializa con la fila bloqueada |
| Aumento de peticiones | Cada una mucho más pequeña; el cliente agrupa cambios rápidos (como ya hace el plano de Mesas con 350 ms) |
| Estados ya contaminados (líneas duplicadas, ids repetidos) | El paso 1 ya rehace ids repetidos al cargar; el motor trata `lineId` repetido como error recuperable y lo normaliza |

## 8. Fuera de alcance (por ahora)

- Tabla propia de líneas (se puede añadir luego si `items_json` se queda corto).
- Plano de Mesas (salas/mesas) — se queda con su guardado actual; sus problemas son distintos.
- Cobro: no cambia.

## 9. Decisiones que necesito

1. ¿Empezamos por **Mesas en demo** (más concurrencia, donde duele) y luego TPV normal? (propuesto)
2. ¿Primer cliente piloto = **Asador el Gallo** (Mesas, 2 TPV reales)? (propuesto, tras varios días en demo)
3. ¿Se acepta que, en un conflicto real sobre la *misma* línea, **gane el servidor** y se avise al usuario solo si perdió algo suyo?
