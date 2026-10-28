// Configuración de cada restaurante (menú, horario, teléfonos).
// Los archivos de src/restaurants/ son la plantilla inicial. La primera vez se copian
// a data/restaurantes/, y desde ahí los edita el dueño desde el panel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRestaurant } from './validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, 'restaurants');
const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
const confDir = path.join(dataDir, 'restaurantes');

function ensureSeed() {
  fs.mkdirSync(confDir, { recursive: true });
  for (const file of fs.readdirSync(seedDir)) {
    if (!file.endsWith('.json')) continue;
    const target = path.join(confDir, file);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(seedDir, file), target);
  }
}

function loadAll() {
  ensureSeed();
  const map = new Map();
  for (const file of fs.readdirSync(confDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(confDir, file), 'utf8'));
      map.set(data.id, data);
    } catch (err) {
      console.error(`[restaurantes] No pude leer ${file}: ${err.message}`);
    }
  }
  return map;
}

const restaurants = loadAll();

/** Busca un restaurante exacto por id (sin respaldo). */
export function findRestaurant(id) {
  return restaurants.get(id) ?? null;
}

/** Busca por id y, si no existe, usa el restaurante por defecto. */
export function getRestaurant(id) {
  return restaurants.get(id) ?? restaurants.get(process.env.DEFAULT_RESTAURANT) ?? [...restaurants.values()][0];
}

/** Busca el restaurante por el número de Twilio que recibió la llamada. */
export function getRestaurantByNumber(phone) {
  for (const r of restaurants.values()) {
    if (r.twilio_number && r.twilio_number === phone) return r;
  }
  return getRestaurant(process.env.DEFAULT_RESTAURANT);
}

export function listRestaurants() {
  return [...restaurants.values()].map((r) => ({ id: r.id, nombre: r.nombre }));
}

/** Valida y guarda. Devuelve { ok, restaurante } o { ok: false, errores }. */
export function saveRestaurant(data) {
  const errores = validateRestaurant(data);
  if (errores.length) return { ok: false, errores };
  const file = path.join(confDir, `${data.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
  restaurants.set(data.id, data);
  return { ok: true, restaurante: data };
}

/** Marca o desmarca un plato como agotado ("se acabó"). */
export function setSoldOut(restaurantId, itemId, agotado) {
  const r = findRestaurant(restaurantId);
  if (!r) return { ok: false, errores: ['Restaurante no encontrado.'] };
  const copy = structuredClone(r);
  const item = copy.menu.find((i) => i.id === itemId);
  if (!item) return { ok: false, errores: ['Plato no encontrado.'] };
  item.agotado = Boolean(agotado);
  return saveRestaurant(copy);
}
