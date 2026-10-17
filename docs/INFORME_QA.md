# Informe de QA — OS de logística

## Limpieza de interfaz y catálogo masivo — 15-10-2026

- Suite local: **81 PASS, 0 FAIL, 0 omitidas**. Build final TypeScript + Vite **PASS**, 1595 módulos; JS 448.20 kB (gzip 125.40), CSS 47.51 kB. El lector XLSX se ejecuta exclusivamente en servidor.
- PostgreSQL real: caso de catálogo masivo **PASS**, 22430 ms; conserva ceros, ignora columnas adicionales, admite seguimiento por lote, mantiene idempotencia/stock/totales y revierte el fixture por rollback. Es el quinto caso PostgreSQL aprobado entre las corridas documentadas, no una ejecución conjunta nueva de toda la suite.
- IAB, DEMO SQLite: XLSX con tres SKU `007001`–`007003`, códigos con ceros y columnas Marca/Stock. Vista previa 3 altas; ambas columnas omitidas. Confirmar creó catálogo sin ingresar las 900 unidades del archivo. Dos lecturas del primer SKU y su confirmación agregaron solamente 2 unidades. Otro SKU o código desconocido no modifica la cesta pendiente.
- Pulido final: una lectura de Cocina `007002` y confirmación agregó 1 unidad; se eliminó la cesta y el foco volvió al campo del lector. Cambiar al SKU Microondas antes de confirmar quedó bloqueado y no dejó un éxito anterior junto al error. Saldos finales DEMO: 5 disponibles y 4 reservadas.
- KPI Reservado filtra las dos filas reservadas. Inventario inicial sin formularios (antes 2); altura con cinco filas 986 px frente a 1838 px previos, a 1366×768. Tabla con altura máxima y listas paginadas de 20 filas. Flota pasó de 2339 px a 768 px con alta cerrada. Las medidas dependen de datos/viewport.
- Rutas abre lista sin crear/seleccionar automáticamente; detalle separado en Preparar/Paradas. Se verificaron referencias de pedido en lugar de UUID y códigos de bulto detrás del detalle. Pedidos abre búsqueda/lista sin importador ni preparación permanentes.
- Modal de producto: tracking de solo lectura, Escape cierra, restaura foco y desbloquea scroll. Móvil 390×844: ancho documental 375 px, sin desborde global; tabla desplazable internamente (760 px en 303 px). Override de viewport restaurado.
- Evidencias: [inventario](evidencias/ui-inventario-limpio.jpg), [Flota](evidencias/ui-flota-limpia.jpg), [móvil](evidencias/ui-inventario-movil.jpg), [recepción](evidencias/ui-recepcion-limpia.jpg). Capturas IAB algo borrosas: verificados estructura y DOM, sin declarar revisión completa de tipografía/píxeles. No se probó lector físico, cámara ni celular real.
- Previews reiniciadas: Supabase 5173, DEMO aislada 5174. No se sembró producción ni se modificó `web-publica`. [Auditoría del cambio](AUDITORIA_UI_CATALOGO.md).

## Actualización inventario y portal — 15-10-2026

- Suite local: **66 PASS, 0 FAIL, 0 omitidas**, 14634 ms; incluye auditoría de cliente/importador/QuadMinds y circuito inventario–carga–POD–retorno con proveedor fixture.
- TypeScript y Vite: **PASS**. La anidación de formularios del escáner se corrigió: tres lecturas Enter del mismo código de modelo permanecen en recepción y no confirman stock hasta pulsar Registrar recepción.
- Chrome sobre DEMO aislada: producto/ubicación, recepción de 3 unidades, vista previa/importación de pedido de 2, edición DRAFT y reserva verificadas. Existencias finales: 1 AVAILABLE + 2 RESERVED; edición desaparece tras reserva. El navegador declara falta de BarcodeDetector y ofrece USB/manual. No se usaron datos reales ni se sembró Supabase.
- Portal CUSTOMER ficticio en Chrome: acceso, inventario, pedido, movimientos y exportación CSV verificados. El CSV contiene únicamente las dos filas esperadas (1 AVAILABLE, 2 RESERVED). Los dos bultos indican resultado pendiente. Se corrigió fecha de calendario que se desplazaba al día anterior en America/Asuncion; la recarga final muestra `16/10/2026` para el pedido fechado `2026-10-16`. Build final TypeScript/Vite PASS (11.08 s; JS 415.38 kB). Captura de escritorio: [inventario y reserva](evidencias/inventario-reserva-final.jpg). En viewport móvil el DOM expone navegación y formularios y no se observó desborde global de ancho en la medición; la captura móvil agotó el tiempo del navegador y no se declara inspección visual móvil completa ni ensayo de celular.
- Suite PostgreSQL tras migración 007: **3 PASS**, 278393 ms; circuito nuevo (195120 ms), API/permisos (3828 ms), núcleo anterior (76220 ms). Después se añadió y aprobó una **cuarta prueba** específica de CSV rechazado, errores por fila persistidos y retry sin duplicar historial (**1 PASS**, 9082 ms). Todos los fixtures remotos terminan en rollback.
- Supabase: **47/47 tablas privadas con RLS**, migraciones de aplicación 1–7. Asesor de seguridad: sin aviso de RLS; advertencia general de Supabase Auth por protección de contraseñas filtradas deshabilitada. El OS usa sesiones/scrypt propios; no se alteró el Auth del portal público paralelo. [Referencia del aviso](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- QuadMinds permanece deshabilitado. HMAC, cola, medidas, secuencia, resultados, foto/firma y descargas seguras se verificaron con fixtures; faltan credenciales/cuenta, dispositivo, programación y piloto reales.

Ver [entrega vigente](ENTREGA_INVENTARIO_Y_QUADMINDS.md) y [auditoría independiente](AUDITORIA_IMPLEMENTACION.md). Las secciones siguientes son históricas.

## Actualización Supabase — 15 de octubre de 2026

- Proyecto `pnaqjenemmfydetkpokk`, conexión `Nexora`: esquema privado con **31 tablas**, todas con RLS. Rol `nexora_runtime` sin superusuario, creación de bases/roles ni bypass de RLS. Asesor de seguridad Supabase: lista de hallazgos vacía.
- `npm test`: **45 PASS, 0 FAIL**, 10276.2441 ms. Se mantienen las 43 pruebas anteriores, adaptadas a operaciones asíncronas, y se agregan dos pruebas del adaptador PostgreSQL.
- `npm run test:postgres`: **2 PASS, 0 FAIL**, 90768.3203 ms, contra la base real. Health API comprueba PostgreSQL y acceso anónimo a bootstrap devuelve 401; el rol no puede leer `auth.users` ni crear tablas. El flujo de dominio valida recepción parcial, idempotencia, índice de asignación única, exclusión de ventanas, documentación, despacho, fotos `bytea`, entrega, devolución con fotos distintas, cierre, bootstrap e aislamiento. Todo el fixture de negocio termina en rollback; se comprobó ausencia de su organización y usuario al finalizar. Los conflictos se probaron contra constraints reales; no se declara un ensayo de carga concurrente distribuida.
- `npm run build`: **PASS**, TypeScript y Vite (8.10 s).
- Preview principal reiniciado en 5173 con Supabase. `GET /api/health`: HTTP 200, `database:"postgres"`; `GET /api/session`: HTTP 200, `setupRequired:true`. Chrome muestra la primera configuración de organización/administrador y la consola consultada devuelve lista vacía de errores. No se introdujeron credenciales administradoras ficticias ni se realizó un flujo autenticado de navegador contra la base nueva.
- No existía `.local/logistics.sqlite`. No se copiaron datos DEMO. La DEMO SQLite se conserva y puede iniciarse explícitamente en 5174.
- La conexión TLS valida certificado y hostname con la CA del proveedor. Credencial de servidor generada localmente, exclusiva y excluida de Git; no se usó la contraseña personal del usuario ni se deshabilitó TLS.
- Se conservaron las dos tablas de portal en `public` y su migración previa. No se desplegó Vercel. QuadMinds real, recepción automática de pedidos e inventario por SKU siguen pendientes.

Ver [configuración y alcance](SUPABASE.md). Los resultados siguientes son históricos.

## Actualización QuadMinds — 15 de octubre de 2026

Historia verificada: Tracking consulta la configuración y el vehículo de una ruta; la API aplica autorización/vinculación y normaliza posiciones; la interfaz presenta la medición o el estado pendiente.

- Suite final: `npm test`, **43 PASS, 0 FAIL**, 5767.2143 ms. Se agregaron 11 pruebas en `tests/quadminds.test.ts`, sin llamadas al proveedor real.
- Build final: `npm run build`, **PASS**, TypeScript y Vite (2.87 s). No se agregaron dependencias.
- Cobertura nueva: configuración/HTTPS, coordenadas/fechas inválidas, roles/tenant/CSRF, vinculación idempotente/única, privacidad de claves, caché/concurrencia, fallas/timeouts/respuestas grandes, regresión temporal, cambios de vínculo en vuelo y persistencia tras reinicio. La prueba anterior de migración v1 sigue aprobada y aplica también v3.
- Chrome, DEMO en `http://127.0.0.1:5173`: acceso, navegación a Tracking, panel QuadMinds y selector de ruta comprobados. Al seleccionar la ruta DEMO aparece el mensaje correcto de configuración pendiente, sin posiciones inventadas. Captura inspeccionada durante la sesión; no guardada como nuevo archivo. Consulta de errores de consola: lista vacía. Cubre escritorio deshabilitado; no prueba móvil ni renderizado con proveedor real.
- Preview reiniciado con build actual y migración v3 en la DEMO; no se sembró ni abrió la base operativa.
- Pendiente externo: endpoint/payload confirmados, credenciales, límites y prueba con vehículo real. No se declara conectividad real, tracking operativo ni aptitud de producción. Ver [activación y contrato](QUADMINDS.md).

| Límite del flujo | Evidencia | Resultado |
| --- | --- | --- |
| UI → API | Chrome muestra panel y estado pendiente al seleccionar ruta | PASS sin configuración |
| API → autorización/vinculación | Pruebas HTTP y dominio | PASS |
| Conector → respuesta normalizada | Transporte inyectado y fixtures aislados | PASS en tests |
| Datos → persistencia/respuesta | SQLite temporal, reapertura y caída conservan última medición | PASS |
| Respuesta → UI | Estado pendiente visible; tipos de respuestas con posiciones compilan | PASS acotado; posiciones reales pendientes |

## Resultados históricos anteriores

**Actualización posterior de interfaz:** el rediseño solicitado se comprobó con navegador disponible, incluidas las seis vistas, flota completa, acceso y navegación móvil del chofer. Suite: 32 PASS / 0 FAIL; build PASS. Ver [REDISENO_UI.md](REDISENO_UI.md) para las mediciones y capturas nuevas. Los bloqueos de navegador descritos abajo corresponden a la corrida previa; no describen esta revisión visual posterior. Las limitaciones de negocio y GPS se mantienen.

**Fecha:** 15 de octubre de 2026  
**Alcance de esta actualización:** suite automatizada local, controles HTTP/dominio y persistencia SQLite.  
**Stack vigente:** TypeScript, Node.js, React, Vite y SQLite. La zona horaria usada en fixtures es UTC; los bultos se tratan como unidades preparadas. La fuente de GPS sigue pendiente de decisión.

## Resultado ejecutivo

La suite final reportada por coordinación terminó con **32 tests aprobados, 0 fallidos**, en 6495.8094 ms, distribuidos en seis archivos: `flow`, `guards`, `acceptance-v2`, `controls-v2`, `controls-http` y `driver-documents`. El build final pasó con 32 módulos (CSS 20.23 kB, JS 306.12 kB; Vite 2.48 s). Los controles nuevos cubren rechazo sin efectos de recepciones inválidas, guardas HTTP por ID, migración de SQLite v1 a v2, corrección auditada de evidencia legacy, documentos de chofer y prueba fotográfica independiente en las dos etapas de devolución.

El preview reiniciado en `127.0.0.1:5173` respondió 200 en health, índice y asset; el login DEMO respondió 200 y bootstrap devolvió las colecciones nuevas. La consulta SQL encontró migraciones 1 y 2 y conservó datos DEMO: cuatro bultos `IN_TRANSIT`, uno `EXPECTED` y ruta `IN_PROGRESS` versión 8. Esto verifica disponibilidad HTTP y datos; no reemplaza una inspección visual.

No se pudo repetir la comprobación visual en esta corrida: el navegador integrado no estuvo disponible y Chrome devolvió `Unable to load browser request-header policy` después del reintento. Las capturas `docs/evidencias/inicio-demo.png` y `docs/evidencias/chofer-movil-demo.png` corresponden a la demostración histórica anterior; se conservan como evidencia de ese recorrido y no se presentan como verificación visual del árbol actual.

Estos resultados demuestran una suite local aprobada y un build final, dentro de los flujos acotados que se describen abajo. **No declaran el sistema listo para operar.** Seguimiento GPS real, portales, finanzas, cola offline, importación y proveedores externos siguen sin implementación o aprobación. La demostración móvil y las capturas existentes son históricas; no hubo una nueva inspección visual ni ensayo en teléfono físico o GPS.

## Entorno y evidencia reproducible

| Control | Comando/recorrido | Entorno y evidencia | Resultado |
|---|---|---|---|
| Suite completa | `npm test` (`node --test tests/*.test.ts`) | Corrida final reportada: 32 tests, 32 pass, 0 fail; duración 6495.8094 ms. Seis archivos: `flow.test.ts`, `guards.test.ts`, `acceptance-v2.test.ts`, `controls-v2.test.ts`, `controls-http.test.ts` y `driver-documents.test.ts`. | `PASS` |
| Integración P1–P5 y devoluciones | Incluida en `npm test` | `tests/flow.test.ts` levanta la app HTTP sobre SQLite temporal. El retorno a depósito ahora exige una foto del bulto: foto ausente o de otro bulto no cambia custodia; repetir con el mismo comando no agrega otro evento. La foto de remitente debe tener SHA distinto de la de depósito. | `PASS` para las aserciones del flujo. |
| Guardas de dominio, controles y HTTP | Incluidos en `npm test` | `guards.test.ts`, `acceptance-v2.test.ts`, `controls-v2.test.ts` y `controls-http.test.ts` cubren accesos por ID, bootstrap de chofer, concurrencia, dimensiones desconocidas, migración y controles de flota/devolución. | `PASS` para los asserts ejecutados; alcance por QA abajo. |
| Build | `npm run build` (`tsc --noEmit` y build Vite) | Corrida final: 32 módulos, CSS 20.23 kB, JS 306.12 kB; Vite 2.48 s. | `PASS` |
| Preview HTTP y persistencia DEMO | Health, índice, asset, login, bootstrap y consulta SQLite | Preview en `127.0.0.1:5173`: HTTP 200 en health/índice/asset, login DEMO 200 y bootstrap con colecciones nuevas. SQLite: migraciones 1 y 2; cuatro `IN_TRANSIT`, uno `EXPECTED`, ruta `IN_PROGRESS` v8. | `PASS` para esta comprobación HTTP y consulta; no es inspección visual. |
| Navegador | Recorrido de escritorio y móvil | En la corrida actual no se pudo abrir un navegador: IAB no disponible; Chrome devolvió `Unable to load browser request-header policy` tras reintentar. Se conservan las capturas históricas `docs/evidencias/inicio-demo.png` y `docs/evidencias/chofer-movil-demo.png`. | `BLOCKED` para inspección visual nueva; las capturas históricas no validan el árbol actual. |

Los tests usan datos ficticios y SQLite temporal. No se conectan a un teléfono, GPS, banco, portal externo ni proveedor de mensajería/almacenamiento. La suite no es una prueba de carga ni de despliegue.

## Fixture P1–P5 ejecutado

En `tests/flow.test.ts`, P1–P5 nombran por orden cinco códigos generados por el servidor. Cada bulto tiene 1.000 g y 1.000 cm³; el vehículo de prueba soporta 100.000 g y 100.000 cm³; el envío exige `RECEIVER_PHOTO`. Son valores aislados de QA, sin valor comercial. La organización se crea en UTC con una contraseña de más de 12 caracteres.

El test recibe P1–P4, repite la recepción con la misma clave y con una nueva clave, crea una ruta con ventana desde un minuto antes hasta una hora después, comprueba checklist, marca lista, escanea/carga los cuatro bultos, repite el primer escaneo con claves iguales y distintas y despacha. Intenta entregar P1 sin foto y comprueba rechazo sin intento, evento de custodia ni cambio de estado; luego entrega P1–P3 con imágenes distintas y registra P4 como `REFUSED` con acción «Volver a depósito». Para recibir P4 en depósito, comprueba que la foto ausente y una foto de otro bulto se rechazan sin cambiar custodia. Una foto de recepción vinculada a P4 permite el ingreso; repetir esa operación con la misma clave devuelve el resultado previo y no añade un evento. Para la entrega al remitente, una imagen con el mismo SHA que la foto de depósito se rechaza; una foto distinta completa la segunda transición y permite cerrar la ruta con la versión actual.

Al final comprueba conteos `expected=5`, `received=4`, `delivered=3`, `pending=1`, `returned=1`, `missing=1`; P5 conserva `EXPECTED` y cero eventos de custodia. Consulta intentos, artículos entregados/fallidos, incidentes, retornos, auditoría, eventos de custodia y vínculo de organización. Cierra el `Store`, vuelve a abrir el mismo archivo SQLite, levanta la app otra vez y confirma que la organización, la cookie de sesión, la ruta cerrada, los conteos, intentos, custodia y evidencia de remitente persisten.

`controls-v2.test.ts` también simula un retorno legacy ya recibido sin evidencia, exige que solo OPS pueda subsanarlo y comprueba que la nota, actor y hora de la corrección se registran sin alterar custodia ni la recepción original. El test rechaza la asignación de ese retorno abierto a otra ruta y evita reemplazar la evidencia una vez corregida. La misma suite migra una base v1 con datos de custodia: v2 se aplica una vez y conserva los registros existentes.

## Cobertura por caso de aceptación

| Caso | Resultado | Qué demuestra la evidencia | Qué queda fuera del resultado |
|---|---|---|---|
| QA-01 | `PASS` | Se crean cinco bultos; se reciben cuatro; se observa `expected=5`, `received=4`, P5 en `EXPECTED` y sin custodia. | — |
| QA-02 | `PASS` | Recepción y carga repetidas con la misma clave devuelven el resultado previo; una clave nueva para recepción/escaneo ya aplicado no duplica recibos ni eventos de custodia. | — |
| QA-03 | `PASS` | `acceptance-v2.test.ts` rechaza código inexistente y código de otro cliente sin crear recepción, ítems, custodia, auditoría o idempotencia. `guards.test.ts` también rechaza la carga de un código ajeno y conserva custodia. | — |
| QA-04 | `PASS` | Dos sesiones HTTP de operaciones asignan simultáneamente el mismo bulto a dos rutas: una responde 200, otra 409 y queda una asignación activa. | — |
| QA-05 | `PASS` | `acceptance-v2.test.ts` confirma concurrentemente dos rutas con el mismo chofer y vehículo desde dos sesiones HTTP: una queda `READY`, otra sigue `DRAFT` y responde 409. `guards.test.ts` también comprueba que la base rechaza la ruta incompatible. | — |
| QA-06 | `PASS` | Se rechaza una secuencia con 4.000 g iniciales y retiro de 7.000 g frente a 10.000 g de capacidad; otra prueba conserva la carga de un intento fallido antes del retiro. | Los números son exclusivamente del fixture de QA. |
| QA-07 | `PASS` | `guards.test.ts` prueba peso `NULL` y `acceptance-v2.test.ts` volumen `NULL`; ambos valores permanecen desconocidos y bloquean confirmar la ruta sin efectos. | — |
| QA-08 | `PASS` | Defecto crítico abierto y documento marcado impeditivo vencido bloquean el despacho; también se rechaza kilometraje regresivo. | Los documentos del fixture no son requisitos legales del negocio. |
| QA-09 | `PASS` | P1–P3 quedan entregados, P4 con intento fallido y P5 pendiente; el envío conserva conteo parcial y no figura totalmente entregado. | — |
| QA-10 | `NOT_RUN (cobertura parcial)` | En un test independiente, un fallo y un nuevo intento exitoso dejan dos intentos y dos resultados en historial; el incidente se resuelve sin borrar el fallo. La aserción no comprueba por separado que actor, horas y evidencia anterior queden intactos. | — |
| QA-11 | `NOT_RUN (cobertura parcial)` | Entrega sin foto devuelve `EVIDENCE_REQUIRED` y no crea intento, custodia ni cambio de estado. La devolución a depósito también rechaza foto ausente o de otro bulto sin efectos. | La evidencia pendiente de sincronización no se probó; depende del modo offline. |
| QA-12 | `NOT_RUN (cobertura parcial)` | Se ejercitan reintentos idempotentes de recepción/carga, devolución a depósito e intento de entrega. El mismo comando de devolución no agrega evento de custodia; una clave reutilizada con otro cuerpo produce conflicto sin duplicar efectos. | No se corta la red durante entrega/cobro; el flujo financiero no está aprobado ni implementado. |
| QA-13 | `BLOCKED` | — | Cola offline durable y política de conflictos no implementadas/aprobadas. |
| QA-14 | `PASS` | P4 pasa a `RETURNED_TO_DEPOT` con foto de depósito vinculada al bulto; una foto ausente o de otro bulto no produce efectos. Repetir con la misma clave no agrega custodia. La entrega al remitente exige foto con SHA distinto y se registra en un paso separado. El test legacy comprueba subsanación por OPS sin alterar custodia. | — |
| QA-15 | `BLOCKED` | `guards.test.ts` prueba aislamiento de bulto/bootstrap y FK compuesta; `acceptance-v2.test.ts` verifica que otro tenant recibe 404 al leer evidencia por ID. | No hay portal de cliente ni prueba del acceso/descarga por ID desde ese portal. |
| QA-16 | `PASS` | `acceptance-v2.test.ts` verifica que un chofer ajeno recibe 403 al consultar tracking por ID y al cerrar por ID; para el chofer asignado, ambas solicitudes alcanzan sus respuestas autorizadas. `guards.test.ts` confirma lectura/cierre por ID a nivel de dominio y bootstrap sin rutas, bultos ni clientes ajenos. | — |
| QA-17 | `BLOCKED` | — | Enlace público restringido, tokens revocables y límites de abuso no implementados. |
| QA-18 | `BLOCKED` | La prueba HTTP de autorización comprueba 503 para el chofer asignado; health y bootstrap informan `BLOQUEADO_DECISION`. Esto solo acredita el bloqueo explícito. | No hay ingestión de puntos ni pruebas de duplicados, invalidez, frescura o ubicación actual. |
| QA-19 | `BLOCKED` | — | No hay sesión ni fuente de seguimiento real con la que probar pérdida de señal o cierre. |
| QA-20 | `BLOCKED` | — | Ensayo físico no ejecutado; falta definir fuente GPS, dispositivo y proveedor. No se usaron mocks para afirmar operación. |
| QA-21 | `BLOCKED` | — | Módulo de cobros/rendiciones no implementado ni aprobado. |
| QA-22 | `BLOCKED` | — | Diferencias financieras, conciliación y segregación de aprobación no implementadas ni aprobadas. |
| QA-23 | `NOT_RUN` | — | No se encontró módulo de importación/commit que ejecutar. |
| QA-24 | `NOT_RUN (cobertura parcial)` | Cerrar una ruta con parada pendiente devuelve conflicto y conserva la ruta y parada. La suite también rechaza asignar a otra ruta un retorno abierto y conserva el estado sin una asignación parcial. | No se recorrió una incidencia abierta sin responsable ni el flujo completo de conciliación/cierre. |
| QA-25 | `NOT_RUN (cobertura parcial)` | Archivo SQLite real y sesión sobreviven al cierre/reapertura de `Store`/API; los datos del flujo persisten. | Cola de comandos offline, cierre de aplicación, expiración de sesión con pendientes y sincronización siguen bloqueados/no probados. |
| QA-26 | `BLOCKED` | — | No se configuró proveedor externo; estados de proveedor, reintentos y recuperación no se simularon como éxito. |

## Matriz de implementación y estado

| Capacidad | Implementación observada | Verificación | Estado y límite |
|---|---|---|---|
| Recepción, envíos, bultos y diferencias | Endpoints internos y persistencia SQLite. | Flujo integrado P1–P5, conteos y repetición idempotente. | Implementado; cobertura indicada en QA-01/02. |
| Asignación, control de capacidad, carga y despacho | Rutas con versión, chofer, vehículo, checklist y manifiesto escaneado. | Guards para conflicto, capacidad intermedia, desconocidos, defecto/documento y ventana; fixture API completa. | Implementado; reglas verificadas en los asserts descritos, sin optimizador ni navegación. |
| Entrega, pruebas, incidencias, devoluciones y cierre | Intentos por bulto, evidencia privada, custodia y etapas separadas; corrección de evidencia para devoluciones legacy. | P1–P5 prueba recepción con foto del bulto, rechazo de foto ausente/incorrecta, idempotencia de comando y foto de remitente con SHA distinto. `controls-v2.test.ts` verifica corrección solo por OPS sin reescribir custodia, y que un retorno abierto no se asigne a otra ruta. | Implementado y probado en los asserts descritos; QA-24 conserva cobertura parcial del cierre integral. |
| Autorización y tenant | Roles internos y vínculos organizacionales en reglas/persistencia. | Acceso de chofer y aislamiento por organización en pruebas de dominio/base; sesión y CSRF también cubiertos. | Parcialmente probado. No equivale a un portal cliente. |
| Persistencia central | SQLite con archivo real, migración v1→v2 y restricciones/FK. | `controls-v2.test.ts` migra custodia existente una sola vez y conserva sus vínculos; `flow.test.ts` cierra y reabre la base y confirma sesión y datos. | Implementado y probado localmente. |
| Controles de flota | Documentación de chofer con historial e idempotencia. | `driver-documents.test.ts` y `controls-http.test.ts`: documento vencido impeditivo bloquea sin efectos; renovación válida habilita despacho; permisos y aislamiento tenant verificados. | Implementado y probado por suite; sin inspección visual nueva. |
| UI web interna | Login, tablero y vistas de mantenimiento, documentos de chofer y evidencia de devoluciones. | Los componentes nuevos compilaron en el build final. El navegador actual no estuvo disponible; sin inspección visual nueva ni E2E automatizado de navegador. | Implementada; verificación visual del árbol actual `BLOCKED`. |
| Estilos responsive y navegación móvil | Reglas responsive y navegación por rol. | Solo se conserva el recorrido histórico con tamaño de teléfono y `evidencias/chofer-movil-demo.png`; no se volvió a verificar en esta corrida. | Evidencia histórica; teléfono físico y GPS `NOT_RUN`. |
| Portal cliente y enlace público destinatario | No implementados. | Sin prueba de portal; QA-15/17 bloqueados. | `BLOCKED` |
| Modo offline y cola durable | No implementados. | Persistencia central no cubre comandos offline; QA-13 y parte de QA-25 bloqueados. | `BLOCKED` |
| GPS real y seguimiento vivo | No configurados; el estado informa la decisión pendiente. | Sin dispositivo ni prueba física; QA-18–20 bloqueados. | `BLOCKED`; no declarar tracking operativo. |
| Cobranzas y rendiciones | No implementadas ni aprobadas. | Sin cálculos o conciliación ejecutables; QA-21/22 bloqueados. | `BLOCKED` |
| Importación CSV/XLSX | No implementada. | Sin preview/commit ejecutable; QA-23 `NOT_RUN`. | Pendiente de implementación/alcance. |
| Proveedores de mensajería/almacenamiento externo | No configurados. | Sin integración ni señales reales de proveedor; QA-26 bloqueado. | `BLOCKED` |

## Decisión de salida

La suite final reportada (32/32), el build final y la comprobación HTTP del preview pasaron para los asserts y endpoints indicados. No se declara `DONE` global, `DONE_INTEGRACIÓN` ni `APTO_PARA_OPERACIÓN`: siguen pendientes el seguimiento GPS real y otras dependencias del alcance original. El próximo resultado que cierre tracking debe incluir integración aprobada y prueba física, no solo API simulada, mocks, mapa o esta suite.

## Evidencia de archivos

- Casos y estados: [CASOS_ACEPTACION.md](CASOS_ACEPTACION.md).
- Tests: [flow.test.ts](../tests/flow.test.ts), [guards.test.ts](../tests/guards.test.ts), [acceptance-v2.test.ts](../tests/acceptance-v2.test.ts), [controls-v2.test.ts](../tests/controls-v2.test.ts), [controls-http.test.ts](../tests/controls-http.test.ts) y [driver-documents.test.ts](../tests/driver-documents.test.ts).
- Implementación consultada para delimitar los asserts: [app.ts](../server/app.ts), [domain.ts](../server/domain.ts), [db.ts](../server/db.ts) y `server/schema.sql`.
- Salida de build: `dist/index.html` y `dist/assets/`. La salida de consola de `npm test`/`npm run build` se comunicó en la corrida local; este workspace no guarda un log de terminal independiente.
- Contexto/documentación relacionada: [CONTEXTO_Y_DECISIONES.md](CONTEXTO_Y_DECISIONES.md), [CONTRATOS_API.md](CONTRATOS_API.md) y el borrador de entrada `PROMPT_OS_LOGISTICA_V0_1.md`.

No se ha creado ni modificado un masterblueprint o roadmap en esta corrida.




## Cierre de verificación del agente principal

La suite final reportada terminó con 32/32 tests aprobados, en los seis archivos enumerados arriba. El build final pasó con 32 módulos; el preview HTTP también respondió como se describe arriba. El navegador no se pudo iniciar en la corrida actual (IAB no disponible; Chrome no cargó la política de encabezados tras reintentar). Las capturas de inicio de demo y chofer móvil se conservan como evidencia histórica anterior y no son screenshots nuevos ni validación visual del árbol actual.

Los casos marcados `NOT_RUN (cobertura parcial)` tienen subpruebas ejecutadas y aprobadas, pero aún no cumplen todo el criterio original. La suite de 32 tests tampoco equivale a 26 casos de aceptación completos ni a `DONE` global.
