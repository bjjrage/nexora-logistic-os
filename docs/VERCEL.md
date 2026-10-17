# Nexora OS en Vercel

Proyecto: `nexora-logistic-os`, cuenta `marceloechauri-4623s-projects`, repositorio `bjjrage/nexora-logistic-os`, rama `main`. Dirección prevista: https://nexora-logistic-os.vercel.app.

## Arquitectura

Vercel sirve la interfaz React/Vite y la guía interactiva. Las solicitudes `/api/*` se reescriben por HTTPS al backend existente de Railway. Supabase mantiene los datos y sesiones; Traccar y la pasarela siguen en Railway. No se mueve ni copia la base.

No se instalan credenciales de Supabase ni secretos GPS en Vercel. La API conserva su autenticación, cookies seguras, permisos, validación de origen, límites y controles del OS. El origen de producción de Vercel se añade explícitamente a `ALLOWED_ORIGINS` del backend; los dominios arbitrarios de preview no se autorizan para mutaciones.

La protección propia de Vercel se conserva hasta verificar el acceso efectivo. Si impide a los usuarios acceder a la pantalla del OS, su desactivación requiere aprobación específica; la autenticación del OS permanece activa.

## Construcción y publicación

El proyecto usa Root Directory **`deploy/vercel`** y permite leer las fuentes del repositorio fuera de esa carpeta. Así, `api/index.ts` de la raíz no se empaqueta como una Function innecesaria. Se eliminó el antiguo `vercel.json` raíz: hay una sola configuración vigente en `deploy/vercel/vercel.json`.

Install Command: `npm --prefix ../.. ci --include=dev`.

Build Command: `npm --prefix ../.. run build && node ../../scripts/package-vercel-site.ts`.

Output Directory: `dist`, relativo a `deploy/vercel`. Node: `24.x`.

El empaquetado copia solamente el sitio compilado y la guía; excluye código del servidor, archivos privados y sourcemaps del sitio Vercel. `release.json` registra el SHA usado para compilar la interfaz. `/api/version` registra la versión de la API en Railway. `npm run release:check` contrasta ambos con GitHub y el árbol local limpio.

Una actualización de `main` construye ambos destinos. No se consideran sincronizados hasta que ambos hayan publicado el mismo commit. Railway permanece disponible durante esta publicación; no se eliminan servicios del GPS ni de backup.

La web pública de marketing y seguimiento en Netlify es otro repositorio y no se modifica con este despliegue.
