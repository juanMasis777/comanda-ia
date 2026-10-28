// Utilidades de hora y horario, siempre en la zona horaria del restaurante.

const DAY_KEYS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const DAY_NAMES = {
  lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves',
  vie: 'viernes', sab: 'sábado', dom: 'domingo',
};

/** Devuelve { dayKey, hhmm, minutes, label } para la zona horaria dada. */
export function nowIn(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayKey = DAY_KEYS[weekdayMap[get('weekday')]];
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  const minute = Number(get('minute'));
  const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { dayKey, hhmm, minutes: hour * 60 + minute, label: `${DAY_NAMES[dayKey]} ${to12h(hhmm)}` };
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function to12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** ¿Está abierto ahora? Devuelve { open, closesAt, nextOpen }. */
export function openStatus(restaurant, date = new Date()) {
  const now = nowIn(restaurant.zona_horaria, date);
  const today = restaurant.horario?.[now.dayKey] ?? [];
  for (const [start, end] of today) {
    if (now.minutes >= toMinutes(start) && now.minutes < toMinutes(end)) {
      return { open: true, closesAt: to12h(end), now };
    }
  }
  return { open: false, nextOpen: nextOpening(restaurant, now), now };
}

function nextOpening(restaurant, now) {
  const startIdx = DAY_KEYS.indexOf(now.dayKey);
  for (let offset = 0; offset < 8; offset++) {
    const key = DAY_KEYS[(startIdx + offset) % 7];
    for (const [start] of restaurant.horario?.[key] ?? []) {
      if (offset === 0 && toMinutes(start) <= now.minutes) continue;
      const when = offset === 0 ? 'hoy' : offset === 1 ? 'mañana' : `el ${DAY_NAMES[key]}`;
      return `${when} a las ${to12h(start)}`;
    }
  }
  return null;
}

/** Horario completo en texto, para el prompt. */
export function scheduleText(restaurant) {
  const order = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
  return order
    .map((key) => {
      const ranges = restaurant.horario?.[key] ?? [];
      const text = ranges.length
        ? ranges.map(([a, b]) => `${to12h(a)} a ${to12h(b)}`).join(' y ')
        : 'cerrado';
      return `${DAY_NAMES[key]}: ${text}`;
    })
    .join('; ');
}

/** Hora (texto) a la que estará listo un pedido. */
export function readyAt(restaurant, minutesFromNow, date = new Date()) {
  const later = new Date(date.getTime() + minutesFromNow * 60_000);
  return to12h(nowIn(restaurant.zona_horaria, later).hhmm);
}

export { DAY_NAMES };
