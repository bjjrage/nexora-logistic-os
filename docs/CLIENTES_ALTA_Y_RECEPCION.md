# Alta de clientes y recepción de inventario

## Flujo para Nexora

1. Entrar con Administración de Nexora → **Clientes → Registrar cliente**. Registrar nombre comercial, razón social, RUC/identificación fiscal, persona de contacto, teléfono/WhatsApp, correo, dirección, ciudad y observaciones internas. Para **Universo**, que ya existe, usar **Abrir ficha → Editar ficha**, sin volver a darlo de alta.
2. Guardar la ficha. Se abre el cliente creado o editado y se muestran los datos faltantes. El nombre es obligatorio; los demás datos pueden completarse después, sin inventar valores.
3. Desde la ficha → **Importar catálogo**. El cliente queda seleccionado automáticamente. Descargar plantilla o cargar su Excel/CSV, validar y confirmar. Esto registra los productos y **no aumenta stock**.
4. Volver a la ficha → **Ir a recepción**. Se habilita cuando hay al menos un producto activo. Elegir el depósito físico **C1 · Central** (ya creado en la operación real), escanear SKU/código, revisar cantidad o series y confirmar. Aquí se registra el inventario físico.
5. Si el cliente necesita consultar su inventario, Administración habilita un acceso separado en **Accesos cliente**. Registrar una empresa cliente no crea una cuenta de usuario.

## Qué cambió

- Ficha ampliada con edición y listado con RUC, contacto, teléfono y estado de datos.
- El guardado conserva el ID del cliente y sus referencias a productos, existencias, envíos, pedidos y políticas de reparto.
- Las ediciones parciales por API conservan los campos omitidos; enviar un campo vacío lo borra expresamente.
- Correo y longitudes se validan. El mismo RUC no puede registrarse dos veces dentro de una empresa operadora; el mensaje identifica el RUC duplicado.
- La ficha abre catálogo o recepción manteniendo el cliente seleccionado, y permite volver a esa misma ficha.
- Después de importar, crear, editar, archivar o activar productos se actualiza el contador de catálogo de la ficha. No es necesario recargar toda la página para habilitar recepción.
- El alta selecciona la ficha por el ID devuelto por el servidor, no por coincidencia de nombre comercial.

## Privacidad, persistencia y activación

La ficha vive en `nexora.client_profiles`, enlazada al cliente existente mediante organización y cliente. Migración local SQLite `009_client_profiles.sql`; migración Supabase aplicada `20261017011024_client_profiles.sql`; versión operacional 9.

Administración y Coordinación logística pueden consultar/editar la ficha mediante el servidor del OS. Depósito recibe la lista básica de clientes, sin datos fiscales, correo ni observaciones. Chofer no recibe las fichas. No se concedió acceso a `anon`, `authenticated` ni al trabajador GPS. RLS está habilitado; el servidor existente tiene SELECT/INSERT/UPDATE y no DELETE sobre la tabla nueva. El servidor continúa verificando organización y rol.

La revisión automática rechazó inicialmente la migración. El usuario autorizó expresamente crear la tabla privada y el acceso del servidor de Nexora; después se aplicó correctamente. No queda pendiente esa autorización. No se cargaron datos de contacto ficticios ni registros de cliente QA en la organización real. Universo conserva sus datos para que el usuario complete la ficha real; Central se preservó.

El indicador de compatibilidad `clientProfilesEnabled` evita presentar un formulario de datos ampliados a una versión antigua del servidor que todavía no pudiera guardarlos.

## Verificación

- Suite OS: **93 pruebas aprobadas**. Tres pruebas nuevas cubren persistencia/relectura, actualización parcial, email y límites, idempotencia, duplicado de RUC, aislamiento y circuito cliente → catálogo → recepción.
- PostgreSQL/Supabase: prueba de ficha, JSON camelCase, actualización parcial, RLS y denegación de acceso público/GPS aprobada; fixtures eliminados por rollback completo.
- TypeScript y compilación Vite aprobados; OS 5173 y DEMO 5174 actualizados.
- Navegador sobre SQLite en memoria: editar ficha de Universo QA; registrar cliente nuevo; importar su CSV; comprobar cliente seleccionado; confirmar que archivar/activar actualiza recepción sin recargar; crear depósito QA y confirmar entrada de un SKU del cliente nuevo.
- Se comprobó además el alta de otro cliente con el mismo nombre comercial: abre la ficha nueva por su ID, sin tomar los datos ni el catálogo del registro anterior.
- Revisión de seguridad de Supabase: sin avisos de tablas por la migración nueva. Conserva un aviso preexistente de [protección de contraseñas filtradas de Supabase Auth](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), ajeno a este cambio; el OS usa su autenticación propia.

Las capturas contienen datos ficticios de prueba. La revisión visual cubre escritorio; no constituye una auditoría completa de accesibilidad ni de todos los tamaños de pantalla.

![Ficha completa y próximos pasos, QA](evidencias/clientes/01-ficha-completa-qa.png)

![Cliente nuevo registrado, QA](evidencias/clientes/02-cliente-nuevo-qa.png)

![Recepción del cliente nuevo confirmada, QA](evidencias/clientes/03-recepcion-cliente-nuevo-qa.png)

![Formulario de alta final, QA](evidencias/clientes/04-formulario-registro-final.png)
