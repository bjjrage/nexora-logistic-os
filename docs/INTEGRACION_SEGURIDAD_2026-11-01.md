# Integración de las correcciones de preproducción

Estado: candidato en PR #2. Publicación bloqueada por decisión explícita del usuario de mantener Supabase Free sin backups administrados.

Telemetría comparte un contrato entre cliente y servidor y admite posiciones sanitizadas del bundle. Las alertas usan outbox privado persistente con reintentos, leases y registro de fallos. El arranque de desarrollo rechaza bases remotas sin configuración explícita de staging. La imagen incluye el contrato compartido.

Verificación de esta integración: 253 pruebas generales aprobadas, 0 fallidas y 3 omitidas; suite PostgreSQL ampliada: 23/23. La prueba PG detectó y corrigió la serialización de JSONB antes del POST de alertas, y comprueba grants/RLS, reinicio, lease vencida y dos workers concurrentes.

La primera corrida integrada de navegador tuvo 25/26 aprobadas y la de ruteo 3/4. La propuesta esperaba solo 5 segundos aunque el solver real requiere aproximadamente 3,5 segundos más modelado/UI: se acotó esa espera a 15 segundos, sin cambiar el solver. La prueba de acceso de chofer ahora comprueba sesión ADMIN y espera navegación visible. Repetición completa: navegador 26/26 y ruteo 4/4, incluyendo seis reservas, dos equipos distintos, aprobación humana, carga, confirmación, inspección, despacho, seis entregas y cierre de ambas rutas.

El rollback candidato parte de 3a6444d para conservar las correcciones anteriores de devoluciones y permisos. Ensayo en clon aislado con gate 21/22: 243 pruebas generales aprobadas, build aprobado, 10 pruebas PostgreSQL aprobadas en DB22 y proceso real con health 200 y bootstrap anónimo 401. El patch reproducible es rollback-3a6444-schema22.patch. No se borraron migraciones ni operación productiva. Este ensayo local no equivale a redirigir tráfico real en Railway.

El checklist sigue sin aprobarse: faltan CI del candidato, monitor independiente, recepción real de alertas, protección de backups/PITR/copia externa, revisión independiente de otra familia y validaciones humanas/físicas. El dashboard autenticado de Supabase confirmó que el plan Free no incluye backups del proyecto. El usuario eligió mantener bloqueada la publicación; no se contrató un plan ni se alteró tráfico. El modo de prueba de producción permanece activo, por lo que no se certifica operación real ni entrega sin evidencia.

No se aplicó la migración 22 a producción, ni se cambió su tráfico ni sus datos. No hay cambios de diseño de UI.
