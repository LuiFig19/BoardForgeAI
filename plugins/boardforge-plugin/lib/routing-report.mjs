import { assignNetsToClasses } from './net-classes.mjs'
import { validateRoutingGeometry } from './routing-validation.mjs'
import { scoreRoutingPlan } from './routing-quality.mjs'
import { generateRoutingPlan } from './routing.mjs'

export function buildRoutingReport(input = {}) {
  const board = input.board || { layerCount: input.layerCount || 2, outline: [] }
  const profile = input.profile || {}
  const components = input.components || []
  const nets = assignNetsToClasses(input.nets || [])
  const routingPlan = input.routingPlan || generateRoutingPlan(nets, { ...input, board, components, profile })
  const routeValidation = input.routeValidation || validateRoutingGeometry({ board, components, routingPlan, profile })
  const routeQuality = input.routeQuality || scoreRoutingPlan({ routingPlan, profile, powerTree: input.powerTree || null })
  const routes = routingPlan.routes || []
  const routed = routes.filter((route) => route.status === 'routed')
  const partial = routes.filter((route) => route.status !== 'routed' && route.status !== 'planned_not_routed')
  const unrouted = routes.filter((route) => route.status === 'planned_not_routed')
  const criticalClasses = new Set(['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RS485_DIFF', 'LVDS_DIFF', 'MIPI_DIFF', 'PCIe_DIFF', 'CRYSTAL', 'CLOCK', 'BATTERY', 'MOTOR_PHASE', 'POWER_HIGH_CURRENT', 'HIGH_VOLTAGE', 'SWITCHING_NODE'])
  const critical = routes.filter((route) => criticalClasses.has(route.className))
  const unresolvedCritical = critical.filter((route) => route.status !== 'routed')
  const diffPairs = summarizeDiffPairs(routes)
  const power = routes.filter((route) => ['BATTERY', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'MOTOR_PHASE', 'HIGH_VOLTAGE', 'SWITCHING_NODE'].includes(route.className))
  const blockers = [
    ...(routeValidation.errors || []),
    ...(routeQuality.errors || []),
    ...unresolvedCritical.map((route) => issue('ERROR', 'CRITICAL_NET_UNROUTED_OR_MISSING_ENDPOINT', `${route.net} is critical but has no routable endpoints.`, { net: route.net, className: route.className })),
  ]
  const warnings = [
    ...(routingPlan.warnings || []).map((message) => typeof message === 'string' ? issue('WARNING', 'ROUTING_PLAN_WARNING', message) : message),
    ...(routeValidation.warnings || []),
    ...(routeQuality.warnings || []),
  ]
  const totalNets = routes.length
  const routedPercent = totalNets ? Math.round((routed.length / totalNets) * 100) : 0
  const status = blockers.length
    ? 'ROUTING_REPORT_NEEDS_FIX'
    : unrouted.length
      ? 'ROUTING_REPORT_PARTIAL_NEEDS_REVIEW'
      : 'ROUTING_REPORT_READY_NEEDS_DRC'
  return {
    status,
    summary: {
      totalNets,
      routedNets: routed.length,
      partiallyRoutedNets: partial.length,
      unroutedNets: unrouted.length,
      routedPercent,
      criticalNetCount: critical.length,
      criticalUnresolvedCount: unresolvedCritical.length,
      viaCount: routes.reduce((sum, route) => sum + (route.viaPlan?.candidates?.length || 0), 0),
      copperPourCount: routingPlan.designIntent?.copperPours?.length || 0,
      qualityScore: routeQuality.score ?? null,
    },
    routedNets: routed.map(routeSummary),
    partiallyRoutedNets: partial.map(routeSummary),
    unroutedNets: unrouted.map(routeSummary),
    criticalNets: critical.map(routeSummary),
    differentialPairs: diffPairs,
    powerNets: power.map(routeSummary),
    groundStrategy: groundStrategy(routingPlan),
    routeValidation,
    routeQuality,
    blockers,
    warnings,
    nextActions: nextActions({ blockers, unrouted, unresolvedCritical, diffPairs, routeQuality }),
    humanReviewChecklist: [
      'Run KiCad DRC after applying copper.',
      'Inspect differential-pair, power, switching-node, and analog routes in KiCad.',
      'Confirm manufacturer stackup and via features before export.',
      'Do not export Gerbers/JLCPCB package until ERC, DRC, BOM, CPL, and manufacturing manifest gates pass.',
    ],
    humanReviewRequired: true,
  }
}

function summarizeDiffPairs(routes) {
  const pairs = []
  const byBase = new Map()
  for (const route of routes.filter((item) => /_P$|_N$|DP$|DN$|\+$|-$/i.test(item.net) || /DIFF/.test(item.className || ''))) {
    const base = route.net.replace(/(_P|_N|_DP|_DN|DP|DN|\+|-)$/i, '')
    const entry = byBase.get(base) || []
    entry.push(route)
    byBase.set(base, entry)
  }
  for (const [base, members] of byBase.entries()) {
    const lengths = members.map((route) => Number(route.estimatedLengthMm || 0))
    const skewMm = lengths.length >= 2 ? Number((Math.max(...lengths) - Math.min(...lengths)).toFixed(3)) : null
    pairs.push({
      base,
      members: members.map((route) => route.net),
      className: members[0]?.className || 'DEFAULT',
      status: members.length >= 2 ? 'PAIR_IDENTIFIED_NEEDS_REVIEW' : 'PAIR_INCOMPLETE',
      skewMm,
      note: skewMm === null ? 'Missing pair member.' : 'Length is estimated from planned waypoints, not controlled impedance verification.',
    })
  }
  return pairs
}

function routeSummary(route) {
  return {
    net: route.net,
    className: route.className,
    status: route.status,
    widthMm: route.widthMm,
    clearanceMm: route.clearanceMm,
    layerPreference: route.layerPreference,
    estimatedLengthMm: route.estimatedLengthMm || 0,
    endpointRefs: route.endpointRefs || [],
    viaCount: route.viaPlan?.candidates?.length || 0,
    strategy: route.strategy,
  }
}

function groundStrategy(routingPlan) {
  const pours = routingPlan.designIntent?.copperPours || []
  return {
    groundPours: pours.filter((pour) => pour.net === 'GND').length,
    notes: pours.some((pour) => pour.net === 'GND')
      ? ['Ground copper is planned. DRC must confirm connectivity and orphan copper status.']
      : ['No GND copper pour found. Add ground zone before manufacturing review.'],
  }
}

function nextActions({ blockers, unrouted, unresolvedCritical, diffPairs, routeQuality }) {
  if (blockers.length) {
    return [
      'Fix route geometry/quality blockers before writing or exporting copper.',
      ...(unresolvedCritical.length ? [`Add placement/endpoints for critical nets: ${unresolvedCritical.map((route) => route.net).join(', ')}.`] : []),
      ...(routeQuality.actions || []).map((action) => action.command ? `Run ${action.command}.` : String(action)).slice(0, 4),
    ]
  }
  if (unrouted.length) return [`Route remaining nets: ${unrouted.map((route) => route.net).slice(0, 8).join(', ')}.`, 'Run validate_routes and then run_kicad_drc after applying copper.']
  if (diffPairs.some((pair) => pair.status === 'PAIR_INCOMPLETE')) return ['Complete differential pair members before DRC/export.']
  return ['Apply routing plan if not already written, run KiCad DRC, then generate manufacturing manifest.']
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
