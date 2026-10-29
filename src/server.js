// Arranca el servidor: la web, el WebSocket de voz y el envío automático de reportes.
import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { handleRelaySocket } from './relay.js';
import { startReportScheduler } from './scheduler.js';

const PORT = Number(process.env.PORT || 3000);
const server = http.createServer(createApp());

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/relay') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => handleRelaySocket(ws));
});

server.listen(PORT, () => {
  const q = process.env.DASHBOARD_TOKEN ? '?token=TU_TOKEN' : '';
  console.log(`\nComanda IA escuchando en http://localhost:${PORT}`);
  console.log(`Página de ventas: http://localhost:${PORT}/`);
  console.log(`Panel:            http://localhost:${PORT}/pedidos.html${q}`);
  if (!process.env.PUBLIC_HOST) console.log('Aviso: falta PUBLIC_HOST en .env (tu dominio de ngrok) para recibir llamadas reales.');
  if (!process.env.ANTHROPIC_API_KEY) console.log('Aviso: falta ANTHROPIC_API_KEY en .env.');
  startReportScheduler();
});
