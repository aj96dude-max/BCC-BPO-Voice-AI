const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeFields, missingRequired, wantsTransfer, applyAgentTurn } = require('../src/agent');
const { parseLlmJson, normalizeAgentTurn } = require('../src/util/json');
const { validateCampaign, resolveCampaign, listCampaigns } = require('../src/campaigns');

const campaign = validateCampaign({
  id: 'test-desk',
  name: 'Test Desk',
  greeting: 'Hello',
  persona: 'Be brief',
  fields: [
    { key: 'caller_name', label: 'Name', required: true },
    { key: 'callback_number', label: 'Phone', required: true },
    { key: 'reason', label: 'Reason', required: false },
  ],
});

describe('campaign catalog', () => {
  it('loads built-in verticals', () => {
    const ids = new Set(listCampaigns().map((item) => item.id));
    for (const id of [
      'auto-insurance',
      'final-expense',
      'generic-inbound',
      'home-service',
      'medical-billing',
      'mortgage',
    ]) {
      assert.ok(ids.has(id), `missing campaign ${id}`);
    }
  });

  it('resolves by campaign id then number then default', () => {
    const byId = resolveCampaign({ campaignId: 'mortgage', toNumber: '+15551230001' });
    assert.equal(byId.id, 'mortgage');
    const byNumber = resolveCampaign({ toNumber: '+15551230001' });
    assert.equal(byNumber.id, 'auto-insurance');
  });
});

describe('intake merging', () => {
  it('keeps only known fields and ignores placeholders', () => {
    const fields = mergeFields({}, {
      caller_name: 'Jane Doe',
      callback_number: 'unknown',
      secret: 'nope',
    }, campaign.fields);
    assert.deepEqual(fields, { caller_name: 'Jane Doe' });
  });

  it('does not complete while required fields are missing', () => {
    const session = { fields: { caller_name: 'Jane' }, status: 'collecting' };
    const applied = applyAgentTurn(session, {
      speak: 'Done',
      extracted: {},
      status: 'complete',
      transfer: false,
    }, campaign);
    assert.equal(applied.status, 'collecting');
    assert.deepEqual(applied.missing, ['callback_number']);
  });

  it('completes after required fields are confirmed', () => {
    const session = { fields: { caller_name: 'Jane' }, status: 'collecting' };
    const applied = applyAgentTurn(session, {
      speak: 'I have your details.',
      extracted: { callback_number: '5551112222' },
      status: 'complete',
      transfer: false,
    }, campaign);
    assert.equal(applied.status, 'complete');
    assert.equal(missingRequired(session.fields, campaign.fields).length, 0);
  });

  it('detects a human-request transfer', () => {
    assert.equal(wantsTransfer('can I talk to a supervisor please', ['supervisor', 'agent']), true);
    assert.equal(wantsTransfer('my name is Sam', ['supervisor']), false);
  });
});

describe('llm json parsing', () => {
  it('reads fenced json from a model reply', () => {
    const parsed = parseLlmJson('Sure\n```json\n{"speak":"Hi there","extracted":{"caller_name":"Sam"},"status":"collecting"}\n```');
    const turn = normalizeAgentTurn(parsed);
    assert.equal(turn.speak, 'Hi there');
    assert.equal(turn.extracted.caller_name, 'Sam');
  });
});

describe('sdk surface', () => {
  it('uses Deepgram v5 client export', () => {
    const deepgram = require('@deepgram/sdk');
    assert.equal(typeof deepgram.DeepgramClient, 'function');
  });
});
