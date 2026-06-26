#!/usr/bin/env node
import path from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { executeJob, loadJob } from '../lib/jobs.mjs'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1] || null
}

function blockedStatus(status) {
  return /BLOCKED|FAILED|NEEDS_FIX|VALIDATION_FAILED/.test(status || '')
}

function stepByName(result, name) {
  return result.verifiedDemoRun?.results?.find((step) => step.step === name) || null
}

function issueErrors(step) {
  return Number(step?.issueCounts?.errors || 0)
}

function hasStep(result, name) {
  return Boolean(stepByName(result, name))
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function main() {
  const timeoutMs = Number(process.env.BOARDFORGE_GOLDEN_TIMEOUT_MS || argValue('--timeout-ms') || 600000)
  const watchdog = setTimeout(() => {
    console.error(JSON.stringify({ status: 'GOLDEN_ASSERTION_TIMEOUT', timeoutMs }, null, 2))
    process.exit(124)
  }, timeoutMs)
  const workspace = path.resolve(argValue('--workspace') || './tmp')
  const jobPath = argValue('--job') || './examples/verified-demo-job.json'
  try {
    const job = await loadJob(jobPath)
    const result = await executeJob({
      ...job,
      allowOverwrite: true,
      input: {
        ...(job.input || {}),
        allowOverwrite: true,
        continueOnBlocked: true,
      },
    }, workspace)
    const projectPath = path.resolve(workspace, result.verifiedDemoRun?.projectPath || result.projectPath || 'boardforge-verified-demo-usb-sensor')
    const ercStep = stepByName(result, 'run_kicad_erc')
    const drcStep = stepByName(result, 'run_kicad_drc')
    const packageStep = stepByName(result, 'package_jlcpcb')
    const packageValidationStep = stepByName(result, 'validate_jlcpcb_package')
    const packageEvidence = await readJsonIfExists(path.join(projectPath, 'boardforge-jlcpcb-package-validation.json'))
    const failures = []
    if (blockedStatus(result.status)) failures.push(`verified demo status is ${result.status}`)
    if (!ercStep) failures.push('ERC step did not run')
    if (!drcStep) failures.push('DRC step did not run')
    if (issueErrors(ercStep) > 0) failures.push(`ERC has ${issueErrors(ercStep)} errors`)
    if (issueErrors(drcStep) > 0) failures.push(`DRC has ${issueErrors(drcStep)} errors`)
    for (const step of ['export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'validate_jlcpcb_package', 'package_jlcpcb']) {
      if (!hasStep(result, step)) failures.push(`${step} did not run`)
    }
    if (packageStep && blockedStatus(packageStep.status)) failures.push(`package step is ${packageStep.status}`)
    if (packageValidationStep && blockedStatus(packageValidationStep.status)) failures.push(`package validation is ${packageValidationStep.status}`)
    if (packageEvidence && packageEvidence.status && blockedStatus(packageEvidence.status)) failures.push(`package evidence is ${packageEvidence.status}`)
    const summary = {
      status: failures.length ? 'GOLDEN_ASSERTION_FAILED' : 'GOLDEN_ASSERTION_PASSED',
      projectPath,
      verifiedDemoStatus: result.status,
      erc: ercStep?.issueCounts || null,
      drc: drcStep?.issueCounts || null,
      packageValidation: packageEvidence?.status || packageValidationStep?.status || null,
      failures,
    }
    clearTimeout(watchdog)
    console.log(JSON.stringify(summary, null, 2))
    if (failures.length) process.exit(1)
  } finally {
    clearTimeout(watchdog)
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'GOLDEN_ASSERTION_ERROR', message: error.message }, null, 2))
  process.exit(1)
})
