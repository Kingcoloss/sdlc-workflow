---
name: sdlc-resume
description: Resume an in-progress SDLC flow — read state (sdlc-log, /remember, git diff, task board) and jump into the appropriate SDLC step. Use when user says "resume" or starts a session continuing prior work.
argument-hint: [optional context hint or specific feature to resume]
allowed-tools: Bash, Read, Workflow, AskUserQuestion, mcp__clickup__clickup_filter_tasks
---

# /sdlc-resume — Resume an SDLC flow

## Purpose

Encode the project CLAUDE.md "Resume Policy": read latest state, then jump to the appropriate SDLC step (most often Step 4 Develop) instead of restarting from Step 1. Generic across projects.

## What you (Claude) must do

### Step 1 — Inventory state (parallel)

Read in parallel:

- `git status` + `git diff --stat`
- `git log -10 --oneline`
- `.remember/now.md`, latest `today-*.md`, `recent.md`
- `.claude/sdlc-log.md` (latest 30 lines)
- `.claude/sdlc-plan.json` (if exists)
- `.claude/sdlc-execute-*.json` (most recent)
- Task board (ClickUp/Linear) for tasks in `in progress` / `blocked` / `review`

### Step 2 — Determine where to resume

| State signal | Resume target |
|--------------|---------------|
| `sdlc-plan.json` exists, no Gate-A in `sdlc-log.md` | Step 2.5 — re-surface plan to user; request Gate-A |
| Gate-A approved, no `sdlc-execute-*.json` | Step 4 — invoke `/sdlc-execute` |
| `sdlc-execute-*.json` with `overall_status: blocked` | Step 1 with adjusted plan (escalate grey_zones) |
| `sdlc-execute-*.json` with `overall_status: review-fail` | Step 6 — surface findings, iterate |
| `sdlc-execute-*.json` with `overall_status: ready-for-uat`, no UAT log | Step 7 — prompt user for UAT |
| UAT passed in log, no commit | Step 8 — Gate B (Post-UAT-Approval) |
| No SDLC artifacts but uncommitted code in git | Ask user: was this from /sdlc, or ad-hoc work? |
| Nothing pending | Run `/sdlc-standup` to summarize idle state |

### Step 3 — Propose resume action and confirm

Present a SHORT summary:

```
## Resume context
- **Branch**: <branch>
- **Active feature**: <requirement excerpt>
- **Last checkpoint**: <timestamp>, status=<status>
- **Next step**: <inferred SDLC step + reason>
```

Then ask via `AskUserQuestion`: confirm the inferred step? Or specify a different resume point?

### Step 4 — Execute the resume

After user confirms:

- For "invoke /sdlc-execute": call its skill instructions (or invoke the workflow directly).
- For "iterate review-fail": collect findings, generate a fix plan, invoke `/sdlc-execute` with subset.
- For "UAT prompt": present UAT checklist.
- For "Gate B": follow Post-UAT-Approval gate logic (see `references/post-uat-gates.md`).

## Anti-patterns

- ❌ Do NOT re-run `/sdlc-plan` if a valid plan exists — that wastes the prior research/breakdown work.
- ❌ Do NOT assume the user's last commit was from `/sdlc` — confirm provenance.
- ❌ Do NOT skip the inventory step — silent assumptions about state cause downstream churn.
