import { polygonBounds, rectanglePoints, round } from './geometry.mjs'
import { getBoardCategory, buildCategoryPlan } from './board-categories.mjs'
import { planRequirements } from './requirements-planner.mjs'
import { scorePlacement } from './placement.mjs'
import {
  chooseRepairOrRegenerate,
  classifyBoardComplexity,
  detectConstraintConflicts,
  detectTemplateReuse,
  recommendAdaptiveStackup,
  scoreRoutability,
} from './universal-board-engine.mjs'

const sizeByGroup = {
  MCU: [10, 10], ESP32_S3: [18, 18], MODULE_CONNECTOR: [22, 18], USB: [12, 4], RJ45: [16, 16],
  REGULATOR: [5, 5], POWER_INPUT: [10, 5], TERMINAL_BLOCK: [28, 8], FIELD_CONNECTOR: [18, 5],
  SENSOR_CONNECTOR: [12, 4], MOTOR_HEADER: [14, 5], LED_OUTPUT: [12, 5], MOSFET: [6, 5],
  GATE_DRIVER: [8, 6], SHUNT: [6, 3], CURRENT_SENSOR: [5, 4], POE_FRONT_END: [14, 12],
  ETHERNET_PHY: [7, 7], ISOLATOR: [8, 6], RELAY_OR_DRIVER: [8, 7], TVS: [3, 2],
  CHARGER_IC: [7, 7], BATTERY_CONNECTOR: [12, 5], CAP: [2.2, 1.2], RES: [2.2, 1.2],
  INDUCTOR: [5, 4], DEFAULT: [4, 3],
}

export function generatePlacementCandidates(input = {}) {
  const requirementsPlan = input.requirementsPlan || planRequirements(input)
  const categoryPlan = input.categoryPlan || buildCategoryPlan(input)
  const category = categoryPlan.category || getBoardCategory(categoryPlan.category?.id || input.category || input.boardType)
  const board = normalizeBoard(input.board || {}, input)
  const sourceComponents = input.components?.length ? input.components : requirementsPlan.components || []
  const components = normalizeComponents(sourceComponents)
  const nets = input.nets || requirementsPlan.nets || []
  const complexity = input.complexity || classifyBoardComplexity({ ...input, board, components, nets, requirementsPlan, categoryPlan })
  const stackup = input.stackupPlan || recommendAdaptiveStackup({ ...input, board, components, nets, requirementsPlan, categoryPlan, complexity })
  const conflicts = input.constraintConflicts || detectConstraintConflicts({ ...input, board, components, nets, requirementsPlan, categoryPlan, complexity })
  const importedPlacement = hasImportedPlacement(sourceComponents)
  const strategies = [
    ...(importedPlacement ? [{ id: 'preserve_existing', reason: 'Preserve imported KiCad coordinates and audit the current board before proposing movement.' }] : []),
    ...strategiesFor(category, complexity),
  ]
  const candidates = strategies.map((strategy, index) => {
    const placed = strategy.id === 'preserve_existing'
      ? preserveExistingPlacement({ board, components, category, complexity })
      : placeByStrategy({ strategy, board, components, category, complexity, index })
    return {
      candidateId: `${category.id || 'board'}-${strategy.id}-${String(index + 1).padStart(2, '0')}`,
      strategy: strategy.id,
      reason: strategy.reason,
      board,
      components: placed.components,
      functionalRegions: placed.functionalRegions,
      connectorEdgeAssignments: placed.connectorEdgeAssignments,
      routingCorridors: placed.routingCorridors,
      powerGroundStrategy: placed.powerGroundStrategy,
      keepouts: placed.keepouts,
      expectedRoutingDifficulty: expectedDifficulty(strategy, complexity, conflicts),
    }
  })
  const scoredCandidates = candidates.map((candidate) => scorePlacementCandidate({ candidate, board, nets, category, complexity, stackup, conflicts, profile: input.profile || {} }))
  const ranked = scoredCandidates.sort((a, b) => b.score - a.score)
  const selected = ranked.find((candidate) => candidate.decision === 'accept') || ranked.find((candidate) => candidate.decision === 'repair') || ranked[0]
  const regeneration = maybeRegeneratePlacement({ input, board, components, nets, category, complexity, stackup, conflicts, selected, ranked })
  const finalSelected = regeneration.regenerated ? regeneration.selectedCandidate : selected
  return {
    status: finalSelected?.decision === 'reject' ? 'PLACEMENT_CANDIDATES_REJECTED' : finalSelected?.decision === 'regenerate' || regeneration.regenerated ? 'PLACEMENT_CANDIDATES_REGENERATED_NEEDS_REVIEW' : 'PLACEMENT_CANDIDATES_READY',
    board,
    category: { id: category.id, name: category.name },
    complexity,
    stackupRecommendation: stackup.recommendation,
    constraints: conflicts,
    strategies: strategies.map((strategy) => strategy.id),
    candidates: ranked,
    selectedCandidate: finalSelected,
    regeneration,
    templateReuseAudit: auditPlacementCandidateDiversity(ranked.map((candidate) => ({
      id: candidate.candidateId,
      category: category.id,
      routingMode: complexity.routingMode,
      board,
      components: candidate.components,
      nets,
      strategy: candidate.strategy,
    })), { importedPlacement }),
    nextActions: nextActions(finalSelected, regeneration),
    humanReviewRequired: true,
  }
}

export function selectPlacementCandidate(input = {}) {
  const candidatePlan = input.candidatePlan || generatePlacementCandidates(input)
  const selected = candidatePlan.selectedCandidate
  const errors = []
  const warnings = []
  if (!selected) errors.push(issue('ERROR', 'NO_PLACEMENT_CANDIDATE_SELECTED', 'No placement candidate was available.'))
  if (selected?.decision === 'reject') errors.push(issue('ERROR', 'SELECTED_PLACEMENT_REJECTED', 'Best placement candidate is still rejected; do not route.'))
  if (selected?.routabilityScore < 60) errors.push(issue('ERROR', 'ROUTABILITY_TOO_LOW_FOR_ROUTING', `Selected placement routability is ${selected.routabilityScore}; regenerate before routing.`))
  if (selected?.decision === 'repair') warnings.push(issue('WARNING', 'PLACEMENT_REPAIR_RECOMMENDED', 'Selected placement needs local repair before routing.'))
  return {
    status: errors.length ? 'PLACEMENT_SELECTION_BLOCKED' : warnings.length ? 'PLACEMENT_SELECTION_NEEDS_REPAIR' : 'PLACEMENT_SELECTION_READY',
    selectedCandidate: selected,
    candidatePlan,
    warnings,
    errors,
    humanReviewRequired: true,
  }
}

export function applySelectedPlacementToPlan(input = {}) {
  const selection = input.selection || selectPlacementCandidate(input)
  const selected = selection.selectedCandidate
  if (!selected || selection.errors?.length) return { status: 'UNIVERSAL_PLACEMENT_APPLY_BLOCKED', components: [], selection }
  return {
    status: 'UNIVERSAL_PLACEMENT_READY_TO_APPLY',
    components: selected.components,
    selection,
    placementMetadata: {
      candidateId: selected.candidateId,
      strategy: selected.strategy,
      score: selected.score,
      routabilityScore: selected.routabilityScore,
      reason: selected.reason,
      strengths: selected.strengths,
      weaknesses: selected.weaknesses,
    },
  }
}

export function scorePlacementCandidate({ candidate, board, nets, category, complexity, stackup, conflicts, profile = {} }) {
  const placementScore = scorePlacement(board, candidate.components, nets, profile)
  const routability = scoreRoutability({
    board,
    components: candidate.components,
    nets,
    categoryPlan: { category },
    complexity,
    stackupPlan: stackup,
    constraintConflicts: conflicts,
    placementScore,
  })
  const templateReuseRisk = templateRisk(candidate, category, complexity)
  const categoryScore = categoryCompliance(candidate, category)
  const powerScore = powerPathScore(candidate)
  const noiseScore = noiseSeparationScore(candidate)
  const connectorScore = connectorAccessibilityScore(candidate)
  const score = Math.max(0, Math.round(
    placementScore.score * 0.25 +
    routability.routabilityScore * 0.3 +
    categoryScore * 0.18 +
    powerScore * 0.12 +
    noiseScore * 0.08 +
    connectorScore * 0.07 -
    templateReuseRisk * 0.18 -
    (conflicts.conflicts?.length || 0) * 25,
  ))
  const weaknesses = [
    ...(placementScore.issues || []).slice(0, 4).map((item) => item.message),
    ...(routability.reasons || []).slice(0, 4),
    ...(templateReuseRisk > 45 ? ['Candidate has high template-reuse risk.'] : []),
    ...(categoryScore < 70 ? ['Candidate misses category-specific placement priorities.'] : []),
  ]
  const strengths = [
    ...(connectorScore >= 80 ? ['connectors are edge/access aligned'] : []),
    ...(powerScore >= 80 ? ['power path is grouped and short'] : []),
    ...(noiseScore >= 80 ? ['noisy and sensitive regions are separated'] : []),
    ...(routability.routabilityScore >= 80 ? ['routing corridors score ready'] : []),
  ]
  const importedPreserveBaseline = candidate.strategy === 'preserve_existing' && !conflicts.conflicts?.length && routability.routabilityScore >= 45
  const decision = conflicts.conflicts?.length ? 'reject' : importedPreserveBaseline ? 'repair' : score >= 80 && routability.routabilityScore >= 80 && templateReuseRisk < 45 ? 'accept'
    : score >= 65 && routability.routabilityScore >= 60 ? 'repair'
      : routability.routabilityScore < 60 ? 'regenerate' : 'reject'
  return {
    ...candidate,
    score,
    placementScore: placementScore.score,
    routabilityScore: routability.routabilityScore,
    routabilityDecision: routability.decision,
    templateReuseRisk,
    categoryRuleScore: categoryScore,
    powerPathScore: powerScore,
    noiseSeparationScore: noiseScore,
    connectorAccessibilityScore: connectorScore,
    strengths,
    weaknesses,
    decision,
    rejectionReasons: decision === 'reject' ? placementRejectionReasons({ conflicts, placementScore, routability, templateReuseRisk, categoryScore }) : [],
    repairReasons: decision === 'repair' ? placementRepairReasons({ importedPreserveBaseline, placementScore, routability, templateReuseRisk, categoryScore }) : [],
  }
}

function placementRejectionReasons({ conflicts, placementScore, routability, templateReuseRisk, categoryScore }) {
  return [
    ...(conflicts.conflicts || []).map((item) => ({ type: item.code || item.type || 'constraint_conflict', count: 1, refs: item.refs || [], fix: item.recommendation || item.message || 'Resolve constraint conflict before routing.' })),
    ...(routability.routabilityScore < 60 ? [{ type: 'routability_too_low', count: 1, refs: [], fix: 'Regenerate placement or increase routing resources.' }] : []),
    ...(placementScore.issues || []).filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)).map((item) => ({ type: item.code || 'placement_error', count: 1, refs: item.ref ? [item.ref] : [], fix: item.message })),
    ...(templateReuseRisk > 70 ? [{ type: 'template_reuse_risk', count: 1, refs: [], fix: 'Regenerate board-specific placement candidate.' }] : []),
    ...(categoryScore < 45 ? [{ type: 'category_rules_failed', count: 1, refs: [], fix: 'Regenerate placement around category-specific regions.' }] : []),
  ]
}

function placementRepairReasons({ importedPreserveBaseline, placementScore, routability, templateReuseRisk, categoryScore }) {
  return [
    ...(importedPreserveBaseline ? [{ type: 'imported_dense_baseline_review', count: 1, refs: [], fix: 'Accept imported KiCad coordinates as baseline; continue DRC/routing readiness before moving components.' }] : []),
    ...(placementScore.issues || []).filter((item) => !['BLOCKER', 'ERROR'].includes(item.severity)).slice(0, 4).map((item) => ({ type: item.code || 'placement_warning', count: 1, refs: item.ref ? [item.ref] : [], fix: item.message })),
    ...(routability.routabilityScore < 80 ? [{ type: 'routability_review', count: 1, refs: [], fix: 'Use staged routing and DRC checkpoints; regenerate only if route gates fail.' }] : []),
    ...(templateReuseRisk > 45 ? [{ type: 'template_reuse_review', count: 1, refs: [], fix: 'Verify imported placement is board-specific and not template reuse.' }] : []),
    ...(categoryScore < 70 ? [{ type: 'category_rule_review', count: 1, refs: [], fix: 'Review category-specific placement priorities before manufacturing.' }] : []),
  ]
}

function maybeRegeneratePlacement({ input, board, components, nets, category, complexity, stackup, conflicts, selected, ranked }) {
  const structural = chooseRepairOrRegenerate({ ...input, board, components: selected?.components || components, nets, complexity, stackupPlan: stackup, constraintConflicts: conflicts, routability: { routabilityScore: selected?.routabilityScore || 0, decision: selected?.routabilityDecision || 'unknown' } })
  if (!['regenerate', 'reject'].includes(selected?.decision) && !structural.action?.includes('regenerate')) {
    return { regenerated: false, reason: 'Selected placement does not require structural regeneration.', structuralDecision: structural }
  }
  const allowResize = input.allowBoardResize !== false
  const allowLayerIncrease = input.allowLayerIncrease !== false
  const grownBoard = {
    ...board,
    widthMm: allowResize ? round((board.widthMm || 50) * 1.15) : board.widthMm,
    heightMm: allowResize ? round((board.heightMm || 30) * 1.1) : board.heightMm,
    layerCount: allowLayerIncrease ? Math.max(board.layerCount || 2, stackup.recommendation?.layerCount || 4) : board.layerCount,
  }
  grownBoard.outline = rectanglePoints(grownBoard.widthMm, grownBoard.heightMm)
  const regeneratedCandidates = strategiesFor(category, complexity).map((strategy, index) => {
    const placed = placeByStrategy({ strategy, board: grownBoard, components, category, complexity, index: index + 10 })
    return scorePlacementCandidate({
      candidate: {
        candidateId: `${category.id || 'board'}-${strategy.id}-regen-${index + 1}`,
        strategy: strategy.id,
        reason: `${strategy.reason}; regenerated after low routability.`,
        board: grownBoard,
        ...placed,
        expectedRoutingDifficulty: expectedDifficulty(strategy, complexity, conflicts),
      },
      board: grownBoard,
      nets,
      category,
      complexity,
      stackup,
      conflicts: { ...conflicts, conflicts: allowResize ? [] : conflicts.conflicts },
      profile: input.profile || {},
    })
  }).sort((a, b) => b.score - a.score)
  const best = regeneratedCandidates[0]
  const improved = best && best.score > (selected?.score || 0)
  return {
    regenerated: Boolean(improved),
    reason: improved ? `Initial placement scored ${selected?.score || 0}; regenerated placement scored ${best.score}.` : 'Regeneration did not improve the selected placement.',
    oldScore: selected?.score || 0,
    newScore: best?.score || selected?.score || 0,
    selectedCandidate: improved ? best : selected,
    board: improved ? grownBoard : board,
    changes: improved ? [
      ...(allowResize ? [`Expanded board to ${grownBoard.widthMm} x ${grownBoard.heightMm} mm.`] : []),
      ...(allowLayerIncrease ? [`Raised layer planning target to ${grownBoard.layerCount} layers.`] : []),
      'Regenerated connector/region placement candidates.',
      'Re-scored routability before accepting placement.',
    ] : [],
    structuralDecision: structural,
    regeneratedCandidates,
  }
}

function placeByStrategy({ strategy, board, components, category, complexity, index }) {
  const bounds = polygonBounds(board.outline)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const regions = regionsFor(strategy, bounds)
  const connectors = components.filter(isConnector)
  const power = components.filter(isPowerComponent)
  const sensitive = components.filter(isSensitiveComponent)
  const active = components.filter((component) => !isConnector(component) && !isPowerComponent(component) && !isSensitiveComponent(component))
  const placed = []
  placeSet(connectors, strategyConnectorSlots(strategy, bounds, connectors.length, index), placed)
  placeSet(power, strategyPowerSlots(strategy, bounds, power.length, index), placed)
  placeSet(sensitive, strategySensitiveSlots(strategy, bounds, sensitive.length, index), placed)
  const remaining = active.filter((component) => !placed.some((item) => item.ref === component.ref))
  placeSet(remaining, strategyActiveSlots(strategy, bounds, remaining.length, index), placed)
  const byRef = new Map(placed.map((component) => [component.ref, component]))
  const componentsOut = components.map((component, componentIndex) => {
    const existing = byRef.get(component.ref)
    if (existing) return existing
    return withSize({ ...component, x: round(cx + ((componentIndex % 5) - 2) * 5), y: round(cy + (Math.floor(componentIndex / 5) - 1) * 5), rotation: 0 })
  })
  return {
    components: componentsOut,
    functionalRegions: regions,
    connectorEdgeAssignments: connectors.map((component) => ({ ref: component.ref, edge: nearestEdge(byRef.get(component.ref) || component, board), reason: strategy.id })),
    routingCorridors: [
      { id: 'central_bus', x: cx, y: cy, widthMm: round(width * 0.55), heightMm: round(Math.max(4, height * 0.16)), purpose: 'main signal/power routing corridor' },
      ...(strategy.id === 'region_separated' ? [{ id: 'isolation_gap', x: cx, y: cy, widthMm: round(width * 0.08), heightMm: round(height * 0.85), purpose: 'field/logic or noisy/quiet separation' }] : []),
    ],
    powerGroundStrategy: powerGroundStrategyFor(strategy, category, complexity),
    keepouts: keepoutsFor(strategy, board, componentsOut),
  }
}

function preserveExistingPlacement({ board, components, category, complexity }) {
  const bounds = polygonBounds(board.outline)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const connectors = components.filter(isConnector)
  const power = components.filter(isPowerComponent)
  const sensitive = components.filter(isSensitiveComponent)
  return {
    components: components.map((component) => withSize(component)),
    functionalRegions: [
      regionFromComponents('existing_connector_io', connectors, bounds),
      regionFromComponents('existing_power_stage', power, bounds),
      regionFromComponents('existing_sensitive_control', sensitive, bounds),
    ].filter(Boolean),
    connectorEdgeAssignments: connectors.map((component) => ({ ref: component.ref, edge: nearestEdge(component, board), reason: 'preserve_existing_imported_position' })),
    routingCorridors: [
      { id: 'existing_main_corridor', x: cx, y: cy, widthMm: round(width * 0.72), heightMm: round(Math.max(4, height * 0.22)), purpose: 'audit current board routing corridor before moving components' },
      ...(complexity.level === 'advanced_review_required' ? [{ id: 'expert_review_zone', x: cx, y: cy, widthMm: round(width * 0.92), heightMm: round(height * 0.92), purpose: 'dense imported board; route and stackup require human review' }] : []),
    ],
    powerGroundStrategy: powerGroundStrategyFor({ id: 'preserve_existing' }, category, complexity),
    keepouts: keepoutsFor({ id: 'preserve_existing' }, board, components),
  }
}

function placeSet(items, slots, placed) {
  items.forEach((item, index) => placed.push(withSize({ ...item, ...(slots[index] || slots[slots.length - 1] || { x: 10 + index * 5, y: 10, rotation: 0 }) })))
}

function strategiesFor(category = {}, complexity = {}) {
  const text = `${category.id || ''} ${category.name || ''} ${complexity.level || ''}`
  const all = [
    { id: 'edge_connector_first', reason: 'Lock edge connectors first, then place active devices around connector fanout.' },
    { id: 'power_first', reason: 'Group power input, regulator/current devices, and high-current outputs before logic.' },
    { id: 'mcu_centered', reason: 'Put controller central with short fanout to connectors/support parts.' },
    { id: 'region_separated', reason: 'Separate field/noisy/power side from logic/sensitive side.' },
    { id: 'dense_compact', reason: 'Pack active devices tightly while preserving routing escape corridors.' },
    { id: 'routing_corridor_optimized', reason: 'Reserve a central corridor between connectors and controller regions.' },
  ]
  if (/motor|power|charger|battery|led/.test(text)) return [all[1], all[3], all[5], all[2]]
  if (/poe|industrial|mixed|ethernet/.test(text)) return [all[3], all[0], all[5], all[2]]
  if (/wearable|dense|compact/.test(text) || ['complex', 'advanced_review_required'].includes(complexity.level)) return [all[4], all[5], all[3], all[2]]
  if (/usb|sensor|embedded|robotics|dev/.test(text)) return [all[0], all[2], all[5], all[3]]
  return [all[2], all[0], all[5]]
}

function regionsFor(strategy, bounds) {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  if (strategy.id === 'region_separated') return [
    { id: 'field_or_power', x: bounds.minX + width * 0.22, y: cy, widthMm: width * 0.36, heightMm: height * 0.85 },
    { id: 'logic_or_sensitive', x: bounds.minX + width * 0.72, y: cy, widthMm: width * 0.42, heightMm: height * 0.85 },
  ]
  if (strategy.id === 'power_first') return [
    { id: 'power_path', x: bounds.minX + width * 0.28, y: cy, widthMm: width * 0.46, heightMm: height * 0.5 },
    { id: 'logic', x: bounds.minX + width * 0.72, y: cy, widthMm: width * 0.36, heightMm: height * 0.65 },
  ]
  return [
    { id: 'controller', x: cx, y: cy, widthMm: width * 0.4, heightMm: height * 0.45 },
    { id: 'edge_io', x: cx, y: cy, widthMm: width * 0.92, heightMm: height * 0.92 },
  ]
}

function strategyConnectorSlots(strategy, bounds, count, index) {
  const inset = 5 + index * 0.7
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const left = bounds.minX + inset
  const right = bounds.maxX - inset
  const top = bounds.minY + inset
  const bottom = bounds.maxY - inset
  const edgeCycle = strategy.id === 'power_first'
    ? [{ x: left, y: cy, rotation: 90 }, { x: right, y: cy, rotation: 270 }, { x: cx, y: bottom, rotation: 0 }, { x: cx, y: top, rotation: 180 }]
    : strategy.id === 'region_separated'
      ? [{ x: left, y: cy, rotation: 90 }, { x: left, y: top + 8, rotation: 90 }, { x: right, y: cy, rotation: 270 }, { x: right, y: bottom - 8, rotation: 270 }]
      : [{ x: left, y: cy, rotation: 90 }, { x: right, y: cy, rotation: 270 }, { x: cx, y: top, rotation: 180 }, { x: cx, y: bottom, rotation: 0 }]
  return Array.from({ length: count }, (_, i) => edgeCycle[i % edgeCycle.length])
}

function strategyPowerSlots(strategy, bounds, count, index) {
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const baseX = strategy.id === 'power_first' || strategy.id === 'region_separated' ? bounds.minX + (bounds.maxX - bounds.minX) * 0.32 : cx - 12
  return Array.from({ length: count }, (_, i) => ({ x: round(baseX + (i % 3) * 7 + index * 0.3), y: round(cy + (Math.floor(i / 3) - 0.5) * 8), rotation: i % 2 ? 90 : 0 }))
}

function strategySensitiveSlots(strategy, bounds, count, index) {
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const baseX = strategy.id === 'region_separated' ? bounds.maxX - (bounds.maxX - bounds.minX) * 0.3 : cx + 10
  return Array.from({ length: count }, (_, i) => ({ x: round(baseX + (i % 2) * 6), y: round(cy - 10 + i * 5 + index * 0.2), rotation: 0 }))
}

function strategyActiveSlots(strategy, bounds, count, index) {
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const tight = strategy.id === 'dense_compact'
  const stepX = tight ? 4.5 : 8
  const stepY = tight ? 4 : 7
  return Array.from({ length: count }, (_, i) => ({
    x: round(cx + ((i % 5) - 2) * stepX + index * 0.5),
    y: round(cy + (Math.floor(i / 5) - 1) * stepY),
    rotation: i % 3 === 0 ? 90 : 0,
  }))
}

function normalizeBoard(board, input) {
  const widthMm = Number(board.widthMm || board.width || input.widthMm || 50)
  const heightMm = Number(board.heightMm || board.height || input.heightMm || 30)
  return { ...board, widthMm, heightMm, layerCount: Number(board.layerCount || input.layerCount || 2), outline: board.outline?.length ? board.outline : rectanglePoints(widthMm, heightMm) }
}

function normalizeComponents(components = []) {
  return components.map((component, index) => withSize({ ref: component.ref || `X${index + 1}`, group: component.group || component.role || 'DEFAULT', ...component }))
}

function withSize(component) {
  const [width, height] = sizeByGroup[component.group] || sizeByGroup[component.role] || sizeByGroup.DEFAULT
  return { width: component.width || width, height: component.height || height, x: round(component.x ?? 10), y: round(component.y ?? 10), rotation: component.rotation || 0, ...component }
}

function isConnector(component) {
  return /connector|usb|rj45|terminal|header|power_input|output|battery/i.test(`${component.group || ''} ${component.role || ''}`)
}

function isPowerComponent(component) {
  return /regulator|mosfet|gate|shunt|current|inductor|fuse|charger|poe|power/i.test(`${component.group || ''} ${component.role || ''} ${component.value || ''}`)
}

function isSensitiveComponent(component) {
  return /sensor|analog|imu|rf|antenna|crystal|ethernet_phy|mcu|esp32|module/i.test(`${component.group || ''} ${component.role || ''} ${component.value || ''}`)
}

function expectedDifficulty(strategy, complexity, conflicts) {
  if (conflicts.conflicts?.length) return 'blocked_by_constraints'
  if (complexity.level === 'advanced_review_required') return 'expert_review'
  if (strategy.id === 'dense_compact') return 'high'
  if (complexity.level === 'complex') return 'moderate_high'
  return 'moderate'
}

function categoryCompliance(candidate, category = {}) {
  const text = `${category.id || ''} ${category.name || ''}`
  let score = 72
  if (/poe|ethernet/.test(text) && candidate.components.some((c) => c.group === 'RJ45' && nearestEdge(c, candidate.board || {}) !== 'center')) score += 12
  if (/industrial/.test(text) && candidate.components.some((c) => c.group === 'TERMINAL_BLOCK')) score += 12
  if (/motor|power/.test(text) && candidate.components.some((c) => c.group === 'MOSFET')) score += 12
  if (/usb|sensor|embedded/.test(text) && candidate.components.some((c) => /MCU|ESP32/.test(c.group))) score += 8
  return Math.min(100, score)
}

function powerPathScore(candidate) {
  const power = candidate.components.filter(isPowerComponent)
  if (power.length < 2) return 82
  const centroid = averagePoint(power)
  const spread = power.reduce((sum, component) => sum + Math.hypot(component.x - centroid.x, component.y - centroid.y), 0) / power.length
  return Math.max(30, Math.round(100 - spread * 3))
}

function noiseSeparationScore(candidate) {
  const power = candidate.components.filter(isPowerComponent)
  const sensitive = candidate.components.filter(isSensitiveComponent)
  if (!power.length || !sensitive.length) return 88
  const minDistance = Math.min(...power.flatMap((p) => sensitive.map((s) => Math.hypot(p.x - s.x, p.y - s.y))))
  return Math.min(100, Math.max(30, Math.round(45 + minDistance * 4)))
}

function connectorAccessibilityScore(candidate) {
  const connectors = candidate.components.filter(isConnector)
  if (!connectors.length) return 100
  const assigned = candidate.connectorEdgeAssignments?.filter((item) => item.edge !== 'center').length || 0
  return Math.round(assigned / connectors.length * 100)
}

function templateRisk(candidate, category, complexity) {
  let risk = 20
  if (candidate.strategy === 'mcu_centered' && /poe|industrial|motor|power/.test(`${category.id} ${category.name}`)) risk += 24
  if (candidate.strategy === 'edge_connector_first' && ['complex', 'advanced_review_required'].includes(complexity.level)) risk += 10
  if (!candidate.functionalRegions?.length) risk += 20
  return Math.min(100, risk)
}

function averagePoint(items) {
  return { x: items.reduce((sum, item) => sum + item.x, 0) / items.length, y: items.reduce((sum, item) => sum + item.y, 0) / items.length }
}

function nearestEdge(component, board) {
  const width = board.widthMm || board.width || 100
  const height = board.heightMm || board.height || 60
  const distances = [
    ['left', Math.abs(component.x)],
    ['right', Math.abs(width - component.x)],
    ['top', Math.abs(component.y)],
    ['bottom', Math.abs(height - component.y)],
  ].sort((a, b) => a[1] - b[1])
  return distances[0]?.[1] <= 12 ? distances[0][0] : 'center'
}

function powerGroundStrategyFor(strategy, category, complexity) {
  if (/motor|power|charger|battery/.test(`${category.id} ${category.name}`)) return 'wide pours, short high-current path, via arrays on layer changes'
  if (/poe|industrial/.test(`${category.id} ${category.name}`)) return 'field/power side separated from low-voltage logic with reviewed returns'
  if (complexity.level === 'simple') return '2-layer ground pour with local power widening'
  return 'continuous GND reference plane and local power pours'
}

function keepoutsFor(strategy, board, components) {
  const rf = components.filter((component) => /rf|antenna|esp32|wifi|ble|module/i.test(`${component.group} ${component.value || ''}`))
  const heat = components.filter(isPowerComponent)
  return [
    ...rf.map((component) => ({ id: `${component.ref}_antenna_keepout`, kind: 'rf_antenna', x: component.x, y: component.y, widthMm: (component.width || 8) + 6, heightMm: (component.height || 6) + 8 })),
    ...(strategy.id === 'region_separated' ? [{ id: 'region_boundary', kind: 'isolation_or_noise_boundary', x: (board.widthMm || 50) / 2, y: (board.heightMm || 30) / 2, widthMm: 4, heightMm: (board.heightMm || 30) * 0.85 }] : []),
    ...heat.slice(0, 4).map((component) => ({ id: `${component.ref}_thermal_review`, kind: 'thermal_spread', x: component.x, y: component.y, widthMm: (component.width || 5) + 4, heightMm: (component.height || 5) + 4 })),
  ]
}

function hasImportedPlacement(components = []) {
  const placed = components.filter((component) => Number.isFinite(Number(component.x)) && Number.isFinite(Number(component.y)))
  if (placed.length < Math.min(3, components.length)) return false
  const unique = new Set(placed.map((component) => `${round(Number(component.x))}:${round(Number(component.y))}`))
  return unique.size >= Math.min(3, placed.length)
}

function regionFromComponents(id, components, fallbackBounds) {
  if (!components.length) return null
  const xs = components.map((component) => Number(component.x)).filter(Number.isFinite)
  const ys = components.map((component) => Number(component.y)).filter(Number.isFinite)
  if (!xs.length || !ys.length) return null
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    id,
    x: round((minX + maxX) / 2),
    y: round((minY + maxY) / 2),
    widthMm: round(Math.max(4, maxX - minX + (fallbackBounds.maxX - fallbackBounds.minX) * 0.08)),
    heightMm: round(Math.max(4, maxY - minY + (fallbackBounds.maxY - fallbackBounds.minY) * 0.08)),
  }
}

function auditPlacementCandidateDiversity(designs, { importedPlacement = false } = {}) {
  const audit = detectTemplateReuse(designs)
  if (!importedPlacement || audit.status !== 'TEMPLATE_REUSE_BLOCKED') return audit
  return {
    ...audit,
    status: 'PLACEMENT_CANDIDATE_DIVERSITY_NEEDS_REVIEW',
    warnings: [
      ...audit.warnings,
      ...audit.errors.map((item) => ({ ...item, severity: 'WARNING', code: 'PLACEMENT_CANDIDATE_SIMILARITY_REVIEW' })),
    ],
    errors: [],
    antiTemplateRules: [
      ...audit.antiTemplateRules,
      'imported KiCad placements may intentionally share board outline and component set across alternatives',
      'preserve_existing must remain available before BoardForge proposes component movement',
    ],
    humanReviewRequired: true,
  }
}

function nextActions(selected, regeneration) {
  if (!selected) return ['generate placement candidates']
  if (selected.strategy === 'preserve_existing') return ['audit imported placement', 'resolve ERC/DRC blockers', 'compile routing execution strategy']
  if (selected.decision === 'accept') return ['apply_placement_plan', 'check_routing_readiness', 'route_critical_nets']
  if (selected.decision === 'repair') return ['optimize_placement', 'score_routability', 'check_routing_readiness']
  if (regeneration.regenerated) return ['review regenerated placement', 'apply_placement_plan', 'run DRC after routing']
  return ['relax constraints or regenerate board outline/stackup before routing']
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
