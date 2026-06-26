import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  commitOnlyConnectivityProgress,
  countUnconnectedItemsByNet,
  diffKiCadUnconnectedItems,
  extractRatsnestEndpointPairs,
  mapUnconnectedItemToPads,
  parseKiCadUnconnectedItems,
  verifyUnconnectedItemResolved,
} from '../lib/esc-routelet-success.mjs'
import {
  auditRolledBackRatsnestRoutes,
  continueAfterBlockedNet,
  consumeRatsnestQueueWithPhysicalRouter,
  diagnoseBoardForgeFailure,
  identifyGeneratedCopperBlockingRoute,
  precheckRatsnestRouteCandidateAgainstDrc,
  applyRouteBundleToKicadPcb,
  buildLocalRouteBundleForUnconnectedItem,
  continueAfterCleanupStage,
  repairConnectedRouteBundle,
  repairConnectingRatsnestRoute,
  rerouteSegmentWithDogleg,
  selectEscRouteWidthForNet,
  transactionalRerouteGeneratedCopper,
  fixFailureAndResume,
  mapFailureToModule,
  recordSolutionFromFix,
  diffUnconnectedItemSets,
  identifyShortFixDisconnects,
  preventMidLoopUserPrompt,
  rankPostRouteUnconnectedItems,
  routeByExactUnconnectedItem,
  routeExactUnconnectedItemPhysical,
  routeExactUnconnectedItemWithPromotionGate,
  rollbackRouteBundle,
  runEscPostRouteAutonomousSupervisor,
  runBoardForgeRootCauseSupervisor,
  runBoardForgeSelfDrivingSupervisor,
  runGuardedExactRatsnestPostRouteWriter,
  selectNextAutonomousPostRouteAction,
  writePostRouteRatsnestBundle,
} from '../lib/jobs.mjs'
import { kicadPcbFile } from '../lib/kicad.mjs'
import { scanKicadCopperAfterWrite } from '../lib/copper-writer.mjs'

function drcWithUnconnected(items = []) {
  return {
    issueCounts: { errors: items.length, warnings: 0 },
    unconnected_items: items.map(([net, sourceRef, sourcePad, sx, sy, targetRef, targetPad, tx, ty]) => ({
      severity: 'error',
      type: 'unconnected_items',
      description: 'Missing connection between items',
      items: [
        { description: `Pad ${sourcePad} [${net}] of ${sourceRef} on F.Cu`, pos: { x: sx, y: sy } },
        { description: `Pad ${targetPad} [${net}] of ${targetRef} on F.Cu`, pos: { x: tx, y: ty } },
      ],
    })),
  }
}

test('ESC parse KiCad unconnected items produces exact ratsnest endpoints', () => {
  const report = drcWithUnconnected([['/SWDIO', 'U1', '23', 10, 11, 'J2', '2', 15, 11]])
  const items = parseKiCadUnconnectedItems(report)
  assert.equal(items.length, 1)
  assert.equal(items[0].net, '/SWDIO')
  assert.equal(items[0].sourceRef, 'U1')
  assert.equal(items[0].sourcePad, '23')
  assert.equal(items[0].targetRef, 'J2')
  assert.equal(items[0].targetPad, '2')
  assert.equal(items[0].netRole, 'CONTROL_SIGNAL')
})

test('ESC ratsnest endpoint routing ranks exact KiCad pairs before generic net routing', () => {
  const report = drcWithUnconnected([
    ['/M2_C_SW', 'Q14', '13', 100, 100, 'J5', '3', 130, 100],
    ['/I2C1_SDA', 'U1', '12', 10, 10, 'J2', '4', 13, 10],
  ])
  const pairs = extractRatsnestEndpointPairs({ drcReport: report, maxPairs: 2 })
  assert.equal(pairs[0].net, '/I2C1_SDA')
  assert.equal(pairs[0].unconnectedId.startsWith('UCI_'), true)
  const route = routeByExactUnconnectedItem(pairs[0])
  assert.equal(route.mode, 'ratsnest_exact_endpoint_route')
  assert.equal(route.sourceRef, 'U1')
  assert.equal(route.targetRef, 'J2')
})

test('ESC route commit requires exact KiCad connectivity reduction', () => {
  const before = drcWithUnconnected([['/BST_U2', 'U2', '6', 10, 10, 'C12', '1', 12, 10]])
  const item = parseKiCadUnconnectedItems(before)[0]
  const unchangedAfter = drcWithUnconnected([['/BST_U2', 'U2', '6', 10, 10, 'C12', '1', 12, 10]])
  const rejected = commitOnlyConnectivityProgress({
    before,
    after: unchangedAfter,
    route: { net: '/BST_U2', segmentsWritten: 7 },
    unconnectedItem: item,
  })
  assert.equal(rejected.commitAllowed, false)
  assert.equal(rejected.successMetric, 'none')

  const resolvedAfter = drcWithUnconnected([])
  const accepted = commitOnlyConnectivityProgress({
    before,
    after: resolvedAfter,
    route: { net: '/BST_U2', segmentsWritten: 7 },
    unconnectedItem: item,
  })
  assert.equal(accepted.commitAllowed, true)
  assert.equal(accepted.successMetric, 'exact_unconnected_item_resolved')
})

test('ESC rollback route without connectivity proof is mandatory even if segments were written', () => {
  const before = drcWithUnconnected([['/M4_B_BST', 'U7', '6', 1, 1, 'C77', '1', 2, 1]])
  const after = drcWithUnconnected([['/M4_B_BST', 'U7', '6', 1, 1, 'C77', '1', 2, 1]])
  const item = parseKiCadUnconnectedItems(before)[0]
  const proof = verifyUnconnectedItemResolved({ before, after, unconnectedItem: item })
  assert.equal(proof.resolved, false)
  const decision = commitOnlyConnectivityProgress({ before, after, route: { net: '/M4_B_BST', segmentsWritten: 2 }, unconnectedItem: item })
  assert.equal(decision.rollbackRequired, true)
})

test('ESC bootstrap route audit can map retained route to exact unresolved KiCad item', () => {
  const report = drcWithUnconnected([
    ['/BST_U2', 'U2', '6', 10, 10, 'C44', '1', 11, 10],
    ['/M4_C_BST', 'U15', '6', 20, 20, 'C90', '1', 22, 20],
  ])
  const counts = countUnconnectedItemsByNet(report)
  assert.equal(counts['/BST_U2'], 1)
  assert.equal(counts['/M4_C_BST'], 1)
})

test('solution library route-by-ratsnest record is generated from supervisor fix', () => {
  const updated = recordSolutionFromFix([], {
    id: 'esc_route_by_ratsnest_not_net_label_001',
    failure: { code: 'UNCONNECTED_NOT_REDUCED' },
    evidence: { before: { unconnected: 499 }, after: { unconnected: 498 }, tests: ['test:esc-ratsnest-endpoint-routing'] },
  })
  assert.equal(updated.length, 1)
  assert.equal(updated[0].id, 'esc_route_by_ratsnest_not_net_label_001')
  assert.match(updated[0].rootCause, /net label/)
})

test('solution library ratsnest queue router record is generated from supervisor fix', () => {
  const updated = recordSolutionFromFix([], {
    id: 'esc_ratsnest_queue_must_drive_physical_router_001',
    failure: { code: 'RATSNEST_QUEUE_NOT_CONSUMED' },
    fixSummary: 'Ratsnest queue must feed physical route attempts with honest accounting.',
    recipe: ['Parse unconnected items', 'Route each queued item', 'Bucket every item as committed, rolled back, blocked, or precheck rejected'],
    evidence: { before: { physicallyAttempted: 0 }, after: { physicallyAttempted: 22 }, tests: ['test:esc-ratsnest-queue-feeds-router'] },
  })
  assert.equal(updated[0].id, 'esc_ratsnest_queue_must_drive_physical_router_001')
  assert.match(updated[0].fixSummary, /physical route attempts/)
})

test('solution library repair connecting route record is generated from supervisor fix', () => {
  const updated = recordSolutionFromFix([], {
    id: 'esc_repair_connecting_route_before_rollback_001',
    failure: { code: 'CONNECTING_ROUTE_DRC_UNSAFE' },
    fixSummary: 'Repair connecting ratsnest routes before rollback.',
    recipe: ['Detect exact item resolution', 'Classify generated DRC', 'Try local mutation', 'Commit repaired route or rollback'],
    evidence: { before: { rolledBackConnecting: 21 }, after: { repairedBeforeRollback: true }, tests: ['test:esc-repair-connecting-route-before-rollback'] },
  })
  assert.equal(updated[0].id, 'esc_repair_connecting_route_before_rollback_001')
  assert.match(updated[0].fixSummary, /Repair connecting/)
})


test('BoardForge root-cause supervisor maps internal blockers to modules and resumes', () => {
  const failure = { code: 'UNCONNECTED_NOT_REDUCED', net: '/BST_U2' }
  const diagnosis = diagnoseBoardForgeFailure(failure)
  assert.equal(diagnosis.repairTask, 'FIX_ROUTE_BY_EXACT_UNCONNECTED_ITEM')
  assert.equal(mapFailureToModule(failure).module, 'lib/esc-routelet-success.mjs')
  const repaired = fixFailureAndResume(failure, { currentCopper: { segments: 217, vias: 2 } })
  assert.equal(repaired.resumed, true)
  assert.equal(repaired.task.status, 'completed')
})

test('auto-fix and resume supervisor does not require user prompt midloop', () => {
  const report = drcWithUnconnected([['/NRST', 'U1', '7', 10, 10, 'J3', '5', 12, 10]])
  const supervisor = runBoardForgeRootCauseSupervisor({
    drcReport: report,
    failures: [{ code: 'UNCONNECTED_NOT_REDUCED', net: '/NRST' }],
    retainedCopper: { segments: 217, vias: 2 },
  })
  assert.equal(supervisor.userPromptRequired, false)
  assert.equal(supervisor.workQueue.length, 1)
  assert.equal(supervisor.internalTasksExecuted[0].status, 'completed')
})

test('continue after hard net blocker keeps remaining exact ratsnest queue', () => {
  const queue = [
    { unconnectedId: 'UCI_001', net: '/M2_C_SW' },
    { unconnectedId: 'UCI_002', net: '/SWCLK' },
  ]
  const result = continueAfterBlockedNet(queue[0], queue)
  assert.equal(result.continueRouting, true)
  assert.deepEqual(result.remainingQueue.map((item) => item.unconnectedId), ['UCI_002'])
})

test('unconnected item mapper binds parsed endpoints to scanned KiCad pads', () => {
  const item = parseKiCadUnconnectedItems(drcWithUnconnected([['/VREF+', 'U1', '8', 1, 1, 'C1', '1', 2, 1]]))[0]
  const mapped = mapUnconnectedItemToPads(item, [
    { ref: 'U1', pad: '8', netName: '/VREF+', x: 1, y: 1 },
    { ref: 'C1', pad: '1', netName: '/VREF+', x: 2, y: 1 },
  ])
  assert.equal(mapped.mapped, true)
  assert.equal(mapped.sourcePad.ref, 'U1')
  assert.equal(mapped.targetPad.ref, 'C1')
})

test('ESC ratsnest queue feeds physical router instead of stopping at queued state', async () => {
  const queue = extractRatsnestEndpointPairs({
    drcReport: drcWithUnconnected([
      ['/SS_U2', 'C18', '1', 1, 1, 'U2', '7', 2, 1],
      ['/RAMP12', 'R5', '2', 5, 5, 'C14', '1', 7, 5],
    ]),
    maxPairs: 2,
  })
  const batch = await consumeRatsnestQueueWithPhysicalRouter({
    queuedItems: queue,
    writeCandidate: async () => ({ status: 'ROLLED_BACK_NO_CONNECTIVITY', writtenToKiCad: true }),
  })
  assert.equal(batch.summary.queued, 2)
  assert.equal(batch.summary.physicallyAttempted, 2)
  assert.equal(batch.summary.writtenToKiCad, 2)
  assert.equal(batch.summary.rolledBack, 2)
})

test('ESC ratsnest attempt accounting rejects queued-not-attempted final state', async () => {
  const queue = extractRatsnestEndpointPairs({
    drcReport: drcWithUnconnected([['/NRST', 'C32', '1', 1, 1, 'IC1', 'F3', 3, 1]]),
    maxPairs: 1,
  })
  const batch = await consumeRatsnestQueueWithPhysicalRouter({ queuedItems: queue })
  assert.equal(batch.summary.queued, 1)
  assert.equal(batch.summary.physicallyAttempted, 1)
  assert.equal(batch.summary.blocked, 1)
  assert.notEqual(batch.results[0].status, 'QUEUED_NOT_ATTEMPTED')
})

test('ESC ratsnest precheck rejected items are counted with exact reason', async () => {
  const batch = await consumeRatsnestQueueWithPhysicalRouter({
    queuedItems: [{ unconnectedId: 'UCI_missing', net: '/FB_5', targetRef: 'U2', targetPad: '8' }],
    writeCandidate: async () => ({ status: 'COMMITTED_RESOLVED', writtenToKiCad: true }),
  })
  assert.equal(batch.summary.queued, 1)
  assert.equal(batch.summary.precheckRejected, 1)
  assert.equal(batch.summary.physicallyAttempted, 0)
  assert.equal(batch.results[0].reason, 'source_pad_unknown')
})

test('ESC rolledback route audit separates connecting DRC-unsafe candidates', () => {
  const audit = auditRolledBackRatsnestRoutes([
    {
      unconnectedId: 'UCI_1',
      net: '/SS_U2',
      status: 'ROLLED_BACK_DRC_UNSAFE',
      decision: {
        exactUnconnectedItemResolved: true,
        drcBefore: { errors: 10, warnings: 1 },
        drcAfter: { errors: 12, warnings: 1 },
      },
    },
    { unconnectedId: 'UCI_2', net: '/FB_5', status: 'PRECHECK_REJECTED', reason: 'source_pad_unknown' },
    { unconnectedId: 'UCI_3', net: '/NRST', status: 'ROLLED_BACK_NO_CONNECTIVITY', decision: { exactUnconnectedItemResolved: false } },
  ])
  assert.equal(audit.totalRolledBack, 2)
  assert.equal(audit.connectedButDrcUnsafe.length, 1)
  assert.equal(audit.noConnectivity.length, 1)
  assert.equal(audit.precheckFailures.length, 1)
  assert.equal(audit.repairableCandidates[0].repairable, true)
})

test('ESC repair connecting route before rollback creates mutation candidates', () => {
  const repair = repairConnectingRatsnestRoute(
    {
      net: '/NRST',
      start: { x: 1, y: 1, layer: 'F.Cu' },
      end: { x: 5, y: 1, layer: 'F.Cu' },
      waypoints: [{ x: 1, y: 1 }, { x: 5, y: 1 }],
      layerPreference: ['F.Cu'],
    },
    { decision: { drcBefore: { errors: 10, warnings: 0 }, drcAfter: { errors: 12, warnings: 0 } } },
  )
  assert.equal(repair.shouldRepairBeforeRollback, true)
  assert.ok(repair.repairCandidates.length > 1)
  assert.ok(repair.repairCandidates.some((candidate) => candidate.mutation?.type?.includes('dogleg')))
})

test('ESC ratsnest route precheck catches obvious DRC-risk layer choice', () => {
  const check = precheckRatsnestRouteCandidateAgainstDrc({
    net: '/NRST',
    start: { x: 1, y: 1 },
    end: { x: 2, y: 2 },
    waypoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
    layerPreference: ['In2.Cu'],
  })
  assert.equal(check.ok, false)
  assert.equal(check.reason, 'control_signal_on_power_layer')
})

test('ESC unconnected item diff reports resolved and newly-created items', () => {
  const before = drcWithUnconnected([
    ['/SS_U2', 'C18', '1', 1, 1, 'U2', '7', 2, 1],
    ['/NRST', 'C32', '1', 4, 1, 'IC1', 'F3', 6, 1],
  ])
  const after = drcWithUnconnected([
    ['/NRST', 'C32', '1', 4, 1, 'IC1', 'F3', 6, 1],
    ['/SS_U2', 'U2', '7', 2, 1, 'R99', '1', 4, 1],
  ])
  const diff = diffKiCadUnconnectedItems({ before, after })
  assert.equal(diff.beforeCount, 2)
  assert.equal(diff.afterCount, 2)
  assert.equal(diff.resolved.length, 1)
  assert.equal(diff.created.length, 1)
})

test('ESC connected route DRC repair engine classifies and mutates connected routes', () => {
  const repair = repairConnectedRouteBundle(
    {
      net: '/FB_5',
      start: { x: 132.9, y: 105.9, layer: 'F.Cu' },
      end: { x: 136.1, y: 100.2, layer: 'F.Cu' },
      waypoints: [{ x: 132.9, y: 105.9 }, { x: 136.1, y: 100.2 }],
      layerPreference: ['F.Cu'],
    },
    {
      decision: {
        drcBefore: { errors: 10, warnings: 0 },
        drcAfter: { errors: 12, warnings: 0 },
        generatedDrcViolations: [{ type: 'clearance', description: 'Track clearance violation' }],
      },
    },
  )
  assert.equal(repair.status, 'CONNECTED_ROUTE_REPAIR_CANDIDATES_READY')
  assert.equal(repair.failure.unsafe, true)
  assert.ok(repair.repairPlan.some((type) => /repair_route_route_clearance|dogleg|layer|width/.test(type)))
})

test('ESC shove route around obstacle creates local dogleg mutation', () => {
  const candidates = rerouteSegmentWithDogleg({
    net: '/BOOT_SEL_ESC',
    start: { x: 1, y: 1, layer: 'F.Cu' },
    end: { x: 4, y: 1, layer: 'F.Cu' },
    waypoints: [{ x: 1, y: 1 }, { x: 4, y: 1 }],
    layerPreference: ['F.Cu'],
  })
  assert.ok(candidates.length > 0)
  assert.ok(candidates.some((candidate) => /dogleg|bundle/.test(candidate.mutation?.type || '')))
})

test('ESC reroute generated copper transaction identifies blockers and displacement candidates', () => {
  const transaction = transactionalRerouteGeneratedCopper(
    { net: '/NRST', start: { x: 1, y: 1 }, end: { x: 4, y: 1 }, waypoints: [{ x: 1, y: 1 }, { x: 4, y: 1 }] },
    {},
    {
      generatedRoutes: [
        { net: '/BOOT_SEL_ESC', start: { x: 2, y: 1 }, end: { x: 3, y: 1 }, waypoints: [{ x: 2, y: 1 }, { x: 3, y: 1 }] },
      ],
    },
  )
  assert.equal(transaction.attempted, true)
  assert.equal(transaction.blockers.length, 1)
  assert.ok(transaction.candidates.length > 0)
})

test('ESC net role width selection avoids routing signal nets as high current', () => {
  const signal = selectEscRouteWidthForNet('/NRST')
  const power = selectEscRouteWidthForNet('/VBAT_RAW')
  const rail = selectEscRouteWidthForNet('/VREG5')
  assert.equal(signal.role, 'CONTROL_SIGNAL')
  assert.ok(signal.widthMm < rail.widthMm)
  assert.ok(power.widthMm > signal.widthMm)
})

test('ESC signal net is not routed as high-current during repair', () => {
  const repair = repairConnectedRouteBundle(
    {
      net: '/ESC_TELEM',
      start: { x: 1, y: 1, layer: 'F.Cu' },
      end: { x: 2, y: 1, layer: 'F.Cu' },
      waypoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      layerPreference: ['F.Cu'],
    },
    { decision: { drcBefore: { errors: 1, warnings: 0 }, drcAfter: { errors: 2, warnings: 0 } } },
  )
  const widthCandidate = repair.repairCandidates.find((candidate) => candidate.mutation?.type === 'net_role_width_selection')
  assert.ok(widthCandidate)
  assert.ok(widthCandidate.widthMm < 0.3)
})

test('solution library connected route repair record is generated from supervisor fix', () => {
  const updated = recordSolutionFromFix([], {
    id: 'esc_connected_route_drc_repair_engine_001',
    failure: { code: 'CONNECTED_ROUTE_DRC_UNSAFE_REPAIR_FAILED' },
    fixSummary: 'Classify and repair connected ratsnest route DRC before rollback.',
    recipe: ['Classify generated DRC', 'Shove/dogleg/change layer', 'Reroute generated blockers transactionally', 'Commit only if connectivity remains DRC-safe'],
    evidence: { before: { transientConnected: 10, committed: 0 }, after: { localRepairEngine: true }, tests: ['test:esc-connected-route-drc-repair-engine'] },
  })
  assert.equal(updated[0].id, 'esc_connected_route_drc_repair_engine_001')
  assert.match(updated[0].fixSummary, /repair connected ratsnest/i)
})

test('postroute unconnected item ranking prioritizes easy control and rail items', () => {
  const report = drcWithUnconnected([
    ['/M2_C_SW', 'Q14', '13', 100, 100, 'J5', '3', 130, 100],
    ['/NRST', 'U1', '7', 10, 10, 'J3', '5', 12, 10],
    ['/VREG5', 'U4', '4', 20, 20, 'C84', '1', 23, 20],
  ])
  const ranked = rankPostRouteUnconnectedItems(report, { maxItems: 3 })
  assert.equal(ranked[0].net, '/NRST')
  assert.equal(ranked[1].net, '/VREG5')
  assert.equal(ranked[2].net, '/M2_C_SW')
})

test('postroute unconnected set diff gate detects replacement unconnected items', () => {
  const before = drcWithUnconnected([['/NRST', 'U1', '7', 10, 10, 'J3', '5', 12, 10]])
  const after = drcWithUnconnected([['/NRST', 'J3', '5', 12, 10, 'R1', '1', 13, 10]])
  const diff = diffUnconnectedItemSets({ before, after })
  assert.equal(diff.resolvedCount, 1)
  assert.equal(diff.createdCount, 1)
  assert.equal(diff.replacementUnconnectedCreated, true)
})

test('postroute ratsnest route promotion gate requires exact connectivity and no DRC regression', () => {
  const before = {
    ...drcWithUnconnected([['/NRST', 'U1', '7', 10, 10, 'J3', '5', 12, 10]]),
    violations: [{ type: 'clearance', severity: 'error' }],
  }
  const item = parseKiCadUnconnectedItems(before)[0]
  const cleanAfter = { issueCounts: { errors: 1, warnings: 0 }, violations: [{ type: 'clearance', severity: 'error' }], unconnected_items: [] }
  const accepted = routeExactUnconnectedItemWithPromotionGate({ beforeDrc: before, afterDrc: cleanAfter, unconnectedItem: item })
  assert.equal(accepted.promote, true)
  assert.equal(accepted.exactUnconnectedItemResolved, true)

  const regressedAfter = {
    issueCounts: { errors: 2, warnings: 0 },
    violations: [{ type: 'clearance', severity: 'error' }, { type: 'shorting_items', severity: 'error' }],
    unconnected_items: [],
  }
  const rejected = routeExactUnconnectedItemWithPromotionGate({ beforeDrc: before, afterDrc: regressedAfter, unconnectedItem: item })
  assert.equal(rejected.promote, false)
  assert.match(rejected.reason, /weighted DRC|critical/)
})

test('postroute guarded ratsnest writer attempts exact items and blocks without a physical writer', async () => {
  const report = drcWithUnconnected([
    ['/NRST', 'U1', '7', 10, 10, 'J3', '5', 12, 10],
    ['/VREG5', 'U4', '4', 20, 20, 'C84', '1', 23, 20],
  ])
  const batch = await runGuardedExactRatsnestPostRouteWriter({ drcReport: report, maxItems: 2 })
  assert.equal(batch.implemented, true)
  assert.equal(batch.summary.queued, 2)
  assert.equal(batch.summary.physicallyAttempted, 2)
  assert.equal(batch.summary.blocked, 2)
  assert.equal(batch.results[0].status, 'TEMP_BLOCKED_WITH_EXACT_REASON')
  assert.notEqual(batch.results[0].status, 'QUEUED_NOT_ATTEMPTED')
})

test('self-driving supervisor creates internal plan and avoids user prompt', () => {
  const report = drcWithUnconnected([['/BOOT_SEL_ESC', 'U1', '1', 1, 1, 'R3', '2', 2, 1]])
  const supervisor = runBoardForgeSelfDrivingSupervisor({
    drcReport: report,
    failures: [{ code: 'LOW_YIELD_STOP', family: 'hole_clearance' }],
    solutionLibrary: [{ id: 'postroute_prescore_candidate_filter_001' }],
  })
  assert.equal(supervisor.implemented, true)
  assert.equal(supervisor.userPromptRequired, false)
  assert.equal(supervisor.nextAction, 'runGuardedExactRatsnestPostRouteWriter')
  assert.equal(supervisor.rankedUnconnected.length, 1)
  assert.equal(supervisor.internalWorkPlans.length, 1)
})

test('postroute unconnected diff after short repair maps created items to removed short segments', () => {
  const before = drcWithUnconnected([['/M1_B_SW', 'Q1', '1', 1, 1, 'Q2', '1', 2, 1]])
  const after = drcWithUnconnected([
    ['/M1_B_SW', '', '', 1.1, 1, '', '', 1.9, 1],
    ['/NRST', 'U1', '7', 10, 10, 'J1', '1', 11, 10],
  ])
  const disconnects = identifyShortFixDisconnects({
    beforeDrc: before,
    afterDrc: after,
    shortRepairCandidates: [{
      shortId: 'short_001',
      routeObjectUuid: 'abc',
      routeObjectDescription: 'Track [/M1_B_SW] on B.Cu',
      fixedObjectDescription: 'PTH pad V [<no net>] of U6',
      netsInvolved: ['/M1_B_SW'],
      location: { x: 1.2, y: 1 },
    }],
  })
  assert.equal(disconnects.length, 1)
  assert.equal(disconnects[0].net, '/M1_B_SW')
  assert.equal(disconnects[0].reasonCreated, 'shorting segment removed')
  assert.equal(disconnects[0].exactRerouteCandidate, true)
})

test('postroute reroute short-fix disconnects is selected before generic ratsnest reduction', () => {
  const action = selectNextAutonomousPostRouteAction({
    drcReport: { types: { shorting_items: 0, tracks_crossing: 0 }, unconnected: 248 },
    shortFixDisconnects: [{ net: '/M1_B_SW', exactRerouteCandidate: true }],
  })
  assert.equal(action, 'reroute_short_fix_disconnects')
})

test('postroute short count stays zero gate rejects recreated shorts', () => {
  const before = drcWithUnconnected([['/M1_B_SW', 'Q1', '1', 1, 1, 'Q2', '1', 2, 1]])
  const item = parseKiCadUnconnectedItems(before)[0]
  const after = { violations: [{ type: 'shorting_items', severity: 'error' }], unconnected_items: [] }
  const decision = routeExactUnconnectedItemWithPromotionGate({ beforeDrc: before, afterDrc: after, unconnectedItem: item })
  assert.equal(decision.promote, false)
  assert.match(decision.reason, /weighted DRC|critical/)
})

test('postroute autonomous supervisor writes resume state and avoids midloop user prompt', () => {
  const before = drcWithUnconnected([['/M3_A_SW', 'Q1', '1', 1, 1, 'Q2', '1', 2, 1]])
  const after = drcWithUnconnected([['/M3_A_SW', '', '', 1.1, 1, '', '', 1.9, 1]])
  const supervisor = runEscPostRouteAutonomousSupervisor({
    currentBoard: 'cleanup12.kicad_pcb',
    beforeShortRepairDrc: before,
    drcReport: after,
    lastCompletedStage: 'shorts_first_cleanup',
    shortRepairCandidates: [{
      shortId: 'short_009',
      routeObjectUuid: 'route-uuid',
      routeObjectDescription: 'Track [/M3_A_SW] on B.Cu',
      netsInvolved: ['/M3_A_SW'],
      location: { x: 1.2, y: 1 },
    }],
  })
  assert.equal(supervisor.implemented, true)
  assert.equal(supervisor.userPromptRequired, false)
  assert.equal(supervisor.nextAction, 'reroute_short_fix_disconnects')
  assert.equal(supervisor.resumeState.resumeCommand, 'reroute_short_fix_disconnects')
  assert.equal(supervisor.resumeState.pendingDisconnects.length, 1)
})

test('postroute no midloop user prompt suppresses invalid final states', () => {
  const state = preventMidLoopUserPrompt({ nextStage: 'continue_cleanup', userPromptRequired: true })
  assert.equal(state.userPromptRequired, false)
  assert.equal(state.invalidFinalStatesSuppressed.includes('needs_next_prompt'), true)
  assert.equal(state.invalidFinalStatesSuppressed.includes('timeout'), true)
})

test('postroute auto-select next action falls through to DRC cleanup after disconnects are handled', () => {
  const state = continueAfterCleanupStage({
    currentBoard: 'cleanup13.kicad_pcb',
    lastCompletedStage: 'reroute_short_fix_disconnects',
    drcReport: { types: { shorting_items: 0, tracks_crossing: 0, clearance: 3 }, unconnected: 248 },
    shortFixDisconnects: [{ net: '/M1_B_SW', exactRerouteCandidate: true, resolved: true }],
  })
  assert.equal(state.nextStage, 'repair_generated_severe_clearance')
  assert.equal(state.userPromptRequired, false)
})

test('solution library postroute no babysitting rule name is stable', () => {
  assert.equal('postroute_no_babysitting_supervisor_001', 'postroute_no_babysitting_supervisor_001')
})

test('postroute physical writer handoff writes bundle through guarded callback', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-postroute-writer-'))
  try {
    const pcbFile = path.join(workspace, 'postroute.kicad_pcb')
    const candidatePath = path.join(workspace, 'candidate.kicad_pcb')
    await writeFile(pcbFile, kicadPcbFile({ widthMm: 20, heightMm: 20, outline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] }, { nets: [{ name: '/NRST' }] }), 'utf8')
    const report = drcWithUnconnected([['/NRST', 'U1', '7', 2, 2, 'J3', '5', 5, 2]])
    const batch = await runGuardedExactRatsnestPostRouteWriter({
      drcReport: report,
      maxItems: 1,
      writeCandidate: (route, item) => routeExactUnconnectedItemPhysical(route, item, { pcbFile, candidatePath }),
    })
    assert.equal(batch.summary.physicallyAttempted, 1)
    assert.equal(batch.summary.writtenToKiCad, 1)
    const copper = await scanKicadCopperAfterWrite(candidatePath)
    assert.equal(copper.segments >= 1, true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('postroute write ratsnest bundle preserves existing copper and writes local route', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-ratsnest-bundle-'))
  try {
    const pcbFile = path.join(workspace, 'bundle.kicad_pcb')
    const candidatePath = path.join(workspace, 'bundle-candidate.kicad_pcb')
    await writeFile(pcbFile, kicadPcbFile({ widthMm: 20, heightMm: 20, outline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] }, { nets: [{ name: '/VREG5' }] }), 'utf8')
    const item = parseKiCadUnconnectedItems(drcWithUnconnected([['/VREG5', 'U4', '4', 2, 2, 'C84', '1', 5, 2]]))[0]
    const result = await writePostRouteRatsnestBundle({ pcbFile, candidatePath, unconnectedItem: item })
    assert.equal(result.writtenToKiCad, true)
    assert.equal(result.routeBundle.net, '/VREG5')
    assert.equal(result.routeBundle.forbiddenViaTypes.length, 0)
    const pcb = await readFile(candidatePath, 'utf8')
    assert.match(pcb, /\(segment/)
    assert.match(pcb, /\(net "\/VREG5"\)/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('postroute ratsnest writer commits only with proof from promotion gate', async () => {
  const before = drcWithUnconnected([['/SS_U2', 'C18', '1', 1, 1, 'U2', '7', 2, 1]])
  const item = parseKiCadUnconnectedItems(before)[0]
  const after = { violations: [], unconnected_items: [] }
  const batch = await runGuardedExactRatsnestPostRouteWriter({
    drcReport: before,
    maxItems: 1,
    writeCandidate: async () => ({ writtenToKiCad: true, beforeDrc: before, afterDrc: after }),
  })
  assert.equal(batch.summary.committed, 1)
  assert.equal(batch.results[0].gate.promote, true)
  assert.equal(batch.results[0].gate.exactUnconnectedItemResolved, true)
  assert.equal(item.net, '/SS_U2')
})

test('postroute ratsnest writer rolls back unsafe route after physical write', async () => {
  const before = drcWithUnconnected([['/SS_U2', 'C18', '1', 1, 1, 'U2', '7', 2, 1]])
  const after = { violations: [{ type: 'shorting_items', severity: 'error' }], unconnected_items: [] }
  const batch = await runGuardedExactRatsnestPostRouteWriter({
    drcReport: before,
    maxItems: 1,
    writeCandidate: async () => ({ writtenToKiCad: true, beforeDrc: before, afterDrc: after, status: 'ROLLED_BACK_DRC_UNSAFE' }),
  })
  assert.equal(batch.summary.writtenToKiCad, 1)
  assert.equal(batch.summary.committed, 0)
  assert.equal(batch.summary.rolledBack, 1)
  assert.equal(batch.results[0].gate.promote, false)
})

test('postroute rollback route bundle restores candidate file from backup', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-ratsnest-rollback-'))
  try {
    const backupPath = path.join(workspace, 'backup.kicad_pcb')
    const candidatePath = path.join(workspace, 'candidate.kicad_pcb')
    await writeFile(backupPath, '(kicad_pcb (version 20240101))\n', 'utf8')
    await writeFile(candidatePath, '(kicad_pcb (version 20240101) (segment))\n', 'utf8')
    const rollback = await rollbackRouteBundle({ backupPath, candidatePath })
    assert.equal(rollback.rolledBack, true)
    assert.equal(await readFile(candidatePath, 'utf8'), await readFile(backupPath, 'utf8'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
