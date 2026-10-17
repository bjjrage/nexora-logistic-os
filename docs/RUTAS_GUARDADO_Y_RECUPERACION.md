# Guardado y recuperación de rutas

## Hallazgo

La ruta real **Ruta 1** ya estaba guardada en Supabase en estado **DRAFT / Borrador**. No se creó otra ruta en la operación real durante la reparación.

La captura mostraba los campos deshabilitados mientras la pantalla esperaba una solicitud. La UI mantenía el estado pendiente hasta finalizar también la relectura completa de datos: el callback que mostraba la ruta y el aviso de éxito se ejecutaban después de esa consulta. Además, las solicitudes del frontend no tenían límite de espera. La consulta de comprobación posterior respondió normalmente, por lo que no se afirma que hubiera una caída persistente del servidor.

## Corrección

- La respuesta confirmada del guardado muestra inmediatamente la ruta devuelta por el servidor, abre su preparación y cierra el formulario de alta.
- Una falla posterior de actualización se comunica como **guardado confirmado, vista sin actualizar**, sin marcar el guardado como fallido ni volver a enviarlo.
- Las solicitudes y la lectura JSON tienen un límite de 30 segundos. Un timeout durante una escritura indica que puede haberse completado y pide actualizar antes de reintentar; se conserva la clave de idempotencia del intento sin confirmación.
- El formulario indica **Guardando ruta…** y muestra el error cerca de sus campos. Se valida que el fin sea posterior al inicio y se leen las fechas efectivas de los controles al enviar.
- La vista Rutas ofrece **Actualizar**; una consulta correcta elimina el aviso de recuperación. La ruta confirmada conserva su ID al pasar de la respuesta de creación a la lista consultada.

## Verificación del flujo

| Límite | Resultado | Evidencia |
| --- | --- | --- |
| Formulario → API | Correcto | Alta QA con chofer, vehículo y las mismas fechas de la captura |
| API → datos | Correcto | Una ruta QA guardada en SQLite en memoria, DRAFT y versión 1 |
| Guardado → actualización fallida | Recuperado | Se simuló un 503 de bootstrap después del POST confirmado; formulario cerrado y ruta visible |
| Actualizar → respuesta → UI | Correcto | Aviso eliminado, ruta consultada y una sola ruta QA conservada |
| Operación real | Preservada | Ruta 1 existente leída de Supabase; no se repitió su alta |

Suite OS **97/97** aprobada, con cuatro pruebas nuevas del cliente HTTP: cancelación de conexiones pendientes, timeout de lectura JSON, recuperación posterior, conservación de errores y respuesta inválida. Compilación TypeScript/Vite y navegador aprobados. La verificación de navegador usa datos ficticios en memoria y no credenciales de la operación real.

La revisión automática frenó inicialmente el guardado QA por temor a duplicar Ruta 1. Se verificó el servidor temporal, SQLite en memoria y cero rutas de prueba; después se permitió el guardado aislado. No quedó pendiente una autorización para esta corrección.

## Uso

Recargar el OS con **Ctrl + F5**, abrir **Rutas** y seleccionar **Ruta 1**, que sigue como borrador. Para consultar sin volver a guardar, usar **Actualizar**.

![Ruta guardada y aviso de consulta fallida, QA](evidencias/rutas/01-guardada-con-fallo-actualizacion-qa.png)

![Ruta recuperada después de Actualizar, QA](evidencias/rutas/02-ruta-recuperada-qa.png)
