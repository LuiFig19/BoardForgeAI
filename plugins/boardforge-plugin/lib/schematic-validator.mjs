import { assignNetsToClasses } from './net-classes.mjs'
import { boardforgeNetlistFromComponents } from './schematic-generator.mjs'

const requiredSupport = {
  MCU: ['CAP', 'REGULATOR'],
  ESP32_S3: ['CAP', 'REGULATOR'],
  USB: ['TVS', 'RES'],
  ETHERNET_PHY: ['RJ45', 'CAP', 'CRYSTAL'],
  POE_FRONT_END: ['RJ45', 'REGULATOR', 'CAP'],
  GATE_DRIVER: ['MOSFET', 'SHUNT', 'CURRENT_SENSOR'],
  CHARGER_IC: ['THERMISTOR', 'PROTECTION_FET', 'CAP'],
}

export function validateSchematicGraph(input = {}) {
  const components = input.components || []
  const nets = assignNetsToClasses(input.nets || [])
  const netlist = input.netlist || boardforgeNetlistFromComponents(components, nets)
  const errors = []
  const warnings = [...(netlist.warnings || [])]
  if (!components.length) errors.push(issue('ERROR', 'SCHEMATIC_COMPONENTS_MISSING', 'No components were provided for schematic graph validation.'))
  const groups = new Set(components.map((component) => component.group).filter(Boolean))
  for (const component of components) {
    const pinMap = component.pinMap || {}
    if (!Object.keys(pinMap).length) warnings.push(issue('WARNING', 'PINMAP_MISSING', `${component.ref} has no pin map, so ERC intent is weak.`, { ref: component.ref }))
    if (requiresPower(component) && !hasPower(pinMap)) errors.push(issue('ERROR', 'POWER_PIN_UNMAPPED', `${component.ref} needs at least one mapped power pin.`, { ref: component.ref }))
    if (requiresGround(component) && !hasGround(pinMap)) errors.push(issue('ERROR', 'GROUND_PIN_UNMAPPED', `${component.ref} needs at least one mapped ground pin.`, { ref: component.ref }))
    for (const netName of Object.values(pinMap).filter(Boolean)) {
      if (!nets.some((net) => net.name === netName) && !netlist.nets?.some((net) => net.name === netName)) warnings.push(issue('WARNING', 'PIN_NET_NOT_DECLARED', `${component.ref} maps to ${netName}, but that net was not declared in the input nets.`, { ref: component.ref, net: netName }))
    }
  }
  for (const [group, supportGroups] of Object.entries(requiredSupport)) {
    if (!groups.has(group)) continue
    for (const required of supportGroups) {
      if (!groups.has(required)) warnings.push(issue('WARNING', 'SUPPORT_COMPONENT_REVIEW', `${group} design likely needs ${required} support component(s).`, { group, required }))
    }
  }
  for (const net of netlist.nets || []) {
    if (isSupply(net.name) && net.pins?.length === 1) errors.push(issue('ERROR', 'SUPPLY_NET_HAS_TOO_FEW_PINS', `${net.name} has only one mapped pin.`, { net: net.name, pinCount: net.pins?.length || 0 }))
    if (isSupply(net.name) && !net.pins?.length) warnings.push(issue('WARNING', 'DECLARED_SUPPLY_NET_UNUSED', `${net.name} was declared but has no mapped pins in the synthesized graph.`, { net: net.name }))
    if (/USB_(DP|DN)|CAN[HL]|RS485_[AB]|ETH_.*_[PN]|MIPI.*_[PN]|PCIE.*_[PN]/i.test(net.name) && net.pins?.length < 2) warnings.push(issue('WARNING', 'CRITICAL_NET_ENDPOINT_REVIEW', `${net.name} needs source and destination pins before routing.`, { net: net.name }))
  }
  const differentialPairs = diffPairReview(netlist.nets || [])
  const intent = validateIntent({ components, nets, netlist })
  errors.push(...differentialPairs.filter((item) => item.severity === 'ERROR'))
  errors.push(...intent.errors)
  warnings.push(...differentialPairs.filter((item) => item.severity === 'WARNING'))
  warnings.push(...intent.warnings)
  return {
    schemaVersion: 1,
    status: errors.length ? 'SCHEMATIC_GRAPH_NEEDS_FIX' : warnings.length ? 'SCHEMATIC_GRAPH_NEEDS_REVIEW' : 'SCHEMATIC_GRAPH_READY_NEEDS_ERC',
    componentCount: components.length,
    netCount: netlist.nets?.length || 0,
    netlist,
    differentialPairs,
    intent,
    warnings,
    errors,
    nextActions: nextActions(errors, warnings),
    humanReviewRequired: true,
  }
}

function validateIntent({ components, netlist }) {
  const errors = []
  const warnings = []
  const byGroup = new Map()
  for (const component of components) {
    const group = String(component.group || '').toUpperCase()
    const list = byGroup.get(group) || []
    list.push(component)
    byGroup.set(group, list)
  }
  const netByName = new Map((netlist.nets || []).map((net) => [net.name, net]))
  const hasRailLoad = ['3V3', '1V8'].some((name) => (netByName.get(name)?.pins?.length || 0) > 0)
  const hasRegulator = components.some((component) => /REGULATOR|LDO|BUCK|PMIC|DC.?DC/i.test(`${component.group || ''} ${component.value || ''}`))
  if (hasRailLoad && !hasRegulator) warnings.push(issue('WARNING', 'POWER_TREE_SOURCE_REVIEW', 'Low-voltage loads exist but no regulator/PMIC is present in the graph.'))
  for (const component of components) {
    if (/USB-C|TYPE-C|USB_C|TYPE_C/i.test(`${component.group || ''} ${component.value || ''} ${component.footprint || ''}`)) {
      const mapped = new Set(Object.values(component.pinMap || {}).filter(Boolean))
      const headerLike = /HEADER|PINHEADER|CONN_01X04/i.test(String(component.footprint || ''))
      if (!headerLike && (!mapped.has('CC1') || !mapped.has('CC2'))) warnings.push(issue('WARNING', 'USB_C_CC_RESISTOR_REVIEW', `${component.ref} needs CC1/CC2 intent and 5.1k Rd support for sink-mode USB-C.`, { ref: component.ref }))
      if ((mapped.has('USB_DP') || mapped.has('USB_DN')) && !components.some((item) => item.group === 'TVS' || /ESD|TVS/i.test(`${item.group || ''} ${item.value || ''}`))) warnings.push(issue('WARNING', 'USB_ESD_REVIEW', `${component.ref} carries USB data without an obvious ESD/TVS component.`, { ref: component.ref }))
    }
    if (requiresPower(component) && requiresGround(component)) {
      const decoupled = components.some((item) => item.group === 'CAP' && (item.supportsRef === component.ref || capTouchesSupplyAndGround(item)))
      if (/MCU|PROCESSOR|ESP32|STM32|ETHERNET_PHY|FPGA|ASIC|SENSOR|REGULATOR|PMIC/i.test(`${component.group || ''} ${component.value || ''}`) && !decoupled) {
        warnings.push(issue('WARNING', 'DECOUPLING_CAP_REVIEW', `${component.ref} should have local decoupling before layout.`, { ref: component.ref }))
      }
    }
  }
  for (const net of netlist.nets || []) {
    if (/USB_(DP|DN)|CAN[HL]|RS485_[AB]|ETH_.*_[PN]|MIPI.*_[PN]|PCIE.*_[PN]/i.test(net.name) && (net.pins?.length || 0) < 2) {
      errors.push(issue('ERROR', 'CRITICAL_NET_HAS_TOO_FEW_ENDPOINTS', `${net.name} is routing-critical and needs at least two mapped pins.`, { net: net.name, pinCount: net.pins?.length || 0 }))
    } else if (/SWCLK|SWDIO|SCL|SDA|NRST|BOOT0/i.test(net.name) && (net.pins?.length || 0) < 2) {
      warnings.push(issue('WARNING', 'CONTROL_NET_ENDPOINT_REVIEW', `${net.name} has fewer than two mapped pins; confirm debug/control intent before release.`, { net: net.name, pinCount: net.pins?.length || 0 }))
    }
  }
  return { status: errors.length ? 'SCHEMATIC_INTENT_BLOCKED' : warnings.length ? 'SCHEMATIC_INTENT_NEEDS_REVIEW' : 'SCHEMATIC_INTENT_READY', errors, warnings, supportGroups: [...byGroup.keys()] }
}

function capTouchesSupplyAndGround(component) {
  const nets = Object.values(component.pinMap || {}).filter(Boolean)
  return nets.some((net) => /3V3|5V|1V8|VDD|VCC|VIN|VUSB/i.test(net)) && nets.some((net) => /GND/i.test(net))
}

function diffPairReview(nets) {
  const names = new Set(nets.map((net) => net.name))
  const issues = []
  for (const net of nets) {
    const pair = pairName(net.name)
    if (pair && !names.has(pair)) issues.push(issue('ERROR', 'DIFF_PAIR_MEMBER_MISSING', `${net.name} is missing pair member ${pair}.`, { net: net.name, missing: pair }))
  }
  return issues
}

function pairName(name) {
  const replacements = [
    [/DP$/i, 'DN'],
    [/DN$/i, 'DP'],
    [/_P$/i, '_N'],
    [/_N$/i, '_P'],
    [/\+$/i, '-'],
    [/-$/i, '+'],
    [/CANH$/i, 'CANL'],
    [/CANL$/i, 'CANH'],
    [/RS485_A$/i, 'RS485_B'],
    [/RS485_B$/i, 'RS485_A'],
  ]
  const found = replacements.find(([pattern]) => pattern.test(name))
  return found ? name.replace(found[0], found[1]) : null
}

function requiresPower(component) {
  return !['RES', 'CAP', 'INDUCTOR', 'SHUNT', 'UNKNOWN'].includes(component.group)
}

function requiresGround(component) {
  return !['RES', 'INDUCTOR', 'SHUNT', 'UNKNOWN'].includes(component.group)
}

function hasPower(pinMap) {
  return Object.values(pinMap).some((net) => /3V3|5V|1V8|VIN|VBAT|VUSB|VCC|VDD|POE/i.test(net))
}

function hasGround(pinMap) {
  return Object.values(pinMap).some((net) => /GND/i.test(net))
}

function isSupply(name) {
  return /^(GND|3V3|5V|1V8|VIN|VBAT|VUSB|VCC|VDD|POE_VDD|POE_RTN)$/i.test(name)
}

function nextActions(errors, warnings) {
  if (errors.length) return ['Fix unmapped power/ground pins and missing differential-pair members before generating or routing KiCad files.', 'Run validate_component_bindings and generate_netlist after repairs.']
  if (warnings.length) return ['Review support components, pullups, protection, decoupling, and critical net endpoints before ERC.']
  return ['Generate schematic, run KiCad ERC, then proceed to placement/routing readiness.']
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
