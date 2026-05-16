# Security Policy

## Supported Versions

bedrock-ops-mcp is at v0.1.x. Security fixes will be issued for the current minor (0.1.x). Older minors will not receive backports.

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately by emailing `mukunda.vjcs6@gmail.com` with the subject `[bedrock-ops-mcp security]`. Include:

- A description of the vulnerability and its impact.
- The version of bedrock-ops-mcp affected (`npm ls @mukundakatta/bedrock-ops-mcp`).
- The MCP client involved (Claude Desktop, Cursor, Cline, Windsurf, Zed, custom).
- Reproduction steps or a minimal proof-of-concept.
- Any suggested mitigation, if you have one.

You can expect:

- An acknowledgment within 5 business days.
- A status update within 14 days.
- A coordinated disclosure window of at most 90 days from the acknowledgment.

## Specific Risk Surfaces

bedrock-ops-mcp is an MCP server that runs over stdio in the user's local environment, exposing AWS Bedrock query tooling to an LLM client. Areas worth special attention:

- **`bedrock_redact_response`** — this tool returns a redacted copy of a Bedrock Converse response when a Guardrail intervened. The whole point is to prevent PII from reaching logs / trace stores. If you find a Guardrail-intervened payload that surfaces the original violating content through this tool, that's a high-severity report.
- **`bedrock_capabilities`** — this is a static lookup against an in-process table. If the table can be poisoned via input (e.g. a registered model id with an injected string that breaks downstream tool dispatch), that's a real issue.
- **`bedrock_precheck`** — pure logic; no AWS credentials involved. Should be safe by construction. Report any path where it inadvertently leaks information about the user's AWS account or Bedrock entitlements.
- **stdio protocol layer** — the underlying `@modelcontextprotocol/sdk` handles the JSON-RPC framing. Vulnerabilities in that surface should be reported to <https://github.com/modelcontextprotocol/typescript-sdk> directly, not here.

## Dependencies

bedrock-ops-mcp has exactly one runtime dependency: `@modelcontextprotocol/sdk`. Any addition is reviewed for security impact and dependency confusion risk.

We will not pay bug bounties at this time.
