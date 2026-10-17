# Contexto y decisiones — OS de logística

**Fecha de registro:** 15 de octubre de 2026  
**Propósito:** conservar el encargo, sus límites y las decisiones que todavía condicionan el trabajo. Este documento es una matriz de contexto; no aprueba un blueprint, un roadmap, un diseño funcional final ni una arquitectura de producción.

**Actualización de alcance del cliente, 15-10-2026:** inventario físico, entrada/salida por código de barras, consulta del cliente, planificación diaria y reparto obligatorio mediante la app de QuadMinds con GPS celular, foto y firma. El [plan operativo](PLAN_OPERATIVO_CLIENTE.md) interpreta estos seis requisitos y sustituye las exclusiones anteriores de inventario y portal de inventario. El estado de implementación posterior se describe a continuación; las filas anteriores se conservan como historial de decisiones.

## Matriz de contexto

**Implementación posterior, 15-10-2026:** inventario, pedidos/importación, portal privado y circuito preparado de órdenes/rutas/comprobantes QuadMinds ya tienen código y pruebas; Supabase tiene migraciones 1–7 y 47 tablas privadas con RLS. Consultar [entrega vigente](ENTREGA_INVENTARIO_Y_QUADMINDS.md), que sustituye las filas históricas que describen estas funciones como no implementadas. La conexión real de QuadMinds, GPS desde celular, programación de sync, publicación en la cuenta del negocio y aceptación de campo siguen pendientes; no equivalen a desarrollo local verificado.

| Área | Registro | Estado | Fuente |
|---|---|---|---|
| Objetivo original | Preparar y, cuando estén resueltas las decisiones mínimas, ejecutar una implementación integral de un OS para el servicio logístico de la hermana de Marcelo. | CONFIRMADO | Prompt maestro V0.1, secc. 1 |
| Resultado operativo buscado | Poder saber qué se recibió, dónde está cada bulto, quién lo tiene, en qué ruta viaja, qué se entregó, qué debe volver y qué queda pendiente de rendir. “One-shot” significa un circuito conectado con pruebas. | PROPUESTO | Prompt maestro V0.1, secc. 1 |
| Requisitos funcionales expresos | Recepción de mercadería, tracking, asignación de choferes, rutas trackeables y gestión de flota con controles. | CONFIRMADO | Prompt maestro V0.1, secc. 1 |
| Ampliaciones planteadas | Identificación de bultos, prueba de entrega, incidencias y devoluciones tienen soporte de código en el alcance local. Rendiciones, tarifas y portales siguen fuera del alcance inicial o pendientes de decisión comercial. | PROPUESTO (alcance de negocio) / CONFIRMADO (código parcial) / PENDIENTE (finanzas y portales) | Prompt maestro V0.1, seccs. 1 y 4; server/*; frontend/App.tsx; decisión posterior del usuario |
| No negociable: producto | No es la web pública ni un módulo de NIUPACK, Control de Facturas, Law and Order o Padel Academy. No asociar ni reutilizar por inferencia sus repositorios, marcas, bases, credenciales o decisiones. | CONFIRMADO | Prompt maestro V0.1, secc. 1 |
| No negociable: continuidad del circuito | Recepción, despacho, tracking y rendición deben compartir entidades. El flujo debe cubrir retiro o recepción, clasificación, planificación, control de carga, ruta, resultado de entrega o incidencia y, cuando corresponda, devolución, cierre operativo y rendición. | PROPUESTO | Prompt maestro V0.1, seccs. 1, 3 y 4 |
| No negociable: integridad | Custodia, asignaciones, transiciones y dinero requieren autorización, historial y reglas consistentes en servidor/base; la interfaz no puede ser el único control. No borrar historial para corregirlo ni duplicar efectos al reintentar. | PROPUESTO | Prompt maestro V0.1, seccs. 5–8 y 14 |
| No negociable: datos honestos | No simular GPS, entregas, integraciones, costos, métricas ni resultados de pruebas. Ubicaciones y evidencias deben conservar su fuente y calidad; pendientes offline no equivalen a confirmaciones del servidor. | PROPUESTO | Prompt maestro V0.1, seccs. 9–10, 15–17 |
| No negociable: marca | “OS de Logística” es un nombre descriptivo provisional, no una marca aprobada. El estilo visual definitivo tampoco está aprobado. | CONFIRMADO | Prompt maestro V0.1, encabezado y secc. 15 |
| No negociable: autorización | Este borrador no autoriza producción. Deploy, merge, push, servicios pagos, cambios en datos reales y mensajes reales requieren autorización explícita para esas acciones. Las pruebas deben usar ambientes aislados. | CONFIRMADO | Prompt maestro V0.1, secc. 2 |
| Fase actual | Núcleo local implementado. Se añadieron documentos de chofer con renovación auditada, recepción fotográfica de devoluciones con subsanación legacy, y alta/cierre de mantenimiento con foto. QA-03, QA-05 y QA-07 y las autorizaciones HTTP están completados. La suite vigente se consulta en `INFORME_QA.md`; la vista previa DEMO persistente está activa en el puerto 5173. El alcance V0.1 completo sigue abierto. | CONFIRMADO (implementación local) / PENDIENTE (V0.1 completo) | Código actual, `docs/INFORME_QA.md`, `scripts/preview.ts` |
| Implementado en este workspace | El código y la documentación están presentes. `git rev-parse` falló: este workspace no es un repositorio Git; no hay rama, SHA, remoto ni push que reportar. | CONFIRMADO (archivos actuales y ausencia de Git) | Inspección actual y resultado de `git rev-parse`; 15-10-2026 |
| Stack | TypeScript, Node.js >=24.20.0, React/Vite y PostgreSQL de Supabase para el OS. SQLite permanece para DEMO y pruebas. Servidor local conectado con un rol privado limitado; publicación pendiente. | CONFIRMADO (conexión Supabase) / PENDIENTE (despliegue) | `server/postgres.ts`, `server/index.ts`, `docs/SUPABASE.md`; pedido posterior del usuario |
| Estado funcional implementado | El núcleo local cubre sesión/setup, roles, clientes, choferes, vehículos, envíos y bultos, recepción, asignación, carga, despacho, retiros, intentos, incidencias, devoluciones, evidencias, inspecciones/documentos de vehículos y choferes, y mantenimiento. La UI permite alta/renovación de documentos de chofer, fotos separadas por etapa de devolución, alta de mantenimiento y cierre con foto. La suite vigente se consulta en `INFORME_QA.md`; las funciones pendientes no se incluyen en DONE global. | CONFIRMADO (código local) / PENDIENTE (alcance restante) | `server/*`, `frontend/*`, `docs/INFORME_QA.md` |
| Restricción de implementación | GPS real, importaciones, impresión de etiquetas, captura por cámara, replanificación en curso, modo offline, portales y finanzas/rendiciones siguen sin implementar. La base de producción está pendiente; evaluar seguridad, hardening, requisitos legales aplicables, GPS e infraestructura antes de producción. | CONFIRMADO (estado actual) / PENDIENTE (resto y producción) | Código actual e instrucciones del usuario |
| Criterio de bloqueo | Si falta una decisión crítica, registrar `BLOQUEADO_DECISIÓN` y frenar solo el trabajo que depende de ella. No convertir una carencia de credenciales, dispositivo o tiempo en aprobación o PASS. | CONFIRMADO | Prompt maestro V0.1, seccs. 2 y 17 |

## Decisiones de negocio pendientes

| Decisión | Qué queda condicionado | Estado | Fuente |
|---|---|---|---|
| Nombre de empresa, operación y territorio | Identidad definitiva, cobertura y reglas comerciales locales. No hay marca aprobada. | PENDIENTE | Prompt maestro V0.1, seccs. 1–2 y 15 |
| Modelo de almacén | Inventario en un local, con entradas/salidas por código de barras. Confirmar producto, serie, bulto o pedido identificado por cada etiqueta, y si se preparan pedidos o se custodian pedidos ya armados. Sustituye el alcance previo sin inventario. | CONFIRMADO (necesidad de inventario) / PENDIENTE (modelo detallado e implementación) | Seis requisitos del cliente transmitidos por el usuario, 15-10-2026; `PLAN_OPERATIVO_CLIENTE.md` |
| Tipo de carga y restricciones | Manipulación, temperatura, seguridad y documentación aplicables. | PENDIENTE | Prompt maestro V0.1, secc. 2 |
| Modelo de flota | Flota propia, tercerizada o mixta; responsabilidades y liquidaciones correspondientes. | PENDIENTE | Prompt maestro V0.1, seccs. 2 y 11 |
| Cobro contra entrega y titular del dinero | Activación y reglas de cobranzas, rendiciones y cierres financieros. No activar finanzas por inferencia. | PENDIENTE | Prompt maestro V0.1, seccs. 2 y 12 |
| Alcance inicial de portales y finanzas | Acceso del cliente a su inventario requerido; se propone consulta autenticada sin edición. Enlace para destinatario y funciones financieras siguen pendientes, sin activación por inferencia. | CONFIRMADO (consulta de inventario) / PENDIENTE (implementación y resto) | Seis requisitos del cliente transmitidos por el usuario, 15-10-2026 |
| Reglas de entrega y evidencia | Usar la app de QuadMinds para ver la ruta y cerrar entrega con foto y firma. Confirmar obligatoriedad configurada, asociación a pedidos y acceso/retención de comprobantes. No implementar doble cierre en Nexora. | CONFIRMADO (requisito) / PENDIENTE (configuración e integración) | Seis requisitos del cliente transmitidos por el usuario, 15-10-2026 |
| Planificación diaria | El cliente define la jornada; aclarar si envía pedidos/restricciones para optimizar o una ruta ya secuenciada que debe respetarse. Se propone usar el planificador de QuadMinds si corresponde y está habilitado. | CONFIRMADO (necesidad) / PENDIENTE (autoridad y acceso) | Seis requisitos del cliente transmitidos por el usuario, 15-10-2026; documentación oficial enlazada en `PLAN_OPERATIVO_CLIENTE.md` |
| Volumen, retención y servicio | Límites operativos, retención, pruebas de carga y parámetros de cumplimiento. | PENDIENTE | Prompt maestro V0.1, secc. 2 |
| Tarifas, moneda e impuestos | Reglas comerciales y reportes; no fijar valores, moneda ni impuestos por inferencia. | PENDIENTE | Prompt maestro V0.1, seccs. 5 y 12 |
| Roles y permisos reales | Ajustar la matriz inicial propuesta a los roles y responsabilidades de la operación. | PENDIENTE | Prompt maestro V0.1, secc. 13 |

## Decisiones de GPS e integración pendientes

| Decisión | Qué queda condicionado | Estado | Fuente |
|---|---|---|---|
| Fuente real de ubicación | GPS por celular mediante la app obligatoria de QuadMinds. El conector local de lectura está preparado y deshabilitado; faltan cuenta, contrato, acceso y prueba real. El alcance ahora requiere también pedidos/rutas y resultados con foto/firma; el conector GPS actual no cubre esa integración completa. | CONFIRMADO (requisito y preparación local) / PENDIENTE (integración real) | Seis requisitos del cliente transmitidos por el usuario, 15-10-2026; `PLAN_OPERATIVO_CLIENTE.md` |
| Dispositivos y comportamiento en segundo plano | Cliente móvil, permisos, captura con pantalla bloqueada, cortes de red, permisos revocados y ensayo físico. | PENDIENTE | Prompt maestro V0.1, secc. 10 |
| Proveedor para ETA, distancia, mapas o navegación | Integración, cobertura y reglas aprobadas; sin ello no se deben inventar minutos, kilómetros ni optimización. | PENDIENTE | Prompt maestro V0.1, seccs. 8 y 10 |
| Tracking operativo | Tracking permite vincular vehículos, consultar la última medición, mostrar antigüedad/fallas y abrir posición en OpenStreetMap cuando hay datos. Health/bootstrap exponen configuración, no conectividad. Sin endpoint/credenciales muestra integración pendiente; GPS propio sigue bloqueado. | CONFIRMADO (preparación local) / PENDIENTE (validación real) | `server/quadminds.ts`, `frontend/QuadMindsPanel.tsx`, `docs/QUADMINDS.md` |
| Mensajería y otros proveedores | Proveedor, autorización y señales reales de entrega/fallo para cualquier aviso al cliente. | PENDIENTE | Prompt maestro V0.1, seccs. 2 y 15 |

## Restricciones del entorno y del trabajo

| Restricción | Estado | Fuente |
|---|---|---|
| Workspace autorizado actual | El workspace contiene el proyecto. La inspección `git rev-parse` falló, por lo que no existe contexto Git para rama, SHA o remoto en esta carpeta. | CONFIRMADO | Inspección actual de archivos y resultado de `git rev-parse`; 15-10-2026 |
| Repositorio, rama, remotos, SHA y pruebas previas | `git rev-parse` terminó con error: no hay repositorio Git en el workspace. No se atribuye branch, SHA, remoto ni push. La suite actual se consulta en `docs/INFORME_QA.md`. | CONFIRMADO (sin Git; suite referenciada) | Resultado de `git rev-parse`; `docs/INFORME_QA.md` |
| Código de aplicación e instalación | Núcleo local compilado; flujo de login/tablero/alta de cliente en navegador con persistencia SQLite comprobado con base DEMO. | CONFIRMADO (núcleo local) / PENDIENTE (V0.1 completo) | `npm run build` PASS; verificación de navegador DEMO informada para esta actualización |
| Vista previa local persistente | `npm run preview` inicia la aplicación DEMO en `http://127.0.0.1:5173` usando `.local/demo.sqlite`. `npm run preview:restart`, `npm run preview:status` y `npm run preview:stop` gestionan la misma instancia; permanece activa hasta detenerla. La instancia ya está activa. | CONFIRMADO (vista previa activa) | `package.json`, `scripts/preview.ts`; estado operativo informado |
| Fuente de GPS, credenciales, dispositivo y proveedor | Requieren verificación y autorización técnica antes de integración o prueba operativa. | PENDIENTE | Prompt maestro V0.1, seccs. 2 y 10 |
| Cambios destructivos o externos | No hacer checkout/reset/clean/pull ni ejecutar migraciones sobre datos existentes o producción. Mantener la base local de desarrollo aislada. Deploy, merge, push, cambios en datos reales y acciones comerciales requieren autorización explícita. Preservar trabajo ajeno. | CONFIRMADO | Prompt maestro V0.1, secc. 2; decisión posterior del usuario sobre SQLite local |
| Pruebas | `npm test` usa `node --test tests/*.test.ts`. QA-03, QA-05 y QA-07 están completados, junto con pruebas HTTP de autorización por rol. Consultar `docs/INFORME_QA.md` para el resultado vigente de la suite y sus límites; este contexto no fija un conteo que pueda quedar obsoleto. | CONFIRMADO (estado informado) | Estado de QA informado; `package.json`, `docs/INFORME_QA.md` |

## DONE

El prompt exige separar estos estados y no usar un porcentaje único que esconda dependencias:

| Hito | Condición para marcarlo DONE | Estado actual |
|---|---|---|
| DONE_DESARROLLO (núcleo local) | Build y pruebas del núcleo, más flujo de navegador con persistencia local. | CONFIRMADO para los flujos acotados informados; consultar `docs/INFORME_QA.md` para la suite vigente. |
| DONE_DESARROLLO (V0.1 completo) | Requisitos originales y ampliaciones aprobadas implementados y probados. | NO_VERIFICADO; varias funciones no están implementadas y el GPS real sigue bloqueado. |
| DONE_INTEGRACIÓN | Integraciones aprobadas operativas con evidencia, incluido GPS si forma parte de aceptación. | PENDIENTE: integración inicial con QuadMinds sin contrato técnico, acceso ni prueba real; base/infraestructura de producción pendientes. |
| APTO_PARA_OPERACIÓN | Preparación para operación real con evaluación de seguridad, hardening, requisitos legales aplicables, GPS e infraestructura. | NO; no se declara aptitud operativa. |
| DONE global | Todos los requisitos originales aprobados integrados y validados; no hay bloqueos. | NO. Tracking real pendiente de integrar con QuadMinds y quedan capacidades del V0.1 sin implementar. |

La validación se limita a los flujos y controles documentados en `docs/INFORME_QA.md`; QA-03, QA-05 y QA-07 y las autorizaciones HTTP están completados. No extrapolar esos resultados al alcance completo del Prompt Maestro V0.1 ni a producción.

## Fuera de alcance de esta propuesta inicial

Estos puntos están excluidos del borrador actual; la exclusión no significa que el negocio nunca los necesite. Si la operación los requiere, deben reincorporarse mediante decisión explícita antes de congelar el masterblueprint.

| Exclusión | Estado | Fuente |
|---|---|---|
| Página institucional/pública | CONFIRMADO como excluida | Prompt maestro V0.1, seccs. 1 y 18 |
| WMS avanzado adicional al inventario solicitado | El inventario con código de barras sí está incluido por instrucción posterior; funciones WMS adicionales requieren especificación. | Requisitos del cliente, 15-10-2026; `PLAN_OPERATIVO_CLIENTE.md` |
| ERP contable y facturación fiscal | CONFIRMADO como excluidos | Prompt maestro V0.1, secc. 18 |
| Comercio exterior, cadena de frío y sensores | CONFIRMADO como excluidos | Prompt maestro V0.1, secc. 18 |
| Optimizador propio y marketplace de transportistas | CONFIRMADO como excluidos | Prompt maestro V0.1, secc. 18 |
| IA que cambie estados o apruebe dinero | CONFIRMADO como excluida | Prompt maestro V0.1, secc. 18 |
| SaaS público multiempresa e integraciones no autorizadas | CONFIRMADO como excluidos | Prompt maestro V0.1, seccs. 3 y 18 |
| GPS y tracking reales | Incluidos en el alcance del cliente mediante QuadMinds; pendientes de integración real. | Requisitos del cliente, 15-10-2026; `PLAN_OPERATIVO_CLIENTE.md` |
| Operación offline | No implementada. | FUERA DE ALCANCE inicial / PENDIENTE | Decisión posterior del usuario |
| Portal de inventario del cliente y enlace de destinatario | Portal de inventario requerido y pendiente de implementar; enlace para destinatario no solicitado en estos seis requisitos. | Requisitos del cliente, 15-10-2026; `PLAN_OPERATIVO_CLIENTE.md` |
| Finanzas y rendiciones | No implementadas. | FUERA DE ALCANCE inicial / PENDIENTE | Decisión posterior del usuario |
| Importaciones | No implementadas. | FUERA DE ALCANCE inicial / PENDIENTE | Instrucción actual |
| Impresión de etiquetas | Se generan códigos de bulto, pero no hay impresión/generación de etiquetas. | PENDIENTE | Estado final informado para esta actualización |
| Captura por cámara | No implementada; la carga/escaneo disponible no constituye captura de cámara. | PENDIENTE | Estado final informado para esta actualización |
| Replanificación de rutas en curso | No implementada; el orden manual actual no equivale a replanificación activa. | PENDIENTE | Estado final informado para esta actualización |

## Implementación observada

| Capacidad | Estado observado | Fuente |
|---|---|---|
| Persistencia y esquema | SQLite persistente, esquema con restricciones y claves foráneas, WAL, transacciones e idempotencia. La migración versionada 2 añade documentos e historial de chofer, más evidencia por etapa de devolución, conservando la versión 1. Ruta predeterminada `.local/logistics.sqlite`. | CONFIRMADO (código) | `server/db.ts`, `server/schema.sql`, `server/migrations/002_controls.sql`, `server/index.ts` |
| Roles | `ADMIN`, `OPERATIONS`, `DEPOT`, `DRIVER`; autorización org-scoped en backend. | CONFIRMADO (código) | server/auth.ts, server/domain.ts |
| Operación | Recepción y custodia, capacidad por tramo, orden manual, asignaciones, checklist, guardas de despacho, intentos y devoluciones. El despacho bloquea ante documentación impeditiva vencida del vehículo o del chofer. | CONFIRMADO (código) | `server/domain.ts`, `server/schema.sql`, `server/migrations/002_controls.sql` |
| Superficies UI | Inicio, envíos, rutas, flota, clientes, documentos de chofer, mantenimiento, operaciones de devolución y tracking bloqueado. | CONFIRMADO (código presente) | `frontend/App.tsx`, `frontend/DriverDocumentsPanel.tsx`, `frontend/MaintenancePanel.tsx`, `frontend/ReturnOperations.tsx` |
| Documentos de chofer | Alta con nombre de requisito definido por operaciones, estado de vencimiento, opción explícita de bloqueo y renovación auditada con fecha anterior/nueva. La alta admite registrar fechas vencidas; no presupone una licencia universal. | CONFIRMADO (API y UI) | `server/driver-documents.ts`, `server/migrations/002_controls.sql`, `frontend/DriverDocumentsPanel.tsx` |
| Mantenimiento | La UI permite programar por fecha o kilometraje y cerrar una tarea abierta con nota y foto guardada. | CONFIRMADO (API y UI) | `server/app.ts`, `server/validation.ts`, `frontend/MaintenancePanel.tsx` |
| Devoluciones y evidencia | Recepción en depósito con foto, evidencia separada para entrega al remitente cuya SHA-256 debe diferir, y subsanación auditada de recepciones legacy `AT_DEPOT` sin foto por `ADMIN`/`OPERATIONS`. | CONFIRMADO (API y UI) | `server/domain.ts`, `server/migrations/002_controls.sql`, `frontend/ReturnOperations.tsx` |
| Tracking, portales, finanzas, offline e importaciones | Tracking QuadMinds preparado con configuración pendiente; portales, finanzas, offline e importaciones sin implementar. | CONFIRMADO (código local) / PENDIENTE (integración real) | `server/quadminds.ts`, `docs/QUADMINDS.md` |
| Build y tests | Consultar `docs/INFORME_QA.md` para el resultado actual de la suite y los flujos verificados. | CONFIRMADO (resultados de núcleo local) / NO_VERIFICADO (V0.1 completo y producción) | `docs/INFORME_QA.md` |

## Fuentes registradas

1. `C:\Users\User\Downloads\PROMPT_OS_LOGISTICA_V0_1.md`, **OS de Logística — Prompt Maestro V0.1**, fechado el 15 de octubre de 2026. Fuente principal de misión, requisitos, propuestas, decisiones pendientes, exclusiones y criterios de aceptación.
2. Inspección autorizada del workspace `C:\Users\User\Desktop\PORYECTOS\NEXORA LOGISTIC OS`; `git rev-parse` falló, por lo que esta carpeta no es un repositorio Git. No hay branch, SHA, remoto ni push que documentar.
3. Referencias GPS incluidas en el prompt, consultadas allí el 15 de octubre de 2026; verificar su documentación vigente antes de implementar: [W3C Geolocation](https://www.w3.org/TR/geolocation/) y [Android: acceso a ubicación en segundo plano](https://developer.android.com/develop/sensors-and-location/location/background).
4. Código y comandos: `package.json`, `vite.config.ts`, `server/app.ts`, `server/auth.ts`, `server/db.ts`, `server/domain.ts`, `server/validation.ts`, `server/schema.sql`, `server/migrations/002_controls.sql`, `server/driver-documents.ts`, `frontend/App.tsx`, `frontend/DriverDocumentsPanel.tsx`, `frontend/MaintenancePanel.tsx`, `frontend/ReturnOperations.tsx`, `scripts/seed-demo.ts` y `scripts/preview.ts`.

## Registro de cambios de decisiones

### Proyecto Supabase indicado para Nexora

- URL proporcionada por el usuario: `https://pnaqjenemmfydetkpokk.supabase.co`.
- Referencia del proyecto: `pnaqjenemmfydetkpokk`.
- El negocio administra su propia cuenta y asume su facturación; no usar proyectos de los otros negocios del usuario.
- Acceso del chat confirmado mediante la conexión llamada `Nexora`, después de autorizar la cuenta nueva. Proyecto `pnaqjenemmfydetkpokk`, organización `nqcmrnakhvogvwapuojd`, región `us-east-2`, estado `ACTIVE_HEALTHY`.
- Preparación ejecutada por pedido posterior del usuario: esquema privado `nexora` con 31 tablas, permisos y RLS; servidor adaptado a PostgreSQL asíncrono y conexión real comprobada con un rol exclusivo limitado, guardado en `.env`. Preview principal en 5173 usa Supabase; DEMO SQLite separada en 5174.
- La inspección inicial del 15-10-2026 encontró `public` vacío. Durante este trabajo ya estaba presente la migración `portal_customer_access` con dos tablas de portal: se conservaron sin modificarlas. Las migraciones de Nexora no reemplazan ese trabajo.
- No existía base operativa SQLite local para importar. No se copiaron datos DEMO. Las pruebas reales de flujo terminaron en rollback y no dejaron datos ficticios en Supabase. La primera cuenta administradora queda a cargo del responsable desde la pantalla inicial. Ver `SUPABASE.md` y la actualización de `INFORME_QA.md`.

El prompt permite que una instrucción explícita posterior modifique decisiones previas; cualquier cambio debe anotarse aquí con fecha, nueva decisión, estado y fuente.

| Fecha | Decisión | Estado | Fuente |
|---|---|---|---|
| 15-10-2026 | Stack de desarrollo: TypeScript + Node.js + React/Vite; SQLite persistente para desarrollo local. Base de datos de producción pendiente. | CONFIRMADO (desarrollo) / PENDIENTE (producción) | Instrucción posterior del usuario |
| 15-10-2026 | Operación inicial con bultos ya preparados para reparto, sin inventario ni preparación por SKU. | CONFIRMADO | Instrucción posterior del usuario |
| 15-10-2026, posterior | El cliente requiere inventario en local con entradas/salidas por código de barras y acceso de consulta; sustituye la decisión anterior sin inventario. También exige ruteo diario, GPS celular y app de QuadMinds con foto y firma. El plan vigente está en `PLAN_OPERATIVO_CLIENTE.md`; implementación nueva pendiente. | CONFIRMADO (requisitos) / PROPUESTO (plan) / PENDIENTE (ejecución) | Seis requisitos del cliente transmitidos directamente por el usuario |
| 15-10-2026 | GPS real, finanzas, operación offline, portales, importaciones, impresión de etiquetas, captura por cámara y replanificación en curso siguen pendientes. Documentos de chofer, UI de mantenimiento y flujos de evidencia de devolución sí están implementados. | CONFIRMADO (estado de código) / PENDIENTE (capacidades restantes) | `server/*`, `frontend/*`, `server/migrations/002_controls.sql` |
| 15-10-2026 | QA-03, QA-05 y QA-07 y las autorizaciones HTTP están completados. La cifra actual de pruebas y los resultados se consultan en `docs/INFORME_QA.md` para evitar registrar un conteo que cambie. Esto no completa V0.1 ni aprueba producción. | CONFIRMADO (estado de QA informado) / PENDIENTE (global) | Estado de QA informado; `docs/INFORME_QA.md` |
| 15-10-2026 | El seed crea únicamente `.local/demo.sqlite`; sus cuentas son ficticias y no se usan en la base de operación `.local/logistics.sqlite`, que no fue sembrada. | CONFIRMADO | `scripts/seed-demo.ts` y estado final informado para esta actualización |
| 15-10-2026 | Preparar integración QuadMinds antes de recibir endpoint/credenciales. Se implementaron conector GET configurable, autenticación privada de servidor, vínculos auditados, última posición persistente, estados de antigüedad/falla y panel Tracking. No se inventó endpoint GPS ni contrato del proveedor. GPS propio queda para después. | CONFIRMADO (preparación local) / PENDIENTE (contrato y prueba real) | Pedido del usuario recuperado de `Texto pegado.txt`; `docs/QUADMINDS.md` |

La identidad visual del OS se actualizó por pedido posterior del usuario: colores y logo Nexora provenientes de los recursos del workspace, jerarquía abierta, controles sin wrappers rectangulares y compactación medida superior al 20% por vista del fixture. Ver `REDISENO_UI.md`. Esto no define territorio, condiciones comerciales ni infraestructura de producción.









