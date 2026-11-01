# Compatibilidad de rollback de esquema

## H3: rollback de la release 3a6444 sobre esquema 22

El rollback directo al commit `3e879dd905beb9a3bfa33bdd6d70a28f7a1b18ad` no es el candidato operativo: además del gate de esquema, su lógica de devoluciones reabre un defecto corregido. Se eligió el commit desplegado `3a6444dae7e0ec94e8f6e6161e2aede1f42cdb95`, que conserva esas correcciones y ya soporta la migración 21, pero necesita aceptar también la migración 22.

El patch candidato está en [`rollback-3a6444-schema22.patch`](rollback-3a6444-schema22.patch). Cambia el gate para aceptar exactamente 1–21 o 1–22 y actualiza su regresión. Las migraciones 21 y 22 crean tablas nuevas con índices, triggers/políticas y permisos; no contienen `DROP` ni alteran tablas previas. El backend base no consulta las tablas nuevas. El patch no revierte el esquema ni modifica datos.

## Preparación y verificación del artefacto

Crear un checkout descartable del commit desplegado, guardar el patch fuera del checkout, aplicarlo y construir el candidate:

```sh
Copy-Item docs/rollback-3a6444-schema22.patch "$env:TEMP/rollback-3a6444-schema22.patch"
git clone --shared . "$env:TEMP/nexora-rollback-3a6444"
git -C "$env:TEMP/nexora-rollback-3a6444" switch --detach 3a6444dae7e0ec94e8f6e6161e2aede1f42cdb95
git -C "$env:TEMP/nexora-rollback-3a6444" apply "$env:TEMP/rollback-3a6444-schema22.patch"
Push-Location "$env:TEMP/nexora-rollback-3a6444"
npm ci
npm test
npm run build
Pop-Location
```

La prueba `tests/rollback-compatibility.test.ts` ejecuta la condición exacta incluida en el patch contra metadata simulada: acepta 1–21 y 1–22, y rechaza 1–20, huecos, duplicados y versiones desconocidas. No requiere ni conecta una base de datos. Si se añade una migración posterior a la 22, el candidate debe revisarse y reconstruirse antes de usarlo.

## Alcance pendiente antes de usarlo

El ensayo local en DB22 se completó para este candidate. El build y la suite unitaria pasaron; diez pruebas PostgreSQL reales pasaron, incluidas consulta de salud/denegación anónima y flujo de devoluciones con fixtures transaccionales que se revirtieron; el proceso también arrancó contra DB22 y devolvió health 200 y bootstrap sin sesión 401. El ensayo fue local, con `nexora_test`; no fue un deploy de staging ni autoriza un rollback productivo.
