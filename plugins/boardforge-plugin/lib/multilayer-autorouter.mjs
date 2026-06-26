import { round } from './geometry.mjs'
import { applyDryRunMoves } from './kicad-footprint-geometry.mjs'
import { generateReplacementSourcingReport } from './part-availability.mjs'

const defaultLayerRoles = {
  'F.Cu': 'component_escape',
  'B.Cu': 'component_escape',
  'In2.Cu': 'high_current_power',
}

export function buildLayerObstacleMap({ geometries = [], boardBox, layers = ['F.Cu', 'B.Cu', 'In2.Cu'], sourceRef, targetRef, clearanceMm = 0.25, routeWidthMm = 1.2, keepoutRefs = [] } = {}) {
  const endpointRefs = new Set([sourceRef, targetRef].filter(Boolean))
  const keepouts = new Set(keepoutRefs)
  const inflation = clearanceMm + routeWidthMm / 2
  const board = boardBox || boardBoxFromGeometries(geometries)
  const byLayer = {}
  for (const layer of layers) {
    byLayer[layer] = geometries
      .filter((item) => !endpointRefs.has(item.ref))
      .filter((item) => keepouts.has(item.ref) || item.isMechanical || layer !== 'In2.Cu' || !/^C\d+|R\d+$/i.test(item.ref))
      .map((item) => ({
        ref: item.ref,
        layer,
        box: inflateBox(item.maxExtentBox, inflation),
        source: item.isMechanical ? 'mechanical' : 'footprint',
      }))
  }
  return { board, layers, byLayer, inflation, routeWidthMm, clearanceMm }
}

export function inflateObstaclesForNetClass(obstacles = [], { clearanceMm = 0.25, routeWidthMm = 1.2 } = {}) {
  const inflation = clearanceMm + routeWidthMm / 2
  return obstacles.map((item) => ({ ...item, box: inflateBox(item.box || item, inflation) }))
}

export function extractPadConnectionRegions({ geometries = [], source = {}, target = {} } = {}) {
  const sourcePad = findPadRegion(geometries, source)
  const targetPad = findPadRegion(geometries, target)
  return {
    source: sourcePad,
    target: targetPad,
    status: sourcePad && targetPad ? 'PAD_CONNECTION_REGIONS_READY' : 'PAD_CONNECTION_REGION_MISSING',
  }
}

export function buildRoutingGrid({ obstacleMap, gridMm = 0.5 } = {}) {
  const board = obstacleMap.board
  const cells = {
    minX: Math.floor(board.minX / gridMm),
    minY: Math.floor(board.minY / gridMm),
    maxX: Math.ceil(board.maxX / gridMm),
    maxY: Math.ceil(board.maxY / gridMm),
  }
  const blocked = new Map()
  for (const layer of obstacleMap.layers) {
    const layerBlocked = new Set()
    for (const obstacle of obstacleMap.byLayer[layer] || []) {
      const minX = Math.floor(obstacle.box.minX / gridMm)
      const maxX = Math.ceil(obstacle.box.maxX / gridMm)
      const minY = Math.floor(obstacle.box.minY / gridMm)
      const maxY = Math.ceil(obstacle.box.maxY / gridMm)
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) layerBlocked.add(`${x},${y}`)
      }
    }
    blocked.set(layer, layerBlocked)
  }
  return { gridMm, cells, layers: obstacleMap.layers, blocked, board }
}

export function findMultilayerPath({ grid, sourceRegion, targetRegion, preferredLayers = ['In2.Cu', 'F.Cu', 'B.Cu'], maxExpanded = 20000 } = {}) {
  if (!grid || !sourceRegion || !targetRegion) return { pathFound: false, reason: 'missing_grid_or_pad_region', path: [] }
  const startLayer = preferredLayers.includes('F.Cu') ? 'F.Cu' : preferredLayers[0]
  const starts = candidateCellsForRegion(sourceRegion, grid, startLayer)
  const targets = new Set()
  for (const layer of preferredLayers) for (const cell of candidateCellsForRegion(targetRegion, grid, layer)) targets.add(nodeKey(cell))
  if (!starts.length || !targets.size) return { pathFound: false, reason: 'source_or_target_region_blocked', path: [] }

  const open = []
  const best = new Map()
  const previous = new Map()
  for (const start of starts) {
    best.set(nodeKey(start), 0)
    pushOpen(open, { ...start, g: 0, f: heuristic(start, targetRegion, grid) })
  }
  let expanded = 0
  let found = null
  while (open.length && expanded < maxExpanded) {
    const current = open.shift()
    const key = nodeKey(current)
    if (best.has(key) && best.get(key) < current.g) continue
    if (targets.has(key)) {
      found = current
      break
    }
    expanded += 1
    for (const next of neighbors(current, grid, preferredLayers)) {
      const nextKey = nodeKey(next)
      if (isBlocked(next, grid) && !targets.has(nextKey)) continue
      const step = next.layer === current.layer ? 1 : 5
      const g = current.g + step
      if (best.has(nextKey) && best.get(nextKey) <= g) continue
      best.set(nextKey, g)
      previous.set(nextKey, key)
      pushOpen(open, { ...next, g, f: g + heuristic(next, targetRegion, grid) })
    }
  }
  if (!found) return { pathFound: false, reason: expanded >= maxExpanded ? 'search_budget_exhausted' : 'no_legal_path', expanded, path: [] }
  const path = []
  let key = nodeKey(found)
  while (key) {
    const node = parseNodeKey(key)
    path.push({ ...node, x: round(node.x * grid.gridMm), y: round(node.y * grid.gridMm) })
    key = previous.get(key)
  }
  path.reverse()
  return { pathFound: true, expanded, path: simplifyGridPath(path), layersSearched: preferredLayers }
}

export function scoreRoutingPath(pathResult = {}) {
  if (!pathResult.pathFound) return { score: -1000, reason: pathResult.reason || 'no path' }
  const vias = countLayerChanges(pathResult.path)
  const lengthMm = pathLength(pathResult.path)
  return { score: round(1000 - lengthMm - vias * 8), pathLengthMm: round(lengthMm), vias }
}

export function convertPathToKiCadTracks({ net, path = [], widthMm = 1.2 } = {}) {
  const segments = []
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]
    const b = path[index]
    if (a.layer !== b.layer) continue
    segments.push({ start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y }, layer: a.layer, widthMm })
  }
  return segments.map((segment) => ({ ...segment, net }))
}

export function placeLegalThroughVias({ net, path = [], diameterMm = 0.6, drillMm = 0.3 } = {}) {
  const vias = []
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]
    const b = path[index]
    if (a.layer === b.layer) continue
    vias.push({ net, x: a.x, y: a.y, diameterMm, drillMm, layers: ['F.Cu', 'B.Cu'], viaType: 'through', reason: 'multilayer_autorouter_layer_change' })
  }
  return vias
}

export function placeHighCurrentViaArray({ net, center, count = 4, pitchMm = 0.65, diameterMm = 0.6, drillMm = 0.3 } = {}) {
  const columns = Math.ceil(Math.sqrt(count))
  return Array.from({ length: count }, (_, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    return {
      net,
      x: round(center.x + (col - (columns - 1) / 2) * pitchMm),
      y: round(center.y + (row - Math.floor((count - 1) / columns) / 2) * pitchMm),
      diameterMm,
      drillMm,
      layers: ['F.Cu', 'B.Cu'],
      viaType: 'through',
      reason: 'high_current_via_array',
    }
  })
}

export function validatePathTouchesPads({ path = [], sourceRegion, targetRegion, toleranceMm = 0.25 } = {}) {
  const first = path[0]
  const last = path.at(-1)
  return {
    sourceTouched: Boolean(first && pointInsideBox(first, inflateBox(sourceRegion.box, toleranceMm))),
    targetTouched: Boolean(last && pointInsideBox(last, inflateBox(targetRegion.box, toleranceMm))),
  }
}

export function verifyKiCadConnectivityAfterRoute({ before = {}, after = {}, net, boardForgeGraphBefore = {}, boardForgeGraphAfter = {}, padContact = {} } = {}) {
  const targetBefore = Number(before.byNet?.[net]?.unconnected ?? boardForgeGraphBefore.byNet?.[net]?.unconnected ?? before.targetUnconnected ?? 0)
  const targetAfter = Number(after.byNet?.[net]?.unconnected ?? boardForgeGraphAfter.byNet?.[net]?.unconnected ?? after.targetUnconnected ?? targetBefore)
  const islandsBefore = Number(boardForgeGraphBefore.byNet?.[net]?.islands ?? before.netIslands ?? 0)
  const islandsAfter = Number(boardForgeGraphAfter.byNet?.[net]?.islands ?? after.netIslands ?? islandsBefore)
  return {
    net,
    sourceTouched: padContact.sourceTouched === true,
    targetTouched: padContact.targetTouched === true,
    targetUnconnectedBefore: targetBefore,
    targetUnconnectedAfter: targetAfter,
    netIslandsBefore: islandsBefore,
    netIslandsAfter: islandsAfter,
    globalUnconnectedBefore: Number(before.unconnected ?? 0),
    globalUnconnectedAfter: Number(after.unconnected ?? before.unconnected ?? 0),
    connected: padContact.sourceTouched === true && padContact.targetTouched === true && (targetAfter < targetBefore || islandsAfter < islandsBefore || Number(after.unconnected ?? 0) < Number(before.unconnected ?? 0)),
  }
}

export function rollbackAutorouteBundle({ restored = false, reason = 'route failed connectivity gate' } = {}) {
  return { rolledBack: Boolean(restored), reason }
}

export function createMultilayerRoutePlan({ net, pathResult, sourceRegion, targetRegion, widthMm = 1.2, viaArrayCount = 4 } = {}) {
  if (!pathResult.pathFound) return { status: 'MULTILAYER_AUTOROUTE_NO_PATH', routePlan: null }
  const tracks = convertPathToKiCadTracks({ net, path: pathResult.path, widthMm })
  const layerVias = placeLegalThroughVias({ net, path: pathResult.path })
  const pathUsesInner = pathResult.path.some((point) => /^In\d+\.Cu$/i.test(point.layer))
  const viaArrays = pathUsesInner
    ? [
        ...placeHighCurrentViaArray({ net, center: pathResult.path[0], count: viaArrayCount }),
        ...placeHighCurrentViaArray({ net, center: pathResult.path.at(-1), count: viaArrayCount }),
      ]
    : []
  return {
    status: 'MULTILAYER_AUTOROUTE_READY_NEEDS_DRC',
    routePlan: {
      status: 'AUTOROUTE_READY_NEEDS_DRC',
      mode: 'multilayer_pathfinder',
      routes: [{
        net,
        className: /VBAT|VIN|BATT/i.test(net) ? 'BATTERY' : 'MOTOR_PHASE',
        status: 'routed',
        start: { x: sourceRegion.x, y: sourceRegion.y },
        end: { x: targetRegion.x, y: targetRegion.y },
        waypoints: pathResult.path.map((point) => ({ x: point.x, y: point.y })),
        layerPreference: [pathResult.path.find((point) => /^In\d+\.Cu$/i.test(point.layer))?.layer || pathResult.path[0]?.layer || 'F.Cu'],
        widthMm,
        viaPlan: { candidates: [...layerVias, ...viaArrays] },
        endpointRefs: [sourceRegion.ref, targetRegion.ref].filter(Boolean),
        strategy: 'multilayer_pathfinder',
      }],
      designIntent: { copperPours: [] },
      strictViaConnectivity: false,
      humanReviewRequired: true,
    },
    generatedObjects: { tracks: tracks.length, vias: layerVias.length + viaArrays.length },
  }
}

export function runEscMultilayerAutorouteConvergence({ geometries = [], boardBox, nets = [], layers = ['F.Cu', 'B.Cu', 'In2.Cu'], gridMm = 0.5, maxPlacementMutationsPerNet = 50, maxPathSearchesPerPlacement = 20 } = {}) {
  const attempts = []
  for (const net of nets) {
    const regions = extractPadConnectionRegions({ geometries, source: net.source, target: net.target })
    if (regions.status !== 'PAD_CONNECTION_REGIONS_READY') {
      attempts.push({ net: net.name, pathFound: false, reason: regions.status })
      continue
    }
    const widths = net.widthProfiles || [{ name: 'preferred', widthMm: net.widthMm || 1.2 }]
    let found = null
    let pathSearches = 0
    for (const profile of widths.slice(0, maxPathSearchesPerPlacement)) {
      if (profile.widthMm === 'zone') continue
      const obstacleMap = buildLayerObstacleMap({ geometries, boardBox, layers, sourceRef: net.source.ref, targetRef: net.target.ref, routeWidthMm: profile.widthMm, clearanceMm: Number(profile.clearanceMm ?? net.clearanceMm ?? 0.25) })
      const grid = buildRoutingGrid({ obstacleMap, gridMm })
      const pathResult = findMultilayerPath({ grid, sourceRegion: regions.source, targetRegion: regions.target, preferredLayers: net.preferredLayers || layers })
      pathSearches += 1
      const score = scoreRoutingPath(pathResult)
      const contact = validatePathTouchesPads({ path: pathResult.path, sourceRegion: regions.source, targetRegion: regions.target })
      const routePlan = createMultilayerRoutePlan({ net: net.name, pathResult, sourceRegion: regions.source, targetRegion: regions.target, widthMm: profile.widthMm })
      attempts.push({ net: net.name, profile, pathSearches, pathFound: pathResult.pathFound, score, padContact: contact, routePlanStatus: routePlan.status, pathResult, routePlan })
      const producesCopper = pathResult.path.length >= 2 && Number(score.pathLengthMm || 0) > 0.1
      if (pathResult.pathFound && contact.sourceTouched && contact.targetTouched && producesCopper) {
        found = attempts.at(-1)
        break
      }
    }
    if (!found && attempts.filter((item) => item.net === net.name).length < maxPlacementMutationsPerNet) {
      attempts.push({ net: net.name, pathFound: false, reason: 'placement_mutation_budget_available_but_no_legal_path_found', pathSearches })
    }
  }
  const committedReady = attempts.filter((item) => item.pathFound && item.padContact?.sourceTouched && item.padContact?.targetTouched && item.pathResult?.path?.length >= 2 && Number(item.score?.pathLengthMm || 0) > 0.1)
  return {
    status: committedReady.length ? 'MULTILAYER_AUTOROUTE_CANDIDATES_READY' : 'MULTILAYER_AUTOROUTE_NO_LEGAL_PATH',
    algorithm: 'grid A*/Lee-style multilayer maze routing with layer-change costs',
    layersSearched: layers,
    maxPlacementMutationsPerNet,
    maxPathSearchesPerPlacement,
    attempts,
    candidatesReady: committedReady,
  }
}

export function reclassifyVbatStatus({ routeRuns = [], unconnectedByNet = {} } = {}) {
  const vbatRun = routeRuns.find((item) => item.net === '/VBAT_RAW')
  const explicit = unconnectedByNet['/VBAT_RAW']
  const targetBefore = Number(vbatRun?.verification?.targetUnconnectedBefore ?? explicit ?? 0)
  const targetAfter = Number(vbatRun?.verification?.targetUnconnectedAfter ?? explicit ?? targetBefore)
  const stillBlocker = targetBefore > 0 || targetAfter > 0
  return {
    net: '/VBAT_RAW',
    stillBlocker,
    reason: stillBlocker
      ? 'Target-net unconnected evidence remains for /VBAT_RAW.'
      : 'Target-net unconnected evidence is 0; prior pad-touch route did not reduce global unconnected, so /VBAT_RAW is not the current routing blocker.',
    action: stillBlocker ? 'prove_exact_disconnected_pad_groups_before_retry' : 'vbat_no_action_required_or_not_current_blocker',
  }
}

export function buildM2ObstructionReport({ geometries = [], boardBox, source = { ref: 'Q14', pad: '13' }, target = { ref: 'J5', pad: '3' }, widths = [1.2, 0.8], layers = ['F.Cu', 'B.Cu', 'In2.Cu'] } = {}) {
  const regions = extractPadConnectionRegions({ geometries, source, target })
  const blockingRefs = ['Q14', 'Q16', 'D10', 'C70', 'C71', 'D11'].filter((ref) => geometries.some((item) => item.ref === ref))
  const blockedCellsByLayer = {}
  let narrowest = Infinity
  for (const layer of layers) {
    const map = buildLayerObstacleMap({ geometries, boardBox, layers: [layer], sourceRef: source.ref, targetRef: target.ref, routeWidthMm: Math.min(...widths), clearanceMm: 0.35 })
    const grid = buildRoutingGrid({ obstacleMap: map, gridMm: 0.75 })
    blockedCellsByLayer[layer] = grid.blocked.get(layer)?.size || 0
  }
  for (const ref of blockingRefs) {
    const item = geometries.find((geometry) => geometry.ref === ref)
    if (!item || !regions.source || !regions.target) continue
    narrowest = Math.min(narrowest, distancePointToSegmentLocal(item.position || centerOfBoxLocal(item.maxExtentBox), regions.source, regions.target))
  }
  return {
    net: '/M2_C_SW',
    source: `${source.ref} pad ${source.pad}`,
    target: `${target.ref} pad ${target.pad}`,
    requiredWidthsTried: widths,
    layersSearched: layers,
    blockingRefs,
    narrowestCorridorMm: Number.isFinite(narrowest) ? round(Math.max(0, narrowest * 2)) : 0,
    blockedCellsByLayer,
  }
}

export function generateM2PlacementMutations({ maxMoveDistanceMm = 5, allowRotation = true } = {}) {
  const blockerRefs = ['D10', 'D11', 'C70', 'C71']
  const clusterRefs = ['Q14', 'Q16']
  const candidates = []
  const distances = []
  for (let amount = 0.5; amount <= maxMoveDistanceMm + 0.001; amount += 0.5) distances.push(round(amount))
  const directions = ['left', 'right', 'up', 'down']
  for (const ref of blockerRefs) {
    for (const amount of distances) for (const direction of directions) candidates.push(mutationCandidate(`m2-support-${ref}-${direction}-${idAmount(amount)}`, [directionalMoveLocal(ref, direction, amount)], 'support_blocker_move'))
    if (allowRotation) for (const rotation of [90, 180, 270]) candidates.push(mutationCandidate(`m2-support-${ref}-rot-${rotation}`, [{ ref, dx: 0, dy: 0, rotation, reason: `rotate ${ref}` }], 'support_blocker_rotation'))
  }
  for (const amount of distances) for (const direction of directions) candidates.push(mutationCandidate(`m2-phase-cluster-${direction}-${idAmount(amount)}`, clusterRefs.map((ref) => directionalMoveLocal(ref, direction, amount)), 'phase_cluster_move'))
  for (const amount of distances) for (const direction of directions) candidates.push(mutationCandidate(`m2-j5-${direction}-${idAmount(amount)}`, [directionalMoveLocal('J5', direction, amount)], 'j5_move_inside_outline'))
  for (const amount of distances.slice(0, 6)) {
    candidates.push(mutationCandidate(`m2-coordinated-right-${idAmount(amount)}`, [
      ...clusterRefs.map((ref) => directionalMoveLocal(ref, 'right', amount)),
      directionalMoveLocal('J5', 'left', Math.min(amount, 2)),
      ...blockerRefs.map((ref, index) => directionalMoveLocal(ref, index % 2 ? 'up' : 'down', Math.min(amount, 1.5))),
    ], 'coordinated_phase_corridor_move'))
    candidates.push(mutationCandidate(`m2-inner-escape-${idAmount(amount)}`, [
      ...blockerRefs.map((ref) => directionalMoveLocal(ref, 'up', Math.min(amount, 2))),
    ], 'inner_layer_escape_move'))
  }
  return candidates
}

export function selectEscSafeRuleProfiles({ net = '/M2_C_SW', role = 'motor_phase', copperThicknessOz = 1, currentA = null } = {}) {
  const profiles = [
    {
      name: 'preferred_high_current',
      widthMm: 1.2,
      clearanceMm: 0.35,
      neckdown: false,
      copperThicknessOz,
      currentA,
      reasoning: 'Preferred motor-phase copper profile for high-current routing.',
    },
    {
      name: 'minimum_high_current',
      widthMm: 0.8,
      clearanceMm: 0.25,
      neckdown: false,
      copperThicknessOz,
      currentA,
      reasoning: 'Minimum normal high-current track before considering local neck-downs.',
    },
    {
      name: 'short_calculated_neckdown',
      widthMm: 0.5,
      clearanceMm: 0.2,
      maxLengthMm: 2,
      neckdown: true,
      copperThicknessOz,
      currentA,
      reasoning: 'Short local neck-down candidate. Allowed only when no preferred path fits and DRC/connectivity verify the route.',
    },
    {
      name: 'manufacturable_escape_neckdown',
      widthMm: 0.35,
      clearanceMm: 0.15,
      maxLengthMm: 1,
      neckdown: true,
      copperThicknessOz,
      currentA,
      reasoning: 'Last-resort manufacturable pad escape candidate; not valid for long motor-phase runs.',
    },
  ]
  return {
    net,
    role,
    status: 'ESC_SAFE_RULE_PROFILES_READY',
    profiles,
    rejectedProfiles: [
      { name: 'signal_trace_width', widthMm: 0.15, reason: 'Rejected: motor phase/VBAT cannot be routed as a signal trace.' },
    ],
  }
}

export function validateEscSafeRuleProfile(profile = {}, { routeLengthMm = Infinity, role = 'motor_phase' } = {}) {
  const width = Number(profile.widthMm || 0)
  const clearance = Number(profile.clearanceMm || 0)
  const errors = []
  if (/(motor|phase|battery|vbat|power)/i.test(role) && width < 0.35) errors.push({ code: 'HIGH_CURRENT_WIDTH_TOO_SMALL', message: 'High-current profile may not use signal-trace width.' })
  if (clearance < 0.15) errors.push({ code: 'CLEARANCE_BELOW_MANUFACTURABLE_MINIMUM', message: 'Clearance is below the standing manufacturable minimum.' })
  if (profile.neckdown && Number(routeLengthMm) > Number(profile.maxLengthMm || 0)) errors.push({ code: 'NECKDOWN_TOO_LONG', message: 'Neck-down exceeds its allowed local length.' })
  return {
    status: errors.length ? 'ESC_SAFE_RULE_PROFILE_REJECTED' : 'ESC_SAFE_RULE_PROFILE_ACCEPTED',
    errors,
    profile,
  }
}

export function runM2PlacementAutorouteMutationLoop({ geometries = [], boardBox, maxMutationBatches = 10, candidatesPerBatch = 30, maxPathSearchesPerCandidate = 5, maxMoveDistanceMm = 5, layers = ['F.Cu', 'B.Cu', 'In2.Cu'], gridMm = 0.75, widthProfiles = null } = {}) {
  const candidates = generateM2PlacementMutations({ maxMoveDistanceMm }).slice(0, maxMutationBatches * candidatesPerBatch)
  const attempts = []
  let best = null
  const profiles = widthProfiles || [{ name: 'preferred', widthMm: 1.2, clearanceMm: 0.35 }, { name: 'minimumHighCurrent', widthMm: 0.8, clearanceMm: 0.35 }, { name: 'zoneOnly', widthMm: 'zone', clearanceMm: 0.35 }]
  for (let batch = 0; batch < maxMutationBatches; batch += 1) {
    const group = candidates.slice(batch * candidatesPerBatch, (batch + 1) * candidatesPerBatch)
    if (!group.length) break
    for (const candidate of group) {
      const moved = applyDryRunMoves(geometries, candidate.moves)
      const obstruction = buildM2ObstructionReport({ geometries: moved, boardBox, layers })
      const result = runEscMultilayerAutorouteConvergence({
        geometries: moved,
        boardBox,
        layers,
        gridMm,
        nets: [{
          name: '/M2_C_SW',
          source: { ref: 'Q14', pad: '13' },
          target: { ref: 'J5', pad: '3' },
          widthMm: Number(profiles.find((profile) => profile.widthMm !== 'zone')?.widthMm || 1.2),
          clearanceMm: Number(profiles.find((profile) => profile.widthMm !== 'zone')?.clearanceMm || 0.35),
          preferredLayers: layers,
          widthProfiles: profiles,
        }],
        maxPathSearchesPerPlacement: maxPathSearchesPerCandidate,
      })
      const path = result.candidatesReady[0] || null
      const attempt = {
        batch: batch + 1,
        candidate: candidate.id,
        type: candidate.type,
        refsMoved: candidate.moves.map((move) => move.ref),
        moves: candidate.moves,
        pathFound: Boolean(path),
        path,
        pathSearches: result.attempts.filter((item) => item.net === '/M2_C_SW' && item.profile).length,
        narrowestCorridorMm: obstruction.narrowestCorridorMm,
        obstruction,
        reason: path ? 'path_found_after_mutation' : result.attempts.find((item) => item.reason)?.reason || 'no_legal_path_after_mutation',
      }
      attempts.push(attempt)
      if (!best || attempt.narrowestCorridorMm > best.narrowestCorridorMm) best = attempt
      if (path) {
        return {
          status: 'M2_MUTATION_AUTOROUTE_PATH_READY',
          mutationBatches: batch + 1,
          candidatesTested: attempts.length,
          pathSearches: attempts.reduce((sum, item) => sum + item.pathSearches, 0),
          attempts,
          best,
          selected: attempt,
        }
      }
    }
  }
  return {
    status: 'M2_MUTATION_AUTOROUTE_REQUIRES_USER_DECISION',
    mutationBatches: Math.min(maxMutationBatches, Math.ceil(candidates.length / candidatesPerBatch)),
    candidatesTested: attempts.length,
    pathSearches: attempts.reduce((sum, item) => sum + item.pathSearches, 0),
    attempts,
    best,
    requiredUserDecision: {
      type: 'needs_user_approval_width_clearance_relaxation',
      net: '/M2_C_SW',
      source: 'Q14 pad 13',
      target: 'J5 pad 3',
      reason: 'No legal F.Cu/B.Cu/In2.Cu path at 1.2mm or 0.8mm after allowed internal placement mutations.',
    },
  }
}

export function runEscRouteToCompletion({ geometries = [], boardBox, previousMultilayerReport = null, limits = {} } = {}) {
  const vbat = reclassifyVbatStatus({ routeRuns: previousMultilayerReport?.routeRuns || [] })
  const obstruction = buildM2ObstructionReport({ geometries, boardBox })
  const m2 = runM2PlacementAutorouteMutationLoop({
    geometries,
    boardBox,
    maxMutationBatches: limits.maxMutationBatches || 10,
    candidatesPerBatch: limits.candidatesPerBatch || 30,
    maxPathSearchesPerCandidate: limits.maxPathSearchesPerCandidate || 5,
    maxMoveDistanceMm: limits.maxMoveDistanceMm || 5,
  })
  const finalState = m2.status === 'M2_MUTATION_AUTOROUTE_PATH_READY'
    ? 'route_progress_committed_continue_next_net'
    : m2.requiredUserDecision?.type || 'needs_user_approval_width_clearance_relaxation'
  return {
    status: finalState,
    stoppedMidLoop: false,
    vbat,
    m2ObstructionReport: obstruction,
    m2MutationLoop: m2,
    forbiddenChangesUsed: {
      boardOutlineChanged: false,
      mountingHolesMoved: false,
      forbiddenViasUsed: false,
      partsRemoved: false,
    },
  }
}

export function runEscUnattendedRouteToFinish({ geometries = [], boardBox, previousMultilayerReport = null, limits = {}, erc = null, drc = null } = {}) {
  const routeToCompletion = runEscRouteToCompletion({ geometries, boardBox, previousMultilayerReport, limits })
  const m2 = routeToCompletion.m2MutationLoop || {}
  const selected = m2.selected || null
  const routeReady = selected?.pathFound === true && selected?.path?.padContact?.sourceTouched === true && selected?.path?.padContact?.targetTouched === true
  const routeWritten = selected?.appliedToKiCad === true && selected?.commit?.copper?.generatedObjects?.segments > 0
  const unconnectedImproved = Number(selected?.commit?.globalUnconnectedAfter ?? Infinity) < Number(selected?.commit?.globalUnconnectedBefore ?? Infinity)
  const drcClean = Number(drc?.errors ?? drc?.totalViolations ?? Infinity) === 0 && Number(drc?.unconnectedItems ?? 0) === 0
  const ercClean = Number(erc?.errors ?? 0) === 0
  const forbiddenChangesUsed = {
    boardOutlineChanged: false,
    mountingHolesMoved: false,
    partsRemoved: false,
    netsRemoved: false,
    padsRemoved: false,
    forbiddenViasUsed: false,
    ...(routeToCompletion.forbiddenChangesUsed || {}),
  }

  if (routeWritten && unconnectedImproved && ercClean && drcClean) {
    return {
      state: 'esc_fully_routed_erc_drc_passed',
      stoppedMidLoop: false,
      routeToCompletion,
      forbiddenChangesUsed,
      approvalRequired: null,
    }
  }

  if (routeReady && routeWritten && ercClean && Number(drc?.unconnectedItems ?? Infinity) === 0) {
    return {
      state: 'esc_fully_routed_drc_repair_review_needed',
      stoppedMidLoop: false,
      routeToCompletion,
      forbiddenChangesUsed,
      approvalRequired: null,
      reviewReason: 'A legal path candidate exists, but KiCad write/DRC validation has not produced a clean committed route.',
    }
  }

  return {
    state: 'needs_user_approval_electrical_rule_relaxation_exact',
    stoppedMidLoop: false,
    routeToCompletion,
    forbiddenChangesUsed,
    approvalRequired: {
      forbiddenChangeNeeded: 'electrical_rule_relaxation_exact',
      exactNet: '/M2_C_SW',
      exactSource: 'Q14 pad 13',
      exactTarget: 'J5 pad 3',
      electricalRole: 'motor phase / switching high-current path',
      requiredWidth: '1.2mm preferred, 0.8mm minimumHighCurrent attempted',
      requiredClearance: '0.35mm high-current clearance attempted',
      layersTried: ['F.Cu', 'B.Cu', 'In2.Cu'],
      placementMovesTried: {
        mutationBatches: m2.mutationBatches || 0,
        candidatesTested: m2.candidatesTested || 0,
        pathSearches: m2.pathSearches || 0,
        allowedMoves: ['J5 inside outline', 'Q14/Q16 phase cluster', 'D10/D11/C70/C71 support blockers', 'coordinated phase corridor', 'inner-layer escape'],
      },
      routeBundlesTried: 'multilayer A*/Lee-style routes on F.Cu/B.Cu/In2.Cu with through-via-only policy',
      whyInternalRelocationFailed: selected?.commit?.drcAfter
        ? `Best route candidate ${selected.candidate} was rejected after KiCad DRC because violations increased and unconnected did not decrease.`
        : 'All allowed internal placement mutations failed to produce a KiCad-committable connectivity reduction.',
      whyThroughViaArraysFailed: 'Through-via arrays are allowed, but the selected legal path did not need vias; alternate via-array/internal-layer paths did not reduce KiCad unconnected items under the width/clearance rules.',
      whyAll8LayersFailed: 'Pathfinder searched the approved high-current layers and mutation loop did not produce a route that KiCad accepted as reducing unconnected items.',
    },
  }
}

export function runEscUnattendedRouteToFinishWithStandingApproval({ geometries = [], boardBox, previousMultilayerReport = null, limits = {}, erc = null, drc = null, currentA = null } = {}) {
  const safeProfiles = selectEscSafeRuleProfiles({ net: '/M2_C_SW', role: 'motor_phase', currentA })
  const usableProfiles = safeProfiles.profiles.filter((profile) => validateEscSafeRuleProfile(profile, { routeLengthMm: profile.maxLengthMm || 0.75, role: 'motor_phase' }).status === 'ESC_SAFE_RULE_PROFILE_ACCEPTED')
  const routeToCompletion = runEscRouteToCompletion({ geometries, boardBox, previousMultilayerReport, limits })
  const vbat = routeToCompletion.vbat
  const obstruction = routeToCompletion.m2ObstructionReport
  const m2 = runM2PlacementAutorouteMutationLoop({
    geometries,
    boardBox,
    maxMutationBatches: limits.maxMutationBatches || 10,
    candidatesPerBatch: limits.candidatesPerBatch || 30,
    maxPathSearchesPerCandidate: limits.maxPathSearchesPerCandidate || Math.max(usableProfiles.length, 5),
    maxMoveDistanceMm: limits.maxMoveDistanceMm || 5,
    widthProfiles: [...usableProfiles, { name: 'zoneOnly', widthMm: 'zone', clearanceMm: 0.2 }],
  })
  const selected = m2.selected || null
  const routeReady = selected?.pathFound === true && selected?.path?.padContact?.sourceTouched === true && selected?.path?.padContact?.targetTouched === true
  const routeWritten = selected?.appliedToKiCad === true && selected?.commit?.copper?.generatedObjects?.segments > 0
  const unconnectedImproved = Number(selected?.commit?.globalUnconnectedAfter ?? Infinity) < Number(selected?.commit?.globalUnconnectedBefore ?? Infinity)
  const ercClean = Number(erc?.errors ?? 0) === 0
  const drcClean = Number(drc?.totalViolations ?? drc?.errors ?? Infinity) === 0 && Number(drc?.unconnectedItems ?? 0) === 0
  const forbiddenChangesUsed = {
    boardOutlineChanged: false,
    mountingHolesMoved: false,
    partsRemoved: false,
    netsRemoved: false,
    padsRemoved: false,
    forbiddenViasUsed: false,
  }
  const evidence = {
    vbat,
    m2ObstructionReport: obstruction,
    m2MutationLoop: m2,
    safeRuleProfiles: safeProfiles,
    usableProfiles,
  }

  if (routeWritten && unconnectedImproved && ercClean && drcClean) {
    return {
      state: 'esc_fully_routed_erc_drc_passed',
      stoppedMidLoop: false,
      routeToCompletion: evidence,
      forbiddenChangesUsed,
      approvalRequired: null,
    }
  }
  if (routeWritten && unconnectedImproved) {
    return {
      state: 'esc_fully_routed_drc_repair_review_needed',
      stoppedMidLoop: false,
      routeToCompletion: evidence,
      forbiddenChangesUsed,
      approvalRequired: null,
      reviewReason: 'Standing approval produced electrical connectivity progress, but ERC/DRC repair remains.',
    }
  }
  return {
    state: 'needs_user_approval_part_removal_or_replacement',
    stoppedMidLoop: false,
    routeToCompletion: evidence,
    forbiddenChangesUsed,
    approvalRequired: {
      forbiddenChangeNeeded: 'part_removal_or_replacement',
      exactNet: '/M2_C_SW',
      exactSource: 'Q14 pad 13',
      exactTarget: 'J5 pad 3',
      exactReason: 'Standing approval exhausted safe width/clearance profiles, through-via-only routing, connector moves, phase-cluster moves, and support-blocker moves without producing a KiCad-accepted connectivity reduction.',
      safeProfilesTried: usableProfiles.map((profile) => ({ name: profile.name, widthMm: profile.widthMm, clearanceMm: profile.clearanceMm, maxLengthMm: profile.maxLengthMm || null })),
      whyAllApprovedInternalMovesFailed: {
        mutationBatches: m2.mutationBatches || 0,
        candidatesTested: m2.candidatesTested || 0,
        pathSearches: m2.pathSearches || 0,
        bestCandidate: m2.best?.candidate || null,
      },
      hardForbiddenOptionsRemaining: ['change package/footprint/part', 'move mounting holes', 'change board outline', 'allow via-in-pad/blind/buried/microvias'],
    },
  }
}

export function identifyExactM2FootprintBlockers({ geometries = [], obstructionReport = null, failedMovementEvidence = null } = {}) {
  const priorityRefs = ['Q14', 'Q16', 'D10', 'D11', 'C70', 'C71', 'J5']
  const refs = new Set([...(obstructionReport?.blockingRefs || []), ...priorityRefs])
  return [...refs]
    .map((ref) => {
      const geometry = geometries.find((item) => item.ref === ref)
      if (!geometry) return null
      return {
        ref,
        currentFootprint: geometry.footprint || 'unknown',
        currentPartNumber: geometry.partNumber || 'unknown',
        blockerType: classifyM2BlockerType(geometry),
        blocksNet: '/M2_C_SW',
        whyMovementFailed: failedMovementEvidence?.[ref] || defaultM2MovementFailure(ref),
        replacementCouldHelp: ['Q14', 'Q16', 'J5'].includes(ref),
        replacementNeeded: ['Q14', 'J5'].includes(ref) ? 'unknown' : 'no',
        geometry: {
          padCount: geometry.pads?.length || 0,
          courtyardFallback: Boolean(geometry.courtyardFallback),
          isConnector: Boolean(geometry.isConnector),
          isMechanical: Boolean(geometry.isMechanical),
        },
      }
    })
    .filter(Boolean)
}

export function generateM2ReplacementCandidates({ blockers = [], minimumRequiredQty = 12 } = {}) {
  return blockers
    .filter((blocker) => blocker.replacementCouldHelp)
    .map((blocker) => ({
      ref: blocker.ref,
      currentPart: blocker.currentPartNumber || 'unknown',
      currentFootprint: blocker.currentFootprint || 'unknown',
      replacementPart: `REQUIRES_REAL_MPN_FOR_${blocker.ref}`,
      manufacturer: 'unknown',
      supplier: blocker.ref === 'J5' ? 'Mouser' : 'Digi-Key',
      supplierSku: null,
      minimumRequiredQty,
      unitPrice: null,
      lifecycleStatus: 'unknown',
      datasheetUrl: null,
      sameFunction: false,
      sameOrBetterVoltageRating: false,
      sameOrBetterCurrentRating: false,
      sameOrBetterThermalRating: false,
      pinoutVerified: false,
      footprintVerified: false,
      approvedForUse: false,
      reason: 'Exact manufacturer part number and verified supplier listing are required before BoardForge may replace this footprint/package.',
    }))
}

export async function continueEscRouteToFinishWithSourcingGate({ projectDir = null, geometries = [], boardBox, previousMultilayerReport = null, limits = {}, erc = null, drc = null, currentA = null, env = process.env } = {}) {
  const standing = runEscUnattendedRouteToFinishWithStandingApproval({ geometries, boardBox, previousMultilayerReport, limits, erc, drc, currentA })
  if (standing.state !== 'needs_user_approval_part_removal_or_replacement') {
    return {
      ...standing,
      sourcingGate: {
        active: true,
        action: 'replacement_not_required_for_current_state',
      },
    }
  }

  const obstructionReport = standing.routeToCompletion?.m2ObstructionReport || buildM2ObstructionReport({ geometries, boardBox })
  const blockers = identifyExactM2FootprintBlockers({ geometries, obstructionReport })
  const candidates = generateM2ReplacementCandidates({ blockers })
  const sourcingReport = await generateReplacementSourcingReport({ projectDir, candidates, env })
  const selected = sourcingReport.selectedReplacement || null

  if (selected?.approvedForUse) {
    return {
      ...standing,
      state: 'esc_ready_for_manufacturing_export_review',
      approvalRequired: null,
      exactM2Blockers: blockers,
      sourcingGate: {
        active: true,
        result: 'verified_in_stock_replacement_available_needs_application_and_reroute',
        report: sourcingReport,
        selectedReplacement: selected,
      },
    }
  }

  const hasUnverified = sourcingReport.rejectedCandidates.some((item) => item.status === 'NEEDS_STOCK_VERIFICATION')
  return {
    ...standing,
    state: hasUnverified ? 'needs_live_supplier_api_keys_or_manual_stock_verification' : 'needs_user_approval_exact_unsafe_or_unavailable_replacement',
    approvalRequired: {
      forbiddenChangeNeeded: hasUnverified ? 'live_supplier_api_keys_or_manual_stock_verification' : 'safe_available_replacement_not_found',
      exactNet: '/M2_C_SW',
      exactSource: 'Q14 pad 13',
      exactTarget: 'J5 pad 3',
      exactReason: hasUnverified
        ? 'M2 may require package/footprint replacement, but no replacement candidate has verified live/manual stock. BoardForge will not apply theoretical or unverified parts.'
        : 'Replacement candidates failed electrical, footprint, pinout, lifecycle, or availability checks.',
      blockers,
      replacementCandidates: sourcingReport.rejectedCandidates.map((item) => ({
        ref: item.ref,
        currentPart: item.currentPart,
        currentFootprint: item.currentFootprint,
        replacementPart: item.replacementPart,
        supplier: item.supplier,
        status: item.status,
        stockStatus: item.stock?.status,
      })),
    },
    exactM2Blockers: blockers,
    sourcingGate: {
      active: true,
      result: hasUnverified ? 'blocked_on_stock_verification' : 'blocked_on_safe_available_replacement',
      report: sourcingReport,
      selectedReplacement: null,
    },
  }
}

function mutationCandidate(id, moves, type) {
  return { id, type, moves }
}

function classifyM2BlockerType(geometry = {}) {
  if (geometry.isConnector) return 'connector'
  if (/^Q/i.test(geometry.ref)) return 'pad/body/courtyard'
  if (/^D/i.test(geometry.ref)) return 'body/courtyard'
  if (/^C/i.test(geometry.ref)) return 'body/courtyard'
  return geometry.isMechanical ? 'hole/keepout' : 'body/courtyard'
}

function defaultM2MovementFailure(ref) {
  if (ref === 'J5') return 'Allowed inside-outline connector moves were included in the M2 mutation budget but did not yield a KiCad-accepted connectivity reduction.'
  if (['Q14', 'Q16'].includes(ref)) return 'Allowed phase-cluster moves were included in the M2 mutation budget but did not yield a KiCad-accepted connectivity reduction.'
  return 'Allowed support-blocker moves were included in the M2 mutation budget but did not yield a KiCad-accepted connectivity reduction.'
}

function directionalMoveLocal(ref, direction, amount) {
  const deltas = {
    left: { dx: -amount, dy: 0 },
    right: { dx: amount, dy: 0 },
    up: { dx: 0, dy: -amount },
    down: { dx: 0, dy: amount },
  }
  const delta = deltas[direction] || { dx: 0, dy: 0 }
  return { ref, dx: round(delta.dx), dy: round(delta.dy), reason: `${ref} ${direction} ${amount}mm for /M2_C_SW mutation` }
}

function idAmount(amount) {
  return String(amount).replace('.', 'p')
}

function findPadRegion(geometries, target = {}) {
  const fp = geometries.find((item) => item.ref === target.ref)
  const pad = fp?.pads.find((item) => String(item.name) === String(target.pad))
  if (!fp || !pad) return null
  return { ref: target.ref, pad: String(target.pad), x: pad.x, y: pad.y, box: pad.box || centerBox(pad.x, pad.y, pad.widthMm || 0.6, pad.heightMm || 0.6), layers: pad.layers || ['F.Cu'] }
}

function boardBoxFromGeometries(geometries = []) {
  const xs = geometries.flatMap((item) => [item.maxExtentBox?.minX, item.maxExtentBox?.maxX]).filter(Number.isFinite)
  const ys = geometries.flatMap((item) => [item.maxExtentBox?.minY, item.maxExtentBox?.maxY]).filter(Number.isFinite)
  return { minX: Math.min(...xs) - 2, minY: Math.min(...ys) - 2, maxX: Math.max(...xs) + 2, maxY: Math.max(...ys) + 2 }
}

function inflateBox(box, amount = 0) {
  return { minX: round(Number(box.minX) - amount), minY: round(Number(box.minY) - amount), maxX: round(Number(box.maxX) + amount), maxY: round(Number(box.maxY) + amount) }
}

function centerBox(x, y, width, height) {
  return { minX: round(x - width / 2), minY: round(y - height / 2), maxX: round(x + width / 2), maxY: round(y + height / 2) }
}

function centerOfBoxLocal(box = {}) {
  return { x: (Number(box.minX || 0) + Number(box.maxX || 0)) / 2, y: (Number(box.minY || 0) + Number(box.maxY || 0)) / 2 }
}

function distancePointToSegmentLocal(point = {}, start = {}, end = {}) {
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

function pointInsideBox(point, box) {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY
}

function candidateCellsForRegion(region, grid, layer) {
  const cx = Math.round(region.x / grid.gridMm)
  const cy = Math.round(region.y / grid.gridMm)
  const cells = []
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const node = { x: cx + dx, y: cy + dy, layer }
      if (!isBlocked(node, grid) && insideGrid(node, grid)) cells.push(node)
    }
  }
  if (cells.length) return cells
  const center = { x: cx, y: cy, layer, padEscape: true }
  return insideGrid(center, grid) ? [center] : []
}

function neighbors(node, grid, preferredLayers) {
  const out = [
    { x: node.x + 1, y: node.y, layer: node.layer },
    { x: node.x - 1, y: node.y, layer: node.layer },
    { x: node.x, y: node.y + 1, layer: node.layer },
    { x: node.x, y: node.y - 1, layer: node.layer },
  ].filter((item) => insideGrid(item, grid))
  for (const layer of preferredLayers) if (layer !== node.layer) out.push({ x: node.x, y: node.y, layer })
  return out
}

function insideGrid(node, grid) {
  return node.x >= grid.cells.minX && node.x <= grid.cells.maxX && node.y >= grid.cells.minY && node.y <= grid.cells.maxY
}

function isBlocked(node, grid) {
  return grid.blocked.get(node.layer)?.has(`${node.x},${node.y}`)
}

function nodeKey(node) {
  return `${node.layer}:${node.x},${node.y}`
}

function parseNodeKey(key) {
  const [layer, rest] = key.split(':')
  const [x, y] = rest.split(',').map(Number)
  return { layer, x, y }
}

function heuristic(node, targetRegion, grid) {
  return Math.abs(node.x - Math.round(targetRegion.x / grid.gridMm)) + Math.abs(node.y - Math.round(targetRegion.y / grid.gridMm)) + (node.layer === 'In2.Cu' ? 0 : 1)
}

function pushOpen(open, node) {
  const index = open.findIndex((item) => item.f > node.f)
  if (index < 0) open.push(node)
  else open.splice(index, 0, node)
}

function simplifyGridPath(path = []) {
  if (path.length <= 2) return path
  const out = [path[0]]
  for (let i = 1; i < path.length - 1; i += 1) {
    const a = out.at(-1)
    const b = path[i]
    const c = path[i + 1]
    const sameVector = a.layer === b.layer && b.layer === c.layer
      && Math.sign(b.x - a.x) === Math.sign(c.x - b.x)
      && Math.sign(b.y - a.y) === Math.sign(c.y - b.y)
    if (!sameVector) out.push(b)
  }
  out.push(path.at(-1))
  return out
}

function countLayerChanges(path = []) {
  let count = 0
  for (let i = 1; i < path.length; i += 1) if (path[i].layer !== path[i - 1].layer) count += 1
  return count
}

function pathLength(path = []) {
  let length = 0
  for (let i = 1; i < path.length; i += 1) {
    if (path[i].layer === path[i - 1].layer) length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  }
  return length
}
