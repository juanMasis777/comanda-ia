// Reporte semanal: página, datos y envío por SMS.
import express from 'express';
import { requireAuth, canAccess, resolveAccess, sign, verify } from '../auth.js';
import { findRestaurant } from '../restaurants.js';
import { store } from '../store.js';
import { sendSms } from '../notify.js';
import { weeklyReport, reportSms, lastFullWeek, mondayOf, addDays } from '../report.js';

const WEEK = /^\d{4}-\d{2}-\d{2}$/;

export function baseUrl(req) {
  if (process.env.PUBLIC_HOST) return `https://${process.env.PUBLIC_HOST}`;
  return req ? `${req.protocol}://${req.get('host')}` : `http://localhost:${process.env.PORT || 3000}`;
}

/** Enlace firmado: el dueño abre SU reporte de ESA semana sin contraseña. */
export const reportLink = (base, id, semana) =>
  `${base}/reporte.html?r=${encodeURIComponent(id)}&semana=${semana}&firma=${sign(`${id}:${semana}`)}`;

export function buildReport(restaurant, semana) {
  return weeklyReport(restaurant, store.listOrders(restaurant.id), store.listCalls(restaurant.id), semana);
}

/** Envía el reporte por SMS al dueño. Devuelve lo que se mandó. */
export async function sendReport(restaurant, semana, base, send = sendSms) {
  if (!restaurant.telefono_dueno) return { ok: false, errores: ['Falta el celular del dueño (en Menú → Chat y reporte).'] };
  const rep = buildReport(restaurant, semana);
  const enlace = reportLink(base, restaurant.id, semana);
  const texto = reportSms(rep, enlace);
  const result = await send(restaurant.telefono_dueno, texto);
  if (result?.ok === false) return { ok: false, errores: ['Twilio no pudo enviar el SMS. Revisa el número y tu cuenta.'] };
  return { ok: true, texto, enlace, simulado: Boolean(result?.simulated) };
}

export function reportRoutes({ reportSend } = {}) {
  const r = express.Router();

  r.get('/api/reporte', (req, res) => {
    const id = String(req.query.restaurante ?? '');
    const rest = findRestaurant(id);
    if (!rest) return res.status(404).json({ errores: ['Restaurante no encontrado.'] });
    const semana = WEEK.test(req.query.semana ?? '') ? req.query.semana : lastFullWeek(rest.zona_horaria);

    // Acceso con enlace firmado (desde el SMS) o con el panel
    const signed = verify(`${id}:${semana}`, req.query.firma);
    if (!signed) {
      const access = resolveAccess(req);
      req.acceso = access;
      if (!access || !canAccess(req, id)) return res.status(401).json({ errores: ['Enlace inválido o vencido.'] });
    }

    const actual = mondayOf(rest.zona_horaria, new Date());
    const semanas = Array.from({ length: 8 }, (_, i) => addDays(actual, -7 * i));
    res.json({ ...buildReport(rest, semana), semanas: signed ? [semana] : semanas, solo_lectura: signed });
  });

  r.post('/api/reporte/enviar', requireAuth, async (req, res) => {
    const id = String(req.body?.restaurante ?? '');
    if (!canAccess(req, id)) return res.status(403).json({ errores: ['No tienes acceso a este restaurante.'] });
    const rest = findRestaurant(id);
    if (!rest) return res.status(404).json({ errores: ['Restaurante no encontrado.'] });
    const semana = WEEK.test(req.body?.semana ?? '') ? req.body.semana : lastFullWeek(rest.zona_horaria);
    const result = await sendReport(rest, semana, baseUrl(req), reportSend);
    return result.ok ? res.json(result) : res.status(400).json(result);
  });

  return r;
}
