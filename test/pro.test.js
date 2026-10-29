// Acceso por restaurante, chat web y reporte semanal (probados de punta a punta por HTTP).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-pro-'));
process.env.DATA_DIR = tmp;
process.env.DASHBOARD_TOKEN = 'admin-secreto';
process.env.TWILIO_ACCOUNT_SID = '';

// Un segundo restaurante para probar que un dueño no ve al otro
fs.mkdirSync(path.join(tmp, 'restaurantes'), { recursive: true });
const seed = JSON.parse(fs.readFileSync(new URL('../src/restaurants/el-rincon-latino.json', import.meta.url), 'utf8'));
fs.writeFileSync(path.join(tmp, 'restaurantes', 'otro.json'), JSON.stringify({ ...seed, id: 'otro', nombre: 'Otro Restaurante' }));

const { createApp } = await import('../src/app.js');
const { createOwnerAccess } = await import('../src/routes/panel.js');
const { store } = await import('../src/store.js');
const { runDueReports } = await import('../src/scheduler.js');
const { weeklyReport, reportSms } = await import('../src/report.js');
const { normalizePhone } = await import('../src/agent.js');

// Agente falso para el chat: responde guionado y confirma al recibir un teléfono
function fakeChatAgent(restaurant) {
  return {
    transcript: [],
    confirmed: null,
    pendingAction: null,
    async respond(text) {
      this.transcript.push({ rol: 'cliente', texto: text });
      if (/\d{3}.*\d{4}/.test(text)) {
        this.confirmed = { numero: 1, total: 13.9, listo_a_las: '2:20 p. m.' };
        store.saveOrder({ restaurante: restaurant.id, origen: 'web', cliente: 'Ana', telefono: '+13055551234', lineas: [], total: 13.9 });
        this.pendingAction = { type: 'end' };
        return '¡Listo! Pedido #1.';
      }
      return `Recibido: ${text}`;
    },
    callRecord() {
      return { restaurante: restaurant.id, canal: 'web', resultado: this.confirmed ? 'pedido' : 'consulta', conversacion: this.transcript };
    },
  };
}

const smsSent = [];
let server, base;
before(async () => {
  const app = createApp({ createChatAgent: fakeChatAgent, reportSend: async (to, body) => (smsSent.push({ to, body }), { ok: true }) });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (p, token) => fetch(base + p, { headers: token ? { 'x-dashboard-token': token } : {} });
const post = (p, body, token) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-dashboard-token': token } : {}) }, body: JSON.stringify(body) });

test('sin token no se entra al panel', async () => {
  assert.equal((await get('/api/restaurantes')).status, 401);
  assert.equal((await get('/api/restaurantes', 'inventado')).status, 401);
});

test('el admin ve todos los restaurantes', async () => {
  const list = await (await get('/api/restaurantes', 'admin-secreto')).json();
  assert.deepEqual(list.map((r) => r.id).sort(), ['el-rincon-latino', 'otro']);
});

test('el dueño solo ve y edita su restaurante, y no puede tocar el número de Twilio', async () => {
  const { token } = createOwnerAccess('otro');
  const list = await (await get('/api/restaurantes', token)).json();
  assert.deepEqual(list.map((r) => r.id), ['otro']);
  assert.equal((await get('/api/restaurantes/el-rincon-latino', token)).status, 403);

  const mine = await (await get('/api/restaurantes/otro', token)).json();
  assert.equal(mine.acceso_hash, undefined, 'nunca se manda el hash al navegador');
  assert.equal(mine.tiene_acceso_dueno, true);

  const res = await fetch(`${base}/api/restaurantes/otro`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-dashboard-token': token },
    body: JSON.stringify({ ...mine, nombre: 'Otro Renovado', twilio_number: '+13050000000' }),
  });
  const saved = await res.json();
  assert.equal(res.status, 200);
  assert.equal(saved.nombre, 'Otro Renovado');
  assert.equal(saved.twilio_number, '', 'el dueño no cambia su número');

  // Su enlace sigue funcionando después de guardar (el hash no se borró)
  assert.equal((await get('/api/restaurantes/otro', token)).status, 200);

  // No ve pedidos de otro restaurante aunque lo pida
  store.saveOrder({ restaurante: 'el-rincon-latino', cliente: 'X', lineas: [], total: 1 });
  const orders = await (await get('/api/pedidos?restaurante=el-rincon-latino', token)).json();
  assert.ok(orders.every((o) => o.restaurante === 'otro'));
});

test('crear un enlace nuevo invalida el anterior', async () => {
  const first = createOwnerAccess('otro').token;
  const second = createOwnerAccess('otro').token;
  assert.equal((await get('/api/restaurantes', first)).status, 401);
  assert.equal((await get('/api/restaurantes', second)).status, 200);
});

test('chat: config pública, CORS y pedido completo marcado como web', async () => {
  const cfg = await get('/api/chat/config?restaurante=el-rincon-latino');
  assert.equal(cfg.headers.get('access-control-allow-origin'), '*');
  const c = await cfg.json();
  assert.equal(c.nombre, 'El Rincón Latino');
  assert.ok(c.saludo.includes('El Rincón Latino'));
  assert.ok(Array.isArray(c.destacados) && c.destacados.length > 0);

  const sesion = 'test-sesion-123';
  const r1 = await (await post('/api/chat', { restaurante: 'el-rincon-latino', sesion, mensaje: 'Quiero un vigorón' })).json();
  assert.equal(r1.respuesta, 'Recibido: Quiero un vigorón');
  assert.equal(r1.terminado, false);

  const r2 = await (await post('/api/chat', { restaurante: 'el-rincon-latino', sesion, mensaje: 'Ana, 305 555 1234' })).json();
  assert.equal(r2.pedido.numero, 1);
  assert.equal(r2.terminado, true);

  const calls = store.listCalls('el-rincon-latino');
  assert.ok(calls.some((x) => x.canal === 'web' && x.conversacion.length === 2));
});

test('chat: rechaza restaurante inexistente, sesión inválida y mensaje vacío', async () => {
  assert.equal((await post('/api/chat', { restaurante: 'nope', sesion: 'abcdefgh1', mensaje: 'hola' })).status, 404);
  assert.equal((await post('/api/chat', { restaurante: 'el-rincon-latino', sesion: 'x', mensaje: 'hola' })).status, 400);
  assert.equal((await post('/api/chat', { restaurante: 'el-rincon-latino', sesion: 'abcdefgh1', mensaje: '   ' })).status, 400);
});

test('normaliza teléfonos de EE.UU.', () => {
  assert.equal(normalizePhone('(305) 555-1234'), '+13055551234');
  assert.equal(normalizePhone('1 786 555 0000'), '+17865550000');
  assert.equal(normalizePhone('555-1234'), null);
});

test('reporte: calcula ventas, platos, horas pico y comparación', () => {
  const r = { ...seed };
  const at = (iso) => iso;
  const orders = [
    { restaurante: r.id, estado: 'entregado', creado: at('2026-10-20T17:00:00Z'), total: 20, origen: 'telefono', telefono: '+1305', lineas: [{ item_id: 'vigoron', nombre: 'Vigorón', cantidad: 2, subtotal: 25.98 }] },
    { restaurante: r.id, estado: 'nuevo', creado: at('2026-10-21T23:00:00Z'), total: 30, origen: 'web', telefono: '+1305', lineas: [{ item_id: 'batido', nombre: 'Batido', cantidad: 1, subtotal: 5.5 }] },
    { restaurante: r.id, estado: 'cancelado', creado: at('2026-10-21T23:30:00Z'), total: 99, lineas: [] },
    { restaurante: r.id, estado: 'entregado', creado: at('2026-10-14T17:00:00Z'), total: 25, lineas: [] }, // semana anterior
  ];
  const calls = [
    { restaurante: r.id, inicio: '2026-10-20T17:00:00Z', fin: '2026-10-20T17:03:00Z', canal: 'telefono' },
    { restaurante: r.id, inicio: '2026-10-20T17:30:00Z', fin: '2026-10-20T17:31:00Z', canal: 'telefono', resultado: 'transferida' },
    { restaurante: r.id, inicio: '2026-10-21T23:00:00Z', canal: 'web', fuera_de_horario: true },
  ];
  const rep = weeklyReport(r, orders, calls, '2026-10-19');
  assert.equal(rep.pedidos, 2);
  assert.equal(rep.ventas, 50);
  assert.equal(rep.pedidos_web, 1);
  assert.equal(rep.llamadas, 2);
  assert.equal(rep.chats, 1);
  assert.equal(rep.minutos_atendidos, 4);
  assert.equal(rep.top_platos[0].nombre, 'Vigorón');
  assert.equal(rep.hora_pico, 13); // 17:00 UTC = 1 p. m. en Miami
  assert.equal(rep.dia_pico, 'mar');
  assert.equal(rep.comparacion.ventas, 100); // 50 vs 25
  assert.equal(rep.clientes_que_repiten, 1);
  assert.equal(rep.transferidas, 1);
  const sms = reportSms(rep, 'https://x/reporte');
  assert.match(sms, /2 pedidos por \$50\.00/);
  assert.match(sms, /\+100%/);
  assert.match(sms, /Vigorón/);
});

test('reporte: enlace firmado sí, enlace alterado no', async () => {
  const send = await (await post('/api/reporte/enviar', { restaurante: 'otro', semana: '2026-10-19' }, 'admin-secreto')).json();
  assert.equal(send.ok, false, 'sin celular del dueño no se manda');

  const { saveRestaurant, findRestaurant } = await import('../src/restaurants.js');
  saveRestaurant({ ...findRestaurant('otro'), telefono_dueno: '+13055559999' });
  const ok = await (await post('/api/reporte/enviar', { restaurante: 'otro', semana: '2026-10-19' }, 'admin-secreto')).json();
  assert.equal(ok.ok, true);
  assert.equal(smsSent.at(-1).to, '+13055559999');

  const link = new URL(ok.enlace);
  const q = new URLSearchParams({ restaurante: 'otro', semana: link.searchParams.get('semana'), firma: link.searchParams.get('firma') });
  const good = await get(`/api/reporte?${q}`);
  assert.equal(good.status, 200);
  assert.equal((await good.json()).solo_lectura, true);

  q.set('semana', '2026-10-12');
  assert.equal((await get(`/api/reporte?${q}`)).status, 401, 'la firma no sirve para otra semana');
});

test('reporte automático: solo los lunes desde las 9 a. m. y una sola vez por semana', async () => {
  const { saveRestaurant, findRestaurant } = await import('../src/restaurants.js');
  saveRestaurant({ ...findRestaurant('otro'), reporte_semanal: true, telefono_dueno: '+13055559999' });
  const sent = [];
  const send = async (to, body) => (sent.push(body), { ok: true });
  assert.deepEqual(await runDueReports({ now: new Date('2026-10-26T12:00:00Z'), send }), [], 'lunes 8 a. m. todavía no');
  assert.deepEqual(await runDueReports({ now: new Date('2026-10-26T14:00:00Z'), send }), ['otro'], 'lunes 10 a. m. sí');
  assert.deepEqual(await runDueReports({ now: new Date('2026-10-26T18:00:00Z'), send }), [], 'no se repite');
  assert.deepEqual(await runDueReports({ now: new Date('2026-10-27T14:00:00Z'), send }), [], 'martes no');
  assert.equal(sent.length, 1);
});

test('la página de ventas está en / y el panel en /pedidos.html', async () => {
  assert.match(await (await get('/')).text(), /Comanda IA/);
  assert.equal((await get('/pedidos.html')).status, 200);
  assert.equal((await get('/widget.js')).status, 200);
});
