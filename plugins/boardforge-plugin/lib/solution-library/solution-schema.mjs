export const solutionStatuses = Object.freeze(['active', 'experimental', 'deprecated'])
export const solutionConfidence = Object.freeze(['low', 'medium', 'high'])

export function validateSolutionRecord(record = {}) {
  const missing = []
  for (const key of ['id', 'sourceBoard', 'boardType', 'problemType', 'problemSignature', 'rootCause', 'fixSummary', 'recipe', 'status', 'confidence']) {
    if (record[key] === undefined || record[key] === null || record[key] === '') missing.push(key)
  }
  if (record.status && !solutionStatuses.includes(record.status)) missing.push('status_valid')
  if (record.confidence && !solutionConfidence.includes(record.confidence)) missing.push('confidence_valid')
  return { valid: missing.length === 0, missing }
}

export function normalizeSolutionRecord(record = {}) {
  const now = new Date().toISOString()
  return {
    createdAt: now,
    updatedAt: now,
    implementation: { filesChanged: [], functionsAdded: [], testsAdded: [] },
    applicability: { boardTypes: [], netRoles: [], conditions: [] },
    safetyRules: [],
    evidence: { before: {}, after: {}, tests: [] },
    status: 'active',
    confidence: 'medium',
    ...record,
  }
}
