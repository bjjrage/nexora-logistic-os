# Tracking Nexora — entrega del 16/10/2026

**Interfaz simplificada:** Tracking abre **Mapa**. El alta y la conexión del teléfono están en **Mi celular → Teléfonos**; elegí **Registrar teléfono** y luego **Conectar celular** para ver los tres pasos y copiar el identificador y el servidor. **Asignar vehículo**, **Clientes** y **Rutas** son tareas separadas dentro de Mi celular. Las operaciones de Universo están en **Universo · QuadMinds**, con una tarea visible por vez. Las referencias a la navegación anterior que sigan en este documento deben interpretarse según estos nombres actuales.

**Corrección de asignaciones:** PostgreSQL convertía a minúsculas los alias sin comillas de vehículo/teléfono, rutas y circuitos; el guardado existía, pero el formulario no lo reconocía al consultar. Los alias camelCase se conservan explícitamente en Traccar y QuadMinds. Asignar vehículo muestra confirmación junto al botón, progreso al guardar y errores locales; al elegir un vehículo vuelve a cargar su teléfono guardado. Validación: 17 tests de tracking/QuadMinds, dos pruebas PostgreSQL con rollback y guardado → recarga → selección en navegador sobre base temporal en memoria. La asignación real existente se verificó mediante lectura, sin modificarla. Evidencia: `evidencias/traccar-asignacion-guardada-demo.png`.

Traccar está desplegado en el proyecto Railway Nexora `resilient-contentment`. El OS local integra su última posición y la web de seguimiento publicada consulta el mismo dato en Supabase. Universo conserva QuadMinds. No se necesita abrir el panel administrativo de Traccar para registrar teléfonos.

## Primer teléfono real

1. Abrir el OS operativo en `http://127.0.0.1:5173`. Si pide configuración inicial, crear la organización y el administrador reales: la base operativa estaba vacía y no se crearon cuentas ficticias permanentes.
2. Crear los clientes, choferes y vehículos reales. En **Tracking → Mi celular → Teléfonos**, registrar un teléfono con una cuenta ADMIN u OPERATIONS. Abrir **Conectar celular** en ese teléfono.
3. Instalar **Traccar Client** oficial en el teléfono. Copiar el identificador que muestra el OS y usar como servidor `https://nexora-traccar-production.up.railway.app`. Activar servicio, ubicación precisa y permiso de ubicación en segundo plano; permitir su funcionamiento con la pantalla bloqueada. Probar envío cada 30 segundos y ajustar consumo durante la prueba de calle.
4. Vincular ese teléfono al vehículo desde **Mi celular → Asignar vehículo**. Un teléfono solo puede pertenecer a un vehículo a la vez. Revincular invalida la posición anterior y exige una medición nueva.
5. Como ADMIN, en **Mi celular → Clientes**, seleccionar **Nexora · otros clientes** únicamente para clientes que usarán nuestro circuito. Mantener **QuadMinds · Universo** para Universo. Los clientes sin configuración conservan QuadMinds.
6. En **Mi celular → Rutas**, para una ruta en borrador de reparto propio, elegir **Traccar · Nexora** antes de confirmarla. No mezclar circuitos. Seguir recepción, asignación, carga, inspección y despacho normales del OS.
7. Consultar el vehículo desde **Tracking → Mapa**. Compartir el enlace del bulto que aparece en Envíos. Durante el reparto, comprobar el mapa también desde otro teléfono sin iniciar sesión. Completar la entrega con la evidencia exigida y verificar que desaparezca el mapa público.

La prueba con teléfono físico, pantalla bloqueada, pérdida de señal y recorrido real queda pendiente. Los tests ejecutados enviaron posiciones simuladas por el protocolo real de Traccar; no prueban permisos ni batería del teléfono. La configuración real de API, órdenes y comprobantes QuadMinds de Universo sigue pendiente de sus credenciales y contrato: se preservó y verificó con fixtures, sin afirmar conexión real a ese proveedor.

## Qué ve cada persona

El OS exige sesión y permisos de ruta. La web utiliza el código aleatorio del bulto como enlace de acceso: quien tenga ese código puede consultar el estado del pedido y, durante el reparto propio activo, la última posición del vehículo de ese bulto. Tratar el enlace como privado.

La web no publica identificadores de teléfono/vehículo, nombres de choferes, historial GPS ni ETA. La posición exige bulto en tránsito, custodia en vehículo, asignación activa, ruta en curso, circuito Nexora y vinculación actual. Se retira al entregar, desasignar o desvincular. Hasta 3 minutos se considera reciente; hasta 10 minutos muestra aviso de atraso; después oculta las coordenadas. Una pasarela desconectada también marca atraso.

## Infraestructura

| Servicio | Función |
|---|---|
| nexora-traccar | Traccar 6.16.0; dominio público solo OsmAnd/5055; API y administración 8082 privadas |
| nexora-traccar-db | MySQL 8.4.8; volumen privado persistente de 500 MB |
| nexora-gps-bridge | Función Bun; WebSocket privado, recuperación cada 30 s, escritura GPS en Supabase por TLS validado |
| nexora-traccar-backup | Copia diaria 03:00 Paraguay; volumen privado de 500 MB; depuración por antigüedad de siete días |

El rol Supabase `nexora_tracking_worker` no puede leer pedidos, clientes ni usuarios. Secretos únicamente en Railway y configuración local privada `.env`/`.local/traccar/`; nunca copiar esas carpetas al repositorio público. La migración aplicada es `20261016035011_traccar_tracking.sql`, versión de aplicación 8. SQLite DEMO no puede registrar teléfonos en la pasarela real.

El OS continúa ejecutándose localmente; esta entrega no lo publica en Railway. Traccar y la pasarela permanecen en la nube aunque se cierre el OS local. El antiguo servicio Railway `nexora-logistic`, conectado al repositorio estático público, ya fallaba por ausencia de start command y no aloja el OS. La web usa Netlify Drop: publicar GitHub no actualiza Netlify automáticamente.

## Copias y recuperación

La primera copia se ejecutó el 16/10/2026 a las 06:00 UTC (03:00 Paraguay). Railway registró **Backup MySQL validado** y `/backups/traccar-20261016T060056Z.sql.gz`, 9.0 KB. Se verifica `gzip -t` y se exige éxito de mysqldump mediante pipefail. Esto confirma creación e integridad del comprimido; no se hizo una restauración completa.

El volumen está dentro del mismo proyecto, sin copia externa. Supervisar capacidad: 500 MB es el límite inicial y puede llenarse si crece mucho la base. Traccar conserva historial en MySQL; aún no se configuró una política de purga de ese historial.

Para recuperar: conservar el volumen original, detener nuevas escrituras de Traccar, elegir un dump validado, importarlo en una instancia MySQL aislada y comprobar usuarios, dispositivos y posiciones antes de cambiar el servicio. Usar credenciales privadas desde Railway; nunca pegarlas en chat. Una prueba de restauración debe realizarse sobre una base aislada. La copia MySQL no reemplaza copias de Supabase ni de la configuración privada del OS.

## Validación realizada

- Suite OS final: 87 pruebas aprobadas, cero fallos (incluye permisos HTTP y seis pruebas específicas de Traccar). Compilación TypeScript/Vite correcta.
- Web: 17 pruebas y build; publicada en Netlify y cambios de `public/app.js` y `public/tracking.js` publicados en GitHub main.
- PostgreSQL real: prueba transaccional de almacenamiento GPS, orden temporal, revinculación y permisos, con rollback.
- Transporte real con coordenadas simuladas: HTTPS OsmAnd → Traccar → WebSocket → Supabase → consulta OS y RPC anónima. Dos vehículos aislados; código desconocido, entrega, desvinculación y retirada de ruta no revelan posición.
- Navegador: mapa OpenStreetMap renderizado en la web publicada. Evidencia en `evidencias/traccar-web-publica-completa.png`; configuración OS en `evidencias/traccar-os-demo.png` (DEMO aislada).
- Salud de pasarela HTTP 200 y rechazo 401 al registrar dispositivos sin autorización. Primera copia programada ejecutada y validada.

Scripts: `infra/traccar/check-live.mjs`, `tests/postgres.traccar.ts`, `infra/traccar/e2e.ts`. El E2E crea fixtures temporales identificados y retira dispositivos. La limpieza del historial de esos fixtures requiere el conector administrativo y el SQL con guardia exacta generado en `.local/traccar/cleanup.sql`; no ampliar permisos de borrado del runtime.

Limpieza final confirmada el 16/10/2026: cero organizaciones QA, usuarios, envíos, dispositivos y últimas posiciones en la base operativa. Se usó el editor SQL de Supabase con autorización explícita porque el conector devolvía `Invalid or expired requestState`. El OS responde `setupRequired: true`, listo para el alta real. La DEMO SQLite conserva sus datos aislados. El dispositivo físico todavía no está registrado: su identificador se genera al pulsar **Registrar teléfono** en el OS real.

## Ajustes del celular para el ensayo

Descargar desde [Traccar Client oficial](https://www.traccar.org/client/), que enlaza Google Play y App Store. Configurar **Device identifier / Identificador** con el código `NX-…` que genera el OS; no usar el número predeterminado de la app. **Server URL / URL del servidor** debe ser exactamente `https://nexora-traccar-production.up.railway.app`, sin añadir `:5055`, `/api` ni `/devices`: Railway ya enruta HTTPS al puerto OsmAnd privado.

Para el primer ensayo usar precisión **Highest / Máxima** e intervalo **30 segundos**; en Android, distancia **0** permite priorizar el intervalo. Son objetivos de actualización, no garantías del sistema operativo. Autorizar ubicación precisa y en segundo plano. Android: batería sin restricciones para Traccar Client; iPhone: ubicación Siempre y actualización en segundo plano habilitada. Consultar [configuración oficial](https://www.traccar.org/client-configuration/) y [resolución de problemas](https://www.traccar.org/client-troubleshooting/).

Activar **Service / Servicio** con datos móviles y GPS encendidos. Esperar 30–60 segundos al aire libre, caminar con el teléfono y comprobar la hora de medición en el OS. Para comprobar la web, además debe existir un envío del cliente Nexora asignado a esa ruta y efectivamente despachado; registrar solo el teléfono no publica un mapa. Al terminar el ensayo, apagar Servicio para detener el envío del GPS.

## Envío mínimo para probar la web

Usar un bulto físico de ensayo, una referencia clara como `PRUEBA-CELULAR` y un cliente propio de prueba; mantener Universo fuera de este ensayo. No hace falta cargar un catálogo ni crear stock para probar un envío suelto desde **Envíos**.

1. En **Envíos → Nuevo envío**, elegir ese cliente y declarar un bulto con origen, destino, destinatario, peso y volumen conocidos. Elegir la política de prueba de entrega correspondiente. Guardar y copiar su código `B-…`.
2. En **Envíos → Recibir bultos**, elegir el envío, el lugar real, marcar el bulto recibido y pulsar **Confirmar recepción seleccionada**.
3. Crear una ruta en **Rutas**, con el chofer y vehículo vinculados al celular, dentro del horario previsto. Mientras siga en borrador, establecer Traccar en Tracking y circuito Nexora para ese cliente.
4. En el detalle de la ruta, **Preparar ruta → Asignar selección** para ese bulto. Pulsar **Confirmar plan**.
5. En **Cargar vehículo**, escribir o escanear el código y pulsar **Registrar escaneo**. Registrar una inspección real del vehículo desde **Flota → Inspecciones**, o desde la cuenta de chofer en **Control de salida**. Resolver cualquier requisito impeditivo que indique el OS.
6. Pulsar **Despachar**. La web solo habilita coordenadas medidas después de la salida. Esperar una medición nueva del celular y abrir el enlace que aparece en el detalle de Envíos, o consultar el código en `https://nexoralogisticpy.netlify.app/seguimiento/`.
7. Comprobar cambio de posición y hora con un recorrido corto. Al completar el ensayo, registrar la entrega real del bulto de prueba en la ruta, con las evidencias exigidas, y confirmar que el mapa desaparece de la web. Apagar Servicio en Traccar Client.

Si aparece **Sin posición**, revisar identificador, servidor, vinculación y permisos; confirmar que la app envió una medición posterior a la vinculación. Si el OS muestra GPS pero la web no, revisar circuito Nexora, proveedor Traccar, bulto cargado/despachado y asignación activa. Si **Despachar** está bloqueado, resolver el motivo operativo que muestra el OS; no saltar sus controles.

Publicación manual: seguir `web-publica/docs/DEPLOY_NETLIFY.md` con `BASE_PATH=/` y `scripts/package-netlify.ps1` (ZIP con `/`). Paquete correcto de esta entrega: `web-publica/artifacts/nexora-netlify-82213742437c43098470162351733f24.zip`. No usar Compress-Archive para estos despliegues: puede generar rutas de Windows incompatibles.
