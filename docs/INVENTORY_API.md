# API de inventario y pedidos

La API usa la sesión existente de Nexora. Las mutaciones requieren `commandId` como UUID; la misma clave, actor, operación y cuerpo devuelve el resultado original sin repetir el efecto. Reutilizar una clave con otro contenido devuelve `DUPLICATE_COMMAND`. Cada operación de inventario actualiza sus saldos, unidades, ledger y registro de idempotencia dentro de una transacción.

## Permisos

| Operación | ADMIN / OPERATIONS | DEPOT | CUSTOMER | DRIVER |
|---|---:|---:|---:|---:|
| Consultar inventario, pedidos y exportar CSV | Sí | Sí | Sí, limitado al cliente de la sesión | No |
| Descargar plantilla, previsualizar e importar catálogo | Sí | No | No | No |
| Crear/editar productos y ubicaciones | Sí | No | No | No |
| Recibir, mover, ajustar, reservar, cargar, recibir retornos y liberar | Sí | Sí | No | No |
| Crear/importar pedidos | Sí | No | No | No |

Para `CUSTOMER`, el servidor ignora `clientId` de query/body al consultar y usa exclusivamente `actor.clientId`. Si la sesión no tiene un cliente asociado, la lectura se rechaza. El rol `DRIVER` no tiene acceso a snapshots organizacionales.

## Inventario

`GET /api/inventory` devuelve `{ products, locations, balances, units, movements }`. Un cliente puede pedir `GET /api/inventory?clientId=...`, pero el filtro efectivo siempre proviene de la sesión. `GET /api/inventory/export.csv` genera el mismo ámbito de permisos, sin truncar unidades serializadas; el CSV incluye tipo de registro, propietario, producto, ubicación, estado, custodia, pedido, cantidad y, para cada serie, `serial` y `barcode`.

El control de producto usa `tracking: "QUANTITY"` para artículos por cantidad o `tracking: "SERIAL"` para unidades identificables. Un barcode de producto puede compartirse entre unidades. Para seriales, cada unidad tiene un número de serie único por producto/cliente y un barcode opcional único en la organización.

| Endpoint | Body relevante |
|---|---|
| `POST /api/inventory/products` | `{ commandId, clientId, sku, barcode?, name, tracking, unit?, weightGrams?, volumeCm3? }` |
| `PATCH /api/inventory/products/:id` | `{ commandId, sku?, barcode?, name?, unit?, weightGrams?, volumeCm3?, active? }` |
| `POST /api/inventory/locations` | `{ commandId, code, name, kind: "DEPOT" \| "STORAGE" \| "QUARANTINE" }` |
| `PATCH /api/inventory/locations/:id` | `{ commandId, code?, name?, kind?, active? }` |
| `POST /api/inventory/receipts` | `{ commandId, clientId, productId, locationId, quantity, serials?, reference?, reason? }` |
| `POST /api/inventory/movements` | `{ commandId, clientId, productId, quantity, fromLocationId, toLocationId, serials?, reason? }` |
| `POST /api/inventory/adjustments` | `{ commandId, clientId, productId, locationId, quantityDelta, serials?, reason }` |

`serials` es obligatorio con una entrada por unidad en recepción/ajuste positivo SERIAL y con series distintas al mover o ajustar a la baja. El ajuste siempre requiere motivo. Las ubicaciones con stock activo no se pueden archivar; productos y ubicaciones se archivan con `active:false`, no se borran físicamente.

Los saldos por cantidad distinguen `AVAILABLE`, `RESERVED`, `VEHICLE` y `QUARANTINE`; las unidades serializadas además pueden quedar `DELIVERED` o `ADJUSTED`. `inventory_movements` es un ledger append-only: una corrección posterior genera otro movimiento, nunca reescribe el historial.

## Importación masiva de catálogo

El catálogo se importa por cliente y SKU; el lote actualiza únicamente productos. No registra stock, recepciones, saldos, series ni movimientos. El permiso corresponde a `ADMIN` y `OPERATIONS`.

| Endpoint | Uso |
|---|---|
| `GET /api/inventory/catalog/template.csv` | Descarga una plantilla CSV con encabezados `SKU,Nombre,CodigoBarras,Seguimiento,Unidad,PesoKg,VolumenM3`. |
| `POST /api/inventory/catalog/preview` | Valida el contenido sin escribir cambios. |
| `POST /api/inventory/catalog/import` | Revalida y aplica el lote en una transacción; requiere `commandId` UUID. |

El preview y la importación reciben uno de estos formatos JSON:

```json
{ "clientId": "UUID", "csv": "SKU,Nombre,Seguimiento\nSKU-001,Tostadora,Por cantidad" }
```

```json
{ "clientId": "UUID", "filename": "catalogo.xlsx", "contentBase64": "..." }
```

La importación agrega `commandId`. Si el archivo no incluye seguimiento para SKU nuevos, se puede elegir un valor explícito para todo el lote: `defaultTracking: "QUANTITY"` o `defaultTracking: "SERIAL"`. El seguimiento de una fila lo reemplaza; el valor predeterminado nunca cambia el seguimiento de un SKU existente. Sin columna, seguimiento por fila ni valor predeterminado, el SKU nuevo se marca con error.

El preview responde `{ valid, rowCount, createCount, updateCount, unchangedCount, rows, rowErrors, ignoredColumns }`. `rowCount` cuenta filas de productos, sin encabezado. Cada elemento de `rows` incluye `{ row, sku, name, barcode, tracking, unit, weightGrams, volumeCm3, action }`; `action` puede ser `CREATE`, `UPDATE`, `UNCHANGED` o `ERROR`. Cada `rowErrors` contiene `row`, `field` opcional y `message`. `ignoredColumns` enumera encabezados desconocidos, como Marca, Modelo, Precio o Stock, que se omiten y no modifican ningún dato. Una importación exitosa agrega `imported: true`; un lote inválido devuelve error y no aplica ninguna fila.

Se aceptan aliases en español e inglés: `SKU`/`codigoProducto`/`productCode`, `Nombre`/`name`/`descripcion`, `codigoBarras`/`barcode`/`EAN`/`UPC`, `seguimiento`/`tracking`, `unidad`/`unit`, `pesoKg`/`weightKg` o `pesoGramos`/`weightGrams`, y `volumenM3`/`volumeM3` o `volumenCm3`/`volumeCm3`. Los pesos en kg se convierten a gramos enteros (hasta 3 decimales de kg) y los volúmenes en m³ a cm³ enteros (hasta 6 decimales de m³). El CSV admite coma, punto y coma o tabulación como separador, BOM UTF-8, comillas y campos multilínea. En Excel se acepta `.xlsx`; los códigos numéricos con formato de ceros, por ejemplo `000000`, conservan los ceros mostrados. No se aceptan celdas con fórmulas.

El archivo puede pesar hasta 5 MiB y contener hasta 10.000 productos y 32 columnas. SKU es obligatorio; nombre también. Los códigos de barras no pueden duplicarse entre productos del mismo cliente ni colisionar con el barcode de una unidad serializada de la organización. El upsert usa `org_id + client_id + sku`; conserva el ID, fecha de creación y modo de seguimiento existente. Los errores, incluida una colisión, invalidan el lote completo. Repetir `commandId` con el mismo actor y cuerpo devuelve el resultado guardado; otro contenido o actor produce `DUPLICATE_COMMAND`.

Para ingresar mercancía después de importar, usá `POST /api/inventory/receipts`: elegí cliente y ubicación, escaneá el SKU/código de barras y confirmá el lote de recepción. Importar el catálogo nunca crea existencias automáticamente. Para productos por cantidad, cada lectura agrega una unidad; para productos serializados, se debe leer la etiqueta individual de cada unidad. Un lector HID USB que emula teclado puede enviar el código seguido de Enter; no se probó hardware físico.

## Pedidos diarios

`GET /api/orders` o `GET /api/orders/read` devuelve `{ items }`; `GET /api/orders/:id` devuelve el pedido con sus líneas y parcels. Cada línea tiene `requested`, `reserved`, `loaded`, `delivered` y `returned`. El parcel expone su código individual, producto, serie opcional, estado y resultado/evidencia de entrega QuadMinds. Las cuentas cliente ven únicamente pedidos de su `clientId`.

`POST /api/orders` crea un pedido JSON:

```json
{
  "commandId": "UUID",
  "clientId": "UUID del cliente Nexora",
  "externalId": "PED-2026-1042",
  "orderDate": "2026-10-15",
  "destination": "Dirección de entrega",
  "recipientName": "Nombre del receptor",
  "recipientPhone": "",
  "originText": "",
  "windowStart": "09:00",
  "windowEnd": "12:00",
  "serviceMinutes": 30,
  "restrictions": "",
  "lines": [{ "productId": "UUID del producto del mismo cliente", "quantity": 2 }]
}
```

El pedido vincula un `shipmentId` legacy con la referencia externa, destinatario y destino. Para asegurar el cierre con foto y firma, los pedidos de inventario usan `proofPolicy: "RECEIVER_PHOTO"`; no se admite desactivar esta política.

`POST /api/orders/import` acepta JSON `{ commandId, orders: [...] }` o `{ commandId, csv: "..." }`. El CSV requiere cabeceras `clientId,externalId,orderDate,destination,recipientName,quantity` y una de `sku` o `productId`. Admite también `recipientPhone,originText,proofPolicy,windowStart,windowEnd,serviceMinutes,restrictions`. Cada combinación `clientId + externalId` forma un solo pedido; las filas del mismo pedido agregan cantidades por producto. Si las filas discrepan en fecha, dirección, contacto, ventana, restricciones o política de comprobante, se rechaza el archivo completo. El cliente del SKU debe coincidir con `clientId`. Un pedido externo ya importado se informa como duplicado y no crea un segundo shipment.

La importación crea instrucciones y líneas, pero no aumenta stock. `POST /api/orders/:id/reserve` acepta `{ commandId, locationId? }` y reserva todas las unidades solicitadas o ninguna. Una vez comprobado el stock completo, se crea un parcel logístico por unidad reservada dentro del mismo shipment; así la ruta y QuadMinds pueden reconciliar entregas parciales por unidad, incluido cada serial.

## Ruta, carga y retorno

Cada parcel del pedido se asigna a la parada de entrega existente por los endpoints de rutas. El envío se encola/vincula a QuadMinds usando el `shipmentId`, que contiene los parcels individuales.

`POST /api/orders/:id/load` acepta `{ commandId, routeId, expectedVersion, codes }`. La ruta debe estar en `READY`, con versión vigente y los parcels asignados. `codes` puede contener códigos individuales de parcel, series o barcode compartido de producto. El mismo barcode de modelo puede repetirse para cargar unidades distintas; volver a escanear una misma unidad dentro del comando se rechaza. La operación actualiza la custodia logística y el ledger en una transacción.

Las entregas y fallas se registran por el endpoint legacy de intento de parada con resultados sincronizados desde QuadMinds. Para parcels de inventario, el intento manual queda bloqueado hasta que `quad_parcel_links` confirme el resultado y, para una entrega, la evidencia esté completa. La foto y firma se conservan como `evidence` vinculadas por `quad_proofs`; deben pertenecer al parcel y tener hashes distintos. No existe un endpoint de inventario para fabricar o declarar esos comprobantes.

`POST /api/orders/:id/return` recibe uno o más retornos ya autorizados:

```json
{
  "commandId": "UUID",
  "locationId": "UUID de ubicación de cuarentena",
  "returns": [{ "returnId": "UUID de retorno", "evidenceId": "UUID de foto de recepción" }]
}
```

Cada devolución debe pertenecer a un parcel del pedido, estar autorizada y seguir en custodia del vehículo. La foto de recepción debe ser evidencia existente del mismo parcel. La unidad se incorpora a cuarentena, no a disponibilidad. `POST /api/orders/:id/release` libera después de inspección a una ubicación activa que no sea cuarentena:

```json
{ "commandId": "UUID", "locationId": "UUID de ubicación disponible", "reason": "Inspección aprobada", "parcelIds": ["UUID de parcel"] }
```

Puede seleccionarse por `parcelIds` o `serials`. Las unidades solo vuelven a disponible después de esta liberación, que añade su propio movimiento al ledger. La serie devuelta y liberada puede reservarse más adelante; la unicidad de serie se aplica únicamente a vínculos de reserva activos y el historial anterior queda conservado como `RELEASED`.

## Estados principales

- Pedido: `DRAFT`, `RESERVED`, `PARTIALLY_LOADED`, `LOADED`, `IN_TRANSIT`, `PARTIAL`, `DELIVERED`, `CANCELLED` o `EXCEPTION`.
- Unidad de pedido: `RESERVED`, `VEHICLE`, `DELIVERED`, `QUARANTINE` o `RELEASED`.
- Movimiento: `RECEIVE`, `MOVE`, `RESERVE`, `LOAD`, `DELIVER`, `RETURN`, `RELEASE` o `ADJUST`.

## Revision y cancelacion de pedidos

`PATCH /api/orders/:id` permite editar fecha (`orderDate` o alias `date`), destino, destinatario, contacto, origen, ventana, minutos de servicio, restricciones y opcionalmente las lineas. Solo acepta pedidos `DRAFT` sin reservas; revalida que cada producto este activo y pertenezca al cliente del pedido, y sincroniza la informacion del shipment. `POST /api/orders/:id/cancel` acepta `{ commandId, reason }`, solo cancela `DRAFT` sin unidades reservadas y guarda el motivo en auditoria. Despues de reservar, la API bloquea edicion y cancelacion para preservar stock y trazabilidad.

## Previsualizacion e historial de importacion

`POST /api/orders/import/preview` recibe el mismo JSON o CSV que la importacion, valida sin escribir y responde `{ valid, rowCount, acceptedCount, orders, rowErrors }`; cada error incluye fila (base 1), campo, codigo y mensaje. En JSON se puede enviar `clientId` en el nivel superior como fallback; cada pedido tambien puede especificarlo. El alias `date` se normaliza como `orderDate`. El CSV tambien admite `date` como cabecera de fecha.

`GET /api/orders/imports` (solo ADMIN/OPERATIONS) devuelve hasta 200 ejecuciones con estado, conteos, errores por fila y resultado; no persiste el CSV original. La importacion aceptada y su historial se confirman en una transaccion. Los errores de `/api/orders/import` incluyen `rowErrors` y no dejan pedidos parciales.

## Limites de snapshot

`GET /api/inventory` también devuelve `counts`, `limits`, `hasMore`, `totals` y `clientTotals`. Los límites exactos son `limits: { products: null, locations: null, balances: null, units: 1000, movements: 500 }`; `hasMore` contiene las mismas claves booleanas y solo `units`/`movements` pueden ser `true`. Los arrays `units` y `movements` se recortan a esos topes; productos, ubicaciones y saldos no tienen ese corte. `counts` siempre da los totales completos de productos, ubicaciones, saldos positivos, series y movimientos.

`totals` tiene la forma `{ AVAILABLE, RESERVED, VEHICLE, QUARANTINE }`; cada valor suma saldos por cantidad más el número de unidades serializadas en ese estado. `clientTotals` es un mapa `{ [clientId]: { AVAILABLE, RESERVED, VEHICLE, QUARANTINE } }` calculado de la misma forma, para filtrar por cliente sin sumar arrays truncados. Un cliente sin existencias puede no aparecer en el mapa; en ese caso sus cuatro totales son cero. Las cifras agregadas cubren toda la base autorizada y no se recortan por los límites de unidades/movimientos. Los estados `DELIVERED` y `ADJUSTED` no cuentan como existencias actuales.

La pantalla de Inventario presenta esos totales en tarjetas KPI interactivas: elegir un estado aplica el filtro correspondiente a la tabla; también se puede filtrar por cliente. Para `CUSTOMER`, todos los datos y agregados quedan limitados al cliente autenticado, y las ubicaciones se limitan a las que aparecen en sus saldos, unidades o movimientos. `GET /api/inventory/export.csv` consulta todos los registros dentro del mismo ámbito y no reutiliza los límites del snapshot.

