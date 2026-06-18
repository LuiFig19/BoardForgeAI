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
  const components = (input.components || []).map((component) => ({ ...component }))
  const width = board.widthMm || 60
  const height = board.heightMm || 40
  const margin = Number(input.marginMm || 3)
  const groups = groupComponents(components)
  const placements = []
  placeEdge(groups.connectors, width, height, margin, placements)
  placeCenter(groups.controllers, width, height, placements)
  placePower(groups.power, width, height, margin, placements)
  placeNear(groups.passives, placements, width, height)
  placeRemaining(groups.remaining, placements, width, height, margin)
  let placed = components.map((component) => withSize({ ...component, ...(placements.find((item) => item.ref === component.ref) || {}) }))
  placed = legalizePlacement({ board, components: placed, margin, clearanceMm: Number(input.clearanceMm || 0.35) })
  const errors = []
  const warnings = []
  for (const component of placed) {
    if (!hasPlacement(component)) warnings.push(issue('WARNING', 'PLACEMENT_MISSING', `${component.ref} does not have solved placement.`, { ref: component.ref }))
    if (outline.length && rectCorners(component).some((corner) => !pointInPolygon(corner, outline))) errors.push(issue('ERROR', 'SOLVED_COMPONENT_OFF_BOARD', `${component.ref} solved placement extends off board.`, { ref: component.ref }))
  }
  for (let a = 0; a < placed.length; a += 1) {
    for (let b = a + 1; b < placed.length; b += 1) {
      if (hasPlacement(placed[a]) && hasPlacement(placed[b]) && rectsOverlap(placed[a], placed[b], input.clearanceMm || 0.25)) errors.push(issue('ERROR', 'SOLVED_PLACEMENT_OVERLAP', `${placed[a].ref} overlaps ${placed[b].ref}.`, { refs: [placed[a].ref, placed[b].ref] }))
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
  const recipes = {
    usb_sensor: ['plan_requirements', 'create_kicad_project', 'sync_component_database', 'synthesize_schematic_design', 'generate_schematic', 'validate_schematic_graph', 'solve_placement', 'apply_placement_plan', 'plan_copper_pours', 'autoroute_drc_iteration', 'run_kicad_erc', 'run_kicad_drc', 'validate_jlcpcb_package'],
    poe_sensor: ['plan_requirements', 'plan_power_tree', 'plan_stackup', 'create_kicad_project', 'sync_component_database', 'synthesize_schematic_design', 'generate_schematic', 'validate_power_integrity', 'solve_placement', 'plan_escape_routing', 'plan_copper_pours', 'autoroute_drc_iteration', 'build_release_gate_report'],
    motor_controller: ['plan_requirements', 'plan_power_tree', 'plan_stackup', 'create_kicad_project', 'synthesize_circuit_blocks', 'validate_power_integrity', 'analyze_thermal_bottlenecks', 'solve_placement', 'calculate_power_routing', 'plan_copper_pours', 'autoroute_drc_iteration', 'run_dfm_checks'],
  }
  const steps = (recipes[preset] || recipes.usb_sensor).map((type, index) => ({ index: index + 1, type, input: { projectPath }, why: demoWhy(type) }))
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
    if (/USB|RJ45|CONNECTOR|HEADER|JST|TERMINAL/i.test(text)) groups.connectors.push(component)
    else if (/MCU|CPU|FPGA|ESP32|STM32|CONTROLLER|PROCESSOR/i.test(text)) groups.controllers.push(component)
    else if (/REG|LDO|BUCK|BOOST|MOSFET|SHUNT|INDUCTOR|POWER/i.test(text)) groups.power.push(component)
    else if (/CAP|RES|R\d+|C\d+|0603|0402|0805/i.test(text)) groups.passives.push(component)
    else groups.remaining.push(component)
  }
  return groups
}

function placeEdge(items, width, height, margin, placements) {
  const left = items.filter((component) => /USB|POWER|TERMINAL/i.test(`${component.group || ''} ${component.value || ''}`))
  const right = items.filter((component) => /SENSOR|HEADER|I2C|RJ45|ETHERNET/i.test(`${component.group || ''} ${component.value || ''}`) && !left.includes(component))
  const bottom = items.filter((component) => !left.includes(component) && !right.includes(component))
  left.forEach((component, index) => placements.push({ ref: component.ref, x: margin + (component.width || 5) / 2, y: height / 2 + index * 7, rotation: 90 }))
  right.forEach((component, index) => placements.push({ ref: component.ref, x: width - margin - (component.width || 5) / 2, y: height / 2 + index * 7, rotation: 270 }))
  bottom.forEach((component, index) => placements.push({ ref: component.ref, x: width / 2 + index * 8, y: height - margin - (component.height || 4) / 2, rotation: 0 }))
}

function placeCenter(items, width, height, placements) {
  items.forEach((component, index) => placements.push({ ref: component.ref, x: width / 2 + index * 8, y: height / 2, rotation: 0 }))
}

function placePower(items, width, height, margin, placements) {
  items.forEach((component, index) => placements.push({ ref: component.ref, x: width - margin - (component.width || 5) / 2 - index * 8, y: height / 2, rotation: 0 }))
}

function placeNear(items, placements, width, height) {
  items.forEach((component, index) => placements.push({ ref: component.ref, x: width / 2 + ((index % 4) - 1.5) * 4, y: height / 2 - 8 + Math.floor(index / 4) * 4, rotation: 0 }))
}

function placeRemaining(items, placements, width, height, margin) {
  items.forEach((component, index) => placements.push({ ref: component.ref, x: margin + 8 + (index % 5) * 8, y: margin + 6 + Math.floor(index / 5) * 7, rotation: 0 }))
}

function legalizePlacement({ board, components, margin, clearanceMm }) {
  const bounds = outlineBounds(board, components)
  const placed = []
  const ordered = [...components].sort((a, b) => placementPriority(b) - placementPriority(a))
  for (const component of ordered) {
    const original = withSize(component)
    const candidates = candidateGrid(bounds, original, margin, original)
    const selected = candidates.find((candidate) => canUsePlacement(board, candidate, placed, clearanceMm))
      || candidates.find((candidate) => insideBoard(board, candidate, 0.2))
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
  const step = component.group === 'CAP' || component.group === 'RES' ? 2.5 : 4
  const points = [{ x: clamp(component.x, minX, maxX), y: clamp(component.y, minY, maxY), rotation: component.rotation || 0 }]
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) points.push({ x, y, rotation: component.rotation || 0 })
  }
  return points
    .map((point) => ({ ...component, x: round(clamp(point.x, minX, maxX)), y: round(clamp(point.y, minY, maxY)), rotation: point.rotation || 0 }))
    .sort((a, b) => distance(a, original) - distance(b, original))
}

function canUsePlacement(board, candidate, placed, clearanceMm) {
  return insideBoard(board, candidate, 0.2) && !placed.some((other) => rectsOverlap(candidate, other, clearanceFor(candidate, other, clearanceMm)))
}

function insideBoard(board, component, clearance = 0) {
  const outline = board.outline || []
  if (!outline.length) return true
  return rectCorners(component, clearance).every((corner) => pointInPolygon(corner, outline))
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
  return { ...component, width: Number(component.width || width), height: Number(component.height || height) }
}

function defaultSize(group) {
  return {
    MCU: [10, 10], ESP32_S3: [18, 14], USB: [9, 7], RJ45: [16, 16], REGULATOR: [5, 5],
    SENSOR_CONNECTOR: [10, 4], ESC_CONNECTOR: [10, 4], BLACKBOX: [6, 5], CAP: [1.6, 0.8],
    RES: [1.6, 0.8], TVS: [3, 2], INDUCTOR: [3, 2.2],
  }[group] || [4, 3]
}

function placementPriority(component) {
  return {
    RJ45: 100, USB: 95, SENSOR_CONNECTOR: 92, ESC_CONNECTOR: 90, ESP32_S3: 85, MCU: 82,
    REGULATOR: 76, BLACKBOX: 60, TVS: 45, INDUCTOR: 40, CAP: 20, RES: 20,
  }[component.group] || 30
}

function clearanceFor(a, b, fallback) {
  if (['CAP', 'RES'].includes(a.group) && ['CAP', 'RES'].includes(b.group)) return Math.max(0.25, fallback)
  if (['CAP', 'RES'].includes(a.group) || ['CAP', 'RES'].includes(b.group)) return Math.max(0.45, fallback)
  return Math.max(0.8, fallback)
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
