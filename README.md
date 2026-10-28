# Comanda IA

Agente de voz con IA que contesta el teléfono de restaurantes latinos, toma pedidos para recoger en español o inglés, los manda a la cocina por SMS y le confirma al cliente por texto.

## En qué es mejor que Slang.ai

| | Slang.ai | Comanda IA |
|---|---|---|
| Cliente | Restaurantes con reservas (OpenTable) | Restaurantes latinos de pedidos para llevar |
| Precio | Desde $399/mes por local | Pensado para $149–$199/mes |
| Número | Pide un número nuevo | Usa el número de siempre (desvío de llamadas) |
| Idioma | Multilingüe genérico | Español latino de Miami primero, cambia a inglés solo |
| Precios | La IA conversa | **El código valida cada plato, opción y precio**: la IA no puede inventar nada |
| Ventas extra | — | Sugiere bebida o postre una sola vez, según reglas del dueño |
| Platos del día | — | Platos que solo se venden ciertos días (ej. nacatamal fin de semana) |
| Hablar con persona | Sí | Sí, por voz o marcando **0** en cualquier momento |

## Las 3 pantallas del panel

Con `npm start` corriendo, abre http://localhost:3000

- **Pedidos**: estadísticas, pedidos y cada llamada con la conversación completa.
- **Menú**: el dueño edita platos, precios, opciones, horario y teléfonos sin tocar código. Botón **"Se acabó"** para que la IA deje de ofrecer un plato. Y **"Leer menú con IA"**: subes fotos o PDF del menú y se arma solo (revisas y guardas).
- **Cocina**: para la tablet de la cocina. Columnas Nuevos / Preparando / Listos, sonido cuando entra un pedido (dale primero a "Activar sonido"), botón para imprimir el ticket y lista rápida de "¿Se acabó algo?".

Los cambios del menú se guardan en `data/restaurantes/` y la IA los usa desde la siguiente llamada. Los archivos de `src/restaurants/` son solo la plantilla inicial.

> Antes de publicar el servidor en internet, pon un `DASHBOARD_TOKEN` en `.env`. Sin token, cualquiera con el link puede editar el menú.

## Estructura

```
src/
  server.js        Servidor: Twilio, WebSocket de voz y panel
  relay.js         Maneja la llamada en vivo (ConversationRelay)
  agent.js         Conversación con Claude y herramientas
  order.js         Motor de pedidos: valida menú, opciones, precios, impuesto
  prompt.js        Instrucciones del agente
  time.js          Horarios y hora local del restaurante
  store.js         Guarda pedidos y llamadas en /data (JSON)
  notify.js        Envía SMS (o los imprime si no hay Twilio)
  validate.js      Revisa el menú antes de guardarlo
  menuImport.js    Lee el menú desde fotos o PDF con Claude
  simulator.js     Prueba el agente escribiendo, sin teléfono
  restaurants/     Un archivo JSON por restaurante (menú, horario, teléfonos)
public/           Panel: index.html (pedidos), menu.html, cocina.html
test/              Pruebas automáticas
```

## Paso 1: Probar sin teléfono (hoy mismo)

Abre PowerShell:

```powershell
cd $HOME\Documents\comanda-ia
npm install
copy .env.example .env
```

Abre `.env` y pega tu clave en `ANTHROPIC_API_KEY` (la sacas en https://console.anthropic.com).

Corre las pruebas (no gastan créditos):

```powershell
npm test
```

Habla con el agente escribiendo:

```powershell
npm run simular
```

Prueba cosas difíciles: "dame dos fritangas, una con maduras y otra con verdes", "¿tienen pizza?", "quiero un nacatamal" (un martes), "I want to order in English", "quiero hablar con el dueño".

Para simular otro día u hora:

```powershell
$env:SIM_FECHA="2026-11-01T19:30:00-04:00"; npm run simular
```

Abre el panel para ver las llamadas y pedidos:

```powershell
npm start
```

Y entra a http://localhost:3000

## Paso 2: Crear la cuenta de Twilio

1. Crea la cuenta en https://www.twilio.com/try-twilio (te dan crédito de prueba).
2. En la consola, copia el **Account SID** y el **Auth Token** a tu `.env`.
3. Ve a **Phone Numbers → Buy a number** y compra un número de Miami (305 o 786) con Voice y SMS. Cuesta $1.15 al mes. Ponlo en `TWILIO_FROM_NUMBER` con formato `+1305...`.
4. Activa ConversationRelay: en la consola busca **Voice → Settings → Predictive and Generative AI/ML Features Addendum** y acéptalo. Sin esto, las llamadas no conectan.
5. Pon ese mismo número en `"twilio_number"` dentro de `src/restaurants/el-rincon-latino.json`.
6. Cambia `telefono_transferencia` y `telefono_cocina` por tu celular para probar.

> Nota: con una cuenta de prueba, Twilio solo deja enviar SMS a números verificados. Verifica tu celular en **Phone Numbers → Verified Caller IDs**.

## Paso 3: Recibir llamadas reales en tu computadora

Twilio necesita llegar a tu computadora por internet. Usa ngrok:

1. Descarga ngrok de https://ngrok.com/download y crea una cuenta gratis.
2. En una terminal: `ngrok http 3000`
3. Copia el dominio que te da (ej. `abcd-1234.ngrok-free.app`) y ponlo en `PUBLIC_HOST` del `.env`, **sin** `https://`.
4. En otra terminal: `npm start`
5. En Twilio, abre tu número → **Voice Configuration → A call comes in → Webhook** y pon:
   `https://abcd-1234.ngrok-free.app/twilio/voice` con método **POST**. Guarda.
6. Llama a tu número de Twilio. 🎉

## Paso 4: Usar el número de siempre del restaurante

El restaurante **no cambia su número**. Le pides a su compañía de teléfono (AT&T, Comcast, etc.) que active **"desvío de llamadas cuando está ocupado o no contestan"** hacia el número de Twilio. Así el personal sigue contestando, y la IA atiende lo que se perdía: hora pico, fuera de horario y llamadas en espera.

## Agregar un restaurante nuevo

Copia `src/restaurants/el-rincon-latino.json` con otro nombre, cámbiale el `id` y reinicia el servidor. Después edita todo lo demás desde la pantalla **Menú** (o carga su menú desde una foto). Cada número de Twilio apunta a su restaurante con el campo "Número de Twilio".

## Costo por llamada (aproximado)

- ConversationRelay: $0.07/min
- Llamada entrante: $0.0085/min
- Claude Haiku: unos centavos por llamada
- **≈ $0.10 por minuto**. Un restaurante con 300 llamadas de 2 minutos ≈ $60/mes.

## Antes de vender

- Haz 50 llamadas de prueba con ruido, acentos y spanglish.
- Revisa el panel: cada pedido debe coincidir con lo que se pidió.
- Cuando tengas más de un cliente, cambia `store.js` por Supabase y publica el servidor en Render o Railway (Vercel no sirve para WebSockets largos).
