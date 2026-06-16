import { assignNetsToClasses } from './net-classes.mjs'

const highSpeedClasses = new Set(['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RF', 'CRYSTAL', 'CLOCK'])

export function planSignalIntegrity({ board = {}, components = [], nets = [], stackup = null, routingPlan = null, profile = {}, input = {} } = {}) {
  const classified = assignNetsToClasses(nets)
  const constraints = []
  for (const net of classified) constraints.push(...constraintsForNet(net, { stackup, routingPlan, components, input }))
  constraints.push(...constraintsFromComponents(components))
  const errors = constraints.filter((item) => item.severity === 'ERROR')
  const warnings = constraints.filter((item) => item.severity === 'WARNING')
  const highSpeedNets = classified.filter((net) => highSpeedClasses.has(net.className))
  const referencePlane = findReferencePlane(stackup)
  const impedance = impedancePlan(highSpeedNets, stackup, referencePlane)
  const lengthMatching = lengthMatchingPlan(highSpeedNets, routingPlan)
  const returnPath = returnPathPlan(highSpeedNets, stackup, routingPlan)
  const terminations = terminationPlan(classified, components)
  const actions = recommendedActions({ constraints, highSpeedNets, stackup, routingPlan })
  const status = errors.length ? 'SIGNAL_INTEGRITY_BLOCKED' : warnings.length || highSpeedNets.length ? 'SIGNAL_INTEGRITY_NEEDS_REVIEW' : 'SIGNAL_INTEGRITY_READY'
  return {
    status,
    board: {
      layerCount: board.layerCount || stackup?.layerCount || input.layerCount || 2,
      widthMm: board.widthMm || input.widthMm || null,
      heightMm: board.heightMm || input.heightMm || null,
    },
    highSpeedNetCount: highSpeedNets.length,
    highSpeedNets,
    impedance,
    lengthMatching,
    returnPath,
    terminations,
    constraints,
    warnings,
    errors,
    actions,
    gates: {
      requireContinuousReferencePlane: highSpeedNets.some((net) => ['USB_DIFF', 'ETHERNET_DIFF', 'RF', 'CRYSTAL', 'CLOCK'].includes(net.className)),
      requireLengthReview: lengthMatching.pairs.length > 0,
      requireNoSplitPlanesUnderPairs: highSpeedNets.some((net) => ['USB_DIFF', 'ETHERNET_DIFF', 'RF'].includes(net.className)),
      requireDrcAfterRouting: true,
      requireHumanSIReview: highSpeedNets.length > 0,
    },
    manufacturer: {
      id: profile.id,
      name: profile.name,
      minTraceWidthMm: profile.minTraceWidthMm,
      minClearanceMm: profile.minClearanceMm,
    },
    humanReviewRequired: true,
  }
}

function constraintsForNet(net, context) {
  const items = []
  const route = context.routingPlan?.routes?.find((item) => item.net === net.name)
  const className = net.className || 'DEFAULT'
  if (className === 'USB_DIFF') {
    items.push(rule('WARNING', 'USB_IMPEDANCE_REVIEW', `${net.name} needs 90 ohm differential impedance intent and same-layer routing.`, net.name, { targetOhms: 90, preferredLayer: 'F.Cu' }))
    if (route?.viaPlan?.candidates?.length) items.push(rule('WARNING', 'USB_VIA_REVIEW', `${net.name} uses vias; matched pair vias and return stitching are required.`, net.name))
  }
  if (className === 'ETHERNET_DIFF') {
    items.push(rule('WARNING', 'ETHERNET_IMPEDANCE_REVIEW', `${net.name} needs 100 ohm differential impedance and transformer/PHY length review.`, net.name, { targetOhms: 100 }))
  }
  if (className === 'CAN_DIFF') {
    items.push(rule('WARNING', 'CAN_TERMINATION_REVIEW', `${net.name} needs bus topology and 120 ohm termination review.`, net.name))
  }
  if (className === 'RF') {
    items.push(rule('ERROR', 'RF_REQUIRES_EXPLICIT_STACKUP', `${net.name} needs explicit 50 ohm stackup and antenna keepout before routing.`, net.name, { targetOhms: 50 }))
  }
  if (['CRYSTAL', 'CLOCK'].includes(className)) {
    items.push(rule('WARNING', 'CLOCK_ROUTE_SHORT_DIRECT', `${net.name} must stay short, same-layer, away from switching power and board edges.`, net.name, { maxLengthMm: className === 'CRYSTAL' ? 15 : 35 }))
  }
  if (highSpeedClasses.has(className) && !findReferencePlane(context.stackup)) {
    items.push(rule('ERROR', 'NO_CONTINUOUS_REFERENCE_PLANE', `${net.name} has no continuous reference plane in the stackup plan.`, net.name))
  }
  if (route && route.estimatedLengthMm > maxLengthFor(className)) {
    items.push(rule('WARNING', 'SI_ROUTE_TOO_LONG', `${net.name} route length exceeds the default signal-integrity budget.`, net.name, { lengthMm: route.estimatedLengthMm, maxLengthMm: maxLengthFor(className) }))
  }
  return items
}

function constraintsFromComponents(components) {
  const items = []
  const rf = components.filter((component) => /(ESP32|WROOM|RF|ANT|WIFI|WI-FI|BLE)/i.test(`${component.group || ''} ${component.value || ''}`))
  const hot = components.filter((component) => /(REGULATOR|BUCK|BOOST|MOSFET|POE|MOTOR|SHUNT|CHARGER|GATE)/i.test(`${component.group || ''} ${component.value || ''}`))
  const crystals = components.filter((component) => /(XTAL|CRYSTAL|OSC)/i.test(`${component.group || ''} ${component.value || ''}`))
  for (const component of rf) items.push(rule('WARNING', 'RF_COMPONENT_KEEP_OUT_REQUIRED', `${component.ref} needs antenna copper/component keepout and edge exposure review.`, component.ref))
  for (const component of hot) items.push(rule('WARNING', 'HOT_COMPONENT_NOISE_COUPLING_REVIEW', `${component.ref} is a hot/noisy component; keep away from RF, crystal, analog, and sensor regions.`, component.ref))
  for (const component of crystals) items.push(rule('WARNING', 'CRYSTAL_PLACEMENT_REVIEW', `${component.ref} should sit close to its IC pins with guard clearance and no noisy copper below.`, component.ref))
  return items
}

function impedancePlan(highSpeedNets, stackup, referencePlane) {
  return highSpeedNets.map((net) => {
    const targetOhms = net.className === 'USB_DIFF' ? 90 : net.className === 'ETHERNET_DIFF' ? 100 : net.className === 'RF' ? 50 : null
    return {
      net: net.name,
      className: net.className,
      targetOhms,
      preferredLayer: 'F.Cu',
      referenceLayer: referencePlane,
      stackupStatus: stackup?.status || 'missing_stackup_plan',
      rule: targetOhms ? 'controlled impedance needs fab stackup calculator/review' : 'short same-layer route with clean return path',
    }
  })
}

function lengthMatchingPlan(highSpeedNets, routingPlan) {
  const routes = routingPlan?.routes || []
  const pairs = []
  const names = new Set(highSpeedNets.map((net) => net.name))
  for (const net of highSpeedNets) {
    const mate = diffMate(net.name)
    if (!mate || !names.has(mate) || net.name > mate) continue
    const a = routes.find((route) => route.net === net.name)
    const b = routes.find((route) => route.net === mate)
    const deltaMm = a && b ? Math.abs((a.estimatedLengthMm || 0) - (b.estimatedLengthMm || 0)) : null
    pairs.push({
      positive: net.name,
      negative: mate,
      className: net.className,
      targetMismatchMm: net.className === 'USB_DIFF' ? 0.5 : net.className === 'ETHERNET_DIFF' ? 1 : 2,
      measuredMismatchMm: deltaMm === null ? null : round(deltaMm),
      status: deltaMm === null ? 'needs_route_lengths' : deltaMm <= (net.className === 'USB_DIFF' ? 0.5 : net.className === 'ETHERNET_DIFF' ? 1 : 2) ? 'matched_candidate' : 'mismatch_review_required',
    })
  }
  return { pairs }
}

function returnPathPlan(highSpeedNets, stackup, routingPlan) {
  const routes = routingPlan?.routes || []
  return highSpeedNets.map((net) => {
    const route = routes.find((item) => item.net === net.name)
    return {
      net: net.name,
      referencePlane: findReferencePlane(stackup),
      avoidSplitPlanes: ['USB_DIFF', 'ETHERNET_DIFF', 'RF', 'CRYSTAL', 'CLOCK'].includes(net.className),
      viaTransitions: route?.viaPlan?.candidates?.length || 0,
      stitchingRequired: Boolean(route?.viaPlan?.candidates?.length),
      rule: route?.viaPlan?.candidates?.length ? 'place ground stitching vias adjacent to layer transition and preserve pair symmetry' : 'keep route over continuous reference copper',
    }
  })
}

function terminationPlan(nets, components) {
  const text = JSON.stringify({ nets, components }).toLowerCase()
  const items = []
  if (/usb/.test(text)) items.push({ interface: 'USB', required: ['ESD near connector', 'series/common-mode parts only if specified by reference design', 'controlled pair from connector to PHY/MCU'] })
  if (/ethernet|rj45|phy/.test(text)) items.push({ interface: 'Ethernet', required: ['magnetics orientation review', 'PHY-to-magnetics pair matching', 'Bob Smith/chassis strategy review if used'] })
  if (/can/.test(text)) items.push({ interface: 'CAN', required: ['120 ohm termination policy', 'TVS near connector', 'stub length review'] })
  if (/crystal|xtal|osc/.test(text)) items.push({ interface: 'Crystal/Clock', required: ['load capacitors close to crystal', 'short symmetric traces', 'guard clearance from switching nodes'] })
  return items
}

function recommendedActions({ constraints, highSpeedNets, stackup, routingPlan }) {
  const codes = new Set(constraints.map((item) => item.code))
  const actions = []
  if (!stackup || codes.has('NO_CONTINUOUS_REFERENCE_PLANE') || codes.has('RF_REQUIRES_EXPLICIT_STACKUP')) actions.push({ command: 'plan_stackup', reason: 'Signal integrity constraints need a reviewed layer/reference-plane plan.' })
  if (highSpeedNets.length && !routingPlan) actions.push({ command: 'generate_routing_plan', reason: 'Create route candidates so length matching and via transitions can be scored.' })
  if (codes.has('USB_VIA_REVIEW') || codes.has('SI_ROUTE_TOO_LONG')) actions.push({ command: 'score_routing_quality', reason: 'Review via count, layer swaps, and route length before copper write.' })
  if (codes.has('RF_COMPONENT_KEEP_OUT_REQUIRED') || codes.has('HOT_COMPONENT_NOISE_COUPLING_REVIEW')) actions.push({ command: 'generate_design_constraints', reason: 'Persist keepout, thermal, and noise-coupling constraints for placement/routing.' })
  if (!actions.length) actions.push({ command: 'run_dfm_checks', reason: 'SI plan is ready for manufacturing/design-rule cross-check.' })
  return actions
}

function findReferencePlane(stackup) {
  return stackup?.layers?.find((layer) => /ground|return_reference/i.test(layer.role || ''))?.name || null
}

function maxLengthFor(className) {
  if (className === 'CRYSTAL') return 15
  if (className === 'CLOCK') return 35
  if (className === 'RF') return 25
  if (className === 'USB_DIFF') return 40
  if (className === 'ETHERNET_DIFF') return 55
  if (className === 'CAN_DIFF') return 80
  return 140
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

function rule(severity, code, message, target, details = {}) {
  return { severity, code, message, target, details }
}
