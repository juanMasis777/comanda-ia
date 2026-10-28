// Motor de pedidos. TODA la validación de precios y opciones vive aquí, no en la IA.
// La IA solo puede pedir cambios a través de estas funciones, así que nunca puede
// inventar un plato, un precio o una opción que no esté en el menú.
import { nowIn, DAY_NAMES } from './time.js';

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const round2 = (n) => Math.round(n * 100) / 100;

export class Order {
  constructor(restaurant, { date } = {}) {
    this.r = restaurant;
    this.lines = [];
    this.nextLineId = 1;
    this.date = date; // para pruebas
  }

  findItem(idOrName) {
    const key = norm(idOrName);
    return (
      this.r.menu.find((i) => norm(i.id) === key) ||
      this.r.menu.find((i) => norm(i.nombre) === key) ||
      this.r.menu.find((i) => (i.alias ?? []).some((a) => norm(a) === key))
    );
  }

  addItem({ item_id, cantidad = 1, opciones = {}, extras = [], nota = '' } = {}) {
    const item = this.findItem(item_id);
    if (!item) {
      return { ok: false, error: `"${item_id}" no está en el menú. Ofrece algo del menú.` };
    }

    if (item.agotado) {
      return { ok: false, error: `${item.nombre} se acabó por hoy. Discúlpate y ofrece otra cosa del menú.` };
    }

    if (item.dias?.length) {
      const today = nowIn(this.r.zona_horaria, this.date ?? new Date()).dayKey;
      if (!item.dias.includes(today)) {
        const dias = item.dias.map((d) => DAY_NAMES[d]).join(' y ');
        return { ok: false, error: `${item.nombre} solo está disponible ${dias}. Hoy no hay.` };
      }
    }

    const qty = Number(cantidad);
    if (!Number.isInteger(qty) || qty < 1 || qty > 30) {
      return { ok: false, error: 'La cantidad debe ser un número entero entre 1 y 30.' };
    }

    // Opciones (sabor, tamaño, tajadas...)
    const chosen = {};
    let extraPrice = 0;
    const given = Object.fromEntries(Object.entries(opciones ?? {}).map(([k, v]) => [norm(k), v]));
    for (const group of item.opciones ?? []) {
      const value = given[norm(group.grupo)];
      if (value == null || value === '') {
        if (group.requerido) {
          const lista = group.elecciones.map((e) => e.nombre).join(', ');
          return { ok: false, error: `Falta elegir ${group.grupo} para ${item.nombre}. Opciones: ${lista}. Pregúntale al cliente.` };
        }
        continue;
      }
      const choice = group.elecciones.find((e) => norm(e.nombre) === norm(value));
      if (!choice) {
        const lista = group.elecciones.map((e) => e.nombre).join(', ');
        return { ok: false, error: `"${value}" no es una opción de ${group.grupo}. Opciones válidas: ${lista}.` };
      }
      chosen[group.grupo] = choice.nombre;
      extraPrice += choice.precio_extra ?? 0;
    }
    const unknownGroups = Object.keys(given).filter(
      (k) => !(item.opciones ?? []).some((g) => norm(g.grupo) === k)
    );
    if (unknownGroups.length) {
      return { ok: false, error: `${item.nombre} no tiene la opción "${unknownGroups.join(', ')}". Si es un cambio sin costo (ej. sin cebolla), ponlo en "nota".` };
    }

    // Extras con costo
    const extrasOk = [];
    for (const name of extras ?? []) {
      const extra = (item.extras ?? []).find((e) => norm(e.nombre) === norm(name));
      if (!extra) {
        const lista = (item.extras ?? []).map((e) => `${e.nombre} ($${e.precio})`).join(', ') || 'ninguno';
        return { ok: false, error: `"${name}" no es un extra de ${item.nombre}. Extras disponibles: ${lista}.` };
      }
      extrasOk.push(extra.nombre);
      extraPrice += extra.precio;
    }

    const unit = round2(item.precio + extraPrice);
    const line = {
      linea: this.nextLineId++,
      item_id: item.id,
      nombre: item.nombre,
      categoria: item.categoria,
      cantidad: qty,
      opciones: chosen,
      extras: extrasOk,
      nota: String(nota ?? '').slice(0, 200),
      precio_unitario: unit,
      subtotal: round2(unit * qty),
    };
    this.lines.push(line);
    return { ok: true, agregado: describeLine(line), pedido: this.summary() };
  }

  removeLine(linea) {
    const idx = this.lines.findIndex((l) => l.linea === Number(linea));
    if (idx === -1) return { ok: false, error: `No existe la línea ${linea}.`, pedido: this.summary() };
    const [removed] = this.lines.splice(idx, 1);
    return { ok: true, quitado: describeLine(removed), pedido: this.summary() };
  }

  get isEmpty() {
    return this.lines.length === 0;
  }

  totals() {
    const subtotal = round2(this.lines.reduce((s, l) => s + l.subtotal, 0));
    const impuesto = round2(subtotal * (this.r.impuesto ?? 0));
    return { subtotal, impuesto, total: round2(subtotal + impuesto) };
  }

  /** Lo que se le devuelve a la IA después de cada cambio. */
  summary() {
    return {
      lineas: this.lines.map((l) => ({ linea: l.linea, descripcion: describeLine(l), subtotal: l.subtotal })),
      ...this.totals(),
      sugerencia: this.suggestion(),
    };
  }

  /** Una sola sugerencia de venta adicional, según las reglas del restaurante. */
  suggestion() {
    const cats = new Set(this.lines.map((l) => l.categoria));
    for (const rule of this.r.sugerencias ?? []) {
      if (cats.has(rule.si_pide_categoria) && !cats.has(rule.sin_categoria)) return rule.frase;
    }
    return null;
  }

  toJSON() {
    return { lineas: this.lines, ...this.totals() };
  }
}

export function describeLine(l) {
  const parts = [`${l.cantidad} x ${l.nombre}`];
  const opts = Object.values(l.opciones ?? {});
  if (opts.length) parts.push(`(${opts.join(', ')})`);
  if (l.extras?.length) parts.push(`con ${l.extras.join(' y ')}`);
  if (l.nota) parts.push(`- nota: ${l.nota}`);
  return parts.join(' ');
}

/** Texto del pedido para el SMS de la cocina. */
export function ticketText(restaurant, order, { numero, cliente, telefono, listo }) {
  const t = order.totals();
  return [
    `NUEVO PEDIDO #${numero} - ${restaurant.nombre}`,
    `Cliente: ${cliente}${telefono ? ` (${telefono})` : ''}`,
    `Recoge: ${listo}`,
    '',
    ...order.lines.map((l) => `- ${describeLine(l)}  $${l.subtotal.toFixed(2)}`),
    '',
    `Total: $${t.total.toFixed(2)} (incluye impuesto)`,
  ].join('\n');
}
