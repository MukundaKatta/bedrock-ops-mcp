<!--
Thanks for sending a PR to bedrock-ops-mcp.

Quick reminders before you submit:
  - This is an MCP server. Tools must stay read-only / side-effect-free. See CONTRIBUTING.md.
  - Tool descriptions are read by an LLM agent with no other context. Make them precise.
  - Tests live in test/ and run via `npm test`. Add one for any new logic.
  - Capability table entries must also be mirrored into the Python `bedrock-ops` repo within the same week.
-->

## What this changes

A one-line summary, then a short paragraph if needed.

## Why

The user-visible problem or capability gap this addresses.

## Type of change

- [ ] Bug fix in an existing tool (`bedrock_capabilities` / `bedrock_precheck` / `bedrock_redact_response`)
- [ ] New capability table entry (a new Bedrock model)
- [ ] New MCP tool (read-only / side-effect-free only)
- [ ] Documentation
- [ ] CI / build / release plumbing
- [ ] Test coverage

## Scope check (for new tools)

- [ ] Tool is read-only or near-read-only. No AWS spend triggered by an LLM client calling it.
- [ ] Tool does not require AWS credentials at the MCP server layer.
- [ ] Tool description is written for an LLM consumer (no internal jargon, no "see the docs").

## Validation

- [ ] `npm test` passes locally
- [ ] `npm run lint` (tsc --noEmit) passes locally
- [ ] `npm run build` succeeds and the server starts: piping `tools/list` to `node dist/server.js` returns the expected tool array
- [ ] If a capability table entry was added, a matching change is queued for the Python `bedrock-ops` `_capability_data.py`

## Linked issue

Closes #
