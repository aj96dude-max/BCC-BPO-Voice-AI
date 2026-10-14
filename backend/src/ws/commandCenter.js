const { WebSocket } = require('ws');
const { config } = require('../config');
const logger = require('../logger');

const clients = new Set();

function isAuthorized(request) {
  if (!config.commandCenterToken) return true;
  try {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token') || request.headers['x-command-token'];
    return token === config.commandCenterToken;
  } catch {
    return false;
  }
}

function attachCommandCenter(wss) {
  wss.on('connection', (ws, request) => {
    if (!isAuthorized(request)) {
      ws.close(1008, 'unauthorized');
      return;
    }
    clients.add(ws);
    logger.info('Command center connected', { clients: clients.size });
    ws.send(JSON.stringify({ type: 'hello', clients: clients.size }));

    ws.on('close', () => {
      clients.delete(ws);
      logger.info('Command center disconnected', { clients: clients.size });
    });
    ws.on('error', (error) => {
      logger.warn('Command center socket error', { message: error.message });
    });
  });
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function onMessage(wss, handler) {
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        handler(JSON.parse(raw.toString()), ws);
      } catch (error) {
        logger.warn('Invalid command center message', { message: error.message });
      }
    });
  });
}

module.exports = { attachCommandCenter, broadcast, onMessage };
