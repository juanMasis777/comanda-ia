// Editor de menú: formato de texto, validación, guardado y "se acabó".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOptions, formatOptions, parseExtras, formatExtras, parseHours, formatHours, uniqueId } from '../public/menu-format.js';
import { validateRestaurant } from '../src/validate.js';
import { normalizeImported, menuFromFiles } from '../src/menuImport.js';
import { systemPrompt } from '../src/prompt.js';

const seed = JSON.parse(fs.readFileSync(new URL('../src/restaurants/el-rincon-latino.json', import.meta.url), 'utf8'));

test('opciones: texto ↔ JSON ida y vuelta', () => {
  const text = 'tamaño*: mediano, grande +1.50\nsalsa: roja, verde';
  const parsed = parseOptions(text);
  assert.deepEqual(parsed[0], { grupo: 'tamaño', requerido: true, elecciones: [{ nombre: 'mediano', precio_extra: 0 }, { nombre: 'grande', precio_extra: 1.5 }] });
  assert.equal(parsed[1].requerido, false);
  assert.equal(formatOptions(parsed), text);
  assert.throws(() => parseOptions('tamaño mediano grande'), /Falta ":"/);
});

test('extras y horario: texto ↔ JSON', () => {
  const extras = parseExtras('aguacate +2, queso frito extra +$2.50');
  assert.deepEqual(extras, [{ nombre: 'aguacate', precio: 2 }, { nombre: 'queso frito extra', precio: 2.5 }]);
  assert.equal(formatExtras(extras), 'aguacate +2.00, queso frito extra +2.50');
  assert.throws(() => parseExtras('aguacate'), /Extra inválido/);
  assert.deepEqual(parseHours('11-15, 17:30-22:00'), [['11:00', '15:00'], ['17:30', '22:00']]);
  assert.deepEqual(parseHours(''), []);
  assert.equal(formatHours([['11:00', '21:00']]), '11:00-21:00');
  assert.throws(() => parseHours('mediodía'), /Horario inválido/);
});

test('ids únicos sin acentos', () => {
  const taken = new Set(['vigoron']);
  assert.equal(uniqueId('Vigorón', taken), 'vigoron-2');
  assert.equal(uniqueId('Sándwich Cubano', taken), 'sandwich-cubano');
});

test('la plantilla del restaurante es válida', () => {
  assert.deepEqual(validateRestaurant(seed), []);
});

test('la validación atrapa errores comunes del dueño', () => {
  const bad = structuredClone(seed);
  bad.menu[0].precio = -5;
  bad.menu[1].id = bad.menu[0].id;
  bad.telefono_cocina = '305-555-0101';
  bad.horario.mar = [['21:00', '11:00']];
  bad.impuesto = 7;
  const errors = validateRestaurant(bad).join(' | ');
  assert.match(errors, /precio/);
  assert.match(errors, /mismo id/);
  assert.match(errors, /\+13055551234/);
  assert.match(errors, /Horario inválido el mar/);
  assert.match(errors, /impuesto/);
});

test('guardar y marcar agotado escriben en data/restaurantes', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comanda-'));
  process.env.DATA_DIR = tmp;
  const { findRestaurant, saveRestaurant, setSoldOut } = await import('../src/restaurants.js');

  const r = structuredClone(findRestaurant('el-rincon-latino'));
  r.menu.find((i) => i.id === 'vigoron').precio = 13.5;
  assert.equal(saveRestaurant(r).ok, true);
  assert.equal(findRestaurant('el-rincon-latino').menu.find((i) => i.id === 'vigoron').precio, 13.5);

  assert.equal(setSoldOut('el-rincon-latino', 'vigoron', true).ok, true);
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'restaurantes', 'el-rincon-latino.json'), 'utf8'));
  assert.equal(onDisk.menu.find((i) => i.id === 'vigoron').agotado, true);

  const invalid = structuredClone(r);
  invalid.menu = [];
  assert.equal(saveRestaurant(invalid).ok, false);
  assert.equal(setSoldOut('el-rincon-latino', 'no-existe', true).ok, false);
});

test('el prompt avisa a la IA de los platos agotados', () => {
  const copy = structuredClone(seed);
  copy.menu.find((i) => i.id === 'vigoron').agotado = true;
  assert.match(systemPrompt(copy, { date: new Date('2026-10-31T14:00:00-04:00') }), /Vigorón[^\n]*\n(.*\n)*?\s*AGOTADO HOY/);
});

test('normaliza el menú leído de una foto', () => {
  const out = normalizeImported({
    nombre_restaurante: ' La Fritanga de Doña Ana ',
    platos: [
      { nombre: 'Vigorón', categoria: 'Platos', precio: 12.989 },
      { nombre: 'Vigorón', categoria: 'Platos', precio: 14 },
      { nombre: 'Batido', categoria: 'BEBIDAS', precio: 5, opciones: [{ grupo: 'Tamaño', requerido: true, elecciones: [{ nombre: 'mediano' }, { nombre: 'grande', precio_extra: 1.5 }] }] },
      { nombre: 'Sopa del día', categoria: 'platos', precio: null },
    ],
  });
  assert.equal(out.nombre_restaurante, 'La Fritanga de Doña Ana');
  assert.deepEqual(out.menu.map((i) => i.id), ['vigoron', 'vigoron-2', 'batido']);
  assert.equal(out.menu[0].precio, 12.99);
  assert.equal(out.menu[2].categoria, 'bebidas');
  assert.equal(out.menu[2].opciones[0].elecciones[0].precio_extra, 0);
  assert.deepEqual(out.omitidos, ['Sopa del día']);
});

test('menuFromFiles manda la imagen a Claude y fuerza la herramienta', async () => {
  let sent;
  const client = {
    messages: {
      async create(params) {
        sent = params;
        return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'guardar_menu', input: { platos: [{ nombre: 'Tostones', categoria: 'acompañantes', precio: 4.5 }] } }] };
      },
    },
  };
  const out = await menuFromFiles([{ media_type: 'image/jpeg', data: 'AAAA' }, { media_type: 'application/pdf', data: 'BBBB' }], { client, model: 'test' });
  assert.equal(sent.tool_choice.name, 'guardar_menu');
  assert.equal(sent.messages[0].content[0].type, 'image');
  assert.equal(sent.messages[0].content[1].type, 'document');
  assert.equal(out.menu[0].nombre, 'Tostones');
});
