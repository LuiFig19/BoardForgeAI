import { readFile, writeFile } from 'node:fs/promises'

export const escThroughViaOnlyConstraints = {
  approvedLayerCount: 8,
  maxLayerCount: 8,
  allowThroughVias: true,
  allowBlindVias: false,
  allowBuriedVias: false,
  allowMicrovias: false,
  allowViaInPad: false,
  allowHiddenVias: false,
}

export async function buildDrcClusterReport({ reportFile, jsonFile = null, markdownFile = null }) {
  const report = JSON.parse(await readFile(reportFile, 'utf8'))
  const issues = normalizeDrcIssues(report)
  const clusters = clusterDrcIssues(issues)
  const output = {
    schemaVersion: 1,
    reportFile,
    totalErrors: issues.filter((issue) => issue.severity === 'error').length,
    totalWarnings: issues.filter((issue) => issue.severity === 'warning').length,
    totalIssues: issues.length,
    unconnectedItems: (report.unconnected_items || []).length,
    clusters,
  }
  if (jsonFile) await writeFile(jsonFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  if (markdownFile) await writeFile(markdownFile, drcClusterMarkdown(output), 'utf8')
  return output
}

export function normalizeDrcIssues(report = {}) {
  return [
    ...(report.violations || []),
    ...(report.unconnected_items || []).map((issue) => ({ ...issue, type: issue.type || 'unconnected_items' })),
  ].map((issue) => {
    const items = (issue.items || []).map((item) => ({
      description: item.description || '',
      layer: item.layer || layerFromText(item.description || ''),
      pos: item.pos || null,
    }))
    return {
      type: normalizeDrcType(issue.type || issue.rule || issue.code || 'drc_issue'),
      rawType: issue.type || issue.rule || issue.code || 'drc_issue',
      severity: String(issue.severity || 'warning').toLowerCase(),
      description: issue.description || issue.message || '',
      items,
      refs: unique(items.flatMap((item) => refsFromText(item.description))),
      nets: unique(items.flatMap((item) => netsFromText(item.description))),
      layers: unique(items.map((item) => item.layer).filter(Boolean)),
      regions: unique(items.map((item) => regionForPos(item.pos)).filter(Boolean)),
    }
  })
}

export function clusterDrcIssues(issues = []) {
  const grouped = new Map()
  for (const issue of issues) {
    if (!grouped.has(issue.type)) grouped.set(issue.type, [])
    grouped.get(issue.type).push(issue)
  }
  return [...grouped.entries()].map(([type, clusterIssues]) => {
    const profile = clusterProfile(type, clusterIssues)
    return {
      type,
      count: clusterIssues.length,
      severity: profile.severity,
      affectedNets: unique(clusterIssues.flatMap((issue) => issue.nets)).slice(0, 40),
      affectedRefs: unique(clusterIssues.flatMap((issue) => issue.refs)).slice(0, 60),
      layers: unique(clusterIssues.flatMap((issue) => issue.layers)).slice(0, 20),
      coordinateRegions: unique(clusterIssues.flatMap((issue) => issue.regions)).slice(0, 24),
      rootCause: profile.rootCause,
      source: profile.source,
      status: profile.status,
      safeRepairStrategy: profile.safeRepairStrategy,
      blocksRouting: profile.blocksRouting,
      blocksExport: profile.blocksExport,
      routingBlocking: profile.blocksRouting,
      exportBlocking: profile.blocksExport,
      safeToAutoFix: profile.safeToAutoFix,
      autoRepairSafe: profile.safeToAutoFix,
      continueRouting: !profile.blocksRouting,
      examples: clusterIssues.slice(0, 5).map((issue) => ({
        description: issue.description,
        items: issue.items.slice(0, 2).map((item) => item.description),
      })),
    }
  }).sort((a, b) => Number(b.blocksRouting) - Number(a.blocksRouting) || Number(b.blocksExport) - Number(a.blocksExport) || b.count - a.count)
}

export async function compactSilkscreenForDenseBoard({ pcbFile }) {
  const original = await readFile(pcbFile, 'utf8')
  let valueFieldsHidden = 0
  let referenceFieldsCompacted = 0
  const next = rewriteFpTextBlocks(original, (block) => {
    if (!/\(layer\s+"?[FB]\.SilkS"?\)/.test(block)) return block
    if (/^\(fp_text\s+value\s/i.test(block)) {
      valueFieldsHidden += /\(hide\s+yes\)/.test(block) || /\shide(\s|\))/.test(block) ? 0 : 1
      let updated = compactTextEffects(block)
      if (!/\(hide\s+yes\)/.test(updated) && !/\shide(\s|\))/.test(updated)) updated = insertBeforeClose(updated, '\n    (hide yes)')
      return updated
    }
    if (/^\(fp_text\s+reference\s/i.test(block)) {
      const updated = compactTextEffects(block)
      if (updated !== block) referenceFieldsCompacted += 1
      return updated
    }
    return block
  })
  const changed = next !== original
  if (changed) await writeFile(pcbFile, next, 'utf8')
  return {
    status: changed ? 'DENSE_SILKSCREEN_COMPACTED_NEEDS_DRC' : 'DENSE_SILKSCREEN_ALREADY_COMPACT',
    pcbFile,
    changed,
    valueFieldsHidden,
    referenceFieldsCompacted,
    preservedCriticalMarks: true,
    actions: ['hide_nonessential_value_text', 'compact_reference_text'],
  }
}

export function validateEscViaPolicy(candidates = [], constraints = escThroughViaOnlyConstraints) {
  const vias = Array.isArray(candidates) ? candidates : candidates.vias || candidates.routes?.flatMap((route) => route.viaPlan?.candidates || route.vias || []) || []
  const errors = []
  for (const via of vias) {
    const viaType = String(via.viaType || via.type || 'through').toLowerCase()
    if (viaType === 'blind' && !constraints.allowBlindVias) errors.push(viaIssue('BLIND_VIA_FORBIDDEN', via))
    if (viaType === 'buried' && !constraints.allowBuriedVias) errors.push(viaIssue('BURIED_VIA_FORBIDDEN', via))
    if (viaType === 'microvia' && !constraints.allowMicrovias) errors.push(viaIssue('MICROVIA_FORBIDDEN', via))
    if ((via.viaInPad || viaType === 'via_in_pad' || viaType.includes('via-in-pad')) && !constraints.allowViaInPad) errors.push(viaIssue('VIA_IN_PAD_FORBIDDEN', via))
    if ((via.hidden || viaType === 'hidden') && !constraints.allowHiddenVias) errors.push(viaIssue('HIDDEN_VIA_FORBIDDEN', via))
    if (via.layers?.length && !isThroughLayerSpan(via.layers) && !constraints.allowBlindVias && !constraints.allowBuriedVias && !constraints.allowMicrovias) errors.push(viaIssue('NON_THROUGH_LAYER_SPAN_FORBIDDEN', via))
  }
  return {
    status: errors.length ? 'ESC_VIA_POLICY_REJECTED' : 'ESC_VIA_POLICY_READY',
    checkedVias: vias.length,
    constraints,
    errors,
    allowedViaTypes: ['through'],
  }
}

function clusterProfile(type, issues) {
  const generated = issues.some((issue) => /BoardForge generated|boardforge/i.test(`${issue.description} ${issue.items?.map?.((item) => item.description).join(' ')}`))
  const text = issues.map((issue) => `${issue.description || ''} ${issue.items?.map?.((item) => item.description).join(' ') || ''}`).join('\n')
  if (type === 'lib_footprint_issues' && /does not match copy in library/i.test(text) && !/does not include the footprint library|not found in library/i.test(text)) {
    return {
      severity: 'footprint version review',
      source: 'footprint_version_mismatch',
      status: 'NEEDS_REVIEW_EXPORT',
      rootCause: 'embedded footprint geometry differs from the resolved project library copy',
      safeRepairStrategy: 'do not overwrite embedded geometry automatically; compare library copy and embedded footprint before update-from-library',
      blocksRouting: false,
      blocksExport: true,
      safeToAutoFix: false,
    }
  }
  const profiles = {
    lib_footprint_issues: ['library/load blocker', 'KiCad library issue', 'ROUTING_BLOCKING', 'unresolved or invalid imported footprint/library data', 'resolve missing library/footprint path before trusting routing/export', true, true, false],
    clearance: ['manufacturing review', generated ? 'BoardForge generated copper' : 'imported footprint geometry', generated ? 'SAFE_AUTO_REPAIR' : 'NEEDS_REVIEW_EXPORT', generated ? 'generated copper violates object clearance' : 'pre-existing/imported copper or footprint geometry violates clearance', generated ? 'rollback or repair generated copper' : 'document imported geometry clearance for export review; continue routing if pads/nets are usable', generated, true, generated],
    copper_edge_clearance: ['manufacturing review', generated ? 'BoardForge generated copper' : 'imported footprint geometry', generated ? 'SAFE_AUTO_REPAIR' : 'NEEDS_REVIEW_EXPORT', generated ? 'generated copper too close to Edge.Cuts' : 'imported copper/footprint geometry too close to Edge.Cuts', generated ? 'clip generated copper/zones inward from Edge.Cuts' : 'document imported edge clearance for export review; continue routing if board outline and pads remain usable', generated, true, generated],
    drill_out_of_range: ['manufacturing review', generated ? 'BoardForge generated drill/via' : 'imported footprint geometry', generated ? 'SAFE_AUTO_REPAIR' : 'NEEDS_REVIEW_EXPORT', 'hole or via drill does not match manufacturer profile', generated ? 'repair generated via/hole drill sizes' : 'do not auto-change imported connector/mechanical holes; document for export review', generated, true, generated],
    solder_mask_bridge: ['manufacturing review', generated ? 'BoardForge generated copper/mask' : 'imported footprint geometry', generated ? 'SAFE_AUTO_REPAIR' : 'NEEDS_REVIEW_EXPORT', 'dense pad/mask geometry creates solder mask slivers below rule', generated ? 'repair generated copper/mask geometry' : 'document imported footprint mask bridge for export review; continue routing', false, true, generated],
    unconnected_items: ['routing work', 'actual unconnected net', 'ROUTING_WORK', 'ratsnest connection still unrouted', 'route by staged priority; this is work to perform, not a pre-route blocker', false, true, false],
    silk_overlap: ['repairable cosmetic DRC', 'silkscreen', 'SAFE_AUTO_REPAIR', 'silkscreen text or graphics overlap pads/items', 'hide nonessential values and compact references while preserving polarity/orientation marks', false, true, true],
    silk_over_copper: ['repairable cosmetic DRC', 'silkscreen', 'SAFE_AUTO_REPAIR', 'silkscreen printed over exposed copper/pads', 'hide nonessential values and compact references while preserving polarity/orientation marks', false, true, true],
    silk_edge_clearance: ['repairable cosmetic DRC', 'silkscreen', 'SAFE_AUTO_REPAIR', 'silkscreen too close to board edge', 'move/hide nonessential silkscreen text', false, true, true],
    text_height: ['repairable cosmetic DRC', 'silkscreen', 'SAFE_AUTO_REPAIR', 'text below or outside DRC text rule', 'compact to BoardForge dense-board text standard or hide values', false, true, true],
    text_thickness: ['repairable cosmetic DRC', 'silkscreen', 'SAFE_AUTO_REPAIR', 'text stroke below or outside DRC text rule', 'compact to BoardForge dense-board text standard or hide values', false, true, true],
    malformed_courtyard: ['footprint review', 'imported footprint geometry', 'NEEDS_REVIEW_EXPORT', 'imported footprint courtyard geometry is malformed', 'document footprint courtyard issue for export review; continue routing if pads/nets are usable', false, true, false],
    courtyards_overlap: ['placement/mechanical review', 'imported placement/footprint geometry', 'NEEDS_REVIEW_EXPORT', 'component courtyards overlap', 'document for export/assembly review unless actual component bodies overlap or placement is rejected', false, true, false],
    isolated_copper: ['generated/imported copper review', generated ? 'BoardForge generated copper' : 'imported copper geometry', generated ? 'SAFE_AUTO_REPAIR' : 'NEEDS_REVIEW_EXPORT', 'copper island or zone is isolated after refill', generated ? 'repair or rollback generated zone' : 'classify imported copper island for export review', generated, true, generated],
  }
  const [severity, source, status, rootCause, safeRepairStrategy, blocksRouting, blocksExport, safeToAutoFix] = profiles[type] || ['DRC review', 'unknown', 'NEEDS_REVIEW_EXPORT', 'unclassified DRC issue', 'cluster by object/ref/net before modifying geometry', false, true, false]
  return { severity, source, status, rootCause, safeRepairStrategy, blocksRouting, blocksExport, safeToAutoFix }
}

function normalizeDrcType(type) {
  const key = String(type || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  if (/silk.*overlap|silkscreen_overlap/.test(key)) return 'silk_overlap'
  if (/silk.*copper|silkscreen.*copper/.test(key)) return 'silk_over_copper'
  if (/silk.*edge/.test(key)) return 'silk_edge_clearance'
  if (/footprint.*library|lib_footprint|library/.test(key)) return 'lib_footprint_issues'
  if (/copper.*edge/.test(key)) return 'copper_edge_clearance'
  if (/drill.*range|hole.*range/.test(key)) return 'drill_out_of_range'
  if (/solder.*mask.*bridge|mask.*bridge/.test(key)) return 'solder_mask_bridge'
  if (/clearance/.test(key)) return 'clearance'
  if (/unconnected/.test(key)) return 'unconnected_items'
  if (/courtyard.*malformed|malformed.*courtyard/.test(key)) return 'malformed_courtyard'
  if (/courtyard.*overlap/.test(key)) return 'courtyards_overlap'
  if (/isolated.*copper/.test(key)) return 'isolated_copper'
  if (/text.*height/.test(key)) return 'text_height'
  if (/text.*thickness/.test(key)) return 'text_thickness'
  return key || 'drc_issue'
}

function drcClusterMarkdown(report) {
  const lines = [
    '# BoardForge ESC DRC Cluster Report',
    '',
    `Source: ${report.reportFile}`,
    `Errors: ${report.totalErrors}`,
    `Warnings: ${report.totalWarnings}`,
    `Unconnected items: ${report.unconnectedItems}`,
    '',
    '| Cluster | Count | Source | Status | Blocks routing | Blocks export | Auto-fix | Continue routing | Action |',
    '| --- | ---: | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const cluster of report.clusters) {
    lines.push(`| ${cluster.type} | ${cluster.count} | ${cluster.source || ''} | ${cluster.status || ''} | ${cluster.blocksRouting ? 'yes' : 'no'} | ${cluster.blocksExport ? 'yes' : 'no'} | ${cluster.safeToAutoFix ? 'yes' : 'no'} | ${cluster.continueRouting ? 'yes' : 'no'} | ${cluster.safeRepairStrategy.replace(/\|/g, '/')} |`)
  }
  return `${lines.join('\n')}\n`
}

function rewriteFpTextBlocks(content, transform) {
  let output = ''
  let cursor = 0
  while (cursor < content.length) {
    const start = content.indexOf('(fp_text ', cursor)
    if (start < 0) {
      output += content.slice(cursor)
      break
    }
    output += content.slice(cursor, start)
    const end = findClosingParen(content, start)
    if (end < 0) {
      output += content.slice(start)
      break
    }
    const block = content.slice(start, end + 1)
    output += transform(block)
    cursor = end + 1
  }
  return output
}

function findClosingParen(content, start) {
  let depth = 0
  let inString = false
  for (let index = start; index < content.length; index += 1) {
    const char = content[index]
    const prev = content[index - 1]
    if (char === '"' && prev !== '\\') inString = !inString
    if (inString) continue
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function compactTextEffects(block) {
  return block
    .replace(/\(size\s+[-0-9.]+\s+[-0-9.]+\)/g, '(size 0.6 0.6)')
    .replace(/\(thickness\s+[-0-9.]+\)/g, '(thickness 0.1)')
}

function insertBeforeClose(block, text) {
  return `${block.slice(0, -1)}${text}\n  )`
}

function refsFromText(text) {
  const refs = []
  const re = /\b([A-Z]{1,4}\d+[A-Z]?)\b/g
  let match
  while ((match = re.exec(text))) refs.push(match[1])
  return refs
}

function netsFromText(text) {
  const nets = []
  const bracketed = /\[([^\]]+)\]/g
  let match
  while ((match = bracketed.exec(text))) {
    if (!/^[A-Z]+\d+$/i.test(match[1])) nets.push(match[1])
  }
  const slash = /\s(\/[A-Za-z0-9_.$+-]+)/g
  while ((match = slash.exec(text))) nets.push(match[1])
  return nets
}

function layerFromText(text) {
  const match = text.match(/\b([FB]\.Cu|In\d+\.Cu|[FB]\.SilkS|[FB]\.Mask|Edge\.Cuts)\b/)
  return match?.[1] || null
}

function regionForPos(pos) {
  if (!pos || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y))) return null
  return `${Math.floor(Number(pos.x) / 10) * 10}-${Math.floor(Number(pos.x) / 10) * 10 + 10}mm x ${Math.floor(Number(pos.y) / 10) * 10}-${Math.floor(Number(pos.y) / 10) * 10 + 10}mm`
}

function isThroughLayerSpan(layers = []) {
  const normalized = layers.map((layer) => String(layer))
  return normalized.includes('F.Cu') && normalized.includes('B.Cu')
}

function viaIssue(code, via) {
  return { severity: 'ERROR', code, message: `${via.net || 'via'} violates ESC through-via-only policy.`, via }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}
