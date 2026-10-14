const { getCampaign } = require('../campaigns');
const calls = require('../calls');
const { applyAgentTurn, wantsTransfer, fieldProgress } = require('../agent');
const { recordOrder } = require('../orders');
const { runAgentTurn } = require('../services/llm');
const { synthesizeSpeech } = require('../services/tts');
const { createLiveTranscriber } = require('../services/stt');
const { transferCall, canTransfer } = require('../services/transfer');
const { dispatchOrder } = require('../services/webhook');
const { broadcast } = require('./commandCenter');
const logger = require('../logger');

function sendMedia(ws, streamSid, chunks) {
  for (const chunk of chunks) {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload: chunk.toString('base64') },
    }));
  }
}

function sendClear(ws, streamSid) {
  if (ws.readyState !== 1 || !streamSid) return;
  ws.send(JSON.stringify({ event: 'clear', streamSid }));
}

function sendMark(ws, streamSid, name) {
  if (ws.readyState !== 1 || !streamSid) return;
  ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name } }));
}

function emitCall(call, campaign, extra = {}) {
  broadcast({
    type: 'call.update',
    call: calls.snapshot(call, campaign),
    ...extra,
  });
}

async function completeOrder(call, campaign) {
  const order = recordOrder(call, campaign);
  broadcast({ type: 'order', order });
  await dispatchOrder(order);
  return order;
}

async function speak(ws, state, text) {
  if (!text || state.closed) return;
  state.abortController.abort();
  state.abortController = new AbortController();
  state.isSpeaking = true;
  state.ttsGeneration += 1;
  const generation = state.ttsGeneration;
  const markName = `tts-${generation}`;
  state.pendingMark = markName;

  try {
    const chunks = await synthesizeSpeech({
      text,
      voiceId: state.campaign.voiceId,
      signal: state.abortController.signal,
    });
    if (state.closed || generation !== state.ttsGeneration) return;
    sendMedia(ws, state.streamSid, chunks);
    sendMark(ws, state.streamSid, markName);
  } catch (error) {
    if (error.name === 'AbortError') return;
    logger.error('TTS error', { message: error.message, callId: state.call?.id });
    state.isSpeaking = false;
  }
}

async function handleFinalTranscript(ws, state, text) {
  if (state.busy || state.closed) {
    state.queuedUtterance = text;
    return;
  }
  state.busy = true;
  calls.addHistory(state.call, 'user', text);

  try {
    if (wantsTransfer(text, state.campaign.transferPhrases)) {
      await requestTransfer(ws, state, 'Caller asked for a live agent');
      return;
    }

    const result = await runAgentTurn({
      campaign: state.campaign,
      session: state.call,
      userText: text,
      signal: state.abortController.signal,
    });
    const applied = applyAgentTurn(state.call, result, state.campaign);
    calls.addHistory(state.call, 'assistant', applied.speak);
    calls.addTranscript(state.call, { role: 'agent', text: applied.speak, isFinal: true });
    broadcast({
      type: 'transcript',
      callId: state.call.id,
      role: 'agent',
      text: applied.speak,
      isFinal: true,
    });
    emitCall(state.call, state.campaign, {
      fields: fieldProgress(state.call.fields, state.campaign.fields),
    });

    await speak(ws, state, applied.speak);

    if (state.call.status === 'transfer') {
      await requestTransfer(ws, state, result.transferReason || 'Agent requested transfer');
    } else if (state.call.status === 'complete') {
      await completeOrder(state.call, state.campaign);
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      logger.error('Agent turn failed', { message: error.message, callId: state.call.id });
    }
  } finally {
    state.busy = false;
    if (state.queuedUtterance && !state.closed) {
      const next = state.queuedUtterance;
      state.queuedUtterance = '';
      await handleFinalTranscript(ws, state, next);
    }
  }
}

async function requestTransfer(ws, state, reason) {
  state.call.transferReason = reason;
  state.call.status = 'transfer';
  emitCall(state.call, state.campaign);
  if (!canTransfer()) {
    await speak(ws, state, 'I want to connect you with a specialist, but a live agent is not configured on this line. Please try again later.');
    return;
  }
  try {
    await transferCall(state.call.callSid);
    await completeOrder(state.call, state.campaign);
  } catch (error) {
    logger.error('Live transfer failed', { message: error.message, callId: state.call.id });
    await speak(ws, state, 'I am having trouble reaching a live agent. Please stay on the line or call back.');
  }
}

function attachAudioBridge(wssTwilio) {
  wssTwilio.on('connection', async (ws) => {
    const state = {
      call: null,
      campaign: null,
      streamSid: null,
      isSpeaking: false,
      busy: false,
      closed: false,
      queuedUtterance: '',
      ttsGeneration: 0,
      pendingMark: null,
      abortController: new AbortController(),
      audioQueue: [],
      sttReady: false,
    };

    let stt;
    try {
      stt = await createLiveTranscriber({
        onTranscript: (result) => {
          if (state.closed || !state.call) return;
          calls.addTranscript(state.call, { role: 'user', text: result.text, isFinal: result.isFinal });
          broadcast({
            type: 'transcript',
            callId: state.call.id,
            role: 'user',
            text: result.text,
            isFinal: result.isFinal,
          });

          if (state.isSpeaking && result.text.split(/\s+/).length >= 2) {
            logger.info('Barge-in detected', { callId: state.call.id });
            sendClear(ws, state.streamSid);
            state.abortController.abort();
            state.abortController = new AbortController();
            state.isSpeaking = false;
            state.ttsGeneration += 1;
          }

          if (result.isFinal && result.speechFinal && result.text.replace(/[^\w]/g, '').length >= 2) {
            handleFinalTranscript(ws, state, result.text);
          }
        },
      });
      state.sttReady = true;
      for (const chunk of state.audioQueue) stt.send(chunk);
      state.audioQueue = [];
    } catch (error) {
      logger.error('Failed to open Deepgram', { message: error.message });
    }

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.event) {
        case 'start': {
          state.streamSid = msg.start.streamSid;
          const params = msg.start.customParameters || {};
          const call = calls.getCall(params.callId) || calls.findByCallSid(msg.start.callSid);
          if (!call) {
            logger.warn('Audio stream start for unknown call', { params, callSid: msg.start.callSid });
            ws.close();
            return;
          }
          const campaign = getCampaign(call.campaignId);
          if (!campaign) {
            ws.close();
            return;
          }
          state.call = call;
          state.campaign = campaign;
          calls.attachTwilio(call, {
            callSid: msg.start.callSid || call.callSid,
            streamSid: state.streamSid,
          });
          call.status = 'live';
          emitCall(call, campaign);
          logger.info('Media stream started', { callId: call.id, streamSid: state.streamSid });
          await speak(ws, state, campaign.greeting);
          calls.addTranscript(call, { role: 'agent', text: campaign.greeting, isFinal: true });
          calls.addHistory(call, 'assistant', campaign.greeting);
          broadcast({
            type: 'transcript',
            callId: call.id,
            role: 'agent',
            text: campaign.greeting,
            isFinal: true,
          });
          break;
        }
        case 'media': {
          const audioBuffer = Buffer.from(msg.media.payload, 'base64');
          if (state.sttReady) {
            try { stt.send(audioBuffer); } catch { /* not open yet */ }
          } else {
            state.audioQueue.push(audioBuffer);
            if (state.audioQueue.length > 200) state.audioQueue.shift();
          }
          break;
        }
        case 'mark': {
          if (msg.mark?.name === state.pendingMark) {
            state.isSpeaking = false;
            state.pendingMark = null;
          }
          break;
        }
        default:
          break;
      }
    });

    ws.on('close', () => {
      state.closed = true;
      state.abortController.abort();
      if (stt) stt.close();
      if (state.call && !state.call.endedAt) {
        const status = ['complete', 'transfer'].includes(state.call.status)
          ? state.call.status
          : 'ended';
        calls.endCall(state.call, status);
        emitCall(state.call, state.campaign);
      }
      logger.info('Twilio audio socket closed', { callId: state.call?.id });
    });
  });
}

async function overrideCall(callId, reason = 'Supervisor manual override') {
  const call = (callId && calls.getCall(callId)) || calls.listActiveCalls()[0];
  if (!call || !call.callSid) {
    throw new Error('No live call to transfer');
  }
  const campaign = getCampaign(call.campaignId);
  call.transferReason = reason;
  call.status = 'transfer';
  await transferCall(call.callSid);
  if (campaign) await completeOrder(call, campaign);
  if (!call.endedAt) calls.endCall(call, 'transfer');
  return call;
}

module.exports = { attachAudioBridge, overrideCall };
