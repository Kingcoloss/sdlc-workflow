---
name: sdlc-standup
description: Produce a concise stand-up scrum status — what's in progress, blockers, plans, next tasks. Reads ClickUp/Linear (if configured), git diff, and .claude/sdlc-log.md. No workflow invocation; designed to be fast.
argument-hint: [optional time budget — e.g. "20 min"]
allowed-tools: Bash, Read, AskUserQuestion, mcp__clickup__clickup_filter_tasks, mcp__clickup__clickup_get_task
---

# /sdlc-standup — Stand-up scrum status

## Purpose

Produce the 4-part scrum status defined by the project CLAUDE.md keyword `standup` / `stand up scrum`, in a generic way that works for any project. NO preamble — go directly to the status.

## What you (Claude) must do

### Step 1 — Snapshot state (parallel)

Run these reads in parallel via a single message:

- `git status` (short) + `git log -5 --oneline`
- `git diff --shortstat`
- Read `.claude/sdlc-log.md` last 20 lines (if exists)
- Read `.remember/now.md` and the latest `today-*.md` (if exists, format `.remember/today-YYYY-MM-DD.md`)
- If `.claude/sdlc.local.md` defines a taskBoard with `type: clickup` and a `listId`: call `mcp__clickup__clickup_filter_tasks` for that list with statuses `["in progress", "blocked", "review"]`. Same idea for linear/jira if those MCPs are configured.

### Step 2 — Emit status

Use this exact 4-section format. Tables/bullets, NO padding:

```
## Stand-up Scrum — <YYYY-MM-DD>

### 1. กำลังทำอะไร (now)
<active task title + id from ClickUp/Linear, or "idle at checkpoint">

### 2. ติดปัญหาตรงไหน (blockers)
| # | Blocker | Severity |
|---|---------|----------|
| B1 | ... | ... |

(or "none" if clear)

### 3. มี solution ยัง
| # | Status | Plan |
|---|--------|------|
| B1 | resolved/has-plan/open | ... |

### 4. ทำอะไรต่อ (next) — priority-ordered
1. ...
2. ...
```

Match the user's register (Thai prose + English tech terms inline). Use `ครับ` particle for sign-off only if the user has been using it.

### Step 3 — Execute within time budget (if user provided one)

If `$ARGUMENTS` contains a time budget (e.g. "20 min", "1 hour"):

1. Pick task(s) from "next" that fit the budget.
2. Execute them (use TaskCreate/TaskUpdate for tracking).
3. Re-emit the status reflecting new progress.

### Step 4 — Persist checkpoint

After meaningful progress, write a one-line summary to `.remember/now.md` (append, don't overwrite). Format:

```
## HH:MM | <branch>
<one-line progress summary with commit hashes if any>
```

## Anti-patterns

- ❌ Do NOT add preamble like "Let me check the status...". Go straight to `## Stand-up Scrum`.
- ❌ Do NOT include fake/aspirational entries in "next" — real, actionable items only.
- ❌ Do NOT skip the time-budget execution loop if user provided one.
