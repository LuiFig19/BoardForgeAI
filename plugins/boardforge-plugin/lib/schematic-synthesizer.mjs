import { assignNetsToClasses } from './net-classes.mjs'
import { planPinAssignments } from './pin-assignment-planner.mjs'
import { planPowerTree } from './power-tree-planner.mjs'

export function synthesizeSchematicDesign({ board = {}, components = [], nets = [], interfaces = [], input = {} } = {}) {
  const normalizedComponents = normalizeComponents(components)
  const normalizedNets = assignNetsToClasses(normalizeNets([...nets, ...(input.nets || [])]))
  const pinAssignments = planPinAssignments({ components: normalizedComponents, nets: normalizedNets, interfaces, input })
  const withPinMaps = applyPinAssignments(normalizedComponents, pinAssignments.assignments)
  const support = addSupportComponents(withPinMaps, normalizedNets, input)
  const allComponents = [...withPinMaps, ...support.components]
  const allNets = assignNetsToClasses(normalizeNets([...normalizedNets, ...support.nets]))
  const powerTree = planPowerTree({ ...input, board, components: allComponents, nets: allNets })
  const graph = buildGraph(allComponents, allNets)
  const issues = [
    ...pinAssignments.errors,
    ...pinAssignments.warnings,
    ...support.warnings,
    ...powerTree.errors,
    ...powerTree.warnings,
    ...graphWarnings(graph),
  ]
  const blockers = issues.filter((issue) => issue.severity === 'ERROR')
  const status = blockers.length
    ? 'SCHEMATIC_SYNTHESIS_BLOCKED'
    : issues.some((issue) => issue.severity === 'WARNING')
      ? 'SCHEMATIC_SYNTHESIS_NEEDS_REVIEW'
      : 'SCHEMATIC_SYNTHESIS_READY_NEEDS_ERC'
  return {
    schemaVersion: 1,
    status,
    board: { name: board.name || input.projectName || 'BoardForge board', layerCount: board.layerCount || input.layerCount || 2 },
    components: allComponents,
    nets: allNets,
    graph,
    pinAssignments,
    powerTree,
    supportComponents: support.components,
    warnings: issues.filter((issue) => issue.severity === 'WARNING'),
    errors: blockers,
    actions: recommendedActions(status, issues),
    manufacturingGates: {
      requireErcBeforePlacement: true,
      requireDrcBeforeExport: true,
      requireFootprintBindingReview: allComponents.some((component) => !component.footprint || !component.symbol),
      requirePowerTreeReview: powerTree.status !== 'POWER_TREE_READY_NEEDS_REVIEW',
    },
    humanReviewRequired: true,
  }
}

function normalizeComponents(components) {
  return (components || []).filter(Boolean).map((component, index) => ({
    ref: component.ref || suggestedRef(component.group, index),
    group: component.group || inferGroup(component),
    value: component.value || component.mpn || component.group || 'component',
    role: component.role || null,
    symbol: component.symbol?.libId || component.symbol || null,
    footprint: component.footprint?.libId || component.footprint || null,
    model3d: component.model3d || null,
    x: component.x,
    y: component.y,
    width: component.width,
    height: component.height,
    rotation: component.rotation || 0,
    pinMap: component.pinMap || {},
    netA: component.netA || null,
    netB: component.netB || null,
    currentMa: component.currentMa,
    mpn: component.mpn,
  }))
}

function normalizeNets(nets) {
  const byName = new Map()
  for (const item of nets || []) {
    const net = typeof item === 'string' ? { name: item } : item
    if (!net?.name) continue
    byName.set(net.name, { ...byName.get(net.name), ...net, name: net.name })
  }
  return [...byName.values()]
}

function applyPinAssignments(components, assignments) {
  const byRef = new Map((assignments || []).map((assignment) => [assignment.ref, assignment]))
  return components.map((component) => {
    const planned = byRef.get(component.ref)
    const pinMap = Object.keys(component.pinMap || {}).length ? component.pinMap : planned?.pinMap || fallbackPinMap(component)
    return { ...component, pinMap }
  })
}

function addSupportComponents(components, nets, input) {
  const added = []
  const addedNets = []
  const warnings = []
  const refs = new Set(components.map((component) => component.ref))
  const hasNet = (name) => nets.some((net) => net.name === name) || addedNets.some((net) => net.name === name)
  const nextRef = (prefix) => {
    let index = 1
    while (refs.has(`${prefix}${index}`)) index += 1
    refs.add(`${prefix}${index}`)
    return `${prefix}${index}`
  }
  for (const component of components) {
    const text = `${component.group || ''} ${component.value || ''}`
    if (/(ESP32|STM32|MCU|PROCESSOR|ETHERNET_PHY|IMU|BAROMETER|FLASH)/i.test(text)) {
      added.push(support(nextRef('C'), 'CAP', '100nF decoupling', '3V3', 'GND', component.ref))
      if (!hasNet('3V3')) addedNets.push({ name: '3V3' })
      if (!hasNet('GND')) addedNets.push({ name: 'GND' })
    }
    if (/ESP32/i.test(text)) {
      added.push(support(nextRef('R'), 'RES', '10k EN pull-up', 'EN', '3V3', component.ref))
      added.push(support(nextRef('R'), 'RES', '10k BOOT pull-up', 'BOOT', '3V3', component.ref))
      added.push(support(nextRef('C'), 'CAP', '1uF EN reset capacitor', 'EN', 'GND', component.ref))
      for (const name of ['EN', 'BOOT']) if (!hasNet(name)) addedNets.push({ name })
    }
    if (/USB/i.test(text)) {
      added.push(support(nextRef('R'), 'RES', '5.1k USB-C CC1 pulldown', 'CC1', 'GND', component.ref))
      added.push(support(nextRef('R'), 'RES', '5.1k USB-C CC2 pulldown', 'CC2', 'GND', component.ref))
      added.push(support(nextRef('D'), 'TVS', 'USB ESD array', 'USB_DP', 'USB_DN', component.ref))
      for (const name of ['USB_DP', 'USB_DN', 'CC1', 'CC2', 'VUSB']) if (!hasNet(name)) addedNets.push({ name })
    }
    if (/(REGULATOR|LDO|BUCK)/i.test(text)) {
      added.push(support(nextRef('C'), 'CAP', '10uF regulator input', 'VIN', 'GND', component.ref))
      added.push(support(nextRef('C'), 'CAP', '10uF regulator output', '3V3', 'GND', component.ref))
      if (!hasNet('VIN') && !hasNet('VUSB')) addedNets.push({ name: input.powerInput || 'VIN' })
    }
  }
  if (!components.some((component) => /(REGULATOR|LDO|BUCK|PMIC)/i.test(`${component.group || ''} ${component.value || ''}`)) && hasNet('3V3')) {
    warnings.push(issue('WARNING', 'REGULATOR_NOT_PRESENT', '3V3 is used but no regulator/PMIC component was identified.'))
  }
  return { components: added, nets: addedNets, warnings }
}

function support(ref, group, value, netA, netB, supportsRef) {
  return {
    ref,
    group,
    value,
    role: 'support_component',
    supportsRef,
    netA,
    netB,
    pinMap: group === 'TVS' ? { 1: netA, 2: netB, 3: 'GND' } : { 1: netA, 2: netB },
    width: group === 'CAP' || group === 'RES' ? 1.6 : 3,
    height: group === 'CAP' || group === 'RES' ? 0.8 : 2,
  }
}

function buildGraph(components, nets) {
  const nodes = components.map((component) => ({
    ref: component.ref,
    group: component.group,
    value: component.value,
    pinCount: Object.keys(component.pinMap || {}).filter((pin) => component.pinMap[pin]).length,
  }))
  const edges = []
  const byNet = new Map()
  for (const component of components) {
    for (const [pin, net] of Object.entries(component.pinMap || {})) {
      if (!net) continue
      const entry = byNet.get(net) || []
      entry.push({ ref: component.ref, pin })
      byNet.set(net, entry)
    }
  }
  for (const net of nets) {
    const pins = byNet.get(net.name) || []
    edges.push({ net: net.name, className: net.className || 'DEFAULT', pinCount: pins.length, pins })
  }
  return {
    nodes,
    edges,
    connectivity: {
      connectedNets: edges.filter((edge) => edge.pinCount >= 2).length,
      weakNets: edges.filter((edge) => edge.pinCount < 2).map((edge) => edge.net),
      floatingComponents: nodes.filter((node) => node.pinCount === 0).map((node) => node.ref),
    },
  }
}

function graphWarnings(graph) {
  return [
    ...graph.connectivity.weakNets.map((net) => issue('WARNING', 'NET_HAS_FEWER_THAN_TWO_PINS', `${net} has fewer than two connected pins.`, { net })),
    ...graph.connectivity.floatingComponents.map((ref) => issue('WARNING', 'COMPONENT_HAS_NO_CONNECTED_PINS', `${ref} has no connected pins in the synthesized schematic graph.`, { ref })),
  ]
}

function fallbackPinMap(component) {
  if (component.netA || component.netB) return { 1: component.netA || null, 2: component.netB || null }
  if (component.group === 'CAP') return { 1: '3V3', 2: 'GND' }
  if (component.group === 'RES') return { 1: null, 2: null }
  return {}
}

function recommendedActions(status, issues) {
  const actions = []
  const codes = new Set(issues.map((issue) => issue.code))
  if (status === 'SCHEMATIC_SYNTHESIS_BLOCKED') actions.push({ command: 'plan_requirements', reason: 'Resolve missing controller, power, or pin-assignment blockers before KiCad schematic generation.' })
  if (codes.has('REGULATOR_NOT_PRESENT')) actions.push({ command: 'plan_power_tree', reason: 'Select a regulator/PMIC and rerun schematic synthesis.' })
  actions.push({ command: 'generate_schematic', reason: 'Write the synthesized component/pin/net graph into KiCad schematic form.' })
  actions.push({ command: 'run_kicad_erc', reason: 'KiCad ERC is mandatory after schematic synthesis.' })
  return actions
}

function suggestedRef(group, index) {
  const prefix = { CAP: 'C', RES: 'R', USB: 'J', RJ45: 'J', SENSOR_CONNECTOR: 'J', ESC_CONNECTOR: 'J', REGULATOR: 'U', MCU: 'U', ESP32_S3: 'U' }[group] || 'U'
  return `${prefix}${index + 1}`
}

function inferGroup(component) {
  const text = `${component.ref || ''} ${component.value || ''} ${component.mpn || ''}`
  if (/usb/i.test(text)) return 'USB'
  if (/rj45|ethernet/i.test(text)) return 'RJ45'
  if (/esp32/i.test(text)) return 'ESP32_S3'
  if (/stm32|mcu/i.test(text)) return 'MCU'
  if (/regulator|ldo|buck/i.test(text)) return 'REGULATOR'
  if (/cap|uf|nf/i.test(text)) return 'CAP'
  if (/res|ohm|k$/i.test(text)) return 'RES'
  return 'GENERIC'
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
