export function generateProjectReviewReport(input = {}) {
  const sections = [
    section('category', input.categoryPlan),
    section('schematic', input.schematicGraph),
    section('placement', input.placementPlan || input.placement),
    section('routing_readiness', input.routingReadiness),
    section('routing', input.routingReport || input.routingPlan),
    section('power', input.powerRouting || input.powerTree),
    section('vias', input.viaStrategy || input.fanoutPlan?.viaPolicy),
    section('noise', input.noiseMap),
    section('manufacturer', input.manufacturerRules),
    section('dfm', input.dfmReport),
    section('manufacturing', input.manufacturingManifest || input.manufacturingReadiness),
  ].filter((item) => item.present)
  const blockers = sections.flatMap((item) => item.errors.map((error) => ({ ...error, section: item.name })))
  const warnings = sections.flatMap((item) => item.warnings.map((warning) => ({ ...warning, section: item.name })))
  const readinessScore = sections.length ? Math.round((sections.filter((item) => !item.errors.length).length / sections.length) * 100) : 0
  return {
    schemaVersion: 1,
    status: blockers.length ? 'PROJECT_REVIEW_BLOCKED' : warnings.length ? 'PROJECT_REVIEW_NEEDS_REVIEW' : 'PROJECT_REVIEW_READY_FOR_LOCAL_ERC_DRC',
    readinessScore,
    sections,
    blockers,
    warnings,
    nextActions: nextActions(blockers, warnings),
    manufacturingClaim: blockers.length ? 'not ready for export/package' : 'review-required; run KiCad ERC/DRC and manufacturing exports before ordering',
    humanReviewRequired: true,
  }
}

function section(name, payload) {
  const errors = payload?.errors || payload?.blockers || []
  const warnings = payload?.warnings || []
  return { name, present: Boolean(payload), status: payload?.status || 'missing', errors, warnings, summary: summarize(payload) }
}

function summarize(payload) {
  if (!payload) return null
  return {
    status: payload.status || null,
    counts: {
      errors: (payload.errors || payload.blockers || []).length,
      warnings: (payload.warnings || []).length,
      components: payload.componentCount || payload.components?.length || null,
      nets: payload.netCount || payload.nets?.length || payload.summary?.totalNets || null,
    },
  }
}

function nextActions(blockers, warnings) {
  if (blockers.length) return ['Fix blockers first; do not export manufacturing files.', ...blockers.slice(0, 5).map((item) => `${item.section}: ${item.message}`)]
  if (warnings.length) return ['Review warnings, then run KiCad ERC/DRC and generate manufacturing manifest.']
  return ['Run exports, inspect Gerbers/BOM/CPL, and perform final human review before ordering.']
}
