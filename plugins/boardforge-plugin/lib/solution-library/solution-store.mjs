import { normalizeSolutionRecord, validateSolutionRecord } from './solution-schema.mjs'

export function recordSolution(store = [], record = {}) {
  const normalized = normalizeSolutionRecord(record)
  const validation = validateSolutionRecord(normalized)
  if (!validation.valid) {
    throw new Error(`Invalid solution record ${normalized.id || '<missing id>'}: ${validation.missing.join(', ')}`)
  }
  const existingIndex = store.findIndex((item) => item.id === normalized.id)
  if (existingIndex >= 0) {
    const merged = { ...store[existingIndex], ...normalized, createdAt: store[existingIndex].createdAt, updatedAt: new Date().toISOString() }
    return [...store.slice(0, existingIndex), merged, ...store.slice(existingIndex + 1)]
  }
  return [...store, normalized]
}

export function recordFailurePattern(store = [], pattern = {}) {
  return recordSolution(store, {
    sourceBoard: pattern.sourceBoard || 'unknown',
    boardType: pattern.boardType || 'unknown',
    problemType: pattern.problemType || 'routing',
    problemSignature: pattern.problemSignature || { errorCode: pattern.errorCode || 'UNKNOWN_FAILURE' },
    rootCause: pattern.rootCause || 'Failure pattern recorded for future diagnosis.',
    fixSummary: pattern.fixSummary || 'Search matching recipes before retrying this failure.',
    recipe: pattern.recipe || ['Classify failure', 'Search solution library', 'Apply matching guarded repair'],
    status: pattern.status || 'experimental',
    confidence: pattern.confidence || 'low',
    ...pattern,
  })
}

export function recordRepairRecipe(store = [], recipe = {}) {
  return recordSolution(store, { problemType: 'repair', ...recipe })
}
