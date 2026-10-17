# Auditoría funcional rápida — Nexora

Fecha local: 16/10/2026. Consulta real alrededor de 22:45, America/Asuncion.

Conclusión: hay persistencia y lógica operativa implementadas, pero falta cerrar y demostrar el recorrido real desde el celular hasta la entrega y la web. Las pruebas automatizadas no certifican ese recorrido en producción.

## Estado comprobado

| Área | Resultado | Evidencia y límite |
|---|---|---|
| OS y base | Disponible | `/api/health`: HTTP 200, PostgreSQL conectado. |
| Clientes | Alta básica persistida; fichas sin completar | Dos clientes: Universo y Pelmar. Cero registros en client_profiles. Esto no demuestra un error de guardado de ficha; no se reprodujo una edición real. |
| Depósito | Configuración persistida | Una ubicación. Cero productos y cero saldos de inventario. |
| Inventario y pedidos | Circuito automatizado probado; operación real pendiente | Cero pedidos, envíos y bultos. Las pruebas cubren recepción, reserva, carga, entrega y devolución en bases de prueba. |
| Ruta | Alta persistida | Ruta 1 en DRAFT, cero asignaciones. |
| GPS de ruta | Guardado confirmado | Ruta 1 tiene proveedor TRACCAR; existe auditoría del cambio a las 22:40:36 locales. El vehículo tiene una vinculación de teléfono. |
| Traccar | Infraestructura disponible; posición pendiente | Dos dispositivos registrados, una vinculación. Pasarela HTTP 200, upstream connected; heartbeat presente. Cero filas actuales en traccar_latest para Nexora. No se identificó todavía la causa en celular → Traccar → validación → posición guardada. |
| Circuitos de cliente | Configuración incompleta para reparto propio | Universo y Pelmar resuelven a QUADMINDS. Pelmar cae en el valor por defecto. Una ruta TRACCAR exige clientes NEXORA al validar el circuito. Universo debe conservar QUADMINDS. |
| QuadMinds | Integración real bloqueada | QUADMINDS_OPERATIONS_ENABLED no habilitado y API key ausente. Cero órdenes/rutas vinculadas. El código y pruebas con proveedor simulado no equivalen a conexión con Universo. |
| Seguimiento web | Página disponible; recorrido real pendiente | `/seguimiento/`: HTTP 200. No hay bultos reales para verificar un código de seguimiento. GPS público exige cliente NEXORA, ruta TRACCAR IN_PROGRESS, bulto IN_TRANSIT, asignación activa y posición válida. Guardar el proveedor no inicia reparto ni muestra automáticamente una posición. |
| Railway | GPS desplegado; otro servicio fallido | Últimos despliegues de Traccar, MySQL, pasarela y backup: SUCCESS. Servicio nexora-logistic del repositorio de la web: FAILED. El OS auditado está en localhost; ese servicio fallido no es prueba de caída del OS local ni de Netlify. |
| Copias y portal | Verificación parcial | Backup con cron y volumen, despliegue SUCCESS. No se comprobó restauración ni contenido de última copia en esta auditoría. No se probó alta y acceso de un cliente real al portal Google. |

## Defectos transversales encontrados en el código

1. **Confirmación fuera de la tarea.** Guardar GPS de ruta y circuito de cliente muestra el resultado mediante banners globales en App; el formulario no presenta estado guardado, resumen persistido ni siguiente paso. La selección visible puede confundirse con la configuración guardada. Referencias: frontend/TraccarPanel.tsx y frontend/App.tsx.
2. **Alta y circuito separados.** El formulario de clientes no integra la elección de reparto; el valor QUADMINDS por defecto también afecta clientes nuevos. El backend detecta incompatibilidad al validar una ruta, demasiado tarde para orientar la preparación. Referencia: server/traccar.ts, validateRouteProvider.
3. **Indicador insuficiente.** “Servidor conectado” representa el heartbeat de la pasarela, no una posición del teléfono. Con cero posiciones también aparece conectado. Referencias: server/traccar.ts, settings; frontend/TraccarPanel.tsx.
4. **Recuperación de red inconsistente.** App usa el helper con timeout; InventoryPanel mantiene otro helper sin plazo de cancelación, y las lecturas de Traccar/QuadMinds tampoco tienen timeout propio. Riesgo comprobado por inspección: una petición que no termina puede dejar la tarea esperando. No se reprodujo una caída de red real en esta auditoría.
5. **Salud de proveedores ambigua.** `/api/health` y el tracking de `/api/bootstrap` informan el estado del componente QuadMinds, aunque Traccar esté conectado. Pueden presentar INTEGRATION_NOT_CONFIGURED para un OS con pasarela Traccar disponible. Referencia: server/app.ts.
6. **Sin preparación guiada.** La UI permite llegar a rutas y tracking sin explicar en un lugar los requisitos: cliente/circuito, catálogo, depósito, pedido, vehículo/teléfono, posición y despacho. La captura del usuario y las comprobaciones de base muestran esta desconexión entre pantallas.

## Orden de reparación y aceptación

1. Unificar confirmación, errores y recuperación de red para todas las tareas. Cada guardado debe mostrar el dato persistido en el mismo formulario y sus requisitos pendientes.
2. Incorporar circuito de reparto y preparación de inventario en la ficha del cliente. Conservar Universo en QuadMinds. Configurar clientes propios explícitamente antes de planificar.
3. Diagnosticar la primera posición del celular por etapas. Mostrar por separado servidor, dispositivo, última medición y vinculación vigente; no atribuir la falta de posición al teléfono sin revisar Traccar y los filtros de ingreso.
4. Hacer una sola prueba completa controlada: cliente propio → producto → recepción → pedido → reserva → ruta → carga/checklist → despacho → GPS OS → mismo bulto en web → entrega. Registrar el resultado de cada frontera y preservar los datos reales.
5. Activar y probar QuadMinds cuando estén las credenciales reales de Universo. Verificar publicación operativa del OS y restauración de copias como comprobaciones independientes.

## Pruebas ejecutadas

- `npm.cmd test` en OS: **97/97 pasan**.
- `npm.cmd test` en web-publica: **17/17 pasan**.
- Incluyen aislamiento de roles, idempotencia, ficha de clientes, inventario, carga, despacho, devolución, circuito Nexora/Traccar, QuadMinds simulado, autenticación del portal y presentación de GPS público.
- Consultas de datos reales fueron de lectura; no se cambiaron circuitos, rutas, pedidos, inventario ni posiciones. No se certificó un viaje real ni se publicaron cambios.

## Correcciones aplicadas después de la auditoría

- Las confirmaciones globales del OS quedan fijas a la vista mientras se desplaza la página; GPS y circuito muestran además su resultado en el propio formulario.
- El panel distingue conexión de la pasarela de llegada y antigüedad de la última posición GPS válida, y refresca ese estado cada 15 segundos.
- La ruta muestra los clientes que tiene asignados. Un circuito sin definir o incompatible detiene el guardado del proveedor. El servidor vuelve a validar al asignar pedidos y antes de confirmar la ruta; Universo queda fijado a QuadMinds.
- Las peticiones de inventario, tracking, QuadMinds, empresa/equipo, portal cliente y accesos web tienen un plazo máximo común. Las operaciones QuadMinds conservan su identificador seguro al reintentar después de un timeout.
- `/api/health` conserva el estado existente y ahora informa QuadMinds y Traccar por separado.
- La nueva compilación se validó y el servicio local responde en `http://127.0.0.1:5173`. La pantalla real de GPS sigue pendiente de una posición del teléfono. No se desplegaron cambios a Railway ni al sitio público.
