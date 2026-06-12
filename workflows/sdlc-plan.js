export const meta = {
  name: 'sdlc-plan',
  description: 'Agile-Scrum SDLC Steps 1-2: research codebase, breakdown requirement, evaluate risks, assign severity. Returns a plan checkpoint for Gate-A user approval.',
  whenToUse: 'Invoke when starting a new feature/change request, AFTER user provides a clear requirement. Output is a structured plan; main loop must ask for Gate-A approval before any execution.',
  phases: [
    { title: 'Research' },
    { title: 'Breakdown' },
    { title: 'Risk Eval' },
    { title: 'Task Spec' },
  ],
}

// ─────────────────────────────────────────────────────────────
// SDLC-Plan Workflow (generic — any software project)
//
// args contract:
//   requirement: string                    REQUIRED — the goal/spec text
//   config: {                              REQUIRED
//     projectName?: string,
//     projectRoot?: string,
//     codebase?: {
//       graphifyAvailable?: boolean,       // /graphify trace usable
//       hasTests?: boolean,                // test framework present
//       primaryLanguages?: string[],       // e.g., ['python', 'typescript']
//     },
//     tools?: string[],                    // e.g., ['graphify','chrome-devtools','mongo-mcp','notebooklm']
//     severityMatrix?: {                   // override default per severity
//       urgent?: { model: 'opus'|'sonnet'|'haiku', agentType?: string, note?: string },
//       high?:   { model: 'opus'|'sonnet'|'haiku', agentType?: string, note?: string },
//       normal?: { model: 'opus'|'sonnet'|'haiku', agentType?: string, note?: string },
//       low?:    { model: 'opus'|'sonnet'|'haiku', agentType?: string, note?: string },
//     },
//     sdlcReference?: string,              // optional inline guidance (e.g. project CLAUDE.md excerpt)
//   }
// ─────────────────────────────────────────────────────────────

const DEFAULT_SEVERITY_MATRIX = {
  urgent: { model: 'opus',   agentType: null,                 note: 'Max-effort Opus; architecture-critical, dependency-heavy, correctness gates' },
  high:   { model: 'opus',   agentType: 'codex:codex-rescue', note: 'Codex Senior-Dev high-effort preferred when bounded; Opus fallback when conflict-risky' },
  normal: { model: 'sonnet', agentType: null,                 note: 'Bounded coding, UI wiring, proxies, compatibility work' },
  low:    { model: 'haiku',  agentType: null,                 note: 'Research, summary, documentation-only clarification' },
}

const TASK_SCHEMA = {
  type: 'object',
  required: ['id', 'title', 'description', 'severity', 'parallelable', 'dependencies', 'test_scenarios', 'files_to_touch'],
  properties: {
    id:             { type: 'string',  description: 'Stable id like T1, T2; used by execute workflow' },
    title:          { type: 'string' },
    description:    { type: 'string' },
    severity:       { enum: ['urgent', 'high', 'normal', 'low'] },
    parallelable:   { type: 'boolean' },
    dependencies:   { type: 'array',   items: { type: 'string' }, description: 'List of task ids this depends on' },
    test_scenarios: { type: 'array',   items: { type: 'string' }, description: 'Given/When/Then style' },
    test_cases:     { type: 'array',   items: { type: 'string' } },
    files_to_touch: { type: 'array',   items: { type: 'string' } },
    out_of_scope:   { type: 'array',   items: { type: 'string' } },
  },
  additionalProperties: false,
}

const RESEARCH_SCHEMA = {
  type: 'object',
  required: ['summary', 'codebase_areas', 'open_questions', 'assumptions'],
  properties: {
    summary:         { type: 'string' },
    codebase_areas:  { type: 'array', items: { type: 'string' } },
    relevant_files:  { type: 'array', items: { type: 'string' } },
    open_questions:  { type: 'array', items: { type: 'string' }, description: 'Grey-zone questions to ask user before execute' },
    assumptions:     { type: 'array', items: { type: 'string' } },
    research_notes:  { type: 'string' },
  },
  additionalProperties: false,
}

const BREAKDOWN_SCHEMA = {
  type: 'object',
  required: ['tasks'],
  properties: {
    tasks: { type: 'array', items: TASK_SCHEMA, minItems: 1 },
    decomposition_rationale: { type: 'string' },
  },
  additionalProperties: false,
}

const RISK_SCHEMA = {
  type: 'object',
  required: ['tasks', 'risks', 'execution_order'],
  properties: {
    tasks: { type: 'array', items: TASK_SCHEMA },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'description', 'mitigation', 'affects_task_ids'],
        properties: {
          kind:             { enum: ['dependency', 'bottleneck', 'accuracy', 'architecture', 'unknown'] },
          description:      { type: 'string' },
          mitigation:       { type: 'string' },
          affects_task_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    execution_order: {
      type: 'array',
      items: { type: 'array', items: { type: 'string' } },
      description: 'Array of waves; each wave is an array of task ids that run in parallel; waves run sequentially',
    },
  },
  additionalProperties: false,
}

const requirement = (args && args.requirement) || ''
const config = (args && args.config) || {}
const matrix = { ...DEFAULT_SEVERITY_MATRIX, ...(config.severityMatrix || {}) }
const tools = config.tools || []
const codebase = config.codebase || {}
const projectName = config.projectName || 'unknown-project'

if (!requirement) {
  return { error: 'args.requirement is required (the goal/spec text)' }
}

log(`SDLC-Plan starting for ${projectName} — requirement: "${requirement.slice(0, 90)}${requirement.length > 90 ? '...' : ''}"`)

phase('Research')
const researchPrompt = [
  'Research the requirement and the codebase to inform downstream task breakdown.',
  '',
  `PROJECT: ${projectName}`,
  `LANGUAGES: ${(codebase.primaryLanguages || []).join(', ') || 'unknown'}`,
  `GRAPHIFY AVAILABLE: ${codebase.graphifyAvailable ? 'yes — use /graphify trace BEFORE Grep/Glob/Read' : 'no — fall back to Grep/Glob'}`,
  `TOOLS AVAILABLE: ${tools.join(', ') || 'standard'}`,
  '',
  'REQUIREMENT:',
  requirement,
  '',
  config.sdlcReference ? `PROJECT CONTEXT (excerpt):\n${config.sdlcReference}\n` : '',
  'Tasks:',
  '1. Identify codebase areas/subsystems likely affected.',
  '2. List concrete file paths that will probably be touched.',
  '3. Surface open questions (grey zones) that should be asked of user before execution.',
  '4. State assumptions you are making and flag those that need verification.',
  '',
  'Return JSON matching the schema. Be specific — vague summaries are not useful for downstream agents.',
].filter(Boolean).join('\n')

const research = await agent(researchPrompt, {
  schema: RESEARCH_SCHEMA,
  model: 'sonnet',
  label: 'research:codebase',
  phase: 'Research',
})

if (!research) {
  return { error: 'Research phase failed' }
}

phase('Breakdown')
const breakdownPrompt = [
  'Decompose the requirement into discrete, testable tasks.',
  '',
  `REQUIREMENT: ${requirement}`,
  '',
  'RESEARCH:',
  JSON.stringify(research),
  '',
  'For each task produce:',
  '- id: stable T1, T2, ... (used by execute workflow to spawn sub-agents)',
  '- title: imperative, < 80 chars',
  '- description: clear scope; what to do, what NOT to do',
  '- files_to_touch: concrete paths from research',
  '- out_of_scope: list of paths/areas the sub-agent MUST NOT touch',
  '- test_scenarios: Given/When/Then style, 1-4 per task',
  '- test_cases: concrete input → expected output, 1-3 per task',
  '- dependencies: ids of tasks that must finish first',
  '- parallelable: true if it can safely run alongside non-dependent tasks',
  '- severity: preliminary guess (urgent/high/normal/low) — risk phase will validate',
  '',
  'Prefer SMALL surgical tasks over large bundles. A task should touch at most ~3-5 files.',
  'Return JSON: { tasks: [...] }',
].join('\n')

const breakdown = await agent(breakdownPrompt, {
  schema: BREAKDOWN_SCHEMA,
  model: 'sonnet',
  label: 'breakdown:tasks',
  phase: 'Breakdown',
})

if (!breakdown || !breakdown.tasks || breakdown.tasks.length === 0) {
  return { error: 'Breakdown phase failed', research }
}

phase('Risk Eval')
const riskPrompt = [
  'Validate severity per Severity Decision Matrix and identify cross-task risks.',
  '',
  `REQUIREMENT: ${requirement}`,
  '',
  'TASKS (preliminary):',
  JSON.stringify(breakdown.tasks),
  '',
  'SEVERITY DECISION MATRIX:',
  '- urgent: architecture-critical, cross-handler data correctness, dependency-heavy, review/UAT gates → highest-effort Opus',
  '- high:   high blast radius or correctness-sensitive but bounded → Opus or Codex Senior-Dev (when bounded, non-conflicting)',
  '- normal: bounded coding, UI wiring, proxies, compatibility work → Sonnet',
  '- low:    research, summary, documentation-only clarification → Haiku',
  '',
  'For each task, finalize severity.',
  '',
  'Surface risks by kind:',
  '- dependency: task A depends on task B output; if B fails, A cannot proceed',
  '- bottleneck: single task gates many others; should it be split?',
  '- accuracy: cross-handler correctness, numerical precision, ordering',
  '- architecture: cross-cutting concern that may need redesign',
  '- unknown: grey zones with insufficient information',
  '',
  'Build execution_order: array of WAVES; each wave = array of task ids that can run in parallel; waves run sequentially.',
  'A task with dependencies on other tasks must appear in a LATER wave than its dependencies.',
  '',
  'Return JSON matching RISK_SCHEMA. Keep risk count tight — only flag real concerns.',
].join('\n')

const riskEval = await agent(riskPrompt, {
  schema: RISK_SCHEMA,
  model: 'opus',
  label: 'risk:eval',
  phase: 'Risk Eval',
})

if (!riskEval || !riskEval.tasks) {
  return { error: 'Risk-eval phase failed', research, breakdown }
}

phase('Task Spec')
const SUB_AGENT_PROMPT_WRAP = (task) => [
  `GOAL: ${requirement}`,
  `SCOPE: ${task.title} — ${task.description}`,
  `FILES IN SCOPE: ${task.files_to_touch.join(', ')}`,
  `OUT-OF-SCOPE: ${(task.out_of_scope || []).join(', ') || '(default: any file not listed in files_to_touch)'}`,
  `TOOLS: ${tools.join(', ') || 'standard'}`,
  `TEST SCENARIOS:`,
  ...task.test_scenarios.map(s => `  - ${s}`),
  task.test_cases && task.test_cases.length ? `TEST CASES:\n${task.test_cases.map(c => `  - ${c}`).join('\n')}` : '',
  '',
  'REJECT self-extending: do NOT expand scope. If you hit a grey-zone, STOP and report back instead of guessing.',
  'Use graphify trace (if available) BEFORE Grep/Glob/Read.',
].filter(Boolean).join('\n')

const taskSpecs = riskEval.tasks.map(t => {
  const assigned = matrix[t.severity] || matrix.normal
  return {
    ...t,
    assigned_agent: {
      model: assigned.model,
      agentType: assigned.agentType || null,
      note: assigned.note || null,
    },
    // Layer 1 (mechanical): scope/files/tests, generated from task fields here.
    sub_agent_prompt_wrap: SUB_AGENT_PROMPT_WRAP(t),
    // Layer 2 (judgement): session-grounded brief the MAIN LOOP authors at Gate A
    // before execute — resolved grey-zones, invariants not to break, cross-task
    // seams. Left null here: a workflow sub-agent lacks the main-loop's context.
    context_brief: null,
  }
})

log(`Plan complete: ${taskSpecs.length} tasks, ${riskEval.execution_order.length} waves, ${riskEval.risks.length} risks identified`)

return {
  schema_version: 1,
  workflow: 'sdlc-plan',
  project: projectName,
  requirement,
  research,
  tasks: taskSpecs,
  risks: riskEval.risks,
  execution_order: riskEval.execution_order,
  severity_matrix_resolved: matrix,
  tools_available: tools,
  next_step: [
    'GATE A (main-loop responsibility):',
    '1. Present this plan to user.',
    '2. Ask: approve breakdown? confirm severity/agent assignments? answer open_questions?',
    '3. Author a per-task `context_brief` (see CONTEXT BRIEF below) before any fan-out.',
    '4. On approval, optionally create task-board entries (ClickUp/Linear/Jira/etc.) using config.taskBoard.',
    '5. Invoke sdlc-execute workflow with args: { plan: <this object>, config: <same config> }.',
    '',
    'CONTEXT BRIEF (step 3) — for each task that will be fanned out, fill task.context_brief',
    'with a tight, session-grounded summary the cold sub-agent CANNOT re-derive on its own:',
    '  - resolved grey-zones / decisions made this session,',
    '  - invariants it must NOT break (name them, e.g. "existing X contract stays green"),',
    '  - cross-task seams it touches and who owns the other side,',
    '  - related-project / graph insights relevant to its files.',
    'The mechanical sub_agent_prompt_wrap already covers scope/files/tests; context_brief carries',
    'the JUDGEMENT only the main loop holds. Leave it null only for trivial, self-contained tasks.',
  ].join('\n'),
}
