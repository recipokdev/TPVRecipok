# Privacidad, fase 1: sustituir la descarga pública de `clients.json`

Estado: **DISEÑO PARA APROBAR** (25-nov-2026). No se ha tocado nada en producción.

## 1. El problema

`https://plus.recipok.com/tpv/clients.json` se descarga sin identificarse y contiene el email, el nombre interno y la clave de
FacturaScripts de **32 clientes**. Está así por diseño: el TPV lo baja para saber qué empresa corresponde al email con el que se activa.
En 10 días de logs nadie ajeno lo ha descargado, pero cualquiera que lo encuentre tiene acceso total a los datos de todos los clientes.

## 2. Lo que se ha comprobado (solo lectura)

- **Quién lo descarga por web:** solo el TPV (todas las versiones desde la 0.2.64 hasta la 0.2.72, unas 1.900 veces en 8 días), la
  tablet Android de pruebas (mismo código del TPV) y nuestras comprobaciones con `curl`. **Ni el CRM ni el backend de Recipok ni la app
  de camareros lo leen por web.**
- **Cuándo lo descarga el TPV** (`renderer.js`): en cada arranque **dos veces** (`bootstrapCompany`: una para localizar el email y otra
  para refrescar la clave con `resolveCompanyByEmail`), al activar un TPV nuevo y en la autocuración de claves
  (`tryAdoptNewServiceKey`, cuando la clave deja de valer). Esa segunda descarga del arranque es lo que hace que **una clave nueva se
  propague sola a todos los TPV**: hay que conservarla.
- **Qué usa del fichero:** solo `email`, `active`, `slug` y `apiKey`. Lo de Mesas sale de otro sitio (`features`).
- **Qué lee el servidor:** `clients.json` se lee desde disco en decenas de sitios (PHP del servidor). **Eso no cambia**: solo se
  elimina la descarga pública.
- **Ya existe** un limitador de peticiones (`applyRateLimit($config, $bucket, $sujeto, $limite, $ventanaSeg)`) y `getRequestIp()`.
- `tpv_users.php` y `tpv_login.php` ya funcionan «por email» y sin clave (el primero devuelve los nombres de los usuarios de ese
  email). Se dejan igual en esta fase.

## 3. Idea

En lugar de descargar la lista entera, el TPV pregunta **por un solo email** y el servidor contesta solo con esa entrada, con límite de
frecuencia. Así se pasa de «cualquiera se lleva las 32 claves sin saber nada» a «hay que conocer el email exacto de un cliente, y se
puede intentar muy pocas veces».

## 4. El servicio nuevo: `resolve-company`

`POST /tpv/api/index.php?action=resolve-company` con cuerpo JSON `{"email": "..."}` y la cabecera `X-TPV-API-KEY` de siempre.
El email va en el cuerpo y **no en la URL** (para que no quede en los logs de acceso).

| Respuesta | Cuándo |
|---|---|
| `200 {ok:true, status:"active", slug, apiKey}` | el email existe y está activo |
| `200 {ok:true, status:"inactive"}` | existe pero `active=false` (cliente de baja) |
| `200 {ok:true, status:"unknown"}` | no existe |
| `400` | email vacío o con formato inválido |
| `429` + `Retry-After` | demasiadas peticiones |

- **¿Por qué distinguir «inactive» de «unknown»?** El TPV hoy se comporta distinto: un email de baja muestra «Cuenta desactivada» y
  bloquea; un email desconocido al activar pide revisarlo, y uno guardado que ya no aparece mantiene lo guardado. Si fueran idénticos,
  un cliente de baja seguiría con su configuración. Lo único que se filtra es «este email fue cliente alguna vez», mucho menos que hoy.
- **Límites propuestos** (`applyRateLimit`, a ajustar): por IP 60 peticiones cada 10 min; por email 20 cada 10 min; y como máximo
  10 respuestas `unknown` por IP cada hora. Un arranque normal hace 1 petición, así que una oficina con varios TPV queda muy por debajo.
- **Auditoría:** solo se anotan `unknown`, `inactive` y los 429 (no cada acierto, para no llenar el registro). Del email se guarda un
  resumen (hash), no el texto.
- **Mismo formato de siempre:** el TPV sigue construyendo `https://plus.recipok.com/<slug>/api/3` a partir del `slug`.

## 5. Cambios en el TPV (`renderer.js`)

Un único ayudante `resolveCompanyRemote(email)` que sustituye a los 4 usos de `fetchClientsJson`:
1. **Arranque con empresa guardada:** pasa de 2 descargas a **1 petición** y conserva el refresco de la clave.
2. **Activación:** el modal de email llama al servicio; `unknown` → «Email no encontrado»; `inactive` → «Acceso bloqueado».
3. **Autocuración:** mismo servicio.
4. **Sin conexión o error:** igual que hoy cuando no se podía cargar el fichero («No hay conexión… reconectando»), sin pedir el email.
- **Respaldo durante la transición:** si el servidor responde que la acción no existe (404 o `unknown action`), el TPV usa el
  `clients.json` de siempre. No se usa respaldo ante errores de red ni ante 429. **Se elimina en la fase 2.**
- **Android:** usa el mismo `renderer.js`, así que el cambio llega con su próxima APK (falta confirmarlo con esa sesión).

## 6. Orden de despliegue y marcha atrás

1. **Servidor primero:** añadir la acción nueva (no afecta a nadie, porque ningún cliente la llama aún). Copia de `index.php`,
   `php -l`, pruebas con `curl` y `health.sh`. Marcha atrás: quitar la acción.
2. **TPV:** implementarlo con pruebas y publicarlo en una versión normal. Marcha atrás: los TPV nuevos caen solos al fichero.
3. **Esperar a que todos los clientes actualicen.** Sussu, que sigue en la 0.2.65 o anterior, es el caso difícil.
4. **Fase 2** (más adelante): versión mínima, cerrar `clients.json` y rotar las claves.

## 7. Qué NO resuelve esta fase

**Por sí sola no cierra nada:** `clients.json` sigue público hasta la fase 2. Es solo la preparación para poder cerrarlo sin romper
ningún TPV. Y quien conozca el email exacto de un cliente sigue pudiendo pedir su clave (con límites). Una mejora posible, para la
fase 3, es un código de activación de un solo uso generado desde el CRM en lugar de depender solo del email.

## 8. Pruebas previstas

- **Servidor (CLI y `curl`):** activo, de baja, desconocido, email inválido, límites por IP / por email / de desconocidos, y que
  `clients.json` sigue sirviéndose igual.
- **TPV (batería):** adaptar la prueba «Servicio desactivado» (`run-service-suspended.js`, hoy simula `clients.json`) para que simule
  el servicio: clave cambiada → se adopta sola; de baja → bloqueo; desconocido; 429; sin conexión; y el respaldo al fichero cuando la
  acción no existe. Más una comprobación de que el arranque hace 1 sola petición.
- **Prueba conjunta** con la tablet Android antes de publicar.

## 9. Decisiones que necesito de ti

1. ¿Te parece bien **distinguir «inactive» de «unknown»** (recomendado) o prefieres respuestas idénticas aunque haya que cambiar el
   comportamiento con los clientes de baja?
2. ¿Valen los **límites propuestos** (60/10 min por IP, 20/10 min por email, 10 desconocidos/hora)?
3. ¿Dejamos el **código de activación** para la fase 3 (recomendado) o lo metemos ya?
4. ¿Les paso este documento al **CRM, a la app de camareros y al port Android** para que lo revisen antes de implementar?

## 10. Revisión del CRM (25-nov-2026) y cómo se recoge

El CRM confirma que **no lee `clients.json` por web** (solo `list-clients`, `create-client`, `update-client`… por `tpv/api`, con la clave
compartida) y que ningún flujo suyo necesita el fichero descargable ni distingue `inactive` de `unknown`. Observaciones aceptadas:
- `resolve-company` lee `clients.json` desde disco y **la `apiKey` de la respuesta no se escribe nunca** en ningún registro
  (`audit_log`, `tpv_audit.log`, logs de errores).
- **El TPV debe respetar `Retry-After`** tras un 429 (no reintentar en bucle).
- **El email se compara exacto**, normalizado igual que `tpv_login.php` (minúsculas y sin espacios, nada más). Los emails con
  `+` (`sergi+bateria@…`) son distintos entre sí y no se recortan.
- Para otra fase: que `tpv/api` compruebe también `active` en `ensureClientExists` (hoy un cliente de baja con clave válida seguiría
  pasando esa comprobación).
- Tras la fase 2, **confirmar con quien mantiene el backend de Recipok** (`82.165.207.161`) que no depende del fichero.

## 11. Revisión de la app de camareros y del port Android (25-nov-2026)

**App de camareros:** no usa `clients.json`, ni emails, ni `resolve-company`; el slug sale solo del emparejamiento por código. **No le
afecta ni la fase 1 ni la 2.** Sin objeciones. Aportan dos cosas importantes:
- **La clave compartida `X-TPV-API-KEY` va compilada en la app, y Sergi va a subir la app a Google Play (AAB 1.2.29).** Cuando esté
  publicada, cualquiera podrá bajar el APK y sacar esa clave. Como `resolve-company` exige esa cabecera, **la clave no protege nada**:
  la protección real es solo «conocer el email exacto + límites de frecuencia». **Sube la prioridad de la fase 3** (código de activación
  de un solo uso). Por eso no se promete más de lo que da esta fase (ver §7).
- La app manda esa clave también en la URL del WebSocket del relé (`?key=…&slug=…`), que puede quedar en los logs de acceso: apuntado
  para la fase 3.
- Si en la fase 2 se **rota la clave compartida** (no solo las claves de FacturaScripts), las apps instaladas dejan de funcionar hasta
  actualizar; habrá que **aceptar dos claves a la vez** durante la transición y avisar antes. Rotar solo las `apiKey` de FacturaScripts
  por cliente no les afecta.

**Port Android:** `renderer.js` va **empaquetado dentro de la APK** (no se carga de ningún sitio) y no existe aún el endpoint de
actualización por internet, así que **el cambio solo llega a una tablet cuando se instala una APK nueva** (3-4 pasos manuales suyos:
fusionar `main` en su rama, `npm run sync`, `publish-android.js`, y `bundlePlay` para Google Play). Las llamadas actuales a
`tpv/api` con la cabecera propia ya funcionan con CapacitorHttp, así que el POST JSON de `resolve-company` viaja igual (el cuerpo
debe ser un string JSON). **Las 648 peticiones eran de sus emuladores**, no de una tablet real; APK repartidas, pocas y todas internas.
- **Condición para la fase 2:** la APK **no tiene puerta de actualización obligatoria ni aviso de «servicio desactivado»**; si se
  cierra `clients.json`, las APK viejas **no podrán activar ni entrar**. Acordado: ellos sacan una APK/AAB nueva con
  `resolve-company` cuando el renderer esté en `main`, y **avisamos antes de quitar el respaldo** para que repartan la APK nueva.
