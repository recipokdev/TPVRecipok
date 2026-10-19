# Resumen para el próximo release (pendiente, NO publicado)

Estado a 2026-10-16. Última versión publicada: **0.2.48**. Todo lo de abajo está commiteado en `main`
(38 commits desde `v0.2.48`, ~2.700 líneas tocadas, casi todo `renderer.js`), `npm test` en verde, y
sin lanzar `stable:patch`. Las entradas ya están en el changelog "actual" (23 puntos).

## 1. Qué verá cualquier cliente con Modo Mesas (no depende del servidor)

Rehecho del carrito / comanda en Modo Mesas (cambios 1-16 del changelog):

- Barra grande **"Enviar comanda"** (solo si hay algo por enviar): contador, envío de un toque, cuenta
  atrás y pausa de la comanda automática, icono ✎ para la observación. Se quita el botón pequeño "Comanda".
- **Lo ya enviado** va arriba en gris, agrupado por envío ("Enviado · hora · Comanda N · agente"), en un
  bloque plegable (se pliega solo desde 4 líneas). Lo pendiente va debajo de la raya naranja; los productos
  que no van a cocina, aparte ("No va a cocina").
- Tocar líneas ya enviadas pide confirmación; subir la cantidad de una línea enviada crea una línea nueva
  debajo; bajar quita primero la nueva; devoluciones a cocina avisadas en el siguiente envío.
- **Comanda automática con espera** (por defecto 60 s, configurable en Opciones → Mesas, 0 = al instante),
  con cuenta atrás y pausa que congela el tiempo. Con la opción apagada no cambia nada.
- **Vaciar** ya no quita lo enviado a cocina.
- Se conservan al guardar el "camarero", los sellos de cada comanda y el estado "retenido" (antes se
  borraban en el servidor con cada autoguardado) y la cabecera de comanda sobrevive al reiniciar.
- Avisos menos alarmistas al abrir el programa ("Carrito recuperado…", "El diseño de Mesas se actualizó…").
- Cambiar de mesa ahora se guarda en el servidor y el otro TPV/app lo ven (antes solo local); fusionar mesas no borra el pedido si origen y destino eran el mismo.
- Arreglos que valen para todos: primer producto de una mesa libre ya no desaparece si llega un refresco
  justo entonces; el pedido en posición 0 de la lista ya carga bien; las partes al dividir cuenta llevan
  slug/caja (no salen duplicadas); si otro TPV cobra el pedido abierto, el carrito se limpia (evita doble
  cobro); cierre de caja valida el nick (0.2.48 ya lo traía, sin cambios).

## 2. Solo activo en el demo (el servidor lo tiene apagado para los demás clientes)

Guardado de pedidos **por operaciones** + candado de cobro + turno de comanda + aviso "mesa en uso".
El cliente nuevo ya incluye todo el código, pero se comporta "como siempre" salvo que el servidor lo
active para el cliente (lista `parked_ops_pilot_slugs_mesas` / `_tpv` en `config.php`, hoy `['demo']`):

- Guardado por partes (añadir línea, ±cantidad, quitar, cabecera) con la fila bloqueada; conflictos
  inofensivos entre TPV (se suman cantidades, gana quitar); reintentos tras fallo de red sin doble conteo.
- Candado de cobro entre dispositivos (423 si otro TPV está cobrando).
- Auto-comanda con 2 TPV: el servidor decide cuál imprime (`parked-comanda-claim`).
- Aviso suave "Ana (Barra) tiene esta mesa abierta" (`mesa-viewer`). Solo informa.
- Líneas sin `_lineId` (app de camareros) se reconocen y se sellan en el servidor.

**Servidor ya desplegado** (con copia `*.bak-*` y `php -l`): `index.php` (acciones `save-parked-reservation-ops`,
`parked-closing`, `parked-comanda-claim`, `mesa-viewer`), `lib/parked_reservations_ops_db.php`,
`lib/parked_reservations_db.php`, `config.php`. Nuevas tablas: `parked_ops_applied`,
`parked_comanda_claims`, `parked_mesa_viewers`. Un cliente con la versión vieja sigue funcionando igual.

## 3. Qué mirar antes de lanzar (en tu PC, `npm start`)

1. Modo Mesas: abrir una mesa, añadir productos, ver la barra "Enviar comanda", enviar, comprobar lo gris
   y el bloque plegable; subir la cantidad de una línea enviada; Vaciar con enviados.
2. Opciones → Mesas: espera de la comanda automática (probar 0 y un valor).
3. Dividir cuenta y cobrar una mesa (cobro normal, sin cambios esperados).
4. Con 2 instancias (`npm run test:2tpv`) y el demo: aviso de "mesa en uso" y comanda que sale una sola vez.
5. Un cliente SIN piloto no debe mostrar el aviso de mesa en uso ni llamar a las acciones nuevas.

## 4. Riesgos y lo que NO está probado

- Diff grande en `renderer.js`: lo más sensible es el carrito/comanda de Modo Mesas, que **llega a todos los
  clientes con Mesas** (Asador el Gallo, Lumi, etc.). Probado en el demo y con pruebas automáticas, no en un
  cliente real.
- Probado ya con 2 TPV reales: mover y fusionar mesas (arreglado: el cambio de mesa no se guardaba en el servidor), cambiar entre mesas ocupadas con ops (arreglado un pisado de líneas, solo con ops activo).
- Sin probar: la **app de camareros real** (solo simulada con peticiones
  crudas), y Android/tablet.
- Un pedido que entra desde la app lo imprime el primer TPV que pide turno tras 3 s sin cambios (con el
  turno activo, solo piloto).
- Limitación conocida: si el TPV se reinicia con un lote de operaciones "en duda" se pierde ese recuerdo y
  el siguiente guardado va entero.
- Activar ops/turno/aviso para un cliente real (p. ej. Asador el Gallo) es un paso aparte, con interruptor
  de apagado: no forma parte de este release.

## 5. Para lanzar (lo haces tú)

`stable:patch` asigna la versión (0.2.49) al bloque "actual" del changelog. Después: comprobar la
actualización en un TPV real y avisar a tu jefe de que actualice (0.2.48 tampoco la tiene aún si no abrió
el programa).
