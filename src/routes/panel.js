// API del panel: pedidos, llamadas, estadísticas y editor de menú.
// Todo pasa por requireAuth: el dueño solo puede tocar SU restaurante.
import express from 'express';
import { requireAuth, requireAdmin, canAccess, scopedRestaurant, newAccessToken, hashToken } from '../auth.js';
import { listRestaurants, findRestaurant, saveRestaurant, setSoldOut, publicView } from '../restaurants.js';
import { menuFromFiles, ALLOWED_TYPES } from '../menuImport.js';
import { store } from '../store.js';

const ESTADOS = ['nuevo', 'preparando', 'listo', 'entregado', 'cancelado'];
const forbidden = (res) => res.status(403).json({ errores: ['No tienes acceso a este restaurante.'] });

export function panelRoutes() {
  const r = express.Router();

  r.get('/api/yo', requireAuth, (req, res) => res.json(req.acceso));

  r.get('/api/restaurantes', requireAuth, (req, res) => {
    const list = listRestaurants();
    res.json(req.acceso.admin ? list : list.filter((x) => x.id === req.acceso.restaurante));
  });

  // Pedidos, llamadas y estadísticas (el dueño siempre ve solo los suyos)
  const scoped = (handler) => (req, res) => {
    const id = scopedRestaurant(req, req.query.restaurante);
    if (!req.acceso.admin && !id) return forbidden(res);
    res.json(handler(id));
  };
  r.get('/api/pedidos', requireAuth, scoped((id) => store.listOrders(id)));
  r.get('/api/llamadas', requireAuth, scoped((id) => store.listCalls(id).slice(0, 100)));
  r.get('/api/estadisticas', requireAuth, scoped((id) => store.stats(id)));

  r.post('/api/pedidos/:id/estado', requireAuth, (req, res) => {
    if (!ESTADOS.includes(req.body?.estado)) return res.status(400).json({ errores: ['Estado inválido.'] });
    const order = store.getOrder(req.params.id);
    if (!order) return res.status(404).json({ errores: ['Pedido no encontrado.'] });
    if (!canAccess(req, order.restaurante)) return forbidden(res);
    res.json(store.updateOrderStatus(req.params.id, req.body.estado));
  });

  // Editor de menú
  r.get('/api/restaurantes/:id', requireAuth, (req, res) => {
    if (!canAccess(req, req.params.id)) return forbidden(res);
    const found = findRestaurant(req.params.id);
    return found ? res.json(publicView(found)) : res.status(404).json({ errores: ['Restaurante no encontrado.'] });
  });

  r.put('/api/restaurantes/:id', requireAuth, (req, res) => {
    if (!canAccess(req, req.params.id)) return forbidden(res);
    const current = findRestaurant(req.params.id);
    if (!current) return res.status(404).json({ errores: ['Restaurante no encontrado.'] });
    if (req.body?.id !== req.params.id) return res.status(400).json({ errores: ['El id no coincide.'] });

    const data = { ...req.body };
    delete data.tiene_acceso_dueno;
    // Campos que el navegador nunca puede cambiar
    if (current.acceso_hash) data.acceso_hash = current.acceso_hash;
    else delete data.acceso_hash;
    // El dueño no puede cambiar su número de Twilio (podría quedarse con las llamadas de otro)
    if (!req.acceso.admin) data.twilio_number = current.twilio_number ?? '';

    const result = saveRestaurant(data);
    return result.ok ? res.json(publicView(result.restaurante)) : res.status(400).json({ errores: result.errores });
  });

  r.post('/api/restaurantes/:id/agotado', requireAuth, (req, res) => {
    if (!canAccess(req, req.params.id)) return forbidden(res);
    const result = setSoldOut(req.params.id, req.body?.item_id, req.body?.agotado);
    return result.ok ? res.json({ ok: true }) : res.status(400).json({ errores: result.errores });
  });

  // Crea (o cambia) el enlace secreto del dueño. Solo el admin.
  r.post('/api/restaurantes/:id/acceso', requireAdmin, (req, res) => {
    const result = createOwnerAccess(req.params.id);
    if (!result.ok) return res.status(400).json({ errores: result.errores });
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({ token: result.token, enlace: `${base}/pedidos.html?token=${encodeURIComponent(result.token)}` });
  });

  r.post('/api/importar-menu', requireAuth, async (req, res) => {
    const files = Array.isArray(req.body?.archivos) ? req.body.archivos : [];
    if (files.length === 0 || files.length > 5) return res.status(400).json({ errores: ['Sube entre 1 y 5 archivos.'] });
    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f?.media_type) || typeof f.data !== 'string') {
        return res.status(400).json({ errores: ['Solo se aceptan fotos (JPG, PNG, WEBP) o PDF.'] });
      }
    }
    try {
      res.json(await menuFromFiles(files));
    } catch (err) {
      console.error('[importar-menu]', err);
      res.status(502).json({ errores: [`No se pudo leer el menú: ${err.message}`] });
    }
  });

  return r;
}

/** Genera un enlace nuevo para el dueño. El anterior deja de funcionar. */
export function createOwnerAccess(id) {
  const current = findRestaurant(id);
  if (!current) return { ok: false, errores: ['Restaurante no encontrado.'] };
  const token = newAccessToken();
  const result = saveRestaurant({ ...current, acceso_hash: hashToken(token) });
  return result.ok ? { ok: true, token } : result;
}
