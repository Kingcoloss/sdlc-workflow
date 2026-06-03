# Design: `/sdlc-triage` — mid-flow finding intake

- **Date**: 2026-06-03
- **Plugin**: `sdlc-workflow`
- **Status**: Approved (Gate-A / brainstorming) — ready for implementation plan
- **Author**: brainstorming session with user

## Problem

The plugin encodes a **forward** flow only: `init → plan (Gate A) → execute (Gate B) → review/standup/resume`. Every command assumes a requirement that was already planned. When the user does a walkthrough/UAT and finds a **defect** or an **adjustment point** that is *out of the original plan*, there is no first-class place to insert it:

- `/sdlc-plan` is for a brand-new requirement (full research/breakdown — too heavy).
- `/sdlc-execute` requires an already-approved plan.
- `/sdlc-resume`'s `review-fail` / `UAT-fail → re-plan` path exists but swings the whole batch back to a full re-plan.

Result: out-of-plan findings have nowhere to go and stall. This is **mid-sprint change intake** in Agile terms — a finding must pass a triage gate before deciding *fix-now / fold-into-sprint / backlog / reject*, but the plugin has no **lateral intake**.

## Goals

1. Capture out-of-plan findings from a walkthrough/UAT (single or batch).
2. **Verify** each finding adversarially against actual code at HEAD before classifying — kill false findings with `file:line` + test/commit evidence (mirrors the manual triage pattern the user already runs; honors the "green ≠ resolved" lesson).
3. **Triage** each verified finding into a lane, with an explicit **plan/milestone impact evaluation** for fold-candidates.
4. **Propose** recommendations behind a gate — never auto-act (same philosophy as Gate A / Gate B).

## Non-goals

- Not a replacement for `/sdlc-plan` (no full research/breakdown of a new feature).
- Not a re-implementation of the review machinery — it **reuses** `sdlc-review.js`'s adversarial verifier sub-routine.
- The command does not silently write production code beyond the explicitly-approved `inline-fix` lane.

## Locked decisions

| Axis | Decision |
|------|----------|
| Core behavior | **Capture + Triage + Propose** (gate; no auto-act) |
| Verify depth | **Adversarial vs HEAD** — Workflow with fan-out verifiers |
| Lanes | **Inline-fix · Fold-into-sprint · New-ticket/backlog · Reject/won't-fix** (full set) |
| Input | `$ARGUMENTS` → `.claude/walkthrough.md` (Markdown) → board pull `tag=triage-inbox` |
| Positioning | **New command `/sdlc-triage`**, reusing `sdlc-review.js` verifier |
| Extra | **Plan/milestone impact eval** (pros/cons) for every fold-candidate |

### Input-format rationale (token efficiency)

- **Markdown buffer wins**: minimal syntax, diff-friendly, git-trackable, cheapest to read back.
- HTML rejected: structural tags inflate token count 2–3× for no benefit on a scratch buffer.
- ClickUp rejected as the *primary* buffer: every read is an MCP JSON payload (~15 metadata fields/task) + network round-trip — too expensive as a jot-pad. Board is used only as a **secondary** source for findings already formalized on it.
- Lifecycle: raw finding lives cheap in `.claude/walkthrough.md`; once accepted as work, it gets promoted to the board (same pattern as `.remember/now.md` → memory).

## Positioning in the command set

```
forward:  init → plan(Gate A) → execute(Gate B)
lateral:                    └─ triage(Gate T) ──┐
                                                 ├→ inline-fix (here, after approval)
walkthrough/UAT finds X ───► /sdlc-triage ───────┼→ fold → amend sdlc-plan.json → /sdlc-execute
                                                 ├→ new-ticket → /sdlc-plan next round
                                                 └→ reject → log + close
```

Lateral intake — callable at any point, does not require an active execute run.

## Components

| File | Role |
|------|------|
| `skills/sdlc-triage/SKILL.md` | Gate wrapper: resolve config + input, invoke Workflow, present report, **Gate-T** via `AskUserQuestion`, act per approved lane, persist. |
| `workflows/sdlc-triage.js` | Deterministic multi-agent: parse → verify(HEAD) → plan-impact → classify lanes. Returns one structured result. |
| `references/triage-lanes.md` | Lane definitions, what each lane touches, and the plan-impact rubric. |
| `.claude-plugin/plugin.json` | Register the new skill (if not auto-discovered from `skills/`). |
| `README.md` | Add slash-command row + typical-session snippet. |
| `references/project-config.md` | Document the `triage-inbox` tag convention (board section). |

## Workflow phases (`sdlc-triage.js`)

```
Phase 1  Parse/normalize   → findings[] {id, text, area_hint}
Phase 2  Verify (fan-out)  → each finding adversarially vs HEAD
         [reuse sdlc-review.js verifier]
         → {is_real, severity, evidence(file:line + test/commit), in_scope}
Phase 3  Plan-impact eval  → only real + fold-candidate findings; read active plan
         → {pros[], cons[], milestone_effect, dep/file-overlap conflict, blast_radius}
Phase 4  Classify + synth  → recommend lane per finding + rationale
```

Return shape:

```jsonc
{
  "findings": [
    {
      "id": "F1",
      "text": "...",
      "verdict": { "is_real": true, "severity": "high",
                   "evidence": "Foo.cs:53 — no [FromQuery] binding; test X bypasses JSON",
                   "in_scope": true },
      "recommended_lane": "fold",
      "plan_impact": { "pros": ["context warm", "avoids rework"],
                       "cons": ["milestone slips 1 wave"],
                       "milestone_effect": "+1 wave",
                       "conflicts": ["wave 2 touches same file"],
                       "blast_radius": "3 callers" },
      "rationale": "..."
    }
  ],
  "summary": { "total": 5, "real": 4, "by_lane": { "inline": 1, "fold": 2, "ticket": 1, "reject": 1 } }
}
```

## Plan-impact rubric (heart of the `fold` lane)

For every fold-candidate, evaluate against `.claude/sdlc-plan.json` (active plan + waves + milestone):

| Dimension | Question |
|-----------|----------|
| **Scope** | Adds a new task/wave, or grows an existing task's surface? |
| **Milestone** | Does wave-count / target slip? By how much (estimate)? |
| **Dependency** | Conflicts with or blocks an in-flight wave? |
| **File overlap** | Touches files an active task already touches (coupling/merge risk)? Use graphify `get_impact_radius` if available. |
| **Foundation risk** | Is in-flight work built on the thing this finding says is wrong? → "fix before it compounds." |

Output: a **fold-now vs defer** recommendation with explicit pros/cons + `milestone_effect`. Example — *pros: context still warm, avoids rework / cons: milestone slips 1 wave, risk of destabilizing tested code.*

## Gate-T (triage gate)

The skill presents, per finding, a row of `verdict · recommended_lane · pros/cons · evidence`, then calls `AskUserQuestion`: confirm the lane per finding (accept the full recommendation set, or override per finding). **No action until approval** — identical discipline to Gate A / Gate B.

## Act per lane (after approval)

| Lane | Action |
|------|--------|
| **inline-fix** | Edit in session → re-verify → record result in log. (The only lane that touches code directly, for trivial verified-real in-scope findings.) |
| **fold** | Append fix-task(s) to `.claude/sdlc-plan.json` (+ board task if approved) → instruct user to run `/sdlc-execute`. No code written here. |
| **new-ticket** | Create ClickUp task (severity → tag) for a future `/sdlc-plan`. |
| **reject** | Log rationale; if the finding came from the board, remove the `triage-inbox` tag + close. |

## Error handling (no silent failure)

- **No active plan** (`.claude/sdlc-plan.json` absent): the `fold` lane is unavailable; fold-candidates auto-downgrade to `new-ticket` + notify the user.
- **Verifier refutes a finding**: it lands in the `reject` lane *with the refutation evidence* — never dropped silently.
- **Board / MCP unavailable**: skip the board source + board-write actions; local lanes keep working; report the degradation explicitly.
- **Empty input** (no args, no `walkthrough.md`, no tagged tasks): stop and explain how to supply findings — do not guess.

## Persistence

- `.claude/walkthrough.md` — mark triaged findings as processed.
- `.claude/sdlc-log.md` — one-line `GATE-T` entry (timestamp, counts by lane, approved/declined).
- `.claude/sdlc-triage-<ts>.json` — full audit of the triage result.

## Acceptance scenarios (verification — workflows are hard to unit-test)

| # | Input | Expected |
|---|-------|----------|
| a | A real bug finding | verified real → `fold` with pros/cons + milestone_effect |
| b | A false finding | adversarially refuted → `reject` lane with refutation evidence |
| c | Out-of-scope enhancement | `new-ticket` |
| d | Fold-candidate but no active plan | downgrades to `new-ticket` + notice |
| e | Finding tagged `triage-inbox` on board | board-pull source ingests it, triages, updates tag/status on action |

## Open questions

None outstanding — all resolved during brainstorming.
