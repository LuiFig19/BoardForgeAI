#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { continueAfterCleanupStage, preventMidLoopUserPrompt } from '../lib/jobs.mjs'

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : ''
}

const board = argValue('--board')
const resume = process.argv.includes('--resume')

if (!board) {
  console.error('Usage: npm run boardforge:postroute-supervisor -- --board "<board.kicad_pcb>" --resume')
  process.exit(2)
}

const boardPath = resolve(board)
if (!existsSync(boardPath)) {
  console.error(`Board not found: ${boardPath}`)
  process.exit(2)
}

const workdir = dirname(boardPath)
const statePath = join(workdir, 'boardforge-postroute-supervisor-state.json')
let priorState = {}
if (resume && existsSync(statePath)) {
  priorState = JSON.parse(readFileSync(statePath, 'utf8'))
}

const nextState = preventMidLoopUserPrompt(continueAfterCleanupStage({
  currentBoard: boardPath,
  lastCompletedStage: priorState.lastCompletedStage || '',
  drcReport: {
    types: Object.fromEntries((priorState.pendingDrcFamilies || []).map((item) => [item.family, item.count])),
    unconnected: priorState.unconnected || 0,
  },
  exhaustedStagesThisRun: priorState.exhaustedStagesThisRun || [],
  pluginCwd: process.cwd(),
}))

writeFileSync(statePath, `${JSON.stringify({
  ...priorState,
  ...nextState,
  latestBoard: boardPath,
  shouldAutoResume: true,
}, null, 2)}\n`)

console.log(JSON.stringify({
  board: boardPath,
  statePath,
  nextStage: nextState.nextStage,
  resumeCommand: nextState.resumeCommand,
  userPromptRequired: false,
}, null, 2))
