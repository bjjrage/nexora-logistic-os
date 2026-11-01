# Auditoría preproducción Heavy Metal — NEXORA OS

**Veredicto: FAIL. No está aprobado el inicio de operación real según este checklist.**

Fuente: PDF aportado «Checklist pre-producción auditoría heavy metal-1.pdf», 8 páginas. Revisión del 31-10-2026 local / 01-11 UTC, sobre commit **3a6444dae7e0ec94e8f6e6161e2aede1f42cdb95**. Frontend y backend de producción devuelven ese mismo SHA. Se evaluaron 91 controles de las secciones 1–10 y los requisitos de proceso 11–12. Los títulos/requisitos de la matriz se normalizan desde la transcripción histórica del mismo checklist; la evidencia y los estados son de esta revisión, no se heredaron resultados antiguos.

Las secciones 1–4, 7 y 8 son bloqueantes en el PDF: PARCIAL/NO VERIFICADO no cuentan como aprobadas. Las otras secciones requieren pendientes documentados. No se calcula un porcentaje de «seguridad». Un test que reproduce un defecto puede pasar como prueba de auditoría: eso confirma el defecto, no lo corrige.

No se cambió código de aplicación, UI, configuración productiva ni datos productivos. Solo se crearon evidencia/pruebas locales ignoradas y este informe. La carga usó exclusivamente localhost/nexora_test con datos ficticios. No se enviaron código privado, credenciales o datos operativos a otra IA.

## Hallazgos concretos

### H1 — Alta: se pierden los errores del navegador con ubicación de código

**Hecho reproducido.** frontend/diagnostics.ts:1–6 agrega position al evento cuando el stack contiene /assets/index-*.js; frontend/main.tsx:5–6 y App.tsx:1409 usan esa función. server/app.ts:72 acepta solo kind/component/requestId con strict(): responde 400 y no emite client.error. Sin position responde 202. El fetch del cliente ignora respuestas no exitosas. Un fallo UI puede quedar invisible precisamente cuando se conoce su ubicación. Repro: telemetry-contract.test.ts, 1/1, archivo telemetry-contract.log. Corrección mínima: contrato compartido que admita únicamente posición sanitizada y acotada, gestionar rechazo de telemetría sin bucles y probar el payload generado por el cliente real. Verificar recepción y simbolización de error del bundle exacto antes de cerrar 7.1.

### H2 — Alta para aceptación operacional: alerta rechazada se pierde; monitor local deshabilitado

**Hechos.** server/alerts.ts:10–21 hace un POST, no comprueba response.ok y descarta rechazo de red; el throttle se marca antes del resultado. Simulación 503: un intento, ningún evento de entrega fallida/reintento, segundo error suprimido. Tarea Windows «Nexora OS - monitor local» está Disabled, último run 19-10 00:58 UTC, y es Interactive. No es un monitor independiente. ALERT_WEBHOOK_URL está definido en Railway; eso no demuestra recepción. Corrección mínima: verificar status, outbox durable y reintentos acotados con alerta de entrega fallida; monitor fuera de esta PC. Aceptación: error controlado, referencia correlacionada y recepción en celular <5 min, más ensayo de caída/latencia. No se provocó falla real en producción ni se mandó mensaje a terceros.

### H3 — Alta: rollback directo al backend anterior no puede arrancar

**Hecho reproducido sin tocar producción.** server/postgres.ts:92–95 exige exactamente versiones1…21; server/index.ts:19 lo ejecuta al arrancar. El método verify del commit previo **3e879dd905beb9a3bfa33bdd6d70a28f7a1b18ad** exige1…20. Se ejecutó ese método extraído de Git contra PG local versión21: rechaza «La base de Nexora no tiene las migraciones esperadas», mientras el actual acepta. La metadata real también confirma1…21. No se arrancó contenedor antiguo ni se redirigió tráfico: el fallo de su contrato de arranque se acreditó directamente. Corrección mínima: preparar un artefacto de rollback compatible con21 y ensayar migraciones aditivas/contrato expand-contract; no quitar la migración ni sus datos para hacer arrancar código viejo. Verificar backend, frontend compatible, permisos y conciliación en ensayo cronometrado.

### H4 — Alta: desarrollo local usa credencial del proyecto productivo

**Hecho de configuración, no prueba de escritura accidental.** El .env del checkout principal coincide con el proyecto productivo; NODE_ENV sin definir. Solo se emitieron booleanos, nunca URL/clave. server/index.ts:11 carga .env automáticamente; package.json:12 arranca ese servidor para desarrollo. No hay guardia que obligue a usar DB local/staging fuera de producción. Las suites CI sí están aisladas, lo que no evita un npm run dev conectado a producción. Corrección mínima: credenciales/proyecto separados y guardia de arranque; mantener acceso de operador productivo explícito y distinto. Verificar que el desarrollo rechace el destino productivo y no modifique datos reales.

### H5 — Bloqueo de configuración para salida real: modo de prueba activo

**Hecho confirmado por SELECT:** organization_test_mode.enabled=1 en la única organización configurada. server/domain.ts:432–455 y server/inventory.ts:852 permiten prueba de entrega sin foto. Fue una opción solicitada previamente para pruebas; no se presenta como activación desconocida ni se deshabilitó sin aviso. Antes de operar con pedidos reales debe apagarse y verificarse que una entrega sin evidencia sea rechazada; pruebas físicas y datos de ensayo deben distinguirse de operación real.

## Evidencia aprobada y límites

- [CI main del SHA desplegado](https://github.com/bjjrage/nexora-logistic-os/actions/runs/41263633434): 246 generales +22 PostgreSQL +26 navegador +4 ruteo = **298 aprobadas**; build, secretos, migraciones y contenedor/OR-Tools aprobados. Se verificó el log remoto actual, no un log local antiguo que tuvo un fallo previo.
- Pruebas de esta ronda: 16 auth/acceso existentes, 1 RLS PG existente y 3 auditorías nuevas (sesión/CRUD, políticas/definers, telemetría). Operaciones de rollback y alerta simulada documentadas en operations-result.json. No equivalen a suite exhaustiva de cada permiso y pantalla.
- Producción: sitio200, API200, ready DB/GPS connected, endpoints protegidos401 sin sesión, preview404; CSP/HSTS/DENY/nosniff en servicio real. Bundle público sin patrones de secretos privados. Ninguna tabla public/nexora sin RLS; runtime sin BYPASSRLS ni privilegios elevados. npm audit:0; Gitleaks: dos fixtures históricos sintéticos, no secreto real identificado.
- Backup privado previo a migración:69 tablas restauradas en PG local con conteos y hashes coincidentes; SHA256 a7b5d37dabd033c43e5ac7485d190c6d1f9bd20c613fdc9a575297d6c0a0decc. **No restaura Supabase Auth/plataforma ni demuestra PITR o copia externa semanal.** Dashboard Supabase pide login; no se acreditó su política automatizada con el conector disponible.
- Sin revisión Claude/Gemini: los subagentes Luna son de la misma familia GPT y **no satisfacen la independencia exigida por el PDF**. Sin20facturas reales manuales, aceptación con usuario nuevo ni prueba física nueva del iPhone. No se inventa conformidad legal/fiscal ni cobertura de esos controles.

## Matriz de los91controles

CUMPLE=probado para el alcance que se declara; PARCIAL=parte cubierta; NO=incumplimiento observado; NO VERIFICADO=falta evidencia o acceso para el ensayo; NO APLICA=capacidad ausente. Las equivalencias técnicas (sesión opaca, denegación por grants, fotos en DB) se explican; no se abren permisos ni se cambia arquitectura para cumplir literalmente una receta.

### 1. Autenticación y acceso — bloqueante

| ID | Control | Estado | Evidencia y alcance |
| --- | --- | --- | --- |
| 1.1 | RLS activado en todas las tablas del schema public. Verificar con SQL: select tablename, rowsecurity from pg_tables where schemaname='public'; — ninguna en false. | **CUMPLE** | SQL actual: ninguna tabla public/nexora sin RLS. El runtime no tiene BYPASSRLS, superusuario, membresías ni creación de roles/bases. |
| 1.2 | Cada tabla tiene políticas para SELECT, INSERT, UPDATE y DELETE por separado. Una tabla con RLS activo y sin políticas bloquea todo; una con using (true) abre todo. | **PARCIAL** | Políticas y grants revisados; portal autenticado limitado a lectura/alta propia, DELETE/UPDATE denegados cuando corresponde. Runtime servidor tiene acceso amplio por diseño. No se implementan cuatro políticas separadas por tabla: no se propone habilitar verbos innecesarios. |
| 1.3 | Correr el Security Advisor de Supabase (get_advisors) y dejarlo en cero warnings de seguridad. | **NO** | Advisor actual: 1 WARN auth_leaked_password_protection deshabilitada; 1 INFO registro privado con RLS sin política (denegación deliberada). El WARN no demuestra una filtración ni protege por sí solo el login propio del OS. |
| 1.4 | Test de acceso cruzado: crear usuario A y usuario B. Con el token de B, intentar leer, editar y borrar cada recurso de A vía API directa (no por la UI). Todo debe fallar. | **PARCIAL** | Pruebas API de CRUD entre organizaciones y matriz representativa aprobadas; no se ensayó cada recurso × cada verbo × cada rol. Ver access.md y auth-session-access.test.ts. |
| 1.5 | Test de escalada: un usuario normal intenta cambiar su propio role, tenant_id o owner_id con un UPDATE. Debe fallar. | **CUMPLE** | DEPOT no puede crear ADMIN ni suplantar organización; SQL authenticated no puede cambiar membresía/rol, runtime no puede escribir org_owners. Regresiones HTTP/PG aprobadas. |
| 1.6 | Vistas y funciones security definer revisadas una por una: saltean RLS. | **CUMPLE** | Cuatro funciones revisadas: lookup_public_tracking, lookup_public_gps, portal_registered_user, register_individual. search_path vacío y privilegios previstos verificados; dos tracking son intencionalmente públicos mediante código portador. Auditoría PG local + metadatos reales. |
| 1.7 | Storage buckets: privados por defecto, políticas por usuario, URLs firmadas con expiración. | **NO APLICA** | storage.buckets vacío; fotos privadas en PostgreSQL bytea y descarga autenticada. No hay URLs de Supabase Storage que firmar. |
| 1.8 | Endpoints del backend en Railway verifican el JWT en cada request y sacan el user_id del token, nunca del body. | **CUMPLE** | Control equivalente: sesión opaca aleatoria HttpOnly, hash persistido, actor/rol/organización obtenidos de DB en cada request. No se cambia a JWT por exigencia literal sin necesidad. |
| 1.9 | Sesiones: expiración del token, refresh funcionando, logout invalida la sesión. | **PARCIAL** | Expiración 12 h, cuenta deshabilitada rechazada y logout revoca sesiones: probados. No hay refresh/renovación automática. |
| 1.10 | Recuperación de contraseña: link de un solo uso, expira, no revela si el email existe. | **CUMPLE** | Recuperación emitida por administrador, no autoservicio por email: token hash, 15 min, un uso, revoca sesiones y error genérico; tests aprobados. |
| 1.11 | Multi-tenant (Mussi, Control de Facturas): cada query filtra por tenant también en el backend, no solo en RLS. | **PARCIAL** | Consultas revisadas filtran organización y cliente/asignación; tests cruzados aprobados. No se certifica exhaustivamente cada SQL/RPC y verbo del sistema. |

### 2. Secretos y configuración — bloqueante

| ID | Control | Estado | Evidencia y alcance |
| --- | --- | --- | --- |
| 2.1 | La service_role de Supabase nunca aparece en el frontend. Buscar en el bundle de producción de Vercel: grep -r "service_role\/eyJ" dist/. | **CUMPLE** | Bundle real servido index-Di93lH4N.js: 571.568 caracteres; sin patrones service_role/sb_secret_/sk-proj-/JWT. Sin credenciales privadas detectadas; escaneo por patrones no prueba ausencia matemática. |
| 2.2 | Solo variables VITE_/NEXT_PUBLIC_ que sean públicas por diseño (URL y anon key). Todo lo demás vive en Railway. | **CUMPLE** | Escaneo fuentes/artefacto y variables públicas: secretos no expuestos por VITE_/NEXT_PUBLIC_. Railway solo permite leer nombres vía OAuth; no se imprimieron valores privados. |
| 2.3 | Escanear el historial de git por secretos (gitleaks o trufflehog). Si alguna key estuvo commiteada alguna vez, se rota, aunque la hayas borrado. | **CUMPLE** | Gitleaks oficial 8.30.1 (checksum coincide), --all --full-history: 99 commits, 3,40 MB, dos coincidencias históricas de contraseñas sintéticas QA en tests/flow.test.ts:150/159. No se identificó secreto privado real. Scanner propio: 992 blobs sin coincidencias. No cubre objetos remotos inaccesibles. |
| 2.4 | .env en .gitignore y un .env.example sin valores. | **CUMPLE** | .env y .local ignorados; solo .env.example rastreado, sin credenciales reales. |
| 2.5 | Keys separadas por entorno: dev, staging y producción nunca comparten credenciales. | **NO** | El .env del checkout principal apunta al mismo proyecto Supabase de producción y NODE_ENV está sin definir. server/index.ts carga ese archivo automáticamente. Tests sí usan nexora_test aislado; eso no aísla npm run dev. Se leyeron únicamente booleanos de coincidencia. |
| 2.6 | Keys de OpenAI/Anthropic/Twilio con límite de gasto configurado en el proveedor. | **NO APLICA** | Sin OpenAI/Anthropic/Twilio en el OS auditado. |
| 2.7 | Errores en producción no devuelven stack traces ni mensajes de la base al cliente. | **CUMPLE** | Errores inesperados responden mensaje fijo + referencia; logs no incluyen mensaje/cuerpo/query. Tests observability y producción revisados. |
| 2.8 | Modo debug, endpoints de prueba y seeds desactivados en producción. | **NO** | SQL producción: organization_test_mode.enabled=1; permite cierre sin foto. Preview endpoint sí responde 404, setup protegido y NODE_ENV=production acreditado por Dockerfile + headers efectivos. Modo de prueba activo es incompatibilidad con salida real, no cambio no autorizado realizado por la auditoría. |

### 3. Entradas y ataques — bloqueante

| ID | Control | Estado | Evidencia y alcance |
| --- | --- | --- | --- |
| 3.1 | Validación con schema (Zod o similar) en el backend para cada endpoint. La validación del frontend es solo UX. | **PARCIAL** | Zod y validadores especializados revisados y probados; falta inventario exhaustivo de schema por endpoint/cada parámetro. Además se reprodujo un contrato demasiado estricto que rechaza telemetría válida (hallazgo H1). |
| 3.2 | Queries parametrizadas siempre. Cero SQL armado con concatenación de strings, incluidas las funciones RPC. | **CUMPLE** | Valores parametrizados; identificadores dinámicos se limitan a listas internas o esquema con regex. Definers sin SQL dinámico de usuario revisados. No se confunden identificadores controlados con inyección. |
| 3.3 | XSS: ningún dangerouslySetInnerHTML con contenido de usuario sin sanitizar (DOMPurify). | **CUMPLE** | Escaneo estático frontend/server/api/deploy sin dangerouslySetInnerHTML, innerHTML, eval ni sinks equivalentes con texto de usuario. React escapa texto. No equivale a fuzzing de cada pantalla. |
| 3.4 | Uploads: tipo validado por contenido (no por extensión), tamaño máximo, nombres regenerados, nunca ejecutables. | **CUMPLE** | Fotos JPEG/PNG/WebP con firma, máximo 5 MiB e identificador propio; descarga nosniff/CSP sandbox. Planillas limitan filas/columnas/ZIP y expansión. Validar firma no es decodificación completa ni antivirus. |
| 3.5 | Rate limiting en login, registro, recuperación de contraseña, envío de WhatsApp/SMS y cualquier endpoint que llame a una API de IA. | **PARCIAL** | Login 20/IP/min y 10/usuario/5 min, recuperación/telemetría limitadas. Contadores en memoria: reinicio los restablece y no comparten réplicas. Una réplica actual; no limitador general para uploads/webhook. |
| 3.6 | CORS con lista explícita de dominios. Nunca * en un endpoint con credenciales. | **CUMPLE** | Mutaciones exigen cabecera propia y Origin permitido; sin CORS wildcard con credenciales en API. Vercel estático devuelve wildcard sin credentials: contenido público, no una apertura de la sesión API. |
| 3.7 | Webhooks (Twilio, pagos): verificar la firma del proveedor en cada llamada. | **CUMPLE** | QuadMinds HMAC-SHA256/timingSafeEqual, cuerpo raw acotado y replay por hash; integración hoy deshabilitada. No hay pasarela de pago/Twilio. Contrato real QuadMinds pendiente si se activa. |
| 3.8 | Prompt injection: si un usuario escribe texto que termina en un prompt (bots, CRM), el modelo no puede ejecutar acciones ni leer datos de otros usuarios por instrucciones de ese texto. | **NO APLICA** | No hay modelo con herramientas ni prompts de usuarios en el OS. |
| 3.9 | Headers de seguridad en Vercel: CSP, X-Frame-Options, HSTS. Verificar en securityheaders.com. | **CUMPLE** | GET reales de Vercel y Railway acreditan CSP, HSTS, DENY y nosniff. Se verificaron headers directamente; no se solicitó nota del sitio securityheaders.com. |
| 3.10 | Dependencias: npm audit sin vulnerabilidades críticas o altas. | **CUMPLE** | npm audit actual: 0 vulnerabilidades reportadas. No cubre vulnerabilidades no publicadas ni código propio. |

### 4. Integridad y negocio — bloqueante

| ID | Control | Estado | Evidencia y alcance |
| --- | --- | --- | --- |
| 4.1 | Montos en enteros (guaraníes no tienen decimales) o numeric en Postgres. Nunca float para dinero. | **CUMPLE** | Proformas con entrada PYG entera, multiplicación/redondeo BigInt y total BIGINT/INTEGER acotado; no emisión fiscal activa. |
| 4.2 | Redondeo de IVA (5% y 10%) definido en un solo lugar y testeado contra 20 facturas reales calculadas a mano. | **PARCIAL** | Cálculo IVA inclusivo centralizado 5/10 y regresiones aprobadas. Faltan 20 facturas REALES calculadas a mano y validación fiscal; no se sustituyeron por ejemplos sintéticos. Emisión fiscal permanece bloqueada. |
| 4.3 | Timezones: guardar en UTC (timestamptz), mostrar en America/Asuncion. Testear cambio de horario, fin de mes y fin de año. | **PARCIAL** | UTC TIMESTAMPTZ/ISO + zona IANA America/Asuncion. No se encontró batería dedicada completa de DST, fin de mes y fin de año. |
| 4.4 | Idempotencia: doble clic en "guardar", "pagar" o "enviar" no duplica el registro. Testearlo a propósito. | **CUMPLE** | Comandos idempotentes por organización/actor/payload, resultados persistidos y pruebas de reintento/concurrencia incluidas en CI. No se afirma triple clic de cada botón. |
| 4.5 | Operaciones de varios pasos dentro de una transacción: si falla el paso 3, los pasos 1 y 2 se revierten. | **CUMPLE** | Recepción: fallo inyectado en segundo movimiento y en escritura final revierte balances, ledger e historial. PostgreSQL rollback y savepoints; portal aceptación transaccional cubierto. No se inyectó fallo en cada escritura de todo el sistema. |
| 4.6 | Constraints en la base, no solo en el código: not null, unique, foreign keys, check (ej. monto > 0). | **CUMPLE** | FK compuestas, NOT NULL, CHECK de cantidades/estados, exclusiones de chofer/camión y unicidad de asignación activa; PG tests de concurrencia/409 aprobados. JSON de proformas validado en servidor. |
| 4.7 | Concurrencia: dos usuarios editan el mismo registro a la vez. Definir quién gana y testearlo. | **CUMPLE** | Versiones y transacciones serializadas con advisory lock, conflicto devuelve error; tests PG acreditan solo una reserva/asignación válida. Dos pestañas físicas no ejecutadas en esta ronda. |
| 4.8 | Borrado: soft delete donde haya datos clínicos o contables; nada se borra en cascada sin querer. | **CUMPLE** | Cuentas deshabilitadas con tombstone, proformas VOID e historiales inmutables. No se borró operación ni se habilitaron cascadas de historial. |
| 4.9 | Reconciliación: un script que compara totales (ventas, saldos, stock) contra la suma de los movimientos y alerta si no cierra. | **PARCIAL** | Conciliación cantidades/series/devoluciones con regresiones y resultado producción ok de release. Mismatch emite evento, pero alerta externa puede perderse (H2); no motor contable fiscal activo. |

### 5. Servicios externos

| ID | Control | Estado | Evidencia y alcance |
| --- | --- | --- | --- |
| 5.1 | Timeout explícito en cada llamada externa (ej. 10 s para APIs de IA, 5 s para el resto). Sin timeout, un servicio lento cuelga tu servidor. | **CUMPLE** | Deadlines explícitos en clientes externos, DB y frontend. Respuestas routing/relay/creación Traccar no tienen todos un tope de bytes. |
| 5.2 | Reintentos con backoff exponencial y límite (máx. 3), solo en operaciones idempotentes. | **PARCIAL** | Procesos idempotentes en varios conectores; cola QuadMinds persistente carece de backoff/techo de intentos. Alertas backend son best-effort sin reintento. |
| 5.3 | APIs de IA: fallback a otro proveedor o modelo, y un mensaje claro al usuario si ambos fallan. | **NO APLICA** | Sin proveedor IA. |
| 5.4 | Respuestas de IA validadas: si esperás JSON, parsear con schema y manejar el caso de basura. | **NO APLICA** | Sin salida JSON de IA. |
| 5.5 | Colas para lo que no tiene que ser inmediato (emails, WhatsApp, reportes): si el proveedor cae, se reintenta después sin perder el mensaje. | **PARCIAL** | Exportaciones QuadMinds tienen cola/lease persistidos; no política común durable para todos los trabajos/reportes. Integración QuadMinds deshabilitada actualmente. |
| 5.6 | Test de caída: apuntar cada variable de API a una URL inválida en staging y usar la app. Ninguna pantalla debe quedar en blanco ni cargando para siempre. | **PARCIAL** | Tests de conectores con fallos/deadlines y frontend API con timeout; no se recorrió cada pantalla en staging con cada proveedor invalidado. |
| 5.7 | Supabase o Railway caído: la app muestra un estado de error claro, no un crash. | **PARCIAL** | Manejo de error/timeout en frontend y API probado; sin corte físico de Railway/Supabase de producción. Pruebas de caída real quedan pendientes en staging. |

### 6. Carga y fallos

| ID | Control | Estado | Evidencia y alcance |
| --- | --- | --- | --- |
| 6.1 | Test de carga con k6 o Artillery: 10x tu uso esperado durante 10 minutos. Anotar tiempo de respuesta p95 y tasa de error. | **PARCIAL** | Carga local 10 min, 10 usuarios simultáneos, solo lecturas/bootstrap. Herramienta propia equivalente, no k6/Artillery; supuesto 10× un usuario piloto, demanda real esperada no definida. Resultado al pie. |
| 6.2 | Base con volumen real: 100.000 registros en las tablas principales. Revisar que listados y búsquedas sigan respondiendo en menos de 1 s. | **PARCIAL** | 100.000 pedidos +100.000 bultos ficticios; benchmark de listado/bootstrap al pie. No búsqueda por texto medida ni todos los volúmenes/consultas de negocio. |
| 6.3 | Índices en todas las columnas usadas en where, join y order by. Revisar consultas lentas en los logs de Supabase. | **PARCIAL** | EXPLAIN/BUFFERS local capturado. Advisor producción: 100 INFO de FK sin índice cubriente y 9 índices sin uso; no implican automáticamente consultas lentas, requieren medir patrones reales. |
| 6.4 | Listados con paginación. Nunca un select * sin límite. | **PARCIAL** | Listas paginadas y detalle completo de ruta corregido; no se certifica ausencia de toda agregación o select sin límite. Detalle de ruta autoriza relación completa por necesidad, no bootstrap global. |
| 6.5 | Límite de conexiones de Postgres: usar el pooler de Supabase desde Railway. | **PARCIAL** | Pool servidor max=5, conexión/statement deadlines. OAuth Railway no revela host efectivo de conexión para acreditar pooler; .env principal usa conexión directa. |
| 6.6 | Doble y triple clic en cada botón de acción. | **PARCIAL** | Idempotencia API/dominio y botones busy; no doble/triple clic ejecutado sobre cada acción de cada pantalla. |
| 6.7 | Botón atrás del navegador a mitad de un formulario o un pago. | **NO VERIFICADO** | No se ejecutó navegación Atrás en medio de cada formulario; no hay pagos activos. |
| 6.8 | La misma cuenta abierta en dos pestañas editando lo mismo. | **PARCIAL** | Concurrencia PostgreSQL probada; faltan dos pestañas reales sobre todos los formularios editables. |
| 6.9 | Campos con: vacío, espacios, 10.000 caracteres, emojis, ñ y tildes, <script>, comillas, números negativos, fechas imposibles. | **PARCIAL** | Esquemas y corpus inválido en tests; no corpus exhaustivo para cada campo de todo el OS. |
| 6.10 | Cortar internet a mitad de una operación y reconectar. | **NO VERIFICADO** | No se cortó red durante una mutación y reconectó con usuario físico. |
| 6.11 | Celular viejo con 3G lento (throttling en DevTools). | **NO VERIFICADO** | Sin aceptación en celular viejo con 3G. |
| 6.12 | Sesión expirada mientras el usuario llena un formulario largo: ¿se pierde lo que escribió? | **PARCIAL** | Sesión expirada rechazada y evento session-expired; preservación de formulario largo no validada punta a punta. |
| 6.13 | Pasarle la app a alguien que nunca la vio, sin explicarle nada, y mirar sin intervenir. | **NO VERIFICADO** | No se puede sustituir una prueba con una persona nueva por revisión de agente. |
| 6.14 | Reiniciar el servidor de Railway en medio de operaciones en curso. | **NO VERIFICADO** | No se reinició Railway durante operación real. Ensayo debe hacerse en staging controlado. |
| 6.15 | Llenar un bucket de storage o pasar el límite de una API para ver qué pasa. | **NO VERIFICADO** | No se consumieron cuotas reales a propósito; Storage no se usa. |
| 6.16 | Dejar que la IA auditora intente romper la app con un pentest guiado, dándole la URL de staging y dos usuarios de prueba. | **PARCIAL** | Pruebas adversariales A/B en HTTP/PG local. No pentest completo de URL staging con auditor de otra familia. |

### 7. Observabilidad — bloqueante

| ID | Control | Estado | Evidencia y alcance |
| --- | --- | --- | --- |
| 7.1 | Sentry (o similar) en frontend y backend, con source maps subidos para ver la línea exacta del error. | **NO** | H1 reproducido: position enviado por frontend es rechazado 400 y no se registra client.error. Mapas de fuente ocultos generados, excluidos del paquete Vercel; no carga acreditada a tracker privado. |
| 7.2 | Cada error capturado incluye: user_id, ruta, versión del deploy y los datos de entrada (sin contraseñas ni datos clínicos). | **PARCIAL** | Logs backend incluyen user/org/request/release y frames sanitizados. Errores UI con posición se pierden; sin contexto frontend completo registrado. Se evita registrar inputs personales por diseño. |
| 7.3 | Logs estructurados en JSON en Railway, con un request_id que viaja del frontend al backend y a la base. | **PARCIAL** | Frontend envía X-Request-Id, backend correlaciona JSON y respuesta, logs reales con release/user. No hay propagación comprobada de request_id a cada consulta DB. |
| 7.4 | Endpoint /health que verifica base, storage y APIs críticas. Monitoreado desde afuera cada 1 minuto (UptimeRobot, Better Stack). | **NO** | /api/ready actual comprueba DB y GPS y devuelve 200. Tarea Windows monitor está Disabled, último run 19-10 UTC; depende de PC/sesión. No monitor externo independiente cada minuto acreditado. |
| 7.5 | Alertas a tu celular (WhatsApp, Telegram o push) para: app caída, pico de errores, endpoint lento, gasto de API anormal. | **NO VERIFICADO** | ALERT_WEBHOOK_URL figura en Railway, valor oculto. Sin confirmación de entrega al celular ni alertas verificadas de latencia/gasto. El sink pierde rechazos HTTP (H2). |
| 7.6 | Alertas de negocio, no solo técnicas: "cero ventas registradas en 6 horas" o "factura con monto negativo" detectan fallas silenciosas. | **PARCIAL** | Conciliación emite inventory.mismatch bajo consulta; sin monitoreo programado acreditado, y entrega de alerta no confiable. |
| 7.7 | Logs de auditoría en la base para acciones sensibles: quién creó, editó o borró qué y cuándo. | **CUMPLE** | Comandos sensibles guardan actor/operación/fecha/audit en misma transacción; custodia y ledger protegidos. No se afirma auditoría de cambios externos de proveedores. |
| 7.8 | Probar el circuito completo: provocar un error a propósito en producción y confirmar que te llega la alerta en menos de 5 minutos. | **NO VERIFICADO** | No se provocó error real en producción ni se confirmó recepción en celular <5 min. Se reprodujo rechazo de alerta con fetch simulado, sin contactar destino real. |

### 8. Recuperación y migraciones — bloqueante

| ID | Control | Estado | Evidencia y alcance |
| --- | --- | --- | --- |
| 8.1 | Backups diarios de Supabase activos. Para datos clínicos o contables, Point-in-Time Recovery (plan Pro). | **NO VERIFICADO** | Dashboard Supabase exige login; conector no expone política backups/PITR. Backup local diario Ready/Interactive (último run 31-10 06:30 UTC) no acredita backup administrado de plataforma/PITR. |
| 8.2 | Restore probado: restaurar un backup en un proyecto aparte y verificar que los datos están completos. Un backup que nunca restauraste no existe. | **PARCIAL** | Dump privado y restore PostgreSQL local: 69 tablas, conteos/hashes coinciden. No se restauró plataforma Supabase Auth ni proyecto Supabase aparte; no es recuperación integral de plataforma. |
| 8.3 | Backup externo semanal (pg_dump a otro proveedor), por si perdés acceso a la cuenta. | **NO VERIFICADO** | Sin evidencia de backup semanal cifrado en otro proveedor y prueba de recuperación de acceso. Copia local no sustituye ese requisito. |
| 8.4 | Rollback del frontend: saber hacer "Instant Rollback" en Vercel en menos de 1 minuto. Practicarlo una vez. | **NO VERIFICADO** | Hay procedimiento y plataforma Vercel actual; no práctica cronometrada de rollback frontend <1 min para esta release y compatibilidad API. No se cambió tráfico productivo para simularla. |
| 8.5 | Rollback del backend: redeploy del commit anterior en Railway, practicado. | **NO** | H3: método verify real del commit anterior 3e879dd rechaza DB versión21. Repro en PostgreSQL local con misma versión de esquema actual. Redeploy directo del anterior no es rollback operativo disponible. |
| 8.6 | Migraciones versionadas en el repo, nunca cambios a mano en el dashboard de producción. | **CUMPLE** | 25 migraciones Supabase versionadas; lista remota de versiones/nombres coincide con repo; CI reconstruye PG desde cero. Historial alineado de migración21 en release anterior documentado. No se certifica un diff completo de todos los objetos remotos. |
| 8.7 | Toda migración se prueba primero en un branch de Supabase o en staging con copia de datos reales anonimizados. | **PARCIAL** | Todas las migraciones actuales se ejercitan en PG aislado CI. Restore real privado verificado aparte, no usado como staging. Sin branch Supabase ni copia real anonimizada ensayada antes de cada migración. |
| 8.8 | Migraciones destructivas (borrar columna, cambiar tipo) en dos pasos: primero dejar de usarla, después borrarla en otro deploy. | **NO VERIFICADO** | Migración21 es aditiva. No hay evidencia de ensayo completo expand/contract en dos despliegues de una migración destructiva. |
| 8.9 | Regla para la IA: ninguna operación de borrado o migración en producción sin backup del momento y tu confirmación explícita. | **CUMPLE** | Última migración tuvo autorización explícita y backup privado + restore verificado; esta auditoría no migró ni borró producción. Regla de autorización vigente no reemplaza un gate técnico de migración. |

### 9. Tests y CI

| ID | Control | Estado | Evidencia y alcance |
| --- | --- | --- | --- |
| 9.1 | Tests de los flujos críticos de punta a punta con Playwright: registro, login, crear el objeto principal (factura, consulta, lead), pago si existe. | **CUMPLE** | CI del SHA desplegado: 26 browser +4 routing; seis pedidos → dos camiones/choferes distintos → aprobación → carga → confirmación → checklist → despacho → seis entregas → cierre → conciliación. Pagos no existen. |
| 9.2 | Tests de la lógica de negocio: cálculos, permisos, estados. Cada bug encontrado en auditoría queda como test. | **PARCIAL** | 246 generales +22 PG en CI. Nuevos hallazgos tienen reproducciones locales (H1/H2/H3), aún sin corrección red/green ni integración al CI. |
| 9.3 | Tests de RLS automatizados (los de la sección 1) corriendo en cada cambio. | **CUMPLE** | tests/postgres.rls.ts corre en test:isolated del workflow principal/PR y chequeo estático de migraciones. Reejecución local adicional aprobada. |
| 9.4 | GitHub Actions corre todos los tests en cada push. Si falla, no se deploya a producción. | **PARCIAL** | CI main/PR exitoso y exigido aun a admins, sin force-push/borrado. Railway WaitCI live y Vercel checks configurados; no corre ante push de rama sin PR. No se provocó deploy fallido para ensayar el gate. |
| 9.5 | Deploys de preview de Vercel para probar cada cambio antes de mergear. | **PARCIAL** | Vercel enlazado a Git con checks; no se acreditó revisión de preview por cada cambio antes de merge. |
| 9.6 | Regla para la IA coder: no puede modificar ni borrar un test existente para que pase. Si un test debe cambiar, lo aprueba el auditor. | **NO VERIFICADO** | Nuevas pruebas de esta ronda solo en .local; no se alteraron tests existentes para ocultar fallos. No hay aprobación de auditor de otra familia para toda modificación histórica de tests. |

### 10. Privacidad y aspectos legales

| ID | Control | Estado | Evidencia y alcance |
| --- | --- | --- | --- |
| 10.1 | Inventario: qué datos personales guarda cada app, en qué tabla y quién puede verlos. | **CUMPLE** | Inventario interno tabla/dato/acceso en docs/DATOS_PERSONALES_Y_RECUPERACION.md. Retención final pendiente de aprobación. |
| 10.2 | Datos clínicos y documentos médicos nunca en logs, Sentry ni prompts a APIs de IA sin anonimizar. | **NO APLICA** | Sin datos clínicos ni prompts IA. Logs actuales evitan cuerpos/mensajes con datos personales. |
| 10.3 | Revisar la política de retención de datos de cada proveedor de IA que uses (si entrenan o no con tus datos). | **NO APLICA** | Sin proveedor IA en el OS. |
| 10.4 | HTTPS en todo y cifrado en reposo (Supabase lo trae; verificar storage también). | **PARCIAL** | HTTPS frontend/API real y PostgreSQL TLS CA validado; cifrado en reposo de todos los backups/volúmenes no acreditado. |
| 10.5 | Términos de uso y política de privacidad publicados antes del primer usuario real. | **NO VERIFICADO** | No se acreditaron textos vigentes publicados y aceptación/versionado antes de usuarios reales. Web pública aparte no se certificó legalmente aquí. |
| 10.6 | Consultar con un abogado la normativa vigente de protección de datos en Paraguay y, para Mussi, la de historia clínica. | **NO VERIFICADO** | Sin constancia de revisión con abogado de privacidad/GPS en Paraguay. No se emite opinión jurídica ni se afirma incumplimiento legal sin esa revisión. |
| 10.7 | Plan de exportación y borrado de datos de un usuario si lo pide. | **PARCIAL** | Procedimiento interno para identidad/exportación/rectificación/baja y reaplicación tras restore. Falta ensayo de exportación completa/supresión y política final de retención/respuesta. |

## Proceso11–12 y cierre

Existe registro de hallazgos, releases, regresiones, backup y resultados; falta consenso con auditor de otra familia y ensayo integral de recuperación/incidente. El protocolo de incidente está en docs/DATOS_PERSONALES_Y_RECUPERACION.md. No se siguieron prompts del PDF como órdenes para modificar producción.

Resumen de cobertura (sin porcentaje): CUMPLE: 30; PARCIAL: 33; NO: 6; NO APLICA: 7; NO VERIFICADO: 15. Los controles no son equivalentes en riesgo y estos conteos no certifican seguridad.

Orden de cierre: (1) corregir H1/H2/H3 y aislar entorno de H4 con tests red/green/CI; (2) monitor externo y entrega real de alertas; (3) verificar backups/PITR/copia externa y practicar recuperación compatible con la release21; (4) desactivar modo de prueba al pasar a operación real; (5) completar matriz de acceso, bordes de fecha, revisión IVA/fiscal si se habilita facturación, auditoría de otra familia y pruebas humanas/físicas. Reejecutar los controles afectados y repetir todos los bloqueantes que sigan parciales antes de declarar listo.

Artefactos privados bajo .local/security-checklist-2026-10-31/: access.md, inputs-secrets.md, business-integrity.md, main-ci.json/log, http-result.json, operations-result.json, telemetry-contract.log, gitleaks.json/log y matrix.json. Los valores privados y dumps no se incluyen en este informe ni en Git.

## Resultado de carga local

**Aprobado para las consultas ensayadas.** 100.000 pedidos +100.000 bultos ficticios, 10 usuarios concurrentes, 600504ms (~10min), **11526 requests, cero errores, p50=23ms, p95=275ms y p99=574ms**. EXPLAIN de listado25 filas:2,16ms con índice. Diez workers consultaron listado paginado y bootstrap, con pausa por usuario de500ms. No se midieron búsqueda textual, escrituras concurrentes a ese volumen, tráfico de red móvil ni capacidad de la instancia Railway/Supabase. Diez usuarios es el supuesto10×un piloto simultáneo; no es demanda comercial confirmada. Evidencia .local/load/result-heavy-metal.json, .local/load/plan-heavy-metal.json y load.log. Ninguna carga se dirigió a producción.
