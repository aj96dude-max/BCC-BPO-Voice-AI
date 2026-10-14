const crypto = require('crypto');
const { fieldProgress } = require('./agent');

const MAX_HISTORY = 20;
const MAX_ENDED = 50;

const active = new Map();
const ended = [];

function createCall({ campaign, from, to, callSid }) {
  const call = {
    id: crypto.randomUUID(),
    callSid: callSid || null,
    streamSid: null,
    campaignId: campaign.id,
    campaignName: campaign.name,
    vertical: campaign.vertical,
    from: from || '',
    to: to || '',
    status: 'ringing',
    fields: {},
    history: [],
    transcripts: [],
    startedAt: new Date().toISOString(),
    endedAt: null,
    transferReason: '',
  };
  active.set(call.id, call);
  return call;
}

function getCall(id) {
  return active.get(id) || ended.find((call) => call.id === id) || null;
}

function findByCallSid(callSid) {
  if (!callSid) return null;
  for (const call of active.values()) {
    if (call.callSid === callSid) return call;
  }
  return ended.find((call) => call.callSid === callSid) || null;
}

function listActiveCalls() {
  return Array.from(active.values());
}

function listRecentCalls() {
  return [...listActiveCalls(), ...ended].slice(0, 100);
}

function attachTwilio(call, { callSid, streamSid }) {
  if (callSid) call.callSid = callSid;
  if (streamSid) call.streamSid = streamSid;
  if (call.status === 'ringing') call.status = 'live';
}

function addHistory(call, role, content) {
  call.history.push({ role, content });
  if (call.history.length > MAX_HISTORY) {
    call.history = call.history.slice(-MAX_HISTORY);
  }
}

function addTranscript(call, entry) {
  const last = call.transcripts[call.transcripts.length - 1];
  if (last && last.role === entry.role && last.isFinal === false && entry.role === 'user') {
    call.transcripts[call.transcripts.length - 1] = entry;
    return;
  }
  call.transcripts.push(entry);
}

function snapshot(call, campaign) {
  return {
    id: call.id,
    callSid: call.callSid,
    campaignId: call.campaignId,
    campaignName: call.campaignName,
    vertical: call.vertical,
    from: call.from,
    to: call.to,
    status: call.status,
    fields: fieldProgress(call.fields, campaign ? campaign.fields : []),
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    transferReason: call.transferReason,
  };
}

function endCall(call, status = 'ended') {
  if (!active.has(call.id)) return call;
  call.status = status;
  call.endedAt = new Date().toISOString();
  active.delete(call.id);
  ended.unshift(call);
  if (ended.length > MAX_ENDED) ended.length = MAX_ENDED;
  return call;
}

module.exports = {
  createCall,
  getCall,
  findByCallSid,
  listActiveCalls,
  listRecentCalls,
  attachTwilio,
  addHistory,
  addTranscript,
  snapshot,
  endCall,
};
