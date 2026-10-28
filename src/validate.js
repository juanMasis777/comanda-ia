// Valida la configuración de un restaurante antes de guardarla.
// Devuelve una lista de errores en español (vacía si todo está bien).

export const DAYS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE = /^\+\d{10,15}$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isMoney = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10000;

export function validateRestaurant(r) {
  const errors = [];
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['Los datos del restaurante no son válidos.'];

  if (!ID.test(r.id ?? '')) errors.push('El id del restaurante solo puede tener minúsculas, números y guiones.');
  if (!isText(r.nombre)) errors.push('Falta el nombre del restaurante.');
  if (!isText(r.direccion)) errors.push('Falta la dirección.');

  for (const field of ['telefono_transferencia', 'telefono_cocina', 'twilio_number']) {
    const v = r[field];
    if (v && !PHONE.test(v)) errors.push(`El teléfono "${field}" debe tener formato +13055551234.`);
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: r.zona_horaria });
  } catch {
    errors.push('La zona horaria no es válida (usa America/New_York).');
  }

  if (!Number.isInteger(r.minutos_preparacion) || r.minutos_preparacion < 1 || r.minutos_preparacion > 180) {
    errors.push('El tiempo de preparación debe ser entre 1 y 180 minutos.');
  }
  if (typeof r.impuesto !== 'number' || r.impuesto < 0 || r.impuesto > 0.2) {
    errors.push('El impuesto debe ser un número entre 0 y 0.20 (ej. 0.07 para 7%).');
  }

  // Horario
  if (!r.horario || typeof r.horario !== 'object') {
    errors.push('Falta el horario.');
  } else {
    for (const [day, ranges] of Object.entries(r.horario)) {
      if (!DAYS.includes(day)) {
        errors.push(`Día desconocido en el horario: ${day}.`);
        continue;
      }
      if (!Array.isArray(ranges)) {
        errors.push(`El horario del ${day} no es válido.`);
        continue;
      }
      for (const range of ranges) {
        const [a, b] = Array.isArray(range) ? range : [];
        if (!HHMM.test(a ?? '') || !HHMM.test(b ?? '') || a >= b) {
          errors.push(`Horario inválido el ${day}: usa formato 11:00-21:00 y que la hora de cierre sea después de la apertura.`);
        }
      }
    }
  }

  // Menú
  if (!Array.isArray(r.menu) || r.menu.length === 0) {
    errors.push('El menú debe tener al menos un plato.');
  } else {
    const seen = new Set();
    r.menu.forEach((item, i) => {
      const label = item?.nombre ? `"${item.nombre}"` : `#${i + 1}`;
      if (!item || typeof item !== 'object') {
        errors.push(`El plato ${label} no es válido.`);
        return;
      }
      if (!ID.test(item.id ?? '')) errors.push(`El plato ${label} tiene un id inválido.`);
      else if (seen.has(item.id)) errors.push(`Hay dos platos con el mismo id: ${item.id}.`);
      seen.add(item.id);
      if (!isText(item.nombre)) errors.push(`Al plato ${label} le falta el nombre.`);
      if (!isMoney(item.precio)) errors.push(`El precio de ${label} no es válido.`);
      if (!isText(item.categoria)) errors.push(`Al plato ${label} le falta la categoría.`);
      if (item.agotado != null && typeof item.agotado !== 'boolean') errors.push(`"Agotado" de ${label} debe ser sí o no.`);
      if (item.alias != null && (!Array.isArray(item.alias) || !item.alias.every(isText))) errors.push(`Los alias de ${label} no son válidos.`);
      if (item.dias != null && (!Array.isArray(item.dias) || !item.dias.every((d) => DAYS.includes(d)))) {
        errors.push(`Los días de ${label} no son válidos. Usa: ${DAYS.join(', ')}.`);
      }
      for (const g of item.opciones ?? []) {
        if (!isText(g?.grupo) || !Array.isArray(g.elecciones) || g.elecciones.length === 0) {
          errors.push(`Una opción de ${label} está incompleta.`);
          continue;
        }
        if (!g.elecciones.every((e) => isText(e?.nombre) && isMoney(e.precio_extra ?? 0))) {
          errors.push(`La opción "${g.grupo}" de ${label} tiene elecciones inválidas.`);
        }
      }
      for (const e of item.extras ?? []) {
        if (!isText(e?.nombre) || !isMoney(e.precio)) errors.push(`Un extra de ${label} no es válido.`);
      }
    });
  }

  return errors.slice(0, 25);
}
