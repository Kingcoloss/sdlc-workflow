export const meta = {
  name: 'sdlc-triage',
  description: 'Verify out-of-plan findings adversarially vs HEAD, evaluate plan/milestone impact for fold-candidates, classify each into a lane (inline-fix/fold/ticket/reject).',
  whenToUse: 'Invoked by /sdlc-triage after a walkthrough/UAT surfaces findings outside the current plan. Input: pre-split findings[] + optional active plan.',
  phases: [
    { title: 'Verify' },
    { title: 'Plan Impact' },
  ],
}

// ─────────────────────────────────────────────────────────────
// SDLC-Triage Workflow — lateral finding intake
//
// args contract:
//   findings: [{ id, text, source?, board_task_id? }]   REQUIRED — pre-split by skill
//   plan: <sdlc-plan.json object> | null                 active plan, or null if none
//   config: {
//     codebase?: { graphifyAvailable?, primaryLanguages? },
//     tools?: string[],
//     skipVerification?: boolean,    // trust findings as real (skip adversarial pass)
//   }
//
// Lane classification is DETERMINISTIC (plain JS, no agent) — see classifyLane().
// Agents per finding: Verify (always, unless skipped) + Plan-Impact (fold-candidates only).
// ─────────────────────────────────────────────────────────────

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['is_real', 'confidence', 'severity', 'in_scope'],
  properties: {
    is_real:    { type: 'boolean', description: 'True only if the finding describes an ACTUAL problem in the actual code at HEAD' },
    confidence: { enum: ['low', 'medium', 'high'] },
    severity:   { enum: ['critical', 'high', 'medium', 'low'] },
    in_scope:   { type: 'boolean', description: 'True if it belongs to the active plan\'s requirement/files; false if it is a separate/new concern' },
    evidence:   { type: 'string', description: 'file:line + what was checked; cite test/commit if relevant' },
    reason:     { type: 'string' },
  },
  additionalProperties: false,
}

const IMPACT_SCHEMA = {
  type: 'object',
  required: ['recommended_lane', 'pros', 'cons', 'milestone_effect'],
  properties: {
    recommended_lane: { enum: ['fold', 'defer'], description: 'fold = inject into active sprint now; defer = new ticket for later' },
    pros:             { type: 'array', items: { type: 'string' }, description: 'Pros of folding NOW into the active sprint' },
    cons:             { type: 'array', items: { type: 'string' }, description: 'Cons/risks of folding now' },
    milestone_effect: { type: 'string', description: 'e.g. "none", "+1 wave", "slips wave 3"' },
    conflicts:        { type: 'array', items: { type: 'string' }, description: 'In-flight tasks/files this collides with' },
    blast_radius:     { type: 'string', description: 'Callers/dependents affected (from graphify if available)' },
  },
  additionalProperties: false,
}

const _args = typeof args === 'string' ? JSON.parse(args) : args
const findings = (_args && _args.findings) || []
const plan = (_args && _args.plan) || null
const config = (_args && _args.config) || {}

if (!findings.length) {
  return { error: 'args.findings is required (non-empty; pre-split by the skill)' }
}

const codebase = config.codebase || {}
const tools = config.tools || []
const hasPlan = !!(plan && plan.tasks && plan.tasks.length)
const graphHint = codebase.graphifyAvailable
  ? 'Use /graphify query for callers/dependents BEFORE reading file content.'
  : ''

// Compact plan view (avoid dumping the whole plan into prompts — token-lean)
const planView = hasPlan ? {
  requirement: plan.requirement,
  milestone_waves: (plan.execution_order || []).length,
  tasks: plan.tasks.map(t => ({ id: t.id, title: t.title, severity: t.severity, files: t.files_to_touch || [] })),
  execution_order: plan.execution_order || [],
} : null

log(`SDLC-Triage: ${findings.length} finding(s); active plan=${hasPlan ? plan.requirement?.slice(0, 60) : 'none'}`)

// ─── Deterministic lane mapping (no agent) ──────────────────
function classifyLane(verdict, impact) {
  if (!verdict) return 'unverified'                       // verify errored/skipped → surface, do NOT silently reject
  if (!verdict.is_real) return 'reject'                   // refuted: not a real problem
  if (!verdict.in_scope) return 'ticket'                  // separate/new concern → backlog
  if (verdict.severity === 'low') return 'inline'         // trivial in-scope → inline-fix
  if (!hasPlan) return 'ticket'                           // no active sprint to fold into
  if (impact && impact.recommended_lane === 'defer') return 'ticket'
  return 'fold'                                           // bounded in-scope defect → fold into sprint
}

function laneRationale(verdict, impact, lane) {
  if (lane === 'unverified') return 'adversarial verify did not return a verdict (error/skip) — needs manual decision'
  if (lane === 'reject') return verdict ? (verdict.reason || 'refuted by adversarial verify') : 'no verdict'
  if (lane === 'inline') return 'real, in-scope, trivial (low severity) → fix inline'
  if (lane === 'ticket' && verdict && !verdict.in_scope) return 'real but out-of-scope of the active plan → backlog ticket'
  if (lane === 'ticket' && !hasPlan) return 'real in-scope defect but no active plan to fold into → ticket'
  if (lane === 'ticket') return impact ? `defer recommended — ${(impact.cons || []).join('; ')}` : 'defer to ticket'
  return impact ? `fold recommended — ${(impact.pros || []).join('; ')}` : 'fold into active sprint'
}

// ─── Pipeline: each finding flows Verify → Plan-Impact independently ──
const results = await pipeline(
  findings,

  // Stage 1 — adversarial verify vs HEAD
  (f) => {
    if (config.skipVerification) {
      return Promise.resolve({ is_real: true, confidence: 'low', severity: 'medium', in_scope: hasPlan, evidence: '(verification skipped)', reason: 'skipVerification=true' })
    }
    return agent([
      'Try to REFUTE the following finding. Default to is_real=false if uncertain — the bar for is_real=true is HIGH.',
      '',
      `FINDING: ${f.text}`,
      f.area_hint ? `AREA HINT: ${f.area_hint}` : '',
      '',
      'Read the ACTUAL code at HEAD. If the code already handles the case, or the description does not match reality, is_real=false.',
      hasPlan ? `Judge in_scope against the active plan requirement: "${planView.requirement}". in_scope=true if this finding concerns that requirement or its files; false if it is a separate concern.` : 'No active plan — set in_scope=false unless the finding clearly concerns the current working change.',
      graphHint,
      '',
      'Return JSON. Cite file:line in evidence.',
    ].filter(Boolean).join('\n'), {
      schema: VERDICT_SCHEMA,
      model: 'sonnet',
      label: `verify:${f.id}`,
      phase: 'Verify',
    })
  },

  // Stage 2 — plan-impact eval (ONLY for real, in-scope, non-trivial, fold-candidate findings)
  (verdict, f) => {
    const foldCandidate = verdict && verdict.is_real && verdict.in_scope && verdict.severity !== 'low' && hasPlan
    if (!foldCandidate) return { verdict, impact: null }
    return agent([
      'Evaluate the impact of folding this finding into the ACTIVE sprint vs deferring it to a new ticket.',
      '',
      `FINDING: ${f.text}`,
      `VERIFIED: severity=${verdict.severity}; ${verdict.evidence || ''}`,
      '',
      'ACTIVE PLAN (compact):',
      JSON.stringify(planView),
      '',
      'Assess against the plan: Scope (new task/wave or grows existing?), Milestone (does wave-count/target slip?), Dependency (conflicts/blocks an in-flight wave?), File-overlap (touches files an active task already touches → coupling/merge risk), Foundation-risk (is in-flight work built on the thing this says is wrong → fix before it compounds?).',
      graphHint ? `${graphHint} Use get_impact_radius for blast_radius.` : '',
      '',
      'Recommend fold (inject now) or defer (new ticket), with explicit pros/cons and milestone_effect. Return JSON.',
    ].filter(Boolean).join('\n'), {
      schema: IMPACT_SCHEMA,
      model: 'sonnet',
      label: `impact:${f.id}`,
      phase: 'Plan Impact',
    }).then(impact => ({ verdict, impact }))
  },
)

// ─── Assemble + deterministic classification ────────────────
const triaged = results.map((r, i) => {
  const f = findings[i]
  const verdict = r && r.verdict !== undefined ? r.verdict : r   // stage2 passthrough vs object
  const impact = r && r.impact !== undefined ? r.impact : null
  const lane = classifyLane(verdict, impact)
  return {
    id: f.id,
    text: f.text,
    source: f.source || 'args',
    board_task_id: f.board_task_id || null,
    verdict: verdict || null,
    impact: impact || null,
    lane,
    rationale: laneRationale(verdict, impact, lane),
  }
})

const byLane = { inline: 0, fold: 0, ticket: 0, reject: 0, unverified: 0 }
for (const t of triaged) byLane[t.lane] = (byLane[t.lane] || 0) + 1
const realCount = triaged.filter(t => t.verdict && t.verdict.is_real).length

log(`Triage complete: ${triaged.length} finding(s) — ${realCount} real; lanes inline=${byLane.inline} fold=${byLane.fold} ticket=${byLane.ticket} reject=${byLane.reject} unverified=${byLane.unverified}`)

return {
  schema_version: 1,
  workflow: 'sdlc-triage',
  has_active_plan: hasPlan,
  active_requirement: hasPlan ? plan.requirement : null,
  findings: triaged,
  summary: { total: triaged.length, real: realCount, by_lane: byLane },
  next_step: [
    'GATE T (main-loop responsibility):',
    '1. Present the per-finding triage table (verdict · lane · pros/cons · evidence).',
    '2. AskUserQuestion: confirm the lane per finding (accept all recommendations, or override).',
    '3. Act per approved lane: inline→edit+reverify; fold→append fix-task to sdlc-plan.json (+board); ticket→create board task; reject→log rationale (+remove triage-inbox tag).',
    byLane.unverified ? `NOTE: ${byLane.unverified} finding(s) UNVERIFIED (verify errored/skipped) — surface for manual decision, do NOT silently drop.` : '',
    hasPlan ? '' : 'NOTE: no active plan — fold lane is unavailable; fold-candidates were downgraded to ticket.',
  ].filter(Boolean).join('\n'),
}
