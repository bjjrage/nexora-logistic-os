# Estabilización de los cuatro hallazgos

Referencia: `AUDITORIA_CODIGO_2026-10-31.md`, sobre el commit `3e879dd`. Ese informe conserva el diagnóstico original; este documento describe su implementación.

## Cambios de negocio

### Devoluciones, stock y custodia

Una devolución tiene una disposición final única y auditable: reintegrar a stock (`RESTOCKED`) o entregar al remitente (`SENT_TO_SENDER`). Los comandos verifican retorno, ubicación, custodia y vínculo de inventario dentro de su transacción; una disposición impide ejecutar la alternativa y los reintentos conservan idempotencia.

La entrega al remitente descuenta cuarentena, registra la salida en el ledger y termina el vínculo de inventario. Para series utiliza el estado existente fuera de stock `ADJUSTED`, con movimiento `RETURN` explícito; no se amplían ni reconstruyen las tablas históricas. La liberación reintegra a una ubicación disponible, registra su custodia y resuelve la incidencia.

La conciliación verifica también retorno, disposición, custodia y movimientos. La nueva tabla `return_dispositions` tiene claves foráneas por empresa, RLS y permisos SELECT/INSERT para runtime; no permite editar, borrar o truncar sus registros. La migración v21 es aditiva y no reinterpreta ni borra históricos. La API proyecta la disposición final sin alterar el estado histórico almacenado en `returns`.

### Detalle completo de ruta

`GET /api/routes/:id/detail` consulta la ruta autorizada y sus relaciones completas dentro de una transacción. El límite del resumen global no recorta sus bultos, paradas, asignaciones, productos, documentos o inspecciones. El chofer solo accede a sus rutas; una reasignación retira del chofer anterior las asignaciones y bultos correspondientes.

La pantalla existente carga ese detalle al abrir la ruta y lo actualiza después de cambios. Durante la lectura bloquea las operaciones que requerirían datos frescos. No se modifican estilos, colores, distribución de tarjetas ni navegación. Se conserva el resumen limitado para los listados generales.

### Contrato de credenciales

Las altas y la recuperación comparten usuario ASCII de 3–80 caracteres y contraseña de 6–128. El formulario de crear acceso refleja los mismos límites.

El login admite, por compatibilidad, nombres imprimibles históricos hasta 100 y contraseñas hasta 200; rechaza controles Unicode. Así, los accesos ya guardados pueden autenticarse sin renombrar usuarios, inventar contraseñas ni recrear choferes. Se prueba también la invalidación de sesión al suspender acceso.

## Validación y publicación

- Cada historia general de navegador tiene un servidor y SQLite en memoria nuevos; no hay endpoint de reset en producción.
- Las pruebas siguen el flujo vigente: reservar sin elegir ruta, organizar en Rutas, aprobar la distribución, cargar, confirmar, inspeccionar, despachar y registrar resultados.
- El CI instala OR-Tools fijado, ejecuta pruebas generales, PostgreSQL, build, navegador general, navegador de ruteo y construcción/comprobaciones de la imagen Docker.
- GitHub `main` exige `validate`, incluso para administradores; no permite force-push ni borrado de rama.
- Railway `nexora-logistic` tiene `Wait for CI` activado.
- Vercel exige en producción los checks GitHub `validate` y `resilient-contentment - nexora-logistic`: el frontend espera tanto el CI como el backend listo. Se conservan los dominios y su asignación automática.

Los tres controles remotos se configuraron con autorización explícita. No se desactivaron protecciones de acceso ni se incorporaron secretos al repositorio.

## Respaldo y conservación

Antes de la migración se creó, con autorización explícita, un respaldo privado de los esquemas `nexora`, `public` y `tracking_private` en `.local/backups-stabilization`, fuera de Git. La restauración de prueba se realizó en una base nueva de PostgreSQL local, sin sobrescribir producción ni otra base existente. Coincidieron los conteos y hashes de las 69 tablas incluidas.

El alcance no incluye credenciales/configuración de Supabase Auth ni otros componentes de plataforma; la restauración usa únicamente identidades de referencia locales para verificar las claves foráneas del portal. No certifica recuperación completa de esos servicios externos.

La migración no ejecuta DELETE, TRUNCATE, reconstrucción de tablas ni modificaciones de clientes, usuarios, pedidos, stock o históricos existentes. No se ejecutan operaciones logísticas ficticias en producción para validarla.

## Evidencia de pruebas

Los resultados locales y comprobantes de configuración se guardan en `.local/stabilization-2026-10-31`, excluido de Git. El CI adjunto al PR y al commit de `main` proporciona la evidencia reproducible de publicación. La liberación se considera terminada cuando ese CI está aprobado y `/release.json`, `/api/version` y readiness confirman la versión sincronizada.

Verificaciones locales de integración: 246 pruebas generales aprobadas, 22 PostgreSQL aprobadas, 26 historias de navegador general aprobadas, cuatro historias dedicadas al ruteo aprobadas y TypeScript sin errores. No se omitieron historias por dependencia de otra prueba. La suite dedicada incluye una historia con seis pedidos y dos camiones: identidades distintas de camión y chofer, aprobación humana, carga, confirmación, checklist, despacho, entrega de todas las paradas y cierre de ambos repartos. Se comprueban la conciliación final y la ausencia de asignaciones activas restantes. El caso de más de 500 bultos se verifica tanto en navegador como en PostgreSQL.

Los ensayos de navegador usan datos ficticios, mapas controlados y OR-Tools real. No sustituyen una prueba física nueva de un teléfono con pantalla bloqueada ni certifican tráfico o tiempos de viaje reales. El seguimiento Traccar y la arquitectura existente se conservan.
