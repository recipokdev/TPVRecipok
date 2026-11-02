# Recomendaciones sobre el plugin WooStockWebhook

*Fecha: 28-oct-2026. Preparado para decidir qué hacer con el plugin que avisa a la tienda online (WooCommerce) cada vez que cambia el stock en FacturaScripts.*

## 1. Qué hace

Cada vez que cambia el stock de un producto en FacturaScripts, el plugin envía un aviso a la tienda web del cliente con la cantidad nueva. Hoy lo tienen activo Asador el Gallo y a_reciplus (y está instalado, sin activar, en la demo).

## 2. Problemas encontrados (medidos esta semana)

| # | Problema | Dato |
|---|----------|------|
| 1 | **Escribe dos líneas de registro en cada petición** al servidor, sin que haga falta | En Asador, la tabla de registros tiene 6,4 millones de filas y 795 MB; el 97 % es este ruido. La demo llegó a 516 MB. |
| 2 | **Espera a la tienda online dentro de cada cambio de stock** (llamada síncrona, hasta 5 s de espera) | Cada aviso tarda ~0,7 s. Una venta de Asador tarda de media 5 s (hasta 10 s) con solo ~2 líneas; en la demo, sin el aviso activo, 10 líneas tardan 0,2 s. |
| 3 | **No reintenta ni guarda cola** | Si la web está caída o lenta, ese cambio de stock se pierde y la tienda online queda con un número equivocado, sin que nadie lo vea. |
| 4 | **Avisa de cada paso intermedio** | Nuestro TPV baja y sube el stock al aparcar y cobrar; cada movimiento dispara un aviso (muchas llamadas por venta) y la web llega a ver cifras que enseguida se corrigen. |

## 3. Riesgos para el negocio

- **Ventas más lentas** en el cliente (el cajero espera).
- **Facturas duplicadas:** si el cobro se alarga, el TPV se cansa de esperar y reintenta. Ya ocurrió con facturas gemelas; hoy hay protección, pero conviene no depender de ella.
- **Stock de la web desincronizado** y sin aviso.
- **Base de datos inflada** (copias de seguridad más pesadas, consultas lentas sobre esa tabla).

## 4. Recomendaciones, por orden

**A. Inmediato (bajo riesgo, esta noche)**
- Quitar las dos líneas de registro innecesarias del plugin y limpiar los registros acumulados. La herramienta de limpieza ya está hecha y probada en la demo (516 MB → 138 MB, 27 s). Se aplica en Asador y a_reciplus con copia previa y fuera de horario.

**B. Corto plazo: rehacer el envío con cola (el arreglo de fondo)**
- Al cambiar el stock, el plugin solo **apunta el cambio** en una tabla pequeña (milésimas de segundo, sin esperar a nadie).
- Un proceso en segundo plano (cada pocos segundos) envía a la web **el último valor de cada producto**, juntando cambios repetidos, y **reintenta con espera creciente** si falla.
- Solo se registran los **errores**.
- Opcional: un pequeño estado visible («pendientes de enviar», «último envío correcto») y un botón para reenviar todo.
- Resultado esperado: las ventas dejan de esperar a la web, no se pierden avisos y la tienda se actualiza a los pocos segundos.

**C. Decisiones de funcionamiento (a valorar)**
- Enviar solo los productos que realmente están en la tienda online.
- Decidir si la web debe ver el stock «reservado» por los pedidos aparcados o solo el stock real tras cobrar.

**D. Mantenimiento**
- Limpieza automática semanal de registros en los clientes que usen el plugin y, si se quiere, una retención general de registros.
- Alerta si la tabla de registros de un cliente supera un tamaño (por ejemplo, 200 MB).

**E. Instalaciones nuevas**
- Actualizar el plugin en la plantilla de FacturaScripts para que los clientes nuevos no lo reciban con el problema.

## 5. Plan de pruebas y despliegue

1. Probar la versión nueva en la **demo** con una web simulada lenta y otra caída (que no bloquee ventas y que reenvíe).
2. Medir antes y después en Asador: objetivo, **venta de ~2 líneas en menos de 1,5 s** (hoy ~5 s) y **ningún aviso perdido**.
3. Desplegar fuera de horario, con copia previa del plugin, primero en un cliente.

## 6. Qué necesitamos decidir

- ¿Es aceptable que la web se actualice con unos segundos de retraso (por ejemplo, hasta 10 s)?
- ¿Qué otros clientes van a usar WooCommerce en el futuro?
- Parte del tiempo del aviso puede ser que la web receptora (WordPress) responda lenta: ¿quién la gestiona, para revisarla también por su lado?

## 7. Estado actual

- Limpieza y silenciado del plugin: hechos y verificados en la demo; **previstos esta noche en Asador y a_reciplus**.
- Cola de envío: **pendiente de aprobación**.
