# NX-PROV-01 · Proveedores y Gastos V1

## Acceso

Abrí **Proveedores y Gastos** desde el OS administrativo o entrá por `/?modulo=proveedores-gastos`. El módulo abre en **Resumen**. El módulo usa la sesión existente y el rol `ADMIN` para todas sus operaciones. La API obtiene organización y actor de la sesión.

- **Resumen** muestra los indicadores del registro unificado de compras y gastos.
- **Proveedores** reúne contrapartes, datos de contacto y cuenta corriente.
- **Compras y gastos** confirma documentos y permite registrar un pago en el mismo paso.
- **Pagos y anticipos** registra pagos manuales, anticipos y notas de crédito. Desde el detalle se distribuye el disponible entre documentos.
- **Cuentas por pagar** muestra saldos y vencimientos pendientes.
- **Reportes y presupuesto** abre el desglose de cada total, filtra y exporta CSV.
- **Configuración** administra cuentas de caja y banco, categorías y centros de costo.

## Persistencia y reglas

El módulo agrega tablas `procurement_*` en el esquema privado `nexora` de PostgreSQL. La versión SQLite aplica el mismo modelo para desarrollo. Las claves foráneas compuestas por organización protegen las relaciones. Las aplicaciones también referencian la contraparte de ambos lados. En PostgreSQL, solo `nexora_runtime` tiene permisos de lectura y escritura sobre el nuevo modelo. Los adjuntos y Excel originales son binarios privados de la base y se incluyen en el respaldo del esquema. Los roles públicos y de tracking carecen de acceso.

Las líneas conservan total, tasa, IVA y neto del comprobante en guaraníes enteros. El servidor valida el desglose y suma con aritmética exacta. El total y el vencimiento del documento confirmado representan la obligación V1. Los importes de IVA representan datos del comprobante recibido.

- **Registrar y pagar** confirma documento, registra la salida y aplica el pago dentro de la misma transacción. Un error revierte todo el comando.
- El saldo resulta del total confirmado menos aplicaciones vigentes. El disponible de un pago, un anticipo o una nota de crédito resulta del importe registrado menos esas aplicaciones. Las aplicaciones pueden distribuirse entre documentos de la misma contraparte.
- Un pago o un anticipo genera una salida vinculada. Una aplicación, su reverso y una nota de crédito afectan las obligaciones y los disponibles sin generar movimientos adicionales de caja.
- **Deshacer aplicación** reabre el saldo y restaura el disponible. **Revertir pago o crédito** deshace sus aplicaciones y registra el contramovimiento cuando corresponde. **Anular documento** exige deshacer primero sus aplicaciones vigentes.
- Apertura, entrada, salida, transferencia y reverso mantienen actor, fecha y referencia. Cada transferencia liga dos movimientos de signo opuesto. El reverso de una transferencia registra ambos contramovimientos. El saldo mostrado con apertura corresponde al libro interno. Las cuentas sin apertura muestran sus movimientos registrados y el estado de cobertura.
- La clave `commandId` identifica un comando por organización, actor y contenido. Reutilizar la clave con el mismo comando devuelve el resultado inicial. El bloqueo transaccional existente del OS serializa las mutaciones entre conexiones PostgreSQL. SQLite usa una transacción de escritura inmediata.
- El historial conserva actor, fecha y motivos de corrección. Los comprobantes aceptan PDF, JPEG, PNG y WebP de hasta 5 MiB. El servidor verifica firma binaria y sirve descargas autenticadas como adjunto.

## API

Todos los paths parten de `/api/procurement`. Las escrituras usan JSON y el encabezado `X-Requested-With: logistics-os` del OS. Los listados aceptan `limit` y `offset`.

| Método y path | Operación |
|---|---|
| GET `/parties`, `/documents`, `/settlements`, `/payables` | Contrapartes, documentos, pagos/anticipos/créditos y obligaciones |
| GET `/accounts`, `/movements`, `/categories`, `/centers`, `/budgets` | Configuración y libros |
| GET `/{parties,documents,settlements,accounts,movements}/:id` | Detalle y relaciones autorizadas |
| POST `/commands` | Mutación idempotente |
| POST `/{documents,settlements}/:id/attachments` | Adjuntar con `commandId`, `filename`, `mimeType` y `dataBase64` |
| GET `/attachments/:id` | Descargar comprobante |
| GET `/register`, `/register.csv`, `/register/monthly`, `/register/semester`, `/register/budget` | Registro unificado y reportes de gastos |
| GET `/reports?view=…`, `/export.csv?view=…` | Desglose y exportación de saldos y movimientos |
| GET / POST `/imports` | Listar lotes o importar el archivo guardado con `filename` y `contentBase64` |
| GET `/imports/active` | Consultar la última importación activada |
| POST `/imports/:id/activate` | Seleccionar explícitamente una versión ya importada |
| GET `/imports/:id/workspace` | Conciliar el Registro con los totales guardados y preparar la configuración |
| POST `/imports/:id/setup` | Confirmar la configuración en bloque con `commandId` y la huella `digest` de la vista previa |
| GET `/imports/options` | Sugerencias de medios de pago tomadas de los lotes confirmados |
| GET `/imports/:id`, `/imports/:id/original`, `/imports/:id/rows/:rowId` | Lote, archivo privado y origen de una fila |
| POST `/imports/:id/rows/:rowId/resolve` | `SKIP` o `PROMOTE` con motivo, `commandId` y operación confirmada cuando corresponde |

| Acción de `/commands` | Campos principales además de `commandId` y `action` |
|---|---|
| `PARTY` | `id` para editar, `name`, `ruc`, `contact`, `kind`, `active` |
| `CATEGORY`, `CENTER`, `ACCOUNT` | `name`, `kind` para la cuenta |
| `DOCUMENT` | `partyId`, `nature`, `categoryId`, `centerId`, `documentDate`, `dueDate`, `condition`, `reference`, `lines` y `payment` opcional |
| `SETTLEMENT` | `partyId`, `kind`, `amountPyg`, `eventDate`, `accountId`, `method`, `reference`, `description` y `applications` opcionales. La nota de crédito admite desglose IVA/neto |
| `APPLY` | `settlementId`, `applications` con `documentId` y `amountPyg` |
| `UNAPPLY`, `VOID_DOCUMENT`, `REVERSE_SETTLEMENT`, `REVERSE_MOVEMENT` | `id`, `reason`, `eventDate` para reversos fechados |
| `MOVEMENT` | `accountId`, `destinationAccountId` para transferencia, `kind`, `eventDate`, `amountPyg`, `reference` |
| `BUDGET` | `categoryId`, `month` en formato AAAA-MM y `amountPyg` con entero o `null` |

Las líneas documentales usan `description`, `totalPyg`, `vatRate`, `vatPyg` y `netPyg`. El pago adjunto al documento usa `amountPyg`, `eventDate`, `accountId`, `method` y `reference` opcional. Las fechas de negocio usan AAAA-MM-DD.

## Reportes

Gasto y ejecución toman la fecha del documento y el total PYG con IVA incluido. Incluyen gasto, compra y remuneración. Los activos tienen una vista propia. `Sin clasificar` incluye los documentos sin categoría. Los pagos toman la fecha del pago manual. Las obligaciones toman la fecha de vencimiento y muestran el saldo vigente. Los movimientos toman la fecha de contabilización en la cuenta.

Los filtros disponibles dependen del universo. La clasificación aplicada a pagos o movimientos busca documentos vinculados y conserva el movimiento completo. Un pago repartido puede aparecer en más de una consulta de clasificación. El total sin ese filtro cuenta cada pago una vez. La consulta de total y desglose comparte una sola lectura. La exportación usa los mismos filtros de la vista.

Cada presupuesto pertenece a una categoría y un mes. Un campo vacío se muestra como **Sin definir**. Cero se conserva como un límite explícito. Anticipos, créditos, activos, aperturas y transferencias quedan fuera del criterio de ejecución de gasto corriente.

## Importación

**Importar Excel** acepta una hoja Registro o Pagos por archivo. Cada carga agrega movimientos salvo cuando el administrador selecciona un lote para actualizar. Se conserva el original privado, la procedencia de las filas y el historial de correcciones. El identificador SHA-256 evita reimportar archivos idénticos.

- **Registro** integra las filas históricas en Compras y gastos. El estado declarado en el archivo no registra por sí solo un pago de tesorería. Las filas que se confirman como documentos operativos aparecen una sola vez.
- **Pagos** admite proveedor o RUC, factura, referencia del pago, fecha, importe aplicado, cuenta de origen y medio. Una transferencia puede tener varias filas, una por factura. El total declarado, si está presente, debe coincidir con la suma aplicada. Se registra una sola salida por transferencia. Las excepciones muestran su motivo.
- **Revisar transferencia** permite reasignar una factura y reprocesar el grupo. El archivo original permanece disponible. Las correcciones quedan auditadas y reintentar una transferencia registrada devuelve el pago existente.
- **Revisar y cargar maestros** permite confirmar los datos de configuración identificados. **Resumen Jul–Dic** permite elegir el año y conciliar los gastos de la importación de referencia con los valores guardados en su hoja semestral. El total del OS incluye las demás cargas del período.

## Migración y pruebas

La migración PostgreSQL `supabase/migrations/20261127012447_nx_procurement.sql` y la SQLite `server/migrations/029_procurement.sql` agregan las tablas del módulo y registran la versión interna 29. Sobre `main` el conjunto esperado es 1–23 y 29. La base de verificación usa ese mismo conjunto.

La migración y el despliegue del backend requieren una ventana coordinada. El verificador de arranque de la versión anterior espera 1–23 y el de esta versión espera 1–23 y 29. Validá primero la actualización en una base aislada y comprobá la versión y readiness del backend tras desplegar.

```powershell
npm ci
npm run check:migrations
npm run check:secrets
npm test
$env:PG_TEST_ADMIN_URL = '<URI local de un clúster de QA>'
npm run test:isolated
npm run build
npm run build:portal
$env:NX_PROCUREMENT_E2E_POSTGRES = '1'
node --env-file=.local/staging/test.env node_modules/@playwright/test/cli.js test tests/e2e/procurement.spec.ts
```
