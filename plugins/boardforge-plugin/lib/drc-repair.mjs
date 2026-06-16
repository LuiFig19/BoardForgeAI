import { readFile, writeFile } from 'node:fs/promises'

export async function planDrcRepairs({ reportFile, pcbFile, profile = {}, state = null }) {
  const report = await readJson(reportFile)
  const issues = extractDrcIssues(report)
  const text = JSON.stringify(report || {})
  const repairs = classifyRepairs(issues, text, profile)
  const pcbStats = await scanPcbForRepairCandidates(pcbFile)
  if (pcbStats.zeroLengthSegments) repairs.push({ action: 'remove_zero_length_segments', risk: 'low', category: 'copper_cleanup', reason: `${pcbStats.zeroLengthSegments} zero-length segments found in PCB text.`, autoSafe: true })
  if (pcbStats.boardforgeZones && /zone|copper pour|fill/i.test(text)) repairs.push({ action: 'remove_generated_zones_for_refill', risk: 'low', category: 'zone_cleanup', reason: 'Generated copper zones can be removed and regenerated with updated keepouts.', autoSafe: true })
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
    blockers,
    autoApplicable,
    nextJobs: nextJobsFor(repairs),
    stateContext: state ? { status: state.status, projectName: state.projectName, routingStatus: state.routing?.status || null } : null,
    humanReviewRequired: true,
  }
}

export async function applySafeDrcRepairs({ pcbFile, repairPlan }) {
  let pcb = await readFile(pcbFile, 'utf8')
  let applied = 0
  if (repairPlan.autoApplicable?.some((item) => item.action === 'remove_generated_zones_for_refill' || item.action === 'rebuild_zone_with_keepouts')) {
    pcb = pcb.replace(/\(zone[\s\S]*?\n\s*\)\n/g, '')
    applied += 1
  }
  if (repairPlan.autoApplicable?.some((item) => item.action === 'remove_zero_length_segments')) {
    const before = pcb
    pcb = pcb.replace(/^\s*\(segment\s+\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+\1\s+\2\)[^\n]*\n/gm, '')
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

function classifyRepairs(issues, text, profile) {
  const repairs = []
  const add = (action, risk, category, reason, extra = {}) => {
    if (!repairs.some((item) => item.action === action && item.category === category)) repairs.push({ action, risk, category, reason, ...extra })
  }
  for (const issue of issues) {
    const haystack = `${issue.type || ''} ${issue.description || ''} ${issue.message || ''} ${issue.name || ''}`
    if (/clearance|courtyard overlap|collision/i.test(haystack)) add('reroute_or_move_objects_for_clearance', 'medium', 'clearance', 'Clearance/collision violation found; BoardForge should reroute or move objects, then rerun DRC.')
    if (/track width|trace width|width/i.test(haystack)) add('increase_route_width_to_profile', 'medium', 'routing_width', `Route width violation found; enforce at least ${profile.minTraceWidthMm || 'profile'} mm where applicable.`)
    if (/via.*diameter|annular|drill|hole/i.test(haystack)) add('resize_or_move_via_to_profile', 'medium', 'via', `Via/drill issue found; enforce diameter ${profile.minViaDiameterMm || 'profile'} mm and drill ${profile.minViaDrillMm || 'profile'} mm.`)
    if (/zone|copper pour|fill/i.test(haystack)) add('remove_generated_zones_for_refill', 'low', 'zone_cleanup', 'Zone issue found; generated pours can be removed and regenerated after route/keepout fixes.', { autoSafe: true })
    if (/edge|board edge|outline/i.test(haystack)) add('move_object_inside_edge_clearance', 'high', 'mechanical', 'Board-edge violation found; moving objects may affect mechanical intent and needs human review.')
    if (/silk|text|legend/i.test(haystack)) add('move_or_shrink_silkscreen', 'low', 'silkscreen', 'Silkscreen/text violation found; move or shrink labels after placement review.')
  }
  if (!issues.length) {
    if (/clearance/i.test(text)) add('reroute_or_move_objects_for_clearance', 'medium', 'clearance', 'Clearance violation found in DRC report text.')
    if (/track|segment/i.test(text)) add('reroute_short_segment', 'medium', 'routing', 'Track/segment violation found in DRC report text.')
    if (/via/i.test(text)) add('resize_or_move_via_to_profile', 'medium', 'via', 'Via violation found in DRC report text.')
    if (/zone/i.test(text)) add('remove_generated_zones_for_refill', 'low', 'zone_cleanup', 'Zone violation found in DRC report text.', { autoSafe: true })
    if (/edge|courtyard/i.test(text)) add('move_object_inside_edge_clearance', 'high', 'mechanical', 'Mechanical/courtyard violation found in DRC report text.')
  }
  return repairs
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
  if (repairs.some((item) => item.category === 'mechanical')) jobs.push('optimize_placement', 'run_dfm_checks')
  jobs.push('run_kicad_drc')
  return [...new Set(jobs)]
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}
