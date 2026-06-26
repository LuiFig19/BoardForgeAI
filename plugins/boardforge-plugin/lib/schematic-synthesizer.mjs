import { assignNetsToClasses } from './net-classes.mjs'
import { planPinAssignments } from './pin-assignment-planner.mjs'
import { planPowerTree } from './power-tree-planner.mjs'
import { normalizeCanonicalPinMap } from './component-database.mjs'

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
  const architecture = architectureChecks(allComponents, allNets, graph, input)
  const issues = [
    ...pinAssignments.errors,
    ...pinAssignments.warnings,
    ...support.warnings,
    ...powerTree.errors,
    ...powerTree.warnings,
    ...graphWarnings(graph),
    ...architecture.errors,
    ...architecture.warnings,
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
    architecture,
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

function architectureChecks(components, nets, graph, input = {}) {
  const errors = []
  const warnings = []
  const netNames = new Set(nets.map((net) => net.name))
  const has = (pattern) => components.some((component) => pattern.test(`${component.group || ''} ${component.value || ''} ${component.role || ''}`))
  const outlineOnly = input.outlineOnly || input.mode === 'outline_only'
  if (!outlineOnly && components.length && !has(/MCU|PROCESSOR|ESP32|STM32|FPGA|CPLD|ASIC|CONTROLLER|GATE_DRIVER|ETHERNET_PHY|SENSOR|CONNECTOR/i)) {
    errors.push(issue('ERROR', 'CONTROLLER_OR_FUNCTION_BLOCK_MISSING', 'No controller, logic, connector, driver, or functional IC was identified for this schematic.'))
  }
  if (components.length && !netNames.has('GND') && !graph.edges.some((edge) => /^GND$/i.test(edge.net))) {
    errors.push(issue('ERROR', 'GROUND_NET_MISSING', 'A manufacturable schematic needs a declared and connected ground net.'))
  }
  const needsLowVoltage = graph.edges.some((edge) => /^(3V3|1V8)$/i.test(edge.net) && edge.pinCount > 0)
  const hasRegulator = has(/REGULATOR|LDO|BUCK|PMIC|DC.?DC/i)
  const hasPowerSource = graph.edges.some((edge) => /^(VIN|VBAT|VUSB|5V|POE_VDD)$/i.test(edge.net) && edge.pinCount > 0)
  if (needsLowVoltage && !hasRegulator) warnings.push(issue('WARNING', 'LOW_VOLTAGE_RAIL_WITHOUT_REGULATOR', 'Low-voltage rails are used but no regulator/PMIC was identified.', { rails: ['3V3', '1V8'].filter((rail) => netNames.has(rail)) }))
  if (needsLowVoltage && !hasPowerSource && !hasRegulator) warnings.push(issue('WARNING', 'POWER_SOURCE_INTENT_WEAK', 'No upstream power source or regulator path was identified for the low-voltage rail.'))
  const usbComponents = components.filter((component) => /USB-C|TYPE-C|USB_C|TYPE_C/i.test(`${component.group || ''} ${component.value || ''} ${component.footprint || ''}`))
  for (const component of usbComponents) {
    const mapped = new Set(Object.values(component.pinMap || {}).filter(Boolean))
    const headerLike = /HEADER|PINHEADER|CONN_01X04/i.test(String(component.footprint || '')) || component.usbConnectorMode === 'header' || input.usbConnectorMode === 'header'
    if (!headerLike && (!mapped.has('CC1') || !mapped.has('CC2'))) {
      warnings.push(issue('WARNING', 'USB_C_CC_INTENT_REVIEW', `${component.ref} looks like USB-C but CC1/CC2 are not both mapped.`, { ref: component.ref }))
    }
    if (!mapped.has('GND')) errors.push(issue('ERROR', 'USB_GROUND_MISSING', `${component.ref} needs a ground pin before routing or ERC.`, { ref: component.ref }))
  }
  const activeParts = components.filter((component) => /(MCU|PROCESSOR|ESP32|STM32|ETHERNET_PHY|FPGA|ASIC|SENSOR|REGULATOR|PMIC)/i.test(`${component.group || ''} ${component.value || ''}`))
  for (const component of activeParts) {
    const hasDecoupling = components.some((other) => other.ref !== component.ref && other.group === 'CAP' && (other.supportsRef === component.ref || localTwoTerminalSupply(other)))
    if (!hasDecoupling) warnings.push(issue('WARNING', 'LOCAL_DECOUPLING_REVIEW', `${component.ref} has no obvious local decoupling capacitor in the synthesized component set.`, { ref: component.ref }))
  }
  for (const edge of graph.edges) {
    if (/USB_(DP|DN)|CAN[HL]|RS485_[AB]|ETH_.*_[PN]|MIPI.*_[PN]|PCIE.*_[PN]/i.test(edge.net) && edge.pinCount < 2) {
      errors.push(issue('ERROR', 'ROUTING_CRITICAL_NET_UNCONNECTED', `${edge.net} needs at least two mapped endpoints before placement/routing.`, { net: edge.net, pinCount: edge.pinCount }))
    } else if (/SWCLK|SWDIO|SCL|SDA|NRST|BOOT0/i.test(edge.net) && edge.pinCount < 2) {
      warnings.push(issue('WARNING', 'LOW_SPEED_CONTROL_NET_ENDPOINT_REVIEW', `${edge.net} has fewer than two mapped endpoints; verify debug/control intent before release.`, { net: edge.net, pinCount: edge.pinCount }))
    }
  }
  return { status: errors.length ? 'ARCHITECTURE_BLOCKED' : warnings.length ? 'ARCHITECTURE_NEEDS_REVIEW' : 'ARCHITECTURE_READY', errors, warnings }
}

function localTwoTerminalSupply(component) {
  const nets = Object.values(component.pinMap || {}).filter(Boolean)
  return nets.some((net) => /3V3|5V|1V8|VDD|VCC|VIN|VUSB/i.test(net)) && nets.some((net) => /GND/i.test(net))
}

function normalizeComponents(components) {
  return (components || []).filter(Boolean).map((component, index) => ({
    ref: component.ref || suggestedRef(component.group, index),
    group: component.group || inferGroup(component),
    value: component.value || component.mpn || component.group || 'component',
    role: component.role || null,
    supportsRef: component.supportsRef || null,
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
    const pinMap = normalizeCanonicalPinMap(hasUsefulPinMap(component.pinMap) ? component.pinMap : planned?.pinMap || fallbackPinMap(component), component)
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
      const supplyNets = supplyNetsFor(component)
      for (const rail of supplyNets) {
        if (!hasLocalSupport([...components, ...added], 'CAP', rail, 'GND', component.ref)) {
          added.push(support(nextRef('C'), 'CAP', `100nF ${rail} local decoupling`, rail, 'GND', component.ref))
        }
      }
      if (/(MCU|ESP32|STM32|PROCESSOR|ETHERNET_PHY)/i.test(text) && !hasTwoTerminalSupport([...components, ...added], 'CAP', '3V3', 'GND')) {
        added.push(support(nextRef('C'), 'CAP', '4.7uF local bulk decoupling', '3V3', 'GND', component.ref))
      }
      if (!hasNet('3V3')) addedNets.push({ name: '3V3' })
      if (!hasNet('GND')) addedNets.push({ name: 'GND' })
    }
    if (/ESP32/i.test(text)) {
      if (!hasTwoTerminalSupport([...components, ...added], 'RES', 'EN', '3V3')) added.push(support(nextRef('R'), 'RES', '10k EN pull-up', 'EN', '3V3', component.ref))
      if (!hasTwoTerminalSupport([...components, ...added], 'RES', 'BOOT', '3V3')) added.push(support(nextRef('R'), 'RES', '10k BOOT pull-up', 'BOOT', '3V3', component.ref))
      if (!hasTwoTerminalSupport([...components, ...added], 'CAP', 'EN', 'GND')) added.push(support(nextRef('C'), 'CAP', '1uF EN reset capacitor', 'EN', 'GND', component.ref))
      for (const name of ['EN', 'BOOT']) if (!hasNet(name)) addedNets.push({ name })
    }
    if (needsTypeCPulldowns(component, input)) {
      added.push(support(nextRef('R'), 'RES', '5.1k USB-C CC1 pulldown', 'CC1', 'GND', component.ref))
      added.push(support(nextRef('R'), 'RES', '5.1k USB-C CC2 pulldown', 'CC2', 'GND', component.ref))
      if (input.addUsbTvs !== false) added.push(support(nextRef('D'), 'TVS', 'USB ESD array', 'USB_DP', 'USB_DN', component.ref))
      for (const name of ['USB_DP', 'USB_DN', 'CC1', 'CC2', 'VUSB']) if (!hasNet(name)) addedNets.push({ name })
    } else if (/(USB-C|TYPE-C|USB)/i.test(text)) {
      for (const name of ['USB_DP', 'USB_DN', 'VUSB']) if (!hasNet(name)) addedNets.push({ name })
    }
    if (/(REGULATOR|LDO|BUCK)/i.test(text)) {
      const regulatorInput = component.pinMap?.VIN || component.pinMap?.IN || (hasNet('VUSB') ? 'VUSB' : 'VIN')
      if (!hasLocalSupport([...components, ...added], 'CAP', regulatorInput, 'GND', component.ref)) {
        added.push(support(nextRef('C'), 'CAP', '10uF regulator input', regulatorInput, 'GND', component.ref))
      }
      if (!hasLocalSupport([...components, ...added], 'CAP', '3V3', 'GND', component.ref)) {
        added.push(support(nextRef('C'), 'CAP', '10uF regulator output', '3V3', 'GND', component.ref))
      }
      if (!hasNet(regulatorInput)) addedNets.push({ name: regulatorInput })
    }
    if (needsProgrammingHeader(component, input) && !components.some((item) => item.group === 'SWD' || /SWD|JTAG|PROGRAM/i.test(`${item.value || ''} ${item.group || ''}`))) {
      added.push(debugHeader(nextRef('J'), component.ref))
      for (const name of ['3V3', 'GND', 'SWDIO', 'SWCLK', 'NRST']) if (!hasNet(name)) addedNets.push({ name })
    }
  }
  if (!components.some((component) => /(REGULATOR|LDO|BUCK|PMIC)/i.test(`${component.group || ''} ${component.value || ''}`)) && hasNet('3V3')) {
    warnings.push(issue('WARNING', 'REGULATOR_NOT_PRESENT', '3V3 is used but no regulator/PMIC component was identified.'))
  }
  return { components: added, nets: addedNets, warnings }
}

function supplyNetsFor(component = {}) {
  const nets = new Set(Object.entries(component.pinMap || {})
    .filter(([pin, net]) => /^(3V3|5V|1V8|VDD|VCC|VDDA|VDDD|VBAT)$/i.test(String(net || pin)))
    .map(([, net]) => normalizeSupplyNet(net)))
  if (!nets.size) nets.add('3V3')
  return [...nets]
}

function normalizeSupplyNet(net) {
  if (/VDD|VCC|VDDA|VDDD/i.test(String(net || ''))) return '3V3'
  return String(net || '3V3')
}

function needsProgrammingHeader(component = {}, input = {}) {
  if (input.programmingHeader === false) return false
  if (input.programmingHeader === true || input.addProgrammingHeader === true) {
    return /(ESP32|STM32|MCU|PROCESSOR)/i.test(`${component.group || ''} ${component.value || ''}`)
  }
  const requestedInterfaces = Array.isArray(input.interfaces) ? input.interfaces.join(' ') : ''
  return /SWD|JTAG|PROGRAM/i.test(requestedInterfaces) && /(STM32|MCU|PROCESSOR)/i.test(`${component.group || ''} ${component.value || ''}`)
}

function debugHeader(ref, supportsRef) {
  return {
    ref,
    group: 'SWD',
    value: 'SWD programming/debug header',
    role: 'debug_programming',
    supportsRef,
    pinMap: { 1: '3V3', 2: 'SWDIO', 3: 'SWCLK', 4: 'NRST', 5: 'GND' },
    width: 12.7,
    height: 2.54,
    symbol: 'Connector_Generic:Conn_01x05',
    footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical',
    model3d: '${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x05_P2.54mm_Vertical.wrl',
    package: '1x05 2.54mm header',
    assetConfidence: 'ASSUMED_REVIEW_REQUIRED',
    assetSource: 'BoardForge controlled debug-header default',
    reviewNotes: 'Verify programming interface type, orientation, and whether pogo pads are preferred.',
  }
}

function hasTwoTerminalSupport(components, group, netA, netB) {
  return components.some((component) => {
    if (String(component.group || '').toUpperCase() !== group) return false
    const nets = Object.values(component.pinMap || {}).filter(Boolean)
    return nets.includes(netA) && nets.includes(netB)
  })
}

function hasLocalSupport(components, group, netA, netB, supportsRef) {
  return components.some((component) => {
    if (String(component.group || '').toUpperCase() !== group) return false
    if (supportsRef && component.supportsRef && component.supportsRef !== supportsRef) return false
    const nets = Object.values(component.pinMap || {}).filter(Boolean)
    const directNets = [component.netA, component.netB].filter(Boolean)
    const allNets = [...nets, ...directNets]
    return allNets.includes(netA) && allNets.includes(netB)
  })
}

function needsTypeCPulldowns(component, input) {
  if (input.usbConnectorMode === 'header') return false
  if (component.usbConnectorMode === 'header') return false
  const footprint = String(component.footprint?.libId || component.footprint || component.footprintFile || '').toUpperCase()
  if (/PINHEADER|CONN_01X04|HEADER/.test(footprint)) return false
  const mappedNets = Object.values(component.pinMap || {}).map((net) => String(net || '').toUpperCase())
  const hasCcIntent = component.pinMap && (('CC1' in component.pinMap) || ('CC2' in component.pinMap) || mappedNets.includes('CC1') || mappedNets.includes('CC2'))
  if (component.pinMap && !hasCcIntent) return false
  return /USB-C|TYPE-C/i.test(`${component.group || ''} ${component.value || ''}`) || /USB_C|TYPE_C/.test(footprint)
}

function support(ref, group, value, netA, netB, supportsRef) {
  const assets = supportAssets(group, value)
  return {
    ref,
    group,
    value,
    role: 'support_component',
    supportsRef,
    netA,
    netB,
    pinMap: group === 'TVS' ? usbEdsProtectionPinMap(netA, netB) : { 1: netA, 2: netB },
    width: group === 'CAP' || group === 'RES' ? 1.6 : 3,
    height: group === 'CAP' || group === 'RES' ? 0.8 : 2,
    symbol: assets.symbol,
    footprint: assets.footprint,
    model3d: assets.model3d,
    package: assets.package,
    assetConfidence: assets.confidence,
    assetSource: 'BoardForge controlled support-library default',
    reviewNotes: assets.reviewNotes,
  }
}

function hasUsefulPinMap(pinMap) {
  return Boolean(pinMap && Object.keys(pinMap).length && Object.values(pinMap).some(Boolean))
}

function supportAssets(group, value) {
  if (group === 'CAP') {
    const isBulk = /10uF|1uF/i.test(value || '')
    return {
      symbol: 'Device:C',
      footprint: isBulk ? 'Capacitor_SMD:C_0805_2012Metric' : 'Capacitor_SMD:C_0603_1608Metric',
      model3d: isBulk ? '${KICAD10_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_0805_2012Metric.wrl' : '${KICAD10_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_0603_1608Metric.wrl',
      package: isBulk ? '0805' : '0603',
      confidence: 'ASSUMED_REVIEW_REQUIRED',
      reviewNotes: 'Support capacitor package is an engineering default; verify voltage rating, dielectric, and JLCPCB availability.',
    }
  }
  if (group === 'RES') {
    return {
      symbol: 'Device:R',
      footprint: 'Resistor_SMD:R_0603_1608Metric',
      model3d: '${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603_1608Metric.wrl',
      package: '0603',
      confidence: 'ASSUMED_REVIEW_REQUIRED',
      reviewNotes: 'Support resistor package is an engineering default; verify value, tolerance, power, and assembly availability.',
    }
  }
  if (group === 'TVS') {
    return {
      symbol: 'Connector_Generic:Conn_01x04',
      footprint: 'BoardForge:USB_ESD_Array_USB2_Routeable',
      model3d: '${KICAD10_3DMODEL_DIR}/Package_TO_SOT_SMD.3dshapes/SOT-143.wrl',
      package: 'USB2 ESD array routeable 4-pad',
      confidence: 'ASSUMED_REVIEW_REQUIRED',
      reviewNotes: 'BoardForge routeable USB2 ESD array abstraction; verify exact low-capacitance part before production.',
    }
  }
  return {
    symbol: null,
    footprint: null,
    model3d: null,
    package: null,
    confidence: 'UNRESOLVED',
    reviewNotes: 'No controlled default exists for this support component.',
  }
}

function usbEdsProtectionPinMap(netA = 'USB_DP', netB = 'USB_DN') {
  return {
    1: netA || 'USB_DP',
    2: netB || 'USB_DN',
    3: 'GND',
    4: 'VUSB',
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
