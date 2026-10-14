const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { assertReady, config } = require('./src/config');
const logger = require('./src/logger');
const { registerApi } = require('./src/routes/api');
const { registerTwilio } = require('./src/routes/twilio');
const { attachCommandCenter, onMessage } = require('./src/ws/commandCenter');
const { attachAudioBridge, overrideCall } = require('./src/ws/audioBridge');
const { listCampaigns } = require('./src/campaigns');

assertReady();

const app = express();
const server = http.createServer(app);
const wssTwilio = new WebSocketServer({ noServer: true });
const wssMobile = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/audiostream') {
    wssTwilio.handleUpgrade(request, socket, head, (ws) => {
      wssTwilio.emit('connection', ws, request);
    });
  } else if (url.pathname === '/mobile') {
    wssMobile.handleUpgrade(request, socket, head, (ws) => {
      wssMobile.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Command-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/', (_req, res) => {
  res.json({
    name: 'BCC BPO Voice',
    docs: 'See README.md for embedding a campaign on a Twilio number',
    health: '/health',
    incomingCall: '/incoming-call',
  });
});

registerApi(app);
registerTwilio(app);
attachAudioBridge(wssTwilio);
attachCommandCenter(wssMobile);
onMessage(wssMobile, async (msg) => {
  if (msg.action !== 'override') return;
  try {
    await overrideCall(msg.callId, 'Supervisor manual override');
  } catch (error) {
    logger.warn('Override failed', { message: error.message });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError || err.status === 400 || err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  logger.error('Unhandled route error', { message: err.message });
  res.status(500).json({ error: 'internal_error' });
});

server.listen(config.port, () => {
  logger.info(`BCC BPO Voice listening on ${config.port}`, {
    campaigns: listCampaigns().map((campaign) => campaign.id),
    defaultCampaign: config.defaultCampaign,
  });
});
