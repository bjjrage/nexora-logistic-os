# Nexora: empresa, clientes y personal

Actualización posterior: el usuario creó el depósito real **C1 · Central**. Se corrigió también la cuenta que seguía mostrando Universo como administrador: ahora figura **Administración Nexora**, con los mismos datos de acceso y permisos. El alta inicial ya no copia el nombre empresarial al administrador. Las referencias posteriores a cero depósitos describen el estado anterior a que el usuario creara Central.

## Cómo se organiza

**Nexora Logistic es la empresa que opera el sistema.** Universo es un cliente que entrega mercadería para almacenar y distribuir. El personal de depósito y los choferes pertenecen al equipo de Nexora.

| Concepto | Ejemplo | Dónde se administra |
| --- | --- | --- |
| Empresa operadora | Nexora Logistic | Empresa y equipo → Mi empresa |
| Personal interno | Administración, depósito, coordinación, choferes | Empresa y equipo → Equipo interno; choferes en Flota |
| Cliente dueño de productos | Universo | Clientes → Agregar / Editar |
| Lugar físico de almacenamiento | Depósito central, sector A, estante 1 | Inventario → Depósitos y sectores |
| Catálogo del cliente | SKU, nombre, peso, volumen, código de barras | Inventario → Importar catálogo |
| Existencias físicas | Cantidad recibida o unidad con serie | Inventario → Recibir mercadería |
| Trabajo para repartir | Pedido del cliente | Pedidos |
| Recorrido del vehículo y chofer | Ruta asignada por Nexora | Rutas; el chofer ve Mis rutas |
| Acceso de Universo | Consulta de su propio inventario y pedidos | Accesos cliente |

Una ubicación es un lugar físico donde se guarda mercadería. No es una dirección GPS, una empresa cliente ni una cuenta de usuario. Los lugares pertenecen a la empresa operadora; el stock conserva además su cliente dueño.

## Para empezar con los datos reales

1. Entrar con la cuenta de Administración existente.
2. En Clientes, revisar Universo; **Editar** permite corregir el nombre sin reemplazar el cliente ni perder referencias a stock o envíos.
3. En Inventario → **Depósitos y sectores**, crear el lugar real: código interno, nombre y tipo Depósito. Para separar áreas, agregar sectores o estantes. No se creó un lugar ficticio en producción.
4. Importar el catálogo de Universo. Esto registra productos y no agrega existencias.
5. Entrar con el usuario de Depósito → Inventario → Recibir mercadería. Elegir **Cliente dueño de la mercadería: Universo** y **Dónde se guarda: el depósito o sector real**. Escanear el SKU, revisar cantidad o series y confirmar recepción.
6. Administración o Coordinación logística prepara los pedidos y asigna ruta, chofer y vehículo. Depósito prepara/carga; el chofer consulta Mis rutas.

“Coordinación logística” es la función que anteriormente se mostraba como “Operaciones”. No hace falta crear otra persona para comenzar: Administración ya puede configurar depósitos, clientes y rutas.

## Revisión del flujo y correcciones

Alcance: tres capturas enviadas por el usuario, código del OS, lectura acotada de la organización real y verificación en navegador con una base QA en memoria. Las capturas QA usan nombres y productos ficticios; no son movimientos de la operación real.

Estado inicial: **bloqueado para comenzar una recepción**, con ambigüedad grave entre empresa operadora y cliente.

| Paso observado | Problema | Corrección | Estado comprobado |
| --- | --- | --- | --- |
| 1. Agregar/revisar cliente | No había edición y Depósito veía una acción que el servidor rechazaba | Alta/edición para Administración y Coordinación; controles administrativos retirados del menú Depósito | Edición guardada y referencias conservadas |
| 2. Recibir mercadería | Selector vacío de ubicación, sin explicar qué era ni cómo crearla | Se explica el lugar físico, se ofrece crear desde Recepción y existe Depósitos y sectores; a Depósito se indica la cuenta responsable y la ruta de configuración | Creación QA, selección automática del único lugar, recepción de una unidad y stock disponible 1 |
| 3. Acceder como personal | Encabezado Universo parecía colocar a todo el personal dentro del cliente | Empresa operadora corregida a Nexora Logistic; menús por función; personal separado de los accesos cliente | Depósito y Chofer ven Nexora; Universo permanece como cliente |
| 4. Chofer sin ruta | Pantalla vacía sin explicar el paso previo | Indica que el equipo de Nexora debe preparar/asignar el recorrido | Mensaje y menú Mis rutas comprobados |

Estado resultante: **flujo utilizable después de cargar el depósito real y el catálogo**. No se incorporaron depósitos de ejemplo a producción. La cuenta administradora se corrigió posteriormente a Administración Nexora; ese nombre no determina a qué cliente pertenece el personal.

## Evidencia y verificación

- `npm.cmd test`: 90 pruebas aprobadas, incluyendo aislamiento de organizaciones, permisos, edición de cliente con stock/envíos existentes, auditoría e idempotencia.
- `node --env-file=.env --test tests/postgres.company.ts`: una prueba aprobada contra PostgreSQL/Supabase, con rollback completo de los datos QA.
- Compilación TypeScript/Vite aprobada; OS local reiniciado en `http://127.0.0.1:5173`.
- Corrección real acotada: nombre visible de la organización, de Universo a Nexora Logistic, mediante comando auditado. Se conservaron ID de organización, cliente Universo, cuentas del personal y vinculación vehículo/teléfono GPS. No hubo migraciones de esquema.
- Navegador QA: edición de cliente, guardado de empresa, equipo interno, configuración inicial faltante, creación del primer depósito, recepción por Depósito y existencias resultantes; acceso de Chofer y mensaje de ruta pendiente.
- Las nuevas ventanas de edición usan etiquetas, cierre con Escape y control de foco. No se realizó una auditoría completa de accesibilidad ni validación de todos los tamaños de pantalla en esta corrección.

Capturas anteriores: [Clientes](evidencias/jerarquia/01-clientes-antes.png), [Recepción](evidencias/jerarquia/02-recepcion-antes.png), [Chofer](evidencias/jerarquia/03-chofer-antes.png).

Capturas posteriores: [Paso pendiente de depósito](evidencias/jerarquia/04-deposito-paso-pendiente.png), [Cliente editado](evidencias/jerarquia/05-cliente-editado.png), [Equipo interno](evidencias/jerarquia/06-equipo-nexora.png), [Cliente y depósito separados](evidencias/jerarquia/07-recepcion-cliente-deposito.png), [Stock después de recibir](evidencias/jerarquia/08-recepcion-confirmada-stock.png), [Chofer en Nexora](evidencias/jerarquia/09-chofer-nexora.png).

La captura de paso pendiente se tomó antes de compactar la cabecera; la captura de Recepción usa la versión final con un solo título principal. El alta de un integrante adicional en navegador está pendiente de aprobación de la revisión automática; las cuentas existentes y el endpoint de alta ya están cubiertos por las pruebas del sistema.

## Pantallas del recorrido verificado

1. **Cliente — funciona:** edición guardada desde Administración, con el cliente separado de la empresa operadora.

![Cliente editado en la base QA](evidencias/jerarquia/05-cliente-editado.png)

2. **Personal — funciona para cuentas existentes:** Administración, Chofer y Depósito figuran en el equipo interno de Nexora. El alta adicional de navegador permanece pendiente de aprobación automática.

![Personal interno de Nexora, datos QA](evidencias/jerarquia/06-equipo-nexora.png)

3. **Recepción — funciona después de configurar el lugar físico:** Universo identifica al dueño; el depósito identifica dónde se guarda. La confirmación dejó una unidad disponible en QA.

![Recepción con cliente y depósito separados, datos QA](evidencias/jerarquia/07-recepcion-cliente-deposito.png)

![Existencias después de confirmar recepción, datos QA](evidencias/jerarquia/08-recepcion-confirmada-stock.png)

4. **Chofer — funciona:** pertenece a Nexora y conoce el paso previo cuando todavía no hay un recorrido asignado.

![Mis rutas del chofer en Nexora, datos QA](evidencias/jerarquia/09-chofer-nexora.png)
