// Límite simple de peticiones por IP, para que nadie gaste tus créditos de IA.
export function rateLimit({ windowMs, max, message = 'Demasiadas solicitudes. Intenta en unos minutos.' }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs);
  timer.unref?.();

  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'x';
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    h.count += 1;
    if (h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ errores: [message] });
    }
    next();
  };
}
