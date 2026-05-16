# bedrock-ops-mcp

[![npm](https://img.shields.io/npm/v/@mukundakatta/bedrock-ops-mcp.svg)](https://www.npmjs.com/package/@mukundakatta/bedrock-ops-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@mukundakatta/bedrock-ops-mcp.svg)](https://www.npmjs.com/package/@mukundakatta/bedrock-ops-mcp)
[![CI](https://github.com/MukundaKatta/bedrock-ops-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/MukundaKatta/bedrock-ops-mcp/actions/workflows/test.yml)
[![Node](https://img.shields.io/node/v/@mukundakatta/bedrock-ops-mcp.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@mukundakatta/bedrock-ops-mcp.svg)](./LICENSE)
[![mcp](https://img.shields.io/badge/mcp-stdio-blue)](https://modelcontextprotocol.io)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-1-brightgreen)](./package.json)

MCP server for AWS Bedrock model intelligence + PII-safe response handling. Wraps the Python library [`bedrock-ops`](https://github.com/MukundaKatta/bedrock-ops) by re-implementing its query-shaped surface natively in TypeScript so the MCP server has zero runtime deps beyond the MCP SDK.

```bash
npm install -g @mukundakatta/bedrock-ops-mcp
```

Or run via npx:

```bash
npx -y @mukundakatta/bedrock-ops-mcp
```

## Tools

### `bedrock_capabilities`

Look up an AWS Bedrock foundation model's capabilities: max input/output tokens, vision, tool-use, prompt-cache, thinking-mode, streaming, cross-region inference, and the regions where it's available.

```jsonc
// input
{ "model_id": "us.anthropic.claude-sonnet-4-20250514-v1:0" }

// returns
{
  "model_id": "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "known": true,
  "capabilities": {
    "model_id": "anthropic.claude-sonnet-4-20250514-v1:0",
    "family": "anthropic.claude",
    "max_input_tokens": 200000,
    "max_output_tokens": 64000,
    "supports_vision": true,
    "supports_tool_use": true,
    "supports_prompt_cache": true,
    "supports_thinking": true,
    "supports_streaming": true,
    "supports_cross_region_inference": true,
    "available_regions": ["us-east-1", "us-east-2", "us-west-2", "eu-central-1", ...]
  }
}
```

Cross-region inference profile prefixes (`us.`, `eu.`, `apac.`, `us-gov.`) are stripped automatically.

For unknown models, returns `{ known: false, known_models: [...] }` so the assistant can suggest the closest match.

### `bedrock_precheck`

Validate a feature combination against a model's capabilities BEFORE making the API call. Catches incompatibilities like:

- "Sonnet 3.5 doesn't support thinking mode" — saves a `ValidationException`
- "Opus 4 isn't available in `ap-south-1`" — saves a region-mismatch surprise
- "Mistral Large doesn't support prompt caching" — saves silent over-billing

```jsonc
// input
{
  "model_id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "use_thinking": true
}

// returns
{
  "ok": false,
  "model_id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "unsupported_features": ["thinking"],
  "message": "Model anthropic.claude-3-5-sonnet-20241022-v2:0 does not support: thinking"
}
```

### `bedrock_redact_response`

Take a raw Bedrock Converse response that may contain PII (because a Guardrail intervention surfaces the violating content in the API response — see [LiteLLM #12152](https://github.com/BerriAI/litellm/issues/12152)) and return a copy safe to send to a structured logger or trace store.

When the configured guardrail intervened, the model output text is replaced with `[REDACTED-by-bedrock-ops]` and the trace is stripped. When no intervention occurred, returns the response unchanged.

```jsonc
// input
{
  "response": {
    "output": { "message": { "content": [{ "text": "SSN 123-45-6789" }] } },
    "stopReason": "guardrail_intervened",
    "trace": { "guardrail": { "outputAssessments": { "gid-1": [...] } } }
  },
  "guardrail_id": "gid-1"
}

// returns
{
  "intervened": true,
  "intervention": {
    "guardrail_id": "gid-1",
    "action": "BLOCKED",
    "intervened_on": "output",
    "categories": ["sensitiveInformationPolicy"]
  },
  "response": {
    "output": { "message": { "role": "assistant", "content": [{ "text": "[REDACTED-by-bedrock-ops]" }] } },
    "stopReason": "guardrail_intervened",
    "trace": { "guardrail": { "redacted_by": "bedrock-ops" } }
  }
}
```

Critical invariant: the `intervention` object never contains the violating content. Categories only.

## Configure your MCP client

### Claude Desktop

Add to `claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "bedrock-ops": {
      "command": "npx",
      "args": ["-y", "@mukundakatta/bedrock-ops-mcp"]
    }
  }
}
```

### Cursor / Cline / Windsurf / Zed

Same shape — drop the `bedrock-ops` entry into the corresponding MCP server section.

## Why use this from an MCP client

Most Bedrock pain comes from "this model can't do X" or "this region doesn't have Y" surprises that surface as runtime `ValidationException`. Pre-checking from inside an assistant conversation, before you write or run any code, makes those surprises impossible.

Sample workflows:

> "Will Sonnet 4 with prompt caching and extended thinking work in eu-central-1?"
> *(assistant calls `bedrock_precheck`, returns `ok: true`)*

> "I just got this Bedrock response that contains a customer's SSN because Guardrails caught it. How do I log this without leaking?"
> *(paste the response. assistant calls `bedrock_redact_response`, returns the safe copy.)*

## Sibling

The Python source lives at [github.com/MukundaKatta/bedrock-ops](https://github.com/MukundaKatta/bedrock-ops). It also ships the `BedrockClient` (production-grade `boto3.client('bedrock-runtime')` wrapper with retry, timeouts, typed errors, and full TokenUsage including cache fields), which is too I/O-heavy to surface as an MCP tool and stays Python-only.

## Source

[github.com/MukundaKatta/bedrock-ops-mcp](https://github.com/MukundaKatta/bedrock-ops-mcp)

## License

Apache-2.0.

## Repository Health

This repository includes a dependency-free health check for core documentation, metadata, and CI wiring. Run it locally before publishing changes:

```sh
python3 scripts/check_repository_health.py
```

The same check runs in GitHub Actions on pushes and pull requests.
