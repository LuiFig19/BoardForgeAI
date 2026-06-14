import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'

const windowsCandidates = [
  'C:\\Program Files\\KiCad\\10.0\\bin\\kicad-cli.exe',
  'C:\\Program Files\\KiCad\\10\\bin\\kicad-cli.exe',
  'C:\\Program Files\\KiCad\\9.0\\bin\\kicad-cli.exe',
  'C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe',
]

export async function detectKiCadCli(config = {}) {
  const candidates = [
    config.kicadCliPath,
    process.env.BOARDFORGE_KICAD_CLI,
    ...windowsCandidates,
    'kicad-cli',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate !== 'kicad-cli' && !existsSync(candidate)) continue
    const probe = await runProcess(candidate, ['version'], { timeoutMs: 10000, allowNonZero: true })
    if (probe.exitCode === 0) {
      return { available: true, path: candidate, version: probe.stdout.trim(), raw: probe }
    }
  }
  return { available: false, path: null, version: null, reason: 'kicad-cli was not found on PATH or common KiCad install paths.' }
}

export async function runDrc({ pcbFile, outputFile, kicadCliPath }) {
  return runReportCommand({
    kicadCliPath,
    args: ['pcb', 'drc', '--format', 'json', '--units', 'mm', '--severity-all', '--exit-code-violations', '--output', outputFile, pcbFile],
    outputFile,
    reportKind: 'DRC',
  })
}

export async function runErc({ schFile, outputFile, kicadCliPath }) {
  return runReportCommand({
    kicadCliPath,
    args: ['sch', 'erc', '--format', 'json', '--units', 'mm', '--severity-all', '--exit-code-violations', '--output', outputFile, schFile],
    outputFile,
    reportKind: 'ERC',
  })
}

async function runReportCommand({ kicadCliPath, args, outputFile, reportKind }) {
  await mkdir(path.dirname(outputFile), { recursive: true })
  const run = await runProcess(kicadCliPath, args, { timeoutMs: 120000, allowNonZero: true })
  const report = await readJsonIfExists(outputFile)
  const issues = extractReportIssues(report)
  return {
    status: run.exitCode === 0 && issues.errors === 0 ? `${reportKind}_PASSED` : `${reportKind}_NEEDS_FIX`,
    command: [kicadCliPath, ...args],
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    reportFile: outputFile,
    report,
    issueCounts: issues,
  }
}

export async function exportGerbers({ pcbFile, outputDir, kicadCliPath }) {
  await mkdir(outputDir, { recursive: true })
  const args = ['pcb', 'export', 'gerbers', '--output', outputDir, '--layers', 'F.Cu,B.Cu,F.Paste,B.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts', '--precision', '6', '--check-zones', pcbFile]
  const run = await runProcess(kicadCliPath, args, { timeoutMs: 120000, allowNonZero: true })
  return exportResult('GERBERS', run, outputDir, await listFiles(outputDir))
}

export async function exportDrill({ pcbFile, outputDir, kicadCliPath }) {
  await mkdir(outputDir, { recursive: true })
  const reportPath = path.join(outputDir, 'drill-report.rpt')
  const args = ['pcb', 'export', 'drill', '--output', outputDir, '--format', 'excellon', '--excellon-units', 'mm', '--excellon-zeros-format', 'decimal', '--generate-map', '--generate-report', '--report-path', reportPath, pcbFile]
  const run = await runProcess(kicadCliPath, args, { timeoutMs: 120000, allowNonZero: true })
  return exportResult('DRILL', run, outputDir, await listFiles(outputDir))
}

export async function exportCpl({ pcbFile, outputFile, kicadCliPath }) {
  await mkdir(path.dirname(outputFile), { recursive: true })
  const args = ['pcb', 'export', 'pos', '--output', outputFile, '--side', 'both', '--format', 'csv', '--units', 'mm', '--smd-only', pcbFile]
  const run = await runProcess(kicadCliPath, args, { timeoutMs: 120000, allowNonZero: true })
  return exportResult('CPL', run, outputFile, existsSync(outputFile) ? [outputFile] : [])
}

export async function exportBom({ schFile, outputFile, kicadCliPath }) {
  await mkdir(path.dirname(outputFile), { recursive: true })
  const args = ['sch', 'export', 'bom', '--output', outputFile, '--fields', 'Reference,Value,Footprint,QUANTITY,DNP,${LCSC}', '--labels', 'Refs,Value,Footprint,Qty,DNP,LCSC', '--group-by', 'Value,Footprint,${LCSC}', '--exclude-dnp', schFile]
  const run = await runProcess(kicadCliPath, args, { timeoutMs: 120000, allowNonZero: true })
  return exportResult('BOM', run, outputFile, existsSync(outputFile) ? [outputFile] : [])
}

function exportResult(kind, run, target, files) {
  return {
    status: run.exitCode === 0 && files.length > 0 ? `${kind}_EXPORTED` : `${kind}_FAILED`,
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    target,
    files,
  }
}

export async function packageJlcpcb({ projectDir, outputFile, requiredFiles }) {
  const existingFiles = []
  const missingFiles = []
  for (const file of requiredFiles) {
    if (existsSync(file)) existingFiles.push(file)
    else missingFiles.push(file)
  }
  if (missingFiles.length > 0) {
    return { status: 'PACKAGE_BLOCKED_MISSING_FILES', outputFile, files: existingFiles, missingFiles }
  }
  const drcFile = existingFiles.find((file) => path.basename(file).toLowerCase() === 'drc.json')
  if (drcFile) {
    const drc = await readJsonIfExists(drcFile)
    const counts = extractReportIssues(drc)
    if (counts.errors > 0) {
      return { status: 'PACKAGE_BLOCKED_DRC_ERRORS', outputFile, files: existingFiles, issueCounts: counts }
    }
  }
  const zip = new JSZip()
  for (const file of existingFiles) {
    const relative = path.relative(projectDir, file).replaceAll(path.sep, '/')
    zip.file(relative, await readFile(file))
  }
  zip.file('BOARDFORGE-MANUFACTURING-REVIEW.txt', 'Generated by BoardForge local KiCad adapter. Human review is required before ordering.\n')
  await mkdir(path.dirname(outputFile), { recursive: true })
  await writeFile(outputFile, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return { status: 'MANUFACTURING_PACKAGE_GENERATED_NEEDS_REVIEW', outputFile, files: existingFiles }
}

export async function findKiCadProjectFiles(projectPath) {
  const rootStat = await stat(projectPath)
  const root = rootStat.isDirectory() ? projectPath : path.dirname(projectPath)
  const files = await readdir(root)
  return {
    projectDir: root,
    pcbFile: files.find((file) => file.endsWith('.kicad_pcb')) ? path.join(root, files.find((file) => file.endsWith('.kicad_pcb'))) : null,
    schFile: files.find((file) => file.endsWith('.kicad_sch')) ? path.join(root, files.find((file) => file.endsWith('.kicad_sch'))) : null,
    proFile: files.find((file) => file.endsWith('.kicad_pro')) ? path.join(root, files.find((file) => file.endsWith('.kicad_pro'))) : null,
  }
}

function extractReportIssues(report) {
  const text = JSON.stringify(report || {})
  const errors = (text.match(/"severity"\s*:\s*"error"/gi) || []).length + (text.match(/"severity"\s*:\s*"ERROR"/g) || []).length
  const warnings = (text.match(/"severity"\s*:\s*"warning"/gi) || []).length + (text.match(/"severity"\s*:\s*"WARNING"/g) || []).length
  return { errors, warnings }
}

async function readJsonIfExists(file) {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function listFiles(dir) {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(full))
    else files.push(full)
  }
  return files
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, options.timeoutMs || 60000)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      clearTimeout(timeout)
      resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timeout)
      resolve({ exitCode: exitCode ?? 1, stdout, stderr })
    })
  })
}
