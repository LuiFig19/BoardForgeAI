import { readFile, writeFile } from 'node:fs/promises'
import { round } from './geometry.mjs'

export async function applyRoutingPlanToPcb({ pcbFile, board, routingPlan, components = [] }) {
  const original = await readFile(pcbFile, 'utf8')
  const routeObjects = materializeRouteObjects(board, routingPlan)
  const netNames = [...new Set([
    ...routeObjects.segments.map((item) => item.net),
    ...routeObjects.vias.map((item) => item.net),
    ...routeObjects.zones.map((item) => item.net),
  ].filter(Boolean))]
  const { content, netNumbers } = ensureNets(original, [...netNames, ...componentNetNames(components)])
  const withPadNets = assignPadNets(content, components, netNumbers)
  const generated = [
    '  (gr_text "BoardForge review-required copper: run DRC before manufacturing" (at 2 -6 0) (layer "Cmts.User")',
    `    (effects (font (size 1 1) (thickness 0.12))) (uuid "${crypto.randomUUID()}"))`,
    ...routeObjects.segments.map((segment) => segmentText(segment, netNumbers.get(segment.net) || 0)),
    ...routeObjects.vias.map((via) => viaText(via, netNumbers.get(via.net) || 0)),
    ...routeObjects.zones.map((zone) => zoneText(zone, netNumbers.get(zone.net) || 0)),
  ].join('\n')
  const next = withPadNets.replace(/\)\s*$/, `${generated}\n)\n`)
  await writeFile(pcbFile, next, 'utf8')
  return {
    status: 'COPPER_APPLIED_NEEDS_DRC',
    pcbFile,
    generatedObjects: {
      segments: routeObjects.segments.length,
      vias: routeObjects.vias.length,
      zones: routeObjects.zones.length,
    },
    routes: routeObjects.segments,
    vias: routeObjects.vias,
    zones: routeObjects.zones,
    humanReviewRequired: true,
  }
}

function componentNetNames(components) {
  return components.flatMap((component) => Object.values(component.pinMap || {}).filter(Boolean))
}

function assignPadNets(content, components, netNumbers) {
  let next = content
  for (const component of components) {
    const pinMap = component.pinMap || {}
    if (!Object.keys(pinMap).length) continue
    const refPattern = new RegExp(`\\(property\\s+"Reference"\\s+"${escapeRegExp(component.ref)}"[\\s\\S]*?\\n\\s*\\)`, 'm')
    const refMatch = next.match(refPattern)
    if (!refMatch) continue
    const fpStart = next.lastIndexOf('(footprint', refMatch.index)
    const fpEnd = findClosingParen(next, fpStart)
    if (fpStart < 0 || fpEnd < 0) continue
    const footprintBlock = next.slice(fpStart, fpEnd + 1)
    const updated = assignPadsInFootprint(footprintBlock, pinMap, netNumbers)
    next = `${next.slice(0, fpStart)}${updated}${next.slice(fpEnd + 1)}`
  }
  return next
}

function assignPadsInFootprint(footprintBlock, pinMap, netNumbers) {
  let output = ''
  let cursor = 0
  const padPattern = /\(pad\s+"([^"]+)"/g
  let match = padPattern.exec(footprintBlock)
  while (match) {
    const padStart = match.index
    const padEnd = findClosingParen(footprintBlock, padStart)
    if (padEnd < 0) break
    output += footprintBlock.slice(cursor, padStart)
    const padBlock = footprintBlock.slice(padStart, padEnd + 1)
    const padName = match[1]
    const netName = pinMap[padName] || pinMap[normalizePinName(padName)]
    const netNumber = netNumbers.get(netName)
    output += netName && netNumber ? withPadNet(padBlock, netNumber, netName) : padBlock
    cursor = padEnd + 1
    padPattern.lastIndex = cursor
    match = padPattern.exec(footprintBlock)
  }
  return output + footprintBlock.slice(cursor)
}

function withPadNet(padBlock, netNumber, netName) {
  const withoutOldNet = padBlock.replace(/\s+\(net\s+\d+\s+"[^"]*"\)/, '')
  return withoutOldNet.replace(/\)$/, `\n\t\t(net ${netNumber} "${safeText(netName)}")\n\t)`)
}

function findClosingParen(text, start) {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1
    if (text[index] === ')') depth -= 1
    if (depth === 0) return index
  }
  return -1
}

function normalizePinName(pin) {
  return String(pin).replace(/^0+/, '')
}

export function materializeRouteObjects(board, routingPlan) {
  const segments = []
  const vias = []
  const zones = []
  for (const route of routingPlan.routes || []) {
    if (!route.start || !route.end) continue
    const layer = route.layerPreference?.[0] || 'F.Cu'
    const via = route.viaPlan?.candidates?.[0]
    if (via && route.viaPlan?.viaStack !== 'avoid_vias') {
      const beforeVia = route.waypoints?.length ? route.waypoints.slice(0, Math.max(2, route.waypoints.findIndex((point) => point.x === via.x && point.y === via.y) + 1)) : [route.start, via]
      appendPathSegments(segments, route, beforeVia, layer)
      vias.push({ net: route.net, x: via.x, y: via.y, diameterMm: via.diameterMm, drillMm: via.drillMm, layers: ['F.Cu', 'B.Cu'], reason: via.reason })
      const viaIndex = route.waypoints?.findIndex((point) => point.x === via.x && point.y === via.y) ?? -1
      const afterVia = viaIndex >= 0 ? route.waypoints.slice(viaIndex) : [via, route.end]
      appendPathSegments(segments, route, afterVia, 'B.Cu')
    } else {
      appendPathSegments(segments, route, route.waypoints?.length ? route.waypoints : [route.start, routeElbow(route.start, route.end), route.end], layer)
    }
  }
  for (const pour of routingPlan.designIntent?.copperPours || []) {
    if (!board.outline?.length) continue
    zones.push({
      net: pour.net,
      layer: pour.layer,
      clearanceMm: pour.clearanceMm || 0.2,
      thermalRelief: Boolean(pour.thermalRelief),
      polygon: board.outline.map((point) => ({ x: round(point.x), y: round(point.y) })),
      avoidZones: pour.avoidZones || [],
    })
  }
  return { segments, vias, zones }
}

function appendPathSegments(segments, route, points, layer) {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    if (start.x === end.x && start.y === end.y) continue
    segments.push(routeSegment(route, start, end, layer))
  }
}

function ensureNets(content, netNames) {
  const netNumbers = new Map([...content.matchAll(/\(net\s+(\d+)\s+"([^"]*)"\)/g)].map((match) => [match[2], Number(match[1])]))
  let maxNet = Math.max(0, ...netNumbers.values())
  const additions = []
  for (const name of netNames) {
    if (netNumbers.has(name)) continue
    maxNet += 1
    netNumbers.set(name, maxNet)
    additions.push(`  (net ${maxNet} "${safeText(name)}")`)
  }
  if (!additions.length) return { content, netNumbers }
  const marker = '\n  (setup'
  if (content.includes(marker)) return { content: content.replace(marker, `\n${additions.join('\n')}${marker}`), netNumbers }
  return { content: content.replace(/\n\)\s*$/, `\n${additions.join('\n')}\n)`), netNumbers }
}

function routeSegment(route, start, end, layer) {
  return {
    net: route.net,
    className: route.className,
    start: { x: round(start.x), y: round(start.y) },
    end: { x: round(end.x), y: round(end.y) },
    widthMm: route.widthMm,
    layer,
    status: 'written_needs_drc',
  }
}

function routeElbow(start, end) {
  const horizontalFirst = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
  return horizontalFirst ? { x: end.x, y: start.y } : { x: start.x, y: end.y }
}

function segmentText(segment, netNumber) {
  return `  (segment (start ${round(segment.start.x)} ${round(segment.start.y)}) (end ${round(segment.end.x)} ${round(segment.end.y)}) (width ${round(segment.widthMm)}) (layer "${segment.layer}") (net ${netNumber}) (uuid "${crypto.randomUUID()}"))`
}

function viaText(via, netNumber) {
  return `  (via (at ${round(via.x)} ${round(via.y)}) (size ${round(via.diameterMm)}) (drill ${round(via.drillMm)}) (layers "${via.layers[0]}" "${via.layers[1]}") (net ${netNumber}) (uuid "${crypto.randomUUID()}"))`
}

function zoneText(zone, netNumber) {
  const pts = zone.polygon.map((point) => `(xy ${round(point.x)} ${round(point.y)})`).join(' ')
  return `  (zone (net ${netNumber}) (net_name "${safeText(zone.net)}") (layer "${zone.layer}") (uuid "${crypto.randomUUID()}")\n    (hatch edge 0.5)\n    (priority 10)\n    (connect_pads (clearance ${round(zone.clearanceMm)}))\n    (min_thickness 0.2)\n    (filled_areas_thickness no)\n    (polygon (pts ${pts}))\n  )`
}

function safeText(value) {
  return String(value || '').replace(/"/g, "'")
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
