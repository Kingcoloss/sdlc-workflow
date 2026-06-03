---
name: sdlc-triage
description: Triage out-of-plan findings from a walkthrough/UAT — adversarially verify each vs HEAD, evaluate plan/milestone impact, classify into a lane (inline-fix / fold-into-sprint / new-ticket / reject), then act behind a gate. Use when a walkthrough or UAT surfaces a defect or adjustment point outside the current plan.
argument-hint: [findings as free-text; newline- or ;-separated. Empty → reads .claude/walkthrough.md]
allowed-tools: Bash, Read, Write, Edit, Workflow, AskUserQuestion, mcp__clickup__clickup_filter_tasks, mcp__clickup__clickup_create_task, mcp__clickup__clickup_update_task, mcp__clickup__clickup_remove_tag_from_task
---

# /sdlc-triage — Lateral finding intake (Gate T)

## Purpose

Process findings that arise *outside* the planned flow (walkthrough/UAT defects, adjustment points). Each finding is **adversarially verified against HEAD**, **fold-candidates get a plan/milestone impact eval**, and each is **classified into a lane**. Nothing is acted on until **Gate T** approval — same discipline as Gate A / Gate B.

Lanes: `inline-fix` · `fold-into-sprint` · `new-ticket` · `reject` (+ `unverified` = verify failed, surfaced for manual decision).

## What you (Claude) must do

### Step 1 — Resolve input → findings[]

Resolve in priority order (deterministic split — do NOT spend an agent on parsing):

1. **`$ARGUMENTS` non-empty** → split into findings on newline or `;`. Each non-blank segment = one finding.
2. **Else `.claude/walkthrough.md`** → each `## ` heading is one finding (heading + its body); if there are no headings, each top-level `- ` bullet is one finding. **Skip** any finding already marked `> triaged` (idempotent re-runs).
3. **Board pull (optional, additive)** — if `config.taskBoard.type === 'clickup'` AND the user asked to include the inbox: `clickup_filter_tasks` with `tags: ["triage-inbox"]` on the configured `listId`. Each task → a finding `{ text: name + description, source: 'board', board_task_id }`.

Assign ids `F1, F2, …`. **If all sources are empty → STOP** and tell the user how to supply findings (args, `.claude/walkthrough.md`, or board tag `triage-inbox`). Do not guess.

### Step 2 — Resolve config + active plan

- Config: `.claude/sdlc.local.md` → project `CLAUDE.md` → defaults (see `references/project-config.md`). Only `codebase` + `tools` + `taskBoard` are needed here.
- Active plan: read `.claude/sdlc-plan.json` if present → pass as `plan`; else `plan: null` (the `fold` lane will be unavailable and fold-candidates downgrade to `new-ticket`).

### Step 3 — Invoke the Workflow

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/sdlc-triage.js",
  args: { findings, plan, config: { codebase, tools, taskBoard } }
})
```

### Step 4 — Present triage report + Gate T

Render a scannable table (one row per finding):

```
## Triage — <n> finding(s), <real> real

| # | Finding | Verdict | Lane | Why |
|---|---------|---------|------|-----|
| F1 | <short> | real · high · in-scope | fold | pros: …; cons: … (milestone +1 wave) |
| F2 | <short> | refuted | reject | <reason> |
| F3 | <short> | real · low · in-scope | inline-fix | trivial |
```

For `fold` rows, show the impact `pros` / `cons` / `milestone_effect`. For `unverified` rows, flag them explicitly as **needs manual decision** — never silently drop.

Then **Gate T** via `AskUserQuestion`: "Apply the recommended lanes?" with options **Accept all** / **Override specific** / **Cancel**. If *Override specific*, follow up to collect the per-finding lane the user wants (one question per finding being overridden, batched ≤4 at a time).

### Step 5 — Act per approved lane

After approval, for each finding:

| Lane | Action |
|------|--------|
| **inline-fix** | Apply the fix with `Edit`; re-verify (re-read the cited code / run the relevant test); record the outcome. The ONLY lane that writes code from this skill. |
| **fold** | Append a fix-task to `.claude/sdlc-plan.json` (`id` like `T<n>` or `FX<n>`, severity from verdict, `files_to_touch` from evidence, `dependencies`/wave from the impact `conflicts`). If `taskBoard` configured AND user approved board writes → `clickup_create_task`. Tell the user to run `/sdlc-execute` to build it. **No code written here.** |
| **new-ticket** | `clickup_create_task` on the configured list (title from finding, severity→tag, body = verdict evidence). If no board → append the item to `.claude/sdlc-backlog.md` instead. |
| **reject** | Log the rationale only. If `source === 'board'` → `clickup_remove_tag_from_task` (remove `triage-inbox`) and set status closed. |
| **unverified** | Do NOT act. List it back to the user for a manual call. |

Respect the gate: a board write happens only if the user approved board actions (ask once in Gate T if `taskBoard` is configured).

### Step 6 — Persist

- **`.claude/walkthrough.md`** — append `> triaged <UTC-date> → <lane>` under each processed finding (so re-runs skip them). Create the file's `## Triaged` archive section if you prefer to move them.
- **`.claude/sdlc-log.md`** — one line: `<UTC> | GATE-T | <n> findings | lanes inline=.. fold=.. ticket=.. reject=.. unverified=.. | board_writes=<y/n>`.
- **`.claude/sdlc-triage-<UTC-timestamp>.json`** — full workflow result for audit.

## Anti-patterns

- ❌ Do NOT act on any lane before Gate-T approval.
- ❌ Do NOT silently reject an `unverified` finding — surface it.
- ❌ Do NOT write production code for any lane except `inline-fix`.
- ❌ Do NOT spend an agent to split input — the parse in Step 1 is deterministic.
- ❌ Do NOT create board tickets unless the board is configured AND the user approved board writes.
- ❌ Do NOT use `Workflow({ name: "sdlc-triage" })` — use `scriptPath` with `${CLAUDE_PLUGIN_ROOT}`.

## Refs

- `references/triage-lanes.md` — lane definitions + plan-impact rubric
- `references/project-config.md` — config schema + `triage-inbox` tag convention
