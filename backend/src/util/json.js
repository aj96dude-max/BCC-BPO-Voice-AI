function parseLlmJson(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Empty LLM response');
  }
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response was not JSON');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeAgentTurn(parsed) {
  const extracted = parsed && typeof parsed.extracted === 'object' && parsed.extracted
    ? parsed.extracted
    : {};
  const status = ['collecting', 'confirming', 'complete', 'transfer'].includes(parsed.status)
    ? parsed.status
    : 'collecting';
  return {
    speak: String(parsed.speak || '').trim() || 'Could you repeat that for me?',
    extracted,
    status,
    transfer: Boolean(parsed.transfer) || status === 'transfer',
    transferReason: String(parsed.transferReason || '').trim(),
  };
}

module.exports = { parseLlmJson, normalizeAgentTurn };
