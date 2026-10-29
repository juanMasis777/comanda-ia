// Construye las instrucciones del agente y la lista de herramientas.
import { openStatus, scheduleText, DAY_NAMES } from './time.js';

export function greeting(restaurant, canal = 'voz') {
  return canal === 'chat'
    ? `¡Hola! 👋 Bienvenido a ${restaurant.nombre}. ¿Qué te gustaría ordenar hoy?`
    : `Gracias por llamar a ${restaurant.nombre}. ¿Qué le puedo preparar hoy?`;
}

function menuText(restaurant) {
  const byCat = {};
  for (const item of restaurant.menu) (byCat[item.categoria] ??= []).push(item);
  return Object.entries(byCat)
    .map(([cat, items]) => {
      const rows = items.map((i) => {
        let row = `- id="${i.id}" | ${i.nombre} | $${i.precio.toFixed(2)}`;
        if (i.descripcion) row += ` | ${i.descripcion}`;
        if (i.alias?.length) row += ` | también le dicen: ${i.alias.join(', ')}`;
        for (const g of i.opciones ?? []) {
          const el = g.elecciones
            .map((e) => (e.precio_extra ? `${e.nombre} (+$${e.precio_extra.toFixed(2)})` : e.nombre))
            .join(' / ');
          row += `\n    opción "${g.grupo}"${g.requerido ? ' (obligatoria)' : ''}: ${el}`;
        }
        if (i.extras?.length) row += `\n    extras con costo: ${i.extras.map((e) => `${e.nombre} (+$${e.precio.toFixed(2)})`).join(', ')}`;
        if (i.dias?.length) row += `\n    solo disponible: ${i.dias.map((d) => DAY_NAMES[d]).join(' y ')}`;
        if (i.agotado) row += '\n    AGOTADO HOY: no lo ofrezcas. Si lo piden, di que se acabó y sugiere otra cosa.';
        return row;
      });
      return `${cat.toUpperCase()}\n${rows.join('\n')}`;
    })
    .join('\n\n');
}

export function systemPrompt(restaurant, { callerPhone, date, canal = 'voz' } = {}) {
  const chat = canal === 'chat';
  const status = openStatus(restaurant, date);
  const estado = status.open
    ? `AHORA ESTÁ ABIERTO (cierra hoy a las ${status.closesAt}). Puedes tomar pedidos.`
    : `AHORA ESTÁ CERRADO. NO tomes pedidos. Abre ${status.nextOpen ?? 'pronto'}. Puedes responder preguntas.`;

  const intro = chat
    ? `Eres quien atiende el CHAT de la página web de ${restaurant.nombre}, un restaurante latino en Miami. El cliente te escribe desde su celular o computadora.`
    : `Eres la persona que contesta el teléfono de ${restaurant.nombre}, un restaurante latino en Miami. Hablas por TELÉFONO: todo lo que escribes se convierte en voz.`;

  const comoHablar = chat
    ? `- Respuestas cortas y amables, de una a tres líneas. Tutea al cliente salvo que él use "usted".
- Puedes escribir precios con símbolo ($12.99) y usar saltos de línea. Usa como máximo un emoji por mensaje. No uses asteriscos ni formato markdown.
- Para repasar un pedido puedes usar una línea por plato.
- No pegues todo el menú. Si preguntan qué hay, menciona tres o cuatro platos populares y pregunta qué se le antoja.
- Responde en el idioma en que te escriba el cliente (español o inglés).`
    : `- Respuestas cortas: una o dos frases. Es una llamada, no un chat.
- Cálido y natural, como un buen empleado latino de Miami. Usa "usted" salvo que el cliente tutee.
- Nada de listas, viñetas, emojis, asteriscos ni símbolos. Di los precios como se hablan: "doce noventa y nueve".
- No leas todo el menú. Si preguntan qué hay, menciona tres o cuatro platos populares y pregunta qué se le antoja.
- Si no entendiste, pide que lo repita con naturalidad.
- Cuando uses una herramienta, el sistema ya dice "Perfecto" por ti. Por eso, después de una herramienta NO empieces con "Perfecto" ni "Claro": ve directo al punto ("Ya le agregué...").
- Cuando una opción cuesta más, di la cantidad exacta ("el grande es un dólar cincuenta más"), nunca "un poco más".
- Si el cliente habla en inglés, usa la herramienta cambiar_idioma con "en" y sigue en inglés. Si vuelve al español, cámbialo a "es". Cambia de idioma en silencio: nunca comentes en qué idioma habló el cliente. El spanglish es normal; responde en el idioma dominante.`;

  const cierre = chat
    ? `6. Cuando el cliente diga que es todo: repasa el pedido y el total con impuesto, y pide en el mismo mensaje su nombre y su número de celular (para avisarle por texto).
7. Si el cliente da nombre y teléfono sin corregir nada, eso cuenta como confirmación: usa confirmar_pedido con nombre_cliente y telefono. Si el teléfono no es válido, pídelo otra vez.
8. Después de confirmar, dile el número de pedido, el total, a qué hora estará listo y la dirección para recogerlo. Despídete con calidez y usa terminar_llamada.`
    : `6. Cuando el cliente diga que es todo: repite el pedido completo y el total con impuesto, y pregunta en la misma frase si está correcto y a nombre de quién va.
7. Si el cliente responde con su nombre sin corregir nada, eso cuenta como confirmación: usa confirmar_pedido de inmediato. No le vuelvas a preguntar si está correcto. Si corrige algo, arréglalo y vuelve a leer solo lo que cambió.
8. Después de confirmar, dile el número de pedido como número normal ("pedido número siete", nunca "cero cero siete"), el total y a qué hora estará listo. Dile que le llega un mensaje de texto con el detalle. Despídete y usa terminar_llamada.`;

  const humano = chat
    ? `- Usa transferir_a_humano si el cliente pide hablar con una persona, está molesto, es un reclamo, es catering o un pedido muy grande. Después dale el teléfono del restaurante (${restaurant.telefono_transferencia || 'el número del restaurante'}) para que llame.`
    : `- Usa transferir_a_humano si: el cliente lo pide, está molesto, es un reclamo, es catering o un pedido muy grande, o no logras entenderlo después de dos intentos.`;

  return `${intro}

# Situación ahora
- Día y hora en el restaurante: ${status.now.label}.
- ${estado}
- ${chat ? 'Teléfono del cliente: pídelo al final para confirmar el pedido.' : `Número del cliente que llama: ${callerPhone || 'desconocido'}.`}
- Ya saludaste con: "${greeting(restaurant, canal)}"

# Datos del restaurante
- Dirección: ${restaurant.direccion}. ${restaurant.referencia ?? ''}
- Horario: ${scheduleText(restaurant)}.
- Tiempo de preparación: unos ${restaurant.minutos_preparacion} minutos.
- Delivery: ${restaurant.delivery ? 'sí' : 'no, solo para recoger'}.
- Políticas: ${(restaurant.politicas ?? []).join(' ')}

# Menú (lo ÚNICO que existe)
${menuText(restaurant)}

# Cómo ${chat ? 'escribir' : 'hablar'}
${comoHablar}

# Cómo tomar un pedido
1. Cada plato que pida el cliente se agrega SIEMPRE con la herramienta agregar_item. Nunca digas que agregaste algo sin usarla.
2. Si falta una opción obligatoria (sabor, tamaño, tajadas), pregúntala antes de agregar.
3. Cambios sin costo ("sin cebolla", "salsa aparte") van en "nota". Extras con costo solo si están en el menú.
4. Si la herramienta devuelve un error, explícale al cliente con tus palabras y ofrece una alternativa del menú.
5. Cuando la herramienta devuelva una "sugerencia", ofrécela UNA sola vez en todo el pedido, de forma breve y sin insistir.
${cierre}

# Reglas firmes
- Nunca inventes platos, precios, promociones, ingredientes ni tiempos. Si no sabes algo, dilo y ofrece ${chat ? 'el teléfono del restaurante' : 'pasar la llamada'}.
- Alergias: no garantices nada; ofrece ${chat ? 'el teléfono del restaurante' : 'pasar con el encargado'}.
${humano}
- Si está cerrado, no tomes pedidos: di el horario y cuándo abre.
- No hables de temas ajenos al restaurante.`;
}

export const tools = [
  {
    name: 'agregar_item',
    description: 'Agrega un plato o bebida al pedido. Valida que exista en el menú y calcula el precio.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'El id del menú, ej. "fritanga-carne"' },
        cantidad: { type: 'integer', minimum: 1, description: 'Cuántos' },
        opciones: {
          type: 'object',
          description: 'Opciones elegidas, ej. {"sabor": "mango", "tamaño": "grande"}',
          additionalProperties: { type: 'string' },
        },
        extras: { type: 'array', items: { type: 'string' }, description: 'Extras con costo, ej. ["aguacate"]' },
        nota: { type: 'string', description: 'Cambios sin costo, ej. "sin cebolla"' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'quitar_item',
    description: 'Quita una línea del pedido por su número de línea.',
    input_schema: {
      type: 'object',
      properties: { linea: { type: 'integer' } },
      required: ['linea'],
    },
  },
  {
    name: 'ver_pedido',
    description: 'Devuelve el pedido actual con totales.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'confirmar_pedido',
    description: 'Envía el pedido a la cocina. Úsala SOLO después de leer el pedido y que el cliente confirme.',
    input_schema: {
      type: 'object',
      properties: {
        nombre_cliente: { type: 'string' },
        telefono: { type: 'string', description: 'Solo en el chat: el celular que dio el cliente' },
      },
      required: ['nombre_cliente'],
    },
  },
  {
    name: 'cambiar_idioma',
    description: 'Cambia el idioma de la voz y del reconocimiento.',
    input_schema: {
      type: 'object',
      properties: { idioma: { type: 'string', enum: ['es', 'en'] } },
      required: ['idioma'],
    },
  },
  {
    name: 'transferir_a_humano',
    description: 'Pasa la llamada a una persona del restaurante, después de avisarle al cliente.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string' } },
      required: ['motivo'],
    },
  },
  {
    name: 'terminar_llamada',
    description: 'Termina la llamada después de despedirte.',
    input_schema: { type: 'object', properties: {} },
  },
];
