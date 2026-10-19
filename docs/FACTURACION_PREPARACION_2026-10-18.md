# Facturación de Nexora: preparación y activación electrónica

## Estado real

Nexora confirmó que todavía no inició el trámite ante la DNIT. Esta entrega implementa **proformas comerciales**, con datos privados, controles y pruebas. **No habilita emisión fiscal** y no constituye una integración SIFEN terminada. No se generan números fiscales, CDC, XML firmados, QR de consulta fiscal ni KuDE ficticios.

La modalidad de emisión está pendiente de decisión: integración directa e-Kuatia/SIFEN, proveedor con API o emisión en la plataforma e-Kuatia’i si corresponde al contribuyente. Guardar un timbrado o elegir una modalidad en el formulario no activa por sí solo una conexión.

## Cómo usar el módulo

1. Ingresar con una cuenta de **Administración** y abrir **Facturación**.
2. En **Clientes**, completar razón social, RUC con guion y dígito verificador, y dirección del cliente. Las fichas incompletas pueden seguir usándose en logística, pero no permiten guardar una proforma.
3. En **Facturación → Datos del emisor**, completar los datos de Nexora. Se pueden guardar parcialmente; razón social, RUC y dirección son necesarios para confirmar una proforma. No escribir claves, CSC ni certificados en estos campos.
4. En **Proformas → Nueva proforma**, elegir cliente, fecha del servicio y condición contado/crédito. A crédito se exige vencimiento igual o posterior a la fecha del servicio.
5. Cargar descripción, cantidad entera y precio unitario en guaraníes **con IVA incluido**. Elegir la tasa aplicable, validada con el contador. Para cargos por peso o fracciones, calcular previamente el importe del servicio y cargarlo como una unidad; esta primera versión no calcula tarifas automáticas.
6. Opcionalmente vincular cada concepto con un envío del mismo cliente. Solo aparecen envíos con todos sus bultos entregados y sin otra proforma vigente. La consulta presenta hasta 200 candidatos recientes; los cargos también pueden prepararse sin un envío asociado.
7. **Guardar borrador** permite volver a editar. Un envío asociado queda reservado incluso mientras el documento es borrador, para evitar duplicados.
8. Abrir el documento y **Confirmar proforma**. Conserva una copia de los datos actuales del cliente y emisor y fija los importes. Después no se edita; se puede descartar y preparar otra.
9. **Imprimir / PDF** abre la impresión del navegador. Todos los documentos llevan **SIN VALIDEZ FISCAL**. **Exportar datos** descarga JSON propio de Nexora, útil para revisión e integración futura; no es un formato de importación oficial de DNIT ni de un proveedor.
10. **Descartar** conserva el documento y su historial, y libera los envíos para una nueva proforma. Descartar una proforma no es un evento de cancelación fiscal.

La referencia `PF-000001` es una referencia interna independiente por empresa. Nunca consume numeración fiscal. El módulo no registra todavía cobros, notas de crédito/débito fiscales, retenciones, cuentas por cobrar oficiales ni asiento contable. Seleccionar «Contado» describe la condición prevista y no acredita un pago.

## Controles implementados

- Acceso y operaciones exclusivamente para `ADMIN`, verificados en el servidor. Depósito, choferes, Operaciones y cuentas cliente no acceden a importes ni a datos del emisor.
- Filtros por empresa en cada lectura/escritura; claves foráneas compuestas para documentos, clientes y envíos.
- Tablas privadas `nexora.billing_issuers`, `billing_documents`, `billing_shipment_links`, con RLS y permisos explícitos para `nexora_runtime`. Sin permisos para público, Auth del portal ni servicio GPS.
- Comandos auditados, transaccionales e idempotentes. La UI reutiliza el identificador al reintentar el mismo guardado fallido; protección de versión para cambios simultáneos.
- Reserva única de envíos por empresa, liberación solo al descartar o quitar un vínculo del borrador; una confirmación vuelve a comprobar que sus envíos siguen entregados.
- Cantidades y precios enteros, cálculo con `BigInt`, límite de total de 999.999.999.999 Gs. IVA incluido estimado por grupo de tasa y redondeado a guaraníes para la proforma. El adaptador fiscal deberá reconciliar estos cálculos con las reglas vigentes de SIFEN antes de emitir.
- Emisión electrónica bloqueada en el servidor. No hay un botón que simule «emitida».

## Lo necesario para activar emisión desde el OS

1. **Modalidad y situación tributaria**: confirmar con el contador el RUC, actividades, régimen, obligatoriedad y modalidad aplicable. El sistema e-Kuatia’i es una plataforma diferenciada: no debe suponerse que ofrece una API para integrarla al OS.
2. **Habilitación y timbrado**: gestionar en Marangatu la habilitación de facturador electrónico, timbrado y puntos de expedición que correspondan.
3. **Firma y secretos**: obtener el certificado cualificado y, para la integración aplicable, el CSC. Configurarlos únicamente en un destino privado del servidor o del proveedor seleccionado; nunca en GitHub ni en el frontend.
4. **Conector real**, todavía pendiente: implementar contra el contrato del proveedor elegido o contra SIFEN. Para integración directa, obtener los XSD y catálogos vigentes y revisar el Manual Técnico 150 junto con sus Notas Técnicas vigentes, no solo el PDF base.
5. **Ciclo fiscal completo**: numeración reservada de forma transaccional, CDC, XML validado por XSD, firma XML, autenticación TLS, envío, consulta y recuperación de resultado ante timeout, aprobación/rechazo, conservación de solicitudes y respuestas, entrega al cliente y KuDE con QR. La recepción HTTP o recepción de lote no equivale a aprobación fiscal.
6. **Eventos**: cancelación/inutilización y notas de crédito/débito según la modalidad y reglas vigentes. No usar «Descartar proforma» para estos eventos.
7. **Homologación/pruebas**: probar aprobación, rechazo, firma inválida, numeración, reintento sin duplicación, consulta tras respuesta perdida, aislamiento de ambientes, vencimiento del certificado y eventos. Activar producción solo después de verificar la habilitación real y el circuito completo con Nexora.

No se contrataron proveedores, no se realizaron trámites ni se emitieron documentos fiscales durante esta implementación.

## Fuentes oficiales consultadas el 18 de octubre de 2026

- [DNIT: e-Kuatia y habilitación](https://www.dnit.gov.py/web/e-kuatia/ekuatia).
- [DNIT: documentación técnica y Notas Técnicas](https://www.dnit.gov.py/web/e-kuatia/documentacion-tecnica). La página incluye ajustes posteriores al Manual Técnico 150; revisar los vigentes al integrar.
- [DNIT: e-Kuatia’i y requisitos de certificado/timbrado](https://www.dnit.gov.py/web/e-kuatia/ekuatia-i).
- [DNIT: información y normativa de IVA](https://www.dnit.gov.py/web/portal-institucional/iva).

## Migraciones y verificación

- SQLite: `server/migrations/015_billing.sql`.
- PostgreSQL/Supabase: migración `billing_preparation`, versión de esquema del OS 15. Aplicar antes de arrancar el backend de esta versión.
- Pruebas: `tests/billing.test.ts`, `tests/postgres.billing.ts`, historia de navegador en `tests/e2e/operation.spec.ts`.
- PostgreSQL de pruebas exclusivamente local `nexora_test`. La migración de registro web sin seguimiento que ya estaba en el workspace exige una configuración propia ajena a este módulo; se preservó y no se incluyó en la publicación de facturación.

### Resultados de esta entrega

- Suite general: **140/140** pruebas aprobadas.
- Suite PostgreSQL local: **15/15**, más una prueba adicional posterior de concurrencia real del módulo: **2/2** pruebas de facturación PostgreSQL aprobadas.
- Navegador: **5/5** recorridos aprobados, incluidos la guía completa y el circuito de facturación. Se verificaron vistas de escritorio y móvil, reapertura, exportación y vista de impresión.
- Compilación TypeScript/Vite, comprobación de migraciones y escaneo de secretos aprobados. Facturación se carga bajo demanda.
- Backup privado previo a la migración completado; no se crearon proformas ni clientes de prueba en producción.
- Migración remota `20261019012139_billing_preparation.sql`, esquema del OS versión 15. RLS activo y ausencia de permisos de lectura para el portal y GPS comprobados en producción.
