#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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
    transactional_reroute_of_blocking_generated_copper: runTransactionalRerouteOfBlockingGeneratedCopper,
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

function parsePcbNets(text = '') {
  const nets = new Map()
  for (const match of text.matchAll(/\(net\s+(\d+)\s+"([^"]+)"\)/g)) nets.set(Number(match[1]), match[2])
  return nets
}

function parsePcbSegments(text = '') {
  const nets = parsePcbNets(text)
  const segments = []
  const singleLine = text.split(/\r?\n/).filter((line) => /\(segment\b/.test(line) && /\(start\b/.test(line) && /\(end\b/.test(line))
  const multiLine = []
  let current = []
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\(segment\b/.test(line)) current = [line]
    else if (current.length) current.push(line)
    if (current.length && /^\s*\)\s*$/.test(line)) {
      multiLine.push(current.join('\n'))
      current = []
    }
  }
  for (const raw of [...singleLine, ...multiLine]) {
    const start = raw.match(/\(start\s+([-\d.]+)\s+([-\d.]+)\)/)
    const end = raw.match(/\(end\s+([-\d.]+)\s+([-\d.]+)\)/)
    const layer = raw.match(/\(layer\s+"?([A-Za-z0-9_.]+)"?\)/)
    const net = raw.match(/\(net\s+(?:"([^"]+)"|(\d+))\)/)
    if (!start || !end || !net) continue
    const netId = Number(net[2])
    segments.push({
      raw,
      start: { x: Number(start[1]), y: Number(start[2]) },
      end: { x: Number(end[1]), y: Number(end[2]) },
      layer: layer?.[1] || '',
      netId: Number.isFinite(netId) ? netId : null,
      net: net[1] || nets.get(netId) || '',
      source: 'FreeRouting / BoardForge',
      canReroute: true,
    })
  }
  return segments
}

function distancePointToSegment(point, start, end) {
  const px = Number(point.x)
  const py = Number(point.y)
  const sx = Number(start.x)
  const sy = Number(start.y)
  const ex = Number(end.x)
  const ey = Number(end.y)
  const dx = ex - sx
  const dy = ey - sy
  const len2 = dx * dx + dy * dy
  if (!len2) return Math.hypot(px - sx, py - sy)
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / len2))
  return Math.hypot(px - (sx + t * dx), py - (sy + t * dy))
}

function segmentDistance(a, b) {
  return Math.min(
    distancePointToSegment(a.start, b.start, b.end),
    distancePointToSegment(a.end, b.start, b.end),
    distancePointToSegment(b.start, a.start, a.end),
    distancePointToSegment(b.end, a.start, a.end),
  )
}

export function identifyGeneratedCopperBlockingRatsnest({ boardText = '', blocker = {}, maxObjects = 3 } = {}) {
  const source = blocker.sourceCoord || {}
  const target = blocker.targetCoord || {}
  if (!Number.isFinite(Number(source.x)) || !Number.isFinite(Number(target.x))) return []
  const routeSegment = { start: source, end: target }
  return parsePcbSegments(boardText)
    .filter((segment) => segment.net && segment.net !== blocker.net)
    .map((segment) => ({
      ...segment,
      distanceToBlockedRouteMm: segmentDistance(segment, routeSegment),
    }))
    .filter((segment) => segment.distanceToBlockedRouteMm <= 0.75)
    .sort((a, b) => a.distanceToBlockedRouteMm - b.distanceToBlockedRouteMm)
    .slice(0, maxObjects)
}

function removeSegmentRaw(boardText, raw) {
  return boardText.replace(`\n${raw}`, '\n')
}

function transactionFailureReason({ blockingObjects = [], gate = null, error = null } = {}) {
  if (!blockingObjects.length) return 'blockingCopperNotGenerated'
  if (error) return /forbidden/i.test(error.message) ? 'forbiddenViaPolicy' : 'noLegalPathAfterCopperMove'
  if (gate?.worsenedCriticalFamilies?.some((item) => /short/i.test(String(item)))) return 'shortsReintroduced'
  if (gate?.worsenedCriticalFamilies?.length) return 'clearanceRegression'
  if (gate && !gate.exactUnconnectedItemResolved && !gate.targetNetUnconnectedReduced && !gate.netIslandsReduced) return 'rerouteDisplacedNetFailed'
  return 'clearanceRegression'
}

export async function runTransactionalRerouteOfBlockingGeneratedCopper({
  boardPath,
  beforeDrc = null,
  kicadCliPath = DEFAULT_KICAD_CLI,
  outputPrefix = '',
  transactionsToAttempt = 20,
  blockerRowsToAnalyze = 50,
  commitGoal = 5,
} = {}) {
  const workdir = dirname(boardPath)
  const reportsDir = join(workdir, 'reports')
  mkdirSync(reportsDir, { recursive: true })
  const reportBefore = beforeDrc || runKiCadDrc({
    boardPath,
    reportPath: join(reportsDir, `drc-postroute-generated-copper-before-${nowStamp()}.json`),
    kicadCliPath,
  })
  const manifestInfo = buildRemainingBlockerManifest({
    drcReport: reportBefore,
    ratsnestSummary: latestRatsnestSummary(workdir),
    boardPath,
    workdir,
  })
  const blockers = (manifestInfo.manifest.blockers || [])
    .filter((blocker) => blocker.drcFailureFamily === 'shortRisk')
    .slice(0, blockerRowsToAnalyze)
  const outputBoardPath = nextOutputPathFromState({ boardPath, stage: 'transactional_generated_copper_reroute', outputPrefix })
  const backup = outputBoardPath.replace(/\.kicad_pcb$/i, `_pre_${nowStamp()}.kicad_pcb`)
  copyFileSync(boardPath, backup)
  copyFileSync(boardPath, outputBoardPath)

  let currentBoard = outputBoardPath
  let currentDrc = reportBefore
  let commits = 0
  let rollbacks = 0
  const transactions = []
  const blockedBy = {
    blockingCopperNotGenerated: 0,
    rerouteDisplacedNetFailed: 0,
    shortsReintroduced: 0,
    clearanceRegression: 0,
    noLegalPathAfterCopperMove: 0,
    forbiddenViaPolicy: 0,
  }

  for (const blocker of blockers) {
    if (transactions.length >= transactionsToAttempt || commits >= commitGoal) break
    const currentText = readFileSync(currentBoard, 'utf8')
    const blockingObjects = identifyGeneratedCopperBlockingRatsnest({ boardText: currentText, blocker, maxObjects: 1 })
    const transactionId = `TX_${String(transactions.length + 1).padStart(3, '0')}`
    if (!blockingObjects.length) {
      rollbacks += 1
      blockedBy.blockingCopperNotGenerated += 1
      transactions.push({ transactionId, blocker, status: 'BLOCKED_FIXED_OBJECT', blockingGeneratedObjects: [] })
      continue
    }
    const removedPath = outputBoardPath.replace(/\.kicad_pcb$/i, `.transaction-${transactions.length + 1}-removed.kicad_pcb`)
    const candidatePath = outputBoardPath.replace(/\.kicad_pcb$/i, `.transaction-${transactions.length + 1}-candidate.kicad_pcb`)
    let gate = null
    let failure = null
    try {
      writeFileSync(removedPath, removeSegmentRaw(currentText, blockingObjects[0].raw))
      const route = routeByExactUnconnectedItem({
        ...blocker,
        source: { ref: blocker.sourceRef, pad: blocker.sourcePad, x: blocker.sourceCoord?.x, y: blocker.sourceCoord?.y, net: blocker.net },
        target: { ref: blocker.targetRef, pad: blocker.targetPad, x: blocker.targetCoord?.x, y: blocker.targetCoord?.y, net: blocker.net },
      })
      const outcome = await routeExactUnconnectedItemPhysical(route, blocker, {
        pcbFile: removedPath,
        candidatePath,
        beforeDrc: currentDrc,
        kicadCliPath,
        drcOutputFile: join(reportsDir, `drc-postroute-generated-copper-transaction-${transactions.length + 1}-${nowStamp()}.json`),
      })
      gate = routeExactUnconnectedItemWithPromotionGate({
        beforeDrc: currentDrc,
        afterDrc: outcome.afterDrc,
        unconnectedItem: blocker,
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
        transactions.push({ transactionId, blocker, status: 'COMMITTED_IMPROVED', blockingGeneratedObjects: blockingObjects, gate })
      } else {
        const reason = transactionFailureReason({ blockingObjects, gate })
        blockedBy[reason] = Number(blockedBy[reason] || 0) + 1
        rollbacks += 1
        transactions.push({ transactionId, blocker, status: 'ROLLED_BACK_UNSAFE', blockingGeneratedObjects: blockingObjects, gate, reason })
      }
    } catch (error) {
      failure = transactionFailureReason({ blockingObjects, error })
      blockedBy[failure] = Number(blockedBy[failure] || 0) + 1
      rollbacks += 1
      transactions.push({ transactionId, blocker, status: 'ROLLED_BACK_NO_CONNECTIVITY', blockingGeneratedObjects: blockingObjects, reason: failure, error: error.message })
    } finally {
      for (const path of [removedPath, candidatePath]) {
        try {
          if (existsSync(path)) unlinkSync(path)
        } catch {
          // Best-effort cleanup only.
        }
      }
    }
  }

  const finalDrc = runKiCadDrc({
    boardPath: outputBoardPath,
    reportPath: join(reportsDir, `drc-postroute-generated-copper-after-${nowStamp()}.json`),
    kicadCliPath,
  })
  const beforeHealth = scoreDrcHealth(reportBefore)
  const afterHealth = scoreDrcHealth(finalDrc)
  const result = {
    stage: 'transactional_reroute_of_blocking_generated_copper',
    status: commits > 0 ? 'PRODUCTIVE_STAGE_COMMITTED' : 'TEMP_EXHAUSTED_NO_PROGRESS',
    outputBoardPath,
    backup,
    blockerRowsAnalyzed: blockers.length,
    blockingGeneratedObjectsFound: transactions.reduce((sum, item) => sum + (item.blockingGeneratedObjects?.length || 0), 0),
    attempts: transactions.length,
    commits,
    rollbacks,
    displacedNetsRerouted: commits,
    beforeDrc: reportBefore,
    afterDrc: finalDrc,
    unconnectedBefore: unconnectedCount(reportBefore),
    unconnectedAfter: unconnectedCount(finalDrc),
    weightedDrcBefore: beforeHealth.score,
    weightedDrcAfter: afterHealth.score,
    shortsBefore: Number(beforeHealth.counts.types.shorting_items || 0),
    shortsAfter: Number(afterHealth.counts.types.shorting_items || 0),
    forbiddenVias: Number(afterHealth.counts.types.forbidden_via || 0),
    blockedBy,
    transactions,
  }
  writeJson(join(workdir, `boardforge-postroute-generated-copper-transaction-${nowStamp()}-summary.json`), result)
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

function latestRatsnestSummary(workdir) {
  const files = readdirSync(workdir)
    .filter((name) => /^boardforge-postroute-ratsnest-reduction-.*-summary\.json$/.test(name))
    .map((name) => join(workdir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return files[0] ? readJsonIfExists(files[0], {}) : {}
}

function categorizeFailedAttempt(attempt = {}) {
  const gate = attempt.gate || {}
  const critical = gate.worsenedCriticalFamilies || []
  const reasonText = `${attempt.reason || ''} ${gate.reason || ''} ${critical.join(' ')}`.toLowerCase()
  if (/forbidden/.test(reasonText) || Number(gate.forbiddenVias || 0) > 0) return 'forbiddenViaPolicy'
  if (/short|crossing/.test(reasonText) || critical.some((item) => /short|crossing/.test(String(item)))) return 'shortRisk'
  if (/edge/.test(reasonText)) return 'edgeClearance'
  if (/hole/.test(reasonText)) return 'holeClearance'
  if (/keepout/.test(reasonText)) return 'keepout'
  if (/pad|binding/.test(reasonText)) return 'padBinding'
  if (/clearance/.test(reasonText)) return 'clearance'
  if (gate.scoreDidNotWorsen === false || Number(gate.weightedScoreDelta || 0) > 0) return 'drcRegression'
  if (/no legal path|no route|blocked/.test(reasonText)) return 'noLegalPath'
  return 'other'
}

function blockerFixesFor(category, item = {}) {
  const fixes = []
  if (['clearance', 'drcRegression', 'shortRisk'].includes(category)) fixes.push('reroute generated copper', 'change layer', 'use dogleg')
  if (category === 'edgeClearance') fixes.push('move route inward from Edge.Cuts', 'change layer', 'reroute generated copper')
  if (category === 'holeClearance') fixes.push('move via to legal through-via site', 'dogleg around hole clearance')
  if (category === 'noLegalPath') fixes.push('run second FreeRouting pass', 'reroute generated copper', 'move existing component inside outline')
  if (category === 'padBinding') fixes.push('repair pad contact geometry', 'use dogleg from pad escape')
  if (!fixes.length) fixes.push('run second FreeRouting pass', 'targeted reroute after DRC cleanup')
  if (/^\/M\d+_.*SW|VBAT|PGND|GND/i.test(String(item.net || ''))) fixes.push('route hard power/switching nets after cleanup')
  return [...new Set(fixes)]
}

export function categorizeExactRatsnestFailures(summary = {}) {
  const categories = {
    shortRisk: 0,
    clearance: 0,
    edgeClearance: 0,
    keepout: 0,
    holeClearance: 0,
    padBinding: 0,
    noLegalPath: 0,
    forbiddenViaPolicy: 0,
    drcRegression: 0,
    other: 0,
  }
  const attempts = summary.attemptsDetail || []
  for (const attempt of attempts) categories[categorizeFailedAttempt(attempt)] += 1
  return {
    attempts: Number(summary.attempts || attempts.length || 0),
    commits: Number(summary.commits || 0),
    failuresByReason: categories,
    topFailedItems: attempts.slice(0, 20).map((attempt) => ({
      unconnectedId: attempt.unconnectedId || '',
      net: attempt.net || '',
      status: attempt.status || '',
      reason: categorizeFailedAttempt(attempt),
      weightedScoreDelta: attempt.gate?.weightedScoreDelta ?? null,
      worsenedCriticalFamilies: attempt.gate?.worsenedCriticalFamilies || [],
    })),
  }
}

function selectStrategyFromBlockers({ failureAnalysis = {}, blockers = [] } = {}) {
  const reasons = failureAnalysis.failuresByReason || {}
  const dominant = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0] || ['other', 0]
  if (dominant[0] === 'clearance' || dominant[0] === 'drcRegression' || dominant[0] === 'shortRisk') {
    return { selected: 'transactional_reroute_of_blocking_generated_copper', reason: `${dominant[1]} failed attempts were blocked by ${dominant[0]} risk`, executed: false }
  }
  if (dominant[0] === 'edgeClearance') return { selected: 'generated_copper_edge_clearance_repair', reason: 'edge clearance dominated failed candidates', executed: false }
  if (dominant[0] === 'holeClearance') return { selected: 'generated_hole_clearance_repair', reason: 'hole clearance dominated failed candidates', executed: false }
  if (dominant[0] === 'noLegalPath' || blockers.some((item) => item.possibleFixes?.includes('run second FreeRouting pass'))) {
    return { selected: 'second_freerouting_pass_on_current_cleaned_board', reason: 'remaining items appear globally congested or no-legal-path constrained', executed: false }
  }
  return { selected: 'remaining_drc_classification_export_review', reason: 'exact ratsnest and generated cleanup stages are exhausted under current rules', executed: true }
}

export function buildRemainingBlockerManifest({ drcReport = {}, ratsnestSummary = {}, boardPath = '', workdir = dirname(boardPath) } = {}) {
  const ranked = rankPostRouteUnconnectedItems(drcReport, { maxItems: 50, deferHardPower: false })
  const attempts = ratsnestSummary.attemptsDetail || []
  const attemptsById = new Map()
  for (const attempt of attempts) {
    const key = attempt.unconnectedId || `${attempt.net || ''}:${attempt.sourceRef || ''}:${attempt.targetRef || ''}`
    attemptsById.set(key, [...(attemptsById.get(key) || []), attempt])
  }
  const blockers = ranked.map((item, index) => {
    const key = item.unconnectedId || `${item.net || ''}:${item.sourceRef || ''}:${item.targetRef || ''}`
    const itemAttempts = attemptsById.get(key) || attempts.filter((attempt) => attempt.net === item.net).slice(0, 1)
    const category = itemAttempts.length ? categorizeFailedAttempt(itemAttempts.at(-1)) : 'noLegalPath'
    return {
      blockerId: `BLOCKER_${String(index + 1).padStart(3, '0')}`,
      net: item.net || '',
      sourceRef: item.sourceRef || '',
      sourcePad: item.sourcePad || '',
      targetRef: item.targetRef || '',
      targetPad: item.targetPad || '',
      sourceCoord: item.sourceCoord || {},
      targetCoord: item.targetCoord || {},
      netRole: item.netRole || item.routeRole || 'signal',
      distanceMm: item.distanceMm ?? null,
      routeAttempts: itemAttempts.length,
      lastFailureReason: category,
      drcFailureFamily: category,
      blockedBy: [category],
      possibleFixes: blockerFixesFor(category, item),
      requiresUserApproval: category === 'forbiddenViaPolicy',
    }
  })
  const failureAnalysis = categorizeExactRatsnestFailures(ratsnestSummary)
  const strategy = selectStrategyFromBlockers({ failureAnalysis, blockers })
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    boardPath,
    remainingUnconnected: unconnectedCount(drcReport),
    blockersCategorized: blockers.length,
    topBlockerFamilies: failureAnalysis.failuresByReason,
    failedRatsnestAttemptAnalysis: failureAnalysis,
    nextStrategy: strategy,
    blockers,
  }
  const jsonPath = join(workdir, 'boardforge-esc-remaining-blocker-manifest.json')
  const mdPath = join(workdir, 'BoardForge_ESC_Remaining_Blocker_Manifest.md')
  writeJson(jsonPath, manifest)
  writeFileSync(mdPath, renderBlockerManifestMarkdown(manifest))
  return { manifest, jsonPath, mdPath }
}

function renderBlockerManifestMarkdown(manifest = {}) {
  const rows = (manifest.blockers || []).slice(0, 50).map((item) => (
    `| ${item.blockerId} | ${item.net} | ${item.sourceRef || '?'}:${item.sourcePad || '?'} | ${item.targetRef || '?'}:${item.targetPad || '?'} | ${item.drcFailureFamily} | ${item.possibleFixes.join('; ')} |`
  ))
  return `# BoardForge ESC Remaining Blocker Manifest

- Board: ${manifest.boardPath}
- Remaining unconnected: ${manifest.remainingUnconnected}
- Blockers categorized: ${manifest.blockersCategorized}
- Next strategy: ${manifest.nextStrategy?.selected}
- Strategy reason: ${manifest.nextStrategy?.reason}

## Failed Ratsnest Attempt Analysis

\`\`\`json
${JSON.stringify(manifest.failedRatsnestAttemptAnalysis, null, 2)}
\`\`\`

## Top Blockers

| ID | Net | Source | Target | Failure | Possible fixes |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`
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
  let continueProductiveStage = String(priorState.lastStageResult || '').startsWith('PRODUCTIVE_STAGE_COMMITTED')
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
    const manifestStrategy = priorState.remainingBlockerManifest?.nextStrategy?.selected
    if (
      (!stage || stage === 'mark_ready_for_export_review')
      && manifestStrategy === 'transactional_reroute_of_blocking_generated_copper'
      && !exhausted.has('transactional_reroute_of_blocking_generated_copper')
    ) {
      stage = 'transactional_reroute_of_blocking_generated_copper'
    }
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
    continueProductiveStage = String(result.status || '').startsWith('PRODUCTIVE_STAGE_COMMITTED')
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
  let blockerManifest = null
  if (finalState === 'esc_routed_with_exact_remaining_blockers') {
    blockerManifest = buildRemainingBlockerManifest({
      drcReport: finalReport,
      ratsnestSummary: latestRatsnestSummary(workdir),
      boardPath,
      workdir,
    })
    finalState = 'esc_routed_with_exact_remaining_blockers_AND_manifest_written'
  }
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
    remainingBlockerManifest: blockerManifest ? {
      json: blockerManifest.jsonPath,
      markdown: blockerManifest.mdPath,
      blockersCategorized: blockerManifest.manifest.blockersCategorized,
      nextStrategy: blockerManifest.manifest.nextStrategy,
    } : priorState.remainingBlockerManifest || null,
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
