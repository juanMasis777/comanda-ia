// Chat para ordenar desde la página web del restaurante.
// La página carga /widget.js y este conversa con /api/chat usando el MISMO motor de pedidos que la voz.
import express from 'express';
import { Agent } from '../agent.js';
import { findRestaurant } from '../restaurants.js';
import { greeting } from '../prompt.js';
import { openStatus } from '../time.js';
import { store } from '../store.js';
import { rateLimit } from '../rateLimit.js';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_TURNS = 40;
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** El chat solo funciona si el dueño no lo apagó. */
const chatEnabled = (r) => r && r.chat_web !== false && r.estado !== 'pausado';

function cors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

export function chatRoutes({ createChatAgent, chatStore = store } = {}) {
  const r = express.Router();
  const sessions = new Map(); // "restaurante:sesion" -> { agent, inicio, last, turns, queue, saved }

  const save = (s) => {
    if (s.saved || !s.agent.transcript.some((m) => m.rol === 'cliente')) return;
    s.saved = true;
    chatStore.saveCall({ ...s.agent.callRecord(), inicio: s.inicio, fin: new Date().toISOString() });
  };

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, s] of sessions) {
      if (now - s.last > SESSION_TTL_MS) {
        save(s);
        sessions.delete(key);
      }
    }
  }, 60_000);
  sweep.unref?.();

  r.use('/api/chat', cors);

  r.get('/api/chat/config', (req, res) => {
    const rest = findRestaurant(String(req.query.restaurante ?? ''));
    if (!chatEnabled(rest)) return res.status(404).json({ errores: ['Chat no disponible.'] });
    const status = openStatus(rest);
    res.json({
      nombre: rest.nombre,
      saludo: greeting(rest, 'chat'),
      abierto: status.open,
      estado: status.open ? `Abierto · cierra ${status.closesAt}` : `Cerrado · abre ${status.nextOpen ?? 'pronto'}`,
      color: rest.color_chat || '#d9480f',
      telefono: rest.telefono_transferencia || null,
      direccion: rest.direccion,
      destacados: rest.menu
        .filter((i) => !i.agotado)
        .slice(0, 6)
        .map((i) => ({ nombre: i.nombre, precio: i.precio, descripcion: i.descripcion || '' })),
    });
  });

  r.post('/api/chat', rateLimit({ windowMs: 10 * 60 * 1000, max: 60 }), async (req, res) => {
    const { restaurante, sesion } = req.body ?? {};
    const mensaje = String(req.body?.mensaje ?? '').trim().slice(0, 500);
    const rest = findRestaurant(String(restaurante ?? ''));
    if (!chatEnabled(rest)) return res.status(404).json({ errores: ['Chat no disponible.'] });
    if (!SESSION_ID.test(String(sesion ?? ''))) return res.status(400).json({ errores: ['Sesión inválida.'] });
    if (!mensaje) return res.status(400).json({ errores: ['Escribe un mensaje.'] });

    const key = `${rest.id}:${sesion}`;
    let s = sessions.get(key);
    // Una conversación terminada (pedido enviado o despedida) empieza de nuevo
    if (s && s.agent.pendingAction?.type === 'end') {
      save(s);
      sessions.delete(key);
      s = null;
    }
    if (!s) {
      const agent = createChatAgent ? createChatAgent(rest) : new Agent({ restaurant: rest, canal: 'chat' });
      s = { agent, inicio: new Date().toISOString(), last: Date.now(), turns: 0, queue: Promise.resolve(), saved: false };
      sessions.set(key, s);
    }
    if (s.turns >= MAX_TURNS) {
      return res.status(429).json({ errores: ['Esta conversación es muy larga. Recarga la página o llama al restaurante.'] });
    }
    s.turns += 1;
    s.last = Date.now();

    const run = s.queue.then(() => s.agent.respond(mensaje));
    s.queue = run.catch(() => {});
    try {
      const respuesta = await run;
      const terminado = s.agent.pendingAction?.type === 'end';
      if (terminado) save(s); // si no se despide, se guarda al vencer la sesión
      res.json({ respuesta, pedido: s.agent.confirmed, terminado });
    } catch (err) {
      console.error('[chat]', err);
      res.status(502).json({
        errores: ['El asistente no está disponible ahora mismo.'],
        respuesta: `Perdón, tuve un problema. ${rest.telefono_transferencia ? `Puedes llamarnos al ${rest.telefono_transferencia}.` : 'Intenta de nuevo en un momento.'}`,
      });
    }
  });

  r.sessions = sessions; // para las pruebas
  return r;
}
