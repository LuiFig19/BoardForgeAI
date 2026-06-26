import { round } from './geometry.mjs'

export const escLayerPolicy = {
  'F.Cu': 'components_short_critical_gate_drive',
  'In1.Cu': 'gnd_pgnd_reference',
  'In2.Cu': 'vbat_high_current_power_support',
  'In3.Cu': 'signal_control',
  'In4.Cu': 'regulated_rails',
  'In5.Cu': 'protected_current_sense_control',
  'In6.Cu': 'gnd_return_shield',
  'B.Cu': 'support_secondary_power_low_speed',
}

export function classifyEscRouteNet(netName = '', route = {}) {
  const name = String(netName || route.net || '').replace(/^\//, '').toUpperCase()
  const className = String(route.className || '').toUpperCase()
  if (/^(PGND|POWER_GND)$/.test(name)) return 'PGND'
  if (/^(GND|AGND|DGND)$/.test(name)) return 'GND'
  if (/VBAT|VIN|BATT|BATTERY/.test(name)) return 'HIGH_CURRENT_POWER'
  if (/(_SW|PHASE|MOTOR|SWITCH)/.test(name) || /MOTOR_PHASE|SWITCHING_NODE/.test(className)) return 'MOTOR_PHASE'
  if (/(^|_)VDD$|VDD_|VREG12|VREG5|VREG3V3|3V3|5V|12V|VDDA/.test(name)) return 'REGULATED_RAIL'
  if (/BOOT|BST/.test(name)) return 'BOOTSTRAP'
  if (/GATE|_HG|_LG|HIN|LIN|RON/.test(name) || /GATE_DRIVE/.test(className)) return 'GATE_DRIVE'
  if (/SHUNT|SENSE|CS_|CURRENT/.test(name) || /KELVIN|CURRENT_SENSE/.test(className)) return 'CURRENT_SENSE_KELVIN'
  if (/VREF|REF/.test(name)) return 'CURRENT_SENSE_REFERENCE'
  if (/I2C|SCL|SDA/.test(name)) return 'I2C'
  if (/SPI|MISO|MOSI|SCK|CS/.test(name)) return 'SPI'
  if (/UART|TX|RX|TELEM/.test(name)) return 'UART'
  if (/SWD|NRST|DEBUG|BOOT_SEL/.test(name)) return 'SWD_DEBUG'
  if (/HSE|OSC|CLK|XTAL|RF/.test(name)) return 'RF_OR_CLOCK'
  if (/ADC|ANALOG|TEMP|NTC/.test(name)) return 'ANALOG_SENSE'
  if (/NC|NO_CONNECT/.test(name)) return 'MECHANICAL_NO_CONNECT'
  return 'LOW_SPEED_SIGNAL'
}

export function escRoutingLayerPreference(netType = 'LOW_SPEED_SIGNAL') {
  const map = {
    HIGH_CURRENT_POWER: ['In2.Cu', 'F.Cu', 'B.Cu'],
    MOTOR_PHASE: ['F.Cu', 'B.Cu', 'In2.Cu'],
    SWITCHING_NODE: ['F.Cu', 'B.Cu', 'In2.Cu'],
    PGND: ['In1.Cu', 'In6.Cu', 'F.Cu', 'B.Cu'],
    GND: ['In1.Cu', 'In6.Cu', 'F.Cu', 'B.Cu'],
    GATE_DRIVE: ['F.Cu', 'B.Cu'],
    BOOTSTRAP: ['F.Cu', 'B.Cu'],
    CURRENT_SENSE_KELVIN: ['In5.Cu', 'In3.Cu', 'B.Cu'],
    CURRENT_SENSE_REFERENCE: ['In5.Cu', 'In3.Cu'],
    REGULATED_RAIL: ['In4.Cu', 'F.Cu', 'B.Cu'],
    I2C: ['In3.Cu', 'In5.Cu', 'B.Cu', 'F.Cu'],
    SPI: ['In3.Cu', 'B.Cu', 'F.Cu'],
    UART: ['In3.Cu', 'In5.Cu', 'B.Cu', 'F.Cu'],
    SWD_DEBUG: ['In3.Cu', 'B.Cu', 'F.Cu'],
    RF_OR_CLOCK: ['F.Cu', 'In3.Cu'],
    ANALOG_SENSE: ['In5.Cu', 'In3.Cu'],
    LOW_SPEED_SIGNAL: ['In3.Cu', 'In5.Cu', 'B.Cu', 'F.Cu'],
  }
  return map[netType] || map.LOW_SPEED_SIGNAL
}

export function highCurrentRouteProfile(netType = 'LOW_SPEED_SIGNAL') {
  if (['HIGH_CURRENT_POWER', 'MOTOR_PHASE', 'SWITCHING_NODE', 'PGND'].includes(netType)) {
    return { widthMm: 0.8, preferredWidthMm: 1.2, minClearanceMm: 0.2, allowZones: true, allowViaArrays: true, maxNeckdownMm: 1.5 }
  }
  if (netType === 'REGULATED_RAIL') return { widthMm: 0.3, preferredWidthMm: 0.5, minClearanceMm: 0.15, allowZones: true, allowViaArrays: false, maxNeckdownMm: 2.5 }
  return { widthMm: 0.127, preferredWidthMm: 0.15, minClearanceMm: 0.127, allowZones: false, allowViaArrays: false, maxNeckdownMm: 0 }
}

export function buildHighDensityRoutePolicy(route = {}) {
  const netType = classifyEscRouteNet(route.net, route)
  const layerPreference = escRoutingLayerPreference(netType)
  const profile = highCurrentRouteProfile(netType)
  return {
    net: route.net,
    netType,
    layerPreference,
    profile,
    ganSensitive: ['MOTOR_PHASE', 'SWITCHING_NODE', 'GATE_DRIVE', 'BOOTSTRAP', 'PGND'].includes(netType),
    noiseSensitive: ['CURRENT_SENSE_KELVIN', 'CURRENT_SENSE_REFERENCE', 'RF_OR_CLOCK', 'ANALOG_SENSE', 'I2C', 'SWD_DEBUG'].includes(netType),
  }
}

export function classifyGanPowerStageRegion(routes = []) {
  const nets = routes.map((route) => ({ net: route.net, type: classifyEscRouteNet(route.net, route) }))
  return {
    switchingNets: nets.filter((item) => ['MOTOR_PHASE', 'SWITCHING_NODE'].includes(item.type)).map((item) => item.net),
    gateDriveNets: nets.filter((item) => item.type === 'GATE_DRIVE').map((item) => item.net),
    bootstrapNets: nets.filter((item) => item.type === 'BOOTSTRAP').map((item) => item.net),
    powerReturnNets: nets.filter((item) => ['PGND', 'GND'].includes(item.type)).map((item) => item.net),
  }
}

export function protectGateDriveLoops(route = {}) {
  const type = classifyEscRouteNet(route.net, route)
  return { protected: type === 'GATE_DRIVE', maxViaCount: type === 'GATE_DRIVE' ? 0 : undefined, preferredLayers: escRoutingLayerPreference(type), reason: 'keep gate drive loops short and local' }
}

export function protectBootstrapLoops(route = {}) {
  const type = classifyEscRouteNet(route.net, route)
  return { protected: type === 'BOOTSTRAP', preferredLayers: escRoutingLayerPreference(type), reason: 'keep bootstrap support close to driver and switch node' }
}

export function protectSwitchNodeKeepouts(route = {}) {
  const type = classifyEscRouteNet(route.net, route)
  return { switchingNode: ['MOTOR_PHASE', 'SWITCHING_NODE'].includes(type), keepAwayTypes: ['CURRENT_SENSE_KELVIN', 'CURRENT_SENSE_REFERENCE', 'RF_OR_CLOCK', 'ANALOG_SENSE'] }
}

export function protectKelvinSenseRoutes(route = {}) {
  const type = classifyEscRouteNet(route.net, route)
  return { protected: type === 'CURRENT_SENSE_KELVIN', preferredLayers: escRoutingLayerPreference(type), rejectNear: ['MOTOR_PHASE', 'SWITCHING_NODE', 'HIGH_CURRENT_POWER'] }
}

export function scoreEscPowerStageRouting(route = {}) {
  const policy = buildHighDensityRoutePolicy(route)
  const viaCount = route.viaPlan?.candidates?.length || 0
  const layer = route.layerPreference?.[0] || policy.layerPreference[0]
  let score = 50
  if (policy.layerPreference.includes(layer)) score += 20
  if (policy.ganSensitive && viaCount === 0) score += 10
  if (policy.profile.allowZones && route.zoneCandidate) score += 10
  if (policy.noiseSensitive && !['In2.Cu'].includes(layer)) score += 10
  return { score, netType: policy.netType, layer, viaCount }
}

export function classifyNoiseSensitiveNets(nets = []) {
  return nets
    .map((net) => ({ name: net.name || net.net || net, type: classifyEscRouteNet(net.name || net.net || net, net) }))
    .filter((item) => ['CURRENT_SENSE_KELVIN', 'CURRENT_SENSE_REFERENCE', 'RF_OR_CLOCK', 'ANALOG_SENSE', 'I2C', 'SWD_DEBUG'].includes(item.type))
}

export function routeSensitiveNetWithReference(route = {}) {
  const policy = buildHighDensityRoutePolicy(route)
  return {
    ...route,
    layerPreference: policy.layerPreference.filter((layer) => layer !== 'In2.Cu'),
    viaPlan: { ...(route.viaPlan || {}), candidates: (route.viaPlan?.candidates || []).slice(0, policy.netType === 'RF_OR_CLOCK' ? 0 : 1) },
    highDensityPolicy: policy,
  }
}

export function rejectSensitiveRouteNearSwitchNode(route = {}, nearbyRoutes = []) {
  const policy = buildHighDensityRoutePolicy(route)
  if (!policy.noiseSensitive) return false
  return nearbyRoutes.some((other) => ['MOTOR_PHASE', 'SWITCHING_NODE', 'HIGH_CURRENT_POWER'].includes(classifyEscRouteNet(other.net, other)))
}

export function routeKelvinSensePair(routeA = {}, routeB = {}) {
  return [routeSensitiveNetWithReference(routeA), routeSensitiveNetWithReference(routeB)].map((route) => ({
    ...route,
    kelvinPair: true,
    layerPreference: ['In5.Cu', 'In3.Cu', 'B.Cu'],
  }))
}

export function protectCurrentSenseCorridor(route = {}) {
  return protectKelvinSenseRoutes(route)
}

export function rejectSenseRouteThroughSwitchingNoise(route = {}, nearbyRoutes = []) {
  return rejectSensitiveRouteNearSwitchNode(route, nearbyRoutes)
}

export function scoreViaSite(via = {}, context = {}) {
  let score = 100
  const pads = context.pads || []
  for (const pad of pads) {
    const clearance = Math.hypot(Number(via.x) - Number(pad.x), Number(via.y) - Number(pad.y))
    if (pad.netName !== via.net && clearance < 0.45) score -= 60
    else if (clearance < 0.8) score -= 15
  }
  if (context.board?.outline && !pointInsideBox(via, context.board.outline)) score -= 100
  return { score, via, legal: score > 40 }
}

export function placeThroughViaArray(route = {}, count = 4) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  if (points.length < 2) return []
  const mid = { x: round((Number(points[0].x) + Number(points.at(-1).x)) / 2), y: round((Number(points[0].y) + Number(points.at(-1).y)) / 2) }
  const pitch = 0.55
  return Array.from({ length: count }, (_, index) => ({
    x: round(mid.x + (index % 2 ? pitch : -pitch) / 2),
    y: round(mid.y + (index < 2 ? -pitch : pitch) / 2),
    viaType: 'through',
    diameterMm: 0.45,
    drillMm: 0.2,
    net: route.net,
  }))
}

export function classifyGeneratedDrcRegression(regression = {}, route = {}) {
  const reason = regression.reason || regression.failure || 'DRC_ERROR_REGRESSION'
  if (/VIA/i.test(reason)) return { family: 'VIA_CLEARANCE', repair: 'move_via_or_remove_via', route: route.net }
  if (/PAD|CLEARANCE/i.test(reason)) return { family: 'PAD_CLEARANCE', repair: 'alternate_pad_edge_or_dogleg', route: route.net }
  if (/EDGE/i.test(reason)) return { family: 'BOARD_EDGE', repair: 'pull_route_inward', route: route.net }
  return { family: 'GENERAL_DRC_REGRESSION', repair: 'alternate_layer_and_corridor', route: route.net }
}

export function repairGeneratedRouteDrc(route = {}, failure = {}, context = {}) {
  return mutateRouteAfterDrcFailure(route, failure, context)
}

export function mutateRouteAfterDrcFailure(route = {}, failure = {}, context = {}) {
  const policy = buildHighDensityRoutePolicy(route)
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  if (points.length < 2) return []
  const start = points[0]
  const end = points.at(-1)
  const offsets = [0.45, -0.45, 0.9, -0.9, 1.6, -1.6, 2.4, -2.4]
  const layerCandidates = policy.layerPreference.map((layer) => ({
    ...route,
    layerPreference: [layer],
    widthMm: Math.max(Number(route.widthMm || 0), policy.profile.widthMm),
    mutation: { type: 'high_density_alternate_layer', layer, netType: policy.netType },
  }))
  const doglegs = offsets.flatMap((offset) => [
    {
      ...route,
      waypoints: [{ ...start }, { x: start.x, y: round((start.y + end.y) / 2 + offset) }, { x: end.x, y: round((start.y + end.y) / 2 + offset) }, { ...end }],
      mutation: { type: 'high_density_dogleg_y', offset, netType: policy.netType, reason: failure.failure || failure.reason },
    },
    {
      ...route,
      waypoints: [{ ...start }, { x: round((start.x + end.x) / 2 + offset), y: start.y }, { x: round((start.x + end.x) / 2 + offset), y: end.y }, { ...end }],
      mutation: { type: 'high_density_dogleg_x', offset, netType: policy.netType, reason: failure.failure || failure.reason },
    },
  ])
  const noVia = {
    ...route,
    viaPlan: { ...(route.viaPlan || {}), candidates: [] },
    mutation: { type: 'high_density_no_via_retry', netType: policy.netType },
  }
  return [...layerCandidates, ...doglegs, noVia]
}

export function rerouteAroundConflict(route = {}, conflict = {}, context = {}) {
  return mutateRouteAfterDrcFailure(route, conflict, context)
}

export function identifyGeneratedRouteBlockingFutureNets(committedRoutes = [], futureRoutes = []) {
  return committedRoutes
    .map((route) => ({ route, impact: futureRoutes.filter((future) => future.net !== route.net).length }))
    .filter((item) => item.impact > 0)
    .sort((a, b) => b.impact - a.impact)
}

export function ripupGeneratedRoute(route = {}) {
  return { ...route, ripupGeneratedCopperOnly: true, status: 'generated_route_ripup_requested' }
}

export function rerouteWithHigherPriorityOrder(routes = []) {
  const priority = { PGND: 0, GND: 1, HIGH_CURRENT_POWER: 2, MOTOR_PHASE: 3, GATE_DRIVE: 4, BOOTSTRAP: 5, CURRENT_SENSE_KELVIN: 6, REGULATED_RAIL: 7 }
  return [...routes].sort((a, b) => (priority[classifyEscRouteNet(a.net, a)] ?? 20) - (priority[classifyEscRouteNet(b.net, b)] ?? 20))
}

export function scoreRouteGlobalImpact(route = {}, futureRoutes = []) {
  return { net: route.net, score: 100 - futureRoutes.filter((future) => future.net !== route.net).length, generatedOnly: true }
}

export function createPgndGndZoneStrategy(nets = []) {
  const hasGround = nets.some((net) => ['GND', 'PGND'].includes(classifyEscRouteNet(net.name || net.net || net, net)))
  return {
    enabled: hasGround,
    zones: hasGround ? [
      { layer: 'In1.Cu', net: 'GND', purpose: 'reference_plane' },
      { layer: 'In6.Cu', net: 'GND', purpose: 'return_shield' },
    ] : [],
    viaPolicy: 'standard_through_stitching_only_no_via_in_pad',
  }
}

export function highDensityEscRouter({ routes = [], nets = [], context = {} } = {}) {
  const classified = routes.map((route) => ({ ...route, highDensityPolicy: buildHighDensityRoutePolicy(route) }))
  return {
    status: 'HIGH_DENSITY_ESC_ROUTER_READY',
    routes: rerouteWithHigherPriorityOrder(classified),
    netClasses: (nets.length ? nets : routes).map((net) => ({ name: net.name || net.net || net, type: classifyEscRouteNet(net.name || net.net || net, net) })),
    layerPolicy: escLayerPolicy,
    pgndGnd: createPgndGndZoneStrategy(nets.length ? nets : routes),
    ganRegion: classifyGanPowerStageRegion(routes),
    ripupCandidates: identifyGeneratedRouteBlockingFutureNets(context.committedRoutes || [], routes),
  }
}

function pointInsideBox(point = {}, outline = []) {
  if (!outline.length) return true
  const xs = outline.map((item) => Number(item.x)).filter(Number.isFinite)
  const ys = outline.map((item) => Number(item.y)).filter(Number.isFinite)
  if (!xs.length || !ys.length) return true
  return Number(point.x) >= Math.min(...xs) && Number(point.x) <= Math.max(...xs)
    && Number(point.y) >= Math.min(...ys) && Number(point.y) <= Math.max(...ys)
}
