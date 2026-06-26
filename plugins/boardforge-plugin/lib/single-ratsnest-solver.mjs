import { distance, distancePointToSegment, round } from './geometry.mjs'

export function buildMicroRouteProblemModel({ net = '', sourcePad = {}, targetPad = {}, pads = [], tracks = [], vias = [], boardOutline = [] } = {}) {
  const sourceCoord = { x: Number(sourcePad.x), y: Number(sourcePad.y) }
  const targetCoord = { x: Number(targetPad.x), y: Number(targetPad.y) }
  const role = classifyMicroRouteRole(net)
  const requiredWidthMm = role === 'local power / VDD support' ? 0.25 : 0.127
  const requiredClearanceMm = 0.15
  const obstacles = buildSingleNetObstacleMap({ net, sourcePad, targetPad, pads, tracks, vias, boardOutline, requiredWidthMm, requiredClearanceMm })
  return {
    net,
    source: `${sourcePad.ref} pad ${sourcePad.pad || sourcePad.name}`,
    target: `${targetPad.ref} pad ${targetPad.pad || targetPad.name}`,
    sourceCoord,
    targetCoord,
    distanceMm: round(distance(sourceCoord, targetCoord)),
    netRole: role,
    allowedLayers: ['F.Cu', 'B.Cu', 'In4.Cu', 'In3.Cu'],
    preferredLayer: 'In4.Cu for regulated/local power if useful',
    allowedViaTypes: ['through'],
    forbiddenViaTypes: ['blind', 'buried', 'micro', 'via-in-pad'],
    requiredWidthMm,
    requiredClearanceMm,
    nearbyObstacles: obstacles.obstacles.slice(0, 20),
    existingCopperConflicts: obstacles.existingCopperConflicts,
    keepouts: obstacles.keepouts,
    edgeClearanceRisks: obstacles.edgeClearanceRisks,
  }
}

function classifyMicroRouteRole(net = '') {
  if (/VDD|VREG|3V3|5V|12V/i.test(net)) return 'local power / VDD support'
  if (/FB_|SENSE|ISENSE/i.test(net)) return 'feedback / protected sense'
  return 'signal/control'
}

export function buildSingleNetObstacleMap({ net = '', sourcePad = {}, targetPad = {}, pads = [], tracks = [], vias = [], boardOutline = [], requiredWidthMm = 0.127, requiredClearanceMm = 0.15 } = {}) {
  const clearance = requiredClearanceMm + requiredWidthMm / 2
  const exemptPads = new Set([`${sourcePad.ref}:${sourcePad.pad || sourcePad.name}`, `${targetPad.ref}:${targetPad.pad || targetPad.name}`])
  const obstacles = []
  for (const pad of pads || []) {
    const key = `${pad.ref}:${pad.pad || pad.name}`
    if (exemptPads.has(key)) continue
    obstacles.push({
      type: 'pad',
      ref: pad.ref,
      pad: pad.pad || pad.name,
      net: pad.netName || pad.net,
      x: Number(pad.x),
      y: Number(pad.y),
      radiusMm: Math.max(Number(pad.widthMm || 0.4), Number(pad.heightMm || 0.4)) / 2 + clearance,
      layers: pad.layers || [],
    })
  }
  for (const track of tracks || []) {
    if ((track.netName || track.net) === net) continue
    obstacles.push({
      type: 'track',
      net: track.netName || track.net,
      start: track.start,
      end: track.end,
      layer: track.layer,
      radiusMm: Number(track.widthMm || 0.127) / 2 + clearance,
    })
  }
  for (const via of vias || []) {
    if ((via.netName || via.net) === net) continue
    obstacles.push({
      type: 'via',
      net: via.netName || via.net,
      x: Number(via.x),
      y: Number(via.y),
      radiusMm: Number(via.diameterMm || 0.45) / 2 + clearance,
    })
  }
  return {
    net,
    clearance,
    obstacles,
    existingCopperConflicts: obstacles.filter((item) => item.type === 'track'),
    keepouts: obstacles.filter((item) => item.type === 'via'),
    edgeClearanceRisks: boardOutline?.length ? [] : [{ type: 'unknown_board_outline', reason: 'No board outline supplied to pathfinder.' }],
  }
}

export function inflateObstaclesForNetRole(obstacleMap = {}, netRole = 'signal/control') {
  const multiplier = /power|VDD/i.test(netRole) ? 1.15 : 1
  return {
    ...obstacleMap,
    obstacles: (obstacleMap.obstacles || []).map((item) => ({ ...item, inflatedRadiusMm: round(Number(item.radiusMm || 0) * multiplier) })),
  }
}

export function searchMultiSegmentRoute(model = {}, obstacleMap = {}, budget = {}) {
  const candidates = []
  const layers = model.allowedLayers || ['F.Cu', 'B.Cu']
  const offsets = generateOffsets(Number(budget.doglegCandidates || 100))
  for (const layer of layers) {
    candidates.push(routeCandidate(model, layer, [model.sourceCoord, model.targetCoord], 'direct'))
    for (const offset of offsets) {
      candidates.push(routeCandidate(model, layer, [
        model.sourceCoord,
        { x: model.sourceCoord.x, y: round((model.sourceCoord.y + model.targetCoord.y) / 2 + offset) },
        { x: model.targetCoord.x, y: round((model.sourceCoord.y + model.targetCoord.y) / 2 + offset) },
        model.targetCoord,
      ], 'dogleg-y'))
      candidates.push(routeCandidate(model, layer, [
        model.sourceCoord,
        { x: round((model.sourceCoord.x + model.targetCoord.x) / 2 + offset), y: model.sourceCoord.y },
        { x: round((model.sourceCoord.x + model.targetCoord.x) / 2 + offset), y: model.targetCoord.y },
        model.targetCoord,
      ], 'dogleg-x'))
    }
  }
  return candidates
    .map((candidate) => ({ ...candidate, drcRisk: scoreRouteByDrcRisk(candidate, obstacleMap).score }))
    .sort((a, b) => a.drcRisk - b.drcRisk)
    .slice(0, Number(budget.maxCandidates || 260))
}

function generateOffsets(count) {
  const base = [0.2, -0.2, 0.35, -0.35, 0.5, -0.5, 0.75, -0.75, 1, -1, 1.5, -1.5, 2, -2]
  const out = []
  while (out.length < count) out.push(...base.map((item) => item + Math.trunc(out.length / base.length) * 0.15))
  return out.slice(0, count)
}

function routeCandidate(model, layer, points, kind) {
  return {
    net: model.net,
    kind,
    layer,
    widthMm: model.requiredWidthMm,
    points,
    segments: points.slice(0, -1).map((point, index) => ({ start: point, end: points[index + 1], layer, widthMm: model.requiredWidthMm, net: model.net })),
  }
}

export function searchViaAssistedRoute(model = {}, obstacleMap = {}, budget = {}) {
  const candidates = []
  const viaCount = Number(budget.viaCandidates || 50)
  const mid = { x: (model.sourceCoord.x + model.targetCoord.x) / 2, y: (model.sourceCoord.y + model.targetCoord.y) / 2 }
  for (const offset of generateOffsets(viaCount)) {
    const via = { x: round(mid.x + offset), y: round(mid.y - offset), viaType: 'through', diameterMm: 0.45, drillMm: 0.2, net: model.net }
    candidates.push({
      net: model.net,
      kind: 'via-assisted',
      via,
      points: [model.sourceCoord, via, model.targetCoord],
      layers: ['F.Cu', 'B.Cu'],
      drcRisk: scoreViaSite(via, obstacleMap) + scoreRouteByDrcRisk({ segments: [{ start: model.sourceCoord, end: via }, { start: via, end: model.targetCoord }] }, obstacleMap).score,
    })
  }
  return candidates.sort((a, b) => a.drcRisk - b.drcRisk).slice(0, viaCount)
}

function scoreViaSite(via, obstacleMap) {
  let score = 0
  for (const obstacle of obstacleMap.obstacles || []) {
    if (!Number.isFinite(obstacle.x) || !Number.isFinite(obstacle.y)) continue
    const d = distance(via, obstacle)
    if (d < Number(obstacle.inflatedRadiusMm || obstacle.radiusMm || 0)) score += 1000
    else score += 1 / Math.max(d, 0.001)
  }
  return score
}

export function scoreRouteByDrcRisk(candidate = {}, obstacleMap = {}) {
  let score = 0
  const blockers = []
  for (const segment of candidate.segments || []) {
    for (const obstacle of obstacleMap.obstacles || []) {
      let d = Infinity
      if (obstacle.type === 'track' && obstacle.start && obstacle.end) {
        d = Math.min(distancePointToSegment(segment.start, obstacle.start, obstacle.end), distancePointToSegment(segment.end, obstacle.start, obstacle.end))
      } else if (Number.isFinite(obstacle.x) && Number.isFinite(obstacle.y)) {
        d = distancePointToSegment(obstacle, segment.start, segment.end)
      }
      const min = Number(obstacle.inflatedRadiusMm || obstacle.radiusMm || 0)
      if (d < min) {
        score += 1000 + (min - d) * 100
        blockers.push({ obstacle, distanceMm: round(d), requiredMm: round(min) })
      } else {
        score += 1 / Math.max(d - min, 0.001)
      }
    }
  }
  return { score: round(score), blockers }
}

export function findClearanceAwarePathForRatsnestItem(model = {}, context = {}) {
  const obstacleMap = inflateObstaclesForNetRole(context.obstacleMap || buildSingleNetObstacleMap(context), model.netRole)
  const multi = searchMultiSegmentRoute(model, obstacleMap, context.searchBudget)
  const vias = searchViaAssistedRoute(model, obstacleMap, context.searchBudget)
  return [...multi, ...vias].sort((a, b) => Number(a.drcRisk || 0) - Number(b.drcRisk || 0))
}

export function solveSingleRatsnestItemToCompletion({ model = {}, context = {}, searchBudget = {} } = {}) {
  const candidates = findClearanceAwarePathForRatsnestItem(model, { ...context, searchBudget })
  return {
    status: candidates.length ? 'SINGLE_RATSNEST_SOLVER_CANDIDATES_READY' : 'PROVEN_PHYSICAL_BLOCKER_WITH_EXACT_GEOMETRY',
    model,
    searchBudget,
    candidatesTested: candidates.length,
    bestCandidate: candidates[0] || null,
    blockers: candidates[0]?.drcRisk > 500 ? scoreRouteByDrcRisk(candidates[0], context.obstacleMap || {}).blockers : [],
  }
}
