# Correcciones de la auditoría E2E — 17 de octubre de 2026

Base auditada: `8ec4bcb5523028762e7376814e5aabbfd84fca71`. Informe de origen: `INFORME_AUDITORIA_E2E_SIN_GPS_QUADMINDS_2026-10-17.md`. Los hallazgos originales eran estáticos; se agregaron reproducciones ejecutables y se verificaron los cambios con datos sintéticos. GPS/Traccar y QuadMinds permanecieron fuera de la revisión y no se llamaron servicios de esos proveedores. La suite general conserva sus fixtures existentes de proveedores; solo se adaptaron sus INSERT de usuarios a columnas explícitas por compatibilidad de esquema.

## Hallazgos principales

| ID | Corrección | Regresión |
| --- | --- | --- |
| H1 | Estado `users.enabled`, suspensión/reactivación desde Equipo interno y API exclusiva de Administración. Suspender elimina sesiones y enlaces de recuperación asociados o emitidos por la cuenta; login y lectura de sesión exigen cuenta activa. Se conserva la identidad y el historial. Se impide la autosuspensión y dejar la organización sin Administración. La recuperación tampoco habilita una cuenta suspendida. | HTTP: un empleado no puede suspender, cookie anterior deja de autorizar, login y recuperación se rechazan, reactivar exige ingreso nuevo. PostgreSQL comprueba migración y revocación. Navegador: alta, suspensión y reactivación. |
| H2 | Las lecturas de bulto, envío, evidencia, bootstrap y custodia del chofer usan la última asignación del bulto. El último responsable conserva su historial al terminar una entrega; una reasignación revoca al anterior. No se usó `active=1` como único filtro porque ocultaría las entregas recién completadas. | Dominio y HTTP: anterior responsable recibe 403 al leer envío/evidencia; los listados excluyen el bulto reasignado. PostgreSQL prueba el mismo criterio con `_sequence`. |
| H3 | Un único control suma toda la custodia real del vehículo, sin depender de ventanas planificadas ni de la ruta actual. Se aplica al cargar por ruta, cargar desde Pedidos, retirar en origen y despachar. Incluye fallidos y carga de otras jornadas. | Casos de peso y volumen, despacho de carga legacy, carga desde pedido y dos cargas concurrentes. Una operación rechazada no cambia custodia ni reserva. |
| H4 | Registrar un resultado admite solo paradas pendientes/parciales y bultos en tránsito. Volver a visitar un fallo requiere la acción explícita **Habilitar nuevo intento** (`POST /api/stops/:id/retry`), con rol y versión de ruta. No permite reabrir devoluciones autorizadas. La nueva visita mantiene intentos, custodia y evidencia anteriores. | Reenviar un fallo con otro commandId no duplica intentos/custodia. Parada parcial, rol inválido y devolución autorizada se rechazan. El recorrido falla → habilitar → entregar conserva ambos resultados. |
| H5 | Solo se persisten como REJECTED los errores deterministas de negocio/validación. Un fallo técnico o conflicto transitorio revierte la transacción y deja libre el mismo commandId. Si otro reintento ya confirmó el lote entre la consulta inicial y el preview, se devuelve ese resultado confirmado. | Fallo inyectado una vez en la escritura del historial para JSON y CSV: cero pedidos/envíos/historial tras el fallo; reintento e idempotencia correctos. Intercalación concurrente determinista devuelve el resultado ganador. |
| H6 | Los ajustes de disponible requieren ubicación activa y fuera de cuarentena; las altas también requieren producto activo. No se permite convertir un sector con stock en cuarentena usando edición de ubicación. Dedupe de bajas serializadas compara la serie, no la identidad del objeto JSON. | Ajustes por cantidad y serie en ubicaciones inválidas sin efectos; series repetidas son VALIDATION_ERROR; movimientos/ajustes/archivo y cambios de tipo preservan saldo e historial. |
| H7 | XLSX con SKU/barcode numérico no representable como entero seguro produce error por fila, también cuando tiene máscara de ceros. El catálogo no se modifica. Los identificadores grandes recibidos como texto conservan sus dígitos. | Preview inválido e importación rechazada conservan el código anterior; un código CSV textual mayor que 2^53 permanece intacto. |

## Observaciones menores del informe

- Se confirmó y corrigió la posibilidad de introducir SKU/códigos de barras ambiguos en altas/ediciones directas o importaciones, incluso con diferencias de mayúsculas. El criterio coincide con el lookup del escáner y se valida dentro del comando transaccional. Los códigos de unidad serializada también se comprueban en el alta/edición directa.
- Se corrigió el texto de paginación del bootstrap que mostraba signos de interrogación en lugar de tildes.
- Las dudas sobre reactivación automática de SKU archivado no establecen un comportamiento deseado: importar datos de catálogo no reactiva automáticamente stock/productos. No se cambió esa regla por inferencia.
- El formulario de subsanación de evidencia de retorno existe en `ReturnOperations`, para retornos AT_DEPOT sin evidencia y un rol autorizado; el servidor conserva un endpoint y pruebas de la corrección legacy. No se confirmó la supuesta inaccesibilidad.
- Los IDs del portal no son credenciales. Su presencia aislada no demuestra acceso a datos ajenos; se mantienen las comprobaciones de membresía y organización.
- El informe no aportó una regla que prohíba a Depósito/Coordinación consultar la auditoría operativa de su propia empresa. No se alteraron permisos de lectura por esa suposición.
- La unicidad global del usuario de acceso puede informar colisión a Administración en un alta autorizada. El riesgo de enumeración por tiempo de login no fue medido ni se certifica corregido en esta entrega.

## Entornos y verificaciones

- `tests/e2e-audit-fixes.test.ts`: 16 regresiones de estos hallazgos, exclusivamente SQLite efímero y HTTP local.
- `tests/postgres.audit-fixes.ts`: historia sobre PostgreSQL local `nexora_test`, guardada por validación de host/base y completamente revertida. La suite aislada incluye 14 historias.
- `tests/e2e/operation.spec.ts`: ampliado con alta/suspensión/reactivación y visita fallida seguida de reintento explícito y foto. El servidor E2E elimina DATABASE_URL y deshabilita los proveedores externos; usa una base en memoria.
- Las verificaciones de los recorridos de negocio se hacen en pruebas aisladas. No se crean clientes, usuarios, pedidos, entregas ni coordenadas ficticias en producción.

## Migración y publicación

- SQLite: migración `014_staff_access.sql`; PostgreSQL: `20261017200518_staff_access.sql` y el índice complementario `20261017200712_driver_assignment_history.sql`, creados mediante CLI y reconciliados con las versiones registradas por Supabase. La versión de aplicación queda en 14. Se añade una columna con valor inicial activo, sin borrar usuarios ni cambiar sus roles. El índice por organización/bulto/secuencia respalda la comprobación de última asignación.
- Los INSERT de usuarios usan columnas explícitas para permitir la ampliación del esquema sin romper fixtures históricos ni los campos generados de PostgreSQL.
- Respaldo privado previo: `.local/backups/2026-10-17T19-58-31-779Z`, 59 tablas, checksum SHA-256 `c6e37eb55f59a46587d2562c8484b90d6293cf6364f55472c40c29c6a308355c`. El dump y sus datos están excluidos de Git.
- La consulta de asesores anterior al cambio mantuvo un aviso ya existente de Supabase Auth sobre [contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). El OS usa sesiones propias/scrypt; esta entrega no cambia el producto Supabase Auth.

## Resultados de cierre

| Comprobación | Resultado |
| --- | --- |
| Suite de dominio/HTTP y regresiones | **133/133 PASS**, cero omitidas. Incluye 16 casos nuevos del informe. |
| PostgreSQL aislado | **14/14 PASS**; la historia nueva se reejecutó tras el último ajuste de importaciones y volvió a pasar. |
| TypeScript + Vite | **PASS**. |
| Migraciones y escaneo de secretos | **PASS**. |
| Navegador: guía | Dos escenarios completados con PASS. |
| Navegador: operación ampliada | **2/2 PASS** en la corrida final: cliente/catálogo/recepción/sesión/equipo y fallo/reintento/foto/entrega/conciliación/cierre. |
| Base productiva | Migración aplicada; `users.enabled` NOT NULL/default 1, RLS conservada, runtime autorizado y `anon` sin lectura. Índice complementario aplicado. Se verificaron metadatos, no datos comerciales. |

Las primeras ejecuciones del nuevo test de navegador encontraron selectores de prueba demasiado estrictos en etiquetas con contenido auxiliar/opciones; se ajustaron los localizadores al nombre accesible sin quitar aserciones del flujo. En Windows, tras completar los tests, el runner quedó esperando el cierre del servidor efímero: se verificó su PID/comando y se cerró únicamente ese proceso, tras lo cual Playwright confirmó `2 passed` y exit 0. No se finalizó ningún servicio operativo.

El resultado de esta corrección no certifica ausencia de cualquier otro bug ni agrega validación de GPS o QuadMinds. No hubo una prueba autenticada con datos comerciales sobre la aplicación productiva; las historias de negocio se probaron en entornos aislados.
