import { distance, polygonBounds, round } from './geometry.mjs'
import { validatePlacement } from './validation.mjs'

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
  const scoring = scorePlacement(board, selectedComponents, options.nets || [], profile)
  return { status: issues.some((item) => ['BLOCKER', 'ERROR'].includes(item.severity)) ? 'NEEDS_FIX' : 'PLACEMENT_PLAN_READY', components: selectedComponents, rulesApplied: ['components fully inside outline', 'edge connectors placed on board edge intent', 'mounting hole clearance checked', 'component overlap checked', 'ratsnest length scored', 'passive proximity scored'], scoring, issues: [...issues, ...scoring.issues] }
}

export function fixComponentOffBoard(board, component, profile) {
  const bounds = polygonBounds(board.outline)
  return { ...component, x: round(Math.max(bounds.minX + component.width / 2 + profile.componentToEdgeClearanceMm, Math.min(bounds.maxX - component.width / 2 - profile.componentToEdgeClearanceMm, component.x))), y: round(Math.max(bounds.minY + component.height / 2 + profile.componentToEdgeClearanceMm, Math.min(bounds.maxY - component.height / 2 - profile.componentToEdgeClearanceMm, component.y))) }
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
