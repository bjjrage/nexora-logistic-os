# NEXORA — Roadmap operativo de trabajo · 22/11/2026

**Estado:** propuesta de ejecución basada en decisiones explícitas de este chat, Handoff Estratégico V3, Blueprint Estratégico V4 y código verificado. **NO** sustituye un Blueprint/Roadmap canónico de Project Brain ni declara su aprobación. La sincronización de documentos canónicos está pendiente de registro y revisión humana.

## Objetivo

Construir la oferta completa de NEXORA para **comercios que venden por sus propios canales**: OS logístico que ya opera, **Mini OS del comerciante** (su producto de autoservicio), **bot de ventas del comerciante** conectado a ese mismo OS, y **CRM interno NEXORA + agente comercial** para captar, contactar y hacer seguimiento a esos comercios. Meta de escala: **1.000 comercios activos**; no es una promesa de adopción.

## Contratos no negociables

1. El comerciante conserva su marca, precios, inventario comercial, canales y decisión de venta. Es autoridad sobre las **instrucciones comerciales** (qué entregar, destinatario, fecha y cambios).
2. NEXORA conserva la autoridad de recepción física, ubicaciones, existencias, reservas, custodia, picking, packing, despacho, seguimiento y devoluciones. Ningún portal/bot modifica directamente custodia o stock.
3. El **CRM de captación** es para personal interno de NEXORA; **no crear otro CRM para el comerciante**. El bot de ventas del comerciante es un agente distinto del agente captador de NEXORA.
4. Tanto el pedido manual del comerciante como el pedido originado por su bot usan **un contrato de ingreso y una ruta de validación al mismo núcleo de pedidos**. Reutilizar `Inventory.createOrder`, no crear un motor paralelo.
5. Multioperador en reparto; Universo/QuadMinds es un operador, no un proveedor exclusivo. No afirmar API GPS o prueba de entrega sin verificación real.
6. No prometer precios, zonas, tiempos, pagos, escrow, integración Meta/WhatsApp ni disponibilidad de un proveedor sin evidencias autorizadas.
7. **Fuera de alcance:** Art Studio, generador de publicidades, videos cartoon, fal.ai. Los PR #14 y #15 quedan fuera de este roadmap y no se integran; no borrarlos por esta decisión.
8. Trabajo en ramas y PRs borrador, sin merge/deploy/migraciones productivas sin aceptación humana y pruebas verificadas. Evitar pérdida de código, credenciales o worktrees.

## Hitos y criterios DONE

| Hito | Prioridad | Entrega | Situación 22/11 | Criterio DONE |
|---|---|---|---|---|
| N-00 · Núcleo logístico | Base | Inventario, pedidos, depósito, custodia, rutas, portal de consulta | `main@1e1ae275`, producción técnica; API externa y campo pendientes | Operación/piloto real conciliados, no solamente código |
| N-01 · CRM NEXORA | Alta | Empresas, contactos, dedupe, funnel, tareas, campaña, CSV | PR #12 draft, CI PASS, sin merge | Integración revisada, base y permisos probados, aceptación |
| N-02 · Bandeja CRM | Alta | Conversaciones internas, borradores, aprobaciones humanas | PR #13 draft, CI PASS, sin merge | Integración revisada, no contactar/roles/tenant E2E |
| **N-03 · Mini OS pedidos** | **CRÍTICA / ahora** | Comerciante instruye pedido por SKU; vista de solicitudes; operaciones las convierte mediante núcleo de pedidos | Portal de consulta existe; creación transaccional no implementada | Flujo real aislado `CUSTOMER → solicitud → OPS → inventory_orders DRAFT`, no altera stock ni custodia hasta autorización; reintentos y multi-tenant PASS |
| **N-04 · Bot del comerciante** | **CRÍTICA** | Atiende compradores con cuentas/canales autorizados, consulta stock y crea pedidos con el mismo contrato del Mini OS | Pendiente | Conversación autorizada → stock confirmado → pedido registrado → estado visible en Mini OS; rechazo de duplicados y oversell |
| **N-05 · Agente captador NEXORA** | **CRÍTICA / en paralelo** | Prospección documentada y scoring comercial real, mensajes personalizados, identificación de oportunidad | Pendiente (no confundir con score de completitud) | Empresas reales con procedencia; duplicados controlados; razones de score y pipeline auditables |
| N-06 · Contacto y seguimiento | Alta | Integrar canales oficiales permitidos, respuestas, opt-out, seguimiento y escalamiento | Pendiente | API entrega/recepción confirmada por proveedor; nunca inferir envío ni ignorar opt-out |
| N-07 · Activación comercial | Alta | Propuesta, onboarding comercial → cuenta comerciante en Mini OS, sin alta automática insegura | Pendiente | Conversión medible y flujo de permisos/servicio aceptado |
| N-08 · Cuenta y dinero | Condicional | Cargos, liquidación, cobros con proveedor contratado; escrow solo si autorizan | Pendiente | Conciliación real auditada; no confundir GMV con ingresos NEXORA |
| N-09 · Piloto integral | Alta | Comerciantes reales, pedidos, depósito, bot, reparto multioperador, incidencias | Pendiente | Prueba de punta a punta, costos unitarios y calidad real |
| N-10 · Escala | Posterior | Replicación regional por corredores y operadores | Objetivo, no realizado | Alta/retención de comercios, margen positivo, capacidad y trazabilidad comprobados |

## Estado de repositorio e integración

- `main@1e1ae275ed9a740d6c3a395e4ffea751fb6e9d19` como base operativa verificada.
- PR #12 (`feat/internal-crm-prospecting`) y #13 (`feat/crm-02-outreach-agent`) son independientes de Mini OS y siguen draft.
- PR #14 (Art Studio) y #15 (integración que incluye Studio) no se mezclarán con el roadmap nuevo.
- Primera entrega de N-03 en `feat/minios-01-order-intake`, reservando migración SQLite **027** para no colisionar con CRM 024/025 y Studio 026. Las solicitudes comerciales son un **primer incremento reversible**: no redefinirlas como la arquitectura final del bot sin validar contratos, permisos y calidad del flujo.
- La versión definitiva debe verificar la estrategia de integración del viejo portal Google antes de unificar accesos; sus solicitudes de envío no equivalen a pedidos por SKU.

## No declarar DONE por

Mock, plantillas, foto de UI, mensajes fingidos, botones sin backend, CI verde de otra rama, login aislado o documentación de API externa. Cada hito requiere evidencia de las invariantes y prueba del circuito declarado.
