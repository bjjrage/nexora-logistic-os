# Organización y aprobación del reparto

El flujo es **Pedidos → confirmar reserva → Rutas → organizar → aprobar distribución → cargar → confirmar ruta → despachar**.

`POST /api/routing/organize` prepara un lote: agrupa las reservas que todavía no pertenecen a otra propuesta, elige camiones y choferes disponibles y calcula el orden. No crea rutas ni carga mercadería. Cada lote se conserva al actualizar Rutas; el vencimiento del cálculo se muestra como estado y exige recalcular, sin ocultarlo ni desagrupar sus pedidos.

La pantalla muestra todos los lotes y sus estados: pendientes, aprobados, vencidos, modificados, superpuestos, descartados o recalculados. Un segundo cálculo no reemplaza el primero. Los camiones y choferes de propuestas vigentes no se proponen simultáneamente para otro lote en un horario superpuesto. La aprobación valida únicamente las reservas de ese lote; aprobar el primero no invalida un segundo lote independiente.

`replacesProposalId` permite recalcular explícitamente un lote, conservando su versión anterior y excluyendo pedidos ya agrupados en otros lotes. `POST /api/routing/discard` descarta la propuesta, conserva su registro y libera la agrupación sin desreservar ni modificar stock.

Las referencias de calle o ciudad se identifican como aproximadas. No se presentan como alturas exactas. Si un pedido no entra por horario o capacidad, queda reservado con el motivo y, cuando corresponde, la opción de calcular la próxima jornada.

`POST /api/routing/approve` recibe la propuesta aprobada. Comprueba cuenta, empresa, vigencia, reservas, indicaciones, ubicaciones y la misma flota seleccionada. Confirma las referencias y crea o amplía las rutas en una transacción. Si algo cambió, revierte todo y solicita recalcular; no sustituye el camión sin mostrar una propuesta nueva. Repetir la aprobación no duplica rutas ni stock.

Las rutas aprobadas permanecen en preparación. Cargar los bultos, confirmar la ruta y despachar son acciones posteriores. Los planes internos del organizador requieren esta aprobación y no pueden aplicarse directamente con `/api/routing/apply`.

**Ver mapa grande y recorrido** abre una vista de toda la ventana, tanto en cada propuesta como en los camiones organizados y dentro de la ruta. En computadora, el mapa ocupa el espacio principal y las paradas tienen desplazamiento independiente al costado. En celular se alternan Mapa y Paradas; el resumen y los controles permanecen visibles. No se apilan mapas pequeños ni se obliga a recorrer la página para llegar a la aprobación del lote.

`POST /api/routing/itinerary` recibe `proposalCommandId` y `vehicleId`, o `routeId`. Resuelve los puntos autorizados de la empresa y solicita a OSRM el trazado por calles **en el orden ya propuesto o guardado**, sin optimizarlo de nuevo. Incluye salida, paradas numeradas, productos, instrucciones, referencias aproximadas, kilómetros, tiempo de conducción, atención y espera por ventana horaria, y regreso al depósito. Son estimaciones sin tráfico en vivo; Traccar conserva el seguimiento real. Si falta un punto o falla OSRM, todas las paradas siguen visibles y no se presenta una distancia parcial como total. Esta consulta no aprueba, geocodifica, carga ni modifica stock.

La verificación incluye pruebas SQLite/HTTP, PostgreSQL con el rol limitado, OR-Tools, navegador y una copia aislada de los seis pedidos reales. Los ensayos de carga y aprobación se realizan fuera de los datos operativos de producción.
