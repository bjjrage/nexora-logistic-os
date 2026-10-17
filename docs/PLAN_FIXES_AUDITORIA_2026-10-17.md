# Plan de corrección de hallazgos — Nexora Logistic OS

Actualización de ejecución: el OS ya tiene repositorio privado propio y se corrigieron H-01, H-03 y H-04; H-06 tiene guardia en CI. Ver el [informe de fixes y verificación](FIXES_VERIFICADOS_2026-10-17.md) para resultados y pendientes actuales. El estado de partida siguiente se conserva como registro de planificación.

Fecha: 17 de octubre de 2026  
Base: [auditoría profunda del 16-10-2026](AUDITORIA_PROFUNDA_2026-10-16.md) y repetición local de `npm.cmd test` el 17-10-2026.

## Estado de partida

La suite sigue en **78 aprobadas y 19 fallidas de 97**. Las 19 fallas se detienen en la misma precondición: cada cliente de una ruta debe tener su circuito GPS configurado. En el test concurrente, ambas solicitudes reciben 409, así que el escenario tampoco llega a probar la exclusión entre dos rutas. La corrección es preparar los datos de prueba con políticas válidas y mantener pruebas negativas; no se debe quitar la validación del servidor.

Hay un bloqueo para trabajar y revisar estos cambios con seguridad: la carpeta raíz del OS no tiene repositorio Git. El repositorio `web-publica` está limpio en `main` en `9aa116d`, pero corresponde a la web pública y no contiene el código operativo del OS. Antes de corregirlo, se debe guardar el código del OS en un repositorio privado y comprobar que `.env`, credenciales, dumps y datos reales estén excluidos. No copiar el código operativo a la web pública.

## Orden de trabajo

### 0. Preparar una base revisable — previo a todo cambio

**Responsable sugerido:** ingeniería. **Prioridad:** bloqueo transversal.

1. Crear o identificar el repositorio privado que será la fuente oficial del OS; conservar el estado actual como punto de partida.
2. Confirmar que `.env`, archivos de credenciales, bases locales, exportaciones de clientes y datos de producción no entren al repositorio. Revisar el índice de Git y el historial antes del primer push.
3. Registrar versiones de Node/npm, resultado de `npm.cmd test` y `npm.cmd run build` en esa base.

**Cierre:** el OS está versionado de forma privada, el escaneo no encuentra secretos y cualquier cambio puede revisarse y revertirse por commit.

### 1. Recuperar pruebas útiles de rutas — H-01

**Responsable sugerido:** ingeniería. **Prioridad:** P1, antes de confiar en cambios de operación.

1. Corregir el factory/fixture compartido para que los clientes de escenarios positivos tengan una política explícita `NEXORA` o `QUADMINDS`, según el escenario.
2. Mantener casos negativos que prueben que la ruta se rechaza cuando falta la política o cuando el proveedor de la ruta no coincide con el de sus envíos.
3. En la prueba concurrente, preparar ambos clientes y políticas; comprobar que exactamente una confirmación termina en 200 y la otra en 409 por la restricción de chofer/vehículo, no por configuración GPS.
4. Ejecutar la suite completa y clasificar cualquier falla restante por causa propia. No aceptar un resultado verde si los tests fueron omitidos o debilitados.

**Cierre:** `npm.cmd test` termina con 97/97 aprobadas; los negativos siguen comprobando la precondición y la prueba concurrente alcanza la condición que pretende validar. Después, ejecutar `npm.cmd run build` y `npm.cmd run test:postgres` solo contra una base de prueba aislada.

### 2. Fijar el proveedor de Universo por identidad estable — H-03

**Responsable sugerido:** ingeniería y responsable de datos. **Prioridad:** P1, antes de configurar clientes en serio.

1. Identificar y confirmar el `client_id` de Universo dentro de la organización correcta. No elegirlo solo por nombre si hay homónimos.
2. Crear una migración que registre la política `QUADMINDS` para ese ID. Configurar cada otro cliente de forma explícita según su contrato; un cliente nuevo sin política debe seguir bloqueando la confirmación.
3. Retirar las comparaciones por texto `universo` del servidor y del panel. El nombre queda como dato editable de presentación.
4. Añadir pruebas para renombrar Universo, crear otro cliente llamado Universo y tener clientes con el mismo nombre en organizaciones distintas. Solo el ID canónico de Universo conserva QuadMinds.

**Cierre:** cambiar el nombre no cambia el proveedor, y ningún homónimo obtiene automáticamente el circuito QuadMinds. La migración se aplica en una base de prueba con datos representativos y deja auditable la política.

### 3. Cerrar el contrato GPS que siempre falla — H-04

**Responsable sugerido:** ingeniería. **Prioridad:** P1, antes de anunciar una API de tracking.

El servidor ya recibe posiciones por el trabajador Traccar/Railway y el panel telefónico no llama a `POST /api/tracking/sessions/:id/points`. Para evitar dos contratos contradictorios, quitar la ruta stub si no existe un consumidor soportado. Si se decide conservarla como API oficial, implementar primero autenticación/autorización, validación, persistencia e idempotencia; no dejar una ruta autenticada que siempre responda 503.

**Cierre:** no queda una ruta GPS pública/interna que parezca operativa pero siempre falle; las pruebas describen el canal vigente y rechazan sesiones o dispositivos ajenos.

### 4. Habilitar y validar QuadMinds para Universo — H-02

**Responsables sugeridos:** operaciones Nexora y contacto autorizado de Universo. **Prioridad:** P1, bloqueo del circuito real de Universo.

1. Confirmar con Universo el endpoint, el método de autenticación, el alcance de la cuenta y si ofrece ambiente de prueba.
2. Guardar credenciales y firma de webhook solo en el almacén privado del entorno de ejecución; nunca en el manual, el repositorio ni el navegador.
3. Verificar el estado del conector y una consulta autorizada de ruta/vehículo en el entorno acordado.
4. Con autorización operativa, enviar una orden de prueba controlada, recibir el evento y comprobar que resultado, foto/firma y sincronización quedan asociados al pedido correcto.
5. Probar credencial inválida, timeout y webhook con firma incorrecta; el OS debe informar fallo y permitir reintento seguro sin duplicar la operación.

**Cierre:** el estado deja de ser `INTEGRATION_NOT_CONFIGURED`; una operación real de prueba autorizada se completa y sus errores no producen falsos éxitos ni duplicados. QuadMinds continúa asignado a Universo.

### 5. Verificar el seguimiento Traccar con un celular real

**Responsables sugeridos:** ingeniería y persona que realiza la prueba de reparto. **Prioridad:** P1 para aceptar GPS propio.

1. Crear el dispositivo en Traccar y copiar al teléfono el servidor, identificador y protocolo/puerto que correspondan a esa app. Confirmar que el ID coincide exactamente con el dispositivo creado.
2. En el OS, vincular ese dispositivo a un vehículo y configurar un cliente de prueba con proveedor Nexora/Traccar.
3. Despachar una ruta de prueba. Confirmar que el teléfono envía una posición, Traccar la recibe, el trabajador la guarda en Supabase y el OS muestra vehículo, hora y posición correctos.
4. Abrir el enlace público B- generado para la ruta y verificar que ve solo la información autorizada y actualizada.
5. Repetir con app en segundo plano, pantalla bloqueada, permiso de ubicación reducido, pérdida de señal, recuperación de conexión y punto antiguo. El OS debe marcar ubicación atrasada o no disponible sin inventar una posición actual.

**Cierre:** evidencia de una prueba completa teléfono → Traccar → trabajador → OS → enlace público, más los casos de señal/privacidad. Una prueba con mocks no sustituye esta aceptación física.

### 6. Definir el alojamiento del OS para el equipo

**Responsable sugerido:** ingeniería/operaciones. **Prioridad:** P1 si el equipo necesita usarlo fuera de la computadora anfitriona.

El servidor auditado escucha en `127.0.0.1`; por eso el build local no acredita acceso remoto. Decidir el entorno destino, configurar el listener detrás de TLS y controles de acceso, cargar secretos en el entorno privado, aplicar migraciones de forma controlada y comprobar health/readiness. Mantener separado el servicio Traccar del proceso de negocio del OS.

**Cierre:** desde una estación distinta se accede por la URL aprobada; TLS, sesión, roles, CSRF, salud de base y salud de integraciones se verifican en el entorno desplegado. Si el OS seguirá siendo local por decisión operativa, documentar que solo funciona en esa máquina y no marcar el uso remoto como habilitado.

### 7. Medir y priorizar índices de claves foráneas — H-05

**Responsable sugerido:** ingeniería de datos. **Prioridad:** P2; el asesor no demostró lentitud actual.

1. Reproducir consultas representativas de inventario, custodia, pedidos, rutas y tracking en una copia de staging con volumen de piloto.
2. Revisar planes con `EXPLAIN (ANALYZE, BUFFERS)` y estadísticas de uso; ordenar las 85 alertas por consultas reales, cardinalidad y coste.
3. Crear índices solo donde mejoren consultas/operaciones concretas; revisar solapamiento con índices existentes y el impacto de bloqueo al aplicar cada migración.
4. Repetir planes y tiempos antes/después. No borrar automáticamente los ocho índices que el asesor marca como no usados: una lectura corta no demuestra que sean innecesarios.

**Cierre:** cada índice agregado tiene una consulta objetivo y evidencia antes/después; no se introducen índices masivos sin medir.

### 8. Evitar migraciones públicas sin permisos explícitos — H-06

**Responsable sugerido:** ingeniería. **Prioridad:** P2, antes de agregar tablas nuevas al esquema `public`.

Agregar a la plantilla de migración y al chequeo automático: RLS cuando corresponda, `REVOKE` explícitos, `GRANT` mínimos por rol y políticas probadas. Añadir una comprobación que detecte tablas nuevas de `public` sin el bloque de privilegios. Validar la migración en una base desechable con los defaults vigentes de Supabase.

**Cierre:** el rol anónimo no obtiene acceso a datos operativos; los roles autorizados conservan solo los permisos previstos, y una tabla de prueba sin grants hace fallar el chequeo.

### 9. Resolver la advertencia de contraseñas filtradas de Supabase Auth

**Prioridad:** P2, hardening; la auditoría no confirmó un bypass ni un defecto de login del OS.

Confirmar qué flujos usan Supabase Auth. Si el portal permite altas/cambios de contraseña con Auth, habilitar la protección contra contraseñas filtradas y probar alta, cambio y recuperación. Si ningún flujo activo usa Auth, registrar esa decisión y volver a comprobarla cuando se modifique la autenticación.

## Puerta para dar por cerrado el plan

No declarar el OS listo para operación integral hasta que:

- el código del OS esté en un repositorio privado y las pruebas/build pasen desde una revisión limpia;
- las políticas de proveedor usen identidad estable y Universo continúe en QuadMinds;
- QuadMinds complete su prueba autorizada;
- el celular complete el recorrido real por Traccar, OS y enlace B-;
- el entorno del OS esté desplegado y verificado si el equipo necesita acceso remoto;
- la auditoría se actualice con resultados y límites comprobados, no solo con tareas marcadas.

Los índices y la protección de nuevas tablas `public` se cierran con evidencia y guardas antes de escalar o ampliar el portal. Hasta entonces, el veredicto operativo de la auditoría permanece **FAIL para operación integral**.
