// Envía alertas de metadatos (sin cuerpos, consultas ni datos personales) al canal HTTPS privado, si está configurado.
const ALERTED = new Set(['server.error', 'server.fatal', 'inventory.mismatch']);
export function alertingSink(base: (entry: Record<string, unknown>) => void = entry => console.log(JSON.stringify(entry))) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (url && new URL(url).protocol !== 'https:') throw new Error('El canal de alertas exige HTTPS.');
  const last = new Map<string, number>();
  return (entry: Record<string, unknown>) => {
    base(entry);
    const event = String(entry.event);
    if (!url || !ALERTED.has(event)) return;
    const now = Date.now();
    if (now - (last.get(event) ?? 0) < 60_000) return; // como máximo una por minuto y tipo
    last.set(event, now);
    const { at, release, requestId, route, method, errorType, status } = entry as Record<string, unknown>;
    fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', ...(process.env.ALERT_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.ALERT_WEBHOOK_SECRET}` } : {}) },
      body: JSON.stringify({ type: event, at, release, requestId, route, method, errorType, status }),
    }).catch(() => {});
  };
}
