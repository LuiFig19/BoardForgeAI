import { pointInPolygon, polygonBounds, round } from './geometry.mjs'

export function planCopperPours({ board = {}, nets = [], components = [], profile = {}, options = {} } = {}) {
  const outline = board.outline || []
  const bounds = outline.length ? polygonBounds(outline) : { minX: 0, minY: 0, maxX: board.widthMm || 50, maxY: board.heightMm || 30 }
  const powerNets = nets.filter((net) => /^(GND|PGND|AGND|3V3|5V|VIN|VBAT|VUSB|POE_VDD)$/i.test(net.name || net))
  const pours = preferredPourNets(powerNets).map((net) => ({
    net: net.name || net,
    layer: /^GND|PGND|AGND$/i.test(net.name || net) ? 'In1.Cu' : 'F.Cu',
    clearanceMm: profile.minClearanceMm || 0.2,
    thermalRelief: !/^GND|PGND|AGND$/i.test(net.name || net),
    priority: /^GND|PGND|AGND$/i.test(net.name || net) ? 30 : 20,
    polygon: outline,
    avoidZones: inferAvoidZones(board, components),
  }))
  const stitchingVias = pours
    .filter((pour) => /^GND|PGND|AGND$/i.test(pour.net))
    .flatMap((pour) => stitchGrid(bounds, outline, profile, options).map((via) => ({ ...via, net: pour.net, layers: ['F.Cu', 'B.Cu'], reason: 'ground return stitching' })))
  const warnings = []
  if (!outline.length) warnings.push(issue('WARNING', 'POUR_OUTLINE_MISSING', 'Board outline is missing, so copper pour polygon is approximate.'))
  if (!pours.some((pour) => /^GND|PGND|AGND$/i.test(pour.net))) warnings.push(issue('WARNING', 'GROUND_POUR_MISSING', 'No ground net was found for a reference copper pour.'))
  return {
    status: warnings.length ? 'COPPER_POUR_PLAN_NEEDS_REVIEW' : 'COPPER_POUR_PLAN_READY_NEEDS_DRC',
    pours,
    stitchingVias,
    avoidZones: inferAvoidZones(board, components),
    warnings,
    errors: [],
    designIntentPatch: { copperPours: pours, stitchingVias },
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
    }))
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
