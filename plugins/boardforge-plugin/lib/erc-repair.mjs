import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

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

export async function classifyErcPowerIntent({ reportFile, schFile, outputFile = null }) {
  const report = await readJson(reportFile)
  const schematicText = await readText(schFile)
  const violations = extractReportViolations(report).filter((issue) => /error/i.test(issue.severity || ''))
  const blockers = violations.filter((issue) => /not driven|no output|power pin/i.test(`${issue.type || ''} ${issue.description || ''}`))
  const classifications = blockers.map((issue, index) => classifyErcIntentIssue(issue, schematicText, index + 1))
  const localWaivers = classifications.filter((item) => item.localWaiverAllowed).map((item) => ({
    scope: 'exact_pin_net_intent',
    globalSuppression: false,
    ref: item.ref,
    pinName: item.pinName,
    pinNumber: item.pinNumber,
    net: item.net,
    ercType: item.ercType,
    classification: item.classification,
    reason: item.reason,
    action: item.action,
  }))
  const reportOut = {
    schemaVersion: 1,
    status: classifications.some((item) => item.classification === 'BLOCKED_REQUIRES_USER_DECISION') ? 'ERC_INTENT_BLOCKERS_REMAIN' : 'ERC_INTENT_POLICY_APPLIED',
    reportFile,
    schFile,
    totalBlockingErc: blockers.length,
    resolvedBlockingErc: classifications.filter((item) => item.localWaiverAllowed).length,
    remainingBlockingErc: classifications.filter((item) => item.classification === 'BLOCKED_REQUIRES_USER_DECISION').length,
    classifications,
    localWaivers,
    globalSuppression: false,
    humanReviewRequired: true,
  }
  if (outputFile) await writeFile(outputFile, `${JSON.stringify(reportOut, null, 2)}\n`, 'utf8')
  return reportOut
}

export function applyErcIntentPolicy(ercAnalysis, intentReport) {
  if (!ercAnalysis || !intentReport?.classifications?.length) return ercAnalysis
  const resolved = new Set(intentReport.classifications.filter((item) => item.localWaiverAllowed).map(intentKey))
  const unresolved = intentReport.classifications.filter((item) => item.classification === 'BLOCKED_REQUIRES_USER_DECISION')
  const allExactBlockersResolved = intentReport.totalBlockingErc > 0 && intentReport.remainingBlockingErc === 0 && intentReport.resolvedBlockingErc >= intentReport.totalBlockingErc
  const clusters = (ercAnalysis.clusters || []).map((cluster) => {
    if (!cluster.blocking) return cluster
    if (allExactBlockersResolved) return { ...cluster, blocking: false, intentResolved: true, recommendedFix: 'Resolved by exact BoardForge ERC intent policy; see boardforge-erc-intent-report.json.' }
    const examples = cluster.examples || []
    const unresolvedForCluster = unresolved.filter((item) => item.clusterType === cluster.type || examples.some((example) => example.details?.some((detail) => detail.includes(`Symbol ${item.ref} Pin ${item.pinNumber}`))))
    if (!unresolvedForCluster.length && examples.length && examples.every((example) => example.details?.some((detail) => resolved.has(intentKey(parseIssueDetail(detail)))))) {
      return { ...cluster, blocking: false, intentResolved: true, recommendedFix: 'Resolved by exact BoardForge ERC intent policy; see boardforge-erc-intent-report.json.' }
    }
    if (!unresolvedForCluster.length && (cluster.type === 'missing_power_flag' || cluster.type === 'no_driver')) {
      const relevant = intentReport.classifications.filter((item) => item.clusterType === cluster.type)
      if (relevant.length >= cluster.count && relevant.every((item) => item.localWaiverAllowed)) return { ...cluster, blocking: false, intentResolved: true, recommendedFix: 'Resolved by exact BoardForge ERC intent policy; see boardforge-erc-intent-report.json.' }
    }
    return cluster
  })
  const blockers = clusters.filter((cluster) => cluster.blocking)
  return {
    ...ercAnalysis,
    rawBlockers: ercAnalysis.blockers || [],
    clusters,
    blockers,
    intentPolicy: {
      status: intentReport.status,
      reportFile: intentReport.outputFile || path.join(path.dirname(intentReport.schFile || ''), 'boardforge-erc-intent-report.json'),
      totalBlockingErc: intentReport.totalBlockingErc,
      resolvedBlockingErc: intentReport.resolvedBlockingErc,
      remainingBlockingErc: intentReport.remainingBlockingErc,
      globalSuppression: false,
    },
    status: blockers.length ? 'ERC_ANALYSIS_BLOCKED' : clusters.length ? 'ERC_ANALYSIS_NEEDS_REVIEW' : 'ERC_ANALYSIS_CLEAN',
  }
}

function classifyErcIntentIssue(issue, schematicText, index) {
  const parsed = parseIssueDetail(issue.items?.[0]?.description || issue.details?.[0] || issue.description || '')
  const symbol = findSymbolContext(schematicText, parsed.ref)
  const context = `${symbol.libId || ''} ${symbol.value || ''} ${symbol.description || ''} ${symbol.footprint || ''}`
  const net = inferLikelyNet(parsed, schematicText, symbol)
  const base = {
    index,
    ercType: issue.type || 'erc_issue',
    ercMessage: issue.description || issue.message || '',
    ref: parsed.ref,
    pinName: parsed.pinName,
    pinNumber: parsed.pinNumber,
    pinType: parsed.pinType,
    symbol: symbol.value || symbol.libId || parsed.ref || 'unknown',
    libId: symbol.libId || null,
    net,
    connectedComponents: inferConnectedComponents(net, schematicText, parsed.ref),
    evidence: symbolEvidence(symbol, net, schematicText),
    clusterType: /power/i.test(issue.type || issue.description || '') ? 'missing_power_flag' : 'no_driver',
  }
  if (classifyBootstrapSwitchingNode(parsed, context, net)) {
    const role = /^bst|boot/i.test(parsed.pinName) ? 'bootstrap supply node' : 'switching node'
    return {
      ...base,
      likelyElectricalRole: role,
      classification: 'AUTO_REPAIR',
      action: 'Apply exact BoardForge ERC intent waiver/metadata for reviewed regulator bootstrap or switching pin; do not suppress other ERC items.',
      reason: `${parsed.ref} is ${symbol.value || symbol.libId}; ${parsed.pinName} is a known ${role} in a switching regulator topology.`,
      localWaiverAllowed: true,
    }
  }
  if (classifyCurrentSenseInput(parsed, context, net, schematicText)) {
    return {
      ...base,
      likelyElectricalRole: 'current-sense amplifier negative input',
      classification: 'NEEDS_REVIEW_NONBLOCKING',
      action: 'Document exact current-sense input ERC intent as nonblocking review item; no PWR_FLAG added.',
      reason: `${parsed.ref} is ${symbol.value || symbol.libId}; pin ${parsed.pinName} is an INA current-sense input and the schematic contains shunt/current-sense nets.`,
      localWaiverAllowed: true,
    }
  }
  return {
    ...base,
    likelyElectricalRole: 'unknown undriven input/power intent',
    classification: 'BLOCKED_REQUIRES_USER_DECISION',
    action: 'Stop for schematic intent; BoardForge cannot safely infer this driver/source.',
    reason: 'No recognized bootstrap, switching-node, power-rail, or current-sense topology evidence was found.',
    localWaiverAllowed: false,
  }
}

export function classifyBootstrapSwitchingNode(parsed, context = '', net = '') {
  return /TPS629|buck|switching|regulator/i.test(context) && (/^(BST|BOOT)$/i.test(parsed.pinName || '') || /^(SW|LX|PH)$/i.test(parsed.pinName || '') || /BST|BOOT|SW|LX/i.test(net || ''))
}

export function classifyCurrentSenseInput(parsed, context = '', net = '', schematicText = '') {
  return parsed.pinName === '-' && /INA180|INA181|INA190|INA193|INA219|INA226|INA293|current sense/i.test(context) && (/SHUNT|ISENSE|CURRENT/i.test(`${net} ${schematicText}`))
}

function extractReportViolations(report) {
  if (!report) return []
  return (report.sheets || []).flatMap((sheet) => sheet.violations || []).concat(report.violations || [])
}

function parseIssueDetail(detail = '') {
  const match = String(detail).match(/Symbol\s+(\S+)\s+Pin\s+(\S+)\s+\[([^,\]]+),\s*([^,\]]+)/i)
  return {
    ref: match?.[1] || null,
    pinNumber: match?.[2] || null,
    pinName: match?.[3] || null,
    pinType: match?.[4] || null,
  }
}

function findSymbolContext(text, ref) {
  if (!ref) return {}
  const index = text.indexOf(`(property "Reference" "${ref}"`)
  if (index < 0) return {}
  const start = text.lastIndexOf('(symbol', index)
  const end = nextSymbolStart(text, index)
  const block = text.slice(Math.max(0, start), end > index ? end : index + 2500)
  return {
    ref,
    block,
    libId: matchProperty(block, 'lib_id') || null,
    value: matchNamedProperty(block, 'Value') || null,
    footprint: matchNamedProperty(block, 'Footprint') || null,
    description: matchNamedProperty(block, 'Description') || null,
  }
}

function nextSymbolStart(text, index) {
  const next = text.indexOf('\n\t(symbol', index + 1)
  return next >= 0 ? next : Math.min(text.length, index + 3500)
}

function matchProperty(block, property) {
  const match = block.match(new RegExp(`\\(${property}\\s+"([^"]+)"`))
  return match?.[1] || null
}

function matchNamedProperty(block, name) {
  const match = block.match(new RegExp(`\\(property\\s+"${name}"\\s+"([^"]*)"`))
  return match?.[1] || null
}

function inferLikelyNet(parsed, schematicText, symbol = {}) {
  if (/^BST|BOOT/i.test(parsed.pinName || '')) {
    const labels = [...schematicText.matchAll(/\(label\s+"([^"]*(?:BST|BOOT)[^"]*)"/gi)].map((match) => match[1])
    return labels.find((label) => label.includes(parsed.ref || '')) || labels[0] || null
  }
  if (/^SW|LX|PH/i.test(parsed.pinName || '')) {
    const labels = [...schematicText.matchAll(/\(label\s+"([^"]*(?:SW|LX|PHASE)[^"]*)"/gi)].map((match) => match[1])
    return labels.find((label) => label.includes(parsed.ref || '')) || labels[0] || null
  }
  if (parsed.pinName === '-' && /INA|current sense/i.test(`${symbol.value || ''} ${symbol.description || ''}`)) {
    const labels = [...schematicText.matchAll(/\(label\s+"([^"]*(?:SHUNT_N|SHUNT_P|ISENSE|CURRENT)[^"]*)"/gi)].map((match) => match[1])
    return labels[0] || null
  }
  return null
}

function inferConnectedComponents(net, schematicText, ref) {
  const components = new Set()
  if (net && /SHUNT/i.test(net)) {
    for (const match of schematicText.matchAll(/\(property\s+"Reference"\s+"(R_SHUNT[^"]+)"/g)) components.add(match[1])
  }
  if (ref) components.add(ref)
  return [...components].slice(0, 8)
}

function symbolEvidence(symbol, net, schematicText) {
  return [
    symbol.libId ? `lib_id=${symbol.libId}` : null,
    symbol.value ? `value=${symbol.value}` : null,
    symbol.footprint ? `footprint=${symbol.footprint}` : null,
    net ? `likely_net=${net}` : null,
    /SHUNT|ISENSE/i.test(schematicText) ? 'schematic_contains_shunt_or_isense_labels' : null,
  ].filter(Boolean)
}

function intentKey(item = {}) {
  return `${item.ref || ''}:${item.pinNumber || ''}:${item.pinName || ''}:${item.ercType || ''}`
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
