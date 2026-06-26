#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.join(pluginRoot, 'tmp', 'category-exports-test')
const reportFile = path.join(workspace, 'reports', 'boardforge-targeted-repair-report.json')
const childTimeoutMs = Number(process.env.BOARDFORGE_CATEGORY_EXPORT_TIMEOUT_MS || 240000)

await runTargetedExportReport()
const report = JSON.parse(await readFile(reportFile, 'utf8'))
const failures = []
for (const fixture of ['robotics', 'industrial', 'poe']) {
  const result = report.results?.find((item) => item.fixture === fixture)
  if (!result) {
    failures.push(`${fixture}: missing result`)
    continue
  }
  if (result.schematicValidation?.erc?.errors !== 0) failures.push(`${fixture}: ERC errors ${result.schematicValidation?.erc?.errors}`)
  if (result.after?.errors !== 0) failures.push(`${fixture}: DRC errors ${result.after?.errors}`)
  const manufacturing = result.manufacturing || {}
  if (manufacturing.blocked) failures.push(`${fixture}: manufacturing blocked (${manufacturing.status})`)
  for (const [label, artifact] of Object.entries({
    bom: manufacturing.exports?.bom,
    cpl: manufacturing.exports?.cpl,
    jlcpcbZip: manufacturing.exports?.jlcpcbZip,
    packageValidation: manufacturing.exports?.packageValidation,
  })) {
    if (artifact?.status !== 'generated') failures.push(`${fixture}: ${label} not generated`)
    else await assertNonEmpty(`${fixture}: ${label}`, artifact.path, failures)
  }
  for (const [label, group] of Object.entries({
    gerbers: manufacturing.exports?.gerbers,
    drill: manufacturing.exports?.drill,
  })) {
    if (group?.status !== 'generated' || !group.files?.length) failures.push(`${fixture}: ${label} not generated`)
    else {
      for (const file of group.files) await assertNonEmpty(`${fixture}: ${label}`, file, failures)
    }
  }
  const packageStatus = manufacturing.packageValidation?.status || ''
  if (/BLOCKED|FAILED|not_validated/i.test(packageStatus)) failures.push(`${fixture}: package validation ${packageStatus}`)
  if (!manufacturing.reviewReport) failures.push(`${fixture}: manufacturing review report missing`)
  else await assertNonEmpty(`${fixture}: review report`, manufacturing.reviewReport, failures)
}

const summary = {
  status: failures.length ? 'CATEGORY_EXPORT_ASSERTION_FAILED' : 'CATEGORY_EXPORT_ASSERTION_PASSED',
  reportFile,
  failures,
}
console.log(JSON.stringify(summary, null, 2))
if (failures.length) process.exit(1)

async function runTargetedExportReport() {
  await new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(process.execPath, [
      path.join(pluginRoot, 'bin', 'boardforge-targeted-repair.mjs'),
      '--workspace', workspace,
      '--fixture', 'all',
      '--fixture-budget-ms', '120000',
      '--repair-budget-ms', '60000',
      '--cluster-limit', '0',
      '--plan-net-budget', '4',
      '--leg-budget', '6',
      '--astar-budget', '3500',
      '--candidate-budget', '8',
      '--pair-candidate-budget', '24',
      '--fresh',
    ], { cwd: pluginRoot, windowsHide: true })
    let stderr = ''
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(reject, new Error(`targeted export report timed out after ${childTimeoutMs}ms`))
    }, childTimeoutMs)
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      finish(reject, error)
    })
    child.on('close', (code) => {
      if (code === 0) finish(resolve)
      else finish(reject, new Error(`targeted export report failed with exit ${code}: ${stderr}`))
    })
  })
}

async function assertNonEmpty(label, file, failures) {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size <= 0) failures.push(`${label}: empty file ${file}`)
  } catch (error) {
    failures.push(`${label}: missing file ${file} (${error.message})`)
  }
}
