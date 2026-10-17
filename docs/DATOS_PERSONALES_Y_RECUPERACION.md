# Datos personales y atención de solicitudes

## Inventario de datos

| Datos | Tablas | Acceso previsto |
| --- | --- | --- |
| Nombre, usuario y hash de contraseña del equipo | nexora.users, sessions | Servidor; Administración consulta fichas del equipo, nunca hashes/sesiones desde UI |
| Nombre y contacto de empresas clientes | clients, client_profiles | Administración y Coordinación de la empresa operadora; GPS no tiene acceso a la ficha |
| Usuario de consulta de un cliente | customer_accounts, customer_sessions, public.portal_memberships | Administración; cada cliente ve solo su alcance autenticado |
| Destinatario, teléfono y dirección de entrega | shipments, inventory_orders | Equipo autorizado; chofer por asignación; cliente por pertenencia verificada |
| Foto y nombre del receptor | evidence, attempts, quad_proofs | Autenticación y permisos por organización/cliente/asignación. No se publican con el código de seguimiento |
| Teléfono/dispositivo y ubicación de vehículo | traccar_devices, traccar_vehicle_bindings, traccar_latest | Equipo autorizado; la web muestra posición reciente del vehículo de un bulto en reparto a quien posee su código |
| Quién realizó movimientos y cuándo | audit, custody_events, inventory_movements | Servidor y vistas autorizadas; historial de custodia y movimientos inmutable |
| Recuperación de acceso | password_recovery | Servidor. Token aleatorio guardado como hash; enlace privado de 15 minutos y un solo uso |

Las credenciales de APIs viven en configuración privada del servidor. Los backups de aplicación contienen datos personales y hashes de acceso; se excluyen de Git. El backup lógico del OS no contiene el sistema de identidad de Supabase Auth ni sustituye el respaldo de plataforma.

## Exportación y rectificación

1. Recibir la solicitud mediante el contacto publicado de Nexora y verificar la identidad y representación de la persona/empresa.
2. Administración determina organización, cliente, usuario y envíos afectados; nunca buscar o exportar datos de otros clientes para completar una solicitud.
3. Exportar inventario mediante el CSV autenticado del OS. Para pedidos/evidencias, usar las consultas autenticadas del cliente y preparar una exportación privada revisada por Administración. Verificar manualmente que no incluya datos de terceros innecesarios.
4. Entregar por un canal privado acordado, registrar autorización, alcance y fecha. No publicar archivos, enlaces de recuperación ni códigos de seguimiento en repositorios o enlaces abiertos.
5. Rectificar fichas desde Clientes. Las correcciones operativas deben conservar trazabilidad del movimiento original.

## Baja y supresión

Revocar primero el acceso del cliente y sus sesiones. La recuperación de contraseña también invalida las sesiones anteriores. Administración evalúa qué datos se pueden anonimizar y qué historial operativo debe conservarse para acreditar custodia, entregas, reclamos o compromisos contractuales. No eliminar movimientos ni cascadas para simular una supresión.

La política final de retención y los plazos de respuesta requieren aprobación de Nexora y revisión jurídica local. Este documento no inventa un plazo legal ni autoriza borrados automáticos. Registrar cualquier solicitud pendiente y su decisión; al restaurar un backup se deben reaplicar las bajas/rectificaciones posteriores a la copia antes de habilitar acceso. Las copias conservadas se mantienen privadas hasta su vencimiento según la política aprobada.

## Incidente y recuperación

1. Identificar release y referencia de solicitud de los logs JSON. No copiar formularios, contraseñas o tokens a incidencias públicas.
2. Contener la falla: bloquear la operación afectada o regresar al artefacto anterior probado, conservando el backup y el historial.
3. Reproducir en PostgreSQL aislado y agregar una prueba que falle antes del arreglo. Ejecutar tests y navegador antes de publicar.
4. Si se restauran datos, usar una base nueva y comparar manifiesto, conteos y hashes. No restaurar encima de producción para probar.
5. Verificar permisos, stock, pedidos y GPS antes de reabrir. Registrar causa, fix, prueba, resultado y cualquier solicitud de privacidad que deba reaplicarse.

El monitor local ejecuta checks cada minuto y conserva cambios de estado en .local/monitor. Requiere PC y sesión Windows activos. El responsable todavía no dispone de proveedor de envío: las alertas al correo no están activas y no se consideran verificadas.
