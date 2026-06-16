import { pointInPolygon, polygonBounds, rectCorners, round } from './geometry.mjs'
import { assignNetsToClasses, netClassProfiles } from './net-classes.mjs'
import { createDesignIntent, planViasForRoute } from './design-rules.mjs'

const defaultGridMm = 1
const routeOrder = ['BATTERY', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'CRYSTAL', 'CLOCK', 'SPI', 'I2C', 'UART', 'SENSOR', 'ANALOG', 'DEFAULT']

export function autorouteBoard({ board, components = [], nets = [], profile = {}, options = {} }) {
  const gridMm = Number(options.gridMm || defaultGridMm)
  const layerCount = Number(options.layerCount || board.layerCount || 2)
  const classified = assignNetsToClasses(nets).sort((a, b) => priority(a) - priority(b))
  const designIntent = createDesignIntent({ ...board, layerCount }, components, classified, profile)
  const obstacles = componentObstacles(components, profile, options)
  const occupied = new Set()
  const routes = []
  const warnings = []
  const errors = []

  for (const net of classified) {
    if (net.className === 'GROUND') continue
    const endpoints = inferEndpoints(net, components)
    const start = net.start || endpoints.start
    const end = net.end || endpoints.end
    if (!start || !end) {
      warnings.push(issue('WARNING', 'AUTOROUTE_ENDPOINTS_MISSING', `${net.name} needs two component endpoints or explicit start/end points.`, { net: net.name, refs: endpoints.refs }))
      routes.push(routeShell(net, start, end, endpoints, 'unrouted_missing_endpoints'))
      continue
    }
    const route = routeNet({ net, start, end, endpoints, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount })
    routes.push(route)
    if (route.status === 'routed') {
      reserveRoute(route, occupied, gridMm)
    } else {
      warnings.push(issue('WARNING', 'AUTOROUTE_NET_UNROUTED', `${net.name} could not be routed without violating current obstacles/board outline.`, { net: net.name, reason: route.status }))
    }
  }

  const routedNets = routes.filter((route) => route.status === 'routed').map((route) => route.net)
  const unroutedNets = routes.filter((route) => route.status !== 'routed').map((route) => route.net)
  return {
    status: errors.length ? 'AUTOROUTE_BLOCKED' : unroutedNets.length ? 'AUTOROUTE_PARTIAL_NEEDS_REVIEW' : 'AUTOROUTE_READY_NEEDS_DRC',
    router: {
      name: 'BoardForge controlled grid router',
      gridMm,
      layerCount,
      mode: 'deterministic_astar_review_required',
      limitations: [
        'Routes only nets with known start/end points.',
        'Does not replace KiCad DRC or human review.',
        'High-speed impedance and exact length tuning remain review-required.',
      ],
    },
    routedNets,
    unroutedNets,
    routes,
    designIntent,
    warnings,
    errors,
    humanReviewRequired: true,
  }
}

function routeNet({ net, start, end, endpoints, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount }) {
  const rules = netClassProfiles[net.className || 'DEFAULT'] || netClassProfiles.DEFAULT
  const sensitive = ['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RF', 'CRYSTAL', 'CLOCK'].includes(net.className || '')
  const preferredLayers = sensitive ? ['F.Cu'] : rules.layerPreference || ['F.Cu', 'B.Cu']
  for (const layer of preferredLayers) {
    const path = findPath({ board, start, end, obstacles, occupied, gridMm, layer, netClass: net.className || 'DEFAULT', allowedRefs: endpoints.refs || [] })
    if (path.length) return routed(net, start, end, endpoints, path, layer, layerCount, board, designIntent, profile, options)
  }
  if (!sensitive && layerCount >= 2) {
    const midpoint = midpointInside(board, start, end)
    const first = findPath({ board, start, end: midpoint, obstacles, occupied, gridMm, layer: 'F.Cu', netClass: net.className || 'DEFAULT', allowedRefs: endpoints.refs || [] })
    const second = findPath({ board, start: midpoint, end, obstacles, occupied, gridMm, layer: 'B.Cu', netClass: net.className || 'DEFAULT', allowedRefs: endpoints.refs || [] })
    if (first.length && second.length) {
      const viaPlan = planViasForRoute({ net, start, end, board, zones: designIntent.zones, profile })
      const via = { ...midpoint, diameterMm: viaPlan.rules?.diameterMm || profile.minViaDiameterMm || 0.45, drillMm: viaPlan.rules?.drillMm || profile.minViaDrillMm || 0.2, layers: ['F.Cu', 'B.Cu'], reason: 'autorouter layer change' }
      return routed(net, start, end, endpoints, [...first, ...second.slice(1)], 'F.Cu', layerCount, board, designIntent, profile, options, [via])
    }
  }
  return routeShell(net, start, end, endpoints, 'unrouted_no_path')
}

function findPath({ board, start, end, obstacles, occupied, gridMm, layer, netClass, allowedRefs = [] }) {
  const bounds = polygonBounds(board.outline || [])
  const startNode = snap(start, gridMm)
  const endNode = snap(end, gridMm)
  const open = new Map([[key(startNode), { point: startNode, cost: 0, priority: heuristic(startNode, endNode), parent: null }]])
  const closed = new Set()
  let iterations = 0
  const maxIterations = 25000
  while (open.size && iterations < maxIterations) {
    iterations += 1
    const current = lowest(open)
    open.delete(key(current.point))
    if (heuristic(current.point, endNode) <= gridMm * 0.75) return simplifyPath(reconstruct(current, end), gridMm)
    closed.add(key(current.point))
    for (const next of neighbors(current.point, gridMm, netClass)) {
      const nextKey = key(next)
      if (closed.has(nextKey)) continue
      if (!insideBoard(next, board, bounds)) continue
      if (blocked(next, obstacles, occupied, layer, startNode, endNode, gridMm, allowedRefs)) continue
      const turnPenalty = current.parent && direction(current.parent.point, current.point) !== direction(current.point, next) ? 0.15 : 0
      const step = heuristic(current.point, next) + turnPenalty + occupiedPenalty(next, occupied, layer)
      const cost = current.cost + step
      const existing = open.get(nextKey)
      if (!existing || cost < existing.cost) open.set(nextKey, { point: next, cost, priority: cost + heuristic(next, endNode), parent: current })
    }
  }
  return []
}

function componentObstacles(components, profile, options) {
  const clearance = Number(options.componentClearanceMm || profile.componentToComponentClearanceMm || 0.3)
  return components
    .filter((component) => component.x !== undefined && component.y !== undefined && component.width && component.height)
    .map((component) => ({ ref: component.ref, polygon: rectCorners(component, clearance), clearance }))
}

function inferEndpoints(net, components) {
  const refs = []
  for (const component of components) {
    if (Object.values(component.pinMap || {}).includes(net.name)) refs.push(component.ref)
  }
  const matched = components.filter((component) => refs.includes(component.ref))
  if (matched.length >= 2) return { start: pointFor(matched[0]), end: pointFor(matched[1]), refs }
  if (matched.length === 1 && net.end) return { start: pointFor(matched[0]), end: net.end, refs }
  return { start: null, end: null, refs }
}

function routed(net, start, end, endpoints, path, layer, layerCount, board, designIntent, profile, options, vias = []) {
  const rules = netClassProfiles[net.className || 'DEFAULT'] || netClassProfiles.DEFAULT
  const widthMm = Math.max(options.widthMm || 0, rules.traceWidthMm || 0.15, profile.minTraceWidthMm || 0.127)
  const viaPlan = planViasForRoute({ net, start, end, board: { ...board, layerCount }, zones: designIntent.zones, profile })
  return {
    net: net.name,
    className: net.className || 'DEFAULT',
    start,
    end,
    endpointRefs: endpoints.refs,
    strategy: vias.length ? 'controlled_astar_with_layer_change' : 'controlled_astar_single_layer',
    widthMm,
    clearanceMm: Math.max(rules.clearanceMm || 0.15, profile.minClearanceMm || 0.127),
    layerPreference: [layer],
    viaPlan: { ...viaPlan, candidates: vias, maxVias: vias.length || viaPlan.maxVias || 0 },
    waypoints: path,
    estimatedLengthMm: routeLength(path),
    status: 'routed',
  }
}

function routeShell(net, start, end, endpoints, status) {
  const rules = netClassProfiles[net.className || 'DEFAULT'] || netClassProfiles.DEFAULT
  return {
    net: net.name,
    className: net.className || 'DEFAULT',
    start: start || null,
    end: end || null,
    endpointRefs: endpoints.refs,
    strategy: 'not_routed',
    widthMm: rules.traceWidthMm,
    clearanceMm: rules.clearanceMm,
    layerPreference: rules.layerPreference,
    viaPlan: { viaStack: 'none', candidates: [], maxVias: 0 },
    waypoints: [],
    estimatedLengthMm: 0,
    status,
  }
}

function neighbors(point, gridMm, netClass) {
  const cardinal = [
    { x: point.x + gridMm, y: point.y },
    { x: point.x - gridMm, y: point.y },
    { x: point.x, y: point.y + gridMm },
    { x: point.x, y: point.y - gridMm },
  ]
  if (['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'CRYSTAL', 'CLOCK'].includes(netClass)) {
    return [
      ...cardinal,
      { x: point.x + gridMm, y: point.y + gridMm },
      { x: point.x - gridMm, y: point.y - gridMm },
      { x: point.x + gridMm, y: point.y - gridMm },
      { x: point.x - gridMm, y: point.y + gridMm },
    ]
  }
  return cardinal
}

function blocked(point, obstacles, occupied, layer, start, end, gridMm, allowedRefs = []) {
  if (heuristic(point, start) <= gridMm || heuristic(point, end) <= gridMm) return false
  if (obstacles.some((obstacle) => !allowedRefs.includes(obstacle.ref) && pointInPolygon(point, obstacle.polygon))) return true
  return occupied.has(`${layer}:${key(point)}`)
}

function reserveRoute(route, occupied, gridMm) {
  for (const point of route.waypoints || []) {
    occupied.add(`${route.layerPreference?.[0] || 'F.Cu'}:${key(snap(point, gridMm))}`)
  }
}

function occupiedPenalty(point, occupied, layer) {
  return occupied.has(`${layer}:${key(point)}`) ? 10 : 0
}

function insideBoard(point, board, bounds) {
  if (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY) return false
  return pointInPolygon(point, board.outline || [])
}

function midpointInside(board, start, end) {
  const mid = { x: round((start.x + end.x) / 2), y: round((start.y + end.y) / 2) }
  if (pointInPolygon(mid, board.outline || [])) return mid
  return start
}

function simplifyPath(points, gridMm) {
  if (points.length <= 2) return points
  const simplified = [points[0]]
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = simplified[simplified.length - 1]
    const current = points[index]
    const next = points[index + 1]
    if (direction(prev, current) === direction(current, next)) continue
    simplified.push(current)
  }
  simplified.push(points[points.length - 1])
  return simplified.map((point) => ({ x: round(point.x), y: round(point.y) })).filter((point, index, list) => index === 0 || heuristic(point, list[index - 1]) >= gridMm * 0.5)
}

function reconstruct(node, exactEnd) {
  const points = [exactEnd]
  let current = node
  while (current) {
    points.unshift(current.point)
    current = current.parent
  }
  return points
}

function lowest(open) {
  return [...open.values()].reduce((best, item) => item.priority < best.priority ? item : best)
}

function key(point) {
  return `${round(point.x, 2)},${round(point.y, 2)}`
}

function snap(point, gridMm) {
  return { x: round(Math.round(point.x / gridMm) * gridMm), y: round(Math.round(point.y / gridMm) * gridMm) }
}

function heuristic(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function direction(a, b) {
  return `${Math.sign(round(b.x - a.x))},${Math.sign(round(b.y - a.y))}`
}

function routeLength(points) {
  let length = 0
  for (let index = 1; index < points.length; index += 1) length += heuristic(points[index - 1], points[index])
  return round(length, 2)
}

function pointFor(component) {
  return { x: Number(component.x || 0), y: Number(component.y || 0) }
}

function priority(net) {
  const index = routeOrder.indexOf(net.className || 'DEFAULT')
  return index === -1 ? 999 : index
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
