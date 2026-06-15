import { existsSync } from 'node:fs'

export function auditComponentLibraryCoverage(components = []) {
  const audited = components.map((component) => auditComponent(component))
  const totals = {
    components: audited.length,
    symbols: audited.filter((item) => item.coverage.symbol).length,
    footprints: audited.filter((item) => item.coverage.footprint).length,
    models3d: audited.filter((item) => item.coverage.model3d).length,
    pinMaps: audited.filter((item) => item.coverage.pinMap).length,
    lcsc: audited.filter((item) => item.coverage.lcsc).length,
    mpn: audited.filter((item) => item.coverage.mpn).length,
  }
  const blockers = audited.flatMap((item) => item.issues.filter((issue) => issue.severity === 'ERROR'))
  const warnings = audited.flatMap((item) => item.issues.filter((issue) => issue.severity === 'WARNING'))
  const coverageScore = scoreCoverage(totals)
  return {
    status: blockers.length ? 'COMPONENT_LIBRARY_AUDIT_NEEDS_FIX' : warnings.length ? 'COMPONENT_LIBRARY_AUDIT_NEEDS_REVIEW' : 'COMPONENT_LIBRARY_AUDIT_READY_NEEDS_REVIEW',
    coverageScore,
    totals,
    components: audited,
    warnings,
    errors: blockers,
    actions: recommendedActions({ audited, totals, blockers, warnings }),
    humanReviewRequired: true,
  }
}

function auditComponent(component) {
  const coverage = {
    symbol: Boolean(component.symbol),
    footprint: Boolean(component.footprint),
    model3d: hasModel3d(component.model3d),
    pinMap: Boolean(component.pinMap && Object.keys(component.pinMap).length),
    lcsc: Boolean(component.lcsc),
    mpn: Boolean(component.mpn),
    package: Boolean(component.package),
  }
  const issues = []
  if (!coverage.symbol) issues.push(issue('WARNING', 'SYMBOL_MISSING', `${component.ref} needs a KiCad symbol before schematic generation can be trusted.`))
  if (!coverage.footprint) issues.push(issue('ERROR', 'FOOTPRINT_MISSING', `${component.ref} needs a KiCad footprint before PCB placement/export.`))
  if (!coverage.model3d) issues.push(issue('WARNING', 'MODEL_3D_MISSING', `${component.ref} has no linked STEP/WRL model, so KiCad 3D preview will be incomplete.`))
  if (!coverage.pinMap) issues.push(issue('WARNING', 'PIN_MAP_MISSING', `${component.ref} needs a pin map before nets can be assigned safely.`))
  if (!coverage.lcsc && !coverage.mpn) issues.push(issue('WARNING', 'SUPPLIER_ID_MISSING', `${component.ref} needs LCSC or MPN data for BOM sourcing review.`))
  return {
    ref: component.ref,
    group: component.group || null,
    value: component.value || null,
    package: component.package || null,
    symbol: assetId(component.symbol),
    footprint: assetId(component.footprint),
    model3d: modelPath(component.model3d),
    lcsc: component.lcsc || null,
    mpn: component.mpn || null,
    coverage,
    coverageScore: componentScore(coverage, issues),
    issues,
  }
}

function scoreCoverage(totals) {
  if (!totals.components) return 0
  const symbol = totals.symbols / totals.components
  const footprint = totals.footprints / totals.components
  const model3d = totals.models3d / totals.components
  const pinMap = totals.pinMaps / totals.components
  const supplier = Math.max(totals.lcsc, totals.mpn) / totals.components
  return Math.round((symbol * 20) + (footprint * 30) + (model3d * 15) + (pinMap * 25) + (supplier * 10))
}

function componentScore(coverage, issues) {
  let score = 100
  if (!coverage.symbol) score -= 20
  if (!coverage.footprint) score -= 35
  if (!coverage.model3d) score -= 12
  if (!coverage.pinMap) score -= 20
  if (!coverage.lcsc && !coverage.mpn) score -= 8
  score -= issues.filter((item) => item.severity === 'ERROR').length * 10
  return Math.max(0, score)
}

function recommendedActions({ audited, blockers, warnings }) {
  const actions = []
  if (blockers.some((item) => item.code === 'FOOTPRINT_MISSING')) actions.push('Run resolve_component_assets or find_missing_footprints, then review footprint assignments before placement.')
  if (warnings.some((item) => item.code === 'SYMBOL_MISSING')) actions.push('Run resolve_component_assets and validate_component_bindings before schematic generation.')
  if (warnings.some((item) => item.code === 'MODEL_3D_MISSING')) actions.push('Run link_3d_models and verify KiCad 3D model paths before relying on physical preview.')
  if (warnings.some((item) => item.code === 'PIN_MAP_MISSING')) actions.push('Add or review pin maps before generating netlists, schematic wiring, or PCB pad nets.')
  if (warnings.some((item) => item.code === 'SUPPLIER_ID_MISSING')) actions.push('Resolve BOM source data with LCSC/MPN alternates before manufacturing review.')
  if (!audited.length) actions.push('No components were provided. Create or scan a project before running component library audit.')
  return [...new Set(actions)]
}

function hasModel3d(model) {
  const value = modelPath(model)
  if (!value) return false
  if (/^\$\{KICAD\d*_3DMODEL_DIR\}\//.test(value)) return true
  return existsSync(value)
}

function assetId(asset) {
  if (!asset) return null
  return typeof asset === 'string' ? asset : asset.libId || asset.name || null
}

function modelPath(model) {
  if (!model) return null
  return typeof model === 'string' ? model : model.path || model.name || null
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
