import { netClassProfiles } from './net-classes.mjs'

const routingOrder = ['BATTERY', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'CRYSTAL', 'CLOCK', 'SPI', 'I2C', 'UART', 'SENSOR', 'ANALOG', 'DEFAULT']

export function generateRoutingPlan(nets, options = {}) {
  const layerCount = options.layerCount || 2
  const classified = [...(nets || [])].sort((a, b) => (routingOrder.indexOf(a.className || 'DEFAULT') || 999) - (routingOrder.indexOf(b.className || 'DEFAULT') || 999))
  const routes = classified.map((net) => {
    const profile = netClassProfiles[net.className || 'DEFAULT'] || netClassProfiles.DEFAULT
    const canPlanOnly = ['GROUND'].includes(net.className) || Boolean(options.allowExperimentalRouting)
    return { net: net.name, className: net.className || 'DEFAULT', strategy: strategyForClass(net.className || 'DEFAULT', layerCount), widthMm: profile.traceWidthMm, clearanceMm: profile.clearanceMm, status: canPlanOnly ? 'planned_zone_or_short_route' : 'planned_not_routed' }
  })
  return {
    status: 'PARTIAL_ROUTING_PLAN',
    routedNets: routes.filter((route) => route.status === 'routed').map((route) => route.net),
    partiallyRoutedNets: routes.filter((route) => route.status !== 'planned_not_routed').map((route) => route.net),
    unroutedNets: routes.filter((route) => route.status === 'planned_not_routed').map((route) => route.net),
    routes,
    warnings: ['CLI MVP generates a routing plan and ground strategy only. It does not claim full autorouting.', 'Use KiCad interactive routing or a later BoardForge routing adapter for completed copper.'],
  }
}

function strategyForClass(className, layerCount) {
  if (className === 'GROUND') return layerCount >= 4 ? 'solid inner ground plane plus via stitching' : 'bottom ground pour plus stitching'
  if (className === 'USB_DIFF') return 'short same-layer differential pair, impedance reviewed in KiCad'
  if (className === 'ETHERNET_DIFF') return 'short matched differential pairs from RJ45/magnetics to PHY'
  if (className === 'CRYSTAL') return 'short direct same-layer routes with guard clearance'
  if (['BATTERY', 'POWER_HIGH_CURRENT', 'MOTOR_PHASE'].includes(className)) return 'wide short copper, thermal/current reviewed'
  return 'short signal route after critical nets'
}
