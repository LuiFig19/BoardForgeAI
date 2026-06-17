import { pointInPolygon, polygonBounds, round } from './geometry.mjs'

export function planCopperPours({ board = {}, nets = [], components = [], profile = {}, options = {} } = {}) {
  const outline = board.outline || []
  const bounds = outline.length ? polygonBounds(outline) : { minX: 0, minY: 0, maxX: board.widthMm || 50, maxY: board.heightMm || 30 }
  const powerNets = nets.filter((net) => /^(GND|PGND|AGND|3V3|5V|VIN|VBAT|VUSB|POE_VDD)$/i.test(net.name || net))
  const pours = preferredPourNets(powerNets).map((net) => ({
    net: net.name || net,
    layer: pourLayer(net.name || net, board),
    copperRole: pourRole(net.name || net),
    clearanceMm: clearanceFor(net.name || net, profile),
    thermalRelief: !/^GND|PGND|AGND$/i.test(net.name || net),
    priority: pourPriority(net.name || net),
    polygon: outline,
    avoidZones: inferAvoidZones(board, components),
    stitchingPolicy: stitchingPolicy(net.name || net),
  }))
  const stitchingVias = pours
    .filter((pour) => /^GND|PGND|AGND$/i.test(pour.net))
    .flatMap((pour) => [
      ...stitchGrid(bounds, outline, profile, options).map((via) => ({ ...via, net: pour.net, layers: ['F.Cu', 'B.Cu'], reason: 'ground return stitching' })),
      ...stitchAroundComponents(components, outline, profile, pour.net),
    ])
  const starPoints = planStarGroundBridges(powerNets, components)
  const warnings = []
  if (!outline.length) warnings.push(issue('WARNING', 'POUR_OUTLINE_MISSING', 'Board outline is missing, so copper pour polygon is approximate.'))
  if (!pours.some((pour) => /^GND|PGND|AGND$/i.test(pour.net))) warnings.push(issue('WARNING', 'GROUND_POUR_MISSING', 'No ground net was found for a reference copper pour.'))
  if (powerNets.some((net) => /AGND/i.test(net.name || net)) && !starPoints.length) warnings.push(issue('WARNING', 'AGND_BRIDGE_REVIEW_REQUIRED', 'AGND exists but no star/bridge point was inferred near the ADC/analog boundary.'))
  if (inferAvoidZones(board, components).some((zone) => zone.kind === 'antenna_rf_keepout')) warnings.push(issue('WARNING', 'ANTENNA_POUR_KEEP_OUT_REVIEW', 'Antenna/RF keepouts were added; verify copper-free zones against the module datasheet.'))
  return {
    status: warnings.length ? 'COPPER_POUR_PLAN_NEEDS_REVIEW' : 'COPPER_POUR_PLAN_READY_NEEDS_DRC',
    pours,
    stitchingVias,
    starGroundBridges: starPoints,
    avoidZones: inferAvoidZones(board, components),
    rules: [
      'Fill GND reference copper first and verify no split-plane crossings under high-speed nets.',
      'Keep copper and stitching out of antenna keepouts unless the reference design explicitly allows it.',
      'Use thermal relief for small passive pads; use solid connections only for reviewed high-current copper.',
      'Rerun KiCad DRC after every zone refill.',
    ],
    warnings,
    errors: [],
    designIntentPatch: { copperPours: pours, stitchingVias, starGroundBridges: starPoints },
    humanReviewRequired: true,
  }
}

function preferredPourNets(nets) {
  const byName = new Map(nets.map((net) => [net.name || net, net]))
  const ordered = ['GND', 'PGND', 'AGND', '3V3', '5V', 'VBAT', 'VIN', 'VUSB', 'POE_VDD']
  return ordered.filter((name) => byName.has(name)).map((name) => byName.get(name))
}

function stitchGrid(bounds, outline, profile, options) {
  const spacing = Number(options.stitchingSpacingMm || 8)
  const vias = []
  for (let x = bounds.minX + spacing; x < bounds.maxX - spacing / 2; x += spacing) {
    for (let y = bounds.minY + spacing; y < bounds.maxY - spacing / 2; y += spacing) {
      const point = { x: round(x), y: round(y) }
      if (outline.length && !pointInPolygon(point, outline)) continue
      vias.push({ ...point, diameterMm: profile.minViaDiameterMm || 0.45, drillMm: profile.minViaDrillMm || 0.2 })
    }
  }
  return vias.slice(0, options.maxStitchingVias || 80)
}

function stitchAroundComponents(components, outline, profile, net) {
  const important = components.filter((component) => /(ANT|RF|WIFI|BLE|USB|RJ45|CONNECTOR|XTAL|CRYSTAL|OSC)/i.test(`${component.group || ''} ${component.value || ''} ${component.ref || ''}`))
  const vias = []
  for (const component of important) {
    const margin = /(ANT|RF|WIFI|BLE)/i.test(`${component.group || ''} ${component.value || ''}`) ? 7 : 3
    const points = [
      { x: Number(component.x || 0) - margin, y: Number(component.y || 0) - margin },
      { x: Number(component.x || 0) + margin, y: Number(component.y || 0) - margin },
      { x: Number(component.x || 0) - margin, y: Number(component.y || 0) + margin },
      { x: Number(component.x || 0) + margin, y: Number(component.y || 0) + margin },
    ]
    for (const point of points) {
      if (outline.length && !pointInPolygon(point, outline)) continue
      vias.push({ x: round(point.x), y: round(point.y), net, layers: ['F.Cu', 'B.Cu'], diameterMm: profile.minViaDiameterMm || 0.45, drillMm: profile.minViaDrillMm || 0.2, reason: `local return stitching near ${component.ref}` })
    }
  }
  return vias
}

function inferAvoidZones(board, components) {
  return components
    .filter((component) => /(ANT|RF|WIFI|BLE|CRYSTAL|SWITCHING|HOT|THERMAL)/i.test(`${component.group || ''} ${component.value || ''} ${component.role || ''}`))
    .map((component) => ({
      id: `POUR_KEEP_${component.ref}`,
      ref: component.ref,
      kind: /(ANT|RF|WIFI|BLE)/i.test(`${component.group || ''} ${component.value || ''}`) ? 'antenna_rf_keepout' : 'thermal_noise_keepout',
      x: component.x,
      y: component.y,
      width: (component.width || 4) + 4,
      height: (component.height || 3) + 4,
      allowCopper: false,
      allowVias: false,
    }))
}

function planStarGroundBridges(nets, components) {
  const names = new Set(nets.map((net) => net.name || net))
  if (!names.has('AGND') || !names.has('GND')) return []
  const analog = components.find((component) => /(ADC|ANALOG|SENSOR|AUDIO)/i.test(`${component.group || ''} ${component.value || ''}`))
  return [{
    nets: ['AGND', 'GND'],
    x: round(Number(analog?.x || 0)),
    y: round(Number(analog?.y || 0)),
    rule: 'single reviewed bridge close to ADC/analog reference point; do not stitch AGND/GND everywhere',
  }]
}

function pourLayer(net, board) {
  const layerCount = Number(board.layerCount || 2)
  if (/^GND|PGND|AGND$/i.test(net)) return layerCount >= 4 ? 'In1.Cu' : 'B.Cu'
  if (/VBAT|VIN|POE|5V/i.test(net)) return 'B.Cu'
  return 'F.Cu'
}

function pourRole(net) {
  if (/^GND$/i.test(net)) return 'reference_ground'
  if (/^AGND$/i.test(net)) return 'quiet_analog_reference'
  if (/^PGND$/i.test(net)) return 'power_return'
  if (/VBAT|VIN|POE|5V|3V3|VUSB/i.test(net)) return 'power_distribution'
  return 'copper_fill'
}

function clearanceFor(net, profile) {
  const fab = profile.minClearanceMm || 0.2
  if (/POE|VIN|VBAT/i.test(net)) return Math.max(fab, 0.35)
  if (/AGND|ADC|RF/i.test(net)) return Math.max(fab, 0.25)
  return fab
}

function pourPriority(net) {
  if (/^GND$/i.test(net)) return 40
  if (/^PGND|^AGND/i.test(net)) return 35
  if (/VBAT|VIN|POE|5V/i.test(net)) return 25
  return 20
}

function stitchingPolicy(net) {
  if (/^AGND$/i.test(net)) return 'avoid global stitching; use reviewed star bridge'
  if (/^PGND$/i.test(net)) return 'stitch near high-current returns and regulators only'
  if (/^GND$/i.test(net)) return 'edge, connector, RF fence, and layer-transition stitching'
  return 'no stitching unless power integrity review requires it'
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
