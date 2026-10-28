// Carga la configuración de cada restaurante desde src/restaurants/*.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'restaurants');

function loadAll() {
  const map = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    map.set(data.id, data);
  }
  return map;
}

const restaurants = loadAll();

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
