// Reporte semanal: lo que la IA hizo por el restaurante.
import { nowIn } from './time.js';

const DAYS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const round2 = (n) => Math.round(n * 100) / 100;

// ── Fechas en la zona horaria del restaurante ──
function tzOffsetMs(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - date.getTime();
}

export function localYMD(timeZone, date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Medianoche local de una fecha "2026-10-19", como instante real. */
export function localMidnight(timeZone, ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(timeZone, new Date(guess));
  const fix = tzOffsetMs(timeZone, new Date(t));
  if (guess - fix !== t) t = guess - fix;
  return new Date(t);
}

/** El lunes de la semana de esa fecha (en hora local). */
export function mondayOf(timeZone, date) {
  const idx = DAYS.indexOf(nowIn(timeZone, date).dayKey);
  return addDays(localYMD(timeZone, date), -idx);
}

/** El lunes de la semana pasada (la última semana completa). */
export const lastFullWeek = (timeZone, now = new Date()) => addDays(mondayOf(timeZone, now), -7);

export function weekRange(timeZone, monday) {
  const desde = localMidnight(timeZone, monday);
  const hasta = localMidnight(timeZone, addDays(monday, 7));
  const fmt = (ymd) => new Intl.DateTimeFormat('es-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));
  return { desde, hasta, semana: monday, etiqueta: `${fmt(monday)} – ${fmt(addDays(monday, 6))}` };
}

const inRange = (iso, { desde, hasta }) => {
  const t = new Date(iso).getTime();
  return t >= desde.getTime() && t < hasta.getTime();
};

const pct = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

/** Calcula el reporte de la semana que empieza en `monday`. */
export function weeklyReport(restaurant, allOrders, allCalls, monday) {
  const tz = restaurant.zona_horaria;
  const range = weekRange(tz, monday);
  const prev = weekRange(tz, addDays(monday, -7));

  const mine = (rows) => rows.filter((x) => x.restaurante === restaurant.id);
  const orders = mine(allOrders).filter((o) => o.estado !== 'cancelado');
  const calls = mine(allCalls);

  const ordersNow = orders.filter((o) => inRange(o.creado, range));
  const ordersPrev = orders.filter((o) => inRange(o.creado, prev));
  const callsNow = calls.filter((c) => inRange(c.inicio, range));
  const callsPrev = calls.filter((c) => inRange(c.inicio, prev));

  const ventas = round2(ordersNow.reduce((s, o) => s + (o.total ?? 0), 0));
  const ventasPrev = round2(ordersPrev.reduce((s, o) => s + (o.total ?? 0), 0));

  // Minutos de teléfono que atendió la IA (si la llamada no guardó duración, contamos 2 min)
  let estimado = false;
  const minutos = callsNow
    .filter((c) => (c.canal ?? 'telefono') === 'telefono')
    .reduce((s, c) => {
      if (c.inicio && c.fin) return s + Math.max(0, (new Date(c.fin) - new Date(c.inicio)) / 60000);
      estimado = true;
      return s + 2;
    }, 0);

  // Platos más vendidos
  const platos = new Map();
  for (const o of ordersNow) {
    for (const l of o.lineas ?? []) {
      const p = platos.get(l.item_id) ?? { nombre: l.nombre, cantidad: 0, ingresos: 0 };
      p.cantidad += l.cantidad;
      p.ingresos = round2(p.ingresos + l.subtotal);
      platos.set(l.item_id, p);
    }
  }
  const top = [...platos.values()].sort((a, b) => b.cantidad - a.cantidad || b.ingresos - a.ingresos).slice(0, 5);

  // Horas y días con más movimiento
  const horas = Array(24).fill(0);
  const dias = Object.fromEntries(DAYS.map((d) => [d, 0]));
  for (const c of callsNow) {
    const n = nowIn(tz, new Date(c.inicio));
    horas[Math.floor(n.minutes / 60)] += 1;
    dias[n.dayKey] += 1;
  }
  const horaPico = horas.some(Boolean) ? horas.indexOf(Math.max(...horas)) : null;
  const diaPico = Object.values(dias).some(Boolean) ? Object.entries(dias).sort((a, b) => b[1] - a[1])[0][0] : null;

  // Clientes que repiten (ya habían pedido antes o pidieron más de una vez esta semana)
  const before = new Set(orders.filter((o) => new Date(o.creado) < range.desde && o.telefono).map((o) => o.telefono));
  const countNow = new Map();
  for (const o of ordersNow) if (o.telefono) countNow.set(o.telefono, (countNow.get(o.telefono) ?? 0) + 1);
  const repiten = [...countNow].filter(([tel, n]) => before.has(tel) || n > 1).length;

  return {
    restaurante: restaurant.id,
    nombre: restaurant.nombre,
    semana: range.semana,
    etiqueta: range.etiqueta,
    conversaciones: callsNow.length,
    llamadas: callsNow.filter((c) => (c.canal ?? 'telefono') === 'telefono').length,
    chats: callsNow.filter((c) => c.canal === 'web').length,
    pedidos: ordersNow.length,
    pedidos_telefono: ordersNow.filter((o) => (o.origen ?? 'telefono') === 'telefono').length,
    pedidos_web: ordersNow.filter((o) => o.origen === 'web').length,
    ventas,
    ticket_promedio: ordersNow.length ? round2(ventas / ordersNow.length) : 0,
    minutos_atendidos: Math.round(minutos),
    minutos_estimados: estimado,
    fuera_de_horario: callsNow.filter((c) => c.fuera_de_horario).length,
    transferidas: callsNow.filter((c) => c.resultado === 'transferida').length,
    clientes: countNow.size,
    clientes_que_repiten: repiten,
    top_platos: top,
    horas,
    dias,
    hora_pico: horaPico,
    dia_pico: diaPico,
    comparacion: {
      ventas: pct(ventas, ventasPrev),
      pedidos: pct(ordersNow.length, ordersPrev.length),
      conversaciones: pct(callsNow.length, callsPrev.length),
    },
  };
}

const DAY_NAMES = { lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábado', dom: 'domingo' };
const hour12 = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'a. m.' : 'p. m.'}`;
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Texto corto para el SMS del lunes. */
export function reportSms(rep, link) {
  const lines = [`Comanda IA · ${rep.nombre}`, `Semana ${rep.etiqueta}:`];
  if (!rep.conversaciones) {
    lines.push('Esta semana no entraron llamadas ni chats a la IA.');
  } else {
    lines.push(`- ${rep.conversaciones} clientes atendidos (${rep.llamadas} llamadas, ${rep.chats} chats)`);
    lines.push(`- ${rep.pedidos} pedidos por ${money(rep.ventas)}`);
    if (rep.comparacion.ventas != null) lines.push(`- Ventas ${rep.comparacion.ventas >= 0 ? '+' : ''}${rep.comparacion.ventas}% vs semana anterior`);
    if (rep.top_platos[0]) lines.push(`- Lo más pedido: ${rep.top_platos[0].nombre}`);
    if (rep.hora_pico != null) lines.push(`- Hora con más llamadas: ${hour12(rep.hora_pico)}${rep.dia_pico ? ` (${DAY_NAMES[rep.dia_pico]})` : ''}`);
  }
  if (link) lines.push(`Ver reporte: ${link}`);
  return lines.join('\n');
}
