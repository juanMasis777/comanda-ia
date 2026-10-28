// Convierte opciones, extras y horarios entre el formato del menú (JSON)
// y un texto fácil de escribir para el dueño. Lo usa el navegador y las pruebas.

const money = (n) => Number(n).toFixed(2);

function parsePrice(text, where) {
  const n = Number(String(text).replace('$', '').trim());
  if (!Number.isFinite(n) || n < 0) throw new Error(`Precio inválido en "${where}".`);
  return Math.round(n * 100) / 100;
}

/** "mediano, grande +1.50" → [{nombre:'mediano', precio_extra:0}, {nombre:'grande', precio_extra:1.5}] */
function parseChoices(text, where) {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)\s*\+\s*\$?([\d.]+)$/);
      return m
        ? { nombre: m[1].trim(), precio_extra: parsePrice(m[2], where) }
        : { nombre: part, precio_extra: 0 };
    });
}

/**
 * Una línea por grupo. El asterisco marca la opción obligatoria:
 *   tamaño*: mediano, grande +1.50
 *   salsa: roja, verde
 */
export function parseOptions(text) {
  return String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx < 1) throw new Error(`Falta ":" en la opción "${line}". Ejemplo: tamaño*: mediano, grande +1.50`);
      let grupo = line.slice(0, idx).trim();
      const requerido = grupo.endsWith('*');
      if (requerido) grupo = grupo.slice(0, -1).trim();
      const elecciones = parseChoices(line.slice(idx + 1), line);
      if (!grupo || elecciones.length === 0) throw new Error(`La opción "${line}" está incompleta.`);
      return { grupo, requerido, elecciones };
    });
}

export function formatOptions(opciones = []) {
  return opciones
    .map((g) => {
      const el = g.elecciones.map((e) => (e.precio_extra ? `${e.nombre} +${money(e.precio_extra)}` : e.nombre)).join(', ');
      return `${g.grupo}${g.requerido ? '*' : ''}: ${el}`;
    })
    .join('\n');
}

/** "aguacate +2.00, queso frito extra +2.50" */
export function parseExtras(text) {
  return String(text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)\s*\+?\s*\$?([\d.]+)$/);
      if (!m || !m[1].trim()) throw new Error(`Extra inválido: "${part}". Ejemplo: aguacate +2.00`);
      return { nombre: m[1].trim(), precio: parsePrice(m[2], part) };
    });
}

export function formatExtras(extras = []) {
  return extras.map((e) => `${e.nombre} +${money(e.precio)}`).join(', ');
}

const pad = (h) => {
  const [hh, mm = '00'] = h.trim().split(':');
  return `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
};

/** "11:00-21:00" o "11:00-15:00, 17:00-22:00". Vacío = cerrado. */
export function parseHours(text) {
  return String(text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((range) => {
      const m = range.match(/^(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)$/);
      if (!m) throw new Error(`Horario inválido: "${range}". Ejemplo: 11:00-21:00`);
      return [pad(m[1]), pad(m[2])];
    });
}

export function formatHours(ranges = []) {
  return ranges.map(([a, b]) => `${a}-${b}`).join(', ');
}

export function parseList(text) {
  return String(text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Un id que no choque con los que ya existen. */
export function uniqueId(name, taken) {
  const base = slugify(name) || 'plato';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}
