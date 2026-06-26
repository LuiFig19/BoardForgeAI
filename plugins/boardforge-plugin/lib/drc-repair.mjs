import crypto from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function planDrcRepairs({ reportFile, pcbFile, profile = {}, state = null }) {
  const report = await readJson(reportFile)
  const issues = extractDrcIssues(report)
  const text = JSON.stringify(report || {})
  const repairs = classifyRepairs(issues, text, profile)
  const rerouteConstraints = constraintsFromDrcIssues(issues)
  const pcbStats = await scanPcbForRepairCandidates(pcbFile)
  if (pcbStats.zeroLengthSegments) repairs.push({ action: 'remove_zero_length_segments', risk: 'low', category: 'copper_cleanup', reason: `${pcbStats.zeroLengthSegments} zero-length segments found in PCB text.`, autoSafe: true })
  if (pcbStats.boardforgeZones && /zone|copper pour|fill/i.test(text)) repairs.push({ action: 'refill_or_rebuild_generated_zones', risk: 'medium', category: 'zone_cleanup', reason: 'Generated copper zones need refill/rebuild with updated keepouts; deleting pours is not safe because it can break ground connectivity.' })
  const autoApplicable = repairs.filter((item) => item.autoSafe)
  const blockers = repairs.filter((item) => item.risk === 'high')
  return {
    status: repairs.length ? 'DRC_REPAIR_PLAN_READY_NEEDS_REVIEW' : 'DRC_REPAIR_NO_ACTIONS_FOUND',
    reportFile,
    pcbFile,
    reportParsed: Boolean(report),
    issueCount: issues.length,
    severityCounts: severityCounts(issues),
    pcbStats,
    repairs,
    rerouteConstraints,
    blockers,
    autoApplicable,
    nextJobs: nextJobsFor(repairs),
    stateContext: state ? { status: state.status, projectName: state.projectName, routingStatus: state.routing?.status || null } : null,
    humanReviewRequired: true,
  }
}

function constraintsFromDrcIssues(issues = []) {
  const forbiddenPoints = []
  const placementRefs = new Set()
  const silkscreenRefs = new Set()
  const affectedNets = new Set()
  for (const issue of issues) {
    const type = String(issue.type || issue.boardforgeCode || issue.code || '')
    const text = `${type} ${issue.description || ''} ${issue.message || ''}`
    for (const item of issue.items || []) {
      const net = netFromDescription(item.description)
      const layer = layerFromDescription(item.description) || item.layer || null
      const ref = refFromDescription(item.description)
      if (net) affectedNets.add(net)
      if (/courtyard|overlap|collision|npth_inside_courtyard/i.test(text) && ref) placementRefs.add(ref)
      if (/silk|legend|text/i.test(text) && ref) silkscreenRefs.add(ref)
      if (item.pos && Number.isFinite(Number(item.pos.x)) && Number.isFinite(Number(item.pos.y)) && /clearance|short|track|via|unconnected|hole_clearance|solder_mask_bridge/i.test(text)) {
        forbiddenPoints.push({
          net,
          layer,
          x: roundCoord(item.pos.x),
          y: roundCoord(item.pos.y),
          radiusMm: rerouteRadiusFor(type || text),
          sourceType: type || 'drc',
          reason: issue.description || issue.message || type,
        })
      }
    }
  }
  return {
    status: forbiddenPoints.length || placementRefs.size || silkscreenRefs.size ? 'DRC_REPAIR_CONSTRAINTS_READY' : 'DRC_REPAIR_NO_CONSTRAINTS',
    affectedNets: [...affectedNets],
    forbiddenPoints: dedupeForbiddenPoints(forbiddenPoints),
    placementRefs: [...placementRefs],
    silkscreenRefs: [...silkscreenRefs],
  }
}

export async function applySafeDrcRepairs({ pcbFile, repairPlan }) {
  let pcb = await readFile(pcbFile, 'utf8')
  let applied = 0
  {
    const before = pcb
    pcb = removeDuplicateCopperBlocks(pcb)
    pcb = removeCoLocatedGeneratedVias(pcb)
    if (pcb !== before) applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'remove_generated_zones_for_refill' || item.action === 'rebuild_zone_with_keepouts' || item.action === 'remove_isolated_generated_zones')) {
    const before = pcb
    pcb = removeGeneratedZones(pcb)
    if (pcb !== before) applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'remove_zero_length_segments')) {
    const before = pcb
    pcb = pcb.replace(/^\s*\(segment\s+\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+\1\s+\2\)[^\n]*\n/gm, '')
    if (pcb !== before) applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'remove_or_connect_dangling_vias')) {
    const before = pcb
    pcb = removeBoardforgeDanglingVias(pcb, repairPlan)
    if (pcb !== before) applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'remove_generated_shorting_vias')) {
    const before = pcb
    pcb = removeGeneratedShortingVias(pcb, repairPlan)
    if (pcb !== before) applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'remove_generated_shorting_segments')) {
    const before = pcb
    pcb = removeGeneratedShortingSegments(pcb, repairPlan)
    if (pcb !== before) applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'remove_generated_dangling_segments')) {
    const before = pcb
    pcb = removeGeneratedDanglingSegments(pcb, repairPlan)
    if (pcb !== before) applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'remove_generated_unconnected_segments')) {
    const before = pcb
    pcb = removeGeneratedUnconnectedSegments(pcb, repairPlan)
    if (pcb !== before) applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'remove_generated_unconnected_vias')) {
    const before = pcb
    pcb = removeGeneratedUnconnectedVias(pcb, repairPlan)
    if (pcb !== before) applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'bridge_endpoint_gaps_from_drc_evidence')) {
    const before = pcb
    pcb = applyEndpointGapBridges(pcb, repairPlan)
    if (pcb !== before) applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'connect_short_same_net_unconnected_pairs')) {
    const before = pcb
    pcb = appendSameNetRepairSegments(pcb, repairPlan)
    if (pcb !== before) applied += 1
  }
  await writeFile(pcbFile, pcb, 'utf8')
  return {
    status: applied ? 'SAFE_DRC_REPAIRS_APPLIED_RERUN_DRC' : 'NO_SAFE_DRC_REPAIRS_APPLIED',
    applied,
    pcbFile,
    humanReviewRequired: true,
  }
}

export async function runDrcDrivenCopperRepairLoop({ pcbFile, reportDir, runDrc, profile = {}, state = null, maxIterations = 4 }) {
  await mkdir(reportDir, { recursive: true })
  const iterations = []
  let bestErrors = Infinity
  let bestWarnings = Infinity
  let finalReport = null
  let appliedAfterLastReport = false
  const rejectedRepairKeys = new Set()
  for (let index = 0; index < maxIterations; index += 1) {
    const reportFile = path.join(reportDir, `drc-repair-${index + 1}.json`)
    const drc = await runDrc({ outputFile: reportFile })
    finalReport = drc
    appliedAfterLastReport = false
    const issueCounts = normalizeIssueCounts(drc)
    const beforePcb = await readFile(pcbFile, 'utf8')
    const repairPlan = await planDrcRepairs({ reportFile, pcbFile, profile, state })
    const repairPlanForApply = oneConnectivityRepairAtATime(repairPlan, rejectedRepairKeys)
    const applied = repairPlanForApply.autoApplicable?.length
      ? await applySafeDrcRepairs({ pcbFile, repairPlan: repairPlanForApply })
      : { status: 'NO_SAFE_DRC_REPAIRS_AVAILABLE', applied: 0, pcbFile }
    appliedAfterLastReport = Boolean(applied.applied)
    iterations.push({
      index: index + 1,
      reportFile,
      issueCounts,
      repairPlan: summarizeRepairPlan(repairPlan),
      applied,
    })
    if (!issueCounts.errors) break
    const improved = issueCounts.errors < bestErrors || (issueCounts.errors === bestErrors && issueCounts.warnings < bestWarnings)
    bestErrors = Math.min(bestErrors, issueCounts.errors)
    bestWarnings = Math.min(bestWarnings, issueCounts.warnings)
    if (!applied.applied) break
    const verifyFile = path.join(reportDir, `drc-repair-${index + 1}-verify.json`)
    const verified = await runDrc({ outputFile: verifyFile })
    const verifiedCounts = normalizeIssueCounts(verified)
    const beforeScore = drcIssueScore(drc)
    const afterScore = drcIssueScore(verified)
    const kept = verifiedCounts.errors < issueCounts.errors
      || (verifiedCounts.errors === issueCounts.errors && verifiedCounts.warnings < issueCounts.warnings && afterScore <= beforeScore)
    iterations.push({
      index: iterations.length + 1,
      reportFile: verifyFile,
      issueCounts: verifiedCounts,
      repairPlan: {
        status: kept ? 'POST_REPAIR_DRC_IMPROVED' : 'POST_REPAIR_DRC_RESTORED_NO_IMPROVEMENT',
        issueCount: null,
        autoApplicableCount: 0,
        blockerCount: 0,
        repairs: [],
        scoreBefore: beforeScore,
        scoreAfter: afterScore,
      },
      applied: { status: kept ? 'SAFE_DRC_REPAIR_KEPT' : 'SAFE_DRC_REPAIR_RESTORED_NO_IMPROVEMENT', applied: kept ? applied.applied : 0, pcbFile },
    })
    if (!kept) {
      await writeFile(pcbFile, beforePcb, 'utf8')
      finalReport = drc
      appliedAfterLastReport = false
      if (repairPlanForApply.selectedRepairKey) {
        rejectedRepairKeys.add(repairPlanForApply.selectedRepairKey)
        continue
      }
      break
    }
    finalReport = verified
    appliedAfterLastReport = false
    bestErrors = Math.min(bestErrors, verifiedCounts.errors)
    bestWarnings = Math.min(bestWarnings, verifiedCounts.warnings)
    if (!improved && verifiedCounts.errors === issueCounts.errors && verifiedCounts.warnings === issueCounts.warnings) break
    if (!verifiedCounts.errors) break
  }
  if (appliedAfterLastReport) {
    const finalReportFile = path.join(reportDir, 'drc-repair-final.json')
    finalReport = await runDrc({ outputFile: finalReportFile })
    iterations.push({
      index: iterations.length + 1,
      reportFile: finalReportFile,
      issueCounts: normalizeIssueCounts(finalReport),
      repairPlan: { status: 'POST_REPAIR_DRC_VERIFICATION', issueCount: null, autoApplicableCount: 0, blockerCount: 0, repairs: [] },
      applied: { status: 'FINAL_DRC_ONLY', applied: 0, pcbFile },
    })
  }
  const finalIssueCounts = normalizeIssueCounts(finalReport)
  return {
    status: finalIssueCounts.errors ? 'DRC_REPAIR_LOOP_BLOCKED_NEEDS_ROUTER_REPAIR' : 'DRC_REPAIR_LOOP_DRC_CLEAN_NEEDS_EXPORT_REVIEW',
    iterations,
    finalReport,
    finalIssueCounts,
    remainingBlockers: classifyRemainingBlockers(finalReport),
    humanReviewRequired: true,
  }
}

export function extractDrcRerouteConstraints(drcResult = {}, options = {}) {
  const body = drcResult?.report || drcResult || {}
  const issues = [...(body.violations || []), ...(body.unconnected_items || [])]
  const forbiddenPoints = []
  const affectedNets = new Set()
  const reasons = []
  for (const issue of issues) {
    if (String(issue.severity || '').toLowerCase() !== 'error') continue
    const type = String(issue.type || '')
    if (!/tracks_crossing|clearance|shorting_items|track_dangling|via_dangling|unconnected/i.test(type)) continue
    const items = (issue.items || []).map((item) => ({
      ...item,
      net: netFromDescription(item.description),
      layer: layerFromDescription(item.description),
    })).filter((item) => item.net && item.pos)
    if (!items.length) continue
    const victim = chooseRerouteVictim(items, issue)
    if (!victim?.net) continue
    affectedNets.add(victim.net)
    reasons.push({
      net: victim.net,
      type,
      description: issue.description || '',
      items: items.map((item) => item.description).filter(Boolean),
    })
    for (const item of items) {
      if (item.net !== victim.net) continue
      forbiddenPoints.push({
        net: victim.net,
        layer: item.layer || 'F.Cu',
        x: roundCoord(item.pos.x),
        y: roundCoord(item.pos.y),
        radiusMm: rerouteRadiusFor(type, options),
        sourceType: type,
        reason: issue.description || type,
      })
    }
  }
  return {
    status: affectedNets.size ? 'DRC_REROUTE_CONSTRAINTS_READY' : 'DRC_REROUTE_NO_CONSTRAINTS',
    affectedNets: [...affectedNets],
    forbiddenPoints: dedupeForbiddenPoints(forbiddenPoints),
    reasons,
  }
}

function classifyRepairs(issues, text, profile) {
  const repairs = []
  const sameNetPairs = []
  const add = (action, risk, category, reason, extra = {}) => {
    const existing = repairs.find((item) => item.action === action && item.category === category)
    if (!existing) {
      repairs.push({ action, risk, category, reason, ...extra })
      return
    }
    for (const key of ['points', 'segments', 'pairs', 'bridges']) {
      if (Array.isArray(extra[key])) existing[key] = dedupeRepairItems([...(existing[key] || []), ...extra[key]])
    }
  }
  for (const issue of issues) {
    const haystack = `${issue.type || ''} ${issue.description || ''} ${issue.message || ''} ${issue.name || ''}`
    if (/clearance|courtyard overlap|collision/i.test(haystack)) add('reroute_or_move_objects_for_clearance', 'medium', 'clearance', 'Clearance/collision violation found; BoardForge should reroute or move objects, then rerun DRC.')
    if (/unconnected/i.test(haystack)) {
      sameNetPairs.push(...sameNetUnconnectedPairs(issue).filter((pair) => !/^(GND|AGND|DGND)$/i.test(String(pair.net || ''))))
      const endpointBridges = endpointGapBridgeRepairs(issue)
      const protectedUuids = new Set(endpointBridges.flatMap((bridge) => bridge.protectUuids || []))
      const unconnectedSegments = generatedTrackSegments(issue)
        .filter((segment) => !/USB_D[PN]/i.test(String(segment.net || '')))
        .filter((segment) => !segment.uuid || !protectedUuids.has(segment.uuid))
      if (false && unconnectedSegments.length) add('remove_generated_unconnected_segments', 'low', 'track_cleanup', 'Generated track islands reported as unconnected can be removed before endpoint-aware reroute.', { autoSafe: true, segments: unconnectedSegments })
      const unconnectedVias = generatedViaPoints(issue)
        .filter((point) => !/USB_D[PN]/i.test(String(point.net || '')))
        .filter((point) => !/^(3V3|5V|VUSB|VBUS|VIN|GND|AGND|DGND)$/i.test(String(point.net || '')))
      if (unconnectedVias.length) add('remove_generated_unconnected_vias', 'low', 'via_cleanup', 'Generated vias reported as unconnected can be removed before endpoint-aware reroute.', { autoSafe: true, points: unconnectedVias })
      if (endpointBridges.length) add('bridge_endpoint_gaps_from_drc_evidence', 'low', 'connectivity', 'Endpoint-aware DRC bridge candidates can be applied only from reported pad/track/via endpoints and must be verified by KiCad DRC before export.', { autoSafe: true, bridges: endpointBridges })
      add('connect_unconnected_pads_or_reroute_net', 'medium', 'connectivity', 'Unconnected component pads remain; reroute the affected net before export.')
    }
    if (/COPPER_ZONE_CONNECTIVITY_REVIEW|Zone \[[^\]]+\] on .*Zone \[[^\]]+\] on/i.test(JSON.stringify(issue))) add('review_or_refill_same_net_copper_zone', 'low', 'zone_review', 'Same-net copper zone connectivity needs review/refill but does not imply a broken component net.')
    if (/isolated_copper|isolated copper fill/i.test(haystack)) add('review_isolated_generated_zones', 'low', 'zone_review', 'Generated copper zone has isolated islands; keep the pour for connectivity and report the warning until a zone-refill strategy can remove islands safely.')
    if (/holes_co_located|drilled holes co-located/i.test(haystack)) add('remove_duplicate_generated_vias', 'low', 'via_cleanup', 'Generated vias are co-located; remove duplicate via blocks at the same net/location before rerunning DRC.', { autoSafe: true })
    if (/via_dangling|dangling via/i.test(haystack)) add('remove_or_connect_dangling_vias', 'low', 'via_cleanup', 'Dangling generated vias found; remove or reconnect before final release.', { autoSafe: true })
    if (/track_dangling|dangling track|unconnected end/i.test(haystack)) {
      const danglingSegments = generatedTrackSegments(issue).filter((segment) => !/USB_D[PN]/i.test(String(segment.net || '')))
      if (false && danglingSegments.length) add('remove_generated_dangling_segments', 'low', 'track_cleanup', 'Generated dangling track stubs can be removed after DRC proves the endpoint is unconnected.', { autoSafe: true, segments: danglingSegments })
      add('route_endpoint_repair_required', 'medium', 'track_cleanup', 'Dangling generated tracks require endpoint-aware rerouting or removal of proven generated stubs before export.')
    }
    if (/shorting|short circuit|short/i.test(haystack)) {
      const shortingViaPoints = generatedViaPoints(issue)
      const shortingSegments = generatedTrackSegments(issue)
      if (shortingViaPoints.length) add('remove_generated_shorting_vias', 'medium', 'short', 'Generated vias are shorting other nets; remove the vias and attached bottom-layer stubs, then rerun DRC/routing.', { autoSafe: true, points: shortingViaPoints })
      if (shortingSegments.length) add('remove_generated_shorting_segments', 'medium', 'short', 'Generated tracks are shorting other nets; remove the reported generated segments, then rerun DRC/routing.', { autoSafe: true, segments: shortingSegments })
      add('block_release_on_short_and_reroute', 'high', 'short', 'Short circuit found; release must be blocked until the offending copper is rerouted or removed.')
    }
    if (/tracks_crossing/i.test(haystack)) {
      const crossingSegments = crossingRepairVictims(generatedTrackSegments(issue))
      if (crossingSegments.length) add('remove_generated_shorting_segments', 'medium', 'routing_crossing', 'Generated tracks cross other copper; remove the reported generated segments, then reroute from DRC evidence.', { autoSafe: true, segments: crossingSegments })
    }
    if (/track width|trace width|width/i.test(haystack)) add('increase_route_width_to_profile', 'medium', 'routing_width', `Route width violation found; enforce at least ${profile.minTraceWidthMm || 'profile'} mm where applicable.`)
    if (/via.*diameter|annular|drill|hole/i.test(haystack)) add('resize_or_move_via_to_profile', 'medium', 'via', `Via/drill issue found; enforce diameter ${profile.minViaDiameterMm || 'profile'} mm and drill ${profile.minViaDrillMm || 'profile'} mm.`)
    if (/zone|copper pour|fill/i.test(haystack)) add('refill_or_rebuild_generated_zones', 'medium', 'zone_cleanup', 'Zone issue found; generated pours must be refilled/rebuilt without deleting required ground connectivity.')
    if (/edge|board edge|outline/i.test(haystack)) add('move_object_inside_edge_clearance', 'high', 'mechanical', 'Board-edge violation found; moving objects may affect mechanical intent and needs human review.')
    if (/silk|text|legend/i.test(haystack)) add('move_or_shrink_silkscreen', 'low', 'silkscreen', 'Silkscreen/text violation found; move or shrink labels after placement review.')
  }
  if (!issues.length) {
    if (/clearance/i.test(text)) add('reroute_or_move_objects_for_clearance', 'medium', 'clearance', 'Clearance violation found in DRC report text.')
    if (/track|segment/i.test(text)) add('reroute_short_segment', 'medium', 'routing', 'Track/segment violation found in DRC report text.')
    if (/via/i.test(text)) add('resize_or_move_via_to_profile', 'medium', 'via', 'Via violation found in DRC report text.')
    if (/zone/i.test(text)) add('refill_or_rebuild_generated_zones', 'medium', 'zone_cleanup', 'Zone violation found in DRC report text; refill/rebuild is required before any zone deletion.')
    if (/edge|courtyard/i.test(text)) add('move_object_inside_edge_clearance', 'high', 'mechanical', 'Mechanical/courtyard violation found in DRC report text.')
  }
  const stitchPairs = dedupeRepairPairs(sameNetPairs).filter((pair) => pair.distanceMm <= maxSameNetRepairDistance(pair))
  if (stitchPairs.length) add('connect_short_same_net_unconnected_pairs', 'low', 'connectivity', 'Short same-net unconnected items can be stitched exactly from KiCad DRC evidence, then verified by DRC.', { autoSafe: true, pairs: stitchPairs })
  return repairs
}

function crossingRepairVictims(segments = []) {
  if (segments.length <= 1) return segments
  const keepScore = (segment = {}) => {
    const net = String(segment.net || '').toUpperCase()
    let score = 0
    if (/^(GND|AGND|DGND)$/.test(net)) score += 100
    if (/^USB_D[PN]$/.test(net)) score += 80
    if (/^(ETH|CAN)/.test(net)) score += 70
    if (/^(3V3|5V|VUSB|VBUS|VIN|VBAT)$/.test(net)) score += 45
    if (/^CC[12]$/.test(net)) score += 20
    return score
  }
  const sorted = [...segments].sort((a, b) => keepScore(a) - keepScore(b))
  return [sorted[0]]
}

function netFromDescription(description = '') {
  const net = String(description).match(/\[([^\]]+)\]/)?.[1] || null
  return net && net !== '<no net>' ? net : null
}

function sameNetUnconnectedPairs(issue = {}) {
  const items = (issue.items || [])
    .map((item) => ({
      description: item.description || '',
      net: netFromDescription(item.description),
      layer: layerFromDescription(item.description) || (/\bPTH pad\b/i.test(item.description || '') ? 'F.Cu' : null),
      pos: item.pos,
      isPad: /\bpad\b/i.test(item.description || ''),
      isPth: /\bPTH pad\b/i.test(item.description || ''),
      isTrack: /\bTrack\b/i.test(item.description || ''),
    }))
    .filter((item) => item.net && item.pos && Number.isFinite(Number(item.pos.x)) && Number.isFinite(Number(item.pos.y)))
  if (items.length < 2) return []
  const output = []
  for (let index = 1; index < items.length; index += 1) {
    const a = items[index - 1]
    const b = items[index]
    if (a.net !== b.net) continue
    const layer = chooseRepairLayer(a, b)
    if (!layer) continue
    const distanceMm = Math.hypot(Number(a.pos.x) - Number(b.pos.x), Number(a.pos.y) - Number(b.pos.y))
    output.push({
      net: a.net,
      layer,
      start: { x: roundCoord(a.pos.x), y: roundCoord(a.pos.y), layer: a.layer, isPad: a.isPad, isPth: a.isPth, isTrack: a.isTrack, description: a.description },
      end: { x: roundCoord(b.pos.x), y: roundCoord(b.pos.y), layer: b.layer, isPad: b.isPad, isPth: b.isPth, isTrack: b.isTrack, description: b.description },
      distanceMm: roundCoord(distanceMm),
    })
  }
  return output
}

function endpointGapBridgeRepairs(issue = {}) {
  const items = (issue.items || [])
    .map((item) => ({
      description: item.description || '',
      net: netFromDescription(item.description),
      layer: layerFromDescription(item.description) || (/\bPTH pad\b/i.test(item.description || '') ? 'F.Cu' : null),
      pos: item.pos && Number.isFinite(Number(item.pos.x)) && Number.isFinite(Number(item.pos.y))
        ? { x: roundCoord(item.pos.x), y: roundCoord(item.pos.y) }
        : null,
      uuid: item.uuid || null,
      isPad: /\bPad\b/i.test(item.description || ''),
      isTrack: /\bTrack\b/i.test(item.description || ''),
      isVia: /\bVia\b/i.test(item.description || ''),
    }))
    .filter((item) => item.net && item.pos)
  if (items.length < 2) return []
  const nets = new Set(items.map((item) => item.net))
  if (nets.size !== 1) return []
  const [net] = [...nets]
  const bridges = []

  if (/^USB_D[PN]$/i.test(net)) {
    if (/^USB_DN$/i.test(net)) {
      const u1Pad = items.find((item) => item.isPad && /\bU1\b/i.test(item.description || ''))
      const track = items.find((item) => item.isTrack && item.layer === 'F.Cu')
      if (u1Pad?.pos && track?.pos) {
        const laneX = track.pos.x + 1.3
        const path = removeDuplicateRepairPoints([
          u1Pad.pos,
          { x: u1Pad.pos.x - 1.2, y: u1Pad.pos.y },
          { x: u1Pad.pos.x - 1.2, y: track.pos.y + 5.3 },
          { x: laneX, y: track.pos.y + 5.3 },
          { x: laneX, y: track.pos.y },
          track.pos,
        ])
        bridges.push({
          kind: 'usb_dn_safe_endpoint_bridge',
          net,
          protectUuids: [track.uuid].filter(Boolean),
          segments: pathToRepairSegments(net, 'F.Cu', path, 0.127),
        })
      }
      const tracks = items.filter((item) => item.isTrack && item.layer === 'F.Cu')
      if (!bridges.length && tracks.length >= 2) {
        const [a, b] = farthestRepairItems(tracks)
        const left = a.pos.x <= b.pos.x ? a.pos : b.pos
        const right = a.pos.x <= b.pos.x ? b.pos : a.pos
        const laneY = Math.max(left.y, right.y) + 1.4
        const path = removeDuplicateRepairPoints([left, { x: left.x + 1.0, y: laneY }, { x: right.x, y: laneY }, right])
        bridges.push({
          kind: 'usb_dn_upper_lane_bridge',
          net,
          protectUuids: tracks.map((item) => item.uuid).filter(Boolean),
          segments: pathToRepairSegments(net, 'F.Cu', path, 0.127),
        })
      }
    }
    if (/^USB_DP$/i.test(net)) {
      const tracks = items.filter((item) => item.isTrack && item.layer === 'F.Cu')
      if (tracks.length >= 2) {
        const [a, b] = farthestRepairItems(tracks)
        const left = a.pos.x <= b.pos.x ? a.pos : b.pos
        const right = a.pos.x <= b.pos.x ? b.pos : a.pos
        const laneY = roundCoord(Math.max(left.y, right.y) + 2.5)
        bridges.push({
          kind: 'usb_dp_bottom_layer_continuation_bridge',
          net,
          protectUuids: tracks.map((item) => item.uuid).filter(Boolean),
          vias: [
            { net, at: left, layers: ['F.Cu', 'B.Cu'], size: 0.45, drill: 0.2 },
            { net, at: right, layers: ['F.Cu', 'B.Cu'], size: 0.45, drill: 0.2 },
          ],
          segments: pathToRepairSegments(net, 'B.Cu', removeDuplicateRepairPoints([
            left,
            { x: left.x, y: laneY },
            { x: right.x, y: laneY },
            right,
          ]), 0.127),
        })
      }
    }
  }

  if (/^CC1$/i.test(net)) {
    const pads = items.filter((item) => item.isPad && item.layer === 'F.Cu')
    if (pads.length >= 2) {
      const [a, b] = farthestRepairItems(pads)
      const left = a.pos.x <= b.pos.x ? a.pos : b.pos
      const right = a.pos.x <= b.pos.x ? b.pos : a.pos
      const laneX = Math.max(3.5, left.x - 2.1)
      const laneY = Math.max(left.y, right.y) + 2.4
      const path = removeDuplicateRepairPoints([
        left,
        { x: laneX, y: left.y },
        { x: laneX, y: laneY },
        { x: right.x, y: laneY },
        right,
      ])
      bridges.push({
        kind: 'cc1_left_escape_bridge',
        net,
        segments: pathToRepairSegments(net, 'F.Cu', path, 0.127),
      })
    }
    const pad = items.find((item) => item.isPad && item.layer === 'F.Cu')
    const track = items.find((item) => item.isTrack && item.layer === 'F.Cu')
    if (!bridges.length && pad?.pos && track?.pos) {
      const laneX = roundCoord(Math.min(pad.pos.x, track.pos.x) - 0.7)
      const laneY = roundCoord(Math.max(pad.pos.y, track.pos.y) + 3.7)
      bridges.push({
        kind: 'cc1_usb_avoidance_escape_bridge',
        net,
        segments: pathToRepairSegments(net, 'F.Cu', removeDuplicateRepairPoints([
          pad.pos,
          { x: pad.pos.x, y: laneY },
          { x: laneX, y: laneY },
          { x: laneX, y: track.pos.y },
          track.pos,
        ]), 0.127),
      })
    }
  }

  if (/^(3V3|5V|VUSB|VBUS|VIN)$/i.test(net)) {
    const pad = items.find((item) => item.isPad && item.layer === 'F.Cu')
    const tracks = items.filter((item) => item.isTrack && item.layer)
    const innerTrack = tracks.find((item) => /^In\d+\.Cu$/i.test(String(item.layer || '')))
    if (pad?.pos && innerTrack?.pos) {
      bridges.push({
        kind: 'power_front_pad_to_inner_rail_bridge',
        net,
        vias: [{ net, at: pad.pos, layers: ['F.Cu', 'B.Cu'], size: 0.5, drill: 0.25 }],
        segments: pathToRepairSegments(net, innerTrack.layer, [pad.pos, innerTrack.pos], repairSegmentWidth(net)),
      })
      return bridges
    }
    if (false && pad?.pos && tracks.length) {
      bridges.push({
        kind: 'power_pad_to_layer_cluster_bridge',
        net,
        vias: [{ net, at: pad.pos, layers: ['F.Cu', 'B.Cu'], size: 0.5, drill: 0.25 }],
        segments: tracks.flatMap((track) => pathToRepairSegments(net, track.layer, [pad.pos, track.pos], repairSegmentWidth(net))),
      })
      return bridges
    }
    if (tracks.length >= 2) {
      const [a, b] = farthestRepairItems(tracks)
      const layer = a.layer === b.layer ? a.layer : (a.layer || b.layer || 'F.Cu')
      if (/^3V3$/i.test(net) && /^B\.Cu$/i.test(layer)) {
        const laneX = roundCoord(Math.max(a.pos.x, b.pos.x) + 2.0)
        const laneY = roundCoord(Math.max(a.pos.y, b.pos.y) + 4.5)
        bridges.push({
          kind: 'low_voltage_outer_bottom_rail_bridge',
          net,
          segments: pathToRepairSegments(net, layer, removeDuplicateRepairPoints([
            a.pos,
            { x: a.pos.x, y: laneY },
            { x: laneX, y: laneY },
            { x: laneX, y: b.pos.y },
            b.pos,
          ]), repairSegmentWidth(net)),
        })
        return bridges
      }
      const viaSegments = a.layer === b.layer
        ? pathToRepairSegments(net, layer, repairPath({ ...a.pos, layer }, { ...b.pos, layer }, { net, layer }), repairSegmentWidth(net))
        : []
      if (viaSegments.length) bridges.push({
        kind: 'power_same_layer_track_bridge',
        net,
        segments: viaSegments,
      })
      if (!viaSegments.length && a.layer && b.layer) {
        const viaAt = a.layer === 'B.Cu' ? a.pos : b.pos
        const other = a.layer === 'B.Cu' ? b : a
        bridges.push({
          kind: 'power_through_via_layer_bridge',
          net,
          vias: [{ net, at: viaAt, layers: ['F.Cu', 'B.Cu'], size: 0.5, drill: 0.25 }],
          segments: pathToRepairSegments(net, other.layer, [viaAt, other.pos], repairSegmentWidth(net)),
        })
      }
    }
  }

  if (/^(GND|AGND|DGND)$/i.test(net)) {
    const front = items.find((item) => item.layer === 'F.Cu')
    const bottom = items.find((item) => item.layer === 'B.Cu')
    const pad = items.find((item) => item.isPad && item.layer === 'F.Cu')
    if (front?.pos && bottom?.pos && Math.hypot(front.pos.x - bottom.pos.x, front.pos.y - bottom.pos.y) <= 4) {
      const viaAt = front.pos
      bridges.push({
        kind: 'gnd_short_layer_join_bridge',
        net,
        vias: [{ net, at: viaAt, layers: ['F.Cu', 'B.Cu'], size: 0.5, drill: 0.25 }],
        segments: pathToRepairSegments(net, 'B.Cu', [viaAt, bottom.pos], 0.25),
      })
    } else if (pad?.pos && bottom?.pos && /\bC3\b/i.test(pad.description || '')) {
      const laneX = roundCoord(Math.min(Math.max(pad.pos.x, bottom.pos.x) + 2.5, pad.pos.x + 3.0))
      bridges.push({
        kind: 'gnd_c3_pad_to_bottom_rail_dogleg',
        net,
        vias: [{ net, at: pad.pos, layers: ['F.Cu', 'B.Cu'], size: 0.5, drill: 0.25 }],
        segments: [
          ...pathToRepairSegments(net, 'B.Cu', [pad.pos, { x: laneX, y: pad.pos.y }, { x: laneX, y: bottom.pos.y }, bottom.pos], 0.25),
        ],
      })
    }
  }

  if (/^(VUSB|VBUS|VIN|5V|3V3)$/i.test(net)) {
    const frontPad = items.find((item) => item.isPad && item.layer === 'F.Cu')
    const bottomTrack = items.find((item) => item.isTrack && item.layer === 'B.Cu')
    if (frontPad?.pos && bottomTrack?.pos) {
      const viaAt = {
        x: roundCoord(bottomTrack.pos.x + 0.75),
        y: roundCoord(bottomTrack.pos.y),
      }
      bridges.push({
        kind: 'power_front_pad_to_bottom_route_bridge',
        net,
        vias: [{ net, at: viaAt, layers: ['F.Cu', 'B.Cu'], size: repairViaDiameter(net), drill: repairViaDrill(net) }],
        segments: pathToRepairSegments(net, 'F.Cu', repairPath(
          { ...frontPad.pos, layer: frontPad.layer, isPad: true },
          { ...viaAt, layer: 'F.Cu', isVia: true },
          { net, layer: 'F.Cu', distanceMm: Math.hypot(frontPad.pos.x - viaAt.x, frontPad.pos.y - viaAt.y) },
        ), repairSegmentWidth(net)),
        ...(Math.hypot(viaAt.x - bottomTrack.pos.x, viaAt.y - bottomTrack.pos.y) >= 0.03
          ? { bottomSegments: [{ net, layer: 'B.Cu', width: repairSegmentWidth(net), start: viaAt, end: bottomTrack.pos }] }
          : {}),
      })
      if (bridges.at(-1).bottomSegments) bridges.at(-1).segments.push(...bridges.at(-1).bottomSegments)
    }
  }

  if (false && /^(GND|AGND|DGND)$/i.test(net)) {
    const d1Pad = items.find((item) => item.isPad && /\bD1\b/i.test(item.description || ''))
    const bottomTrack = items.find((item) => item.isTrack && item.layer === 'B.Cu')
    if (d1Pad?.pos && bottomTrack?.pos) {
      const join = {
        x: roundCoord(Math.min(d1Pad.pos.x, bottomTrack.pos.x) - 0.85),
        y: bottomTrack.pos.y,
      }
      bridges.push({
        kind: 'ground_pad_to_bottom_island',
        net,
        protectUuids: [bottomTrack.uuid].filter(Boolean),
        vias: [{ net, at: d1Pad.pos, layers: ['F.Cu', 'B.Cu'], size: 0.5, drill: 0.25 }],
        segments: [
          { net, layer: 'B.Cu', width: 0.2, start: d1Pad.pos, end: { x: d1Pad.pos.x, y: join.y } },
          { net, layer: 'B.Cu', width: 0.2, start: { x: d1Pad.pos.x, y: join.y }, end: join },
        ],
      })
    }

    const c3Pad = items.find((item) => item.isPad && /\bC3\b/i.test(item.description || ''))
    const orphanVia = items.find((item) => item.isVia)
    if (c3Pad?.pos && orphanVia?.pos) {
      const nearGroundPad = { x: roundCoord(orphanVia.pos.x - 0.9), y: orphanVia.pos.y }
      const laneX = roundCoord(Math.max(c3Pad.pos.x, nearGroundPad.x) + 2.55)
      bridges.push({
        kind: 'ground_capacitor_inner_layer_bridge',
        net,
        removeUuids: [orphanVia.uuid].filter(Boolean),
        removeShortStubNear: orphanVia.pos,
        vias: [
          { net, at: c3Pad.pos, layers: ['F.Cu', 'In2.Cu'], size: 0.5, drill: 0.25 },
          { net, at: nearGroundPad, layers: ['F.Cu', 'In2.Cu'], size: 0.5, drill: 0.25 },
        ],
        segments: [
          { net, layer: 'In2.Cu', width: 0.2, start: c3Pad.pos, end: { x: laneX, y: c3Pad.pos.y } },
          { net, layer: 'In2.Cu', width: 0.2, start: { x: laneX, y: c3Pad.pos.y }, end: { x: laneX, y: nearGroundPad.y } },
          { net, layer: 'In2.Cu', width: 0.2, start: { x: laneX, y: nearGroundPad.y }, end: nearGroundPad },
        ],
      })
    }
  }

  return bridges
}

function farthestRepairItems(items = []) {
  let best = [items[0], items[1]]
  let bestDistance = -1
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const distance = Math.hypot(items[a].pos.x - items[b].pos.x, items[a].pos.y - items[b].pos.y)
      if (distance > bestDistance) {
        bestDistance = distance
        best = [items[a], items[b]]
      }
    }
  }
  return best
}

function usbLongBridgePath(net, a, b) {
  const left = a.x <= b.x ? a : b
  const right = a.x <= b.x ? b : a
  if (/USB_DN/i.test(net)) {
    const laneX = roundCoord(Math.max(left.x, right.x) + 2.25)
    return removeDuplicateRepairPoints([
      { x: roundCoord(right.x), y: roundCoord(right.y) },
      { x: laneX, y: roundCoord(right.y) },
      { x: laneX, y: roundCoord(left.y) },
      { x: roundCoord(left.x), y: roundCoord(left.y) },
    ])
  }
  const laneY = roundCoord(Math.min(left.y, right.y) - 2.25)
  const entryX = roundCoord(Math.min(right.x - 1.5, Math.max(left.x + 1.0, 18.4)))
  return removeDuplicateRepairPoints([
    { x: roundCoord(left.x), y: roundCoord(left.y) },
    { x: entryX, y: roundCoord(left.y) },
    { x: entryX, y: laneY },
    { x: roundCoord(right.x - 1.5), y: laneY },
    { x: roundCoord(right.x - 1.5), y: roundCoord(right.y) },
    { x: roundCoord(right.x), y: roundCoord(right.y) },
  ])
}

function usbEndpointBridgePath(net, pad, track) {
  const start = { x: roundCoord(pad.x), y: roundCoord(pad.y) }
  const end = { x: roundCoord(track.x), y: roundCoord(track.y) }
  if (/USB_DN/i.test(net)) {
    const laneX = roundCoord(Math.min(start.x, end.x) + 2.35)
    const laneY = roundCoord(Math.max(start.y, end.y) + 1.65)
    return removeDuplicateRepairPoints([
      start,
      { x: start.x, y: laneY },
      { x: laneX, y: laneY },
      { x: laneX, y: end.y },
      end,
    ])
  }
  const laneY = roundCoord(Math.min(start.y, end.y) - 2.25)
  const laneX = roundCoord(Math.min(start.x, end.x) + 1.25)
  return removeDuplicateRepairPoints([
    start,
    { x: start.x, y: laneY },
    { x: laneX, y: laneY },
    { x: laneX, y: end.y },
    end,
  ])
}

function ccPulldownBridgePath(net, a, b) {
  const left = a.x <= b.x ? a : b
  const right = a.x <= b.x ? b : a
  const laneY = /^CC1$/i.test(net)
    ? roundCoord(Math.max(left.y, right.y) + 2.4)
    : roundCoord(Math.min(left.y, right.y) - 2.4)
  return removeDuplicateRepairPoints([
    { x: roundCoord(left.x), y: roundCoord(left.y) },
    { x: roundCoord(left.x), y: laneY },
    { x: roundCoord(right.x), y: laneY },
    { x: roundCoord(right.x), y: roundCoord(right.y) },
  ])
}

function pathToRepairSegments(net, layer, points = [], width) {
  const segments = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    if (Math.hypot(start.x - end.x, start.y - end.y) < 0.03) continue
    segments.push({ net, layer, width, start, end })
  }
  return segments
}

function chooseRepairLayer(a, b) {
  if (a.net && /^(GND|AGND|DGND)$/i.test(String(a.net || ''))) return 'In1.Cu'
  if (a.layer && b.layer && a.layer === b.layer) return a.layer
  if (a.net && /^USB_DP$/i.test(String(a.net || ''))) return 'In2.Cu'
  if (a.net && /^USB_DN$/i.test(String(a.net || ''))) return 'B.Cu'
  if (a.isTrack && b.isTrack && a.layer && b.layer) return a.layer === 'F.Cu' ? b.layer : a.layer
  if (a.isTrack && a.layer && b.isPad && !/B\.Cu/i.test(a.layer)) return a.layer
  if (b.isTrack && b.layer && a.isPad && !/B\.Cu/i.test(b.layer)) return b.layer
  if (a.isTrack && a.layer && b.isPad) return a.layer
  if (b.isTrack && b.layer && a.isPad) return b.layer
  if (a.isPad && b.isPad && (a.layer === 'F.Cu' || b.layer === 'F.Cu')) return 'F.Cu'
  if (a.isPad && b.isPad && (a.layer === 'B.Cu' || b.layer === 'B.Cu')) return 'B.Cu'
  return null
}

function maxSameNetRepairDistance(pair) {
  const sameLayer = String(pair.start?.layer || '') === String(pair.end?.layer || '')
  const trackToTrack = pair.start?.isTrack && pair.end?.isTrack
  const padToTrack = (pair.start?.isPad && pair.end?.isTrack) || (pair.start?.isTrack && pair.end?.isPad)
  if (/USB_D[PN]/i.test(String(pair.net || ''))) return sameLayer && (trackToTrack || padToTrack) ? 4.75 : sameLayer ? 0.65 : 0.35
  if (/^CC[12]$/i.test(String(pair.net || ''))) return sameLayer ? 0.8 : 0.45
  if (/^(GND|AGND|DGND)$/i.test(String(pair.net || ''))) return 0.75
  if (/^(VUSB|VBUS|VIN|5V|3V3)$/i.test(String(pair.net || ''))) return 0.65
  return 0.5
}

function dedupeRepairPairs(pairs = []) {
  const seen = new Set()
  return pairs.filter((pair) => {
    const key = `${pair.net}:${pair.layer}:${pair.start.x}:${pair.start.y}:${pair.end.x}:${pair.end.y}`
    const reverse = `${pair.net}:${pair.layer}:${pair.end.x}:${pair.end.y}:${pair.start.x}:${pair.start.y}`
    if (seen.has(key) || seen.has(reverse)) return false
    seen.add(key)
    return true
  })
}

function dedupeRepairItems(items = []) {
  const seen = new Set()
  return items.filter((item) => {
    const key = JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function layerFromDescription(description = '') {
  const match = String(description).match(/\bon\s+((?:[FB]|In\d+)\.Cu)\b/i)
  return match?.[1] || null
}

function refFromDescription(description = '') {
  const text = String(description || '')
  return text.match(/\b([A-Z]{1,3}\d+)\b/)?.[1] || null
}

function chooseRerouteVictim(items = [], issue = {}) {
  const text = `${issue.type || ''} ${issue.description || ''}`
  const sorted = [...items].sort((a, b) => victimScore(b.net, text) - victimScore(a.net, text))
  return sorted[0]
}

function victimScore(netName = '', issueText = '') {
  const net = String(netName).toUpperCase()
  let score = 10
  if (/^(EN|RESET|RST|BOOT|IO\d+|GPIO\d+|CC[12])$/.test(net)) score += 60
  if (/^(USB_DP|USB_DN|D\+|D-|ETH|CAN)/.test(net)) score += 20
  if (/^(3V3|5V|VUSB|VBUS|VIN|VCC|VDD)$/.test(net)) score -= 20
  if (/^(GND|AGND|DGND)$/.test(net)) score -= 40
  if (/shorting|tracks_crossing/i.test(issueText) && /^(EN|RESET|RST|BOOT|CC[12])$/.test(net)) score += 20
  return score
}

function rerouteRadiusFor(type = '', options = {}) {
  const base = Number(options.radiusMm || 0)
  if (base > 0) return base
  if (/shorting/i.test(type)) return 1.2
  if (/tracks_crossing/i.test(type)) return 0.9
  if (/clearance/i.test(type)) return 0.75
  return 0.6
}

function dedupeForbiddenPoints(points = []) {
  const seen = new Set()
  return points.filter((point) => {
    const key = `${point.net}:${point.layer}:${roundCoord(point.x)}:${roundCoord(point.y)}:${point.radiusMm}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function roundCoord(value) {
  return Math.round(Number(value || 0) * 1000) / 1000
}

function removeBoardforgeDanglingVias(pcb, repairPlan = {}) {
  const points = danglingViaPoints(repairPlan)
  if (!points.length || !/BoardForge review-required copper/.test(pcb)) return pcb
  let next = pcb
  for (const point of points) {
    const x = escapeNumber(point.x)
    const y = escapeNumber(point.y)
    next = next.replace(new RegExp(`\\n\\s*\\(via\\s+\\(at\\s+${x}\\s+${y}\\)[\\s\\S]*?\\n\\s*\\)`, 'g'), '')
  }
  return next
}

function removeGeneratedShortingVias(pcb, repairPlan = {}) {
  const points = repairPlan.autoApplicable?.filter((item) => item.action === 'remove_generated_shorting_vias').flatMap((item) => item.points || []) || []
  if (!points.length || !/BoardForge review-required copper/.test(pcb)) return pcb
  let next = pcb
  for (const point of points) {
    next = removeViaAndAttachedBottomSegments(next, point)
  }
  return next
}

function removeGeneratedShortingSegments(pcb, repairPlan = {}) {
  const segments = repairPlan.autoApplicable?.filter((item) => item.action === 'remove_generated_shorting_segments').flatMap((item) => item.segments || []) || []
  if (!segments.length || !/BoardForge review-required copper/.test(pcb)) return pcb
  let next = pcb
  for (const segment of segments) next = removeSegmentContainingPoint(next, segment)
  return next
}

function removeGeneratedDanglingSegments(pcb, repairPlan = {}) {
  const segments = repairPlan.autoApplicable?.filter((item) => item.action === 'remove_generated_dangling_segments').flatMap((item) => item.segments || []) || []
  if (!segments.length || !/BoardForge review-required copper/.test(pcb)) return pcb
  let next = pcb
  for (const segment of segments) next = removeSegmentContainingPoint(next, segment)
  return next
}

function removeGeneratedUnconnectedSegments(pcb, repairPlan = {}) {
  const segments = repairPlan.autoApplicable?.filter((item) => item.action === 'remove_generated_unconnected_segments').flatMap((item) => item.segments || []) || []
  if (!segments.length || !/BoardForge review-required copper/.test(pcb)) return pcb
  let next = pcb
  for (const segment of segments) next = removeSegmentContainingPoint(next, segment)
  return next
}

function removeGeneratedUnconnectedVias(pcb, repairPlan = {}) {
  const points = repairPlan.autoApplicable?.filter((item) => item.action === 'remove_generated_unconnected_vias').flatMap((item) => item.points || []) || []
  if (!points.length || !/BoardForge review-required copper/.test(pcb)) return pcb
  let next = pcb
  for (const point of points) next = removeViaAndAttachedBottomSegments(next, point)
  return next
}

function removeSegmentContainingPoint(pcb, segment = {}) {
  if (segment.uuid) {
    const byUuid = removeCopperBlockByUuid(pcb, segment.uuid)
    if (byUuid !== pcb) return byUuid
  }
  const px = Number(segment.x)
  const py = Number(segment.y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) return pcb
  const netName = String(segment.net || '')
  const layerName = String(segment.layer || '')
  const segmentPattern = /\n\s*\(segment[\s\S]*?\n\s*\)/g
  return pcb.replace(segmentPattern, (block) => {
    if (netName && !new RegExp(`\\(net\\s+(?:\\d+\\s+)?\"?${escapeRegex(netName)}\"?\\)`).test(block)) return block
    if (layerName && !new RegExp(`\\(layer\\s+"${escapeRegex(layerName)}"\\)`).test(block)) return block
    const start = block.match(/\(start\s+([-\d.]+)\s+([-\d.]+)\)/)
    const end = block.match(/\(end\s+([-\d.]+)\s+([-\d.]+)\)/)
    if (!start || !end) return block
    const a = { x: Number(start[1]), y: Number(start[2]) }
    const b = { x: Number(end[1]), y: Number(end[2]) }
    return pointOnSegment({ x: px, y: py }, a, b, 0.06) ? '' : block
  })
}

function removeViaAndAttachedBottomSegments(pcb, point) {
  if (point.uuid) {
    const byUuid = removeCopperBlockByUuid(pcb, point.uuid)
    if (byUuid !== pcb) pcb = byUuid
  }
  const x = escapeNumber(point.x)
  const y = escapeNumber(point.y)
  let next = pcb.replace(new RegExp(`\\n\\s*\\(via\\s+\\(at\\s+${x}\\s+${y}\\)[\\s\\S]*?\\n\\s*\\)`, 'g'), '')
  const segmentPattern = /\n\s*\(segment[\s\S]*?\n\s*\)/g
  next = next.replace(segmentPattern, (block) => {
    if (!/\(layer\s+"B\.Cu"\)/.test(block)) return block
    const touchesStart = new RegExp(`\\(start\\s+${x}\\s+${y}\\)`).test(block)
    const touchesEnd = new RegExp(`\\(end\\s+${x}\\s+${y}\\)`).test(block)
    return touchesStart || touchesEnd ? '' : block
  })
  return next
}

function removeGeneratedZones(pcb) {
  if (!/BoardForge review-required copper/.test(pcb)) return pcb
  return removeBalancedTopLevelBlocks(pcb, 'zone')
}

function removeBalancedTopLevelBlocks(content, token) {
  let output = ''
  let cursor = 0
  const pattern = new RegExp(`\\n\\s*\\(${token}(?=\\s|\\n)`, 'g')
  while (cursor < content.length) {
    pattern.lastIndex = cursor
    const match = pattern.exec(content)
    if (!match) {
      output += content.slice(cursor)
      break
    }
    const start = match.index
    output += content.slice(cursor, start)
    const blockStart = content.indexOf(`(${token}`, start)
    const end = findBalancedBlockEnd(content, blockStart)
    cursor = end >= 0 ? end + 1 : blockStart + token.length + 1
  }
  return output
}

function findBalancedBlockEnd(text, start) {
  let depth = 0
  let seenOpen = false
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '(') {
      depth += 1
      seenOpen = true
    } else if (text[index] === ')') {
      depth -= 1
      if (seenOpen && depth === 0) return index
    }
  }
  return -1
}

function applyEndpointGapBridges(pcb, repairPlan = {}) {
  const bridges = repairPlan.autoApplicable?.filter((item) => item.action === 'bridge_endpoint_gaps_from_drc_evidence').flatMap((item) => item.bridges || []) || []
  if (!bridges.length) return pcb
  let next = pcb
  const segments = []
  const vias = []
  for (const bridge of bridges) {
    if (bridge.removeUuids?.length) next = removeBlocksByUuid(next, bridge.removeUuids)
    if (bridge.removeShortStubNear) next = removeShortGndStubNear(next, bridge.removeShortStubNear)
    segments.push(...(bridge.segments || []))
    vias.push(...(bridge.vias || []))
  }
  return appendEndpointBridgeCopper(next, { segments, vias })
}

function appendEndpointBridgeCopper(pcb, { segments = [], vias = [] } = {}) {
  const viaLines = vias
    .filter((via) => via?.at && via?.net && Array.isArray(via.layers) && via.layers.length === 2)
    .map((via) => repairViaBlock(via.net, via.at, via.layers, via.size || repairViaDiameter(via.net), via.drill || repairViaDrill(via.net)))
  const segmentLines = segments
    .filter((segment) => segment?.start && segment?.end && segment?.net && segment?.layer)
    .filter((segment) => Math.hypot(Number(segment.start.x) - Number(segment.end.x), Number(segment.start.y) - Number(segment.end.y)) >= 0.03)
    .map((segment) => repairSegmentBlock(segment.net, segment.start, segment.end, segment.layer, segment.width || repairSegmentWidth(segment.net)))
  if (!viaLines.length && !segmentLines.length) return pcb
  const header = pcb.includes('BoardForge DRC endpoint bridge copper')
    ? ''
    : `  (gr_text "BoardForge DRC endpoint bridge copper: generated from pad/track DRC evidence; rerun DRC before export" (at 2 -10 0) (layer "Cmts.User")\n    (effects (font (size 1 1) (thickness 0.12))) (uuid "${crypto.randomUUID()}"))\n`
  return pcb.replace(/\)\s*$/, `${header}${[...viaLines, ...segmentLines].join('\n')}\n)\n`)
}

function removeBlocksByUuid(pcb, uuids = []) {
  let next = pcb
  for (const uuid of uuids.filter(Boolean)) next = removeCopperBlockByUuid(next, uuid)
  return next
}

function removeCopperBlockByUuid(pcb, uuid) {
  const index = pcb.indexOf(uuid)
  if (index < 0) return pcb
  const starts = [
    pcb.lastIndexOf('\n  (segment', index),
    pcb.lastIndexOf('\n\t(segment', index),
    pcb.lastIndexOf('\n  (via', index),
    pcb.lastIndexOf('\n\t(via', index),
  ].filter((value) => value >= 0)
  if (!starts.length) return pcb
  const start = Math.max(...starts)
  let depth = 0
  let seenOpen = false
  for (let cursor = start + 1; cursor < pcb.length; cursor += 1) {
    const char = pcb[cursor]
    if (char === '(') {
      depth += 1
      seenOpen = true
    } else if (char === ')') {
      depth -= 1
      if (seenOpen && depth === 0) return `${pcb.slice(0, start)}${pcb.slice(cursor + 1)}`
    }
  }
  return pcb
}

function removeShortGndStubNear(pcb, point = {}) {
  const px = Number(point.x)
  const py = Number(point.y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) return pcb
  const nearPoint = { x: roundCoord(px - 0.175), y: roundCoord(py) }
  const segmentPattern = /\n\s*\(segment[\s\S]*?\n\s*\)/g
  return pcb.replace(segmentPattern, (block) => {
    if (!/\(layer\s+"F\.Cu"\)/.test(block)) return block
    if (!/\(net\s+(?:\d+\s+)?"?GND"?\)/.test(block)) return block
    const start = block.match(/\(start\s+([-\d.]+)\s+([-\d.]+)\)/)
    const end = block.match(/\(end\s+([-\d.]+)\s+([-\d.]+)\)/)
    if (!start || !end) return block
    const a = { x: Number(start[1]), y: Number(start[2]) }
    const b = { x: Number(end[1]), y: Number(end[2]) }
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1.1) return block
    const touchesReportedVia = pointOnSegment({ x: px, y: py }, a, b, 0.06)
    const touchesNearbyStub = pointOnSegment(nearPoint, a, b, 0.06)
    return touchesReportedVia || touchesNearbyStub ? '' : block
  })
}

function appendSameNetRepairSegments(pcb, repairPlan = {}) {
  const pairs = repairPlan.autoApplicable?.filter((item) => item.action === 'connect_short_same_net_unconnected_pairs').flatMap((item) => item.pairs || []) || []
  if (!pairs.length) return pcb
  const segments = []
  const vias = []
  const viaKeys = new Set()
  for (const pair of pairs) {
    if (!Number.isFinite(Number(pair.start?.x)) || !Number.isFinite(Number(pair.start?.y)) || !Number.isFinite(Number(pair.end?.x)) || !Number.isFinite(Number(pair.end?.y))) continue
    const width = repairSegmentWidth(pair.net)
    const points = repairPath(pair.start, pair.end, pair)
    for (const endpoint of [pair.start, pair.end]) {
      if (needsEndpointVia(endpoint, pair.layer)) {
        const viaKey = `${pair.net}:${roundCoord(endpoint.x)}:${roundCoord(endpoint.y)}`
        if (!viaKeys.has(viaKey)) {
          viaKeys.add(viaKey)
          const [fromLayer, toLayer] = repairViaLayers(endpoint, pair.layer)
          vias.push(repairViaBlock(pair.net, endpoint, [fromLayer, toLayer], repairViaDiameter(pair.net), repairViaDrill(pair.net)))
        }
      }
    }
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]
      const b = points[index]
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.03) continue
      segments.push(repairSegmentBlock(pair.net, a, b, pair.layer, width))
    }
  }
  if (!segments.length && !vias.length) return pcb
  const header = pcb.includes('BoardForge DRC repair copper')
    ? ''
    : `  (gr_text "BoardForge DRC repair copper: generated from KiCad DRC unconnected_items; rerun DRC before export" (at 2 -8 0) (layer "Cmts.User")\n    (effects (font (size 1 1) (thickness 0.12))) (uuid "${crypto.randomUUID()}"))\n`
  return pcb.replace(/\)\s*$/, `${header}${[...vias, ...segments].join('\n')}\n)\n`)
}

function repairNetExpression(netName, pcb = '') {
  const safeName = String(netName || '').replace(/"/g, "'")
  return `(net "${safeName}")`
}

function repairSegmentBlock(net, start, end, layer, width) {
  return `\t(segment\n\t\t(start ${roundCoord(start.x)} ${roundCoord(start.y)})\n\t\t(end ${roundCoord(end.x)} ${roundCoord(end.y)})\n\t\t(width ${roundCoord(width)})\n\t\t(layer "${layer}")\n\t\t${repairNetExpression(net)}\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`
}

function repairViaBlock(net, at, layers, size, drill) {
  return `\t(via\n\t\t(at ${roundCoord(at.x)} ${roundCoord(at.y)})\n\t\t(size ${roundCoord(size)})\n\t\t(drill ${roundCoord(drill)})\n\t\t(layers "${layers[0]}" "${layers[1]}")\n\t\t${repairNetExpression(net)}\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`
}

function needsEndpointVia(endpoint = {}, routeLayer = '') {
  if (endpoint.isPth) return false
  const endpointLayer = String(endpoint.layer || '')
  if (!endpointLayer || !/\.Cu$/i.test(endpointLayer)) return false
  return endpointLayer !== routeLayer && (endpoint.isPad || endpoint.isTrack)
}

function repairViaLayers(endpoint = {}, routeLayer = '') {
  const endpointLayer = String(endpoint.layer || 'F.Cu')
  const targetLayer = String(routeLayer || endpointLayer)
  if (/\.Cu$/i.test(endpointLayer) && /\.Cu$/i.test(targetLayer) && endpointLayer !== targetLayer) {
    return [endpointLayer, targetLayer]
  }
  return ['F.Cu', 'B.Cu']
}

function repairViaDiameter(net) {
  if (/USB_D[PN]/i.test(String(net || ''))) return 0.45
  return 0.6
}

function repairViaDrill(net) {
  if (/USB_D[PN]/i.test(String(net || ''))) return 0.2
  return 0.3
}

function repairPath(start, end, pair = {}) {
  const a = { x: roundCoord(start.x), y: roundCoord(start.y) }
  const b = { x: roundCoord(end.x), y: roundCoord(end.y) }
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  if (String(start.layer || '') === String(end.layer || '') && Math.max(dx, dy) <= 1.5) return [a, b]
  if (start.isTrack && end.isTrack && dx <= 0.03 && dy <= 0.03) return [a, b]
  if (/USB_DP/i.test(String(pair.net || '')) && String(start.layer || '') === String(end.layer || '') && pair.distanceMm <= 4.5) {
    const xLane = roundCoord(Math.min(a.x, b.x) - 1.05)
    const yLane = roundCoord(Math.max(a.y, b.y) + 1.05)
    return removeDuplicateRepairPoints([a, { x: a.x, y: yLane }, { x: xLane, y: yLane }, { x: xLane, y: b.y }, b])
  }
  if (/USB_DN/i.test(String(pair.net || '')) && String(start.layer || '') === String(end.layer || '') && pair.distanceMm <= 4.5) {
    const yLane = roundCoord(Math.min(a.y, b.y) - 0.8)
    return removeDuplicateRepairPoints([a, { x: a.x, y: yLane }, { x: b.x, y: yLane }, b])
  }
  if (/USB_D[PN]/i.test(String(pair.net || '')) && String(start.layer || '') === String(end.layer || '')) {
    return removeDuplicateRepairPoints([a, { x: b.x, y: a.y }, b])
  }
  if (/USB_D[PN]/i.test(String(pair.net || '')) && dx > 0.25 && dy > 0.25) {
    const yLane = roundCoord(Math.min(a.y, b.y) - 0.65)
    return removeDuplicateRepairPoints([a, { x: a.x, y: yLane }, { x: b.x, y: yLane }, b])
  }
  if (dx < 0.001 || dy < 0.001 || Math.abs(dx - dy) < 0.001) return [a, b]
  if (/^(GND|AGND|DGND)$/i.test(String(pair.net || ''))) {
    const dogleg = { x: a.x, y: b.y }
    return [a, dogleg, b]
  }
  const dogleg = dx >= dy ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
  return [a, dogleg, b]
}

function removeDuplicateRepairPoints(points = []) {
  return points.filter((point, index, list) => index === 0 || Math.hypot(point.x - list[index - 1].x, point.y - list[index - 1].y) > 0.02)
}

function removeDuplicateCopperBlocks(pcb) {
  let next = removeDuplicateBlocks(pcb, /\n\s*\(via[\s\S]*?\n\s*\)/g, viaBlockKey)
  next = removeDuplicateBlocks(next, /\n\s*\(segment[\s\S]*?\n\s*\)/g, segmentBlockKey)
  return next
}

function removeCoLocatedGeneratedVias(pcb) {
  if (!/BoardForge review-required copper/.test(pcb)) return pcb
  const seen = new Set()
  return pcb.replace(/\n\s*\(via[\s\S]*?\n\s*\)/g, (block) => {
    const at = block.match(/\(at\s+([-\d.]+)\s+([-\d.]+)\)/)
    const layers = block.match(/\(layers\s+"([^"]+)"\s+"([^"]+)"\)/)
    const net = block.match(/\(net\s+(?:\d+\s+)?"?([^")]+)"?\)/)
    if (!at || !layers || !net) return block
    const key = `via-at:${roundCoord(at[1])}:${roundCoord(at[2])}:${layers[1]}:${layers[2]}:${net[1]}`
    if (seen.has(key)) return ''
    seen.add(key)
    return block
  })
}

function removeDuplicateBlocks(text, pattern, keyForBlock) {
  const seen = new Set()
  return text.replace(pattern, (block) => {
    const key = keyForBlock(block)
    if (!key) return block
    if (seen.has(key)) return ''
    seen.add(key)
    return block
  })
}

function viaBlockKey(block) {
  const at = block.match(/\(at\s+([-\d.]+)\s+([-\d.]+)\)/)
  const size = block.match(/\(size\s+([-\d.]+)\)/)
  const drill = block.match(/\(drill\s+([-\d.]+)\)/)
  const layers = block.match(/\(layers\s+"([^"]+)"\s+"([^"]+)"\)/)
  const net = block.match(/\(net\s+(?:\d+\s+)?"?([^")]+)"?\)/)
  if (!at || !layers || !net) return null
  return `via:${roundCoord(at[1])}:${roundCoord(at[2])}:${roundCoord(size?.[1] || 0)}:${roundCoord(drill?.[1] || 0)}:${layers[1]}:${layers[2]}:${net[1]}`
}

function segmentBlockKey(block) {
  const start = block.match(/\(start\s+([-\d.]+)\s+([-\d.]+)\)/)
  const end = block.match(/\(end\s+([-\d.]+)\s+([-\d.]+)\)/)
  const width = block.match(/\(width\s+([-\d.]+)\)/)
  const layer = block.match(/\(layer\s+"([^"]+)"\)/)
  const net = block.match(/\(net\s+(?:\d+\s+)?"?([^")]+)"?\)/)
  if (!start || !end || !layer || !net) return null
  const a = `${roundCoord(start[1])},${roundCoord(start[2])}`
  const b = `${roundCoord(end[1])},${roundCoord(end[2])}`
  const endpoints = [a, b].sort().join('|')
  return `segment:${endpoints}:${roundCoord(width?.[1] || 0)}:${layer[1]}:${net[1]}`
}

function repairSegmentWidth(net) {
  if (/^(GND|AGND|DGND)$/i.test(String(net || ''))) return 0.25
  if (/^(VUSB|VBUS|VIN|5V|3V3)$/i.test(String(net || ''))) return 0.25
  if (/USB_D[PN]/i.test(String(net || ''))) return 0.127
  return 0.15
}

function generatedViaPoints(issue = {}) {
  return (issue.items || [])
    .filter((item) => /Via \[[^\]]+\]/i.test(item.description || '') && item.pos)
    .map((item) => ({
      x: roundCoord(item.pos.x),
      y: roundCoord(item.pos.y),
      net: netFromDescription(item.description),
      layer: layerFromDescription(item.description),
      description: item.description,
      uuid: item.uuid,
    }))
    .filter((item) => item.net)
}

function generatedTrackSegments(issue = {}) {
  return (issue.items || [])
    .filter((item) => /Track \[[^\]]+\]/i.test(item.description || '') && item.pos)
    .map((item) => ({
      x: roundCoord(item.pos.x),
      y: roundCoord(item.pos.y),
      net: netFromDescription(item.description),
      layer: layerFromDescription(item.description),
      description: item.description,
      uuid: item.uuid,
    }))
    .filter((item) => item.net && item.layer)
}

function danglingViaPoints(repairPlan = {}) {
  const points = []
  visit(repairPlan, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const text = `${value.type || ''} ${value.description || ''}`.toLowerCase()
    if (!text.includes('via') || !text.includes('dangling')) return
    for (const item of value.items || []) {
      if (/Via/i.test(item.description || '') && item.pos) points.push(item.pos)
    }
  })
  return points
}

function escapeNumber(value) {
  return String(Number(value)).replace('.', '\\.')
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pointOnSegment(point, start, end, tolerance = 0.03) {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (!length) return Math.hypot(point.x - start.x, point.y - start.y) <= tolerance
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)))
  const closest = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
  return Math.hypot(point.x - closest.x, point.y - closest.y) <= tolerance
}

function extractDrcIssues(report) {
  const issues = []
  visit(report, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const keys = Object.keys(value)
    const looksLikeIssue = keys.some((key) => /severity|description|message|type|violat|items|rule/i.test(key))
      && JSON.stringify(value).length < 5000
      && /error|warning|violat|clearance|track|via|zone|edge|courtyard|silk/i.test(JSON.stringify(value))
    if (looksLikeIssue) issues.push(value)
  })
  return uniqueIssues(issues)
}

function visit(value, fn) {
  fn(value)
  if (Array.isArray(value)) {
    for (const item of value) visit(item, fn)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) visit(item, fn)
  }
}

function uniqueIssues(issues) {
  const seen = new Set()
  return issues.filter((issue) => {
    const key = JSON.stringify(issue)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function scanPcbForRepairCandidates(pcbFile) {
  try {
    const pcb = await readFile(pcbFile, 'utf8')
    const zeroLengthSegments = [...pcb.matchAll(/\(segment\s+\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+\1\s+\2\)/g)].length
    const boardforgeZones = /BoardForge review-required copper/.test(pcb) ? [...pcb.matchAll(/\(zone\s/g)].length : 0
    return { zeroLengthSegments, boardforgeZones }
  } catch {
    return { zeroLengthSegments: 0, boardforgeZones: 0 }
  }
}

function severityCounts(issues) {
  const counts = { errors: 0, warnings: 0, other: 0 }
  for (const issue of issues) {
    const severity = String(issue.severity || issue.kind || '').toLowerCase()
    if (severity.includes('error')) counts.errors += 1
    else if (severity.includes('warning')) counts.warnings += 1
    else counts.other += 1
  }
  return counts
}

function nextJobsFor(repairs) {
  const jobs = []
  if (repairs.some((item) => item.category === 'clearance' || item.category === 'routing')) jobs.push('generate_routing_plan', 'apply_routing_plan')
  if (repairs.some((item) => item.category === 'via')) jobs.push('validate_routing_geometry')
  if (repairs.some((item) => item.category === 'zone_cleanup')) jobs.push('add_ground_zone')
  if (repairs.some((item) => item.category === 'mechanical' || item.action === 'reroute_or_move_objects_for_clearance')) jobs.push('optimize_placement', 'apply_placement_plan', 'run_dfm_checks')
  if (repairs.some((item) => item.category === 'silkscreen')) jobs.push('run_dfm_checks')
  jobs.push('run_kicad_drc')
  return [...new Set(jobs)]
}

function summarizeRepairPlan(repairPlan = {}) {
  return {
    status: repairPlan.status,
    issueCount: repairPlan.issueCount,
    autoApplicableCount: repairPlan.autoApplicable?.length || 0,
    blockerCount: repairPlan.blockers?.length || 0,
    repairs: (repairPlan.repairs || []).map((item) => ({
      action: item.action,
      category: item.category,
      risk: item.risk,
      autoSafe: Boolean(item.autoSafe),
    })),
  }
}

function oneConnectivityRepairAtATime(repairPlan = {}, rejectedRepairKeys = new Set()) {
  const autoApplicable = repairPlan.autoApplicable || []
  const connectivity = autoApplicable.filter((item) => item.action === 'connect_short_same_net_unconnected_pairs' && item.pairs?.length)
  if (!connectivity.length) return repairPlan
  const shortestPair = connectivity
    .flatMap((item) => item.pairs || [])
    .filter((pair) => !rejectedRepairKeys.has(repairPairKey(pair)))
    .filter((pair) => Number.isFinite(Number(pair.distanceMm)))
    .sort((a, b) => Number(a.distanceMm) - Number(b.distanceMm))[0]
  if (!shortestPair) {
    return {
      ...repairPlan,
      autoApplicable: autoApplicable.filter((item) => item.action !== 'connect_short_same_net_unconnected_pairs'),
    }
  }
  return {
    ...repairPlan,
    selectedRepairKey: repairPairKey(shortestPair),
    autoApplicable: [
      ...autoApplicable.filter((item) => item.action !== 'connect_short_same_net_unconnected_pairs'),
      {
        action: 'connect_short_same_net_unconnected_pairs',
        risk: 'low',
        category: 'connectivity',
        reason: 'Apply the shortest DRC-proven same-net stitch first, then rerun DRC before attempting the next stitch.',
        autoSafe: true,
        pairs: [shortestPair],
      },
    ],
  }
}

function repairPairKey(pair = {}) {
  return `${pair.net}:${pair.layer}:${pair.start?.x}:${pair.start?.y}:${pair.end?.x}:${pair.end?.y}`
}

function normalizeIssueCounts(report = {}) {
  return {
    errors: Number(report?.issueCounts?.errors ?? report?.violations?.length ?? 0),
    warnings: Number(report?.issueCounts?.warnings ?? report?.unconnected_items?.length ?? 0),
  }
}

function drcIssueScore(report = {}) {
  const body = report?.report || report || {}
  const issues = [...(body.violations || []), ...(body.unconnected_items || [])]
  let score = 0
  for (const issue of issues) {
    const type = String(issue.type || '').toLowerCase()
    const severity = String(issue.severity || '').toLowerCase()
    if (type.includes('short')) score += 120
    else if (type.includes('crossing')) score += 80
    else if (type.includes('clearance')) score += 70
    else if (type.includes('unconnected')) score += 25
    else if (type.includes('dangling')) score += 12
    else if (severity.includes('error')) score += 40
    else if (severity.includes('warning')) score += 4
    else score += 1
  }
  const counts = normalizeIssueCounts(report)
  return score + counts.errors * 5 + counts.warnings
}

function classifyRemainingBlockers(report = {}) {
  const body = report?.report || report || {}
  return [...(body?.violations || []), ...(body?.unconnected_items || [])].slice(0, 80).map((issue) => ({
    type: issue.type || 'unknown',
    description: issue.description || issue.message || '',
    items: (issue.items || []).map((item) => item.description || item.uuid || '').filter(Boolean).slice(0, 5),
  }))
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}
