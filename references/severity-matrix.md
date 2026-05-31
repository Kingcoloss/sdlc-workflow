# Severity Decision Matrix

Used by `sdlc-plan` to assign a default worker agent per task. Project-level overrides go in `.claude/sdlc.local.md` under `severityMatrix`.

| Severity | Default model | Default agentType            | Use when |
|----------|---------------|------------------------------|----------|
| urgent   | opus          | (none — direct opus call)    | Architecture-critical, dependency-heavy, cross-handler price/data correctness, review/UAT gates |
| high     | opus          | `codex:codex-rescue`         | High blast radius or correctness-sensitive but bounded. Codex Senior-Dev preferred when scope is non-conflicting; Opus fallback if conflict-risky |
| normal   | sonnet        | (none)                       | Bounded coding, UI wiring, proxies, compatibility work |
| low      | haiku         | (none)                       | Research, summary, documentation-only clarification |

## Override schema

```yaml
severityMatrix:
  urgent:
    model: opus
    agentType: null            # or a custom subagent type
    note: "Max-effort Opus"
  high:
    model: opus
    agentType: "codex:codex-rescue"
    note: "Codex Senior-Dev high-effort when bounded"
  normal:
    model: sonnet
    agentType: null
  low:
    model: haiku
    agentType: null
```

## Notes

- `model` is one of `opus`, `sonnet`, `haiku`. The workflow passes it via `agent(prompt, { model })`. Effort levels (e.g. XHigh, Max) are not selectable inside the workflow — they're configured at the parent Claude Code session.
- When `agentType` is set, the workflow passes `{ agentType }` instead of `{ model }` to `agent()`. The agentType resolves to a registered subagent (e.g. `codex:codex-rescue`, `general-purpose`, or any plugin agent).
- A grey-zone in severity → bump UP. Better to over-spend on Opus than to ship an incorrect change.

## Rationale per row

- **urgent → opus**: bugs at this level have systemic blast. Cost of incorrect output is far higher than token cost difference.
- **high → codex (preferred)**: Codex Senior-Dev brings independent perspective; reduces echo-chamber bias from same-model Opus. Falls back to opus when the task touches files that other sub-agents might also touch in the same wave (Codex worktree semantics may differ).
- **normal → sonnet**: covers most real work. Sonnet handles bounded coding well.
- **low → haiku**: research and summarization don't need deep reasoning; haiku is cheap and adequate.
