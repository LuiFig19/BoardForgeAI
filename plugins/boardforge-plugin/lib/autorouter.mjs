import { pointInPolygon, polygonBounds, rectCorners, round } from './geometry.mjs'
import { assignNetsToClasses, netClassProfiles } from './net-classes.mjs'
import { createDesignIntent, planViasForRoute } from './design-rules.mjs'

const defaultGridMm = 1
const routeOrder = ['BATTERY', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'CRYSTAL', 'CLOCK', 'SPI', 'I2C', 'UART', 'SENSOR', 'ANALOG', 'DEFAULT']

export function autorouteBoard({ board, components = [], nets = [], pads = [], existingTracks = [], existingVias = [], profile = {}, options = {} }) {
  const gridMm = Number(options.gridMm || defaultGridMm)
  const layerCount = Number(options.layerCount || board.layerCount || 2)
  const classified = assignNetsToClasses(nets).sort((a, b) => priority(a) - priority(b))
  const designIntent = createDesignIntent({ ...board, layerCount }, components, classified, profile)
  const obstacles = [
    ...componentObstacles(components, profile, options),
    ...padObstacles(pads, profile, options),
    ...mountingHoleObstacles(board.mountingHoles || [], profile),
    ...zoneTraceObstacles(designIntent.zones || []),
  ]
  const occupied = new Set()
  reserveExistingCopper(occupied, existingTracks, existingVias, gridMm)
  const routes = []
  const warnings = []
  const errors = []
  const processed = new Set()

  for (const net of classified) {
    if (processed.has(net.name)) continue
    if (net.className === 'GROUND') continue
    const mate = diffMateFor(net, classified)
    if (mate && !processed.has(mate.name)) {
      const pairRoutes = routeDifferentialPair({ net, mate, board, components, pads, profile, options, designIntent, obstacles, occupied, gridMm, layerCount })
      routes.push(...pairRoutes.routes)
      warnings.push(...pairRoutes.warnings)
      processed.add(net.name)
      processed.add(mate.name)
      for (const route of pairRoutes.routes.filter((item) => item.status === 'routed')) reserveRoute(route, occupied, gridMm)
      continue
    }
    const endpoints = inferEndpoints(net, components, pads)
    if (endpoints.all?.length > 2) {
      const multi = routeMultiTerminalNet({ net, endpoints, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount })
      routes.push(...multi.routes)
      warnings.push(...multi.warnings)
      for (const route of multi.routes.filter((item) => item.status === 'routed')) reserveRoute(route, occupied, gridMm)
      processed.add(net.name)
      continue
    }
    const start = net.start || endpoints.start
    const end = net.end || endpoints.end
    if (!start || !end) {
      warnings.push(issue('WARNING', 'AUTOROUTE_ENDPOINTS_MISSING', `${net.name} needs two component endpoints or explicit start/end points.`, { net: net.name, refs: endpoints.refs }))
      processed.add(net.name)
      continue
    }
    const route = routeNet({ net, start, end, endpoints, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount })
    routes.push(route)
    if (route.status === 'routed') {
      reserveRoute(route, occupied, gridMm)
    } else {
      warnings.push(issue('WARNING', 'AUTOROUTE_NET_UNROUTED', `${net.name} could not be routed without violating current obstacles/board outline.`, { net: net.name, reason: route.status }))
    }
    processed.add(net.name)
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

function routeMultiTerminalNet({ net, endpoints, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount }) {
  const warnings = []
  const routes = []
  const legs = minimumSpanningLegs(endpoints.all)
  for (const [index, leg] of legs.entries()) {
    const [startPoint, endPoint] = leg
    const legEndpoints = {
      refs: [...new Set([startPoint.ref, endPoint.ref].filter(Boolean))],
      pads: [startPoint.id, endPoint.id].filter(Boolean),
      source: 'multi_terminal_pad_tree',
    }
    const route = routeNet({ net, start: startPoint, end: endPoint, endpoints: legEndpoints, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount })
    route.branchIndex = index + 1
    route.multiTerminal = { totalEndpoints: endpoints.all.length, treeLegs: legs.length }
    routes.push(route)
    if (route.status === 'routed') reserveRoute(route, occupied, gridMm)
    else warnings.push(issue('WARNING', 'AUTOROUTE_MULTI_TERMINAL_LEG_UNROUTED', `${net.name} branch ${index + 1} could not be routed.`, { net: net.name, branchIndex: index + 1, reason: route.status }))
  }
  return { routes, warnings }
}

function routeDifferentialPair({ net, mate, board, components, pads, profile, options, designIntent, obstacles, occupied, gridMm, layerCount }) {
  const warnings = []
  const firstEndpoints = inferEndpoints(net, components, pads)
  const secondEndpoints = inferEndpoints(mate, components, pads)
  const firstStart = net.start || firstEndpoints.start
  const firstEnd = net.end || firstEndpoints.end
  const secondStart = mate.start || secondEndpoints.start
  const secondEnd = mate.end || secondEndpoints.end
  if (!firstStart || !firstEnd || !secondStart || !secondEnd) {
    warnings.push(issue('WARNING', 'AUTOROUTE_DIFF_PAIR_ENDPOINTS_MISSING', `${net.name}/${mate.name} needs endpoints for both pair members.`, { nets: [net.name, mate.name] }))
    return { warnings, routes: [routeShell(net, firstStart, firstEnd, firstEndpoints, 'unrouted_missing_endpoints'), routeShell(mate, secondStart, secondEnd, secondEndpoints, 'unrouted_missing_endpoints')] }
  }
  const pairStart = averagePoint(firstStart, secondStart)
  const pairEnd = averagePoint(firstEnd, secondEnd)
  const centerRoute = routeNet({ net: { ...net, name: `${net.name}_${mate.name}_PAIR` }, start: pairStart, end: pairEnd, endpoints: { refs: [...new Set([...(firstEndpoints.refs || []), ...(secondEndpoints.refs || [])])] }, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount })
  if (centerRoute.status !== 'routed') {
    warnings.push(issue('WARNING', 'AUTOROUTE_DIFF_PAIR_UNROUTED', `${net.name}/${mate.name} pair centerline could not be routed.`, { nets: [net.name, mate.name], reason: centerRoute.status }))
    return { warnings, routes: [routeShell(net, firstStart, firstEnd, firstEndpoints, centerRoute.status), routeShell(mate, secondStart, secondEnd, secondEndpoints, centerRoute.status)] }
  }
  const spacingMm = Number(options.diffPairSpacingMm || 0.25)
  const firstPath = offsetPath(centerRoute.waypoints, spacingMm)
  const secondPath = offsetPath(centerRoute.waypoints, -spacingMm)
  return {
    warnings,
    routes: [
      routedPairMember(net, firstStart, firstEnd, firstEndpoints, firstPath, centerRoute, spacingMm),
      routedPairMember(mate, secondStart, secondEnd, secondEndpoints, secondPath, centerRoute, spacingMm),
    ],
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
  const edgeClearanceMm = Number(board.routeEdgeClearanceMm || 0.8)
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
      if (!insideBoard(next, board, bounds, edgeClearanceMm)) continue
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

function padObstacles(pads, profile, options) {
  const clearance = Number(options.padClearanceMm || profile.minClearanceMm || 0.15)
  return pads
    .filter((pad) => Number.isFinite(pad.x) && Number.isFinite(pad.y) && pad.widthMm && pad.heightMm)
    .map((pad) => ({
      ref: pad.ref,
      pad: pad.pad || pad.name,
      netName: pad.netName,
      polygon: rectPolygon(pad.x, pad.y, pad.widthMm + clearance * 2, pad.heightMm + clearance * 2),
      clearance,
      kind: 'pad',
    }))
}

function mountingHoleObstacles(holes, profile) {
  const clearance = Number(profile.mountingHoleEdgeClearanceMm || 0.8)
  return holes
    .filter((hole) => Number.isFinite(hole.x) && Number.isFinite(hole.y) && hole.diameterMm)
    .map((hole) => ({
      ref: hole.id,
      polygon: rectPolygon(hole.x, hole.y, hole.diameterMm + clearance * 2, hole.diameterMm + clearance * 2),
      clearance,
      kind: 'mounting_hole',
    }))
}

function zoneTraceObstacles(zones) {
  return zones
    .filter((zone) => zone.allowCopper === false || zone.allowTraces === false)
    .map((zone) => ({ ref: zone.id, kind: zone.kind, polygon: zone.polygon || [], clearance: 0 }))
}

function inferEndpoints(net, components, pads = []) {
  const padEndpoints = endpointsFromPads(net, pads)
  if (padEndpoints.length >= 2) {
    return {
      start: padEndpoints[0],
      end: padEndpoints[1],
      all: allPadEndpoints(net, pads),
      refs: [...new Set(padEndpoints.map((pad) => pad.ref).filter(Boolean))],
      pads: padEndpoints.map((pad) => pad.id || `${pad.ref}:${pad.pad}`),
      source: 'real_pad_centers',
    }
  }
  const refs = []
  for (const component of components) {
    if (Object.values(component.pinMap || {}).includes(net.name)) refs.push(component.ref)
  }
  const matched = components.filter((component) => refs.includes(component.ref))
  if (matched.length >= 2) return { start: pointFor(matched[0]), end: pointFor(matched[1]), all: matched.map(pointFor), refs, source: 'component_centers' }
  if (matched.length === 1 && net.end) return { start: pointFor(matched[0]), end: net.end, refs, source: 'component_to_explicit_point' }
  return { start: null, end: null, refs, pads: [], source: 'missing' }
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

function routedPairMember(net, start, end, endpoints, path, centerRoute, spacingMm) {
  return {
    ...centerRoute,
    net: net.name,
    className: net.className || centerRoute.className || 'DEFAULT',
    start,
    end,
    endpointRefs: endpoints.refs,
    strategy: 'controlled_astar_matched_diff_pair',
    differentialPair: { mate: diffMateName(net.name), spacingMm, centerlineLengthMm: centerRoute.estimatedLengthMm, lengthMatched: true },
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

function reserveExistingCopper(occupied, tracks, vias, gridMm) {
  for (const track of tracks || []) {
    const layer = track.layer || 'F.Cu'
    for (const point of sampledSegment(track.start, track.end, gridMm)) occupied.add(`${layer}:${key(snap(point, gridMm))}`)
  }
  for (const via of vias || []) {
    for (const layer of via.layers?.length ? via.layers : ['F.Cu', 'B.Cu']) occupied.add(`${layer}:${key(snap(via, gridMm))}`)
  }
}

function sampledSegment(start, end, gridMm) {
  if (!start || !end) return []
  const length = heuristic(start, end)
  const steps = Math.max(1, Math.ceil(length / gridMm))
  const points = []
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    points.push({ x: round(start.x + (end.x - start.x) * t), y: round(start.y + (end.y - start.y) * t) })
  }
  return points
}

function occupiedPenalty(point, occupied, layer) {
  return occupied.has(`${layer}:${key(point)}`) ? 10 : 0
}

function insideBoard(point, board, bounds, edgeClearanceMm = 0) {
  if (point.x < bounds.minX + edgeClearanceMm || point.x > bounds.maxX - edgeClearanceMm || point.y < bounds.minY + edgeClearanceMm || point.y > bounds.maxY - edgeClearanceMm) return false
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

function endpointsFromPads(net, pads) {
  const explicitPins = new Set((net.pins || []).map((pin) => `${pin.ref || pin.componentRef}:${pin.pin || pin.pad || pin.name}`))
  const byNet = pads.filter((pad) => pad.netName === net.name || explicitPins.has(`${pad.ref}:${pad.pad}`) || explicitPins.has(`${pad.ref}:${pad.name}`))
  if (byNet.length >= 2) return farthestPair(byNet)
  return byNet
}

function allPadEndpoints(net, pads) {
  const explicitPins = new Set((net.pins || []).map((pin) => `${pin.ref || pin.componentRef}:${pin.pin || pin.pad || pin.name}`))
  return pads.filter((pad) => pad.netName === net.name || explicitPins.has(`${pad.ref}:${pad.pad}`) || explicitPins.has(`${pad.ref}:${pad.name}`))
}

function minimumSpanningLegs(points) {
  if (points.length < 2) return []
  const connected = [points[0]]
  const remaining = points.slice(1)
  const legs = []
  while (remaining.length) {
    let best = null
    for (const start of connected) {
      for (const end of remaining) {
        const cost = heuristic(start, end)
        if (!best || cost < best.cost) best = { start, end, cost }
      }
    }
    legs.push([best.start, best.end])
    connected.push(best.end)
    remaining.splice(remaining.indexOf(best.end), 1)
  }
  return legs
}

function farthestPair(points) {
  let best = [points[0], points[1]]
  let bestDistance = -1
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) {
      const distance = heuristic(points[a], points[b])
      if (distance > bestDistance) {
        bestDistance = distance
        best = [points[a], points[b]]
      }
    }
  }
  return best
}

function rectPolygon(x, y, width, height) {
  const halfW = width / 2
  const halfH = height / 2
  return [
    { x: x - halfW, y: y - halfH },
    { x: x + halfW, y: y - halfH },
    { x: x + halfW, y: y + halfH },
    { x: x - halfW, y: y + halfH },
  ]
}

function diffMateFor(net, nets) {
  const mateName = diffMateName(net.name)
  if (!mateName || !['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF'].includes(net.className || '')) return null
  return nets.find((candidate) => candidate.name === mateName && candidate.className === net.className) || null
}

function diffMateName(name) {
  if (/_DP$/.test(name)) return name.replace(/_DP$/, '_DN')
  if (/_DN$/.test(name)) return name.replace(/_DN$/, '_DP')
  if (/_P$/.test(name)) return name.replace(/_P$/, '_N')
  if (/_N$/.test(name)) return name.replace(/_N$/, '_P')
  if (/\+$/.test(name)) return name.replace(/\+$/, '-')
  if (/-$/.test(name)) return name.replace(/-$/, '+')
  return null
}

function averagePoint(a, b) {
  return { x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) }
}

function offsetPath(path, amount) {
  if (!path.length) return []
  return path.map((point, index) => {
    const prev = path[Math.max(0, index - 1)]
    const next = path[Math.min(path.length - 1, index + 1)]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const length = Math.hypot(dx, dy) || 1
    return { x: round(point.x + (-dy / length) * amount), y: round(point.y + (dx / length) * amount) }
  })
}

function priority(net) {
  const index = routeOrder.indexOf(net.className || 'DEFAULT')
  return index === -1 ? 999 : index
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
