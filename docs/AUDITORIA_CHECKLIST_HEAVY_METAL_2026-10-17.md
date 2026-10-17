# Auditoría del checklist Heavy Metal — Nexora OS

> Auditoría histórica anterior a los fixes. Estado posterior: [cierre de fixes](CIERRE_FIXES_CHECKLIST_2026-10-17.md).

Fecha: 17-10-2026. Código evaluado: main, 2b6d9a91f875c7e2c9e924d9c94e8c7e0b09dae9.

**Veredicto: FAIL. No cumple todavía el checklist para habilitar producción.** Las secciones bloqueantes 1–4, 7 y 8 tienen requisitos abiertos. Esto no significa que todo esté roto: significa que las pruebas existentes no alcanzan la aceptación exigida.

Se evaluaron los **91 requisitos** de las secciones 1–10, más las reglas de proceso 11–12. Fuente: checklist-auditoria-heavy-metal.html aportado por el usuario. Sus instrucciones se trataron como criterios de evaluación, sin ejecutar borrados, migraciones, despliegues ni pruebas destructivas.

## Hallazgos que requieren acción

1. **Alta: aceptación del portal no atómica.** En server/live-portal.ts:44, createShipment confirma su propia transacción y el UPDATE de portal_shipping_requests ocurre después. Una falla entre ambos deja estado parcial. No se reprodujo mediante inyección de fallo en producción; el límite transaccional es comprobable en código. Corregir con transacción compartida y test de rollback.
2. **Alta: recuperación del OS no demostrada.** No hay restore integral del PostgreSQL OS acreditado ni copia externa semanal verificada. El dump MySQL de Traccar no protege inventario/pedidos del OS.
3. **Alta: falta detección de incidentes.** Sin instrumentación Sentry/equivalente ni trazas por request; alertas externas no acreditadas. Hoy un fallo puede depender del reporte manual del usuario.
4. **Media: web pública sin CSP ni protección de framing.** HEAD de https://nexoralogisticpy.netlify.app/seguimiento/ devuelve HSTS/nosniff, pero no CSP ni X-Frame-Options. Se debe definir política compatible con el mapa y verificar el deploy.
5. **Media: escala/colas incompletas.** Listas truncadas sin paginación completa, agregaciones sin límite de volumen y cola QuadMinds sin backoff/límite de intentos exigido. No hay benchmark para afirmar capacidad.
6. **Proceso: baseline, staging y auditor independiente pendientes.** La migración previa del portal no está reconciliada en repo; PostgreSQL con rollback no reemplaza un entorno aislado. GPT revisando código trabajado por GPT no cumple la exigencia de otra familia.

## Evidencia y límites

- Evidencia previa documentada: 105/105 tests Node/dominio/HTTP y build aprobados; PostgreSQL 10/10 antes del último fix de carga y 2/2 circuitos afectados después, con rollback. No se reejecutaron esos circuitos contra producción para esta revisión.
- CI del commit evaluado confirmado exitoso: https://github.com/bjjrage/nexora-logistic-os/actions/runs/39001085646. No equivale a pruebas visuales, pentest o carga.
- Consultas actuales de metadatos Supabase: 3 tablas public, todas con RLS; 0 buckets Storage. El esquema operativo es nexora, no public. Políticas authenticated de portal restringen por membresía; nexora_runtime dispone de políticas ALL/true como rol servidor. El aislamiento de ese rol depende también del backend y sus grants.
- Security Advisor actual: una advertencia, protección de contraseñas filtradas deshabilitada. Remediación oficial: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection. No prueba una fuga de contraseñas.
- npm audit actual OS y web: cero vulnerabilidades reportadas.
- Gitleaks oficial v8.30.1, checksum SHA256 verificado, escaneo local de historial accesible --all --full-history: 4 commits OS/14 web. OS: dos contraseñas de fixtures QA (tests/flow.test.ts:150 y :159). Web: clave sb_publishable_ pública por diseño (public/auth-config.js:4 histórico). No se detectó credencial privada real en estos hallazgos. Esto no garantiza ausencia absoluta de secretos ni cubre commits remotos no presentes en el clon. Reportes redactados en .local/audit-tools, excluidos de Git.
- QuadMinds real pendiente de endpoint/contrato/credencial; usuario confirmó que aún no los recibió. Traccar tuvo health/diagnostics correctos, sin aceptación del celular físico.
- No se ejecutaron ataques destructivos, caída de servicios, carga contra producción ni restauraciones. NO VERIFICADO significa falta de evidencia, no afirmación de que el servicio esté desconfigurado.

## Matriz completa

CUMPLE = evidencia suficiente para el alcance indicado. PARCIAL = existe parte del control o equivalente, pero falta requisito/prueba. NO = falta o incumplimiento observado. NO VERIFICADO = no acreditado. NO APLICA = función ausente del alcance; no cuenta como falla ni como logro. No se calcula porcentaje de seguridad: sumar controles de igual peso ocultaría bloqueantes.

### 1. Auth y control de acceso (bloqueante)

| ID | Requisito del checklist | Estado | Evidencia / pendiente |
| --- | --- | --- | --- |
| 1.1 | RLS activado en todas las tablas del schema public. Verificar con SQL: select tablename, rowsecurity from pg_tables where schemaname='public'; — ninguna en false. | **CUMPLE** | Consulta directa: 3/3 tablas public con RLS; ninguna deshabilitada. No confundir public con el esquema operativo nexora. |
| 1.2 | Cada tabla tiene políticas para SELECT, INSERT, UPDATE y DELETE por separado. Una tabla con RLS activo y sin políticas bloquea todo; una con using (true) abre todo. | **PARCIAL** | Hay políticas SELECT/INSERT de authenticated y ALL del rol privado nexora_runtime. No cumple la separación literal de cuatro verbos. Denegar UPDATE/DELETE al cliente es correcto; USING(true) limitado al servidor no abre acceso anónimo. |
| 1.3 | Correr el Security Advisor de Supabase (get_advisors) y dejarlo en cero warnings de seguridad. | **NO** | Security Advisor actual: 1 WARN, auth_leaked_password_protection. El login OS usa scrypt; el flujo Supabase encontrado usa Google OAuth. |
| 1.4 | Test de acceso cruzado: crear usuario A y usuario B. Con el token de B, intentar leer, editar y borrar cada recurso de A vía API directa (no por la UI). Todo debe fallar. | **PARCIAL** | guards, company, client-profiles y live-portal cubren aislamiento en escenarios; falta matriz exhaustiva de cada recurso y verbo con dos identidades. |
| 1.5 | Test de escalada: un usuario normal intenta cambiar su propio role, tenant_id o owner_id con un UPDATE. Debe fallar. | **PARCIAL** | Roles/org salen de la sesión persistida; authorize impide administrar como depósito/chofer. Falta prueba directa exhaustiva de UPDATE de identidad vía todos los accesos DB. |
| 1.6 | Vistas y funciones security definer revisadas una por una: saltean RLS. | **NO VERIFICADO** | Hay funciones privilegiadas del portal y tracking; esta revisión no certifica revisión individual completa de cada vista/SECURITY DEFINER y sus privilegios efectivos. |
| 1.7 | Storage buckets: privados por defecto, políticas por usuario, URLs firmadas con expiración. | **NO APLICA** | storage.buckets está vacío. Evidencia OS se guarda en DB y se descarga autenticada; no usa URLs públicas de Storage. |
| 1.8 | Endpoints del backend en Railway verifican el JWT en cada request y sacan el user_id del token, nunca del body. | **PARCIAL** | El OS usa cookie opaca HttpOnly y sesión en DB, no JWT. Railway GPS usa secreto de máquina; no identidad de usuario enviada en body como autenticación. Equivalencia arquitectónica, no cumplimiento literal JWT. |
| 1.9 | Sesiones: expiración del token, refresh funcionando, logout invalida la sesión. | **PARCIAL** | auth.ts y app.ts: expiración 12 h, token aleatorio con hash en DB, logout elimina sesiones. No hay refresh automático. |
| 1.10 | Recuperación de contraseña: link de un solo uso, expira, no revela si el email existe. | **NO** | No se encontró recuperación de contraseña con enlace temporal de un solo uso. |
| 1.11 | Multi-tenant (Mussi, Control de Facturas): cada query filtra por tenant también en el backend, no solo en RLS. | **PARCIAL** | El dominio y consultas administrativas filtran org_id y verifican registros; existen pruebas cruzadas. No se certificó cada consulta y RPC con matriz completa. |

### 2. Secretos y configuración (bloqueante)

| ID | Requisito del checklist | Estado | Evidencia / pendiente |
| --- | --- | --- | --- |
| 2.1 | La service_role de Supabase nunca aparece en el frontend. Buscar en el bundle de producción de Vercel: grep -r "service_role\/eyJ" dist/. | **PARCIAL** | Sin credencial privada detectada en historial ni fuentes; check-secrets protege archivos actuales. Falta captura y escaneo del bundle exacto servido de producción con huella de deploy. |
| 2.2 | Solo variables VITE_/NEXT_PUBLIC_ que sean públicas por diseño (URL y anon key). Todo lo demás vive en Railway. | **PARCIAL** | Secretos fuera del repositorio y del frontend. El servidor OS usa .env privado local; no todo reside en Railway como exige literalmente el documento. |
| 2.3 | Escanear el historial de git por secretos (gitleaks o trufflehog). Si alguna key estuvo commiteada alguna vez, se rota, aunque la hayas borrado. | **CUMPLE** | Gitleaks 8.30.1, SHA256 del binario verificado, --all --full-history: OS 4 commits y web 14. Dos claves QA en tests/flow.test.ts y una sb_publishable_ histórica en public/auth-config.js; falsos positivos de secreto privado. |
| 2.4 | .env en .gitignore y un .env.example sin valores. | **CUMPLE** | .gitignore excluye .env y variantes; .env.example contiene configuración de ejemplo, sin credenciales privadas. |
| 2.5 | Keys separadas por entorno: dev, staging y producción nunca comparten credenciales. | **NO VERIFICADO** | No se acreditó separación completa dev/staging/producción. Las pruebas PostgreSQL anteriores usaron el proyecto real con fixtures en rollback; eso no equivale a staging. |
| 2.6 | Keys de OpenAI/Anthropic/Twilio con límite de gasto configurado en el proveedor. | **NO APLICA** | No hay integración OpenAI/Anthropic/Twilio en el OS revisado. |
| 2.7 | Errores en producción no devuelven stack traces ni mensajes de la base al cliente. | **CUMPLE** | app.ts: errores inesperados responden mensaje fijo; postgres.ts traduce constraints; no retorna stack al navegador. |
| 2.8 | Modo debug, endpoints de prueba y seeds desactivados en producción. | **PARCIAL** | Setup inicial está protegido en producción. preview-identity depende de PREVIEW_INSTANCE_ID, sin guardia explícita NODE_ENV; revisar despliegue y seeds antes de producción. |

### 3. Validación de input y ataques (bloqueante)

| ID | Requisito del checklist | Estado | Evidencia / pendiente |
| --- | --- | --- | --- |
| 3.1 | Validación con schema (Zod o similar) en el backend para cada endpoint. La validación del frontend es solo UX. | **PARCIAL** | Zod en validation.ts y handlers especializados. No se aportó inventario automatizado que demuestre schema para cada parámetro/body de todos los endpoints. |
| 3.2 | Queries parametrizadas siempre. Cero SQL armado con concatenación de strings, incluidas las funciones RPC. | **PARCIAL** | Valores parametrizados. Existen identificadores SQL concatenados desde listas fijas/esquema validado, que no son inyección por sí mismos. Falta revisión completa de todos los RPC remotos. |
| 3.3 | XSS: ningún dangerouslySetInnerHTML con contenido de usuario sin sanitizar (DOMPurify). | **PARCIAL** | React escapa texto; tracking.js escapa los valores interpolados. Falta prueba XSS ejecutada en navegador para todas las entradas y renderizados. |
| 3.4 | Uploads: tipo validado por contenido (no por extensión), tamaño máximo, nombres regenerados, nunca ejecutables. | **CUMPLE** | domain.ts:467: máximo 5 MB, firmas JPEG/PNG/WebP, ID UUID propio y descarga con CSP sandbox. Nombre original es metadata, no ruta ejecutable. Validación por firma no equivale a análisis antivirus. |
| 3.5 | Rate limiting en login, registro, recuperación de contraseña, envío de WhatsApp/SMS y cualquier endpoint que llame a una API de IA. | **PARCIAL** | app.ts:48: login/setup limitados a 20/minuto por socket, memoria local. No es limitador distribuido ni está validado detrás de proxy; recuperación inexistente. |
| 3.6 | CORS con lista explícita de dominios. Nunca * en un endpoint con credenciales. | **CUMPLE** | app.ts:31: mutaciones con origen permitido y cabecera requerida. No se concede CORS wildcard con credenciales. |
| 3.7 | Webhooks (Twilio, pagos): verificar la firma del proveedor en cada llamada. | **PARCIAL** | Webhook QuadMinds verifica firma y cron usa secreto. Contrato y credencial reales del proveedor pendientes; falta prueba con firma oficial real. |
| 3.8 | Prompt injection: si un usuario escribe texto que termina en un prompt (bots, CRM), el modelo no puede ejecutar acciones ni leer datos de otros usuarios por instrucciones de ese texto. | **NO APLICA** | No hay prompts ni ejecución de acciones mediante LLM. |
| 3.9 | Headers de seguridad en Vercel: CSP, X-Frame-Options, HSTS. Verificar en securityheaders.com. | **NO** | HEAD público /seguimiento/: HSTS y nosniff presentes, CSP y X-Frame-Options ausentes. OS local tiene X-Frame-Options, sin política CSP global. No se ejecutó securityheaders.com. |
| 3.10 | Dependencias: npm audit sin vulnerabilidades críticas o altas. | **CUMPLE** | npm audit --json actual: OS 0 vulnerabilidades sobre 191 dependencias contabilizadas; web 0 sobre 10. No cubre fallos propios ni servicios externos. |

### 4. Integridad de datos y lógica de negocio (bloqueante)

| ID | Requisito del checklist | Estado | Evidencia / pendiente |
| --- | --- | --- | --- |
| 4.1 | Montos en enteros (guaraníes no tienen decimales) o numeric en Postgres. Nunca float para dinero. | **NO APLICA** | No hay facturación ni cálculo monetario en el alcance operativo revisado. |
| 4.2 | Redondeo de IVA (5% y 10%) definido en un solo lugar y testeado contra 20 facturas reales calculadas a mano. | **NO APLICA** | No hay motor IVA/facturas. |
| 4.3 | Timezones: guardar en UTC (timestamptz), mostrar en America/Asuncion. Testear cambio de horario, fin de mes y fin de año. | **PARCIAL** | Fechas ISO UTC y presentación America/Asuncion; postgres.ts normaliza timestamptz. Falta batería específica de fin de mes/año y cambios horarios. |
| 4.4 | Idempotencia: doble clic en "guardar", "pagar" o "enviar" no duplica el registro. Testearlo a propósito. | **PARCIAL** | Comandos con commandId, ledger de resultados y pruebas de reintento/carga. No hay prueba doble/triple clic de cada botón en navegador. |
| 4.5 | Operaciones de varios pasos dentro de una transacción: si falla el paso 3, los pasos 1 y 2 se revierten. | **NO** | Fallo concreto: live-portal.ts:44–53 crea shipment mediante transacción propia y después actualiza solicitud fuera de esa transacción. Si UPDATE falla queda envío creado con solicitud pendiente. commandId determinista reduce duplicados al reintentar, pero no garantiza atomicidad. |
| 4.6 | Constraints en la base, no solo en el código: not null, unique, foreign keys, check (ej. monto > 0). | **CUMPLE** | Migraciones SQLite/Postgres contienen NOT NULL, UNIQUE, FK y CHECK; pruebas PostgreSQL verifican integridad y conflictos. |
| 4.7 | Concurrencia: dos usuarios editan el mismo registro a la vez. Definir quién gana y testearlo. | **PARCIAL** | Versiones optimistas en rutas y bloqueo transaccional en Postgres; pruebas de recursos concurrentes. No está definida/probada la política de edición simultánea de todas las fichas. |
| 4.8 | Borrado: soft delete donde haya datos clínicos o contables; nada se borra en cascada sin querer. | **NO APLICA** | No hay registros clínicos/contables. Se conservan movimientos operativos; este resultado no certifica todas las cascadas futuras. |
| 4.9 | Reconciliación: un script que compara totales (ventas, saldos, stock) contra la suma de los movimientos y alerta si no cierra. | **NO** | No se encontró conciliador periódico completo de stock vs movimientos con alerta. Reconciliar manifiesto de ruta no sustituye conciliación global. |

### 5. Servicios externos y fallbacks

| ID | Requisito del checklist | Estado | Evidencia / pendiente |
| --- | --- | --- | --- |
| 5.1 | Timeout explícito en cada llamada externa (ej. 10 s para APIs de IA, 5 s para el resto). Sin timeout, un servicio lento cuelga tu servidor. | **PARCIAL** | Timeouts en QuadMinds, Traccar, proof-download y cliente API. Falta inventario/prueba de cada llamada de workers y web desplegados. |
| 5.2 | Reintentos con backoff exponencial y límite (máx. 3), solo en operaciones idempotentes. | **NO** | quad-operations.ts:95 selecciona ERROR/QUEUED por attempts, sin espera exponencial ni máximo 3 de selección. Hay leases; no satisface política literal de backoff y límite. |
| 5.3 | APIs de IA: fallback a otro proveedor o modelo, y un mensaje claro al usuario si ambos fallan. | **NO APLICA** | Sin proveedor IA. |
| 5.4 | Respuestas de IA validadas: si esperás JSON, parsear con schema y manejar el caso de basura. | **NO APLICA** | Sin respuestas IA. |
| 5.5 | Colas para lo que no tiene que ser inmediato (emails, WhatsApp, reportes): si el proveedor cae, se reintenta después sin perder el mensaje. | **PARCIAL** | Cola QuadMinds persistida con estados y lease. Sin acreditación de cola general para todas las tareas asíncronas; no hay envío email/WhatsApp automático en alcance. |
| 5.6 | Test de caída: apuntar cada variable de API a una URL inválida en staging y usar la app. Ninguna pantalla debe quedar en blanco ni cargando para siempre. | **NO VERIFICADO** | No se ejecutó matriz de APIs inválidas en staging con todas las pantallas. |
| 5.7 | Supabase o Railway caído: la app muestra un estado de error claro, no un crash. | **PARCIAL** | frontend/api.ts tiene timeout y mensajes de error; falta prueba visual completa de caída real de DB/Railway y recuperación. |

### 6. Stress test: rompé la app

| ID | Requisito del checklist | Estado | Evidencia / pendiente |
| --- | --- | --- | --- |
| 6.1 | Test de carga con k6 o Artillery: 10x tu uso esperado durante 10 minutos. Anotar tiempo de respuesta p95 y tasa de error. | **NO VERIFICADO** | Sin corrida k6/Artillery de 10 minutos, uso esperado definido ni p95/error documentados. |
| 6.2 | Base con volumen real: 100.000 registros en las tablas principales. Revisar que listados y búsquedas sigan respondiendo en menos de 1 s. | **NO VERIFICADO** | Sin dataset 100.000 y benchmark <1 s. |
| 6.3 | Índices en todas las columnas usadas en where, join y order by. Revisar consultas lentas en los logs de Supabase. | **PARCIAL** | Índices operativos comprobados anteriormente; asesor señaló cobertura FK pendiente de medir. Indexar toda columna indiscriminadamente no es criterio técnico válido. Sin slow-query benchmark. |
| 6.4 | Listados con paginación. Nunca un select * sin límite. | **NO** | bootstrap limita a 500 y avisa truncamiento, pero no implementa paginación completa. domain.ts:489+ agrega resúmenes/return_evidence sin límite por org; live-portal limita solicitudes a 200 sin cursor. |
| 6.5 | Límite de conexiones de Postgres: usar el pooler de Supabase desde Railway. | **NO VERIFICADO** | PostgresStore limita pool local a 5; no se verificó aquí configuración efectiva del pooler de todos los servicios Railway. |
| 6.6 | Doble y triple clic en cada botón de acción. | **PARCIAL** | Idempotencia probada en dominio/HTTP; falta doble/triple clic en cada acción UI. |
| 6.7 | Botón atrás del navegador a mitad de un formulario o un pago. | **NO VERIFICADO** | Sin prueba navegador atrás a mitad de formularios. |
| 6.8 | La misma cuenta abierta en dos pestañas editando lo mismo. | **PARCIAL** | Pruebas de concurrencia en servidor; falta ejecución con dos pestañas reales. |
| 6.9 | Campos con: vacío, espacios, 10.000 caracteres, emojis, ñ y tildes, <script>, comillas, números negativos, fechas imposibles. | **PARCIAL** | Zod limita longitudes/tipos y suite cubre inputs inválidos; no corpus completo de todos los campos enumerados. |
| 6.10 | Cortar internet a mitad de una operación y reconectar. | **NO VERIFICADO** | Sin prueba física offline/reconexión durante mutación. |
| 6.11 | Celular viejo con 3G lento (throttling en DevTools). | **NO VERIFICADO** | Sin prueba móvil viejo/3G. |
| 6.12 | Sesión expirada mientras el usuario llena un formulario largo: ¿se pierde lo que escribió? | **NO VERIFICADO** | No se comprobó conservación de formulario al expirar sesión. |
| 6.13 | Pasarle la app a alguien que nunca la vio, sin explicarle nada, y mirar sin intervenir. | **NO** | Las capturas y reportes del usuario muestran fallos de comprensión del flujo. No hay aceptación posterior con usuario nuevo sin ayuda. |
| 6.14 | Reiniciar el servidor de Railway en medio de operaciones en curso. | **NO VERIFICADO** | No se reinició Railway en medio de operaciones para esta revisión. |
| 6.15 | Llenar un bucket de storage o pasar el límite de una API para ver qué pasa. | **NO VERIFICADO** | Sin prueba de cuota API agotada; Storage no se usa actualmente. |
| 6.16 | Dejar que la IA auditora intente romper la app con un pentest guiado, dándole la URL de staging y dos usuarios de prueba. | **NO VERIFICADO** | No hay pentest completo de staging con dos usuarios y evidencia reproducible. |

### 7. Observabilidad: detectar fallas al toque (bloqueante)

| ID | Requisito del checklist | Estado | Evidencia / pendiente |
| --- | --- | --- | --- |
| 7.1 | Sentry (o similar) en frontend y backend, con source maps subidos para ver la línea exacta del error. | **NO** | No se encontró integración Sentry/equivalente en frontend/backend ni carga de source maps. |
| 7.2 | Cada error capturado incluye: user_id, ruta, versión del deploy y los datos de entrada (sin contraseñas ni datos clínicos). | **NO** | Sin captura centralizada con contexto de usuario, versión, ruta y redacción verificable. |
| 7.3 | Logs estructurados en JSON en Railway, con un request_id que viaja del frontend al backend y a la base. | **NO** | console.error/log sin request_id transversal ni esquema JSON uniforme. |
| 7.4 | Endpoint /health que verifica base, storage y APIs críticas. Monitoreado desde afuera cada 1 minuto (UptimeRobot, Better Stack). | **PARCIAL** | app.ts:56 /api/health consulta DB y estado de tracking. No demuestra sondeo activo completo de APIs ni monitor externo cada minuto. |
| 7.5 | Alertas a tu celular (WhatsApp, Telegram o push) para: app caída, pico de errores, endpoint lento, gasto de API anormal. | **NO VERIFICADO** | No se acreditó circuito de alertas al celular. |
| 7.6 | Alertas de negocio, no solo técnicas: "cero ventas registradas en 6 horas" o "factura con monto negativo" detectan fallas silenciosas. | **NO** | No se encontraron reglas/worker de alertas por anomalías de negocio. |
| 7.7 | Logs de auditoría en la base para acciones sensibles: quién creó, editó o borró qué y cuándo. | **PARCIAL** | domain.command persiste audit y hay historial de custodia. La aceptación portal fuera de command requiere revisar cobertura de esa segunda mutación. No se certifican todas las escrituras sensibles. |
| 7.8 | Probar el circuito completo: provocar un error a propósito en producción y confirmar que te llega la alerta en menos de 5 minutos. | **NO VERIFICADO** | Sin evidencia de error controlado y alerta recibida en menos de 5 minutos. |

### 8. Backups, rollback y migraciones (bloqueante)

| ID | Requisito del checklist | Estado | Evidencia / pendiente |
| --- | --- | --- | --- |
| 8.1 | Backups diarios de Supabase activos. Para datos clínicos o contables, Point-in-Time Recovery (plan Pro). | **NO VERIFICADO** | No se acreditó política activa/retención de backups Supabase del OS. Backup MySQL de Traccar es otro sistema. PITR clínico/contable no aplica. |
| 8.2 | Restore probado: restaurar un backup en un proyecto aparte y verificar que los datos están completos. Un backup que nunca restauraste no existe. | **NO** | docs/TRACCAR_OPERACION.md declara que no hubo restore completo. Tampoco se aportó restore completo PostgreSQL del OS en proyecto aislado. |
| 8.3 | Backup externo semanal (pg_dump a otro proveedor), por si perdés acceso a la cuenta. | **NO VERIFICADO** | No hay evidencia de pg_dump semanal externo a otro proveedor. |
| 8.4 | Rollback del frontend: saber hacer "Instant Rollback" en Vercel en menos de 1 minuto. Practicarlo una vez. | **NO VERIFICADO** | Web usa Netlify, no Vercel. Falta práctica documentada de rollback equivalente <1 minuto. |
| 8.5 | Rollback del backend: redeploy del commit anterior en Railway, practicado. | **NO VERIFICADO** | No se acreditó práctica de redeploy anterior y verificación del backend. OS actualmente local. |
| 8.6 | Migraciones versionadas en el repo, nunca cambios a mano en el dashboard de producción. | **PARCIAL** | Migraciones OS versionadas; docs/SUPABASE.md:62 reconoce baseline portal_customer_access no exportada/reconciliada. Repo no reconstruye todavía todo el proyecto remoto de cero. |
| 8.7 | Toda migración se prueba primero en un branch de Supabase o en staging con copia de datos reales anonimizados. | **NO** | La evidencia anterior prueba PostgreSQL real con rollback, no branch/staging con copia anonimizada antes de toda migración. |
| 8.8 | Migraciones destructivas (borrar columna, cambiar tipo) en dos pasos: primero dejar de usarla, después borrarla en otro deploy. | **NO VERIFICADO** | No se acreditó procedimiento expand/contract ejercitado en despliegues separados. |
| 8.9 | Regla para la IA: ninguna operación de borrado o migración en producción sin backup del momento y tu confirmación explícita. | **PARCIAL** | Hay aprobaciones explícitas previas para cambios sensibles. No hay evidencia de backup fresco para cada migración/borrado anterior ni guardia automatizada que lo exija. |

### 9. Tests automáticos y CI

| ID | Requisito del checklist | Estado | Evidencia / pendiente |
| --- | --- | --- | --- |
| 9.1 | Tests de los flujos críticos de punta a punta con Playwright: registro, login, crear el objeto principal (factura, consulta, lead), pago si existe. | **NO** | Suite Node/HTTP/dominio; no se encontró suite Playwright ejecutada. Controlador visual falló en la verificación anterior. |
| 9.2 | Tests de la lógica de negocio: cálculos, permisos, estados. Cada bug encontrado en auditoría queda como test. | **PARCIAL** | 105 tests aprobados y regresiones concretas; hallazgos abiertos de esta revisión aún no tienen test red/green. |
| 9.3 | Tests de RLS automatizados (los de la sección 1) corriendo en cada cambio. | **NO** | Guardia estática de migraciones sí corre en CI; tests de permisos PostgreSQL real no corren en cada cambio en Actions. |
| 9.4 | GitHub Actions corre todos los tests en cada push. Si falla, no se deploya a producción. | **PARCIAL** | Actions actual exitoso en main/PR: secretos, migraciones, npm test, build. No incluye todos los tests PostgreSQL; sin evidencia de gate efectivo de deploy/branch protection. |
| 9.5 | Deploys de preview de Vercel para probar cada cambio antes de mergear. | **NO** | No hay previews automáticos del OS por PR. Web alojada en Netlify; equivalencia de preview tampoco acreditada aquí. |
| 9.6 | Regla para la IA coder: no puede modificar ni borrar un test existente para que pase. Si un test debe cambiar, lo aprueba el auditor. | **NO VERIFICADO** | Hubo actualizaciones justificadas de fixtures/contrato; no auditor independiente de otra familia aprobando cada cambio de tests. |

### 10. Datos sensibles y legal

| ID | Requisito del checklist | Estado | Evidencia / pendiente |
| --- | --- | --- | --- |
| 10.1 | Inventario: qué datos personales guarda cada app, en qué tabla y quién puede verlos. | **PARCIAL** | Esquema y docs describen clientes, destinatarios, usuarios y GPS; falta inventario formal campo/tabla/finalidad/retención/roles/proveedor. |
| 10.2 | Datos clínicos y documentos médicos nunca en logs, Sentry ni prompts a APIs de IA sin anonimizar. | **NO APLICA** | Sin historia clínica/documentos médicos ni prompts IA. Las fotos operativas sí requieren control de privacidad. |
| 10.3 | Revisar la política de retención de datos de cada proveedor de IA que uses (si entrenan o no con tus datos). | **NO APLICA** | Sin proveedores IA en el OS. |
| 10.4 | HTTPS en todo y cifrado en reposo (Supabase lo trae; verificar storage también). | **PARCIAL** | Web HTTPS, PostgreSQL TLS validado con CA. OS local HTTP; no se acreditó cifrado/retención de todos los volúmenes Railway/backups ni despliegue remoto HTTPS del OS. |
| 10.5 | Términos de uso y política de privacidad publicados antes del primer usuario real. | **PARCIAL** | Web tiene /privacidad/ y aviso GPS. No se identificaron términos de uso completos publicados; revisión legal no acreditada. |
| 10.6 | Consultar con un abogado la normativa vigente de protección de datos en Paraguay y, para Mussi, la de historia clínica. | **NO VERIFICADO** | No hay evidencia de revisión jurídica local de datos logísticos/GPS. Requisito clínico Mussi no aplica. |
| 10.7 | Plan de exportación y borrado de datos de un usuario si lo pide. | **NO** | No se encontró procedimiento completo de exportación/supresión con identidad, alcance, conservación legal y backups. |

## Proceso de auditoría e incidentes (11–12)

**No acreditado completo.** Hay registro de hallazgos, commits, regresiones y resultados en docs/AUDITORIA_PROFUNDA_2026-10-16.md, docs/PLAN_FIXES_AUDITORIA_2026-10-17.md y docs/FIXES_VERIFICADOS_2026-10-17.md. Faltan auditor de otra familia, staging obligatorio, restore/rollback ensayados, trazabilidad request_id/Sentry y simulacro de alerta. Esta revisión no se presenta como auditoría cruzada independiente.

No se adopta la frase genérica “USING(true) abre todo” sin considerar roles/grants; tampoco se exige conceder DELETE a tablas que deben ser inmutables, usar JWT para reemplazar una sesión opaca válida, ni añadir índices en toda columna sin medir. Estas diferencias quedan explícitas y no cierran los requisitos literales.

## Orden de cierre recomendado

1. Asegurar backup PostgreSQL y restore aislado; completar baseline y staging reproducible.
2. Corregir atomicidad del portal con test de fallo entre pasos; revisar todas las mutaciones fuera de command.
3. Matriz de acceso por rol/organización/recurso/verbo y RPC, ejecutada en entorno aislado y CI. Recuperación de contraseña si se mantiene login propio.
4. Instrumentar errores, request_id, health/monitor externo y alertas; probar recepción real.
5. CSP/framing, rate limit apto para proxy, paginación y política de cola/reintentos.
6. Playwright del flujo cliente → catálogo → recepción → pedido → carga → ruta → entrega → tracking; celular real, offline, carga y rollback.
7. Auditor independiente de otra familia, revisión de privacidad/retención y aceptación de usuario nuevo.

No se cambió el código de aplicación, la base ni la infraestructura en esta revisión. Se generó únicamente este informe y evidencia local ignorada por Git.
