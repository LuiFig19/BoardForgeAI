#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildManufacturingManifest } from '../lib/manufacturing-manifest.mjs'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.join(pluginRoot, 'tmp', 'manufacturing-manifest-test')
const reportFile = path.join(workspace, 'reports', 'boardforge-targeted-repair-report.json')
const failures = []

await runTargetedExportReport()
const report = JSON.parse(await readFile(reportFile, 'utf8'))
for (const fixture of ['robotics', 'industrial', 'poe']) {
  const result = report.results?.find((item) => item.fixture === fixture)
  const projectDir = result?.projectDir
  if (!projectDir) {
    failures.push(`${fixture}: missing project dir`)
    continue
  }
  const manifest = await buildManufacturingManifest(projectDir)
  if (manifest.status === 'MANUFACTURING_MANIFEST_BLOCKED') failures.push(`${fixture}: manifest is still blocked`)
  if (!['NEEDS_REVIEW', 'PASS'].includes(manifest.engineeringReview?.pinMapEquivalence?.status)) failures.push(`${fixture}: bad pin-map status ${manifest.engineeringReview?.pinMapEquivalence?.status}`)
  if (!['NEEDS_REVIEW', 'PASS'].includes(manifest.engineeringReview?.railCurrentReview?.status)) failures.push(`${fixture}: bad rail-current status ${manifest.engineeringReview?.railCurrentReview?.status}`)
  if (!['NEEDS_REVIEW', 'PASS'].includes(manifest.engineeringReview?.thermalReview?.status)) failures.push(`${fixture}: bad thermal status ${manifest.engineeringReview?.thermalReview?.status}`)
  if ((manifest.blockers || []).some((issue) => /PIN|FOOTPRINT|SYMBOL|CURRENT|THERMAL/i.test(issue.code || ''))) failures.push(`${fixture}: metadata/current/thermal uncertainty remained a hard blocker`)
}

await assertTrueBlockersRemainStrict()

const summary = {
  status: failures.length ? 'MANUFACTURING_MANIFEST_ASSERTION_FAILED' : 'MANUFACTURING_MANIFEST_ASSERTION_PASSED',
  reportFile,
  failures,
}
console.log(JSON.stringify(summary, null, 2))
if (failures.length) process.exit(1)

async function runTargetedExportReport() {
  await new Promise((resolve, reject) => {
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
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`targeted export report failed with exit ${code}: ${stderr}`))
    })
  })
}

async function assertTrueBlockersRemainStrict() {
  const root = await mkdtemp(path.join(tmpdir(), 'boardforge-manifest-blockers-'))
  try {
    const projectDir = path.join(root, 'blocked-project')
    await mkdir(path.join(projectDir, 'reports'), { recursive: true })
    await writeFile(path.join(projectDir, 'blocked-project.kicad_pro'), '{}', 'utf8')
    await writeFile(path.join(projectDir, 'blocked-project.kicad_sch'), '(kicad_sch)', 'utf8')
    await writeFile(path.join(projectDir, 'blocked-project.kicad_pcb'), '(kicad_pcb)', 'utf8')
    await writeFile(path.join(projectDir, 'boardforge-project.json'), JSON.stringify({ projectName: 'blocked-project', board: { name: 'Blocked' }, components: [] }), 'utf8')
    await writeFile(path.join(projectDir, 'boardforge-components.json'), '[]', 'utf8')
    await writeFile(path.join(projectDir, 'boardforge-pin-assignments.json'), JSON.stringify({ errors: [], warnings: [] }), 'utf8')
    await writeFile(path.join(projectDir, 'boardforge-bindings.json'), JSON.stringify({ errors: [], warnings: [] }), 'utf8')
    await writeFile(path.join(projectDir, 'boardforge-stackup-plan.json'), JSON.stringify({ hdi: { requiresAdvancedReview: false }, warnings: [] }), 'utf8')
    await writeFile(path.join(projectDir, 'boardforge-signal-integrity.json'), JSON.stringify({ errors: [], warnings: [] }), 'utf8')
    await writeFile(path.join(projectDir, 'boardforge-test-strategy.json'), JSON.stringify({ errors: [], warnings: [] }), 'utf8')
    await writeFile(path.join(projectDir, 'reports', 'erc.json'), JSON.stringify({ violations: [] }), 'utf8')
    await writeFile(path.join(projectDir, 'reports', 'drc.json'), JSON.stringify({ violations: [{ severity: 'error', type: 'clearance', description: 'real DRC error' }] }), 'utf8')
    const drcBlocked = await buildManufacturingManifest(projectDir)
    if (drcBlocked.status !== 'MANUFACTURING_MANIFEST_BLOCKED') failures.push('synthetic DRC-error project did not block')
    if (!drcBlocked.blockers.some((issue) => issue.code === 'DRC_ERRORS')) failures.push('synthetic DRC-error blocker missing DRC_ERRORS')

    await writeFile(path.join(projectDir, 'reports', 'drc.json'), JSON.stringify({ violations: [] }), 'utf8')
    const missingExportsBlocked = await buildManufacturingManifest(projectDir)
    if (missingExportsBlocked.status !== 'MANUFACTURING_MANIFEST_BLOCKED') failures.push('synthetic missing-export project did not block')
    if (!missingExportsBlocked.blockers.some((issue) => issue.code === 'GERBERS_MISSING' || issue.code === 'BOM_MISSING')) failures.push('synthetic missing-export blockers missing expected artifact codes')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
