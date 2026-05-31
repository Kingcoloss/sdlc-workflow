---
name: sdlc-init
description: Initialize the sdlc-workflow plugin for a fresh project — auto-detect codebase context (languages, test command, graphify availability), interactively interview the user for taskBoard/tools/severity overrides, write .claude/sdlc.local.md, and update .gitignore. Use as the FIRST step in any new project that has not been configured yet.
argument-hint: [optional: --force to overwrite existing sdlc.local.md]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# /sdlc-init — Configure sdlc-workflow for a new project

## Purpose

Set up `.claude/sdlc.local.md` for the current working directory, so `/sdlc-plan` / `/sdlc-execute` / `/sdlc-review` can run without per-call configuration. Idempotent — running again is safe (will detect existing config and ask before overwriting).

## What you (Claude) must do

### Step 1 — Detect existing config

Read `.claude/sdlc.local.md`. Branch:

- **File absent** → continue to Step 2.
- **File exists** AND `$ARGUMENTS` contains `--force` → skip the prompt; back up the existing file to `.claude/sdlc.local.md.bak-<UTC-timestamp>` and continue.
- **File exists** AND no `--force` → ask via `AskUserQuestion` (header "Existing config"):
  - Overwrite (Recommended) — back up + replace
  - Merge — keep current values; only fill missing fields
  - Abort — stop the skill
  Act on the choice; on Abort, return a one-line message and exit.

### Step 2 — Auto-detect codebase context (parallel)

Run these in ONE message of parallel Bash calls (cheap, read-only):

```bash
# Working directory + project name
pwd && basename "$(pwd)"

# Language fingerprints — note presence, do not parse contents yet
ls package.json 2>/dev/null
ls -1 *.csproj **/*.csproj 2>/dev/null | head -3
ls -1 *.sln **/*.sln 2>/dev/null | head -3
ls pyproject.toml setup.py requirements.txt 2>/dev/null
ls Cargo.toml 2>/dev/null
ls go.mod 2>/dev/null
ls pom.xml build.gradle build.gradle.kts 2>/dev/null
ls Gemfile 2>/dev/null
ls composer.json 2>/dev/null

# Test framework hints
ls pytest.ini tox.ini conftest.py 2>/dev/null
[ -f package.json ] && jq -er '.scripts.test // empty' package.json 2>/dev/null
ls vitest.config.* jest.config.* karma.conf.* playwright.config.* 2>/dev/null
ls phpunit.xml 2>/dev/null

# graphify
ls graphify-out/graph.json 2>/dev/null

# Project CLAUDE.md / AGENTS.md (for sdlcReference extraction)
ls CLAUDE.md AGENTS.md GEMINI.md 2>/dev/null

# Existing .gitignore
[ -f .gitignore ] && grep -c 'sdlc.local\|\.claude/\*\.local' .gitignore || echo "no-gitignore"

# Task-board hints in project CLAUDE.md
[ -f CLAUDE.md ] && grep -inE 'clickup|linear|jira|notion|github.?issues' CLAUDE.md | head -10
```

Build the detection map:

```
projectName        = basename
primaryLanguages   = [<derived from fingerprints>]
graphifyAvailable  = boolean
hasTests           = boolean (any test config file found)
testCommandGuess   = derived (see "Test command derivation" below)
sdlcReferenceFile  = first match of CLAUDE.md / AGENTS.md / GEMINI.md, if any
taskBoardHint      = inferred type from CLAUDE.md grep, if unambiguous
```

### Test command derivation

| Detected | Guess |
|----------|-------|
| `package.json` with `scripts.test` | `npm test` |
| `*.sln` | `dotnet test <first .sln>` |
| `pyproject.toml` OR `pytest.ini` OR `conftest.py` | `pytest -q` |
| `Cargo.toml` | `cargo test` |
| `go.mod` | `go test ./...` |
| `pom.xml` | `mvn test` |
| `build.gradle*` | `./gradlew test` |
| `Gemfile` | `bundle exec rspec` |
| `composer.json` | `composer test` |
| Multiple stacks (e.g. .NET + Vue) | join with ` && ` |
| None | empty string |

### Step 3 — Interactive interview (one batched message)

Use `AskUserQuestion` with up to 4 questions in ONE call. Pre-fill defaults from detection:

1. **Task board** (header "Task board"):
   - ClickUp (description: "needs listId")
   - Linear (description: "needs team key")
   - Jira (description: "needs project key")
   - GitHub Issues (description: "needs repo")
   - None (description: "skip board integration")

2. **Tools available** (header "Tools", multiSelect=true), pre-checked based on detection + standard list:
   - graphify (description: "code knowledge graph; auto-detected if `graphify-out/graph.json` present")
   - chrome-devtools (description: "browser UAT via MCP")
   - mongo-mcp (description: "DB observation via MCP")
   - notebooklm (description: "domain research")
   - context7 (description: "library docs lookup")
   - playwright (description: "E2E browser tests")

3. **Severity matrix** (header "Severity"):
   - Use defaults (Recommended) — opus / opus+codex / sonnet / haiku
   - Customize per severity — ask follow-up below
   - All-opus (override) — every task uses opus regardless of severity

4. **sdlcReference content** (header "Project context"):
   - Extract from CLAUDE.md (Recommended if exists) — embed up to 1.5KB of domain rules
   - Skip — no project-specific context passed to research phase
   - Custom — user will write it later

After the user replies:

- If task board ≠ "None", ask a follow-up `AskUserQuestion` for the specific listId/team key/project key value (free-text via the "Other" affordance).
- If severity = "Customize", ask a multi-question block for each severity row (model + agentType).
- If sdlcReference = "Extract from CLAUDE.md", read CLAUDE.md and take a relevant excerpt (~1.5KB cap; prefer Domain Rules / Severity / Tools / SDLC sections).

### Step 4 — Build YAML and write the file

Compose the YAML frontmatter shape defined in `references/project-config.md` (`projectName`, `codebase`, `tools`, `taskBoard`, `severityMatrix`, `reviewDimensions`, `execute`, `sdlcReference`). Add a footer comment block with the absolute date the file was generated and a short pointer to the skill that produced it.

Write to `.claude/sdlc.local.md`. If the directory does not exist, create it with `mkdir -p .claude`.

### Step 5 — Update .gitignore

Read `.gitignore`. If absent, create it with this content:

```
.claude/*.local.md
```

If present but does not match `.claude/*.local.md` (search literally), append a section:

```

# sdlc-workflow plugin local config
.claude/*.local.md
```

Do NOT touch existing entries. Never `git add` automatically.

### Step 6 — Summarize and suggest next step

Emit a SHORT summary to the user, using this format:

```
## sdlc-init complete

- **Project**: <name>
- **Languages**: <list>
- **Test command**: `<cmd>` (verify and edit if wrong)
- **Graphify**: <available | not detected>
- **Task board**: <type + id, or "none">
- **Tools**: <comma list>
- **Severity matrix**: <defaults | custom | all-opus>
- **sdlcReference**: <embedded N bytes | empty>

Config saved to `.claude/sdlc.local.md`. `.gitignore` updated.

Next: run `/sdlc-workflow:sdlc-plan <your requirement>` to start the SDLC flow.
```

## Anti-patterns

- ❌ Do NOT overwrite an existing `.claude/sdlc.local.md` without explicit user choice.
- ❌ Do NOT auto-`git add` the new files — let the user decide.
- ❌ Do NOT guess at taskBoard IDs — the listId/team key must come from the user (or unambiguous grep hit they confirm).
- ❌ Do NOT embed more than ~1.5KB of `sdlcReference` content — large excerpts blow the research-phase token budget.
- ❌ Do NOT run any sub-agent or workflow from this skill — init is purely setup/IO.

## Refs

- `references/project-config.md` — full schema for the file being generated
- `references/severity-matrix.md` — what the matrix means
