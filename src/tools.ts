/**
 * Pure, transport-agnostic implementations of the three bedrock-ops tools.
 *
 * These functions contain all the real behaviour the MCP server exposes.
 * `server.ts` is a thin stdio adapter that wires the MCP request schemas to
 * the handlers here, and the test suite imports the same functions directly
 * so the shipped logic is exercised — not a re-implementation of it.
 *
 * Every handler returns a plain JSON-serialisable object. The MCP envelope
 * (the `{ content: [{ type: 'text', text }] }` wrapper) is applied by the
 * caller, keeping these functions trivial to assert against.
 */

import { listKnownModels, lookupCapabilities } from './capabilities.js';

// --- argument + response shapes ------------------------------------------

/** Arguments accepted by {@link precheckTool}. */
export interface PrecheckArgs {
  model_id: string;
  use_prompt_cache?: boolean;
  use_thinking?: boolean;
  use_vision?: boolean;
  use_tool_use?: boolean;
  use_streaming?: boolean;
  region?: string;
}

type ConverseContentBlock = {
  text?: string;
  toolUse?: unknown;
  toolResult?: unknown;
};

/** Subset of the boto3 `client.converse()` response shape we read. */
export interface ConverseResponse {
  output?: {
    message?: {
      role?: string;
      content?: ConverseContentBlock[];
    };
  };
  stopReason?: string;
  trace?: {
    guardrail?: {
      outputAssessments?: Record<string, Array<Record<string, unknown>>>;
      inputAssessment?: Record<string, Record<string, unknown>>;
    };
  };
  [k: string]: unknown;
}

/**
 * A sanitised description of a guardrail intervention. By construction it
 * never carries the violating content — only the guardrail id, the action
 * taken, where it happened, and the policy categories that fired.
 */
export interface GuardrailIntervention {
  guardrail_id: string;
  action: 'BLOCKED' | 'ANONYMIZED';
  intervened_on: 'input' | 'output';
  categories: string[];
}

/** Placeholder substituted for any model text once a guardrail intervened. */
export const REDACTED = '[REDACTED-by-bedrock-ops]';

/** Bedrock guardrail policy keys we surface as intervention categories. */
export const FILTER_TYPES = [
  'topicPolicy',
  'contentPolicy',
  'wordPolicy',
  'sensitiveInformationPolicy',
  'contextualGroundingPolicy',
] as const;

// --- tool implementations ------------------------------------------------

/**
 * Look up a Bedrock model's static capabilities.
 *
 * @param args.model_id Bare or cross-region-prefixed Bedrock model id.
 * @returns `{ known: true, capabilities }` for a recognised model, otherwise
 *   `{ known: false, known_models }` so the caller can suggest a match.
 */
export function capabilitiesTool(args: { model_id: string }) {
  const cap = lookupCapabilities(args.model_id);
  if (cap === null) {
    return {
      model_id: args.model_id,
      known: false as const,
      message:
        `No capability data for model_id=${JSON.stringify(args.model_id)}. ` +
        `Either it's a new model not yet in the table, or a typo. ` +
        `Pass one of the known_models below.`,
      known_models: listKnownModels(),
    };
  }
  return {
    model_id: args.model_id,
    known: true as const,
    capabilities: cap,
  };
}

/**
 * Validate a requested feature/region combination against a model BEFORE the
 * API call, turning a runtime `ValidationException` into an upfront answer.
 *
 * @returns `{ ok: true, ... }` when every requested feature is supported and
 *   the region (if given) is available; otherwise `{ ok: false, ... }` with
 *   `unsupported_features`, `region_error`, and a human-readable `message`.
 *   Unknown models return `{ ok: false, reason: 'unknown_model' }`.
 */
export function precheckTool(args: PrecheckArgs) {
  const cap = lookupCapabilities(args.model_id);
  if (cap === null) {
    return {
      ok: false as const,
      model_id: args.model_id,
      reason: 'unknown_model' as const,
      message:
        `No capability data for model_id=${JSON.stringify(args.model_id)}. ` +
        `Cannot precheck features.`,
    };
  }

  const requested = {
    use_prompt_cache: !!args.use_prompt_cache,
    use_thinking: !!args.use_thinking,
    use_vision: !!args.use_vision,
    use_tool_use: !!args.use_tool_use,
    use_streaming: !!args.use_streaming,
  };

  const missing: string[] = [];
  if (requested.use_prompt_cache && !cap.supports_prompt_cache)
    missing.push('prompt_cache');
  if (requested.use_thinking && !cap.supports_thinking) missing.push('thinking');
  if (requested.use_vision && !cap.supports_vision) missing.push('vision');
  if (requested.use_tool_use && !cap.supports_tool_use)
    missing.push('tool_use');
  if (requested.use_streaming && !cap.supports_streaming)
    missing.push('streaming');

  let regionError: string | undefined;
  if (args.region && !cap.available_regions.includes(args.region)) {
    regionError = `model_id=${args.model_id} is not available in region ${args.region}; available: ${cap.available_regions.join(', ')}`;
  }

  if (missing.length === 0 && !regionError) {
    return {
      ok: true as const,
      model_id: args.model_id,
      requested,
      region: args.region ?? null,
    };
  }

  const messages: string[] = [];
  if (missing.length > 0) {
    messages.push(
      `Model ${args.model_id} does not support: ${missing.join(', ')}`,
    );
  }
  if (regionError) messages.push(regionError);

  return {
    ok: false as const,
    model_id: args.model_id,
    requested,
    region: args.region ?? null,
    unsupported_features: missing,
    region_error: regionError ?? null,
    message: messages.join('. '),
  };
}

/**
 * Return a copy of a Bedrock Converse response that is safe to log: if the
 * named guardrail intervened, the model text is replaced with {@link REDACTED}
 * and the trace is stripped. The caller's input is never mutated.
 *
 * @returns `{ intervened: false, response }` (unchanged) when no intervention
 *   matched, otherwise `{ intervened: true, intervention, response }` where
 *   `response` is a redacted deep copy and `intervention` carries categories
 *   only — never the violating content.
 */
export function redactResponseTool(args: {
  response: ConverseResponse;
  guardrail_id: string;
}) {
  const { response, guardrail_id } = args;
  const intervention = checkGuardrailIntervention(response, guardrail_id);
  if (intervention === null) {
    return {
      intervened: false as const,
      response,
    };
  }

  // Deep-copy + redact. We don't mutate the caller's input.
  const safe: ConverseResponse = JSON.parse(JSON.stringify(response));
  if (safe.output?.message) {
    safe.output.message = {
      role: safe.output.message.role ?? 'assistant',
      content: [{ text: REDACTED }],
    };
  }
  if (safe.trace) {
    safe.trace = { guardrail: { redacted_by: 'bedrock-ops' } as never };
  }

  return {
    intervened: true as const,
    intervention,
    response: safe,
  };
}

/**
 * Inspect a Converse response's guardrail trace for an intervention by the
 * given guardrail id.
 *
 * @returns `null` when the guardrail did not intervene (no trace, or no
 *   assessment under `guardrailId`), otherwise a sanitised
 *   {@link GuardrailIntervention}. Output assessments take precedence over
 *   input assessments when both are present.
 */
export function checkGuardrailIntervention(
  response: ConverseResponse,
  guardrailId: string,
): GuardrailIntervention | null {
  const guardrail = response.trace?.guardrail;
  if (!guardrail) return null;
  const outputAssessments = guardrail.outputAssessments ?? {};
  const inputAssessment = guardrail.inputAssessment ?? {};
  const outputForId = outputAssessments[guardrailId] ?? [];
  const inputForId = inputAssessment[guardrailId] ?? null;

  if (
    outputForId.length === 0 &&
    (inputForId === null || Object.keys(inputForId).length === 0)
  ) {
    return null;
  }

  const stopReason = response.stopReason ?? '';
  const action: GuardrailIntervention['action'] =
    stopReason === 'guardrail_intervened' ||
    stopReason === 'GUARDRAIL_INTERVENED'
      ? 'BLOCKED'
      : 'ANONYMIZED';

  let intervenedOn: GuardrailIntervention['intervened_on'];
  const categoriesSet = new Set<string>();
  if (outputForId.length > 0) {
    intervenedOn = 'output';
    for (const a of outputForId) {
      for (const ft of FILTER_TYPES) {
        if (ft in a) categoriesSet.add(ft);
      }
    }
  } else {
    intervenedOn = 'input';
    if (inputForId !== null) {
      for (const ft of FILTER_TYPES) {
        if (ft in inputForId) categoriesSet.add(ft);
      }
    }
  }

  return {
    guardrail_id: guardrailId,
    action,
    intervened_on: intervenedOn,
    categories: Array.from(categoriesSet).sort(),
  };
}
