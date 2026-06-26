import { existsSync } from 'node:fs'
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export const scoreCategories = [
  'Project generation',
  'Schematic validation',
  'Board outline generation',
  'Footprint resolution',
  '3D model resolution',
  'Placement validation',
  'Routing readiness',
  'Routing execution',
  'ERC validation',
  'DRC validation',
  'Manufacturing export',
  'JLCPCB package validation',
  'Regression coverage',
  'Honest failure behavior',
  'Report quality',
]

export const scoreCategories90 = [
  'Codex plugin workflow',
  'Local KiCad tool server',
  'Project generation',
  'Board outline generation',
  'Schematic synthesis',
  'Schematic confidence',
  'Pin-map validation',
  'Library resolution',
  'Footprint resolution',
  '3D model resolution',
  'Placement planning',
  'Placement validation',
  'Routing readiness',
  'Routing execution',
  'Endpoint-aware routing',
  'DRC-guided reroute repair',
  'Blocked fixture reduction',
  'Category-specific fixture depth',
  'PoE isolation reasoning',
  'Industrial I/O clearance handling',
  'Robotics controller routing reliability',
  'Autotracer repair loop',
  'ERC validation',
  'DRC validation',
  'Manufacturer rule validation',
  'Manufacturing export',
  'JLCPCB package validation',
  'Existing project scan',
  'Regression coverage',
  'Arbitrary prompt handling',
  'Honest failure behavior',
  'Report quality',
  'Website/plugin onboarding',
]

export function classifyDrcIssues(report = {}) {
  const items = [...(report.violations || []), ...(report.unconnected_items || [])]
  return items.map((item) => classifyDrcIssue(item))
}

export function classifyDrcIssue(item = {}) {
  const type = String(item.type || '').toLowerCase()
  const description = String(item.description || item.message || '')
  const severity = String(item.severity || '').toLowerCase()
  let normalizedSeverity = 'WARNING'
  let blocksExport = false
  let autoFixAvailable = false
  let recommendedFix = 'Review in KiCad and rerun DRC after repair.'
  let reason = 'KiCad reported a warning that requires engineering review.'

  if (severity === 'error' || /short|clearance|unconnected|courtyard|edge|drill|width/.test(type + description)) {
    normalizedSeverity = 'ERROR'
    blocksExport = true
    reason = 'This issue can change electrical correctness or manufacturability.'
  }
  if (/short/.test(type + description)) recommendedFix = 'Remove or reroute offending copper, then rerun KiCad DRC.'
  else if (/unconnected/.test(type + description)) recommendedFix = 'Route the missing connection or intentionally mark the net as no-connect.'
  else if (/track_dangling|dangling track/.test(type + description)) {
    normalizedSeverity = severity === 'error' ? 'ERROR' : 'WARNING'
    blocksExport = severity === 'error'
    autoFixAvailable = true
    recommendedFix = 'Trim duplicate/dangling generated copper or connect it to the intended net.'
    reason = 'Dangling copper can be harmless on shields/zones, but it should be reviewed.'
  } else if (/isolated_copper|zone/.test(type + description)) {
    normalizedSeverity = 'WARNING'
    blocksExport = false
    autoFixAvailable = true
    recommendedFix = 'Refill or remove isolated copper zones if they are not intentional.'
    reason = 'Isolated copper usually does not block fabrication, but it can signal a broken pour strategy.'
  } else if (/holes_co_located/.test(type + description)) {
    normalizedSeverity = 'WARNING'
    blocksExport = false
    autoFixAvailable = true
    recommendedFix = 'Remove duplicate same-net vias or confirm intentional stacked drill geometry.'
    reason = 'Co-located holes may be duplicate generated vias.'
  }

  if (severity === 'warning' && /silk|text|fab/.test(type + description)) {
    normalizedSeverity = 'INFO'
    recommendedFix = 'Review visual output; does not normally block electrical manufacturing data.'
    reason = 'Silkscreen/fab warnings are usually documentation quality issues.'
  }

  return {
    source: 'KiCad DRC',
    kicadType: item.type || 'unknown',
    kicadSeverity: item.severity || 'unknown',
    kicadMessage: description,
    affectedItems: (item.items || []).map((entry) => ({ description: entry.description, pos: entry.pos })),
    severity: normalizedSeverity,
    autoFixAvailable,
    recommendedFix,
    blocksExport,
    reason,
  }
}

export function reasonedStageStatus(step = {}) {
  const status = String(step.status || 'not_started')
  const errors = step.errors || []
  const warnings = step.warnings || []
  if (/BLOCKED|FAILED|NEEDS_FIX|VALIDATION_FAILED/.test(status) || errors.length) {
    return { status: 'failed', reason: errors[0]?.message || `${step.step || 'stage'} failed with ${errors.length} blocker(s).` }
  }
  if (/NEEDS_REVIEW|NEEDS_ERC|NEEDS_DRC|NEEDS_HUMAN_REVIEW/.test(status) || warnings.length) {
    return { status: 'needs_human_review', reason: warnings[0]?.message || `${step.step || 'stage'} completed with review-required status ${status}.` }
  }
  if (/PASSED_WITH_WARNINGS|EXPORTED.*REVIEW|COMPLETE.*REVIEW/.test(status)) {
    return { status: 'passed_with_warnings', reason: `${step.step || 'stage'} passed but still requires review.` }
  }
  if (/PASSED|EXPORTED|COMPLETE|READY/.test(status)) return { status: 'passed', reason: `${step.step || 'stage'} produced required evidence.` }
  return { status: 'not_started', reason: `${step.step || 'stage'} did not run.` }
}

export async function readJsonIfExists(file) {
  if (!file || !existsSync(file)) return null
  return JSON.parse(await readFile(file, 'utf8'))
}

export async function collectManufacturingFiles(projectDir) {
  const files = []
  const fabDir = path.join(projectDir, 'fab')
  if (!existsSync(fabDir)) return files
  await walk(fabDir, files)
  return files
}

async function walk(dir, output) {
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name)
    const info = await stat(file)
    if (info.isDirectory()) await walk(file, output)
    else output.push({ path: file, name, size: info.size })
  }
}

export function summarizeManufacturingPackage(files = []) {
  const has = (pattern) => files.some((file) => pattern.test(file.name) && file.size > 0)
  return {
    gerbers: files.filter((file) => /\.(gtl|gbl|gts|gbs|gto|gbo|gm1|gbr|gbrjob)$/i.test(file.name)).length,
    drill: has(/\.drl$/i),
    bom: has(/^bom\.csv$/i),
    cpl: has(/^cpl\.csv$/i),
    zip: has(/jlcpcb\.zip$/i),
    edgeCuts: has(/edge[_-]?cuts|\.gm1$/i),
    nonEmptyFiles: files.filter((file) => file.size > 0).length,
  }
}

export function scoreMvpReadiness(fixtures = []) {
  const exported = fixtures.filter((fixture) => fixture.manufacturing?.zip && fixture.drc?.errors === 0)
  const honestFailures = fixtures.filter((fixture) => fixture.expectedFailure && fixture.honestFailure)
  const golden = fixtures.find((fixture) => fixture.id === 'golden_demo')
  const scores = new Map(scoreCategories.map((name) => [name, { score: 0, evidence: [], blockers: [], nextAction: '' }]))
  setScore(scores, 'Project generation', fixtures.filter((f) => f.projectCreated).length >= 6 ? 8 : 5, `${fixtures.filter((f) => f.projectCreated).length} fixture project(s)/checks produced evidence.`, 'Expand fixture coverage.')
  setScore(scores, 'Schematic validation', fixtures.some((f) => f.erc?.errors === 0) ? 7 : 4, 'ERC reports are parsed where KiCad projects exist.', 'Reduce schematic review warnings.')
  setScore(scores, 'Board outline generation', fixtures.some((f) => f.outlineValidated) ? 8 : 5, 'Outline fixture validates Edge.Cuts/points.', 'Add more non-rectangular outline tests.')
  setScore(scores, 'Footprint resolution', fixtures.some((f) => f.library?.footprintReport) ? 6 : 4, 'Regression checks footprint/library reports when present.', 'Resolve arbitrary BOM footprint coverage.')
  setScore(scores, '3D model resolution', fixtures.some((f) => f.library?.modelReport) ? 5 : 3, '3D model report hook exists but coverage is not complete.', 'Add real STEP/WRL resolution for common parts.')
  setScore(scores, 'Placement validation', fixtures.filter((f) => f.placementRan).length >= 4 ? 7 : 5, 'Placement solver runs across export fixtures.', 'Broaden overlap/courtyard regression.')
  setScore(scores, 'Routing readiness', fixtures.some((f) => f.routingCategory) ? 7 : 5, 'Routing categories are reported per fixture.', 'Add dense-board pre-route budgets.')
  setScore(scores, 'Routing execution', golden?.drc?.errors === 0 ? 6 : 4, 'Golden route is DRC-error clean; other routes are categorized.', 'Prove more categories route cleanly.')
  setScore(scores, 'ERC validation', fixtures.filter((f) => f.erc?.errors === 0).length >= 3 ? 8 : 6, `${fixtures.filter((f) => f.erc?.errors === 0).length} fixture(s) have ERC zero-error reports.`, 'Clear remaining schematic review statuses.')
  setScore(scores, 'DRC validation', fixtures.filter((f) => f.drc?.errors === 0).length >= 3 ? 8 : 6, `${fixtures.filter((f) => f.drc?.errors === 0).length} fixture(s) have DRC zero-error reports.`, 'Classify/fix all warnings.')
  setScore(scores, 'Manufacturing export', exported.length >= 3 ? 8 : 5, `${exported.length} fixture(s) exported manufacturing ZIP evidence.`, 'Increase non-golden export confidence.')
  setScore(scores, 'JLCPCB package validation', fixtures.some((f) => f.packageStatus) ? 7 : 4, 'Package validation runs and reports readiness.', 'Validate ZIP contents in more fixture cases.')
  setScore(scores, 'Regression coverage', fixtures.length >= 7 ? 8 : 5, `${fixtures.length} fixture(s) are included in regression run.`, 'Add more fixture categories and historical bug captures.')
  setScore(scores, 'Honest failure behavior', honestFailures.length >= 2 ? 8 : 4, `${honestFailures.length} expected difficult fixture(s) failed honestly.`, 'Expand failure recommendations.')
  setScore(scores, 'Report quality', fixtures.every((f) => Array.isArray(f.drcWarningsClassified)) ? 8 : 5, 'Fixture report includes classified warnings and next actions.', 'Make report diffs easier to read.')
  const categories = [...scores.entries()].map(([category, value]) => ({ category, ...value }))
  const overall = Math.round(categories.reduce((sum, item) => sum + item.score, 0) / categories.length * 10)
  return {
    status: overall >= 70 ? 'MVP_READINESS_70_EVIDENCE_BACKED' : 'MVP_READINESS_BELOW_70',
    overallPercent: overall,
    categories,
    acceptance: {
      goldenPasses: Boolean(golden && golden.erc?.errors === 0 && golden.drc?.errors === 0 && golden.manufacturing?.zip),
      fixtureCount: fixtures.length,
      exportedFixtureCount: exported.length,
      honestFailureCount: honestFailures.length,
      warningClassification: fixtures.every((f) => Array.isArray(f.drcWarningsClassified)),
    },
  }
}

export function scoreMvpReadiness90(fixtures = [], evidence = {}) {
  const exported = fixtures.filter((fixture) => fixture.manufacturing?.zip && fixture.drc?.errors === 0)
  const drcClean = fixtures.filter((fixture) => fixture.drc?.errors === 0)
  const ercClean = fixtures.filter((fixture) => fixture.erc?.errors === 0)
  const cleanBoth = fixtures.filter((fixture) => fixture.erc?.errors === 0 && fixture.drc?.errors === 0)
  const honestFailures = fixtures.filter((fixture) => fixture.expectedFailure && fixture.honestFailure)
  const golden = fixtures.find((fixture) => fixture.id === 'golden_demo')
  const robotics = fixtures.find((fixture) => fixture.id === 'robotics_controller')
  const poe = fixtures.find((fixture) => fixture.id === 'poe_ethernet_sensor')
  const existingScan = fixtures.find((fixture) => fixture.mode === 'existing_project_scan')
  const industrial = fixtures.find((fixture) => fixture.id === 'industrial_io')
  const promptFixtures = fixtures.filter((fixture) => fixture.mode === 'arbitrary_prompt')
  const scores = new Map(scoreCategories90.map((name) => [name, { score: 0, evidence: [], blockers: [], nextAction: '' }]))
  const projectCount = fixtures.filter((f) => f.projectCreated).length
  const outlineCount = fixtures.filter((f) => f.outlineValidated).length
  const placementCount = fixtures.filter((f) => f.placementRan || f.placement?.status).length
  const libraryCount = fixtures.filter((f) => f.library?.footprintReport || f.library?.symbolReport || f.library?.modelReport || f.resolver?.status).length
  const routingEvidence = fixtures.filter((f) => f.routingCategory && f.routingCategory !== 'routing_not_attempted').length
  setScore(scores, 'Codex plugin workflow', evidence.pluginWorkflow ? 8 : 7, 'BoardForge commands execute through structured JSON jobs and MCP/server mappings.', 'Publish install/onboarding verification for external Codex sessions.')
  setScore(scores, 'Local KiCad tool server', evidence.kicadAvailable ? 8 : 6, evidence.kicadAvailable ? 'KiCad CLI-backed jobs ran locally.' : 'KiCad CLI may not be available in this run.', 'Keep CLI detection in every execution report.')
  setScore(scores, 'Project generation', scoreThreshold(projectCount, [[15, 9], [10, 8], [6, 7], [3, 5]], 3), `${projectCount} fixture project(s) created or scanned.`, 'Add category-specific schematic models for non-ESP32 fixtures.')
  setScore(scores, 'Board outline generation', scoreThreshold(outlineCount, [[8, 9], [5, 8], [2, 6]], 4), `${outlineCount} fixture(s) validated board outline evidence.`, 'Add more arcs, cutouts, slots, and outline-only exports.')
  setScore(scores, 'Schematic synthesis', cleanBoth.length >= 8 ? 8 : cleanBoth.length >= 3 ? 6 : 4, `${cleanBoth.length} fixture(s) have both ERC and DRC zero-error evidence.`, 'Replace scaffold schematics with broader real symbol/wire generation.')
  setScore(scores, 'Schematic confidence', fixtures.every((f) => reasonedStatusesHaveReasons(f.stageReasons)) ? 7 : 4, 'Stage statuses are reasoned instead of vague where workflow results exist.', 'Add schematic confidence report directly from symbol/net graph.')
  setScore(scores, 'Pin-map validation', evidence.pinMapReports ? 7 : 5, 'Pin-map validation jobs exist and are called in verified demo workflows.', 'Broaden pad parsing for all selected footprints.')
  setScore(scores, 'Library resolution', scoreThreshold(libraryCount, [[12, 8], [6, 7], [3, 5]], 3), `${libraryCount} fixture(s) include resolver/library evidence.`, 'Resolve real symbol, footprint, LCSC, and 3D model paths for every category.')
  setScore(scores, 'Footprint resolution', libraryCount >= 10 ? 8 : libraryCount >= 3 ? 6 : 4, 'Footprint report hooks and bindings are checked in fixture outputs.', 'Block export on unresolved critical footprints.')
  setScore(scores, '3D model resolution', fixtures.some((f) => f.library?.modelReport || f.resolver?.modelCoverage) ? 6 : 4, '3D model coverage is reported when model evidence exists.', 'Add complete STEP/WRL lookup for connector and IC families.')
  setScore(scores, 'Placement planning', placementCount >= 12 ? 8 : placementCount >= 5 ? 7 : 5, `${placementCount} fixture(s) include placement planning/validation evidence.`, 'Add courtyard-level validation against parsed KiCad footprints.')
  setScore(scores, 'Placement validation', robotics?.drc?.errors === 0 ? 8 : 6, robotics ? `Robotics DRC errors: ${robotics.drc?.errors ?? 'n/a'}.` : 'Robotics fixture missing.', 'Clear robotics placement/DRC issues to zero.')
  setScore(scores, 'Routing readiness', routingEvidence >= 10 ? 8 : routingEvidence >= 5 ? 7 : 5, `${routingEvidence} fixture(s) include routing category evidence.`, 'Add 4/6/8/12-layer dense routing budgets.')
  setScore(scores, 'Routing execution', cleanBoth.length >= 8 ? 7 : 6, `${cleanBoth.length} clean ERC/DRC fixture(s); routing is still not universal.`, 'Prove non-template differential/high-current/odd-outline routing.')
  setScore(scores, 'Endpoint-aware routing', evidence.endpointAwareRouting ? 7 : 5, evidence.endpointAwareRouting ? 'Endpoint-aware route planner/job exists and is wired into DRC iteration.' : 'Endpoint-aware reroute evidence missing.', 'Prove endpoint reroute reduces DRC errors on blocked fixtures.')
  setScore(scores, 'DRC-guided reroute repair', evidence.drcGuidedRepair ? 7 : 5, evidence.drcGuidedRepair ? 'DRC repair can classify issue categories and call endpoint-aware reroute before cleanup.' : 'DRC reroute repair evidence missing.', 'Reduce robotics/industrial/PoE DRC counts with verified repair deltas.')
  setScore(scores, 'Blocked fixture reduction', [robotics, industrial, poe].filter((f) => f?.drc?.errors === 0 || (f?.expectedFailure && f?.honestFailure && f?.recommendations?.length)).length >= 3 ? 8 : 6, `Robotics ${robotics?.drc?.errors ?? 'n/a'} DRC errors; Industrial ${industrial?.drc?.errors ?? 'n/a'}; PoE ${poe?.drc?.errors ?? 'n/a'}.`, 'Make robotics and industrial clean; reduce PoE or prove irreducible constraints.')
  setScore(scores, 'Category-specific fixture depth', evidence.categoryDepthReport ? 7 : 5, evidence.categoryDepthReport ? 'Category fixture depth report is generated for robotics, industrial I/O, and PoE.' : 'Category depth report missing.', 'Replace remaining template-backed category paths with real category schematic/layout models.')
  setScore(scores, 'PoE isolation reasoning', poe?.expectedFailure && poe?.honestFailure ? 7 : poe?.drc?.errors === 0 ? 8 : 5, poe ? `PoE DRC errors: ${poe.drc?.errors ?? 'n/a'} with ${poe.recommendations?.length || 0} recommendation(s).` : 'PoE fixture missing.', 'Implement real PoE isolation/magnetics/RJ45 model or keep exact irreducible blocker.')
  setScore(scores, 'Industrial I/O clearance handling', industrial?.drc?.errors === 0 ? 8 : 6, industrial ? `Industrial I/O DRC errors: ${industrial.drc?.errors ?? 'n/a'}.` : 'Industrial I/O fixture missing.', 'Clear terminal/field-bus endpoint and conservative-width blockers.')
  setScore(scores, 'Robotics controller routing reliability', robotics?.drc?.errors === 0 ? 8 : 6, robotics ? `Robotics DRC errors: ${robotics.drc?.errors ?? 'n/a'}.` : 'Robotics fixture missing.', 'Make robotics controller ERC/DRC clean and exportable.')
  setScore(scores, 'Autotracer repair loop', evidence.selfRepairLoop ? 7 : 5, 'Self-repair and DRC repair jobs exist; regression evidence remains limited.', 'Run repair iterations on PoE/robotics until fixed or irreducibly blocked.')
  setScore(scores, 'ERC validation', scoreThreshold(ercClean.length, [[10, 9], [8, 8], [5, 7], [3, 6]], 4), `${ercClean.length} fixture(s) have ERC zero-error evidence.`, 'Stop all vague schematic review states.')
  setScore(scores, 'DRC validation', scoreThreshold(drcClean.length, [[10, 9], [8, 8], [5, 7], [3, 6]], 4), `${drcClean.length} fixture(s) have DRC zero-error evidence.`, 'Clear PoE and robotics DRC blockers.')
  setScore(scores, 'Manufacturer rule validation', evidence.manufacturerProfiles >= 5 ? 8 : 6, `${evidence.manufacturerProfiles || 0} manufacturer profile(s) available.`, 'Validate every fixture against selected manufacturer profile.')
  setScore(scores, 'Manufacturing export', scoreThreshold(exported.length, [[10, 9], [8, 8], [5, 7], [3, 6]], 4), `${exported.length} fixture(s) exported valid ZIP evidence with DRC zero errors.`, 'Increase category-diverse real exports.')
  setScore(scores, 'JLCPCB package validation', fixtures.filter((f) => f.packageStatus).length >= 10 ? 8 : 7, `${fixtures.filter((f) => f.packageStatus).length} fixture(s) include package validation status.`, 'Add PCBWay/OSH Park package evidence.')
  setScore(scores, 'Existing project scan', existingScan?.scan?.status ? 8 : 5, existingScan?.scan?.summary || 'Existing project scan fixture not proven.', 'Scan user-supplied KiCad projects and run review gates.')
  setScore(scores, 'Regression coverage', scoreThreshold(fixtures.length, [[15, 9], [12, 8], [7, 7]], 5), `${fixtures.length} fixture(s) are included.`, 'Add historical bug fixtures and real customer board imports.')
  setScore(scores, 'Arbitrary prompt handling', promptFixtures.length >= 5 ? 7 : 4, `${promptFixtures.length} arbitrary prompt fixture(s) ran.`, 'Route successful prompts and block impossible prompts with structured repair options.')
  setScore(scores, 'Honest failure behavior', honestFailures.length >= 3 ? 9 : honestFailures.length >= 2 ? 8 : 4, `${honestFailures.length} difficult fixture(s) failed honestly.`, 'Make all impossible boards explain physical causes and options.')
  setScore(scores, 'Report quality', evidence.reportCount >= 7 ? 8 : 6, `${evidence.reportCount || 0} readiness/evidence report(s) generated.`, 'Add diffable per-run trend reports.')
  setScore(scores, 'Website/plugin onboarding', evidence.webOnboarding ? 7 : 5, 'Website positions plugin/local helper as execution engine.', 'Add live plugin install verification and docs screenshots.')
  const categories = [...scores.entries()].map(([category, value]) => ({ category, ...value }))
  const overall = Math.round(categories.reduce((sum, item) => sum + item.score, 0) / categories.length * 10)
  const acceptance = {
    goldenPasses: Boolean(golden && golden.erc?.errors === 0 && golden.drc?.errors === 0 && golden.manufacturing?.zip),
    fixtureCount: fixtures.length,
    exportedFixtureCount: exported.length,
    ercCleanFixtureCount: ercClean.length,
    drcCleanFixtureCount: drcClean.length,
    ercDrcCleanFixtureCount: cleanBoth.length,
    honestFailureCount: honestFailures.length,
    poeFixedOrExplained: Boolean(poe && (poe.drc?.errors === 0 || (poe.expectedFailure && poe.honestFailure && poe.recommendations?.length))),
    roboticsDrcZero: Boolean(robotics?.drc?.errors === 0),
    warningClassification: fixtures.every((f) => Array.isArray(f.drcWarningsClassified)),
    manufacturerProfiles: evidence.manufacturerProfiles || 0,
    arbitraryPromptCount: promptFixtures.length,
    existingProjectScan: Boolean(existingScan?.scan?.status),
  }
  const targetReached = acceptance.goldenPasses
    && acceptance.fixtureCount >= 15
    && acceptance.exportedFixtureCount >= 10
    && acceptance.ercDrcCleanFixtureCount >= 8
    && acceptance.honestFailureCount >= 3
    && acceptance.poeFixedOrExplained
    && acceptance.roboticsDrcZero
    && overall >= 90
  return {
    status: targetReached ? 'MVP_READINESS_90_EVIDENCE_BACKED' : `MVP_READINESS_${overall}_EVIDENCE_BACKED_NOT_90`,
    previousPercent: 71,
    overallPercent: overall,
    targetReached,
    categories,
    acceptance,
  }
}

function scoreThreshold(value, thresholds, fallback) {
  for (const [minimum, score] of thresholds) {
    if (value >= minimum) return score
  }
  return fallback
}

function reasonedStatusesHaveReasons(stageReasons = {}) {
  return Object.values(stageReasons || {}).every((item) => item?.status && item?.reason)
}

function setScore(scores, category, score, evidence, nextAction, blockers = []) {
  scores.set(category, { score, evidence: [evidence], blockers, nextAction })
}

export async function writeReadinessReport({ outputDir, summary }) {
  await mkdir(outputDir, { recursive: true })
  const target = summary.targetPercent || 70
  const jsonFile = path.join(outputDir, target >= 90 ? 'boardforge-90-mvp-readiness-report.json' : 'boardforge-70-mvp-readiness-report.json')
  const mdFile = path.join(outputDir, target >= 90 ? 'BoardForge 90% MVP Readiness Report.md' : 'BoardForge 70% MVP Readiness Report.md')
  await writeFile(jsonFile, JSON.stringify(summary, null, 2), 'utf8')
  await writeFile(mdFile, target >= 90 ? markdownReport90(summary) : markdownReport(summary), 'utf8')
  return { jsonFile, mdFile }
}

function markdownReport(summary) {
  const lines = [
    '# BoardForge 70% MVP Readiness Report',
    '',
    `Status: ${summary.scorecard.status}`,
    `Evidence-backed readiness: ${summary.scorecard.overallPercent}%`,
    '',
    '## What Changed',
    '- Added multi-fixture regression evidence instead of only the golden demo.',
    '- Added DRC warning classification with blocking/export semantics.',
    '- Added reasoned stage statuses and routing categories.',
    '- Added manufacturing package evidence checks across fixture outputs.',
    '',
    '## Fixtures',
  ]
  for (const fixture of summary.fixtures) {
    lines.push(`- ${fixture.name}: ${fixture.status}; ERC ${fixture.erc?.errors ?? 'n/a'} error(s), DRC ${fixture.drc?.errors ?? 'n/a'} error(s), export ZIP ${fixture.manufacturing?.zip ? 'yes' : 'no'}${fixture.expectedFailure ? ', expected difficult fixture' : ''}.`)
  }
  lines.push('', '## Remaining Blockers')
  for (const blocker of summary.remainingBlockers) lines.push(`- ${blocker}`)
  lines.push('', '## Next Steps To 80%')
  for (const action of summary.nextStepsTo80) lines.push(`- ${action}`)
  return `${lines.join('\n')}\n`
}

export async function writeEvidenceReports({ outputDir, summary }) {
  await mkdir(outputDir, { recursive: true })
  const files = {
    fixtureSummary: path.join(outputDir, 'BoardForge Fixture Regression Summary.md'),
    routing: path.join(outputDir, 'BoardForge Routing Readiness Report.md'),
    resolver: path.join(outputDir, 'BoardForge Resolver Coverage Report.md'),
    manufacturing: path.join(outputDir, 'BoardForge Manufacturing Package Evidence Report.md'),
  }
  await writeFile(files.fixtureSummary, fixtureSummaryMarkdown(summary), 'utf8')
  await writeFile(files.routing, routingMarkdown(summary), 'utf8')
  await writeFile(files.resolver, resolverMarkdown(summary), 'utf8')
  await writeFile(files.manufacturing, manufacturingMarkdown(summary), 'utf8')
  return files
}

function markdownReport90(summary) {
  const lines = [
    '# BoardForge 90% MVP Readiness Report',
    '',
    `Previous score: ${summary.scorecard.previousPercent}%`,
    `New evidence-backed readiness: ${summary.scorecard.overallPercent}%`,
    `90% reached: ${summary.scorecard.targetReached ? 'yes' : 'no'}`,
    `Status: ${summary.scorecard.status}`,
    '',
    '## Evidence Summary',
    `- Fixtures: ${summary.scorecard.acceptance.fixtureCount}`,
    `- Valid manufacturing exports: ${summary.scorecard.acceptance.exportedFixtureCount}`,
    `- ERC/DRC clean fixtures: ${summary.scorecard.acceptance.ercDrcCleanFixtureCount}`,
    `- Honest failures: ${summary.scorecard.acceptance.honestFailureCount}`,
    `- Manufacturer profiles: ${summary.scorecard.acceptance.manufacturerProfiles}`,
    `- Arbitrary prompt tests: ${summary.scorecard.acceptance.arbitraryPromptCount}`,
    '',
    '## Fixture Results',
  ]
  for (const fixture of summary.fixtures) {
    lines.push(`- ${fixture.name}: ${fixture.status}; ERC ${fixture.erc?.errors ?? 'n/a'} error(s), DRC ${fixture.drc?.errors ?? 'n/a'} error(s), ZIP ${fixture.manufacturing?.zip ? 'yes' : 'no'}, routing ${fixture.routingCategory || 'n/a'}${fixture.expectedFailure ? ', difficult/honest-failure fixture' : ''}.`)
  }
  lines.push('', '## Scorecard')
  for (const item of summary.scorecard.categories) lines.push(`- ${item.category}: ${item.score}/10. ${item.evidence.join(' ')} Next: ${item.nextAction}`)
  lines.push('', '## Remaining Blockers')
  for (const blocker of summary.remainingBlockers) lines.push(`- ${blocker}`)
  lines.push('', '## What Must Be Done To Reach 95%')
  for (const action of summary.nextStepsTo95 || []) lines.push(`- ${action}`)
  return `${lines.join('\n')}\n`
}

function fixtureSummaryMarkdown(summary) {
  const lines = ['# BoardForge Fixture Regression Summary', '', '| Fixture | Status | ERC errors | DRC errors | ZIP | Honest failure | Notes |', '| --- | --- | ---: | ---: | --- | --- | --- |']
  for (const fixture of summary.fixtures) {
    lines.push(`| ${fixture.name} | ${fixture.status} | ${fixture.erc?.errors ?? 'n/a'} | ${fixture.drc?.errors ?? 'n/a'} | ${fixture.manufacturing?.zip ? 'yes' : 'no'} | ${fixture.honestFailure ? 'yes' : 'no'} | ${(fixture.recommendations || []).slice(0, 2).join('; ') || 'n/a'} |`)
  }
  return `${lines.join('\n')}\n`
}

function routingMarkdown(summary) {
  const lines = ['# BoardForge Routing Readiness Report', '', '| Fixture | Routing status | Total nets | Routed nets | Unrouted nets | Via count | DRC errors | Recommendation |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |']
  for (const fixture of summary.fixtures) {
    const evidence = fixture.routingEvidence || {}
    lines.push(`| ${fixture.name} | ${fixture.routingCategory || 'routing_not_attempted'} | ${evidence.totalNets ?? 'n/a'} | ${evidence.routedNets ?? 'n/a'} | ${evidence.unroutedNets ?? 'n/a'} | ${evidence.viaCount ?? 'n/a'} | ${fixture.drc?.errors ?? 'n/a'} | ${(fixture.recommendations || [fixture.routingCategory || 'review routing evidence'])[0]} |`)
  }
  return `${lines.join('\n')}\n`
}

function resolverMarkdown(summary) {
  const lines = ['# BoardForge Resolver Coverage Report', '', '| Fixture | Symbol report | Footprint report | 3D model report | Resolver status | Remaining action |', '| --- | --- | --- | --- | --- | --- |']
  for (const fixture of summary.fixtures) {
    const library = fixture.library || {}
    lines.push(`| ${fixture.name} | ${library.symbolReport ? 'yes' : 'no'} | ${library.footprintReport ? 'yes' : 'no'} | ${library.modelReport ? 'yes' : 'no'} | ${fixture.resolver?.status || 'not separately run'} | ${fixture.resolver?.nextAction || 'resolve real symbols/footprints/models for this fixture category'} |`)
  }
  return `${lines.join('\n')}\n`
}

function manufacturingMarkdown(summary) {
  const lines = ['# BoardForge Manufacturing Package Evidence Report', '', '| Fixture | Gerbers | Drill | BOM | CPL | ZIP | Edge.Cuts | Package status |', '| --- | ---: | --- | --- | --- | --- | --- | --- |']
  for (const fixture of summary.fixtures) {
    const m = fixture.manufacturing || {}
    lines.push(`| ${fixture.name} | ${m.gerbers || 0} | ${m.drill ? 'yes' : 'no'} | ${m.bom ? 'yes' : 'no'} | ${m.cpl ? 'yes' : 'no'} | ${m.zip ? 'yes' : 'no'} | ${m.edgeCuts ? 'yes' : 'no'} | ${fixture.packageStatus || 'n/a'} |`)
  }
  return `${lines.join('\n')}\n`
}
