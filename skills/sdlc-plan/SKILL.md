---
name: sdlc-plan
description: Kick off Agile-Scrum SDLC planning for a new feature/change. Runs research + breakdown + risk evaluation as a Workflow, then halts at Gate A awaiting user approval of the plan. Use when the user provides a NEW requirement (not a resume).
argument-hint: <requirement text — the goal/spec for the feature>
allowed-tools: Bash, Read, Write, Edit, Workflow, AskUserQuestion, TaskCreate, TaskUpdate
---

# /sdlc-plan — Plan phase (SDLC Steps 1-2)

## Purpose

This skill runs the `sdlc-plan` Workflow to research the codebase, decompose the requirement into discrete tasks, evaluate risks, assign severity per a configurable matrix, and produce a **plan checkpoint**. Execution halts at **Gate A** — the main loop must show the plan to the user and request explicit approval before any execute step.

## Inputs

- **Required**: requirement text from `$ARGUMENTS` (or read from `Goal-prompt.md` / `.claude/goal.md` if argument is empty)
- **Optional**: project config from `.claude/sdlc.local.md` (YAML frontmatter). If absent, derive defaults from the working directory.

## What you (Claude) must do

### Step 1 — Resolve project config

Load project config in this priority order:

1. Project root `.claude/sdlc.local.md` (YAML frontmatter)
2. Existing project `CLAUDE.md` (extract severity matrix, tools list, taskBoard hints)
3. Inferred defaults (see "Default config" below)

**Detect codebase context** (cheap checks, parallel):
- `ls graphify-out/graph.json` → `codebase.graphifyAvailable = true`
- `ls package.json | head -1` + `ls *.csproj **/*.csproj **/*.sln 2>/dev/null` → `codebase.primaryLanguages`
- Check for ClickUp/Linear/Jira hints in CLAUDE.md → `taskBoard.type`

Build the `config` object using the schema in `references/project-config.md`.

### Step 2 — Resolve requirement

- If `$ARGUMENTS` is non-empty, use it as `requirement`.
- Else try `Goal-prompt.md` → `.claude/goal.md` → `goal.md` in project root.
- If still empty, stop and ask the user for the requirement via `AskUserQuestion`. Do not guess.

### Step 3 — Invoke the Workflow

Call the `Workflow` tool:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/sdlc-plan.js",
  args: { requirement, config }
})
```

Use the resolved `${CLAUDE_PLUGIN_ROOT}` path — never hardcode.

### Step 4 — Present plan + Gate A approval

When the workflow returns:

1. Save the plan object to `.claude/sdlc-plan.json` (overwrite if exists) so `/sdlc-execute` can pick it up.
2. Summarize for the user in this format:
   ```
   ## Plan
   - **Project**: <name>
   - **Tasks** (<n>): <list of T-id : title : severity>
   - **Waves** (<n>): show execution_order
   - **Risks** (<n>): high-level only
   - **Open questions** (<n>): from research phase
   ```
3. Ask Gate-A approval via `AskUserQuestion` with these axes (only include axes that are decisions to make):
   - Approve breakdown? (yes / adjust / restart)
   - Severity/agent assignments OK? (yes / adjust per task)
   - Open questions answered? (require user answers before execute)
   - Task-board entries: create now via MCP, or skip?

### Step 5 — Persist checkpoint

After user replies, save:
- Approved plan → `.claude/sdlc-plan.json`
- Gate-A decision log → append to `.claude/sdlc-log.md` with absolute date (convert relative dates).

Do NOT call `sdlc-execute` automatically — wait for the user to invoke it.

## Default config (when project has no sdlc.local.md)

```yaml
projectName: <basename of working directory>
codebase:
  graphifyAvailable: <auto-detected>
  primaryLanguages: <auto-detected>
tools: []
severityMatrix:
  urgent: { model: opus,   agentType: null,                 note: "Max-effort Opus" }
  high:   { model: opus,   agentType: "codex:codex-rescue", note: "Codex Senior-Dev when bounded" }
  normal: { model: sonnet, agentType: null }
  low:    { model: haiku,  agentType: null }
```

## Refs

- `references/severity-matrix.md` — full matrix with rationale
- `references/sub-agent-wrap.md` — prompt-wrap template
- `references/project-config.md` — `sdlc.local.md` schema

## Anti-patterns

- ❌ Do NOT invoke `sdlc-execute` automatically after planning — Gate A requires explicit user reply.
- ❌ Do NOT create task-board entries unless user explicitly approves in Gate A.
- ❌ Do NOT skip the research phase, even if you "already know the codebase".
- ❌ Do NOT use `Workflow({ name: "sdlc-plan" })` — must use `scriptPath` with `${CLAUDE_PLUGIN_ROOT}`.
