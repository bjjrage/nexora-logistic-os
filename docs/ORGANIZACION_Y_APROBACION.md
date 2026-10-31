# Organización y aprobación del reparto

El flujo es **Pedidos → confirmar reserva → Rutas → organizar → aprobar distribución → cargar → confirmar ruta → despachar**.

`POST /api/routing/organize` prepara una propuesta: agrupa reservas completas, elige camiones y choferes disponibles, calcula el orden y muestra las referencias geográficas e indicaciones. No crea rutas ni carga mercadería. La propuesta queda disponible al actualizar Rutas durante 30 minutos.

Las referencias de calle o ciudad se identifican como aproximadas. No se presentan como alturas exactas. Si un pedido no entra por horario o capacidad, queda reservado con el motivo y, cuando corresponde, la opción de calcular la próxima jornada.

`POST /api/routing/approve` recibe la propuesta aprobada. Comprueba cuenta, empresa, vigencia, reservas, indicaciones, ubicaciones y la misma flota seleccionada. Confirma las referencias y crea o amplía las rutas en una transacción. Si algo cambió, revierte todo y solicita recalcular; no sustituye el camión sin mostrar una propuesta nueva. Repetir la aprobación no duplica rutas ni stock.

Las rutas aprobadas permanecen en preparación. Cargar los bultos, confirmar la ruta y despachar son acciones posteriores. Los planes internos del organizador requieren esta aprobación y no pueden aplicarse directamente con `/api/routing/apply`.

La verificación incluye pruebas SQLite/HTTP, PostgreSQL con el rol limitado, OR-Tools, navegador y una copia aislada de los seis pedidos reales. Los ensayos de carga y aprobación se realizan fuera de los datos operativos de producción.
