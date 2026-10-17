# Guía interactiva del OS

Entrada: `/manual.html` en el OS, o `MANUAL_MAESTRO_NEXORA_OS.html` en la raíz local. La carpeta `manual/` debe permanecer junto al HTML. También se abre desde el enlace «Guía interactiva» del OS.

Contiene 50 funciones, 112 pasos y tres recorridos: productos desde recepción hasta entrega, bultos sin inventario por SKU y conexión del celular. Se puede buscar por tarea, filtrar por rol, practicar formularios, revisar resultados, repetir una función e imprimir sus pasos.

Las pantallas son representaciones simplificadas. La guía no inicia sesión, no llama a las APIs del negocio, no envía GPS y no guarda campos ni contraseñas. Solo conserva identificadores de avance en el almacenamiento de este navegador. Los CSV descargables contienen datos ficticios de Demo Hogar para una demo aislada; no deben importarse en la operación real.

Contenido contrastado con `CompanyPanel`, `ClientsPanel`, `InventoryPanel`, `TraccarPanel`, `PublicTrackingLinks`, `GooglePortalAccess`, `MaintenancePanel`, rutas y permisos de servidor. QuadMinds se señala como pendiente. El mapa de práctica no es una posición física real ni certifica GPS del celular.

Archivos: `manual/lessons.js` (procedimientos), `manual/manual.js` (interacciones), `manual/manual.css` (presentación). Los scripts externos permiten conservar la CSP de producción sin habilitar JavaScript inline. Docker incorpora los archivos y Express sirve rutas explícitas del manual.

Verificación: `npx playwright test tests/e2e/manual.spec.ts`. Recorre todas las funciones; comprueba avance, validación, ausencia de llamadas a APIs, persistencia sin campos sensibles, continuidad del recorrido, descarga CSV, uso móvil y apertura desde `file:`. La CI ejecuta además los circuitos existentes del OS y el build Docker.
