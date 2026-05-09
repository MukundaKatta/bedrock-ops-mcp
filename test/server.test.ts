import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listKnownModels,
  lookupCapabilities,
  registerModel,
} from '../src/capabilities.js';

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
  const cap = lookupCapabilities(
    'us.anthropic.claude-sonnet-4-20250514-v1:0',
  );
  assert.ok(cap);
  assert.equal(cap!.model_id, 'anthropic.claude-sonnet-4-20250514-v1:0');
});

test('lookup: cross-region eu. prefix resolves', () => {
  const cap = lookupCapabilities('eu.anthropic.claude-3-7-sonnet-20250219-v1:0');
  assert.ok(cap);
  assert.equal(cap!.family, 'anthropic.claude');
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

// --- precheck-shape pure logic (mirrors precheckTool) -------------------

function precheckPure(
  modelId: string,
  flags: {
    use_prompt_cache?: boolean;
    use_thinking?: boolean;
    use_vision?: boolean;
    use_tool_use?: boolean;
    use_streaming?: boolean;
    region?: string;
  },
): { ok: boolean; missing: string[]; regionError: string | null } {
  const cap = lookupCapabilities(modelId);
  if (!cap) {
    return { ok: false, missing: [], regionError: 'unknown_model' };
  }
  const missing: string[] = [];
  if (flags.use_prompt_cache && !cap.supports_prompt_cache)
    missing.push('prompt_cache');
  if (flags.use_thinking && !cap.supports_thinking) missing.push('thinking');
  if (flags.use_vision && !cap.supports_vision) missing.push('vision');
  if (flags.use_tool_use && !cap.supports_tool_use) missing.push('tool_use');
  if (flags.use_streaming && !cap.supports_streaming) missing.push('streaming');
  let regionError: string | null = null;
  if (flags.region && !cap.available_regions.includes(flags.region)) {
    regionError = `${modelId} not available in ${flags.region}`;
  }
  return {
    ok: missing.length === 0 && regionError === null,
    missing,
    regionError,
  };
}

test('precheck: passes for supported features on Sonnet 4', () => {
  const r = precheckPure('anthropic.claude-sonnet-4-20250514-v1:0', {
    use_prompt_cache: true,
    use_thinking: true,
    use_tool_use: true,
    use_vision: true,
    use_streaming: true,
    region: 'us-east-1',
  });
  assert.equal(r.ok, true);
  assert.equal(r.missing.length, 0);
});

test('precheck: fails when thinking unsupported', () => {
  const r = precheckPure('anthropic.claude-3-5-sonnet-20241022-v2:0', {
    use_thinking: true,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['thinking']);
});

test('precheck: fails when region unavailable', () => {
  const r = precheckPure('anthropic.claude-opus-4-20250514-v1:0', {
    region: 'ap-south-1',
  });
  assert.equal(r.ok, false);
  assert.ok(r.regionError);
});

test('precheck: vision unsupported on Haiku', () => {
  const r = precheckPure('anthropic.claude-3-5-haiku-20241022-v1:0', {
    use_vision: true,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['vision']);
});

test('precheck: unknown model returns ok=false with reason', () => {
  const r = precheckPure('bogus', {});
  assert.equal(r.ok, false);
  assert.equal(r.regionError, 'unknown_model');
});

// --- guardrail intervention pure logic -----------------------------------

interface ConverseResponse {
  output?: { message?: { content?: { text?: string }[] } };
  stopReason?: string;
  trace?: { guardrail?: any };
}

function checkInterventionPure(
  response: ConverseResponse,
  guardrailId: string,
): null | { action: string; intervened_on: string; categories: string[] } {
  const guardrail = response.trace?.guardrail;
  if (!guardrail) return null;
  const outputForId = (guardrail.outputAssessments ?? {})[guardrailId] ?? [];
  const inputForId = (guardrail.inputAssessment ?? {})[guardrailId] ?? null;
  if (outputForId.length === 0 && !inputForId) return null;
  const stop = response.stopReason ?? '';
  const action =
    stop === 'guardrail_intervened' || stop === 'GUARDRAIL_INTERVENED'
      ? 'BLOCKED'
      : 'ANONYMIZED';
  const intervenedOn = outputForId.length > 0 ? 'output' : 'input';
  const filterTypes = [
    'topicPolicy',
    'contentPolicy',
    'wordPolicy',
    'sensitiveInformationPolicy',
    'contextualGroundingPolicy',
  ];
  const cats = new Set<string>();
  const sources = outputForId.length > 0 ? outputForId : [inputForId];
  for (const a of sources) {
    if (!a) continue;
    for (const ft of filterTypes) {
      if (ft in a) cats.add(ft);
    }
  }
  return {
    action,
    intervened_on: intervenedOn,
    categories: Array.from(cats).sort(),
  };
}

const PII = 'SSN 123-45-6789';

test('redact: no intervention returns null', () => {
  const resp = {
    output: { message: { content: [{ text: 'ok' }] } },
    stopReason: 'end_turn',
  };
  assert.equal(checkInterventionPure(resp, 'gid'), null);
});

test('redact: detects intervention, no PII in result', () => {
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
  const i = checkInterventionPure(resp, 'gid');
  assert.ok(i);
  assert.equal(i!.action, 'BLOCKED');
  assert.equal(i!.intervened_on, 'output');
  assert.ok(i!.categories.includes('sensitiveInformationPolicy'));
  // Critical: no field of the intervention object contains PII
  for (const v of Object.values(i!)) {
    assert.equal(JSON.stringify(v).includes(PII), false);
  }
});
