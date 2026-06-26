import { readFile, writeFile } from 'node:fs/promises'
import { round } from './geometry.mjs'
import { assignNetsToClasses, netClassProfiles } from './net-classes.mjs'

export async function applyRoutingPlanToPcb({ pcbFile, board, routingPlan, components = [], pads = [], replaceGeneratedCopper = true }) {
  const original = await readFile(pcbFile, 'utf8')
  const beforeCopper = scanKicadCopperText(original)
  const routeObjects = materializeRouteObjects(board, routingPlan, {
    writeHardKeepouts: routingPlan.writeHardKeepouts === true || routingPlan.designIntent?.writeHardKeepouts === true,
    writeInnerCopperPours: routingPlan.writeInnerCopperPours === true || routingPlan.designIntent?.writeInnerCopperPours === true,
    writeTopCopperPours: routingPlan.writeTopCopperPours === true || routingPlan.designIntent?.writeTopCopperPours === true,
    routeGroundNets: routingPlan.routeGroundNets === true,
    writeUsbSupportCompletion: routingPlan.writeUsbSupportCompletion === true,
    components,
    pads,
  })
  const netNames = [...new Set([
    ...routeObjects.segments.map((item) => item.net),
    ...routeObjects.vias.map((item) => item.net),
    ...routeObjects.zones.map((item) => item.net),
  ].filter(Boolean))]
  const { content, netNumbers } = ensureNets(original, [...netNames, ...componentNetNames(components)])
  const withPadNets = assignPadNets(content, components, netNumbers)
  const cleaned = replaceGeneratedCopper ? stripGeneratedCopper(withPadNets) : withPadNets
  const generated = [
    '  (gr_text "BoardForge review-required copper: run DRC before manufacturing" (at 2 -6 0) (layer "Cmts.User")',
    `    (effects (font (size 1 1) (thickness 0.12))) (uuid "${crypto.randomUUID()}"))`,
    ...routeObjects.segments.map((segment) => segmentText(segment, segment.net)),
    ...routeObjects.vias.map((via) => viaText(via, via.net)),
    ...routeObjects.zones.map((zone) => zoneText(zone, netNumberFor(netNumbers, zone.net))),
  ].join('\n')
  const next = insertGeneratedCopper(cleaned, generated)
  await writeFile(pcbFile, next, 'utf8')
  const afterCopper = await scanKicadCopperAfterWrite(pcbFile)
  const expectedAdded = {
    segments: routeObjects.segments.length,
    vias: routeObjects.vias.length,
    zones: routeObjects.zones.length,
  }
  const writeProof = compareExpectedVsActualCopper({ before: beforeCopper, expectedAdded, after: afterCopper })
  return {
    status: 'COPPER_APPLIED_NEEDS_DRC',
    pcbFile,
    generatedObjects: expectedAdded,
    writeProof,
    routes: routeObjects.segments,
    vias: routeObjects.vias,
    zones: routeObjects.zones,
    humanReviewRequired: true,
  }
}

export async function verifyCopperWrittenToKicad({ pcbFile, before = null, expectedAdded = {} }) {
  const beforeCopper = before || { segments: 0, vias: 0, zones: 0 }
  const after = await scanKicadCopperAfterWrite(pcbFile)
  return compareExpectedVsActualCopper({ before: beforeCopper, expectedAdded, after })
}

export async function scanKicadCopperAfterWrite(pcbFile) {
  return scanKicadCopperText(await readFile(pcbFile, 'utf8'))
}

export function scanKicadCopperText(content = '') {
  return {
    segments: countTopLevelBlocks(content, 'segment'),
    vias: countTopLevelBlocks(content, 'via'),
    zones: countTopLevelBlocks(content, 'zone'),
  }
}

export function compareExpectedVsActualCopper({ before = {}, expectedAdded = {}, after = {} }) {
  const delta = {
    segments: Number(after.segments || 0) - Number(before.segments || 0),
    vias: Number(after.vias || 0) - Number(before.vias || 0),
    zones: Number(after.zones || 0) - Number(before.zones || 0),
  }
  const expected = {
    segments: Number(expectedAdded.segments || 0),
    vias: Number(expectedAdded.vias || 0),
    zones: Number(expectedAdded.zones || 0),
  }
  const retained = delta.segments >= expected.segments
    && delta.vias >= expected.vias
    && delta.zones >= expected.zones
  const retainedTotal = Number(after.segments || 0) >= expected.segments
    && Number(after.vias || 0) >= expected.vias
    && Number(after.zones || 0) >= expected.zones
  return {
    before,
    expectedAdded: expected,
    after,
    actualAdded: delta,
    retained,
    retainedTotal,
    failurePoint: retained || retainedTotal ? null : 'KICAD_COPPER_WRITE_NOT_RETAINED',
  }
}

export function assertRouteBundleRetained(writeProof = {}) {
  if (writeProof.retained !== true && writeProof.retainedTotal !== true) {
    const error = new Error('Expected route bundle copper was not retained in the KiCad PCB file.')
    error.code = 'KICAD_COPPER_WRITE_NOT_RETAINED'
    error.writeProof = writeProof
    throw error
  }
  return true
}

function countTopLevelBlocks(content, token) {
  const pattern = new RegExp(`\\n\\s*\\(${token}(?=\\s|\\n)`, 'g')
  return [...content.matchAll(pattern)].length
}

function insertGeneratedCopper(content, generated) {
  const boardStart = content.indexOf('(kicad_pcb')
  const boardEnd = boardStart >= 0 ? findClosingParen(content, boardStart) : -1
  if (boardEnd < 0) return content.replace(/\)\s*$/, `\n${generated}\n)\n`)
  const embeddedFonts = content.slice(0, boardEnd).match(/\n\s*\(embedded_fonts\s+no\)\s*$/)
  if (embeddedFonts) {
    const insertAt = boardEnd - embeddedFonts[0].length
    return `${content.slice(0, insertAt)}\n${generated}${embeddedFonts[0]}${content.slice(boardEnd)}`
  }
  return `${content.slice(0, boardEnd)}\n${generated}\n${content.slice(boardEnd)}`
}

function stripGeneratedCopper(content) {
  if (!content.includes('BoardForge review-required copper')) return content
  const marker = content.indexOf('(gr_text "BoardForge review-required copper:')
  const start = marker >= 0 ? content.lastIndexOf('\n', marker) : -1
  const boardStart = content.indexOf('(kicad_pcb')
  const boardEnd = boardStart >= 0 ? findClosingParen(content, boardStart) : -1
  if (start < 0 || boardEnd < 0 || start >= boardEnd) return content
  const beforeEnd = content.slice(0, boardEnd)
  const embedded = beforeEnd.match(/\n\s*\(embedded_fonts\s+no\)\s*$/)
  const end = embedded ? boardEnd - embedded[0].length : boardEnd
  return `${content.slice(0, start)}${content.slice(end)}`
}

function stripTopLevelBlocks(content, token) {
  let next = ''
  let cursor = 0
  while (cursor < content.length) {
    const match = new RegExp(`\\n\\s*\\(${token}(?=\\s|\\n)`, 'g')
    match.lastIndex = cursor
    const found = match.exec(content)
    if (!found) {
      next += content.slice(cursor)
      break
    }
    const start = found.index
    next += content.slice(cursor, start)
    const blockStart = content.indexOf(`(${token}`, start)
    const end = findClosingParen(content, blockStart)
    cursor = end >= 0 ? end + 1 : blockStart + token.length + 1
  }
  return next
}

export async function applyNetlistSyncToPcb({ pcbFile, components = [], netlist = null }) {
  const original = await readFile(pcbFile, 'utf8')
  const netNames = [...new Set([
    ...componentNetNames(components),
    ...(netlist?.nets || []).map((net) => net.name),
  ].filter(Boolean))]
  const { content, netNumbers } = ensureNets(original, netNames)
  const withClasses = syncPcbNetClasses(content, netlist?.nets || netNames.map((name) => ({ name })))
  const withPadNets = assignPadNets(withClasses, componentsWithNetlistPins(components, netlist), netNumbers)
  const changed = withPadNets !== original
  if (changed) await writeFile(pcbFile, withPadNets, 'utf8')
  return {
    status: changed ? 'PCB_NET_SYNC_APPLIED_NEEDS_DRC' : 'PCB_NET_SYNC_NO_CHANGES',
    pcbFile,
    netCount: netNames.length,
    componentCount: components.length,
    changed,
    humanReviewRequired: true,
  }
}

function syncPcbNetClasses(content, nets = []) {
  const classified = assignNetsToClasses(nets)
  const byClass = new Map()
  for (const net of classified) {
    if (!net?.name) continue
    if (!byClass.has(net.className)) byClass.set(net.className, [])
    byClass.get(net.className).push(net.name)
  }
  const blocks = Object.entries(netClassProfiles).map(([name, values]) => {
    const addNets = [...new Set(byClass.get(name) || [])].map((net) => `    (add_net "${safeText(net)}")`).join('\n')
    return `  (net_class "${safeText(name)}" ""\n    (clearance ${round(values.clearanceMm)})\n    (trace_width ${round(values.traceWidthMm)})\n    (via_dia ${round(values.viaDiameterMm)})\n    (via_drill ${round(values.viaDrillMm)})${addNets ? `\n${addNets}` : ''}\n  )`
  }).join('\n')
  const stripped = content.replace(/\n\s*\(net_class\s+"[^"]+"[\s\S]*?\n\s*\)/g, '')
  if (/\n\s*\(net\s+\d+\s+"[^"]*"\)/.test(stripped)) return stripped.replace(/\n(\s*)\(net\s+\d+\s+"[^"]*"\)/, (match) => `\n${blocks}${match}`)
  return insertBeforeSetup(stripped, `\n${blocks}\n`)
}

function componentNetNames(components) {
  return components.flatMap((component) => Object.values(component.pinMap || {}).filter(Boolean))
}

function componentsWithNetlistPins(components, netlist) {
  if (!netlist?.nets?.length) return components
  const byRef = new Map(components.map((component) => [component.ref, { ...component, pinMap: { ...(component.pinMap || {}) } }]))
  for (const net of netlist.nets || []) {
    for (const pin of net.pins || []) {
      const component = byRef.get(pin.ref)
      if (!component || !pin.pin) continue
      component.pinMap[pin.pin] = net.name
    }
  }
  return [...byRef.values()]
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
    const updated = assignPadsInFootprint(footprintBlock, component, netNumbers)
    next = `${next.slice(0, fpStart)}${updated}${next.slice(fpEnd + 1)}`
  }
  return next
}

function assignPadsInFootprint(footprintBlock, component, netNumbers) {
  let output = ''
  let cursor = 0
  const pinMap = component.pinMap || {}
  const padPattern = /\(pad\s+"([^"]+)"/g
  let match = padPattern.exec(footprintBlock)
  while (match) {
    const padStart = match.index
    const padEnd = findClosingParen(footprintBlock, padStart)
    if (padEnd < 0) break
    output += footprintBlock.slice(cursor, padStart)
    const padBlock = footprintBlock.slice(padStart, padEnd + 1)
    const padName = match[1]
    const netName = resolvePadNet(component, padName)
    const netNumber = netNumbers.get(netName)
    output += netName && netNumber && padBlockHasCopperLayer(padBlock) ? withPadNet(padBlock, netNumber, netName) : padBlock
    cursor = padEnd + 1
    padPattern.lastIndex = cursor
    match = padPattern.exec(footprintBlock)
  }
  return output + footprintBlock.slice(cursor)
}

function padBlockHasCopperLayer(padBlock) {
  return /\(layers\s+[^)]*"[^"]*\.Cu"/.test(padBlock) || /\(layers\s+[^)]*"\*\.Cu"/.test(padBlock)
}

function resolvePadNet(component, padName) {
  const pinMap = component.pinMap || {}
  const direct = pinMap[padName] || pinMap[normalizePinName(padName)]
  if (direct) return direct
  const normalized = String(padName || '').toUpperCase()
  const group = String(component.group || '').toUpperCase()
  const footprint = String(component.footprint?.libId || component.footprint || '').toUpperCase()
  const aliases = padAliasesFor(component, group, footprint)
  const intentPins = aliases[normalized] || []
  const mappedNets = new Set(Object.values(pinMap).filter(Boolean).map((net) => String(net).toUpperCase()))
  for (const intentPin of intentPins) {
    const net = pinMap[intentPin] || pinMap[normalizePinName(intentPin)]
    if (net) return net
    if (mappedNets.has(String(intentPin).toUpperCase())) return intentPin
  }
  return null
}

function padAliasesFor(component, group, footprint) {
  if (group === 'USB' || footprint.includes('USB_C')) {
    return {
      1: ['GND'],
      2: ['D-', 'USB_DN'],
      3: ['D+', 'USB_DP'],
      4: ['GND'],
      SH: ['GND'], SH1: ['GND'], SH2: ['GND'],
      A1: ['GND'], B1: ['GND'], A12: ['GND'], B12: ['GND'],
      A4: ['VBUS', 'VUSB'], B4: ['VBUS', 'VUSB'], A9: ['VBUS', 'VUSB'], B9: ['VBUS', 'VUSB'],
      A5: ['CC1'], B5: ['CC2'],
      A6: ['D+', 'USB_DP'], B6: ['D+', 'USB_DP'],
      A7: ['D-', 'USB_DN'], B7: ['D-', 'USB_DN'],
    }
  }
  if (group === 'SENSOR_CONNECTOR' || footprint.includes('CONN_01X04') || footprint.includes('PINHEADER_1X04')) {
    return { 1: ['GND'], 2: ['3V3'], 3: ['SCL', 'I2C_SCL'], 4: ['SDA', 'I2C_SDA'] }
  }
  if (group === 'REGULATOR' || footprint.includes('SOT-23-5')) {
    return { 1: ['VIN'], 2: ['GND'], 3: ['EN'], 4: ['NC'], 5: ['VOUT', '3V3'] }
  }
  if (group === 'TVS' || /TVS|ESD/i.test(component.value || '')) {
    return { 1: ['DP', 'USB_DP'], 2: ['VBUS', 'VUSB'], 3: ['GND'], 4: ['GND'], 5: ['DN', 'USB_DN'], 6: ['DP', 'USB_DP'] }
  }
  if (group === 'ESP32_S3' || footprint.includes('ESP32-S3')) {
    return {
      1: ['GND'],
      2: ['3V3'],
      3: ['EN'],
      13: ['USB_DN', 'D-', 'USB_D-'],
      14: ['USB_DP', 'D+', 'USB_D+'],
      27: ['IO0', 'BOOT'],
      32: ['SCL', 'I2C_SCL'],
      33: ['SDA', 'I2C_SDA'],
      40: ['GND'],
      41: ['GND'],
      EN: ['EN'],
      IO0: ['BOOT'],
      USB_DN: ['USB_DN'],
      USB_DP: ['USB_DP'],
      SCL: ['SCL', 'I2C_SCL'],
      SDA: ['SDA', 'I2C_SDA'],
    }
  }
  return {}
}

function withPadNet(padBlock, netNumber, netName) {
  const withoutOldNet = padBlock
    .replace(/\s+\(net\s+\d+\s+"[^"]*"\)/g, '')
    .replace(/\s+\(net\s+"[^"]*"\)/g, '')
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

export function materializeRouteObjects(board, routingPlan, options = {}) {
  const segments = []
  const vias = []
  const zones = []
  const physicalPads = normalizePads(options.pads || [])
  for (const route of routingPlan.routes || []) {
    if (!['routed', 'written_needs_drc', 'planned_not_routed', 'planned_zone_or_short_route'].includes(route.status)) continue
    if (!route.start || !route.end) continue
    if (/^(GND|AGND|DGND)$/i.test(String(route.net || '')) && routingPlan.routeGroundNets !== true && options.routeGroundNets !== true) continue
    const layer = route.layerPreference?.[0] || 'F.Cu'
    const routeLayer = layer === 'F.Cu' ? 'F.Cu' : layer
    const sourceContactLayer = route.endpointContactLayers?.source || (route.start?.throughHole ? routeLayer : 'F.Cu')
    const targetContactLayer = route.endpointContactLayers?.target || (route.end?.throughHole ? routeLayer : 'F.Cu')
    const viaCandidates = route.viaPlan?.candidates || []
    if (viaCandidates.length >= 2) {
      const points = splicePathThroughVias(route.waypoints?.length ? route.waypoints : [route.start, route.end], viaCandidates)
      const firstVia = viaCandidates[0]
      const lastVia = viaCandidates[viaCandidates.length - 1]
      const firstViaIndex = nearestPointIndex(points, firstVia)
      const lastViaIndex = nearestPointIndex(points, lastVia)
      appendPathSegments(segments, route, points.slice(0, firstViaIndex + 1), sourceContactLayer)
      for (const via of viaCandidates) vias.push({ net: route.net, x: via.x, y: via.y, diameterMm: via.diameterMm, drillMm: via.drillMm, layers: via.layers || ['F.Cu', 'B.Cu'], viaType: via.viaType || 'through', reason: via.reason })
      appendPathSegments(segments, route, points.slice(firstViaIndex, lastViaIndex + 1), routeLayer)
      appendPathSegments(segments, route, points.slice(lastViaIndex), targetContactLayer)
    } else if (viaCandidates[0]) {
      const via = viaCandidates[0]
      const points = splicePathThroughVias(route.waypoints?.length ? route.waypoints : [route.start, route.end], [via])
      const viaIndex = nearestPointIndex(points, via)
      const beforeVia = points.slice(0, viaIndex + 1)
      appendPathSegments(segments, route, beforeVia, via.endpoint === 'end' ? routeLayer : sourceContactLayer)
      vias.push({ net: route.net, x: via.x, y: via.y, diameterMm: via.diameterMm, drillMm: via.drillMm, layers: via.layers || ['F.Cu', 'B.Cu'], viaType: via.viaType || 'through', reason: via.reason })
      const afterVia = points.slice(viaIndex)
      appendPathSegments(segments, route, afterVia, via.endpoint === 'start' ? routeLayer : targetContactLayer)
    } else {
      appendPathSegments(segments, route, route.waypoints?.length ? route.waypoints : [route.start, routeElbow(route.start, route.end), route.end], layer)
    }
  }
  if (options.writeSameNetPadStitches === true || routingPlan.writeSameNetPadStitches === true) {
    appendSameNetPadStitches(segments, vias, physicalPads, routingPlan, board)
  }
  if (options.writeUsbSupportCompletion === true || routingPlan.writeUsbSupportCompletion === true) {
    completeUsbSupportRoutes(segments, vias, physicalPads, board)
  }
  for (const pour of routingPlan.designIntent?.copperPours || []) {
    if (!board.outline?.length) continue
    if (!options.writeInnerCopperPours && /^In\d+\.Cu$/i.test(String(pour.layer || ''))) continue
    if (!options.writeTopCopperPours && String(pour.layer || '') === 'F.Cu') continue
    zones.push({
      net: pour.net,
      layer: pour.layer,
      clearanceMm: pour.clearanceMm || 0.2,
      thermalRelief: Boolean(pour.thermalRelief),
      polygon: (pour.polygon?.length ? pour.polygon : board.outline).map((point) => ({ x: round(point.x), y: round(point.y) })),
      avoidZones: options.writeHardKeepouts ? materializeAvoidZones(pour.avoidZones || []) : [],
    })
  }
  for (const via of options.writeStitchingVias ? routingPlan.designIntent?.stitchingVias || [] : []) {
    if (!stitchingViaIsAllowed(via, board, options.components || [])) continue
    vias.push({
      net: via.net || 'GND',
      x: via.x,
      y: via.y,
      diameterMm: via.diameterMm || 0.45,
      drillMm: via.drillMm || 0.2,
      layers: via.layers || ['F.Cu', 'B.Cu'],
      viaType: via.viaType || 'through',
      reason: via.reason || 'stitching via',
    })
  }
  const dedupedVias = dedupeVias(vias)
  const strictViaConnectivity = /AUTOROUTE/i.test(String(routingPlan.status || '')) && routingPlan.strictViaConnectivity !== false
  return { segments, vias: strictViaConnectivity ? connectedViasOnly(dedupedVias, segments, physicalPads) : dedupedVias, zones }
}

function normalizePads(pads = []) {
  return pads
    .filter((pad) => pad?.netName && Number.isFinite(Number(pad.x)) && Number.isFinite(Number(pad.y)))
    .map((pad) => ({
      ...pad,
      x: Number(pad.x),
      y: Number(pad.y),
      widthMm: Number(pad.widthMm || pad.width || 0.6),
      heightMm: Number(pad.heightMm || pad.height || 0.6),
      netName: pad.netName || pad.net,
      layers: pad.layers || [],
      throughHole: Boolean(pad.throughHole || String(pad.type || '').includes('thru')),
    }))
}

function completeUsbSupportRoutes(segments, vias, pads, board) {
  const usb = padByRefNet(pads, /^(J\d+|USB\d*)$/i, 'USB_DP') || padByRefPad(pads, /^(J\d+|USB\d*)$/i, 'A6')
  const usbDn = padByRefNet(pads, /^(J\d+|USB\d*)$/i, 'USB_DN') || padByRefPad(pads, /^(J\d+|USB\d*)$/i, 'A7')
  const usbVbus = padByRefNet(pads, /^(J\d+|USB\d*)$/i, 'VUSB') || padByRefPad(pads, /^(J\d+|USB\d*)$/i, 'A4')
  const usbCc1 = padByRefNet(pads, /^(J\d+|USB\d*)$/i, 'CC1') || padByRefPad(pads, /^(J\d+|USB\d*)$/i, 'A5')
  const usbCc2 = padByRefNet(pads, /^(J\d+|USB\d*)$/i, 'CC2') || padByRefPad(pads, /^(J\d+|USB\d*)$/i, 'B5')
  const esdDp = padByRefNet(pads, /^D\d+$/i, 'USB_DP')
  const esdDn = padByRefNet(pads, /^D\d+$/i, 'USB_DN')
  const esdVbus = padByRefNet(pads, /^D\d+$/i, 'VUSB')
  const mcuDp = padByRefNet(pads, /^U\d+$/i, 'USB_DP')
  const mcuDn = padByRefNet(pads, /^U\d+$/i, 'USB_DN')
  const rCc1 = padByRefNet(pads, /^R\d+$/i, 'CC1')
  const cVbus = padByRefNet(pads, /^C\d+$/i, 'VUSB')
  const uVbus = padByRefNet(pads, /^U\d+$/i, 'VUSB')
  if (!usb || !usbDn || !esdDp || !esdDn || !mcuDp || !mcuDn) return

  removeNetSegments(segments, new Set(['USB_DP', 'USB_DN', 'CC1', 'VUSB']))
  removeNetVias(vias, new Set(['USB_DP', 'USB_DN', 'CC1', 'VUSB']))

  appendPath(segments, 'USB_DP', 'USB_DIFF', [
    usb,
    { x: usb.x + 1.4, y: usb.y },
    { x: usb.x + 1.4, y: esdDp.y - 2.85 },
    { x: esdDp.x, y: esdDp.y - 2.85 },
    esdDp,
    { x: esdDp.x + 2.05, y: esdDp.y },
    { x: esdDp.x + 2.05, y: mcuDp.y + 1.75 },
    { x: mcuDp.x, y: mcuDp.y + 1.75 },
    mcuDp,
  ], 0.127, board)
  appendPath(segments, 'USB_DN', 'USB_DIFF', [
    usbDn,
    { x: usbDn.x + 1.9, y: usbDn.y },
    { x: usbDn.x + 1.9, y: esdDn.y + 1.65 },
    { x: esdDn.x - 1.65, y: esdDn.y + 1.65 },
    { x: esdDn.x - 1.65, y: esdDn.y },
    esdDn,
    { x: esdDn.x + 2.35, y: esdDn.y },
    { x: esdDn.x + 2.35, y: mcuDn.y },
    mcuDn,
  ], 0.127, board)
  if (usbCc1 && rCc1) appendPath(segments, 'CC1', 'DEFAULT', [usbCc1, { x: usbCc1.x - 2.1, y: usbCc1.y }, { x: usbCc1.x - 2.1, y: rCc1.y + 2.4 }, { x: rCc1.x, y: rCc1.y + 2.4 }, rCc1], 0.127, board)
  if (usbVbus && esdVbus) appendPath(segments, 'VUSB', 'POWER_LOW_CURRENT', [
    usbVbus,
    { x: usbVbus.x, y: usbVbus.y + 2.2 },
    { x: esdVbus.x, y: usbVbus.y + 2.2 },
    esdVbus,
    ...(cVbus ? [{ x: esdVbus.x + 4.55, y: esdVbus.y }, { x: esdVbus.x + 4.55, y: cVbus.y }, cVbus] : []),
    ...(uVbus ? [{ x: uVbus.x, y: cVbus?.y || esdVbus.y }, uVbus] : []),
  ], 0.25, board)
}

function removeNetSegments(segments, nets) {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (nets.has(String(segments[index].net || ''))) segments.splice(index, 1)
  }
}

function removeNetVias(vias, nets) {
  for (let index = vias.length - 1; index >= 0; index -= 1) {
    if (nets.has(String(vias[index].net || ''))) vias.splice(index, 1)
  }
}

function padByRefNet(pads, refPattern, netName) {
  return pads
    .filter((pad) => refPattern.test(String(pad.ref || '')) && String(pad.netName || '').toUpperCase() === String(netName).toUpperCase())
    .sort((a, b) => Number(a.x) - Number(b.x) || Number(a.y) - Number(b.y))[0] || null
}

function padByRefPad(pads, refPattern, padName) {
  return pads.find((pad) => refPattern.test(String(pad.ref || '')) && String(pad.pad || pad.name || '').toUpperCase() === String(padName).toUpperCase()) || null
}

function appendPath(segments, net, className, points, widthMm, board) {
  const clean = dedupePoints(points.map((point) => ({ x: round(point.x), y: round(point.y) })))
  if (clean.length < 2 || !pathInsideBoard(clean, board)) return
  for (let index = 1; index < clean.length; index += 1) {
    const start = clean[index - 1]
    const end = clean[index]
    if (Math.hypot(start.x - end.x, start.y - end.y) < 0.04) continue
    segments.push({ net, className, start, end, widthMm, layer: 'F.Cu', status: 'written_needs_drc' })
  }
}

function appendSameNetPadStitches(segments, vias, pads, routingPlan, board) {
  if (!pads.length) return
  const routedNets = new Set((routingPlan.routes || []).filter((route) => route.status === 'routed').map((route) => route.net))
  const stitchable = pads.filter((pad) => routedNets.has(pad.netName) || /^(GND|AGND|DGND)$/i.test(pad.netName))
  const byNet = new Map()
  for (const pad of stitchable) {
    if (!byNet.has(pad.netName)) byNet.set(pad.netName, [])
    byNet.get(pad.netName).push(pad)
  }
  for (const [net, netPads] of byNet.entries()) {
    const widthMm = sameNetStitchWidth(net)
    const connected = new Set()
    for (const pad of netPads) {
      if (padTouchesSameNetCopper(pad, segments, vias)) connected.add(padKey(pad))
    }
    if (!connected.size && netPads.length > 1) {
      const seed = [...netPads].sort((a, b) => a.x - b.x || a.y - b.y)[0]
      connected.add(padKey(seed))
    }
    let guard = 0
    while (connected.size < netPads.length && guard < netPads.length + 4) {
      guard += 1
      let best = null
      for (const pad of netPads) {
        if (connected.has(padKey(pad))) continue
        const target = nearestSameNetCopperPoint(pad, net, segments, vias, netPads.filter((candidate) => connected.has(padKey(candidate))))
        if (!target) continue
        const distance = Math.hypot(pad.x - target.x, pad.y - target.y)
        if (!best || distance < best.distance) best = { pad, target, distance }
      }
      if (!best) break
      if (best.distance > 40) {
        connected.add(padKey(best.pad))
        continue
      }
      appendOrthogonalStitch(segments, {
        net,
        className: classNameForNet(net),
        widthMm,
        start: best.pad,
        end: best.target,
      }, best.pad, best.target, board)
      connected.add(padKey(best.pad))
    }
  }
}

function padTouchesSameNetCopper(pad, segments, vias) {
  for (const segment of segments) {
    if (segment.net !== pad.netName) continue
    if (pointTouchesSegment(pad, segment.start, segment.end)) return true
  }
  for (const via of vias) {
    if (via.net === pad.netName && Math.hypot(via.x - pad.x, via.y - pad.y) <= Math.max(0.08, Math.min(pad.widthMm, pad.heightMm) / 2)) return true
  }
  return false
}

function nearestSameNetCopperPoint(pad, net, segments, vias, connectedPads = []) {
  const candidates = []
  for (const segment of segments) {
    if (segment.net !== net) continue
    const point = closestPointOnSegment(pad, segment.start, segment.end)
    candidates.push({ ...point, layer: segment.layer, source: 'segment' })
  }
  for (const via of vias) {
    if (via.net === net) candidates.push({ x: via.x, y: via.y, layer: 'F.Cu', source: 'via' })
  }
  for (const other of connectedPads) {
    if (other === pad) continue
    candidates.push({ x: other.x, y: other.y, layer: 'F.Cu', source: 'pad' })
  }
  return candidates.sort((a, b) => Math.hypot(pad.x - a.x, pad.y - a.y) - Math.hypot(pad.x - b.x, pad.y - b.y))[0] || null
}

function appendOrthogonalStitch(segments, route, start, end, board) {
  const pathA = dedupePoints([{ x: start.x, y: start.y }, { x: end.x, y: start.y }, { x: end.x, y: end.y }])
  const pathB = dedupePoints([{ x: start.x, y: start.y }, { x: start.x, y: end.y }, { x: end.x, y: end.y }])
  const path = pathInsideBoard(pathA, board) ? pathA : pathB
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]
    const b = path[index]
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.04) continue
    segments.push(routeSegment(route, a, b, 'F.Cu', route.widthMm))
  }
}

function closestPointOnSegment(point, start, end) {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (!length) return { x: start.x, y: start.y }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)))
  return { x: round(start.x + (end.x - start.x) * t), y: round(start.y + (end.y - start.y) * t) }
}

function pathInsideBoard(path, board) {
  return path.every((point) => insideBoardWithMargin(point, board, 0.5))
}

function dedupePoints(points) {
  return points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0.02)
}

function sameNetStitchWidth(net) {
  if (/^(GND|AGND|DGND|VIN|VBUS|VUSB|5V|3V3)$/i.test(net)) return 0.25
  if (/USB_D[PN]/i.test(net)) return 0.127
  return 0.15
}

function classNameForNet(net) {
  if (/^(GND|AGND|DGND)$/i.test(net)) return 'GROUND'
  if (/^(VIN|VBUS|VUSB|5V|3V3)$/i.test(net)) return 'POWER_LOW_CURRENT'
  if (/USB_D[PN]/i.test(net)) return 'USB_DIFF'
  return 'DEFAULT'
}

function padKey(pad) {
  return `${pad.ref || ''}:${pad.pad || pad.name || ''}:${round(pad.x)}:${round(pad.y)}`
}

function stitchingViaIsAllowed(via = {}, board = {}, components = []) {
  if (!insideBoardWithMargin(via, board, 2.5)) return false
  for (const component of components || []) {
    const width = Number(component.width || component.widthMm || 4)
    const height = Number(component.height || component.heightMm || 4)
    const margin = /ESP32|RF|ANTENNA|MODULE/i.test(`${component.group || ''} ${component.value || ''}`) ? 3 : 1.25
    const minX = Number(component.x || 0) - width / 2 - margin
    const maxX = Number(component.x || 0) + width / 2 + margin
    const minY = Number(component.y || 0) - height / 2 - margin
    const maxY = Number(component.y || 0) + height / 2 + margin
    if (via.x >= minX && via.x <= maxX && via.y >= minY && via.y <= maxY) return false
  }
  return true
}

function insideBoardWithMargin(point = {}, board = {}, margin = 0) {
  const xs = (board.outline || []).map((item) => Number(item.x)).filter(Number.isFinite)
  const ys = (board.outline || []).map((item) => Number(item.y)).filter(Number.isFinite)
  if (!xs.length || !ys.length) return true
  return point.x >= Math.min(...xs) + margin
    && point.x <= Math.max(...xs) - margin
    && point.y >= Math.min(...ys) + margin
    && point.y <= Math.max(...ys) - margin
}

function splicePathThroughVias(points = [], vias = []) {
  let path = points.map((point) => ({ x: round(point.x), y: round(point.y) }))
  for (const via of vias || []) {
    const cleanVia = { x: round(via.x), y: round(via.y) }
    if (path.some((point) => samePoint(point, cleanVia))) continue
    const index = nearestSegmentIndex(path, cleanVia)
    path = [...path.slice(0, index + 1), cleanVia, ...path.slice(index + 1)]
  }
  return path
}

function nearestSegmentIndex(points = [], point) {
  if (points.length < 2) return 0
  let bestIndex = 0
  let bestDistance = Infinity
  for (let index = 1; index < points.length; index += 1) {
    const distance = distancePointToSegment(point, points[index - 1], points[index])
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index - 1
    }
  }
  return bestIndex
}

function distancePointToSegment(point, start, end) {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (!length) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)))
  const closest = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
  return Math.hypot(point.x - closest.x, point.y - closest.y)
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001
}

function dedupeVias(vias) {
  const seen = new Set()
  return vias.filter((via) => {
    const key = `${via.net || ''}:${round(via.x)}:${round(via.y)}:${(via.layers || []).join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function connectedViasOnly(vias, segments, pads = []) {
  return vias.filter((via) => {
    const layers = new Set()
    for (const segment of segments) {
      if (segment.net !== via.net) continue
      if (pointTouchesSegment(via, segment.start, segment.end)) layers.add(segment.layer)
    }
    for (const pad of pads) {
      if (pad.netName !== via.net) continue
      if (Math.hypot(pad.x - via.x, pad.y - via.y) <= Math.max(0.08, Math.min(pad.widthMm, pad.heightMm) / 2 + 0.03)) layers.add('F.Cu')
    }
    return layers.has('F.Cu') && [...layers].some((layer) => layer !== 'F.Cu')
  })
}

function pointTouchesSegment(point, start, end) {
  const px = Number(point.x)
  const py = Number(point.y)
  const x1 = Number(start.x)
  const y1 = Number(start.y)
  const x2 = Number(end.x)
  const y2 = Number(end.y)
  const length = Math.hypot(x2 - x1, y2 - y1)
  if (!length) return Math.hypot(px - x1, py - y1) <= 0.01
  const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / (length * length)))
  const closest = { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }
  return Math.hypot(px - closest.x, py - closest.y) <= 0.02
}

function nearestPointIndex(points, target) {
  let bestIndex = 0
  let bestDistance = Infinity
  for (let index = 0; index < points.length; index += 1) {
    const distance = Math.hypot(points[index].x - target.x, points[index].y - target.y)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }
  return bestIndex
}

function appendPathSegments(segments, route, points, layer) {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    if (start.x === end.x && start.y === end.y) continue
    segments.push(routeSegment(route, start, end, layer, segmentWidth(route, start, end)))
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
  if (/\n\s*\(setup\b/.test(content)) return { content: insertBeforeSetup(content, `\n${additions.join('\n')}`), netNumbers }
  return { content: content.replace(/\n\)\s*$/, `\n${additions.join('\n')}\n)`), netNumbers }
}

function netNumberFor(netNumbers, name) {
  if (netNumbers.has(name)) return netNumbers.get(name)
  const normalized = String(name || '').replace(/^\/+/, '')
  if (netNumbers.has(normalized)) return netNumbers.get(normalized)
  const slashName = `/${normalized}`
  if (netNumbers.has(slashName)) return netNumbers.get(slashName)
  return 0
}

function insertBeforeSetup(content, insertion) {
  const match = content.match(/\n(\s*)\(setup\b/)
  if (!match?.index) return content.replace(/\n\)\s*$/, `${insertion}\n)`)
  return `${content.slice(0, match.index)}${insertion}${content.slice(match.index)}`
}

function routeSegment(route, start, end, layer, widthMm = route.widthMm) {
  return {
    net: route.net,
    className: route.className,
    start: { x: round(start.x), y: round(start.y) },
    end: { x: round(end.x), y: round(end.y) },
    widthMm,
    layer,
    status: 'written_needs_drc',
  }
}

function segmentWidth(route, start, end) {
  const base = Number(route.widthMm || 0.15)
  if (/^(MOTOR_PHASE|POWER_HIGH_CURRENT|BATTERY|SWITCHING_NODE)$/i.test(String(route.className || ''))) return round(base)
  const minWidth = route.className === 'POWER_LOW_CURRENT' ? 0.127 : route.className === 'USB_DIFF' ? 0.127 : Math.min(base, 0.15)
  const nearEndpoint = Math.min(distanceToPoint(start, route.start), distanceToPoint(end, route.start), distanceToPoint(start, route.end), distanceToPoint(end, route.end))
  if (nearEndpoint <= 2.2) return round(Math.min(base, minWidth))
  if (route.className === 'USB_DIFF') return round(Math.min(base, 0.15))
  return round(base)
}

function distanceToPoint(a, b) {
  if (!a || !b) return Infinity
  return Math.hypot(Number(a.x || 0) - Number(b.x || 0), Number(a.y || 0) - Number(b.y || 0))
}

function routeElbow(start, end) {
  const horizontalFirst = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
  return horizontalFirst ? { x: end.x, y: start.y } : { x: start.x, y: end.y }
}

function segmentText(segment, netName) {
  return `  (segment (start ${round(segment.start.x)} ${round(segment.start.y)}) (end ${round(segment.end.x)} ${round(segment.end.y)}) (width ${round(segment.widthMm)}) (layer "${segment.layer}") (net "${safeText(netName)}") (uuid "${crypto.randomUUID()}"))`
}

function viaText(via, netName) {
  const layers = viaLayersForKiCad(via)
  return `  (via (at ${round(via.x)} ${round(via.y)}) (size ${round(via.diameterMm)}) (drill ${round(via.drillMm)}) (layers "${layers[0]}" "${layers[1]}") (net "${safeText(netName)}") (uuid "${crypto.randomUUID()}"))`
}

function viaLayersForKiCad(via = {}) {
  const type = String(via.viaType || 'through').toLowerCase()
  if (type === 'blind' || type === 'buried' || type === 'microvia') return via.layers?.length >= 2 ? [via.layers[0], via.layers[1]] : ['F.Cu', 'B.Cu']
  return ['F.Cu', 'B.Cu']
}

function zoneText(zone, netNumber) {
  const pts = zone.polygon.map((point) => `(xy ${round(point.x)} ${round(point.y)})`).join(' ')
  const keepouts = (zone.avoidZones || []).map((avoid) => {
    const keepoutPts = avoid.polygon.map((point) => `(xy ${round(point.x)} ${round(point.y)})`).join(' ')
    return `\n    (keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))\n    (polygon (pts ${keepoutPts}))`
  }).join('')
  const connectPads = zone.thermalRelief
    ? `(connect_pads\n      (clearance ${round(zone.clearanceMm)})\n      (thermal_gap 0.25)\n      (thermal_bridge_width 0.35)\n    )`
    : `(connect_pads yes\n      (clearance ${round(zone.clearanceMm)})\n    )`
  return `  (zone (net ${netNumber}) (net_name "${safeText(zone.net)}") (layer "${zone.layer}") (uuid "${crypto.randomUUID()}")\n    (hatch edge 0.5)\n    (priority 10)\n    ${connectPads}\n    (min_thickness 0.2)\n    (filled_areas_thickness no)\n    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5) (island_removal_mode 1))\n    (polygon (pts ${pts}))${keepouts}\n  )`
}

function materializeAvoidZones(zones = []) {
  return zones.map((zone) => ({
    ...zone,
    polygon: zone.polygon || rectPolygon(Number(zone.x || 0), Number(zone.y || 0), Number(zone.width || 4), Number(zone.height || 4)),
  })).filter((zone) => zone.polygon?.length >= 3)
}

function rectPolygon(x, y, width, height) {
  const halfW = width / 2
  const halfH = height / 2
  return [
    { x: x - halfW, y: y - halfH },
    { x: x + halfW, y: y - halfH },
    { x: x + halfW, y: y + halfH },
    { x: x - halfW, y: y + halfH },
  ]
}

function safeText(value) {
  return String(value || '').replace(/"/g, "'")
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
