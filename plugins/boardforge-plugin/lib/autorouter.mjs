import { distancePointToSegment, pointInPolygon, polygonBounds, rectCorners, round, segmentsIntersect } from './geometry.mjs'
import { assignNetsToClasses, netClassProfiles } from './net-classes.mjs'
import { createDesignIntent, planViasForRoute } from './design-rules.mjs'

const defaultGridMm = 0.5
const routeOrder = ['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'CRYSTAL', 'CLOCK', 'RESET', 'BOOT', 'DEBUG', 'SPI', 'I2C', 'UART', 'SENSOR', 'ANALOG', 'BATTERY', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'GROUND', 'DEFAULT']

export function autorouteBoard({ board, components = [], nets = [], pads = [], existingTracks = [], existingVias = [], profile = {}, options = {} }) {
  const gridMm = Number(options.gridMm || defaultGridMm)
  const layerCount = Number(options.layerCount || board.layerCount || 2)
  const classified = sortNetsForAutoroute(assignNetsToClasses(nets), options)
  const maxRouteNets = Number(options.maxRouteNets || 0)
  const routeQueue = maxRouteNets > 0 ? classified.slice(0, maxRouteNets) : classified
  const designIntent = createDesignIntent({ ...board, layerCount }, components, classified, profile)
  const obstacles = [
    ...componentObstacles(components, profile, options),
    ...padObstacles(pads, profile, options),
    ...mountingHoleObstacles(board.mountingHoles || [], profile),
    ...zoneTraceObstacles(designIntent.zones || []),
    ...drcForbiddenObstacles(options.drcRerouteConstraints?.forbiddenPoints || options.forbiddenPoints || []),
  ]
  const occupied = new Set()
  occupied.routeSegments = []
  occupied.pointNets = new Map()
  reserveExistingCopper(occupied, existingTracks, existingVias, gridMm)
  const routes = []
  const warnings = []
  const errors = []
  const skippedNets = []
  const processed = new Set()

  if (maxRouteNets > 0 && classified.length > routeQueue.length) {
    skippedNets.push(...classified.slice(routeQueue.length).map((net) => ({ net: net.name, reason: 'endpoint repair route planning budget deferred this net' })))
  }

  for (const net of routeQueue) {
    const processKey = net.instanceId || net.routeInstanceId || net.name
    if (processed.has(processKey)) continue
    if ((net.className === 'GROUND' || /^GND$/i.test(String(net.name || ''))) && options.routeGroundNets !== true) {
      skippedNets.push({ net: net.name, reason: 'ground handled by copper pour and stitching plan, not point-to-point signal routing' })
      processed.add(processKey)
      continue
    }
    if (!isPhysicallyRoutableNet(net, components, pads)) {
      skippedNets.push({ net: net.name, reason: 'net has fewer than two physical pins and no explicit start/end route points' })
      processed.add(processKey)
      continue
    }
    const endpoints = inferEndpoints(net, components, pads, options)
    if (!net.start && !net.end && endpoints.all?.length > 2) {
      const multi = routeMultiTerminalNet({ net, endpoints, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount })
      routes.push(...multi.routes)
      warnings.push(...multi.warnings)
      for (const route of multi.routes.filter((item) => item.status === 'routed')) reserveRoute(route, occupied, gridMm)
      processed.add(net.name)
      continue
    }
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
    const start = net.start || endpoints.start
    const end = net.end || endpoints.end
    if (!start || !end) {
      skippedNets.push({ net: net.name, reason: 'no component endpoint pads were found for this net', refs: endpoints.refs || [] })
      processed.add(processKey)
      continue
    }
    const route = routeNet({ net, start, end, endpoints, board, components, pads, profile, options, designIntent, obstacles, occupied, gridMm, layerCount })
    routes.push(route)
    if (route.status === 'routed') {
      reserveRoute(route, occupied, gridMm)
    } else {
      warnings.push(issue('WARNING', 'AUTOROUTE_NET_UNROUTED', `${net.name} could not be routed without violating current obstacles/board outline.`, { net: net.name, reason: route.status }))
    }
    processed.add(processKey)
  }

  if (options.enableUsbPadStitching === true) {
    const stitchRoutes = connectorPadStitchRoutes({ classified, pads, board, designIntent, profile, options, layerCount })
    for (const route of stitchRoutes) {
      if (!pathCrossesOccupied(route.waypoints || [], occupied, route.layerPreference?.[0] || 'F.Cu', route.net)) {
        routes.push(route)
        reserveRoute(route, occupied, gridMm)
      }
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
    skippedNets,
    routes,
    routeGroundNets: options.routeGroundNets === true,
    writeUsbSupportCompletion: options.writeUsbSupportCompletion === true,
    designIntent,
    warnings,
    errors,
    humanReviewRequired: true,
  }
}

function sortNetsForAutoroute(nets = [], options = {}) {
  const priorityNets = (options.priorityNets || []).map(normalizeNetName)
  const prioritySet = new Set(priorityNets)
  return [...nets].sort((a, b) => {
    const an = normalizeNetName(a.name || a.net || a)
    const bn = normalizeNetName(b.name || b.net || b)
    const ai = priorityNets.indexOf(an)
    const bi = priorityNets.indexOf(bn)
    const ar = ai >= 0 ? ai : 999999
    const br = bi >= 0 ? bi : 999999
    if (ar !== br) return ar - br
    if (prioritySet.has(an) !== prioritySet.has(bn)) return prioritySet.has(an) ? -1 : 1
    return priority(a) - priority(b)
  })
}

function normalizeNetName(value) {
  const text = String(value || '').trim()
  return text.startsWith('/') ? text : `/${text}`
}

function connectorPadStitchRoutes({ classified, pads, board, designIntent, profile, options, layerCount }) {
  const netByName = new Map(classified.map((net) => [net.name, net]))
  const usbPads = pads.filter((pad) => /USB_C|TYPE-C|TYPE_C|USB/.test(String(pad.footprint || '')) && pad.ref && pad.netName)
  const byRefNet = new Map()
  for (const pad of usbPads) {
    const key = `${pad.ref}:${pad.netName}`
    if (!byRefNet.has(key)) byRefNet.set(key, [])
    byRefNet.get(key).push(pad)
  }
  const routes = []
  for (const [key, group] of byRefNet.entries()) {
    if (group.length < 2) continue
    const [, netName] = key.split(':')
    if (!/^(USB_DP|USB_DN|VUSB|VBUS)$/i.test(netName)) continue
    const sorted = [...group].sort((a, b) => a.y - b.y || a.x - b.x)
    for (let index = 1; index < sorted.length; index += 1) {
      const start = sorted[index - 1]
      const end = sorted[index]
      if (Math.hypot(start.x - end.x, start.y - end.y) < 0.05) continue
      const path = usbStitchPath(start, end, netName)
      if (!pathInsideBoard(path, board)) continue
      const net = netByName.get(netName) || { name: netName, className: netClassForStitch(netName) }
      const route = routed(net, start, end, { refs: [start.ref], pads: [start.id, end.id].filter(Boolean), source: 'usb_duplicate_pad_stitch' }, path, 'F.Cu', layerCount, board, designIntent, profile, { ...options, widthMm: 0.127 }, [])
      route.strategy = 'controlled_usb_duplicate_pad_stitch'
      route.reviewNotes = 'Same-net USB-C duplicate pads stitched outside the dense connector pad row.'
      routes.push(route)
    }
  }
  return routes
}

function usbStitchPath(start, end, netName) {
  const rightLane = /USB_DP|VUSB|VBUS/i.test(netName)
  const laneX = round((rightLane ? Math.max(start.x, end.x) + 0.75 : Math.min(start.x, end.x) - 0.75))
  return cleanupPathAngles(dedupePath([
    { x: round(start.x), y: round(start.y) },
    { x: laneX, y: round(start.y) },
    { x: laneX, y: round(end.y) },
    { x: round(end.x), y: round(end.y) },
  ]))
}

function netClassForStitch(netName) {
  if (/USB_D[PN]/i.test(netName)) return 'USB_DIFF'
  if (/VUSB|VBUS/i.test(netName)) return 'POWER_LOW_CURRENT'
  return 'DEFAULT'
}

function routeMultiTerminalNet({ net, endpoints, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount }) {
  const warnings = []
  const routes = []
  const maxLegs = Number(options.maxMultiTerminalLegs || 0)
  const allLegs = minimumSpanningLegs(endpoints.all)
  const legs = maxLegs > 0 ? allLegs.slice(0, maxLegs) : allLegs
  if (legs.length < allLegs.length) {
    warnings.push(issue('WARNING', 'AUTOROUTE_MULTI_TERMINAL_LEG_BUDGET', `${net.name} routed ${legs.length} of ${allLegs.length} multi-terminal branch candidates in this bounded pass.`, { net: net.name, routedLegs: legs.length, totalLegs: allLegs.length }))
  }
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
  const firstEndpoints = inferEndpoints(net, components, pads, options)
  const secondEndpoints = inferEndpoints(mate, components, pads, options)
  const firstStart = net.start || firstEndpoints.start
  const firstEnd = net.end || firstEndpoints.end
  const secondStart = mate.start || secondEndpoints.start
  const secondEnd = mate.end || secondEndpoints.end
  if (!firstStart || !firstEnd || !secondStart || !secondEnd) {
    warnings.push(issue('WARNING', 'AUTOROUTE_DIFF_PAIR_ENDPOINTS_MISSING', `${net.name}/${mate.name} needs endpoints for both pair members.`, { nets: [net.name, mate.name] }))
    return { warnings, routes: [routeShell(net, firstStart, firstEnd, firstEndpoints, 'unrouted_missing_endpoints'), routeShell(mate, secondStart, secondEnd, secondEndpoints, 'unrouted_missing_endpoints')] }
  }
  const laneRoutes = differentialLaneRoutes({ net, mate, firstStart, firstEnd, secondStart, secondEnd, firstEndpoints, secondEndpoints, board, designIntent, profile, options })
  if (laneRoutes.length) return withDifferentialSidecars({ warnings, routes: laneRoutes, net, mate, firstEndpoints, secondEndpoints, board, designIntent, profile, options, layerCount })
  const swappedLaneRoutes = usbReversedOrderLaneRoutes({ net, mate, firstStart, firstEnd, secondStart, secondEnd, firstEndpoints, secondEndpoints, board, designIntent, profile, options })
  if (swappedLaneRoutes.length) return withDifferentialSidecars({ warnings, routes: swappedLaneRoutes, net, mate, firstEndpoints, secondEndpoints, board, designIntent, profile, options, layerCount })
  const firstRoute = routeNet({ net, start: firstStart, end: firstEnd, endpoints: firstEndpoints, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount })
  if (firstRoute.status === 'routed') reserveRoute(firstRoute, occupied, gridMm)
  const secondRoute = routeNet({ net: mate, start: secondStart, end: secondEnd, endpoints: secondEndpoints, board, components, profile, options, designIntent, obstacles, occupied, gridMm, layerCount })
  if (firstRoute.status !== 'routed' || secondRoute.status !== 'routed') {
    warnings.push(issue('WARNING', 'AUTOROUTE_DIFF_PAIR_UNROUTED', `${net.name}/${mate.name} pair members could not both be routed.`, { nets: [net.name, mate.name], first: firstRoute.status, second: secondRoute.status }))
  } else {
    const mismatch = Math.abs((firstRoute.estimatedLengthMm || 0) - (secondRoute.estimatedLengthMm || 0))
    if (mismatch > 1.5) warnings.push(issue('WARNING', 'DIFF_PAIR_LENGTH_REVIEW', `${net.name}/${mate.name} length mismatch is ${round(mismatch)}mm and needs tuning.`, { nets: [net.name, mate.name], mismatchMm: round(mismatch) }))
  }
  return { warnings, routes: [firstRoute, secondRoute] }
}

function withDifferentialSidecars({ warnings, routes, net, mate, firstEndpoints, secondEndpoints, board, designIntent, profile, options, layerCount }) {
  if (options.enableProtectionSidecars !== true) return { warnings, routes }
  const sidecars = [
    ...sameNetSidecarRoutes({ net, baseRoute: routes.find((route) => route.net === net.name), endpoints: firstEndpoints, board, designIntent, profile, options, layerCount }),
    ...sameNetSidecarRoutes({ net: mate, baseRoute: routes.find((route) => route.net === mate.name), endpoints: secondEndpoints, board, designIntent, profile, options, layerCount }),
  ]
  if (sidecars.length) {
    warnings.push(issue('WARNING', 'DIFF_PAIR_SIDECAR_BRANCHES_ADDED', 'Protection/connector same-net pads were stitched into the controlled differential route and need DRC/length review.', { routes: sidecars.map((route) => ({ net: route.net, strategy: route.strategy })) }))
  }
  return { warnings, routes: [...routes, ...sidecars] }
}

function sameNetSidecarRoutes({ net, baseRoute, endpoints, board, designIntent, profile, options, layerCount }) {
  if (!baseRoute?.waypoints?.length || !endpoints?.all?.length) return []
  const baseKeys = new Set([padIdentity(baseRoute.start), padIdentity(baseRoute.end)])
  const extras = endpoints.all
    .filter((point) => !baseKeys.has(padIdentity(point)))
    .filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
  if (!extras.length) return []
  const output = []
  const ordered = [...extras].sort((a, b) => a.x - b.x || a.y - b.y)
  for (let index = 1; index < ordered.length; index += 1) {
    const start = ordered[index - 1]
    const end = ordered[index]
    const path = cleanupPathAngles(dedupePath([{ x: round(start.x), y: round(start.y) }, { x: round(end.x), y: round(start.y) }, { x: round(end.x), y: round(end.y) }]))
    if (!pathInsideBoard(path, board)) continue
    const route = routed(net, start, end, { refs: [...new Set([start.ref, end.ref].filter(Boolean))], pads: [start.id, end.id].filter(Boolean), source: 'same_net_protection_sidecar' }, path, 'F.Cu', layerCount, board, designIntent, profile, { ...options, widthMm: Math.min(0.18, options.widthMm || 0.15) }, [])
    route.strategy = 'controlled_same_net_protection_pad_stitch'
    route.reviewNotes = 'Same-net protection package pads were connected so KiCad does not treat the device as floating copper.'
    output.push(route)
  }
  const targetPad = ordered[Math.floor(ordered.length / 2)] || ordered[0]
  const target = closestPointOnRoute(targetPad, baseRoute)
  if (!target) return output
  const layer = baseRoute.layerPreference?.[0] || 'F.Cu'
  const path = cleanupPathAngles(dedupePath([{ x: round(targetPad.x), y: round(targetPad.y) }, { x: round(target.x), y: round(targetPad.y) }, { x: round(target.x), y: round(target.y) }]))
  if (!pathInsideBoard(path, board)) return output
  const sidecar = routed(net, targetPad, { ...target, ref: baseRoute.end?.ref || baseRoute.start?.ref, id: `${net.name}:route-tap` }, { refs: [targetPad.ref, ...(baseRoute.endpointRefs || [])].filter(Boolean), pads: [targetPad.id].filter(Boolean), source: 'same_net_route_tap_sidecar' }, path, layer, layerCount, board, designIntent, profile, { ...options, widthMm: Math.min(0.18, options.widthMm || 0.15) }, layer === 'B.Cu' ? endpointLayerVias(targetPad, target, profile, netClassProfiles[net.className || 'DEFAULT'] || netClassProfiles.DEFAULT) : [])
  sidecar.strategy = layer === 'B.Cu' ? 'controlled_same_net_sidecar_bottom_tap' : 'controlled_same_net_sidecar_top_tap'
  sidecar.reviewNotes = 'Same-net protection pad was tapped into the routed differential trace; tune stub length before high-speed release.'
  output.push(sidecar)
  return output
}

function padIdentity(point = {}) {
  return `${point.ref || ''}:${point.pad || point.name || point.id || ''}:${round(point.x || 0)}:${round(point.y || 0)}`
}

function closestPointOnRoute(point, route) {
  let best = null
  const path = route.waypoints || []
  for (let index = 1; index < path.length; index += 1) {
    const candidate = closestPointOnSegment(point, path[index - 1], path[index])
    const distance = heuristic(point, candidate)
    if (!best || distance < best.distance) best = { ...candidate, distance }
  }
  return best ? { x: round(best.x), y: round(best.y) } : null
}

function closestPointOnSegment(point, start, end) {
  const length = heuristic(start, end)
  if (!length) return { x: round(start.x), y: round(start.y) }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)))
  return { x: round(start.x + (end.x - start.x) * t), y: round(start.y + (end.y - start.y) * t) }
}

function differentialLaneRoutes({ net, mate, firstStart, firstEnd, secondStart, secondEnd, firstEndpoints, secondEndpoints, board, designIntent, profile, options }) {
  if (!['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF'].includes(net.className || '')) return []
  const sameVerticalOrder = Math.sign(firstStart.y - secondStart.y || 1) === Math.sign(firstEnd.y - secondEnd.y || 1)
  const sameHorizontalOrder = Math.sign(firstStart.x - secondStart.x || 1) === Math.sign(firstEnd.x - secondEnd.x || 1)
  const horizontalRun = Math.abs(firstStart.x - firstEnd.x) >= Math.abs(firstStart.y - firstEnd.y)
  if (horizontalRun && !sameVerticalOrder) return []
  if (!horizontalRun && !sameHorizontalOrder) return []
  const firstPath = pairedLanePath(firstStart, firstEnd, horizontalRun)
  const secondPath = pairedLanePath(secondStart, secondEnd, horizontalRun)
  if (!pathInsideBoard(firstPath, board) || !pathInsideBoard(secondPath, board)) return []
  if (pathsIntersect(firstPath, secondPath)) return []
  const firstRoute = routed(net, firstStart, firstEnd, firstEndpoints, firstPath, 'F.Cu', Number(options.layerCount || board.layerCount || 2), board, designIntent, profile, options, [])
  const secondRoute = routed(mate, secondStart, secondEnd, secondEndpoints, secondPath, 'F.Cu', Number(options.layerCount || board.layerCount || 2), board, designIntent, profile, options, [])
  const mismatch = Math.abs((firstRoute.estimatedLengthMm || 0) - (secondRoute.estimatedLengthMm || 0))
  firstRoute.strategy = 'controlled_diff_pair_lane_router'
  secondRoute.strategy = 'controlled_diff_pair_lane_router'
  firstRoute.differentialPair = { mate: mate.name, lengthMismatchMm: round(mismatch), orderPreserved: true }
  secondRoute.differentialPair = { mate: net.name, lengthMismatchMm: round(mismatch), orderPreserved: true }
  return [firstRoute, secondRoute]
}

function usbReversedOrderLaneRoutes({ net, mate, firstStart, firstEnd, secondStart, secondEnd, firstEndpoints, secondEndpoints, board, designIntent, profile, options }) {
  if (net.className !== 'USB_DIFF') return []
  const horizontalRun = Math.abs(firstStart.x - firstEnd.x) >= Math.abs(firstStart.y - firstEnd.y)
  if (!horizontalRun) return []
  const orderReversed = Math.sign(firstStart.y - secondStart.y || 1) !== Math.sign(firstEnd.y - secondEnd.y || 1)
  if (!orderReversed) return []
  const firstPath = usbLaneSwapPath(firstStart, firstEnd, 0)
  const secondPath = usbLaneSwapPath(secondStart, secondEnd, 1)
  if (!pathInsideBoard(firstPath, board) || !pathInsideBoard(secondPath, board)) return []
  const layerCount = Number(options.layerCount || board.layerCount || 2)
  const rules = netClassProfiles[net.className || 'USB_DIFF'] || netClassProfiles.USB_DIFF
  const firstRoute = routed(net, firstStart, firstEnd, firstEndpoints, firstPath, 'B.Cu', layerCount, board, designIntent, profile, options, endpointLayerVias(firstStart, firstEnd, profile, rules))
  const secondRoute = routed(mate, secondStart, secondEnd, secondEndpoints, secondPath, 'F.Cu', layerCount, board, designIntent, profile, options, [])
  const mismatch = Math.abs((firstRoute.estimatedLengthMm || 0) - (secondRoute.estimatedLengthMm || 0))
  firstRoute.strategy = 'controlled_usb_reversed_order_bottom_escape'
  secondRoute.strategy = 'controlled_usb_reversed_order_top_lane'
  firstRoute.differentialPair = { mate: mate.name, lengthMismatchMm: round(mismatch), orderPreserved: false, layerSwap: true, review: 'USB pad order swaps across connector/module escape; tune lengths before high-speed release.' }
  secondRoute.differentialPair = { mate: net.name, lengthMismatchMm: round(mismatch), orderPreserved: false, layerSwap: true, review: 'USB pad order swaps across connector/module escape; tune lengths before high-speed release.' }
  return [firstRoute, secondRoute]
}

function usbLaneSwapPath(start, end, laneIndex) {
  const direction = Math.sign(end.x - start.x || 1)
  const firstRun = laneIndex === 0 ? 7.75 : 7.25
  const elbow = { x: round(start.x + direction * firstRun), y: round(start.y) }
  const diagonalRun = Math.abs(start.y - end.y)
  const entry = { x: round(elbow.x + direction * diagonalRun), y: round(end.y) }
  return cleanupPathAngles(dedupePath([
    { x: round(start.x), y: round(start.y) },
    elbow,
    entry,
    { x: round(end.x), y: round(end.y) },
  ]))
}

function pairedLanePath(start, end, horizontalRun) {
  if (horizontalRun) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    if (Math.abs(dx) > Math.abs(dy) + 1) {
      const entryX = round(end.x - Math.sign(dx || 1) * Math.abs(dy))
      return removeCollinear(dedupePath([start, { x: entryX, y: start.y }, end]))
    }
    const x1 = round(start.x + dx * 0.45)
    return removeCollinear(dedupePath([start, { x: x1, y: start.y }, { x: x1, y: end.y }, end]))
  }
  const dy = end.y - start.y
  const dx = end.x - start.x
  if (Math.abs(dy) > Math.abs(dx) + 1) {
    const entryY = round(end.y - Math.sign(dy || 1) * Math.abs(dx))
    return removeCollinear(dedupePath([start, { x: start.x, y: entryY }, end]))
  }
  const y1 = round(start.y + dy * 0.45)
  return removeCollinear(dedupePath([start, { x: start.x, y: y1 }, { x: end.x, y: y1 }, end]))
}

function pathInsideBoard(points, board) {
  return points.every((point) => pointInPolygon(point, board.outline || []))
}

function pathsIntersect(first, second) {
  for (let a = 1; a < first.length; a += 1) {
    for (let b = 1; b < second.length; b += 1) {
      if (sharesEndpoint(first[a - 1], first[a], second[b - 1], second[b])) continue
      if (segmentsIntersect(first[a - 1], first[a], second[b - 1], second[b])) return true
    }
  }
  return false
}

function dedupePath(points) {
  return points.filter((point, index, list) => index === 0 || !samePoint(point, list[index - 1]))
}

function routeNet({ net, start, end, endpoints, board, components, pads = [], profile, options, designIntent, obstacles, occupied, gridMm, layerCount }) {
  const rules = netClassProfiles[net.className || 'DEFAULT'] || netClassProfiles.DEFAULT
  if (/^CC[12]$/i.test(String(net.name || ''))) {
    const ccRoute = routeUsbCcNet({ net, start, end, endpoints, board, obstacles, occupied, gridMm, layerCount, profile, rules, options })
    if (ccRoute) return ccRoute
    const route = routeShell(net, start, end, endpoints, 'unrouted_usb_cc_escape_required')
    route.reviewNotes = 'USB-C CC pull-down escape could not be routed without violating occupied copper or board constraints.'
    return route
  }
  const sensitive = ['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RF', 'CRYSTAL', 'CLOCK'].includes(net.className || '')
  const approximateEndpoint = !start?.ref || !end?.ref
  const preferredLayers = routeLayersForNet(net, rules, layerCount, { sensitive, approximateEndpoint })
  const escapedStart = findLegalPadEscapePoint({ pad: start, net, board, components, pads, obstacles, profile, gridMm }) || escapePoint(start, components, board, gridMm)
  const escapedEnd = findLegalPadEscapePoint({ pad: end, net, board, components, pads, obstacles, profile, gridMm }) || escapePoint(end, components, board, gridMm)
  const widthMm = routeWidthForNet(net, profile, options)
  for (const layer of preferredLayers) {
    const path = findPath({ board, start: escapedStart, end: escapedEnd, obstacles, occupied, gridMm, layer, netName: net.name, netClass: net.className || 'DEFAULT', widthMm, allowedRefs: endpoints.refs || [], options })
    if (path.length) {
      const viaStart = isPowerNetName(net.name) ? escapedStart : escapedStart
      const viaEnd = isPowerNetName(net.name) ? escapedEnd : escapedEnd
      const endpointContactLayers = endpointContactLayersForRoute(start, end, layer)
      const layerVias = endpointLayerVias(viaStart, viaEnd, profile, rules, layer, { board, pads, obstacles, net, endpointContactLayers })
      if (layerVias.length < endpointTransitionCount(start, end, layer, endpointContactLayers)) continue
      const pathWithEscapes = withEscapes(start, escapedStart, path, escapedEnd, end, gridMm, { layer, board, endpointContactLayers, viaCount: layerVias.length })
      return routed(net, start, end, endpoints, pathWithEscapes, layer, layerCount, board, designIntent, profile, options, layerVias, endpointContactLayers)
    }
  }
  const fallbackRoute = orthogonalFallbackRoute({ net, start, end, escapedStart, escapedEnd, board, preferredLayers, profile, rules, occupied })
  if (fallbackRoute) {
    const endpointContactLayers = endpointContactLayersForRoute(start, end, fallbackRoute.layer)
    const fallbackPath = withEscapes(start, escapedStart, fallbackRoute.path, escapedEnd, end, gridMm, { layer: fallbackRoute.layer, board, endpointContactLayers, viaCount: fallbackRoute.vias?.length || 0 })
    const route = routed(net, start, end, endpoints, fallbackPath, fallbackRoute.layer, layerCount, board, designIntent, profile, options, fallbackRoute.vias, endpointContactLayers)
    route.strategy = 'controlled_orthogonal_bus_fallback'
    route.reviewNotes = 'A* route was blocked; deterministic orthogonal fallback used to avoid crossing existing copper.'
    return route
  }
  const usbEndpointFallback = usbEndpointFallbackRoute({ net, start, end, board, profile, rules, occupied, layerCount })
  if (usbEndpointFallback) return usbEndpointFallback
  if (endpoints.source === 'component_centers') {
    const fallback = componentCenterFallbackPath(start, end, board)
    if (fallback.length) {
      const fallbackLayer = routeLayersForNet(net, rules, layerCount, { sensitive: false, approximateEndpoint: false })[0] || 'F.Cu'
      const route = routed(net, start, end, endpoints, fallback, fallbackLayer, layerCount, board, designIntent, profile, options, fallbackLayer !== 'F.Cu' ? endpointLayerVias(start, end, profile, rules, fallbackLayer) : [])
      route.strategy = 'controlled_component_center_manhattan_fallback'
      route.reviewNotes = 'Route is based on component-center pseudo endpoints because no pad geometry was available.'
      return route
    }
  }
  return routeShell(net, start, end, endpoints, 'unrouted_no_path')
}

function routeUsbCcNet({ net, start, end, endpoints, board, obstacles, occupied, gridMm, layerCount, profile, rules, options = {} }) {
  if (!start || !end) return null
  const allowedRefs = endpoints.refs || [start.ref, end.ref].filter(Boolean)
  const ccLayers = ['F.Cu', 'B.Cu']
  const widthMm = routeWidthForNet(net, profile, options)
  for (const layer of ccLayers) {
    const path = findPath({ board, start, end, obstacles, occupied, gridMm, layer, netName: net.name, netClass: 'DEFAULT', widthMm, allowedRefs, options })
    if (!path.length) continue
    const exactPath = exactEndpointPath(start, path, end)
    const vias = layer === 'B.Cu' ? endpointLayerVias(start, end, profile, rules) : []
    const route = routed(net, start, end, endpoints, exactPath, layer, layerCount, board, { zones: [], copperPours: [] }, profile, {}, vias)
    route.strategy = layer === 'B.Cu' ? 'controlled_usb_cc_bottom_escape' : 'controlled_usb_cc_top_escape'
    return route
  }
  for (const layer of ccLayers) {
    const path = usbCcCandidatePaths(start, end, net.name, board).find((candidate) => !pathCrossesOccupied(candidate, occupied, layer, net.name))
    if (!path) continue
    const vias = layer === 'B.Cu' ? endpointLayerVias(start, end, profile, rules) : []
    const route = routed(net, start, end, endpoints, exactEndpointPath(start, path, end), layer, layerCount, board, { zones: [], copperPours: [] }, profile, {}, vias)
    route.strategy = layer === 'B.Cu' ? 'controlled_usb_cc_bottom_micro_escape' : 'controlled_usb_cc_top_micro_escape'
    return route
  }
  return null
}

function exactEndpointPath(start, path = [], end) {
  return cleanupPathAngles(dedupePath([
    { x: round(start.x), y: round(start.y) },
    ...(path || []).map((point) => ({ x: round(point.x), y: round(point.y) })),
    { x: round(end.x), y: round(end.y) },
  ]))
}

function usbCcCandidatePaths(start, end, netName, board) {
  const direction = end.x >= start.x ? 1 : -1
  const side = /^CC2$/i.test(String(netName || '')) ? 1 : -1
  const x1 = round(start.x + direction * 2.4)
  const x2 = round(end.x - direction * 1.2)
  const yLane = round(start.y + side * 2.4)
  const yLaneWide = round(start.y + side * 4.2)
  const candidates = [
    [start, { x: x1, y: start.y }, { x: x1, y: end.y }, end],
    [start, { x: x1, y: start.y }, { x: x1, y: yLane }, { x: x2, y: yLane }, { x: x2, y: end.y }, end],
    [start, { x: x1, y: start.y }, { x: x1, y: yLaneWide }, { x: x2, y: yLaneWide }, { x: x2, y: end.y }, end],
    [start, { x: x2, y: start.y }, { x: x2, y: end.y }, end],
  ]
  if (/^CC2$/i.test(String(netName || ''))) {
    const gutterX = round(Math.min(start.x, end.x) - 0.9)
    const lowerY = round(Math.max(start.y, end.y) + 0.8)
    candidates.unshift(
      [start, { x: gutterX, y: start.y }, { x: gutterX, y: lowerY }, { x: end.x, y: lowerY }, end],
      [start, { x: start.x, y: lowerY }, { x: end.x, y: lowerY }, end],
    )
  }
  return candidates
    .map((candidate) => cleanupPathAngles(dedupePath(candidate.map((point) => ({ x: round(point.x), y: round(point.y) })))))
    .filter((candidate) => candidate.length >= 2 && pathInsideBoard(candidate, board))
}

function orthogonalFallbackRoute({ net, start, end, escapedStart, escapedEnd, board, preferredLayers, profile, rules, occupied }) {
  if (['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RF', 'CRYSTAL', 'CLOCK'].includes(net.className || '')) return null
  const layers = preferredLayers?.length ? preferredLayers : ['F.Cu']
  const first = escapedStart || start
  const last = escapedEnd || end
  const offsets = [0, 1.5, -1.5, 3, -3, 5, -5]
  const candidates = [
    [start, first, { x: round(last.x), y: round(first.y) }, last, end],
    [start, first, { x: round(first.x), y: round(last.y) }, last, end],
    [start, first, { x: round((first.x + last.x) / 2), y: round(first.y) }, { x: round((first.x + last.x) / 2), y: round(last.y) }, last, end],
    [start, first, { x: round(first.x), y: round((first.y + last.y) / 2) }, { x: round(last.x), y: round((first.y + last.y) / 2) }, last, end],
  ]
  const candidateLayers = [...new Set(layers)]
  for (const offset of offsets) {
    candidates.push(
      [start, first, { x: round(first.x), y: round(first.y + offset) }, { x: round(last.x), y: round(first.y + offset) }, last, end],
      [start, first, { x: round(first.x + offset), y: round(first.y) }, { x: round(first.x + offset), y: round(last.y) }, last, end],
    )
  }
  const normalized = candidates
    .map((candidate) => cleanupPathAngles(dedupePath(candidate.filter(Boolean).map((point) => ({ x: round(point.x), y: round(point.y) })))))
    .filter((candidate) => candidate.length >= 2 && pathInsideBoard(candidate, board))
  for (const layer of candidateLayers) {
    const path = normalized.find((candidate) => !pathCrossesOccupied(candidate, occupied, layer, net.name))
    if (!path) continue
    return {
      layer,
      path,
      vias: layer !== 'F.Cu' ? endpointLayerVias(first, last, profile, rules, layer) : [],
    }
  }
  return null
}

function usbEndpointFallbackRoute({ net, start, end, board, profile, rules = {}, occupied, layerCount }) {
  if (!start || !end) return null
  if (net.className !== 'USB_DIFF' && !/^USB_D[PN]$/i.test(String(net.name || ''))) return null
  const targetLayer = 'F.Cu'
  const candidates = usbEndpointCandidatePaths(start, end, board)
    .map((candidate) => cleanupPathAngles(dedupePath(candidate.filter(Boolean).map((point) => ({ x: round(point.x), y: round(point.y) })))))
    .filter((candidate) => candidate.length >= 2 && pathInsideBoard(candidate, board))
  for (const path of candidates) {
    if (pathCrossesOccupied(path, occupied, targetLayer, net.name)) continue
    return {
      ...routeShell(net, start, end, { refs: [start.ref, end.ref].filter(Boolean), pads: [start.id, end.id].filter(Boolean), source: 'usb_endpoint_fallback_blocked' }, 'unrouted_usb_endpoint_pair_review_required'),
      attemptedFallback: {
        layer: targetLayer,
        path,
        vias: targetLayer !== 'F.Cu' ? endpointLayerVias(start, end, profile, rules, targetLayer) : [],
        reason: 'USB endpoint branch needs pair-aware reroute; single-net fallback is intentionally not committed.',
      },
      reviewNotes: 'USB endpoint branch has a possible top-layer path, but BoardForge will not commit a single-member differential fallback without pair-length and clearance validation.',
    }
  }
  return null
}

function usbEndpointCandidatePaths(start, end, board) {
  const bounds = polygonBounds(board.outline || [])
  const minEdge = Math.max(0.9, Number(board.edgeClearanceMm || 0.5) + 0.4)
  const safeMinY = round(bounds.minY + minEdge)
  const safeMaxY = round(bounds.maxY - minEdge)
  const safeMinX = round(bounds.minX + minEdge)
  const safeMaxX = round(bounds.maxX - minEdge)
  const midX = round((start.x + end.x) / 2)
  const midY = round((start.y + end.y) / 2)
  const preferredYs = [
    clamp(round(Math.max(start.y, end.y) + 2.5), safeMinY, safeMaxY),
    clamp(round(Math.min(start.y, end.y) - 2.5), safeMinY, safeMaxY),
    clamp(round(Math.max(start.y, end.y) + 4), safeMinY, safeMaxY),
    clamp(round(Math.min(start.y, end.y) - 4), safeMinY, safeMaxY),
    midY,
  ]
  const preferredXs = [
    clamp(midX, safeMinX, safeMaxX),
    clamp(round(start.x + Math.sign(end.x - start.x || 1) * 4), safeMinX, safeMaxX),
    clamp(round(end.x - Math.sign(end.x - start.x || 1) * 4), safeMinX, safeMaxX),
  ]
  const paths = []
  for (const y of [...new Set(preferredYs)]) {
    paths.push([start, { x: start.x, y }, { x: end.x, y }, end])
  }
  for (const x of [...new Set(preferredXs)]) {
    paths.push([start, { x, y: start.y }, { x, y: end.y }, end])
  }
  paths.push([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end])
  return paths
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function pathCrossesOccupied(path, occupied, layer, netName) {
  for (let index = 1; index < path.length; index += 1) {
    if (segmentCrossesOccupied(path[index - 1], path[index], occupied, layer, netName)) return true
  }
  return false
}

function withEscapes(start, escapedStart, path, escapedEnd, end, gridMm, context = {}) {
  const layer = context.layer || 'F.Cu'
  const sourceLayer = context.endpointContactLayers?.source || layer
  const targetLayer = context.endpointContactLayers?.target || layer
  const sourceContact = snapEndpointToPadCopper({ pad: start, approachPoint: escapedStart || path?.[0] || end, layer: sourceLayer, board: context.board, viaCount: context.viaCount }) || start
  const targetContact = snapEndpointToPadCopper({ pad: end, approachPoint: escapedEnd || path?.at?.(-1) || start, layer: targetLayer, board: context.board, viaCount: context.viaCount }) || end
  const points = []
  for (const point of [sourceContact, escapedStart?.bend, escapedStart, ...(path || []), escapedEnd, escapedEnd?.bend, targetContact]) {
    if (!point) continue
    const rounded = { x: round(point.x), y: round(point.y) }
    if (!points.length || heuristic(points[points.length - 1], rounded) >= gridMm * 0.25) points.push(rounded)
  }
  return cleanupPathAngles(points)
}

function endpointLayerVias(escapedStart, escapedEnd, profile, rules = {}, targetLayer = 'B.Cu', context = {}) {
  const diameterMm = Math.max(rules.viaDiameterMm || 0, profile.minViaDiameterMm || 0.45)
  const drillMm = Math.max(rules.viaDrillMm || 0, profile.minViaDrillMm || 0.2)
  const endpointContactLayers = context.endpointContactLayers || { source: 'F.Cu', target: 'F.Cu' }
  return [
    endpointNeedsLayerTransition(escapedStart, endpointContactLayers.source, targetLayer)
      ? { ...escapedStart, endpoint: 'start', diameterMm, drillMm, layers: viaSpanForTransition(endpointContactLayers.source, targetLayer), targetLayer, reason: `autorouter ${targetLayer} entry via` }
      : null,
    endpointNeedsLayerTransition(escapedEnd, endpointContactLayers.target, targetLayer)
      ? { ...escapedEnd, endpoint: 'end', diameterMm, drillMm, layers: viaSpanForTransition(endpointContactLayers.target, targetLayer), targetLayer, reason: `autorouter ${targetLayer} exit via` }
      : null,
  ].filter(Boolean)
    .map((via) => legalViaSite(via, context) ? via : findNearestLegalThroughViaSite({ seed: via, ...context }))
    .filter(Boolean)
}

function viaSpanForTargetLayer(targetLayer = 'B.Cu') {
  const layer = String(targetLayer || 'B.Cu')
  if (/^In\d+\.Cu$/i.test(layer)) return ['F.Cu', layer]
  if (/^B\.Cu$/i.test(layer)) return ['F.Cu', 'B.Cu']
  return ['F.Cu', layer]
}

function viaSpanForTransition(contactLayer = 'F.Cu', routeLayer = 'B.Cu') {
  if (contactLayer === routeLayer) return [contactLayer, routeLayer]
  if ((contactLayer === 'F.Cu' && routeLayer === 'B.Cu') || (contactLayer === 'B.Cu' && routeLayer === 'F.Cu')) return ['F.Cu', 'B.Cu']
  return viaSpanForTargetLayer(routeLayer)
}

function endpointNeedsLayerTransition(endpoint = {}, contactLayer = 'F.Cu', routeLayer = 'F.Cu') {
  if (!endpoint || endpoint.throughHole) return false
  return contactLayer !== routeLayer
}

function endpointTransitionCount(start = {}, end = {}, routeLayer = 'F.Cu', endpointContactLayers = {}) {
  return [endpointNeedsLayerTransition(start, endpointContactLayers.source || routeLayer, routeLayer), endpointNeedsLayerTransition(end, endpointContactLayers.target || routeLayer, routeLayer)].filter(Boolean).length
}

function endpointContactLayersForRoute(start = {}, end = {}, routeLayer = 'F.Cu') {
  return {
    source: endpointContactLayerForPad(start, routeLayer),
    target: endpointContactLayerForPad(end, routeLayer),
  }
}

function endpointContactLayerForPad(pad = {}, routeLayer = 'F.Cu') {
  if (pad.throughHole) return routeLayer
  const layers = getPadLayerSet(pad)
  if (layers.includes(routeLayer)) return routeLayer
  if (layers.includes('F.Cu')) return 'F.Cu'
  if (layers.includes('B.Cu')) return 'B.Cu'
  return routeLayer
}

export function buildPadEscapeRegions({ pad, board, gridMm = defaultGridMm } = {}) {
  if (!pad || !Number.isFinite(Number(pad.x)) || !Number.isFinite(Number(pad.y))) return []
  const width = Number(pad.widthMm || pad.width || 0.5)
  const height = Number(pad.heightMm || pad.height || 0.5)
  const base = Math.max(0.45, gridMm)
  const distances = [base, base * 1.5, base * 2.25, base * 3]
  const directions = [
    { x: 1, y: 0, name: 'right' },
    { x: -1, y: 0, name: 'left' },
    { x: 0, y: 1, name: 'down' },
    { x: 0, y: -1, name: 'up' },
    { x: 1, y: 1, name: 'down-right' },
    { x: -1, y: 1, name: 'down-left' },
    { x: 1, y: -1, name: 'up-right' },
    { x: -1, y: -1, name: 'up-left' },
  ]
  const candidates = []
  for (const direction of directions) {
    const norm = Math.hypot(direction.x, direction.y) || 1
    for (const distance of distances) {
      const clearance = distance + Math.max(width, height) / 2
      const candidate = {
        ...pad,
        x: round(Number(pad.x) + direction.x / norm * clearance),
        y: round(Number(pad.y) + direction.y / norm * clearance),
        escapeDirection: direction.name,
        escapeDistanceMm: round(clearance),
      }
      if (!board?.outline?.length || pointInPolygon(candidate, board.outline)) candidates.push(candidate)
    }
  }
  return candidates
}

export function extractPadCopperGeometry(pad = {}) {
  const x = Number(pad.x)
  const y = Number(pad.y)
  const widthMm = Math.max(Number(pad.widthMm || pad.width || 0.5), 0.001)
  const heightMm = Math.max(Number(pad.heightMm || pad.height || 0.5), 0.001)
  const rotation = Number(pad.rotation || pad.angle || 0)
  const halfW = widthMm / 2
  const halfH = heightMm / 2
  const local = [
    { x: -halfW, y: -halfH, corner: 'top-left' },
    { x: halfW, y: -halfH, corner: 'top-right' },
    { x: halfW, y: halfH, corner: 'bottom-right' },
    { x: -halfW, y: halfH, corner: 'bottom-left' },
  ]
  const radians = rotation * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const corners = local.map((point) => ({
    x: round(x + point.x * cos - point.y * sin),
    y: round(y + point.x * sin + point.y * cos),
    corner: point.corner,
  }))
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return {
    ref: pad.ref,
    pad: pad.pad || pad.name,
    shape: pad.shape || 'rect',
    x,
    y,
    widthMm,
    heightMm,
    rotation,
    layers: getPadLayerSet(pad),
    throughHole: Boolean(pad.throughHole || String(pad.type || '').includes('thru')),
    corners,
    box: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
  }
}

export function getPadLayerSet(pad = {}) {
  const layers = Array.isArray(pad.layers) ? pad.layers.filter(Boolean) : []
  if (layers.includes('*.Cu')) return ['F.Cu', 'B.Cu']
  if (!layers.length) return ['F.Cu']
  return [...new Set(layers.filter((layer) => /\.Cu$/i.test(String(layer))))]
}

export function getLegalPadContactEdges(pad = {}, layer = 'F.Cu', context = {}) {
  const geometry = extractPadCopperGeometry(pad)
  if (!padLayerCanContact(geometry, layer, context)) return []
  const { x, y, widthMm, heightMm, rotation } = geometry
  const radians = rotation * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const edgeDefs = [
    { name: 'right', local: { x: widthMm / 2, y: 0 }, outward: { x: 1, y: 0 } },
    { name: 'left', local: { x: -widthMm / 2, y: 0 }, outward: { x: -1, y: 0 } },
    { name: 'bottom', local: { x: 0, y: heightMm / 2 }, outward: { x: 0, y: 1 } },
    { name: 'top', local: { x: 0, y: -heightMm / 2 }, outward: { x: 0, y: -1 } },
  ]
  return edgeDefs.map((edge) => ({
    edge: edge.name,
    layer: contactLayerForPad(geometry, layer, context),
    x: round(x + edge.local.x * cos - edge.local.y * sin),
    y: round(y + edge.local.x * sin + edge.local.y * cos),
    outward: {
      x: round(edge.outward.x * cos - edge.outward.y * sin),
      y: round(edge.outward.x * sin + edge.outward.y * cos),
    },
  }))
}

export function getPadApproachDirections(pad = {}, layer = 'F.Cu', context = {}) {
  return getLegalPadContactEdges(pad, layer, context).map((edge) => ({ edge: edge.edge, direction: edge.outward, layer: edge.layer }))
}

export function generatePadEdgeContactPoints({ pad, layer = 'F.Cu', board, approachPoint, profile = {}, obstacles = [], pads = [], net } = {}) {
  const netName = String(net?.name || pad?.netName || '')
  return getLegalPadContactEdges(pad, layer, { viaCount: 0 }).map((edge) => {
    const point = { ...edge, ref: pad?.ref, pad: pad?.pad || pad?.name, netName: pad?.netName || netName, padContact: true }
    const legal = validatePadContactCandidate({ pad, point, board, profile, obstacles, pads, netName })
    const distanceScore = approachPoint ? -Math.hypot(Number(point.x) - Number(approachPoint.x), Number(point.y) - Number(approachPoint.y)) : 0
    return { point, legal: legal.status === 'PAD_CONTACT_CLEAR', issues: legal.issues, score: (legal.status === 'PAD_CONTACT_CLEAR' ? 100 : -1000) + distanceScore }
  }).sort((a, b) => b.score - a.score)
}

export function selectBestPadEdgeContact({ pad, layer = 'F.Cu', board, approachPoint, profile = {}, obstacles = [], pads = [], net } = {}) {
  return generatePadEdgeContactPoints({ pad, layer, board, approachPoint, profile, obstacles, pads, net }).find((candidate) => candidate.legal)?.point || null
}

export function snapEndpointToPadCopper({ pad, layer = 'F.Cu', board, approachPoint, viaCount = 0 } = {}) {
  const geometry = extractPadCopperGeometry(pad)
  if (!padLayerCanContact(geometry, layer, { viaCount })) return null
  const contactLayer = contactLayerForPad(geometry, layer, { viaCount })
  const contact = selectBestPadEdgeContact({ pad, layer: contactLayer, board, approachPoint }) || nearestPointInsidePadBox(geometry, approachPoint, contactLayer)
  if (!contact) return null
  return {
    ...pad,
    x: round(contact.x),
    y: round(contact.y),
    layer: contactLayer,
    padContact: true,
    contactEdge: contact.edge,
  }
}

export function extendRouteToPadCopper({ routePoint, pad, layer = 'F.Cu', board } = {}) {
  return snapEndpointToPadCopper({ pad, layer, board, approachPoint: routePoint })
}

export function buildPadEscapeSegment({ pad, escapePoint: escape, layer = 'F.Cu', board } = {}) {
  const contact = snapEndpointToPadCopper({ pad, layer, board, approachPoint: escape })
  if (!contact || !escape) return null
  return [contact, { ...escape, layer }]
}

export function validatePadEscapeTouchesPad({ pad, escapeSegment = [], layer = 'F.Cu' } = {}) {
  const contact = escapeSegment[0]
  const geometry = extractPadCopperGeometry(pad)
  if (!contact || !padLayerCanContact(geometry, layer, {})) return false
  return pointInsidePadBox(contact, geometry)
}

function validatePadContactCandidate({ pad, point, board, profile = {}, obstacles = [], pads = [], netName = '' } = {}) {
  const issues = []
  if (!point || (board?.outline?.length && !pointInPolygon(point, board.outline))) issues.push('PAD_CONTACT_OFF_BOARD')
  for (const obstacle of obstacles || []) {
    if (obstacle.kind === 'pad' && sameNetName(obstacle.netName, netName)) continue
    if (obstacle.ref && obstacle.ref === pad?.ref) continue
    if (obstacleBlocksPoint(obstacle, point, { allowedRefs: [pad?.ref].filter(Boolean), netName })) issues.push(`PAD_CONTACT_IN_${obstacle.kind || 'OBSTACLE'}`)
  }
  for (const other of pads || []) {
    if (!Number.isFinite(Number(other.x)) || !Number.isFinite(Number(other.y))) continue
    if (sameNetName(other.netName, netName)) continue
    if (other.id === pad?.id || (other.ref === pad?.ref && String(other.pad || other.name || '') === String(pad?.pad || pad?.name || ''))) continue
    const minPad = Math.min(Number(other.widthMm || other.width || 0.4), Number(other.heightMm || other.height || 0.4))
    const required = Math.max(Number(profile.minClearanceMm || 0.127), minPad / 2)
    if (Math.hypot(Number(point.x) - Number(other.x), Number(point.y) - Number(other.y)) < required) issues.push(`PAD_CONTACT_NEAR_PAD:${other.id || `${other.ref || ''}:${other.pad || other.name || ''}`}`)
  }
  return { status: issues.length ? 'PAD_CONTACT_BLOCKED' : 'PAD_CONTACT_CLEAR', issues }
}

function padLayerCanContact(geometry = {}, routeLayer = 'F.Cu', context = {}) {
  if (geometry.throughHole) return true
  const layers = geometry.layers || ['F.Cu']
  if (layers.includes(routeLayer)) return true
  if (routeLayer !== 'F.Cu' && Number(context.viaCount || 0) > 0 && layers.includes('F.Cu')) return true
  return false
}

function contactLayerForPad(geometry = {}, routeLayer = 'F.Cu', context = {}) {
  if (geometry.throughHole) return routeLayer
  const layers = geometry.layers || ['F.Cu']
  if (layers.includes(routeLayer)) return routeLayer
  if (routeLayer !== 'F.Cu' && Number(context.viaCount || 0) > 0 && layers.includes('F.Cu')) return 'F.Cu'
  return layers[0] || 'F.Cu'
}

function nearestPointInsidePadBox(geometry = {}, approachPoint = {}, layer = 'F.Cu') {
  if (!Number.isFinite(Number(approachPoint?.x)) || !Number.isFinite(Number(approachPoint?.y))) {
    return { x: round(geometry.x), y: round(geometry.y), layer, edge: 'center' }
  }
  return {
    x: round(clamp(Number(approachPoint.x), geometry.box.minX, geometry.box.maxX)),
    y: round(clamp(Number(approachPoint.y), geometry.box.minY, geometry.box.maxY)),
    layer,
    edge: 'nearest',
  }
}

function pointInsidePadBox(point = {}, geometry = {}) {
  return Number(point.x) >= geometry.box.minX - 0.001
    && Number(point.x) <= geometry.box.maxX + 0.001
    && Number(point.y) >= geometry.box.minY - 0.001
    && Number(point.y) <= geometry.box.maxY + 0.001
}

export function findLegalPadEscapePoint({ pad, net, board, components = [], pads = [], obstacles = [], profile = {}, gridMm = defaultGridMm } = {}) {
  const candidates = generatePadEscapeCandidates({ pad, net, board, components, pads, obstacles, profile, gridMm })
  return candidates.find((candidate) => candidate.legal)?.point || null
}

export function generatePadEscapeCandidates({ pad, net, board, components = [], pads = [], obstacles = [], profile = {}, gridMm = defaultGridMm } = {}) {
  return buildPadEscapeRegions({ pad, board, gridMm }).map((point) => {
    const legal = validatePadEscapeClearance({ pad, point, net, board, components, pads, obstacles, profile })
    return { point, legal: legal.status === 'PAD_ESCAPE_CLEAR', issues: legal.issues, score: legal.status === 'PAD_ESCAPE_CLEAR' ? scoreEscapePoint(pad, point) : -Infinity }
  }).sort((a, b) => b.score - a.score)
}

export function validatePadEscapeClearance({ pad, point, net, board, components = [], pads = [], obstacles = [], profile = {} } = {}) {
  const issues = []
  const netName = String(net?.name || pad?.netName || '')
  if (!point || (board?.outline?.length && !pointInPolygon(point, board.outline))) issues.push('ESCAPE_OFF_BOARD')
  for (const obstacle of obstacles || []) {
    if (obstacle.kind === 'pad' && sameNetName(obstacle.netName, netName)) continue
    if (obstacle.ref && obstacle.ref === pad?.ref && obstacle.kind !== 'pad') continue
    if (obstacleBlocksPoint(obstacle, point, { allowedRefs: [pad?.ref].filter(Boolean), netName })) issues.push(`ESCAPE_IN_${obstacle.kind || 'OBSTACLE'}`)
  }
  for (const other of pads || []) {
    if (!Number.isFinite(Number(other.x)) || !Number.isFinite(Number(other.y))) continue
    if (sameNetName(other.netName, netName)) continue
    if (other.id === pad?.id) continue
    const minPad = Math.min(Number(other.widthMm || other.width || 0.4), Number(other.heightMm || other.height || 0.4))
    const required = Math.max(Number(profile.minClearanceMm || 0.127), minPad / 2 + Number(profile.minTraceWidthMm || 0.127) / 2)
    if (Math.hypot(Number(point.x) - Number(other.x), Number(point.y) - Number(other.y)) < required) issues.push(`ESCAPE_NEAR_PAD:${other.id || `${other.ref || ''}:${other.pad || other.name || ''}`}`)
  }
  return { status: issues.length ? 'PAD_ESCAPE_BLOCKED' : 'PAD_ESCAPE_CLEAR', issues }
}

export function findNearestLegalThroughViaSite({ seed, net, board, pads = [], obstacles = [], profile = {}, gridMm = defaultGridMm } = {}) {
  const candidates = legalViaSiteCandidates({ seed, net, board, pads, obstacles, profile, gridMm })
  return candidates.find((candidate) => candidate.legal)?.via || null
}

export function legalViaSiteCandidates({ seed, net, board, pads = [], obstacles = [], profile = {}, gridMm = defaultGridMm } = {}) {
  const diameterMm = Math.max(profile.minViaDiameterMm || 0.45, 0.45)
  const drillMm = Math.max(profile.minViaDrillMm || 0.2, 0.2)
  const offsets = [0, gridMm, -gridMm, gridMm * 1.5, -gridMm * 1.5, gridMm * 2, -gridMm * 2]
  const points = []
  for (const dx of offsets) {
    for (const dy of offsets) {
      if (Math.hypot(dx, dy) > gridMm * 3) continue
      points.push({ x: round(Number(seed?.x || 0) + dx), y: round(Number(seed?.y || 0) + dy) })
    }
  }
  return points.map((point) => {
    const via = { ...seed, ...point, diameterMm, drillMm, layers: ['F.Cu', 'B.Cu'], viaType: 'through' }
    const legal = legalViaSite(via, { board, pads, obstacles, net, profile })
    return { via, legal, score: legal ? -Math.hypot(Number(seed?.x || 0) - point.x, Number(seed?.y || 0) - point.y) : -Infinity }
  }).sort((a, b) => b.score - a.score)
}

function legalViaSite(via, { board = {}, pads = [], obstacles = [], net = {}, profile = {} } = {}) {
  if (!via) return false
  if (String(via.viaType || 'through').toLowerCase() !== 'through') return false
  if (board?.outline?.length && !pointInPolygon(via, board.outline)) return false
  const netName = String(net?.name || via.netName || via.net || '')
  for (const obstacle of obstacles || []) {
    if (obstacle.kind === 'pad' && sameNetName(obstacle.netName, netName)) continue
    if (obstacleBlocksPoint(obstacle, via, { allowedRefs: [via.ref].filter(Boolean), netName })) return false
  }
  for (const pad of pads || []) {
    if (!Number.isFinite(Number(pad.x)) || !Number.isFinite(Number(pad.y))) continue
    if (sameNetName(pad.netName, netName)) continue
    const minPad = Math.min(Number(pad.widthMm || pad.width || 0.4), Number(pad.heightMm || pad.height || 0.4))
    const required = Math.max(Number(profile.holeClearanceMm || profile.minClearanceMm || 0.127), Number(via.diameterMm || 0.45) / 2 + minPad / 2)
    if (Math.hypot(Number(via.x) - Number(pad.x), Number(via.y) - Number(pad.y)) < required) return false
  }
  for (const hole of board.mountingHoles || []) {
    const required = Number(hole.diameterMm || 3) / 2 + Number(profile.mountingHoleEdgeClearanceMm || 0.8) + Number(via.diameterMm || 0.45) / 2
    if (Math.hypot(Number(via.x) - Number(hole.x), Number(via.y) - Number(hole.y)) < required) return false
  }
  return true
}

function scoreEscapePoint(pad, point) {
  return -Math.hypot(Number(point.x) - Number(pad?.x || 0), Number(point.y) - Number(pad?.y || 0))
}

function sameNetName(a, b) {
  const clean = (value) => String(value || '').replace(/^\/+/, '').toUpperCase()
  return clean(a) && clean(a) === clean(b)
}

function routeLayersForNet(net, rules = {}, layerCount = 2, context = {}) {
  const className = net.className || 'DEFAULT'
  if (context.approximateEndpoint) return ['F.Cu']
  if (['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RF', 'CRYSTAL', 'CLOCK'].includes(className)) return ['F.Cu', ...(layerCount >= 4 ? ['B.Cu'] : [])]
  if (layerCount >= 6) {
    if (['SPI', 'I2C', 'UART', 'DEBUG', 'RESET', 'BOOT', 'SENSOR', 'ANALOG', 'DEFAULT'].includes(className)) return ['F.Cu', 'B.Cu', 'In3.Cu', 'In5.Cu']
    if (['POWER_LOW_CURRENT', 'BATTERY', 'POWER_HIGH_CURRENT'].includes(className) || isPowerNetName(net.name)) return ['B.Cu', 'In1.Cu', 'F.Cu', 'In2.Cu']
  }
  if (layerCount >= 4) {
    if (className === 'I2C') return ['F.Cu', 'B.Cu', 'In2.Cu']
    if (['SPI', 'UART', 'DEBUG', 'RESET', 'BOOT', 'SENSOR', 'ANALOG', 'DEFAULT'].includes(className)) return ['B.Cu', 'F.Cu', 'In2.Cu']
    if (['POWER_LOW_CURRENT', 'BATTERY', 'POWER_HIGH_CURRENT'].includes(className) || isPowerNetName(net.name)) return ['B.Cu', 'F.Cu', 'In1.Cu']
  }
  return rules.layerPreference?.length ? rules.layerPreference : ['F.Cu', 'B.Cu']
}

function escapePoint(point, components, board, gridMm) {
  if (!point?.ref || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point
  const component = components.find((item) => item.ref === point.ref)
  if (!component) return point
  const group = String(component.group || '').toUpperCase()
  const isModule = ['ESP32_S3', 'MCU_MODULE', 'RF_MODULE'].includes(group) || (Number(component.width || 0) >= 18 && Number(component.height || 0) >= 14)
  const isHeader = ['USB', 'SENSOR_CONNECTOR', 'ESC_CONNECTOR'].includes(group) || point.throughHole
  const isSmallSmd = !isModule && !isHeader && point.throughHole !== true
  const dx = point.x - Number(component.x || 0)
  const dy = point.y - Number(component.y || 0)
  const step = Math.max(1.5, gridMm * 1.5)
  if (isSmallSmd) {
    const smdStep = Math.max(0.9, gridMm)
    if (isControlNet(point.netName)) {
      const vertical = { ...point, y: round(point.y + Math.sign(dy || 1) * Math.max(1.2, gridMm * 2)) }
      if (pointInPolygon(vertical, board.outline || [])) return vertical
      const horizontal = { ...point, x: round(point.x + Math.sign(dx || 1) * smdStep) }
      if (pointInPolygon(horizontal, board.outline || [])) return horizontal
    }
    const primary = Math.abs(dx) >= Math.abs(dy)
      ? { ...point, x: round(point.x + Math.sign(dx || 1) * smdStep) }
      : { ...point, y: round(point.y + Math.sign(dy || 1) * smdStep) }
    if (pointInPolygon(primary, board.outline || [])) return primary
    return point
  }
  if (isHeader) {
    const bounds = polygonBounds(board.outline || [])
    const boardCx = (bounds.minX + bounds.maxX) / 2
    const boardCy = (bounds.minY + bounds.maxY) / 2
    const componentX = Number(component.x || point.x)
    const componentY = Number(component.y || point.y)
    const edgeHorizontal = Math.min(Math.abs(componentX - bounds.minX), Math.abs(componentX - bounds.maxX)) <= Math.min(Math.abs(componentY - bounds.minY), Math.abs(componentY - bounds.maxY))
    const primary = edgeHorizontal
      ? { ...point, x: round(point.x + Math.sign(boardCx - componentX || 1) * step) }
      : { ...point, y: round(point.y + Math.sign(boardCy - componentY || 1) * step) }
    if (pointInPolygon(primary, board.outline || [])) return primary
  }
  if (isModule && isPowerNetName(point.netName) && /^3V3$/i.test(String(point.netName || '')) && dx < 0 && dy < 0) {
    const rightEscape = { ...point, x: round(point.x + step) }
    if (pointInPolygon(rightEscape, board.outline || [])) return rightEscape
  }
  let candidate
  if (Math.abs(dx) >= Math.abs(dy)) candidate = { ...point, x: round(point.x + Math.sign(dx || 1) * step) }
  else candidate = { ...point, y: round(point.y + Math.sign(dy || 1) * step) }
  if (pointInPolygon(candidate, board.outline || [])) return candidate
  const alternate = Math.abs(dx) >= Math.abs(dy)
    ? { ...point, y: round(point.y + Math.sign(dy || 1) * step) }
    : { ...point, x: round(point.x + Math.sign(dx || 1) * step) }
  return pointInPolygon(alternate, board.outline || []) ? alternate : point
}

function isControlNet(netName) {
  return /^(EN|ENABLE|CHIP_EN|BOOT|BOOT0|BOOT1|RESET|NRST|RST)$/i.test(String(netName || ''))
}

function isPowerNetName(netName) {
  return /^(3V3|3V3_[A-Z0-9_]+|5V|VCC|VDD|VDDA|VDDD|VBAT|VIN|VUSB)$/i.test(String(netName || ''))
}

function componentCenterFallbackPath(start, end, board) {
  if (!start || !end) return []
  const first = { x: round(start.x), y: round(start.y) }
  const last = { x: round(end.x), y: round(end.y) }
  const candidates = [
    [first, { x: round(end.x), y: round(start.y) }, last],
    [first, { x: round(start.x), y: round(end.y) }, last],
  ]
  return candidates.find((path) => path.every((point) => pointInPolygon(point, board.outline || []))) || []
}

function findPath({ board, start, end, obstacles, occupied, gridMm, layer, netName, netClass, widthMm = 0.15, allowedRefs = [], options = {} }) {
  const bounds = polygonBounds(board.outline || [])
  const edgeClearanceMm = Number(board.routeEdgeClearanceMm || 0.8)
  const startNode = snap(start, gridMm)
  const endNode = snap(end, gridMm)
  const open = new Map([[key(startNode), { point: startNode, cost: 0, priority: heuristic(startNode, endNode), parent: null }]])
  const closed = new Set()
  let iterations = 0
  const maxIterations = Number(options.maxAstarIterations || 25000)
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
      if (blocked(next, obstacles, occupied, layer, startNode, endNode, gridMm, allowedRefs, current.point, netName, netClass, widthMm)) continue
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
    .filter((component) => createsBodyRouteObstacle(component))
    .map((component) => ({ ref: component.ref, polygon: rectCorners(component, clearance), clearance }))
}

function createsBodyRouteObstacle(component) {
  if (component.routeUnderBody === true) return false
  if (component.routingKeepout === false) return false
  const group = String(component.group || '').toUpperCase()
  const footprint = String(component.footprint?.libId || component.footprint || '').toUpperCase()
  const isLargeModule = (Number(component.width || 0) >= 18 && Number(component.height || 0) >= 14)
  if (['ESP32_S3', 'MCU_MODULE', 'RF_MODULE', 'SENSOR_MODULE'].includes(group)) return false
  if (isLargeModule && /ESP32|WROOM|MODULE/.test(footprint)) return false
  return true
}

function padObstacles(pads, profile, options) {
  const clearance = Math.max(
    Number(options.padRouteKeepoutMm ?? options.padClearanceMm ?? 0),
    Number(profile.minClearanceMm || 0.127) + 0.15,
    0.32,
  )
  return pads
    .filter((pad) => isElectricalCopperPad(pad))
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

function drcForbiddenObstacles(points = []) {
  return points
    .filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
    .map((point) => {
      const radius = Number(point.radiusMm || 0.75)
      return {
        ref: `drc:${point.net || 'net'}:${point.x}:${point.y}`,
        kind: 'drc_forbidden',
        affectedNets: point.net ? [String(point.net)] : [],
        layer: point.layer || null,
        polygon: rectPolygon(Number(point.x), Number(point.y), radius * 2, radius * 2),
        clearance: radius,
        sourceType: point.sourceType || 'drc',
      }
    })
}

function inferEndpoints(net, components, pads = [], options = {}) {
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
  if (options.requirePadEndpoints === true) return { start: null, end: null, refs: [], pads: [], source: 'missing_real_pad_endpoints' }
  const refs = []
  for (const component of components) {
    if (Object.values(component.pinMap || {}).includes(net.name)) refs.push(component.ref)
  }
  const matched = components.filter((component) => refs.includes(component.ref))
  if (matched.length >= 2) return { start: pointFor(matched[0]), end: pointFor(matched[1]), all: matched.map(pointFor), refs, source: 'component_centers' }
  if (matched.length === 1 && net.end) return { start: pointFor(matched[0]), end: net.end, refs, source: 'component_to_explicit_point' }
  return { start: null, end: null, refs, pads: [], source: 'missing' }
}

function routed(net, start, end, endpoints, path, layer, layerCount, board, designIntent, profile, options, vias = [], endpointContactLayers = null) {
  const rules = netClassProfiles[net.className || 'DEFAULT'] || netClassProfiles.DEFAULT
  const widthMm = routeWidthForNet(net, profile, options)
  const viaPlan = planViasForRoute({ net, start, end, board: { ...board, layerCount }, zones: designIntent.zones, profile })
  const waypoints = insertRouteViasIntoPath(path, vias)
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
    endpointContactLayers: endpointContactLayers || endpointContactLayersForRoute(start, end, layer),
    viaPlan: { ...viaPlan, candidates: vias, maxVias: vias.length || viaPlan.maxVias || 0 },
    waypoints,
    estimatedLengthMm: routeLength(waypoints),
    status: 'routed',
  }
}

function insertRouteViasIntoPath(path = [], vias = []) {
  let output = [...(path || [])]
  for (const via of vias || []) {
    if (!Number.isFinite(Number(via.x)) || !Number.isFinite(Number(via.y))) continue
    if (pointOnPath(via, output)) continue
    let bestIndex = -1
    let bestDistance = Infinity
    for (let index = 1; index < output.length; index += 1) {
      const distance = distancePointToSegment(via, output[index - 1], output[index])
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    }
    if (bestIndex > 0 && bestDistance <= 1.5) output = [...output.slice(0, bestIndex), { ...via }, ...output.slice(bestIndex)]
  }
  return dedupePath(output)
}

function pointOnPath(point = {}, path = []) {
  for (let index = 1; index < path.length; index += 1) {
    if (distancePointToSegment(point, path[index - 1], path[index]) <= 0.001) return true
  }
  return false
}

function powerTraceWidth(net = {}) {
  const currentMa = Number(net.currentMa || net.requiredCurrentMa || net.loadCurrentMa || 0)
  const name = String(net.name || '')
  if (/^(VBAT|VIN|POE_VDD|PHASE_|MOTOR_)/i.test(name) || currentMa > 1500) return 0.8
  if (currentMa > 700) return 0.5
  if (/^(5V|VUSB|3V3)/i.test(name)) return 0.25
  if (/POWER|BATTERY|HIGH_CURRENT/i.test(net.className || '') || currentMa > 250) return 0.3
  return 0
}

function routeWidthForNet(net = {}, profile = {}, options = {}) {
  const rules = netClassProfiles[net.className || 'DEFAULT'] || netClassProfiles.DEFAULT
  return Math.max(options.widthMm || 0, powerTraceWidth(net), rules.traceWidthMm || 0.15, profile.minTraceWidthMm || 0.127)
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

function blocked(point, obstacles, occupied, layer, start, end, gridMm, allowedRefs = [], previous = null, netName = null, netClass = 'DEFAULT', widthMm = 0.15) {
  const nearOwnEndpoint = heuristic(point, start) <= gridMm || heuristic(point, end) <= gridMm
  if (obstacles.some((obstacle) => obstacleBlocksPoint(obstacle, point, { allowedRefs, netName, nearOwnEndpoint }))) return true
  if (previous && obstacles.some((obstacle) => obstacleBlocksSegment(obstacle, previous, point, { allowedRefs, netName, nearOwnEndpoint }))) return true
  if (previous && segmentViolatesOccupiedClearance(previous, point, occupied, layer, netName, netClass, widthMm)) return true
  const pointKey = `${layer}:${key(point)}`
  if (!occupied.has(pointKey)) return false
  return !occupied.pointNets?.get(pointKey)?.has(netName)
}

function obstacleBlocksPoint(obstacle, point, { allowedRefs = [], netName = null, nearOwnEndpoint = false } = {}) {
  if (!pointInPolygon(point, obstacle.polygon)) return false
  if (obstacle.kind === 'drc_forbidden') {
    if (obstacle.affectedNets?.length && !obstacle.affectedNets.includes(String(netName))) return false
    if (nearOwnEndpoint) return false
    return true
  }
  if (obstacle.kind === 'pad') {
    if (obstacle.netName && obstacle.netName === netName) return false
    if (nearOwnEndpoint && allowedRefs.includes(obstacle.ref)) return false
    return true
  }
  if (allowedRefs.includes(obstacle.ref)) return false
  if (nearOwnEndpoint) return false
  return true
}

function obstacleBlocksSegment(obstacle, start, end, { allowedRefs = [], netName = null, nearOwnEndpoint = false } = {}) {
  if (!segmentIntersectsPolygon(start, end, obstacle.polygon)) return false
  if (obstacle.kind === 'drc_forbidden') {
    if (obstacle.affectedNets?.length && !obstacle.affectedNets.includes(String(netName))) return false
    if (nearOwnEndpoint) return false
    return true
  }
  if (obstacle.kind === 'pad') {
    if (obstacle.netName && obstacle.netName === netName) return false
    if (nearOwnEndpoint && allowedRefs.includes(obstacle.ref)) return false
    return true
  }
  if (allowedRefs.includes(obstacle.ref)) return false
  if (nearOwnEndpoint) return false
  return true
}

function segmentIntersectsPolygon(start, end, polygon = []) {
  if (!polygon.length) return false
  if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) return true
  for (let index = 0; index < polygon.length; index += 1) {
    if (segmentsIntersect(start, end, polygon[index], polygon[(index + 1) % polygon.length])) return true
  }
  return false
}

function reserveRoute(route, occupied, gridMm) {
  const layer = route.layerPreference?.[0] || 'F.Cu'
  const points = route.waypoints || []
  for (let index = 1; index < points.length; index += 1) {
    occupied.routeSegments.push({ layer, start: points[index - 1], end: points[index], net: route.net, widthMm: route.widthMm || 0.15, clearanceMm: route.clearanceMm || 0.15 })
    for (const point of sampledSegment(points[index - 1], points[index], gridMm / 2)) {
      reserveOccupiedPoint(occupied, layer, point, gridMm, route.net)
    }
  }
}

function reserveExistingCopper(occupied, tracks, vias, gridMm) {
  for (const track of tracks || []) {
    const layer = track.layer || 'F.Cu'
    occupied.routeSegments.push({ layer, start: track.start, end: track.end, net: track.netName || track.net, widthMm: track.widthMm || track.width || 0.15, clearanceMm: track.clearanceMm || 0.15 })
    for (const point of sampledSegment(track.start, track.end, gridMm / 2)) reserveOccupiedPoint(occupied, layer, point, gridMm, track.netName || track.net)
  }
  for (const via of vias || []) {
    for (const layer of via.layers?.length ? via.layers : ['F.Cu', 'B.Cu']) reserveOccupiedPoint(occupied, layer, via, gridMm, via.netName || via.net)
  }
}

function segmentCrossesOccupied(start, end, occupied, layer, netName = null) {
  for (const segment of occupied.routeSegments || []) {
    if (segment.layer !== layer) continue
    if (segment.net === netName) continue
    if (segmentsIntersect(start, end, segment.start, segment.end)) return true
  }
  return false
}

function segmentViolatesOccupiedClearance(start, end, occupied, layer, netName = null, netClass = 'DEFAULT', widthMm = 0.15) {
  const rules = netClassProfiles[netClass || 'DEFAULT'] || netClassProfiles.DEFAULT
  const currentWidth = Number(widthMm || rules.traceWidthMm || 0.15)
  const currentClearance = Number(rules.clearanceMm || 0.15)
  for (const segment of occupied.routeSegments || []) {
    if (segment.layer !== layer) continue
    if (segment.net === netName) continue
    if (sharesEndpoint(start, end, segment.start, segment.end)) continue
    const required = Math.max(
      currentClearance,
      currentWidth / 2 + Number(segment.widthMm || 0.15) / 2 + Math.max(currentClearance, Number(segment.clearanceMm || 0.15)),
    )
    if (segmentDistance(start, end, segment.start, segment.end) < required) return true
  }
  return false
}

function segmentDistance(a1, a2, b1, b2) {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0
  return Math.min(
    distancePointToSegment(a1, b1, b2),
    distancePointToSegment(a2, b1, b2),
    distancePointToSegment(b1, a1, a2),
    distancePointToSegment(b2, a1, a2),
  )
}

function sharesEndpoint(a1, a2, b1, b2) {
  return samePoint(a1, b1) || samePoint(a1, b2) || samePoint(a2, b1) || samePoint(a2, b2)
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001
}

function reserveOccupiedPoint(occupied, layer, point, gridMm, netName = null) {
  const snapped = snap(point, gridMm)
  const pointKey = `${layer}:${key(snapped)}`
  occupied.add(pointKey)
  if (!occupied.pointNets.has(pointKey)) occupied.pointNets.set(pointKey, new Set())
  if (netName) occupied.pointNets.get(pointKey).add(netName)
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
  return cleanupPathAngles(points
    .map((point) => ({ x: round(point.x), y: round(point.y) }))
    .filter((point, index, list) => index === 0 || heuristic(point, list[index - 1]) >= gridMm * 0.5))
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

function isPhysicallyRoutableNet(net = {}, components = [], pads = []) {
  if (net.start && net.end) return true
  if (Array.isArray(net.pins) && net.pins.length >= 2) return true
  if (net.pinCount >= 2) return true
  if (pads.filter((pad) => isElectricalCopperPad(pad) && (pad.netName === net.name || pad.net === net.name)).length >= 2) return true
  const refs = components.filter((component) => Object.values(component.pinMap || {}).includes(net.name)).map((component) => component.ref)
  if (new Set(refs).size >= 2) return true
  return false
}

function cleanupPathAngles(points = []) {
  const cleaned = []
  for (const rawPoint of points) {
    const point = { x: round(rawPoint.x), y: round(rawPoint.y) }
    if (!cleaned.length) {
      cleaned.push(point)
      continue
    }
    const previous = cleaned[cleaned.length - 1]
    if (samePoint(previous, point)) continue
    if (isOrthogonalOrFortyFive(previous, point)) {
      cleaned.push(point)
      continue
    }
    const dogleg = chooseDogleg(previous, point)
    if (dogleg && !samePoint(previous, dogleg) && !samePoint(dogleg, point)) cleaned.push(dogleg)
    cleaned.push(point)
  }
  return removeCollinear(cleaned)
}

function chooseDogleg(start, end) {
  const horizontalFirst = { x: round(end.x), y: round(start.y) }
  const verticalFirst = { x: round(start.x), y: round(end.y) }
  const dx = Math.abs(end.x - start.x)
  const dy = Math.abs(end.y - start.y)
  return dx >= dy ? horizontalFirst : verticalFirst
}

function removeCollinear(points = []) {
  const output = []
  for (const point of points) {
    if (output.length >= 2) {
      const a = output[output.length - 2]
      const b = output[output.length - 1]
      if (sameLine(a, b, point)) {
        output[output.length - 1] = point
        continue
      }
    }
    output.push(point)
  }
  return output
}

function sameLine(a, b, c) {
  const abx = round(b.x - a.x)
  const aby = round(b.y - a.y)
  const bcx = round(c.x - b.x)
  const bcy = round(c.y - b.y)
  return (abx === 0 && bcx === 0) || (aby === 0 && bcy === 0) || (Math.abs(abx) === Math.abs(aby) && Math.abs(bcx) === Math.abs(bcy) && Math.sign(abx) === Math.sign(bcx) && Math.sign(aby) === Math.sign(bcy))
}

function isOrthogonalOrFortyFive(start, end) {
  const dx = Math.abs(round(end.x - start.x))
  const dy = Math.abs(round(end.y - start.y))
  return dx === 0 || dy === 0 || Math.abs(dx - dy) <= 0.001
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
  const byNet = canonicalizeConnectorDuplicatePads(pads.filter((pad) => isElectricalCopperPad(pad) && (pad.netName === net.name || explicitPins.has(`${pad.ref}:${pad.pad}`) || explicitPins.has(`${pad.ref}:${pad.name}`))))
  if (byNet.length >= 2) return farthestPair(byNet)
  return byNet
}

function allPadEndpoints(net, pads) {
  const explicitPins = new Set((net.pins || []).map((pin) => `${pin.ref || pin.componentRef}:${pin.pin || pin.pad || pin.name}`))
  return canonicalizeConnectorDuplicatePads(pads.filter((pad) => isElectricalCopperPad(pad) && (pad.netName === net.name || explicitPins.has(`${pad.ref}:${pad.pad}`) || explicitPins.has(`${pad.ref}:${pad.name}`))))
}

function canonicalizeConnectorDuplicatePads(pads = []) {
  const byConnectorNet = new Map()
  const output = []
  for (const pad of pads) {
    const footprint = String(pad.footprint || '').toUpperCase()
    const netName = String(pad.netName || '').toUpperCase()
    const padName = String(pad.pad || pad.name || '').toUpperCase()
    const isUsbDuplicate = /USB_C|TYPE-C|TYPE_C|USB/.test(footprint)
      && /^(USB_DP|USB_DN|VUSB|VBUS)$/.test(netName)
      && /^(A|B)(4|6|7|9)$/.test(padName)
    if (!isUsbDuplicate) {
      output.push(pad)
      continue
    }
    const key = `${pad.ref}:${netName}`
    const existing = byConnectorNet.get(key)
    if (!existing || usbRepresentativeRank(pad, netName) < usbRepresentativeRank(existing, netName)) byConnectorNet.set(key, pad)
  }
  return [...output, ...byConnectorNet.values()]
}

function usbRepresentativeRank(pad = {}, netName = '') {
  const name = String(pad.pad || pad.name || '').toUpperCase()
  if (/USB_DP/.test(netName)) return name === 'A6' ? 0 : name === 'B6' ? 1 : 10
  if (/USB_DN/.test(netName)) return name === 'B7' ? 0 : name === 'A7' ? 1 : 10
  if (/VUSB|VBUS/.test(netName)) return name === 'A4' ? 0 : name === 'B9' ? 1 : name === 'A9' ? 2 : name === 'B4' ? 3 : 10
  return 10
}

function isElectricalCopperPad(pad = {}) {
  const layers = pad.layers || []
  if (!layers.length) return true
  if (pad.throughHole) return true
  return layers.some((layer) => /(^|\.)(Cu)$/i.test(layer) || layer === 'F.Cu' || layer === 'B.Cu' || /Cu$/.test(layer))
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
