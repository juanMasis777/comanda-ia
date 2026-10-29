// Guarda pedidos y llamadas en archivos JSON dentro de /data.
// Suficiente para el piloto. Cuando tengas varios clientes, cámbialo por Supabase.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

function file(name) {
  return path.join(dataDir, `${name}.json`);
}

function read(name) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return [];
  }
}

function write(name, rows) {
  const tmp = `${file(name)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, file(name));
}

export const store = {
  saveOrder(order) {
    const rows = read('pedidos');
    const numero = String(rows.filter((o) => o.restaurante === order.restaurante).length + 1).padStart(3, '0');
    const saved = { id: `${order.restaurante}-${Date.now()}`, numero, estado: 'nuevo', creado: new Date().toISOString(), ...order };
    rows.push(saved);
    write('pedidos', rows);
    return saved;
  },

  getOrder(id) {
    return read('pedidos').find((o) => o.id === id) ?? null;
  },

  updateOrderStatus(id, estado) {
    const rows = read('pedidos');
    const row = rows.find((o) => o.id === id);
    if (!row) return null;
    row.estado = estado;
    row.actualizado = new Date().toISOString();
    write('pedidos', rows);
    return row;
  },

  saveCall(call) {
    const rows = read('llamadas');
    rows.push(call);
    write('llamadas', rows);
    return call;
  },

  listOrders(restaurante) {
    return read('pedidos').filter((o) => !restaurante || o.restaurante === restaurante).reverse();
  },

  listCalls(restaurante) {
    return read('llamadas').filter((c) => !restaurante || c.restaurante === restaurante).reverse();
  },

  stats(restaurante) {
    const orders = this.listOrders(restaurante);
    const calls = this.listCalls(restaurante);
    const ventas = orders.reduce((s, o) => s + (o.total ?? 0), 0);
    return {
      llamadas: calls.length,
      pedidos: orders.length,
      ventas: Math.round(ventas * 100) / 100,
      ticket_promedio: orders.length ? Math.round((ventas / orders.length) * 100) / 100 : 0,
      transferidas: calls.filter((c) => c.resultado === 'transferida').length,
      fuera_de_horario: calls.filter((c) => c.fuera_de_horario).length,
    };
  },
};
