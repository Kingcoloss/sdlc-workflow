---
name: sdlc-review
description: Run standalone multi-dimensional code review on a diff or set of changed files — code quality, architecture, integration, e2e, security. Adversarially verifies high/critical findings. Independent of SDLC flow; useful for PR review or pre-merge gate.
argument-hint: [optional: file paths / diff range / PR number]
allowed-tools: Bash, Read, Workflow, AskUserQuestion
---

# /sdlc-review — Standalone multi-dim code review

## Purpose

Invoke the `sdlc-review` Workflow against any change set — not tied to an SDLC plan. Outputs a verdict (pass / pass-with-warnings / fail) plus a structured finding list with adversarial verification of critical/high items.

## What you (Claude) must do

### Step 1 — Resolve the target

Determine `changed_files` and `description` from `$ARGUMENTS`:

| Argument shape | Action |
|----------------|--------|
| empty | `git diff --name-only main...HEAD` (or current branch vs `develop`); description from latest commit message |
| `PR #<n>` or PR URL | `gh pr view <n> --json files,title,body` |
| explicit paths | use as-is; description = "ad-hoc review" unless user specifies |
| diff range `<a>..<b>` | `git diff --name-only <a>..<b>` |

Read up to ~8KB of `git diff` and pass as `target.diff` to give reviewers concrete hunks.

### Step 2 — Resolve config

Reuse `references/project-config.md` schema. Defaults are safe if no `.claude/sdlc.local.md`.

### Step 3 — Invoke the Workflow

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/sdlc-review.js",
  args: {
    target: { description, changed_files, diff, base_branch },
    config: { dimensions, codebase, tools, skipVerification }
  }
})
```

### Step 4 — Surface findings

Render results to user as scannable tables:

```
## Review verdict: <pass|pass-with-warnings|fail>

| Dim | Verdict | Findings (C/H/M/L) |
|-----|---------|---------------------|
| code | pass | 0/0/2/1 |
| security | fail | 1/2/0/0 |
...

### Critical/High findings (verified)
1. **<title>** (security, <file>:<line>) — <description>
   Fix: <suggested_fix>
...
```

Only list findings where `verified !== false`. List "refuted by verifier" count separately to keep noise low.

### Step 5 — Offer follow-up actions

If `overall_verdict === 'fail'`:
- Offer to invoke `sdlc-execute` with a subset of `findings` as a new plan, OR
- Offer to apply specific `suggested_fix` items directly via `Edit`.

Do not auto-apply fixes — user must approve each.

## Anti-patterns

- ❌ Do NOT skip adversarial verification unless user explicitly passes `skipVerification: true` (e.g. for a quick first-pass scan).
- ❌ Do NOT report nitpicks as `info` and bury real findings — `info` is for advisory notes the user can ignore.
- ❌ Do NOT include refuted findings in the "Critical/High findings" list shown to the user.
