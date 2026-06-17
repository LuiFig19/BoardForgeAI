export function buildNoiseMap(input = {}) {
  const components = input.components || []
  const nets = input.nets || []
  const noisyRegions = components.filter((component) => /(REGULATOR|INDUCTOR|MOSFET|GATE|MOTOR|POE|LED_DRIVER|RELAY|POWER)/i.test(`${component.group || ''} ${component.value || ''}`)).map((component) => region(component, 'noisy_switching_or_power', 6, 'Keep analog, RF, crystal, and sensor routes away.'))
  const sensitiveRegions = components.filter((component) => /(IMU|BARO|SENSOR|ADC|ANALOG|CRYSTAL|OSC|RF|ANT|AUDIO)/i.test(`${component.group || ''} ${component.value || ''}`)).map((component) => region(component, 'sensitive_quiet_zone', 5, 'Avoid hot copper, via fields, and switching-node routes.'))
  const antennaKeepouts = components.filter((component) => /(ANT|RF|ESP32|WROOM|WIRELESS)/i.test(`${component.group || ''} ${component.value || ''}`)).map((component) => region(component, 'antenna_keepout', 10, 'No copper/vias/components unless reference design allows it.'))
  const sensitiveNets = nets.filter((net) => /(ADC|SENSE|XTAL|OSC|RF|ANT|IMU|MIPI|PCIE|USB|ETH)/i.test(net.name || '')).map((net) => ({ net: net.name, className: net.className || null, rule: 'route with continuous return path and separation from noisy regions' }))
  const warnings = []
  for (const noisy of noisyRegions) {
    for (const sensitive of [...sensitiveRegions, ...antennaKeepouts]) {
      const distance = Math.hypot(noisy.x - sensitive.x, noisy.y - sensitive.y)
      if (distance < noisy.radiusMm + sensitive.radiusMm) warnings.push(issue('WARNING', 'NOISE_REGION_OVERLAP', `${noisy.owner} noise region overlaps or is too close to ${sensitive.owner}.`, { noisy, sensitive, distanceMm: round(distance) }))
    }
  }
  return {
    schemaVersion: 1,
    status: warnings.length ? 'NOISE_MAP_NEEDS_REVIEW' : 'NOISE_MAP_READY',
    noisyRegions,
    sensitiveRegions,
    antennaKeepouts,
    sensitiveNets,
    routeKeepawayRules: [
      'Do not route analog/sensor/crystal nets through noisy switching or high-current regions.',
      'Do not pour copper through antenna keepouts unless the module datasheet explicitly permits it.',
      'Use ground stitching around noisy edges and connector exits after DRC review.',
    ],
    warnings,
    errors: [],
    humanReviewRequired: true,
  }
}

function region(component, kind, paddingMm, rule) {
  const width = Number(component.width || 4) + paddingMm
  const height = Number(component.height || 4) + paddingMm
  return { id: `${kind}_${component.ref}`, kind, owner: component.ref, x: Number(component.x || 0), y: Number(component.y || 0), widthMm: round(width), heightMm: round(height), radiusMm: round(Math.max(width, height) / 2), rule }
}

function round(value) {
  return Math.round(value * 100) / 100
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
