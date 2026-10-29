// Crea el enlace de acceso para el dueño de un restaurante.
// Uso:  npm run acceso -- el-rincon-latino
import 'dotenv/config';
import { createOwnerAccess } from '../src/routes/panel.js';
import { listRestaurants } from '../src/restaurants.js';

const id = process.argv[2];
if (!id) {
  console.log('\nUso: npm run acceso -- ID_DEL_RESTAURANTE\n');
  console.log('Restaurantes:', listRestaurants().map((r) => r.id).join(', '), '\n');
  process.exit(1);
}
const result = createOwnerAccess(id);
if (!result.ok) {
  console.error('\n❌', result.errores.join(' '), '\n');
  process.exit(1);
}
const base = process.env.PUBLIC_HOST ? `https://${process.env.PUBLIC_HOST}` : `http://localhost:${process.env.PORT || 3000}`;
console.log('\n✅ Enlace del dueño (guárdalo, no se vuelve a mostrar):\n');
console.log(`   ${base}/pedidos.html?token=${encodeURIComponent(result.token)}\n`);
console.log('   Si lo vuelves a generar, el enlace anterior deja de funcionar.\n');
