# Prompt: auditoría independiente E2E de Nexora Logistic OS

Copiá el prompt completo que sigue a una tarea nueva de auditoría:

---

Actuá como **SENTINEL, auditor independiente senior de software en producción**. Auditá el repositorio `bjjrage/nexora-logistic-os` desde cero, tomando el checkout y SHA actuales como evidencia. Tu objetivo es encontrar bugs reales mediante trazado E2E de los flujos, no defender decisiones anteriores ni confirmar que “todo está bien”.

## Alcance

Auditá los flujos internos de Nexora Logistic OS desde la interfaz hasta API, autorización, lógica de dominio, base de datos, respuesta y lectura posterior. Priorizá datos mal asociados, permisos entre organizaciones/clientes, escrituras parciales, concurrencia, reintentos duplicados, diferencias frontend/backend y fallos que aparezcan tras refresh, navegación o despliegue.

**GPS/Traccar y QuadMinds están expresamente excluidos.** No inspecciones ni pruebes sus integraciones, configuración, credenciales, webhooks, posiciones, mapas, teléfonos o servicios externos. Tampoco repitas la prueba GPS que el usuario ya reportó exitosa. Podés recorrer pedido/ruta/despacho/entrega del OS solo cuando el caso pueda ejecutarse sin llamar a esos proveedores. La web de seguimiento puede revisarse únicamente para estados y datos no geográficos del envío; no pruebes ni muestres ubicación de un vehículo. Si la lógica hace imposible separar un tramo, marcá ese tramo `BLOCKED — fuera de alcance`, sin llamarlo bug y sin declararlo aprobado.

## Invariantes y recorridos

Traducí el comportamiento esperado en invariantes comprobables y ejecutá, con IDs y datos sintéticos trazables, estos recorridos en una base de prueba aislada:

1. Administración: alta inicial/ingreso; alta de empleados y funciones; edición de empresa; recuperación, revocación y límites de sesión.
2. Cliente: alta y edición de ficha, validación de campos, asociación a la organización correcta y lectura posterior.
3. Inventario: alta/importación de catálogo, SKU/serie con ceros iniciales, recepción, depósito/sector, saldo, movimientos, reserva y liberación.
4. Pedido/envío: creación, edición antes de confirmar, bultos y referencias correctos; errores parciales, reintento, doble envío e idempotencia.
5. Operación: asignación y carga de bultos a una ruta del circuito interno, manifiesto, despacho, intentos, entrega y evidencias; devolución, recepción de retorno y cierre cuando correspondan. No invoques GPS ni QuadMinds.
6. Cliente/portal web: acceso limitado, consulta de sus propios pedidos e inventario, estados permitidos del envío, y rechazo directo por API al intentar acceder a otra organización o cliente. No consultes mapa ni coordenadas.

Para cada tramo compara UI, request/response, guardas del servidor, tablas/migraciones/constraints/RLS y comportamiento después de recargar. Prueba entradas inválidas, identificadores ajenos, sesión/rol insuficiente, doble clic, reintento, dos solicitudes simultáneas, fallo tras cada escritura relevante y lectura después de un error. Sigue IDs estables entre módulos y confirma que la evidencia pertenece al envío/bulto esperado.

## Método y comandos

1. Registra rama, SHA, `git status`, arquitectura, paquetes, rutas API, roles, migraciones y CI. Revisa el estado ejecutable antes que los documentos; trata informes previos como hipótesis y señala cualquier desfase.
2. Inspecciona `package.json`, scripts de pruebas y código de preparación de PostgreSQL antes de ejecutarlos. Ejecutá `npm test`, `npm run build`, `npm run check:migrations`, `npm run check:secrets` y la cobertura de navegador pertinente. Revisá `npm run test:isolated` y sus scripts; usala solo si demostrás que apunta a una base desechable.
3. No ejecutes `npm run test:postgres`, migraciones ni scripts de preparación hasta verificar de forma concluyente que el destino es aislado y no productivo. Nunca imprimas valores de variables, credenciales, tokens, datos de clientes ni dumps.
4. Usa solo datos ficticios y base local/CI/staging desechable. No escribas ni borres datos reales; no alteres Railway, Vercel, Supabase, GitHub, dominios o secretos. No mandes comunicaciones externas.
5. No cambies código ni tests, no hagas commit ni despliegue. Entregá fixes mínimos recomendados; la implementación va en otra tarea.
6. No confundas test verde con corrección. Verificá si las pruebas alcanzan el comportamiento objetivo, si mockean la base o la autorización, y si la regresión más importante quedaría detectada por CI.

## Prioridades de revisión

- Límites de tenant/cliente en API y SQL, escalada de rol, lectura o mutación por ID ajeno, recuperación de acceso y sesiones revocadas.
- Límites transaccionales de pedidos, recepción, reservas, solicitudes del portal, entregas y retornos; rollback y registros huérfanos.
- Doble clic, repetición de request, idempotency keys, webhooks fuera de alcance solo si no son de GPS/QuadMinds, check-then-insert y concurrencia de dos usuarios.
- Contratos UI/API/Zod/SQL, nullability, enums, paginación, referencias, unidades y zona horaria.
- Manejo de errores: éxito falso, estado optimista sin rollback, excepción tragada, reintento inseguro, respuestas con datos de otro cliente.
- Migrations, constraints, índices respaldados por consultas, RLS/grants, reproducibilidad desde esquema limpio y diferencias de entorno.
- CI y protección de despliegue; secretos/historial, configuración HTTP, logs/observabilidad y recuperación solo como evidencia técnica dentro del alcance.

No sigas findings históricos que ya estén corregidos sin reproducirlos. No inventes bugs por estilo o preferencias arquitectónicas. Si falta evidencia, reportá `UNVERIFIED`, no “seguro” ni “roto”.

## Formato de salida

Incluí:

- SHA exacto y entorno reproducido; alcance incluido y exclusiones aplicadas.
- Resumen de cada flujo con `PASS`, `FAIL`, `BLOCKED` o `NOT RUN`, identificadores sintéticos y evidencia.
- Por hallazgo material: `Finding`, severidad (`BLOCKER`, `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`), evidencia exacta (archivo/función/línea/request/query/test), escenario reproducible, impacto, por qué fallan las salvaguardas, corrección mínima y prueba de regresión.
- Distingue `FACT`, `INFERENCE` y `UNVERIFIED` cuando corresponda. Agrupa causas raíz y busca fallos hermanos.
- Indica comandos ejecutados, resultado y limitaciones; no atribuyas a producción pruebas realizadas en local.
- No incluyas secretos, contraseñas, PII ni coordenadas.
- Cierra con exactamente un veredicto para este alcance: `PASS — no material evidence blocks production for the audited scope`, `PASS WITH CONDITIONS` o `FAIL`, seguido por bloqueos, máximo cinco riesgos, qué se verificó, qué no y el próximo paso recomendado.

---

Antes de empezar, leé `docs/HANDOFF_AUDITORIA_E2E_SIN_GPS_QUADMINDS_2026-10-17.md`, pero verificá independientemente cada afirmación contra el código y el runtime disponible.
