# Auditoría de código y plan de estabilización — NEXORA

Fecha local: 31/10/2026, America/Asuncion. La consulta remota del CI y de producción se realizó ya el 01/11/2026 UTC.

Código auditado: `3e879dd905beb9a3bfa33bdd6d70a28f7a1b18ad`.

## Resultado ejecutivo

Hay cuatro hallazgos materiales confirmados: tres de gravedad alta y uno de gravedad media. Los dos defectos de negocio se reprodujeron localmente con operaciones normales del dominio; también se reprodujo por HTTP el defecto de creación de acceso. La configuración de publicación y el CI fallido se verificaron en los servicios reales.

No se modificaron código de negocio, infraestructura ni datos de producción. Las escrituras de prueba se hicieron en SQLite en memoria y PostgreSQL local aislado. Este informe no certifica ausencia de bugs: establece qué se comprobó, qué falla y qué falta validar.

## Alcance y método

Se siguieron los contratos desde formularios y API hasta autorización, comandos, transacciones, persistencia, lectura posterior y despliegue. La revisión cubrió los flujos críticos y sus alternativas, además de las pruebas disponibles; no constituye una demostración formal de cada estado posible de cada archivo.

| Área | Código y comprobaciones principales | Resultado del alcance revisado |
|---|---|---|
| Sesiones, permisos y cuentas | `auth.ts`, `app.ts`, `company.ts`, `customer-access.ts`, recuperación de acceso, matriz de permisos | Revocación y aislamiento cubiertos por pruebas; discrepancia de credenciales en F4 |
| Empresa, clientes y portal | Fichas, permisos de cuentas cliente, políticas RLS reales, membresías y solicitudes | Pruebas de aislamiento y actualización parcial pasan; no se detectó exposición entre clientes en los casos ejecutados |
| Catálogo, Excel/CSV y recepción | `catalog-import.ts`, `order-xlsx.ts`, `stock-receipts.ts`, límites, validación, referencias e idempotencia | Pruebas de importación y de completar cantidades pasan |
| Stock y reservas | `inventory.ts`, movimientos, cantidades/series, concurrencia, desreserva | Reserva completa y saldos protegidos en los casos ejecutados; devolución y liberación inconsistentes en F1 |
| Organización y recursos | `reserved-dispatch.ts`, `routing.ts`, lotes, disponibilidad compartida, aprobación humana | Pruebas con dos tripulaciones y tres E2E de organización pasan; esos E2E no se ejecutan en el CI general |
| Carga, confirmación y despacho | `domain.ts`, `route-coordination.ts`, `vehicle-capacity.ts`, inspecciones/documentos | Guards de servidor y pruebas PostgreSQL pasan; detalle de ruta incompleto al crecer los datos en F2 |
| Entrega, fallido y devolución | Transiciones de bulto, evidencia, intentos, retorno y sincronización de inventario | Recorrido habitual cubierto; alternativa liberar → devolver al remitente reproduce F1 |
| Facturación | Permisos, vínculos únicos, importes enteros, estados y barrera fiscal | Pruebas pasan; no se certifica emisión fiscal externa |
| GPS y proveedores | Traccar, pasarela, posiciones, QuadMinds, descarga de evidencia, mapas y solver | Pruebas locales y fixtures; salud de producción accesible. Sin nueva validación física o de proveedores externos completos |
| PostgreSQL/Supabase | Migraciones, grants, roles, políticas RLS y consultas agregadas de anomalías | 21 pruebas locales pasan; aplicación privada sin SELECT para anon/authenticated en las tablas revisadas |
| Publicación y operación | CI real, Dockerfile, Railway, release frontend/backend, backup y monitor | Publicación permite CI fallido en F3; recuperación autónoma del OS pendiente de acreditar |

## F1 — Stock disponible después de devolver físicamente al remitente

**Gravedad: ALTA. Hecho reproducido. Bloquea la aceptación del circuito de devoluciones.**

**Evidencia de código:**

- `server/inventory.ts:873`, `Inventory.release`: mueve cuarentena a disponible y marca `inventory_order_parcels.state = RELEASED`. No resuelve la obligación de devolución ni invalida la entrega al remitente.
- `server/domain.ts:522`, `Logistics.sendReturn`: comprueba `returns.AT_DEPOT`, bulto `RETURNED_TO_DEPOT` y custodia `DEPOT`. Esos estados siguen siendo válidos después de liberar stock.
- `server/inventory.ts:803`, `syncParcelTransition`: no contempla `RETURNED_TO_SENDER`.
- `server/reconciliation.ts:5`: compara saldos con movimientos y series; no contrasta esas proyecciones con la custodia física y las obligaciones de devolución.

**Secuencia reproducida:** recepción → reserva → carga → despacho → entrega fallida → retorno autorizado → recepción en cuarentena → liberar dos unidades a stock → entregar una de ellas al remitente.

**Resultado observado:** la entrega al remitente termina en `SENT_TO_SENDER`, el bulto queda en custodia `SENDER`, pero el stock disponible sigue en **2 unidades**, y su vínculo de inventario sigue `RELEASED`. La conciliación devuelve `ok: true`.

**Impacto:** el OS puede ofrecer mercadería que ya abandonó el depósito. La conciliación actual no detecta ese desacuerdo.

**Por qué pasa las protecciones:** cada comando valida un conjunto distinto de estados. Ambos son transaccionales por separado, pero falta una regla compartida que haga excluyentes los destinos del retorno. El test `tests/warehouse-story.ts:84` termina después de liberar y no intenta la entrega posterior al remitente.

**Producción, consulta de solo lectura:** no se encontraron filas en los dos patrones consultados: retorno `AT_DEPOT` con inventario `RELEASED`, ni bulto `RETURNED_TO_SENDER` con inventario `QUARANTINE/RELEASED`. Esto no invalida la reproducción ni certifica todas las variantes históricas.

**Corrección mínima robusta:** decidir explícitamente entre reintegrar a stock y devolver al remitente; validar esa disposición en ambos comandos y en la sincronización. Actualizar retorno, custodia, vínculo de inventario y movimiento contable en una sola transacción. Agregar conciliación de custodia y disposición. Inspeccionar registros existentes antes de cualquier reparación.

**Prueba de cierre:** liberar y luego enviar debe rechazarse sin movimientos; enviar y luego liberar también. Una devolución al remitente desde cuarentena debe descontar el stock correspondiente. Cubrir cantidades, series, dos comandos concurrentes, reintentos y rollback en PostgreSQL. Conciliación debe detectar un desacuerdo de custodia introducido deliberadamente en un fixture.

## F2 — El detalle operativo de una ruta depende de listas recortadas

**Gravedad: ALTA. Hecho reproducido. Defecto latente con crecimiento normal de datos.**

**Evidencia de código:**

- `server/domain.ts:612`, `bootstrap`: aplica un límite independiente de **500 registros por colección**. Prioriza rutas activas, pero bultos, paradas y asignaciones se recortan por separado.
- `frontend/App.tsx:888`: obtiene paradas, asignaciones y bultos de la ruta filtrando esas colecciones ya recortadas.
- `frontend/App.tsx:1007`: si faltan los bultos en la colección cargada, informa que hay que agregar artículos. Confirmar/despachar se deshabilita con `!routeParcels.length`.

**Secuencia reproducida:** crear una ruta con tres bultos recibidos y asignados; después crear 501 bultos nuevos en otros envíos; volver a obtener bootstrap.

**Resultado observado:** la ruta y sus tres asignaciones siguen presentes, pero **ninguno de sus tres bultos** está en la respuesta. Se devuelven 500 bultos más recientes. El detalle de la ruta queda sin sus controles correctos aunque los datos sigan en la base.

**Impacto:** una ruta operativa puede parecer vacía o incompleta y bloquear la carga, confirmación o despacho desde la interfaz. No se demostró pérdida de datos ni que el servidor permita despachar incorrectamente: el fallo está en la integridad de la lectura operativa y sus controles.

**Por qué pasa las protecciones:** limitar bootstrap evita cargas ilimitadas, pero no garantiza que sus relaciones estén completas. El aviso genérico de paginar envíos no resuelve el detalle de una ruta. Las pruebas existentes de paginación cubren catálogo/listados, no este caso relacional.

**Producción, consulta de solo lectura:** había 39 bultos en la base al verificar. No se afirma que el umbral esté causando un bloqueo actual.

**Corrección mínima robusta:** crear o completar una consulta de detalle de ruta autorizada y acotada por ruta que incluya sus bultos, paradas, asignaciones y datos relacionados. Consumirla en la operación; usar bootstrap para resumen/listados. Los contadores y decisiones operativas deben provenir de datos completos del ámbito consultado. No resolver retirando indiscriminadamente los límites.

**Prueba de cierre:** una ruta antigua debe mantener detalle, contadores y acciones con más de 500 bultos, paradas, asignaciones y clientes posteriores. Probar ADMIN/DEPOT/DRIVER, aislamiento de empresa, paginación, recarga y cambios de versión.

## F3 — Producción se publica aunque el CI completo falle

**Gravedad: ALTA. Hecho verificado en la configuración y en el despliegue real.**

**Evidencia remota:**

- El commit auditado se sirve tanto en frontend como en backend; readiness responde correctamente.
- El workflow [OS validation, ejecución 41256074600](https://github.com/bjjrage/nexora-logistic-os/actions/runs/41256074600) para el mismo commit terminó en `failure`.
- Resultado del navegador en ese CI: **12 aprobadas, 7 fallidas, 3 omitidas y 6 que no llegaron a ejecutarse**. Los pasos posteriores de Docker quedaron omitidos.
- La API de GitHub informa `Branch not protected` para `main`; la consulta adicional de reglas aplicables a esa rama devuelve `[]`.
- Railway, servicio `nexora-logistic`, producción: `source.branch = main`, **`source.checkSuites = false`**. Despliegue `767aa35f-906c-4ca0-859d-76740a692608` en `SUCCESS`.
- `.github/workflows/ci.yml:36` ejecuta el navegador, pero la publicación automática no espera su éxito.

**Impacto:** las comprobaciones completas no son una barrera de publicación. Una versión puede estar online con regresiones o con una validación que ya dejó de comprobar el flujo vigente.

**Matiz:** el Dockerfile sí ejecuta pruebas generales y build durante su construcción. Eso aporta protección, pero no sustituye la suite PostgreSQL, el navegador completo ni una publicación coordinada de frontend y backend.

**Causas de los fallos de navegador identificadas:**

- Pruebas que buscan el selector de ruta en la reserva, aunque el flujo vigente reserva sin elegir ruta: `tests/e2e/multiple-orders-route.spec.ts` y `order-to-delivery.spec.ts`.
- Selectores de diálogo antiguos (`Reserva y ruta`) y búsqueda de rutas dentro de un historial ahora contraído.
- `tests/e2e/operation.spec.ts:8` exige una instalación vacía, pero `scripts/e2e-server.ts` mantiene una única base en memoria para todos los archivos y otros tests ya hicieron setup. La falla inicial deja seis pruebas seriales sin ejecutar.
- `tests/e2e/routing.spec.ts:8` se omite sin `ROUTING_E2E`. El CI solo ejecuta la configuración general; no ejecuta `playwright.routing.config.ts`.

Los fallos de selector o de aislamiento **no equivalen automáticamente a siete bugs del producto**. Sí demuestran que hoy la suite general no puede certificar el flujo actual. Se repitió localmente el mismo resultado.

**Corrección mínima robusta:** aislar fixtures por archivo/historia; actualizar las pruebas al flujo aprobado sin eliminar los controles de negocio; ejecutar también la suite dedicada de ruteo con OR-Tools. Exigir los checks de CI y hacer que los despliegues de producción esperen su éxito. Verificar que frontend y backend publican el mismo SHA. No limitarse a quitar tests fallidos ni a marcar excepciones como éxito.

**Prueba de cierre:** en una rama de ensayo, una falla intencional del test debe impedir publicación. Una ejecución limpia debe correr todas las historias críticas, construir la imagen final, publicar el SHA aprobado y pasar smoke tests. El rollback debe ser compatible con el esquema.

## F4 — Crear acceso de chofer acepta credenciales que el login rechaza

**Gravedad: MEDIA. Hecho reproducido por HTTP y patrón presente en producción.**

**Evidencia de código:**

- `server/company.ts:25`: `createDriverAccess` acepta usuario hasta 100 caracteres, sin restricción de caracteres, y contraseña hasta 200.
- `server/validation.ts:8`: creación normal/login admiten usuario hasta 80 con expresión `[a-zA-Z0-9_.@-]+`; el login admite contraseña hasta 128.
- `frontend/App.tsx:1290`: el formulario de crear acceso refleja los límites más permisivos.

**Secuencia reproducida:** crear chofer → eliminar su cuenta conservando el chofer → crearle acceso con usuario `Driver With Spaces` → intentar iniciar sesión con esas mismas credenciales.

**Resultado observado:** la cuenta se crea; `/api/login` devuelve **400 `VALIDATION_ERROR`** antes de verificar su contraseña.

**Impacto:** Administración confirma un alta de acceso que el chofer no puede usar. No requiere un atacante.

**Producción, consulta de solo lectura:** **una cuenta activa** tiene un nombre que incumple el contrato actual del login. No se expone su identidad ni se modificó su acceso. La consulta no permite deducir cómo fue creada esa cuenta ni el largo de su contraseña original.

**Por qué pasa las protecciones:** hay esquemas duplicados para la misma identidad. La prueba de crear acceso usa un usuario válido y no compara los límites con el login.

**Corrección mínima robusta:** compartir el contrato de credenciales entre creación, recuperación y login; reflejarlo en la UI. Revisar de forma privada la cuenta afectada y preparar una regularización que conserve su chofer, rutas e historial.

**Prueba de cierre:** toda credencial aceptada al crear acceso debe poder llegar a autenticación. Cubrir espacios, acentos, longitudes 80/81/100 y contraseñas 128/129/200; comprobar rechazo temprano y mensajes claros, además de no duplicar choferes.

## Riesgos que requieren verificación adicional

Estos puntos no se presentan como nuevos bugs confirmados:

1. **Recuperación del OS:** `scripts/install-local-maintenance.ps1` programa backup/monitor con `LogonType Interactive`; `docs/OS_EN_INTERNET_Y_SINCRONIZACION.md:39` reconoce que dependen de la PC/sesión. El servicio Railway de backup es de Traccar y no acredita una copia del PostgreSQL del OS. No se comprobó en esta auditoría una política autónoma de backups de Supabase ni una restauración reciente completa del OS y sus dependencias de plataforma. Verificar cobertura, retención, copia externa y restauración antes de certificar recuperación.
2. **Carga y tiempos de respuesta:** en una muestra limitada de 51 logs de Railway hubo 49 respuestas 200 y dos 409; una carga seleccionada duró 7.136 ms. Los 409 pueden ser guardas correctas. La muestra no permite atribuir una causa ni calcular un SLA. Falta medir concurrencia de carga, despacho, importación y GPS, incluida espera por locks.
3. **Servicios externos y dispositivo físico:** los E2E de ruteo usan mapas simulados y OR-Tools real; QuadMinds usa fixtures en los flujos ejecutados. No se certificaron aquí direcciones reales, precisión del trayecto, tráfico, entrega externa completa ni iPhone bloqueado durante un recorrido.
4. **Aviso de Supabase Auth:** el asesor reporta protección contra contraseñas filtradas desactivada. El acceso interno del OS usa autenticación propia; por tanto, no se lo presenta como una explicación de F4 ni como una protección automática para esas cuentas. Revisar por separado dónde se usa Supabase Auth.
5. **Dependencias fuera de npm:** cero avisos de `npm audit` no certifica Python, OR-Tools, imágenes de contenedor, SO, OSRM/Nominatim ni vulnerabilidades sin aviso publicado.

## Verificaciones ejecutadas

| Verificación | Resultado observado |
|---|---|
| Suite general `npm test`, con OR-Tools local disponible | 241 aprobadas; 0 fallidas; 0 omitidas |
| PostgreSQL 17 local aislado, 11 archivos de integración | 21 aprobadas; 0 fallidas; 0 omitidas |
| `npm run test:e2e`, servidor SQLite en memoria | 12 aprobadas; 7 fallidas; 3 omitidas; 6 sin ejecutar |
| `playwright.routing.config.ts`, OR-Tools real y mapas de prueba | 3 aprobadas |
| Reproducciones F1/F2/F4 | Las tres confirmaron el defecto esperado; no son pruebas de que el sistema sea correcto |
| `npm run build` | TypeScript/build correctos; aviso de bundle JS minificado de 571,94 kB antes de gzip (160,75 kB gzip) |
| `npm audit --json` | 0 vulnerabilidades conocidas informadas por npm |
| Comprobación de migraciones y secretos del árbol | Correctas en la línea base auditada |
| Migraciones reales de la aplicación | Versiones 1–20 presentes |
| RLS y permisos reales | RLS habilitada en tablas revisadas; sin SELECT de anon/authenticated sobre tablas privadas de nexora; runtime/worker sin superuser ni bypassrls |
| Portal público | Políticas de lectura por membresía activa; prueba PostgreSQL de aislamiento y límites SECURITY DEFINER aprobada |
| Versión publicada | Local, GitHub, backend y frontend en `3e879dd…`; `ready: true`, `synchronized: true` |

El aviso de tamaño del bundle es una observación de rendimiento, no un fallo funcional ni un bloqueante por sí mismo. El tamaño indicado es el archivo minificado antes de gzip.

Evidencias locales, sin incorporar credenciales: `.local/code-audit-2026-10-31/` contiene `unit.log`, `postgres.log`, `browser.log`, `browser-routing.log`, `build.log`, `dependencies.json`, `production-release.json`, `ci-failures.log`, `ci-jobs.json`, `repro.ts` y `reproductions.json`. Esa carpeta está ignorada por Git. El PostgreSQL iniciado para esta auditoría se detuvo al terminar sus pruebas.

## Plan de corrección, por dependencias

### 1. Restablecer una barrera de validación confiable

- Aislar las historias de navegador y actualizar sus contratos al flujo vigente: pedidos → reserva → rutas → propuesta → aprobación → carga → confirmación → control de salida → despacho → entrega/retorno.
- Agregar el job de ruteo dedicado y las regresiones de F1, F2 y F4. Ejecutar invariantes también en PostgreSQL, con el rol runtime.
- Configurar checks obligatorios y publicación posterior a CI exitoso, verificando ambos destinos y su SHA.
- Entregable: una ejecución completa reproducible y una prueba de que un check fallido bloquea publicación. Esta fase habilita validar las siguientes correcciones, no certifica por sí sola operación sin bugs.

### 2. Corregir la relación entre bulto, stock y devolución

- Definir una tabla de transiciones permitidas con precondiciones y efectos sobre pedido, bulto, custodia, retorno y movimientos.
- Hacer excluyentes reintegro a stock y entrega al remitente dentro de los comandos actuales; conservar auditoría e idempotencia.
- Ampliar conciliación más allá de saldo versus ledger; incluir custodia y disposiciones incompatibles.
- Ejecutar consultas de diagnóstico antes/después. Cualquier reparación de datos debe contar con respaldo, alcance concreto y validación de la ubicación física.
- Entregable: F1 cerrado en cantidades y series, incluso con concurrencia/reintentos, sin ajustar stock por suposición.

### 3. Separar los resúmenes de las lecturas necesarias para operar

- Dar a la ruta un detalle completo, autorizado y consultado por su ID, con paginación donde corresponda.
- Mantener listados limitados, pero no derivar de ellos si se puede cargar, confirmar, despachar o entregar.
- Revisar hermanos del mismo patrón: selectores de clientes/choferes/vehículos, documentos e inspecciones, retornos y listados con datos antiguos aún activos.
- Entregable: escenario con más de 500 registros conservando ruta, paradas, bultos y acciones correctas, incluidos permisos de chofer.

### 4. Unificar credenciales y regularizar accesos afectados

- Reusar un contrato de validación y mensajes desde todos los puntos de alta/recuperación/login.
- Revisar la cuenta activa detectada sin revelar ni inventar credenciales; mantener identidad operativa e historial.
- Entregable: F4 cerrado y prueba de creación → login → revocación → rechazo de sesión, sin chofer duplicado.

### 5. Validación operativa antes de certificar uso normal

- En un entorno aislado, ejecutar la historia completa con dos camiones y tres choferes disponibles, pedidos completos/incompletos, dos operadores simultáneos, dobles clics y recarga.
- Verificar reserva completa, asignación única, no solapamiento de recursos, carga física registrada una sola vez y confirmación previa al despacho.
- Cubrir entrega total, pendiente, fallido, reintento, retorno, liberación y devolución al remitente; comparar stock, custodia e historial al final.
- Medir latencia y locks con el volumen esperado, no solo páginas de consulta.
- Acreditar backup/restauración independiente de la PC. Validar Traccar desde un teléfono real con pantalla bloqueada y coordenadas recibidas en el OS; comprobar mapas propios con direcciones reales y aprobación de aproximaciones.
- Publicar un SHA aprobado, hacer smoke tests sin fabricar movimientos de stock reales y comprobar frontend/backend/migraciones. Registrar pendientes externos explícitamente.

## Criterios para cerrar la auditoría

No quedan F1–F4 abiertos; las regresiones fallan antes de sus correcciones y pasan después; CI general y dedicado no omiten historias críticas; un CI fallido impide publicar; stock y custodia concilian; una ruta no pierde datos operativos por paginación; las credenciales aceptadas se autentican; recuperación y validación física tienen evidencia trazable.

**Dictamen: FAIL.** Hay defectos confirmados de stock, integridad del detalle de ruta y control de publicación que hacen injustificada una nueva certificación de producción antes de corregirlos.

- **Bloqueantes para cerrar:** F1, F2 y F3. F4 debe resolverse antes de entregar el acceso afectado a su usuario.
- **Cinco riesgos prioritarios:** stock ficticiamente disponible; ruta incompleta por límite de lectura; publicación con CI fallido; acceso creado pero inutilizable; recuperación autónoma del OS sin acreditar.
- **Verificado:** código y contratos de flujos críticos, pruebas generales/PostgreSQL/navegador, reproducciones, permisos/RLS consultados, estado real del CI y sincronización de versiones.
- **Sin verificar:** todas las intercalaciones posibles, carga sostenida, recuperación completa reciente, proveedores externos completos y seguimiento físico del iPhone en esta revisión.
- **Siguiente acción recomendada:** ejecutar el plan por dependencias, empezando por la validación confiable y la corrección de stock/custodia, manteniendo cada cambio pequeño y comprobable.
