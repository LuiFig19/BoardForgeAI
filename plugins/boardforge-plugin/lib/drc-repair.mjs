import { readFile, writeFile } from 'node:fs/promises'

export async function planDrcRepairs({ reportFile, pcbFile }) {
  const report = await readJson(reportFile)
  const text = JSON.stringify(report || {})
  const repairs = []
  if (/clearance/i.test(text)) repairs.push({ action: 'increase_clearance_or_remove_segment', risk: 'medium', reason: 'Clearance violation found in DRC report.' })
  if (/track|segment/i.test(text)) repairs.push({ action: 'reroute_short_segment', risk: 'medium', reason: 'Track/segment violation found.' })
  if (/via/i.test(text)) repairs.push({ action: 'move_or_resize_via', risk: 'medium', reason: 'Via violation found.' })
  if (/zone/i.test(text)) repairs.push({ action: 'rebuild_zone_with_keepouts', risk: 'low', reason: 'Zone violation found.' })
  if (/edge|courtyard/i.test(text)) repairs.push({ action: 'respect_edge_or_courtyard_clearance', risk: 'high', reason: 'Mechanical/courtyard violation found.' })
  return {
    status: repairs.length ? 'DRC_REPAIR_PLAN_READY_NEEDS_REVIEW' : 'DRC_REPAIR_NO_ACTIONS_FOUND',
    reportFile,
    pcbFile,
    repairs,
    autoApplicable: repairs.filter((item) => ['rebuild_zone_with_keepouts'].includes(item.action)),
    humanReviewRequired: true,
  }
}

export async function applySafeDrcRepairs({ pcbFile, repairPlan }) {
  let pcb = await readFile(pcbFile, 'utf8')
  let applied = 0
  if (repairPlan.autoApplicable?.some((item) => item.action === 'rebuild_zone_with_keepouts')) {
    pcb = pcb.replace(/\(zone[\s\S]*?\n\s*\)\n/g, '')
    applied += 1
  }
  await writeFile(pcbFile, pcb, 'utf8')
  return {
    status: applied ? 'SAFE_DRC_REPAIRS_APPLIED_RERUN_DRC' : 'NO_SAFE_DRC_REPAIRS_APPLIED',
    applied,
    pcbFile,
    humanReviewRequired: true,
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}
