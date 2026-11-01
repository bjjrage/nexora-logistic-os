# Jerarquía de superficies del OS

`frontend/surfaces.css` es la capa compartida para distinguir contenedores sin depender sólo de líneas finas. Se importa después de los estilos base y usa selectores de componentes para que las hojas de carga diferida no borren la jerarquía.

| Nivel | Uso | Tratamiento |
| --- | --- | --- |
| Página | Fondo general del OS y del acceso | Gris azulado `--canvas` |
| Sección | Panel principal | Blanco, borde visible, sombra suave y encabezado azulado con acento azul oscuro |
| Lista agrupada | Contenedor de pedidos o repartos | `--surface-section`; cada registro se mantiene blanco |
| Registro | Pedido, camión, devolución, ficha | Card propia con borde y separación; título y acciones identificables |
| Detalle | Producto, carga, datos de una ficha o formulario auxiliar | Fondo secundario distinto del registro |
| Estado | Disponibilidad, faltante, error, entrega | Conserva texto, badge y colores semánticos; el tono de la superficie no representa un estado |

Una tabla usa encabezado diferenciado y filas alternadas. Los paneles desplegables conservan una cabecera visible y un cuerpo blanco; no se agrega otro marco a un formulario que ya está contenido por ese panel. Los documentos imprimibles mantienen el fondo blanco.

Cobertura compartida: Inicio, Inventario y recepción, Pedidos y reservas, Envíos, Rutas y carga, Tracking, Facturación, Empresa y equipo, Clientes, Flota, accesos y las cards del portal de clientes. No cambia permisos, estados operativos ni datos.

Verificar una pantalla de escritorio y una móvil cuando se agreguen nuevas cards. Comprobar el fondo efectivo del contenedor y el del contenido, el foco del teclado, los colores de estado y que las tablas se desplacen dentro de su contenedor, sin desbordar la página.
