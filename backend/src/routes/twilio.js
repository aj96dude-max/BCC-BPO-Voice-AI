const twilio = require('twilio');
const { config } = require('../config');
const { resolveCampaign } = require('../campaigns');
const calls = require('../calls');
const { publicWsBase, requestUrl } = require('../util/publicUrl');
const { broadcast } = require('../ws/commandCenter');
const logger = require('../logger');

function validateTwilio(req, res, next) {
  if (!config.twilioAuthToken) {
    if (config.nodeEnv === 'production') {
      return res.status(500).type('text/plain').send('Twilio is not configured');
    }
    return next();
  }
  const signature = req.headers['x-twilio-signature'];
  const url = requestUrl(req);
  const valid = twilio.validateRequest(config.twilioAuthToken, signature, url, req.body || {});
  if (!valid) {
    logger.warn('Rejected Twilio webhook with invalid signature');
    return res.status(403).type('text/plain').send('Invalid signature');
  }
  return next();
}

function registerTwilio(app) {
  app.post('/incoming-call', validateTwilio, (req, res) => {
    const to = req.body?.To || '';
    const from = req.body?.From || '';
    const callSid = req.body?.CallSid || '';
    const campaign = resolveCampaign({
      campaignId: req.query.campaign,
      toNumber: to,
    });
    const call = calls.createCall({ campaign, from, to, callSid });
    logger.info('Incoming call', {
      callId: call.id,
      campaign: campaign.id,
      from,
      to,
    });
    broadcast({ type: 'call.started', call: calls.snapshot(call, campaign) });

    const response = new twilio.twiml.VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({ url: `${publicWsBase(req)}/audiostream` });
    stream.parameter({ name: 'callId', value: call.id });
    stream.parameter({ name: 'campaignId', value: campaign.id });
    stream.parameter({ name: 'from', value: from });
    stream.parameter({ name: 'to', value: to });

    res.type('text/xml');
    res.send(response.toString());
  });
}

module.exports = { registerTwilio };
