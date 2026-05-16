---
name: Bug report
about: A tool returned the wrong answer, the server failed to start, or an MCP client can't reach a tool.
title: "[bug] "
labels: bug
assignees: ''
---

## What happened

A clear, concise description of the actual behavior.

## What you expected

A clear, concise description of what should have happened.

## Reproduction

Which tool: `bedrock_capabilities` / `bedrock_precheck` / `bedrock_redact_response`

Exact arguments passed:

```json
{
  "model_id": "...",
  "feature": "..."
}
```

Exact response received (paste the JSON-RPC `result` or `error`):

```json
```

## Environment

- bedrock-ops-mcp version: (`npm ls @mukundakatta/bedrock-ops-mcp` or `cat package.json | jq .version`)
- Node version: (`node --version`)
- OS: (macOS 14 / Ubuntu 22.04 / Windows 11)
- MCP client: (Claude Desktop / Cursor / Cline / Windsurf / Zed / custom)
- MCP client version:

## Server discovery confirms the tool is registered

Output of piping a `tools/list` request to the server (helps rule out manifest/build issues):

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/server.js
```

```json
```

## Notes

Anything else — model id involved, region, whether Guardrails were active, whether you're hitting cross-region inference (`us.`, `eu.`, `apac.`, `us-gov.` prefixes).
