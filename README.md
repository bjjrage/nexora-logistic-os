# OS de logística — desarrollo local

OS en Vercel: https://nexora-logistic-os.vercel.app · [Arquitectura y despliegue](docs/VERCEL.md). API en Railway y datos en Supabase.

> Estado actualizado al 17/10/2026: ver [cierre de fixes y pendientes](docs/CIERRE_FIXES_CHECKLIST_2026-10-17.md). Migraciones 1–13; pruebas locales y CI ampliadas a PostgreSQL aislado y navegador. QuadMinds queda pendiente de credenciales.

Nexora OS gestiona clientes, envíos, recepción, rutas, flota, entregas e incidencias. El servidor local ya usa PostgreSQL de Supabase mediante una conexión privada; SQLite queda disponible para DEMO y pruebas. Ver [configuración de Supabase](docs/SUPABASE.md). Esto no completa el alcance del Prompt Maestro V0.1 ni constituye un despliegue de producción.

Código del OS en el [repositorio privado](https://github.com/bjjrage/nexora-logistic-os). La web pública se mantiene en su repositorio separado. Ver [fixes y verificaciones del 17-10-2026](docs/FIXES_VERIFICADOS_2026-10-17.md) y el [manual maestro](MANUAL_MAESTRO_NEXORA_OS.html).

La ampliación del cliente incorpora inventario por cantidad/serie, importación de catálogos CSV/XLSX, recepción por escaneo, pedidos diarios, portal privado y preparación de integración QuadMinds con foto/firma. Consultá la [entrega y guía operativa](docs/ENTREGA_INVENTARIO_Y_QUADMINDS.md), el [contrato de inventario](docs/INVENTORY_API.md) y la [auditoría independiente](docs/AUDITORIA_IMPLEMENTACION.md). Cuenta QuadMinds, pruebas de celular, programación de sync y publicación del negocio siguen pendientes de sus accesos reales.

La interfaz actual aplica la identidad Nexora facilitada en los recursos del workspace, según el pedido posterior del usuario. El [informe del rediseño](docs/REDISENO_UI.md) registra la compactación medida, capturas y comprobaciones de navegador. El OS local se revisa en `http://127.0.0.1:5173`.

## Requisitos e instalación

- Node.js **24.20.0 o posterior** y npm. El proyecto declara `engines.node >=24.20.0`.
- PostgreSQL se conecta mediante `pg`; `node:sqlite` (`DatabaseSync`), incluido en Node, se conserva para DEMO y pruebas.
- Vite sirve la interfaz; consultá la [guía oficial de Vite](https://vite.dev/guide/).

Desde la raíz del proyecto, revisá versiones e instalá según el lockfile:

```powershell
node --version
npm --version
npm ci --cache .local/npm-cache
```

## Desarrollo

Para abrir el OS conectado a Supabase y mantenerlo iniciado en segundo plano:

```powershell
npm run build
npm run preview
```

Abrí [la aplicación local](http://127.0.0.1:5173). Esta instancia usa la base seleccionada en `.env`, actualmente Supabase PostgreSQL, y permanece iniciada después de terminar el comando. `npm run preview:status` consulta su estado; después de cambiar código, ejecutá `npm run build` y `npm run preview:restart`. `npm run preview:stop` detiene únicamente la instancia administrada por este proyecto. Los logs quedan en `.local/preview.log` y `.local/preview-error.log`. No ejecutar esta vista previa y Vite simultáneamente en 5173. La DEMO se abre separadamente con `npm run preview:demo` en 5174.

Para desarrollar con recarga automática:

```powershell
npm run dev
```

El comando inicia la API en `http://127.0.0.1:3001` y Vite en `http://127.0.0.1:5173`; abrí `http://127.0.0.1:5173`. Vite reenvía `/api` a la API local. Ambos servidores escuchan solo en loopback. El script usa `node --watch` para la API y `vite --configLoader native` para la interfaz.

Dentro del sandbox de Codex, Vite/esbuild puede necesitar permiso de lectura en directorios ancestros del workspace. Si el sandbox bloquea esos accesos, el arranque de desarrollo requiere que el permiso solicitado sea aprobado. Fuera de ese sandbox se ejecuta el comando normalmente.

Si el entorno de desarrollo no puede conceder esos accesos, usá el servidor local único después de compilar:

```powershell
npm run build
```

```powershell
npm start
```

El servidor escucha en `http://127.0.0.1:3001` y sirve `dist/` si `dist/index.html` existe. El build ejecuta primero `tsc --noEmit` y después Vite.

## Base de datos y primera configuración

El servidor carga `.env`, actualmente con `DATABASE_PROVIDER=postgres`, la URI privada `DATABASE_URL` y `DATABASE_SCHEMA=nexora`. Las credenciales quedan en el servidor. El esquema tiene 47 tablas privadas y RLS habilitado, con migraciones 1–7; la importación de catálogo se apoya en tablas existentes y no agrega DDL. La guía [SUPABASE.md](docs/SUPABASE.md) explica conexión, permisos y limitaciones. No se encontraron datos operativos locales para importar; la DEMO no se copió a la nube.

Solo con `DATABASE_PROVIDER=sqlite` se utiliza `DATABASE_PATH` o `.local/logistics.sqlite`. `.env`, `.local/` y los archivos SQLite están excluidos de Git. Las pruebas reales de PostgreSQL terminan en rollback; no usar datos operativos para demostraciones.

En una base vacía, la primera pantalla pide nombre de organización, nombre de usuario, contraseña y una zona horaria explícita. Elegí una zona IANA que corresponda a la operación. La pantalla muestra `America/Asuncion` como ejemplo; usala solo si es la zona correcta. La contraseña inicial requiere al menos 12 caracteres. No hay credenciales predeterminadas: el administrador se crea durante el setup.

## Datos ficticios para demostración

El seed crea únicamente `.local/demo.sqlite`. Si esa base ya existe, el script la conserva sin cambios. No modifica `.local/logistics.sqlite` ni debe usarse para operar.
La base operacional `.local/logistics.sqlite` no fue sembrada; el seed solo crea datos ficticios para demostración.

```powershell
npm run seed:demo
```

Para abrir la base de demostración en otra instancia de desarrollo, ejecutá estas líneas en la misma sesión de PowerShell:

```powershell
$env:DATABASE_PATH = ".local/demo.sqlite"
$env:DATABASE_PROVIDER = "sqlite"
```

```powershell
npm run dev
```

El seed imprime las credenciales ficticias. Administrador DEMO: `demo.admin` / `Demo-Logistica-2026!`. Chofer DEMO: `demo.chofer` / `Demo-Chofer-2026!`. No reutilices esas credenciales fuera de la base DEMO. La organización, las direcciones, el cliente y el envío son ficticios; el fixture contiene cinco bultos, recibe cuatro y asigna esos cuatro a una ruta.

Para volver a la base normal, cerrá ese servidor y en una sesión nueva ejecutá `npm run dev` sin definir `DATABASE_PATH`.

## Flujo principal en la interfaz

### Catálogo y recepción

En **Inventario**, las acciones de catálogo, recepción, traslado y ajuste están separadas. La recepción suma existencias solo después de confirmar el lote; importar un catálogo actualiza productos, nunca saldos ni movimientos.

1. En **Inventario → Importar catálogo**, elegí el cliente, descargá la plantilla CSV o cargá un `.csv`/`.xlsx`, y validá el archivo. Si falta seguimiento en filas nuevas, seleccioná explícitamente **Por cantidad** o **Por serie** para ese lote. Revisá altas, cambios, filas sin cambios, errores y columnas omitidas antes de confirmar la importación.
2. En **Recepción por SKU**, elegí cliente y ubicación, y escaneá el SKU o código de barras. Cada lectura de un producto por cantidad suma una unidad al lote; un serial requiere una lectura por unidad. Revisá la recepción pendiente y seleccioná **Confirmar recepción** para registrar stock. Si el código todavía no está en el catálogo, la pantalla permite abrir la importación y volver a intentar.
3. Los lectores USB que emulan teclado pueden enviar el código seguido de Enter. Se verificó la captura con Enter; no se probó un lector físico del cliente. La cámara depende del soporte BarcodeDetector del navegador.

Las tarjetas KPI muestran el total exacto por estado y funcionan como filtros al seleccionarlas. El selector de cliente y la búsqueda refinan la tabla de existencias.

1. Registrá un cliente y un envío con referencia, origen, destino, receptor, cantidad de bultos, medidas por bulto conocidas y política de prueba de entrega. El sistema genera un código único para cada bulto.
2. En Recepción, seleccioná los códigos que llegaron e ingresá el lugar observado. La recepción es parcial si algunos bultos no llegaron; el lugar ingresado no consulta GPS.
3. Registrá chofer y vehículo. En Flota podés registrar documentos e inspecciones, renovar documentos del chofer, programar mantenimiento por fecha o kilometraje y completar trabajos o defectos con nota y foto privada. Operaciones define qué documentos impiden el despacho al vencer.
4. Creá una ruta con su chofer, vehículo y ventana horaria; asigná bultos recibidos, reordená manualmente las paradas, marcá la ruta lista y escaneá la carga que sale del depósito.
5. Antes de despachar, registrá una inspección dentro de la ventana de la ruta. El servidor también verifica las medidas por tramo, carga reconciliada, disponibilidad, defectos críticos, documentos impeditivos vencidos y mantenimiento vencido.
6. Durante la ruta, registrá los retiros directos cuando correspondan y el resultado de entrega por bulto. Una política `RECEIVER_PHOTO` exige evidencia fotográfica guardada para cada bulto entregado. Los intentos fallidos requieren motivo y próxima acción.
7. Una devolución requiere autorizar el retorno, recibirlo en depósito con foto y después registrar su entrega al remitente con receptor y una foto diferente. El servidor comprueba el contenido de las dos imágenes. Una devolución pendiente impide asignar el bulto a otra ruta. Las recepciones antiguas sin foto requieren subsanación por Operaciones, con nota y fecha actual, conservando el historial anterior.
8. Cerrá la ruta cuando todas sus paradas estén resueltas y no quede ninguna asignación activa.

Las rutas solo se despachan dentro de su ventana programada. El orden puede editarse manualmente o importarse desde una ruta publicada de QuadMinds. La optimización se realiza en QuadMinds; su activación real requiere la cuenta del negocio.

## Verificación registrada

La validación más reciente registró:

- `npm test`: **105 PASS, 0 FAIL**. Suite SQLite/HTTP, catálogo CSV/XLSX, inventario, pedidos, portal, rutas, circuito GPS explícito, identidad del cliente y carga mixta de códigos/series.
- `npm run test:postgres`: **10 PASS, 0 FAIL** en la corrida del 17-10. Tras el fix adicional de carga, los dos circuitos afectados se revalidaron **2/2**. Los fixtures de negocio terminan en rollback; se ejecutan en serie. Ver el informe para el alcance exacto.
- `npm run build`: **PASS**, incluida la revalidación final de tipos.
- `npm run check:migrations`: **PASS**. CI ejecuta secretos, migraciones, suite local y build. La base real se verifica por separado con su configuración privada.

Estos resultados validan el núcleo probado y su conexión real con Supabase. La aceptación física del celular, la cuenta QuadMinds y el despliegue remoto del OS siguen pendientes. El [informe de fixes](docs/FIXES_VERIFICADOS_2026-10-17.md) registra los límites de esta corrida.

## Alcance pendiente y producción

La integración de lectura con QuadMinds está preparada y deshabilitada por defecto: conector de servidor, vinculación de vehículos, última posición persistente y consulta en Tracking con antigüedad/errores y enlace al mapa. Falta recibir el endpoint, contrato de respuesta y credenciales, y probar un vehículo real. Sin configuración responde `INTEGRATION_NOT_CONFIGURED`; configuración presente no equivale a conexión validada. Ver [activación de QuadMinds](docs/QUADMINDS.md) y `.env.example`. No se muestran posiciones simuladas.

Quedan fuera de esta entrega: impresión de etiquetas, replanificación en curso, cola offline propia, portal de destinatario, finanzas y rendiciones. Inventario, importación de pedidos y portal del cliente están implementados; la cámara depende del soporte BarcodeDetector del navegador. GPS y reparto mediante QuadMinds requieren activar y verificar la cuenta y los celulares reales. El sistema genera códigos de bulto; todavía no imprime etiquetas.

La base Supabase está preparada y conectada; el servidor y la interfaz todavía se ejecutan localmente. La publicación en Vercel, la integración real con QuadMinds y la aceptación operativa siguen pendientes. Se conservan los usuarios/sesiones propios del OS y las fotos como datos binarios privados en PostgreSQL; Supabase Auth, recuperación de contraseña y Supabase Storage no se incorporaron en esta etapa. Ver `docs/SUPABASE.md`.
