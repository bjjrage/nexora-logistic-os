# Continuidad de Nexora Logistic OS

> **Corrección vigente — creación de rutas:** Ruta 1 ya existía en Supabase como borrador; no repetir su alta. Se corrigió el estado pendiente que incluía la relectura posterior al POST: ahora se confirma y muestra la ruta guardada antes de esa consulta, con recuperación explícita si falla. Cliente HTTP con límite de 30 s, mensaje de guardado incierto en timeout de escritura y botón Actualizar en Rutas. Se preserva idempotencia. Suite 97/97, build y navegador con fallo 503 simulado y una sola ruta QA aprobados. Sin cambio de esquema ni nuevas rutas en la operación real. Ver [RUTAS_GUARDADO_Y_RECUPERACION.md](RUTAS_GUARDADO_Y_RECUPERACION.md).

> **Actualización vigente — ficha completa de clientes:** el alta ya guarda razón social, RUC, contacto, teléfono, correo, dirección, ciudad y observaciones. Universo se completa desde su ficha existente; no duplicarlo ni inventar sus datos. La ficha conecta **catálogo → recepción** con el cliente seleccionado y cuenta de productos actualizada. Se aplicó `20261017011024_client_profiles.sql` en Supabase Nexora después de autorización explícita del usuario; versión operacional 9, tabla privada con RLS y sin acceso público/GPS. El registro nuevo se selecciona por ID devuelto por el servidor. Suite 93/93, prueba PostgreSQL de ficha 1/1 con rollback y recorrido de navegador aprobados. Ver [CLIENTES_ALTA_Y_RECEPCION.md](CLIENTES_ALTA_Y_RECEPCION.md). El depósito real C1 · Central y las identidades existentes se preservaron.

> **Corrección posterior de la cuenta administradora:** quedó mal su nombre visible, porque el alta inicial copiaba el nombre de la organización al usuario. Se corrigió la cuenta real de Universo a **Administración Nexora**, con auditoría, conservando ID, usuario de acceso, contraseña, rol, cliente Universo y depósitos. El usuario ya creó **C1 · Central**; no tratarlo como prueba ni borrarlo. El alta inicial ahora usa Administración como nombre de cuenta; el pie de la UI muestra la identidad actualizada de bootstrap. Suite 90/90 y build aprobados; OS 5173 reiniciado. La prueba opcional de alta QA no fue autorizada ni ejecutada en navegador.

> **Actualización vigente — jerarquía operativa:** el usuario ya realizó el alta real y existen Administración, Depósito, Chofer, cliente Universo, vehículo y teléfono vinculados. La organización había quedado nombrada Universo por error de alta; se corrigió únicamente su nombre visible a **Nexora Logistic**, con auditoría y preservando identidad, personal, cliente y GPS. **No volver a limpiar estos datos reales.** Clientes tiene edición; Empresa y equipo separa personal interno; Inventario ofrece Depósitos y sectores y un paso inicial claro cuando falta el lugar físico. Depósito ve su trabajo y Chofer ve Mis rutas dentro de Nexora. Falta cargar el depósito físico real y el catálogo; no se creó un depósito ficticio en producción. Ver [JERARQUIA_OPERATIVA_2026-10-16.md](JERARQUIA_OPERATIVA_2026-10-16.md). Suite OS 90/90, prueba PostgreSQL adicional 1/1 con rollback, compilación y recepción de prueba en navegador aprobadas. OS 5173 reiniciado con la versión final. Esta nota prevalece sobre las referencias históricas a cero usuarios o alta inicial pendiente.

> Corrección posterior del formulario de asignación: los alias SQL camelCase de Traccar y QuadMinds necesitan comillas en PostgreSQL. Antes, la vinculación se guardaba, pero la UI recibía `vehicleid`/`deviceid` y no la mostraba. Se corrigieron también los alias de rutas y circuitos. Ahora se confirma el guardado junto al botón y se recupera la selección al recargar. Tests específicos 17/17, PostgreSQL 2/2 con rollback, build y prueba de navegador completos. Sin cambios de esquema ni de la asignación real existente.

> Ajuste de interfaz posterior: Tracking separa **Mapa**, **Mi celular**, **Universo · QuadMinds** y **Rutas**. QuadMinds abre cuatro acciones (enviar pedido, vincular ruta, actualizar entregas, consultar comprobantes), sin formularios simultáneos. Mi celular separa teléfonos, vehículos, clientes y rutas; cada teléfono tiene una guía de conexión con copia de identificador/URL. Se verificó navegación en la DEMO aislada, sin cambios de backend ni datos operativos.

> Actualización posterior del 16/10/2026: Traccar ya está desplegado en Railway Nexora e integrado al OS y al seguimiento web de Netlify. Universo conserva QuadMinds; los otros clientes requieren circuito Nexora y rutas Traccar explícitos. Ver [TRACCAR_OPERACION.md](TRACCAR_OPERACION.md) para estado vigente, configuración del teléfono, infraestructura, copias, pruebas y pendientes. Esta actualización prevalece sobre los estados históricos que siguen.

La suite final tiene 87 pruebas OS aprobadas, 17 web y una prueba PostgreSQL real aprobada; el transporte completo se verificó con posiciones simuladas sobre Traccar real y el mapa se comprobó en la web publicada. Primera copia diaria ejecutada a las 03:00 de Paraguay. Se retiraron todos los fixtures de la base operativa con autorización: cero usuarios/envíos/dispositivos/posiciones; el OS operativo en puerto 5173 solicita el alta inicial real. La DEMO en 5174 sigue separada. Quedan el registro del teléfono físico y el recorrido de aceptación; la API real de QuadMinds requiere sus credenciales. El OS sigue alojado localmente. No publicar `.env`, `.local`, migraciones privadas ni el código interno en el repositorio público.

Fecha: 16 de octubre de 2026, zona America/Asuncion. Este archivo permite continuar el proyecto en un chat nuevo. El usuario abandona el chat anterior porque un prompt ya respondido volvió a quedar en cola y no puede eliminarlo; reinició la aplicación y la computadora repetidamente sin resolverlo. No repetir aquel prompt ni rehacer la implementación. El último pedido fue entregar únicamente este archivo Markdown, sin crear otro chat ni leerle el contenido en voz alta.

## Punto de partida

Workspace: `C:\Users\User\Desktop\PORYECTOS\NEXORA LOGISTIC OS`. El proyecto local no tiene repositorio Git; no hay rama, commits ni PR de esta implementación. Todo el código está en disco. No tocar el proyecto vecino LAW & ORDER OS.

Stack: React 19, Vite 7, TypeScript, Express 5 y Node 24.20 o posterior. PostgreSQL de Supabase es la base operacional; SQLite se conserva para DEMO y tests. En PowerShell usar `npm.cmd`, porque `npm.ps1` está bloqueado por la política de ejecución.

Este handoff resume decisiones, implementación, comprobaciones y pendientes. No es una exportación literal del historial. Los documentos de entrega y QA contienen más detalle y evidencia. Algunas secciones antiguas conservan estados ya superados: priorizar la actualización más reciente.

## Encargo del negocio

Nexora prestará servicios logísticos a una empresa grande de electrodomésticos. Los requisitos transmitidos por el usuario son:

1. Almacenar mercadería en un depósito/local.
2. Registrar entradas y salidas con códigos de barras.
3. Permitir al cliente consultar su inventario.
4. Recibir sus pedidos diarios y preparar el reparto. Aclarar si envía pedidos para optimizar o una secuencia de ruta que debe respetarse.
5. GPS por celular.
6. Uso obligatorio de la app de QuadMinds para ver la ruta y cerrar la entrega con foto y firma.

El usuario rechaza cargar productos uno por uno. El proceso implementado es **Excel/CSV empresarial → catálogo por cliente → escaneo de recepción física → confirmación de entrada → reservas, carga y movimientos**. Importar catálogo no crea stock. El código de modelo identifica el producto; una serie individual identifica una unidad cuando corresponda.

## Preferencias y autorizaciones

- Hablar en español claro, breve y por pasos. El usuario no es técnico y se frustra con explicaciones extensas y confirmaciones repetidas.
- La UI debe evitar paredes de texto, scroll interminable y formularios permanentes. Una tarea visible a la vez, acciones claras, KPI interactivos y detalles técnicos secundarios.
- Identidad visual Nexora, tarjetas con bordes y respuesta de hover perceptible. Conservar la marca y recursos existentes.
- Autorizó implementar el alcance completo y trabajar autónomamente. Solicitó subagentes Luna con razonamiento xhigh cuando haya tareas delegables, y un auditor independiente. Respetar las instrucciones y disponibilidad del nuevo entorno; los agentes del chat anterior no se transfieren automáticamente.
- El negocio debe tener cuentas y facturación separadas. No publicar ni contratar en cuentas personales, ni crear servicios pagos por inferencia. No hay autorización para enviar mensajes a terceros.
- Guardar credenciales solo en configuración privada. No imprimir `.env`, contraseñas, URI de base ni `.local/runtime-credential.json`. Los datos DEMO nunca se copian a producción.

## Implementación terminada

### Catálogo e inventario

- Importación CSV/XLSX, plantilla descargable, preview y confirmación atómica por cliente/SKU. Conserva ceros iniciales, IDs y seguimiento de productos existentes. Actualiza productos sin tocar saldos, series, pedidos ni movimientos.
- Preview informa altas, cambios, filas sin cambios, errores y columnas omitidas. Columnas ERP desconocidas como Marca o Stock se ignoran explícitamente. Seguimiento por lote opcional y explícito para SKU nuevos sin tipo en archivo.
- CSV con coma, punto y coma o tabulación, BOM, campos entrecomillados y multilínea. XLSX conserva formato visible de ceros; fórmulas bloqueadas. Límite 5 MiB, 10.000 filas de producto y 32 columnas; controles de expansión ZIP.
- Conflictos invalidan el lote completo. Importación transaccional, idempotente y auditada; SQL por bloques de 200. SheetJS CE 0.20.3 está instalado desde el CDN oficial y se ejecuta solo en servidor.
- Snapshot de inventario agrega `totals` y `clientTotals` exactos para disponible, reservado, vehículo y cuarentena, calculados sobre toda la base autorizada. La tabla puede limitar series a 1.000 y movimientos a 500; el resumen y el CSV de existencias no se truncan por esos límites.
- Recepción reconoce SKU/barcode del catálogo, acumula lecturas y confirma un SKU por operación. Bloquea mezclar cliente/producto con cesta pendiente. Para productos serializados se reconoce primero el modelo y luego se leen las series nuevas. No aumenta stock con Enter: requiere confirmar recepción.
- Lectores USB/Bluetooth en modo teclado HID con Enter no dependen de BarcodeDetector. El aviso de soporte limitado pertenece a la cámara y queda en ayuda secundaria. Foco del lector al habilitar recepción y después de confirmar, sin enviar accidentalmente el formulario. Hardware físico aún no probado.
- Traslados y ajustes autorizados con motivo; estados separados, ledger de movimientos y trazabilidad. Exportación CSV protege contra fórmulas sin modificar el dato original almacenado.

### Pedidos y entrega

- Importación CSV de pedidos con validación local/servidor, historial, errores por fila, transacción e idempotencia. Importar pedidos tampoco aumenta stock.
- Reserva completa o rechazada, un bulto por unidad, preparación y carga por escaneo. Edición/cancelación con motivo antes de reservar; bloqueo posterior de cambios incompatibles con custodia.
- Controles de ruta, capacidad por tramo, carga reconciliada, inspecciones, documentación impeditiva y mantenimiento. Retornos autorizados, recepción con evidencia, cuarentena y liberación tras inspección.
- Integración QuadMinds preparada: cola persistente de órdenes, dimensiones/ventanas, vinculación/importación de rutas publicadas, resultados, descarga privada de foto/firma y webhook HMAC. La entrega de inventario exige comprobantes válidos distintos. Las pruebas usan proveedor fixture; integración real deshabilitada.

### Interfaz y portal

- Inventario abre solo stock, búsqueda, filtros y cuatro KPI que filtran. Recepción, traslado, ajuste, catálogo, movimientos y configuración son vistas separadas. Productos/ubicaciones manuales quedan como tareas secundarias en modal.
- Listas principales y previews paginadas de 20; tabla de existencias con altura máxima. Estados en español, referencia de pedido en lugar de UUID. Modales con Escape, trampa y restauración de foco y scroll.
- Pedidos abre lista/búsqueda; importación, historial y retornos separados; preparación/edición en modal.
- Flota separada en vehículos, choferes, documentos, inspecciones y mantenimiento, con formularios cerrados hasta solicitarlos.
- Rutas abre lista sin seleccionar automáticamente ni mostrar alta permanente; búsqueda/filtro/paginación. Detalle por tareas de preparación, paradas, carga y control. Referencias humanas y códigos físicos secundarios.
- Clientes y Tracking también reducen formularios/secciones simultáneas. Inicio orienta a Inventario/Pedidos. Se mantiene navegación móvil.
- **Accesos cliente** crea/revoca cuentas CUSTOMER vinculadas a una empresa. Ese usuario entra por el mismo login y ve su portal de consulta: solo su mercadería, pedidos, movimientos, CSV y comprobantes. No modifica stock ni ve datos de otras empresas, flota ni usuarios internos.

## Infraestructura y ejecución

Supabase del negocio: proyecto `pnaqjenemmfydetkpokk`, esquema privado `nexora`, rol `nexora_runtime`. Durante esta entrega se verificaron 47 tablas privadas con RLS y migraciones de aplicación 1–7. El catálogo no añadió DDL. La conexión privada está en `.env`; no pedir al usuario que pegue contraseñas en chat.

Previews independientes, reiniciadas tras el último build del trabajo de UI:

| Instancia | URL | Base |
|---|---|---|
| Operacional local | http://127.0.0.1:5173 | Supabase PostgreSQL |
| DEMO local | http://127.0.0.1:5174 | `.local/demo.sqlite` |

Su estado actual debe consultarse si el usuario quiere abrirlas; la computadora fue reiniciada durante el problema del chat. No asumir que un proceso anterior sigue activo. En base operacional vacía falta configurar organización, zona y administrador real; no se creó un administrador ficticio.

```powershell
npm.cmd run preview:status
npm.cmd run preview
npm.cmd run preview:demo
```

Tras cambiar código, compilar y reiniciar únicamente la instancia necesaria:

```powershell
npm.cmd run build
npm.cmd run preview:restart
npm.cmd run preview:demo:restart
```

No ejecutar todos los comandos por rutina ni sembrar otra vez la DEMO. El seed conserva una base existente. Los scripts temporales `.local/simplify-*.mjs`, `repair-ui-syntax.mjs`, `finish-ui.mjs` y otros scripts de transformación ya se ejecutaron; algunos no son idempotentes: no volver a ejecutarlos.

Vercel: preparados `api/index.ts`, `vercel.json` y `.vercelignore`, sin despliegue del OS en la cuenta personal. Falta destino/cuenta del negocio. No se creó Railway ni otro servicio pago. No se necesita decidirlo nuevamente hasta conocer los requisitos del alojamiento y trabajo en segundo plano.

## Verificación ya realizada

- Suite local: **81 PASS, 0 FAIL, 0 omitidas**. Build final de esta entrega TypeScript + Vite PASS; JS 448.20 kB, gzip 125.40; CSS 47.51 kB. No repetir toda la suite sin cambios o una incertidumbre concreta.
- PostgreSQL: cinco casos aprobados entre distintas corridas; el último de catálogo masivo pasó en 22.43 s con rollback y ausencia del fixture al terminar. No afirmar que se volvió a ejecutar toda la suite PostgreSQL conjuntamente.
- Auditor independiente: seis pruebas HTTP adicionales de catálogo, permisos, aislamiento, concurrencia/idempotencia, ceros XLSX, fórmulas, conflictos, rollback y exportación CSV. Sin P1/P2 abiertos en el alcance revisado; navegador comprobado por el agente principal.
- Browser DEMO: importó tres SKU `007001`–`007003`, barcodes con ceros y columnas Marca/Stock omitidas. El Stock 900 del archivo no creó existencias. Recepción de dos Microondas y una Cocina agregó exactamente tres unidades. Resultado final de ese fixture: 5 disponibles y 4 reservadas. No repetir esas recepciones/importaciones como si estuvieran pendientes.
- KPI Reservado filtra dos filas; mezclar SKU/código desconocido bloqueado sin perder cesta; se limpia éxito anterior al error. Confirmación vacía cesta y restaura foco del lector. Escape de modal restaura foco y overflow.
- Flota pasó de 2.339 a 768 px de alto en fixture/viewport comparables. Inventario pasó de 1.838 a 986 px con cinco filas, sin formularios iniciales. Móvil 390×844 sin desborde global; tabla desplaza dentro de su contenedor. Capturas IAB algo borrosas: no equivalen a inspección precisa de tipografía ni ensayo de un celular.
- Portal CUSTOMER ficticio verificado anteriormente con inventario/pedidos propios y exportación; pruebas de permisos cubren aislamiento. No hay piloto operativo real, GPS real, cámara ni lector físico certificados.

## Archivos que orientan la continuación

Leer primero este handoff y después la entrega vigente. El `docs/HANDOFF.md` anterior conserva el núcleo histórico y contiene datos ya superados.

| Propósito | Archivos |
|---|---|
| Guía y estado vigente | `README.md`, `docs/ENTREGA_INVENTARIO_Y_QUADMINDS.md` |
| Requisitos y decisiones | `docs/PLAN_OPERATIVO_CLIENTE.md`, `docs/CONTEXTO_Y_DECISIONES.md` |
| Contratos | `docs/INVENTORY_API.md`, `docs/CONTRATOS_API.md` |
| QA y auditorías | `docs/INFORME_QA.md`, `docs/AUDITORIA_UI_CATALOGO.md`, `docs/AUDITORIA_IMPLEMENTACION.md` |
| Infraestructura e integración | `docs/SUPABASE.md`, `docs/QUADMINDS.md` |
| Frontend | `frontend/App.tsx`, `InventoryPanel.tsx`, `CustomerPortal.tsx`, `BarcodeScanner.tsx`, `inventory.css`, `styles.css`, `TaskDisclosure.tsx`, `useModalFocus.ts`, `DriverDocumentsPanel.tsx`, `MaintenancePanel.tsx` |
| Catálogo y stock | `server/catalog-import.ts`, `server/inventory.ts`, `server/inventory-routes.ts` |
| Pruebas | `tests/catalog-import.test.ts`, `tests/audit-catalog.test.ts`, `tests/inventory.test.ts`, `tests/postgres.integration.ts` y suite restante |
| Evidencias | `docs/evidencias/ui-inventario-final.jpg`, `ui-flota-limpia.jpg`, `ui-inventario-movil.jpg`, `ui-recepcion-limpia.jpg`, capturas anteriores |

`web-publica` es una aplicación paralela y debe preservarse. Al preparar este traspaso se encontró además `docs/PORTAL_WEB_REAL.md`, que describe seguimiento público por código de bulto y una migración privada de tracking, fechada posteriormente al trabajo de UI. Ese documento distingue portal privado del cliente y seguimiento público del destinatario. No se revalidó aquí ese trabajo paralelo: consultar su documentación/código antes de modificarlo o atribuirle los resultados de las 81 pruebas del OS. La landing publicada no publica automáticamente el servidor del OS.

## Pendientes reales

1. Archivo empresarial real de catálogo/pedidos, muestras de etiquetas y prueba del lector físico HID + Enter. Las muestras actuales son ficticias.
2. Cuenta y credenciales QuadMinds autorizadas; contrato de posiciones, IDs/dimensiones, códigos de resultado, hosts de comprobantes y configuración de obligatoriedad foto/firma.
3. Aclarar autoridad de planificación diaria, volumen, restricciones y reglas de parcial/rechazo/retorno.
4. Ensayo de celular real, ubicación en segundo plano, pantalla bloqueada, cortes de red y comprobantes. No implementar un cierre paralelo que contradiga QuadMinds.
5. Alojamiento y facturación del negocio, publicación del OS, configuración inicial real, sincronización programada y piloto con aceptación del cliente. No inventar ETA, distancias, GPS, optimización ni aceptación del piloto.

## Último punto de conversación del producto

El usuario preguntó si “Accesos cliente” es donde concede al cliente acceso al inventario. Se explicó que sí: crea una cuenta asociada a esa empresa, de solo consulta y limitada a su propia mercadería, pedidos, movimientos y comprobantes. No quedó autorizada ninguna alta concreta de usuario ni otra modificación después de esa explicación. La siguiente conversación debe partir de lo ya implementado y esperar la nueva indicación del usuario.

La entrega de este archivo no elimina el chat anterior, no exporta secretos y no modifica datos de negocio. El usuario dijo que borrará el chat trabado por su cuenta.
