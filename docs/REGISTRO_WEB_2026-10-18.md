# Registro individual desde la web — 18/10/2026

La web pública permite registrarse en https://nexoralogisticpy.netlify.app/registro/. Google regresa a /clientes/, una URL que ya estaba autorizada; /seguimiento/ conserva el rastreo sin login. No se cambiaron las credenciales de Google ni el login del OS.

## Alta

Tras verificar Google se completan nombre, teléfono y consentimiento. `public.register_individual_customer(text,text,boolean)` es una envoltura SECURITY INVOKER de una función privada limitada en `website_private`. Comprueba auth.uid(), correo confirmado e identidad Google en Auth; no utiliza metadatos editables para asignar permisos.

La función genera un cliente nuevo, ficha de contacto, circuito NEXORA y un vínculo de portal exclusivamente para ese cliente. No acepta IDs de empresa/organización/cliente ni correo suministrados por el navegador. La organización se configura en la tabla privada registration_settings. Las cuentas corporativas administradas y las suspendidas no pueden sustituir su vínculo mediante el registro. Repetir el alta conserva los identificadores.

La migración aplicada es `20261018225145_individual_customer_registration.sql`; no modifica las versiones 1–14 del esquema operativo. No publicarla en el repositorio de la landing. La tabla pública individual_customers tiene RLS; authenticated solo puede leer las columnas de su propio registro y no tiene escritura directa. Los datos de contacto también están en la ficha normal de Clientes del OS.

## Solicitudes y códigos

La cuenta individual inserta solicitudes en portal_shipping_requests, con el aislamiento por membresía activa que ya existía. Desde OS se revisan en Inventario → Accesos de cliente → Conectar con Google → Solicitudes del portal. El endpoint existente de aceptación crea el envío y sus bultos de forma transaccional.

La web muestra las solicitudes propias. Al actualizar, una solicitud aceptada muestra los códigos de los bultos creados y sus enlaces de seguimiento. Una solicitud pendiente no es un envío confirmado ni tiene código de tracking. Los datos de destinatario y direcciones se guardan para coordinar el servicio; no son públicos en la consulta de tracking.

El envío automático de códigos por correo o WhatsApp NO está implementado. No se incorporó un proveedor ni se enviaron mensajes a clientes. La ficha individual no crea por sí sola credenciales de acceso al OS privado.

## Verificación

- Web: 22 pruebas aprobadas y build de 17 páginas.
- `web-publica/.local/registration-isolation.test.mjs`: 8 pruebas con PostgreSQL aislado y migraciones reales. Alta verificada, repetición, cliente nuevo independiente, aislamiento A/B, solicitudes ajenas rechazadas, suspensión, cuenta administrada, consentimiento y validación.
- `supabase/tests/individual_registration.sql`: registro → solicitud → consultas de la cola del OS en Supabase real, con rollback. Se verificaron además los privilegios de lectura del runtime. El conector no permite asumir el rol nexora_runtime; no se presenta como una prueba HTTP autenticada del OS.
- Navegador: Google vuelve al formulario correcto; la web publicada reconoce la identidad real y permite completar el contacto. No se inventaron teléfono ni consentimiento para registrar una persona real durante el ensayo.
- Sin registros temporales conservados. No se modificaron rutas, teléfonos, posiciones GPS ni Universo.

El asesor de seguridad muestra INFO por RLS sin políticas en registration_settings: es una tabla privada intencionalmente denegada a clientes y accesible desde la función privilegiada limitada. La advertencia previa de protección de contraseñas filtradas permanece; este registro ofrece únicamente Google.

Frontend publicado en GitHub: bjjrage/nexora-logistic, commit 38c789e. La web y el registro se publicaron mediante Netlify Drop; el backend del OS conserva su despliegue independiente.
