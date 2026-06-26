export const powerRepairNets = [
  'GND',
  'AGND',
  'DGND',
  'GND_FIELD',
  'VIN',
  'VBUS',
  'VUSB',
  'VBAT',
  'BAT',
  '5V',
  '3V3',
  '1V8',
  'VCC',
  'VDD',
  '12V',
  '24V',
  '24V_FIELD',
]

export function isPowerRepairNet(netName = '') {
  return powerRepairNets.some((net) => net.toUpperCase() === String(netName || '').toUpperCase())
}

export function powerRepairStrategyForNet(netName = '') {
  const net = String(netName || '').toUpperCase()
  if (/GND/.test(net)) return { strategy: 'ground_distribution_bundle', preferredLayer: 'B.Cu', widthMm: 0.35, clearanceMm: 0.2, zonePreferred: true }
  if (/VBAT|BAT|VIN|12V|24V/.test(net)) return { strategy: 'high_current_power_bundle', preferredLayer: 'B.Cu', widthMm: 0.8, clearanceMm: 0.25, zonePreferred: true }
  if (/3V3|5V|1V8|VUSB|VBUS|VCC|VDD/.test(net)) return { strategy: 'low_current_power_bundle', preferredLayer: 'F.Cu', widthMm: 0.35, clearanceMm: 0.2, zonePreferred: false }
  return { strategy: 'signal_routelet', preferredLayer: 'F.Cu', widthMm: 0.15, clearanceMm: 0.15, zonePreferred: false }
}

export function clusterDrcPowerIssues(drcReport = {}) {
  const issues = [...(drcReport.violations || []), ...(drcReport.unconnected_items || [])]
  const clusters = new Map()
  for (const issue of issues.filter((item) => String(item.severity || '').toLowerCase() === 'error')) {
    const nets = netsFromIssue(issue)
    const powerNets = nets.filter(isPowerRepairNet)
    if (!powerNets.length) continue
    for (const net of powerNets) {
      const key = `${issue.type || 'unknown'}:${net}`
      const current = clusters.get(key) || { net, type: issue.type || 'unknown', count: 0, examples: [] }
      current.count += 1
      if (current.examples.length < 5) current.examples.push(issue.description || issue.message || issue.type || 'issue')
      clusters.set(key, current)
    }
  }
  return [...clusters.values()].sort((a, b) => b.count - a.count)
}

export function clusterDrcIssues(drcReport = {}) {
  const issues = [...(drcReport.violations || []), ...(drcReport.unconnected_items || [])]
  const clusters = new Map()
  for (const issue of issues.filter((item) => String(item.severity || '').toLowerCase() === 'error')) {
    const nets = netsFromIssue(issue)
    const refs = refsFromIssue(issue)
    const layers = layersFromIssue(issue)
    const type = issue.type || issue.code || 'unknown'
    const primaryNet = nets[0] || 'unclassified'
    const primaryRef = refs[0] || 'board'
    const layer = layers[0] || 'unknown'
    const key = `${type}:${primaryNet}:${layer}:${primaryRef}`
    const current = clusters.get(key) || {
      net: primaryNet,
      type,
      component: primaryRef,
      layer,
      region: regionFromIssue(issue),
      count: 0,
      rootCause: rootCauseForIssue(type, primaryNet, primaryRef),
      repairStrategy: repairStrategyForIssue(type, primaryNet),
      examples: [],
    }
    current.count += 1
    if (current.examples.length < 5) {
      current.examples.push(issue.description || issue.message || issue.type || 'issue')
    }
    clusters.set(key, current)
  }
  return [...clusters.values()].sort((a, b) => b.count - a.count)
}

function netsFromIssue(issue = {}) {
  const text = `${issue.description || ''} ${(issue.items || []).map((item) => item.description || '').join(' ')}`
  return [...new Set((text.match(/\[([^\]]+)\]/g) || []).map((match) => match.slice(1, -1)).filter(Boolean))]
}

function refsFromIssue(issue = {}) {
  const text = `${issue.description || ''} ${(issue.items || []).map((item) => item.description || '').join(' ')}`
  return [...new Set((text.match(/\b[A-Z]{1,3}\d+\b/g) || []).filter((ref) => !/^(V|R|C)$/.test(ref)))]
}

function layersFromIssue(issue = {}) {
  const text = `${issue.description || ''} ${(issue.items || []).map((item) => item.description || '').join(' ')}`
  return [...new Set((text.match(/\b(?:F|B|In\d+)\.(?:Cu|SilkS|Mask|Paste)\b/g) || []))]
}

function regionFromIssue(issue = {}) {
  const text = `${issue.description || ''} ${(issue.items || []).map((item) => item.description || '').join(' ')}`
  const coords = [...text.matchAll(/@\s*\(([-\d.]+)\s*mm,\s*([-\d.]+)\s*mm\)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (!coords.length) return 'unknown'
  const xs = coords.map((point) => point.x)
  const ys = coords.map((point) => point.y)
  return `${Math.min(...xs).toFixed(1)},${Math.min(...ys).toFixed(1)}-${Math.max(...xs).toFixed(1)},${Math.max(...ys).toFixed(1)}`
}

function rootCauseForIssue(type = '', net = '', ref = '') {
  const lowerType = String(type).toLowerCase()
  const upperNet = String(net).toUpperCase()
  if (/unconnected/.test(lowerType) && /GND/.test(upperNet)) return 'incomplete ground distribution or missing legal GND zone connection'
  if (/unconnected/.test(lowerType) && isPowerRepairNet(upperNet)) return 'incomplete power rail distribution between source and loads'
  if (/unconnected/.test(lowerType)) return 'missing endpoint-to-endpoint route for signal net'
  if (/clearance/.test(lowerType) && /J\d+|TB\d+|RJ\d+/.test(ref)) return 'connector or field-side routing too close to adjacent copper or board features'
  if (/clearance/.test(lowerType) && isPowerRepairNet(upperNet)) return 'power route or via violates clearance near copper, holes, or board edge'
  if (/clearance/.test(lowerType)) return 'route segment violates obstacle or manufacturer spacing'
  if (/width/.test(lowerType)) return 'trace width does not satisfy net class or manufacturer rule'
  if (/hole|edge/.test(lowerType)) return 'copper or component feature too close to hole, cutout, or Edge.Cuts'
  if (/courtyard|overlap/.test(lowerType)) return 'placement spacing or footprint courtyard conflict'
  return 'uncategorized DRC issue requires fixture-specific review'
}

function repairStrategyForIssue(type = '', net = '') {
  const lowerType = String(type).toLowerCase()
  const upperNet = String(net).toUpperCase()
  if (/GND/.test(upperNet)) return 'ground zone and stitching repair with edge/hole clearance checks'
  if (isPowerRepairNet(upperNet)) return `${powerRepairStrategyForNet(upperNet).strategy} with endpoint-aware reroute`
  if (/unconnected/.test(lowerType)) return 'endpoint-aware route from source pad to destination pad'
  if (/clearance|short/.test(lowerType)) return 'rip up offending repair segment and reroute around obstacle'
  if (/width/.test(lowerType)) return 'apply net-class width or reroute with enough space'
  if (/hole|edge/.test(lowerType)) return 'move route inward or require placement/outline change'
  if (/courtyard|overlap/.test(lowerType)) return 'placement repair before routing'
  return 'manual categorized review before safe automatic repair'
}
