# CRM-01 · Captación interna de NEXORA

[Issue #11](https://github.com/bjjrage/nexora-logistic-os/issues/11) · `feat/internal-crm-prospecting` · Base de producción `1e1ae275ed9a740d6c3a395e4ffea751fb6e9d19`

## Alcance y permisos

- La navegación del OS ofrece **CRM comercial** a `ADMIN` y `OPERATIONS`. La API deriva la organización de la sesión y aplica el mismo permiso. `CUSTOMER`, `DRIVER` y `DEPOT` quedan excluidos. Las tablas PostgreSQL exigen organización transaccional y tienen permisos solo para el runtime del OS.
- Empresas, contactos, tareas e historial tienen datos y relaciones propios del CRM. **Activado** registra una etapa comercial manual con motivo. El alta operativa conserva su flujo propio.
- El score mide completitud. Rubro 15, ubicación 15, presencia digital 25, canal de empresa 25 y origen o campaña 20. Las métricas se calculan sobre todos los resultados filtrados. Conversación, piloto y activación cuentan cada prospecto una vez a partir de su historial real.
- Las APIs del CRM usan `/api/crm`. El filtro, la paginación, la vista previa y el guardado se validan en servidor. El CSV importa filas válidas, muestra errores y duplicados por fila y exige volver a revisar si cambian sus resultados. Se conserva el identificador de comando para reintentos. Las interacciones son registros manuales. «No contactar» bloquea las llamadas, reuniones y mensajes asociados a ese contacto.
- Los cambios de etapa y el historial de interacciones son de solo anexado. El motivo de transición y el actor quedan registrados. Un descarte se reabre en Identificado. Las etapas activas pueden avanzar o retroceder de a un paso.

## Fuentes y estado en Project Brain

Se cotejaron [Contexto y decisiones](CONTEXTO_Y_DECISIONES.md), [Plan operativo del cliente](PLAN_OPERATIVO_CLIENTE.md) y el borrador local `docs/PROPUESTA_AMPLIACION_COMERCIAL_2026-11-21.md`. El borrador se consultó como evidencia y permanece en el workspace original. El CRM interno se ajusta a la issue y conserva el alcance y los permisos del portal operativo.

Project Brain identifica NEXORA OS4. El catálogo devuelve cero documentos canónicos, la memoria no está autorizada para lectura y el contexto de ejecución del proyecto no está configurado. La issue registra el bloqueo canónico anterior. El trabajo de la rama sirve para revisión técnica. La aceptación e integración requieren Preflight y aprobación humana.

## Migraciones y entrega

- SQLite usa `024_crm_prospecting.sql` y Supabase usa `20261122011028_crm_prospecting.sql`. Ambas crean las tablas e índices del CRM. La versión PostgreSQL se rastrea mediante el historial de Supabase y conserva la comprobación de versiones del núcleo logístico. En una entrega futura, aplicar la migración aprobada antes de habilitar el código del CRM.
- Railway producción sigue asignado a `main`. Los dos proyectos Vercel excluyen despliegues automáticos de la rama `feat/internal-crm-prospecting` mediante una regla específica en sus archivos de configuración.
- El bootstrap del OS muestra el CRM solo al personal autorizado y con el esquema verificado. En PostgreSQL se comprueban las tablas, la política RLS y los permisos del runtime. En SQLite se comprueban las tablas y la versión 24. Mientras falte el esquema, la API del CRM devuelve `503 CRM_NOT_READY` y el resto del OS sigue disponible. Al completar la migración, una nueva consulta puede habilitar el CRM.

## Regresiones de la revisión del PR #12

- La coincidencia por nombre y ubicación se conserva al agregar el primer correo u otro canal. Si ambas fichas carecen de ubicación, la coincidencia aparece como duplicado para revisión. La importación conserva la ficha original.
- El CSV del CRM informa comillas mal formadas por fila. Las filas válidas del mismo lote se pueden confirmar y conservan sus comillas escapadas y saltos de línea.
- Los perfiles sociales incompletos se rechazan. Un perfil válido se puede volver a guardar con su URL normalizada.
- La prueba del navegador comprueba que el menú oculta el CRM y que la API responde `503 CRM_NOT_READY` antes de registrar la migración. Luego recorre el módulo con el esquema listo. Las suites SQLite y PostgreSQL ejercitan las regresiones de datos.

## Validación local

- `npm test` con `ROUTING_PYTHON` apuntando a Python 3.12.15 y OR-Tools 9.15.6755 en el clon aislado. **256 aprobadas, 0 fallidas, 0 omitidas.** La prueba de CRM usa 2.500 prospectos, dos organizaciones, roles permitidos y denegados, reintentos concurrentes y métricas paginadas.
- `npm run test:isolated` con `PG_TEST_ADMIN_URL` en el PostgreSQL 17.11 de pruebas en loopback. **28 migraciones aplicadas en la base desechable y 25 pruebas aprobadas.** El CRM prueba 1.100 prospectos, RLS, integridad de referencias por organización y permisos del historial.
- `npm run build` y `npm run build:portal`. Ambos terminaron con código 0. Vite informó un aviso de tamaño del bundle.
- `node ../../node_modules/@playwright/test/cli.js test --output .local/crm-browser-final tests/e2e/crm.spec.ts tests/e2e/customer-portal.spec.ts`. **2 aprobadas en 29,1 s.** Incluye el CRM en escritorio y móvil y la regresión del portal CUSTOMER.
- `npm run check:secrets`, `npm run check:migrations` y `git diff --check`. Código 0.

La primera ejecución de Node detectó una sintaxis TypeScript incompatible con el runtime y la primera E2E encontró un selector ambiguo. Se corrigieron ambos puntos. El lanzamiento de PostgreSQL con `pg_ctl` falló por la restricción de tokens de Windows. El servidor de fixtures se ejecutó directamente como `postgres.exe` en loopback.
