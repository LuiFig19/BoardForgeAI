import { distancePointToSegment, pointInPolygon, rectCorners } from './geometry.mjs'

export function runDfmChecks({ board = {}, components = [], routes = [], profile = {}, stackup = null, powerTree = null, fanoutPlan = null, options = {} }) {
  const outline = board.outline || []
  const issues = [
    ...checkBoardOutline(board, profile),
    ...checkComponentClearances(board, components, profile),
    ...checkRouteManufacturability(routes, profile),
    ...checkPowerAndThermal(powerTree),
    ...checkFanout(fanoutPlan, options),
    ...checkAssembly(components),
    ...checkSilkscreenAndLabels(components),
    ...checkAdvancedFab(stackup, options),
  ]
  const errors = issues.filter((issue) => issue.severity === 'ERROR' || issue.severity === 'BLOCKER')
  const warnings = issues.filter((issue) => issue.severity === 'WARNING')
  const passed = checksSummary(issues)
  return {
    schemaVersion: 1,
    status: errors.length ? 'DFM_CHECKS_BLOCKED' : warnings.length ? 'DFM_CHECKS_NEEDS_REVIEW' : 'DFM_CHECKS_READY_NEEDS_REVIEW',
    board: {
      widthMm: board.widthMm || null,
      heightMm: board.heightMm || null,
      outlinePointCount: outline.length,
      layerCount: board.layerCount || stackup?.layerCount || null,
    },
    passed,
    issues,
    errors,
    warnings,
    actions: recommendedActions(issues),
    manufacturingGates: {
      requireHumanDfmReview: true,
      requireDrcBeforeExport: true,
      requireErcBeforeExport: true,
      requireAdvancedFabApproval: Boolean(stackup?.hdi?.requiresAdvancedReview),
    },
    humanReviewRequired: true,
  }
}

function checkBoardOutline(board, profile) {
  const issues = []
  const outline = board.outline || []
  if (outline.length < 3) issues.push(issue('ERROR', 'OUTLINE_MISSING', 'Board outline is missing or too small for DFM review.'))
  const minDimension = Math.min(Number(board.widthMm || 0), Number(board.heightMm || 0))
  if (minDimension && minDimension < 10) issues.push(issue('WARNING', 'BOARD_TOO_SMALL_FOR_STANDARD_HANDLING', 'Board is under 10 mm in one dimension; panelization tabs and assembly handling need review.'))
  for (const hole of board.mountingHoles || []) {
    if (outline.length && !pointInPolygon(hole, outline)) issues.push(issue('ERROR', 'MOUNTING_HOLE_OFF_BOARD', `Mounting hole at ${fmt(hole.x)}, ${fmt(hole.y)} is outside the outline.`))
    const edge = outline.length ? distanceToOutline(hole, outline) : Infinity
    const required = Number(profile.mountingHoleEdgeClearanceMm || 1)
    if (edge < required) issues.push(issue('ERROR', 'MOUNTING_HOLE_EDGE_CLEARANCE', `Mounting hole at ${fmt(hole.x)}, ${fmt(hole.y)} is ${fmt(edge)} mm from edge; require ${fmt(required)} mm.`))
  }
  return issues
}

function checkComponentClearances(board, components, profile) {
  const issues = []
  const outline = board.outline || []
  const edgeClearance = Number(profile.componentToEdgeClearanceMm || 0.5)
  const componentClearance = Number(profile.componentToComponentClearanceMm || 0.2)
  for (const component of components) {
    if (!hasPlacement(component)) continue
    const corners = rectCorners(component, 0)
    if (outline.length && corners.some((corner) => !pointInPolygon(corner, outline))) issues.push(issue('ERROR', 'COMPONENT_BODY_OFF_BOARD', `${component.ref} body extends outside the board outline.`, { ref: component.ref }))
    const edgeDistance = outline.length ? Math.min(...corners.map((corner) => distanceToOutline(corner, outline))) : Infinity
    if (edgeDistance < edgeClearance && !isEdgeConnector(component)) issues.push(issue('WARNING', 'COMPONENT_EDGE_CLEARANCE_LOW', `${component.ref} is ${fmt(edgeDistance)} mm from edge; review assembly clearance.`, { ref: component.ref }))
  }
  for (let a = 0; a < components.length; a += 1) {
    for (let b = a + 1; b < components.length; b += 1) {
      const first = components[a]
      const second = components[b]
      if (!hasPlacement(first) || !hasPlacement(second)) continue
      const spacing = rectDistance(first, second)
      if (spacing < componentClearance) issues.push(issue('ERROR', 'COMPONENT_SPACING_VIOLATION', `${first.ref} and ${second.ref} spacing is ${fmt(spacing)} mm; require ${fmt(componentClearance)} mm.`, { refs: [first.ref, second.ref] }))
    }
  }
  return issues
}

function checkRouteManufacturability(routes, profile) {
  const minWidth = Number(profile.minTraceWidthMm || 0.127)
  const minVia = Number(profile.minViaDiameterMm || 0.45)
  const minDrill = Number(profile.minViaDrillMm || 0.2)
  const issues = []
  for (const route of routes || []) {
    if (Number(route.widthMm || route.width || minWidth) < minWidth) issues.push(issue('ERROR', 'TRACE_WIDTH_BELOW_PROFILE', `${route.net || 'route'} width is below ${fmt(minWidth)} mm.`, { net: route.net }))
    for (const via of route.vias || []) {
      if (Number(via.diameterMm || 0) && Number(via.diameterMm) < minVia) issues.push(issue('ERROR', 'VIA_DIAMETER_BELOW_PROFILE', `${route.net || 'route'} via diameter is below ${fmt(minVia)} mm.`, { net: route.net }))
      if (Number(via.drillMm || 0) && Number(via.drillMm) < minDrill) issues.push(issue('ERROR', 'VIA_DRILL_BELOW_PROFILE', `${route.net || 'route'} via drill is below ${fmt(minDrill)} mm.`, { net: route.net }))
    }
  }
  return issues
}

function checkPowerAndThermal(powerTree) {
  if (!powerTree) return [issue('WARNING', 'POWER_TREE_MISSING', 'No BoardForge power-tree report found; rail current and thermal DFM review is limited.')]
  return [
    ...(powerTree.errors || []),
    ...(powerTree.thermalReview || [])
      .filter((item) => item.thermalRisk === 'high')
      .map((item) => issue('ERROR', 'HIGH_THERMAL_RISK', `${item.ref} on ${item.rail} requires thermal mitigation before manufacturing.`, { ref: item.ref })),
    ...(powerTree.thermalReview || [])
      .filter((item) => item.thermalRisk === 'medium')
      .map((item) => issue('WARNING', 'MEDIUM_THERMAL_RISK', `${item.ref} on ${item.rail} needs copper/temperature review.`, { ref: item.ref })),
  ]
}

function checkFanout(fanoutPlan, options) {
  if (!fanoutPlan) return [issue('WARNING', 'FANOUT_PLAN_MISSING', 'No fanout plan found; dense package escape review is limited.')]
  return [
    ...(fanoutPlan.errors || []),
    ...((fanoutPlan.viaPolicy?.microviasAllowed || fanoutPlan.viaPolicy?.blindViasAllowed) && !options.approveAdvancedFab
      ? [issue('ERROR', 'FANOUT_ADVANCED_VIA_APPROVAL_REQUIRED', 'Fanout uses or allows advanced vias; manufacturer approval is required before export.')]
      : []),
  ]
}

function checkAssembly(components) {
  const issues = []
  for (const component of components) {
    if (!component.footprint && !/TEST|PAD|HOLE/i.test(`${component.group || ''} ${component.value || ''}`)) issues.push(issue('WARNING', 'FOOTPRINT_UNRESOLVED_FOR_DFM', `${component.ref} has no resolved footprint for assembly review.`, { ref: component.ref }))
    if (hasPlacement(component) && Number(component.rotation || 0) % 45 !== 0) issues.push(issue('WARNING', 'ODD_COMPONENT_ROTATION', `${component.ref} rotation is not a 45-degree increment; verify pick-and-place orientation.`, { ref: component.ref }))
  }
  return issues
}

function checkSilkscreenAndLabels(components) {
  return components
    .filter((component) => !component.ref || String(component.ref).length > 8)
    .map((component) => issue('WARNING', 'SILK_REF_REVIEW', `${component.ref || 'component'} reference designator may need silkscreen readability review.`, { ref: component.ref }))
}

function checkAdvancedFab(stackup, options) {
  if (stackup?.hdi?.requiresAdvancedReview && !options.approveAdvancedFab) return [issue('ERROR', 'ADVANCED_STACKUP_DFM_APPROVAL_REQUIRED', 'HDI/blind/buried/microvia stackup needs manufacturer approval before manufacturing handoff.')]
  return []
}

function checksSummary(issues) {
  const categories = ['outline', 'component_clearance', 'routing', 'power_thermal', 'fanout', 'assembly', 'advanced_fab']
  return categories.map((category) => ({
    category,
    status: issues.some((item) => item.code.includes(category.toUpperCase().split('_')[0])) ? 'review' : 'checked',
  }))
}

function recommendedActions(issues) {
  const actions = []
  const codes = new Set(issues.map((issueItem) => issueItem.code))
  if (codes.has('COMPONENT_BODY_OFF_BOARD') || codes.has('COMPONENT_SPACING_VIOLATION')) actions.push('Run optimize_placement, then apply_placement_plan after review.')
  if (codes.has('TRACE_WIDTH_BELOW_PROFILE') || codes.has('VIA_DIAMETER_BELOW_PROFILE')) actions.push('Regenerate routing plan with manufacturer profile constraints.')
  if (codes.has('POWER_TREE_MISSING')) actions.push('Run plan_power_tree before routing/export.')
  if (codes.has('FANOUT_PLAN_MISSING')) actions.push('Run plan_fanout before routing/export.')
  if ([...codes].some((code) => code.includes('ADVANCED'))) actions.push('Get manufacturer stackup/HDI approval or disable advanced vias.')
  if ([...codes].some((code) => code.includes('FOOTPRINT'))) actions.push('Run resolve_component_assets and audit_component_library.')
  return [...new Set(actions)]
}

function hasPlacement(component) {
  return Number.isFinite(Number(component.x)) && Number.isFinite(Number(component.y)) && Number(component.width || 0) > 0 && Number(component.height || 0) > 0
}

function isEdgeConnector(component) {
  return /USB|RJ45|CONNECTOR|HEADER|POWER_INPUT|ESC/i.test(`${component.group || ''} ${component.value || ''}`)
}

function distanceToOutline(point, outline) {
  if (!outline.length) return Infinity
  return Math.min(...outline.map((start, index) => distancePointToSegment(point, start, outline[(index + 1) % outline.length])))
}

function rectDistance(a, b) {
  const dx = Math.max(0, Math.abs(Number(a.x) - Number(b.x)) - (Number(a.width) + Number(b.width)) / 2)
  const dy = Math.max(0, Math.abs(Number(a.y) - Number(b.y)) - (Number(a.height) + Number(b.height)) / 2)
  return Math.hypot(dx, dy)
}

function issue(severity, code, message, data = {}) {
  return { severity, code, message, ...data }
}

function fmt(value) {
  return Number(value || 0).toFixed(2)
}
