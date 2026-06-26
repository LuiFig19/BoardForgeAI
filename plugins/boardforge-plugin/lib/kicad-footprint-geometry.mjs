import { readFile } from 'node:fs/promises'
import { round } from './geometry.mjs'
import { parsePcbFootprints } from './esc-corridor-regeneration.mjs'

export async function extractFootprintGeometryFromPcb({ pcbFile }) {
  const content = await readFile(pcbFile, 'utf8')
  return extractFootprintGeometry(content)
}

export function extractFootprintGeometry(content = '') {
  return parsePcbFootprints(content).map((footprint) => {
    const block = content.slice(footprint.start, footprint.end + 1)
    return geometryForFootprint(footprint, block)
  })
}

export function geometryForFootprint(footprint = {}, block = '') {
  const pads = parsePads(block, footprint)
  const drills = pads.filter((pad) => pad.drillMm).map((pad) => ({ x: pad.x, y: pad.y, drillMm: pad.drillMm, box: pad.box }))
  const courtyardBox = layerPrimitiveBox(block, footprint, /CrtYd/i)
  const silkscreenBox = layerPrimitiveBox(block, footprint, /SilkS/i)
  const fabBox = layerPrimitiveBox(block, footprint, /Fab/i)
  const padBox = unionBoxes(pads.map((pad) => pad.box))
  const holeBox = unionBoxes(drills.map((drill) => drill.box))
  const fallback = expandBox(unionBoxes([padBox, silkscreenBox, fabBox].filter(Boolean)), 0.25)
  const maxExtentBox = unionBoxes([courtyardBox, fallback, holeBox].filter(Boolean)) || centerBox(footprint.x, footprint.y, 1, 1)
  return {
    ref: footprint.ref,
    footprint: footprint.lib,
    position: { x: footprint.x, y: footprint.y },
    rotation: footprint.rotation || 0,
    bodyBox: fallback || maxExtentBox,
    padBox,
    courtyardBox: courtyardBox || expandBox(fallback || padBox || maxExtentBox, 0.25),
    silkscreenBox,
    fabBox,
    holeBox,
    maxExtentBox,
    pads,
    drills,
    isLocked: Boolean(footprint.locked),
    isMechanical: /^H\d+/i.test(footprint.ref) || /MOUNT|HOLE|FID/i.test(`${footprint.ref} ${footprint.lib}`),
    isConnector: /^J\d+/i.test(footprint.ref),
    courtyardFallback: !courtyardBox,
  }
}

export function applyDryRunMoves(geometries = [], moves = []) {
  const byRef = new Map(moves.map((move) => [move.ref, move]))
  return geometries.map((geometry) => {
    const move = byRef.get(geometry.ref)
    if (!move) return geometry
    const dx = Number(move.dx || 0)
    const dy = Number(move.dy || 0)
    const rotationDelta = Number.isFinite(Number(move.rotation)) ? Number(move.rotation) - Number(geometry.rotation || 0) : 0
    return transformGeometry(geometry, dx, dy, rotationDelta, Number.isFinite(Number(move.rotation)) ? Number(move.rotation) : geometry.rotation)
  })
}

export function precheckPlacementGeometry({ geometries = [], moves = [], boardBox = null, clearanceMm = 0.15, highCurrentCorridors = [], senseKeepaways = [], baselinePrecheck = null }) {
  const moved = applyDryRunMoves(geometries, moves)
  const board = boardBox || unionBoxes(moved.map((item) => item.maxExtentBox))
  const movedRefs = new Set(moves.map((move) => move.ref))
  const offBoard = moved.filter((item) => !boxInside(item.maxExtentBox, board, 0.05)).map((item) => item.ref)
  const componentOverlaps = []
  const courtyardOverlaps = []
  const mountingHoleConflicts = []
  for (let i = 0; i < moved.length; i += 1) {
    for (let j = i + 1; j < moved.length; j += 1) {
      const a = moved[i]
      const b = moved[j]
      if (a.isMechanical || b.isMechanical) {
        if (boxesOverlap(a.maxExtentBox, b.maxExtentBox, 0.25) && (movedRefs.has(a.ref) || movedRefs.has(b.ref))) mountingHoleConflicts.push([a.ref, b.ref])
        continue
      }
      if (boxesOverlap(a.bodyBox || a.maxExtentBox, b.bodyBox || b.maxExtentBox, clearanceMm)) componentOverlaps.push([a.ref, b.ref])
      if (boxesOverlap(a.courtyardBox || a.maxExtentBox, b.courtyardBox || b.maxExtentBox, clearanceMm)) courtyardOverlaps.push([a.ref, b.ref])
    }
  }
  const highCurrentCorridorBlocks = highCurrentCorridors.flatMap((corridor) => moved
    .filter((item) => !item.isConnector && !item.isMechanical && boxIntersectsSegment(item.maxExtentBox, corridor.source, corridor.target, corridor.widthMm || 1.2))
    .map((item) => ({ net: corridor.net, ref: item.ref })))
  const senseKeepawayViolations = senseKeepaways.flatMap((keepaway) => moved
    .filter((item) => /Q\d+|SHUNT|EPC|MOSFET/i.test(`${item.ref} ${item.footprint}`) && boxesOverlap(item.maxExtentBox, keepaway.box, keepaway.clearanceMm || 0.5))
    .map((item) => ({ ref: item.ref, keepaway: keepaway.id || 'sense_keepaway' })))
  const worsened = baselinePrecheck && (
    offBoard.length > baselinePrecheck.offBoard
    || componentOverlaps.length > baselinePrecheck.componentOverlaps
    || courtyardOverlaps.length > baselinePrecheck.courtyardOverlaps + 4
    || mountingHoleConflicts.length > baselinePrecheck.mountingHoleConflicts
  )
  const decision = baselinePrecheck
    ? (worsened ? 'reject_before_kicad_write' : 'precheck_pass_needs_kicad_drc')
    : offBoard.length || componentOverlaps.length > 20 || courtyardOverlaps.length > 40 || mountingHoleConflicts.length
    ? 'reject_before_kicad_write'
    : 'precheck_pass_needs_kicad_drc'
  return {
    offBoard: offBoard.length,
    offBoardRefs: offBoard,
    componentOverlaps: componentOverlaps.length,
    componentOverlapRefs: componentOverlaps.slice(0, 50),
    courtyardOverlaps: courtyardOverlaps.length,
    courtyardOverlapRefs: courtyardOverlaps.slice(0, 50),
    mountingHoleConflicts: mountingHoleConflicts.length,
    mountingHoleConflictRefs: mountingHoleConflicts,
    boardEdgeViolations: offBoard.length,
    highCurrentCorridorBlocks: highCurrentCorridorBlocks.length,
    highCurrentCorridorBlockRefs: highCurrentCorridorBlocks.slice(0, 50),
    senseKeepawayViolations: senseKeepawayViolations.length,
    senseKeepawayRefs: senseKeepawayViolations.slice(0, 50),
    delta: baselinePrecheck ? {
      offBoard: offBoard.length - baselinePrecheck.offBoard,
      componentOverlaps: componentOverlaps.length - baselinePrecheck.componentOverlaps,
      courtyardOverlaps: courtyardOverlaps.length - baselinePrecheck.courtyardOverlaps,
      mountingHoleConflicts: mountingHoleConflicts.length - baselinePrecheck.mountingHoleConflicts,
      highCurrentCorridorBlocks: highCurrentCorridorBlocks.length - baselinePrecheck.highCurrentCorridorBlocks,
      senseKeepawayViolations: senseKeepawayViolations.length - baselinePrecheck.senseKeepawayViolations,
    } : null,
    decision,
  }
}

export function extractPlacementBlockersFromPrecheck(precheck = {}, geometries = []) {
  const byRef = new Map(geometries.map((item) => [item.ref, item]))
  const blockers = new Map()
  const add = (ref, patch) => {
    if (!ref) return
    const geometry = byRef.get(ref)
    const existing = blockers.get(ref) || {
      ref,
      position: geometry?.position || null,
      blocks: [],
      blockTypes: new Set(),
      risk: geometry?.isConnector ? 'high' : geometry?.isMechanical ? 'fixed' : 'low',
      reasons: [],
    }
    for (const net of patch.blocks || []) if (!existing.blocks.includes(net)) existing.blocks.push(net)
    if (patch.blockType) existing.blockTypes.add(patch.blockType)
    if (patch.reason) existing.reasons.push(patch.reason)
    blockers.set(ref, existing)
  }
  for (const item of precheck.highCurrentCorridorBlockRefs || []) add(item.ref, { blocks: [item.net], blockType: 'corridor_obstruction', reason: `Blocks ${item.net} high-current corridor.` })
  for (const pair of precheck.componentOverlapRefs || []) for (const ref of pair) add(ref, { blockType: 'component_overlap', reason: `Overlaps ${pair.find((item) => item !== ref) || 'another footprint'}.` })
  for (const pair of precheck.courtyardOverlapRefs || []) for (const ref of pair) add(ref, { blockType: 'courtyard_overlap', reason: `Courtyard overlaps ${pair.find((item) => item !== ref) || 'another footprint'}.` })
  for (const ref of precheck.offBoardRefs || []) add(ref, { blockType: 'board_edge_violation', reason: 'Footprint extent is outside the fixed board bounds.' })
  for (const item of precheck.senseKeepawayRefs || []) add(item.ref, { blockType: 'sense_keepaway_violation', reason: `Violates ${item.keepaway}.` })
  return [...blockers.values()].map((item) => ({
    ...item,
    blockTypes: [...item.blockTypes],
    allowedMoveDirections: allowedMoveDirections(item),
    suggestedMoveMm: item.risk === 'high' ? 0.35 : 0.6,
  }))
}

export function rankBlockersByRoutingImpact(blockers = []) {
  return [...blockers].sort((a, b) => blockerScore(b) - blockerScore(a))
}

export function generateTargetedMoveCandidates({ blockers = [], geometries = [], highCurrentCorridors = [] }) {
  const byRef = new Map(geometries.map((item) => [item.ref, item]))
  const ranked = rankBlockersByRoutingImpact(blockers).filter((item) => item.risk !== 'fixed')
  const candidates = []
  for (const blocker of ranked.slice(0, 14)) {
    for (const direction of blocker.allowedMoveDirections.slice(0, 2)) {
      const move = directionalMove(blocker.ref, direction, blocker.suggestedMoveMm)
      candidates.push(targetedCandidate(`targeted-single-${blocker.ref}-${direction}`, [move], blocker, `Move ${blocker.ref} ${direction} away from ${blocker.blocks.join(', ') || 'local'} blocker.`))
    }
  }
  const byNet = new Map()
  for (const blocker of ranked) for (const net of blocker.blocks) {
    if (!byNet.has(net)) byNet.set(net, [])
    byNet.get(net).push(blocker)
  }
  for (const [net, items] of byNet) {
    const moves = items.slice(0, 4).map((blocker, index) => directionalMove(blocker.ref, index % 2 ? 'up' : 'left', blocker.suggestedMoveMm))
    if (moves.length) candidates.push(targetedCandidate(`targeted-cluster-${safeId(net)}`, moves, { blocks: [net], blockTypes: ['corridor_obstruction'] }, `Move small blocker cluster away from ${net}.`))
  }
  for (const corridor of highCurrentCorridors) {
    const near = ranked.filter((blocker) => blocker.blocks.includes(corridor.net)).slice(0, 5)
    const moves = near.map((blocker) => {
      const geometry = byRef.get(blocker.ref)
      return moveAwayFromSegment(blocker.ref, geometry?.position, corridor.source, corridor.target, blocker.suggestedMoveMm)
    }).filter(Boolean)
    if (moves.length) candidates.push(targetedCandidate(`targeted-via-escape-${safeId(corridor.net)}`, moves, { blocks: [corridor.net], blockTypes: ['via_escape_cleanup'] }, `Open through-via-array escape around ${corridor.net}.`))
  }
  return candidates.map((candidate) => ({ ...candidate, movedRefs: candidate.moves.map((move) => move.ref), moveCount: candidate.moves.length }))
}

export function filterTargetedMoveCandidatesForPriority({ candidates = [], activeTargetNets = ['/VBAT_RAW', '/M2_C_SW'] } = {}) {
  const targets = activeTargetNets.map(normalizeNetName)
  return candidates.filter((candidate) => {
    const opened = (candidate.corridorsOpened || []).map(normalizeNetName)
    return opened.some((net) => targets.includes(net))
  }).map((candidate) => ({
    ...candidate,
    priorityTarget: firstPriorityTarget(candidate.corridorsOpened || [], activeTargetNets),
  }))
}

export function selectPriorityTargetedMoveCandidate({ simulations = [], activeTargetNets = ['/VBAT_RAW', '/M2_C_SW'] } = {}) {
  const targets = activeTargetNets.map(normalizeNetName)
  const ranked = simulations
    .filter((simulation) => simulation?.writeToKicad !== false)
    .filter((simulation) => {
      const opened = (simulation.candidate?.corridorsOpened || []).map(normalizeNetName)
      return opened.some((net) => targets.includes(net))
    })
    .filter((simulation) => Number(simulation.precheck?.delta?.highCurrentCorridorBlocks || 0) < 0)
    .map((simulation) => ({
      ...simulation,
      priorityTarget: firstPriorityTarget(simulation.candidate?.corridorsOpened || [], activeTargetNets),
    }))
    .sort((a, b) => {
      const targetDelta = targetRank(a.priorityTarget, activeTargetNets) - targetRank(b.priorityTarget, activeTargetNets)
      if (targetDelta) return targetDelta
      const aGain = Math.max(0, -(a.precheck?.delta?.highCurrentCorridorBlocks || 0))
      const bGain = Math.max(0, -(b.precheck?.delta?.highCurrentCorridorBlocks || 0))
      if (bGain !== aGain) return bGain - aGain
      return Number(b.score || 0) - Number(a.score || 0)
    })
  return ranked[0] || null
}

export function shouldRollbackTargetedPlacement({ drcBefore = {}, drcAfter = {}, routing = {} } = {}) {
  const beforeErrors = Number(drcBefore.errors ?? 0)
  const afterErrors = Number(drcAfter.errors ?? beforeErrors)
  const beforeUnconnected = Number(drcBefore.unconnected ?? 0)
  const afterUnconnected = Number(drcAfter.unconnected ?? beforeUnconnected)
  const targetBefore = Number(routing.targetUnconnectedBefore ?? routing.targetIslandsBefore ?? 0)
  const targetAfter = Number(routing.targetUnconnectedAfter ?? routing.targetIslandsAfter ?? targetBefore)
  const committedRoutes = Number(routing.committedRoutes ?? routing.committed ?? 0)
  const connectivityImproved = afterUnconnected < beforeUnconnected || targetAfter < targetBefore || Boolean(routing.connectionCompleted)
  const drcWorsened = afterErrors > beforeErrors
  return {
    rollback: drcWorsened && !connectivityImproved && committedRoutes <= 0,
    reason: drcWorsened && !connectivityImproved && committedRoutes <= 0
      ? 'DRC worsened and no target/global connectivity progress was committed.'
      : 'Placement may be kept for review.',
    drcWorsened,
    connectivityImproved,
    committedRoutes,
  }
}

export function evaluatePlacementAcceptanceGate({ candidate = {}, gain = {}, precheck = {}, drcBefore = {}, drcAfter = {}, catastrophicDrcErrorDelta = 25 } = {}) {
  const beforeErrors = Number(drcBefore.errors ?? 0)
  const afterErrors = Number(drcAfter.errors ?? beforeErrors)
  const drcDelta = afterErrors - beforeErrors
  const severeGeometryFailure = Number(precheck.offBoard || 0) > 0
    || Number(precheck.mountingHoleConflicts || 0) > 0
    || Number(precheck.componentOverlaps || 0) > 40
  const corridorGain = Boolean(gain.improved)
    || Number(gain.viaArraySitesAfter || 0) > Number(gain.viaArraySitesBefore || 0)
    || gain.routeFeasibilityAfter === true && gain.routeFeasibilityBefore !== true
  const accepted = !severeGeometryFailure && corridorGain && drcDelta <= catastrophicDrcErrorDelta
  return {
    candidate: candidate.id || null,
    accepted,
    decision: accepted ? 'keep_as_working_candidate_not_final_release' : 'reject_or_mutate_before_routing',
    corridorGain,
    severeGeometryFailure,
    drcDelta,
    reason: accepted
      ? 'Placement creates measurable corridor gain and does not catastrophically worsen DRC; keep it for route trials.'
      : severeGeometryFailure
        ? 'Placement creates severe geometry/mechanical failure.'
        : corridorGain
          ? 'Placement DRC regression exceeds working-candidate budget.'
          : 'Placement does not create measurable corridor gain.',
  }
}

export function evaluateRoutingAcceptanceGate({ before = {}, after = {}, verifier = {}, forbiddenVias = 0, catastrophicDrcErrorDelta = 25 } = {}) {
  const beforeErrors = Number(before.errors ?? 0)
  const afterErrors = Number(after.errors ?? beforeErrors)
  const drcDelta = afterErrors - beforeErrors
  const targetUnconnectedImproved = Number(verifier.targetUnconnectedAfter ?? verifier.targetUnconnectedBefore ?? 0) < Number(verifier.targetUnconnectedBefore ?? 0)
  const globalUnconnectedImproved = Number(after.unconnected ?? before.unconnected ?? 0) < Number(before.unconnected ?? 0)
  const netIslandsImproved = Number(verifier.netIslandsAfter ?? verifier.netIslandsBefore ?? 0) < Number(verifier.netIslandsBefore ?? 0)
  const connectionCompleted = verifier.connectionCompleted === true
  const connectivityImproved = targetUnconnectedImproved || globalUnconnectedImproved || netIslandsImproved || connectionCompleted
  const accepted = connectivityImproved && Number(forbiddenVias || 0) === 0 && drcDelta <= catastrophicDrcErrorDelta
  return {
    accepted,
    decision: accepted ? 'commit_route_bundle' : 'rollback_route_bundle_continue_loop',
    connectivityImproved,
    targetUnconnectedImproved,
    globalUnconnectedImproved,
    netIslandsImproved,
    connectionCompleted,
    drcDelta,
    forbiddenVias,
    reason: accepted
      ? 'Route bundle made measurable connectivity progress without forbidden vias or catastrophic DRC regression.'
      : !connectivityImproved
        ? 'Route bundle did not prove target/global connectivity progress.'
        : Number(forbiddenVias || 0)
          ? 'Route bundle used forbidden via type.'
          : 'Route bundle DRC regression exceeded routing budget.',
  }
}

export function createWorkingCandidateStack({ optimizerResult = {}, maxPerNet = 3 } = {}) {
  const workingCandidates = []
  for (const netResult of optimizerResult.results || optimizerResult.nets || []) {
    const candidates = (netResult.topCandidates?.length ? netResult.topCandidates : [netResult.selected]).filter(Boolean).slice(0, maxPerNet)
    for (const selected of candidates) {
      workingCandidates.push({
        net: netResult.net,
        candidate: selected.candidate?.id || selected.id,
        status: 'placement_kept_for_routing_trials',
        moves: selected.candidate?.moves || selected.moves || [],
        gain: selected.gain || null,
        score: selected.score || 0,
        source: netResult.source,
        target: netResult.target,
        routeStrategiesTried: [],
      })
    }
  }
  return {
    status: workingCandidates.length ? 'ESC_WORKING_CANDIDATE_STACK_READY' : 'ESC_WORKING_CANDIDATE_STACK_EMPTY',
    workingCandidates: workingCandidates.slice(0, maxPerNet * Math.max(1, new Set(workingCandidates.map((item) => item.net)).size)),
  }
}

export function buildEscRouteStrategySet({ net, candidate = {}, maxStrategies = 10 } = {}) {
  const isVbat = /VBAT|VIN|BATT/i.test(net || '')
  const base = isVbat
    ? [
        'f_cu_wide_escape',
        'b_cu_wide_escape',
        'f_escape_via_array_in2_zone',
        'b_escape_via_array_in2_zone',
        'in2_vbat_zone_with_local_escapes',
        'dogleg_wide_route',
        'combined_c1_j1_move_in2_route',
        'local_blocker_move_in2_via_array',
        'c1_rotation_in2_via_array',
        'j1_inward_shift_in2_via_array',
      ]
    : [
        'wide_f_cu_phase_route',
        'wide_b_cu_phase_route',
        'f_b_dogleg_phase_route',
        'through_via_array_inner_assist',
        'phase_zone_pour',
        'q14_q16_cluster_move_route',
        'j5_motor_output_inside_outline_route',
        'd10_d11_c70_c71_blocker_move_route',
        'q14_q16_j5_coordinated_move_route',
        'mixed_wide_route_via_array_bundle',
      ]
  return base.slice(0, maxStrategies).map((strategy, index) => ({
    id: `${safeId(net)}-${strategy}`,
    net,
    strategy,
    placementCandidate: candidate.candidate || candidate.id || null,
    layers: strategy.includes('in2') || strategy.includes('inner') || strategy.includes('via_array')
      ? (isVbat ? ['F.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'In2.Cu', 'B.Cu'])
      : strategy.startsWith('b_') || strategy.includes('_b_') ? ['B.Cu'] : ['F.Cu'],
    throughViasPlanned: strategy.includes('via_array') || strategy.includes('inner') ? (isVbat ? 8 : 6) : 0,
    forbiddenVias: 0,
    priority: index + 1,
  }))
}

export function verifyConnectivityProgress({ net, before = {}, after = {}, graphBefore = {}, graphAfter = {}, targetPadGroupConnected = false } = {}) {
  const targetBefore = Number(before.byNet?.[net]?.unconnected ?? graphBefore.byNet?.[net]?.unconnected ?? before.targetUnconnected ?? 0)
  const targetAfter = Number(after.byNet?.[net]?.unconnected ?? graphAfter.byNet?.[net]?.unconnected ?? after.targetUnconnected ?? targetBefore)
  const islandsBefore = Number(graphBefore.byNet?.[net]?.islands ?? before.netIslands ?? 0)
  const islandsAfter = Number(graphAfter.byNet?.[net]?.islands ?? after.netIslands ?? islandsBefore)
  const globalBefore = Number(before.unconnected ?? 0)
  const globalAfter = Number(after.unconnected ?? globalBefore)
  return {
    net,
    targetUnconnectedBefore: targetBefore,
    targetUnconnectedAfter: targetAfter,
    netIslandsBefore: islandsBefore,
    netIslandsAfter: islandsAfter,
    globalUnconnectedBefore: globalBefore,
    globalUnconnectedAfter: globalAfter,
    connectionCompleted: Boolean(targetPadGroupConnected),
    boardForgeKiCadAgreement: targetAfter <= targetBefore && globalAfter <= globalBefore,
    staleStateSuspected: targetAfter < targetBefore && globalAfter === globalBefore,
  }
}

export function runEscAutonomousRoutingConvergence({
  optimizerResult = {},
  initialDrc = {},
  routeEvaluator = null,
  maxRouteStrategiesPerPlacement = 10,
  mutationRounds = 5,
} = {}) {
  const stack = createWorkingCandidateStack({ optimizerResult, maxPerNet: 3 })
  const nets = ['/VBAT_RAW', '/M2_C_SW']
  const attempts = []
  const committed = []
  let stoppedEarly = false
  for (const net of nets) {
    const candidates = stack.workingCandidates.filter((item) => normalizeNetName(item.net) === normalizeNetName(net))
    for (const candidate of candidates) {
      const strategies = buildEscRouteStrategySet({ net, candidate, maxStrategies: maxRouteStrategiesPerPlacement })
      for (const strategy of strategies) {
        const evaluated = routeEvaluator
          ? routeEvaluator({ net, candidate, strategy, before: initialDrc })
          : { before: initialDrc, after: initialDrc, verifier: verifyConnectivityProgress({ net, before: initialDrc, after: initialDrc }), forbiddenVias: strategy.forbiddenVias }
        const gate = evaluateRoutingAcceptanceGate(evaluated)
        const attempt = { net, candidate: candidate.candidate, strategy: strategy.id, layers: strategy.layers, throughVias: strategy.throughViasPlanned, gate, before: evaluated.before, after: evaluated.after, verifier: evaluated.verifier }
        attempts.push(attempt)
        candidate.routeStrategiesTried.push(attempt)
        if (gate.accepted) {
          committed.push(attempt)
          break
        }
      }
      if (committed.some((item) => normalizeNetName(item.net) === normalizeNetName(net))) break
    }
  }
  const unresolved = nets.filter((net) => !committed.some((item) => normalizeNetName(item.net) === normalizeNetName(net)))
  return {
    status: unresolved.length ? 'AUTONOMOUS_CONVERGENCE_BUDGET_EXHAUSTED_WITH_PROOF' : 'VBAT_M2_ROUTING_PROGRESS_COMMITTED',
    implemented: true,
    nets,
    stoppedEarly,
    mutationRounds,
    workingCandidateStack: stack,
    placementCandidatesTried: stack.workingCandidates.length,
    routeStrategiesTried: attempts.length,
    attempts,
    committed,
    unresolved,
  }
}

export function normalizeDrcBaseline(report = {}) {
  const body = report.report || report
  const violations = body.violations || []
  const unconnected = body.unconnected_items || []
  const counts = {
    errors: Number(body.issueCounts?.errors ?? violations.filter((item) => String(item.severity || '').toLowerCase() !== 'warning').length),
    warnings: Number(body.issueCounts?.warnings ?? violations.filter((item) => String(item.severity || '').toLowerCase() === 'warning').length),
    unconnected: Number(body.issueCounts?.unconnected ?? unconnected.length),
  }
  return {
    counts,
    parser: 'BoardForge normalized DRC parser: KiCad violations and unconnected_items are counted separately.',
    staleCountExplanation: unconnected.length
      ? 'Older aggregate counts included unconnected_items with KiCad DRC violations; normalized counts keep them separate for routing gates.'
      : 'Fresh KiCad report did not include unconnected_items; use the latest BoardForge connectivity report for unconnected routing gates.',
  }
}

export function evaluateCorridorGain({ geometries = [], corridor = {}, moves = [], boardBox = null, baseline = null }) {
  const moved = applyDryRunMoves(geometries, moves)
  const before = baseline || corridorMetrics({ geometries, corridor, boardBox })
  const after = corridorMetrics({ geometries: moved, corridor: movedCorridor(corridor, moves), boardBox })
  return {
    net: corridor.net,
    blockerCountBefore: before.blockerCount,
    blockerCountAfter: after.blockerCount,
    minimumCorridorWidthBeforeMm: before.minimumCorridorWidthMm,
    minimumCorridorWidthAfterMm: after.minimumCorridorWidthMm,
    viaArraySitesBefore: before.viaArraySites,
    viaArraySitesAfter: after.viaArraySites,
    routeFeasibilityBefore: before.routeFeasible,
    routeFeasibilityAfter: after.routeFeasible,
    improved: after.blockerCount < before.blockerCount
      || after.minimumCorridorWidthMm > before.minimumCorridorWidthMm
      || after.viaArraySites > before.viaArraySites
      || (after.routeFeasible && !before.routeFeasible),
  }
}

export function generateMoveMutationsForNet({ net, sourceRef, targetRef, blockerRefs = [], maxMoveDistanceMm = 4, allowRotation = true, allowConnectorMoveInsideOutline = true } = {}) {
  const refs = [...new Set([sourceRef, targetRef, ...blockerRefs].filter(Boolean))]
    .filter((ref) => allowConnectorMoveInsideOutline || !/^J\d+/i.test(ref))
  const distances = []
  for (let amount = 0.25; amount <= maxMoveDistanceMm + 0.001; amount += 0.25) distances.push(round(amount))
  const directions = ['up', 'down', 'left', 'right']
  const candidates = []
  for (const ref of refs) {
    if (!allowConnectorMoveInsideOutline && /^J\d+/i.test(ref)) continue
    for (const amount of distances) {
      for (const direction of directions) {
        candidates.push(targetedCandidate(`optimizer-${safeId(net)}-${ref}-${direction}-${String(amount).replace('.', 'p')}`, [directionalMove(ref, direction, amount)], { blocks: [net], blockTypes: ['optimizer_mutation'] }, `Move ${ref} ${direction} ${amount}mm for ${net}.`))
      }
      if (allowRotation && !/^J\d+/i.test(ref)) {
        for (const rotation of [90, 180, 270]) candidates.push(targetedCandidate(`optimizer-${safeId(net)}-${ref}-rot-${rotation}-${String(amount).replace('.', 'p')}`, [{ ref, dx: 0, dy: 0, rotation, reason: `rotate ${ref} to improve ${net} corridor` }], { blocks: [net], blockTypes: ['optimizer_rotation'] }, `Rotate ${ref} for ${net}.`))
      }
    }
  }
  for (const amount of distances.slice(1, 9)) {
    const local = refs.slice(0, 5)
    if (local.length > 1) candidates.push(targetedCandidate(`optimizer-${safeId(net)}-cluster-left-${String(amount).replace('.', 'p')}`, local.map((ref, index) => directionalMove(ref, index % 2 ? 'up' : 'left', amount)), { blocks: [net], blockTypes: ['optimizer_cluster'] }, `Move local ${net} blocker cluster.`))
  }
  return candidates.map((candidate) => ({ ...candidate, movedRefs: candidate.moves.map((move) => move.ref), moveCount: candidate.moves.length }))
}

export function optimizePriorityEscCorridors({ geometries = [], boardBox, corridors = [], activeTargetNets = ['/VBAT_RAW', '/M2_C_SW'], maxCandidateBatches = 10, maxCandidatesPerBatch = 50, maxMoveDistanceMm = 4, allowRotation = true, allowConnectorMoveInsideOutline = true } = {}) {
  const results = []
  for (const target of activeTargetNets) {
    const corridor = corridors.find((item) => normalizeNetName(item.net) === normalizeNetName(target))
    if (!corridor) continue
    const baselineMetric = corridorMetrics({ geometries, corridor, boardBox })
    const blockerRefs = baselineMetric.blockers.map((item) => item.ref)
    const all = generateMoveMutationsForNet({ net: corridor.net, sourceRef: corridor.sourceRef, targetRef: corridor.targetRef, blockerRefs, maxMoveDistanceMm, allowRotation, allowConnectorMoveInsideOutline })
    let tested = 0
    let selected = null
    const acceptedCandidates = []
    const batches = []
    for (let batchIndex = 0; batchIndex < maxCandidateBatches && !selected; batchIndex += 1) {
      const batch = all.slice(batchIndex * maxCandidatesPerBatch, (batchIndex + 1) * maxCandidatesPerBatch)
      const evaluated = batch.map((candidate) => {
        const precheck = precheckPlacementGeometry({ geometries, moves: candidate.moves, boardBox, highCurrentCorridors: corridors, baselinePrecheck: precheckPlacementGeometry({ geometries, boardBox, highCurrentCorridors: corridors }) })
        const gain = evaluateCorridorGain({ geometries, corridor, moves: candidate.moves, boardBox, baseline: baselineMetric })
        const score = scoreOptimizerCandidate(candidate, precheck, gain)
        return { candidate, precheck, gain, score, writeToKicad: precheck.decision !== 'reject_before_kicad_write' && gain.improved }
      })
      tested += evaluated.length
      batches.push({ batch: batchIndex + 1, candidates: evaluated.length, accepted: evaluated.filter((item) => item.writeToKicad).length })
      acceptedCandidates.push(...evaluated.filter((item) => item.writeToKicad))
      selected = evaluated.filter((item) => item.writeToKicad).sort((a, b) => b.score - a.score)[0] || null
    }
    results.push({
      net: corridor.net,
      source: corridor.sourceRef,
      target: corridor.targetRef,
      baseline: baselineMetric,
      batches,
      candidatesTested: tested,
      selected,
      topCandidates: acceptedCandidates.sort((a, b) => b.score - a.score).slice(0, 3),
      status: selected ? 'PRIORITY_CORRIDOR_OPTIMIZER_CANDIDATE_READY' : 'PRIORITY_CORRIDOR_OPTIMIZER_NO_LEGAL_GAIN',
    })
  }
  return {
    status: results.some((item) => item.selected) ? 'PRIORITY_ESC_CORRIDOR_OPTIMIZER_READY' : 'PRIORITY_ESC_CORRIDOR_OPTIMIZER_BLOCKED',
    activeTargetNets,
    maxCandidateBatches,
    maxCandidatesPerBatch,
    results,
  }
}

export function simulateTargetedMove({ candidate, geometries = [], boardBox, highCurrentCorridors = [], baselinePrecheck = null }) {
  const precheck = precheckPlacementGeometry({ geometries, moves: candidate.moves, boardBox, highCurrentCorridors, baselinePrecheck })
  return { candidate, precheck, score: scoreGeometryAwareCandidate(candidate, precheck), dryRun: true, writeToKicad: precheck.decision !== 'reject_before_kicad_write' }
}

export function scoreGeometryAwareCandidate(candidate = {}, precheck = {}) {
  let score = Number(candidate.routabilityScore || candidate.score || 0)
  score -= precheck.offBoard * 100
  score -= precheck.mountingHoleConflicts * 80
  score -= precheck.componentOverlaps * 12
  score -= precheck.courtyardOverlaps * 4
  score -= precheck.highCurrentCorridorBlocks * 3
  score -= precheck.senseKeepawayViolations * 8
  score -= Math.min(60, (candidate.moves || []).length * 0.25)
  if (precheck.decision === 'reject_before_kicad_write') score -= 500
  return round(score)
}

function targetedCandidate(id, moves, blocker, reason) {
  return {
    id,
    strategy: 'targeted_geometry_blocker_move',
    moves,
    reason,
    corridorsOpened: blocker.blocks || [],
    blockerTypes: blocker.blockTypes || [],
    fixedPartsPreserved: ['board outline', 'required nets', 'required components'],
    boardOutlineChanged: false,
    usesApprovedInternalLayers: true,
    routabilityScore: 65 - moves.length * 4,
  }
}

function blockerScore(blocker = {}) {
  let score = 0
  score += (blocker.blocks || []).length * 25
  if ((blocker.blocks || []).some((net) => /VBAT|VIN|BATT/i.test(net))) score += 30
  if ((blocker.blocks || []).some((net) => /SW|M\d|PHASE|MOTOR/i.test(net))) score += 20
  if ((blocker.blockTypes || []).includes('corridor_obstruction')) score += 25
  if (blocker.risk === 'high') score -= 15
  if (blocker.risk === 'fixed') score -= 1000
  return score
}

function allowedMoveDirections(blocker = {}) {
  if (blocker.risk === 'fixed') return []
  const dirs = ['up', 'left', 'right', 'down']
  if (blocker.position?.y > 95) return ['up', 'left', 'right']
  if (blocker.position?.x > 140) return ['left', 'up', 'down']
  if (blocker.position?.x < 125) return ['right', 'up', 'down']
  return dirs
}

function directionalMove(ref, direction, amount) {
  const delta = {
    up: { dx: 0, dy: -amount },
    down: { dx: 0, dy: amount },
    left: { dx: -amount, dy: 0 },
    right: { dx: amount, dy: 0 },
  }[direction] || { dx: 0, dy: -amount }
  return { ref, dx: round(delta.dx), dy: round(delta.dy), reason: `targeted ${direction} blocker move` }
}

function moveAwayFromSegment(ref, position, source, target, amount) {
  if (!position) return null
  const dx = target.x - source.x
  const dy = target.y - source.y
  const length = Math.max(0.001, Math.hypot(dx, dy))
  const normal = { x: -dy / length, y: dx / length }
  const side = Math.sign((position.x - source.x) * normal.x + (position.y - source.y) * normal.y) || 1
  return { ref, dx: round(normal.x * amount * side), dy: round(normal.y * amount * side), reason: 'targeted via/corridor escape move' }
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'net'
}

function normalizeNetName(value) {
  const text = String(value || '').trim()
  return text.startsWith('/') ? text : `/${text}`
}

function firstPriorityTarget(nets = [], activeTargetNets = []) {
  const opened = nets.map(normalizeNetName)
  return activeTargetNets.find((target) => opened.includes(normalizeNetName(target))) || null
}

function targetRank(target, activeTargetNets = []) {
  const index = activeTargetNets.map(normalizeNetName).indexOf(normalizeNetName(target))
  return index < 0 ? 999 : index
}

function movedCorridor(corridor = {}, moves = []) {
  const byRef = new Map(moves.map((move) => [move.ref, move]))
  const patch = (point, ref) => {
    const move = byRef.get(ref)
    if (!move) return point
    return { ...point, x: round(Number(point.x || 0) + Number(move.dx || 0)), y: round(Number(point.y || 0) + Number(move.dy || 0)) }
  }
  return {
    ...corridor,
    source: patch(corridor.source || {}, corridor.sourceRef),
    target: patch(corridor.target || {}, corridor.targetRef),
  }
}

function corridorMetrics({ geometries = [], corridor = {}, boardBox = null }) {
  const source = corridor.source || {}
  const target = corridor.target || {}
  const endpointRefs = new Set([corridor.sourceRef, corridor.targetRef].filter(Boolean))
  const required = Number(corridor.widthMm || 1.2)
  const blocks = geometries
    .filter((item) => !item.isMechanical && !endpointRefs.has(item.ref))
    .filter((item) => boxIntersectsSegment(item.maxExtentBox, source, target, required))
    .map((item) => ({ ref: item.ref, distanceMm: round(distancePointToSegment(item.position || centerOfBox(item.maxExtentBox), source, target)) }))
  const minDistance = blocks.length ? Math.min(...blocks.map((item) => item.distanceMm)) : required
  const width = round(Math.max(0, Math.min(required, minDistance * 2)))
  const viaArraySites = [source, target].filter((point) => hasViaArrayRoom(point, geometries, endpointRefs, boardBox)).length
  return {
    blockerCount: blocks.length,
    blockers: blocks,
    minimumCorridorWidthMm: width,
    viaArraySites,
    routeFeasible: blocks.length === 0 && viaArraySites >= 1,
  }
}

function hasViaArrayRoom(point, geometries = [], endpointRefs = new Set(), boardBox = null) {
  if (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return false
  const box = centerBox(Number(point.x), Number(point.y), 2.4, 2.4)
  if (boardBox && !boxInside(box, boardBox, 0.2)) return false
  return !geometries.some((item) => !endpointRefs.has(item.ref) && !item.isMechanical && boxesOverlap(item.maxExtentBox, box, 0.1))
}

function scoreOptimizerCandidate(candidate = {}, precheck = {}, gain = {}) {
  let score = 0
  score += Math.max(0, gain.blockerCountBefore - gain.blockerCountAfter) * 80
  score += Math.max(0, gain.minimumCorridorWidthAfterMm - gain.minimumCorridorWidthBeforeMm) * 30
  score += Math.max(0, gain.viaArraySitesAfter - gain.viaArraySitesBefore) * 35
  if (gain.routeFeasibilityAfter && !gain.routeFeasibilityBefore) score += 120
  score -= Math.max(0, precheck.delta?.componentOverlaps || 0) * 25
  score -= Math.max(0, precheck.delta?.courtyardOverlaps || 0) * 8
  score -= (candidate.moves || []).length * 3
  if (precheck.decision === 'reject_before_kicad_write') score -= 500
  return round(score)
}

function centerOfBox(box = {}) {
  return { x: (Number(box.minX || 0) + Number(box.maxX || 0)) / 2, y: (Number(box.minY || 0) + Number(box.maxY || 0)) / 2 }
}

function distancePointToSegment(point = {}, start = {}, end = {}) {
  const px = Number(point.x || 0)
  const py = Number(point.y || 0)
  const x1 = Number(start.x || 0)
  const y1 = Number(start.y || 0)
  const x2 = Number(end.x || 0)
  const y2 = Number(end.y || 0)
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (!len2) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function parsePads(block, footprint) {
  const pads = []
  const pattern = /\(pad\s+"([^"]+)"\s+([^\s)]+)\s+([^\s)]+)/g
  let match
  while ((match = pattern.exec(block))) {
    const start = match.index
    const end = findClosingParen(block, start)
    if (end < 0) continue
    const body = block.slice(start, end + 1)
    const at = body.match(/\(at\s+([-\d.]+)\s+([-\d.]+)(?:\s+([-\d.]+))?\)/)
    const size = body.match(/\(size\s+([-\d.]+)\s+([-\d.]+)\)/)
    if (!at || !size) continue
    const local = { x: Number(at[1]), y: Number(at[2]) }
    const center = transformPoint(local, footprint.x, footprint.y, footprint.rotation || 0)
    const width = Number(size[1])
    const height = Number(size[2])
    const box = transformedBox(local, width, height, footprint)
    const drill = body.match(/\(drill\s+([-\d.]+)/)
    pads.push({ name: match[1], type: match[2], shape: match[3], x: center.x, y: center.y, widthMm: width, heightMm: height, drillMm: drill ? Number(drill[1]) : null, box })
  }
  return pads
}

function findClosingParen(text, start) {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1
    if (text[index] === ')') depth -= 1
    if (depth === 0) return index
  }
  return -1
}

function layerPrimitiveBox(block, footprint, layerPattern) {
  const points = []
  for (const line of block.matchAll(/\(fp_line[\s\S]*?\(start\s+([-\d.]+)\s+([-\d.]+)\)[\s\S]*?\(end\s+([-\d.]+)\s+([-\d.]+)\)[\s\S]*?\(layer\s+"([^"]+)"/g)) {
    if (!layerPattern.test(line[5])) continue
    points.push(transformPoint({ x: Number(line[1]), y: Number(line[2]) }, footprint.x, footprint.y, footprint.rotation || 0))
    points.push(transformPoint({ x: Number(line[3]), y: Number(line[4]) }, footprint.x, footprint.y, footprint.rotation || 0))
  }
  for (const circle of block.matchAll(/\(fp_circle[\s\S]*?\(center\s+([-\d.]+)\s+([-\d.]+)\)[\s\S]*?\(end\s+([-\d.]+)\s+([-\d.]+)\)[\s\S]*?\(layer\s+"([^"]+)"/g)) {
    if (!layerPattern.test(circle[5])) continue
    const center = transformPoint({ x: Number(circle[1]), y: Number(circle[2]) }, footprint.x, footprint.y, footprint.rotation || 0)
    const edge = transformPoint({ x: Number(circle[3]), y: Number(circle[4]) }, footprint.x, footprint.y, footprint.rotation || 0)
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y)
    points.push({ x: center.x - radius, y: center.y - radius }, { x: center.x + radius, y: center.y + radius })
  }
  return points.length ? pointsBox(points) : null
}

function transformGeometry(geometry, dx, dy, rotationDelta, finalRotation) {
  const origin = geometry.position
  const transformBox = (box) => box ? pointsBox(boxCorners(box).map((point) => rotateAround(point, origin, rotationDelta)).map((point) => ({ x: round(point.x + dx), y: round(point.y + dy) }))) : null
  return {
    ...geometry,
    position: { x: round(origin.x + dx), y: round(origin.y + dy) },
    rotation: finalRotation,
    bodyBox: transformBox(geometry.bodyBox),
    padBox: transformBox(geometry.padBox),
    courtyardBox: transformBox(geometry.courtyardBox),
    silkscreenBox: transformBox(geometry.silkscreenBox),
    fabBox: transformBox(geometry.fabBox),
    holeBox: transformBox(geometry.holeBox),
    maxExtentBox: transformBox(geometry.maxExtentBox),
    pads: geometry.pads.map((pad) => ({ ...pad, ...movePoint(rotateAround({ x: pad.x, y: pad.y }, origin, rotationDelta), dx, dy), box: transformBox(pad.box) })),
    drills: geometry.drills.map((drill) => ({ ...drill, ...movePoint(rotateAround({ x: drill.x, y: drill.y }, origin, rotationDelta), dx, dy), box: transformBox(drill.box) })),
  }
}

function transformedBox(localCenter, width, height, footprint) {
  return pointsBox([
    { x: localCenter.x - width / 2, y: localCenter.y - height / 2 },
    { x: localCenter.x + width / 2, y: localCenter.y - height / 2 },
    { x: localCenter.x + width / 2, y: localCenter.y + height / 2 },
    { x: localCenter.x - width / 2, y: localCenter.y + height / 2 },
  ].map((point) => transformPoint(point, footprint.x, footprint.y, footprint.rotation || 0)))
}

function transformPoint(point, x, y, rotationDeg) {
  const angle = rotationDeg * Math.PI / 180
  return { x: round(x + point.x * Math.cos(angle) - point.y * Math.sin(angle)), y: round(y + point.x * Math.sin(angle) + point.y * Math.cos(angle)) }
}

function rotateAround(point, origin, rotationDeg) {
  const angle = rotationDeg * Math.PI / 180
  const x = point.x - origin.x
  const y = point.y - origin.y
  return { x: origin.x + x * Math.cos(angle) - y * Math.sin(angle), y: origin.y + x * Math.sin(angle) + y * Math.cos(angle) }
}

function movePoint(point, dx, dy) {
  return { x: round(point.x + dx), y: round(point.y + dy) }
}

function centerBox(x, y, width, height) {
  return { minX: round(x - width / 2), minY: round(y - height / 2), maxX: round(x + width / 2), maxY: round(y + height / 2) }
}

function pointsBox(points) {
  return { minX: round(Math.min(...points.map((p) => p.x))), minY: round(Math.min(...points.map((p) => p.y))), maxX: round(Math.max(...points.map((p) => p.x))), maxY: round(Math.max(...points.map((p) => p.y))) }
}

function boxCorners(box) {
  return [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }]
}

function unionBoxes(boxes) {
  const valid = boxes.filter(Boolean)
  return valid.length ? { minX: round(Math.min(...valid.map((b) => b.minX))), minY: round(Math.min(...valid.map((b) => b.minY))), maxX: round(Math.max(...valid.map((b) => b.maxX))), maxY: round(Math.max(...valid.map((b) => b.maxY))) } : null
}

function expandBox(box, amount) {
  return box ? { minX: round(box.minX - amount), minY: round(box.minY - amount), maxX: round(box.maxX + amount), maxY: round(box.maxY + amount) } : null
}

function boxesOverlap(a, b, clearance = 0) {
  return Boolean(a && b) && !(a.maxX + clearance <= b.minX || b.maxX + clearance <= a.minX || a.maxY + clearance <= b.minY || b.maxY + clearance <= a.minY)
}

function boxInside(box, outer, clearance = 0) {
  return Boolean(box && outer) && box.minX >= outer.minX + clearance && box.maxX <= outer.maxX - clearance && box.minY >= outer.minY + clearance && box.maxY <= outer.maxY - clearance
}

function boxIntersectsSegment(box, source, target, widthMm) {
  const expanded = expandBox(box, widthMm / 2)
  const minX = Math.min(source.x, target.x)
  const maxX = Math.max(source.x, target.x)
  const minY = Math.min(source.y, target.y)
  const maxY = Math.max(source.y, target.y)
  return boxesOverlap(expanded, { minX, minY, maxX, maxY }, 0)
}
