import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { scorePlacement } from './placement.mjs'
import { generateRoutingPlan } from './routing.mjs'
import { validateRoutingGeometry } from './routing-validation.mjs'
import { boardforgeNetlistFromComponents } from './schematic-generator.mjs'
import { assignNetsToClasses } from './net-classes.mjs'

export async function runDesignAudit({ projectDir = null, board, components = [], nets = [], profile = {}, routingPlan = null, bindings = null }) {
  const classifiedNets = assignNetsToClasses(nets || [])
  const netlist = boardforgeNetlistFromComponents(components, classifiedNets)
  const placement = scorePlacement(board, components, classifiedNets, profile)
  const routePlan = routingPlan || generateRoutingPlan(classifiedNets, { board, layerCount: board.layerCount, components, profile })
  const routing = validateRoutingGeometry({ board, components, routingPlan: routePlan, profile })
  const pcbAudit = projectDir ? await auditPcbNets(projectDir, netlist) : null
  const issues = [
    ...netlistIssues(netlist),
    ...placement.issues,
    ...routing.issues,
    ...(bindings?.warnings || []),
    ...(bindings?.errors || []),
    ...(pcbAudit?.issues || []),
  ]
  const actions = recommendedActions(issues, { placement, routing, pcbAudit })
  return {
    status: issues.some((issue) => issue.severity === 'ERROR') ? 'DESIGN_AUDIT_NEEDS_FIX' : issues.length ? 'DESIGN_AUDIT_NEEDS_REVIEW' : 'DESIGN_AUDIT_READY_NEEDS_ERC_DRC',
    netlist,
    placement,
    routing,
    pcbAudit,
    issueCounts: {
      errors: issues.filter((issue) => issue.severity === 'ERROR').length,
      warnings: issues.filter((issue) => issue.severity === 'WARNING').length,
    },
    issues,
    actions,
    humanReviewRequired: true,
  }
}

async function auditPcbNets(projectDir, netlist) {
  const pcbFile = await findPcbFile(projectDir)
  if (!pcbFile) return { status: 'PCB_AUDIT_SKIPPED', issues: [{ severity: 'WARNING', code: 'PCB_FILE_MISSING', message: 'No PCB file found for pad-net audit.' }] }
  const text = await readFile(pcbFile, 'utf8')
  const declaredNets = new Set([...text.matchAll(/\(net\s+\d+\s+"([^"]*)"\)/g)].map((match) => match[1]).filter(Boolean))
  const expectedNets = new Set(netlist.nets.map((net) => net.name))
  const padAssignments = parsePcbPadAssignments(text)
  const issues = []
  for (const net of expectedNets) {
    if (!declaredNets.has(net)) issues.push({ severity: 'WARNING', code: 'PCB_NET_NOT_DECLARED', message: `${net} is present in BoardForge netlist but not declared in the PCB file.`, net })
  }
  for (const net of declaredNets) {
    if (!expectedNets.has(net) && net !== '') issues.push({ severity: 'WARNING', code: 'PCB_NET_NOT_IN_NETLIST', message: `${net} is declared in PCB but absent from BoardForge netlist.`, net })
  }
  const expectedPins = new Set(netlist.nets.flatMap((net) => net.pins.map((pin) => `${pin.ref}.${pin.pin}:${net.name}`)))
  for (const expected of expectedPins) {
    if (!padAssignments.has(expected)) {
      const [pin, net] = expected.split(':')
      issues.push({ severity: 'WARNING', code: 'PCB_PAD_NET_NOT_ASSIGNED', message: `${pin} is expected on ${net} but PCB pad assignment was not found.`, expected })
    }
  }
  return {
    status: issues.length ? 'PCB_NET_AUDIT_NEEDS_REVIEW' : 'PCB_NET_AUDIT_MATCHES_NETLIST',
    pcbFile,
    declaredNetCount: declaredNets.size,
    padAssignmentCount: padAssignments.size,
    issues,
  }
}

function parsePcbPadAssignments(text) {
  const assignments = new Set()
  const footprintPattern = /\(footprint\s+"[^"]+"/g
  let match = footprintPattern.exec(text)
  while (match) {
    const fpStart = match.index
    const fpEnd = findClosingParen(text, fpStart)
    if (fpEnd < 0) break
    const block = text.slice(fpStart, fpEnd + 1)
    const ref = block.match(/\(property\s+"Reference"\s+"([^"]+)"/)?.[1]
    if (ref) {
      for (const pad of block.matchAll(/\(pad\s+"([^"]+)"[\s\S]*?\(net\s+\d+\s+"([^"]+)"\)[\s\S]*?\n\s*\)/g)) {
        assignments.add(`${ref}.${pad[1]}:${pad[2]}`)
      }
    }
    footprintPattern.lastIndex = fpEnd + 1
    match = footprintPattern.exec(text)
  }
  return assignments
}

function netlistIssues(netlist) {
  const issues = [...netlist.warnings]
  for (const component of netlist.components) {
    if (!component.pinCount) issues.push({ severity: 'WARNING', code: 'COMPONENT_HAS_NO_PIN_MAP', message: `${component.ref} has no mapped pins in the generated netlist.`, component: component.ref })
  }
  return issues
}

function recommendedActions(issues, context) {
  const codes = new Set(issues.map((issue) => issue.code))
  const actions = []
  if (codes.has('COMPONENT_HAS_NO_PIN_MAP') || codes.has('PCB_PAD_NET_NOT_ASSIGNED')) actions.push({ command: 'generate_netlist', reason: 'Refresh BoardForge connectivity before schematic/PCB sync.' })
  if (codes.has('PCB_PAD_NET_NOT_ASSIGNED') || codes.has('PCB_NET_NOT_DECLARED')) actions.push({ command: 'apply_routing_plan', reason: 'Write net declarations and pad assignments after reviewing route prechecks.' })
  if (codes.has('ROUTE_POINT_OFF_BOARD') || codes.has('VIA_OFF_BOARD')) actions.push({ command: 'validate_routing_geometry', reason: 'Fix route geometry before copper writing.' })
  if (codes.has('ROUTE_WIDTH_TOO_SMALL') || codes.has('POWER_ROUTE_WIDTH_REVIEW')) actions.push({ command: 'route_power_nets', reason: 'Regenerate power routes with manufacturer and current constraints.' })
  if (context.placement?.score < 70) actions.push({ command: 'optimize_placement', reason: 'Placement score is low; improve edge connector position, density, or ratsnest length.' })
  if (context.routing?.errors?.length) actions.push({ command: 'run_full_self_review', reason: 'Routing has blockers; rerun review after fixes.' })
  return actions.length ? actions : [{ command: 'run_kicad_erc_then_drc', reason: 'Local design audit passed soft checks; KiCad validation is the next gate.' }]
}

async function findPcbFile(projectDir) {
  const entries = await import('node:fs/promises').then((fs) => fs.readdir(projectDir))
  const pcb = entries.find((entry) => entry.endsWith('.kicad_pcb'))
  const file = pcb ? path.join(projectDir, pcb) : null
  return file && existsSync(file) ? file : null
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
