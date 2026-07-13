import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listKnownModels,
  lookupCapabilities,
  registerModel,
} from '../src/capabilities.js';
import {
  REDACTED,
  capabilitiesTool,
  checkGuardrailIntervention,
  precheckTool,
  redactResponseTool,
  type ConverseResponse,
} from '../src/tools.js';

// --- capability lookup --------------------------------------------------

test('lookup: known anthropic sonnet 4', () => {
  const cap = lookupCapabilities('anthropic.claude-sonnet-4-20250514-v1:0');
  assert.ok(cap);
  assert.equal(cap!.family, 'anthropic.claude');
  assert.equal(cap!.max_input_tokens, 200_000);
  assert.equal(cap!.supports_prompt_cache, true);
  assert.equal(cap!.supports_thinking, true);
});

test('lookup: cross-region us. prefix resolves', () => {
  const cap = lookupCapabilities('us.anthropic.claude-sonnet-4-20250514-v1:0');
  assert.ok(cap);
  assert.equal(cap!.model_id, 'anthropic.claude-sonnet-4-20250514-v1:0');
});

test('lookup: cross-region eu. prefix resolves', () => {
  const cap = lookupCapabilities('eu.anthropic.claude-3-7-sonnet-20250219-v1:0');
  assert.ok(cap);
  assert.equal(cap!.family, 'anthropic.claude');
});

test('lookup: apac. prefix resolves', () => {
  const cap = lookupCapabilities('apac.anthropic.claude-sonnet-4-20250514-v1:0');
  assert.ok(cap);
  assert.equal(cap!.model_id, 'anthropic.claude-sonnet-4-20250514-v1:0');
});

test('lookup: a non cross-region head (mistral.) is not stripped', () => {
  // "mistral" is a family head, not a cross-region prefix, so the id must be
  // looked up verbatim — a regression here would silently break every
  // non-prefixed model whose head happens to differ from the table key.
  const cap = lookupCapabilities('mistral.mistral-large-2407-v1:0');
  assert.ok(cap);
  assert.equal(cap!.family, 'mistral');
  assert.equal(cap!.supports_prompt_cache, false);
});

test('lookup: unknown model returns null', () => {
  const cap = lookupCapabilities('does-not-exist');
  assert.equal(cap, null);
});

test('list known models is non-empty and sorted', () => {
  const models = listKnownModels();
  assert.ok(models.length > 5);
  const sorted = [...models].sort();
  assert.deepEqual(models, sorted);
});

test('register: new model becomes lookup-able', () => {
  registerModel({
    model_id: 'test.fake-v1:0',
    family: 'test',
    max_input_tokens: 1000,
    max_output_tokens: 100,
    supports_vision: false,
    supports_tool_use: false,
    supports_prompt_cache: false,
    supports_thinking: false,
    supports_streaming: false,
    supports_cross_region_inference: false,
    available_regions: ['us-east-1'],
  });
  const cap = lookupCapabilities('test.fake-v1:0');
  assert.ok(cap);
  assert.equal(cap!.max_input_tokens, 1000);
});

// --- bedrock_capabilities tool (real handler) ----------------------------

test('capabilitiesTool: known model returns known=true + capabilities', () => {
  const r = capabilitiesTool({
    model_id: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  });
  assert.equal(r.known, true);
  assert.ok('capabilities' in r && r.capabilities);
  // The capabilities echo the bare (prefix-stripped) model id.
  assert.equal(
    r.capabilities!.model_id,
    'anthropic.claude-sonnet-4-20250514-v1:0',
  );
});

test('capabilitiesTool: unknown model returns known=false + known_models', () => {
  const r = capabilitiesTool({ model_id: 'totally.bogus-v9:9' });
  assert.equal(r.known, false);
  assert.ok('known_models' in r && Array.isArray(r.known_models));
  assert.ok(r.known_models!.length > 0);
  // The bogus id is echoed back so the caller can report exactly what failed.
  assert.equal(r.model_id, 'totally.bogus-v9:9');
});

// --- bedrock_precheck tool (real handler) --------------------------------

test('precheckTool: ok=true when all features + region supported', () => {
  const r = precheckTool({
    model_id: 'anthropic.claude-sonnet-4-20250514-v1:0',
    use_prompt_cache: true,
    use_thinking: true,
    use_tool_use: true,
    use_vision: true,
    use_streaming: true,
    region: 'us-east-1',
  });
  assert.equal(r.ok, true);
});

test('precheckTool: ok=false lists unsupported thinking on Sonnet 3.5', () => {
  const r = precheckTool({
    model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    use_thinking: true,
  });
  assert.equal(r.ok, false);
  assert.ok('unsupported_features' in r);
  assert.deepEqual(r.unsupported_features, ['thinking']);
  assert.match(r.message, /does not support/);
});

test('precheckTool: ok=false reports region mismatch', () => {
  const r = precheckTool({
    model_id: 'anthropic.claude-opus-4-20250514-v1:0',
    region: 'ap-south-1',
  });
  assert.equal(r.ok, false);
  assert.ok('region_error' in r && r.region_error);
  assert.match(r.region_error!, /not available in region ap-south-1/);
});

test('precheckTool: vision unsupported on Haiku', () => {
  const r = precheckTool({
    model_id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    use_vision: true,
  });
  assert.equal(r.ok, false);
  assert.ok('unsupported_features' in r);
  assert.deepEqual(r.unsupported_features, ['vision']);
});

test('precheckTool: aggregates multiple unsupported features', () => {
  const r = precheckTool({
    model_id: 'mistral.mistral-large-2407-v1:0',
    use_prompt_cache: true,
    use_vision: true,
  });
  assert.equal(r.ok, false);
  assert.ok('unsupported_features' in r);
  assert.deepEqual(r.unsupported_features, ['prompt_cache', 'vision']);
});

test('precheckTool: unknown model returns ok=false with reason', () => {
  const r = precheckTool({ model_id: 'bogus' });
  assert.equal(r.ok, false);
  assert.ok('reason' in r);
  assert.equal(r.reason, 'unknown_model');
});

// --- guardrail intervention detection (real handler) ---------------------

const PII = 'SSN 123-45-6789';

test('checkGuardrailIntervention: no trace returns null', () => {
  const resp: ConverseResponse = {
    output: { message: { content: [{ text: 'ok' }] } },
    stopReason: 'end_turn',
  };
  assert.equal(checkGuardrailIntervention(resp, 'gid'), null);
});

test('checkGuardrailIntervention: empty assessment for id returns null', () => {
  const resp: ConverseResponse = {
    output: { message: { content: [{ text: 'ok' }] } },
    stopReason: 'end_turn',
    trace: { guardrail: { outputAssessments: { 'other-gid': [{}] } } },
  };
  assert.equal(checkGuardrailIntervention(resp, 'gid'), null);
});

test('checkGuardrailIntervention: output intervention reports BLOCKED', () => {
  const resp: ConverseResponse = {
    output: { message: { content: [{ text: PII }] } },
    stopReason: 'guardrail_intervened',
    trace: {
      guardrail: {
        outputAssessments: {
          gid: [
            {
              sensitiveInformationPolicy: {
                piiEntities: [{ type: 'EMAIL', match: PII, action: 'BLOCKED' }],
              },
            },
          ],
        },
      },
    },
  };
  const i = checkGuardrailIntervention(resp, 'gid');
  assert.ok(i);
  assert.equal(i!.action, 'BLOCKED');
  assert.equal(i!.intervened_on, 'output');
  assert.deepEqual(i!.categories, ['sensitiveInformationPolicy']);
  // Critical invariant: no field of the intervention carries the PII.
  assert.equal(JSON.stringify(i).includes(PII), false);
});

test('checkGuardrailIntervention: input intervention reports ANONYMIZED', () => {
  const resp: ConverseResponse = {
    output: { message: { content: [] } },
    stopReason: 'end_turn',
    trace: {
      guardrail: {
        inputAssessment: {
          gid: {
            contentPolicy: { filters: [{ type: 'HATE', action: 'BLOCKED' }] },
          },
        },
      },
    },
  };
  const i = checkGuardrailIntervention(resp, 'gid');
  assert.ok(i);
  assert.equal(i!.action, 'ANONYMIZED');
  assert.equal(i!.intervened_on, 'input');
  assert.deepEqual(i!.categories, ['contentPolicy']);
});

test('checkGuardrailIntervention: categories are de-duplicated and sorted', () => {
  const resp: ConverseResponse = {
    stopReason: 'guardrail_intervened',
    trace: {
      guardrail: {
        outputAssessments: {
          gid: [
            { wordPolicy: {}, contentPolicy: {} },
            { contentPolicy: {} },
          ],
        },
      },
    },
  };
  const i = checkGuardrailIntervention(resp, 'gid');
  assert.ok(i);
  assert.deepEqual(i!.categories, ['contentPolicy', 'wordPolicy']);
});

// --- bedrock_redact_response tool (real handler) -------------------------

test('redactResponseTool: no intervention returns response unchanged', () => {
  const resp: ConverseResponse = {
    output: { message: { content: [{ text: 'safe answer' }] } },
    stopReason: 'end_turn',
  };
  const r = redactResponseTool({ response: resp, guardrail_id: 'gid' });
  assert.equal(r.intervened, false);
  assert.deepEqual(r.response, resp);
});

test('redactResponseTool: redacts text and strips trace on intervention', () => {
  const resp: ConverseResponse = {
    output: { message: { role: 'assistant', content: [{ text: PII }] } },
    stopReason: 'guardrail_intervened',
    trace: {
      guardrail: {
        outputAssessments: {
          gid: [{ sensitiveInformationPolicy: { piiEntities: [{ match: PII }] } }],
        },
      },
    },
  };
  const r = redactResponseTool({ response: resp, guardrail_id: 'gid' });
  assert.equal(r.intervened, true);
  const out = JSON.stringify(r.response);
  // The violating PII is gone from the returned (loggable) response...
  assert.equal(out.includes(PII), false);
  // ...replaced by the redaction marker, and the trace is stripped.
  assert.ok(out.includes(REDACTED));
  assert.ok(out.includes('redacted_by'));
});

test('redactResponseTool: does not mutate the caller input', () => {
  const resp: ConverseResponse = {
    output: { message: { role: 'assistant', content: [{ text: PII }] } },
    stopReason: 'guardrail_intervened',
    trace: {
      guardrail: {
        outputAssessments: { gid: [{ sensitiveInformationPolicy: {} }] },
      },
    },
  };
  redactResponseTool({ response: resp, guardrail_id: 'gid' });
  // Original object must still carry its PII and trace — proves the deep copy.
  assert.equal(resp.output!.message!.content![0].text, PII);
  assert.ok(resp.trace!.guardrail!.outputAssessments);
});

test('redactResponseTool: intervention object never leaks PII', () => {
  const resp: ConverseResponse = {
    output: { message: { content: [{ text: PII }] } },
    stopReason: 'guardrail_intervened',
    trace: {
      guardrail: {
        outputAssessments: {
          gid: [{ sensitiveInformationPolicy: { piiEntities: [{ match: PII }] } }],
        },
      },
    },
  };
  const r = redactResponseTool({ response: resp, guardrail_id: 'gid' });
  assert.equal(r.intervened, true);
  assert.ok('intervention' in r);
  assert.equal(JSON.stringify(r.intervention).includes(PII), false);
});
