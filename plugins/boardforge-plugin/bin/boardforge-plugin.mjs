#!/usr/bin/env node
import path from 'node:path'
import { executeJob, loadJob } from '../lib/jobs.mjs'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1] || null
}

async function main() {
  const jobPath = argValue('--job')
  const workspace = path.resolve(argValue('--workspace') || process.cwd())
  if (!jobPath) throw new Error('Missing --job path/to/job.json')
  const job = await loadJob(jobPath)
  const result = await executeJob(job, workspace)
  console.log(JSON.stringify(result, null, 2))
  if (['VALIDATION_FAILED', 'NEEDS_FIX', 'SCAN_FAILED'].includes(result.status)) process.exitCode = 2
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'FAILED', errors: [{ severity: 'BLOCKER', code: 'CLI_ERROR', message: error.message }] }, null, 2))
  process.exit(1)
})
