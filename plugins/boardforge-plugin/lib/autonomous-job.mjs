import { existsSync } from 'node:fs'
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const autonomousJobStateFile = 'boardforge-job-state.json'

export const autonomousModes = {
  analyze_only: { writesBoard: false, routes: false, exports: false },
  safe_repair: { writesBoard: true, routes: false, exports: false },
  improve_placement: { writesBoard: true, routes: false, exports: false },
  full_rebuild: { writesBoard: true, routes: true, exports: true },
  route_only: { writesBoard: true, routes: true, exports: false },
  full_autonomous: { writesBoard: true, routes: true, exports: true },
}

export function estimateAutonomousPcbJob(input = {}) {
  const componentCount = Number(input.componentCount ?? input.scan?.footprints?.length ?? input.footprints ?? 0)
  const padNetCount = input.scan?.pads ? new Set(input.scan.pads.map((pad) => pad.netName).filter(Boolean)).size : 0
  const scannedNetCount = input.scan?.netCount || input.scan?.nets?.length || padNetCount
  const netCount = Number(input.netCount ?? scannedNetCount ?? input.nets ?? 0)
  const padCount = Number(input.padCount ?? input.scan?.pads?.length ?? input.pads ?? 0)
  const area = Number(input.boardAreaMm2 ?? (Number(input.widthMm || input.scan?.boardSize?.widthMm || 0) * Number(input.heightMm || input.scan?.boardSize?.heightMm || 0)))
  const layerCount = Number(input.layerCount ?? input.scan?.layerCount ?? 2)
  const ercErrors = Number(input.ercErrors ?? input.erc?.errors ?? 0)
  const drcErrors = Number(input.drcErrors ?? input.drc?.errors ?? 0)
  const unconnectedItems = Number(input.unconnectedItems ?? input.drc?.unconnectedItems ?? 0)
  const highCurrentNets = Number(input.highCurrentNets ?? input.highCurrentNetCount ?? 0)
  const density = area ? componentCount / area * 1000 : 0
  let tier = 'outline_only'
  let bestCaseMinutes = 1
  let likelyMinutes = [1, 5]
  let worstCaseMinutes = 10
  let risk = 'low'
  const reasons = []
  if (componentCount) reasons.push(`${componentCount} footprints`)
  if (netCount) reasons.push(`${netCount} nets`)
  if (padCount) reasons.push(`${padCount} pads`)
  if (unconnectedItems) reasons.push(`${unconnectedItems} unconnected items`)
  if (layerCount <= 2 && (componentCount > 80 || highCurrentNets > 8)) reasons.push('2-layer source board requires layer migration')
  if (ercErrors) reasons.push(`${ercErrors} ERC error(s)`)
  if (drcErrors) reasons.push(`${drcErrors} DRC error(s)`)
  if (highCurrentNets) reasons.push(`${highCurrentNets} high-current/switching nets`)

  if (componentCount > 180 || netCount > 180 || padCount > 900 || unconnectedItems > 250 || highCurrentNets > 30) {
    tier = 'very_dense_advanced_power_control'
    bestCaseMinutes = 240
    likelyMinutes = [480, 960]
    worstCaseMinutes = 4320
    risk = 'very_high'
  } else if (componentCount > 80 || netCount > 100 || highCurrentNets > 12) {
    tier = 'dense_esc_or_flight_controller'
    bestCaseMinutes = 240
    likelyMinutes = [240, 720]
    worstCaseMinutes = 1440
    risk = 'high'
  } else if (componentCount > 35 || netCount > 45) {
    tier = 'robotics_industrial_poe'
    bestCaseMinutes = 60
    likelyMinutes = [60, 240]
    worstCaseMinutes = 480
    risk = 'medium_high'
  } else if (componentCount > 12 || netCount > 18) {
    tier = 'moderate_embedded'
    bestCaseMinutes = 30
    likelyMinutes = [30, 90]
    worstCaseMinutes = 180
    risk = 'medium'
  } else if (componentCount > 0 || netCount > 0) {
    tier = 'simple_two_layer'
    bestCaseMinutes = 10
    likelyMinutes = [10, 30]
    worstCaseMinutes = 60
    risk = 'low_medium'
  }

  return {
    complexity: tier,
    estimatedRuntime: {
      bestCase: formatDuration(bestCaseMinutes),
      likely: `${formatDuration(likelyMinutes[0])}-${formatDuration(likelyMinutes[1])}`,
      worstCase: formatDuration(worstCaseMinutes),
    },
    budgetRecommendation: {
      maxRuntimeMinutes: Math.min(worstCaseMinutes, 24 * 60),
      checkpointMinutes: tier.includes('dense') || tier.includes('advanced') ? 30 : 10,
    },
    risk,
    factors: { componentCount, netCount, padCount, boardAreaMm2: Math.round(area * 1000) / 1000, layerCount, densityPer1000Mm2: Math.round(density * 100) / 100, ercErrors, drcErrors, unconnectedItems, highCurrentNets },
    reason: reasons,
    humanReviewRequired: risk === 'high' || risk === 'very_high',
  }
}

export function createAutonomousJobState({ job, projectDir, mode, estimate, assumptions = {}, decisions = {} }) {
  const now = new Date().toISOString()
  const stages = stagesForMode(mode)
  return {
    schemaVersion: 1,
    jobId: job.id || `autonomous_${Date.now()}`,
    mode,
    projectPath: projectDir,
    currentStage: stages[0] || 'complete',
    completedStages: [],
    pendingStages: stages,
    status: 'AUTONOMOUS_JOB_CREATED',
    assumptions,
    userDecisions: decisions,
    estimate,
    progress: [],
    validation: { erc: null, drc: null },
    placement: null,
    routing: { stagesCompleted: [], stagesAttempted: [] },
    exports: {},
    engineFixes: [],
    blockers: [],
    nextAction: stages[0] || 'none',
    createdAt: now,
    updatedAt: now,
    humanReviewRequired: true,
  }
}

export async function readAutonomousJobState(projectDir) {
  const file = path.join(projectDir, autonomousJobStateFile)
  if (!existsSync(file)) return null
  return JSON.parse(await readFile(file, 'utf8'))
}

export async function writeAutonomousJobState(projectDir, state) {
  const file = path.join(projectDir, autonomousJobStateFile)
  const next = { ...state, updatedAt: new Date().toISOString() }
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return file
}

export function recordStage(state, stage, result = {}) {
  const completed = [...new Set([...(state.completedStages || []), stage])]
  const pending = (state.pendingStages || []).filter((item) => item !== stage)
  return {
    ...state,
    currentStage: pending[0] || 'complete',
    completedStages: completed,
    pendingStages: pending,
    status: result.status || state.status,
    progress: [
      ...(state.progress || []),
      { at: new Date().toISOString(), stage, status: result.status || 'completed', summary: result.summary || null },
    ],
    nextAction: pending[0] || 'complete',
  }
}

export function stopForUserDecision(state, blocker) {
  return {
    ...state,
    status: 'AUTONOMOUS_JOB_NEEDS_USER_DECISION',
    blockers: [...(state.blockers || []), blocker],
    nextAction: blocker.nextAction || 'await_user_decision',
    humanReviewRequired: true,
  }
}

export function stopForBudget(state, budget) {
  return {
    ...state,
    status: 'AUTONOMOUS_JOB_BUDGET_REACHED',
    blockers: [...(state.blockers || []), { type: 'runtime_budget_reached', blocking: false, budget, nextAction: 'resume_boardforge_job' }],
    nextAction: 'resume_boardforge_job',
    humanReviewRequired: true,
  }
}

export function summarizeAutonomousJobState(state) {
  if (!state) return null
  return {
    jobId: state.jobId,
    mode: state.mode,
    projectPath: state.projectPath,
    status: state.status,
    currentStage: state.currentStage,
    completedStages: state.completedStages || [],
    pendingStages: state.pendingStages || [],
    estimate: state.estimate,
    lastErc: state.validation?.erc,
    lastDrc: state.validation?.drc,
    placement: state.placement,
    routing: state.routing,
    exports: state.exports,
    blockers: state.blockers || [],
    nextAction: state.nextAction,
    humanReviewRequired: state.humanReviewRequired !== false,
  }
}

export async function repairImportedProjectLibraries(projectDir) {
  const parent = path.dirname(projectDir)
  const files = await readdir(parent).catch(() => [])
  const fixes = []
  const parentFpTable = path.join(parent, 'fp-lib-table')
  const projectFpTable = path.join(projectDir, 'fp-lib-table')
  if (!existsSync(projectFpTable) && existsSync(parentFpTable)) {
    await copyFile(parentFpTable, projectFpTable)
    fixes.push({ type: 'copied_fp_lib_table', file: projectFpTable })
  }
  const symbolFile = files.find((file) => file.endsWith('.kicad_sym'))
  const symTable = path.join(projectDir, 'sym-lib-table')
  if (symbolFile && !existsSync(symTable)) {
    const name = path.basename(symbolFile, '.kicad_sym')
    const content = `(sym_lib_table\n  (lib (name "${name}") (type "KiCad") (uri "\${KIPRJMOD}/../${symbolFile}") (options "") (descr "BoardForge imported local symbol library"))\n)\n`
    await writeFile(symTable, content, 'utf8')
    fixes.push({ type: 'created_sym_lib_table', file: symTable, symbolFile: path.join(parent, symbolFile) })
  }
  return {
    status: fixes.length ? 'IMPORTED_LIBRARY_CONFIG_REPAIRED' : 'IMPORTED_LIBRARY_CONFIG_CURRENT',
    fixes,
    humanReviewRequired: Boolean(fixes.length),
  }
}

export function stagesForMode(mode = 'full_autonomous') {
  if (mode === 'analyze_only') return ['scan', 'estimate', 'erc', 'erc_analysis', 'drc', 'feasibility', 'final_report']
  if (mode === 'safe_repair') return ['scan', 'estimate', 'repair_libraries', 'erc', 'erc_analysis', 'drc', 'drc_analysis', 'final_report']
  if (mode === 'improve_placement') return ['scan', 'estimate', 'repair_libraries', 'erc', 'erc_analysis', 'feasibility', 'placement_candidates', 'placement_selection', 'final_report']
  if (mode === 'route_only') return ['scan', 'estimate', 'erc', 'erc_analysis', 'drc', 'placement_selection', 'routing_readiness', 'route_staged', 'drc_after_routing', 'final_report']
  return ['scan', 'estimate', 'repair_libraries', 'erc', 'erc_analysis', 'feasibility', 'stackup_migration', 'netclasses', 'drc', 'placement_candidates', 'placement_selection', 'routing_readiness', 'route_staged', 'export', 'final_report']
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} minutes`
  if (minutes < 24 * 60) {
    const hours = minutes / 60
    return Number.isInteger(hours) ? `${hours} hours` : `${Math.round(hours * 10) / 10} hours`
  }
  const days = minutes / (24 * 60)
  return Number.isInteger(days) ? `${days} days` : `${Math.round(days * 10) / 10} days`
}
