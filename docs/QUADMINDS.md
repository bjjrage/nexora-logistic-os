# Integración inicial con QuadMinds

**Alcance del cliente (15-10-2026):** el [plan operativo](PLAN_OPERATIVO_CLIENTE.md) requiere inventario conectado con pedidos/rutas y uso obligatorio de la app de QuadMinds para GPS y entrega con foto y firma. El conector ampliado ya tiene código y pruebas con fixtures; depende de confirmar cuenta, funciones contratadas y acceso técnico para activarse. Consultar la [entrega y límites actuales](ENTREGA_INVENTARIO_Y_QUADMINDS.md).

Preparación local del 15 de octubre de 2026. Las operaciones y el GPS están deshabilitados por defecto. No se han probado contra una cuenta real ni se ha confirmado el endpoint de posiciones. Las secciones de GPS siguientes describen el conector de lectura; la ampliación operativa tiene contratos separados.

## Órdenes, rutas y comprobantes

La integración utiliza la API SaaS v2 en `https://saas.quadminds.com/api/v2`: creación de órdenes, búsqueda por código estable y consulta de rutas consolidadas. La planificación/optimización y publicación se realizan en QuadMinds; Nexora importa la secuencia para rutas borrador y sincroniza resultados. Cada orden vinculada representa una unidad física. No hay una llamada a optimización automática desde Nexora confirmada por cuenta.

| Contrato local | Uso |
|---|---|
| `GET /api/quadminds/operations` | Configuración, cola, rutas y eventos; ADMIN/OPERATIONS. |
| `POST /api/quadminds/shipments/:shipmentId/queue` | Preparar órdenes; `commandId`, `poiId`, `date`. |
| `POST /api/quadminds/parcels/:id/bind` | Vincular orden existente; código/ID externo, destino y fecha. |
| `POST /api/quadminds/routes/:id/bind` | Vincular ID de ruta publicada. |
| `POST /api/quadminds/process` | Procesar cola limitada, con recuperación previa por código. |
| `POST /api/quadminds/routes/:id/sync` | Conciliar resultados y opcionalmente importar secuencia con `applySequence`. |
| `GET /api/quadminds/shipments/:shipmentId/proofs` | Estado de resultado/evidencia y referencias privadas del envío autorizado. |
| `GET /api/customer-evidence/:id` | Bytes privados; cliente autenticado propietario o rol interno autorizado. |
| `POST /api/quadminds/webhook` | JSON crudo firmado HMAC-SHA256/base64 en `Quadminds-Signature`; eventos duplicados no duplican efectos. |
| `GET /api/jobs/quadminds-sync` | Invocación acotada por scheduler externo con Bearer `CRON_SECRET`; programación todavía no activada. |

Configurar en servidor `QUADMINDS_OPERATIONS_ENABLED`, `QUADMINDS_ORG_ID`, `QUADMINDS_API_KEY`, `QUADMINDS_WEBHOOK_SECRET`, `QUADMINDS_PROOF_HOSTS`, `QUADMINDS_DELIVERED_CODES`, `QUADMINDS_FAILED_CODES` y `QUADMINDS_CONSTRAINTS` según la cuenta. Los códigos de resultado y los IDs de dimensiones no se adivinan. Ver `.env.example` para formatos. El GPS tiene configuración independiente.

Un resultado comunicado sin foto/firma completas queda pendiente de certificación. El cierre exige comprobantes del mismo bulto, foto y firma con contenido distinto y receptor identificado. Las descargas validan TLS y DNS público fijado, hosts HTTPS autorizados, tamaño y tiempo; no siguen redirecciones. Los webhooks sin comprobantes no hacen una entrega final por sí solos. Fallos/retornos conservan custodia y pasan por cuarentena e inspección. Todas estas verificaciones están cubiertas con fixtures; falta probar la cuenta y los celulares reales.

## Cuenta y acceso

La API pública documenta una clave asociada a un usuario de la plataforma, enviada mediante `x-saas-apikey`: [autenticación oficial](https://docs.quadminds.com/reference/autenticaci%C3%B3n). Necesitamos acceso autorizado a la cuenta que contiene los vehículos. QuadMinds debe confirmar si corresponde una cuenta propia de Nexora o credenciales de integración autorizadas por el titular de otra cuenta. La documentación general no confirma el acceso al tracking del plan contratado.

Pedir a QuadMinds:

- Producto y cuenta donde están los vehículos; habilitación de lectura de posiciones por API.
- Endpoint HTTPS de consulta, método, autenticación y ejemplo de respuesta anonimizado.
- Identificador estable del vehículo, latitud, longitud y fecha/hora **de medición** con zona horaria.
- Frecuencia de transmisión, límite de consultas, paginación y significado de valores ausentes.
- Un vehículo de prueba y si ofrecen webhooks, para evaluar una segunda etapa.

## Preparado en el proyecto

- Conector en `server/quadminds.ts`, autenticación únicamente en el servidor, timeout y límite de respuesta de 2 MB. No sigue redirecciones ni devuelve mensajes internos del proveedor.
- Migración SQLite v3: vinculación única por vehículo y última posición persistente. Editar o quitar una vinculación borra su última posición. Las ediciones tienen auditoría e idempotencia.
- Permisos de organización y ruta existentes; solo Administración y Operaciones editan vínculos. El chofer consulta las rutas que tiene asignadas.
- Consultas bajo demanda; caché y deduplicación por vehículo dentro de una instancia. No hay cron ni sincronización continua. Si se despliega en varias instancias, se debe coordinar el límite de consultas con almacenamiento compartido.
- Pantalla Tracking: vinculación, consulta de una ruta, fecha de medición/recepción, posición desactualizada, errores y enlace a OpenStreetMap. Actualiza solo la ruta seleccionada mientras la pestaña está visible. No contiene un mapa embebido ni historial GPS.
- No se generan posiciones ficticias. Los fixtures de la suite son aislados y no llegan al OS.

La posición mostrada es la posición **actual del vehículo asociado**, incluso al seleccionar una ruta histórica; no demuestra dónde estaba ese vehículo durante esa ruta ni dónde está físicamente cada bulto.

## Activación cuando llegue la documentación

1. Copiar `.env.example` a `.env`, que está excluido de Git. Los procesos de `server/index.ts` cargan ese archivo; las variables ya definidas en el entorno tienen prioridad.
2. Completar `QUADMINDS_ORG_ID` con el ID de la organización local (`organization.id` en `/api/bootstrap`). Una clave solo atiende esa organización; no se comparte implícitamente con otros clientes.
3. Completar `QUADMINDS_POSITION_URL` con el endpoint **confirmado**. Puede incluir `{vehicleId}` en ruta o query; si devuelve toda la flota, puede ser una URL fija. Solo se implementó GET con `x-saas-apikey`; otra autenticación, paginación u otro método requiere adaptar el conector.
4. Completar `QUADMINDS_API_KEY` localmente en el servidor. No pegar claves en el chat ni usar variables `VITE_`.
5. Completar `QUADMINDS_FIELDS` con un JSON de rutas de campos: `vehicleId`, `latitude`, `longitude`, `measuredAt`. `QUADMINDS_ITEMS_PATH` señala el objeto/lista contenedor o queda vacío si la posición/lista está en la raíz.
6. Ajustar intervalo, timeout y umbral de antigüedad según el acuerdo; activar `QUADMINDS_ENABLED=true` y reiniciar el servidor. Configuración incompleta devuelve `INVALID_CONFIGURATION`, sin efectuar llamadas.
7. En Tracking, vincular la matrícula local con el ID externo confirmado y seleccionar una ruta de ese vehículo.
8. Validar con un vehículo real en movimiento; detener transmisión y comprobar antigüedad, probar una caída de acceso y recuperación. Configuración presente no significa conexión real validada.

Ejemplo **exclusivamente didáctico**, no representa el contrato de QuadMinds: si la respuesta fuera `{"data":[{"id":"QM-1","gps":{"lat":-25.3,"lng":-57.6},"time":"2026-10-15T12:00:00Z"}]}`, se usaría:

```dotenv
QUADMINDS_ITEMS_PATH=data
QUADMINDS_FIELDS='{"vehicleId":"id","latitude":"gps.lat","longitude":"gps.lng","measuredAt":"time"}'
```

El adaptador requiere coordenadas numéricas finitas, un ID coincidente y timestamp ISO con zona horaria. Rechaza mediciones más de un minuto en el futuro y nunca sustituye la hora de medición por la hora de consulta. Si el proveedor usa strings numéricos, epoch u otra forma, se adapta después de confirmar unidades/formato. No admite listas paginadas automáticamente; no declarar vehículos ausentes sin revisar esa condición.

## API interna

| Endpoint | Resultado y autorización |
| --- | --- |
| `GET /api/integrations/quadminds` | Estado sin secretos y vínculos de la organización. ADMIN/OPERATIONS. |
| `POST /api/vehicles/:id/tracking-binding` | `{commandId, externalVehicleId}`; `null` quita el vínculo. ADMIN/OPERATIONS, CSRF e idempotencia. |
| `GET /api/routes/:id/tracking` | Acceso de la ruta, `provider`, `scope`, `position`, `status`, `sourceError`, `checkedAt`, `ageSeconds` e intervalos. |

`position` contiene `latitude`, `longitude`, `measuredAt` y `receivedAt`, o `null`. `status` es `FRESH`, `STALE` o `NO_POSITION`. Una caída devuelve la última medición con `STALE` y error de fuente; sin medición previa devuelve `NO_POSITION` y `position:null`. La UI también calcula antigüedad cuando no logra consultar al servidor.

Los errores de acceso/configuración usan los estados HTTP habituales: 401/403/404; 503 `INTEGRATION_NOT_CONFIGURED`; 409 `TRACKING_VEHICLE_NOT_LINKED` o `TRACKING_BINDING_CHANGED`. Fallas upstream se expresan en `sourceError` (`TRACKING_PROVIDER_ERROR`, `TRACKING_TIMEOUT`, `TRACKING_INVALID_RESPONSE`, `TRACKING_NO_POSITION`) para conservar la última posición sin aparentar actualización exitosa.

`POST /api/tracking/sessions/:id/points` permanece bloqueado: el GPS propio y los webhooks requieren un contrato separado. La interfaz y los estados normalizados pueden reutilizarse posteriormente.

## Verificación

`npm test` cubre el circuito existente y fixtures QuadMinds, sin llamar al proveedor. `npm run build` verifica TypeScript y genera la interfaz. Los resultados de la corrida se registran en `INFORME_QA.md`; no equivalen a aceptación de una integración real ni a autorización de producción.
