import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function validateSchematicPcbSync(projectDir, options = {}) {
  const schFile = await firstFile(projectDir, '.kicad_sch')
  const pcbFile = await firstFile(projectDir, '.kicad_pcb')
  const netlistFile = path.join(projectDir, 'boardforge-netlist.json')
  const errors = []
  const warnings = []
  if (!schFile) errors.push(issue('ERROR', 'SCHEMATIC_FILE_MISSING', 'No KiCad schematic file was found.'))
  if (!pcbFile) errors.push(issue('ERROR', 'PCB_FILE_MISSING', 'No KiCad PCB file was found.'))
  const schematic = schFile ? parseSchematic(await readFile(schFile, 'utf8')) : emptySchematic()
  const pcb = pcbFile ? parsePcb(await readFile(pcbFile, 'utf8')) : emptyPcb()
  const boardforge = existsSync(netlistFile) ? JSON.parse(await readFile(netlistFile, 'utf8')) : null
  const expectedNets = new Set((boardforge?.nets || []).map((net) => net.name).filter(Boolean))
  const schematicNets = new Set([...schematic.labels, ...schematic.globalLabels].filter(Boolean))
  const pcbNets = new Set(pcb.nets.filter(Boolean))

  for (const net of expectedNets) {
    if (!schematicNets.has(net)) warnings.push(issue('WARNING', 'NETLIST_NET_MISSING_FROM_SCHEMATIC_LABELS', `${net} exists in BoardForge netlist but was not found as a schematic label.`, { net }))
    if (!pcbNets.has(net)) warnings.push(issue('WARNING', 'NETLIST_NET_MISSING_FROM_PCB', `${net} exists in BoardForge netlist but was not declared in PCB nets.`, { net }))
  }
  for (const net of schematicNets) {
    if (expectedNets.size && !expectedNets.has(net) && !isKiCadPowerSymbol(net)) warnings.push(issue('WARNING', 'SCHEMATIC_NET_NOT_IN_BOARDFORGE_NETLIST', `${net} appears in the schematic but not BoardForge netlist.`, { net }))
  }
  for (const net of pcbNets) {
    if (expectedNets.size && !expectedNets.has(net)) warnings.push(issue('WARNING', 'PCB_NET_NOT_IN_BOARDFORGE_NETLIST', `${net} appears in the PCB but not BoardForge netlist.`, { net }))
  }

  const expectedPadNets = expectedPadAssignments(boardforge)
  for (const assignment of expectedPadNets) {
    if (!pcb.padAssignments.has(`${assignment.ref}.${assignment.pin}:${assignment.net}`)) {
      warnings.push(issue('WARNING', 'PCB_PAD_NET_SYNC_MISSING', `${assignment.ref}.${assignment.pin} should be on ${assignment.net} but PCB pad net was not found.`, assignment))
    }
  }

  const report = {
    status: errors.length ? 'SCHEMATIC_PCB_SYNC_BLOCKED' : warnings.length ? 'SCHEMATIC_PCB_SYNC_NEEDS_REVIEW' : 'SCHEMATIC_PCB_SYNC_READY_NEEDS_ERC_DRC',
    projectDir,
    files: { schematic: schFile, pcb: pcbFile, boardforgeNetlist: existsSync(netlistFile) ? netlistFile : null },
    counts: {
      schematicLabels: schematic.labels.length,
      schematicGlobalLabels: schematic.globalLabels.length,
      pcbNets: pcb.nets.length,
      pcbPadAssignments: pcb.padAssignments.size,
      expectedNets: expectedNets.size,
      expectedPadAssignments: expectedPadNets.length,
    },
    errors,
    warnings,
    actions: recommendedActions(errors, warnings),
    humanReviewRequired: true,
  }
  if (options.write !== false) {
    const outputFile = path.join(projectDir, 'boardforge-schematic-pcb-sync.json')
    await writeFile(outputFile, JSON.stringify(report, null, 2), 'utf8')
    return { ...report, outputFile }
  }
  return report
}

function parseSchematic(text) {
  return {
    labels: [...String(text).matchAll(/\(\s*label\s+"([^"]+)"/g)].map((match) => match[1]),
    globalLabels: [...String(text).matchAll(/\(\s*global_label\s+"([^"]+)"/g)].map((match) => match[1]),
    symbols: [...String(text).matchAll(/\(symbol\s+[\s\S]*?\(property\s+"Reference"\s+"([^"]+)"/g)].map((match) => match[1]),
  }
}

function parsePcb(text) {
  const nets = [...String(text).matchAll(/\(net\s+\d+\s+"([^"]*)"\)/g)].map((match) => match[1])
  const padAssignments = new Set()
  const footprintPattern = /\(footprint\s+"[^"]+"/g
  let match = footprintPattern.exec(text)
  while (match) {
    const fpStart = match.index
    const fpEnd = findClosingParen(text, fpStart)
    if (fpEnd < 0) break
    const block = text.slice(fpStart, fpEnd + 1)
    const ref = block.match(/\(property\s+"Reference"\s+"([^"]+)"/)?.[1]
    if (ref) {
      for (const pad of block.matchAll(/\(pad\s+"([^"]+)"[\s\S]*?\(net\s+\d+\s+"([^"]+)"\)/g)) padAssignments.add(`${ref}.${pad[1]}:${pad[2]}`)
    }
    footprintPattern.lastIndex = fpEnd + 1
    match = footprintPattern.exec(text)
  }
  return { nets, padAssignments }
}

function expectedPadAssignments(netlist) {
  return (netlist?.nets || []).flatMap((net) => (net.pins || []).map((pin) => ({ ref: pin.ref, pin: pin.pin, net: net.name }))).filter((item) => item.ref && item.pin && item.net)
}

function recommendedActions(errors, warnings) {
  const codes = new Set([...errors, ...warnings].map((item) => item.code))
  const actions = []
  if (codes.has('NETLIST_NET_MISSING_FROM_SCHEMATIC_LABELS')) actions.push({ command: 'generate_schematic', reason: 'Refresh schematic labels from BoardForge netlist.' })
  if (codes.has('NETLIST_NET_MISSING_FROM_PCB') || codes.has('PCB_PAD_NET_SYNC_MISSING')) actions.push({ command: 'apply_routing_plan', reason: 'Write PCB nets and footprint pad assignments from reviewed pin maps.' })
  if (!actions.length) actions.push({ command: 'run_kicad_erc_then_drc', reason: 'Schematic/PCB sync gate passed; KiCad validation is next.' })
  return actions
}

async function firstFile(projectDir, extension) {
  try {
    const entries = await readdir(projectDir)
    const found = entries.find((entry) => entry.endsWith(extension))
    return found ? path.join(projectDir, found) : null
  } catch {
    return null
  }
}

function emptySchematic() {
  return { labels: [], globalLabels: [], symbols: [] }
}

function emptyPcb() {
  return { nets: [], padAssignments: new Set() }
}

function isKiCadPowerSymbol(net) {
  return /^#|^(GND|3V3|5V|VCC|VDD|VIN|VBAT|VUSB)$/i.test(net)
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

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
