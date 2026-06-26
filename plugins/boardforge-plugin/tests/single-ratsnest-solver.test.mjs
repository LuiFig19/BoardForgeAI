import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMicroRouteProblemModel,
  buildSingleNetObstacleMap,
  findClearanceAwarePathForRatsnestItem,
  inflateObstaclesForNetRole,
  scoreRouteByDrcRisk,
  searchMultiSegmentRoute,
  searchViaAssistedRoute,
  solveSingleRatsnestItemToCompletion,
} from '../lib/single-ratsnest-solver.mjs'
import { buildDefaultSolutionLibrary } from '../lib/solution-library/solution-index.mjs'

const sourcePad = {
  ref: 'U4',
  pad: '4',
  x: 116.738,
  y: 98.27,
  widthMm: 0.3,
  heightMm: 0.6,
  layers: ['B.Cu'],
  netName: '/M1_C_VDD',
}

const targetPad = {
  ref: 'C84',
  pad: '1',
  x: 116.459,
  y: 98.608,
  widthMm: 0.5,
  heightMm: 0.6,
  layers: ['F.Cu'],
  netName: '/M1_C_VDD',
}

test('ESC single ratsnest solve-to-completion builds exact M1_C_VDD problem model', () => {
  const model = buildMicroRouteProblemModel({
    net: '/M1_C_VDD',
    sourcePad,
    targetPad,
    pads: [sourcePad, targetPad],
  })
  assert.equal(model.net, '/M1_C_VDD')
  assert.equal(model.source, 'U4 pad 4')
  assert.equal(model.target, 'C84 pad 1')
  assert.equal(model.netRole, 'local power / VDD support')
  assert.ok(model.allowedLayers.includes('In4.Cu'))
  assert.deepEqual(model.allowedViaTypes, ['through'])
})

test('ESC clearance-aware single-net pathfinder scores obstacle-aware candidates', () => {
  const model = buildMicroRouteProblemModel({
    net: '/M1_C_VDD',
    sourcePad,
    targetPad,
    pads: [
      sourcePad,
      targetPad,
      { ref: 'U4', pad: '5', x: 116.6, y: 98.43, widthMm: 0.3, heightMm: 0.5, netName: '/OTHER', layers: ['B.Cu'] },
    ],
  })
  const obstacleMap = inflateObstaclesForNetRole(buildSingleNetObstacleMap({
    net: model.net,
    sourcePad,
    targetPad,
    pads: [
      sourcePad,
      targetPad,
      { ref: 'U4', pad: '5', x: 116.6, y: 98.43, widthMm: 0.3, heightMm: 0.5, netName: '/OTHER', layers: ['B.Cu'] },
    ],
  }), model.netRole)
  const candidates = findClearanceAwarePathForRatsnestItem(model, { obstacleMap, searchBudget: { doglegCandidates: 12, viaCandidates: 8 } })
  assert.ok(candidates.length > 0)
  assert.equal(Number.isFinite(candidates[0].drcRisk), true)
})

test('ESC M1_C_VDD route clean test requires solver candidates instead of smoke-test stop', () => {
  const model = buildMicroRouteProblemModel({ net: '/M1_C_VDD', sourcePad, targetPad, pads: [sourcePad, targetPad] })
  const result = solveSingleRatsnestItemToCompletion({
    model,
    context: { obstacleMap: buildSingleNetObstacleMap({ net: model.net, sourcePad, targetPad, pads: [sourcePad, targetPad] }) },
    searchBudget: {
      directCandidates: 10,
      doglegCandidates: 100,
      multiSegmentCandidates: 100,
      alternateLayerCandidates: 50,
      viaCandidates: 50,
      generatedCopperRerouteAttempts: 20,
      localDrcRepairAttempts: 50,
    },
  })
  assert.equal(result.status, 'SINGLE_RATSNEST_SOLVER_CANDIDATES_READY')
  assert.ok(result.candidatesTested >= 50)
})

test('ESC single-net DRC repair budget creates broad dogleg and via search space', () => {
  const model = buildMicroRouteProblemModel({ net: '/M1_C_VDD', sourcePad, targetPad, pads: [sourcePad, targetPad] })
  const obstacleMap = buildSingleNetObstacleMap({ net: model.net, sourcePad, targetPad, pads: [sourcePad, targetPad] })
  const doglegs = searchMultiSegmentRoute(model, obstacleMap, { doglegCandidates: 100, maxCandidates: 260 })
  const vias = searchViaAssistedRoute(model, obstacleMap, { viaCandidates: 50 })
  assert.ok(doglegs.length >= 200)
  assert.equal(vias.length, 50)
})

test('ESC no smoke-test final state: risky direct route exposes exact blockers', () => {
  const obstacleMap = buildSingleNetObstacleMap({
    net: '/M1_C_VDD',
    sourcePad,
    targetPad,
    pads: [
      sourcePad,
      targetPad,
      { ref: 'RISK', pad: '1', x: 116.6, y: 98.44, widthMm: 0.4, heightMm: 0.4, netName: '/OTHER' },
    ],
  })
  const direct = { segments: [{ start: sourcePad, end: targetPad, layer: 'In4.Cu', widthMm: 0.25 }] }
  const score = scoreRouteByDrcRisk(direct, inflateObstaclesForNetRole(obstacleMap, 'local power / VDD support'))
  assert.ok(score.blockers.length > 0)
  assert.equal(score.blockers[0].obstacle.ref, 'RISK')
})

test('solution library single ratsnest solve rule is saved for future boards', () => {
  const library = buildDefaultSolutionLibrary()
  const solution = library.find((item) => item.id === 'esc_single_ratsnest_item_solve_to_completion_001')
  assert.equal(Boolean(solution), true)
  assert.match(solution.rootCause, /smoke-testing routes/i)
  assert.ok(solution.recipe.some((step) => /clearance-aware/i.test(step)))
})
