const Groq = require('groq-sdk');
const { config } = require('../config');
const { parseLlmJson, normalizeAgentTurn } = require('../util/json');
const { missingRequired } = require('../agent');
const logger = require('../logger');

let client = null;

function getClient() {
  if (!config.groqApiKey) {
    throw new Error('GROQ_API_KEY is not configured');
  }
  if (!client) client = new Groq({ apiKey: config.groqApiKey });
  return client;
}

function buildSystemPrompt(campaign, session) {
  const fieldLines = campaign.fields
    .map((field) => `- ${field.key} (${field.label})${field.required ? ' [required]' : ''}`)
    .join('\n');
  const captured = JSON.stringify(session.fields || {}, null, 2);
  const missing = missingRequired(session.fields, campaign.fields);
  const notes = (campaign.complianceNotes || []).map((note) => `- ${note}`).join('\n');

  return `You are a live inbound voice agent for a US call center campaign.

Campaign: ${campaign.name}
Vertical: ${campaign.vertical}
Persona: ${campaign.persona}

Intake fields:
${fieldLines}

Already captured:
${captured}

Still missing required fields: ${missing.length ? missing.join(', ') : 'none'}

Compliance:
${notes || '- Follow the campaign persona.'}

Rules:
- Reply with JSON only.
- JSON shape: {"speak":"string","extracted":{"field_key":"value"},"status":"collecting|confirming|complete|transfer","transfer":false,"transferReason":""}
- speak is what you say out loud. One or two short sentences. Conversational US English. No markdown, no lists, no emojis.
- Ask for only one missing required field at a time unless the caller already volunteered several.
- Put newly learned values in extracted. Do not guess.
- If the caller asks for a human, set transfer true and status transfer.
- When every required field is captured, briefly read back the key details and ask if that is correct. If they confirm, set status complete and speak the closing idea: ${campaign.closing}
- Never mention that you are an AI model vendor. You are the campaign's intake specialist.`;
}

async function runAgentTurn({ campaign, session, userText, signal }) {
  const groq = getClient();
  const messages = [
    { role: 'system', content: buildSystemPrompt(campaign, session) },
    ...session.history,
    { role: 'user', content: userText },
  ];

  const request = {
    model: config.groqModel,
    temperature: 0.2,
    max_tokens: 400,
    messages,
  };

  let content = '';
  try {
    const completion = await groq.chat.completions.create(
      { ...request, response_format: { type: 'json_object' } },
      { signal },
    );
    content = completion.choices[0].message.content || '';
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    logger.warn('JSON mode failed, retrying plain completion', { message: error.message });
    const completion = await groq.chat.completions.create(request, { signal });
    content = completion.choices[0].message.content || '';
  }

  return normalizeAgentTurn(parseLlmJson(content));
}

module.exports = { runAgentTurn, buildSystemPrompt };
