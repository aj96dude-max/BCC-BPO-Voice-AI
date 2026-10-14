const { config, providerStatus } = require('../config');
const campaigns = require('../campaigns');
const calls = require('../calls');
const orders = require('../orders');
const { runAgentTurn } = require('../services/llm');
const { applyAgentTurn, fieldProgress, missingRequired } = require('../agent');
const { overrideCall } = require('../ws/audioBridge');
const logger = require('../logger');

function requireApiKey(req, res, next) {
  if (!config.apiKey) return next();
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key !== config.apiKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

function registerApi(app) {
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'bcc-bpo-voice',
      uptime: Math.round(process.uptime()),
      campaigns: campaigns.listCampaigns().length,
      activeCalls: calls.listActiveCalls().length,
      providers: providerStatus(),
    });
  });

  app.use('/v1', requireApiKey);

  app.get('/v1/campaigns', (_req, res) => {
    res.json({ campaigns: campaigns.listCampaigns() });
  });

  app.get('/v1/campaigns/:id', (req, res) => {
    const campaign = campaigns.getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'campaign not found' });
    return res.json({ campaign });
  });

  app.post('/v1/campaigns', (req, res) => {
    try {
      const campaign = campaigns.upsertCampaign(req.body);
      res.status(201).json({ campaign });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/v1/campaigns/:id', (req, res) => {
    try {
      const campaign = campaigns.upsertCampaign({ ...req.body, id: req.params.id });
      res.json({ campaign });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/v1/campaigns/reload', (_req, res) => {
    res.json({ campaigns: campaigns.reloadCampaigns() });
  });

  app.get('/v1/calls', (_req, res) => {
    res.json({ calls: calls.listRecentCalls().map((call) => {
      const campaign = campaigns.getCampaign(call.campaignId);
      return calls.snapshot(call, campaign);
    }) });
  });

  app.get('/v1/calls/:id', (req, res) => {
    const call = calls.getCall(req.params.id);
    if (!call) return res.status(404).json({ error: 'call not found' });
    const campaign = campaigns.getCampaign(call.campaignId);
    return res.json({
      call: calls.snapshot(call, campaign),
      transcripts: call.transcripts,
      fields: call.fields,
    });
  });

  app.post('/v1/calls/:id/transfer', async (req, res) => {
    try {
      const call = await overrideCall(req.params.id, req.body?.reason);
      res.json({ ok: true, callId: call.id, status: call.status });
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });

  app.get('/v1/orders', (_req, res) => {
    res.json({ orders: orders.listOrders() });
  });

  app.get('/v1/orders/:id', (req, res) => {
    const order = orders.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'order not found' });
    return res.json({ order });
  });

  app.post('/v1/simulate-turn', async (req, res) => {
    const campaignId = req.body?.campaignId || config.defaultCampaign;
    const campaign = campaigns.getCampaign(campaignId);
    if (!campaign) return res.status(404).json({ error: 'campaign not found' });
    const userText = String(req.body?.userText || '').trim();
    if (!userText) return res.status(400).json({ error: 'userText is required' });

    const session = {
      fields: req.body?.fields || {},
      history: Array.isArray(req.body?.history) ? req.body.history : [],
      status: 'collecting',
      campaign,
    };

    try {
      const result = await runAgentTurn({ campaign, session, userText });
      const applied = applyAgentTurn(session, result);
      res.json({
        campaignId: campaign.id,
        speak: applied.speak,
        status: applied.status,
        fields: session.fields,
        progress: fieldProgress(session.fields, campaign.fields),
        missing: missingRequired(session.fields, campaign.fields),
        transfer: session.status === 'transfer',
      });
    } catch (error) {
      logger.error('simulate-turn failed', { message: error.message });
      res.status(503).json({ error: error.message });
    }
  });
}

module.exports = { registerApi };
