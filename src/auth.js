// Quién puede ver qué.
// - El ADMIN (tú) entra con DASHBOARD_TOKEN y ve todos los restaurantes.
// - Cada DUEÑO entra con su propio enlace secreto y solo ve su restaurante.
// - Si no hay DASHBOARD_TOKEN (trabajando en tu computadora), todo queda abierto.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRestaurantsFull } from './restaurants.js';

const dataDir = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const newAccessToken = () => crypto.randomBytes(24).toString('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Clave para firmar enlaces (reportes). Se crea una vez y se guarda en data/. */
let secret = null;
export function appSecret() {
  if (secret) return secret;
  if (process.env.APP_SECRET) return (secret = process.env.APP_SECRET);
  const file = path.join(dataDir, 'secret.key');
  try {
    secret = fs.readFileSync(file, 'utf8').trim();
  } catch {
    fs.mkdirSync(dataDir, { recursive: true });
    secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret);
  }
  return secret;
}

export function sign(text) {
  return crypto.createHmac('sha256', appSecret()).update(text).digest('base64url').slice(0, 32);
}
export const verify = (text, signature) => Boolean(signature) && safeEqual(sign(text), signature);

const tokenFrom = (req) => req.get('x-dashboard-token') || req.query.token || '';

/** Decide el acceso de la petición: { admin: true } o { restaurante: id } o null. */
export function resolveAccess(req) {
  const adminToken = process.env.DASHBOARD_TOKEN;
  const token = tokenFrom(req);
  if (!adminToken) return { admin: true };
  if (token && safeEqual(token, adminToken)) return { admin: true };
  if (token) {
    const h = hashToken(token);
    const r = listRestaurantsFull().find((x) => x.acceso_hash && safeEqual(x.acceso_hash, h));
    if (r) return { restaurante: r.id };
  }
  return null;
}

export function requireAuth(req, res, next) {
  const access = resolveAccess(req);
  if (!access) return res.status(401).json({ errores: ['Enlace inválido. Pide tu enlace de acceso.'] });
  req.acceso = access;
  next();
}

export function requireAdmin(req, res, next) {
  const access = resolveAccess(req);
  if (!access?.admin) return res.status(403).json({ errores: ['Solo el administrador puede hacer esto.'] });
  req.acceso = access;
  next();
}

export const canAccess = (req, id) => Boolean(req.acceso?.admin || req.acceso?.restaurante === id);

/** El restaurante que la petición puede usar (el dueño siempre ve el suyo). */
export function scopedRestaurant(req, requested) {
  if (req.acceso?.admin) return requested || null;
  return req.acceso?.restaurante ?? null;
}
