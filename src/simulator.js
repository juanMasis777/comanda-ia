// Simulador: habla con el agente escribiendo en la terminal, sin Twilio.
// Uso:  npm run simular
//       npm run simular -- el-rincon-latino +13055551234
// Para probar otro día u hora:  SIM_FECHA="2026-11-01T19:30:00-04:00" npm run simular
import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Agent } from './agent.js';
import { getRestaurant } from './restaurants.js';
import { greeting } from './prompt.js';
import { store } from './store.js';

const key = process.env.ANTHROPIC_API_KEY ?? '';
if (!key || key.includes('xxxx')) {
  console.error('\n❌ Falta tu clave de Anthropic.');
  console.error('   Abre el archivo .env, reemplaza sk-ant-xxxxxxxx por tu clave real y guarda con Ctrl + S.\n');
  process.exit(1);
}

const [restaurantId, callerPhone = '+13055550000'] = process.argv.slice(2);
const restaurant = getRestaurant(restaurantId);
const date = process.env.SIM_FECHA ? new Date(process.env.SIM_FECHA) : undefined;

const agent = new Agent({
  restaurant,
  callerPhone,
  date,
  onLanguage: (idioma) => console.log(`\n   [idioma de la voz → ${idioma === 'en' ? 'inglés' : 'español'}]`),
});

console.log(`\n📞 Simulando llamada a ${restaurant.nombre} desde ${callerPhone}`);
console.log('   Escribe como si hablaras por teléfono. "salir" para colgar.\n');
console.log(`IA: ${greeting(restaurant)}\n`);

const rl = readline.createInterface({ input, output });
while (true) {
  const text = (await rl.question('Tú: ')).trim();
  if (!text) continue;
  if (['salir', 'exit', 'colgar'].includes(text.toLowerCase())) break;

  process.stdout.write('IA: ');
  const started = Date.now();
  let first = null;
  try {
    await agent.respond(text, (t) => {
      first ??= Date.now() - started;
      process.stdout.write(t);
    });
  } catch (err) {
    if (err?.status === 401) {
      console.error('\n\n❌ Anthropic rechazó tu clave (401). Revisa que la copiaste completa en .env y que no fue borrada en la consola.\n');
    } else if (err?.status === 400 && /credit/i.test(err?.message ?? '')) {
      console.error('\n\n❌ Tu cuenta de Anthropic no tiene créditos. Agrega saldo en console.anthropic.com → Billing.\n');
    } else {
      console.error(`\n\n❌ Error hablando con Claude: ${err?.message ?? err}\n`);
    }
    break;
  }
  console.log(`\n   (primera palabra en ${first ?? '-'} ms)\n`);

  if (agent.pendingAction?.type === 'transfer') {
    console.log(`   [Aquí Twilio pasaría la llamada a ${restaurant.telefono_transferencia}. Motivo: ${agent.pendingAction.motivo}]`);
    break;
  }
  if (agent.pendingAction?.type === 'end') {
    console.log('   [La IA colgó la llamada]');
    break;
  }
}

store.saveCall({ ...agent.callRecord(), inicio: new Date().toISOString(), simulada: true });
console.log('\nLlamada guardada. Ábrela en el panel: npm start → http://localhost:3000\n');
rl.close();
