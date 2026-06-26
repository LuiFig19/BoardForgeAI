import { pointInPolygon, rectsOverlap } from './geometry.mjs'

export function ingestReferenceDesign(input = {}) {
  const text = normalizeText([input.referenceText, input.datasheetText, input.prompt, ...(input.sources || [])].filter(Boolean).join('\n'))
  const interfaces = pick(text, [
    ['USB', /usb|type[- ]?c|d\+|d-/],
    ['Ethernet', /ethernet|rj45|phy|magnetics/],
    ['CAN', /\bcan\b|can[- ]?fd/],
    ['I2C', /i2c|scl|sda/],
    ['SPI', /\bspi\b|sclk|mosi|miso|cs\b/],
    ['UART', /uart|txd|rxd|serial/],
    ['RF', /rf|antenna|wifi|wi-fi|ble|gnss|lte/],
    ['motor_power', /motor|phase|gate driver|mosfet|shunt/],
  ])
  const requiredCircuits = pick(text, [
    ['input_protection', /tvs|esd|fuse|reverse polarity|surge/],
    ['regulation', /ldo|buck|boost|regulator|pmic|dc[- ]?dc/],
    ['decoupling', /decoupling|bypass|0\.1u|100n|capacitor/],
    ['clocking', /crystal|oscillator|clk/],
    ['programming_debug', /swd|jtag|boot|reset|program/],
    ['isolation', /isolation|isolated|creepage|clearance/],
    ['thermal_copper', /thermal|copper pour|heatsink|temperature/],
  ])
  const constraints = [
    ...extractNumeric(text, /(\d+(?:\.\d+)?)\s*v\b/g, 'voltage_v'),
    ...extractNumeric(text, /(\d+(?:\.\d+)?)\s*(?:ma|milliamp)/g, 'current_ma'),
    ...extractNumeric(text, /(\d+(?:\.\d+)?)\s*a\b/g, 'current_a'),
    ...extractNumeric(text, /(\d+(?:\.\d+)?)\s*mhz/g, 'frequency_mhz'),
    ...extractNumeric(text, /(\d+(?:\.\d+)?)\s*ohm/g, 'impedance_ohm'),
  ]
  const warnings = []
  if (/reference design|datasheet|layout guide/.test(text) && !/keepout|placement|route|layout/.test(text)) warnings.push(issue('WARNING', 'LAYOUT_GUIDE_MISSING', 'Reference text was detected, but no explicit layout/keepout guidance was found.'))
  if (interfaces.includes('RF') && !/keepout|ground clearance|no copper/i.test(text)) warnings.push(issue('WARNING', 'RF_LAYOUT_GUIDE_REQUIRED', 'RF/antenna designs need explicit keepout and reference layout constraints.'))
  return {
    status: warnings.length ? 'REFERENCE_DESIGN_NEEDS_REVIEW' : 'REFERENCE_DESIGN_INGESTED',
    interfaces,
    requiredCircuits,
    constraints,
    assumptions: assumptionsFor(interfaces, requiredCircuits),
    warnings,
    errors: [],
    actions: [{ command: 'synthesize_circuit_blocks', reason: 'Convert reference-design requirements into BoardForge schematic blocks.' }],
    humanReviewRequired: true,
  }
}

export function synthesizeCircuitBlocks(input = {}) {
  const reference = input.referenceDesign || ingestReferenceDesign(input)
  const requested = new Set([...(reference.requiredCircuits || []), ...(input.requiredCircuits || [])])
  const interfaces = new Set([...(reference.interfaces || []), ...(input.interfaces || [])])
  const blocks = []
  if (requested.has('input_protection') || interfaces.has('USB') || interfaces.has('Ethernet')) blocks.push(block('protection', ['TVS/ESD near connector', 'short return to chassis/ground where applicable'], ['GND']))
  if (requested.has('regulation') || /battery|vin|5v|3v3|power/i.test(JSON.stringify(input))) blocks.push(block('power_tree', ['input rail', 'regulator', 'bulk capacitance', 'decoupling'], ['VIN', '5V', '3V3', 'GND']))
  if (interfaces.has('USB')) blocks.push(block('usb_interface', ['USB-C connector', 'CC resistors', 'ESD', 'controlled DP/DN pair'], ['USB_DP', 'USB_DN', 'VUSB', 'GND']))
  if (interfaces.has('Ethernet')) blocks.push(block('ethernet_interface', ['RJ45/magnetics', 'PHY or module pins', '100 ohm pairs'], ['ETH_TX_P', 'ETH_TX_N', 'ETH_RX_P', 'ETH_RX_N', 'GND']))
  if (interfaces.has('I2C')) blocks.push(block('i2c_bus', ['pullups', 'sensor connector/device', 'test access'], ['I2C_SCL', 'I2C_SDA', '3V3', 'GND']))
  if (interfaces.has('SPI')) blocks.push(block('spi_bus', ['short clock', 'chip selects', 'series damping review'], ['SPI_SCK', 'SPI_MOSI', 'SPI_MISO', 'GND']))
  if (interfaces.has('RF')) blocks.push(block('rf_front_end', ['antenna keepout', 'matching network', '50 ohm feed', 'stitching fence'], ['RF_FEED', 'GND']))
  if (interfaces.has('motor_power')) blocks.push(block('motor_power_stage', ['gate driver', 'MOSFET bridge', 'shunt/Kelvin sense', 'thermal copper'], ['VBAT', 'PHASE_A', 'PHASE_B', 'PHASE_C', 'GND']))
  if (requested.has('clocking')) blocks.push(block('clocking', ['crystal/oscillator close to IC', 'ground guard', 'no vias preferred'], ['CLK_IN', 'GND']))
  if (requested.has('programming_debug')) blocks.push(block('debug_programming', ['SWD/JTAG header or pads', 'BOOT/RESET access'], ['SWDIO', 'SWCLK', 'RESET', 'GND']))
  const warnings = blocks.length ? [] : [issue('WARNING', 'NO_CIRCUIT_BLOCKS_INFERRED', 'No circuit blocks could be inferred from the provided requirements/reference text.')]
  return {
    status: warnings.length ? 'CIRCUIT_BLOCKS_NEED_REQUIREMENTS' : 'CIRCUIT_BLOCKS_READY_NEEDS_REVIEW',
    blocks,
    netIntent: [...new Set(blocks.flatMap((item) => item.nets))].map((name) => ({ name })),
    supportComponents: blocks.flatMap((item) => item.supportComponents.map((value, index) => ({ ref: `${item.id.toUpperCase()}_${index + 1}`, value, block: item.id }))),
    warnings,
    errors: [],
    actions: blocks.length ? [{ command: 'generate_schematic', reason: 'Generate KiCad schematic after block review and component binding.' }] : [{ command: 'plan_requirements', reason: 'Ask for missing system requirements.' }],
    humanReviewRequired: true,
  }
}

export function solvePlacement(input = {}) {
  const board = input.board || {}
  const outline = board.outline || []
  const components = (input.components || []).map((component) => withSize(component))
  const width = board.widthMm || 60
  const height = board.heightMm || 40
  const denseBoard = width * height < 1800 || input.densePlacement
  const margin = Number(input.marginMm || (denseBoard ? 3.6 : 3))
  const clearanceMm = Number(input.clearanceMm || (denseBoard ? 0.55 : 0.35))
  const keepouts = placementKeepouts(input)
  const groups = groupComponents(components)
  const placements = []
  placeEdge(groups.connectors, width, height, margin, placements)
  placeCenter(groups.controllers, width, height, placements)
  placePower(groups.power, width, height, margin, placements)
  placeNear(groups.passives, placements, width, height)
  placeRemaining(groups.remaining, placements, width, height, margin)
  applyCategorySpecificPlacements(components, placements, width, height, margin)
  let placed = components.map((component) => withSize({ ...component, ...(placements.find((item) => item.ref === component.ref) || {}) }))
  placed = legalizePlacement({ board, components: placed, margin, clearanceMm, keepouts })
  placed = refineSupportPlacements({ board, components: placed, margin, clearanceMm, keepouts })
  placed = legalizePlacement({ board, components: placed, margin, clearanceMm, keepouts })
  const errors = []
  const warnings = []
  for (const component of placed) {
    if (!hasPlacement(component)) warnings.push(issue('WARNING', 'PLACEMENT_MISSING', `${component.ref} does not have solved placement.`, { ref: component.ref }))
    if (outline.length && rectCorners(component).some((corner) => !pointInPolygon(corner, outline))) errors.push(issue('ERROR', 'SOLVED_COMPONENT_OFF_BOARD', `${component.ref} solved placement extends off board.`, { ref: component.ref }))
    for (const keepout of keepouts) {
      if (rectsOverlap(component, keepout, keepout.clearanceMm || 0)) errors.push(issue('ERROR', 'SOLVED_COMPONENT_IN_KEEPOUT', `${component.ref} intersects ${keepout.id}.`, { ref: component.ref, keepout }))
    }
  }
  for (let a = 0; a < placed.length; a += 1) {
    for (let b = a + 1; b < placed.length; b += 1) {
      if (hasPlacement(placed[a]) && hasPlacement(placed[b]) && rectsOverlap(placed[a], placed[b], clearanceMm)) errors.push(issue('ERROR', 'SOLVED_PLACEMENT_OVERLAP', `${placed[a].ref} overlaps ${placed[b].ref}.`, { refs: [placed[a].ref, placed[b].ref] }))
    }
  }
  return {
    status: errors.length ? 'PLACEMENT_SOLVER_BLOCKED' : warnings.length ? 'PLACEMENT_SOLVER_NEEDS_REVIEW' : 'PLACEMENT_SOLVER_READY_NEEDS_DRC',
    components: placed,
    score: Math.max(0, 100 - errors.length * 18 - warnings.length * 6),
    warnings,
    errors,
    actions: errors.length ? [{ command: 'optimize_placement', reason: 'Repair overlap/off-board placement before copper.' }] : [{ command: 'apply_placement_plan', reason: 'Apply solved placement after review.' }],
    humanReviewRequired: true,
  }
}

function applyCategorySpecificPlacements(components, placements, width, height, margin) {
  const put = (ref, patch) => {
    if (!components.some((component) => component.ref === ref)) return
    const existing = placements.find((item) => item.ref === ref)
    if (existing) Object.assign(existing, patch)
    else placements.push({ ref, ...patch })
  }
  const byGroup = (group) => components.filter((component) => component.group === group)
  for (const [index, component] of byGroup('CAN_TRANSCEIVER').entries()) {
    put(component.ref, { x: round(width * 0.32 + index * 5), y: round(height * 0.34), rotation: 90 })
  }
  for (const [index, component] of byGroup('RS485_TRANSCEIVER').entries()) {
    put(component.ref, { x: round(width * 0.32 + index * 5), y: round(height * 0.62), rotation: 90 })
  }
  for (const component of byGroup('FIELD_CONNECTOR')) put(component.ref, { x: round(width - margin - 22), y: round(height * 0.50), rotation: 90 })
  for (const component of byGroup('MOTOR_HEADER')) put(component.ref, { x: round(width * 0.66), y: round(height - margin - 12), rotation: 90 })
  for (const component of byGroup('TERMINAL_BLOCK')) put(component.ref, { x: round(width - margin - 24), y: round(height * 0.50), rotation: 0 })
  for (const [index, component] of byGroup('TVS').entries()) {
    put(component.ref, { x: round(width - margin - 42), y: round(height * (0.34 + index * 0.22)), rotation: 0 })
  }
  for (const component of byGroup('ISOLATOR')) put(component.ref, { x: round(width * 0.55), y: round(height * 0.50), rotation: 0 })
  for (const component of byGroup('RELAY_OR_DRIVER')) put(component.ref, { x: round(width * 0.72), y: round(height * 0.66), rotation: 0 })
  for (const component of byGroup('RJ45')) put(component.ref, { x: round(width - margin - 8), y: round(height * 0.50), rotation: 270 })
  for (const component of byGroup('ETHERNET_PHY')) put(component.ref, { x: round(width - margin - 34), y: round(height * 0.38), rotation: 0 })
  for (const component of byGroup('POE_FRONT_END')) put(component.ref, { x: round(margin + 12), y: round(margin + 9), rotation: 0 })
  if (byGroup('ETHERNET_PHY').length || byGroup('POE_FRONT_END').length) {
    for (const component of byGroup('ESP32_S3')) put(component.ref, { x: round(width * 0.52), y: round(height * 0.54), rotation: 0 })
    for (const component of byGroup('USB')) put(component.ref, { x: round(margin + 8), y: round(height * 0.50), rotation: 90 })
    for (const [index, component] of byGroup('SENSOR_CONNECTOR').entries()) {
      put(component.ref, { x: round(width - margin - 28 - index * 10), y: round(margin + 8), rotation: 0 })
    }
  }
  if (byGroup('CAN_TRANSCEIVER').length || byGroup('RS485_TRANSCEIVER').length) {
    for (const component of byGroup('REGULATOR')) put(component.ref, { x: round(width * 0.56), y: round(height * 0.74), rotation: 0 })
    for (const [index, component] of byGroup('SENSOR_CONNECTOR').filter((item) => item.role !== 'debug_header').entries()) {
      put(component.ref, { x: round(width * (0.68 + index * 0.08)), y: round(margin + 8), rotation: 0 })
    }
  }
  for (const component of components.filter((item) => item.role === 'debug_header')) put(component.ref, { x: round(margin + 12), y: round(height - margin - 12), rotation: 90 })
}

export function planAutorouteRepairLoop(input = {}) {
  const issues = [...(input.drcReport?.issues || []), ...(input.routeValidation?.errors || []), ...(input.routeQuality?.errors || [])]
  const iterations = []
  const codes = new Set(issues.map((item) => String(item.code || item.type || item.message || '').toUpperCase()))
  if (hasCode(codes, 'CLEARANCE')) iterations.push(iteration('increase_clearance_or_reroute', ['validate_routing_geometry', 'autoroute_board', 'run_kicad_drc']))
  if (hasCode(codes, 'UNCONNECTED') || hasCode(codes, 'UNROUTED')) iterations.push(iteration('route_unconnected_nets', ['report_unrouted_nets', 'autoroute_board', 'run_kicad_drc']))
  if (hasCode(codes, 'WIDTH')) iterations.push(iteration('widen_routes_from_net_classes', ['calculate_power_routing', 'generate_routing_plan', 'apply_routing_plan', 'run_kicad_drc']))
  if (hasCode(codes, 'VIA')) iterations.push(iteration('repair_via_geometry', ['select_via_strategy', 'validate_routing_geometry', 'run_kicad_drc']))
  if (hasCode(codes, 'ZONE') || hasCode(codes, 'COPPER')) iterations.push(iteration('refill_copper_zones', ['plan_copper_pours', 'apply_routing_plan', 'run_kicad_drc']))
  if (!iterations.length) iterations.push(iteration('baseline_route_drc_loop', ['check_routing_readiness', 'autoroute_drc_iteration', 'generate_routing_report']))
  return {
    status: issues.length ? 'AUTOROUTE_REPAIR_LOOP_READY_NEEDS_REVIEW' : 'AUTOROUTE_REPAIR_LOOP_BASELINE_READY',
    maxIterations: Number(input.maxIterations || 5),
    issueCount: issues.length,
    iterations: iterations.slice(0, Number(input.maxIterations || 5)),
    warnings: issues.length ? [issue('WARNING', 'AUTOROUTE_REPAIR_NOT_PROVEN', 'Repair loop is a controlled plan; KiCad DRC must prove each iteration.')] : [],
    errors: [],
    humanReviewRequired: true,
  }
}

export function buildVerifiedDemoRecipe(input = {}) {
  const preset = input.preset || 'usb_sensor'
  const projectPath = slug(input.projectPath || input.projectName || `demo-${preset}`)
  const fullManufacturingFlow = ['plan_requirements', 'create_kicad_project', 'sync_component_database', 'synthesize_schematic_design', 'generate_schematic', 'validate_schematic_graph', 'solve_placement', 'apply_placement_plan', 'plan_copper_pours', 'autoroute_drc_iteration', 'run_kicad_erc', 'run_kicad_drc', 'export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'validate_jlcpcb_package', 'package_jlcpcb']
  const autorouteInput = {
    routeGroundNets: true,
    allowPartialAutorouteWrite: true,
    allowUnsafeRoutingWrite: true,
    commitEndpointAwareReroute: true,
    enableDrcGuidedReroute: input.enableDrcGuidedReroute !== false,
    enableDrcRepairLoop: input.enableDrcRepairLoop !== false,
    writeUsbSupportCompletion: false,
    maxDrcRepairIterations: Number(input.maxDrcRepairIterations ?? 12),
    maxDrcRerouteIterations: Number(input.maxDrcRerouteIterations ?? 3),
  }
  const recipes = {
    usb_sensor: fullManufacturingFlow,
    esp32_usb_sensor: fullManufacturingFlow,
    usb_c_mcu: fullManufacturingFlow,
    robotics_controller: fullManufacturingFlow,
    odd_outline: fullManufacturingFlow,
    poe_sensor: ['plan_requirements', 'plan_power_tree', 'plan_stackup', 'create_kicad_project', 'sync_component_database', 'synthesize_schematic_design', 'generate_schematic', 'validate_power_integrity', 'solve_placement', 'plan_escape_routing', 'plan_copper_pours', 'autoroute_drc_iteration', 'run_kicad_erc', 'run_kicad_drc', 'export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'validate_jlcpcb_package', 'package_jlcpcb', 'build_release_gate_report'],
    motor_controller: ['plan_requirements', 'plan_power_tree', 'plan_stackup', 'create_kicad_project', 'synthesize_circuit_blocks', 'validate_power_integrity', 'analyze_thermal_bottlenecks', 'solve_placement', 'calculate_power_routing', 'plan_copper_pours', 'autoroute_drc_iteration', 'run_dfm_checks'],
  }
  const steps = (recipes[preset] || recipes.usb_sensor).map((type, index) => ({
    index: index + 1,
    type,
    input: {
      projectPath,
      ...(type === 'autoroute_drc_iteration'
        ? autorouteInput
        : {}),
    },
    why: demoWhy(type),
  }))
  return {
    status: 'VERIFIED_DEMO_RECIPE_READY',
    preset,
    projectPath,
    steps,
    passCriteria: ['KiCad project files exist', 'ERC report generated', 'DRC report generated', 'No export/package claim unless validation gates pass', 'Release gate report generated'],
    warnings: [issue('WARNING', 'DEMO_REQUIRES_LOCAL_KICAD', 'Verified demos require local KiCad CLI and installed libraries on the test machine.')],
    errors: [],
    humanReviewRequired: true,
  }
}

export function planProductionPipeline(input = {}) {
  const projectPath = slug(input.projectPath || input.projectName || 'boardforge-production-project')
  const steps = [
    'generate_engineering_questions',
    'ingest_reference_design',
    'synthesize_circuit_blocks',
    'plan_requirements',
    'sync_component_database',
    'validate_component_bindings',
    'synthesize_schematic_design',
    'generate_schematic',
    'run_kicad_erc',
    'solve_placement',
    'validate_power_integrity',
    'plan_escape_routing',
    'analyze_routing_congestion',
    'plan_copper_pours',
    'autoroute_drc_iteration',
    'plan_autoroute_repair_loop',
    'run_dfm_checks',
    'score_production_readiness',
    'build_release_gate_report',
  ].map((type, index) => ({ index: index + 1, type, input: { projectPath }, required: true }))
  return {
    status: 'PRODUCTION_PIPELINE_READY_NEEDS_REVIEW',
    projectPath,
    steps,
    gates: ['human decisions answered', 'component bindings valid', 'ERC generated', 'DRC generated', 'DFM checked', 'release gate checked'],
    warnings: [issue('WARNING', 'PIPELINE_NOT_A_MANUFACTURING_CLAIM', 'This is an execution plan; KiCad reports and human review decide release readiness.')],
    errors: [],
    humanReviewRequired: true,
  }
}

function normalizeText(text) {
  return String(text || '').toLowerCase()
}

function pick(text, patterns) {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
}

function extractNumeric(text, pattern, kind) {
  const values = []
  for (const match of text.matchAll(pattern)) values.push({ kind, value: Number(match[1]) })
  return values.slice(0, 16)
}

function assumptionsFor(interfaces, circuits) {
  return [
    ...(interfaces.includes('USB') ? ['USB DP/DN need controlled pair review and ESD near connector.'] : []),
    ...(interfaces.includes('RF') ? ['RF sections require vendor/reference layout and keepout constraints.'] : []),
    ...(circuits.includes('regulation') ? ['Regulators need input/output caps from datasheet tables.'] : []),
    ...(circuits.includes('isolation') ? ['Isolation requires creepage/clearance rules from safety target.'] : []),
  ]
}

function block(id, supportComponents, nets) {
  return { id, supportComponents, nets, reviewRequired: true }
}

function groupComponents(components) {
  const groups = { connectors: [], controllers: [], power: [], passives: [], remaining: [] }
  for (const component of components) {
    const text = `${component.ref || ''} ${component.group || ''} ${component.value || ''} ${component.footprint || ''}`
    if (/^(CAP|RES|TVS|ESD)$/i.test(component.group || '') || /^(R|C|D)\d+/i.test(component.ref || '') || /0603|0402|0805|SOT-23/i.test(text)) groups.passives.push(component)
    else if (/USB|RJ45|CONNECTOR|HEADER|JST|TERMINAL|GNSS|GPS|RECEIVER|TELEMETRY|BUZZER|MOTOR_HEADER|ESC_CONNECTOR|POWER_INPUT/i.test(text)) groups.connectors.push(component)
    else if (/MCU|CPU|FPGA|ESP32|STM32|CONTROLLER|PROCESSOR/i.test(text)) groups.controllers.push(component)
    else if (/REG|LDO|BUCK|BOOST|MOSFET|SHUNT|INDUCTOR|POWER/i.test(text)) groups.power.push(component)
    else groups.remaining.push(component)
  }
  return groups
}

function placeEdge(items, width, height, margin, placements) {
  const left = items.filter((component) => /USB|POWER|TERMINAL/i.test(`${component.group || ''} ${component.value || ''}`))
  const top = items.filter((component) => /GNSS|GPS|RECEIVER|TELEMETRY|BUZZER/i.test(`${component.group || ''} ${component.value || ''}`) && !left.includes(component))
  const right = items.filter((component) => /SENSOR|I2C|RJ45|ETHERNET/i.test(`${component.group || ''} ${component.value || ''}`) && !left.includes(component) && !top.includes(component))
  const bottom = items.filter((component) => !left.includes(component) && !right.includes(component) && !top.includes(component))
  packHorizontal(top, width, margin, 1.45).forEach(({ component, x }) => placements.push({ ref: component.ref, x, y: margin + (component.height || 4) / 2, rotation: edgeConnectorRotation(component, 'top') }))
  packHorizontal(bottom, width, margin, 1.45).forEach(({ component, x }) => placements.push({ ref: component.ref, x, y: height - margin - (component.height || 4) / 2, rotation: edgeConnectorRotation(component, 'bottom') }))
  packVertical(left, height, margin, 1.45).forEach(({ component, y }) => placements.push({ ref: component.ref, x: margin + (component.width || 5) / 2, y, rotation: edgeConnectorRotation(component, 'left') }))
  packVertical(right, height, margin, 1.45).forEach(({ component, y }) => placements.push({ ref: component.ref, x: width - margin - (component.width || 5) / 2, y, rotation: edgeConnectorRotation(component, 'right') }))
}

function packHorizontal(items, width, margin, spacing) {
  const sized = items.map(withSize)
  if (!sized.length) return []
  const usable = Math.max(1, width - margin * 2)
  const total = sized.reduce((sum, item) => sum + (item.width || 4), 0)
  const gap = Math.max(spacing, Math.min(3.5, (usable - total) / Math.max(1, sized.length - 1)))
  let x = margin + (sized[0].width || 4) / 2
  if (total + gap * Math.max(0, sized.length - 1) < usable) x += (usable - total - gap * Math.max(0, sized.length - 1)) / 2
  return sized.map((component, index) => {
    if (index > 0) x += ((sized[index - 1].width || 4) / 2) + gap + ((component.width || 4) / 2)
    return { component, x: round(clamp(x, margin + (component.width || 4) / 2, width - margin - (component.width || 4) / 2)) }
  })
}

function packVertical(items, height, margin, spacing) {
  const sized = items.map(withSize)
  if (!sized.length) return []
  const usable = Math.max(1, height - margin * 2)
  const total = sized.reduce((sum, item) => sum + (item.height || 4), 0)
  const gap = Math.max(spacing, Math.min(3.5, (usable - total) / Math.max(1, sized.length - 1)))
  let y = margin + (sized[0].height || 4) / 2
  if (total + gap * Math.max(0, sized.length - 1) < usable) y += (usable - total - gap * Math.max(0, sized.length - 1)) / 2
  return sized.map((component, index) => {
    if (index > 0) y += ((sized[index - 1].height || 4) / 2) + gap + ((component.height || 4) / 2)
    return { component, y: round(clamp(y, margin + (component.height || 4) / 2, height - margin - (component.height || 4) / 2)) }
  })
}

function edgeConnectorRotation(component, edge) {
  const text = `${component.group || ''} ${component.value || ''} ${component.footprint?.libId || component.footprint || ''}`
  if (/PINHEADER_1X|CONN_01X|HEADER/i.test(text)) return 0
  if (edge === 'top') return 180
  if (edge === 'bottom') return 0
  return edge === 'left' ? 90 : 270
}

function placeCenter(items, width, height, placements) {
  items.forEach((component, index) => placements.push({ ref: component.ref, x: width / 2 + index * 5.5, y: height / 2, rotation: 0 }))
}

function placePower(items, width, height, margin, placements) {
  items.forEach((component, index) => placements.push({ ref: component.ref, x: width * 0.25 + index * 5.5, y: height * 0.72, rotation: 0 }))
}

function placeNear(items, placements, width, height) {
  const byRef = new Map(placements.map((item) => [item.ref, item]))
  const supportCount = new Map()
  items.forEach((component, index) => {
    const parent = component.supportsRef ? byRef.get(component.supportsRef) : null
    if (!parent) {
      placements.push({ ref: component.ref, x: width / 2 + ((index % 5) - 2) * 5, y: height / 2 - 11 + Math.floor(index / 5) * 5, rotation: 0 })
      return
    }
    const slot = supportCount.get(parent.ref) || 0
    supportCount.set(parent.ref, slot + 1)
    const parentText = `${parent.ref || ''} ${parent.group || ''} ${parent.value || ''} ${parent.footprint || ''}`
    const childText = `${component.group || ''} ${component.value || ''} ${component.netA || ''} ${component.netB || ''}`
    const usbSupportParent = /USB/i.test(parentText) || (/^(J1|USB\d*)$/i.test(String(parent.ref || '')) && /USB|CC[12]|ESD|TVS/i.test(childText))
    const parentW = parent.width || parent.size?.width || (usbSupportParent ? 12 : String(parent.ref).startsWith('U1') ? 48 : 6)
    const parentH = parent.height || parent.size?.height || (usbSupportParent ? 4 : String(parent.ref).startsWith('U1') ? 41 : 5)
    const gap = parent.ref === 'U1' ? 5.2 : (['CAP', 'RES'].includes(component.group) ? 3.2 : 4.2)
    const dx = parentW / 2 + (component.width || 1.6) / 2 + gap
    const dy = parentH / 2 + (component.height || 0.8) / 2 + gap
    const sideOffsets = ['CAP', 'RES'].includes(component.group) && parent.ref === 'U1' ? [-13, -7, 7, 13, -18, 18]
      : ['CAP', 'RES'].includes(component.group) ? [-11, -5.5, 0, 5.5, 11, -16.5, 16.5]
        : [-8, 0, 8]
    const sideOrder = usbSupportParent
      ? (parent.x < width / 2 ? ['right', 'bottom', 'top'] : ['left', 'bottom', 'top'])
      : parent.ref === 'U1' && ['CAP', 'RES'].includes(component.group)
      ? ['right', 'top', 'bottom', 'left']
      : ['left', 'right']
    const candidates = sideOrder.flatMap((side) => sideOffsets.map((offset) => {
      if (side === 'right') return { x: parent.x + dx, y: parent.y + offset }
      if (side === 'top') return { x: parent.x + offset, y: parent.y - dy }
      if (side === 'bottom') return { x: parent.x + offset, y: parent.y + dy }
      return { x: parent.x - dx, y: parent.y + offset }
    }))
    candidates.push(
      { x: parent.x, y: parent.y - dy },
      { x: parent.x, y: parent.y + dy },
      { x: parent.x - dx, y: parent.y - dy },
      { x: parent.x + dx, y: parent.y - dy },
      { x: parent.x - dx, y: parent.y + dy },
      { x: parent.x + dx, y: parent.y + dy },
    )
    const legal = candidates
      .filter((candidate) => candidate.x > 2 && candidate.x < width - 2 && candidate.y > 2 && candidate.y < height - 2)
      .filter((candidate) => !isServiceLaneConflict(component, parent, candidate))
    const selected = (legal.length ? legal : candidates)[slot % (legal.length ? legal.length : candidates.length)]
    placements.push({ ref: component.ref, x: round(selected.x), y: round(selected.y), rotation: 0 })
  })
}

function refineSupportPlacements({ board, components, margin, clearanceMm, keepouts = [] }) {
  const next = [...components]
  const supportRefs = new Set(next.filter((component) => component.supportsRef && /^(CAP|RES|TVS|ESD)$/i.test(component.group || '')).map((component) => component.ref))
  for (const ref of supportRefs) {
    const index = next.findIndex((component) => component.ref === ref)
    const component = next[index]
    const parent = next.find((item) => item.ref === component.supportsRef)
    if (!parent) continue
    const candidates = supportCandidates(component, parent, board)
    const placed = next.filter((_, otherIndex) => otherIndex !== index)
    const selected = candidates
      .map((candidate) => withSize({ ...component, ...candidate }))
      .find((candidate) => canUsePlacement(board, candidate, placed, clearanceMm, keepouts))
    if (selected) next[index] = selected
  }
  return next
}

function supportCandidates(component, parent, board) {
  const text = `${component.group || ''} ${component.value || ''} ${component.netA || ''} ${component.netB || ''} ${Object.values(component.pinMap || {}).join(' ')}`
  const bounds = outlineBounds(board, [])
  const inward = parent.x < (bounds.minX + bounds.maxX) / 2 ? 1 : -1
  if (/USB|CC[12]|ESD|TVS/i.test(text) && /J1|USB/i.test(`${component.supportsRef || ''} ${parent.group || ''} ${parent.value || ''}`)) {
    const anchorX = parent.x + inward * 10
    if (/^(TVS|ESD)$/i.test(component.group || '') || /ESD|TVS/i.test(text)) {
      return [
        { x: parent.x + inward * 8.8, y: parent.y, rotation: 0 },
        { x: parent.x + inward * 8.8, y: parent.y - 2.4, rotation: 0 },
        { x: parent.x + inward * 8.8, y: parent.y + 2.4, rotation: 0 },
        { x: parent.x + inward * 10.2, y: parent.y, rotation: 0 },
      ]
    }
    if (/CC1/i.test(text)) return [
      { x: parent.x + inward * 6.2, y: parent.y + 3.6, rotation: 0 },
      { x: parent.x + inward * 7.8, y: parent.y + 3.6, rotation: 0 },
      { x: parent.x + inward * 6.2, y: parent.y + 5.2, rotation: 0 },
      { x: anchorX, y: parent.y - 3.6, rotation: 0 },
      { x: anchorX + inward * 2.4, y: parent.y - 3.6, rotation: 0 },
      { x: anchorX, y: parent.y - 5.2, rotation: 0 },
    ]
    if (/CC2/i.test(text)) return [
      { x: parent.x + inward * 6.2, y: parent.y - 3.6, rotation: 0 },
      { x: parent.x + inward * 7.8, y: parent.y - 3.6, rotation: 0 },
      { x: parent.x + inward * 6.2, y: parent.y - 5.2, rotation: 0 },
      { x: parent.x + inward * 7.5, y: parent.y + 12, rotation: 0 },
      { x: parent.x + inward * 9.5, y: parent.y + 12, rotation: 0 },
      { x: parent.x + inward * 7.5, y: parent.y + 14, rotation: 0 },
      { x: parent.x + inward * 9.5, y: parent.y + 14, rotation: 0 },
      { x: parent.x + inward * 11, y: parent.y + 10, rotation: 0 },
      ]
    return [
      { x: anchorX + inward * 2.5, y: parent.y, rotation: 0 },
      { x: anchorX + inward * 4.5, y: parent.y, rotation: 0 },
      { x: anchorX + inward * 2.5, y: parent.y + 6, rotation: 0 },
    ]
  }
  if (/ESP32|WROOM|RF_MODULE/i.test(`${parent.group || ''} ${parent.value || ''}`)) {
    const sideX = Math.min(bounds.maxX - 5, parent.x + (parent.width || 48) / 2 + 4)
    if (/BOOT/i.test(text)) return [
      { x: sideX, y: parent.y + 11.5, rotation: 0 },
      { x: sideX - 4, y: parent.y + 11.5, rotation: 0 },
      { x: sideX, y: parent.y + 14, rotation: 0 },
    ]
    if (/EN|RESET/i.test(text)) return [
      { x: sideX + 3.5, y: parent.y - 5, rotation: 0 },
      { x: sideX + 3.5, y: parent.y - 2.5, rotation: 0 },
      { x: sideX + 3.5, y: parent.y, rotation: 0 },
      { x: sideX, y: parent.y - 2.5, rotation: 0 },
      { x: sideX - 4, y: parent.y - 2.5, rotation: 0 },
      { x: sideX, y: parent.y - 5, rotation: 0 },
    ]
    if (component.group === 'CAP') return [
      { x: sideX, y: parent.y, rotation: 0 },
      { x: sideX, y: parent.y + 5.5, rotation: 0 },
      { x: sideX, y: parent.y - 5.5, rotation: 0 },
      { x: sideX - 4, y: parent.y, rotation: 0 },
    ]
  }
  const parentW = parent.width || 5
  const parentH = parent.height || 5
  const dx = parentW / 2 + (component.width || 1.6) / 2 + 1.8
  const dy = parentH / 2 + (component.height || 0.8) / 2 + 1.6
  return [
    { x: parent.x + dx, y: parent.y, rotation: 0 },
    { x: parent.x - dx, y: parent.y, rotation: 0 },
    { x: parent.x, y: parent.y + dy, rotation: 0 },
    { x: parent.x, y: parent.y - dy, rotation: 0 },
    { x: parent.x + dx, y: parent.y + dy, rotation: 0 },
    { x: parent.x - dx, y: parent.y + dy, rotation: 0 },
  ]
}

function isServiceLaneConflict(component, parent, candidate) {
  if (parent.ref !== 'U1' || !['CAP', 'RES'].includes(component.group)) return false
  const leftOfController = candidate.x < parent.x
  const inUsbLane = candidate.y >= parent.y + 5 && candidate.y <= parent.y + 15
  return leftOfController && inUsbLane
}

function placeRemaining(items, placements, width, height, margin) {
  items.forEach((component, index) => placements.push({ ref: component.ref, x: margin + 8 + (index % 5) * 8, y: margin + 6 + Math.floor(index / 5) * 7, rotation: 0 }))
}

function legalizePlacement({ board, components, margin, clearanceMm, keepouts = [] }) {
  const bounds = outlineBounds(board, components)
  const placed = []
  const ordered = [...components].sort((a, b) => placementPriority(b) - placementPriority(a))
  for (const component of ordered) {
    const original = withSize(component)
    if (isLockedSupportPlacement(original) && canUsePlacement(board, original, placed, clearanceMm, keepouts)) {
      placed.push(original)
      continue
    }
    const candidates = candidateGrid(bounds, original, margin, original)
    const selected = candidates.find((candidate) => canUsePlacement(board, candidate, placed, clearanceMm, keepouts))
      || candidates.find((candidate) => insideBoard(board, candidate, 0.2) && !keepouts.some((keepout) => rectsOverlap(candidate, keepout, keepout.clearanceMm || 0)))
      || clampToBounds(bounds, original, margin)
    placed.push({ ...original, ...selected })
  }
  const byRef = new Map(placed.map((component) => [component.ref, component]))
  return components.map((component) => byRef.get(component.ref) || component)
}

function candidateGrid(bounds, component, margin, original) {
  const halfW = Number(component.width || 1) / 2
  const halfH = Number(component.height || 1) / 2
  const minX = bounds.minX + margin + halfW
  const maxX = bounds.maxX - margin - halfW
  const minY = bounds.minY + margin + halfH
  const maxY = bounds.maxY - margin - halfH
  const dense = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) < 1800 || component.densePlacement
  const step = component.group === 'CAP' || component.group === 'RES' ? (dense ? 1.25 : 2.5) : (dense ? 2 : 4)
  const points = [{ x: clamp(component.x, minX, maxX), y: clamp(component.y, minY, maxY), rotation: component.rotation || 0 }]
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) points.push({ x, y, rotation: component.rotation || 0 })
  }
  return points
    .map((point) => ({ ...component, x: round(clamp(point.x, minX, maxX)), y: round(clamp(point.y, minY, maxY)), rotation: point.rotation || 0 }))
    .sort((a, b) => distance(a, original) - distance(b, original))
}

function canUsePlacement(board, candidate, placed, clearanceMm, keepouts = []) {
  return insideBoard(board, candidate, 0.2)
    && !conflictsWithMountingHoles(board, candidate, 1.2)
    && !keepouts.some((keepout) => rectsOverlap(candidate, keepout, keepout.clearanceMm || 0))
    && !placed.some((other) => rectsOverlap(candidate, other, clearanceFor(candidate, other, clearanceMm)))
}

function isLockedSupportPlacement(component) {
  const text = `${component.group || ''} ${component.value || ''} ${component.netA || ''} ${component.netB || ''} ${Object.values(component.pinMap || {}).join(' ')}`
  return Boolean(component.supportsRef) && /USB|CC[12]|ESD|TVS/i.test(text) && /^(RES|TVS|ESD)$/i.test(component.group || '')
}

function placementKeepouts(input) {
  const keepouts = input.constraints?.routing?.keepouts
    || input.designConstraints?.routing?.keepouts
    || input.routing?.keepouts
    || []
  return keepouts
    .filter((keepout) => keepout.allowComponents === false || keepout.kind === 'antenna_keepout')
    .map((keepout) => {
      const bounds = keepout.polygon?.length ? outlineBounds({ outline: keepout.polygon }, []) : null
      return {
        id: keepout.id || keepout.kind || 'PLACEMENT_KEEPOUT',
        x: Number.isFinite(Number(keepout.x)) ? Number(keepout.x) : (bounds ? (bounds.minX + bounds.maxX) / 2 : 0),
        y: Number.isFinite(Number(keepout.y)) ? Number(keepout.y) : (bounds ? (bounds.minY + bounds.maxY) / 2 : 0),
        width: Number(keepout.widthMm || (bounds ? bounds.maxX - bounds.minX : 0)),
        height: Number(keepout.heightMm || (bounds ? bounds.maxY - bounds.minY : 0)),
        clearanceMm: Number(keepout.minComponentClearanceMm || 0.35),
        kind: keepout.kind,
        owner: keepout.owner,
      }
    })
    .filter((keepout) => keepout.width > 0 && keepout.height > 0)
}

function insideBoard(board, component, clearance = 0) {
  const outline = board.outline || []
  if (!outline.length) return true
  return rectCorners(component, clearance).every((corner) => pointInPolygon(corner, outline))
}

function conflictsWithMountingHoles(board, component, clearance = 1) {
  return (board.mountingHoles || []).some((hole) => {
    const keepout = Number(hole.diameterMm || 0) + clearance * 2 + 1.2
    return rectsOverlap(component, { x: hole.x, y: hole.y, width: keepout, height: keepout })
  })
}

function outlineBounds(board, components) {
  const points = board.outline?.length ? board.outline : [
    { x: 0, y: 0 },
    { x: board.widthMm || 60, y: board.heightMm || 40 },
  ]
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  }
}

function clampToBounds(bounds, component, margin) {
  const halfW = Number(component.width || 1) / 2
  const halfH = Number(component.height || 1) / 2
  return {
    ...component,
    x: round(clamp(component.x, bounds.minX + margin + halfW, bounds.maxX - margin - halfW)),
    y: round(clamp(component.y, bounds.minY + margin + halfH, bounds.maxY - margin - halfH)),
  }
}

function withSize(component) {
  const [width, height] = defaultSize(component.group)
  const footprintWidth = Number(component.footprint?.widthMm || component.courtyard?.width || component.size?.widthMm || 0)
  const footprintHeight = Number(component.footprint?.heightMm || component.courtyard?.height || component.size?.heightMm || 0)
  const hinted = footprintSizeHint(component)
  const compact = compactPlacementGroup(component)
  const candidateWidth = footprintWidth || hinted.width || (compact ? width : Number(component.width || 0)) || width
  const candidateHeight = footprintHeight || hinted.height || (compact ? height : Number(component.height || 0)) || height
  const resolvedWidth = Math.max(candidateWidth, width)
  const resolvedHeight = Math.max(candidateHeight, height)
  return { ...component, width: resolvedWidth, height: resolvedHeight }
}

function compactPlacementGroup(component) {
  return /^(SENSOR_CONNECTOR|ESC_CONNECTOR|GNSS|RECEIVER|TELEMETRY|BUZZER|MCU|IMU|BAROMETER|CURRENT_SENSOR|SWITCH|CAP|RES|TVS|INDUCTOR)$/i.test(component.group || '')
}

function footprintSizeHint(component) {
  const text = `${component.footprint?.libId || component.footprint || ''} ${component.package || ''} ${component.value || ''}`
  const qfn = text.match(/QFN[-_](\d+).*?(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i)
  if (qfn) return { width: Number(qfn[2]) + 1.1, height: Number(qfn[3]) + 1.1 }
  const lga = text.match(/LGA[-_](?:\d+).*?(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm/i)
  if (/LGA|Sensor_Motion|Bosch/i.test(text) && lga) return { width: Number(lga[1]) + 0.9, height: Number(lga[2]) + 0.9 }
  const soic = text.match(/SOIC[-_]\d+[_-](\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i)
  if (soic) return { width: Number(soic[1]) + 1.5, height: Number(soic[2]) + 1.5 }
  if (/PinHeader_1x08_P1\.27/i.test(text)) return { width: 10.4, height: 3.1 }
  if (/PinHeader_1x06_P1\.27/i.test(text)) return { width: 7.8, height: 3.1 }
  if (/PinHeader_1x05_P1\.27/i.test(text)) return { width: 6.6, height: 3.1 }
  if (/PinHeader_1x04_P1\.27/i.test(text)) return { width: 5.4, height: 3.1 }
  if (/PinHeader_1x02_P1\.27/i.test(text)) return { width: 2.9, height: 3.1 }
  if (/SOT-23-6/i.test(text)) return { width: 3.1, height: 3.0 }
  if (/SOT-23-5/i.test(text)) return { width: 3.1, height: 3.0 }
  if (/R_0603|C_0603|0603/i.test(text)) return { width: 1.8, height: 1.0 }
  if (/R_0805|C_0805|0805/i.test(text)) return { width: 2.2, height: 1.35 }
  return { width: 0, height: 0 }
}

function defaultSize(group) {
  return {
    MCU: [5.5, 5.5], ESP32_S3: [48, 41], USB: [12, 4], RJ45: [16, 16], REGULATOR: [3.5, 3.5],
    SENSOR_CONNECTOR: [5.4, 3.1], ESC_CONNECTOR: [10.4, 3.1], GNSS: [7.8, 3.1], RECEIVER: [5.4, 3.1], TELEMETRY: [5.4, 3.1], BUZZER: [2.9, 3.1],
    MOTOR_HEADER: [14, 4], POWER_INPUT: [11, 8], CURRENT_SENSOR: [4, 3], SWITCH: [4.5, 4.5], BLACKBOX: [6, 5], CAP: [2.2, 1.2],
    CAN_TRANSCEIVER: [14, 4], RS485_TRANSCEIVER: [14, 4], FIELD_CONNECTOR: [18, 4], TERMINAL_BLOCK: [40, 8],
    ISOLATOR: [6, 5], RELAY_OR_DRIVER: [6, 5], RES: [2.2, 1.2], TVS: [3, 2.4], INDUCTOR: [3, 2.2],
  }[group] || [4, 3]
}

function placementPriority(component) {
  return {
    RJ45: 100, USB: 95, TERMINAL_BLOCK: 94, POWER_INPUT: 94, FIELD_CONNECTOR: 93, SENSOR_CONNECTOR: 92, ESC_CONNECTOR: 90, GNSS: 89, RECEIVER: 88, TELEMETRY: 87, BUZZER: 80, MOTOR_HEADER: 86, ESP32_S3: 85, MCU: 82,
    CAN_TRANSCEIVER: 81, RS485_TRANSCEIVER: 81, ISOLATOR: 80, RELAY_OR_DRIVER: 79, REGULATOR: 76, BLACKBOX: 60, TVS: 45, INDUCTOR: 40, CAP: 20, RES: 20,
  }[component.group] || 30
}

function clearanceFor(a, b, fallback) {
  if (isConnectorLike(a) || isConnectorLike(b)) return Math.max(0.85, fallback)
  if (['CAP', 'RES'].includes(a.group) && ['CAP', 'RES'].includes(b.group)) return Math.max(0.25, fallback)
  if (['CAP', 'RES'].includes(a.group) || ['CAP', 'RES'].includes(b.group)) return Math.max(0.45, fallback)
  return Math.max(0.8, fallback)
}

function isConnectorLike(component) {
  return /CONNECTOR|USB|RJ45|GNSS|RECEIVER|TELEMETRY|BUZZER|POWER_INPUT|HEADER/i.test(`${component.group || ''} ${component.value || ''} ${component.footprint?.libId || component.footprint || ''}`)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function distance(a, b) {
  return Math.hypot(Number(a.x || 0) - Number(b.x || 0), Number(a.y || 0) - Number(b.y || 0))
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000
}

function hasPlacement(component) {
  return Number.isFinite(Number(component.x)) && Number.isFinite(Number(component.y)) && Number(component.width || 0) > 0 && Number(component.height || 0) > 0
}

function rectCorners(component, clearance = 0) {
  const halfW = Number(component.width || 0) / 2
  const halfH = Number(component.height || 0) / 2
  return [
    { x: component.x - halfW - clearance, y: component.y - halfH - clearance },
    { x: component.x + halfW + clearance, y: component.y - halfH - clearance },
    { x: component.x + halfW + clearance, y: component.y + halfH + clearance },
    { x: component.x - halfW - clearance, y: component.y + halfH + clearance },
  ]
}

function iteration(strategy, jobs) {
  return { strategy, jobs, stopCondition: 'rerun KiCad DRC and stop when errors are zero or a blocker remains' }
}

function hasCode(codes, token) {
  return [...codes].some((code) => code.includes(token))
}

function demoWhy(type) {
  return {
    solve_placement: 'Use BoardForge placement solver before copper.',
    autoroute_drc_iteration: 'Route and prove status with KiCad DRC.',
    build_release_gate_report: 'End demo with explicit missing gates/artifacts.',
  }[type] || `Run ${type} as part of the verified demo recipe.`
}

function slug(name) {
  return String(name || 'boardforge-project').trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 64).toLowerCase() || 'boardforge-project'
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
