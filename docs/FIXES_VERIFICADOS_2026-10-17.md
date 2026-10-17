# Fixes y verificación — 17 de octubre de 2026

El OS ahora tiene repositorio propio privado: https://github.com/bjjrage/nexora-logistic-os. La web pública mantiene su repositorio independiente. `.env`, `.local`, bases SQLite, cachés, capturas de operación y credenciales están excluidos del repositorio del OS.

## Estado de los hallazgos

| Hallazgo | Resultado | Evidencia / límite |
| --- | --- | --- |
| H-01: tests de rutas detenidos por políticas GPS faltantes | Corregido | Fixtures positivos declaran su circuito mediante la misma API de dominio. Suite local: **103/103**. La concurrencia llega al conflicto de recursos y produce una ruta READY y otra DRAFT. |
| H-02: QuadMinds sin configurar | Pendiente de Universo | El responsable confirmó el 17-10 que todavía no recibió endpoint/contrato ni credencial. Se conserva el bloqueo explícito; no se inventó una cuenta ni una posición. |
| H-03: proveedor inferido del nombre Universo | Corregido y migrado | Política y protección asociadas a `org_id` + `client_id`; sin comparación por nombre en reglas de ejecución ni panel. Una FK impide alterar la política protegida desde SQL y runtime solo puede leer el bloqueo. |
| H-04: endpoint de puntos GPS que siempre devolvía 503 | Corregido | Retirada la ruta no soportada. Una sesión válida recibe 404; el ingreso vigente continúa por Traccar/Railway. Tests de contrato actualizados. |
| H-05: alertas de índices FK | Revisado; medición con volumen pendiente | Se verificaron índices existentes por envío, ruta, bulto, parada, chofer y vehículo. El aviso de cobertura compuesta no implica que esas búsquedas carezcan de todo índice. No se añadieron 85 índices sin medir. |
| H-06: futuras tablas públicas sin permisos explícitos | Guardia agregada | `npm run check:migrations` revisa RLS, REVOKE y GRANT en tablas públicas creadas por las migraciones versionadas. La guardia tiene casos positivos/negativos y se ejecuta en CI. No sustituye revisar privilegios efectivos. |

## Datos y compatibilidad

La migración `supabase/migrations/20261017033354_stable_client_providers.sql` está aplicada; el historial de aplicación llega a la versión 10. La excepción antigua por nombre se usa solo una vez para convertir los datos legacy. La migración rechaza identidades ambiguas o una política contradictoria en vez de adivinar. En la instancia real se protegió un cliente, Universo, conservando sus IDs y sus datos operativos.

La tabla privada `client_delivery_locks` tiene RLS. `nexora_runtime` tiene SELECT y no UPDATE/DELETE; `anon`, `authenticated` y el trabajador GPS carecen de lectura. Las pruebas cubren renombre, homónimo, otra organización, rollback de una migración ambigua y persistencia tras reinicio.

Los clientes creados después de la migración requieren circuito explícito. Llamarlos Universo no les otorga una política ni una excepción. La DEMO recién generada también declara su circuito; no se debilitaron los controles para hacer pasar los tests.

## Verificaciones

- `npm test`: **103 aprobadas, 0 fallidas**, SQLite, dominio y HTTP.
- `npm run build`: **PASS**, TypeScript y Vite.
- `npm run check:migrations`: **PASS**, guardia estática de permisos.
- `npm run test:postgres`: **10 aprobadas, 0 fallidas**, PostgreSQL real, roles, integridad y circuitos con rollback (334,13 s). Incluye los nuevos bloqueos privados de proveedor.
- Traccar Railway: `/health` y `/diagnostics` devuelven 200 y conectado; alta de dispositivo sin autorización devuelve 401. Esto prueba la pasarela, no el GPS de un celular físico.
- La verificación visual por navegador no se obtuvo en esta corrida: el controlador no logró abrir la instancia QA local. La prueba HTTP del contrato y el build sí pasaron.

Las pruebas remotas se ejecutan en serie. Sus historias mantienen una organización ficticia dentro de una transacción de rollback; ejecutarlas en paralelo introduce esperas por el bloqueo compartido de comandos y no representa una prueba limpia del escenario. No se usa esta corrida como benchmark de producción.

CI en `.github/workflows/ci.yml` ejecuta instalación por lockfile, secretos, migraciones, tests y build al hacer push a `main` y en pull requests. Las pruebas de PostgreSQL real requieren la configuración privada y no se ejecutan en GitHub sin ese entorno.

## Índices y autenticación

Se confirmó en PostgreSQL la presencia de `parcels_shipment_idx`, `route_assignments_route_idx`, `custody_events_parcel_idx`, `attempts_stop_idx`, `routes_driver_idx` y `routes_vehicle_idx`. Las estadísticas observadas tienen poco volumen y no permiten cerrar un objetivo de rendimiento. La revisión debe continuar con consultas y datos de piloto; tampoco se eliminan índices porque un asesor todavía no haya observado uso.

El asesor de seguridad posterior a la migración no encontró fallas de RLS; conserva el aviso de [protección contra contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). El login operativo usa scrypt. El flujo Supabase Auth encontrado en la web usa OAuth de Google; no se encontró alta/login con contraseña Supabase en este código. Si se incorpora ese flujo, se debe habilitar y validar esa protección antes de publicarlo.

## Uso remoto y aceptación pendiente

`HOST` ahora es configurable. Mantiene `127.0.0.1` por defecto; un alojamiento con proxy HTTPS puede configurar `HOST=0.0.0.0`, `PORT`, `NODE_ENV=production`, conexión PostgreSQL privada, cookies seguras y orígenes permitidos. Subir el código a GitHub no despliega el servidor OS.

Siguen pendientes la credencial/contrato QuadMinds, la aceptación de un celular físico con segundo plano y recuperación de señal, el benchmark con volumen y el despliegue remoto del OS si el equipo lo necesita. No corresponde declarar operación integral aceptada mientras falten esas pruebas.
