import { assignNetsToClasses } from './net-classes.mjs'
import { validatePlacement } from './validation.mjs'
import { validateNetClasses } from './net-classes.mjs'
import { validateRoutingGeometry } from './routing-validation.mjs'
import { scoreRoutingPlan } from './routing-quality.mjs'
import { generateRoutingPlan } from './routing.mjs'

export function checkRoutingReadiness({ board = {}, components = [], nets = [], routingPlan = null, profile = {}, stackup = null, schematicGraph = null, fanoutPlan = null, viaStrategy = null, powerRouting = null } = {}) {
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
  const denseGates = denseRoutingGates({ board, components, nets: classified, stackup, fanoutPlan, viaStrategy, powerRouting })
  const errors = [
    ...placementIssues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)),
    ...netIssues,
    ...geometry.errors,
    ...quality.errors,
    ...endpointsMissing,
    ...(schematicGraph?.errors || []),
    ...stackupErrors.filter((item) => item.severity === 'ERROR'),
    ...denseGates.errors,
  ]
  const warnings = [
    ...placementIssues.filter((item) => item.severity === 'WARNING'),
    ...geometry.warnings,
    ...quality.warnings,
    ...(schematicGraph?.warnings || []),
    ...stackupErrors.filter((item) => item.severity === 'WARNING'),
    ...denseGates.warnings,
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
      gate('stackup_strategy', !denseGates.gates.stackup.errors.length, denseGates.gates.stackup.errors, denseGates.gates.stackup.warnings),
      gate('fanout_strategy', !denseGates.gates.fanout.errors.length, denseGates.gates.fanout.errors, denseGates.gates.fanout.warnings),
      gate('via_strategy', !denseGates.gates.via.errors.length, denseGates.gates.via.errors, denseGates.gates.via.warnings),
      gate('power_routing', !denseGates.gates.power.errors.length, denseGates.gates.power.errors, denseGates.gates.power.warnings),
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

function denseRoutingGates({ board, components, nets, stackup, fanoutPlan, viaStrategy, powerRouting }) {
  const boardArea = boardAreaMm2(board)
  const componentDensity = components.length / Math.max(1, boardArea)
  const hasDensePackage = components.some((component) => /(BGA|QFN|QFP|WLCSP|ESP32|MODULE|FPGA|ASIC)/i.test(`${component.package || ''} ${component.footprint || ''} ${component.group || ''} ${component.value || ''}`))
  const highSpeed = nets.some((net) => /USB_DIFF|ETHERNET_DIFF|MIPI_DIFF|PCIe_DIFF|LVDS_DIFF|CLOCK|CRYSTAL/i.test(net.className || net.name))
  const highLayer = (board.layerCount || stackup?.layerCount || 2) >= 6
  const denseRequired = Boolean(highLayer || hasDensePackage || highSpeed || componentDensity > 0.01)
  const gates = {
    stackup: { errors: [], warnings: [] },
    fanout: { errors: [], warnings: [] },
    via: { errors: [], warnings: [] },
    power: { errors: [], warnings: [] },
  }
  if (!denseRequired) return { denseRequired, errors: [], warnings: [], gates }
  if (!stackup?.layers?.length && !stackup?.layerRoles) gates.stackup.errors.push(issue('ERROR', 'STACKUP_PLAN_REQUIRED', 'Dense/high-speed routing requires a BoardForge stackup plan before autorouting.'))
  if (!fanoutPlan?.denseComponents && !fanoutPlan?.escapes && !fanoutPlan?.fanouts) gates.fanout.errors.push(issue('ERROR', 'FANOUT_PLAN_REQUIRED', 'Dense packages need a fanout/escape plan before route writing.'))
  if (!viaStrategy?.allowedTransitions && !viaStrategy?.policies && !viaStrategy?.strategy) gates.via.errors.push(issue('ERROR', 'VIA_STRATEGY_REQUIRED', 'Routing readiness needs blind/buried/through via rules before layer switching.'))
  const powerNets = nets.filter((net) => /BATTERY|POWER|HIGH_CURRENT|HIGH_VOLTAGE|SWITCHING|GROUND|DEFAULT/i.test(net.className || '') && /GND|3V3|5V|VIN|VBAT|VUSB|POE|SW/i.test(net.name || ''))
  if (powerNets.length && !powerRouting?.calculations?.length && !powerRouting?.rails?.length) gates.power.warnings.push(issue('WARNING', 'POWER_ROUTING_PLAN_REVIEW', 'Power/ground nets exist without a current/width/copper-pour routing plan.'))
  const errors = Object.values(gates).flatMap((gate) => gate.errors)
  const warnings = Object.values(gates).flatMap((gate) => gate.warnings)
  return { denseRequired, errors, warnings, gates }
}

function boardAreaMm2(board) {
  const outline = board.outline || []
  if (outline.length < 3) return Number(board.widthMm || board.width || 1) * Number(board.heightMm || board.height || 1)
  let sum = 0
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index]
    const b = outline[(index + 1) % outline.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.max(1, Math.abs(sum) / 2)
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
