# Nexora OS conectado a Supabase

> Actualización 17/10/2026: migraciones 1–13 aplicadas; baseline histórico del portal recuperado. El entorno aislado prepara scripts/sql/tracking-worker-role.sql antes de las migraciones. Ver CIERRE_FIXES_CHECKLIST_2026-10-17.md para evidencia y límites.

Actualización 17-10-2026: el historial de aplicación llega a **1–10**, con la migración de políticas de reparto por identidad estable. La última suite real pasó **10/10**. Consultar el [informe vigente de fixes](FIXES_VERIFICADOS_2026-10-17.md); el detalle histórico de preparación del 15-10 se conserva abajo.

Actualizado el 15 de octubre de 2026. El servidor local ya usa PostgreSQL remoto; la interfaz todavía se ejecuta localmente. No se desplegó en Vercel.

## Destino y conexión

- Proyecto: `pnaqjenemmfydetkpokk`, conexión del plugin `Nexora`.
- Organización: `nqcmrnakhvogvwapuojd`; región: `us-east-2`.
- URL pública del proyecto: `https://pnaqjenemmfydetkpokk.supabase.co`.
- Esquema del OS: `nexora`, con 47 tablas y migraciones de aplicación 1–7. Para verlas en Table Editor, seleccionar ese esquema.
- Rol PostgreSQL del servidor: `nexora_runtime`. Tiene acceso a las tablas de Nexora, sin superusuario, creación de bases/roles, bypass de RLS ni creación de tablas. Auditoría, custodia, eventos de documentos e idempotencia solo permiten lectura e inserción.
- `public.portal_companies` y `public.portal_memberships`, y su migración `portal_customer_access`, estaban presentes durante la preparación. Se conservaron sin cambios; no son parte del esquema del OS ni de estas pruebas.

Se generó una credencial aleatoria exclusiva para este servidor. Quedó guardada en `.env` y en su respaldo local `.local/runtime-credential.json`, ambos excluidos de Git. No se usó ni cambió la contraseña personal del usuario ni la contraseña del rol administrador `postgres`. Los archivos de migración locales no contienen contraseñas.

`server/postgres.ts` usa `pg` y un pool de hasta cinco conexiones. La conexión local actual es directa al host del proyecto, por TLS, con validación de certificado y nombre de servidor. El certificado público del proveedor está incluido en `server/certs/supabase-prod-ca-2021.crt`; `PGSSLROOTCERT` permite reemplazarlo cuando el proveedor rote la CA. No se deshabilitó la validación TLS.

Referencias: [conexión PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres), [roles PostgreSQL](https://supabase.com/docs/guides/database/postgres/roles), [certificado público de Supabase](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt).

## Inicio

```powershell
npm.cmd run build
npm.cmd run preview
```

Abrir `http://127.0.0.1:5173`. `preview:restart`, `preview:status` y `preview:stop` administran esa instancia. `npm start` usa la misma base y escucha por defecto en `127.0.0.1:3001`; `npm run dev` sirve React en 5173 y reenvía `/api` al servidor en 3001.

La primera pantalla pide organización, zona horaria, usuario y contraseña administradora. No hay cuentas predeterminadas en Supabase ni credenciales DEMO en la base remota. La cuenta administradora se crea desde esa pantalla por su responsable. `America/Asuncion` es la zona correspondiente a Paraguay si esa es la operación elegida.

`GET /api/health` comprueba la base y devuelve `database:"postgres"`. Una falla de conexión produce un error; no se sustituye silenciosamente por SQLite.

## Datos y seguridad

- No existía `.local/logistics.sqlite` al realizar la conexión. Por tanto, no había datos operativos locales que trasladar. `.local/demo.sqlite` se conserva separada y no se importa a Supabase.
- Las 47 tablas tienen RLS habilitado. El esquema no se expone al Data API ni concede acceso a `anon`/`authenticated`. La política del rol servidor permite operar en esas tablas; la organización y el permiso de cada usuario se verifican en la API del OS. Las cuentas CUSTOMER tienen sesiones separadas, cliente obligatorio y lecturas/exportaciones filtradas en servidor. Movimientos, comandos, comprobantes e historial de importación solo permiten lectura/inserción al rol runtime.
- Se conserva el acceso actual del OS: usuarios, contraseñas con scrypt y sesiones revocables almacenadas en PostgreSQL. Este cambio no migra usuarios a Supabase Auth ni agrega recuperación de contraseña.
- Las fotos se guardan como `bytea` en la tabla privada `nexora.evidence`, conservando firma, hash y permisos existentes. No se incorporó Supabase Storage en esta etapa; separar los archivos de la base sigue siendo un trabajo posterior.
- Las operaciones usan transacciones y bloqueo de comandos compartido entre servidores. Las reservas activas y las ventanas de vehículos/choferes también están protegidas por constraints PostgreSQL. La numeración interna `_sequence` reemplaza `rowid` para el orden y no se devuelve en la API.
- `bootstrap` agrupa sus consultas para evitar una consulta remota por envío, intento o devolución.

## DEMO local

```powershell
npm.cmd run seed:demo
npm.cmd run preview:demo
```

La DEMO usa SQLite en `http://127.0.0.1:5174`. `preview:demo:restart` y `preview:demo:stop` administran esa instancia. Sus usuarios ficticios permanecen únicamente en SQLite. Para desarrollar contra la DEMO con Vite, definir explícitamente `DATABASE_PROVIDER=sqlite` y `DATABASE_PATH=.local/demo.sqlite` en el entorno de esa sesión.

## Migraciones

La ampliación de inventario/portal/QuadMinds está aplicada mediante `20261015233518_inventory_customer_quad.sql` (versiones de aplicación 4–6) y `20261015234716_inventory_import_history.sql` (versión 7). Los archivos se crearon con CLI y se alinearon con las versiones efectivas del historial remoto. Ver [entrega y verificación vigente](ENTREGA_INVENTARIO_Y_QUADMINDS.md). El verificador de arranque exige 1–7.

La estructura se versionó con el CLI y se aplicó en el proyecto autorizado mediante el conector:

- `supabase/migrations/20261015223942_nexora_logistics.sql`: tablas, claves, exclusión de ventanas, índices, permisos y RLS.
- `supabase/migrations/20261015224016_nexora_runtime_login.sql`: habilita el rol; la contraseña se provisiona por separado. El registro remoto contiene su verificador SCRAM generado, nunca la contraseña original. El archivo local omite el verificador y no debe usarse para reprovisionar una credencial.

La migración previa `portal_customer_access` pertenece a otro trabajo y no se exportó ni modificó. Antes de administrar el historial completo con `db push`/`db pull`, reconciliar también esa migración con el responsable del portal. No resetear el proyecto remoto.

## Verificación

- `npm test`: suite SQLite/HTTP y adaptador PostgreSQL, sin modificar datos reales.
- `npm run test:postgres`: conexión y API reales contra Supabase, permisos del rol y circuito logístico sobre una organización temporal dentro de una transacción que termina en rollback. Incluye recepción parcial, idempotencia, reservas, conflicto de ventanas, documentos, despacho, fotos, entrega, devolución, cierre y aislamiento. No deja usuarios, envíos ni evidencias ficticios persistidos.
- `npm run build`: tipos y build de React/Vite.

Los resultados concretos están en `INFORME_QA.md`. Las pruebas no validan QuadMinds real, recepción automática de pedidos del cliente, inventario por SKU ni un despliegue de producción.

## Al preparar Vercel

Configurar la URI privada y la CA en el servidor del alojamiento, elegir una conexión compatible con su red (normalmente transaction pooler para funciones), ajustar origen/cookie HTTPS y probar el flujo allí. No copiar credenciales a variables `VITE_` ni al código del navegador. La conexión local directa validada no demuestra conectividad desde Vercel.
