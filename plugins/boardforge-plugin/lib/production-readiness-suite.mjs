import { pointInPolygon, polygonBounds, rectsOverlap, round } from './geometry.mjs'

export const productionReadinessJobTypes = [
  'build_canonical_net_model',
  'audit_asset_resolution',
  'audit_placement_legality',
  'compile_routing_execution_strategy',
  'audit_release_export_gates',
  'run_production_readiness_suite',
]

export function runProductionReadinessJob(type, context = {}) {
  if (type === 'build_canonical_net_model') return buildCanonicalNetModel(context)
  if (type === 'audit_asset_resolution') return auditAssetResolution(context)
  if (type === 'audit_placement_legality') return auditPlacementLegality(context)
  if (type === 'compile_routing_execution_strategy') return compileRoutingExecutionStrategy(context)
  if (type === 'audit_release_export_gates') return auditReleaseExportGates(context)
  if (type === 'run_production_readiness_suite') return runProductionReadinessSuite(context)
  return blocked('PRODUCTION_SUITE_UNKNOWN_JOB', `Unknown production readiness job: ${type}`)
}

export function buildCanonicalNetModel(context = {}) {
  const components = normalizeComponents(context.components || [])
  const declaredNets = normalizeNets([
    ...(context.nets || []),
    ...(context.requirements?.nets || []),
    ...(context.netlist?.nets || []),
    ...(context.circuitBlocks?.netIntent || []),
  ])
  const netMap = new Map(declaredNets.map((net) => [net.name, { ...net, pins: [...(net.pins || [])], sources: ['declared'] }]))
  const componentMap = []
  for (const component of components) {
    const pins = Object.entries(component.pinMap || {}).filter(([, net]) => net).map(([pin, net]) => ({ pin, net }))
    componentMap.push({ ref: component.ref, value: component.value || '', group: component.group || '', symbol: component.symbol || null, footprint: component.footprint || null, pinCount: pins.length })
    for (const { pin, net } of pins) {
      const entry = netMap.get(net) || { name: net, className: classifyNet(net), pins: [], sources: [] }
      entry.className ||= classifyNet(net)
      entry.pins.push({ ref: component.ref, pin, value: component.value || '', group: component.group || '' })
      entry.sources = [...new Set([...(entry.sources || []), 'component_pin'])]
      netMap.set(net, entry)
    }
  }
  const pcbNets = normalizeNets(context.pcbScan?.nets || context.scan?.nets || [])
  for (const net of pcbNets) {
    const entry = netMap.get(net.name) || { ...net, pins: [], sources: [] }
    entry.sources = [...new Set([...(entry.sources || []), 'pcb'])]
    netMap.set(net.name, entry)
  }
  const nets = [...netMap.values()].sort((a, b) => a.name.localeCompare(b.name))
  const warnings = [
    ...nets.filter((net) => net.pins.length < 2 && !isPowerSymbol(net.name)).map((net) => issue('WARNING', 'NET_HAS_FEWER_THAN_TWO_PINS', `${net.name} has ${net.pins.length} mapped pin(s).`, { net: net.name })),
    ...components.filter((component) => !Object.keys(component.pinMap || {}).length).map((component) => issue('WARNING', 'COMPONENT_PIN_MAP_MISSING', `${component.ref} has no pin map, so schematic/PCB sync is not authoritative.`, { ref: component.ref })),
  ]
  const errors = [
    ...components.filter((component) => !component.ref).map((component) => issue('ERROR', 'COMPONENT_REF_MISSING', 'A component is missing its reference designator.', { component })),
    ...nets.filter((net) => !net.name).map((net) => issue('ERROR', 'NET_NAME_MISSING', 'A net is missing its name.', { net })),
  ]
  return {
    status: errors.length ? 'CANONICAL_NET_MODEL_BLOCKED' : warnings.length ? 'CANONICAL_NET_MODEL_NEEDS_REVIEW' : 'CANONICAL_NET_MODEL_READY',
    canonicalNetModel: {
      schemaVersion: 1,
      componentCount: components.length,
      netCount: nets.length,
      components: componentMap,
      nets,
      authority: 'BoardForge canonical net model must be the source for schematic, PCB, BOM, CPL, and routing checks.',
    },
    warnings,
    errors,
    actions: errors.length ? ['fix component refs and net names'] : ['validate_schematic_graph', 'validate_schematic_pcb_sync', 'assign_net_classes'],
    humanReviewRequired: true,
  }
}

export function auditAssetResolution(context = {}) {
  const components = normalizeComponents(context.components || [])
  const errors = []
  const warnings = []
  for (const component of components) {
    if (!component.symbol) errors.push(issue('ERROR', 'SYMBOL_MISSING', `${component.ref} needs a real KiCad symbol.`, { ref: component.ref }))
    if (!component.footprint) errors.push(issue('ERROR', 'FOOTPRINT_MISSING', `${component.ref} needs a real KiCad footprint.`, { ref: component.ref }))
    if (!component.model3d && !component.model && !component.stepModel) warnings.push(issue('WARNING', 'MODEL_3D_MISSING', `${component.ref} needs a STEP/WRL model for KiCad physical 3D review.`, { ref: component.ref }))
    if (/QFN|BGA|LGA|WLCSP/i.test(`${component.package || ''} ${component.footprint || ''}`) && !component.courtyard) warnings.push(issue('WARNING', 'COURTYARD_REVIEW_REQUIRED', `${component.ref} is a dense package; courtyard and assembly rules need review.`, { ref: component.ref }))
  }
  const coverage = {
    symbols: ratio(components.filter((item) => item.symbol).length, components.length),
    footprints: ratio(components.filter((item) => item.footprint).length, components.length),
    models3d: ratio(components.filter((item) => item.model3d || item.model || item.stepModel).length, components.length),
  }
  return {
    status: errors.length ? 'ASSET_RESOLUTION_BLOCKED' : warnings.length ? 'ASSET_RESOLUTION_NEEDS_REVIEW' : 'ASSET_RESOLUTION_READY',
    assetResolution: { coverage, components: components.map((item) => ({ ref: item.ref, symbol: item.symbol || null, footprint: item.footprint || null, model3d: item.model3d || item.model || item.stepModel || null })) },
    warnings,
    errors,
    actions: errors.length ? ['resolve_component_assets', 'sync_component_database'] : ['link_3d_models', 'validate_3d_model_coverage'],
    humanReviewRequired: true,
  }
}

export function auditPlacementLegality(context = {}) {
  const board = context.board || {}
  const components = normalizeComponents(context.components || [])
  const clearance = Number(context.clearanceMm || 0.35)
  const bounds = boardBounds(board)
  const boardArea = Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY))
  const componentArea = components.reduce((sum, component) => sum + component.width * component.height, 0)
  const density = componentArea / boardArea
  const warnings = []
  const errors = []
  const refs = new Set()
  const connectorReports = []
  const keepoutReports = []
  const clearancePairs = []
  if (!Array.isArray(board.outline) || board.outline.length < 3) errors.push(issue('ERROR', 'BOARD_OUTLINE_MISSING_FOR_PLACEMENT', 'Placement legality needs a real Edge.Cuts outline.'))
  if (density > 0.62) errors.push(issue('ERROR', 'PLACEMENT_DENSITY_TOO_HIGH', 'Component area exceeds practical automated placement/routing density.', { density: round(density), maxRecommended: 0.62 }))
  else if (density > 0.45) warnings.push(issue('WARNING', 'PLACEMENT_DENSITY_HIGH', 'Component density is high; use more layers, a larger board, or tighter reviewed packages.', { density: round(density), reviewAt: 0.45 }))
  for (const component of components) {
    if (refs.has(component.ref)) errors.push(issue('ERROR', 'DUPLICATE_COMPONENT_REF', `${component.ref} appears more than once in placement.`, { ref: component.ref }))
    refs.add(component.ref)
    if (!component.width || !component.height) errors.push(issue('ERROR', 'COMPONENT_DIMENSIONS_MISSING', `${component.ref} needs package width and height before placement can be trusted.`, { ref: component.ref }))
    if (!hasPlacement(component)) {
      errors.push(issue('ERROR', 'COMPONENT_UNPLACED', `${component.ref} has no legal placement.`, { ref: component.ref }))
      continue
    }
    const cornerFailures = (board.outline || []).length ? corners(component, clearance).filter((corner) => !pointInPolygon(corner, board.outline)) : []
    if (cornerFailures.length) errors.push(issue('ERROR', 'COMPONENT_OFF_BOARD', `${component.ref} extends outside Edge.Cuts or violates board-edge clearance.`, { ref: component.ref, failedCorners: cornerFailures.length, clearanceMm: clearance }))
    for (const hole of board.mountingHoles || []) {
      const holeBox = { x: hole.x, y: hole.y, width: Number(hole.diameterMm || 0) + clearance * 2 + 1, height: Number(hole.diameterMm || 0) + clearance * 2 + 1 }
      if (rectsOverlap(component, holeBox, 0)) errors.push(issue('ERROR', 'PLACEMENT_MOUNTING_HOLE_CONFLICT', `${component.ref} violates mounting-hole keepout ${hole.id || 'hole'}.`, { ref: component.ref, hole }))
    }
    if (isConnector(component)) {
      const edgeDistance = nearestEdgeDistance(component, bounds)
      const report = { ref: component.ref, edgeDistanceMm: round(edgeDistance), rotation: component.rotation || 0, serviceable: edgeDistance <= Math.max(2, clearance + Math.min(component.width, component.height) / 2 + 0.75) }
      connectorReports.push(report)
      if (!report.serviceable) errors.push(issue('ERROR', 'CONNECTOR_NOT_SERVICEABLE_ON_EDGE', `${component.ref} must sit on a board edge with shell/service clearance.`, report))
    }
    if (isRf(component)) {
      const edgeDistance = nearestEdgeDistance(component, bounds)
      const rfReport = { ref: component.ref, edgeDistanceMm: round(edgeDistance), copperKeepoutMm: Number(component.keepoutMm || context.rfKeepoutMm || 8) }
      keepoutReports.push(rfReport)
      if (edgeDistance > 10 && !component.externalAntenna) warnings.push(issue('WARNING', 'RF_ANTENNA_NOT_EDGE_EXPOSED', `${component.ref} is RF/antenna-related but is not near a board edge.`, rfReport))
      for (const other of components) {
        if (other.ref === component.ref) continue
        if (isHot(other) && distance(component, other) < rfReport.copperKeepoutMm + Math.max(other.width, other.height) / 2) errors.push(issue('ERROR', 'HOT_PART_INSIDE_RF_KEEPOUT', `${other.ref} is too close to RF/antenna component ${component.ref}.`, { rf: component.ref, hot: other.ref, distanceMm: round(distance(component, other)), keepoutMm: rfReport.copperKeepoutMm }))
      }
    }
    if (isHot(component)) {
      for (const other of components.filter(isSensitive)) {
        if (other.ref !== component.ref && distance(component, other) < 8) warnings.push(issue('WARNING', 'HOT_PART_NEAR_SENSITIVE_COMPONENT', `${component.ref} is close to sensitive component ${other.ref}.`, { hot: component.ref, sensitive: other.ref, distanceMm: round(distance(component, other)) }))
      }
    }
  }
  for (let a = 0; a < components.length; a += 1) {
    for (let b = a + 1; b < components.length; b += 1) {
      if (hasPlacement(components[a]) && hasPlacement(components[b]) && rectsOverlap(components[a], components[b], clearance)) {
        const pair = { refs: [components[a].ref, components[b].ref], clearanceMm: clearance }
        clearancePairs.push(pair)
        errors.push(issue('ERROR', 'COMPONENT_OVERLAP', `${components[a].ref} overlaps or violates clearance to ${components[b].ref}.`, pair))
      }
    }
  }
  for (const passive of components.filter(isSupportPassive)) {
    const nearestActive = components.filter((component) => !isSupportPassive(component) && !isConnector(component)).map((component) => ({ ref: component.ref, distanceMm: distance(passive, component) })).sort((a, b) => a.distanceMm - b.distanceMm)[0]
    if (nearestActive && nearestActive.distanceMm > 10) warnings.push(issue('WARNING', 'SUPPORT_PASSIVE_TOO_FAR_FROM_ACTIVE', `${passive.ref} is far from the active device it probably supports.`, { passive: passive.ref, nearestActiveRef: nearestActive.ref, distanceMm: round(nearestActive.distanceMm) }))
  }
  const gates = [
    gate('outline', !errors.some((item) => item.code === 'BOARD_OUTLINE_MISSING_FOR_PLACEMENT')),
    gate('component_dimensions', !errors.some((item) => item.code === 'COMPONENT_DIMENSIONS_MISSING')),
    gate('inside_edge_cuts', !errors.some((item) => item.code === 'COMPONENT_OFF_BOARD')),
    gate('clearance_no_overlap', !errors.some((item) => item.code === 'COMPONENT_OVERLAP')),
    gate('mounting_keepouts', !errors.some((item) => item.code === 'PLACEMENT_MOUNTING_HOLE_CONFLICT')),
    gate('connectors_serviceable', !errors.some((item) => item.code === 'CONNECTOR_NOT_SERVICEABLE_ON_EDGE')),
    gate('rf_hot_keepouts', !errors.some((item) => item.code === 'HOT_PART_INSIDE_RF_KEEPOUT')),
    gate('density', !errors.some((item) => item.code === 'PLACEMENT_DENSITY_TOO_HIGH'), density > 0.45 ? 'review' : 'pass'),
  ]
  return {
    status: errors.length ? 'PLACEMENT_LEGALITY_BLOCKED' : warnings.length ? 'PLACEMENT_LEGALITY_NEEDS_REVIEW' : 'PLACEMENT_LEGALITY_READY_NEEDS_DRC',
    placementLegality: {
      checkedComponents: components.length,
      clearanceMm: clearance,
      density: round(density),
      componentAreaMm2: round(componentArea),
      boardAreaMm2: round(boardArea),
      board: { widthMm: board.widthMm, heightMm: board.heightMm, outlinePoints: board.outline?.length || 0 },
      gates,
      connectorReports,
      keepoutReports,
      clearancePairs,
    },
    warnings,
    errors,
    actions: errors.length ? placementActions(errors) : warnings.length ? ['optimize_placement', 'audit_placement_legality', 'run_kicad_drc'] : ['validate_placement', 'run_kicad_drc'],
    humanReviewRequired: true,
  }
}

export function compileRoutingExecutionStrategy(context = {}) {
  const nets = normalizeNets(context.nets || context.canonicalNetModel?.nets || [])
  const board = context.board || {}
  const stackup = context.stackup || {}
  const highSpeed = nets.filter((net) => /USB|ETH|DP|DN|_P$|_N$|CAN|RF|CLK/i.test(net.name))
  const power = nets.filter((net) => /VBAT|VIN|5V|3V3|VCC|PHASE|MOTOR|PWR/i.test(net.name))
  const strategy = [
    step('pre_route_legalization', ['audit_placement_legality', 'validate_component_bindings'], 'No routing until placement and assets are legal.'),
    step('escape_routing', ['plan_escape_routing', 'select_via_strategy'], 'Fanout dense packages before global routing.'),
    step('critical_nets_first', ['plan_diff_pair_tuning', 'route_diff_pair', 'route_critical_nets'], 'Route USB/Ethernet/CAN/RF/clock before low-speed signals.'),
    step('power_distribution', ['calculate_power_routing', 'route_power_nets', 'plan_copper_pours'], 'Size power copper from current and thermal constraints.'),
    step('signal_completion', ['route_signal_net', 'autoroute_board'], 'Route remaining low-speed nets inside clearance rules.'),
    step('repair_loop', ['validate_routing_geometry', 'autoroute_drc_iteration', 'plan_autoroute_repair_loop'], 'Iterate only from structured DRC/routing reports.'),
    step('release_proof', ['run_kicad_erc', 'run_kicad_drc', 'audit_release_export_gates'], 'Manufacturing export is blocked until reports exist and gates pass.'),
  ]
  const warnings = [
    ...(highSpeed.length ? [issue('WARNING', 'HIGH_SPEED_REVIEW_REQUIRED', `${highSpeed.length} high-speed/sensitive net(s) require impedance, length, and via review.`)] : []),
    ...(stackup.hdi?.allowed || board.allowBlindVias ? [issue('WARNING', 'ADVANCED_VIA_STACKUP_REVIEW_REQUIRED', 'Blind/buried/microvias need manufacturer-approved layer pairs before routing.')] : []),
  ]
  return {
    status: 'ROUTING_EXECUTION_STRATEGY_READY_NEEDS_REVIEW',
    routingExecutionStrategy: { highSpeedNetCount: highSpeed.length, powerNetCount: power.length, layerCount: board.layerCount || stackup.layerCount || null, strategy, viaPolicy: viaPolicy(board, stackup), copperPolicy: copperPolicy(nets) },
    warnings,
    errors: [],
    humanReviewRequired: true,
  }
}

export function auditReleaseExportGates(context = {}) {
  const checks = productionChecks(context)
  const errors = checks.filter((check) => check.severity === 'ERROR').map((check) => issue('ERROR', check.id, check.why, check))
  const warnings = checks.filter((check) => check.severity === 'WARNING').map((check) => issue('WARNING', check.id, check.why, check))
  return {
    status: errors.length ? 'RELEASE_EXPORT_GATES_BLOCKED' : warnings.length ? 'RELEASE_EXPORT_GATES_NEED_REVIEW' : 'RELEASE_EXPORT_GATES_READY_FOR_FINAL_REVIEW',
    releaseExportGates: { score: Math.max(0, 100 - errors.length * 6 - warnings.length * 2), checks },
    warnings,
    errors,
    actions: errors.length ? ['run_production_readiness_suite', 'run_kicad_erc', 'run_kicad_drc'] : ['export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'package_jlcpcb'],
    humanReviewRequired: true,
  }
}

export function runProductionReadinessSuite(context = {}) {
  const canonical = buildCanonicalNetModel(context)
  const mergedContext = { ...context, canonicalNetModel: canonical.canonicalNetModel, nets: canonical.canonicalNetModel.nets }
  const assets = auditAssetResolution(mergedContext)
  const placement = auditPlacementLegality(mergedContext)
  const routing = compileRoutingExecutionStrategy(mergedContext)
  const release = auditReleaseExportGates({ ...mergedContext, canonical, assets, placement, routing })
  const errors = [...canonical.errors, ...assets.errors, ...placement.errors, ...routing.errors, ...release.errors]
  const warnings = [...canonical.warnings, ...assets.warnings, ...placement.warnings, ...routing.warnings, ...release.warnings]
  return {
    status: errors.length ? 'PRODUCTION_SUITE_BLOCKED' : warnings.length ? 'PRODUCTION_SUITE_NEEDS_REVIEW' : 'PRODUCTION_SUITE_READY_FOR_FINAL_REVIEW',
    productionSuite: {
      score: Math.max(0, Math.min(canonicalScore(canonical), release.releaseExportGates.score) - errors.length * 3 - warnings.length),
      canonical: canonical.canonicalNetModel,
      assetResolution: assets.assetResolution,
      placementLegality: placement.placementLegality,
      routingExecutionStrategy: routing.routingExecutionStrategy,
      releaseExportGates: release.releaseExportGates,
    },
    warnings,
    errors,
    actions: errors.length ? nextActions(errors) : release.actions,
    humanReviewRequired: true,
  }
}

function productionChecks(context) {
  const canonical = context.canonical || {}
  const assets = context.assets || {}
  const placement = context.placement || {}
  const routing = context.routing || {}
  const reports = context.reports || context.validation || {}
  const manufacturing = context.manufacturing || {}
  const jlcpcb = context.jlcpcbPackageValidation || context.jlcpcb || {}
  return [
    check('REAL_SCHEMATIC_WRITER', !hasErrors(canonical) && Boolean(context.schematic || context.schematicModel), 'Schematic model/file must exist.'),
    check('REAL_FOOTPRINT_PLACER', !hasErrors(placement) && (context.components || []).every(hasPlacement), 'All footprints must have legal placements.'),
    check('NETLIST_AUTHORITY', !hasErrors(canonical), 'Canonical net model must be clean.'),
    check('CONSTRAINT_COMPILER', Boolean(context.designConstraints || context.kicadRules || context.rules), 'KiCad rules/constraints must be generated.'),
    check('STACKUP_GENERATOR', Boolean(context.stackup || context.board?.layerCount), 'Stackup/layer policy must exist.'),
    check('SYMBOL_RESOLVER', !assets.errors?.some((item) => item.code === 'SYMBOL_MISSING'), 'All symbols must be resolved.'),
    check('FOOTPRINT_RESOLVER', !assets.errors?.some((item) => item.code === 'FOOTPRINT_MISSING'), 'All footprints must be resolved.'),
    check('MODEL_3D_RESOLVER', !assets.warnings?.some((item) => item.code === 'MODEL_3D_MISSING'), '3D models should be linked for KiCad 3D review.', 'WARNING'),
    check('DATASHEET_PIN_EXTRACTION', Boolean(context.referenceDesign || context.pinAssignments || context.userBom), 'Datasheet/BOM/reference input must be ingested.'),
    check('BOM_VALIDATOR', Boolean(context.bomSourcing || context.userBomAudit || manufacturing.bom), 'BOM sourcing/package audit must run.'),
    check('PLACEMENT_LEGALITY', !hasErrors(placement), 'Placement must have no overlap/off-board blockers.'),
    check('PLACEMENT_OPTIMIZER', Boolean(context.placementSolver || context.placement), 'Placement solver/optimizer must run.'),
    check('VIA_STRATEGY', Boolean(context.viaStrategy || routing.routingExecutionStrategy?.viaPolicy), 'Via strategy must be compiled.'),
    check('ESCAPE_ROUTING', Boolean(context.escapeRouting || routing.routingExecutionStrategy), 'Escape routing plan must exist for dense parts.'),
    check('DIFF_PAIR_PLANNER', Boolean(context.diffPairTuning || routing.routingExecutionStrategy), 'Differential pair policy must exist.'),
    check('POWER_ROUTING', Boolean(context.powerRouting || context.powerIntegrity || context.powerTree), 'Power routing/current plan must exist.'),
    check('COPPER_ZONE_WRITER', Boolean(context.copperPourPlan || routing.routingExecutionStrategy?.copperPolicy), 'Copper pour policy must exist.'),
    check('RF_ANTENNA_KEEPOUT', !requiresRf(context) || Boolean(context.noiseMap || context.designIntent?.zones), 'RF/antenna keepouts must exist when RF is present.'),
    check('THERMAL_KEEPOUT', !requiresThermal(context) || Boolean(context.thermalBottlenecks || context.powerIntegrity), 'Thermal review must exist for hot/current boards.'),
    check('AUTOROUTER_INTEGRATION', Boolean(context.routing?.autoroute || context.routingPlan || context.routeQuality), 'Autorouter/routing plan must exist.'),
    check('ERC_REPAIR_LOOP', Boolean(reports.erc || context.ercRepair || context.releaseGateReport), 'ERC report or repair plan must exist.'),
    check('DRC_REPAIR_LOOP', Boolean(reports.drc || context.drcRepair || context.autorouteRepairLoop), 'DRC report or repair loop must exist.'),
    check('JLCPCB_VALIDATOR', Boolean(jlcpcb.status || manufacturing.status), 'JLCPCB/manufacturing readiness validator must run.'),
    check('PROJECT_REPORT', Boolean(context.projectReviewReport || context.designAudit || context.releaseGateReport), 'Project report/release gate must exist.'),
    check('CODEX_WORKFLOW_RECIPES', Boolean(context.verifiedDemoRecipe || context.productionPipeline), 'Codex workflow recipe/pipeline must exist.'),
  ]
}

function check(id, pass, why, severity = 'ERROR') {
  return { id, pass: Boolean(pass), severity: pass ? 'PASS' : severity, why }
}

function normalizeComponents(components) {
  return (components || []).map((component) => ({
    ...component,
    ref: component.ref || component.reference || component.designator || '',
    symbol: component.symbol?.libId || component.symbol || null,
    footprint: component.footprint?.libId || component.footprint || null,
    model3d: component.model3d?.path || component.model3d || component.model || component.stepModel || null,
    width: Number(component.width || component.widthMm || component.size?.widthMm || 2),
    height: Number(component.height || component.heightMm || component.size?.heightMm || 2),
    x: numberOr(component.x, component.at?.x),
    y: numberOr(component.y, component.at?.y),
    pinMap: component.pinMap || {},
  }))
}

function normalizeNets(nets) {
  const map = new Map()
  for (const net of nets || []) {
    const name = typeof net === 'string' ? net : net?.name
    if (!name) continue
    map.set(name, { ...(typeof net === 'string' ? {} : net), name, className: net?.className || classifyNet(name), pins: [...(net?.pins || [])] })
  }
  return [...map.values()]
}

function classifyNet(name) {
  if (/GND|AGND|PGND/i.test(name)) return 'GROUND'
  if (/USB|ETH|DP|DN|CAN|RF|CLK/i.test(name)) return 'HIGH_SPEED'
  if (/VBAT|VIN|5V|3V3|VCC|PHASE/i.test(name)) return 'POWER'
  return 'DEFAULT'
}

function hasPlacement(component) {
  return Number.isFinite(component.x) && Number.isFinite(component.y) && component.width > 0 && component.height > 0
}

function boardBounds(board) {
  if (Array.isArray(board.outline) && board.outline.length >= 3) return polygonBounds(board.outline)
  const width = Number(board.widthMm || board.width || 0)
  const height = Number(board.heightMm || board.height || 0)
  return { minX: 0, minY: 0, maxX: width, maxY: height }
}

function corners(component, clearance = 0) {
  const halfW = component.width / 2 + clearance
  const halfH = component.height / 2 + clearance
  return [{ x: component.x - halfW, y: component.y - halfH }, { x: component.x + halfW, y: component.y - halfH }, { x: component.x + halfW, y: component.y + halfH }, { x: component.x - halfW, y: component.y + halfH }]
}

function nearestEdgeDistance(component, bounds) {
  return Math.min(
    Math.abs(component.x - bounds.minX),
    Math.abs(bounds.maxX - component.x),
    Math.abs(component.y - bounds.minY),
    Math.abs(bounds.maxY - component.y),
  )
}

function isConnector(component) {
  return /USB|RJ45|CONNECTOR|HEADER|JST|TERMINAL/i.test(`${component.ref} ${component.group || ''} ${component.value || ''} ${component.footprint || ''}`)
}

function isRf(component) {
  return /RF|ANT|WIFI|BLE|GNSS|LTE/i.test(`${component.ref} ${component.group || ''} ${component.value || ''}`)
}

function isHot(component) {
  return /BUCK|BOOST|LDO|MOSFET|REG|SHUNT|INDUCTOR|MOTOR|HOT/i.test(`${component.ref} ${component.group || ''} ${component.value || ''}`)
}

function isSensitive(component) {
  return /IMU|GYRO|ACCEL|MAG|SENSOR|ADC|ANALOG|CRYSTAL|XTAL|RF|ANT|WIFI|BLE|GNSS|LTE/i.test(`${component.ref} ${component.group || ''} ${component.value || ''}`)
}

function isSupportPassive(component) {
  return /^(R|C|L|FB|Y)\d+/i.test(component.ref || '') || /RES|CAP|INDUCTOR|FERRITE|CRYSTAL/i.test(`${component.group || ''} ${component.value || ''}`)
}

function gate(name, pass, overrideStatus = null) {
  return { name, status: overrideStatus || (pass ? 'pass' : 'blocked') }
}

function placementActions(errors) {
  const codes = new Set(errors.map((item) => item.code))
  return [
    ...(codes.has('BOARD_OUTLINE_MISSING_FOR_PLACEMENT') ? ['create_outline_board', 'apply_edge_cuts'] : []),
    ...(codes.has('COMPONENT_DIMENSIONS_MISSING') ? ['resolve_component_assets', 'sync_component_database'] : []),
    ...(codes.has('COMPONENT_OFF_BOARD') || codes.has('COMPONENT_OVERLAP') || codes.has('PLACEMENT_MOUNTING_HOLE_CONFLICT') || codes.has('PLACEMENT_DENSITY_TOO_HIGH') ? ['solve_placement', 'optimize_placement', 'apply_placement_plan'] : []),
    ...(codes.has('CONNECTOR_NOT_SERVICEABLE_ON_EDGE') ? ['move_component', 'solve_placement'] : []),
    ...(codes.has('HOT_PART_INSIDE_RF_KEEPOUT') ? ['build_noise_map', 'optimize_placement'] : []),
    'audit_placement_legality',
  ]
}

function distance(a, b) {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0))
}

function viaPolicy(board, stackup) {
  const layerCount = board.layerCount || stackup.layerCount || 2
  const allowAdvanced = Boolean(board.allowBlindVias || stackup.hdi?.allowed)
  return {
    throughVias: true,
    blindVias: allowAdvanced,
    buriedVias: allowAdvanced && layerCount >= 6,
    microvias: allowAdvanced && layerCount >= 4,
    reviewRequired: allowAdvanced,
    rule: allowAdvanced ? 'Use blind/buried/microvias only when manufacturer stackup and layer pairs are approved.' : 'Use through vias only.',
  }
}

function copperPolicy(nets) {
  return {
    groundPour: nets.some((net) => /GND/i.test(net.name)),
    powerPours: nets.filter((net) => /VBAT|VIN|5V|3V3|VCC/i.test(net.name)).map((net) => net.name),
    stitching: 'Add GND stitching around board edge, RF keepouts, connectors, and high-current returns after DRC review.',
  }
}

function step(id, jobs, why) {
  return { id, jobs, why }
}

function requiresRf(context) {
  const text = JSON.stringify(context)
  return /RF|ANT|WIFI|WI-FI|BLE|GNSS|LTE/i.test(text)
}

function requiresThermal(context) {
  const text = JSON.stringify(context)
  return /MOTOR|MOSFET|BUCK|BOOST|POWER|VBAT|THERMAL|CURRENT/i.test(text)
}

function hasErrors(result) {
  return Boolean(result?.errors?.length)
}

function ratio(done, total) {
  return total ? round((done / total) * 100) : 100
}

function canonicalScore(canonical) {
  return Math.max(0, 100 - (canonical.errors || []).length * 10 - (canonical.warnings || []).length * 3)
}

function nextActions(errors) {
  const codes = new Set(errors.map((error) => error.code))
  return [
    ...(codes.has('SYMBOL_MISSING') || codes.has('FOOTPRINT_MISSING') ? ['resolve_component_assets'] : []),
    ...(codes.has('COMPONENT_OVERLAP') || codes.has('COMPONENT_OFF_BOARD') || codes.has('COMPONENT_UNPLACED') ? ['solve_placement'] : []),
    ...(codes.has('NETLIST_AUTHORITY') || codes.has('NET_HAS_FEWER_THAN_TWO_PINS') ? ['build_canonical_net_model'] : []),
    'run_production_readiness_suite',
  ]
}

function blocked(code, message) {
  return { status: 'PRODUCTION_SUITE_BLOCKED', warnings: [], errors: [issue('ERROR', code, message)], humanReviewRequired: true }
}

function isPowerSymbol(name) {
  return /^(GND|AGND|PGND|3V3|5V|VIN|VBAT|VUSB|VCC)$/i.test(name)
}

function numberOr(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return undefined
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
