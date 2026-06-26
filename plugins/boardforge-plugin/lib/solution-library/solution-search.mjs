export function rankSolutionsForBoardContext(solutions = [], context = {}) {
  return solutions
    .map((solution) => ({ solution, score: scoreSolution(solution, context) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
}

export function findSolutionsForProblem(solutions = [], problem = {}) {
  return rankSolutionsForBoardContext(solutions, {
    boardType: problem.boardType,
    netRoles: [problem.netRole, problem.netClass].filter(Boolean),
    drcFamilies: [problem.drcFamily].filter(Boolean),
    errorCodes: [problem.errorCode].filter(Boolean),
    constraints: problem.constraints || [],
  }).map((item) => item.solution)
}

function scoreSolution(solution = {}, context = {}) {
  let score = 0
  const boardTypes = solution.applicability?.boardTypes || [solution.boardType].filter(Boolean)
  const netRoles = solution.applicability?.netRoles || []
  const conditions = solution.applicability?.conditions || []
  const signature = solution.problemSignature || {}
  if (context.boardType && boardTypes.includes(context.boardType)) score += 30
  for (const role of context.netRoles || []) if (role && netRoles.includes(role)) score += 15
  for (const family of context.drcFamilies || []) if (family && signature.drcFamily === family) score += 20
  for (const code of context.errorCodes || []) if (code && signature.errorCode === code) score += 25
  for (const condition of context.constraints || []) if (conditions.includes(condition)) score += 5
  if (solution.status === 'active') score += 5
  if (solution.confidence === 'high') score += 5
  return score
}
