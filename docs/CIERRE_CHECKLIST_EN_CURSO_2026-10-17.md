# Cierre del checklist — trabajo en curso

> Documento provisional histórico. Estado actualizado: [cierre de fixes](CIERRE_FIXES_CHECKLIST_2026-10-17.md).

QuadMinds queda para el final por pedido del responsable. Este archivo registra evidencia y pendientes; no declara producción aprobada.

## Corregido y comprobado

- Aceptación del portal atómica: falla de UPDATE revierte envío/bultos/idempotencia; reintento y dos solicitudes simultáneas crean un solo envío. Test rojo antes y verde después.
- Diagnóstico JSON con request_id y contexto del usuario autenticado. Los mensajes de DB, cuerpos y query strings no se registran. API entrega referencia para soporte; captura frontend de fallos sin formularios/contraseñas. Buffer administrativo por organización y logs del servidor.
- Conciliación de existencias con ledger inmutable, cantidades y series. Test detecta corrupción deliberada y aislamiento. Vista administrativa en Empresa y equipo → Control del sistema.
- Headers de seguridad OS en producción y web Netlify preparados; seguimiento público con timeout que cubre lectura JSON. Web: 19 tests aprobados. Publicación/verificación remota pendientes.
- Baseline original del portal recuperada desde el historial Supabase. PostgreSQL 17 local aislado permite instalar y probar sin datos de producción.
- Backup autorizado de los 58 objetos de tabla de los esquemas de aplicación, snapshot consistente y manifiesto. Restore local: **58/58 conteos y hashes idénticos**. SHA256: `48e1d2a85475530112c8b20f40d754b5c6ee307ed6310013e848ab49c5d77026`. No incluye credenciales/identidades de Supabase Auth ni configuración de plataforma; no sustituye su backup.
- Playwright: alta inicial, ficha de cliente, edición, recarga, logout y nuevo login, sin fallos JS. Prueba de circuito operativo ampliada en desarrollo.
- Recuperación administrativa de acceso implementada: enlaces de 15 minutos, hash en DB, un solo uso, revocación de enlaces previos y de sesiones; prueba de concurrencia aprobada. Migración 11 probada en PostgreSQL local; aplicación real pendiente.

## Pendientes que no se cierran con código solamente

- **Correo:** responsable confirmó que todavía no tiene SMTP/Resend/Brevo. No hay entrega real de alertas hasta conectar proveedor y probar recepción.
- **Celular real:** falta probar permisos, GPS en segundo plano, pérdida de señal y recuperación.
- **QuadMinds:** contrato/credencial sin recibir; última etapa.
- **Auditor de otra familia y revisión legal:** no se realizaron. No se presentará esta revisión de GPT como independencia entre familias.

## Trabajo restante

CI PostgreSQL/RLS y navegador; paginación y consultas con volumen; simulacros de carga/caída/reinicio y rollback aislados; backups automáticos; monitor externo con canal configurable; publicación de fixes y comprobación de despliegues. Este estado se actualizará al terminar las verificaciones.
