# Entrega del núcleo local

**Actualización 16/10/2026:** tracking propio Traccar desplegado e integrado al OS y a la web; QuadMinds conservado para Universo. Consultar [TRACCAR_OPERACION.md](TRACCAR_OPERACION.md) y la actualización de [HANDOFF_CONTINUIDAD_2026-10-16.md](HANDOFF_CONTINUIDAD_2026-10-16.md).

**Estado posterior:** este documento conserva la entrega histórica del núcleo. Para el trabajo vigente de inventario, importaciones, portal, Supabase y QuadMinds, consultar [ENTREGA_INVENTARIO_Y_QUADMINDS.md](ENTREGA_INVENTARIO_Y_QUADMINDS.md), [INFORME_QA.md](INFORME_QA.md) y [AUDITORIA_IMPLEMENTACION.md](AUDITORIA_IMPLEMENTACION.md).

Fecha: 15 de octubre de 2026. Workspace: `C:\Users\User\Desktop\PORYECTOS\NEXORA LOGISTIC OS`.

La carpeta inicial estaba vacía y no pertenecía a un repositorio Git: `git rev-parse --is-inside-work-tree` devolvió `fatal: not a git repository`. No hay rama, SHA ni remoto que reportar. No se hicieron commits, push ni despliegues.

## Decisiones confirmadas

El usuario aprobó TypeScript, Node.js, React/Vite y SQLite persistente para desarrollo local; confirmó bultos preparados para repartir y dejó la fuente GPS por definir. La base de producción sigue pendiente. Tres subagentes `gpt-6-luna`, razonamiento `xhigh`, trabajaron en tareas de interfaz, estilos, documentación y pruebas acotadas; el agente principal implementó y revisó el backend y la integración.

## Archivos entregados

| Grupo | Archivos |
|---|---|
| Ejecución | `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore` |
| Persistencia y migraciones | `server/db.ts`, `server/schema.sql`, `server/migrations/002_controls.sql`; migraciones atómicas y repetibles, con prueba de conservación de datos v1 |
| API, autenticación y dominio | `server/index.ts`, `server/app.ts`, `server/auth.ts`, `server/errors.ts`, `server/validation.ts`, `server/domain.ts`, `server/driver-documents.ts` |
| Interfaz | `frontend/main.tsx`, `frontend/App.tsx`, `frontend/styles.css`, `frontend/MaintenancePanel.tsx`, `frontend/DriverDocumentsPanel.tsx`, `frontend/ReturnOperations.tsx` |
| Tests y fixture | Seis archivos `tests/*.test.ts`, `scripts/seed-demo.ts`, `scripts/preview.ts` |
| Documentación | `README.md`, `docs/CONTEXTO_Y_DECISIONES.md`, `docs/CONTRATOS_API.md`, `docs/CASOS_ACEPTACION.md`, `docs/INFORME_QA.md`, este archivo |
| Capturas reales | `docs/evidencias/inicio-demo.png`, `docs/evidencias/chofer-movil-demo.png` |

## Comprobaciones realizadas

- Instalación inicial: `npm.cmd install --no-audit --no-fund --cache .local/npm-cache`, exit 0. La caché global estaba fuera del permiso de escritura del sandbox; se usó la del workspace.
- `npm.cmd test`: 32 tests, 32 PASS, 0 FAIL; duración 6.495,8094 ms. SQLite real en archivos temporales aislados; incluye HTTP concurrente, permisos, CSRF, custodia, capacidad, controles y P1–P5. Nuevas pruebas verifican migración v1→v2, documentos de chofer, renovación, mantenimiento HTTP con foto, fotos independientes de retorno y subsanación auditada. El desglose de aceptación distingue las partes aún no cubiertas.
- `npm.cmd run build`: TypeScript y Vite PASS. Última salida: 32 módulos, CSS 20,23 kB, JS 306,12 kB; compilación Vite 2,48 segundos.
- Navegador: login y tablero DEMO, alta de cliente y comprobación SQL; en viewport móvil, confirmar plan, escanear cuatro bultos, cambiar a cuenta de chofer, guardar checklist y despachar. SQL confirmó ruta `IN_PROGRESS`, versión 8, cuatro bultos `IN_TRANSIT`, uno `EXPECTED`, una inspección.
- La vista de chofer no mostró desbordamiento horizontal: ancho de contenido y de viewport de 375 px en la medición DOM. Se restableció el tamaño del navegador. Esta prueba responsive no es un ensayo físico de GPS ni una validación de teléfono.
- Se corrigieron durante QA el formato de fechas que impedía renderizar el tablero, la propagación de claves de idempotencia, los permisos visibles, el formulario de carga en rutas READY, las opciones de reintento y la legibilidad de navegación/tarjetas.

La continuación solicitada por el usuario deja una vista previa administrada en segundo plano en `http://127.0.0.1:5173`, con `.local/demo.sqlite`. La base DEMO conserva los movimientos ficticios anteriores; no se sembró una base operativa. Los servidores efímeros de los tests se cierran al terminar cada prueba.

La revisión visual de los tres paneles nuevos queda `NOT_RUN`: en esta continuación IAB no estaba disponible y Chrome devolvió `Unable to load browser request-header policy` incluso tras reintentar. Se solicitó abrir la vista previa en Codex; la herramienta devolvió `queued`. No hay captura nueva ni afirmación de éxito visual para estos formularios. Sus contratos sí se comprobaron mediante HTTP, SQLite y compilación.

Actualización posterior — rediseño solicitado: el navegador integrado volvió a estar disponible. Se rediseñaron las seis vistas, acceso y móvil con identidad Nexora; se verificó navegación, selección de recepción, alta de cliente y vista del chofer. La compactación medida supera el 20% en cada vista de escritorio del fixture. Ver `REDISENO_UI.md` para el alcance visual actual, resultados y nuevas capturas. Esto resuelve el bloqueo de inspección visual anterior para el recorrido indicado; no equivale a un E2E de navegador de todas las mutaciones.

## Ejecutar

Ver `README.md`. Para retomar la DEMO compilada, `npm run preview`; para consultar el estado, `npm run preview:status`. Tras editar código: `npm run build` y `npm run preview:restart`. Se detiene con `npm run preview:stop`. El lanzador comprueba la identidad de su proceso antes de detenerlo y usa una ventana oculta en Windows. Logs: `.local/preview.log` y `.local/preview-error.log`.

Para desarrollar con recarga, detener la vista previa y ejecutar `npm run dev`, que inicia API y Vite. Sin `DATABASE_PATH`, se crea la base vacía `.local/logistics.sqlite` y la interfaz permite configurar administrador y zona horaria. No hay contraseña predeterminada para la base operativa.

Para DEMO: `npm run seed:demo` crea `.local/demo.sqlite` si falta y muestra las credenciales ficticias; no sobrescribe una base DEMO existente. Seleccionar esa ruta con `DATABASE_PATH` antes de iniciar. La demostración usa UTC como dato explícito del fixture, sin imponer zona al negocio.

En el sandbox de Codex, la optimización de dependencias de Vite necesitó acceso adicional de lectura a directorios padre; la revisión automática autorizó el arranque local. La alternativa compilada es `npm run build` y, después, `npm start`, que sirve la interfaz y la API en `http://127.0.0.1:3001`.

## Límites concretos

`DONE_DESARROLLO`: núcleo local implementado y probado para los recorridos indicados; no equivale a haber completado toda la V0.1. `DONE_INTEGRACIÓN` y `APTO_PARA_OPERACIÓN` no alcanzados. El requisito original de tracking real sigue `BLOQUEADO_DECISIÓN`.

Quedan pendientes fuente/dispositivo GPS y ensayo físico; base e infraestructura de producción; modalidad de flota, restricciones de carga, políticas de servicio y retención. Finanzas, portales, offline, importaciones, etiquetas imprimibles/lector por cámara y replanificación en ruta no están implementados. La documentación del chofer es configurable por Operaciones, sin requisitos legales inventados; registra alta y renovaciones y bloquea despacho si un documento impeditivo está vencido. Mantenimiento tiene interfaz y API, con cierre mediante nota y foto.

La devolución al depósito ahora exige foto vinculada al bulto y conserva recibo, actor y evento de custodia. La entrega al remitente exige otra imagen; también se rechaza el mismo contenido subido con otro identificador. Las recepciones v1 que ya estaban en depósito sin foto se subsanan exclusivamente por Administración/Operaciones con nota, actor y fecha actual, sin reescribir la custodia anterior. Un retorno abierto impide reasignar el bulto a otra ruta. Las evidencias privadas se guardan en SQLite local, sin proveedor externo.

El listado inicial limita cada colección a 500 registros y advierte si la vista se recorta; la API permite paginar envíos. No hay pruebas de carga ni aprobación de volumen operativo. El circuito local valida capacidad por tramo y por carga real al retirar; no calcula ETA, distancia vial ni optimización automática.

No se creó masterblueprint ni roadmap, siguiendo el documento de entrada.
