# Casos de aceptación

**Fuente funcional:** `PROMPT_OS_LOGISTICA_V0_1.md`, borrador fechado el 15-10-2026, secciones 16–17 y fixture E2E.  
**Estado vigente al 15-10-2026:** TypeScript/Node.js, React/Vite, Supabase PostgreSQL; SQLite para DEMO y pruebas. Inventario y portal privado implementados; QuadMinds preparado y pendiente de activación real. Suite vigente: 66 pruebas locales y 4 casos PostgreSQL aprobados entre dos corridas; ver [INFORME_QA.md](INFORME_QA.md). La verificación de navegador cubre recepción, importación, edición y reserva en DEMO.  
**Registro histórico del núcleo anterior:** el párrafo siguiente conserva la corrida previa de 32 pruebas y no describe la ampliación posterior.  
**Estado de ejecución al 15-10-2026:** la última suite reportada terminó con **32/32 tests aprobados, 0 fallidos** en 6495.8094 ms, distribuidos en `flow`, `guards`, `acceptance-v2`, `controls-v2`, `controls-http` y `driver-documents`. El build final pasó con 32 módulos (CSS 20.23 kB, JS 306.12 kB; Vite 2.48 s). El preview HTTP en `127.0.0.1:5173` respondió 200 en health, índice y asset; el login DEMO respondió 200 y el bootstrap devolvió las colecciones nuevas. SQLite conserva las migraciones 1 y 2 y los datos DEMO verificados (cuatro `IN_TRANSIT`, uno `EXPECTED`, ruta `IN_PROGRESS` v8). La inspección visual nueva quedó bloqueada: IAB no estaba disponible y Chrome no pudo cargar la política de encabezados tras reintentar. Las capturas existentes son evidencia histórica, no validación visual de esta corrida. Cada estado se limita a lo que verifican esos asserts; no se infiere operación real.

Este documento conserva los criterios del borrador y registra la cobertura observada en la implementación local. Los criterios siguen siendo la meta completa; una cobertura parcial no pasa el caso entero. Las pruebas usan fixtures aislados y no prueban despliegue ni operación real.

## Estados y registro de ejecución

- `NOT_RUN`: no se ejecutó el alcance descrito para la fila.
- `BLOCKED`: no se puede evaluar hasta aprobar y habilitar la dependencia indicada. No equivale a aprobado ni a fallido.
- `NOT_RUN (cobertura parcial)`: hay aserciones ejecutadas con éxito, pero no se cubrió todo el criterio de aceptación de esa fila; no equivale a `PASS`.
- `PASS` / `FAIL`: se asignan solo cuando se ejecutó el caso completo dentro del alcance descrito y se guardó evidencia.

Al ejecutar un caso, registrar: fecha y hora con zona; versión o SHA bajo prueba, si existe; ambiente aislado; datos de fixture; pasos/comando o recorrido reproducible; resultado observado; estado persistido antes y después; evidencia (salida, consulta, captura o identificador de auditoría); y responsable de la ejecución. Si una dependencia sigue pendiente, mantener `BLOCKED`; no reemplazarlo por `PASS` por falta de credenciales, dispositivo o proveedor.

## Fixture integrado P1–P5

Los identificadores siguientes son datos ficticios de QA, no nombres, clientes, territorios ni reglas comerciales. Sembrar cada ejecución de forma aislada y conservar el mismo vínculo de organización y cliente a lo largo del flujo.

| Identificador | Dato inicial | Resultado esperado en el flujo integrado |
|---|---|---|
| O-QA | Organización ficticia del tenant de prueba | Todo recurso del flujo pertenece a esta organización. |
| C-QA | Cliente ficticio perteneciente a O-QA | El envío y sus bultos pertenecen a este cliente. |
| S-QA | Envío ficticio de C-QA | Conteo declarado inicial: cinco bultos; referencias únicas P1–P5. |
| P1, P2, P3, P4, P5 | Bultos declarados de S-QA | P1–P4 se reciben; P5 queda sin recibir. P1–P4 se cargan. Se entregan P1–P3; el intento de P4 falla, luego P4 regresa al depósito y después al remitente, en dos pasos con evidencias distintas. P5 conserva la diferencia hasta una resolución explícita y autorizada. |
| R-QA | Ruta ficticia asignada a P1–P4 | Tiene chofer y vehículo de prueba asignados mediante una configuración de QA explícita. No representa una asignación comercial real. |

No asignar peso, volumen, dirección, tarifa, moneda, motivo comercial o requisito documental a P1–P5 por defecto. Los escenarios que necesiten esos datos deben sembrarlos explícitamente como parámetros ficticios propios de QA. `NULL` significa desconocido y no equivale a cero. Las evidencias de recepción, entrega y cada etapa de devolución deben tener identificadores distintos y registrar actor y hora.

En `tests/flow.test.ts`, P1–P5 son alias del fixture de prueba para cinco códigos generados por el sistema. Ese fixture asigna 1.000 g y 1.000 cm³ por bulto, política `RECEIVER_PHOTO`, capacidad de vehículo de 100.000 g/100.000 cm³ y zona `UTC`; son datos de QA, no valores de negocio. Recibe P1–P4 y deja P5 en `EXPECTED`. El flujo prueba que recibir P4 en depósito requiere evidencia asociada a ese bulto, que falta de foto o foto de otro bulto no produce efectos y que repetir con el mismo comando no agrega custodia. La etapa de entrega al remitente exige una foto con SHA distinto. `controls-v2.test.ts` cubre un retorno legacy ya recibido, con subsanación solo por OPS que agrega evidencia, nota, actor y hora actual sin reescribir custodia ni atribuir una fecha original.

Secuencia y aserciones del fixture integrado:

1. **Declaración:** S-QA tiene exactamente cinco referencias únicas, `{P1, P2, P3, P4, P5}`; las cinco están pendientes de recepción.
2. **Recepción parcial:** registrar P1–P4 en una recepción. El resultado muestra cinco esperados, cuatro recibidos y una diferencia identificada como P5. No crea recepción ni custodia para P5.
3. **Plan y carga:** el manifiesto de R-QA contiene P1–P4. Tras escanearlos, cada uno tiene una sola carga activa en R-QA. P5 no aparece como cargado. La ruta no pasa a `IN_PROGRESS` solo por registrar los escaneos.
4. **Entrega e incidencia:** registrar resultado entregado para P1, P2 y P3; crear un intento fallido para P4 con motivo, responsable y próxima acción. Los resultados de P1–P3 no cambian la custodia ni el resultado de P4. S-QA no aparece como totalmente entregado.
5. **Devolución:** registrar para P4 el retorno y recepción en depósito; después registrar por separado la devolución al remitente. Cada transición exige su propia evidencia y actor. El primer paso no marca por sí solo el segundo como completo.
6. **Diferencia pendiente:** P5 sigue sin recepción y con su diferencia visible. Solo una resolución autorizada y auditable puede cambiar esa condición; no se permite cerrar la brecha alterando el conteo agregado.
7. **Conciliación/cierre:** cada bulto conserva su resultado y cronología. Una ruta no puede cerrarse mientras existan paradas u obligaciones sin reconciliar y responsable asignado.

## Casos QA

La columna de estado contiene el resultado registrado al 15-10-2026. `NOT_RUN (cobertura parcial)` señala cobertura ejecutada, pero menor al caso completo; el informe vinculado detalla los asserts y las brechas.

| ID | Estado al 15-10-2026 | Preparación y ejecución | Criterio verificable |
|---|---|---|---|
| QA-01 | `PASS` | Usar S-QA con P1–P5 declarados; recibir P1–P4. Consultar recepción, estados y conteos del envío. | Persisten cinco esperados, cuatro recibidos y P5 como diferencia pendiente. P5 no tiene evento de recepción ni custodia recibida. |
| QA-02 | `PASS` | Repetir el mismo escaneo/comando de recepción de un bulto ya recibido, con la misma clave de idempotencia y cuerpo. | Hay un solo efecto de recepción y un solo cambio de custodia para ese comando; el conteo no aumenta. La respuesta al reintento identifica el resultado previo o equivalente. |
| QA-03 | `PASS` | `acceptance-v2.test.ts` intenta recibir un código inexistente y uno perteneciente a otro cliente. `guards.test.ts` intenta cargar un bulto de otro envío. | Las operaciones se rechazan; no se crean recibo, ítems, evento de custodia, auditoría o idempotencia, y el bulto rechazado no cambia de estado. |
| QA-04 | `PASS` | Desde dos sesiones de operaciones, enviar en paralelo asignaciones incompatibles del mismo bulto a dos rutas. | A lo sumo una asignación activa queda persistida. La otra operación recibe conflicto explícito; no hay dos transportes activos para el mismo bulto. |
| QA-05 | `PASS` | `acceptance-v2.test.ts` confirma concurrentemente dos rutas que comparten chofer y vehículo desde dos sesiones de operaciones. `guards.test.ts` también prueba rechazo de la ruta incompatible en dominio y base de datos. | Una ruta queda `READY`, la otra sigue `DRAFT` y recibe 409; la base rechaza el conflicto. El resultado no deja una segunda ruta confirmada. La incompatibilidad es explícita en el fixture de QA. |
| QA-06 | `PASS` | Fixture ejecutado: capacidad ficticia de 10 kg, carga inicial de 4 kg y un retiro intermedio de 7 kg antes de descargar. Validar la factibilidad de la secuencia. Estos números son solo datos de QA. | La carga del tramo que sigue al retiro se calcula como 11 kg y se marca excedida frente a 10 kg. El plan/despacho no se aprueba por el hecho de que la carga inicial era válida. |
| QA-07 | `PASS` | Crear fixtures con peso `NULL` y volumen `NULL`; evaluar confirmación de ruta. | Cada dimensión desconocida conserva `NULL` y bloquea la confirmación; no se suma como cero ni hay transición de estado, versión o idempotencia. |
| QA-08 | `PASS` | Configurar en el fixture un documento como impeditivo y vencido al momento de despacho, o un defecto de vehículo marcado crítico y abierto. Intentar despachar. | El servidor rechaza el despacho; la ruta no inicia y el vehículo/chofer no queda liberado para aparentar salida válida. La respuesta identifica el control impeditivo. |
| QA-09 | `PASS` | Con P1–P4 en una ruta válida, confirmar entrega solo para P1–P3 y consultar estados, custodia, eventos y conteos. | Solo P1–P3 cambian a entregados y tienen su evidencia. P4 conserva resultado/custodia pendiente de resolución; el envío muestra entrega parcial y no entrega total. |
| QA-10 | `NOT_RUN (cobertura parcial)` | Para P4, registrar un intento fallido con motivo; después registrar un nuevo intento exitoso con la evidencia configurada. | Persisten dos intentos distintos, ordenados y con sus respectivos resultados. El reintento no sobrescribe el fallo, su motivo, actor, hora ni evidencia. |
| QA-11 | `NOT_RUN (cobertura parcial)` | Configurar una política de QA que exige evidencia de entrega. Enviar una entrega sin evidencia y otra cuya evidencia sigue sin sincronizarse/almacenarse. | Ninguna operación se presenta como entrega finalizada en servidor. La respuesta marca evidencia requerida o pendiente y conserva el bulto sin transición final. |
| QA-12 | `NOT_RUN (cobertura parcial)` | Reenviar el mismo comando de entrega o cobro tras simular corte de red, usando la misma clave y cuerpo; repetir también en paralelo. | Solo existe una transición/movimiento y una única repercusión en conteos o saldo. La misma clave con cuerpo diferente produce conflicto explícito y cero segundo efecto. |
| QA-13 | `BLOCKED` | Requiere aprobación de modo offline y contrato de cola durable. Cuando se apruebe: encolar una acción contra una versión/asignación; cambiar la asignación en servidor; reconectar y sincronizar. | **Al desbloquear:** la acción queda `CONFLICT` visible; no pisa el estado posterior ni se confirma en servidor. No se puede ejecutar hasta que el modo offline y sus reglas de resolución estén aprobados. |
| QA-14 | `PASS` | Para P4, intentar recepción de depósito sin foto y con una foto de otro bulto; guardar foto propia y repetir la recepción con el mismo comando. Luego intentar entrega al remitente con el mismo SHA y con uno distinto. | Falta de foto o foto incorrecta no cambia el retorno; una recepción idempotente deja un evento de custodia. El retorno queda `AT_DEPOT` hasta una segunda transición con evidencia SHA-distinta y luego pasa a `SENT_TO_SENDER`. Una corrección legacy de evidencia por OPS registra la subsanación actual y conserva custodia. |
| QA-15 | `NOT_RUN (cobertura parcial)` | Portal autenticado implementado. Pruebas HTTP de cliente/auditoría cubren inventario, pedidos, ubicaciones y comprobantes ajenos, bloqueo de APIs internas y revocación inmediata. Falta recorrido visual adversarial completo del cliente. | Servidor y almacenamiento rechazan acceso directo por ID ajeno y no filtran metadatos ni contenido de C-B; ocultar enlaces no cuenta como control. Cobertura automatizada aprobada, aceptación visual pendiente. |
| QA-16 | `PASS` | `acceptance-v2.test.ts` autentica dos choferes y consulta tracking por ID y cierre por ID; `guards.test.ts` verifica lectura/cierre de dominio y bootstrap del chofer ajeno. | El chofer ajeno recibe 403 por HTTP y por dominio; su bootstrap no incluye rutas, bultos ni clientes. El chofer asignado alcanza las respuestas propias de cada endpoint. |
| QA-17 | `BLOCKED` | Requiere aprobar el enlace público restringido y su política. Probar un token expirado, revocado, malformado y una secuencia de consultas abusivas; usar un envío con datos internos sembrados. | **Al desbloquear:** no se entrega contenido del envío; se aplican límites de abuso configurados; cualquier respuesta pública válida expone solo la proyección permitida de un envío, sin PII innecesaria ni datos internos. |
| QA-18 | `BLOCKED` | Con un arnés de prueba identificado (no presentado como GPS operativo), registrar un punto válido; reenviar el mismo `event_id`; enviar uno con latitud fuera de [-90, 90]; luego enviar un punto válido tardío cuyo `recorded_at` antecede a la posición válida más reciente. | El duplicado no crea otra muestra; el punto fuera de rango es rechazado/marcado inválido; el punto tardío no reemplaza la última posición válida. La muestra conserva tiempos de medición/recepción y su calidad/origen. Esto no satisface QA-20. |
| QA-19 | `BLOCKED` | Requiere fuente real de tracking aprobada y sesión/dispositivo disponibles. Probar pérdida y recuperación de señal y fin de la sesión de ruta. | **Al desbloquear:** se muestra última actualización y pérdida de señal según la configuración aprobada; no se inventa posición/recorrido vivo; al finalizar la sesión no se capturan puntos fuera del período autorizado. |
| QA-20 | `BLOCKED` | Requiere elegir e integrar fuente GPS real y disponer de dispositivo/vehículo de ensayo. Ejecutar prueba física con pantalla bloqueada, otra app en primer plano, corte/recuperación de red, permiso revocado y fin de ruta; correlacionar hora de medición con recepción del servidor. | **Al desbloquear:** existe evidencia del dispositivo y de recepción de puntos por servidor durante el bloqueo y los demás escenarios; se identifica fuente, precisión y frescura. Mocks, mapa con marcadores, navegación externa o envío solo al desbloquear no satisfacen el caso. |
| QA-21 | `BLOCKED` | Requiere aprobar alcance financiero, monedas, roles y reglas de rendición. Fixture exclusivamente ficticio: 50 unidades de anticipo en efectivo + 100 unidades cobradas en efectivo − 20 unidades de gastos en efectivo aprobados. Registrar aparte una transferencia verificada de 200 unidades. | **Al desbloquear:** efectivo a rendir = 130 unidades; transferencia de 200 permanece separada y no altera efectivo a rendir. No se etiqueta ninguna unidad con moneda comercial asumida. |
| QA-22 | `BLOCKED` | Requiere aprobar el módulo financiero y sus roles. Sobre el fixture QA-21, declarar entrega de 120 unidades en efectivo y pedir al chofer que cierre/apruebe su propia diferencia. | **Al desbloquear:** diferencia = −10 unidades frente a 130; permanece abierta para investigación/ajuste autorizado. El chofer no puede aprobarla ni el sistema autocerrarla; queda auditoría del intento. |
| QA-23 | `PASS automatizado (SQLite y PostgreSQL)` | `tests/inventory.test.ts`, `tests/audit-import.test.ts`, `tests/warehouse-story.ts` y caso PostgreSQL de CSV rechazado prueban importación, retry del mismo commit, referencias duplicadas, atomicidad, errores por fila persistidos y permisos append-only. | Un solo pedido/envío por referencia; retry no duplica. Los errores guardados sobreviven al reintento. Los fixtures PostgreSQL terminan en rollback; falta aceptar el formato y un archivo real del cliente en el piloto. |
| QA-24 | `NOT_RUN (cobertura parcial)` | Intentar cerrar R-QA mientras exista una parada/bulto sin resultado final o una incidencia sin responsable/próxima acción. | El cierre se rechaza con los pendientes identificados. No se borran paradas, obligaciones, diferencias o evidencias para permitirlo. Tras conciliarlos con un resultado válido, el cierre refleja cada bulto. |
| QA-25 | `NOT_RUN (cobertura parcial)` | Requiere aprobar el comportamiento offline y definir almacenamiento/seguridad de pendientes. Una vez aprobado: guardar un comando pendiente, cerrar/reiniciar la app, reiniciar API, expirar sesión e iniciar sesión nuevamente. | **Al desbloquear:** datos confirmados sobreviven al reinicio de API; el pendiente durable sobrevive al cierre/reinicio y conserva identidad, UUID, dependencias y estado; no se presenta como sincronizado antes de confirmación del servidor y se revalidan permisos al sincronizar. La parte offline no se aprueba por probar solo persistencia central. |
| QA-26 | `BLOCKED` | Requiere identificar y aprobar el proveedor externo y sus señales (por ejemplo, almacenamiento o mensajería). Inducir fallo, reintentar y recuperar; consultar estado del proveedor y las operaciones de negocio relacionadas. | **Al desbloquear:** el estado comunicado refleja la señal real disponible (`NO_CONFIGURADO`, pendiente/aceptado/entregado/fallido según corresponda); fallo y reintento no corrompen una operación confirmada ni duplican cobros, notificaciones u otros efectos. Sin proveedor aprobado, no se simula éxito. |

## Resultados de verificación registrados

El registro actualizado deja **11 casos `PASS`, 1 `PASS automatizado (SQLite y PostgreSQL)`, 6 `NOT_RUN (cobertura parcial)` y 8 `BLOCKED`**. Son estados de criterios, no cantidad de tests: la suite local vigente tiene 66 pruebas aprobadas y hubo 4 casos PostgreSQL aprobados entre dos corridas. QA-23 se limita al formato fixture; falta aceptar un archivo real del cliente. QA-15 tiene controles automatizados aprobados y portal implementado, con recorrido visual adversarial pendiente. QA-25 conserva la brecha de cola offline. La integración real y el piloto de campo siguen pendientes.

| Estado | Casos |
|---|---|
| `PASS` | QA-01, QA-02, QA-03, QA-04, QA-05, QA-06, QA-07, QA-08, QA-09, QA-14, QA-16 |
| `PASS automatizado (SQLite y PostgreSQL)` | QA-23 |
| `NOT_RUN (cobertura parcial)` | QA-10, QA-11, QA-12, QA-15, QA-24, QA-25 |
| `BLOCKED` | QA-13, QA-17, QA-18, QA-19, QA-20, QA-21, QA-22, QA-26 |

El detalle de qué asserts pasaron y qué alcance sigue pendiente está en [INFORME_QA.md](INFORME_QA.md). La suite y el build verdes no certifican GPS real, operación de campo, uso móvil ni integraciones no configuradas.

## Condiciones para declarar aceptación

- Ejecutar con base y servicios de prueba aislados; comprobar los registros persistidos, eventos de custodia, auditoría, permisos y duplicados, no solo códigos HTTP o carga de pantalla.
- Para concurrencia, ejecutar solicitudes solapadas contra la misma persistencia y comprobar el resultado final desde una sesión independiente.
- Para evidencia, guardar identificadores y metadatos de objetos de QA en almacenamiento privado de prueba; no adjuntar datos personales reales.
- Un caso solo pasa si se cumplen todos sus criterios y se guarda la evidencia de ejecución. La falta de una dependencia mantiene `BLOCKED`; la falta de ejecución mantiene `NOT_RUN`.
- El conjunto no acredita `DONE_DESARROLLO`, `DONE_INTEGRACIÓN` ni `APTO_PARA_OPERACIÓN` por sí solo. La integración GPS física continúa bloqueada hasta completar QA-20; no se declara tracking operativo mediante mocks.






