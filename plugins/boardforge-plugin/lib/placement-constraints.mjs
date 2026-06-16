import { distance, polygonBounds, round } from './geometry.mjs'

export function compilePlacementConstraints(board = {}, components = [], input = {}) {
  const bounds = board.outline?.length ? polygonBounds(board.outline) : { minX: 0, minY: 0, maxX: board.widthMm || 50, maxY: board.heightMm || 30 }
  const rules = [
    ...edgeConnectorRules(bounds, components),
    ...decouplingRules(components),
    ...thermalSeparationRules(components),
    ...rfAntennaRules(bounds, components),
    ...serviceAccessRules(bounds, components),
    ...sideRules(components, input),
  ]
  const violations = rules.filter((rule) => rule.status === 'violated')
  const warnings = rules.filter((rule) => rule.status === 'review')
  return {
    status: violations.length ? 'PLACEMENT_CONSTRAINTS_NEED_FIX' : warnings.length ? 'PLACEMENT_CONSTRAINTS_NEED_REVIEW' : 'PLACEMENT_CONSTRAINTS_READY',
    rules,
    violations,
    warnings,
    summary: {
      totalRules: rules.length,
      violated: violations.length,
      review: warnings.length,
      edgeConnectors: rules.filter((rule) => rule.kind === 'edge_connector').length,
      thermal: rules.filter((rule) => rule.kind === 'thermal_separation').length,
      rf: rules.filter((rule) => rule.kind === 'rf_antenna').length,
    },
    humanReviewRequired: true,
  }
}

function edgeConnectorRules(bounds, components) {
  return components.filter((component) => /^(USB|RJ45|POWER_INPUT|SENSOR_CONNECTOR|ESC_CONNECTOR|SWD)$/i.test(component.group || '')).map((component) => {
    const nearest = nearestEdgeDistance(bounds, component)
    const maxDistance = ['USB', 'RJ45', 'POWER_INPUT'].includes(component.group) ? 3 : 7
    return {
      kind: 'edge_connector',
      ref: component.ref,
      group: component.group,
      requirement: `nearest edge <= ${maxDistance} mm`,
      measuredMm: round(nearest.distance),
      preferredEdge: nearest.edge,
      status: nearest.distance <= maxDistance ? 'satisfied' : 'violated',
      reason: 'Cable, programming, and assembly connectors need physical access from an edge.',
    }
  })
}

function decouplingRules(components) {
  const active = components.filter((component) => !['CAP', 'RES', 'INDUCTOR'].includes(component.group))
  return components.filter((component) => component.group === 'CAP').map((cap) => {
    const nearest = nearestComponent(cap, active)
    const maxDistance = /bulk|10u|22u|47u/i.test(cap.value || '') ? 10 : 5
    return {
      kind: 'decoupling',
      ref: cap.ref,
      nearRef: nearest?.ref || null,
      requirement: `capacitor near related IC within ${maxDistance} mm`,
      measuredMm: nearest ? round(distance(cap, nearest)) : null,
      status: nearest && distance(cap, nearest) <= maxDistance ? 'satisfied' : 'review',
      reason: 'Decoupling loops must stay short for power integrity.',
    }
  })
}

function thermalSeparationRules(components) {
  const hot = components.filter((component) => /(REGULATOR|MOSFET|POE|MOTOR|SHUNT|CHARGER|GATE)/i.test(`${component.group || ''} ${component.value || ''}`))
  const sensitive = components.filter((component) => /(IMU|BARO|SENSOR|RF|ESP32|CRYSTAL|OSC|ADC)/i.test(`${component.group || ''} ${component.value || ''}`))
  return hot.flatMap((source) => sensitive.filter((target) => target.ref !== source.ref).map((target) => {
    const measured = distance(source, target)
    return {
      kind: 'thermal_separation',
      ref: source.ref,
      targetRef: target.ref,
      requirement: 'heat source separated from sensitive/RF/sensor part by >= 8 mm',
      measuredMm: round(measured),
      status: measured >= 8 ? 'satisfied' : 'violated',
      reason: 'Thermal drift and RF detuning can break otherwise valid electrical designs.',
    }
  }))
}

function rfAntennaRules(bounds, components) {
  return components.filter((component) => /(ESP32|RF|ANT|WROOM|BLE|WIFI|WI-FI)/i.test(`${component.group || ''} ${component.value || ''}`)).map((component) => {
    const nearest = nearestEdgeDistance(bounds, component)
    return {
      kind: 'rf_antenna',
      ref: component.ref,
      requirement: 'RF module or antenna region close to board edge with copper/component keepout',
      measuredMm: round(nearest.distance),
      preferredEdge: nearest.edge,
      status: nearest.distance <= 8 ? 'review' : 'violated',
      reason: 'Antenna region must not be buried in the middle of copper/components.',
    }
  })
}

function serviceAccessRules(bounds, components) {
  return components.filter((component) => /(SWD|BOOT|RESET|TEST|PAD|USB)/i.test(`${component.group || ''} ${component.value || ''}`)).map((component) => {
    const nearest = nearestEdgeDistance(bounds, component)
    return {
      kind: 'service_access',
      ref: component.ref,
      requirement: 'debug/test/service part remains reachable',
      measuredMm: round(nearest.distance),
      preferredEdge: nearest.edge,
      status: nearest.distance <= 15 ? 'satisfied' : 'review',
      reason: 'Programming, test, and debug access should survive enclosure and fixture design.',
    }
  })
}

function sideRules(components, input) {
  const singleSided = (input.assemblyMode || input.assemblyTarget || 'single_sided_preferred') === 'single_sided_preferred'
  return components.filter((component) => component.side === 'B.Cu' || component.side === 'bottom').map((component) => ({
    kind: 'assembly_side',
    ref: component.ref,
    requirement: 'single-sided assembly preferred unless explicitly allowed',
    status: singleSided ? 'review' : 'satisfied',
    reason: 'Bottom-side assembly increases cost and process risk.',
  }))
}

function nearestComponent(component, candidates) {
  return candidates.filter((candidate) => candidate.ref !== component.ref).sort((a, b) => distance(component, a) - distance(component, b))[0] || null
}

function nearestEdgeDistance(bounds, component) {
  const distances = [
    { edge: 'left', distance: Math.abs((component.x || 0) - bounds.minX) },
    { edge: 'right', distance: Math.abs(bounds.maxX - (component.x || 0)) },
    { edge: 'top', distance: Math.abs((component.y || 0) - bounds.minY) },
    { edge: 'bottom', distance: Math.abs(bounds.maxY - (component.y || 0)) },
  ]
  return distances.sort((a, b) => a.distance - b.distance)[0]
}
