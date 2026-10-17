# Auditoría profunda de Nexora Logistic OS

Actualización posterior: se ejecutaron correcciones el 17-10. Consultar [fixes y verificaciones](FIXES_VERIFICADOS_2026-10-17.md); este informe conserva la evidencia del estado auditado originalmente.

Fecha: 16 de octubre de 2026. Alcance: aplicación OS, API, lógica de rutas e inventario, integración GPS, migraciones y permisos Supabase, web de seguimiento, pruebas, dependencias y estado local.

Revisión de código y configuración con pruebas ejecutadas. No se modificó código operativo. Se consultó el estado con un GET local y metadatos/asesores de Supabase; no se leyeron datos comerciales ni valores de secretos.

## Resultado ejecutivo

El build compila. La suite del OS termina en **78 aprobadas y 19 fallidas de 97**. Las fallas no son 19 defectos independientes: los escenarios de rutas crean clientes sin circuito GPS, y la nueva precondición del servidor rechaza sus transiciones con 409. Los fixtures no se actualizaron. Mientras la suite esté roja, no valida fiablemente las rutas.

La pasarela Traccar del servidor local informa conectada. QuadMinds informa **INTEGRATION_NOT_CONFIGURED**, así que el flujo de Universo no puede probarse de punta a punta. No se probó un celular físico. El OS auditado sirve en 127.0.0.1 y el proceso local escucha en loopback; esto no equivale a publicar el OS para todo el equipo.

## Hallazgos

### H-01 — La suite de rutas falla por fixtures sin política GPS

**Severidad: P1 · bloqueo de validación**

**Evidencia:** server/traccar.ts, líneas 91–103, exige circuito antes de confirmar ruta. npm test: 97 pruebas, 78 PASS, 19 FAIL. Casos afectados incluyen acceptance-v2, flow, guards, inventory y warehouse-story. Llegan a server/traccar.ts:98 y reciben 409. En la prueba de concurrencia, las dos rutas fallan antes de probar cuál confirma.

**Escenario de fallo:** los tests preparan clientes sin fila en client_delivery_policies; la transición termina antes del comportamiento objetivo.

**Impacto:** no se distinguen regresiones nuevas de fixtures incompatibles. Esto no prueba que una ruta configurada falle en producción, pero la suite actual no valida sus transiciones principales.

**Por qué falla la protección:** el control de negocio rechaza datos ambiguos; el setup de tests quedó viejo al añadir la política.

**Corrección mínima:** actualizar fixtures positivos con políticas válidas por cliente y conservar pruebas negativas para circuito faltante y mezcla QuadMinds/Traccar. No quitar la validación para poner verde la suite.

**Verificación:** repetir npm test completo; confirmar que los escenarios positivos atraviesen la precondición y los negativos sigan devolviendo 409 por la causa correcta.

### H-02 — QuadMinds no está configurado en la instancia

**Severidad: P1 · bloqueo operativo de Universo**

**Evidencia:** GET de solo lectura a /api/health devolvió HTTP 200, base postgres, Traccar configured=true y connected=true, pero QuadMinds INTEGRATION_NOT_CONFIGURED. server/quadminds.ts y server/quad-sync.ts bloquean las acciones que requieren credenciales.

**Escenario de fallo:** una ruta de Universo puede seleccionar QuadMinds, pero el envío, sincronización o consulta real falla al llegar al conector desconfigurado.

**Impacto:** el circuito de Universo no está listo para aceptación real. Estado conectado de Traccar no valida QuadMinds ni prueba transmisión desde un celular.

**Por qué falla la protección:** el servidor informa la falta de configuración y no inventa resultados; los tests de proveedor usan fixtures, no credenciales reales.

**Corrección mínima:** activar cuenta/credenciales QuadMinds por canal privado, verificar endpoint y contrato, y probar una orden/ruta autorizada.

**Verificación:** /api/health deja de decir INTEGRATION_NOT_CONFIGURED y una operación controlada devuelve respuesta real. Probar por separado un celular Traccar físico.

### H-03 — La excepción de Universo depende del nombre comercial editable

**Severidad: P2 · riesgo de ruteo incorrecto**

**Evidencia:** server/traccar.ts:57–62, 91–102, 108–115 detecta Universo comparando el nombre en minúsculas con el texto exacto universo. frontend/TraccarPanel.tsx usa el mismo fallback. Clientes permite cambiar el nombre comercial.

**Escenario de fallo:** si la ficha se renombra a Universo S.A., deja de aplicarse la excepción; un cliente distinto llamado Universo podría heredarla.

**Impacto:** la regla QuadMinds puede bloquear rutas válidas o permitir circuito incorrecto.

**Por qué falla la protección:** las rutas sí validan que sus políticas coincidan, pero la identidad especial se infiere de un nombre, no de un ID estable.

**Corrección mínima:** fijar la política QuadMinds al ID inmutable del cliente Universo y retirar comparación por nombre. Añadir pruebas de renombre y homónimo.

**Verificación:** renombrar Universo en fixture no cambia su circuito; otro cliente con igual nombre no hereda la política.

### H-04 — Hay un endpoint de puntos GPS que siempre responde 503

**Severidad: P2 · endpoint incompleto**

**Evidencia:** server/app.ts:154 registra POST /api/tracking/sessions/:id/points, autentica y siempre devuelve INTEGRATION_NOT_CONFIGURED. No se encontró llamada en el frontend ni en el trabajador Railway/Traccar. El flujo actual recibe puntos mediante el servicio Railway y los guarda en Supabase.

**Escenario de fallo:** un futuro cliente que intente usar esa ruta recibe 503 aunque el gateway GPS esté conectado.

**Impacto:** contrato engañoso y futura integración desconectada del flujo vigente.

**Por qué falla la protección:** los tests cubren ingreso por Traccar, no la ruta stub.

**Corrección mínima:** eliminarla si no es un contrato soportado o implementarla con autorización, validación y pruebas. Documentar que la app de teléfono usa la URL del panel Traccar.

**Verificación:** no queda endpoint de escritura GPS siempre fallido, o el contrato implementado tiene pruebas positivas y negativas.

### H-05 — Supabase reporta 85 claves foráneas sin índice de cobertura

**Severidad: P2 · rendimiento a medida que crezca el volumen**

**Evidencia:** asesor de rendimiento Supabase reporta 85 FK sin índice que las cubra y ocho índices no usados. No se ejecutó benchmark; el aviso es informativo y no demuestra lentitud actual.

**Escenario de fallo:** al crecer eventos, evidencia, pedidos o movimientos, joins y acciones referenciales pueden leer más filas y prolongar consultas/transacciones.

**Impacto:** riesgo futuro de latencia, no una caída observada.

**Por qué falla la protección:** las pruebas miden corrección y no perfil de carga; los índices actuales no cubren todas las FK que detectó el asesor.

**Corrección mínima:** priorizar las FK consultadas en inventario, custodia y rutas, evaluar EXPLAIN ANALYZE en copia, y crear índices por migración. No borrar índices solo porque aún no aparecen como usados.

**Verificación:** repetir asesor y comparar consultas representativas con volumen de piloto.

### H-06 — Las próximas tablas públicas deben llevar permisos explícitos

**Severidad: P2 · compatibilidad de migraciones futuras**

**Evidencia:** las migraciones actuales de portal declaran GRANT/REVOKE y RLS. Supabase anunció que desde el 30-10-2026 las tablas nuevas de `public` sin GRANT explícito no quedarán expuestas a Data API en proyectos existentes ([anuncio oficial](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)). Nexora usa conexión directa en su esquema privado y no es afectado por ese cambio.

**Escenario de fallo:** una tabla nueva del portal se crea sin GRANT y PostgREST devuelve permiso denegado aunque la tabla exista.

**Impacto:** una función futura del portal puede fallar. No se encontró una tabla pública actual sin permisos en este pase.

**Por qué falla la protección:** las migraciones actuales sí tienen grants, pero no se encontró una CI que exija grants en cada nueva tabla pública.

**Corrección mínima:** incluir GRANT/REVOKE y RLS en la migración que crea cada objeto; añadir una prueba de privilegios.

**Verificación:** aplicar migración en proyecto de prueba con defaults actuales y verificar acceso solo para roles previstos.

## Controles que pasaron

- npm run build del OS: TypeScript y Vite PASS.
- npm test de web-publica: 17/17 PASS; npm run check: PASS.
- npm audit --audit-level=moderate en OS y web-publica: cero vulnerabilidades conocidas en los lockfiles consultados.
- En el OS pasaron pruebas de aislamiento por cliente/rol, CSRF, catálogo CSV/XLSX, ZIP expandido, idempotencia, importación y conector Traccar con fixtures.
- Supabase: 57 tablas entre nexora y public; las 57 tienen RLS. anon no tiene acceso directo a tablas. authenticated tiene acceso de tabla solo a portal_companies, portal_memberships y portal_shipping_requests, bajo políticas RLS. nexora_runtime no es superusuario ni tiene BYPASSRLS.
- Asesor de seguridad Supabase: no informó fallos de RLS. Sí avisa que la protección de Supabase Auth contra contraseñas filtradas está desactivada; revisar para flujos que usen Auth. El login operativo del OS usa autenticación propia con scrypt.
- Las funciones de seguimiento público revisadas usan SECURITY INVOKER; delegan lectura pública limitada por código aleatorio B-, con search_path vacío y permisos explícitos. No se halló acceso anónimo a tablas de operación en el conteo de privilegios.

## Límites comprobados

- No se usaron credenciales QuadMinds ni se enviaron pedidos externos.
- No se conectó un celular físico ni se probaron segundo plano, cortes de señal o permisos del sistema móvil.
- No se ejecutó la suite PostgreSQL remota en este pase; las consultas a Supabase fueron de metadatos, RLS y asesores.
- No se validó una sesión humana del portal con envío real.
- No se comprobó una publicación del servidor OS en Internet. La instancia consultada fue local y server/index.ts enlaza a 127.0.0.1.
- npm audit detecta avisos conocidos en dependencias, no fallos de lógica ni componentes cargados fuera del lockfile.

## Bloqueos para liberar operación integral

1. Actualizar fixtures y hacer pasar la suite OS completa.
2. Configurar y validar QuadMinds para Universo.
3. Probar celular Traccar físico, vehículo, ruta despachada y código B- en la web.
4. Definir y verificar un alojamiento remoto del OS antes de considerarlo disponible para todo el equipo.

## Cinco riesgos principales

1. Suite OS roja: 19 transiciones de ruta sin validación efectiva.
2. QuadMinds inactivo: el circuito de Universo no se completa.
3. Regla de proveedor ligada al nombre editable del cliente.
4. Endpoint GPS stub que siempre devuelve 503.
5. 85 índices de FK señalados por asesor, con impacto aún no medido.

**VEREDICTO: FAIL** para declarar el OS listo para operación integral. El build, la seguridad estructural de tablas y el portal público pasan controles relevantes, pero la suite OS está roja y QuadMinds no está configurado.
