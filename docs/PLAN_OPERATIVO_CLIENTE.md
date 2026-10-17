# Plan operativo: inventario y reparto con QuadMinds

Fecha: 15 de octubre de 2026. Fuente de alcance: seis requisitos del cliente transmitidos por el usuario. Este documento conserva el plan aprobado y sustituye las decisiones anteriores que excluían inventario y portal del cliente. La implementación y su verificación se registran en la [entrega vigente](ENTREGA_INVENTARIO_Y_QUADMINDS.md); cuenta del proveedor, publicación y piloto reales siguen pendientes.

## 1. Interpretación del encargo

Nexora administra la mercadería del cliente bajo nuestra custodia, sus movimientos físicos y el acceso al inventario. QuadMinds ejecuta el reparto mediante su app obligatoria: ruta asignada, seguimiento desde el celular y comprobante de entrega con foto y firma. Se conectan ambos circuitos para que el chofer no confirme la misma entrega en dos aplicaciones.

| Requisito recibido | Implementación propuesta | Punto por confirmar |
|---|---|---|
| Inventario en un local | Depósito inicial, ubicaciones internas, productos y existencias del cliente; trazabilidad por unidad/serie cuando corresponda. | Si se almacenan unidades sueltas y se preparan pedidos, o se custodian pedidos ya armados; cantidad de locales prevista. |
| Entrada y salida por código de barras | Recepción, ubicación, preparación, carga y retorno mediante lectura; historial de movimientos. | Etiquetas reales: código de producto, número de serie, bulto o pedido; lector USB, celular o ambos. |
| Acceso del cliente al inventario | Portal autenticado de consulta, cantidades, estado, movimientos y exportación, limitado a su mercadería. | Usuarios, campos visibles y frecuencia requerida. La edición no está solicitada. |
| Ruta diaria y ruteo automático | Importar los pedidos del día y sus restricciones; proponer planificación en QuadMinds, revisar y publicar. | Quién decide la secuencia, quién publica y qué cuenta dispone del planificador. |
| GPS por celular | Ubicación procedente de la app de QuadMinds; Nexora consulta la fuente autorizada. | Dispositivos compatibles, permisos, frecuencia, cobertura y acceso de integración. |
| App QuadMinds, foto y firma | El chofer ejecuta la ruta y captura la evidencia allí; Nexora sincroniza el resultado y su evidencia. | Configuración obligatoria de foto/firma, API disponible, acceso y conservación de comprobantes. |

La frase «ellos definen la ruta diaria» admite dos contratos distintos: (A) el cliente define los pedidos, destinos, día y restricciones, y operaciones optimiza el recorrido; (B) el cliente entrega una ruta ya secuenciada/publicada y operaciones la ejecuta. Se propone A hasta aclararlo, sin implementar decisiones irreversibles que dependan de esa suposición. Si corresponde B, se importa y respeta la planificación del cliente.

## 2. Circuito propuesto y autoridad de datos

Cliente envía mercadería → recepción escaneada en Nexora → stock en depósito → pedido del día → reserva y preparación → planificación aprobada → carga escaneada → ruta publicada en QuadMinds → app del chofer → resultado, foto y firma → sincronización en Nexora → consulta del cliente y conciliación.

- **Nexora:** autoridad del inventario físico, ubicaciones, reservas, movimientos, custodia y permisos del portal. Los pedidos conservan el número de origen del cliente.
- **Cliente:** autoridad de la instrucción comercial (qué entregar, a quién, cuándo, cambios y cancelaciones). No se presupone una integración ERP todavía.
- **QuadMinds:** fuente del recorrido publicado para el chofer, posiciones y resultado/evidencias capturados en su app. Nexora conserva los identificadores externos, fuente y fechas; no inventa eventos faltantes.
- **Operaciones:** revisa faltantes, direcciones, capacidad, restricciones, discrepancias y excepciones antes de despachar. El ruteo automático no libera un camión por sí mismo.

### Reglas de inventario

1. Separar producto/modelo, unidad o serie cuando aplique, bulto y pedido. Un código de barras no se considera único por unidad sin verificarlo: varias unidades pueden compartir el código de modelo.
2. Mantener existencias por cliente propietario, depósito, ubicación y condición; distinguir disponible, reservado, bloqueado/dañado y en custodia de un vehículo.
3. Recibir mercadería crea una entrada física. Importar un pedido de entrega solo crea una instrucción y su reserva; no aumenta stock.
4. La reserva reduce disponibilidad, sin mover físicamente la mercadería. La carga confirmada transfiere custodia del depósito al vehículo. La entrega confirmada retira esa unidad de nuestra custodia. No descontar dos veces la misma unidad.
5. Una entrega fallida sigue bajo custodia del vehículo hasta la recepción física del retorno. El retorno se recibe por escaneo y queda pendiente de inspección antes de volver a estar disponible.
6. Correcciones y diferencias se registran como movimientos autorizados con motivo e historial. Reintentar una lectura, importar de nuevo un archivo o recibir el mismo evento externo no duplica efectos.
7. Definir entregas parciales por unidades/bultos y el vínculo entre cada comprobante y sus pedidos. La posición del celular no prueba por sí sola que se entregó un producto.
8. Distinguir resultado comunicado por QuadMinds de comprobante completo. Si faltan foto o firma exigidas, mostrar «entrega informada, evidencia pendiente» y conciliar; no ocultar la entrega comunicada ni darla por certificada.

## 3. Etapas y criterios de aceptación

| Etapa | Trabajo y entregable | Cómo se acepta |
|---|---|---|
| 0. Acuerdo operativo e integración | Obtener muestras de etiquetas, recepción y pedidos; responsables, cuentas y reglas. Validar cuenta/producto/API de QuadMinds, formatos y relación pedido–unidad–bulto. | Una muestra del cliente recorre el modelo sin perder identificadores; responsables confirman quién planifica/publica y dónde se registra cada operación. |
| 1. Inventario y escaneo | Catálogo, propietario, depósito/ubicaciones, cantidades y series si aplican; recepción, movimientos, conteo, ajustes, reservas y retornos. Pantallas de lectura con validación y discrepancias. | Entrada, traslado y salida comprobados con etiquetas y lector/celular reales; lecturas repetidas, concurrencia y falta de stock no producen duplicaciones ni saldos imposibles. |
| 2. Portal del cliente | Acceso de consulta a su inventario, disponibilidad, reservas, movimientos y exportación; permisos en servidor y base. Revisar si las tablas de portal ya existentes en Supabase se pueden reutilizar sin alterar trabajo ajeno. | Dos clientes de prueba no pueden ver datos del otro por pantalla, API ni exportación; el cliente ve saldos conciliados con el depósito. |
| 3. Pedidos y preparación diaria | Importador validado de un formato Excel/CSV acordado; origen e ID externo, líneas, dirección, contacto, fecha y ventanas. Control de duplicados, faltantes, cambios/cancelaciones y lista de preparación. | Importar dos veces no duplica pedidos; faltantes y direcciones incompletas quedan visibles y no se despachan inadvertidamente. |
| 4. Planificación y carga | Conectar pedidos con QuadMinds; optimizar y publicar allí si esa responsabilidad es nuestra, o importar rutas del cliente. Identificadores compartidos, revisión de capacidad y manifiesto/carga escaneada. | Una ruta de prueba aparece en la app del chofer con los pedidos correctos y coincide con la carga de Nexora. Fallas de envío no crean rutas duplicadas. |
| 5. Entrega, GPS y sincronización | Ensayar la app con celulares reales; configurar foto/firma requeridas. Importar estados, parciales, motivos de fallo, posición y comprobantes según acceso disponible. Reintentos, deduplicación y conciliación. | Entrega con foto y firma trazables a cada pedido; fallo y retorno correctos; GPS muestra fecha real y desactualización; cortes de red o eventos repetidos no generan cierres falsos. |
| 6. Piloto y puesta en operación | Lote pequeño acordado, depósito, vehículo, chofer y usuario del cliente. Conciliar físico/sistema. Publicación en Vercel, configuración privada, recuperación de datos y responsables operativos. | Recorrido completo aprobado por operaciones y cliente; pendientes de sincronización visibles/resueltos; inventario y evidencias coinciden; prueba de recuperación y acceso superadas. |

Las etapas 1–3 pueden avanzar mientras se confirma la integración, después de acordar los formatos de inventario/pedidos que condicionan su modelo. La integración de las etapas 4–5 depende de la cuenta y capacidades efectivamente habilitadas. No prometer sincronización automática solo porque existe documentación pública.

### Estrategia de integración

- Preferir API para órdenes y resultados, usando las capacidades confirmadas del producto contratado. Evaluar eventos/webhooks si se ofrecen; en su defecto, consultas programadas con límites y conciliación periódica.
- QuadMinds documenta carga manual, Excel y API. Un archivo acordado puede servir para validar el piloto y planificar antes de automatizar; no equivale a integración bidireccional terminada.
- Confirmar cómo se consultan/descargan foto y firma, a qué nivel se asocian y cuánto tiempo se conservan. Una URL externa que vence no garantiza conservación del comprobante.
- Elegir un único punto de control de carga y sus equivalencias. QuadMinds también ofrece escaneo de carga: si el cliente lo exige, enlazar sus resultados con los movimientos de Nexora y evitar un segundo escaneo manual obligatorio.
- No construir inicialmente un optimizador de rutas ni una app GPS propia: aprovechar QuadMinds sujeto a las funciones habilitadas. Las fallas de conectividad, permisos y captura en segundo plano se prueban en los equipos reales.

## 4. Qué existe y qué falta

Existe una base reutilizable: OS local, usuarios/roles internos, clientes, envíos/bultos, custodia, carga, rutas manuales, devoluciones y evidencias; conexión PostgreSQL privada a Supabase. También hay un conector preparado para consultar posiciones QuadMinds, todavía sin activación ni validación real.

Falta construir el inventario por productos/unidades, lectura real con los dispositivos elegidos, portal de inventario, importación diaria, planificación automática conectada, publicación/sincronización de rutas, firma y comprobantes procedentes de QuadMinds. La lectura manual de un código en el OS actual no constituye una solución completa de escaneo. Las pruebas anteriores del núcleo no prueban estas capacidades nuevas.

Infraestructura propuesta: Supabase del negocio para datos y usuarios según el diseño que se implemente; Vercel para publicar Nexora; QuadMinds para reparto. No hay una necesidad confirmada de Railway. Se decide dónde ejecutar la sincronización programada al verificar frecuencia, volumen, duración y capacidades de despliegue. Las cuentas, contratación y facturación deben pertenecer al negocio o al cliente según el acuerdo; no cargar nuevos servicios a una cuenta personal por defecto.

## 5. Información a pedir al cliente y a QuadMinds

Mensaje preparado para el responsable operativo/técnico; no se ha enviado:

> Para conectar nuestro inventario con su operación necesitamos una muestra del archivo de mercadería recibida, del archivo de pedidos diarios y fotos de las etiquetas/códigos utilizados. Confirmen si ustedes entregan una ruta ya ordenada o si debemos optimizar los pedidos del día. Indiquen quién administra y paga la cuenta de QuadMinds, quién publica las rutas y qué acceso de integración pueden habilitar para órdenes, rutas, GPS y comprobantes con foto y firma. También necesitamos los usuarios que consultarán inventario, los volúmenes aproximados de mercadería/pedidos/vehículos y las reglas de entregas parciales, rechazos, devoluciones y conservación de comprobantes. Las credenciales deben compartirse por un canal privado autorizado.

También confirmar si hay productos con serie individual, varios bultos por unidad, retiros simultáneos, ventanas horarias, tiempos de descarga, capacidades por peso/volumen y requisitos de manipulación. No habilitar cobro contra entrega ni facturación por inferencia.

## 6. Fuentes verificadas

- [Añadir órdenes: manual, Excel y API](https://docs.quadminds.com/docs/cargar-las-ordenes).
- [Optimización y publicación de rutas](https://docs.quadminds.com/docs/optimizaci%C3%B3n-y-publicaci%C3%B3n).
- [Driver App: visita, órdenes y cierre con fotos y firmas](https://docs.quadminds.com/docs/en-un-cliente).
- [Control de carga y lectura de códigos](https://docs.quadminds.com/docs/control-de-carga).
- [Rutas y seguimiento](https://docs.quadminds.com/docs/rutas-1).

La documentación describe funciones del proveedor. No acredita que estén contratadas en la cuenta del cliente, que todos sus datos sean accesibles por API ni que la integración de Nexora esté implementada.
