---
name: Feature request
about: Propose a new MCP tool, a new capability table entry, or a behavior change.
title: "[feat] "
labels: enhancement
assignees: ''
---

## Scope check

Before opening, please confirm this proposal fits the project scope (see `CONTRIBUTING.md`):

- [ ] It is a **read-only or near-read-only query**. (No `converse`, no `invoke_model`, no anything that spends AWS dollars when an LLM client calls it.)
- [ ] It does **not require AWS credentials** to be passed to the server. (If it does, it likely belongs in the Python `bedrock-ops` library, not here.)
- [ ] It does **not** require the MCP server to become stateful or hold sessions. (stdio + stateless is a hard line — see SECURITY.md.)

If any of those are unchecked, the right home is probably the Python `bedrock-ops` library: <https://github.com/MukundaKatta/bedrock-ops>.

## What you want

A clear description of the proposed tool or behavior.

## Why

What problem does it solve for the LLM agent calling this server? Concrete example of the prompt or flow that would benefit.

## Proposed tool shape

If proposing a new tool, sketch the input/output contract:

```jsonc
// tool name:
// input:
{
  "field": "type — description"
}
// output:
{
  "field": "type — description"
}
```

## Capability table entry

If this is "add model X to the lookup table", please also:

- [ ] Link to the AWS announcement / docs page for the model.
- [ ] Confirm whether the Python `bedrock-ops` `_capability_data.py` has the entry yet (we keep them in sync within a week).

## Alternatives considered

What workarounds exist today, and why aren't they good enough?
