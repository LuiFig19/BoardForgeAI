export function buildProjectPreflight({ scan = null, componentAudit = null, bindingReport = null, netlist = null, readiness = null, dfm = null, snapshotDiff = null }) {
  const gates = [
    gate('project_files', scan && !scan.errors?.length, scan?.errors || [], scan?.warnings || []),
    gate('component_library', componentAudit && !componentAudit.errors?.length, componentAudit?.errors || [], componentAudit?.warnings || []),
    gate('component_bindings', bindingReport && !bindingReport.errors?.length, bindingReport?.errors || [], bindingReport?.warnings || []),
    gate('netlist', netlist && netlist.nets?.length > 0, netlist?.issues || [], []),
    gate('dfm', dfm && !dfm.errors?.length, dfm?.errors || [], dfm?.warnings || []),
    gate('manufacturing_readiness', readiness && !readiness.errors?.length, readiness?.errors || [], readiness?.warnings || []),
    snapshotDiff ? gate('snapshot_diff', snapshotDiff.changedFiles === 0, [], snapshotDiff.changedFiles ? [{ severity: 'WARNING', code: 'SNAPSHOT_DIFF_HAS_CHANGES', message: `${snapshotDiff.changedFiles} files changed since snapshot ${snapshotDiff.snapshot.id}.` }] : []) : null,
  ].filter(Boolean)
  const blockers = gates.flatMap((item) => item.errors)
  const warnings = gates.flatMap((item) => item.warnings)
  return {
    status: blockers.length ? 'PROJECT_PREFLIGHT_BLOCKED' : warnings.length ? 'PROJECT_PREFLIGHT_NEEDS_REVIEW' : 'PROJECT_PREFLIGHT_READY_NEEDS_REVIEW',
    gates,
    blockers,
    warnings,
    readinessScore: scoreGates(gates),
    nextActions: nextActions(gates),
    humanReviewRequired: true,
  }
}

function gate(name, passed, errors = [], warnings = []) {
  return {
    name,
    passed: Boolean(passed),
    status: errors.length ? 'blocked' : warnings.length || !passed ? 'review' : 'passed',
    errors,
    warnings,
  }
}

function scoreGates(gates) {
  if (!gates.length) return 0
  return Math.round((gates.filter((item) => item.passed).length / gates.length) * 100)
}

function nextActions(gates) {
  const actions = []
  if (gateStatus(gates, 'project_files') !== 'passed') actions.push('Run scan_kicad_project and confirm .kicad_pro, .kicad_sch, and .kicad_pcb files exist.')
  if (gateStatus(gates, 'component_library') !== 'passed') actions.push('Run resolve_component_assets, link_3d_models, and audit_component_library until footprint/model blockers are resolved.')
  if (gateStatus(gates, 'component_bindings') !== 'passed') actions.push('Run validate_component_bindings and fix symbol/pad/pin-map mismatches.')
  if (gateStatus(gates, 'netlist') !== 'passed') actions.push('Run generate_netlist and review unconnected or unmapped pins before routing.')
  if (gateStatus(gates, 'dfm') !== 'passed') actions.push('Run run_dfm_checks and resolve board outline, placement, fanout, thermal, and manufacturing blockers.')
  if (gateStatus(gates, 'manufacturing_readiness') !== 'passed') actions.push('Run ERC/DRC and generate BOM/CPL/Gerbers/drill before packaging.')
  if (gateStatus(gates, 'snapshot_diff') !== 'passed' && gateStatus(gates, 'snapshot_diff') !== 'missing') actions.push('Review diff_project_snapshot output before restore, export, or package operations.')
  return [...new Set(actions)]
}

function gateStatus(gates, name) {
  return gates.find((item) => item.name === name)?.status || 'missing'
}
