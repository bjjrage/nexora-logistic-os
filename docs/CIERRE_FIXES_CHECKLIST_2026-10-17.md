# Cierre de fixes del checklist — 17/10/2026

El OS local incorpora las correcciones siguientes. Este informe reemplaza el estado provisional; la auditoría original se conserva como evidencia anterior a los fixes. No equivale a certificar todos los puntos del checklist ni a cerrar las dependencias externas.

## Correcciones y evidencia

| Área | Resultado |
|---|---|
| Portal de clientes | Aceptación de solicitudes en transacción: un fallo revierte envío, paquetes e idempotencia. Concurrencia sin duplicar envíos. |
| Permisos | Pruebas de roles, aislamiento entre organizaciones/clientes y RLS en PostgreSQL. El chofer ve sus asignaciones aunque existan más de 500 registros ajenos recientes. |
| Catálogo, stock y pedidos | Paginación y búsqueda en servidor. Escaneo busca el código fuera de la primera carga del catálogo. Portal del cliente conserva los totales completos. |
| Recuperación de acceso | Administrador genera enlace privado de 15 minutos, de un uso; se guarda solamente su hash. Al usarlo se revocan sesiones. Emisión y consumo auditados. |
| Sesión vencida | Reingreso de la misma cuenta conserva el formulario abierto. |
| Diagnóstico | Identificador de solicitud, errores genéricos al usuario, registros estructurados sin cuerpos ni contraseñas, límite de eventos y panel de administración. |
| Inventario | Conciliación de saldos contra movimientos, por cantidad y por serie. Reporta diferencias; no modifica stock automáticamente. |
| Disponibilidad | Endpoint de readiness comprueba base y GPS configurado. Monitor local registra cambios tras tres fallos consecutivos. |
| Seguridad HTTP | CSP/HSTS en el servidor de producción del OS; endpoint de preview deshabilitado en producción. Proxy confiable explícito y límites de intentos. |
| Base de datos | Migraciones 11–13 aplicadas en Supabase: recuperación, índices y auditoría del autorizante. Baseline histórico recuperado para instalaciones reproducibles. |

Verificación local: 115 pruebas unitarias/de integración aprobadas, 12 pruebas PostgreSQL del conjunto anterior y la prueba nueva de paginación/recuperación aprobadas; dos pruebas de navegador completan recepción, sesión vencida, despacho, foto, entrega y cierre. Build TypeScript/Vite aprobado. Web pública: 19 pruebas aprobadas. Auditoría npm sin vulnerabilidades reportadas en ambos proyectos. El workflow de GitHub ejecuta también PostgreSQL aislado y navegador.

## Rendimiento medido

Prueba local aislada de diez minutos, con 100.000 envíos y 100.000 paquetes, diez usuarios virtuales. Son datos ficticios, no producción; no certifica capacidad de Railway ni todas las pantallas.

| Medida | Antes | Después |
|---|---:|---:|
| Solicitudes | 3.401 | 11.544 |
| Errores | 0 | 0 |
| p50 | 643 ms | 29 ms |
| p95 | 10.156 ms | 363 ms |
| p99 | 12.351 ms | 889 ms |

Se limitaron cargas y agregados, y se agregaron índices para los listados. Algunos históricos del bootstrap siguen acotados; no se afirma paginación universal de todos los módulos.

## Backup y restauración

Backup privado autorizado en `.local/backups`, excluido de GitHub. Última copia verificada: `2026-10-17T06-30-02-320Z`; restaurada únicamente en una base PostgreSQL local nueva. Coincidieron cantidad de filas y hash de contenido de las **59 tablas**. SHA-256 del dump: `4daab8c6452f3214d80e3f522ce9494a0be06fa5551031304d783d9c0f2c2704`.

El dump cubre esquemas del OS, portal y GPS; no restaura credenciales/configuración de Supabase Auth ni objetos de Storage. Las identidades requeridas por claves foráneas se representan mediante placeholders locales sin credenciales.

Tareas de Windows instaladas: backup diario a las 03:30 y monitor cada minuto. Requieren PC y sesión de Windows activos. El monitor local no detecta desde afuera que la propia PC se apagó. No reemplazan backup externo ni monitoreo independiente. Los límites de intentos en memoria requieren adaptación si se despliega más de una instancia.

## Publicación y pendientes reales

- Web pública: commit `47c4d14beac4caeb26dd1614ee9f02ca28c1604e` publicado en GitHub, workflow Pages aprobado. La dirección usada en Netlify todavía sirve la versión anterior: falta publicar allí el paquete corregido. No se consideran activos sus nuevos headers hasta comprobar esa dirección.
- Correo: el usuario confirmó que aún no tiene servicio de envío. El monitor registra incidentes, pero las alertas por correo **no están activas**. Falta proveedor y configuración privada.
- QuadMinds queda último: faltan endpoint/contrato y credencial de Universo; no se simula una conexión real.
- La prueba con GPS físico del celular sigue requiriendo confirmar recepción real desde ese dispositivo. Las pruebas automatizadas no sustituyen esa comprobación.
- Supabase Advisor conserva un aviso de protección contra contraseñas filtradas en Supabase Auth. El OS usa su autenticación propia con scrypt; no se cambió el plan ni se activó una función no disponible. Ver [documentación oficial](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Quedan revisión legal de políticas/retención, validación independiente y ensayo del entorno definitivo de producción, incluyendo recuperación de servicios externos y rollback de hosting. No se inventan plazos legales ni se declara producción irrestricta.

Consultar también `DATOS_PERSONALES_Y_RECUPERACION.md` para datos tratados, roles y procedimientos.
