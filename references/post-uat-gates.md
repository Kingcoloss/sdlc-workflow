# Post-UAT-Approval Gate (Gate B)

Encodes the project CLAUDE.md "Post-UAT-Approval gate" — actions that must NOT happen automatically until the user replies via an interactive interview.

## Gated actions

| Action | Default | Notes |
|--------|---------|-------|
| `graphify update .` | OFF | Only if project has `graphify-out/`. Use Sonnet (High effort) for AST; Haiku (High effort) for semantic (if API key present). |
| `git commit` | OFF | Must NOT include `Goal-prompt.md` / `.claude/goal.md` automatically. Pre-commit hooks must pass — fix root cause, do NOT use `--no-verify`. |
| Task-board status update | OFF | Move from "in review" → "done" only after explicit approval. |
| Stand-up scrum | OFF | Run `/sdlc-standup` only when user opts in. |
| Propose next solution | OFF | Suggest follow-ups only when user opts in. |

## Why each is gated

- **graphify update**: writes large JSON artifacts; can mask incremental drift.
- **git commit**: irreversible (locally); user may want to amend / rebase first.
- **task-board update**: visible to other team members; premature "done" is hard to reverse.
- **stand-up / next-solution**: chat noise; the user may already have a parallel context.

## Recommended interview shape

Use `AskUserQuestion` with `multiSelect: true`:

```
Question: "Gate B (Post-UAT-Approval) — approve any of these?"
Options:
  - "graphify update" (description: "refresh graph after this batch")
  - "git commit"      (description: "code + tests only, NOT Goal-prompt.md")
  - "task-board → done" (description: "mark <list of T-ids> done")
  - "stand-up scrum"   (description: "summary of this session's progress")
  - "propose next"     (description: "suggest follow-up work")
```

A skipped item should be skipped silently — no warning, no re-prompt.

## Audit

After Gate B completes, append a one-line entry to `.claude/sdlc-log.md`:

```
2026-MM-DD HH:MM | GATE-B | <feature title> | approved=[graphify,commit,...] declined=[...]
```

## Edge cases

- **User says "approve all but commit"**: execute the approved subset; do NOT push for re-confirmation on the declined item.
- **graphify update fails mid-run**: the commit (if approved) has already landed. Log the graphify failure separately; do not roll back the commit.
- **Pre-commit hook fails on commit step**: STOP, fix the root cause (read the hook output), and create a NEW commit. Never `--amend` or `--no-verify`.
