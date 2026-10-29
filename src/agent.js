// El cerebro de la llamada: conversa con Claude y ejecuta las herramientas.
import Anthropic from '@anthropic-ai/sdk';
import { Order, ticketText } from './order.js';
import { systemPrompt, tools } from './prompt.js';
import { openStatus, readyAt } from './time.js';
import { store as defaultStore } from './store.js';
import { sendSms as defaultSendSms } from './notify.js';

const MAX_TOOL_ROUNDS = 6;

/** "(305) 555-1234" → "+13055551234". Devuelve null si no es un número de EE.UU. válido. */
export function normalizePhone(text) {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export class Agent {
  constructor({ restaurant, callerPhone, client, store = defaultStore, sendSms = defaultSendSms, onLanguage, date, canal = 'voz' } = {}) {
    this.r = restaurant;
    this.canal = canal; // 'voz' (teléfono) o 'chat' (página web)
    this.callerPhone = callerPhone;
    this.client = client ?? new Anthropic();
    this.model = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
    this.store = store;
    this.sendSms = sendSms;
    this.onLanguage = onLanguage;
    this.date = date;
    this.order = new Order(restaurant, { date });
    this.messages = [];
    this.transcript = [];
    this.confirmed = null;
    this.language = 'es';
    this.pendingAction = null; // { type: 'transfer' | 'end', motivo }
    this.system = [
      { type: 'text', text: systemPrompt(restaurant, { callerPhone, date, canal }), cache_control: { type: 'ephemeral' } },
    ];
    this.currentStream = null;
  }

  /** Procesa lo que dijo el cliente. onToken recibe el texto a medida que se genera. */
  async respond(userText, onToken = () => {}) {
    this.transcript.push({ rol: 'cliente', texto: userText });
    this.messages.push({ role: 'user', content: userText });

    let spoken = '';
    const emit = (t) => {
      spoken += t;
      onToken(t);
    };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (spoken && !/\s$/.test(spoken)) emit(' ');
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: 400,
        system: this.system,
        tools,
        messages: this.messages,
      });
      this.currentStream = stream;
      stream.on('text', (t) => emit(t));
      // Truco de latencia: si la IA va a usar una herramienta antes de hablar,
      // decimos una muletilla al instante para que el cliente no escuche silencio.
      stream.on('streamEvent', (event) => {
        if (
          this.canal === 'voz' &&
          !spoken &&
          event.type === 'content_block_start' &&
          event.content_block?.type === 'tool_use' &&
          event.content_block.name !== 'terminar_llamada'
        ) {
          emit(this.language === 'en' ? 'Sure. ' : 'Perfecto. ');
        }
      });
      let msg;
      try {
        msg = await stream.finalMessage();
      } catch (err) {
        this.currentStream = null;
        if (!this.aborted) throw err;
        // El cliente habló encima: guardamos lo que alcanzamos a decir y paramos.
        this.aborted = false;
        const partial = spoken.trim();
        this.messages.push({ role: 'assistant', content: `${partial} [el cliente interrumpió]`.trim() });
        break;
      }
      this.currentStream = null;
      this.messages.push({ role: 'assistant', content: msg.content });

      if (msg.stop_reason !== 'tool_use') break;

      const results = [];
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;
        const output = await this.runTool(block.name, block.input ?? {});
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(output) });
      }
      this.messages.push({ role: 'user', content: results });
    }

    const clean = spoken.trim();
    if (clean) this.transcript.push({ rol: 'agente', texto: clean });
    return clean;
  }

  /** El cliente interrumpió: cortamos la respuesta en curso. */
  interrupt() {
    if (!this.currentStream) return;
    this.aborted = true;
    try {
      this.currentStream?.abort();
    } catch {
      /* ignorar */
    }
  }

  async runTool(name, input) {
    switch (name) {
      case 'agregar_item':
        if (this.confirmed) return { ok: false, error: 'El pedido ya fue confirmado y enviado a cocina. Para cambios, transfiere a una persona.' };
        if (!openStatus(this.r, this.date).open) return { ok: false, error: 'El restaurante está cerrado. No se pueden tomar pedidos ahora.' };
        return this.order.addItem(input);

      case 'quitar_item':
        if (this.confirmed) return { ok: false, error: 'El pedido ya fue confirmado.' };
        return this.order.removeLine(input.linea);

      case 'ver_pedido':
        return { ok: true, pedido: this.order.summary() };

      case 'confirmar_pedido':
        return this.confirm(input.nombre_cliente, input.telefono);

      case 'cambiar_idioma': {
        const idioma = input.idioma === 'en' ? 'en' : 'es';
        this.language = idioma;
        this.onLanguage?.(idioma);
        return { ok: true, idioma };
      }

      case 'transferir_a_humano':
        this.pendingAction = { type: 'transfer', motivo: input.motivo ?? '' };
        if (this.canal === 'chat') {
          return { ok: true, instruccion: `Dile al cliente que para eso es mejor hablar con el restaurante y dale el teléfono: ${this.r.telefono_transferencia || 'el del restaurante'}.` };
        }
        return { ok: true, instruccion: 'Dile al cliente en una frase que lo vas a comunicar con una persona. No digas nada más después.' };

      case 'terminar_llamada':
        this.pendingAction = { type: 'end' };
        return { ok: true, instruccion: 'Si no te has despedido, despídete en una frase corta.' };

      default:
        return { ok: false, error: `Herramienta desconocida: ${name}` };
    }
  }

  async confirm(nombre, telefono) {
    if (this.confirmed) return { ok: true, ya_confirmado: true, ...this.confirmed };
    if (this.canal === 'chat') {
      const phone = normalizePhone(telefono);
      if (!phone) return { ok: false, error: 'Falta un teléfono válido de 10 dígitos. Pídeselo al cliente.' };
      this.callerPhone = phone;
    }
    if (this.order.isEmpty) return { ok: false, error: 'El pedido está vacío.' };
    if (!openStatus(this.r, this.date).open) return { ok: false, error: 'El restaurante está cerrado.' };

    const cliente = String(nombre || 'Cliente').slice(0, 60);
    const listo = readyAt(this.r, this.r.minutos_preparacion ?? 20, this.date);
    const totals = this.order.totals();
    const saved = this.store.saveOrder({
      restaurante: this.r.id,
      origen: this.canal === 'chat' ? 'web' : 'telefono',
      cliente,
      telefono: this.callerPhone ?? null,
      listo_a_las: listo,
      lineas: this.order.lines,
      ...totals,
    });

    // Para la voz: "pedido número 7", no "cero cero siete".
    this.confirmed = { numero: Number(saved.numero), total: totals.total, listo_a_las: listo };

    // Avisos: a la cocina y al cliente. Si fallan, el pedido igual queda guardado en el panel.
    const ticket = ticketText(this.r, this.order, { numero: saved.numero, cliente, telefono: this.callerPhone, listo });
    const listoEn = listo.replace('a. m.', 'AM').replace('p. m.', 'PM');
    const customerMsg =
      this.language === 'en'
        ? `${this.r.nombre}: order #${saved.numero} confirmed. Total $${totals.total.toFixed(2)}. Ready around ${listoEn} at ${this.r.direccion}`
        : `${this.r.nombre}: su pedido #${saved.numero} está confirmado. Total $${totals.total.toFixed(2)}. Listo como a las ${listo} en ${this.r.direccion}`;
    await Promise.allSettled([
      this.sendSms(this.r.telefono_cocina, ticket),
      this.callerPhone ? this.sendSms(this.callerPhone, customerMsg) : Promise.resolve(),
    ]);

    return { ok: true, ...this.confirmed, sms_enviado_al_cliente: Boolean(this.callerPhone) };
  }

  /** Resumen de la llamada para el panel del dueño. */
  callRecord(extra = {}) {
    return {
      restaurante: this.r.id,
      canal: this.canal === 'chat' ? 'web' : 'telefono',
      telefono: this.callerPhone ?? null,
      idioma: this.language,
      fuera_de_horario: !openStatus(this.r, this.date).open,
      pedido: this.confirmed,
      resultado: this.pendingAction?.type === 'transfer' ? 'transferida' : this.confirmed ? 'pedido' : 'consulta',
      motivo_transferencia: this.pendingAction?.type === 'transfer' ? this.pendingAction.motivo : null,
      conversacion: this.transcript,
      ...extra,
    };
  }
}
