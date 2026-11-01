# Integración de las correcciones de preproducción

Estado: candidato local, publicación bloqueada hasta completar validación.

Telemetría comparte un contrato entre cliente y servidor y admite posiciones sanitizadas del bundle. Las alertas usan outbox privado persistente con reintentos, leases y registro de fallos. El arranque de desarrollo rechaza bases remotas sin configuración explícita de staging. La imagen incluye el contrato compartido.

Verificación de esta integración: 253 pruebas generales aprobadas, 0 fallidas y 3 omitidas; suite PostgreSQL ampliada: 23/23. La prueba PG detectó y corrigió la serialización de JSONB antes del POST de alertas, y comprueba grants/RLS, reinicio, lease vencida y dos workers concurrentes.

La primera corrida integrada de navegador tuvo 25/26 aprobadas y la de ruteo 3/4. Los fallos de acceso de chofer y propuesta de distribución están bajo investigación; no se consideran aceptados ni se sustituyen por pruebas aisladas.

El rollback candidato debe partir de 3a6444d para conservar las correcciones anteriores de devoluciones y permisos. El patch del backend v20 no es una recuperación operacional certificada.

El checklist sigue sin aprobarse: faltan cierre de esos ensayos, CI del candidato, monitor independiente, recepción real de alertas, política de backups/PITR/copia externa, revisión independiente de otra familia y validaciones humanas/físicas. Se pidió acceso al dashboard Supabase y contexto del receptor de alertas; no se solicitaron claves por chat.

No se aplicó la migración 22 a producción, ni se cambió su tráfico ni sus datos. No hay cambios de diseño de UI.
