import { hasSelfIntersections, polygonArea, polygonBounds, rectanglePoints, regularPolygonPoints, round, roundedRectanglePoints } from './geometry.mjs'
import { validateBoardOutline } from './validation.mjs'

export function generateCustomBoardOutline(input = {}, profile = {}) {
  const prompt = String(input.prompt || input.outlinePrompt || input.description || '').toLowerCase()
  const widthMm = Number(input.widthMm || input.board?.widthMm || parseDimension(prompt, 'width') || parsePair(prompt)?.width || 50)
  const heightMm = Number(input.heightMm || input.board?.heightMm || parseDimension(prompt, 'height') || parsePair(prompt)?.height || 30)
  const shape = input.shape || inferShape(prompt)
  const source = Array.isArray(input.points) && input.points.length >= 3 ? 'points'
    : Array.isArray(input.sketchPoints) && input.sketchPoints.length >= 3 ? 'sketch_points'
      : 'prompt'
  let outline = source === 'points' ? normalizePointOutline(input.points, widthMm, heightMm, input)
    : source === 'sketch_points' ? normalizePointOutline(input.sketchPoints, widthMm, heightMm, { ...input, simplifyMm: input.simplifyMm || 1.2 })
      : primitiveOutline(shape, widthMm, heightMm, { ...input, prompt })
  const operations = []
  if (wantsUsbCutout(prompt, input)) {
    outline = addEdgeNotch(outline, widthMm, heightMm, { edge: input.usbEdge || inferEdge(prompt) || 'left', widthMm: input.usbCutoutWidthMm || 10, depthMm: input.usbCutoutDepthMm || 3.2 })
    operations.push('usb_c_edge_cutout')
  }
  if (wantsRj45Clearance(prompt, input)) {
    outline = addEdgeNotch(outline, widthMm, heightMm, { edge: input.rj45Edge || inferEdge(prompt) || 'right', widthMm: input.rj45CutoutWidthMm || 17, depthMm: input.rj45CutoutDepthMm || 4.5 })
    operations.push('rj45_edge_clearance')
  }
  outline = sanitizeOutline(outline, { minSegmentMm: input.minSegmentMm || Math.max(0.35, profile.edgeClearanceMm || 0.35) })
  const mountingHoles = normalizeMountingHoles(input.mountingHoles || input.board?.mountingHoles, widthMm, heightMm, input, prompt)
  const board = {
    name: input.projectName || input.name || input.board?.name || 'BoardForge Custom Outline',
    units: 'mm',
    widthMm,
    heightMm,
    layerCount: input.layerCount || input.board?.layerCount || 2,
    outline,
    mountingHoles,
    generatedOutline: {
      source,
      shape,
      prompt: input.prompt || input.outlinePrompt || input.description || '',
      operations,
      pointCount: outline.length,
      areaMm2: Math.abs(round(polygonArea(outline))),
    },
  }
  const validation = validateBoardOutline(board, profile)
  return {
    status: validation.some((issue) => issue.severity === 'BLOCKER') ? 'CUSTOM_OUTLINE_BLOCKED' : validation.some((issue) => issue.severity === 'ERROR') ? 'CUSTOM_OUTLINE_NEEDS_FIX' : validation.length ? 'CUSTOM_OUTLINE_READY_NEEDS_REVIEW' : 'CUSTOM_OUTLINE_READY',
    board,
    validation,
    warnings: validation.filter((issue) => issue.severity === 'WARNING'),
    errors: validation.filter((issue) => ['BLOCKER', 'ERROR'].includes(issue.severity)),
    humanReviewRequired: true,
  }
}

export function transformBoardOutline(board = {}, transform = {}, profile = {}) {
  const widthMm = Number(board.widthMm || board.width || 50)
  const heightMm = Number(board.heightMm || board.height || 30)
  let next = { ...board, widthMm, heightMm, outline: [...(board.outline || rectanglePoints(widthMm, heightMm))], mountingHoles: [...(board.mountingHoles || [])] }
  if (transform.type === 'round_board_corners') {
    next.cornerRadiusMm = Number(transform.radiusMm || next.cornerRadiusMm || 3)
    next.outline = roundedRectanglePoints(widthMm, heightMm, next.cornerRadiusMm, transform.segmentsPerCorner || 8)
  }
  if (transform.type === 'add_mounting_holes') {
    next.mountingHoles = normalizeMountingHoles(transform.mountingHoles, widthMm, heightMm, { ...transform, holeCount: transform.holeCount || transform.count || 4 }, '')
  }
  if (transform.type === 'add_usb_c_edge_cutout') {
    next.outline = addEdgeNotch(next.outline, widthMm, heightMm, { edge: transform.edge || 'left', widthMm: transform.widthMm || 10, depthMm: transform.depthMm || 3.2 })
  }
  if (transform.type === 'add_rj45_edge_clearance') {
    next.outline = addEdgeNotch(next.outline, widthMm, heightMm, { edge: transform.edge || 'right', widthMm: transform.widthMm || 17, depthMm: transform.depthMm || 4.5 })
  }
  if (transform.type === 'apply_edge_cuts' && Array.isArray(transform.outline) && transform.outline.length >= 3) {
    next.outline = normalizePointOutline(transform.outline, widthMm, heightMm, transform)
  }
  next.outline = sanitizeOutline(next.outline, { minSegmentMm: Math.max(0.35, profile.edgeClearanceMm || 0.35) })
  const validation = validateBoardOutline(next, profile)
  return {
    status: validation.some((issue) => issue.severity === 'BLOCKER') ? 'OUTLINE_TRANSFORM_BLOCKED' : validation.some((issue) => issue.severity === 'ERROR') ? 'OUTLINE_TRANSFORM_NEEDS_FIX' : 'OUTLINE_TRANSFORM_READY_NEEDS_REVIEW',
    board: next,
    validation,
    warnings: validation.filter((issue) => issue.severity === 'WARNING'),
    errors: validation.filter((issue) => ['BLOCKER', 'ERROR'].includes(issue.severity)),
    humanReviewRequired: true,
  }
}

function primitiveOutline(shape, widthMm, heightMm, options = {}) {
  if (shape === 'circle') return regularPolygonPoints(widthMm, heightMm, 64)
  if (shape === 'hexagon') return regularPolygonPoints(widthMm, heightMm, 6)
  if (shape === 'octagon') return regularPolygonPoints(widthMm, heightMm, 8)
  if (shape === 'capsule') return roundedRectanglePoints(widthMm, heightMm, Math.min(widthMm, heightMm) / 2, 12)
  if (shape === 'drone_fc') return roundedRectanglePoints(widthMm, heightMm, Math.min(4, widthMm * 0.12, heightMm * 0.12), 8)
  if (shape === 'notched' || /notch|waist|neck|hourglass/.test(options.prompt || '')) return customWaistOutline(widthMm, heightMm)
  return roundedRectanglePoints(widthMm, heightMm, Number(options.radiusMm || 3), 8)
}

function customWaistOutline(widthMm, heightMm) {
  const w = widthMm
  const h = heightMm
  const waist = Math.min(w * 0.12, 7)
  return [
    { x: 3, y: 0 }, { x: w - 3, y: 0 }, { x: w, y: 3 }, { x: w, y: h - 3 }, { x: w - 3, y: h },
    { x: w * 0.58, y: h }, { x: w * 0.5 + waist, y: h * 0.72 }, { x: w * 0.5 - waist, y: h * 0.72 },
    { x: w * 0.42, y: h }, { x: 3, y: h }, { x: 0, y: h - 3 }, { x: 0, y: 3 },
  ].map((point) => ({ x: round(point.x), y: round(point.y) }))
}

function normalizePointOutline(points, widthMm, heightMm, options = {}) {
  const numeric = points.map((point) => ({ x: Number(point.x), y: Number(point.y) })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (numeric.length < 3) return rectanglePoints(widthMm, heightMm)
  const bounds = polygonBounds(numeric)
  const sourceW = Math.max(1, bounds.maxX - bounds.minX)
  const sourceH = Math.max(1, bounds.maxY - bounds.minY)
  const pad = Number(options.edgeInsetMm || 0)
  const scaled = numeric.map((point) => ({
    x: round(pad + ((point.x - bounds.minX) / sourceW) * Math.max(1, widthMm - pad * 2)),
    y: round(pad + ((point.y - bounds.minY) / sourceH) * Math.max(1, heightMm - pad * 2)),
  }))
  const simplified = simplifyOutline(scaled, Number(options.simplifyMm || 0.35))
  const safe = hasSelfIntersections(simplified) && options.forceConvex !== false ? convexHull(simplified) : simplified
  return polygonArea(safe) < 0 ? [...safe].reverse() : safe
}

function sanitizeOutline(points, options = {}) {
  let cleaned = simplifyOutline(points, options.minSegmentMm || 0.35)
  if (hasSelfIntersections(cleaned)) cleaned = convexHull(cleaned)
  if (polygonArea(cleaned) < 0) cleaned = [...cleaned].reverse()
  return cleaned.map((point) => ({ x: round(point.x), y: round(point.y) }))
}

function simplifyOutline(points, minSegmentMm) {
  const output = []
  for (const point of points || []) {
    const last = output[output.length - 1]
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minSegmentMm) output.push(point)
  }
  if (output.length > 2 && Math.hypot(output[0].x - output.at(-1).x, output[0].y - output.at(-1).y) < minSegmentMm) output.pop()
  return output.length >= 3 ? output : points
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper = []
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop()
    upper.push(point)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function addEdgeNotch(outline, widthMm, heightMm, options = {}) {
  const edge = options.edge || 'left'
  const notchW = Number(options.widthMm || 10)
  const depth = Number(options.depthMm || 3)
  if (!['left', 'right', 'top', 'bottom'].includes(edge)) return outline
  if (edge === 'left') {
    const cy = heightMm / 2
    return [{ x: 0, y: 0 }, { x: widthMm, y: 0 }, { x: widthMm, y: heightMm }, { x: 0, y: heightMm }, { x: 0, y: cy + notchW / 2 }, { x: depth, y: cy + notchW / 2 }, { x: depth, y: cy - notchW / 2 }, { x: 0, y: cy - notchW / 2 }]
  }
  if (edge === 'right') {
    const cy = heightMm / 2
    return [{ x: 0, y: 0 }, { x: widthMm, y: 0 }, { x: widthMm, y: cy - notchW / 2 }, { x: widthMm - depth, y: cy - notchW / 2 }, { x: widthMm - depth, y: cy + notchW / 2 }, { x: widthMm, y: cy + notchW / 2 }, { x: widthMm, y: heightMm }, { x: 0, y: heightMm }]
  }
  if (edge === 'top') {
    const cx = widthMm / 2
    return [{ x: 0, y: 0 }, { x: cx - notchW / 2, y: 0 }, { x: cx - notchW / 2, y: depth }, { x: cx + notchW / 2, y: depth }, { x: cx + notchW / 2, y: 0 }, { x: widthMm, y: 0 }, { x: widthMm, y: heightMm }, { x: 0, y: heightMm }]
  }
  const cx = widthMm / 2
  return [{ x: 0, y: 0 }, { x: widthMm, y: 0 }, { x: widthMm, y: heightMm }, { x: cx + notchW / 2, y: heightMm }, { x: cx + notchW / 2, y: heightMm - depth }, { x: cx - notchW / 2, y: heightMm - depth }, { x: cx - notchW / 2, y: heightMm }, { x: 0, y: heightMm }]
}

function normalizeMountingHoles(existing, widthMm, heightMm, input = {}, prompt = '') {
  if (Array.isArray(existing) && existing.length) return existing
  const count = Number(input.holeCount || input.mountingHoleCount || (/four|4/.test(prompt) ? 4 : /two|2/.test(prompt) ? 2 : 0))
  if (!count) return []
  const diameterMm = Number(input.holeDiameterMm || 2.7)
  const inset = Number(input.holeInsetMm || Math.max(3.5, diameterMm * 1.8))
  if (count === 2) return [{ id: 'MH1', x: inset, y: heightMm / 2, diameterMm }, { id: 'MH2', x: widthMm - inset, y: heightMm / 2, diameterMm }]
  return [
    { id: 'MH1', x: inset, y: inset, diameterMm },
    { id: 'MH2', x: widthMm - inset, y: inset, diameterMm },
    { id: 'MH3', x: widthMm - inset, y: heightMm - inset, diameterMm },
    { id: 'MH4', x: inset, y: heightMm - inset, diameterMm },
  ]
}

function inferShape(prompt) {
  if (/circle|round board/.test(prompt)) return 'circle'
  if (/hex/.test(prompt)) return 'hexagon'
  if (/oct/.test(prompt)) return 'octagon'
  if (/capsule|pill|slot/.test(prompt)) return 'capsule'
  if (/drone|flight controller|30\.5/.test(prompt)) return 'drone_fc'
  if (/notch|waist|neck|hourglass|custom/.test(prompt)) return 'notched'
  return 'rounded_rectangle'
}

function parsePair(prompt) {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*mm/)
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}

function parseDimension(prompt, axis) {
  const pattern = axis === 'width' ? /(?:width|wide)\s*(?:is|:)?\s*(\d+(?:\.\d+)?)\s*mm/ : /(?:height|tall)\s*(?:is|:)?\s*(\d+(?:\.\d+)?)\s*mm/
  return Number(prompt.match(pattern)?.[1] || 0)
}

function inferEdge(prompt) {
  return ['left', 'right', 'top', 'bottom'].find((edge) => prompt.includes(edge))
}

function wantsUsbCutout(prompt, input) {
  return Boolean(input.addUsbCutout || input.usbCutout || (/usb/.test(prompt) && /cutout|notch|edge/.test(prompt)))
}

function wantsRj45Clearance(prompt, input) {
  return Boolean(input.addRj45Clearance || input.rj45Cutout || (/rj45|ethernet/.test(prompt) && /cutout|notch|clearance|edge/.test(prompt)))
}
