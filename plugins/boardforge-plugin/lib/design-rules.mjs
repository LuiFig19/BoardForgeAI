import { pointInPolygon, polygonBounds, round } from './geometry.mjs'
import { netClassProfiles } from './net-classes.mjs'

export function createDesignIntent(board, components = [], nets = [], profile = {}) {
  const bounds = polygonBounds(board.outline || [])
  const zones = [
    ...antennaKeepouts(board, components, bounds),
    ...thermalKeepouts(board, components, bounds),
    ...sensitiveKeepouts(board, components),
  ]
  return {
    board: {
      widthMm: board.widthMm,
      heightMm: board.heightMm,
      layerCount: board.layerCount || 2,
      compactness: compactnessForBoard(board),
    },
    zones,
    copperPours: copperPourPlan(board, nets, zones),
    viaRules: viaRulesForBoard(board, profile),
    layerPolicy: layerPolicyForBoard(board),
    routePriority: routePriority(nets),
    humanReviewRequired: true,
  }
}

export function planViasForRoute({ net, start, end, board, zones = [], profile = {} }) {
  const netClass = net.className || 'DEFAULT'
  const rules = netClassProfiles[netClass] || netClassProfiles.DEFAULT
  const dx = Math.abs((end?.x || 0) - (start?.x || 0))
  const dy = Math.abs((end?.y || 0) - (start?.y || 0))
  const manhattan = dx + dy
  const layerCount = board.layerCount || 2
  const sensitive = ['USB_DIFF', 'ETHERNET_DIFF', 'RF', 'CRYSTAL', 'CLOCK'].includes(netClass)
  const highCurrent = ['BATTERY', 'MOTOR_PHASE', 'POWER_HIGH_CURRENT'].includes(netClass)
  const maxVias = sensitive ? 0 : highCurrent ? Math.max(1, Math.floor(manhattan / 25)) : Math.max(1, Math.floor(manhattan / 18))
  const viaStack = highCurrent ? 'stitched_parallel_vias' : sensitive ? 'avoid_vias' : layerCount >= 4 ? 'blind_prefer_inner_reference' : 'through_via'
  const candidates = []
  if (!sensitive && layerCount >= 2 && manhattan > 12) {
    const mid = { x: round(((start?.x || 0) + (end?.x || 0)) / 2), y: round(((start?.y || 0) + (end?.y || 0)) / 2) }
    if (pointInPolygon(mid, board.outline || []) && !insideKeepout(mid, zones)) {
      candidates.push({
        x: mid.x,
        y: mid.y,
        diameterMm: Math.max(rules.viaDiameterMm, profile.minViaDiameterMm || 0.45),
        drillMm: Math.max(rules.viaDrillMm, profile.minViaDrillMm || 0.2),
        reason: highCurrent ? 'shorten high-current route with stitched layer transition' : 'compact route layer transition near midpoint',
      })
    }
  }
  return {
    net: net.name,
    className: netClass,
    maxVias,
    viaStack,
    candidates: candidates.slice(0, maxVias),
    rules: {
      diameterMm: Math.max(rules.viaDiameterMm, profile.minViaDiameterMm || 0.45),
      drillMm: Math.max(rules.viaDrillMm, profile.minViaDrillMm || 0.2),
      annularReview: true,
    },
    warnings: sensitive ? [`${net.name} should avoid vias unless the user explicitly accepts impedance/return-path review.`] : [],
  }
}

export function validateZones(board, zones = []) {
  const issues = []
  for (const zone of zones) {
    const points = zone.polygon || []
    if (points.length && points.some((point) => !pointInPolygon(point, board.outline || []))) {
      issues.push({ severity: 'WARNING', code: 'ZONE_TOUCHES_OUTLINE', message: `${zone.id} extends outside or onto the board outline.`, zone })
    }
    if (zone.kind === 'antenna_keepout' && zone.allowCopper !== false) {
      issues.push({ severity: 'ERROR', code: 'ANTENNA_KEEPOUT_ALLOWS_COPPER', message: `${zone.id} must block copper pours, vias, and components.` })
    }
    if (zone.kind === 'thermal_keepout' && !zone.minComponentClearanceMm) {
      issues.push({ severity: 'WARNING', code: 'THERMAL_ZONE_NO_CLEARANCE', message: `${zone.id} should define component clearance.` })
    }
  }
  return issues
}

function antennaKeepouts(board, components, bounds) {
  const zones = []
  for (const component of components) {
    if (!/(ESP32|RF|ANT|WROOM|WIRELESS)/i.test(`${component.group || ''} ${component.value || ''}`)) continue
    const width = Math.max(component.width || 12, 16)
    const height = Math.max(6, Math.min(12, (component.height || 8) * 0.8))
    const edgeY = component.y < (bounds.minY + bounds.maxY) / 2 ? bounds.minY : bounds.maxY
    zones.push(rectZone(`ANT_KEEP_${component.ref}`, 'antenna_keepout', component.x, edgeY === bounds.minY ? bounds.minY + height / 2 : bounds.maxY - height / 2, width, height, {
      owner: component.ref,
      allowCopper: false,
      allowVias: false,
      allowComponents: false,
      reason: 'Keep copper, vias, and components away from antenna region.',
    }))
  }
  return zones
}

function thermalKeepouts(board, components) {
  return components
    .filter((component) => /(REGULATOR|MOSFET|POE|POWER|GATE|MOTOR|SHUNT)/i.test(`${component.group || ''} ${component.value || ''}`))
    .map((component) => rectZone(`THERMAL_${component.ref}`, 'thermal_keepout', component.x, component.y, Math.max(component.width || 4, 8), Math.max(component.height || 4, 8), {
      owner: component.ref,
      allowCopper: true,
      allowVias: true,
      minComponentClearanceMm: 2,
      reason: 'Heat-producing region needs copper relief/thermal review and spacing from sensors/RF.',
    }))
}

function sensitiveKeepouts(board, components) {
  return components
    .filter((component) => /(IMU|BARO|SENSOR|CRYSTAL|OSC|ADC|ANALOG)/i.test(`${component.group || ''} ${component.value || ''}`))
    .map((component) => rectZone(`SENSITIVE_${component.ref}`, 'sensitive_keepout', component.x, component.y, Math.max(component.width || 3, 6), Math.max(component.height || 3, 6), {
      owner: component.ref,
      allowCopper: true,
      allowVias: false,
      minComponentClearanceMm: 1.5,
      reason: 'Sensitive signal region should avoid via fields, hot components, and noisy power routes.',
    }))
}

function copperPourPlan(board, nets, zones) {
  const layerCount = board.layerCount || 2
  const hasGround = nets.some((net) => (net.name || '').toUpperCase() === 'GND' || net.className === 'GROUND')
  const blockedZones = zones.filter((zone) => zone.allowCopper === false).map((zone) => zone.id)
  const pours = []
  if (hasGround) {
    pours.push({ net: 'GND', layer: 'B.Cu', priority: 100, clearanceMm: 0.2, thermalRelief: true, avoidZones: blockedZones })
    if (layerCount >= 4) pours.push({ net: 'GND', layer: 'In1.Cu', priority: 100, clearanceMm: 0.2, thermalRelief: false, avoidZones: blockedZones })
  }
  if (nets.some((net) => ['BATTERY', 'POWER_HIGH_CURRENT'].includes(net.className))) {
    pours.push({ net: 'VIN', layer: 'F.Cu', priority: 80, clearanceMm: 0.35, thermalRelief: false, avoidZones: blockedZones })
  }
  return pours
}

function viaRulesForBoard(board, profile) {
  const compact = compactnessForBoard(board) !== 'roomy'
  return {
    preferSameLayerFor: ['USB_DIFF', 'ETHERNET_DIFF', 'RF', 'CRYSTAL', 'CLOCK'],
    allowLayerSwitchFor: ['GROUND', 'POWER_LOW_CURRENT', 'POWER_HIGH_CURRENT', 'BATTERY', 'MOTOR_PHASE', 'I2C', 'UART', 'SPI', 'DEFAULT'],
    compactBoardPolicy: compact ? 'use midpoint vias only when it avoids component conflict or route crossing' : 'minimize vias but allow clean layer transitions',
    minViaDiameterMm: profile.minViaDiameterMm || 0.45,
    minViaDrillMm: profile.minViaDrillMm || 0.2,
    viaToEdgeClearanceMm: Math.max(0.5, profile.minClearanceMm || 0.15),
    viaToComponentClearanceMm: Math.max(0.35, profile.componentToComponentClearanceMm || 0.25),
    stitching: {
      groundViaPitchMm: compact ? 8 : 12,
      edgeViaInsetMm: 1.2,
      aroundHighCurrentPitchMm: 5,
      avoidAntennaKeepouts: true,
    },
  }
}

function layerPolicyForBoard(board) {
  const layerCount = board.layerCount || 2
  if (layerCount >= 6) return { signalTop: 'F.Cu', groundReference: 'In1.Cu', power: 'In2.Cu', secondarySignals: 'B.Cu', notes: 'Use inner references for impedance and return paths.' }
  if (layerCount >= 4) return { signalTop: 'F.Cu', groundReference: 'In1.Cu', power: 'In2.Cu', secondarySignals: 'B.Cu', notes: 'Keep high-speed on F.Cu referenced to continuous In1.Cu ground.' }
  return { signalTop: 'F.Cu', groundReference: 'B.Cu', power: 'F.Cu/B.Cu pours', secondarySignals: 'B.Cu', notes: 'Two-layer boards need conservative high-speed routing and many GND stitches.' }
}

function routePriority(nets) {
  return [...nets]
    .sort((a, b) => (netClassProfiles[b.className || 'DEFAULT']?.priority || 0) - (netClassProfiles[a.className || 'DEFAULT']?.priority || 0))
    .map((net, index) => ({ order: index + 1, net: net.name, className: net.className || 'DEFAULT', reason: priorityReason(net.className || 'DEFAULT') }))
}

function priorityReason(className) {
  if (['BATTERY', 'MOTOR_PHASE', 'POWER_HIGH_CURRENT'].includes(className)) return 'route wide/high-current copper early before space is consumed'
  if (['USB_DIFF', 'ETHERNET_DIFF', 'RF', 'CRYSTAL'].includes(className)) return 'route sensitive impedance/length-critical nets before generic signals'
  if (className === 'GROUND') return 'define return path, pours, and via stitching strategy'
  return 'route after critical power and sensitive nets'
}

function compactnessForBoard(board) {
  const bounds = polygonBounds(board.outline || [])
  const area = Math.abs((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY))
  if (area < 1200) return 'very_compact'
  if (area < 2500) return 'compact'
  return 'roomy'
}

function rectZone(id, kind, x, y, width, height, extra = {}) {
  return {
    id,
    kind,
    x: round(x),
    y: round(y),
    widthMm: round(width),
    heightMm: round(height),
    polygon: [
      { x: round(x - width / 2), y: round(y - height / 2) },
      { x: round(x + width / 2), y: round(y - height / 2) },
      { x: round(x + width / 2), y: round(y + height / 2) },
      { x: round(x - width / 2), y: round(y + height / 2) },
    ],
    ...extra,
  }
}

function insideKeepout(point, zones) {
  return zones.some((zone) => zone.allowVias === false && pointInPolygon(point, zone.polygon || []))
}
