import { netClassProfiles } from './net-classes.mjs'

const sensitiveClasses = new Set(['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RF', 'CRYSTAL', 'CLOCK', 'ANALOG'])
const powerClasses = new Set(['BATTERY', 'POWER_HIGH_CURRENT', 'MOTOR_PHASE', 'POWER_LOW_CURRENT'])

export function scoreRoutingPlan({ routingPlan, profile = {}, powerTree = null } = {}) {
  const routes = routingPlan?.routes || []
  const issues = []
  const perRoute = routes.map((route) => scoreRoute(route, profile, powerTree, issues))
  issues.push(...scoreDifferentialPairs(perRoute))

  const metrics = {
    routeCount: routes.length,
    routableCount: perRoute.filter((route) => route.hasGeometry).length,
    unroutedCount: perRoute.filter((route) => !route.hasGeometry || /planned_not_routed/i.test(route.status || '')).length,
    totalLengthMm: round(perRoute.reduce((sum, route) => sum + route.lengthMm, 0)),
    viaCount: perRoute.reduce((sum, route) => sum + route.viaCount, 0),
    sensitiveViaCount: perRoute.filter((route) => route.sensitive).reduce((sum, route) => sum + route.viaCount, 0),
    layerSwapCount: perRoute.reduce((sum, route) => sum + route.layerSwapCount, 0),
    diffPairMismatchCount: issues.filter((issue) => issue.code === 'DIFF_PAIR_LENGTH_MISMATCH').length,
    powerWidthWarningCount: issues.filter((issue) => issue.code === 'POWER_ROUTE_WIDTH_LOW').length,
  }
  const penalty = issues.reduce((sum, item) => sum + (item.severity === 'ERROR' ? 14 : 6), 0)
    + metrics.unroutedCount * 8
    + metrics.sensitiveViaCount * 4
    + Math.max(0, metrics.layerSwapCount - Math.ceil(routes.length / 3)) * 2
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)))
  const actions = recommendedActions(issues, metrics)
  const errors = issues.filter((issue) => issue.severity === 'ERROR')
  const warnings = issues.filter((issue) => issue.severity === 'WARNING')
  return {
    status: errors.length ? 'ROUTING_QUALITY_NEEDS_FIX' : warnings.length ? 'ROUTING_QUALITY_NEEDS_REVIEW' : 'ROUTING_QUALITY_READY_NEEDS_DRC',
    score,
    metrics,
    perRoute,
    issues,
    warnings,
    errors,
    actions,
    humanReviewRequired: true,
  }
}

function scoreRoute(route, profile, powerTree, issues) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  const viaCount = route.viaPlan?.candidates?.length || 0
  const rules = netClassProfiles[route.className || 'DEFAULT'] || netClassProfiles.DEFAULT
  const lengthMm = route.estimatedLengthMm || estimatePathLength(points)
  const sensitive = sensitiveClasses.has(route.className || '')
  const widthRequiredMm = widthRequirement(route, rules, profile, powerTree)
  const layerSwapCount = countLayerSwaps(route)
  const hasGeometry = points.length >= 2

  if (!hasGeometry) {
    issues.push(issue('WARNING', 'ROUTE_NOT_WRITABLE', `${route.net} has no writable start/end or waypoint geometry.`, { net: route.net }))
  }
  if ((route.status || '') === 'planned_not_routed') {
    issues.push(issue('WARNING', 'ROUTE_STILL_PLAN_ONLY', `${route.net} is still marked plan-only, not completed copper.`, { net: route.net }))
  }
  if (powerClasses.has(route.className || '') && (route.widthMm || 0) < widthRequiredMm) {
    issues.push(issue(route.className === 'POWER_HIGH_CURRENT' || route.className === 'BATTERY' ? 'ERROR' : 'WARNING', 'POWER_ROUTE_WIDTH_LOW', `${route.net} route width is too small for the planned power class.`, { net: route.net, widthMm: route.widthMm || 0, requiredMm: widthRequiredMm }))
  }
  if (sensitive && viaCount > 0) {
    issues.push(issue(route.className === 'RF' ? 'ERROR' : 'WARNING', 'SENSITIVE_ROUTE_HAS_VIA', `${route.net} is sensitive and should avoid vias or use matched reviewed transitions.`, { net: route.net, viaCount }))
  }
  if (viaCount > (route.viaPlan?.maxVias ?? Infinity)) {
    issues.push(issue('ERROR', 'ROUTE_EXCEEDS_VIA_BUDGET', `${route.net} exceeds its route via budget.`, { net: route.net, viaCount, maxVias: route.viaPlan.maxVias }))
  }
  if (sensitive && layerSwapCount > 0 && !/matched|review/i.test(route.viaPlan?.strategy || route.strategy || '')) {
    issues.push(issue('WARNING', 'SENSITIVE_LAYER_SWAP_REVIEW', `${route.net} changes layers and needs return-path / impedance review.`, { net: route.net, layerSwapCount }))
  }
  if (lengthMm > routeLengthBudget(route)) {
    issues.push(issue('WARNING', 'ROUTE_LENGTH_HIGH', `${route.net} is long for its net class and may need placement/routing review.`, { net: route.net, lengthMm, budgetMm: routeLengthBudget(route) }))
  }

  return {
    net: route.net,
    className: route.className || 'DEFAULT',
    status: route.status,
    hasGeometry,
    lengthMm: round(lengthMm),
    widthMm: route.widthMm || 0,
    widthRequiredMm,
    viaCount,
    sensitive,
    layerSwapCount,
    quality: routeQualityLabel(route, lengthMm, viaCount, hasGeometry),
  }
}

function scoreDifferentialPairs(perRoute) {
  const issues = []
  const byNet = new Map(perRoute.map((route) => [route.net, route]))
  for (const route of perRoute.filter((item) => ['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF'].includes(item.className || ''))) {
    const mateName = diffMate(route.net)
    if (!mateName || !byNet.has(mateName)) continue
    if (route.net > mateName) continue
    const mate = byNet.get(mateName)
    const mismatch = Math.abs(route.lengthMm - mate.lengthMm)
    const limit = route.className === 'USB_DIFF' ? 0.5 : route.className === 'ETHERNET_DIFF' ? 1 : 2
    if (mismatch > limit) {
      issues.push(issue(mismatch > limit * 3 ? 'ERROR' : 'WARNING', 'DIFF_PAIR_LENGTH_MISMATCH', `${route.net}/${mate.net} length mismatch exceeds target.`, { net: route.net, mate: mate.net, mismatchMm: round(mismatch), targetMm: limit }))
    }
  }
  return issues
}

function widthRequirement(route, rules, profile, powerTree) {
  const rail = powerTree?.rails?.find((item) => item.name === route.net)
  const railCurrent = rail?.estimatedCurrentMa || rail?.currentMa || 0
  const currentWidth = railCurrent >= 1000 ? 0.8 : railCurrent >= 500 ? 0.5 : railCurrent >= 200 ? 0.35 : 0.25
  const powerFloor = route.className === 'POWER_HIGH_CURRENT' || route.className === 'BATTERY' ? 0.5 : route.className === 'POWER_LOW_CURRENT' ? 0.25 : 0
  return round(Math.max(profile.minTraceWidthMm || 0.127, rules.traceWidthMm || 0, currentWidth, powerFloor))
}

function routeLengthBudget(route) {
  if (route.className === 'CRYSTAL') return 15
  if (route.className === 'USB_DIFF') return 40
  if (route.className === 'ETHERNET_DIFF') return 55
  if (route.className === 'RF') return 25
  if (powerClasses.has(route.className || '')) return 80
  return 140
}

function countLayerSwaps(route) {
  return (route.viaPlan?.candidates || []).filter((via) => Array.isArray(via.layers) && via.layers.length === 2 && via.layers[0] !== via.layers[1]).length
}

function routeQualityLabel(route, lengthMm, viaCount, hasGeometry) {
  if (!hasGeometry) return 'unrouted'
  if (sensitiveClasses.has(route.className || '') && viaCount) return 'review_sensitive_vias'
  if (lengthMm > routeLengthBudget(route)) return 'review_long_route'
  return 'candidate'
}

function recommendedActions(issues, metrics) {
  const actions = []
  const codes = new Set(issues.map((issue) => issue.code))
  if (codes.has('ROUTE_NOT_WRITABLE') || codes.has('ROUTE_STILL_PLAN_ONLY')) actions.push({ command: 'generate_placement_plan', reason: 'Improve endpoint/component placement before routing.' })
  if (codes.has('POWER_ROUTE_WIDTH_LOW')) actions.push({ command: 'plan_power_tree', reason: 'Recalculate current budget and widen power routes or use pours.' })
  if (codes.has('SENSITIVE_ROUTE_HAS_VIA') || codes.has('SENSITIVE_LAYER_SWAP_REVIEW')) actions.push({ command: 'plan_stackup', reason: 'Review layer transitions, reference planes, and impedance before copper write.' })
  if (codes.has('DIFF_PAIR_LENGTH_MISMATCH')) actions.push({ command: 'route_diff_pair', reason: 'Regenerate matched pair routes with length target constraints.' })
  if (metrics.viaCount > metrics.routeCount * 2) actions.push({ command: 'plan_fanout', reason: 'Via count is high; review escape strategy and layer count.' })
  if (!actions.length) actions.push({ command: 'run_kicad_drc', reason: 'Routing quality is acceptable for review; KiCad DRC is still required.' })
  return actions
}

function estimatePathLength(points = []) {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  }
  return round(length)
}

function diffMate(net) {
  if (/_DP$/.test(net)) return net.replace(/_DP$/, '_DN')
  if (/_DN$/.test(net)) return net.replace(/_DN$/, '_DP')
  if (/_P$/.test(net)) return net.replace(/_P$/, '_N')
  if (/_N$/.test(net)) return net.replace(/_N$/, '_P')
  return null
}

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
