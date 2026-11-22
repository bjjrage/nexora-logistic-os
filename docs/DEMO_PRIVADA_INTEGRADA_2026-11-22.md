# NEXORA OS4 — Demo sin credenciales
Rama de demostración aislada; jamás mezclar en main. Integra CRM (#12/#13/#18) y Mini OS (#16/#17/#19), sin Studio.
Solo proyecto Railway de pruebas y SQLite efímera con datos inventados. NEXORA_DEMO_MODE=isolated habilita sesiones automáticas, **sin usuario ni contraseña al abrir**:
- /: administrador CRM y Operaciones
- /portal/: comerciante, inventario y bot simulado
Las sesiones usan cookies y mantienen límites por rol/organización; los passwords internos se generan aleatoriamente y no se comparten.
**La demo es accesible públicamente a cualquiera que tenga el enlace**. No compartir información real ni conectarla a APIs externas. Noindex/nofollow. No contiene datos productivos y puede reiniciarse.
Producción exige PostgreSQL y autenticación habitual; estas excepciones nunca deben aplicarse allí.
