// Servidor principal: recibe las llamadas de Twilio, abre el WebSocket de voz
// y sirve el panel del dueño.
import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { handleRelaySocket } from './relay.js';
import { getRestaurantByNumber, getRestaurant, listRestaurants, findRestaurant, saveRestaurant, setSoldOut } from './restaurants.js';
import { menuFromFiles, ALLOWED_TYPES } from './menuImport.js';
import { greeting } from './prompt.js';
import { store } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '25mb' }));

const xml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

const publicHost = (req) => process.env.PUBLIC_HOST || req.headers.host;

// ── Seguridad: verifica que las peticiones vengan de verdad de Twilio ──
function twilioSignatureOk(req) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || process.env.VALIDATE_TWILIO === 'false') return true;
  const signature = req.get('X-Twilio-Signature');
  if (!signature) return false;
  const url = `https://${publicHost(req)}${req.originalUrl}`;
  const data = Object.keys(req.body || {})
    .sort()
    .reduce((acc, key) => acc + key + req.body[key], url);
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireTwilio(req, res, next) {
  if (twilioSignatureOk(req)) return next();
  console.warn('[twilio] Firma inválida, petición rechazada');
  res.status(403).send('Forbidden');
}

// ── 1. Twilio llama aquí cuando entra una llamada ──
app.post('/twilio/voice', requireTwilio, (req, res) => {
  const restaurant = getRestaurantByNumber(req.body.To);
  const host = publicHost(req);
  const hints = [...new Set(restaurant.menu.flatMap((i) => [i.nombre, ...(i.alias ?? [])]).map((h) => h.toLowerCase()))].join(', ');

  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="https://${host}/twilio/handoff">
    <ConversationRelay url="wss://${host}/relay" language="es-US" dtmfDetection="true" welcomeGreeting="${xml(greeting(restaurant))}" hints="${xml(hints)}">
      <Language code="es-US" />
      <Language code="en-US" />
      <Parameter name="restaurant" value="${xml(restaurant.id)}" />
    </ConversationRelay>
  </Connect>
</Response>`);
});

// ── 2. Cuando la IA termina: colgar o transferir a una persona ──
app.post('/twilio/handoff', requireTwilio, (req, res) => {
  let data = {};
  try {
    data = JSON.parse(req.body.HandoffData || '{}');
  } catch {
    /* sin datos */
  }
  const restaurant = getRestaurant(data.restaurante);
  res.type('text/xml');

  if (data.accion === 'transfer' && restaurant.telefono_transferencia) {
    console.log(`[handoff] Transfiriendo a ${restaurant.telefono_transferencia}: ${data.motivo}`);
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="25">${xml(restaurant.telefono_transferencia)}</Dial>
  <Say language="es-US">Lo sentimos, nadie pudo contestar. Por favor llame de nuevo en unos minutos.</Say>
</Response>`);
  }
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>`);
});

// ── 3. Panel del dueño ──
function requireToken(req, res, next) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token || req.query.token === token || req.get('x-dashboard-token') === token) return next();
  res.status(401).json({ error: 'Token inválido' });
}

app.get('/api/restaurantes', requireToken, (_req, res) => res.json(listRestaurants()));
app.get('/api/pedidos', requireToken, (req, res) => res.json(store.listOrders(req.query.restaurante)));
app.get('/api/llamadas', requireToken, (req, res) => res.json(store.listCalls(req.query.restaurante).slice(0, 100)));
app.get('/api/estadisticas', requireToken, (req, res) => res.json(store.stats(req.query.restaurante)));
app.post('/api/pedidos/:id/estado', requireToken, (req, res) => {
  const allowed = ['nuevo', 'preparando', 'listo', 'entregado', 'cancelado'];
  if (!allowed.includes(req.body.estado)) return res.status(400).json({ error: 'Estado inválido' });
  const row = store.updateOrderStatus(req.params.id, req.body.estado);
  return row ? res.json(row) : res.status(404).json({ error: 'No encontrado' });
});

// ── 4. Editor de menú ──
app.get('/api/restaurantes/:id', requireToken, (req, res) => {
  const r = findRestaurant(req.params.id);
  return r ? res.json(r) : res.status(404).json({ errores: ['Restaurante no encontrado.'] });
});

app.put('/api/restaurantes/:id', requireToken, (req, res) => {
  if (!findRestaurant(req.params.id)) return res.status(404).json({ errores: ['Restaurante no encontrado.'] });
  if (req.body?.id !== req.params.id) return res.status(400).json({ errores: ['El id no coincide.'] });
  const result = saveRestaurant(req.body);
  return result.ok ? res.json(result.restaurante) : res.status(400).json({ errores: result.errores });
});

app.post('/api/restaurantes/:id/agotado', requireToken, (req, res) => {
  const result = setSoldOut(req.params.id, req.body?.item_id, req.body?.agotado);
  return result.ok ? res.json({ ok: true }) : res.status(400).json({ errores: result.errores });
});

// ── 5. Importar menú desde foto o PDF ──
app.post('/api/importar-menu', requireToken, async (req, res) => {
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

app.get('/salud', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── WebSocket de voz ──
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/relay') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => handleRelaySocket(ws));
});

server.listen(PORT, () => {
  console.log(`\nComanda IA escuchando en http://localhost:${PORT}`);
  console.log(`Panel del dueño:  http://localhost:${PORT}/${process.env.DASHBOARD_TOKEN ? '?token=TU_TOKEN' : ''}`);
  if (!process.env.PUBLIC_HOST) console.log('Aviso: falta PUBLIC_HOST en .env (tu dominio de ngrok) para recibir llamadas reales.');
  if (!process.env.ANTHROPIC_API_KEY) console.log('Aviso: falta ANTHROPIC_API_KEY en .env.');
});
