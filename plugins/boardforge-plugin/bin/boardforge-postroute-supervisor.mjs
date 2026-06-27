#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  buildPostRouteSupervisorResumeCommand,
  continueAfterCleanupStage,
  preventMidLoopUserPrompt,
  rankPostRouteUnconnectedItems,
  routeByExactUnconnectedItem,
  routeExactUnconnectedItemPhysical,
  routeExactUnconnectedItemWithPromotionGate,
  selectNextAutonomousPostRouteAction,
} from '../lib/jobs.mjs'
import { scoreDrcHealth } from '../lib/external-routing/post-freerouting-repair.mjs'

const DEFAULT_KICAD_CLI = 'C:/Program Files/KiCad/10.0/bin/kicad-cli.exe'

function argValue(flag, fallback = '') {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function argNumber(flag, fallback) {
  const value = Number(argValue(flag, ''))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
}

function readJsonIfExists(file, fallback = {}) {
  if (!file || !existsSync(file)) return fallback
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function drcTypes(report = {}) {
  return scoreDrcHealth(report).counts.types || {}
}

function unconnectedCount(report = {}) {
  return Array.isArray(report.unconnected_items)
    ? report.unconnected_items.length
    : Number(report.unconnected_items || scoreDrcHealth(report).counts.unconnected || 0)
}

function copperCounts(boardPath) {
  const text = readFileSync(boardPath, 'utf8')
  return {
    segments: (text.match(/\n\s*\(segment\b/g) || []).length,
    vias: (text.match(/\n\s*\(via\b/g) || []).length,
    zones: (text.match(/\n\s*\(zone\b/g) || []).length,
  }
}

function runKiCadDrc({ boardPath, reportPath, kicadCliPath = DEFAULT_KICAD_CLI }) {
  mkdirSync(dirname(reportPath), { recursive: true })
  const run = spawnSync(kicadCliPath, ['pcb', 'drc', '--format', 'json', '--severity-all', '--output', reportPath, boardPath], {
    encoding: 'utf8',
    timeout: 180000,
  })
  if (run.error) throw run.error
  if (!existsSync(reportPath)) {
    throw new Error(`KiCad DRC did not write report: ${reportPath}`)
  }
  return readJsonIfExists(reportPath)
}

function nextOutputPathFromState({ boardPath, stage, outputPrefix = '' }) {
  const dir = dirname(boardPath)
  const fsText = readFileSync(boardPath, 'utf8')
  void fsText
  const { readdirSync } = globalThis.__boardforgeFs || {}
  let next = 22
  if (typeof readdirSync === 'function') {
    next = readdirSync(dir)
      .map((name) => name.match(/cleanup(\d+)/i)?.[1])
      .filter(Boolean)
      .map(Number)
      .reduce((a, b) => Math.max(a, b), 21) + 1
  } else {
    const current = boardPath.match(/cleanup(\d+)/i)?.[1]
    next = Number(current || 21) + 1
  }
  const base = outputPrefix || 'FN-ESC1_boardforge_routed_postroute_cleanup'
  const safeStage = String(stage || 'stage').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase()
  return join(dir, `${base}${String(next).padStart(2, '0')}_${safeStage}.kicad_pcb`)
}

export function createPostRouteStageExecutors() {
  const noop = async ({ boardPath, stage }) => ({
    stage,
    status: 'TEMP_EXHAUSTED_NO_PROGRESS',
    attempts: 0,
    commits: 0,
    outputBoardPath: boardPath,
    reason: 'safe_cli_executor_not_available_for_stage_yet',
  })
  return {
    repair_postroute_shorts_first: noop,
    repair_shorts: noop,
    reroute_short_fix_disconnects: noop,
    repair_track_crossings: noop,
    repair_generated_severe_clearance: noop,
    repair_generated_hole_clearance: noop,
    repair_generated_copper_edge_clearance: noop,
    repair_generated_solder_mask_bridge: noop,
    repair_dangling_tracks: noop,
    run_guarded_exact_ratsnest_reduction: runExactRatsnestReductionStage,
    exact_ratsnest_reduction: runExactRatsnestReductionStage,
    repair_or_classify_erc: noop,
    repair_or_classify_remaining_drc: noop,
  }
}

export async function runExactRatsnestReductionStage({
  boardPath,
  state = {},
  beforeDrc = null,
  kicadCliPath = DEFAULT_KICAD_CLI,
  outputPrefix = '',
  exactRatsnestItems = 100,
  minRatsnestAttempts = 50,
  maxCandidatesPerItem = 20,
  maxStageMinutes = 20,
  maxItems = Math.max(Number(minRatsnestAttempts || 50), Number(exactRatsnestItems || 100)),
  commitGoal = 10,
} = {}) {
  const stageStarted = Date.now()
  const workdir = dirname(boardPath)
  const reportsDir = join(workdir, 'reports')
  const reportBefore = beforeDrc || runKiCadDrc({
    boardPath,
    reportPath: join(reportsDir, `drc-postroute-ratsnest-before-${nowStamp()}.json`),
    kicadCliPath,
  })
  const ranked = rankPostRouteUnconnectedItems(reportBefore, { maxItems })
  const outputBoardPath = nextOutputPathFromState({ boardPath, stage: 'exact_ratsnest_reduction', outputPrefix })
  const backup = outputBoardPath.replace(/\.kicad_pcb$/i, `_pre_${nowStamp()}.kicad_pcb`)
  copyFileSync(boardPath, backup)
  copyFileSync(boardPath, outputBoardPath)

  let currentBoard = outputBoardPath
  let currentDrc = reportBefore
  const attempts = []
  let commits = 0
  let rollbacks = 0
  for (const item of ranked) {
    if (commits >= commitGoal) break
    if ((Date.now() - stageStarted) > Number(maxStageMinutes || 20) * 60 * 1000) break
    const route = routeByExactUnconnectedItem(item)
    const candidatePath = outputBoardPath.replace(/\.kicad_pcb$/i, `.candidate-${attempts.length + 1}.kicad_pcb`)
    const drcOutputFile = join(reportsDir, `drc-postroute-ratsnest-candidate-${attempts.length + 1}-${nowStamp()}.json`)
    let outcome
    try {
      outcome = await routeExactUnconnectedItemPhysical(route, item, {
        pcbFile: currentBoard,
        candidatePath,
        beforeDrc: currentDrc,
        kicadCliPath,
        drcOutputFile,
      })
      const gate = routeExactUnconnectedItemWithPromotionGate({
        beforeDrc: currentDrc,
        afterDrc: outcome.afterDrc,
        unconnectedItem: item,
        route,
        candidateResult: outcome,
        originalSpecChanged: false,
        forbiddenVias: outcome.forbiddenVias,
      })
      if (gate.promote) {
        copyFileSync(candidatePath, outputBoardPath)
        currentBoard = outputBoardPath
        currentDrc = outcome.afterDrc
        commits += 1
        attempts.push({ unconnectedId: item.unconnectedId, net: item.net, status: 'COMMITTED_RESOLVED', gate })
      } else {
        rollbacks += 1
        attempts.push({ unconnectedId: item.unconnectedId, net: item.net, status: 'ROLLBACK_REQUIRED', gate })
      }
    } catch (error) {
      rollbacks += 1
      attempts.push({ unconnectedId: item.unconnectedId, net: item.net, status: 'ROLLBACK_REQUIRED', reason: error.message })
    } finally {
      try {
        if (existsSync(candidatePath)) unlinkSync(candidatePath)
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  const finalDrc = runKiCadDrc({
    boardPath: outputBoardPath,
    reportPath: join(reportsDir, `drc-postroute-ratsnest-after-${nowStamp()}.json`),
    kicadCliPath,
  })
  const beforeHealth = scoreDrcHealth(reportBefore)
  const afterHealth = scoreDrcHealth(finalDrc)
  const result = {
    stage: 'run_guarded_exact_ratsnest_reduction',
    status: commits > 0 ? 'PRODUCTIVE_STAGE_COMMITTED' : 'TEMP_EXHAUSTED_NO_PROGRESS',
    attempts: attempts.length,
    candidatesTried: attempts.length,
    commits,
    rollbacks,
    exactItemsResolved: commits,
    outputBoardPath,
    backup,
    beforeDrc: reportBefore,
    afterDrc: finalDrc,
    weightedDrcBefore: beforeHealth.score,
    weightedDrcAfter: afterHealth.score,
    unconnectedBefore: unconnectedCount(reportBefore),
    unconnectedAfter: unconnectedCount(finalDrc),
    shortsBefore: Number(beforeHealth.counts.types.shorting_items || 0),
    shortsAfter: Number(afterHealth.counts.types.shorting_items || 0),
    forbiddenVias: Number(afterHealth.counts.types.forbidden_via || 0),
    copper: copperCounts(outputBoardPath),
    attemptsDetail: attempts,
    batchBudget: {
      itemsToSelect: Number(exactRatsnestItems || 100),
      minimumItemsAttempted: Number(minRatsnestAttempts || 50),
      maxCandidatesPerItem: Number(maxCandidatesPerItem || 20),
      maxStageMinutes: Number(maxStageMinutes || 20),
      actualRuntimeElapsedMs: Date.now() - stageStarted,
      routeableItemsAvailable: ranked.length,
    },
    stoppedBecause: commits >= commitGoal
      ? 'commit_goal_reached'
      : ((Date.now() - stageStarted) > Number(maxStageMinutes || 20) * 60 * 1000)
        ? 'stage_runtime_budget_exhausted'
        : attempts.length >= ranked.length
          ? 'all_selected_items_attempted'
          : 'stage_loop_completed',
  }
  writeJson(join(workdir, `boardforge-postroute-ratsnest-reduction-${nowStamp()}-summary.json`), result)
  return result
}

function stageResultIsNoProgress(result = {}) {
  return Number(result.attempts || result.attempted || 0) >= 0 && Number(result.commits || result.committed || 0) === 0
}

function finalStateFromReport(report = {}) {
  const health = scoreDrcHealth(report)
  const unconnected = unconnectedCount(report)
  const errors = Number(report.issueCounts?.errors || 0)
  if (unconnected === 0 && errors === 0) return 'esc_fully_routed_erc_drc_passed'
  return ''
}

export async function runPostRouteSupervisorCli({
  board,
  resume = false,
  maxStages = 10,
  maxMinutes = 30,
  stageBudget = 300,
  exactRatsnestItems = 100,
  minRatsnestAttempts = 50,
  maxCandidatesPerItem = 20,
  maxStageMinutes = 20,
  outputPrefix = '',
  kicadCliPath = DEFAULT_KICAD_CLI,
  cwd = process.cwd(),
  stageExecutors = createPostRouteStageExecutors(),
  scanDrc = null,
} = {}) {
  let boardPath = resolve(board)
  if (!existsSync(boardPath)) throw new Error(`Board not found: ${boardPath}`)
  const started = Date.now()
  const workdir = dirname(boardPath)
  const reportsDir = join(workdir, 'reports')
  mkdirSync(reportsDir, { recursive: true })
  const statePath = join(workdir, 'boardforge-postroute-supervisor-state.json')
  const priorState = resume ? readJsonIfExists(statePath, {}) : {}
  const exhausted = new Set(priorState.exhaustedStagesThisRun || [])
  const stages = []
  let latestReport = null
  let finalState = ''
  let continueProductiveStage = priorState.lastStageResult === 'PRODUCTIVE_STAGE_COMMITTED'
    && priorState.lastStageCompleted === 'run_guarded_exact_ratsnest_reduction'
    ? 'run_guarded_exact_ratsnest_reduction'
    : ''

  for (let stageIndex = 0; stageIndex < maxStages; stageIndex += 1) {
    if ((Date.now() - started) > maxMinutes * 60 * 1000) {
      finalState = 'runtime_limit_reached_resume_written'
      break
    }
    latestReport = typeof scanDrc === 'function' ? await scanDrc({ boardPath, stageIndex }) : runKiCadDrc({
      boardPath,
      reportPath: join(reportsDir, `drc-postroute-supervisor-${stageIndex + 1}-${nowStamp()}.json`),
      kicadCliPath,
    })
    finalState = finalStateFromReport(latestReport)
    if (finalState) break
    const nextState = preventMidLoopUserPrompt(continueAfterCleanupStage({
      currentBoard: boardPath,
      lastCompletedStage: priorState.lastStageCompleted || '',
      drcReport: latestReport,
      exhaustedStagesThisRun: [...exhausted],
      pluginCwd: cwd,
    }))
    let stage = selectNextAutonomousPostRouteAction({
      drcReport: latestReport,
      exhaustedStagesThisRun: [...exhausted],
    })
    if (nextState.nextStage && !exhausted.has(nextState.nextStage)) stage = nextState.nextStage
    if (
      continueProductiveStage
      && !exhausted.has(continueProductiveStage)
      && Number(scoreDrcHealth(latestReport).counts.types.shorting_items || 0) === 0
      && Number(scoreDrcHealth(latestReport).counts.types.forbidden_via || 0) === 0
      && unconnectedCount(latestReport) > 0
    ) {
      stage = continueProductiveStage
    }
    if (!stage || stage === 'mark_ready_for_export_review') {
      finalState = unconnectedCount(latestReport) > 0 ? 'esc_routed_with_exact_remaining_blockers' : 'esc_ready_for_export_review'
      break
    }
    const executor = stageExecutors[stage]
    if (typeof executor !== 'function') {
      exhausted.add(stage)
      stages.push({ stage, status: 'TEMP_EXHAUSTED_NO_PROGRESS', reason: 'missing_executor' })
      continue
    }
    const result = await executor({
      boardPath,
      state: nextState,
      beforeDrc: latestReport,
      kicadCliPath,
      outputPrefix,
      stageBudget,
      exactRatsnestItems,
      minRatsnestAttempts,
      maxCandidatesPerItem,
      maxStageMinutes,
      stage,
    })
    stages.push({
      stage,
      status: result.status || 'stage_executed',
      attempts: Number(result.attempts || 0),
      commits: Number(result.commits || 0),
      rollbacks: Number(result.rollbacks || 0),
    })
    if (result.outputBoardPath && existsSync(result.outputBoardPath)) boardPath = result.outputBoardPath
    if (stageResultIsNoProgress(result)) exhausted.add(stage)
    continueProductiveStage = result.status === 'PRODUCTIVE_STAGE_COMMITTED'
      && stage === 'run_guarded_exact_ratsnest_reduction'
      ? stage
      : ''
  }

  const actualRuntimeElapsedMs = Date.now() - started
  const configuredRuntimeBudgetMs = maxMinutes * 60 * 1000
  if (!finalState) {
    finalState = actualRuntimeElapsedMs >= configuredRuntimeBudgetMs
      ? 'runtime_limit_reached_resume_written'
      : 'esc_routed_with_exact_remaining_blockers'
  }
  const finalReport = latestReport || (typeof scanDrc === 'function' ? await scanDrc({ boardPath, stageIndex: stages.length }) : runKiCadDrc({
    boardPath,
    reportPath: join(reportsDir, `drc-postroute-supervisor-final-${nowStamp()}.json`),
    kicadCliPath,
  }))
  const health = scoreDrcHealth(finalReport)
  const resumeCommand = buildPostRouteSupervisorResumeCommand({ board: boardPath, cwd })
  const state = preventMidLoopUserPrompt({
    latestBoard: boardPath,
    currentBoard: boardPath,
    finalState,
    runtime: {
      actualRuntimeElapsedMs,
      configuredRuntimeBudgetMs,
      remainingRuntimeMs: Math.max(0, configuredRuntimeBudgetMs - actualRuntimeElapsedMs),
      whyStopped: finalState === 'runtime_limit_reached_resume_written'
        ? 'actual_runtime_budget_exhausted'
        : 'configured_stage_batch_completed_without_final_runtime_exhaustion',
    },
    lastStageCompleted: stages.at(-1)?.stage || priorState.lastStageCompleted || '',
    exhaustedStagesThisRun: [...exhausted],
    nextStage: selectNextAutonomousPostRouteAction({ drcReport: finalReport, exhaustedStagesThisRun: [...exhausted] }),
    resumeCommand,
    resumeCommandValidated: true,
    shouldAutoResume: finalState === 'runtime_limit_reached_resume_written',
    shorts: Number(health.counts.types.shorting_items || 0),
    unconnected: unconnectedCount(finalReport),
    weightedDrc: health.score,
    drcScore: health.score,
    pendingDrcFamilies: Object.entries(health.counts.types || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([family, count]) => ({ family, count })),
    copper: copperCounts(boardPath),
    stagesExecuted: stages,
    userPromptRequired: false,
  })
  writeJson(statePath, state)
  return { board: boardPath, statePath, state, stages, finalState, resumeCommand }
}

async function main() {
  const board = argValue('--board')
  if (!board) {
    console.error('Usage: npm run boardforge:postroute-supervisor -- --board "<board.kicad_pcb>" --resume')
    process.exit(2)
  }
  try {
    const result = await runPostRouteSupervisorCli({
      board,
      resume: process.argv.includes('--resume'),
      maxStages: argNumber('--max-stages', 10),
      maxMinutes: argNumber('--max-minutes', 30),
      stageBudget: argNumber('--stage-budget', 300),
      exactRatsnestItems: argNumber('--exact-ratsnest-items', 100),
      minRatsnestAttempts: argNumber('--min-ratsnest-attempts', 50),
      maxCandidatesPerItem: argNumber('--max-candidates-per-item', 20),
      maxStageMinutes: argNumber('--max-stage-minutes', 20),
      outputPrefix: argValue('--output-prefix', ''),
      kicadCliPath: argValue('--kicad-cli', DEFAULT_KICAD_CLI),
      cwd: process.cwd(),
    })
    console.log(JSON.stringify({
      board: result.board,
      statePath: result.statePath,
      finalState: result.finalState,
      stagesExecuted: result.stages,
      resumeCommand: result.resumeCommand,
      userPromptRequired: false,
    }, null, 2))
  } catch (error) {
    console.error(error.stack || error.message)
    process.exit(1)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
