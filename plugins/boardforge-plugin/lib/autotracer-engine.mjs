import { autorouteBoard } from './autorouter.mjs'
import { materializeRouteObjects } from './copper-writer.mjs'
import { distancePointToSegment, hasSelfIntersections, pointInPolygon, rectCorners, rectsOverlap, round } from './geometry.mjs'
import { assignNetsToClasses, createNetClasses, netClassProfiles } from './net-classes.mjs'
import { scoreRoutingPlan } from './routing-quality.mjs'
import { validateRoutingGeometry } from './routing-validation.mjs'

export const autotracerJobTypes = [
  'autotrace_board',
  'autotrace_critical_nets',
  'autotrace_power',
  'autotrace_signals',
  'autotrace_diff_pairs',
  'autotrace_remaining_nets',
  'repair_routing',
  'reroute_failed_nets',
  'run_routing_drc',
  'calculate_trace_width',
  'validate_trace_width',
  'detect_power_neckdowns',
  'create_power_pour',
  'select_via_type',
  'validate_via_manufacturability',
]

export function runAutotracerPlanning(type, context = {}) {
  if (type === 'calculate_trace_width') return calculateTraceWidthJob(context)
  if (type === 'validate_trace_width') return validateTraceWidthJob(context)
  if (type === 'detect_power_neckdowns') return detectPowerNeckdowns(context)
  if (type === 'create_power_pour') return createPowerPour(context)
  if (type === 'select_via_type') return selectViaTypeJob(context)
  if (type === 'validate_via_manufacturability') return validateViaManufacturability(context)
  return runAutotrace(context, modeForType(type))
}

export function runAutotrace(context = {}, mode = 'full_board') {
  const job = normalizeAutoTraceJob(context, mode)
  const readiness = checkRoutingReadiness(job)
  if (readiness.errors.length) {
    return autoTraceResult('failed', job, null, readiness, {
      remainingIssues: readiness.errors,
      reportMarkdown: blockedReport(readiness),
    })
  }

  const selectedNets = selectNetsForMode(job.nets, mode)
  const routingPlan = {
    ...autorouteBoard({
    board: job.boardOutline,
    components: job.components,
    pads: job.pads,
    existingTracks: job.existingTracks,
    existingVias: job.existingVias,
    nets: selectedNets,
    profile: job.manufacturerProfile,
    options: {
      ...job.routingPreferences,
      routingMode: mode,
      layerCount: job.layerStack.layers.length || job.boardOutline.layerCount,
    },
    }),
    pads: job.pads,
    existingTracks: job.existingTracks,
    existingVias: job.existingVias,
  }
  const routeValidation = validateRoutingGeometry({ board: job.boardOutline, components: job.components, routingPlan, profile: job.manufacturerProfile })
  const routeQuality = scoreRoutingPlan({ routingPlan, profile: job.manufacturerProfile, powerTree: context.powerTree || null })
  const routeObjects = materializeRouteObjects(job.boardOutline, routingPlan)
  const internalViolations = [...(routeValidation.errors || []), ...(routeQuality.errors || []), ...validateFabRules(job, routingPlan), ...validateModeSpecificRouting(job, routingPlan, mode)]
  const warnings = [...readiness.warnings, ...(routingPlan.warnings || []), ...(routeValidation.warnings || []), ...(routeQuality.warnings || [])]
  const routedNets = summarizeRoutes(routingPlan.routes?.filter((route) => route.status === 'routed') || [])
  const unroutedNets = summarizeUnrouted(routingPlan.routes?.filter((route) => route.status !== 'routed') || [], selectedNets)
  const fullyRouted = selectedNets.length > 0 && unroutedNets.length === 0 && internalViolations.length === 0
  const status = fullyRouted ? 'planned' : routedNets.length ? 'partial' : 'failed'
  return autoTraceResult(status, job, routingPlan, { warnings, errors: internalViolations }, {
    routedNets,
    partiallyRoutedNets: [],
    unroutedNets,
    createdTracks: routeObjects.segments,
    createdVias: routeObjects.vias,
    createdZones: routeObjects.zones,
    netClassReport: buildNetClassReport(job),
    layerUsageReport: buildLayerUsageReport(job, routeObjects),
    viaReport: buildViaReport(job, routeObjects),
    powerReport: buildPowerReport(job, routingPlan),
    differentialPairReport: buildDifferentialPairReport(job, routingPlan),
    noiseReport: buildNoiseReport(job, routingPlan),
    manufacturerReport: buildManufacturerReport(job, routingPlan, internalViolations),
    internalViolations,
    componentMoveSuggestions: suggestPlacementMoves(job, internalViolations, unroutedNets),
    remainingIssues: [...internalViolations, ...unroutedNets.map((net) => issue('ERROR', 'NET_UNROUTED', `${net.net} was not routed.`, net))],
    routingScore: buildRoutingScore(job, routedNets, unroutedNets, internalViolations, warnings),
    humanReviewChecklist: checklist(job, fullyRouted),
    reportMarkdown: routingReport(job, routingPlan, routedNets, unroutedNets, internalViolations, warnings, status),
  })
}

export function finalizeAutotraceWithDrc(result, drcResult = null) {
  if (!drcResult) return result
  const drcErrors = Number(drcResult.issueCounts?.errors || 0)
  const drcWarnings = Number(drcResult.issueCounts?.warnings || 0)
  const fullyRouted = result.unroutedNets.length === 0 && result.internalViolations.length === 0 && drcErrors === 0
  return {
    ...result,
    status: fullyRouted ? 'fully_routed' : drcErrors ? 'failed' : result.status,
    drcResult,
    remainingIssues: [
      ...result.remainingIssues,
      ...(drcErrors ? [issue('ERROR', 'KICAD_DRC_ERRORS', `${drcErrors} KiCad DRC error(s) remain after autotrace.`)] : []),
    ],
    routingScore: { ...result.routingScore, score: Math.max(0, result.routingScore.score - drcErrors * 12 - drcWarnings * 2), drcErrors, drcWarnings },
    reportMarkdown: `${result.reportMarkdown}\n\n## KiCad DRC\n\n${drcErrors ? `DRC failed with ${drcErrors} error(s) and ${drcWarnings} warning(s).` : `DRC passed with ${drcWarnings} warning(s).`}\n`,
  }
}

function normalizeAutoTraceJob(context, mode) {
  const scanBoard = context.scan?.boardOutline?.length ? { ...(context.board || {}), outline: context.scan.boardOutline, boardSize: context.scan.boardSize } : null
  const board = scanBoard || context.board || context.boardOutline || {}
  const layerStack = normalizeLayerStack(context.layerStack || context.stackup || {}, board)
  const components = normalizeComponents(context.components?.length ? context.components : context.scan?.footprints?.length ? context.scan.footprints : context.footprints || [])
  const pads = normalizePads(context.pads?.length ? context.pads : context.scan?.pads || [], components)
  const nets = assignNetsToClasses(normalizeNets(context.nets?.length ? context.nets : context.scan?.nets?.length ? netsFromScan(context.scan, pads) : context.netlist?.nets || context.requirements?.nets || [], components, pads))
  return {
    jobId: context.jobId || context.id || `autotrace_${Date.now()}`,
    projectId: context.projectId || context.projectPath || 'local-project',
    boardId: context.boardId || board.id || 'board',
    kicadProjectPath: context.kicadProjectPath || context.projectPath || null,
    boardFilePath: context.boardFilePath || context.pcbFile || null,
    manufacturerProfile: context.manufacturerProfileObject || context.profile || context.manufacturerProfile || {},
    layerStack,
    boardOutline: { ...board, layerCount: layerStack.layers.length || board.layerCount || 2 },
    components,
    footprints: context.footprints || components,
    pads,
    nets,
    netLabels: context.netLabels || [],
    existingTracks: context.existingTracks || context.scan?.tracks || [],
    existingVias: context.existingVias || context.scan?.vias || [],
    existingZones: context.existingZones || context.scan?.zones || [],
    mountingHoles: context.mountingHoles || board.mountingHoles || [],
    keepouts: context.keepouts || context.designIntent?.zones?.filter((zone) => zone.allowTraces === false || zone.allowCopper === false) || [],
    cutouts: context.cutouts || [],
    routingMode: mode,
    routingPreferences: {
      allowBlindVias: Boolean(context.allowBlindVias || context.routingPreferences?.allowBlindVias),
      allowBuriedVias: Boolean(context.allowBuriedVias || context.routingPreferences?.allowBuriedVias),
      allowMicrovias: Boolean(context.allowMicrovias || context.routingPreferences?.allowMicrovias),
      allowViaInPad: Boolean(context.allowViaInPad || context.routingPreferences?.allowViaInPad),
      allowAutoReroute: context.routingPreferences?.allowAutoReroute !== false,
      allowZoneCreation: context.routingPreferences?.allowZoneCreation !== false,
      allowComponentMoveSuggestions: Boolean(context.routingPreferences?.allowComponentMoveSuggestions),
      maxIterations: Number(context.maxIterations || context.routingPreferences?.maxIterations || 4),
      maxRuntimeSeconds: Number(context.maxRuntimeSeconds || context.routingPreferences?.maxRuntimeSeconds || 120),
      prefer45DegreeRoutes: context.routingPreferences?.prefer45DegreeRoutes !== false,
      minimizeVias: context.routingPreferences?.minimizeVias !== false,
      prioritizeDrcPass: context.routingPreferences?.prioritizeDrcPass !== false,
    },
    userConstraints: context.userConstraints || [],
  }
}

function checkRoutingReadiness(job) {
  const errors = []
  const warnings = []
  const outline = job.boardOutline.outline || []
  if (outline.length < 3) errors.push(issue('ERROR', 'BOARD_OUTLINE_MISSING', 'Routing blocked before trace generation. Board outline is missing or incomplete.'))
  if (outline.length >= 3 && hasSelfIntersections(outline)) errors.push(issue('ERROR', 'BOARD_OUTLINE_SELF_INTERSECTS', 'Routing blocked before trace generation. Board outline self-intersects.'))
  if (!job.layerStack.layers.length) errors.push(issue('ERROR', 'LAYER_STACK_MISSING', 'Routing blocked before trace generation. Layer stack is missing.'))
  if (!job.manufacturerProfile?.minTraceWidthMm) errors.push(issue('ERROR', 'MANUFACTURER_PROFILE_MISSING', 'Routing blocked before trace generation. Manufacturer profile is missing.'))
  if (!job.nets.length) errors.push(issue('ERROR', 'NETLIST_MISSING', 'Routing blocked before trace generation. Netlist is missing.'))
  if (!job.components.length) errors.push(issue('ERROR', 'FOOTPRINTS_MISSING', 'Routing blocked before trace generation. Footprints/components are missing.'))
  for (const component of job.components) {
    if (!hasPlacement(component)) errors.push(issue('ERROR', 'COMPONENT_PLACEMENT_MISSING', `${component.ref} has no placement.`))
    else if (outline.length && rectCorners(component).some((corner) => !pointInPolygon(corner, outline))) errors.push(issue('ERROR', 'COMPONENT_OFF_BOARD', `${component.ref} extends outside board outline.`, { ref: component.ref }))
    if (!Object.keys(component.pinMap || {}).length) warnings.push(issue('WARNING', 'CRITICAL_PADS_NOT_MAPPED', `${component.ref} has no pinMap; endpoints may be unavailable.`, { ref: component.ref }))
  }
  for (let a = 0; a < job.components.length; a += 1) {
    for (let b = a + 1; b < job.components.length; b += 1) {
      if (hasPlacement(job.components[a]) && hasPlacement(job.components[b]) && rectsOverlap(job.components[a], job.components[b], job.manufacturerProfile.componentToComponentClearanceMm || 0.25)) errors.push(issue('ERROR', 'COMPONENTS_OVERLAP', `${job.components[a].ref} overlaps ${job.components[b].ref}.`, { refs: [job.components[a].ref, job.components[b].ref] }))
    }
  }
  for (const hole of job.mountingHoles) {
    if (outline.length && !pointInPolygon(hole, outline)) errors.push(issue('ERROR', 'MOUNTING_HOLE_OFF_BOARD', `${hole.id || 'mounting hole'} is outside board outline.`, { hole }))
    for (const component of job.components.filter(hasPlacement)) {
      const nearest = distancePointToSegment(hole, { x: component.x - component.width / 2, y: component.y }, { x: component.x + component.width / 2, y: component.y })
      if (nearest < (hole.diameterMm || 3) / 2) errors.push(issue('ERROR', 'MOUNTING_HOLE_OVERLAPS_COMPONENT', `${hole.id || 'mounting hole'} overlaps ${component.ref}.`, { hole, ref: component.ref }))
    }
  }
  for (const keepout of job.keepouts) {
    if (!Array.isArray(keepout.polygon) || keepout.polygon.length < 3) errors.push(issue('ERROR', 'KEEPOUT_INVALID', `${keepout.id || 'keepout'} has invalid polygon geometry.`, { keepout }))
  }
  return { warnings, errors }
}

function selectNetsForMode(nets, mode) {
  const critical = new Set(['CRYSTAL', 'CLOCK', 'USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'RS485_DIFF', 'LVDS_DIFF', 'MIPI_DIFF', 'PCIe_DIFF', 'RF', 'ANTENNA'])
  const power = new Set(['BATTERY', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'HIGH_VOLTAGE', 'MOTOR_PHASE', 'SWITCHING_NODE'])
  if (mode === 'critical_first') return nets.filter((net) => critical.has(net.className))
  if (mode === 'power_only') return nets.filter((net) => power.has(net.className))
  if (mode === 'signal_only') return nets.filter((net) => !power.has(net.className) && net.className !== 'GROUND')
  if (mode === 'diff_pairs') return nets.filter((net) => /_DIFF$/.test(net.className || ''))
  if (mode === 'remaining_nets') return nets.filter((net) => !critical.has(net.className) && !power.has(net.className) && net.className !== 'GROUND')
  return nets.filter((net) => net.className !== 'GROUND')
}

function validateFabRules(job, routingPlan) {
  const errors = []
  const profile = job.manufacturerProfile
  for (const route of routingPlan.routes || []) {
    if (route.status !== 'routed') continue
    if ((route.widthMm || 0) < profile.minTraceWidthMm) errors.push(issue('ERROR', 'TRACE_WIDTH_BELOW_FAB_MIN', `${route.net} width is below ${profile.name || profile.id} minimum.`, { net: route.net, widthMm: route.widthMm, minTraceWidthMm: profile.minTraceWidthMm }))
    if ((route.clearanceMm || 0) < profile.minClearanceMm) errors.push(issue('ERROR', 'CLEARANCE_BELOW_FAB_MIN', `${route.net} clearance is below manufacturer minimum.`, { net: route.net }))
    for (const via of route.viaPlan?.candidates || []) errors.push(...validateVia(job, via, route.net))
  }
  return errors
}

function validateModeSpecificRouting(job, routingPlan, mode) {
  const errors = []
  if (mode === 'diff_pairs' || mode === 'full_board') {
    for (const net of job.nets.filter((item) => /_DIFF$/.test(item.className || ''))) {
      const mate = diffMateName(net.name)
      const route = routingPlan.routes?.find((item) => item.net === net.name)
      const mateRoute = mate && routingPlan.routes?.find((item) => item.net === mate)
      if (!mate || !job.nets.some((item) => item.name === mate)) errors.push(issue('ERROR', 'DIFF_PAIR_MATE_MISSING', `${net.name} has no differential mate.`))
      if (route?.status === 'routed' && mateRoute?.status !== 'routed') errors.push(issue('ERROR', 'DIFF_PAIR_ROUTED_ALONE', `${net.name} routed without mate ${mate}.`))
      if (route?.status === 'routed' && mateRoute?.status === 'routed' && Math.abs((route.estimatedLengthMm || 0) - (mateRoute.estimatedLengthMm || 0)) > 1.5) errors.push(issue('ERROR', 'DIFF_PAIR_LENGTH_MISMATCH', `${net.name}/${mate} length mismatch exceeds intent.`, { mismatchMm: round(Math.abs(route.estimatedLengthMm - mateRoute.estimatedLengthMm)) }))
    }
  }
  return errors
}

function validateVia(job, via, netName = null) {
  const profile = job.manufacturerProfile
  const errors = []
  if ((via.diameterMm || 0) < profile.minViaDiameterMm) errors.push(issue('ERROR', 'VIA_DIAMETER_BELOW_FAB_MIN', `${netName || 'via'} via diameter is below manufacturer minimum.`, { via }))
  if ((via.drillMm || 0) < profile.minViaDrillMm) errors.push(issue('ERROR', 'VIA_DRILL_BELOW_FAB_MIN', `${netName || 'via'} via drill is below manufacturer minimum.`, { via }))
  if (['blind', 'buried', 'microvia'].includes(via.viaType) && !advancedViaAllowed(job, via.viaType)) errors.push(issue('ERROR', 'UNAPPROVED_ADVANCED_VIA', `${netName || 'via'} uses unapproved ${via.viaType}.`, { via }))
  if ((job.boardOutline.outline || []).length && !pointInPolygon(via, job.boardOutline.outline)) errors.push(issue('ERROR', 'VIA_OFF_BOARD', `${netName || 'via'} is outside board outline.`, { via }))
  return errors
}

function advancedViaAllowed(job, viaType) {
  if (viaType === 'blind') return job.routingPreferences.allowBlindVias && /supported|review|quote/i.test(job.manufacturerProfile.hdi?.blindVias || '')
  if (viaType === 'buried') return job.routingPreferences.allowBuriedVias && /supported|review|quote/i.test(job.manufacturerProfile.hdi?.buriedVias || '')
  if (viaType === 'microvia') return job.routingPreferences.allowMicrovias && /supported|review|quote/i.test(job.manufacturerProfile.hdi?.microvias || '')
  return true
}

function calculateTraceWidthJob(context) {
  const profile = context.profile || context.manufacturerProfile || {}
  const netClass = context.className || context.netClass || assignNetsToClasses([{ name: context.netName || 'DEFAULT' }])[0].className
  const rule = netClassProfiles[netClass] || netClassProfiles.DEFAULT
  const currentA = Number(context.currentA || context.estimatedCurrentA || (['BATTERY', 'MOTOR_PHASE'].includes(netClass) ? 3 : 0.1))
  const ipcApprox = currentA <= 0.1 ? rule.traceWidthMm : Math.max(rule.traceWidthMm, round(0.18 * currentA * (context.internalLayer ? 1.35 : 1)))
  const recommendedWidthMm = Math.max(ipcApprox, profile.minTraceWidthMm || 0.127)
  return { status: 'TRACE_WIDTH_CALCULATED', traceWidth: { netClass, currentA, minTraceWidthMm: profile.minTraceWidthMm || 0.127, recommendedWidthMm, preferCopperPour: currentA >= 1.5 }, warnings: currentA >= 3 ? [issue('WARNING', 'HIGH_CURRENT_POUR_RECOMMENDED', 'High-current net should use copper pours and via arrays, not only thin traces.')] : [], errors: [], humanReviewRequired: true }
}

function validateTraceWidthJob(context) {
  const calc = calculateTraceWidthJob(context)
  const actual = Number(context.actualWidthMm || context.widthMm || 0)
  const errors = actual < calc.traceWidth.recommendedWidthMm ? [issue('ERROR', 'TRACE_WIDTH_TOO_SMALL', `Trace width ${actual}mm is below recommended ${calc.traceWidth.recommendedWidthMm}mm.`, { actualWidthMm: actual, recommendedWidthMm: calc.traceWidth.recommendedWidthMm })] : []
  return { status: errors.length ? 'TRACE_WIDTH_INVALID' : 'TRACE_WIDTH_VALID', traceWidth: { ...calc.traceWidth, actualWidthMm: actual }, warnings: calc.warnings, errors, humanReviewRequired: true }
}

function detectPowerNeckdowns(context) {
  const routes = context.routingPlan?.routes || context.routes || []
  const errors = routes.filter((route) => ['BATTERY', 'POWER_HIGH_CURRENT', 'MOTOR_PHASE'].includes(route.className) && (route.widthMm || 0) < (netClassProfiles[route.className]?.traceWidthMm || 0.5)).map((route) => issue('ERROR', 'POWER_NECKDOWN', `${route.net} has a high-current neckdown.`, { net: route.net, widthMm: route.widthMm }))
  return { status: errors.length ? 'POWER_NECKDOWNS_FOUND' : 'POWER_NECKDOWNS_CLEAR', warnings: [], errors, neckdowns: errors.map((item) => item.details), humanReviewRequired: true }
}

function createPowerPour(context) {
  const net = context.netName || context.net || 'VBAT'
  const layer = context.layer || 'F.Cu'
  return { status: 'POWER_POUR_PLAN_READY_NEEDS_DRC', powerPour: { net, layer, clearanceMm: context.clearanceMm || 0.25, thermalRelief: context.thermalRelief !== false, polygon: context.polygon || context.board?.outline || [] }, warnings: [issue('WARNING', 'ZONE_FILL_DRC_REQUIRED', 'Power pour is a plan/write intent; KiCad zone fill and DRC must verify it.')], errors: [], humanReviewRequired: true }
}

function selectViaTypeJob(context) {
  const job = normalizeAutoTraceJob(context, 'full_board')
  const netClass = context.className || context.netClass || assignNetsToClasses([{ name: context.netName || 'DEFAULT' }])[0].className
  const sensitive = /USB|ETHERNET|CAN|RF|CLOCK|CRYSTAL/.test(netClass)
  const highCurrent = /BATTERY|MOTOR|POWER_HIGH_CURRENT/.test(netClass)
  const viaType = context.requestedViaType || (context.preferBlindVia && advancedViaAllowed(job, 'blind') ? 'blind' : 'through')
  const rule = netClassProfiles[netClass] || netClassProfiles.DEFAULT
  const via = { viaType, diameterMm: highCurrent ? Math.max(rule.viaDiameterMm, 0.8) : rule.viaDiameterMm, drillMm: highCurrent ? Math.max(rule.viaDrillMm, 0.4) : rule.viaDrillMm, paired: sensitive, array: highCurrent }
  const errors = validateVia(job, { ...via, x: context.x || 1, y: context.y || 1 }, context.netName)
  return { status: errors.length ? 'VIA_TYPE_BLOCKED' : 'VIA_TYPE_SELECTED_NEEDS_REVIEW', viaStrategy: via, warnings: sensitive ? [issue('WARNING', 'SENSITIVE_VIA_REVIEW', 'Sensitive nets should avoid vias or use paired return vias.')] : [], errors, humanReviewRequired: true }
}

function validateViaManufacturability(context) {
  const job = normalizeAutoTraceJob(context, 'full_board')
  const vias = context.vias || context.routingPlan?.routes?.flatMap((route) => route.viaPlan?.candidates || []) || []
  const errors = vias.flatMap((via) => validateVia(job, via, via.net))
  return { status: errors.length ? 'VIA_MANUFACTURABILITY_BLOCKED' : 'VIA_MANUFACTURABILITY_READY', checkedVias: vias.length, warnings: [], errors, humanReviewRequired: true }
}

function autoTraceResult(status, job, routingPlan, readiness, extra = {}) {
  return {
    status,
    routedNets: [],
    partiallyRoutedNets: [],
    unroutedNets: [],
    createdTracks: [],
    createdVias: [],
    createdZones: [],
    netClassReport: buildNetClassReport(job),
    layerUsageReport: { layers: job.layerStack.layers, usage: [] },
    viaReport: { viaCount: 0, blind: 0, buried: 0, microvia: 0, through: 0 },
    powerReport: { powerNetCount: job.nets.filter((net) => /POWER|BATTERY|MOTOR|VOLTAGE/.test(net.className || '')).length, issues: [] },
    differentialPairReport: { pairCount: 0, pairs: [] },
    noiseReport: { noisyNetCount: job.nets.filter((net) => /SWITCHING|MOTOR|CLOCK|RF/.test(net.className || '')).length, warnings: [] },
    manufacturerReport: { profile: job.manufacturerProfile.name || job.manufacturerProfile.id, errors: [] },
    internalViolations: readiness.errors || [],
    drcResult: null,
    autoFixesAttempted: [],
    remainingIssues: readiness.errors || [],
    routingScore: { score: 0, routed: 0, unrouted: job.nets.length, violations: readiness.errors?.length || 0 },
    humanReviewChecklist: checklist(job, false),
    reportMarkdown: '',
    routingPlan,
    warnings: readiness.warnings || [],
    errors: readiness.errors || [],
    humanReviewRequired: true,
    ...extra,
  }
}

function buildNetClassReport(job) {
  const classes = createNetClasses(job.manufacturerProfile)
  return { totalNets: job.nets.length, classes: classes.filter((item) => job.nets.some((net) => net.className === item.name)), nets: job.nets.map((net) => ({ name: net.name, className: net.className, priority: netClassProfiles[net.className]?.priority || 50 })) }
}

function buildLayerUsageReport(job, routeObjects) {
  const byLayer = new Map()
  for (const segment of routeObjects.segments) byLayer.set(segment.layer, (byLayer.get(segment.layer) || 0) + 1)
  return { layers: job.layerStack.layers, usage: [...byLayer.entries()].map(([layer, segmentCount]) => ({ layer, segmentCount })) }
}

function buildViaReport(job, routeObjects) {
  const vias = routeObjects.vias
  return { viaCount: vias.length, through: vias.filter((via) => !via.viaType || via.viaType === 'through').length, blind: vias.filter((via) => via.viaType === 'blind').length, buried: vias.filter((via) => via.viaType === 'buried').length, microvia: vias.filter((via) => via.viaType === 'microvia').length, errors: vias.flatMap((via) => validateVia(job, via, via.net)) }
}

function buildPowerReport(job, routingPlan) {
  const powerRoutes = (routingPlan.routes || []).filter((route) => /POWER|BATTERY|MOTOR|VOLTAGE|SWITCHING/.test(route.className || ''))
  return { powerNetCount: powerRoutes.length, routes: powerRoutes.map((route) => ({ net: route.net, widthMm: route.widthMm, status: route.status, preferPour: route.widthMm >= 0.6 })) }
}

function buildDifferentialPairReport(job, routingPlan) {
  const pairs = []
  for (const net of job.nets.filter((item) => /_DIFF$/.test(item.className || ''))) {
    const mate = diffMateName(net.name)
    if (!mate || pairs.some((pair) => pair.nets.includes(net.name))) continue
    const a = routingPlan.routes?.find((route) => route.net === net.name)
    const b = routingPlan.routes?.find((route) => route.net === mate)
    pairs.push({ nets: [net.name, mate], routed: a?.status === 'routed' && b?.status === 'routed', lengthMismatchMm: a && b ? round(Math.abs((a.estimatedLengthMm || 0) - (b.estimatedLengthMm || 0))) : null, impedance: 'impedance intent applied; not guaranteed without manufacturer stackup calculation' })
  }
  return { pairCount: pairs.length, pairs }
}

function buildNoiseReport(job) {
  const noisy = job.nets.filter((net) => /SWITCHING_NODE|MOTOR_PHASE|CLOCK|RF|ANTENNA/.test(net.className || ''))
  const sensitive = job.nets.filter((net) => /ANALOG|SENSOR|CRYSTAL|RF|ANTENNA/.test(net.className || ''))
  return { noisyNetCount: noisy.length, sensitiveNetCount: sensitive.length, warnings: noisy.length && sensitive.length ? [issue('WARNING', 'NOISE_SEPARATION_REVIEW', 'Noisy and sensitive nets both exist; inspect spacing and return paths.')] : [] }
}

function buildManufacturerReport(job, routingPlan, violations) {
  return { profile: job.manufacturerProfile.name || job.manufacturerProfile.id, minTraceWidthMm: job.manufacturerProfile.minTraceWidthMm, minClearanceMm: job.manufacturerProfile.minClearanceMm, routeCount: routingPlan.routes?.length || 0, blockerCount: violations.length, errors: violations.filter((item) => /FAB|VIA|TRACE_WIDTH|CLEARANCE/.test(item.code || '')) }
}

function summarizeRoutes(routes) {
  return routes.map((route) => ({ net: route.net, className: route.className, lengthMm: route.estimatedLengthMm, viaCount: route.viaPlan?.candidates?.length || 0, status: route.status }))
}

function summarizeUnrouted(routes, selectedNets) {
  const fromRoutes = routes.map((route) => ({ net: route.net, className: route.className, reason: route.status || 'unrouted' }))
  const routedNames = new Set(routes.map((route) => route.net))
  return fromRoutes.length ? fromRoutes : selectedNets.filter((net) => !routedNames.has(net.name)).map((net) => ({ net: net.name, className: net.className, reason: 'no route generated' }))
}

function buildRoutingScore(job, routedNets, unroutedNets, violations, warnings) {
  const total = Math.max(1, routedNets.length + unroutedNets.length)
  return { score: Math.max(0, round((routedNets.length / total) * 100 - violations.length * 8 - warnings.length * 1.5)), routed: routedNets.length, unrouted: unroutedNets.length, violations: violations.length }
}

function routingReport(job, routingPlan, routedNets, unroutedNets, violations, warnings, status) {
  return `# BoardForge Autotrace Report

Status: ${status}

${routedNets.length}/${routedNets.length + unroutedNets.length} selected nets routed.
Critical blockers: ${violations.length}.
Warnings: ${warnings.length}.

## Routed Nets
${routedNets.map((net) => `- ${net.net}: ${net.lengthMm} mm, vias ${net.viaCount}`).join('\n') || '- none'}

## Unrouted Nets
${unroutedNets.map((net) => `- ${net.net}: ${net.reason}`).join('\n') || '- none'}

## Required Proof
- Internal route validation
- KiCad DRC after copper write
- Manufacturer/fab rule review
- Human review before manufacturing
`
}

function blockedReport(readiness) {
  return `# BoardForge Autotrace Blocked

Routing blocked before trace generation.

${readiness.errors.map((item) => `- ${item.code}: ${item.message}`).join('\n')}
`
}

function checklist(job, fullyRouted) {
  return [
    fullyRouted ? 'All selected nets routed internally.' : 'Review unrouted nets and blockers.',
    'Run KiCad DRC after any copper write.',
    'Inspect differential pair length/skew and reference plane continuity.',
    'Inspect power widths, pours, via arrays, and thermal relief.',
    'Inspect manufacturing profile limits before export.',
  ]
}

function suggestPlacementMoves(job, violations = [], unroutedNets = []) {
  const suggestions = []
  const codes = new Set(violations.map((item) => item.code))
  const affectedRefs = new Set()
  for (const violation of violations) {
    for (const ref of violation.details?.refs || []) affectedRefs.add(ref)
    if (violation.details?.component) affectedRefs.add(violation.details.component)
    if (violation.details?.ref) affectedRefs.add(violation.details.ref)
  }
  for (const net of unroutedNets) {
    for (const ref of net.refs || net.endpointRefs || []) affectedRefs.add(ref)
  }
  if (codes.has('ROUTE_PAD_CLEARANCE') || codes.has('ROUTE_ROUTE_CLEARANCE')) suggestions.push({ action: 'increase_routing_channel', reason: 'Routing conflicts need more clearance between pads/traces; move nearby passives away from dense channels before reroute.' })
  if (codes.has('ROUTE_SEGMENT_CROSSES_BOARD_EDGE')) suggestions.push({ action: 'move_endpoint_or_expand_outline', reason: 'A routed segment crosses Edge.Cuts; move the endpoint inward, add a notch/channel, or expand the outline.' })
  if (codes.has('COMPONENTS_OVERLAP')) suggestions.push({ action: 'repair_component_overlap', reason: 'Overlapping components must be separated before routing.' })
  if (unroutedNets.length) suggestions.push({ action: 'ripup_reroute_or_move_components', reason: `${unroutedNets.length} net(s) remain unrouted; move endpoints closer or allow more layers/vias.`, affectedRefs: [...affectedRefs] })
  const dense = affectedRefs.size ? job.components.filter((component) => affectedRefs.has(component.ref)).map((component) => ({ ref: component.ref, x: component.x, y: component.y, suggestion: edgeConnector(component) ? 'keep on board edge but clear adjacent routing channel' : 'nudge away from congested channel by 1-3 mm' })) : []
  return { suggestions, affectedComponents: dense, humanReviewRequired: Boolean(suggestions.length) }
}

function edgeConnector(component) {
  return /USB|RJ45|CONN|JST|HEADER|XT\d|TERMINAL/i.test(`${component.ref} ${component.footprint || ''} ${component.value || ''}`)
}

function normalizeLayerStack(stackup, board) {
  const count = Number(stackup.layerCount || board.layerCount || 2)
  const names = count >= 6 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'B.Cu'] : count >= 4 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'B.Cu'].slice(0, count)
  const layers = stackup.layers?.length ? stackup.layers : names.map((name, index) => ({ name, kicadName: name, type: /In1|In4/.test(name) ? 'ground' : /In2/.test(name) ? 'power' : 'signal', preferredNetClasses: preferredClassesForLayer(name, index), allowedNetClasses: ['DEFAULT', 'POWER_LOW_CURRENT', 'POWER_HIGH_CURRENT', 'BATTERY', 'USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'SPI', 'I2C', 'UART', 'CLOCK', 'CRYSTAL', 'ANALOG', 'SENSOR', 'RF', 'ANTENNA', 'MOTOR_PHASE'] }))
  return { ...stackup, layerCount: layers.length, layers }
}

function preferredClassesForLayer(name) {
  if (/In1|In4/.test(name)) return ['GROUND']
  if (/In2/.test(name)) return ['POWER_LOW_CURRENT', 'POWER_HIGH_CURRENT', 'BATTERY']
  return ['DEFAULT', 'USB_DIFF', 'ETHERNET_DIFF', 'CAN_DIFF', 'SPI', 'I2C', 'UART']
}

function normalizeComponents(components) {
  return (components || []).map((component) => {
    const pinMap = { ...(component.pinMap || {}) }
    for (const pad of component.pads || []) {
      if (pad.netName && (pad.pad || pad.name)) pinMap[pad.pad || pad.name] = pad.netName
    }
    return { ...component, ref: component.ref || component.reference || component.designator || '', width: Number(component.width || component.widthMm || component.size?.widthMm || 2), height: Number(component.height || component.heightMm || component.size?.heightMm || 2), x: numberOr(component.x, component.at?.x), y: numberOr(component.y, component.at?.y), pinMap }
  })
}

function normalizePads(pads, components) {
  const byRef = new Map(components.map((component) => [component.ref, component]))
  return (pads || []).map((pad) => {
    const component = byRef.get(pad.ref)
    return {
      ...pad,
      ref: pad.ref,
      pad: pad.pad || pad.name,
      name: pad.name || pad.pad,
      x: numberOr(pad.x, component?.x),
      y: numberOr(pad.y, component?.y),
      widthMm: Number(pad.widthMm || pad.width || 0.6),
      heightMm: Number(pad.heightMm || pad.height || 0.6),
      netName: pad.netName || pad.net,
    }
  }).filter((pad) => Number.isFinite(pad.x) && Number.isFinite(pad.y))
}

function normalizeNets(nets, components, pads = []) {
  const mapped = components.flatMap((component) => Object.values(component.pinMap || {}).filter(Boolean).map((name) => ({ name })))
  const padMapped = pads.filter((pad) => pad.netName).map((pad) => ({ name: pad.netName, pins: [{ ref: pad.ref, pin: pad.pad }] }))
  const base = [...(nets || []), ...mapped, ...padMapped]
  const byName = new Map()
  for (const raw of base) {
    const net = typeof raw === 'string' ? { name: raw } : raw
    if (!net?.name) continue
    const existing = byName.get(net.name) || { name: net.name, pins: [] }
    byName.set(net.name, { ...existing, ...net, pins: mergePins(existing.pins, net.pins) })
  }
  return [...byName.values()]
}

function netsFromScan(scan, pads) {
  return (scan.nets || []).filter((net) => net.name && net.name !== '').map((net) => ({
    name: net.name,
    pins: pads.filter((pad) => pad.netName === net.name).map((pad) => ({ ref: pad.ref, pin: pad.pad })),
  }))
}

function mergePins(a = [], b = []) {
  const byKey = new Map([...a, ...b].map((pin) => [`${pin.ref || ''}:${pin.pin || pin.pad || ''}`, pin]))
  return [...byKey.values()].filter((pin) => pin.ref || pin.pin || pin.pad)
}

function hasPlacement(component) {
  return Number.isFinite(component.x) && Number.isFinite(component.y) && component.width > 0 && component.height > 0
}

function modeForType(type) {
  return {
    autotrace_board: 'full_board',
    autotrace_critical_nets: 'critical_first',
    autotrace_power: 'power_only',
    autotrace_signals: 'signal_only',
    autotrace_diff_pairs: 'diff_pairs',
    autotrace_remaining_nets: 'remaining_nets',
    repair_routing: 'repair_existing',
    reroute_failed_nets: 'remaining_nets',
    run_routing_drc: 'full_board',
  }[type] || 'full_board'
}

function diffMateName(name) {
  if (/_DP$/.test(name)) return name.replace(/_DP$/, '_DN')
  if (/_DN$/.test(name)) return name.replace(/_DN$/, '_DP')
  if (/_P$/.test(name)) return name.replace(/_P$/, '_N')
  if (/_N$/.test(name)) return name.replace(/_N$/, '_P')
  if (/\+$/.test(name)) return name.replace(/\+$/, '-')
  if (/-$/.test(name)) return name.replace(/-$/, '+')
  return null
}

function numberOr(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return undefined
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
