import { distancePointToSegment, pointInPolygon, polygonBounds } from './geometry.mjs'

const highSpeedClasses = new Set(['USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RF', 'CLOCK', 'CRYSTAL'])
const powerNames = /^(GND|PGND|AGND|VBAT|VIN|VUSB|POE_VDD|5V|3V3|1V8|1V2)$/i

export function analyzeRoutingCongestion({ board = {}, components = [], nets = [], routingPlan = null, profile = {}, options = {} } = {}) {
  const bounds = boardBounds(board)
  const cellSizeMm = Number(options.cellSizeMm || 5)
  const cells = buildCells(bounds, cellSizeMm)
  const routes = routingPlan?.routes || []
  const netCount = nets.length || routes.length
  const componentObstacles = components.filter(hasBody)
  for (const cell of cells) {
    const center = { x: cell.x + cellSizeMm / 2, y: cell.y + cellSizeMm / 2 }
    cell.componentLoad = componentObstacles.filter((component) => pointInRect(center, component)).length
    cell.routeDemand = routes.filter((route) => routeNearCell(route, cell, cellSizeMm)).length
    cell.endpointDemand = components.filter((component) => Object.keys(component.pinMap || {}).length && pointNearRect(center, component, cellSizeMm)).length
    cell.capacity = Math.max(1, Math.floor(cellSizeMm / Math.max(profile.minTraceWidthMm || 0.127, profile.minClearanceMm || 0.127) / 8))
    cell.load = cell.componentLoad * 3 + cell.routeDemand * 2 + cell.endpointDemand
    cell.utilization = round(cell.load / cell.capacity)
  }
  const hotspots = cells.filter((cell) => cell.utilization >= 0.75).sort((a, b) => b.utilization - a.utilization).slice(0, 16)
  const warnings = [
    ...(hotspots.length ? [issue('WARNING', 'ROUTING_CONGESTION_HOTSPOTS', `${hotspots.length} routing congestion hotspot(s) need placement/fanout review.`)] : []),
    ...(netCount > Math.max(1, cells.length * 2) ? [issue('WARNING', 'NET_DENSITY_HIGH', 'Net count is high for board area; consider more layers, larger outline, or HDI review.')] : []),
  ]
  return {
    status: hotspots.some((cell) => cell.utilization >= 1.25) ? 'ROUTING_CONGESTION_BLOCKED' : warnings.length ? 'ROUTING_CONGESTION_NEEDS_REVIEW' : 'ROUTING_CONGESTION_ACCEPTABLE',
    cellSizeMm,
    grid: cells,
    hotspots,
    metrics: {
      boardAreaMm2: round((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)),
      componentCount: components.length,
      netCount,
      hotspotCount: hotspots.length,
      maxUtilization: round(Math.max(0, ...cells.map((cell) => cell.utilization))),
    },
    warnings,
    errors: hotspots.some((cell) => cell.utilization >= 1.25) ? [issue('ERROR', 'ROUTING_CHANNEL_OVER_CAPACITY', 'At least one routing channel is over capacity for the selected manufacturer rules.')] : [],
    actions: congestionActions(hotspots),
    humanReviewRequired: true,
  }
}

export function planEscapeRouting({ board = {}, components = [], stackup = null, profile = {}, options = {} } = {}) {
  const dense = components.filter((component) => pinCount(component) >= Number(options.densePinThreshold || 24))
  const escapes = dense.map((component) => escapeForComponent(component, board, stackup, profile))
  const warnings = escapes.flatMap((item) => item.warnings)
  const errors = escapes.flatMap((item) => item.errors)
  return {
    status: errors.length ? 'ESCAPE_ROUTING_BLOCKED' : warnings.length ? 'ESCAPE_ROUTING_NEEDS_REVIEW' : 'ESCAPE_ROUTING_READY_NEEDS_REVIEW',
    denseComponentCount: dense.length,
    escapes,
    warnings,
    errors,
    actions: [
      ...(dense.length ? [{ command: 'plan_fanout', reason: 'Use escape routing output to update package fanout rules.' }] : []),
      ...(errors.length ? [{ command: 'plan_stackup', reason: 'Increase layers or approve HDI before routing dense packages.' }] : []),
    ],
    humanReviewRequired: true,
  }
}

export function planDifferentialPairTuning({ nets = [], routingPlan = null, profile = {}, options = {} } = {}) {
  const routes = routingPlan?.routes || []
  const byNet = new Map(routes.map((route) => [route.net, route]))
  const pairs = findDiffPairs(nets, routes).map(([positive, negative]) => {
    const a = byNet.get(positive) || netByName(nets, positive) || { net: positive }
    const b = byNet.get(negative) || netByName(nets, negative) || { net: negative }
    const className = a.className || b.className || inferDiffClass(positive)
    const targetMismatchMm = Number(options.targetMismatchMm || diffTarget(className))
    const lengthA = routeLength(a)
    const lengthB = routeLength(b)
    const mismatchMm = round(Math.abs(lengthA - lengthB))
    return {
      positive,
      negative,
      className,
      targetImpedanceOhm: className === 'ETHERNET_DIFF' ? 100 : className === 'USB_DIFF' ? 90 : 100,
      targetMismatchMm,
      lengthMm: { [positive]: lengthA, [negative]: lengthB },
      mismatchMm,
      action: mismatchMm > targetMismatchMm ? 'add_meander_or_reroute_shorter_member' : 'ready_for_drc_and_si_review',
      spacingMm: Math.max(profile.minClearanceMm || 0.127, className === 'USB_DIFF' ? 0.15 : 0.2),
    }
  })
  const errors = pairs.filter((pair) => pair.mismatchMm > pair.targetMismatchMm * 3).map((pair) => issue('ERROR', 'DIFF_PAIR_TUNING_BLOCKED', `${pair.positive}/${pair.negative} mismatch is too large for automatic tuning.`, pair))
  const warnings = pairs.filter((pair) => pair.mismatchMm > pair.targetMismatchMm && pair.mismatchMm <= pair.targetMismatchMm * 3).map((pair) => issue('WARNING', 'DIFF_PAIR_TUNING_NEEDED', `${pair.positive}/${pair.negative} needs length tuning.`, pair))
  return {
    status: errors.length ? 'DIFF_PAIR_TUNING_BLOCKED' : warnings.length ? 'DIFF_PAIR_TUNING_NEEDS_REVIEW' : 'DIFF_PAIR_TUNING_READY',
    pairs,
    warnings,
    errors,
    actions: pairs.length ? [{ command: 'route_diff_pair', reason: 'Route/tune differential pairs with matched geometry and reference plane review.' }] : [],
    humanReviewRequired: true,
  }
}

export function validatePowerIntegrity({ board = {}, components = [], nets = [], powerTree = null, copperPourPlan = null, profile = {} } = {}) {
  const rails = powerTree?.rails || nets.filter((net) => powerNames.test(net.name || net)).map((net) => ({ name: net.name || net, estimatedCurrentMa: net.currentMa || 0 }))
  const decoupling = components.filter((component) => /CAP|C\d+|0\.1u|1u|10u|decoupling/i.test(`${component.ref || ''} ${component.group || ''} ${component.value || ''}`))
  const regulators = components.filter((component) => /REG|LDO|BUCK|BOOST|DCDC|POWER/i.test(`${component.ref || ''} ${component.group || ''} ${component.value || ''}`))
  const pours = copperPourPlan?.pours || []
  const issues = []
  for (const rail of rails) {
    const current = Number(rail.estimatedCurrentMa || rail.currentMa || 0)
    if (current >= 500 && !pours.some((pour) => sameNet(pour.net, rail.name))) issues.push(issue('WARNING', 'POWER_RAIL_NEEDS_POUR', `${rail.name} carries current and should have explicit copper/pour strategy.`, { rail: rail.name, currentMa: current }))
    if (current >= 1000 && !regulators.length) issues.push(issue('WARNING', 'POWER_REGULATOR_NOT_IDENTIFIED', `${rail.name} is high current but no regulator/power stage is identified.`, { rail: rail.name }))
  }
  if (!rails.some((rail) => /^GND|PGND|AGND$/i.test(rail.name))) issues.push(issue('ERROR', 'GROUND_NET_MISSING', 'Power integrity cannot be checked without a ground reference net.'))
  if (components.some((component) => /MCU|CPU|FPGA|ESP32|STM32|IC/i.test(`${component.group || ''} ${component.value || ''}`)) && decoupling.length < 2) issues.push(issue('WARNING', 'DECOUPLING_LOW', 'IC-heavy board has too few detected decoupling capacitors.'))
  if ((board.layerCount || 2) < 4 && rails.some((rail) => Number(rail.estimatedCurrentMa || rail.currentMa || 0) >= 2000)) issues.push(issue('WARNING', 'HIGH_CURRENT_LOW_LAYER_COUNT', 'High-current board on fewer than 4 layers needs copper/thermal review.'))
  const errors = issues.filter((item) => item.severity === 'ERROR')
  const warnings = issues.filter((item) => item.severity === 'WARNING')
  return {
    status: errors.length ? 'POWER_INTEGRITY_BLOCKED' : warnings.length ? 'POWER_INTEGRITY_NEEDS_REVIEW' : 'POWER_INTEGRITY_READY_NEEDS_DRC',
    rails,
    decouplingCount: decoupling.length,
    regulatorCount: regulators.length,
    requiredCopperWidthMm: rails.map((rail) => ({ rail: rail.name, widthMm: requiredWidth(rail, profile) })),
    warnings,
    errors,
    actions: powerActions(issues),
    humanReviewRequired: true,
  }
}

export function analyzeThermalBottlenecks({ board = {}, components = [], powerTree = null, copperPourPlan = null, profile = {} } = {}) {
  const hotComponents = components.filter((component) => isHot(component, powerTree))
  const pours = copperPourPlan?.pours || []
  const issues = []
  for (const component of hotComponents) {
    const nearbyPour = pours.some((pour) => (pour.polygon || []).length && pointInPolygon(component, pour.polygon))
    const edgeDistance = minEdgeDistance(component, board.outline || [])
    if (!nearbyPour) issues.push(issue('WARNING', 'HOT_PART_WITHOUT_COPPER_REGION', `${component.ref} appears hot but has no explicit copper region.`, { ref: component.ref }))
    if (edgeDistance < (profile.componentToEdgeClearanceMm || 0.5)) issues.push(issue('WARNING', 'HOT_PART_EDGE_CLEARANCE_LOW', `${component.ref} thermal/mechanical edge clearance needs review.`, { ref: component.ref }))
  }
  return {
    status: issues.some((item) => item.severity === 'ERROR') ? 'THERMAL_BOTTLENECKS_BLOCKED' : issues.length ? 'THERMAL_BOTTLENECKS_NEED_REVIEW' : 'THERMAL_BOTTLENECKS_READY',
    hotComponents,
    copperPourCount: pours.length,
    warnings: issues.filter((item) => item.severity === 'WARNING'),
    errors: issues.filter((item) => item.severity === 'ERROR'),
    actions: issues.length ? [{ command: 'plan_copper_pours', reason: 'Add thermal copper and stitching vias around hot/current components.' }] : [],
    humanReviewRequired: true,
  }
}

export function validateAssemblyOrientation({ components = [], options = {} } = {}) {
  const issues = []
  const polarized = components.filter((component) => /LED|DIODE|TVS|TANT|ELECTROLYTIC|CONNECTOR|USB|RJ45|IC|QFN|QFP/i.test(`${component.group || ''} ${component.value || ''} ${component.footprint || ''}`))
  for (const component of polarized) {
    if (!component.orientationMark && !component.pin1 && !/CONNECTOR|USB|RJ45/i.test(`${component.group || ''} ${component.value || ''}`)) issues.push(issue('WARNING', 'PIN1_OR_POLARITY_MARK_MISSING', `${component.ref} needs pin-1/polarity review before CPL export.`, { ref: component.ref }))
    if (Number(component.rotation || 0) % 90 !== 0 && !options.allow45DegreeAssembly) issues.push(issue('WARNING', 'ASSEMBLY_ROTATION_REVIEW', `${component.ref} is not on a 90-degree assembly rotation.`, { ref: component.ref, rotation: component.rotation || 0 }))
  }
  const rotations = new Set(components.map((component) => Number(component.rotation || 0) % 360))
  if (rotations.size > 6) issues.push(issue('WARNING', 'MANY_ROTATION_VARIANTS', 'Many placement rotations increase assembly review burden.'))
  return {
    status: issues.length ? 'ASSEMBLY_ORIENTATION_NEEDS_REVIEW' : 'ASSEMBLY_ORIENTATION_READY',
    checked: components.length,
    polarizedCount: polarized.length,
    warnings: issues,
    errors: [],
    actions: issues.length ? [{ command: 'export_cpl', reason: 'Export CPL only after orientation/pin-1 review is resolved.' }] : [],
    humanReviewRequired: true,
  }
}

export function estimateBoardCost({ board = {}, components = [], stackup = null, profile = {}, options = {} } = {}) {
  const areaCm2 = ((board.widthMm || 50) * (board.heightMm || 30)) / 100
  const layers = Number(board.layerCount || stackup?.layerCount || 2)
  const assemblyCount = components.filter((component) => !/HOLE|TEST|FID/i.test(`${component.group || ''} ${component.value || ''}`)).length
  const hdiMultiplier = stackup?.hdi?.requiresAdvancedReview ? Number(profile.hdi?.costMultiplier || 2.5) : 1
  const layerMultiplier = layers <= 2 ? 1 : layers <= 4 ? 1.6 : layers <= 6 ? 2.4 : 3.4
  const fabEstimateUsd = round(Math.max(5, areaCm2 * layerMultiplier * hdiMultiplier * 0.8))
  const assemblyEstimateUsd = round(assemblyCount * (options.assemblyCostPerPlacementUsd || 0.015) + components.length * 0.01)
  const riskAdderUsd = round((components.filter((component) => /unknown|review|missing/i.test(`${component.stockRisk || ''} ${component.lifecycle || ''} ${component.lcsc || ''}`)).length) * 0.08)
  return {
    status: hdiMultiplier > 1 ? 'BOARD_COST_NEEDS_HDI_REVIEW' : 'BOARD_COST_ESTIMATED_NEEDS_QUOTE',
    assumptions: ['Estimate only; actual pricing requires manufacturer quote and live component stock.', 'Assembly assumes standard SMT unless component metadata says otherwise.'],
    estimates: {
      areaCm2: round(areaCm2),
      layers,
      assemblyCount,
      fabEstimateUsd,
      assemblyEstimateUsd,
      riskAdderUsd,
      estimatedPrototypeUnitUsd: round(fabEstimateUsd + assemblyEstimateUsd + riskAdderUsd),
    },
    warnings: hdiMultiplier > 1 ? [issue('WARNING', 'HDI_COST_MULTIPLIER', 'HDI/blind/microvia choices may dominate board cost.')] : [],
    errors: [],
    humanReviewRequired: true,
  }
}

export function generateEngineeringQuestions({ prompt = '', board = {}, components = [], nets = [], categoryPlan = null } = {}) {
  const questions = []
  if (!board.widthMm || !board.heightMm) questions.push(question('mechanical_envelope', 'What exact board size, outline, mounting holes, connector edges, and height limits are required?'))
  if (!board.layerCount) questions.push(question('layer_count', 'What layer count and manufacturer profile should constrain routing and cost?'))
  if (!components.length) questions.push(question('component_source', 'Should BoardForge choose parts, use your BOM, or follow a reference design?'))
  if (!nets.some((net) => powerNames.test(net.name || net))) questions.push(question('power_inputs', 'What input voltage, peak current, rails, and power budget should the design support?'))
  if (/rf|antenna|wifi|ble|gnss|lte/i.test(prompt) && !categoryPlan?.keepouts?.length) questions.push(question('rf_keepouts', 'What antenna, RF module, ground keepout, and enclosure constraints must be locked?'))
  if (/motor|battery|heater|led|esc|power/i.test(prompt)) questions.push(question('thermal_limits', 'What current, ambient temperature, copper weight, and acceptable hot-spot temperature should be assumed?'))
  if (/usb|ethernet|pcie|mipi|lvds|hdmi/i.test(prompt)) questions.push(question('high_speed_stackup', 'Should BoardForge use a manufacturer impedance stackup for high-speed differential pairs?'))
  return {
    status: questions.length ? 'ENGINEERING_QUESTIONS_REQUIRED' : 'ENGINEERING_QUESTIONS_COMPLETE',
    questions,
    missingDecisionCount: questions.length,
    actions: questions.length ? [{ command: 'plan_requirements', reason: 'Rerun requirements after these decisions are answered.' }] : [],
    humanReviewRequired: Boolean(questions.length),
  }
}

export function scoreProductionReadiness({ reports = {}, board = {}, components = [] } = {}) {
  const gates = [
    gate('outline', !reports.outline?.errors?.length && (board.outline || []).length >= 3),
    gate('components', components.length > 0 && !reports.componentAudit?.errors?.length),
    gate('bindings', !reports.componentBindings?.errors?.length),
    gate('schematic', !reports.schematicGraph?.errors?.length && !reports.schematicPcbSync?.errors?.length),
    gate('placement', !reports.placement?.errors?.length),
    gate('routing', !reports.routingQuality?.errors?.length && !reports.routingCongestion?.errors?.length),
    gate('power', !reports.powerIntegrity?.errors?.length),
    gate('thermal', !reports.thermal?.errors?.length),
    gate('dfm', !reports.dfm?.errors?.length),
    gate('manufacturing', !reports.manufacturing?.errors?.length && !reports.jlcpcb?.errors?.length),
  ]
  const passed = gates.filter((item) => item.passed).length
  const score = Math.round((passed / gates.length) * 100)
  const blockers = gates.filter((item) => !item.passed).map((item) => issue('ERROR', 'READINESS_GATE_NOT_PASSED', `${item.name} gate is not proven yet.`, { gate: item.name }))
  return {
    status: blockers.length ? 'PRODUCTION_READINESS_BLOCKED' : 'PRODUCTION_READINESS_READY_FOR_HUMAN_REVIEW',
    score,
    gates,
    warnings: score < 85 ? [issue('WARNING', 'READINESS_SCORE_LOW', 'Production readiness score is below release threshold.')] : [],
    errors: blockers,
    actions: readinessActions(gates),
    humanReviewRequired: true,
  }
}

export function buildReleaseGateReport({ project = {}, reports = {}, readiness = null } = {}) {
  const release = readiness || scoreProductionReadiness({ reports, board: project.board, components: project.components || [] })
  const requiredArtifacts = ['kicad_project', 'schematic', 'pcb', 'drc_report', 'erc_report', 'bom', 'cpl', 'gerbers', 'drill']
  const artifacts = requiredArtifacts.map((name) => ({ name, present: Boolean(project.generatedFiles?.some((file) => artifactMatcher(name, file))) }))
  const missing = artifacts.filter((item) => !item.present)
  const errors = [
    ...(release.errors || []),
    ...missing.map((item) => issue('ERROR', 'RELEASE_ARTIFACT_MISSING', `${item.name} artifact is missing.`, { artifact: item.name })),
  ]
  return {
    status: errors.length ? 'RELEASE_GATE_BLOCKED' : 'RELEASE_GATE_READY_FOR_FINAL_REVIEW',
    readinessScore: release.score,
    gates: release.gates,
    artifacts,
    warnings: release.warnings || [],
    errors,
    actions: errors.length ? [{ command: 'generate_manufacturing_manifest', reason: 'Regenerate the manifest after missing gates/artifacts are resolved.' }] : [{ command: 'package_jlcpcb', reason: 'Package after final human approval.' }],
    humanReviewRequired: true,
  }
}

function boardBounds(board) {
  if (board.outline?.length) return polygonBounds(board.outline)
  return { minX: 0, minY: 0, maxX: board.widthMm || 50, maxY: board.heightMm || 30 }
}

function buildCells(bounds, size) {
  const cells = []
  for (let x = bounds.minX; x < bounds.maxX; x += size) {
    for (let y = bounds.minY; y < bounds.maxY; y += size) cells.push({ x: round(x), y: round(y), widthMm: size, heightMm: size })
  }
  return cells
}

function routeNearCell(route, cell, size) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  for (let index = 1; index < points.length; index += 1) {
    const center = { x: cell.x + size / 2, y: cell.y + size / 2 }
    if (distancePointToSegment(center, points[index - 1], points[index]) <= size * 0.8) return true
  }
  return false
}

function pointInRect(point, rect) {
  return point.x >= rect.x - rect.width / 2 && point.x <= rect.x + rect.width / 2 && point.y >= rect.y - rect.height / 2 && point.y <= rect.y + rect.height / 2
}

function pointNearRect(point, rect, distance) {
  return point.x >= rect.x - rect.width / 2 - distance && point.x <= rect.x + rect.width / 2 + distance && point.y >= rect.y - rect.height / 2 - distance && point.y <= rect.y + rect.height / 2 + distance
}

function hasBody(component) {
  return Number.isFinite(Number(component.x)) && Number.isFinite(Number(component.y)) && Number(component.width || 0) > 0 && Number(component.height || 0) > 0
}

function pinCount(component) {
  return Math.max(Object.keys(component.pinMap || {}).length, Number(component.pinCount || 0), Number(component.pins?.length || 0))
}

function escapeForComponent(component, board, stackup, profile) {
  const pins = pinCount(component)
  const pitch = Number(component.pitchMm || (pins >= 64 ? 0.5 : pins >= 32 ? 0.65 : 0.8))
  const layers = Number(board.layerCount || stackup?.layerCount || 2)
  const warnings = []
  const errors = []
  const escapeMethod = pitch < 0.5 ? 'microvia_or_via_in_pad_review' : pitch <= 0.65 ? 'dogbone_escape_with_optional_blind_vias' : 'standard_fanout'
  if (pitch < 0.5 && !/supported/i.test(profile.hdi?.microvias || '')) errors.push(issue('ERROR', 'MICROVIA_REQUIRED_NOT_SUPPORTED', `${component.ref} pitch likely requires microvias not supported by profile.`, { ref: component.ref, pitchMm: pitch }))
  if (pins >= 80 && layers < 4) errors.push(issue('ERROR', 'DENSE_PACKAGE_TOO_FEW_LAYERS', `${component.ref} likely needs at least 4 layers for escape routing.`, { ref: component.ref, pins, layers }))
  if (pins >= 40 && layers < 4) warnings.push(issue('WARNING', 'DENSE_PACKAGE_LAYER_REVIEW', `${component.ref} escape on ${layers} layers may be congested.`, { ref: component.ref, pins, layers }))
  return { ref: component.ref, pins, pitchMm: pitch, escapeMethod, recommendedLayers: pins >= 80 ? 6 : pins >= 40 ? 4 : 2, warnings, errors }
}

function findDiffPairs(nets, routes) {
  const names = new Set([...nets.map((net) => net.name || net), ...routes.map((route) => route.net)].filter(Boolean))
  const pairs = []
  const seen = new Set()
  for (const name of names) {
    const mate = diffMate(name)
    const key = [name, mate].sort().join('|')
    if (mate && names.has(mate) && !seen.has(key)) {
      pairs.push(pairOrder(name, mate))
      seen.add(key)
    }
  }
  return pairs
}

function pairOrder(a, b) {
  if (/_P$|_DP$/i.test(a)) return [a, b]
  if (/_P$|_DP$/i.test(b)) return [b, a]
  return [a, b]
}

function netByName(nets, name) {
  const net = nets.find((item) => (item.name || item) === name)
  return net ? { ...net, net: name } : null
}

function inferDiffClass(name) {
  if (/USB/i.test(name)) return 'USB_DIFF'
  if (/ETH/i.test(name)) return 'ETHERNET_DIFF'
  if (/CAN/i.test(name)) return 'CAN_DIFF'
  return 'DEFAULT'
}

function diffTarget(className) {
  if (className === 'USB_DIFF') return 0.5
  if (className === 'ETHERNET_DIFF') return 1
  return 2
}

function routeLength(route) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  if (route.estimatedLengthMm) return round(route.estimatedLengthMm)
  let length = 0
  for (let index = 1; index < points.length; index += 1) length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  return round(length)
}

function diffMate(net) {
  if (/_DP$/.test(net)) return net.replace(/_DP$/, '_DN')
  if (/_DN$/.test(net)) return net.replace(/_DN$/, '_DP')
  if (/_P$/.test(net)) return net.replace(/_P$/, '_N')
  if (/_N$/.test(net)) return net.replace(/_N$/, '_P')
  return null
}

function sameNet(a, b) {
  return String(a || '').toUpperCase() === String(b || '').toUpperCase()
}

function requiredWidth(rail, profile) {
  const current = Number(rail.estimatedCurrentMa || rail.currentMa || 0)
  if (current >= 3000) return 2
  if (current >= 1000) return 0.9
  if (current >= 500) return 0.5
  return Math.max(profile.minTraceWidthMm || 0.127, 0.25)
}

function isHot(component, powerTree) {
  const text = `${component.ref || ''} ${component.group || ''} ${component.value || ''}`
  if (/MOSFET|REG|LDO|BUCK|BOOST|DCDC|SHUNT|INDUCTOR|POE|MOTOR|POWER|CHARGER/i.test(text)) return true
  return (powerTree?.thermalReview || []).some((item) => item.ref === component.ref && /medium|high/i.test(item.thermalRisk || ''))
}

function minEdgeDistance(point, outline) {
  if (!outline.length) return Infinity
  return Math.min(...outline.map((start, index) => distancePointToSegment(point, start, outline[(index + 1) % outline.length])))
}

function artifactMatcher(name, file) {
  const text = String(file || '').toLowerCase()
  if (name === 'kicad_project') return text.endsWith('.kicad_pro')
  if (name === 'schematic') return text.endsWith('.kicad_sch')
  if (name === 'pcb') return text.endsWith('.kicad_pcb')
  if (name === 'drc_report') return text.includes('drc')
  if (name === 'erc_report') return text.includes('erc')
  if (name === 'bom') return text.includes('bom')
  if (name === 'cpl') return text.includes('cpl')
  if (name === 'gerbers') return text.includes('gerber') || text.endsWith('.gbr')
  if (name === 'drill') return text.includes('drill') || text.endsWith('.drl')
  return text.includes(name)
}

function congestionActions(hotspots) {
  if (!hotspots.length) return [{ command: 'run_kicad_drc', reason: 'Congestion is acceptable; DRC still required after copper.' }]
  return [
    { command: 'optimize_placement', reason: 'Move components away from over-capacity routing channels.' },
    { command: 'plan_stackup', reason: 'Consider more layers or HDI if congestion remains high.' },
    { command: 'plan_fanout', reason: 'Improve escape routing around dense components.' },
  ]
}

function powerActions(issues) {
  const codes = new Set(issues.map((item) => item.code))
  return [
    ...(codes.has('GROUND_NET_MISSING') ? [{ command: 'generate_netlist', reason: 'Add ground net intent before power validation.' }] : []),
    ...(codes.has('POWER_RAIL_NEEDS_POUR') ? [{ command: 'plan_copper_pours', reason: 'Create explicit power/ground pour strategy.' }] : []),
    ...(codes.has('DECOUPLING_LOW') ? [{ command: 'synthesize_schematic_design', reason: 'Add/review decoupling support passives.' }] : []),
  ]
}

function readinessActions(gates) {
  const missing = new Set(gates.filter((item) => !item.passed).map((item) => item.name))
  return [
    ...(missing.has('components') ? [{ command: 'audit_component_library', reason: 'Resolve weak component/library coverage.' }] : []),
    ...(missing.has('schematic') ? [{ command: 'validate_schematic_graph', reason: 'Fix schematic graph/sync issues.' }] : []),
    ...(missing.has('routing') ? [{ command: 'analyze_routing_congestion', reason: 'Fix routing quality/congestion before DRC.' }] : []),
    ...(missing.has('dfm') ? [{ command: 'run_dfm_checks', reason: 'Run full DFM gates.' }] : []),
    ...(missing.has('manufacturing') ? [{ command: 'validate_jlcpcb_package', reason: 'Validate manufacturing package artifacts.' }] : []),
  ]
}

function gate(name, passed) {
  return { name, passed: Boolean(passed) }
}

function question(id, prompt) {
  return { id, prompt, required: true }
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100
}
