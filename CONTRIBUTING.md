# Contributing to bedrock-ops-mcp

bedrock-ops-mcp is the MCP server wrapper for the AWS Bedrock query surface (capability lookup, feature pre-check, PII-safe response redaction). It is the TypeScript-native sibling of the Python [`bedrock-ops`](https://github.com/MukundaKatta/bedrock-ops) library.

## In scope

- Bug fixes in any of the three exposed tools (`bedrock_capabilities`, `bedrock_precheck`, `bedrock_redact_response`).
- New entries in the capability lookup table when AWS releases a new Bedrock model. Mirror the change into Python `bedrock-ops` and the user-facing TS table within the same week.
- Additional Bedrock query-style operations that have a stable, side-effect-free contract suitable for an MCP tool call.
- Test coverage improvements.
- Better error messages.

## Out of scope

- **Actual Bedrock invocation tools.** MCP tools should be read-only or near-read-only. Exposing `converse` or `invoke_model` directly via this server would let an LLM client run up arbitrary AWS bills. That belongs in the Python library used inside an application, not in an MCP server.
- **Credential management.** This server runs read-only queries that don't need AWS credentials. If a tool starts needing them, that's a sign it doesn't belong here.
- **Conversion to a stateful service.** MCP servers in this lineup are stdio-only and stateless. Adding sessions or persistence changes the threat model significantly.
- **Pricing tables.** AWS pricing drifts. We don't ship it.

## Sibling libraries

bedrock-ops-mcp wraps the Python library:

- Python: [`bedrock-ops`](https://github.com/MukundaKatta/bedrock-ops) (the canonical implementation)

Capability data lives in two places (Python `_capability_data.py` and TS `src/capabilities.ts`). When AWS releases a new model, both need updates within the same week.

## Development setup

```bash
git clone https://github.com/MukundaKatta/bedrock-ops-mcp.git
cd bedrock-ops-mcp
npm install
npm test              # 13 unit tests via node --test + tsx
npm run lint          # tsc --noEmit
npm run build         # tsc -> dist/
npm run dev           # tsx src/server.ts (run from stdio for local testing)
```

Node 18+ required.

## Local testing against an MCP client

After `npm run build`, point your MCP client at the built server:

```jsonc
{
  "mcpServers": {
    "bedrock-ops": {
      "command": "node",
      "args": ["/absolute/path/to/bedrock-ops-mcp/dist/server.js"]
    }
  }
}
```

For Claude Desktop, this goes in `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS). Restart the client. The server's stderr line `bedrock-ops MCP server v0.1.0 ready on stdio` should show up in the client's logs.

## Workflow

1. Open an issue first for anything bigger than a one-file change.
2. Branch from `main`.
3. Write tests for the change. Pure functions added in `src/` should have unit tests in `test/`.
4. Run `npm test` and `npm run lint` and confirm both pass.
5. Build the server (`npm run build`) and smoke-test by piping a tools/list JSON-RPC request to it.
6. Open a PR against `main`. Fill in the template.
7. CI must be green before review.

## Coding conventions

- TypeScript strict mode. No `any` in exported types; runtime `as unknown as T` casts are allowed where the SDK gives us `Record<string, unknown>`.
- Tool descriptions matter. Write them as if an LLM agent is going to read them with no other context — because that's exactly what happens.
- Error results (`isError: true`) should be plain strings the agent can act on, not stack traces.
- Use the `jsonResult` and `errorResult` helpers; don't construct MCP response objects inline.

## Release cadence

Releases follow semver. Patches: bug fixes only. Minor versions: new tools or new capability table entries. Major versions: breaking changes (unlikely in v0.x).

Releases are cut by the maintainer via tag push. See `.github/workflows/release.yml`. npm publish uses provenance OIDC; no NPM_TOKEN secret needed.
