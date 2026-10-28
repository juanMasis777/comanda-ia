// Prueba el flujo completo del agente con un Claude simulado (no gasta créditos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent.js';
import { readFileSync } from 'node:fs';

// Usamos la plantilla original para que las pruebas no dependan de lo que edite el dueño.
const r = JSON.parse(readFileSync(new URL('../src/restaurants/el-rincon-latino.json', import.meta.url), 'utf8'));
const SABADO = new Date('2026-10-31T14:00:00-04:00');
const LUNES = new Date('2026-11-02T14:00:00-05:00');

// Cliente falso de Anthropic que devuelve respuestas guionadas, una por llamada.
function fakeClient(script) {
  const calls = [];
  return {
    calls,
    messages: {
      stream(params) {
        calls.push({ ...params, messages: structuredClone(params.messages) });
        const step = script.shift();
        const listeners = [];
        return {
          on(evt, fn) {
            if (evt === 'text') listeners.push(fn);
          },
          abort() {},
          async finalMessage() {
            for (const b of step.content) if (b.type === 'text') listeners.forEach((fn) => fn(b.text));
            return { content: step.content, stop_reason: step.stop_reason ?? 'end_turn' };
          },
        };
      },
    },
  };
}

const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const text = (t) => ({ type: 'text', text: t });

function fakeDeps() {
  const saved = [];
  const sms = [];
  return {
    saved,
    sms,
    store: { saveOrder: (o) => (saved.push(o), { ...o, numero: '001' }) },
    sendSms: async (to, body) => sms.push({ to, body }),
  };
}

test('toma un pedido, lo confirma, guarda y avisa a cocina y cliente', async () => {
  const deps = fakeDeps();
  const client = fakeClient([
    { content: [tool('t1', 'agregar_item', { item_id: 'vigoron', cantidad: 1 })], stop_reason: 'tool_use' },
    { content: [text('Listo, un vigorón. ¿Algo más?')] },
    { content: [tool('t2', 'confirmar_pedido', { nombre_cliente: 'Juan' })], stop_reason: 'tool_use' },
    { content: [text('Su pedido es el número uno.')] },
  ]);
  const agent = new Agent({ restaurant: r, callerPhone: '+13055551234', client, date: SABADO, ...deps });

  const tokens = [];
  const reply1 = await agent.respond('quiero un vigorón', (t) => tokens.push(t));
  assert.equal(reply1, 'Listo, un vigorón. ¿Algo más?');
  assert.equal(agent.order.lines.length, 1);

  await agent.respond('es todo, a nombre de Juan');
  assert.equal(deps.saved.length, 1);
  assert.equal(deps.saved[0].total, 13.9);
  assert.equal(deps.sms.length, 2);
  assert.ok(deps.sms.some((m) => m.to === r.telefono_cocina && /NUEVO PEDIDO/.test(m.body)));
  assert.ok(deps.sms.some((m) => m.to === '+13055551234' && /confirmado/.test(m.body)));
  assert.equal(agent.callRecord().resultado, 'pedido');

  // La herramienta recibió el resultado real del motor de pedidos
  const toolResult = client.calls[1].messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.match(toolResult.content, /"ok":true/);
});

test('no deja tomar pedidos cuando está cerrado', async () => {
  const deps = fakeDeps();
  const client = fakeClient([
    { content: [tool('t1', 'agregar_item', { item_id: 'vigoron' })], stop_reason: 'tool_use' },
    { content: [text('Ahorita estamos cerrados.')] },
  ]);
  const agent = new Agent({ restaurant: r, client, date: LUNES, ...deps });
  await agent.respond('quiero un vigorón');
  assert.equal(agent.order.lines.length, 0);
  assert.match(client.calls[1].messages.at(-1).content[0].content, /cerrado/);
});

test('transferir y cambiar idioma activan las acciones correctas', async () => {
  const deps = fakeDeps();
  let idioma = null;
  const client = fakeClient([
    { content: [tool('t1', 'cambiar_idioma', { idioma: 'en' }), tool('t2', 'transferir_a_humano', { motivo: 'catering' })], stop_reason: 'tool_use' },
    { content: [text('Let me connect you with someone.')] },
  ]);
  const agent = new Agent({ restaurant: r, client, date: SABADO, onLanguage: (l) => (idioma = l), ...deps });
  await agent.respond('I need catering for 50 people');
  assert.equal(idioma, 'en');
  assert.deepEqual(agent.pendingAction, { type: 'transfer', motivo: 'catering' });
  assert.equal(agent.callRecord().resultado, 'transferida');
});

test('el prompt incluye el menú, precios y la regla de no inventar', () => {
  const agent = new Agent({ restaurant: r, client: fakeClient([]), date: SABADO, ...fakeDeps() });
  const p = agent.system[0].text;
  assert.match(p, /Vigorón \| \$12\.99/);
  assert.match(p, /AHORA ESTÁ ABIERTO/);
  assert.match(p, /Nunca inventes/);
});
