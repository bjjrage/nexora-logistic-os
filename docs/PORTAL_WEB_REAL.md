# Clientes en OS y seguimiento público

La cuenta del cliente pertenece a Nexora OS. La web corporativa consulta pedidos individuales sin login en /seguimiento/. La antigua ruta /clientes/ muestra el mismo seguimiento para conservar enlaces existentes.

## Compartir un pedido

En el OS, abrir Envíos y seleccionar el envío. En el detalle, «Seguimiento para el destinatario» muestra los códigos de bulto y sus enlaces. Uno de ellos consulta los estados del pedido completo. Cada código B- seguido de 20 caracteres hexadecimales procede del generador aleatorio del OS. No se aceptan referencias comerciales, IDs internos ni búsquedas por teléfono.

El enlace usa un fragmento #codigo=…; el código se envía a Supabase en el cuerpo de una solicitud POST. Publica conteos por estado y fechas de hitos operativos predefinidos. No publica nombres, direcciones, teléfonos, IDs de empresa, personal, vehículos, notas ni archivos. Quien tenga el código puede consultar ese seguimiento.

Los estados cambian al registrar recepción, carga, despacho, entrega o devolución en el OS. No hay GPS ni estimaciones inventadas. Actualmente la base real no contiene envíos: debe existir el pedido en esa misma base de Supabase. Los datos de la instancia SQLite de demostración no se publican.

## Backend

Migración privada 20261016020240_public_order_tracking.sql: public.track_order(text) es SECURITY INVOKER; delega en una función SECURITY DEFINER deliberadamente limitada dentro de tracking_private, con búsqueda exacta, entrada validada, search_path vacío y privilegios de ejecución explícitos. No concede a anon acceso a tablas de operaciones ni al esquema nexora.

Las tablas y funciones del portal Google anterior se conservan. La web ya no monta ese portal. Su conservación no equivale a haber integrado Google en el login del OS: el OS mantiene sus propios accesos de cliente. El servidor del OS sigue siendo una aplicación separada; desplegar la landing no lo publica en Internet.

## Verificación

- node --test web-publica/.local/public-tracking-isolation.test.mjs: PostgreSQL aislado, códigos independientes, estados reales, rechazo de IDs/referencias/inyección, campos permitidos y denegación de tablas privadas.
- supabase/tests/public_tracking.sql: comprobación remota con fixtures temporales y rollback.
- npm.cmd test dentro de web-publica y npm.cmd run build en OS.

La migración, esquema y pruebas privadas no deben publicarse en el repositorio público de la landing.
