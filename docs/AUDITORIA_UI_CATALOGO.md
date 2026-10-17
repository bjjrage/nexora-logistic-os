# Auditoría independiente de interfaz e importación de catálogo

Fecha de revisión: 15 de octubre de 2026. Alcance: flujos de Inventario/Pedidos/Flota y API de importación masiva de catálogo. Esta auditoría no modifica el modelo ni los datos operativos; la prueba de integración contra Supabase fue ejecutada por el agente principal y confirmó rollback.

## Dictamen

La importación de catálogo pasó 6/6 pruebas HTTP contra SQLite temporal, incluida la ausencia de efectos de stock, el aislamiento por cliente/organización, permisos, reintentos concurrentes, rollback, preservación de ceros visibles de XLSX, rechazo de fórmulas y protección de la exportación CSV. El agente principal reportó además 81/81 pruebas, build TypeScript/Vite aprobado y una integración de catálogo contra Supabase con rollback confirmado. No encontré una regresión P1 en el código de interfaz revisado.

## Interfaz

El inventario abre en una tabla de existencias con búsqueda y filtros de cliente/estado. Los KPI son botones que activan el filtro correspondiente. Recepción, traslado, ajuste, importación de catálogo, movimientos y configuración son vistas separadas; la creación/edición de producto y ubicación se abre como tarea secundaria. Pedidos separa lista, importación, historial y retornos. La recepción resuelve SKU/código de barras mediante catálogo, acumula una sola SKU y evita cambiar de cliente/producto con una cesta pendiente. Las filas de vista previa y errores de catálogo están paginadas en lotes de 20. El seguimiento de productos existentes aparece de solo lectura durante la edición para no sugerir que cambiarlo modifica el stock serializado; las ventanas modales usan el hook de foco/teclado. Evidencia estática: `frontend/InventoryPanel.tsx:438,860-878`.

El aviso de falta de `BarcodeDetector` aparece dentro de la ayuda del lector y la cámara se activa después de pulsar su control; la lectura USB/Bluetooth por teclado no depende de esa API (`frontend/BarcodeScanner.tsx:181-189`). Rutas y Flota muestran tareas secundarias en secciones nativas `details/summary`, accesibles por teclado, con vistas separadas para planificación/carga y vehículos/choferes/documentación/inspecciones (`frontend/App.tsx:959-993,1164-1214`; `frontend/TaskDisclosure.tsx`). El texto de exportación de movimientos aclara el límite de 500 registros y no promete un CSV completo.

La captura previa de Inventario, antes de esta reorganización, es `docs/evidencias/ui-antes-inventario.jpg`. El agente principal reportó comprobaciones en IAB. En una importó un XLSX de tres SKU conservando ceros iniciales, informó Marca/Stock como columnas ignoradas y confirmó que no cambió existencias; luego registró dos lecturas del mismo SKU y vio dos unidades y el KPI incrementarse en dos. En el pase final, seleccionar cliente/ubicación enfocó automáticamente el lector; tras confirmar una unidad de Cocina, el cambio de SKU quedó bloqueado hasta vaciar la cesta, el mensaje de éxito anterior desapareció y la cesta quedó en cero. El stock final mostró cinco unidades disponibles y cuatro reservadas. Un SKU desconocido o distinto también se bloqueó sin perder la cesta; el KPI Reservado filtró dos filas y Escape cerró el modal, restauró el foco y el overflow. Se verificaron además la lista de Rutas y Paradas con referencias humanas y la lista de Pedidos sin formulario abierto. Para Flota, se reportó un ajuste de altura de 2339 a 768 px. Los detalles y enlaces de QA están en `docs/INFORME_QA.md`.

En móvil (390 × 844), la medición reportada fue 375 px de ancho DOM; la tabla de 760 px quedó dentro de su región horizontal de 303 px, sin overflow global, y se reseteó una regla de estilo override. Esta evidencia visual la ejecutó el agente principal; las capturas disponibles son algo borrosas y sirven para una comprobación general, no para una inspección precisa de píxeles.

## Catálogo: controles verificados

Las rutas HTTP `GET /api/inventory/catalog/template.csv`, `POST /api/inventory/catalog/preview` y `POST /api/inventory/catalog/import` se montan antes de las rutas legacy (`server/inventory-routes.ts:14-20`). El servicio vuelve a validar el archivo dentro de la transacción antes de aplicar cambios (`server/catalog-import.ts:300-371,379-428`). Solo admite ADMIN/OPERATIONS; no se aceptan usuarios anónimos, DEPOT ni CUSTOMER.

La suite nueva `tests/audit-catalog.test.ts` verificó por HTTP:

- CSV delimitado por punto y coma y SKU/barcode con ceros iniciales; actualización acotada al cliente, conservación de seguimiento cuando la columna está vacía y repetición idempotente.
- Vista previa sin escrituras; importación sin cambios en saldos, series, movimientos, pedidos ni líneas de pedido.
- XLSX numérico con formato visible de ceros; fórmula bloqueada y ZIP con expansión desproporcionada rechazado antes de escribir.
- SKU duplicado, barcode conflictivo y fallo SQL a mitad del lote con rollback completo.
- Cliente de otra organización rechazado, roles sin permiso bloqueados y dos requests concurrentes con el mismo commandId que producen un único producto/comando.
- Importación de nombre `=1+1`, exportación con apóstrofe de seguridad y valor original sin modificar en base; también se probó un texto con tabulación inicial.

El serializador de exportación solo antepone el apóstrofe a celdas de texto con prefijo de control o que pudieran iniciar una fórmula (`server/inventory.ts:927-935`). No cambia el valor guardado del catálogo. El caso de round-trip está en `tests/audit-catalog.test.ts`.

## Hallazgos de esta revisión

No quedan hallazgos P1/P2 abiertos de los puntos cubiertos por esta revisión. El encabezado normalizado `Código de barras` ya se reconoce mediante el alias `codigodebarras`; el servicio también aplica `defaultTracking` cuando la fila no especifica seguimiento y devuelve `ignoredColumns` para que la interfaz informe columnas omitidas (`server/catalog-import.ts:33,48,59-63,205-219,255-267`). El test de importación de catálogo cubre estos parámetros y el alias, según el gate reportado por el agente principal.

La organización de las vistas, el control de mezcla SKU en recepción, el lector USB sin dependencia de `BarcodeDetector`, el límite de exportación de movimientos, el seguimiento de producto de solo lectura y la gestión de foco de modales se revisaron estáticamente. La comprobación IAB descrita arriba fue reportada por el agente principal; no se atribuye como ejecución propia de esta auditoría. No se encontró una regresión P1 en esos cambios.

## Ejecución y límites

- `npm.cmd test`: el agente principal reportó 81/81 aprobadas (11,652 ms), incluyendo esta auditoría y los tests del importador. No repetí la suite completa después de ese reporte.
- `node --test tests/audit-catalog.test.ts`: 6/6 aprobadas ejecutadas por esta auditoría después del endurecimiento CSV.
- Build TypeScript/Vite final (incluidos los cambios de foco y texto del lector): PASS reportado por el agente principal; bundle JS de 448.20 kB (125.40 kB gzip), CSS de 47.51 kB y XLSX permanece en el lado servidor.
- Integración focalizada de catálogo contra Supabase: PASS reportado por el agente principal en 22.43 s, con rollback confirmado. Las seis pruebas de esta auditoría usan SQLite temporal.
- La validación IAB indicada en «Interfaz» también fue ejecutada por el agente principal. No se probó un lector físico; la cámara y un archivo operativo real del cliente tampoco se probaron en esta auditoría. Las capturas algo borrosas limitan la revisión visual de detalle.
