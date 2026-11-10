# Nexora OS en Vercel

Los dos proyectos usan la cuenta `marceloechauri-4623s-projects` y la rama `main` de `bjjrage/nexora-logistic-os`.

| Aplicación | Proyecto Vercel | Dirección | Root Directory |
| --- | --- | --- | --- |
| Operaciones | `nexora-logistic-os` | https://nexora-logistic-os.vercel.app | `deploy/vercel` |
| Portal de clientes | `nexora-clientes` | https://nexora-clientes.vercel.app | `deploy/portal` |

## Arquitectura

Vercel sirve dos interfaces React/Vite con entradas, compilaciones y sesiones de navegador propias. El OS incluye la guía interactiva. El portal comparte la API de Railway por HTTPS mediante una lista de rutas permitidas. Supabase mantiene los datos y sesiones. Traccar y la pasarela siguen en Railway.

Cada cliente usa la misma URL del portal. Administración habilita, suspende y restablece accesos por empresa desde el OS. El portal usa `/api/customer/login` y su propia cookie. Operaciones usa `/api/login` y conserva su cookie.

No se instalan credenciales de Supabase ni secretos GPS en Vercel. La API conserva su autenticación, cookies seguras, permisos, validación de origen, límites y controles del OS. El origen de producción de Vercel se añade explícitamente a `ALLOWED_ORIGINS` del backend; los dominios arbitrarios de preview no se autorizan para mutaciones.

La protección propia de Vercel se conserva hasta verificar el acceso efectivo. Si impide a los usuarios acceder a la pantalla del OS, su desactivación requiere aprobación específica; la autenticación del OS permanece activa.

## Construcción y publicación

Los proyectos permiten leer las fuentes del repositorio fuera de sus carpetas de despliegue. Cada carpeta tiene su configuración `vercel.json`.

Install Command: `npm --prefix ../.. ci --include=dev`.

Build del OS: `npm --prefix ../.. run build && node ../../scripts/package-vercel-site.ts`.

Build del portal: `npm --prefix ../.. run build:portal`. Ambas aplicaciones publican su propio `dist`.

El empaquetado copia solamente el sitio compilado y la guía; excluye código del servidor, archivos privados y sourcemaps del sitio Vercel. `release.json` registra el SHA usado para compilar la interfaz. `/api/version` registra la versión de la API en Railway. `npm run release:check` contrasta ambos con GitHub y el árbol local limpio.

Los comandos `ignoreCommand` de cada proyecto comparan el cambio con su publicación anterior. Un cambio exclusivo del portal puede publicar únicamente esa interfaz. Los cambios a código compartido pueden publicar ambos proyectos. En desarrollo, `npm run dev` sirve el OS en el puerto 5173 y el portal en `http://127.0.0.1:5174/portal/`.

Desde la estabilización del 31/10/2026, `main` exige el check `validate` y Railway espera el CI antes de desplegar. Vercel exige en producción `validate` y `resilient-contentment - nexora-logistic` antes de promover el frontend. No usar Force Promote ni saltar estas comprobaciones para una publicación normal. Las pruebas de navegador generales y las dedicadas al ruteo se ejecutan en el CI, con fixtures aisladas y OR-Tools real.

La web pública de marketing y seguimiento en Netlify es otro repositorio y no se modifica con este despliegue.
