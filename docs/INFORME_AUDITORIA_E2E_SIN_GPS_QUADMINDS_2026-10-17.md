# Informe de auditoría E2E (GPS y QuadMinds excluidos)

**SHA:** `8ec4bcb5523028762e7376814e5aabbfd84fca71` (main). **Fecha:** 2026-10-17.
**Método:** controles ejecutados en local + lectura estática de código por tres agentes de solo lectura; cada hallazgo marcado CONFIRMADO fue releído por el auditor principal. **Nada se ejecutó contra producción ni se modificó código.**

## Comandos ejecutados (local)
| Comando | Resultado |
|---|---|
| `npm test` | 117/117 |
| `npm run test:isolated` | 13/13, solo `nexora_test` en 127.0.0.1 (verificado en `scripts/run-isolated-tests.ts`) |
| `npm run build` | OK |
| `npm run check:migrations` / `check:secrets` | OK |
| `npm run test:e2e` (Playwright) | NO EJECUTADO |

## Estado de flujos
Los recorridos NO se ejecutaron de punta a punta con requests concurrentes ni fallos inyectados; el análisis es estático más la suite existente.
| Flujo | Estado |
|---|---|
| Administración / sesiones / roles | PASS en tests; hallazgos H1, H2 |
| Clientes, aislamiento portal | PASS estático (sin IDOR hallado) |
| Inventario / catálogo | hallazgos H5, H6, H7 |
| Pedido / reservas | PASS estático (bloqueo advisory + CAS) |
| Ruta / despacho / entrega / devolución | hallazgos H3, H4 |
| Proveedores GPS / QuadMinds | EXCLUIDO |

## Hallazgos (todos CONFIRMADOS por lectura de código; ninguno reproducido en ejecución)
- **H3 MEDIO-ALTO — Capacidad de vehículo no se controla entre rutas.** `server/domain.ts:177-179`, `216`, `251`: `capacity()` suma solo la ruta actual. Dos rutas READY de ventanas distintas del mismo vehículo pueden despacharse y exceder el límite. Regresión: dos rutas de 8 kg en vehículo de 10 kg, despachar ambas debe fallar.
- **H1 MEDIO — Sin baja/revocación de personal.** `server/auth.ts:32`: la consulta de sesión no tiene `enabled`; no existe ruta para deshabilitar usuarios. Sesión viva hasta 12 h y contraseña vigente hasta un reset. Regresión: deshabilitar usuario → cookie existente recibe 401.
- **H4 MEDIO — Intentos de entrega repetibles.** `domain.ts:294-306`: no se valida el estado de la propia parada y se aceptan bultos `RETURN_PENDING`. Un reenvío con otro `commandId` duplica intento y evento de custodia. (Que además marque como entregado sin devolución autorizada: reportado por el agente, no verificado por el auditor.)
- **H5 MEDIO — Importación transitoria envenena la clave de idempotencia.** `inventory.ts:602-613` y `572-583` guardan como REJECTED cualquier error; `inventory.ts:422-428` bloquea todo reintento con el mismo `commandId`. No hay datos duplicados, pero el reintento legítimo queda bloqueado. Test actual lo mockea (`tests/inventory.test.ts:99-111`).
- **H6 MEDIO — `adjust()` acepta stock en ubicaciones QUARANTINE/archivadas.** `inventory.ts:315-321` omite el control que sí tienen `receive` (270) y `move`. Genera stock contado como disponible pero no reservable. Sin tests de `adjust()`.
- **H2 BAJO-MEDIO — Chofer conserva acceso a bultos/envíos/evidencia reasignados.** `domain.ts:33`, `app.ts:114`: no filtran `route_assignments.active`.
- **H7 BAJO-MEDIO — Código de barras numérico > 2^53 se borra en silencio al importar** (`catalog-import.ts:230`, `405`, `417`). Agente; no releído por el auditor.

## Riesgos menores (agentes; no releídos por el auditor)
Enumeración de usuarios global por 409 y por tiempo de respuesta; IDs internos legibles por el cliente en `portal_companies`; auditoría completa visible a Depósito/Operaciones; dedupe de series en ajustes negativos con código de error incorrecto; colisión de códigos de barras en API de productos; SKU sensible a mayúsculas con lookup insensible; SKUs archivados no se reactivan en importación (intención sin verificar); mensajes con "?" en lugar de acentos (`domain.ts:528`); correcciones de evidencia de retorno posiblemente inalcanzables. Sin tests: `move()`, `adjust()`, `updateLocation()` y sus endpoints.

## No es bug (descartado por los agentes, con evidencia en código)
Doble asignación de bulto (índice único parcial), rutas superpuestas (triggers), carreras de estado (cola/bloqueo advisory), idempotencia de comandos y webhooks, SSRF en descarga de pruebas (allowlist), aislamiento CUSTOMER en `app.ts:100`, atomicidad de aceptación del portal.

## Limitaciones
Sin ejecución de E2E de navegador, sin concurrencia ni inyección de fallos reales; hallazgos de agentes Haiku no marcados "releído" son plausibles pero no confirmados.

## Veredicto
**PASS WITH CONDITIONS**

Condiciones antes de considerar el alcance apto para producción: corregir H3 y H1; corregir o aceptar explícitamente H4, H5 y H6; agregar los tests de regresión indicados y ejecutar la suite E2E de navegador. Próximo paso recomendado: tarea aparte de fixes, empezando por H3 y H1.
