import { distance, pointInPolygon, polygonBounds, rectCorners, rectsOverlap, round } from './geometry.mjs'
import { validatePlacement } from './validation.mjs'
import { compilePlacementConstraints } from './placement-constraints.mjs'

const sizes = {
  MCU: [10, 10], ESP32_S3: [18, 14], IMU: [3, 3], USB: [9, 7], RJ45: [16, 16], REGULATOR: [5, 5],
  BLACKBOX: [6, 5], BAROMETER: [3, 3], SWD: [8, 3], ESC_CONNECTOR: [10, 4], SENSOR_CONNECTOR: [10, 4],
  POWER_INPUT: [10, 5], ETHERNET_PHY: [7, 7], POE_FRONT_END: [14, 12], DEFAULT: [4, 3],
}

function component(ref, group, x, y, rotation = 0, options = {}) {
  const [width, height] = sizes[group] || sizes.DEFAULT
  return { ref, group, x: round(x), y: round(y), rotation, width, height, ...options }
}

export function generatePlacementPlan(board, template, profile, options = {}) {
  const bounds = polygonBounds(board.outline)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const cx = bounds.minX + width / 2
  const cy = bounds.minY + height / 2
  const edge = profile.componentToEdgeClearanceMm + 3
  const components = []
  if (template?.id === 'ESP32_S3_POE_SENSOR') {
    components.push(component('J1', 'RJ45', bounds.minX + edge + 5, cy, 90), component('U2', 'ETHERNET_PHY', bounds.minX + edge + 20, cy - 5), component('U3', 'POE_FRONT_END', bounds.minX + edge + 21, cy + 9), component('U1', 'ESP32_S3', cx + 11, cy), component('J2', 'USB', bounds.maxX - edge - 5, cy + 10, 270), component('J3', 'SENSOR_CONNECTOR', bounds.maxX - edge - 5, cy - 10, 270), component('U4', 'REGULATOR', cx, cy + 12))
  } else if (template?.id === 'DRONE_FC_30X30' || template?.id === 'DRONE_AIO_WHOOP') {
    components.push(component('U1', 'MCU', cx, cy + 3), component('U2', 'IMU', cx, cy - 8), component('Y1', 'DEFAULT', cx + 8, cy + 1), component('J1', 'USB', cx, bounds.minY + edge, 180), component('U3', 'BLACKBOX', cx - 9, cy + 7), component('U4', 'REGULATOR', cx + 10, cy + 8), component('J2', 'ESC_CONNECTOR', cx, bounds.maxY - edge, 0))
  } else {
    components.push(component('U1', template?.id === 'ESP32_S3_SENSOR' ? 'ESP32_S3' : 'MCU', cx, cy), component('J1', 'USB', bounds.minX + edge + 3, cy, 90), component('U2', 'REGULATOR', cx - 13, cy + 8), component('J2', 'SENSOR_CONNECTOR', bounds.maxX - edge - 5, cy, 270))
  }
  const selectedComponents = options.components?.length ? options.components : components
  const issues = validatePlacement(board, selectedComponents, profile)
  const constraints = compilePlacementConstraints(board, selectedComponents, options)
  const scoring = scorePlacement(board, selectedComponents, options.nets || [], profile)
  const constraintIssues = [
    ...constraints.violations.map((rule) => ({ severity: 'ERROR', code: 'PLACEMENT_CONSTRAINT_VIOLATION', message: `${rule.ref} violates ${rule.kind}: ${rule.requirement}`, details: rule })),
    ...constraints.warnings.map((rule) => ({ severity: 'WARNING', code: 'PLACEMENT_CONSTRAINT_REVIEW', message: `${rule.ref} needs ${rule.kind} review: ${rule.requirement}`, details: rule })),
  ]
  const allIssues = [...issues, ...scoring.issues, ...constraintIssues]
  return { status: allIssues.some((item) => ['BLOCKER', 'ERROR'].includes(item.severity)) ? 'NEEDS_FIX' : 'PLACEMENT_PLAN_READY', components: selectedComponents, rulesApplied: ['components fully inside outline', 'edge connectors placed on board edge intent', 'mounting hole clearance checked', 'component overlap checked', 'ratsnest length scored', 'passive proximity scored', 'mechanical/RF/thermal/service constraints compiled'], constraints, scoring, issues: allIssues }
}

export function optimizePlacementPlan(board, template, profile, options = {}) {
  const original = generatePlacementPlan(board, template, profile, options)
  let components = original.components.map((component) => ({ ...component }))
  const actions = []
  for (let pass = 0; pass < 3; pass += 1) {
    components = components.map((component, index) => {
      const moved = repairConstraintPosition(board, component, components, index, profile, options)
      if (moved.x !== component.x || moved.y !== component.y || moved.rotation !== component.rotation) {
        actions.push({ ref: component.ref, kind: 'constraint_repair', from: pickPlacement(component), to: pickPlacement(moved) })
      }
      return moved
    })
    components = resolvePlacementOverlaps(board, components, profile, actions, options)
  }
  const optimized = generatePlacementPlan(board, template, profile, { ...options, components })
  const fixedErrors = original.issues.filter((issue) => ['BLOCKER', 'ERROR'].includes(issue.severity)).length - optimized.issues.filter((issue) => ['BLOCKER', 'ERROR'].includes(issue.severity)).length
  return {
    ...optimized,
    status: optimized.status === 'PLACEMENT_PLAN_READY' ? 'OPTIMIZED_PLACEMENT_READY_NEEDS_REVIEW' : 'OPTIMIZED_PLACEMENT_NEEDS_REVIEW',
    originalScore: original.scoring.score,
    optimizedScore: optimized.scoring.score,
    fixedErrorCount: Math.max(0, fixedErrors),
    actions: dedupeActions(actions),
    originalIssues: original.issues,
  }
}

export function fixComponentOffBoard(board, component, profile) {
  const bounds = polygonBounds(board.outline)
  return { ...component, x: round(Math.max(bounds.minX + component.width / 2 + profile.componentToEdgeClearanceMm, Math.min(bounds.maxX - component.width / 2 - profile.componentToEdgeClearanceMm, component.x))), y: round(Math.max(bounds.minY + component.height / 2 + profile.componentToEdgeClearanceMm, Math.min(bounds.maxY - component.height / 2 - profile.componentToEdgeClearanceMm, component.y))) }
}

function repairConstraintPosition(board, component, components, index, profile, options) {
  const candidates = candidatePositionsFor(board, component, profile, options)
  return bestCandidate(board, component, components, index, candidates, profile, options)
}

function candidatePositionsFor(board, component, profile, options) {
  const bounds = polygonBounds(board.outline)
  const clearance = profile.componentToEdgeClearanceMm || 1
  const halfW = (component.width || 1) / 2
  const halfH = (component.height || 1) / 2
  const edgeInsetX = clearance + halfW + 0.2
  const edgeInsetY = clearance + halfH + 0.2
  const grid = Math.max(2.5, Number(options.gridMm || 3))
  const centerCandidates = []
  for (let x = bounds.minX + edgeInsetX; x <= bounds.maxX - edgeInsetX; x += grid) {
    for (let y = bounds.minY + edgeInsetY; y <= bounds.maxY - edgeInsetY; y += grid) centerCandidates.push({ x: round(x), y: round(y), rotation: component.rotation || 0 })
  }
  const edgeCandidates = [
    { x: bounds.minX + edgeInsetX, y: component.y, rotation: 90 },
    { x: bounds.maxX - edgeInsetX, y: component.y, rotation: 270 },
    { x: component.x, y: bounds.minY + edgeInsetY, rotation: 180 },
    { x: component.x, y: bounds.maxY - edgeInsetY, rotation: 0 },
    { x: bounds.minX + edgeInsetX, y: bounds.minY + edgeInsetY, rotation: 90 },
    { x: bounds.maxX - edgeInsetX, y: bounds.minY + edgeInsetY, rotation: 270 },
    { x: bounds.minX + edgeInsetX, y: bounds.maxY - edgeInsetY, rotation: 90 },
    { x: bounds.maxX - edgeInsetX, y: bounds.maxY - edgeInsetY, rotation: 270 },
  ].map((candidate) => ({
    ...candidate,
    x: round(clamp(candidate.x, bounds.minX + edgeInsetX, bounds.maxX - edgeInsetX)),
    y: round(clamp(candidate.y, bounds.minY + edgeInsetY, bounds.maxY - edgeInsetY)),
  }))
  if (/^(USB|RJ45|POWER_INPUT|SENSOR_CONNECTOR|ESC_CONNECTOR|SWD)$/i.test(component.group || '')) return [...edgeCandidates, ...centerCandidates]
  if (/(ESP32|RF|ANT|WROOM|BLE|WIFI|WI-FI)/i.test(`${component.group || ''} ${component.value || ''}`)) return [...edgeCandidates.slice(2), ...centerCandidates]
  return [{ x: component.x, y: component.y, rotation: component.rotation || 0 }, ...centerCandidates]
}

function bestCandidate(board, component, components, index, candidates, profile, options) {
  const ranked = candidates
    .map((candidate) => ({ ...component, ...candidate }))
    .filter((candidate) => componentFits(board, candidate, profile))
    .map((candidate) => ({ candidate, score: placementCandidateScore(board, candidate, components, index, profile, options) }))
    .sort((a, b) => a.score - b.score)
  return ranked[0]?.candidate || fixComponentOffBoard(board, component, profile)
}

function placementCandidateScore(board, candidate, components, index, profile, options) {
  const bounds = polygonBounds(board.outline)
  const others = components.filter((_, otherIndex) => otherIndex !== index)
  const overlapPenalty = others.filter((other) => rectsOverlap(candidate, other, profile.componentToComponentClearanceMm || 0)).length * 1000
  const holePenalty = (board.mountingHoles || []).filter((hole) => rectsOverlap(candidate, { x: hole.x, y: hole.y, width: hole.diameterMm + 2, height: hole.diameterMm + 2 })).length * 1000
  const nearestEdge = Math.min(Math.abs(candidate.x - bounds.minX), Math.abs(bounds.maxX - candidate.x), Math.abs(candidate.y - bounds.minY), Math.abs(bounds.maxY - candidate.y))
  const edgePenalty = /^(USB|RJ45|POWER_INPUT)$/i.test(candidate.group || '') ? nearestEdge * 30 : 0
  const rfPenalty = /(ESP32|RF|ANT|WROOM|BLE|WIFI|WI-FI)/i.test(`${candidate.group || ''} ${candidate.value || ''}`) ? nearestEdge * 12 : 0
  const ratsnestPenalty = localRatsnestPenalty(candidate, others, options.nets || [])
  return round(overlapPenalty + holePenalty + edgePenalty + rfPenalty + ratsnestPenalty + distance(candidate, components[index] || candidate) * 0.5)
}

function localRatsnestPenalty(candidate, others, nets) {
  const connectedRefs = new Set()
  for (const net of nets || []) {
    if (Array.isArray(net.refs) && net.refs.includes(candidate.ref)) net.refs.forEach((ref) => connectedRefs.add(ref))
  }
  for (const [pin, net] of Object.entries(candidate.pinMap || {})) {
    if (!pin || !net) continue
    for (const other of others) {
      if (Object.values(other.pinMap || {}).includes(net)) connectedRefs.add(other.ref)
    }
  }
  return others.filter((other) => connectedRefs.has(other.ref)).reduce((sum, other) => sum + distance(candidate, other) * 0.12, 0)
}

function resolvePlacementOverlaps(board, components, profile, actions, options) {
  let next = [...components]
  for (let index = 0; index < next.length; index += 1) {
    const component = next[index]
    const overlaps = next.some((other, otherIndex) => otherIndex !== index && rectsOverlap(component, other, profile.componentToComponentClearanceMm || 0))
    if (!overlaps) continue
    const repaired = bestCandidate(board, component, next, index, candidatePositionsFor(board, component, profile, options), profile, options)
    if (repaired.x !== component.x || repaired.y !== component.y || repaired.rotation !== component.rotation) {
      actions.push({ ref: component.ref, kind: 'overlap_repair', from: pickPlacement(component), to: pickPlacement(repaired) })
      next = next.map((item, itemIndex) => (itemIndex === index ? repaired : item))
    }
  }
  return next
}

function componentFits(board, component, profile) {
  const polygon = board.outline || []
  return rectCorners(component, profile.componentToEdgeClearanceMm || 0).every((corner) => pointInPolygon(corner, polygon))
}

function pickPlacement(component) {
  return { x: round(component.x), y: round(component.y), rotation: component.rotation || 0 }
}

function dedupeActions(actions) {
  const seen = new Set()
  return actions.filter((action) => {
    const key = `${action.ref}:${action.kind}:${action.to.x}:${action.to.y}:${action.to.rotation}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function scorePlacement(board, components = [], nets = [], profile = {}) {
  const bounds = polygonBounds(board.outline || [])
  const boardArea = Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY))
  const componentArea = components.reduce((sum, component) => sum + Number(component.width || 0) * Number(component.height || 0), 0)
  const density = componentArea / boardArea
  const edgeConnectorScore = scoreEdgeConnectors(bounds, components, profile)
  const ratsnest = estimateRatsnest(components, nets)
  const passiveScore = scorePassiveProximity(components)
  const densityPenalty = density > 0.5 ? 25 : density > 0.35 ? 12 : 0
  const ratsnestPenalty = Math.min(25, ratsnest.totalLengthMm / Math.max(1, components.length * 20))
  const score = Math.max(0, Math.round(100 - densityPenalty - ratsnestPenalty - (100 - edgeConnectorScore) * 0.25 - (100 - passiveScore) * 0.2))
  const issues = []
  if (density > 0.5) issues.push({ severity: 'WARNING', code: 'PLACEMENT_DENSITY_HIGH', message: 'Component density is high for automated routing; board may need to grow or use more layers.', details: { density } })
  if (edgeConnectorScore < 70) issues.push({ severity: 'WARNING', code: 'EDGE_CONNECTOR_PLACEMENT_WEAK', message: 'One or more connectors are not close to a board edge.', details: { edgeConnectorScore } })
  if (ratsnest.totalLengthMm > components.length * 35) issues.push({ severity: 'WARNING', code: 'RATSNEST_LONG', message: 'Estimated connection length is high; placement should be optimized before routing.', details: ratsnest })
  return {
    score,
    density: round(density),
    edgeConnectorScore,
    passiveProximityScore: passiveScore,
    ratsnest,
    issues,
  }
}

function scoreEdgeConnectors(bounds, components, profile) {
  const connectors = components.filter((component) => /^(USB|RJ45|SENSOR_CONNECTOR|ESC_CONNECTOR|POWER_INPUT)$/i.test(component.group || ''))
  if (!connectors.length) return 100
  const clearance = profile.componentToEdgeClearanceMm || 1
  const scores = connectors.map((component) => {
    const nearest = Math.min(Math.abs(component.x - bounds.minX), Math.abs(component.x - bounds.maxX), Math.abs(component.y - bounds.minY), Math.abs(component.y - bounds.maxY))
    return nearest <= clearance + Math.max(component.width || 0, component.height || 0) / 2 + 2 ? 100 : Math.max(0, 100 - nearest * 5)
  })
  return Math.round(scores.reduce((sum, item) => sum + item, 0) / scores.length)
}

function estimateRatsnest(components, nets) {
  const componentByRef = new Map(components.map((component) => [component.ref, component]))
  const explicit = nets.flatMap((net) => Array.isArray(net.refs) ? pairs(net.refs).map(([a, b]) => ({ net: net.name, a, b })) : [])
  const inferred = inferNetPairs(components)
  const pairsToScore = explicit.length ? explicit : inferred
  const connections = pairsToScore.map((connection) => {
    const a = componentByRef.get(connection.a)
    const b = componentByRef.get(connection.b)
    const lengthMm = a && b ? round(distance(a, b)) : 0
    return { ...connection, lengthMm }
  }).filter((connection) => connection.lengthMm > 0)
  return {
    connectionCount: connections.length,
    totalLengthMm: round(connections.reduce((sum, connection) => sum + connection.lengthMm, 0)),
    longestMm: round(Math.max(0, ...connections.map((connection) => connection.lengthMm))),
    connections: connections.slice(0, 24),
  }
}

function inferNetPairs(components) {
  const byNet = new Map()
  for (const component of components) {
    for (const net of Object.values(component.pinMap || {}).filter(Boolean)) {
      const refs = byNet.get(net) || []
      refs.push(component.ref)
      byNet.set(net, refs)
    }
  }
  return [...byNet.entries()].flatMap(([net, refs]) => pairs([...new Set(refs)]).map(([a, b]) => ({ net, a, b })))
}

function pairs(items) {
  const output = []
  for (let index = 0; index < items.length; index += 1) {
    for (let other = index + 1; other < items.length; other += 1) output.push([items[index], items[other]])
  }
  return output
}

function scorePassiveProximity(components) {
  const active = components.filter((component) => !['RES', 'CAP', 'INDUCTOR'].includes(component.group))
  const passives = components.filter((component) => ['RES', 'CAP', 'INDUCTOR'].includes(component.group))
  if (!active.length || !passives.length) return 100
  const scores = passives.map((passive) => {
    const nearest = Math.min(...active.map((item) => distance(passive, item)))
    return nearest <= 8 ? 100 : Math.max(0, 100 - (nearest - 8) * 8)
  })
  return Math.round(scores.reduce((sum, item) => sum + item, 0) / scores.length)
}
