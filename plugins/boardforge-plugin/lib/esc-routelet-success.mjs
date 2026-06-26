import { round } from './geometry.mjs'

export function countUnconnectedItems(report = {}) {
  return (report.unconnected_items || []).length
}

export function countUnconnectedItemsByNet(report = {}) {
  const counts = {}
  for (const issue of report.unconnected_items || []) {
    const nets = netsFromIssue(issue)
    for (const net of nets) counts[net] = (counts[net] || 0) + 1
  }
  return counts
}

export function parseKiCadUnconnectedItems(report = {}) {
  const body = report.report || report
  return (body.unconnected_items || [])
    .map((issue, index) => {
      const endpoints = (issue.items || []).map(parseDrcEndpoint).filter(Boolean)
      if (endpoints.length < 2) return null
      const [source, target] = endpoints
      const net = source.net === target.net ? source.net : source.net || target.net
      if (!net) return null
      return {
        unconnectedId: issue.id || stableUnconnectedId(source, target, index),
        net,
        sourceRef: source.ref || null,
        sourcePad: source.pad || null,
        sourceLayer: source.layer || null,
        sourceCoord: { x: source.x, y: source.y },
        targetRef: target.ref || null,
        targetPad: target.pad || null,
        targetLayer: target.layer || null,
        targetCoord: { x: target.x, y: target.y },
        source,
        target,
        distanceMm: round(distance(source, target)),
        netRole: classifyRatsnestNetRole(net),
        issue,
        signature: unconnectedSignature({ net, source, target }),
      }
    })
    .filter(Boolean)
}

export function extractRatsnestEndpointPairs({ drcReport = {}, maxPairs = 30, netPattern = /.*/ } = {}) {
  return parseKiCadUnconnectedItems(drcReport)
    .filter((item) => netPattern.test(String(item.net || '')))
    .sort((a, b) => ratsnestPriority(a) - ratsnestPriority(b) || a.distanceMm - b.distanceMm)
    .slice(0, maxPairs)
    .map((item) => ({
      ...item,
      start: item.source,
      end: item.target,
      reason: 'exact KiCad unconnected item',
    }))
}

export function mapUnconnectedItemToPads(unconnectedItem = {}, pads = []) {
  const findPad = (endpoint) => (pads || []).find((pad) => {
    const padNet = pad.netName || pad.net
    return String(pad.ref || '') === String(endpoint.ref || '')
      && String(pad.pad || pad.name || '') === String(endpoint.pad || '')
      && (!endpoint.net || !padNet || String(padNet) === String(endpoint.net))
  }) || null
  return {
    unconnectedId: unconnectedItem.unconnectedId,
    net: unconnectedItem.net,
    sourcePad: findPad(unconnectedItem.source || {}),
    targetPad: findPad(unconnectedItem.target || {}),
    mapped: Boolean(findPad(unconnectedItem.source || {}) && findPad(unconnectedItem.target || {})),
  }
}

export function verifyUnconnectedItemResolved({ before = {}, after = {}, unconnectedItem = {} } = {}) {
  const beforeItems = parseKiCadUnconnectedItems(before)
  const afterItems = parseKiCadUnconnectedItems(after)
  const signature = unconnectedItem.signature || unconnectedSignature(unconnectedItem)
  const existedBefore = beforeItems.some((item) => item.signature === signature)
  const existsAfter = afterItems.some((item) => item.signature === signature)
  const beforeByNet = countUnconnectedItemsByNet(before.report || before)
  const afterByNet = countUnconnectedItemsByNet(after.report || after)
  return {
    unconnectedId: unconnectedItem.unconnectedId || null,
    net: unconnectedItem.net || null,
    existedBefore,
    existsAfter,
    resolved: existedBefore && !existsAfter,
    globalUnconnectedBefore: beforeItems.length,
    globalUnconnectedAfter: afterItems.length,
    targetNetUnconnectedBefore: unconnectedItem.net ? Number(beforeByNet[unconnectedItem.net] || 0) : null,
    targetNetUnconnectedAfter: unconnectedItem.net ? Number(afterByNet[unconnectedItem.net] || 0) : null,
  }
}

export function diffKiCadUnconnectedItems({ before = {}, after = {} } = {}) {
  const beforeItems = parseKiCadUnconnectedItems(before)
  const afterItems = parseKiCadUnconnectedItems(after)
  const beforeBySignature = new Map(beforeItems.map((item) => [item.signature, item]))
  const afterBySignature = new Map(afterItems.map((item) => [item.signature, item]))
  const resolved = beforeItems.filter((item) => !afterBySignature.has(item.signature))
  const created = afterItems.filter((item) => !beforeBySignature.has(item.signature))
  const unchanged = afterItems.filter((item) => beforeBySignature.has(item.signature))
  return {
    beforeCount: beforeItems.length,
    afterCount: afterItems.length,
    resolved,
    created,
    unchanged,
    netReductions: summarizeUnconnectedNetDelta(beforeItems, afterItems),
  }
}

export function issueCounts(report = {}) {
  const body = report.report || report
  const violations = body.violations || []
  const unconnected = body.unconnected_items || []
  return {
    errors: Number(body.issueCounts?.errors ?? [...violations, ...unconnected].filter((item) => String(item.severity || '').toLowerCase() === 'error').length),
    warnings: Number(body.issueCounts?.warnings ?? [...violations, ...unconnected].filter((item) => String(item.severity || '').toLowerCase() === 'warning').length),
    unconnected: countUnconnectedItems(body),
  }
}

export function evaluateRouteletSuccess({ before = {}, after = {}, route = {}, connectionCompleted = false, operationKind = 'routing_stage', islandsBefore = null, islandsAfter = null, unconnectedItem = null }) {
  const beforeCounts = issueCounts(before)
  const afterCounts = issueCounts(after)
  const net = route.net || null
  const beforeByNet = countUnconnectedItemsByNet(before)
  const afterByNet = countUnconnectedItemsByNet(after)
  const unconnectedReduced = afterCounts.unconnected < beforeCounts.unconnected
  const targetNetUnconnectedReduced = net ? Number(afterByNet[net] || 0) < Number(beforeByNet[net] || 0) : false
  const netIslandsReduced = Number.isFinite(Number(islandsBefore)) && Number.isFinite(Number(islandsAfter)) && Number(islandsAfter) < Number(islandsBefore)
  const exactUnconnected = unconnectedItem ? verifyUnconnectedItemResolved({ before, after, unconnectedItem }) : null
  const exactUnconnectedResolved = exactUnconnected?.resolved === true
  const drcImproved = afterCounts.errors < beforeCounts.errors
    || (afterCounts.errors === beforeCounts.errors && afterCounts.warnings < beforeCounts.warnings)
  const rawDrcWorsened = afterCounts.errors > beforeCounts.errors || afterCounts.warnings > beforeCounts.warnings
  const connectivityUseful = exactUnconnectedResolved || unconnectedReduced || targetNetUnconnectedReduced || netIslandsReduced || connectionCompleted === true
  const useful = operationKind === 'drc_repair' ? drcImproved || connectivityUseful : connectivityUseful
  return {
    net,
    segmentsWritten: Number(route.segmentsWritten || route.geometryWritten?.segments || route.routes?.length || 0),
    connectionCompleted: Boolean(connectionCompleted),
    netIslandsBefore: Number.isFinite(Number(islandsBefore)) ? Number(islandsBefore) : null,
    netIslandsAfter: Number.isFinite(Number(islandsAfter)) ? Number(islandsAfter) : null,
    unconnectedBefore: beforeCounts.unconnected,
    unconnectedAfter: afterCounts.unconnected,
    targetNetUnconnectedBefore: net ? Number(beforeByNet[net] || 0) : null,
    targetNetUnconnectedAfter: net ? Number(afterByNet[net] || 0) : null,
    exactUnconnectedItemResolved: exactUnconnectedResolved,
    exactUnconnected,
    drcBefore: { errors: beforeCounts.errors, warnings: beforeCounts.warnings },
    drcAfter: { errors: afterCounts.errors, warnings: afterCounts.warnings },
    decision: useful && !rawDrcWorsened ? 'commit' : 'rollback_or_retry',
    reason: useful
      ? rawDrcWorsened
        ? 'Routelet made connectivity/DRC progress but raw DRC worsened; rollback required before retry.'
        : operationKind === 'drc_repair'
          ? 'DRC repair made measurable DRC or connectivity progress.'
          : exactUnconnectedResolved
            ? 'Routing bundle resolved the exact KiCad unconnected item it claimed to route.'
            : 'Routing bundle made measurable connectivity progress.'
      : operationKind === 'drc_repair'
        ? 'DRC repair did not improve DRC or connectivity.'
        : 'Routing bundle did not reduce target/global unconnected items, reduce net islands, or verify a completed connection.',
  }
}

export function commitOnlyConnectivityProgress(args = {}) {
  const decision = evaluateRouteletSuccess(args)
  return {
    ...decision,
    commitAllowed: decision.decision === 'commit',
    rollbackRequired: decision.decision !== 'commit',
    successMetric: decision.exactUnconnectedItemResolved
      ? 'exact_unconnected_item_resolved'
      : decision.unconnectedAfter < decision.unconnectedBefore
        ? 'global_unconnected_reduced'
        : Number(decision.targetNetUnconnectedAfter) < Number(decision.targetNetUnconnectedBefore)
          ? 'target_net_unconnected_reduced'
          : Number(decision.netIslandsAfter) < Number(decision.netIslandsBefore)
            ? 'net_islands_reduced'
            : decision.connectionCompleted
              ? 'kicad_connection_confirmed'
              : 'none',
  }
}

export function buildNetConnectivityGraph({ pads = [], tracks = [], vias = [], drcReport = {} }) {
  const byNet = new Map()
  for (const pad of pads || []) {
    const net = pad.netName || pad.net
    if (!net || !Number.isFinite(Number(pad.x)) || !Number.isFinite(Number(pad.y))) continue
    if (!byNet.has(net)) byNet.set(net, [])
    byNet.get(net).push({ id: pad.id || `${pad.ref}:${pad.pad || pad.name}`, ref: pad.ref, pad: pad.pad || pad.name, x: Number(pad.x), y: Number(pad.y), type: 'pad' })
  }
  const unconnectedByNet = countUnconnectedItemsByNet(drcReport)
  return {
    nets: [...byNet.entries()].map(([net, endpoints]) => {
      const graph = connectedEndpointComponents({ net, endpoints, tracks, vias })
      return {
        net,
        pads: endpoints.length,
        connectedIslands: graph.components.length,
        components: graph.components,
        unconnectedItems: Number(unconnectedByNet[net] || 0),
        requiredConnections: requiredConnectionsForNet(net, graph.components),
      }
    }),
  }
}

export function selectEscHighCurrentEndpointPairs({ drcReport = {}, target = 'motor_phase', maxPairs = 12 }) {
  const pairs = []
  for (const issue of drcReport.unconnected_items || []) {
    const items = (issue.items || []).map(parseDrcEndpoint).filter(Boolean)
    if (items.length < 2) continue
    const [start, end] = items
    if (start.net !== end.net) continue
    if (target === 'motor_phase' && !isMotorPhaseNet(start.net)) continue
    if (target === 'battery' && !isBatteryNet(start.net)) continue
    const sameRef = start.ref && end.ref && start.ref === end.ref
    const distanceMm = distance(start, end)
    pairs.push({
      net: start.net,
      start,
      end,
      distanceMm: round(distanceMm),
      priority: endpointPairPriority(start, end, { sameRef, distanceMm }),
      reason: sameRef ? 'same-footprint local stitch candidate' : 'cross-component high-current endpoint candidate',
    })
  }
  return pairs
    .filter((pair) => pair.start.ref !== pair.end.ref)
    .sort((a, b) => a.priority - b.priority || a.distanceMm - b.distanceMm)
    .slice(0, maxPairs)
}

export function findRatsnestEndpointPairs({ connectivityGraph = {}, targetNetPattern = /.*/, maxPairs = 12 }) {
  const output = []
  for (const net of connectivityGraph.nets || []) {
    if (!targetNetPattern.test(String(net.net || ''))) continue
    for (const connection of net.requiredConnections || []) {
      output.push({
        net: net.net,
        start: connection.from,
        end: connection.to,
        distanceMm: round(distance(connection.from, connection.to)),
        reason: connection.reason,
      })
    }
  }
  return output.sort((a, b) => a.distanceMm - b.distanceMm).slice(0, maxPairs)
}

export function buildEscRouteBundle({ pair, layer = null, widthMm = 1.2 }) {
  if (!pair) return null
  const routeLayer = layer || (pair.start.layer === pair.end.layer ? pair.start.layer : 'F.Cu')
  const elbow = Math.abs(pair.end.x - pair.start.x) >= Math.abs(pair.end.y - pair.start.y)
    ? { x: pair.end.x, y: pair.start.y }
    : { x: pair.start.x, y: pair.end.y }
  return {
    status: 'AUTOROUTE_READY_NEEDS_DRC',
    mode: 'esc_staged_motor_phase_routelet',
    routes: [{
      net: pair.net,
      className: 'MOTOR_PHASE',
      status: 'routed',
      start: pair.start,
      end: pair.end,
      waypoints: [pair.start, elbow, pair.end],
      layerPreference: [routeLayer],
      widthMm,
      endpointRefs: [pair.start.ref, pair.end.ref].filter(Boolean),
      endpointPads: [pair.start.pad, pair.end.pad].filter(Boolean),
      strategy: 'esc_motor_phase_endpoint_pair',
    }],
    routedNets: [pair.net],
    unroutedNets: [],
    humanReviewRequired: true,
  }
}

function parseDrcEndpoint(item = {}) {
  const description = String(item.description || '')
  const net = description.match(/\[([^\]]+)\]/)?.[1]
  const ref = description.match(/\bof\s+([A-Z]{1,4}\d+)\b/i)?.[1]
  const pad = description.match(/\bPad\s+([^\s\[]+)/i)?.[1]
  const layer = description.match(/\bon\s+([FB]\.Cu|In\d+\.Cu)\b/i)?.[1] || 'F.Cu'
  const x = Number(item.pos?.x)
  const y = Number(item.pos?.y)
  if (!net || !Number.isFinite(x) || !Number.isFinite(y)) return null
  return { net, ref, pad, layer, x: round(x), y: round(y), id: ref && pad ? `${ref}:${pad}` : undefined, sourceDescription: description }
}

function stableUnconnectedId(source, target, index) {
  const signature = unconnectedSignature({ net: source.net || target.net, source, target }).replace(/[^a-zA-Z0-9_:-]/g, '_')
  return `UCI_${String(index + 1).padStart(3, '0')}_${signature}`
}

function unconnectedSignature({ net, source, target } = {}) {
  const endpoints = [source, target]
    .filter(Boolean)
    .map((endpoint) => `${endpoint.ref || '?'}:${endpoint.pad || '?'}:${round(endpoint.x ?? 0)}:${round(endpoint.y ?? 0)}`)
    .sort()
  return `${net || '?'}|${endpoints.join('|')}`
}

function classifyRatsnestNetRole(net = '') {
  const value = String(net || '')
  if (/BST|BOOT/i.test(value)) return 'BOOTSTRAP'
  if (/HB|SW_|_SW|PHASE/i.test(value)) return 'SWITCHING_NODE'
  if (/HG|LG|HI|LO|GATE/i.test(value)) return 'GATE_DRIVE'
  if (/SHUNT|ISENSE|SENSE|VDDA|VREF/i.test(value)) return 'CURRENT_SENSE'
  if (/VBAT|VIN|BATT/i.test(value)) return 'HIGH_CURRENT_POWER'
  if (/PGND|GND/i.test(value)) return 'GROUND'
  if (/I2C|SCL|SDA|SWD|NRST|TELEM|OSC|PGOOD|RAMP|SS_/i.test(value)) return 'CONTROL_SIGNAL'
  if (/VREG|VDD|3V3|5V|12/i.test(value)) return 'REGULATED_RAIL'
  return 'LOW_SPEED_SIGNAL'
}

function ratsnestPriority(item = {}) {
  const roleScore = {
    CONTROL_SIGNAL: 0,
    GATE_DRIVE: 20,
    BOOTSTRAP: 30,
    REGULATED_RAIL: 40,
    CURRENT_SENSE: 50,
    GROUND: 70,
    HIGH_CURRENT_POWER: 80,
    SWITCHING_NODE: 90,
    LOW_SPEED_SIGNAL: 10,
  }[item.netRole] ?? 60
  return roleScore + Math.min(200, Number(item.distanceMm || 0))
}

function summarizeUnconnectedNetDelta(beforeItems = [], afterItems = []) {
  const count = (items) => items.reduce((acc, item) => {
    acc[item.net] = (acc[item.net] || 0) + 1
    return acc
  }, {})
  const before = count(beforeItems)
  const after = count(afterItems)
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .map((net) => ({ net, before: before[net] || 0, after: after[net] || 0, delta: (after[net] || 0) - (before[net] || 0) }))
    .filter((item) => item.delta !== 0)
}

function connectedEndpointComponents({ net, endpoints = [], tracks = [], vias = [] }) {
  const parent = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint.id]))
  const find = (id) => {
    let cursor = id
    while (parent.get(cursor) !== cursor) {
      parent.set(cursor, parent.get(parent.get(cursor)))
      cursor = parent.get(cursor)
    }
    return cursor
  }
  const union = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootB, rootA)
  }
  const sameNetTracks = (tracks || []).filter((track) => (track.netName || track.net) === net)
  for (const track of sameNetTracks) {
    const touched = endpoints.filter((endpoint) => pointTouchesTrack(endpoint, track))
    for (let index = 1; index < touched.length; index += 1) union(touched[0].id, touched[index].id)
  }
  const sameNetVias = (vias || []).filter((via) => (via.netName || via.net) === net)
  for (const via of sameNetVias) {
    const touched = endpoints.filter((endpoint) => distance(endpoint, via) <= 0.18)
    for (let index = 1; index < touched.length; index += 1) union(touched[0].id, touched[index].id)
  }
  const groups = new Map()
  for (const endpoint of endpoints) {
    const root = find(endpoint.id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(endpoint)
  }
  return { components: [...groups.values()] }
}

function requiredConnectionsForNet(net, components = []) {
  if (components.length < 2) return []
  const output = []
  const ordered = [...components].sort((a, b) => bestEndpointScore(a, net) - bestEndpointScore(b, net))
  const root = ordered[0]
  for (let index = 1; index < ordered.length; index += 1) {
    const from = bestEndpoint(root, net)
    const to = bestEndpoint(ordered[index], net)
    if (!from || !to || from.ref === to.ref) continue
    output.push({ from, to, reason: 'connect disconnected same-net copper island' })
  }
  return output
}

function bestEndpoint(component = [], net = '') {
  return [...component].sort((a, b) => endpointRoleScore(a, net) - endpointRoleScore(b, net))[0] || null
}

function bestEndpointScore(component = [], net = '') {
  return endpointRoleScore(bestEndpoint(component, net), net)
}

function endpointRoleScore(endpoint = {}, net = '') {
  let score = 0
  if (/VBAT|VIN|BATT/i.test(net) && /^J\d+/i.test(endpoint.ref || '')) score -= 200
  if (isMotorPhaseNet(net) && /^J\d+/i.test(endpoint.ref || '')) score -= 200
  if (isMotorPhaseNet(net) && /^Q\d+/i.test(endpoint.ref || '')) score -= 120
  if (/PGND|GND/i.test(net) && /^J\d+|R_SHUNT|R\d+/i.test(endpoint.ref || '')) score -= 80
  return score
}

function pointTouchesTrack(point, track = {}) {
  const start = track.start || { x: track.x1, y: track.y1 }
  const end = track.end || { x: track.x2, y: track.y2 }
  if (!Number.isFinite(Number(start.x)) || !Number.isFinite(Number(start.y)) || !Number.isFinite(Number(end.x)) || !Number.isFinite(Number(end.y))) return false
  return distancePointToSegment(point, start, end) <= Math.max(0.18, Number(track.widthMm || track.width || 0.2) / 2 + 0.08)
}

function distancePointToSegment(point, start, end) {
  const px = Number(point.x)
  const py = Number(point.y)
  const ax = Number(start.x)
  const ay = Number(start.y)
  const bx = Number(end.x)
  const by = Number(end.y)
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function netsFromIssue(issue = {}) {
  const text = `${issue.description || ''} ${(issue.items || []).map((item) => item.description || '').join(' ')}`
  return [...new Set((text.match(/\[([^\]]+)\]/g) || []).map((match) => match.slice(1, -1)).filter((net) => net && net !== '<no net>'))]
}

function endpointPairPriority(start, end, { sameRef, distanceMm }) {
  let score = sameRef ? 1000 : 0
  if (isConnector(start.ref) || isConnector(end.ref)) score -= 200
  if (isMosfet(start.ref) || isMosfet(end.ref)) score -= 120
  if (isGateDriver(start.ref) || isGateDriver(end.ref)) score += 80
  if (start.layer !== end.layer) score += 40
  score += Math.min(200, distanceMm)
  return score
}

function isMotorPhaseNet(net = '') {
  return /(^|\/)(M\d+_[ABC]_SW|PHASE_[ABC]|MOTOR_[ABC]|MOTOR\d*_[ABC]|[UVW]_PHASE)$/i.test(String(net))
}

function isBatteryNet(net = '') {
  return /(^|\/)(VBAT|VBAT_RAW|VBAT_HK|VIN|BATT|BAT|PACK\+|VMAIN|VDC)$/i.test(String(net))
}

function isConnector(ref = '') {
  return /^J\d+/i.test(String(ref || ''))
}

function isMosfet(ref = '') {
  return /^Q\d+/i.test(String(ref || ''))
}

function isGateDriver(ref = '') {
  return /^U\d+/i.test(String(ref || ''))
}

function distance(a, b) {
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y))
}
