function mergeFields(current, extracted, fieldDefs) {
  const allowed = new Set((fieldDefs || []).map((field) => field.key));
  const next = { ...(current || {}) };
  for (const [key, value] of Object.entries(extracted || {})) {
    if (!allowed.has(key)) continue;
    if (value == null) continue;
    const text = String(value).trim();
    if (!text || /^unknown|n\/a|none|null$/i.test(text)) continue;
    next[key] = text;
  }
  return next;
}

function missingRequired(fields, fieldDefs) {
  return (fieldDefs || [])
    .filter((field) => field.required && !String((fields || {})[field.key] || '').trim())
    .map((field) => field.key);
}

function wantsTransfer(text, phrases) {
  const haystack = String(text || '').toLowerCase();
  return (phrases || []).some((phrase) => haystack.includes(String(phrase).toLowerCase()));
}

function applyAgentTurn(session, llmResult, campaign = session.campaign) {
  if (!campaign) throw new Error('Campaign is required for an agent turn');
  session.fields = mergeFields(session.fields, llmResult.extracted, campaign.fields);
  const missing = missingRequired(session.fields, campaign.fields);

  if (llmResult.transfer) {
    session.status = 'transfer';
  } else if (llmResult.status === 'complete' && missing.length === 0) {
    session.status = 'complete';
  } else if (missing.length === 0) {
    session.status = 'confirming';
  } else {
    session.status = 'collecting';
  }

  return {
    speak: llmResult.speak,
    missing,
    status: session.status,
    fields: session.fields,
  };
}

function fieldProgress(fields, fieldDefs) {
  return (fieldDefs || []).map((field) => ({
    key: field.key,
    label: field.label,
    required: Boolean(field.required),
    value: (fields || {})[field.key] || '',
  }));
}

module.exports = {
  mergeFields,
  missingRequired,
  wantsTransfer,
  applyAgentTurn,
  fieldProgress,
};
