import { escLessonsLearned } from './esc-solutions.mjs'
import { recordSolution } from './solution-store.mjs'
import { applySolutionRecipe } from './solution-apply.mjs'
import { rankSolutionsForBoardContext } from './solution-search.mjs'

export function buildDefaultSolutionLibrary() {
  return escLessonsLearned.reduce((store, solution) => recordSolution(store, solution), [])
}

export function loadRelevantSolutionsForBoard(boardContext = {}, solutionStore = buildDefaultSolutionLibrary()) {
  const ranked = rankSolutionsForBoardContext(solutionStore, boardContext)
  return {
    boardContext,
    matches: ranked,
    appliedContext: applySolutionRecipe(boardContext, solutionStore),
  }
}

export function generateSolutionLibraryReport(solutions = buildDefaultSolutionLibrary()) {
  const byProblemType = {}
  const byBoardType = {}
  for (const solution of solutions) {
    byProblemType[solution.problemType] = (byProblemType[solution.problemType] || 0) + 1
    byBoardType[solution.boardType] = (byBoardType[solution.boardType] || 0) + 1
  }
  return {
    totalSolutions: solutions.length,
    byProblemType,
    byBoardType,
    active: solutions.filter((solution) => solution.status === 'active').length,
    highConfidence: solutions.filter((solution) => solution.confidence === 'high').length,
  }
}
