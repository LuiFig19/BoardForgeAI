import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createNetClasses, assignNetsToClasses } from './net-classes.mjs'

export function buildKiCadRules(board = {}, nets = [], profile = {}, constraints = {}) {
  const classified = assignNetsToClasses(nets)
  const classes = createNetClasses(profile)
  const diffPairs = constraints.routing?.differentialPairs || inferDiffPairs(classified)
  const rules = [
    header(board, profile),
    ...classes.map((netClass) => clearanceRule(netClass)),
    ...classes.map((netClass) => widthRule(netClass)),
    ...diffPairs.map((pair) => diffPairRule(pair, classes.find((item) => item.name === pair.className))),
    ...antennaRules(constraints),
    ...thermalRules(constraints),
  ]
  return {
    status: 'KICAD_RULES_READY_NEEDS_REVIEW',
    fileName: 'boardforge.kicad_dru',
    rulesText: rules.filter(Boolean).join('\n\n') + '\n',
    netClasses: classes,
    differentialPairs: diffPairs,
    humanReviewRequired: true,
  }
}

export async function writeKiCadRules(projectDir, board, nets, profile, constraints = {}) {
  const output = buildKiCadRules(board, nets, profile, constraints)
  const outputFile = path.join(projectDir, output.fileName)
  await writeFile(outputFile, output.rulesText, 'utf8')
  return { ...output, outputFile }
}

function header(board, profile) {
  return `# BoardForge KiCad custom rules\n# Board: ${safe(board.name || 'BoardForge Board')}\n# Profile: ${safe(profile.name || profile.id || 'manufacturer review')}\n# Review required before manufacturing.`
}

function clearanceRule(netClass) {
  return `(rule "${safe(netClass.name)} minimum clearance"
  (constraint clearance (min ${mm(netClass.clearanceMm)}))
  (condition "A.NetClass == '${safe(netClass.name)}' || B.NetClass == '${safe(netClass.name)}'"))`
}

function widthRule(netClass) {
  return `(rule "${safe(netClass.name)} trace width"
  (constraint track_width (min ${mm(netClass.traceWidthMm)}))
  (condition "A.NetClass == '${safe(netClass.name)}'"))`
}

function diffPairRule(pair, netClass = {}) {
  return `(rule "${safe(pair.positive)} ${safe(pair.negative)} differential pair"
  (constraint diff_pair_gap (min ${mm(netClass.differentialPairGapMm || 0.15)}))
  (constraint diff_pair_width (min ${mm(netClass.differentialPairWidthMm || netClass.traceWidthMm || 0.18)}))
  (condition "A.NetName == '${safe(pair.positive)}' || A.NetName == '${safe(pair.negative)}'"))`
}

function antennaRules(constraints) {
  return (constraints.placement?.rfKeepouts || []).map((item) => `(rule "${safe(item.ref)} antenna keepout review"
  (constraint clearance (min 1.000mm))
  (condition "A.Type == 'Track' && A.Layer == 'F.Cu'")
  # ${safe(item.rule || 'antenna keepout requires copper/component review')})`)
}

function thermalRules(constraints) {
  return (constraints.placement?.thermalSources || []).map((item) => `(rule "${safe(item.ref)} thermal source spacing review"
  (constraint clearance (min 0.500mm))
  (condition "A.Type == 'Footprint'")
  # ${safe(item.rule || 'thermal source requires sensitive-part spacing review')})`)
}

function inferDiffPairs(nets) {
  const names = new Set(nets.map((net) => net.name))
  return nets.flatMap((net) => {
    const mate = net.name?.endsWith('_DP') ? net.name.replace(/_DP$/, '_DN')
      : net.name?.endsWith('_P') ? net.name.replace(/_P$/, '_N')
        : net.name?.endsWith('TX_P') ? net.name.replace(/TX_P$/, 'TX_N')
          : net.name?.endsWith('RX_P') ? net.name.replace(/RX_P$/, 'RX_N')
            : null
    return mate && names.has(mate) ? [{ positive: net.name, negative: mate, className: net.className }] : []
  })
}

function mm(value) {
  return `${Number(value || 0).toFixed(3)}mm`
}

function safe(value) {
  return String(value || '').replace(/["']/g, '')
}
