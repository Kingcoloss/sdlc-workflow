export const meta = {
  name: 'sdlc-review',
  description: 'Standalone multi-dimensional code review: code quality, architecture, integration, e2e, security. Fan-out parallel reviewers per dimension with adversarial verification of high-severity findings.',
  whenToUse: 'Invoke ad-hoc on any diff or set of changed files, independent of SDLC flow. Useful for PR review, pre-merge gate, or post-incident analysis.',
  phases: [
    { title: 'Review' },
    { title: 'Verify' },
  ],
}

// ─────────────────────────────────────────────────────────────
// SDLC-Review Workflow (standalone)
//
// args contract:
//   target: {                        REQUIRED
//     description: string,           // What the change is supposed to do
//     changed_files: string[],       // Concrete paths to review
//     diff?: string,                 // Optional inline diff
//     base_branch?: string,          // For comparison hint
//   }
//   config: {
//     dimensions?: string[],         // Default ['code','architecture','integration','e2e','security']
//     codebase?: { graphifyAvailable?: boolean, primaryLanguages?: string[] },
//     tools?: string[],
//     skipVerification?: boolean,    // Skip adversarial verify phase
//   }
// ─────────────────────────────────────────────────────────────

const DEFAULT_DIMENSIONS = ['code', 'architecture', 'integration', 'e2e', 'security']

const FINDING_SCHEMA = {
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

const DIMENSION_REVIEW_SCHEMA = {
  type: 'object',
  required: ['dimension', 'verdict', 'findings'],
  properties: {
    dimension:  { type: 'string' },
    verdict:    { enum: ['pass', 'pass-with-warnings', 'fail'] },
    summary:    { type: 'string' },
    findings:   { type: 'array', items: FINDING_SCHEMA },
  },
  additionalProperties: false,
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['finding_index', 'is_real', 'confidence'],
  properties: {
    finding_index: { type: 'integer' },
    is_real:       { type: 'boolean', description: 'True only if the finding describes an actual problem in the actual code' },
    confidence:    { enum: ['low', 'medium', 'high'] },
    reason:        { type: 'string' },
  },
}

const _args = typeof args === 'string' ? JSON.parse(args) : args
const target = _args && _args.target
const config = (_args && _args.config) || {}
if (!target || !target.description || !target.changed_files || target.changed_files.length === 0) {
  return { error: 'args.target.{description, changed_files} required' }
}

const dimensions = config.dimensions || DEFAULT_DIMENSIONS
const codebase = config.codebase || {}
const tools = config.tools || []

const reviewBase = [
  `INTENT: ${target.description}`,
  '',
  `CHANGED FILES (${target.changed_files.length}):`,
  ...target.changed_files.map(f => `  - ${f}`),
  target.base_branch ? `\nBase branch: ${target.base_branch}` : '',
  target.diff ? `\nDIFF (truncated to most relevant hunks):\n${target.diff.slice(0, 8000)}` : '',
  '',
  codebase.graphifyAvailable ? 'Use /graphify query for callers/dependents BEFORE reading file content.' : '',
  tools.length ? `Tools available: ${tools.join(', ')}` : '',
].filter(Boolean).join('\n')

// ─── PHASE 1: Per-dimension review (parallel) ───────────────
phase('Review')
const FOCUS = {
  code:         'quality, team standard, bug bounty. Surface real bugs and antipatterns ONLY.',
  architecture: 'maintainability, coupling, abstraction boundaries, future-proofing concerns.',
  integration:  'contract correctness across module boundaries, side-effects, error propagation, race conditions.',
  e2e:          'end-to-end flow correctness; identify scenarios not covered by tests.',
  security:     'OWASP top 10, secrets in code, injection, auth gaps, sensitive data handling.',
  performance:  'algorithmic complexity, hot paths, N+1 queries, memory leaks, blocking I/O.',
  accessibility:'WCAG compliance, keyboard nav, screen reader support, color contrast.',
}

const reviews = await parallel(dimensions.map(dim => () => agent([
  `Perform ${dim.toUpperCase()} review of the changes below.`,
  '',
  `FOCUS: ${FOCUS[dim] || 'apply standard review heuristics for this dimension.'}`,
  '',
  reviewBase,
  '',
  'Return JSON. Only flag REAL problems — no nitpicks unless severity=info.',
  'verdict=pass only if NO critical/high findings.',
].join('\n'), {
  schema: DIMENSION_REVIEW_SCHEMA,
  model: 'opus',
  label: `review:${dim}`,
  phase: 'Review',
})))

const validReviews = reviews.filter(Boolean)

// ─── PHASE 2: Adversarial verify (high/critical findings only) ──
phase('Verify')
let verifiedReviews = validReviews
if (!config.skipVerification) {
  verifiedReviews = await Promise.all(validReviews.map(async (review) => {
    const findingsToVerify = (review.findings || []).map((f, i) => ({ ...f, _idx: i }))
      .filter(f => f.severity === 'critical' || f.severity === 'high')

    if (findingsToVerify.length === 0) return review

    const verdicts = await parallel(findingsToVerify.map(f => () => agent([
      `Try to REFUTE the following ${review.dimension} finding. Default to is_real=false if uncertain.`,
      '',
      `Finding #${f._idx}: ${f.title}`,
      `Severity: ${f.severity}`,
      `File: ${f.file || '(unspecified)'}${f.line ? `:${f.line}` : ''}`,
      `Description: ${f.description}`,
      f.suggested_fix ? `Suggested fix: ${f.suggested_fix}` : '',
      '',
      'CONTEXT:',
      reviewBase,
      '',
      'Read the ACTUAL code at the cited path. If the description does not match the code, or if the code already handles the case, is_real=false.',
      'Be aggressive in refuting. The bar for is_real=true is HIGH.',
    ].filter(Boolean).join('\n'), {
      schema: VERDICT_SCHEMA,
      model: 'sonnet',
      label: `verify:${review.dimension}:f${f._idx}`,
      phase: 'Verify',
    })))

    const verdictByIdx = {}
    for (const v of verdicts.filter(Boolean)) {
      verdictByIdx[v.finding_index !== undefined ? v.finding_index : v._idx] = v
    }
    const updatedFindings = (review.findings || []).map((f, i) => {
      const v = verdictByIdx[i]
      if (!v) return f
      return { ...f, verified: v.is_real, verify_confidence: v.confidence, verify_reason: v.reason }
    })
    const confirmedHighCritical = updatedFindings.filter(f =>
      (f.severity === 'critical' || f.severity === 'high') && f.verified !== false
    )
    const newVerdict = confirmedHighCritical.length > 0 ? 'fail'
                     : updatedFindings.some(f => f.severity === 'medium') ? 'pass-with-warnings'
                     : 'pass'
    return { ...review, findings: updatedFindings, verdict: newVerdict, verified: true }
  }))
}

// ─── Aggregate ──────────────────────────────────────────────
const allFindings = verifiedReviews.flatMap(r => (r.findings || []).map(f => ({ ...f, dimension: r.dimension })))
const totals = {
  critical: allFindings.filter(f => f.severity === 'critical' && f.verified !== false).length,
  high:     allFindings.filter(f => f.severity === 'high'     && f.verified !== false).length,
  medium:   allFindings.filter(f => f.severity === 'medium').length,
  low:      allFindings.filter(f => f.severity === 'low').length,
  info:     allFindings.filter(f => f.severity === 'info').length,
}
const overallVerdict = totals.critical + totals.high > 0 ? 'fail'
                     : totals.medium > 0 ? 'pass-with-warnings'
                     : 'pass'

log(`Review complete: ${overallVerdict} — ${totals.critical} critical, ${totals.high} high, ${totals.medium} medium`)

return {
  schema_version: 1,
  workflow: 'sdlc-review',
  target_description: target.description,
  files_reviewed: target.changed_files.length,
  dimensions_reviewed: dimensions,
  overall_verdict: overallVerdict,
  totals,
  reviews: verifiedReviews,
  next_step: overallVerdict === 'fail'
    ? 'BLOCK: surface critical/high findings to user; require fixes before proceeding.'
    : overallVerdict === 'pass-with-warnings'
      ? 'PROCEED with caveats: medium findings are advisory, document and ship.'
      : 'PROCEED: no blocking findings.',
}
