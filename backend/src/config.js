const fs = require('fs');
const path = require('path');

function parseNumberMapEnv(raw) {
  if (!raw) return {};
  const map = {};
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const number = trimmed.slice(0, idx).trim();
    const campaign = trimmed.slice(idx + 1).trim();
    if (number && campaign) map[number] = campaign;
  }
  return map;
}

function loadNumberMapFile() {
  const file = path.join(__dirname, '..', 'config', 'number-map.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      defaultCampaign: data.default || 'generic-inbound',
      numbers: data.numbers || {},
    };
  } catch {
    return { defaultCampaign: 'generic-inbound', numbers: {} };
  }
}

function requiredInProduction(name, value) {
  if (process.env.NODE_ENV === 'production' && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || '';
}

const fileMap = loadNumberMapFile();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 8080,
  publicWsUrl: (process.env.PUBLIC_WS_URL || '').replace(/\/$/, ''),
  publicHttpUrl: (process.env.PUBLIC_HTTP_URL || '').replace(/\/$/, ''),
  apiKey: process.env.BCC_API_KEY || '',
  commandCenterToken: process.env.COMMAND_CENTER_TOKEN || '',

  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
  deepgramModel: process.env.DEEPGRAM_MODEL || 'nova-3',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  elevenLabsModel: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',

  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  transferSipUri: process.env.TRANSFER_SIP_URI || '',
  transferNumber: process.env.TRANSFER_NUMBER || '',
  orderWebhookUrl: process.env.ORDER_WEBHOOK_URL || '',
  orderWebhookSecret: process.env.ORDER_WEBHOOK_SECRET || '',

  defaultCampaign: process.env.DEFAULT_CAMPAIGN || fileMap.defaultCampaign,
  numberMap: {
    ...fileMap.numbers,
    ...parseNumberMapEnv(process.env.CAMPAIGN_NUMBERS),
  },
};

function assertReady() {
  if (config.nodeEnv !== 'production') return;
  requiredInProduction('GROQ_API_KEY', config.groqApiKey);
  requiredInProduction('DEEPGRAM_API_KEY', config.deepgramApiKey);
  requiredInProduction('ELEVENLABS_API_KEY', config.elevenLabsApiKey);
  requiredInProduction('TWILIO_AUTH_TOKEN', config.twilioAuthToken);
  requiredInProduction('BCC_API_KEY', config.apiKey);
}

function providerStatus() {
  return {
    groq: Boolean(config.groqApiKey),
    deepgram: Boolean(config.deepgramApiKey),
    elevenlabs: Boolean(config.elevenLabsApiKey),
    twilio: Boolean(config.twilioAccountSid && config.twilioAuthToken),
    transfer: Boolean(config.transferSipUri || config.transferNumber),
    orderWebhook: Boolean(config.orderWebhookUrl),
  };
}

module.exports = { config, assertReady, providerStatus };
