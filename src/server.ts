#!/usr/bin/env node
/**
 * bedrock-ops MCP server.
 *
 * Exposes three tools to any MCP client (Claude Desktop, Cursor, Cline,
 * Windsurf, Zed, etc.):
 *
 *   bedrock_capabilities    — look up an AWS Bedrock model's capabilities
 *                             (max tokens, vision, tools, cache, thinking,
 *                             streaming, regions).
 *   bedrock_precheck        — validate a feature combination against a
 *                             model's capabilities BEFORE the API call so
 *                             the failure mode is "this combo isn't
 *                             supported" instead of "ValidationException
 *                             at runtime".
 *   bedrock_redact_response — return a copy of a Bedrock Converse response
 *                             with violating PII redacted, safe to send
 *                             to a structured logger or trace store.
 *                             Mirrors the Python lib's safe_log_response.
 *
 * Wraps the Python library at https://github.com/MukundaKatta/bedrock-ops
 * by re-implementing its query-shaped surface (capability table + pure
 * functions) natively in TypeScript so the MCP server has zero runtime
 * dependencies beyond the MCP SDK.
 *
 * Configure your client to spawn this binary over stdio. Example for
 * Claude Desktop's claude_desktop_config.json:
 *
 *   {
 *     "mcpServers": {
 *       "bedrock-ops": {
 *         "command": "npx",
 *         "args": ["-y", "@mukundakatta/bedrock-ops-mcp"]
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  listKnownModels,
  lookupCapabilities,
  type ModelCapabilities,
} from './capabilities.js';

const VERSION = '0.1.0';

const server = new Server(
  {
    name: 'bedrock-ops',
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// --- tool catalog ---------------------------------------------------------

const TOOLS = [
  {
    name: 'bedrock_capabilities',
    description:
      "Look up an AWS Bedrock foundation model's capabilities: max input/output tokens, vision support, tool-use support, prompt-cache support, thinking-mode support, streaming support, cross-region inference, and the list of regions where it's available. Accepts both bare model ids (e.g. 'anthropic.claude-sonnet-4-20250514-v1:0') and cross-region inference profile ids (e.g. 'us.anthropic.claude-sonnet-4-...'). Returns null capabilities + a list of known model ids when the requested model isn't in the table — use that response to inform the user the model is unrecognized.",
    inputSchema: {
      type: 'object',
      properties: {
        model_id: {
          type: 'string',
          description:
            "Bedrock model id, e.g. 'anthropic.claude-sonnet-4-20250514-v1:0' or with a cross-region prefix like 'us.anthropic.claude-...'.",
        },
      },
      required: ['model_id'],
    },
  },
  {
    name: 'bedrock_precheck',
    description:
      'Validate a feature combination against an AWS Bedrock model BEFORE making the API call. Catches incompatibilities like "model does not support thinking mode", "model not available in eu-central-1", or "feature combo (cache + latency-optimized) silently throws ValidationException at runtime" without an API round-trip. Returns ok=true when every requested feature is supported, otherwise ok=false with a list of unsupported features and a human-readable message.',
    inputSchema: {
      type: 'object',
      properties: {
        model_id: {
          type: 'string',
          description: 'Bedrock model id (bare or cross-region prefixed).',
        },
        use_prompt_cache: {
          type: 'boolean',
          default: false,
        },
        use_thinking: {
          type: 'boolean',
          default: false,
        },
        use_vision: {
          type: 'boolean',
          default: false,
        },
        use_tool_use: {
          type: 'boolean',
          default: false,
        },
        use_streaming: {
          type: 'boolean',
          default: false,
        },
        region: {
          type: 'string',
          description:
            'Optional region check. When set, fails if the model is not available in this region.',
        },
      },
      required: ['model_id'],
    },
  },
  {
    name: 'bedrock_redact_response',
    description:
      'Take a raw Bedrock Converse response that may contain PII (because a Guardrail intervention surfaces the violating content in the API response) and return a copy safe to send to a structured logger or trace store. When the configured guardrail intervened, the model output text is replaced with [REDACTED-by-bedrock-ops] and the trace is stripped. When no intervention occurred, returns the response unchanged. Mirrors the Python lib\'s safe_log_response().',
    inputSchema: {
      type: 'object',
      properties: {
        response: {
          type: 'object',
          description:
            'The raw response dict from boto3 client.converse(). Must include output.message.content (or be empty) and optionally trace.guardrail.',
        },
        guardrail_id: {
          type: 'string',
          description:
            "The guardrailIdentifier you used in your guardrailConfig. Required to look up the right intervention record. Pass the same value you sent in 'guardrailConfig.guardrailIdentifier'.",
        },
      },
      required: ['response', 'guardrail_id'],
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// --- tool dispatch --------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case 'bedrock_capabilities':
        return capabilitiesTool(args as unknown as { model_id: string });
      case 'bedrock_precheck':
        return precheckTool(args as unknown as PrecheckArgs);
      case 'bedrock_redact_response':
        return redactResponseTool(
          args as unknown as {
            response: ConverseResponse;
            guardrail_id: string;
          },
        );
      default:
        return errorResult('unknown tool: ' + name);
    }
  } catch (err) {
    return errorResult('internal error: ' + (err as Error).message);
  }
});

// --- types ---------------------------------------------------------------

interface PrecheckArgs {
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

interface ConverseResponse {
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

const REDACTED = '[REDACTED-by-bedrock-ops]';

const FILTER_TYPES = [
  'topicPolicy',
  'contentPolicy',
  'wordPolicy',
  'sensitiveInformationPolicy',
  'contextualGroundingPolicy',
] as const;

// --- tool implementations ------------------------------------------------

function capabilitiesTool(args: { model_id: string }) {
  const cap = lookupCapabilities(args.model_id);
  if (cap === null) {
    return jsonResult({
      model_id: args.model_id,
      known: false,
      message:
        `No capability data for model_id=${JSON.stringify(args.model_id)}. ` +
        `Either it's a new model not yet in the table, or a typo. ` +
        `Pass one of the known_models below.`,
      known_models: listKnownModels(),
    });
  }
  return jsonResult({
    model_id: args.model_id,
    known: true,
    capabilities: cap,
  });
}

function precheckTool(args: PrecheckArgs) {
  const cap = lookupCapabilities(args.model_id);
  if (cap === null) {
    return jsonResult({
      ok: false,
      model_id: args.model_id,
      reason: 'unknown_model',
      message:
        `No capability data for model_id=${JSON.stringify(args.model_id)}. ` +
        `Cannot precheck features.`,
    });
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
    return jsonResult({
      ok: true,
      model_id: args.model_id,
      requested,
      region: args.region ?? null,
    });
  }

  const messages: string[] = [];
  if (missing.length > 0) {
    messages.push(
      `Model ${args.model_id} does not support: ${missing.join(', ')}`,
    );
  }
  if (regionError) messages.push(regionError);

  return jsonResult({
    ok: false,
    model_id: args.model_id,
    requested,
    region: args.region ?? null,
    unsupported_features: missing,
    region_error: regionError ?? null,
    message: messages.join('. '),
  });
}

function redactResponseTool(args: {
  response: ConverseResponse;
  guardrail_id: string;
}) {
  const { response, guardrail_id } = args;
  const intervention = checkGuardrailIntervention(response, guardrail_id);
  if (intervention === null) {
    return jsonResult({
      intervened: false,
      response,
    });
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

  return jsonResult({
    intervened: true,
    intervention,
    response: safe,
  });
}

interface GuardrailIntervention {
  guardrail_id: string;
  action: 'BLOCKED' | 'ANONYMIZED';
  intervened_on: 'input' | 'output';
  categories: string[];
}

function checkGuardrailIntervention(
  response: ConverseResponse,
  guardrailId: string,
): GuardrailIntervention | null {
  const guardrail = response.trace?.guardrail;
  if (!guardrail) return null;
  const outputAssessments = guardrail.outputAssessments ?? {};
  const inputAssessment = guardrail.inputAssessment ?? {};
  const outputForId = outputAssessments[guardrailId] ?? [];
  const inputForId = inputAssessment[guardrailId] ?? null;

  if (outputForId.length === 0 && (inputForId === null || Object.keys(inputForId).length === 0)) {
    return null;
  }

  const stopReason = response.stopReason ?? '';
  const action: GuardrailIntervention['action'] =
    stopReason === 'guardrail_intervened' ||
    stopReason === 'GUARDRAIL_INTERVENED'
      ? 'BLOCKED'
      : 'ANONYMIZED';

  let intervenedOn: GuardrailIntervention['intervened_on'];
  let categoriesSet = new Set<string>();
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

// --- helpers --------------------------------------------------------------

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

// suppress unused-type warnings for fields that document future use
void ({} as ModelCapabilities);

// --- bootstrap ------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(`bedrock-ops MCP server v${VERSION} ready on stdio\n`);
