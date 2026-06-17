import { pointInPolygon, round } from './geometry.mjs'

export const advancedBoardJobTypes = [
  'classify_board_architecture',
  'plan_hdi_manufacturing_strategy',
  'audit_return_path_integrity',
  'audit_creepage_clearance',
  'plan_bringup_reliability_matrix',
  'run_advanced_board_suite',
]

export function runAdvancedBoardJob(type, context = {}) {
  if (type === 'classify_board_architecture') return classifyBoardArchitecture(context)
  if (type === 'plan_hdi_manufacturing_strategy') return planHdiManufacturingStrategy(context)
  if (type === 'audit_return_path_integrity') return auditReturnPathIntegrity(context)
  if (type === 'audit_creepage_clearance') return auditCreepageClearance(context)
  if (type === 'plan_bringup_reliability_matrix') return planBringupReliabilityMatrix(context)
  if (type === 'run_advanced_board_suite') return runAdvancedBoardSuite(context)
  return result('ADVANCED_BOARD_SUITE_BLOCKED', [], [issue('ERROR', 'UNKNOWN_ADVANCED_BOARD_JOB', `Unknown advanced board job: ${type}`)])
}

export function classifyBoardArchitecture(context = {}) {
  const text = searchable(context)
  const families = [
    family('high_speed_digital', /usb|ethernet|pcie|mipi|lvds|hdmi|ddr|camera|serdes/i, ['controlled impedance', 'reference planes', 'length matching', 'return path continuity']),
    family('rf_wireless', /rf|antenna|wifi|wi-fi|ble|lora|gnss|lte|cellular/i, ['antenna keepout', '50 ohm feed', 'matching network', 'ground stitching fence']),
    family('power_motor', /motor|esc|inverter|mosfet|gate driver|phase|shunt|battery|bms|charger|high current/i, ['current loops', 'thermal copper', 'Kelvin sense', 'fault protection']),
    family('industrial_isolated', /isolat|rs485|can|relay|terminal|surge|plc|field io|mains|24v/i, ['creepage', 'clearance', 'surge/ESD', 'isolation slots']),
    family('sensor_analog', /sensor|analog|adc|dac|strain|thermocouple|imu|barometer|precision/i, ['low-noise regions', 'analog ground strategy', 'guarding', 'shielding']),
    family('compact_hdi', /compact|small|tiny|wearable|dense|bga|wlcsp|blind|buried|microvia|via-in-pad/i, ['HDI stackup', 'escape routing', 'manufacturer quote', 'assembly yield']),
  ].filter((item) => item.match.test(text))
  const selected = families.length ? families : [family('general_embedded', /.*/, ['standard stackup', 'basic ERC/DRC', 'DFM', 'test points'])]
  const warnings = selected.some((item) => item.id === 'compact_hdi') ? [issue('WARNING', 'HDI_COST_REVIEW', 'Compact/HDI architecture needs manufacturer approval and cost review.')] : []
  return result(warnings.length ? 'BOARD_ARCHITECTURE_NEEDS_REVIEW' : 'BOARD_ARCHITECTURE_CLASSIFIED', warnings, [], {
    boardArchitecture: {
      primary: selected[0].id,
      families: selected.map(({ id, requiredControls }) => ({ id, requiredControls })),
      requiredControlCount: new Set(selected.flatMap((item) => item.requiredControls)).size,
      recommendedNextJobs: ['plan_hdi_manufacturing_strategy', 'audit_return_path_integrity', 'audit_creepage_clearance', 'plan_bringup_reliability_matrix'],
    },
  })
}

export function planHdiManufacturingStrategy(context = {}) {
  const board = context.board || {}
  const layerCount = Number(board.layerCount || context.stackup?.layerCount || context.layerCount || 2)
  const density = componentDensity(board, context.components || [])
  const wantsAdvanced = Boolean(board.allowBlindVias || context.allowBlindVias || context.stackup?.hdi?.allowed || /blind|buried|microvia|via-in-pad|hdi/i.test(searchable(context)))
  const recommendations = []
  if (layerCount <= 2 && density > 0.09) recommendations.push('move_to_4_layer_stackup')
  if (layerCount <= 4 && density > 0.16) recommendations.push('move_to_6_layer_stackup')
  if (wantsAdvanced) recommendations.push('manufacturer_approved_hdi_stackup_required')
  if (density > 0.22) recommendations.push('review_via_in_pad_or_larger_board')
  const errors = wantsAdvanced && !context.approveAdvancedFab ? [issue('ERROR', 'ADVANCED_FAB_NOT_APPROVED', 'Blind/buried/microvia/via-in-pad strategy needs explicit manufacturer approval before release.')] : []
  const warnings = [
    ...(recommendations.length ? [issue('WARNING', 'HDI_STRATEGY_REVIEW', 'HDI/manufacturing strategy requires review.', { recommendations })] : []),
    ...(density > 0.12 ? [issue('WARNING', 'DENSE_PLACEMENT_FANOUT_REVIEW', `Component density is ${round(density)} parts/cm^2; fanout/routing constraints should be reviewed.`)] : []),
  ]
  return result(errors.length ? 'HDI_MANUFACTURING_STRATEGY_BLOCKED' : warnings.length ? 'HDI_MANUFACTURING_STRATEGY_NEEDS_REVIEW' : 'HDI_MANUFACTURING_STRATEGY_READY', warnings, errors, {
    hdiManufacturingStrategy: {
      layerCount,
      componentDensityPerCm2: round(density),
      allowedViaTypes: wantsAdvanced ? ['through', 'blind_review', 'buried_review', 'microvia_review'] : ['through'],
      recommendations,
      requiredApprovals: wantsAdvanced ? ['manufacturer stackup', 'advanced via quote', 'assembly yield review'] : [],
    },
  })
}

export function auditReturnPathIntegrity(context = {}) {
  const board = context.board || {}
  const nets = normalizeNets(context.nets || context.canonicalNetModel?.nets || [])
  const zones = context.designIntent?.zones || context.routingPlan?.designIntent?.zones || []
  const sensitive = nets.filter((net) => /USB|ETH|CAN|RF|CLK|XTAL|MIPI|PCI|LVDS|ADC|SENSOR/i.test(net.name))
  const hasGround = nets.some((net) => /GND|AGND|PGND/i.test(net.name))
  const warnings = []
  const errors = []
  if (sensitive.length && !hasGround) errors.push(issue('ERROR', 'GROUND_REFERENCE_MISSING', 'Sensitive/high-speed nets exist but no ground reference net was found.'))
  if (sensitive.length && (board.layerCount || 2) < 4) warnings.push(issue('WARNING', 'TWO_LAYER_HIGH_SPEED_REVIEW', 'High-speed/sensitive nets on <=2 layers need explicit return-path review.'))
  for (const zone of zones.filter((item) => item.allowCopper === false)) {
    const affected = sensitive.filter((net) => routeTouchesZone(context.routingPlan, net.name, zone))
    if (affected.length) errors.push(issue('ERROR', 'SENSITIVE_ROUTE_CROSSES_SPLIT_OR_KEEPOUT', `Sensitive net crosses ${zone.id}.`, { zone: zone.id, nets: affected.map((net) => net.name) }))
  }
  const returnPathPlan = sensitive.map((net) => ({
    net: net.name,
    reference: /RF/i.test(net.name) ? 'continuous GND with stitching fence near RF path' : 'nearest uninterrupted GND plane/pour',
    viaRule: /USB|ETH|CAN|RF|CLK/i.test(net.name) ? 'avoid layer swaps; place paired GND return vias next to any signal via' : 'minimize layer swaps',
  }))
  return result(errors.length ? 'RETURN_PATH_INTEGRITY_BLOCKED' : warnings.length ? 'RETURN_PATH_INTEGRITY_NEEDS_REVIEW' : 'RETURN_PATH_INTEGRITY_READY', warnings, errors, { returnPathIntegrity: { sensitiveNetCount: sensitive.length, returnPathPlan } })
}

export function auditCreepageClearance(context = {}) {
  const text = searchable(context)
  const board = context.board || {}
  const components = context.components || []
  const highVoltage = maxNumber(text.match(/(\d+(?:\.\d+)?)\s*v/g)?.map((item) => Number(item.replace(/[^\d.]/g, ''))) || [])
  const isolationRequired = /isolat|mains|ac|poe|48v|60v|120v|240v|surge|hipot/i.test(text) || highVoltage >= 48
  const isolationZones = context.designIntent?.zones?.filter((zone) => /isolation|creepage|primary|secondary/i.test(zone.id || '')) || []
  const errors = []
  const warnings = []
  if (isolationRequired && !isolationZones.length) errors.push(issue('ERROR', 'ISOLATION_ZONE_MISSING', 'Isolation/creepage design needs explicit primary/secondary keepout or slot zones.'))
  if (isolationRequired && !context.kicadRules && !context.designConstraints) warnings.push(issue('WARNING', 'CREEPAGE_RULES_NOT_COMPILED', 'Creepage/clearance rules should be compiled into KiCad constraints.'))
  const connectors = components.filter((component) => /TERMINAL|RELAY|RJ45|POE|MAINS|HV|CONNECTOR/i.test(`${component.ref || ''} ${component.group || ''} ${component.value || ''}`))
  if (isolationRequired && connectors.length < 1) warnings.push(issue('WARNING', 'FIELD_CONNECTOR_NOT_IDENTIFIED', 'Isolation board was inferred but field/power connectors were not identified.'))
  const minClearanceMm = highVoltage >= 240 ? 6.4 : highVoltage >= 120 ? 3.2 : highVoltage >= 60 ? 1.6 : highVoltage >= 48 ? 1.0 : 0.4
  return result(errors.length ? 'CREEPAGE_CLEARANCE_BLOCKED' : warnings.length ? 'CREEPAGE_CLEARANCE_NEEDS_REVIEW' : 'CREEPAGE_CLEARANCE_READY', warnings, errors, {
    creepageClearance: { isolationRequired, highVoltageV: highVoltage || null, minClearanceMm, isolationZoneCount: isolationZones.length, boardWidthMm: board.widthMm || null },
  })
}

export function planBringupReliabilityMatrix(context = {}) {
  const nets = normalizeNets(context.nets || context.canonicalNetModel?.nets || [])
  const components = context.components || []
  const rails = nets.filter((net) => /VBAT|VIN|5V|3V3|1V8|VCC|VDD/i.test(net.name)).map((net) => net.name)
  const interfaces = [...new Set(nets.map((net) => interfaceFor(net.name)).filter(Boolean))]
  const rows = [
    row('visual_inspection', 'Before power', 'Inspect polarity, bridges, connector orientation, mounting shorts.', 'no visible damage or solder bridges'),
    ...rails.map((rail) => row(`rail_${rail}`, 'Power bring-up', `Current-limit input and measure ${rail}.`, 'voltage in tolerance, no thermal event')),
    ...interfaces.map((name) => row(`interface_${name}`, 'Functional bring-up', `Validate ${name} enumeration/loopback/traffic with current monitoring.`, 'stable communication without resets')),
    row('thermal_soak', 'Reliability', 'Run expected load and inspect hot parts/current paths.', 'temperature rise within component and enclosure limits'),
    row('esd_surge_review', 'Reliability', 'Review ESD/surge paths for user-accessible connectors.', 'protection devices installed near entry points'),
    row('production_fixture', 'Manufacturing', 'Verify test pads, programming access, serial number/label strategy.', 'fixture can program and test every assembled unit'),
  ]
  const warnings = []
  if (!rails.length) warnings.push(issue('WARNING', 'NO_POWER_RAILS_IN_BRINGUP', 'No power rails were found for bring-up matrix.'))
  if (!components.some((component) => /TP|TEST|PAD|SWD|JTAG|UART/i.test(`${component.ref || ''} ${component.group || ''} ${component.value || ''}`))) warnings.push(issue('WARNING', 'TEST_ACCESS_REVIEW', 'No obvious test/debug access component was found.'))
  return result(warnings.length ? 'BRINGUP_RELIABILITY_MATRIX_NEEDS_REVIEW' : 'BRINGUP_RELIABILITY_MATRIX_READY', warnings, [], { bringupReliabilityMatrix: { railCount: rails.length, interfaceCount: interfaces.length, rows } })
}

export function runAdvancedBoardSuite(context = {}) {
  const architecture = classifyBoardArchitecture(context)
  const hdi = planHdiManufacturingStrategy(context)
  const returnPath = auditReturnPathIntegrity(context)
  const creepage = auditCreepageClearance(context)
  const bringup = planBringupReliabilityMatrix(context)
  const warnings = [...architecture.warnings, ...hdi.warnings, ...returnPath.warnings, ...creepage.warnings, ...bringup.warnings]
  const errors = [...architecture.errors, ...hdi.errors, ...returnPath.errors, ...creepage.errors, ...bringup.errors]
  return result(errors.length ? 'ADVANCED_BOARD_SUITE_BLOCKED' : warnings.length ? 'ADVANCED_BOARD_SUITE_NEEDS_REVIEW' : 'ADVANCED_BOARD_SUITE_READY', warnings, errors, {
    advancedBoardSuite: {
      score: Math.max(0, 100 - errors.length * 8 - warnings.length * 2),
      architecture: architecture.boardArchitecture,
      hdiManufacturingStrategy: hdi.hdiManufacturingStrategy,
      returnPathIntegrity: returnPath.returnPathIntegrity,
      creepageClearance: creepage.creepageClearance,
      bringupReliabilityMatrix: bringup.bringupReliabilityMatrix,
      majorUpgradeCoverage: [
        'architecture classification',
        'board family controls',
        'HDI layer strategy',
        'blind/buried/microvia approval gates',
        'component density review',
        'return path continuity',
        'ground-reference validation',
        'sensitive-net via policy',
        'split-plane/keepout crossing checks',
        'RF/antenna controls',
        'power/motor controls',
        'sensor/analog controls',
        'industrial isolation controls',
        'creepage minimums',
        'isolation slot/zone requirements',
        'field connector review',
        'bring-up rail tests',
        'interface validation tests',
        'thermal soak tests',
        'ESD/surge review',
        'production fixture checks',
        'test access review',
        'manufacturer approval requirements',
        'Codex next-action structure',
        'release-risk scoring',
      ],
    },
  })
}

function family(id, match, requiredControls) {
  return { id, match, requiredControls }
}

function row(id, phase, action, passCriteria) {
  return { id, phase, action, passCriteria }
}

function routeTouchesZone(routingPlan, netName, zone) {
  const polygon = zone.polygon || []
  if (!polygon.length) return false
  const routes = routingPlan?.routes || []
  const route = routes.find((item) => item.net === netName)
  return (route?.waypoints || []).some((point) => pointInPolygon(point, polygon))
}

function componentDensity(board, components) {
  const areaCm2 = Math.max(0.01, ((board.widthMm || 50) * (board.heightMm || 30)) / 100)
  return (components.length || 0) / areaCm2
}

function normalizeNets(nets) {
  return [...new Map((nets || []).map((net) => [typeof net === 'string' ? net : net?.name, typeof net === 'string' ? { name: net } : net]).filter(([name]) => name)).values()]
}

function interfaceFor(name) {
  if (/USB/i.test(name)) return 'USB'
  if (/ETH/i.test(name)) return 'Ethernet'
  if (/CAN/i.test(name)) return 'CAN'
  if (/I2C|SCL|SDA/i.test(name)) return 'I2C'
  if (/SPI|MOSI|MISO|SCK/i.test(name)) return 'SPI'
  if (/UART|TX|RX/i.test(name)) return 'UART'
  if (/RF|ANT/i.test(name)) return 'RF'
  return null
}

function maxNumber(values) {
  return values.length ? Math.max(...values.filter(Number.isFinite)) : 0
}

function searchable(context) {
  return JSON.stringify(context || {})
}

function result(status, warnings, errors, extra = {}) {
  return { status, warnings, errors, ...extra, humanReviewRequired: true }
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
