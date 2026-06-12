---
name: sdlc-execute
description: Run SDLC Steps 4-7 (parallel develop, graphify update, multi-dim review, UAT plan) using the plan produced by /sdlc-plan. Requires Gate-A user approval. Halts at Gate B (Post-UAT-Approval).
argument-hint: [optional plan path; defaults to .claude/sdlc-plan.json]
allowed-tools: Bash, Read, Write, Edit, Workflow, AskUserQuestion, TaskUpdate
---

# /sdlc-execute — Execute phase (SDLC Steps 4-7)

## Purpose

Invoke the `sdlc-execute` Workflow against an approved plan: fan-out sub-agents per execution wave, optionally refresh the graphify graph, run multi-dimensional review with adversarial verification of high-severity findings, and produce a UAT checklist. Halts at **Gate B** — main loop must request user approval before commit / graph update / standup / next-solution proposal.

## Prerequisites (check before invoking Workflow)

1. **Plan exists**: read `$ARGUMENTS` (path) or `.claude/sdlc-plan.json`. Stop with error if absent — instruct user to run `/sdlc-plan` first.
2. **Plan approved**: check `.claude/sdlc-log.md` for the most recent Gate-A "approved" entry referencing the plan's requirement. If not approved, stop and ask user for approval.
3. **Open questions resolved**: if `plan.research.open_questions` is non-empty AND no answers logged, surface them and stop.

## What you (Claude) must do

### Step 1 — Pre-flight

- Read the plan JSON.
- Read `.claude/sdlc-log.md` to confirm Gate-A approval timestamp.
- **Confirm `context_brief` is filled** for each task in the upcoming waves. The workflow prepends `task.context_brief` (main-loop session context) above the mechanical wrap and logs a ⚠ for any high/urgent task missing it. If a high/urgent task has none, author it now (resolved grey-zones, invariants not to break, cross-task seams — see `references/sub-agent-wrap.md`) and write it back to the plan JSON before invoking.
- If `plan.execution_order` contains a wave with `useWorktreeIsolation` recommended (multiple non-disjoint file sets), prompt user once to confirm worktree mode.

### Step 2 — Invoke the Workflow

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/sdlc-execute.js",
  args: { plan, config }
})
```

`config` reuses the same shape used in `sdlc-plan` plus the execute-only options:

- `useWorktreeIsolation` (boolean, default false)
- `reviewDimensions` (string[], default `['code','architecture','integration','e2e','security']`)
- `skipGraphUpdate` / `skipReview` / `skipUatPlan` (boolean)

### Step 3 — Triage the result

Branch on `result.overall_status`:

- **`blocked`**: list all `dev.results` with `status === 'blocked'`. Show `grey_zones` to user. STOP — do not proceed.
- **`review-fail`**: list confirmed critical/high findings (those NOT marked `verified: false`). Group by dimension. Ask user whether to iterate on a subset (re-invoke execute with reduced plan) or escalate.
- **`ready-for-uat`**: present the UAT checklist. Ask user to run UAT manually and report pass/fail.

### Step 4 — Gate B (Post-UAT-Approval)

After user reports UAT pass, ask via `AskUserQuestion` for explicit approval to do EACH of these (multi-select):

- `graphify update .` (skip if no graphify in project)
- `git commit` (code + tests; explicitly NOT including `Goal-prompt.md` / `.claude/goal.md`)
- Update task-board statuses (if `config.taskBoard.type` is configured)
- Stand-up scrum status
- Propose next solution

Each approved item: execute it. Each declined item: skip.

### Step 5 — Persist execute log

Append a one-line checkpoint to `.claude/sdlc-log.md` with:
- timestamp (absolute date — convert relative dates)
- overall_status
- dev counts (done/blocked)
- review verdict (pass/warnings/fail)
- commit hash (if committed)

Also save the full execute result to `.claude/sdlc-execute-<status>.json` for audit.

## Anti-patterns

- ❌ Do NOT commit / graphify-update / publish without Gate-B approval — per CLAUDE.md Post-UAT-Approval gate.
- ❌ Do NOT include `Goal-prompt.md` in `git add`/`git commit` automatically.
- ❌ Do NOT mark UAT as passed based on review verdict alone — UAT requires explicit user observation.
- ❌ Do NOT proceed past `overall_status: blocked` — escalate grey_zones to user.
- ❌ Do NOT fan out high/urgent tasks with an empty `context_brief` — fill it first so sub-agents inherit the main-loop's session judgement.
- ❌ Do NOT use `Workflow({ name: "sdlc-execute" })` — must use `scriptPath` with `${CLAUDE_PLUGIN_ROOT}`.

## Refs

- `references/post-uat-gates.md` — Gate B specifics
- `references/severity-matrix.md` — how worker model is selected
- `references/sub-agent-wrap.md` — two-layer prompt: mechanical wrap + main-loop `context_brief`
