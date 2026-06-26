import { distancePointToSegment, pointInPolygon, round, segmentsIntersect } from './geometry.mjs'
import { netClassProfiles } from './net-classes.mjs'
import { extractPadCopperGeometry } from './autorouter.mjs'

export function validateRoutingGeometry({ board, components = [], routingPlan, profile = {} }) {
  const routes = routingPlan?.routes || []
  const zones = routingPlan?.designIntent?.zones || []
  const pads = routingPlan?.pads || routingPlan?.designIntent?.pads || []
  const existingTracks = routingPlan?.existingTracks || []
  const issues = []
  for (const route of routes) {
    issues.push(...validateRoute(route, board, components, profile, pads))
  }
  for (const route of routes) {
    issues.push(...validateRouteVias(route, board, zones, profile, pads))
  }
  issues.push(...validateDifferentialPairs(routes))
  issues.push(...validateRouteToRouteClearance(routes, profile))
  issues.push(...validateExistingCopperConflicts(routes, existingTracks, profile))
  issues.push(...validateCopperPours(routingPlan?.designIntent?.copperPours || [], zones))
  return {
    status: issues.some((issue) => issue.severity === 'ERROR') ? 'ROUTING_GEOMETRY_NEEDS_FIX' : issues.length ? 'ROUTING_GEOMETRY_NEEDS_REVIEW' : 'ROUTING_GEOMETRY_READY_NEEDS_DRC',
    issues,
    errors: issues.filter((issue) => issue.severity === 'ERROR'),
    warnings: issues.filter((issue) => issue.severity === 'WARNING'),
    checkedRoutes: routes.length,
    humanReviewRequired: true,
  }
}

export function verifyPadToPadConnectivity(route = {}, pads = []) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  const sourcePad = resolveRoutePad(route.start, pads)
  const targetPad = resolveRoutePad(route.end, pads)
  const primaryLayer = route.layerPreference?.[0] || 'F.Cu'
  const viaCandidates = route.viaPlan?.candidates || []
  const sourceLayer = route.endpointContactLayers?.source || (primaryLayer !== 'F.Cu' && viaCandidates.length ? 'F.Cu' : primaryLayer)
  const targetLayer = route.endpointContactLayers?.target || (primaryLayer !== 'F.Cu' && viaCandidates.length ? 'F.Cu' : primaryLayer)
  const sourceTouched = Boolean(sourcePad && points[0] && pointTouchesPadCopper(points[0], sourcePad, sourceLayer))
  const targetTouched = Boolean(targetPad && points.at(-1) && pointTouchesPadCopper(points.at(-1), targetPad, targetLayer))
  const continuousCopper = routeBundleIsContinuous(route)
  const floatingGeneratedIslands = sourceTouched && targetTouched && continuousCopper ? 0 : 1
  return {
    net: route.net,
    sourcePad: sourcePad ? `${sourcePad.ref || ''} pad ${sourcePad.pad || sourcePad.name || ''}`.trim() : null,
    targetPad: targetPad ? `${targetPad.ref || ''} pad ${targetPad.pad || targetPad.name || ''}`.trim() : null,
    sourceTouched,
    targetTouched,
    continuousCopper,
    floatingGeneratedIslands,
    commitAllowed: Boolean(sourceTouched && targetTouched && continuousCopper && floatingGeneratedIslands === 0),
  }
}

function resolveRoutePad(endpoint = {}, pads = []) {
  if (!endpoint) return null
  if (endpoint.id || endpoint.ref || endpoint.pad || endpoint.name || endpoint.netName) {
    const byId = endpoint.id ? pads.find((pad) => pad.id === endpoint.id) : null
    if (byId) return byId
    const byRefPad = endpoint.ref
      ? pads.find((pad) => pad.ref === endpoint.ref && String(pad.pad || pad.name || '') === String(endpoint.pad || endpoint.name || ''))
      : null
    if (byRefPad) return byRefPad
    if (Number.isFinite(Number(endpoint.x)) && Number.isFinite(Number(endpoint.y))) {
      const sameNet = pads.filter((pad) => !endpoint.netName || pad.netName === endpoint.netName)
      return nearestPad(endpoint, sameNet.length ? sameNet : pads)
    }
  }
  return null
}

function nearestPad(point, pads = []) {
  let best = null
  let bestDistance = Infinity
  for (const pad of pads) {
    if (!Number.isFinite(Number(pad.x)) || !Number.isFinite(Number(pad.y))) continue
    const distance = Math.hypot(Number(point.x) - Number(pad.x), Number(point.y) - Number(pad.y))
    if (distance < bestDistance) {
      best = pad
      bestDistance = distance
    }
  }
  return best
}

function pointTouchesPadCopper(point = {}, pad = {}, layer = 'F.Cu') {
  if (!padLayerCompatible(pad, layer)) return false
  const geometry = extractPadCopperGeometry(pad)
  const box = geometry?.box || {}
  const tolerance = 0.001
  return Number(point.x) >= Number(box.minX) - tolerance
    && Number(point.x) <= Number(box.maxX) + tolerance
    && Number(point.y) >= Number(box.minY) - tolerance
    && Number(point.y) <= Number(box.maxY) + tolerance
}

function padLayerCompatible(pad = {}, layer = 'F.Cu') {
  if (pad.throughHole) return true
  const layers = pad.layers || []
  if (!layers.length) return true
  if (layers.includes(layer)) return true
  if (layer === 'F.Cu' && layers.includes('*.Cu')) return true
  if (layer === 'B.Cu' && layers.includes('*.Cu')) return true
  return false
}

function routeBundleIsContinuous(route = {}) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  if (points.length < 2) return false
  const viaCandidates = route.viaPlan?.candidates || []
  for (const via of viaCandidates) {
    if (!pointOnRoutePath(via, points)) return false
  }
  return true
}

function pointOnRoutePath(point = {}, points = []) {
  for (let index = 1; index < points.length; index += 1) {
    if (distancePointToSegment(point, points[index - 1], points[index]) <= 0.001) return true
  }
  return false
}

function validateRoute(route, board, components, profile, pads = []) {
  const issues = []
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  if (points.length < 2) {
    issues.push(issue('WARNING', 'ROUTE_HAS_NO_GEOMETRY', `${route.net} has no writable route geometry.`, { route }))
    return issues
  }
  const netRules = netClassProfiles[route.className || 'DEFAULT'] || netClassProfiles.DEFAULT
  const minWidth = Math.max(profile.minTraceWidthMm || 0.127, netRules.traceWidthMm || 0)
  if ((route.widthMm || 0) < minWidth) {
    issues.push(issue('ERROR', 'ROUTE_WIDTH_TOO_SMALL', `${route.net} width is below required minimum.`, { net: route.net, widthMm: route.widthMm, requiredMm: minWidth }))
  }
  if (['BATTERY', 'POWER_HIGH_CURRENT', 'MOTOR_PHASE'].includes(route.className || '') && (route.widthMm || 0) < 0.35) {
    issues.push(issue('WARNING', 'POWER_ROUTE_WIDTH_REVIEW', `${route.net} is a power/high-current route and should be reviewed for current capacity.`, { net: route.net, widthMm: route.widthMm }))
  }
  for (const point of points) {
    if (!insideOrOnBoard(point, board.outline || [])) issues.push(issue('ERROR', 'ROUTE_POINT_OFF_BOARD', `${route.net} route point is outside the board outline.`, { net: route.net, point }))
  }
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    if (!segmentStaysInsideBoard(start, end, board.outline || [])) {
      issues.push(issue('ERROR', 'ROUTE_SEGMENT_CROSSES_BOARD_EDGE', `${route.net} segment crosses or leaves the board outline.`, { net: route.net, start, end }))
    }
    if (!isOrthogonalOrFortyFive(start, end)) {
      issues.push(issue('WARNING', 'ROUTE_NON_45_90_DEGREES', `${route.net} has a non-45/90 degree segment that may be hard to manufacture cleanly.`, { net: route.net, start, end }))
    }
    for (const component of components) {
      const clearance = route.className === 'GROUND' ? 0 : profile.componentToComponentClearanceMm || 0.25
      const nearest = distanceRouteToComponent(start, end, component)
      if (nearest < clearance) {
        issues.push(issue('WARNING', 'ROUTE_COMPONENT_CLEARANCE_REVIEW', `${route.net} passes close to ${component.ref}.`, { net: route.net, component: component.ref, nearestMm: round(nearest), requiredMm: clearance }))
      }
    }
    for (const hole of board.mountingHoles || []) {
      const nearest = distancePointToSegment(hole, start, end)
      const required = (hole.diameterMm || 3) / 2 + (profile.mountingHoleEdgeClearanceMm || 0.8)
      if (nearest < required) {
        issues.push(issue('ERROR', 'ROUTE_MOUNTING_HOLE_CLEARANCE', `${route.net} violates mounting hole clearance for ${hole.id}.`, { net: route.net, hole: hole.id, nearestMm: round(nearest), requiredMm: required }))
      }
    }
    for (const pad of pads) {
      if (!Number.isFinite(Number(pad.x)) || !Number.isFinite(Number(pad.y)) || pad.netName === route.net) continue
      const nearest = distancePointToSegment(pad, start, end)
      const required = Math.max(profile.minClearanceMm || 0.127, (pad.widthMm || 0.4) / 2 + (route.widthMm || 0.15) / 2)
      if (nearest < required) issues.push(issue('ERROR', 'ROUTE_PAD_CLEARANCE', `${route.net} violates pad clearance near ${pad.ref || ''}:${pad.pad || pad.name || ''}.`, { net: route.net, pad: pad.id, nearestMm: round(nearest), requiredMm: round(required) }))
    }
  }
  return issues
}

function validateRouteVias(route, board, zones, profile, pads = []) {
  const issues = []
  const candidates = route.viaPlan?.candidates || []
  const rules = route.viaPlan?.rules || {}
  if (['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RF', 'CRYSTAL', 'CLOCK'].includes(route.className || '') && candidates.length) {
    issues.push(issue('WARNING', 'SENSITIVE_ROUTE_HAS_VIA', `${route.net} is sensitive and should avoid vias unless reviewed.`, { net: route.net, viaCount: candidates.length }))
  }
  for (const via of candidates) {
    if (!insideOrOnBoard(via, board.outline || [])) issues.push(issue('ERROR', 'VIA_OFF_BOARD', `${route.net} via is outside the board outline.`, { net: route.net, via }))
    if ((via.diameterMm || 0) < Math.max(profile.minViaDiameterMm || 0.45, rules.diameterMm || 0)) issues.push(issue('ERROR', 'VIA_DIAMETER_TOO_SMALL', `${route.net} via diameter is below manufacturer minimum.`, { net: route.net, via }))
    if ((via.drillMm || 0) < Math.max(profile.minViaDrillMm || 0.2, rules.drillMm || 0)) issues.push(issue('ERROR', 'VIA_DRILL_TOO_SMALL', `${route.net} via drill is below manufacturer minimum.`, { net: route.net, via }))
    if (['blind', 'buried', 'microvia'].includes(via.viaType) && !/supported|review|quote/i.test(`${profile.hdi?.blindVias || ''} ${profile.hdi?.buriedVias || ''} ${profile.hdi?.microvias || ''}`)) {
      issues.push(issue('ERROR', 'ADVANCED_VIA_NOT_SUPPORTED', `${route.net} uses ${via.viaType}, but the selected manufacturer profile does not support advanced vias.`, { net: route.net, via }))
    }
    if (['blind', 'buried', 'microvia'].includes(via.viaType) && !rules.hdiReviewRequired) {
      issues.push(issue('WARNING', 'ADVANCED_VIA_REVIEW_REQUIRED', `${route.net} uses ${via.viaType}; manufacturer quote and stackup review are required.`, { net: route.net, via }))
    }
    if (via.layers?.length === 2 && rules.allowedTransitions?.length && !viaLayerPairAllowed(via.layers, rules.allowedTransitions, board)) {
      issues.push(issue('ERROR', 'VIA_LAYER_PAIR_NOT_ALLOWED', `${route.net} via layer pair ${via.layers.join('->')} is not allowed by stackup policy.`, { net: route.net, via }))
    }
    const blocked = zones.find((zone) => zone.allowVias === false && pointInPolygon(via, zone.polygon || []))
    if (blocked) issues.push(issue('ERROR', 'VIA_IN_KEEP_OUT', `${route.net} via is inside ${blocked.id}.`, { net: route.net, zone: blocked.id, via }))
    for (const pad of pads) {
      if (!Number.isFinite(Number(pad.x)) || !Number.isFinite(Number(pad.y)) || pad.netName === route.net) continue
      const required = Math.max(profile.holeClearanceMm || profile.minClearanceMm || 0.127, (Number(via.diameterMm || 0.45) / 2) + (Math.min(Number(pad.widthMm || pad.width || 0.4), Number(pad.heightMm || pad.height || 0.4)) / 2))
      const actual = Math.hypot(Number(via.x) - Number(pad.x), Number(via.y) - Number(pad.y))
      if (actual < required) issues.push(issue('ERROR', 'VIA_PAD_CLEARANCE', `${route.net} via violates pad clearance near ${pad.ref || ''}:${pad.pad || pad.name || ''}.`, { net: route.net, pad: pad.id, nearestMm: round(actual), requiredMm: round(required) }))
    }
  }
  if (candidates.length > (route.viaPlan?.maxVias ?? Infinity)) issues.push(issue('ERROR', 'TOO_MANY_VIAS', `${route.net} exceeds its via budget.`, { net: route.net, viaCount: candidates.length, maxVias: route.viaPlan.maxVias }))
  return issues
}

function viaLayerPairAllowed(layers = [], allowedTransitions = [], board = {}) {
  const exact = allowedTransitions.some((pair) => pair[0] === layers[0] && pair[1] === layers[1])
  if (exact) return true
  const reverse = allowedTransitions.some((pair) => pair[0] === layers[1] && pair[1] === layers[0])
  if (reverse) return true
  const layerCount = Number(board.layerCount || 2)
  if (layerCount >= 4 && layers.length === 2 && layers.includes('F.Cu') && layers.some((layer) => /^In\d+\.Cu$/i.test(layer))) return true
  if (layerCount >= 6 && layers.length === 2 && layers.every((layer) => /^In\d+\.Cu$/i.test(layer) || layer === 'B.Cu' || layer === 'F.Cu')) return true
  return false
}

function validateDifferentialPairs(routes) {
  const issues = []
  const byNet = new Map(routes.map((route) => [route.net, route]))
  for (const route of routes.filter((item) => ['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF'].includes(item.className || ''))) {
    const mateName = diffMate(route.net)
    if (mateName && !byNet.has(mateName)) issues.push(issue('WARNING', 'DIFF_PAIR_MATE_MISSING', `${route.net} is classified as differential but ${mateName} is missing from the route plan.`, { net: route.net, mate: mateName }))
    const mate = mateName ? byNet.get(mateName) : null
    if (mate && route.status === 'routed' && mate.status === 'routed') {
      const mismatch = Math.abs((route.estimatedLengthMm || 0) - (mate.estimatedLengthMm || 0))
      if (mismatch > 1.5) issues.push(issue('WARNING', 'DIFF_PAIR_SKEW_REVIEW', `${route.net}/${mateName} length mismatch is ${round(mismatch)}mm and needs tuning before high-speed release.`, { net: route.net, mate: mateName, mismatchMm: round(mismatch) }))
      if ((route.layerPreference?.[0] || 'F.Cu') !== (mate.layerPreference?.[0] || 'F.Cu')) {
        const controlledLayerSwap = route.differentialPair?.layerSwap === true || mate.differentialPair?.layerSwap === true
        issues.push(issue(controlledLayerSwap ? 'WARNING' : 'ERROR', controlledLayerSwap ? 'DIFF_PAIR_CONTROLLED_LAYER_SWAP_REVIEW' : 'DIFF_PAIR_LAYER_MISMATCH', `${route.net}/${mateName} are not on the same primary layer.`, { net: route.net, mate: mateName, controlledLayerSwap }))
      }
    }
  }
  return issues
}

function validateRouteToRouteClearance(routes, profile) {
  const issues = []
  const clearance = profile.minClearanceMm || 0.127
  for (let a = 0; a < routes.length; a += 1) {
    for (let b = a + 1; b < routes.length; b += 1) {
      if (!isWrittenOrRouted(routes[a]) || !isWrittenOrRouted(routes[b])) continue
      if (routes[a].net === routes[b].net) continue
      if ((routes[a].layerPreference?.[0] || 'F.Cu') !== (routes[b].layerPreference?.[0] || 'F.Cu')) continue
      for (const segA of routeSegments(routes[a])) {
        for (const segB of routeSegments(routes[b])) {
          const required = Math.max(clearance, (routes[a].widthMm || 0.15) / 2 + (routes[b].widthMm || 0.15) / 2 + clearance)
          const nearest = segmentDistance(segA.start, segA.end, segB.start, segB.end)
          if (nearest < required) issues.push(issue('ERROR', 'ROUTE_ROUTE_CLEARANCE', `${routes[a].net} violates ${routes[b].net} route clearance on the same layer.`, { nets: [routes[a].net, routes[b].net], nearestMm: round(nearest), requiredMm: round(required), clearanceMm: clearance }))
        }
      }
    }
  }
  return issues
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

function validateExistingCopperConflicts(routes, tracks, profile) {
  const issues = []
  for (const route of routes) {
    if (!isWrittenOrRouted(route)) continue
    for (const seg of routeSegments(route)) {
      for (const track of tracks || []) {
        if (track.netName === route.net) continue
        if ((track.layer || 'F.Cu') !== (seg.layer || route.layerPreference?.[0] || 'F.Cu')) continue
        if (segmentsIntersect(seg.start, seg.end, track.start, track.end)) issues.push(issue('ERROR', 'ROUTE_EXISTING_COPPER_CONFLICT', `${route.net} intersects existing copper ${track.netName || track.id || ''}.`, { net: route.net, track: track.id }))
      }
    }
  }
  return issues
}

function isWrittenOrRouted(route) {
  return ['routed', 'written_needs_drc'].includes(route.status)
}

function validateCopperPours(pours, zones) {
  const issues = []
  const blockedCopperZones = zones.filter((zone) => zone.allowCopper === false).map((zone) => zone.id)
  for (const pour of pours) {
    for (const zoneId of blockedCopperZones) {
      if (!(pour.avoidZones || []).includes(zoneId)) issues.push(issue('ERROR', 'COPPER_POUR_MISSING_KEEPOUT', `${pour.net} pour does not avoid ${zoneId}.`, { pour, zoneId }))
    }
    if (!pour.net || !pour.layer) issues.push(issue('ERROR', 'COPPER_POUR_INCOMPLETE', 'Copper pour is missing net or layer.', { pour }))
    if (!pour.polygon?.length && !pour.usesBoardOutline) issues.push(issue('WARNING', 'COPPER_POUR_POLYGON_REVIEW', `${pour.net || 'Copper'} pour does not define an explicit polygon; board-outline fill must be reviewed for islands.`, { pour }))
  }
  return issues
}

function segmentStaysInsideBoard(start, end, outline) {
  if (!outline.length) return false
  if (!insideOrOnBoard(start, outline) || !insideOrOnBoard(end, outline)) return false
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index]
    const b = outline[(index + 1) % outline.length]
    if (sharesEndpoint(start, end, a, b)) continue
    if (segmentsIntersect(start, end, a, b)) return false
  }
  return true
}

function insideOrOnBoard(point, outline) {
  if (!outline.length) return false
  if (pointInPolygon(point, outline)) return true
  return outline.some((start, index) => distancePointToSegment(point, start, outline[(index + 1) % outline.length]) <= 0.001)
}

function isOrthogonalOrFortyFive(start, end) {
  const dx = Math.abs(round(end.x - start.x))
  const dy = Math.abs(round(end.y - start.y))
  return dx === 0 || dy === 0 || Math.abs(dx - dy) <= 0.001
}

function routeSegments(route) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  const layer = route.layerPreference?.[0] || 'F.Cu'
  const segments = []
  for (let index = 1; index < points.length; index += 1) segments.push({ start: points[index - 1], end: points[index], layer })
  return segments
}

function sharesEndpoint(a1, a2, b1, b2) {
  return samePoint(a1, b1) || samePoint(a1, b2) || samePoint(a2, b1) || samePoint(a2, b2)
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001
}

function distanceRouteToComponent(start, end, component) {
  const halfW = (component.width || 0) / 2
  const halfH = (component.height || 0) / 2
  const corners = [
    { x: component.x - halfW, y: component.y - halfH },
    { x: component.x + halfW, y: component.y - halfH },
    { x: component.x + halfW, y: component.y + halfH },
    { x: component.x - halfW, y: component.y + halfH },
    { x: component.x, y: component.y },
  ]
  return Math.min(...corners.map((corner) => distancePointToSegment(corner, start, end)))
}

function diffMate(net) {
  if (/_DP$/.test(net)) return net.replace(/_DP$/, '_DN')
  if (/_DN$/.test(net)) return net.replace(/_DN$/, '_DP')
  if (/_P$/.test(net)) return net.replace(/_P$/, '_N')
  if (/_N$/.test(net)) return net.replace(/_N$/, '_P')
  return null
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
