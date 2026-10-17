# Contratos API — implementación actual

**Fuente de verdad:** código en `server/app.ts`, `server/domain.ts`, `server/validation.ts`, `server/auth.ts`, `server/schema.sql` y `server/migrations/002_controls.sql`, contrastado con `frontend/App.tsx`, `frontend/DriverDocumentsPanel.tsx`, `frontend/MaintenancePanel.tsx` y `frontend/ReturnOperations.tsx`. Este documento describe lo que está presente en el workspace; no afirma que el build, las pruebas o la operación hayan pasado.

Las rutas viven bajo `/api`. La mayoría de las operaciones protegidas devuelve el resultado JSON del dominio directamente. Los identificadores de recursos son UUID. Las mutaciones requieren `X-Requested-With: logistics-os`; las llamadas de UI conservan la cookie de sesión. Los comandos de dominio llevan un UUID `commandId` y quedan sujetos a idempotencia por organización, actor, operación y cuerpo. Las operaciones que modifican una ruta validan su `expectedVersion` en el servidor.

## Sesión y estado inicial

| Método y ruta | Solicitud | Resultado/notas |
|---|---|---|
| `GET /api/health` | — | `{ status: "ok", database: "postgres" o "sqlite", tracking }`; comprueba acceso a la base seleccionada. Tracking indica configuración, no conectividad verificada. |
| `GET /api/session` | — | `{ user, setupRequired }`; `user` es `null` si no hay sesión. |
| `POST /api/setup` | `{ organizationName, timezone, username, password }` | Crea una única organización y su usuario `ADMIN`; la zona horaria debe ser válida. Devuelve `{ id }` y establece cookie de sesión `HttpOnly`. |
| `POST /api/login` | `{ username, password }` | Devuelve `{ id }` y establece cookie de sesión. Contraseña de cuenta nueva: 12–128 caracteres; usuario: 3–80 caracteres. |
| `POST /api/logout` | — | Borra la sesión y devuelve `{ ok: true }`. |
| `GET /api/bootstrap` | — | Colecciones iniciales y estado de tracking; hasta 500 elementos por colección. Incluye `driverDocuments`; cada devolución incluye `depotEvidenceId` y, cuando existe, `senderEvidenceId`. Las vistas de chofer se limitan a rutas y recursos asignados. |

`GET /api/shipments?limit=25&offset=0` pagina envíos (máximo 100 por solicitud); `GET /api/shipments/:id` devuelve un envío autorizado. Los filtros y límites se aplican en servidor.

## Altas operativas

Todas estas altas aceptan `commandId` UUID además de los campos indicados. El backend devuelve el objeto de resultado del dominio, normalmente `{ id }`.

| Método y ruta | Solicitud validada |
|---|---|
| `POST /api/clients` | `{ commandId, name }` |
| `POST /api/users` | `{ commandId, name, username, password, role }`; `role` es `OPERATIONS` o `DEPOT`, solo `ADMIN`. |
| `POST /api/drivers` | `{ commandId, name, username, password }`; crea el chofer y su usuario `DRIVER`. |
| `POST /api/vehicles` | `{ commandId, plate, capacityWeightGrams, capacityVolumeCm3, odometer }` |
| `POST /api/shipments` | `{ commandId, clientId, reference, originText, destinationText, recipientName, recipientPhone, parcelCount, weightGrams, volumeCm3, proofPolicy }` |
| `POST /api/receipts` | `{ commandId, shipmentId, codes, location }`; `codes` es una lista no vacía. Resultado incluye `received` y `alreadyReceived`. |

`parcelCount` acepta de 1 a 200. `weightGrams` y `volumeCm3` aceptan un entero positivo o `null`; una ruta no puede aprobarse mientras cualquiera de esas medidas sea desconocida. `proofPolicy` admite `RECEIVER` o `RECEIVER_PHOTO`. El sistema genera un código por bulto al crear el envío.

## Rutas, carga y ejecución

| Método y ruta | Solicitud validada | Resultado/guarda |
|---|---|---|
| `POST /api/routes` | `{ commandId, name, driverId, vehicleId, startAt, endAt }` | Devuelve `{ id, version, state: "DRAFT" }`; fechas ISO con zona y fin posterior al inicio. |
| `POST /api/routes/:id/assignments` | `{ commandId, expectedVersion, parcelIds, pickup? }` | `pickup` por defecto `false`; devuelve nueva versión. Los retiros directos se asignan desde custodia del remitente. |
| `POST /api/routes/:id/stops/order` | `{ commandId, expectedVersion, stopIds }` | Guarda el orden manual; debe contener cada parada exactamente una vez. No calcula distancias ni ETA. |
| `POST /api/routes/:id/ready` | `{ commandId, expectedVersion }` | Comprueba carga/capacidad y medidas conocidas. |
| `POST /api/routes/:id/load-scans` | `{ commandId, expectedVersion, code }` | Escanea un bulto del manifiesto y actualiza custodia. |
| `POST /api/routes/:id/dispatch` | `{ commandId, expectedVersion }` | Requiere plan y ventana válidos, manifiesto cargado, inspección dentro de la ventana, chofer/vehículo disponibles, sin defectos críticos abiertos, documentos impeditivos de vehículo o chofer vencidos ni mantenimiento vencido. |
| `POST /api/stops/:id/pickups` | `{ commandId, expectedVersion, codes }` | Registra retiro directo de los códigos asignados a esa parada. |
| `POST /api/stops/:id/attempts` | `{ commandId, expectedVersion, deliveredParcelIds, failedParcelIds, receiverName?, evidenceIds?, reasonCode?, nextAction? }` | La versión corresponde a la ruta. `reasonCode`: `ABSENT`, `REFUSED`, `ADDRESS_ISSUE`, `DAMAGED`, `OTHER` o vacío. Entregas requieren receptor; fallos requieren motivo y próxima acción. Si la política es `RECEIVER_PHOTO`, requiere foto guardada para cada bulto entregado. |
| `POST /api/routes/:id/close` | `{ commandId, expectedVersion }` | Cierra solo una ruta en curso sin paradas abiertas ni asignaciones activas. Estado: `OPERATIONALLY_CLOSED`. |

Las asignaciones, reordenamientos, preparación, carga, despacho, retiros, intentos y cierre validan la versión de la ruta. Una versión antigua devuelve `VERSION_CONFLICT`. El plan comprueba capacidad de peso y volumen por tramo y precedencias entre retiro y entrega; el orden es manual.

## Incidencias, devoluciones, flota y evidencia

| Método y ruta | Solicitud validada | Estado |
|---|---|---|
| `POST /api/incidents/:id/authorize-return` | `{ commandId }` | Autoriza un retorno abierto que corresponda a un bulto fallido. |
| `POST /api/returns/:id/receive` | `{ commandId, location, evidenceId }` | Registra custodia en depósito con evidencia fotográfica asociada al bulto y libera la asignación activa. La evidencia queda en la etapa `DEPOT`. |
| `POST /api/returns/:id/depot-evidence` | `{ commandId, evidenceId, note }` | Solo `ADMIN`/`OPERATIONS`. Subsanación auditada de retornos legacy en `AT_DEPOT` sin evidencia de depósito; exige una foto del mismo bulto, guarda la nota y conserva la recepción original. No admite sobrescribir una evidencia existente. |
| `POST /api/returns/:id/send-to-sender` | `{ commandId, receiverName, evidenceId }` | Requiere evidencia del mismo bulto y una foto cuya SHA-256 sea distinta de la etapa `DEPOT`; registra la etapa `SENDER` y completa el retorno al remitente. |
| `POST /api/vehicles/:id/inspections` | `{ commandId, odometer, fuelPercent, items: [{ label, severity, note? }] }` | `severity`: `OK`, `MINOR`, `CRITICAL`; el odómetro no puede retroceder. La inspección genera defectos para severidades distintas de `OK`. |
| `POST /api/vehicles/:id/documents` | `{ commandId, name, expiresAt, blocksDispatch }` | El documento marcado impeditivo bloquea despacho al vencer. |
| `POST /api/vehicles/:id/maintenance` | `{ commandId, description, dueAt?, dueOdometer? }` | El servidor requiere fecha o kilometraje de vencimiento. La UI ofrece alta del mantenimiento. |
| `POST /api/maintenance/:id/complete` | `{ commandId, evidenceId, note }` | Cierra mantenimiento abierto con foto guardada y nota; la UI permite cargar la foto y registrar el cierre. |
| `POST /api/defects/:id/resolve` | `{ commandId, evidenceId, note }` | Resuelve defecto abierto con evidencia. |
| `POST /api/drivers/:id/documents` | `{ commandId, name, expiresAt, blocksDispatch }` | `ADMIN`/`OPERATIONS`. Registra el requisito indicado por operaciones; no presupone una licencia o requisito legal universal. Admite registrar fechas vencidas. Si `blocksDispatch` es `true`, su vencimiento bloquea el despacho. |
| `POST /api/driver-documents/:id/renew` | `{ commandId, expiresAt }` | `ADMIN`/`OPERATIONS`. La nueva fecha debe ser futura y posterior a la vigente. Cada alta y renovación registra evento con actor, fecha anterior (nula al crear), fecha nueva y `commandId`. |
| `POST /api/evidence` | `{ commandId, parcelId?, filename, mimeType, dataBase64 }` | Solo JPEG, PNG o WebP; máximo 5 MiB decodificados y firma del archivo validada. Devuelve `{ id, state: "STORED" }`. |
| `GET /api/evidence/:id` | — | Entrega la imagen inline si el actor puede consultar el recurso y su organización. |

## Tracking y límites actuales

El conector QuadMinds está preparado, deshabilitado por defecto y pendiente de contrato/credenciales. `GET /api/routes/:id/tracking` consulta la posición actual del vehículo vinculado cuando se configura; conserva permisos de ruta y responde `503 INTEGRATION_NOT_CONFIGURED` sin configuración. `POST /api/tracking/sessions/:id/points` permanece bloqueado. Estado de configuración no equivale a conexión validada. Ver [contrato completo y activación](QUADMINDS.md), incluyendo `GET /api/integrations/quadminds` y `POST /api/vehicles/:id/tracking-binding`.

Inventario, importaciones y portal autenticado se documentan en [INVENTORY_API.md](INVENTORY_API.md). Los contratos ampliados de órdenes, rutas, webhooks y comprobantes QuadMinds están en [QUADMINDS.md](QUADMINDS.md). Finanzas y offline propio no forman parte de esta entrega; la conexión real con el proveedor sigue pendiente.

## Seguridad, validación y errores observados

- La sesión se transporta en una cookie `HttpOnly`, `SameSite=Strict`, con expiración de 12 horas. La organización se deriva del actor autenticado; las lecturas y mutaciones aplican ámbito de organización y reglas de rol.
- Toda mutación `/api` verifica `X-Requested-With: logistics-os` y valida el origen cuando se envía `Origin`.
- Los endpoints de dominio transaccionales usan `commandId` UUID; si se repite con mismo actor, operación y cuerpo, devuelven el resultado anterior. Otro contenido con la misma clave devuelve conflicto `DUPLICATE_COMMAND`.
- Errores usan `{ error: { code, message, details? } }`. Se manejan `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_TRANSITION`, `VERSION_CONFLICT`, `DUPLICATE_COMMAND`, `CAPACITY_EXCEEDED`, `EVIDENCE_REQUIRED`, `INTEGRATION_NOT_CONFIGURED` e `INTERNAL_ERROR`.
- El parser JSON acepta hasta 8 MiB. La carga de evidencia tiene además los límites de tamaño y formato indicados arriba.

