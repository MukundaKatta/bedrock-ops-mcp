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
  capabilitiesTool,
  precheckTool,
  redactResponseTool,
  type ConverseResponse,
  type PrecheckArgs,
} from './tools.js';

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
        return jsonResult(
          capabilitiesTool(args as unknown as { model_id: string }),
        );
      case 'bedrock_precheck':
        return jsonResult(precheckTool(args as unknown as PrecheckArgs));
      case 'bedrock_redact_response':
        return jsonResult(
          redactResponseTool(
            args as unknown as {
              response: ConverseResponse;
              guardrail_id: string;
            },
          ),
        );
      default:
        return errorResult('unknown tool: ' + name);
    }
  } catch (err) {
    return errorResult('internal error: ' + (err as Error).message);
  }
});

// --- helpers --------------------------------------------------------------

/** Wrap a JSON-serialisable value in the MCP text-content envelope. */
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

/** Build an MCP error result with `isError` set. */
function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

// --- bootstrap ------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(`bedrock-ops MCP server v${VERSION} ready on stdio\n`);
