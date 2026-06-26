import { polygonBounds, round } from './geometry.mjs'
import { buildCategoryPlan } from './board-categories.mjs'
import { planRequirements } from './requirements-planner.mjs'
import { planStackup } from './stackup-planner.mjs'
import { scorePlacement } from './placement.mjs'

const scenarioCatalog = [
  scenario('led_controller_simple', 'simple', 'LED controller board with power input, MOSFET output, fuse, and edge LED connector.', ['power input', 'LED output'], 'low routing density, current-width check'),
  scenario('adapter_board', 'simple', 'Connector adapter board with two fixed connectors and labeled pins.', ['fixed connectors', 'pin mapping'], 'mechanical alignment and label clarity'),
  scenario('sensor_breakout', 'simple', 'I2C/SPI sensor breakout with decoupling, pullups, and two mounting holes.', ['sensor header', 'mounting holes'], 'short bus fanout'),
  scenario('esp32_usb_sensor', 'moderate', 'ESP32-S3 USB-C sensor board with regulator, boot/reset, I2C header, and antenna keepout.', ['USB-C edge', 'RF keepout'], 'USB pair plus RF/mechanical keepout'),
  scenario('stm32_usb_controller', 'moderate', 'STM32 USB-C microcontroller board with crystal, SWD, regulator, ESD, and debug LEDs.', ['USB', 'crystal', 'SWD'], 'crystal and USB placement'),
  scenario('poe_sensor', 'complex', 'PoE Ethernet environmental sensor with RJ45, PD front end, regulator, MCU, and sensor header.', ['RJ45 edge', 'PoE isolation'], 'Ethernet diff pairs and power isolation'),
  scenario('can_adapter', 'moderate', 'CAN adapter with transceiver, terminal block, USB service, and isolated field connector option.', ['CANH/CANL', 'terminal block'], 'field connector placement and bus pair routing'),
  scenario('rs485_controller', 'moderate', 'RS485 industrial controller with surge protection, terminal block, MCU, and power rail.', ['field I/O', 'surge protection'], 'field-side logic separation'),
  scenario('buck_regulator', 'complex', 'Buck regulator power board with input/output connectors, inductor, diode/FET, feedback divider, and thermal copper.', ['high current', 'switching loop'], 'power loop and thermal copper'),
  scenario('battery_charger', 'complex', 'Battery charger/BMS board with charger IC, thermistor, shunt, protection FET, and battery connector.', ['battery current', 'thermistor'], 'Kelvin sense and thermal review'),
  scenario('motor_controller', 'complex', 'BLDC motor controller with MOSFETs, gate driver, shunt, MCU, CAN, and motor phase outputs.', ['phase outputs', 'gate drive'], 'high-current routing and switching-noise separation'),
  scenario('relay_io', 'complex', 'Industrial relay I/O board with terminal blocks, relays/drivers, isolation, TVS, and logic-side MCU.', ['isolation boundary', 'terminal blocks'], 'creepage and field-side routing'),
  scenario('opto_input_board', 'complex', 'Opto-isolated digital input board with field terminal blocks, optocouplers, TVS, and logic connector.', ['field/logic separation'], 'clearance and isolation barrier'),
  scenario('circular_wearable', 'moderate', 'Circular wearable PCB with battery charger, BLE module, sensor, USB charging, and height keepouts.', ['custom outline', 'RF keepout'], 'component fit in curved outline'),
  scenario('l_shaped_pcb', 'moderate', 'L-shaped custom PCB with USB-C on flat edge, mounting holes, sensor area, and routing corridor.', ['L outline', 'connector edge'], 'narrow-corridor routability'),
  scenario('narrow_strip', 'moderate', 'Narrow strip PCB with LEDs/sensors along length and connector at one end.', ['strip outline', 'distributed loads'], 'long power drop and edge clearance'),
  scenario('compute_carrier_lite', 'advanced', 'Compute-module carrier lite with module connector, USB, Ethernet, MIPI/PCIe placeholders, and power sequencing.', ['module connector', 'high speed'], 'SI/PI and reference-design review'),
  scenario('dense_mixed_signal', 'advanced', 'Dense mixed-signal board with ADC, references, MCU, USB, sensors, regulators, and analog keepouts.', ['analog separation', 'dense placement'], 'quiet analog routing and congestion'),
]

export function classifyBoardComplexity(input = {}) {
  const requirements = input.requirementsPlan || planRequirements(input)
  const categoryPlan = input.categoryPlan || buildCategoryPlan(input)
  const board = input.board || {}
  const components = input.components || requirements.components || []
  const nets = input.nets || requirements.nets || []
  const text = searchable({
    prompt: input.prompt,
    notes: input.notes,
    projectName: input.projectName,
    boardType: input.boardType,
    interfaces: input.interfaces,
    selectedCircuits: requirements.selectedCircuits,
    category: categoryPlan.category?.id,
    categoryName: categoryPlan.category?.name,
    components: components.map((component) => ({ group: component.group, value: component.value, role: component.role })),
    nets,
  })
  const area = boardAreaMm2(board, input)
  const componentDensity = components.length / Math.max(1, area)
  const signals = signalCounts(text, nets)
  let score = 0
  score += components.length * 1.4
  score += nets.length * 0.7
  score += componentDensity * 2400
  score += signals.highSpeed * 12
  score += signals.power * 12
  score += signals.advanced * 18
  score += customMechanical(input, board) ? 10 : 0
  score += input.costPriority === 'cheap' ? -4 : 0
  score += input.sizePriority === 'tiny' || /tiny|dense|compact|30x30|wearable/i.test(text) ? 16 : 0
  const level = score >= 100 || signals.advanced >= 2 ? 'advanced_review_required' : score >= 70 ? 'complex' : score >= 36 ? 'moderate' : 'simple'
  const layerRange = layerRangeFor(level, signals, text)
  const review = reviewWarnings(level, signals, text)
  return {
    status: review.length || level === 'advanced_review_required' ? 'BOARD_COMPLEXITY_NEEDS_REVIEW' : 'BOARD_COMPLEXITY_CLASSIFIED',
    level,
    score: Math.round(score),
    category: categoryPlan.category?.id || 'embedded_controller',
    categoryName: categoryPlan.category?.name || 'Generic embedded controller',
    boardAreaMm2: round(area),
    componentCount: components.length,
    netCount: nets.length,
    componentDensityPer1000Mm2: round(componentDensity * 1000, 2),
    traits: [
      ...(signals.highSpeed ? ['high_speed_interfaces'] : []),
      ...(signals.power ? ['power_or_thermal_constraints'] : []),
      ...(signals.advanced ? ['expert_review_interfaces'] : []),
      ...(customMechanical(input, board) ? ['custom_mechanical_outline'] : []),
      ...(componentDensity > 0.012 ? ['dense_layout'] : []),
    ],
    recommendedLayerRange: layerRange,
    routingMode: routingModeFor(level, signals, text),
    validationStrictness: validationStrictnessFor(level, signals),
    humanReviewWarnings: review,
    nextActions: ['recommend_adaptive_stackup', 'detect_constraint_conflicts', 'score_routability', 'generate_placement_plan'],
    humanReviewRequired: true,
  }
}

export function recommendAdaptiveStackup(input = {}) {
  const complexity = input.complexity || classifyBoardComplexity(input)
  const requested = Number(input.explicitLayerCount || input.layerCount || 0)
  const text = searchable(input)
  const targetLayerCount = requested || recommendedLayerCount(complexity, text, input)
  const stackup = planStackup({ ...input, layerCount: targetLayerCount, board: { ...(input.board || {}), layerCount: targetLayerCount } })
  const warnings = [...(stackup.warnings || [])]
  if (requested && requested < targetLayerCount) warnings.push(issue('WARNING', 'REQUESTED_LAYER_COUNT_TOO_LOW', `${complexity.level} board likely needs ${targetLayerCount} layers; requested ${requested}.`))
  if (targetLayerCount === 2 && /usb|ethernet|rf|mipi|pcie|ddr/i.test(text)) warnings.push(issue('WARNING', 'TWO_LAYER_HIGH_SPEED_REVIEW', '2-layer high-speed work requires strong return-path review and may need 4+ layers.'))
  return {
    status: stackup.errors?.length ? 'ADAPTIVE_STACKUP_BLOCKED' : warnings.length || stackup.status.endsWith('NEEDS_REVIEW') ? 'ADAPTIVE_STACKUP_NEEDS_REVIEW' : 'ADAPTIVE_STACKUP_READY',
    complexity,
    recommendation: {
      layerCount: targetLayerCount,
      reason: stackupReason(complexity, targetLayerCount, text),
      costImpact: targetLayerCount <= 2 ? 'lowest' : targetLayerCount <= 4 ? 'standard_embedded' : targetLayerCount <= 6 ? 'higher_fab_cost' : 'advanced_quote_or_review',
      routingMode: complexity.routingMode,
    },
    stackup,
    warnings,
    errors: stackup.errors || [],
    humanReviewRequired: true,
  }
}

export function detectConstraintConflicts(input = {}) {
  const board = input.board || {}
  const requirements = input.requirementsPlan || planRequirements(input)
  const complexity = input.complexity || classifyBoardComplexity({ ...input, requirementsPlan: requirements })
  const area = boardAreaMm2(board, input)
  const components = input.components || requirements.components || []
  const text = searchable(input)
  const conflicts = []
  const warnings = []
  const layerCount = Number(input.layerCount || board.layerCount || 2)
  if (/tiny|compact|small|dense/i.test(text) && components.length > 18 && layerCount <= 2) conflicts.push(issue('ERROR', 'DENSE_BOARD_NEEDS_MORE_THAN_2_LAYERS', 'Dense compact boards with this component count should move to 4+ layers or larger outline.'))
  if (/cheap|lowest cost|2 layer/i.test(text) && complexity.level === 'advanced_review_required') conflicts.push(issue('ERROR', 'LOW_COST_CONFLICTS_WITH_ADVANCED_INTERFACES', 'Advanced interfaces cannot be treated as a cheap generic 2-layer board without expert review.'))
  if (/high current|motor|phase|battery|poe/i.test(text) && area < 900) conflicts.push(issue('ERROR', 'HIGH_CURRENT_BOARD_TOO_SMALL', 'High-current/power board area is likely too small for copper width, thermal spread, and connector clearance.'))
  if (customMechanical(input, board) && !board.outline?.length) conflicts.push(issue('ERROR', 'CUSTOM_OUTLINE_MISSING', 'Prompt requests custom/mechanical shape but no board outline or Edge.Cuts points were provided.'))
  if (/usb|ethernet|rj45|terminal|connector/i.test(text) && !hasConnectorConstraint(input, components)) warnings.push(issue('WARNING', 'CONNECTOR_EDGE_CONSTRAINT_UNSPECIFIED', 'Connector edge/access constraints should be explicit before placement.'))
  if (/blind|buried|microvia|hdi/i.test(text) && layerCount < 4) conflicts.push(issue('ERROR', 'ADVANCED_VIAS_REQUIRE_4_PLUS_LAYERS', 'Blind/buried/microvias require a reviewed 4+ layer stackup.'))
  return {
    status: conflicts.length ? 'CONSTRAINT_CONFLICTS_BLOCKED' : warnings.length ? 'CONSTRAINT_CONFLICTS_NEED_DECISIONS' : 'CONSTRAINT_CONFLICTS_CLEAR',
    conflicts,
    warnings,
    decisionsRequired: conflicts.map((item) => decisionForConflict(item, complexity)),
    suggestedRelaxations: suggestedRelaxations(conflicts, warnings, complexity),
    humanReviewRequired: true,
  }
}

export function scoreRoutability(input = {}) {
  const board = input.board || {}
  const requirements = input.requirementsPlan || planRequirements(input)
  const components = input.components || requirements.components || []
  const nets = input.nets || requirements.nets || []
  const complexity = input.complexity || classifyBoardComplexity({ ...input, requirementsPlan: requirements, components, nets })
  const stackupPlan = input.stackupPlan || recommendAdaptiveStackup({ ...input, complexity, requirementsPlan: requirements, components, nets })
  const constraints = input.constraintConflicts || detectConstraintConflicts({ ...input, complexity, requirementsPlan: requirements, components })
  const placement = input.placementScore || scorePlacement(boardWithFallback(board, input), componentsWithFallback(components), nets, input.profile || {})
  const area = boardAreaMm2(board, input)
  const densityScore = Math.max(0, 100 - (components.length / Math.max(1, area)) * 2800)
  const layerScore = layerSuitabilityScore(complexity, stackupPlan.recommendation?.layerCount || board.layerCount || input.layerCount || 2)
  const connectorScore = hasConnectorConstraint(input, components) ? 100 : 72
  const conflictPenalty = constraints.conflicts.length * 22 + constraints.warnings.length * 7
  const score = Math.max(0, Math.round(densityScore * 0.25 + layerScore * 0.25 + placement.score * 0.3 + connectorScore * 0.2 - conflictPenalty))
  const decision = score < 35 || constraints.conflicts.length ? 'regenerate_or_change_constraints' : score < 58 ? 'regenerate_placement' : score < 78 ? 'route_critical_nets_first' : 'proceed_to_routing'
  const reasons = [
    ...(constraints.conflicts || []).map((item) => item.message),
    ...(placement.issues || []).slice(0, 4).map((item) => item.message),
    ...(layerScore < 75 ? [`Layer count is weak for ${complexity.level} routing.`] : []),
    ...(densityScore < 65 ? ['Component density leaves weak routing corridors.'] : []),
  ]
  return {
    status: decision === 'proceed_to_routing' ? 'ROUTABILITY_READY' : decision === 'route_critical_nets_first' ? 'ROUTABILITY_NEEDS_REVIEW' : 'ROUTABILITY_REGENERATE_REQUIRED',
    routabilityScore: score,
    decision,
    reasons,
    metrics: {
      densityScore: round(densityScore),
      layerScore,
      placementScore: placement.score,
      connectorScore,
      componentCount: components.length,
      netCount: nets.length,
      boardAreaMm2: round(area),
    },
    nextActions: nextActionsForRoutability(decision),
    humanReviewRequired: true,
  }
}

export function chooseRepairOrRegenerate(input = {}) {
  const routability = input.routability || scoreRoutability(input)
  const constraints = input.constraintConflicts || detectConstraintConflicts(input)
  const drcErrors = Number(input.drcErrors || input.validation?.drc?.errors || 0)
  const action = constraints.conflicts?.length ? 'ask_user_or_relax_constraints'
    : routability.routabilityScore < 45 ? 'regenerate_placement_or_stackup'
      : drcErrors > 25 ? 'cluster_drc_then_regenerate_layout'
        : drcErrors > 0 ? 'run_drc_guided_repair'
          : 'continue_to_export_or_review'
  return {
    status: action.includes('regenerate') || action.includes('ask_user') ? 'STRUCTURAL_REGENERATION_RECOMMENDED' : 'STRUCTURAL_REPAIR_PATH_READY',
    action,
    routability,
    constraints,
    rationale: rationaleForAction(action),
    allowedAutomaticActions: automaticActionsFor(action),
    requiresUserApproval: action.includes('ask_user') || action.includes('stackup'),
    humanReviewRequired: true,
  }
}

export function listUniversalBoardScenarios() {
  return {
    status: 'UNIVERSAL_SCENARIOS_LISTED',
    scenarios: scenarioCatalog,
    families: [...new Set(scenarioCatalog.map((item) => item.family))],
    count: scenarioCatalog.length,
    humanReviewRequired: false,
  }
}

export function detectTemplateReuse(designs = []) {
  const normalized = designs.map((design, index) => signatureForDesign(design, index))
  const warnings = []
  const errors = []
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      const similarity = signatureSimilarity(normalized[i], normalized[j])
      if (similarity >= 0.86) errors.push(issue('ERROR', 'TEMPLATE_REUSE_SUSPECTED', `${normalized[i].id} and ${normalized[j].id} look too structurally similar for different board intents.`, { similarity }))
      else if (similarity >= 0.72) warnings.push(issue('WARNING', 'TEMPLATE_REUSE_REVIEW', `${normalized[i].id} and ${normalized[j].id} share significant structure; verify board-specific layout decisions.`, { similarity }))
    }
  }
  return {
    status: errors.length ? 'TEMPLATE_REUSE_BLOCKED' : warnings.length ? 'TEMPLATE_REUSE_NEEDS_REVIEW' : 'TEMPLATE_REUSE_CHECK_PASSED',
    designs: normalized,
    warnings,
    errors,
    antiTemplateRules: ['board dimensions differ when intent differs', 'connector strategy differs by interface', 'net classes reflect category', 'placement regions reflect power/noise/mechanical intent', 'routing mode follows complexity'],
    humanReviewRequired: Boolean(warnings.length || errors.length),
  }
}

export function generateBoardSpecificReport(input = {}) {
  const requirements = input.requirementsPlan || planRequirements(input)
  const categoryPlan = input.categoryPlan || buildCategoryPlan(input)
  const complexity = input.complexity || classifyBoardComplexity({ ...input, requirementsPlan: requirements, categoryPlan })
  const stackup = input.stackupPlan || recommendAdaptiveStackup({ ...input, requirementsPlan: requirements, categoryPlan, complexity })
  const conflicts = input.constraintConflicts || detectConstraintConflicts({ ...input, requirementsPlan: requirements, categoryPlan, complexity })
  const routability = input.routability || scoreRoutability({ ...input, requirementsPlan: requirements, categoryPlan, complexity, stackupPlan: stackup, constraintConflicts: conflicts })
  const regeneration = input.regenerationDecision || chooseRepairOrRegenerate({ ...input, requirementsPlan: requirements, categoryPlan, complexity, stackupPlan: stackup, constraintConflicts: conflicts, routability })
  return {
    status: conflicts.conflicts.length ? 'BOARD_SPECIFIC_REPORT_BLOCKED' : routability.status === 'ROUTABILITY_READY' ? 'BOARD_SPECIFIC_REPORT_READY' : 'BOARD_SPECIFIC_REPORT_NEEDS_REVIEW',
    boardIntent: {
      projectName: input.projectName || requirements.projectName,
      category: categoryPlan.category?.id,
      categoryName: categoryPlan.category?.name,
      selectedCircuits: requirements.selectedCircuits,
    },
    complexity,
    stackupRecommendation: stackup.recommendation,
    placementStrategy: placementStrategyFor(categoryPlan.category, complexity),
    routingStrategy: routingStrategyFor(categoryPlan.category, complexity),
    constraintConflicts: conflicts,
    routability,
    regenerationDecision: regeneration,
    reportSummary: summaryFor({ requirements, categoryPlan, complexity, stackup, conflicts, routability, regeneration }),
    humanReviewRequired: true,
  }
}

function scenario(id, family, requirements, constraints, routingChallenge) {
  return { id, family, requirements, expectedConstraints: constraints, expectedRoutingChallenge: routingChallenge, expectedValidationChecks: ['schematic graph', 'placement legality', 'routing readiness', 'ERC', 'DRC', 'manufacturing package'] }
}

function signalCounts(text, nets = []) {
  const names = nets.map((net) => typeof net === 'string' ? net : net.name || '').join(' ')
  const all = `${text} ${names}`.toLowerCase()
  return {
    highSpeed: matches(all, /\busb\b|ethernet|rj45|\bcanh\b|\bcanl\b|\bcan\b|rs485|lvds|\bclock\b|\bcrystal\b/g),
    power: matches(all, /motor|phase|battery|poe|high current|buck|boost|charger|mosfet|thermal|24v|48v/g),
    advanced: matches(all, /\bddr\b|\bmipi\b|\bpcie\b|pci-e|rf front|controlled impedance|medical|aerospace|mains|high voltage/g),
  }
}

function matches(text, regex) {
  return (text.match(regex) || []).length
}

function layerRangeFor(level, signals, text) {
  if (level === 'advanced_review_required') return /ddr|pcie|mipi|compute/.test(text) ? [8, 12] : [6, 10]
  if (level === 'complex') return signals.power || signals.highSpeed ? [4, 6] : [4, 4]
  if (level === 'moderate') return signals.highSpeed ? [4, 4] : [2, 4]
  return [2, 2]
}

function routingModeFor(level, signals, text) {
  if (level === 'advanced_review_required') return 'high_speed_expert_review'
  if (/motor|power|battery|high current|poe/.test(text) || signals.power) return 'power_context_routing'
  if (level === 'complex') return 'dense_context_routing'
  if (level === 'moderate') return 'controlled_embedded_routing'
  return 'basic_routing'
}

function validationStrictnessFor(level, signals) {
  if (level === 'advanced_review_required') return ['ERC', 'DRC', 'DFM', 'SI/PI review', 'manufacturer stackup review', 'human expert approval']
  if (level === 'complex' || signals.power) return ['ERC', 'DRC', 'DFM', 'thermal/current review', 'routing readiness']
  if (level === 'moderate') return ['ERC', 'DRC', 'placement/routing readiness', 'package validation']
  return ['ERC/DRC before export', 'basic DFM']
}

function reviewWarnings(level, signals, text) {
  const warnings = []
  if (level === 'advanced_review_required') warnings.push('Advanced interfaces require human SI/PI/safety review before any manufacturing claim.')
  if (signals.power) warnings.push('Power/current/thermal estimates must be verified against datasheets and copper area.')
  if (/rf|antenna|wifi|ble|gnss/.test(text)) warnings.push('RF/antenna performance requires reference-design and antenna keepout review.')
  if (/medical|aerospace|mains|safety/.test(text)) warnings.push('Safety/regulatory use requires external expert validation.')
  return warnings
}

function recommendedLayerCount(complexity, text, input) {
  if (input.costPriority === 'cheap' && complexity.level === 'simple' && !/usb|ethernet|rf|motor|poe/.test(text)) return 2
  if (complexity.level === 'advanced_review_required') return /compute|pcie|mipi|ddr/.test(text) ? 8 : 6
  if (complexity.level === 'complex') return /poe|motor|dense|mixed|charger|high current/.test(text) ? 6 : 4
  if (complexity.level === 'moderate') return /usb|ethernet|wifi|can|industrial/.test(text) ? 4 : 2
  return 2
}

function stackupReason(complexity, layerCount, text) {
  if (layerCount >= 8) return `${complexity.level} board with advanced/high-speed fanout needs many routing/reference layers.`
  if (layerCount >= 6) return `${complexity.level} board benefits from separated power, ground, signal, and noisy/sensitive regions.`
  if (layerCount === 4) return /usb|ethernet|can|industrial|sensor/.test(text) ? 'Controlled embedded routing with a continuous ground reference.' : 'Moderate density with better return path and power distribution.'
  return 'Simple/low-cost board with enough area and no major high-speed/current constraints.'
}

function boardAreaMm2(board = {}, input = {}) {
  if (board.outline?.length >= 3) {
    const bounds = polygonBounds(board.outline)
    return Math.max(1, Math.abs((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)))
  }
  return Math.max(1, Number(board.widthMm || board.width || input.widthMm || 50) * Number(board.heightMm || board.height || input.heightMm || 30))
}

function customMechanical(input, board) {
  const userText = searchable({
    prompt: input.prompt,
    notes: input.notes,
    outlinePrompt: input.outlinePrompt,
    shape: input.shape,
    boardType: input.boardType,
  })
  return Boolean(board.outline?.length > 4 || input.outlinePrompt || /custom|odd|weird|shape|outline|cutout|notch|circle|circular|l-shaped|mechanical/i.test(userText))
}

function hasConnectorConstraint(input, components = []) {
  if (input.connectorConstraints || input.fixedConnectors || input.edgeConnectors) return true
  return components.some((component) => /edge_|connector|usb|rj45|terminal|header/i.test(`${component.role || ''} ${component.group || ''}`))
}

function layerSuitabilityScore(complexity, layerCount) {
  const min = complexity.recommendedLayerRange?.[0] || 2
  if (layerCount >= min) return 100
  return Math.max(20, 100 - (min - layerCount) * 28)
}

function nextActionsForRoutability(decision) {
  if (decision === 'proceed_to_routing') return ['route_critical_nets', 'route_power_nets', 'autoroute_drc_iteration']
  if (decision === 'route_critical_nets_first') return ['route critical nets only', 'run DRC', 'score routing quality before full autoroute']
  if (decision === 'regenerate_placement') return ['generate multiple placement candidates', 'score placement', 'rerun routability before copper']
  return ['relax constraints, increase layers/area, or ask user for allowed tradeoff']
}

function decisionForConflict(conflict, complexity) {
  return { id: conflict.code, prompt: `${conflict.message} Choose a tradeoff: larger board, more layers, smaller packages, connector relocation, or advanced manufacturing.`, complexity: complexity.level, required: true }
}

function suggestedRelaxations(conflicts, warnings, complexity) {
  const suggestions = new Set()
  for (const item of [...conflicts, ...warnings]) {
    if (/layer|via/i.test(item.code)) suggestions.add('increase layer count or approve advanced via strategy')
    if (/small|dense|current|area/i.test(`${item.code} ${item.message}`)) suggestions.add('increase board size or reduce component count')
    if (/connector/i.test(`${item.code} ${item.message}`)) suggestions.add('lock connector edge locations before placement')
  }
  if (['complex', 'advanced_review_required'].includes(complexity.level)) suggestions.add('run stackup/manufacturer review before routing')
  return [...suggestions]
}

function rationaleForAction(action) {
  return {
    ask_user_or_relax_constraints: 'Hard constraints conflict; automatic copper repair would hide an engineering decision.',
    regenerate_placement_or_stackup: 'Routability is too weak; rerouting would waste time before placement/stackup changes.',
    cluster_drc_then_regenerate_layout: 'Many DRC errors indicate structural layout problems, not isolated copper cleanup.',
    run_drc_guided_repair: 'Small DRC count can use safe repair and endpoint-aware rerouting.',
    continue_to_export_or_review: 'No structural blocker is currently visible.',
  }[action] || 'Review required.'
}

function automaticActionsFor(action) {
  if (action === 'run_drc_guided_repair') return ['classify DRC clusters', 'rip up affected route segments', 'endpoint-aware reroute', 'rerun DRC']
  if (action === 'regenerate_placement_or_stackup') return ['generate placement candidates', 'score routability', 'recommend layer count']
  if (action === 'cluster_drc_then_regenerate_layout') return ['cluster DRC errors', 'preserve known-good schematic/netlist', 'regenerate placement/routing plan']
  if (action === 'continue_to_export_or_review') return ['run ERC/DRC/package validation', 'generate manufacturing manifest']
  return []
}

function signatureForDesign(design = {}, index) {
  const board = design.board || {}
  const components = design.components || []
  const nets = design.nets || []
  return {
    id: design.id || design.name || design.projectName || `design_${index + 1}`,
    dimensions: `${round(board.widthMm || board.width || 0)}x${round(board.heightMm || board.height || 0)}`,
    outlinePoints: board.outline?.length || 0,
    connectorRoles: new Set(components.filter((c) => /connector|usb|rj45|terminal|header|power_input/i.test(`${c.role || ''} ${c.group || ''}`)).map((c) => `${c.group || c.role}:${edgeBucket(c, board)}`)),
    componentGroups: new Set(components.map((c) => c.group || c.role || c.value || 'UNKNOWN')),
    netClasses: new Set(nets.map((n) => n.className || n.name || n)),
    routingMode: design.routingMode || design.complexity?.routingMode || '',
    category: design.category || design.boardType || design.complexity?.category || '',
  }
}

function edgeBucket(component, board = {}) {
  const width = board.widthMm || board.width || 100
  const height = board.heightMm || board.height || 60
  const x = Number(component.x || 0)
  const y = Number(component.y || 0)
  const distances = [
    ['left', Math.abs(x)],
    ['right', Math.abs(width - x)],
    ['top', Math.abs(y)],
    ['bottom', Math.abs(height - y)],
  ].sort((a, b) => a[1] - b[1])
  return distances[0]?.[0] || 'unknown'
}

function signatureSimilarity(a, b) {
  const scores = [
    a.dimensions && a.dimensions === b.dimensions ? 0.2 : 0,
    a.outlinePoints === b.outlinePoints ? 0.1 : 0,
    jaccard(a.connectorRoles, b.connectorRoles) * 0.25,
    jaccard(a.componentGroups, b.componentGroups) * 0.2,
    jaccard(a.netClasses, b.netClasses) * 0.15,
    a.routingMode && a.routingMode === b.routingMode ? 0.05 : 0,
    a.category && a.category === b.category ? 0.05 : 0,
  ]
  return round(scores.reduce((sum, item) => sum + item, 0), 3)
}

function jaccard(a, b) {
  const left = new Set(a || [])
  const right = new Set(b || [])
  if (!left.size && !right.size) return 1
  const union = new Set([...left, ...right])
  const intersection = [...left].filter((item) => right.has(item))
  return intersection.length / Math.max(1, union.size)
}

function placementStrategyFor(category = {}, complexity = {}) {
  const priorities = category?.placementPriorities || []
  return {
    mode: complexity.level === 'simple' ? 'seed_then_score' : 'multi_candidate_optimization',
    priorities,
    rejectBeforeRouting: ['off-board components', 'courtyard/mounting conflicts', 'connector access failure', 'no routing corridors'],
  }
}

function routingStrategyFor(category = {}, complexity = {}) {
  return {
    mode: complexity.routingMode,
    priorities: category?.routingPriorities || [],
    criticalFirst: ['power/GND', ...(category?.netClasses || []).filter((name) => /USB|ETHERNET|CAN|RS485|MOTOR|BATTERY|HIGH|ANALOG|SENSOR/.test(name))],
    honesty: complexity.level === 'advanced_review_required' ? 'route only with explicit expert-review warnings' : 'route with DRC-driven repair gates',
  }
}

function summaryFor({ requirements, categoryPlan, complexity, stackup, conflicts, routability, regeneration }) {
  return [
    `${requirements.projectName || 'Board'} classified as ${complexity.level} ${categoryPlan.category?.name || 'PCB'}.`,
    `Recommended ${stackup.recommendation?.layerCount}-layer strategy: ${stackup.recommendation?.reason}.`,
    `Routability ${routability.routabilityScore}/100 -> ${routability.decision}.`,
    conflicts.conflicts.length ? `${conflicts.conflicts.length} hard constraint conflict(s) must be resolved before routing.` : 'No hard constraint conflicts detected.',
    `Next path: ${regeneration.action}.`,
  ]
}

function boardWithFallback(board, input) {
  return board?.outline?.length || board?.widthMm || board?.width ? board : { widthMm: input.widthMm || 50, heightMm: input.heightMm || 30, outline: [{ x: 0, y: 0 }, { x: input.widthMm || 50, y: 0 }, { x: input.widthMm || 50, y: input.heightMm || 30 }, { x: 0, y: input.heightMm || 30 }] }
}

function componentsWithFallback(components) {
  return components.map((component, index) => ({
    x: component.x ?? 10 + index * 4,
    y: component.y ?? 10 + index * 3,
    width: component.width || 4,
    height: component.height || 3,
    ...component,
  }))
}

function searchable(input) {
  return JSON.stringify(input || '').toLowerCase()
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
