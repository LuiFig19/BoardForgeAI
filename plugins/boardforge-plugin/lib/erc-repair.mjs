import { readFile, writeFile } from 'node:fs/promises'

export async function planErcRepairs({ reportFile, schFile, state = null }) {
  const report = await readJson(reportFile)
  const schematicText = await readText(schFile)
  const issues = extractErcIssues(report)
  const repairs = classifyRepairs(issues, JSON.stringify(report || {}), schematicText, state)
  const schematicStats = inspectSchematic(schematicText)
  const blockers = repairs.filter((item) => item.risk === 'high')
  return {
    status: repairs.length ? 'ERC_REPAIR_PLAN_READY_NEEDS_REVIEW' : 'ERC_REPAIR_NO_ACTIONS_FOUND',
    reportFile,
    schFile,
    reportParsed: Boolean(report),
    issueCount: issues.length,
    severityCounts: severityCounts(issues),
    schematicStats,
    repairs,
    blockers,
    autoApplicable: repairs.filter((item) => item.autoSafe),
    nextJobs: nextJobsFor(repairs),
    stateContext: state ? { status: state.status, projectName: state.projectName, schematicStatus: state.schematic?.status || null } : null,
    humanReviewRequired: true,
  }
}

export async function applySafeErcRepairs({ schFile, repairPlan }) {
  let schematic = await readFile(schFile, 'utf8')
  let applied = 0
  if (repairPlan.autoApplicable?.some((item) => item.action === 'add_boardforge_erc_review_note') && !schematic.includes('BoardForge ERC repair review required')) {
    schematic = schematic.replace(/\(comment 1 "([^"]*)"\)/, '(comment 1 "$1")\n\t\t(comment 2 "BoardForge ERC repair review required")')
    applied += 1
  }
  await writeFile(schFile, schematic, 'utf8')
  return {
    status: applied ? 'SAFE_ERC_REPAIRS_APPLIED_RERUN_ERC' : 'NO_SAFE_ERC_REPAIRS_APPLIED',
    applied,
    schFile,
    humanReviewRequired: true,
  }
}

function classifyRepairs(issues, text, schematicText, state) {
  const repairs = []
  const add = (action, risk, category, reason, extra = {}) => {
    if (!repairs.some((item) => item.action === action && item.category === category)) repairs.push({ action, risk, category, reason, ...extra })
  }
  for (const issue of issues) {
    const haystack = `${issue.type || ''} ${issue.description || ''} ${issue.message || ''} ${issue.name || ''} ${issue.severity || ''}`
    if (/unconnected|not connected|no connect|dangling/i.test(haystack)) add('review_unconnected_pins_or_add_no_connect', 'high', 'connectivity', 'ERC found unconnected pins. BoardForge must decide whether to connect them or add explicit no-connect markers after review.')
    if (/power.*input|input.*power|not driven|no driver|power flag/i.test(haystack)) add('add_power_driver_or_power_flag', 'high', 'power_integrity', 'ERC found an undriven power net. Add a regulator/source symbol or reviewed power flag.')
    if (/duplicate|reference|annotat/i.test(haystack)) add('reannotate_duplicate_references', 'medium', 'annotation', 'ERC found duplicate or bad references. Reannotate before BOM/export.')
    if (/pin.*type|output.*output|conflict/i.test(haystack)) add('fix_pin_type_conflict', 'high', 'pin_type', 'ERC found pin type conflicts. Fix symbol/pin-map intent, not just labels.')
    if (/footprint|symbol|library/i.test(haystack)) add('resolve_missing_symbol_or_footprint', 'medium', 'library_binding', 'ERC/library issue found. Resolve component assets and validate bindings.')
  }
  if (!issues.length) {
    if (/unconnected|not connected|dangling/i.test(text)) add('review_unconnected_pins_or_add_no_connect', 'high', 'connectivity', 'Unconnected pins appear in ERC report text.')
    if (/power|driver|flag/i.test(text)) add('add_power_driver_or_power_flag', 'high', 'power_integrity', 'Power-driver issue appears in ERC report text.')
    if (/duplicate|reference|annotat/i.test(text)) add('reannotate_duplicate_references', 'medium', 'annotation', 'Reference/annotation issue appears in ERC report text.')
  }
  const duplicateRefs = duplicateReferences(schematicText)
  if (duplicateRefs.length) add('reannotate_duplicate_references', 'medium', 'annotation', `Duplicate schematic references found: ${duplicateRefs.join(', ')}.`)
  if (state?.components?.some((component) => !component.symbol || !component.footprint)) add('resolve_missing_symbol_or_footprint', 'medium', 'library_binding', 'Project state has components without complete symbol/footprint bindings.')
  if (repairs.length) add('add_boardforge_erc_review_note', 'low', 'metadata', 'Add an ERC review note to the schematic title block.', { autoSafe: true })
  return repairs
}

function extractErcIssues(report) {
  const issues = []
  visit(report, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const text = JSON.stringify(value)
    const looksLikeIssue = text.length < 5000 && /severity|error|warning|erc|unconnected|power|pin|duplicate|symbol|footprint|driver/i.test(text)
    if (looksLikeIssue && Object.keys(value).some((key) => /severity|description|message|type|violat|rule|items/i.test(key))) issues.push(value)
  })
  return uniqueIssues(issues)
}

function inspectSchematic(text) {
  return {
    symbols: [...text.matchAll(/\(symbol\s/g)].length,
    labels: [...text.matchAll(/\((global_label|label)\s/g)].length,
    duplicateReferences: duplicateReferences(text),
    hasBoardForgeReviewNote: text.includes('BoardForge ERC repair review required'),
  }
}

function duplicateReferences(text) {
  const refs = [...text.matchAll(/\(property\s+"Reference"\s+"([^"]+)"/g)].map((match) => match[1]).filter(Boolean)
  const seen = new Set()
  const duplicates = new Set()
  for (const ref of refs) {
    if (seen.has(ref)) duplicates.add(ref)
    seen.add(ref)
  }
  return [...duplicates]
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
  if (repairs.some((item) => item.category === 'library_binding')) jobs.push('resolve_component_assets', 'validate_component_bindings', 'generate_schematic')
  if (repairs.some((item) => item.category === 'annotation')) jobs.push('generate_schematic')
  if (repairs.some((item) => item.category === 'connectivity' || item.category === 'power_integrity' || item.category === 'pin_type')) jobs.push('generate_netlist', 'generate_schematic')
  jobs.push('run_kicad_erc')
  return [...new Set(jobs)]
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function readText(file) {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return ''
  }
}
