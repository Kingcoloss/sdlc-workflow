# Project Config — `.claude/sdlc.local.md`

Each project that uses this plugin can drop a `sdlc.local.md` in its `.claude/` directory to customize behavior. The file is YAML frontmatter (optionally followed by free-text notes).

`.gitignore` should include `.claude/*.local.md` to keep per-developer overrides local.

## Schema

```yaml
---
projectName: my-app                          # human-readable
projectRoot: .                               # rarely overridden

codebase:
  graphifyAvailable: true                    # auto-detected if omitted (looks for graphify-out/graph.json)
  hasTests: true                             # auto-detected if omitted
  primaryLanguages: [python, typescript]     # for review prompts
  testCommand: "pytest -q && npm test"       # used by execute phase to verify

tools:                                       # bubbles into sub-agent TOOLS: line
  - graphify
  - chrome-devtools
  - mongo-mcp
  - notebooklm

taskBoard:
  type: clickup                              # clickup | linear | jira | github-issues | none
  listId: "901818402612"                     # for clickup: list id; for linear: team key; for jira: project key

severityMatrix:                              # see severity-matrix.md
  urgent: { model: opus,   agentType: null }
  high:   { model: opus,   agentType: "codex:codex-rescue" }
  normal: { model: sonnet, agentType: null }
  low:    { model: haiku,  agentType: null }

reviewDimensions:                            # default ['code','architecture','integration','e2e','security']
  - code
  - architecture
  - integration
  - e2e
  - security
  - performance                              # optional extra
  - accessibility                            # optional extra

execute:
  useWorktreeIsolation: false                # safer parallel devs, slower
  skipGraphUpdate: false
  skipReview: false
  skipUatPlan: false

sdlcReference: |
  (Optional. A short excerpt from the project's own CLAUDE.md to pass as additional
  context to the research phase — e.g. domain rules, day-count conventions, naming
  conventions. Keep under ~1.5KB to stay within token budgets.)
---

# Notes (free text — for human readers, ignored by skills)

This file is consumed by /sdlc-plan and /sdlc-execute. Per-developer overrides
go here; team-level conventions belong in the project's CLAUDE.md.
```

## Triage inbox tag (`/sdlc-triage`)

`/sdlc-triage` can pull findings already logged on the board. The convention is the tag **`triage-inbox`**:

- Tag any board task `triage-inbox` to mark it as a raw finding awaiting triage.
- `/sdlc-triage` (when asked to include the board source) pulls all `triage-inbox` tasks via `clickup_filter_tasks`, verifies + classifies them, and on action removes the tag (and closes, for the `reject` lane).
- This is a **tag**, not a status — no per-list status configuration is required. Works on any board.

For projects without a task board, the equivalent inbox is the Markdown buffer `.claude/walkthrough.md` (one finding per `## ` heading or `- ` bullet).

## Resolution order

When a skill resolves config:

1. `.claude/sdlc.local.md` frontmatter (this file)
2. Project root `CLAUDE.md` — best-effort extract of severity matrix and tools
3. Inferred defaults (see `references/severity-matrix.md`)

Later sources fill gaps left by earlier sources; they do not overwrite.

## Examples

### Minimal config (just point at a ClickUp list)

```yaml
---
projectName: acme-api
taskBoard: { type: clickup, listId: "900123456" }
---
```

### Full config for a .NET + Vue project with graphify

```yaml
---
projectName: NeutralGravityQuant
codebase:
  graphifyAvailable: true
  primaryLanguages: [csharp, vue, typescript, python]
  testCommand: "dotnet test v2/dotnet/NeutralGravityQuant/NeutralGravityQuant.sln && npm --prefix v2/web run test"
tools: [graphify, chrome-devtools, mongo-mcp, notebooklm]
taskBoard: { type: clickup, listId: "901818402612" }
severityMatrix:
  urgent: { model: opus, agentType: null, note: "Max-effort Opus" }
  high:   { model: opus, agentType: "codex:codex-rescue", note: "Codex Senior-Dev when bounded" }
  normal: { model: sonnet }
  low:    { model: haiku }
execute:
  useWorktreeIsolation: false
sdlcReference: |
  Day-count conventions: GTBR uses 365 calendar; Expected Move uses 252 trading.
  Dual aggregation: System 1 (C−P) for Greeks; System 2 (C+P) except Vanna (C−P).
---
```
