#!/usr/bin/env node
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { executeJob } from '../lib/jobs.mjs'
import { clusterDrcIssues, clusterDrcPowerIssues } from '../lib/power-route-repair.mjs'

const fixtures = {
  robotics: { projectPath: 'targeted-robotics', preset: 'robotics_controller', templateId: 'ROBOTICS_CONTROLLER' },
  industrial: { projectPath: 'targeted-industrial', preset: 'industrial_io', templateId: 'INDUSTRIAL_IO' },
  poe: { projectPath: 'targeted-poe', preset: 'poe_ethernet_sensor', templateId: 'ESP32_S3_POE_SENSOR' },
}

const workspace = path.resolve(argValue('--workspace') || './tmp/targeted-repair')
const fixtureArg = argValue('--fixture') || 'all'
const selected = fixtureArg === 'all' ? Object.keys(fixtures) : fixtureArg.split(',').map((item) => item.trim()).filter(Boolean)
const outputDir = path.join(workspace, 'reports')
const jsonFile = path.join(outputDir, 'boardforge-targeted-repair-report.json')
const mdFile = path.join(outputDir, 'BoardForge Targeted Repair Report.md')
const runStartedAt = Date.now()
const totalBudgetMs = Number(argValue('--total-budget-ms') || process.env.BOARDFORGE_TARGETED_REPAIR_TOTAL_BUDGET_MS || 0)
await mkdir(outputDir, { recursive: true })

const results = []
for (const name of selected) {
  if (totalBudgetHit()) {
    results.push(timeoutSkippedFixture(name))
    await writeReports(results)
    continue
  }
  const startedAt = Date.now()
  const timings = {}
  const budgets = runtimeBudgets(name)
  const fixture = fixtures[name]
  if (!fixture) throw new Error(`Unknown fixture: ${name}`)
  const projectDir = path.join(workspace, fixture.projectPath)
  const hasExistingFixture = await fixtureHasReports(projectDir)
  const generateStart = Date.now()
  if ((argFlag('--fresh') || !hasExistingFixture) && !totalBudgetHit()) {
    await generateFreshFixture(name, fixture, workspace)
  }
  timings.generateMs = Date.now() - generateStart
  if (totalBudgetHit()) {
    results.push(timeoutSkippedFixture(name, { projectDir, timings, phase: 'after_fixture_generation' }))
    await writeReports(results)
    continue
  }
  const schematicStart = Date.now()
  const schematicValidation = await validateFixtureSchematic(projectDir, fixture)
  timings.schematicValidationMs = Date.now() - schematicStart
  const erc = schematicValidation.erc
  const beforeInfo = await readLatestDrcInfo(projectDir)
  const beforeReport = beforeInfo.report
  const before = countDrc(beforeReport)
  const allClustersBefore = clusterDrcIssues(beforeReport)
  const powerClustersBefore = clusterDrcPowerIssues(beforeReport)
  const diagnosis = {
    fixture: name,
    projectDir,
    currentDrcErrorCount: before.errors,
    currentErcErrorCount: erc.errors,
    exportStatus: await packageStatus(projectDir),
    topDrcCategories: allClustersBefore.slice(0, 12),
    rootCause: allClustersBefore[0]?.rootCause || 'No DRC error clusters found.',
    canBeAutoFixedSafely: allClustersBefore.some((cluster) => /endpoint-aware|ground zone|power/i.test(cluster.repairStrategy)),
    requiresPlacementChange: allClustersBefore.some((cluster) => /placement|courtyard|overlap/i.test(cluster.repairStrategy)),
    requiresBoardSizeOrLayerChange: allClustersBefore.some((cluster) => /outline|edge|more layers|board/i.test(`${cluster.rootCause} ${cluster.repairStrategy}`)),
    requiresSchematicOrCategoryImprovement: erc.errors > 0 || !schematicValidation.loadable,
    recommendedFixPlan: categoryPlaybook(name, allClustersBefore, erc),
  }
  await writeFixtureDiagnosis(name, diagnosis)
  const elapsedAfterDiagnosis = Date.now() - startedAt
  const defaults = fixtureDefaults(name)
  const clusterLimit = Number(argValue('--cluster-limit') ?? defaults.clusterLimit)
  const targetNets = clusterLimit > 0
    ? [...new Set(powerClustersBefore.slice(0, clusterLimit).map((cluster) => cluster.net))]
    : []
  let repair = { status: 'REPAIR_SKIPPED_BUDGET_REACHED' }
  let budgetHit = elapsedAfterDiagnosis >= budgets.fixtureBudgetMs
  if (totalBudgetHit()) {
    repair = { status: 'REPAIR_SKIPPED_TOTAL_BUDGET_REACHED' }
  } else if (!schematicValidation.loadable || erc.errors > 0) {
    repair = { status: 'REPAIR_BLOCKED_BY_SCHEMATIC_OR_ERC' }
  } else if (!budgetHit) {
    const repairStart = Date.now()
    repair = await executeJob({
      id: `targeted_${name}_repair`,
      type: 'apply_endpoint_reroutes',
      input: {
      projectPath: fixture.projectPath,
      reportFile: path.relative(projectDir, beforeInfo.file).replaceAll(path.sep, '/'),
        ignoreExistingTracks: true,
        gridMm: 0.5,
        routeGroundNets: true,
        allowPowerPrecheckFallback: true,
        targetNets,
        affectedNets: targetNets,
        maxEndpointPlanNets: Number(argValue('--plan-net-budget') || defaults.planNetBudget || targetNets.length || 3),
        maxMultiTerminalLegs: Number(argValue('--leg-budget') || defaults.legBudget || 8),
        maxAstarIterations: Number(argValue('--astar-budget') || defaults.astarBudget || 6000),
        maxEndpointCandidateEvaluations: Number(argValue('--candidate-budget') || defaults.candidateBudget || 8),
        runDrc: true,
        previousErrorCount: before.errors,
        previousWarningCount: before.warnings,
      },
    }, workspace)
    timings.repairMs = Date.now() - repairStart
    budgetHit = Date.now() - startedAt >= budgets.fixtureBudgetMs
  }
  const incremental = repair.incremental || repair.endpointApply?.incremental || null
  let afterReport = await readDrcFromResult(projectDir, incremental?.finalDrc) || await readLatestDrc(projectDir)
  let afterCounts = countDrc(afterReport)
  let cleanup = { status: 'COLOCATED_VIA_CLEANUP_NOT_NEEDED', removedVias: 0 }
  if (schematicValidation.loadable && erc.errors === 0 && !budgetHit && !totalBudgetHit()) {
    const cleanupStart = Date.now()
    cleanup = await repairCoLocatedGeneratedVias(projectDir, fixture, afterReport, afterCounts)
    timings.cleanupMs = Date.now() - cleanupStart
    if (cleanup.kept) {
      afterReport = cleanup.report
      afterCounts = cleanup.after
    }
  }
  let pairRepair = { status: 'UNCONNECTED_PAIR_REPAIR_NOT_ATTEMPTED' }
  if (schematicValidation.loadable && erc.errors === 0 && !budgetHit && !totalBudgetHit() && afterCounts.errors > 0) {
    const pairRepairStart = Date.now()
    pairRepair = await repairUnconnectedPairs(projectDir, fixture, afterReport, afterCounts, {
      maxCandidates: Number(argValue('--pair-candidate-budget') || defaults.pairCandidateBudget || 24),
    })
    timings.pairRepairMs = Date.now() - pairRepairStart
    if (pairRepair.keptCandidates?.length) {
      afterReport = pairRepair.report
      afterCounts = pairRepair.after
    }
  }
  const exportStart = Date.now()
  const manufacturing = totalBudgetHit()
    ? { status: 'MANUFACTURING_EXPORTS_SKIPPED_TOTAL_BUDGET_REACHED' }
    : await runManufacturingExports(name, fixture, projectDir, { erc, drc: afterCounts })
  timings.exportMs = Date.now() - exportStart
  const result = {
    fixture: name,
    projectDir,
    budgets,
    timings: { ...timings, totalMs: Date.now() - startedAt },
    budgetHit,
    totalBudgetHit: totalBudgetHit(),
    schematicValidation,
    diagnosis,
    before,
    after: afterCounts,
    improvement: before.errors - afterCounts.errors,
    repairStatus: repair.status,
    cleanup,
    pairRepair,
    manufacturing,
    keptRoutes: incremental?.keptRoutes || [],
    rejectedRoutes: incremental?.rejectedRoutes || [],
    finalDrcReportFile: incremental?.finalDrc?.reportFile || null,
    targetNets,
    allClustersBefore,
    allClustersAfter: clusterDrcIssues(afterReport),
    powerClustersBefore,
    powerClustersAfter: clusterDrcPowerIssues(afterReport),
  }
  results.push(result)
  await writeReports(results)
}

await writeReports(results)
console.log(JSON.stringify({ status: 'TARGETED_REPAIR_COMPLETE', reports: { json: jsonFile, markdown: mdFile }, results }, null, 2))

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function argFlag(name) {
  return process.argv.includes(name)
}

function totalBudgetHit() {
  return totalBudgetMs > 0 && Date.now() - runStartedAt >= totalBudgetMs
}

function timeoutSkippedFixture(name, details = {}) {
  return {
    fixture: name,
    status: 'TARGETED_REPAIR_FIXTURE_SKIPPED_TOTAL_BUDGET_REACHED',
    totalBudgetMs,
    elapsedMs: Date.now() - runStartedAt,
    projectDir: details.projectDir || null,
    timings: details.timings || {},
    phase: details.phase || 'before_fixture_start',
    budgetHit: true,
    totalBudgetHit: true,
    before: { errors: null, warnings: null },
    after: { errors: null, warnings: null },
    improvement: 0,
    repairStatus: 'SKIPPED_TOTAL_BUDGET_REACHED',
    cleanup: { status: 'SKIPPED_TOTAL_BUDGET_REACHED' },
    pairRepair: { status: 'SKIPPED_TOTAL_BUDGET_REACHED' },
    manufacturing: { status: 'SKIPPED_TOTAL_BUDGET_REACHED' },
    keptRoutes: [],
    rejectedRoutes: [],
    targetNets: [],
    allClustersBefore: [],
    allClustersAfter: [],
    powerClustersBefore: [],
    powerClustersAfter: [],
  }
}

function fixtureDefaults(name) {
  if (name === 'poe') return { clusterLimit: 4, planNetBudget: 4, legBudget: 6, astarBudget: 3500, candidateBudget: 8, pairCandidateBudget: 24 }
  if (name === 'industrial') return { clusterLimit: 4, planNetBudget: 4, legBudget: 6, astarBudget: 3500, candidateBudget: 8, pairCandidateBudget: 24 }
  if (name === 'robotics') return { clusterLimit: 4, planNetBudget: 4, legBudget: 6, astarBudget: 3500, candidateBudget: 8, pairCandidateBudget: 24 }
  return { clusterLimit: 4, planNetBudget: 4, legBudget: 6, astarBudget: 3500, candidateBudget: 8, pairCandidateBudget: 24 }
}

function runtimeBudgets(name) {
  return {
    fixtureBudgetMs: Number(argValue('--fixture-budget-ms') || 120000),
    drcCallBudgetMs: Number(argValue('--drc-budget-ms') || 30000),
    repairBudgetMs: Number(argValue('--repair-budget-ms') || 60000),
    fixture: name,
  }
}

async function generateFreshFixture(name, fixture, workspace) {
  await rm(path.join(workspace, fixture.projectPath), { recursive: true, force: true })
  await executeJob({
    id: `targeted_${name}_create_project`,
    type: 'create_kicad_project',
    input: {
      projectName: fixture.projectPath,
      projectPath: fixture.projectPath,
      templateId: fixture.templateId,
      preset: fixture.preset,
      manufacturerProfile: 'JLCPCB_STANDARD',
    },
    allowOverwrite: true,
  }, workspace)
  await executeJob({
    id: `targeted_${name}_erc`,
    type: 'run_kicad_erc',
    input: { projectPath: fixture.projectPath },
  }, workspace)
  await executeJob({
    id: `targeted_${name}_drc`,
    type: 'run_kicad_drc',
    input: { projectPath: fixture.projectPath },
  }, workspace)
}

async function readDrc(projectDir) {
  return JSON.parse(await readFile(path.join(projectDir, 'reports', 'drc.json'), 'utf8'))
}

async function fixtureHasReports(projectDir) {
  try {
    await readFile(path.join(projectDir, 'reports', 'drc.json'), 'utf8')
    await readFile(path.join(projectDir, 'reports', 'erc.json'), 'utf8')
    await readFile(path.join(projectDir, `${path.basename(projectDir)}.kicad_sch`), 'utf8')
    return true
  } catch {
    return false
  }
}

async function readLatestDrc(projectDir) {
  return (await readLatestDrcInfo(projectDir)).report
}

async function readLatestDrcInfo(projectDir) {
  const reportsDir = path.join(projectDir, 'reports')
  const files = await readdir(reportsDir)
  const candidates = []
  for (const file of files.filter((name) => name.endsWith('.json') && /drc/i.test(name))) {
    const full = path.join(reportsDir, file)
    const report = await readJsonOrNull(full)
    if (report && !/COMMAND_FAILED/i.test(String(report.status || ''))) {
      candidates.push({ full, mtimeMs: (await stat(full)).mtimeMs, report })
    }
  }
  const latest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (latest) return { file: latest.full, report: latest.report }
  const fallback = path.join(reportsDir, 'drc.json')
  return { file: fallback, report: JSON.parse(await readFile(fallback, 'utf8')) }
}

async function readDrcFromResult(projectDir, finalDrc) {
  if (finalDrc?.report) return finalDrc.report
  if (!finalDrc?.reportFile) return null
  const resolved = path.isAbsolute(finalDrc.reportFile) ? finalDrc.reportFile : path.join(projectDir, finalDrc.reportFile)
  try {
    return JSON.parse(await readFile(resolved, 'utf8'))
  } catch {
    return null
  }
}

function countDrc(report = {}) {
  if (/COMMAND_FAILED|FAILED_TO_LOAD/i.test(`${report.status || ''} ${report.message || ''} ${report.stderr || ''}`)) {
    return { errors: Number.MAX_SAFE_INTEGER, warnings: Number.MAX_SAFE_INTEGER, commandFailed: true }
  }
  const issues = [...(report.violations || []), ...(report.unconnected_items || [])]
  return {
    errors: issues.filter((item) => String(item.severity || '').toLowerCase() === 'error').length,
    warnings: issues.filter((item) => String(item.severity || '').toLowerCase() === 'warning').length,
  }
}

async function repairCoLocatedGeneratedVias(projectDir, fixture, drcReport = {}, beforeCounts = {}) {
  const vias = coLocatedGeneratedViaUuids(drcReport)
  if (!vias.length) return { status: 'COLOCATED_VIA_CLEANUP_NOT_NEEDED', removedVias: 0 }
  const pcbFile = path.join(projectDir, `${fixture.projectPath}.kicad_pcb`)
  const beforeText = await readFile(pcbFile, 'utf8')
  const nextText = removeBlocksByUuid(beforeText, 'via', vias)
  if (nextText === beforeText) return { status: 'COLOCATED_VIA_CLEANUP_NO_MATCHING_VIAS', removedVias: 0, viaUuids: vias }
  await writeFile(pcbFile, nextText, 'utf8')
  const run = await executeJob({
    id: `targeted_${fixture.projectPath}_cleanup_drc`,
    type: 'run_kicad_drc',
    input: { projectPath: fixture.projectPath },
  }, workspace)
  const report = run.report?.report || await readLatestDrc(projectDir)
  const after = countDrc(report)
  const beforeErrors = Number(beforeCounts.errors ?? Number.MAX_SAFE_INTEGER)
  if (!after.commandFailed && after.errors <= beforeErrors) {
    return {
      status: after.errors < beforeErrors ? 'COLOCATED_VIAS_REMOVED_DRC_IMPROVED' : 'COLOCATED_VIAS_REMOVED_DRC_NOT_WORSE',
      kept: true,
      removedVias: vias.length,
      viaUuids: vias,
      before: beforeCounts,
      after,
      report,
    }
  }
  await writeFile(pcbFile, beforeText, 'utf8')
  return {
    status: 'COLOCATED_VIA_CLEANUP_RESTORED_NO_IMPROVEMENT',
    kept: false,
    removedVias: vias.length,
    viaUuids: vias,
    before: beforeCounts,
    after,
    report,
  }
}

async function repairUnconnectedPairs(projectDir, fixture, drcReport = {}, beforeCounts = {}, options = {}) {
  const candidates = unconnectedPairCandidates(drcReport).slice(0, Math.max(0, Number(options.maxCandidates || 24)))
  if (!candidates.length) return { status: 'UNCONNECTED_PAIR_REPAIR_NOT_NEEDED', keptCandidates: [] }
  const pcbFile = path.join(projectDir, `${fixture.projectPath}.kicad_pcb`)
  let currentText = await readFile(pcbFile, 'utf8')
  let currentCounts = beforeCounts
  let currentReport = drcReport
  const keptCandidates = []
  const rejectedCandidates = []
  for (const candidate of candidates) {
    const netToken = netTokenFor(currentText, candidate.net)
    if (!netToken) {
      rejectedCandidates.push({ ...candidateSummary(candidate), reason: 'net_not_found_in_pcb' })
      continue
    }
    const trialText = appendCandidateRoute(currentText, candidate, netToken)
    await writeFile(pcbFile, trialText, 'utf8')
    const run = await executeJob({
      id: `targeted_${fixture.projectPath}_pair_${keptCandidates.length + rejectedCandidates.length}_drc`,
      type: 'run_kicad_drc',
      input: { projectPath: fixture.projectPath },
    }, workspace)
    const report = run.report?.report || await readLatestDrc(projectDir)
    const after = countDrc(report)
    if (routeCandidateImproved(currentCounts, after)) {
      keptCandidates.push({ ...candidateSummary(candidate), before: currentCounts, after })
      currentText = trialText
      currentCounts = after
      currentReport = report
    } else {
      await writeFile(pcbFile, currentText, 'utf8')
      rejectedCandidates.push({ ...candidateSummary(candidate), before: currentCounts, after, reason: 'drc_not_improved' })
    }
    if (currentCounts.errors === 0) break
  }
  return {
    status: keptCandidates.length ? 'UNCONNECTED_PAIR_REPAIR_IMPROVED_DRC' : 'UNCONNECTED_PAIR_REPAIR_NO_IMPROVEMENT',
    kept: Boolean(keptCandidates.length),
    keptCandidates,
    rejectedCandidates,
    before: beforeCounts,
    after: currentCounts,
    report: currentReport,
  }
}

function unconnectedPairCandidates(report = {}) {
  const output = []
  for (const issue of [...(report.unconnected_items || []), ...(report.violations || [])]) {
    if (!/unconnected_items/i.test(String(issue.type || issue.code || ''))) continue
    const items = (issue.items || [])
      .map((item) => ({ ...item, net: netFromDescription(item.description), pos: normalizePos(item.pos) }))
      .filter((item) => item.net && item.pos)
    if (items.length < 2) continue
    const net = items[0].net
    if (!items.every((item) => item.net === net)) continue
    const base = {
      net,
      start: items[0].pos,
      end: items[1].pos,
      descriptions: items.map((item) => item.description),
      widthMm: routeWidthForNet(net),
      layer: 'F.Cu',
    }
    output.push(base)
    if (items.every((item) => /^PTH pad\b/i.test(String(item.description || '')))) {
      output.push({ ...base, layer: 'B.Cu' })
    }
  }
  return output.sort((a, b) => unconnectedPriority(a.net) - unconnectedPriority(b.net))
}

function appendCandidateRoute(content, candidate, netToken) {
  const elbow = routeElbow(candidate.start, candidate.end)
  const points = samePoint(candidate.start, elbow) || samePoint(elbow, candidate.end)
    ? [candidate.start, candidate.end]
    : [candidate.start, elbow, candidate.end]
  const segments = []
  for (let index = 0; index < points.length - 1; index += 1) {
    if (samePoint(points[index], points[index + 1])) continue
    segments.push(segmentText(candidate.net, points[index], points[index + 1], candidate.widthMm, candidate.layer, netToken))
  }
  if (!segments.length) return content
  return content.replace(/\)\s*$/, `${segments.join('\n')}\n)\n`)
}

function segmentText(net, start, end, widthMm, layer, netToken) {
  return `  (segment (start ${roundCoord(start.x)} ${roundCoord(start.y)}) (end ${roundCoord(end.x)} ${roundCoord(end.y)}) (width ${roundCoord(widthMm)}) (layer "${layer}") (net ${netToken}) (uuid "${crypto.randomUUID()}"))`
}

function routeCandidateImproved(before = {}, after = {}) {
  if (after.commandFailed) return false
  if (Number(after.errors) < Number(before.errors)) return true
  return Number(after.errors) === Number(before.errors) && Number(after.warnings) < Number(before.warnings)
}

function candidateSummary(candidate) {
  return {
    net: candidate.net,
    start: candidate.start,
    end: candidate.end,
    layer: candidate.layer,
    widthMm: candidate.widthMm,
    descriptions: candidate.descriptions,
  }
}

function netTokenFor(content, netName) {
  const escaped = escapeRegExp(netName)
  const numeric = content.match(new RegExp(`\\(net\\s+(\\d+)\\s+"${escaped}"\\)`))
  if (numeric) return numeric[1]
  if (new RegExp(`\\(net\\s+"${escaped}"\\)`).test(content)) return `"${String(netName).replace(/"/g, "'")}"`
  return null
}

function netFromDescription(description = '') {
  const match = String(description).match(/\[([^\]]+)\]/)
  return match?.[1] || null
}

function normalizePos(pos) {
  if (!pos || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y))) return null
  return { x: Number(pos.x), y: Number(pos.y) }
}

function routeWidthForNet(net) {
  if (/^(VIN|VBUS|VUSB|VBAT|\+?\d+V\d*|5V|3V3)$/i.test(net)) return 0.5
  if (/^(GND|AGND|DGND)$/i.test(net)) return 0.45
  if (/CAN|RS485|USB|ETH|DP|DN/i.test(net)) return 0.22
  return 0.25
}

function unconnectedPriority(net) {
  if (/^(GND|AGND|DGND)$/i.test(net)) return 0
  if (/^(VIN|VBUS|VUSB|VBAT|\+?\d+V\d*|5V|3V3)$/i.test(net)) return 1
  if (/CAN|RS485|USB|ETH|DP|DN/i.test(net)) return 2
  return 3
}

function routeElbow(start, end) {
  const horizontalFirst = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
  return horizontalFirst ? { x: end.x, y: start.y } : { x: start.x, y: end.y }
}

function samePoint(a, b) {
  return Math.abs(Number(a?.x) - Number(b?.x)) < 0.001 && Math.abs(Number(a?.y) - Number(b?.y)) < 0.001
}

function roundCoord(value) {
  return Math.round(Number(value) * 10000) / 10000
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function coLocatedGeneratedViaUuids(report = {}) {
  const output = []
  for (const issue of [...(report.violations || []), ...(report.unconnected_items || [])]) {
    if (!/holes_co_located/i.test(String(issue.type || issue.code || issue.message || ''))) continue
    const descriptions = (issue.items || []).map((item) => String(item.description || ''))
    const hasPthPad = descriptions.some((text) => /^PTH pad\b/i.test(text))
    if (!hasPthPad) continue
    for (const item of issue.items || []) {
      if (!/^Via \[[^\]]+\] on /i.test(String(item.description || ''))) continue
      if (item.uuid) output.push(item.uuid)
    }
  }
  return [...new Set(output)]
}

function removeBlocksByUuid(content, blockName, uuids = []) {
  let next = content
  for (const uuid of uuids) next = removeBlockByUuid(next, blockName, uuid)
  return next
}

function removeBlockByUuid(content, blockName, uuid) {
  const uuidIndex = content.indexOf(`(uuid "${uuid}")`)
  if (uuidIndex < 0) return content
  const start = content.lastIndexOf(`(${blockName}`, uuidIndex)
  if (start < 0) return content
  const end = findClosingParen(content, start)
  if (end < 0) return content
  const lineStart = content.lastIndexOf('\n', start)
  const removeStart = lineStart >= 0 ? lineStart : start
  return `${content.slice(0, removeStart)}${content.slice(end + 1)}`
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

async function validateFixtureSchematic(projectDir, fixture) {
  const schematicFile = path.join(projectDir, `${fixture.projectPath}.kicad_sch`)
  const ercPath = path.join(projectDir, 'reports', 'erc.json')
  const schematicText = await readTextOrNull(schematicFile)
  const ercReport = await readJsonOrNull(ercPath)
  const erc = countErc(ercReport)
  return {
    status: schematicText && ercReport && erc.errors === 0 ? 'passed' : 'failed',
    loadable: Boolean(ercReport && ercReport.status !== 'ERC_COMMAND_FAILED'),
    schematicFile,
    schematicExists: Boolean(schematicText),
    notTextOnlyManifest: Boolean(schematicText && /\(kicad_sch\b/.test(schematicText)),
    reliesOnFakeDanglingWires: Boolean(schematicText && /wire_dangling|dangling/i.test(schematicText)),
    netlistConsistency: erc.errors === 0 ? 'erc_clean' : 'erc_errors_present',
    pinMapsValid: erc.errors === 0,
    missingSymbols: ercReport?.summary?.missingSymbols || [],
    brokenPins: ercReport?.summary?.brokenPins || [],
    invalidWires: schematicText && /wire_dangling|dangling/i.test(schematicText) ? ['dangling/fake schematic wire marker found'] : [],
    erc,
    ercReportFile: ercPath,
  }
}

async function packageStatus(projectDir) {
  const validation = await readJsonOrNull(path.join(projectDir, 'boardforge-jlcpcb-package-validation.json'))
  return validation?.status || validation?.packageStatus || 'pre_export_no_package_validation_yet'
}

async function runManufacturingExports(name, fixture, projectDir, gates) {
  const blocked = []
  if (gates.erc.errors > 0) blocked.push(`ERC has ${gates.erc.errors} error(s)`)
  if (gates.drc.errors > 0) blocked.push(`DRC has ${gates.drc.errors} error(s)`)
  if (blocked.length) {
    return {
      status: 'EXPORT_BLOCKED_VALIDATION_ERRORS',
      blocked: true,
      blockers: blocked,
      exports: exportSummary(projectDir),
      packageValidation: { status: 'not_validated', blocked: true, issues: blocked },
      reviewReport: null,
    }
  }

  const steps = []
  for (const type of ['export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl']) {
    const startedAt = Date.now()
    const output = await executeJob({
      id: `targeted_${name}_${type}`,
      type,
      input: { projectPath: fixture.projectPath },
    }, workspace)
    steps.push({
      type,
      status: output.status,
      errors: output.errors || [],
      warnings: output.warnings || [],
      generatedFiles: output.generatedFiles || [],
      ms: Date.now() - startedAt,
    })
  }

  const validationStart = Date.now()
  const validation = await executeJob({
    id: `targeted_${name}_validate_jlcpcb_package`,
    type: 'validate_jlcpcb_package',
    input: { projectPath: fixture.projectPath },
  }, workspace)
  steps.push({
    type: 'validate_jlcpcb_package',
    status: validation.status,
    errors: validation.errors || [],
    warnings: validation.warnings || [],
    generatedFiles: validation.generatedFiles || [],
    ms: Date.now() - validationStart,
  })

  const packageStart = Date.now()
  const pkg = await executeJob({
    id: `targeted_${name}_package_jlcpcb`,
    type: 'package_jlcpcb',
    input: { projectPath: fixture.projectPath },
  }, workspace)
  steps.push({
    type: 'package_jlcpcb',
    status: pkg.status,
    errors: pkg.errors || [],
    warnings: pkg.warnings || [],
    generatedFiles: pkg.generatedFiles || [],
    ms: Date.now() - packageStart,
  })

  const manifestStart = Date.now()
  const manifest = await executeJob({
    id: `targeted_${name}_manufacturing_manifest`,
    type: 'generate_manufacturing_manifest',
    input: { projectPath: fixture.projectPath },
  }, workspace)
  steps.push({
    type: 'generate_manufacturing_manifest',
    status: manifest.status,
    errors: manifest.errors || [],
    warnings: manifest.warnings || [],
    generatedFiles: manifest.generatedFiles || [],
    ms: Date.now() - manifestStart,
  })

  const packageValidation = await readJsonOrNull(path.join(projectDir, 'boardforge-jlcpcb-package-validation.json'))
  const manufacturingManifest = await readJsonOrNull(path.join(projectDir, 'boardforge-manufacturing-manifest.json'))
  const exports = exportSummary(projectDir, packageValidation)
  const reviewReport = await writeManufacturingReviewReport(name, fixture, projectDir, gates, exports, packageValidation, steps)
  const blockedByPackage = /BLOCKED|FAILED/.test(`${validation.status} ${pkg.status}`)
  return {
    status: blockedByPackage ? 'CATEGORY_EXPORT_BLOCKED' : 'CATEGORY_EXPORT_COMPLETE_NEEDS_REVIEW',
    blocked: blockedByPackage,
    steps,
    exports,
    packageValidation: {
      status: packageValidation?.status || validation.status || 'not_validated',
      blocked: /BLOCKED|FAILED/.test(packageValidation?.status || validation.status || ''),
      issues: [...(packageValidation?.errors || []), ...(validation.errors || [])],
      warnings: packageValidation?.warnings || validation.warnings || [],
      outputFile: packageValidation?.outputFile || validation.generatedFiles?.[0] || null,
    },
    jlcpcbZip: exports.jlcpcbZip,
    manufacturingManifest: {
      status: manufacturingManifest?.status || manifest.status,
      outputFile: manifest.generatedFiles?.[0] || path.join(projectDir, 'boardforge-manufacturing-manifest.json'),
      engineeringReview: manufacturingManifest?.engineeringReview || null,
    },
    reviewReport,
  }
}

function exportSummary(projectDir, packageValidation = null) {
  return {
    gerbers: artifactGroup(path.join(projectDir, 'fab', 'gerbers')),
    drill: artifactGroup(path.join(projectDir, 'fab', 'drill')),
    bom: artifactFile(path.join(projectDir, 'fab', 'bom.csv')),
    cpl: artifactFile(path.join(projectDir, 'fab', 'cpl.csv')),
    jlcpcbZip: artifactFile(path.join(projectDir, 'fab', `${path.basename(projectDir)}-jlcpcb.zip`)),
    packageValidation: artifactFile(packageValidation?.outputFile || path.join(projectDir, 'boardforge-jlcpcb-package-validation.json')),
  }
}

function artifactFile(file) {
  return { status: fileExists(file) ? 'generated' : 'missing', path: file }
}

function artifactGroup(directory) {
  return { status: 'pending', directory, files: [] }
}

async function hydrateArtifactGroups(summary) {
  for (const key of ['gerbers', 'drill']) {
    const files = await collectExistingFiles(summary[key].directory)
    summary[key].files = files
    summary[key].status = files.length ? 'generated' : 'missing'
  }
  return summary
}

async function collectExistingFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) files.push(...await collectExistingFiles(full))
      else files.push(full)
    }
    return files
  } catch {
    return []
  }
}

function fileExists(file) {
  return Boolean(file && existsSync(file))
}

async function writeManufacturingReviewReport(name, fixture, projectDir, gates, exports, packageValidation, steps) {
  await hydrateArtifactGroups(exports)
  const file = path.join(projectDir, 'BoardForge Category Manufacturing Review.md')
  const lines = [
    `# BoardForge Category Manufacturing Review - ${name}`,
    '',
    `Project: ${projectDir}`,
    `Template: ${fixture.templateId}`,
    `ERC: ${gates.erc.errors} error(s), ${gates.erc.warnings} warning(s)`,
    `DRC: ${gates.drc.errors} error(s), ${gates.drc.warnings} warning(s)`,
    `Package validation: ${packageValidation?.status || 'not_validated'}`,
    '',
    '## Export Artifacts',
    '',
    `- Gerbers: ${exports.gerbers.status} (${exports.gerbers.files.length} file(s))`,
    `- Drill: ${exports.drill.status} (${exports.drill.files.length} file(s))`,
    `- BOM: ${exports.bom.status} (${exports.bom.path})`,
    `- CPL: ${exports.cpl.status} (${exports.cpl.path})`,
    `- JLCPCB ZIP: ${exports.jlcpcbZip.status} (${exports.jlcpcbZip.path})`,
    `- Package validation JSON: ${exports.packageValidation.status} (${exports.packageValidation.path})`,
    '',
    '## Export Steps',
    '',
    ...steps.map((step) => `- ${step.type}: ${step.status} (${step.ms} ms)`),
    '',
    '## Package Issues',
    '',
    ...((packageValidation?.errors || []).length ? packageValidation.errors.map((issue) => `- ERROR ${issue.code || ''}: ${issue.message || JSON.stringify(issue)}`) : ['- no package-blocking errors']),
    '',
    '## Review Warnings',
    '',
    ...((packageValidation?.warnings || []).length ? packageValidation.warnings.map((issue) => `- WARNING ${issue.code || ''}: ${issue.message || JSON.stringify(issue)}`) : ['- none']),
    '',
    'Human review remains required before ordering.',
    '',
  ]
  await writeFile(file, lines.join('\n'), 'utf8')
  return file
}

async function readTextOrNull(file) {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function readJsonOrNull(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function countErc(report = {}) {
  const violations = [
    ...(report?.violations || []),
    ...(report?.errors || []),
    ...(report?.warnings || []),
  ]
  const explicitErrors = Number(report?.errorCount ?? report?.errorsCount ?? report?.summary?.errors)
  const explicitWarnings = Number(report?.warningCount ?? report?.warningsCount ?? report?.summary?.warnings)
  return {
    errors: Number.isFinite(explicitErrors) ? explicitErrors : violations.filter((item) => String(item.severity || '').toLowerCase() === 'error').length,
    warnings: Number.isFinite(explicitWarnings) ? explicitWarnings : violations.filter((item) => String(item.severity || '').toLowerCase() === 'warning').length,
  }
}

function categoryPlaybook(name, clusters, erc) {
  const common = erc.errors > 0 ? ['repair schematic/ERC blockers before routing'] : ['schematic/ERC clean enough for routing repair']
  const top = clusters.slice(0, 4).map((cluster) => `attack ${cluster.net} ${cluster.type}: ${cluster.repairStrategy}`)
  if (name === 'robotics') {
    return [...common, 'GND connectivity', 'VIN / power input', '5V / 3V3 rails', 'CANH/CANL bundle', 'UART/I2C/SPI control nets', ...top]
  }
  if (name === 'industrial') {
    return [...common, 'field-side vs logic-side separation', 'terminal block GND/power', 'protection device routes', 'isolation boundary checks', ...top]
  }
  if (name === 'poe') {
    return [...common, 'RJ45 / PoE input pin map', 'PoE high-voltage region', 'regulator input/output rails', 'Ethernet pair handling', ...top]
  }
  return [...common, ...top]
}

async function writeFixtureDiagnosis(name, diagnosis) {
  const json = path.join(outputDir, `boardforge-blocked-fixture-diagnosis-${name}.json`)
  const md = path.join(outputDir, `BoardForge Blocked Fixture Diagnosis - ${name}.md`)
  await writeFile(json, JSON.stringify(diagnosis, null, 2), 'utf8')
  await writeFile(md, diagnosisMarkdown(diagnosis), 'utf8')
}

function diagnosisMarkdown(diagnosis) {
  return [
    `# BoardForge Blocked Fixture Diagnosis - ${diagnosis.fixture}`,
    '',
    `Project: ${diagnosis.projectDir}`,
    `Current DRC error count: ${diagnosis.currentDrcErrorCount}`,
    `Current ERC error count: ${diagnosis.currentErcErrorCount}`,
    `Export status: ${diagnosis.exportStatus}`,
    `Root cause: ${diagnosis.rootCause}`,
    `Can be auto-fixed safely: ${diagnosis.canBeAutoFixedSafely}`,
    `Requires placement change: ${diagnosis.requiresPlacementChange}`,
    `Requires board size/layer change: ${diagnosis.requiresBoardSizeOrLayerChange}`,
    `Requires schematic/category improvement: ${diagnosis.requiresSchematicOrCategoryImprovement}`,
    '',
    '## Top DRC Clusters',
    '',
    ...(diagnosis.topDrcCategories.length ? diagnosis.topDrcCategories.map((cluster) => `- ${cluster.type} / ${cluster.net} / ${cluster.component} / ${cluster.layer}: ${cluster.count} (${cluster.rootCause}; ${cluster.repairStrategy})`) : ['- none']),
    '',
    '## Recommended Fix Plan',
    '',
    ...diagnosis.recommendedFixPlan.map((item) => `- ${item}`),
    '',
  ].join('\n')
}

async function writeReports(results) {
  await writeFile(jsonFile, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8')
  await writeFile(mdFile, markdown(results), 'utf8')
}

function markdown(results) {
  return [
    '# BoardForge Targeted Repair Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Fixture | Before errors | After errors | Improvement | Repair status |',
    '|---|---:|---:|---:|---|',
    ...results.map((item) => `| ${item.fixture} | ${item.before.errors} | ${item.after.errors} | ${item.improvement} | ${item.repairStatus} |`),
    '',
    '## Schematic Validation',
    '',
    '| Fixture | Loadable | ERC errors | ERC warnings | Schematic file |',
    '|---|---:|---:|---:|---|',
    ...results.map((item) => {
      const validation = item.schematicValidation || {}
      const erc = validation.erc || {}
      return `| ${item.fixture} | ${validation.loadable ? 'yes' : 'no'} | ${erc.errors ?? 'n/a'} | ${erc.warnings ?? 'n/a'} | ${validation.schematicFile || 'not_checked'} |`
    }),
    '',
    '## Timing And Budgets',
    '',
    '| Fixture | Generate ms | Schematic ms | Repair ms | Total ms | Budget hit |',
    '|---|---:|---:|---:|---:|---|',
    ...results.map((item) => `| ${item.fixture} | ${item.timings.generateMs || 0} | ${item.timings.schematicValidationMs || 0} | ${item.timings.repairMs || 0} | ${item.timings.totalMs || 0} | ${item.budgetHit ? 'yes' : 'no'} |`),
    '',
    '## Manufacturing Exports',
    '',
    '| Fixture | Gerbers | Drill | BOM | CPL | JLCPCB ZIP | Package validation | Review report |',
    '|---|---|---|---|---|---|---|---|',
    ...results.map((item) => {
      const m = item.manufacturing || {}
      const e = m.exports || {}
      return `| ${item.fixture} | ${e.gerbers?.status || 'not_validated'} (${e.gerbers?.files?.length || 0}) | ${e.drill?.status || 'not_validated'} (${e.drill?.files?.length || 0}) | ${e.bom?.status || 'not_validated'} | ${e.cpl?.status || 'not_validated'} | ${e.jlcpcbZip?.status || 'not_validated'} | ${m.packageValidation?.status || 'not_validated'} | ${m.reviewReport || 'not_written'} |`
    }),
    '',
    '## Manufacturing Manifest Review',
    '',
    '| Fixture | Manifest | Pin-map equivalence | Rail current | Thermal |',
    '|---|---|---|---|---|',
    ...results.map((item) => {
      const manifest = item.manufacturing?.manufacturingManifest || {}
      const review = manifest.engineeringReview || {}
      return `| ${item.fixture} | ${manifest.status || 'not_validated'} | ${review.pinMapEquivalence?.status || 'not_checked'} | ${review.railCurrentReview?.status || 'not_checked'} | ${review.thermalReview?.status || 'not_checked'} |`
    }),
    '',
    '## Top DRC Clusters',
    '',
    ...results.flatMap((item) => [
      `### ${item.fixture}`,
      '',
      ...(item.allClustersBefore.length ? item.allClustersBefore.slice(0, 8).map((cluster) => `- ${cluster.type} / ${cluster.net} / ${cluster.component} / ${cluster.layer}: ${cluster.count} (${cluster.rootCause}; ${cluster.repairStrategy})`) : ['- none']),
      '',
    ]),
    '',
    '## Power/Error Clusters',
    '',
    ...results.flatMap((item) => [
      `### ${item.fixture}`,
      '',
      `Target nets: ${item.targetNets?.length ? item.targetNets.join(', ') : 'all eligible nets'}`,
      '',
      `Final DRC report: ${item.finalDrcReportFile || 'not reported'}`,
      '',
      'Before:',
      ...(item.powerClustersBefore.length ? item.powerClustersBefore.map((cluster) => `- ${cluster.type} / ${cluster.net}: ${cluster.count}`) : ['- none']),
      '',
      'After:',
      ...(item.powerClustersAfter.length ? item.powerClustersAfter.map((cluster) => `- ${cluster.type} / ${cluster.net}: ${cluster.count}`) : ['- none']),
      '',
    ]),
  ].join('\n')
}
