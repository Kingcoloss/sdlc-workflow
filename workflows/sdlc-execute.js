export const meta = {
  name: 'sdlc-execute',
  description: 'Agile-Scrum SDLC Steps 4-7: parallel sub-agent fan-out per execution waves, optional graphify update, multi-dim review, UAT plan generation. Honors plan from sdlc-plan workflow.',
  whenToUse: 'Invoke ONLY after sdlc-plan has produced a plan and user has approved it (Gate A). Returns execution checkpoint for Gate-B Post-UAT-Approval.',
  phases: [
    { title: 'Develop' },
    { title: 'Graph Update' },
    { title: 'Review' },
    { title: 'UAT Plan' },
  ],
}

// ─────────────────────────────────────────────────────────────
// SDLC-Execute Workflow
//
// args contract:
//   plan: { ... }                    REQUIRED — output of sdlc-plan
//     tasks[].context_brief?: string // main-loop-authored, session-grounded brief;
//                                    // prepended (authoritative) to each sub-agent's prompt
//   config: { ... }                  REQUIRED — same shape as sdlc-plan; can extend with:
//     useWorktreeIsolation?: boolean // run parallel devs in separate git worktrees (safer, slower)
//     reviewDimensions?: string[]    // default ['code','architecture','integration','e2e','security']
//     skipGraphUpdate?: boolean
//     skipReview?: boolean
//     skipUatPlan?: boolean
// ─────────────────────────────────────────────────────────────

const DEFAULT_REVIEW_DIMENSIONS = ['code', 'architecture', 'integration', 'e2e', 'security']

const DEV_RESULT_SCHEMA = {
  type: 'object',
  required: ['task_id', 'status', 'summary'],
  properties: {
    task_id:         { type: 'string' },
    status:          { enum: ['done', 'partial', 'blocked', 'failed'] },
    summary:         { type: 'string' },
    files_changed:   { type: 'array', items: { type: 'string' } },
    tests_added:     { type: 'array', items: { type: 'string' } },
    tests_passed:    { type: 'boolean' },
    tests_run_cmd:   { type: 'string' },
    grey_zones:      { type: 'array', items: { type: 'string' }, description: 'Issues that need user input — task halted instead of guessing' },
    worktree_path:   { type: 'string', description: 'Set when worktree isolation enabled' },
    follow_up:       { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
}

const REVIEW_FINDING_SCHEMA = {
  type: 'object',
  required: ['severity', 'title', 'description'],
  properties: {
    severity:    { enum: ['critical', 'high', 'medium', 'low', 'info'] },
    title:       { type: 'string' },
    description: { type: 'string' },
    file:        { type: 'string' },
    line:        { type: 'integer' },
    suggested_fix: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['dimension', 'verdict', 'findings'],
  properties: {
    dimension:  { type: 'string' },
    verdict:    { enum: ['pass', 'pass-with-warnings', 'fail'] },
    summary:    { type: 'string' },
    findings:   { type: 'array', items: REVIEW_FINDING_SCHEMA },
  },
  additionalProperties: false,
}

const UAT_SCHEMA = {
  type: 'object',
  required: ['checklist'],
  properties: {
    checklist: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'scenario', 'steps', 'expected'],
        properties: {
          id:        { type: 'string' },
          scenario:  { type: 'string' },
          steps:     { type: 'array', items: { type: 'string' } },
          expected:  { type: 'string' },
          covered_by_tasks: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    setup_commands: { type: 'array', items: { type: 'string' } },
    teardown_commands: { type: 'array', items: { type: 'string' } },
  },
}

const plan = args && args.plan
const config = (args && args.config) || {}

if (!plan || !plan.tasks || !plan.execution_order) {
  return { error: 'args.plan is required (output of sdlc-plan workflow) — must contain tasks and execution_order' }
}

const useWorktree = !!config.useWorktreeIsolation
const reviewDims = config.reviewDimensions || DEFAULT_REVIEW_DIMENSIONS
const tools = config.tools || plan.tools_available || []
const codebase = config.codebase || {}

log(`SDLC-Execute starting: ${plan.tasks.length} tasks across ${plan.execution_order.length} waves; worktree=${useWorktree}`)

// ─── PHASE 1: Develop (wave-by-wave fan-out) ────────────────
phase('Develop')

const taskById = {}
for (const t of plan.tasks) taskById[t.id] = t

// Soft guard (non-breaking): high/urgent tasks fanned out on the mechanical wrap
// alone are scope-drift prone. The main loop should fill plan.tasks[].context_brief
// at Gate A. Warn, don't fail — plans predating context_brief still run.
const missingBrief = plan.tasks.filter(t => (t.severity === 'urgent' || t.severity === 'high') && !t.context_brief)
if (missingBrief.length) {
  log(`⚠ ${missingBrief.length} high/urgent task(s) missing context_brief: ${missingBrief.map(t => t.id).join(', ')} — running on mechanical wrap only (scope-drift risk). Main loop should fill plan.tasks[].context_brief before execute.`)
}

const devResults = []
for (let waveIdx = 0; waveIdx < plan.execution_order.length; waveIdx++) {
  const wave = plan.execution_order[waveIdx]
  log(`Wave ${waveIdx + 1}/${plan.execution_order.length}: ${wave.length} task(s) — ${wave.join(', ')}`)

  const waveResults = await parallel(wave.map(taskId => () => {
    const task = taskById[taskId]
    if (!task) return Promise.resolve({ task_id: taskId, status: 'failed', summary: 'task not found in plan.tasks' })

    const opts = {
      schema: DEV_RESULT_SCHEMA,
      label: `dev:${task.id}:${task.severity}`,
      phase: 'Develop',
    }
    if (task.assigned_agent && task.assigned_agent.agentType) {
      opts.agentType = task.assigned_agent.agentType
    } else {
      opts.model = (task.assigned_agent && task.assigned_agent.model) || 'sonnet'
    }
    if (useWorktree && wave.length > 1) opts.isolation = 'worktree'

    const devPrompt = [
      task.context_brief
        ? `MAIN-LOOP CONTEXT BRIEF (authoritative — read FIRST; this is session context you do NOT otherwise have):\n${task.context_brief}\n`
        : '',
      task.sub_agent_prompt_wrap || `GOAL: ${plan.requirement}\nSCOPE: ${task.title}`,
      '',
      'ADDITIONAL CONTEXT:',
      `- Tests should be added/updated alongside code changes.`,
      `- Run the project test suite; report tests_passed and tests_run_cmd.`,
      codebase.graphifyAvailable ? '- Use /graphify trace BEFORE Grep/Glob/Read.' : '',
      tools.includes('chrome-devtools') ? '- Use chrome-devtools for UI verification when relevant.' : '',
      tools.includes('mongo-mcp') ? '- Use mongo MCP to observe DB state when relevant.' : '',
      '',
      'Return JSON. status="blocked" if you hit a grey-zone — list it in grey_zones and stop.',
    ].filter(Boolean).join('\n')

    return agent(devPrompt, opts).then(r => r || { task_id: task.id, status: 'failed', summary: 'agent returned null' })
  }))

  devResults.push(...waveResults)

  // Halt downstream waves if any task in this wave is blocked/failed AND has dependents
  const blockedIds = waveResults
    .filter(r => r && (r.status === 'blocked' || r.status === 'failed'))
    .map(r => r.task_id)
  const remainingWaves = plan.execution_order.slice(waveIdx + 1).flat()
  const downstream = remainingWaves.filter(id => {
    const t = taskById[id]
    return t && t.dependencies && t.dependencies.some(d => blockedIds.includes(d))
  })
  if (blockedIds.length && downstream.length) {
    log(`Wave halted: ${blockedIds.join(', ')} blocked; downstream ${downstream.join(', ')} skipped`)
    for (const id of downstream) {
      devResults.push({ task_id: id, status: 'failed', summary: `skipped — upstream blocked: ${blockedIds.join(', ')}` })
    }
    break
  }
}

const devDone = devResults.filter(r => r.status === 'done').length
const devBlocked = devResults.filter(r => r.status === 'blocked' || r.status === 'failed').length
log(`Develop phase: ${devDone}/${devResults.length} done, ${devBlocked} blocked/failed`)

// ─── PHASE 2: Graph Update ──────────────────────────────────
phase('Graph Update')
let graphResult = null
if (!config.skipGraphUpdate && codebase.graphifyAvailable && devDone > 0) {
  graphResult = await agent([
    'Run `/graphify --update` to refresh the codebase knowledge graph incrementally.',
    `Files changed across develop phase:`,
    ...devResults.filter(r => r.files_changed).flatMap(r => r.files_changed).map(f => `  - ${f}`),
    '',
    'Use the matching Skill if available. Report: nodes/edges before/after, files re-extracted, any extraction errors.',
    'Per project policy, SEMANTIC extraction may need a separate Haiku-effort pass — note if needed and skipped due to missing API key.',
    'Return a short text summary (no schema).',
  ].join('\n'), {
    model: 'sonnet',
    label: 'graphify:update',
    phase: 'Graph Update',
  })
} else if (config.skipGraphUpdate) {
  log('Graph Update phase skipped (config.skipGraphUpdate)')
} else if (!codebase.graphifyAvailable) {
  log('Graph Update phase skipped (graphify not available for this project)')
} else {
  log('Graph Update phase skipped (no tasks produced changes)')
}

// ─── PHASE 3: Multi-Dimensional Review ──────────────────────
phase('Review')
let reviews = []
if (!config.skipReview && devDone > 0) {
  const changedFiles = Array.from(new Set(devResults.filter(r => r.files_changed).flatMap(r => r.files_changed)))
  const reviewBase = [
    `REQUIREMENT: ${plan.requirement}`,
    '',
    `CHANGED FILES (${changedFiles.length}):`,
    ...changedFiles.map(f => `  - ${f}`),
    '',
    'DEV SUMMARY:',
    JSON.stringify(devResults.map(r => ({ id: r.task_id, status: r.status, summary: r.summary }))),
    '',
    codebase.graphifyAvailable ? 'Use /graphify query for callers/dependents context BEFORE reading files.' : '',
  ].filter(Boolean).join('\n')

  reviews = await parallel(reviewDims.map(dim => () => agent([
    `Perform ${dim.toUpperCase()} review of the changes below.`,
    '',
    dim === 'code'         ? 'Focus: quality, team standard, bug bounty. Surface real bugs and antipatterns only.' :
    dim === 'architecture' ? 'Focus: maintainability, coupling, abstraction boundaries, future-proofing.' :
    dim === 'integration'  ? 'Focus: contract correctness across module boundaries, side-effects, error propagation.' :
    dim === 'e2e'          ? 'Focus: end-to-end flow correctness; identify scenarios not covered by tests.' :
    dim === 'security'     ? 'Focus: OWASP top 10, secrets, injection, auth gaps, sensitive data handling.' :
    'Focus per dimension definition.',
    '',
    reviewBase,
    '',
    'Return JSON. verdict=pass only if NO critical/high findings remain.',
  ].join('\n'), {
    schema: REVIEW_SCHEMA,
    model: 'opus',
    label: `review:${dim}`,
    phase: 'Review',
  })))
  reviews = reviews.filter(Boolean)
}

// ─── PHASE 4: UAT Plan ──────────────────────────────────────
phase('UAT Plan')
let uat = null
if (!config.skipUatPlan && devDone > 0) {
  uat = await agent([
    'Generate a User-Acceptance-Test checklist for the changes below.',
    '',
    `REQUIREMENT: ${plan.requirement}`,
    '',
    'TASKS (with test scenarios already specified):',
    JSON.stringify(plan.tasks.map(t => ({ id: t.id, title: t.title, test_scenarios: t.test_scenarios }))),
    '',
    'DEV RESULTS:',
    JSON.stringify(devResults.map(r => ({ id: r.task_id, status: r.status }))),
    '',
    'Produce checklist with:',
    '- id (UAT1, UAT2, ...)',
    '- scenario (1 sentence — describes user-visible behavior)',
    '- steps (concrete clicks/commands the user runs)',
    '- expected (verifiable observation)',
    '- covered_by_tasks (which T-ids contribute)',
    '',
    'Also list setup_commands (env, services, fixtures) and teardown_commands.',
    'Prefer scenarios that exercise multi-task seams over single-task happy paths.',
  ].join('\n'), {
    schema: UAT_SCHEMA,
    model: 'sonnet',
    label: 'uat:plan',
    phase: 'UAT Plan',
  })
}

// ─── Aggregate verdict ──────────────────────────────────────
const reviewFail = reviews.some(r => r.verdict === 'fail')
const anyCriticalFinding = reviews.some(r => (r.findings || []).some(f => f.severity === 'critical' || f.severity === 'high'))
const overallStatus = devBlocked > 0 ? 'blocked'
                    : reviewFail || anyCriticalFinding ? 'review-fail'
                    : 'ready-for-uat'

log(`Execute phase complete: status=${overallStatus}`)

return {
  schema_version: 1,
  workflow: 'sdlc-execute',
  project: plan.project,
  requirement: plan.requirement,
  overall_status: overallStatus,
  dev: {
    results: devResults,
    summary: { total: devResults.length, done: devDone, blocked: devBlocked },
  },
  graph_update: graphResult,
  reviews,
  uat,
  next_step: [
    overallStatus === 'blocked'
      ? 'BLOCKED: address grey_zones from blocked tasks. Re-run sdlc-plan with revised requirement or invoke sdlc-execute again after manual fixes.'
      : overallStatus === 'review-fail'
        ? 'REVIEW FAIL: surface review findings to user; iterate (re-invoke sdlc-execute on subset of tasks) or escalate.'
        : 'READY FOR UAT: run the UAT checklist manually, then on UAT pass invoke Gate-B Post-UAT-Approval (main loop asks user before commit/graphify/standup).',
  ].join('\n'),
}
