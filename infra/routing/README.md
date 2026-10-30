# Ruteo propio de Nexora

Pedidos → Reservar stock → Rutas → Organizar todos los reservados → Cargar este camión → Confirmar ruta → Control de salida → Despachar ahora. La reserva no pide ubicaciones, ruta, vehículo ni chofer. El sistema distribuye las reservas completas entre recursos disponibles y deja pendientes explícitos cuando falta información o capacidad. OR-Tools calcula con tiempos de calle OSRM y búsqueda Nominatim sobre datos OSM propios; Traccar conserva el seguimiento GPS.

El depósito y la flota se recuperan del último cálculo; el chofer del camión se recupera de sus rutas, validando acceso y disponibilidad. Si solo existe un camión y un chofer disponibles se propone esa pareja. La pantalla permite cambiar la selección sin salir. El servidor excluye camiones/choferes comprometidos y vehículos con bultos a bordo. Se pueden seleccionar pedidos de todas las páginas de la fecha y cliente elegidos; aplicar afecta solo a esa selección. El límite sigue siendo 80 pedidos por cálculo.

El registro de ubicaciones tiene un buscador y un mapa siempre visible. Un resultado único centra y marca el mapa; si hay varios se elige uno. Se puede ajustar el marcador arrastrándolo o tocando el mapa, y luego pulsar Guardar ubicación. No hay campos de coordenadas, acordeones ni pasos en otra pantalla. Se aceptan direcciones, nombres, enlaces de Maps y Plus Codes. Un código corto, como `J9XG+VVH, San Vicente & Aca Verá, Lambaré`, se recupera con la ciudad identificada en el geocodificador privado; una ciudad ambigua requiere aclaración. Los códigos completos se decodifican localmente con la biblioteca abierta Open Location Code.

Se puede pegar el enlace Compartir de Google Maps si contiene el punto explícito del lugar o una búsqueda con coordenadas, expandiendo enlaces cortos únicamente dentro de dominios de Maps permitidos. Los enlaces que contienen solo un Place ID o el centro de la cámara no se convierten en coordenadas inventadas. El catálogo de Google Places no se replica en Nominatim.

Las direcciones exactas ya confirmadas se reutilizan dentro de la empresa. La búsqueda automática únicamente acepta una coincidencia de dirección con rango Nominatim de edificio; calles o localidades ambiguas quedan para revisión. La carga cartográfica usa Referer de origen, conforme a la política del proveedor de imágenes; OSRM/Nominatim privados no suministran esas imágenes.

## Operación

1. Administración registra la ubicación de cada depósito en Empresa y equipo → Mi empresa → Depósitos y salida de repartos. Es compartida por toda la operación. Una reserva repartida entre sectores queda pendiente de consolidación; no se supone que dos sectores sean un mismo lugar físico.
2. En Pedidos se reserva únicamente el pedido completo. No se configura transporte ni se pide GPS para apartar stock. Recibir mercadería y reservar son operaciones distintas.
3. En Rutas, Organizar todos los reservados toma las reservas sin asignación de hoy y días anteriores, de todos los clientes. Excluye futuros y circuitos externos. Busca destinos automáticamente y acepta solo direcciones confiables; los dudosos tienen Revisar dirección con buscador y mapa.
4. Elige vehículos y choferes disponibles, priorizando la pareja registrada o histórica. Valida compromisos solapados, carga a bordo, capacidad y ventanas horarias. Peso o volumen ausentes se muestran como capacidad sin verificar; un exceso conocido no se acepta.
5. Puede agregar nuevas reservas a un camión en preparación compatible, respetando la secuencia anterior y la carga ya subida. Agregar carga deja la ruta pendiente de confirmación. Nunca reorganiza rutas despachadas. Los demás pedidos reciben rutas nuevas con paradas ordenadas.
6. La aplicación del lote es atómica: se revalidan reservas, recursos y versiones; si algo cambió, no queda una distribución parcial. La clave de comando permite reintentos sin duplicación, incluso tras perder la respuesta. No se reserva ni se descuenta stock una segunda vez.
7. Cargar este camión abre la carga operativa agrupada: seleccionar bultos físicamente subidos → Confirmar carga → Confirmar ruta → Control de salida → Despachar ahora → registrar resultado. No hay segunda carga en Pedidos. Para corregir, bajar, quitar asignación o desreservar con las acciones existentes.

Límites actuales: hasta 1000 reservas en la cola, lotes de cálculo de 80 pedidos y hasta 8 vehículos por cálculo. Los pedidos sin recursos, con restricciones no interpretables o sectores múltiples quedan pendientes con motivo explícito. No se inventan coordenadas ni se certifica capacidad de carga desconocida. El organizador aplica la distribución al pulsar el botón; no exige una segunda pantalla de confirmación.

## Instalación local de mapas propios

Requiere Docker Engine/Compose y espacio/RAM para importar Paraguay. Los contenedores de mapas son independientes de la base operativa de Supabase. Las imágenes `latest` de OSRM se usan para desarrollo: fijar ambas al mismo digest verificado antes de producción, ya que los datos preprocesados y el ejecutable deben ser compatibles.

Desde la raíz en PowerShell:

```powershell
New-Item -ItemType Directory -Force infra/routing/data
Invoke-WebRequest https://download.geofabrik.de/south-america/paraguay-latest.osm.pbf -OutFile infra/routing/data/paraguay-latest.osm.pbf
docker compose -f infra/routing/compose.yaml --profile setup run --rm osrm-preprocess
# Definir NOMINATIM_PASSWORD en la sesión o mediante un archivo privado excluido de Git.
docker compose -f infra/routing/compose.yaml up -d osrm nominatim
```

Esperar a que finalice la importación Nominatim; un contenedor encendido no significa que el buscador esté listo. Los puertos locales se limitan a loopback. No se debe publicar el PostgreSQL de Nominatim ni los servicios de mapas sin control de acceso.

Configuración privada del servidor del OS (alternativamente, para una instancia local conectada a la misma base y sesiones, definir solamente `ROUTING_REMOTE_OS_URL=https://nexora-logistic-os.vercel.app` para usar los mapas privados a través del OS publicado):

```dotenv
ROUTING_OSRM_URL=http://127.0.0.1:5000
ROUTING_NOMINATIM_URL=http://127.0.0.1:8088
ROUTING_PYTHON=<ruta al ejecutable Python del entorno con OR-Tools>
```

El Dockerfile del OS instala Python y OR-Tools en `/opt/routing`. Fuera de Docker crear un entorno Python 3.11 y ejecutar `pip install -r infra/routing/requirements.txt`. No usar los servidores públicos de demostración como backend de producción.

## Activación en Railway

Provisionar OSRM con datos preprocesados de Paraguay y Nominatim con volumen persistente `/var/lib/postgresql/16/main`. Usar exclusivamente networking privado para los endpoints anteriores, verificando sus nombres y puertos reales. Medir la memoria necesaria durante la importación y ajustar recursos antes de activarla. No compartir credenciales de Supabase con estos servicios: el optimizador recibe solamente el modelo de viaje.

Aplicar primero `supabase/migrations/20261030023844_automatic_routing.sql` (versión 19) y `supabase/migrations/20261030042446_route_ingress_order.sql` (versión 20, prioridad de ingreso para pedidos importados simultáneamente). Las tablas son privadas con RLS; únicamente el rol de servidor `nexora_runtime` tiene acceso, con autorización por organización y función en las APIs del OS. El rol GPS no recibe permisos. Después desplegar el servidor y frontend juntos. El código requiere la versión 20 en el arranque: no publicar el cambio sin aplicar antes las migraciones.

## Verificación

`scripts/verify-routing-production.ts` permite verificar servicios reales, pantalla publicada y el circuito operativo en una transacción PostgreSQL que se revierte completa. Requiere `ROUTING_PRODUCTION_VERIFY=1`, la configuración privada existente del OS y Python con OR-Tools. Crea una identidad QA aislada temporal, la elimina al finalizar y guarda el reporte en `.local/routing-production-verification/`. No ejecuta entregas sobre pedidos operativos reales.

```powershell
$env:ROUTING_PYTHON='<ruta al Python con OR-Tools>'
node --test tests/routing.test.ts
npm run build
npx playwright test --config playwright.routing.config.ts
```

La prueba de navegador usa dobles HTTP de OSRM/Nominatim y el solver OR-Tools real. Las pruebas de dominio verifican stock compartido, rollback completo ante fallo tardío, idempotencia, aislamiento, propuestas desactualizadas, descarga/desreserva y carga → confirmación → despacho → entrega → cierre. No certifican calidad cartográfica de direcciones reales ni recursos de los contenedores.

## Límites de esta entrega

- Hasta 80 pedidos y 8 vehículos por cálculo, con 3 segundos de búsqueda; el resultado es una solución factible, no una garantía del óptimo global.
- Una jornada de hasta 16 horas dentro de la misma fecha local; regreso al depósito incluido. Horarios del formulario se interpretan en la zona del navegador y el servidor exige que el inicio corresponda al día de la empresa.
- Pedidos indivisibles; todos sus productos se envían juntos. No agrega pedidos a rutas existentes ni mueve mercadería cargada; crea nuevas rutas usando vehículos libres.
- Se revisan restricciones de texto manualmente: pedidos con restricciones especiales quedan pendientes. No se afirma que el perfil vial estándar valide altura, ancho o peso legal del camión.
- OSRM estima tiempos viales sin tráfico en vivo. No usa la cercanía GPS para asignar pedidos a vehículos ya despachados.
- La recepción/importación aún no dispara asignaciones por sí sola: esta es la etapa asistida. Quedan para una etapa posterior la geocodificación masiva con revisión, agrupación de sectores por depósito físico, trabajos persistentes en segundo plano, rutas existentes e incorporación dinámica después de salir.
- Antes de activar producción: importar y probar mapas de Paraguay, verificar una muestra de destinos reales, aplicar migración privada y medir los límites operativos.
