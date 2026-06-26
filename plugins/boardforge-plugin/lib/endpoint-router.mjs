import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { autorouteBoard } from './autorouter.mjs'
import { applyRoutingPlanToPcb } from './copper-writer.mjs'
import { scanKiCadProject } from './kicad.mjs'
import { assignNetsToClasses } from './net-classes.mjs'
import { validateRoutingGeometry } from './routing-validation.mjs'
import { distancePointToSegment, pointInPolygon, round } from './geometry.mjs'
import { isPowerRepairNet } from './power-route-repair.mjs'

export const drcRepairCategories = [
  'clearance_violation',
  'track_width_violation',
  'via_violation',
  'hole_clearance_violation',
  'edge_clearance_violation',
  'pad_clearance_violation',
  'courtyard_overlap',
  'component_overlap',
  'unconnected_net',
  'short_circuit',
  'zone_violation',
  'silkscreen_violation',
  'copper_to_edge',
  'keepout_violation',
  'manufacturer_rule_violation',
  'unknown',
]

export async function diagnoseBlockedFixtures({ reportFile, outputDir, fixtureIds = ['robotics_controller', 'poe_ethernet_sensor', 'industrial_io'] }) {
  const report = JSON.parse(await readFile(reportFile, 'utf8'))
  await mkdir(outputDir, { recursive: true })
  const fixtures = fixtureIds.map((id) => diagnoseFixture(report.fixtures?.find((fixture) => fixture.id === id))).filter(Boolean)
  const markdown = blockedFixtureDiagnosisMarkdown(fixtures)
  const jsonFile = path.join(outputDir, 'boardforge-blocked-fixture-diagnosis.json')
  const mdFile = path.join(outputDir, 'BoardForge Blocked Fixture Diagnosis.md')
  await writeFile(jsonFile, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), fixtures }, null, 2), 'utf8')
  await writeFile(mdFile, markdown, 'utf8')
  return { fixtures, files: { markdown: mdFile, json: jsonFile } }
}

export function diagnoseFixture(fixture = {}) {
  if (!fixture?.id) return null
  const drcErrors = Number(fixture.drc?.errors || 0)
  const ercErrors = Number(fixture.erc?.errors || 0)
  const categories = categorizeFixtureErrors([...(fixture.errors || []), ...(fixture.drcWarningsClassified || [])])
  const topCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }))
  const rootCause = fixtureRootCause(fixture, topCategories)
  const needsEndpointRepair = topCategories.some((item) => ['unconnected_net', 'track_width_violation', 'clearance_violation', 'short_circuit'].includes(item.category))
  const needsPlacement = topCategories.some((item) => ['component_overlap', 'courtyard_overlap', 'keepout_violation', 'edge_clearance_violation'].includes(item.category))
  const needsCategoryModel = (fixture.errors || []).some((item) => /TOO_FEW_ENDPOINTS|NET_NOT_ASSIGNED|GROUND_NET_MISSING|THERMAL_REVIEW|ASSETS_MISSING/i.test(`${item.code || ''} ${item.message || ''}`))
  return {
    id: fixture.id,
    name: fixture.name,
    currentDrcErrorCount: drcErrors,
    currentErcErrorCount: ercErrors,
    exportStatus: fixture.manufacturing?.zip ? 'zip_exported' : fixture.packageStatus || 'not_exported',
    topDrcCategories: topCategories,
    rootCause,
    canBeAutoFixedSafely: needsEndpointRepair && !needsPlacement && !needsCategoryModel,
    requiresPlacementChange: needsPlacement,
    requiresBoardSizeOrLayerChange: /poe|industrial/i.test(fixture.id) && drcErrors > 0,
    requiresSchematicCategoryFixtureImprovement: needsCategoryModel,
    recommendedFixPlan: recommendedFixtureFixPlan(fixture, { needsEndpointRepair, needsPlacement, needsCategoryModel }),
  }
}

export async function planEndpointAwareReroutes({ projectDir, reportFile = null, profile = {}, board = null, components = [], nets = [], options = {} }) {
  const scan = await scanKiCadProject(projectDir)
  const report = reportFile && existsSync(reportFile) ? JSON.parse(await readFile(reportFile, 'utf8')) : null
  const drcIssues = extractDrcIssues(report)
  const endpointGraph = buildNetEndpointGraph({
    scan,
    nets: nets.length ? nets : scan.nets?.map((net) => ({ name: net.name })).filter((net) => net.name),
    drcIssues,
  })
  const boardModel = board || boardFromScan(scan)
  const issueEndpointNets = options.useDrcItemEndpoints === false ? [] : netsFromDrcItemEndpoints(drcIssues)
  const targetNets = chooseRerouteNets({ drcIssues, endpointGraph, options })
  const routableNets = buildEndpointRerouteNets({ issueEndpointNets, targetNets, endpointGraph })
  const classified = assignNetsToClasses(routableNets)
  const routingPlan = autorouteBoard({
    board: boardModel,
    components,
    nets: classified,
    pads: scan.pads || [],
    existingTracks: options.ignoreExistingTracks ? [] : scan.tracks || [],
    existingVias: options.ignoreExistingTracks ? [] : scan.vias || [],
    profile,
    options: {
      gridMm: options.gridMm || 0.5,
      layerCount: boardModel.layerCount,
      drcRerouteConstraints: constraintsFromIssues(drcIssues),
      routeGroundNets: options.routeGroundNets === true,
      enableUsbPadStitching: false,
      maxRouteNets: options.maxEndpointPlanNets || options.maxRouteNets || 0,
      maxMultiTerminalLegs: options.maxMultiTerminalLegs || 0,
      maxAstarIterations: options.maxAstarIterations || 25000,
    },
  })
  routingPlan.mode = 'endpoint_aware_drc_reroute'
  routingPlan.endpointGraph = summarizeEndpointGraph(endpointGraph)
  routingPlan.drcRepairCategories = categorizeDrcIssues(drcIssues)
  let routeValidation = validateRoutingGeometry({ board: boardModel, components, routingPlan: { ...routingPlan, pads: scan.pads || [] }, profile })
  const unsafeNets = unsafeRouteNets(routeValidation)
    .filter((netName) => !(options.allowPowerPrecheckFallback === true && isPowerRepairNet(netName)))
  if (unsafeNets.length && routingPlan.routes?.length) {
    routingPlan.blockedRoutelets = [
      ...(routingPlan.blockedRoutelets || []),
      ...routingPlan.routes
        .filter((route) => unsafeNets.includes(route.net))
        .map((route) => ({ net: route.net, status: 'blocked_by_endpoint_precheck', reason: 'endpoint_route_failed_precommit_geometry_check', start: route.start, end: route.end })),
    ]
    routingPlan.routes = routingPlan.routes.filter((route) => !unsafeNets.includes(route.net))
    routingPlan.routedNets = routingPlan.routes.filter((route) => route.status === 'routed').map((route) => route.net)
    routingPlan.unroutedNets = [...new Set([...(routingPlan.unroutedNets || []), ...unsafeNets])]
    routeValidation = validateRoutingGeometry({ board: boardModel, components, routingPlan: { ...routingPlan, pads: scan.pads || [] }, profile })
  }
  const blocked = targetNets
    .filter((netName) => !routableNets.some((net) => net.name === netName))
    .map((netName) => endpointRouteBlocker(netName, endpointGraph))
    .concat(unsafeNets.map((netName) => ({
      net: netName,
      reason: 'candidate endpoint route failed precommit geometry validation',
      recommendation: 'Skip this routelet, adjust placement/keepout, or reroute with a larger channel before committing.',
    })))
  const precommitBlockingErrors = options.allowPowerPrecheckFallback === true
    ? routeValidation.errors.filter((item) => !isPowerRepairNet(validationIssueNet(item)))
    : routeValidation.errors
  return {
    status: precommitBlockingErrors.length
      ? 'ENDPOINT_REROUTE_PLAN_BLOCKED_BY_PRECHECK'
      : routingPlan.routes?.some((route) => route.status === 'routed')
        ? 'ENDPOINT_REROUTE_PLAN_READY_NEEDS_DRC'
        : 'ENDPOINT_REROUTE_NO_WRITABLE_ROUTES',
    projectDir,
    reportFile,
    targetNets,
    issueEndpointPairs: issueEndpointNets.map((net) => ({ name: net.name, start: net.start, end: net.end, source: net.source })),
    routedNets: routingPlan.routedNets || [],
    unroutedNets: routingPlan.unroutedNets || [],
    blocked,
    endpointGraph: summarizeEndpointGraph(endpointGraph),
    routingPlan,
    routeValidation,
    safety: {
      unsafeSameNetStitching: false,
      commitRequiresDrcValidation: true,
      sameNetPolicy: 'same-net repair skipped unless endpoint ownership and target pads are explicit',
    },
    humanReviewRequired: true,
  }
}

function buildEndpointRerouteNets({ issueEndpointNets = [], targetNets = [], endpointGraph = {} }) {
  const output = []
  const seen = new Set()
  const targetSet = new Set((targetNets || []).filter(Boolean))
  for (const net of issueEndpointNets) {
    if (targetSet.size && !targetSet.has(net.name)) continue
    const key = net.instanceId || `${net.name}:${net.start?.x}:${net.start?.y}:${net.end?.x}:${net.end?.y}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(net)
  }
  for (const netName of targetNets) {
    const graphNet = endpointGraph.nets?.find((net) => net.name === netName)
    if (!graphNet?.endpoints?.length || graphNet.endpoints.length < 2) continue
    const alreadyHasSpecificRepair = output.some((net) => net.name === netName)
    if (alreadyHasSpecificRepair && graphNet.endpoints.length <= 2) continue
    const key = `${netName}:all-pads`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      name: graphNet.name,
      instanceId: key,
      pins: graphNet.endpoints.map((endpoint) => ({ ref: endpoint.ref, pin: endpoint.pad })),
      source: alreadyHasSpecificRepair ? 'endpoint_graph_completion_route' : 'endpoint_graph_full_net_route',
    })
  }
  return output
}

export async function applyEndpointAwareReroutes({ projectDir, reportFile = null, profile = {}, state = null, options = {}, runDrc = null }) {
  const projectState = state || await loadPersistedProjectState(projectDir)
  const plan = await planEndpointAwareReroutes({
    projectDir,
    reportFile,
    profile,
    board: projectState?.board || null,
    components: projectState?.components || [],
    nets: projectState?.netlist?.nets || projectState?.schematicSynthesis?.nets || projectState?.requirements?.nets || [],
    options,
  })
  const reportDir = path.join(projectDir, 'reports')
  await mkdir(reportDir, { recursive: true })
  const planFile = path.join(reportDir, 'endpoint-reroute-plan.json')
  await writeFile(planFile, JSON.stringify(plan, null, 2), 'utf8')
  if (plan.status !== 'ENDPOINT_REROUTE_PLAN_READY_NEEDS_DRC') {
    return { ...plan, applied: false, generatedFiles: [planFile] }
  }
  const scan = await scanKiCadProject(projectDir)
  const before = await readFile(scan.pcbFile, 'utf8')
  if (runDrc && options.incrementalCommit !== false) {
    const incremental = await applyEndpointRoutesIncrementally({
      scan,
      before,
      plan,
      board: projectState?.board || boardFromScan(scan),
      components: projectState?.components || [],
      runDrc,
      reportDir,
      options,
    })
    return {
      status: incremental.keptRoutes.length ? 'ENDPOINT_REROUTE_INCREMENTAL_APPLIED_NEEDS_DRC_REVIEW' : 'ENDPOINT_REROUTE_RESTORED_NO_IMPROVEMENT',
      applied: Boolean(incremental.keptRoutes.length),
      plan,
      writer: incremental.writer,
      drc: incremental.finalDrc,
      incremental,
      generatedFiles: [planFile, scan.pcbFile, ...incremental.generatedFiles].filter(Boolean),
      humanReviewRequired: true,
    }
  }
  const applied = await applyRoutingPlanToPcb({
    pcbFile: scan.pcbFile,
    board: projectState?.board || boardFromScan(scan),
    routingPlan: plan.routingPlan,
    components: projectState?.components || [],
    pads: scan.pads || [],
  })
  let drc = null
  let kept = true
  if (runDrc) {
    drc = await runDrc({ outputFile: path.join(reportDir, 'endpoint-reroute-drc.json') })
    const afterCounts = drcIssueCounts(drc)
    const previousErrors = Number(options.previousErrorCount ?? Infinity)
    const previousWarnings = Number(options.previousWarningCount ?? Infinity)
    kept = afterCounts.errors < previousErrors
      || (afterCounts.errors === previousErrors && afterCounts.warnings < previousWarnings)
    if (!kept) await writeFile(scan.pcbFile, before, 'utf8')
  }
  return {
    status: kept ? 'ENDPOINT_REROUTE_APPLIED_NEEDS_DRC_REVIEW' : 'ENDPOINT_REROUTE_RESTORED_NO_IMPROVEMENT',
    applied: kept,
    plan,
    writer: applied,
    drc,
    generatedFiles: [planFile, scan.pcbFile, drc?.reportFile].filter(Boolean),
    humanReviewRequired: true,
  }
}

async function loadPersistedProjectState(projectDir) {
  const projectFile = path.join(projectDir, 'boardforge-project.json')
  if (!existsSync(projectFile)) return null
  try {
    const project = JSON.parse(await readFile(projectFile, 'utf8'))
    return {
      board: project.board || project.state?.board || null,
      components: project.components || project.state?.components || [],
      netlist: project.netlist || project.state?.netlist || null,
      schematicSynthesis: project.schematicSynthesis || project.state?.schematicSynthesis || null,
      requirements: project.requirements || project.state?.requirements || null,
    }
  } catch {
    return null
  }
}

async function applyEndpointRoutesIncrementally({ scan, before, plan, board, components, runDrc, reportDir, options = {} }) {
  const keptRoutes = []
  const keptRouteObjects = []
  const rejectedRoutes = []
  const generatedFiles = []
  const writes = []
  let currentCounts = {
    errors: Number(options.previousErrorCount ?? Infinity),
    warnings: Number(options.previousWarningCount ?? Infinity),
  }
  let finalDrc = null
  const maxEvaluations = Number(options.maxEndpointCandidateEvaluations ?? 12)
  let evaluations = 0
  const candidates = buildRouteRepairCandidates(plan.routingPlan.routes || [], { pads: scan.pads || [] })
  const remaining = [...candidates]
  while (remaining.length && evaluations < maxEvaluations) {
    let best = null
    const baseBeforeRound = await readFile(scan.pcbFile, 'utf8')
    for (const candidate of remaining) {
      if (evaluations >= maxEvaluations) break
      evaluations += 1
      const candidatePlan = {
        ...plan.routingPlan,
        designIntent: endpointRepairDesignIntent(plan.routingPlan.designIntent),
        routes: [...keptRouteObjects, ...candidate.routes],
        routedNets: [...new Set([...keptRouteObjects.map((item) => item.net), ...candidate.routes.map((route) => route.net)])],
        unroutedNets: [],
      }
      const writer = await applyRoutingPlanToPcb({
        pcbFile: scan.pcbFile,
        board,
        routingPlan: candidatePlan,
        components,
        pads: scan.pads || [],
      })
      const outputFile = path.join(reportDir, `endpoint-reroute-drc-${candidate.id}.json`)
      const drc = await runDrc({ outputFile })
      generatedFiles.push(outputFile)
      const afterCounts = drcIssueCounts(drc)
      const improvement = routeImprovementScore(currentCounts, afterCounts)
      if (improvement > 0 && (!best || improvement > best.improvement)) {
        best = { ...candidate, writer, outputFile, drc, afterCounts, improvement }
      }
      await writeFile(scan.pcbFile, baseBeforeRound, 'utf8')
    }
    if (!best) {
      for (const candidate of remaining) rejectedRoutes.push({ net: candidate.net, index: candidate.index, before: currentCounts, after: currentCounts, reason: 'routelet_did_not_improve_drc' })
      break
    }
    const commitPlan = {
      ...plan.routingPlan,
      designIntent: endpointRepairDesignIntent(plan.routingPlan.designIntent),
      routes: [...keptRouteObjects, ...best.routes],
      routedNets: [...new Set([...keptRouteObjects.map((item) => item.net), ...best.routes.map((route) => route.net)])],
      unroutedNets: [],
    }
    const writer = await applyRoutingPlanToPcb({
      pcbFile: scan.pcbFile,
      board,
      routingPlan: commitPlan,
      components,
      pads: scan.pads || [],
    })
    keptRoutes.push({ net: best.net, index: best.index, routeCount: best.routes.length, before: currentCounts, after: best.afterCounts })
    keptRouteObjects.push(...best.routes)
    writes.push(writer)
    currentCounts = best.afterCounts
    finalDrc = best.drc
    remaining.splice(remaining.findIndex((item) => item.id === best.id), 1)
  }
  if (remaining.length && evaluations >= maxEvaluations) {
    for (const candidate of remaining) rejectedRoutes.push({ net: candidate.net, index: candidate.index, before: currentCounts, after: currentCounts, reason: 'endpoint_candidate_budget_exhausted' })
  }
  if (!keptRoutes.length) {
    await writeFile(scan.pcbFile, before, 'utf8')
    finalDrc = finalDrc || await runDrc({ outputFile: path.join(reportDir, 'endpoint-reroute-drc-restored.json') })
  }
  return {
    keptRoutes,
    rejectedRoutes,
    finalCounts: currentCounts,
    finalDrc,
    writer: { status: keptRoutes.length ? 'INCREMENTAL_ENDPOINT_ROUTES_WRITTEN' : 'NO_INCREMENTAL_ENDPOINT_ROUTES_KEPT', writes },
    generatedFiles,
  }
}

function buildRouteRepairCandidates(routes = [], context = {}) {
  const routed = routes
    .map((route, index) => ({ route, index: index + 1 }))
    .filter((item) => item.route.status === 'routed')
  const byNet = new Map(routed.map((item) => [item.route.net, item]))
  const byNetAll = new Map()
  for (const item of routed) {
    if (!byNetAll.has(item.route.net)) byNetAll.set(item.route.net, [])
    byNetAll.get(item.route.net).push(item)
  }
  const used = new Set()
  const candidates = []
  for (const [net, items] of byNetAll.entries()) {
    if (!isPowerRepairNet(net) || items.length < 2) continue
    const safeItems = items.filter((item) => !routeHasOtherNetPadClearanceRisk(item.route, context.pads || []))
    if (safeItems.length < 2) continue
    for (const item of safeItems) used.add(item.route.net)
    candidates.push({
      id: `power-${safeCandidateId(net)}`,
      index: Math.min(...safeItems.map((item) => item.index)),
      net,
      routes: safeItems.map((item) => item.route),
      strategy: 'power_distribution_bundle',
      skippedUnsafeRoutelets: items.length - safeItems.length,
    })
  }
  for (const item of routed) {
    if (used.has(item.route.net)) continue
    const mate = differentialRepairMate(item.route.net)
    const mateItem = mate ? byNet.get(mate) : null
    if (mateItem && !used.has(mate)) {
      used.add(item.route.net)
      used.add(mate)
      candidates.push({
        id: `${item.index}-${mateItem.index}`,
        index: item.index,
        net: `${item.route.net}/${mateItem.route.net}`,
        routes: [item.route, mateItem.route],
        strategy: 'differential_pair_bundle',
      })
      continue
    }
    used.add(item.route.net)
    candidates.push({ id: String(item.index), index: item.index, net: item.route.net, routes: [item.route], strategy: 'single_endpoint_routelet' })
  }
  return candidates.sort((a, b) => repairCandidatePriority(a) - repairCandidatePriority(b) || a.index - b.index)
}

function routeHasOtherNetPadClearanceRisk(route = {}, pads = []) {
  if (!isPowerRepairNet(route.net)) return false
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  if (points.length < 2) return true
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    for (const pad of pads || []) {
      if (!pad?.netName || pad.netName === route.net) continue
      if (!Number.isFinite(Number(pad.x)) || !Number.isFinite(Number(pad.y))) continue
      const endpointPadIds = new Set([route.start?.id, route.end?.id].filter(Boolean))
      if (endpointPadIds.has(pad.id)) continue
      const required = Math.max(0.22, Number(pad.widthMm || 0.6) / 2 + Number(route.widthMm || 0.2) / 2 + 0.12)
      if (distancePointToSegment({ x: Number(pad.x), y: Number(pad.y) }, start, end) < required) return true
    }
  }
  return false
}

function repairCandidatePriority(candidate = {}) {
  if (/^GND|GROUND/i.test(candidate.net || '')) return 0
  if (candidate.strategy === 'power_distribution_bundle') return 1
  if (candidate.strategy === 'differential_pair_bundle') return 2
  return 5
}

function safeCandidateId(value = '') {
  return String(value || 'net').replace(/[^A-Za-z0-9_-]+/g, '_')
}

function differentialRepairMate(netName = '') {
  const name = String(netName || '')
  if (name === 'CANH') return 'CANL'
  if (name === 'CANL') return 'CANH'
  if (name === 'RS485_A') return 'RS485_B'
  if (name === 'RS485_B') return 'RS485_A'
  if (/_DP$/.test(name)) return name.replace(/_DP$/, '_DN')
  if (/_DN$/.test(name)) return name.replace(/_DN$/, '_DP')
  if (/_P$/.test(name)) return name.replace(/_P$/, '_N')
  if (/_N$/.test(name)) return name.replace(/_N$/, '_P')
  return null
}

function routeImprovementScore(before = {}, after = {}) {
  const errorDelta = Number(before.errors ?? Infinity) - Number(after.errors ?? Infinity)
  const warningDelta = Number(before.warnings ?? Infinity) - Number(after.warnings ?? Infinity)
  if (errorDelta > 0) return errorDelta * 1000 + Math.max(0, warningDelta)
  if (errorDelta === 0 && warningDelta > 0) return warningDelta
  return 0
}

function endpointRepairDesignIntent(designIntent = {}) {
  return {
    ...designIntent,
    copperPours: [],
    zones: designIntent.zones || [],
    stitchingVias: [],
  }
}

export async function writeEndpointRoutingReport({ outputDir, summary = {}, diagnosis = null }) {
  await mkdir(outputDir, { recursive: true })
  const fixtures = summary.fixtures || []
  const rows = fixtures.filter((fixture) => ['robotics_controller', 'industrial_io', 'poe_ethernet_sensor'].includes(fixture.id))
  const md = [
    '# BoardForge Endpoint Routing Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Endpoint-aware rerouting now has a dedicated planning layer that extracts failing nets from DRC evidence, maps them to KiCad pad endpoints, runs the controlled router against per-layer obstacles, and refuses to commit unless precheck/DRC evidence improves.',
    '',
    '| Fixture | Routing | DRC errors | Endpoint cause | Required action |',
    '|---|---:|---:|---|---|',
    ...rows.map((fixture) => {
      const d = diagnosis?.fixtures?.find((item) => item.id === fixture.id)
      return `| ${fixture.name} | ${fixture.routingCategory || 'unknown'} | ${fixture.drc?.errors ?? 'n/a'} | ${escapeMd(d?.rootCause || 'not diagnosed')} | ${escapeMd((d?.recommendedFixPlan || [])[0] || 'Run endpoint reroute planning.')} |`
    }),
    '',
    'Safety policy: same-net stitching is not used as a broad repair. When endpoint ownership is uncertain, BoardForge reports `same-net repair skipped - endpoint ownership uncertain` and blocks export.',
  ].join('\n')
  const json = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    endpointAwareRouting: true,
    unsafeSameNetStitching: false,
    fixtures: rows.map((fixture) => ({
      id: fixture.id,
      name: fixture.name,
      routingCategory: fixture.routingCategory,
      drc: fixture.drc,
      endpointDiagnosis: diagnosis?.fixtures?.find((item) => item.id === fixture.id) || null,
    })),
  }
  const markdown = path.join(outputDir, 'BoardForge Endpoint Routing Report.md')
  const jsonFile = path.join(outputDir, 'boardforge-endpoint-routing-report.json')
  await writeFile(markdown, md, 'utf8')
  await writeFile(jsonFile, JSON.stringify(json, null, 2), 'utf8')
  return { markdown, json: jsonFile }
}

export async function writeDrcRepairReport({ outputDir, summary = {}, diagnosis = null }) {
  await mkdir(outputDir, { recursive: true })
  const blocked = (summary.fixtures || []).filter((fixture) => fixture.drc?.errors > 0)
  const md = [
    '# BoardForge DRC Repair Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Fixture | DRC errors | Primary categories | Safe auto-fix | Needs placement | Needs category model |',
    '|---|---:|---|---:|---:|---:|',
    ...blocked.map((fixture) => {
      const d = diagnosis?.fixtures?.find((item) => item.id === fixture.id) || diagnoseFixture(fixture)
      return `| ${fixture.name} | ${fixture.drc?.errors ?? 0} | ${escapeMd((d.topDrcCategories || []).slice(0, 3).map((item) => `${item.category}(${item.count})`).join(', '))} | ${d.canBeAutoFixedSafely ? 'yes' : 'no'} | ${d.requiresPlacementChange ? 'yes' : 'no'} | ${d.requiresSchematicCategoryFixtureImprovement ? 'yes' : 'no'} |`
    }),
    '',
    'Repair strategy table:',
    '',
    '- `unconnected_net`: extract source/destination pads and route endpoint-to-endpoint.',
    '- `clearance_violation`: rip up affected generated segment, add local forbidden obstacle, reroute around it.',
    '- `track_width_violation`: widen only when profile and clearance permit; otherwise request more room/layers.',
    '- `short_circuit`: remove BoardForge-generated offender and reroute; ambiguous shorts block release.',
    '- `component_overlap` / `courtyard_overlap`: placement repair comes before routing.',
  ].join('\n')
  const markdown = path.join(outputDir, 'BoardForge DRC Repair Report.md')
  await writeFile(markdown, md, 'utf8')
  return { markdown }
}

export async function writeCategoryFixtureDepthReport({ outputDir, summary = {} }) {
  await mkdir(outputDir, { recursive: true })
  const important = ['robotics_controller', 'industrial_io', 'poe_ethernet_sensor']
  const rows = (summary.fixtures || []).filter((fixture) => important.includes(fixture.id))
  const depth = rows.map((fixture) => ({
    id: fixture.id,
    name: fixture.name,
    hasCategoryTemplate: !fixture.categoryNote,
    categorySpecificNets: categoryNetEvidence(fixture),
    categorySpecificChecks: categoryChecksFor(fixture.id),
    remainingCouponRisk: fixture.categoryNote || null,
  }))
  const md = [
    '# BoardForge Category Fixture Depth Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Fixture | Category nets/checks | Coupon risk | Remaining gap |',
    '|---|---|---|---|',
    ...depth.map((item) => `| ${item.name} | ${escapeMd([...item.categorySpecificNets, ...item.categorySpecificChecks].join(', '))} | ${item.remainingCouponRisk ? 'yes' : 'no'} | ${escapeMd(categoryGap(item.id))} |`),
  ].join('\n')
  const markdown = path.join(outputDir, 'BoardForge Category Fixture Depth Report.md')
  const jsonFile = path.join(outputDir, 'boardforge-category-fixture-depth-report.json')
  await writeFile(markdown, md, 'utf8')
  await writeFile(jsonFile, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), fixtures: depth }, null, 2), 'utf8')
  return { markdown, json: jsonFile }
}

function buildNetEndpointGraph({ scan = {}, nets = [], drcIssues = [] }) {
  const pads = (scan.pads || []).filter((pad) => pad.netName && Number.isFinite(Number(pad.x)) && Number.isFinite(Number(pad.y)))
  const names = new Set([...nets.map((net) => net.name), ...pads.map((pad) => pad.netName), ...drcIssues.flatMap((issue) => issue.nets || [])].filter(Boolean))
  return {
    nets: [...names].map((name) => {
      const endpoints = pads
        .filter((pad) => pad.netName === name)
        .map((pad) => ({ id: pad.id || `${pad.ref}:${pad.pad}`, ref: pad.ref, pad: pad.pad || pad.name, x: round(Number(pad.x)), y: round(Number(pad.y)), layer: padLayer(pad), widthMm: pad.widthMm, heightMm: pad.heightMm }))
      return {
        name,
        endpoints,
        endpointCount: endpoints.length,
        drcIssueCount: drcIssues.filter((issue) => issue.nets?.includes(name)).length,
      }
    }),
  }
}

function chooseRerouteNets({ drcIssues = [], endpointGraph = {}, options = {} }) {
  const explicit = options.affectedNets || options.targetNets || []
  if (Array.isArray(explicit) && explicit.length) return [...new Set(explicit.filter(Boolean))]
  const fromDrc = drcIssues.flatMap((issue) => issue.nets || [])
  const names = [...new Set([...explicit, ...fromDrc].filter(Boolean))]
  if (names.length) return names
  return (endpointGraph.nets || []).filter((net) => net.endpointCount >= 2).map((net) => net.name)
}

function netsFromDrcItemEndpoints(issues = []) {
  const output = []
  for (const issue of issues) {
    if (issue.category !== 'unconnected_net') continue
    const items = (issue.items || [])
      .map((item) => ({
        net: netFromText(item.description),
        layer: layerFromText(item.description) || 'F.Cu',
        isPad: /\bpad\b/i.test(item.description || ''),
        ref: String(item.description || '').match(/\bof\s+([A-Z]{1,4}\d+)\b/i)?.[1] || null,
        pad: String(item.description || '').match(/\bPad\s+([^\s\[]+)/i)?.[1] || null,
        x: Number(item.pos?.x),
        y: Number(item.pos?.y),
        description: item.description || '',
      }))
      .filter((item) => item.net && Number.isFinite(item.x) && Number.isFinite(item.y))
    if (items.length < 2) continue
    for (let index = 1; index < items.length; index += 1) {
      const start = items[index - 1]
      const end = items[index]
      if (start.net !== end.net) continue
      const distanceMm = Math.hypot(start.x - end.x, start.y - end.y)
      if (distanceMm > maxEndpointRepairDistance(start.net, start, end)) continue
      output.push({
        name: start.net,
        instanceId: `${start.net}:drc:${round(start.x)}:${round(start.y)}:${round(end.x)}:${round(end.y)}`,
        start: endpointFromDrcItem(start),
        end: endpointFromDrcItem(end),
        source: 'drc_unconnected_item_pair',
        drcIssueType: issue.type,
        distanceMm: round(distanceMm),
      })
    }
  }
  return dedupeDrcEndpointNets(output)
}

function endpointFromDrcItem(item = {}) {
  return {
    x: round(item.x),
    y: round(item.y),
    layer: item.layer || 'F.Cu',
    ref: item.ref || undefined,
    pad: item.pad || undefined,
    id: item.ref && item.pad ? `${item.ref}:${item.pad}` : undefined,
    sourceDescription: item.description,
  }
}

function maxEndpointRepairDistance(netName = '', start = {}, end = {}) {
  const sameLayer = String(start.layer || '') === String(end.layer || '')
  const net = String(netName || '')
  if (/USB_D[PN]/i.test(net)) return sameLayer ? 22 : 8
  if (/^(GND|AGND|DGND)$/i.test(net)) return sameLayer ? 95 : 42
  if (/^(3V3|5V|VUSB|VBUS|VIN|VCC|VDD|12V|24V)$/i.test(net)) return sameLayer ? 95 : 40
  if (/^(CANH|CANL|RS485_A|RS485_B)$/i.test(net)) return sameLayer ? 70 : 22
  if (/^(CC[12]|EN|RESET|RST|BOOT|SCL|SDA|I2C_|UART|TX|RX)/i.test(net)) return sameLayer ? 45 : 16
  return sameLayer ? 36 : 12
}

function dedupeDrcEndpointNets(nets = []) {
  const seen = new Set()
  return nets.filter((net) => {
    const key = `${net.name}:${net.start.x}:${net.start.y}:${net.end.x}:${net.end.y}`
    const reverse = `${net.name}:${net.end.x}:${net.end.y}:${net.start.x}:${net.start.y}`
    if (seen.has(key) || seen.has(reverse)) return false
    seen.add(key)
    return true
  })
}

function endpointRouteBlocker(netName, endpointGraph) {
  const net = endpointGraph.nets?.find((item) => item.name === netName)
  const endpointCount = Number(net?.endpointCount || 0)
  const reason = endpointCount >= 2
    ? 'endpoint pair exists, but no precommit-safe route was produced'
    : endpointCount > 0
      ? `only ${endpointCount} endpoint(s) mapped`
      : 'no KiCad pad endpoints mapped'
  return {
    net: netName,
    reason,
    recommendation: endpointCount >= 2
      ? 'Adjust placement/clearance, allow a legal layer transition, or rerun with a finer grid before committing. Same-net repair remains endpoint-owned only.'
      : 'Resolve symbol-footprint pin map and rerun endpoint routing. Same-net repair skipped - endpoint ownership uncertain.',
  }
}

function constraintsFromIssues(issues = []) {
  const forbiddenPoints = []
  const affectedNets = new Set()
  for (const issue of issues) {
    for (const item of issue.items || []) {
      if (!item.pos) continue
      for (const net of issue.nets || []) affectedNets.add(net)
      forbiddenPoints.push({
        net: issue.nets?.[0] || null,
        layer: layerFromText(item.description) || 'F.Cu',
        x: round(Number(item.pos.x)),
        y: round(Number(item.pos.y)),
        radiusMm: issue.category === 'short_circuit' ? 1.2 : 0.75,
        sourceType: issue.type,
        reason: issue.description,
      })
    }
  }
  return { status: forbiddenPoints.length ? 'DRC_REROUTE_CONSTRAINTS_READY' : 'DRC_REROUTE_NO_CONSTRAINTS', affectedNets: [...affectedNets], forbiddenPoints }
}

function extractDrcIssues(report = {}) {
  const raw = [...(report?.violations || []), ...(report?.unconnected_items || [])]
  return raw.map((item) => {
    const text = `${item.type || ''} ${item.description || ''} ${(item.items || []).map((entry) => entry.description).join(' ')}`
    const nets = [...new Set((text.match(/\[([^\]]+)\]/g) || []).map((match) => match.slice(1, -1)).filter((net) => net && net !== '<no net>'))]
    return {
      type: item.type || 'unknown',
      severity: item.severity || 'unknown',
      description: item.description || item.message || '',
      category: categorizeDrcText(text),
      nets,
      items: item.items || [],
    }
  })
}

function unsafeRouteNets(routeValidation = {}) {
  const nets = new Set()
  for (const issue of routeValidation.errors || []) {
    const net = validationIssueNet(issue)
    if (net) nets.add(net)
  }
  return [...nets]
}

function validationIssueNet(issue = {}) {
  return issue.details?.net || String(issue.message || '').match(/^([A-Z0-9_+-]+)/)?.[1]
}

function drcIssueCounts(drc = {}) {
  const body = drc.report || drc || {}
  const status = String(drc.status || body.status || '')
  if (/COMMAND_FAILED|FAILED_TO_LOAD|failed to load board/i.test(`${status} ${body.message || ''} ${drc.stderr || ''}`)) {
    return { errors: Number.MAX_SAFE_INTEGER, warnings: Number.MAX_SAFE_INTEGER, commandFailed: true }
  }
  const violations = body.violations || drc.violations || []
  const unconnected = body.unconnected_items || drc.unconnected_items || []
  const issueCounts = drc.issueCounts || body.issueCounts || {}
  return {
    errors: Number(issueCounts.errors ?? [...violations, ...unconnected].filter((item) => String(item.severity || '').toLowerCase() === 'error').length),
    warnings: Number(issueCounts.warnings ?? [...violations, ...unconnected].filter((item) => String(item.severity || '').toLowerCase() === 'warning').length),
  }
}

function netFromText(text = '') {
  const net = String(text).match(/\[([^\]]+)\]/)?.[1] || null
  return net && net !== '<no net>' ? net : null
}

function categorizeFixtureErrors(errors = []) {
  const counts = {}
  for (const error of errors) {
    const category = categorizeDrcText(`${error.code || ''} ${error.message || ''} ${error.kicadType || ''} ${error.kicadMessage || ''}`)
    counts[category] = (counts[category] || 0) + 1
  }
  return counts
}

function categorizeDrcIssues(issues = []) {
  return drcRepairCategories.map((category) => ({
    category,
    count: issues.filter((issue) => issue.category === category).length,
  })).filter((item) => item.count)
}

function categorizeDrcText(input = '') {
  const text = String(input).toLowerCase()
  if (/unconnected|too_few_endpoint|endpoint|not assigned/.test(text)) return 'unconnected_net'
  if (/short/.test(text)) return 'short_circuit'
  if (/track width|trace width|width too small|route_width/.test(text)) return 'track_width_violation'
  if (/via|drill|annular/.test(text)) return 'via_violation'
  if (/hole/.test(text)) return 'hole_clearance_violation'
  if (/edge|outline|copper_to_edge/.test(text)) return 'edge_clearance_violation'
  if (/pad clearance|solder_mask_bridge/.test(text)) return 'pad_clearance_violation'
  if (/courtyard/.test(text)) return 'courtyard_overlap'
  if (/overlap|collision/.test(text)) return 'component_overlap'
  if (/zone|copper pour|isolated copper/.test(text)) return 'zone_violation'
  if (/silk|text|legend/.test(text)) return 'silkscreen_violation'
  if (/keepout|antenna|isolation/.test(text)) return 'keepout_violation'
  if (/manufacturer|profile|thermal|regulator/.test(text)) return 'manufacturer_rule_violation'
  if (/clearance/.test(text)) return 'clearance_violation'
  return 'unknown'
}

function fixtureRootCause(fixture, categories = []) {
  const primary = categories[0]?.category || 'unknown'
  if (fixture.id === 'robotics_controller') return 'CAN/RS485 critical nets lack mapped physical endpoints, so routing cannot legally close those nets yet.'
  if (fixture.id === 'industrial_io') return 'Industrial field-bus nets lack endpoint mappings and conservative prototype rules expose route-width/export blockers.'
  if (fixture.id === 'poe_ethernet_sensor') return 'PoE fixture combines unmapped Ethernet endpoints, placement overlaps/keepout conflicts, ground/reference gaps, and thermal review blockers.'
  return `Dominant blocker category: ${primary}.`
}

function recommendedFixtureFixPlan(fixture, flags) {
  const plan = []
  if (flags.needsCategoryModel) plan.push('Add/repair category-specific pin maps so every critical bus/power net has at least two real footprint pad endpoints.')
  if (flags.needsPlacement) plan.push('Run placement repair before routing: move connectors to legal edges, clear keepouts, and remove courtyard/overlap conflicts.')
  if (flags.needsEndpointRepair) plan.push('Run endpoint-aware reroute for failing nets and verify with KiCad DRC before export.')
  if (fixture.id === 'poe_ethernet_sensor') plan.push('Separate RJ45/PoE/high-voltage and low-voltage regions; keep PoE isolation as human-review if simplified model cannot prove clearance.')
  if (!plan.length) plan.push('Rerun blocked-fixture regression with endpoint repair enabled and review DRC deltas.')
  return plan
}

function blockedFixtureDiagnosisMarkdown(fixtures = []) {
  const lines = ['# BoardForge Blocked Fixture Diagnosis', '', `Generated: ${new Date().toISOString()}`, '']
  for (const item of fixtures) {
    lines.push(`## ${item.name}`)
    lines.push('')
    lines.push(`- Fixture: ${item.id}`)
    lines.push(`- Current DRC error count: ${item.currentDrcErrorCount}`)
    lines.push(`- Current ERC error count: ${item.currentErcErrorCount}`)
    lines.push(`- Export status: ${item.exportStatus}`)
    lines.push(`- Top DRC categories: ${item.topDrcCategories.map((cat) => `${cat.category} (${cat.count})`).join(', ') || 'none'}`)
    lines.push(`- Root cause: ${item.rootCause}`)
    lines.push(`- Can be auto-fixed safely: ${item.canBeAutoFixedSafely ? 'yes' : 'no'}`)
    lines.push(`- Requires placement change: ${item.requiresPlacementChange ? 'yes' : 'no'}`)
    lines.push(`- Requires board size/layer change: ${item.requiresBoardSizeOrLayerChange ? 'yes' : 'no'}`)
    lines.push(`- Requires schematic/category fixture improvement: ${item.requiresSchematicCategoryFixtureImprovement ? 'yes' : 'no'}`)
    lines.push('- Recommended fix plan:')
    for (const step of item.recommendedFixPlan) lines.push(`  - ${step}`)
    lines.push('')
  }
  return lines.join('\n')
}

function boardFromScan(scan = {}) {
  const bounds = scan.boardSize?.bounds
  const outline = scan.boardOutline || []
  return {
    widthMm: scan.boardSize?.widthMm || (bounds ? bounds.maxX - bounds.minX : 80),
    heightMm: scan.boardSize?.heightMm || (bounds ? bounds.maxY - bounds.minY : 50),
    layerCount: scan.layerCount || 2,
    outline,
    mountingHoles: scan.mountingHoles || [],
  }
}

function padLayer(pad = {}) {
  const layers = pad.layers || []
  if (layers.includes('F.Cu')) return 'F.Cu'
  if (layers.includes('B.Cu')) return 'B.Cu'
  return layers.find((layer) => /\.Cu$/i.test(layer)) || 'F.Cu'
}

function layerFromText(text = '') {
  return String(text).match(/\bon\s+((?:F|B|In\d+)\.Cu)\b/i)?.[1] || null
}

function summarizeEndpointGraph(graph = {}) {
  return {
    netCount: graph.nets?.length || 0,
    routableNetCount: graph.nets?.filter((net) => net.endpointCount >= 2).length || 0,
    blockedNetCount: graph.nets?.filter((net) => net.drcIssueCount && net.endpointCount < 2).length || 0,
    nets: (graph.nets || []).map((net) => ({ name: net.name, endpointCount: net.endpointCount, drcIssueCount: net.drcIssueCount })),
  }
}

function categoryNetEvidence(fixture = {}) {
  const text = JSON.stringify([fixture.errors || [], fixture.warnings || []])
  const nets = []
  for (const name of ['CANH', 'CANL', 'RS485_A', 'RS485_B', 'ETH_TX_P', 'ETH_TX_N', 'ETH_RX_P', 'ETH_RX_N', 'POE_VDD', 'FIELD_IO']) {
    if (text.includes(name)) nets.push(name)
  }
  return nets.length ? nets : ['category-specific nets not visible in summary']
}

function categoryChecksFor(id) {
  if (id === 'robotics_controller') return ['power input', 'field connector', 'CAN/RS485 endpoints', 'debug header']
  if (id === 'industrial_io') return ['terminal block clearance', 'field I/O protection', 'conservative width/clearance']
  if (id === 'poe_ethernet_sensor') return ['RJ45 edge placement', 'PoE isolation', 'Ethernet differential pairs', 'thermal review']
  return []
}

function categoryGap(id) {
  if (id === 'poe_ethernet_sensor') return 'Needs real PoE front-end/magnetics endpoint model and isolation-aware placement before DRC-zero claim.'
  if (id === 'industrial_io') return 'Needs terminal/protection endpoint maps and wider routed field-power classes.'
  if (id === 'robotics_controller') return 'Needs CAN/RS485 transceiver/connector pin maps committed into fixture generation.'
  return 'Needs category-specific schematic/layout model.'
}

function escapeMd(value = '') {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
