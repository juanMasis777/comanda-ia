import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Order, ticketText } from '../src/order.js';
import { readFileSync } from 'node:fs';
import { openStatus } from '../src/time.js';

// Usamos la plantilla original para que las pruebas no dependan de lo que edite el dueño.
const r = JSON.parse(readFileSync(new URL('../src/restaurants/el-rincon-latino.json', import.meta.url), 'utf8'));
const SABADO = new Date('2026-10-31T14:00:00-04:00');
const MARTES = new Date('2026-10-27T14:00:00-04:00');
const LUNES = new Date('2026-11-02T14:00:00-05:00');

test('agrega un plato con opción obligatoria y calcula impuesto', () => {
  const o = new Order(r, { date: SABADO });
  const res = o.addItem({ item_id: 'fritanga-carne', cantidad: 2, opciones: { tajadas: 'Maduras' }, extras: ['aguacate'] });
  assert.equal(res.ok, true);
  assert.equal(o.lines[0].precio_unitario, 17.99);
  assert.equal(o.totals().subtotal, 35.98);
  assert.equal(o.totals().impuesto, 2.52);
  assert.equal(o.totals().total, 38.5);
});

test('rechaza platos que no existen', () => {
  const o = new Order(r, { date: SABADO });
  const res = o.addItem({ item_id: 'pizza' });
  assert.equal(res.ok, false);
  assert.match(res.error, /no está en el menú/);
});

test('pide la opción obligatoria si falta', () => {
  const o = new Order(r, { date: SABADO });
  const res = o.addItem({ item_id: 'batido', opciones: { sabor: 'mango' } });
  assert.equal(res.ok, false);
  assert.match(res.error, /tamaño/);
});

test('rechaza opciones inventadas y extras que no existen', () => {
  const o = new Order(r, { date: SABADO });
  assert.equal(o.addItem({ item_id: 'batido', opciones: { sabor: 'fresa', tamaño: 'grande' } }).ok, false);
  assert.equal(o.addItem({ item_id: 'vigoron', extras: ['caviar'] }).ok, false);
});

test('acepta alias y acentos ("maduritos", "tamano")', () => {
  const o = new Order(r, { date: SABADO });
  assert.equal(o.addItem({ item_id: 'maduritos' }).ok, true);
  const b = o.addItem({ item_id: 'batido', opciones: { sabor: 'Pitahaya', tamano: 'grande' } });
  assert.equal(b.ok, true);
  assert.equal(o.lines[1].precio_unitario, 7);
});

test('el nacatamal solo se vende sábado y domingo', () => {
  assert.equal(new Order(r, { date: MARTES }).addItem({ item_id: 'nacatamal' }).ok, false);
  assert.equal(new Order(r, { date: SABADO }).addItem({ item_id: 'nacatamal' }).ok, true);
});

test('sugiere bebida cuando piden un plato sin bebida, y deja de sugerir al agregarla', () => {
  const o = new Order(r, { date: SABADO });
  const res = o.addItem({ item_id: 'vigoron' });
  assert.match(res.pedido.sugerencia, /batido/);
  const res2 = o.addItem({ item_id: 'refresco', opciones: { sabor: 'materva' } });
  assert.doesNotMatch(res2.pedido.sugerencia ?? '', /batido/);
});

test('quitar una línea actualiza el total', () => {
  const o = new Order(r, { date: SABADO });
  o.addItem({ item_id: 'vigoron' });
  o.addItem({ item_id: 'tostones' });
  o.removeLine(1);
  assert.equal(o.totals().subtotal, 4.5);
});

test('horario: abierto sábado, cerrado lunes', () => {
  assert.equal(openStatus(r, SABADO).open, true);
  const lunes = openStatus(r, LUNES);
  assert.equal(lunes.open, false);
  assert.match(lunes.nextOpen, /mañana/);
});

test('ticket de cocina incluye cliente, platos y total', () => {
  const o = new Order(r, { date: SABADO });
  o.addItem({ item_id: 'sandwich-cubano', nota: 'sin pepinillo' });
  const t = ticketText(r, o, { numero: '007', cliente: 'Rosa', telefono: '+13055551234', listo: '2:20 p. m.' });
  assert.match(t, /#007/);
  assert.match(t, /sin pepinillo/);
  assert.match(t, /\$11\.76/);
});

test('no deja pedir un plato marcado como agotado', () => {
  const copy = structuredClone(r);
  copy.menu.find((i) => i.id === 'vigoron').agotado = true;
  const res = new Order(copy, { date: SABADO }).addItem({ item_id: 'vigoron' });
  assert.equal(res.ok, false);
  assert.match(res.error, /se acabó/);
});
