import { distance, hasSelfIntersections, pointInPolygon, polygonArea, rectCorners, rectsOverlap } from './geometry.mjs'
import { validateNetClasses } from './net-classes.mjs'

export const issue = (severity, code, message, details = {}) => ({ severity, code, message, details })
export const splitIssues = (issues) => ({
  blockers: issues.filter((item) => item.severity === 'BLOCKER'),
  errors: issues.filter((item) => item.severity === 'ERROR'),
  warnings: issues.filter((item) => item.severity === 'WARNING'),
  info: issues.filter((item) => item.severity === 'INFO'),
})
export const statusFromIssues = (issues, preferred = 'NEEDS_HUMAN_REVIEW') => issues.some((item) => item.severity === 'BLOCKER') ? 'VALIDATION_FAILED' : issues.some((item) => item.severity === 'ERROR') ? 'NEEDS_FIX' : preferred

export function validateBoardOutline(board, profile) {
  const issues = []
  const points = board.outline || []
  if (points.length < 3) return [issue('BLOCKER', 'OUTLINE_TOO_FEW_POINTS', 'Board outline needs at least three points.')]
  if (Math.abs(polygonArea(points)) < 1) issues.push(issue('BLOCKER', 'OUTLINE_ZERO_AREA', 'Board outline area is too small or invalid.'))
  if (hasSelfIntersections(points)) issues.push(issue('BLOCKER', 'OUTLINE_SELF_INTERSECTION', 'Board outline has self-intersecting Edge.Cuts geometry.'))
  const minEdge = Math.max(0.25, profile.edgeClearanceMm || 0.35)
  const shortSegments = points
    .map((point, index) => ({ start: point, end: points[(index + 1) % points.length], lengthMm: distance(point, points[(index + 1) % points.length]) }))
    .filter((segment) => segment.lengthMm < minEdge)
  if (shortSegments.length) issues.push(issue('WARNING', 'OUTLINE_SHORT_EDGE_SEGMENTS', 'Board outline has very short Edge.Cuts segments that may create fabrication or DRC noise.', { count: shortSegments.length, minEdgeMm: minEdge }))
  const acuteAngles = outlineAngles(points).filter((angle) => angle.degrees < 35)
  if (acuteAngles.length) issues.push(issue('WARNING', 'OUTLINE_ACUTE_CORNERS', 'Board outline has sharp acute corners; consider radius/fillets for manufacturing.', { count: acuteAngles.length, minDegrees: Math.min(...acuteAngles.map((angle) => angle.degrees)) }))
  for (const hole of board.mountingHoles || []) {
    const radius = hole.diameterMm / 2
    if (!pointInPolygon(hole, points)) issues.push(issue('ERROR', 'MOUNTING_HOLE_OUTSIDE_BOARD', `${hole.id} is outside the board outline.`, { hole }))
    const nearestEdge = nearestDistanceToPolygonEdge(hole, points)
    const required = radius + profile.mountingHoleEdgeClearanceMm
    if (nearestEdge < required) issues.push(issue('ERROR', 'MOUNTING_HOLE_EDGE_CLEARANCE', `${hole.id} is too close to the board edge.`, { nearestEdge, required }))
  }
  return issues
}

function outlineAngles(points) {
  return points.map((point, index) => {
    const prev = points[(index - 1 + points.length) % points.length]
    const next = points[(index + 1) % points.length]
    const a = Math.atan2(prev.y - point.y, prev.x - point.x)
    const b = Math.atan2(next.y - point.y, next.x - point.x)
    let degrees = Math.abs((a - b) * 180 / Math.PI)
    if (degrees > 180) degrees = 360 - degrees
    return { index, degrees }
  })
}

export function nearestDistanceToPolygonEdge(point, polygon) {
  return polygon.reduce((nearest, item, index) => Math.min(nearest, distancePointToSegment(point, item, polygon[(index + 1) % polygon.length])), Infinity)
}

function distancePointToSegment(point, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return distance(point, a)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq))
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy })
}

export function validatePlacement(board, components = [], profile) {
  const issues = []
  const polygon = board.outline || []
  for (const component of components) {
    if (rectCorners(component, profile.componentToEdgeClearanceMm).some((corner) => !pointInPolygon(corner, polygon)) && !component.allowEdgeOverhang) {
      issues.push(issue('ERROR', 'COMPONENT_OFF_BOARD', `${component.ref} is not fully inside the board outline.`, { component }))
    }
    for (const hole of board.mountingHoles || []) {
      const holeBox = { x: hole.x, y: hole.y, width: hole.diameterMm + profile.mountingHoleEdgeClearanceMm * 2, height: hole.diameterMm + profile.mountingHoleEdgeClearanceMm * 2 }
      if (rectsOverlap(component, holeBox)) issues.push(issue('ERROR', 'COMPONENT_HOLE_CONFLICT', `${component.ref} overlaps the clearance for ${hole.id}.`, { component, hole }))
    }
  }
  for (let index = 0; index < components.length; index += 1) {
    for (let other = index + 1; other < components.length; other += 1) {
      if (rectsOverlap(components[index], components[other], profile.componentToComponentClearanceMm)) issues.push(issue('ERROR', 'COMPONENT_OVERLAP', `${components[index].ref} overlaps ${components[other].ref}.`, { a: components[index], b: components[other] }))
    }
  }
  return issues
}

export function validateRoutes(routes = [], nets = [], profile) {
  const issues = []
  const netByName = new Map(nets.map((net) => [net.name, net]))
  for (const route of routes) {
    if (!netByName.has(route.net)) issues.push(issue('WARNING', 'ROUTE_UNKNOWN_NET', `Route references unknown net ${route.net}.`))
    if (route.widthMm < profile.minTraceWidthMm) issues.push(issue('ERROR', 'TRACE_WIDTH_TOO_SMALL', `${route.net} trace width is below ${profile.name} minimum.`, { widthMm: route.widthMm, minTraceWidthMm: profile.minTraceWidthMm }))
    if (route.status !== 'routed') issues.push(issue('WARNING', 'ROUTE_NOT_COMPLETE', `${route.net} is ${route.status}.`, { route }))
  }
  return issues
}

export function runFullSelfReview({ board, components = [], nets = [], routes = [], profile, kicad = {} }) {
  const issues = [...validateBoardOutline(board, profile), ...validatePlacement(board, components, profile), ...validateNetClasses(nets), ...validateRoutes(routes, nets, profile)]
  if (!kicad.cliAvailable) issues.push(issue('WARNING', 'KICAD_CLI_NOT_AVAILABLE', 'KiCad CLI was not available, so ERC/DRC/export checks were not run.'))
  if (routes.length === 0) issues.push(issue('INFO', 'NO_ROUTED_NETS', 'No routed copper was created by this command.'))
  const grouped = splitIssues(issues)
  return {
    status: statusFromIssues(issues),
    passed: grouped.blockers.length === 0 && grouped.errors.length === 0,
    issues,
    qualityGates: [
      { name: 'Schema Validation', status: 'passed' },
      { name: 'Geometry Validation', status: grouped.blockers.length === 0 && !issues.some((item) => item.code.startsWith('OUTLINE')) ? 'passed' : 'failed' },
      { name: 'KiCad Validation', status: kicad.cliAvailable ? 'not_run_by_this_command' : 'blocked_missing_kicad_cli' },
      { name: 'Manufacturing Validation', status: grouped.errors.length === 0 ? 'passed_with_review' : 'failed' },
      { name: 'Self-Review Summary', status: 'generated' },
    ],
    summary: { created: ['Structured board outline data', components.length ? 'Placement plan' : 'No placement applied', routes.length ? 'Routing plan' : 'No routing applied'], passed: grouped.blockers.length === 0 && grouped.errors.length === 0 ? ['Blocking geometry checks'] : [], failed: [...grouped.blockers, ...grouped.errors].map((item) => item.message), autoFixed: [], humanReviewRequired: true },
  }
}
