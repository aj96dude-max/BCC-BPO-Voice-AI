const twilio = require('twilio');
const { config } = require('../config');
const logger = require('../logger');

function transferTwiml() {
  const response = new twilio.twiml.VoiceResponse();
  if (!config.transferSipUri && !config.transferNumber) {
    response.say('I am sorry, no live agent is available right now. Please try again later.');
    return response.toString();
  }
  response.say('Please hold while I connect you with a specialist.');
  const dial = response.dial({ timeout: 30 });
  if (config.transferSipUri) {
    dial.sip(config.transferSipUri);
  } else {
    dial.number(config.transferNumber);
  }
  return response.toString();
}

async function transferCall(callSid) {
  if (!callSid) throw new Error('Cannot transfer a call without a CallSid');
  if (!config.twilioAccountSid || !config.twilioAuthToken) {
    throw new Error('Twilio credentials are not configured for live transfer');
  }
  const client = twilio(config.twilioAccountSid, config.twilioAuthToken);
  logger.info('Transferring call to live agent', { callSid });
  await client.calls(callSid).update({ twiml: transferTwiml() });
}

function canTransfer() {
  return Boolean(
    config.twilioAccountSid
    && config.twilioAuthToken
    && (config.transferSipUri || config.transferNumber),
  );
}

module.exports = { transferCall, transferTwiml, canTransfer };
