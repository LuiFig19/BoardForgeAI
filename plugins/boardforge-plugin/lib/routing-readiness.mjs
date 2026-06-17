import { assignNetsToClasses } from './net-classes.mjs'
import { validatePlacement } from './validation.mjs'
import { validateNetClasses } from './net-classes.mjs'
import { validateRoutingGeometry } from './routing-validation.mjs'
import { scoreRoutingPlan } from './routing-quality.mjs'
import { generateRoutingPlan } from './routing.mjs'

export function checkRoutingReadiness({ board = {}, components = [], nets = [], routingPlan = null, profile = {}, stackup = null, schematicGraph = null } = {}) {
  const classified = assignNetsToClasses(nets || [])
  const plan = routingPlan || generateRoutingPlan(classified, { board, components, profile, layerCount: board.layerCount || stackup?.layerCount || 2 })
  const placementIssues = validatePlacement(board, components, profile)
  const netIssues = validateNetClasses(classified)
  const geometry = validateRoutingGeometry({ board, components, routingPlan: plan, profile })
  const quality = scoreRoutingPlan({ routingPlan: plan, profile })
  const endpointsMissing = plan.routes
    .filter((route) => route.className !== 'GROUND' && (!route.start || !route.end || criticalRoute(route) && (route.endpointRefs?.length || 0) < 2))
    .map((route) => issue('ERROR', 'ROUTE_ENDPOINTS_MISSING', `${route.net} has no complete real source/destination endpoints.`, { net: route.net, className: route.className, endpointRefs: route.endpointRefs || [] }))
  const stackupErrors = []
  if (!board.outline?.length) stackupErrors.push(issue('ERROR', 'BOARD_OUTLINE_REQUIRED_FOR_ROUTING', 'Routing cannot start without a valid board outline.'))
  if ((board.layerCount || stackup?.layerCount || 2) < 4 && classified.some((net) => /USB_DIFF|ETHERNET_DIFF|MIPI_DIFF|PCIe_DIFF|LVDS_DIFF/.test(net.className))) stackupErrors.push(issue('WARNING', 'HIGH_SPEED_ON_LOW_LAYER_COUNT', 'High-speed routes on fewer than 4 layers need strict return-path review.'))
  const errors = [
    ...placementIssues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)),
    ...netIssues,
    ...geometry.errors,
    ...quality.errors,
    ...endpointsMissing,
    ...(schematicGraph?.errors || []),
    ...stackupErrors.filter((item) => item.severity === 'ERROR'),
  ]
  const warnings = [
    ...placementIssues.filter((item) => item.severity === 'WARNING'),
    ...geometry.warnings,
    ...quality.warnings,
    ...(schematicGraph?.warnings || []),
    ...stackupErrors.filter((item) => item.severity === 'WARNING'),
  ]
  return {
    schemaVersion: 1,
    status: errors.length ? 'ROUTING_READINESS_BLOCKED' : warnings.length ? 'ROUTING_READINESS_NEEDS_REVIEW' : 'ROUTING_READINESS_READY',
    gates: [
      gate('board_outline', Boolean(board.outline?.length), stackupErrors.filter((item) => item.code === 'BOARD_OUTLINE_REQUIRED_FOR_ROUTING'), []),
      gate('placement', !placementIssues.some((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), placementIssues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), placementIssues.filter((item) => item.severity === 'WARNING')),
      gate('net_classes', !netIssues.length, netIssues, []),
      gate('route_geometry', !geometry.errors.length, geometry.errors, geometry.warnings),
      gate('routing_quality', !quality.errors.length, quality.errors, quality.warnings),
      gate('schematic_graph', !schematicGraph?.errors?.length, schematicGraph?.errors || [], schematicGraph?.warnings || []),
    ],
    routingPlan: plan,
    routeValidation: geometry,
    routeQuality: quality,
    warnings,
    errors,
    nextActions: errors.length ? ['Do not route yet. Fix failed gates, then rerun check_routing_readiness.'] : ['Routing can proceed with human review; run autoroute_board or generate_routing_plan next.'],
    humanReviewRequired: true,
  }
}

function gate(name, passed, errors = [], warnings = []) {
  return { name, passed: Boolean(passed), status: errors.length ? 'blocked' : warnings.length || !passed ? 'review' : 'passed', errors, warnings }
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}

function criticalRoute(route) {
  return ['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RS485_DIFF', 'LVDS_DIFF', 'MIPI_DIFF', 'PCIe_DIFF', 'CRYSTAL', 'CLOCK', 'BATTERY', 'MOTOR_PHASE', 'POWER_HIGH_CURRENT', 'HIGH_VOLTAGE', 'SWITCHING_NODE'].includes(route.className)
}
