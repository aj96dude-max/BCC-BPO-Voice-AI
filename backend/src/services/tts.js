const { config } = require('../config');
const { chunkMulaw } = require('../util/audio');
const logger = require('../logger');

async function synthesizeSpeech({ text, voiceId, signal }) {
  if (!config.elevenLabsApiKey) {
    throw new Error('ELEVENLABS_API_KEY is not configured');
  }
  const id = voiceId || config.elevenLabsVoiceId;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${id}/stream?output_format=ulaw_8000`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': config.elevenLabsApiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mulaw',
    },
    body: JSON.stringify({
      text,
      model_id: config.elevenLabsModel,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error('ElevenLabs TTS failed', { status: response.status, body: body.slice(0, 300) });
    throw new Error(`TTS failed with ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return chunkMulaw(buffer);
}

module.exports = { synthesizeSpeech };
