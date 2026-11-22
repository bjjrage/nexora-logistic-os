# NEXORA · Demo privada integrada
Reunir CRM #12/#13/#18 con Mini OS #16/#17/#19 en rama aislada, sin Studio #14/#15. Proyecto Railway **nuevo y separado**, SQLite ficticia efímera en /tmp/nexora-demo.sqlite, NEXORA_DEMO_MODE=isolated. No establecer DATABASE_URL de producción ni LLM o canales reales.
HTTP Basic obligatorio (NEXORA_DEMO_BASIC_USER / NEXORA_DEMO_BASIC_PASSWORD); dentro, administración demo.admin y comerciante demo.comercio con contraseñas independientes por entorno.
`/` muestra OS/CRM. `/portal/` muestra Mini OS y simulador. Todo registro es ficticio; reinicios pueden restablecer la demo. Nunca mergear esta rama a main ni tratar la SQLite de demo como arquitectura productiva.
