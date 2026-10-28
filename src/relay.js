// Maneja una llamada en vivo con Twilio ConversationRelay.
// Twilio convierte la voz del cliente en texto y nos lo manda por WebSocket;
// nosotros respondemos con texto y Twilio lo convierte en voz.
import { Agent } from './agent.js';
import { getRestaurant } from './restaurants.js';
import { store } from './store.js';

const LANG = {
  es: { ttsLanguage: 'es-US', transcriptionLanguage: 'es-US' },
  en: { ttsLanguage: 'en-US', transcriptionLanguage: 'en-US' },
};

// Tiempo aproximado para que Twilio termine de decir la última frase antes de colgar o transferir.
const speakingTime = (text) => Math.min(9000, 1200 + text.length * 60);

export function handleRelaySocket(ws) {
  let agent = null;
  let call = { inicio: new Date().toISOString() };
  let queue = Promise.resolve();
  let finished = false;

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  const finish = (action, lastText) => {
    if (finished) return;
    finished = true;
    const handoffData = JSON.stringify({
      accion: action.type,
      motivo: action.motivo ?? '',
      restaurante: agent?.r.id,
    });
    setTimeout(() => send({ type: 'end', handoffData }), speakingTime(lastText));
  };

  const turn = async (text) => {
    if (!agent || finished) return;
    try {
      const reply = await agent.respond(text, (token) => send({ type: 'text', token, last: false }));
      send({ type: 'text', token: '', last: true });
      if (agent.pendingAction) finish(agent.pendingAction, reply);
    } catch (err) {
      console.error('[relay] Error en el turno:', err);
      send({ type: 'text', token: 'Disculpe, tuve un problema. Le paso con una persona.', last: true });
      finish({ type: 'transfer', motivo: 'error técnico' }, 'Disculpe, tuve un problema.');
    }
  };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'setup': {
        const restaurant = getRestaurant(msg.customParameters?.restaurant);
        call = { ...call, call_sid: msg.callSid, desde: msg.from, hacia: msg.to };
        agent = new Agent({
          restaurant,
          callerPhone: msg.from,
          onLanguage: (idioma) => send({ type: 'language', ...LANG[idioma] }),
        });
        console.log(`[relay] Llamada ${msg.callSid} de ${msg.from} → ${restaurant.nombre}`);
        break;
      }

      case 'prompt':
        // Solo procesamos la transcripción final de lo que dijo el cliente.
        if (msg.last === false || !msg.voicePrompt?.trim()) return;
        console.log(`[cliente] ${msg.voicePrompt}`);
        queue = queue.then(() => turn(msg.voicePrompt));
        break;

      case 'interrupt':
        agent?.interrupt();
        break;

      case 'dtmf':
        // Marcar 0 en cualquier momento = hablar con una persona.
        if (msg.digit === '0' && agent && !finished) {
          agent.pendingAction = { type: 'transfer', motivo: 'el cliente marcó 0' };
          const text = 'Con gusto, le comunico con una persona.';
          send({ type: 'text', token: text, last: true });
          finish(agent.pendingAction, text);
        }
        break;

      case 'error':
        console.error('[relay] Error reportado por Twilio:', msg.description);
        break;
    }
  });

  ws.on('close', () => {
    if (!agent) return;
    store.saveCall({ ...agent.callRecord(), ...call, fin: new Date().toISOString() });
    console.log(`[relay] Llamada ${call.call_sid} terminada (${agent.callRecord().resultado})`);
  });
}
