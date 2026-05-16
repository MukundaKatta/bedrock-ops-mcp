# Changelog

All notable changes to `bedrock-ops-mcp` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-09

Initial release. MCP server exposing AWS Bedrock model intelligence + PII-safe response handling to Claude Desktop, Cursor, Cline, Windsurf, Zed, and other MCP clients.

### Added

- **`bedrock_capabilities` tool** — look up an AWS Bedrock foundation model's capabilities (max input/output tokens, vision, tool-use, prompt-cache, thinking, streaming, regions). Handles cross-region prefixes (`us.`, `eu.`, `apac.`, `us-gov.`).
- **`bedrock_precheck` tool** — validate feature combinations against a model BEFORE the API call. Catches "model doesn't support thinking", "model not in eu-central-1", "feature combo silently throws ValidationException at runtime".
- **`bedrock_redact_response` tool** — take a Bedrock Converse response that may contain PII (because Guardrail intervention surfaces violating content in the API response, see [LiteLLM #12152](https://github.com/BerriAI/litellm/issues/12152)) and return a copy safe to send to a structured logger.
- `server.json` manifest at modelcontextprotocol.io schema 2025-12-11 for registry discovery.

### Notes

- 13 unit tests via `node --test`.
- Zero runtime dependencies beyond `@modelcontextprotocol/sdk`.
- Capability table mirrors the Python `bedrock-ops` `_capability_data.py` and is treated as data, not API; new models added in patch releases.
- TypeScript native; no Python sidecar process at runtime.
