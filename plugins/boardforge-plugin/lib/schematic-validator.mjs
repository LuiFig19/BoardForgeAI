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
    if (isSupply(net.name) && net.pins?.length < 2) errors.push(issue('ERROR', 'SUPPLY_NET_HAS_TOO_FEW_PINS', `${net.name} has fewer than two mapped pins.`, { net: net.name, pinCount: net.pins?.length || 0 }))
    if (/USB_(DP|DN)|CAN[HL]|RS485_[AB]|ETH_.*_[PN]|MIPI.*_[PN]|PCIE.*_[PN]/i.test(net.name) && net.pins?.length < 2) warnings.push(issue('WARNING', 'CRITICAL_NET_ENDPOINT_REVIEW', `${net.name} needs source and destination pins before routing.`, { net: net.name }))
  }
  const differentialPairs = diffPairReview(netlist.nets || [])
  errors.push(...differentialPairs.filter((item) => item.severity === 'ERROR'))
  warnings.push(...differentialPairs.filter((item) => item.severity === 'WARNING'))
  return {
    schemaVersion: 1,
    status: errors.length ? 'SCHEMATIC_GRAPH_NEEDS_FIX' : warnings.length ? 'SCHEMATIC_GRAPH_NEEDS_REVIEW' : 'SCHEMATIC_GRAPH_READY_NEEDS_ERC',
    componentCount: components.length,
    netCount: netlist.nets?.length || 0,
    netlist,
    differentialPairs,
    warnings,
    errors,
    nextActions: nextActions(errors, warnings),
    humanReviewRequired: true,
  }
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
