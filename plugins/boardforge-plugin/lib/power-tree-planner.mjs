const defaultRailCatalog = {
  VUSB: { voltage: 5, source: 'USB-C / VBUS', currentMa: 500, kind: 'input' },
  VIN: { voltage: 5, source: 'external input', currentMa: 1000, kind: 'input' },
  BAT: { voltage: 7.4, source: 'battery input', currentMa: 3000, kind: 'input' },
  POE_VDD: { voltage: 48, source: '802.3af PoE front end', currentMa: 350, kind: 'input', isolated: true },
  '5V': { voltage: 5, source: 'regulated rail', currentMa: 1000, kind: 'regulated' },
  '3V3': { voltage: 3.3, source: 'regulated rail', currentMa: 600, kind: 'regulated' },
  '1V8': { voltage: 1.8, source: 'regulated rail', currentMa: 250, kind: 'regulated' },
  GND: { voltage: 0, source: 'return', currentMa: 0, kind: 'return' },
}

const groupLoads = [
  { pattern: /(ESP32|WROOM|WIFI|WI-FI|BLE)/i, rail: '3V3', currentMa: 350, reason: 'radio MCU peak current and RF bursts' },
  { pattern: /(MCU|STM32|PROCESSOR|QFN)/i, rail: '3V3', currentMa: 120, reason: 'MCU core and IO estimate' },
  { pattern: /(ETHERNET_PHY|LAN8720|PHY)/i, rail: '3V3', currentMa: 90, reason: 'Ethernet PHY active current' },
  { pattern: /(POE_FRONT_END|POE|802\.3)/i, rail: 'POE_VDD', currentMa: 220, reason: 'PoE front-end conversion and isolation budget' },
  { pattern: /(RJ45|MAGJACK)/i, rail: '3V3', currentMa: 30, reason: 'MagJack LEDs / PHY support budget' },
  { pattern: /(IMU|BAROMETER|SENSOR|SHT|BME|BMP|SCD)/i, rail: '3V3', currentMa: 20, reason: 'sensor rail budget' },
  { pattern: /(FLASH|BLACKBOX|MEMORY)/i, rail: '3V3', currentMa: 40, reason: 'SPI flash write current' },
  { pattern: /(ESC|MOTOR|GATE|MOSFET|DRIVER)/i, rail: '5V', currentMa: 250, reason: 'driver/ESC interface budget' },
  { pattern: /(USB|TYPE-C)/i, rail: 'VUSB', currentMa: 50, reason: 'USB connector and protection budget' },
  { pattern: /(LED|STATUS)/i, rail: '3V3', currentMa: 10, reason: 'indicator current' },
]

export function planPowerTree(input = {}) {
  const components = input.components || []
  const nets = normalizeNets(input.nets || [])
  const explicitRails = normalizeRails(input.powerRails || input.rails || [])
  const inferredLoads = inferLoads(components)
  const railNames = [...new Set([
    ...Object.keys(defaultRailCatalog).filter((name) => nets.has(name)),
    ...explicitRails.map((rail) => rail.name),
    ...inferredLoads.map((load) => load.rail),
    ...(input.powerInput ? [input.powerInput] : []),
  ])]
  const rails = railNames.length ? railNames : ['VUSB', '3V3', 'GND']
  const railPlans = rails.map((name) => railPlan(name, explicitRails, inferredLoads, input))
  const sources = selectSources(input, railPlans)
  const regulators = planRegulators(sources, railPlans, components)
  const decoupling = planDecoupling(components)
  const constraints = buildPowerConstraints(railPlans, regulators, decoupling)
  const errors = blockers(input, railPlans, sources, regulators)
  const warnings = warningsFor(input, railPlans, regulators, decoupling)
  return {
    schemaVersion: 1,
    status: errors.length ? 'POWER_TREE_BLOCKED' : 'POWER_TREE_READY_NEEDS_REVIEW',
    inputs: sources,
    rails: railPlans,
    regulators,
    loads: inferredLoads,
    decoupling,
    constraints,
    sequencing: planSequencing(railPlans, components),
    thermalReview: planThermalReview(regulators),
    manufacturingGates: {
      requirePowerRailReview: true,
      requireDrcBeforeExport: true,
      requireErcBeforeExport: true,
      requireThermalApproval: regulators.some((regulator) => regulator.thermalRisk !== 'low'),
    },
    warnings,
    errors,
    humanReviewRequired: true,
  }
}

function normalizeNets(nets) {
  return new Set((nets || []).map((net) => typeof net === 'string' ? net : net.name).filter(Boolean))
}

function normalizeRails(rails) {
  return (rails || []).map((rail) => typeof rail === 'string' ? { name: rail } : rail).filter((rail) => rail.name)
}

function inferLoads(components) {
  return components.flatMap((component) => {
    const haystack = `${component.ref || ''} ${component.group || ''} ${component.value || ''} ${component.role || ''}`
    const found = groupLoads.find((rule) => rule.pattern.test(haystack))
    if (!found) return []
    return [{
      ref: component.ref,
      rail: component.powerRail || found.rail,
      currentMa: component.currentMa || found.currentMa,
      reason: found.reason,
      placementRule: /(ESP32|WROOM|RF|ANT)/i.test(haystack)
        ? 'keep power switching noise away from antenna keepout'
        : 'place local decoupling close to supply pins',
    }]
  })
}

function railPlan(name, explicitRails, loads, input) {
  const explicit = explicitRails.find((rail) => rail.name === name) || {}
  const catalog = defaultRailCatalog[name] || {}
  const railLoads = loads.filter((load) => load.rail === name)
  const loadCurrentMa = railLoads.reduce((sum, load) => sum + Number(load.currentMa || 0), 0)
  const margin = Number(explicit.marginPercent ?? input.powerMarginPercent ?? 35)
  const requiredCurrentMa = Math.ceil(loadCurrentMa * (1 + margin / 100))
  const currentMa = Number(explicit.currentMa || catalog.currentMa || Math.max(requiredCurrentMa, 100))
  return {
    name,
    voltage: Number(explicit.voltage ?? catalog.voltage ?? inferVoltage(name)),
    kind: explicit.kind || catalog.kind || (name === 'GND' ? 'return' : 'regulated'),
    source: explicit.source || catalog.source || 'derived rail',
    currentMa,
    loadCurrentMa,
    marginPercent: margin,
    requiredCurrentMa,
    loads: railLoads.map((load) => load.ref).filter(Boolean),
    copperPourRecommended: /^(GND|3V3|5V|VIN|BAT|POE_VDD|VUSB)$/.test(name),
  }
}

function selectSources(input, rails) {
  const requested = input.powerInput || input.inputRail || null
  const sourceNames = requested ? [requested] : rails.filter((rail) => rail.kind === 'input').map((rail) => rail.name)
  return [...new Set(sourceNames.length ? sourceNames : ['VUSB'])].map((name) => {
    const rail = rails.find((item) => item.name === name)
    const catalog = defaultRailCatalog[name] || {}
    return {
      name,
      voltage: rail?.voltage ?? catalog.voltage ?? inferVoltage(name),
      currentMa: rail?.currentMa ?? catalog.currentMa ?? 500,
      connectorRule: /USB|VUSB/.test(name) ? 'USB-C connector must stay on edge with CC resistors and ESD nearby' : 'power input connector must stay serviceable at board edge',
      protection: /BAT|VIN|POE/.test(name) ? ['reverse polarity / surge review', 'input fuse or current limiting review'] : ['USB ESD and VBUS inrush review'],
    }
  })
}

function planRegulators(sources, rails, components) {
  const source = sources[0] || { name: 'VUSB', voltage: 5 }
  return rails
    .filter((rail) => rail.kind === 'regulated' && rail.name !== source.name && rail.voltage > 0)
    .map((rail) => {
      const regulatorComponent = components.find((component) => {
        const text = `${component.group || ''} ${component.value || ''} ${component.ref || ''}`
        const railTokens = [rail.name, rail.name.replace(/V/g, ''), rail.name.replace(/V/, '.')]
        return /(REGULATOR|LDO|BUCK|PMIC)/i.test(text) && railTokens.some((token) => token && text.toUpperCase().includes(String(token).toUpperCase()))
      })
      const explicitBuck = /BUCK|DC-DC|DCDC|SWITCH/i.test(`${regulatorComponent?.group || ''} ${regulatorComponent?.value || ''}`)
      const dropout = Math.max(0, Number(source.voltage || 0) - Number(rail.voltage || 0))
      const lossMwLinear = Math.round(dropout * rail.requiredCurrentMa)
      const buckRecommended = lossMwLinear > 350 || rail.requiredCurrentMa > 250 || Number(source.voltage || 0) > 6
      const estimatedLossMw = explicitBuck ? Math.round(Number(rail.voltage || 0) * rail.requiredCurrentMa * 0.08 / 100) : lossMwLinear
      return {
        ref: regulatorComponent?.ref || suggestedRegRef(rail.name),
        rail: rail.name,
        inputRail: source.name,
        outputVoltage: rail.voltage,
        requiredCurrentMa: rail.requiredCurrentMa,
        topology: explicitBuck ? 'buck regulator selected' : buckRecommended ? 'buck regulator recommended' : 'low-noise LDO acceptable if thermal review passes',
        estimatedLinearLossMw: lossMwLinear,
        estimatedSelectedLossMw: estimatedLossMw,
        thermalRisk: estimatedLossMw > 700 ? 'high' : estimatedLossMw > 350 ? 'medium' : 'low',
        placementRules: [
          'input capacitor within 2 mm of regulator input pin',
          'output capacitor within 2 mm of regulator output pin',
          'keep switch node compact and away from antenna/sensor keepouts',
        ],
      }
    })
}

function planDecoupling(components) {
  return components
    .filter((component) => /(MCU|ESP32|WROOM|PHY|SENSOR|IMU|BAROMETER|FLASH|REGULATOR|POE)/i.test(`${component.group || ''} ${component.value || ''}`))
    .map((component) => ({
      ref: component.ref,
      required: /(REGULATOR|POE)/i.test(`${component.group || ''} ${component.value || ''}`) ? ['input bulk cap', 'output bulk cap', '100nF local bypass'] : ['100nF local bypass', 'nearby bulk capacitor when current spikes'],
      placementRule: 'place decoupling on same side as IC when possible with short ground return',
    }))
}

function buildPowerConstraints(rails, regulators, decoupling) {
  return {
    railClasses: rails.filter((rail) => rail.name !== 'GND').map((rail) => ({
      net: rail.name,
      minimumTraceWidthMm: rail.requiredCurrentMa > 1000 ? 0.8 : rail.requiredCurrentMa > 500 ? 0.5 : rail.requiredCurrentMa > 150 ? 0.3 : 0.18,
      preferCopperPour: rail.copperPourRecommended,
      reviewCurrentMa: rail.requiredCurrentMa,
    })),
    regulatorPlacement: regulators.flatMap((regulator) => regulator.placementRules.map((rule) => ({ ref: regulator.ref, rule }))),
    decouplingPlacement: decoupling.map((item) => ({ ref: item.ref, rule: item.placementRule })),
    sensitiveKeepouts: [
      { kind: 'rf', rule: 'no switching regulator inductor/switch node under antenna keepout' },
      { kind: 'sensor', rule: 'keep hot regulators and high-current copper away from precision sensors' },
    ],
  }
}

function planSequencing(rails, components) {
  const hasMcu = components.some((component) => /(MCU|ESP32|WROOM|STM32)/i.test(`${component.group || ''} ${component.value || ''}`))
  return {
    required: hasMcu,
    rules: [
      ...(hasMcu ? ['3V3 must be stable before MCU reset release', 'BOOT/EN pull-ups require ERC review'] : []),
      ...(rails.some((rail) => rail.name === '1V8') ? ['1V8 sequencing must match component datasheets'] : []),
      'all enable pins require explicit pull state or ERC waiver',
    ],
  }
}

function planThermalReview(regulators) {
  return regulators.map((regulator) => ({
    ref: regulator.ref,
    rail: regulator.rail,
    thermalRisk: regulator.thermalRisk,
    estimatedLinearLossMw: regulator.estimatedLinearLossMw,
    action: regulator.thermalRisk === 'high' ? 'use buck regulator, copper spreading, and keepout from sensors/RF' : 'verify copper area and component temperature rise',
  }))
}

function blockers(input, rails, sources, regulators) {
  const errors = []
  if (!sources.length) errors.push(issue('ERROR', 'POWER_INPUT_MISSING', 'No power input rail was identified.'))
  for (const rail of rails) {
    if (rail.currentMa && rail.requiredCurrentMa > rail.currentMa) errors.push(issue('ERROR', 'RAIL_CURRENT_UNDERSIZED', `${rail.name} requires ${rail.requiredCurrentMa} mA with margin but only ${rail.currentMa} mA is budgeted.`, { rail: rail.name }))
  }
  for (const regulator of regulators) {
    if (regulator.thermalRisk === 'high' && !input.approveHighThermalRisk) errors.push(issue('ERROR', 'REGULATOR_THERMAL_REVIEW_REQUIRED', `${regulator.ref} on ${regulator.rail} has high estimated loss; approveHighThermalRisk or select a buck topology.`, { ref: regulator.ref, rail: regulator.rail }))
  }
  return errors
}

function warningsFor(input, rails, regulators, decoupling) {
  return [
    ...(input.powerInput ? [] : [issue('WARNING', 'POWER_INPUT_ASSUMED', 'Power input was not explicit; BoardForge assumed VUSB/input-derived rails.')]),
    ...rails.filter((rail) => rail.loadCurrentMa === 0 && rail.kind !== 'return').map((rail) => issue('WARNING', 'RAIL_HAS_NO_LOADS', `${rail.name} has no inferred loads; verify if it is required.`, { rail: rail.name })),
    ...regulators.filter((regulator) => regulator.thermalRisk === 'medium').map((regulator) => issue('WARNING', 'REGULATOR_THERMAL_REVIEW', `${regulator.ref} on ${regulator.rail} has medium thermal risk.`, { ref: regulator.ref })),
    ...(decoupling.length ? [] : [issue('WARNING', 'DECOUPLING_NOT_INFERRED', 'No IC decoupling requirements were inferred; verify component groups and pin maps.')]),
  ]
}

function inferVoltage(name) {
  const match = String(name).match(/(\d+)V(\d*)/)
  if (!match) return 0
  return Number(`${match[1]}.${match[2] || 0}`)
}

function suggestedRegRef(rail) {
  return `REG_${String(rail).replace(/[^A-Z0-9]/gi, '')}`
}

function issue(severity, code, message, data = {}) {
  return { severity, code, message, ...data }
}
