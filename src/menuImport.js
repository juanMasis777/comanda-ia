// Lee la foto o el PDF del menú de un restaurante con Claude y lo convierte
// al formato de Comanda IA. NO guarda nada: el dueño revisa y guarda después.
import Anthropic from '@anthropic-ai/sdk';
import { uniqueId } from '../public/menu-format.js';

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

const TOOL = {
  name: 'guardar_menu',
  description: 'Guarda el menú leído de las imágenes.',
  input_schema: {
    type: 'object',
    properties: {
      nombre_restaurante: { type: 'string', description: 'Nombre del restaurante si aparece en el menú' },
      platos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nombre: { type: 'string' },
            categoria: { type: 'string', description: 'En español y minúscula: platos, acompañantes, bebidas, postres, desayunos, etc.' },
            precio: { type: 'number', description: 'Precio base en dólares (la opción más barata)' },
            descripcion: { type: 'string' },
            opciones: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  grupo: { type: 'string', description: 'Ej. tamaño, sabor, proteína' },
                  requerido: { type: 'boolean' },
                  elecciones: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        nombre: { type: 'string' },
                        precio_extra: { type: 'number', description: 'Cuánto más cuesta que el precio base' },
                      },
                      required: ['nombre'],
                    },
                  },
                },
                required: ['grupo', 'elecciones'],
              },
            },
            extras: {
              type: 'array',
              items: {
                type: 'object',
                properties: { nombre: { type: 'string' }, precio: { type: 'number' } },
                required: ['nombre', 'precio'],
              },
            },
          },
          required: ['nombre', 'categoria', 'precio'],
        },
      },
      notas: { type: 'string', description: 'Lo que no se pudo leer bien o quedó dudoso' },
    },
    required: ['platos'],
  },
};

const INSTRUCTIONS = `Lee este menú de restaurante y guárdalo con la herramienta guardar_menu.
- Extrae cada plato y bebida con su precio exacto en dólares.
- Categorías en español y en minúscula (platos, acompañantes, bebidas, postres, desayunos...).
- Si un plato tiene tamaños, sabores o proteínas a elegir, ponlos en "opciones": precio = la opción más barata y precio_extra = la diferencia. Marca requerido=true si el cliente tiene que elegir.
- Los agregados con costo (ej. "aguacate +$2") van en "extras".
- No inventes nada que no esté en el menú. Si un precio no se lee, omite ese plato y menciónalo en "notas".`;

const round = (n) => Math.round(Number(n) * 100) / 100;
const clean = (s) => String(s ?? '').trim();

/** Limpia lo que devuelve Claude y lo deja listo para el editor. */
export function normalizeImported(input = {}) {
  const taken = new Set();
  const menu = [];
  const omitidos = [];
  for (const p of input.platos ?? []) {
    const nombre = clean(p.nombre);
    const precio = p.precio == null || p.precio === '' ? NaN : Number(p.precio);
    if (!nombre || !Number.isFinite(precio) || precio < 0) {
      omitidos.push(nombre || '(sin nombre)');
      continue;
    }
    const item = {
      id: uniqueId(nombre, taken),
      nombre,
      categoria: clean(p.categoria).toLowerCase() || 'platos',
      precio: round(precio),
    };
    if (clean(p.descripcion)) item.descripcion = clean(p.descripcion);
    const opciones = (p.opciones ?? [])
      .map((g) => ({
        grupo: clean(g.grupo).toLowerCase(),
        requerido: Boolean(g.requerido),
        elecciones: (g.elecciones ?? [])
          .filter((e) => clean(e.nombre))
          .map((e) => ({ nombre: clean(e.nombre), precio_extra: Math.max(0, round(e.precio_extra ?? 0)) })),
      }))
      .filter((g) => g.grupo && g.elecciones.length);
    if (opciones.length) item.opciones = opciones;
    const extras = (p.extras ?? [])
      .filter((e) => clean(e.nombre) && Number.isFinite(Number(e.precio)))
      .map((e) => ({ nombre: clean(e.nombre), precio: round(e.precio) }));
    if (extras.length) item.extras = extras;
    menu.push(item);
  }
  return {
    nombre_restaurante: clean(input.nombre_restaurante) || null,
    menu,
    omitidos,
    notas: clean(input.notas) || null,
  };
}

/** files: [{ media_type, data }] con data en base64. */
export async function menuFromFiles(files, { client = new Anthropic(), model } = {}) {
  const content = files.map((f) =>
    f.media_type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: f.media_type, data: f.data } }
      : { type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } }
  );
  content.push({ type: 'text', text: INSTRUCTIONS });

  const msg = await client.messages.create({
    model: model || process.env.CLAUDE_IMPORT_MODEL || 'claude-sonnet-5-5',
    max_tokens: 16000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content }],
  });

  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('La IA no pudo leer el menú. Prueba con una foto más clara.');
  const result = normalizeImported(block.input);
  if (msg.stop_reason === 'max_tokens') result.notas = `${result.notas ?? ''} El menú es muy largo: puede que falten platos al final. Súbelo por partes.`.trim();
  return result;
}
