// Envía el reporte semanal cada lunes a partir de las 9:00 a. m. (hora del restaurante).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRestaurantsFull } from './restaurants.js';
import { nowIn } from './time.js';
import { lastFullWeek } from './report.js';
import { sendReport, baseUrl } from './routes/report.js';

const dataDir = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const logFile = () => path.join(dataDir, 'reportes_enviados.json');

function readLog() {
  try {
    return JSON.parse(fs.readFileSync(logFile(), 'utf8'));
  } catch {
    return {};
  }
}

/** Revisa todos los restaurantes y manda los reportes que toquen. */
export async function runDueReports({ now = new Date(), send } = {}) {
  const log = readLog();
  const sent = [];
  for (const r of listRestaurantsFull()) {
    if (!r.reporte_semanal || !r.telefono_dueno) continue;
    const local = nowIn(r.zona_horaria, now);
    if (local.dayKey !== 'lun' || local.minutes < 9 * 60) continue;
    const semana = lastFullWeek(r.zona_horaria, now);
    if (log[r.id] === semana) continue;
    const result = await sendReport(r, semana, baseUrl(), send);
    if (result.ok) {
      log[r.id] = semana;
      sent.push(r.id);
      console.log(`[reporte] Enviado a ${r.nombre} (semana ${semana})`);
    } else {
      console.warn(`[reporte] No se pudo enviar a ${r.nombre}: ${result.errores.join(' ')}`);
    }
  }
  if (sent.length) fs.writeFileSync(logFile(), JSON.stringify(log, null, 2));
  return sent;
}

export function startReportScheduler() {
  const tick = () => runDueReports().catch((err) => console.error('[reporte]', err));
  setTimeout(tick, 5_000).unref();
  setInterval(tick, 10 * 60 * 1000).unref();
}
