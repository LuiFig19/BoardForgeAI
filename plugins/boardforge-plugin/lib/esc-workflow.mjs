import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { round } from './geometry.mjs'
import { assignNetsToClasses } from './net-classes.mjs'
import { scanKiCadProject, syncKiCadProjectNetSettings } from './kicad.mjs'

export const escNetClassProfiles = {
  BATTERY: { traceWidthMm: 1.2, preferredTraceWidthMm: 2.4, clearanceMm: 0.35, viaDiameterMm: 0.9, viaDrillMm: 0.45, preferredLayers: ['F.Cu', 'In2.Cu', 'B.Cu'], routingPriority: 98, preferred: 'zone_or_wide_trace', allowViaArray: true, noise: 'noisy_power' },
  POWER_HIGH_CURRENT: { traceWidthMm: 1.0, preferredTraceWidthMm: 2.0, clearanceMm: 0.3, viaDiameterMm: 0.85, viaDrillMm: 0.4, preferredLayers: ['F.Cu', 'In2.Cu', 'B.Cu'], routingPriority: 96, preferred: 'zone_or_wide_trace', allowViaArray: true },
  MOTOR_PHASE: { traceWidthMm: 1.0, preferredTraceWidthMm: 2.0, clearanceMm: 0.35, viaDiameterMm: 0.9, viaDrillMm: 0.45, preferredLayers: ['F.Cu', 'In2.Cu', 'B.Cu'], routingPriority: 97, preferred: 'zone_or_wide_trace', allowViaArray: true, keepAwayFrom: ['CURRENT_SENSE', 'KELVIN_SENSE', 'MCU_CONTROL'] },
  GATE_DRIVE: { traceWidthMm: 0.2, preferredTraceWidthMm: 0.25, clearanceMm: 0.18, viaDiameterMm: 0.45, viaDrillMm: 0.2, preferredLayers: ['F.Cu', 'B.Cu'], routingPriority: 88, maxLengthMm: 35, sensitivity: 'short_loop' },
  SWITCHING_NODE: { traceWidthMm: 0.6, preferredTraceWidthMm: 1.0, clearanceMm: 0.35, viaDiameterMm: 0.7, viaDrillMm: 0.35, preferredLayers: ['F.Cu', 'In2.Cu'], routingPriority: 94, noise: 'high_dvdt', keepAwayFrom: ['CURRENT_SENSE', 'KELVIN_SENSE', 'MCU_CONTROL'] },
  CURRENT_SENSE: { traceWidthMm: 0.15, preferredTraceWidthMm: 0.18, clearanceMm: 0.22, viaDiameterMm: 0.45, viaDrillMm: 0.2, preferredLayers: ['F.Cu', 'In3.Cu', 'In5.Cu'], routingPriority: 90, sensitivity: 'quiet_analog' },
  KELVIN_SENSE: { traceWidthMm: 0.12, preferredTraceWidthMm: 0.15, clearanceMm: 0.22, viaDiameterMm: 0.4, viaDrillMm: 0.18, preferredLayers: ['F.Cu', 'In5.Cu'], routingPriority: 92, pairRequired: true, sensitivity: 'kelvin_quiet' },
  GND: { traceWidthMm: 0.3, preferredTraceWidthMm: 0.6, clearanceMm: 0.15, viaDiameterMm: 0.5, viaDrillMm: 0.25, preferredLayers: ['In1.Cu', 'In6.Cu', 'B.Cu'], routingPriority: 100, preferred: 'solid_reference_plane' },
  PGND: { traceWidthMm: 0.6, preferredTraceWidthMm: 1.2, clearanceMm: 0.22, viaDiameterMm: 0.7, viaDrillMm: 0.35, preferredLayers: ['In1.Cu', 'In6.Cu', 'B.Cu'], routingPriority: 99, preferred: 'power_return_plane_or_pour' },
  POWER_LOW_CURRENT: { traceWidthMm: 0.25, preferredTraceWidthMm: 0.35, clearanceMm: 0.15, viaDiameterMm: 0.5, viaDrillMm: 0.25, preferredLayers: ['F.Cu', 'In4.Cu', 'B.Cu'], routingPriority: 70 },
  VREG: { traceWidthMm: 0.3, preferredTraceWidthMm: 0.45, clearanceMm: 0.18, viaDiameterMm: 0.5, viaDrillMm: 0.25, preferredLayers: ['F.Cu', 'In4.Cu', 'B.Cu'], routingPriority: 78 },
  MCU_CONTROL: { traceWidthMm: 0.15, preferredTraceWidthMm: 0.15, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, preferredLayers: ['F.Cu', 'In3.Cu', 'In5.Cu', 'B.Cu'], routingPriority: 45, sensitivity: 'logic' },
  DEBUG: { traceWidthMm: 0.15, preferredTraceWidthMm: 0.15, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, preferredLayers: ['F.Cu', 'B.Cu'], routingPriority: 35 },
  SIGNAL_DEFAULT: { traceWidthMm: 0.15, preferredTraceWidthMm: 0.15, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, preferredLayers: ['F.Cu', 'In3.Cu', 'B.Cu'], routingPriority: 40 },
}

export async function analyzeErcReport({ reportFile }) {
  const content = await readFile(reportFile, 'utf8')
  const issues = parseErcReport(content)
  const clusters = clusterErcIssues(issues)
  const blockers = clusters.filter((cluster) => cluster.blocking)
  return {
    status: blockers.length ? 'ERC_ANALYSIS_BLOCKED' : clusters.length ? 'ERC_ANALYSIS_NEEDS_REVIEW' : 'ERC_ANALYSIS_CLEAN',
    reportFile,
    totalErcViolations: issues.length,
    clusters,
    blockers,
    needsReview: clusters.filter((cluster) => !cluster.blocking && cluster.count > 0),
    humanReviewRequired: Boolean(clusters.length),
  }
}

export async function analyzeEscRoutingFeasibility({ projectPath, ercAnalysis = null, drcSummary = null }) {
  const scan = await scanKiCadProject(projectPath)
  const netNames = unique((scan.pads || []).map((pad) => pad.netName).filter(Boolean))
  const nets = classifyEscNets(netNames.map((name) => ({ name })))
  const counts = classCounts(nets)
  const areaMm2 = round((scan.boardSize?.widthMm || 0) * (scan.boardSize?.heightMm || 0))
  const componentDensityPer1000Mm2 = areaMm2 ? round((scan.footprints?.length || 0) / areaMm2 * 1000) : 0
  const highCurrentNetCount = countClasses(counts, ['BATTERY', 'POWER_HIGH_CURRENT', 'MOTOR_PHASE', 'SWITCHING_NODE', 'PGND'])
  const signalSensitiveCount = countClasses(counts, ['CURRENT_SENSE', 'KELVIN_SENSE', 'MCU_CONTROL'])
  const twoLayerFeasible = !(
    (scan.layerCount || 2) <= 2
    && ((scan.footprints?.length || 0) > 80 || netNames.length > 120 || componentDensityPer1000Mm2 > 70 || highCurrentNetCount > 12)
  )
  const recommendedMvpLayerCount = twoLayerFeasible ? Math.max(scan.layerCount || 2, 4) : 6
  const recommendedLayerRange = twoLayerFeasible ? [4, 6] : [6, 10]
  const reasons = [
    `${scan.footprints?.length || 0} footprints in ${scan.boardSize?.widthMm || 0}mm x ${scan.boardSize?.heightMm || 0}mm`,
    `${netNames.length} nets and ${scan.pads?.length || 0} pads`,
    ...(drcSummary?.unconnectedItems ? [`${drcSummary.unconnectedItems} unconnected items`] : []),
    ...(highCurrentNetCount ? [`${highCurrentNetCount} high-current/switching/power-return ESC nets need zones, wide traces, or via arrays`] : []),
    ...(signalSensitiveCount ? [`${signalSensitiveCount} current-sense/control nets need separation from switching and phase copper`] : []),
    ...((ercAnalysis?.blockers || []).length ? [`${ercAnalysis.blockers.length} ERC blocker cluster(s) must be resolved before routing`] : []),
  ]
  return {
    status: twoLayerFeasible ? 'ESC_ROUTING_FEASIBILITY_READY_NEEDS_REVIEW' : 'ESC_ROUTING_FEASIBILITY_REQUIRES_STACKUP_MIGRATION',
    projectPath,
    componentCount: scan.footprints?.length || 0,
    netCount: netNames.length,
    padCount: scan.pads?.length || 0,
    boardAreaMm2: areaMm2,
    layerCount: scan.layerCount || 2,
    densityMetric: { componentDensityPer1000Mm2, padsPer1000Mm2: areaMm2 ? round((scan.pads?.length || 0) / areaMm2 * 1000) : 0 },
    highCurrentNetCount,
    motorPhaseNetCount: counts.MOTOR_PHASE || 0,
    gateDriveNetCount: counts.GATE_DRIVE || 0,
    currentSenseNetCount: (counts.CURRENT_SENSE || 0) + (counts.KELVIN_SENSE || 0),
    powerRailCount: countClasses(counts, ['BATTERY', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'VREG']),
    expectedRoutingChannels: estimateRoutingChannels(scan, counts),
    twoLayerFeasible,
    recommendedLayerRange,
    recommendedMvpLayerCount,
    reason: reasons,
    netClassCounts: counts,
    humanReviewRequired: true,
  }
}

export async function migrateEscPcbStackup({ pcbFile, layerCount = 6 }) {
  const original = await readFile(pcbFile, 'utf8')
  const stackup = escStackup(layerCount)
  const withLayers = replaceBlockByHead(original, 'layers', layersBlock(stackup))
  const withStackup = replaceStackupBlock(withLayers, stackupBlock(stackup))
  const changed = withStackup !== original
  if (changed) await writeFile(pcbFile, withStackup, 'utf8')
  return {
    status: changed ? 'ESC_STACKUP_MIGRATED_NEEDS_DRC' : 'ESC_STACKUP_ALREADY_CURRENT',
    pcbFile,
    layerCount,
    stackup,
    changed,
    humanReviewRequired: true,
  }
}

export async function applyEscNetClasses({ projectDir, projectFile, pcbFile, nets = [] }) {
  const classified = classifyEscNets(nets)
  const classes = Object.entries(escNetClassProfiles).map(([name, values]) => ({ name, ...values }))
  const proSync = projectFile ? await syncKiCadProjectNetSettings({ projectFile, nets: classified, netClasses: classes }) : null
  let pcbChanged = false
  if (pcbFile) {
    const original = await readFile(pcbFile, 'utf8')
    const next = stripLegacyPcbNetClasses(original)
    pcbChanged = next !== original
    if (pcbChanged) await writeFile(pcbFile, next, 'utf8')
  }
  return {
    status: proSync?.changed || pcbChanged ? 'ESC_NET_CLASSES_APPLIED_NEEDS_DRC' : 'ESC_NET_CLASSES_CURRENT',
    projectDir,
    projectFile,
    pcbFile,
    classes,
    classifiedNetCount: classified.length,
    classCounts: classCounts(classified),
    projectSync: proSync,
    pcbChanged,
    humanReviewRequired: true,
  }
}

export function classifyEscNets(nets = []) {
  return assignNetsToClasses(nets).map((net) => {
    const name = String(net.name || '').replace(/^\/+/, '')
    const className = escClassForName(name, net.className)
    return { ...net, className }
  })
}

export function parseErcReport(content = '') {
  if (/^\s*\{/.test(content)) return parseErcJson(content)
  const issues = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\[([^\]]+)\]:\s*(.*)$/)
    if (!match) continue
    const details = []
    let severity = 'warning'
    let cursor = i + 1
    while (cursor < lines.length && !/^\[[^\]]+\]:/.test(lines[cursor])) {
      const line = lines[cursor].trim()
      if (/^;\s*(error|warning)/i.test(line)) severity = line.replace(/^;\s*/i, '').toLowerCase()
      else if (line) details.push(line)
      cursor += 1
    }
    issues.push({ type: match[1], message: match[2], severity, details })
  }
  return issues
}

function parseErcJson(content) {
  try {
    const report = JSON.parse(content)
    const direct = (report.sheets || []).flatMap((sheet) => sheet.violations || [])
    const source = direct.length ? direct : report.violations || report.errors || []
    const issues = source.map((value) => ({
      type: value.type || value.rule || value.code || 'erc_issue',
      message: value.description || value.message || value.name || '',
      severity: value.severity || value.kind || 'warning',
      details: (value.items || value.details || []).map((item) => typeof item === 'string' ? item : item.description || JSON.stringify(item)),
    }))
    return uniqueBy(issues, (issue) => JSON.stringify(issue))
  } catch {
    return []
  }
}

function clusterErcIssues(issues) {
  const grouped = new Map()
  for (const issue of issues) {
    const type = ercClusterType(issue)
    if (!grouped.has(type)) grouped.set(type, [])
    grouped.get(type).push(issue)
  }
  return [...grouped.entries()].map(([type, clusterIssues]) => ({
    type,
    count: clusterIssues.length,
    blocking: clusterBlocking(type, clusterIssues),
    recommendedFix: clusterFix(type),
    examples: clusterIssues.slice(0, 4).map((issue) => ({ type: issue.type, message: issue.message, severity: issue.severity, details: issue.details?.slice?.(0, 2) || [] })),
  })).sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.count - a.count)
}

function ercClusterType(issue) {
  const text = `${issue.type || ''} ${issue.message || ''} ${(issue.details || []).join(' ')}`.toLowerCase()
  if (/lib_symbol_mismatch|symbol.*library|library.*symbol/.test(text)) return 'schematic_symbol_issue'
  if (/footprint/.test(text)) return 'footprint_library_issue'
  if (/pin_to_pin|pin type|output.*output|conflict/.test(text)) return 'pin_type_conflict'
  if (/power.*flag|not driven|power input|input power/.test(text)) return 'missing_power_flag'
  if (/unconnected|required|no connect|dangling/.test(text)) return 'unconnected_required_pin'
  if (/no driver|not driven|driver/.test(text)) return 'no_driver'
  if (/hierarchical/.test(text)) return 'hierarchical_label_issue'
  if (/label/.test(text)) return 'net_label_issue'
  return 'erc_false_positive_or_review'
}

function clusterBlocking(type, issues) {
  if (['unconnected_required_pin', 'no_driver'].includes(type)) return true
  if (type === 'missing_power_flag') return issues.some((issue) => /error/i.test(issue.severity || ''))
  if (type === 'pin_type_conflict') return issues.some((issue) => /error/i.test(issue.severity || ''))
  return false
}

function clusterFix(type) {
  const fixes = {
    missing_power_flag: 'Add a real power source/PWR_FLAG only after confirming rail intent.',
    unconnected_required_pin: 'Repair schematic connectivity or mark intentional no-connect before routing.',
    no_driver: 'Add or correct the driving source for the net before routing.',
    pin_type_conflict: 'Fix symbol pin electrical type or schematic intent; do not suppress blindly.',
    schematic_symbol_issue: 'Update project/library symbol copy and verify pin mapping before ERC signoff.',
    footprint_library_issue: 'Resolve footprint library path or bind a reviewed footprint.',
    net_label_issue: 'Repair labels so schematic/netlist intent is explicit.',
    hierarchical_label_issue: 'Repair sheet/interface labels before netlist generation.',
    erc_false_positive_or_review: 'Classify during human review; leave as NEEDS_REVIEW until accepted.',
  }
  return fixes[type] || 'Review ERC issue before routing.'
}

function escClassForName(name, fallback = 'SIGNAL_DEFAULT') {
  if (/^(PGND|P_GND|POWER_GND)$/i.test(name)) return 'PGND'
  if (/^(GND|AGND|DGND|GNDA|GROUND)$/i.test(name)) return 'GND'
  if (/^(VBAT|VBAT_RAW|VBAT_HK|VBAT_SENSE|VIN_RAW|BAT|BATT|BATT\+|PACK\+|VMAIN|VDC|DC_IN)$/i.test(name)) return 'BATTERY'
  if (/^(M\d+_[ABC]|MOTOR|PHASE|PHASE_[ABC]|OUT_[UVW])$/i.test(name)) return 'MOTOR_PHASE'
  if (/^(M\d+_[ABC]_SW|.*_SW|SW_\d+|SW|LX|BST_.*|.*_BST|.*_HB)$/i.test(name)) return 'SWITCHING_NODE'
  if (/^(.*_SHUNT_[PN]|SHUNT_[PN]|SENSE_[PN].*)$/i.test(name)) return 'KELVIN_SENSE'
  if (/^(ISENSE.*|I_SENSE.*|CURRENT_SENSE.*|CS[ANP]?.*|CSA.*|.*_SENSE)$/i.test(name)) return 'CURRENT_SENSE'
  if (/^((M\d+_[ABC]_)?(HG|LG|HI|LO)|M\d+_[ABC]_(HG|LG|HI|LO)|GATE[_-]?[HL]?|HO\d*|LO\d*|HIN|LIN|PWM[_-]?.*|DSHOT.*)$/i.test(name)) return 'GATE_DRIVE'
  if (/^(VREG\d*|VREG3V3|VREG5|VREG12|VDDA|.*_VDD)$/i.test(name)) return 'VREG'
  if (/^(VIN|VBUS|5V|3V3|3\.3V|1V8|VCC|VDD|VUSB)$/i.test(name)) return 'POWER_LOW_CURRENT'
  if (/^(SWDIO|SWCLK|JTMS|JTCK|JTAG|DEBUG)/i.test(name)) return 'DEBUG'
  if (/^(TX|RX|UART|SDA|SCL|I2C|SPI|MISO|MOSI|SCK|CS|EN|ENABLE|NRST|RESET|RST|BOOT|LED|HSE|OSC|XTAL)/i.test(name)) return 'MCU_CONTROL'
  return fallback && fallback !== 'DEFAULT' ? fallback : 'SIGNAL_DEFAULT'
}

function escStackup(layerCount) {
  if (Number(layerCount) >= 8) {
    return [
      { index: 0, name: 'F.Cu', role: 'components, short critical signals, gate loops' },
      { index: 4, name: 'In1.Cu', role: 'solid GND / PGND reference' },
      { index: 6, name: 'In2.Cu', role: 'VBAT / high-current power support' },
      { index: 8, name: 'In3.Cu', role: 'control and sensor signals' },
      { index: 10, name: 'In4.Cu', role: 'regulated rails / 5V / 3V3 / VREG' },
      { index: 12, name: 'In5.Cu', role: 'control/sense routing, current-sense protected routes' },
      { index: 14, name: 'In6.Cu', role: 'solid GND / return / shielding' },
      { index: 2, name: 'B.Cu', role: 'components/signals/power support' },
    ]
  }
  return [
    { index: 0, name: 'F.Cu', role: 'components, short critical signals, gate loops' },
    { index: 4, name: 'In1.Cu', role: 'solid GND / PGND reference' },
    { index: 6, name: 'In2.Cu', role: 'power rails / VBAT / phase support' },
    { index: 8, name: 'In3.Cu', role: 'signals / control / sense routing' },
    { index: 10, name: 'In4.Cu', role: 'solid GND / return' },
    { index: 2, name: 'B.Cu', role: 'components/signals/power support' },
  ]
}

function layersBlock(stackup) {
  const copper = stackup.map((layer) => `\t\t(${layer.index} "${layer.name}" signal)`).join('\n')
  return `\t(layers\n${copper}\n\t\t(9 "F.Adhes" user "F.Adhesive")\n\t\t(11 "B.Adhes" user "B.Adhesive")\n\t\t(13 "F.Paste" user)\n\t\t(15 "B.Paste" user)\n\t\t(5 "F.SilkS" user "F.Silkscreen")\n\t\t(7 "B.SilkS" user "B.Silkscreen")\n\t\t(1 "F.Mask" user)\n\t\t(3 "B.Mask" user)\n\t\t(17 "Dwgs.User" user "User.Drawings")\n\t\t(19 "Cmts.User" user "User.Comments")\n\t\t(21 "Eco1.User" user "User.Eco1")\n\t\t(23 "Eco2.User" user "User.Eco2")\n\t\t(25 "Edge.Cuts" user)\n\t\t(27 "Margin" user)\n\t\t(31 "F.CrtYd" user "F.Courtyard")\n\t\t(29 "B.CrtYd" user "B.Courtyard")\n\t\t(35 "F.Fab" user)\n\t\t(33 "B.Fab" user)\n\t\t(39 "User.1" user)\n\t\t(41 "User.2" user)\n\t\t(43 "User.3" user)\n\t\t(45 "User.4" user)\n\t)`
}

function stackupBlock(stackup) {
  const copperAndDielectric = stackup.flatMap((layer, index) => {
    const items = [`\t\t\t(layer "${layer.name}"\n\t\t\t\t(type "copper")\n\t\t\t\t(thickness 0.035)\n\t\t\t)`]
    if (index < stackup.length - 1) {
      const thickness = index === 0 || index === stackup.length - 2 ? 0.18 : 0.28
      items.push(`\t\t\t(layer "dielectric ${index + 1}"\n\t\t\t\t(type "core")\n\t\t\t\t(thickness ${thickness})\n\t\t\t\t(material "FR4")\n\t\t\t\t(epsilon_r 4.2)\n\t\t\t\t(loss_tangent 0.02)\n\t\t\t)`)
    }
    return items
  }).join('\n')
  return `\t\t(stackup\n\t\t\t(layer "F.SilkS"\n\t\t\t\t(type "Top Silk Screen")\n\t\t\t)\n\t\t\t(layer "F.Paste"\n\t\t\t\t(type "Top Solder Paste")\n\t\t\t)\n\t\t\t(layer "F.Mask"\n\t\t\t\t(type "Top Solder Mask")\n\t\t\t\t(thickness 0.01)\n\t\t\t)\n${copperAndDielectric}\n\t\t\t(layer "B.Mask"\n\t\t\t\t(type "Bottom Solder Mask")\n\t\t\t\t(thickness 0.01)\n\t\t\t)\n\t\t\t(layer "B.Paste"\n\t\t\t\t(type "Bottom Solder Paste")\n\t\t\t)\n\t\t\t(layer "B.SilkS"\n\t\t\t\t(type "Bottom Silk Screen")\n\t\t\t)\n\t\t\t(copper_finish "None")\n\t\t\t(dielectric_constraints no)\n\t\t)`
}

function stripLegacyPcbNetClasses(content) {
  return content.replace(/\n\s*\(net_class\s+"[^"]+"[\s\S]*?\n\s*\)/g, '')
}

function replaceStackupBlock(content, replacement) {
  const start = content.search(/\n\s*\(stackup(?:\s|\))/)
  if (start < 0) return content
  const blockStart = content.indexOf('(stackup', start)
  const end = findClosingParen(content, blockStart)
  if (end < 0) return content
  return `${content.slice(0, blockStart)}${replacement.trimStart()}${content.slice(end + 1)}`
}

function replaceBlockByHead(content, head, replacement) {
  const start = content.search(new RegExp(`\\n\\s*\\(${head}\\s`))
  if (start < 0) return content
  const blockStart = content.indexOf(`(${head}`, start)
  const end = findClosingParen(content, blockStart)
  if (end < 0) return content
  return `${content.slice(0, blockStart)}${replacement.trimStart()}${content.slice(end + 1)}`
}

function findClosingParen(content, start) {
  let depth = 0
  for (let i = start; i < content.length; i += 1) {
    if (content[i] === '(') depth += 1
    else if (content[i] === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function estimateRoutingChannels(scan, counts) {
  const width = scan.boardSize?.widthMm || 0
  const height = scan.boardSize?.heightMm || 0
  return {
    horizontalMm: round(width * Math.max(1, (scan.layerCount || 2) - 1)),
    verticalMm: round(height * Math.max(1, (scan.layerCount || 2) - 1)),
    highCurrentCorridorsNeeded: countClasses(counts, ['BATTERY', 'MOTOR_PHASE', 'SWITCHING_NODE']),
    quietCorridorsNeeded: countClasses(counts, ['CURRENT_SENSE', 'KELVIN_SENSE', 'MCU_CONTROL']),
  }
}

function classCounts(nets) {
  return nets.reduce((acc, net) => {
    acc[net.className] = (acc[net.className] || 0) + 1
    return acc
  }, {})
}

function countClasses(counts, names) {
  return names.reduce((sum, name) => sum + Number(counts[name] || 0), 0)
}

function unique(items) {
  return [...new Set(items)]
}

function uniqueBy(items, keyFn) {
  const seen = new Set()
  return items.filter((item) => {
    const key = keyFn(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function projectFiles(projectDir) {
  const base = path.basename(projectDir)
  return {
    projectFile: path.join(projectDir, `${base}.kicad_pro`),
    pcbFile: path.join(projectDir, `${base}.kicad_pcb`),
    schFile: path.join(projectDir, `${base}.kicad_sch`),
  }
}
