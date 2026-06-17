import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function auditBomSourcing(projectDir, components = [], options = {}) {
  const checked = components.filter((component) => component.ref && !component.dnp)
  const results = checked.map((component) => {
    const source = component.lcsc || component.lcscPart || component.jlcpcbPart || component.mpn || component.sourcePart || null
    const packageKnown = Boolean(component.package || component.footprint)
    const assemblyRisk = source && packageKnown ? 'low_needs_review' : source ? 'medium_package_review' : 'high_source_missing'
    return {
      ref: component.ref,
      value: component.value,
      group: component.group,
      footprint: component.footprint?.libId || component.footprint || null,
      mpn: component.mpn || null,
      lcsc: component.lcsc || component.lcscPart || component.jlcpcbPart || null,
      sourcePart: source,
      packageKnown,
      assemblyRisk,
    }
  })
  const errors = results
    .filter((item) => !item.footprint)
    .map((item) => issue('ERROR', 'BOM_FOOTPRINT_MISSING', `${item.ref} has no footprint, so sourcing cannot be tied to assembly output.`, { ref: item.ref }))
  const warnings = [
    ...results.filter((item) => !item.sourcePart).map((item) => issue('WARNING', 'BOM_SOURCE_PART_MISSING', `${item.ref} has no MPN/LCSC/JLCPCB source part.`, { ref: item.ref })),
    ...results.filter((item) => item.sourcePart && !item.lcsc).map((item) => issue('WARNING', 'LCSC_PART_MISSING', `${item.ref} has a source part but no LCSC/JLCPCB assembly code.`, { ref: item.ref })),
    ...results.filter((item) => item.sourcePart && !item.packageKnown).map((item) => issue('WARNING', 'SOURCE_PACKAGE_NEEDS_REVIEW', `${item.ref} has source info but no package/footprint confidence.`, { ref: item.ref })),
  ]
  const report = {
    status: errors.length ? 'BOM_SOURCING_BLOCKED' : warnings.length ? 'BOM_SOURCING_NEEDS_REVIEW' : 'BOM_SOURCING_READY_NEEDS_STOCK_CHECK',
    projectDir,
    checked: checked.length,
    sourced: results.filter((item) => item.sourcePart).length,
    jlcpcbReady: results.filter((item) => item.lcsc && item.footprint).length,
    results,
    errors,
    warnings,
    actions: recommendedActions(errors, warnings),
    humanReviewRequired: true,
  }
  if (options.write !== false) {
    const outputFile = path.join(projectDir, 'boardforge-bom-sourcing-audit.json')
    await writeFile(outputFile, JSON.stringify(report, null, 2), 'utf8')
    return { ...report, outputFile }
  }
  return report
}

function recommendedActions(errors, warnings) {
  const codes = new Set([...errors, ...warnings].map((issue) => issue.code))
  const actions = []
  if (codes.has('BOM_FOOTPRINT_MISSING')) actions.push({ command: 'resolve_component_assets', reason: 'Resolve footprints before sourcing/assembly export.' })
  if (codes.has('BOM_SOURCE_PART_MISSING') || codes.has('LCSC_PART_MISSING')) actions.push({ command: 'sync_component_database', reason: 'Find MPN/LCSC/JLCPCB candidate parts and alternates.' })
  return actions
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
