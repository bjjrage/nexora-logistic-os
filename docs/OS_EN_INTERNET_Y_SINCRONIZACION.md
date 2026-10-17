# OS en Internet y sincronización

## Qué es cada servicio

- Código del OS: https://github.com/bjjrage/nexora-logistic-os (público por decisión del propietario).
- Carpeta de trabajo: `NEXORA LOGISTIC OS` en esta computadora.
- Servicio Railway del OS: `nexora-logistic`, conectado a `bjjrage/nexora-logistic-os`, rama `main`. Reutiliza el servicio anteriormente fallido de la web porque el plan no permite crear otro recurso. No tiene volumen: los datos residen en Supabase.
- OS publicado: https://nexora-logistic-production.up.railway.app. Verificado el 17/10/2026: pantalla de ingreso, `/api/ready` con base y GPS conectados, versión del commit y acceso anónimo denegado a operaciones. El ingreso con una cuenta real debe realizarlo su titular; no se copiaron contraseñas ni se crearon cuentas de prueba en producción.
- Web de marketing/seguimiento: repositorio `bjjrage/nexora-logistic` y hosting Netlify; es independiente del OS.
- Traccar, pasarela y sus bases/backups conservan sus servicios actuales.

## Configuración

`Dockerfile` fija Node 24.20.0, ejecuta pruebas y build, elimina dependencias de desarrollo y ejecuta como usuario sin privilegios. `.dockerignore` permite solo los archivos de código necesarios; excluye `.env`, backups y archivos locales. `deploy/railway-service.json` registra la configuración prevista del servicio, sin credenciales. Los ajustes se aplican mediante Railway; ese archivo es una referencia auditable, no un archivo que Railway aplique automáticamente.

Variables privadas en Railway: `DATABASE_URL` del rol limitado `nexora_runtime`, `TRACCAR_GATEWAY_SECRET` y configuración de pasarela. Nunca se publican en GitHub. El certificado CA público está incluido en el servidor. No se usa la contraseña de administración de Supabase.

Variables operativas: producción, escucha `0.0.0.0:8080`, PostgreSQL obligatorio, cookie segura y origen HTTPS exacto, un proxy confiable y una réplica. QuadMinds permanece deshabilitado hasta recibir el contrato y credenciales. La alta inicial está bloqueada en producción; se usan las cuentas existentes.

El propietario autorizó específicamente guardar la credencial limitada del OS y el secreto GPS en este servicio. Se habilitó salida IPv6 porque la conexión directa a Supabase la necesita; se mantiene TLS con validación del certificado. El estado operativo se verifica con readiness y versión, no solo con la existencia del dominio.

## Flujo para actualizar

1. Trabajar en la carpeta del OS; no copiar archivos sueltos al servidor.
2. Ejecutar pruebas y build. Revisar `git diff` y el escaneo de secretos antes de publicar.
3. Hacer commit y push a `main` (preferir rama y PR cuando haya más colaboradores).
4. GitHub Actions verifica pruebas, PostgreSQL aislado, navegador y construcción Docker. El código público no recibe datos ni credenciales reales en CI.
5. El servicio se conecta a `main` para autodeploy. En Railway debe habilitarse **Wait for CI** para impedir un despliegue cuando fallen las pruebas. El conector disponible no expone ese ajuste: no asumir que está activado sin comprobarlo en Settings → Source.
6. Ejecutar `npm run release:check`: exige árbol local limpio, HEAD igual a `origin/main`, versión online igual a HEAD y readiness correcto. Usa `/api/version` y `/api/ready`; no accede a datos del negocio.

GitHub sincroniza código, no configura automáticamente esta computadora. Si se actualiza desde otra máquina, usar `git pull --ff-only` con el árbol limpio, instalar el lockfile (`npm ci`) y reconstruir. No sobreescribir cambios locales ni hacer `reset --hard` para resolver diferencias.

## Datos y recuperación

El OS local de operación y el OS online apuntan a la misma base real: los cambios de clientes, stock, pedidos y rutas se reflejan en ambos. Para ensayar, usar la demo aislada o tests; no hacer recepciones ficticias en producción.

El monitor de Windows comprueba ahora la dirección online del OS. Los backups y ese monitor siguen dependiendo de esta PC y su sesión. Publicar el OS no convierte esas tareas en servicios externos. El envío de alertas por correo sigue pendiente de proveedor. Las migraciones se revisan y aplican explícitamente; el servidor verifica versiones y no migra producción automáticamente al arrancar.

Para rollback, seleccionar en Railway el despliegue anterior compatible con el esquema actual y comprobar readiness y versión. No restaurar una base sobre producción para revertir solo código.

## Repositorio público

El escaneo de los siete commits existentes no encontró credenciales reales: los dos avisos de Gitleaks corresponden a contraseñas ficticias de `tests/flow.test.ts`. Los archivos privados y backups están excluidos. Todo futuro commit y su historial serán visibles públicamente; mantener los secretos solo en configuración privada.
