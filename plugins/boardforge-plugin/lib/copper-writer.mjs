import { readFile, writeFile } from 'node:fs/promises'
import { round } from './geometry.mjs'

export async function applyRoutingPlanToPcb({ pcbFile, board, routingPlan }) {
  const original = await readFile(pcbFile, 'utf8')
  const routeObjects = materializeRouteObjects(board, routingPlan)
  const netNames = [...new Set([
    ...routeObjects.segments.map((item) => item.net),
    ...routeObjects.vias.map((item) => item.net),
    ...routeObjects.zones.map((item) => item.net),
  ].filter(Boolean))]
  const { content, netNumbers } = ensureNets(original, netNames)
  const generated = [
    '  (gr_text "BoardForge review-required copper: run DRC before manufacturing" (at 2 -6 0) (layer "Cmts.User")',
    `    (effects (font (size 1 1) (thickness 0.12))) (uuid "${crypto.randomUUID()}"))`,
    ...routeObjects.segments.map((segment) => segmentText(segment, netNumbers.get(segment.net) || 0)),
    ...routeObjects.vias.map((via) => viaText(via, netNumbers.get(via.net) || 0)),
    ...routeObjects.zones.map((zone) => zoneText(zone, netNumbers.get(zone.net) || 0)),
  ].join('\n')
  const next = content.replace(/\)\s*$/, `${generated}\n)\n`)
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

export function materializeRouteObjects(board, routingPlan) {
  const segments = []
  const vias = []
  const zones = []
  for (const route of routingPlan.routes || []) {
    if (!route.start || !route.end) continue
    const layer = route.layerPreference?.[0] || 'F.Cu'
    const via = route.viaPlan?.candidates?.[0]
    if (via && route.viaPlan?.viaStack !== 'avoid_vias') {
      segments.push(routeSegment(route, route.start, via, layer))
      vias.push({ net: route.net, x: via.x, y: via.y, diameterMm: via.diameterMm, drillMm: via.drillMm, layers: ['F.Cu', 'B.Cu'], reason: via.reason })
      segments.push(routeSegment(route, via, route.end, 'B.Cu'))
    } else {
      const elbow = routeElbow(route.start, route.end)
      segments.push(routeSegment(route, route.start, elbow, layer))
      segments.push(routeSegment(route, elbow, route.end, layer))
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
