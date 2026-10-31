# Organización y aprobación del reparto

El flujo es **Pedidos → confirmar reserva → Rutas → organizar → aprobar distribución → cargar → confirmar ruta → despachar**.

`POST /api/routing/organize` prepara una propuesta: agrupa las reservas que todavía no pertenecen a una propuesta vigente, elige camiones y choferes disponibles y calcula el orden. No crea rutas ni carga mercadería. El optimizador prioriza terminar el reparto antes distribuyendo el trabajo entre la flota utilizable; el costo total de viaje es secundario. No obliga a utilizar un camión vacío cuando no aporta una mejora o no respeta las restricciones.

La pantalla principal muestra las propuestas vigentes por aprobar y los pedidos organizados por camión con su chofer. Los cálculos reemplazados, vencidos, descartados y aprobaciones anteriores quedan en **Historial de organización**, cerrado inicialmente. No representan nuevos trabajos pendientes. Un cálculo vencido deja de retener reservas: el botón de organizar puede incluirlas de nuevo sin una operación manual de descarte. El historial permanece íntegro.

Los camiones y choferes de propuestas vigentes no se proponen simultáneamente para horarios superpuestos. La aprobación valida únicamente las reservas de esa propuesta; aprobar la primera no invalida una segunda independiente. Al cambiar de jornada se conserva el alcance original de pedidos, incluidos los que no entraban antes por horario, y se excluyen los ya agrupados en otra propuesta vigente.

`replacesProposalId` permite recalcular explícitamente un lote, conservando su versión anterior y excluyendo pedidos ya agrupados en otros lotes. `POST /api/routing/discard` descarta la propuesta, conserva su registro y libera la agrupación sin desreservar ni modificar stock.

Las referencias de calle o ciudad se identifican como aproximadas. No se presentan como alturas exactas. Si un pedido no entra por horario o capacidad, queda reservado con el motivo y, cuando corresponde, la opción de calcular la próxima jornada.

`POST /api/routing/approve` recibe la propuesta aprobada. Comprueba cuenta, empresa, vigencia, reservas, indicaciones, ubicaciones y la misma flota seleccionada. Confirma las referencias y crea o amplía las rutas en una transacción. Si algo cambió, revierte todo y solicita recalcular; no sustituye el camión sin mostrar una propuesta nueva. Repetir la aprobación no duplica rutas ni stock.

Las rutas aprobadas permanecen en preparación. Cargar los bultos, confirmar la ruta y despachar son acciones posteriores. Los planes internos del organizador requieren esta aprobación y no pueden aplicarse directamente con `/api/routing/apply`.

El horario guardado de cada ruta termina según su duración calculada, con servicios, esperas y regreso; la jornada máxima del optimizador no se guarda como diez horas de ocupación para todos los camiones. Una ampliación de un camión en preparación conserva sus paradas y carga, puede extender la estimación hasta el límite de jornada y respeta la siguiente reserva de sus recursos. Cuando hay otra tripulación libre, primero se intenta distribuir el nuevo trabajo a esa tripulación; los pedidos residuales compatibles pueden sumarse al camión existente.

Preparar, cargar, confirmar y despachar consideran como ocupación los borradores con bultos asignados, las rutas confirmadas y las rutas en curso. `Despachar ahora` no puede desplazar una ruta futura sobre otro reparto preparado del mismo vehículo o chofer. Un borrador vacío no bloquea recursos. La comprobación se realiza dentro de la transacción de cada operación.

En modo de prueba, Administración puede usar **Deshacer salida de prueba** solo después de confirmar que el vehículo no salió. Se exige que no existan visitas ni cambios posteriores de custodia; se restaura el horario previsto, se preservan carga y reservas y se añade una corrección auditada. No elimina el despacho anterior. Una redistribución de cargas que la persona confirma que eran ficticias utiliza la descarga y devolución a pendientes ya existente, conservando las reservas y el historial.

**Ver mapa grande y recorrido** abre una vista de toda la ventana, tanto en cada propuesta como en los camiones organizados y dentro de la ruta. En computadora, el mapa ocupa el espacio principal y las paradas tienen desplazamiento independiente al costado. En celular se alternan Mapa y Paradas; el resumen y los controles permanecen visibles. No se apilan mapas pequeños ni se obliga a recorrer la página para llegar a la aprobación del lote.

`POST /api/routing/itinerary` recibe `proposalCommandId` y `vehicleId`, o `routeId`. Resuelve los puntos autorizados de la empresa y solicita a OSRM el trazado por calles **en el orden ya propuesto o guardado**, sin optimizarlo de nuevo. Incluye salida, paradas numeradas, productos, instrucciones, referencias aproximadas, kilómetros, tiempo de conducción, atención y espera por ventana horaria, y regreso al depósito. Son estimaciones sin tráfico en vivo; Traccar conserva el seguimiento real. Si falta un punto o falla OSRM, todas las paradas siguen visibles y no se presenta una distancia parcial como total. Esta consulta no aprueba, geocodifica, carga ni modifica stock.

La verificación incluye pruebas SQLite/HTTP, PostgreSQL con el rol limitado, OR-Tools, navegador y una copia aislada de los seis pedidos reales. Los ensayos de carga y aprobación se realizan fuera de los datos operativos de producción.
