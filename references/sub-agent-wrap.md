# Sub-agent Prompt Wrap

Every sub-agent dispatched from `sdlc-execute` receives a prompt built from this template. The wrap is generated inside `sdlc-plan.js` (search for `SUB_AGENT_PROMPT_WRAP`) and stored on each task as `task.sub_agent_prompt_wrap`.

## Template

```
GOAL: <requirement from sdlc-plan args>
SCOPE: <task.title> — <task.description>
FILES IN SCOPE: <comma-separated task.files_to_touch>
OUT-OF-SCOPE: <comma-separated task.out_of_scope, or "(default: any file not listed)">
TOOLS: <comma-separated config.tools>
TEST SCENARIOS:
  - <each Given/When/Then>
TEST CASES:
  - <each input → expected>

REJECT self-extending: do NOT expand scope. If you hit a grey-zone, STOP and report back instead of guessing.
Use graphify trace (if available) BEFORE Grep/Glob/Read.
```

## Why this wrap

Sub-agents do NOT inherit the parent session's hooks, memory, or system prompts. Without an explicit wrap they will:
- expand scope ("while I'm here, let me also fix X")
- guess at grey-zones instead of stopping
- skip graphify and reach for Grep blindly

The wrap pins them to a contract.

## Per-project adjustments

If your project uses a non-standard tooling stack, override `config.tools` in `.claude/sdlc.local.md`. Common values:

```yaml
tools:
  - graphify           # codebase knowledge graph
  - chrome-devtools    # browser UAT
  - mongo-mcp          # DB observation
  - notebooklm         # domain research
  - playwright         # E2E browser tests
  - context7           # library docs
```

These bubble into the wrap's `TOOLS:` line, signalling to sub-agents which capabilities to use.

## Anti-patterns sub-agents commonly hit

- Adding "small refactors" outside `files_to_touch`. Reject in review.
- Writing tests that mock the system under test. Per `feedback_actual_result_tests`, require actual behavior verification.
- Silently catching exceptions to "make tests pass". Surface as review finding.
