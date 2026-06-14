export const round = (value, digits = 3) => Number(Number(value).toFixed(digits))
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

export function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]
    return area + point.x * next.y - next.x * point.y
  }, 0) / 2
}

export function polygonBounds(points) {
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
}

export function pointInPolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (Math.abs(value) < 1e-9) return 0
  return value > 0 ? 1 : 2
}

function onSegment(a, b, c) {
  return b.x <= Math.max(a.x, c.x) && b.x >= Math.min(a.x, c.x) && b.y <= Math.max(a.y, c.y) && b.y >= Math.min(a.y, c.y)
}

export function segmentsIntersect(a1, a2, b1, b2) {
  const o1 = orientation(a1, a2, b1)
  const o2 = orientation(a1, a2, b2)
  const o3 = orientation(b1, b2, a1)
  const o4 = orientation(b1, b2, a2)
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(a1, b1, a2)) return true
  if (o2 === 0 && onSegment(a1, b2, a2)) return true
  if (o3 === 0 && onSegment(b1, a1, b2)) return true
  return o4 === 0 && onSegment(b1, a2, b2)
}

export function hasSelfIntersections(points) {
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const adjacent = Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)
      if (!adjacent && segmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return true
    }
  }
  return false
}

export function rectsOverlap(a, b, clearance = 0) {
  return !(a.x + a.width / 2 + clearance <= b.x - b.width / 2 || b.x + b.width / 2 + clearance <= a.x - a.width / 2 || a.y + a.height / 2 + clearance <= b.y - b.height / 2 || b.y + b.height / 2 + clearance <= a.y - a.height / 2)
}

export function rectCorners(rect, clearance = 0) {
  const halfWidth = rect.width / 2 + clearance
  const halfHeight = rect.height / 2 + clearance
  return [
    { x: rect.x - halfWidth, y: rect.y - halfHeight },
    { x: rect.x + halfWidth, y: rect.y - halfHeight },
    { x: rect.x + halfWidth, y: rect.y + halfHeight },
    { x: rect.x - halfWidth, y: rect.y + halfHeight },
  ]
}

export const rectanglePoints = (widthMm, heightMm, insetMm = 0) => [
  { x: insetMm, y: insetMm },
  { x: widthMm - insetMm, y: insetMm },
  { x: widthMm - insetMm, y: heightMm - insetMm },
  { x: insetMm, y: heightMm - insetMm },
]

export function regularPolygonPoints(widthMm, heightMm, sides) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2 - Math.PI / 2
    return { x: round(widthMm / 2 + Math.cos(angle) * widthMm / 2), y: round(heightMm / 2 + Math.sin(angle) * heightMm / 2) }
  })
}

export function roundedRectanglePoints(widthMm, heightMm, radiusMm = 3, segmentsPerCorner = 6) {
  const radius = Math.max(0.5, Math.min(radiusMm, widthMm / 2 - 0.2, heightMm / 2 - 0.2))
  const corners = [
    { cx: widthMm - radius, cy: radius, start: -Math.PI / 2, end: 0 },
    { cx: widthMm - radius, cy: heightMm - radius, start: 0, end: Math.PI / 2 },
    { cx: radius, cy: heightMm - radius, start: Math.PI / 2, end: Math.PI },
    { cx: radius, cy: radius, start: Math.PI, end: Math.PI * 1.5 },
  ]
  return corners.flatMap((corner) => Array.from({ length: segmentsPerCorner + 1 }, (_, step) => {
    const angle = corner.start + (corner.end - corner.start) * (step / segmentsPerCorner)
    return { x: round(corner.cx + Math.cos(angle) * radius), y: round(corner.cy + Math.sin(angle) * radius) }
  }))
}
