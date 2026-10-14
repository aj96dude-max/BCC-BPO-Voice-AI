const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const CAMPAIGNS_DIR = path.join(__dirname, '..', 'campaigns');

function validateCampaign(input) {
  const campaign = input || {};
  if (!campaign.id || typeof campaign.id !== 'string') {
    throw new Error('Campaign id is required');
  }
  if (!/^[a-z0-9-]+$/.test(campaign.id)) {
    throw new Error('Campaign id must be lowercase letters, numbers, and dashes');
  }
  if (!campaign.name) throw new Error('Campaign name is required');
  if (!campaign.greeting) throw new Error('Campaign greeting is required');
  if (!campaign.persona) throw new Error('Campaign persona is required');
  if (!Array.isArray(campaign.fields) || campaign.fields.length === 0) {
    throw new Error('Campaign needs at least one intake field');
  }
  for (const field of campaign.fields) {
    if (!field.key || !field.label) {
      throw new Error('Each field needs a key and label');
    }
  }
  return {
    id: campaign.id,
    name: campaign.name,
    vertical: campaign.vertical || 'inbound',
    locale: campaign.locale || 'en-US',
    greeting: campaign.greeting,
    persona: campaign.persona,
    closing: campaign.closing || 'Thank you for calling. A specialist will follow up shortly.',
    voiceId: campaign.voiceId || config.elevenLabsVoiceId,
    fields: campaign.fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: Boolean(field.required),
    })),
    transferPhrases: Array.isArray(campaign.transferPhrases) ? campaign.transferPhrases : ['human', 'agent', 'supervisor'],
    complianceNotes: Array.isArray(campaign.complianceNotes) ? campaign.complianceNotes : [],
  };
}

function campaignPath(id) {
  return path.join(CAMPAIGNS_DIR, `${id}.json`);
}

function loadAll() {
  if (!fs.existsSync(CAMPAIGNS_DIR)) fs.mkdirSync(CAMPAIGNS_DIR, { recursive: true });
  const files = fs.readdirSync(CAMPAIGNS_DIR).filter((file) => file.endsWith('.json'));
  const campaigns = {};
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(CAMPAIGNS_DIR, file), 'utf8'));
    const campaign = validateCampaign(raw);
    campaigns[campaign.id] = campaign;
  }
  return campaigns;
}

let cache = loadAll();

function listCampaigns() {
  return Object.values(cache);
}

function getCampaign(id) {
  return cache[id] || null;
}

function resolveCampaign({ campaignId, toNumber }) {
  if (campaignId && cache[campaignId]) return cache[campaignId];
  const mapped = toNumber ? config.numberMap[toNumber] : null;
  if (mapped && cache[mapped]) return cache[mapped];
  if (cache[config.defaultCampaign]) return cache[config.defaultCampaign];
  const first = listCampaigns()[0];
  if (!first) throw new Error('No campaigns are loaded');
  return first;
}

function upsertCampaign(input) {
  const campaign = validateCampaign(input);
  if (!fs.existsSync(CAMPAIGNS_DIR)) fs.mkdirSync(CAMPAIGNS_DIR, { recursive: true });
  fs.writeFileSync(campaignPath(campaign.id), JSON.stringify(campaign, null, 2));
  cache[campaign.id] = campaign;
  return campaign;
}

function reloadCampaigns() {
  cache = loadAll();
  return listCampaigns();
}

module.exports = {
  validateCampaign,
  listCampaigns,
  getCampaign,
  resolveCampaign,
  upsertCampaign,
  reloadCampaigns,
};
