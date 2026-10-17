# Entrega de inventario, pedidos y reparto conectado

15 de octubre de 2026. Implementación del [plan del cliente](PLAN_OPERATIVO_CLIENTE.md). Este registro describe software y verificación; no declara aceptado un piloto real ni activada la cuenta del proveedor.

## Funciones entregadas

1. **Inventario y catálogo:** catálogo por cliente, peso/volumen por unidad, productos por cantidad o número de serie, ubicaciones, recepción, traslado y ajuste autorizado con motivo. La importación empresarial acepta CSV y `.xlsx`, ofrece plantilla y preview, valida el lote completo y registra solo cambios de producto; `defaultTracking` es una elección explícita y las columnas desconocidas aparecen en `ignoredColumns`. Importar Stock en una columna extra no cambia existencias. Los archivos se limitan a 5 MiB, 10.000 productos y 32 columnas. Movimientos auditados y saldos separados en disponible, reservado, vehículo y cuarentena.
2. **Lectura:** entrada por lector USB/HID que emula teclado y envía Enter, o cámara cuando el navegador ofrece BarcodeDetector. La cámara se activa por acción del usuario, detiene sus tracks al salir y no vuelve a contar una etiqueta que permanece en pantalla. Los navegadores sin soporte muestran la alternativa USB/manual. La captura con Enter está verificada; no se ha probado un dispositivo físico del cliente.
3. **Pedidos:** CSV con vista previa y validación en servidor, importación atómica, errores por fila guardados sin conservar el archivo original, historial, reservas completas o rechazadas, un bulto por unidad y carga por lectura. Edición y cancelación con motivo antes de reservar; después se bloquean modificaciones que afectarían custodia.
4. **Portal:** cuentas de consulta por cliente, revocación inmediata, inventario de cantidades y series, movimientos, pedidos, exportación completa de existencias y comprobantes privados. Las listas acotadas anuncian límites. El cliente no accede a flota, usuarios internos ni mercadería/ubicaciones de otro cliente.
5. **QuadMinds:** cola persistente de órdenes SaaS v2 con códigos estables por unidad y recuperación por búsqueda antes de reintentar un alta; dimensiones según IDs configurados en la cuenta y ventanas del pedido. Vinculación de órdenes existentes y rutas publicadas. Importación del orden de paradas para borradores de entrega, sincronización de resultados y descarga privada de foto/firma con validación TLS, hosts autorizados, DNS fijado y límites de tamaño/tiempo. Recepción de eventos con HMAC-SHA256/base64.
6. **Entrega y retorno:** un evento «entregado» sin foto/firma queda informado y pendiente de certificación. El cierre de inventario exige resultados y comprobantes QuadMinds del bulto, con foto y firma distintas. Fallos conservan custodia de vehículo; retorno autorizado, recepción con foto, cuarentena y liberación tras inspección generan movimientos separados.

## Cómo empezar

- OS con Supabase: `http://127.0.0.1:5173`. En una instalación vacía, su responsable crea organización, zona horaria y administrador. No se creó una cuenta administradora predeterminada en la base del negocio.
- DEMO aislada: `http://127.0.0.1:5174`. Contiene datos ficticios; no opera contra Supabase.
- En **Clientes**, registrar el propietario de la mercadería. En **Inventario → Importar catálogo**, descargar la plantilla CSV o cargar un CSV/XLSX y validar el preview antes de confirmar. Elegir `defaultTracking` si las filas nuevas no traen seguimiento; los cambios no crean stock. Las columnas empresariales desconocidas se omiten y se muestran en `ignoredColumns`.
- En **Inventario → Configuración**, crear las ubicaciones; identificar también una ubicación de cuarentena para los retornos. La interfaz mantiene catálogo, recepción, traslado y ajuste como acciones separadas. Las tarjetas KPI de existencias filtran por estado y se pueden combinar con el filtro por cliente.
- En **Recepción por SKU**, elegir cliente y ubicación, leer el código de catálogo y revisar el lote pendiente; **Confirmar recepción** es la acción que suma las existencias. Cada lectura de un producto por cantidad suma una unidad; para serializados se lee una etiqueta por unidad. Un código ausente permite abrir la importación de catálogo. El lector HID puede enviar el código y Enter; no se ha probado hardware físico.
- En **Pedidos**, seleccionar cliente y validar/importar el archivo. Reservar genera los bultos individuales. En **Rutas**, asignarlos, verificar capacidad y confirmar el plan; registrar la carga y completar los controles de despacho.
- En **Accesos cliente**, Administración crea una cuenta de consulta o revoca su acceso. El mismo acceso del OS abre el portal según el rol autenticado.
- En **Tracking**, preparar/vincular las órdenes QuadMinds y la ruta publicada. La planificación/optimización y publicación se realizan en QuadMinds. Nexora puede importar la secuencia y sincronizar resultados; no invoca un endpoint de optimización no confirmado.

## Dependencias externas para activar el reparto

La conexión real de QuadMinds permanece deshabilitada. Falta el acceso autorizado a la cuenta y confirmar producto contratado, destinos/IDs, dimensiones, códigos de resultado, hosts de fotos/firmas y contrato de posiciones. Las pruebas del proveedor utilizan fixtures; no son entregas ni GPS reales.

El primer recorrido real debe comprobar permisos de ubicación y segundo plano del celular, cobertura/cortes de red, la ruta correcta en la app, foto/firma obligatorias, consultas posteriores y retorno. Confirmar con el cliente si envía pedidos a optimizar o una secuencia ya fijada. La vinculación actual de una orden existente corresponde a una unidad; una orden externa agregada necesita acordar cómo identificar cada entrega parcial antes de activarse.

La duración de servicio y restricciones especiales se conservan en el pedido para revisión operativa. Las ventanas y dimensiones soportadas se envían a la API; la configuración adicional del destino/vehículo y su interpretación por el optimizador deben verificarse en la cuenta de QuadMinds.

## Publicación y sincronización programada

Se prepararon `api/index.ts`, `vercel.json` y `.vercelignore` para Vite + API PostgreSQL en Vercel. El despliegue no usa SQLite. Las cookies son Secure en producción y el alta inicial pública está bloqueada salvo token privado. Nunca subir `.env` ni la credencial local.

No se publicó en la cuenta personal: la conexión Vercel disponible solo mostró el equipo personal y ningún proyecto Nexora. El usuario indicó que este negocio debe tener cuentas/facturación separadas. Falta elegir/conectar el destino del negocio; no se crearon servicios pagos ni Railway.

`GET /api/jobs/quadminds-sync` requiere `Authorization: Bearer <CRON_SECRET>` (mínimo 32 caracteres) y cuenta QuadMinds configurada. Procesa una cantidad acotada de órdenes/rutas para cada invocación; también se puede operar manualmente desde Tracking. No se activó un scheduler sin conocer alojamiento, frecuencia, volumen y plan contratado. Antes de afirmar sincronización automática, configurar y probar su programación en el alojamiento del negocio, sus reintentos y la autorización. El endpoint y la cola persistente quedan preparados.

## Verificación registrada

- `npm test`: 81 pruebas aprobadas, sin fallos ni omitidas; incluye catálogo CSV/XLSX, columnas omitidas, tracking predeterminado, conflictos, idempotencia, series, exportación sobre el límite y circuito completo con proveedor fixture.
- `npm run build`: TypeScript y Vite aprobados.
- PostgreSQL: 5 casos aprobados entre distintas corridas. La suite de 3 pruebas (278393 ms) cubre circuito nuevo, permisos/API y circuito logístico anterior. El caso adicional de CSV rechazado (9082 ms) confirma errores por fila persistidos, retry sin duplicación y permisos de historial. El quinto caso importa catálogo por lotes, comprueba rollback y terminó en 22,43 s. Los fixtures de negocio terminan en rollback.
- Base del negocio: migraciones 1–7 verificadas; 47 tablas privadas con RLS. La importación de catálogo no requirió DDL ni nuevas migraciones. Los archivos locales de migración reflejan las versiones reales del historial remoto. El portal público `web-publica` y sus tablas `public` preexistentes se preservaron.
- La auditoría de Supabase no reportó un problema de RLS en esas tablas. Sí mostró una advertencia de configuración general de Supabase Auth sobre protección de contraseñas filtradas; el OS conserva sus sesiones/scrypt propios. No se modificó la configuración de Auth usada por el portal público paralelo.
- Chrome, DEMO SQLite: alta de producto y ubicación, tres lecturas consecutivas del mismo código de modelo mediante Enter sin recarga ni recepción prematura, confirmación de recepción de 3 unidades, vista previa/importación de un pedido de 2, edición DRAFT y reserva. Resultado: 1 disponible + 2 reservadas, con movimientos separados y edición bloqueada después de reservar. La cámara informa correctamente que BarcodeDetector no está disponible en ese navegador. No se probaron etiquetas/dispositivos físicos.
- Chrome con cuenta CUSTOMER ficticia: acceso al portal, saldos propios 1 disponible/2 reservadas, pedido reservado, tres movimientos y exportación CSV descargada y contrastada con esos saldos. Los dos bultos muestran resultado pendiente, sin comprobantes inventados. Tras corregir el desplazamiento de fecha por zona horaria, la recarga final muestra correctamente `16/10/2026` para `2026-10-16`. Build final TypeScript/Vite aprobado (11.08 s, JS 415.38 kB). Ver [captura del inventario](evidencias/inventario-reserva-final.jpg).
- La auditoría independiente conserva sus resultados y límites en [AUDITORIA_IMPLEMENTACION.md](AUDITORIA_IMPLEMENTACION.md).

## Información que debe entregar el cliente

Muestra de etiquetas y de archivos diarios, volumen de unidades/pedidos/vehículos, reglas de parcial/rechazo/retorno, usuarios del portal, responsable de planificación y contacto técnico de QuadMinds. Las credenciales se configuran por un canal privado en el servidor; no deben pegarse en el chat ni exponerse al navegador.
