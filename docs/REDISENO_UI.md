# Rediseño de Nexora OS

15 de octubre de 2026. Solicitud directa del usuario: rediseñar toda la interfaz del OS, aplicar la marca, jerarquizar el contenido, evitar wrappers rectangulares y compactar al menos un 20% conservando los flujos.

## Decisiones de interfaz

La identidad procede de `web-publica/public/assets/nexora-original.jpg` y `brand-reference.jpg`: azul noche, rojo y blanco. Se reutilizó el logo real y las fuentes locales Inter/Manrope. La web pública se usó como referencia y no fue editada.

Las secciones quedan abiertas sobre el lienzo, con título, explicación breve y reglas divisorias. Se eliminaron fondos, bordes completos y sombras de cards, fieldsets, listas y tablas. Los controles con superficie usan cápsulas o círculos; los campos usan subrayados. Los botones tienen textura CSS, hover, foco visible y estados deshabilitados neutros. `prefers-reduced-motion` desactiva las transiciones.

Inicio separa cifras, accesos, pendientes, rutas abiertas y actividad. El acceso «Ver ruta» abre la ruta indicada. Las cifras y barras proceden de los registros existentes; no representan GPS. Las seis vistas, acceso y superficie móvil del chofer comparten el sistema visual.

## Compactación medida

Comparación de altura DOM de `.content`, con la misma base DEMO y viewport 1280 × 720. Se midió antes del alta adicional del cliente de QA. No se ocultaron formularios para mejorar la medición.

| Vista | Antes, px | Después, px | Reducción |
|---|---:|---:|---:|
| Inicio | 1042,28 | 746,95 | 28,3% |
| Envíos | 1906,28 | 1484,03 | 22,2% |
| Rutas | 1123,16 | 879,16 | 21,7% |
| Flota | 3465,97 | 2287,91 | 34,0% |
| Clientes | 1064,28 | 806,66 | 24,2% |
| Tracking | 566,28 | 449,88 | 20,6% |

La barra lateral pasa de 252 a 200 px, una reducción del 20,6%. La medida describe esta configuración y este fixture; otros datos o tamaños cambian la altura. Evidencia: `evidencias/redesign/alturas-antes.json`, `alturas-despues.json` y capturas del mismo recorrido.

## Verificación

- `npm test`: 32 aprobadas, cero fallidas; 7238,1996 ms. Pruebas de dominio/API con SQLite temporal. Backend, esquema y contratos permanecen sin cambios por este rediseño.
- `npm run build`: TypeScript y Vite aprobados; última salida CSS 27,98 kB, JS 312,10 kB y Vite 5,03 s.
- Navegador: navegación de las seis vistas, selección/desselección de bulto y habilitación del envío de recepción sin confirmar una custodia nueva; alta del cliente ficticio «QA UI · rediseño», confirmada en UI y SQLite.
- Móvil: las cinco vistas operativas comprobadas a 390 × 844 no desbordan el documento; contenido de 375 px dentro de viewport de 390 px, con scrollbar. Tras corregir el ancho mínimo, las seis vistas también pasan a 320 × 740: ancho de contenido igual al ancho disponible (305 px con scrollbar; 320 px sin ella). Tracking mantiene el desplazamiento interno de su tabla.
- Chofer: login, «Mis rutas», checklist, paradas y navegación limitada a Mis rutas/Tracking. No se cerró ni alteró la ruta DEMO para probar estilos.
- Contraste calculado contra blanco: azul 17,04:1; rojo de controles 5,83:1; texto secundario 6,39:1. Son comprobaciones de tokens, no una certificación de accesibilidad integral.
- Fuentes locales cargadas en navegador. Sin errores de consola observados en el recorrido revisado.

La base DEMO conserva cuatro bultos `IN_TRANSIT`, uno `EXPECTED` y su ruta `IN_PROGRESS`, versión 8. Solo se añadió el cliente ficticio para comprobar el formulario. La copia previa de App, estilos y entrada queda en `.local/ui-redesign-before/`.

## Ajuste posterior de KPI

Por corrección explícita del usuario, los KPI ahora tienen contenedores visibles, radios de 28 px en escritorio y 24 px en móvil. El KPI principal usa fondo azul noche; el hover pasa a rojo con borde y halo luminoso. Los otros KPI pasan de blanco a azul noche con borde y halo rojos, texto blanco y elevación de 3 px. El cambio de color permanece al reducir movimiento, pero se desactiva el desplazamiento.

Build aprobado; hover comprobado visualmente y por estilo computado. Móvil a 390 × 844 conserva 375 px de contenido disponible sin desbordamiento. Inicio mide ahora 746,95 px, todavía 28,3% menor que la referencia. Captura: `evidencias/redesign/kpi-hover.png`. Este ajuste solo modifica estilos, sin cambios de datos ni handlers.

GPS real, producción y las funciones de negocio pendientes conservan los límites de `CONTEXTO_Y_DECISIONES.md`. La nueva interfaz no desbloquea esas integraciones.

## KPI con detalle funcional

Se eliminó el fondo fijo del segundo KPI. Los cuatro indicadores ahora son botones accesibles por teclado: abren y cierran el listado que compone su cifra. Solo el indicador cuyo detalle está abierto conserva un borde de selección; el halo corresponde a hover o foco de teclado.

Envíos muestra referencias, cliente y conteos; bultos muestra los resultados pendientes y custodia; rutas filtra las que siguen abiertas; incidencias filtra las no cerradas. Cada fila permite abrir su envío o ruta, conservando el recurso seleccionado al cambiar de vista. El cierre del detalle devuelve el foco al indicador.

Verificado en navegador DEMO: 1 envío, 5 bultos, 1 ruta y estado vacío para 0 incidencias; cierre con cero indicadores expandidos; apertura mediante Enter; acceso al envío y ruta correctos. El detalle móvil mantiene 375 px de contenido en 375 px disponibles. Build aprobado, sin errores de consola observados. No se crearon ni modificaron registros para esta comprobación; el caso con incidencias positivas no se ejercitó en navegador. Captura: `evidencias/redesign/kpi-detalle.png`.
