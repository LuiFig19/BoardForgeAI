import { polygonBounds, round } from './geometry.mjs'

export function planAssemblyAndMechanical(board = {}, components = [], input = {}) {
  const bounds = board.outline?.length ? polygonBounds(board.outline) : { minX: 0, minY: 0, maxX: board.widthMm || 50, maxY: board.heightMm || 30 }
  const assemblyMode = input.assemblyMode || input.assemblyTarget || 'single_sided_preferred'
  const sidePlan = components.map((component) => componentSide(component, assemblyMode))
  const connectorAccess = components.filter(isConnector).map((component) => connectorAccessRule(component, bounds))
  const serviceAccess = components.filter(isServicePart).map((component) => ({
    ref: component.ref,
    group: component.group,
    rule: 'must_remain_hand_accessible_after_enclosure_mounting',
    minFingerClearanceMm: component.group === 'SWD' ? 6 : 4,
    preferredEdge: nearestEdge(component, bounds),
  }))
  const assemblyWarnings = [
    ...sidePlan.filter((item) => item.side === 'B.Cu').map((item) => ({ severity: 'WARNING', code: 'DOUBLE_SIDED_ASSEMBLY_REVIEW', message: `${item.ref} is planned for bottom-side assembly; confirm cost and process.` })),
    ...connectorAccess.filter((item) => item.edgeDistanceMm > item.maxEdgeDistanceMm).map((item) => ({ severity: 'WARNING', code: 'CONNECTOR_TOO_FAR_FROM_EDGE', message: `${item.ref} should move closer to ${item.preferredEdge} edge for cable access.` })),
  ]
  return {
    status: assemblyWarnings.length ? 'ASSEMBLY_MECHANICAL_PLAN_NEEDS_REVIEW' : 'ASSEMBLY_MECHANICAL_PLAN_READY',
    assemblyMode,
    sidePlan,
    connectorAccess,
    serviceAccess,
    panelization: panelizationHints(board, input),
    warnings: assemblyWarnings,
    humanReviewRequired: true,
  }
}

function componentSide(component, assemblyMode) {
  if (component.side) return { ref: component.ref, side: component.side, reason: 'explicit component side' }
  if (assemblyMode === 'single_sided_preferred') return { ref: component.ref, side: 'F.Cu', reason: 'default to top side for lower assembly cost' }
  if (/(test|pad|program|swd)/i.test(`${component.group} ${component.value}`)) return { ref: component.ref, side: 'F.Cu', reason: 'service/debug access' }
  return { ref: component.ref, side: component.group === 'CAP' || component.group === 'RES' ? 'either' : 'F.Cu', reason: 'assembly review' }
}

function connectorAccessRule(component, bounds) {
  const edge = nearestEdge(component, bounds)
  return {
    ref: component.ref,
    group: component.group,
    preferredEdge: edge,
    edgeDistanceMm: round(edgeDistance(component, bounds, edge), 2),
    maxEdgeDistanceMm: ['USB', 'RJ45', 'POWER_INPUT'].includes(component.group) ? 2.5 : 6,
    keepCableClearanceMm: component.group === 'RJ45' ? 18 : component.group === 'USB' ? 10 : 6,
    rule: 'connector_body_or_mating_direction_must_face_board_edge',
  }
}

function panelizationHints(board, input) {
  const width = board.widthMm || input.widthMm || 0
  const height = board.heightMm || input.heightMm || 0
  return {
    recommendedRails: width < 25 || height < 25,
    minBreakawayRailMm: 5,
    fiducials: 'add global fiducials for assembled boards and local fiducials near fine-pitch/BGA parts',
    toolingHoles: 'add if panelized or if assembly house requests them',
  }
}

function isConnector(component) {
  return /(USB|RJ45|CONNECTOR|HEADER|POWER_INPUT|ESC_CONNECTOR|SENSOR_CONNECTOR|SWD)/i.test(`${component.group || ''} ${component.value || ''}`)
}

function isServicePart(component) {
  return /(SWD|BOOT|RESET|USB|TEST|PAD|PROGRAM)/i.test(`${component.group || ''} ${component.value || ''}`)
}

function nearestEdge(component, bounds) {
  const distances = {
    left: Math.abs((component.x || 0) - bounds.minX),
    right: Math.abs(bounds.maxX - (component.x || 0)),
    top: Math.abs((component.y || 0) - bounds.minY),
    bottom: Math.abs(bounds.maxY - (component.y || 0)),
  }
  return Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0]
}

function edgeDistance(component, bounds, edge) {
  if (edge === 'left') return Math.abs((component.x || 0) - bounds.minX)
  if (edge === 'right') return Math.abs(bounds.maxX - (component.x || 0))
  if (edge === 'top') return Math.abs((component.y || 0) - bounds.minY)
  return Math.abs(bounds.maxY - (component.y || 0))
}
