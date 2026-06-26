import { round } from './geometry.mjs'
import { validateEscViaPolicy } from './esc-drc-clusters.mjs'

const layerRoles = {
  battery: ['In2.Cu', 'F.Cu', 'B.Cu'],
  motor_phase: ['In2.Cu', 'F.Cu', 'B.Cu'],
  pgnd: ['In1.Cu', 'In6.Cu', 'B.Cu'],
}

export function generateHighCurrentRouteCandidates({ pair, board = {}, netClass = 'MOTOR_PHASE', target = 'motor_phase' }) {
  if (!pair?.start || !pair?.end) return []
  const widthMm = target === 'battery' ? 1.4 : 1.2
  const clearanceMm = target === 'battery' ? 0.35 : 0.35
  const layers = layerRoles[target] || layerRoles.motor_phase
  const candidates = [
    wideTrackCandidate({ pair, id: `${target}-wide-f`, layer: 'F.Cu', widthMm, clearanceMm }),
    wideTrackCandidate({ pair, id: `${target}-wide-b`, layer: 'B.Cu', widthMm, clearanceMm }),
    doglegCandidate({ pair, id: `${target}-dogleg-f`, layer: 'F.Cu', widthMm, clearanceMm, board }),
    zoneCandidate({ pair, id: `${target}-zone-${layers[0].replace('.', '_')}`, layer: layers[0], widthMm, clearanceMm, board, netClass }),
    mixedViaArrayCandidate({ pair, id: `${target}-mixed-via-array`, layer: layers[0], widthMm, clearanceMm, board, netClass }),
  ]
  return candidates.map((candidate) => ({ ...candidate, score: scoreHighCurrentCandidate(candidate) }))
}

export function generateViaArrayCandidate({ net, center, targetLayer = 'In2.Cu', count = 6, pitchMm = 0.65, diameterMm = 0.6, drillMm = 0.3 }) {
  const columns = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / columns)
  const vias = []
  for (let index = 0; index < count; index += 1) {
    const col = index % columns
    const row = Math.floor(index / columns)
    vias.push({
      net,
      x: round(center.x + (col - (columns - 1) / 2) * pitchMm),
      y: round(center.y + (row - (rows - 1) / 2) * pitchMm),
      diameterMm,
      drillMm,
      viaType: 'through',
      layers: ['F.Cu', 'B.Cu'],
      targetLayer,
      reason: 'esc_high_current_layer_transition',
    })
  }
  return vias
}

export function scoreHighCurrentCandidate(candidate = {}) {
  let score = 0
  if (candidate.kind === 'zone') score -= 50
  if (candidate.kind === 'mixed_via_array') score -= 35
  if (/In2\.Cu/.test(candidate.layers?.join(' ') || '')) score -= 25
  score += (candidate.vias || []).length * 2
  score += Number(candidate.estimatedLengthMm || 0)
  return round(score)
}

export function validateHighCurrentCandidate(candidate = {}) {
  const viaPolicy = validateEscViaPolicy({ vias: candidate.vias || [] })
  const errors = [...(viaPolicy.errors || [])]
  if (!candidate.routePlan) errors.push({ code: 'NO_ROUTE_PLAN', message: 'Candidate has no route plan.' })
  if ((candidate.widthMm || 0) < 1.0 && candidate.kind !== 'zone') errors.push({ code: 'HIGH_CURRENT_TRACE_TOO_THIN', message: 'High-current route candidate is too thin.' })
  if (candidate.kind === 'zone' && !(candidate.routePlan?.designIntent?.copperPours || []).length) errors.push({ code: 'ZONE_MISSING', message: 'Zone candidate has no copper pour.' })
  return {
    status: errors.length ? 'HIGH_CURRENT_CANDIDATE_REJECTED' : 'HIGH_CURRENT_CANDIDATE_READY',
    errors,
    viaPolicy,
    forbiddenViasUsed: (candidate.vias || []).filter((via) => via.viaType && via.viaType !== 'through').length,
  }
}

export function analyzeEscRoutingCorridors({ pair, board = {}, candidateResults = [] }) {
  const bounds = boardBounds(board)
  const dx = Math.abs(pair.end.x - pair.start.x)
  const dy = Math.abs(pair.end.y - pair.start.y)
  const failures = candidateResults.filter((item) => !item.committed)
  const allFailed = failures.length === candidateResults.length
  return {
    status: allFailed ? 'ESC_CORRIDOR_REGENERATION_RECOMMENDED' : 'ESC_CORRIDOR_HAS_WORKABLE_CANDIDATE',
    net: pair.net,
    source: `${pair.start.ref} pad ${pair.start.pad}`,
    target: `${pair.end.ref} pad ${pair.end.pad}`,
    straightDistanceMm: round(Math.hypot(dx, dy)),
    boardRegion: bounds,
    obstruction: allFailed ? 'All generated high-current candidates either worsened DRC or failed connectivity success gates.' : null,
    suggestedFix: allFailed
      ? 'Regenerate local corridor around source/target by moving nearby movable passives/control/sense parts or create a larger legal copper zone corridor.'
      : 'Continue staged routing with the committed candidate.',
  }
}

export function recommendEscPlacementCorridorFix(corridor = {}) {
  return {
    status: 'ESC_PLACEMENT_CORRIDOR_FIX_READY_NEEDS_REVIEW',
    net: corridor.net,
    preserve: ['battery connector', 'motor output connector', 'mounting holes', 'board outline'],
    actions: [
      'open high-current corridor between source and target islands',
      'move only movable passives/control/sense parts first',
      'preserve connector and mechanical constraints unless user approves changes',
    ],
    reason: corridor.obstruction || 'High-current route corridor was not legal with current placement.',
  }
}

function wideTrackCandidate({ pair, id, layer, widthMm, clearanceMm }) {
  const route = baseRoute({ pair, layer, widthMm, waypoints: [pair.start, pair.end] })
  return planCandidate({ id, pair, kind: 'wide_track', layers: [layer], widthMm, clearanceMm, routes: [route], vias: [] })
}

function doglegCandidate({ pair, id, layer, widthMm, clearanceMm, board }) {
  const elbowA = { x: pair.end.x, y: pair.start.y }
  const elbowB = { x: pair.start.x, y: pair.end.y }
  const elbow = pointInsideBoard(elbowA, board) ? elbowA : elbowB
  const route = baseRoute({ pair, layer, widthMm, waypoints: [pair.start, elbow, pair.end] })
  return planCandidate({ id, pair, kind: 'dogleg_wide_track', layers: [layer], widthMm, clearanceMm, routes: [route], vias: [] })
}

function zoneCandidate({ pair, id, layer, widthMm, clearanceMm, board, netClass }) {
  const polygon = clippedRouteZonePolygon(pair, board, Math.max(widthMm * 1.6, 2.2))
  return planCandidate({
    id,
    pair,
    kind: 'zone',
    layers: [layer],
    widthMm,
    clearanceMm,
    routes: [],
    vias: [],
    copperPours: [{ net: pair.net, layer, clearanceMm, thermalRelief: false, polygon, netClass }],
  })
}

function mixedViaArrayCandidate({ pair, id, layer, widthMm, clearanceMm, board, netClass }) {
  const sourceVias = generateViaArrayCandidate({ net: pair.net, center: offsetFromPad(pair.start, pair.end, 0.9), targetLayer: layer, count: 4 })
  const targetVias = generateViaArrayCandidate({ net: pair.net, center: offsetFromPad(pair.end, pair.start, 0.9), targetLayer: layer, count: 4 })
  const innerStart = sourceVias[0] || pair.start
  const innerEnd = targetVias[0] || pair.end
  const route = baseRoute({ pair, layer, widthMm, waypoints: [innerStart, routeElbow(innerStart, innerEnd), innerEnd], vias: [...sourceVias, ...targetVias] })
  const polygon = clippedRouteZonePolygon({ ...pair, start: innerStart, end: innerEnd }, board, Math.max(widthMm * 1.8, 2.4))
  return planCandidate({
    id,
    pair,
    kind: 'mixed_via_array',
    layers: ['F.Cu', layer],
    widthMm,
    clearanceMm,
    routes: [route],
    vias: [...sourceVias, ...targetVias],
    copperPours: [{ net: pair.net, layer, clearanceMm, thermalRelief: false, polygon, netClass }],
  })
}

function planCandidate({ id, pair, kind, layers, widthMm, clearanceMm, routes, vias, copperPours = [] }) {
  return {
    id,
    net: pair.net,
    kind,
    layers,
    widthMm,
    clearanceMm,
    vias,
    estimatedLengthMm: routeLength(routes),
    routePlan: {
      status: 'AUTOROUTE_READY_NEEDS_DRC',
      mode: 'esc_high_current_candidate',
      routes,
      routedNets: [pair.net],
      unroutedNets: [],
      strictViaConnectivity: false,
      writeInnerCopperPours: true,
      writeTopCopperPours: true,
      designIntent: { copperPours },
      humanReviewRequired: true,
    },
  }
}

function baseRoute({ pair, layer, widthMm, waypoints, vias = [] }) {
  return {
    net: pair.net,
    className: /VBAT|VIN|BATT/i.test(pair.net) ? 'BATTERY' : 'MOTOR_PHASE',
    status: 'routed',
    start: pair.start,
    end: pair.end,
    waypoints,
    layerPreference: [layer],
    widthMm,
    viaPlan: { candidates: vias },
    endpointRefs: [pair.start.ref, pair.end.ref].filter(Boolean),
    strategy: 'esc_high_current_candidate',
  }
}

function routeElbow(start, end) {
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? { x: end.x, y: start.y } : { x: start.x, y: end.y }
}

function offsetFromPad(from, to, distanceMm) {
  const dx = Number(to.x) - Number(from.x)
  const dy = Number(to.y) - Number(from.y)
  const length = Math.max(0.001, Math.hypot(dx, dy))
  return { x: round(Number(from.x) + dx / length * distanceMm), y: round(Number(from.y) + dy / length * distanceMm) }
}

function clippedRouteZonePolygon(pair, board, widthMm) {
  const bounds = boardBounds(board)
  const minX = Math.max(bounds.minX + 0.6, Math.min(pair.start.x, pair.end.x) - widthMm / 2)
  const maxX = Math.min(bounds.maxX - 0.6, Math.max(pair.start.x, pair.end.x) + widthMm / 2)
  const minY = Math.max(bounds.minY + 0.6, Math.min(pair.start.y, pair.end.y) - widthMm / 2)
  const maxY = Math.min(bounds.maxY - 0.6, Math.max(pair.start.y, pair.end.y) + widthMm / 2)
  return [
    { x: round(minX), y: round(minY) },
    { x: round(maxX), y: round(minY) },
    { x: round(maxX), y: round(maxY) },
    { x: round(minX), y: round(maxY) },
  ]
}

function boardBounds(board = {}) {
  const points = board.outline || []
  if (!points.length) return { minX: 0, minY: 0, maxX: 200, maxY: 200 }
  return {
    minX: Math.min(...points.map((point) => Number(point.x))),
    minY: Math.min(...points.map((point) => Number(point.y))),
    maxX: Math.max(...points.map((point) => Number(point.x))),
    maxY: Math.max(...points.map((point) => Number(point.y))),
  }
}

function pointInsideBoard(point, board = {}) {
  const bounds = boardBounds(board)
  return point.x > bounds.minX && point.x < bounds.maxX && point.y > bounds.minY && point.y < bounds.maxY
}

function routeLength(routes = []) {
  let total = 0
  for (const route of routes) {
    const points = route.waypoints || []
    for (let index = 1; index < points.length; index += 1) total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  }
  return round(total)
}
