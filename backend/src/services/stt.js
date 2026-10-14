const { DeepgramClient } = require('@deepgram/sdk');
const { config } = require('../config');
const logger = require('../logger');

function createDeepgramClient() {
  if (!config.deepgramApiKey) {
    throw new Error('DEEPGRAM_API_KEY is not configured');
  }
  return new DeepgramClient({ apiKey: config.deepgramApiKey });
}

function readTranscript(message) {
  if (!message || message.type !== 'Results') return null;
  const transcript = message.channel?.alternatives?.[0]?.transcript || '';
  if (!transcript.trim()) return null;
  return {
    text: transcript.trim(),
    isFinal: Boolean(message.is_final),
    speechFinal: message.speech_final === undefined ? Boolean(message.is_final) : Boolean(message.speech_final),
  };
}

async function createLiveTranscriber({ onTranscript, onError }) {
  const client = createDeepgramClient();
  const connection = await client.listen.v1.connect({
    model: config.deepgramModel,
    language: 'en',
    encoding: 'mulaw',
    sample_rate: '8000',
    channels: '1',
    punctuate: 'true',
    interim_results: 'true',
    smart_format: 'true',
    numerals: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
  });

  connection.on('open', () => logger.info('Deepgram STT opened'));
  connection.on('error', (error) => {
    logger.error('Deepgram STT error', { message: error?.message || String(error) });
    if (onError) onError(error);
  });
  connection.on('close', () => logger.info('Deepgram STT closed'));
  connection.on('message', (data) => {
    const result = readTranscript(data);
    if (result && onTranscript) onTranscript(result);
  });

  connection.connect();
  await connection.waitForOpen();

  const keepalive = setInterval(() => {
    try {
      connection.sendKeepAlive();
    } catch {
      // socket may already be closed
    }
  }, 8000);

  return {
    send(audioBuffer) {
      connection.sendMedia(audioBuffer);
    },
    close() {
      clearInterval(keepalive);
      try {
        connection.sendCloseStream();
      } catch {
        // ignore
      }
      try {
        connection.close();
      } catch {
        // ignore
      }
    },
  };
}

module.exports = { createLiveTranscriber, readTranscript };
