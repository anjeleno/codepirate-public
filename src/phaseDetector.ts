import type { ThinkingBudget } from './types'

// ─── Phase type ───────────────────────────────────────────────────────────────
// Canonical definition — import from here, do not redefine elsewhere.

export type Phase =
  | 'build'
  | 'blueprint'
  | 'brainstorm'
  | 'debug'
  | 'architecture'
  | 'security'
  | 'default'

// ─── Phase detection ──────────────────────────────────────────────────────────
// Regex patterns ported verbatim from docs/Harness.py. First match wins.
// Keep specific patterns before broad ones to avoid false positives.

const PHASE_PATTERNS: Array<[Phase, RegExp]> = [
  // Build triggers — Phase 3
  [
    'build',
    /\b(build it|start (the )?build|begin build(ing)?|go ahead (and )?build|phase 3|implement it|ship it)\b/i,
  ],
  // Blueprint triggers — Phase 2
  [
    'blueprint',
    /\b(blueprint|spec it|write (the )?spec|phase 2|design (it|the system|the app)|lay (it |this )?out)\b/i,
  ],
  // Brainstorm triggers — Phase 1
  [
    'brainstorm',
    /\b(brainstorm|think (this )?through|let'?s think|phase 1|i have an idea|i want to build)\b/i,
  ],
  // Debugging
  [
    'debug',
    /\b(debug|fix (this|it)|broken|not working|error|crash|failing|bug|exception|traceback)\b/i,
  ],
  // Architecture
  [
    'architecture',
    /\b(architect|system design|how (would you|should i) design|design a system|plan the (system|architecture))\b/i,
  ],
  // Security review
  [
    'security',
    /\b(audit|security review|check (for )?vulnerabilities|security check|pentest|owasp)\b/i,
  ],
]

export function detectPhase(message: string): Phase {
  for (const [phase, pattern] of PHASE_PATTERNS) {
    if (pattern.test(message)) return phase
  }
  return 'default'
}

// ─── Phase → ThinkingBudget ───────────────────────────────────────────────────
// Bridges phase detection to the existing thinking machinery in router.ts.
// Claude and OpenRouter+Claude models use the API `thinking` parameter;
// DeepSeek uses natural language directives in the system prompt (see personas.ts).

export function phaseToThinkingBudget(phase: Phase): ThinkingBudget {
  switch (phase) {
    case 'build':        return 'off'   // Non-think: execution mode, no reasoning overhead
    case 'blueprint':    return 'max'   // Think Max: blueprint is the contract
    case 'brainstorm':   return 'high'  // Think High: surface tradeoffs carefully
    case 'debug':        return 'high'  // Think High: escalates to max per CORE rules for hard bugs
    case 'architecture': return 'max'   // Think Max: errors here compound into every layer
    case 'security':     return 'max'   // Think Max: security analysis warrants full reasoning
    case 'default':      return 'high'  // Think High: safe default for unclassified messages
  }
}

// ─── Phase → max tokens ───────────────────────────────────────────────────────
// Build and Architecture phases may produce dozens of files — they need the
// larger token budget. All other phases use the standard 8192 default.
// The codePirate.maxTokens user setting acts as a cap over this value.
// Non-CORE personas never call this function.

export function phaseToMaxTokens(phase: Phase): number {
  switch (phase) {
    case 'build':        return 32768
    case 'architecture': return 32768
    default:             return 8192
  }
}
