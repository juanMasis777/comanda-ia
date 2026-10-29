// Arma la aplicación web (sin abrir el puerto). Así las pruebas pueden usarla.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getRestaurantByNumber, getRestaurant } from './restaurants.js';
import { greeting } from './prompt.js';
import { panelRoutes } from './routes/panel.js';
import { chatRoutes } from './routes/chat.js';
import { reportRoutes } from './routes/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const xml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export function createApp(deps = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '25mb' }));

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

  // ── 3. Chat de la web, reportes y panel ──
  app.use(chatRoutes(deps));
  app.use(reportRoutes(deps));
  app.use(panelRoutes(deps));

  app.get('/salud', (_req, res) => res.json({ ok: true }));

  // Datos públicos para la página de ventas (se configuran en .env)
  app.get('/api/publico/config', (_req, res) => {
    res.json({
      demo_telefono: process.env.DEMO_PHONE || null,
      demo_restaurante: process.env.DEMO_RESTAURANT || process.env.DEFAULT_RESTAURANT || 'el-rincon-latino',
      contacto_telefono: process.env.CONTACT_PHONE || null,
      contacto_whatsapp: process.env.CONTACT_WHATSAPP || null,
      contacto_email: process.env.CONTACT_EMAIL || null,
    });
  });
  app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'landing.html')));
  app.get('/panel', (req, res) => res.redirect(`/pedidos.html${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`));
  app.use(express.static(publicDir, { index: false }));
  return app;
}
