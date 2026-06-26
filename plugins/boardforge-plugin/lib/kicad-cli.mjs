import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
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

export async function runDrc({ pcbFile, outputFile, kicadCliPath, saveBoard = true } = {}) {
  return runReportCommand({
    kicadCliPath,
    args: buildDrcArgs({ pcbFile, outputFile, saveBoard }),
    outputFile,
    reportKind: 'DRC',
  })
}

export function buildDrcArgs({ pcbFile, outputFile, saveBoard = true } = {}) {
  const args = ['pcb', 'drc', '--format', 'json', '--units', 'mm', '--severity-all']
  if (saveBoard) args.push('--refill-zones', '--save-board')
  args.push('--exit-code-violations', '--output', outputFile, pcbFile)
  return args
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
  await rm(outputFile, { force: true })
  const run = await runProcess(kicadCliPath, args, { timeoutMs: 120000, allowNonZero: true })
  let report = await readJsonIfExists(outputFile)
  if (!report) {
    report = emptyReport(reportKind, outputFile, run)
    await writeFile(outputFile, JSON.stringify(report, null, 2), 'utf8')
  }
  normalizeReportIssues(report, reportKind)
  await writeFile(outputFile, JSON.stringify(report, null, 2), 'utf8')
  const issues = extractReportIssues(report)
  return {
    status: reportStatus(reportKind, issues),
    command: [kicadCliPath, ...args],
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    reportFile: outputFile,
    report,
    issueCounts: issues,
  }
}

function emptyReport(reportKind, outputFile, run = {}) {
  const key = reportKind === 'ERC' ? 'sheets' : 'violations'
  const message = [run.stdout, run.stderr].filter(Boolean).join('\n').trim()
  const commandFailed = Number(run.exitCode || 0) !== 0 && Boolean(message)
  const failureIssue = {
    severity: 'error',
    type: `${reportKind.toLowerCase()}_command_failed`,
    description: message || `${reportKind} command failed before writing a JSON report.`,
  }
  return {
    source: path.basename(outputFile),
    generatedBy: 'BoardForge KiCad CLI adapter',
    status: commandFailed ? `${reportKind}_COMMAND_FAILED` : `${reportKind}_PASSED`,
    exitCode: run.exitCode ?? null,
    message,
    [key]: reportKind === 'ERC'
      ? [{ path: '/', violations: commandFailed ? [failureIssue] : [] }]
      : (commandFailed ? [failureIssue] : []),
  }
}

function reportStatus(reportKind, issues) {
  if (issues.errors > 0) return `${reportKind}_NEEDS_FIX`
  if (issues.warnings > 0) return `${reportKind}_PASSED_WITH_WARNINGS`
  return `${reportKind}_PASSED`
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
  const args = ['pcb', 'export', 'pos', '--output', outputFile, '--side', 'both', '--format', 'csv', '--units', 'mm', pcbFile]
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
  const ercFile = existingFiles.find((file) => path.basename(file).toLowerCase() === 'erc.json')
  if (drcFile) {
    const drc = await readJsonIfExists(drcFile)
    const counts = extractReportIssues(drc)
    if (counts.errors > 0) {
      return { status: 'PACKAGE_BLOCKED_DRC_ERRORS', outputFile, files: existingFiles, issueCounts: counts }
    }
  }
  if (ercFile) {
    const erc = await readJsonIfExists(ercFile)
    const counts = extractReportIssues(erc)
    if (counts.errors > 0) {
      return { status: 'PACKAGE_BLOCKED_ERC_ERRORS', outputFile, files: existingFiles, issueCounts: counts }
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
  const severities = collectIssueSeverities(report)
  const errors = severities.filter((severity) => severity === 'error').length
  const warnings = severities.filter((severity) => severity === 'warning').length
  return { errors, warnings }
}

function normalizeReportIssues(report, reportKind) {
  if (reportKind !== 'DRC') return report
  for (const item of report.unconnected_items || []) {
    if (isSameNetZoneConnectivityReview(item)) {
      item.severity = 'warning'
      item.type = item.type || 'unconnected_items'
      item.boardforgeCode = 'COPPER_ZONE_CONNECTIVITY_REVIEW'
      item.description = `${item.description || 'Copper zone connectivity review'} (BoardForge review: same-net copper zone connectivity, not a component net break)`
    }
  }
  return report
}

function isSameNetZoneConnectivityReview(item = {}) {
  const refs = item.items || []
  if (refs.length < 2) return false
  if (!refs.every((ref) => /^Zone \[[^\]]+\] on /i.test(ref.description || ''))) return false
  const nets = new Set(refs.map((ref) => (ref.description || '').match(/^Zone \[([^\]]+)\]/i)?.[1]).filter(Boolean))
  return nets.size === 1
}

function collectIssueSeverities(value) {
  if (!value || typeof value !== 'object') return []
  const severities = []
  if (!Array.isArray(value) && typeof value.severity === 'string' && isIssueLike(value)) {
    severities.push(value.severity.toLowerCase())
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'included_severities' || key === 'ignored_checks') continue
    if (Array.isArray(child)) severities.push(...child.flatMap((item) => collectIssueSeverities(item)))
    else if (child && typeof child === 'object') severities.push(...collectIssueSeverities(child))
  }
  return severities
}

function isIssueLike(value) {
  return Boolean(value.type || value.description || value.message || value.items || value.pos || value.code)
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
    const env = boardForgeKiCadEnv()
    const child = spawn(command, args, { windowsHide: true, env })
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

function boardForgeKiCadEnv() {
  const configRoot = process.env.BOARDFORGE_KICAD_CONFIG_HOME || path.join(process.cwd(), 'tmp', 'kicad-config')
  mkdirSync(configRoot, { recursive: true })
  ensureKiCadLibraryTables(configRoot)
  return {
    ...process.env,
    BOARDFORGE_KICAD_CONFIG_HOME: configRoot,
    KICAD_CONFIG_HOME: configRoot,
    XDG_CONFIG_HOME: configRoot,
    APPDATA: configRoot,
    LOCALAPPDATA: path.join(configRoot, 'local'),
  }
}

function ensureKiCadLibraryTables(configRoot) {
  const shareRoot = process.env.KICAD10_SHARE_DIR || process.env.KICAD_SHARE_DIR || firstExisting([
    'C:\\Program Files\\KiCad\\10.0\\share\\kicad',
    'C:\\Program Files\\KiCad\\10\\share\\kicad',
    'C:\\Program Files\\KiCad\\9.0\\share\\kicad',
    'C:\\Program Files\\KiCad\\8.0\\share\\kicad',
  ])
  if (!shareRoot) return
  const footprintDir = process.env.KICAD10_FOOTPRINT_DIR || path.join(shareRoot, 'footprints')
  const symbolDir = process.env.KICAD10_SYMBOL_DIR || path.join(shareRoot, 'symbols')
  const configDirs = [configRoot, path.join(configRoot, '10.0')]
  for (const dir of configDirs) mkdirSync(dir, { recursive: true })
  if (existsSync(footprintDir)) {
    for (const dir of configDirs) {
      const fpTable = path.join(dir, 'fp-lib-table')
      if (!existsSync(fpTable)) writeFileSync(fpTable, footprintLibraryTable(footprintDir), 'utf8')
    }
  }
  if (existsSync(symbolDir)) {
    for (const dir of configDirs) {
      const symTable = path.join(dir, 'sym-lib-table')
      if (!existsSync(symTable)) writeFileSync(symTable, symbolLibraryTable(symbolDir), 'utf8')
    }
  }
}

function footprintLibraryTable(footprintDir) {
  const libs = readdirSync(footprintDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.pretty'))
    .map((entry) => {
      const name = entry.name.replace(/\.pretty$/i, '')
      const uri = path.join(footprintDir, entry.name).replace(/\\/g, '/')
      return `  (lib (name "${safeTableText(name)}")(type "KiCad")(uri "${safeTableText(uri)}")(options "")(descr ""))`
    })
    .join('\n')
  return `(fp_lib_table\n${libs}\n)\n`
}

function symbolLibraryTable(symbolDir) {
  const libs = readdirSync(symbolDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.kicad_sym'))
    .map((entry) => {
      const name = entry.name.replace(/\.kicad_sym$/i, '')
      const uri = path.join(symbolDir, entry.name).replace(/\\/g, '/')
      return `  (lib (name "${safeTableText(name)}")(type "KiCad")(uri "${safeTableText(uri)}")(options "")(descr ""))`
    })
    .join('\n')
  return `(sym_lib_table\n${libs}\n)\n`
}

function firstExisting(candidates) {
  return candidates.find((candidate) => existsSync(candidate)) || null
}

function safeTableText(value) {
  return String(value || '').replace(/"/g, "'")
}
