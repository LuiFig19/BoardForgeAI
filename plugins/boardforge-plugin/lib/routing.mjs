import { netClassProfiles } from './net-classes.mjs'
import { createDesignIntent, planViasForRoute } from './design-rules.mjs'

const routingOrder = ['BATTERY', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'CRYSTAL', 'CLOCK', 'SPI', 'I2C', 'UART', 'SENSOR', 'ANALOG', 'DEFAULT']

export function generateRoutingPlan(nets, options = {}) {
  const layerCount = options.layerCount || 2
  const board = options.board || { layerCount, outline: [] }
  const components = options.components || []
  const designIntent = createDesignIntent({ ...board, layerCount }, options.components || [], nets || [], options.profile || {})
  const classified = [...(nets || [])].sort((a, b) => (routingOrder.indexOf(a.className || 'DEFAULT') || 999) - (routingOrder.indexOf(b.className || 'DEFAULT') || 999))
  const routes = classified.map((net) => {
    const profile = netClassProfiles[net.className || 'DEFAULT'] || netClassProfiles.DEFAULT
    const canPlanOnly = ['GROUND'].includes(net.className) || Boolean(options.allowExperimentalRouting)
    const endpoints = inferEndpoints(net, components)
    const start = net.start || endpoints.start
    const end = net.end || endpoints.end
    const viaPlan = planViasForRoute({ net, start, end, board: { ...board, layerCount }, zones: designIntent.zones, profile: options.profile || {} })
    return {
      net: net.name,
      className: net.className || 'DEFAULT',
      start: start || null,
      end: end || null,
      endpointRefs: endpoints.refs,
      strategy: strategyForClass(net.className || 'DEFAULT', layerCount),
      widthMm: profile.traceWidthMm,
      clearanceMm: profile.clearanceMm,
      layerPreference: profile.layerPreference,
      viaPlan,
      status: canPlanOnly ? 'planned_zone_or_short_route' : 'planned_not_routed',
    }
  })
  return {
    status: 'PARTIAL_ROUTING_PLAN',
    routedNets: routes.filter((route) => route.status === 'routed').map((route) => route.net),
    partiallyRoutedNets: routes.filter((route) => route.status !== 'planned_not_routed').map((route) => route.net),
    unroutedNets: routes.filter((route) => route.status === 'planned_not_routed').map((route) => route.net),
    routes,
    designIntent,
    warnings: ['CLI MVP generates a routing/via/copper-pour plan only. It does not claim full autorouting.', 'Use KiCad interactive routing or a later BoardForge routing adapter for completed copper.', 'Sensitive antenna, thermal, and analog/IMU keepouts require human review before manufacturing.'],
  }
}

function inferEndpoints(net, components) {
  const refs = []
  for (const component of components) {
    const pins = component.pinMap || {}
    if (Object.values(pins).includes(net.name)) refs.push(component.ref)
  }
  const matched = components.filter((component) => refs.includes(component.ref))
  if (matched.length >= 2) return { start: pointForComponent(matched[0]), end: pointForComponent(matched[1]), refs }
  if (matched.length === 1) {
    const component = matched[0]
    return { start: pointForComponent(component), end: { x: (component.x || 0) + 8, y: component.y || 0 }, refs }
  }
  return { start: null, end: null, refs }
}

function pointForComponent(component) {
  return { x: component.x || 0, y: component.y || 0 }
}

function strategyForClass(className, layerCount) {
  if (className === 'GROUND') return layerCount >= 4 ? 'solid inner ground plane plus via stitching' : 'bottom ground pour plus stitching'
  if (className === 'USB_DIFF') return 'short same-layer differential pair, impedance reviewed in KiCad'
  if (className === 'ETHERNET_DIFF') return 'short matched differential pairs from RJ45/magnetics to PHY'
  if (className === 'CRYSTAL') return 'short direct same-layer routes with guard clearance'
  if (['BATTERY', 'POWER_HIGH_CURRENT', 'MOTOR_PHASE'].includes(className)) return 'wide short copper, thermal/current reviewed'
  return 'short signal route after critical nets'
}
