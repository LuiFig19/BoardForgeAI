import { distancePointToSegment, pointInPolygon, round } from './geometry.mjs'
import { netClassProfiles } from './net-classes.mjs'

export function validateRoutingGeometry({ board, components = [], routingPlan, profile = {} }) {
  const routes = routingPlan?.routes || []
  const zones = routingPlan?.designIntent?.zones || []
  const issues = []
  for (const route of routes) {
    issues.push(...validateRoute(route, board, components, profile))
  }
  for (const route of routes) {
    issues.push(...validateRouteVias(route, board, zones, profile))
  }
  issues.push(...validateDifferentialPairs(routes))
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

function validateRoute(route, board, components, profile) {
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
    if (!pointInPolygon(point, board.outline || [])) issues.push(issue('ERROR', 'ROUTE_POINT_OFF_BOARD', `${route.net} route point is outside the board outline.`, { net: route.net, point }))
  }
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
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
  }
  return issues
}

function validateRouteVias(route, board, zones, profile) {
  const issues = []
  const candidates = route.viaPlan?.candidates || []
  const rules = route.viaPlan?.rules || {}
  if (['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RF', 'CRYSTAL', 'CLOCK'].includes(route.className || '') && candidates.length) {
    issues.push(issue('WARNING', 'SENSITIVE_ROUTE_HAS_VIA', `${route.net} is sensitive and should avoid vias unless reviewed.`, { net: route.net, viaCount: candidates.length }))
  }
  for (const via of candidates) {
    if (!pointInPolygon(via, board.outline || [])) issues.push(issue('ERROR', 'VIA_OFF_BOARD', `${route.net} via is outside the board outline.`, { net: route.net, via }))
    if ((via.diameterMm || 0) < Math.max(profile.minViaDiameterMm || 0.45, rules.diameterMm || 0)) issues.push(issue('ERROR', 'VIA_DIAMETER_TOO_SMALL', `${route.net} via diameter is below manufacturer minimum.`, { net: route.net, via }))
    if ((via.drillMm || 0) < Math.max(profile.minViaDrillMm || 0.2, rules.drillMm || 0)) issues.push(issue('ERROR', 'VIA_DRILL_TOO_SMALL', `${route.net} via drill is below manufacturer minimum.`, { net: route.net, via }))
    const blocked = zones.find((zone) => zone.allowVias === false && pointInPolygon(via, zone.polygon || []))
    if (blocked) issues.push(issue('ERROR', 'VIA_IN_KEEP_OUT', `${route.net} via is inside ${blocked.id}.`, { net: route.net, zone: blocked.id, via }))
  }
  if (candidates.length > (route.viaPlan?.maxVias ?? Infinity)) issues.push(issue('ERROR', 'TOO_MANY_VIAS', `${route.net} exceeds its via budget.`, { net: route.net, viaCount: candidates.length, maxVias: route.viaPlan.maxVias }))
  return issues
}

function validateDifferentialPairs(routes) {
  const issues = []
  const byNet = new Map(routes.map((route) => [route.net, route]))
  for (const route of routes.filter((item) => ['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF'].includes(item.className || ''))) {
    const mateName = diffMate(route.net)
    if (mateName && !byNet.has(mateName)) issues.push(issue('WARNING', 'DIFF_PAIR_MATE_MISSING', `${route.net} is classified as differential but ${mateName} is missing from the route plan.`, { net: route.net, mate: mateName }))
  }
  return issues
}

function validateCopperPours(pours, zones) {
  const issues = []
  const blockedCopperZones = zones.filter((zone) => zone.allowCopper === false).map((zone) => zone.id)
  for (const pour of pours) {
    for (const zoneId of blockedCopperZones) {
      if (!(pour.avoidZones || []).includes(zoneId)) issues.push(issue('ERROR', 'COPPER_POUR_MISSING_KEEPOUT', `${pour.net} pour does not avoid ${zoneId}.`, { pour, zoneId }))
    }
    if (!pour.net || !pour.layer) issues.push(issue('ERROR', 'COPPER_POUR_INCOMPLETE', 'Copper pour is missing net or layer.', { pour }))
  }
  return issues
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
