import test from 'node:test'
import assert from 'node:assert/strict'
import { applyEscRoutingRulesToBoardContext, buildEscRouteDecision, getEscRoutingRules } from '../lib/routing-rules/esc-routing-rules.mjs'
import { getEscViaPolicy, isForbiddenViaType, selectViaClassForNetRole } from '../lib/routing-rules/via-policy.mjs'
import { getEscHighCurrentPolicy } from '../lib/routing-rules/high-current-policy.mjs'
import { getEscGateDrivePolicy } from '../lib/routing-rules/gate-drive-policy.mjs'
import { getEscCurrentSensePolicy } from '../lib/routing-rules/current-sense-policy.mjs'
import { buildDefaultSolutionLibrary, generateSolutionLibraryReport, loadRelevantSolutionsForBoard } from '../lib/solution-library/solution-index.mjs'
import { findSolutionsForProblem, rankSolutionsForBoardContext } from '../lib/solution-library/solution-search.mjs'
import { applySolutionRecipe } from '../lib/solution-library/solution-apply.mjs'
import { recordSolution } from '../lib/solution-library/solution-store.mjs'
import { validateSolutionRecord } from '../lib/solution-library/solution-schema.mjs'

test('ESC 8-layer routing policy maps roles to intentional layers', () => {
  const rules = getEscRoutingRules()
  assert.equal(rules.layerPolicy['In2.Cu'].role, 'vbat_vin_high_current_power_support')
  assert.equal(rules.layerPolicy['In5.Cu'].preferredFor.includes('CURRENT_SENSE_KELVIN'), true)
  const decision = buildEscRouteDecision('/ISENSE_M1')
  assert.equal(decision.netRole, 'CURRENT_SENSE_KELVIN')
  assert.equal(decision.layerPreference.includes('In5.Cu'), true)
})

test('ESC via policy allows only standard through via classes', () => {
  const policy = getEscViaPolicy()
  assert.deepEqual(policy.forbiddenTypes, ['blind', 'buried', 'microvia', 'via-in-pad'])
  assert.equal(selectViaClassForNetRole('HIGH_CURRENT_POWER').type, 'through')
  assert.equal(isForbiddenViaType({ viaType: 'microvia' }), true)
})

test('ESC high-current routing rules require current-capable copper', () => {
  const policy = getEscHighCurrentPolicy()
  assert.equal(policy.roles.includes('MOTOR_PHASE'), true)
  assert.equal(policy.required.includes('no_thin_signal_trace_for_power'), true)
})

test('ESC gate-drive routing rules prefer short local loops', () => {
  const policy = getEscGateDrivePolicy()
  assert.equal(policy.gateDrive.includes('keep_loops_short'), true)
  assert.equal(policy.bootstrap.includes('keep_bootstrap_path_short'), true)
})

test('ESC current-sense routing rules protect Kelvin paths', () => {
  const policy = getEscCurrentSensePolicy()
  assert.equal(policy.preferredLayers[0], 'In5.Cu')
  assert.equal(policy.rejectNearRoles.includes('SWITCHING_NODE'), true)
})

test('solution library schema validates backfilled ESC records', () => {
  const solutions = buildDefaultSolutionLibrary()
  assert.ok(solutions.length >= 7)
  for (const solution of solutions) {
    assert.deepEqual(validateSolutionRecord(solution), { valid: true, missing: [] })
  }
})

test('solution recording upserts repair recipes by id', () => {
  const base = buildDefaultSolutionLibrary()
  const next = recordSolution(base, { ...base[0], fixSummary: 'updated fix summary' })
  assert.equal(next.length, base.length)
  assert.equal(next.find((item) => item.id === base[0].id).fixSummary, 'updated fix summary')
})

test('solution search finds ESC DRC and routing lessons', () => {
  const solutions = buildDefaultSolutionLibrary()
  const matches = findSolutionsForProblem(solutions, {
    boardType: 'ESC',
    errorCode: 'DRC_ERROR_REGRESSION',
    drcFamily: 'clearance',
    netRole: 'GATE_DRIVE',
    constraints: ['existing-drc-debt'],
  })
  assert.equal(matches.some((item) => item.id === 'esc_generated_drc_repair_001'), true)
})

test('solution library applies to ESC and motor-controller board context', () => {
  const solutions = buildDefaultSolutionLibrary()
  const esc = loadRelevantSolutionsForBoard({ boardType: 'ESC', netRoles: ['MOTOR_PHASE'], constraints: ['8-layer-pcb'] }, solutions)
  const motor = rankSolutionsForBoardContext(solutions, { boardType: 'motor-controller', netRoles: ['HIGH_CURRENT_POWER'], constraints: ['through-via-only'] })
  assert.ok(esc.matches.length > 0)
  assert.ok(motor.length > 0)
  assert.equal(esc.appliedContext.routingRules.viaPolicy.forbiddenTypes.includes('via-in-pad'), true)
})

test('solution library auto-apply guard prevents unsafe changes', () => {
  const applied = applySolutionRecipe({ boardType: 'ESC', nets: ['/M2_C_SW'] }, buildDefaultSolutionLibrary())
  assert.equal(applied.autoApplyGuard.forbidFootprintChanges, true)
  assert.equal(applied.autoApplyGuard.forbidBoardOutlineChanges, true)
  assert.equal(applied.autoApplyGuard.forbidUnsafeViaTypes, true)
})

test('solution library report summarizes reusable knowledge', () => {
  const report = generateSolutionLibraryReport()
  assert.ok(report.totalSolutions >= 7)
  assert.ok(report.byBoardType.ESC >= 7)
  assert.ok(report.highConfidence >= 1)
})

test('ESC routing rules attach decisions to board context for future routing', () => {
  const context = applyEscRoutingRulesToBoardContext({ boardType: 'ESC', nets: ['/M2_C_SW', '/I2C1_SCL', '/VBAT_RAW'] })
  assert.equal(context.netDecisions.length, 3)
  assert.equal(context.netDecisions.find((item) => item.net === '/M2_C_SW').highCurrent, true)
  assert.equal(context.routingRules.retainedCopperPolicy.rollbackOnlyFailedCandidate, true)
})
