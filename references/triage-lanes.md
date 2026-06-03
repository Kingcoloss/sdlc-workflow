# Triage Lanes + Plan-Impact Rubric

Reference for `/sdlc-triage`. A finding is verified adversarially vs HEAD, then mapped to a lane. **Lane mapping is deterministic** (computed in `workflows/sdlc-triage.js` → `classifyLane`); the agents only supply the *judgment inputs* (`is_real`, `severity`, `in_scope`, and — for fold-candidates — the impact eval).

## Lanes

| Lane | Entry condition | What it does (after Gate-T approval) |
|------|-----------------|--------------------------------------|
| **inline-fix** | real · in-scope · `severity == low` (trivial) | Fix applied immediately via `Edit`, then re-verified. The only lane that writes code from the triage skill. |
| **fold** | real · in-scope · non-trivial · **active plan exists** · impact recommends `fold` | Append a fix-task to `.claude/sdlc-plan.json` (+ board task if approved); user runs `/sdlc-execute`. No code written by triage. |
| **new-ticket** | real but out-of-scope; OR real in-scope with no active plan; OR impact recommends `defer` | Create a board ticket (or append to `.claude/sdlc-backlog.md`) for a future `/sdlc-plan`. |
| **reject** | `is_real == false` (adversarially refuted) or a deliberate won't-fix | Log rationale; if the finding came from the board, remove the `triage-inbox` tag and close. |
| **unverified** | verify agent errored or was skipped (no verdict) | NOT acted on. Surfaced to the user for a manual decision — never silently dropped. |

### Classification logic (exact)

```
!verdict              → unverified     (verify errored/skipped — surface, do not drop)
!is_real              → reject
!in_scope             → new-ticket     (separate/new concern → backlog)
severity == low       → inline-fix     (trivial in-scope)
no active plan        → new-ticket     (nothing to fold into)
impact == 'defer'     → new-ticket
otherwise             → fold
```

## Plan-Impact Rubric (the `fold` lane's core)

Runs **only** for fold-candidates (real · in-scope · non-trivial · active plan present). The impact agent assesses injecting the finding into the active sprint, against the compact plan view (`requirement`, `tasks[{id,title,severity,files}]`, `execution_order`):

| Dimension | Question |
|-----------|----------|
| **Scope** | Does it add a new task/wave, or grow an existing task's surface? |
| **Milestone** | Does wave-count / target slip? By how much? (`milestone_effect`) |
| **Dependency** | Does it conflict with or block an in-flight wave? |
| **File overlap** | Does it touch files an active task already touches (coupling/merge risk)? Use graphify `get_impact_radius` if available. |
| **Foundation risk** | Is in-flight work built on the thing this finding says is wrong? → "fix before it compounds." |

Output (`IMPACT_SCHEMA`): `recommended_lane` (`fold` | `defer`), `pros[]`, `cons[]`, `milestone_effect`, `conflicts[]`, `blast_radius`.

- **`fold`** when fixing now is cheaper than the rework of deferring — e.g. context is warm, foundation risk is high, file overlap is low.
- **`defer`** when folding destabilizes tested work or slips the milestone for a non-blocking concern.

## Input sources (priority)

1. `$ARGUMENTS` free-text — split on newline / `;`.
2. `.claude/walkthrough.md` — Markdown buffer; one finding per `## ` heading (or per top-level `- ` bullet). Cheapest source; skip findings already marked `> triaged`.
3. Board pull (additive) — ClickUp tasks tagged `triage-inbox` (see `project-config.md`).

## Persistence artifacts

- `.claude/walkthrough.md` — findings marked `> triaged <date> → <lane>` after processing.
- `.claude/sdlc-log.md` — one-line `GATE-T` entry per run.
- `.claude/sdlc-triage-<ts>.json` — full audit.
- `.claude/sdlc-backlog.md` — new-ticket items when no task board is configured.
