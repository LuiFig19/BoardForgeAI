import { getEscRoutingRules } from '../routing-rules/esc-routing-rules.mjs'
import { rankSolutionsForBoardContext } from './solution-search.mjs'

export function applySolutionRecipe(boardContext = {}, solutions = []) {
  const ranked = rankSolutionsForBoardContext(solutions, boardContext)
  return {
    ...boardContext,
    appliedSolutions: ranked.map((item) => ({ id: item.solution.id, score: item.score })),
    routingRules: boardContext.boardType === 'ESC' || ranked.some((item) => item.solution.boardType === 'ESC')
      ? getEscRoutingRules()
      : boardContext.routingRules,
    autoApplyGuard: {
      forbidFootprintChanges: true,
      forbidBoardOutlineChanges: true,
      forbidMountingHoleMoves: true,
      forbidUnsafeViaTypes: true,
      requireDrcErcHonesty: true,
    },
  }
}

export function markSolutionDeprecated(solutions = [], id, reason = '') {
  return solutions.map((solution) => solution.id === id ? { ...solution, status: 'deprecated', deprecatedReason: reason, updatedAt: new Date().toISOString() } : solution)
}
